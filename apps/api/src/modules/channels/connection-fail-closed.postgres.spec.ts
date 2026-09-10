import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelTokenService } from './channel-token.service';
import { WhatsappConnectionService } from '../whatsapp/services/whatsapp-connection.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { isConnectionRefusal } from './connection-refusal';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ A DISCONNECTED NUMBER MUST NOT BE ABLE TO SEND ═══
 *
 * Disconnecting a WhatsApp number deactivated `public.channel_accounts` and
 * revoked the tenant's credential. Neither resolver looked at either: both read
 * `tenant.whatsapp_channels` with no state test and took the newest
 * `system_user_token` with no test of `rotation_state` or `expires_at`. A
 * disconnected number kept sending, with a revoked token, on a WABA whose owner
 * may have revoked our access deliberately.
 *
 * There are TWO resolvers and they are reached by different routes — the
 * channels gateway and the WhatsApp service's own surfaces — so every case here
 * runs against BOTH against the same schema. A rule enforced in one of them is
 * a rule with a way around it.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('a connection that may not send is refused by both resolvers', () => {
    const run = randomUUID().replace(/-/g, '');
    const tenantId = randomUUID();
    const schema = `tenant_failclosed_${run}`;
    const NUMBER = `1000${run.slice(0, 8)}`;
    const OTHER = `2000${run.slice(0, 8)}`;

    let client: PrismaClient;
    let prisma: any;
    let tokens: ChannelTokenService;
    let connections: WhatsappConnectionService;
    let previousKey: string | undefined;
    jest.setTimeout(120_000);

    /** The suite pins its own key so the AES path runs, not the DEV base64 one. */
    const KEY = 'b'.repeat(64);

    /** Redis is not the subject here; every read is a miss and every write a no-op. */
    const redis = {
        getJson: async () => null, setJson: async () => undefined, del: async () => undefined,
        getClient: () => ({
            sadd: async () => 1, expire: async () => 1, smembers: async () => [] as string[],
            srem: async () => 1,
        }),
    };

    const sql = (text: string, params: any[] = []) => prisma.executeInTenantSchema(schema, text, params);

    const outcome = async (pending: Promise<any>) => {
        try {
            const value = await pending;
            return `resolved:${value?.phoneNumberId ?? value?.accountId ?? '?'}`;
        } catch (error: any) {
            return `refused:${error?.code ?? error?.message ?? 'unknown'}`;
        }
    };

    /** Both resolvers, asked the same question, must answer the same way. */
    const bothAsked = async (phoneNumberId?: string) => ({
        gateway: await outcome(tokens.getChannelToken(tenantId, 'whatsapp', phoneNumberId)),
        whatsapp: await outcome(connections.getValidAccessToken(schema, phoneNumberId)),
    });

    const setStatus = (phoneNumberId: string, status: string) =>
        sql(`UPDATE whatsapp_channels SET channel_status = $2 WHERE phone_number_id = $1`,
            [phoneNumberId, status]);

    beforeAll(async () => {
        previousKey = process.env.ENCRYPTION_KEY;
        process.env.ENCRYPTION_KEY = KEY;
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        prisma = client as any;
        prisma.getTenantSchemaName = async () => schema;
        prisma.executeInTenantSchema = async (_schema: string, text: string, params: any[] = []) =>
            client.$queryRawUnsafe(text.replace(/\bwhatsapp_channels\b/g, `"${schema}".whatsapp_channels`), ...params);

        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await ensureSyntheticGlobalTables(sqlText => client.$executeRawUnsafe(sqlText));
        await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.whatsapp_credentials(
            id UUID PRIMARY KEY, tenant_id UUID, credential_type TEXT, encrypted_value TEXT,
            rotation_state TEXT DEFAULT 'active', expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${schema}".whatsapp_channels(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider_type TEXT,
            meta_business_id TEXT, meta_waba_id TEXT, phone_number_id TEXT,
            display_phone_number TEXT, display_name TEXT, access_token_ref TEXT,
            channel_status TEXT DEFAULT 'pending', connected_at TIMESTAMPTZ DEFAULT NOW())`);

        await client.$executeRawUnsafe(
            `INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)
             ON CONFLICT (id) DO NOTHING`, tenantId, schema);
        for (const [number, when] of [[NUMBER, '2026-01-01'], [OTHER, '2026-02-01']] as const) {
            await client.$executeRawUnsafe(
                `INSERT INTO "${schema}".whatsapp_channels
                    (meta_waba_id, phone_number_id, display_phone_number, access_token_ref,
                     channel_status, connected_at)
                 VALUES($1,$2,$3,'credential_ref','connected',$4::timestamptz)`,
                `WABA-${number}`, number, `+${number}`, when);
            await client.$executeRawUnsafe(
                `INSERT INTO public.channel_accounts(id, tenant_id, channel_type, account_id, is_active)
                 VALUES(gen_random_uuid(),$1::uuid,'whatsapp',$2,true)`, tenantId, number);
        }

        const crypto = new WhatsappCryptoService();
        await client.$executeRawUnsafe(
            `INSERT INTO public.whatsapp_credentials(id, tenant_id, credential_type, encrypted_value, rotation_state)
             VALUES(gen_random_uuid(),$1::uuid,'system_user_token',$2,'active')`,
            tenantId, crypto.encryptToken('SYSTEM-USER-TOKEN'));

        tokens = new ChannelTokenService(prisma, redis as any, crypto as any);
        connections = new WhatsappConnectionService(prisma, crypto, { get: () => undefined } as any, {} as any);
    });

    afterAll(async () => {
        if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = previousKey;
        if (!client) return;
        try {
            if (!/^tenant_failclosed_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
            await client.$executeRawUnsafe('DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid', tenantId);
            await client.$executeRawUnsafe('DELETE FROM public.whatsapp_credentials WHERE tenant_id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await sql(`UPDATE whatsapp_channels SET channel_status = 'connected'`);
        await client.$executeRawUnsafe(
            `UPDATE public.channel_accounts SET is_active = true WHERE tenant_id=$1::uuid`, tenantId);
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET rotation_state='active', expires_at=NULL
              WHERE tenant_id=$1::uuid`, tenantId);
    });

    it('serves a live connection, so the refusals below are not a broken fixture', async () => {
        expect(await bothAsked(NUMBER)).toEqual({
            gateway: `resolved:${NUMBER}`, whatsapp: `resolved:${NUMBER}`,
        });
    });

    it.each(['disconnected', 'pending', 'restricted', ''])(
        'refuses a number whose channel_status is "%s"', async status => {
            // Fail closed on anything that is not `connected`, including a status
            // this code has never heard of: a state nobody reasoned about is not
            // a state to spend money in.
            await setStatus(NUMBER, status);
            expect(await bothAsked(NUMBER)).toEqual({
                gateway: 'refused:connection_disconnected',
                whatsapp: 'refused:connection_disconnected',
            });
        });

    it('refuses when the global account row was deactivated by the disconnect', async () => {
        // The tenant schema still says `connected`; the platform-level row does
        // not. Asking only the first one is how a disconnect kept sending.
        await client.$executeRawUnsafe(
            `UPDATE public.channel_accounts SET is_active = false
              WHERE tenant_id=$1::uuid AND account_id=$2`, tenantId, NUMBER);
        expect(await bothAsked(NUMBER)).toEqual({
            gateway: 'refused:connection_disconnected',
            whatsapp: 'refused:connection_disconnected',
        });
    });

    it.each(['revoked', 'rotating'])('refuses a credential whose rotation_state is "%s"', async state => {
        // `rotating` is refused for the same reason as `revoked`: the replacement
        // may already be the live one at Meta, and signing with the outgoing half
        // fails after the money is committed.
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET rotation_state=$2 WHERE tenant_id=$1::uuid`,
            tenantId, state);
        expect(await bothAsked(NUMBER)).toEqual({
            gateway: 'refused:credential_revoked', whatsapp: 'refused:credential_revoked',
        });
    });

    it('refuses a credential whose own expiry has passed', async () => {
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET expires_at = NOW() - INTERVAL '1 minute'
              WHERE tenant_id=$1::uuid`, tenantId);
        expect(await bothAsked(NUMBER)).toEqual({
            gateway: 'refused:credential_expired', whatsapp: 'refused:credential_expired',
        });
    });

    it('serves a credential that expires in the future', async () => {
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET expires_at = NOW() + INTERVAL '1 hour'
              WHERE tenant_id=$1::uuid`, tenantId);
        expect(await bothAsked(NUMBER)).toEqual({
            gateway: `resolved:${NUMBER}`, whatsapp: `resolved:${NUMBER}`,
        });
    });

    describe('what an unnamed request resolves to', () => {
        it('is ambiguous while two numbers can send', async () => {
            expect(await bothAsked()).toEqual({
                gateway: 'refused:connection_ambiguous', whatsapp: 'refused:connection_ambiguous',
            });
        });

        it('resolves the one that can send when the other is disconnected', async () => {
            // A disconnected sibling is not a candidate, so the tenant is not
            // punished with `connection_ambiguous` for having disconnected one.
            await setStatus(OTHER, 'disconnected');
            expect(await bothAsked()).toEqual({
                gateway: `resolved:${NUMBER}`, whatsapp: `resolved:${NUMBER}`,
            });
        });

        it('says disconnected, not absent, when every number is disconnected', async () => {
            // The two need different codes because they need different fixes:
            // one is "reconnect it", the other is "connect something".
            await sql(`UPDATE whatsapp_channels SET channel_status = 'disconnected'`);
            expect(await bothAsked()).toEqual({
                gateway: 'refused:connection_disconnected',
                whatsapp: 'refused:connection_disconnected',
            });
        });
    });

    it('answers every refusal in the shared vocabulary, never as a bare error', async () => {
        await setStatus(NUMBER, 'disconnected');
        const asked: (() => Promise<unknown>)[] = [
            () => tokens.getChannelToken(tenantId, 'whatsapp', NUMBER),
            () => connections.getValidAccessToken(schema, NUMBER),
        ];
        for (const ask of asked) {
            try { await ask(); throw new Error('should have refused'); } catch (error) {
                // A refusal a dashboard can render, not a 500 that reads as
                // "the platform is broken" for a tenant who disconnected on
                // purpose.
                expect(isConnectionRefusal(error)).toBe(true);
                expect((error as any).getStatus()).toBe(409);
            }
        }
    });
});
