import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL } from '../channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import {
    permissiveSpendGate, resolvingChannelToken, openPauseStore,
} from '../channels/__fixtures__/spend-gate-double';
import { AgentConsoleService } from './agent-console.service';
import { WhatsAppAdapter } from '../channels/whatsapp/whatsapp.adapter';

/**
 * ═══ WHAT A PERSON'S REPLY LEAVES BEHIND ═══
 *
 * The agent console POSTed to the provider on the request's own stack, inside a
 * `catch` that only warned. There was no row, no lease and no receipt: a
 * restart between the decision and the call lost a human being's reply, and the
 * inbox had already been told something about it.
 *
 * It now commits a row first. Two things about that migration are contested and
 * both are pinned here: which effect the row IS (§2), and what the lane will
 * NOT let it say about itself (§5 — a limitation of the outbox, reproduced
 * rather than worked around).
 *
 * Real PostgreSQL, the real store, the real lane. The oracle is the row.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('a human agent reply on the durable lane', () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const schema = `tenant_wacons_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550004444';
    const CUSTOMER = '573009998877';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let lane: ProactiveDispatchService;
    let gateway: any;
    let sendStrict: jest.Mock;
    let published: string[];
    let publishFails: boolean;
    let contactId: string;
    let conversationId: string;
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const global = (text: string, ...params: any[]): Promise<any> =>
        client.$executeRawUnsafe(text, ...params);

    const minted: string[] = [];
    const agent = async (over: Record<string, any> = {}) => {
        const id = randomUUID();
        const row = { role: 'tenant_agent', is_active: true, tenant_id: tenantId, ...over };
        await global(
            `INSERT INTO public.users(id, first_name, last_name, role, tenant_id, is_active)
             VALUES($1::uuid, 'Ana', 'Agente', $2, $3::uuid, $4)`,
            id, row.role, row.tenant_id === null ? null : row.tenant_id, row.is_active);
        minted.push(id);
        return id;
    };

    const rows = () => sql(
        `SELECT id, origin_kind, item_kind, payload, state, channel_account_id, recipient,
                conversation_id, contact_id, inbound_message_id, message_id, operational_scope
           FROM agent_dispatch_outbox ORDER BY item_index`);

    const service = (over: {
        strict?: boolean; lane?: any; outcome?: any; spend?: any;
    } = {}) => {
        // The inline path uses the STRICT transport on a channel Meta bills,
        // so the double has to be able to answer rather than only to exist:
        // `getStrictTransport` used to return a `channelType` and nothing
        // else, which was enough to decide whether the durable lane was
        // possible and not enough to send anything.
        sendStrict = jest.fn(async () => over.outcome
            ?? { kind: 'accepted', receipt: 'wamid.STRICT' });
        gateway = {
            sendMessage: jest.fn(async () => ({ messageId: 'wamid.INLINE' })),
            getStrictTransport: jest.fn(() => (over.strict === false
                ? undefined
                : { channelType: 'whatsapp', sendStrict })),
        };
        return new AgentConsoleService(
            prisma, { get: async () => null, set: async () => undefined, del: async () => undefined } as any,
            gateway,
            resolvingChannelToken({
                getChannelToken: jest.fn(async () => ({ accessToken: 'tok', accountId: NUMBER })) }),
            {} as any, {} as any, { emit: jest.fn() } as any,
            { ensureResolutionColumns: async () => undefined } as any,
            over.spend ?? permissiveSpendGate(),
            openPauseStore(),
            undefined,
            'lane' in over ? over.lane : lane);
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
        // ── THE CONNECTION THE MESSAGE LEAVES FROM ──────────────────────────
        //
        // Production never has a durable row bound to a connection that does
        // not exist: the producer reads the account before it prepares. The
        // human-operator authority now revalidates that the connection is still
        // this tenant's and still live — the fourth thing its docblock always
        // promised and did not check — so the fixture has to hold one too, or
        // it would be asserting against a state the product cannot be in.
        await global(
            `INSERT INTO public.channel_accounts(id, tenant_id, channel_type, account_id, is_active)
             VALUES(gen_random_uuid(), $1::uuid, 'whatsapp', $2, true)`,
            tenantId, NUMBER);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.getTenantSchemaName = async () => schema;
        prisma.$queryRaw = async () => [{ schema_name: schema }];

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            external_id TEXT, channel_type TEXT, name TEXT, phone TEXT, email TEXT,
            tags TEXT[], metadata JSONB DEFAULT '{}'::jsonb,
            first_contact_at TIMESTAMPTZ DEFAULT NOW(), lifetime_value NUMERIC DEFAULT 0,
            segment TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}'::jsonb,
            was_handed_off BOOLEAN DEFAULT false, handoff_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE internal_notes(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID, agent_id UUID, content TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE conversation_assignments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID, agent_id UUID, first_response_at TIMESTAMPTZ,
            resolved_at TIMESTAMPTZ)`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
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
            if (!/^tenant_wacons_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe(
                'DELETE FROM public.channel_accounts WHERE tenant_id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        publishFails = false;
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
        await sql('DELETE FROM conversation_assignments');
        await sql('DELETE FROM conversations');
        await sql('DELETE FROM contacts');
        if (minted.length) {
            await client.$executeRawUnsafe(
                'DELETE FROM public.users WHERE id = ANY($1::uuid[])', minted.splice(0));
        }
    });

    // ── 1. THE DEFECT ───────────────────────────────────────────────────────

    describe('what the reply leaves behind', () => {
        it('commits a row instead of POSTing on the request stack', async () => {
            // THE REPRODUCTION. The reply used to go out inline, inside a catch
            // that only warned: a restart between the history write and the POST
            // lost a person's answer with nothing to retry from.
            const agentId = await agent();
            const message = await service()
                .sendAgentMessage(tenantId, conversationId, agentId, 'Ya lo reviso');

            expect(gateway.sendMessage).not.toHaveBeenCalled();
            const committed = await rows();
            expect(committed).toHaveLength(1);
            expect(committed[0].item_kind).toBe('text');
            expect(committed[0].payload).toEqual({ text: 'Ya lo reviso' });
            expect(committed[0].recipient).toBe(CUSTOMER);
            expect(committed[0].channel_account_id).toBe(NUMBER);
            expect(published).toEqual([String(committed[0].id)]);
            // The history row is the one `prepare` wrote, in the same
            // transaction as the outbox row — not a second, independent write.
            expect(message.id).toBe(String(committed[0].message_id));
            expect(message.status).toBe('pending');
            expect(message.content).toBe('Ya lo reviso');
        });

        it('names the person who sent it, and says it came from the console', async () => {
            const agentId = await agent();
            await service().sendAgentMessage(tenantId, conversationId, agentId, 'hola');
            expect((await rows())[0].operational_scope).toMatchObject({
                kind: 'human_operator', userId: agentId, surface: 'agent_console',
                channelType: 'whatsapp', channelAccountId: NUMBER, tenantId,
            });
        });

        it('marks the transcript mixed before it commits anything', async () => {
            // A human-authored reply must not let a quality score credit the AI
            // with a conversation a person finished.
            await service().sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            expect((await sql('SELECT was_handed_off FROM conversations'))[0].was_handed_off)
                .toBe(true);
        });

        it('carries an attachment as a media item and still renders in the timeline', async () => {
            // The console renders from `metadata.mediaUrl`; the outbox records
            // the canonical `media_url` column. Every picture sent through the
            // lane used to arrive in the timeline as an empty bubble.
            const agentId = await agent();
            await service().sendAgentMessage(tenantId, conversationId, agentId, '', 'image',
                'https://cdn.example/foto.jpg', 'mirá esto');
            const [row] = await rows();
            expect(row.item_kind).toBe('media');
            expect(row.payload).toMatchObject({
                mediaType: 'image', mediaUrl: 'https://cdn.example/foto.jpg', caption: 'mirá esto',
            });
            const detail = await service().getConversation(tenantId, conversationId);
            expect(detail!.messages[0].metadata).toMatchObject({
                mediaUrl: 'https://cdn.example/foto.jpg',
            });
        });

        it('shows an outbox picture in the timeline even with no metadata at all', async () => {
            // Same defect, from the OTHER producer: the AI's own durable media
            // reply writes only the column, and nothing in this service wrote
            // its metadata. The read is what had to be fixed.
            await sql(`INSERT INTO messages(conversation_id, direction, content_type, media_url, status)
                       VALUES($1::uuid,'outbound','image','https://cdn.example/ia.jpg','pending')`,
            [conversationId]);
            const detail = await service().getConversation(tenantId, conversationId);
            expect(detail!.messages[0].metadata).toMatchObject({
                mediaUrl: 'https://cdn.example/ia.jpg',
            });
        });

        it('leaves a metadata the producer already wrote alone', async () => {
            // A producer that recorded its own presentation stays the authority
            // on it: the column must not overwrite a signed or rewritten URL.
            await sql(`INSERT INTO messages(conversation_id, direction, content_type, media_url,
                            status, metadata)
                       VALUES($1::uuid,'outbound','image','https://cdn.example/raw.jpg','sent',
                            '{"mediaUrl":"https://cdn.example/firmada.jpg"}'::jsonb)`,
            [conversationId]);
            const detail = await service().getConversation(tenantId, conversationId);
            expect((detail!.messages[0].metadata as any).mediaUrl).toBe('https://cdn.example/firmada.jpg');
        });
    });

    // ── 2. WHAT MAKES THIS REPLY *THIS* REPLY ───────────────────────────────

    describe('the identity of a press of Send', () => {
        it('treats two identical messages as two effects', async () => {
            // An agent typing "ok" twice means it twice. A key derived from the
            // words would have swallowed the second one in silence.
            const agentId = await agent();
            await service().sendAgentMessage(tenantId, conversationId, agentId, 'ok');
            await service().sendAgentMessage(tenantId, conversationId, agentId, 'ok');
            expect(await rows()).toHaveLength(2);
        });

        it('collides on one row when the caller names the press', async () => {
            // What an idempotency key buys, once anything upstream sends one:
            // a retried request finds the effect instead of sending a second.
            const agentId = await agent();
            const first = await service()
                .sendAgentMessage(tenantId, conversationId, agentId, 'ok', 'text',
                    undefined, undefined, undefined, 'press-1');
            const second = await service()
                .sendAgentMessage(tenantId, conversationId, agentId, 'ok', 'text',
                    undefined, undefined, undefined, 'press-1');
            expect(await rows()).toHaveLength(1);
            expect(second.id).toBe(first.id);
        });

        it('survives two workers racing on the same press', async () => {
            const agentId = await agent();
            const [a, b] = await Promise.all([
                service().sendAgentMessage(tenantId, conversationId, agentId, 'carrera', 'text',
                    undefined, undefined, undefined, 'press-race'),
                service().sendAgentMessage(tenantId, conversationId, agentId, 'carrera', 'text',
                    undefined, undefined, undefined, 'press-race'),
            ]);
            expect(await rows()).toHaveLength(1);
            expect(a.id).toBe(b.id);
        });
    });

    // ── 3. WHO MAY SEND, ASKED AGAIN WHEN IT MATTERS ────────────────────────

    describe('the person behind the reply', () => {
        it('refuses a deactivated agent before a row exists', async () => {
            const agentId = await agent({ is_active: false });
            await expect(service().sendAgentMessage(tenantId, conversationId, agentId, 'hola'))
                .rejects.toThrow(/ya no puede enviar/);
            expect(await rows()).toHaveLength(0);
            expect(gateway.sendMessage).not.toHaveBeenCalled();
        });

        it('refuses an agent whose role lost its sending rights', async () => {
            const agentId = await agent({ role: 'read_only_auditor' });
            await expect(service().sendAgentMessage(tenantId, conversationId, agentId, 'hola'))
                .rejects.toThrow(/ya no puede enviar/);
            expect(await rows()).toHaveLength(0);
        });

        it('suppresses a committed reply when the agent is deactivated before it leaves',
            async () => {
                const agentId = await agent();
                await service().sendAgentMessage(tenantId, conversationId, agentId, 'hola');
                await global('UPDATE public.users SET is_active = false WHERE id = $1::uuid', agentId);
                const [row] = await rows();
                await expect(store.admit(tenantId, String(row.id)))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                const [after] = await sql('SELECT state, error_code FROM agent_dispatch_outbox');
                expect(after.state).toBe('suppressed');
                expect(after.error_code).toContain('human_revoked');
            });

        it('suppresses it when the agent is demoted before it leaves', async () => {
            const agentId = await agent({ role: 'tenant_supervisor' });
            await service().sendAgentMessage(tenantId, conversationId, agentId, 'hola');
            await global(`UPDATE public.users SET role = 'read_only_auditor' WHERE id = $1::uuid`,
                agentId);
            const [row] = await rows();
            await expect(store.admit(tenantId, String(row.id)))
                .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
            expect((await sql('SELECT state FROM agent_dispatch_outbox'))[0].state)
                .toBe('suppressed');
        });

        it('admits it when nothing about the agent changed', async () => {
            await service().sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            const [row] = await rows();
            expect((await store.admit(tenantId, String(row.id))).row.state).toBe('admitted');
        });
    });

    // ── 4. WHAT SURVIVES WHEN SOMETHING ELSE BREAKS ─────────────────────────

    describe('when the machinery around it fails', () => {
        it('keeps the committed row when the queue cannot be published to', async () => {
            publishFails = true;
            const message = await service()
                .sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            expect(published).toEqual([]);
            expect(message.status).toBe('pending');
            const [row] = await rows();
            const admitted = await store.admit(tenantId, String(row.id));
            expect(admitted.row.state).toBe('admitted');
        });

        it('leaves a provider rejection retryable, with the words intact', async () => {
            await service().sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            const [row] = await rows();
            const admitted = await store.admit(tenantId, String(row.id));
            await store.settle(tenantId, String(row.id), admitted.leaseToken,
                { kind: 'failed', errorCode: 'rate_limited' } as any);
            const [after] = await sql(
                'SELECT state, error_code, payload FROM agent_dispatch_outbox');
            expect(after.state).toBe('failed');
            expect(after.payload).toEqual({ text: 'hola' });
            // And the inbox still says "pending", which is the honest word for
            // a retryable failure: nothing left, and the next pass will try
            // again. "failed" is reserved for the last word on it — a refusal
            // nobody will retry, or attempts run out.
            expect((await sql('SELECT status FROM messages'))[0].status).toBe('pending');
        });

        it('never re-admits a reply whose outcome nobody knows', async () => {
            await service().sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            const [row] = await rows();
            const admitted = await store.admit(tenantId, String(row.id));
            await store.settle(tenantId, String(row.id), admitted.leaseToken,
                { kind: 'reconciliation_required', errorCode: 'timeout' } as any);
            expect((await sql('SELECT state FROM agent_dispatch_outbox'))[0].state)
                .toBe('reconciliation_required');
            await expect(store.admit(tenantId, String(row.id))).rejects.toBeDefined();
        });

        it('sends nothing at all when a BILLED channel has no transport that can answer', async () => {
            // This case used to assert the opposite: no durable row, and an
            // inline POST through `sendMessage` instead, on the reasoning
            // that a committed row nothing can deliver is worse than an
            // inline send.
            //
            // Both halves of that are bad on a channel Meta bills. That
            // gateway reports every failure as `null`, so a timeout and a
            // refusal are one value: the money is retained as indeterminate
            // while the row says the reply did not leave, and the agent
            // retypes a message the customer may already have — a second
            // charge against the tenant's own WABA.
            //
            // So it is refused BEFORE the admission: no reservation, no
            // intent, nothing addressed, and the agent is told why. The case
            // below shows this branch cannot be reached in production.
            const spend = permissiveSpendGate();
            const message = await service({ strict: false, spend })
                .sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            expect(await rows()).toHaveLength(0);
            expect(gateway.sendMessage).not.toHaveBeenCalled();
            expect(spend.admitBySchema).not.toHaveBeenCalled();
            expect(spend.beginTransmission).not.toHaveBeenCalled();
            expect(message.status).toBe('failed');
            expect((await sql('SELECT status, metadata FROM messages'))[0].metadata)
                .toMatchObject({ sendError: 'strict_transport_unavailable' });
        });

        it('cannot happen on WhatsApp, because its adapter implements the strict transport', async () => {
            // The flow-control half of the case above. A refusal for want of
            // a strict transport would silence the only channel the business
            // pays for, so it matters that the branch is unreachable rather
            // than merely unlikely — and that is a property of the adapter,
            // asserted here instead of written down in a report.
            expect(typeof (WhatsAppAdapter.prototype as any).sendStrict).toBe('function');
        });

        it('sends through the strict transport when no lane is wired in', async () => {
            const message = await service({ lane: undefined })
                .sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            expect(await rows()).toHaveLength(0);
            // The transport that says what happened, not the one that
            // reports every failure as the same `null`.
            expect(sendStrict).toHaveBeenCalled();
            expect(gateway.sendMessage).not.toHaveBeenCalled();
            expect(message.status).toBe('sent');
        });

        it('admits the inline human fallback before its provider POST', async () => {
            const order: string[] = [];
            const spend = permissiveSpendGate();
            const originalAdmission = spend.admit.getMockImplementation()!;
            spend.admit.mockImplementation(async (...args: any[]) => {
                order.push('shared_spend_admission');
                return originalAdmission(...args);
            });
            const consoleService = service({ lane: undefined, spend });
            sendStrict.mockImplementation(async () => {
                order.push('provider_post');
                return { kind: 'accepted', receipt: 'wamid.STRICT' };
            });

            await consoleService.sendAgentMessage(
                tenantId, conversationId, await agent(), 'respuesta humana',
            );

            expect(order).toEqual(['shared_spend_admission', 'provider_post']);
            expect(spend.admit).toHaveBeenCalledTimes(1);
        });

        it('files an unknown inline outcome for reconciliation instead of as failed', async () => {
            // The inline path is a fallback, not a lesser standard: an answer
            // that never arrived must not read as one that did not leave.
            const message = await service({ lane: undefined,
                outcome: { kind: 'unknown', errorCode: 'timeout' } })
                .sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            expect(message.status).toBe('reconciliation_required');
            expect((await sql('SELECT status FROM messages'))[0].status)
                .toBe('reconciliation_required');
        });

        it('sends through the strict transport for a thread that does not name its connection', async () => {
            // A binding is four identifiers or it is nothing: a legacy row with
            // no `channel_account_id` cannot say which account pays, so the
            // durable lane declines — and the fallback still uses a transport
            // that can report an outcome.
            await sql('UPDATE conversations SET channel_account_id = NULL WHERE id = $1::uuid',
                [conversationId]);
            await service().sendAgentMessage(tenantId, conversationId, await agent(), 'hola');
            expect(await rows()).toHaveLength(0);
            expect(sendStrict).toHaveBeenCalled();
        });
    });

    // ── 5. WHAT THE LANE WILL NOT LET THIS REPLY SAY ABOUT ITSELF ───────────

    describe('the billing classification this reply cannot carry', () => {
        it('is recorded as proactive, which is not what it is', async () => {
            // A console agent answering somebody who just wrote is a SERVICE
            // reply inside the 24-hour window. It is filed as `proactive`
            // because the lane has no way to say otherwise — see the two tests
            // below, which are the reason.
            await sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text)
                       VALUES($1::uuid,'inbound','text','¿hay turno?')`, [conversationId]);
            await service().sendAgentMessage(tenantId, conversationId, await agent(), 'sí, mañana');
            expect((await rows())[0].origin_kind).toBe('proactive');
        });

        it('BLOCKED: naming the customer message makes every reply to it one effect',
            async () => {
                // The outbox identifies a row by `(inbound_message_id,
                // item_index)`, so the origin IS the identity. Billing a console
                // reply correctly means naming the inbound — and then the
                // agent's SECOND sentence is `already_present` and never sent.
                //
                // This is the defect that keeps the console on `proactive`. The
                // fix belongs in the outbox: separate what CAUSED an effect from
                // what IDENTIFIES it.
                const [inbound] = await sql(
                    `INSERT INTO messages(conversation_id, direction, content_type, content_text)
                     VALUES($1::uuid,'inbound','text','¿hay turno?') RETURNING id`,
                    [conversationId]);
                const scope = await lane.operatorAuthority(schema, {
                    tenantId, userId: await agent(), surface: 'agent_console',
                    channelType: 'whatsapp', channelAccountId: NUMBER,
                });
                const reply = (text: string) => lane.send(tenantId, {
                    originKey: `console:${randomUUID()}`,
                    conversationId, contactId, channelType: 'whatsapp', channelAccountId: NUMBER,
                    recipient: CUSTOMER, items: [{ kind: 'text', payload: { text } }],
                    operationalScope: scope,
                    originKind: 'inbound_reply', inboundMessageId: String(inbound.id),
                });
                expect((await reply('un momento')).kind).toBe('prepared');
                // The second sentence. It is a different message to a person
                // waiting, and the lane hands back the first one.
                expect((await reply('listo, te agendé')).kind).toBe('already_present');
                expect(await sql('SELECT content_text FROM messages WHERE direction = $1',
                    ['outbound'])).toEqual([{ content_text: 'un momento' }]);
            });

        it('BLOCKED: a reply to an inbound the AI already answered is refused outright',
            async () => {
                // Worse than the first: the AI's own batch owns that inbound's
                // origin, so a person replying afterwards on the same customer
                // message gets `dispatch_batch_conflict` and sends nothing.
                const [inbound] = await sql(
                    `INSERT INTO messages(conversation_id, direction, content_type, content_text)
                     VALUES($1::uuid,'inbound','text','¿hay turno?') RETURNING id`,
                    [conversationId]);
                const scope = await lane.operatorAuthority(schema, {
                    tenantId, userId: await agent(), surface: 'agent_console',
                    channelType: 'whatsapp', channelAccountId: NUMBER,
                });
                // The AI answered in two bubbles.
                await store.prepare(tenantId, {
                    binding: {
                        conversationId, contactId, inboundMessageId: String(inbound.id),
                        channelType: 'whatsapp', channelAccountId: NUMBER, recipient: CUSTOMER,
                    },
                    items: [{ kind: 'text', payload: { text: 'hola' } },
                        { kind: 'text', payload: { text: '¿para cuándo?' } }],
                    operationalScope: scope as any,
                });
                const result = await lane.send(tenantId, {
                    originKey: `console:${randomUUID()}`,
                    conversationId, contactId, channelType: 'whatsapp', channelAccountId: NUMBER,
                    recipient: CUSTOMER,
                    items: [{ kind: 'text', payload: { text: 'te atiendo yo' } }],
                    operationalScope: scope,
                    originKind: 'inbound_reply', inboundMessageId: String(inbound.id),
                });
                expect(result).toEqual({ kind: 'refused', reason: 'dispatch_batch_conflict' });
            });
    });
});
