import OpenAI from 'openai';
import { KnowledgeService } from './knowledge.service';
import { CustomerMemoryService } from '../conversations/customer-memory.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import type { ExternalSourceAuthority } from '../ai/interfaces/external-source-authority';

const tenant='11111111-1111-4111-8111-111111111111';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','retry-after-ms':'1'}});
// The installed SDK requests base64 and decodes Float32 data itself.
const vector=()=>json({object:'list',model:'text-embedding-3-small',data:[{object:'embedding',index:0,
    embedding:Buffer.from(new Float32Array([0.25,0.5]).buffer).toString('base64')}],usage:{prompt_tokens:9,total_tokens:9}});
function fixture(){
    const state={valid:true};let checks=0;
    const authority:ExternalSourceAuthority=async(invoke,usage)=>{
        checks++;if(!state.valid)throw new LLMSourceAuthorityUnavailable();
        const result=await invoke();
        if(!state.valid)throw new LLMSourceAuthorityUnavailable(usage?.(result));
        return result;
    };
    const fetch=jest.fn(async(_url:any,_init:any)=>vector());
    const client=new OpenAI({apiKey:'synthetic-test-key',fetch:fetch as any});
    const create=jest.spyOn(client.embeddings,'create');
    const redis={getJson:jest.fn(),setJson:jest.fn()};
    const prisma={executeInTenantSchema:jest.fn().mockResolvedValue([])};
    const llm={execute:jest.fn(async(request:any)=>request.withSourceAuthority?request.withSourceAuthority(async()=>({content:'[1,0]'})):{content:'[1,0]'})};
    const knowledge=new KnowledgeService(prisma as any,redis as any,{} as any,{} as any,{} as any,llm as any);
    jest.spyOn(knowledge as any,'ensureOpenAI').mockResolvedValue(client);
    jest.spyOn(knowledge as any,'tenantSchema').mockResolvedValue('tenant_source');
    return{knowledge,authority,state,fetch,create,redis,prisma,llm,checks:()=>checks};
}
describe('Knowledge external requests retain source authority',()=>{
    it('stops a real SDK request before transport when the source is already revoked',async()=>{
        const f=fixture();f.state.valid=false;
        await expect(f.knowledge.generateEmbedding('Historical input',tenant,AGENT_TEST_EXECUTION_CONTEXT,f.authority)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.fetch).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
    });
    it('disables SDK retries and rechecks authority before retrying a transient transport response',async()=>{
        const f=fixture();
        f.fetch.mockImplementationOnce(async()=>{f.state.valid=false;return json({error:{message:'Unavailable'}},503);});
        await expect(f.knowledge.generateEmbedding('Historical input',tenant,AGENT_TEST_EXECUTION_CONTEXT,f.authority)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.checks()).toBe(2);
        expect(f.create.mock.calls[0][1]).toEqual({maxRetries:0,timeout:45000});
    });
    it('retains recovery from transient errors when source authority remains valid',async()=>{
        const f=fixture();f.fetch.mockResolvedValueOnce(json({error:{message:'Temporary overload'}},503));
        expect(await f.knowledge.generateEmbedding('Historical input',tenant,AGENT_TEST_EXECUTION_CONTEXT,f.authority)).toEqual([0.25,0.5]);
        expect(f.fetch).toHaveBeenCalledTimes(2);expect(f.checks()).toBe(2);
        expect(JSON.stringify(f.fetch.mock.calls.map(call=>JSON.parse(call[1].body)))).not.toMatch(/authority|workerToken|releaseId/);
    });
    it('does not retry a permanent authentication error',async()=>{
        const f=fixture();f.fetch.mockResolvedValue(json({error:{message:'Unauthorized'}},401));
        await expect(f.knowledge.generateEmbedding('Historical input',tenant,AGENT_TEST_EXECUTION_CONTEXT,f.authority)).rejects.toMatchObject({status:401});
        expect(f.fetch).toHaveBeenCalledTimes(1);
    });
    it('discards late vectors with usage metadata and does not cache them',async()=>{
        const f=fixture();f.fetch.mockImplementationOnce(async()=>{f.state.valid=false;return vector();});
        await expect((f.knowledge as any).embedQueryCached('Historical input',tenant,AGENT_TEST_EXECUTION_CONTEXT,f.authority))
            .rejects.toMatchObject({message:'llm_source_authority_unavailable',usage:{promptTokens:9,completionTokens:0,totalTokens:9}});
        expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.redis.getJson).not.toHaveBeenCalled();expect(f.redis.setJson).not.toHaveBeenCalled();
    });
    it('treats revoked reranking as invalid evidence instead of successful unranked search',async()=>{
        const f=fixture();
        f.prisma.executeInTenantSchema.mockImplementation(async(_schema,sql)=>{
            if(!sql.includes('FROM knowledge_embeddings'))return [];
            f.state.valid=false;
            return [0,1].map(i=>({chunk_id:`chunk${i}`,document_id:`doc${i}`,title:'Rule',chunk_text:'Applicable content',chunk_index:i,
                metadata:{},distance:0.1,doc_language:'es',doc_is_regulated:false,doc_version:1}));
        });
        await expect(f.knowledge.searchRelevant(tenant,'Historical input',2,{executionContext:AGENT_TEST_EXECUTION_CONTEXT,rerank:true,withDataSourceAuthority:f.authority}))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.llm.execute).toHaveBeenCalledTimes(1);expect(f.fetch).toHaveBeenCalledTimes(1);
    });
    it('propagates a memory embedding revocation through both best-effort memory layers',async()=>{
        const f=fixture();f.state.valid=false;
        const memory=new CustomerMemoryService(f.prisma as any,f.llm as any,f.knowledge);
        await expect(memory.getMemory('tenant_source','contact','Historical input',tenant,AGENT_TEST_EXECUTION_CONTEXT,f.authority))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.fetch).not.toHaveBeenCalled();
        expect(f.prisma.executeInTenantSchema.mock.calls.some(call=>call[1].includes('FROM customer_memory_facts'))).toBe(false);
    });
});
