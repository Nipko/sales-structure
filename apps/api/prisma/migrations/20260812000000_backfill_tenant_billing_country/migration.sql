-- `tenants.billing_country` se agregó nullable y sin backfill
-- (20260423000000_add_billing), así que hay filas en NULL. Ese dato decide DOS
-- cosas de plata: qué pasarela cobra (ruteo por país) y qué documento fiscal se
-- emite (factura DIAN Colombia vs exportación). Con NULL, el runtime cae a 'CO'
-- por defecto sin dejar rastro; este backfill deja el valor escrito y auditable.
--
-- Segunda señal: `tenants.language` ('es-CO', 'pt-BR', …). Es la misma inferencia
-- que ya usa `tenants.service.ts` para la distribución geográfica del panel
-- super_admin — no se inventa una fuente nueva, se persiste la que ya se lee.
-- Solo se toma cuando el tag trae región de 2 letras; 'es' suelto no aporta país.
--
-- Aditiva por diseño (expand-contract): solo UPDATE sobre filas NULL. Sin DROP,
-- sin RENAME, sin ALTER — el código viejo sigue corriendo contra esto sin cambios.

UPDATE public.tenants
SET billing_country = UPPER(SPLIT_PART(language, '-', 2))
WHERE billing_country IS NULL
  AND language LIKE '%-%'
  AND LENGTH(SPLIT_PART(language, '-', 2)) = 2;

-- Último recurso para las filas sin ninguna señal: 'CO' (mercado LatAm-first),
-- el mismo default que el runtime ya aplicaba en memoria. Escribirlo hace que el
-- valor sea visible y corregible desde PATCH /fiscal/:tenantId/billing-country,
-- en vez de re-derivarse en silencio en cada cobro.
UPDATE public.tenants
SET billing_country = 'CO'
WHERE billing_country IS NULL;
