import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { CustomerPortalAccessService } from './customer-portal-access.service';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const describeDb = connection ? describe : describe.skip;

describeDb('durable customer portal access against PostgreSQL', () => {
    jest.setTimeout(120_000);
    const tenantId = randomUUID();
    const contactId = randomUUID();
    const schema = `tenant_portal_${tenantId.replace(/-/g, '')}`;
    let admin: Client;
    let prisma: any;
    const smtpAttempt = jest.fn().mockResolvedValue('smtp.portal.1');
    const email = { prepareBoundedSend: jest.fn().mockReturnValue(smtpAttempt) };
    const smsAttempt = jest.fn().mockResolvedValue('SM_PORTAL_1');
    const sms = { prepareBoundedSend: jest.fn().mockResolvedValue(smsAttempt) };
    const regional = { phoneRegionFor: jest.fn().mockResolvedValue('CO') };
    const cronLock = { runExclusive: jest.fn(async (_key: string, _ttl: number, work: any) => work()) };
    let service: CustomerPortalAccessService;

    beforeAll(async () => {
        admin = new Client({ connectionString: connection });
        await admin.connect();
        const migration = readFileSync(join(__dirname,
            '../../../prisma/migrations/20260913230000_add_durable_customer_portal_access/migration.sql'), 'utf8');
        await admin.query(migration);
        prisma = new PrismaClient({ datasources: { db: { url: connection } } });
        await prisma.$connect();
        prisma.transactionInTenantSchema = async (targetSchema: string, work: any) => {
            if (!/^tenant_[a-z0-9_]+$/.test(targetSchema)) throw new Error('invalid_schema');
            return prisma.$transaction(async (tx: any) => {
                await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${targetSchema}", public`);
                return work((sql: string, params: any[] = []) => tx.$queryRawUnsafe(sql, ...params));
            });
        };
        await admin.query(`INSERT INTO tenants(id,schema_name,is_active,language,industry)
            VALUES($1::uuid,$2,true,'es','services')`, [tenantId, schema]);
        await admin.query(`CREATE SCHEMA "${schema}"`);
        await admin.query(`CREATE TABLE "${schema}".contacts(
            id UUID PRIMARY KEY,phone TEXT,email TEXT,is_active BOOLEAN NOT NULL DEFAULT true)`);
        await admin.query(`INSERT INTO "${schema}".contacts(id,phone,email)
            VALUES($1::uuid,$2,$3)`, [contactId, '+573001112233', 'portal@example.test']);
        service = new CustomerPortalAccessService(prisma, email as any, sms as any,
            regional as any, cronLock as any);
    });

    afterAll(async () => {
        await admin?.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]).catch(() => undefined);
        if (/^tenant_portal_[a-f0-9]{32}$/.test(schema)) {
            await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
        }
        await prisma?.$disconnect();
        await admin?.end();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        smtpAttempt.mockResolvedValue('smtp.portal.1');
        email.prepareBoundedSend.mockReturnValue(smtpAttempt);
        smsAttempt.mockResolvedValue('SM_PORTAL_1');
        sms.prepareBoundedSend.mockResolvedValue(smsAttempt);
        await admin.query('DELETE FROM customer_portal_access_challenges WHERE tenant_id=$1::uuid', [tenantId]);
        await admin.query(`UPDATE "${schema}".contacts SET phone=$2,email=$3,is_active=true WHERE id=$1::uuid`,
            [contactId, '+573001112233', 'portal@example.test']);
    });

    it('adopts concurrent repeats and stores the exact provider receipt once', async () => {
        const [a, b] = await Promise.all([
            service.issue(tenantId, schema, 'email', 'portal@example.test', 'es'),
            service.issue(tenantId, schema, 'email', 'portal@example.test', 'es'),
        ]);
        expect(a).toBeTruthy();
        expect(b).toBe(a);
        expect((await admin.query(`SELECT id FROM customer_portal_access_challenges
            WHERE tenant_id=$1::uuid`, [tenantId])).rows).toHaveLength(1);

        await expect(service.deliver(a!)).resolves.toBe('portal:sent');
        await expect(service.deliver(a!)).resolves.toBe('portal:sent');
        expect(smtpAttempt).toHaveBeenCalledTimes(1);
        expect((await admin.query(`SELECT state,provider_reference FROM customer_portal_access_challenges
            WHERE id=$1::uuid`, [a])).rows[0]).toMatchObject({ state: 'sent', provider_reference: 'smtp.portal.1' });
    });

    it('freezes an unanswered provider attempt instead of sending it again', async () => {
        const id = await service.issue(tenantId, schema, 'sms', '+573001112233', 'es');
        smsAttempt.mockRejectedValueOnce(new Error('connection_lost_after_post'));
        await expect(service.deliver(id!)).rejects.toThrow('connection_lost_after_post');
        expect((await admin.query(`SELECT state,error_code FROM customer_portal_access_challenges
            WHERE id=$1::uuid`, [id])).rows[0]).toMatchObject({
            state: 'reconciliation_required', error_code: 'portal_send_outcome_unknown',
        });
        await service.processDue();
        expect(smsAttempt).toHaveBeenCalledTimes(1);
    });

    it('keeps verification durable, single-use and limited to five attempts', async () => {
        const id = await service.issue(tenantId, schema, 'email', 'portal@example.test', 'en');
        const code = (await admin.query('SELECT code FROM customer_portal_access_challenges WHERE id=$1::uuid', [id])).rows[0].code;
        await expect(service.verify(tenantId, 'email', 'portal@example.test', code)).resolves.toBe(contactId);
        await expect(service.verify(tenantId, 'email', 'portal@example.test', code)).rejects.toThrow('portal_code_expired');

        const next = await service.issue(tenantId, schema, 'email', 'portal@example.test', 'en');
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            await expect(service.verify(tenantId, 'email', 'portal@example.test', '000000'))
                .rejects.toThrow('portal_invalid_code');
        }
        await expect(service.verify(tenantId, 'email', 'portal@example.test', '000000'))
            .rejects.toThrow('portal_too_many_attempts');
        expect((await admin.query(`SELECT verify_attempts,superseded_at FROM customer_portal_access_challenges
            WHERE id=$1::uuid`, [next])).rows[0]).toMatchObject({ verify_attempts: 5 });
    });

    it('suppresses delivery when the canonical contact destination changed', async () => {
        const id = await service.issue(tenantId, schema, 'email', 'portal@example.test', 'fr');
        await admin.query(`UPDATE "${schema}".contacts SET email='changed@example.test' WHERE id=$1::uuid`, [contactId]);
        await expect(service.deliver(id!)).resolves.toBe('portal:suppressed');
        expect(smtpAttempt).not.toHaveBeenCalled();
    });
});
