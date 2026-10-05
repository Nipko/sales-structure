import { randomUUID } from 'crypto';
import { AutomationJobsProcessor } from './automation-jobs.processor';
import { LANE_CHAT_DDL, N3_LANE_URL, leadOptedOut, openLane, optOut } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · send_template (task id AUT-C27). A rule action `send_template` must not
 * message a phone on the opt-out register. `AutomationJobsProcessor
 * .handleSendTemplate` asks the register before it prepares anything, and the
 * outbox asks again when it grants the lease (`automationRuleRevision`), for the
 * person who opts out while the action waits.
 *
 * Oracle: the outbox row and `automation_executions.result_json` of the run.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-C27: automation send_template honours the opt-out register', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let processor: any;
    const SENDER = '15550002222';
    const action = { type: 'send_template', template_name: 'bienvenida', language: 'es', components: [] };

    beforeAll(async () => {
        lane = await openLane('n3auto', [
            ...LANE_CHAT_DDL,
            'CREATE TABLE automation_rules(id UUID PRIMARY KEY, active BOOLEAN DEFAULT true, trigger_type TEXT, actions_json JSONB, conditions_json JSONB)',
            `CREATE TABLE automation_executions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rule_id UUID, entity_type TEXT,
                entity_id TEXT, status TEXT, finished_at TIMESTAMPTZ, result_json JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
        ]);
        processor = Object.create(AutomationJobsProcessor.prototype);
        Object.assign(processor, {
            prisma: lane.prisma, proactive: lane.proactive,
            throttle: {
                reserveActionUsage: async () => ({ allowed: true, count: 1, adopted: false }),
                commitActionUsage: async () => undefined,
            },
            httpRequestHandler: { execute: async () => ({}) }, pipelineService: {},
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        await lane.sql('TRUNCATE agent_dispatch_outbox, messages, conversations, contacts, opt_out_records, leads, automation_executions, automation_rules CASCADE');
    });

    const fire = async (name: string, phone: string, prepare?: (contactId: string) => Promise<unknown>) => {
        const contactId = randomUUID(), ruleId = randomUUID(), executionId = randomUUID();
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)', [contactId, name, phone, 'whatsapp']);
        if (prepare) await prepare(contactId);
        await lane.sql(`INSERT INTO automation_rules(id,active,trigger_type,actions_json,conditions_json)
            VALUES($1::uuid,true,'lead.captured',$2::jsonb,'{}'::jsonb)`, [ruleId, JSON.stringify([action])]);
        await lane.sql(`INSERT INTO automation_executions(id,rule_id,entity_type,entity_id,status,result_json)
            VALUES($1::uuid,$2::uuid,'lead',$3,'queued',$4::jsonb)`, [executionId, ruleId, contactId,
            JSON.stringify({ version: 1, actions: [{ index: 0, type: action.type, status: 'queued', action }] })]);
        const result = await processor.process({
            id: `automation-${executionId}-0`, attemptsMade: 0, opts: { attempts: 3 },
            data: {
                tenantId: lane.tenantId, schemaName: lane.schema, executionId, ruleId, ruleName: 'bienvenida', actionIndex: 0, action,
                event: { tenantId: lane.tenantId, schemaName: lane.schema, leadId: randomUUID(), contactId, phone,
                    source: 'whatsapp_inbound', channelAccountId: SENDER, channelAccountType: 'whatsapp' },
            },
        }).catch((error: Error) => ({ threw: error.message }));
        return { contactId, result };
    };

    it('send_template: the phone on the opt-out register gets no template; any other phone still does', async () => {
        await optOut(lane.sql, '+573001110001');
        const quiet = await fire('Ana Baja', '+573001110001');
        const active = await fire('Beto Activo', '+573001110002');

        const rows = await lane.outboxRows();
        expect(rows.filter((r: any) => r.contact_id === active.contactId)).toHaveLength(1);
        expect(rows.filter((r: any) => r.contact_id === quiet.contactId)).toHaveLength(0);
    });

    it('send_template: nothing is prepared for the opted-out phone (no conversation either) and the run says why', async () => {
        await optOut(lane.sql, '573001110001');
        const quiet = await fire('Ana Baja', '+573001110001');
        expect(quiet.result).toMatchObject({ suppressed: 'recipient_opted_out' });
        expect(await lane.outboxRows()).toHaveLength(0);
        expect(await lane.sql('SELECT id FROM conversations WHERE contact_id=$1::uuid', [quiet.contactId])).toHaveLength(0);
    });

    it('send_template: a lead-level unsubscribe (leads.opted_out) suppresses it', async () => {
        const carla = await fire('Carla Formulario', '+573001110003',
            contactId => leadOptedOut(lane.sql, { phone: '+573009990000', contactId }));
        expect(carla.result).toMatchObject({ suppressed: 'recipient_opted_out' });
        expect(await lane.outboxRows()).toHaveLength(0);
    });

    it('send_template (second layer): a contact who opts out AFTER the action was queued is suppressed at admission', async () => {
        const later = await fire('Dora Despues', '+573001110004');
        const [row] = await lane.outboxRows();
        expect(row.contact_id).toBe(later.contactId);
        expect(row.state).toBe('queued');

        await optOut(lane.sql, '+573001110004');

        await expect(lane.store.admit(lane.tenantId, row.id)).rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        const [after] = await lane.outboxRows();
        expect(after.state).toBe('suppressed');
        expect(String(after.error_code)).toContain('proactive_gone');
    });

    it('send_template (second layer): control — without an opt-out the same queued action is admitted', async () => {
        await fire('Eva Sigue', '+573001110005');
        const [row] = await lane.outboxRows();
        expect((await lane.store.admit(lane.tenantId, row.id)).row.state).toBe('admitted');
    });
});
