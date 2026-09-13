-- Un turno que decidió no responder ya puede asentarse.
--
-- `agent_turn_ledger_result` exigía un `envelope` para cualquier estado que no
-- fuera `open`. Un turno silencioso —el segundo aviso de error del mismo
-- episodio, que sólo compraría otro mensaje entrante y otro cargo— tiene
-- `outcome` y NO tiene `envelope`, así que al pasarlo a `settled` PostgreSQL
-- rechazaba el UPDATE y la fila quedaba en `result_recorded` para siempre: el
-- libro contradiciendo la decisión que le pidieron registrar. Y el store sólo
-- dejaba un warning, así que no se veía.
--
-- Se ENSANCHA, no se elimina: un estado posterior a `open` sigue teniendo que
-- llevar algo —envelope, outcome o la marca de borrado—, o la fila afirma que
-- no pasó nada cuando sí pasó.
--
-- `NOT VALID` y después `VALIDATE`: la regla nueva está implicada por la vieja,
-- así que toda fila existente ya la cumple. Añadirla directamente escanearía la
-- tabla entera con el lock exclusivo tomado, mientras el binario anterior sigue
-- atendiendo turnos contra este schema; así el lock exclusivo dura un instante y
-- la validación corre con un lock que no bloquea lecturas ni escrituras.
--
-- Idempotente por definición y no por nombre: mira el texto del CHECK, así que
-- re-aplicarla no vuelve a escanear nada.

DO $widen_turn_result$
DECLARE
    tenant_record RECORD;
    target TEXT;
    current_def TEXT;
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
        -- Un tenant que todavía no tiene la tabla tampoco: el bootstrap la crea
        -- con la forma nueva.
        CONTINUE WHEN to_regclass(target || '.agent_turn_ledger') IS NULL;

        SELECT pg_get_constraintdef(con.oid) INTO current_def
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = tenant_record."schema_name"
           AND rel.relname = 'agent_turn_ledger'
           AND con.conname = 'agent_turn_ledger_result';

        CONTINUE WHEN current_def IS NOT NULL AND position('outcome' in current_def) > 0;

        EXECUTE format($ddl$
            ALTER TABLE %s."agent_turn_ledger"
                DROP CONSTRAINT IF EXISTS agent_turn_ledger_result
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_turn_ledger"
                ADD CONSTRAINT agent_turn_ledger_result
                CHECK (state = 'open' OR envelope IS NOT NULL OR outcome IS NOT NULL
                       OR redacted_at IS NOT NULL) NOT VALID
        $ddl$, target);
        EXECUTE format($ddl$
            ALTER TABLE %s."agent_turn_ledger" VALIDATE CONSTRAINT agent_turn_ledger_result
        $ddl$, target);
    END LOOP;
END
$widen_turn_result$;
