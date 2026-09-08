import { randomUUID } from 'crypto';
import { ToolExecutionControlService } from './tool-execution-control.service';
import { ToolApprovalEffectsService } from './tool-approval-effects.service';
import { APPROVAL_EFFECTS_EVENT } from './tool-approval-effects.contracts';
import { HandoffService } from '../handoff/handoff.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('durable approval delivery against disposable PostgreSQL', () => {
    const tenantId = randomUUID(), schema = `tenant_effects_${randomUUID().replace(/-/g, '')}`;
    let pool: any, prisma: any, controls: ToolExecutionControlService, service: ToolApprovalEffectsService;
    let contact: string, conversation: string;
    const queue = { enqueueApprovedEffect: jest.fn() }, handoff = { executeHandoff: jest.fn(), prepareDelivery: jest.fn() };
    const q = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;
    const tx = async (_schema: string, work: any) => {
        if (_schema !== schema) throw new Error('unexpected_schema');
        const client = await pool.connect();
        try {
            await client.query('BEGIN'); await client.query(`SET LOCAL search_path TO "${schema}",public`);
            const result = await work(async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows);
            await client.query('COMMIT'); return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const scoped = (sql: string, params: any[] = []) => tx(schema, (query: any) => query(sql, params));
    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/parallly_eval_isolation')) throw new Error('disposable_eval_database_required');
        pool = new (require('pg').Pool)({ connectionString: connection });
        await q(`CREATE SCHEMA "${schema}"`);
        await q('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',[tenantId,schema]);
        await scoped('CREATE TABLE contacts(id UUID PRIMARY KEY,external_id TEXT,channel_type TEXT,name TEXT,phone TEXT)');
        await scoped('CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),channel_type TEXT,channel_account_id TEXT,status TEXT,metadata JSONB,updated_at TIMESTAMPTZ,assigned_to UUID)');
        await scoped('CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID,direction TEXT,content_text TEXT,metadata JSONB,created_at TIMESTAMPTZ)');
        await scoped('CREATE TABLE internal_notes(conversation_id UUID,agent_id UUID,content TEXT,created_at TIMESTAMPTZ)');
        prisma = { transactionInTenantSchema: tx, executeInTenantSchema: (_schema: string, sql: string, params: any[]) => tx(_schema,(query: any)=>query(sql,params)),
            getTenantSchemaName: async () => schema,
            tenant: { findUnique: async ({ where }: any) => {
                const row=(await q('SELECT schema_name,is_active FROM public.tenants WHERE id=$1::uuid',[where.id]))[0];
                return row ? {schemaName:row.schema_name,isActive:row.is_active} : null;
            } } };
        controls = new ToolExecutionControlService(prisma,{ get:()=> 'disposable-effects-test-secret-32' } as any,{} as any,{} as any);
        await (controls as any).ensureControlTables(schema);
        await scoped('CREATE TABLE payment_operation_ledger(id UUID PRIMARY KEY,execution_ledger_id UUID,operation_kind TEXT,status TEXT,response_payload JSONB)');
        service = new ToolApprovalEffectsService(prisma,queue as any,handoff as any);
    });
    beforeEach(async () => {
        queue.enqueueApprovedEffect.mockReset(); handoff.executeHandoff.mockReset();
        contact=randomUUID();conversation=randomUUID();
        await scoped("INSERT INTO contacts(id,external_id,channel_type) VALUES($1::uuid,'synthetic-recipient','whatsapp')",[contact]);
        await scoped("INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status) VALUES($1::uuid,$2::uuid,'whatsapp','synthetic-channel','active')",[conversation,contact]);
    });
    afterAll(async () => {
        if(!pool) return;
        const tables=await q('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema]);
        if(tables.length) await q(`DROP TABLE ${tables.map((row: any)=>`"${schema}"."${row.tablename}"`).join(',')} RESTRICT`);
        await q(`DROP SCHEMA "${schema}" RESTRICT`);
        await q('DELETE FROM public.tenants WHERE id=$1::uuid',[tenantId]); await pool.end();
    });
    async function complete(tool='send_product_image', result: any={success:true,_mediaToSend:[{url:'https://media.example.test/photo.png',caption:'Synthetic caption'}]}) {
        const ledger=randomUUID(),ticket=randomUUID(),lease=randomUUID();
        await scoped(`INSERT INTO tool_execution_ledger(id,idempotency_key,tool_name,args_hash,assurance_level,status,contact_id,conversation_id,channel_type,response_payload)
            VALUES($1::uuid,$2,$3,$4,'A4','succeeded',$5::uuid,$6::uuid,'whatsapp',$7::jsonb)`,[ledger,randomUUID(),tool,'a'.repeat(64),contact,conversation,JSON.stringify(result)]);
        await scoped(`INSERT INTO tool_approval_tickets(id,execution_ledger_id,tool_name,contact_id,conversation_id,status,expires_at,resume_state,resume_lease_token)
            VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,'approved',NOW()+INTERVAL '1 day','processing',$6::uuid)`,[ticket,ledger,tool,contact,conversation,lease]);
        const claim={tenantId,schemaName:schema,ticketId:ticket,leaseToken:lease,toolName:tool,contactId:contact,conversationId:conversation,args:{}};
        await controls.finishApprovalResume(claim,{forgedCallerResult:true});
        const effects=await scoped('SELECT * FROM tool_approval_effects WHERE ticket_id=$1::uuid',[ticket]);
        return {reference:{tenantId,ticketId:ticket,effectId:effects[0]?.id},claim,ledger,effects};
    }
    const state=async(id:string)=>(await scoped('SELECT state,error_code,attempts FROM tool_approval_effects WHERE id=$1::uuid',[id]))[0];

    it('atomically commits effect references and an IDs-only outbox with the trusted command result',async()=>{
        const {reference,claim}=await complete();
        const events=await scoped('SELECT payload FROM tool_approval_outbox WHERE ticket_id=$1::uuid AND event_type=$2',[reference.ticketId,APPROVAL_EFFECTS_EVENT]);
        expect(events).toEqual([{payload:{ticketId:reference.ticketId}}]);
        await controls.finishApprovalResume(claim,{});
        expect((await scoped('SELECT id FROM tool_approval_effects WHERE ticket_id=$1::uuid',[reference.ticketId]))).toHaveLength(1);
        await service.schedule(tenantId,reference.ticketId);
        expect(queue.enqueueApprovedEffect).toHaveBeenCalledWith(reference);
        const list=await controls.listApprovalTickets({tenantId,conversationId:conversation});
        expect(list[0]).toMatchObject({executionStatus:'succeeded',deliveryState:'queued',deliveryEffects:[{kind:'media',state:'queued'}]});
    });
    it('hydrates at send time, records provider acceptance, and never resends a completed effect',async()=>{
        const {reference}=await complete();const send=jest.fn(async()=> 'provider-ack');const prepare=jest.fn(async()=>send);
        await service.deliver(reference,{prepare});await service.deliver(reference,{prepare});
        expect(send).toHaveBeenCalledTimes(1);
        expect((prepare.mock.calls as any)[0][0]).toMatchObject({to:'synthetic-recipient',content:{mediaUrl:'https://media.example.test/photo.png'}});
        expect(await state(reference.effectId)).toMatchObject({state:'sent',attempts:1});
    });
    it('suppresses a queued delivery after contact erasure without hydrating or sending',async()=>{
        const {reference}=await complete();await service.schedule(tenantId,reference.ticketId);
        await scoped('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contact]);
        const prepare=jest.fn();await service.deliver(reference,{prepare});expect(prepare).not.toHaveBeenCalled();
        expect(await state(reference.effectId)).toMatchObject({state:'suppressed'});
    });
    it('marks a provider timeout uncertain and refuses replay, while a preflight failure can safely retry',async()=>{
        const {reference}=await complete();const send=jest.fn(async()=>{throw new Error('provider timeout with possible acceptance');});
        await service.deliver(reference,{prepare:async()=>send});await service.deliver(reference,{prepare:async()=>send});
        expect(send).toHaveBeenCalledTimes(1);expect(await state(reference.effectId)).toMatchObject({state:'reconciliation_required'});
        const retry=await complete();await expect(service.deliver(retry.reference,{prepare:async()=>{throw new Error('credentials temporarily unavailable');}})).rejects.toThrow('preflight');
        expect(await state(retry.reference.effectId)).toMatchObject({state:'failed'});
        await service.deliver(retry.reference,{prepare:async()=>async()=> 'ack'});
        expect(await state(retry.reference.effectId)).toMatchObject({state:'sent',attempts:2});
    });
    it('does not rerun a canonical handoff after it committed routing but its notification failed',async()=>{
        const {reference}=await complete('create_insurance_claim',{success:true,shouldHandoff:true});
        handoff.executeHandoff.mockImplementation(async()=>{
            await scoped("UPDATE conversations SET status='waiting_human' WHERE id=$1::uuid",[conversation]);
            throw new Error('notification failed after routing committed');
        });
        await service.deliver(reference,{prepare:async()=>async()=>null});await service.deliver(reference,{prepare:async()=>async()=>null});
        expect(handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect((await scoped('SELECT status FROM conversations WHERE id=$1::uuid',[conversation]))[0].status).toBe('waiting_human');
        expect(await state(reference.effectId)).toMatchObject({state:'reconciliation_required'});
    });
    it('requires a matching canonical payment operation before delivering a payment URL',async()=>{
        const operationId=randomUUID(),paymentLink='https://pay.example.test/canonical';
        const result={linkCreated:true,operationId,paymentLink,paymentStatus:'pending',paid:false};
        const {reference,ledger}=await complete('create_payment_link',result);
        await scoped("INSERT INTO payment_operation_ledger VALUES($1::uuid,$2::uuid,'payment_link','succeeded',$3::jsonb)",[operationId,ledger,JSON.stringify(result)]);
        const send=jest.fn(async()=> 'ack');await service.deliver(reference,{prepare:async outbound=>{expect(outbound.content.text).toBe(paymentLink);return send;}});
        expect(send).toHaveBeenCalledTimes(1);
        const forged=await complete('create_payment_link',{...result,operationId:randomUUID(),paymentLink:'https://pay.example.test/forged'});
        await service.deliver(forged.reference,{prepare:async()=>send});expect(send).toHaveBeenCalledTimes(1);
        expect(await state(forged.reference.effectId)).toMatchObject({state:'suppressed',error_code:'approval_effect_payment_link_unverified'});
    });
    it('reconciles a crashed worker lease instead of blindly retrying its side effect',async()=>{
        const {reference}=await complete();await scoped("UPDATE tool_approval_effects SET state='processing',lease_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1::uuid",[reference.effectId]);
        const prepare=jest.fn();await service.deliver(reference,{prepare});
        expect(prepare).not.toHaveBeenCalled();expect(await state(reference.effectId)).toMatchObject({state:'reconciliation_required'});
    });
    it('rechecks conversation identity before any delivery',async()=>{
        const {reference}=await complete();await scoped("UPDATE conversations SET channel_type='telegram' WHERE id=$1::uuid",[conversation]);
        const prepare=jest.fn();await service.deliver(reference,{prepare});expect(prepare).not.toHaveBeenCalled();
        expect(await state(reference.effectId)).toMatchObject({state:'suppressed',error_code:'approval_effect_binding_changed'});
    });
    it('holds the erasure fence through provider work and releases it after commit',async()=>{
        const {reference}=await complete();
        const tryErasure=async()=>tx(schema,async(query:any)=>(await query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]))[0].acquired);
        await service.deliver(reference,{prepare:async()=>async()=>{
            expect(await tryErasure()).toBe(false);
            return 'ack';
        }});
        expect(await tryErasure()).toBe(true);
    });
    it.each(['success','template_timeout','provider_false'])('uses actual canonical handoff and lazy schema preparation: %s',async(outcome)=>{
        const {reference}=await complete('create_insurance_claim',{success:true,shouldHandoff:true});
        const redis:any={get:async()=>null,set:async()=>{},del:async()=>{}};
        const events=new EventEmitter2();const notified=jest.fn(async()=>{});
        // One event per destination now: an aggregate flag could not say which of
        // six consumers had run, so a failure in one re-announced to all.
        for(const destination of ['inbox','crm','webhooks','push','slack','sms'])
            events.on(`handoff.escalated.${destination}`,notified);
        const localPrisma={...prisma,$queryRaw:async()=>[],$queryRawUnsafe:async()=>[],user:{findFirst:async()=>null},
            tenant:{findUnique:async(args:any)=>args.select.billingEmail ? {billingEmail:'synthetic@example.test'} : prisma.tenant.findUnique(args)}};
        const fallback=jest.fn(async()=>{if(outcome==='provider_false')throw new Error('timeout');});
        const templates={renderAndPrepare:async()=>{
            if(outcome==='template_timeout')throw new Error('timeout');
            return async()=>{if(outcome==='provider_false')throw new Error('smtp_acceptance_unverified');return 'smtp-id';};
        }};
        const canonical=new HandoffService(localPrisma as any,redis,events,{send:fallback} as any,templates as any,
            {execute:async()=>({content:'{}'})} as any,new AiResolutionService(prisma,redis),{} as any);
        const realService=new ToolApprovalEffectsService(prisma,queue as any,canonical);
        await realService.deliver(reference,{prepare:async()=>async()=>null});
        await realService.deliver(reference,{prepare:async()=>async()=>null});
        expect(await state(reference.effectId)).toMatchObject({state:outcome==='success'?'completed':'reconciliation_required',attempts:1});
        expect(fallback).not.toHaveBeenCalled();
        expect((await scoped('SELECT status,was_handed_off FROM conversations WHERE id=$1::uuid',[conversation]))[0]).toEqual({status:'waiting_human',was_handed_off:true});
        expect(await scoped('SELECT content FROM internal_notes WHERE conversation_id=$1::uuid',[conversation])).toHaveLength(1);
        expect(notified).toHaveBeenCalledTimes(6);
    },15000);
});
