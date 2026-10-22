-- La verdad de la entrega de un turno, para los tenants que ya existían.
--
-- `agent_turn_ledger` se asentaba cuando `runTurn` volvía, y eso sólo decía
-- que el TURNO terminó, no que el cliente recibió algo. QA de producción
-- (2026-10-22): una respuesta de Telegram murió con `fetch failed`, la fila del
-- outbox quedó en `reconciliation_required`, el mensaje en `pending`, el
-- cliente no recibió nada... y el libro decía `settled` con outcome `send`.
--
-- Estas columnas registran lo que el outbox supo después:
--   delivery_state       pending | delivered | failed | unknown | suppressed
--                        (NULL = no rastreado, que es lo que honestamente es
--                        toda fila escrita por el binario anterior)
--   delivery_receipt     el recibo del proveedor que prueba la entrega
--   delivery_updated_at  cuándo cambió por última vez
--   answered_at          el primer momento en que un recibo probó la respuesta
--
-- El bootstrap perezoso (`TURN_LEDGER_DDL`) y `tenant-schema.sql` producen la
-- misma forma; la prueba de paridad exige que las TRES definiciones coincidan.
--
-- ADITIVA: columnas nulables y un índice parcial, ni una fila escrita. El
-- binario anterior las ignora durante el rolling restart (expand-contract).

DO $agent_turn_delivery_truth$
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
        -- Un tenant que todavía no tiene la tabla tampoco: la crea el
        -- bootstrap con las columnas ya adentro.
        CONTINUE WHEN to_regclass(target || '.agent_turn_ledger') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."agent_turn_ledger"
                ADD COLUMN IF NOT EXISTS delivery_state TEXT,
                ADD COLUMN IF NOT EXISTS delivery_receipt TEXT,
                ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_agent_turn_ledger_undelivered
                ON %s."agent_turn_ledger"(created_at)
                WHERE delivery_state IN ('pending','unknown','failed')
        $ddl$, target);
    END LOOP;
END
$agent_turn_delivery_truth$;
