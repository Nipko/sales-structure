import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='76775f40-2fdd-48e2-9db5-c6afa93573dc',NAME='Spark QA Tour 20261018T2140Z';
function fixture(allowed=['search_packages','get_package_details']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'turismo',tools:{tours:{enabled:true}},rag:{enabled:false},llm:{}}});
 f.verticalTurnContext.resolve.mockResolvedValue({industry:'turismo',subType:'agencia_viajes'});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='search_packages')return {packages:[{id:ID,name:NAME,price:125,currency:'EUR'}]};
  if(name==='get_package_details')return {id:ID,name:NAME,minPartySize:1,maxCapacity:10};throw Error('unexpected tool '+name);
 });
 return {f,turn:(message:string)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('published package party limits reach the model through the current reader',()=>{
 it.each([`¿Cuál es el mínimo de personas publicado para ${NAME}? Solo consulta, sin reservar.`,`¿Qué capacidad máxima por grupo figura en ${NAME}?`,`What is the minimum party size of package ${NAME}?`,`What is the maximum capacity of tour ${NAME}?`,`Qual a capacidade do pacote ${NAME}?`,`Quelle est la capacite du forfait ${NAME}?`])('reads current limits for %s',async message=>{
  const h=fixture();const r=await h.turn(message);expect(r.debug.runtimeError).toBeUndefined();
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_packages','get_package_details']);
  expect(h.f.toolExecutor.execute.mock.calls[1][4]).toEqual({packageId:ID});
  expect(h.f.toolExecutor.execute.mock.calls[1][6].executionContext.persistence).toBe('disabled');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"minPartySize":1')&&m.content.includes('"maxCapacity":10'))).toBe(true);
 });
 it('does not grant an unpublished detail reader',async()=>{const h=fixture(['search_packages']);await h.turn(`¿Capacidad del tour ${NAME}?`);expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_packages']);});
 it('does not guess details from an empty catalogue',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({packages:[]});await h.turn(`¿Capacidad del tour ${NAME}?`);expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_packages']);});
 it('leaves unrelated product capacity to its own domain',async()=>{const h=fixture();await h.turn('¿Capacidad máxima de esta batería?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
});
