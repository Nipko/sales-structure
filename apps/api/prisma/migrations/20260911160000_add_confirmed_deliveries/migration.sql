-- La franquicia se gasta al ENTREGAR, no al intentar.
--
-- Meta regala 1.000 mensajes de servicio por número y mes calendario, y los
-- descuenta de las ENTREGAS. Nosotros los descontábamos en `authorize`, antes
-- del POST, y no los devolvíamos nunca:
--
--   · mil intentos fallidos agotaban las mil entregas gratuitas del mes, y a
--     partir de ahí el negocio pagaba cada respuesta mientras Meta seguía
--     regalándoselas;
--   · un número con un problema de configuración —plantilla rechazada, ventana
--     cerrada, destinatario inválido— quemaba la franquicia entera en minutos
--     sin que llegara un solo mensaje.
--
-- Lo mismo pasaba con cualquier contador tope-por-entregas: `used_deliveries`
-- subía en la reserva y no bajaba nunca, así que un rechazo consumía cupo igual
-- que una entrega.
--
-- ── LA ASIGNACIÓN PROVISIONAL ───────────────────────────────────────────────
--
-- `used_deliveries` pasa a significar RETENIDO: lo que está comprometido, se
-- haya entregado o no. Es lo correcto para decidir un tope, porque un intento
-- en vuelo es exposición.
--
-- `confirmed_deliveries` es la otra mitad, y es nueva: lo que de verdad llegó.
-- La diferencia entre las dos es exactamente el trabajo sin resolver.
--
--   authorize/accepted   retiene   (`used_deliveries += n`)
--   delivered/read       confirma  (`confirmed_deliveries += n`, retenido igual)
--   failed/rejected      devuelve  (`used_deliveries -= n`)
--   indeterminate        retiene   (nadie sabe; sigue comprometido)
--
-- El retorno viaja por `whatsapp_spend_allocations`, que ya dice cuánto de esta
-- reserva tocó cada contador. La franquicia no escribía asignación —el alcance
-- `number_month` se saltaba el bucle—, así que tampoco tenía por dónde volver.
--
-- ADITIVA: una columna con DEFAULT. El binario anterior no la conoce y sus
-- INSERT siguen siendo válidos durante el despliegue.

DO $confirmed_deliveries$
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
        CONTINUE WHEN to_regclass(target || '.whatsapp_spend_counters') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                ADD COLUMN IF NOT EXISTS confirmed_deliveries INTEGER NOT NULL DEFAULT 0
        $ddl$, target);

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                DROP CONSTRAINT IF EXISTS whatsapp_spend_counters_confirmed
        $ddl$, target);
        -- Confirmado nunca puede pasar a retenido: lo entregado es un
        -- subconjunto de lo comprometido, y la diferencia es el trabajo que
        -- sigue sin resolverse. Si esta desigualdad se rompe, el número que la
        -- pantalla llama "entregas gratis usadas" dejó de significar algo.
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                ADD CONSTRAINT whatsapp_spend_counters_confirmed
                CHECK (confirmed_deliveries >= 0
                       AND confirmed_deliveries <= used_deliveries) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                VALIDATE CONSTRAINT whatsapp_spend_counters_confirmed
        $ddl$, target);
    END LOOP;
END
$confirmed_deliveries$;
