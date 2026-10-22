import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='189e44f7-b821-48e0-a203-1f45d0c2f679',NAME='Corte y estilo';
function fixture(address:string|null=null,allowed=['list_services']) {
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'peluqueria',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockResolvedValue({services:[{id:ID,name:NAME,appointmentTerms:{version:1,serviceId:ID,name:NAME,locationType:'in_person',locationAddress:address}}]});
 return {f,turn:(message:string)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('current public service modality before model prose',()=>{
 it.each([
  ['SERVICELOC_A_ES',`Que modalidad registra ${NAME}: presencial o en linea? Solo consulta la ficha, sin reservar.`,null],
  ['SERVICELOC_A_EN',`Is the service ${NAME} in person or online? Information only.`,null],
  ['SERVICELOC_A_PT',`Qual a modalidade do servico ${NAME}? Somente informacao.`,null],
  ['SERVICELOC_B_FR',`Quelle est la modalite de la prestation ${NAME}?`,null],
  ['SERVICELOC_B_NULL',`La ficha del servicio ${NAME} publica una direccion? Solo consulta.`,null],
  ['SERVICELOC_B_ADDRESS',`What address is published for the service ${NAME}?`,'Calle Sintetica Servicio 123'],
 ])('%s reads current terms for %s',async(_label,message,address)=>{
  const h=fixture(address);const r=await h.turn(message!);expect(r.debug.runtimeError).toBeUndefined();
  const calls=h.f.toolExecutor.execute.mock.calls;expect(calls.map((c:any[])=>c[3])).toEqual(['list_services']);
  expect(calls[0][4]).toEqual({});expect(calls[0][6].executionContext.persistence).toBe('disabled');expect(calls[0][6].channelType).toBe('telegram');expect(calls[0][6].authority.allowedTools).toContain('list_services');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"locationType":"in_person"')&&m.content.includes('"locationAddress":'+JSON.stringify(address)))).toBe(true);
 });
 it('does not grant an unpublished service reader',async()=>{const h=fixture(null,[]);await h.turn(`Modalidad del servicio ${NAME}?`);expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not route a property address to service readers',async()=>{const h=fixture();await h.turn('Que direccion y ciudad registra el inmueble Spark QA?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not route tour departure to service readers',async()=>{const h=fixture();await h.turn('Que direccion publica el paquete Tour QA?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not substitute current catalogue terms for my existing appointment',async()=>{const h=fixture();await h.turn('What location is registered for my appointment?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not substitute current terms for a referenced appointment',async()=>{const h=fixture();await h.turn('Modalidad de la cita f0080b9a-c062-47c3-8318-b592a82da9a3?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('passes read denial to the model instead of fabricating missing modality',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({error:'permission_denied'});await h.turn(`Modalidad del servicio ${NAME}?`);expect(h.f.toolExecutor.execute).toHaveBeenCalledTimes(1);expect(h.f.llmRouter.execute.mock.calls[0][0].messages.some((m:any)=>m.role==='tool'&&m.content.includes('permission_denied'))).toBe(true);});
 it('propagates a strict-session exception before model prose',async()=>{const h=fixture();h.f.toolExecutor.execute.mockRejectedValue(Error('synthetic service failure'));await expect(h.turn(`Modalidad del servicio ${NAME}?`)).rejects.toThrow('synthetic service failure');expect(h.f.llmRouter.execute).not.toHaveBeenCalled();});
});
