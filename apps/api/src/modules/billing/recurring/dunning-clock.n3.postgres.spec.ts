import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DunningService, DUNNING_EXPIRY_DAY, DUNNING_SOFT_LOCK_DAY } from './dunning.service';
import { BillingEventType } from '../types/billing-event.enum';
import { ensureSyntheticGlobalTables } from '../../../common/__fixtures__/synthetic-global-tables';
import { isDisposableDatabaseUrl } from '../../../common/__fixtures__/disposable-database';

/**
 * N3 · AUT-C47 — the dunning ladder on a SEEDED clock, real Prisma models over
 * real PostgreSQL: soft-lock on day 3, expiry on day 10, never while a charge is
 * still in play.
 *
 * `advanceWaitingStates(now)` takes the clock as a parameter; nothing here waits.
 * Oracles: billing_subscriptions.status / dunning_state, tenants.subscription_status,
 * public.billing_events and the domain events emitted (a recorder, no mail is sent).
 *
 * The shared synthetic `public.tenants` is widened ADDITIVELY with the remaining
 * columns of the Prisma `Tenant` model (`ADD COLUMN IF NOT EXISTS`), because
 * `tx.tenant.update` returns the whole row.
 */
const url = process.env.PARALLLY_ISOLATION_TEST_URL;

(url ? describe : describe.skip)('N3 AUT-C47: dunning soft-lock on day 3, expiry on day 10', () => {
    jest.setTimeout(120_000);
    let client: PrismaClient;
    let service: any;
    const emitted: Array<{ name: string; payload: any }> = [];
    const DAY = 86_400_000;
    const T = new Date('2026-09-01T12:00:00.000Z');
    const created: Array<{ tenantId: string; subscriptionId: string }> = [];

    const TENANT_COLUMNS = ['name TEXT', 'slug TEXT', 'industry TEXT', "language TEXT DEFAULT 'es-CO'", "plan TEXT DEFAULT 'starter'",
        "settings JSONB DEFAULT '{}'::jsonb", 'is_internal BOOLEAN DEFAULT false', 'operating_currency VARCHAR(3)',
        'operating_currency_locked_at TIMESTAMPTZ', 'operating_country VARCHAR(2)', 'operating_timezone VARCHAR(64)',
        'default_locale VARCHAR(35)', 'phone_region VARCHAR(2)', 'address_schema_id VARCHAR(16)', 'country_pack_id VARCHAR(16)',
        'country_pack_version VARCHAR(16)', "regional_provenance JSONB DEFAULT '{}'::jsonb", 'billing_email TEXT',
        'billing_country TEXT', 'subscription_status TEXT', 'trial_ends_at TIMESTAMPTZ', 'current_period_end TIMESTAMPTZ',
        'payment_provider TEXT', 'payment_provider_customer_id TEXT', 'payment_provider_override TEXT',
        'onboarding_completed_at TIMESTAMPTZ', 'first_channel_connected_at TIMESTAMPTZ', 'first_message_at TIMESTAMPTZ',
        'signup_source TEXT', 'created_at TIMESTAMPTZ DEFAULT NOW()', 'updated_at TIMESTAMPTZ DEFAULT NOW()'];

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !isDisposableDatabaseUrl(parsed)) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: url });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        for (const column of TENANT_COLUMNS) await client.$executeRawUnsafe(`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ${column}`);
        await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.billing_events(
            id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, tenant_id UUID, subscription_id UUID, provider TEXT NOT NULL,
            provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL, payload JSONB NOT NULL, processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await client.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS billing_events_provider_provider_event_id_key ON public.billing_events(provider, provider_event_id)');
        await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.billing_charge_attempts(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id UUID NOT NULL, tenant_id UUID NOT NULL, purpose TEXT NOT NULL,
            cycle_key TEXT NOT NULL, attempt_number INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, provider TEXT NOT NULL,
            payment_source_id UUID, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, fx_rate DECIMAL(18,6), amount_usd_cents INTEGER,
            reference TEXT NOT NULL, provider_txn_id TEXT, provider_status TEXT, failure_code TEXT, failure_class TEXT,
            period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, sent_at TIMESTAMPTZ,
            settled_at TIMESTAMPTZ, next_retry_at TIMESTAMPTZ, checkout_url TEXT, checkout_expires_at TIMESTAMPTZ, payment_id UUID,
            metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        service = Object.create(DunningService.prototype);
        Object.assign(service, {
            prisma: client, engine: {}, renewalQueue: {}, cronLock: {}, redis: { del: async () => 1 },
            eventEmitter: { emit: (name: string, payload: any) => { emitted.push({ name, payload }); } },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });
    afterAll(async () => {
        if (!client) return;
        try {
            for (const row of created) {
                await client.$executeRawUnsafe('DELETE FROM public.billing_charge_attempts WHERE subscription_id=$1::uuid', row.subscriptionId);
                await client.$executeRawUnsafe('DELETE FROM public.billing_events WHERE subscription_id=$1::uuid', row.subscriptionId);
                await client.$executeRawUnsafe('DELETE FROM public.billing_subscriptions WHERE id=$1::uuid', row.subscriptionId);
                await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', row.tenantId);
            }
        } finally { await client.$disconnect(); }
    });
    beforeEach(() => { emitted.length = 0; });

    /** A tenant whose card failed at T: grace period, internal engine, service still on. */
    const failingSubscription = async (over: { engine?: string; dunningState?: string } = {}) => {
        const tenantId = randomUUID(), subscriptionId = randomUUID(), schema = `tenant_dun_${tenantId.replace(/-/g, '')}`;
        await client.$executeRawUnsafe(`INSERT INTO public.tenants(id,schema_name,is_active,name,slug,industry,subscription_status,language,plan,settings,is_internal,regional_provenance,created_at,updated_at)
            VALUES($1::uuid,$2,true,'Dunning N3',$3,'services','active','es-CO','starter','{}'::jsonb,false,'{}'::jsonb,NOW(),NOW())`, tenantId, schema, `dun-${tenantId}`);
        await client.$executeRawUnsafe(`INSERT INTO public.billing_subscriptions(id,tenant_id,plan_id,status,provider,engine,dunning_state,dunning_started_at,dunning_attempts)
            VALUES($1::uuid,$2::uuid,$3::uuid,'past_due','wompi',$4,$5,$6::timestamptz,1)`,
        subscriptionId, tenantId, randomUUID(), over.engine ?? 'internal', over.dunningState ?? 'grace', T.toISOString());
        created.push({ tenantId, subscriptionId });
        return { tenantId, subscriptionId };
    };
    const state = async (subscriptionId: string, tenantId: string) => {
        const [sub] = await client.$queryRawUnsafe<any[]>('SELECT status,dunning_state FROM public.billing_subscriptions WHERE id=$1::uuid', subscriptionId);
        const [tenant] = await client.$queryRawUnsafe<any[]>('SELECT subscription_status FROM public.tenants WHERE id=$1::uuid', tenantId);
        return { status: sub.status, dunning: sub.dunning_state, tenant: tenant.subscription_status };
    };
    const events = (subscriptionId: string) => client.$queryRawUnsafe<any[]>(
        'SELECT event_type FROM public.billing_events WHERE subscription_id=$1::uuid ORDER BY processed_at', subscriptionId);
    const at = (days: number, extraHours = 0) => new Date(T.getTime() + days * DAY + extraHours * 3_600_000);

    it('the constants are the ladder the product promises: day 3 and day 10', () => {
        expect(DUNNING_SOFT_LOCK_DAY).toBe(3);
        expect(DUNNING_EXPIRY_DAY).toBe(10);
    });

    it('does nothing before day 3, soft-locks at day 3 (not before), expires at day 10 (not before), each exactly once', async () => {
        const s = await failingSubscription();
        const sweep = (now: Date) => service.advanceWaitingStates(now);

        // Day 2, 23h: still grace. The first days are pure retries with the service untouched.
        await sweep(at(2, 23));
        expect(await state(s.subscriptionId, s.tenantId)).toEqual({ status: 'past_due', dunning: 'grace', tenant: 'active' });
        expect(await events(s.subscriptionId)).toEqual([]);

        // Day 4: soft lock.
        await sweep(at(4));
        expect(await state(s.subscriptionId, s.tenantId)).toEqual({ status: 'past_due', dunning: 'soft_lock', tenant: 'past_due' });
        expect(await events(s.subscriptionId)).toEqual([{ event_type: 'billing.subscription.soft_locked' }]);
        expect(emitted.filter(e => e.name === 'billing.subscription.soft_locked' && e.payload.subscriptionId === s.subscriptionId)).toHaveLength(1);

        // The same sweep again does not lock twice.
        await sweep(at(4, 6));
        expect(await events(s.subscriptionId)).toHaveLength(1);

        // Day 9, 23h: still soft-locked, not expired.
        await sweep(at(9, 23));
        expect((await state(s.subscriptionId, s.tenantId)).status).toBe('past_due');

        // Day 11: expired, once.
        await sweep(at(11));
        expect(await state(s.subscriptionId, s.tenantId)).toEqual({ status: 'expired', dunning: 'suspended', tenant: 'expired' });
        expect((await events(s.subscriptionId)).map(e => e.event_type)).toEqual(['billing.subscription.soft_locked', BillingEventType.SUBSCRIPTION_EXPIRED]);
        expect(emitted.filter(e => e.name === BillingEventType.SUBSCRIPTION_EXPIRED && e.payload.subscriptionId === s.subscriptionId)).toHaveLength(1);
        await sweep(at(12));
        expect(await events(s.subscriptionId)).toHaveLength(2);
    });

    it('a charge still in play blocks the expiry; once it is settled the next sweep expires', async () => {
        const s = await failingSubscription({ dunningState: 'soft_lock' });
        await client.$executeRawUnsafe(`INSERT INTO public.billing_charge_attempts(subscription_id,tenant_id,purpose,cycle_key,status,provider,
                amount_cents,currency,reference,period_start,period_end,scheduled_at)
            VALUES($1::uuid,$2::uuid,'renewal',$3,'in_flight','wompi',100000,'COP',$4,$5::timestamptz,$6::timestamptz,$5::timestamptz)`,
        s.subscriptionId, s.tenantId, `${s.subscriptionId}.20260901.renewal`, `ref-${s.subscriptionId}`, T.toISOString(), at(30).toISOString());

        const blocked = await service.advanceWaitingStates(at(11));
        expect(blocked.expired).toBe(0);
        expect((await state(s.subscriptionId, s.tenantId)).status).toBe('past_due');

        await client.$executeRawUnsafe("UPDATE public.billing_charge_attempts SET status='failed' WHERE subscription_id=$1::uuid", s.subscriptionId);
        await service.advanceWaitingStates(at(11, 1));
        expect(await state(s.subscriptionId, s.tenantId)).toMatchObject({ status: 'expired', tenant: 'expired' });
    });

    it('a provider-driven subscription is never touched by the internal ladder', async () => {
        const s = await failingSubscription({ engine: 'provider' });
        await service.advanceWaitingStates(at(11));
        expect(await state(s.subscriptionId, s.tenantId)).toEqual({ status: 'past_due', dunning: 'grace', tenant: 'active' });
        expect(await events(s.subscriptionId)).toEqual([]);
    });
});
