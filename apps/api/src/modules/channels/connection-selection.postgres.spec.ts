import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { isOutboundSendContext, sameSendContext } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { ChannelTokenService } from './channel-token.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;

/**
 * ═══ THE CONNECTION A CALLER ASKED FOR IS THE ONLY ONE IT MAY GET ═══
 *
 * From 1 October 2026 Meta charges per delivered WhatsApp service message, and
 * the bill goes to the BUSINESS's own WhatsApp Business Account. So "which
 * number sent this" stopped being a display detail and became "whose card was
 * charged". A resolver that answers a request for number B with number A is no
 * longer a cosmetic inaccuracy: it spends a different WABA's money, and the
 * customer sees the message arrive from a number they never wrote to.
 *
 * Two separate ways that happened, both reproduced here against real PostgreSQL
 * and real Redis, with two tenants holding two numbers each — because a defect
 * that only shows up on the second connection is invisible on every fixture
 * that has one:
 *
 *   1. SUBSTITUTION. `getWhatsAppToken(tenant, number)` looked the number up,
 *      found nothing, and then ran a second query with no number in it at all —
 *      `ORDER BY connected_at ASC LIMIT 1`, the tenant's oldest connection. It
 *      logged a warning and returned those credentials as though they were the
 *      ones requested. Same shape when no number is named on a tenant that has
 *      two: one of them is picked, silently, and which one is a property of the
 *      row order rather than of anything the caller decided.
 *
 *   2. AN INCOMPATIBLE CACHED ANSWER. The 5-minute Redis entry was trusted
 *      whole. Nothing compared the account inside the cached value with the
 *      account the caller asked for, so an entry written under one account's key
 *      holding another account's credentials was served verbatim; and a
 *      disconnect that did not name the account left that account's token live
 *      and answering for the full TTL.
 *
 * What replaces both: a named connection resolves to itself or to a refusal
 * with a stable code. There is no third outcome. An unnamed connection resolves
 * only when the tenant has exactly one — which is what "the tenant's number"
 * ever honestly meant — and is a refusal, not a coin flip, when it has more.
 */
const enabled = !!databaseUrl && !!redisUrl;

(enabled ? describe : describe.skip)('connection selection: exact, or refused', () => {
    const run = randomUUID().replace(/-/g, '');
    const tenantA = { id: randomUUID(), schema: `tenant_connsel_${run}_a` };
    const tenantB = { id: randomUUID(), schema: `tenant_connsel_${run}_b` };

    /** Two numbers each, so "the tenant's number" has no single referent. */
    const numbers = {
        a1: `1000${run.slice(0, 8)}`, a2: `2000${run.slice(0, 8)}`,
        b1: `3000${run.slice(0, 8)}`, b2: `4000${run.slice(0, 8)}`,
    };
    const waba = { a1: `WABA-A1-${run.slice(0, 6)}`, a2: `WABA-A2-${run.slice(0, 6)}`,
        b1: `WABA-B1-${run.slice(0, 6)}`, b2: `WABA-B2-${run.slice(0, 6)}` };
    const igAccounts = { a1: `ig-a1-${run.slice(0, 8)}`, a2: `ig-a2-${run.slice(0, 8)}`,
        b1: `ig-b1-${run.slice(0, 8)}` };

    let client: PrismaClient;
    let prisma: any;
    let redis: RedisService;
    let crypto: WhatsappCryptoService;
    let service: ChannelTokenService;

    const sql = (schema: string, text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** Whatever the call did, as a string — resolution or refusal, never a throw here. */
    const outcome = async (pending: Promise<any>): Promise<string> => {
        try {
            const value = await pending;
            return `resolved:${value?.phoneNumberId ?? value?.accountId ?? value?.context?.channelAccountId ?? '?'}`;
        } catch (error: any) {
            return `refused:${error?.code ?? error?.message ?? 'unknown'}`;
        }
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });

        // The two global tables this resolver reads. Additive, in the same
        // discipline as the shared synthetic scaffolding: create if absent,
        // widen always, so a neighbouring suite's shape is never overwritten.
        await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.channel_accounts(
            id UUID PRIMARY KEY, tenant_id UUID, channel_type TEXT, account_id TEXT,
            display_name TEXT, access_token TEXT, refresh_token TEXT, webhook_secret TEXT,
            is_active BOOLEAN DEFAULT true, metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
        // `whatsapp_credentials` vive en `ensureSyntheticGlobalTables`, no acá:
        // cuatro suites tenían su propia copia y una migración que agregó
        // columnas las dejó a las cuatro con `P2022`.
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));

        for (const tenant of [tenantA, tenantB]) {
            await client.$executeRawUnsafe(
                'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
                tenant.id, tenant.schema);
            await client.$executeRawUnsafe(`CREATE SCHEMA "${tenant.schema}"`);
        }

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.tenant = client.tenant;
        prisma.channelAccount = client.channelAccount;
        prisma.whatsappCredential = client.whatsappCredential;

        for (const tenant of [tenantA, tenantB]) {
            await sql(tenant.schema, `CREATE TABLE whatsapp_channels(
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                phone_number_id VARCHAR(255), meta_waba_id VARCHAR(255), meta_business_id VARCHAR(255),
                display_phone_number VARCHAR(50), access_token_ref TEXT,
                channel_status VARCHAR(50) DEFAULT 'connected', connected_at TIMESTAMP)`);
        }

        redis = new RedisService({
            get: (key: string, fallback?: any) => {
                const parsed = new URL(redisUrl!);
                if (key === 'redis.host') return parsed.hostname;
                if (key === 'redis.port') return Number(parsed.port || 6379);
                if (key === 'redis.password') return parsed.password || undefined;
                return fallback;
            },
        } as any);
        crypto = new WhatsappCryptoService();
        service = new ChannelTokenService(prisma as any, redis, crypto);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            for (const tenant of [tenantA, tenantB]) {
                if (!/^tenant_connsel_[a-f\d]{32}_[ab]$/.test(tenant.schema)) throw new Error('invalid_cleanup_scope');
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schema}" CASCADE`);
                await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenant.id);
                await client.$executeRawUnsafe('DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid', tenant.id);
                await client.$executeRawUnsafe('DELETE FROM public.whatsapp_credentials WHERE tenant_id=$1::uuid', tenant.id);
            }
        } finally {
            await client.$disconnect();
            if (redis) await redis.onModuleDestroy();
        }
    });

    /** Both tenants fully connected again, and no cache carried between cases. */
    beforeEach(async () => {
        for (const tenant of [tenantA, tenantB]) {
            await sql(tenant.schema, 'DELETE FROM whatsapp_channels');
            await client.$executeRawUnsafe('DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid', tenant.id);
            await client.$executeRawUnsafe('DELETE FROM public.whatsapp_credentials WHERE tenant_id=$1::uuid', tenant.id);
        }
        // Tenant A: two numbers, a1 the older. Tenant B: two numbers, b1 older.
        const wire = async (tenant: { id: string; schema: string }, entries: Array<[string, string, number]>) => {
            for (const [phone, wabaId, year] of entries) {
                await sql(tenant.schema,
                    `INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id, meta_business_id,
                        display_phone_number, access_token_ref, channel_status, connected_at)
                     VALUES($1,$2,$3,$4,'credential_ref','connected',$5::timestamp)`,
                    [phone, wabaId, `BUSINESS-${wabaId}`, `+57300${phone.slice(-6)}`, `${year}-01-01T00:00:00Z`]);
            }
            await client.$executeRawUnsafe(
                `INSERT INTO public.whatsapp_credentials(id,tenant_id,credential_type,encrypted_value)
                 VALUES($1::uuid,$2::uuid,'system_user_token',$3)`,
                randomUUID(), tenant.id, crypto.encryptToken(`system-token-${tenant.id.slice(0, 8)}`));
        };
        await wire(tenantA, [[numbers.a1, waba.a1, 2024], [numbers.a2, waba.a2, 2025]]);
        await wire(tenantB, [[numbers.b1, waba.b1, 2024], [numbers.b2, waba.b2, 2025]]);

        const account = async (tenantId: string, channelType: string, accountId: string, minutesOld: number) =>
            client.$executeRawUnsafe(
                `INSERT INTO public.channel_accounts(id,tenant_id,channel_type,account_id,display_name,
                    access_token,is_active,created_at)
                 VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,true,NOW() - ($7 || ' minutes')::interval)`,
                randomUUID(), tenantId, channelType, accountId, `display ${accountId}`,
                crypto.encryptToken(`token-${accountId}`), String(minutesOld));
        await account(tenantA.id, 'instagram', igAccounts.a1, 60);
        await account(tenantA.id, 'instagram', igAccounts.a2, 30);
        await account(tenantB.id, 'instagram', igAccounts.b1, 60);
        // WhatsApp connections are mirrored into channel_accounts by the connect
        // flow; the resolver has to agree with them.
        await account(tenantA.id, 'whatsapp', numbers.a1, 60);
        await account(tenantA.id, 'whatsapp', numbers.a2, 30);
        await account(tenantB.id, 'whatsapp', numbers.b1, 60);
        await account(tenantB.id, 'whatsapp', numbers.b2, 30);

        for (const tenant of [tenantA, tenantB]) {
            for (const channel of ['whatsapp', 'instagram', 'messenger', 'telegram']) {
                await service.invalidateCache(channel, tenant.id);
            }
            for (const accountId of [...Object.values(numbers), ...Object.values(igAccounts)]) {
                await service.invalidateCache('whatsapp', tenant.id, accountId);
                await service.invalidateCache('instagram', tenant.id, accountId);
            }
        }
    });

    // ── 1 · A NAMED CONNECTION ────────────────────────────────────────────────

    it('serves the number that was asked for', async () => {
        const resolved = await service.getWhatsAppToken(tenantA.id, numbers.a2);
        expect(resolved.phoneNumberId).toBe(numbers.a2);
        expect(resolved.wabaId).toBe(waba.a2);
    });

    it('refuses a number this tenant does not have, instead of sending from another', async () => {
        // The reproduction: today this returns numbers.a1 — the tenant's oldest
        // connection — with a warning in the log and nothing in the answer to
        // say the caller did not get what it named.
        expect(await outcome(service.getWhatsAppToken(tenantA.id, `9999${run.slice(0, 8)}`)))
            .toBe('refused:connection_not_found');
    });

    it('refuses another tenant\'s number rather than silently swapping in its own', async () => {
        // numbers.b1 exists — on tenant B. Asked of tenant A it must be a
        // refusal; today tenant A's own oldest number answers for it.
        expect(await outcome(service.getWhatsAppToken(tenantA.id, numbers.b1)))
            .toBe('refused:connection_not_found');
    });

    it('refuses a named connection through the generic resolver too', async () => {
        expect(await outcome(service.getChannelToken(tenantA.id, 'whatsapp', `9999${run.slice(0, 8)}`)))
            .toBe('refused:connection_not_found');
        expect(await outcome(service.getChannelToken(tenantA.id, 'instagram', igAccounts.b1)))
            .toBe('refused:connection_not_found');
    });

    // ── 2 · NO CONNECTION NAMED ───────────────────────────────────────────────

    it('refuses to choose when the tenant has more than one connection', async () => {
        // "The tenant's number" has two referents here, and which one the old
        // code returned was a property of `connected_at`, not of any decision a
        // caller made. On 1 October that is a bill on a WABA nobody chose.
        expect(await outcome(service.getWhatsAppToken(tenantA.id)))
            .toBe('refused:connection_ambiguous');
        expect(await outcome(service.getChannelToken(tenantA.id, 'instagram')))
            .toBe('refused:connection_ambiguous');
    });

    it('still resolves the sole connection of a single-connection tenant', async () => {
        // The legacy semantics that actually held: one number, so naming it and
        // not naming it are the same request. Unchanged, deliberately — the vast
        // majority of tenants are here and nothing about them is ambiguous.
        await sql(tenantB.schema, 'DELETE FROM whatsapp_channels WHERE phone_number_id=$1', [numbers.b2]);
        await client.$executeRawUnsafe(
            'DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid AND account_id=$2',
            tenantB.id, numbers.b2);
        const resolved = await service.getWhatsAppToken(tenantB.id);
        expect(resolved.phoneNumberId).toBe(numbers.b1);
        expect((await service.getChannelToken(tenantB.id, 'instagram')).accountId).toBe(igAccounts.b1);
    });

    it('refuses when the tenant has no connection of that type at all', async () => {
        await client.$executeRawUnsafe(
            `DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid AND channel_type='telegram'`, tenantA.id);
        expect(await outcome(service.getChannelToken(tenantA.id, 'telegram')))
            .toBe('refused:connection_absent');
    });

    // ── 3 · THE CACHE ─────────────────────────────────────────────────────────

    it('does not serve a cached entry whose account is not the one requested', async () => {
        // A 5-minute entry filed under a2's key holding a1's credentials. Cache
        // keys and their contents drifted apart for real: the per-account key
        // scheme is newer than the entries that survive a deploy, and the old
        // code wrote the *fallback* number's credentials whenever a requested
        // number was missing. Nothing on the read path ever compared them.
        // A COMPLETE entry, in the shape the resolver writes today — every field
        // present and internally consistent. The only thing wrong with it is the
        // one thing that matters: it is a1's, filed under a2's key. An entry
        // missing a field would be thrown out by the shape check further up and
        // would prove nothing about the account check.
        await redis.setJson(`wa_token:${tenantA.id}:${numbers.a2}`, {
            accessToken: 'CREDENTIALS-OF-THE-WRONG-NUMBER', phoneNumberId: numbers.a1,
            wabaId: waba.a1, businessId: `BUSINESS-${waba.a1}`, displayPhoneNumber: '+573001111111',
            channelId: randomUUID(), credentialId: randomUUID(), credentialSource: 'system_user',
        }, 300);
        const resolved = await service.getWhatsAppToken(tenantA.id, numbers.a2);
        expect(resolved.phoneNumberId).toBe(numbers.a2);
        expect(resolved.wabaId).toBe(waba.a2);
        expect(resolved.accessToken).not.toBe('CREDENTIALS-OF-THE-WRONG-NUMBER');
    });

    it('does not serve a cached generic entry belonging to another account', async () => {
        await redis.setJson(`instagram_token:${tenantA.id}:${igAccounts.a2}`, {
            accessToken: 'CREDENTIALS-OF-THE-WRONG-ACCOUNT', accountId: igAccounts.a1, channelType: 'instagram',
            credentialId: randomUUID(), credentialSource: 'channel_account',
        }, 300);
        const resolved = await service.getChannelToken(tenantA.id, 'instagram', igAccounts.a2);
        expect(resolved.accountId).toBe(igAccounts.a2);
        expect(resolved.accessToken).not.toBe('CREDENTIALS-OF-THE-WRONG-ACCOUNT');
    });

    it('does not serve an entry written before the account travelled inside it', async () => {
        // What survives a deploy. The old value had no credential identity in it,
        // so there is nothing to check it against and it is not used — it is
        // re-resolved from the database instead of trusted.
        await redis.setJson(`instagram_token:${tenantA.id}:${igAccounts.a1}`, {
            accessToken: 'CREDENTIALS-FROM-BEFORE-THE-DEPLOY', accountId: igAccounts.a1,
            channelType: 'instagram',
        }, 300);
        const resolved = await service.getChannelToken(tenantA.id, 'instagram', igAccounts.a1);
        expect(resolved.accountId).toBe(igAccounts.a1);
        expect(resolved.accessToken).toBe(`token-${igAccounts.a1}`);
    });

    it('does not answer for an account the tenant no longer has', async () => {
        // One account, warmed into the cache, then disconnected and replaced.
        // The old tenant-wide key `instagram_token:{tenant}` named no account,
        // so it kept answering with the credentials of the account that left.
        await client.$executeRawUnsafe(
            `DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid AND channel_type='instagram'
             AND account_id<>$2`, tenantA.id, igAccounts.a1);
        expect((await service.getChannelToken(tenantA.id, 'instagram')).accountId).toBe(igAccounts.a1);

        await client.$executeRawUnsafe(
            `DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid AND account_id=$2`,
            tenantA.id, igAccounts.a1);
        await client.$executeRawUnsafe(
            `INSERT INTO public.channel_accounts(id,tenant_id,channel_type,account_id,display_name,
                access_token,is_active,created_at)
             VALUES($1::uuid,$2::uuid,'instagram',$3,'replacement',$4,true,NOW())`,
            randomUUID(), tenantA.id, igAccounts.a2, crypto.encryptToken(`token-${igAccounts.a2}`));

        expect((await service.getChannelToken(tenantA.id, 'instagram')).accountId).toBe(igAccounts.a2);
    });

    it('clearing a channel\'s cache without naming an account clears its accounts too', async () => {
        // What a disconnect does: `invalidateCache(channelType, tenantId)` with
        // no account. It cleared the tenant-wide key and left every per-account
        // entry live, so a revoked token kept being served, by name, for the
        // rest of its five minutes.
        expect((await service.getChannelToken(tenantA.id, 'instagram', igAccounts.a1)).accountId)
            .toBe(igAccounts.a1);
        await client.$executeRawUnsafe(
            `UPDATE public.channel_accounts SET is_active=false WHERE tenant_id=$1::uuid AND account_id=$2`,
            tenantA.id, igAccounts.a1);
        await service.invalidateCache('instagram', tenantA.id);
        expect(await outcome(service.getChannelToken(tenantA.id, 'instagram', igAccounts.a1)))
            .toBe('refused:connection_not_found');
    });

    // ── 3b · THE CREDENTIAL HAS TO BELONG TO THE ACCOUNT ──────────────────────

    it('refuses a shared credential it cannot attribute to one of several accounts', async () => {
        // A legacy row holds the `encrypted_ref` placeholder and resolution falls
        // back to the tenant's single shared `{channel}_token` credential. That is
        // a fallback about WHICH SECRET, not which account — and it is only sound
        // while the tenant has one account. The daily Instagram refresh writes
        // whichever account ran last into that shared row, so on a two-account
        // tenant it hands one account the other's token: the same substitution,
        // one layer down, and invisible in the account id that comes back.
        await client.$executeRawUnsafe(
            `UPDATE public.channel_accounts SET access_token='encrypted_ref'
              WHERE tenant_id=$1::uuid AND account_id=$2`, tenantA.id, igAccounts.a2);
        await client.$executeRawUnsafe(
            `INSERT INTO public.whatsapp_credentials(id,tenant_id,credential_type,encrypted_value)
             VALUES($1::uuid,$2::uuid,'instagram_token',$3)`,
            randomUUID(), tenantA.id, crypto.encryptToken(`token-${igAccounts.a1}`));

        expect(await outcome(service.getChannelToken(tenantA.id, 'instagram', igAccounts.a2)))
            .toBe('refused:credential_missing');
    });

    it('still uses the shared credential for a tenant that has exactly one account', async () => {
        await client.$executeRawUnsafe(
            `DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid AND channel_type='instagram'
              AND account_id<>$2`, tenantA.id, igAccounts.a1);
        await client.$executeRawUnsafe(
            `UPDATE public.channel_accounts SET access_token='encrypted_ref'
              WHERE tenant_id=$1::uuid AND account_id=$2`, tenantA.id, igAccounts.a1);
        await client.$executeRawUnsafe(
            `INSERT INTO public.whatsapp_credentials(id,tenant_id,credential_type,encrypted_value)
             VALUES($1::uuid,$2::uuid,'instagram_token',$3)`,
            randomUUID(), tenantA.id, crypto.encryptToken('the-tenants-only-instagram-token'));

        const resolved = await service.getChannelToken(tenantA.id, 'instagram', igAccounts.a1);
        expect(resolved.accountId).toBe(igAccounts.a1);
        expect(resolved.accessToken).toBe('the-tenants-only-instagram-token');
    });

    // ── 4 · THE CONTEXT THAT TRAVELS WITH THE EFFECT ──────────────────────────

    it('produces a send context carrying the exact connection and the account that pays', async () => {
        const contactId = randomUUID();
        const resolved = await service.resolveSendContext({
            tenantId: tenantA.id, channelType: 'whatsapp', channelAccountId: numbers.a2,
            recipient: { scope: 'customer', contactId, address: '+573001112233' },
        });
        expect(isOutboundSendContext(resolved.context)).toBe(true);
        expect(resolved.context.channelAccountId).toBe(numbers.a2);
        expect(resolved.context.payer.wabaId).toBe(waba.a2);
        // A known WABA id ANSWERS who pays: under a Tech Provider arrangement
        // Meta bills that WABA's own account. This used to assert `unknown` on
        // the grounds that funding had not been probed — which conflated WHO
        // pays with WHETHER THEY CAN, left `payer.kind` permanently unknown,
        // and made the money authority refuse every send with `payer_unknown`.
        // Funding readiness is its own signal and its own refusal.
        expect(resolved.context.payer.kind).toBe('business_direct');
        expect(resolved.context.credential.source).toBe('system_user');
        expect(resolved.accessToken).toBeTruthy();
    });

    it('makes a retry that moved to another connection visible field by field', async () => {
        const recipient = { scope: 'customer' as const, contactId: randomUUID(), address: '+573001112233' };
        const first = await service.resolveSendContext({
            tenantId: tenantA.id, channelType: 'whatsapp', channelAccountId: numbers.a1, recipient });
        const same = await service.resolveSendContext({
            tenantId: tenantA.id, channelType: 'whatsapp', channelAccountId: numbers.a1, recipient });
        const moved = await service.resolveSendContext({
            tenantId: tenantA.id, channelType: 'whatsapp', channelAccountId: numbers.a2, recipient });

        expect(sameSendContext(first.context, same.context).same).toBe(true);
        expect(sameSendContext(first.context, moved.context).changed)
            .toEqual(expect.arrayContaining(['channelAccountId', 'payer.wabaId']));
    });

    it('never produces a send context for a connection it could not authorise', async () => {
        const recipient = { scope: 'customer' as const, contactId: randomUUID(), address: '+573001112233' };
        expect(await outcome(service.resolveSendContext({
            tenantId: tenantA.id, channelType: 'whatsapp', channelAccountId: numbers.b1, recipient })))
            .toBe('refused:connection_not_found');
        expect(await outcome(service.resolveSendContext({
            tenantId: tenantA.id, channelType: 'whatsapp', recipient })))
            .toBe('refused:connection_ambiguous');
    });
});
