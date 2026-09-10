import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

/**
 * ═══ DOS DEFINICIONES DE LAS MISMAS DOS TABLAS ═══
 *
 * El libro de gasto de WhatsApp se crea por dos caminos que no pueden verse
 * entre sí: `prisma/tenant-schema.sql` define el tenant NUEVO, y la migración
 * `20260910120000_add_whatsapp_spend_ledger` alcanza a los que ya existían.
 *
 * Si divergen, el defecto no aparece al desplegar. Aparece meses después, en el
 * tenant que resultó haberse creado por el camino equivocado, y con dinero de
 * por medio: un CHECK que falta no rompe nada visible, sólo acepta la fila que
 * el invariante prohíbe —una reserva `held` que ya dice tener un cobro, un
 * contador que limita dinero Y mensajes a la vez— y a partir de ahí lo que la
 * plataforma cree que autorizó y lo que Meta factura son dos números distintos.
 *
 * Todo corre dentro de UNA transacción que termina en ROLLBACK. El DDL de
 * PostgreSQL es transaccional, así que la prueba puede tocar `public.tenants` y
 * `public.channel_accounts` —estado compartido entre los workers de Jest— sin
 * dejar nada atrás.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

const TABLES = ['whatsapp_spend_counters', 'whatsapp_spend_reservations'];
const MIGRATION = '20260910120000_add_whatsapp_spend_ledger';

integration('the two definitions of the WhatsApp spend ledger agree', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const fresh = `tenant_spend_fresh_${suffix}`;
    const migrated = `tenant_spend_migr_${suffix}`;
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
        await q('BEGIN');

        // 1. The checked-in definition of a brand new tenant.
        await q(`CREATE SCHEMA "${fresh}"`);
        const tenantSchema = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing:WHATSAPP SPEND LEDGER');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', fresh));
        }

        // 2. The migration, driven by a tenants row exactly as it will be in
        //    production — including the loop and the schema lookup it does.
        await q(`CREATE SCHEMA "${migrated}"`);
        // `public.tenants` is provisioned for every worker by the global setup
        // and has no default on `id`, exactly as production does not — so the
        // id is supplied rather than assumed. `IF NOT EXISTS` is the fallback
        // for a database that has neither table yet; on one that has them this
        // is a no-op and the real shapes are what the migration meets.
        await q(`CREATE TABLE IF NOT EXISTS public.tenants(
            id UUID PRIMARY KEY, schema_name TEXT NOT NULL)`);
        await q(`CREATE TABLE IF NOT EXISTS public.channel_accounts(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT,
            channel_type TEXT, account_id TEXT)`);
        await q('INSERT INTO public.tenants(id, schema_name) VALUES(gen_random_uuid(), $1)', [migrated]);
        await q(readFileSync(resolve(__dirname,
            `../../../../prisma/migrations/${MIGRATION}/migration.sql`), 'utf8'));
    });

    afterAll(async () => {
        if (!client) return;
        // Nothing to drop: the ROLLBACK undoes the schemas, the tables and the
        // column on `channel_accounts` together.
        try { await q('ROLLBACK'); } finally { await client.end(); }
    });

    const columns = (schema: string) => q(
        `SELECT table_name, column_name, data_type, is_nullable, column_default,
                character_maximum_length
         FROM information_schema.columns WHERE table_schema=$1 AND table_name = ANY($2)
         ORDER BY table_name, column_name`, [schema, TABLES]);

    // The name is deliberately excluded for constraints PostgreSQL names itself:
    // what has to match is the rule, not the label a generator produced.
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

    it('creates both tables through both paths', async () => {
        for (const schema of [fresh, migrated]) {
            const seen = (await q(`SELECT table_name FROM information_schema.tables
                WHERE table_schema=$1 AND table_name = ANY($2) ORDER BY table_name`, [schema, TABLES]))
                .map(row => row.table_name);
            expect(seen).toEqual([...TABLES].sort());
        }
    });

    it('gives every column the same type, nullability and default', async () => {
        expect(await columns(migrated)).toEqual(await columns(fresh));
    });

    it('enforces the same constraints, including every CHECK', async () => {
        const rules = (rows: any[]) => rows.map(row => `${row.table_name} ${row.definition}`);
        const expected = rules(await checks(fresh));
        // A guard against both sides being empty and agreeing about nothing.
        expect(expected.length).toBeGreaterThanOrEqual(8);
        expect(rules(await checks(migrated))).toEqual(expected);
    });

    it('creates the same indexes, with the same partial predicates', async () => {
        // The partial predicate is the point: the sweeper looks for expired
        // leases among held rows, and without `WHERE state IN (…)` that read
        // becomes a sequential scan of every reservation ever taken.
        const defs = (rows: any[]) => rows.map(row => `${row.indexname} ${row.definition}`);
        const expected = defs(await indexes(fresh));
        expect(expected.some(def => def.includes('WHERE'))).toBe(true);
        expect(defs(await indexes(migrated))).toEqual(expected);
    });

    it('refuses a reservation with no lease, in both shapes', async () => {
        // `lease_expires_at` is NOT NULL because a held row without one is
        // invisible to the sweeper — `lease < clock_timestamp()` is NULL, not
        // true — and would pin budget forever without appearing anywhere.
        for (const schema of [fresh, migrated]) {
            await q('SAVEPOINT probe');
            await expect(q(`INSERT INTO "${schema}".whatsapp_spend_reservations
                (effect_key, decision, basis, reserved_minor, unit_ceiling_minor,
                 currency, charged_deliveries, exact_micros)
                VALUES('e','accepted','service',8,80,'USD',1,800)`)).rejects.toThrow();
            await q('ROLLBACK TO SAVEPOINT probe');
        }
    });

    it('refuses a held row that already claims a charge, in both shapes', async () => {
        // `charged_minor IS NOT NULL` and `state = 'settled'` are the same fact.
        // Splitting them is how an unsettled reservation starts looking settled.
        for (const schema of [fresh, migrated]) {
            await q('SAVEPOINT probe');
            await expect(q(`INSERT INTO "${schema}".whatsapp_spend_reservations
                (effect_key, decision, basis, reserved_minor, unit_ceiling_minor,
                 currency, charged_deliveries, exact_micros, lease_expires_at, charged_minor)
                VALUES('e','accepted','service',8,80,'USD',1,800,clock_timestamp(),8)`)).rejects.toThrow();
            await q('ROLLBACK TO SAVEPOINT probe');
        }
    });

    it('refuses a counter that caps money and messages at once, in both shapes', async () => {
        // "10 dollars" and "1,000 messages" are different ceilings; one row
        // holding both makes "which one ran out?" unanswerable.
        for (const schema of [fresh, migrated]) {
            await q('SAVEPOINT probe');
            await expect(q(`INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_minor, cap_deliveries)
                VALUES('account','a','2026-10',1000,50)`)).rejects.toThrow();
            await q('ROLLBACK TO SAVEPOINT probe');
        }
    });

    it('refuses a second reservation for the same effect, in both shapes', async () => {
        // The unique key is what makes a retry adopt its own reservation
        // instead of taking a second one, which would be charging twice for a
        // message that may already have gone out.
        for (const schema of [fresh, migrated]) {
            await q('SAVEPOINT probe');
            const insert = `INSERT INTO "${schema}".whatsapp_spend_reservations
                (effect_key, decision, basis, reserved_minor, unit_ceiling_minor,
                 currency, charged_deliveries, exact_micros, lease_expires_at)
                VALUES('same-effect','accepted','service',8,80,'USD',1,800,clock_timestamp())`;
            await q(insert);
            await expect(q(insert)).rejects.toThrow();
            await q('ROLLBACK TO SAVEPOINT probe');
        }
    });

    describe('the WABA time zone the resolver needs', () => {
        it('adds a nullable column, because unknown must stay expressible', async () => {
            const [column] = await q(
                `SELECT data_type, is_nullable, character_maximum_length, column_default
                   FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='channel_accounts'
                    AND column_name='waba_timezone'`);
            expect(column).toBeDefined();
            expect(column.is_nullable).toBe('YES');
            // No default. A default would be a guessed zone, and a guessed zone
            // silently moves the effective date and the allowance month.
            expect(column.column_default).toBeNull();
        });

        it('refuses Meta\'s numeric timezone_id and accepts an IANA zone', async () => {
            // `meta-graph.service.ts` already reads `timezone_id` off the WABA,
            // and it is a numeric Facebook id, not a zone. Written here it would
            // make `Intl.DateTimeFormat` reject every price forever — a channel
            // that stopped delivering with no explanation. The database refusing
            // it turns that into a failure on the day it is written.
            await q('SAVEPOINT probe');
            await expect(q(`INSERT INTO public.channel_accounts(tenant_id, channel_type,
                account_id, waba_timezone) VALUES('t','whatsapp','n1','12')`)).rejects.toThrow();
            await q('ROLLBACK TO SAVEPOINT probe');

            await q('SAVEPOINT probe');
            for (const zone of ['America/Bogota', 'America/Argentina/Buenos_Aires', 'UTC']) {
                await q(`INSERT INTO public.channel_accounts(tenant_id, channel_type,
                    account_id, waba_timezone) VALUES('t','whatsapp',$1,$2)`, [zone, zone]);
                // A zone the CHECK admits must also be a zone the runtime can
                // format with, or the constraint is agreeing with itself.
                expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: zone })).not.toThrow();
            }
            await q('ROLLBACK TO SAVEPOINT probe');
        });
    });

    it('is safe to apply twice, which is what a re-run of the deploy does', async () => {
        await q('SAVEPOINT rerun');
        await q(readFileSync(resolve(__dirname,
            `../../../../prisma/migrations/${MIGRATION}/migration.sql`), 'utf8'));
        // Same shape after, not merely no exception: a second ADD CONSTRAINT
        // swallowed by the wrong exception class would leave the CHECK behind.
        const [column] = await q(
            `SELECT count(*)::int AS checks FROM pg_constraint
              WHERE conname = 'channel_accounts_waba_timezone_iana'`);
        expect(column.checks).toBe(1);
        await q('ROLLBACK TO SAVEPOINT rerun');
    });
});
