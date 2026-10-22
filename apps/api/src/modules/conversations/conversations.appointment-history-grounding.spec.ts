import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='f0080b9a-c062-47c3-8318-b592a82da9a3';
function fixture(allowed=['list_services','check_availability','create_appointment','get_appointment_details']){
 const f=agentTurnFixture();const namespace={schemaName:'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa',sourceSchema:'tenant_test',tenantId:'tenant',token:'11111111-1111-4111-8111-111111111111',expiresAt:new Date(Date.now()+60000).toISOString(),tables:[]};(f.service as any).namespaces={assertOwned:jest.fn()};f.prisma.tenant.findUnique.mockResolvedValue({industry:'moda_belleza',settings:{verticalConfig:{subtype:'salon_belleza'}}});
 f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'moda_belleza',tools:{appointments:{enabled:true,canBook:true}},rag:{enabled:false},llm:{}}});
 f.verticalTurnContext.resolve.mockResolvedValue({industry:'moda_belleza',subType:'salon_belleza'});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='get_appointment_details')return {appointment:{id:ID,status:'completed',price:null,paymentStatus:'pending'}};
  if(name==='list_services')return {services:[]};throw Error('unexpected tool '+name);
 });
 const turn=(message=`Consulte la cita ${ID} de mi ficha: servicio, fecha, hora, estado y si su precio historico esta confirmado o sigue por confirmar. Use lo guardado para esa cita; no la cambie.`)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{evalMode:true,sandboxContactId:'00000000-0000-4000-8000-00000000eba1',sandboxConversationId:'11111111-1111-4111-8111-111111111111',sandboxNamespace:namespace,sandboxInboundMessageId:'22222222-2222-4222-8222-222222222222'});
 return {f,turn};
}
describe('existing historical appointment uses a canonical owned read',()=>{
 it('reads the supplied record even when the model chooses no tool',async()=>{
  const h=fixture();const r=await h.turn();expect(r.debug.runtimeError).toBeUndefined();
  const reads=h.f.toolExecutor.execute.mock.calls.filter((c:any[])=>c[3]==='get_appointment_details');expect(reads).toHaveLength(1);expect(reads[0][4]).toEqual({appointmentId:ID});expect(reads[0][6].executionContext.persistence).toBe('disabled');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"status":"completed"')&&m.content.includes('"price":null'))).toBe(true);
  expect(h.f.toolExecutor.execute.mock.calls.some((c:any[])=>c[3]==='create_appointment')).toBe(false);
 });
 it('never adds permission for an unavailable detail reader',async()=>{const h=fixture([]);await h.turn();expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it.each(['identity_verification_required','You can only view your own appointments'])('preserves refusal %s without manufacturing details',async error=>{
  const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({error});await h.turn();
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes(error))).toBe(true);
 });
});
