-- ADR-0027 — Corrige en el libro de gasto LLM los rechazos «sin créditos» del 8-nov-2026.
--
-- Qué pasó: entre las 08:16 y las 08:26 UTC del 8-nov-2026, OpenAI respondió
-- «429 You have no credits remaining» a 2.043 intentos de 4 tenants QA.
-- `settleFailedAttempt` los liquidó con el piso de entrada (basis
-- 'failed_estimate', $17,25 en total) aunque OpenAI no factura esos rechazos.
-- Desde ADR-0027 ese caso se liquida en 0. Este script lleva el histórico a
-- la misma regla.
--
-- Garantías:
--   * No borra filas. Sólo pone accounted_micro=0.
--   * Respaldo: copia cada fila tocada, con su valor original, en
--     public.llm_spend_adjustments_20261108 ANTES de cambiarla.
--   * Idempotente: una segunda corrida no encuentra filas con accounted_micro>0
--     en la ventana, y el respaldo usa ON CONFLICT DO NOTHING.
--   * Acotado: sólo modelos de OpenAI, sólo basis='failed_estimate' y sólo la
--     ventana del apagón. En esa ventana todos los fallos de OpenAI fueron
--     «no credits» (lo confirman el log del API y ADR-0026).
--
-- Uso (VPS):
--   docker exec -i parallext-postgres psql -U parallext -d parallext_engine \
--     -v ON_ERROR_STOP=1 < apps/api/scripts/llm-spend/2026-11-08-zero-unbilled-refusals.sql
--
-- Reversión (si hiciera falta):
--   UPDATE public.llm_spend_reservations r SET accounted_micro=a.original_accounted_micro
--   FROM public.llm_spend_adjustments_20261108 a WHERE a.id=r.id;

BEGIN;

CREATE TABLE IF NOT EXISTS public.llm_spend_adjustments_20261108 (
    id TEXT PRIMARY KEY,
    tenant_id UUID NOT NULL,
    month TEXT NOT NULL,
    model TEXT NOT NULL,
    original_accounted_micro BIGINT NOT NULL,
    reason TEXT NOT NULL,
    adjusted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

WITH target AS (
    SELECT id, tenant_id, month, model, accounted_micro
    FROM public.llm_spend_reservations
    WHERE basis = 'failed_estimate'
      AND accounted_micro > 0
      AND model IN ('gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o')
      AND created_at >= '2026-11-08 08:00:00+00'
      AND created_at <  '2026-11-08 09:00:00+00'
    FOR UPDATE
), saved AS (
    INSERT INTO public.llm_spend_adjustments_20261108 (id, tenant_id, month, model, original_accounted_micro, reason)
    SELECT id, tenant_id::uuid, month, model, accounted_micro, 'openai_no_credits_unbilled (ADR-0027)'
    FROM target
    ON CONFLICT (id) DO NOTHING
    RETURNING id
)
UPDATE public.llm_spend_reservations r
SET accounted_micro = 0, updated_at = clock_timestamp()
FROM target t
WHERE r.id = t.id;

SELECT count(*) AS filas_respaldadas, round(sum(original_accounted_micro) / 1e6, 2) AS usd_liberados
FROM public.llm_spend_adjustments_20261108;

COMMIT;
