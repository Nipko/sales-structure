import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { ServiceUnavailableException } from '@nestjs/common';
import { WOMPI_CAPABILITIES } from '../adapters/provider-capabilities';
import { PaymentSourceService } from './payment-source.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('payment-source provider effects against PostgreSQL', () => {
    const tenantId = randomUUID();
    const schema = `tenant_billing_effect_${tenantId.replace(/-/g, '')}`;
    let admin: Client;
    let client: PrismaClient;
    let cache: Map<string, string>;
    let charging: any;
    let service: PaymentSourceService;

    jest.setTimeout(120_000);

    const jwt = (claims: Record<string, unknown>) => [
        Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
        Buffer.from(JSON.stringify(claims)).toString('base64url'),
        'signature',
    ].join('.');
    const contracts = {
        endUserPolicy: {
            token: jwt({ jti: 'policy-jti', file_hash: 'policy-v1' }),
            permalink: 'https://example.test/policy-v1',
            type: 'END_USER_POLICY',
        },
        personalDataAuth: {
            token: jwt({ jti: 'personal-jti', file_hash: 'personal-v1' }),
            permalink: 'https://example.test/personal-v1',
            type: 'PERSONAL_DATA_AUTH',
        },
    };

    beforeAll(async () => {
        const parsed = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        admin = new Client({ connectionString: databaseUrl });
        await admin.connect();
        // This suite shares the worker database with other PostgreSQL specs.
        // Widen only the three tables it needs; replaying the historical billing
        // migration here would make unrelated skinny fixtures order-dependent.
        await admin.query(`CREATE TABLE IF NOT EXISTS billing_payment_sources(id UUID PRIMARY KEY);
            ALTER TABLE billing_payment_sources
                ADD COLUMN IF NOT EXISTS tenant_id UUID,
                ADD COLUMN IF NOT EXISTS provider TEXT,
                ADD COLUMN IF NOT EXISTS provider_source_id TEXT,
                ADD COLUMN IF NOT EXISTS kind TEXT,
                ADD COLUMN IF NOT EXISTS status TEXT,
                ADD COLUMN IF NOT EXISTS supports_unattended BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS brand TEXT,
                ADD COLUMN IF NOT EXISTS last4 TEXT,
                ADD COLUMN IF NOT EXISTS holder_name TEXT,
                ADD COLUMN IF NOT EXISTS exp_month INTEGER,
                ADD COLUMN IF NOT EXISTS exp_year INTEGER,
                ADD COLUMN IF NOT EXISTS phone_masked TEXT,
                ADD COLUMN IF NOT EXISTS acceptance_jti TEXT,
                ADD COLUMN IF NOT EXISTS acceptance_file_hash TEXT,
                ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS accepted_ip TEXT,
                ADD COLUMN IF NOT EXISTS auth_token_id TEXT,
                ADD COLUMN IF NOT EXISTS auth_url TEXT,
                ADD COLUMN IF NOT EXISTS auth_expires_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
            CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_sources_provider_source_key
                ON billing_payment_sources(provider, provider_source_id);
            CREATE TABLE IF NOT EXISTS billing_charge_attempts(id UUID PRIMARY KEY);
            ALTER TABLE billing_charge_attempts
                ADD COLUMN IF NOT EXISTS tenant_id UUID,
                ADD COLUMN IF NOT EXISTS provider TEXT,
                ADD COLUMN IF NOT EXISTS payment_source_id UUID,
                ADD COLUMN IF NOT EXISTS status TEXT,
                ADD COLUMN IF NOT EXISTS reference TEXT,
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            CREATE TABLE IF NOT EXISTS billing_subscriptions(id UUID PRIMARY KEY);
            ALTER TABLE billing_subscriptions
                ADD COLUMN IF NOT EXISTS tenant_id UUID,
                ADD COLUMN IF NOT EXISTS plan_id UUID,
                ADD COLUMN IF NOT EXISTS provider TEXT,
                ADD COLUMN IF NOT EXISTS default_payment_source_id UUID,
                ADD COLUMN IF NOT EXISTS unattended_capable BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
        await admin.query(readFileSync(join(
            __dirname,
            '../../../../prisma/migrations/20260914050000_add_billing_provider_effect_ledger/migration.sql',
        ), 'utf8'));
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(
            `INSERT INTO tenants(id, schema_name)
             VALUES($1::uuid, $2)
             ON CONFLICT (id) DO NOTHING`,
            tenantId,
            schema,
        );
    });

    afterAll(async () => {
        try {
            if (client) {
                await client.$executeRawUnsafe('DELETE FROM billing_provider_effects WHERE tenant_id = $1::uuid', tenantId);
                await client.$executeRawUnsafe('DELETE FROM billing_payment_sources WHERE tenant_id = $1::uuid', tenantId);
                await client.$executeRawUnsafe('DELETE FROM tenants WHERE id = $1::uuid', tenantId);
            }
        } finally {
            await client?.$disconnect();
            await admin?.end();
        }
    });

    beforeEach(async () => {
        await client.$executeRawUnsafe('DELETE FROM billing_provider_effects WHERE tenant_id = $1::uuid', tenantId);
        await client.$executeRawUnsafe('DELETE FROM billing_payment_sources WHERE tenant_id = $1::uuid', tenantId);
        cache = new Map();
        const redis = {
            setJson: jest.fn(async (key: string, value: unknown) => {
                cache.set(key, JSON.stringify(value));
            }),
            getDel: jest.fn(async (key: string) => {
                const value = cache.get(key) ?? null;
                cache.delete(key);
                return value;
            }),
        };
        charging = {
            getAcceptanceContracts: jest.fn().mockResolvedValue(contracts),
            startPaymentSource: jest.fn(),
            voidPaymentSource: jest.fn(),
        };
        service = new PaymentSourceService(
            client as any,
            redis as any,
            { emit: jest.fn() } as any,
            {
                capabilitiesOf: jest.fn().mockReturnValue(WOMPI_CAPABILITIES),
                getCharging: jest.fn().mockReturnValue(charging),
            } as any,
            {
                getConfig: jest.fn().mockResolvedValue({
                    wompiMethods: { card: true, nequi: true, bancolombiaTransfer: true },
                }),
            } as any,
            {} as any,
            {} as any,
            {} as any,
        );
        jest.spyOn(service as any, 'resolveProvider').mockResolvedValue('wompi');
    });

    const addInput = async () => {
        const challenge = await service.issueAcceptanceChallenge(tenantId);
        return {
            tenantId,
            kind: 'nequi' as const,
            token: `token-${randomUUID()}`,
            customerEmail: 'owner@example.test',
            consentId: challenge.consentId,
            acceptEndUserPolicy: true,
            acceptPersonalDataAuth: true,
        };
    };

    it('freezes an ambiguous create and never sends the same consent twice', async () => {
        const input = await addInput();
        charging.startPaymentSource.mockRejectedValueOnce(new Error('socket closed after write'));

        await expect(service.addPaymentSource(input)).rejects.toThrow('socket closed after write');
        await expect(service.addPaymentSource(input)).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({ error: 'payment_source_creation_indeterminate' }),
        });

        expect(charging.startPaymentSource).toHaveBeenCalledTimes(1);
        const effects = await client.$queryRawUnsafe(
            `SELECT state, attempts, lease_token, request_fingerprint
             FROM billing_provider_effects WHERE tenant_id = $1::uuid`,
            tenantId,
        ) as any[];
        expect(effects).toEqual([expect.objectContaining({
            state: 'unknown',
            attempts: 1,
            lease_token: null,
            request_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        })]);
    });

    it('commits the provider id, local source, and accepted outcome as one receipt', async () => {
        const input = await addInput();
        const providerSourceId = `source-${randomUUID()}`;
        charging.startPaymentSource.mockResolvedValue({
            providerSourceId,
            kind: 'nequi',
            status: 'pending_auth',
            authTokenId: 'auth-1',
        });

        const result = await service.addPaymentSource(input);

        const effects = await client.$queryRawUnsafe(
            `SELECT state, provider_resource_id, local_resource_id, lease_token
             FROM billing_provider_effects WHERE tenant_id = $1::uuid`,
            tenantId,
        ) as any[];
        expect(effects).toEqual([expect.objectContaining({
            state: 'accepted',
            provider_resource_id: providerSourceId,
            local_resource_id: result.id,
            lease_token: null,
        })]);
        await expect(service.addPaymentSource(input)).resolves.toMatchObject({
            id: result.id,
            status: 'pending_auth',
        });
        expect(charging.startPaymentSource).toHaveBeenCalledTimes(1);
    });

    it('keeps an answered provider refusal distinct from a lost response', async () => {
        const input = await addInput();
        charging.startPaymentSource.mockRejectedValue(new ServiceUnavailableException({
            error: 'wompi_request_failed',
            providerStatus: 503,
        }));

        await expect(service.addPaymentSource(input)).rejects.toBeInstanceOf(ServiceUnavailableException);

        const [effect] = await client.$queryRawUnsafe(
            'SELECT state, error FROM billing_provider_effects WHERE tenant_id = $1::uuid',
            tenantId,
        ) as any[];
        expect(effect).toMatchObject({ state: 'rejected', error: 'wompi_request_failed' });
    });

    it('retries an unknown idempotent void under a new lease and finishes locally once', async () => {
        const source = await client.billingPaymentSource.create({
            data: {
                tenantId,
                provider: 'wompi',
                providerSourceId: `source-${randomUUID()}`,
                kind: 'card',
                status: 'available',
                supportsUnattended: true,
            },
        });
        charging.voidPaymentSource
            .mockRejectedValueOnce(new Error('connection reset'))
            .mockResolvedValueOnce(undefined);

        await expect(service.removePaymentSource(tenantId, source.id)).rejects.toThrow('connection reset');
        await expect(service.removePaymentSource(tenantId, source.id)).resolves.toBeUndefined();

        expect(charging.voidPaymentSource).toHaveBeenCalledTimes(2);
        const [effect] = await client.$queryRawUnsafe(
            `SELECT state, attempts, lease_token FROM billing_provider_effects
             WHERE tenant_id = $1::uuid AND effect_type = 'payment_source_void'`,
            tenantId,
        ) as any[];
        expect(effect).toMatchObject({ state: 'accepted', attempts: 2, lease_token: null });
        await expect(client.billingPaymentSource.findUnique({ where: { id: source.id } }))
            .resolves.toMatchObject({ status: 'voided', isDefault: false });
    });
});
