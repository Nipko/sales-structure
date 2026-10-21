import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='a04493f8-5b74-4f94-921e-9d73d1b189d7',NAME='Spark QA Habitacion 20261018T113247Z';
const MESSAGE=`De ${NAME}, ¿qué horarios de entrada y salida figuran en la ficha? Consulta sin hacer cambios.`;
function fixture(allowed=['list_properties','get_property_details']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'turismo',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='list_properties')return {properties:[{id:ID,name:NAME}]};
  if(name==='get_property_details')return {id:ID,name:NAME,checkInTime:'15:00:00',checkOutTime:'11:00:00',amenities:[],houseRules:null};throw Error('unexpected tool '+name);
 });
 const turn=(message=MESSAGE)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined});return {f,turn};
}
describe('property detail questions receive current authorized facts',()=>{
 it('grounds actual hours question and forwards both times',async()=>{
  const h=fixture();const r=await h.turn();expect(r.debug.runtimeError).toBeUndefined();
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['list_properties','get_property_details']);
  expect(h.f.toolExecutor.execute.mock.calls[1][4]).toEqual({propertyId:ID});
  expect(h.f.toolExecutor.execute.mock.calls[1][6].executionContext.persistence).toBe('disabled');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('15:00:00')&&m.content.includes('11:00:00'))).toBe(true);
 });
 it.each(['comodidades publicadas','reglas de la casa publicadas'])('forwards unspecified facts: %s',async question=>{
  const h=fixture();await h.turn(`De ${NAME}, ¿qué ${question} figuran?`);
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['list_properties','get_property_details']);
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"amenities":[]')&&m.content.includes('"houseRules":null'))).toBe(true);
 });
 it('does not grant disabled detail capability',async()=>{const h=fixture(['list_properties']);await h.turn();expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not guess after failed catalogue',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({error:'READ_FAILED'});await h.turn();expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['list_properties']);});
 it('does not guess among duplicate names',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({properties:[{id:ID,name:NAME},{id:'b04493f8-5b74-4f94-921e-9d73d1b189d7',name:NAME}]});await h.turn();expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['list_properties']);});
 it('forwards ownership denial without claiming missing facts',async()=>{const h=fixture();h.f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>name==='list_properties'?{properties:[{id:ID,name:NAME}]}:{error:'OWNERSHIP_DENIED'});await h.turn();const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('OWNERSHIP_DENIED'))).toBe(true);});
});
