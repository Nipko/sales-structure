/**
 * Las tablas globales sintéticas que comparten las suites PostgreSQL.
 *
 * Todas las suites de base de datos corren contra la MISMA base desechable, y
 * cada una creaba `public.tenants` y `public.users` por su cuenta con
 * `CREATE TABLE IF NOT EXISTS`. Ocho formas distintas para `tenants`, dos para
 * `users`: la primera suite en llegar define la tabla y las demás heredan lo
 * que haya. Una que necesite `role`, `language` o `is_active` y llegue segunda
 * falla con `column ... does not exist`, y cuál llega primero depende del orden
 * de Jest — así que el verde dejaba de ser reproducible.
 *
 * La forma correcta es aditiva: crear si falta y **ensanchar siempre**. Una
 * suite que agregue una columna nueva la agrega acá y ninguna otra se entera.
 * Estas tablas son andamiaje de prueba, no el esquema real; el esquema de
 * tenant sigue saliendo de `prisma/tenant-schema.sql`.
 */

type Exec = (sql: string) => Promise<unknown>;

/** Columnas de `public.tenants` que alguna suite lee. Ampliar acá, no en la suite. */
const TENANT_COLUMNS: ReadonlyArray<[string, string]> = [
    ['schema_name', 'TEXT'],
    ['is_active', 'BOOLEAN DEFAULT true'],
    ['language', 'TEXT'],
    ['industry', 'TEXT'],
    ['settings', "JSONB DEFAULT '{}'::jsonb"],
    ['operating_country', 'VARCHAR(2)'],
];

/** Columnas de `public.users` que alguna suite lee. */
const USER_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID'],
    ['is_active', 'BOOLEAN'],
    ['role', 'TEXT'],
    ['first_name', 'TEXT'],
    ['last_name', 'TEXT'],
];

async function ensure(exec: Exec, table: string, columns: ReadonlyArray<[string, string]>): Promise<void> {
    await exec(`CREATE TABLE IF NOT EXISTS public.${table}(id UUID PRIMARY KEY)`);
    for (const [name, type] of columns) {
        await exec(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    }
}

/**
 * Crea y ensancha las tablas globales sintéticas. Idempotente y seguro de
 * llamar desde varias suites contra la misma base.
 *
 * `exec` es cualquier ejecutor de SQL sin parámetros: `$executeRawUnsafe` de un
 * `PrismaClient`, o el `query` de un pool de `pg`.
 */
export async function ensureSyntheticGlobalTables(exec: Exec): Promise<void> {
    await ensure(exec, 'tenants', TENANT_COLUMNS);
    await ensure(exec, 'users', USER_COLUMNS);
}
