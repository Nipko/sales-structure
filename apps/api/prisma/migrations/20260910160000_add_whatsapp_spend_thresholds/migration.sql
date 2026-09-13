-- Un tope deja de ser un acantilado y pasa a tener tres alturas.
--
-- Un solo número —el techo— sólo sabe hacer una cosa: dejar pasar todo hasta
-- que, de un mensaje al siguiente, no deja pasar nada. Para el dueño de un
-- negocio eso se ve exactamente igual que una caída: el agente respondía y
-- ahora no responde, sin aviso previo y sin distinguir entre la campaña que él
-- programó y el cliente que acaba de escribir.
--
-- Con tres alturas el mismo techo explica lo que está pasando:
--
--   · `warn_permille`   — avisar. No detiene nada.
--   · `soft_permille`   — detener lo que NOSOTROS iniciamos: campañas, drips,
--                         recordatorios, seguimientos. Una persona que escribió
--                         sigue siendo respondida.
--   · el techo mismo    — detener todo lo cobrable.
--
-- El orden importa y por eso es un CHECK y no una convención: `warn <= soft <=
-- techo`. Invertidos, el "aviso" llegaría después del corte y el soft stop
-- cortaría antes que el aviso, que es peor que no tenerlos.
--
-- ── POR QUÉ POR MILLE Y NO UNA COLUMNA DE MONTO ─────────────────────────────
--
-- Un umbral absoluto hay que reescribirlo cada vez que cambia el techo, y el
-- día que alguien sube el techo y olvida el umbral, el soft stop queda por
-- debajo del aviso. Una fracción del techo se mueve con él. Por mille y no por
-- ciento porque 99,5 % es un ajuste razonable y `SMALLINT` no guarda decimales.
--
-- Los defectos (800/950) son deliberadamente distintos de "apagado": un tenant
-- que configura un techo y nada más obtiene aviso al 80 % y protección de lo
-- proactivo al 95 % sin tener que saber que esos ajustes existen. Quien quiera
-- el acantilado pone los tres en 1000.
--
-- ADITIVA: sólo `ADD COLUMN IF NOT EXISTS` con DEFAULT y `ADD CONSTRAINT NOT
-- VALID` + `VALIDATE`. El binario anterior sigue escribiendo estas filas
-- mientras corre la migración y no conoce ninguna de las dos columnas; por eso
-- llevan DEFAULT y NOT NULL, para que su INSERT siga siendo válido.

DO $spend_thresholds$
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
        -- Un tenant sin la tabla todavía tampoco: el bootstrap la crea ya con
        -- las columnas nuevas.
        CONTINUE WHEN to_regclass(target || '.whatsapp_spend_counters') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                ADD COLUMN IF NOT EXISTS warn_permille SMALLINT NOT NULL DEFAULT 800
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                ADD COLUMN IF NOT EXISTS soft_permille SMALLINT NOT NULL DEFAULT 950
        $ddl$, target);

        -- `IF NOT EXISTS` no existe para constraints; el DROP previo lo hace
        -- idempotente sin escanear, porque lo que sigue es `NOT VALID`.
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                DROP CONSTRAINT IF EXISTS whatsapp_spend_counters_thresholds
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                ADD CONSTRAINT whatsapp_spend_counters_thresholds
                CHECK (warn_permille > 0 AND warn_permille <= soft_permille
                       AND soft_permille <= 1000) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."whatsapp_spend_counters"
                VALIDATE CONSTRAINT whatsapp_spend_counters_thresholds
        $ddl$, target);
    END LOOP;
END
$spend_thresholds$;
