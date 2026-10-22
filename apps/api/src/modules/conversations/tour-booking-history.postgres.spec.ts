import {randomUUID}from 'crypto';
import {PrismaClient}from '@prisma/client';
import {AIToolExecutorService}from './ai-tool-executor.service';
import {isDisposableDatabaseUrl,DISPOSABLE_EVAL_DATABASE}from '../../common/__fixtures__/disposable-database';
const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
(connection?describe:describe.skip)('current customer and tour history SQL facts',()=>{
 const schema='tenant_tourhistory_'+randomUUID().replace(/-/g,''),own=randomUUID(),foreign=randomUUID(),leadOld=randomUUID(),leadNew=randomUUID(),leadForeign=randomUUID(),pkg=randomUUID();
 let db:PrismaClient,s:any;
 const context=()=>s.getCustomerContext(schema,own),bookings=()=>s.listMyTourBookings(schema,own);
 async function booking(contact:string,status:string,payment:string,date='2026-02-01'){
  const id=randomUUID();await db.$executeRawUnsafe(`INSERT INTO "${schema}".tour_bookings(id,contact_id,package_id,departure_date,departure_time,party_size,total_price,currency,status,payment_status,guest_name)VALUES($1::uuid,$2::uuid,$3::uuid,$4::date,'09:00',2,125,'EUR',$5,$6,'Synthetic guest')`,id,contact,pkg,date,status,payment);return id;
 }
 beforeAll(async()=>{
  const u=new URL(connection!);if(!isDisposableDatabaseUrl(u,DISPOSABLE_EVAL_DATABASE))throw Error('owned_disposable_database_required');
  db=new PrismaClient({datasourceUrl:connection!});s=Object.assign(Object.create(AIToolExecutorService.prototype),{prisma:db,logger:{warn:jest.fn(),error:jest.fn()}});
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for(const statement of[
   `CREATE TABLE "${schema}".contacts(id uuid PRIMARY KEY,name text,tags jsonb,first_contact_at timestamp,last_contact_at timestamp)`,
   `CREATE TABLE "${schema}".leads(id uuid PRIMARY KEY,contact_id uuid,stage text,score integer,first_name text,last_name text,created_at timestamp)`,
   `CREATE TABLE "${schema}".opportunities(id uuid PRIMARY KEY,lead_id uuid)`,
   `CREATE TABLE "${schema}".tour_packages(id uuid PRIMARY KEY,name text)`,
   `CREATE TABLE "${schema}".tour_bookings(id uuid PRIMARY KEY,contact_id uuid,package_id uuid,departure_date date NOT NULL,departure_time text,party_size integer,total_price numeric,currency text,status text,payment_status text,guest_name text)`
  ])await db.$executeRawUnsafe(statement);
 });
 beforeEach(async()=>{
  await db.$executeRawUnsafe(`TRUNCATE "${schema}".contacts,"${schema}".leads,"${schema}".opportunities,"${schema}".tour_packages,"${schema}".tour_bookings`);
  await db.$executeRawUnsafe(`INSERT INTO "${schema}".contacts VALUES($1::uuid,'Synthetic current','["VIP","Sintético"]'::jsonb,'2025-04-02 10:30:00','2026-09-01 08:00:00'),($2::uuid,'Synthetic other','["FORBIDDEN_OTHER_TAG"]'::jsonb,'2020-01-01','2020-01-02')`,own,foreign);
  await db.$executeRawUnsafe(`INSERT INTO "${schema}".leads VALUES($1::uuid,$2::uuid,'old',1,'Old','Synthetic','2026-01-01'),($3::uuid,$2::uuid,'qualified',42,'Current','Synthetic','2026-02-01'),($4::uuid,$5::uuid,'foreign',99,'FORBIDDEN_OTHER_LEAD','Synthetic','2026-03-01')`,leadOld,own,leadNew,leadForeign,foreign);
  for(const lead of[leadOld,leadNew,leadNew,leadForeign])await db.$executeRawUnsafe(`INSERT INTO "${schema}".opportunities VALUES($1::uuid,$2::uuid)`,randomUUID(),lead);
  await db.$executeRawUnsafe(`INSERT INTO "${schema}".tour_packages VALUES($1::uuid,'Synthetic Expedition')`,pkg);
 });
 afterAll(async()=>{if(!db)return;try{if(!/^tenant_tourhistory_[a-f0-9]{32}$/.test(schema))throw Error('unsafe_schema');await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await db.$disconnect();}});
 jest.setTimeout(45000);
 it('TOURHIST_A_CANCELLED preserves both cancelled payment states with no chargeable references',async()=>{
 const a=await booking(own,'cancelled','pending','2026-02-01'),b=await booking(own,'cancelled','refunded','2026-02-02');await booking(foreign,'confirmed','pending','2030-01-01');
 const r=await bookings();expect(r).toMatchObject({historyLimit:10,historyMayBeTruncated:false});expect(r.bookings.map((x:any)=>x.id)).toEqual([b,a]);expect(r.bookings).toEqual(expect.arrayContaining([expect.objectContaining({id:a,status:'cancelled',paymentStatus:'pending',payableReference:null}),expect.objectContaining({id:b,status:'cancelled',paymentStatus:'refunded',payableReference:null})]));
 });
 it('TOURHIST_A_EMPTY explicitly reports an empty bounded own history despite foreign data',async()=>{
 await booking(foreign,'confirmed','pending');expect(await bookings()).toEqual({historyLimit:10,historyMayBeTruncated:false,bookings:[]});
 });
 it('TOURHIST_A_SHORT mixed confirmed/completed/cancelled history retains exact statuses in departure order',async()=>{
 const a=await booking(own,'confirmed','paid','2026-01-01'),b=await booking(own,'completed','paid','2026-01-02'),c=await booking(own,'cancelled','refunded','2026-01-03');const r=await bookings();expect(r.historyMayBeTruncated).toBe(false);expect(r.bookings.map((x:any)=>[x.id,x.status,x.paymentStatus])).toEqual([[c,'cancelled','refunded'],[b,'completed','paid'],[a,'confirmed','paid']]);
 });
 it('TOURHIST_B_BOUNDED more than ten own records reports conservative truncation without foreign leakage',async()=>{
 const ids=[];for(let i=0;i<11;i++)ids.push(await booking(own,'confirmed','paid',new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10)));await booking(foreign,'confirmed','pending','2030-01-01');const r=await bookings();expect(r).toMatchObject({historyLimit:10,historyMayBeTruncated:true});expect(r.bookings.map((x:any)=>x.id)).toEqual(ids.slice(1).reverse());
 });
 it('TOURHIST_B_TIE exactly ten tied departures uses deterministic ID order and conservative bound',async()=>{
 const ids=[];for(let i=0;i<10;i++)ids.push(await booking(own,'confirmed','paid'));const r=await bookings();expect(r).toMatchObject({historyLimit:10,historyMayBeTruncated:true});expect(r.bookings.map((x:any)=>x.id)).toEqual(ids.sort().reverse());
 });
 it('TOURHIST_B_PAYMENT history does not make paid cancelled or refunded bookings chargeable',async()=>{
 const pending=await booking(own,'confirmed','pending','2026-01-01'),failed=await booking(own,'confirmed','failed','2026-01-02'),paid=await booking(own,'confirmed','paid','2026-01-03'),cancelled=await booking(own,'cancelled','pending','2026-01-04'),refunded=await booking(own,'refunded','pending','2026-01-05');const r=await bookings(),find=(id:string)=>r.bookings.find((x:any)=>x.id===id);expect(r.bookings).toHaveLength(5);for(const id of[paid,cancelled,refunded])expect(find(id).payableReference).toBeNull();for(const id of[pending,failed])expect(find(id).payableReference).toBeTruthy();expect(find(cancelled).paymentStatus).toBe('pending');
 });
});
