import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DripSequenceService } from './drip-sequence.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL, DispatchOutboxError } from '../channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ A DRIP STEP, THROUGH THE REAL STORE ═══
 *
 * Three call sites, three different lanes, and the tenant chose which one by
 * typing a word into the step: `template` went straight to the adapter,
 * `custom` and `ai_generated` went onto the legacy queue where Redis is the
 * only record. Neither carried an identity, so a retry sent the step again, and
 * both wrote a history row saying `delivered` before anything had left.
 *
 * And the enrolment advanced no matter what. `executeStepAction` was wrapped in
 * a `try` that logged and swallowed, and the very next statement moved
 * `current_step` on — so a step that failed, or that was never sent at all,
 * still counted as delivered and the customer simply skipped a message.
 *
 * ── THE ORDERING THIS SUITE EXISTS TO PIN ───────────────────────────────────
 *
 * `current_step` is inside the enrolment's own revision, on purpose: somebody
 * moved to another step must not receive the one they left. That makes the
 * obvious ordering — prepare, then advance — fatal, because the advance would
 * make the effect stale before it ever got a lease. The enrolment therefore
 * moves FIRST and is put back when nothing durable exists, and the end state is
 * the one the invariant asks for.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('a drip step on the durable lane', () => {
    const tenantId = randomUUID();
    const schema = `tenant_driplane_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550003333';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    let service: any;
    let published: string[] = [];
    let scheduled: any[] = [];
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    const STEPS = [
        { delay_seconds: 0, message_type: 'template', template_name: 'prospeccion', template_language: 'es' },
        { delay_seconds: 3600, message_type: 'custom', content: 'Hola {name}, ¿seguimos?' },
    ];

    /** One active enrolment on step 0, with a WhatsApp thread of its own. */
    const enrolment = async (over: { steps?: any[]; account?: string | null; step?: number } = {}) => {
        const contactId = randomUUID();
        const conversationId = randomUUID();
        const sequenceId = randomUUID();
        const id = randomUUID();
        await sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)',
            [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id)
            VALUES($1::uuid,$2::uuid,'whatsapp',$3)`,
            [conversationId, contactId, over.account === undefined ? NUMBER : over.account]);
        await sql(`INSERT INTO drip_sequences(id, tenant_id, name, trigger_event, steps)
            VALUES($1::uuid,$2::uuid,'Prospección','manual',$3::jsonb)`,
            [sequenceId, tenantId, JSON.stringify(over.steps ?? STEPS)]);
        await sql(`INSERT INTO drip_enrollments(id, sequence_id, contact_id, conversation_id,
                current_step, status)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'active')`,
            [id, sequenceId, contactId, conversationId, over.step ?? 0]);
        return { id, contactId, conversationId, sequenceId };
    };

    const outboxRows = async () => sql(
        `SELECT id, item_kind, state, origin_kind, channel_account_id, conversation_id,
                payload, operational_scope, error_code
           FROM agent_dispatch_outbox ORDER BY created_at`);

    const enrolmentRow = async (id: string) => (await sql(
        'SELECT current_step, status, completed_at FROM drip_enrollments WHERE id = $1::uuid', [id]))[0];

    const run = (id: string) => service.executeStep(tenantId, id);

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
        prisma.tenant = {
            findUnique: async () => ({ id: tenantId, schemaName: schema, language: 'es' }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            external_id TEXT, channel_type TEXT, email TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE drip_sequences(id UUID PRIMARY KEY, tenant_id UUID, name TEXT,
            trigger_event TEXT, trigger_conditions JSONB DEFAULT '{}', steps JSONB,
            is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE drip_enrollments(id UUID PRIMARY KEY,
            sequence_id UUID REFERENCES drip_sequences(id) ON DELETE CASCADE, contact_id UUID,
            conversation_id UUID, current_step INTEGER DEFAULT 0, status VARCHAR(50) DEFAULT 'active',
            enrolled_at TIMESTAMPTZ DEFAULT NOW(), last_step_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ, stop_reason TEXT)`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store,
            { enqueueDispatch: async (_t: string, id: string) => { published.push(id); } } as any);

        service = Object.create(DripSequenceService.prototype);
        Object.assign(service, {
            prisma, proactive,
            nurturingQueue: { add: async (name: string, data: any, opts: any) => {
                scheduled.push({ name, data, opts }); return { id: opts?.jobId };
            } },
            redis: { get: async () => '1', set: async () => undefined },
            compliance: { isBlocked: async () => false },
            personaService: { getActivePersona: async () => null, buildSystemPrompt: () => '' },
            llmRouter: { execute: async () => ({ content: 'Hola, soy el equipo.' }) },
            channelToken: {}, throttle: {}, segmentsService: {},
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        service.ensureDripTables = async () => undefined;
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_driplane_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        scheduled = [];
        await sql(`TRUNCATE agent_dispatch_outbox, messages, drip_enrollments, drip_sequences,
            conversations, contacts CASCADE`);
    });

    // ── THE ROW THE REAL STORE ACCEPTS ──────────────────────────────────────

    it('commits a template step as a template, on the enrolment’s own number', async () => {
        const drip = await enrolment();
        await run(drip.id);
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect({ kind: rows[0].item_kind, origin: rows[0].origin_kind, state: rows[0].state })
            .toEqual({ kind: 'template', origin: 'proactive', state: 'queued' });
        expect(rows[0].channel_account_id).toBe(NUMBER);
        expect(rows[0].conversation_id).toBe(drip.conversationId);
        expect(rows[0].payload).toMatchObject({ templateName: 'prospeccion', language: 'es' });
    });

    it('commits a custom step as text, on the same lane', async () => {
        // It used to go onto the legacy queue instead, so which record existed
        // depended on a word the tenant typed into the step.
        const drip = await enrolment({ step: 1 });
        await run(drip.id);
        const [row] = await outboxRows();
        expect(row.item_kind).toBe('text');
        expect(row.payload).toMatchObject({ text: 'Hola Ana, ¿seguimos?' });
    });

    it('commits an AI opener as text too', async () => {
        const drip = await enrolment({
            steps: [{ delay_seconds: 0, message_type: 'ai_generated', content: 'lanzamiento' }],
        });
        await run(drip.id);
        const [row] = await outboxRows();
        expect(row.item_kind).toBe('text');
        expect(String(row.payload.text)).toContain('equipo');
    });

    it('carries an authority the admission can revalidate', async () => {
        const drip = await enrolment();
        await run(drip.id);
        const [row] = await outboxRows();
        expect(row.operational_scope).toMatchObject({
            kind: 'proactive_policy', producer: 'drip_step',
            entityId: drip.id, channelAccountId: NUMBER,
        });
        expect(String(row.operational_scope.entityRevision)).toMatch(/^[a-f0-9]{64}$/);
    });

    it('writes the history row as pending, not as delivered', async () => {
        // `saveOutboundMessage` wrote `delivered` before anything had left, so a
        // step the queue dropped appeared in the thread as a message the
        // customer had received and ignored.
        const drip = await enrolment();
        await run(drip.id);
        const [message] = await sql(
            "SELECT status, content_type FROM messages WHERE direction = 'outbound'");
        expect(message).toMatchObject({ status: 'pending', content_type: 'template' });
    });

    // ── REPLAY AND RACING ───────────────────────────────────────────────────

    it('collapses two attempts at the same step onto one row', async () => {
        // The second pass is a BullMQ retry whose first attempt committed the
        // row and died before scheduling. The enrolment has moved on, so this
        // drives the step index directly.
        const drip = await enrolment();
        await run(drip.id);
        await sql('UPDATE drip_enrollments SET current_step = 0 WHERE id = $1::uuid', [drip.id]);
        await run(drip.id);
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql("SELECT id FROM messages WHERE direction='outbound'")).toHaveLength(1);
    });

    it('prepares one row when two workers race the same enrolment', async () => {
        const drip = await enrolment();
        await Promise.allSettled([run(drip.id), run(drip.id)]);
        expect(await outboxRows()).toHaveLength(1);
    });

    it('gives each step of a journey its own effect', async () => {
        const drip = await enrolment();
        await run(drip.id);
        await run(drip.id);
        const rows = await outboxRows();
        expect(rows.map(row => row.item_kind)).toEqual(['template', 'text']);
    });

    // ── THE ENROLMENT MOVES ONLY OVER A DURABLE EFFECT ──────────────────────

    it('advances the enrolment when the effect was committed', async () => {
        const drip = await enrolment();
        await run(drip.id);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 1, status: 'active' });
    });

    it('puts the enrolment back when the outbox refuses the batch', async () => {
        // THE DEFECT. The advance was the statement after a `try` that logged
        // and swallowed, so a step nobody received still counted as delivered.
        const drip = await enrolment();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new DispatchOutboxError('dispatch_binding_changed'));
        await expect(run(drip.id)).rejects.toThrow(/drip_step_not_dispatched:refused/);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 0 });
        expect(await outboxRows()).toEqual([]);
        broken.mockRestore();
    });

    it('puts the enrolment back when the commit was merely uncertain', async () => {
        const drip = await enrolment();
        const flaky = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
        await expect(run(drip.id)).rejects.toThrow(/drip_step_not_dispatched:deferred/);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 0 });
        flaky.mockRestore();
        await run(drip.id);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 1 });
    });

    it('advances even when nothing could be published', async () => {
        const drip = await enrolment();
        const live = (proactive as any).queue;
        (proactive as any).queue = {
            enqueueDispatch: async () => { throw new Error('redis is down'); },
        };
        try { await run(drip.id); } finally { (proactive as any).queue = live; }
        expect(published).toEqual([]);
        expect(await outboxRows()).toHaveLength(1);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 1 });
    });

    it('refuses to send when the enrolment names no connection', async () => {
        const drip = await enrolment({ account: '' });
        await expect(run(drip.id)).rejects.toThrow(/drip_step_not_dispatched:refused/);
        expect(await outboxRows()).toEqual([]);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 0 });
    });

    it('lends nothing from an enrolment whose thread is not WhatsApp', async () => {
        const drip = await enrolment({ account: 'IG_ACCOUNT' });
        await sql("UPDATE conversations SET channel_type = 'instagram' WHERE id = $1::uuid",
            [drip.conversationId]);
        await expect(run(drip.id)).rejects.toThrow(/drip_step_not_dispatched:refused/);
        expect(await outboxRows()).toEqual([]);
    });

    it('moves past a step it can never send, rather than retrying it for ever', async () => {
        // A contact with no WhatsApp number is not a failure that may pass.
        const drip = await enrolment();
        await sql('UPDATE contacts SET phone = NULL WHERE id = $1::uuid', [drip.contactId]);
        await run(drip.id);
        expect(await outboxRows()).toEqual([]);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 1 });
    });

    // ── THE JOURNEY THAT ENDED WHILE THE STEP WAS IN FLIGHT ─────────────────

    it('suppresses a step whose enrolment was stopped after preparing', async () => {
        const drip = await enrolment();
        await run(drip.id);
        const [row] = await outboxRows();
        await sql("UPDATE drip_enrollments SET status = 'stopped_replied' WHERE id = $1::uuid",
            [drip.id]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_gone');
    });

    it('suppresses a step whose enrolment was moved on by somebody else', async () => {
        const drip = await enrolment();
        await run(drip.id);
        const [row] = await outboxRows();
        await sql('UPDATE drip_enrollments SET current_step = 7 WHERE id = $1::uuid', [drip.id]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_stale');
    });

    it('still admits a step whose enrolment has not moved', async () => {
        // The control, and the one that proves the advance-first ordering: the
        // enrolment HAS advanced by the time this runs, because the producer
        // advanced it before reading the authority.
        const drip = await enrolment();
        await run(drip.id);
        const [row] = await outboxRows();
        expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
    });

    // ── AND THE LAST STEP OF ALL ────────────────────────────────────────────

    it('does not close the journey in the same breath as its last step', async () => {
        // Completing the enrolment makes its revision `gone`, so a last step
        // still waiting for a lease would be suppressed and the final message of
        // every sequence would never arrive.
        const drip = await enrolment({ step: 1 });
        await run(drip.id);
        expect(await enrolmentRow(drip.id)).toMatchObject({ current_step: 2, status: 'active' });
        expect(scheduled.at(-1)).toMatchObject({ data: { stepIndex: 2 } });
    });

    it('refuses to close it while the last effect is still waiting for a lease', async () => {
        const drip = await enrolment({ step: 1 });
        await run(drip.id);
        await expect(run(drip.id)).rejects.toThrow(/drip_last_step_awaiting_admission/);
        expect(await enrolmentRow(drip.id)).toMatchObject({ status: 'active' });
    });

    it('closes it once that effect has been admitted', async () => {
        const drip = await enrolment({ step: 1 });
        await run(drip.id);
        const [row] = await outboxRows();
        await store.admit(tenantId, row.id);
        await run(drip.id);
        expect(await enrolmentRow(drip.id)).toMatchObject({ status: 'completed' });
    });

    it('delivers the last step of a journey that is closed afterwards', async () => {
        // The whole point, end to end: the effect survives the closure.
        const drip = await enrolment({ step: 1 });
        await run(drip.id);
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        expect(admitted.row.state).toBe('admitted');
        await run(drip.id);
        expect(await enrolmentRow(drip.id)).toMatchObject({ status: 'completed' });
        expect((await outboxRows())[0].state).toBe('admitted');
    });
});
