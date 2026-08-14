# Wompi + operador conmutable + geo-routing — Plan de implementación (Ago 2026)

**Fecha:** 12-ago-2026 · **Actualizado:** 13-ago-2026
**Estado: PLAN DE CÓDIGO COMPLETO.** F0 ✅ (§10) · F1 ✅ *verificada contra el sandbox real* (§11) · F2 ✅ (§13) · F3 ✅ (§14) · F4 = operación (§15), sin código pendiente.
**Rama:** `feat/wompi-provider-routing` sobre `main` — **sin mergear** (mergear = desplegar).
**Verificación global:** `tsc` limpio en API y dashboard · **190 suites / 1.605 tests** · `test:bootstrap` PASSED · paridad exacta de i18n en 4 idiomas.
**Base de diseño:** `docs/pasarela-wompi-research-2026-08.md` (905 líneas — el diseño técnico detallado del motor, el switch L0-L3 y el mapeo de Wompi vive ahí; este plan lo convierte en ejecución con las decisiones del dueño tomadas). Contexto de negocio: `docs/merchant-of-record-research-2026-08.md`.
**Radiografía de código:** workflow 6 agentes (12-ago-2026), hallazgos archivo:línea citados abajo.

---

## 1. Decisiones del dueño (12-ago-2026) — cierran las preguntas abiertas de la investigación

| # | Decisión | Resuelve |
|---|---|---|
| 1 | **Wompi YA, sin seguir esperando a MP.** Semanas sin respuesta del caso; la cuenta Wompi **ya está creada** | D0 (riesgo de rechazo aceptado; el alta ya pasó) |
| 2 | **Solo lo self-service de Wompi.** Cero reuniones/activaciones comerciales | Alcance de métodos (§3) |
| 3 | **Operador conmutable por país en runtime** — volver a MP (o pasar a otro) debe ser "como activar un botón", sin deploy | D2 = paralelo particionado por país con switch |
| 4 | **Geo-routing preparado**: el sistema distingue tenant Colombia vs exterior; a futuro Stripe/MoR cobra al exterior y el riel colombiano a los locales | D3/D7 = Stripe se conserva congelado; el diseño contempla N providers |
| 5 | **DIAN por matriz** (§5): Colombia → FEV Factus como hoy; exterior → según quién venda (S.A.S. = FEV exportación; LLC/MoR = recibo, sin FEV al cliente) | Requisito nuevo del dueño |
| 6 | Motor de cobros **propio** (construir, no comprar Treli) — coherente con "solo lo que brinda Wompi" | D8 |
| 7 | Modelo **Agregador** (self-service; Gateway exige trámite con ejecutivo) | D9 |
| 8 | Precio **COP fijo por plan** (ya es así en `billing_plans`) | D4 |
| 9 | El **agujero trial→pago del mismo plan se arregla en este proyecto** (sin eso, nadie puede empezar a pagar con ningún proveedor) | D6 |
| 10 | SMS checkout queda en MP (SMS está apagado); `tenant-payments` con links Wompi = backlog opcional post-v1, no bloquea | D5 |

**Pendiente recomendado (no bloquea el arranque):** encuesta a tenants sobre % con tarjeta de crédito (D1) — decide cuánto priorizar Nequi tras el go-live de tarjetas.

## 2. Arquitectura resultante (visión de una página)

```
Alta / upgrade / renovación
        │
        ▼
PaymentRoutingService (NUEVO)                 platform_settings (runtime, sin deploy)
  L0 kill-switch  billing.providers_enabled   {"mercadopago":true,"wompi":false,"stripe":false}
  L1 país         billing.default_provider_by_country   {"CO":"wompi","*":"mercadopago"}
  L2 tenant       Tenant.paymentProvider      (override super_admin, motivo + audit)
  L3 suscripción  billing_subscriptions.provider  ← MANDA SIEMPRE (de por vida)
        │
        ▼
PaymentProviderFactory (sin default silencioso)
  ├─ capabilities.nativeSubscriptions=true  → MP / Stripe: camino actual (el proveedor agenda y cobra)
  └─ capabilities.nativeSubscriptions=false → Wompi: MOTOR PROPIO billing/recurring/
       scheduler (@Cron cada 10min, CronLock, solo AGENDA) → cola billing-renewals
       → processor (reserva optimista + revalidación + cobro POST /transactions PENDING)
       → cola billing-charge-poll + webhook transaction.updated → MISMO resolver
       → settleAttempt() → PAYMENT_SUCCEEDED normalizado
                              │
                              ▼
                 Fiscal (SIN CAMBIOS en v1): FiscalProviderFactory
                   CO → Factus FEV DIAN  ·  exterior → matriz §5 (fase EXT)
```

El interruptor por país es **config, no código**: encender Wompi para CO = editar `billing.default_provider_by_country` desde la pestaña nueva de `/admin/plans`. Si MP se desbloquea en un mes, volver = el mismo botón. Las suscripciones vivas **nunca** cambian de proveedor por el switch (L3): solo las altas nuevas.

## 3. Alcance de métodos v1 (restricción "solo self-service")

| Método | v1 | Por qué |
|---|---|---|
| **Tarjeta (`CARD`)** | ✅ Núcleo | 100% self-service: tokenización con llave pública (widget `tokenize`), fuente de pago, cobro con `payment_source_id` + `recurrent:true`. Sin 3DS (3DS/3RI exige equipo de fraude → fuera; hook preparado) |
| **Nequi (`NEQUI`)** | ✅ Fast-follow (flag) | Self-service CON un paso manual del dueño: activar "Suscripciones aliado Wompi" en negocios.nequi.co (portal autogestionado, sin ejecutivo). Token PENDING → push app → APPROVED (webhook `nequi_token.updated`) |
| **Botón Bancolombia (`BANCOLOMBIA_TRANSFER`)** | ⚙️ Flag apagado | La doc no exige habilitación → probar empíricamente en producción con monto mínimo; encender si funciona. Solo clientes Bancolombia |
| Daviplata | ❌ | Requiere activación comercial (violaría la restricción) |
| PSE recurrente | ❌ | No existe (PSE no es tokenizable). PSE queda solo como pago único futuro (patrón link, post-v1) |
| 3DS / 3RI | ❌ v1 | No self-service. Riesgo aceptado: sin liability shift en recurrentes (3RI solo cubría Mastercard igual) |

Cada método vive detrás de `platform_settings` `billing.wompi_methods_enabled` `{"card":true,"nequi":false,"bancolombia_transfer":false}` — mismo patrón del kill-switch, activable sin deploy cuando la prueba empírica pase.

## 4. Las verificaciones empíricas que reemplazan a las "9 preguntas a Wompi"

La investigación dejaba 9 preguntas por escrito (W1-W9). La restricción self-service las convierte en **pruebas y consultas de panel** (sin depender de respuestas de nadie):

| # | Verificación | Cómo | Fase |
|---|---|---|---|
| W4 | ¿`acceptance_token` obligatorio en cada cobro contra fuente? | **Resuelto por diseño**: fetch fresco de `GET /v1/merchants/{pub}` antes de cada cobro (barato, JWT expira igual). Confirmar en sandbox que funciona con y sin | F1 |
| W6 | Idempotencia ante timeout: ¿misma `reference` duplica? | Sandbox: simular timeout (cortar antes de leer respuesta) + `GET /v1/transactions?reference=X` como red de rescate (el filtro por `reference` EXISTE en el API de consulta — hallazgo nuevo de la radiografía) | F1 ⛔ gate |
| W1 | ¿Card/Nequi/Bancolombia recurrentes exigen habilitación? | Probar en sandbox → probar en producción con cobro real de $1.500 (mínimo). Flags por método permiten degradar sin deploy | F1/F4 |
| W7 | Topes diarios reales del comercio | Leer en el panel comercios.wompi.co. Referencia pública Agregador PJ: $10M COP/tx, $80M/día, mínimo $1.500 | Checklist dueño |
| W3 | ¿Account updater de tarjetas? | Asumir que NO (ni una línea en la doc): cron de aviso a 30 días del vencimiento va en F2 | F2 |
| W9 | ¿La fuente de pago caduca? | Observar en sandbox + campo `status` en cada cobro; `failure_class='hard'` si viene VOIDED | F2 |
| W2 | ¿Qué procesador asignan (afecta flag COF)? | `recurrent:true` se manda siempre en renovaciones de monto fijo; si el procesador no es RBM lo ignora sin romper | F1 |
| W5 | ¿Trámite de reembolso post-liquidación? | Confirmado: NO hay API (solo `void` de tarjeta pre-liquidación). El refund inline se degrada por capability (§7 fase F0) | Diseño |
| W8 | Rate limits | No documentados; el scheduler ya escalona por aniversario + jitter + concurrency 4 | F2 |

**⚠️ Tope por transacción vs plan anual (hallazgo nuevo, acción del dueño):** Enterprise anual ≈ **COP 18.255.960** supera el tope Agregador PJ de **$10M COP/transacción**. Starter/Pro anual (2,8M / 7,7M) pasan. Acción: pedir ampliación de tope por soporte (trámite de panel, hasta 3 días hábiles — no es reunión) **o** gatear el ciclo anual de Enterprise fuera de Wompi hasta ampliarlo. Verificar también que la cuenta quedó registrada como **persona jurídica** (la natural topea $2,5M/tx → mataría Starter anual, y difiere el primer desembolso 30 días).

## 5. Matriz fiscal DIAN (requisito del dueño)

**Regla de oro: mientras venda la S.A.S., SIEMPRE hay factura electrónica DIAN — lo que cambia es el tipo.** Solo cuando venda otra entidad (LLC o MoR) el cliente deja de recibir FEV.

| Comprador | Entidad que cobra | Documento al cliente | Estado en el código |
|---|---|---|---|
| Tenant CO | S.A.S. vía **Wompi/MP** | **FEV DIAN (Factus)** — IVA excluido cloud computing, igual que hoy | ✅ **Cero cambios en v1.** `fiscal-invoice.service.ts` escucha `PAYMENT_SUCCEEDED` normalizado; el motor emite el mismo evento con `providerPaymentId` → Factus factura sin tocar una línea. `attempt.payment_id UNIQUE` garantiza una factura por cobro |
| Tenant exterior | S.A.S. directa (Stripe futuro) | **FEV de exportación** (obligatoria, Res. 000165/2023; adquirente genérico `222222222222`, país del comprador, IVA exento art. 481 + Dec. 2223/2013) | 🔨 Fase EXT: hoy `FiscalProviderFactory` con `CO_LOCAL` devuelve `null` para país ≠ CO ("skip"). Hay que agregar la rama de exportación en el adapter Factus (tipo de operación exportación — **verificar soporte en Factus** + concepto del contador ANTES de activar el riel exterior) |
| Tenant exterior | **LLC o MoR** | **Sin FEV al cliente**: recibo comercial del emisor (`UsRemoteAdapter`, ya implementado). La S.A.S. emite FEV de exportación **a la LLC/MoR por liquidación/payout** (proceso mensual, inicialmente manual) | ⚙️ El modo `US_REMOTE` ya existe pero es **global**; en el futuro híbrido (CO directo + exterior vía LLC) el factory debe rutear **por pago** (país+entidad), no por modo global. Diseño en Fase EXT |

**Consecuencia de diseño (v1):** el mismo dato — `Tenant.billingCountry` — alimenta el routing de pasarela Y el routing fiscal. Por eso la Fase 0 incluye endurecer ese campo (una sola lista de países, backfill de NULLs, 'CO' como resultado explícito y no como fallback silencioso).

## 6. Prerrequisitos del dueño (no-código, arrancan YA en paralelo)

1. **Cuenta Wompi**: completar activación de producción si falta (RUT, cédula rep. legal, certificación bancaria de cuenta **Bancolombia a nombre del NIT** — única entidad de desembolso —, cámara de comercio). Confirmar registro como **persona jurídica**.
2. **Secretos: son CUATRO, con estos nombres exactos** — `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_SECRET`, `WOMPI_INTEGRITY_SECRET`. No hay pares sandbox/producción ni sufijos: **el prefijo del valor decide el ambiente** (`pub_test_`→sandbox, `pub_prod_`→producción) y de ahí sale la URL base.
   - **Cargar ahora las de SANDBOX.** El servidor las necesita durante F2 y F3 (las pruebas corren en producción, no en local); cargar las de producción antes de tiempo pondría el adapter en modo real mientras se prueba.
   - **El go-live es un cambio de VALOR sobre esos mismos cuatro secretos**, no un rename. Mezclar una llave de test con una de producción deshabilita el adapter entero — es deliberado.
   - Configurar la **URL de eventos** en el panel de Wompi, una por ambiente: `https://api.parallly-chat.cloud/api/v1/billing/webhook/wompi`.
3. Verificar **topes** del comercio en el panel; pedir ampliación a >$18,3M/tx si se quiere Enterprise anual por Wompi.
4. Nequi Negocios: activar **"Suscripciones aliado Wompi"** (portal autogestionado) — desbloquea el fast-follow de Nequi.
5. (Recomendado, D1) Encuesta corta a tenants: ¿tarjeta de crédito disponible para pagos recurrentes?

## 7. Fases de ejecución (file-by-file)

Regla transversal: **expand-contract** (deploy migra antes de recrear contenedores — solo cambios aditivos por deploy), verificación `tsc` + `test:bootstrap` + i18n ×4 en cada tanda, y **stagear rutas explícitas** (otra sesión trabaja el mismo working tree — nunca `git add -A`).

### F0 — Higiene del ruteo + switch (SIN Wompi, desplegable sola, riesgo cero) — ~1-1,5 sem

La fase que convierte "cambiar de operador" en un botón. Con Wompi apagado, producción se comporta EXACTAMENTE igual.

| Archivo | Cambio |
|---|---|
| `billing/types/provider-types.ts:9` | `PaymentProviderName` += `'wompi'` |
| `billing/payment-provider.factory.ts:27` | **Quitar `default: mercadoPagoAdapter` → `throw BadRequest 'unknown_payment_provider'`** (mismo commit que el union). Agregar `capabilitiesOf()` y `getCharging()` |
| `billing/adapters/provider-capabilities.ts` | **NUEVO** — `ProviderCapabilities` (nativeSubscriptions, refunds:'full'\|'void_only'\|'none', asyncSettlement, currencies, unattendedMethods, requiresAcceptanceTokens…) |
| `billing/adapters/{mercadopago,stripe,mock-payment-provider}.adapter.ts` | Solo agregar `readonly capabilities` |
| `billing/billing.service.ts:162,371,1060` (y 279-330, 512-547, 949-961) | Las ramas `=== 'mercadopago'` pasan a ramas por **capacidad**; `grantCompPlan` toma provider del router |
| `billing/billing.service.ts:1417-1421` | `resolveProviderPlanId` → `resolveProviderPricing(plan, provider, country, cycle)` que devuelve `{providerPlanId?, amountCents, currency}`; **fuera el `else {id='mock-plan'}` silencioso** (throw) |
| `billing/billing.service.ts:1440-1448` | `assertProviderConfigured` por provider (deja de validar solo MP) |
| `billing/billing.service.ts:303-315` | Compensación del upgrade create→cancel (bug actual: si el cancel falla quedan dos suscripciones cobrando) |
| `billing/payment-routing.service.ts` | **NUEVO** — L0-L3 con la **polaridad asimétrica** del diseño (wompi ausente→apagado fail-closed; mercadopago ausente→encendido fail-open) y resolución `sub.provider → tenant.paymentProvider → país → "*" → filtro L0 → BadRequest 'no_payment_provider_available'`. Config por servicio propio calcado de `FiscalConfigService` (claves planas `billing.*`, cache Redis 5 min, `redis.del` al escribir). **NO usar `SettingsService`** — su allowlist de categorías rechaza `billing.*` en silencio (settings.service.ts:58-61) |
| `billing/billing-admin.controller.ts` | Endpoints: `GET/PUT /billing-admin/providers` (L0+L1, guard super_admin, audit), `PUT /billing-admin/tenants/:id/payment-provider` (L2: **motivo obligatorio + actor real + 409 si hay sub viva** salvo `force`), `GET /billing-admin/providers/status` genérico `{mercadopago:{...}, wompi:{...}}` (mantener la clave `mercadopago` un deploy — `/admin/plans` la consume en plans/page.tsx:223) |
| País (mismo dato para pasarela y DIAN) | Unificar las **dos listas divergentes** (DTO onboarding valida 17 vs fiscal PATCH valida ~55): una sola fuente en `billing-country.util.ts`. Backfill de `billing_country` NULL (migración aditiva `UPDATE ... WHERE billing_country IS NULL` desde `language.split('-')[1]` con default 'CO'). El resolver trata **'CO' como resultado positivo explícito** y loguea cuando cae por fallback |
| `billing/billing-plan-display.util.ts:18-20` + `billing-public.controller` + `billing.controller` | `annualAvailable: boolean` calculado en backend (hoy el toggle anual del dashboard se gatea con `mpPlanIdAnnual` → con Wompi desaparecería sin error). `mpPlanIdAnnual` queda deprecado un deploy |
| `platform-monitor.service.ts:642-707` | Contadores de webhook **por proveedor** (`billing:webhook:fail:{provider}:{kind}:{día}`) + texto de alerta parametrizado |
| Dashboard `/admin/plans` | **Pestaña nueva "Proveedores"** (TabNav ya usado en billing-ops; una pestaña NO toca roles.ts/navigation-contract/sidebar — una página nueva rompe 2 specs). Switch L0 por proveedor + select L1 por país + estado de credenciales por ambiente. i18n ×4 |
| Frontend llave pública | **`GET /billing/public-config`** (NUEVO, público): `{provider, publicKey, environment}` resuelto por routing — la llave deja de hornearse en el build (`NEXT_PUBLIC_MP_PUBLIC_KEY` es build-arg en Dockerfile.dashboard:31/38; con eso el switch jamás sería runtime). `MpCardForm` migra a leerla de ahí |
| **Trial→pago del mismo plan (D6)** | Quitar el rechazo `'same_plan'` cuando la sub está `trialing` (billing.service.ts:246-249) + botón "Activar plan" en el dashboard. Con MP nativo: crea el preapproval al convertir. (Con Wompi, F3 reusa este mismo camino) |

**Gate F0:** en producción con Wompi apagado, una renovación real MP + un upgrade + un webhook se procesan sin cambio de comportamiento; la pestaña muestra el switch; `tsc` + `test:bootstrap` + `billing.service.spec` + `billing-plan-display.util.spec` (bloquean deploy) verdes.

### F1 — Adapter Wompi + webhook, cerrado en sandbox — ~1,5-2 sem

| Pieza | Detalle |
|---|---|
| `billing/adapters/wompi-config.service.ts` | **NUEVO**, molde `MercadoPagoConfigService`: lee `WOMPI_PUBLIC_KEY/WOMPI_PRIVATE_KEY/WOMPI_EVENTS_SECRET/WOMPI_INTEGRITY_SECRET`; base URL derivada del prefijo de la llave (`pub_test_`→sandbox) con validación prefijo↔ambiente; si faltan → WARN sin reventar el boot |
| `billing/adapters/charging-provider.interface.ts` | **NUEVO** `IChargingProvider`: `getAcceptanceContracts()`, `startPaymentSource()`, `pollPaymentSourceAuth()`, `voidPaymentSource()`, `charge()`, `getCharge()`, `getChargeByReference()` (rescate W6 vía `GET /v1/transactions?reference=`), `voidCharge()`, `createCheckoutLink()` |
| `billing/adapters/wompi.adapter.ts` | **NUEVO** `implements IChargingProvider, IPaymentProvider`. Los métodos sin contraparte (createPlan, changeSubscriptionPlan, pause/resume, getSubscription, listCustomerSubscriptions, refundPayment) tiran `NotImplementedException` **ruidosa**. Firma de integridad `SHA256(reference+amount_in_cents+currency[+expiration_time]+integrity_secret)` en cada charge. `recurrent:true` solo en renovaciones de monto fijo; `false` en prorrateos (Stored COF) |
| `billing/webhook.controller.ts:57-63` | Allowlist += `'wompi'` (NO gateado por L0 — un proveedor apagado sigue teniendo subs vivas). Contexto de firma ampliado `{dataId?, rawBody, headers}`. Checksum: `SHA256(valores de signature.properties EN ORDEN — leídos del payload, no hardcodeados — + timestamp + events_secret)` vs `X-Event-Checksum`, `timingSafeEqual`, fail-closed 401. Validar `environment` test/prod contra el configurado. Idempotencia sintética `${event}:${transaction.id}:${transaction.status}` (Wompi no manda event id; TTL 48h ya cubre sus 3 reintentos/24h). **Fuente canónica del formato: doc en ESPAÑOL** (la inglesa omite `environment` y `timestamp`) |
| `billing/types/billing-event.enum.ts` | += `PAYMENT_METHOD_AUTHORIZED`, `PAYMENT_METHOD_DECLINED` (aditivo) — para `nequi_token.updated`/`bancolombia_transfer_token.updated` |
| Resolución de suscripción | La cascada actual (`providerSubscriptionId → tenantId → payerEmail`) suma **`reference` parseable** (`sub_{sub8}_{YYYYMMDD}_{n}`) y `payment_source_id` |
| Envs/secrets | GitHub Secrets ×8 + **los TRES lugares de deploy.yml** (env del step ~:600, lista `envs:` ~:668, `echo >> .env` ~:793) + `WOMPI_WEBHOOK_URL`. El **worker** también necesita el integrity secret (cada cobro se firma). `.env.example` documenta el bloque |
| CSP / widget | Verificar dónde se aplica el CSP real (en prod **no hay nginx** — Cloudflare Tunnel rutea directo; `infra/nginx/` es config muerta): si el CSP vive en headers de Next o no existe, ajustar para permitir `checkout.wompi.co` (script/frame) y `sandbox/production.wompi.co` (connect) ANTES de la F3 |
| Tests | Spec del adapter con fixtures del sandbox (tarjeta 4242 APPROVED / 4111 DECLINED), spec del checksum de eventos con el ejemplo oficial de la doc ES, spec de firma de integridad |

**Gate F1 (sandbox):** ciclo completo — acceptance tokens → tokenizar 4242 → payment source AVAILABLE → charge PENDING → webhook firmado verificado → `billing_event` insertado → `PAYMENT_SUCCEEDED` emitido → factura Factus sandbox creada. Y la **prueba W6**: timeout simulado + rescate por `getChargeByReference` sin doble cobro.

### F2 — Motor de recurrencia (el 80% del trabajo) — ~4-5 sem

Implementación completa según §5 del doc de investigación (datos, scheduler, processor, dunning, prorrateo — el diseño ya está escrito; no se re-especifica acá). Puntos de anclaje:

- **Migración aditiva**: tablas `billing_payment_sources`, `billing_charge_attempts` (ledger central, `UNIQUE(cycle_key, attempt_number)` = LA garantía anti-doble-cobro), `billing_credit_ledger`; columnas nuevas en `billing_subscriptions` (`engine` default `'provider'` = interruptor apagado, `next_charge_at`, `billing_anchor_day`, `dunning_state`…) y `provider_plan_ids` en `billing_plans` (precio congelado por país×ciclo — Wompi no tiene catálogo). `billing_cycle` en dual-write un deploy antes de leerse de columna.
- **Colas nuevas** `billing-renewals` + `billing-charge-poll` (BillingModule hoy NO registra ninguna cola — registrarlas + processors). Jobs con `jobId = attempt.id` (uuid **sin `:`** — incidente conocido de BullMQ), `attempts: 1` (un retry de BullMQ sobre un POST no idempotente = doble cobro).
- **Cron** `@Cron('*/10 * * * *')` con `CronLockService.runExclusive` (todo @Cron corre DOS veces — API y worker) — pero la garantía es el UNIQUE, no el lock (falla abierto). El cron **solo agenda**; jitter por aniversario (nunca todos el día 1); acumulador Redis contra el tope diario con corte al 80% + incidente.
- **Processor**: reserva optimista → revalidación anti-cobro-fantasma al cobrar → guard de tardanza 36h (`stale`, no cobra) → charge con timeout 30s y **cero retries de red** → PENDING → cola de polling (backoff 10s→2h) convergiendo con el webhook en el mismo resolver → `settleAttempt` transaccional que emite `PAYMENT_SUCCEEDED` (Factus intacto) → **regla de oro: un attempt `indeterminate` JAMÁS engendra otro para el mismo `cycle_key`** (rescate por reference, si no: incidente y humano).
- **Dunning** D+0/D+1/D+3/D+7/D+10 con clasificación soft/hard/indeterminate; primer rechazo NO manda a `past_due`; `graceEnforcer` de offboarding no corta si hay attempt vivo; 3 plantillas de email nuevas + cron de aviso de tarjeta por vencer (30 días). Estado `PENDING_AUTH` cobra vida: la fila de suscripción se crea ANTES de disparar la transacción y `deriveSubscriptionPatch` aprende la transición `PENDING_AUTH → ACTIVE` en `PAYMENT_SUCCEEDED` (hoy un webhook no sabe activar nada — con MP la fila nacía síncrona).
- **Prorrateo** (upgrade reset-de-período, downgrade defer, cambio de ciclo, `MIN_CHARGE_CENTS` ~$2.000 COP, crédito al ledger) y **reconciliación por attempt** (la actual saltearía todas las filas Wompi: `if (!sub.providerSubscriptionId) continue`).
- **Monitoreo**: 5 chequeos nuevos del Ops Center (attempts colgados >30min, cobros del día no ejecutados, acumulado vs tope, fuentes por vencer, tasa DECLINED por método).

**Gate F2 (sandbox):** 3 ciclos consecutivos cobrados solos, incluyendo (a) un DECLINED recuperado por retry, (b) un webhook deliberadamente bloqueado recuperado por polling/reconciliación, (c) un upgrade prorrateado, (d) doble-disparo del cron sin doble cobro (verificado contra el ledger).

### F3 — Checkout del tenant + conversión — ~2-3 sem

- `components/billing/WompiPaymentForm.tsx` **NUEVO** (widget Wompi `data-widget-operation="tokenize"` — la tarjeta jamás toca nuestro backend) + `PaymentForm.tsx` dispatcher por provider resuelto de `GET /billing/public-config`. `MpCardForm` queda intacto para MP.
- Selector de método (tarjeta / Nequi según flags) + **doble token de aceptación** con ambos permalinks y evidencia (jti, file_hash, fecha, IP) persistida en `billing_payment_sources`.
- Estados asíncronos: "esperando aprobación en tu app Nequi" (polling del token), pendiente/rechazado/expirado; página de retorno que **no confía en el query param** (consulta `GET /v1/transactions/{id}`).
- Trial→pago (D6, backend en F0): al convertir con Wompi → crear fuente → primer cobro inmediato → `PENDING_AUTH→ACTIVE`.
- Mostrar el medio vigente ("Visa ••••1234", "Nequi 300•••1234") — hoy "Cambiar tarjeta" es un botón ciego.
- i18n: ~15 claves re-redactadas (hoy nombran "MercadoPago"/"tarjeta") + ~30 nuevas, **×4 idiomas**, mismo commit que la UI.

**Gate F3:** un tenant interno contrata Emprendedor **con tarjeta real en producción** ($1.500 de prueba primero), el segundo ciclo se cobra solo, la factura DIAN llega, y el flujo Nequi sandbox completo funciona detrás del flag.

### F4 — Encendido gradual en producción — ~2-4 sem calendario (poco código)

1. `providers_enabled.wompi=true` con `default_provider_by_country.CO` aún en `mercadopago` → migrar 2-3 tenants por override L2 (motivo + audit). Dos semanas de observación.
2. Si limpio: `default_provider_by_country.CO = "wompi"` → todas las altas colombianas nuevas a Wompi. **MP sigue vivo** para todo lo existente y para el resto de países (aunque hoy sus suscripciones están bloqueadas — pagos únicos funcionan).
3. Si MP se desbloquea: revertir es editar la misma clave. Las subs nacidas en Wompi siguen en Wompi (L3); las nuevas van a MP. **Ese es el botón pedido.**

**Gate F4:** 20 renovaciones Wompi consecutivas sin intervención, aprobación ≥ referencia, cero incidentes de webhook por 14 días.

### Fase EXT — exterior (Stripe/MoR) — CUANDO SE ACTIVE LA EXPANSIÓN (diseño listo, sin fecha)

- El routing ya la contempla: `default_provider_by_country["*"] = "stripe"` (o el MoR elegido) + `providers_enabled.stripe=true`. El adapter Stripe existe (esqueleto completo; falta checkout session + envs `STRIPE_*` en deploy.yml).
- **Fiscal (matriz §5):** agregar al `FiscalProviderFactory` la resolución por pago: país ≠ CO + entidad S.A.S. → **FEV de exportación** (verificar soporte del tipo de operación en Factus + concepto del contador — bloqueante de esa fase, no de esta); país ≠ CO + LLC/MoR → `UsRemoteAdapter` por pago (hoy es modo global).
- Checkout: el dispatcher ya elige por provider; Stripe Elements es un componente más.
- Bloqueantes heredados del informe MoR: concepto tributarista (exportación ficticia), pre-aprobación AUP si es MoR, IVA +19% a no-responsables colombianos si se vendiera CO vía MoR (por eso el híbrido geo-separado: **el MoR nunca cobra a Colombia**).

### Backlog opcional post-v1 (no bloquea nada)

- `tenant-payments` con links de pago Wompi (el tenant cobra señas por Nequi/PSE a SU cliente — alto retorno, independiente del motor; webhook multi-tenant por token opaco).
- PSE pago único para el ciclo del tenant (patrón link+recordatorio del diseño §5.6).
- Botón Bancolombia como fuente recurrente (encender flag tras prueba).
- 3DS/3RI si algún día se decide pedir la activación al equipo de fraude.

## 8. Riesgos top y su estado

| Riesgo | Mitigación | Residual |
|---|---|---|
| Doble cobro (sin Idempotency-Key en Wompi) | `UNIQUE(cycle_key,attempt_number)` + reference única + cero retries HTTP + regla del indeterminado + **rescate por `GET /transactions?reference=`** (hallazgo nuevo: el filtro existe → W6 deja de ser bloqueante abierto) | bajo |
| Un provider desconocido cae al adapter MP | El throw del factory va en el MISMO commit que el union type (F0) | nulo tras F0 |
| Llave pública horneada en el build | `GET /billing/public-config` runtime (F0) — sin esto el "botón" no sería botón | nulo tras F0 |
| Cron double-fire (API+worker) | CronLock + la garantía real es el UNIQUE del ledger | nulo |
| Webhook Wompi: solo 3 reintentos/24h | Cola de polling + reconciliación por attempt | bajo |
| Tarjeta vencida sin account updater | Cron de aviso 30 días + `failure_class='hard'` pide medio nuevo | medio, inherente |
| Refund sin API (solo void pre-liquidación) | Capability `refunds:'void_only'` → Billing Ops degrada a "reembolso manual registrado"; nota crédito DIAN solo cuando el dinero se devolvió | medio — decisión de negocio ya asumida |
| Enterprise anual > tope $10M/tx | Ampliación por soporte o gatear ese ciclo fuera de Wompi | bajo (acción del dueño) |
| País mal inferido rutea mal pasarela Y fiscal | Unificación de listas + backfill + 'CO' explícito + log de fallback (F0) | bajo |
| Wompi también aplica gates invisibles al primer cobro real | Prueba de $1.500 en producción ANTES del encendido (gate F3); flags por método degradan sin deploy | medio hasta F3 |

## 10. Estado de ejecución — F0 (12-ago-2026)

**F0 implementada y verificada.** `tsc` limpio, 122 tests en 12 suites verdes, `test:bootstrap` PASSED. Con Wompi apagado el comportamiento de producción es idéntico al de antes.

### Backend

| Pieza | Archivo | Qué quedó |
|---|---|---|
| Capacidades por proveedor | `billing/adapters/provider-capabilities.ts` **(nuevo)** | `ProviderCapabilities` + las 4 declaraciones (MP/Stripe/Wompi/mock). El código de negocio ramifica por capacidad, nunca por nombre. **Stripe declara allowlist explícita de países** (BR/MX en LatAm — nunca CO): una lista vacía habría dejado rutear Colombia a Stripe, bug que atrapó el propio spec |
| Contrato de cobro | `billing/adapters/charging-provider.interface.ts` **(nuevo)** | `IChargingProvider` para proveedores sin suscripciones nativas: fuentes de pago, `charge`, `getChargeByReference` (rescate del cobro indeterminado), links. Lo implementa Wompi en F1 |
| Factory sin defaults silenciosos | `billing/payment-provider.factory.ts` | El `default: mercadoPagoAdapter` pasó a `throw unknown_payment_provider`. Nuevos: `capabilitiesOf()`, `getCharging()`, `isRegistered()` |
| **El switch** | `billing/payment-routing.service.ts` **(nuevo)** | L0-L3 sobre `platform_settings` + cache Redis 5 min. Polaridad asimétrica (MP fail-open, resto fail-closed), failover a proveedor usable, y `no_payment_provider_available` en vez de default silencioso |
| Endpoints del switch | `billing/billing-admin.controller.ts` | `GET/PUT /billing-admin/providers`, `PUT /billing-admin/tenants/:id/payment-provider` (motivo obligatorio + 409 con suscripción viva salvo `force`), `provider-status` generalizado manteniendo la clave `mercadopago` un deploy |
| Llave pública en runtime | `billing/billing-public.controller.ts` | `GET /billing/public/config` → `{provider, publicKey, environment, methods, asyncSettlement}`. Sin esto el switch no sería runtime: `NEXT_PUBLIC_MP_PUBLIC_KEY` se hornea en el build del dashboard |
| Ramas por capacidad | `billing/billing.service.ts` | Upgrade y downgrade ramifican por `nativeSubscriptions`/`changePlanInPlace`; `grantCompPlan` toma el proveedor del router; `resolveProviderPlanId` ya no devuelve `'mock-plan'` para desconocidos; `assertProviderConfigured` bloquea `mock` en producción |
| **Compensación del upgrade** | `billing/billing.service.ts` | Si falla el cancel de la suscripción vieja tras crear la nueva, se cancela la nueva y se audita (`subscription_upgrade_rollback`). Antes quedaban **dos mandatos cobrando** con la DB apuntando a uno |
| **Conversión trial→pago** | `billing/billing.service.ts` | Un trial local (o ya en `past_due`) con método de pago ahora convierte —incluso al MISMO plan—. Antes: `same_plan` si era igual, `local_trial_plan_change_not_supported` si era otro ⇒ el trial solo podía vencer |
| Catálogo por proveedor | `billing/billing-plan-catalog.service.ts` | La disponibilidad se juzga contra el proveedor que realmente cobra el país (antes MP hardcodeado). Sin esto, encender Wompi habría dejado todo el catálogo en "temporalmente no disponible" |
| `annualAvailable` | `billing/billing-plan-display.util.ts` | Campo nuevo calculado en backend; `mpPlanIdAnnual` queda deprecado un deploy. El toggle anual dejaba de existir sin error para cualquier proveedor sin catálogo remoto |
| Alertas por proveedor | `billing/webhook.controller.ts` + `health/platform-monitor.service.ts` | Contadores `billing:webhook:fail:{provider}:{kind}:{fecha}` y umbrales evaluados por proveedor; se acabó el `MERCADOPAGO_WEBHOOK_SECRET` hardcodeado en el texto de la alerta |
| País unificado | `common/utils/billing-country.util.ts`, `billing/billing-country-config.ts`, DTO de onboarding, `fiscal.controller.ts` | Dos niveles explícitos: `isSupportedBillingCountry` (~55, lo que puede guardarse) vs `hasBillingCurrency` (17, lo que puede cobrarse). La degradación a 'CO' ahora deja warning con tenantId |
| Backfill de país | `prisma/migrations/20260812000000_backfill_tenant_billing_country/` | Aditiva: `language` → región, luego 'CO'. Sin DROP/RENAME |
| Secretos cableados | `.env.example`, `.github/workflows/deploy.yml` | Los 4 `WOMPI_*` en los tres lugares del deploy. Ausentes = warning, nunca rompen el arranque |

### Tests nuevos
`payment-routing.service.spec.ts` (16 casos: polaridad de fallo, orden L2→L1→`*`, adapter no registrado, país no soportado, negativa explícita, `mock` inrouteable en producción) · `billing.service.spec.ts` +3 (conversión al mismo plan, token nunca descartado, `same_plan` sigue vigente sin método de pago) · `billing-plan-display.util.spec.ts` +2 (proveedor sin catálogo remoto).

### Nota de entorno (no es un bug del código)
`npm run test:bootstrap` falla localmente con `RangeError: Maximum call stack size exceeded` o `exit 134` cuando **falta `npx prisma generate`** o el heap por defecto no alcanza. Diagnóstico: sin el client generado, Prisma revienta dentro del grafo de DI y el error parece un ciclo de dependencias. Receta que pasa:

```bash
cd apps/api && npx prisma generate && node ../../node_modules/jest/bin/jest.js --testPathPattern=bootstrap --forceExit --runInBand
```

### Dashboard (cierra F0)

| Pieza | Archivo | Qué quedó |
|---|---|---|
| Pestaña "Proveedores" | `app/admin/plans/page.tsx` + `_components/ProvidersTab.tsx` **(nuevo)** | `TabNav` con Planes/Proveedores — una **pestaña**, no una página: una página nueva obliga a tocar `roles.ts`, `navigation-contract.ts` y el sidebar, y rompe dos specs de contrato. Toggle por proveedor con chips de capacidades, tabla país→proveedor con la fila `*` como "Resto del mundo", alta y **borrado** de países, flags de métodos Wompi visibles solo con Wompi encendido, y traducción de los códigos de error del backend |
| Alcance visible | idem | Callout fijo: el switch afecta **solo altas nuevas**; las suscripciones vivas siguen con su proveedor |
| Helpers de API | `lib/api.ts` | `getProviderRouting`, `updateProviderRouting`, `setTenantPaymentProvider` + tipos. `MercadoPagoProviderStatus` intacto (aditivo) — `/admin/plans` sigue leyendo `data.mercadopago` |
| Borrado de reglas | backend + UI | `defaultByCountry: {"MX": null}` = DELETE explícito. Sin esto el merge solo podía agregar y una fila borrada reaparecía al refrescar. `"*": null` → 400 `catch_all_required`: todo país debe resolver a algún proveedor |
| i18n | `messages/{es,en,pt,fr}.json` | ~45 claves nuevas. Paridad verificada: 9.057 claves en los 4 locales, 0 faltantes / 0 sobrantes |

**Verificación de F0:** API `tsc` limpio + 144 tests/13 suites + `test:bootstrap` PASSED · Dashboard `tsc` limpio + 58 tests/4 suites de contrato (navegación, roles, i18n) · ESLint sin hallazgos nuevos.

## 11. Estado de ejecución — F1 (12-ago-2026)

**Código de F1 completo y verificado** (142 tests / 13 suites verdes, `tsc` limpio, `test:bootstrap` PASSED con el adapter registrado). Lo único que falta es la **verificación en vivo contra el sandbox**, que necesita las credenciales del dueño.

| Pieza | Archivo | Qué quedó |
|---|---|---|
| Credenciales y ambiente | `billing/adapters/wompi-config.service.ts` **(nuevo)** | Los 4 secretos; el **ambiente se deriva del prefijo de la llave** (`pub_test_`→sandbox, `pub_prod_`→producción) y la URL base sale de ahí — una llave de test no puede apuntar a producción por configuración. **Mezclar prefijos deshabilita el adapter** en vez de cobrar plata real desde un flujo de prueba. Falta de credenciales = warning, nunca rompe el arranque |
| Adapter | `billing/adapters/wompi.adapter.ts` **(nuevo)** | `IPaymentProvider` + `IChargingProvider`. Tokens de aceptación (habeas data, los dos), fuentes de pago, cobro con `payment_source_id` + `recurrent`, `getCharge`, **`getChargeByReference`** (rescate del cobro indeterminado), `void`, links de pago. Los métodos de suscripción tiran `NotImplementedException` ruidosa — un no-op silencioso ahí sería un tenant sin cobrar. Guarda de moneda (solo COP) y de monto mínimo ($1.500) |
| Firma de integridad | idem | `SHA256(reference + amount + currency [+ expiration] + secret)`, expuesta como método para poder testear el ORDEN de los campos: equivocarlo se rechaza sin decir cuál está mal |
| Checksum de eventos | idem | `SHA256(valores de signature.properties EN ORDEN + timestamp + events secret)`, con las rutas **resueltas por reflexión** (la lista es dinámica; hardcodear los 3 campos de hoy rompe el día que Wompi agregue un cuarto). Comparación con `timingSafeEqual`, fail-closed. **Valida `environment`**: un APPROVED de sandbox nunca activa una suscripción de producción |
| Idempotencia del webhook | idem | Wompi no manda event id → uno determinista `evento.txnId.estado`, que deduplica reentregas del mismo estado pero deja pasar `PENDING → APPROVED` |
| Eventos nuevos | `billing/types/billing-event.enum.ts` | `PAYMENT_METHOD_AUTHORIZED` / `PAYMENT_METHOD_DECLINED` para la autorización fuera de banda de billeteras (Nequi, Botón Bancolombia). Aditivo |
| Ruta de webhook | `billing/webhook.controller.ts` | `wompi` en la allowlist, **deliberadamente NO gateada por el kill switch**: apagar un proveedor frena altas nuevas, no los cobros de las suscripciones que ya viven ahí |
| Registro | `billing.module.ts`, `payment-provider.factory.ts`, `billing-public.controller.ts`, `billing-plan-catalog.service.ts` | Adapter enchufado; `GET /billing/public/config` ya sirve la llave pública de Wompi cuando el routing lo elige |
| Secretos | `.env.example`, `.github/workflows/deploy.yml` | Los 4 `WOMPI_*` en los tres lugares del deploy + `WOMPI_WEBHOOK_URL` |

**Tests** (`wompi.adapter.spec.ts`, 20 casos): orden de la firma de integridad, checksum válido/manipulado/con otro secreto, `properties` dinámicas, rechazo de ambiente cruzado, mapeo de los 4 estados a eventos normalizados, id de evento determinista, guardas de capacidad y de monto.

**Pendiente de F1 (necesita al dueño):** cargar los 8 secretos, configurar la URL de eventos en el panel de Wompi por ambiente, y correr el ciclo end-to-end en sandbox (tarjeta 4242 → APPROVED, 4111 → DECLINED) incluyendo la prueba de timeout/rescate por `reference`.

---

## 13. Estado de ejecución — F2 (en curso)

**Cimientos construidos y verificados.** Falta el grueso: scheduler, processor, dunning y prorrateo.

| Pieza | Archivo | Estado |
|---|---|---|
| Modelos del motor | `prisma/schema.prisma` | ✅ `BillingPaymentSource`, `BillingChargeAttempt`, `BillingCreditLedger` + 13 columnas aditivas en `BillingSubscription` |
| Migración | `prisma/migrations/20260813000000_add_billing_recurring_engine/` | ✅ Estrictamente aditiva. **El motor nace apagado**: `engine` default `'provider'` en todas las filas, así que desplegarla no cambia el comportamiento de ninguna suscripción. Encenderlo es un UPDATE por tenant, después de que toda la flota corra el código nuevo — rollout de datos, no de código |
| Aritmética de períodos | `billing/recurring/period.util.ts` + spec (25 casos) | ✅ Anclaje con clamp **sin arrastre** (una suscripción del 31 cobra el 28 en febrero y **vuelve al 31 en marzo**), zona horaria del tenant con DST, cobro a las 09:00 locales (un rechazo a medianoche no se resuelve hasta la mañana siguiente), claves de idempotencia sin `:` y jitter determinista por suscripción |
| Verificación del sandbox | `scripts/verify-wompi-sandbox.js` | ✅ **EJECUTADO 13-ago-2026 — contrato verificado contra la API real** (ver abajo) |

### Verificación empírica del sandbox (13-ago-2026)

Corrida completa contra `sandbox.wompi.co` con las llaves reales. **Encontró un defecto que habría reventado el primer cobro en producción**, que es exactamente para lo que se escribió el script.

| # | Verificación | Resultado |
|---|---|---|
| 1 | Tokens de aceptación (habeas data) | ✅ Los **dos** llegan (`END_USER_POLICY` + `PERSONAL_DATA_AUTH`) |
| 2 | Tokenización de tarjeta con llave pública | ✅ |
| 3 | Fuente de pago reutilizable | ✅ `AVAILABLE` de inmediato para tarjeta (sin 3DS) |
| 4 | Cobro merchant-initiated | ❌→✅ **Falló con 422 `"No se especificó el número de cuotas (installments)"`.** La doc describe `payment_method` como opcional cuando va `payment_source_id`; **es obligatorio para CARD**. Corregido: el adapter manda `payment_method: { installments: 1 }` para fuentes de tarjeta y lo omite para billeteras. Cubierto por dos tests |
| 4b | Firma de integridad | ✅ Aceptada al primer intento — el orden `reference + amount + currency + secret` es correcto |
| 4c | Liquidación asíncrona | ✅ La transacción nace `PENDING`, como asume el motor |
| 5 | Liquidación por polling | ✅ `APPROVED` en el primer intento (~2s) |
| 6 | **Rescate por referencia** | ✅ `GET /transactions?reference=` devuelve la transacción. Es la única salida ante un timeout sin `transaction_id`, y era el riesgo residual ALTO del informe de investigación (W6) — **queda cerrado** |
| 7 | Tarjeta rechazada | ⚠️ La 4111 se rechaza **al crear la fuente** (422), no al cobrar. Ver nota abajo |
| 8 | Secreto de eventos | ✅ Presente. La verificación de una entrega real queda para cuando la URL esté configurada en el panel |

**Nota sobre el paso 7 (afecta el diseño del dunning):** en sandbox una tarjeta inválida se rechaza al tokenizar/crear la fuente, así que **el camino `DECLINED` en el cobro no pudo ejercitarse**. En producción el caso frecuente es otro — una tarjeta válida que falla por fondos o por el emisor —, y ese es justamente el que dispara el dunning. La clasificación soft/hard de F2 debe validarse con un rechazo real, no con este script.

### F2 COMPLETA (13-ago-2026)

| Pieza | Archivo | Qué resuelve |
|---|---|---|
| Motor | `recurring/subscription-engine.service.ts` + spec (25 casos) | Reclamo del intento **antes** de mover plata (la unicidad por ciclo hace imposible el segundo reclamo), revalidación al cobrar, liquidación transaccional con el evento fiscal emitido **después** del commit, y la regla del indeterminado |
| Agendado | `recurring/renewal-scheduler.service.ts` | Cron cada 10 min que **solo agenda**; jitter por aniversario; reserva contra el tope diario antes de agendar (si se pasa, difiere); barrido que reencola intentos cuyo job se perdió — la cola no es la fuente de verdad |
| Cobro | `recurring/processors/renewal-charge.processor.ts` | Posesión exclusiva → revalidación → guarda de atraso (36h) → cobro **sin reintento de red** (el POST no es idempotente) |
| Consulta | `recurring/processors/charge-poll.processor.ts` | Backoff 10s→2h; **par** del webhook, no respaldo (el proveedor reintenta 3 veces en 24h sin garantía) |
| Recuperación | `recurring/dunning.service.ts` + spec (12 casos) | Escalera D+1/D+3/D+7/D+10; el primer rechazo **no** suspende; hard = deja de reintentar y pide otro medio; indeterminado = congela sin cortar; medio nuevo = cobra en el acto |
| Medios de pago | `recurring/payment-source.service.ts` + controller | Alta con token de un solo uso (la tarjeta nunca toca el backend), evidencia de habeas data sin guardar los JWT, activación con precio congelado |
| Prorrateo | `recurring/proration.service.ts` + spec (11 casos) | Valor del tiempo sin usar sobre lo **pagado** (respeta cupones); mínimo cobrable; baja de plan = crédito, **nunca** reembolso (no hay API) |
| Convergencia | `billing.service.ts` `settleEngineChargeIfAny` | Webhook y consulta desembocan en la misma liquidación; el segundo no hace nada. Antes el webhook habría contado el pago dos veces y emitido una segunda factura DIAN |
| Conciliación | `processors/reconciliation.processor.ts` | Barrido cada 20 min por **intento** (la existente pregunta por un objeto de suscripción que estos proveedores no tienen: los saltea a todos) |
| Cambio de plan | `billing.service.ts` `changePlanWithEngine` | El plan cambia cuando el cobro liquida, no al pedirlo |
| No cortar a quien pagó | `offboarding-cron.service.ts` | El corte pregunta antes si hay un cobro en juego |
| Monitoreo | `health/platform-monitor.service.ts` | 5 chequeos: cobros colgados, renovaciones no agendadas (crítico: con motor propio, si el scheduler se cae **nadie cobra**), tope diario, tarjetas por vencer, tasa de rechazo por método |
| **Guarda liberada** | `payment-routing.service.ts` | `INTERNAL_RECURRING_ENGINE_AVAILABLE = true`: los proveedores sin suscripciones nativas ya son ruteables. Siguen **apagados** por defecto |

**Verificado:** `tsc` limpio · **243 tests / 18 suites** · `test:bootstrap` PASSED.

## 14. F3 — Checkout (COMPLETA, 13-ago-2026)

| Pieza | Archivo | Qué resuelve |
|---|---|---|
| Dispatcher | `components/billing/PaymentForm.tsx` **(nuevo)** | Resuelve proveedor y llave pública **en runtime** desde `GET /billing/public/config`. Cambiar de operador para un país ya no exige reconstruir el dashboard |
| Formulario Wompi | `components/billing/WompiPaymentForm.tsx` **(nuevo)** | Tokeniza contra la pasarela **desde el navegador** — el número de tarjeta nunca llega a nuestro servidor. Selector de método según los flags activos; los **dos consentimientos de habeas data bloquean el botón** hasta aceptarlos (requisito legal, no cortesía); los medios que se autorizan fuera de la app muestran ese estado y consultan hasta resolverse |
| Medios de pago | `app/admin/settings/billing/page.tsx` | Reemplaza el botón ciego de "cambiar tarjeta": se ve qué hay guardado, cuál cobra, y se puede cambiar o eliminar |
| MercadoPago intacto | idem | Su formulario, su token y su script antifraude siguen igual — este último solo se carga cuando es el proveedor activo |
| Hueco del alta cerrado | `billing.service.ts` | Exigía token de tarjeta aunque el tenant ya tuviera un medio guardado, porque el requisito se evaluaba antes de saber qué proveedor cobra |

**Verificado:** `tsc` limpio en API y dashboard · **paridad exacta de 8.780 claves i18n en los 4 idiomas** · 77 tests de contrato del dashboard.

## 15-bis. Lo que estaba parado y no se veía (14-ago-2026)

Con el ruteo YA en Wompi (`provider: wompi` en `/billing/public/config?country=CO`)
la venta seguía sin poder completarse. Cinco bloqueos, todos por haberse escrito
cuando MercadoPago era el único operador posible. Los tres primeros se
descubrieron leyendo el catálogo real de producción, que publica el motivo de
cada bloqueo; los dos últimos, revisando caminos que un cliente sí usa.

| # | Qué estaba roto | Por qué | Estado |
|---|---|---|---|
| 1 | **Ciclo anual, los 4 planes** | La disponibilidad exigía `annual.currency`, y el ÚNICO que escribía ese campo era el sync a MercadoPago. El seed deja la moneda un nivel más arriba. Sin sync no había anual, y bajo un operador sin catálogo remoto —que no tiene nada que sincronizar— habría quedado bloqueado para siempre. El mismo defecto estaba duplicado en `resolveEnginePricing` | Código corregido: la fila anual **hereda la moneda del país** |
| 2 | **Alta de pro y enterprise** (`card_trial_not_supported`) | Limitación real de MercadoPago —tokens de un solo uso, expiran en minutos, así que prometer cobro automático al vencer sería mentira— aplicada a TODOS los operadores | El gate pregunta por `storedPaymentSources`, no por el nombre |
| 3 | **Nadie podía llegar a pagar nunca** | El motor estaba entero (scheduler, dunning, prorrateo, poll) pero **desconectado**: `activateWithEngine` no tenía un solo llamador y ninguna suscripción llegaba a `engine='internal'`. El trial vencía en silencio, con la tarjeta guardada y sin un intento de cobro | Ciclo cerrado por los 3 caminos (abajo) |
| 4 | **Alta de plan sin trial** | Pedía `provider.createSubscription`, que en un operador sin suscripciones nativas tira `unsupported` y mata el alta | Nace local + cobra el primer período |
| 5 | **Cancelar** | Exigía `providerSubscriptionId` antes de nada; Wompi nunca tiene ese id → 400 `missing_provider_subscription`. **El cliente no podía darse de baja** | Cuando el calendario es nuestro, cancelar es dejar de agendar |

**Los tres caminos por los que alguien empieza a pagar**, todos con el precio
congelado al contratar:

| Camino | Cuándo se cobra |
|---|---|
| Alta con trial y tarjeta | al vencer el trial (`nextChargeAt = trialEndsAt`) |
| Alta de plan sin trial | ya — el intento se reclama ANTES de encolar, así el barrido no puede duplicar. Nace `PENDING_AUTH`: nunca activa sin que se haya movido un peso |
| Tarjeta agregada durante un trial | al **vencer** el trial, no al guardarla: el cliente tiene días prometidos |

**Lo que NO era código: el precio anual nunca llegó a producción.** El bootstrap
del deploy es *create-only* y salta los planes existentes, así que los precios
anuales del seed jamás se escribieron en los planes creados antes. Se completa
con `scripts/backfill-annual-prices.js` (simulacro por defecto), que deriva el
anual del mensual REAL de cada plan menos el descuento — no reimpone los del
seed, y nunca pisa un anual existente. Correr el seed con `--force` también lo
arreglaría, pero restauraría valores de fábrica de nombre, features y límites,
pisando lo editado desde el panel.

### Guía de prueba en sandbox — ANTES de las llaves de producción

Precondición: `/billing/public/config?country=CO` debe responder
`provider: wompi` y `environment: sandbox`.

**0. Preparar**

```bash
docker exec parallext-api node scripts/backfill-annual-prices.js          # simulacro
docker exec parallext-api node scripts/backfill-annual-prices.js --apply
```

En `/admin/plans → Proveedores`, **dejar sólo `card`**. Nequi y transferencia
Bancolombia están hoy encendidos en producción y ninguno completa: Nequi exige
además habilitar recurrencia en el portal de Nequi Negocios del comercio, y la
transferencia no tiene flujo de autorización implementado (§ transferencias).

**1. El contrato con el proveedor** — prueba el protocolo, no nuestro flujo:

```bash
docker exec parallext-api node scripts/verify-wompi-sandbox.js
```

**2. El ciclo completo** — lo que va encima, que es donde estuvo el problema:

```bash
docker exec parallext-api node scripts/verify-wompi-flow.js
docker exec parallext-api node scripts/verify-wompi-flow.js --tenant <uuid>
```

Detecta el defecto #3 aunque desde afuera todo se vea bien: suscripción viva,
método de pago guardado y motor apagado. También avisa de intentos colgados
+6h, que en un proveedor asincrónico significa que el webhook no llega.

**3. A mano, con un tenant de prueba** (tarjeta sandbox `4242 4242 4242 4242`):

| Paso | Qué debe pasar |
|---|---|
| Alta de un plan con trial | suscripción `trialing`; sin tarjeta el motor NO se arma (correcto) |
| Agregar tarjeta en Configuración → Facturación | `verify-wompi-flow` la muestra armada, cobrando al **vencer** el trial |
| Alta de pro o enterprise | pide tarjeta al alta y agenda el cobro al vencer |
| Cancelar | responde OK (antes: 400) y el barrido deja de agendar |
| Tarjeta `4111 1111 1111 1111` | rechazo: alimenta el dunning |

**4. Recién entonces**, cambiar las cuatro llaves a producción, redeployar
(`.env` se regenera en cada deploy) y repetir el paso 2 con un cobro real de
monto mínimo.

### Lo que sigue sin poder verificarse en sandbox

- **El rechazo real.** En sandbox la tarjeta inválida se rechaza al CREAR la
  fuente, no al cobrar; el caso que dispara el dunning es "tarjeta válida sin
  fondos", y ése sólo aparece con tráfico real.
- **La entrega del webhook** de punta a punta.
- **La tasa de aprobación** con adquirencia local — el argumento central a favor
  de Wompi frente a un MoR.

## 15. F4 — Encendido (operación, sin código)

Todo el código está. Lo que resta es una secuencia operativa, deliberadamente gradual.

### Antes de encender nada
1. **Mergear la rama a `main`** → dispara el deploy. Las migraciones son aditivas y **el motor nace apagado** (`engine='provider'` en todas las filas), así que desplegar no cambia el comportamiento de ninguna suscripción viva.
2. **Configurar la URL de eventos** en el panel de Wompi, una por ambiente:
   `https://api.parallly-chat.cloud/api/v1/billing/webhook/wompi`
   Recién ahora: antes del deploy esa ruta responde 501 y Wompi solo reintenta 3 veces en 24h.
3. **Verificar el tope por transacción** en el panel. Enterprise anual (~COP 18,3M) supera el tope Agregador PJ de $10M/tx: pedir ampliación por soporte, o dejar ese ciclo fuera de Wompi.

### Encendido gradual
4. `providersEnabled.wompi = true` **dejando `defaultByCountry.CO` en `mercadopago`**. Nadie se rutea todavía.
5. Mover 2-3 tenants con el override por tenant (motivo obligatorio, queda auditado). **Observar dos semanas** con los chequeos del Ops Center: cobros colgados, renovaciones no agendadas, tasa de rechazo.
6. Si está limpio: `defaultByCountry.CO = "wompi"`. Las altas colombianas nuevas van a Wompi; **todo lo existente sigue en MercadoPago**.
7. **Revertir es la misma clave.** Las suscripciones nacidas en Wompi siguen ahí (el proveedor es de por vida), las nuevas vuelven a MP.

### Criterio de "listo"
20 renovaciones consecutivas sin intervención, aprobación ≥ la de MercadoPago, y cero incidentes de webhook abiertos durante 14 días.

### Lo que sigue sin verificarse hasta que haya tráfico real
- **El camino `DECLINED` en el cobro.** En sandbox la tarjeta inválida se rechaza al crear la fuente, no al cobrar; el caso real —tarjeta válida sin fondos— es el que dispara el dunning. La clasificación soft/hard hay que confirmarla con un rechazo real.
- **La entrega del webhook** de punta a punta.
- **La tasa de aprobación** de tarjetas colombianas con adquirencia local (el argumento central del informe de MoR).

## 12. Revisión adversarial de F0+F1 (12-ago-2026)

Se revisaron los 13 archivos contra este plan. **6 defectos corregidos** (los 3 de camino de dinero, el bypass de firma, el guard de ambiente y la auditoría sin actor) + 5 de consistencia. Estado final: `tsc` limpio, **151 tests / 13 suites**, `test:bootstrap` PASSED.

### Corregidos

| # | Defecto | Corrección |
|---|---|---|
| **P0** | **Encender Wompi habría creado tenants que nunca podrían pagar.** El adapter existe (F1) pero el motor de recurrencia (F2) no: el trial arrancaba bien y un mes después *todos* los caminos de pago fallaban, tenant por tenant | Constante `INTERNAL_RECURRING_ENGINE_AVAILABLE = false` con guarda en tres puntos: el `PUT` del panel rechaza habilitar un proveedor sin suscripciones nativas (`recurring_engine_unavailable`), el resolver lo salta, y `assertProviderConfigured` lo bloquea. **Se enciende en el mismo cambio que traiga F2** |
| **P0** | `assertProviderConfigured` no validaba credenciales de Wompi: un alta podía rutear a un proveedor sin ninguna llave cargada | Validación agregada (`wompiConfig.isConfigured()`) |
| **P0** | **La compensación del upgrade decía "sin cargos adicionales"** — pero MercadoPago cobra el primer período al crear el preapproval, y cancelar solo frena las renovaciones futuras | Mensaje honesto + `chargeMayNeedRefund` y `actionRequired` en la auditoría para que Billing Ops concilie y devuelva. El id del pago solo llega por webhook, así que el refund no puede emitirse en línea |
| **P0** | **El ciclo anual reventaba con Wompi**: `createTrialSubscription` exigía un id de plan remoto sin ramificar por capacidad, así que la UI ofrecía el anual y el POST siempre daba 400 | La validación del anual corre solo si el proveedor tiene catálogo remoto (`caps.planCatalog`) |
| **P1** | **Bypass de la firma del webhook.** `properties` viaja dentro del payload y se concatenaba sin separador: con un evento legítimo observado, reducir la lista a `["transaction.id"]` y meter la concatenación vieja en ese campo produce **el mismo digest**, dejando estado, monto y email forjables | Se exige que el checksum cubra `transaction.id`, `status` y `amount_in_cents`; propiedades extra se aceptan (si Wompi firma más campos, nada se rompe). Hay un test que **demuestra la colisión** y verifica que el guard la frena |
| **P1** | El guard de ambiente era opt-out: un payload **sin** `environment` no se validaba, y con solo el events secret cargado el ambiente quedaba `unconfigured` y el guard desaparecía | Ausencia de `environment` = rechazo; ambiente indeterminado = rechazo de todo evento |
| **P1** | Los dos endpoints nuevos auditaban con `auditActor(req)` en vez de `auditActor(req.user)` → **actor `undefined`** y la rama de impersonación nunca se activaba. Cambiar quién cobra un país entero quedaba sin firma | Patrón corregido + `delegation` en `details` + el fallo de auditoría ya no se traga en silencio |
| **P2** | El catálogo publicaba `checkoutMode: 'self_serve'` aunque el kill switch hubiera dejado al país sin proveedor: botón de comprar con POST garantizado a fallar | Cuando no hay proveedor routable, `providerConfigured = false` y el catálogo lo reporta |
| **P2** | `GET /billing/public/config` sin `?country=` siempre daba 400 (ningún proveedor "soporta" un país nulo) | Default a `CO`, igual que el catálogo y el alta; devuelve el país efectivo |
| **P2** | `grantCompPlan` tragaba cualquier error del router — incluido el `no_payment_provider_available` deliberado | Se registra con warning explicando que una conversión posterior necesitará proveedor explícito |
| **P2** | Un evento de billetera sin id producía un `providerEventId` constante: **el primero ganaba y todos los demás, de cualquier tenant, se descartaban como duplicados** | Se rechaza el evento sin id en vez de fabricar uno colisionable |
| **P2** | `updateConfig` fusionaba sobre `getConfig()`, que ante un fallo de DB devuelve *defaults*: un `PUT` parcial habría reactivado MercadoPago y apagado el resto, pisando la config real | `getConfigStrict()` lee sin caché ni fallback; si no puede leer, no escribe |
| **P2** | `createCheckoutLink` descartaba `reference` y `customerEmail` (la reference es el ancla de idempotencia); `payment_source_id` no numérico se enviaba como `null` | Ambos campos se envían; el id de fuente se valida como entero positivo |

### Conocidos, NO corregidos (deuda registrada)

- **Chequeo de sincronización atado a MercadoPago**: `billing-plan-catalog` juzga la disponibilidad con `mpPlanId` para *cualquier* proveedor con catálogo remoto, y la rama de Stripe en `resolveProviderPlanId` ignora el ciclo (anual bindea el id mensual). Hoy es inerte porque Stripe no opera; **bloqueante de la Fase EXT**.
- **`tenants.payment_provider` mezcla dos cosas**: el override auditado (L2) y el pin automático que escribe cada alta. Efecto: un tenant que se re-suscribe conserva el proveedor viejo y no sigue el cambio de default del país. Separar en dos columnas (o marcar el origen) queda para F2.
- **Resolución del webhook de Wompi por email**: `findFirst` sobre `billingEmail`, que no es única. Se cierra en F2 con la `reference` parseable del ledger de intentos. Mitigación actual: el dedupe por `id.status` (ambos firmados) impide replays.
- **`PAYMENT_METHOD_AUTHORIZED/DECLINED` sin listener**: quedan auditados en `billing_events` pero nadie reacciona. Los consume el motor en F2.

## 9. Orden de arranque para codificar

1. **F0 completa** (es útil aunque Wompi no existiera: mata 3 defaults silenciosos, habilita el switch, arregla la conversión de trial y el bug del upgrade).
2. **F1** en paralelo con los prerrequisitos del dueño (§6).
3. **F2 → F3 → F4** en secuencia, con sus gates.
4. Fase EXT queda diseñada y dormida hasta la decisión de expansión.

*Actualizar `docs/billing-runbook.md` (retenciones Agregador: lo desembolsado ≠ lo facturado — reteFuente/reteIVA/reteICA), `docs/plan-profitability-2026-07.md` (comisión Wompi 2,65%+700+IVA: Emprendedor ~4,1% efectivo) y `docs/CHANGELOG.md` al cierre de cada fase.*
