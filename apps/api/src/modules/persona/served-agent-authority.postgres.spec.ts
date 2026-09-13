import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { operationalConfigurationHash } from './agent-configuration-revision';
import { assertServedAgentAuthority, ServedAgentAuthorityError, type ServedAgentAuthority } from './served-agent-authority';
import { readServingPersona } from './serving-persona';
import { AppointmentsService } from '../appointments/appointments.service';
import { GymsService } from '../gyms/gyms.service';
import { EducationEnrollmentCommands } from '../education/education-enrollment-commands';
import { RepairOrdersService } from '../repair-orders/repair-orders.service';
import { CatalogOrderCommands } from '../orders/catalog-order-commands';
import { catalogHash } from '../orders/catalog-order-contract';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { TemporalCapacityContractService } from '../verticals/temporal-capacity-contract.service';

const url=process.env.PARALLLY_ISOLATION_TEST_URL;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
(url?describe:describe.skip)('served operational authority at canonical effect commit (real Prisma/PostgreSQL)',()=>{
    const schema=`tenant_served_effect_${randomUUID().replace(/-/g,'')}`;
    const tenantId=randomUUID(),agentId=randomUUID(),contactId=randomUUID(),conversationId=randomUUID();
    const serviceId=randomUUID(),classId=randomUUID(),memberId=randomUUID(),courseId=randomUUID(),cohortId=randomUUID(),productId=randomUUID();
    const actorId=randomUUID(),date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    let client:PrismaClient,prisma:PrismaService,scope:ServedAgentAuthority;
    let appointments:AppointmentsService,gyms:GymsService,education:EducationEnrollmentCommands,repairs:RepairOrdersService,catalog:CatalogOrderCommands,executor:any;
    let guardBarrier:{entered:ReturnType<typeof deferred>;release:ReturnType<typeof deferred>}|undefined;
    const tables=['customer_memory_erasure','customer_profiles','contact_identities','contacts','conversations','messages','persona_config','agent_personas','courses','campaigns','companies','leads','opportunities',
        'pipelines','pipeline_stages','deals','services','service_staff','calendar_integrations','appointments','availability_slots','blocked_dates',
        'membership_plans','members','fitness_classes','class_bookings','course_cohorts','enrollments','products','orders','order_items','stock_movements',
        'staff_members','customer_vehicles','repair_orders','repair_order_events'];
    const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});prisma=Object.create(PrismaService.prototype);
        prisma.$transaction=client.$transaction.bind(client);prisma.$queryRawUnsafe=client.$queryRawUnsafe.bind(client);prisma.$executeRawUnsafe=client.$executeRawUnsafe.bind(client);
        prisma.getTenantSchemaName=async(id:string)=>{if(id!==tenantId)throw new Error('test_scope');return schema;};
        const native=PrismaService.prototype.transactionInTenantSchema.bind(prisma);
        prisma.transactionInTenantSchema=((name:string,work:any,options:any)=>native(name,async(query:any)=>work(async(sql:string,params?:any[])=>{
            const result=await query(sql,params);
            if(guardBarrier&&sql==='SELECT * FROM agent_personas WHERE id=$1::uuid FOR SHARE'){
                const barrier=guardBarrier;guardBarrier=undefined;barrier.entered.resolve();await barrier.release.promise;
            }
            return result;
        }),options)) as any;
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',tenantId,schema);
        const ddl=readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8').replaceAll('{{SCHEMA_NAME}}',schema);
        for(const sql of (prisma as any).splitSqlStatements(ddl)){
            const match=sql.match(/^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."([a-z_]+)"/i);
            const index=sql.match(/^CREATE (?:UNIQUE )?INDEX[\s\S]*? ON "[^"]+"\."([a-z_]+)"/i);
            if((match&&tables.includes(match[1]))||(index&&tables.includes(index[1]))||sql.startsWith('DO $payment_policy_columns$'))await client.$executeRawUnsafe(sql);
        }
        const events={emit:jest.fn()},regional={resolve:async()=>({timezone:'America/Bogota'}),timezoneForSchema:async()=> 'America/Bogota'};
        appointments=new AppointmentsService(prisma,events as any,{enqueueWithQuery:async()=>{}} as any,regional as any);
        gyms=new GymsService(prisma);education=new EducationEnrollmentCommands(prisma);repairs=new RepairOrdersService(prisma);catalog=new CatalogOrderCommands(prisma);
        const args:any[]=Array(32).fill({});Object.assign(args,{0:prisma,1:{acquireLockToken:async()=>randomUUID(),releaseLockToken:async()=>true,get:async()=>null},2:events,13:gyms,31:appointments});
        executor=new (AIToolExecutorService as any)(...args);
        executor.temporalContracts=new TemporalCapacityContractService();executor.getTenantTimezone=async()=> 'America/Bogota';
        executor.findAppointmentConflict=async()=>false;executor.checkAvailability=async()=>({slots:[]});
    },30000);
    beforeEach(async()=>{
        await q(`TRUNCATE ${tables.map(name=>`"${name}"`).join(',')} CASCADE`);
        await q("INSERT INTO agent_personas(id,name,config_json,version,is_active,is_default,channels,channel_bindings) VALUES($1::uuid,'Agent','{}',7,true,true,'{}','{}')",[agentId]);
        await q("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'synthetic','web_widget','Synthetic')",[contactId]);
        await q("INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,'web_widget','synthetic')",[conversationId,contactId]);
        await q("INSERT INTO persona_config(config_yaml,config_json,is_active) VALUES('{}','{\"hours\":{\"timezone\":\"America/Bogota\"}}',true)");
        await q("INSERT INTO services(id,name,duration_minutes,max_concurrent,price,currency,payment_policy) VALUES($1::uuid,'Service',30,1,100,'COP','none')",[serviceId]);
        await q("INSERT INTO courses(id,name,slug) VALUES($1::uuid,'Course','course')",[courseId]);
        await q("INSERT INTO course_cohorts(id,course_id,cohort_code,starts_at,max_capacity,available_seats,status) VALUES($1::uuid,$2::uuid,'COHORT',$3::date,2,2,'open')",[cohortId,courseId,date]);
        await q("INSERT INTO members(id,contact_id,status,class_credits_remaining) VALUES($1::uuid,$2::uuid,'active',3)",[memberId,contactId]);
        await q("INSERT INTO fitness_classes(id,name,scheduled_at,max_capacity,available_spots,credits_required) VALUES($1::uuid,'Class',$2::timestamp,2,2,1)",[classId,`${date} 10:00`]);
        await q("INSERT INTO products(id,name,price,currency,stock,is_available) VALUES($1::uuid,'Product',100,'COP',10,true)",[productId]);
        scope={kind:'agent',tenantId,schemaName:schema,agentId,version:7,operationalHash:operationalConfigurationHash((await q('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]))[0])};
    });
    afterEach(()=>{guardBarrier?.release.resolve();guardBarrier=undefined;});
    afterAll(async()=>{if(client)try{if(!/^tenant_served_effect_[a-f0-9]{32}$/.test(schema))throw new Error('cleanup_scope');await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);}finally{await client.$disconnect();}});
    const appointment=(authority?:ServedAgentAuthority)=>appointments.create(schema,{contactId,conversationId,serviceId,serviceName:'Service',startAt:`${date}T10:00:00`,endAt:`${date}T10:30:00`,customerName:'Synthetic'},
        {suppressEffects:true,confirmWithoutPayment:true,operationalScope:authority});
    const intake=(authority?:ServedAgentAuthority)=>repairs.create(schema,{contactId,vehicle:{make:'Mazda',model:'3',licensePlate:'EVAL123'},customerConcern:'Reported vibration',idempotencyKey:randomUUID()}, {type:'agent'},authority);
    const order=async(authority?:ServedAgentAuthority)=>{const data={contactId,items:[{productId,quantity:1}],idempotencyKey:randomUUID()};const terms=await catalog.quote(schema,data);return catalog.create(schema,data,{source:'agent',expectedTermsHash:catalogHash(terms),operationalScope:authority});};
    const enroll=async(authority?:ServedAgentAuthority)=>education.enroll(schema,{cohortId,contactId,studentName:'Synthetic',enrollmentTerms:await education.getTerms(schema,cohortId)},authority);
    const families=[
        {name:'appointment',run:()=>appointment(scope),count:()=>q('SELECT COUNT(*)::int n FROM appointments')},
        {name:'gym',run:()=>gyms.bookClass(schema,classId,memberId,scope),count:()=>q('SELECT COUNT(*)::int n FROM class_bookings')},
        {name:'education',run:()=>enroll(scope),count:()=>q('SELECT COUNT(*)::int n FROM enrollments')},
        {name:'repair',run:()=>intake(scope),count:()=>q('SELECT COUNT(*)::int n FROM repair_orders')},
        {name:'catalog',run:()=>order(scope),count:()=>q('SELECT COUNT(*)::int n FROM orders')},
    ];
    const waitForBlock=async(pid:number)=>{for(let n=0;n<100;n++){const rows:any[]=await client.$queryRawUnsafe('SELECT cardinality(pg_blocking_pids($1::int)) AS n',pid);if(rows[0].n>0)return;await new Promise(r=>setTimeout(r,10));}throw new Error('publisher_not_blocked');};
    it.each(families)('$name commits the admitted effect before publication can replace its version',async family=>{
        const barrier={entered:deferred(),release:deferred()};guardBarrier=barrier;
        const effect=family.run();await Promise.race([barrier.entered.promise,effect.then(()=>{throw new Error('effect_skipped_guard');})]);
        const started=deferred();let pid=0;
        const publication=client.$transaction(async tx=>{
            pid=(await tx.$queryRawUnsafe<any[]>('SELECT pg_backend_pid() AS pid'))[0].pid;started.resolve();
            await tx.$queryRawUnsafe('SELECT id FROM public.tenants WHERE id=$1::uuid FOR UPDATE',tenantId);
            await tx.$executeRawUnsafe(`UPDATE "${schema}".agent_personas SET version=8 WHERE id=$1::uuid`,agentId);
        });
        try{await started.promise;await waitForBlock(pid);}finally{barrier.release.resolve();}
        await effect;await publication;expect((await family.count())[0].n).toBe(1);
        await expect(family.run()).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect((await family.count())[0].n).toBe(1);
    },15000);
    it.each(families)('$name refuses hash drift without a version increment and deactivation',async family=>{
        await q("UPDATE agent_personas SET config_json='{\"changed\":true}' WHERE id=$1::uuid",[agentId]);
        await expect(family.run()).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        await q("UPDATE agent_personas SET config_json='{}',is_active=false WHERE id=$1::uuid",[agentId]);
        await expect(family.run()).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect((await family.count())[0].n).toBe(0);
    });
    it('guards appointment cancel and reschedule within their actual writer transactions',async()=>{
        const item=await appointment();await q('UPDATE agent_personas SET version=8');
        await expect(executor.cancelAppointment(schema,contactId,item.id,'Changed',undefined,scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        await expect(executor.rescheduleAppointment(schema,contactId,item.id,date,'11:00','Changed',scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect((await q('SELECT status,start_at::text FROM appointments WHERE id=$1::uuid',[item.id]))[0]).toMatchObject({status:'confirmed',start_at:`${date} 10:00:00`});
    });
    it('guards gym and education cancellation without restoring credits or seats',async()=>{
        const booking=await gyms.bookClass(schema,classId,memberId),enrollment=await enroll();await q('UPDATE agent_personas SET version=8');
        await expect(gyms.cancelBooking(schema,booking.id,contactId,scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        await expect(education.cancel(schema,enrollment.id,{contactId},scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect((await q('SELECT available_spots FROM fitness_classes'))[0].available_spots).toBe(1);
        expect((await q('SELECT available_seats FROM course_cohorts'))[0].available_seats).toBe(1);
    });
    it('guards repair decisions/cancellation and catalog cancellation without restoring stock',async()=>{
        const repair=await intake();await repairs.updateEstimate(schema,repair.id,{expectedVersion:1,amountCents:10000,currency:'COP'},actorId);
        const terms=await repairs.getActionTerms(schema,repair.id,contactId,'estimate_decision');
        const cancelTerms=await repairs.getActionTerms(schema,repair.id,contactId,'cancel');
        const purchase=await order(),orderTerms=await catalog.cancellationTerms(schema,purchase.id,contactId);
        await q('UPDATE agent_personas SET version=8');
        await expect(repairs.decideEstimate(schema,repair.id,contactId,true,'agent',undefined,undefined,{expectedVersion:terms.orderVersion},scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        await expect(repairs.cancelOwned(schema,repair.id,contactId,'Changed',{expectedVersion:cancelTerms.orderVersion},scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        await expect(catalog.cancel(schema,purchase.id,contactId,{source:'agent',expectedVersion:orderTerms.orderVersion,expectedTermsHash:catalogHash(orderTerms),operationalScope:scope})).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect((await q('SELECT stock FROM products'))[0].stock).toBe(9);
    });
    it('reads the hash from the same selected row and rejects scope from another tenant',async()=>{
        const served=await readServingPersona(<T>(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<T>(schema,sql,params),'web_widget');
        expect(served.operationalHash).toBe((scope as any).operationalHash);
        await expect(appointment({...scope,tenantId:randomUUID()})).rejects.toBeInstanceOf(ServedAgentAuthorityError);
    });
    it('preserves explicit human commands and refuses legacy scope once a durable agent exists',async()=>{
        await appointment();const {revisionHash}=await import('../evaluation-revision/evaluation-revision');
        await expect(prisma.transactionInTenantSchema(schema,query=>assertServedAgentAuthority(query,schema,{kind:'legacy',tenantId,schemaName:schema,legacyConfigHash:revisionHash({hours:{timezone:'America/Bogota'}})})))
            .rejects.toBeInstanceOf(ServedAgentAuthorityError);
    });
    it('serializes a legacy effect before the first durable agent insert, then rejects that legacy authority',async()=>{
        await q('DELETE FROM agent_personas');
        const {revisionHash}=await import('../evaluation-revision/evaluation-revision');
        const legacy={kind:'legacy' as const,tenantId,schemaName:schema,legacyConfigHash:revisionHash({hours:{timezone:'America/Bogota'}})};
        const entered=deferred(),release=deferred();
        const effect=prisma.transactionInTenantSchema(schema,async query=>{
            await assertServedAgentAuthority(query,schema,legacy);entered.resolve();await release.promise;
            await query("INSERT INTO class_bookings(class_id,member_id,status) VALUES($1::uuid,$2::uuid,'confirmed')",[classId,memberId]);
        });
        await entered.promise;let pid=0;const insertStarted=deferred();
        const firstAgent=client.$transaction(async transaction=>{
            pid=(await transaction.$queryRawUnsafe<any[]>('SELECT pg_backend_pid() AS pid'))[0].pid;insertStarted.resolve();
            await transaction.$executeRawUnsafe(`INSERT INTO "${schema}".agent_personas(id,name,config_json,version,is_active) VALUES($1::uuid,'First','{}',1,true)`,agentId);
        });
        try{await insertStarted.promise;await waitForBlock(pid);}finally{release.resolve();}
        await effect;await firstAgent;
        expect((await q('SELECT COUNT(*)::int n FROM class_bookings'))[0].n).toBe(1);
        await expect(prisma.transactionInTenantSchema(schema,query=>assertServedAgentAuthority(query,schema,legacy)))
            .rejects.toBeInstanceOf(ServedAgentAuthorityError);
    },15000);
    it('rolls back the effect and releases its guard after a downstream domain failure',async()=>{
        await expect(prisma.transactionInTenantSchema(schema,async query=>{
            await assertServedAgentAuthority(query,schema,scope);
            await query("UPDATE products SET stock=stock-1 WHERE id=$1::uuid",[productId]);
            throw new Error('downstream_failure');
        })).rejects.toThrow('downstream_failure');
        expect((await q('SELECT stock FROM products'))[0].stock).toBe(10);
        await q('UPDATE agent_personas SET version=8');
        await expect(order(scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
    });
});
