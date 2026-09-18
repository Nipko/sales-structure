import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from '../appointments/services.service';
import { GymsService } from '../gyms/gyms.service';
import {
    LEGACY_SEEDED_SERVICE_PRICES,
    collectSeededPricePairs,
    type SeededPricePair,
    type SeededPriceTable,
} from './seeded-price-backfill';

/**
 * The seeded-price backfill, run against real PostgreSQL the way a deploy runs it.
 *
 * The tenant starts as `main` left it: `services` and `membership_plans` with
 * every column except `price_status`, and rows written by the pre-D10 seed —
 * the same INSERT, no timestamps, so `created_at = updated_at` — next to rows a
 * person touched. Then the template's own statements (split by the same
 * splitter the runtime uses) add the column and repair the seed.
 *
 * FX1-3: the column has NO default and the repair runs on every deploy, over
 * rows without a status only. Every writer of the new code declares the
 * status, so a NULL is a row written by code that did not know the column —
 * before the first deploy, or by the old containers of a failed or rolling
 * deploy. The one-shot repair it replaces ran only when the column was missing:
 * the old code's seed rows written after the migration took `DEFAULT
 * 'confirmed'` and were never looked at again. That case is the second test.
 *
 * A mock cannot show any of this — the rule lives in the WHERE clause, in the
 * column default and in what the writers send, so only the database can answer.
 */

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;
const TABLES: SeededPriceTable[] = ['services', 'membership_plans'];

jest.setTimeout(60_000);

function templateFor(schema: string): string[] {
    const template = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8')
        .replace(/\{\{SCHEMA_NAME\}\}/g, schema)
        .replace(/uuid_generate_v4\(\)/g, 'pg_catalog.gen_random_uuid()');
    return (PrismaService.prototype as any).splitSqlStatements(template);
}

/** The statements of the template that are about `price_status`, in template order. */
function priceStatusStatements(statements: string[], schema: string, table: SeededPriceTable): string[] {
    return statements.filter((statement) => statement.includes(`"${schema}"."${table}"`) && statement.includes('price_status'));
}

integration('the seeded-price backfill against real PostgreSQL', () => {
    const schema = `tenant_price_backfill_${randomUUID().replace(/-/g, '')}`;
    let client: Client;
    let pairs: Record<SeededPriceTable, SeededPricePair[]>;
    let statements: string[];

    const sql = async (text: string, params: any[] = []) => (await client.query(text, params)).rows as any[];
    const prisma = {
        executeInTenantSchema: async (_schema: string, text: string, params: any[] = []) => sql(text, params),
    };
    const statusOf = async (table: SeededPriceTable, id: string) =>
        (await sql(`SELECT price_status FROM ${table} WHERE id = $1::uuid`, [id]))[0]?.price_status ?? null;

    /** Exactly what a deploy (and a new tenant) runs for `price_status`. */
    const deploy = async () => {
        for (const table of TABLES) {
            const own = priceStatusStatements(statements, schema, table);
            expect(own).toHaveLength(3);
            for (const statement of own) await sql(statement);
        }
    };

    /** What `main`'s seedServices wrote: no status, no timestamps. */
    const oldCodeSeedsService = async (name: string, price: number | null, currency = 'COP') => (await sql(
        `INSERT INTO services (name, description, duration_minutes, price, currency, category, is_active, sort_order, duration_type)
         VALUES ($1, 'Semilla', 30, $2, $3, 'consulta', true, 0, 'fixed') RETURNING id`,
        [name, price, currency]))[0].id as string;

    /** What `main`'s seedMembershipPlans wrote. */
    const oldCodeSeedsPlan = async (name: string, price: number) => (await sql(
        `INSERT INTO membership_plans (name, description, duration_days, price, currency, class_credits_per_period,
             personal_training_credits, guest_passes, freeze_allowance_days, sort_order)
         VALUES ($1, 'Semilla', 30, $2, 'COP', 8, 0, 1, 0, 1) RETURNING id`, [name, price]))[0].id as string;

    /** A person's edit on `main`: a later transaction, so a later NOW(). */
    const touch = async (table: SeededPriceTable, id: string) => {
        await sql(`SELECT pg_sleep(0.01)`);
        await sql(`UPDATE ${table} SET description = 'Editado por el dueño', updated_at = NOW() WHERE id = $1::uuid`, [id]);
    };

    /** Distinct registry pairs to play each role, so no two rows share a name. */
    const pick = (() => {
        const used = new Set<string>();
        return (candidates: readonly SeededPricePair[], accept: (pair: SeededPricePair) => boolean): SeededPricePair => {
            const found = candidates.find((pair) => !used.has(pair.name) && accept(pair));
            if (!found) throw new Error('no registry pair left for this role');
            used.add(found.name);
            return found;
        };
    })();

    beforeAll(async () => {
        if (!isDisposableDatabase(databaseUrl)) throw new Error('disposable_loopback_database_required');
        pairs = await collectSeededPricePairs();
        client = new Client({ connectionString: databaseUrl });
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET search_path TO "${schema}", public`);
        statements = templateFor(schema);
        // The tables as `main` had them: the canonical CREATE TABLE and every
        // other column, never `price_status`.
        for (const table of TABLES) {
            const create = statements.find((statement) => statement.startsWith(`CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (`));
            if (!create) throw new Error(`production_ddl_missing:${table}`);
            await sql(create);
            for (const alter of statements.filter((statement) => statement.startsWith(`ALTER TABLE "${schema}"."${table}" ADD COLUMN`)
                && !statement.includes('price_status'))) {
                await sql(alter);
            }
        }
        await sql(`ALTER TABLE services ADD COLUMN IF NOT EXISTS payment_policy VARCHAR(16) DEFAULT 'none',
            ADD COLUMN IF NOT EXISTS deposit_percent SMALLINT, ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(15,2)`);
    });

    afterAll(async () => {
        if (!client) return;
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.end();
    });

    it('repairs exactly the untouched seed, and a later deploy never undoes an owner', async () => {
        const services = pairs.services;
        const example = pick(services, (pair) => pair.status === 'example' && pair.price > 0);
        const quote = pick(services, (pair) => pair.status === 'quote');
        const legacy = pick(LEGACY_SEEDED_SERVICE_PRICES, (pair) => pair.status === 'example' && pair.price > 0);
        const free = pick(services, (pair) => pair.status === 'example' && pair.price === 0);
        const edited = pick(services, (pair) => pair.status === 'example' && pair.price > 0);
        const repriced = pick(services, (pair) => pair.status === 'example' && pair.price > 0);
        const foreign = pick(services, (pair) => pair.status === 'example' && pair.price > 0);
        const ownerCreated = pick(services, (pair) => pair.status === 'example' && pair.price === 0);

        const rows = {
            example: await oldCodeSeedsService(example.name, example.price),
            quote: await oldCodeSeedsService(quote.name, quote.price),
            legacy: await oldCodeSeedsService(legacy.name, legacy.price),
            free: await oldCodeSeedsService(free.name, free.price),
            edited: await oldCodeSeedsService(edited.name, edited.price),
            // Same name, the owner's own number: not the seed.
            repriced: await oldCodeSeedsService(repriced.name, repriced.price + 1000),
            // Same name and number in another currency: not the seed either.
            foreign: await oldCodeSeedsService(foreign.name, foreign.price, 'MXN'),
            // A service the owner created on `main` with a name of their own.
            own: await oldCodeSeedsService('Servicio propio del negocio', 45000),
        };
        await touch('services', rows.edited);

        const monthly = pairs.membership_plans.find((pair) => pair.name === 'Mensual')!;
        const annual = pairs.membership_plans.find((pair) => pair.name === 'Anual')!;
        const quarterly = pairs.membership_plans.find((pair) => pair.name === 'Quarterly')!;
        const plans = {
            monthly: await oldCodeSeedsPlan(monthly.name, monthly.price),
            quarterly: await oldCodeSeedsPlan(quarterly.name, quarterly.price),
            annual: await oldCodeSeedsPlan(annual.name, annual.price),
            own: await oldCodeSeedsPlan('Plan familiar', 250000),
        };
        await touch('membership_plans', plans.annual);

        // ── First deploy of this code ──
        await deploy();

        expect(await statusOf('services', rows.example)).toBe('example');
        expect(await statusOf('services', rows.quote)).toBe('quote');
        expect(await statusOf('services', rows.legacy)).toBe('example');
        // A 0 the recipe wrote is not "free": the agent must not say it is.
        expect(await statusOf('services', rows.free)).toBe('example');
        // Everything else keeps no status, which every reader takes as a
        // person's price: `COALESCE(price_status, 'confirmed')`.
        expect(await statusOf('services', rows.edited)).toBeNull();
        expect(await statusOf('services', rows.repriced)).toBeNull();
        expect(await statusOf('services', rows.foreign)).toBeNull();
        expect(await statusOf('services', rows.own)).toBeNull();
        expect(await statusOf('membership_plans', plans.monthly)).toBe('example');
        expect(await statusOf('membership_plans', plans.quarterly)).toBe('example');
        expect(await statusOf('membership_plans', plans.annual)).toBeNull();
        expect(await statusOf('membership_plans', plans.own)).toBeNull();

        // ── The owner works with the new code ──
        const servicesService = new ServicesService(prisma as any, { del: async () => 0 } as any);
        const gyms = new GymsService(prisma as any);
        // "Confirmar precio" on the example service, without retyping it.
        await servicesService.update(schema, rows.example, { priceStatus: 'confirmed' });
        // The owner creates, by hand, a service identical to a registry entry:
        // it IS free at this business. The new code writes its status, so no
        // later deploy can mistake it for the seed.
        const created = await servicesService.create(schema, {
            name: ownerCreated.name, price: 0, currency: 'COP', durationMinutes: 60, free: true,
        });
        expect(created.priceStatus).toBe('confirmed');
        const createdRow = (await sql(`SELECT created_at = updated_at AS untouched, price_status FROM services WHERE id = $1::uuid`, [created.id]))[0];
        expect(createdRow).toEqual({ untouched: true, price_status: 'confirmed' });
        // The owner corrects the monthly plan; the quarterly one comes back
        // with the rest of the form, number unchanged.
        await gyms.updatePlan(schema, plans.monthly, { price: 165000 });
        await gyms.updatePlan(schema, plans.quarterly, { price: quarterly.price, description: 'Tres meses' });

        expect(await statusOf('services', rows.example)).toBe('confirmed');
        expect(await statusOf('membership_plans', plans.monthly)).toBe('confirmed');
        expect(await statusOf('membership_plans', plans.quarterly)).toBe('example');

        // ── Every later deploy ──
        await deploy();
        await deploy();

        expect(await statusOf('services', rows.example)).toBe('confirmed');
        expect(await statusOf('services', created.id)).toBe('confirmed');
        expect(await statusOf('membership_plans', plans.monthly)).toBe('confirmed');
        // And what was still an example stays one; nobody's row changes.
        expect(await statusOf('services', rows.quote)).toBe('quote');
        expect(await statusOf('membership_plans', plans.quarterly)).toBe('example');
        expect(await statusOf('services', rows.own)).toBeNull();
    });

    it('a seed the OLD code writes after the migration (failed or rolling deploy) is repaired by the next deploy', async () => {
        // The containers are replaced minutes after `migrate-tenants` ran, and
        // a failed deploy leaves the old ones serving indefinitely. A tenant
        // that picks its industry in that window is seeded by code that does
        // not know `price_status`. With the one-shot repair and `DEFAULT
        // 'confirmed'`, those invented COP prices became "confirmed" forever.
        await deploy();
        const monthly = pairs.membership_plans.find((pair) => pair.name === 'Monthly')!;
        const seeded = pick(pairs.services, (pair) => pair.status === 'example' && pair.price > 0);
        const quoted = pick(pairs.services, (pair) => pair.status === 'quote');
        const late = {
            seeded: await oldCodeSeedsService(seeded.name, seeded.price),
            quoted: await oldCodeSeedsService(quoted.name, quoted.price),
            plan: await oldCodeSeedsPlan(monthly.name, monthly.price),
        };
        // No default: nothing pretends these were confirmed.
        expect(await statusOf('services', late.seeded)).toBeNull();
        expect(await statusOf('membership_plans', late.plan)).toBeNull();

        await deploy();

        expect(await statusOf('services', late.seeded)).toBe('example');
        expect(await statusOf('services', late.quoted)).toBe('quote');
        expect(await statusOf('membership_plans', late.plan)).toBe('example');
    });

    it('"Confirmar precio" on a seeded service with no amount is refused against the real row', async () => {
        // FX1-1. D17 seeds NULL outside the six example countries. Read back
        // from PostgreSQL the NULL used to become 0 in `mapRow`, the guard saw
        // a price, and the service ended up confirmed at NULL — which
        // list_services told the customer was 0.
        const noAmount = (await sql(
            `INSERT INTO services (name, duration_minutes, price, currency, price_status)
             VALUES ('Consulta sin monto', 30, NULL, 'UYU', 'example') RETURNING id`))[0].id as string;
        const servicesService = new ServicesService(prisma as any, { del: async () => 0 } as any);
        await expect(servicesService.update(schema, noAmount, { priceStatus: 'confirmed' }))
            .rejects.toMatchObject({ response: { error: 'price_missing' } });
        // The editor's version of the same click: the empty field comes back as 0.
        await expect(servicesService.update(schema, noAmount, { price: 0, priceStatus: 'confirmed' }))
            .rejects.toMatchObject({ response: { error: 'price_missing' } });
        expect((await sql(`SELECT price, price_status FROM services WHERE id = $1::uuid`, [noAmount]))[0])
            .toEqual({ price: null, price_status: 'example' });
        expect((await servicesService.getById(schema, noAmount)).price).toBeNull();

        // "Es gratis" is the one way to make it 0.
        await servicesService.update(schema, noAmount, { free: true });
        expect((await sql(`SELECT price::float AS price, price_status FROM services WHERE id = $1::uuid`, [noAmount]))[0])
            .toEqual({ price: 0, price_status: 'confirmed' });
    });

    it('a brand-new tenant gets the column with no default and nothing to repair', async () => {
        const fresh = `${schema}_fresh`;
        await sql(`CREATE SCHEMA "${fresh}"`);
        try {
            const freshStatements = templateFor(fresh);
            for (const table of TABLES) {
                await sql(freshStatements.find((statement) => statement.startsWith(`CREATE TABLE IF NOT EXISTS "${fresh}"."${table}" (`))!);
                for (const statement of priceStatusStatements(freshStatements, fresh, table)) await sql(statement);
            }
            const columns = await sql(
                `SELECT table_name, column_default FROM information_schema.columns
                  WHERE table_schema = $1 AND column_name = 'price_status' ORDER BY table_name`, [fresh]);
            expect(columns).toEqual([
                { table_name: 'membership_plans', column_default: null },
                { table_name: 'services', column_default: null },
            ]);
        } finally {
            await sql(`DROP SCHEMA IF EXISTS "${fresh}" CASCADE`);
        }
    });

    it('a column that was created with the old default loses it', async () => {
        // A database that ran this branch's earlier template (local, CI) has
        // `DEFAULT 'confirmed'`. `ADD COLUMN IF NOT EXISTS` would keep it.
        const stale = `${schema}_stale`;
        await sql(`CREATE SCHEMA "${stale}"`);
        try {
            const staleStatements = templateFor(stale);
            await sql(staleStatements.find((statement) => statement.startsWith(`CREATE TABLE IF NOT EXISTS "${stale}"."services" (`))!);
            await sql(`ALTER TABLE "${stale}"."services" ADD COLUMN "price_status" VARCHAR(16) DEFAULT 'confirmed'`);
            for (const statement of priceStatusStatements(staleStatements, stale, 'services')) await sql(statement);
            expect((await sql(
                `SELECT column_default FROM information_schema.columns
                  WHERE table_schema = $1 AND table_name = 'services' AND column_name = 'price_status'`, [stale]))[0])
                .toEqual({ column_default: null });
        } finally {
            await sql(`DROP SCHEMA IF EXISTS "${stale}" CASCADE`);
        }
    });

    it('a plan price that does not exist cannot be confirmed, "Es gratis" can, and quote keeps the NOT NULL column at 0', async () => {
        // `membership_plans.price` is NOT NULL (tenant-schema.sql): outside the
        // six countries with an example amount the seed writes 0 + 'example'.
        const placeholder = (await sql(
            `INSERT INTO membership_plans (name, duration_days, price, currency, price_status)
             VALUES ('Mensual sin monto', 30, 0, 'UYU', 'example') RETURNING id`))[0].id as string;
        const gyms = new GymsService(prisma as any);
        await expect(gyms.updatePlan(schema, placeholder, { priceStatus: 'confirmed' })).rejects.toMatchObject({ response: { error: 'price_missing' } });
        // The editor resending the placeholder 0 with the confirm button is the same thing.
        await expect(gyms.updatePlan(schema, placeholder, { price: 0, priceStatus: 'confirmed' })).rejects.toMatchObject({ response: { error: 'price_missing' } });
        expect(await statusOf('membership_plans', placeholder)).toBe('example');
        // FX1-5: saying it is free, explicitly, is accepted.
        const free = await gyms.updatePlan(schema, placeholder, { priceStatus: 'confirmed', price: 0, free: true });
        expect(free).toMatchObject({ price_status: 'confirmed' });
        expect(Number(free.price)).toBe(0);
        const quoted = await gyms.createPlan(schema, { name: 'Plan corporativo', durationDays: 30, priceStatus: 'quote' });
        expect(quoted).toMatchObject({ price_status: 'quote' });
        expect(Number(quoted.price)).toBe(0);
    });
});
