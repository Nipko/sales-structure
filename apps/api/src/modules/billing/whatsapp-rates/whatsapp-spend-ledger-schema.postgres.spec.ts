import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { ensureSyntheticGlobalTables } from '../../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ DOS DEFINICIONES DE LAS MISMAS TRES TABLAS ═══
 *
 * El libro de gasto de WhatsApp se crea por dos caminos que no pueden verse
 * entre sí: `prisma/tenant-schema.sql` define el tenant NUEVO, y la migración
 * `20260910120000_add_whatsapp_spend_ledger` alcanza a los que ya existían.
 *
 * Si divergen, el defecto no aparece al desplegar. Aparece meses después, en el
 * tenant que resultó haberse creado por el camino equivocado, y con dinero de
 * por medio: un CHECK que falta no rompe nada visible, sólo acepta la fila que
 * el invariante prohíbe —una reserva `held` que ya dice tener un cobro, un
 * contador que limita dinero Y mensajes a la vez, una asignación contra un
 * contador que no existe— y a partir de ahí lo que la plataforma cree que
 * autorizó y lo que Meta factura son dos números distintos.
 *
 * Todo corre dentro de UNA transacción que termina en ROLLBACK. El DDL de
 * PostgreSQL es transaccional, así que la prueba puede tocar `public.tenants` y
 * `public.channel_accounts` —estado compartido entre los workers de Jest— sin
 * dejar nada atrás.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

const TABLES = ['whatsapp_spend_counters', 'whatsapp_spend_reservations',
    'whatsapp_spend_allocations'];
const MIGRATION = '20260910120000_add_whatsapp_spend_ledger';

integration('the two definitions of the WhatsApp spend ledger agree', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const fresh = `tenant_spend_fresh_${suffix}`;
    const migrated = `tenant_spend_migr_${suffix}`;
    const TENANT = randomUUID();
    let client: Client;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

    /** A complete reservation: every NOT NULL the identity snapshot demands. */
    const reservation = (schema: string, over: Record<string, unknown> = {}) => {
        const row: Record<string, unknown> = {
            effect_key: `eff-${randomUUID()}`,
            tenant_id: TENANT, channel_type: 'whatsapp', channel_account_id: '15550001111',
            payer_kind: 'business_direct', payer_waba_id: 'waba-1', payer_business_id: 'biz-1',
            credential_id: 'cred-1', credential_source: 'system_user',
            recipient_scope: 'customer', recipient_ref: 'contact-1',
            category: 'service', market: 'CO', currency: 'USD',
            admission_reason: 'inbound_reply', basis: 'priced', decision: 'accepted',
            reserved_minor: 8, unit_ceiling_minor: 80, exact_micros: 800,
            lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
            ...over,
        };
        const columns = Object.keys(row);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
        return q(`INSERT INTO "${schema}".whatsapp_spend_reservations (${columns.join(',')})
                  VALUES (${placeholders}) RETURNING id`, Object.values(row));
    };

    const counter = (schema: string, over: Record<string, unknown> = {}) => {
        const row: Record<string, unknown> = {
            scope_kind: 'account', scope_key: 'acc-1', period_key: '2026-10',
            cap_kind: 'money', cap_minor: 1000, currency: 'USD', ...over,
        };
        const columns = Object.keys(row);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
        return q(`INSERT INTO "${schema}".whatsapp_spend_counters (${columns.join(',')})
                  VALUES (${placeholders})`, Object.values(row));
    };

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
        await ensureSyntheticGlobalTables(sql => q(sql));
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

    it('creates all three tables through both paths', async () => {
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

    it('enforces the same constraints, including every CHECK and the foreign keys', async () => {
        const rules = (rows: any[]) => rows.map(row => `${row.table_name} ${row.definition}`);
        const expected = rules(await checks(fresh));
        // A guard against both sides being empty and agreeing about nothing.
        expect(expected.length).toBeGreaterThanOrEqual(14);
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

    describe.each([['fresh'], ['migrated']])('the invariants of the %s shape', label => {
        const schema = () => (label === 'fresh' ? fresh : migrated);

        const refuses = async (work: () => Promise<unknown>) => {
            await q('SAVEPOINT probe');
            let refused = false;
            try { await work(); } catch { refused = true; }
            await q('ROLLBACK TO SAVEPOINT probe');
            return refused;
        };

        it('accepts a complete reservation, so the refusals below mean something', async () => {
            expect(await refuses(() => reservation(schema()))).toBe(false);
        });

        it('refuses a reservation with no lease', async () => {
            // `lease_expires_at` is NOT NULL because a held row without one is
            // invisible to the sweeper — `lease < clock_timestamp()` is NULL, not
            // true — and would pin budget forever without appearing anywhere.
            expect(await refuses(() => reservation(schema(), { lease_expires_at: null }))).toBe(true);
        });

        it('refuses a reservation with no identity to retry against', async () => {
            // Each of these is what a retry adopts instead of resolving again.
            for (const missing of ['tenant_id', 'channel_account_id', 'credential_id',
                'credential_source', 'recipient_ref', 'category', 'currency', 'admission_reason']) {
                expect({ missing, refused: await refuses(() => reservation(schema(), { [missing]: null })) })
                    .toEqual({ missing, refused: true });
            }
        });

        it('refuses a held row that already claims a charge', async () => {
            expect(await refuses(() => reservation(schema(), { charged_minor: 8 }))).toBe(true);
        });

        it('refuses a settled row with no charge and one with no evidence', async () => {
            // `settled` and `charged_minor IS NOT NULL` are the same fact, and a
            // settlement that cannot say what allowed it is an assertion the row
            // cannot defend.
            expect(await refuses(() => reservation(schema(),
                { state: 'settled', evidence: 'delivery_receipt' }))).toBe(true);
            expect(await refuses(() => reservation(schema(),
                { state: 'settled', charged_minor: 8 }))).toBe(true);
            expect(await refuses(() => reservation(schema(),
                { state: 'released' }))).toBe(true);
            expect(await refuses(() => reservation(schema(),
                { state: 'settled', charged_minor: 8, evidence: 'delivery_receipt' }))).toBe(false);
        });

        it('refuses a second reservation for the same effect', async () => {
            // The unique key is what makes a retry adopt its own reservation
            // instead of taking a second one, which would be charging twice for a
            // message that may already have gone out.
            const key = `same-effect-${label}`;
            expect(await refuses(async () => {
                await reservation(schema(), { effect_key: key });
                await reservation(schema(), { effect_key: key });
            })).toBe(true);
        });

        it('refuses a counter that caps money and messages at once', async () => {
            // "10 dollars" and "1,000 messages" are different ceilings; one row
            // holding both makes "which one ran out?" unanswerable.
            expect(await refuses(() => counter(schema(),
                { cap_kind: 'money', cap_minor: 10, cap_deliveries: 50 }))).toBe(true);
            expect(await refuses(() => counter(schema(),
                { cap_kind: 'deliveries', cap_minor: 10, cap_deliveries: 50, currency: null }))).toBe(true);
        });

        it('refuses a money counter with no currency', async () => {
            // Summing two currencies into one number is not a total.
            expect(await refuses(() => counter(schema(), { currency: null }))).toBe(true);
        });

        it('accepts an observe-only counter, which is where a tenant starts', async () => {
            // Counting without stopping anybody is an explicit state, not the
            // absence of a cap — otherwise "no limit configured" and "limit of
            // zero" would be the same row.
            expect(await refuses(() => counter(schema(), {
                scope_kind: 'contact', scope_key: 'c-1', period_key: '2026-10',
                cap_kind: 'observe', cap_minor: null, currency: null,
            }))).toBe(false);
        });

        it('refuses an allocation against a counter that does not exist', async () => {
            // The foreign key. Without it a reservation could allocate into
            // nowhere and the money would leave with nothing counting it.
            expect(await refuses(async () => {
                const [row] = await reservation(schema());
                await q(`INSERT INTO "${schema()}".whatsapp_spend_allocations
                    (reservation_id, scope_kind, scope_key, period_key, amount_minor)
                    VALUES ($1::uuid,'account','nobody','2026-10',8)`, [row.id]);
            })).toBe(true);
        });

        it('refuses the same reservation touching one counter twice', async () => {
            // A retry or a race that allocated twice would double the exposure
            // against a cap that only ever authorised it once.
            expect(await refuses(async () => {
                await counter(schema(), { scope_key: `dup-${label}` });
                const [row] = await reservation(schema());
                const insert = `INSERT INTO "${schema()}".whatsapp_spend_allocations
                    (reservation_id, scope_kind, scope_key, period_key, amount_minor)
                    VALUES ($1::uuid,'account',$2,'2026-10',8)`;
                await q(insert, [row.id, `dup-${label}`]);
                await q(insert, [row.id, `dup-${label}`]);
            })).toBe(true);
        });

        it('lets one reservation allocate to several counters at once', async () => {
            // The whole reason the third table exists: an effect crosses the
            // account ceiling, the contact ceiling and the number's free
            // allowance, and releasing it has to give all of them back.
            expect(await refuses(async () => {
                const scopes: [string, string, string][] = [
                    ['account', `multi-a-${label}`, '2026-10'],
                    ['contact', `multi-c-${label}`, '2026-10'],
                    ['number_month', `multi-n-${label}`, '2026-10'],
                ];
                for (const [kind, key, period] of scopes) {
                    await counter(schema(), { scope_kind: kind, scope_key: key, period_key: period });
                }
                const [row] = await reservation(schema());
                for (const [kind, key, period] of scopes) {
                    await q(`INSERT INTO "${schema()}".whatsapp_spend_allocations
                        (reservation_id, scope_kind, scope_key, period_key, amount_minor)
                        VALUES ($1::uuid,$2,$3,$4,8)`, [row.id, kind, key, period]);
                }
            })).toBe(false);
        });

        it('carries the outbox item the effect belongs to', async () => {
            // Reconciliation starts from the dispatch row, so the link has to be
            // on the reservation rather than inferred from timing.
            const dispatchItemId = randomUUID();
            const [row] = await reservation(schema(), {
                dispatch_item_id: dispatchItemId, item_index: 0,
                inbound_message_id: randomUUID(), batch_id: randomUUID(),
            });
            const [stored] = await q(
                `SELECT dispatch_item_id FROM "${schema()}".whatsapp_spend_reservations WHERE id=$1::uuid`,
                [row.id]);
            expect(stored.dispatch_item_id).toBe(dispatchItemId);
        });
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
            const account = `INSERT INTO public.channel_accounts(id, tenant_id, channel_type,
                account_id, waba_timezone)
                VALUES(gen_random_uuid(), gen_random_uuid(), 'whatsapp', $1, $2)`;

            await q('SAVEPOINT probe');
            await expect(q(account, ['n1', '12'])).rejects.toThrow();
            await q('ROLLBACK TO SAVEPOINT probe');

            await q('SAVEPOINT probe');
            for (const zone of ['America/Bogota', 'America/Argentina/Buenos_Aires', 'UTC']) {
                await q(account, [zone, zone]);
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
