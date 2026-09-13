-- El resultado del turno, para los tenants que ya existían.
--
-- `agent_turn_ledger` guardaba QUÉ se respondió (`envelope`) pero no si el turno
-- decidió deliberadamente NO responder. Un turno que se queda callado a
-- propósito —el segundo aviso de error del mismo episodio, que sólo compraría
-- otro mensaje entrante y otro cobro— no dejaba más rastro que una línea de log,
-- y una línea de log no se puede consultar, ni contar, ni reanudar.
--
-- La columna la agrega hoy el bootstrap perezoso (`TURN_LEDGER_DDL`) la primera
-- vez que un tenant toca la tabla, así que en la práctica aparece sola. Pero
-- «aparece sola en algún momento» y «existe» no son lo mismo: el tenant que no
-- recibe un mensaje en toda la ventana no la tiene, y la prueba de paridad
-- exige que las TRES definiciones —bootstrap, tenant nuevo y migración— den la
-- misma tabla. Sin esto, cuál de las dos formas tenga un tenant depende de por
-- qué camino se creó, que es exactamente el defecto que aparece meses después
-- en un solo tenant y no se reproduce en ningún otro.
--
-- ADITIVA: una columna nulable y ni una fila escrita.

DO $agent_turn_outcome$
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
        -- Y un tenant que todavía no tiene la tabla tampoco: la crea el
        -- bootstrap con la columna ya adentro.
        -- `target` ya viene por `quote_ident`, que es lo que `to_regclass`
        -- necesita: recibe el nombre y lo parsea como identificador.
        CONTINUE WHEN to_regclass(target || '.agent_turn_ledger') IS NULL;

        EXECUTE format($ddl$
            ALTER TABLE %s."agent_turn_ledger"
                ADD COLUMN IF NOT EXISTS outcome JSONB
        $ddl$, target);
    END LOOP;
END
$agent_turn_outcome$;
