import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';

const url = process.env.KNOWLEDGE_FILE_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('Identity suggestion counts with real Prisma and isolated PostgreSQL', () => {
    const tenants = [randomUUID(), randomUUID(), randomUUID()];
    const schemas = tenants.map(id => `tenant_identitycounts_${id.replace(/-/g, '')}`);
    let db: Pool;
    let prisma: PrismaClient;
    const statements: string[] = [];
    const controllers: IdentityController[] = [];
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new Pool({ connectionString: url, max: 3 });
        prisma = new PrismaClient({ datasources: { db: { url: url! } } });
        await prisma.$connect();
        for (let i = 0; i < schemas.length; i++) {
            const schema = schemas[i];
            await db.query(`CREATE SCHEMA "${schema}"`);
            // Only the existing status column is needed by this aggregate.
            // The third schema deliberately lacks a table to exercise a rejected read.
            if (i < 2) await db.query(`CREATE TABLE "${schema}".merge_suggestions (id integer PRIMARY KEY, status text NOT NULL)`);
            const service = Object.create(IdentityService.prototype) as IdentityService;
            Object.assign(service, {
                getSchema: async (tenant: string) => {
                    if (tenant !== tenants[i]) throw new Error('test_tenant_scope_violation');
                    return schema;
                },
                prisma: { executeInTenantSchema: async (name: string, sql: string, params: unknown[] = []) => {
                    if (name !== schema) throw new Error('test_schema_scope_violation');
                    statements.push(sql);
                    return prisma.$transaction(async tx => {
                        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", pg_catalog`);
                        return tx.$queryRawUnsafe(sql, ...params);
                    });
                } },
            });
            const controller = Object.create(IdentityController.prototype) as IdentityController;
            Object.assign(controller, { identityService: service });
            controllers.push(controller);
        }
        await db.query(`INSERT INTO "${schemas[0]}".merge_suggestions (id,status)
            SELECT n, CASE WHEN n<=101 THEN 'pending' WHEN n<=203 THEN 'approved' ELSE 'rejected' END FROM generate_series(1,306) n`);
    });
    afterAll(async () => {
        if (!db) return;
        try { for (const schema of schemas) await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
        finally { await prisma?.$disconnect(); await db.end(); }
    });
    it('counts every status beyond the list cap without returning contacts or changing rows', async () => {
        const snapshot = async () => (await db.query(`SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) AS hash FROM "${schemas[0]}".merge_suggestions s`)).rows;
        const before = await snapshot();
        expect(await controllers[0].getSuggestionCounts(tenants[0])).toEqual({ success: true, data: { pending: 101, approved: 102, rejected: 103 } });
        expect(await snapshot()).toEqual(before);
        expect(statements.every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true);
        expect(statements.every(sql => !/JOIN|contacts|customer_profiles|LIMIT/i.test(sql))).toBe(true);
    });
    it('returns genuine zero counts in an empty separate tenant schema', async () => {
        expect(await controllers[1].getSuggestionCounts(tenants[1])).toEqual({ success: true, data: { pending: 0, approved: 0, rejected: 0 } });
    });
    it('propagates a failed database read instead of reporting zero counts', async () => {
        await expect(controllers[2].getSuggestionCounts(tenants[2])).rejects.toThrow();
    });
});
