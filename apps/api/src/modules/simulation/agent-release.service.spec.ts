import { randomUUID } from 'crypto';
import { AgentReleaseService, releaseErrorCode } from './agent-release.service';
import { AgentReleaseStore } from './agent-release-store';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';

jest.mock('../../common/utils/subscription-entitlement.util',()=>({resolveTenantSubscriptionAccess:jest.fn()}));
describe('Release candidate orchestration',()=>{
    const tenantId=randomUUID(),agentId=randomUUID(),candidateId=randomUUID(),evaluationId=randomUUID(),draftId=randomUUID();
    const actor={id:randomUUID(),role:'tenant_admin'},job={tenantId,agentId,candidateId,evaluationId};
    const snapshot={tenantId,agentId,configurationRevisionId:draftId,releaseScope:{channels:['telegram','web_widget'],intentKeys:['ask_question'],profileId:'education/capacitacion'}};
    function harness(){
        const query=jest.fn().mockResolvedValue([]),prisma:any={getTenantSchemaName:jest.fn().mockResolvedValue('tenant_release_test'),
            transactionInTenantSchema:jest.fn((_schema,work)=>work(query)),executeInTenantSchema:jest.fn().mockResolvedValue([]),tenant:{findMany:jest.fn().mockResolvedValue([{id:tenantId}])}};
        const tests:any={captureSnapshot:jest.fn().mockResolvedValue(snapshot),assertSnapshotCurrent:jest.fn().mockResolvedValue(undefined)};
        const evals:any={listScenarios:jest.fn().mockResolvedValue([{key:'base'}]),runGateV2:jest.fn().mockResolvedValue({runId:randomUUID(),scenarios:[],releaseEvidence:{}})};
        const budget:any={prepare:jest.fn().mockResolvedValue(undefined),consumeBudget:jest.fn().mockResolvedValue(undefined)};
        const queue:any={add:jest.fn().mockResolvedValue({}),getJob:jest.fn().mockResolvedValue(null)};
        const service=new AgentReleaseService(prisma,tests,evals,budget,queue);
        const claimed={candidate:{id:candidateId,agent_snapshot:snapshot,scenarios:[{key:'base'}]},
            evaluation:{id:evaluationId,channel_type:'telegram',results:[{key:'already_done'}]},leaseToken:randomUUID()};
        const claim=jest.spyOn(AgentReleaseStore.prototype,'claim').mockResolvedValue(claimed);
        const checkpoint=jest.spyOn(AgentReleaseStore.prototype,'checkpoint').mockResolvedValue(snapshot);
        const invalidate=jest.spyOn(AgentReleaseStore.prototype,'invalidate').mockResolvedValue(undefined);
        return {service,tests,prisma,query,evals,budget,queue,claimed,claim,checkpoint,invalidate};
    }
    beforeEach(()=>{(resolveTenantSubscriptionAccess as jest.Mock).mockResolvedValue({allowed:true});});
    afterEach(()=>jest.restoreAllMocks());
    it('rejects raw snapshots, result injection and caller-chosen threshold before reading or queuing',async()=>{
        const h=harness();
        for(const extra of [{snapshot},{threshold:0},{results:[{passed:true}]}])
            await expect(h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID(),...extra},actor))
                .rejects.toMatchObject({response:{error:'agent_release_request_invalid'}});
        expect(h.prisma.getTenantSchemaName).not.toHaveBeenCalled();expect(h.queue.add).not.toHaveBeenCalled();
    });
    it('reads scenarios after the shared capture and leaves a durable request if queue dispatch fails',async()=>{
        const h=harness(),events:string[]=[];
        jest.spyOn(AgentReleaseStore.prototype,'ensure').mockImplementation(async()=>{events.push('ensure');});
        jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockResolvedValue(null);
        const create=jest.spyOn(AgentReleaseStore.prototype,'create').mockImplementation(async()=>{events.push('save');return {id:candidateId};});
        jest.spyOn(h.service,'read').mockResolvedValue({id:candidateId,status:'pending'});
        h.evals.listScenarios.mockImplementation(async()=>{events.push('scenarios');return events.includes('capture')?[{key:'base'},{key:'new_at_capture'}]:[{key:'base'}];});
        h.tests.captureSnapshot.mockImplementation(async()=>{events.push('capture');return snapshot;});
        h.prisma.executeInTenantSchema.mockResolvedValue([{id:evaluationId}]);h.queue.add.mockRejectedValue(new Error('queue unavailable'));
        await expect(h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor)).resolves.toEqual({id:candidateId,status:'pending'});
        expect(events).toEqual(['ensure','scenarios','capture','scenarios','save']);
        expect(create.mock.calls[0][2].scenarios).toEqual([{key:'base'},{key:'new_at_capture'}]);
        expect(h.queue.add.mock.calls[0][1]).toEqual(job);
    });
    it('replays an existing command without recapturing or starting a second candidate',async()=>{
        const h=harness();jest.spyOn(AgentReleaseStore.prototype,'ensure').mockResolvedValue(undefined);
        jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockResolvedValue({id:candidateId});jest.spyOn(h.service,'read').mockResolvedValue({id:candidateId});
        await h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor);
        expect(h.tests.captureSnapshot).not.toHaveBeenCalled();expect(h.evals.listScenarios).not.toHaveBeenCalled();expect(h.queue.add).not.toHaveBeenCalled();
    });
    it('uses the persisted channel and snapshot, resumes checkpoints and verifies authority before tools and model budget',async()=>{
        const h=harness();
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,options:any)=>{
            await options.assertExecutionAuthority();await options.beforeModelUnits(2);await options.onScenarioCompleted([{key:'now_done'}]);
            return {runId:randomUUID(),scenarios:[{key:'now_done'}],releaseEvidence:{channelType:'telegram'}};
        });
        expect(await h.service.process(job)).toEqual({ok:true});
        expect(h.evals.runGateV2.mock.calls[0][2]).toMatchObject({agentSnapshot:snapshot,channelType:'telegram',k:3,threshold:8,passPolicy:'all',previousResults:[{key:'already_done'}]});
        expect(h.budget.consumeBudget).toHaveBeenCalledWith(tenantId,2);
        expect(h.checkpoint.mock.calls.at(-1)?.[2]).toMatchObject({...job,leaseToken:h.claimed.leaseToken,status:'completed',results:[{key:'now_done'}]});
    });
    it('defers without claiming or calling a model when tenant entitlement cannot authorize work',async()=>{
        const h=harness();(resolveTenantSubscriptionAccess as jest.Mock).mockResolvedValue({allowed:false});
        expect(await h.service.process(job)).toMatchObject({ok:false,deferred:true});expect(h.claim).not.toHaveBeenCalled();expect(h.evals.runGateV2).not.toHaveBeenCalled();
    });
    it('skips a completed or already leased evaluation before using budget',async()=>{
        const h=harness();h.claim.mockResolvedValue(null);expect(await h.service.process(job)).toEqual({ok:false,skipped:true});
        expect(h.budget.consumeBudget).not.toHaveBeenCalled();expect(h.evals.runGateV2).not.toHaveBeenCalled();
    });
    it('scrubs a revision changed before execution instead of evaluating it or retrying obsolete work',async()=>{
        const h=harness();h.tests.assertSnapshotCurrent.mockRejectedValue(new Error('evaluation_dependencies_changed:tenant.services'));
        expect(await h.service.process(job)).toMatchObject({ok:false,invalidated:true,reason:'agent_release_revision_changed'});
        expect(h.invalidate).toHaveBeenCalled();expect(h.evals.runGateV2).not.toHaveBeenCalled();expect(h.budget.consumeBudget).not.toHaveBeenCalled();
    });
    it('cannot save results after losing its lease, and does not invalidate the replacement worker',async()=>{
        const h=harness();h.checkpoint.mockRejectedValue(new Error('agent_release_lease_lost'));
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,opts:any)=>{await opts.assertExecutionAuthority();throw new Error('unreachable');});
        expect(await h.service.process(job)).toMatchObject({ok:false,skipped:true,reason:'agent_release_lease_lost'});
        expect(h.invalidate).not.toHaveBeenCalled();expect(h.budget.consumeBudget).not.toHaveBeenCalled();expect(h.checkpoint).toHaveBeenCalledTimes(1);
    });
    it('saves budget deferral without publishing and retains completed scenario checkpoints',async()=>{
        const h=harness();h.budget.consumeBudget.mockRejectedValue(new Error('eval_autorun_budget_exhausted'));
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,opts:any)=>{await opts.beforeModelUnits(1);throw new Error('unreachable');});
        expect(await h.service.process(job)).toMatchObject({deferred:true,reason:'eval_autorun_budget_exhausted'});
        expect(h.checkpoint.mock.calls.at(-1)?.[2]).toMatchObject({status:'budget_deferred',error:'eval_autorun_budget_exhausted'});
        expect(h.checkpoint.mock.calls.at(-1)?.[2].results).toBeUndefined();
    });
    it('does not return stored response examples when their dependency revision cannot be verified',async()=>{
        const h=harness();jest.spyOn(AgentReleaseStore.prototype,'read').mockResolvedValue({candidate:{id:candidateId,agent_snapshot:snapshot,scenarios:[],channels:['telegram'],status:'evaluated'},evaluations:[]});
        h.tests.assertSnapshotCurrent.mockRejectedValue(new Error('evaluation_dependencies_unavailable'));
        expect(await h.service.read(tenantId,agentId,candidateId,actor)).toMatchObject({revisionState:'unavailable',review:null,activationAllowed:false});
    });
    it('recovers due SQL requests with identifier-only messages, and retries a failed queue delivery',async()=>{
        const h=harness();jest.spyOn(AgentReleaseStore.prototype,'exists').mockResolvedValue(true);
        h.query.mockResolvedValue([{id:candidateId,agent_id:agentId}]);h.prisma.executeInTenantSchema.mockResolvedValue([{id:evaluationId}]);
        await h.service.recover();expect(h.queue.add.mock.calls[0][1]).toEqual(job);
        h.queue.add.mockClear();const retry=jest.fn();h.queue.getJob.mockResolvedValue({getState:async()=> 'failed',retry});
        await h.service.recover();expect(retry).toHaveBeenCalledTimes(1);expect(h.queue.add).not.toHaveBeenCalled();
    });
    it('never stores arbitrary provider or database messages as the public failure reason',()=>{
        expect(releaseErrorCode(new Error('Provider response containing secret and customer text'))).toBe('agent_release_evaluation_unavailable');
        expect(releaseErrorCode({response:{error:'regression_review_changed'}})).toBe('agent_release_source_changed');
    });
});
