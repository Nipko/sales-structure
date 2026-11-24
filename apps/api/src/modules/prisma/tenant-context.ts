/**
 * Tenant context for shared tables (ADR 0034).
 *
 * Shared tables live in the `shared` schema, carry a `tenant_id` column and are
 * protected by forced row-level security. Their policy and their column default
 * both read the transaction-local setting `app.tenant_id`. The tenant helpers
 * of PrismaService set it in the same statement that sets `search_path`, so a
 * query written against an unqualified table name works unchanged whether the
 * table is still per tenant or already shared.
 *
 * No Nest and no Prisma in this file: the WhatsApp service keeps its own copy
 * of the two functions (it does not import from the API) and
 * `tenant-context.spec.ts` checks that both copies stay identical.
 */

/** Schema that holds the shared tables. Sits between the tenant schema and `public` in `search_path`. */
export const SHARED_SCHEMA = 'shared';

/** Transaction-local setting read by the row-level security policies and the `tenant_id` defaults. */
export const TENANT_CONTEXT_SETTING = 'app.tenant_id';

/** One statement, two transaction-local settings: `search_path` ($1) and the tenant context ($2). */
export const TENANT_CONTEXT_SQL =
    `SELECT set_config('search_path', $1, true), set_config('${TENANT_CONTEXT_SETTING}', $2, true)`;

const EVAL_NAMESPACE = /^tenant_eval_([a-f0-9]{8})_([a-f0-9]{24})$/;
const CANONICAL_SUFFIX = /_([a-f0-9]{32})$/;

function hexToUuid(hex: string): string {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The tenant context a schema name stands for, or `''` when the name carries none.
 *
 * - A physical tenant schema ends in the tenant UUID (`createTenantSchema` allocates
 *   `tenant_<slug>_<32 hex>`), so the id is read from the name: no lookup, no cache to invalidate.
 * - An ephemeral evaluation namespace (`tenant_eval_<8 hex>_<24 hex>`) belongs to no tenant. Its 32 hex
 *   digits become a synthetic id of its own: rows it writes to shared tables are invisible to the real
 *   tenant and are removed by deleting that id.
 * - Anything else returns `''`. The setting is then empty, and any statement that touches a shared table
 *   fails on the `::uuid` cast instead of reading or writing another tenant's rows. Tables that are still
 *   per tenant are unaffected.
 */
export function tenantContextIdForSchema(schemaName: string): string {
    const evalNamespace = EVAL_NAMESPACE.exec(schemaName);
    if (evalNamespace) return hexToUuid(`${evalNamespace[1]}${evalNamespace[2]}`);
    const canonical = CANONICAL_SUFFIX.exec(schemaName);
    return canonical ? hexToUuid(canonical[1]) : '';
}

/**
 * Value for `search_path` inside a tenant transaction. The tenant schema goes first, so a table that has
 * not moved yet keeps resolving there; `shared` comes next. The caller must have validated `schemaName`.
 */
export function tenantSearchPath(schemaName: string): string {
    return `"${schemaName}", ${SHARED_SCHEMA}, public`;
}
