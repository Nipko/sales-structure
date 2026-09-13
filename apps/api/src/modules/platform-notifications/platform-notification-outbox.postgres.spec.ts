import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { FeatureRequestsService } from '../feature-requests/feature-requests.service';
import { PlatformNotificationOutboxService } from './platform-notification-outbox.service';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;

(url ? describe : describe.skip)('platform notification outbox — feature request status', () => {
    const requestId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const subscriberA = randomUUID();
    const subscriberB = randomUUID();
    let client: PrismaClient;
    let prisma: any;
    let admin: Client;

    beforeAll(async () => {
        admin = new Client({ connectionString: url });
        await admin.connect();
        await ensureSyntheticGlobalTables(sql => admin.query(sql));
        await admin.query(`CREATE TABLE IF NOT EXISTS feature_requests(
            id UUID PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open',declined_reason TEXT,status_revision INTEGER NOT NULL DEFAULT 0,
            author_user_id UUID,shipped_at TIMESTAMP,created_at TIMESTAMP DEFAULT NOW(),updated_at TIMESTAMP DEFAULT NOW())`);
        await admin.query('ALTER TABLE feature_requests ADD COLUMN IF NOT EXISTS status_revision INTEGER NOT NULL DEFAULT 0');
        await admin.query(`CREATE TABLE IF NOT EXISTS feature_request_subscribers(
            id UUID PRIMARY KEY,request_id UUID NOT NULL,user_id UUID NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),UNIQUE(request_id,user_id))`);
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260913180000_add_platform_notification_outbox/migration.sql'),'utf8'));
        await admin.query(`INSERT INTO users(id,email,first_name,last_name,is_active)
            VALUES($1::uuid,$2,'Ana','A',true),($3::uuid,$4,'Beto','B',true)`,
        [userA,`a-${userA}@example.test`,userB,`b-${userB}@example.test`]);
        await admin.query(`INSERT INTO feature_requests(id,title,description,status,author_user_id,status_revision)
            VALUES($1::uuid,'<Mejor tablero>','','open',$2::uuid,0)`,[requestId,userA]);
        await admin.query(`INSERT INTO feature_request_subscribers(id,request_id,user_id)
            VALUES($1::uuid,$2::uuid,$3::uuid),($4::uuid,$2::uuid,$5::uuid)`,
        [subscriberA,requestId,userA,subscriberB,userB]);
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    });

    afterAll(async () => {
        await admin.query('DELETE FROM platform_notification_outbox WHERE recipient_user_id=ANY($1::uuid[])',[[userA,userB]]).catch(()=>undefined);
        await admin.query('DELETE FROM feature_request_subscribers WHERE id=ANY($1::uuid[])',[[subscriberA,subscriberB]]).catch(()=>undefined);
        await admin.query('DELETE FROM feature_requests WHERE id=$1::uuid',[requestId]).catch(()=>undefined);
        await admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[userA,userB]]).catch(()=>undefined);
        await client?.$disconnect();
        await admin.end();
    });

    const featureService = (database = prisma) => new FeatureRequestsService(database,
        { get: (_key: string, fallback: string) => fallback } as any,
        { runExclusive: jest.fn() } as any, {} as any);

    it('commits the status and one stable delivery intent per active subscriber', async () => {
        const first = await featureService().updateStatus(requestId,'planned');
        expect(first).toEqual({ok:true,changed:true,enqueued:2});
        const rows = await prisma.$queryRawUnsafe(`SELECT state,payload,event_key
            FROM platform_notification_outbox WHERE entity_id=$1::uuid ORDER BY event_key`,requestId);
        expect(rows).toHaveLength(2);
        expect(rows.every((row:any)=>row.state==='pending'&&row.payload.status==='planned')).toBe(true);
        expect(rows[0].payload.title).toBe('<Mejor tablero>');

        await expect(featureService().updateStatus(requestId,'planned'))
            .resolves.toEqual({ok:true,changed:false,enqueued:0});
        expect((await prisma.$queryRawUnsafe(`SELECT id FROM platform_notification_outbox
            WHERE entity_id=$1::uuid`,requestId))).toHaveLength(2);
    });

    it('stores SMTP acceptance once and suppresses a user who unsubscribed before delivery', async () => {
        const send = jest.fn().mockResolvedValue('smtp-feature-accepted');
        const delivery = new PlatformNotificationOutboxService(prisma,
            { prepareBoundedSend: jest.fn().mockReturnValue(send) } as any,
            { get: (_key:string,fallback:string)=>fallback } as any,
            { runExclusive: jest.fn() } as any);
        const rows = await prisma.$queryRawUnsafe(`SELECT id,recipient_user_id
            FROM platform_notification_outbox WHERE entity_id=$1::uuid ORDER BY recipient_user_id`,requestId);
        const deliverable=rows.find((row:any)=>row.recipient_user_id===userA);
        const withdrawn=rows.find((row:any)=>row.recipient_user_id===userB);
        await expect(delivery.deliver(deliverable.id)).resolves.toBe('notification:sent');
        await expect(delivery.deliver(deliverable.id)).resolves.toBe('notification:sent');
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toBeUndefined();
        await prisma.$executeRawUnsafe('DELETE FROM feature_request_subscribers WHERE user_id=$1::uuid',userB);
        await expect(delivery.deliver(withdrawn.id)).resolves.toBe('notification:suppressed');
        expect(send).toHaveBeenCalledTimes(1);
        const states=await prisma.$queryRawUnsafe(`SELECT recipient_user_id,state,provider_reference
            FROM platform_notification_outbox WHERE entity_id=$1::uuid ORDER BY recipient_user_id`,requestId);
        expect(states).toEqual(expect.arrayContaining([
            {recipient_user_id:userA,state:'sent',provider_reference:'smtp-feature-accepted'},
            {recipient_user_id:userB,state:'suppressed',provider_reference:null},
        ]));
    });

    it('rolls back the status when the durable intent cannot be written', async () => {
        const [before]=await prisma.$queryRawUnsafe(
            'SELECT status,status_revision FROM feature_requests WHERE id=$1::uuid',requestId);
        const broken = Object.create(prisma);
        broken.$transaction = (callback: any) => client.$transaction((tx: any) => callback(new Proxy(tx, {
            get(target, property) {
                if (property === '$queryRawUnsafe') return (sql:string,...params:any[]) => {
                    if (sql.includes('INSERT INTO platform_notification_outbox')) throw new Error('outbox unavailable');
                    return target.$queryRawUnsafe(sql,...params);
                };
                const value=target[property];return typeof value==='function'?value.bind(target):value;
            },
        })));
        await expect(featureService(broken).updateStatus(requestId,'in_progress')).rejects.toThrow('outbox unavailable');
        const [request]=await prisma.$queryRawUnsafe('SELECT status,status_revision FROM feature_requests WHERE id=$1::uuid',requestId);
        expect(request).toEqual(before);
    });

    it('never retries an SMTP attempt whose answer was lost', async () => {
        await prisma.$executeRawUnsafe(`INSERT INTO feature_request_subscribers(id,request_id,user_id)
            VALUES($1::uuid,$2::uuid,$3::uuid) ON CONFLICT(request_id,user_id) DO NOTHING`,subscriberB,requestId,userB);
        await featureService().updateStatus(requestId,'declined','<no corresponde>');
        const [row]=await prisma.$queryRawUnsafe(`SELECT id FROM platform_notification_outbox
            WHERE entity_id=$1::uuid AND payload->>'status'='declined' AND recipient_user_id=$2::uuid`,requestId,userA);
        const send=jest.fn().mockRejectedValue(new Error('smtp_deadline_outcome_unknown'));
        const delivery=new PlatformNotificationOutboxService(prisma,
            {prepareBoundedSend:jest.fn().mockImplementation((payload:any)=>{
                expect(payload.html).toContain('&lt;Mejor tablero&gt;');
                expect(payload.html).toContain('&lt;no corresponde&gt;');
                return send;
            })} as any,{get:(_key:string,fallback:string)=>fallback} as any,
            {runExclusive:jest.fn()} as any);
        await expect(delivery.deliver(row.id)).rejects.toThrow('smtp_deadline_outcome_unknown');
        expect((await prisma.$queryRawUnsafe('SELECT state FROM platform_notification_outbox WHERE id=$1::uuid',row.id))[0].state)
            .toBe('reconciliation_required');
        await delivery.processDue();
        const [afterSweep]=await prisma.$queryRawUnsafe(
            'SELECT state,attempts FROM platform_notification_outbox WHERE id=$1::uuid',row.id);
        expect(afterSweep).toEqual({state:'reconciliation_required',attempts:1});
    });
});
