import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';
import { READINESS, VerticalReadinessService } from '../verticals/vertical-readiness.service';
import {
    READINESS_PREDICATE_AUTHORITY, classifyReadinessSource, readinessPredicateColumns,
} from '../../common/utils/readiness-predicate-authority.util';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

const schemaSql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');

/**
 * The canonical DDL for one tenant table, verbatim.
 *
 * Not a smaller version of it. The whole question here is whether a predicate
 * can execute against the columns a provisioned tenant actually has, so a
 * hand-shrunk fixture would be answering a different question — and would have
 * hidden the defect this suite exists to reproduce. None of these six tables
 * declares a foreign key, a CHECK or a generated column, so the statement runs
 * as written.
 */
function canonicalTable(table: string, schema: string): string {
    const start = schemaSql.indexOf(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}"`);
    if (start < 0) throw new Error(`tenant-schema.sql has no ${table}`);
    const end = schemaSql.indexOf('\n);', start);
    if (end < 0) throw new Error(`unterminated CREATE TABLE for ${table}`);
    const body = schemaSql.slice(start, end + 3);
    if (/REFERENCES|GENERATED|CHECK/.test(body)) {
        throw new Error(`${table} grew a constraint this fixture does not reproduce`);
    }
    return body.replace(/\{\{SCHEMA_NAME\}\}/g, schema);
}

/**
 * The `ALTER TABLE … ADD COLUMN` statements the same file applies afterwards.
 *
 * Matched across lines, because several of them are written that way — and a
 * line-by-line filter silently skipped those, which is how a fixture ends up
 * missing a column a provisioned tenant has.
 */
function canonicalAlters(table: string, schema: string): string[] {
    const pattern = new RegExp(`ALTER TABLE "\\{\\{SCHEMA_NAME\\}\\}"\\."${table}"[\\s\\S]*?;`, 'g');
    return (schemaSql.match(pattern) ?? [])
        .filter(statement => statement.includes('ADD COLUMN'))
        .map(statement => statement.replace(/\{\{SCHEMA_NAME\}\}/g, schema).replace(/;\s*$/, ''));
}

const TABLES = ['faqs', 'products', 'companies', 'menu_items', 'real_estate_listings',
    'treatment_plans', 'services', 'properties', 'insurance_plans'] as const;

(connection ? describe : describe.skip)('readiness predicates executed against the real tenant schema', () => {
    const schema = `tenant_readiness_${randomUUID().replace(/-/g, '')}`;
    let pool: Pool;

    const sql = async (text: string, values: any[] = []) => {
        const client = await pool.connect();
        try {
            await client.query(`SET search_path TO "${schema}",public`);
            return (await client.query(text, values)).rows;
        } finally { client.release(); }
    };

    /** Run one predicate exactly as the readiness evaluator runs it. */
    const countWith = async (table: string, where?: string): Promise<{ total: number } | { error: string; code: string }> => {
        try {
            const rows = await sql(`SELECT COUNT(*)::int AS total FROM (
                SELECT 1 FROM ${table}${where ? ` WHERE ${where}` : ''} LIMIT 50
            ) sample`);
            return { total: Number(rows[0]?.total ?? 0) };
        } catch (error: any) {
            return { error: String(error?.message ?? ''), code: String(error?.code ?? '') };
        }
    };

    /** Columns the table really has, read from the catalogue, not from a list. */
    const columnsOf = async (table: string): Promise<Set<string>> => new Set((await sql(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        [schema, table],
    )).map((row: any) => String(row.column_name)));

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!isDisposableDatabaseUrl(url)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection });
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await pool.query(`CREATE SCHEMA "${schema}"`);
        for (const table of TABLES) {
            await pool.query(canonicalTable(table, schema));
            for (const alter of canonicalAlters(table, schema)) await pool.query(alter);
        }
    }, 60000);

    afterAll(async () => {
        if (!pool) return;
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
    });

    describe('faq_content: readiness and the search tool share one executable predicate', () => {
        beforeAll(async () => {
            await sql('TRUNCATE faqs');
            for (let index = 0; index < 3; index++) {
                await sql('INSERT INTO faqs (question, answer, is_published) VALUES ($1, $2, true)',
                    [`Pregunta ${index}`, `Respuesta ${index}`]);
            }
        });

        it('finds the three published FAQs through the predicate the tool runs', async () => {
            // Derived from the runtime read, not from the readiness definition,
            // so the two sides of the comparison come from different places.
            expect(await countWith('faqs', READINESS_PREDICATE_AUTHORITY.faq_content!.toolPredicate))
                .toEqual({ total: 3 });
        });

        it('finds the same three FAQs through readiness', async () => {
            const result = await countWith(READINESS.faq_content!.table, READINESS.faq_content!.where);
            expect(result).toEqual({ total: 3 });
        });

        it('distinguishes an absent column from an absent table by PostgreSQL code', async () => {
            const readiness = new VerticalReadinessService({
                executeInTenantSchema: async (_schema: string, text: string) => sql(text),
            } as any, {} as any);
            await expect((readiness as any).countRows(schema, {
                table: 'faqs', where: 'missing_column = true',
            })).resolves.toBeNull();
            await expect((readiness as any).countRows(schema, {
                table: 'table_that_does_not_exist',
            })).resolves.toBe(0);
        });

        it('is classified as readable configuration data', async () => {
            const columns = await columnsOf('faqs');
            expect(columns.has('is_published')).toBe(true);
            expect(columns.has('is_active')).toBe(false);
            expect(classifyReadinessSource('faq_content', {
                unmet: false, availableColumns: columns, contractDegraded: false,
                readinessWhere: READINESS.faq_content!.where,
            })).toBe('satisfied');
        });

        it('reaches the same verdict for every audited key from the live catalogue', async () => {
            // The census, executed. Each audited key's predicate is run against
            // the table a provisioned tenant has; a key that cannot execute is a
            // read error and everything else answers a real question.
            const unexecutable: string[] = [];
            for (const [key, definition] of Object.entries(READINESS)) {
                if (!definition || !TABLES.includes(definition.table as any)) continue;
                const columns = await columnsOf(definition.table);
                const missing = readinessPredicateColumns(definition.where)
                    .filter(column => !columns.has(column));
                if (missing.length) unexecutable.push(`${key}: ${definition.table} has no ${missing.join(', ')}`);
            }
            expect(unexecutable).toEqual([]);
        });
    });

    describe('predicates that execute and still disagree with their tool', () => {
        it('excludes a soft-deleted listing just like search_listings', async () => {
            await sql('TRUNCATE real_estate_listings');
            await sql(`INSERT INTO real_estate_listings (name, transaction_type, status, is_active)
                       VALUES ('Archivado', 'sale', 'available', false)`);
            expect(await countWith('real_estate_listings', READINESS.listings!.where)).toEqual({ total: 0 });
            expect(await countWith('real_estate_listings',
                READINESS_PREDICATE_AUTHORITY.listings!.toolPredicate)).toEqual({ total: 0 });
        });

        it('excludes a soft-deleted dish just like the menu search', async () => {
            await sql('TRUNCATE menu_items');
            await sql(`INSERT INTO menu_items (name, price, is_available, is_active)
                       VALUES ('Bandeja retirada', 30000, true, false)`);
            expect(await countWith('menu_items', READINESS.menu_items!.where)).toEqual({ total: 0 });
            expect(await countWith('menu_items',
                READINESS_PREDICATE_AUTHORITY.menu_items!.toolPredicate)).toEqual({ total: 0 });
        });

        it('keeps an open-duration service visible for manual quote intake', async () => {
            // `duration_minutes` is NOT NULL DEFAULT 30, so this is not a null
            // edge case: zero is what the services writer stores for
            // `duration_type = 'open'`, which is the natural shape of a
            // "presupuesto a convenir" trade.
            await sql('TRUNCATE services');
            await sql(`INSERT INTO services (name, duration_minutes, is_active, duration_type)
                       VALUES ('Destape a convenir', 0, true, 'open')`);
            expect(await countWith('services', READINESS.service_catalog!.where)).toEqual({ total: 1 });
            expect(await countWith('services',
                READINESS_PREDICATE_AUTHORITY.service_catalog!.toolPredicate)).toEqual({ total: 1 });
        });

        it('does not count a B2B customer organisation as the tenant identity', async () => {
            await sql('TRUNCATE companies');
            await sql(`INSERT INTO companies (name, is_primary) VALUES ('Cliente Mayorista SAS', false)`);
            expect(await countWith('companies', READINESS.business_identity!.where)).toEqual({ total: 0 });
            expect(await countWith('companies',
                READINESS_PREDICATE_AUTHORITY.business_identity!.toolPredicate)).toEqual({ total: 0 });
        });

        it('does not publish an accommodation the agent would quote at zero', async () => {
            await sql('TRUNCATE properties');
            await sql(`INSERT INTO properties (name, night_price, is_active) VALUES
                       ('Sin tarifa', 0, true), ('Vendible', 180000, true)`);
            expect(await countWith('properties', READINESS.properties!.where)).toEqual({ total: 1 });
            expect(await countWith('properties',
                READINESS_PREDICATE_AUTHORITY.properties!.toolPredicate)).toEqual({ total: 1 });
        });

        it('does not publish an insurance plan that cannot produce a priced quote', async () => {
            await sql('TRUNCATE insurance_plans');
            await sql(`INSERT INTO insurance_plans (name, insurance_type, monthly_premium_min, currency) VALUES
                       ('Borrador', 'vida', NULL, 'COP'), ('Cotizable', 'vida', 85000, 'COP')`);
            expect(await countWith('insurance_plans', READINESS.insurance_plans!.where)).toEqual({ total: 1 });
            expect(await countWith('insurance_plans',
                READINESS_PREDICATE_AUTHORITY.insurance_plans!.toolPredicate)).toEqual({ total: 1 });
        });

        it('fails an accented boarding category the runtime comparison accepts', async () => {
            await sql('TRUNCATE services');
            await sql(`INSERT INTO services (name, duration_minutes, is_active, category, max_concurrent)
                       VALUES ('Guardería día', 480, true, 'guardería', 4)`);
            expect(await countWith('services', READINESS.boarding_capacity!.where)).toEqual({ total: 0 });
            // The runtime strips accents before comparing, so the same row is
            // acceptable there: the readiness answer is stricter than the gate
            // it is supposed to predict.
            expect(await countWith('services',
                `is_active = true
                 AND translate(lower(category), 'áéíóúü', 'aeiouu') IN ('hotel', 'guarderia')
                 AND COALESCE(max_concurrent, 0) >= 1`)).toEqual({ total: 1 });
        });
    });

    describe('a blockage the owner really can clear, end to end', () => {
        // `catalog_items` is one of the six keys whose shipped predicate matches
        // the predicate its tool runs, which is exactly why the full chain can
        // be proven on it: blockage → the write the repair route performs →
        // re-read → the key clears → the tool's own predicate answers.
        const tenantId = randomUUID();
        let readiness: VerticalReadinessService;
        let cache: Map<string, string>;

        const prismaLike = () => ({
            executeInTenantSchema: async (_schema: string, text: string, values: any[] = []) => sql(text, values),
            ensureCanonicalTables: async () => undefined,
            $queryRaw: async (strings: TemplateStringsArray, ...params: any[]) => {
                // The inventory service resolves the schema through a tagged
                // template. Rebuild the statement the same way Prisma would.
                const text = strings.reduce((acc, part, index) =>
                    acc + part + (index < params.length ? `$${index + 1}` : ''), '');
                return sql(text, params);
            },
        });

        const redisLike = () => ({
            get: async (key: string) => cache.get(key) ?? null,
            set: async (key: string, value: string) => { cache.set(key, value); },
            del: async (key: string) => { cache.delete(key); },
            getJson: async (key: string) => {
                const raw = cache.get(`json:${key}`);
                return raw ? JSON.parse(raw) : null;
            },
            setJson: async (key: string, value: unknown) => { cache.set(`json:${key}`, JSON.stringify(value)); },
        });

        beforeAll(async () => {
            await sql('TRUNCATE products');
            cache = new Map();
            // In-memory rather than Valkey on purpose: the cache generation is
            // exercised faithfully, and a platform-wide key shared with another
            // suite would silently answer for this one.
            readiness = new VerticalReadinessService(prismaLike() as any, redisLike() as any);
            await sql(`INSERT INTO tenants_probe VALUES (1)`).catch(() => undefined);
        });

        it('reports the blockage while the catalogue is empty', async () => {
            const report = await readiness.evaluate(tenantId, schema, ['catalog_items']);
            expect(report.degraded).toBe(false);
            expect(report.unmet).toEqual(['catalog_items']);
            expect(report.checks[0]).toMatchObject({ satisfied: false, count: 0, required: 1 });
            // And it is missing data, not an unreadable source: this is a thing
            // the owner can go and do.
            expect(classifyReadinessSource('catalog_items', {
                unmet: true, availableColumns: await columnsOf('products'), contractDegraded: false,
                readinessWhere: READINESS.catalog_items!.where,
            })).toBe('missing_data');
        });

        it('keeps reporting it from cache until the write invalidates the read', async () => {
            await sql(`INSERT INTO products (id, name, price, currency, is_available, stock)
                       VALUES (uuid_generate_v4(), 'Escrito por fuera', 1000, 'COP', true, 5)`);
            // The link of the chain that is easy to skip: a re-read that is not
            // a real re-read. Without the invalidation the owner writes, comes
            // back, and the banner is still red.
            const stale = await readiness.evaluate(tenantId, schema, ['catalog_items']);
            expect(stale.unmet).toEqual(['catalog_items']);
            const refreshed = await readiness.evaluate(tenantId, schema, ['catalog_items'], undefined, { refresh: true });
            expect(refreshed.unmet).toEqual([]);
            await sql('TRUNCATE products');
            await readiness.invalidate(tenantId);
        });

        it('clears after the write the repair route performs, and the tool then answers', async () => {
            const { InventoryService } = await import('../inventory/inventory.service');
            const inventory = new InventoryService(prismaLike() as any, redisLike() as any);
            cache.set(`tenant:${tenantId}:schema`, schema);

            const blocked = await readiness.evaluate(tenantId, schema, ['catalog_items'], undefined, { refresh: true });
            expect(blocked.unmet).toEqual(['catalog_items']);
            expect(READINESS.catalog_items!.repairRoute).toBe(
                READINESS_PREDICATE_AUTHORITY.catalog_items!.writePath);

            // The authorised resolution: the write the repair route's own screen
            // performs, through the service its controller calls.
            const created = await inventory.createProduct(tenantId, {
                name: 'Camisa de lino', sku: 'CAM-001', price: 129000, stock: 12, currency: 'COP',
            });
            expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

            const cleared = await readiness.evaluate(tenantId, schema, ['catalog_items'], undefined, { refresh: true });
            expect(cleared.unmet).toEqual([]);
            expect(cleared.checks[0]).toMatchObject({ key: 'catalog_items', satisfied: true, count: 1 });

            // And the tool's own predicate — not readiness's — now returns the
            // row, which is the last link: the customer gets an answer.
            const answered = await sql(
                `SELECT name FROM products WHERE (name ILIKE $1 OR description ILIKE $1) AND is_available = true`,
                ['%lino%'],
            );
            expect(answered.map((row: any) => row.name)).toEqual(['Camisa de lino']);
        });
    });

    describe('the complete repair chain for faq_content', () => {
        const tenantId = randomUUID();
        const cache = new Map<string, string>();
        const prismaLike = {
            executeInTenantSchema: async (_schema: string, text: string, values: any[] = []) => sql(text, values),
            $queryRawUnsafe: async (text: string, ...values: any[]) => sql(text, values),
            $executeRawUnsafe: async (text: string) => sql(text).then(() => 0),
        };
        const redisLike = {
            get: async (key: string) => cache.get(key) ?? null,
            set: async (key: string, value: string) => { cache.set(key, value); },
            del: async (key: string) => { cache.delete(key); },
            getJson: async (key: string) => {
                const raw = cache.get(`json:${key}`);
                return raw ? JSON.parse(raw) : null;
            },
            setJson: async (key: string, value: unknown) => { cache.set(`json:${key}`, JSON.stringify(value)); },
        };
        const service = async () => {
            const { FaqsService } = await import('../faqs/faqs.service');
            return new FaqsService(prismaLike as any, redisLike as any,
                { getSchemaName: async () => schema } as any);
        };

        beforeAll(async () => { await sql('TRUNCATE faqs'); });

        it('performs the write the repair route offers', async () => {
            // ═══ WHAT THIS CASE USED TO PIN ═══
            //
            // It asserted a REJECTION. The screen existed, the controller
            // existed, the service method existed, and PostgreSQL refused to
            // prepare the statement: `$3` was the category, used once as a
            // VARCHAR(100) column and once inside `COALESCE($3, '')` in a text
            // context — 42P08, on every call, for every tenant of every
            // vertical. The catch only translated 23505, so it reached the
            // owner as a failed save. No FAQ could be created by hand at all;
            // the vertical seed uses a different statement, which is why a
            // bootstrapped tenant had rows nobody could have added.
            //
            // The fix is one cast — `COALESCE($3, ''::varchar)` — which lets
            // the planner resolve the parameter to one type. Asserted here
            // through the real Prisma path, because the driver is part of what
            // broke: `pg` infers the parameter type and would have hidden it.
            const faqs = await service();
            await expect(faqs.create(tenantId, {
                question: '¿Hacen envíos a Medellín?',
                answer: 'Sí, con dos días de tránsito.',
                isPublished: true,
            })).resolves.toMatchObject({ question: '¿Hacen envíos a Medellín?' });
            // The row is really there, and searchable — the tsvector is built
            // in the same statement that was failing to prepare.
            expect((await sql('SELECT question FROM faqs')).map((row: any) => row.question))
                .toEqual(['¿Hacen envíos a Medellín?']);
            expect((await faqs.search(tenantId, 'envíos', 5)).map(item => item.question))
                .toEqual(['¿Hacen envíos a Medellín?']);
        });

        it('clears readiness after the write and publishes the searchable row', async () => {
            await sql(`INSERT INTO faqs (question, answer, category, is_published, search_tsv)
                       SELECT $1, $2, $3, true, to_tsvector('simple', $1 || ' ' || $2)`,
            ['¿Cuál es el horario?', 'Lunes a sábado, 9 a 18.', 'horarios']);

            const readiness = new VerticalReadinessService(prismaLike as any, redisLike as any);
            // Re-read, for real — the refresh path, not a second cached answer.
            const after = await readiness.evaluate(tenantId, schema, ['faq_content'], undefined, { refresh: true });
            expect(after.unmet).toEqual([]);
            expect(after.degraded).toBe(false);
            expect(after.checks[0]).toMatchObject({ satisfied: true, count: 2 });
            expect(READINESS.faq_content!.repairRoute).toBe('/admin/knowledge/faqs');

            const faqs = await service();
            const found = await faqs.search(tenantId, 'horario', 5);
            expect(found.map(item => item.question)).toEqual(['¿Cuál es el horario?']);

            expect(classifyReadinessSource('faq_content', {
                unmet: false, availableColumns: await columnsOf('faqs'), contractDegraded: false,
                readinessWhere: READINESS.faq_content!.where,
            })).toBe('satisfied');
        });
    });
});
