import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import { CustomAttributesService } from './custom-attributes.service';

const url = process.env.KNOWLEDGE_FILE_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('Custom attribute definitions with the canonical tenant schema', () => {
    const tenants = [randomUUID(), randomUUID()];
    const schemas = tenants.map(id => `tenant_customattr_${id.replace(/-/g, '')}`);
    let db: Pool;
    let services: CustomAttributesService[];
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new Pool({ connectionString: url, max: 4 });
        await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        const source = readFileSync(resolve(__dirname, '../../../../../prisma/tenant-schema.sql'), 'utf8');
        const table = source.match(/CREATE TABLE IF NOT EXISTS "\{\{SCHEMA_NAME\}\}"\."custom_attribute_definitions" \([\s\S]*?\n\);/)?.[0];
        if (!table) throw new Error('canonical_definition_schema_required');
        for (const schema of schemas) {
            await db.query(`CREATE SCHEMA "${schema}"`);
            await db.query(table.replaceAll('{{SCHEMA_NAME}}', schema));
        }
        services = schemas.map((schema, index) => {
            const service = Object.create(CustomAttributesService.prototype) as CustomAttributesService;
            Object.assign(service, {
                getTenantSchema: async (tenant: string) => {
                    if (tenant !== tenants[index]) throw new Error('test_tenant_scope_violation');
                    return schema;
                },
                logger: { log: jest.fn() },
                prisma: { executeInTenantSchema: async (name: string, sql: string, params: unknown[] = []) => {
                    if (name !== schema) throw new Error('test_schema_scope_violation');
                    const client = await db.connect();
                    try {
                        await client.query('BEGIN');
                        await client.query(`SET LOCAL search_path TO "${schema}", public`);
                        const result = await client.query(sql, params);
                        await client.query('COMMIT');
                        return result.rows;
                    } catch (error) { await client.query('ROLLBACK'); throw error; }
                    finally { client.release(); }
                } },
            });
            return service;
        });
    });
    afterAll(async () => {
        if (!db) return;
        try { for (const schema of schemas) await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
        finally { await db.end(); }
    });
    const definition = (key: string) => ({ entityType: 'contact', attributeKey: key,
        attributeLabel: 'Synthetic QA preference', attributeType: 'text', options: null, required: false });

    it('persists the verified tenant and canonical fields through actual service SQL', async () => {
        const row = await services[0].createDefinition(tenants[0], definition('qa_create'));
        expect(row).toMatchObject({ tenant_id: tenants[0], entity_type: 'contact', attribute_key: 'qa_create',
            attribute_label: 'Synthetic QA preference', attribute_type: 'text', options: null, required: false });
        expect((await services[0].getDefinitions(tenants[0], 'contact')).find(r => r.id === row.id)).toEqual(row);
    });
    it('creates the same key in two separate tenant schemas with their own tenant IDs', async () => {
        for (let index = 0; index < tenants.length; index++) {
            const row = await services[index].createDefinition(tenants[index], definition('qa_shared_key'));
            expect(row.tenant_id).toBe(tenants[index]);
            const stored = await db.query(`SELECT tenant_id FROM "${schemas[index]}".custom_attribute_definitions WHERE attribute_key=$1`, ['qa_shared_key']);
            expect(stored.rows).toEqual([{ tenant_id: tenants[index] }]);
        }
    });
    it('keeps the canonical per-tenant unique constraint and rejects a duplicate without another row', async () => {
        await services[0].createDefinition(tenants[0], definition('qa_duplicate'));
        await expect(services[0].createDefinition(tenants[0], definition('qa_duplicate'))).rejects.toMatchObject({ code: '23505' });
        const stored = await db.query(`SELECT COUNT(*)::int AS total FROM "${schemas[0]}".custom_attribute_definitions WHERE attribute_key=$1`, ['qa_duplicate']);
        expect(stored.rows).toEqual([{ total: 1 }]);
    });
});
