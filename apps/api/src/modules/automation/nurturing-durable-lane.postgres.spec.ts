import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NurturingService } from './nurturing.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL, DispatchOutboxError } from '../channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ A NURTURING NUDGE, THROUGH THE REAL STORE ═══
 *
 * The in-window text went onto the legacy queue and the out-of-window template
 * went straight to the adapter. Neither left a row, so a restart lost the nudge
 * or repeated it, and neither could be re-checked against the conversation
 * between the decision and the POST — so a nudge asking whether anybody was
 * still there could arrive a minute after the customer wrote. It is billed.
 *
 * ── AND THE MARKER THIS SUITE EXISTS TO PIN ─────────────────────────────────
 *
 * `nurturing_last_attempt` lives inside the conversation's own revision, and so
 * does the time of its last inbound message. Recording the attempt AFTER
 * preparing would make every nudge stale at admission and none would ever
 * arrive; so the attempt is recorded first and restored when nothing durable
 * exists. Resolving the thread has the same shape and the same answer: it is a
 * pass of its own, after the farewell has a lease.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('a nurturing follow-up on the durable lane', () => {
    const tenantId = randomUUID();
    const schema = `tenant_nurtlane_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550004444';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    let service: any;
    let published: string[] = [];
    let scheduled: any[] = [];
    let settings: any = {
        enabled: true, maxAttempts: 3, delays: [1, 2, 3], allowedChannels: ['whatsapp'],
        finalAction: 'mark_not_interested', whatsappTemplateName: 'seguimiento', maxPerDay: 1,
    };
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** A quiet thread: one outbound long ago, nothing inbound since. */
    const thread = async (over: { account?: string; lastInboundHoursAgo?: number } = {}) => {
        const contactId = randomUUID();
        const conversationId = randomUUID();
        const leadId = randomUUID();
        await sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)',
            [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status)
            VALUES($1::uuid,$2::uuid,'whatsapp',$3,'active')`,
            [conversationId, contactId, over.account === undefined ? NUMBER : over.account]);
        await sql(`INSERT INTO leads(id, contact_id) VALUES($1::uuid,$2::uuid)`, [leadId, contactId]);
        const quietFor = over.lastInboundHoursAgo ?? 48;
        await sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text,
                status, created_at)
            VALUES($1::uuid,'inbound','text','hola','received', NOW() - ($2 || ' hours')::interval)`,
            [conversationId, String(quietFor)]);
        // And OUR last word after theirs, which is what "they went quiet" means:
        // `hasCustomerRespondedSince` compares the newest inbound against the
        // newest outbound, so a thread with no outbound at all reads as one the
        // customer has just answered and nothing is ever nudged.
        await sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text,
                status, created_at)
            VALUES($1::uuid,'outbound','text','¿te ayudo?','sent', NOW() - ($2 || ' hours')::interval)`,
            [conversationId, String(Math.max(quietFor - 0.5, 0.05))]);
        return { contactId, conversationId, leadId };
    };

    const outboxRows = async () => sql(
        `SELECT id, item_kind, state, origin_kind, channel_account_id, conversation_id,
                payload, operational_scope, error_code
           FROM agent_dispatch_outbox ORDER BY created_at`);

    const conversationRow = async (id: string) => (await sql(
        `SELECT status, metadata->>'nurturing_last_attempt' AS attempt,
                metadata->>'nurturing_last_sent_at' AS last_sent
           FROM conversations WHERE id = $1::uuid`, [id]))[0];

    const run = (t: { conversationId: string; leadId: string }, attempt: number) =>
        service.executeFollowUp(tenantId, t.conversationId, t.leadId, attempt);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.getTenantSchemaName = async () => schema;
        prisma.$queryRaw = async () => [{ settings: { nurturing: settings } }];
        prisma.tenant = {
            findUnique: async () => ({ id: tenantId, schemaName: schema, language: 'es' }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            external_id TEXT, channel_type TEXT, email TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}'::jsonb,
            resolved_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        // `opted_out` and `updated_at` are what the unsubscribe gate reads. A
        // fixture missing them would make the gate throw, and the gate stands
        // down when it cannot read — so the test would pass for the wrong
        // reason, which is the worst way to cover a consent rule.
        await sql(`CREATE TABLE leads(id UUID PRIMARY KEY, contact_id UUID,
            opted_out BOOLEAN DEFAULT false, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE tasks(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID,
            title TEXT, description TEXT, type TEXT, status TEXT, due_at TIMESTAMPTZ)`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store,
            { enqueueDispatch: async (_t: string, id: string) => { published.push(id); } } as any);

        service = Object.create(NurturingService.prototype);
        Object.assign(service, {
            prisma, proactive,
            nurturingQueue: { add: async (name: string, data: any, opts: any) => {
                scheduled.push({ name, data, opts }); return { id: opts?.jobId };
            }, getJob: async () => null },
            redis: { getJson: async () => null, setJson: async () => undefined, del: async () => 1 },
            compliance: { isBlocked: async () => false },
            connections: { resolve: async () => null },
            channelToken: {},
            personaService: { getActivePersona: async () => null, buildSystemPrompt: () => '' },
            llmRouter: { execute: async () => ({ content: '¿Seguimos?' }) },
            pipelineService: { writeLeadStage: async () => ({ stage: { slug: 'no_interesado' }, updatedOpportunities: 1 }) },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_nurtlane_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        scheduled = [];
        settings = {
            enabled: true, maxAttempts: 3, delays: [1, 2, 3], allowedChannels: ['whatsapp'],
            finalAction: 'mark_not_interested', whatsappTemplateName: 'seguimiento', maxPerDay: 1,
        };
        await sql(`TRUNCATE agent_dispatch_outbox, messages, tasks, leads, conversations,
            contacts CASCADE`);
    });

    // ── THE ROW THE REAL STORE ACCEPTS ──────────────────────────────────────

    it('commits an out-of-window nudge as the tenant’s approved template', async () => {
        const t = await thread();
        await run(t, 1);
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect({ kind: rows[0].item_kind, origin: rows[0].origin_kind, state: rows[0].state })
            .toEqual({ kind: 'template', origin: 'proactive', state: 'queued' });
        expect(rows[0].channel_account_id).toBe(NUMBER);
        expect(rows[0].payload).toMatchObject({ templateName: 'seguimiento' });
    });

    it('commits an in-window nudge as text, on the same lane', async () => {
        const t = await thread({ lastInboundHoursAgo: 1 });
        await run(t, 1);
        const [row] = await outboxRows();
        expect(row.item_kind).toBe('text');
        expect(String(row.payload.text)).toContain('duda');
    });

    it('carries an authority the admission can revalidate', async () => {
        const t = await thread();
        await run(t, 1);
        const [row] = await outboxRows();
        expect(row.operational_scope).toMatchObject({
            kind: 'proactive_policy', producer: 'nurturing_followup',
            entityId: t.conversationId, channelAccountId: NUMBER,
        });
    });

    it('writes the history row as pending, not as delivered', async () => {
        const t = await thread();
        await run(t, 1);
        // The one the LANE wrote: a dispatch history row is the only outbound
        // here carrying an `external_id`, and the thread fixture seeds one of
        // its own so that the customer counts as quiet.
        const [message] = await sql(
            `SELECT status, content_type FROM messages
              WHERE direction = 'outbound' AND external_id IS NOT NULL`);
        expect(message).toMatchObject({ status: 'pending', content_type: 'template' });
    });

    // ── REPLAY AND RACING ───────────────────────────────────────────────────

    it('collapses two attempts at the same nudge onto one row', async () => {
        const t = await thread();
        await run(t, 1);
        // Undo the once-a-day cap so the replay reaches the lane at all: what is
        // under test here is the origin, not the cap.
        await sql(`UPDATE conversations SET metadata = metadata - 'nurturing_last_sent_at'`);
        await run(t, 1);
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql(`SELECT id FROM messages
            WHERE direction='outbound' AND external_id IS NOT NULL`)).toHaveLength(1);
    });

    it('prepares one row when two workers race the same attempt', async () => {
        const t = await thread();
        await Promise.allSettled([run(t, 1), run(t, 1)]);
        expect(await outboxRows()).toHaveLength(1);
    });

    it('keeps the three attempts of one thread apart', async () => {
        const t = await thread();
        await run(t, 1);
        await sql(`UPDATE conversations SET metadata = metadata - 'nurturing_last_sent_at'`);
        await run(t, 2);
        expect(await outboxRows()).toHaveLength(2);
    });

    // ── THE ATTEMPT MARKER FOLLOWS THE EFFECT ───────────────────────────────

    it('records the attempt when the effect was committed', async () => {
        const t = await thread();
        await run(t, 1);
        expect(await conversationRow(t.conversationId)).toMatchObject({ attempt: '1' });
    });

    it('unrecords it when the outbox refuses the batch', async () => {
        // THE DEFECT. `recordAttempt` ran unconditionally after the send, so a
        // nudge nobody received was filed as an attempt that had been made.
        const t = await thread();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new DispatchOutboxError('dispatch_binding_changed'));
        await run(t, 1);
        const conversation = await conversationRow(t.conversationId);
        expect(conversation.attempt).toBeNull();
        expect(conversation.last_sent).toBeNull();
        expect(await outboxRows()).toEqual([]);
        broken.mockRestore();
    });

    it('unrecords it when the commit was merely uncertain', async () => {
        const t = await thread();
        const flaky = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
        await run(t, 1);
        expect((await conversationRow(t.conversationId)).attempt).toBeNull();
        flaky.mockRestore();
        await run(t, 1);
        expect((await conversationRow(t.conversationId)).attempt).toBe('1');
    });

    it('records it even when nothing could be published', async () => {
        const t = await thread();
        const live = (proactive as any).queue;
        (proactive as any).queue = {
            enqueueDispatch: async () => { throw new Error('redis is down'); },
        };
        try { await run(t, 1); } finally { (proactive as any).queue = live; }
        expect(published).toEqual([]);
        expect(await outboxRows()).toHaveLength(1);
        expect((await conversationRow(t.conversationId)).attempt).toBe('1');
    });

    it('dispatches nothing when the thread names no connection', async () => {
        // And refuses BEFORE the outbox does. The store would reject the
        // binding anyway, but a producer that hands it an invented account has
        // already decided which of the tenant's numbers pays; the refusal has
        // to be the producer's, and the resolver has to be asked, because that
        // is what raises the configuration task the business must act on.
        const t = await thread({ account: '' });
        const attempted = jest.spyOn(store, 'prepare');
        const resolver = jest.fn(async () => null);
        const live = (service as any).connections;
        (service as any).connections = { resolve: resolver };
        try { await run(t, 1); } finally { (service as any).connections = live; }
        expect(attempted).not.toHaveBeenCalled();
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(await outboxRows()).toEqual([]);
        expect((await conversationRow(t.conversationId)).attempt).toBeNull();
        attempted.mockRestore();
    });

    // ── THE CAP, WHICH THE MOVE COULD HAVE SILENTLY BROKEN ──────────────────

    it('still refuses a second nudge the same day', async () => {
        // The cap used to count history rows carrying `metadata.source =
        // 'nurturing'`, and the lane writes that row with no metadata of ours.
        // Left alone it would have answered "no" for ever.
        const t = await thread();
        await run(t, 1);
        await run(t, 2);
        expect(await outboxRows()).toHaveLength(1);
    });

    it('does not mark the day as nudged when nothing was committed', async () => {
        const t = await thread();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new DispatchOutboxError('dispatch_binding_changed'));
        await run(t, 1);
        broken.mockRestore();
        expect((await conversationRow(t.conversationId)).last_sent).toBeNull();
        await run(t, 1);
        expect(await outboxRows()).toHaveLength(1);
    });

    // ── THE CUSTOMER WHO WROTE WHILE THE NUDGE WAS IN FLIGHT ────────────────

    it('suppresses a nudge the customer answered before it got a lease', async () => {
        // The worst thing this lane can do: "are you still there?" arriving a
        // minute after they wrote. And it is billed.
        const t = await thread();
        await run(t, 1);
        const [row] = await outboxRows();
        await sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text, status)
            VALUES($1::uuid,'inbound','text','sí, perdón','received')`, [t.conversationId]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_stale');
    });

    it('suppresses one whose thread was handed to a person', async () => {
        const t = await thread();
        await run(t, 1);
        const [row] = await outboxRows();
        await sql("UPDATE conversations SET status = 'with_human' WHERE id = $1::uuid",
            [t.conversationId]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_gone');
    });

    it('sends nothing to a contact who used the unsubscribe link', async () => {
        // ── THE HALF OF "BAJA" THAT `isBlocked` DOES NOT SEE ────────────────
        //
        // The public form sets `leads.opted_out`; it never writes an
        // `opt_out_records` row, so the compliance check this service already
        // ran returned false and the nudge went out. A customer who pressed
        // unsubscribe went on being messaged by the one producer whose entire
        // purpose is writing to people who stopped replying.
        //
        // Asserted as ZERO EFFECT rather than as a return value: the point is
        // that nothing is committed, not that a function said no.
        const t = await thread();
        await sql('UPDATE leads SET opted_out = true WHERE id = $1::uuid', [t.leadId]);

        await run(t, 1);
        // Zero effect is the assertion. `executeFollowUp` returns nothing, and
        // a test that read a return value would be asking the producer whether
        // it behaved rather than asking the outbox what happened.
        expect(await outboxRows()).toEqual([]);
    });

    it('stands down when it cannot tell whether they unsubscribed', async () => {
        // A gate that fails open is not a gate. The cost of a missed follow-up
        // is a follow-up; the cost of the other mistake is a message somebody
        // explicitly asked us never to send again.
        const t = await thread();
        await sql('ALTER TABLE leads RENAME COLUMN opted_out TO opted_out_hidden');
        try {
            await run(t, 1);
            expect(await outboxRows()).toEqual([]);
        } finally {
            await sql('ALTER TABLE leads RENAME COLUMN opted_out_hidden TO opted_out');
        }
    });

    it('still admits one whose thread has not moved', async () => {
        // The control, and what proves the marker ordering: the attempt HAS been
        // recorded by the time this runs, because it was recorded first.
        const t = await thread();
        await run(t, 1);
        const [row] = await outboxRows();
        expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
    });

    // ── AND THE FAREWELL ────────────────────────────────────────────────────

    it('does not resolve the thread in the same breath as the farewell', async () => {
        const t = await thread();
        await run(t, 3);
        expect((await conversationRow(t.conversationId)).status).toBe('active');
        expect(scheduled.at(-1)).toMatchObject({ data: { attempt: 4 } });
        // The lead is moved either way: its stage is not part of the thread's
        // revision, so nothing is suppressed by writing it.
        expect(await sql('SELECT id FROM tasks')).toHaveLength(1);
    });

    it('refuses to close it while the farewell is still waiting for a lease', async () => {
        const t = await thread();
        await run(t, 3);
        await expect(run(t, 4)).rejects.toThrow(/nurturing_farewell_awaiting_admission/);
        expect((await conversationRow(t.conversationId)).status).toBe('active');
    });

    it('closes it once the farewell has been admitted', async () => {
        const t = await thread();
        await run(t, 3);
        const [row] = await outboxRows();
        await store.admit(tenantId, row.id);
        await run(t, 4);
        expect((await conversationRow(t.conversationId)).status).toBe('resolved');
    });

    it('delivers the farewell of a thread that is closed afterwards', async () => {
        const t = await thread();
        await run(t, 3);
        const [row] = await outboxRows();
        expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
        await run(t, 4);
        expect((await conversationRow(t.conversationId)).status).toBe('resolved');
        expect((await outboxRows())[0].state).toBe('admitted');
    });
});
