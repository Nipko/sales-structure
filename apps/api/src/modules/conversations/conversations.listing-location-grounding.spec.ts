import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='57542cc7-de10-4166-b731-704bc7fa403d', NAME='Spark QA Inmueble 20261018T2220Z';
function fixture(allowed=['search_listings','get_listing_details']) {
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:6,config_json:{language:'es',industry:'inmobiliaria',rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='search_listings')return {listings:[{id:ID,name:NAME,status:'available'}]};
  if(name==='get_listing_details')return {id:ID,name:NAME,address:'Calle Sintetica QA 123',city:'Spark QA Ciudad',neighborhood:null};throw Error('unexpected '+name);
 });
 return {f,turn:(message:string)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined})};
}
describe('current named listing location before model prose',()=>{
 it.each([
  ['LOCATION_A_ES',`Que direccion y ciudad figuran en la ficha de ${NAME}? Solo los datos publicados, sin fotos ni agenda.`],
  ['LOCATION_A_EN',`What is the address and city of property ${NAME}? Information only.`],
  ['LOCATION_A_PT',`Qual o endereco e a cidade do imovel ${NAME}? Somente informacao.`],
  ['LOCATION_B_FR',`Quelle adresse et quelle ville pour le logement ${NAME}?`],
  ['LOCATION_B_ES',`Que barrio publica la ficha del inmueble ${NAME}? No inventes el barrio.`],
  ['LOCATION_B_FR',`Quel quartier est enregistre pour le logement ${NAME}?`],
 ])('%s reads location for %s',async(_label,message)=>{
  const h=fixture();const r=await h.turn(message);expect(r.debug.runtimeError).toBeUndefined();
  const calls=h.f.toolExecutor.execute.mock.calls;expect(calls.map((c:any[])=>c[3])).toEqual(['search_listings','get_listing_details']);
  expect(calls[0][4]).toEqual({});expect(calls[1][4]).toEqual({listingId:ID});expect(calls[1][6].executionContext.persistence).toBe('disabled');
  expect(calls[1][6].authority.allowedTools).toContain('get_listing_details');
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;
  expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('"address":"Calle Sintetica QA 123"')&&m.content.includes('"city":"Spark QA Ciudad"')&&m.content.includes('"neighborhood":null'))).toBe(true);
 });
 it('keeps unavailable readers disabled',async()=>{const h=fixture([]);await h.turn(`Que direccion figura para el inmueble ${NAME}?`);expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not route a salon address to property readers',async()=>{const h=fixture();await h.turn('Que direccion y ciudad registra el servicio Corte y estilo?');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
});
