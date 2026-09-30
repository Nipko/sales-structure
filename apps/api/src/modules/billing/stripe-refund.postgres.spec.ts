import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { StripeRefundService } from './stripe-refund.service';
import { BillingEventType } from './types/billing-event.enum';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Stripe refund operations against PostgreSQL', () => {
    const tenantId = randomUUID();
    const subscriptionId = randomUUID();
    const legacyPaymentId = randomUUID();
    let admin: Client;
    let prisma: PrismaClient;
    let paymentId: string;
    let remote: any[];
    let adapter: any;
    let events: any;
    let service: StripeRefundService;
    jest.setTimeout(120_000);

    beforeAll(async () => {
        const parsed = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        admin = new Client({ connectionString: databaseUrl });
        await admin.connect();
        // Shared worker fixtures are intentionally skinny. Widen columns only;
        // do not replace tables or introduce constraints on another suite's data.
        await admin.query(`CREATE TABLE IF NOT EXISTS billing_payments(id UUID PRIMARY KEY);
            ALTER TABLE billing_payments
                ADD COLUMN IF NOT EXISTS subscription_id UUID,
                ADD COLUMN IF NOT EXISTS tenant_id UUID,
                ADD COLUMN IF NOT EXISTS provider TEXT,
                ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
                ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
                ADD COLUMN IF NOT EXISTS currency TEXT,
                ADD COLUMN IF NOT EXISTS status TEXT,
                ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS failure_reason TEXT,
                ADD COLUMN IF NOT EXISTS invoice_number TEXT,
                ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT,
                ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            CREATE TABLE IF NOT EXISTS billing_events(
                id UUID PRIMARY KEY, tenant_id UUID, subscription_id UUID, provider TEXT NOT NULL,
                provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}',
                processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(provider,provider_event_id));`);
        await admin.query('INSERT INTO tenants(id,schema_name) VALUES($1::uuid,$2)', [tenantId, `tenant_refund_${tenantId.replace(/-/g, '')}`]);
        await admin.query(`INSERT INTO billing_payments(id,tenant_id,subscription_id,provider,provider_payment_id,amount_cents,currency,status,metadata)
            VALUES($1::uuid,$2::uuid,$3::uuid,'stripe',$4,10000,'USD','succeeded',$5::jsonb)`,
        [legacyPaymentId, tenantId, subscriptionId, `in_legacy_${legacyPaymentId}`, JSON.stringify({ refundPendingAmountCents: 1000, refundPendingTotalCents: 1000 })]);
        await admin.query(readFileSync(join(__dirname, '../../../prisma/migrations/20260930010000_add_billing_refund_operations/migration.sql'), 'utf8'));
        prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    });

    afterAll(async () => {
        try {
            await admin?.query('DELETE FROM audit_logs WHERE tenant_id=$1::text', [tenantId]);
            await admin?.query('DELETE FROM billing_events WHERE tenant_id=$1::uuid', [tenantId]);
            await admin?.query('DELETE FROM billing_payments WHERE tenant_id=$1::uuid', [tenantId]);
            await admin?.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]);
        } finally { await prisma?.$disconnect(); await admin?.end(); }
    });

    beforeEach(async () => {
        paymentId = randomUUID();
        await admin.query(`INSERT INTO billing_payments(id,tenant_id,subscription_id,provider,provider_payment_id,amount_cents,currency,status,metadata)
            VALUES($1::uuid,$2::uuid,$3::uuid,'stripe',$4,10000,'USD','succeeded','{"railEnvironment":"sandbox"}')`,
        [paymentId, tenantId, subscriptionId, `in_${paymentId}`]);
        remote = [];
        adapter = {
            getRefundSnapshot: jest.fn(async () => ({ paymentIntentId: `pi_${paymentId}`, amountPaidCents: 10000, currency: 'USD', livemode: false,
                refunds: structuredClone(remote), succeededAmountCents: remote.filter(r => r.status === 'succeeded').reduce((sum, r) => sum + r.amountCents, 0) })),
            refundPayment: jest.fn(async (_id: string, amount: number, context: any) => {
                const refund = { id: `re_${context.operationId}`, operationId: context.operationId, amountCents: amount,
                    currency: 'USD', livemode: false, paymentIntentId: `pi_${paymentId}`, status: 'succeeded' };
                remote.push(refund); return structuredClone(refund);
            }),
        };
        events = { emit: jest.fn() };
        service = new StripeRefundService(prisma as any, adapter, events);
    });

    it('fences two simultaneous new intents with the actual payment lock', async () => {
        const results = await Promise.allSettled([1, 2].map(() => service.refundPayment({ paymentId, requestId: randomUUID(), amountCents: 1000, expectedRefundedAmountCents: 0 })));
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(adapter.refundPayment).toHaveBeenCalledTimes(1);
        expect(await prisma.billingRefundOperation.count({ where: { paymentId } })).toBe(1);
        expect((await prisma.billingPayment.findUniqueOrThrow({ where: { id: paymentId } })).metadata).toMatchObject({ refundedAmountCents: 1000 });
    });

    it('claims a repeated request once and returns its receipt after completion', async () => {
        const input = { paymentId, requestId: randomUUID(), amountCents: 1000 };
        await Promise.all([service.refundPayment(input), service.refundPayment(input)]);
        expect((await service.refundPayment(input)).status).toBe('succeeded');
        expect(adapter.refundPayment).toHaveBeenCalledTimes(1);
        expect(await prisma.billingRefundOperation.count({ where: { paymentId } })).toBe(1);
    });

    it('settles a webhook racing the accepted HTTP request once, with monotonic accounting', async () => {
        let accepted!: () => void;
        let release!: () => void;
        const acceptedSignal = new Promise<void>(resolve => { accepted = resolve; });
        const releaseSignal = new Promise<void>(resolve => { release = resolve; });
        const original = adapter.refundPayment.getMockImplementation();
        adapter.refundPayment.mockImplementationOnce(async (...args: any[]) => {
            const receipt = await original(...args); accepted(); await releaseSignal; return receipt;
        });
        const input = { paymentId, requestId: randomUUID(), amountCents: 1000 };
        const sending = service.refundPayment(input);
        await acceptedSignal;
        try {
            await service.handleEvent({ provider: 'stripe', providerEventId: randomUUID(), providerPaymentId: `in_${paymentId}`,
                type: BillingEventType.PAYMENT_REFUNDED, occurredAt: new Date(), rawPayload: { type: 'refund.updated' } });
        } finally { release(); }
        expect((await sending).status).toBe('succeeded');
        expect(events.emit).toHaveBeenCalledTimes(1);
        expect((await prisma.billingPayment.findUniqueOrThrow({ where: { id: paymentId } })).metadata).toMatchObject({ refundedAmountCents: 1000 });
        expect(adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('recovers an accepted refund after process loss using only persisted identity', async () => {
        const original = adapter.refundPayment.getMockImplementation();
        adapter.refundPayment.mockImplementationOnce(async (...args: any[]) => { await original(...args); throw new Error('response lost'); });
        const input = { paymentId, requestId: randomUUID(), amountCents: 1000 };
        expect((await service.refundPayment(input)).status).toBe('pending');
        const restarted = new StripeRefundService(prisma as any, adapter, events);
        expect((await restarted.refundPayment(input)).status).toBe('succeeded');
        expect(adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('imports legacy uncertain refunds without arming a replacement POST', async () => {
        const operation = await prisma.billingRefundOperation.findFirstOrThrow({ where: { paymentId: legacyPaymentId } });
        expect(operation).toMatchObject({ status: 'needs_review', errorCode: 'stripe_refund_legacy_pending', firstSubmittedAt: null });
        await expect(service.refundPayment({ paymentId: legacyPaymentId, requestId: randomUUID(), amountCents: 1000 }))
            .rejects.toMatchObject({ response: { error: 'refund_in_progress' } });
        expect(adapter.refundPayment).not.toHaveBeenCalled();
    });
});
