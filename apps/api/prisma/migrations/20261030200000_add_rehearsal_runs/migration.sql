-- Ensayo antes de salir (C0 §1.4 C4, rebanada R7, ADR 0013).
--
-- `<tenant>.rehearsal_runs`: una ejecución del ensayo con su banco congelado (`bank`, `bank_hash`), progreso, resumen
-- (tasa de aciertos) y costo (modelos y tokens del agente y del juez). `<tenant>.rehearsal_results`: un caso calificado
-- por ejecución, con la respuesta del agente, los chequeos deterministas y el juez de paráfrasis si hizo falta.
-- `tenant-schema.sql` crea las mismas tablas en cada tenant nuevo (bloque REHEARSAL) y `rehearsal-schema.spec.ts` exige
-- que las dos definiciones coincidan.
--
-- ADITIVA: dos tablas nuevas, ni una fila escrita. No se extienden `eval_runs` ni `eval_scenarios` (C0 §5 R7 lo dejaba
-- por verificar): esas tablas son evidencia de la certificación de agentes (agent-release) y el ensayo nunca debe contar
-- como tal (ADR 0013). El binario anterior no conoce estas tablas y el nuevo responde «sin ensayos» si faltan, así que
-- el orden migración → contenedores es seguro en los dos sentidos.

DO $rehearsal$
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
            CREATE TABLE IF NOT EXISTS %1$s."rehearsal_runs" (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id UUID,
            status TEXT NOT NULL DEFAULT 'running',
            seed TEXT NOT NULL,
            spec_version TEXT NOT NULL,
            snapshot_hash TEXT NOT NULL,
            bank_hash TEXT NOT NULL,
            bank JSONB NOT NULL,
            repeat_of UUID,
            attempt INTEGER NOT NULL DEFAULT 1,
            case_count INTEGER NOT NULL DEFAULT 0,
            completed_count INTEGER NOT NULL DEFAULT 0,
            summary JSONB,
            pass_rate NUMERIC(5,4),
            models TEXT[] NOT NULL DEFAULT '{}',
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            judge_calls INTEGER NOT NULL DEFAULT 0,
            judge_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
            error TEXT,
            requested_by UUID,
            started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            completed_at TIMESTAMPTZ,
            CONSTRAINT rehearsal_runs_status CHECK (status IN ('running','completed','stopped','failed','interrupted'))
        )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_rehearsal_runs_started
            ON %1$s."rehearsal_runs" (started_at DESC)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_rehearsal_runs_bank
            ON %1$s."rehearsal_runs" (bank_hash)
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %1$s."rehearsal_results" (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id UUID NOT NULL REFERENCES %1$s."rehearsal_runs" (id) ON DELETE CASCADE,
            case_key TEXT NOT NULL,
            intent_id TEXT NOT NULL,
            requirement_ids TEXT[] NOT NULL,
            item_id TEXT,
            language TEXT NOT NULL,
            expected TEXT NOT NULL,
            value_state TEXT,
            outcome TEXT NOT NULL,
            miss_class TEXT,
            decided_by TEXT,
            reason TEXT,
            turns JSONB NOT NULL DEFAULT '[]'::jsonb,
            tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
            checks JSONB NOT NULL DEFAULT '[]'::jsonb,
            judge JSONB,
            model TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            latency_ms INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT rehearsal_results_outcome CHECK (outcome IN ('answered','missing_data','wrong','inconclusive','error')),
            CONSTRAINT rehearsal_results_miss_class CHECK (miss_class IS NULL OR miss_class IN ('dato','producto')),
            CONSTRAINT rehearsal_results_once UNIQUE (run_id, case_key)
        )
        $ddl$, target);
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_rehearsal_results_case
            ON %1$s."rehearsal_results" (case_key, created_at DESC)
        $ddl$, target);
    END LOOP;
END
$rehearsal$;
