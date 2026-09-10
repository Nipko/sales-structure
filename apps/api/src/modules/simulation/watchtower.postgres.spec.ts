import { randomUUID } from 'crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { WatchtowerService } from './watchtower.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const redisConnection = process.env.PARALLLY_SAMPLING_REDIS_URL;
(connection ? describe : describe.skip)('Watchtower durable sampling with PostgreSQL', () => {
    const schema = `tenant_sampling_${randomUUID().replace(/-/g,'')}`, tenant = randomUUID();
    const now = new Date('2026-09-07T12:00:00Z'), sampleTime = '2026-09-06T14:00:00Z';
    let pool: any, prisma: any, service: WatchtowerService, realQueue: any, redisOptions: any;
    const queueName=`quality-sampling-test-${randomUUID()}`;
    const jobs = new Map<string, any>();
    const queue = { add: jest.fn(async (_name: string, data: any, options: any) => {
        if(realQueue)await realQueue.add(_name,data,options);
        if (!jobs.has(options.jobId)) jobs.set(options.jobId,{data,options});
        return jobs.get(options.jobId);
    }) };
    const q = async (sql: string, params: any[] = []) => prisma.executeInTenantSchema(schema,sql,params);
    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1','localhost'].includes(url.hostname) || !isDisposableDatabaseUrl(url)) throw new Error('disposable_eval_database_required');
        pool = new Pool({connectionString:connection,max:8});
        if(redisConnection){
            const redisUrl=new URL(redisConnection);
            if(redisUrl.protocol!=='redis:'||!['127.0.0.1','localhost'].includes(redisUrl.hostname)||redisUrl.port!=='55440')throw new Error('disposable_sampling_redis_required');
            redisOptions={host:redisUrl.hostname,port:Number(redisUrl.port),maxRetriesPerRequest:null};
            realQueue=new Queue(queueName,{connection:redisOptions});await realQueue.waitUntilReady();
        }
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await pool.query(`CREATE SCHEMA "${schema}"`);
        prisma = {
            getTenantSchemaName: async()=>schema,
            transactionInTenantSchema: async (selected: string, work: any) => {
                if (selected !== schema) throw new Error('test_namespace_scope_required');
                const client = await pool.connect(); await client.query('BEGIN');
                try {
                    await client.query(`SET LOCAL search_path TO "${schema}",public`);
                    await client.query("SET LOCAL TIME ZONE 'UTC'");
                    const result = await work(async (sql: string, params: any[] = []) => (await client.query(sql,params)).rows);
                    await client.query('COMMIT'); return result;
                } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
            },
            executeInTenantSchema: (selected: string, sql: string, params: any[]=[]) => prisma.transactionInTenantSchema(selected,(query: any)=>query(sql,params)),
        };
        const ddl = readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8').replace(/\{\{SCHEMA_NAME\}\}/g,schema);
        for (const statement of (PrismaService.prototype as any).splitSqlStatements(ddl)) {
            const table = statement.match(/^CREATE TABLE IF NOT EXISTS\s+"[^"]+"\."([a-z_]+)"/i)?.[1];
            if (['contacts','conversations','messages'].includes(table)) await pool.query(statement);
        }
        service = new WatchtowerService(prisma,queue as any);
        await service.report(tenant,'2026-09-06'); // production schema migration
    });
    beforeEach(async()=>{
        if(realQueue)await realQueue.obliterate({force:true});
        await q('DELETE FROM quality_sampling_runs'); await q('DELETE FROM customer_memory_erasure'); await q('DELETE FROM contacts');
        jobs.clear(); queue.add.mockClear();
    });
    afterAll(async()=>{
        if (!pool) return;
        if(realQueue){await realQueue.obliterate({force:true});await realQueue.close();}
        // Names come from this test's exclusive schema. No cascading outside it.
        await pool.query(`DROP TABLE "${schema}".quality_sampling_items,"${schema}".quality_sampling_runs,"${schema}".customer_memory_erasure,"${schema}".messages,"${schema}".conversations,"${schema}".contacts RESTRICT`);
        await pool.query(`DROP SCHEMA "${schema}" RESTRICT`); await pool.end();
    });
    async function conversation(options: {channel?:string; status?:string; time?:string; text?:string; outbound?:boolean} = {}) {
        const id=randomUUID(),contact=randomUUID(),channel=options.channel||'web_widget',time=options.time||sampleTime;
        await q('INSERT INTO contacts(id,external_id,channel_type) VALUES($1::uuid,$2,$3)',[contact,id,channel]);
        await q('INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status,updated_at) VALUES($1::uuid,$2::uuid,$3,\'test\',$4,$5::timestamp)',[id,contact,channel,options.status||'active',time]);
        await q('INSERT INTO messages(conversation_id,direction,content_text,created_at) VALUES($1::uuid,$2,$3,$4::timestamp)',[id,options.outbound?'outbound':'inbound',options.text??'Synthetic customer question',time]);
        return {id,contact};
    }
    it('keeps absent evidence unknown and records a verified empty eligible population',async()=>{
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({state:'not_captured',eligible:null,selected:null});
        await service.capture(tenant,now);
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({state:'available',eligible:0,selected:0,queued:0,actualFraction:null});
    });
    it('executes through the production Prisma query wrappers, including locks, JSON parameters and result serialization',async()=>{
        const client=new PrismaClient({datasources:{db:{url:connection}}});
        const production=Object.create(PrismaService.prototype);
        production.$transaction=client.$transaction.bind(client);
        production.getTenantSchemaName=async(id:string)=>{if(id!==tenant)throw new Error('test_tenant_scope_required');return schema;};
        try{
            await conversation();const runtime=new WatchtowerService(production,queue as any);
            await runtime.capture(tenant,now);await runtime.dispatch(tenant);
            expect(await runtime.report(tenant,'2026-09-06')).toMatchObject({eligible:1,selected:1,queued:1});
        }finally{await client.$disconnect();}
    });
    it('includes unanswered/handed-off/resolved requests and excludes erased, active-today, unsupported and outbound-only sources',async()=>{
        await conversation({status:'active'}); await conversation({status:'waiting_human'}); await conversation({status:'resolved'});
        await conversation({channel:'email'}); await conversation({outbound:true}); await conversation({time:'2026-09-07T01:00:00Z'});
        await conversation({text:'[REDACTED]'}); await conversation({text:''}); await conversation({text:'   '});
        const erased=await conversation(); await q('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[erased.contact]);
        await service.capture(tenant,now);
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({eligible:3,selected:1,pending:1,actualFraction:1/3});
        const items=await q('SELECT conversation_id,contact_id FROM quality_sampling_items');
        expect(items).toHaveLength(1);expect(items[0].contact_id).not.toBe(erased.contact);
    });
    it('captures one reproducible sample and denominator despite concurrent schedulers and later source changes',async()=>{
        for(let i=0;i<23;i++)await conversation();
        await Promise.all([service.capture(tenant,now),new WatchtowerService(prisma,queue as any).capture(tenant,now)]);
        const ids=(await q('SELECT id FROM quality_sampling_items ORDER BY id')).map((row:any)=>row.id);
        await conversation(); await service.capture(tenant,now);
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({eligible:23,selected:2,pending:2});
        expect((await q('SELECT id FROM quality_sampling_items ORDER BY id')).map((row:any)=>row.id)).toEqual(ids);
        expect(await q('SELECT id FROM quality_sampling_runs')).toHaveLength(1);
    });
    it('persists a failed queue acknowledgement and retries with the same retained id without raw customer text',async()=>{
        await conversation(); await service.capture(tenant,now);
        const normal=queue.add.getMockImplementation()!;
        queue.add.mockImplementationOnce(async(name,data,options)=>{await normal(name,data,options);throw new Error('lost acknowledgement');});
        await service.dispatch(tenant);
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({pending:1,queued:0});
        await q("UPDATE quality_sampling_items SET next_attempt_at=NOW()-INTERVAL '1 minute'");
        await service.dispatch(tenant);
        expect(queue.add).toHaveBeenCalledTimes(2);expect(jobs.size).toBe(1);
        expect([...jobs.values()][0].data).toEqual({tenantId:tenant,conversationId:expect.any(String)});
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({pending:0,queued:1,evidence:'queue_acceptance'});
    });
    it('caps a large population honestly instead of reporting an uncapped five percent sample',async()=>{
        await q(`WITH new_contacts AS (INSERT INTO contacts(id,external_id,channel_type)
            SELECT gen_random_uuid(),n::text,'web_widget' FROM generate_series(1,1021) n RETURNING id),
            new_conversations AS (INSERT INTO conversations(contact_id,channel_type,channel_account_id,updated_at)
                SELECT id,'web_widget','test',$1::timestamp FROM new_contacts RETURNING id)
            INSERT INTO messages(conversation_id,direction,content_text,created_at)
                SELECT id,'inbound','Synthetic request',$1::timestamp FROM new_conversations`,[sampleTime]);
        await service.capture(tenant,now);
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({eligible:1021,selected:50,sampleCap:50,requestedFraction:0.05,actualFraction:50/1021});
    });
    it('does not let another worker enqueue the same item during a live lease',async()=>{
        await conversation();await service.capture(tenant,now);
        let acknowledge!:()=>void,enter!:()=>void;
        const entered=new Promise<void>(resolve=>enter=resolve),wait=new Promise<void>(resolve=>acknowledge=resolve);
        const normal=queue.add.getMockImplementation()!;
        queue.add.mockImplementationOnce(async(name,data,options)=>{enter();await wait;return normal(name,data,options);});
        const first=service.dispatch(tenant);await entered;
        await new WatchtowerService(prisma,queue as any).dispatch(tenant);
        expect(queue.add).toHaveBeenCalledTimes(1);acknowledge();await first;
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({queued:1,pending:0});
    });
    it('lets only one worker claim each item and preserves privacy tombstones before dispatch',async()=>{
        const source=await conversation();await service.capture(tenant,now);
        await q('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[source.contact]);
        await Promise.all([service.dispatch(tenant),new WatchtowerService(prisma,queue as any).dispatch(tenant)]);
        expect(queue.add).not.toHaveBeenCalled();
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({selected:1,erased:1,queued:0});
        expect((await q('SELECT contact_id,conversation_id FROM quality_sampling_items'))[0]).toEqual({contact_id:null,conversation_id:null});
    });
    it('recovers expired claims, marks exhausted uncertain claims, and does not starve them indefinitely',async()=>{
        await conversation();await service.capture(tenant,now);
        await q("UPDATE quality_sampling_items SET attempts=4,lease_token=$1::uuid,lease_expires_at=NOW()-INTERVAL '1 minute'",[randomUUID()]);
        await service.dispatch(tenant);expect(queue.add).toHaveBeenCalledTimes(1);
        await q("UPDATE quality_sampling_items SET state='selected',attempts=5,lease_token=$1::uuid,lease_expires_at=NOW()-INTERVAL '1 minute'",[randomUUID()]);
        await service.dispatch(tenant);
        expect(queue.add).toHaveBeenCalledTimes(1);
        expect(await service.report(tenant,'2026-09-06')).toMatchObject({failed:1,pending:0});
    });
    (redisConnection?it:it.skip)('retains the real BullMQ job after completion so a lost producer acknowledgement never runs a second worker job',async()=>{
        await conversation();await service.capture(tenant,now);
        let executed=0;
        const events=new QueueEvents(queueName,{connection:redisOptions});await events.waitUntilReady();
        const worker=new Worker(queueName,async(job:any)=>{executed++;expect(Object.keys(job.data).sort()).toEqual(['conversationId','tenantId']);return{status:'test_worker_completed'};},{connection:redisOptions});
        await worker.waitUntilReady();
        try{
            const normal=queue.add.getMockImplementation()!;
            queue.add.mockImplementationOnce(async(name,data,options)=>{
                await normal(name,data,options);const job=await realQueue.getJob(options.jobId);
                await job.waitUntilFinished(events,5000);throw new Error('acknowledgement lost after worker completed');
            });
            await service.dispatch(tenant);expect(executed).toBe(1);
            await q("UPDATE quality_sampling_items SET next_attempt_at=NOW()-INTERVAL '1 minute'");
            await service.dispatch(tenant);
            const item=(await q('SELECT id FROM quality_sampling_items'))[0],job=await realQueue.getJob(`q-sample-${item.id}`);
            expect(await job.getState()).toBe('completed');expect(executed).toBe(1);
            expect((await realQueue.getJobCounts('completed','waiting','active'))).toMatchObject({completed:1,waiting:0,active:0});
            expect(await service.report(tenant,'2026-09-06')).toMatchObject({queued:1,pending:0});
        }finally{await worker.close();await events.close();}
    });
});
