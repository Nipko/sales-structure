import { Logger } from '@nestjs/common';
import {
    SUBTYPE_ALIASES,
    SUBTYPE_EXPERIENCE_PROFILES,
    VERTICAL_CAPABILITY_MANIFEST,
    VERTICAL_MANIFEST_INDUSTRIES,
} from '@parallext/shared';
import { VERTICAL_REGISTRY, getVerticalDefinition } from './vertical-definitions';
import { VerticalsService, resolveVerticalAgendaSeedContract } from './verticals.service';

/**
 * ═══ THE PRICES THE SEED WROTE BEFORE ANYONE ASKED WHERE A PRICE CAME FROM ═══
 *
 * D10 added `price_status` to `services` and `membership_plans`, and from then
 * on every seed writes 'example' (or 'quote') explicitly. But every tenant
 * created before D10 already had the vertical seed in its tables — the registry
 * services at their reference price in COP, and for gyms three membership
 * plans — and nothing marked those rows. Left alone they read as "confirmed",
 * and the agent states invented prices to customers as fact. That is the owner
 * in the 14-sep-2026 recording.
 *
 * This module produces the list of (name, price) pairs the seed can have
 * written, and renders the SQL that repairs them. The SQL lives in
 * `prisma/tenant-schema.sql` as a GENERATED region; `seeded-price-backfill.spec.ts`
 * fails when the region stops matching what this module renders. Regenerate
 * with:
 *
 *     WRITE_SEEDED_PRICE_BACKFILL=1 npx jest seeded-price-backfill.spec
 *
 * THE DESIGN: NO DEFAULT, EVERY WRITER DECLARES, THE REPAIR RUNS EVERY DEPLOY
 *
 * `price_status` is added WITHOUT a default, so a NULL means exactly one thing:
 * the row was written by code that did not know the column. Every writer of
 * this code declares the status — the seed ('example'/'quote': seedServices,
 * the vertical migration, seedMembershipPlans), the owner's screens and Assist
 * ('confirmed' or 'quote': ServicesService.create/update, which the Assist
 * `agenda.service.create` operation delegates to, and GymsService
 * createPlan/updatePlan). Every reader takes NULL as 'confirmed'
 * (`COALESCE(price_status, 'confirmed')` in SQL, `servicePriceStatus` in code),
 * which is what a person's price has always read as.
 *
 * The repair is a plain UPDATE that runs on every deploy and only ever reads
 * rows WITHOUT a status. That is what makes re-running it safe: a row it
 * repaired has a status and is never read again, and a row the new code writes
 * — an owner's "Clase de prueba" at 0 identical to the seed's, say — has one
 * from birth. It is also what makes re-running it NECESSARY. The deploy
 * migrates before it replaces the containers, and a deploy that fails between
 * the two leaves the old code serving indefinitely: a tenant seeded in that
 * window gets registry prices with no status. The first shape of this repair
 * (FX1-3) ran once, when it created the column with `DEFAULT 'confirmed'`: those
 * rows took the default and were never looked at again. Now they wait as NULL
 * and the next deploy repairs them.
 *
 * A row is repaired only if ALL of this holds:
 *   · it has no status (NULL: written by code that did not know the column);
 *   · its (name, price) is a pair the seed wrote, in any of the four languages
 *     (the seed stores `name[lang]` and dedupes on every translation);
 *   · its currency is COP — every registry reference is written in COP, and
 *     the pre-D17 seed copied it verbatim;
 *   · it was never edited: `updated_at = created_at`. The seed never sets either
 *     timestamp, so both come from the same `NOW()` of one INSERT. Every owner
 *     write path bumps `updated_at` — ServicesService.update (always appends
 *     `updated_at = NOW()`, since 2026-04-13), GymsService.updatePlan and
 *     deletePlan.
 *
 * Residuals, stated rather than hidden:
 *   · FX1-4, accepted: a row an OWNER created with code that did not know the
 *     column, byte-for-byte a seed pair (same name, same price, COP) and never
 *     edited, is indistinguishable from the seed and becomes 'example'. The
 *     agent then says "te confirman el precio" for it until the owner presses
 *     "Confirmar precio" (or "Es gratis"). The alternative — not repairing —
 *     leaves every real seed row stating an invented price; withholding a real
 *     price is the failure that can be undone with one click. The generated
 *     region says so where the SQL is.
 *   · A seed row the old code writes in a failed-deploy window and the owner
 *     edits (any field) before the next deploy has `updated_at > created_at`
 *     and keeps no status: it reads as confirmed. Narrower than before (it
 *     needs an edit inside the window), and the same row the one-shot left
 *     confirmed with no edit at all.
 */

export type SeededPriceStatus = 'example' | 'quote';
export type SeededPriceTable = 'services' | 'membership_plans';

export interface SeededPricePair {
    name: string;
    price: number;
    status: SeededPriceStatus;
}

/** The only currency a pre-D10 seed ever wrote. */
export const SEEDED_REFERENCE_CURRENCY = 'COP';

/**
 * Pairs the seed wrote on `main` that the registry no longer carries.
 *
 * Read from the git history of `vertical-definitions.ts` and
 * `verticals.service.ts` on `main` (first seed 2026-04-30, merge base
 * b067a9c2): the registry dropped the unaccented spellings, repriced
 * "Consulta general" and retired "Plan Mensual" as a gym service. A tenant
 * seeded in April or May still has those rows. History does not change, so
 * this list is frozen — entries are only ever ADDED, when a registry service
 * the seed already wrote is renamed or repriced.
 *
 * The status is the one the registry gives the same service today.
 */
export const LEGACY_SEEDED_SERVICE_PRICES: readonly SeededPricePair[] = Object.freeze([
    { name: 'Asesoria especializada', price: 200000, status: 'example' },
    { name: 'Asesoria gratuita', price: 0, status: 'example' },
    { name: 'Asesoria hipotecaria', price: 0, status: 'example' },
    { name: 'Avaliacao comercial', price: 200000, status: 'example' },
    { name: 'Avaluo comercial', price: 200000, status: 'example' },
    { name: 'Bañado y peluqueria', price: 80000, status: 'example' },
    { name: 'Coaching personnel (seance)', price: 80000, status: 'example' },
    { name: 'Coloracao e tratamento', price: 120000, status: 'example' },
    { name: 'Conseil hypothecaire', price: 0, status: 'example' },
    { name: 'Conseil specialise', price: 200000, status: 'example' },
    { name: 'Consultation generale', price: 60000, status: 'example' },
    { name: 'Consultation generale', price: 80000, status: 'example' },
    { name: 'Consultation specialisee', price: 120000, status: 'example' },
    { name: 'Cotacao personalizada', price: 0, status: 'quote' },
    { name: 'Cotizacion personalizada', price: 0, status: 'quote' },
    { name: 'Demo personnalisee', price: 0, status: 'example' },
    { name: 'Desparasitacion', price: 35000, status: 'example' },
    { name: 'Devis personnalise', price: 0, status: 'quote' },
    { name: 'Evaluation commerciale', price: 200000, status: 'example' },
    { name: 'Evenement prive', price: 0, status: 'quote' },
    { name: 'Excursao meio dia', price: 150000, status: 'example' },
    { name: 'Excursion demi-journee', price: 150000, status: 'example' },
    { name: 'Excursion medio dia', price: 150000, status: 'example' },
    { name: 'Forfait mensuel', price: 150000, status: 'example' },
    { name: 'Inspection mecanique', price: 80000, status: 'example' },
    { name: 'Manucure et pedicure', price: 50000, status: 'example' },
    { name: 'Monthly plan', price: 150000, status: 'example' },
    { name: 'Personal training (sessao)', price: 80000, status: 'example' },
    { name: 'Plan Mensual', price: 150000, status: 'example' },
    { name: 'Plano mensal', price: 150000, status: 'example' },
    { name: 'Revisao mecanica', price: 80000, status: 'example' },
    { name: 'Revision mecanica', price: 80000, status: 'example' },
    { name: 'Teste de nivel', price: 0, status: 'example' },
    { name: 'Tour dia completo', price: 300000, status: 'example' },
    { name: 'Tour journee complete', price: 300000, status: 'example' },
    { name: 'Tutorat personnalise', price: 80000, status: 'example' },
    { name: 'Vacinacao', price: 50000, status: 'example' },
    { name: 'Vacunacion', price: 50000, status: 'example' },
    { name: 'Vermifugacao', price: 35000, status: 'example' },
    { name: 'Visite guidee', price: 0, status: 'example' },
]);

const SEED_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;

/**
 * Every subtype a tenant can have been seeded under. Legacy ids count: a tenant
 * created as `technology/consultoria_ti` got that subtype's own services, and
 * it keeps them after the selector stopped offering it.
 */
function seedableSubtypes(industry: string): Array<string | null> {
    const manifest = (VERTICAL_CAPABILITY_MANIFEST as Record<string, {
        subtypes?: readonly string[];
        legacySubtypes?: readonly string[];
    }>)[industry];
    const prefixed = (ids: Iterable<string>) => [...ids]
        .filter((key) => key.startsWith(`${industry}/`))
        .map((key) => key.slice(industry.length + 1));
    return [null, ...new Set([
        ...(manifest?.subtypes ?? []),
        ...(manifest?.legacySubtypes ?? []),
        ...(VERTICAL_REGISTRY[industry]?.subTypes ?? []).map((subtype) => subtype.key),
        ...prefixed(Object.keys(SUBTYPE_ALIASES)),
        ...prefixed(Object.keys(SUBTYPE_EXPERIENCE_PROFILES)),
    ])];
}

/**
 * Every (name, price) the service seed can write, from the live registry.
 *
 * Same selection the bootstrap makes: the subtype's definition (academy
 * overlays included) through `resolveVerticalAgendaSeedContract`, which is
 * where subtype-specific services replace the industry's. The price is the
 * registry REFERENCE, which is exactly what the pre-D17 seed wrote.
 */
export function registrySeededServicePairs(): SeededPricePair[] {
    const industries = [...new Set<string>([...Object.keys(VERTICAL_REGISTRY), ...VERTICAL_MANIFEST_INDUSTRIES])];
    const pairs: SeededPricePair[] = [];
    for (const industry of industries) {
        for (const subtype of seedableSubtypes(industry)) {
            const definition = getVerticalDefinition(industry, subtype);
            const candidates = [...definition.services, ...resolveVerticalAgendaSeedContract(definition, subtype).services];
            for (const service of candidates) {
                if (service.currency !== SEEDED_REFERENCE_CURRENCY) {
                    throw new Error(`seeded_price_backfill_non_reference_currency:${industry}/${subtype ?? '-'}:${service.name.es}`);
                }
                const status: SeededPriceStatus = service.priceStatus === 'quote' ? 'quote' : 'example';
                for (const name of new Set(Object.values(service.name).filter(Boolean))) {
                    pairs.push({ name, price: Number(service.price), status });
                }
            }
        }
    }
    return pairs;
}

/**
 * Every (name, price) the membership-plan seed writes, captured from the seed
 * itself rather than copied: `seedMembershipPlans` keeps its plans private, so
 * this runs it against a query stub for each language and records the INSERTs.
 *
 * Captured for Colombia because there the D17 amount is the reference itself
 * (factor 1, and the three references are already round), which is exactly
 * what the pre-D17 seed wrote with its literal `'COP'`.
 */
export async function registrySeededMembershipPlanPairs(): Promise<SeededPricePair[]> {
    const seeder = Object.create(VerticalsService.prototype) as { logger: Logger };
    seeder.logger = new Logger('seeded-price-backfill');
    const pairs: SeededPricePair[] = [];
    for (const lang of SEED_LANGUAGES) {
        const query = async (sql: string, params: any[] = []): Promise<any[]> => {
            if (sql.includes('INSERT INTO membership_plans')) {
                if (params[9] !== SEEDED_REFERENCE_CURRENCY) {
                    throw new Error(`seeded_price_backfill_plan_currency:${String(params[9])}`);
                }
                pairs.push({ name: String(params[0]), price: Number(params[3]), status: 'example' });
            }
            return [];
        };
        await (seeder as any).seedMembershipPlans('tenant_seed_capture', lang, query, 'CO');
    }
    return pairs;
}

function pairKey(pair: Pick<SeededPricePair, 'name' | 'price'>): string {
    return `${pair.name}\u0000${pair.price}`;
}

/**
 * One row per (name, price), sorted so the rendered SQL is stable.
 *
 * The same pair can come from two entries (a service shared by two subtypes).
 * If they disagree on the status, 'example' wins: both hide the number, but an
 * example keeps asking the owner to confirm it, which is the safer default.
 */
export function normaliseSeededPricePairs(pairs: readonly SeededPricePair[]): SeededPricePair[] {
    const byKey = new Map<string, SeededPricePair>();
    for (const pair of pairs) {
        if (!Number.isFinite(pair.price) || pair.price < 0) throw new Error(`seeded_price_backfill_bad_price:${pair.name}`);
        const current = byKey.get(pairKey(pair));
        if (!current) byKey.set(pairKey(pair), { ...pair });
        else if (current.status !== pair.status) current.status = 'example';
    }
    return [...byKey.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.price - b.price));
}

export async function collectSeededPricePairs(): Promise<Record<SeededPriceTable, SeededPricePair[]>> {
    return {
        services: normaliseSeededPricePairs([...registrySeededServicePairs(), ...LEGACY_SEEDED_SERVICE_PRICES]),
        membership_plans: normaliseSeededPricePairs(await registrySeededMembershipPlanPairs()),
    };
}

function sqlLiteral(value: string): string {
    // `migrate-tenants.js` strips `--` to end of line BEFORE splitting, even
    // inside a string literal, and both splitters treat any `$...$` on a line
    // as a dollar-quote delimiter. A name carrying either would be silently
    // rewritten or would break the whole tenant transaction.
    if (/--|\$|[\r\n]/.test(value)) throw new Error(`seeded_price_backfill_unsafe_literal:${value}`);
    return `'${value.replace(/'/g, "''")}'`;
}

export function generatedRegionMarkers(table: SeededPriceTable): { begin: string; end: string } {
    return {
        begin: `-- >>> GENERATED seeded-price-backfill:${table} (seeded-price-backfill.ts) - do not edit by hand`,
        end: `-- <<< GENERATED seeded-price-backfill:${table}`,
    };
}

/**
 * The comment the generated region carries, so the residual it accepts is
 * stated next to the SQL that accepts it (FX1-4). Plain text: no `$`, no `;`
 * at a line end, so neither template runner can misread it.
 */
const REGION_NOTES: readonly string[] = [
    '-- Repara, en cada deploy, los precios que sembró código que no conocía',
    '-- price_status. La columna NO tiene default: NULL es una fila escrita por',
    '-- ese código (antes del primer deploy, o por los contenedores viejos de un',
    '-- deploy fallido o en curso). Todo lo que escribe el código actual declara',
    '-- su estado y nunca se vuelve a leer acá, así que correr esto de nuevo no',
    '-- deshace ninguna confirmación del dueño.',
    '-- Solo toca filas sin estado cuyo par nombre/precio sembró la receta, en',
    '-- COP y nunca editadas (updated_at = created_at).',
    '-- Residual aceptado: un servicio o plan que el dueño creó a mano con ese',
    '-- código viejo, idéntico a uno sembrado y nunca editado, no se distingue',
    '-- de la semilla y pasa a ejemplo. El agente dice "te confirman el precio"',
    '-- hasta que el dueño lo confirme con un clic. Lo contrario dejaría todos',
    '-- los precios inventados diciéndose como confirmados.',
];

/** The generated region, markers included, with `\n` line endings. */
export function renderSeededPriceBackfill(table: SeededPriceTable, pairs: readonly SeededPricePair[]): string {
    if (!pairs.length) throw new Error(`seeded_price_backfill_empty:${table}`);
    const markers = generatedRegionMarkers(table);
    const rows = pairs.map((pair, index) =>
        `            (${sqlLiteral(pair.name)}, ${pair.price}, '${pair.status}')${index < pairs.length - 1 ? ',' : ''}`);
    return [
        markers.begin,
        ...REGION_NOTES,
        `ALTER TABLE "{{SCHEMA_NAME}}"."${table}" ADD COLUMN IF NOT EXISTS "price_status" VARCHAR(16);`,
        // A database that ran the first shape of this template has the old
        // default; `ADD COLUMN IF NOT EXISTS` would keep it.
        `ALTER TABLE "{{SCHEMA_NAME}}"."${table}" ALTER COLUMN "price_status" DROP DEFAULT;`,
        `UPDATE "{{SCHEMA_NAME}}"."${table}" AS target`,
        '   SET "price_status" = seed.status',
        '  FROM (VALUES',
        ...rows,
        '          ) AS seed(name, price, status)',
        ' WHERE target."price_status" IS NULL',
        '   AND target."name" = seed.name',
        '   AND target."price" = seed.price::numeric',
        `   AND target."currency" = '${SEEDED_REFERENCE_CURRENCY}'`,
        '   AND target."updated_at" = target."created_at";',
        markers.end,
    ].join('\n');
}

/** Locate a generated region in the template (any line endings). */
export function findGeneratedRegion(template: string, table: SeededPriceTable): { start: number; end: number } | null {
    const markers = generatedRegionMarkers(table);
    const start = template.indexOf(markers.begin);
    if (start < 0) return null;
    const endMarker = template.indexOf(markers.end, start);
    if (endMarker < 0) return null;
    return { start, end: endMarker + markers.end.length };
}

/** Replace a generated region, keeping the template's own line endings. */
export function replaceGeneratedRegion(template: string, table: SeededPriceTable, region: string): string {
    const found = findGeneratedRegion(template, table);
    if (!found) throw new Error(`seeded_price_backfill_region_missing:${table}`);
    const eol = template.includes('\r\n') ? '\r\n' : '\n';
    return template.slice(0, found.start) + region.split('\n').join(eol) + template.slice(found.end);
}
