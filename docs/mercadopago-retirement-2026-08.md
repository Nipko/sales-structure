# Retiro de MercadoPago como pasarela de plataforma

_14 de agosto de 2026 — decisión del dueño, ejecutada en `79b99eb6`_

MercadoPago **sale por completo** del cobro de suscripciones de Parallly y no
vuelve. El collector nunca salió de `rejected_by_regulations_collector_non_compliant`
y se perdieron semanas esperando una habilitación que no llegó.

| Rol | Operador |
|-----|----------|
| Suscripciones de plataforma, Colombia | **Wompi** (Grupo Bancolombia), cobrado por el motor de recurrencia propio |
| Suscripciones de plataforma, exterior | **Stripe**, dormido — el ruteo ya lo contempla, falta habilitarlo |
| Cobro del tenant a SUS clientes | **MercadoPago del tenant**, por enlace de pago — se conserva intacto |

## Lo que se conserva y por qué no se rompió

`modules/tenant-payments` deja que un tenant configure **su propia** cuenta de
MercadoPago y le cobre a sus clientes por enlace de pago. Se verificó línea por
línea que es autocontenido: token cifrado por tenant en
`tenants.settings.tenantPayments.accessTokenEnc`, `fetch` propio contra la API
de MP, y webhook propio por tenant (`POST /tenant-payments/webhook/:tenantId`)
que no confía en el body — re-consulta el pago con el token del propio tenant.
Cero imports de `modules/billing`, cero lectura de `MP_*` de plataforma.

**Nadie debe "arreglar" ese webhook agregándole `MP_WEBHOOK_SECRET`**: es
público a propósito y su seguridad es la re-consulta, no una firma de
plataforma que ni siquiera existe ya.

Deuda conocida de ese módulo, **no** introducida por este cambio:
`createPaymentLink` no tiene llamadores y el tool de IA `create_payment_link`
depende de un `PAYMENT_OPERATION_PROVIDER` que nadie registra, así que hoy
responde `payment_provider_unavailable` y escala a un humano. El circuito está
desplegado pero dormido.

## El orden importó: primero el ruteo, después los archivos

El log de producción decía `[Billing] Falling over to wompi for country CO`.
Colombia cobraba por el **barrido de failover**, no por configuración: los
defaults traían `mercadopago: true` y `'*' → mercadopago`, y `updateConfig`
reinyectaba ese catch-all en cada guardado del panel.

Tres capas había que voltear juntas:

1. **Defaults de código** (`payment-routing.service.ts`) — son la postura ante
   un fallo de lectura, así que la polaridad *fail-open* pasa a Wompi: si la
   base no responde, el único camino de ingresos sigue en pie.
2. **Filas de `platform_settings`** — pisan a los defaults al parsear. La
   migración `20260814120000` las reescribe.
3. **Re-siembras hardcodeadas** — el catch-all de `updateConfig` y el fallback
   de `grantCompPlan`, que fabricaba filas `mercadopago` nuevas.

Defensa en profundidad: los parsers ahora iteran **sólo nombres ruteables**, así
que una fila vieja que diga `mercadopago` se ignora al leer. El retiro no
depende de que la migración haya corrido.

## `mercadopago` sigue siendo un nombre válido (de solo lectura)

El literal permanece en `PaymentProviderName` porque hay filas que lo nombran:
suscripciones viejas, `billing_payments`, `billing_events`,
`tenants.payment_provider`. Borrarlo haría reventar cualquier lectura de ese
historial.

La distinción vive en dos listas:

- `PAYMENT_PROVIDER_NAMES` — **ruteables**: gobiernan failover, validación de
  settings y el panel. MercadoPago **no** está.
- `LEGACY_PAYMENT_PROVIDER_NAMES` — válidos al **leer** datos existentes.
  `resolveForSubscription` usa esta.

Y no hay adapter: `getByName('mercadopago')` cae al default y lanza. Cualquier
camino que intente OPERAR contra MP falla fuerte y con nombre
(`provider_retired`), en vez de cobrar con ids ajenos.

## La cohorte varada, y su rescate

Trials locales nacidos bajo MercadoPago, con `provider_subscription_id` nulo —
o sea, sin nada del otro lado. Antes de este cambio ya estaban rotos: no podían
guardar tarjeta (el checkout les mostraba Wompi y `resolveProvider` devolvía el
proveedor congelado), no podían convertir, y **ni siquiera podían cancelar**.

Dos patas, ambas necesarias:

- **Datos**: la migración los re-apunta a `wompi` (sólo CO, sólo estados no
  terminales), espeja `tenants.payment_provider` y limpia los pines L2 a MP.
  `engine` queda en `'provider'`: lo enciende `armEngineForNewSource` cuando el
  tenant guarde un método. **Nadie recibe un cobro por la migración.**
- **Código**: `resolveProvider` deja de congelar por NOMBRE cuando el proveedor
  quedó retirado y no hay mandato del otro lado. Congelar tiene sentido cuando
  existen ids y tokens que sólo significan algo allá — no por la etiqueta.

Un varado **fuera de Colombia** no se backfillea: Wompi factura sólo CO. Queda
bloqueado a sabiendas hasta que Stripe despierte.

## Hallazgos del barrido que no estaban en el pedido

| Dónde | Qué |
|---|---|
| `coupons.service.ts` | La guarda anti-doble-cobro miraba sólo `providerSubscriptionId`, artefacto de MP. Un tenant Wompi con motor armado lo tiene en null y `nextChargeAt` puesto: el cupón se canjeaba **y el motor cobraba igual**. Ahora el regalo corre también `nextChargeAt`, y revocarlo lo restaura |
| `billing.service.ts` | `refundPayment` resolvía el adapter DESPUÉS de la reserva optimista: un pago legado quedaba marcado como reembolsado sin que nadie devolviera un peso |
| `billing.service.ts` | `cancelSubscription` resolvía el adapter en su primera línea — con un proveedor desregistrado, el cliente no podía darse de baja. Ahora sólo se resuelve si de verdad hay algo que cancelar allá |
| `billing.service.ts` | El guard de trial-con-tarjeta era incondicional (heredado de MP) aunque el catálogo ya lo modela por capacidad `storedPaymentSources` |
| `grantCompPlan` | Su fallback grababa `'mercadopago'` — una fábrica de varados nuevos después del retiro |

## Qué se eliminó

**API**: `mercadopago.adapter.ts`, `mercadopago-config.service.ts` y sus specs;
`scripts/sync-mp-plans.js` + test; `scripts/diagnose-mp-collector.js` + spec;
el endpoint `POST plans/:slug/sync-mp`; `MERCADOPAGO_CURRENCY_BY_COUNTRY` e
`isMercadoPagoCountry` (export muerto); `mercadopago` del allowlist de webhooks
y del registro de la factory; la rama de upgrade *cancel+recreate* (~100 líneas
con su compensación de doble mandato: ningún proveedor ruteable tiene esa forma).

**Dashboard**: `MpCardForm.tsx` (el onboarding lo usaba **salteándose** el
dispatcher `PaymentForm`), la mitad MercadoPago de `/admin/plans` (badge del
colector, filas de ids remotos, sección de sincronizar), el script de
fingerprint de MP en la página de facturación, `syncPlanToMp` del cliente, y 20
claves i18n ×4 idiomas.

**Infra**: secretos `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` / `MP_PUBLIC_KEY` /
`MP_EXPECTED_COLLECTOR_ID` y los 7 `MP_FX_*` muertos; el build-arg
`NEXT_PUBLIC_MP_PUBLIC_KEY` y su `ARG`/`ENV` en el Dockerfile; los orígenes de
MercadoPago en la CSP de nginx.

**Landing**: el logo y la promesa "Mercado Pago procesa los pagos" → Wompi
(Grupo Bancolombia), en 5 locales.

## Deuda deliberada (expand-contract)

La columna `billing_plans.mp_plan_id` y las claves `mpPlanId` /
`syncedAmountCents` / `syncedCurrency` dentro de `price_local_overrides`
**siguen existiendo**. Se dejó de escribirlas; el DROP va en un deploy
posterior, nunca en el mismo. `billing-plan-price-sync.util` conserva su
higiene server-owned mientras la columna exista.

## Verificación

Los cinco `tsc`, **1603 tests del API**, el arranque real de Nest sin los
providers de MP en el módulo (el riesgo concreto de sacarlos de
`billing.module.ts`), la migración aplicada contra Postgres 16 real en el tier
`integration`, y paridad exacta de **9.135 claves i18n ×4**.
