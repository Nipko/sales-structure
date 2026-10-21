import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='11111111-1111-4111-8111-111111111111',NAME='Synthetic QA Dish';
function fixture(allowed=['get_menu']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:5,config_json:{language:'es',industry:'restaurantes',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockResolvedValue({count:1,items:[{id:ID,name:NAME,description:'Synthetic QA only; do not sell.',price:13500,currency:'COP',category:null}]});
 return{f,turn:(q:string)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:q,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('named dish description uses the current published menu',()=>{
 it.each(['¿Qué dice la descripción del plato Synthetic QA Dish?','¿Tiene descripción el plato Synthetic QA Dish y está destinado a venta real?','What is the description of the dish Synthetic QA Dish?','Describe the menu item Synthetic QA Dish.','Qual a descrição do prato Synthetic QA Dish?','Quelle est la description du plat Synthetic QA Dish?'])('reads current public facts: %s',async q=>{
  const h=fixture();const r=await h.turn(q);expect(r.debug.runtimeError).toBeUndefined();const calls=h.f.toolExecutor.execute.mock.calls;
  expect(calls.map((c:any[])=>c[3])).toEqual(['get_menu']);expect(calls[0][4]).toEqual({});expect(calls[0][6].executionContext.persistence).toBe('disabled');expect(calls[0][6].channelType).toBe('telegram');expect(calls[0][6].authority).toBeDefined();
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('Synthetic QA only; do not sell.'))).toBe(true);
 });
 it('does not run an unpublished menu reader',async()=>{const h=fixture([]);await h.turn('Descripción del plato Synthetic QA Dish');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not use the restaurant reader for a service description',async()=>{const h=fixture();await h.turn('Descripción del servicio Corte y estilo');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('passes an explicit read denial instead of fabricating an empty menu',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({error:'permission_denied'});await h.turn('Descripción del plato Synthetic QA Dish');expect(h.f.toolExecutor.execute).toHaveBeenCalledTimes(1);const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('permission_denied'))).toBe(true);});
 it('propagates a strict-session read exception before model prose',async()=>{const h=fixture();h.f.toolExecutor.execute.mockRejectedValue(Error('synthetic failure'));await expect(h.turn('Descripción del plato Synthetic QA Dish')).rejects.toThrow('synthetic failure');expect(h.f.llmRouter.execute).not.toHaveBeenCalled();});
});
