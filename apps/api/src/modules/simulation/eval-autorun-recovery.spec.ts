import { EvalAutorunListener } from './eval-autorun.listener';
import { EvalGateProcessor } from './eval-gate.processor';
import { EvalAutorunStateService } from './eval-autorun-state.service';

describe('durable evaluation autorun', () => {
    const request = { tenantId: 'tenant', agentId: 'agent', revision: 'revision' };
    it('recovers a queue outage from the persisted request and retries the same failed job', async () => {
        const queue = { add: jest.fn().mockRejectedValueOnce(new Error('redis offline')).mockResolvedValue({}), getJob: jest.fn().mockResolvedValue(null) };
        const state = { request: jest.fn().mockResolvedValue(request.revision), recoverable: jest.fn().mockResolvedValue([request]) };
        const listener = new EvalAutorunListener(queue as any, state as any);
        await listener.handle(request);
        expect(state.request).toHaveBeenCalledWith('tenant', 'agent');
        await listener.recoverPending();
        expect(queue.add).toHaveBeenCalledTimes(2);
        expect(queue.add.mock.calls[1][1]).toMatchObject(request);
        const failed = { getState: jest.fn().mockResolvedValue('failed'), retry: jest.fn() };
        queue.getJob.mockResolvedValue(failed);
        await listener.recoverPending();
        expect(failed.retry).toHaveBeenCalledTimes(1);
        expect(queue.add).toHaveBeenCalledTimes(2);
    });

    function processor(row: any) {
        const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue({ isInternal: true }) } };
        const evals = { runGateV2: jest.fn(), listScenarios: jest.fn() };
        const state = { get: jest.fn().mockResolvedValue(row), update: jest.fn(async(_tenant,_agent,_revision,status)=>{if(row)row.status=status;}), consumeBudget: jest.fn() };
        return { service: new EvalGateProcessor(evals as any, prisma as any, state as any), evals, state };
    }

    it('discards a superseded revision without using a model or budget', async () => {
        const { service, evals, state } = processor(null);
        await expect(service.process({ data: request } as any)).resolves.toMatchObject({ skipped: true });
        expect(evals.runGateV2).not.toHaveBeenCalled();
        expect(state.consumeBudget).not.toHaveBeenCalled();
    });
    it('does not restart an invalidated request or consume its budget',async()=>{
        const {service,evals,state}=processor({status:'invalidated',agent_snapshot:{},scenarios:[]});
        await expect(service.process({data:request} as any)).resolves.toMatchObject({ok:false,skipped:true});
        expect(evals.runGateV2).not.toHaveBeenCalled();expect(state.consumeBudget).not.toHaveBeenCalled();expect(state.update).not.toHaveBeenCalled();
    });
    it('does not hide a stale approved case from the source guard and stops before running the model',async()=>{
        const id='11111111-1111-4111-8111-111111111111';
        const stale={key:`quality_regression:${id}:1`,regressionCaseId:id,regressionRevision:1,regressionAgentId:'agent',
            regressionScope:{channel:'web_widget',mission:'ask_question'},profileId:'education/capacitacion',seedState:'review_required',regressionBlocked:'source_changed'};
        const row={status:'pending',agent_snapshot:{agentId:'agent',releaseScope:{profileId:'education/capacitacion',intentKeys:['ask_question']}},scenarios:null};
        const {service,evals,state}=processor(row);evals.listScenarios.mockResolvedValue([stale,{...stale,regressionAgentId:'other-agent'}]);
        state.update.mockImplementation(async()=>{row.status='invalidated';});
        await expect(service.process({data:request} as any)).resolves.toMatchObject({ok:false,skipped:true});
        expect(state.update).toHaveBeenCalledWith('tenant','agent','revision','running',undefined,[stale]);
        expect(evals.runGateV2).not.toHaveBeenCalled();expect(state.consumeBudget).not.toHaveBeenCalled();
    });
    it('treats invalidation during a run as terminal and refuses its next budget increment',async()=>{
        const row={status:'pending',agent_snapshot:{},scenarios:[]};const {service,evals,state}=processor(row);
        evals.runGateV2.mockImplementation(async(_tenant,_agent,options)=>{row.status='invalidated';await options.beforeModelUnits(4);});
        await expect(service.process({data:request} as any)).resolves.toMatchObject({ok:false,skipped:true});
        expect(state.consumeBudget).not.toHaveBeenCalled();expect(row.status).toBe('invalidated');
    });

    it('runs the saved snapshot and resumes checkpointed scenarios instead of rereading current config', async () => {
        const frozen = { version: 7, configHash: 'hash' };
        const scenarios = [{ key: 'one' }, { key: 'two' }];
        const results = [{ key: 'one', score: 8 }];
        const { service, evals, state } = processor({ status: 'failed', agent_snapshot: frozen, scenarios, results });
        evals.runGateV2.mockImplementation(async (_tenant, _agent, options) => {
            await options.beforeModelUnits(4);
            await options.onScenarioCompleted(results);
        });
        await service.process({ data: request } as any);
        expect(evals.listScenarios).not.toHaveBeenCalled();
        expect(evals.runGateV2.mock.calls[0][2]).toMatchObject({ agentSnapshot: frozen, scenarios, previousResults: results });
        expect(state.consumeBudget).toHaveBeenCalledWith('tenant', 4);
        expect(state.update).toHaveBeenLastCalledWith('tenant', 'agent', 'revision', 'completed');
    });

    it('defers exhausted budget durably without marking it as a passed evaluation', async () => {
        const { service, evals, state } = processor({ status: 'pending', agent_snapshot: {}, scenarios: [], results: [] });
        evals.runGateV2.mockRejectedValue(new Error('eval_autorun_budget_exhausted'));
        await expect(service.process({ data: request } as any)).resolves.toMatchObject({ ok: false, deferred: true });
        expect(state.update).toHaveBeenLastCalledWith('tenant', 'agent', 'revision', 'budget_deferred', 'eval_autorun_budget_exhausted');
    });

    it('releases no model work when the atomic daily budget refuses its increment', async () => {
        const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('schema'), executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        const state = new EvalAutorunStateService(prisma as any);
        await expect(state.consumeBudget('tenant', 4)).rejects.toThrow('budget_exhausted');
        const budget = prisma.executeInTenantSchema.mock.calls.find((call: any) => call[1].includes('ON CONFLICT (budget_day)')) as any;
        expect(budget[1]).toContain('WHERE eval_autorun_budget.units_used + EXCLUDED.units_used <= $2');
        expect(budget[2]).toEqual([4, 5000]);
    });
});
