import { FaqsService } from './faqs.service';
const TENANT='11111111-1111-4111-8111-111111111111';
const READ_ONLY={mode:'live',persistence:'disabled'}as const;
function fixture(schema='tenant_synthetic_faq_a'){
 const row={id:'22222222-2222-4222-8222-222222222222',question:'Synthetic FAQ',answer:'QA only; do not sell.',is_published:true};
 const query=jest.fn().mockResolvedValue([row]),execute=jest.fn().mockResolvedValue(1);
 const lockQuery=jest.fn().mockResolvedValue([]),ddl=jest.fn().mockResolvedValue(0);
 const transaction=jest.fn(async(work:any)=>work({$queryRawUnsafe:lockQuery,$executeRawUnsafe:ddl}));
 const getSchemaName=jest.fn().mockResolvedValue(schema);
 const service=new FaqsService({$queryRawUnsafe:query,$executeRawUnsafe:execute,$transaction:transaction}as any,{}as any,{getSchemaName}as any);
 return{service,query,execute,lockQuery,ddl,transaction,getSchemaName};
}
describe('FAQSQLA disabled persistence SQL boundary',()=>{
 it('searches only published rows without initialization or writes',async()=>{
  const h=fixture();const result=await h.service.search(TENANT,'synthetic',3,READ_ONLY);
  expect(result[0].answer).toBe('QA only; do not sell.');
  expect(h.getSchemaName).toHaveBeenCalledWith(TENANT,READ_ONLY);
  expect(h.query.mock.calls[0][0]).toContain('WHERE is_published = true');
  expect(h.query.mock.calls[0][0]).toContain('"tenant_synthetic_faq_a"."faqs"');
  expect(h.transaction).not.toHaveBeenCalled();expect(h.execute).not.toHaveBeenCalled();
 });
 it('binds hostile customer text as a value rather than SQL',async()=>{
  const h=fixture();const input="x'); DROP TABLE faqs; --";await h.service.search(TENANT,input,3,READ_ONLY);
  expect(h.query).toHaveBeenCalledTimes(1);const [sql,...params]=h.query.mock.calls[0];
  expect(sql).not.toContain(input);expect(params).toEqual([input,3]);expect(sql).toContain('plainto_tsquery(\'simple\', $1)');
  expect(h.transaction).not.toHaveBeenCalled();expect(h.execute).not.toHaveBeenCalled();
 });
 it('propagates schema lookup rejection before SQL or fallback',async()=>{
  const h=fixture();h.getSchemaName.mockRejectedValue(Error('synthetic scope rejected'));
  await expect(h.service.search(TENANT,'synthetic',3,READ_ONLY)).rejects.toThrow('synthetic scope rejected');
  expect(h.query).not.toHaveBeenCalled();expect(h.transaction).not.toHaveBeenCalled();expect(h.execute).not.toHaveBeenCalled();
 });
});
describe('FAQSQLB live initialization and metrics effect boundary',()=>{
 it('initializes under the schema advisory lock once and reuses warm initialization',async()=>{
  const h=fixture('tenant_synthetic_faq_b');await h.service.search(TENANT,'synthetic',3);await h.service.search(TENANT,'synthetic',3);
  expect(h.transaction).toHaveBeenCalledTimes(1);expect(h.lockQuery).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'),'runtime-schema:tenant_synthetic_faq_b');
  expect(h.ddl).toHaveBeenCalledTimes(6);expect(h.ddl.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS "tenant_synthetic_faq_b"."faqs"');
  expect(h.query).toHaveBeenCalledTimes(2);expect(h.execute).not.toHaveBeenCalled();
 });
 it('increments only the requested FAQ in the resolved tenant schema with a bound UUID',async()=>{
  const h=fixture('tenant_synthetic_faq_b');const id='22222222-2222-4222-8222-222222222222';await h.service.incrementViews(TENANT,id);
  expect(h.getSchemaName).toHaveBeenCalledWith(TENANT);expect(h.execute).toHaveBeenCalledWith('UPDATE "tenant_synthetic_faq_b"."faqs" SET views = views + 1 WHERE id = $1::uuid',id);
  expect(h.query).not.toHaveBeenCalled();expect(h.transaction).not.toHaveBeenCalled();
 });
 it('swallows a metric database failure so resolved promise cannot certify persistence',async()=>{
  const h=fixture('tenant_synthetic_faq_b');h.execute.mockRejectedValue(Error('synthetic database unavailable'));
  await expect(h.service.incrementViews(TENANT,'22222222-2222-4222-8222-222222222222')).resolves.toBeUndefined();
  expect(h.execute).toHaveBeenCalledTimes(1);expect(h.transaction).not.toHaveBeenCalled();
 });
});
