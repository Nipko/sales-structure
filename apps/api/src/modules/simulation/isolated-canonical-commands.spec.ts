import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { appointmentServiceTerms, AppointmentTermsChangedError } from '../appointments/appointment-service-terms';
import { EducationService } from '../education/education.service';
import { GymsService } from '../gyms/gyms.service';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { authorityFor } from '../conversations/__fixtures__/tool-authority.fixture';
import { ToolExecutionControlService } from '../conversations/tool-execution-control.service';
import { ToolApprovalWorkflowService } from '../conversations/tool-approval-workflow.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { IsolatedEvalNamespace, isolatedEvalNamespaceForPrisma } from './isolated-eval-namespace';
import { EvalService } from './eval.service';
import { PAYMENT_REFERENCE_TARGETS } from '../tenant-payments/tenant-payment-reference';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('canonical domain commands in a disposable PostgreSQL namespace', () => {
    let pool: any, prisma: any, namespaces: IsolatedEvalNamespace, lease: any;
    let appointments: AppointmentsService, gyms: GymsService, education: EducationService, executor: AIToolExecutorService;
    const tenantId = randomUUID(), source = `tenant_commands_${randomUUID().replace(/-/g, '')}`;
    const contactId = '00000000-0000-4000-8000-00000000eba1', otherContact = randomUUID();
    const serviceId = randomUUID(), classId = randomUUID(), memberId = randomUUID(), otherMember = randomUUID(), courseId = randomUUID(), cohortId = randomUUID();
    let conversationId: string;
    const effects = { emit: jest.fn(() => { throw new Error('outbound_domain_event_forbidden'); }) };
    const calendar = { enqueueWithQuery: jest.fn(() => { throw new Error('calendar_outbox_forbidden'); }) };
    const tables = ['customer_profiles','contact_identities','contacts','conversations','messages','persona_config','agent_personas','courses','campaigns','companies','leads','opportunities',
        'pipelines','pipeline_stages','deals','services','service_staff','calendar_integrations','appointments','availability_slots','blocked_dates',
        'membership_plans','members','fitness_classes','class_bookings','course_cohorts','enrollments',
        'properties','property_bookings','tour_packages','tour_inventory','tour_bookings','menu_items','food_orders','food_order_items',
        'products','orders','order_items','vehicles','pets','insurance_policies','insurance_claims',
        'staff_members','customer_vehicles','repair_orders','repair_order_events'];
    const date = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0,10);
    const query = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;
    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/parallly_eval_isolation')) throw new Error('disposable_eval_database_required');
        pool = new (require('pg').Pool)({ connectionString: connection });
        prisma = {
            $queryRawUnsafe: (sql: string,...params: any[]) => query(sql,params),
            $executeRawUnsafe: (sql: string,...params: any[]) => query(sql,params),
            $transaction: async (work: any) => {
                const client = await pool.connect();
                await client.query('BEGIN');
                const q = async (sql: string,...params: any[]) => (await client.query(sql,params)).rows;
                try { const result = await work({ $queryRawUnsafe:q,$executeRawUnsafe:q }); await client.query('COMMIT'); return result; }
                catch(error) { await client.query('ROLLBACK'); throw error; }
                finally { client.release(); }
            },
            transactionInTenantSchema: (schema: string, work: any) => prisma.$transaction(async (tx: any) => {
                if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error('bad_schema');
                await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
                return work((sql: string,params: any[] = [])=>tx.$queryRawUnsafe(sql,...params));
            }),
            executeInTenantSchema: (schema: string,sql: string,params: any[] = []) => prisma.transactionInTenantSchema(schema,(q: any)=>q(sql,params)),
            assertTenantSchemaName: (schema: string) => { if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error('bad_schema'); },
            getTenantSchemaName: async()=>source,
        };
        await query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await query('CREATE TABLE IF NOT EXISTS public.tenants (id uuid PRIMARY KEY,schema_name text NOT NULL)');
        await query('ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true');
        await query('CREATE TABLE IF NOT EXISTS public.users (id uuid PRIMARY KEY,tenant_id uuid,is_active boolean,first_name text,last_name text)');
        await query('INSERT INTO public.tenants(id,schema_name) VALUES($1,$2)',[tenantId,source]);
        await query(`CREATE SCHEMA "${source}"`);
        // Use the checked-in domain DDL, including its later column migrations.
        // No miniature test-only substitute for the actual command schema.
        const sql = readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8').replace(/\{\{SCHEMA_NAME\}\}/g,source);
        const statements: string[] = (PrismaService.prototype as any).splitSqlStatements(sql);
        for (const statement of statements) {
            const match = statement.match(/^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."([a-z_]+)"/i);
            if ((match && tables.includes(match[1])) || statement.startsWith('DO $payment_policy_columns$')) await query(statement);
        }
        namespaces = isolatedEvalNamespaceForPrisma(prisma);
        appointments = new AppointmentsService(prisma,effects as any,calendar as any,{ timezoneForSchema: async()=> 'America/Bogota' } as any);
        gyms = new GymsService(prisma); education = new EducationService(prisma);
        const slots = { acquireLockToken:async()=>randomUUID(),releaseLockToken:async()=>true,get:async()=>null,incr:async()=>1,expire:async()=>true };
        const control = new ToolExecutionControlService(prisma,{ get:()=> 'isolated-test-secret-length-32-characters' } as any,{} as any,slots as any);
        const args: any[] = Array(32).fill({});
        Object.assign(args,{0:prisma,1:slots,2:effects,13:gyms,14:education,21:control,22:{},31:appointments});
        executor = new (AIToolExecutorService as any)(...args);
    },30000);
    beforeEach(async () => {
        lease = await namespaces.provision(tenantId,source,tables);
        const q = (sql: string,params: any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        await q("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'eval','web_widget','Eval'),($2::uuid,'other','web_widget','Other')",[contactId,otherContact]);
        conversationId=(await q("INSERT INTO conversations(contact_id,channel_type,channel_account_id) VALUES($1::uuid,'web_widget','eval') RETURNING id",[contactId]))[0].id;
        await q("INSERT INTO persona_config(config_yaml,config_json,is_active) VALUES('{}',$1::jsonb,true)",[JSON.stringify({hours:{timezone:'America/Bogota'}})]);
        await q("INSERT INTO services(id,name,duration_minutes,max_concurrent,price,currency,payment_policy,deposit_percent) VALUES($1::uuid,'Service',30,1,100,'COP','none',NULL)",[serviceId]);
        await q("INSERT INTO courses(id,name,slug) VALUES($1::uuid,'Course','course')",[courseId]);
        await q("INSERT INTO course_cohorts(id,course_id,cohort_code,starts_at,max_capacity,available_seats,status) VALUES($1::uuid,$2::uuid,'COHORT',$3::date,1,1,'open')",[cohortId,courseId,date]);
        await q("INSERT INTO members(id,contact_id,status,class_credits_remaining) VALUES($1::uuid,$2::uuid,'active',2),($3::uuid,$4::uuid,'active',2)",[memberId,contactId,otherMember,otherContact]);
        await q("INSERT INTO fitness_classes(id,name,scheduled_at,max_capacity,available_spots,credits_required) VALUES($1::uuid,'Class',$2::timestamp,1,1,1)",[classId,`${date} 10:00`]);
    },30000);
    afterEach(async () => { if(lease) await namespaces.dispose(lease); lease=undefined; });
    afterAll(async () => {
        if(!pool) return;
        await query(`DROP TABLE ${(await query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[source])).map((r: any)=>`"${source}"."${r.tablename}"`).join(',')} RESTRICT`);
        await query(`DROP SCHEMA "${source}" RESTRICT`);
        await query('DELETE FROM public.tenants WHERE id=$1',[tenantId]);
        await pool.end();
    });
    const create = (time='10:00') => appointments.create(lease.schemaName,{contactId,conversationId,serviceId,serviceName:'Service',
        startAt:`${date}T${time}:00`,endAt:`${date}T${time.slice(0,2)}:30:00`,metadata:{source:'eval_gate'},customerName:'Eval'}, {suppressEffects:true,confirmWithoutPayment:true});
    it('uses real capacity transactions: concurrent appointments admit one and leave live rows untouched', async () => {
        const outcomes=await Promise.allSettled([create(),create()]);
        expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
        expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
        expect(effects.emit).not.toHaveBeenCalled();expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
    });
    it('preserves a deposit, pending status and hold instead of claiming confirmation', async()=>{
        await query(`UPDATE "${lease.schemaName}".services SET payment_policy='deposit',deposit_percent=25`);
        const result=await create();
        expect(result).toMatchObject({status:'pending_payment',awaitingPayment:true,amountDueToConfirm:25,currency:'COP'});
        expect(new Date(result.holdExpiresAt!).getTime()).toBeGreaterThan(Date.now());
        expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
    });
    it('rejects changed service terms inside the actual appointment transaction before inserting', async () => {
        const [row] = await query(`SELECT * FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]);
        const expected = appointmentServiceTerms(row);
        await query(`UPDATE "${lease.schemaName}".services SET price=150,payment_policy='deposit',deposit_percent=40 WHERE id=$1::uuid`, [serviceId]);
        await expect(appointments.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service', source: 'ai',
            startAt: `${date}T10:00:00`, endAt: `${date}T10:30:00`, metadata: { source: 'eval_gate' } },
        { expectedServiceTerms: expected, suppressEffects: true })).rejects.toBeInstanceOf(AppointmentTermsChangedError);
        expect((await query(`SELECT count(*)::int AS n FROM "${lease.schemaName}".appointments`))[0].n).toBe(0);
        const [fresh] = await query(`SELECT * FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]);
        const created = await appointments.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service', source: 'ai',
            startAt: `${date}T10:00:00`, endAt: `${date}T10:30:00`, metadata: { source: 'eval_gate' } },
        { expectedServiceTerms: appointmentServiceTerms(fresh), suppressEffects: true });
        expect(created).toMatchObject({ status: 'pending_payment', amountDueToConfirm: 60 });
    });
    it('holds material service terms against a concurrent owner edit until the appointment commits', async () => {
        const [row] = await query(`SELECT * FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]);
        const owner = await pool.connect(); const ownerPid = (await owner.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let ownerWrite: Promise<any> | undefined; let observedLock = false;
        const guarded = { ...prisma, transactionInTenantSchema: (schema: string, work: any) => prisma.transactionInTenantSchema(schema, (q: any) => work(async (sql: string, params: any[] = []) => {
            const rows = await q(sql, params);
            if (sql.includes('FROM services') && sql.includes('FOR SHARE') && !ownerWrite) {
                ownerWrite = owner.query(`UPDATE "${lease.schemaName}".services SET price=200 WHERE id=$1::uuid`, [serviceId]);
                for (let attempt = 0; attempt < 50; attempt++) {
                    const [wait] = await query('SELECT cardinality(pg_blocking_pids($1::int)) AS n', [ownerPid]);
                    if (wait.n > 0) { observedLock = true; break; }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                expect(observedLock).toBe(true);
            }
            return rows;
        })) };
        const command = new AppointmentsService(guarded, effects as any, calendar as any, { timezoneForSchema: async () => 'America/Bogota' } as any);
        try {
            const created = await command.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service', source: 'ai',
                startAt: `${date}T10:00:00`, endAt: `${date}T10:30:00`, metadata: { source: 'eval_gate' } },
            { expectedServiceTerms: appointmentServiceTerms(row), suppressEffects: true, confirmWithoutPayment: true });
            expect(created.status).toBe('confirmed'); await ownerWrite;
            expect(Number((await query(`SELECT price FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]))[0].price)).toBe(200);
            const target = PAYMENT_REFERENCE_TARGETS.appointment;
            const [payable] = await prisma.executeInTenantSchema(lease.schemaName,
                `SELECT ${target.amountExpression} AS amount, ${target.currencyExpression} AS currency
                 FROM appointments target ${target.join} WHERE target.id=$1::uuid`, [created.id]);
            expect(Number(payable.amount)).toBe(100); expect(payable.currency).toBe('COP');
            expect(created.metadata.serviceTerms.price).toBe(100);
            expect(observedLock).toBe(true);
        } finally { if (ownerWrite) await ownerWrite; owner.release(); }
    });
    it('rolls back invalid enrollment ownership and restores a seat exactly once after cancellation',async()=>{
        await expect(education.enrollStudent(lease.schemaName,{cohortId,contactId:randomUUID(),studentName:'Invalid'})).rejects.toThrow();
        const enrolled=await education.enrollStudent(lease.schemaName,{cohortId,contactId,studentName:'Eval'});
        await expect(education.enrollStudent(lease.schemaName,{cohortId,contactId:otherContact,studentName:'Other'})).rejects.toThrow();
        await education.cancelEnrollment(lease.schemaName,enrolled.id,{contactId});
        await education.cancelEnrollment(lease.schemaName,enrolled.id,{contactId});
        expect((await query(`SELECT available_seats,status FROM "${lease.schemaName}".course_cohorts`))[0]).toMatchObject({available_seats:1,status:'open'});
    });
    it('promotes the real gym waitlist and never charges or refunds credits twice',async()=>{
        const first=await gyms.bookClass(lease.schemaName,classId,memberId);
        const queued=await gyms.bookClass(lease.schemaName,classId,otherMember);
        expect(queued).toMatchObject({status:'waitlist',waitlisted:true});
        expect((await gyms.bookClass(lease.schemaName,classId,memberId)).id).toBe(first.id);
        await gyms.cancelBooking(lease.schemaName,first.id,contactId);
        await gyms.cancelBooking(lease.schemaName,first.id,contactId);
        expect((await query(`SELECT status FROM "${lease.schemaName}".class_bookings WHERE id=$1`,[queued.id]))[0].status).toBe('confirmed');
        expect((await query(`SELECT class_credits_remaining FROM "${lease.schemaName}".members WHERE id=$1`,[memberId]))[0].class_credits_remaining).toBe(2);
        expect((await query(`SELECT class_credits_remaining FROM "${lease.schemaName}".members WHERE id=$1`,[otherMember]))[0].class_credits_remaining).toBe(1);
    });
    it('rejects a forged namespace at the executor before a domain writer',async()=>{
        const result=await executor.execute(source,tenantId,contactId,'create_appointment',{serviceId,date,time:'10:00',customerName:'Eval'},conversationId,{
            authority:{source:'llm_turn',allowedTools:['create_appointment']} as any,executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        expect(result.error).toBeTruthy();
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
    });
    it('executes real confirmation, appointment creation, reschedule and cancellation with a local staff directory',async()=>{
        const staff=randomUUID();
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        await q("INSERT INTO __eval_ref_users(id,tenant_id,is_active,first_name,last_name) VALUES($1::uuid,$2::uuid,true,'Eval','Staff')",[staff,tenantId]);
        await q("INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time) VALUES($1::uuid,$2,'09:00','17:00')",[staff,new Date(`${date}T12:00Z`).getUTCDay()]);
        const invoke=(name:string,args:any)=>executor.execute(lease.schemaName,tenantId,contactId,name,args,conversationId,{
            authority:authorityFor(name),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const confirmed=async(name:string,args:any)=>{
            await inbound('Quiero realizar esta operación');
            const challenge=await invoke(name,args);
            expect(challenge).toMatchObject({error:'confirmation_required'});
            await inbound('Sí, confirmo');
            const result=await invoke(name,{...args,_control:{confirmationToken:challenge.confirmationToken}});
            expect(result.error).toBeUndefined();
            return result;
        };
        const slots=await invoke('check_availability',{date,serviceId,staffId:staff});
        expect(slots).toHaveProperty('slots');
        expect(slots.slots.some((slot:any)=>slot.time==='10:00')).toBe(true);
        const created=await confirmed('create_appointment',{serviceId,staffId:staff,date,time:'10:00',customerName:'Eval'});
        expect(created).toMatchObject({success:true,appointment:{status:'confirmed'}});
        const appointmentId=created.appointment.id;
        const moved=await confirmed('reschedule_appointment',{appointmentId,newDate:date,newTime:'11:00'});
        expect(moved).toMatchObject({success:true,appointment:{time:'11:00'}});
        const cancelled=await confirmed('cancel_appointment',{appointmentId});
        expect(cancelled.success).toBe(true);
        expect((await q('SELECT status FROM appointments WHERE id=$1::uuid',[appointmentId]))[0].status).toBe('cancelled');
        expect(effects.emit).not.toHaveBeenCalled();expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
    });
    it.each(['education','gym'])('routes %s tools through the real ledger and canonical commands, including retries',async(family)=>{
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const invoke=(name:string,args:any)=>executor.execute(lease.schemaName,tenantId,contactId,name,args,conversationId,{
            authority:authorityFor(name),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        const confirmed=async(name:string,args:any)=>{
            await inbound('Quiero esta operación');
            const challenge=await invoke(name,args);expect(challenge).toMatchObject({error:'confirmation_required'});
            await inbound('Sí, confirmo');
            const input={...args,_control:{confirmationToken:challenge.confirmationToken}};
            const result=await invoke(name,input);expect(result.error).toBeUndefined();
            expect(await invoke(name,input)).toMatchObject(result);
            return result;
        };
        if(family==='education') {
            await confirmed('enroll_student',{cohortId,studentName:'Eval'});
            const [row]=await q('SELECT id FROM enrollments');
            await confirmed('cancel_enrollment',{enrollmentId:row.id});
            expect((await q('SELECT available_seats FROM course_cohorts'))[0].available_seats).toBe(1);
        } else {
            await confirmed('book_class',{classId});
            const [row]=await q('SELECT id FROM class_bookings');
            await confirmed('cancel_class_booking',{bookingId:row.id});
            expect((await q('SELECT class_credits_remaining FROM members WHERE id=$1::uuid',[memberId]))[0].class_credits_remaining).toBe(2);
        }
    });
    it('prepares actual EvalSession fixtures in a new namespace and removes them even after lease loss',async()=>{
        let lost=false;const disposed:string[]=[];
        const redis={acquireLockToken:async()=>randomUUID(),renewLockToken:async()=>!lost,releaseLockToken:async()=>true};
        const service=new EvalService(prisma,{} as any,{} as any,redis as any,effects as any,undefined,namespaces);
        await expect(service.withSandboxSession(tenantId,async session=>{
            await session.reset('telegram');
            disposed.push(session.sandboxNamespace!.schemaName);
            expect(session.fixtures?.status).toBe('ready');
            const first=session.sandboxNamespace!;
            await session.recordInbound('Hola');
            expect((await query(`SELECT count(*)::int AS n FROM "${first.schemaName}".messages`))[0].n).toBe(1);
            await session.reset('telegram');disposed.push(session.sandboxNamespace!.schemaName);
            expect(session.sandboxNamespace!.schemaName).not.toBe(first.schemaName);
            expect((await query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[first.schemaName]))).toHaveLength(0);
            lost=true;await session.assertLease();
        })).rejects.toThrow('eval_sandbox_lease_lost');
        for(const schema of disposed) expect((await query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema]))).toHaveLength(0);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".contacts`))[0].n).toBe(0);
    });
    it('requires a later consent for waitlist when the confirmed seat was taken meanwhile',async()=>{
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const inbound=(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const invoke=(args:any)=>executor.execute(lease.schemaName,tenantId,contactId,'enroll_student',args,conversationId,{
            authority:authorityFor('enroll_student'),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        const args={cohortId,studentName:'Eval'};
        await inbound('Quiero matricularme');expect(await invoke(args)).toMatchObject({error:'confirmation_required',allowWaitlist:false,enrollmentTerms:{cohortId}});
        await education.enrollStudent(lease.schemaName,{cohortId,contactId:otherContact,studentName:'Other'});
        await inbound('Sí, confirmo');
        expect(await invoke(args)).toMatchObject({error:'cohort_full_waitlist_requires_consent',requiresConfirmation:true,persisted:false,waitlistAvailable:true});
        expect((await q('SELECT * FROM enrollments WHERE contact_id=$1::uuid',[contactId]))).toHaveLength(0);
        const waitlist={...args,allowWaitlist:true};
        expect(await invoke(waitlist)).toMatchObject({error:'confirmation_required',allowWaitlist:true});
        expect(await invoke(waitlist)).toMatchObject({error:'confirmation_required'});
        expect((await q('SELECT * FROM enrollments WHERE contact_id=$1::uuid',[contactId]))).toHaveLength(0);
        await inbound('Sí, confirmo');const joined=await invoke(waitlist);
        expect(joined).toMatchObject({status:'waitlisted',charged:false});expect(joined.payableReference).toBeNull();
        expect(await invoke(waitlist)).toMatchObject(joined);
        expect((await q('SELECT * FROM enrollments WHERE contact_id=$1::uuid',[contactId]))).toHaveLength(1);
        expect((await q('SELECT available_seats FROM course_cohorts'))[0].available_seats).toBe(0);
    });
    it('also provisions and cleans through the production Prisma transaction adapter',async()=>{
        // This constructor does not run Nest's startup/migration hooks. The URL
        // above has already been restricted to the explicit disposable database.
        const original=process.env.DATABASE_URL;
        process.env.DATABASE_URL=connection!;
        const real=new PrismaService();let target:any;
        try {
            await real.$connect();
            const manager=isolatedEvalNamespaceForPrisma(real);
            target=await manager.provision(tenantId,source,['contacts']);
            await manager.assertOwned(target);
            await real.executeInTenantSchema(target.schemaName,
                "INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'prisma-test','web_widget','Eval')",[randomUUID()]);
            expect((await real.executeInTenantSchema<any[]>(target.schemaName,'SELECT count(*)::int AS n FROM contacts'))[0].n).toBe(1);
            await manager.dispose(target);target=undefined;
        } finally {
            if(target) await isolatedEvalNamespaceForPrisma(real).dispose(target);
            await real.$disconnect();
            if(original===undefined) delete process.env.DATABASE_URL;else process.env.DATABASE_URL=original;
        }
    });
    it('persists a draft review without an appointment, then resumes the approved command exactly once',async()=>{
        const agentId=randomUUID();
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const config={behavior:{draftMode:true},hours:{timezone:'America/Bogota'},tools:{appointments:{enabled:true}}};
        await q("INSERT INTO agent_personas(id,name,is_active,config_json,version) VALUES($1::uuid,'Eval Agent',true,$2::jsonb,1)",[agentId,JSON.stringify(config)]);
        await q('UPDATE conversations SET agent_persona_id=$1::uuid WHERE id=$2::uuid',[agentId,conversationId]);
        // These are explicit test boundary adapters. All SQL, approval state
        // transitions and domain commands below are their production classes.
        const ownedPrisma={...prisma,getTenantSchemaName:async()=>lease.schemaName,
            tenant:{findUnique:async()=>({industry:'beauty',settings:{},operatingCountry:'CO'})}};
        const controls=new ToolExecutionControlService(ownedPrisma,{get:()=> 'isolated-test-secret-length-32-characters'} as any,{} as any,{get:async()=>null,incr:async()=>1,expire:async()=>true} as any);
        const args={serviceId,date,time:'10:00',customerName:'Eval'};
        const draftExecutor=Object.create(executor) as AIToolExecutorService;
        (draftExecutor as any).toolExecutionControl=controls;
        const propose=(input:any)=>draftExecutor.execute(lease.schemaName,tenantId,contactId,'create_appointment',input,conversationId,
            {authority:authorityFor('create_appointment'),evalMode:true,sandboxNamespace:lease,
                executionContext:{mode:'draft',persistence:'disabled'},draftScope:{agentId,agentVersion:1}});
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        await inbound('Quiero reservar');
        const challenge=await propose(args);
        expect(challenge).toMatchObject({error:'confirmation_required',service:{price:100}});
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(0);
        await inbound('Sí, confirmo');
        const proposal=await propose({...args,_control:{confirmationToken:challenge.confirmationToken}});
        expect(proposal).toMatchObject({error:'draft_action_requires_approval'});
        const [ticket]=await q('SELECT id,status FROM tool_approval_tickets');
        expect(ticket.status).toBe('pending');expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(0);
        await controls.decideApprovalTicket({tenantId,ticketId:ticket.id,actorId:randomUUID(),decision:'approved'});
        const commandPort={execute:(...input:any[])=>executor.execute(input[0],input[1],input[2],input[3],input[4],input[5],{
            ...input[6],evalMode:true,sandboxNamespace:lease,executionContext:AGENT_TEST_EXECUTION_CONTEXT,
        })};
        const workflow=new ToolApprovalWorkflowService(ownedPrisma,controls,commandPort as any,{emitAsync:async()=>{throw new Error('outbound_forbidden');}} as any,{} as any,
            {resolve:async()=>({authority:authorityFor('create_appointment'),status:{}})} as any,
            {getAgent:async()=>({id:agentId,is_active:true,config_json:config,version:1})} as any);
        const completed=await workflow.resumeApprovedTicket(tenantId,ticket.id);
        expect(completed).toMatchObject({state:'completed',result:{success:true}});
        expect(await workflow.resumeApprovedTicket(tenantId,ticket.id)).toMatchObject({state:'completed'});
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(1);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
        expect(effects.emit).not.toHaveBeenCalled();
    });
});
