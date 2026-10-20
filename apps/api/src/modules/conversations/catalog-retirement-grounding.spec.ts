import { ConversationsService } from './conversations.service';

const ID='45029e77-0f68-4971-bc73-28cf8dec0963';
const OTHER='e6ef6f14-7125-4bcf-99f5-72bf10b7abc3';
const name='QA Agente Precio 20261020T1737Z';
const tool=(stock=3,extra:any={})=>({name:'get_product',result:{id:ID,name,stock,isAvailable:false,status:'ok',source:'tenant_db',asOf:new Date().toISOString(),...extra}});
function service(){
 const s:any=Object.create(ConversationsService.prototype);
 s.logger={warn:jest.fn(),log:jest.fn(),error:jest.fn()};
 s.llmRouter={execute:jest.fn()};s.eventEmitter={emit:jest.fn()};s.recordAgentSignal=jest.fn();
 s.alignReplyLanguage=jest.fn(async(reply:string)=>reply);
 s.responseValidator={validatePrices:jest.fn(()=>({ok:true,hallucinatedPrices:[]}))};return s;
}
const question=`¿El producto ${name} sigue a la venta? Distingue si está retirado o solo agotado.`;
async function guard(s:any,reply:string,tools:any[],text=question,lang='es',context:any={}){
 return s.applyOutputGuardrails(reply,'', [{role:'user',content:text}],[],'synthetic-tenant','synthetic-conversation',tools,lang,[],context);
}

describe('AGENT-005 actual shared output guard: inactive catalog state',()=>{
 it('does not offer the inactive product with three remaining units or treat read ok as sale state',async()=>{
  const s=service();const reply='Está disponible para la venta, tiene stock de 3 unidades y su estado es "ok". No está agotado ni retirado.';
  const result=await guard(s,reply,[tool()]);
  expect(result).toContain('retirado de la venta');expect(result).toContain('no se puede comprar');
  expect(result).not.toContain('No está agotado ni retirado');expect(s.llmRouter.execute).not.toHaveBeenCalled();
 });
 it('does not call inactive zero-stock merely exhausted or deny retirement',async()=>{
  const s=service();const reply='Está agotado actualmente, no hay unidades en stock, pero no está retirado de la venta.';
  const result=await guard(s,reply,[{...tool(0),name:'check_stock'}]);
  expect(result).toContain('retirado de la venta');expect(result).toContain('no se puede comprar');expect(result).not.toContain('no está retirado');
 });
 it.each(['en','pt','fr'])('grounds retirement in the selected %s language without another model call',async lang=>{
  const s=service();const text=lang==='en'?'Is this product still for sale?':lang==='pt'?'O produto ainda está à venda?':'Le produit est-il encore en vente ?';
  const result=await guard(s,'The product is still for sale.',[tool()],text,lang);
  expect(result).toContain(name);expect(result).not.toBe('The product is still for sale.');expect(s.llmRouter.execute).not.toHaveBeenCalled();
 });
 it('keeps active zero-stock distinct and leaves an unrelated price-only answer unchanged',async()=>{
  const s=service();expect(await guard(s,'No quedan unidades.',[tool(0,{isAvailable:true})])).toBe('No quedan unidades.');
  expect(await guard(s,'El precio es 12345 COP.',[tool()],'¿Cuál es su precio?')).toBe('El precio es 12345 COP.');
 });
 it('does not ground facts from errors, stale reads, foreign sources, malformed ids or missing availability',async()=>{
  for(const extra of[{status:'error'},{stale:true},{source:'derived'},{id:'not-a-uuid'},{isAvailable:undefined}]){
   expect(await guard(service(),'Respuesta previa.',[tool(3,extra)])).toBe('Respuesta previa.');
  }
 });
 it('uses the latest successful own product state and does not collapse a multi-product answer',async()=>{
  expect(await guard(service(),'Está disponible.',[tool(),tool(3,{isAvailable:true})])).toBe('Está disponible.');
  expect(await guard(service(),'Comparación de dos productos.',[tool(),tool(0,{id:OTHER})])).toBe('Comparación de dos productos.');
 });
 it('does not replace trusted directives or a human handoff promise',async()=>{
  expect(await guard(service(),'Texto del motor.',[tool()],question,'es',{directive:'engine_owned'})).toBe('Texto del motor.');
  expect(await guard(service(),'Te voy a pasar con una persona del equipo.',[tool()])).toBe('Te voy a pasar con una persona del equipo.');
 });
});
