import { AIToolExecutorService } from './ai-tool-executor.service';
import { getToolPolicyForContext } from './tool-policy-registry';
const TENANT_A='11111111-1111-4111-8111-111111111111',TENANT_B='22222222-2222-4222-8222-222222222222';
const READ_ONLY={mode:'live',persistence:'disabled'}as const,LIVE={mode:'live',persistence:'enabled'}as const;
function row(id='synthetic-faq'){return{id,question:'Synthetic question',answer:'Synthetic QA only; do not sell.',category:'synthetic',privateField:'not public'};}
function fixture(rows:any[]=[row()]){
 const search=jest.fn().mockResolvedValue(rows),increment=jest.fn().mockResolvedValue(undefined);
 const executor:any=Object.assign(Object.create(AIToolExecutorService.prototype),{faqsService:{search,incrementViews:increment}});
 return{search,increment,read:(tenant:string,context:any,automatic=false,capture?:any)=>executor.searchFaqs(tenant,'synthetic question',3,context,capture,automatic)};
}
describe('FAQQA05 conditional FAQ metrics',()=>{
 it('explicit persistence-disabled read does not increment views',async()=>{const h=fixture();const r=await h.read(TENANT_A,READ_ONLY);expect(r.faqs).toEqual([{id:'synthetic-faq',question:'Synthetic question',answer:'Synthetic QA only; do not sell.',category:'synthetic'}]);expect(h.increment).not.toHaveBeenCalled();expect(h.search).toHaveBeenCalledWith(TENANT_A,'synthetic question',3,READ_ONLY,undefined);});
 it('automatic context skips the whole oversized answer rather than cutting its restriction',async()=>{const h=fixture([{...row('oversized'),answer:'x'.repeat(3000)+'Do not sell.'},row('short')]);const r=await h.read(TENANT_A,READ_ONLY,true);expect(r.faqs.map((f:any)=>f.id)).toEqual(['short']);expect(r.faqs[0].answer).toBe('Synthetic QA only; do not sell.');expect(h.increment).not.toHaveBeenCalled();});
 it('ordinary live search counts each returned FAQ under the current tenant',async()=>{const h=fixture([row('one'),row('two')]);await h.read(TENANT_A,LIVE);expect(h.increment.mock.calls).toEqual([[TENANT_A,'one'],[TENANT_A,'two']]);expect(getToolPolicyForContext('search_faqs',{industry:'moda_belleza',subtype:'salon_belleza'})?.effect).toBe('conditional_write');});
});
describe('FAQQA10 empty/error/captured-source boundaries',()=>{
 it('an empty successful search counts no views',async()=>{const h=fixture([]);expect(await h.read(TENANT_B,LIVE)).toEqual({faqs:[]});expect(h.increment).not.toHaveBeenCalled();});
 it('a failed search propagates without manufacturing empty FAQ evidence or incrementing views',async()=>{const h=fixture();h.search.mockRejectedValue(Error('synthetic read failure'));await expect(h.read(TENANT_B,LIVE)).rejects.toThrow('synthetic read failure');expect(h.increment).not.toHaveBeenCalled();});
 it('forwards the caller capture and execution context without crossing the tenant boundary',async()=>{const h=fixture();const capture={synthetic:true};await h.read(TENANT_B,READ_ONLY,true,capture);expect(h.search).toHaveBeenCalledTimes(1);expect(h.search).toHaveBeenCalledWith(TENANT_B,'synthetic question',3,READ_ONLY,capture);expect(h.increment).not.toHaveBeenCalled();});
});
