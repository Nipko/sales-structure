import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { InstagramTokenRefreshService } from './instagram-token-refresh.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Instagram token refresh lease against PostgreSQL', () => {
    const tenantId = randomUUID();
    const accountId = `ig-${randomUUID()}`;
    let client: PrismaClient;
    let fetchMock: jest.Mock;

    jest.setTimeout(120_000);

    beforeAll(async () => {
        const parsed = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe(
            `INSERT INTO public.tenants(id, schema_name)
             VALUES($1::uuid, $2)
             ON CONFLICT (id) DO NOTHING`,
            tenantId,
            `tenant_igrefresh_${tenantId.replace(/-/g, '')}`,
        );
    });

    afterAll(async () => {
        if (!client) return;
        try {
            await client.$executeRawUnsafe(
                'DELETE FROM public.channel_accounts WHERE tenant_id = $1::uuid',
                tenantId,
            );
            await client.$executeRawUnsafe(
                'DELETE FROM public.whatsapp_credentials WHERE tenant_id = $1::uuid',
                tenantId,
            );
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id = $1::uuid', tenantId);
        } finally {
            await client.$disconnect();
        }
    });

    beforeEach(async () => {
        fetchMock = jest.fn().mockResolvedValue({
            json: async () => ({ access_token: 'fresh-provider-token', expires_in: 5_184_000 }),
        });
        (global as any).fetch = fetchMock;
        await client.$executeRawUnsafe(
            'DELETE FROM public.channel_accounts WHERE tenant_id = $1::uuid',
            tenantId,
        );
        await client.$executeRawUnsafe(
            `INSERT INTO public.channel_accounts(
                id, tenant_id, channel_type, account_id, display_name, access_token,
                is_active, metadata, token_refresh_state, token_refresh_attempts)
             VALUES(gen_random_uuid(), $1::uuid, 'instagram', $2, 'IG', 'encrypted-old',
                true, jsonb_build_object('tokenExpiresAt', '2026-09-14T00:00:00.000Z'),
                'idle', 0)`,
            tenantId,
            accountId,
        );
    });

    const build = () => new InstagramTokenRefreshService(
        client as any,
        {
            decryptToken: jest.fn().mockReturnValue('old-provider-token'),
            encryptToken: jest.fn().mockReturnValue('encrypted-fresh'),
        } as any,
        { invalidateCache: jest.fn().mockResolvedValue(undefined) } as any,
        {} as any,
        { emit: jest.fn() } as any,
    );

    it('allows one provider call when two workers race for the same account', async () => {
        await Promise.all([
            build().refreshExpiringSoonTokens(),
            build().refreshExpiringSoonTokens(),
        ]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const rows = await client.$queryRawUnsafe<any[]>(
            `SELECT access_token, token_refresh_state, token_refresh_attempts,
                    token_refresh_lease_token, token_refresh_completed_at
             FROM public.channel_accounts
             WHERE tenant_id = $1::uuid AND account_id = $2`,
            tenantId,
            accountId,
        );
        expect(rows).toEqual([expect.objectContaining({
            access_token: 'encrypted-fresh',
            token_refresh_state: 'idle',
            token_refresh_attempts: 1,
            token_refresh_lease_token: null,
            token_refresh_completed_at: expect.any(Date),
        })]);
    });
});
