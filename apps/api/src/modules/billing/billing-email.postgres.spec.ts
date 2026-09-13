import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingEmailService } from './billing-email.service';
import { PlatformNotificationOutboxService } from '../platform-notifications/platform-notification-outbox.service';
import { BillingEventType } from './types/billing-event.enum';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;

(url ? describe : describe.skip)('durable billing lifecycle email', () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const planId = randomUUID();
    const subscriptionId = randomUUID();
    const historicalId = randomUUID();
    const eventId = randomUUID();
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
        await admin.query(`CREATE TABLE IF NOT EXISTS billing_events(
            id UUID PRIMARY KEY,tenant_id UUID,subscription_id UUID,provider TEXT NOT NULL,
            provider_event_id TEXT NOT NULL,event_type TEXT NOT NULL,payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(provider,provider_event_id))`);
        await admin.query(`CREATE TABLE IF NOT EXISTS billing_payments(
            id UUID PRIMARY KEY,tenant_id UUID,status TEXT,amount_cents INTEGER,currency TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260913180000_add_platform_notification_outbox/migration.sql'), 'utf8'));
        await admin.query(`INSERT INTO tenants(id,billing_email,name,language)
            VALUES($1::uuid,$2,'Acme','es')`, [tenantId, `billing-${tenantId}@example.test`]);
        await admin.query(`INSERT INTO users(id,tenant_id,email,first_name,role,is_active)
            VALUES($1::uuid,$2::uuid,$3,'Ana','tenant_admin',true)`,
        [userId, tenantId, `admin-${tenantId}@example.test`]);
        await admin.query('INSERT INTO billing_plans(id,name) VALUES($1::uuid,$2)', [planId, 'Pro']);
        await admin.query(`INSERT INTO billing_subscriptions(id,tenant_id,plan_id)
            VALUES($1::uuid,$2::uuid,$3::uuid)`, [subscriptionId, tenantId, planId]);
        await admin.query(`INSERT INTO billing_events(id,tenant_id,subscription_id,provider,provider_event_id,event_type,payload)
            VALUES($1::uuid,$2::uuid,$3::uuid,'system','historical', $4,'{}')`,
        [historicalId, tenantId, subscriptionId, BillingEventType.PAYMENT_FAILED]);
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260913190000_extend_platform_notifications_for_billing/migration.sql'), 'utf8'));
        await admin.query(`INSERT INTO billing_events(id,tenant_id,subscription_id,provider,provider_event_id,event_type,payload)
            VALUES($1::uuid,$2::uuid,$3::uuid,'wompi','payment-new',$4,$5::jsonb)`,
        [eventId, tenantId, subscriptionId, BillingEventType.PAYMENT_SUCCEEDED, JSON.stringify({ source: 'webhook' })]);
        await admin.query(`INSERT INTO billing_payments(id,tenant_id,status,amount_cents,currency)
            VALUES($1::uuid,$2::uuid,'succeeded',129900,'COP')`, [randomUUID(), tenantId]);
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    });

    afterAll(async () => {
        await admin.query('DELETE FROM platform_notification_outbox WHERE tenant_id=$1::uuid', [tenantId]).catch(() => undefined);
        await admin.query('DELETE FROM billing_payments WHERE tenant_id=$1::uuid', [tenantId]).catch(() => undefined);
        await admin.query('DELETE FROM billing_events WHERE tenant_id=$1::uuid', [tenantId]).catch(() => undefined);
        await admin.query('DELETE FROM billing_subscriptions WHERE id=$1::uuid', [subscriptionId]).catch(() => undefined);
        await admin.query('DELETE FROM billing_plans WHERE id=$1::uuid', [planId]).catch(() => undefined);
        await admin.query('DELETE FROM users WHERE id=$1::uuid', [userId]).catch(() => undefined);
        await admin.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]).catch(() => undefined);
        await client?.$disconnect();
        await admin.end();
    });

    it('does not replay history and reconstructs a new event without relying on EventEmitter', async () => {
        const service = new BillingEmailService(prisma, { runExclusive: jest.fn() } as any);
        await expect(service.recoverPending()).resolves.toBe(1);
        const [historical] = await prisma.$queryRawUnsafe(
            'SELECT notification_outbox_created_at FROM billing_events WHERE id=$1::uuid', historicalId);
        expect(historical.notification_outbox_created_at).toBeInstanceOf(Date);
        const [row] = await prisma.$queryRawUnsafe(`SELECT state,recipient_email,payload
            FROM platform_notification_outbox WHERE entity_id=$1::uuid`, eventId);
        expect(row.state).toBe('pending');
        expect(row.recipient_email).toBe(`billing-${tenantId}@example.test`);
        expect(row.payload.subject).toEqual(expect.any(String));
        expect(row.payload.html).toContain('1299.00 COP');
        await expect(service.enqueueEvent(eventId)).resolves.toBe('already_admitted');
        expect((await prisma.$queryRawUnsafe(
            'SELECT id FROM platform_notification_outbox WHERE entity_id=$1::uuid', eventId))).toHaveLength(1);
    });

    it('stores one SMTP acceptance and erases the intent with its tenant', async () => {
        const send = jest.fn().mockResolvedValue('smtp-billing-accepted');
        const delivery = new PlatformNotificationOutboxService(prisma,
            { prepareBoundedSend: jest.fn().mockReturnValue(send) } as any,
            { get: (_key: string, fallback: string) => fallback } as any,
            { runExclusive: jest.fn() } as any);
        const [row] = await prisma.$queryRawUnsafe(
            'SELECT id FROM platform_notification_outbox WHERE entity_id=$1::uuid', eventId);
        await expect(delivery.deliver(row.id)).resolves.toBe('notification:sent');
        await expect(delivery.deliver(row.id)).resolves.toBe('notification:sent');
        expect(send).toHaveBeenCalledTimes(1);
        const [settled] = await prisma.$queryRawUnsafe(
            'SELECT state,provider_reference FROM platform_notification_outbox WHERE id=$1::uuid', row.id);
        expect(settled).toEqual({ state: 'sent', provider_reference: 'smtp-billing-accepted' });

        await admin.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]);
        expect((await prisma.$queryRawUnsafe(
            'SELECT id FROM platform_notification_outbox WHERE id=$1::uuid', row.id))).toHaveLength(0);
    });
});
