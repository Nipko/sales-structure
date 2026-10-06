import { randomUUID } from 'crypto';
import { AutomationListenerService } from './automation-listener.service';
import { AutomationJobsProcessor } from './automation-jobs.processor';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-10 / AUT-11 — the rule engine from the event to the effect, with the real
 * listener, the real worker and PostgreSQL in between; only BullMQ is a recorder.
 *
 *   trigger     message.inbound, lead.captured, appointment.completed and
 *               pipeline.stage_changed each admit the ACTIVE rules of their trigger and
 *               nothing else; a disabled rule and a rule of another trigger do not fire.
 *   conditions  structured `[{field, operator, value}]` conditions decide per event.
 *   admission   one `automation_executions` row per firing with every action slot
 *               `queued`, one job per action with a stable id, the delay honoured under
 *               either spelling; a replayed durable event reuses its row.
 *   effect      add_tag / create_task / assign_agent write what they promise, once, even
 *               when BullMQ retries; an unknown action is a failure, never a success.
 *   authority   a delayed job whose rule was disabled meanwhile produces nothing.
 *   ledger      the execution closes only when every one of its actions has.
 *
 * Oracle: rows in automation_executions, tags, lead_tags, tasks and leads; the recorded
 * queue admissions. The quota is a double that records the effect ids it was asked for.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-10/11: automation rules, event to effect', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let listener: any;
    let processor: any;
    let jobs: Array<{ name: string; data: any; opts: any }> = [];
    let overLimit = false;
    let persona: any;
    let reservations: string[] = [];
    let users: Record<string, string> = {};

    beforeAll(async () => {
        lane = await openLane('n3rules', [
            ...LANE_CHAT_DDL,
            "ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL",
            "ALTER TABLE leads ADD COLUMN stage VARCHAR(50) DEFAULT 'nuevo'",
            'ALTER TABLE leads ADD COLUMN assigned_to VARCHAR(255)',
            'ALTER TABLE leads ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()',
            'CREATE TABLE opportunities(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, deal_id UUID)',
            `CREATE TABLE tags(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL UNIQUE, color VARCHAR(20))`,
            `CREATE TABLE lead_tags(lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (lead_id, tag_id))`,
            `CREATE TABLE tasks(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, title VARCHAR(500),
                description TEXT, status VARCHAR(50) DEFAULT 'pending', due_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE automation_rules(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id VARCHAR(255) DEFAULT 't',
                name VARCHAR(255) DEFAULT 'regla', trigger_type VARCHAR(100) NOT NULL, conditions_json JSONB DEFAULT '{}',
                actions_json JSONB DEFAULT '[]', active BOOLEAN DEFAULT false)`,
            `CREATE TABLE automation_executions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                rule_id UUID REFERENCES automation_rules(id) ON DELETE CASCADE, entity_type VARCHAR(50) NOT NULL,
                entity_id UUID NOT NULL, status VARCHAR(50) DEFAULT 'pending', started_at TIMESTAMP DEFAULT NOW(),
                finished_at TIMESTAMP, result_json JSONB DEFAULT '{}', event_key TEXT)`,
            'CREATE UNIQUE INDEX uidx_automation_executions_event_key ON automation_executions(event_key) WHERE event_key IS NOT NULL',
        ]);
        const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        listener = Object.create(AutomationListenerService.prototype);
        Object.assign(listener, {
            prisma: lane.prisma,
            personaService: { getActivePersona: async () => persona },
            throttle: { isOverLimit: async () => overLimit, getPriority: async () => 5 },
            automationQueue: { add: async (name: string, data: any, opts: any) => { jobs.push({ name, data, opts }); return { id: opts?.jobId }; } },
            regionalProfile: { timezoneFor: async () => 'UTC', timezoneForSchema: async () => 'UTC' },
            logger,
        });
        (lane.prisma as any).user = { findFirst: async ({ where }: any) => (users[where.email] ? { id: users[where.email] } : null) };
        processor = Object.create(AutomationJobsProcessor.prototype);
        Object.assign(processor, {
            prisma: lane.prisma, proactive: lane.proactive,
            throttle: {
                reserveActionUsage: async (_t: string, _k: string, effectId: string) => { reservations.push(effectId); return { allowed: true, count: 1, adopted: false }; },
                commitActionUsage: async () => undefined,
            },
            httpRequestHandler: { execute: async () => ({}) },
            pipelineService: {},
            logger,
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        jobs = []; overLimit = false; reservations = []; users = {};
        persona = { hours: { timezone: 'UTC', schedule: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].reduce((s: any, d) => ({ ...s, [d]: { start: '00:00', end: '23:59' } }), {}) } };
        await lane.sql('TRUNCATE agent_dispatch_outbox, automation_executions, automation_rules, lead_tags, tags, tasks, opportunities, leads, messages, conversations, contacts CASCADE');
    });

    const rule = async (trigger: string, actions: any[], over: { active?: boolean; conditions?: any } = {}) => {
        const [r] = await lane.sql(`INSERT INTO automation_rules(trigger_type, name, active, conditions_json, actions_json)
            VALUES($1,'regla qa',$2,$3::jsonb,$4::jsonb) RETURNING id`,
        [trigger, over.active ?? true, JSON.stringify(over.conditions ?? {}), JSON.stringify(actions)]);
        return r.id as string;
    };
    const lead = async (stage = 'nuevo') => {
        const contactId = randomUUID(), leadId = randomUUID(), conversationId = randomUUID();
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)', [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await lane.sql('INSERT INTO leads(id,contact_id,phone,stage) VALUES($1::uuid,$2::uuid,$3,$4)', [leadId, contactId, '+573001112233', stage]);
        await lane.sql("INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,'whatsapp','15550001111')", [conversationId, contactId]);
        return { contactId, leadId, conversationId };
    };
    const executions = () => lane.sql('SELECT id, rule_id, entity_type, status, event_key, result_json FROM automation_executions ORDER BY started_at');
    const tagAction = { type: 'add_tag', tag: 'vip' };
    /** Run a recorded job through the real worker. */
    const work = (job: { name: string; data: any; opts: any }, attemptsMade = 0) =>
        processor.process({ id: job.opts.jobId, attemptsMade, opts: job.opts, data: job.data });

    // ── triggers ───────────────────────────────────────────────────────────────

    it('AUT-10: message.inbound admits the active new_message rule: one queued execution, one job with a stable id', async () => {
        const l = await lead();
        const ruleId = await rule('new_message', [tagAction]);
        await listener.handleMessageInbound({ tenantId: lane.tenantId, schemaName: lane.schema, conversationId: l.conversationId, leadId: l.leadId });
        const rows = await executions();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rule_id: ruleId, entity_type: 'conversation', status: 'queued' });
        expect(rows[0].result_json.actions).toEqual([expect.objectContaining({ index: 0, type: 'add_tag', status: 'queued' })]);
        expect(jobs).toHaveLength(1);
        expect(jobs[0].opts).toMatchObject({ jobId: `automation-${rows[0].id}-0`, attempts: 3, delay: 0 });
    });

    it('AUT-10: a disabled rule and a rule of another trigger do not fire', async () => {
        const l = await lead();
        await rule('new_message', [tagAction], { active: false });
        await rule('conversation_assigned', [tagAction]);
        await listener.handleMessageInbound({ tenantId: lane.tenantId, schemaName: lane.schema, conversationId: l.conversationId, leadId: l.leadId });
        expect(await executions()).toHaveLength(0);
        expect(jobs).toHaveLength(0);
    });

    it('AUT-10: lead.captured fires inside business hours and is skipped outside them', async () => {
        const l = await lead();
        await rule('lead.captured', [tagAction]);
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: l.leadId, source: 'whatsapp_inbound' });
        expect(await executions()).toHaveLength(1);
        persona = { hours: { timezone: 'UTC', schedule: {} } };       // closed every day
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: randomUUID(), source: 'whatsapp_inbound' });
        expect(await executions()).toHaveLength(1);
    });

    it('AUT-10: pipeline.stage_changed fires only for the deal whose stage condition matches', async () => {
        const won = await lead('ganado'), lost = await lead('perdido');
        const dealWon = randomUUID(), dealLost = randomUUID();
        await lane.sql('INSERT INTO opportunities(lead_id, deal_id) VALUES($1::uuid,$2::uuid),($3::uuid,$4::uuid)', [won.leadId, dealWon, lost.leadId, dealLost]);
        await rule('stage_changed', [tagAction], { conditions: [{ field: 'stage', operator: 'equals', value: 'ganado' }] });
        await listener.handlePipelineStageChanged({ tenantId: lane.tenantId, schemaName: lane.schema, dealId: dealLost, toStageSlug: 'perdido' });
        expect(await executions()).toHaveLength(0);
        await listener.handlePipelineStageChanged({ tenantId: lane.tenantId, schemaName: lane.schema, dealId: dealWon, toStageSlug: 'ganado' });
        const rows = await executions();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ entity_type: 'deal' });
        expect(jobs[0].data.event).toMatchObject({ leadId: won.leadId, stage: 'ganado' });
    });

    // ── conditions ──────────────────────────────────────────────────────────────

    it('AUT-10: structured conditions decide per event (equals, not_equals, contains, greater_than)', async () => {
        const l = await lead();
        const base = { tenantId: lane.tenantId, schemaName: lane.schema, conversationId: l.conversationId };
        await rule('new_message', [tagAction], { conditions: [
            { field: 'businessHoursStatus', operator: 'equals', value: 'open' },
            { field: 'channel', operator: 'not_equals', value: 'instagram' },
            { field: 'text', operator: 'contains', value: 'PRECIO' },
            { field: 'score', operator: 'greater_than', value: 5 },
        ] });
        await listener.handleMessageInbound({ ...base, channel: 'instagram', text: 'cual es el precio', score: 9 });
        await listener.handleMessageInbound({ ...base, channel: 'whatsapp', text: 'hola', score: 9 });
        await listener.handleMessageInbound({ ...base, channel: 'whatsapp', text: 'cual es el precio', score: 3 });
        expect(await executions()).toHaveLength(0);
        persona = { hours: { timezone: 'UTC', schedule: {} } };
        await listener.handleMessageInbound({ ...base, channel: 'whatsapp', text: 'cual es el precio', score: 9 });
        expect(await executions()).toHaveLength(0);            // closed: businessHoursStatus != 'open'
        persona = null;
        await listener.handleMessageInbound({ ...base, channel: 'whatsapp', text: 'cual es el precio', score: 9 });
        expect(await executions()).toHaveLength(0);            // unknown: != 'open'
        persona = { hours: { timezone: 'UTC', schedule: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].reduce((s: any, d) => ({ ...s, [d]: { start: '00:00', end: '23:59' } }), {}) } };
        await listener.handleMessageInbound({ ...base, channel: 'whatsapp', text: 'cual es el precio', score: 9 });
        expect(await executions()).toHaveLength(1);
    });

    // ── admission ───────────────────────────────────────────────────────────────

    it('AUT-10: an action delay is honoured under both spellings (delay and delay_seconds)', async () => {
        const l = await lead();
        await rule('new_message', [{ type: 'add_tag', tag: 'a', delay: 3600 }, { type: 'add_tag', tag: 'b', delay_seconds: 60 }, { type: 'add_tag', tag: 'c' }]);
        await listener.handleMessageInbound({ tenantId: lane.tenantId, schemaName: lane.schema, conversationId: l.conversationId });
        expect(jobs.map(j => j.opts.delay)).toEqual([3_600_000, 60_000, 0]);
        expect(jobs.map(j => j.opts.jobId.split('-').pop())).toEqual(['0', '1', '2']);
    });

    it('AUT-10: replaying the SAME durable event (appointment.completed) reuses the execution row and the job ids', async () => {
        await rule('appointment.completed', [tagAction]);
        const event = { tenantId: lane.tenantId, schemaName: lane.schema, appointmentId: randomUUID(), leadId: randomUUID() };
        await listener.handleAppointmentCompleted(event);
        await listener.handleAppointmentCompleted(event);
        expect(await executions()).toHaveLength(1);
        expect(new Set(jobs.map(j => j.opts.jobId)).size).toBe(1);
        expect(jobs).toHaveLength(2);                           // BullMQ de-duplicates the second add by id
    });

    it('AUT-10: over the plan limit nothing is admitted, and the durable producer is told (it throws)', async () => {
        await rule('appointment.completed', [tagAction]);
        overLimit = true;
        await expect(listener.handleAppointmentCompleted({ tenantId: lane.tenantId, schemaName: lane.schema, appointmentId: randomUUID() }))
            .rejects.toThrow(/automation_trigger_rate_limited/);
        expect(await executions()).toHaveLength(0);
        expect(jobs).toHaveLength(0);
    });

    // ── effect ──────────────────────────────────────────────────────────────────

    it('AUT-11: add_tag creates the tag and the link once, however many times BullMQ runs it; the execution closes as success', async () => {
        const l = await lead();
        await rule('lead.captured', [tagAction]);
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: l.leadId, source: 'x' });
        await work(jobs[0]);
        await work(jobs[0], 1);                                  // a retry of the same logical job
        expect(await lane.sql('SELECT name FROM tags')).toEqual([{ name: 'vip' }]);
        expect(await lane.sql('SELECT lead_id FROM lead_tags')).toEqual([{ lead_id: l.leadId }]);
        const [row] = await executions();
        expect(row.status).toBe('success');
        expect(row.result_json.actions[0]).toMatchObject({ status: 'success' });
        // The quota is asked for the SAME effect id on the retry: one logical action, one unit.
        expect(new Set(reservations).size).toBe(1);
    });

    it('AUT-11: assign_agent writes the agent on the lead; an unknown email fails and writes nothing', async () => {
        const l = await lead();
        const agent = randomUUID();
        users['ventas@example.invalid'] = agent;
        await rule('lead.captured', [{ type: 'assign_agent', agentId: 'ventas@example.invalid' }, { type: 'assign_agent', agentId: 'nadie@example.invalid' }]);
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: l.leadId, source: 'x' });
        await work(jobs[0]);
        expect((await lane.sql('SELECT assigned_to FROM leads WHERE id=$1::uuid', [l.leadId]))[0].assigned_to).toBe(agent);
        await expect(work(jobs[1])).rejects.toThrow(/No existe un usuario/);
        expect((await lane.sql('SELECT assigned_to FROM leads WHERE id=$1::uuid', [l.leadId]))[0].assigned_to).toBe(agent);
    });

    it('AUT-11: an unknown action type is a failure on the last attempt, never a success', async () => {
        const l = await lead();
        await rule('lead.captured', [{ type: 'teletransportar' }]);
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: l.leadId, source: 'x' });
        await expect(work(jobs[0], 2)).rejects.toThrow(/desconocido/);
        const [row] = await executions();
        expect(row.status).toBe('failed');
        expect(row.result_json.actions[0].status).toBe('failed');
    });

    // ── authority and ledger ────────────────────────────────────────────────────

    it('AUT-11: a rule disabled while its action sat in the delay produces no effect, and the execution says suppressed', async () => {
        const l = await lead();
        const ruleId = await rule('lead.captured', [tagAction]);
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: l.leadId, source: 'x' });
        await lane.sql('UPDATE automation_rules SET active=false WHERE id=$1::uuid', [ruleId]);
        await work(jobs[0]);
        expect(await lane.sql('SELECT 1 FROM tags')).toHaveLength(0);
        const [row] = await executions();
        expect(row.status).toBe('suppressed');
        expect(reservations).toHaveLength(0);                    // no quota spent on a revoked action
    });

    it('AUT-11: an action edited while it waited is revoked too (the job carries the old action)', async () => {
        const l = await lead();
        const ruleId = await rule('lead.captured', [tagAction]);
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: l.leadId, source: 'x' });
        await lane.sql("UPDATE automation_rules SET actions_json = '[{\"type\":\"add_tag\",\"tag\":\"otra\"}]'::jsonb WHERE id=$1::uuid", [ruleId]);
        await work(jobs[0]);
        expect(await lane.sql('SELECT 1 FROM tags')).toHaveLength(0);
        expect((await executions())[0].status).toBe('suppressed');
    });

    it('AUT-11: the execution stays in_progress until EVERY action has finished, then closes as success', async () => {
        const l = await lead();
        await rule('lead.captured', [{ type: 'add_tag', tag: 'uno' }, { type: 'add_tag', tag: 'dos' }]);
        await listener.handleLeadCaptured({ tenantId: lane.tenantId, schemaName: lane.schema, leadId: l.leadId, source: 'x' });
        await work(jobs[0]);
        let [row] = await executions();
        expect(row.status).toBe('in_progress');
        expect(row.result_json.actions.map((a: any) => a.status)).toEqual(['success', 'queued']);
        await work(jobs[1]);
        [row] = await executions();
        expect(row.status).toBe('success');
        expect(await lane.sql('SELECT name FROM tags ORDER BY name')).toEqual([{ name: 'dos' }, { name: 'uno' }]);
    });
});
