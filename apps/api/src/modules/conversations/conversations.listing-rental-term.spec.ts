import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='57542cc7-de10-4166-b731-704bc7fa403d', NAME='Spark QA Inmueble 20261018T2220Z';
function fixture(months:number|null,allowed=['search_listings','get_listing_details']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'inmobiliaria',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='search_listings')return {listings:[{id:ID,name:NAME,status:'available'}]};
  if(name==='get_listing_details')return {id:ID,name:NAME,transactionType:'sale',minRentalMonths:months};throw Error('unexpected '+name);
 });
 return {f,turn:(question:string)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:question+` ${NAME}`,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('minimum rental term comes from the current named listing',()=>{
 it.each([['¿La ficha del inmueble publica un mínimo de meses de arriendo? Solo consulta, sin cambiar su operación de venta.',null],['¿Mínimo de meses de arriendo del inmueble?',6],['What is the minimum rental term of this property?',12],['Qual o prazo mínimo de aluguel do imóvel?',null],['Quelle est la durée minimale de location du logement?',6],['Minimum months for the apartment?',null]] as const)('reads %s with current value %s',async(question,months)=>{
  const h=fixture(months);const r=await h.turn(question);expect(r.debug.runtimeError).toBeUndefined();
  const calls=h.f.toolExecutor.execute.mock.calls;expect(calls.map((c:any[])=>c[3])).toEqual(['search_listings','get_listing_details']);
  expect(calls[0][4]).toEqual({});expect(calls[1][4]).toEqual({listingId:ID});expect(calls[1][6].executionContext.persistence).toBe('disabled');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes(`"minRentalMonths":${months}`)&&m.content.includes('"transactionType":"sale"'))).toBe(true);
 });
 it('keeps unpublished readers disabled',async()=>{const h=fixture(null,[]);await h.turn('¿Mínimo de meses de arriendo del inmueble?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not resolve an ambiguous current listing name',async()=>{const h=fixture(6);h.f.toolExecutor.execute.mockResolvedValue({listings:[{id:ID,name:NAME,status:'available'},{id:'57542cc7-de10-4166-b731-704bc7fa403e',name:NAME,status:'available'}]});await h.turn('¿Mínimo de meses de arriendo del inmueble?');expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_listings']);});
 it('does not use the listing reader for a tour minimum',async()=>{const h=fixture(null);await h.turn('¿Mínimo de personas del tour?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
});
