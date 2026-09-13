import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformNotificationOutboxService } from './platform-notification-outbox.service';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;

(url ? describe : describe.skip)('email-template test outbox — PostgreSQL', () => {
    const tenantId = randomUUID();
    const templateId = randomUUID();
    let admin: Client;
    let client: PrismaClient;
    let prisma: any;

    beforeAll(async () => {
        admin = new Client({ connectionString: url });
        await admin.connect();
        await ensureSyntheticGlobalTables(sql => admin.query(sql));
        for (const migration of [
            '20260913180000_add_platform_notification_outbox',
            '20260913190000_extend_platform_notifications_for_billing',
            '20260914060000_add_durable_email_template_tests',
        ]) {
            await admin.query(readFileSync(join(__dirname, `../../../prisma/migrations/${migration}/migration.sql`), 'utf8'));
        }
        await admin.query(`INSERT INTO tenants(id,schema_name,is_active,language,settings)
            VALUES($1::uuid,$2,true,'es','{}'::jsonb)`, [tenantId, `email_test_${tenantId.replace(/-/g, '')}`]);
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    });

    afterAll(async () => {
        await admin.query('DELETE FROM platform_notification_outbox WHERE tenant_id=$1::uuid', [tenantId]).catch(() => undefined);
        await admin.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]).catch(() => undefined);
        await client?.$disconnect();
        await admin?.end();
    });

    function delivery(send: jest.Mock) {
        return new PlatformNotificationOutboxService(prisma,
            { prepareBoundedSend: jest.fn().mockImplementation((message: any) => {
                expect(message).toEqual(expect.objectContaining({
                    to: 'operator@example.test', subject: '[TEST] Preview', html: '<p>Preview</p>',
                }));
                return send;
            }) } as any, {} as any, { runExclusive: jest.fn() } as any);
    }

    const input = (requestKey: string) => ({ tenantId, templateId, requestKey,
        to: 'operator@example.test', subject: '[TEST] Preview', html: '<p>Preview</p>' });

    it('stores one authority and one SMTP receipt across a repeated HTTP request', async () => {
        const send = jest.fn().mockResolvedValue('smtp-test-receipt');
        const service = delivery(send);
        await expect(service.sendEmailTemplateTest(input('request_pg_12345678')))
            .resolves.toBe('notification:sent');
        await expect(service.sendEmailTemplateTest(input('request_pg_12345678')))
            .resolves.toBe('notification:sent');
        expect(send).toHaveBeenCalledTimes(1);
        const rows = await client.$queryRawUnsafe<any[]>(`SELECT state,attempts,provider_reference
            FROM platform_notification_outbox WHERE event_key=$1`,
        `email-template-test:${tenantId}:request_pg_12345678`);
        expect(rows).toEqual([{ state: 'sent', attempts: 1, provider_reference: 'smtp-test-receipt' }]);
    });

    it('freezes an SMTP attempt whose outcome is unknown', async () => {
        const send = jest.fn().mockRejectedValue(new Error('smtp_deadline_outcome_unknown'));
        const service = delivery(send);
        await expect(service.sendEmailTemplateTest(input('request_pg_unknown')))
            .rejects.toThrow('smtp_deadline_outcome_unknown');
        await expect(service.sendEmailTemplateTest(input('request_pg_unknown')))
            .resolves.toBe('notification:reconciliation_required');
        expect(send).toHaveBeenCalledTimes(1);
        const [row] = await client.$queryRawUnsafe<any[]>(`SELECT state,attempts
            FROM platform_notification_outbox WHERE event_key=$1`,
        `email-template-test:${tenantId}:request_pg_unknown`);
        expect(row).toEqual({ state: 'reconciliation_required', attempts: 1 });
    });
});
