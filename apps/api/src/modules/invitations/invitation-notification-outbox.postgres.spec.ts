import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { PlatformNotificationOutboxService } from '../platform-notifications/platform-notification-outbox.service';
import { InvitationsService } from './invitations.service';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;

(url ? describe : describe.skip)('durable invitation notifications', () => {
    const tenantId = randomUUID();
    const inviterId = randomUUID();
    const acceptedUserId = randomUUID();
    const invitationId = randomUUID();
    const recipient = `invite-${invitationId}@example.test`;
    let admin: Client;
    let client: PrismaClient;
    let prisma: any;

    beforeAll(async () => {
        admin = new Client({ connectionString: url });
        await admin.connect();
        await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(sql => admin.query(sql));
        await admin.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS name TEXT');
        await admin.query(`CREATE TABLE IF NOT EXISTS feature_requests(
            id UUID PRIMARY KEY,status_revision INTEGER NOT NULL DEFAULT 0)`);
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260508110000_add_tenant_invitations/migration.sql'), 'utf8'));
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260913180000_add_platform_notification_outbox/migration.sql'), 'utf8'));
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260913190000_extend_platform_notifications_for_billing/migration.sql'), 'utf8'));
        await admin.query(readFileSync(join(__dirname,
            '../../../prisma/migrations/20260913200000_add_durable_invitation_notifications/migration.sql'), 'utf8'));
        await admin.query(`INSERT INTO tenants(id,name,schema_name,is_active,language,settings)
            VALUES($1::uuid,'Clínica Norte',$2,true,'es-CO',$3::jsonb)`,
        [tenantId, `tenant_invite_${tenantId.replace(/-/g, '')}`, JSON.stringify({ logoUrl: 'https://cdn.example.test/logo.png' })]);
        await admin.query(`INSERT INTO users(id,tenant_id,email,first_name,last_name,role,is_active)
            VALUES($1::uuid,$3::uuid,$4,'Invitador','Uno','tenant_admin',true),
                  ($2::uuid,$3::uuid,$5,'Laura','Gómez','tenant_agent',true)`,
        [inviterId, acceptedUserId, tenantId, `inviter-${inviterId}@example.test`, recipient]);
        await admin.query(`INSERT INTO tenant_invitations(
                id,tenant_id,email,role,skill_tags,token,invited_by_user_id,expires_at,notification_revision)
            VALUES($1::uuid,$2::uuid,$3,'tenant_agent',ARRAY['sales'],'secret-invite-token',$4,NOW()+INTERVAL '14 days',1)`,
        [invitationId, tenantId, recipient, inviterId]);
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    });

    afterAll(async () => {
        await admin.query('DELETE FROM platform_notification_outbox WHERE tenant_id=$1::uuid', [tenantId]).catch(() => undefined);
        await admin.query('DELETE FROM tenant_invitations WHERE tenant_id=$1::uuid', [tenantId]).catch(() => undefined);
        await admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[inviterId, acceptedUserId]]).catch(() => undefined);
        await admin.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]).catch(() => undefined);
        await client?.$disconnect();
        await admin.end();
    });

    beforeEach(async () => {
        await admin.query('DELETE FROM platform_notification_outbox WHERE tenant_id=$1::uuid', [tenantId]);
        await admin.query(`UPDATE tenant_invitations SET notification_revision=1,resent_at=NULL,
            revoked_at=NULL,accepted_at=NULL,accepted_user_id=NULL,expires_at=NOW()+INTERVAL '14 days'
            WHERE id=$1::uuid`, [invitationId]);
    });

    const insertNotice = async (kind: string, eventKey: string, payload: object): Promise<string> => {
        const id = randomUUID();
        await client.$executeRawUnsafe(`INSERT INTO platform_notification_outbox(
                id,event_key,kind,entity_id,tenant_id,recipient_email,payload,state)
            VALUES($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7::jsonb,'pending')`,
        id, eventKey, kind, invitationId, tenantId, recipient, JSON.stringify(payload));
        return id;
    };

    it('renders from the live invitation and stores exactly one SMTP receipt', async () => {
        const noticeId = await insertNotice('invitation.invite_email', `invitation:${invitationId}:invite:1`, { revision: 1 });
        const send = jest.fn().mockResolvedValue('smtp-invitation-accepted');
        const delivery = new PlatformNotificationOutboxService(prisma, {
            prepareBoundedSend: jest.fn().mockImplementation((payload: any) => {
                expect(payload.to).toBe(recipient);
                expect(payload.subject).toContain('Clínica Norte');
                expect(payload.html).toContain('secret-invite-token');
                expect(payload.html).toContain('Invitador Uno');
                return send;
            }),
        } as any, { get: (_key: string, fallback: string) => fallback } as any,
        { runExclusive: jest.fn() } as any);

        await expect(delivery.deliver(noticeId)).resolves.toBe('notification:sent');
        await expect(delivery.deliver(noticeId)).resolves.toBe('notification:sent');
        expect(send).toHaveBeenCalledTimes(1);
        expect((await client.$queryRawUnsafe<any[]>(
            'SELECT provider_reference FROM platform_notification_outbox WHERE id=$1::uuid', noticeId))[0])
            .toEqual({ provider_reference: 'smtp-invitation-accepted' });
    });

    it('suppresses an older revision and a revoked invitation before SMTP', async () => {
        const staleId = await insertNotice('invitation.invite_email', `invitation:${invitationId}:invite:stale`, { revision: 1 });
        await client.$executeRawUnsafe('UPDATE tenant_invitations SET notification_revision=2 WHERE id=$1::uuid', invitationId);
        const currentId = await insertNotice('invitation.invite_email', `invitation:${invitationId}:invite:2`, { revision: 2 });
        const send = jest.fn().mockResolvedValue('smtp-should-not-run');
        const delivery = new PlatformNotificationOutboxService(prisma,
            { prepareBoundedSend: jest.fn().mockReturnValue(send) } as any,
            { get: (_key: string, fallback: string) => fallback } as any,
            { runExclusive: jest.fn() } as any);
        await expect(delivery.deliver(staleId)).resolves.toBe('notification:suppressed');
        await client.$executeRawUnsafe('UPDATE tenant_invitations SET revoked_at=NOW() WHERE id=$1::uuid', invitationId);
        await expect(delivery.deliver(currentId)).resolves.toBe('notification:suppressed');
        expect(send).not.toHaveBeenCalled();
    });

    it('commits a resend with its intent and rolls both back when admission fails', async () => {
        const notify = { deliver: jest.fn().mockResolvedValue('notification:sent') };
        const service = new InvitationsService(prisma, notify as any,
            { enforcePlanLimit: jest.fn() } as any);
        await expect(service.resend(tenantId, invitationId)).resolves.toMatchObject({ notificationRevision: 2 });
        expect(notify.deliver).toHaveBeenCalledTimes(1);
        expect((await client.$queryRawUnsafe<any[]>(`SELECT event_key,state FROM platform_notification_outbox
            WHERE entity_id=$1::uuid`, invitationId))).toEqual([{
            event_key: `invitation:${invitationId}:invite:2`, state: 'pending',
        }]);

        const broken = Object.create(prisma);
        broken.$transaction = (callback: any, options: any) => client.$transaction((tx: any) => callback(new Proxy(tx, {
            get(target, property) {
                if (property === '$queryRawUnsafe') return (sql: string, ...params: any[]) => {
                    if (sql.includes('INSERT INTO platform_notification_outbox')) throw new Error('outbox unavailable');
                    return target.$queryRawUnsafe(sql, ...params);
                };
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            },
        })), options);
        const brokenService = new InvitationsService(broken, notify as any,
            { enforcePlanLimit: jest.fn() } as any);
        await expect(brokenService.resend(tenantId, invitationId)).rejects.toThrow('outbox unavailable');
        expect((await client.$queryRawUnsafe<any[]>(
            'SELECT notification_revision FROM tenant_invitations WHERE id=$1::uuid', invitationId))[0])
            .toEqual({ notification_revision: 2 });
        expect((await client.$queryRawUnsafe<any[]>(
            'SELECT id FROM platform_notification_outbox WHERE entity_id=$1::uuid', invitationId))).toHaveLength(1);
    });

    it('sends a welcome only for the user who accepted the invitation', async () => {
        await client.$executeRawUnsafe(`UPDATE tenant_invitations
            SET revoked_at=NULL,accepted_at=NOW(),accepted_user_id=$2 WHERE id=$1::uuid`, invitationId, acceptedUserId);
        const wrongNoticeId = await insertNotice('invitation.welcome_email',
            `invitation:${invitationId}:welcome:wrong`, { acceptedUserId: randomUUID() });
        const noticeId = await insertNotice('invitation.welcome_email', `invitation:${invitationId}:welcome`,
            { acceptedUserId });
        const send = jest.fn().mockResolvedValue('smtp-welcome-accepted');
        const delivery = new PlatformNotificationOutboxService(prisma, {
            prepareBoundedSend: jest.fn().mockImplementation((payload: any) => {
                expect(payload.to).toBe(recipient);
                expect(payload.html).toContain('Laura');
                expect(payload.html).toContain('Clínica Norte');
                return send;
            }),
        } as any, { get: (_key: string, fallback: string) => fallback } as any,
        { runExclusive: jest.fn() } as any);
        await expect(delivery.deliver(wrongNoticeId)).resolves.toBe('notification:suppressed');
        expect(send).not.toHaveBeenCalled();
        await expect(delivery.deliver(noticeId)).resolves.toBe('notification:sent');
        expect(send).toHaveBeenCalledTimes(1);
    });
});
