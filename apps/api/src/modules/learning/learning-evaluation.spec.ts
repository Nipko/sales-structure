import { LearningEvaluationService } from './learning-evaluation.service';
import { LEARNING_DIMENSIONS } from './learning-contracts';

const tenantId='11111111-1111-4111-8111-111111111111',agentId='22222222-2222-4222-8222-222222222222';
const releaseId='33333333-3333-4333-8333-333333333333';
const sourceIds=['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'];
function build(){
    const snapshot={tenantId,agentId,configHash:'frozen',version:3,config:{language:'es'},capturedAt:'2026-09-06T00:00:00Z'};
    const run={attemptId:'attempt',agentSnapshot:snapshot,dependencyHash:'stable',results:[]};
    const learning={createEvaluationSnapshot:jest.fn().mockResolvedValue({releaseId,releaseHash:'release-hash',baselineReleaseId:null,
        cases:sourceIds.map(sourceId=>({sourceId,language:'es',channel:'web_widget',messages:[
            {role:'customer',text:'Necesito ayuda'},{role:'assistant',text:'Respuesta histórica NUNCA esperada'},
            {role:'customer',text:'Tengo una duda adicional'},{role:'assistant',text:'Otra respuesta histórica'}]}))}),
        dependencyHash:jest.fn().mockResolvedValue('stable'),beginEvaluation:jest.fn(),evaluationRun:jest.fn().mockResolvedValue(run),
        checkpointEvaluation:jest.fn(),recordEvaluation:jest.fn(async(_t,_a,_r,evidence)=>evidence),failEvaluation:jest.fn()};
    let sessionIndex=0;
    const session={sandboxContactId:'00000000-0000-4000-8000-00000000eba1',sandboxConversationId:'',assertLease:jest.fn(),
        sandboxNamespace:undefined as any,
        reset:jest.fn(async()=>{session.sandboxConversationId=`sandbox-${++sessionIndex}`;
            session.sandboxNamespace={schemaName:`isolated-${sessionIndex}`,token:`lease-${sessionIndex}`};}),recordInbound:jest.fn()};
    const sandbox={withSandboxSession:jest.fn(async(_tenant,callback)=>callback(session))};
    const agentTest={assertSnapshotCurrent:jest.fn().mockResolvedValue(undefined),captureSnapshot:jest.fn().mockResolvedValue(snapshot),test:jest.fn(async(_t,_a,req,opts)=>{
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
    it('refuses to publish judge evidence when dependencies drift during the comparison call',async()=>{
        const f=build();
        f.llm.execute.mockImplementation(async()=>{
            f.agentTest.assertSnapshotCurrent.mockRejectedValue(new Error('evaluation_dependencies_changed:tenant.policies'));
            return {content:JSON.stringify({A:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,4])),criticalFailures:[]},
                B:{scores:Object.fromEntries(LEARNING_DIMENSIONS.map(d=>[d,3])),criticalFailures:[]}})};
        });
        await expect(f.service.run(f.job)).rejects.toThrow('evaluation_dependencies_changed');
        expect(f.learning.recordEvaluation).not.toHaveBeenCalled();
    });
    it('replays every customer turn with tools enabled, independent sessions and the same frozen agent',async()=>{
        const {service,agentTest,session,snapshot,job,llm}=build();
        const evidence=await service.run(job);
        expect(agentTest.test).toHaveBeenCalledTimes(12);
        expect(session.reset).toHaveBeenCalledTimes(6);
        expect(session.reset).toHaveBeenCalledWith('web_widget', snapshot);
        const calls=agentTest.test.mock.calls;
        expect(new Set(calls.map(call=>call[3].sandboxNamespace.schemaName)).size).toBe(6);
        expect(calls.map(call=>call[3].learningReleaseId)).toEqual([null,null,releaseId,releaseId,null,null,releaseId,releaseId,null,null,releaseId,releaseId]);
        for(const call of calls){
            expect(call[3]).toMatchObject({agentSnapshot:snapshot,evalMode:true,disableTools:false});
            expect(JSON.stringify(call[2].conversationHistory)).not.toContain('histórica');
        }
        expect(new Set(calls.map(call=>call[3].sandboxConversationId)).size).toBe(6);
        expect(evidence.results).toHaveLength(3);
        expect(evidence.results.every((r:any)=>r.candidateCompleted&&r.baselineCompleted&&r.traceHash)).toBe(true);
        expect(llm.execute.mock.calls[0][0]).toMatchObject({executionContext:{persistence:'disabled'}});
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
    it('resumes frozen checkpoints without replaying or dropping completed sources',async()=>{
        const {service,learning,agentTest,run,job}=build();
        run.results=[{sourceId:sourceIds[0],candidateCompleted:true,baselineCompleted:true,candidateScore:90,baselineScore:80,criticalFailures:[],traceHash:'existing'}] as any;
        const evidence=await service.run(job);
        expect(agentTest.test).toHaveBeenCalledTimes(8);expect(evidence.results).toHaveLength(3);
        expect(evidence.results[0].traceHash).toBe('existing');
    });
    it('stores only IDs in the queue and reports an enqueue failure durably',async()=>{
        const {service,queue,learning}=build();await service.enqueue(tenantId,agentId,releaseId);
        expect(Object.keys(queue.add.mock.calls[0][1]).sort()).toEqual(['agentId','attemptId','releaseId','tenantId']);
        queue.add.mockRejectedValueOnce(new Error('redis down'));
        await expect(service.enqueue(tenantId,agentId,releaseId)).rejects.toThrow('redis down');
        expect(learning.failEvaluation).toHaveBeenCalledWith(tenantId,agentId,releaseId,expect.any(String),'queue_unavailable');
    });
    it('does not count a successful tool payload as an operation without a database change',async()=>{
        const {service,agentTest,job}=build();
        agentTest.test.mockResolvedValue({reply:'Tu reserva está confirmada',debug:{agentRevision:{configHash:'frozen'},
            toolCalls:[{name:'create_appointment',result:{success:true,appointmentId:'claimed'}}],ragHits:[],model:'test-model'}} as any);
        const evidence=await service.run(job);
        expect(evidence.results.every((r:any)=>r.criticalFailures.some((f:string)=>f.includes('operation_without_database_change')))).toBe(true);
    });
});
