-- Retiro de MercadoPago como PSP de PLATAFORMA (decisión del dueño, 14-ago-2026).
--
-- SOLO DATOS, cero DDL: expand-contract trivial. El código viejo que corre
-- durante la ventana del deploy ya sabe leer provider='wompi' y parsea estas
-- claves de settings igual que siempre.
--
-- Qué NO toca: la cuenta de MercadoPago del TENANT para cobrar a sus propios
-- clientes por enlace de pago (modules/tenant-payments, token cifrado en
-- tenants.settings.tenantPayments) — ese feature se conserva por decisión
-- explícita y no pasa por el ruteo de plataforma.

-- ---------------------------------------------------------------------------
-- 1. El switch de operador: apagar MP, encender Wompi, catch-all al riel vivo.
--    El UPDATE es obligatorio aunque el código nuevo ya ignore 'mercadopago'
--    al parsear: dejar la fila viejа sería un dato que miente en la tabla que
--    el panel de Proveedores edita.
-- ---------------------------------------------------------------------------
INSERT INTO platform_settings (key, value, category, updated_at)
VALUES ('billing.providers_enabled', '{"mercadopago":false,"stripe":false,"wompi":true,"mock":false}', 'billing', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

INSERT INTO platform_settings (key, value, category, updated_at)
VALUES ('billing.default_provider_by_country', '{"CO":"wompi","*":"wompi"}', 'billing', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- El caché Redis del routing (billing:provider_routing) tiene TTL de 300s y el
-- deploy además recicla los contenedores: no hace falta invalidarlo desde acá.

-- ---------------------------------------------------------------------------
-- 2. Rescate de la cohorte varada: trials/comps locales nacidos bajo MP, sin
--    NINGÚN artefacto del lado del proveedor (provider_subscription_id nulo =
--    no hay preapproval, no hay tokens, no hay nada que esos ids signifiquen).
--    Re-apuntarlos a Wompi es seguro y es lo que los desvara: hoy no pueden ni
--    guardar tarjeta ni convertir. Solo Colombia (o país nulo, que el código
--    coerciona a CO): Wompi no factura otros países, y un varado no-CO queda
--    documentado esperando el despertar de Stripe.
--
--    engine queda 'provider': lo enciende armEngineForNewSource cuando el
--    tenant guarde un método de pago. Nadie recibe un cobro por esta migración.
--
--    Los estados terminales (cancelled/expired) NO se tocan: son historial, y
--    el nombre 'mercadopago' sigue siendo legible como valor legado.
-- ---------------------------------------------------------------------------
UPDATE billing_subscriptions s
   SET provider = 'wompi', updated_at = NOW()
  FROM tenants t
 WHERE t.id = s.tenant_id
   AND s.provider = 'mercadopago'
   AND s.provider_subscription_id IS NULL
   AND s.status IN ('pending_auth', 'trialing', 'active', 'past_due')
   AND (t.billing_country IS NULL OR UPPER(t.billing_country) = 'CO');

-- Espejo denormalizado: tenants.payment_provider solo registra dónde nació la
-- última suscripción (no entra a la resolución), pero desalineado confunde a
-- soporte y a la auditoría.
UPDATE tenants t
   SET payment_provider = 'wompi'
  FROM billing_subscriptions s
 WHERE s.tenant_id = t.id
   AND s.provider = 'wompi'
   AND t.payment_provider = 'mercadopago';

-- Pines L2 al proveedor retirado: SÍ entran a la resolución como candidato, y
-- con MP fuera de los ruteables cada alta de esos tenants terminaría en el
-- barrido de failover. NULL = "seguí al país", que es lo correcto.
UPDATE tenants
   SET payment_provider_override = NULL
 WHERE payment_provider_override = 'mercadopago';
