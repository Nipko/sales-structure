import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { FaqsService } from './faqs.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';
const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
const READ_ONLY={mode:'live',persistence:'disabled'}as const;
(connection?describe:describe.skip)('FAQ effects with actual PostgreSQL',()=>{
 const schema=`tenant_faqeffect_${randomUUID().replace(/-/g,'')}`,other=`${schema}_other`,tenant=randomUUID();
 let client:PrismaClient;
 const service=(db:any=client,target=schema)=>new FaqsService(db,{}as any,{getSchemaName:async(id:string)=>{if(id!==tenant)throw Error('synthetic scope rejected');return target;}}as any);
 beforeAll(async()=>{if(!isDisposableDatabaseUrl(new URL(connection!)))throw Error('disposable_database_required');client=new PrismaClient({datasourceUrl:connection!});await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);await client.$executeRawUnsafe(`CREATE SCHEMA "${other}"`);});
 afterAll(async()=>{if(!client)return;for(const s of [schema,other]){if(!/^tenant_faqeffect_[a-f0-9]{32}(_other)?$/.test(s))throw Error('unsafe_cleanup_scope');await client.$executeRawUnsafe(`DROP SCHEMA "${s}" CASCADE`);}await client.$disconnect();});
 jest.setTimeout(45000);
 describe('FAQPGA persistence-disabled boundaries',()=>{
  it('fails on an absent table without creating it',async()=>{
   await expect(service().search(tenant,'synthetic',3,READ_ONLY)).rejects.toThrow();
   const rows=await client.$queryRawUnsafe<any[]>('SELECT to_regclass($1)::text AS relation',`${schema}.faqs`);expect(rows[0].relation).toBeNull();
  });
  it('executes inside a real read-only transaction and returns only published exact restrictions',async()=>{
   await service().search(tenant,'synthetic',3);
   await client.$executeRawUnsafe(`INSERT INTO "${schema}".faqs(question,answer,is_published) VALUES($1,$2,true),($3,$4,false)`,'Synthetic policy','Synthetic QA only; do not sell.','Synthetic hidden','PRIVATE UNPUBLISHED');
   const found=await client.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return service(tx).search(tenant,'Synthetic',5,READ_ONLY);});
   expect(found.map(f=>f.answer)).toEqual(['Synthetic QA only; do not sell.']);
   const rows=await client.$queryRawUnsafe<any[]>(`SELECT sum(views)::int AS views FROM "${schema}".faqs`);expect(rows[0].views).toBe(0);
  });
  it('treats hostile query text as data and preserves the table and unpublished row',async()=>{
   await service().search(tenant,"x'); DROP TABLE faqs; --",3,READ_ONLY);
   const rows=await client.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "${schema}".faqs`);expect(rows[0].n).toBe(2);
  });
 });
 describe('FAQPGB initialization and metric persistence',()=>{
  it('serializes two cold initializers and leaves the expected indexes',async()=>{
   await Promise.all([service().search(tenant,'synthetic',3),service().search(tenant,'synthetic',3)]);
   const indexes=await client.$queryRawUnsafe<any[]>('SELECT indexname FROM pg_indexes WHERE schemaname=$1',schema);
   expect(indexes.map(i=>i.indexname)).toEqual(expect.arrayContaining([`idx_faqs_published_${schema}`.slice(0,63),`idx_faqs_tsv_${schema}`.slice(0,63)]));
  });
  it('persists a view increment for the requested UUID without changing another tenant copy',async()=>{
   await service(undefined,other).search(tenant,'synthetic',3);const id=randomUUID();
   for(const s of [schema,other])await client.$executeRawUnsafe(`INSERT INTO "${s}".faqs(id,question,answer,views) VALUES($1::uuid,$2,$3,0)`,id,'Synthetic metric','Synthetic QA');
   await service().incrementViews(tenant,id);
   const a=await client.$queryRawUnsafe<any[]>(`SELECT views FROM "${schema}".faqs WHERE id=$1::uuid`,id),b=await client.$queryRawUnsafe<any[]>(`SELECT views FROM "${other}".faqs WHERE id=$1::uuid`,id);
   expect(a[0].views).toBe(1);expect(b[0].views).toBe(0);
  });
  it('resolves a rejected read-only metric write while stored views remain unchanged',async()=>{
   const id=randomUUID();await client.$executeRawUnsafe(`INSERT INTO "${schema}".faqs(id,question,answer,views) VALUES($1::uuid,$2,$3,7)`,id,'Synthetic failure','Synthetic QA');
   await client.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await expect(service(tx).incrementViews(tenant,id)).resolves.toBeUndefined();});
   const rows=await client.$queryRawUnsafe<any[]>(`SELECT views FROM "${schema}".faqs WHERE id=$1::uuid`,id);expect(rows[0].views).toBe(7);
  });
 });
});
