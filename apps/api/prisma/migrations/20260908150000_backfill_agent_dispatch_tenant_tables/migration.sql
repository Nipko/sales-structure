-- Las tablas del despacho durable existían sólo por dos caminos: el bootstrap
-- perezoso, que las crea la PRIMERA vez que un tenant las usa, y
-- `tenant-schema.sql`, que sólo alcanza a los tenants nuevos. Un tenant vivo no
-- las tenía hasta que alguien encendiera el interruptor para él, y ese primer
-- turno pagaba el DDL en el camino crítico de una respuesta a un cliente.
--
-- Esta migración las crea para todos los tenants existentes, antes de que el
-- interruptor pueda encenderse. Es enteramente ADITIVA: sólo CREATE TABLE /
-- CREATE INDEX / ADD COLUMN con IF NOT EXISTS, así que el código viejo la ignora
-- durante el rolling restart, que es lo que exige expand-contract. No escribe
-- ninguna fila: no hay nada que rellenar, sólo el lugar donde escribir.
--
-- Los ADD COLUMN de abajo no son decoración: un tenant que ya había arrancado el
-- outbox con el bootstrap de una versión anterior tiene la tabla pero le faltan
-- las columnas que se agregaron después (`settled_lease_token`, `message_id`,
-- `effects`), y el CREATE TABLE IF NOT EXISTS no lo tocaría.
--
-- SQL dinámico porque cada tabla vive en el schema de su tenant.
DO $agent_dispatch_backfill$
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

        -- ── Recibo canónico de handoff ───────────────────────────────────────
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."agent_handoff_receipts" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL,
                contact_id UUID NOT NULL,
                inbound_message_id UUID NOT NULL UNIQUE,
                channel_type TEXT NOT NULL,
                channel_account_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                from_status TEXT NOT NULL,
                to_status TEXT NOT NULL,
                notice_kind TEXT NOT NULL,
                notice_language TEXT NOT NULL,
                trace_id TEXT,
                effects JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT agent_handoff_receipts_to_status
                    CHECK (to_status IN ('waiting_human','with_human')),
                CONSTRAINT agent_handoff_receipts_from_status
                    CHECK (from_status NOT IN ('waiting_human','with_human','resolved','archived','closed')),
                CONSTRAINT agent_handoff_receipts_notice_kind
                    CHECK (notice_kind IN ('queue_head','transferring','inbox_notice','none')),
                CONSTRAINT agent_handoff_receipts_notice_language
                    CHECK (notice_language IN ('es','en','pt','fr'))
            )$ddl$, target);
        EXECUTE format(
            'ALTER TABLE %s."agent_handoff_receipts" ADD COLUMN IF NOT EXISTS effects JSONB NOT NULL DEFAULT ''{}''::jsonb',
            target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_handoff_receipts_conversation
                ON %s."agent_handoff_receipts"(conversation_id, created_at DESC)$ddl$, target);

        -- ── Outbox de la salida normal ───────────────────────────────────────
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."agent_dispatch_outbox" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                batch_id UUID NOT NULL,
                conversation_id UUID,
                contact_id UUID,
                inbound_message_id UUID NOT NULL,
                channel_type TEXT NOT NULL,
                channel_account_id TEXT NOT NULL,
                recipient TEXT,
                item_index INTEGER NOT NULL,
                item_kind TEXT NOT NULL,
                payload JSONB,
                operational_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
                learning_footprint JSONB,
                state TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                lease_token UUID,
                lease_expires_at TIMESTAMPTZ,
                available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                error_code TEXT,
                receipt TEXT,
                settled_lease_token UUID,
                message_id UUID,
                redacted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT agent_dispatch_outbox_identity UNIQUE (inbound_message_id, item_index),
                CONSTRAINT agent_dispatch_outbox_state
                    CHECK (state IN ('prepared','queued','admitted','sent','stored','suppressed','failed','reconciliation_required')),
                CONSTRAINT agent_dispatch_outbox_kind
                    CHECK (item_kind IN ('text','media','payment_link','flow')),
                CONSTRAINT agent_dispatch_outbox_item_index CHECK (item_index >= 0),
                CONSTRAINT agent_dispatch_outbox_lease
                    CHECK ((state = 'admitted') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
                CONSTRAINT agent_dispatch_outbox_redaction
                    CHECK (redacted_at IS NOT NULL OR (conversation_id IS NOT NULL AND contact_id IS NOT NULL
                        AND recipient IS NOT NULL AND payload IS NOT NULL))
            )$ddl$, target);
        EXECUTE format(
            'ALTER TABLE %s."agent_dispatch_outbox" ADD COLUMN IF NOT EXISTS settled_lease_token UUID', target);
        EXECUTE format(
            'ALTER TABLE %s."agent_dispatch_outbox" ADD COLUMN IF NOT EXISTS message_id UUID', target);

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %1$s."agent_dispatch_outbox_sources" (
                dispatch_id UUID NOT NULL REFERENCES %1$s."agent_dispatch_outbox"(id) ON DELETE CASCADE,
                source_id UUID NOT NULL, source_contact_id UUID,
                PRIMARY KEY (dispatch_id, source_id)
            )$ddl$, target);

        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_pending
                ON %s."agent_dispatch_outbox"(available_at, id)
                WHERE state IN ('prepared','queued','failed')$ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_lease
                ON %s."agent_dispatch_outbox"(lease_expires_at) WHERE state = 'admitted'$ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_batch
                ON %s."agent_dispatch_outbox"(batch_id, item_index)$ddl$, target);
        -- El webhook resuelve un wamid por acá: `messages.external_id` guarda
        -- NUESTRA identidad de deduplicación, no la del proveedor.
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_receipt
                ON %s."agent_dispatch_outbox"(receipt) WHERE receipt IS NOT NULL$ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_contact
                ON %s."agent_dispatch_outbox"(contact_id) WHERE redacted_at IS NULL$ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_sources_source
                ON %s."agent_dispatch_outbox_sources"(source_id, dispatch_id)$ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_dispatch_outbox_sources_contact
                ON %s."agent_dispatch_outbox_sources"(source_contact_id, dispatch_id)$ddl$, target);
    END LOOP;
END
$agent_dispatch_backfill$;
