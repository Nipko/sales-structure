-- Guardar si el mensaje lo empezamos nosotros o lo empezó el cliente.
--
-- La distinción ya se calcula en la admisión —es lo que lee el soft stop, que
-- pausa campañas y sigue respondiendo a quien escribió— pero se perdía en el
-- momento de escribir la fila. Sin ella, el libro puede decir cuánto se gastó y
-- no puede decir lo único que importa para saber si ese gasto valió la pena:
--
--     ¿esto fue una respuesta, o fuimos nosotros?
--
-- De ahí salen las señales que el dueño de un negocio necesita y hoy no tiene:
--
--   · CONTACTOS QUE SÓLO GENERAN GASTO. Alguien a quien la plataforma le
--     escribió veinte veces y que nunca escribió de vuelta. No es una
--     clasificación de esa persona ni una suposición sobre sus intenciones: es
--     un recuento de lo que hicimos NOSOTROS, y lo que dice es que veinte
--     mensajes no produjeron ninguna conversación.
--   · CATEGORÍAS Y PAÍSES CAROS. `category` y `market` ya están en la fila; con
--     la disposición al lado, "el gasto de utility en México" se puede separar
--     entre lo que contestamos y lo que iniciamos.
--
-- Nada de esto bloquea nada. Son lecturas: el bloqueo por repetición y los
-- techos son otros mecanismos, y ninguno mira jamás las palabras del cliente.
--
-- NULLABLE a propósito: toda fila anterior no tiene disposición y no puede
-- inventarse una. `NULL` no participa de ninguna igualdad, así que esas filas
-- quedan fuera de los agregados por disposición en vez de contarse como si
-- fueran una de las dos.
--
-- ADITIVA: `ADD COLUMN IF NOT EXISTS` nullable con CHECK `NOT VALID` +
-- `VALIDATE`. El binario anterior sigue escribiendo estas filas sin conocerla,
-- y por eso la columna no puede ser NOT NULL.

DO $spend_disposition$
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
                ADD COLUMN IF NOT EXISTS disposition TEXT
        $ddl$, target);

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                DROP CONSTRAINT IF EXISTS whatsapp_spend_reservations_disposition
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                ADD CONSTRAINT whatsapp_spend_reservations_disposition
                CHECK (disposition IS NULL OR disposition IN ('reactive','proactive')) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_reservations"
                VALIDATE CONSTRAINT whatsapp_spend_reservations_disposition
        $ddl$, target);

        -- El índice de "¿a quién le escribimos sin que nos escriba?": por
        -- cuenta y destinatario, sólo sobre lo que nosotros iniciamos.
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_spend_proactive_recipient
                ON %s."whatsapp_spend_reservations"
                (channel_account_id, recipient_ref, created_at DESC)
                WHERE disposition = 'proactive'
        $ddl$, target);
    END LOOP;
END
$spend_disposition$;
