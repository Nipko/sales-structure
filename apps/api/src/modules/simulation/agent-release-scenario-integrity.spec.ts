import { EvalService } from './eval.service';
import { releaseErrorCode } from './agent-release.service';

describe('release scenarios must execute their complete definition',()=>{
    const excessive=[...Array.from({length:8},(_,i)=>`Turn ${i+1}`),'Do not perform the operation after all'];
    it.each([excessive,[],[''],['valid',null]].map(messages=>[messages]))('rejects an invalid or over-budget definition before sandbox/model work: %j',async messages=>{
        const sandbox=jest.fn();
        const service=Object.assign(Object.create(EvalService.prototype),{withOwnedSandboxSession:sandbox});
        await expect(service.runScenarioWithActions('tenant','agent','schema',{messages},8,false)).rejects.toMatchObject({response:{error:'eval_scenario_messages_invalid'}});
        expect(sandbox).not.toHaveBeenCalled();
    });
    it('does not silently save a shortened user scenario',async()=>{
        const getTenantSchemaName=jest.fn();
        const service=Object.assign(Object.create(EvalService.prototype),{prisma:{getTenantSchemaName}});
        await expect(service.addScenario('tenant',{key:'complete',title:'Full cancellation',messages:excessive})).rejects.toMatchObject({response:{error:'eval_scenario_messages_invalid'}});
        expect(getTenantSchemaName).not.toHaveBeenCalled();
    });
    it.each(['eval_autorun_budget_exhausted','agent_release_lease_lost'])('preserves %s through the AgentTest runtime error envelope',code=>{
        expect(releaseErrorCode(new Error(`agent_runtime_failed:${code}`))).toBe(code);
    });
    it('does not retain an arbitrary runtime exception as release status',()=>{
        expect(releaseErrorCode(new Error('agent_runtime_failed:SQL contained secret@example.test'))).toBe('agent_release_evaluation_unavailable');
    });
});
