import { KnowledgeService } from './knowledge.service';
import { attributeKnowledgeResponse, knowledgeDocumentReadiness } from './knowledge-attribution';
import { knowledgeHitToContext } from './knowledge-contracts';
import type { RetrievedKnowledgeItem } from '@parallext/shared';

const tenantId='11111111-1111-4111-8111-111111111111';
const conversationId='22222222-2222-4222-8222-222222222222';
const documentId='33333333-3333-4333-8333-333333333333';
const retrievalId='44444444-4444-4444-8444-444444444444';
const chunkId='55555555-5555-4555-8555-555555555555';
const otherId='66666666-6666-4666-8666-666666666666';
const item:RetrievedKnowledgeItem={source:'kb_article',id:chunkId,documentId,retrievalId,title:'Devoluciones',
    content:'Las devoluciones se reciben durante treinta días siempre que el producto conserve su empaque original.',score:0.99};

function fixture(){
    const state={erased:false,fail:false,rows:[] as any[]};
    const query=jest.fn(async(sql:string,params:any[]=[])=>{
        if(state.fail)throw new Error('metrics database unavailable');
        if(sql.includes('SELECT c.id FROM conversations'))return state.erased?[]:[{id:conversationId}];
        if(sql.includes('INSERT INTO kb_retrieval_log'))state.rows.push(...JSON.parse(params[0]).map((row:any)=>({...row,was_used:false,conversation_id:params[2]})));
        if(sql.includes('UPDATE kb_retrieval_log')){
            const changed:any[]=[];
            for(const evidence of JSON.parse(params[0])){
                const row=state.rows.find(r=>r.id===evidence.retrievalId&&r.document_id===evidence.documentId&&r.conversation_id===params[1]&&!r.assessed);
                if(row){Object.assign(row,{assessed:true,was_used:evidence.signal!=='unobserved'});changed.push({id:row.id});}
            }
            return changed;
        }
        if(sql.includes('SELECT id FROM knowledge_documents'))return [{id:documentId}];
        return [];
    });
    const prisma={executeInTenantSchema:jest.fn((_schema:string,sql:string,params?:any[])=>query(sql,params)),
        transactionInTenantSchema:jest.fn(async(_schema:string,callback:(q:typeof query)=>Promise<any>)=>callback(query))};
    const service=new KnowledgeService(prisma as any,{} as any,{} as any,{} as any,{} as any,{} as any);
    jest.spyOn(service as any,'tenantSchema').mockResolvedValue('tenant_quality');
    jest.spyOn(service as any,'ensureKbFeedbackTable').mockResolvedValue(undefined);
    const track=(score:number|null=0.9)=>(service as any).trackRetrieval('tenant_quality',tenantId,'¿Cómo devuelvo?',score==null?[]:
        [{document_id:documentId,id:chunkId,retrievalId,score,title:item.title,doc_version:3}],0.35,conversationId);
    return {state,query,prisma,service,track};
}

describe('Observable attribution without semantic overclaim',()=>{
    it('high relevance does not prove observable use',()=>{
        expect(attributeKnowledgeResponse('Puedo ayudarte con una consulta.',[item])).toMatchObject({presentedDocuments:1,observedDocuments:0,semanticSupport:'not_evaluated'});
    });
    it.each(['Article','Artículo','Artigo'])('attributes exact %s titles at document level',label=>{
        const report=attributeKnowledgeResponse(`Revisa las condiciones. [${label}: Devoluciones]`,[item,{...item,id:otherId,retrievalId:otherId}]);
        expect(report).toMatchObject({citedDocuments:1,observedDocuments:1,semanticSupport:'not_evaluated'});
        expect(report.evidence.map(e=>e.granularity)).toEqual(['document','document']);
    });
    it('ambiguous titles do not credit either of two documents',()=>{
        expect(attributeKnowledgeResponse('[Article: Devoluciones]',[item,{...item,documentId:otherId,retrievalId:otherId}]))
            .toMatchObject({ambiguousCitations:1,citedDocuments:0,observedDocuments:0});
    });
    it('unknown citations do not credit the nearest title',()=>{
        expect(attributeKnowledgeResponse('[Article: Devoluciones especiales]',[item])).toMatchObject({unknownCitations:1,observedDocuments:0});
    });
    it('literal overlap is not entailment even when the reply negates the source',()=>{
        const report=attributeKnowledgeResponse(`Es falso afirmar: ${item.content}`,[item]);
        expect(report).toMatchObject({literalOverlapDocuments:1,semanticSupport:'not_evaluated'});
        expect(report.evidence[0]).toMatchObject({signal:'literal_overlap',granularity:'chunk'});
        expect(report.evidence[0].evidenceHash).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(report)).not.toContain(item.content);
    });
    it('short generic phrases are not sufficient literal evidence',()=>{
        expect(attributeKnowledgeResponse('Gracias por comunicarte, podemos ayudarte.',[{...item,content:'Gracias por comunicarte, podemos ayudarte.'}]).observedDocuments).toBe(0);
    });
    it('deduplicates a retrieval in multiple context lists',()=>{
        expect(attributeKnowledgeResponse('[Article: Devoluciones]',[item,item]).evidence).toHaveLength(1);
    });
    it('preserves version, provenance and validity in every context projection',()=>{
        expect(knowledgeHitToContext({id:chunkId,document_id:documentId,chunk_text:'policy',retrievalId,retrievalBatchId:otherId,
            doc_version:3,doc_authority:'Owner',doc_jurisdiction:'CO',doc_valid_from:new Date('2026-01-01'),doc_valid_to:'2026-12-31',
            doc_source_url:'https://example.org/policy'} as any)).toMatchObject({retrievalId,documentId,version:3,
                authority:'Owner',jurisdiction:'CO',validFrom:'2026-01-01',validTo:'2026-12-31',sourceUrl:'https://example.org/policy'});
    });
});

describe('Retrieval and final response persistence',()=>{
    it('stores a conversation gap sentinel without claiming use',async()=>{
        const f=fixture();await f.track(null);
        expect(f.state.rows).toEqual([expect.objectContaining({document_id:null,relevance_passed:false,was_used:false,conversation_id:conversationId})]);
        expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO kb_unanswered_queries'))).toBe(true);
    });
    it('relevance and final-response evidence are independent',async()=>{
        const f=fixture();await f.track();
        expect(f.state.rows).toEqual([expect.objectContaining({relevance_passed:true,was_used:false,source_version:3})]);
        expect((await f.service.recordResponseAttribution(tenantId,conversationId,'[Article: Devoluciones]',[item])).persistence).toBe('recorded');
        expect(f.state.rows[0].was_used).toBe(true);
        const sql=f.query.mock.calls.find(([sql])=>sql.includes('UPDATE kb_retrieval_log'))![0];
        for(const scope of ['l.document_id=e."documentId"','l.conversation_id=$2::uuid','l.attribution_version=1','l.attributed_at IS NULL'])expect(sql).toContain(scope);
    });
    it('weak candidates and gap sentinel share one search, both with use false',async()=>{
        const f=fixture();await f.track(0.3);
        expect(f.state.rows).toHaveLength(2);
        expect(f.state.rows.every(row=>!row.was_used&&!row.relevance_passed)).toBe(true);
        expect(f.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO kb_retrieval_log'))).toHaveLength(1);
    });
    it('does not overwrite another conversation or claim missing logs were updated',async()=>{
        const f=fixture();await f.track();
        expect((await f.service.recordResponseAttribution(tenantId,otherId,'[Article: Devoluciones]',[item])).persistence).toBe('incomplete');
        expect(f.state.rows[0].was_used).toBe(false);
    });
    it('preview computes the same signals without any schema/read/write operations',async()=>{
        const f=fixture();
        expect(await f.service.recordResponseAttribution(tenantId,conversationId,'[Article: Devoluciones]',[item],
            {mode:'agent_test',persistence:'disabled',operationalUsageAccounting:'enabled'})).toMatchObject({persistence:'disabled',observedDocuments:1});
        expect(f.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(f.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect((f.service as any).tenantSchema).not.toHaveBeenCalled();
    });
    it('erasure blocks late retrieval, attribution and feedback under the shared privacy lock',async()=>{
        const f=fixture();f.state.erased=true;await f.track();
        expect(f.state.rows).toEqual([]);
        expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO kb_unanswered_queries'))).toBe(false);
        expect((await f.service.recordResponseAttribution(tenantId,conversationId,'[Article: Devoluciones]',[item])).persistence).toBe('contact_erased');
        await expect(f.service.submitFeedback(tenantId,{conversationId,rating:1,comment:'private'})).rejects.toThrow('knowledge_feedback_conversation_unavailable');
        expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO kb_feedback'))).toBe(false);
        expect(f.query.mock.calls.some(([sql,p])=>sql.includes('pg_advisory_xact_lock_shared')&&p?.[0]==='agent-privacy:tenant_quality')).toBe(true);
    });
    it('telemetry failure is explicit and cannot break a valid generated reply',async()=>{
        const f=fixture();f.state.fail=true;
        await expect(f.track()).resolves.toBeUndefined();
        expect((await f.service.recordResponseAttribution(tenantId,conversationId,'[Article: Devoluciones]',[item])).persistence).toBe('unavailable');
    });
});

describe('Diagnostics do not inflate correctness',()=>{
    const now=new Date('2026-09-07T12:00:00Z');
    const ready={status:'ready',chunk_count:1,retrieval_count:10000,content_length:999999,avg_score:1};
    it('long, popular, relevant documents remain factually unverified',()=>{
        expect(knowledgeDocumentReadiness(ready,now)).toEqual({readiness:'ready',reasons:[],correctnessStatus:'unverified'});
    });
    it('failed reindex warns while the previous ready version remains available',()=>{
        expect(knowledgeDocumentReadiness({...ready,error_message:'timeout'},now)).toMatchObject({readiness:'review_required',reasons:['reindex_failed_previous_version_active']});
    });
    it.each([{status:'error'},{chunk_count:0},{valid_to:'2026-09-06'},{valid_from:'2026-09-08'}])('popularity cannot compensate for unavailability %j',change=>{
        expect(knowledgeDocumentReadiness({...ready,...change},now).readiness).toBe('unavailable');
    });
    it('corrections and negative feedback trigger review without declaring a source false',()=>{
        expect(knowledgeDocumentReadiness({...ready,false_positive_count:2,feedback_count:4,satisfaction_score:2},now))
            .toMatchObject({readiness:'review_required',reasons:['retrieval_corrections','negative_feedback'],correctnessStatus:'unverified'});
    });
    it.each([0,6,1.5,NaN])('invalid rating %s never enters averages',async rating=>{
        const f=fixture();await expect(f.service.submitFeedback(tenantId,{rating})).rejects.toThrow('invalid_knowledge_feedback');
        expect(f.query).not.toHaveBeenCalled();
    });
    it('feedback never refreshes the source publication date',async()=>{
        const f=fixture();await f.service.submitFeedback(tenantId,{documentId,rating:1,comment:'Review this answer.'});
        const sql=f.query.mock.calls.find(([sql])=>sql.includes('UPDATE knowledge_documents'))![0];
        expect(sql).toContain('satisfaction_score');expect(sql).not.toContain('updated_at');expect(sql).not.toContain('version=');
    });
    it('rejects message feedback assigned to another conversation',async()=>{
        const f=fixture();await expect(f.service.submitFeedback(tenantId,{conversationId,messageId:otherId,rating:1})).rejects.toThrow('knowledge_feedback_message_mismatch');
        expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO kb_feedback'))).toBe(false);
    });
    it('uses search denominators and excludes legacy heuristic usage',async()=>{
        const f=fixture();f.prisma.executeInTenantSchema.mockImplementation(async(_schema:string,sql:string)=>{
            if(sql.includes('WITH searches AS'))return [{total:1,total_retrievals:4,hits:3,candidate_searches:3,assessed_searches:2,observed_searches:1,legacy_rows:20}];
            if(sql.includes('AS avg,'))return [{avg:'0.800',median:'0.850'}];return [];
        });
        expect((await f.service.getAnalytics(tenantId)).overview).toMatchObject({uniqueQueries:1,totalRetrievals:4,hitRate:0.75,
            observedRate:0.5,attributionCoverage:2/3,legacyRows:20,avgScore:0.8});
        const calls=f.prisma.executeInTenantSchema.mock.calls.map(call=>call[1]);
        expect(calls.find(sql=>sql.includes('WITH searches AS'))).toContain('attribution_version=1');
        expect(calls.find(sql=>sql.includes('AS document_id'))).toContain('COUNT(DISTINCT krl.response_id)');
        expect(calls.find(sql=>sql.includes('TO_CHAR(created_at'))).toContain('AS date');
    });
    it('shows unknown rather than zero correctness when no measured searches exist',async()=>{
        expect((await fixture().service.getAnalytics(tenantId)).overview).toMatchObject({hitRate:null,observedRate:null,attributionCoverage:null,avgScore:null});
    });
});
