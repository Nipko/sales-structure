import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { DISPATCH_OUTBOX_DDL } from './agent-dispatch-outbox';
import { HANDOFF_RECEIPT_DDL } from '../handoff/handoff-receipt';
import { TURN_LEDGER_DDL } from '../conversations/agent-turn-ledger';
import { HANDOFF_EFFECTS_DDL } from '../handoff/handoff-effects';

/**
 * ═══ TRES DEFINICIONES DE LA MISMA TABLA ═══
 *
 * El outbox del despacho y el recibo de handoff se crean por tres caminos que
 * no pueden verse entre sí:
 *
 *   1. el bootstrap perezoso (`DISPATCH_OUTBOX_DDL`, `HANDOFF_RECEIPT_DDL`),
 *      que corre la primera vez que un tenant usa la tabla;
 *   2. `prisma/tenant-schema.sql`, que define el tenant NUEVO;
 *   3. la migración que las crea para los tenants que ya existían.
 *
 * Los tres tienen que producir exactamente la misma tabla. Si no, el defecto no
 * aparece al desplegar: aparece meses después, en el tenant que resultó haberse
 * creado por el camino equivocado, con una consulta que falla por una columna
 * que ahí no existe o un índice que no está y convierte una lectura de la cola
 * en un escaneo secuencial.
 *
 * Esta prueba aplica los tres a esquemas separados de una base desechable y
 * compara columnas, restricciones e índices. Es el único lugar que puede mirar
 * los tres a la vez.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

const TABLES = ['agent_dispatch_outbox', 'agent_dispatch_outbox_sources', 'agent_handoff_receipts',
    'agent_turn_ledger', 'agent_handoff_effects'];

integration('the three definitions of the dispatch tables agree', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const schemas = {
        bootstrap: `tenant_parity_boot_${suffix}`,
        fresh: `tenant_parity_fresh_${suffix}`,
        migrated: `tenant_parity_migr_${suffix}`,
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

        // 1. Lazy bootstrap: the constants the runtime executes itself.
        await q(`SET search_path TO "${schemas.bootstrap}"`);
        for (const sql of [...HANDOFF_RECEIPT_DDL, ...DISPATCH_OUTBOX_DDL, ...TURN_LEDGER_DDL,
            ...HANDOFF_EFFECTS_DDL]) await q(sql);
        await q('SET search_path TO public');

        // 2. The checked-in definition of a brand new tenant.
        const tenantSchema = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        for (const marker of ['CANONICAL HANDOFF RECEIPT', 'AGENT TURN LEDGER',
            'AGENT HANDOFF EFFECTS', 'NORMAL DISPATCH OUTBOX']) {
            const block = tenantSchema.split(`-- BEGIN ${marker}`)[1]?.split(`-- END ${marker}`)[0];
            if (!block) throw new Error(`tenant_schema_block_missing:${marker}`);
            for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
                await q(statement.replaceAll('{{SCHEMA_NAME}}', schemas.fresh));
            }
        }

        // 3. The migration, driven by a tenants row exactly as it will be in
        //    production — including the loop and the schema lookup it does.
        await q('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY, schema_name TEXT NOT NULL)');
        const tenantId = randomUUID();
        await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [tenantId, schemas.migrated]);
        try {
            // Every migration that touches these tables, in the order the deploy
            // applies them. A table added by a later one is as much part of the
            // production shape as the first.
            for (const name of ['20260908150000_backfill_agent_dispatch_tenant_tables',
                '20260908180000_add_agent_turn_ledger',
                '20260908190000_add_agent_handoff_effects']) {
                await q(readFileSync(resolve(__dirname,
                    `../../../prisma/migrations/${name}/migration.sql`), 'utf8'));
            }
        } finally {
            await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]);
        }
    });

    afterAll(async () => {
        if (!client) return;
        try {
            for (const schema of Object.values(schemas)) {
                if (!/^tenant_parity_[a-z]+_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
                await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            }
        } finally { await client.end(); }
    });

    const columns = (schema: string) => q(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_schema=$1 AND table_name = ANY($2)
         ORDER BY table_name, column_name`, [schema, TABLES]);

    // The name is deliberately excluded from the comparison for constraints
    // PostgreSQL names itself (primary keys, uniques): what has to match is the
    // rule, not the label a generator happened to produce.
    const checks = (schema: string) => q(
        // The schema name is stripped from the definition: a foreign key renders
        // its target fully qualified, and comparing that would only ever show
        // that the three schemas have different names.
        `SELECT rel.relname AS table_name, con.conname,
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

    it('enforces the same constraints, including every CHECK', async () => {
        // A missing CHECK is the dangerous drift: the table looks right and
        // accepts a row the invariant forbids — an `admitted` state with no
        // lease, or a redacted row that still carries its payload.
        const [boot, fresh, migrated] = await forEachSchema(checks);
        const rules = (rows: any[]) => rows.map(row => `${row.table_name} ${row.definition}`);
        expect(rules(fresh)).toEqual(rules(boot));
        expect(rules(migrated)).toEqual(rules(boot));
    });

    it('creates the same indexes, with the same partial predicates', async () => {
        // The predicates are the point: `WHERE state='admitted'` is what keeps
        // the lease sweep off a sequential scan of every dispatched row.
        const [boot, fresh, migrated] = await forEachSchema(indexes);
        const defs = (rows: any[]) => rows.map(row => `${row.indexname} ${row.definition}`);
        expect(defs(fresh)).toEqual(defs(boot));
        expect(defs(migrated)).toEqual(defs(boot));
    });

    it('widens a schema bootstrapped before the later columns existed', async () => {
        // A tenant that started the outbox on an older build has the table but
        // not `settled_lease_token` / `message_id` / `effects`, and CREATE TABLE
        // IF NOT EXISTS would leave it that way. The migration has to reach it.
        const legacy = `tenant_parity_legacy_${suffix}`;
        await q(`CREATE SCHEMA "${legacy}"`);
        await q(`SET search_path TO "${legacy}"`);
        // The real earlier shape: everything the bootstrap made then, minus
        // exactly the three columns added afterwards. Inventing a thinner table
        // would test a schema that never existed.
        await q(`CREATE TABLE agent_dispatch_outbox (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), batch_id UUID NOT NULL,
            conversation_id UUID, contact_id UUID, inbound_message_id UUID NOT NULL,
            channel_type TEXT NOT NULL, channel_account_id TEXT NOT NULL, recipient TEXT,
            item_index INTEGER NOT NULL, item_kind TEXT NOT NULL, payload JSONB,
            operational_scope JSONB NOT NULL DEFAULT '{}'::jsonb, learning_footprint JSONB,
            state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            lease_token UUID, lease_expires_at TIMESTAMPTZ,
            available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), error_code TEXT, receipt TEXT,
            redacted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await q(`CREATE TABLE agent_handoff_receipts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID NOT NULL,
            contact_id UUID NOT NULL, inbound_message_id UUID NOT NULL UNIQUE,
            channel_type TEXT NOT NULL, channel_account_id TEXT NOT NULL, reason TEXT NOT NULL,
            from_status TEXT NOT NULL, to_status TEXT NOT NULL, notice_kind TEXT NOT NULL,
            notice_language TEXT NOT NULL, trace_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await q('SET search_path TO public');

        const tenantId = randomUUID();
        await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [tenantId, legacy]);
        try {
            await q(readFileSync(resolve(__dirname,
                '../../../prisma/migrations/20260908150000_backfill_agent_dispatch_tenant_tables/migration.sql'), 'utf8'));
        } finally {
            await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]);
        }

        const added = (await q(
            `SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema=$1 AND column_name = ANY($2) ORDER BY table_name, column_name`,
            [legacy, ['settled_lease_token', 'message_id', 'effects']])).map(row => `${row.table_name}.${row.column_name}`);
        expect(added).toEqual([
            'agent_dispatch_outbox.message_id',
            'agent_dispatch_outbox.settled_lease_token',
            'agent_handoff_receipts.effects',
        ]);
        await q(`DROP SCHEMA IF EXISTS "${legacy}" CASCADE`);
    });

    it('is safe to apply twice and skips a schema that no longer exists', async () => {
        // Migrations get re-run on a restored database, and `tenants` can name a
        // schema that a purge already removed. Neither may abort the pass.
        const missing = randomUUID();
        await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)',
            [missing, `tenant_parity_gone_${suffix}`]);
        const tenantId = randomUUID();
        await q('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [tenantId, schemas.migrated]);
        try {
            const migration = readFileSync(resolve(__dirname,
                '../../../prisma/migrations/20260908150000_backfill_agent_dispatch_tenant_tables/migration.sql'), 'utf8');
            await expect(q(migration)).resolves.toBeDefined();
        } finally {
            await q('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[missing, tenantId]]);
        }
        const boot = await columns(schemas.bootstrap);
        const migrated = await columns(schemas.migrated);
        expect(migrated).toEqual(boot);
    });
});
