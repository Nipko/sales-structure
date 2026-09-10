import {
    AGREED_TERMS_FAMILIES,
    type AgreedTermsFamily,
    type OrphanQuery,
} from './agreed-terms-orphans';

/**
 * The gate a deploy has to pass before it changes what a charge is allowed to
 * take.
 *
 * The runbook already says to call
 * `GET /tenant-payments/:tenantId/agreed-terms/orphans` before deploying. A
 * sentence in a runbook is not a gate: it is applied per tenant, by hand, by
 * whoever remembers. This is the same question asked of EVERY tenant by the
 * pipeline, before the migrations and before any container is recreated, and it
 * refuses the deploy rather than reporting.
 *
 * ── Why it cannot just call `countAgreedTermsOrphans` ───────────────────────
 *
 * That function answers a different question and answers it optimistically. Its
 * per-family `catch` turns EVERY failure into `orphans: 0` — a missing table, a
 * broken query and a dead connection all come back as "nothing to worry about",
 * which is the one answer a pre-deploy gate must never invent. Here the three
 * outcomes stay apart: counted, not provisioned, or failed.
 *
 * ── Why it runs against the OLD schema ──────────────────────────────────────
 *
 * The check protects a behaviour change that arrives WITH this release, so it
 * has to run before the release's own migrations — which means it cannot assume
 * the structures those migrations create. `commitment_proposals` is one of
 * them: three of the five families read their acceptance from it, and on a
 * tenant that has not been migrated yet the table is simply absent.
 *
 * Reporting that as "0 orphans" would be the worst possible answer and the
 * easiest one to write. If the acceptance store is not there, then NO row in
 * those families has a recorded acceptance, so every live row is exactly the
 * thing this gate exists to find. They are counted from the family's own table
 * — which does predate the release — and reported with the reason.
 */

/** How a family's live rows were established, or why they could not be. */
export type FamilyOutcome =
    /** The acceptance store exists and the rows without one were counted. */
    | 'counted'
    /**
     * The acceptance store is absent, so nothing in this family has a recorded
     * acceptance and every live row is at risk. Counted from the family table.
     */
    | 'acceptance_store_absent'
    /** This tenant does not have the family at all. Not a finding. */
    | 'not_provisioned'
    /** The inspection itself failed. Never a count, never a zero. */
    | 'failed';

export interface FamilyPreflight {
    readonly family: AgreedTermsFamily;
    readonly table: string;
    readonly outcome: FamilyOutcome;
    /** Live rows a charge would refuse. `null` when nothing was established. */
    readonly orphans: number | null;
    /** Stable code, never a driver message: those carry query text and values. */
    readonly error: string | null;
}

export interface TenantPreflight {
    readonly tenantId: string;
    readonly schema: string;
    readonly families: readonly FamilyPreflight[];
    readonly orphans: number;
    readonly inspected: number;
    readonly failures: number;
    readonly schemaPresent: boolean;
}

export interface PreflightSummary {
    readonly generatedAt: string;
    readonly tenants: readonly TenantPreflight[];
    readonly tenantsInspected: number;
    readonly familiesInspected: number;
    readonly orphans: number;
    readonly errors: number;
    /** Fail closed: any orphan, any failure, or a schema that could not be read. */
    readonly blocksDeploy: boolean;
}

/**
 * Where each family keeps the fact that a customer agreed to something.
 *
 * `column` is checked on the family's own table; `table` is a relation of its
 * own. Exactly one of them per family, and the absence of either means the same
 * thing: no row in this family can have a recorded acceptance yet.
 */
interface FamilySpec {
    readonly table: string;
    readonly liveStates: readonly string[];
    readonly acceptance: { readonly kind: 'column'; readonly name: string }
        | { readonly kind: 'table'; readonly name: string };
    /** Rows with no acceptance, when the acceptance store IS present. */
    readonly orphanPredicate: (schema: string) => string;
}

/**
 * Qualified with the schema, always.
 *
 * This runs on a raw connection that walks every tenant in turn, not through
 * `executeInTenantSchema`, so there is no ambient `search_path` to rely on — and
 * relying on one here would be worse than verbose: a stale path means counting
 * one tenant's rows while reporting another's name.
 */
const COMMITMENT_PREDICATE = (schema: string) => `NOT EXISTS (
    SELECT 1 FROM "${schema}".commitment_proposals p
     WHERE p.consumed_entity_id = target.id AND p.accepted_at IS NOT NULL)`;

export const PREFLIGHT_FAMILIES: Readonly<Record<AgreedTermsFamily, FamilySpec>> = Object.freeze({
    catalog_orders: {
        table: 'orders',
        liveStates: ['cancelled', 'refunded', 'paid'],
        acceptance: { kind: 'column', name: 'catalog_terms' },
        orphanPredicate: () => `COALESCE(target.catalog_terms->>'action','') <> 'create'`,
    },
    appointments: {
        table: 'appointments',
        liveStates: ['cancelled', 'no_show', 'completed', 'expired'],
        // `metadata` predates every release in this batch, so appointments can
        // always be counted for real — no absent-store branch applies to them.
        acceptance: { kind: 'column', name: 'metadata' },
        orphanPredicate: () => `NOT (target.metadata ? 'serviceTerms')`,
    },
    property_bookings: {
        table: 'property_bookings',
        liveStates: ['cancelled', 'refunded', 'expired'],
        acceptance: { kind: 'table', name: 'commitment_proposals' },
        orphanPredicate: COMMITMENT_PREDICATE,
    },
    tour_bookings: {
        table: 'tour_bookings',
        liveStates: ['cancelled', 'refunded', 'expired'],
        acceptance: { kind: 'table', name: 'commitment_proposals' },
        orphanPredicate: COMMITMENT_PREDICATE,
    },
    restaurant_orders: {
        table: 'food_orders',
        liveStates: ['cancelled', 'refunded'],
        acceptance: { kind: 'table', name: 'commitment_proposals' },
        orphanPredicate: COMMITMENT_PREDICATE,
    },
});

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Live rows of a family, with or without the acceptance predicate applied. */
function countSql(schema: string, spec: FamilySpec, withPredicate: boolean): string {
    if (!identifier.test(schema)) throw new Error('invalid_sql_schema');
    if (!identifier.test(spec.table)) throw new Error('invalid_sql_table');
    if (spec.liveStates.some(state => !identifier.test(state))) throw new Error('invalid_sql_state');
    const states = spec.liveStates.map(state => `'${state}'`).join(', ');
    const predicate = withPredicate ? `${spec.orphanPredicate(schema)} AND ` : '';
    return `SELECT count(*)::int AS orphans FROM "${schema}".${spec.table} target
             WHERE ${predicate}target.status NOT IN (${states})`;
}

/**
 * A count is a count. Anything else — null, a string, a float, a negative — is
 * a shape this gate does not understand, and understanding it wrongly is how a
 * gate reports zero for a database that answered nonsense.
 */
function readCount(rows: unknown): number | null {
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const value = (rows[0] as Record<string, unknown> | null)?.orphans;
    const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
    if (value === null || value === undefined || value === '') return null;
    if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
    return parsed;
}

const RELATION_PRESENT = `SELECT to_regclass($1)::text AS name`;
const COLUMN_PRESENT = `SELECT count(*)::int AS n FROM information_schema.columns
                         WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`;

async function relationPresent(query: OrphanQuery, schema: string, table: string): Promise<boolean> {
    const rows = await query<any[]>(RELATION_PRESENT, [`"${schema}"."${table}"`]);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('invalid_relation_probe');
    return Boolean(rows[0]?.name);
}

async function columnPresent(
    query: OrphanQuery, schema: string, table: string, column: string,
): Promise<boolean> {
    const rows = await query<any[]>(COLUMN_PRESENT, [schema, table, column]);
    const count = Array.isArray(rows) && rows.length === 1 ? Number(rows[0]?.n) : NaN;
    if (!Number.isSafeInteger(count)) throw new Error('invalid_column_probe');
    return count > 0;
}

/** Codes only. A driver message carries query text, and query text carries values. */
function errorCode(error: unknown): string {
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string' && /^[0-9A-Z_]{2,40}$/.test(code)) return code;
    const message = (error as { message?: unknown })?.message;
    if (typeof message === 'string' && /^[a-z_]{3,40}$/.test(message)) return message;
    return 'query_failed';
}

/** One family, in one tenant. Never throws: the outcome carries the failure. */
export async function preflightFamily(
    query: OrphanQuery, schema: string, family: AgreedTermsFamily,
): Promise<FamilyPreflight> {
    const spec = PREFLIGHT_FAMILIES[family];
    const base = { family, table: spec.table } as const;
    try {
        if (!await relationPresent(query, schema, spec.table)) {
            return Object.freeze({ ...base, outcome: 'not_provisioned', orphans: null, error: null });
        }
        const acceptancePresent = spec.acceptance.kind === 'table'
            ? await relationPresent(query, schema, spec.acceptance.name)
            : await columnPresent(query, schema, spec.table, spec.acceptance.name);

        // No acceptance store means no acceptance anywhere: every live row is
        // the thing this gate looks for, so they are counted rather than
        // reported as zero.
        const counted = readCount(await query<any[]>(countSql(schema, spec, acceptancePresent)));
        if (counted === null) {
            return Object.freeze({ ...base, outcome: 'failed', orphans: null, error: 'invalid_count_shape' });
        }
        return Object.freeze({
            ...base,
            outcome: acceptancePresent ? 'counted' : 'acceptance_store_absent',
            orphans: counted,
            error: null,
        });
    } catch (error) {
        return Object.freeze({ ...base, outcome: 'failed', orphans: null, error: errorCode(error) });
    }
}

/**
 * One tenant. A schema that is not there yet is not a failure — a tenant
 * provisioned but not migrated has nothing to charge — but it is stated, and it
 * still blocks, because a deploy that cannot see a tenant has not checked it.
 */
export async function preflightTenant(
    query: OrphanQuery, tenantId: string, schema: string,
): Promise<TenantPreflight> {
    let schemaPresent = true;
    try {
        const rows = await query<any[]>(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1`, [schema]);
        const count = Array.isArray(rows) && rows.length === 1 ? Number(rows[0]?.n) : NaN;
        if (!Number.isSafeInteger(count)) throw new Error('invalid_schema_probe');
        schemaPresent = count > 0;
    } catch (error) {
        return Object.freeze({
            tenantId, schema, schemaPresent: false, orphans: 0, inspected: 0, failures: 1,
            families: Object.freeze([Object.freeze({
                family: AGREED_TERMS_FAMILIES[0], table: '-', outcome: 'failed' as const,
                orphans: null, error: errorCode(error),
            })]),
        });
    }
    if (!schemaPresent) {
        return Object.freeze({
            tenantId, schema, schemaPresent: false, orphans: 0, inspected: 0, failures: 0,
            families: Object.freeze([]),
        });
    }
    const families: FamilyPreflight[] = [];
    for (const family of AGREED_TERMS_FAMILIES) {
        families.push(await preflightFamily(query, schema, family));
    }
    return Object.freeze({
        tenantId, schema, schemaPresent: true,
        families: Object.freeze(families),
        orphans: families.reduce((sum, entry) => sum + (entry.orphans ?? 0), 0),
        inspected: families.filter(entry => entry.outcome !== 'not_provisioned').length,
        failures: families.filter(entry => entry.outcome === 'failed').length,
    });
}

export interface PreflightTenantRef { readonly id: string; readonly schema: string }

/** Every tenant, in order, with the totals a pipeline can act on. */
export async function preflightAgreedTerms(
    query: OrphanQuery, tenants: readonly PreflightTenantRef[], now = () => new Date().toISOString(),
): Promise<PreflightSummary> {
    const results: TenantPreflight[] = [];
    for (const tenant of tenants) {
        results.push(await preflightTenant(query, tenant.id, tenant.schema));
    }
    const orphans = results.reduce((sum, entry) => sum + entry.orphans, 0);
    const errors = results.reduce((sum, entry) => sum + entry.failures, 0);
    return Object.freeze({
        generatedAt: now(),
        tenants: Object.freeze(results),
        tenantsInspected: results.length,
        familiesInspected: results.reduce((sum, entry) => sum + entry.inspected, 0),
        orphans,
        errors,
        blocksDeploy: orphans > 0 || errors > 0,
    });
}

/** The one line a workflow greps. Stable field order, counts only. */
export function preflightSummaryLine(summary: PreflightSummary): string {
    return `AGREED_TERMS_PREFLIGHT tenants=${summary.tenantsInspected}`
        + ` families=${summary.familiesInspected}`
        + ` orphans=${summary.orphans}`
        + ` errors=${summary.errors}`
        + ` blocks=${summary.blocksDeploy ? 1 : 0}`;
}

/**
 * What an operator needs to act, and nothing else: the tenant, the family, the
 * count and why. No row ids, no amounts, no names — this runs in a deploy log.
 */
export function preflightFindings(summary: PreflightSummary): string[] {
    const lines: string[] = [];
    for (const tenant of summary.tenants) {
        if (!tenant.schemaPresent && !tenant.families.length) {
            lines.push(`tenant=${tenant.tenantId} schema=${tenant.schema} schema_absent`);
            continue;
        }
        for (const family of tenant.families) {
            if (family.outcome === 'counted' && !family.orphans) continue;
            if (family.outcome === 'not_provisioned') continue;
            lines.push(`tenant=${tenant.tenantId} family=${family.family}`
                + ` outcome=${family.outcome}`
                + ` orphans=${family.orphans ?? '-'}`
                + (family.error ? ` error=${family.error}` : ''));
        }
    }
    return lines;
}
