-- Todos los cupones son de UN SOLO USO. Los de lote ya nacen con
-- max_redemptions = 1; los sueltos podían crearse con un tope mayor o sin tope
-- (NULL = ilimitado). Esto capa cualquier cupón multi-uso existente a 1.
--
-- Aditivo / expand-contract seguro: es solo un UPDATE de datos, sin cambio de
-- esquema. Un cupón que ya se canjeó N>1 veces queda con max_redemptions=1 y
-- redemption_count sin tocar → simplemente no admite más canjes (queda
-- "agotado"), que es exactamente el estado deseado. No se toca ninguna redención
-- ya hecha.
--
-- No se agrega CHECK/NOT NULL en el mismo deploy a propósito: durante la ventana
-- de migración el código VIEJO todavía corre, y un NOT NULL rompería sus INSERT
-- que aún mandan max_redemptions nulo. La invariante la garantiza la app
-- (CouponsService.create fuerza max_redemptions=1); el constraint duro, si se
-- quiere, va en un deploy posterior.
UPDATE "billing_coupons"
SET "max_redemptions" = 1,
    "updated_at" = NOW()
WHERE "max_redemptions" IS NULL OR "max_redemptions" <> 1;
