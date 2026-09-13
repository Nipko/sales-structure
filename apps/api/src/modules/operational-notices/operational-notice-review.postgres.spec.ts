import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OperationalNoticeReviewService } from './operational-notice-review.service';
import { OperationalNoticeService } from './operational-notice.service';
import { eraseOperationalContactNotices } from './operational-notice-erasure';
import type { NoticeReviewInput } from './operational-notice-review.contracts';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const url=process.env.OPERATIONAL_NOTICE_REVIEW_TEST_DATABASE_URL;
(url?describe:describe.skip)('Operational notice review on PostgreSQL with the Prisma adapter',()=>{
    const tenantId=randomUUID(),schema=`tenant_notice_review_${randomUUID().replace(/-/g,'')}`,contactId=randomUUID(),conversationId=randomUUID();
    const admin=randomUUID(),supervisor=randomUUID(),agent=randomUUID(),foreign=randomUUID(),superAdmin=randomUUID(),otherContact=randomUUID();
    let client:PrismaClient,prisma:PrismaService,service:OperationalNoticeReviewService,noticeId:string;
    const sql=(text:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,text,params);
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,schema);
        for(const [id,role,owner] of [[admin,'tenant_admin',tenantId],[supervisor,'tenant_supervisor',tenantId],[agent,'tenant_agent',tenantId],[foreign,'tenant_admin',randomUUID()],[superAdmin,'super_admin',null]])
            await client.$executeRawUnsafe("INSERT INTO public.users(id,role,tenant_id,is_active,first_name,last_name) VALUES($1::uuid,$2,$3::uuid,true,'Synthetic','Reviewer')",id,role,owner);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        Object.defineProperty(prisma,'tenant',{value:{findUnique:async({where}:any)=>where.id===tenantId?{id:tenantId,schemaName:schema,isActive:true,isInternal:true,onboardingCompletedAt:new Date()}:null}});
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY,name TEXT)');
        await sql('CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID,channel_type TEXT)');
        await sql('CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID,external_id TEXT,direction TEXT,status TEXT,metadata JSONB)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ DEFAULT NOW())');
        const ddl=readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        const block=ddl.slice(ddl.indexOf('-- BEGIN OPERATIONAL NOTICE REVIEW'),ddl.indexOf('-- END OPERATIONAL NOTICE REVIEW'));
        if(!block.includes('CREATE TABLE IF NOT EXISTS'))throw new Error('notice_review_canonical_schema_missing');
        for(const statement of (PrismaService.prototype as any).splitSqlStatements(block.replace(/\{\{SCHEMA_NAME\}\}/g,schema)))
            await client.$executeRawUnsafe(statement);
        await sql("INSERT INTO contacts VALUES($1::uuid,'Synthetic contact'),($2::uuid,'Other contact')",[contactId,otherContact]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'web_widget')",[conversationId,contactId]);
        service=new OperationalNoticeReviewService(prisma,{get:async()=>null} as any);
        await service.list(tenantId); // Executes production DDL/migration and Prisma serialization.
    });
    beforeEach(async()=>{
        await sql('DELETE FROM operational_notice_outbox');await sql('DELETE FROM messages');await sql('DELETE FROM customer_memory_erasure');
        noticeId=randomUUID();
        await sql(`INSERT INTO operational_notice_outbox(id,event_key,kind,entity_id,contact_id,conversation_id,state,route,error_code)
            VALUES($1::uuid,$2,'education.waitlist_promoted',$3::uuid,$4::uuid,$5::uuid,'reconciliation_required','telegram','notice_delivery_outcome_unknown')`,
        [noticeId,randomUUID(),randomUUID(),contactId,conversationId]);
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_notice_review_[a-f0-9]{32}$/.test(schema))throw new Error('cleanup_scope_invalid');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.users WHERE id=ANY($1::uuid[])',[admin,supervisor,agent,foreign,superAdmin]);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        }finally{await client.$disconnect();}
    });
    const input=async(action:NoticeReviewInput['action']='observe'):Promise<NoticeReviewInput>=>({action,expectedRevision:(await service.detail(tenantId,noticeId)).revision,
        idempotencyKey:randomUUID(),reason:'Reviewed the provider dashboard',humanReference:'Human-reported receipt reference'});
    const noSend=async(expected:string)=>{
        const prepare=jest.fn(()=>{throw new Error('sending_from_review_forbidden');});
        const runtime=new OperationalNoticeService(prisma,{get:async()=>null} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any);
        expect(await runtime.deliver({tenantId,noticeId},{prepare})).toBe(`notice:${expected}`);expect(prepare).not.toHaveBeenCalled();
    };
    const widgetReceipt=async(received=false,owner=contactId)=>{
        await sql("UPDATE operational_notice_outbox SET route='web_widget'");
        const externalId=`widget:outbound:${createHash('sha256').update(`${tenantId}:${conversationId}:operational:${noticeId}`).digest('hex')}`;
        await sql('UPDATE conversations SET contact_id=$1::uuid WHERE id=$2::uuid',[owner,conversationId]);
        await sql('INSERT INTO messages VALUES($1::uuid,$2::uuid,$3,\'outbound\',$4,$5::jsonb)',[randomUUID(),conversationId,externalId,received?'delivered':'pending',
            JSON.stringify({channel:'web_widget',source:'ai',widgetSessionId:randomUUID(),...(received?{widgetReceivedAt:new Date().toISOString()}:{})})]);
    };
    it('records human observations without turning their reference into verified delivery',async()=>{
        const result=await service.review(tenantId,noticeId,supervisor,await input());
        expect(result.notice).toMatchObject({state:'reconciliation_required',verification:{status:'unknown'},latestReview:{action:'observe'}});
        const detail=await service.detail(tenantId,noticeId);expect(detail.reviews[0]).toMatchObject({actor_id:supervisor,actor_name:'Synthetic Reviewer',human_reference:'Human-reported receipt reference'});
        await noSend('reconciliation_required');
    });
    it('enforces current roles and tenant ownership; only admins may suppress',async()=>{
        const request=await input('suppress');
        await expect(service.review(tenantId,noticeId,supervisor,request)).rejects.toThrow('notice_suppression_forbidden');
        await expect(service.review(tenantId,noticeId,supervisor,{...request,action:'verify'})).rejects.toThrow('notice_resolution_forbidden');
        for(const actor of [agent,foreign])await expect(service.review(tenantId,noticeId,actor,request)).rejects.toThrow('notice_review_forbidden');
        expect((await sql('SELECT COUNT(*)::int AS n FROM operational_notice_reviews'))[0].n).toBe(0);
        expect((await service.review(tenantId,noticeId,superAdmin,request)).notice.state).toBe('suppressed');
        await noSend('suppressed');
    });
    it('serializes identical retries once and rejects changed payloads or stale revisions',async()=>{
        const request=await input();
        const replies=await Promise.all([service.review(tenantId,noticeId,admin,request),service.review(tenantId,noticeId,admin,request)]);
        expect(replies.filter(reply=>reply.idempotentReplay)).toHaveLength(1);
        expect((await sql('SELECT review_revision FROM operational_notice_outbox'))[0].review_revision).toBe(1);
        await expect(service.review(tenantId,noticeId,admin,{...request,reason:'A different observation'})).rejects.toThrow('notice_review_idempotency_conflict');
        await expect(service.review(tenantId,noticeId,admin,{...request,idempotencyKey:randomUUID()})).rejects.toThrow('notice_revision_changed');
    });
    it('recovers the same suppression after it completed without admitting another send',async()=>{
        const request=await input('suppress');
        const first=await service.review(tenantId,noticeId,admin,request);
        const replay=await service.review(tenantId,noticeId,admin,request);
        expect(replay).toMatchObject({reviewId:first.reviewId,idempotentReplay:true,notice:{state:'suppressed'}});
        expect((await sql('SELECT COUNT(*)::int AS n FROM operational_notice_reviews'))[0].n).toBe(1);await noSend('suppressed');
    });
    it('rolls back the review record and outcome together when the transaction fails, then recovers',async()=>{
        const request=await input('suppress'),faulty=Object.create(prisma);
        faulty.transactionInTenantSchema=(name:string,work:any)=>prisma.transactionInTenantSchema(name,query=>work(async(text:string,params:any[])=>{
            const rows=await query(text,params);if(text.startsWith('UPDATE operational_notice_outbox SET state=$2'))throw new Error('forced_storage_failure');return rows;
        }));
        await expect(new OperationalNoticeReviewService(faulty,{get:async()=>null} as any).review(tenantId,noticeId,admin,request)).rejects.toThrow('forced_storage_failure');
        expect((await sql('SELECT COUNT(*)::int AS n FROM operational_notice_reviews'))[0].n).toBe(0);
        expect((await service.detail(tenantId,noticeId)).state).toBe('reconciliation_required');
        expect((await service.review(tenantId,noticeId,admin,request)).notice.state).toBe('suppressed');
    });
    it('permits only one of two concurrent decisions on the same version',async()=>{
        const first=await input(),second={...first,idempotencyKey:randomUUID(),action:'suppress'};
        const results=await Promise.allSettled([service.review(tenantId,noticeId,admin,first),service.review(tenantId,noticeId,admin,second)]);
        expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
        expect((await sql('SELECT COUNT(*)::int AS n FROM operational_notice_reviews'))[0].n).toBe(1);
    });
    it('revalidates a concurrent worker outcome before suppression and preserves provider acceptance separately',async()=>{
        const request=await input('suppress');let release!:()=>void,entered!:()=>void;
        const hold=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);
        const worker=prisma.transactionInTenantSchema(schema,async query=>{
            await query("UPDATE operational_notice_outbox SET state='sent',provider_reference='synthetic-provider-accepted' WHERE id=$1::uuid",[noticeId]);
            entered();await hold;
        });
        await ready;const reviewing=service.review(tenantId,noticeId,admin,request);release();await worker;
        await expect(reviewing).rejects.toThrow('notice_revision_changed');
        expect(await service.detail(tenantId,noticeId)).toMatchObject({state:'sent',verification:{status:'provider_accepted'}});
    });
    it('reconciles an existing local Web Chat message without sending or creating another message',async()=>{
        await widgetReceipt();
        const result=await service.review(tenantId,noticeId,admin,await input('verify'));
        expect(result.notice).toMatchObject({state:'stored',verification:{status:'web_stored'}});
        expect((await sql('SELECT COUNT(*)::int AS n FROM messages'))[0].n).toBe(1);await noSend('stored');
    });
    it('distinguishes the stored message from browser receipt and rejects a foreign owner',async()=>{
        await widgetReceipt(true);
        expect((await service.detail(tenantId,noticeId)).verification).toMatchObject({status:'web_received',source:'widget_message'});
        await sql('UPDATE conversations SET contact_id=$1::uuid',[otherContact]);
        expect((await service.detail(tenantId,noticeId)).verification.status).toBe('unknown');
        await sql('UPDATE conversations SET contact_id=$1::uuid',[contactId]);
    });
    it('keeps unavailable external verification unknown and requires an exact conversation filter',async()=>{
        const result=await service.review(tenantId,noticeId,admin,await input('verify'));
        expect(result.notice).toMatchObject({state:'reconciliation_required',verification:{status:'unknown'}});
        expect((await service.list(tenantId,{conversationId:randomUUID()})).items).toEqual([]);
        expect((await service.list(tenantId,{conversationId})).items).toHaveLength(1);
        await expect(service.detail(tenantId,randomUUID())).rejects.toThrow('notice_not_found');
        await noSend('reconciliation_required');
    });
    it('retains the privacy fence during review and redacts history without resurrecting it on retry',async()=>{
        const request=await input();let release!:()=>void,entered!:()=>void;
        const hold=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);
        const guarded=Object.create(prisma);guarded.transactionInTenantSchema=(name:string,work:any)=>prisma.transactionInTenantSchema(name,query=>work(async(sql:string,params:any[])=>{
            const rows=await query(sql,params);if(sql.includes('FROM operational_notice_outbox n WHERE')&&sql.includes('FOR UPDATE')){entered();await hold;}return rows;
        }));
        const reviewing=new OperationalNoticeReviewService(guarded,{get:async()=>null} as any).review(tenantId,noticeId,admin,request);await ready;
        try{await prisma.transactionInTenantSchema(schema,async query=>expect((await query<any[]>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]))[0].acquired).toBe(false));}
        finally{release();}
        await reviewing;
        await prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            await query('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contactId]);
            await eraseOperationalContactNotices(query,schema,[contactId]);
        });
        const detail=await service.detail(tenantId,noticeId);expect(detail).toMatchObject({contact_id:null,entity_id:null,conversation_id:null,latestReview:null,reviews:[],verification:{status:'unknown'}});
        expect((await sql('SELECT reason,human_reference,evidence FROM operational_notice_reviews'))[0]).toEqual({reason:'notice_contact_erased',human_reference:null,evidence:{}});
        await expect(service.review(tenantId,noticeId,admin,request)).rejects.toThrow('notice_contact_erased');await noSend('suppressed');
    });
});
