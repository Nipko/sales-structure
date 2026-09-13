import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { ChatIdentityService } from './chat-identity.service';

const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
const describeDb=connection?describe:describe.skip;

describeDb('durable chat identity against PostgreSQL',()=>{
    jest.setTimeout(120_000);
    const tenantId=randomUUID(),contactId=randomUUID(),conversationId=randomUUID();
    const schema=`tenant_identity_${tenantId.replace(/-/g,'')}`;
    let admin:Client,prisma:any,service:ChatIdentityService;
    const smtp=jest.fn().mockResolvedValue('smtp.identity.1');
    const email={prepareBoundedSend:jest.fn().mockReturnValue(smtp)};
    const sms={send:jest.fn().mockResolvedValue({sent:true,sid:'SM_IDENTITY_1'})};

    beforeAll(async()=>{
        admin=new Client({connectionString:connection});await admin.connect();
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260914020000_add_durable_chat_identity_challenges/migration.sql'),'utf8'));
        prisma=new PrismaClient({datasources:{db:{url:connection}}});await prisma.$connect();
        prisma.transactionInTenantSchema=async(target:string,work:any)=>prisma.$transaction(async(tx:any)=>{
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${target}", public`);
            return work((sql:string,params:any[]=[])=>tx.$queryRawUnsafe(sql,...params));
        });
        await admin.query(`INSERT INTO tenants(id,schema_name,is_active,language,industry)
            VALUES($1::uuid,$2,true,'es','services')`,[tenantId,schema]);
        await admin.query(`CREATE SCHEMA "${schema}"`);
        await admin.query(`CREATE TABLE "${schema}".contacts(
            id UUID PRIMARY KEY,email TEXT,phone TEXT,phone_normalized TEXT,is_active BOOLEAN NOT NULL DEFAULT true)`);
        await admin.query(`INSERT INTO "${schema}".contacts(id,email,phone,phone_normalized)
            VALUES($1::uuid,'identity@example.test','+573001112233','+573001112233')`,[contactId]);
        service=new ChatIdentityService(prisma,email as any,sms as any,
            {phoneRegionFor:jest.fn().mockResolvedValue('CO')} as any);
    });

    afterAll(async()=>{
        await admin?.query('DELETE FROM tenants WHERE id=$1::uuid',[tenantId]).catch(()=>undefined);
        if(/^tenant_identity_[a-f0-9]{32}$/.test(schema))
            await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(()=>undefined);
        await prisma?.$disconnect();await admin?.end();
    });

    beforeEach(async()=>{
        jest.clearAllMocks();smtp.mockResolvedValue('smtp.identity.1');email.prepareBoundedSend.mockReturnValue(smtp);
        sms.send.mockResolvedValue({sent:true,sid:'SM_IDENTITY_1'});
        await admin.query('DELETE FROM chat_identity_challenges WHERE tenant_id=$1::uuid',[tenantId]);
        await admin.query(`UPDATE "${schema}".contacts SET email='identity@example.test',phone='+573001112233',
            phone_normalized='+573001112233',is_active=true WHERE id=$1::uuid`,[contactId]);
    });

    it('admits concurrent calls once and stores the SMTP receipt',async()=>{
        const args:[string,string,string,string,string]=[tenantId,schema,contactId,conversationId,'whatsapp'];
        const [a,b]=await Promise.all([service.startVerification(...args),service.startVerification(...args)]);
        expect([a.status,b.status]).toContain('sent');
        expect([a,b].find(result=>result.status==='sent')).toEqual(
            {status:'sent',via:'email',hint:'i***@example.test'});
        expect(smtp).toHaveBeenCalledTimes(1);
        const rows=(await admin.query(`SELECT state,provider_reference FROM chat_identity_challenges
            WHERE tenant_id=$1::uuid`,[tenantId])).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({state:'sent',provider_reference:'smtp.identity.1'});
    });

    it('keeps verification durable, contact-bound and limited to five guesses',async()=>{
        await service.startVerification(tenantId,schema,contactId,conversationId,'whatsapp');
        const row=(await admin.query(`SELECT id,code FROM chat_identity_challenges
            WHERE tenant_id=$1::uuid`,[tenantId])).rows[0];
        await expect(service.verifyCode(conversationId,row.code)).resolves.toEqual({ok:true});
        await expect(service.isVerified(conversationId,contactId)).resolves.toBe(true);
        await expect(service.isVerified(conversationId,randomUUID())).resolves.toBe(false);
        await expect(service.verifyCode(conversationId,row.code)).resolves.toEqual({ok:false,reason:'expired'});

        const nextConversation=randomUUID();
        await service.startVerification(tenantId,schema,contactId,nextConversation,'whatsapp');
        for(let attempt=1;attempt<=4;attempt+=1)
            await expect(service.verifyCode(nextConversation,'000000')).resolves.toEqual({ok:false,reason:'wrong'});
        await expect(service.verifyCode(nextConversation,'000000')).resolves.toEqual({ok:false,reason:'too_many'});
    });

    it('freezes an unanswered provider call and never retries it',async()=>{
        smtp.mockRejectedValueOnce(new Error('smtp_answer_lost'));
        await expect(service.startVerification(tenantId,schema,contactId,conversationId,'whatsapp'))
            .resolves.toEqual({status:'pending'});
        expect((await admin.query(`SELECT state FROM chat_identity_challenges
            WHERE tenant_id=$1::uuid`,[tenantId])).rows[0].state).toBe('reconciliation_required');
        await service.processDue();
        expect(smtp).toHaveBeenCalledTimes(1);
    });

    it('suppresses a challenge if the canonical destination changes before delivery',async()=>{
        email.prepareBoundedSend.mockImplementationOnce(()=>{throw new Error('smtp_preflight');});
        await service.startVerification(tenantId,schema,contactId,conversationId,'whatsapp');
        const id=(await admin.query(`SELECT id FROM chat_identity_challenges WHERE tenant_id=$1::uuid`,[tenantId])).rows[0].id;
        await admin.query(`UPDATE "${schema}".contacts SET email='changed@example.test' WHERE id=$1::uuid`,[contactId]);
        await expect(service.deliver(id)).resolves.toBe('identity:suppressed');
        expect(smtp).not.toHaveBeenCalled();
    });
});
