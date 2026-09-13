import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { PlatformNotificationOutboxService } from '../platform-notifications/platform-notification-outbox.service';
import { AuthService } from './auth.service';

const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
const describeDb=connection?describe:describe.skip;

describeDb('durable platform two-factor SMS against PostgreSQL',()=>{
    jest.setTimeout(120_000);
    const userId=randomUUID();
    let admin:Client,prisma:any,delivery:PlatformNotificationOutboxService;
    const twilio=jest.fn().mockResolvedValue('SM_AUTH_1');
    const platformSms={prepareBoundedSend:jest.fn().mockResolvedValue(twilio)};

    beforeAll(async()=>{
        admin=new Client({connectionString:connection});await admin.connect();
        await ensureSyntheticGlobalTables(sql=>admin.query(sql));
        for(const name of ['20260913180000_add_platform_notification_outbox',
            '20260913190000_extend_platform_notifications_for_billing',
            '20260913210000_add_durable_auth_access_emails','20260913220000_add_durable_auth_security_notices',
            '20260914000000_add_durable_meta_compliance_requests','20260914030000_add_durable_auth_sms_notifications'])
            await admin.query(readFileSync(join(__dirname,`../../../prisma/migrations/${name}/migration.sql`),'utf8'));
        prisma=new PrismaClient({datasources:{db:{url:connection}}});await prisma.$connect();
        delivery=new PlatformNotificationOutboxService(prisma,
            {prepareBoundedSend:jest.fn()} as any,{get:jest.fn()} as any,
            {runExclusive:jest.fn(async(_k:string,_t:number,work:any)=>work())} as any,platformSms as any);
    });

    afterAll(async()=>{
        await admin?.query('DELETE FROM users WHERE id=$1::uuid',[userId]).catch(()=>undefined);
        await prisma?.$disconnect();await admin?.end();
    });

    beforeEach(async()=>{
        jest.clearAllMocks();twilio.mockResolvedValue('SM_AUTH_1');platformSms.prepareBoundedSend.mockResolvedValue(twilio);
        await admin.query('DELETE FROM platform_notification_outbox WHERE recipient_user_id=$1::uuid',[userId]);
        await admin.query(`INSERT INTO users(id,email,first_name,last_name,phone,is_active,
                two_factor_sms_code,two_factor_sms_expires,two_factor_sms_revision)
            VALUES($1::uuid,'sms-auth@example.test','Sms','User','+573001112233',true,'123456',NOW()+INTERVAL '5 minutes',1)
            ON CONFLICT(id) DO UPDATE SET phone=EXCLUDED.phone,is_active=true,two_factor_sms_code='123456',
                two_factor_sms_expires=NOW()+INTERVAL '5 minutes',two_factor_sms_revision=1`,[userId]);
    });

    async function insert(revision=1):Promise<string>{
        const id=randomUUID();
        await admin.query(`INSERT INTO platform_notification_outbox(
            id,event_key,kind,entity_id,recipient_user_id,recipient_phone,payload,state)
            VALUES($1::uuid,$2,'auth.access_code_sms',$3::uuid,$3::uuid,'+573001112233',$4::jsonb,'pending')`,
        [id,`auth:test:${id}`,userId,JSON.stringify({revision,sourcePhone:'+573001112233'})]);
        return id;
    }

    it('stores the Twilio SID and cannot send the same revision twice',async()=>{
        const id=await insert();
        await expect(delivery.deliver(id)).resolves.toBe('notification:sent');
        await expect(delivery.deliver(id)).resolves.toBe('notification:sent');
        expect(twilio).toHaveBeenCalledTimes(1);
        expect((await admin.query(`SELECT state,provider_reference FROM platform_notification_outbox
            WHERE id=$1::uuid`,[id])).rows[0]).toMatchObject({state:'sent',provider_reference:'SM_AUTH_1'});
    });

    it('freezes an unanswered Twilio POST and the sweep never repeats it',async()=>{
        const id=await insert();twilio.mockRejectedValueOnce(new Error('answer_lost'));
        await expect(delivery.deliver(id)).rejects.toThrow('answer_lost');
        expect((await admin.query(`SELECT state FROM platform_notification_outbox WHERE id=$1::uuid`,[id]))
            .rows[0].state).toBe('reconciliation_required');
        await delivery.processDue();expect(twilio).toHaveBeenCalledTimes(1);
    });

    it('suppresses the delivery if the user changed their canonical phone',async()=>{
        const id=await insert();
        await admin.query("UPDATE users SET phone='+573009999999' WHERE id=$1::uuid",[userId]);
        await expect(delivery.deliver(id)).resolves.toBe('notification:suppressed');
        expect(twilio).not.toHaveBeenCalled();
    });

    it('admits the code revision and its SMS intent in one transaction',async()=>{
        const auth:any=Object.create(AuthService.prototype);
        auth.prisma=prisma;auth.platformNotifications=delivery;auth.logger={warn:jest.fn()};
        await expect(auth.issueAccessCodeSms(userId,'+573001112233','+573001112233',300)).resolves.toBe(true);
        const row=(await admin.query(`SELECT o.state,o.provider_reference,u.two_factor_sms_revision
            FROM platform_notification_outbox o JOIN users u ON u.id=o.recipient_user_id
            WHERE o.recipient_user_id=$1::uuid ORDER BY o.created_at DESC LIMIT 1`,[userId])).rows[0];
        expect(row).toMatchObject({state:'sent',provider_reference:'SM_AUTH_1',two_factor_sms_revision:2});
    });
});
