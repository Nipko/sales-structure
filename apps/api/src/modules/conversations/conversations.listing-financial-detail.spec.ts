import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='57542cc7-de10-4166-b731-704bc7fa403d', NAME='Spark QA Inmueble 20261018T2220Z';
function fixture(allowed=['search_listings','get_listing_details']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'inmobiliaria',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='search_listings')return {listings:[{id:ID,name:NAME,status:'available'}]};
  if(name==='get_listing_details')return {id:ID,name:NAME,financingAvailable:false,deposit:null,hoaFee:null,yearBuilt:null,stratum:null};throw Error('unexpected '+name);
 });
 return {f,turn:(q:string)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:q+` Del inmueble ${NAME}. Solo consulta.`,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('financial and building facts use current listing detail',()=>{
 it.each(['¿La ficha ofrece financiamiento?','¿Qué deposito y cuota de administracion figuran?','¿Qué año de construccion y estrato figuran?'])('reads current facts for %s',async q=>{
  const h=fixture();const r=await h.turn(q);expect(r.debug.runtimeError).toBeUndefined();
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_listings','get_listing_details']);
  expect(h.f.toolExecutor.execute.mock.calls[1][4]).toEqual({listingId:ID});
  expect(h.f.toolExecutor.execute.mock.calls[1][6].executionContext.persistence).toBe('disabled');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"financingAvailable":false')&&m.content.includes('"deposit":null'))).toBe(true);
 });
 it('does not grant disabled listing readers',async()=>{const h=fixture([]);await h.turn('¿Hay financiamiento?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not invent identity after a failed search',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({error:'READ_FAILED'});await h.turn('¿Hay financiamiento?');expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_listings']);});
 it('forwards detail denial without inventing financing terms',async()=>{const h=fixture();h.f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>name==='search_listings'?{listings:[{id:ID,name:NAME,status:'available'}]}:{error:'OWNERSHIP_DENIED'});await h.turn('¿Hay financiamiento?');const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('OWNERSHIP_DENIED'))).toBe(true);});
});
