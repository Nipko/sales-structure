-- Motor de cobros recurrentes propio (Fase F2 del plan Wompi).
--
-- ESTRICTAMENTE ADITIVA: el deploy migra ANTES de recrear los contenedores, así
-- que el código viejo corre contra este schema durante varios minutos. Solo
-- CREATE TABLE / CREATE INDEX / ADD COLUMN nullable o con DEFAULT. Cero RENAME,
-- cero DROP, cero cambio de tipo.
--
-- El motor nace APAGADO: `engine` arranca en 'provider' para todas las filas
-- existentes, de modo que desplegar esto no cambia el comportamiento de ninguna
-- suscripción. Encender el motor es un UPDATE por suscripción, hecho después de
-- que toda la flota corre el código nuevo — un rollout de DATOS, no de código.

-- ---------------------------------------------------------------------------
-- 1. Instrumentos de pago reutilizables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "billing_payment_sources" (
    "id"                    TEXT PRIMARY KEY,
    "tenant_id"             TEXT NOT NULL,
    "provider"              TEXT NOT NULL,
    -- TEXTO aunque el proveedor devuelva un entero: el tipo del id es del
    -- proveedor, no nuestro, y cambiarlo después sería una migración destructiva.
    "provider_source_id"    TEXT NOT NULL,
    "kind"                  TEXT NOT NULL,
    "status"                TEXT NOT NULL,
    -- Gobierna si una renovación puede cobrarse sin el cliente presente.
    "supports_unattended"   BOOLEAN NOT NULL DEFAULT false,
    "is_default"            BOOLEAN NOT NULL DEFAULT false,

    "brand"                 TEXT,
    "last4"                 TEXT,
    "holder_name"           TEXT,
    "exp_month"             INTEGER,
    "exp_year"              INTEGER,
    "phone_masked"          TEXT,

    -- Evidencia de habeas data: los IDENTIFICADORES del consentimiento y cuándo
    -- se dio, nunca los JWT (expiran y no prueban nada después).
    "acceptance_jti"        TEXT,
    "acceptance_file_hash"  TEXT,
    "accepted_at"           TIMESTAMPTZ,
    "accepted_ip"           TEXT,

    -- Autorización fuera de banda (push de billetera, redirección al banco).
    "auth_token_id"         TEXT,
    "auth_url"              TEXT,
    "auth_expires_at"       TIMESTAMPTZ,

    "consecutive_failures"  INTEGER NOT NULL DEFAULT 0,
    "last_success_at"       TIMESTAMPTZ,
    "last_failure_at"       TIMESTAMPTZ,

    "metadata"              JSONB NOT NULL DEFAULT '{}',
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "voided_at"             TIMESTAMPTZ,

    CONSTRAINT "billing_payment_sources_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_payment_sources_provider_source_key"
    ON "billing_payment_sources" ("provider", "provider_source_id");
CREATE INDEX IF NOT EXISTS "billing_payment_sources_tenant_status_idx"
    ON "billing_payment_sources" ("tenant_id", "status");
-- Barrido del cron que avisa 30 días antes de que venza una tarjeta guardada.
CREATE INDEX IF NOT EXISTS "billing_payment_sources_expiry_idx"
    ON "billing_payment_sources" ("status", "exp_year", "exp_month");

-- ---------------------------------------------------------------------------
-- 2. Ledger de intentos de cobro — la pieza central
-- ---------------------------------------------------------------------------
-- UNIQUE(cycle_key, attempt_number) es LA garantía anti-doble-cobro del motor.
-- La fila se reclama ANTES de que se mueva un peso, así que un cron duplicado
-- (todo @Cron corre dos veces: API y worker), un job re-encolado o dos workers
-- compitiendo chocan en el INSERT en vez de cobrar dos veces. Ni la cola ni el
-- lock de cron son la garantía: ambos fallan abierto.
CREATE TABLE IF NOT EXISTS "billing_charge_attempts" (
    "id"                    TEXT PRIMARY KEY,
    "subscription_id"       TEXT NOT NULL,
    "tenant_id"             TEXT NOT NULL,

    "purpose"               TEXT NOT NULL,
    -- {subscriptionId}.{periodStart:YYYYMMDD}.{purpose} — sin ':' (BullMQ lo
    -- rechaza en jobId; ya nos costó un incidente de entregas).
    "cycle_key"             TEXT NOT NULL,
    "attempt_number"        INTEGER NOT NULL DEFAULT 1,

    "status"                TEXT NOT NULL,

    "provider"              TEXT NOT NULL,
    "payment_source_id"     TEXT,

    -- Monto CONGELADO al agendar: un cambio de precio del catálogo no puede
    -- alterar un cobro ya en vuelo (y en Wompi además invalidaría la firma).
    "amount_cents"          INTEGER NOT NULL,
    "currency"              TEXT NOT NULL,
    "fx_rate"               DECIMAL(18,6),
    "amount_usd_cents"      INTEGER,

    -- Lo que viaja al proveedor. Único porque es el ÚNICO asidero para
    -- recuperar un cobro indeterminado tras un timeout de red.
    "reference"             TEXT NOT NULL,
    "provider_txn_id"       TEXT,
    "provider_status"       TEXT,

    "failure_code"          TEXT,
    -- soft (reintenta) | hard (no reintenta contra esta fuente) | indeterminate
    -- (NUNCA engendra otro intento para el mismo cycle_key)
    "failure_class"         TEXT,

    "period_start"          TIMESTAMPTZ NOT NULL,
    "period_end"            TIMESTAMPTZ NOT NULL,
    "scheduled_at"          TIMESTAMPTZ NOT NULL,
    "sent_at"               TIMESTAMPTZ,
    "settled_at"            TIMESTAMPTZ,
    "next_retry_at"         TIMESTAMPTZ,

    -- Patrón de cobro para métodos que no admiten cobro sin usuario presente.
    "checkout_url"          TEXT,
    "checkout_expires_at"   TIMESTAMPTZ,

    -- Una factura fiscal por intento.
    "payment_id"            TEXT,

    "metadata"              JSONB NOT NULL DEFAULT '{}',
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "billing_charge_attempts_subscription_id_fkey"
        FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_charge_attempts_cycle_attempt_key"
    ON "billing_charge_attempts" ("cycle_key", "attempt_number");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_charge_attempts_reference_key"
    ON "billing_charge_attempts" ("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_charge_attempts_payment_id_key"
    ON "billing_charge_attempts" ("payment_id") WHERE "payment_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "billing_charge_attempts_due_idx"
    ON "billing_charge_attempts" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "billing_charge_attempts_provider_txn_idx"
    ON "billing_charge_attempts" ("provider_txn_id");
CREATE INDEX IF NOT EXISTS "billing_charge_attempts_subscription_period_idx"
    ON "billing_charge_attempts" ("subscription_id", "period_start");
-- Barrido de intentos colgados en el proveedor (reconciliación por intento).
CREATE INDEX IF NOT EXISTS "billing_charge_attempts_inflight_idx"
    ON "billing_charge_attempts" ("status", "sent_at");

-- ---------------------------------------------------------------------------
-- 3. Ledger de crédito (append-only)
-- ---------------------------------------------------------------------------
-- Plata a favor del tenant que NO se devolvió en efectivo: prorrateo de un
-- downgrade, un sobrepago, un ajuste manual. Existe porque Wompi no tiene API de
-- reembolso: sin este ledger, un crédito solo podría vivir en la cabeza de
-- alguien. El saldo autoritativo es SUM(delta_cents).
CREATE TABLE IF NOT EXISTS "billing_credit_ledger" (
    "id"                TEXT PRIMARY KEY,
    "tenant_id"         TEXT NOT NULL,
    "subscription_id"   TEXT,

    -- Con signo: positivo acredita al tenant, negativo consume el crédito.
    "delta_cents"       INTEGER NOT NULL,
    "currency"          TEXT NOT NULL,

    "reason"            TEXT NOT NULL,
    "ref_attempt_id"    TEXT,
    "ref_payment_id"    TEXT,
    "created_by"        TEXT,
    "notes"             TEXT,

    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "billing_credit_ledger_subscription_id_fkey"
        FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "billing_credit_ledger_tenant_idx"
    ON "billing_credit_ledger" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "billing_credit_ledger_subscription_idx"
    ON "billing_credit_ledger" ("subscription_id");

-- ---------------------------------------------------------------------------
-- 4. Columnas del motor en las suscripciones (todas con DEFAULT o nullable)
-- ---------------------------------------------------------------------------
ALTER TABLE "billing_subscriptions"
    -- EL INTERRUPTOR. 'provider' = lo agenda y cobra el proveedor (MP/Stripe),
    -- 'internal' = lo hace nuestro motor. Todas las filas existentes quedan en
    -- 'provider', así que este deploy no cambia nada.
    ADD COLUMN IF NOT EXISTS "engine" TEXT NOT NULL DEFAULT 'provider',
    ADD COLUMN IF NOT EXISTS "next_charge_at" TIMESTAMPTZ,
    -- Día del mes ORIGINAL (1..31), guardado aparte para que un recorte de
    -- febrero no arrastre el aniversario hacia atrás para siempre.
    ADD COLUMN IF NOT EXISTS "billing_anchor_day" INTEGER,
    ADD COLUMN IF NOT EXISTS "billing_timezone" TEXT,
    ADD COLUMN IF NOT EXISTS "charge_amount_cents" INTEGER,
    ADD COLUMN IF NOT EXISTS "charge_currency" TEXT,
    ADD COLUMN IF NOT EXISTS "default_payment_source_id" TEXT,
    ADD COLUMN IF NOT EXISTS "unattended_capable" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "dunning_state" TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS "dunning_started_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "dunning_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "credit_balance_cents" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "pending_upgrade_plan_id" TEXT;

-- El scheduler barre exactamente por esta combinación cada pocos minutos.
CREATE INDEX IF NOT EXISTS "billing_subscriptions_engine_due_idx"
    ON "billing_subscriptions" ("engine", "status", "next_charge_at");
