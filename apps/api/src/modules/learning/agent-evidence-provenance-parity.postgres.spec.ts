import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { EVIDENCE_STORES, evidenceProvenanceDdl } from './agent-evidence-provenance';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * Three definitions of the same marks.
 *
 * The provenance columns are not a table anybody creates: they are additive
 * columns on five tables that already exist, owned by four different modules.
 * That is exactly the shape that drifts — a column added to one module's
 * bootstrap and forgotten in the template, and a tenant provisioned last week
 * silently missing the mark that stops a withdrawn release certifying an agent.
 *
 * So the three paths have to produce the same columns:
 *
 *   1. the lazy bootstraps, which take their text from `evidenceProvenanceDdl`;
 *   2. `prisma/tenant-schema.sql`, which defines a brand new tenant;
 *   3. the migration, for the tenants that already existed.
 *
 * Both SQL artefacts are generated from the registry, so a divergence has to
 * come from an edit by hand — and that is the one this test catches.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

const MIGRATION = resolve(__dirname,
    '../../../prisma/migrations/20260909180000_add_agent_evidence_provenance/migration.sql');
const TABLES = EVIDENCE_STORES.map(store => store.table);

integration('the three definitions of the evidence marks agree', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const schemas = {
        bootstrap: `tenant_prov_boot_${suffix}`,
        fresh: `tenant_prov_fresh_${suffix}`,
        migrated: `tenant_prov_migr_${suffix}`,
    };
    let client: Client;
    jest.setTimeout(120_000);
    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        client = new Client({ connectionString: connection });
        await client.connect();
        for (const schema of Object.values(schemas)) {
            await q(`CREATE SCHEMA "${schema}"`);
            // The five tables as they stand BEFORE this change. Only their
            // identity matters here; what is being compared is what each path
            // adds to them.
            for (const table of TABLES) await q(`CREATE TABLE "${schema}"."${table}"(id UUID PRIMARY KEY)`);
        }

        // 1. What the module bootstraps execute the first time a tenant needs it.
        await q(`SET search_path TO "${schemas.bootstrap}"`);
        for (const store of EVIDENCE_STORES) for (const sql of evidenceProvenanceDdl(store.table)) await q(sql);
        await q('SET search_path TO public');

        // 2. The checked-in definition of a brand new tenant.
        const template = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const block = template.split('-- BEGIN AGENT EVIDENCE PROVENANCE')[1]
            ?.split('-- END AGENT EVIDENCE PROVENANCE')[0];
        if (!block) throw new Error('tenant_schema_block_missing:AGENT EVIDENCE PROVENANCE');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', schemas.fresh));
        }

        // 3. The migration, driven by a tenants row exactly as production will.
        await q('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY, schema_name TEXT NOT NULL)');
        const tenantId = randomUUID();
        await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [tenantId, schemas.migrated]);
        try {
            await q(readFileSync(MIGRATION, 'utf8'));
        } finally {
            await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]);
        }
    });

    afterAll(async () => {
        if (!client) return;
        try {
            for (const schema of Object.values(schemas)) {
                if (!/^tenant_prov_[a-z]+_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
                await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            }
        } finally { await client.end(); }
    });

    const columns = (schema: string) => q(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
           FROM information_schema.columns WHERE table_schema=$1 AND table_name = ANY($2)
          ORDER BY table_name, column_name`, [schema, TABLES]);

    it('adds the same columns by all three paths', async () => {
        const [boot, fresh, migrated] = await Promise.all([
            columns(schemas.bootstrap), columns(schemas.fresh), columns(schemas.migrated)]);
        // A path that added nothing would make the comparison trivially true:
        // five ids, plus two marks each, plus the two recorded columns.
        expect(boot.length).toBe(TABLES.length * 3 + EVIDENCE_STORES.filter(s => s.recordedColumn).length);
        expect(fresh).toEqual(boot);
        expect(migrated).toEqual(boot);
    });

    it('gives every store the mark the invalidation writes', async () => {
        const boot = await columns(schemas.bootstrap);
        for (const store of EVIDENCE_STORES) {
            const mine = boot.filter(row => row.table_name === store.table).map(row => row.column_name);
            expect(mine).toContain('invalidated_at');
            expect(mine).toContain('invalidated_reason');
            // And the two that had no key of their own get one, as an array:
            // a judged conversation can cross two releases.
            if (store.recordedColumn) expect(mine).toContain(store.recordedColumn.name);
        }
    });

    it('leaves a row that was already there alone', async () => {
        // The migration must not decide anything about existing evidence. A row
        // written before the mark existed names no release, so nothing can match
        // it — and invalidating on suspicion would throw away evidence that may
        // be perfectly sound.
        const table = EVIDENCE_STORES[0].table;
        await q(`INSERT INTO "${schemas.migrated}"."${table}"(id) VALUES(gen_random_uuid())`);
        const [row] = await q(`SELECT invalidated_at, invalidated_reason FROM "${schemas.migrated}"."${table}"`);
        expect(row.invalidated_at).toBeNull();
        expect(row.invalidated_reason).toBeNull();
    });

    it('is additive, so the old code can keep running during a rolling restart', () => {
        const migration = readFileSync(MIGRATION, 'utf8');
        // Unlike the certification migration, ALTER TABLE is the whole point
        // here — so the rule is not "no ALTER", it is that every ALTER may only
        // ADD COLUMN IF NOT EXISTS, and that nothing writes a row.
        const alters = migration.match(/ALTER TABLE[\s\S]*?(?=\$ddl\$)/gi) ?? [];
        expect(alters.length).toBe(EVIDENCE_STORES.length);
        for (const alter of alters) {
            const clauses = alter.replace(/ALTER TABLE[^\n]*\n/i, '').split(',').map(part => part.trim()).filter(Boolean);
            expect(clauses.length).toBeGreaterThan(0);
            for (const clause of clauses) expect(clause).toMatch(/^ADD COLUMN IF NOT EXISTS\b/i);
        }
        expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|SCHEMA)\b/i);
        expect(migration).not.toMatch(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE)\b/i);
        expect(migration).not.toMatch(/\bSET\s+NOT\s+NULL\b|\bDEFAULT\b/i);
    });
});
