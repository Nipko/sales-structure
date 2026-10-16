import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { CrmController } from '../../crm.controller';
import { SegmentsService } from './segments.service';

const url = process.env.KNOWLEDGE_FILE_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('Segment preview through the controller with real isolated PostgreSQL', () => {
    const tenants = [randomUUID(), randomUUID()];
    const schemas = tenants.map(id => `tenant_segpreview_${id.replace(/-/g, '')}`);
    let db: Pool;
    let prisma: PrismaClient;
    let controllers: CrmController[];
    let quota: jest.Mock[];
    let statements: string[][];
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new Pool({ connectionString: url, max: 4 });
        prisma = new PrismaClient({ datasources: { db: { url: url! } } });
        await prisma.$connect();
        await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        const source = readFileSync(resolve(__dirname, '../../../../../prisma/tenant-schema.sql'), 'utf8');
        const table = source.match(/CREATE TABLE IF NOT EXISTS "\{\{SCHEMA_NAME\}\}"\."contact_segments" \([\s\S]*?\n\);/)?.[0];
        if (!table) throw new Error('canonical_segment_schema_required');
        quota = []; statements = [[], []];
        controllers = [];
        for (let i = 0; i < schemas.length; i++) {
            const schema = schemas[i];
            await db.query(`CREATE SCHEMA "${schema}"`);
            await db.query(table.replaceAll('{{SCHEMA_NAME}}', schema));
            await db.query(`CREATE TABLE "${schema}".leads (id uuid PRIMARY KEY, score integer, stage text, archived_at timestamp)`);
            await db.query(`INSERT INTO "${schema}".leads (id,score,stage) VALUES ($1, $2, $3)`, [randomUUID(), i === 0 ? 7 : 2, 'consulta']);
            const execute = async (name: string, sql: string, params: unknown[] = []) => {
                if (name !== schema) throw new Error('test_schema_scope_violation');
                statements[i].push(sql);
                return prisma.$transaction(async tx => {
                    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
                    // Match production Prisma binding: a form value such as "7"
                    // is sent as TEXT, unlike node-pg's inferred parameter type.
                    return tx.$queryRawUnsafe(sql, ...params);
                });
            };
            const resolver = async (tenant: string) => {
                if (tenant !== tenants[i]) throw new Error('test_tenant_scope_violation');
                return schema;
            };
            const service = Object.create(SegmentsService.prototype) as SegmentsService;
            Object.assign(service, { getTenantSchema: resolver, prisma: { executeInTenantSchema: execute }, logger: { log: jest.fn() } });
            const controller = Object.create(CrmController.prototype) as CrmController;
            quota[i] = jest.fn().mockResolvedValue(undefined);
            Object.assign(controller, { getSchema: resolver, prisma: { executeInTenantSchema: execute }, segmentsService: service, throttle: { enforcePlanLimit: quota[i] } });
            controllers.push(controller);
        }
    });
    afterAll(async () => {
        if (!db) return;
        try { for (const schema of schemas) await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
        finally { await prisma?.$disconnect(); await db.end(); }
    });
    beforeEach(async () => {
        for (let i = 0; i < schemas.length; i++) {
            await db.query(`DELETE FROM "${schemas[i]}".contact_segments`);
            quota[i].mockClear(); statements[i] = [];
        }
    });
    const rules = [{ field: 'score', operator: 'gte', value: '7' }];
    const snapshot = async (i: number) => (await db.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'[]')) AS hash FROM "${schemas[i]}".contact_segments s`)).rows;

    it('previews a positive match without inserting a segment or consuming creation quota', async () => {
        const before = await snapshot(0);
        const response = await controllers[0].createSegment(tenants[0], { name: 'Synthetic preview', filterRules: rules, preview: true });
        expect(await snapshot(0)).toEqual(before);
        expect(response).toEqual({ success: true, data: { count: 1 } });
        expect(statements[0].every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true);
        expect(quota[0]).not.toHaveBeenCalled();
    });
    it('keeps the preview count isolated between two tenant schemas', async () => {
        const response = await controllers[1].createSegment(tenants[1], { name: 'Synthetic other tenant', filterRules: rules, preview: true });
        expect(response).toEqual({ success: true, data: { count: 0 } });
        expect((await db.query(`SELECT COUNT(*)::int AS total FROM "${schemas[1]}".contact_segments`)).rows).toEqual([{ total: 0 }]);
    });
    it('allows preview without a segment name and leaves no unnamed row', async () => {
        const response = await controllers[0].createSegment(tenants[0], { name: '', filterRules: rules, preview: true });
        expect(response).toEqual({ success: true, data: { count: 1 } });
        expect((await db.query(`SELECT COUNT(*)::int AS total FROM "${schemas[0]}".contact_segments`)).rows).toEqual([{ total: 0 }]);
    });
    it.each([
        { operator: 'eq', value: '7', count: 1 },
        { operator: 'neq', value: '7', count: 0 },
        { operator: 'gt', value: '7', count: 0 },
        { operator: 'gte', value: '8', count: 0 },
        { operator: 'lt', value: '8', count: 1 },
        { operator: 'lte', value: '7', count: 1 },
        { operator: 'gte', value: '7.5', count: 0 },
        { operator: 'in', value: ['2', '7'], count: 1 },
    ])('binds score $operator through Prisma with value $value', async ({ operator, value, count }) => {
        const before = await snapshot(0);
        const response = await controllers[0].createSegment(tenants[0], {
            name: '', preview: true, filterRules: [{ field: 'score', operator, value }],
        });
        expect(response).toEqual({ success: true, data: { count } });
        expect(await snapshot(0)).toEqual(before);
    });
    it('keeps text filters parameterized through the same Prisma path', async () => {
        const response = await controllers[0].createSegment(tenants[0], {
            name: '', preview: true, filterRules: [{ field: 'stage', operator: 'eq', value: "consulta' OR 1=1 --" }],
        });
        expect(response).toEqual({ success: true, data: { count: 0 } });
    });
    it.each([{ value: '2,3', count: 0 }, { value: ' 7, 8 ', count: 1 }])('filters the visible form list $value through Prisma without persistence', async ({ value, count }) => {
        const before = await snapshot(0);
        const response = await controllers[0].createSegment(tenants[0], {
            name: '', preview: true, filterRules: [{ field: 'score', operator: 'in', value }],
        });
        expect(response).toEqual({ success: true, data: { count } });
        expect(await snapshot(0)).toEqual(before);
        expect(statements[0].every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true);
        expect(quota[0]).not.toHaveBeenCalled();
    });
    it('binds each text list member without SQL interpolation', async () => {
        const response = await controllers[0].createSegment(tenants[0], {
            name: '', preview: true, filterRules: [{ field: 'stage', operator: 'in', value: "other, consulta' OR 1=1 --" }],
        });
        expect(response).toEqual({ success: true, data: { count: 0 } });
        expect(statements[0].every(sql => !sql.includes('OR 1=1'))).toBe(true);
    });
    it('rejects an empty list before issuing a query or persisting a segment', async () => {
        const before = await snapshot(0);
        await expect(controllers[0].createSegment(tenants[0], {
            name: '', preview: true, filterRules: [{ field: 'score', operator: 'in', value: '2,,3' }],
        })).rejects.toThrow('Invalid segment filter list');
        expect(statements[0]).toEqual([]);
        expect(await snapshot(0)).toEqual(before);
        expect(quota[0]).not.toHaveBeenCalled();
    });
    it('continues to enforce quota and persist one definition for an explicit create', async () => {
        const response = await controllers[0].createSegment(tenants[0], { name: 'Synthetic saved segment', filterRules: rules });
        expect(quota[0]).toHaveBeenCalledWith(tenants[0], 'segments', 0, 'segmentos');
        expect(response.data).toMatchObject({ tenant_id: tenants[0], name: 'Synthetic saved segment', contact_count: 1 });
        expect((await db.query(`SELECT COUNT(*)::int AS total FROM "${schemas[0]}".contact_segments`)).rows).toEqual([{ total: 1 }]);
    });
    it('blocks an explicit create at quota before persisting anything', async () => {
        quota[0].mockRejectedValueOnce(new Error('quota limit'));
        await expect(controllers[0].createSegment(tenants[0], { name: 'Synthetic blocked', filterRules: rules })).rejects.toThrow('quota limit');
        expect((await db.query(`SELECT COUNT(*)::int AS total FROM "${schemas[0]}".contact_segments`)).rows).toEqual([{ total: 0 }]);
    });
});
