-- ═══ LA CONEXIÓN DE ORIGEN, PARA CUATRO OPERACIONES QUE NO LA GUARDABAN ═══
--
-- `tools.<familia>.emailConfirmations` es un interruptor POR AGENTE, y el
-- agente que corresponde es el que atendió la conexión donde nació la
-- operación. Esa conexión se lee del hilo (`conversations.channel_type` /
-- `channel_account_id`), así que una operación que no guarda su
-- `conversation_id` no puede decir de quién es el interruptor: el resolutor
-- devuelve "no hay agente que preguntar" y —por contrato— NO silencia el aviso.
--
-- `class_bookings`, `enrollments`, `insurance_quotes` y `resource_rentals` son
-- las cuatro tablas de operación que no tenían la columna. Sin ella el control
-- del dueño no tiene a quién consultar; con ella, el writer la escribe cuando
-- el llamador trae el hilo.
--
-- ── POR QUÉ ES SEGURA EN EXPAND-CONTRACT ────────────────────────────────────
--
-- El deploy migra ANTES de recrear los contenedores, así que el código viejo
-- corre contra este schema durante minutos. Todo acá es ADITIVO:
--   · sólo `ADD COLUMN ... IF NOT EXISTS`, nulable y sin default — el código
--     viejo hace `INSERT` nombrando columnas y nunca la menciona, así que sigue
--     funcionando igual;
--   · sólo `CREATE INDEX IF NOT EXISTS`, parcial;
--   · ni un `RENAME`, ni un `DROP`, ni un `NOT NULL`, ni un backfill de filas.
-- No hay segundo deploy pendiente: la columna no reemplaza a ninguna.
--
-- ── POR QUÉ NULABLE, Y QUÉ SIGNIFICA UN NULL ────────────────────────────────
--
-- `NULL` es una respuesta real y la de todas las filas que ya existen: sin
-- hilo no hay agente que servir, y el resolutor lo trata como "el dueño no
-- apagó nada" (ver `served-confirmation-policy.util.ts`). Eso es el fallback
-- documentado, no una adivinanza: adivinar un agente sería leer el interruptor
-- de alguien que no atendió esa operación, que es exactamente el defecto que
-- esta columna existe para cerrar.
--
-- Sin FOREIGN KEY, igual que los demás `conversation_id` agregados tarde en
-- este schema (`consent_records`, `analytics_events`): una FK `NOT VALID` más
-- su `VALIDATE` serían un segundo deploy sin ganancia de conducta acá, y el
-- borrado de una conversación no debe arrastrar la operación comercial.
--
-- SQL dinámico porque cada tabla vive en el schema de su tenant.
DO $operation_origin_thread$
DECLARE
    tenant_record RECORD;
    target TEXT;
    operation_table TEXT;
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

        FOREACH operation_table IN ARRAY ARRAY[
            'class_bookings', 'enrollments', 'insurance_quotes', 'resource_rentals'
        ]
        LOOP
            -- Las tablas verticales son perezosas: un tenant que nunca usó
            -- gimnasios no tiene `class_bookings`, y eso no es un error.
            CONTINUE WHEN NOT EXISTS (
                SELECT 1 FROM "information_schema"."tables"
                WHERE "table_schema" = tenant_record."schema_name"
                  AND "table_name" = operation_table
            );

            EXECUTE format(
                'ALTER TABLE %s.%s ADD COLUMN IF NOT EXISTS "conversation_id" UUID',
                target, quote_ident(operation_table));

            -- Parcial: la mayoría de las filas históricas lo tienen en NULL y
            -- un índice que las incluya sólo ocupa lugar.
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %s ON %s.%s ("conversation_id")'
                || ' WHERE "conversation_id" IS NOT NULL',
                quote_ident('idx_' || operation_table || '_conversation'),
                target, quote_ident(operation_table));
        END LOOP;
    END LOOP;
END
$operation_origin_thread$;
