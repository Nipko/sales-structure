-- Para que la plataforma pueda notar que está por decir lo mismo otra vez.
--
-- `effect_key` ya es un hash del contenido, pero es un hash de TODO: productor,
-- ordinal, categoría y contenido juntos. Sirve para que un reintento encuentre
-- su propia reserva, y no sirve para la pregunta distinta que aparece con el
-- cobro por mensaje:
--
--     ¿ya le mandamos exactamente esto a esta persona, hace un rato?
--
-- Esa es la pregunta que atrapa los dos desperdicios más caros y más invisibles:
--
--   · DOS PRODUCTORES, UN MENSAJE. El recordatorio de la cita y el paso del
--     drip dicen la misma frase al mismo cliente con diez minutos de
--     diferencia. Son dos `effect_key` distintos porque el productor es parte
--     de la clave, así que hoy son dos cargos y dos notificaciones idénticas en
--     el teléfono de alguien.
--   · EL AGENTE REPITIÉNDOSE. Un turno que no avanza produce la misma
--     respuesta que el anterior. El cliente escribe otra vez, el turno vuelve a
--     no avanzar, y el bucle se cobra entero. Nótese que esto se mide sobre lo
--     que decimos NOSOTROS: nada mira las palabras del cliente, así que una
--     queja, una persona que insiste o un pedido de humano son indistinguibles
--     de cualquier otro mensaje y no pueden convertirse en motivo para dejar de
--     responder.
--
-- El índice es parcial sobre los estados que prueban que el mensaje existió
-- —`held`, `settled`, `pending_reconciliation`, `indeterminate`—. Una reserva
-- `released` es un rechazo probado: el cliente no recibió nada, así que volver
-- a intentarlo no es repetir.
--
-- La columna es NULLABLE a propósito. Toda fila anterior a esta migración no
-- tiene digest y no puede inventarse uno; `NULL` no participa de ninguna
-- comparación de igualdad, así que esas filas simplemente no cuentan como
-- repeticiones, que es exactamente lo que corresponde: no sabemos qué decían.
--
-- ADITIVA: `ADD COLUMN IF NOT EXISTS` nullable y `CREATE INDEX IF NOT EXISTS`.
-- El binario anterior sigue escribiendo estas filas sin conocer la columna.

DO $spend_digest$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );
        CONTINUE WHEN to_regclass(target || '.whatsapp_spend_reservations') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD COLUMN IF NOT EXISTS content_digest TEXT
        $ddl$, target);

        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_recent_identical
                ON %s."whatsapp_spend_reservations"
                (channel_account_id, recipient_ref, content_digest, created_at DESC)
                WHERE content_digest IS NOT NULL
                  AND state IN ('held','settled','pending_reconciliation','indeterminate')
        $ddl$, target);
    END LOOP;
END
$spend_digest$;
