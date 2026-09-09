import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { CERTIFICATION_LEDGER_DDL } from './certification-ledger';
import { BENCHMARK_LEDGER_DDL } from './benchmark-harness';
import { COMMITMENT_PROPOSAL_DDL } from '../conversations/commitment-proposal';

/**
 * Tres definiciones de las mismas tablas.
 *
 * El ejecutor de certificación creaba sus tablas por una función sin llamador,
 * que es la peor forma posible de instalar un schema: un tenant nuevo no las
 * tenía, uno viejo tampoco, y la única manera de que existieran era que alguien
 * ejecutara a mano la función. Ahora hay tres caminos y tienen que producir la
 * misma tabla:
 *
 *   1. el bootstrap perezoso (`CERTIFICATION_LEDGER_DDL`, `BENCHMARK_LEDGER_DDL`);
 *   2. `prisma/tenant-schema.sql`, que define el tenant NUEVO;
 *   3. la migración, para los tenants que ya existían.
 *
 * Los dos artefactos SQL se generan desde las constantes, así que la divergencia
 * tendría que venir de una edición a mano — y es exactamente esa la que esta
 * prueba atrapa.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

const TABLES = ['agent_certification_runs', 'agent_certification_subjects', 'agent_certification_cases',
    'benchmark_attempts', 'benchmark_reviews', 'commitment_proposals'];

integration('the three definitions of the certification tables agree', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const schemas = {
        bootstrap: `tenant_cert_boot_${suffix}`,
        fresh: `tenant_cert_fresh_${suffix}`,
        migrated: `tenant_cert_migr_${suffix}`,
    };
    let client: Client;
    jest.setTimeout(120_000);
    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        for (const schema of Object.values(schemas)) await q(`CREATE SCHEMA "${schema}"`);

        // 1. What the runtime executes itself the first time a tenant needs it.
        await q(`SET search_path TO "${schemas.bootstrap}"`);
        for (const sql of [...CERTIFICATION_LEDGER_DDL, ...BENCHMARK_LEDGER_DDL, ...COMMITMENT_PROPOSAL_DDL]) await q(sql);
        await q('SET search_path TO public');

        // 2. The checked-in definition of a brand new tenant.
        const template = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const block = template.split('-- BEGIN AGENT CERTIFICATION LEDGER')[1]
            ?.split('-- END AGENT CERTIFICATION LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing:AGENT CERTIFICATION LEDGER');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', schemas.fresh));
        }

        // 3. The migration, driven by a tenants row exactly as production will.
        await q('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY, schema_name TEXT NOT NULL)');
        const tenantId = randomUUID();
        await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [tenantId, schemas.migrated]);
        try {
            await q(readFileSync(resolve(__dirname,
                '../../../prisma/migrations/20260909120000_add_agent_certification_ledger/migration.sql'), 'utf8'));
        } finally {
            await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]);
        }
    });

    afterAll(async () => {
        if (!client) return;
        try {
            for (const schema of Object.values(schemas)) {
                if (!/^tenant_cert_[a-z]+_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
                await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            }
        } finally { await client.end(); }
    });

    const columns = (schema: string) => q(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
           FROM information_schema.columns WHERE table_schema=$1 AND table_name = ANY($2)
          ORDER BY table_name, column_name`, [schema, TABLES]);

    const checks = (schema: string) => q(
        `SELECT rel.relname AS table_name,
                replace(pg_get_constraintdef(con.oid), $1 || '.', '') AS definition
           FROM pg_constraint con
           JOIN pg_class rel ON rel.oid = con.conrelid
           JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
          WHERE nsp.nspname = $1 AND rel.relname = ANY($2)
          ORDER BY rel.relname, definition`, [schema, TABLES]);

    const indexes = (schema: string) => q(
        `SELECT tablename AS table_name, replace(indexdef, $1 || '.', '') AS definition
           FROM pg_indexes WHERE schemaname=$1 AND tablename = ANY($2)
          ORDER BY tablename, definition`, [schema, TABLES]);

    it('creates the same tables by all three paths', async () => {
        const [boot, fresh, migrated] = await Promise.all(TABLES.map(() => null))
            .then(() => Promise.all([columns(schemas.bootstrap), columns(schemas.fresh), columns(schemas.migrated)]));
        // A path that created nothing would make the comparison trivially true.
        expect(boot.length).toBeGreaterThan(30);
        expect(fresh).toEqual(boot);
        expect(migrated).toEqual(boot);
    });

    it('applies the same constraints by all three paths', async () => {
        const [boot, fresh, migrated] = await Promise.all([
            checks(schemas.bootstrap), checks(schemas.fresh), checks(schemas.migrated)]);
        expect(boot.length).toBeGreaterThan(0);
        expect(fresh).toEqual(boot);
        expect(migrated).toEqual(boot);
    });

    it('builds the same indexes by all three paths', async () => {
        const [boot, fresh, migrated] = await Promise.all([
            indexes(schemas.bootstrap), indexes(schemas.fresh), indexes(schemas.migrated)]);
        // The claimable index is what keeps a lease from being a sequential scan
        // over a run of 78.120 rows; losing it on one path only would show up as
        // a mysteriously slow tenant.
        expect(boot.some(row => String(row.definition).includes('idx_certification_case_claimable'))).toBe(true);
        expect(fresh).toEqual(boot);
        expect(migrated).toEqual(boot);
    });

    it('is additive, so the old code can keep running during a rolling restart', () => {
        const migration = readFileSync(resolve(__dirname,
            '../../../prisma/migrations/20260909120000_add_agent_certification_ledger/migration.sql'), 'utf8');
        // Expand-contract: this deploy may only add. A DROP, an ALTER or a write
        // here would run against code that has not restarted yet.
        //
        // Matched as STATEMENTS, not as words: the proposal table's CHECK lists
        // `'update'` as one of its allowed actions, and a bare word match called
        // that a destructive migration.
        const statements = migration
            .replace(/CHECK \([^)]*\)/gi, '')
            .split(/;|\bEXECUTE format\(\$ddl\$/i)
            .map(part => part.trim());
        for (const statement of statements) {
            expect(statement).not.toMatch(/^\s*(DROP|ALTER|UPDATE|DELETE|INSERT INTO|TRUNCATE)\b/i);
        }
        expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bALTER\s+TABLE\b/i);
        expect((migration.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length).toBe(6);
    });
});
