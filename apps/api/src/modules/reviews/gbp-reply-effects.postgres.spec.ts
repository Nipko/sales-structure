import { randomUUID } from 'crypto';
import { of, throwError } from 'rxjs';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { ReviewsService } from './reviews.service';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;

(url ? describe : describe.skip)('Google Business reply effects — PostgreSQL', () => {
    const tenantId = randomUUID();
    const schema = `tenant_gbp_${tenantId.replace(/-/g, '')}`;
    const reviewId = randomUUID();
    let admin: Client;
    let client: PrismaClient;
    let prisma: PrismaService;
    let put: jest.Mock;
    let service: ReviewsService;

    beforeAll(async () => {
        admin = new Client({ connectionString: url });
        await admin.connect();
        await ensureSyntheticGlobalTables(sql => admin.query(sql));
        await admin.query(`INSERT INTO tenants(id,schema_name,is_active,language,settings)
            VALUES($1::uuid,$2,true,'es','{}'::jsonb)`, [tenantId, schema]);
        await admin.query(`CREATE SCHEMA "${schema}"`);
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
        (prisma as any).tenant = client.tenant;
        put = jest.fn().mockReturnValue(of({ data: { updateTime: 'now' } }));
        service = new ReviewsService(prisma, {
            get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn(),
        } as any, {} as any, { put, axiosRef: {} } as any, {
            get: (key: string, fallback = '') => key === 'ENCRYPTION_KEY' ? '11'.repeat(32) : fallback,
        } as any);
        jest.spyOn(service as any, 'getAccessToken').mockResolvedValue('synthetic-token');
        await service.ensureTables(schema);
        await prisma.executeInTenantSchema(schema, `INSERT INTO gbp_reviews(
            id,review_name,reviewer_name,rating,comment,reply_status)
            VALUES($1::uuid,$2,'Ada',5,'Great','none')`, [reviewId, `accounts/a/locations/l/reviews/${reviewId}`]);
    });

    afterAll(async () => {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
        await admin.query('DELETE FROM tenants WHERE id=$1::uuid', [tenantId]).catch(() => undefined);
        await client?.$disconnect();
        await admin?.end();
    });

    it('commits one authority and the public receipt with the local review', async () => {
        await service.postReply(tenantId, reviewId, 'Thank you!', 'manual_request_123');
        await service.postReply(tenantId, reviewId, 'Thank you!', 'manual_request_123');
        expect(put).toHaveBeenCalledTimes(1);
        const effects = await prisma.executeInTenantSchema<any[]>(schema,
            `SELECT state,attempts,provider_reference FROM gbp_reply_effects WHERE review_id=$1::uuid`, [reviewId]);
        expect(effects).toEqual([expect.objectContaining({
            state: 'accepted', attempts: 1, provider_reference: `accounts/a/locations/l/reviews/${reviewId}`,
        })]);
        const [review] = await prisma.executeInTenantSchema<any[]>(schema,
            `SELECT reply_status,reply_comment FROM gbp_reviews WHERE id=$1::uuid`, [reviewId]);
        expect(review).toEqual({ reply_status: 'posted', reply_comment: 'Thank you!' });
    });

    it('records an unknown PUT and safely resumes the same idempotent effect', async () => {
        put.mockReturnValueOnce(throwError(() => new Error('provider_timeout')))
            .mockReturnValueOnce(of({ data: {} }));
        await expect(service.postReply(tenantId, reviewId, 'Recovered reply', 'manual_unknown_123'))
            .rejects.toThrow('provider_timeout');
        let [effect] = await prisma.executeInTenantSchema<any[]>(schema,
            `SELECT state,attempts FROM gbp_reply_effects WHERE event_key LIKE '%manual_unknown_123'`, []);
        expect(effect).toEqual({ state: 'unknown', attempts: 1 });
        await service.postReply(tenantId, reviewId, 'Recovered reply', 'manual_unknown_123');
        [effect] = await prisma.executeInTenantSchema<any[]>(schema,
            `SELECT state,attempts FROM gbp_reply_effects WHERE event_key LIKE '%manual_unknown_123'`, []);
        expect(effect).toEqual({ state: 'accepted', attempts: 2 });
    });

    it('refuses a request key reused for different public words', async () => {
        await service.postReply(tenantId, reviewId, 'First words', 'manual_conflict_123');
        await expect(service.postReply(tenantId, reviewId, 'Different words', 'manual_conflict_123'))
            .rejects.toThrow('Reply request key already used for different content');
    });
});
