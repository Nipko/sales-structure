import { randomUUID } from 'crypto';
import { NurturingService } from './nurturing.service';
import { DripSequenceService } from './drip-sequence.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-13 / AUT-14 / AUT-15 / AUT-16 / AUT-17 — nurturing, stale-thread detection,
 * abandoned bookings, 72 h auto-resolution and drip sequences, on real PostgreSQL.
 *
 *   nurturing   a follow-up goes out once, records its attempt, schedules the next one
 *               on the configured delay and stands down when the customer answered, the
 *               thread is with a person or the feature is off.
 *   stale       only quiet active threads that WE last spoke on are scheduled, once.
 *   abandoned   a booking dropped mid-flow 2-24 h ago is nudged once per abandonment.
 *   resolve     72 h without a message resolves active and waiting_human threads only.
 *   drip        steps advance in order on their own delays; a reply stops the journey;
 *               a contact is enrolled once.
 *
 * Time is seeded relative to NOW() in the rows themselves (PostgreSQL's clock cannot be
 * faked). Oracle: outbox rows, conversation metadata/status, drip_enrollments, and the
 * recorded queue admissions (BullMQ is a recorder). The LLM is a fixed-text double.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-13..17: nurturing, auto-resolve and drip', () => {
    jest.setTimeout(180_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let nurturing: any;
    let drip: any;
    let settings: any;
    let queued: Array<{ name: string; data: any; opts: any; removed?: boolean }> = [];
    const SENDER = '15550004444';

    const queue = {
        add: async (name: string, data: any, opts: any) => {
            if (!queued.some(j => j.opts?.jobId === opts?.jobId && !j.removed)) queued.push({ name, data, opts });
            return { id: opts?.jobId };
        },
        getJob: async (jobId: string) => {
            const job = queued.find(j => j.opts?.jobId === jobId && !j.removed);
            return job ? { getState: async () => 'delayed', remove: async () => { job.removed = true; } } : null;
        },
    };

    beforeAll(async () => {
        lane = await openLane('n3nurt', [
            ...LANE_CHAT_DDL,
            "ALTER TABLE leads ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()",
            "ALTER TABLE messages ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb",
            'ALTER TABLE conversations ADD COLUMN resolved_at TIMESTAMPTZ',
            'ALTER TABLE conversations ADD COLUMN resolution_type TEXT',
            `CREATE TABLE tasks(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, title TEXT, description TEXT,
                type TEXT, status TEXT, due_at TIMESTAMPTZ)`,
        ]);
        (lane.prisma as any).$queryRaw = async () => [{ id: lane.tenantId, schema_name: lane.schema, settings: { nurturing: settings } }];
        const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        nurturing = Object.create(NurturingService.prototype);
        Object.assign(nurturing, {
            prisma: lane.prisma, proactive: lane.proactive, nurturingQueue: queue,
            redis: { getJson: async () => null, setJson: async () => undefined, del: async () => 1 },
            compliance: { isBlocked: async () => false },
            connections: { resolve: async () => null },
            channelToken: {},
            personaService: { getActivePersona: async () => null, buildSystemPrompt: () => '' },
            llmRouter: { execute: async () => ({ content: '¿Seguimos?' }) },
            pipelineService: { writeLeadStage: async () => ({ stage: { slug: 'no_interesado' }, updatedOpportunities: 1 }) },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            logger,
        });
        drip = Object.create(DripSequenceService.prototype);
        Object.assign(drip, {
            prisma: lane.prisma, proactive: lane.proactive, nurturingQueue: queue,
            redis: { get: async () => null, set: async () => undefined },
            compliance: { isBlocked: async () => false },
            personaService: { getActivePersona: async () => null, buildSystemPrompt: () => '' },
            llmRouter: { execute: async () => ({ content: 'Hola, soy el equipo.' }) },
            channelToken: {}, throttle: {}, segmentsService: {},
            logger,
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        queued = [];
        settings = { enabled: true, maxAttempts: 3, delays: [14400, 86400, 259200], allowedChannels: ['whatsapp'], finalAction: 'mark_not_interested', whatsappTemplateName: 'seguimiento', maxPerDay: 1 };
        await lane.sql(`TRUNCATE agent_dispatch_outbox, opt_out_records, messages, tasks, leads, conversations, contacts CASCADE`);
        await lane.sql('DROP TABLE IF EXISTS drip_enrollments CASCADE');
        await lane.sql('DROP TABLE IF EXISTS drip_sequences CASCADE');
    });

    /** A thread: the customer wrote `inboundHoursAgo`, and we answered `outboundHoursAgo` (or never). */
    const thread = async (over: { inboundHoursAgo?: number | null; outboundHoursAgo?: number | null; status?: string;
        updatedHoursAgo?: number; metadata?: any; lead?: boolean } = {}) => {
        const contactId = randomUUID(), conversationId = randomUUID(), leadId = randomUUID();
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)', [contactId, 'Ana Perez', '+573001112233', 'whatsapp']);
        await lane.sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status,metadata,updated_at)
            VALUES($1::uuid,$2::uuid,'whatsapp',$3,$4,$5::jsonb, NOW() - ($6::text || ' hours')::interval)`,
        [conversationId, contactId, SENDER, over.status ?? 'active', JSON.stringify(over.metadata ?? {}), String(over.updatedHoursAgo ?? 6)]);
        if (over.lead !== false) await lane.sql('INSERT INTO leads(id,contact_id,phone) VALUES($1::uuid,$2::uuid,$3)', [leadId, contactId, '+573001112233']);
        const inbound = over.inboundHoursAgo === undefined ? 6 : over.inboundHoursAgo;
        const outbound = over.outboundHoursAgo === undefined ? 5.5 : over.outboundHoursAgo;
        if (inbound !== null) await lane.sql(`INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at)
            VALUES($1::uuid,'inbound','text','hola','received', NOW() - ($2::text || ' hours')::interval)`, [conversationId, String(inbound)]);
        if (outbound !== null) await lane.sql(`INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at)
            VALUES($1::uuid,'outbound','text','¿te ayudo?','sent', NOW() - ($2::text || ' hours')::interval)`, [conversationId, String(outbound)]);
        return { contactId, conversationId, leadId };
    };
    const outboxCount = async (contactId: string) => (await lane.outboxRows()).filter((r: any) => r.contact_id === contactId).length;
    const conv = async (id: string) => (await lane.sql(`SELECT status, resolved_at, resolution_type,
        metadata->>'nurturing_last_attempt' AS attempt, metadata->>'nurturing_last_sent_at' AS sent_at,
        metadata->>'bookingFollowUpAt' AS booking_nudge FROM conversations WHERE id=$1::uuid`, [id]))[0];

    // ── AUT-13 · nurturing ──────────────────────────────────────────────────────

    it('AUT-13: attempt 1 sends one nudge, records the attempt and schedules attempt 2 on the configured delay', async () => {
        const t = await thread({ inboundHoursAgo: 6, outboundHoursAgo: 5.5 });
        // in-window requires an inbound within 24 h: it is 6 h old.
        await nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 1);
        expect(await outboxCount(t.contactId)).toBe(1);
        expect(await conv(t.conversationId)).toMatchObject({ attempt: '1' });
        expect((await conv(t.conversationId)).sent_at).not.toBeNull();
        const next = queued.find(j => j.data.attempt === 2);
        expect(next).toBeDefined();
        expect(next!.opts.delay).toBe(86_400_000);
    });

    it('AUT-13: running the same attempt again sends nothing more (one nudge per conversation per day)', async () => {
        const t = await thread();
        await nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 1);
        await nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 1);
        await nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 2);
        expect(await outboxCount(t.contactId)).toBe(1);
    });

    it('AUT-13: a customer who answered after our last message gets no nudge and nothing further is scheduled', async () => {
        const t = await thread({ inboundHoursAgo: 1, outboundHoursAgo: 5 });
        await nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 1);
        expect(await outboxCount(t.contactId)).toBe(0);
        expect(queued).toHaveLength(0);
    });

    it('AUT-13: a thread with a person (waiting_human / with_human) or already resolved is left alone', async () => {
        for (const status of ['waiting_human', 'with_human', 'resolved', 'archived']) {
            const t = await thread({ status });
            await nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 1);
            expect(await outboxCount(t.contactId)).toBe(0);
        }
        expect(queued).toHaveLength(0);
    });

    it('AUT-13: nurturing is OFF by default: nothing is scheduled and the sweep queues nothing', async () => {
        settings = undefined;
        const t = await thread();
        await nurturing.scheduleFollowUp(lane.tenantId, t.conversationId, t.leadId);
        await nurturing.checkStaleConversations(lane.tenantId, lane.schema);
        expect(queued).toHaveLength(0);
    });

    it('AUT-13: cancelFollowUp (the customer wrote) removes every pending attempt of that conversation only', async () => {
        const a = await thread(), b = await thread();
        await nurturing.scheduleFollowUp(lane.tenantId, a.conversationId, a.leadId);
        await nurturing.scheduleFollowUp(lane.tenantId, b.conversationId, b.leadId);
        await nurturing.scheduleFollowUp(lane.tenantId, a.conversationId, a.leadId);
        expect(queued.filter(j => !j.removed)).toHaveLength(2);       // scheduling twice keeps one job per thread
        await nurturing.cancelFollowUp(lane.tenantId, a.conversationId);
        const alive = queued.filter(j => !j.removed);
        expect(alive).toHaveLength(1);
        expect(alive[0].data.conversationId).toBe(b.conversationId);
    });

    it('AUT-13: the last attempt creates one closing pass, which resolves the conversation only once the farewell was admitted', async () => {
        const t = await thread({ inboundHoursAgo: 6, outboundHoursAgo: 5.5 });
        await nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 3);
        const closing = queued.find(j => j.data.attempt === 4);
        expect(closing).toBeDefined();
        expect(closing!.opts.delay).toBe(30_000);
        // The farewell is still waiting for its lease: closing now would suppress it.
        await expect(nurturing.executeFollowUp(lane.tenantId, t.conversationId, t.leadId, 4)).rejects.toThrow(/awaiting_admission/);
        expect((await conv(t.conversationId)).status).toBe('active');
    });

    // ── AUT-14 · stale threads ──────────────────────────────────────────────────

    it('AUT-14: only a quiet active thread where WE spoke last is scheduled, once', async () => {
        const quiet = await thread({ updatedHoursAgo: 5, inboundHoursAgo: 6, outboundHoursAgo: 5 });
        const fresh = await thread({ updatedHoursAgo: 1, inboundHoursAgo: 2, outboundHoursAgo: 1 });
        const neverAnswered = await thread({ updatedHoursAgo: 5, inboundHoursAgo: 6, outboundHoursAgo: null });
        const customerWroteLately = await thread({ updatedHoursAgo: 5, inboundHoursAgo: 1, outboundHoursAgo: 5 });
        const resolved = await thread({ updatedHoursAgo: 5, status: 'resolved' });
        await nurturing.checkStaleConversations(lane.tenantId, lane.schema);
        await nurturing.checkStaleConversations(lane.tenantId, lane.schema);
        const scheduledFor = queued.filter(j => !j.removed).map(j => j.data.conversationId);
        expect(scheduledFor).toEqual([quiet.conversationId]);
        for (const other of [fresh, neverAnswered, customerWroteLately, resolved]) expect(scheduledFor).not.toContain(other.conversationId);
        expect(queued[0].opts.delay).toBe(14_400_000);
    });

    // ── AUT-15 · abandoned bookings ─────────────────────────────────────────────

    const abandoned = (hoursAgo: number, step = 'ask_date') => thread({
        inboundHoursAgo: hoursAgo + 1, outboundHoursAgo: hoursAgo + 0.5,
        metadata: { bookingState: { step, serviceName: 'Consulta' }, bookingStateUpdatedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString() },
    });

    it('AUT-15: a booking dropped 3 h ago is nudged once; the next sweep does not nudge the same abandonment again', async () => {
        const t = await abandoned(3);
        await nurturing.checkAbandonedBookings(lane.tenantId, lane.schema);
        expect(await outboxCount(t.contactId)).toBe(1);
        expect((await conv(t.conversationId)).booking_nudge).not.toBeNull();
        await nurturing.checkAbandonedBookings(lane.tenantId, lane.schema);
        expect(await outboxCount(t.contactId)).toBe(1);
    });

    it('AUT-15: too fresh (<2 h), too old (>24 h), a finished booking and a customer who wrote since are not nudged', async () => {
        const fresh = await abandoned(1);
        const old = await abandoned(30);
        const done = await abandoned(3, 'booked');
        const replied = await abandoned(3);
        await lane.sql(`INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at)
            VALUES($1::uuid,'inbound','text','sigo aqui','received', NOW() - interval '30 minutes')`, [replied.conversationId]);
        await nurturing.checkAbandonedBookings(lane.tenantId, lane.schema);
        for (const t of [fresh, old, done, replied]) expect(await outboxCount(t.contactId)).toBe(0);
    });

    it('AUT-15: a customer who abandons AGAIN later is a new abandonment and is nudged again', async () => {
        const t = await abandoned(3);
        await nurturing.checkAbandonedBookings(lane.tenantId, lane.schema);
        // A day later the same customer starts again, drops again.
        await lane.sql("UPDATE conversations SET metadata = jsonb_set(jsonb_set(metadata,'{bookingStateUpdatedAt}', to_jsonb((NOW() - interval '3 hours')::text)), '{bookingFollowUpAt}', to_jsonb((NOW() - interval '30 hours')::text)) WHERE id=$1::uuid", [t.conversationId]);
        await lane.sql("UPDATE conversations SET metadata = jsonb_set(metadata,'{nurturing_last_sent_at}', to_jsonb((NOW() - interval '30 hours')::text)) WHERE id=$1::uuid", [t.conversationId]);
        await lane.sql("DELETE FROM messages WHERE conversation_id=$1::uuid AND created_at > NOW() - interval '2 hours'", [t.conversationId]);
        await nurturing.checkAbandonedBookings(lane.tenantId, lane.schema);
        expect(await outboxCount(t.contactId)).toBe(2);
    });

    // ── AUT-16 · 72 h auto-resolution ───────────────────────────────────────────

    it('AUT-16: 72 h without a message resolves active and waiting_human threads; nothing else', async () => {
        const stale = await thread({ updatedHoursAgo: 73, inboundHoursAgo: 80, outboundHoursAgo: 79 });
        const abandonedHandoff = await thread({ updatedHoursAgo: 80, status: 'waiting_human', inboundHoursAgo: 90, outboundHoursAgo: null });
        const recentMessage = await thread({ updatedHoursAgo: 73, inboundHoursAgo: 1, outboundHoursAgo: null });
        const justUnder = await thread({ updatedHoursAgo: 71, inboundHoursAgo: 80, outboundHoursAgo: null });
        const withHuman = await thread({ updatedHoursAgo: 90, status: 'with_human', inboundHoursAgo: 95, outboundHoursAgo: null });
        const archived = await thread({ updatedHoursAgo: 90, status: 'archived', inboundHoursAgo: 95, outboundHoursAgo: null });
        await nurturing.autoResolveStale();
        for (const t of [stale, abandonedHandoff]) {
            expect(await conv(t.conversationId)).toMatchObject({ status: 'resolved', resolution_type: 'auto_resolved' });
            expect((await conv(t.conversationId)).resolved_at).not.toBeNull();
        }
        expect((await conv(recentMessage.conversationId)).status).toBe('active');
        expect((await conv(justUnder.conversationId)).status).toBe('active');
        expect((await conv(withHuman.conversationId)).status).toBe('with_human');
        expect((await conv(archived.conversationId)).status).toBe('archived');
    });

    it('AUT-16: a second run changes nothing (the timestamp of the first resolution is kept)', async () => {
        const stale = await thread({ updatedHoursAgo: 73, inboundHoursAgo: 80, outboundHoursAgo: null });
        await nurturing.autoResolveStale();
        const first = (await lane.sql('SELECT resolved_at::text AS v FROM conversations WHERE id=$1::uuid', [stale.conversationId]))[0].v;
        await nurturing.autoResolveStale();
        expect((await lane.sql('SELECT resolved_at::text AS v FROM conversations WHERE id=$1::uuid', [stale.conversationId]))[0].v).toBe(first);
    });

    // ── AUT-17 · drip ───────────────────────────────────────────────────────────

    const STEPS = [
        { delay_seconds: 0, message_type: 'custom', content: 'Hola {name}, bienvenido' },
        { delay_seconds: 3600, message_type: 'custom', content: 'Hola {name}, ¿seguimos?', stop_conditions: ['replied'] },
    ];
    const journey = async (steps: any[] = STEPS) => {
        const t = await thread({ inboundHoursAgo: 1, outboundHoursAgo: null });
        await drip.ensureDripTables(lane.schema);
        const sequenceId = randomUUID();
        await lane.sql(`INSERT INTO drip_sequences(id,tenant_id,name,trigger_event,steps,is_active) VALUES($1::uuid,$2::uuid,'Goteo','manual',$3::jsonb,true)`,
            [sequenceId, lane.tenantId, JSON.stringify(steps)]);
        return { ...t, sequenceId };
    };
    const enrol = async (j: { contactId: string; conversationId: string; sequenceId: string }) => {
        const id = randomUUID();
        await lane.sql(`INSERT INTO drip_enrollments(id,sequence_id,contact_id,conversation_id,current_step,status,enrolled_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,'active', NOW() - interval '30 minutes')`, [id, j.sequenceId, j.contactId, j.conversationId]);
        return id;
    };
    const enrolment = async (id: string) => (await lane.sql('SELECT current_step, status, stop_reason FROM drip_enrollments WHERE id=$1::uuid', [id]))[0];

    it('AUT-17: the steps go out in order, each on its own delay, and the journey closes in a pass of its own', async () => {
        const j = await journey();
        const id = await enrol(j);
        await drip.executeStep(lane.tenantId, id);
        expect(await outboxCount(j.contactId)).toBe(1);
        expect(await enrolment(id)).toMatchObject({ current_step: 1, status: 'active' });
        expect(queued.find(q => q.data.stepIndex === 1)!.opts.delay).toBe(3_600_000);
        await drip.executeStep(lane.tenantId, id);
        expect(await outboxCount(j.contactId)).toBe(2);
        expect(await enrolment(id)).toMatchObject({ current_step: 2 });
        expect(queued.find(q => q.data.stepIndex === 2)!.opts.delay).toBe(30_000);
        await lane.sql("UPDATE agent_dispatch_outbox SET state = 'sent' WHERE state IN ('prepared','queued')");
        await drip.executeStep(lane.tenantId, id);
        expect(await enrolment(id)).toMatchObject({ status: 'completed' });
        expect(await outboxCount(j.contactId)).toBe(2);
    });

    it('AUT-17: a customer reply stops the journey before the next step (stop_conditions: replied)', async () => {
        const j = await journey();
        const id = await enrol(j);
        await drip.executeStep(lane.tenantId, id);
        await lane.sql("INSERT INTO messages(conversation_id,direction,content_type,content_text,status) VALUES($1::uuid,'inbound','text','ya no me interesa','received')", [j.conversationId]);
        await drip.executeStep(lane.tenantId, id);
        expect(await enrolment(id)).toMatchObject({ status: 'stopped_replied', stop_reason: 'customer_replied' });
        expect(await outboxCount(j.contactId)).toBe(1);
    });

    it('AUT-17: stopOnReply stops every active enrolment of the contact, and a stopped enrolment sends nothing', async () => {
        const j = await journey();
        const id = await enrol(j);
        (drip as any).redis.get = async () => '1';
        await drip.stopOnReply(lane.tenantId, j.conversationId);
        expect(await enrolment(id)).toMatchObject({ status: 'stopped_replied' });
        await drip.executeStep(lane.tenantId, id);
        expect(await outboxCount(j.contactId)).toBe(0);
        (drip as any).redis.get = async () => null;
    });
});
