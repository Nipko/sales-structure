import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL } from '../channels/agent-dispatch-outbox';
import { ChannelTokenService } from '../channels/channel-token.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { WhatsappController, derivedRestIdempotencyKey, realActingUserId } from './whatsapp.controller';

/**
 * ═══ THE TENANT'S OWN SEND API, ON THE DURABLE LANE ═══
 *
 * Five routes — template, text, interactive, media, location — used to POST to
 * Meta on the request's own stack. No row, no lease, no receipt: a restart
 * between the decision and the call lost the message, a client retry after a
 * timeout sent it twice, and nothing could refuse the spend before it happened.
 * From 1 October 2026 each of those is a separate charge.
 *
 * Every assertion here is against real PostgreSQL, the real
 * `AgentDispatchOutboxStore`, the real `ProactiveDispatchService` and the real
 * `ChannelTokenService`. The oracle is the outbox row — its origin, its state,
 * its scope — never the return value of the call that wrote it.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the tenant send API on the durable lane', () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const schema = `tenant_warest_${randomUUID().replace(/-/g, '')}`;
    /** The tenant's only sendable number, and therefore the one that pays. */
    const NUMBER = '15550002222';
    const SECOND_NUMBER = '15550003333';
    const CUSTOMER = '573001112233';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let lane: ProactiveDispatchService;
    let tokens: ChannelTokenService;
    let messaging: any;
    let published: string[];
    let publishFails: boolean;
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const global = (text: string, ...params: any[]): Promise<any> =>
        client.$executeRawUnsafe(text, ...params);

    /** A person, in the synthetic `public.users` every PostgreSQL suite shares. */
    const minted: string[] = [];
    const user = async (over: Record<string, any> = {}) => {
        const id = randomUUID();
        const row = { role: 'tenant_admin', is_active: true, tenant_id: tenantId, ...over };
        await global(
            `INSERT INTO public.users(id, first_name, last_name, role, tenant_id, is_active)
             VALUES($1::uuid, 'Ana', 'Operadora', $2, $3::uuid, $4)`,
            id, row.role, row.tenant_id === null ? null : row.tenant_id, row.is_active);
        minted.push(id);
        return id;
    };

    const req = (userId: string, over: Record<string, any> = {}) =>
        ({ user: { id: userId, tenantId, schemaName: schema, ...over } }) as any;

    const rows = () => sql(
        `SELECT id, origin_kind, item_kind, payload, state, channel_account_id, recipient,
                conversation_id, contact_id, inbound_message_id, operational_scope
           FROM agent_dispatch_outbox ORDER BY item_index`);

    const controller = () => new WhatsappController(
        {} as any, {} as any, {} as any, messaging, prisma, {} as any, tokens, undefined, lane);

    /** A second sendable number, so an unnamed sender has no answer. */
    const secondNumber = async () => {
        await sql(`INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id, access_token_ref,
                        channel_status, connected_at)
                   VALUES($1,'waba-2','tok-2','connected', NOW())`, [SECOND_NUMBER]);
        await global(`INSERT INTO public.channel_accounts(id, tenant_id, channel_type, account_id, is_active)
                      VALUES(gen_random_uuid(), $1::uuid, 'whatsapp', $2, true)`,
        tenantId, SECOND_NUMBER);
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await global('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            tenantId, schema);
        await global('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            otherTenantId, `${schema}_other`);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.getTenantSchemaName = async () => schema;
        // The two global models `ChannelTokenService` reads, answered from the
        // synthetic tables rather than by a stub that agrees with the code under
        // test: a fake computing the answer the same way approves a wrong one.
        prisma.channelAccount = {
            findFirst: async ({ where }: any) => {
                const found = await client.$queryRawUnsafe<any[]>(
                    `SELECT is_active FROM public.channel_accounts
                      WHERE tenant_id = $1::uuid AND channel_type = $2 AND account_id = $3 LIMIT 1`,
                    where.tenantId, where.channelType, where.accountId);
                return found?.[0] ? { isActive: found[0].is_active } : null;
            },
        };
        // No system-user credential here, so the channel row's own token signs —
        // one of the two shapes production actually has.
        prisma.whatsappCredential = { findFirst: async () => null };

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            external_id TEXT, channel_type TEXT, name TEXT, phone TEXT, phone_normalized TEXT,
            email TEXT, avatar_url TEXT)`);
        await sql(`CREATE UNIQUE INDEX uidx_contacts_channel_type_external_id
            ON contacts(channel_type, external_id)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE whatsapp_channels(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone_number_id TEXT, meta_waba_id TEXT, meta_business_id TEXT,
            display_phone_number TEXT, access_token_ref TEXT, channel_status TEXT,
            connected_at TIMESTAMPTZ DEFAULT NOW())`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        await sql(`INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id, access_token_ref,
                        channel_status, connected_at)
                   VALUES($1,'waba-1','tok-1','connected', NOW())`, [NUMBER]);
        await global(`INSERT INTO public.channel_accounts(id, tenant_id, channel_type, account_id, is_active)
                      VALUES(gen_random_uuid(), $1::uuid, 'whatsapp', $2, true)`, tenantId, NUMBER);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        published = [];
        publishFails = false;
        lane = new ProactiveDispatchService(prisma, store, {
            enqueueDispatch: async (_tenant: string, dispatchId: string) => {
                if (publishFails) throw new Error('redis_unreachable');
                published.push(dispatchId);
            },
        } as any);
        // The real resolver. A Redis whose read throws sends every resolution to
        // PostgreSQL, which is where the refusal rules actually live.
        tokens = new ChannelTokenService(prisma, {
            getClient: () => ({ get: async () => { throw new Error('no_redis_in_this_suite'); } }),
        } as any, { decryptToken: () => 'tok-1' } as any);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_warest_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
            await client.$executeRawUnsafe(
                'DELETE FROM public.channel_accounts WHERE tenant_id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
        } finally { await client.$disconnect(); }
    });

    beforeEach(() => {
        published = [];
        publishFails = false;
        messaging = {
            sendTemplate: jest.fn(async () => ({ success: true, messageId: 'wamid.inline' })),
            sendTextMessage: jest.fn(async () => ({ success: true, messageId: 'wamid.inline' })),
            sendInteractiveMessage: jest.fn(async () => ({ success: true, messageId: 'wamid.inline' })),
            sendMediaMessage: jest.fn(async () => ({ success: true, messageId: 'wamid.inline' })),
            sendLocationMessage: jest.fn(async () => ({ success: true, messageId: 'wamid.inline' })),
        };
    });

    afterEach(async () => {
        await sql('TRUNCATE agent_dispatch_outbox CASCADE');
        await sql('DELETE FROM messages');
        await sql('DELETE FROM conversations');
        await sql('DELETE FROM contacts');
        await sql('DELETE FROM whatsapp_channels WHERE phone_number_id <> $1', [NUMBER]);
        await global('DELETE FROM public.channel_accounts WHERE account_id = $1', SECOND_NUMBER);
        if (minted.length) {
            await client.$executeRawUnsafe(
                'DELETE FROM public.users WHERE id = ANY($1::uuid[])', minted.splice(0));
        }
    });

    // ── 1. A ROW EXISTS BEFORE ANYTHING LEAVES ──────────────────────────────

    describe('what a send now leaves behind', () => {
        it('commits a durable row instead of posting to Meta on the request stack', async () => {
            // THE REPRODUCTION. Before this migration the call went straight to
            // the messaging service, which POSTs inline: nothing in the database
            // said the effect was ever owed, so a restart here lost it and a
            // retry sent it twice.
            const answer = await controller().sendText(req(await user()),
                { toPhone: `+${CUSTOMER}`, text: 'hola' } as any);

            expect(messaging.sendTextMessage).not.toHaveBeenCalled();
            const committed = await rows();
            expect(committed).toHaveLength(1);
            expect(committed[0].item_kind).toBe('text');
            expect(committed[0].payload).toEqual({ text: 'hola' });
            expect(committed[0].recipient).toBe(CUSTOMER);
            expect(answer).toMatchObject({
                success: true, status: 'prepared', duplicate: false, phoneNumberId: NUMBER,
            });
            // Committed, THEN published. The row is the record; the queue is a hint.
            expect(published).toEqual([String(committed[0].id)]);
        });

        it('records the outbound in the thread, pending, before it is sent', async () => {
            // The history row is not bookkeeping: it is what the agent reads and
            // what the receipt ties back to. It used to say `delivered` before
            // anything had left the building.
            await controller().sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            const [message] = await sql(
                `SELECT direction, content_text, status FROM messages`);
            expect(message).toMatchObject({
                direction: 'outbound', content_text: 'hola', status: 'pending',
            });
        });

        it.each([
            ['template', (c: WhatsappController, r: any) => c.sendTemplate(r, {
                toPhone: CUSTOMER, templateName: 'recordatorio', language: 'es',
                components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
            } as any), { templateName: 'recordatorio', language: 'es',
                components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }] }],
            ['interactive', (c: WhatsappController, r: any) => c.sendInteractive(r, {
                toPhone: CUSTOMER,
                interactive: {
                    type: 'button', header: { type: 'text', text: '¿Cuál?' },
                    body: { text: 'Elegí un horario' }, footer: { text: 'Parallly' },
                    action: { buttons: [{ type: 'reply', reply: { id: 'a', title: 'Lunes' } }] },
                },
            } as any), { type: 'button', body: 'Elegí un horario', headerText: '¿Cuál?',
                footerText: 'Parallly',
                action: { buttons: [{ type: 'reply', reply: { id: 'a', title: 'Lunes' } }] } }],
            ['media', (c: WhatsappController, r: any) => c.sendMedia(r, {
                toPhone: CUSTOMER, mediaType: 'image', mediaUrl: 'https://x/y.jpg', caption: 'mirá',
            } as any), { mediaType: 'image', mediaUrl: 'https://x/y.jpg', caption: 'mirá' }],
            ['location', (c: WhatsappController, r: any) => c.sendLocation(r, {
                toPhone: CUSTOMER, latitude: 4.65, longitude: -74.05, name: 'Local', address: 'Cra 7',
            } as any), { latitude: 4.65, longitude: -74.05, name: 'Local', address: 'Cra 7' }],
        ])('carries a %s as its own durable item', async (kind, call, payload) => {
            // `interactive` and `location` had NO durable representation at all
            // until this batch, which is why these two routes could not leave the
            // inline path however much anybody wanted them to.
            await call(controller(), req(await user()));
            const [row] = await rows();
            expect(row.item_kind).toBe(kind);
            expect(row.payload).toEqual(payload);
        });

        it('names the person who sent it, and the surface they sent from', async () => {
            const userId = await user({ role: 'tenant_agent' });
            await controller().sendText(req(userId), { toPhone: CUSTOMER, text: 'hola' } as any);
            const [row] = await rows();
            expect(row.operational_scope).toMatchObject({
                kind: 'human_operator', userId, surface: 'tenant_api',
                channelType: 'whatsapp', channelAccountId: NUMBER, tenantId,
            });
        });

        it('attributes an impersonated send to the real super_admin', async () => {
            // `req.user` during impersonation IS the tenant admin being acted
            // as. Recording them would tell an auditor the customer sent it to
            // their own customers.
            const operator = await user({ role: 'super_admin', tenant_id: null });
            const impersonated = await user({ role: 'tenant_admin' });
            await controller().sendText(
                req(impersonated, { isImpersonation: true, impersonatedBy: operator }),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            const [row] = await rows();
            expect(row.operational_scope.userId).toBe(operator);
        });

        it('reads the real actor out of an ordinary session and an impersonated one', () => {
            expect(realActingUserId({ id: 'a' })).toBe('a');
            expect(realActingUserId({ sub: 'b' })).toBe('b');
            expect(realActingUserId({ id: 'a', isImpersonation: true, impersonatedBy: 'ops' }))
                .toBe('ops');
            // A session flagged as impersonation with nobody behind it falls back
            // to the effective user rather than to an empty sender.
            expect(realActingUserId({ id: 'a', isImpersonation: true })).toBe('a');
        });
    });

    // ── 2. ONE EFFECT, HOWEVER MANY TIMES IT IS ASKED FOR ───────────────────

    describe('a retry of the same send', () => {
        it('collides on one row when the caller supplied no key', async () => {
            // A client that timed out and retried sends the identical bytes. The
            // derived key makes that one effect, and the answer says so instead
            // of pretending a second message went out.
            const userId = await user();
            const first = await controller().sendText(req(userId),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            const second = await controller().sendText(req(userId),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            expect(first).toMatchObject({ status: 'prepared', duplicate: false });
            expect(second).toMatchObject({ status: 'already_present', duplicate: true });
            expect(second.originId).toBe(first.originId);
            expect(await rows()).toHaveLength(1);
        });

        it('keeps two deliberate identical sends apart when the caller names them', async () => {
            // The cost of the derived key, paid explicitly: a business that means
            // to send "¿seguís ahí?" twice says which is which, and gets two.
            const userId = await user();
            await controller().sendText(req(userId),
                { toPhone: CUSTOMER, text: '¿seguís ahí?', idempotencyKey: 'nudge-1' } as any);
            await controller().sendText(req(userId),
                { toPhone: CUSTOMER, text: '¿seguís ahí?', idempotencyKey: 'nudge-2' } as any);
            expect(await rows()).toHaveLength(2);
        });

        it('takes the key from the Idempotency-Key header too', async () => {
            const userId = await user();
            const first = await controller().sendText(req(userId),
                { toPhone: CUSTOMER, text: 'hola' } as any, 'req-77');
            const second = await controller().sendText(req(userId),
                { toPhone: CUSTOMER, text: 'OTRA COSA' } as any, 'req-77');
            // Same key, different words: the FIRST effect owns the identity, and
            // the second attempt is told it already exists rather than quietly
            // replacing what was committed.
            expect(first.status).toBe('prepared');
            expect(second.status).toBe('already_present');
            expect(await sql(`SELECT payload FROM agent_dispatch_outbox`))
                .toEqual([{ payload: { text: 'hola' } }]);
        });

        it('survives two workers racing on the same request', async () => {
            const userId = await user();
            const [a, b] = await Promise.all([
                controller().sendText(req(userId), { toPhone: CUSTOMER, text: 'carrera' } as any),
                controller().sendText(req(userId), { toPhone: CUSTOMER, text: 'carrera' } as any),
            ]);
            // ONE row and one identity: that is the invariant, and it holds
            // under every interleaving.
            expect(await rows()).toHaveLength(1);
            expect(a.originId).toBe(b.originId);
            // Both report a durable effect. Neither may report a failure for
            // something that exists.
            expect(a.success && b.success).toBe(true);
            for (const status of [a.status, b.status]) {
                expect(['prepared', 'already_present']).toContain(status);
            }
            // Deliberately NOT `['already_present', 'prepared']`. That pair
            // looks like the stronger assertion and is not an invariant:
            // `already_present` is computed from the ROW's state — "a previous
            // attempt got further" — not from "I was second. When both callers
            // reach `prepare` before either publishes, the row is still
            // `prepared` and both of them honestly say so. The suite passed for
            // hours and failed inside a full run, which is the only reason it
            // was noticed.
        });

        it('does not open two threads for the same customer under a race', async () => {
            // A second conversation on one number splits the person's history in
            // two: the agent sees half, and the customer's reply lands where
            // nobody is looking.
            const userId = await user();
            await Promise.all([
                controller().sendText(req(userId),
                    { toPhone: CUSTOMER, text: 'a', idempotencyKey: 'one' } as any),
                controller().sendText(req(userId),
                    { toPhone: CUSTOMER, text: 'b', idempotencyKey: 'two' } as any),
            ]);
            expect(await sql('SELECT count(*)::int AS n FROM conversations')).toEqual([{ n: 1 }]);
            expect(await sql('SELECT count(*)::int AS n FROM contacts')).toEqual([{ n: 1 }]);
        });

        it('derives the same key however the payload was serialised', () => {
            // A client library that reorders JSON fields must not turn a retry
            // into a second charge.
            const base = {
                tenantId, channelAccountId: NUMBER, recipient: CUSTOMER, kind: 'media' as const,
            };
            expect(derivedRestIdempotencyKey({
                ...base, payload: { mediaUrl: 'u', caption: 'c', mediaType: 'image' },
            })).toBe(derivedRestIdempotencyKey({
                ...base, payload: { mediaType: 'image', caption: 'c', mediaUrl: 'u' },
            }));
            expect(derivedRestIdempotencyKey({ ...base, payload: { mediaUrl: 'u' } }))
                .not.toBe(derivedRestIdempotencyKey({ ...base, payload: { mediaUrl: 'v' } }));
        });
    });

    // ── 3. THE NUMBER THAT PAYS IS NEVER GUESSED ────────────────────────────

    describe('which WhatsApp Business Account is billed', () => {
        it('refuses an unnamed sender once the tenant has two numbers', async () => {
            await secondNumber();
            await expect(controller().sendText(await req(await user()),
                { toPhone: CUSTOMER, text: 'hola' } as any))
                .rejects.toMatchObject({ response: { code: 'connection_ambiguous' } });
            // And it refuses BEFORE writing anything. A row committed against a
            // number nobody chose is a charge nobody authorised.
            expect(await rows()).toHaveLength(0);
        });

        it('sends from the number the caller named, on the same two-number tenant', async () => {
            await secondNumber();
            const answer = await controller().sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola', phoneNumberId: SECOND_NUMBER } as any);
            expect(answer.phoneNumberId).toBe(SECOND_NUMBER);
            expect((await rows())[0].channel_account_id).toBe(SECOND_NUMBER);
        });

        it('still accepts the deprecated name for the sender', async () => {
            await secondNumber();
            const answer = await controller().sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola', fromPhoneNumberId: SECOND_NUMBER } as any);
            expect(answer.phoneNumberId).toBe(SECOND_NUMBER);
        });

        it('refuses two names that disagree rather than picking one', async () => {
            await secondNumber();
            await expect(controller().sendText(req(await user()), {
                toPhone: CUSTOMER, text: 'hola',
                phoneNumberId: NUMBER, fromPhoneNumberId: SECOND_NUMBER,
            } as any)).rejects.toThrow(/obsoleto|distintos/);
            expect(await rows()).toHaveLength(0);
        });

        it('refuses to write into a thread that belongs to another connection', async () => {
            // The account on the row is the account Meta bills. A conversation on
            // one number cannot carry an effect leaving another.
            await secondNumber();
            const [contact] = await sql(
                `INSERT INTO contacts(external_id, channel_type, name, phone)
                 VALUES($1,'whatsapp','Ana',$1) RETURNING id`, [CUSTOMER]);
            const [other] = await sql(
                `INSERT INTO conversations(contact_id, channel_type, channel_account_id)
                 VALUES($1::uuid,'whatsapp',$2) RETURNING id`, [contact.id, SECOND_NUMBER]);
            await expect(controller().sendText(req(await user()), {
                toPhone: CUSTOMER, text: 'hola',
                phoneNumberId: NUMBER, conversationId: String(other.id),
            } as any)).rejects.toThrow(/otra conexión/);
            expect(await rows()).toHaveLength(0);
        });
    });

    // ── 4. WHO MAY SEND, ASKED AGAIN WHEN IT MATTERS ────────────────────────

    describe('the person behind the request', () => {
        it('refuses a deactivated account before a row exists', async () => {
            await expect(controller().sendText(req(await user({ is_active: false })),
                { toPhone: CUSTOMER, text: 'hola' } as any)).rejects.toThrow(/ya no puede enviar/);
            expect(await rows()).toHaveLength(0);
        });

        it('refuses a role with no sending rights', async () => {
            await expect(controller().sendText(req(await user({ role: 'read_only_auditor' })),
                { toPhone: CUSTOMER, text: 'hola' } as any)).rejects.toThrow(/ya no puede enviar/);
            expect(await rows()).toHaveLength(0);
        });

        it('suppresses a committed effect when the sender is deactivated before it leaves',
            async () => {
                // THE CASE THE AUTHORITY EXISTS FOR. Somebody is removed after
                // asking for a send; the queued message must not go out
                // afterwards. Authentication at the edge proved who ASKED.
                const userId = await user();
                const answer = await controller().sendText(req(userId),
                    { toPhone: CUSTOMER, text: 'hola' } as any);
                expect(answer.status).toBe('prepared');
                await global('UPDATE public.users SET is_active = false WHERE id = $1::uuid', userId);
                const [row] = await rows();
                await expect(store.admit(tenantId, String(row.id)))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                const [after] = await sql(
                    'SELECT state, error_code FROM agent_dispatch_outbox');
                expect(after.state).toBe('suppressed');
                expect(after.error_code).toContain('human_revoked');
            });

        it('suppresses it when the sender is demoted before it leaves', async () => {
            const userId = await user({ role: 'tenant_admin' });
            await controller().sendText(req(userId), { toPhone: CUSTOMER, text: 'hola' } as any);
            await global(`UPDATE public.users SET role = 'read_only_auditor' WHERE id = $1::uuid`,
                userId);
            const [row] = await rows();
            await expect(store.admit(tenantId, String(row.id)))
                .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
            expect((await sql('SELECT state FROM agent_dispatch_outbox'))[0].state)
                .toBe('suppressed');
        });

        it('admits it when nothing about the person changed', async () => {
            await controller().sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            const [row] = await rows();
            const admitted = await store.admit(tenantId, String(row.id));
            expect(admitted.row.state).toBe('admitted');
        });
    });

    // ── 5. WHAT SURVIVES WHEN SOMETHING ELSE BREAKS ─────────────────────────

    describe('when the machinery around it fails', () => {
        it('keeps the committed row when the queue cannot be published to', async () => {
            // The asymmetry the durable lane exists for: the row is the record,
            // the queue is a hint. A publish that fails is recovered from the
            // row, so the caller is told the truth — the effect IS owed.
            publishFails = true;
            const answer = await controller().sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            expect(answer).toMatchObject({ success: true, status: 'prepared' });
            expect(published).toEqual([]);
            const [row] = await rows();
            // The store marks it `queued` even though the publish threw — it
            // swallows the publish error and marks anyway. That is bookkeeping
            // this producer does not control, and it costs nothing HERE because
            // `queued` is an available state: the effect is still admittable and
            // the recovery pass still finds it. What matters, and what is
            // asserted, is that nothing was lost.
            expect(['prepared', 'queued']).toContain(row.state);
            const admitted = await store.admit(tenantId, String(row.id));
            expect(admitted.row.state).toBe('admitted');
        });

        it('leaves a provider rejection retryable, with its payload intact', async () => {
            await controller().sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            const [row] = await rows();
            const admitted = await store.admit(tenantId, String(row.id));
            await store.settle(tenantId, String(row.id), admitted.leaseToken,
                { kind: 'failed', errorCode: 'rate_limited' } as any);
            const [after] = await sql(
                'SELECT state, error_code, payload, attempts FROM agent_dispatch_outbox');
            expect(after.state).toBe('failed');
            expect(after.error_code).toBe('rate_limited');
            expect(after.payload).toEqual({ text: 'hola' });
            // Incremented in the admission transaction, which commits before the
            // request — so a rolled-back send cannot reset it and loop for ever.
            expect(after.attempts).toBe(1);
        });

        it('never re-admits an effect whose outcome nobody knows', async () => {
            // Silence is not evidence of failure. The provider may have acted,
            // so a second POST is the one thing that must not happen.
            await controller().sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola' } as any);
            const [row] = await rows();
            const admitted = await store.admit(tenantId, String(row.id));
            await store.settle(tenantId, String(row.id), admitted.leaseToken,
                { kind: 'reconciliation_required', errorCode: 'timeout' } as any);
            expect((await sql('SELECT state FROM agent_dispatch_outbox'))[0].state)
                .toBe('reconciliation_required');
            await expect(store.admit(tenantId, String(row.id))).rejects.toBeDefined();
        });

        it('refuses the send outright when the durable lane is not wired in', async () => {
            // No silent fall back to the inline POST: a degraded mode that
            // quietly restored it would make the guarantee unprovable.
            const without = new WhatsappController(
                {} as any, {} as any, {} as any, messaging, prisma, {} as any, tokens);
            await expect(without.sendText(req(await user()),
                { toPhone: CUSTOMER, text: 'hola' } as any)).rejects.toThrow(/carril durable/);
            expect(messaging.sendTextMessage).not.toHaveBeenCalled();
        });
    });

    // ── 6. WHAT IT IS, FOR THE BILL ─────────────────────────────────────────

    it('is billed as proactive, because nobody wrote to us', async () => {
        // An API send answers nothing: the business started it. Calling it a
        // reply would misprice it and let it past a ceiling meant for campaigns.
        await controller().sendText(req(await user()),
            { toPhone: CUSTOMER, text: 'hola' } as any);
        expect((await rows())[0].origin_kind).toBe('proactive');
    });
});
