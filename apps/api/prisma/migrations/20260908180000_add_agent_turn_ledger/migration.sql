-- El resultado completo de un turno no era durable. Redis guardaba las palabras
-- bajo `turn:reply:*` y nada más, así que una caída entre generar la respuesta y
-- despacharla reponía el texto y perdía el enlace de pago, las imágenes y sus
-- pies, las huellas de aprendizaje y la identidad de los escritores que ya
-- habían corrido. La respuesta que llegaba después era otra respuesta.
--
-- Esta tabla es la autoridad: existe antes de que se le pida nada a un modelo o
-- a una herramienta, así que una reposición distingue "todavía no corrió nada"
-- de "los escritores corrieron y la respuesta nunca salió". Redis queda como
-- caché delante de ella y nunca decide si el negocio puede volver a ejecutarse.
--
-- Enteramente ADITIVA: CREATE TABLE / CREATE INDEX con IF NOT EXISTS, sin
-- escribir ninguna fila. El código viejo la ignora durante el rolling restart,
-- que es lo que exige expand-contract.
--
-- SQL dinámico porque la tabla vive en el schema de cada tenant.
DO $agent_turn_ledger_backfill$
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

        -- ── Libro del turno ──────────────────────────────────────────────────
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."agent_turn_ledger" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                inbound_message_id UUID NOT NULL UNIQUE,
                conversation_id UUID NOT NULL,
                contact_id UUID NOT NULL,
                channel_type TEXT NOT NULL,
                channel_account_id TEXT,
                recipient TEXT,
                provider_message_id TEXT,
                state TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 1,
                agent_id UUID,
                agent_version INTEGER,
                operational_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
                envelope JSONB,
                writers JSONB NOT NULL DEFAULT '[]'::jsonb,
                handoff JSONB,
                delivery_route TEXT NOT NULL DEFAULT 'unknown',
                redacted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT agent_turn_ledger_state
                    CHECK (state IN ('open','result_recorded','dispatch_owned','settled')),
                CONSTRAINT agent_turn_ledger_route
                    CHECK (delivery_route IN ('unknown','durable','legacy','draft','none')),
                CONSTRAINT agent_turn_ledger_attempts CHECK (attempts >= 1),
                CONSTRAINT agent_turn_ledger_result
                    CHECK (state = 'open' OR envelope IS NOT NULL OR redacted_at IS NOT NULL)
            )
        $ddl$, target);

        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_turn_ledger_conversation
                ON %s."agent_turn_ledger"(conversation_id, created_at DESC)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_turn_ledger_contact
                ON %s."agent_turn_ledger"(contact_id) WHERE redacted_at IS NULL
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_turn_ledger_unsettled
                ON %s."agent_turn_ledger"(updated_at) WHERE state <> 'settled'
        $ddl$, target);
    END LOOP;
END
$agent_turn_ledger_backfill$;
