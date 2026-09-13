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
    ['email', 'TEXT'],
    ['password', 'TEXT'],
    ['is_active', 'BOOLEAN'],
    ['role', 'TEXT'],
    ['first_name', 'TEXT'],
    ['last_name', 'TEXT'],
    ['phone', 'TEXT'],
    ['email_verify_code', 'TEXT'],
    ['email_verify_expires', 'TIMESTAMPTZ'],
    ['email_challenge_revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['two_factor_email_code', 'TEXT'],
    ['two_factor_email_expires', 'TIMESTAMPTZ'],
    ['two_factor_email_revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['two_factor_sms_code', 'VARCHAR(6)'],
    ['two_factor_sms_expires', 'TIMESTAMPTZ'],
    ['two_factor_sms_revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
];

/**
 * Columnas de `public.channel_accounts`. La tercera tabla global que empezó a
 * tener una copia por suite, con el mismo desenlace: `tenant_id` era UUID en
 * una y TEXT en otra, así que una prueba pasaba sola y moría en la corrida
 * completa por un cast que no tenía nada que ver con lo que probaba.
 *
 * Los tipos son los de `20260301000000_init` —`VARCHAR` donde init pone
 * `VARCHAR`— porque una copia más flaca deja pasar acá lo que producción
 * rechaza. Nulables, como el resto del andamiaje: `ADD COLUMN NOT NULL` sin
 * default no se puede aplicar sobre una tabla que ya tiene filas.
 *
 * `waba_timezone` va sin el CHECK que trae la migración a propósito: la prueba
 * que verifica ese CHECK lo aplica ella misma y tiene que poder verlo aparecer.
 */
const CHANNEL_ACCOUNT_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID'],
    ['channel_type', 'VARCHAR(50)'],
    ['account_id', 'VARCHAR(255)'],
    ['display_name', "VARCHAR(255) DEFAULT ''"],
    ['access_token', "TEXT DEFAULT ''"],
    ['refresh_token', 'TEXT'],
    ['webhook_secret', 'TEXT'],
    ['is_active', 'BOOLEAN DEFAULT true'],
    ['metadata', "JSONB DEFAULT '{}'::jsonb"],
    ['waba_timezone', 'VARCHAR(64)'],
    ['token_refresh_state', "VARCHAR(16) NOT NULL DEFAULT 'idle'"],
    ['token_refresh_attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['token_refresh_lease_token', 'UUID'],
    ['token_refresh_lease_expires_at', 'TIMESTAMPTZ'],
    ['token_refresh_started_at', 'TIMESTAMPTZ'],
    ['token_refresh_completed_at', 'TIMESTAMPTZ'],
    ['token_refresh_error', 'TEXT'],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
];

/**
 * Columnas de `public.whatsapp_credentials`. La cuarta tabla global con una
 * copia por suite — cuatro specs la creaban a mano, cada una con su propia
 * lista — y el desenlace fue el de siempre: una migración que agregó columnas
 * dejó a las cuatro con `P2022` («column does not exist») porque el cliente de
 * Prisma las selecciona y ninguna de las copias las tenía.
 *
 * Las de procedencia van nullables a propósito, igual que en la migración: una
 * credencial que nadie verificó se lee como `not_established`, que es un tercer
 * estado y no un sinónimo de ninguna de las dos respuestas.
 */
const WHATSAPP_CREDENTIAL_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID'],
    ['credential_type', 'TEXT'],
    ['encrypted_value', 'TEXT'],
    ['rotation_state', "TEXT DEFAULT 'active'"],
    ['expires_at', 'TIMESTAMPTZ'],
    ['credential_kind', 'TEXT'],
    ['meta_app_id', 'TEXT'],
    ['owner_business_id', 'TEXT'],
    ['granted_scopes', 'TEXT'],
    ['provenance_verified_at', 'TIMESTAMPTZ'],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
];

/** Base columns from the fiscal-invoice migration that later additive migrations widen. */
const FISCAL_INVOICE_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID'],
    ['status', "VARCHAR(32) NOT NULL DEFAULT 'pending'"],
    ['metadata', "JSONB NOT NULL DEFAULT '{}'::jsonb"],
    ['issued_at', 'TIMESTAMPTZ'],
    ['created_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'],
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
    await ensure(exec, 'channel_accounts', CHANNEL_ACCOUNT_COLUMNS);
    await ensure(exec, 'whatsapp_credentials', WHATSAPP_CREDENTIAL_COLUMNS);
    await ensure(exec, 'fiscal_invoices', FISCAL_INVOICE_COLUMNS);
}
