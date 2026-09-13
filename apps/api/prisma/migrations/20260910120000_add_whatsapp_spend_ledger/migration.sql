-- El libro de gasto de WhatsApp, y la zona horaria de la cuenta que paga.
--
-- Desde el 1 de octubre de 2026 Meta cobra cada mensaje de servicio entregado,
-- a la cuenta del negocio. Un efecto saliente pasa a necesitar tres cosas que
-- hoy no tienen dónde vivir: una reserva monetaria tomada ANTES del efecto, los
-- contadores por alcance contra los que se compara, y la asignación que dice
-- cuánto de esa reserva tocó a cada contador.
--
-- ── POR QUÉ TRES TABLAS Y NO DOS ───────────────────────────────────────────
--
-- La primera forma tenía un solo `scope_kind/scope_key` por reserva. Un efecto
-- real toca VARIOS techos a la vez —la cuenta, el negocio, el contacto, la
-- franquicia del número en el mes y la campaña que lo disparó— y liquidarlo o
-- liberarlo tiene que devolverlos todos. Con un solo alcance, cruzar dos topes
-- distintos era imposible de representar y la liberación devolvía a uno solo.
--
-- `whatsapp_spend_allocations` es esa relación, con clave primaria compuesta:
-- una reserva no puede tocar dos veces el mismo contador, ni por reintento ni
-- por carrera. La clave foránea impide además asignar contra un contador que no
-- existe, que es como se pierde plata sin que nadie lo note.
--
-- ── POR QUÉ LA RESERVA GUARDA UNA FOTO Y NO PUNTEROS ───────────────────────
--
-- Identidad congelada: tenant, canal, conexión, WABA y negocio pagador,
-- credencial por identidad, destinatario por referencia segura, categoría,
-- mercado, tarifa, moneda y fecha tarifaria. Un reintento que vuelve a resolver
-- puede elegir otro número cuando el primero está caído —eso se lee como
-- resiliencia y es cobrarle a otra cuenta un mensaje que el cliente ve llegar
-- de un número que no reconoce—, así que el reintento adopta la foto en vez de
-- resolver otra vez.
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

-- SQL dinámico porque las tres tablas viven en el schema de cada tenant.
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
                        cap_kind TEXT NOT NULL,
                        cap_minor BIGINT,
                        cap_deliveries INTEGER,
                        currency TEXT,
                        reserved_minor BIGINT NOT NULL DEFAULT 0,
                        settled_minor BIGINT NOT NULL DEFAULT 0,
                        released_minor BIGINT NOT NULL DEFAULT 0,
                        used_deliveries INTEGER NOT NULL DEFAULT 0,
                        free_deliveries INTEGER NOT NULL DEFAULT 0,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        PRIMARY KEY (scope_kind, scope_key, period_key),
                        CONSTRAINT whatsapp_spend_counters_scope CHECK (scope_kind IN
                            ('account','business','contact','number_month','task')),
                        CONSTRAINT whatsapp_spend_counters_cap_kind CHECK (cap_kind IN
                            ('money','deliveries','observe')),
                        CONSTRAINT whatsapp_spend_counters_money
                            CHECK ((cap_kind = 'money') = (cap_minor IS NOT NULL)),
                        CONSTRAINT whatsapp_spend_counters_deliveries
                            CHECK ((cap_kind = 'deliveries') = (cap_deliveries IS NOT NULL)),
                        CONSTRAINT whatsapp_spend_counters_currency
                            CHECK (cap_kind <> 'money' OR currency IS NOT NULL),
                        CONSTRAINT whatsapp_spend_counters_non_negative CHECK (
                            reserved_minor >= 0 AND settled_minor >= 0 AND released_minor >= 0
                            AND used_deliveries >= 0 AND free_deliveries >= 0
                            AND (cap_minor IS NULL OR cap_minor >= 0)
                            AND (cap_deliveries IS NULL OR cap_deliveries >= 0))
                    )
        $ddl$, target);

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."whatsapp_spend_reservations" (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        effect_key TEXT NOT NULL,
                        inbound_message_id UUID,
                        batch_id UUID,
                        dispatch_item_id UUID,
                        item_index INTEGER,
                        tenant_id UUID NOT NULL,
                        channel_type TEXT NOT NULL,
                        channel_account_id TEXT NOT NULL,
                        channel_address TEXT,
                        payer_kind TEXT NOT NULL,
                        payer_waba_id TEXT,
                        payer_business_id TEXT,
                        credential_id TEXT NOT NULL,
                        credential_source TEXT NOT NULL,
                        recipient_scope TEXT NOT NULL,
                        recipient_ref TEXT NOT NULL,
                        category TEXT NOT NULL,
                        market TEXT,
                        currency TEXT NOT NULL,
                        rate_version TEXT,
                        applied_local_date DATE,
                        admission_reason TEXT NOT NULL,
                        basis TEXT NOT NULL,
                        decision TEXT NOT NULL,
                        reserved_minor BIGINT NOT NULL,
                        unit_ceiling_minor BIGINT NOT NULL,
                        exact_micros BIGINT NOT NULL DEFAULT 0,
                        charged_minor BIGINT,
                        free_deliveries INTEGER NOT NULL DEFAULT 0,
                        charged_deliveries INTEGER NOT NULL DEFAULT 0,
                        state TEXT NOT NULL DEFAULT 'held',
                        provider_message_id TEXT,
                        remote_state TEXT,
                        evidence TEXT,
                        reason TEXT,
                        lease_expires_at TIMESTAMPTZ NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 1,
                        adopted INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        CONSTRAINT whatsapp_spend_reservations_state CHECK (state IN
                            ('held','settled','released','pending_reconciliation','indeterminate')),
                        CONSTRAINT whatsapp_spend_reservations_decision
                            CHECK (decision IN ('accepted','unknown')),
                        CONSTRAINT whatsapp_spend_reservations_payer
                            CHECK (payer_kind IN ('business_direct','partner','unknown')),
                        CONSTRAINT whatsapp_spend_reservations_credential
                            CHECK (credential_source IN ('channel_account','tenant_credential','system_user')),
                        CONSTRAINT whatsapp_spend_reservations_recipient
                            CHECK (recipient_scope IN ('customer','test_recipient','internal','synthetic')),
                        CONSTRAINT whatsapp_spend_reservations_basis CHECK (basis IN
                            ('priced','free_allowance','free_entry_point','unknown')),
                        CONSTRAINT whatsapp_spend_reservations_remote CHECK (remote_state IS NULL
                            OR remote_state IN ('accepted','rejected','unknown','delivered','read','failed')),
                        CONSTRAINT whatsapp_spend_reservations_charged
                            CHECK ((state = 'settled') = (charged_minor IS NOT NULL)),
                        CONSTRAINT whatsapp_spend_reservations_evidence
                            CHECK (state NOT IN ('settled','released') OR evidence IS NOT NULL),
                        CONSTRAINT whatsapp_spend_reservations_non_negative CHECK (
                            reserved_minor >= 0 AND unit_ceiling_minor >= 0 AND exact_micros >= 0
                            AND free_deliveries >= 0 AND charged_deliveries >= 0
                            AND attempts >= 1 AND adopted >= 0
                            AND (charged_minor IS NULL OR charged_minor >= 0))
                    )
        $ddl$, target);

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."whatsapp_spend_allocations" (
                        reservation_id UUID NOT NULL
                            REFERENCES %s."whatsapp_spend_reservations"(id) ON DELETE CASCADE,
                        scope_kind TEXT NOT NULL,
                        scope_key TEXT NOT NULL,
                        period_key TEXT NOT NULL,
                        amount_minor BIGINT NOT NULL DEFAULT 0,
                        deliveries INTEGER NOT NULL DEFAULT 0,
                        currency TEXT,
                        state TEXT NOT NULL DEFAULT 'reserved',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                        PRIMARY KEY (reservation_id, scope_kind, scope_key, period_key),
                        FOREIGN KEY (scope_kind, scope_key, period_key)
                            REFERENCES %s."whatsapp_spend_counters"(scope_kind, scope_key, period_key),
                        CONSTRAINT whatsapp_spend_allocations_state
                            CHECK (state IN ('reserved','settled','released')),
                        CONSTRAINT whatsapp_spend_allocations_non_negative
                            CHECK (amount_minor >= 0 AND deliveries >= 0)
                    )
        $ddl$, target, target, target);

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
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_receipt
                        ON %s."whatsapp_spend_reservations" (provider_message_id)
                        WHERE provider_message_id IS NOT NULL
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_dispatch
                        ON %s."whatsapp_spend_reservations" (dispatch_item_id)
                        WHERE dispatch_item_id IS NOT NULL
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_alloc_counter
                        ON %s."whatsapp_spend_allocations" (scope_kind, scope_key, period_key)
        $ddl$, target);
    END LOOP;
END
$whatsapp_spend_ledger$;
