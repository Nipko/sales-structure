/**
 * Canonical registry of shared tables (ADR 0034).
 *
 * A table listed here lives in the `shared` schema, carries `tenant_id` and is protected by forced
 * row-level security. It is the single list that the rest of the code reads:
 *
 * - `shared-tables-isolation.postgres.spec.ts` requires the registry and the database to name the same tables;
 * - `shared-tables-style.spec.ts` rejects a hand-written schema qualifier or a lazy `CREATE TABLE` for any of them;
 * - `PrismaService.purgeTenantSharedData` deletes a tenant's rows from every one of them;
 * - `PrismaService.findShadowedSharedTables` reports a tenant schema that still holds a table of the same name.
 *
 * Moving a table: the migration that creates it in `shared` (and calls `shared.apply_tenant_isolation`), its
 * removal from `prisma/tenant-schema.sql` and its entry here go in the same change.
 */
export interface SharedTable {
    /** Table name, unqualified. */
    name: string;
    /** Phase of ADR 0034 in which the table moved. */
    phase: 1 | 2 | 3;
}

export const SHARED_TABLES: readonly SharedTable[] = [
    // Batch 1 (pilot): traces. prisma/migrations/20261124160000_move_traces_to_shared
    { name: 'conversation_traces', phase: 1 },
    { name: 'turn_traces', phase: 1 },
];

export const SHARED_TABLE_NAMES: readonly string[] = SHARED_TABLES.map((table) => table.name);

/**
 * Files in `apps/api/src` and `apps/whatsapp/src` that still create tables lazily at runtime
 * (`CREATE TABLE IF NOT EXISTS`). The number can only go down: `shared-tables-style.spec.ts` fails when it
 * grows, and asks for this constant to be lowered when a site is removed.
 */
export const LAZY_CREATE_TABLE_FILE_BASELINE = 59;
