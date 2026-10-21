import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='76775f40-2fdd-48e2-9db5-c6afa93573dc',NAME='Spark QA Tour 20261018T2140Z';
function fixture(discount=0,allowed=['search_packages','get_package_details']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'turismo',tools:{tours:{enabled:true}},rag:{enabled:false},llm:{}}});
 f.verticalTurnContext.resolve.mockResolvedValue({industry:'turismo',subType:'agencia_viajes'});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='search_packages')return {packages:[{id:ID,name:NAME,price:125,currency:'EUR'}]};
  if(name==='get_package_details')return {id:ID,name:NAME,childDiscountPct:discount};throw Error('unexpected tool '+name);
 });
 const turn=(message=`Del paquete ${NAME}, ¿qué porcentaje de descuento infantil figura publicado? No haga una reserva.`)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined});return {f,turn};
}
describe('published child discount is read from the current named package',()=>{
 it.each([0,15])('supplies the current %s percent even when model calls no tool',async discount=>{
  const h=fixture(discount);const r=await h.turn();expect(r.debug.runtimeError).toBeUndefined();
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_packages','get_package_details']);
  expect(h.f.toolExecutor.execute.mock.calls[1][4]).toEqual({packageId:ID});
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes(`"childDiscountPct":${discount}`))).toBe(true);
 });
 it('does not grant a disabled detail reader',async()=>{const h=fixture(15,['search_packages']);await h.turn();expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_packages']);});
 it('does not guess a package after an empty catalogue',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({packages:[]});await h.turn();expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_packages']);});
 it('does not use the package reader for an unrelated product discount',async()=>{const h=fixture();await h.turn('¿Qué descuento tiene esta camiseta?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
});
