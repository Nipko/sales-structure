import { EvalService } from './eval.service';

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
});
