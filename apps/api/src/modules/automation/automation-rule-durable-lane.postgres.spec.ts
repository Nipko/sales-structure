import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationJobsProcessor } from './automation-jobs.processor';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL, DispatchOutboxError } from '../channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE RULE ACTION, THROUGH THE REAL STORE ═══
 *
 * `send_template` was the one automation action that spends money and the only
 * one with nothing durable behind it. It called `WhatsappMessagingService`
 * directly from a BullMQ worker, so:
 *
 *   · a restart between "the trigger matched" and the POST lost the message and
 *     left `automation_executions` saying `queued` for ever;
 *   · the queue add carries no `jobId`, so a retry after an ambiguous timeout
 *     sent the template a second time — from October, a second charge;
 *   · the execution was marked `success` on whatever the handler returned, and
 *     the handler returned the provider's own optimistic `success` flag;
 *   · nothing re-read the rule. The seeded templates delay an action by up to
 *     three days, and an operator who switched the rule off inside that window
 *     still got the message.
 *
 * Everything here is asserted against the DATABASE — the outbox row, the
 * history row, the execution row — never against the return value of the call
 * that wrote it.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('an automation rule action on the durable lane', () => {
    const tenantId = randomUUID();
    const schema = `tenant_rulelane_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550002222';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    let processor: any;
    let published: string[] = [];
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** One active rule, one captured lead, one execution row waiting on it. */
    const firing = async (over: { active?: boolean } = {}) => {
        const contactId = randomUUID();
        const ruleId = randomUUID();
        const executionId = randomUUID();
        await sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)',
            [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await sql(`INSERT INTO automation_rules(id, active, trigger_type, actions_json, conditions_json)
            VALUES($1::uuid, $2, 'lead.captured', $3::jsonb, '{}'::jsonb)`,
            [ruleId, over.active ?? true,
                JSON.stringify([{ type: 'send_template', template_name: 'bienvenida' }])]);
        await sql(`INSERT INTO automation_executions(id, rule_id, entity_type, entity_id, status)
            VALUES($1::uuid,$2::uuid,'lead',$3,'queued')`, [executionId, ruleId, contactId]);
        return { contactId, ruleId, executionId };
    };

    const action = { type: 'send_template', template_name: 'bienvenida', language: 'es', components: [] };
    const event = (contactId: string) => ({
        tenantId, schemaName: schema, leadId: randomUUID(), contactId,
        phone: '+573001112233', source: 'whatsapp_inbound',
        channelAccountId: NUMBER, channelAccountType: 'whatsapp',
    });

    const outboxRows = async () => sql(
        `SELECT id, item_kind, state, origin_kind, channel_account_id, conversation_id,
                contact_id, payload, operational_scope, error_code
           FROM agent_dispatch_outbox ORDER BY created_at`);

    const executionStatus = async (id: string) => (await sql(
        'SELECT status, result_json FROM automation_executions WHERE id = $1::uuid', [id]))[0];

    /** The handler, driven directly: the subject is the effect, not the switch. */
    const send = (firingRow: { contactId: string; ruleId: string; executionId: string },
        over: Record<string, unknown> = {}) =>
        processor.handleSendTemplate(tenantId, schema, firingRow.executionId, firingRow.ruleId,
            { ...action, ...over }, event(firingRow.contactId));

    /** The whole job, so `automation_executions` is written by the real path. */
    const run = (firingRow: { contactId: string; ruleId: string; executionId: string }) =>
        processor.process({
            attemptsMade: 0, opts: { attempts: 3 },
            data: {
                tenantId, schemaName: schema, executionId: firingRow.executionId,
                ruleId: firingRow.ruleId, ruleName: 'bienvenida', action,
                event: event(firingRow.contactId),
            },
        });

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
            findUnique: async () => ({
                id: tenantId, schemaName: schema, isInternal: true, subscriptionStatus: 'active',
            }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            channel_type TEXT, email TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE automation_rules(id UUID PRIMARY KEY, active BOOLEAN DEFAULT true,
            trigger_type TEXT, actions_json JSONB, conditions_json JSONB)`);
        await sql(`CREATE TABLE automation_executions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            rule_id UUID, entity_type TEXT, entity_id TEXT, status TEXT,
            finished_at TIMESTAMPTZ, result_json JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store,
            { enqueueDispatch: async (_t: string, id: string) => { published.push(id); } } as any);
        processor = Object.create(AutomationJobsProcessor.prototype);
        Object.assign(processor, {
            prisma, proactive,
            throttle: { isLimited: async () => false },
            httpRequestHandler: { execute: async () => ({}) },
            pipelineService: {},
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_rulelane_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        await sql(`TRUNCATE agent_dispatch_outbox, messages, conversations, contacts,
            automation_executions, automation_rules CASCADE`);
    });

    // ── THE ROW THE REAL STORE ACCEPTS ──────────────────────────────────────

    it('commits a template row on the account the rule names', async () => {
        const fired = await firing();
        await send(fired);
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect({ kind: rows[0].item_kind, origin: rows[0].origin_kind, state: rows[0].state })
            .toEqual({ kind: 'template', origin: 'proactive', state: 'queued' });
        expect(rows[0].channel_account_id).toBe(NUMBER);
        expect(rows[0].payload).toMatchObject({ templateName: 'bienvenida', language: 'es' });
    });

    it('carries an authority the admission can revalidate', async () => {
        const fired = await firing();
        await send(fired);
        const [row] = await outboxRows();
        expect(row.operational_scope).toMatchObject({
            kind: 'proactive_policy', producer: 'automation_rule_action',
            entityId: fired.ruleId, channelAccountId: NUMBER,
        });
        expect(String(row.operational_scope.entityRevision)).toMatch(/^[a-f0-9]{64}$/);
    });

    it('writes the history row in the same transaction, as pending', async () => {
        const fired = await firing();
        await send(fired);
        const [message] = await sql(
            "SELECT status, content_type FROM messages WHERE direction = 'outbound'");
        expect(message).toMatchObject({ status: 'pending', content_type: 'template' });
    });

    it('opens the thread on the number that pays, not on the lead’s own', async () => {
        // A rule that overrides the connection is precisely the case where the
        // event's own thread belongs to somebody else's number, and the outbox
        // refuses a binding whose conversation does not match. The lead here
        // arrived on one number and the rule names another.
        const fired = await firing();
        const [arrived] = await sql(
            `INSERT INTO conversations(contact_id, channel_type, channel_account_id)
             VALUES($1::uuid,'whatsapp',$2) RETURNING id`, [fired.contactId, NUMBER]);
        await processor.handleSendTemplate(tenantId, schema, fired.executionId, fired.ruleId,
            { ...action, channel_account_id: '15559998888' },
            { ...event(fired.contactId), conversationId: arrived.id });
        const [row] = await outboxRows();
        expect(row.channel_account_id).toBe('15559998888');
        expect(row.conversation_id).not.toBe(arrived.id);
        const [conversation] = await sql(
            'SELECT channel_account_id FROM conversations WHERE id = $1::uuid', [row.conversation_id]);
        expect(conversation.channel_account_id).toBe('15559998888');
    });

    // ── REPLAY, AND TWO WORKERS ─────────────────────────────────────────────

    it('collapses two attempts at the same action onto one row', async () => {
        // The BullMQ retry after an ambiguous timeout. It used to send the
        // template again, because the queue add carries no `jobId` and nothing
        // durable remembered the first attempt.
        const fired = await firing();
        await send(fired);
        await send(fired);
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql("SELECT id FROM messages WHERE direction='outbound'")).toHaveLength(1);
    });

    it('prepares one row when two workers race the same action', async () => {
        const fired = await firing();
        await Promise.all([send(fired), send(fired)]);
        expect(await outboxRows()).toHaveLength(1);
    });

    it('keeps two different template actions of one rule apart', async () => {
        // One execution row covers every action of a firing, so the origin has
        // to carry what the action sends as well. Collapsing them would send one
        // message and record two.
        const fired = await firing();
        await send(fired);
        await send(fired, { template_name: 'recordatorio' });
        expect(await outboxRows()).toHaveLength(2);
    });

    // ── THE EXECUTION FLAG FOLLOWS THE EFFECT ───────────────────────────────

    it('marks the execution successful only once a row exists', async () => {
        const fired = await firing();
        await run(fired);
        expect((await executionStatus(fired.executionId)).status).toBe('success');
        expect(await outboxRows()).toHaveLength(1);
    });

    it('can write the execution result at all', async () => {
        // ═══ A DEFECT THAT PREDATES THE LANE, FOUND BY RUNNING THE REAL SQL ═══
        //
        // `result_json` is JSONB and all three writes passed the value as an
        // untyped string, which Prisma sends as `text`. PostgreSQL refuses
        // `jsonb = text` (42804), so EVERY terminal write of this processor
        // threw — the success one included. An execution therefore never left
        // `queued`, and, because the throw happened AFTER the action had
        // already run, BullMQ retried the whole job and the template went out
        // again. Three attempts, three charges, and an audit trail that said
        // the automation never completed.
        //
        // The `::jsonb` cast is the fix, and this is what proves it: not that
        // the call returned, but that the row now holds the result.
        const fired = await firing();
        await run(fired);
        const execution = await executionStatus(fired.executionId);
        expect(execution.result_json).toMatchObject({
            action: 'send_template', templateName: 'bienvenida', dispatch: 'prepared',
        });
    });

    it('does not mark the execution successful when the outbox refuses', async () => {
        // THE DEFECT, in its new clothes: `process` writes `success` on whatever
        // the handler returns, so a handler that returned normally after a
        // refusal would leave an audit row claiming the automation ran.
        const fired = await firing();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new DispatchOutboxError('dispatch_binding_changed'));
        await expect(run(fired)).rejects.toThrow(/automation_rule_action_no_despachada:refused/);
        expect((await executionStatus(fired.executionId)).status).toBe('queued');
        expect(await outboxRows()).toEqual([]);
        broken.mockRestore();
    });

    it('leaves the execution retryable when the commit itself was uncertain', async () => {
        // Not a decision: a database that was busy. Nothing was written, so the
        // job throws, BullMQ retries, and the flag is left alone.
        const fired = await firing();
        const flaky = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
        await expect(run(fired)).rejects.toThrow(/automation_rule_action_no_despachada:deferred/);
        expect((await executionStatus(fired.executionId)).status).toBe('queued');
        flaky.mockRestore();
        // And the retry finds nothing in the way.
        await run(fired);
        expect(await outboxRows()).toHaveLength(1);
    });

    it('commits the row even when nothing could be published', async () => {
        // The asymmetry the durable lane exists for: the row is the record, and
        // a publish that never happened is recovered from it.
        const fired = await firing();
        const live = (proactive as any).queue;
        (proactive as any).queue = {
            enqueueDispatch: async () => { throw new Error('redis is down'); },
        };
        try { await run(fired); } finally { (proactive as any).queue = live; }
        const [row] = await outboxRows();
        // Still claimable: the recovery pass reads the row, not the queue.
        expect(['prepared', 'queued']).toContain(row.state);
        expect(published).toEqual([]);
        expect((await executionStatus(fired.executionId)).status).toBe('success');
    });

    it('refuses to send at all when no connection was named', async () => {
        const fired = await firing();
        await expect(processor.handleSendTemplate(tenantId, schema, fired.executionId, fired.ruleId,
            action, { ...event(fired.contactId), channelAccountId: undefined,
                channelAccountType: undefined, channel: undefined }))
            .rejects.toThrow(/automation_rule_action_sin_conexion/);
        expect(await outboxRows()).toEqual([]);
    });

    it('lends nothing from an Instagram lead, however well formed the id is', async () => {
        const fired = await firing();
        await expect(processor.handleSendTemplate(tenantId, schema, fired.executionId, fired.ruleId,
            action, { ...event(fired.contactId), channelAccountId: 'IG_ACCOUNT',
                channelAccountType: 'instagram' }))
            .rejects.toThrow(/automation_rule_action_sin_conexion/);
        expect(await outboxRows()).toEqual([]);
    });

    // ── THE RULE SOMEBODY SWITCHED OFF ──────────────────────────────────────

    it('suppresses the action when the rule is no longer active', async () => {
        // The seeded templates delay an action by up to three days. Switching
        // the rule off inside that window is an operator saying stop, and it
        // used to send anyway.
        const fired = await firing({ active: false });
        const result = await send(fired);
        expect(result).toMatchObject({ suppressed: 'rule_no_longer_authorises' });
        expect(await outboxRows()).toEqual([]);
    });

    it('closes the execution rather than retrying a suppressed action', async () => {
        const fired = await firing({ active: false });
        await run(fired);
        expect((await executionStatus(fired.executionId)).status).toBe('success');
    });

    it('suppresses one whose rule was switched off after preparing', async () => {
        const fired = await firing();
        await send(fired);
        const [row] = await outboxRows();
        await sql('UPDATE automation_rules SET active = false WHERE id = $1::uuid', [fired.ruleId]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        const [after] = await outboxRows();
        expect(after.state).toBe('suppressed');
        expect(String(after.error_code)).toContain('proactive_gone');
    });

    it('suppresses one whose rule was edited to send something else', async () => {
        const fired = await firing();
        await send(fired);
        const [row] = await outboxRows();
        await sql(`UPDATE automation_rules SET actions_json = $2::jsonb WHERE id = $1::uuid`,
            [fired.ruleId, JSON.stringify([{ type: 'send_template', template_name: 'otra' }])]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_stale');
    });

    it('still admits one whose rule has not moved', async () => {
        // The control. Without it, "suppress when stale" could be "never admit".
        const fired = await firing();
        await send(fired);
        const [row] = await outboxRows();
        expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
    });
});
