import { randomUUID } from 'crypto';
import { AutomationJobsProcessor } from './automation-jobs.processor';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 AUT-11 (was red; fixed with `$4::timestamptz`) — the `create_task` rule action could not write its task.
 *
 * `AutomationJobsProcessor.handleCreateTask` inserted
 *     INSERT INTO tasks (lead_id, title, description, due_at, status, created_at)
 *     VALUES ($1::uuid, $2, $3, $4, 'pending', NOW())
 * with `$4` an ISO string. `tasks.due_at` is `TIMESTAMP` (tenant-schema.sql) and Prisma
 * sends the string as `text`, so PostgreSQL answers 42804 ("column due_at is of type
 * timestamp without time zone but expression is of type text"): the action fails on
 * every attempt and the rule's follow-up task is never created. (Elsewhere the product
 * writes `$n::timestamp` for this exact reason.)
 *
 * Oracle: the `tasks` table and the execution ledger after the job ran.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 DEFECT AUT-11: create_task action', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let processor: any;

    beforeAll(async () => {
        lane = await openLane('n3taskdef', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE tasks(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, title VARCHAR(500),
                description TEXT, status VARCHAR(50) DEFAULT 'pending', due_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE automation_rules(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255) DEFAULT 'regla',
                trigger_type VARCHAR(100), conditions_json JSONB DEFAULT '{}', actions_json JSONB DEFAULT '[]', active BOOLEAN DEFAULT true)`,
            `CREATE TABLE automation_executions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rule_id UUID, entity_type VARCHAR(50),
                entity_id UUID, status VARCHAR(50), finished_at TIMESTAMP, result_json JSONB DEFAULT '{}', event_key TEXT)`,
        ]);
        processor = Object.create(AutomationJobsProcessor.prototype);
        Object.assign(processor, {
            prisma: lane.prisma, proactive: lane.proactive,
            throttle: { reserveActionUsage: async () => ({ allowed: true }), commitActionUsage: async () => undefined },
            httpRequestHandler: {}, pipelineService: {},
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });

    it('AUT-11: create_task writes one task for the lead, due after the configured hours', async () => {
        const leadId = randomUUID(), ruleId = randomUUID(), executionId = randomUUID();
        const action = { type: 'create_task', task_description: 'Llamar al lead', task_due_hours: 48 };
        await lane.sql("INSERT INTO automation_rules(id,trigger_type,actions_json) VALUES($1::uuid,'lead.captured',$2::jsonb)", [ruleId, JSON.stringify([action])]);
        await lane.sql("INSERT INTO automation_executions(id,rule_id,entity_type,entity_id,status,result_json) VALUES($1::uuid,$2::uuid,'lead',$3::uuid,'queued',$4::jsonb)",
            [executionId, ruleId, leadId, JSON.stringify({ version: 1, actions: [{ index: 0, type: 'create_task', status: 'queued', action }] })]);
        let failure = '';
        await processor.process({
            id: `automation-${executionId}-0`, attemptsMade: 0, opts: { attempts: 3 },
            data: { tenantId: lane.tenantId, schemaName: lane.schema, executionId, ruleId, ruleName: 'regla', actionIndex: 0, action, event: { tenantId: lane.tenantId, leadId } },
        }).catch((e: any) => { failure = String(e?.message ?? e).replace(/\s+/g, ' ').slice(-190); });
        const tasks = await lane.sql('SELECT lead_id, title, status FROM tasks');
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-11] create_task tasks=${tasks.length} error="${failure}"`);
        expect(failure).toBe('');
        expect(tasks).toEqual([{ lead_id: leadId, title: 'Llamar al lead', status: 'pending' }]);
    });
});
