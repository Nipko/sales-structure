import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { LATEST_SIGNUP_WARNINGS_SQL, readSignupWarnings } from './whatsapp-signup-warnings';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * The status endpoint's signup warnings, against real PostgreSQL: the query is
 * a `DISTINCT ON` over a table whose `tenant_id` is TEXT, reading one key out of
 * a JSONB column that also holds the Embedded Signup's long-lived token. A
 * double cannot say whether the casts hold, whether "latest" is the latest, or
 * whether anything but the warnings leaves the database.
 */
(databaseUrl ? describe : describe.skip)('latest signup warnings per number (PostgreSQL)', () => {
    const run = randomUUID().replace(/-/g, '').slice(0, 10);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const phone = (n: number) => `9${n}00${run}`;
    let client: PrismaClient;

    const insert = (row: {
        tenantId: string; phoneNumberId: string; status: string; wabaId?: string;
        warnings?: unknown; completedAt?: string | null; createdAt?: string;
    }) => client.$executeRawUnsafe(
        `INSERT INTO public.whatsapp_onboardings
            (tenant_id, config_id, status, waba_id, phone_number_id, exchange_payload, completed_at, created_at)
         VALUES ($1, 'cfg', $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)`,
        row.tenantId, row.status, row.wabaId ?? 'waba-1', row.phoneNumberId,
        JSON.stringify({ longLivedToken: 'EAAG-secret-token', warnings: row.warnings ?? [] }),
        row.completedAt ?? null, row.createdAt ?? '2026-09-01T00:00:00Z',
    );

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        // The table as the init migration creates it (20260301000000_init).
        // Additive: another suite's copy is never replaced.
        await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.whatsapp_onboardings (
            id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
            tenant_id TEXT NOT NULL, config_id TEXT NOT NULL DEFAULT '',
            mode TEXT NOT NULL DEFAULT 'new', status TEXT NOT NULL DEFAULT 'CREATED',
            is_coexistence BOOLEAN NOT NULL DEFAULT false, coexistence_acknowledged BOOLEAN NOT NULL DEFAULT false,
            meta_business_id TEXT, waba_id TEXT, phone_number_id TEXT, display_phone_number TEXT, verified_name TEXT,
            exchange_payload JSONB, error_code TEXT, error_message TEXT, started_by_user_id TEXT,
            code_received_at TIMESTAMPTZ, exchange_completed_at TIMESTAMPTZ, assets_synced_at TIMESTAMPTZ,
            webhook_validated_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

        // phone 1: warned first, then a clean signup — the clean one is latest.
        await insert({ tenantId: tenantA, phoneNumberId: phone(1), status: 'COMPLETED_WITH_WARNINGS',
            warnings: ['webhook_subscription_failed'], completedAt: '2026-09-10T10:00:00Z' });
        await insert({ tenantId: tenantA, phoneNumberId: phone(1), status: 'COMPLETED', completedAt: '2026-09-12T10:00:00Z' });
        // phone 2: warned, then a later attempt that FAILED — a failure is not a signup of this connection.
        await insert({ tenantId: tenantA, phoneNumberId: phone(2), status: 'COMPLETED_WITH_WARNINGS',
            warnings: ['phone_registration_deferred', 'La verificación…'], completedAt: '2026-09-11T10:00:00Z' });
        await insert({ tenantId: tenantA, phoneNumberId: phone(2), status: 'FAILED', createdAt: '2026-09-15T10:00:00Z' });
        // phone 3 belongs to ANOTHER tenant, with a warning.
        await insert({ tenantId: tenantB, phoneNumberId: phone(3), status: 'COMPLETED_WITH_WARNINGS',
            warnings: ['phone_registration_deferred'], completedAt: '2026-09-11T10:00:00Z' });
    });

    afterAll(async () => {
        if (!client) return;
        await client.$executeRawUnsafe(
            'DELETE FROM public.whatsapp_onboardings WHERE tenant_id = ANY($1::text[])', [tenantA, tenantB]);
        await client.$disconnect();
    });

    const accounts = (...ids: string[]) => ids.map(accountId => ({
        accountId, metadata: { wabaId: 'waba-1', source: 'embedded_signup' },
    }));

    it('reads the latest completed signup of each number, and only its known codes', async () => {
        const result = await readSignupWarnings(client, tenantA, accounts(phone(1), phone(2)));

        expect(result?.get(phone(1))).toEqual({ codes: [], recordedAt: '2026-09-12T10:00:00.000Z' });
        expect(result?.get(phone(2))).toEqual({
            codes: ['phone_registration_deferred'], recordedAt: '2026-09-11T10:00:00.000Z',
        });
    });

    it('never answers about another tenant\'s number, even when asked for it', async () => {
        const result = await readSignupWarnings(client, tenantA, accounts(phone(3)));

        expect(result?.get(phone(3))).toEqual({ codes: [], recordedAt: null });
        const theirs = await readSignupWarnings(client, tenantB, accounts(phone(3)));
        expect(theirs?.get(phone(3))?.codes).toEqual(['phone_registration_deferred']);
    });

    it('returns the warnings and never the token that shares their column', async () => {
        const rows = await client.$queryRawUnsafe(LATEST_SIGNUP_WARNINGS_SQL, tenantA, [phone(2)]) as any[];

        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).not.toContain('EAAG-secret-token');
        expect(Object.keys(rows[0]).sort()).toEqual(['completed_at', 'phone_number_id', 'waba_id', 'warnings']);
    });
});
