-- Mediciones QA de modelos LLM (ADR-0030 fase 4).
--
-- `public.llm_model_measurements`: una fila por medición de un modelo en un banco:
-- - `rehearsal_7t`: ensayo de un turno en los 7 tenants QA (`measure.cjs`); acierto = answered o missing_data, sin
--   contar errores de infraestructura en `n`;
-- - `signed_confirmation`: confirmación firmada (el mismo hash de argumentos tras el «sí»);
-- - `classify_verifier`: casos de traspaso y evidencia que dependen de la cabeza de `classify`.
-- La regla de promoción la lee al validar un borrador del catálogo: cambiar la cabeza de una cadena exige una medición
-- del candidato de menos de 14 días que iguale a la de la cabeza actual. `catalog_version` es la versión (borrador o
-- activa) contra la que se midió; `run_ref`, el archivo de resultados. Nada se borra.
--
-- ADITIVA: una tabla nueva, ni una fila escrita. El binario anterior no la conoce; sin ella el nuevo trata todo cambio
-- de cabeza como «sin medición», así que el orden migración → contenedores es seguro en los dos sentidos, y revertir es
-- `DROP TABLE` (se pierden sólo las mediciones registradas).

CREATE TABLE IF NOT EXISTS "public"."llm_model_measurements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" VARCHAR(100) NOT NULL,
    "bench" VARCHAR(32) NOT NULL,
    "n" INTEGER NOT NULL,
    "pass" INTEGER NOT NULL,
    "pass_rate" NUMERIC(6, 4) NOT NULL,
    "cost_per_case_usd" NUMERIC(12, 6),
    "catalog_version" INTEGER,
    "api_commit" VARCHAR(64),
    "run_ref" VARCHAR(500),
    "notes" TEXT,
    "recorded_by" UUID,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "llm_model_measurements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "llm_model_measurements_bench_check" CHECK ("bench" IN ('rehearsal_7t', 'signed_confirmation', 'classify_verifier')),
    CONSTRAINT "llm_model_measurements_counts_check" CHECK ("n" > 0 AND "pass" >= 0 AND "pass" <= "n"),
    CONSTRAINT "llm_model_measurements_rate_check" CHECK ("pass_rate" >= 0 AND "pass_rate" <= 1)
);

CREATE INDEX IF NOT EXISTS "llm_model_measurements_model_bench_idx"
    ON "public"."llm_model_measurements"("model_id", "bench", "measured_at" DESC);
