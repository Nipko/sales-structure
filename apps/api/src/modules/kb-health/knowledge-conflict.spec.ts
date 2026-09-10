import { BadRequestException, ConflictException } from '@nestjs/common';
import { KnowledgeConflictService } from './knowledge-conflict.service';
import { candidateConflictPairs, conflictSourceHash, conflictScopesOverlap, parseConflictVerdict, type ConflictSource } from './knowledge-conflict.contracts';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const CASE='33333333-3333-4333-8333-333333333333',ACTOR='44444444-4444-4444-8444-444444444444';
const scope={audience:'customer' as const,agentId:null,jurisdiction:'CO'};
function harness(options:{failRead?:boolean;failJudge?:boolean;judge?:string}={}) {
    const row=(id:string,content:string)=>({id,title:'Horarios de consultas',content_text:content,status:'ready',version:2,updated_at:'2026-01-01T00:00:00Z',audience:'customer',agent_ids:[]});
    const a=row(A,'Las consultas están disponibles todos los lunes a las nueve.'), b=row(B,'Las consultas están disponibles todos los lunes a las diez.');
    const rows=new Map([[A,a],[B,b]]), cases:any[]=[], decisions:any[]=[], scans:any[]=[];
    const query=jest.fn(async(sql:string,p:any[]=[])=>{
        if(sql.startsWith('CREATE'))return[];
        if(sql.includes('COUNT(*) OVER()')){if(options.failRead)throw new Error('read failed');return sql.includes('knowledge_documents')?[...rows.values()].map(row=>({row,total:2})):[];}
        if(sql.startsWith('SELECT to_jsonb'))return rows.has(p[0])?[{row:rows.get(p[0])}]:[];
        if(sql.startsWith('INSERT INTO knowledge_conflict_cases')){if(cases.some(c=>c.pair_key===p[0]))return[];cases.push({id:CASE,pair_key:p[0],source_a:JSON.parse(p[1]),source_b:JSON.parse(p[2]),quote_a:p[3],quote_b:p[4],detail:p[5],suggestion:p[6],status:'open',revision:1});return[{id:CASE}];}
        if(sql.startsWith('INSERT INTO knowledge_conflict_scans')){scans.push(JSON.parse(p[1]));return[];}
        if(sql.includes('SELECT report FROM'))return scans.length?[{report:scans.at(-1)}]:[];
        if(sql.startsWith('SELECT c.*') || sql.startsWith('SELECT c.id,c.source_a,c.source_b'))return cases.map(c=>({...c,...decisions.at(-1),revision:c.revision}));
        if(sql.startsWith('SELECT * FROM knowledge_conflict_cases'))return cases;
        if(sql.startsWith('INSERT INTO knowledge_conflict_decisions')){decisions.push({decision:p[2],reason:p[3],actor_id:p[4],scope:JSON.parse(p[7]),revision:p[1]});return[];}
        if(sql.startsWith('UPDATE knowledge_conflict_cases')){cases[0].revision++;cases[0].status=p[1];return[];}
        throw new Error(`Unexpected query ${sql}`);
    });
    const prisma={getTenantSchemaName:jest.fn().mockResolvedValue('tenant_test'),executeInTenantSchema:jest.fn((_schema,sql,p)=>query(sql,p)),transactionInTenantSchema:jest.fn((_schema,fn)=>fn(query))};
    const llm={execute:jest.fn(async()=>{if(options.failJudge)throw new Error('provider unavailable');return{content:options.judge??JSON.stringify({contradicts:true,quoteA:a.content_text,quoteB:b.content_text,detail:'Posibles horarios incompatibles.',suggestion:'Verificar horario vigente.'})};})};
    const events={emit:jest.fn()};const service=new KnowledgeConflictService(prisma as any,llm as any,events as any);
    return{service,prisma,query,llm,events,rows,cases,decisions,scans};
}

describe('source conflict observations retain evidence and uncertainty',()=>{
    it('rejects non-boolean verdicts and invented quotes instead of recording a fabricated conflict',async()=>{
        for(const judge of [JSON.stringify({contradicts:'false'}),JSON.stringify({contradicts:true,quoteA:'an invented quote',quoteB:'another invented quote',detail:'conflict'})]){
            const h=harness({judge});const report=await h.service.scan(A);
            expect(report).toMatchObject({status:'partial',checkedPairs:0,unknownPairs:1,newIssues:0,correctness:'not_verified'});
            expect(h.cases).toHaveLength(0);
        }
    });
    it('distinguishes unavailable sources, failed judge and no conflict observed',async()=>{
        expect(await harness({failRead:true}).service.scan(A)).toMatchObject({status:'unavailable',sourceCounts:{document:null,faq:null,policy:null,business:null}});
        expect(await harness({failJudge:true}).service.scan(A)).toMatchObject({status:'partial',checkedPairs:0,unknownPairs:1});
        expect(await harness({judge:'{"contradicts":false}'}).service.scan(A)).toMatchObject({status:'completed_sample',checkedPairs:1,unknownPairs:0,newIssues:0,exhaustive:false,correctness:'not_verified'});
    });
    it('deduplicates a pair by immutable source hashes and invalidates an issue after source edit',async()=>{
        const h=harness();await h.service.scan(A);await h.service.scan(A);
        expect(h.cases).toHaveLength(1);expect(h.scans[1].newIssues).toBe(0);
        h.rows.get(A)!.content_text='Las consultas cambiaron de horario.';
        const overview=await h.service.overview(A);expect(overview.cases[0].status).toBe('stale');
        const annotation=await h.service.annotations('tenant_test',[A],scope,AGENT_TEST_EXECUTION_CONTEXT);expect(annotation.annotations).toEqual({});
    });
    it('does not present changed sources observed during the judge call as current evidence',async()=>{
        const h=harness();const run=h.llm.execute.getMockImplementation()!;
        h.llm.execute.mockImplementation(async()=>{const result=await run();h.rows.get(A)!.version++;return result;});
        const report=await h.service.scan(A);expect(report).toMatchObject({checkedPairs:0,unknownPairs:1,newIssues:0});
        expect(report.errors).toContain('source_changed_during_scan');
    });
    it('annotates only sources visible in the exact audience/agent/jurisdiction, never repairing preview schema',async()=>{
        const h=harness();await h.service.scan(A);h.query.mockClear();
        const visible=await h.service.annotations('tenant_test',[A],scope,AGENT_TEST_EXECUTION_CONTEXT);
        expect(visible.annotations[A][0]).toMatchObject({state:'potential_conflict',quote:expect.any(String),correctness:'not_verified'});
        expect(h.query.mock.calls.some(([sql])=>sql.startsWith('CREATE'))).toBe(false);
        const hidden=await h.service.annotations('tenant_test',[A],{...scope,audience:'internal'},AGENT_TEST_EXECUTION_CONTEXT);expect(hidden.annotations).toEqual({});
    });
});

describe('human conflict review is actor-attributed, scoped and conditional on source revision',()=>{
    const review=(h:ReturnType<typeof harness>)=>({revision:h.cases[0].revision,decision:'prefer_a' as const,reason:'Verificado con responsable del negocio.',sourceAHash:h.cases[0].source_a.hash,sourceBHash:h.cases[0].source_b.hash,scope});
    it('records the review actor and reason, locks sources before case, and does not edit content',async()=>{
        const h=harness();await h.service.scan(A);h.query.mockClear();await h.service.review(A,CASE,ACTOR,review(h));
        expect(h.decisions[0]).toMatchObject({actor_id:ACTOR,reason:'Verificado con responsable del negocio.',scope});
        expect(h.query.mock.calls.findIndex(([sql])=>sql.includes('FOR SHARE'))).toBeLessThan(h.query.mock.calls.findIndex(([sql])=>sql.includes('FOR UPDATE')));
        expect(h.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE knowledge_documents'))).toBe(false);
        const current=await h.service.annotations('tenant_test',[A],scope,AGENT_TEST_EXECUTION_CONTEXT);expect(current.annotations[A][0].state).toBe('reviewed_preference');
    });
    it('rejects stale review revision, changed source hash and invisible scope',async()=>{
        const h=harness();await h.service.scan(A);const input=review(h);
        await expect(h.service.review(A,CASE,ACTOR,{...input,revision:8})).rejects.toBeInstanceOf(ConflictException);
        await expect(h.service.review(A,CASE,ACTOR,{...input,sourceAHash:'stale'})).rejects.toBeInstanceOf(ConflictException);
        await expect(h.service.review(A,CASE,ACTOR,{...input,scope:{...scope,audience:'internal'}})).rejects.toBeInstanceOf(BadRequestException);
        expect(h.decisions).toHaveLength(0);
    });
    it('does not transfer preference to another jurisdiction or a later source edit',async()=>{
        const h=harness();await h.service.scan(A);await h.service.review(A,CASE,ACTOR,review(h));
        const other=await h.service.annotations('tenant_test',[A],{...scope,jurisdiction:'MX'},AGENT_TEST_EXECUTION_CONTEXT);
        expect(other.annotations[A][0].state).toBe('potential_conflict');
        h.rows.get(B)!.version++;
        expect((await h.service.annotations('tenant_test',[A],scope,AGENT_TEST_EXECUTION_CONTEXT)).annotations).toEqual({});
    });
});

describe('conflict candidate sampling is scoped and does not claim truth',()=>{
    const source=(patch:Partial<ConflictSource>={}):ConflictSource=>({kind:'document',id:A,title:'Consultas los lunes',revision:'2',hash:'hash',text:'Las consultas del servicio están disponibles los lunes.',active:true,authority:null,jurisdiction:null,regulated:false,validFrom:null,validTo:null,audience:'customer',agentIds:[],...patch});
    it('does not compare disjoint agent scopes or non-overlapping validity',()=>{
        expect(conflictScopesOverlap(source({agentIds:[A]}),source({id:B,agentIds:[B]}))).toBe(false);
        expect(conflictScopesOverlap(source({validTo:'2026-01-01'}),source({id:B,validFrom:'2026-02-01'}))).toBe(false);
        expect(candidateConflictPairs([source(),source({id:B,audience:'internal'})],12)).toEqual([]);
    });
    it('changes its hash when authority or scope changes even if content stays the same',()=>{
        const a=source();const {hash,...body}=a;
        expect(conflictSourceHash(body)).not.toBe(conflictSourceHash({...body,audience:'internal'}));
        expect(conflictSourceHash(body)).not.toBe(conflictSourceHash({...body,authority:'Owner'}));
        expect(parseConflictVerdict('{"contradicts":false}',a,a)).toEqual({state:'no_conflict_observed'});
    });
});
