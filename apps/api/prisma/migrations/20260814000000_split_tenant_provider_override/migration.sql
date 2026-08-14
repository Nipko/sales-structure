-- Separa el pin automático del override deliberado en `tenants`.
--
-- ESTRICTAMENTE ADITIVA: una sola columna nullable. El deploy migra ANTES de
-- recrear los contenedores, así que el código viejo corre unos minutos contra
-- este schema; una columna que nadie lee todavía no le hace nada.
--
-- El problema que cierra: `payment_provider` se escribe SOLO en cada alta
-- (BillingService), pero el router lo trataba como si fuera una decisión del
-- operador y lo ponía por encima del default del país. Resultado: todo tenant
-- que alguna vez tuvo una suscripción quedaba clavado a ese proveedor, y
-- cambiar el operador de un país no movía a nadie.
--
-- A partir de acá:
--   payment_provider          → dónde nació la última suscripción (historial)
--   payment_provider_override → decisión explícita de un super admin (gobierna)
--
-- NO se hace backfill a propósito. Copiar el valor viejo al override
-- convertiría el accidente en intención y dejaría a toda la base clavada para
-- siempre, que es exactamente el bug. NULL = "seguí al país", que es lo que
-- corresponde a un tenant que nadie fijó a mano.
ALTER TABLE "tenants"
    ADD COLUMN IF NOT EXISTS "payment_provider_override" TEXT;

-- El router filtra por esta columna en cada alta; es selectiva (casi todo NULL).
CREATE INDEX IF NOT EXISTS "tenants_payment_provider_override_idx"
    ON "tenants" ("payment_provider_override")
    WHERE "payment_provider_override" IS NOT NULL;
