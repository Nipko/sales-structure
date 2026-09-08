import { randomUUID } from 'crypto';
import { AgentReleaseService, releaseErrorCode } from './agent-release.service';
import { AgentReleaseStore } from './agent-release-store';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { withAgentSourceFence } from '../../common/utils/agent-source-fence';

jest.mock('../../common/utils/subscription-entitlement.util',()=>({resolveTenantSubscriptionAccess:jest.fn()}));
describe('Release candidate orchestration',()=>{
    const tenantId=randomUUID(),agentId=randomUUID(),candidateId=randomUUID(),evaluationId=randomUUID(),draftId=randomUUID();
    const actor={id:randomUUID(),role:'tenant_admin'},job={tenantId,agentId,candidateId,evaluationId};
    const snapshot={tenantId,agentId,configurationRevisionId:draftId,knowledgeInputs:{usage:{token:randomUUID(),agentId}},
        releaseScope:{channels:['telegram','web_widget'],intentKeys:['ask_question'],profileId:'education/capacitacion'}};
    function harness(){
        const query=jest.fn().mockResolvedValue([]),prisma:any={getTenantSchemaName:jest.fn().mockResolvedValue('tenant_release_test'),
            transactionInTenantSchema:jest.fn((_schema,work)=>work(query)),executeInTenantSchema:jest.fn().mockResolvedValue([]),tenant:{findMany:jest.fn().mockResolvedValue([{id:tenantId}])}};
        const tests:any={captureSnapshot:jest.fn().mockResolvedValue(snapshot),assertSnapshotCurrent:jest.fn().mockResolvedValue(undefined),
            assertSnapshotExecutable:jest.fn().mockResolvedValue(undefined),releaseSnapshot:jest.fn().mockResolvedValue(undefined)};
        const evals:any={listScenarios:jest.fn().mockResolvedValue([{key:'base'}]),runGateV2:jest.fn().mockResolvedValue({runId:randomUUID(),scenarios:[],releaseEvidence:{}})};
        const budget:any={prepare:jest.fn().mockResolvedValue(undefined),consumeBudget:jest.fn().mockResolvedValue(undefined)};
        const queue:any={add:jest.fn().mockResolvedValue({}),getJob:jest.fn().mockResolvedValue(null)};
        const service=new AgentReleaseService(prisma,tests,evals,budget,queue);
        const claimed={candidate:{id:candidateId,agent_snapshot:snapshot,scenarios:[{key:'base'}]},
            evaluation:{id:evaluationId,channel_type:'telegram',results:[{key:'already_done'}]},leaseToken:randomUUID()};
        const stored={candidate:{...claimed.candidate,status:'evaluating'},evaluations:[
            {id:evaluationId,channel_type:'telegram',status:'running'},
            {id:randomUUID(),channel_type:'web_widget',status:'pending'}]};
        const read=jest.spyOn(AgentReleaseStore.prototype,'read').mockImplementation(async()=>structuredClone(stored));
        const claim=jest.spyOn(AgentReleaseStore.prototype,'claim').mockResolvedValue(claimed);
        const checkpoint=jest.spyOn(AgentReleaseStore.prototype,'checkpoint').mockResolvedValue(snapshot);
        const invalidate=jest.spyOn(AgentReleaseStore.prototype,'invalidate').mockResolvedValue(undefined);
        return {service,tests,prisma,query,evals,budget,queue,claimed,claim,checkpoint,invalidate,stored,read};
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
        const create=jest.spyOn(AgentReleaseStore.prototype,'create').mockImplementation(async()=>{events.push('save');return {id:candidateId,agent_snapshot:snapshot};});
        jest.spyOn(h.service,'read').mockResolvedValue({id:candidateId,status:'pending'});
        h.evals.listScenarios.mockImplementation(async()=>{events.push('scenarios');return events.includes('capture')?[{key:'base'},{key:'new_at_capture'}]:[{key:'base'}];});
        h.tests.captureSnapshot.mockImplementation(async()=>{events.push('capture');return snapshot;});
        h.prisma.executeInTenantSchema.mockResolvedValue([{id:evaluationId}]);h.queue.add.mockRejectedValue(new Error('queue unavailable'));
        await expect(h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor)).resolves.toEqual({id:candidateId,status:'pending'});
        expect(events).toEqual(['ensure','scenarios','capture','scenarios','save']);
        expect(create.mock.calls[0][2].scenarios).toEqual([{key:'base'},{key:'new_at_capture'}]);
        expect(h.queue.add.mock.calls[0][1]).toEqual(job);
        expect(h.tests.assertSnapshotExecutable).toHaveBeenCalledWith(snapshot,tenantId,agentId);
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('replays an existing command without recapturing or starting a second candidate',async()=>{
        const h=harness();jest.spyOn(AgentReleaseStore.prototype,'ensure').mockResolvedValue(undefined);
        jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockResolvedValue({id:candidateId});jest.spyOn(h.service,'read').mockResolvedValue({id:candidateId});
        await h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor);
        expect(h.tests.captureSnapshot).not.toHaveBeenCalled();expect(h.evals.listScenarios).not.toHaveBeenCalled();expect(h.queue.add).not.toHaveBeenCalled();
    });
    it.each(['scenario_read','source_check'])('releases a captured usage when %s fails before saving',async failure=>{
        const h=harness(),error=new Error('evaluation_knowledge_usage_lost');
        jest.spyOn(AgentReleaseStore.prototype,'ensure').mockResolvedValue(undefined);
        jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockResolvedValue(null);
        const create=jest.spyOn(AgentReleaseStore.prototype,'create');
        if(failure==='scenario_read')h.evals.listScenarios.mockResolvedValueOnce([]).mockRejectedValueOnce(error);
        else h.tests.assertSnapshotExecutable.mockRejectedValueOnce(error);
        await expect(h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor)).rejects.toBe(error);
        expect(create).not.toHaveBeenCalled();expect(h.tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
        expect(h.queue.add).not.toHaveBeenCalled();
    });
    it('recovers a lost COMMIT acknowledgement by request identity without revoking its saved usage',async()=>{
        const h=harness(),requestKey=randomUUID();let persisted:any=null,loseAcknowledgement=true;
        jest.spyOn(AgentReleaseStore.prototype,'ensure').mockResolvedValue(undefined);
        const find=jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockImplementation(async()=>persisted);
        const create=jest.spyOn(AgentReleaseStore.prototype,'create').mockImplementation(async()=>{
            persisted={id:candidateId,agent_snapshot:structuredClone(snapshot)};return persisted;
        });
        h.prisma.transactionInTenantSchema.mockImplementation(async(_schema:string,work:any)=>{
            const result=await work(h.query);
            if(persisted&&loseAcknowledgement){loseAcknowledgement=false;throw new Error('COMMIT acknowledgement lost');}
            return result;
        });
        h.prisma.executeInTenantSchema.mockResolvedValue([{id:evaluationId}]);
        jest.spyOn(h.service,'read').mockResolvedValue({id:candidateId,status:'pending'});
        await expect(h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey},actor)).resolves.toMatchObject({id:candidateId});
        expect(find).toHaveBeenLastCalledWith(h.query,agentId,actor,requestKey,draftId);
        expect(create).toHaveBeenCalledTimes(1);expect(h.tests.captureSnapshot).toHaveBeenCalledTimes(1);
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();expect(h.queue.add).toHaveBeenCalledTimes(1);
    });
    it('releases the new usage after the save callback rejects and its partial channel inserts roll back',async()=>{
        const h=harness(),error=new Error('second channel insert rejected');
        jest.spyOn(AgentReleaseStore.prototype,'ensure').mockResolvedValue(undefined);
        const find=jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockResolvedValue(null);
        jest.spyOn(AgentReleaseStore.prototype,'create').mockRejectedValue(error);
        await expect(h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor)).rejects.toBe(error);
        expect(find).toHaveBeenCalledTimes(1);expect(h.tests.releaseSnapshot.mock.calls).toEqual([[snapshot]]);
        expect(h.queue.add).not.toHaveBeenCalled();
    });
    it.each(['unavailable','not_visible'])('preserves the bounded usage when commit recovery is %s',async recovery=>{
        const h=harness(),error=new Error('connection lost after write');
        jest.spyOn(AgentReleaseStore.prototype,'ensure').mockResolvedValue(undefined);
        const find=jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockResolvedValueOnce(null);
        if(recovery==='unavailable')find.mockRejectedValueOnce(new Error('database unavailable'));
        else find.mockResolvedValueOnce(null);
        jest.spyOn(AgentReleaseStore.prototype,'create').mockResolvedValue({id:candidateId,agent_snapshot:snapshot});
        h.prisma.transactionInTenantSchema.mockImplementation(async(_schema:string,work:any)=>{
            const result=await work(h.query);if(result?.id===candidateId)throw error;return result;
        });
        await expect(h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor)).rejects.toBe(error);
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();expect(h.queue.add).not.toHaveBeenCalled();
    });
    it('releases only the losing capture when a simultaneous identical request wins the save',async()=>{
        const h=harness(),winner={...snapshot,knowledgeInputs:{usage:{token:randomUUID(),agentId}}};
        jest.spyOn(AgentReleaseStore.prototype,'ensure').mockResolvedValue(undefined);
        jest.spyOn(AgentReleaseStore.prototype,'findRequest').mockResolvedValue(null);
        const create=jest.spyOn(AgentReleaseStore.prototype,'create').mockResolvedValue({id:candidateId,agent_snapshot:winner});
        jest.spyOn(h.service,'read').mockResolvedValue({id:candidateId});
        await h.service.request(tenantId,agentId,{configurationRevisionId:draftId,requestKey:randomUUID()},actor);
        expect(create).toHaveBeenCalledTimes(1);expect(h.tests.releaseSnapshot.mock.calls).toEqual([[snapshot]]);
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalledWith(winner);
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
        expect(h.tests.assertSnapshotExecutable).toHaveBeenCalledTimes(2);expect(h.tests.assertSnapshotCurrent).not.toHaveBeenCalled();
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('retains the shared reference after the first channel, then releases after both persisted results complete',async()=>{
        const h=harness();
        h.checkpoint.mockImplementation(async(_q:any,_schema:string,input:any)=>{
            if(input.status==='completed'){
                h.stored.evaluations.find(row=>row.id===input.evaluationId)!.status='completed';
                if(h.stored.evaluations.every(row=>row.status==='completed'))h.stored.candidate.status='evaluated';
            }
            return snapshot;
        });
        expect(await h.service.process(job)).toEqual({ok:true});expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
        const second=h.stored.evaluations[1];
        h.claim.mockResolvedValue({...h.claimed,evaluation:{id:second.id,channel_type:'web_widget',results:[]}});
        expect(await h.service.process({...job,evaluationId:second.id})).toEqual({ok:true});
        expect(h.tests.releaseSnapshot.mock.calls).toEqual([[snapshot]]);
        expect(h.stored.evaluations.map(row=>row.status)).toEqual(['completed','completed']);
    });
    it('checks every empty authority callback in the existing source transaction and persists results only after it closes',async()=>{
        const h=harness(),readonly=jest.spyOn(AgentReleaseStore.prototype,'assertExecutionLease').mockResolvedValue(undefined);
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,options:any)=>{
            await withAgentSourceFence(h.prisma,'tenant_release_test',async query=>{
                const transactions=h.prisma.transactionInTenantSchema.mock.calls.length;
                // Mirrors session inbound/lease checks and the later model budget callback.
                await options.assertExecutionAuthority();await options.beforeModelUnits(1);
                expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(transactions);
                expect(readonly.mock.calls).toEqual([[query,{...job,leaseToken:h.claimed.leaseToken}],
                    [query,{...job,leaseToken:h.claimed.leaseToken}]]);
                expect(h.checkpoint).not.toHaveBeenCalled();
            });
            await options.onScenarioCompleted([{key:'safe_result'}]);
            return {runId:randomUUID(),scenarios:[{key:'safe_result'}],releaseEvidence:{}};
        });
        expect(await h.service.process(job)).toEqual({ok:true});
        expect(h.budget.consumeBudget).toHaveBeenCalledWith(tenantId,1);
        expect(h.checkpoint.mock.calls.map(call=>call[2].status)).toEqual([undefined,'completed']);
    });
    it('refuses model budget and preserves a replacement worker when the readonly lease guard expires',async()=>{
        const h=harness();jest.spyOn(AgentReleaseStore.prototype,'assertExecutionLease').mockRejectedValue(new Error('agent_release_lease_lost'));
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,options:any)=>
            withAgentSourceFence(h.prisma,'tenant_release_test',async()=>{await options.beforeModelUnits(1);throw new Error('unreachable provider');}));
        expect(await h.service.process(job)).toMatchObject({skipped:true,reason:'agent_release_lease_lost'});
        expect(h.budget.consumeBudget).not.toHaveBeenCalled();expect(h.checkpoint).not.toHaveBeenCalled();
        expect(h.invalidate).not.toHaveBeenCalled();expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('still invalidates provenance failure from the readonly source guard after the outer transaction closes',async()=>{
        const h=harness();jest.spyOn(AgentReleaseStore.prototype,'assertExecutionLease').mockRejectedValue(new Error('regression_review_changed'));
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,options:any)=>
            withAgentSourceFence(h.prisma,'tenant_release_test',async()=>{await options.assertExecutionAuthority();throw new Error('unreachable provider');}));
        expect(await h.service.process(job)).toMatchObject({invalidated:true,reason:'agent_release_source_changed'});
        expect(h.invalidate).toHaveBeenCalledTimes(1);expect(h.tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
        expect(h.budget.consumeBudget).not.toHaveBeenCalled();
    });
    it.each(['pending','failed','budget_deferred','running'])('cannot release while another channel remains %s',async status=>{
        const h=harness();h.stored.candidate.status='evaluated';
        h.stored.evaluations[0].status='completed';h.stored.evaluations[1].status=status;
        expect(await h.service.process(job)).toEqual({ok:true});expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('does not turn an unavailable terminal-state read into a retry of completed effects',async()=>{
        const h=harness();h.read.mockResolvedValueOnce(structuredClone(h.stored)).mockRejectedValueOnce(new Error('database disconnected'));
        expect(await h.service.process(job)).toEqual({ok:true});
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
        expect(h.checkpoint).toHaveBeenCalledTimes(1);expect(h.checkpoint.mock.calls[0][2].status).toBe('completed');
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
        const h=harness();h.tests.assertSnapshotExecutable.mockRejectedValue(new Error('evaluation_dependencies_changed:tenant.services'));
        expect(await h.service.process(job)).toMatchObject({ok:false,invalidated:true,reason:'agent_release_revision_changed'});
        expect(h.invalidate).toHaveBeenCalled();expect(h.evals.runGateV2).not.toHaveBeenCalled();expect(h.budget.consumeBudget).not.toHaveBeenCalled();
        expect(h.tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
    });
    it.each(['evaluation_knowledge_usage_lost','evaluation_knowledge_lease_lost','evaluation_knowledge_read_failed',
        'evaluation_knowledge_snapshot_scope_mismatch','llm_source_authority_unavailable'])('invalidates %s without retrying the old source',async code=>{
        const h=harness();h.tests.assertSnapshotExecutable.mockRejectedValue(new Error(code));
        expect(await h.service.process(job)).toEqual({ok:false,invalidated:true,reason:'agent_release_source_changed'});
        expect(h.evals.runGateV2).not.toHaveBeenCalled();expect(h.checkpoint).not.toHaveBeenCalled();
        expect(h.tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
    });
    it('discards completed model output if source authority disappears before its result checkpoint',async()=>{
        const h=harness();h.tests.assertSnapshotExecutable.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('evaluation_knowledge_usage_lost'));
        expect(await h.service.process(job)).toMatchObject({invalidated:true,reason:'agent_release_source_changed'});
        expect(h.evals.runGateV2).toHaveBeenCalledTimes(1);expect(h.checkpoint).not.toHaveBeenCalled();
        expect(h.tests.releaseSnapshot).toHaveBeenCalledTimes(1);
    });
    it('keeps a private reference when claim rejects source provenance and invalidation clears the row',async()=>{
        const h=harness();h.claim.mockRejectedValue(new Error('regression_source_changed'));
        h.invalidate.mockImplementation(async()=>{(h.stored.candidate as any).agent_snapshot=null;});
        expect(await h.service.process(job)).toMatchObject({invalidated:true});
        expect(h.tests.releaseSnapshot.mock.calls).toEqual([[snapshot]]);expect(h.evals.runGateV2).not.toHaveBeenCalled();
    });
    it('preserves ownership if invalidation itself has an uncertain commit outcome',async()=>{
        const h=harness(),error=new Error('invalidation acknowledgement lost');
        h.tests.assertSnapshotExecutable.mockRejectedValue(new Error('evaluation_knowledge_usage_lost'));h.invalidate.mockRejectedValue(error);
        await expect(h.service.process(job)).rejects.toBe(error);expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('cannot save results after losing its lease, and does not invalidate the replacement worker',async()=>{
        const h=harness();h.checkpoint.mockRejectedValue(new Error('agent_release_lease_lost'));
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,opts:any)=>{await opts.assertExecutionAuthority();throw new Error('unreachable');});
        expect(await h.service.process(job)).toMatchObject({ok:false,skipped:true,reason:'agent_release_lease_lost'});
        expect(h.invalidate).not.toHaveBeenCalled();expect(h.budget.consumeBudget).not.toHaveBeenCalled();expect(h.checkpoint).toHaveBeenCalledTimes(1);
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('saves budget deferral without publishing and retains completed scenario checkpoints',async()=>{
        const h=harness();h.budget.consumeBudget.mockRejectedValue(new Error('eval_autorun_budget_exhausted'));
        h.evals.runGateV2.mockImplementation(async(_tenant:string,_agent:string,opts:any)=>{await opts.beforeModelUnits(1);throw new Error('unreachable');});
        expect(await h.service.process(job)).toMatchObject({deferred:true,reason:'eval_autorun_budget_exhausted'});
        expect(h.checkpoint.mock.calls.at(-1)?.[2]).toMatchObject({status:'budget_deferred',error:'eval_autorun_budget_exhausted'});
        expect(h.checkpoint.mock.calls.at(-1)?.[2].results).toBeUndefined();
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('retains its usage for an ordinary provider failure and retries through the existing checkpoint contract',async()=>{
        const h=harness();h.evals.runGateV2.mockRejectedValue(new Error('provider temporarily unavailable'));
        expect(await h.service.process(job)).toMatchObject({deferred:true,reason:'agent_release_evaluation_unavailable'});
        expect(h.checkpoint.mock.calls.at(-1)?.[2]).toMatchObject({status:'failed',error:'agent_release_evaluation_unavailable'});
        expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();expect(h.invalidate).not.toHaveBeenCalled();
    });
    it('reads and reviews historical evidence after the execution usage has been released',async()=>{
        const h=harness();h.stored.candidate.status='evaluated';h.stored.candidate.scenarios=[];
        h.tests.assertSnapshotExecutable.mockRejectedValue(new Error('evaluation_knowledge_usage_lost'));
        const review=jest.spyOn(AgentReleaseStore.prototype,'review').mockImplementation(async(_q:any,_schema:string,_input:any,assertCurrent:any)=>{
            await assertCurrent(snapshot);return {id:randomUUID()};
        });
        await expect(h.service.read(tenantId,agentId,candidateId,actor)).resolves.toMatchObject({revisionState:'current',status:'evaluated'});
        await expect(h.service.review(tenantId,agentId,candidateId,{} as any,actor)).resolves.toMatchObject({revisionState:'current'});
        expect(review).toHaveBeenCalledTimes(1);expect(h.tests.assertSnapshotCurrent).toHaveBeenCalledTimes(3);
        expect(h.tests.assertSnapshotExecutable).not.toHaveBeenCalled();expect(h.tests.releaseSnapshot).not.toHaveBeenCalled();
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
