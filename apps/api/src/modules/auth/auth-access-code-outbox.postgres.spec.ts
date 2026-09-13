import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { PlatformNotificationOutboxService } from '../platform-notifications/platform-notification-outbox.service';
import { AuthService } from './auth.service';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;

(url ? describe : describe.skip)('durable authentication access-code email', () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const email = `auth-${userId}@example.test`;
    let admin: Client;
    let client: PrismaClient;
    let prisma: any;

    beforeAll(async () => {
        admin = new Client({ connectionString: url });
        await admin.connect();
        await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(sql => admin.query(sql));
        await admin.query(`CREATE TABLE IF NOT EXISTS feature_requests(
            id UUID PRIMARY KEY,status_revision INTEGER NOT NULL DEFAULT 0)`);
        for (const migration of [
            '20260913180000_add_platform_notification_outbox',
            '20260913190000_extend_platform_notifications_for_billing',
            '20260913200000_add_durable_invitation_notifications',
            '20260913210000_add_durable_auth_access_emails',
        ]) {
            await admin.query(readFileSync(join(__dirname, `../../../prisma/migrations/${migration}/migration.sql`), 'utf8'));
        }
        await admin.query(`INSERT INTO tenants(id,schema_name,is_active,language,settings)
            VALUES($1::uuid,$2,true,'en','{}')`, [tenantId, `tenant_auth_${tenantId.replace(/-/g, '')}`]);
        await admin.query(`INSERT INTO users(id,tenant_id,email,first_name,last_name,role,is_active)
            VALUES($1::uuid,$2::uuid,$3,'Laura','Gómez','tenant_admin',true)`, [userId, tenantId, email]);
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    });

    beforeEach(async () => {
        await admin.query('DELETE FROM platform_notification_outbox WHERE recipient_user_id=$1::uuid', [userId]);
        await admin.query(`UPDATE users SET email_verify_code=NULL,email_verify_expires=NULL,
            email_challenge_revision=0,two_factor_email_code=NULL,two_factor_email_expires=NULL,
            two_factor_email_revision=0 WHERE id=$1::uuid`, [userId]);
    });

    afterAll(async () => {
        await admin.query('DELETE FROM platform_notification_outbox WHERE recipient_user_id=$1::uuid', [userId]).catch(() => undefined);
        await admin.query('DELETE FROM users WHERE id=$1::uuid', [userId]).catch(() => undefined);
        await admin.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]).catch(() => undefined);
        await client?.$disconnect();
        await admin.end();
    });

    const authWith = (notifications: any, database = prisma): any => {
        const auth = Object.create(AuthService.prototype);
        Object.assign(auth, { prisma: database, platformNotifications: notifications,
            logger: { warn: jest.fn(), error: jest.fn() } });
        return auth;
    };

    it('suppresses a replaced code and renders only the current purpose and revision', async () => {
        const deferred = { deliver: jest.fn().mockResolvedValue('notification:pending') };
        const auth = authWith(deferred);
        await expect(auth.issueAccessCodeEmail(userId, 'email_verification', 600)).resolves.toBe(false);
        const [old] = await client.$queryRawUnsafe<any[]>(`SELECT id FROM platform_notification_outbox
            WHERE recipient_user_id=$1::uuid`, userId);

        const payloads: any[] = [];
        const send = jest.fn().mockResolvedValue('smtp-auth-accepted');
        const delivery = new PlatformNotificationOutboxService(prisma, {
            prepareBoundedSend: jest.fn().mockImplementation((payload: any) => {
                payloads.push(payload); return send;
            }),
        } as any, { get: (_key: string, fallback: string) => fallback } as any,
        { runExclusive: jest.fn() } as any);
        const liveAuth = authWith(delivery);
        await expect(liveAuth.issueAccessCodeEmail(userId, 'password_reset', 600)).resolves.toBe(true);
        await expect(delivery.deliver(old.id)).resolves.toBe('notification:suppressed');
        expect(send).toHaveBeenCalledTimes(1);
        expect(payloads[0]).toMatchObject({ to: email, subject: expect.stringContaining('Restablece') });
        const [user] = await client.$queryRawUnsafe<any[]>(
            'SELECT email_verify_code FROM users WHERE id=$1::uuid', userId);
        expect(payloads[0].html).toContain(user.email_verify_code);
        expect((await client.$queryRawUnsafe<any[]>(`SELECT state FROM platform_notification_outbox
            WHERE id=$1::uuid`, old.id))[0].state).toBe('suppressed');
    });

    it('keeps the prior code and revision when durable admission fails', async () => {
        await client.$executeRawUnsafe(`UPDATE users SET email_verify_code='123456',
            email_verify_expires=NOW()+INTERVAL '10 minutes',email_challenge_revision=4 WHERE id=$1::uuid`, userId);
        const broken = Object.create(prisma);
        broken.$transaction = (callback: any, options: any) => client.$transaction((tx: any) => callback(new Proxy(tx, {
            get(target, property) {
                if (property === '$queryRawUnsafe') return (sql: string, ...params: any[]) => {
                    if (sql.includes('INSERT INTO platform_notification_outbox')) throw new Error('outbox unavailable');
                    return target.$queryRawUnsafe(sql, ...params);
                };
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            },
        })), options);
        await expect(authWith({ deliver: jest.fn() }, broken)
            .issueAccessCodeEmail(userId, 'email_verification', 600)).rejects.toThrow('outbox unavailable');
        expect((await client.$queryRawUnsafe<any[]>(`SELECT email_verify_code,email_challenge_revision
            FROM users WHERE id=$1::uuid`, userId))[0]).toEqual({
            email_verify_code: '123456', email_challenge_revision: 4,
        });
    });

    it('keeps email 2FA separate from verification and stores its SMTP receipt', async () => {
        const captured: any[] = [];
        const delivery = new PlatformNotificationOutboxService(prisma, {
            prepareBoundedSend: jest.fn().mockImplementation((payload: any) => {
                captured.push(payload); return jest.fn().mockResolvedValue('smtp-2fa-accepted');
            }),
        } as any, { get: (_key: string, fallback: string) => fallback } as any,
        { runExclusive: jest.fn() } as any);
        await expect(authWith(delivery).issueAccessCodeEmail(userId, 'two_factor', 300)).resolves.toBe(true);
        const [user] = await client.$queryRawUnsafe<any[]>(`SELECT two_factor_email_code,email_verify_code
            FROM users WHERE id=$1::uuid`, userId);
        expect(user.email_verify_code).toBeNull();
        expect(captured[0].html).toContain(user.two_factor_email_code);
        expect(captured[0].subject).toContain('autenticacion');
        expect((await client.$queryRawUnsafe<any[]>(`SELECT state,provider_reference
            FROM platform_notification_outbox WHERE recipient_user_id=$1::uuid`, userId))[0])
            .toEqual({ state: 'sent', provider_reference: 'smtp-2fa-accepted' });
    });
});
