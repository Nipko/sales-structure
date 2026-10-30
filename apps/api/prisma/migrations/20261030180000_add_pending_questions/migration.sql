-- Bucle de conocimiento pendiente (C0 §1.5 y §2.6, rebanada R5, ADR 0011).
--
-- `<tenant>.pending_questions`: una fila por tema que el agente no pudo responder, con su demanda y su estado
-- (gap → open → answered | stored → closed, o dismissed); una sola fila abierta por `topic_key` (índice único parcial).
-- `<tenant>.pending_question_waiters`: los clientes que aceptaron «lo averiguo», con su idioma y el estado del aviso.
-- `tenant-schema.sql` crea las mismas tablas en cada tenant nuevo (bloque PENDING QUESTIONS) y
-- `pending-questions-schema.spec.ts` exige que las dos definiciones coincidan.
--
-- ADITIVA: dos tablas nuevas, ni una fila escrita. `kb_unanswered_queries` NO se toca (tiene datos): queda sin
-- escritores ni lectores y su borrado es una tarea pendiente del dueño (ADR 0011). El binario anterior no conoce estas
-- tablas y el nuevo tolera que falten (registra el hueco en el log y sigue), así que el orden migración → contenedores
-- es seguro en los dos sentidos.

DO $pending_questions$
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
            CREATE TABLE IF NOT EXISTS %1$s."pending_questions" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                requirement_id TEXT,
                item_ref TEXT,
                intent_id TEXT,
                topic_key TEXT NOT NULL,
                sample_question TEXT NOT NULL,
                sample_conversation_id UUID,
                language TEXT,
                source TEXT NOT NULL DEFAULT 'agent',
                status TEXT NOT NULL DEFAULT 'gap',
                occurrences INTEGER NOT NULL DEFAULT 1,
                waiters_count INTEGER NOT NULL DEFAULT 0,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                sla_due_at TIMESTAMPTZ,
                answered_by UUID,
                answered_at TIMESTAMPTZ,
                answer_text TEXT,
                stored_value_id UUID,
                closed_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                CONSTRAINT pending_questions_status CHECK (status IN ('gap','open','answered','stored','closed','dismissed')),
                CONSTRAINT pending_questions_source CHECK (source IN ('agent','retrieval'))
            )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_questions_open_topic
                ON %1$s."pending_questions" (topic_key) WHERE status IN ('gap','open')
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_pending_questions_status
                ON %1$s."pending_questions" (status, last_seen_at DESC)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %1$s."pending_question_waiters" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                pending_question_id UUID NOT NULL REFERENCES %1$s."pending_questions" (id) ON DELETE CASCADE,
                conversation_id UUID NOT NULL,
                contact_id UUID,
                language TEXT,
                accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                notified_at TIMESTAMPTZ,
                notify_status TEXT NOT NULL DEFAULT 'waiting',
                notify_detail TEXT,
                CONSTRAINT pending_question_waiters_status CHECK (notify_status IN ('waiting','sent','template_required','opted_out','skipped_human','skipped_closed','no_channel','sandbox','failed','dismissed')),
                CONSTRAINT pending_question_waiters_once UNIQUE (pending_question_id, conversation_id)
            )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_pending_question_waiters_contact
                ON %1$s."pending_question_waiters" (contact_id)
        $ddl$, target);
    END LOOP;
END
$pending_questions$;
