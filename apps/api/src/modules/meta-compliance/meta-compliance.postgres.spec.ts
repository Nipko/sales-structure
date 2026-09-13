import { createHmac, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { MetaComplianceService } from './meta-compliance.service';
import { PlatformNotificationOutboxService } from '../platform-notifications/platform-notification-outbox.service';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('durable Meta compliance requests', () => {
    jest.setTimeout(120_000);
    let admin: Client;
    let prisma: PrismaClient;
    const deliver = jest.fn().mockResolvedValue('queued');
    const redis = { incrementRateLimit: jest.fn().mockResolvedValue(1) };
    const cronLock = { runExclusive: jest.fn(async (_key: string, _ttl: number, work: any) => work()) };
    const config = { get: jest.fn((key: string, fallback?: string) => ({
        META_APP_SECRET: 'test-secret', PUBLIC_LANDING_URL: 'https://parallly-chat.cloud',
        COMPLIANCE_NOTIFY_EMAIL: 'compliance@example.test', DASHBOARD_URL: 'https://admin.example.test',
    } as Record<string, string>)[key] ?? fallback) };
    let service: MetaComplianceService;

    beforeAll(async () => {
        admin = new Client({ connectionString: connection });
        await admin.connect();
        await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(sql => admin.query(sql));
        for (const migration of [
            '20260913180000_add_platform_notification_outbox',
            '20260913190000_extend_platform_notifications_for_billing',
            '20260914000000_add_durable_meta_compliance_requests',
        ]) {
            await admin.query(readFileSync(join(__dirname, `../../../prisma/migrations/${migration}/migration.sql`), 'utf8'));
        }
        prisma = new PrismaClient({ datasources: { db: { url: connection } } });
        await prisma.$connect();
        service = new MetaComplianceService(config as any, redis as any, prisma as any,
            { deliver } as any, cronLock as any);
    });

    afterAll(async () => {
        await admin?.query("DELETE FROM platform_notification_outbox WHERE kind='meta_compliance.request_email'").catch(() => undefined);
        await admin?.query('DELETE FROM meta_compliance_requests').catch(() => undefined);
        await prisma?.$disconnect();
        await admin?.end();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        redis.incrementRateLimit.mockResolvedValue(1);
        deliver.mockResolvedValue('queued');
        await admin.query("DELETE FROM platform_notification_outbox WHERE kind='meta_compliance.request_email'");
        await admin.query('DELETE FROM meta_compliance_requests');
    });

    it('commits the legal request and one notification before acknowledging it', async () => {
        const result = await service.submitUserRequest({
            email: ' Agent@Example.com ', description: 'Cuenta de demostración',
        });
        const requests = (await admin.query('SELECT * FROM meta_compliance_requests')).rows;
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ code: result.confirmation_code,
            email: 'agent@example.com', status: 'received', notes: 'Cuenta de demostración' });
        const notices = (await admin.query(`SELECT * FROM platform_notification_outbox
            WHERE kind='meta_compliance.request_email'`)).rows;
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ entity_id: result.confirmation_code,
            recipient_email: 'compliance@example.test', state: 'pending' });
    });

    it('adopts an HTTP repeat and the bounded worker stores the SMTP receipt', async () => {
        const first = await service.submitUserRequest({ email: 'agent@example.com' });
        const second = await service.submitUserRequest({ email: 'agent@example.com' });
        expect(second.confirmation_code).toBe(first.confirmation_code);
        expect((await admin.query('SELECT code FROM meta_compliance_requests')).rows).toHaveLength(1);
        const notice = (await admin.query(`SELECT id FROM platform_notification_outbox
            WHERE kind='meta_compliance.request_email'`)).rows[0];
        const smtp = jest.fn().mockResolvedValue('smtp.compliance.1');
        const worker = new PlatformNotificationOutboxService(prisma as any,
            { prepareBoundedSend: jest.fn().mockReturnValue(smtp) } as any, config as any, cronLock as any);
        await expect(worker.deliver(notice.id)).resolves.toBe('notification:sent');
        await expect(worker.deliver(notice.id)).resolves.toBe('notification:sent');
        expect(smtp).toHaveBeenCalledTimes(1);
        expect((await admin.query('SELECT state,provider_reference FROM platform_notification_outbox WHERE id=$1::uuid',
            [notice.id])).rows[0]).toMatchObject({ state: 'sent', provider_reference: 'smtp.compliance.1' });
    });

    it('keeps status transitions available after replacing the service process', async () => {
        const { confirmation_code: code } = await service.submitUserRequest({ email: 'agent@example.com' });
        const restarted = new MetaComplianceService(config as any, redis as any, prisma as any,
            { deliver } as any, cronLock as any);
        const publicStatus = await restarted.getStatus(code);
        expect(publicStatus).toMatchObject({ code, status: 'received' });
        expect(publicStatus).not.toHaveProperty('email');
        expect(publicStatus).not.toHaveProperty('notes');
        await expect(restarted.updateStatus(code, 'processing', 'Identity checked'))
            .resolves.toMatchObject({ code, status: 'processing' });
        const completed = await restarted.updateStatus(code, 'completed');
        expect(completed).toMatchObject({ code, status: 'completed' });
        expect(completed.processedAt).toBeTruthy();
        await expect(restarted.updateStatus(code, 'received' as any)).rejects.toThrow('Invalid deletion status');
    });

    it('deduplicates Meta retries by the signed subject and issued time', async () => {
        const payload = Buffer.from(JSON.stringify({ user_id: 'fb-123', algorithm: 'HMAC-SHA256', issued_at: 12345 }))
            .toString('base64url');
        const sig = createHmac('sha256', 'test-secret').update(payload).digest('base64url');
        const callbacks = await Promise.all(Array.from({ length: 12 }, () =>
            service.handleMetaCallback(`${sig}.${payload}`)));
        expect(new Set(callbacks.map(result => result.confirmation_code))).toHaveProperty('size', 1);
        expect((await admin.query('SELECT code FROM meta_compliance_requests')).rows).toHaveLength(1);
        expect((await admin.query(`SELECT id FROM platform_notification_outbox
            WHERE kind='meta_compliance.request_email'`)).rows).toHaveLength(1);
    });

    it('removes expired PII and its delivery record together', async () => {
        const result = await service.submitUserRequest({ email: `${randomUUID()}@example.test` });
        await admin.query(`UPDATE meta_compliance_requests SET retention_until=NOW()-INTERVAL '1 second'
            WHERE code=$1::uuid`, [result.confirmation_code]);
        await service.purgeExpired();
        expect((await admin.query('SELECT code FROM meta_compliance_requests')).rows).toHaveLength(0);
        expect((await admin.query(`SELECT id FROM platform_notification_outbox
            WHERE kind='meta_compliance.request_email'`)).rows).toHaveLength(0);
    });
});
