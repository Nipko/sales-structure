import { LearningEvaluationService } from './learning-evaluation.service';
import { LEARNING_DIMENSIONS } from './learning-contracts';
import { LearningEvaluationProcessor } from './learning-evaluation.module';

const tenantId='11111111-1111-4111-8111-111111111111',agentId='22222222-2222-4222-8222-222222222222';
const releaseId='33333333-3333-4333-8333-333333333333';
const sourceIds=['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'];
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function build(){
    const snapshot={tenantId,agentId,configHash:'frozen',version:3,config:{language:'es'},capturedAt:'2026-09-06T00:00:00Z'};
    const run={attemptId:'attempt',agentSnapshot:snapshot,dependencyHash:'stable',results:[]};
    const learning={createEvaluationSnapshot:jest.fn().mockResolvedValue({releaseId,releaseHash:'release-hash',baselineReleaseId:null,baselineReleaseHash:null,
        cases:sourceIds.map(sourceId=>({sourceId,language:'es',channel:'web_widget',messages:[
            {role:'customer',text:'Necesito ayuda'},{role:'assistant',text:'Respuesta histórica NUNCA esperada'},
            {role:'customer',text:'Tengo una duda adicional'},{role:'assistant',text:'Otra respuesta histórica'}]}))}),
        dependencyHash:jest.fn().mockResolvedValue('stable'),beginEvaluation:jest.fn(),evaluationRun:jest.fn().mockResolvedValue(run),
        claimEvaluationWorker:jest.fn(async(_t:string,_a:string,_r:string,_attempt:string,_hash:string,_worker:string,_expected:string|null)=>structuredClone(run)),
        checkpointEvaluation:jest.fn(),recordEvaluation:jest.fn(async(_t,_a,_r,evidence,_worker?:string)=>evidence),failEvaluation:jest.fn().mockResolvedValue(true),
        registerEvaluationNamespace:jest.fn(),cleanEvaluationNamespaces:jest.fn(),reapEvaluationNamespaces:jest.fn(),
        runtimeSourceAuthority:jest.fn(()=>async(invoke:any)=>invoke()),
        withEvaluationSources:jest.fn(async(_t,_a,_r,_attempt,_hash,work)=>work(jest.fn()))};
    let sessionIndex=0;
    const session={sandboxContactId:'00000000-0000-4000-8000-00000000eba1',sandboxConversationId:'',assertLease:jest.fn(),
        sandboxNamespace:undefined as any,
        reset:jest.fn(async()=>{session.sandboxConversationId=`00000000-0000-4000-8000-${String(++sessionIndex).padStart(12,'0')}`;
            session.sandboxNamespace={schemaName:`tenant_eval_11111111_${String(sessionIndex).padStart(24,'0')}`,tenantId,sourceSchema:'tenant_learning',token:`lease-${sessionIndex}`};}),recordInbound:jest.fn()};
    const sandbox={withSandboxSession:jest.fn(async(_tenant,callback)=>callback(session))};
    const agentTest={assertSnapshotExecutable:jest.fn().mockResolvedValue(undefined),captureSnapshot:jest.fn().mockResolvedValue(snapshot),
        releaseSnapshot:jest.fn().mockResolvedValue(undefined),snapshotSourceAuthority:jest.fn(()=>async(invoke:any)=>invoke()),test:jest.fn(async(_t,_a,req,opts)=>{
        await opts.beforeModelExecution();
        return {reply:'Te ayudo. ¿Cuál es tu consulta?',debug:{agentRevision:{configHash:'frozen'},toolCalls:[],ragHits:[],model:'test-model'}};
    })};
    const judgment={A:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,4])),criticalFailures:[]},
        B:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,3])),criticalFailures:[]}};
    const llm={execute:jest.fn().mockResolvedValue({content:JSON.stringify(judgment)})};
    const queue={add:jest.fn()};
    const prisma={getTenantSchemaName:jest.fn().mockResolvedValue('tenant_learning'),executeInTenantSchema:jest.fn().mockResolvedValue([])};
    const service=new LearningEvaluationService(learning as any,agentTest as any,sandbox as any,llm as any,queue as any,prisma as any);
    const job={tenantId,agentId,releaseId,attemptId:'attempt'};
    return {service,learning,agentTest,llm,queue,prisma,session,sandbox,snapshot,job,run};
}

describe('Learning A/B uses the full runtime with isolated histories',()=>{
    it('holds both frozen knowledge and reviewed learning authority around the same judge provider invocation',async()=>{
        const f=build(),events:string[]=[];let knowledgeActive=false,learningActive=false;
        f.agentTest.snapshotSourceAuthority.mockImplementation(()=>async(invoke:any)=>{
            events.push('knowledge:enter');knowledgeActive=true;
            try{return await invoke();}finally{events.push('knowledge:exit');knowledgeActive=false;}
        });
        f.learning.runtimeSourceAuthority.mockImplementation(()=>async(invoke:any)=>{
            expect(knowledgeActive).toBe(true);events.push('learning:enter');learningActive=true;
            try{return await invoke();}finally{events.push('learning:exit');learningActive=false;}
        });
        const provider=jest.fn(async()=>{
            expect(knowledgeActive&&learningActive).toBe(true);events.push('provider');
            return {content:JSON.stringify({A:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,4])),criticalFailures:[]},
                B:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,3])),criticalFailures:[]}})};
        });
        f.llm.execute.mockImplementation(async(request:any)=>request.withSourceAuthority(provider));
        const workerToken='77777777-7777-4777-8777-777777777777';
        const evidence=await f.service.run(f.job,workerToken);
        expect(evidence.results.every((result:any)=>result.criticalFailures.length===0)).toBe(true);
        expect(events).toEqual(Array.from({length:3},()=>['knowledge:enter','learning:enter','provider','learning:exit','knowledge:exit']).flat());
        expect(f.agentTest.snapshotSourceAuthority).toHaveBeenCalledTimes(3);
        expect(f.agentTest.snapshotSourceAuthority).toHaveBeenCalledWith(f.snapshot);
        expect(f.learning.runtimeSourceAuthority).toHaveBeenCalledWith(tenantId,agentId,[],expect.objectContaining({persistence:'disabled'}),
            {releaseId,attemptId:'attempt',workerToken,releaseHash:'release-hash',baselineReleaseId:null,baselineReleaseHash:null});
    });
    it.each(['knowledge:before','knowledge:after','learning:before','learning:after'])(
        'cannot certify a judge response after %s authority is revoked',async fault=>{
            const f=build(),provider=jest.fn(async()=>({content:JSON.stringify({
                A:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,4])),criticalFailures:[]},
                B:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,4])),criticalFailures:[]}})}));
            const authority=(source:string)=>async(invoke:any)=>{
                if(fault===`${source}:before`)throw new Error('source_authority_revoked');
                const response=await invoke();
                if(fault===`${source}:after`)throw new Error('source_authority_revoked');
                return response;
            };
            f.agentTest.snapshotSourceAuthority.mockImplementation(()=>authority('knowledge'));
            f.learning.runtimeSourceAuthority.mockImplementation(()=>authority('learning'));
            f.llm.execute.mockImplementation(async(request:any)=>request.withSourceAuthority(provider));
            const evidence=await f.service.run(f.job);
            expect(evidence.results).toHaveLength(3);
            expect(evidence.results.every((result:any)=>result.candidateScore===0&&result.baselineScore===0
                &&result.criticalFailures.includes('comparison_unavailable'))).toBe(true);
            expect(provider).toHaveBeenCalledTimes(fault.endsWith(':before')?0:3);
        });
    it('releases the frozen corpus only after the final evidence transaction has acknowledged completion',async()=>{
        const f=build(),entered=deferred(),finish=deferred();
        f.learning.recordEvaluation.mockImplementation(async(_t,_a,_r,evidence)=>{
            entered.resolve();await finish.promise;return evidence;
        });
        const work=f.service.run(f.job);await entered.promise;
        try{
            expect(f.learning.cleanEvaluationNamespaces).toHaveBeenCalledTimes(1);
            expect(f.agentTest.releaseSnapshot).not.toHaveBeenCalled();
        }finally{finish.resolve();}
        await work;
        expect(f.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
        expect(f.agentTest.releaseSnapshot).toHaveBeenCalledWith(f.snapshot);
        expect(f.agentTest.releaseSnapshot.mock.invocationCallOrder[0]).toBeGreaterThan(f.learning.recordEvaluation.mock.invocationCallOrder[0]);
    });
    it('retains the corpus after an uncertain finalization ACK instead of invalidating a resumable evaluation',async()=>{
        const f=build();f.learning.recordEvaluation.mockRejectedValueOnce(new Error('finalization_ack_lost'));
        await expect(f.service.run(f.job)).rejects.toThrow('finalization_ack_lost');
        expect(f.learning.cleanEvaluationNamespaces).toHaveBeenCalledTimes(1);
        expect(f.agentTest.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('retains the corpus between queue worker retries and releases it when the successful invocation finalizes',async()=>{
        const f=build(),processor=new LearningEvaluationProcessor(f.service,f.learning as any);
        f.learning.checkpointEvaluation.mockRejectedValueOnce(new Error('checkpoint_unavailable'));
        await expect(processor.process({data:f.job,attemptsMade:0,opts:{attempts:2}} as any)).rejects.toThrow('checkpoint_unavailable');
        expect(f.agentTest.releaseSnapshot).not.toHaveBeenCalled();expect(f.learning.failEvaluation).not.toHaveBeenCalled();
        expect(f.learning.cleanEvaluationNamespaces).toHaveBeenCalledTimes(1);
        await processor.process({data:f.job,attemptsMade:1,opts:{attempts:2}} as any);
        expect(f.learning.claimEvaluationWorker.mock.calls[0][5]).not.toBe(f.learning.claimEvaluationWorker.mock.calls[1][5]);
        expect(f.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
        expect(f.agentTest.releaseSnapshot).toHaveBeenCalledWith(f.snapshot);
    });
    it('releases a captured corpus when dependency capture fails before any durable worker request exists',async()=>{
        const f=build();f.learning.dependencyHash.mockRejectedValueOnce(new Error('dependencies_unavailable'));
        await expect(f.service.enqueue(tenantId,agentId,releaseId)).rejects.toThrow('dependencies_unavailable');
        expect(f.agentTest.releaseSnapshot).toHaveBeenCalledWith(f.snapshot);
        expect(f.learning.beginEvaluation).not.toHaveBeenCalled();expect(f.queue.add).not.toHaveBeenCalled();
        expect(f.learning.failEvaluation).not.toHaveBeenCalled();
    });
    it('releases an unclaimed queued corpus only when its terminal failure CAS succeeds',async()=>{
        const f=build();f.queue.add.mockRejectedValueOnce(new Error('queue_unavailable'));
        await expect(f.service.enqueue(tenantId,agentId,releaseId)).rejects.toThrow('queue_unavailable');
        expect(f.learning.failEvaluation).toHaveBeenCalledWith(tenantId,agentId,releaseId,expect.any(String),'queue_unavailable');
        expect(f.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
        expect(f.agentTest.releaseSnapshot.mock.invocationCallOrder[0]).toBeGreaterThan(f.learning.failEvaluation.mock.invocationCallOrder[0]);
    });
    it('does not release a running worker corpus when queue.add loses its ACK and terminal CAS loses to the worker',async()=>{
        const f=build(),entered=deferred(),finish=deferred();let worker:Promise<any>|undefined;
        f.learning.failEvaluation.mockResolvedValue(false);
        f.learning.recordEvaluation.mockImplementation(async(_t,_a,_r,evidence)=>{
            entered.resolve();await finish.promise;return evidence;
        });
        f.queue.add.mockImplementation(async(_name,job)=>{
            f.run.attemptId=job.attemptId;
            worker=f.service.run(job,'88888888-8888-4888-8888-888888888888');await entered.promise;throw new Error('queue_ack_lost');
        });
        try{
            await expect(f.service.enqueue(tenantId,agentId,releaseId)).rejects.toThrow('queue_ack_lost');
            expect(f.learning.claimEvaluationWorker).toHaveBeenCalled();
            expect(f.agentTest.releaseSnapshot).not.toHaveBeenCalled();
        }finally{finish.resolve();if(worker)await worker;}
        expect(f.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
    });
    it('retains the queued corpus if the failure CAS itself loses its acknowledgement',async()=>{
        const f=build();f.queue.add.mockRejectedValueOnce(new Error('queue_ack_lost'));
        f.learning.failEvaluation.mockRejectedValueOnce(new Error('failure_cas_ack_lost'));
        await expect(f.service.enqueue(tenantId,agentId,releaseId)).rejects.toThrow('failure_cas_ack_lost');
        expect(f.agentTest.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('refuses to publish judge evidence when dependencies drift during the comparison call',async()=>{
        const f=build();
        f.llm.execute.mockImplementation(async()=>{
            f.agentTest.assertSnapshotExecutable.mockRejectedValue(new Error('evaluation_dependencies_changed:tenant.policies'));
            return {content:JSON.stringify({A:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,4])),criticalFailures:[]},
                B:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,3])),criticalFailures:[]}})};
        });
        await expect(f.service.run(f.job)).rejects.toThrow('evaluation_dependencies_changed');
        expect(f.learning.recordEvaluation).not.toHaveBeenCalled();
    });
    it('replays every customer turn with tools enabled, independent sessions and the same frozen agent',async()=>{
        const {service,learning,agentTest,session,snapshot,job,llm}=build();
        const evidence=await service.run(job);
        expect(agentTest.test).toHaveBeenCalledTimes(12);
        expect(session.reset).toHaveBeenCalledTimes(6);
        expect(learning.registerEvaluationNamespace).toHaveBeenCalledTimes(6);
        expect(learning.registerEvaluationNamespace.mock.invocationCallOrder[0]).toBeLessThan(session.recordInbound.mock.invocationCallOrder[0]);
        expect(learning.cleanEvaluationNamespaces).toHaveBeenCalledWith(tenantId,agentId,releaseId,job.attemptId,
            agentTest.test.mock.calls.filter((_call,index)=>index%2===0).map(call=>call[3].sandboxNamespace.schemaName));
        expect(learning.cleanEvaluationNamespaces.mock.invocationCallOrder[0]).toBeLessThan(learning.recordEvaluation.mock.invocationCallOrder[0]);
        expect(session.reset).toHaveBeenCalledWith('web_widget', snapshot);
        const calls=agentTest.test.mock.calls;
        expect(new Set(calls.map(call=>call[3].sandboxNamespace.schemaName)).size).toBe(6);
        expect(calls.map(call=>call[3].learningReleaseId)).toEqual([null,null,releaseId,releaseId,null,null,releaseId,releaseId,null,null,releaseId,releaseId]);
        for(const call of calls){
            expect(call[3]).toMatchObject({agentSnapshot:snapshot,evalMode:true,disableTools:false});
            expect(call[3].learningEvaluationSource).toEqual({releaseId,attemptId:job.attemptId,workerToken:expect.any(String),releaseHash:'release-hash',
                baselineReleaseId:null,baselineReleaseHash:null,namespace:call[3].sandboxNamespace});
            expect(JSON.stringify(call[2].conversationHistory)).not.toContain('histórica');
        }
        expect(new Set(calls.map(call=>call[3].sandboxConversationId)).size).toBe(6);
        expect(evidence.results).toHaveLength(3);
        expect(evidence.results.every((r:any)=>r.candidateCompleted&&r.baselineCompleted&&r.traceHash)).toBe(true);
        expect(llm.execute.mock.calls[0][0]).toMatchObject({executionContext:{persistence:'disabled'}});
        expect(llm.execute.mock.calls.every(([request])=>typeof request.withSourceAuthority==='function')).toBe(true);
    });
    it('keeps a failed provider comparison in the denominator and cannot manufacture a passing score',async()=>{
        const {service,learning,llm,job}=build();llm.execute.mockRejectedValueOnce(new Error('provider down'));
        const evidence=await service.run(job);
        expect(evidence.results).toHaveLength(3);
        expect(evidence.results[0]).toMatchObject({candidateScore:0,baselineScore:0,criticalFailures:['comparison_unavailable']});
        expect(learning.checkpointEvaluation).toHaveBeenCalledTimes(3);
    });
    it('keeps incomplete runtime cases and does not judge invented fallback answers',async()=>{
        const {service,agentTest,llm,job}=build();agentTest.test.mockRejectedValueOnce(new Error('runtime down'));
        const evidence=await service.run(job);
        expect(evidence.results).toHaveLength(3);
        expect(evidence.results[0].baselineCompleted).toBe(false);
        expect(evidence.results[0].criticalFailures).toContain('baseline:runtime down');
        expect(llm.execute).toHaveBeenCalledTimes(2);
    });
    it('stops before replay if the knowledge dependency set changed',async()=>{
        const {service,learning,agentTest,job}=build();learning.dependencyHash.mockResolvedValue('changed');
        await expect(service.run(job)).rejects.toThrow('learning_dependencies_changed');
        expect(agentTest.test).not.toHaveBeenCalled();expect(learning.recordEvaluation).not.toHaveBeenCalled();
    });
    it('copies no source text when namespace registration fails and cleans the worker-owned names',async()=>{
        const f=build();f.learning.registerEvaluationNamespace.mockRejectedValue(new Error('source retired'));
        const result=await f.service.run(f.job);
        expect(f.session.recordInbound).not.toHaveBeenCalled();expect(f.agentTest.test).not.toHaveBeenCalled();
        expect(result.results.every((r:any)=>!r.baselineCompleted&&!r.candidateCompleted)).toBe(true);
        expect(f.learning.cleanEvaluationNamespaces.mock.calls[0][4]).toHaveLength(6);
    });
    it('cleans owned namespaces when saving a checkpoint fails and does not finalize',async()=>{
        const f=build();f.learning.checkpointEvaluation.mockRejectedValue(new Error('source changed'));
        await expect(f.service.run(f.job)).rejects.toThrow('source changed');
        expect(f.learning.cleanEvaluationNamespaces.mock.calls[0][4]).toHaveLength(2);
        expect(f.learning.recordEvaluation).not.toHaveBeenCalled();
    });
    it('does not finalize a comparison when owned-copy cleanup fails',async()=>{
        const f=build();f.learning.cleanEvaluationNamespaces.mockRejectedValue(new Error('eval_namespace_owner_mismatch'));
        await expect(f.service.run(f.job)).rejects.toThrow('eval_namespace_owner_mismatch');
        expect(f.learning.recordEvaluation).not.toHaveBeenCalled();
    });
    it('fences every judge invocation and records no favorable scores when source authority is revoked',async()=>{
        const f=build(),provider=jest.fn();
        f.learning.runtimeSourceAuthority.mockImplementation(()=>async()=>{throw new Error('source revoked');});
        f.llm.execute.mockImplementation(async(request:any)=>request.withSourceAuthority(provider));
        const evidence=await f.service.run(f.job);
        expect(provider).not.toHaveBeenCalled();
        expect(evidence.results.every((r:any)=>r.candidateScore===0&&r.baselineScore===0&&r.criticalFailures.includes('comparison_unavailable'))).toBe(true);
        expect(f.learning.runtimeSourceAuthority).toHaveBeenCalledTimes(3);
    });
    it('resumes frozen checkpoints without replaying or dropping completed sources',async()=>{
        const {service,learning,agentTest,run,job}=build();
        run.results=[{sourceId:sourceIds[0],candidateCompleted:true,baselineCompleted:true,candidateScore:90,baselineScore:80,criticalFailures:[],traceHash:'existing'}] as any;
        const evidence=await service.run(job);
        expect(agentTest.test).toHaveBeenCalledTimes(8);expect(evidence.results).toHaveLength(3);
        expect(evidence.results[0].traceHash).toBe('existing');
    });
    it('reloads checkpoints only after acquiring the sandbox and claiming the current worker',async()=>{
        const f=build();
        const checkpoint={sourceId:sourceIds[0],candidateCompleted:true,baselineCompleted:true,candidateScore:90,baselineScore:80,criticalFailures:[],traceHash:'fresh'};
        f.learning.claimEvaluationWorker.mockResolvedValue({...f.run,results:[checkpoint]} as any);
        const evidence=await f.service.run(f.job);
        expect(f.learning.claimEvaluationWorker.mock.invocationCallOrder[0]).toBeGreaterThan(f.session.assertLease.mock.invocationCallOrder[0]);
        expect(evidence.results[0].traceHash).toBe('fresh');expect(f.agentTest.test).toHaveBeenCalledTimes(8);
        const token=f.learning.claimEvaluationWorker.mock.calls[0][5];
        expect(f.learning.claimEvaluationWorker.mock.calls[0][6]).toBeNull();
        expect(f.learning.checkpointEvaluation.mock.calls.every(call=>call[6]===token)).toBe(true);
        expect(f.learning.recordEvaluation.mock.calls[0][4]).toBe(token);
    });
    it('does not replace the durable worker if acquiring the sandbox lease fails',async()=>{
        const f=build();f.session.assertLease.mockRejectedValue(new Error('eval_sandbox_lease_lost'));
        await expect(f.service.run(f.job)).rejects.toThrow('eval_sandbox_lease_lost');
        expect(f.learning.claimEvaluationWorker).not.toHaveBeenCalled();expect(f.agentTest.test).not.toHaveBeenCalled();
    });
    it('stores only IDs in the queue and reports an enqueue failure durably',async()=>{
        const {service,queue,learning}=build();await service.enqueue(tenantId,agentId,releaseId);
        expect(Object.keys(queue.add.mock.calls[0][1]).sort()).toEqual(['agentId','attemptId','releaseId','tenantId']);
        queue.add.mockRejectedValueOnce(new Error('redis down'));
        await expect(service.enqueue(tenantId,agentId,releaseId)).rejects.toThrow('redis down');
        expect(learning.failEvaluation).toHaveBeenCalledWith(tenantId,agentId,releaseId,expect.any(String),'queue_unavailable');
    });
    it('does not count a successful tool payload as an operation without an exact ledger and owned object',async()=>{
        const {service,agentTest,job}=build();
        agentTest.test.mockResolvedValue({reply:'Tu reserva está confirmada',debug:{agentRevision:{configHash:'frozen'},
            toolCalls:[{name:'create_appointment',result:{success:true,appointmentId:'claimed'}}],ragHits:[],model:'test-model'}} as any);
        const evidence=await service.run(job);
        expect(evidence.results.every((r:any)=>r.criticalFailures.some((f:string)=>f.includes('operation_evidence_unverified')))).toBe(true);
    });
    it('accepts exact command evidence and unchanged replay evidence in the full A/B comparison',async()=>{
        const f=build(),orderId='77777777-7777-4777-8777-777777777777',ledgerId='88888888-8888-4888-8888-888888888888';
        const written=new Set<string>();
        const result={success:true,order:{id:orderId,status:'pending',currency:'COP',totalAmountCents:'2000',version:1}};
        f.prisma.executeInTenantSchema.mockImplementation(async(schema:string,sql:string,params:any[]=[])=>{
            if(sql.includes('to_regclass'))return [{relation:/\.(orders|tool_execution_ledger)$/.test(params[0])?'present':null}];
            if(sql.includes('COUNT(*)'))return [{count:1,hash:'unchanged-table-diagnostic'}];
            if(sql.includes('FROM tool_execution_ledger'))return written.has(schema)
                ?[{id:ledgerId,tool_name:'place_catalog_order',args_hash:'a'.repeat(64),response_payload:result}]:[];
            return [{hash:'owned-order-digest',data:{id:orderId,status:'pending',currency:'COP',total_amount:'20.00',version:1}}];
        });
        f.agentTest.test.mockImplementation(async(_t,_a,_request,options)=>{
            const replay=written.has(options.sandboxNamespace.schemaName);written.add(options.sandboxNamespace.schemaName);
            return {reply:'El pedido sigue pendiente.',debug:{agentRevision:{configHash:'frozen'},toolCalls:[{name:'place_catalog_order',result:{...result,...(replay?{idempotentReplay:true}:{})}}],ragHits:[],model:'test-model'}} as any;
        });
        const evidence=await f.service.run(f.job);
        for(const comparison of evidence.results){
            expect(comparison.criticalFailures).toEqual([]);
            const traces=comparison.traces as {baseline:{turns:any[]};treatment:{turns:any[]}};
            for(const replay of [traces.baseline,traces.treatment]){
                expect(replay.turns.map((turn:any)=>turn.operations[0].effect)).toEqual(['committed','replayed']);
                expect(replay.turns[1].database.before).toEqual(replay.turns[1].database.after);
            }
        }
    });
});
