import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
    LEGACY_SEEDED_SERVICE_PRICES,
    collectSeededPricePairs,
    findGeneratedRegion,
    normaliseSeededPricePairs,
    renderSeededPriceBackfill,
    replaceGeneratedRegion,
    type SeededPricePair,
    type SeededPriceTable,
} from './seeded-price-backfill';

/**
 * The generated regions of `tenant-schema.sql` that repair prices the vertical
 * seed wrote before `price_status` existed (see seeded-price-backfill.ts).
 *
 * Regenerate after a registry change with:
 *
 *     WRITE_SEEDED_PRICE_BACKFILL=1 npx jest seeded-price-backfill.spec
 *
 * What the SQL DOES to a real tenant — only untouched seed rows WITHOUT a
 * status, on every deploy, never undoing an owner's confirmation, and repairing
 * the rows old code writes during a failed or rolling deploy — is proven
 * against PostgreSQL in `seeded-price-backfill.postgres.spec.ts`. This file
 * proves the list is the registry's and that the region survives both template
 * runners intact.
 */

const TEMPLATE_PATH = resolve(__dirname, '../../../prisma/tenant-schema.sql');
const TABLES: SeededPriceTable[] = ['services', 'membership_plans'];
const REGENERATE = 'WRITE_SEEDED_PRICE_BACKFILL=1 npx jest seeded-price-backfill.spec';

function readTemplate(): string {
    return readFileSync(TEMPLATE_PATH, 'utf8').replace(/\r\n/g, '\n');
}

function has(pairs: readonly SeededPricePair[], name: string, price: number): SeededPricePair | undefined {
    return pairs.find((pair) => pair.name === name && pair.price === price);
}

describe('the seeded-price backfill is generated from the registry', () => {
    let pairs: Record<SeededPriceTable, SeededPricePair[]>;

    beforeAll(async () => {
        pairs = await collectSeededPricePairs();
        if (process.env.WRITE_SEEDED_PRICE_BACKFILL === '1') {
            let template = readFileSync(TEMPLATE_PATH, 'utf8');
            for (const table of TABLES) {
                template = replaceGeneratedRegion(template, table, renderSeededPriceBackfill(table, pairs[table]));
            }
            writeFileSync(TEMPLATE_PATH, template);
        }
    });

    it.each(TABLES)('the %s region in tenant-schema.sql is exactly what the registry renders', (table) => {
        const template = readTemplate();
        const found = findGeneratedRegion(template, table);
        if (!found) throw new Error(`tenant-schema.sql lost the generated region for ${table}`);
        const actual = template.slice(found.start, found.end);
        const expected = renderSeededPriceBackfill(table, pairs[table]);
        if (actual !== expected) {
            const rows = (sql: string) => new Set(sql.split('\n').filter((line) => line.startsWith('            (')));
            const actualRows = rows(actual);
            const expectedRows = rows(expected);
            const missing = [...expectedRows].filter((row) => !actualRows.has(row)).slice(0, 10);
            const stale = [...actualRows].filter((row) => !expectedRows.has(row)).slice(0, 10);
            throw new Error([
                `The ${table} backfill in tenant-schema.sql no longer matches the registry.`,
                `Regenerate it with: ${REGENERATE}`,
                missing.length ? `Missing rows:\n${missing.join('\n')}` : '',
                stale.length ? `Rows the registry no longer renders:\n${stale.join('\n')}` : '',
            ].filter(Boolean).join('\n'));
        }
    });

    it('every service the registry source spells out is covered, including subtype-only ones', () => {
        // A second, independent reading of the registry: the enumeration walks
        // industries × subtypes through the same resolver the bootstrap uses,
        // and this scans the source text. A subtype missing from the manifest
        // would slip past the first and not past this.
        const quoted = String.raw`'((?:[^'\\]|\\.)*)'`;
        const entry = new RegExp(
            String.raw`name:\s*\{\s*es:\s*${quoted}\s*,\s*en:\s*${quoted}\s*,\s*pt:\s*${quoted}\s*,\s*fr:\s*${quoted}\s*\}`
            + String.raw`((?:(?!name:\s*\{)[\s\S]){0,2000}?)\bdurationMinutes:\s*\d+((?:(?!name:\s*\{)[\s\S]){0,300}?)\bprice:\s*(\d+)`,
            'g',
        );
        const scanned: Array<{ name: string; price: number }> = [];
        for (const file of ['vertical-definitions.ts', 'verticals.service.ts']) {
            const source = readFileSync(resolve(__dirname, file), 'utf8');
            for (const match of source.matchAll(entry)) {
                for (const index of [1, 2, 3, 4]) {
                    scanned.push({ name: match[index].replace(/\\'/g, "'"), price: Number(match[7]) });
                }
            }
        }
        expect(scanned.length).toBeGreaterThan(150);
        const uncovered = scanned.filter(({ name, price }) => !has(pairs.services, name, price));
        expect(uncovered).toEqual([]);
    });

    it('marks each service the way the seed marks it today', () => {
        // Quoted case by case: no number exists, so "te confirmo el precio"
        // would promise one. Everything else waits for the owner's confirmation.
        expect(has(pairs.services, 'Visita de plomería', 0)?.status).toBe('quote');
        expect(has(pairs.services, 'Evento privado', 0)?.status).toBe('quote');
        expect(has(pairs.services, 'Private event', 0)?.status).toBe('quote');
        expect(has(pairs.services, 'Consulta general', 80000)?.status).toBe('example');
        expect(has(pairs.services, 'General consultation', 80000)?.status).toBe('example');
        // A 0 the recipe wrote is not "free" either.
        expect(has(pairs.services, 'Clase de prueba', 0)?.status).toBe('example');
    });

    it('keeps what the seed wrote in April and May, before the registry changed', () => {
        for (const legacy of LEGACY_SEEDED_SERVICE_PRICES) {
            expect(has(pairs.services, legacy.name, legacy.price)).toBeDefined();
        }
        expect(has(pairs.services, 'Consultation generale', 60000)?.status).toBe('example');
        expect(has(pairs.services, 'Cotizacion personalizada', 0)?.status).toBe('quote');
    });

    it('captures the three gym plans in every language, straight from the seed', () => {
        const byName = Object.fromEntries(pairs.membership_plans.map((pair) => [pair.name, pair]));
        for (const name of ['Mensual', 'Monthly', 'Mensal', 'Mensuel']) expect(byName[name]).toMatchObject({ price: 150000, status: 'example' });
        for (const name of ['Trimestral', 'Quarterly', 'Trimestriel']) expect(byName[name]).toMatchObject({ price: 390000, status: 'example' });
        for (const name of ['Anual', 'Annual', 'Annuel']) expect(byName[name]).toMatchObject({ price: 1320000, status: 'example' });
        // es and pt share "Trimestral" and "Anual": one row each, not two.
        expect(pairs.membership_plans).toHaveLength(10);
    });

    it('collapses duplicates, and a disagreement lands on example', () => {
        expect(normaliseSeededPricePairs([
            { name: 'Visita', price: 0, status: 'quote' },
            { name: 'Visita', price: 0, status: 'quote' },
            { name: 'Primera reunión', price: 0, status: 'quote' },
            { name: 'Primera reunión', price: 0, status: 'example' },
        ])).toEqual([
            { name: 'Primera reunión', price: 0, status: 'example' },
            { name: 'Visita', price: 0, status: 'quote' },
        ]);
    });

    it('refuses a name the template runners would corrupt', () => {
        // migrate-tenants.js strips `--` to end of line even inside a literal,
        // and both splitters read any `$...$` as a dollar-quote delimiter.
        expect(() => renderSeededPriceBackfill('services', [{ name: 'Corte -- promo', price: 1, status: 'example' }])).toThrow('unsafe_literal');
        expect(() => renderSeededPriceBackfill('services', [{ name: 'Corte $5$', price: 1, status: 'example' }])).toThrow('unsafe_literal');
        expect(renderSeededPriceBackfill('services', [{ name: "Cours d'essai", price: 0, status: 'example' }])).toContain("('Cours d''essai', 0, 'example')");
    });

    it.each(TABLES)('the %s repair reaches PostgreSQL as whole statements, from either runner', (table) => {
        const template = readTemplate().replace(/\{\{SCHEMA_NAME\}\}/g, 'tenant_probe');
        const split = (sql: string): string[] => (PrismaService.prototype as any).splitSqlStatements(sql);
        const runtime = split(template);
        // migrate-tenants.js strips every `--` comment before splitting.
        const deploy = split(template.replace(/--.*$/gm, ''));
        const own = (statements: string[]) => statements.filter((statement) => statement.includes(`"tenant_probe"."${table}"`)
            && statement.includes('price_status'));
        expect(own(deploy)).toEqual(own(runtime));
        const add = `ALTER TABLE "tenant_probe"."${table}" ADD COLUMN IF NOT EXISTS "price_status" VARCHAR(16);`;
        const dropDefault = `ALTER TABLE "tenant_probe"."${table}" ALTER COLUMN "price_status" DROP DEFAULT;`;
        const update = own(runtime).find((statement) => statement.startsWith(`UPDATE "tenant_probe"."${table}" AS target`));
        // Exactly these three, and none of them a DO block: the harnesses that
        // build a schema from the template's `ALTER TABLE` statements get the
        // column the deploy gets, with no default.
        expect(own(runtime)).toEqual([add, dropDefault, update]);
        expect(update!.endsWith('AND target."updated_at" = target."created_at";')).toBe(true);
        expect(update!.match(/^\s{12}\('/gm)).toHaveLength(pairs[table].length);
        const create = runtime.findIndex((sql) => sql.startsWith(`CREATE TABLE IF NOT EXISTS "tenant_probe"."${table}" (`));
        expect(create).toBeGreaterThanOrEqual(0);
        expect(runtime.indexOf(add)).toBeGreaterThan(create);
        expect(runtime.indexOf(update!)).toBeGreaterThan(runtime.indexOf(dropDefault));
    });

    it.each(TABLES)('the %s column has no default anywhere in the template', (table) => {
        // FX1-3: with `DEFAULT 'confirmed'`, a seed row written by old code
        // during a failed or rolling deploy took 'confirmed' and a one-shot
        // repair never looked again. NULL is how such a row stays findable.
        const template = readTemplate();
        const declarations = template.split('\n').filter((line) => line.includes(`"${table}"`) && /price_status/.test(line) && /\bDEFAULT\b/i.test(line));
        expect(declarations).toEqual([
            `ALTER TABLE "{{SCHEMA_NAME}}"."${table}" ALTER COLUMN "price_status" DROP DEFAULT;`,
        ]);
    });

    it.each(TABLES)('the %s repair runs every deploy and touches only untouched COP seed rows no code gave a status', (table) => {
        const region = renderSeededPriceBackfill(table, pairs[table]);
        // Every deploy: no gate on the column's existence. Idempotent because a
        // repaired row has a status and the repair only reads rows without one.
        expect(region).not.toMatch(/\bDO \$/);
        expect(region).not.toMatch(/pg_attribute/);
        expect(region).toContain(' WHERE target."price_status" IS NULL');
        expect(region).not.toContain(`= 'confirmed'`);
        expect(region).toContain(`AND target."currency" = 'COP'`);
        expect(region).toContain('AND target."updated_at" = target."created_at";');
        // FX1-4: the residual it accepts is stated where the SQL is.
        expect(region).toMatch(/-- .*a mano/);
    });

    it('the pair key has no raw control byte (the file must stay text for git and grep)', () => {
        const source = readFileSync(resolve(__dirname, 'seeded-price-backfill.ts'));
        expect(source.includes(0)).toBe(false);
    });
});
