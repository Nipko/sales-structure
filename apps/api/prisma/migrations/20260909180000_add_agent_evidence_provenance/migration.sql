-- Marcas de procedencia para la evidencia del agente.
--
-- Enteramente ADITIVA: sólo ADD COLUMN IF NOT EXISTS sobre columnas nulables y
-- ni una fila escrita, así que el código viejo las ignora durante el rolling
-- restart, que es lo que exige expand-contract.
--
-- Una fila anterior a esto no nombra ningún release, así que nada la invalida
-- y nada finge hacerlo: invalidar por sospecha tiraría evidencia que puede ser
-- perfectamente sólida. `evidenceWithoutProvenance` las cuenta, para que el
-- hueco sea un número que alguien pueda ver y no un silencio.
DO $agent_evidence_provenance$
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
        -- eval_runs: un tenant sin esta tabla tampoco detiene al resto.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                    WHERE table_schema = tenant_record."schema_name"
                      AND table_name = 'eval_runs') THEN
            EXECUTE format($ddl$
                ALTER TABLE %s."eval_runs"
                    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS invalidated_reason TEXT
            $ddl$, target);
        END IF;
        -- simulation_runs: un tenant sin esta tabla tampoco detiene al resto.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                    WHERE table_schema = tenant_record."schema_name"
                      AND table_name = 'simulation_runs') THEN
            EXECUTE format($ddl$
                ALTER TABLE %s."simulation_runs"
                    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS invalidated_reason TEXT
            $ddl$, target);
        END IF;
        -- agent_release_evidence: un tenant sin esta tabla tampoco detiene al resto.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                    WHERE table_schema = tenant_record."schema_name"
                      AND table_name = 'agent_release_evaluations') THEN
            EXECUTE format($ddl$
                ALTER TABLE %s."agent_release_evaluations"
                    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS invalidated_reason TEXT
            $ddl$, target);
        END IF;
        -- quality_regression_cases: un tenant sin esta tabla tampoco detiene al resto.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                    WHERE table_schema = tenant_record."schema_name"
                      AND table_name = 'quality_regression_cases') THEN
            EXECUTE format($ddl$
                ALTER TABLE %s."quality_regression_cases"
                    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS invalidated_reason TEXT,
                    ADD COLUMN IF NOT EXISTS source_release_ids TEXT[]
            $ddl$, target);
        END IF;
        -- quality_scores: un tenant sin esta tabla tampoco detiene al resto.
        IF EXISTS (SELECT 1 FROM "information_schema"."tables"
                    WHERE table_schema = tenant_record."schema_name"
                      AND table_name = 'conversation_quality_scores') THEN
            EXECUTE format($ddl$
                ALTER TABLE %s."conversation_quality_scores"
                    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS invalidated_reason TEXT,
                    ADD COLUMN IF NOT EXISTS source_release_ids TEXT[]
            $ddl$, target);
        END IF;
    END LOOP;
END
$agent_evidence_provenance$;
