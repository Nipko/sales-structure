import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { AgentAvailabilityService } from './agent-availability.service';
import { OperationalNoticeService } from '../operational-notices/operational-notice.service';

const databaseUrl=process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl?describe:describe.skip)('durable handoff SLA escalation on PostgreSQL',()=>{
    jest.setTimeout(120_000);
    const tenantId=randomUUID(),schema=`tenant_sla_${randomUUID().replace(/-/g,'')}`;
    const contactId=randomUUID(),conversationId=randomUUID(),adminId=randomUUID(),supervisorId=randomUUID(),inactiveId=randomUUID();
    let client:PrismaClient,prisma:any;
    const query=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(schema,sql,params);
    const events={emit:jest.fn()};

    beforeAll(async()=>{
        const parsed=new URL(databaseUrl!);
        if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:databaseUrl});
        await ensureSyntheticGlobalTables(sql=>client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',tenantId,schema,'es');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".contacts(id UUID PRIMARY KEY,name TEXT,phone TEXT,email TEXT)`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".conversations(id UUID PRIMARY KEY,contact_id UUID,status TEXT,assigned_to TEXT,metadata JSONB NOT NULL DEFAULT '{}',updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id UUID,direction TEXT,metadata JSONB DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ DEFAULT NOW())`);
        for(const [id,email,role,active] of [[adminId,'admin@example.com','tenant_admin',true],[supervisorId,'supervisor@example.com','tenant_supervisor',true],[inactiveId,'inactive@example.com','tenant_admin',false]] as const)
            await client.$executeRawUnsafe('INSERT INTO public.users(id,tenant_id,email,role,is_active) VALUES($1::uuid,$2::uuid,$3,$4,$5)',id,tenantId,email,role,active);
        prisma=Object.create(PrismaService.prototype);
        prisma.$transaction=client.$transaction.bind(client);prisma.$queryRawUnsafe=client.$queryRawUnsafe.bind(client);prisma.$executeRawUnsafe=client.$executeRawUnsafe.bind(client);
        prisma.tenant={findUnique:async()=>({id:tenantId,schemaName:schema,isActive:true,onboardingCompletedAt:new Date(),language:'es'}),findMany:async()=>[{id:tenantId,schemaName:schema,language:'es'}]};
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            await client.$executeRawUnsafe('DELETE FROM public.users WHERE id=ANY($1::uuid[])',[adminId,supervisorId,inactiveId]);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid',tenantId);
            if(!/^tenant_sla_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        }finally{await client.$disconnect();}
    });
    beforeEach(async()=>{
        events.emit.mockClear();
        const exists=await client.$queryRawUnsafe<any[]>('SELECT to_regclass($1)::text AS name',`${schema}.operational_notice_outbox`);
        if(exists[0]?.name)await query('TRUNCATE operational_notice_outbox');
        await query('TRUNCATE messages,conversations,contacts CASCADE');
        await query("INSERT INTO contacts(id,name,phone) VALUES($1::uuid,'Ana','+573001112233')",[contactId]);
        await query(`INSERT INTO conversations(id,contact_id,status,assigned_to,metadata) VALUES($1::uuid,$2::uuid,'waiting_human',$3,$4::jsonb)`,[
            conversationId,contactId,randomUUID(),JSON.stringify({handoff:{startedAt:new Date(Date.now()-10*60000).toISOString(),reason:'customer_request'}})]);
    });
    const run=(target=prisma)=> (new AgentAvailabilityService(target,events as any,{} as any) as any).processEscalations(tenantId,schema,'es');

    it('commits the escalation flag and exactly one intent per active supervisor',async()=>{
        await run();await run();
        const rows=await query('SELECT * FROM operational_notice_outbox ORDER BY recipient_user_id');
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map((row:any)=>row.recipient_user_id))).toEqual(new Set([adminId,supervisorId]));
        expect(rows[0]).toMatchObject({kind:'handoff.sla_escalated',entity_id:conversationId,contact_id:contactId,state:'pending'});
        expect((await query('SELECT metadata FROM conversations'))[0].metadata.handoff.escalated).toBe(true);
        expect(events.emit).toHaveBeenCalledTimes(1);
        const hydrated=await (OperationalNoticeService.prototype as any).hydrate.call({prisma,widget:{}},query,schema,tenantId,rows.find((row:any)=>row.recipient_user_id===adminId));
        expect(hydrated).toMatchObject({route:'email',email:'admin@example.com'});
        expect(hydrated.subject).toContain('Ana');expect(hydrated.html).toContain('+573001112233');
    });
    it('rolls back the flag when the delivery intents cannot be stored',async()=>{
        const rejecting=Object.create(PrismaService.prototype);
        rejecting.$transaction=client.$transaction.bind(client);rejecting.$queryRawUnsafe=client.$queryRawUnsafe.bind(client);rejecting.$executeRawUnsafe=client.$executeRawUnsafe.bind(client);
        const original=rejecting.transactionInTenantSchema.bind(rejecting);
        rejecting.transactionInTenantSchema=(target:string,work:any,options?:any)=>original(target,(execute:any)=>work(async(sql:string,params:any[]=[])=>{
            if(sql.includes('INSERT INTO operational_notice_outbox'))throw new Error('forced_notice_storage_failure');return execute(sql,params);
        }),options);
        await run(rejecting);
        expect((await query('SELECT metadata FROM conversations'))[0].metadata.handoff.escalated).toBeUndefined();
        expect(await query('SELECT * FROM operational_notice_outbox')).toHaveLength(0);
    });
    it('suppresses a pending email once a human has answered',async()=>{
        await run();const [row]=await query('SELECT * FROM operational_notice_outbox WHERE recipient_user_id=$1::uuid',[adminId]);
        await query("INSERT INTO messages(conversation_id,direction,metadata) VALUES($1::uuid,'outbound','{\"source\":\"agent\"}'::jsonb)",[conversationId]);
        await expect((OperationalNoticeService.prototype as any).hydrate.call({prisma,widget:{}},query,schema,tenantId,row))
            .rejects.toMatchObject({code:'notice_domain_state_changed'});
    });
});
