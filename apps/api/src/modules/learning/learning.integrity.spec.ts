import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { LearningService } from './learning.service';
import { LEARNING_DIMENSIONS, learningHash, learningSnapshotHash, learningSplit, sanitizeLearningText, segmentLearningConversation,
    learningTextSimilarity, type LearningEvaluationEvidence } from './learning-contracts';

const tenant='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222';
const releaseId='33333333-3333-4333-8333-333333333333',exampleId='44444444-4444-4444-8444-444444444444';
const sourceIds=['55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777'];
const scores=()=>Object.fromEntries(LEARNING_DIMENSIONS.map(key=>[key,4]));
function build(){
    const query=jest.fn(async(_sql:string,_params:any[]=[])=>_sql.includes('SELECT * FROM learning_releases')?[release()]:[{id:exampleId}] as any[]);
    const prisma={getTenantSchemaName:jest.fn().mockResolvedValue('tenant_learning'),
        executeInTenantSchema:jest.fn((_schema:string,sql:string,params:any[])=>query(sql,params)),
        transactionInTenantSchema:jest.fn((_schema:string,callback:any)=>callback(query))};
    const knowledge={generateEmbedding:jest.fn().mockResolvedValue([.1,.2])};
    const llm={execute:jest.fn().mockResolvedValue({content:JSON.stringify({kind:'brand_style',scores:scores(),exclusions:[],
        responsePattern:'Te ayudo. ¿Qué necesitas resolver?',rationale:'Clear question',factsRequired:[]})})};
    const service=new LearningService(prisma as any,knowledge as any,llm as any);
    jest.spyOn(service,'ensureTables').mockResolvedValue(undefined);
    return {service,query,prisma,knowledge,llm};
}
function release(){const row={id:releaseId,status:'candidate',snapshot_hash:'',baseline_release_id:null,example_ids:[exampleId],
    evaluation_status:'running',evaluation:{attemptId:'attempt',dependencyHash:'dependencies',agentSnapshot:{configHash:'agent'}},
    snapshot:{examples:[{id:exampleId,source_id:sourceIds[0],kind:'brand_style',language:'es',intent:'support',
        response_pattern:'Te ayudo. ¿Qué necesitas resolver?',rationale:'Question',facts_required:[]}],
        heldout:sourceIds.map(source_id=>({source_id}))}};row.snapshot_hash=learningSnapshotHash(row.snapshot);return row;}
function evidence():LearningEvaluationEvidence{return {attemptId:'attempt',releaseHash:release().snapshot_hash,baselineReleaseId:null,
    agentRevision:'agent',dependencyHash:'dependencies',results:sourceIds.map(sourceId=>({sourceId,candidateCompleted:true,
        baselineCompleted:true,candidateScore:90,baselineScore:80,criticalFailures:[],traceHash:'trace'}))};}

describe('Curated learning contracts',()=>{
    it('canonicalizes JSONB key order while detecting content edits',()=>{
        expect(learningSnapshotHash({z:1,a:{y:2,x:3}})).toBe(learningSnapshotHash({a:{x:3,y:2},z:1}));
        expect(learningSnapshotHash({a:1})).not.toBe(learningSnapshotHash({a:2}));
    });
    it('splits by stable source group before segmentation',()=>{
        const group=learningHash(`${tenant}:contact:same-customer`);
        const messages=Array.from({length:6},()=>[{role:'customer' as const,text:'Quiero una cita'},{role:'assistant' as const,text:'¿Qué horario prefieres?'}]).flat();
        const segments=segmentLearningConversation(messages);
        expect(segments.length).toBeGreaterThan(1);
        expect(new Set(segments.map(()=>learningSplit(group))).size).toBe(1);
    });
    it('redacts known identity, email, links, dates and phone before deduplication',()=>{
        const clean=sanitizeLearningText('Soy Ana. ana@example.test +57 3101234567, 2026-09-06 https://test.invalid/a',['Ana']);
        expect(clean).not.toMatch(/Ana|example|310123|2026|https/i);
        expect(clean).toContain('[person]');
    });
    it('detects near copies even when numbers and names were substituted',()=>{
        expect(learningTextSimilarity('Hola [person], tu reserva para [date] está lista.','Hola [customer], tu reserva para [value] está lista.')).toBe(1);
    });
});

describe('Learning publication safety',()=>{
    it('cannot omit a failed heldout source to improve the denominator',async()=>{
        const {service}=build();jest.spyOn(service as any,'loadRelease').mockResolvedValue(release());
        jest.spyOn(service as any,'assertReleaseSourcesAvailable').mockResolvedValue(undefined);
        const input=evidence();input.results.pop();
        await expect(service.recordEvaluation(tenant,agent,releaseId,input)).rejects.toThrow();
    });
    it.each(['critical','incomplete','regression','no_improvement'])('blocks publication for %s despite attractive average tone',async reason=>{
        const {service}=build();jest.spyOn(service as any,'loadRelease').mockResolvedValue(release());
        jest.spyOn(service as any,'assertReleaseSourcesAvailable').mockResolvedValue(undefined);
        const input=evidence();
        if(reason==='critical')input.results[0].criticalFailures=['unsupported_operation_claim'];
        if(reason==='incomplete')input.results[0].candidateCompleted=false;
        if(reason==='regression')input.results[0].candidateScore=74;
        if(reason==='no_improvement')input.results.forEach(r=>r.candidateScore=80);
        expect((await service.recordEvaluation(tenant,agent,releaseId,input)).passed).toBe(false);
    });
    it('publishes evidence only after every heldout run completed and improved without critical failures',async()=>{
        const {service}=build();jest.spyOn(service as any,'loadRelease').mockResolvedValue(release());
        jest.spyOn(service as any,'assertReleaseSourcesAvailable').mockResolvedValue(undefined);
        expect((await service.recordEvaluation(tenant,agent,releaseId,evidence())).passed).toBe(true);
    });
    it('rejects stale worker evidence and a withdrawal racing the final write',async()=>{
        const {service,query}=build();jest.spyOn(service as any,'loadRelease').mockResolvedValue(release());
        jest.spyOn(service as any,'assertReleaseSourcesAvailable').mockResolvedValue(undefined);
        await expect(service.recordEvaluation(tenant,agent,releaseId,{...evidence(),attemptId:'old'})).rejects.toThrow();
        query.mockImplementation(async sql=>sql.includes('SELECT * FROM learning_releases')?[{...release(),status:'retired'}]:[]);
        await expect(service.recordEvaluation(tenant,agent,releaseId,evidence())).rejects.toBeInstanceOf(ConflictException);
    });
    it('never treats the absence of a source row as a valid release',async()=>{
        const {service,query}=build();query.mockResolvedValue([]);
        await expect((service as any).assertReleaseSourcesAvailable('tenant_learning',release())).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('will not approve heldout material even with explicit operator checks',async()=>{
        const {service,query}=build();query.mockImplementation(async sql=>sql.includes('FOR UPDATE')?[{split:'holdout',source_status:'active',status:'analyzed',revision:1}]:[]);
        await expect(service.review(tenant,agent,exampleId,{decision:'approved',revision:1,note:'Reviewed carefully',privacyChecked:true,correctnessChecked:true},'reviewer')).rejects.toThrow();
    });
    it('does not use polished imported claims as tool execution proof',async()=>{
        const {service,query}=build();jest.spyOn(service as any,'example').mockResolvedValue({id:exampleId,status:'pending',revision:1,split:'train',language:'es',
            episode:[{role:'customer',text:'Quiero reservar'},{role:'assistant',text:'Tu reserva está confirmada'}]});
        jest.spyOn(service as any,'assertSourcesAvailable').mockResolvedValue(undefined);
        query.mockImplementation(async sql=>sql.includes("UPDATE learning_examples")?[{id:exampleId}]:[]);
        const result=await service.analyze(tenant,agent,exampleId);
        expect(result.status).toBe('flagged');expect(result.analysis.exclusions).toContain('unverified_operation');
    });
});

describe('Learning runtime scope',()=>{
    it('does not expose heldout transcripts or frozen agent snapshots in the public review list',async()=>{
        const {service,query}=build();
        query.mockImplementation(async sql=>sql.includes('s.split,s.channel')?[{split:'train',id:exampleId},{split:'holdout',episode:'secret holdout'}]:
            sql.includes('baseline_release_id,traffic_percent')?[{id:releaseId,total_cases:3,evaluation:{agentSnapshot:{private:'config'},results:[
                {traces:'heldout',candidateCompleted:true,baselineCompleted:true},
                {traces:'heldout',candidateCompleted:false,baselineCompleted:true}],passed:true,candidateAverage:90}}]:[]);
        jest.spyOn(service as any,'assertAgent').mockResolvedValue(undefined);
        const result=await service.list(tenant,agent);
        expect(result.examples).toHaveLength(1);
        expect(JSON.stringify(result)).not.toMatch(/heldout|agentSnapshot|traces|private/);
        expect(result.releases[0].evaluation).toMatchObject({passed:true,candidateAverage:90,totalCases:3,completedCases:1,failedCases:1});
    });
    it('respects every earlier rollout percentage when falling through a release chain',async()=>{
        const {service,query}=build();const previous=sourceIds[1],stable=sourceIds[2];
        const releases:any={
            [releaseId]:{id:releaseId,status:'published',traffic_percent:10,baseline_release_id:previous},
            [previous]:{id:previous,status:'published',traffic_percent:10,baseline_release_id:stable},
            [stable]:{id:stable,status:'published',traffic_percent:100,baseline_release_id:null,snapshot_hash:'stable'},
        };
        query.mockResolvedValue([{id:releaseId}]);
        jest.spyOn(service as any,'loadRelease').mockImplementation(async(_schema:any,_agent:any,id:any)=>releases[id]);
        jest.spyOn(service as any,'assertReleaseSourcesAvailable').mockResolvedValue(undefined);
        let contactKey='';for(let i=0;i<100;i++){contactKey=String(i);if(parseInt(learningHash(`${agent}:${contactKey}`).slice(0,8),16)%100>=10)break;}
        expect(await service.getPublishedReleaseSnapshot(tenant,agent,contactKey)).toEqual({releaseId:stable,releaseHash:'stable'});
    });
    it('uses the publication lock for rollback as well',async()=>{
        const {service,query}=build();await service.rollback(tenant,agent,releaseId);
        expect(query.mock.calls[0]).toEqual([expect.stringContaining('pg_advisory_xact_lock'),[`learning-release:${tenant}:${agent}`]]);
    });
    it('keeps learning disabled explicitly without reading a published release',async()=>{
        const {service,prisma}=build();expect(await service.getRuntimeExamples(tenant,agent,{language:'es',releaseId:null})).toEqual([]);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
    it('rejects live candidate overrides',async()=>{
        const {service}=build();await expect(service.getRuntimeExamples(tenant,agent,{language:'es',releaseId})).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('uses approved style only in the scoped language and only supplies action wording after its exact tool succeeds',async()=>{
        const {service}=build();const candidate=release();candidate.snapshot.examples.push({...candidate.snapshot.examples[0],id:'action',kind:'operational_pattern',analysis:{requiredTool:'create_appointment'}} as any);
        candidate.snapshot.examples.push({...candidate.snapshot.examples[0],id:'fact',kind:'business_fact'});
        jest.spyOn(service as any,'loadRelease').mockResolvedValue(candidate);jest.spyOn(service as any,'assertReleaseSourcesAvailable').mockResolvedValue(undefined);
        const opts={language:'es',intent:'support',releaseId,executionContext:AGENT_TEST_EXECUTION_CONTEXT};
        expect((await service.getRuntimeExamples(tenant,agent,opts)).map(e=>e.id)).toEqual([exampleId]);
        expect((await service.getRuntimeExamples(tenant,agent,{...opts,operation:{toolName:'create_appointment',status:'succeeded'}})).map(e=>e.id)).toEqual([exampleId,'action']);
        expect(await service.getRuntimeExamples(tenant,agent,{...opts,language:'fr'})).toEqual([]);
    });
    it('withdrawal erases reviews and both training and heldout frozen derivatives',async()=>{
        const {service,query}=build();
        query.mockImplementation(async sql=>sql.includes('information_schema.columns')?[{column_name:'snapshot'},{column_name:'evaluation_namespaces'}]
            :sql.includes('WITH RECURSIVE')?[{id:releaseId,evaluation_namespaces:[]}]
            :sql.includes('current_schema() AS schema')?[{schema:'tenant_learning'}]:[{id:exampleId}]);
        await service.withdrawSource(tenant,agent,sourceIds[0]);
        const statements=query.mock.calls.map(([sql])=>sql);
        expect(statements.some(sql=>sql.includes('DELETE FROM learning_reviews'))).toBe(true);
        expect(statements.some(sql=>sql.includes("snapshot->'heldout'"))).toBe(true);
        expect(statements.some(sql=>sql.includes("snapshot='{}'::jsonb"))).toBe(true);
        expect(statements.some(sql=>sql.includes('embedding=NULL')&&sql.includes("episode='[]'::jsonb"))).toBe(true);
    });
});
