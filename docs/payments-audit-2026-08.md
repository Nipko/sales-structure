# Auditoría del sistema de pagos — 31 de agosto de 2026

**Disparador**: el cron mensual de snapshots financieros (1° @1AM, primera ejecución tras el
commit `e52b01c4` del 15-ago) murió con `PrismaClientValidationError: Unknown argument
'tenant'` en `FinancialSnapshotService.generateSnapshot`. Se pidió validar si "estamos bien
en toda la parte de pagos".

**Método**: diagnóstico directo del crash + 3 auditorías paralelas de solo lectura
(motor de cobros Wompi/recurrencia; periféricos — cupones, refunds, fiscal, retiro MP,
SMS, tenant-payments; barrido transversal de la clase de bug + consistencia de alcance
comercial `tenants.is_internal`). Cada hallazgo crítico de los agentes fue re-verificado
a mano contra el código antes de aceptarlo; dos fueron rebajados tras refutación.

---

## Veredicto

**El núcleo que mueve plata está sólido.** El motor de recurrencia, los webhooks, la capa
fiscal, los cupones y el retiro de MercadoPago verifican con defensas en capas (constraints
UNIQUE como garantía real, locks como optimización, relecturas canónicas del proveedor,
gates de deploy). Los defectos encontrados se concentran en la **capa de reporting**
(financials/métricas) y en un **botón muerto** (refund inline, roto por casts `::uuid`
faltantes — fallaba *seguro*: 500 antes de tocar al proveedor). Todo lo de severidad alta
quedó arreglado en este working tree; queda una lista corta de decisiones de producto y
endurecimientos dormidos (Stripe).

---

## 1. Arreglado en esta pasada (6 archivos, +57/−16)

### 1.1 P0 — Crash del snapshot mensual (el incidente reportado)

`commercial-scope.util.ts` exportaba `COMMERCIAL_PAYMENTS = { tenant: { isInternal: false } }`
y se spreadeaba en `billingPayment.findMany` — pero `BillingPayment` **no tiene** relación
`tenant` (solo `tenantId` escalar + relación `subscription`). `tsc` no lo atrapó porque el
**spread de una constante sin tipar esquiva el excess-property-check de TypeScript**; por eso
pasó CI y explotó recién en runtime, en la primera ejecución del cron (1-sep 01:00 UTC).

- **Impacto**: el snapshot de **agosto 2026 no se escribió** (el crash fue antes de todo
  upsert; sin otros efectos). El cron habría fallado todos los meses.
- **Fix**: `COMMERCIAL_PAYMENTS` ahora filtra por `subscription → tenant` (relación real,
  mismo JOIN indexado) y ambas constantes llevan `satisfies Prisma.…WhereInput`, que valida
  la forma contra el schema **en el sitio de definición** — esta clase de bug ahora es error
  de compilación.
- **Recuperación**: post-deploy, regenerar SOLO agosto desde `/admin/financials` → Settings
  → "Generar snapshot" (mes `2026-08`). **No** regenerar julio ni meses anteriores: el
  servicio calcula con el estado *actual* de las suscripciones; un backfill viejo falsearía
  la historia. Nota esperable: julio (generado el 1-ago, pre-alcance) incluye tenants
  internos → el escalón de MRR julio→agosto es cambio de alcance, no churn.

### 1.2 P1 — Botón de refund inline muerto (casts `::uuid` faltantes)

6 raw SQL del subsistema de reembolsos (`refundPayment`, `reconcilePendingRefunds`,
`deferPendingRefundCheck` en `billing.service.ts`) comparaban `WHERE id = $1` sin `::uuid`
contra `billing_payments.id`, que es **UUID nativo** (migración `20260423000000`, línea 95).
Con Prisma eso es `42883 operator does not exist: uuid = text` — error que ya ocurrió en
prod en este codebase (comentario-testigo en `analytics/alerts.service.ts:93`). Los tests
mockean `$executeRawUnsafe`, por eso no lo vieron. Hallado por el agente del motor y
**confirmado de forma independiente** por el barrido transversal.

- **Impacto**: `POST /billing-admin/payments/:id/refund` devolvía 500 en el **primer**
  query (la reserva optimista) — falla *segura*: nunca llegó a tocar al proveedor, sin
  plata movida ni estado corrupto. Pero el reembolso inline no funcionaba.
- **Fix**: `::uuid` en los 6 (`billing.service.ts:1691,1754,1784,1798,1927,1971`). El resto
  del módulo ya era consistente (11 interpolaciones `::uuid` correctas en el engine).
- **Post-deploy**: probar el botón de refund con un pago real — hoy nadie lo cubre contra
  una base real.

### 1.3 P1 — Coherencia del alcance comercial en la MISMA fila de snapshot

Dos huecos que habrían hecho incoherente el primer snapshot post-fix:

- **Churn fantasma**: los movimientos de MRR comparan contra `tenant_financial_snapshots`
  del mes anterior, que (pre-alcance) incluyen tenants internos → habrían aparecido como
  MRR churneado. Fix: nuevo helper `internalTenantIds()` en `commercial-scope.util.ts`
  (para modelos sin relación `tenant`) aplicado en la comparación.
- **`newCustomers`/`trialsStarted` sin filtrar** mientras `activeCustomers`/`revenue` sí:
  fix `isInternal: false` en el count.
- También `getTenantProfitability` excluye ahora filas históricas de tenants internos.

### 1.4 P1 — `/admin/tenants` contradecía a `/admin/financials`

`tenants.service.ts::getPlatformBilling()` (panel Billing de `/admin/tenants`) calculaba
MRR, revenue total, pagos recientes y fallidos **sin** alcance comercial — implementación
paralela a `financials.getOverview()`. Fix: `COMMERCIAL_SUBSCRIPTIONS`/`COMMERCIAL_PAYMENTS`
en las 4 queries. Ambas superficies reportan ahora el mismo universo.

### 1.5 P2 — Badge "interno" muerto en el listado de tenants

La lógica del badge existía (`TenantsOverviewTab.tsx:254`) pero nunca se renderizaba:
el `select` de `findAll` no traía `isInternal` **y** el mapper del page.tsx tampoco lo
copiaba. Fix en ambos lados (sin strings nuevos — i18n ya existía). Ahora el dueño ve
qué filas están fuera de las métricas.

---

## 2. Confirmado, pendiente de decisión (no tocado)

| # | Sev | Qué | Dónde | Decisión que bloquea |
|---|-----|-----|-------|----------------------|
| 1 | **P1 métricas** | `revenueCollectedCents` suma `amountCents` crudos **mezclando monedas** (motor Wompi graba COP; MRR/costos LLM/infra en USD). El margen bruto de `/admin/financials` → Costs divide USD por COP. Existe `ExchangeRate` + su endpoint, pero el snapshot no la usa. Predata a Wompi (era MP igual). | `financial-snapshot.service.ts:89` y derivados (`getCostsTrend`, `tenant-profitability`, `totalRevenue` de platform-billing) | ¿Normalizar a USD al snapshotear (tasa del día de `paidAt`, fallback última) y guardar el desglose por moneda en JSON? Requiere mantener tasas cargadas. |
| 2 | P2 | `getPlatformStats()` (conteos de tenants en `/admin/tenants`) incluye internos. Defendible: es inventario de plataforma y ahora el badge los distingue en la lista. | `tenants.service.ts:1209-1337` | ¿Conteos = plataforma o comercial? Si comercial: 1 línea por count. |
| 3 | P2 | `getActivationMetrics()` (SQL crudo) cuenta tenants internos en activación/TTFV — contamina la métrica que el onboarding optimiza. | `financials.service.ts:227+` | Recomendado filtrar `is_internal = false` (2 WHEREs). |
| 4 | P2 | `listPlans`/`getPlan` cuentan tenants por plan incluyendo internos en `/admin/plans`. | `billing-admin.controller.ts:131-135,158-160` | Igual que #2. |
| 5 | P2 | Vistas cross-tenant de `/admin/billing-ops` sin filtrar — **probablemente intencional** (son las queries del runbook llevadas al panel; un operador debuggeando quiere ver TODO). | `billing-admin.controller.ts:536-635` | Confirmar intención; a lo sumo un aviso en la UI de que difiere de financials. |
| 6 | P2 dormido | Stripe adapter: evento no reconocido se normaliza como `SUBSCRIPTION_CREATED` (sin tenant) → filas mal etiquetadas + evento fantasma a listeners. Hoy inalcanzable (Stripe dormido). | `stripe.adapter.ts:247-252` | Arreglar ANTES de despertar el riel internacional. |
| 7 | P2 dormido | `billingPayment.create` del camino nativo (suscripciones del proveedor) sin catch `P2002` → un `providerPaymentId` repetido con event id distinto rollbackea la transacción incluida su marca de idempotencia → retry-loop de webhook hasta que Stripe se rinde. Solo camino Stripe. | `billing.service.ts:~2320` | Idem #6 — mismo patrón try/catch-P2002 que ya usa el resto del método. |
| 8 | P2 | `getRestrictionStatus()` (banner de gracia del tenant) deriva días SOLO del espejo Redis `offboard:past_due:*`; la fuente durable es `dunningStartedAt` (Postgres). Si Redis pierde la clave, el tenant ve "10 días" estando a horas del lock real (el lock real no se afecta). | `billing.service.ts:2460-2502` | Derivar de `dunningStartedAt` y usar Redis como caché. |

## 3. Nits (P3)

- `proration.service.ts:7-13` — comentario promete que el remanente bajo el mínimo "va a
  crédito"; el código lo condona (`creditGeneratedCents: 0`, tope ~2.000 COP cents). Alinear
  comentario o comportamiento.
- `renewal-scheduler.service.ts:380-402` — `deferAttemptToNextDay()` sin callers; documenta
  un mecanismo de diferimiento que NO es el vivo (el real reprograma el mismo attempt en
  `renewal-charge.processor.ts`). Borrar.
- `BillingChargeAttempt.fxRate`/`amountUsdCents` — columnas sin ningún lector/escritor
  (reservadas para el FX que el pendiente #1 necesitaría — o borrarlas).
- Script `migrate-mercadopago-to-wompi.js` — mover filas CON mandato vivo es su propósito
  documentado (y el audit que deja bloquea deploys hasta resolución humana), pero un flag
  explícito `--include-live-mandates` evitaría un `--apply` distraído. *(El agente lo
  reportó P2; rebajado tras leer el docblock: es diseño deliberado con forcing function.)*
- `stripe/billing` — `railEnvironment()` devuelve `'unknown'` para no-Wompi → con
  `isProviderReady` exigiendo `'production'`, Stripe despertaría en `blocked_config`
  permanente. Nota para el día que se active.
- 7 `where` dinámicos `any`/`Record<string,any>` en módulos de plata (listSubscriptions/
  listPayments/listEvents, coupons.list, incident.list, fiscal listInvoices, tenants
  findAll/getAuditLogs) — hoy todos válidos; sin `satisfies` no hay guardia a futuro.
- `FiscalInvoice.status` — el comentario del schema omite `skipped`/`blocked_config` que el
  código sí escribe.
- `apps/e2e/playwright.config.ts:23` — `NEXT_PUBLIC_MP_PUBLIC_KEY` muerta (nadie la lee).
- `docs/facturacion-activacion-factus.md` §5 (sin commitear) menciona disparar el pago de
  prueba "con MercadoPago de prueba" — MP está retirado; actualizar al simulador Wompi.
- `financial-snapshot`: `monthEnd` usa `lte 23:59:59.000` (pierde el último segundo del
  mes, cosmético); `trialsConverted` hardcodeado en 0 → conversión de trial siempre 0%.

---

## 4. Verificado OK (evidencia positiva)

**Motor de recurrencia** — la idempotencia real es estructural, no de locks:
`UNIQUE(cycle_key, attempt_number)` + `claimAttempt` que captura P2002 + UPDATEs guardados
por status + `FOR UPDATE`/`FOR KEY SHARE` en settle; `CronLockService` documenta fail-open y
el diseño no depende de él. Ancla de día con clamp de febrero SIN arrastre (`period.util.ts`).
Montos congelados (`chargeAmountCents`) — "the engine must never invent a price at charge
time". Switch `engine` respetado en scheduler/revalidate/dunning/arming. Dunning se resetea
en pago exitoso y no expira con cobro en vuelo (`hasLiveAttempt`). Prorrateo en moneda de
cobro sobre `paidCents` real, bajo `FOR UPDATE` + `operationKey` estable.

**Webhooks** — allowlist `['wompi','stripe']`; checksum Wompi dinámico con campos mínimos
por tipo; **nunca confía en campos no firmados** (re-consulta el recurso canónico por id
firmado); `UNIQUE(provider, provider_event_id)` + lock con ownership-token (release Lua).

**Refund** (post-fix) — reserva optimista contra doble-click, void-only re-leído del
proveedor exigiendo `VOIDED` canónico antes de declarar éxito, reconciliador durable con
backoff, y **nota de crédito fiscal** disparada por `PAYMENT_REFUNDED` (la factura DIAN no
queda viva sobre plata devuelta).

**Fiscal (Factus/DIAN)** — sellado histórico del entorno del riel en el pago (no consulta
viva), freno ante `sandbox` explícito, `assertEnvironmentAligned` cruza base URL vs config,
skips (`tenant_internal_use`/`test_mode_payment`/`no_consideration`) como filas auditables
manteniendo `UNIQUE(payment_id)`, replay-safe, lock Redis 30min, 400/422 terminal sin
reintento DIAN, cron :17/:47 reconcilia huérfanos. Consecutivos solo para ventas reales.

**Cupones** — solo `free_months` (service + DTO + validate), canje en UNA transacción que
corre `trialEndsAt`/`currentPeriodEnd`/`nextChargeAt`, rechazo con mandato vivo, gobernanza
con cuota mensual + motivo + PIN del dueño (env-only, `timingSafeEqual` sobre SHA-256),
ambos puntos de entrada (onboarding y panel) por el mismo camino, revoke restaura estado.

**Retiro de MercadoPago** — factory sin caso MP (falla fuerte), listas ruteable vs legado
separadas, parsers que ignoran filas viejas, gate de deploy en DOBLE capa (bash + PL/pgSQL)
contando mandatos varados sin resolver, los 5 defectos del barrido de agosto cerrados en el
código de hoy, cero env vars MP en `deploy.yml`, dashboard sin `MpCardForm`.

**SMS checkout** — `GoneException` en controller + kill-switch en service + ledger
idempotente por `(reason, ref)`; el ajuste manual es super_admin con motivo.

**tenant-payments** — AES-256-GCM con AAD que ata tenant+proveedor+ambiente+campo, clave
dedicada con rotación, cero acoplamiento al billing de plataforma.

**deploy.yml** — llaves Wompi validadas con prefijo de producción, topes de transacción
obligatorios, Factus forzado a HTTPS de producción, `WOMPI_ALLOW_SANDBOX_IN_PRODUCTION=false`.

**Transversal** — la clase del bug semilla está **cerrada**: no existe ningún otro spread
de constante en queries Prisma en el monorepo; no quedan casts `::uuid` faltantes sobre
columnas UUID reales (el `tenant_id` de `daily_metrics` es VARCHAR — sin cast a propósito);
cero type-arguments en `$queryRawUnsafe`; snake_case consistente; `analytics/` y `bi-api/`
no tocan las tablas de plata; `apps/whatsapp` no toca billing.

---

## 5. Operativa post-deploy (en orden)

1. Commit + push de los 6 archivos → deploy normal.
2. `/admin/financials` → Settings → **Generar snapshot** con `2026-08` (y solo ese mes).
3. Probar el **refund inline** con un pago real de bajo monto (antes daba 500).
4. Verificar en `/admin/tenants` que MRR/revenue ahora coinciden con `/admin/financials`
   y que el badge "interno" aparece en las filas correspondientes.
5. Agendar las decisiones de la sección 2 (la #1 — monedas — es la que más distorsiona
   lo que ve el dueño hoy).
