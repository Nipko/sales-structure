import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
function fixture(allowed=['list_my_tour_bookings']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'turismo',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockResolvedValue({bookings:[]});
 return {f,turn:(message:string)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('explicit own tour booking reads use the authorized contact reader',()=>{
 it.each(['Consulta mis reservas de tours actuales.','Show my tour bookings.','Consulte minhas reservas de passeios.','Affiche mes reservations de circuits.'])('reads the current contact without model identity: %s',async message=>{
  const h=fixture();const r=await h.turn(message);expect(r.debug.runtimeError).toBeUndefined();
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['list_my_tour_bookings']);
  const args=h.f.toolExecutor.execute.mock.calls[0];expect(args[4]).toEqual({});expect(args[6].executionContext.persistence).toBe('disabled');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"bookings":[]'))).toBe(true);
 });
 it('keeps the reader disabled if not published',async()=>{const h=fixture([]);await h.turn('Consulta mis reservas de tours.');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it.each(['Cancela mis reservas de tours.','Muestra las reservas de tours de mi esposa.','Show my tour bookings and create a new booking.'])('does not reinterpret mixed writes or foreign identity: %s',async message=>{const h=fixture();await h.turn(message);expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('forwards identity denial without manufacturing an empty list',async()=>{
  const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({error:'IDENTITY_REQUIRED'});await h.turn('Consulta mis reservas de tours.');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('IDENTITY_REQUIRED'))).toBe(true);
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"bookings":[]'))).toBe(false);
 });
});
