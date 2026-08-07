# Pasarela Wompi (Bancolombia) — investigación y plan

**Fecha:** agosto 2026
**Estado:** investigación cerrada, decisiones del dueño pendientes (§12)
**Alcance:** cobro de suscripciones plataforma → tenant. Toca de refilón `tenant-payments` (tenant → su cliente) y la compra de créditos SMS.

---

## 1. Veredicto en 10 líneas

1. **Sí se puede**, y la capa multi-proveedor que ya existe sirve — pero sirve para el **ruteo**, no para el ciclo de cobro.
2. **En paralelo, no reemplazo.** Wompi es Colombia-only y COP-only; apagar MercadoPago dejaría sin cobro a AR/BR/MX/CL/PE/UY. No es una preferencia: es un techo permanente.
3. **Wompi no tiene suscripciones.** No hay `/plans`, no hay `/subscriptions`, no hay calendario ni reintentos. Hay fuentes de pago tokenizadas y transacciones que **dispara el comercio**.
4. Eso significa construir **motor propio**: scheduler, reintentos, dunning con cobro real, prorrateo, conciliación por transacción. Es el **80% del esfuerzo**, y es obligatorio tanto si Wompi convive como si reemplaza.
5. **PSE NO admite débito automático.** Confirmado contra tres fuentes oficiales. Recurrente hay con tarjeta, Nequi, Daviplata y cuenta **Bancolombia** (Botón Bancolombia). Nada de "débito automático por PSE" en el mensaje comercial.
6. **Wompi no tiene endpoint de reembolso.** Solo `POST /v1/transactions/{id}/void`, **solo tarjeta**, solo en ciertos estados. El refund inline de Billing Ops se degrada.
7. Tarifa oficial: **2,65% + $700 COP + IVA** por transacción exitosa, plana para todos los medios (QR 1%). Desembolso **al siguiente día hábil** — mejor que MP.
8. Requisito bloqueante de calendario, antes de código: **cuenta Bancolombia a nombre del NIT**, y registrarse como **persona jurídica** (la natural difiere el primer desembolso 30 días).
9. Esfuerzo: **~10-14 semanas** de trabajo efectivo repartidas en 6 fases, de las cuales la Fase 0 (higiene del ruteo, sin Wompi) son 1-1,5 semanas y ya vale la pena sola.
10. **Antes de comprometer fecha hay 9 preguntas a Wompi por escrito y 7 decisiones del dueño** (§12). Dos de ellas —el motivo real del rechazo de MP y el % de tenants con tarjeta— pueden invalidar el proyecto entero.

---

## 2. Lo que ya tenemos a favor

La capa de pagos **sí** es multi-proveedor, y esa parte no hay que inventarla.

| Pieza | Archivo | Qué aporta |
|---|---|---|
| Contrato de proveedor | `apps/api/src/modules/billing/adapters/payment-provider.interface.ts:38-141` | 14 métodos normalizados; el servicio no habla el idioma del proveedor |
| Factory por nombre | `apps/api/src/modules/billing/payment-provider.factory.ts:18-29` | `getByName('stripe'\|'mercadopago'\|'mock')` |
| Union de proveedores | `apps/api/src/modules/billing/types/provider-types.ts:9` | `PaymentProviderName` |
| Switch por tenant | `apps/api/prisma/schema.prisma:43` (`paymentProvider`) + `billing.service.ts:130` | La columna del switch **ya existe** |
| Proveedor congelado por suscripción | `billing.service.ts:193` | Cada suscripción recuerda con qué nació |
| Webhook por proveedor | `apps/api/src/modules/billing/webhook.controller.ts:45-119` | `POST /billing/webhook/:provider`, allowlist, firma fail-closed 401, idempotencia Redis 48h, siempre 200 |
| Vocabulario normalizado | `types/subscription-status.enum.ts`, `types/billing-event.enum.ts` | 6 estados, 12 eventos — incluido `PENDING_AUTH`, hoy sin uso |
| Máquina de estados única | `billing.service.ts:1330-1363` (`deriveSubscriptionPatch`) | Todo cambio de estado pasa por un solo lugar |
| Doble idempotencia | Redis `idem:billing:{provider}:{eventId}` + `UNIQUE(provider, providerEventId)` en `billing_events` | Reprocesar es seguro |
| Reserva optimista de refund | `billing.service.ts:808-905` | Patrón a copiar para cualquier cobro contra proveedor |
| DIAN desacoplado | `apps/api/src/modules/fiscal/fiscal-invoice.service.ts:45-148` | Escucha `PAYMENT_SUCCEEDED`/`PAYMENT_REFUNDED` **normalizados**, no payloads crudos. **No hay que tocarlo** |
| Registro de adapters | `apps/api/src/modules/billing/billing.module.ts:37-56` | Agregar Wompi son 2 líneas |
| Precedente de redirección + retorno | `apps/dashboard/src/app/admin/settings/billing/page.tsx:236-262` (compra de SMS) | Molde de "salir, volver, refetch diferido" |
| Precedente de "salir y volver con estado" | `FiscalGateModal` → `?resumePlan=` (`page.tsx:350-366`) | Molde para el retorno de PSE |
| Cupones ya locales | `coupons.service.ts:1-26` + `billing.service.ts:750-779` | Los descuentos no dependen del proveedor |

**Y lo que NO está a favor, aunque lo parezca.** El comentario del propio `payment-provider.interface.ts` dice que cambiar de proveedor *"requires adding a new adapter, not touching business code"*. **Con Wompi eso deja de ser cierto**: 7-8 de los 14 métodos no tienen contraparte. Ver §4.

Además hay tres defaults silenciosos que hoy son bombas:

| Archivo:línea | Qué hace | Por qué es peligroso con Wompi |
|---|---|---|
| `payment-provider.factory.ts:18-29` | `default: return this.mercadoPagoAdapter` | Una fila `provider='wompi'` antes de existir la rama ejecutaría **cobros, cancelaciones y reembolsos contra MercadoPago** con ids ajenos |
| `billing.service.ts:1271-1318` | Proveedor desconocido → literal `'mock-plan'`, **sin error** | Crearía suscripciones apuntando a un plan inexistente |
| `billing.service.ts:279-330` | Upgrade ramificado por string; el `else` exige `providerSubscriptionId` | Como **todos** los trials son locales (`skipProviderCreate` en `:138`), con Wompi **ningún tenant podría pagar nunca** |

---

## 3. Lo que Wompi SÍ hace y lo que NO hace

### 3.1 Por medio de pago

Códigos exactos y fuente: `docs.wompi.co/en/docs/colombia/metodos-de-pago/` y `.../fuentes-de-pago/`.

| Medio (código) | Pago único | **Recurrente sin usuario presente** | ¿Requiere usuario presente en el alta? | Notas |
|---|---|---|---|---|
| `CARD` | Sí | **Sí** (fuente de pago) | Sí, una vez (tokeniza en el navegador) | Token de tarjeta es de **un solo uso**; lo que se persiste es `payment_source_id` (entero) |
| `NEQUI` | Sí | **Sí** | Sí — token nace `PENDING`, el usuario aprueba en su app, pasa a `APPROVED` | Alta asíncrona. Evento `nequi_token.updated` |
| `DAVIPLATA` | Sí | **Sí** | Sí — 3 llamadas + OTP (máx. 2 envíos, 2 validaciones) | **Requiere habilitación comercial**. **No tiene evento de token**: confirmación solo por polling |
| `BANCOLOMBIA_TRANSFER` (Botón Bancolombia) | Sí | **Sí** | Sí — redirección a `authorization_url` y vuelta | **Solo clientes Bancolombia.** Exige `payment_description`. Evento `bancolombia_transfer_token.updated` |
| `PSE` | Sí | **NO — no es tokenizable** | Sí, **en cada pago** | Exige `user_type`, `user_legal_id_type`, `user_legal_id`, `financial_institution_code`, `payment_description`. Bancos vía `GET /v1/pse/financial_institutions` |
| `BANCOLOMBIA_QR` | Sí | No | Sí | Tarifa 1% |
| `BANCOLOMBIA_COLLECT` (efectivo/corresponsales) | Sí | No | Sí | ~25.000 puntos |
| `PCOL` (Puntos Colombia) | Sí | No | Sí | 4,43% + $700 + IVA, más 1,44% de acumulación |
| `BANCOLOMBIA_BNPL` | Sí | No | Sí | |
| `SU_PLUS` | Sí | No | Sí | |

**Los cuatro tipos válidos de `payment_source` son exactamente `CARD`, `NEQUI`, `DAVIPLATA`, `BANCOLOMBIA_TRANSFER`.** PSE no aparece en ninguna de las tres fuentes oficiales revisadas (doc técnica de fuentes de pago, doc de métodos de pago, página comercial de tokenización).

> **Trampa desarmada.** Lo que Treli y otros venden como *"débito automático por PSE con Wompi"* es textualmente "cobros automáticos a cuentas de ahorro o corriente de personas **Bancolombia**". Eso es `BANCOLOMBIA_TRANSFER`, no PSE. **No existe débito automático para clientes de Davivienda, BBVA, Nu, Scotiabank, Falabella vía Wompi.**

### 3.2 Métodos que redirigen (corrección importante)

Seis métodos exigen **polling hasta que aparezca la URL** — no viene en la respuesta del POST:

| Método | Campo donde aparece la URL |
|---|---|
| `BANCOLOMBIA_TRANSFER`, `PSE`, `PCOL` | `payment_method.extra.async_payment_url` |
| `BANCOLOMBIA_BNPL`, `SU_PLUS` | `payment_method.extra.url` |
| **`DAVIPLATA`** | `payment_method.extra.url_services` |

Los únicos que **no** usan ese patrón: `CARD`, `NEQUI`, `BANCOLOMBIA_QR`, `BANCOLOMBIA_COLLECT`.
*(Un análisis previo ubicaba Daviplata del lado "no redirige". Es falso — la verificación adversarial lo corrigió.)*

### 3.3 Capacidades transversales

| Capacidad | Wompi | Fuente / matiz |
|---|---|---|
| Objeto suscripción / plan / calendario | **NO existe** | No hay `/plans` ni `/subscriptions` en toda la doc |
| Resultado síncrono | **NO.** Toda transacción nace `PENDING` | `docs/colombia/seguimiento-de-transacciones/` |
| Estados de transacción | `PENDING` → `APPROVED` \| `DECLINED` \| `ERROR` \| `VOIDED` | `VOIDED` **solo tarjeta** |
| Anulación | **Sí**: `POST /v1/transactions/{id}/void`, llave privada, solo tarjeta, solo ciertos estados | Endpoint documentado — la investigación inicial lo daba por inexistente |
| **Reembolso** | **NO existe endpoint en la doc pública** | Solo hay evidencia de soporte de que la operación existe como trámite |
| Moneda | **Solo COP** | *"The only currency currently available is COP"* |
| Idempotencia en `POST /v1/transactions` | **No hay header** | Solo `reference` única. Riesgo de doble cobro en timeout |
| Firma de transacción | `SHA256(Reference + AmountInCents + Currency + IntegritySecret)` | Es **parámetro requerido del body**, no solo del widget |
| Eventos | **3**: `transaction.updated`, `nequi_token.updated`, `bancolombia_transfer_token.updated` | |
| Reintentos de webhook | **3 en 24h** (30 min, 3h, 24h) | Muy inferior a nuestros 8 de BullMQ |
| Checksum de evento | `SHA256(valores de signature.properties en orden + timestamp + events_secret)`; header `X-Event-Checksum` | `signature.properties` es **dinámico** — leer del payload, no hardcodear |
| Tokens de aceptación | **DOS obligatorios**: `END_USER_POLICY` y `PERSONAL_DATA_AUTH` | JWT con `exp`/`jit`/`file_hash` → **caducan**, no cachear |
| Credenciales | **4 por ambiente**: `pub_`, `prv_`, `events_`, `integrity_` | Sandbox `test_*`, producción `prod_*`. Llave y URL base deben coincidir de ambiente |
| Tokenización de tarjeta | Solo cliente→Wompi, **prohibido pasar por nuestro backend** | Widget en modo `data-widget-operation="tokenize"` evita construir formulario |
| 3D Secure / 3RI | Existe, **requiere solicitud al equipo de prevención de fraude** | 3DS: MC y Visa. **3RI (recurrente): solo Mastercard.** Visa en cobro automático queda sin traslado de responsabilidad |
| Flag COF `recurrent:true` | Opcional, **condicionado a MC/Visa con procesador RBM** | *"If recurrent is not send, the transaction will be carried out without COF"* |
| Links de pago | `POST /v1/payment_links`, sin firma de integridad | `single_use`, `expires_at`, `redirect_url`. Evento trae `payment_link_id` |
| Tarifa | **2,65% + $700 COP + IVA** (Plan Avanzado, plano) | QR 1%; PCOL 4,43% + $700 + IVA + 1,44% acumulación. Plan Gateway: sin comisión Wompi, tarifas negociadas con Bancolombia (>2.000 tx) |
| Desembolso | **Siguiente día hábil.** PSE/Nequi corte 23:59, tarjetas 20:00; algunos BINes hasta 72h | Persona natural: primer desembolso a los 30 días |
| Sandbox determinista | Tarjeta 4242→APPROVED, 4111→DECLINED; Nequi 3991111111/3992222222; PSE banco "1"/"2"; OTPs fijos Daviplata | Permite tests de integración reales |

### 3.4 NO CONFIRMADO — preguntar a Wompi

Todo lo de esta lista está **sin confirmar**. No basar diseño ni fecha en ninguno.

| # | Pregunta | Por qué bloquea |
|---|---|---|
| W1 | ¿Tarjeta / Nequi / Bancolombia Transfer **recurrentes** requieren habilitación comercial? | La doc lo exige explícitamente solo para Daviplata y 3DS. Pero la página comercial de tokenización nombra **solo tarjeta y Nequi** como tokenizables, mientras la técnica lista cuatro. Ese desfase 2-vs-4 huele a habilitación por método |
| W2 | ¿Qué **procesador** nos asignan? ¿Modelo Agregador o Gateway? | El flag COF depende de RBM; el modelo cambia retenciones, topes y disponibilidad de 3DS. No se puede estar en los dos |
| W3 | ¿Existe **account updater** cuando vence la tarjeta guardada? | Ni una línea en la doc. Sin esto el churn involuntario es 100% nuestro |
| W4 | ¿`acceptance_token` es obligatorio en **cada** cobro contra `payment_source_id`? | **La doc se contradice**: la tabla de requeridos de `POST /v1/transactions` dice que sí; el ejemplo de cobro contra fuente lo omite. Si es sí, el worker necesita un `GET /v1/merchants/:pubkey` **antes de cada renovación** (son JWT con `exp`) → +1 llamada y +1 punto de falla por cobro |
| W5 | ¿Existe endpoint de **reembolso**? Si no, ¿cuál es el trámite formal y en qué plazo? | Define si el refund inline de Billing Ops sobrevive |
| W6 | **Idempotencia**: si reintento `POST /v1/transactions` con la misma `reference` tras timeout de red, ¿se crea una segunda transacción? ¿Hay consulta por `reference`? | Sin respuesta, un timeout sin `transaction_id` deja un cobro en limbo que **no se puede resolver por API** |
| W7 | **Topes diarios** reales del comercio y proceso de aumento | PJ ronda **$80M COP/día (~USD 20.000)** — dato tomado de resumen de búsqueda de soporte, **verificar en el panel**. Con renovaciones el día 1 se toca el techo con ~200-300 tenants |
| W8 | **Rate limits** / manejo de HTTP 429 | No documentados. Relevante para cobros en lote |
| W9 | ¿La **fuente de pago** caduca? ¿La autorización de Nequi / Bancolombia Transfer tiene vigencia o tope de monto? | La doc solo declara `AVAILABLE`/`VOIDED` |

Adicional, no bloqueante pero a resolver en implementación: **la versión en inglés y la española de la doc de eventos traen ejemplos JSON distintos.** La inglesa **no tiene** `environment` ni el `timestamp` de primer nivel que hace falta para construir el checksum. **Regla: para eventos, la fuente es la doc en español, validada contra sandbox.**

---

## 4. El hueco central: suscripciones nativas vs motor propio

Esta es la sección que cambia la conversación. **La pregunta real no es "paralelo o reemplazo".** Es:

> ¿Estamos dispuestos a construir y mantener nuestro propio motor de facturación recurrente?

Porque la respuesta es **idéntica en ambos escenarios**. Wompi no trae ciclo; hay que ponerlo nosotros. Discutir la arquitectura del switch antes de responder eso es elegir el color de la pintura antes de decidir si se construye la casa.

### 4.1 Los métodos del contrato que se quedan sin contraparte

Contra `payment-provider.interface.ts:38-141`:

| Método | ¿Wompi? | Consecuencia |
|---|---|---|
| `createPlan` | ✗ | No hay catálogo remoto. Lo que se guarda es el **precio en COP** |
| `createSubscription` | ✗ | Lo más cercano es `POST /v1/payment_sources`, que devuelve un **entero**, no una suscripción |
| `changeSubscriptionPlan` | ✗ | Upgrade/downgrade son cálculo propio |
| `pauseSubscription` / `resumeSubscription` | ✗ | Pausar = no cobrar. Es estado local |
| `getSubscription` | ✗ | **Rompe la reconciliación entera** (ver abajo) |
| `listCustomerSubscriptions` | ✗ | Lo usa `updatePaymentMethod` del adapter MP |
| `refundPayment` | ✗ (solo `void` de tarjeta) | El refund inline de Billing Ops se degrada |
| `createCustomer` | ~ | Sintético, igual que en MP (`mercadopago.adapter.ts:48-60`) |
| `updatePaymentMethod` | ~ | Es "crear fuente nueva + marcar default", no "rotar un card token" |
| `verifyWebhookSignature` / `parseWebhookEvent` | ✓ | Funcionan, con otra firma |

**8 de 14 sin contraparte directa.** Un adapter de Wompi **no es simétrico** al de MercadoPago.

### 4.2 Qué se pierde en concreto (lo que MP hoy nos da gratis)

| Capacidad que MP aporta | Estado hoy | Qué pasa con Wompi |
|---|---|---|
| Agendar y ejecutar el cobro | MP lo hace solo | Cron + cola + ledger de intentos, nuestros |
| **Reintentar un cargo fallido** | **Hoy no reintentamos nada.** `offboarding-cron.service.ts:99-181` solo cuenta días (soft lock D+3, expired D+7) | Hay que construir la política de reintentos completa |
| Consultar el estado remoto | `getSubscription` | No hay objeto que consultar |
| Red de seguridad de conciliación | `reconciliation.processor.ts:70-217` — existe porque los webhooks de MP no son confiables | `if (!sub.providerSubscriptionId) continue` (`:86,143`) **saltearía TODAS** las filas Wompi. Hay que reescribirla por transacción |
| Ventana de reintento de webhook | MP reintenta generoso | Wompi: **3 veces en 24h**. Un pago perdido después queda huérfano sin conciliación propia |
| Prorrateo | Solo Stripe lo tiene (`stripe.adapter.ts:122-133`, `proration_behavior`). **Con MP tampoco hay** | Es nuestro para todos — de paso se gana |

### 4.3 Lo que se gana

No todo es costo. Con motor propio:

- **Prorrateo real** en upgrade y cambio de ciclo, que hoy no existe con MP (un upgrade cobra el plan nuevo completo y no acredita lo pagado; mensual→anual cobra el año entero y pierde el mes en curso).
- **Desaparece el modo de falla de `billing.service.ts:303-315`**: hoy se crea la suscripción nueva y **después** se cancela la vieja; si el cancel falla, quedan **dos suscripciones cobrando** en MP y la DB apuntando a la vieja. Con motor propio no hay dos objetos remotos que sincronizar.
- **Desaparece el guard por string de `billing.service.ts:512-547`**, donde el downgrade agendado solo se empuja al proveedor `if (sub.provider === 'mercadopago')`.
- **Se cierra el agujero de conversión** (ver §7.3): con motor propio, convertir un trial en pago del mismo plan es natural.
- **Dunning con cobro real**, no solo con conteo de días.

### 4.4 El costo honesto

**El adapter es ~15% del trabajo. El motor es ~65%. El checkout y la i18n, ~20%.** Cualquier estimación que se base en "es agregar un adapter" está mal por un factor de 5.

---

## 5. Diseño del motor de suscripciones propio

Todo aditivo (**expand-contract**, ver `docs/deploy-hardening-runbook.md` §6), apagado por defecto (`engine='provider'`), y arrancable con el adapter `mock` sin credenciales de Wompi.

### 5.1 Datos

Migración `apps/api/prisma/migrations/2026xxxx_add_billing_engine/migration.sql`. Solo `CREATE TABLE`, `CREATE INDEX`, `ADD COLUMN` nullable o con default. **Cero RENAME/DROP.**

#### `billing_payment_sources` (nueva)

Los instrumentos reutilizables.

```
id uuid PK
tenant_id, provider, provider_source_id      -- UNIQUE(provider, provider_source_id); es TEXTO (Wompi da entero)
kind                 -- card|nequi|daviplata|bancolombia_transfer|pse|mp_card
status               -- pending_auth|available|voided|expired|failed
supports_unattended  bool default false      -- FALSE para 'pse'. Gobierna todo el §5.6
is_default           bool default false
brand,last4,holder_name,exp_month,exp_year   -- para mostrar "Visa ••••1234" y avisar vencimiento
phone_masked                                  -- nequi/daviplata
doc_type, doc_number_enc                      -- AES-256-GCM con ENCRYPTION_KEY; reusa el dato del gate fiscal
auth_token_id, auth_url, auth_expires_at      -- alta asíncrona
acceptance_jti, acceptance_file_hash, accepted_at, accepted_ip   -- evidencia Habeas Data (no el JWT)
consecutive_failures, last_success_at, last_failure_at
metadata jsonb, created_at, updated_at, voided_at
```
Índices: `(tenant_id, status)`, `(status, exp_year, exp_month)`.

#### `billing_charge_attempts` (nueva) — **la pieza central**

Ledger de intentos y **fuente de verdad de la idempotencia**. No la cola, no el cron lock.

```
id uuid PK                        -- también es el jobId de BullMQ (uuid, SIN ':' — ver incidente jobId)
subscription_id, tenant_id
purpose                           -- initial|renewal|upgrade_proration|manual_link
cycle_key                         -- {subscriptionId}.{periodStart:YYYYMMDD}.{purpose}   (sin ':')
attempt_number int default 1      -- UNIQUE(cycle_key, attempt_number)  ← garantía dura anti-doble-cobro
status                            -- scheduled|in_flight|pending_provider|succeeded|failed
                                  --   |abandoned|superseded|stale
provider, payment_source_id       -- payment_source_id NULL en PSE/link
amount_cents, currency            -- monto CONGELADO
fx_rate numeric(18,6), amount_usd_cents
reference TEXT UNIQUE             -- lo que va a Wompi: sub_{sub8}_{YYYYMMDD}_{n}
provider_txn_id, provider_status  -- PENDING|APPROVED|DECLINED|ERROR|VOIDED
failure_code, failure_class       -- soft|hard|indeterminate
period_start, period_end
scheduled_at, sent_at, settled_at, next_retry_at
checkout_url, checkout_expires_at -- patrón PSE
payment_id uuid FK billing_payments NULL UNIQUE  -- una factura fiscal por attempt
metadata jsonb                    -- { remindersSent:[], late:true, supersededBy:... }
```
Índices: `(status, scheduled_at)`, `(provider_txn_id)`, `(subscription_id, period_start)`, `(status, sent_at)`.

#### `billing_credit_ledger` (nueva)

Append-only: `id, tenant_id, subscription_id, delta_cents (con signo), currency, reason (downgrade_proration|upgrade_credit_applied|overpayment|coupon|manual_adjustment), ref_attempt_id, ref_payment_id, created_by, notes, created_at`. El saldo autoritativo es `SUM(delta_cents)`; la columna en la suscripción es caché.

#### Columnas aditivas en `billing_subscriptions`

```
engine text default 'provider'      -- 'provider'|'internal'   ← EL INTERRUPTOR
billing_cycle text                  -- HOY vive en metadata.billingCycle (billing.service.ts:1322).
                                    --  Deploy 1: escribir en ambos. Deploy 2: leer solo la columna.
next_charge_at timestamptz          -- índice (engine, status, next_charge_at)
billing_anchor_day int              -- 1..31, se guarda el ORIGINAL (evita deriva de fechas)
billing_timezone text default 'America/Bogota'
charge_currency text, charge_amount_cents int   -- precio CONGELADO del ciclo
default_payment_source_id uuid
unattended_capable bool default true            -- false ⇒ patrón link+recordatorio
preferred_method text
dunning_state text default 'none'   -- none|retrying|grace|soft_lock|suspended|indeterminate
dunning_started_at, dunning_attempts
credit_balance_cents int default 0
pending_upgrade_plan_id uuid        -- upgrade cobrado pero NO liquidado (todo nace PENDING)
```

#### Columna aditiva en `billing_plans`

```
provider_plan_ids jsonb default '{}'
-- { "wompi": { "CO": { "monthly": {"amountCents":8400000,"currency":"COP"},
--                      "annual":  {"amountCents":85680000,"currency":"COP"} } },
--   "mercadopago": { "CO": { "monthly": {"planId":"2c93..."} } } }
```
Reemplaza neutralmente `mp_plan_id` / `stripe_plan_id` / `priceLocalOverrides[PAIS].mpPlanId` **sin borrarlos**. Con Wompi no hay id remoto: se guarda el **precio congelado por país × ciclo**.

### 5.2 Scheduler

Archivos nuevos bajo `apps/api/src/modules/billing/recurring/`: `renewal-scheduler.service.ts`, `subscription-engine.service.ts`, `processors/renewal-charge.processor.ts`, `processors/charge-poll.processor.ts`, `period.util.ts`, `dunning.service.ts`, `proration.service.ts`, `manual-collection.service.ts`. Colas nuevas: `billing-renewals`, `billing-charge-poll`.

**El cron solo AGENDA, nunca cobra.**

```ts
@Cron('*/10 * * * *')
async scheduleRenewalsCron() {
  await this.cronLock.runExclusive('billing.renewalScheduler', 300, () => this.scheduleRenewals());
}
```
TTL 300s < intervalo 600s. **El lock falla abierto por diseño** — no es la garantía. La garantía es `UNIQUE(cycle_key, attempt_number)`. (Recordatorio: todo `@Cron` corre **dos veces**, API y worker, mismo `AppModule`.)

1. `SELECT` de `engine='internal' AND status IN ('trialing','active','past_due') AND next_charge_at <= now() + '15 min'`.
2. **INSERT idempotente**: `INSERT ... ON CONFLICT (cycle_key, attempt_number) DO NOTHING RETURNING id`. Sin fila → no encola.
3. Encola con `jobId = attempt.id`, **`attempts: 1`** (un retry de BullMQ sobre un POST no idempotente **es un doble cobro**), `removeOnComplete: { age: 604800 }`, `delay = jitter(subscriptionId) ∈ [0, 45min]`.
4. Barrido de rescate: attempts `scheduled` vencidos sin job vivo → re-encolar. BullMQ **no** es la fuente de verdad.

**Fechas.** Prohibido `new Date(x + 30*86400000)`. Cálculo en la zona del tenant (`luxon`/`date-fns-tz`), persistencia en UTC. Clamp **sin arrastre**: alta el 31 → febrero cobra el 28 → **marzo vuelve al 31**, porque `billing_anchor_day` se guarda aparte. `next_charge_at` a las **09:00 hora local** (no medianoche): un rechazo se resuelve el mismo día hábil.

**Escalonamiento obligatorio por aniversario, jamás todos el día 1.** El tope diario de Wompi PJ ronda $80M COP (≈USD 20k, **sin confirmar — W7**). Guard extra: acumulador Redis `billing:renewal:cop:{YYYY-MM-DD}`; al 80% del tope configurado (`WOMPI_DAILY_CAP_COP`) el scheduler difiere al día siguiente y levanta incidente en el Ops Center.

### 5.3 El processor (dónde ocurre el cobro)

Concurrency 4. Orden:

1. **Reserva optimista** (mismo patrón que el refund existente): `UPDATE ... SET status='in_flight', sent_at=now() WHERE id=$1 AND status='scheduled' RETURNING *`. rowcount=0 → `return`.
2. **Revalidación anti-cobro-fantasma** — se valida **al cobrar, no al agendar**: status válido, `cancelAtPeriodEnd=false`, tenant activo, plan no comp, `period_end` coincide, monto coincide. Desvío → `abandoned` con motivo. *Un attempt agendado hace 7 días no autoriza un cobro hoy.*
3. **Guard de tardanza**: `now - scheduled_at > 36h` → `stale` + incidente, **no cobra**. Nunca una avalancha retroactiva cuando el worker vuelve.
4. `charge({ reference, amountCents, currency, providerSourceId, recurrent:true, ... })`. Timeout 30s, **cero reintentos de red** en ese POST.
5. Resultado:
   - `approved` → `settleAttempt()`.
   - **`pending` (el caso normal en Wompi)** → `pending_provider`, guarda `provider_txn_id`, encola en `billing-charge-poll` con backoff 10s/30s/1m/3m/10m/30m/2h. Webhook y polling convergen en el **mismo resolver**.
   - `declined`/`error` → dunning.
   - **timeout sin `provider_txn_id`** → `in_flight` + `failure_class='indeterminate'` + incidente. **Regla de oro: un attempt indeterminado NUNCA engendra otro attempt para ese `cycle_key`.** Wompi no tiene `Idempotency-Key`; ante duda no se recobra, se escala.
6. `settleAttempt` en **una transacción Prisma**: insert en `billing_payments` → `attempt.payment_id` (UNIQUE ⇒ una factura Factus por attempt) → actualizar suscripción y `next_charge_at` → invalidar cachés Redis → **emitir `PAYMENT_SUCCEEDED` con `providerPaymentId`** (contrato exacto que espera `fiscal-invoice.service.ts:45-112`; Factus no se toca) → escribir `billing_events` con `providerEventId='engine_settle_{attemptId}'`.

**Las cuatro capas de idempotencia, por orden de confianza:**
1. `UNIQUE(cycle_key, attempt_number)` ← la real
2. `reference` UNIQUE + UPDATE guardado con rowcount=1
3. `billing_payments.provider_payment_id` UNIQUE + `billing_events (provider, provider_event_id)` UNIQUE
4. CronLock + jobId (comodidad; falla abierto)

### 5.4 Dunning

Reusa lo que ya existe: eventos `billing.subscription.soft_locked`, `getRestrictionStatus` (`billing.service.ts:1212-1246`), `offboarding-cron.service.ts` (grace enforcer 03:00, Redis `offboard:past_due:{tenantId}`), `BillingEmailService`.

**La clasificación del fallo decide todo:**
- **soft** (fondos, `do not honor`, emisor caído) → reintenta.
- **hard** (tarjeta vencida, fuente `VOIDED`) → **no reintenta contra la misma fuente**. Salta a "necesitamos otro medio". Se reanuda con el evento `billing.payment_source.added`, que dispara un attempt inmediato.
- **indeterminate** → congela el dunning, incidente, **nada se corta**.

| Momento | Acción | Estado |
|---|---|---|
| D+0 | attempt 1 falla | sigue **`active`**, `dunning_state='retrying'`, email |
| D+1 | attempt 2 (misma `cycle_key`, `attempt_number=2`, reference nueva) | idem |
| D+3 | attempt 3; si falla → `past_due` + `billing.subscription.soft_locked` | `soft_lock` |
| D+7 | attempt 4 (último) | `grace` |
| D+10 | `expired` + `SUBSCRIPTION_EXPIRED` → offboarding | `suspended` |

Decisión deliberada: **el primer rechazo NO manda a `past_due`**. Cortar features por un rechazo de banco de 5 minutos es churn autoinfligido. La gracia pasa de 7 a 10 días porque el reloj ahora arranca en el primer fallo (nuestro), no en un `past_due` que ponía el proveedor.

`offboarding-cron.graceEnforcer` sigue ejecutando el corte, con una condición nueva: **no cortar si hay un attempt `in_flight`/`pending_provider`/`indeterminate` vivo**.

Canales: email (3 plantillas nuevas) + banners in-app existentes (`UpgradeBanner`, `TrialCountdownBanner`, `SuspendedScreen`) + Ops Center. **SMS no** (decisión del dueño: apagado del todo).

Cron adicional `paymentSourceExpiryWarn`: avisa **30 días antes** de que venza una tarjeta guardada. Wompi no documenta account updater (W3); sin este cron, tarjeta vencida = churn silencioso.

### 5.5 Prorrateo

Todo en la moneda de cobro (COP centavos).

```
D_total     = díasCalendario(period_start → period_end, tz)
D_restantes = max(0, ceil(díasCalendario(now → period_end, tz)))    // ceil = a favor del tenant
pagado      = amount_cents del último attempt succeeded del período  // NO el precio de lista:
                                                                     //  respeta cupones y overrides
unused      = round(pagado * D_restantes / D_total)
nuevoCosto  = provider_plan_ids[provider][país][cicloDestino].amountCents
```

**UPGRADE (default: reset de período).**
`periodStart' = now`, `periodEnd' = nextPeriodEnd(now, cicloDestino, anchor, tz)`, `cobro = max(0, nuevoCosto − unused − credito)`.
- Si `cobro < MIN_CHARGE_CENTS` (sugerido $2.000 COP: la tarifa fija de $700 + IVA hace que por debajo de eso el cobro pierda plata) → no se cobra; la diferencia va al ledger.
- **El plan NO cambia hasta que el attempt liquida** (todo nace `PENDING`). Se escribe `pending_upgrade_plan_id` y el dashboard muestra "procesando tu cambio de plan". Si falla, el plan queda intacto.

**DOWNGRADE — nunca hay devolución de plata** (Wompi no tiene refund). Dos modos por config:
- **`defer` (default, = comportamiento actual):** `pending_plan_id` + `pending_plan_change_at`; el cron 02:30 lo voltea. Cero movimiento de dinero, cero nota crédito.
- **`immediate_credit`:** se aplica ya; `unused` entra al ledger y descuenta el próximo cobro.

`syncDowngradeToProvider` (`billing.service.ts:512-547`) queda **inerte** para `engine='internal'`: no hay nada que empujar.

**Cambio de ciclo.**
- **mensual → anual**: es upgrade. Se acredita `unused`, se cobra `precioAnual − unused − credito`, 12 meses desde hoy, ancla preservada. *(Hoy MP cobra el año entero y pierde el mes en curso.)*
- **anual → mensual**: `defer` **siempre**. Si se habilita `immediate_credit`, el crédito consume meses siguientes con attempts de monto 0 (`provider='internal'`, no viajan a Wompi). **Riesgo fiscal abierto:** un attempt de $0 no debería emitir factura DIAN — confirmar con el contador antes de habilitar.

**Precio congelado.** `charge_amount_cents` + `charge_currency` se fijan al crear/renovar; el `fx_rate` USD→COP queda en el attempt. Un precio COP que flote con el dólar cambia el monto **y la firma de integridad** de cada renovación. Cambio de precio del super_admin ⇒ aplica desde el ciclo siguiente, con aviso.

### 5.6 PSE y todo lo que no admite cobro sin usuario presente

`supports_unattended=false` ⇒ `unattended_capable=false` ⇒ patrón **link + recordatorio + gracia**. Para PSE no se guarda un "source": se guardan la **preferencia de método** y los datos del pagador (tipo/número de documento, tipo de persona, banco) para prellenar el link cada mes. El documento sale del gate fiscal DIAN cuando ya existe.

| Momento (T = renovación) | Qué pasa |
|---|---|
| **T−7d** | attempt `scheduled` + `createCheckoutLink` (expira T+10d) |
| **T−7, −3, −1, T, +2, +5, +8** | recordatorios: email + banner + notificación. Dedup en `attempt.metadata.remindersSent[]` (**en la fila, no en Redis**: sobrevive a flush y a deploy). Cada uno con CTA "activá el débito automático" |
| **paga** | `transaction.updated` APPROVED → resolver **por `reference`** → `settleAttempt` → `PAYMENT_SUCCEEDED` → Factus |
| **T+0 sin pago** | **no se corta nada.** `grace`. Acá el fallo es "no hizo el trámite", no "el banco rechazó" |
| **T+3d** | `past_due` + soft lock |
| **T+10d** | `expired` + offboarding |
| **paga tarde (T+6)** | el período nuevo arranca en **T**, no en la fecha de pago. Excepción: si la demora supera un ciclo, se reancla |
| **link expirado** | `abandoned`; el recordatorio siguiente genera `attempt_number+1`. Si el link viejo se paga igual, la reference lo identifica: se marca `superseded` y va **al ledger de crédito**, nunca a un segundo período |
| **monto ≠ esperado** | no se avanza el período: al ledger + incidente |

**Regla de producto derivada: el ciclo anual solo se ofrece con débito automático.** PSE + anual = un cobro grande, manual, una vez al año, con 10 días de gracia. Con PSE, solo mensual.

### 5.7 Cómo encaja en `IPaymentProvider`

Ni booleanos sueltos ni dos interfaces excluyentes. Tres piezas:

**(a) `ProviderCapabilities`** (`billing/adapters/provider-capabilities.ts`):
```ts
nativeSubscriptions: boolean;   // el proveedor agenda y cobra solo
storedPaymentSources: boolean;
planCatalog: boolean;
changePlanInPlace: boolean;
pauseResume: boolean;
nativeProration: boolean;
refunds: 'full' | 'void_only' | 'none';   // wompi: 'void_only'
asyncSettlement: boolean;                  // wompi: true — prohibido asumir resultado síncrono
currencies: readonly string[];             // wompi: ['COP']
unattendedMethods: readonly PaymentSourceKind[];  // wompi: card,nequi,daviplata,bancolombia_transfer
requiresAcceptanceTokens: boolean;         // wompi: true (DOS tokens)
```
MP: `nativeSubscriptions:true, refunds:'full', asyncSettlement:false`. Stripe: idem + `nativeProration:true`.

**(b) `IChargingProvider`** (interfaz nueva, segregada): `getAcceptanceContracts()`, `startPaymentSource()`, `pollPaymentSourceAuth()`, `confirmPaymentSourceOtp?()`, `voidPaymentSource()`, `charge()`, `getCharge()`, `voidCharge?()`, `createCheckoutLink()`, más `verifyWebhookSignature` / `parseWebhookEvent`.

Detalle importante en `ChargeInput`: `acceptance?` va **opcional a propósito** — la doc de Wompi se contradice sobre si es obligatorio en el cobro contra `payment_source_id` (W4). Se resuelve en sandbox, no en el diseño.
Y `token` en `startPaymentSource` es el token efímero del **cliente**: nunca PAN. Tokenizar desde NestJS sería alcance PCI y Wompi lo prohíbe.

**(c) `WompiAdapter implements IChargingProvider, IPaymentProvider`**: los métodos sin contraparte tiran `NotImplementedException` **explícita y ruidosa**, nunca no-op silencioso.

**Factory:**
```ts
getByName(name): IPaymentProvider          // SIN default silencioso a MP
getCharging(name): IChargingProvider       // throws si el adapter no la implementa
capabilitiesOf(name): ProviderCapabilities
```

**El cambio que de verdad importa en `BillingService`**: reemplazar las ramas por string por ramas por capacidad.
```ts
const caps = this.providerFactory.capabilitiesOf(sub.provider);
if (caps.nativeSubscriptions) { /* camino actual MP/Stripe */ }
else { await this.engine.upgrade(sub, plan, cycle); }
```

---

## 6. Convivencia MP + Wompi con switch

### 6.1 Dónde vive el switch — 4 niveles en cascada

Servicio nuevo `apps/api/src/modules/billing/payment-routing.service.ts`.

| Nivel | Dónde | Qué controla |
|---|---|---|
| **L0** Kill switch global | `platform_settings` (`schema.prisma:108`), clave `billing.providers_enabled` | `{"mercadopago":true,"wompi":false,"stripe":false}`. Patrón calcado de `SmsKillSwitchService` (raw SQL + caché Redis 60s + `invalidate()`) |
| **L1** Default por país | `platform_settings`, `billing.default_provider_by_country` | `{"CO":"wompi","*":"mercadopago"}` |
| **L2** Override por tenant | `Tenant.paymentProvider` (`schema.prisma:43`) | Ya existe; hoy **nadie lo escribe** salvo `createTrialSubscription` con su propio default |
| **L3** Congelado por suscripción | `billing_subscriptions.provider` (`billing.service.ts:193`) | **Manda sobre todo lo demás. El proveedor de una suscripción es de por vida** |

**Polaridad asimétrica y deliberada del L0:**
- `wompi` ausente o ilegible → **apagado** (falla cerrado: un proveedor nuevo nunca nace encendido por accidente).
- `mercadopago` ausente o ilegible → **encendido** (falla abierto: un hipo de Redis no puede cortar el único camino de ingresos que hoy funciona).

**Alcance del L0: solo altas nuevas.** No apaga webhooks, ni reconciliación, ni operaciones sobre suscripciones vivas. Es donde se equivoca la mayoría de los kill switches de pagos: si apagás Wompi con 40 suscripciones vivas y eso rechaza sus webhooks, dejás de acreditar cobros reales.

**Orden de resolución:**
```
sub.provider (si hay sub viva)
  → tenant.paymentProvider
  → default_provider_by_country[tenant.billingCountry]   (schema.prisma:39)
  → default_provider_by_country["*"]
  → filtro L0: si el resuelto está apagado, cae al primero habilitado que soporte el país
  → si ninguno: BadRequest 'no_payment_provider_available'   (NUNCA default silencioso)
```

**Quién lo toca: solo super_admin.** `roles.ts` es deny-by-default: cada endpoint nuevo necesita regla explícita.

| Endpoint | Qué hace |
|---|---|
| `GET/PUT /api/v1/billing-admin/providers` | L0 + L1. UI: pestaña nueva "Proveedores de pago" en `/admin/plans` |
| `PUT /api/v1/billing-admin/tenants/:id/payment-provider` | L2. **Motivo obligatorio + audit con el super_admin real** (no el impersonado). **409 si hay suscripción `active\|trialing\|past_due`**, salvo `force:true` — cambiar de proveedor con suscripción viva **no migra el mandato** (§7) |
| `GET /api/v1/billing-admin/providers/status` | Reemplaza `getMpProviderStatus()`. Devuelve `{mercadopago:{...}, wompi:{...}}`. El viejo queda como alias un deploy |

### 6.2 Routing

**Alta nueva: decidida por país, no por el tenant.** CO → Wompi (cuando esté encendido), resto → MP. Wompi es COP-only y CO-only, así que "elegir" fuera de Colombia no existe; y dentro de Colombia el tenant no debería tener que saber qué es una pasarela. Si más adelante se quiere dar elección, se ofrece como **método de pago** ("tarjeta / Nequi / Daviplata / cuenta Bancolombia / PSE") y el proveedor se deriva del método. Fase 3+, no v1.

**Suscripciones vivas:** `getByName(sub.provider)` en absolutamente todo. Ya es así en la mayoría del código; hay que eliminar los tres lugares donde se rompe (tabla en §2).

### 6.3 Webhooks

La ruta `POST /api/v1/billing/webhook/:provider` sirve tal cual.

- **Allowlist** (`webhook.controller.ts:57-63`): agregar `'wompi'`. **No gatear por el L0** — un proveedor apagado para altas nuevas sigue teniendo suscripciones vivas.
- **Firma**: no es HMAC. `SHA256(valores de signature.properties EN ORDEN + timestamp + events_secret)` contra `signature.checksum` o `X-Event-Checksum`, con `crypto.timingSafeEqual`. Fail-closed 401.
  - **`signature.properties` es dinámico**: leer el array del payload y resolver los paths por reflexión. Hardcodear los tres campos rompe la validación en cuanto Wompi amplíe el array.
  - **Fuente: la doc en español.** La inglesa omite `environment` y el `timestamp` de primer nivel. Validar contra sandbox antes de dar la firma por hecha.
  - Ampliar el contexto de `verifyWebhookSignature` de `{dataId}` (MP-shaped) a `{dataId?, rawBody, headers}`.
  - Validar `environment` (`prod`/`test`) contra el ambiente configurado si el campo llega.
- **Idempotencia**: Wompi **no manda event id**. Construir uno determinista: `` `${event}:${transaction.id}:${transaction.status}` ``. Permite reprocesar `PENDING`→`APPROVED` y bloquea duplicados exactos. TTL 48h ya cubre la ventana de 24h de Wompi.
- **Blindaje del "reintento de pago"**: una misma `reference` puede producir dos transacciones (una `DECLINED`, otra `APPROVED`), ventana de 3 minutos. **Documentado para el checkout; NO demostrado para cobros por API contra `payment_source_id`** — la verificación adversarial acotó esto. Blindarse igual: **un `PAYMENT_FAILED` nunca degrada una suscripción que ya tiene un `PAYMENT_SUCCEEDED` para la misma `reference` en el mismo ciclo.**

**Mapeo a `BillingEventType`:**

| Wompi | Interno |
|---|---|
| `transaction.updated` + `APPROVED` | `PAYMENT_SUCCEEDED` (+ `ACTIVATED` si viene de `pending_auth`) |
| `+ DECLINED` | `PAYMENT_FAILED` |
| `+ ERROR` | `PAYMENT_FAILED` con `metadata.retryable=true` |
| `+ VOIDED` | `PAYMENT_REFUNDED` (solo tarjeta) |
| `+ PENDING` | `SUBSCRIPTION_CREATED` (no-op; no debería llegar) |
| `nequi_token.updated` / `bancolombia_transfer_token.updated` → APPROVED | **`PAYMENT_METHOD_AUTHORIZED`** (valor nuevo) |
| idem → DECLINED/ERROR | **`PAYMENT_METHOD_DECLINED`** (valor nuevo) |

Agregar 2 valores al enum es aditivo → cumple expand-contract. **Daviplata no tiene evento de token: solo polling.**

**Resolución de la suscripción.** Hoy la cascada es `providerSubscriptionId → tenantId → payerEmail`. Wompi no tiene subscription id. Agregar: por **`reference`** (diseñada como `sub_{subscriptionId}_{periodSeq}_{rand}`, parseable) y por **`payment_source_id`** (viene en el evento).

**El hueco que hay que cerrar sí o sí.** `deriveSubscriptionPatch` (`billing.service.ts:1330-1363`) **no sabe activar una suscripción desde un webhook**: `SUBSCRIPTION_CREATED` devuelve `null` y si no existe la fila el evento se guarda y no pasa nada. Con MP no molesta (la fila se crea sincrónicamente). **Con Wompi un cobro exitoso no activaría la suscripción.** Arreglo: (a) crear la fila **antes** de disparar la transacción, en `pending_auth`; (b) agregar la transición `PENDING_AUTH → ACTIVE` en `PAYMENT_SUCCEEDED`. El estado ya existe en el enum y hoy nadie lo produce — acá recién cobra sentido.

### 6.4 Catálogo

**Wompi no tiene catálogo. No hay nada que sincronizar.** Lo que se guarda no son ids: son **precios en COP** (columna `provider_plan_ids`, §5.1). No se toca `mpPlanId` ni `priceLocalOverrides` — cero migración destructiva.

`resolveProviderPlanId` (`billing.service.ts:1271-1318`) → `resolveProviderPricing(plan, provider, country, cycle)` que devuelve `{providerPlanId?, amountCents, currency}`. **Eliminar el `else { id = 'mock-plan' }`.**

**Breakage silencioso del toggle anual.** Hoy `billing-plan-display.util.ts:18-29` expone `mpPlanIdAnnual` en la **API pública** y el dashboard gatea el switch mensual/anual con ese campo (`settings/billing/page.tsx:276-286, 1193`). Con Wompi ese campo viene vacío, `annualCycleAvailable` pasa a `false` y **el toggle desaparece sin ningún mensaje** — se pierde el ciclo anual y su ~15% de descuento sin que nadie tire un error. Arreglo: agregar `annualAvailable: boolean` calculado en backend, manteniendo `mpPlanIdAnnual` un deploy (deprecado).

**Nota de margen.** Con 2,65% + $700 + IVA, el componente fijo castiga desproporcionadamente al plan barato: emprendedor (USD 21 ≈ COP 84.000) paga **~4,1% efectivo**; enterprise (USD 349) paga **~3,2%**. Meterlo en `docs/plan-profitability-2026-07.md`.

### 6.5 Reconciliación

- **`nativeSubscriptions: true`** (MP, Stripe) → la de hoy, sin cambios.
- **`nativeSubscriptions: false`** (Wompi) → **por intento de cobro**: cron que barre `billing_charge_attempts` en `pending_provider`/`in_flight` con antigüedad > 15 min y cierra con `getCharge` (`GET /v1/transactions/{id}`, llave pública). Fabrica evento sintético y lo mete por `handleBillingEvent` — la máquina de estados sigue viviendo en un solo lugar.

De paso cierra un hueco que **ya existe hoy**: la reconciliación solo compara **status**, nunca plan, monto ni ciclo, así que un cobro por el monto equivocado no se detecta. Con `billing_charge_attempts` el monto queda comparable.

### 6.6 Monitoreo

**Partir los contadores por proveedor.** Hoy `billing:webhook:fail:{kind}:{día}` es global (`platform-monitor.service.ts:642-707`); con dos proveedores vivos, una rotación de secreto en Wompi se diluye en el ruido de MP. Pasar a `billing:webhook:fail:{provider}:{kind}:{día}`. El texto del alerta hoy nombra `MERCADOPAGO_WEBHOOK_SECRET` hardcodeado → parametrizar.

Chequeos nuevos específicos de Wompi:
1. Attempts `pending_provider` > 30 min sin resolver.
2. **Cobros programados del día no ejecutados** (cola atascada) — con Wompi, si el scheduler se cae, **nadie cobra**. Con MP eso no podía pasar.
3. Acumulado 24h contra el tope diario, alerta al 70%.
4. Fuentes de pago próximas a vencer.
5. Tasa de `DECLINED` por método en 24h.

**Ops Center**: tarjeta "Pagos" con estado por proveedor (habilitado, credenciales, ambiente por prefijo de llave, último webhook OK, aprobación 24h, **suscripciones vivas por proveedor** — literalmente el medidor del corte de MP).
**Billing Ops**: filtro por proveedor en el listado (hoy no existe). Es la herramienta de la migración.

### 6.7 DIAN / Factus

**Lo que NO cambia (la buena noticia).** `fiscal-invoice.service.ts:45-148` escucha eventos **normalizados**. Si el adapter Wompi emite `PAYMENT_SUCCEEDED` con `providerPaymentId`, la FEV funciona **sin tocar una línea del módulo fiscal**. Ese desacoplamiento ya estaba bien hecho y se cobra ahora.

**Lo que sí cambia:**

| Tema | Efecto |
|---|---|
| **Moneda** | Mejora: Wompi es COP y la FEV se emite en COP. Se elimina la ambigüedad |
| **Nota crédito** | **Degradación real.** Sin endpoint de refund, `refundPayment` en Wompi hace: (1) tarjeta en ventana → `void`; (2) si no → registra **"reembolso manual pendiente"** + incidente + instrucción de trámite, y emite la nota crédito **cuando el dinero se devolvió efectivamente**; (3) **nunca fingir éxito**. Reusar la reserva optimista de `billing.service.ts:808-905`. El panel se **deshabilita** para `capabilities.refunds !== 'full'` |
| **Retenciones** | Cambia la conciliación, no la factura. En Agregador el comercio asume la calidad tributaria de Wompi: reteFuente ~1,5% (tarjeta), reteIVA 15% (tarjeta), reteICA según municipio (Wompi en Medellín: 0,02%). **Lo desembolsado ≠ lo facturado**: el arqueo va contra el reporte de liquidación de Wompi, no contra la suma de facturas. Documentar en `docs/billing-runbook.md` |
| **Timing** | Un cobro del día 31 que aprueba el día 1 cae en otro período fiscal. **Regla: la fecha de emisión es la del evento del proveedor, no la del scheduler** |
| **Gate fiscal** | **Encenderlo para CO.** Hoy `assertFiscalDataReady` (`billing.service.ts:58-72,143-145`) casi nunca dispara. Con Wompi, PSE y Daviplata **exigen documento del pagador de todos modos**: encender `fiscal.gate_enabled` reusa ese dato en vez de pedirlo dos veces. Sale gratis |

---

## 7. Qué pasa con las suscripciones que ya viven en MercadoPago

### 7.1 La respuesta técnica: NO se puede migrar un mandato entre pasarelas

- Un `preapproval` de MP está atado al token tokenizado **dentro del alcance PCI de MP**. No hay exportación de PAN ni de token entre pasarelas.
- Existe migración de *network tokens* entre PSPs vía Visa/Mastercard, pero requiere acuerdo tripartito y **no está documentada ni por MP ni por Wompi**. Asumir que no.
- Wompi **prohíbe explícitamente** que los datos de tarjeta pasen por nuestro servidor.
- Nequi / Daviplata / Bancolombia Transfer no existen como mandato en MP → no hay nada que migrar.

**Todo tenant que pase de MP a Wompi tiene que volver a autorizar el medio de pago. Sin excepciones.**

### 7.2 Estrategia: MP se deja morir por cohorte, no se apaga

**Cohorte A — trials (la mayoría, y migra gratis).** Todos los trials son 100% locales: `skipProviderCreate = plan.trialDays > 0` (`billing.service.ts:138`) y los 4 planes self-serve tienen trial (7d emprendedor/starter, 15d pro/enterprise — `seed-billing-plans.js:44,150,250,349`). Entonces `providerSubscriptionId = null` y **no hay nada del otro lado**. Se reasignan con un `UPDATE` sin ningún efecto en el proveedor.
*(Corolario incómodo: hoy el `cardTokenId` que llega en el alta **se descarta silenciosamente** cuando `trialDays > 0`.)*

**Cohorte B — suscripciones pagas vivas en MP.** **No se tocan.** Siguen cobrando, conciliando y facturando por MP hasta que el tenant cancele o migre. `billing_subscriptions.provider` congela el proveedor de por vida.

**Cohorte C — migración voluntaria con incentivo, no forzada.** Banner en `/admin/settings/billing` para tenants CO con sub en MP: *"Pagá con Nequi, Daviplata o tu cuenta Bancolombia"*.

**El orden de la mecánica es lo que importa:**
1. Crear la fuente de pago en Wompi y **verificar `status: AVAILABLE`**.
2. Programar el primer cobro Wompi para el `currentPeriodEnd` de MP (o cobrar ya si venció).
3. **Recién entonces** cancelar el preapproval de MP.

Nunca al revés. Si (1) o (2) falla, MP sigue vivo y no pasó nada. **Es exactamente el bug que hoy tiene el upgrade** (`billing.service.ts:303-315`: crea la nueva y después cancela la vieja; si el cancel falla, quedan dos suscripciones cobrando y la DB apuntando a la vieja). No repetirlo.

Implementación: **no es un cambio de proveedor en la misma fila.** Se cierra la fila MP (`cancelAtPeriodEnd`) y se crea una fila nueva Wompi con el mismo `planId` y `metadata.migratedFrom = {provider:'mercadopago', subscriptionId}`. Así ninguna operación histórica se rutea al adapter equivocado.

**Migración forzada: solo como contingencia** si MP corta el servicio. Campaña de 30 días con aviso; las que no re-autorizan caen en el dunning existente. Es churn asumido y hay que decirlo por escrito **antes**, no después.

### 7.3 El agujero que hay que arreglar en la misma tanda

**Hoy no existe camino en producto para convertir un trial en pago del mismo plan.**
- `upgradeSubscription` tira `'same_plan'` si no cambia tier ni ciclo (`billing.service.ts:246-249`).
- El dashboard deshabilita el botón (`settings/billing/page.tsx:1186`, `isCurrent`).
- El trial no tiene suscripción en el proveedor, así que el camino no-MP tira `missing_provider_subscription`.
- Al vencer cae a `past_due` (`offboarding-cron.service.ts:27-90`) y a los 7 días a `expired`, **sin haber tenido nunca un botón para pagar**.

Es probablemente **la fuga de plata más cara del producto hoy, y es independiente del proveedor**. Cambiar de pasarela cuando nadie puede convertir un trial es cambiar la cerradura de una puerta que no tiene picaporte.

---

## 8. Superficie a tocar

### 8.1 Backend — billing

| Archivo | Cambio |
|---|---|
| `billing/types/provider-types.ts:9` | `PaymentProviderName` += `'wompi'` |
| `billing/payment-provider.factory.ts:18-29` | **Quitar el default a MP** → `throw`. Agregar `getCharging()` y `capabilitiesOf()` |
| `billing/adapters/payment-provider.interface.ts` | Agregar `readonly capabilities` |
| `billing/adapters/provider-capabilities.ts` | **NUEVO** |
| `billing/adapters/charging-provider.interface.ts` | **NUEVO** — `IChargingProvider` |
| `billing/adapters/wompi.adapter.ts` | **NUEVO** — el adapter |
| `billing/adapters/wompi-config.service.ts` | **NUEVO** — 4 llaves, base URL derivada del prefijo, validación prefijo↔ambiente |
| `billing/adapters/mercadopago.adapter.ts` / `stripe.adapter.ts` | Solo agregar `capabilities` |
| `billing/billing.service.ts:279-330` | Upgrade por **capacidad**, no por string. **Compensación en el create→cancel** |
| `billing.service.ts:512-547` | `syncDowngradeToProvider` por capacidad; dejar de pedir el adapter MP por nombre literal |
| `billing.service.ts:949-961` | `grantCompPlan`: provider del router, no `'mercadopago'` fijo |
| `billing.service.ts:1271-1318` | `resolveProviderPricing`; **fuera el `'mock-plan'` silencioso** |
| `billing.service.ts:1330-1363` | Activación desde evento + `PENDING_AUTH → ACTIVE` |
| `billing.service.ts:284-287` | Sacar `mp_payer_email_required` de la capa de negocio |
| `billing/webhook.controller.ts:57-63` | Allowlist += `'wompi'`; contexto de firma `{dataId?, rawBody, headers}` |
| `billing/types/billing-event.enum.ts` | +`PAYMENT_METHOD_AUTHORIZED`, +`PAYMENT_METHOD_DECLINED` |
| `billing/payment-routing.service.ts` | **NUEVO** — los 4 niveles |
| `billing/recurring/*` | **NUEVO** — scheduler, engine, 2 processors, dunning, proration, manual-collection, period.util |
| `billing/processors/reconciliation.processor.ts:86,143` | Segunda estrategia por attempt |
| `billing/billing-admin.controller.ts:9,97,272-370` | Inyectar la **factory**, no `MercadoPagoAdapter`. Endpoints de providers + provider-pricing. Mantener `sync-mp` |
| `billing/billing-plan-display.util.ts:18-29`, `billing-public.controller.ts:50-60`, `billing.controller.ts:150-160` | `annualAvailable` junto a `mpPlanIdAnnual` (deprecado un deploy) |
| `billing/billing.controller.ts:300-313` | Cambio de medio de pago: sacar el `as any` sobre `providerFactory`; dejar de asumir "card token" |
| `billing/billing.module.ts:37-56` | Registrar adapter, configs, colas y processors nuevos |
| `billing/coupons.service.ts` | Sin cambios (ya es local) |

### 8.2 Backend — fuera de billing

| Archivo | Cambio |
|---|---|
| `apps/api/prisma/schema.prisma` | 3 modelos nuevos + columnas aditivas en `BillingSubscription` y `BillingPlan` |
| `apps/api/prisma/migrations/…` | Migración **solo aditiva** |
| `modules/fiscal/fiscal-invoice.service.ts` | **Sin cambios** (escucha eventos normalizados). Solo ramificar la **nota crédito** por `capabilities.refunds` |
| `modules/offboarding/offboarding-cron.service.ts:99-181` | `graceEnforcer`: **no cortar** si hay attempt vivo |
| `modules/health/platform-monitor.service.ts:642-707` | Contadores por proveedor + 5 chequeos nuevos |
| `modules/tenant-payments/tenant-payments.service.ts:5-16` | **Eje aparte** (§8.5). `provider` deja de ser literal; 4 credenciales cifradas; webhook por token opaco |
| `modules/billing/sms-checkout.service.ts:4,19,44,49,103` | **Anotar, no trabajar ahora.** Clavado a MP (adapter concreto, `provider:'mercadopago'`, `createPaymentPreference` que ni está en la interfaz, barrido filtrado por MP). SMS está apagado por decisión del dueño; si algún día se apaga MP, este módulo queda sin checkout |

### 8.3 Frontend

| Archivo | Cambio |
|---|---|
| `components/billing/MpCardForm.tsx` | **No se adapta, se acompaña.** SDK propietario de MP + `createCardToken` que no existe en Wompi |
| `components/billing/WompiPaymentForm.tsx` | **NUEVO** — widget `data-widget-operation="tokenize"` (evita formulario propio y elimina riesgo PCI) |
| `components/billing/PaymentForm.tsx` | **NUEVO** — dispatcher por proveedor |
| `app/admin/settings/billing/page.tsx:288-348` | `handleUpgrade`: la regla "con sub activa siempre pido tarjeta nueva" es una limitación de MP codificada en la UI. Reescribir por proveedor |
| `…/page.tsx:1292-1322` | Modal con selector de método + **doble token de aceptación** con ambos permalinks + evidencia (fecha, IP) |
| `…/page.tsx:276-286, 1193` | Toggle anual por `annualAvailable`, no por `mpPlanIdAnnual` |
| `…/page.tsx:111-123, 537` | `MpSecurityScript` condicional al proveedor. *(Bonus: `www.mercadopago.com` **no está** en el `script-src` del CSP → el antifraude de MP probablemente **ya viene fallando**. Confirmar.)* |
| `…/page.tsx:595` | Dejar de mostrar `subscription.provider` crudo (mostraría literalmente `wompi`) |
| `…/page.tsx:639-697` | Mostrar el medio vigente (marca, últimos 4, banco). Hoy "Cambiar tarjeta" es un **botón ciego** — tolerable con un método, insostenible con cuatro |
| `app/admin/settings/billing/return/page.tsx` | **NUEVO** — retorno `?id=<transaction_id>` que **no confía en el query param**: consulta `GET /v1/transactions/{id}` |
| Estados asíncronos nuevos | "esperando aprobación en tu app Nequi", "te vamos a redirigir a tu banco", pendiente/expirado/rechazado. Moldes: compra de SMS (`page.tsx:236-262`) y `FiscalGateModal → ?resumePlan=` |
| `app/admin/plans/page.tsx:104,364-393,552-590,681-720` | Columnas por proveedor; `getMpProviderStatus` → `getProvidersStatus` |
| `app/admin/settings/integrations/payments/page.tsx` | Selector de proveedor + formulario por proveedor (§8.5) |
| `app/onboarding/page.tsx:21,1027-1094` | El paso plan+tarjeta está **inerte** pero sigue importando `MpCardForm`. Migrar al dispatcher o borrar el JSX |
| `lib/api.ts:1049-1092,1177-1191,1260-1321` | `MercadoPagoProviderStatus` → genérico; `initPoint` → `checkoutUrl` |

### 8.4 Infra, env y i18n

| Ítem | Detalle |
|---|---|
| **`infra/nginx/nginx.conf:38` (CSP)** | Agregar `https://checkout.wompi.co` a `script-src` y `frame-src`; `https://production.wompi.co` + `https://sandbox.wompi.co` a `connect-src`. **Es infra: se despliega por otro camino que el build de Next.** Si sale el código antes que el CSP, **el pago falla con pantalla en blanco y sin error visible al usuario**. Desplegar el CSP PRIMERO |
| **GitHub Secrets** | `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_KEY`, `WOMPI_INTEGRITY_KEY` (×ambiente) |
| **`.github/workflows/deploy.yml:582-586`** | Escribir las 4 al `.env` + `WOMPI_WEBHOOK_URL`. **Si no se agregan acá, se pierden en el próximo deploy.** *(Nota: `CLAUDE.md` menciona `MERCADOPAGO_ACCESS_TOKEN`; el código real usa `MP_ACCESS_TOKEN`.)* |
| **`deploy.yml:245`** | Llave pública: **mover a runtime** (`GET /billing/public-config`) en vez de `NEXT_PUBLIC_*` horneada en el build. Si no, cada cambio de proveedor o ambiente exige rebuild + deploy del dashboard, y no puede haber llave distinta por tenant |
| **Worker** | El `integrity_secret` debe estar disponible en el **worker**, no solo en la API: cada cobro se firma |
| **i18n ×4** (`messages/{es,en,pt,fr}.json`) | ~**15 claves a re-redactar** (nombran "MercadoPago" o "tarjeta": `mpCardForm.pciNote`, `billingPage.retrySucceeded/refundIssued/changeCard/cardUpdated/modalChangeCard*/requiresCard`, `plansPage.syncMp*/mpPlanId*`, `tenantPayments.subtitle/directNotice/accessTokenHint/saved`, `settings.items.payments.description`, `help.settingsBilling.tips.1`) + ~**25-40 nuevas** (selector de método, banco PSE, tipo de persona, teléfono Nequi, OTP Daviplata, "esperando aprobación", "te vamos a redirigir", pendiente/expirado/rechazado, retorno). **Total 100-160 entradas × 4 archivos** |
| **Docs** | `docs/billing-runbook.md` (retenciones, arqueo, dunning), `docs/plan-profitability-2026-07.md` (2,65% + $700 + IVA), `docs/billing-annual-cycle.md`, `CLAUDE.md` (índice) |

### 8.5 El eje aparte: `tenant-payments` (el tenant le cobra a SU cliente)

**Puede rendir más que el eje de suscripciones**, y es independiente:
- El cliente final colombiano paga con **Nequi y PSE** mucho más que con tarjeta.
- **No depende de que Wompi nos apruebe nada a nosotros**: cada tenant se vincula con su propia cuenta.
- Encaja directo con "el agente de IA manda el link de pago por WhatsApp" (seña anti-no-show, anticipo de tour, matrícula).

Qué implica:
1. **Credenciales**: `TenantPaymentConfig.provider` pasa a union. MP son 2 campos; **Wompi son 4**. Cifrar los cuatro con `WhatsappCryptoService` (AES-256-GCM). La pantalla está cableada a MP en copy, placeholder (`APP_USR-...`) y hint.
2. **MVP correcto: links de pago, no fuentes de pago.** `POST /v1/payment_links`, **sin firma de integridad**, devuelve `https://checkout.wompi.co/l/:id`. No necesita tokenización ni recurrencia ni checkout propio. El evento trae `payment_link_id` para conciliar. Resuelve el 90% del caso.
3. **El problema real: el webhook multi-tenant.** La URL de eventos se configura **a mano en el panel de cada tenant** y **no es configurable por API**. Y no podemos verificar la firma sin saber de qué tenant es el evento *antes* de validar. Solución: **URL con token opaco por tenant** — `POST /api/v1/tenant-payments/webhooks/wompi/{tenantWebhookToken}`, aleatorio y **no el tenantId** (no filtrar identificadores internos en una URL que el tenant pega en un panel de terceros). Mostrar la URL con botón de copiar + test de conexión.
4. **Restricción legal a mirar**: el Reglamento de Wompi restringe **actividades inmobiliarias**. No nos afecta (vendemos software) pero **sí afectaría a un tenant inmobiliario** que quiera vincular su cuenta — advertirlo en la UI de esa vertical. §12.1 prohíbe usar los servicios en nombre de terceros: nuestro modelo (token propio del tenant, dinero directo a su cuenta) está del lado correcto; moverse a marketplace/split sin asesoría legal, no.

**Secuenciación:** después de la Fase 1 (adapter, firma y CSP ya resueltos) y **en paralelo a la Fase 2** — no depende del motor, porque los links son cobros únicos. Es la porción de Wompi que da valor más rápido y con menos riesgo.

---

## 9. Plan por fases

**Pre-requisito no técnico, va primero en el calendario, antes de código:** cuenta **Bancolombia a nombre del NIT** de la SAS (única entidad habilitada para desembolsos), registrándose como **persona jurídica** (la natural tiene tope de $2.500.000/tx y difiere el primer desembolso 30 días). Es el equivalente al trámite Factus: bloqueante de calendario, no de backlog. **En paralelo**, mandar las 9 preguntas de §3.4 por escrito.

| Fase | Qué incluye | "Listo" cuando | Est. |
|---|---|---|---|
| **F0 — Higiene del ruteo** *(sin Wompi, desplegable sola, riesgo cero)* | Factory ruidosa; `PaymentProviderName` += wompi; `capabilities` en los 3 adapters; los tres `=== 'mercadopago'` por capacidad; `resolveProviderPricing` sin `'mock-plan'`; compensación en el create→cancel del upgrade; contadores de webhook por proveedor; `PaymentRoutingService` + endpoints super_admin + reglas en `roles.ts` (Wompi apagado); `annualAvailable` en la API | En producción, con Wompi apagado, se procesa una renovación real de MP, un upgrade real y un webhook real **sin cambio de comportamiento**; y el panel muestra el switch con Wompi en off | **1-1,5 sem** |
| **F1 — Adapter Wompi en sandbox** | 4 secretos en GitHub Secrets **y** `deploy.yml`; base URL derivada del prefijo con validación prefijo↔ambiente; firma de integridad; checksum de evento (**doc en español**, resolver W4 y de dónde sale el `timestamp`); **CSP de nginx desplegado ANTES que el front**; tests deterministas contra sandbox | Ciclo completo en sandbox: fuente de pago → cobro → webhook firmado y verificado → `billing_event` → factura Factus sandbox | **1,5-2 sem** |
| **F2 — Motor de recurrencia** *(el 80% del trabajo real)* | 3 tablas + 2 colas; scheduler escalonado por aniversario; processor con reserva optimista, revalidación, guard de 36h y regla del indeterminado; dunning con reintentos reales; prorrateo; `PENDING_AUTH` real + activación desde evento; reconciliación por attempt; regla "último APPROVED gana"; integrity secret en el worker | **3 ciclos consecutivos cobrados solos en sandbox**, incluyendo uno con el primer intento DECLINED recuperado por reintento, y uno con el webhook deliberadamente bloqueado recuperado por reconciliación | **4-5 sem** |
| **F2b — `tenant-payments` con links Wompi** *(paralelo a F2)* | Selector de proveedor, 4 credenciales cifradas, `payment_links`, webhook por token opaco + test de conexión | Un tenant real cobra una seña por Nequi y la ve acreditada | **1-1,5 sem** |
| **F3 — Checkout del tenant** | Dispatcher `<PaymentForm>`; `WompiPaymentForm` con widget tokenize; selector de método; doble token de aceptación + evidencia; estados asíncronos; página de retorno que no confía en el query param; llave pública por runtime; mostrar el medio vigente; **arreglar trial → pago del mismo plan**; i18n 100-160 × 4 | Un tenant interno real **contrata el plan emprendedor con Nequi en producción y se le cobra el segundo ciclo solo**, sin intervención | **2-3 sem** |
| **F4 — Encendido gradual** | (1) `providers_enabled.wompi = true` pero `default_provider_by_country.CO` sigue en MP; 3 tenants por override L2, dos semanas. (2) Si limpio: `CO = "wompi"` → altas nuevas colombianas a Wompi. (3) MP sigue default para el resto y vivo para todo lo existente | 20 renovaciones consecutivas en Wompi sin intervención, aprobación ≥ la de MP, y **cero incidentes de webhook abiertos durante 14 días** | **2-4 sem calendario** (poco código) |
| **F5 — Apagar MP (si alguna vez)** | `providers_enabled.mercadopago = false` (solo bloquea altas nuevas; webhooks, reconciliación y cobros vivos siguen) → campaña voluntaria → consulta de corte | `SELECT count(*) FROM billing_subscriptions WHERE provider='mercadopago' AND status IN ('active','trialing','past_due')` da **0** **y** no queda ningún tenant fuera de Colombia. **Nunca borrar el adapter MP**: los `billing_events` históricos y las facturas DIAN lo referencian | — |

**Total ~10-14 semanas** de trabajo efectivo (F0-F3 + F2b), más calendario de trámites en paralelo.

**Y el límite permanente, que no es una fase: mientras haya un solo tenant fuera de Colombia, MP no se apaga.**

---

## 10. Riesgos y modos de falla

| # | Riesgo | Mitigación | Residual |
|---|---|---|---|
| 1 | **Doble cobro por timeout de red** (sin `Idempotency-Key`) | `reference` única por `(cycle_key, attempt_number)`; cero retries HTTP en el POST; **el indeterminado nunca engendra otro attempt**; `sweepInFlight` resuelve por `GET /v1/transactions/{id}` | **ALTO Y ABIERTO**: sin `provider_txn_id` no hay forma documentada de preguntar "¿existe una transacción con esta reference?". **W6 es bloqueante de producción** |
| 2 | Doble cobro por cron duplicado (API + worker, mismo `AppModule`) | `UNIQUE(cycle_key, attempt_number)` — el CronLock **falla abierto**, no es la garantía | nulo |
| 3 | Doble liquidación webhook + polling | Ambos entran al mismo resolver; UPDATE guardado con rowcount=1; `provider_payment_id` UNIQUE | nulo |
| 4 | **Cobro fantasma** (cancelado, comp, plan ya cambiado) | Revalidación **en el processor**, no en el scheduler | bajo |
| 5 | **Deriva de fechas** | Período siguiente desde `period_end` teórico + `billing_anchor_day` original; clamp sin arrastre; nunca `now()` | bajo |
| 6 | Zonas horarias / DST | UTC en DB; zona del tenant solo para hora de cobro y conteo de días; `luxon`/`date-fns-tz` | bajo |
| 7 | **Deploy a mitad de ciclo** (el deploy migra ANTES de recrear contenedores) | Todo aditivo nullable/default; el motor arranca apagado (`engine='provider'` en todas las filas) y se activa **por tenant con un UPDATE, después** de que todo el fleet corre el código nuevo. **Rollout de datos, no de código.** `billing_cycle` en dual-write un deploy antes de leerlo | bajo |
| 8 | Worker caído horas → avalancha retroactiva | Attempts quedan `scheduled` y se re-encolan; guard de 36h → `stale` + incidente, no cobra | bajo |
| 9 | Redis pierde jobs | Redis ya es `noeviction`; y la cola **no es** la fuente de verdad | nulo |
| 10 | **Tarjeta vencida** (sin account updater, W3) | `exp_month/exp_year` al tokenizar + cron de aviso a 30 días + `failure_class='hard'` corta reintentos y pide medio nuevo | **medio, inherente** |
| 11 | Tope diario del comercio (W7) | Ancla por aniversario + jitter + acumulador Redis con corte al 80% + alerta | bajo |
| 12 | Precio COP flotando rompe firma y sorprende | `charge_amount_cents` congelado por ciclo | nulo (si D4 = fijo) |
| 13 | Doble factura DIAN | `attempt.payment_id` UNIQUE + `fiscal_invoices.payment_id` UNIQUE | nulo |
| 14 | **Nota crédito sin devolución real** | Refund inline deshabilitado para `refunds !== 'full'`; solo `void` de tarjeta en caliente; fuera de eso, reembolso manual registrado. **Nunca fingir éxito** | **ALTO**: es una capacidad que se pierde. Decisión de negocio, no técnica. **Verificar con abogado** si el derecho de retracto del Estatuto del Consumidor obliga a plazos que la API no permite automatizar |
| 15 | `credit_balance_cents` divergido del ledger | Cron diario recalcula `SUM(delta_cents)` y alerta | bajo |
| 16 | **Webhook perdido** (solo 3 reintentos en 24h) | Reconciliación por attempt (la de hoy, basada en `getSubscription`, **saltearía todas** las filas Wompi) | bajo |
| 17 | `acceptance_token` obligatorio en cada cobro (W4) | El campo ya está en `ChargeInput`; si es obligatorio, +1 `GET /v1/merchants/:pubkey` por cobro | **verificar en sandbox antes de dimensionar el cron** |
| 18 | **CSP desplegado después del front** | El CSP va **primero**, en su propio paso | bajo — pero es el error clásico "deployé el front y el pago no anda" |
| 19 | Migración forzada de MP → churn | Nunca forzar salvo contingencia; cohortes A/B/C; aviso por escrito antes | medio si se fuerza |
| 20 | **Wompi rechaza el alta igual que MP** | Nada técnico lo mitiga. Ver D0 en §12 | **ALTO hasta responder D0** |
| 21 | Habilitación comercial por método (W1) | Empezar por tarjeta; Nequi/Daviplata/Bancolombia en fases posteriores | medio |
| 22 | Visa en cobro recurrente sin traslado de responsabilidad (3RI solo Mastercard) | Medir tasa de contracargo por franquicia | medio, inherente |

---

## 11. Alternativas

| Opción | Recurrente nativo | Colombia | Medios locales | Veredicto |
|---|---|---|---|---|
| **MercadoPago** (actual) | **Sí** (Preapproval: agenda, cobra, reintenta) | Sí + AR/BR/MX/CL/PE/UY/EC | Tarjeta, PSE, Efecty, dinero en cuenta | **Se queda, sí o sí.** Es el único que cubre LatAm. Su problema es de **aprobación comercial**, no técnico |
| **Wompi** (Bancolombia) | **NO** — fuentes de pago + transacciones que dispara el comercio | Solo CO (+PA/SV, entidades y APIs distintas) | Tarjeta, **Nequi, Daviplata, Botón Bancolombia**, PSE, QR, corresponsales | **Aditivo para CO.** Aporta débito automático con billeteras y cuenta Bancolombia; desembolso siguiente día hábil; tarifa plana 2,65%+$700+IVA. Cuesta el motor propio |
| **Stripe** (adapter ya existe, sin uso) | Sí, **con prorrateo nativo** (`stripe.adapter.ts:122-133`) | **NO opera en Colombia** (LatAm: solo BR y MX) | — | **No resuelve Colombia.** La vía LLC/Atlas reabre el IVA de servicios digitales del exterior (`docs/facturacion-electronica-colombia-2026-06.md`) y rompe la FEV DIAN vía Factus |
| **ePayco** (Davivienda) | **Sí** — planes y suscripciones por API (crear/listar/editar plan, crear/consultar/cancelar suscripción, días de prueba), SDKs varios | Sí | Tarjeta, PSE, Daviplata, efectivo | **La alternativa más seria a evaluar.** Es el único además de MP con el ciclo del lado del proveedor. **No se investigaron tarifas, aprobación ni fiabilidad** — hueco de este informe |
| **PayU LATAM** | **NO** — Pagos Recurrentes **descontinuado** (la doc vive bajo `/deprecated/`); remite a Tokenización. Network Tokenization recurrente solo en Argentina | Sí | Tarjeta, PSE, efectivo | Mismo problema que Wompi, sin sus ventajas locales. Cualquier comparativa que lo ponga como "tiene suscripciones nativas" usa **doc deprecada** |
| **Bold** | **NO** — "estamos trabajando para tener más adelante APIs de pagos recurrentes"; exige que el comercio obtenga la aceptación previa por su cuenta | Sí | Tarjeta, PSE, Nequi | Mismo problema, menos maduro |
| **Treli** (comprar en vez de construir) | Sí — capa de suscripciones **sobre** Wompi/PayU/ePayco/Stripe/Place to Pay: scheduler, reintentos, recuperación por email y WhatsApp, multi-moneda | Sí | Los de la pasarela subyacente | **Opción real, no evaluada.** Descartarla sin mirarla es sesgo de "construir por defecto". Contras: meter un tercero en el flujo de cobro (los datos de facturación de los tenants pasan por él) y dependencia de roadmap ajeno. **Fuentes comerciales, no verificadas técnicamente** |

### ¿Por qué Wompi (o por qué no)

**A favor:**
- Es la respuesta directa al pedido: débito automático con Nequi, Daviplata y cuenta Bancolombia — medios que **MP no ofrece como mandato recurrente**.
- Desembolso al siguiente día hábil sin costo extra (en MP acreditar rápido cuesta comisión).
- Tarifa plana y publicada.
- Respaldo Bancolombia: confianza para el tenant colombiano.
- La `payment_links` API es un encaje perfecto para el cobro conversacional del tenant a su cliente (§8.5).

**En contra:**
- Cambia un trámite de aprobación (MP) por **otro trámite + un requisito bancario nuevo + hasta dos habilitaciones extra** (Daviplata, 3DS), con 3 meses de ingeniería en el medio.
- **No hay reembolso por API.**
- COP-only, CO-only → jamás puede ser reemplazo.
- El motor de recurrencia es nuestro para siempre, con su mantenimiento.
- La capacidad **genuinamente nueva** frente a MP se reduce a: recurrente con Nequi, Daviplata y cuenta Bancolombia. Tarjeta ya la tenés. **Cuánto vale eso depende de D1** (§12).

**La forma recomendada:** Wompi = proveedor **derivado del país** (CO), no un switch que el usuario elige. MP = todo lo demás y todos los vivos. Override manual solo super_admin con auditoría. Un solo checkout con dispatcher. **Y fecha de revisión a 6 meses**: si el share CO de Wompi supera un umbral y MP no aporta nada para CO, se deprecia MP **para CO**; si no, se apaga Wompi. **Paralelo permanente sin criterio de salida es la peor de las tres opciones.**

---

## 12. DECISIONES QUE NECESITAN AL DUEÑO

> Las dos primeras son **de gate**: pueden invalidar el proyecto entero. Contestarlas cuesta una llamada y una encuesta, y valen tres meses de ingeniería.

### D0 — ¿Cuál fue el motivo **exacto** del rechazo/traba de MercadoPago?
No hay una sola línea de diagnóstico en todo el material.
- **(a)** Actividad CIIU del RUT no coincide con lo declarado.
- **(b)** El sitio no expone T&C, política de datos, precios y política de reembolso visibles.
- **(c)** Documentación del representante legal.
- **(d)** Categoría de riesgo por "IA/automatización".
- **(e)** Otra / no lo sabemos.

**Recomendación:** conseguir la respuesta **antes de escribir código**. Wompi también hace verificación manual con derecho explícito a rechazar (Reglamento §4.3) y encima exige cuenta Bancolombia. **Si el motivo fue (a) o (b), Wompi choca con exactamente la misma pared** y se habrán gastado tres meses para nada. Si fue (a)/(b), arreglar eso y reintentar MP es 100× más barato que este proyecto.

### D1 — ¿Qué % del público objetivo de emprendedor (USD 21) y starter (USD 49) tiene tarjeta de crédito con cupo?
- **(a)** Tenemos el dato de los tenants actuales.
- **(b)** No lo tenemos, pero se lo preguntamos a los tenants activos esta semana.
- **(c)** No lo sabemos y decidimos a ciegas.

**Recomendación: (b), esta semana.** Es el **único número que decide el ROI**. Si el 85% tiene tarjeta, tres meses compran un 15% marginal → **no hacerlo**. Si es el 40%, Nequi recurrente es la diferencia entre tener negocio y no tenerlo → **hacerlo sin dudar**. Con (c) esto no es una decisión, es una apuesta.

### D2 — ¿Paralelo o reemplazo?
- **(a) Paralelo particionado por país** (CO → Wompi, resto → MP), con override super_admin y fecha de revisión a 6 meses.
- **(b) Paralelo con paridad total** y switch expuesto al tenant.
- **(c) Reemplazo.**

**Recomendación: (a).** (c) es técnicamente imposible sin renunciar a LatAm. (b) duplica superficie para siempre y este código ya no sostiene bien **ni un** proveedor (tres defaults silenciosos + un adapter muerto). Contraintuitivo pero cierto: **paralelo no es más caro que reemplazar**, porque el motor propio es obligatorio en ambos y reemplazar agrega migrar tenants vivos y perder los no colombianos.

### D3 — ¿Cuánto vale un tenant no colombiano a 12 meses?
- **(a)** Cero, Colombia es el 100% del foco.
- **(b)** 20-40% del pipeline.
- **(c)** Es la tesis de crecimiento.

**Recomendación:** cualquiera que sea, la respuesta operativa es la misma (**MP no se apaga**), pero (a) permitiría después deprecar MP para CO y ahorrar mantenimiento. Registrarla por escrito para que la revisión a 6 meses tenga criterio.

### D4 — Precio en COP: ¿fijo o flotante?
- **(a) Precio COP nominal por plan, fijado por super_admin, congelado al alta y revisado 1-2 veces al año.**
- **(b)** Convertir USD→COP a tasa del día en cada renovación.
- **(c)** Convertir y congelar por ciclo de contratación.

**Recomendación: (a).** Wompi es COP-only y **el monto entra en la firma de integridad**. Con (b) el monto cambia cada mes, cambia la firma, se rompe el supuesto COF de "valores fijos" del flag `recurrent:true`, y el tenant ve un precio distinto cada ciclo. (c) es aceptable como punto medio. Con cualquiera hay que revisar el margen: el fijo de $700+IVA lleva el plan emprendedor a **~4,1% efectivo**.

### D5 — ¿La compra de créditos SMS y `tenant-payments` (D3) entran en el alcance?
- **(a)** Ninguno: se quedan en MP.
- **(b)** Solo `tenant-payments`.
- **(c)** Los dos.

**Recomendación: (b).** SMS está **apagado por decisión del dueño**, así que no urge (pero queda anotado: si algún día se apaga MP, `sms-checkout.service.ts` se queda sin checkout). `tenant-payments` con **links de pago Wompi** es la porción de mayor retorno y menor riesgo de todo este proyecto: Nequi y PSE convierten mucho mejor que tarjeta con el cliente final colombiano, y no depende de que Wompi nos apruebe a nosotros ninguna capacidad recurrente.

### D6 — ¿Se arregla el agujero de conversión trial → pago del mismo plan?
- **(a) Sí, primero, antes que cualquier proveedor.**
- **(b)** Junto con Wompi (Fase 3).
- **(c)** Después.

**Recomendación: (a).** Hoy un tenant en trial del plan X **no tiene ningún botón para empezar a pagar el plan X** (`same_plan` + trial local + card token descartado + `past_due` a los 7 días). Es probablemente la fuga de plata más cara del producto, **es independiente del proveedor**, y se arregla en días, no en meses. Cambiar de pasarela cuando nadie puede convertir un trial es cambiar la cerradura de una puerta sin picaporte.

### D7 — ¿Qué pasa con Stripe?
- **(a)** Se borra el adapter (código muerto; Stripe no opera en Colombia).
- **(b)** Se conserva para clientes internacionales vía LLC, asumiendo el IVA de servicios digitales del exterior.

**Recomendación: (b) pero congelado y marcado**, o (a) si en 6 meses no hay plan concreto de internacionalización. Cada generalización (ids de plan, capacidades, checkout, i18n) cuesta distinto según la respuesta: con (a) el diseño contempla 2 proveedores, con (b) contempla 3.

### D8 — ¿Construir el motor o evaluar comprarlo (Treli)?
- **(a) Construir** (todo lo diseñado en §5).
- **(b)** Evaluar Treli 1 semana antes de decidir.
- **(c)** Comprar.

**Recomendación: (b), timeboxed a una semana**, en paralelo a la Fase 0 (que se hace igual en los tres escenarios). Construir da control total, encaja con la infra existente (BullMQ, crons, `CronLockService`) y arregla de arrastre problemas propios (prorrateo, el bug del create→cancel, el agujero de conversión). Pero descartar "comprar" sin mirarlo es sesgo. Contras a pesar: un tercero en el flujo de cobro ve los datos de facturación de los tenants, y la FEV DIAN vía Factus tendría que engancharse a **sus** eventos, no a los nuestros.

### D9 — ¿Modelo Agregador o Gateway con Wompi?
- **(a) Agregador** (default; el comercio asume la calidad tributaria de Wompi: reteFuente ~1,5%, reteIVA 15%, reteICA 0,02%).
- **(b) Gateway** (sin comisión Wompi, tarifas negociadas con Bancolombia; dirigido a >2.000 tx/mes; exige código único de ventas no presentes y/o código ACH en oficina con ejecutivo MIT).

**Recomendación: (a) para empezar.** No se puede estar en los dos a la vez (sí migrar). Con el volumen actual, Gateway no califica y su trámite es más pesado. Revisar cuando se superen 2.000 tx/mes. Consultarlo con el contador junto con el impacto de las retenciones en el arqueo (**lo desembolsado ≠ lo facturado**).

---

## 13. Fuentes

### Documentación técnica de Wompi Colombia (`docs.wompi.co`)
- `/en/docs/colombia/ambientes-y-llaves/` — 4 secretos por ambiente, URLs base
- `/docs/colombia/inicio-rapido/` — índice completo (**no hay sección de suscripciones ni planes**)
- `/en/docs/colombia/transacciones/` — `POST /v1/transactions`, `GET /v1/transactions/{id}`, **`POST /v1/transactions/{id}/void`**, tabla de requeridos
- `/en/docs/colombia/seguimiento-de-transacciones/` — 5 estados, `VOIDED` solo tarjeta
- `/en/docs/colombia/metodos-de-pago/` — 10 códigos, campos de PSE, tokenización de tarjeta, métodos que exigen polling de URL
- `/en/docs/colombia/fuentes-de-pago/` — **CARD/NEQUI/DAVIPLATA/BANCOLOMBIA_TRANSFER**, cobro contra `payment_source_id`, `void`, flag COF `recurrent`, modo `tokenize` del widget
- `/en/docs/colombia/fuentes-de-pago-3ds/` y `/fuentes-de-pago-3ds-sandbox/` — 3DS, **3RI solo Mastercard**, activación por el equipo de fraude
- `/en/docs/colombia/transacciones-con-3d-secure-v2/` — `is_three_ds`, `browser_info`, challenge por iframe
- `/en/docs/colombia/tokens-de-aceptacion/` — **dos** tokens, `GET /merchants/:public_key`, JWT con `exp`/`jit`/`file_hash`
- `/docs/colombia/eventos/` (**ES — fuente canónica para el checksum**) vs `/en/docs/colombia/eventos/` (**omite `environment` y el `timestamp` de primer nivel**) — 3 eventos, 3 reintentos en 24h, `X-Event-Checksum`
- `/en/docs/colombia/widget-checkout-web/` — firma de integridad, **"The only currency currently available is COP"**, retorno `?id=`
- `/en/docs/colombia/links-de-pago/` — `POST /v1/payment_links`
- `/en/docs/colombia/datos-de-prueba-en-sandbox/` — tarjetas, Nequi, PSE y OTPs deterministas
- `/en/docs/colombia/reintento-de-pago/` — dos transacciones por misma `reference`, ventana de 3 min (**documentado para checkout; no demostrado para API contra `payment_source_id`**)
- `/en/docs/colombia/js/` — `sessionId` antifraude (**marcada como deprecada**)
- `/en/docs/colombia/eventos-breb/` — Bre-B es **dispersión (payouts)**, no recaudo

### Comercial y soporte de Wompi
- `wompi.com/es/co/planes-tarifas/` — **2,65% + $700 + IVA**, QR 1%, PCOL 4,43%, Plan Gateway, desembolso siguiente día hábil
- `soporte.wompi.co/.../360020957133` — mismas tarifas (act. 7-ene-2026)
- `soporte.wompi.co/.../360020766034` — cortes de desembolso (PSE/Nequi 23:59, tarjetas 20:00, BINes hasta 72h)
- `wompi.com/es/co/ayuda/como-crear-cuenta` — requisitos PN/PJ
- `soporte.wompi.co/.../360056658413` — **cuenta Bancolombia obligatoria**
- `soporte.wompi.co/.../360020955173` — topes por transacción y proceso de aumento
- `soporte.wompi.co/.../360020767434`, `.../25979176476179` — topes diarios (**vía resumen de búsqueda, verificar en el panel**)
- `soporte.wompi.co/.../360020775954`, `.../360035840193`, `.../10949535171731`, `.../360035685793` — Agregador vs Gateway
- `soporte.wompi.co/.../1500009269162`, `.../1500009269082`, `.../26945369288851` — reteFuente, reteIVA, reteICA
- `soporte.wompi.co/.../1500009267462` — impuestos en reembolsos y anulaciones
- `soporte.wompi.co/.../4402141474451`, `.../360020959673` — contracargos, 5 días hábiles, **fondos bloqueados**
- `soporte.wompi.co/.../360042975693` — tarjetas internacionales, siempre en COP (act. 2020)
- `soporte.wompi.co/.../30506232828435` — **TRAMPA**: "débitos automáticos" ahí es Bancolombia debitando la cuenta **del comercio** (SPT/recaudos), no recurrencia de suscripciones
- `wompi.com/.../tokenizacion` — recurrencia en lenguaje comercial; nombra **solo tarjeta y Nequi** como tokenizables (desfase 2-vs-4 con la doc técnica)
- `wompi.com/assets/downloadble/reglamento-Comercios-Colombia.pdf` (V3-2025) — §4.3 rechazo/suspensión, §6.5 primer desembolso PN, §12.1 uso en nombre de terceros, §12.8 actividades restringidas (**SaaS no está; inmobiliarias sí**)
- `wompi.com/es/pa/...` y `docs.wompi.sv/` — **TRAMPA**: Wompi El Salvador **sí** tiene enlace de pago recurrente nativo; es otra entidad y **no aplica a Colombia**

### Alternativas
- `docs.epayco.com/docs/descripcion-general-4`, `/docs/planes` — **suscripciones nativas por API**
- `developers.payulatam.com/latam/es/deprecated/recurring-payments/…` — **recurrentes descontinuado**
- `developers.payulatam.com/latam/es/docs/services/networktokenization.html` — recurrente solo Argentina
- `bold.co/pagos-en-linea/api/pagos-en-linea`, `bold.co/legal/comercios-pagos` — sin API de recurrentes
- `stripe.com/global` — **Colombia no figura**; LatAm solo BR y MX
- `treli.co/debito-automatico-con-wompi/`, `treli.co/cobra-con-wompi-en-dolares-y-otras-monedas/` — capa de suscripciones sobre Wompi (**fuente comercial de tercero, sin verificar**; y lo que llaman "PSE" es en realidad `BANCOLOMBIA_TRANSFER`)

### Código de este repo
`billing/adapters/payment-provider.interface.ts:38-141` · `billing/payment-provider.factory.ts:18-29` · `billing/types/provider-types.ts:9` · `billing/billing.service.ts:96-233, 130, 138, 239-361, 246-249, 279-330, 303-315, 368-405, 437-547, 553-583, 595-687, 700-737, 808-905, 949-961, 1004-1123, 1212-1246, 1271-1318, 1330-1363` · `billing/webhook.controller.ts:45-119, 57-63` · `billing/adapters/mercadopago.adapter.ts:48-60, 76-91, 100-101, 267-292, 353-365, 478-601, 726-740` · `billing/adapters/stripe.adapter.ts:122-133` · `billing/processors/reconciliation.processor.ts:70-217, 86, 143, 227` · `billing/billing-admin.controller.ts:9, 97, 272-370` · `billing/billing-plan-display.util.ts:18-29` · `billing/sms-checkout.service.ts:4,19,44,49,103` · `billing/coupons.service.ts:1-26` · `billing/billing.module.ts:37-56` · `modules/fiscal/fiscal-invoice.service.ts:45-148` · `modules/offboarding/offboarding-cron.service.ts:27-90, 99-181` · `modules/tenant-payments/tenant-payments.service.ts:5-16` · `modules/health/platform-monitor.service.ts:642-707` · `prisma/schema.prisma:39, 43, 108, 278-301, 424` · `prisma/seed-billing-plans.js:44, 49-52, 150, 155-157, 250, 255-257, 349, 354-356, 544-613` · `dashboard/src/components/billing/MpCardForm.tsx` · `dashboard/src/app/admin/settings/billing/page.tsx:111-123, 236-262, 276-286, 288-348, 350-366, 537, 595, 639-697, 1161-1322` · `dashboard/src/app/admin/plans/page.tsx:104, 160-174, 364-393, 552-590, 681-720` · `dashboard/src/app/admin/settings/integrations/payments/page.tsx` · `dashboard/src/app/onboarding/page.tsx:21, 1027-1094` · `dashboard/src/lib/api.ts:1049-1092, 1177-1191, 1260-1321` · `infra/nginx/nginx.conf:38` · `.github/workflows/deploy.yml:245, 582-586`

### Docs internos relacionados
`docs/billing-annual-cycle.md` · `docs/billing-runbook.md` · `docs/billing-mp-setup.md` · `docs/facturacion-electronica-colombia-2026-06.md` · `docs/plan-profitability-2026-07.md` · `docs/deploy-hardening-runbook.md` (§6 expand-contract) · `docs/superadmin-governance.md` · `docs/operations-runbook.md`
