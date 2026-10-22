import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID='8074246f-02e0-4f64-a9b1-a0cf8cd62407',NAME='Spark QA Camiseta 20261018T090055Z';
const MESSAGE=`Solo consulte si podría haber catorce unidades de ${NAME} con el inventario actual; no cree un pedido ni prometa reposición.`;
function fixture(stock:number|null=13,allowed=['search_products','check_stock']){
 const f=agentTurnFixture();f.personaService.getAgent.mockResolvedValue({version:5,config_json:{language:'es',industry:'retail',tools:{catalog:{enabled:true}},rag:{enabled:false},llm:{}}});publishTools(f,allowed);
 f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>{
  if(name==='search_products')return {status:'ok',products:[{id:ID,name:NAME,isAvailable:true}]};
  if(name==='check_stock')return {status:'ok',id:ID,name:NAME,stock,inStock:stock===null||stock>0};throw Error('unexpected tool '+name);
 });
 const turn=(message=MESSAGE)=>f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram'},{agentSnapshot:undefined});return {f,turn};
}
describe('stock answers receive a fresh authorized stock read before model prose',()=>{
 it.each([13,0,null])('grounds actual named quantity question with current stock %s',async stock=>{
  const h=fixture(stock);const r=await h.turn();expect(r.debug.runtimeError).toBeUndefined();
  expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_products','check_stock']);
  expect(h.f.toolExecutor.execute.mock.calls[0][4]).toEqual({query:'',limit:20});expect(h.f.toolExecutor.execute.mock.calls[1][4]).toEqual({productId:ID});
  const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes(`"stock":${stock}`))).toBe(true);
  expect(h.f.toolExecutor.execute.mock.calls[1][6].executionContext.persistence).toBe('disabled');
 });
 it('does not grant disabled stock capability',async()=>{const h=fixture(13,['search_products']);await h.turn();expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not guess after a failed catalogue read',async()=>{const h=fixture();h.f.toolExecutor.execute.mockResolvedValue({status:'error',error:'READ_FAILED'});await h.turn();expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_products']);});
 it('does not use retail readers for Maya tour capacity tools',async()=>{const h=fixture(13,['search_packages','check_package_availability']);await h.turn('Consulte cupos para tres viajeros del tour Spark QA.');expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();});
 it('does not confuse an unknown PRO variant with the base product',async()=>{const h=fixture();await h.turn(`¿Hay stock de ${NAME} PRO?`);expect(h.f.toolExecutor.execute.mock.calls.map((c:any[])=>c[3])).toEqual(['search_products']);});
 it('does not promise absence after stock reader error',async()=>{const h=fixture();h.f.toolExecutor.execute.mockImplementation(async(_s:string,_t:string,_c:string,name:string)=>name==='search_products'?{products:[{id:ID,name:NAME}]}:{status:'error',error:'READ_FAILED'});await h.turn();const messages=h.f.llmRouter.execute.mock.calls[0][0].messages;expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('READ_FAILED'))).toBe(true);});
});
