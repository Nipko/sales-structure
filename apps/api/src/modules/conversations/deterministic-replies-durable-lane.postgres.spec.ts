import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL } from '../channels/agent-dispatch-outbox';
import { servedAgentAuthority } from '../persona/served-agent-authority';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { ConversationsService } from './conversations.service';

/**
 * ═══ THE REPLIES THAT LEAVE BEFORE THE MODEL IS EVEN ASKED ═══
 *
 * The turn's own answer travels as a batch through `dispatchReplyThroughOutbox`.
 * Beside it, this service sends seven single, deterministic replies and then
 * returns: the after-hours notice, two appointment-button answers, two
 * attendance answers, the handoff line and the quota fallback. Every one of them
 * went out through BullMQ, where Redis is the only record — a restart between
 * the decision and the POST lost the message, and a redelivery could repeat it
 * with nothing but a jobId in the way.
 *
 * They now commit a row first. Each is the ONLY effect its inbound produces,
 * which is exactly what lets it name that inbound as its origin — the outbox
 * identifies a row by `(inbound_message_id, item_index)`, so a second effect on
 * one customer message would collide with the first. That is also why the
 * turn's fan-out is NOT here.
 *
 * The orchestrator has forty-odd collaborators and building it whole would
 * prove nothing about this seam, so the two methods under test are exercised on
 * a real instance of the class with only what they touch — against real
 * PostgreSQL, the real store and the real lane. The oracle is the row.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the deterministic replies of a turn', () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const schema = `tenant_detrep_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550005555';
    const CUSTOMER = '573007776655';
    const LEGACY_CONFIG = { persona: { name: 'Ana' }, hours: { afterHoursMessage: 'cerrado' } };
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let lane: ProactiveDispatchService;
    let enqueued: any[];
    let published: string[];
    let publishFails: boolean;
    let contactId: string;
    let conversationId: string;
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const global = (text: string, ...params: any[]): Promise<any> =>
        client.$executeRawUnsafe(text, ...params);

    const rows = () => sql(
        `SELECT id, origin_kind, item_kind, payload, state, channel_account_id, recipient,
                conversation_id, contact_id, inbound_message_id, message_id, operational_scope
           FROM agent_dispatch_outbox ORDER BY item_index`);

    /** The agent this turn is served on behalf of, as the turn itself builds it. */
    const scope = () => servedAgentAuthority(tenantId, schema, {
        agentId: null, version: null, legacyConfigHash: revisionHash(LEGACY_CONFIG),
    });

    const msg = (over: Record<string, any> = {}) => ({
        tenantId, contactId: CUSTOMER, channelType: 'whatsapp', channelAccountId: NUMBER,
        content: { type: 'text', text: 'hola' }, timestamp: new Date(),
        // `id` is minted fresh by every adapter on every redelivery; the
        // provider's own id is the one in `metadata`, and it is what the
        // after-hours identity is derived from.
        id: randomUUID(), metadata: { waMessageId: 'wamid.IN1' }, ...over,
    }) as any;

    /**
     * The two private methods under test, named so the call sites stay typed.
     * They are internal on purpose — the seam they guard is not public API —
     * and this suite exercises exactly that seam.
     */
    type ReplySeam = {
        replyOnceThroughOutbox(input: {
            tenantId: string; conversation: any; msg: any;
            operationalScope?: any; item: { kind: string; payload: Record<string, any> };
            inboundMessageId?: string; originKey: string;
        }): Promise<boolean>;
        sendAfterHoursMessage(
            tenantId: string, msg: any, config: any, afterHoursText?: string,
            conversation?: any, operationalScope?: any): Promise<void>;
    };

    /**
     * A real `ConversationsService`, carrying only what these two methods
     * reach. Building all forty-odd collaborators would prove nothing about
     * this seam and would make the suite a test of the fakes.
     */
    const service = (over: { strict?: boolean; lane?: any } = {}): ReplySeam => {
        const instance: any = Object.create(ConversationsService.prototype);
        instance.proactiveDispatch = 'lane' in over ? over.lane : lane;
        instance.channelGateway = {
            getStrictTransport: () => (over.strict === false ? undefined : { channelType: 'whatsapp' }),
        };
        instance.outboundQueue = {
            enqueue: jest.fn(async (outbound: any) => { enqueued.push(outbound); }),
        };
        instance.channelToken = { getChannelToken: async () => ({ accessToken: 'tok' }) };
        instance.llmRouter = { execute: async () => { throw new Error('no model in this suite'); } };
        instance.logger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
        return instance as ReplySeam;
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

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            external_id TEXT, channel_type TEXT, name TEXT, phone TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        // The two tables the legacy served-agent authority is revalidated
        // against: no durable agents, and one active configuration whose hash
        // the scope carries.
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT, config_json JSONB, version INTEGER DEFAULT 1, channels TEXT[],
            channel_bindings TEXT[], schedule_mode TEXT DEFAULT '24_7',
            is_active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false)`);
        await sql(`CREATE TABLE persona_config(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            config_json JSONB, is_active BOOLEAN DEFAULT true, version INTEGER DEFAULT 1)`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

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
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_detrep_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        enqueued = [];
        published = [];
        publishFails = false;
        await sql('INSERT INTO persona_config(config_json, is_active) VALUES($1::jsonb, true)',
            [JSON.stringify(LEGACY_CONFIG)]);
        contactId = (await sql(
            `INSERT INTO contacts(external_id, channel_type, name, phone)
             VALUES($1,'whatsapp','Ana',$1) RETURNING id`, [CUSTOMER]))[0].id;
        conversationId = (await sql(
            `INSERT INTO conversations(contact_id, channel_type, channel_account_id)
             VALUES($1::uuid,'whatsapp',$2) RETURNING id`, [contactId, NUMBER]))[0].id;
    });

    afterEach(async () => {
        await sql('TRUNCATE agent_dispatch_outbox CASCADE');
        await sql('DELETE FROM messages');
        await sql('DELETE FROM conversations');
        await sql('DELETE FROM contacts');
        await sql('DELETE FROM persona_config');
    });

    const conversation = () => ({ id: conversationId, contact_id: contactId });

    const inbound = async (text = '¿hay turno?') => String((await sql(
        `INSERT INTO messages(conversation_id, direction, content_type, content_text)
         VALUES($1::uuid,'inbound','text',$2) RETURNING id`, [conversationId, text]))[0].id);

    // ── 0. NO CALL SITE MAY MINT A CONSTANT IDENTITY ────────────────────────

    it('gives every deterministic reply an identity of its own', () => {
        // Read from the source, because this is a property of the CALL SITES
        // and no fixture can reach them: the seven live inside a turn whose
        // orchestrator has forty-odd collaborators.
        //
        // An `originKey` that does not vary per effect is the worst thing this
        // seam can do. The outbox would merge every customer's confirmation
        // into one row and deliver exactly one of them — silence for everybody
        // else, and a record saying the message was owed once.
        // Normalised: the files on disk are CRLF and the blobs are LF, so a
        // pattern written either way has to match both.
        const source = readFileSync(join(__dirname, 'conversations.service.ts'), 'utf8')
            .split('\r\n').join('\n');
        const keys = [...source.matchAll(/originKey: `([^`]+)`/g)].map(match => match[1]);
        expect(keys.length).toBeGreaterThanOrEqual(7);
        for (const key of keys) {
            // Either the customer message it answers, or the identity the
            // BullMQ jobId carried. Both vary per effect; a bare string does not.
            expect(key).toMatch(/\$\{(inboundMessageId|dedupeId|input\.[A-Za-z.]+)\}/);
        }
        // And each one names WHICH reply it is, so two different answers to the
        // same customer message cannot collide on one row.
        expect(new Set(keys.map(key => key.split(':')[0])).size).toBe(keys.length);
    });

    // ── 1. AN ANSWER TO SOMETHING THE CUSTOMER SENT ─────────────────────────

    describe('a deterministic answer to a customer message', () => {
        it('commits a row and calls it what it is — a reply', async () => {
            // THE REPRODUCTION. These went out through BullMQ: Redis was the
            // only record, so a restart between the decision and the POST lost
            // the answer with nothing to retry from.
            const inboundMessageId = await inbound();
            const sent = await service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado ✅' } },
                originKey: `appt-confirm:${inboundMessageId}`,
            });
            expect(sent).toBe(true);
            expect(enqueued).toEqual([]);
            const [row] = await rows();
            expect(row.item_kind).toBe('text');
            expect(row.payload).toEqual({ text: 'Confirmado ✅' });
            // A service reply inside the 24-hour window. Calling it proactive
            // would misprice it AND let it past a ceiling meant for campaigns.
            expect(row.origin_kind).toBe('inbound_reply');
            expect(String(row.inbound_message_id)).toBe(inboundMessageId);
            expect(row.recipient).toBe(CUSTOMER);
            expect(row.channel_account_id).toBe(NUMBER);
            expect(published).toEqual([String(row.id)]);
        });

        it('writes the answer into the thread, pending', async () => {
            const inboundMessageId = await inbound();
            await service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: `appt-confirm:${inboundMessageId}`,
            });
            expect(await sql(
                `SELECT content_text, status FROM messages WHERE direction = 'outbound'`))
                .toEqual([{ content_text: 'Confirmado', status: 'pending' }]);
        });

        it('is sent on behalf of the agent that was serving the turn', async () => {
            const inboundMessageId = await inbound();
            await service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: `k:${inboundMessageId}`,
            });
            expect((await rows())[0].operational_scope).toMatchObject({
                kind: 'legacy', tenantId, schemaName: schema,
            });
        });

        it('collides on one row when the same answer is produced twice', async () => {
            // A reprocessed turn must not deliver the same confirmation again.
            const inboundMessageId = await inbound();
            const send = () => service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: `appt-confirm:${inboundMessageId}`,
            });
            expect(await send()).toBe(true);
            expect(await send()).toBe(true);
            expect(await rows()).toHaveLength(1);
        });

        it('survives two workers racing on the same answer', async () => {
            const inboundMessageId = await inbound();
            const send = () => service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: `appt-confirm:${inboundMessageId}`,
            });
            expect(await Promise.all([send(), send()])).toEqual([true, true]);
            expect(await rows()).toHaveLength(1);
        });

        it('fails the turn rather than claiming a reply to a foreign message',
            async () => {
                // An inbound id from another thread would let this row claim an
                // answer to something nobody wrote on this conversation.
                await expect(service().replyOnceThroughOutbox({
                    tenantId, conversation: conversation(), msg: msg(),
                    operationalScope: scope(), inboundMessageId: randomUUID(),
                    item: { kind: 'text', payload: { text: 'Confirmado' } },
                    originKey: 'k:foreign',
                })).rejects.toThrow(/^durable_reply_not_committed:refused:/);
                expect(await rows()).toHaveLength(0);
                expect(enqueued).toEqual([]);
            });
    });

    // ── 2. WHO IT IS SENT ON BEHALF OF, ASKED AGAIN ─────────────────────────

    describe('the agent behind the answer', () => {
        it('refuses to let it leave when the configuration changes first', async () => {
            // The words were chosen under one configuration. A tenant who edits
            // the agent between the decision and the POST has changed what the
            // business says, and the old answer is not covered by the new one.
            //
            // NOTE, and it is not this producer's to fix: the store treats a
            // changed agent revision as a RETRYABLE rejection — the row stays
            // available — while a revoked human operator or a stale policy is a
            // suppression. So this reply will be re-admitted and refused again
            // until its attempts run out, instead of being settled once. What is
            // asserted here is the part that matters to the customer: it does
            // not go out under a configuration nobody chose.
            const inboundMessageId = await inbound();
            await service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: `k:${inboundMessageId}`,
            });
            await sql(`UPDATE persona_config SET config_json = $1::jsonb WHERE is_active = true`,
                [JSON.stringify({ persona: { name: 'Otro' } })]);
            const [row] = await rows();
            // SUPPRESSED rather than refused-and-retried. The condition is a
            // configuration that changed, and no retry brings the old hash
            // back — so the row used to burn five attempts against a rule it
            // could never satisfy.
            await expect(store.admit(tenantId, String(row.id)))
                .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
            const [after] = await sql('SELECT state, receipt, error_code FROM agent_dispatch_outbox');
            expect(after.state).toBe('suppressed');
            expect(after.error_code).toContain('agent_operational_revision_changed');
            expect(after.receipt).toBeNull();
        });

        it('admits it when nothing about the agent changed', async () => {
            const inboundMessageId = await inbound();
            await service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: `k:${inboundMessageId}`,
            });
            const [row] = await rows();
            expect((await store.admit(tenantId, String(row.id))).row.state).toBe('admitted');
        });

        it('fails closed when the turn could not name an agent at all', async () => {
            await expect(service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: undefined, inboundMessageId: await inbound(),
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: 'k:no-scope',
            })).rejects.toThrow('durable_reply_binding_unavailable:k:no-scope');
            expect(await rows()).toHaveLength(0);
            expect(enqueued).toEqual([]);
        });
    });

    // ── 3. THE AFTER-HOURS NOTICE, WHICH ANSWERS NOTHING IT CAN NAME ────────

    describe('the after-hours notice', () => {
        const notice = (instance: ReplySeam, extra: Record<string, any> = {}) =>
            instance.sendAfterHoursMessage(tenantId, msg(extra),
                { hours: { afterHoursMessage: 'Estamos cerrados' } } as any,
                undefined, conversation(), scope());

        it('commits a row instead of trusting a BullMQ job id', async () => {
            // This branch answers and RETURNS before the inbound is stored, so
            // the `external_id` dedupe never sees it: the jobId was the only
            // thing between a redelivery and a second notice.
            await notice(service());
            expect(enqueued).toEqual([]);
            const [row] = await rows();
            expect(row.payload).toEqual({ text: 'Estamos cerrados' });
            // `proactive`, because it genuinely cannot prove it answers a stored
            // message — and the lane refuses a reply that names nothing.
            expect(row.origin_kind).toBe('proactive');
        });

        it('collides on one row when the provider redelivers the same message', async () => {
            // The identity is the same one the jobId carried, now a row: two
            // deliveries of one customer message owe one notice.
            await notice(service());
            await notice(service());
            expect(await rows()).toHaveLength(1);
            expect(enqueued).toEqual([]);
        });

        it('sends a second notice to a different customer message', async () => {
            await notice(service(), { metadata: { waMessageId: 'wamid.IN1' } });
            await notice(service(), { metadata: { waMessageId: 'wamid.IN2' } });
            expect(await sql('SELECT count(*)::int AS n FROM agent_dispatch_outbox'))
                .toEqual([{ n: 2 }]);
        });

        it.each([
            ['no lane is wired in', { lane: undefined }],
            ['the channel has no strict transport', { strict: false }],
        ])('fails closed when %s', async (_why, over) => {
            await expect(notice(service(over))).rejects.toThrow(/^durable_reply_/);
            expect(await rows()).toHaveLength(0);
            expect(enqueued).toEqual([]);
        });

        it('fails closed when the message has no provider identity', async () => {
            // Without one there is no stable key, and a constant key would merge
            // every customer's notice into one row and deliver exactly one.
            await expect(notice(service(), { metadata: {} }))
                .rejects.toThrow('after_hours_durable_identity_unavailable');
            expect(await rows()).toHaveLength(0);
            expect(enqueued).toEqual([]);
        });

        it('fails closed when the thread is not known', async () => {
            const instance = service();
            await expect(instance.sendAfterHoursMessage(tenantId, msg(),
                { hours: { afterHoursMessage: 'Estamos cerrados' } } as any,
                undefined, undefined, scope()))
                .rejects.toThrow('after_hours_durable_identity_unavailable');
            expect(await rows()).toHaveLength(0);
            expect(enqueued).toEqual([]);
        });
    });

    // ── 4. WHAT SURVIVES WHEN SOMETHING ELSE BREAKS ─────────────────────────

    describe('when the machinery around it fails', () => {
        const commit = async () => {
            const inboundMessageId = await inbound();
            await service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId,
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: `k:${inboundMessageId}`,
            });
            return (await rows())[0];
        };

        it('keeps the committed row when the queue cannot be published to', async () => {
            publishFails = true;
            const row = await commit();
            expect(published).toEqual([]);
            // And it never falls back to the legacy queue on a publish failure:
            // the row exists, so a second path would be a second message.
            expect(enqueued).toEqual([]);
            expect((await store.admit(tenantId, String(row.id))).row.state).toBe('admitted');
        });

        it('leaves a provider rejection retryable, with the words intact', async () => {
            const row = await commit();
            const admitted = await store.admit(tenantId, String(row.id));
            await store.settle(tenantId, String(row.id), admitted.leaseToken,
                { kind: 'failed', errorCode: 'rate_limited' } as any);
            const [after] = await sql(
                'SELECT state, error_code, payload FROM agent_dispatch_outbox');
            expect(after.state).toBe('failed');
            expect(after.error_code).toBe('rate_limited');
            expect(after.payload).toEqual({ text: 'Confirmado' });
        });

        it('never re-admits an answer whose outcome nobody knows', async () => {
            const row = await commit();
            const admitted = await store.admit(tenantId, String(row.id));
            await store.settle(tenantId, String(row.id), admitted.leaseToken,
                { kind: 'reconciliation_required', errorCode: 'timeout' } as any);
            expect((await sql('SELECT state FROM agent_dispatch_outbox'))[0].state)
                .toBe('reconciliation_required');
            await expect(store.admit(tenantId, String(row.id))).rejects.toBeDefined();
        });

        it('fails closed when the lane defers instead of committing', async () => {
            // Only `prepared` and `already_present` mean the effect exists.
            // `deferred` is nothing written for a reason that may pass, and a
            // producer that read it as success would leave the customer with
            // silence and the record with a message that never was.
            const deferring = new ProactiveDispatchService(prisma, {
                prepare: async () => { throw new Error('database unavailable'); },
                publishBatch: async () => 0,
            } as any, { enqueueDispatch: async () => undefined } as any);
            await expect(service({ lane: deferring }).replyOnceThroughOutbox({
                tenantId, conversation: conversation(), msg: msg(),
                operationalScope: scope(), inboundMessageId: await inbound(),
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: 'k:deferred',
            })).rejects.toThrow(/^durable_reply_not_committed:deferred:/);
            expect(await rows()).toHaveLength(0);
            expect(enqueued).toEqual([]);
        });

        it('fails closed for a thread that does not name its connection', async () => {
            await expect(service().replyOnceThroughOutbox({
                tenantId, conversation: conversation(),
                msg: msg({ channelAccountId: '' }),
                operationalScope: scope(), inboundMessageId: await inbound(),
                item: { kind: 'text', payload: { text: 'Confirmado' } },
                originKey: 'k:no-account',
            })).rejects.toThrow('durable_reply_binding_unavailable:k:no-account');
            expect(await rows()).toHaveLength(0);
            expect(enqueued).toEqual([]);
        });
    });
});
