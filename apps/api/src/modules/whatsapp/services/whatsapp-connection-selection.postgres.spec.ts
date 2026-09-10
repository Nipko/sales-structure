import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { isOutboundSendContext, sameSendContext } from '@parallext/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappCryptoService } from './whatsapp-crypto.service';
import { WhatsappConnectionService } from './whatsapp-connection.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * ═══ THE SECOND PLACE THAT SUBSTITUTED A CONNECTION, AND THE WORSE ONE ═══
 *
 * `ChannelTokenService` was fixed first: a named connection resolves to itself
 * or to a refusal, and an unnamed one is only answerable while the tenant has
 * exactly one. That rule was written in `connection-refusal.ts` and proved in
 * `channels/connection-selection.postgres.spec.ts`.
 *
 * It was not the only resolver. `WhatsappConnectionService.getValidAccessToken`
 * is a second, independent implementation of the same question, reached by a
 * different route — the WhatsApp service's own messaging and template surfaces —
 * and it still had both halves of the defect. Four billable template senders go
 * through it without naming a number:
 *
 *   appointments/appointment-reminders.service.ts:352  (appointment_reminder)
 *   appointments/appointment-reminders.service.ts:429  (attendance_check)
 *   automation/automation-jobs.processor.ts:200        (lead-capture template)
 *   automation/drip-sequence.service.ts:638            (drip template)
 *
 * From 1 October 2026 Meta charges the business's own WhatsApp Business Account
 * per delivered service message, so on a two-number tenant every one of those
 * reminders was billed to whichever number happened to connect first.
 *
 * Two defects, reproduced here against real PostgreSQL with two tenants holding
 * two numbers each — because a resolver that substitutes only ever shows it on
 * the second connection, and every fixture with one number agrees with itself:
 *
 *   1 · NO AMBIGUITY CHECK ON THE UNNAMED PATH (service lines 262-267).
 *       The explicit path already refused correctly. The unnamed one ran
 *       `ORDER BY connected_at ASC NULLS LAST LIMIT 1` and returned the tenant's
 *       oldest connection, silently. Which WABA paid was a property of row
 *       order, not of a decision anybody made.
 *
 *   2 · A CREDENTIAL READ FROM A DIFFERENT ROW THAN THE ONE RETURNED
 *       (service lines 288-295). When no tenant-wide `system_user_token` was
 *       stored, resolution fell back to `access_token_ref` — but it re-queried
 *       for it with `ORDER BY connected_at ASC NULLS LAST LIMIT 1`, the OLDEST
 *       row, while still returning the REQUESTED row's `phone_number_id`,
 *       `meta_waba_id` and `channelId`. Number B's identity travelled with
 *       number A's token: a message that claims to be from B, sent with A's
 *       credential, billed to A's account. A test that only asserts "a token
 *       came back" cannot see this, so every assertion below says WHICH token
 *       came back for WHICH number, with credentials that differ per number.
 */
const enabled = !!databaseUrl;

(enabled ? describe : describe.skip)('whatsapp connection selection: exact, or refused', () => {
    const run = randomUUID().replace(/-/g, '');
    /** A: has a tenant-wide system_user_token. B: has none, so it takes the
     *  `access_token_ref` path where the credential could come from another row. */
    const tenantA = { id: randomUUID(), schema: `tenant_waconn_${run}_a` };
    const tenantB = { id: randomUUID(), schema: `tenant_waconn_${run}_b` };

    const numbers = {
        a1: `1000${run.slice(0, 8)}`, a2: `2000${run.slice(0, 8)}`,
        b1: `3000${run.slice(0, 8)}`, b2: `4000${run.slice(0, 8)}`,
    };
    const waba = {
        a1: `WABA-A1-${run.slice(0, 6)}`, a2: `WABA-A2-${run.slice(0, 6)}`,
        b1: `WABA-B1-${run.slice(0, 6)}`, b2: `WABA-B2-${run.slice(0, 6)}`,
    };
    /** One credential per number, so "which token" is answerable, not just "a token". */
    const tokenOf = (phone: string) => `token-of-${phone}`;
    const systemUserTokenA = `system-user-token-${run.slice(0, 8)}`;

    let client: PrismaClient;
    let prisma: any;
    let crypto: WhatsappCryptoService;
    let service: WhatsappConnectionService;

    const sql = (schema: string, text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** Whatever the call did, as a string — resolution or refusal, never a throw here. */
    const outcome = async (pending: Promise<any>): Promise<string> => {
        try {
            const value = await pending;
            return `resolved:${value?.phoneNumberId ?? value?.context?.channelAccountId ?? '?'}`;
        } catch (error: any) {
            return `refused:${error?.code ?? error?.message ?? 'unknown'}`;
        }
    };

    /**
     * The suite supplies its own key instead of inheriting whatever the shell has.
     *
     * `WhatsappCryptoService` falls back to base64 when `ENCRYPTION_KEY` is
     * absent or short, and base64 NEVER fails: it decodes anything, so the
     * undecryptable-credential case below resolved instead of refusing. The
     * suite passed for whoever had the variable exported and failed for whoever
     * did not — a test whose verdict is a property of the shell.
     *
     * Production always has the key (it is in the critical env list, and
     * `encryptToken` throws outright when NODE_ENV is production), so pinning it
     * here is not a convenience: it is the only way this suite exercises the
     * AES-256-GCM path the resolver actually runs against.
     */
    const KEY = 'a'.repeat(64);
    let previousKey: string | undefined;

    beforeAll(async () => {
        previousKey = process.env.ENCRYPTION_KEY;
        process.env.ENCRYPTION_KEY = KEY;
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });

        // The one global table this resolver reads besides `tenants`. Additive,
        // in the same discipline as the neighbouring suites: create if absent so
        // another worker's shape is never overwritten.
        await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.whatsapp_credentials(
            id UUID PRIMARY KEY, tenant_id UUID, credential_type TEXT, encrypted_value TEXT,
            rotation_state TEXT DEFAULT 'active', expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

        for (const tenant of [tenantA, tenantB]) {
            await client.$executeRawUnsafe(
                'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
                tenant.id, tenant.schema);
            await client.$executeRawUnsafe(`CREATE SCHEMA "${tenant.schema}"`);
        }

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.tenant = client.tenant;
        prisma.whatsappCredential = client.whatsappCredential;

        for (const tenant of [tenantA, tenantB]) {
            await sql(tenant.schema, `CREATE TABLE whatsapp_channels(
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider_type VARCHAR(50) DEFAULT 'meta_cloud',
                phone_number_id VARCHAR(255), meta_waba_id VARCHAR(255), meta_business_id VARCHAR(255),
                display_phone_number VARCHAR(50), display_name VARCHAR(255),
                display_name_status VARCHAR(50), quality_rating VARCHAR(50),
                messaging_limit_tier VARCHAR(50), access_token_ref TEXT,
                channel_status VARCHAR(50) DEFAULT 'connected', connected_at TIMESTAMP)`);
        }

        crypto = new WhatsappCryptoService();
        service = new WhatsappConnectionService(prisma as any, crypto, {} as any, {} as any);
    });

    afterAll(async () => {
        if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = previousKey;
        if (!client) return;
        try {
            for (const tenant of [tenantA, tenantB]) {
                if (!/^tenant_waconn_[a-f\d]{32}_[ab]$/.test(tenant.schema)) throw new Error('invalid_cleanup_scope');
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schema}" CASCADE`);
                await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenant.id);
                await client.$executeRawUnsafe('DELETE FROM public.whatsapp_credentials WHERE tenant_id=$1::uuid',
                    tenant.id);
            }
        } finally {
            await client.$disconnect();
        }
    });

    beforeEach(async () => {
        for (const tenant of [tenantA, tenantB]) {
            await sql(tenant.schema, 'DELETE FROM whatsapp_channels');
            await client.$executeRawUnsafe('DELETE FROM public.whatsapp_credentials WHERE tenant_id=$1::uuid',
                tenant.id);
        }
        const wire = async (schema: string, entries: Array<[string, string, number]>) => {
            for (const [phone, wabaId, year] of entries) {
                await sql(schema,
                    `INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id, meta_business_id,
                        display_phone_number, access_token_ref, channel_status, connected_at)
                     VALUES($1,$2,$3,$4,$5,'connected',$6::timestamp)`,
                    [phone, wabaId, `BUSINESS-${wabaId}`, `+57300${phone.slice(-6)}`,
                        tokenOf(phone), `${year}-01-01T00:00:00Z`]);
            }
        };
        // a1 and b1 are the older connections — the ones the old code fell back to.
        await wire(tenantA.schema, [[numbers.a1, waba.a1, 2024], [numbers.a2, waba.a2, 2025]]);
        await wire(tenantB.schema, [[numbers.b1, waba.b1, 2024], [numbers.b2, waba.b2, 2025]]);

        // Tenant A alone holds the tenant-wide system user token. Tenant B has
        // none, which is what puts it on the `access_token_ref` path.
        await client.$executeRawUnsafe(
            `INSERT INTO public.whatsapp_credentials(id,tenant_id,credential_type,encrypted_value)
             VALUES($1::uuid,$2::uuid,'system_user_token',$3)`,
            randomUUID(), tenantA.id, crypto.encryptToken(systemUserTokenA));
    });

    // ── 1 · A NAMED CONNECTION ────────────────────────────────────────────────

    it('serves the number that was asked for', async () => {
        const resolved = await service.getValidAccessToken(tenantA.schema, numbers.a2);
        expect(resolved.phoneNumberId).toBe(numbers.a2);
        expect(resolved.wabaId).toBe(waba.a2);
        expect(resolved.accessToken).toBe(systemUserTokenA);
    });

    it('refuses a number this tenant does not have, instead of sending from another', async () => {
        expect(await outcome(service.getValidAccessToken(tenantA.schema, `9999${run.slice(0, 8)}`)))
            .toBe('refused:connection_not_found');
    });

    it('refuses another tenant\'s number rather than silently swapping in its own', async () => {
        expect(await outcome(service.getValidAccessToken(tenantA.schema, numbers.b1)))
            .toBe('refused:connection_not_found');
    });

    // ── 2 · DEFECT ONE: NO CONNECTION NAMED, AND MORE THAN ONE TO CHOOSE FROM ──

    it('refuses to choose when the tenant has more than one connection', async () => {
        // The reproduction. Before the fix this resolved numbers.a1 — the oldest
        // connection — with nothing in the answer to say a choice had been made.
        // Every appointment reminder, attendance check, lead-capture template and
        // drip template of a two-number tenant went out on it, and from 1 October
        // is billed to its WABA.
        expect(await outcome(service.getValidAccessToken(tenantA.schema)))
            .toBe('refused:connection_ambiguous');
    });

    it('still resolves the sole connection of a single-connection tenant', async () => {
        // The legacy semantics that actually held, and where nearly every tenant
        // is: one number, so naming it and not naming it are the same request.
        await sql(tenantA.schema, 'DELETE FROM whatsapp_channels WHERE phone_number_id=$1', [numbers.a2]);
        const resolved = await service.getValidAccessToken(tenantA.schema);
        expect(resolved.phoneNumberId).toBe(numbers.a1);
        expect(resolved.wabaId).toBe(waba.a1);
    });

    it('does not count a number that cannot send as a second connection', async () => {
        // Onboarding leaves a row behind while Meta has not issued a phone number
        // id yet. It can never be a sender, so it neither answers an unnamed
        // request nor makes one ambiguous — the same rule the channels resolver
        // applies, and without it a tenant mid-onboarding could not send at all.
        await sql(tenantA.schema, 'DELETE FROM whatsapp_channels WHERE phone_number_id=$1', [numbers.a2]);
        await sql(tenantA.schema,
            `INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id, access_token_ref, connected_at)
             VALUES(NULL,$1,'credential_ref','2026-01-01T00:00:00Z')`, [waba.a2]);
        await sql(tenantA.schema,
            `INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id, access_token_ref, connected_at)
             VALUES('',$1,'credential_ref','2026-02-01T00:00:00Z')`, [waba.a2]);
        const resolved = await service.getValidAccessToken(tenantA.schema);
        expect(resolved.phoneNumberId).toBe(numbers.a1);
    });

    it('refuses when the tenant has no connection at all', async () => {
        await sql(tenantA.schema, 'DELETE FROM whatsapp_channels');
        expect(await outcome(service.getValidAccessToken(tenantA.schema)))
            .toBe('refused:connection_absent');
    });

    it('treats an empty number as no number, not as a connection to look up', async () => {
        // Producers that build an outbound message with no connection bound pass
        // `''` through a field typed as a required string, so `tsc` never saw it.
        // It is an omission, not a request for a connection named `''`.
        await sql(tenantB.schema, 'DELETE FROM whatsapp_channels WHERE phone_number_id=$1', [numbers.b2]);
        const resolved = await service.getValidAccessToken(tenantB.schema, '');
        expect(resolved.phoneNumberId).toBe(numbers.b1);
        expect(await outcome(service.getValidAccessToken(tenantA.schema, '   ')))
            .toBe('refused:connection_ambiguous');
    });

    // ── 3 · DEFECT TWO: THE CREDENTIAL HAS TO BELONG TO THE ACCOUNT ────────────

    it('returns the requested number\'s own token, not the oldest number\'s', async () => {
        // The reproduction, and the reason every assertion here names a token.
        // Tenant B stores no `system_user_token`, so resolution falls through to
        // `access_token_ref` — which the old code re-queried with
        // `ORDER BY connected_at ASC LIMIT 1`. It returned b1's credential under
        // b2's identity: a message that claims to be from b2, presented to Meta
        // with b1's token, billed to b1's account. Asserting only that a token
        // came back would have passed.
        const resolved = await service.getValidAccessToken(tenantB.schema, numbers.b2);
        expect(resolved.phoneNumberId).toBe(numbers.b2);
        expect(resolved.wabaId).toBe(waba.b2);
        expect(resolved.accessToken).toBe(tokenOf(numbers.b2));
        expect(resolved.accessToken).not.toBe(tokenOf(numbers.b1));
    });

    it('pairs identity and credential on the older number too', async () => {
        // The mirror case. b1 IS the oldest, so the old code happened to be right
        // about it — which is exactly why a one-number fixture proved nothing.
        const resolved = await service.getValidAccessToken(tenantB.schema, numbers.b1);
        expect(resolved.phoneNumberId).toBe(numbers.b1);
        expect(resolved.accessToken).toBe(tokenOf(numbers.b1));
    });

    it('refuses when the requested number has no credential of its own', async () => {
        // b2 holds the `credential_ref` placeholder and b1 holds a real token.
        // Handing b1's token to b2 is the same substitution one layer down, and
        // invisible in the phone number id that comes back.
        await sql(tenantB.schema,
            `UPDATE whatsapp_channels SET access_token_ref='credential_ref' WHERE phone_number_id=$1`,
            [numbers.b2]);
        expect(await outcome(service.getValidAccessToken(tenantB.schema, numbers.b2)))
            .toBe('refused:credential_missing');
        // …and b1, which does have one, is unaffected.
        expect((await service.getValidAccessToken(tenantB.schema, numbers.b1)).accessToken)
            .toBe(tokenOf(numbers.b1));
    });

    it('prefers the tenant-wide system user token, which really is shared', async () => {
        // Deliberate exception, and the only one: under the Tech Provider model a
        // system user token covers every WABA of the tenant, so presenting it for
        // any of that tenant's numbers is not a substitution. Which number sends
        // — the thing Meta bills — is still resolved exactly.
        const first = await service.getValidAccessToken(tenantA.schema, numbers.a1);
        const second = await service.getValidAccessToken(tenantA.schema, numbers.a2);
        expect(first.accessToken).toBe(systemUserTokenA);
        expect(second.accessToken).toBe(systemUserTokenA);
        expect(first.phoneNumberId).toBe(numbers.a1);
        expect(second.phoneNumberId).toBe(numbers.a2);
    });

    it('refuses a stored credential it cannot decrypt instead of falling through', async () => {
        // A rotation that half-landed, or the wrong ENCRYPTION_KEY. Falling
        // through to `access_token_ref` here would present a DIFFERENT secret
        // than the one the tenant last authorised and hide the failure.
        // The shape matters: `decryptToken` returns a colon-less value verbatim
        // as a plaintext token, so the fixture has to be a well-formed
        // `iv:tag:ciphertext` that fails its authentication tag.
        await client.$executeRawUnsafe(
            `UPDATE public.whatsapp_credentials SET encrypted_value=$2 WHERE tenant_id=$1::uuid`,
            tenantA.id, '00000000000000000000000000000000:1111111111111111111111111111111:22');
        expect(await outcome(service.getValidAccessToken(tenantA.schema, numbers.a2)))
            .toBe('refused:credential_undecryptable');
    });

    // ── 4 · THE CONTEXT THAT TRAVELS WITH THE EFFECT ──────────────────────────

    it('produces a send context carrying the exact connection and the account that pays', async () => {
        const resolved = await service.resolveSendContext({
            tenantId: tenantB.id, channelType: 'whatsapp', channelAccountId: numbers.b2,
            recipient: { scope: 'customer', contactId: randomUUID(), address: '+573001112233' },
        });
        expect(isOutboundSendContext(resolved.context)).toBe(true);
        expect(resolved.context.channelAccountId).toBe(numbers.b2);
        expect(resolved.context.payer.wabaId).toBe(waba.b2);
        // The WABA is known; how it is funded is a separate probe that has not run.
        expect(resolved.context.payer.kind).toBe('unknown');
        expect(resolved.context.credential.source).toBe('channel_account');
        // The credential that came back belongs to the account it came back for.
        expect(resolved.accessToken).toBe(tokenOf(numbers.b2));
    });

    it('makes a retry that moved to another connection visible field by field', async () => {
        const recipient = { scope: 'customer' as const, contactId: randomUUID(), address: '+573001112233' };
        const first = await service.resolveSendContext(
            { tenantId: tenantB.id, channelType: 'whatsapp', channelAccountId: numbers.b1, recipient });
        const same = await service.resolveSendContext(
            { tenantId: tenantB.id, channelType: 'whatsapp', channelAccountId: numbers.b1, recipient });
        const moved = await service.resolveSendContext(
            { tenantId: tenantB.id, channelType: 'whatsapp', channelAccountId: numbers.b2, recipient });

        expect(sameSendContext(first.context, same.context).same).toBe(true);
        expect(sameSendContext(first.context, moved.context).changed)
            .toEqual(expect.arrayContaining(['channelAccountId', 'payer.wabaId', 'credential.id']));
    });

    it('never produces a send context for a connection it could not authorise', async () => {
        const recipient = { scope: 'customer' as const, contactId: randomUUID(), address: '+573001112233' };
        expect(await outcome(service.resolveSendContext(
            { tenantId: tenantA.id, channelType: 'whatsapp', channelAccountId: numbers.b1, recipient })))
            .toBe('refused:connection_not_found');
        expect(await outcome(service.resolveSendContext(
            { tenantId: tenantA.id, channelType: 'whatsapp', recipient })))
            .toBe('refused:connection_ambiguous');
    });
});
