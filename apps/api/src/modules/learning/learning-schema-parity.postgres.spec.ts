import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { LEARNING_SCHEMA } from './learning-schema';

/**
 * ═══ TRES DEFINICIONES DE LAS MISMAS CUATRO TABLAS ═══
 *
 * Las tablas de aprendizaje se crean por tres caminos que no pueden verse entre
 * sí:
 *
 *   1. el bootstrap perezoso (`LEARNING_SCHEMA`), que corre la primera vez que
 *      un tenant usa la tabla;
 *   2. `prisma/tenant-schema.sql`, que define el tenant NUEVO;
 *   3. la migración, que las alcanza en los tenants que ya existían.
 *
 * Los tres tienen que producir exactamente la misma tabla, y aquí ya se
 * separaron una vez: `retired_by` y `retired_at` se agregaron dentro del
 * `CREATE TABLE IF NOT EXISTS`, que en un tenant cuya tabla ya existía no
 * agrega nada. El rollback —la operación que retracta palabras publicadas—
 * habría fallado con 42703 en producción, en el único tenant que importaba: el
 * que ya venía usando aprendizaje.
 *
 * Esa clase de defecto no aparece al desplegar. Aparece meses después, en el
 * tenant que resultó haberse creado por el camino equivocado. Esta prueba
 * aplica los tres a esquemas separados de una base desechable y compara
 * columnas, restricciones e índices; es el único lugar que puede mirar los tres
 * a la vez.
 */
const connection = process.env.LEARNING_EVIDENCE_TEST_DATABASE_URL;
const integration = connection ? describe : describe.skip;

const TABLES = ['learning_sources', 'learning_examples', 'learning_releases', 'learning_reviews', 'learning_evaluation_budget'];
// In deploy order. A second migration is not a replacement for the first: the
// aged tenant needs both applied, in sequence, to reach the shape the bootstrap
// constant produces in one pass.
const MIGRATIONS = ['20260908210000_provision_learning_tables', '20260908220000_bound_learning_evaluation_cost_and_deadline'];
const WIDENED = ['evaluation_deadline_at', 'evaluation_namespaces', 'retired_at', 'retired_by', 'source_evidence'];
const migrations = () => MIGRATIONS.map(name =>
    readFileSync(resolve(__dirname, `../../../prisma/migrations/${name}/migration.sql`), 'utf8'));

integration('the three definitions of the learning tables agree', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const schemas = {
        bootstrap: `tenant_lparity_boot_${suffix}`,
        fresh: `tenant_lparity_fresh_${suffix}`,
        migrated: `tenant_lparity_migr_${suffix}`,
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
        // `learning_examples.embedding` is `vector(1536)`; without the extension
        // none of the three paths can build the table at all.
        await q('CREATE EXTENSION IF NOT EXISTS vector');
        for (const schema of Object.values(schemas)) await q(`CREATE SCHEMA "${schema}"`);

        // 1. Lazy bootstrap: the constant the runtime executes itself.
        // `, public` mirrors `PrismaService.executeInTenantSchema`, which is how
        // the runtime actually runs this constant — and it is what makes the
        // unqualified `vector` type in `learning_examples` resolvable.
        await q(`SET search_path TO "${schemas.bootstrap}", public`);
        for (const sql of LEARNING_SCHEMA) await q(sql);
        await q('SET search_path TO public');

        // 2. The checked-in definition of a brand new tenant.
        const tenantSchema = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN LEARNING TABLES')[1]?.split('-- END LEARNING TABLES')[0];
        if (!block) throw new Error('tenant_schema_block_missing:LEARNING TABLES');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', schemas.fresh));
        }

        // 3. The migration, driven by a tenants row exactly as it will be in
        //    production — including the loop and the schema lookup it does.
        await q('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY, schema_name TEXT NOT NULL)');
        const tenantId = randomUUID();
        await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [tenantId, schemas.migrated]);
        try {
            for (const migration of migrations()) await q(migration);
        } finally {
            await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]);
        }
    });

    afterAll(async () => {
        if (!client) return;
        try {
            for (const schema of Object.values(schemas)) {
                if (!/^tenant_lparity_[a-z]+_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
                await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            }
        } finally { await client.end(); }
    });

    const columns = (schema: string) => q(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_schema=$1 AND table_name = ANY($2)
         ORDER BY table_name, column_name`, [schema, TABLES]);

    // The name is deliberately excluded for constraints PostgreSQL names itself:
    // what has to match is the rule, not the label a generator produced. The
    // schema name is stripped from the definition because a foreign key renders
    // its target fully qualified, and comparing that would only ever show that
    // the three schemas have different names.
    const checks = (schema: string) => q(
        `SELECT rel.relname AS table_name,
                replace(pg_get_constraintdef(con.oid), $1 || '.', '') AS definition
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname=$1 AND rel.relname = ANY($2)
         ORDER BY rel.relname, pg_get_constraintdef(con.oid)`, [schema, TABLES]);

    const indexes = (schema: string) => q(
        `SELECT tablename, indexname, regexp_replace(indexdef, '"?' || $1 || '"?\\.', '') AS definition
         FROM pg_indexes WHERE schemaname=$1 AND tablename = ANY($2)
         ORDER BY tablename, indexname`, [schema, TABLES]);

    /** One connection, one query at a time: `pg` deprecates overlapping calls. */
    async function forEachSchema<T>(read: (schema: string) => Promise<T>): Promise<[T, T, T]> {
        const out: T[] = [];
        for (const schema of Object.values(schemas)) out.push(await read(schema));
        return out as [T, T, T];
    }

    it('creates the same tables through all three paths', async () => {
        const seen = await forEachSchema(async schema =>
            (await q(`SELECT table_name FROM information_schema.tables
                      WHERE table_schema=$1 AND table_name = ANY($2) ORDER BY table_name`, [schema, TABLES]))
                .map(row => row.table_name));
        for (const tables of seen) expect(tables).toEqual([...TABLES].sort());
    });

    it('gives every column the same type, nullability and default', async () => {
        const [boot, fresh, migrated] = await forEachSchema(columns);
        expect(fresh).toEqual(boot);
        expect(migrated).toEqual(boot);
    });

    it('reaches tables that already existed with the columns added since', async () => {
        // The case a CREATE cannot serve, and the only one that matters: a tenant
        // whose tables predate the widenings. Built from the same bootstrap
        // constant with the ALTERs held back, which is exactly the shape those
        // tenants have — not a hand-written stand-in that would also let a
        // broken index definition pass.
        const aged = `tenant_lparity_aged_${suffix}`;
        const tenantId = randomUUID();
        await q(`CREATE SCHEMA "${aged}"`);
        try {
            await q(`SET search_path TO "${aged}", public`);
            for (const sql of LEARNING_SCHEMA) if (!/^\s*ALTER TABLE/.test(sql)) await q(sql);
            // A table added after the tenant was created is the other half of
            // the same case: an aged tenant does not have it, and the bootstrap
            // constant cannot be used to pretend it does. Dropping it here is
            // what makes the migration prove it reaches such a tenant, rather
            // than no-opping over a table the constant just built.
            await q('DROP TABLE learning_evaluation_budget');
            await q('SET search_path TO public');
            const before = (await q(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema=$1 AND column_name = ANY($2)`, [aged, WIDENED])).length;
            expect(before).toBe(0);

            await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [tenantId, aged]);
            for (const migration of migrations()) await q(migration);

            const widened = (await q(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema=$1 AND table_name IN ('learning_releases','learning_sources')
                   AND column_name = ANY($2) ORDER BY column_name`, [aged, WIDENED])).map(row => row.column_name);
            expect(widened).toEqual([...WIDENED].sort());

            // And it lands on the same shape as every other path, so an aged
            // tenant is not left one migration behind for the next reader.
            expect(await columns(aged)).toEqual(await columns(schemas.bootstrap));
        } finally {
            await q('SET search_path TO public');
            await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]);
            await q(`DROP SCHEMA IF EXISTS "${aged}" CASCADE`);
        }
    });

    it('gives every table the same constraints and the same indexes', async () => {
        const [bootChecks, freshChecks, migratedChecks] = await forEachSchema(checks);
        expect(freshChecks).toEqual(bootChecks);
        expect(migratedChecks).toEqual(bootChecks);

        const [bootIndexes, freshIndexes, migratedIndexes] = await forEachSchema(indexes);
        const names = (rows: any[]) => rows.map(row => `${row.tablename}:${row.definition}`);
        expect(names(freshIndexes)).toEqual(names(bootIndexes));
        expect(names(migratedIndexes)).toEqual(names(bootIndexes));
    });
});
