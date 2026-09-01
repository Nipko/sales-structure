-- Desglose por moneda del revenue del snapshot (los pagos se cobran en COP por
-- Wompi y en USD por Stripe; revenue_collected_cents pasa a estar normalizado a
-- centavos USD y este JSONB conserva los montos crudos + tasas usadas).
-- Aditivo: el código viejo ignora la columna durante el rolling restart.
ALTER TABLE "public"."financial_snapshots" ADD COLUMN IF NOT EXISTS "revenue_breakdown" JSONB;
