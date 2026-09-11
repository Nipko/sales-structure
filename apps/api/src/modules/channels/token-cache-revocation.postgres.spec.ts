import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ChannelTokenService } from './channel-token.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ FOR FIVE MINUTES, THE CACHE WAS THE AUTHORITY ═══
 *
 * `resolveWhatsApp` answered from Redis before asking any of the three things
 * that decide whether a number may send: the tenant's channel row, the global
 * `channel_accounts` row, and the credential's own rotation state and expiry.
 * The cache read checked the entry's shape and that it belonged to the account
 * that was asked for — both true of an entry written thirty seconds before a
 * revocation.
 *
 * So a database with the channel `disconnected`, the account inactive and the
 * credential `revoked` still produced the old token, with not one query run.
 * The refusals live behind the cache, which means for the length of a TTL they
 * did not exist.
 *
 * ── WHAT MAKES THESE TESTS DIFFERENT FROM THE FAIL-CLOSED SUITE ─────────────
 *
 * That suite hands the resolver a Redis double where every read misses, which
 * is the right way to test the refusals themselves and the reason this defect
 * survived it: with no cache there is nothing to skip. Here Redis really
 * remembers, so the cache is the subject rather than an absence.
 *
 * Real PostgreSQL, because "is this connection still allowed" is answered by
 * three rows in two schemas, and a double would answer whatever it was told to.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

/** Redis that actually remembers, which is the whole point. */
function rememberingRedis() {
    const values = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    let failEpochReads = false;
    const client = {
        get: async (key: string) => {
            if (failEpochReads && key.includes('_token_epoch:')) throw new Error('redis down');
            return values.has(key) ? values.get(key)! : null;
        },
        incr: async (key: string) => {
            const next = Number(values.get(key) ?? '0') + 1;
            values.set(key, String(next));
            return next;
        },
        expire: async () => 1,
        sadd: async (key: string, member: string) => {
            const set = sets.get(key) ?? new Set<string>();
            set.add(member); sets.set(key, set); return 1;
        },
        smembers: async (key: string) => [...(sets.get(key) ?? [])],
        srem: async (key: string, member: string) => {
            sets.get(key)?.delete(member); return 1;
        },
    };
    return {
        getJson: async <T>(key: string): Promise<T | null> =>
            (values.has(key) ? JSON.parse(values.get(key)!) : null),
        setJson: async (key: string, value: unknown) => {
            values.set(key, JSON.stringify(value));
        },
        del: async (key: string) => { values.delete(key); },
        getClient: () => client,
        // Test controls, not part of the interface.
        _values: values,
        _breakEpochReads: (broken: boolean) => { failEpochReads = broken; },
    };
}

integration('the credential cache never outranks the authority that revoked it', () => {
    const run = randomUUID().replace(/-/g, '');
    const tenantId = randomUUID();
    const schema = `tenant_tokencache_${run}`;
    const NUMBER = `1000${run.slice(0, 8)}`;
    const SIBLING = `2000${run.slice(0, 8)}`;

    let client: PrismaClient;
    let prisma: any;
    let redis: ReturnType<typeof rememberingRedis>;
    let tokens: ChannelTokenService;
    let crypto: WhatsappCryptoService;
    let previousKey: string | undefined;
    jest.setTimeout(120_000);

    const KEY = 'c'.repeat(64);
    const sql = (text: string, params: any[] = []) =>
        prisma.executeInTenantSchema(schema, text, params);

    const ask = async (phoneNumberId?: string) => {
        try {
            const value = await tokens.getWhatsAppToken(tenantId, phoneNumberId);
            return `token:${value.accessToken}`;
        } catch (error: any) {
            return `refused:${error?.code ?? error?.message ?? 'unknown'}`;
        }
    };

    /** How many times the database was consulted for the answer. */
    let reads = 0;
    const countingReads = <T>(work: () => Promise<T>) => { reads = 0; return work(); };

    beforeAll(async () => {
        previousKey = process.env.ENCRYPTION_KEY;
        process.env.ENCRYPTION_KEY = KEY;
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        prisma = client as any;
        prisma.getTenantSchemaName = async () => { reads += 1; return schema; };
        prisma.executeInTenantSchema = async (
            _schema: string, text: string, params: any[] = [],
        ) => {
            reads += 1;
            return client.$queryRawUnsafe(
                text.replace(/\bwhatsapp_channels\b/g, `"${schema}".whatsapp_channels`), ...params);
        };
        const realAccount = (client as any).channelAccount;
        (client as any).channelAccount = {
            findFirst: (args: any) => { reads += 1; return realAccount.findFirst(args); },
        };
        const realCredential = (client as any).whatsappCredential;
        (client as any).whatsappCredential = {
            findFirst: (args: any) => { reads += 1; return realCredential.findFirst(args); },
        };

        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
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
        for (const [number, when] of [[NUMBER, '2026-01-01'], [SIBLING, '2026-02-01']] as const) {
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
        crypto = new WhatsappCryptoService();
        await client.$executeRawUnsafe(
            `INSERT INTO public.whatsapp_credentials
                (id, tenant_id, credential_type, encrypted_value, rotation_state)
             VALUES(gen_random_uuid(),$1::uuid,'system_user_token',$2,'active')`,
            tenantId, crypto.encryptToken('LIVE-TOKEN'));
    });

    afterAll(async () => {
        if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = previousKey;
        if (!client) return;
        try {
            if (!/^tenant_tokencache_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe(
                'DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
            await client.$executeRawUnsafe(
                'DELETE FROM public.channel_accounts WHERE tenant_id=$1::uuid', tenantId);
            await client.$executeRawUnsafe(
                'DELETE FROM public.whatsapp_credentials WHERE tenant_id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        redis = rememberingRedis();
        tokens = new ChannelTokenService(prisma, redis as any, crypto as any);
        await sql(`UPDATE whatsapp_channels SET channel_status = 'connected'`);
        await client.$executeRawUnsafe(
            `UPDATE public.channel_accounts SET is_active = true WHERE tenant_id=$1::uuid`, tenantId);
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials
                SET rotation_state='active', expires_at=NULL, encrypted_value=$2
              WHERE tenant_id=$1::uuid`, tenantId, crypto.encryptToken('LIVE-TOKEN'));
    });

    it('caches, so the refusals below mean something', async () => {
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
        const cold = await countingReads(async () => {
            await tokens.getWhatsAppToken(tenantId, NUMBER);
            return reads;
        });
        expect(cold).toBe(0);
    });

    // ── THE THREE AUTHORITIES, EACH REVOKING BEHIND A WARM ENTRY ────────────

    it.each([
        ['the channel is disconnected', async () =>
            sql(`UPDATE whatsapp_channels SET channel_status='disconnected'`)],
        ['the global account row is switched off', async () => {
            await client.$executeRawUnsafe(
                `UPDATE public.channel_accounts SET is_active=false WHERE tenant_id=$1::uuid`,
                tenantId);
        }],
        ['the credential is revoked', async () => {
            await client.$executeRawUnsafe(
                `UPDATE public.whatsapp_credentials SET rotation_state='revoked'
                  WHERE tenant_id=$1::uuid`, tenantId);
        }],
    ])('refuses once %s, even with the entry still warm', async (_name, revoke) => {
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
        await revoke();
        // The authority that revoked also tells the cache. That call is the
        // thing under test: without it the entry answers for five more minutes.
        await tokens.invalidateCache('whatsapp', tenantId);
        expect(await ask(NUMBER)).toMatch(/^refused:/);
    });

    it('refuses a credential that expires inside the TTL, with nobody to tell it', async () => {
        // Nothing bumps anything when a clock passes a timestamp: an expiry is
        // the one revocation with no author. So the cached value carries the
        // credential's own `expires_at` and the reader checks it, which is why
        // this test changes NOTHING between the two calls except the time.
        // The instant comes from THIS process's clock, not from `NOW()`. The
        // disposable PostgreSQL runs in a WSL VM whose clock drifts minutes
        // away from the host's, and an expiry test written against the
        // database's idea of "now" measures that drift instead of the rule.
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET expires_at = $2::timestamptz
              WHERE tenant_id=$1::uuid`, tenantId, new Date(Date.now() + 1_500).toISOString());
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
        await new Promise(resolve => { setTimeout(resolve, 1_900); });
        expect(await ask(NUMBER)).toBe('refused:credential_expired');
    });

    // ── AND THE SIBLINGS, BECAUSE THE TOKEN IS TENANT-WIDE ──────────────────

    it('invalidates the sibling numbers when the shared token rotates', async () => {
        // Under the Tech Provider model one System User token signs for every
        // number of the tenant. Per-account invalidation left the siblings
        // holding the OUTGOING half of a rotation for five more minutes.
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
        expect(await ask(SIBLING)).toBe('token:LIVE-TOKEN');

        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET encrypted_value=$2 WHERE tenant_id=$1::uuid`,
            tenantId, crypto.encryptToken('ROTATED-TOKEN'));
        // Naming only the number that completed the reconnection, which is what
        // the connect path does.
        await tokens.invalidateCache('whatsapp', tenantId, NUMBER);

        expect(await ask(NUMBER)).toBe('token:ROTATED-TOKEN');
        expect(await ask(SIBLING)).toBe('token:ROTATED-TOKEN');
    });

    it('costs one integer to invalidate, whatever the index says', async () => {
        // The epoch is what makes this work when the key index has expired, was
        // never written, or lists accounts whose keys are already gone — all of
        // which happen, and all of which used to leave an entry answering.
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
        await redis.getClient().srem(`whatsapp_token_accounts:${tenantId}`, NUMBER);
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET encrypted_value=$2 WHERE tenant_id=$1::uuid`,
            tenantId, crypto.encryptToken('ROTATED-TOKEN'));
        await tokens.revokeCachedCredentials('whatsapp', tenantId);
        expect(await ask(NUMBER)).toBe('token:ROTATED-TOKEN');
    });

    // ── FAIL-CLOSED, WHICH IS THE DIRECTION THAT MATTERS ────────────────────

    it('goes to the database when the epoch cannot be read at all', async () => {
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
        redis._breakEpochReads(true);
        // With no readable epoch there is no way to know whether this entry
        // survived a revocation, so it is not used. The answer is the same; the
        // cost is not, and that is the correct trade.
        const withBrokenEpoch = await countingReads(async () => {
            const answer = await ask(NUMBER);
            return { answer, reads };
        });
        expect(withBrokenEpoch.answer).toBe('token:LIVE-TOKEN');
        expect(withBrokenEpoch.reads).toBeGreaterThan(0);
    });

    it('refuses a revoked connection even while the epoch is unreadable', async () => {
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
        await sql(`UPDATE whatsapp_channels SET channel_status='disconnected'`);
        redis._breakEpochReads(true);
        expect(await ask(NUMBER)).toBe('refused:connection_disconnected');
    });

    it('does not write an entry nothing could ever invalidate', async () => {
        redis._breakEpochReads(true);
        await ask(NUMBER);
        redis._breakEpochReads(false);
        // Nothing was cached, so the next resolution reads the database — which
        // is what makes the previous test's refusal reachable at all.
        const after = await countingReads(async () => {
            await ask(NUMBER);
            return reads;
        });
        expect(after).toBeGreaterThan(0);
    });

    it('ignores an entry written before epochs existed', async () => {
        // A deploy lands with warm entries from the previous binary. They carry
        // no stamp, so they cannot be checked — and an unstamped entry is
        // exactly the one that might predate a revocation.
        await redis.setJson(`wa_token:${tenantId}:${NUMBER}`, {
            accessToken: 'PRE-EPOCH-TOKEN', phoneNumberId: NUMBER, wabaId: `WABA-${NUMBER}`,
            channelId: randomUUID(), businessId: null, displayPhoneNumber: `+${NUMBER}`,
            credentialId: randomUUID(), credentialSource: 'system_user',
        });
        expect(await ask(NUMBER)).toBe('token:LIVE-TOKEN');
    });
});
