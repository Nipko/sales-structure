-- Tenants propios (demo, pruebas, uso interno): no son una venta.
--
-- Vive como COLUMNA y no dentro de `settings` porque hay que filtrarla desde
-- seis consultas de financials a través de la relación tenant; un filtro JSON
-- anidado por relación es frágil y no se indexa.
--
-- Expand-contract: sólo ADD COLUMN con DEFAULT. El código viejo la ignora, así
-- que puede correr contra este schema durante el rolling restart.
ALTER TABLE "tenants"
    ADD COLUMN IF NOT EXISTS "is_internal" BOOLEAN NOT NULL DEFAULT false;

-- Parcial: la enorme mayoría de los tenants son clientes reales, y las
-- consultas que importan preguntan por los pocos que no lo son.
CREATE INDEX IF NOT EXISTS "tenants_is_internal_idx"
    ON "tenants" ("is_internal")
    WHERE "is_internal" = true;
