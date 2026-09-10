import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { EducationEnrollmentCommands } from '../education/education-enrollment-commands';
import { GymsService } from '../gyms/gyms.service';
import { AppointmentPaymentListener } from '../appointments/appointment-payment.listener';
import { OperationalNoticeService } from './operational-notice.service';
import { ensureOperationalNoticeOutbox, enqueueOperationalNotice } from './operational-notice-outbox';
import { PAYMENT_REFERENCE_TARGETS } from '../tenant-payments/tenant-payment-reference';
import { WidgetService } from '../widget/widget.service';
import { WidgetMessageStore } from '../widget/widget-message-store.service';
import { eraseOperationalContactNotices } from './operational-notice-erasure';
import { noticeReceiptEvidence } from './operational-notice-review.contracts';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
(connection?describe:describe.skip)('operational notices and canonical waitlists on disposable PostgreSQL',()=>{
    const tenantId=randomUUID(),schema=`tenant_notice_${randomUUID().replace(/-/g,'')}`;
    const contacts=[randomUUID(),randomUUID(),randomUUID()],members=[randomUUID(),randomUUID(),randomUUID()];
    const courseId=randomUUID(),cohortId=randomUUID(),classId=randomUUID(),serviceId=randomUUID();
    const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    let pool:any,prisma:any,education:EducationEnrollmentCommands,gym:GymsService,notices:OperationalNoticeService,queue:any,send:any,transport:any;
    const tables=['customer_profiles','contact_identities','contacts','conversations','messages','persona_config','agent_personas','courses','campaigns','companies','leads','opportunities',
        'pipelines','pipeline_stages','deals','services','service_staff','calendar_integrations','appointments','calendar_sync_outbox','availability_slots','blocked_dates',
        'membership_plans','members','fitness_classes','class_bookings','course_cohorts','enrollments'];
    const raw=async(sql:string,params:any[]=[]) => (await pool.query(sql,params)).rows;
    const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(schema,sql,params);
    beforeAll(async()=>{
        const url=new URL(connection!);
        if(!['127.0.0.1','localhost'].includes(url.hostname)||!isDisposableDatabaseUrl(url))throw new Error('disposable_database_required');
        pool=new Pool({connectionString:connection});
        await raw(`CREATE SCHEMA "${schema}"`);
        await raw('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',[tenantId,schema]);
        prisma={
            transactionInTenantSchema:async(s:string,work:any)=>{
                if(s!==schema)throw new Error('foreign_schema');
                const client=await pool.connect();await client.query('BEGIN');
                try{
                    await client.query(`SET LOCAL search_path TO "${schema}",public`);
                    await client.query("SET LOCAL statement_timeout='8s'");
                    const result=await work(async(sql:string,params:any[]=[]) => (await client.query(sql,params)).rows);
                    await client.query('COMMIT');return result;
                }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
            },
            executeInTenantSchema:(s:string,sql:string,params:any[]=[])=>prisma.transactionInTenantSchema(s,(query:any)=>query(sql,params)),
            getTenantSchemaName:async()=>schema,
            $queryRawUnsafe:(sql:string,...params:any[])=>raw(sql,params),
            tenant:{findUnique:async({where}:any)=>where.id===tenantId?{id:tenantId,schemaName:schema,isActive:true,onboardingCompletedAt:new Date(),isInternal:true,language:'es'}:null,
                findMany:async()=>[{id:tenantId,schemaName:schema}]},
        };
        const ddl=readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8').replace(/\{\{SCHEMA_NAME\}\}/g,schema);
        for(const statement of (PrismaService.prototype as any).splitSqlStatements(ddl)){
            const match=statement.match(/^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."([a-z_]+)"/i);
            if((match&&tables.includes(match[1]))||statement.startsWith('DO $payment_policy_columns$'))await raw(statement);
        }
        await ensureOperationalNoticeOutbox(prisma,schema);
        await q('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL');
        await q('CREATE TABLE customer_memory_erasure(contact_id uuid PRIMARY KEY,erased_at timestamptz DEFAULT now())');
        education=new EducationEnrollmentCommands(prisma);gym=new GymsService(prisma);
    },30000);
    beforeEach(async()=>{
        await q('DELETE FROM operational_notice_outbox');await q('DELETE FROM calendar_sync_outbox');await q('DELETE FROM appointments');
        await q('DELETE FROM calendar_integrations');
        await q('DELETE FROM enrollments');await q('DELETE FROM class_bookings');await q('DELETE FROM members');await q('DELETE FROM fitness_classes');
        await q('DELETE FROM course_cohorts');await q('DELETE FROM courses');await q('DELETE FROM services');
        if((await raw("SELECT to_regclass('public.widget_sessions')::text AS name"))[0].name)await raw('DELETE FROM public.widget_sessions WHERE tenant_id=$1::uuid',[tenantId]);
        if((await raw("SELECT to_regclass('public.widget_configs')::text AS name"))[0].name)await raw('DELETE FROM public.widget_configs WHERE tenant_id=$1::uuid',[tenantId]);
        await q('DELETE FROM messages');await q('DELETE FROM conversations');await q('DELETE FROM contacts');await q('DELETE FROM customer_memory_erasure');
        for(let i=0;i<contacts.length;i++){
            await q("INSERT INTO contacts(id,external_id,channel_type,name,email) VALUES($1::uuid,$2,'telegram',$3,$4)",[contacts[i],`synthetic-${i}`,`Student ${i}`,`student${i}@example.invalid`]);
            await q("INSERT INTO conversations(contact_id,channel_type,channel_account_id,status) VALUES($1::uuid,'telegram','synthetic-account','active')",[contacts[i]]);
            await q("INSERT INTO members(id,contact_id,status,class_credits_remaining) VALUES($1::uuid,$2::uuid,'active',3)",[members[i],contacts[i]]);
        }
        await q("INSERT INTO courses(id,name,slug,price,currency) VALUES($1::uuid,'Course','course',100,'COP')",[courseId]);
        await q("INSERT INTO course_cohorts(id,course_id,cohort_code,starts_at,max_capacity,available_seats,status) VALUES($1::uuid,$2::uuid,'GROUP',$3::date,1,1,'open')",[cohortId,courseId,date]);
        await q("INSERT INTO fitness_classes(id,name,scheduled_at,max_capacity,available_spots,credits_required) VALUES($1::uuid,'Class',$2::timestamp,1,1,1)",[classId,`${date} 10:00`]);
        await q("INSERT INTO services(id,name,duration_minutes,max_concurrent,price,currency) VALUES($1::uuid,'Service',30,1,100,'COP')",[serviceId]);
        queue={getJob:jest.fn().mockResolvedValue(null),add:jest.fn().mockResolvedValue({id:'job'})};
        send=jest.fn().mockResolvedValue('provider-accepted');transport={prepare:jest.fn().mockImplementation(async()=>send)};
        notices=new OperationalNoticeService(prisma,{get:async()=>null} as any,{getPriority:async()=>2} as any,{} as any,{} as any,{} as any,{} as any,queue);
    });
    afterAll(async()=>{
        if(!pool)return;
        if((await raw("SELECT to_regclass('public.widget_sessions')::text AS name"))[0].name)await raw('DELETE FROM public.widget_sessions WHERE tenant_id=$1::uuid',[tenantId]);
        if((await raw("SELECT to_regclass('public.widget_configs')::text AS name"))[0].name)await raw('DELETE FROM public.widget_configs WHERE tenant_id=$1::uuid',[tenantId]);
        const ownTables=await raw('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema]);
        if(ownTables.length)await raw(`DROP TABLE ${ownTables.map((r:any)=>`"${schema}"."${r.tablename}"`).join(',')} RESTRICT`);
        await raw(`DROP SCHEMA "${schema}" RESTRICT`);await raw('DELETE FROM public.users WHERE tenant_id=$1::uuid',[tenantId]);await raw('DELETE FROM public.tenants WHERE id=$1::uuid',[tenantId]);await pool.end();
    });
    const enroll=(index:number,allowWaitlist=false)=>education.enroll(schema,{cohortId,contactId:contacts[index],studentName:`Student ${index}`,allowWaitlist});
    const noticeRows=()=>q('SELECT * FROM operational_notice_outbox ORDER BY created_at,id');
    const deliver=async(id:string)=>notices.deliver({tenantId,noticeId:id},transport);
    async function paidAppointment(){
        return (await q(`INSERT INTO appointments(contact_id,service_id,service_name,start_at,end_at,status,payment_status)
            VALUES($1::uuid,$2::uuid,'Service',$3::timestamp,$4::timestamp,'pending_payment','paid') RETURNING *`,[contacts[0],serviceId,`${date} 12:00`,`${date} 12:30`]))[0];
    }
    it('preserves frozen price and never exposes a payment target while waiting',async()=>{
        const first=await enroll(0);await expect(enroll(1)).rejects.toThrow('cohort_full_waitlist_requires_consent');
        const waiter=await enroll(1,true);expect(waiter).toMatchObject({status:'waitlisted',seatAssigned:false,charged:false});
        await q('UPDATE courses SET price=900 WHERE id=$1::uuid',[courseId]);
        const target=PAYMENT_REFERENCE_TARGETS.enrollment;
        const [price]=await q(`SELECT ${target.amountExpression} AS price,${target.currencyExpression} AS currency FROM enrollments target WHERE id=$1::uuid`,[first.id]);
        expect(Number(price.price)).toBe(100);expect(price.currency).toBe('COP');expect(target.rejectedStatuses).toContain('waitlisted');
        expect((await q('SELECT available_seats FROM course_cohorts'))[0].available_seats).toBe(0);
    });
    it('promotes FIFO once under cancellation/replay and commits the notice with the seat',async()=>{
        const first=await enroll(0),second=await enroll(1,true);await enroll(2,true);
        const cancelled=await Promise.all([education.cancel(schema,first.id),education.cancel(schema,first.id)]);
        expect(cancelled.filter(r=>r.alreadyCancelled)).toHaveLength(1);
        expect((await q('SELECT status,payment_status FROM enrollments WHERE id=$1::uuid',[second.id]))[0]).toMatchObject({status:'enrolled',payment_status:'pending'});
        const rows=await noticeRows();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind:'education.waitlist_promoted',entity_id:second.id,state:'pending'});
        expect(await deliver(rows[0].id)).toBe('notice:sent');expect(send).toHaveBeenCalledTimes(1);
        expect(await deliver(rows[0].id)).toBe('notice:sent');expect(send).toHaveBeenCalledTimes(1);
    });
    it('requires fresh consent after course terms change without taking a seat',async()=>{
        const first=await enroll(0),waiter=await enroll(1,true);
        const prior=await education.getTerms(schema,cohortId);await q('UPDATE courses SET price=150 WHERE id=$1::uuid',[courseId]);
        await education.cancel(schema,first.id);
        expect((await q('SELECT status FROM enrollments WHERE id=$1::uuid',[waiter.id]))[0].status).toBe('waitlist_review');
        expect((await q('SELECT available_seats FROM course_cohorts'))[0].available_seats).toBe(1);
        await expect(education.enroll(schema,{cohortId,contactId:contacts[1],studentName:'Student',enrollmentTerms:prior})).rejects.toThrow('enrollment_terms_changed');
        const fresh=await enroll(1);expect(fresh).toMatchObject({id:waiter.id,status:'enrolled',charged:false});
        expect(fresh.metadata.enrollmentTerms.price).toBe('150.00');
        expect(await deliver((await noticeRows())[0].id)).toBe('notice:suppressed');expect(send).not.toHaveBeenCalled();
    });
    it('rolls cancellation and promotion back when their durable event cannot be written',async()=>{
        const first=await enroll(0),waiter=await enroll(1,true);
        const faulty={...prisma,transactionInTenantSchema:(s:string,work:any)=>prisma.transactionInTenantSchema(s,(query:any)=>work((sql:string,p:any[])=>{
            if(sql.startsWith('INSERT INTO operational_notice_outbox'))throw new Error('notice_storage_failed');return query(sql,p);
        }))};
        await expect(new EducationEnrollmentCommands(faulty).cancel(schema,first.id)).rejects.toThrow('notice_storage_failed');
        expect((await q('SELECT status FROM enrollments WHERE id=$1::uuid',[first.id]))[0].status).toBe('enrolled');
        expect((await q('SELECT status FROM enrollments WHERE id=$1::uuid',[waiter.id]))[0].status).toBe('waitlisted');expect(await noticeRows()).toHaveLength(0);
        await education.cancel(schema,first.id);expect(await noticeRows()).toHaveLength(1);
    });
    it('promotes gym bookings with one credit deduction and suppresses a later cancellation',async()=>{
        const first=await gym.bookClass(schema,classId,members[0]),second=await gym.bookClass(schema,classId,members[1]);
        await Promise.all([gym.cancelBooking(schema,first.id),gym.cancelBooking(schema,first.id)]);
        expect((await q('SELECT class_credits_remaining FROM members WHERE id=$1::uuid',[members[1]]))[0].class_credits_remaining).toBe(2);
        const rows=await noticeRows();expect(rows).toHaveLength(1);expect(rows[0].entity_id).toBe(second.id);
        await gym.cancelBooking(schema,second.id);expect(await deliver(rows[0].id)).toBe('notice:suppressed');expect(send).not.toHaveBeenCalled();
    });
    it('commits paid appointment and notices even when Redis enqueue is unavailable',async()=>{
        const appointment=await paidAppointment();queue.add.mockRejectedValueOnce(new Error('redis_unavailable'));
        const listener=new AppointmentPaymentListener(prisma,{emit:jest.fn()} as any,notices);
        await listener.onPaid({tenantId,kind:'appointment',entityId:appointment.id});
        expect((await q('SELECT status,calendar_sync_state FROM appointments WHERE id=$1::uuid',[appointment.id]))[0]).toMatchObject({status:'confirmed',calendar_sync_state:'not_configured'});
        const rows=await noticeRows();expect(rows).toHaveLength(1);expect(rows[0].state).toBe('pending');
        await notices.recoverTenant(tenantId);
        expect(queue.add.mock.calls[1][1]).toEqual({operationalNotice:{tenantId,noticeId:rows[0].id}});
        await listener.onPaid({tenantId,kind:'appointment',entityId:appointment.id});expect(await noticeRows()).toHaveLength(1);
        expect(await deliver(rows[0].id)).toBe('notice:sent');
    });
    it('does not guess that historical confirmations were never delivered',async()=>{
        const appointment=await paidAppointment();await q("UPDATE appointments SET status='confirmed' WHERE id=$1::uuid",[appointment.id]);
        await new AppointmentPaymentListener(prisma,{emit:jest.fn()} as any,notices).onPaid({tenantId,kind:'appointment',entityId:appointment.id});
        const [row]=await noticeRows();expect(row).toMatchObject({state:'reconciliation_required',error_code:'historical_delivery_unverified'});
        expect(await deliver(row.id)).toBe('notice:reconciliation_required');expect(send).not.toHaveBeenCalled();
    });
    it('rolls back appointment, calendar revision and customer event together, then recovers each once',async()=>{
        const user=randomUUID();await raw('INSERT INTO public.users(id,tenant_id,is_active) VALUES($1::uuid,$2::uuid,true)',[user,tenantId]);
        await q("INSERT INTO calendar_integrations(user_id,provider,encrypted_refresh_token,assignment_type) VALUES($1::uuid,'google','synthetic-never-used','general')",[user]);
        const appointment=await paidAppointment();
        const faulty={...prisma,transactionInTenantSchema:(s:string,work:any)=>prisma.transactionInTenantSchema(s,(query:any)=>work((sql:string,p:any[])=>{
            if(sql.startsWith('INSERT INTO operational_notice_outbox'))throw new Error('notice_storage_failed');return query(sql,p);
        }))};
        await new AppointmentPaymentListener(faulty,{emit:jest.fn()} as any).onPaid({tenantId,kind:'appointment',entityId:appointment.id});
        expect((await q('SELECT status FROM appointments WHERE id=$1::uuid',[appointment.id]))[0].status).toBe('pending_payment');
        expect(await q('SELECT * FROM calendar_sync_outbox')).toHaveLength(0);expect(await noticeRows()).toHaveLength(0);
        const listener=new AppointmentPaymentListener(prisma,{emit:jest.fn()} as any);
        await listener.reconcilePaidAppointments();await listener.onPaid({tenantId,kind:'appointment',entityId:appointment.id});
        expect(await q('SELECT * FROM calendar_sync_outbox')).toHaveLength(1);expect(await noticeRows()).toHaveLength(1);
        expect((await q('SELECT calendar_sync_revision,status FROM appointments WHERE id=$1::uuid',[appointment.id]))[0]).toMatchObject({calendar_sync_revision:1,status:'confirmed'});
    });
    it('stores Web Chat notice and delivery state together, with replay and receipt separated',async()=>{
        const publicDDL=readFileSync(resolve(__dirname,'../widget/widget.service.ts'),'utf8');
        for(const table of ['widget_configs','widget_sessions']){
            const start=publicDDL.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`),end=publicDDL.indexOf('`',start);await raw(publicDDL.slice(start,end));
        }
        const widget=(await raw("INSERT INTO public.widget_configs(tenant_id,widget_id,allowed_domains,locale) VALUES($1::uuid,$2,'{example.test}','es') RETURNING *",[tenantId,`wgt_${randomUUID()}`]))[0];
        const redis:any={get:async()=>null,set:async()=>{},del:async()=>{}};
        const throttle:any={getPlanFeatures:async()=>({widget:true}),getPriority:async()=>2},config:any={get:()=> 'test-widget-notice-secret-length-32',getOrThrow:()=> 'test-widget-notice-secret-length-32'};
        const relay:any={publish:jest.fn()};const store=new WidgetMessageStore(prisma,redis,relay,throttle,config);
        const session=await new WidgetService(prisma,redis,config,throttle).createSession(widget,{visitorId:'notice-test'});
        const credentials={token:session.token,origin:'https://shop.example.test'},binding=await store.ensureConversation(credentials);
        const first=await enroll(0);
        await education.enroll(schema,{cohortId,contactId:binding.contact_id,studentName:'Widget learner',allowWaitlist:true});
        await education.cancel(schema,first.id);const [row]=await noticeRows();
        const target=new OperationalNoticeService(prisma,redis,throttle,store,{} as any,{} as any,{} as any,queue);
        const finish=jest.spyOn(target as any,'finish').mockRejectedValueOnce(new Error('write_failed'));
        await expect(target.deliver({tenantId,noticeId:row.id},transport)).rejects.toThrow();
        expect(await q("SELECT * FROM messages WHERE direction='outbound'")).toHaveLength(0);
        finish.mockRestore();await q("UPDATE operational_notice_outbox SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1::uuid",[row.id]);
        await target.recoverTenant(tenantId);
        expect(await target.deliver({tenantId,noticeId:row.id},transport)).toBe('notice:stored');
        expect(await target.deliver({tenantId,noticeId:row.id},transport)).toBe('notice:stored');
        const rows=await q("SELECT * FROM messages WHERE direction='outbound'");expect(rows).toHaveLength(1);expect(rows[0].status).toBe('pending');
        expect(send).not.toHaveBeenCalled();expect(relay.publish).toHaveBeenCalledTimes(1);
        expect(await noticeReceiptEvidence(q,tenantId,(await noticeRows())[0])).toMatchObject({status:'web_stored',source:'widget_message'});
        const history=await store.withSessionMessages(credentials,{history:true},async(_s,items)=>items);expect(history).toHaveLength(1);
        expect(await store.acknowledge(credentials,rows[0].id)).toBe(true);
        expect((await q('SELECT status FROM messages WHERE id=$1::uuid',[rows[0].id]))[0].status).toBe('delivered');
        expect((await noticeRows())[0].state).toBe('stored');
        expect(await noticeReceiptEvidence(q,tenantId,(await noticeRows())[0])).toMatchObject({status:'web_received',source:'widget_message',messageId:rows[0].id});
    });
    it('does not resend an ambiguous provider attempt and retries only a pre-send failure',async()=>{
        const first=await enroll(0);await enroll(1,true);await education.cancel(schema,first.id);const [row]=await noticeRows();
        transport.prepare.mockRejectedValueOnce(new Error('credentials_temporarily_unavailable'));
        await expect(deliver(row.id)).rejects.toThrow('operational_notice_retry');expect((await noticeRows())[0].state).toBe('failed');expect(send).not.toHaveBeenCalled();
        send.mockRejectedValueOnce(new Error('network_timeout_after_send'));
        expect(await deliver(row.id)).toBe('notice:reconciliation_required');expect(await deliver(row.id)).toBe('notice:reconciliation_required');expect(send).toHaveBeenCalledTimes(1);
    });
    it('honors erasure and rejects cross-contact conversation bindings before transport',async()=>{
        const first=await enroll(0);await enroll(1,true);await education.cancel(schema,first.id);const [row]=await noticeRows();
        const [foreign]=await q('SELECT id FROM conversations WHERE contact_id=$1::uuid',[contacts[2]]);
        await q('UPDATE operational_notice_outbox SET conversation_id=$2::uuid WHERE id=$1::uuid',[row.id,foreign.id]);
        expect(await deliver(row.id)).toBe('notice:suppressed');expect((await noticeRows())[0].error_code).toBe('notice_conversation_binding_changed');
        await q("UPDATE operational_notice_outbox SET state='pending',conversation_id=NULL WHERE id=$1::uuid",[row.id]);
        await q('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contacts[1]]);
        expect(await deliver(row.id)).toBe('notice:suppressed');expect((await noticeRows())[0].error_code).toBe('notice_contact_erased');expect(send).not.toHaveBeenCalled();
    });
    it('keeps the privacy fence through provider acceptance so erasure cannot overtake a send',async()=>{
        const first=await enroll(0);await enroll(1,true);await education.cancel(schema,first.id);const [row]=await noticeRows();
        let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let entered:()=>void=()=>{};const ready=new Promise<void>(resolve=>{entered=resolve;});
        send.mockImplementationOnce(async()=>{entered();await gate;return 'accepted';});
        const running=deliver(row.id);await ready;const eraser=await pool.connect();
        try{await eraser.query('BEGIN');await expect(eraser.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`])).resolves.toMatchObject({rows:[{acquired:false}]});}
        finally{await eraser.query('ROLLBACK');eraser.release();release();}
        expect(await running).toBe('notice:sent');
    });
    it('executes the durable education path through the production Prisma adapter',async()=>{
        const prior=process.env.DATABASE_URL;process.env.DATABASE_URL=connection!;const real=new PrismaService();
        try{
            await real.$connect();
            const runtime={transactionInTenantSchema:real.transactionInTenantSchema.bind(real),executeInTenantSchema:real.executeInTenantSchema.bind(real),tenant:prisma.tenant};
            const command=new EducationEnrollmentCommands(runtime as any);
            const first=await command.enroll(schema,{cohortId,contactId:contacts[0],studentName:'First'});
            await command.enroll(schema,{cohortId,contactId:contacts[1],studentName:'Second',allowWaitlist:true});
            await command.cancel(schema,first.id);const [row]=await noticeRows();
            const delivery=new OperationalNoticeService(runtime as any,{get:async()=>null} as any,{} as any,{} as any,{} as any,{} as any,{} as any,queue);
            expect(await delivery.deliver({tenantId,noticeId:row.id},transport)).toBe('notice:sent');
            expect((await noticeRows())[0].provider_reference).toBe('provider-accepted');
        }finally{await real.$disconnect();if(prior===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=prior;}
    });
    it('erases all delivery bindings under the privacy fence and cannot recover the old queued reference',async()=>{
        const first=await enroll(0);await enroll(1,true);await education.cancel(schema,first.id);const [row]=await noticeRows();
        await prisma.transactionInTenantSchema(schema,async(query:any)=>{
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            expect(await eraseOperationalContactNotices(query,schema,[contacts[1]])).toBe(1);
        });
        expect((await noticeRows())[0]).toMatchObject({state:'suppressed',contact_id:null,conversation_id:null,provider_reference:null});
        await notices.recoverTenant(tenantId);expect(queue.add).not.toHaveBeenCalled();
        expect(await deliver(row.id)).toBe('notice:suppressed');expect(send).not.toHaveBeenCalled();
    });
    it.each(['web_widget','telegram'])('recovers an expired %s lease according to whether an external effect was possible',async route=>{
        const first=await enroll(0);await enroll(1,true);await education.cancel(schema,first.id);const [row]=await noticeRows();
        await q("UPDATE operational_notice_outbox SET state='processing',route=$2,lease_token=$3::uuid,lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1::uuid",[row.id,route,randomUUID()]);
        const retry=jest.fn();queue.getJob.mockResolvedValue({getState:async()=> 'completed',retry});
        await notices.recoverTenant(tenantId);
        expect((await noticeRows())[0].state).toBe(route==='web_widget'?'queued':'reconciliation_required');
        if(route==='web_widget')expect(retry).toHaveBeenCalledWith('completed');else expect(retry).not.toHaveBeenCalled();
        expect(queue.add).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
    });
    it('keeps email configuration failure retryable and an attempted SMTP timeout uncertain',async()=>{
        const first=await enroll(0);await enroll(1,true);await education.cancel(schema,first.id);const [row]=await noticeRows();
        await q('DELETE FROM conversations WHERE contact_id=$1::uuid',[contacts[1]]);
        const smtp=jest.fn().mockRejectedValue(new Error('smtp_deadline_outcome_unknown'));
        const email={prepareBoundedSend:jest.fn().mockImplementationOnce(()=>{throw new Error('smtp_not_configured');}).mockImplementation(()=>smtp)};
        const target=new OperationalNoticeService(prisma,{get:async()=>null} as any,{} as any,{} as any,email as any,{} as any,{} as any,queue);
        await expect(target.deliver({tenantId,noticeId:row.id},transport)).rejects.toThrow('operational_notice_retry');expect(smtp).not.toHaveBeenCalled();
        expect(await target.deliver({tenantId,noticeId:row.id},transport)).toBe('notice:reconciliation_required');
        expect(await target.deliver({tenantId,noticeId:row.id},transport)).toBe('notice:reconciliation_required');
        expect(smtp).toHaveBeenCalledTimes(1);expect(transport.prepare).not.toHaveBeenCalled();
    });
});
