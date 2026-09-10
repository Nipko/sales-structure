-- El libro de gasto de WhatsApp, y la zona horaria de la cuenta que paga.
--
-- Desde el 1 de octubre de 2026 Meta cobra cada mensaje de servicio entregado,
-- a la cuenta del negocio. Un efecto saliente pasa a necesitar dos cosas que
-- hoy no tienen dónde vivir: una reserva monetaria tomada ANTES del efecto, y
-- un contador por alcance contra el que compararla. Las formas salen de
-- `modules/billing/whatsapp-rates/RESERVATION-DESIGN.md` §2.
--
-- ADITIVA: sólo CREATE TABLE / CREATE INDEX / ADD COLUMN IF NOT EXISTS sobre
-- una columna nulable, y ni una fila escrita. El código anterior ignora todo
-- esto durante el rolling restart, que es lo que exige expand-contract.
--
-- ── POR QUÉ LA ZONA HORARIA ES DE LA CUENTA Y NO DEL TENANT ────────────────
--
-- La tarifa depende de la fecha efectiva y la franquicia gratuita es POR NÚMERO
-- y por mes calendario. Las dos preguntas son «¿en qué día y en qué mes está
-- esta cuenta de WhatsApp?», y la respuesta es la zona de la WABA, no la del
-- negocio ni la del servidor: un tenant puede tener números en dos países, y un
-- mensaje de las 23:30 del 30 de septiembre en Bogotá ya es octubre en UTC. Por
-- eso no reusa `tenants.operating_timezone` (dónde opera el negocio) ni
-- `billing_subscriptions.billing_timezone` (cuándo le cobramos NOSOTROS): son
-- tres preguntas distintas que hoy se contestan igual por casualidad.
--
-- Nulable a propósito: el resolvedor exige una zona IANA y NO tiene default,
-- así que una cuenta sin zona se resuelve como `unknown` en vez de cobrarse con
-- la zona equivocada.
--
-- El CHECK está porque Meta devuelve `timezone_id`, que es un ENTERO de
-- Facebook («12»), no una zona IANA — `meta-graph.service.ts` ya lo trae y hoy
-- no lo guarda nadie. Escribirlo acá tal cual dejaría a `Intl.DateTimeFormat`
-- rechazando cada precio para siempre. Que la base lo rechace en el INSERT
-- convierte ese error en un fallo visible el día que se escribe, y no en un
-- canal que dejó de entregar sin explicación.

ALTER TABLE "public"."channel_accounts"
    ADD COLUMN IF NOT EXISTS "waba_timezone" VARCHAR(64);

DO $waba_timezone_shape$
BEGIN
    ALTER TABLE "public"."channel_accounts"
        ADD CONSTRAINT "channel_accounts_waba_timezone_iana"
        CHECK ("waba_timezone" IS NULL
               OR "waba_timezone" = 'UTC'
               OR "waba_timezone" ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_.-]+)+$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$waba_timezone_shape$;

COMMENT ON COLUMN "public"."channel_accounts"."waba_timezone" IS
    'IANA zone of the WhatsApp Business Account Meta bills, e.g. America/Bogota. '
    'NULL means unknown and the rate resolver refuses rather than defaulting: '
    'the effective date and the free monthly allowance are both answered here. '
    'Never Meta timezone_id, which is a numeric Facebook id.';

-- SQL dinámico porque las dos tablas viven en el schema de cada tenant.
DO $whatsapp_spend_ledger$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        -- Un schema nombrado en `tenants` que ya no existe no detiene al resto.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."whatsapp_spend_counters" (
                        scope_kind TEXT NOT NULL,
                        scope_key TEXT NOT NULL,
                        period_key TEXT NOT NULL,
                        cap_minor BIGINT,
                        cap_deliveries INTEGER,
                        reserved_minor BIGINT NOT NULL DEFAULT 0,
                        settled_minor BIGINT NOT NULL DEFAULT 0,
                        used_deliveries INTEGER NOT NULL DEFAULT 0,
                        currency TEXT,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        PRIMARY KEY (scope_kind, scope_key, period_key),
                        CONSTRAINT whatsapp_spend_counters_scope CHECK (scope_kind IN
                            ('account','business','contact','number_month')),
                        CONSTRAINT whatsapp_spend_counters_one_cap
                            CHECK (num_nonnulls(cap_minor, cap_deliveries) <= 1),
                        CONSTRAINT whatsapp_spend_counters_non_negative CHECK (
                            reserved_minor >= 0 AND settled_minor >= 0 AND used_deliveries >= 0)
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."whatsapp_spend_reservations" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        effect_key TEXT NOT NULL,
                        state TEXT NOT NULL DEFAULT 'held',
                        decision TEXT NOT NULL,
                        basis TEXT NOT NULL,
                        scope_kind TEXT,
                        scope_key TEXT,
                        period_key TEXT,
                        reserved_minor BIGINT NOT NULL,
                        unit_ceiling_minor BIGINT NOT NULL,
                        charged_minor BIGINT,
                        currency TEXT NOT NULL,
                        free_deliveries INTEGER NOT NULL DEFAULT 0,
                        charged_deliveries INTEGER NOT NULL DEFAULT 0,
                        rate_version TEXT,
                        applied_local_date DATE,
                        exact_micros BIGINT NOT NULL DEFAULT 0,
                        reason TEXT,
                        lease_expires_at TIMESTAMPTZ NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        CONSTRAINT whatsapp_spend_reservations_state CHECK (state IN
                            ('held','settled','released','pending_reconciliation','indeterminate')),
                        CONSTRAINT whatsapp_spend_reservations_decision
                            CHECK (decision IN ('accepted','unknown')),
                        CONSTRAINT whatsapp_spend_reservations_charged
                            CHECK ((state = 'settled') = (charged_minor IS NOT NULL)),
                        CONSTRAINT whatsapp_spend_reservations_non_negative CHECK (
                            reserved_minor >= 0 AND unit_ceiling_minor >= 0 AND exact_micros >= 0
                            AND free_deliveries >= 0 AND charged_deliveries >= 0
                            AND (charged_minor IS NULL OR charged_minor >= 0))
                    )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_whatsapp_spend_effect
                        ON %s."whatsapp_spend_reservations" (effect_key)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_open
                        ON %s."whatsapp_spend_reservations" (lease_expires_at)
                        WHERE state IN ('held','pending_reconciliation','indeterminate')
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_scope
                        ON %s."whatsapp_spend_reservations" (scope_kind, scope_key, period_key)
        $ddl$, target);
    END LOOP;
END
$whatsapp_spend_ledger$;
