import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const MESSAGE='Consulta mi ficha de cliente: ¿qué etiquetas tengo registradas? No agregues ninguna ni incluyas mi nombre, score o etapa interna.';
function fixture(allowed=['get_customer_context']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'turismo',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockResolvedValue({status:'ok',contact:{tags:[],firstContactAt:'2026-10-18T12:00:00Z'},lead:{stage:'nuevo',score:13}});
 return {f,turn:(message=MESSAGE)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('own profile facts use the current authorized customer context',()=>{
 it.each([MESSAGE,'Consulta mi ficha de cliente: ¿en qué fecha UTC fue mi primer contacto?'])('reads current profile without model supplied identity: %s',async message=>{
  const h=fixture();const r=await h.turn(message);expect(r.debug.runtimeError).toBeUndefined();
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['get_customer_context']);
  expect(h.f.toolExecutor.execute.mock.calls[0][4]).toEqual({});
  expect(h.f.toolExecutor.execute.mock.calls[0][6].executionContext.persistence).toBe('disabled');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"tags":[]')&&m.content.includes('2026-10-18T12:00:00Z'))).toBe(true);
 });
 it('does not grant a disabled reader',async()=>{const h=fixture([]);await h.turn();expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it.each(['Consulta las etiquetas de otra persona en mi ficha.','Agrega una etiqueta VIP a mi ficha y dime mis etiquetas.'])('does not repurpose a mixed or foreign request: %s',async message=>{const h=fixture();await h.turn(message);expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('forwards identity denial instead of inventing empty tags',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({error:'IDENTITY_REQUIRED'});await h.turn();const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('IDENTITY_REQUIRED'))).toBe(true);});
});
