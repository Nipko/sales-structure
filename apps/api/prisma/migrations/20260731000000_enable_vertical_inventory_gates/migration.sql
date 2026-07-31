-- H-17 / D4 — encender el objeto central de dos verticales en los planes de entrada.
--
-- Dos verticales nacian muertas el dia 1:
--   * automotriz: `vehicleInventory: false` en emprendedor y starter apagaba el
--     controller entero (FeatureGuard -> 403 crudo al cargar el primer auto).
--   * turismo/inmobiliaria: `maxProperties: 0` en emprendedor no dejaba cargar
--     ni una propiedad.
--
-- El gate pasa de bandera a CANTIDAD: se enciende el flag en todos los planes y
-- se limita con `maxVehicles`, igual que ya se hace con `maxProperties`.
--
-- POR QUE ESTA MIGRACION ES OBLIGATORIA Y NO OPCIONAL:
-- seed-billing-plans.js es create-only (deja intactos los planes existentes), y
-- TenantThrottleService.getPlanLimit devuelve 0 cuando la clave no es un numero
-- (tenant-throttle.service.ts:306). Sin este backfill, `maxVehicles` ausente
-- valdria 0 para TODO plan ya sembrado y enforcePlanLimit bloquearia el primer
-- vehiculo incluso en pro y enterprise, que hoy funcionan. Seria una regresion
-- peor que el bug que se arregla.
--
-- Es aditiva y idempotente: solo escribe claves faltantes o valores por debajo
-- del piso nuevo, asi que correrla dos veces no cambia nada y respeta cualquier
-- ajuste manual hacia arriba que un super_admin ya haya hecho.

-- ---- maxVehicles: escalera nueva, solo si la clave no existe ----
UPDATE "public"."billing_plans"
SET "features" = "features" || jsonb_build_object('maxVehicles',
    CASE "slug"
        WHEN 'emprendedor' THEN 5
        WHEN 'starter'     THEN 20
        WHEN 'pro'         THEN 100
        WHEN 'enterprise'  THEN 500
        WHEN 'custom'      THEN -1
        ELSE 20
    END)
WHERE "features" -> 'maxVehicles' IS NULL;

-- ---- vehicleInventory: encendido en todos los planes ----
-- Una tabla vacia no cuesta nada; lo que costaba era el 403 del dia 1.
UPDATE "public"."billing_plans"
SET "features" = jsonb_set("features", '{vehicleInventory}', 'true'::jsonb, true)
WHERE COALESCE(("features" ->> 'vehicleInventory')::boolean, false) = false;

-- ---- maxProperties: subir solo los que quedan por debajo del piso ----
-- Escalera monotona 2 / 5 / 10 / 50 / ilimitado. No baja a nadie: si un plan ya
-- tiene mas (o -1 = ilimitado), se deja como esta.
UPDATE "public"."billing_plans"
SET "features" = jsonb_set("features", '{maxProperties}',
    to_jsonb(CASE "slug"
        WHEN 'emprendedor' THEN 2
        WHEN 'starter'     THEN 5
        WHEN 'pro'         THEN 10
        WHEN 'enterprise'  THEN 50
        ELSE 2
    END), true)
WHERE "slug" <> 'custom'
  AND COALESCE(("features" ->> 'maxProperties')::int, 0) <> -1
  AND COALESCE(("features" ->> 'maxProperties')::int, 0) < CASE "slug"
        WHEN 'emprendedor' THEN 2
        WHEN 'starter'     THEN 5
        WHEN 'pro'         THEN 10
        WHEN 'enterprise'  THEN 50
        ELSE 2
    END;

-- El plan custom queda ilimitado si aun no lo estaba.
UPDATE "public"."billing_plans"
SET "features" = jsonb_set("features", '{maxProperties}', '-1'::jsonb, true)
WHERE "slug" = 'custom'
  AND COALESCE(("features" ->> 'maxProperties')::int, 0) <> -1;
