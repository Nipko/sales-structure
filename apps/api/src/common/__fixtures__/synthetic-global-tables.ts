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
    ['is_internal', 'BOOLEAN DEFAULT false'],
    ['plan', 'TEXT'],
    ['name', 'TEXT'],
    ['billing_email', 'TEXT'],
    ['language', 'TEXT'],
    ['industry', 'TEXT'],
    ['settings', "JSONB DEFAULT '{}'::jsonb"],
    ['operating_country', 'VARCHAR(2)'],
    // The onboarding activation writer updates this alongside `settings`, just
    // like the real Prisma Tenant model. Omitting it made successful end-to-end
    // replies look green while silently failing to persist `firstReplyAt`.
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
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
    ['notification_preferences', `JSONB NOT NULL DEFAULT
        '{"version":1,"soundEnabled":true,"categories":{"chat":true,"handoff":true,"compliance":true,"appointments":true,"automation":false,"orders":false,"system":true}}'::jsonb`],
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

/** Shared additive shape for the two billing tables used by cross-module specs. */
const BILLING_PLAN_COLUMNS: ReadonlyArray<[string, string]> = [
    ['slug', 'TEXT'], ['name', 'TEXT'], ['price_usd_cents', 'INTEGER'],
    ['trial_days', 'INTEGER DEFAULT 0'], ['requires_card_for_trial', 'BOOLEAN DEFAULT false'],
    ['max_agents', 'INTEGER'], ['max_ai_messages', 'INTEGER'],
    ['features', "JSONB DEFAULT '{}'::jsonb"], ['mp_plan_id', 'TEXT'],
    ['stripe_plan_id', 'TEXT'], ['price_local_overrides', "JSONB DEFAULT '{}'::jsonb"],
    ['is_active', 'BOOLEAN DEFAULT true'], ['sort_order', 'INTEGER DEFAULT 0'],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'], ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
];

/**
 * `public.audit_logs`, con los tipos del `20260301000000_init`: `id` UUID con
 * `gen_random_uuid()`, pero `user_id` y `tenant_id` TEXT — no UUID. Esa asimetría
 * es real y ya mordió antes al comparar columnas entre tablas.
 *
 * Está acá porque una migración de catálogo comercial guarda su antes-imagen
 * en esta tabla antes de tocar precios, y una base sintética sin ella hacía
 * fallar la suite de migraciones bajo carga con `relation "public.audit_logs"
 * does not exist` — la migración era correcta, el andamio estaba incompleto.
 */
const AUDIT_LOG_COLUMNS: ReadonlyArray<[string, string]> = [
    ['user_id', 'TEXT'], ['tenant_id', 'TEXT'], ['action', 'TEXT'],
    ['resource', "TEXT DEFAULT ''"], ['details', "JSONB DEFAULT '{}'::jsonb"],
    ['ip', 'TEXT'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
];

const BILLING_SUBSCRIPTION_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID'], ['plan_id', 'UUID'], ['status', 'TEXT'], ['provider', 'TEXT'],
    ['provider_subscription_id', 'TEXT'], ['provider_customer_id', 'TEXT'],
    ['trial_started_at', 'TIMESTAMPTZ'], ['trial_ends_at', 'TIMESTAMPTZ'],
    ['current_period_start', 'TIMESTAMPTZ'], ['current_period_end', 'TIMESTAMPTZ'],
    ['cancel_at_period_end', 'BOOLEAN DEFAULT false'], ['cancelled_at', 'TIMESTAMPTZ'],
    ['cancellation_reason', 'TEXT'], ['pending_plan_id', 'UUID'],
    ['pending_plan_change_at', 'TIMESTAMPTZ'], ['metadata', "JSONB DEFAULT '{}'::jsonb"],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'], ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['engine', "TEXT DEFAULT 'provider'"], ['next_charge_at', 'TIMESTAMPTZ'],
    ['billing_anchor_day', 'INTEGER'], ['billing_timezone', 'TEXT'],
    ['charge_amount_cents', 'INTEGER'], ['charge_currency', 'TEXT'],
    ['default_payment_source_id', 'UUID'], ['unattended_capable', 'BOOLEAN DEFAULT true'],
    ['dunning_state', "TEXT DEFAULT 'none'"], ['dunning_started_at', 'TIMESTAMPTZ'],
    ['dunning_attempts', 'INTEGER DEFAULT 0'], ['credit_balance_cents', 'INTEGER DEFAULT 0'],
    ['pending_upgrade_plan_id', 'UUID'],
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

/**
 * Global authentication challenges that Compliance erases with the tenant
 * contact.  They used to be created only by their own focused specs.  A full
 * run therefore depended on whether that spec happened to execute before any
 * erasure spec, and a clean per-worker database consistently exposed the
 * missing relation.  Keep the synthetic shape additive here; each canonical
 * migration still installs its indexes and checks when the owning spec runs.
 */
const CUSTOMER_PORTAL_ACCESS_CHALLENGE_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID'],
    ['contact_id', 'UUID'],
    ['channel', 'VARCHAR(8)'],
    ['recipient', 'TEXT'],
    ['recipient_digest', 'VARCHAR(64)'],
    ['code', 'VARCHAR(6)'],
    ['language', "VARCHAR(16) DEFAULT 'es'"],
    ['state', "VARCHAR(32) DEFAULT 'pending'"],
    ['delivery_attempts', 'INTEGER DEFAULT 0'],
    ['verify_attempts', 'INTEGER DEFAULT 0'],
    ['lease_token', 'UUID'],
    ['lease_expires_at', 'TIMESTAMPTZ'],
    ['provider_reference', 'TEXT'],
    ['error_code', 'TEXT'],
    ['next_attempt_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['started_at', 'TIMESTAMPTZ'],
    ['sent_at', 'TIMESTAMPTZ'],
    ['consumed_at', 'TIMESTAMPTZ'],
    ['superseded_at', 'TIMESTAMPTZ'],
    ['expires_at', 'TIMESTAMPTZ'],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
];

const CHAT_IDENTITY_CHALLENGE_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID'],
    ['contact_id', 'UUID'],
    ['conversation_id', 'UUID'],
    ['channel', 'VARCHAR(8)'],
    ['recipient', 'TEXT'],
    ['recipient_digest', 'VARCHAR(64)'],
    ['hint', 'TEXT'],
    ['code', 'VARCHAR(6)'],
    ['state', "VARCHAR(32) DEFAULT 'pending'"],
    ['delivery_attempts', 'INTEGER DEFAULT 0'],
    ['verify_attempts', 'INTEGER DEFAULT 0'],
    ['lease_token', 'UUID'],
    ['lease_expires_at', 'TIMESTAMPTZ'],
    ['provider_reference', 'TEXT'],
    ['error_code', 'TEXT'],
    ['next_attempt_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['started_at', 'TIMESTAMPTZ'],
    ['sent_at', 'TIMESTAMPTZ'],
    ['consumed_at', 'TIMESTAMPTZ'],
    ['superseded_at', 'TIMESTAMPTZ'],
    ['verified_at', 'TIMESTAMPTZ'],
    ['verified_expires_at', 'TIMESTAMPTZ'],
    ['expires_at', 'TIMESTAMPTZ'],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
];

/** Activation telemetry written by the same successful reply path exercised by E2E suites. */
const ONBOARDING_EVENT_COLUMNS: ReadonlyArray<[string, string]> = [
    ['tenant_id', 'UUID NOT NULL'],
    ['user_id', 'UUID'],
    ['event', 'VARCHAR(48) NOT NULL'],
    ['channel_type', 'VARCHAR(32)'],
    ['step', 'VARCHAR(32)'],
    ['detail', 'VARCHAR(64)'],
    ['source', "VARCHAR(16) NOT NULL DEFAULT 'server'"],
    ['session_id', 'UUID'],
    ['dedupe_key', 'TEXT'],
    ['occurred_at', 'TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()'],
];

async function ensure(
    exec: Exec,
    table: string,
    columns: ReadonlyArray<[string, string]>,
    options: { generatedId?: boolean } = {},
): Promise<void> {
    await exec(`CREATE TABLE IF NOT EXISTS public.${table}(id UUID PRIMARY KEY)`);
    // CREATE TABLE IF NOT EXISTS does not merge column defaults.  The durable
    // challenge migrations generate their identifiers in PostgreSQL; if a
    // different suite created the additive fixture first, their owning
    // migration would keep the earlier bare `id` and every insert would fail.
    if (options.generatedId) {
        await exec(`ALTER TABLE public.${table} ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
    }
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
    await ensure(exec, 'customer_portal_access_challenges', CUSTOMER_PORTAL_ACCESS_CHALLENGE_COLUMNS,
        { generatedId: true });
    await ensure(exec, 'chat_identity_challenges', CHAT_IDENTITY_CHALLENGE_COLUMNS,
        { generatedId: true });
    await ensure(exec, 'onboarding_events', ONBOARDING_EVENT_COLUMNS, { generatedId: true });
    await exec(`CREATE UNIQUE INDEX IF NOT EXISTS synthetic_onboarding_events_dedupe_key
        ON public.onboarding_events(dedupe_key) WHERE dedupe_key IS NOT NULL`);
    await ensure(exec, 'audit_logs', AUDIT_LOG_COLUMNS, { generatedId: true });
    await ensure(exec, 'billing_plans', BILLING_PLAN_COLUMNS, { generatedId: true });
    await exec('CREATE UNIQUE INDEX IF NOT EXISTS synthetic_billing_plans_slug_key ON public.billing_plans(slug)');
    await ensure(exec, 'billing_subscriptions', BILLING_SUBSCRIPTION_COLUMNS, { generatedId: true });
    await exec('CREATE UNIQUE INDEX IF NOT EXISTS synthetic_billing_subscriptions_tenant_key ON public.billing_subscriptions(tenant_id)');
}
