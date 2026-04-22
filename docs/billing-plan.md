# Parallly Billing — Diagnóstico y Plan de Ejecución

**Fecha de creación:** 2026-04-21
**Última actualización:** 2026-04-22 (decisiones confirmadas + Sección 9 + Sprint 1)
**Estado:** Plan confirmado — listo para ejecutar Sprint 1
**Provider inicial:** MercadoPago (con abstracción para swap futuro a Stripe)
**Países objetivo:** AR, BR, CL, CO, MX, PE, UY (resto: vía Stripe en fase futura)
**Moneda:** USD como catálogo, cobro en moneda local al equivalente del día
**Entidad legal Parallly:** Delaware LLC (recomendación — ver Sección 9)

---

## 1. Diagnóstico de plataforma

### 1.1 Lo que YA existe

| Componente | Ubicación | Estado |
|---|---|---|
| `Tenant.plan` (string, default `'starter'`) | `apps/api/prisma/schema.prisma:30` | ✅ Vivo |
| `PLAN_LIMITS` (starter/pro/enterprise) | `apps/api/src/modules/throttle/tenant-throttle.service.ts:27-38` | ✅ Rate limits por plan aplicados |
| `PLAN_FEATURES` (starter/pro/enterprise/custom) | mismo archivo | ✅ Los 4 planes requeridos ya están definidos |
| UI gate de agentes (`maxAgents`) | `apps/dashboard/src/app/admin/agent/page.tsx:114-119` | ✅ Funciona en UI |
| Redis cache de plan (TTL 5min) | `tenant_plan:{tenantId}` | ✅ |
| Patrón webhook HMAC | `apps/api/src/modules/channels/meta-signature.util.ts` | ✅ Reutilizable para MP |
| BullMQ + cron jobs | varios processors | ✅ Apto para reconciliación y trial expiry |
| Email templates auto-seed | `email-templates/email-templates.service.ts` | ✅ Agregar templates de billing |

### 1.2 Lo que falta (punch list)

1. **Sin módulo de billing.** 0 archivos. Hoja en blanco.
2. **Sin campos de subscripción en `Tenant`.** Faltan `subscriptionStatus`, `trialEndsAt`, `currentPeriodEnd`, `paymentProviderCustomerId`, `subscriptionId`, `billingEmail`, `billingCountry`.
3. **Sin enforcement server-side del `maxAgents`.** `PersonaService.createAgent()` no valida plan — la UI es la única barrera. **Vulnerabilidad:** se esquiva vía llamada API directa.
4. **Sin templates de email de billing:** no existen `trial_started`, `trial_ending_soon`, `trial_ended`, `payment_succeeded`, `payment_failed`, `subscription_cancelled`.
5. **Sin página `/admin/settings/billing`.** No hay UI para plan, trial, tarjeta, facturas.
6. **Onboarding no pregunta plan.** Arranca en `starter` hardcoded.
7. **Sin webhook endpoint genérico de billing** (`POST /api/v1/billing/webhook/:provider`).
8. **Sin integración fiscal** (AFIP/SAT/DIAN/SII/NFS-e). MP cobra, pero no factura.

---

## 2. Arquitectura propuesta — desacoplamiento total

### 2.1 Principio

Ni una línea de código de negocio debe saber que existe MercadoPago. Todo pasa por una **interfaz `IPaymentProvider`** y un **bus de eventos normalizados**. Para agregar Stripe más adelante: se agrega un adapter y se rutea por país/tenant. Cero cambios en `BillingService` ni en el resto del sistema.

### 2.2 Diagrama de capas

```
┌─────────────────────────────────────────────────────────┐
│  BillingService  (pure business logic, provider-agnostic)│
│  - createTrialSubscription(tenantId, planId)             │
│  - upgradeSubscription(tenantId, newPlanId)              │
│  - cancelSubscription(tenantId, opts)                    │
│  - handleBillingEvent(normalizedEvent)                   │
└───────┬─────────────────────────────────────────────────┘
        │ uses
        ▼
┌─────────────────────────────────────────────────────────┐
│  IPaymentProvider  (interface — the swap boundary)       │
│  - createPlan / createSubscription / cancelSubscription  │
│  - parseWebhookEvent → returns NormalizedBillingEvent    │
│  - verifyWebhookSignature                                │
└───────┬─────────────────────────────────────────────────┘
        │ implemented by
        ▼
┌──────────────────┐    ┌──────────────────┐
│ MercadoPagoAdapter│    │ StripeAdapter   │  (future)
│ (phase 2)         │    │ (phase 4+)       │
└──────────────────┘    └──────────────────┘
```

### 2.3 Interfaz `IPaymentProvider`

```typescript
interface IPaymentProvider {
  // Customer
  createCustomer(data: CreateCustomerInput): Promise<ProviderCustomer>;
  updatePaymentMethod(customerId: string, token: string): Promise<void>;

  // Subscription lifecycle
  createSubscription(data: CreateSubscriptionInput): Promise<ProviderSubscription>;
  cancelSubscription(id: string, opts?: { immediate: boolean }): Promise<void>;
  pauseSubscription(id: string): Promise<void>;
  resumeSubscription(id: string): Promise<void>;
  changeSubscriptionPlan(id: string, newPlanId: string): Promise<ProviderSubscription>;

  // Plan catalog
  createPlan(data: CreatePlanInput): Promise<ProviderPlan>;

  // Webhooks
  verifyWebhookSignature(payload: string, headers: Record<string, string>): boolean;
  parseWebhookEvent(payload: string, headers: Record<string, string>): NormalizedBillingEvent;

  // Reconciliation
  getSubscription(id: string): Promise<ProviderSubscription>;
  listCustomerSubscriptions(customerId: string): Promise<ProviderSubscription[]>;
}
```

**Nota sobre MP:** no tiene concepto de "customer" — la identidad del pagador es implícita en el `preapproval`. En el `MercadoPagoAdapter`, `createCustomer` será un no-op (solo registra localmente); `createSubscription` hace el trabajo real.

### 2.4 Taxonomía de eventos normalizados

Ambos MP y Stripe (futuro) deben mapear sus webhooks a uno de estos eventos internos:

```
billing.subscription.created
billing.subscription.activated        (trial terminó, cobro exitoso)
billing.subscription.past_due         (pago falló, reintentando)
billing.subscription.cancelled
billing.subscription.expired
billing.subscription.plan_changed
billing.payment.succeeded
billing.payment.failed
billing.payment.refunded
billing.trial.started
billing.trial.ending_soon             (sintético: 3 días antes del fin de trial)
billing.trial.ended
```

El resto del sistema (emails, analytics, feature gates) solo escucha estos eventos — nunca los strings crudos de MP.

### 2.5 Máquina de estados de subscripción

```
pending_auth ──► trialing ──► active ──► past_due ──► cancelled ──► expired
                                 ▲          │             │
                                 └──────────┘             ▼
                              (retry OK)              (no recovery)
```

**Crítico:** los estados internos **no son** los de MP (MP usa `authorized/paused/cancelled`). El `MercadoPagoAdapter` traduce.

### 2.6 Persistencia — tablas nuevas en schema global

Ubicación: **schema global** (no per-tenant — billing cruza tenants).

| Tabla | Campos clave | Propósito |
|---|---|---|
| `billing_plans` | `id`, `slug` (starter/pro/enterprise/custom), `name`, `price_cents`, `currency`, `trial_days`, `mp_plan_id`, `stripe_plan_id`, `is_active` | Catálogo + mapping a IDs de providers |
| `billing_subscriptions` | `id`, `tenant_id`, `plan_id`, `status` (enum interno), `trial_ends_at`, `current_period_end`, `provider`, `provider_subscription_id`, `provider_customer_id`, `cancel_at_period_end` | Estado actual por tenant |
| `billing_events` | `id`, `tenant_id`, `provider`, `provider_event_id` (unique), `event_type` (enum interno), `payload JSONB`, `processed_at` | Log append-only + idempotencia + auditoría |
| `billing_payments` | `id`, `subscription_id`, `amount_cents`, `currency`, `status`, `provider_payment_id`, `invoiced_at`, `invoice_number`, `invoice_pdf_url` | Historial para dashboard + facturación fiscal |

Campos a agregar al `Tenant` existente:
- `billingEmail` (string, nullable — puede diferir del email de admin)
- `billingCountry` (ISO code — decide routing de provider futuro)

### 2.7 Idempotencia de webhooks

Reutilizando patrón existente:
```
idem:billing:{provider}:{eventId}  → TTL 48h
```
MP documenta retries por 4 días — dedupe obligatorio. Ver [sdk-php#576](https://github.com/mercadopago/sdk-php/discussions/576).

### 2.8 Reconciliación (crítico por MP)

La investigación técnica identificó **falla reportada de webhooks de suscripción en producción** — eventos `subscription_preapproval` que nunca llegan. Estrategia:

- **Webhook = camino feliz.** Procesamos, emitimos evento normalizado, actualizamos DB.
- **Cron diario a las 03:00** (`@Cron('0 3 * * *')`): `GET /preapproval/search?external_reference=...` para todas las subs activas. Reconciliamos `summarized.semaphore` (green/yellow/red) y `summarized.pending_charge_amount` con nuestro estado.
- **Cron por hora** para subs en `past_due`: chequeo de retry + eventual suspensión.

---

## 3. Estructura de 4 planes + trials

### 3.1 Planes

| Plan | Precio/mes | Seats | Trial | AI msgs/mo | Features destacadas |
|---|---|---|---|---|---|
| **Starter** | USD $49 | 3 | **7 días** | 5.000 | 1 agente, 1 canal, 2 servicios agenda, 5 reglas automation |
| **Pro** | USD $129 | 5 | **15 días** | 25.000 | 3 agentes, unlimited canales/contactos/reglas, templates custom |
| **Enterprise** | USD $349 | Unlimited | **15 días** | 100.000 | 10 agentes, SSO, audit log, priority support |
| **Custom** | Cotización | Unlimited | **Sin trial** (sales-led) | Negociado | Agencias/resellers, multi-tenant sub-accounts, unlimited agents |

### 3.2 Mapeo de trials
- **Starter → 7 días**: tier de entrada, decisión rápida, fricción mínima.
- **Pro y Enterprise → 15 días**: más features que evaluar, tickets más altos justifican más tiempo.
- **Custom → 0 días**: sales-led, onboarding negociado.

### 3.3 Modelo de trial en MP

MP **sí tiene `free_trial` nativo** en `auto_recurring`:
```jsonc
"free_trial": { "frequency": 7, "frequency_type": "days", "first_invoice_offset": 0 }
```
Ventaja: no almacenamos el token de tarjeta (MP los expira en minutos). MP gestiona trial→cobro automáticamente. Nosotros escuchamos `billing.trial.ended` y reaccionamos.

### 3.4 Comportamiento al vencer el trial

| Situación | Resultado |
|---|---|
| Tarjeta registrada + cobro OK | `trialing → active` |
| Tarjeta falla | `trialing → past_due` → reintento MP → si falla final → `cancelled` + read-only |
| Sin tarjeta al arrancar trial | Opción A: bloqueamos en `pending_auth` hasta registrar método. Opción B: permitimos empezar trial y pedimos tarjeta al día 5. Decisión pendiente del founder. |

### 3.5 Post-trial sin pago (confirmado)

**No hay tier gratuito permanente.** Al expirar sin pagar:
- **Días 1–7 post-expiry**: acceso read-only (ver dashboard y responder inbox manual; **sin** mensajes nuevos del bot, broadcasts o automations).
- **Día 8+**: tenant marcado `suspended`, schema preservado **15 días** adicionales, luego archivado.

**Ventana total de recuperación: 22 días desde fin de trial** (7 read-only + 15 de retención). Esto reduce el problema de storage/backup de tenants muertos manteniendo una ventana razonable para que el cliente vuelva a activarse.

---

## 4. Plan de ejecución — 5 fases, ~6–8 semanas

### Fase 1 — Fundación (semanas 1–2)
Objetivo: arquitectura lista, sin provider aún. Todo testeable con mocks.

- [ ] Crear módulo `apps/api/src/modules/billing/` con estructura: service, controller, adapters/, dto/, processor/
- [ ] Migraciones Prisma: campos nuevos en `Tenant` + crear `billing_plans`, `billing_subscriptions`, `billing_events`, `billing_payments`
- [ ] Definir `IPaymentProvider` interface + tipos normalizados (`NormalizedBillingEvent`, `ProviderSubscription`, etc.)
- [ ] Implementar `BillingService` con lógica pura (usa solo `IPaymentProvider`)
- [ ] Emit `EventEmitter2` con taxonomía normalizada (aunque nadie escuche aún)
- [ ] **Fix server-side gate del `maxAgents`** en `PersonaService.createAgent()` (patch de seguridad, desbloquea antes de MP)
- [ ] Seed de `billing_plans` con los 4 tiers + precios + trial_days

### Fase 2 — MercadoPago adapter (semanas 3–4)
- [ ] Instalar SDK (`mercadopago` v2.12.1) + validar soporte preapproval. Si no, evaluar `mercadopago-extended` o HTTP directo.
- [ ] Implementar `MercadoPagoAdapter` con los 10 métodos de `IPaymentProvider`
- [ ] Crear `preapproval_plan` en MP sandbox (4 planes × 7 países = 28 plan IDs, guardar mapeo en `billing_plans`)
- [ ] Controller: `POST /api/v1/billing/webhook/mercadopago` con validación HMAC-SHA256 (`x-signature`) + idempotencia Redis
- [ ] Cron de reconciliación (horario para `past_due`, diario full sweep)
- [ ] Testing end-to-end con [Webhook Simulator](https://www.mercadopago.com.pe/developers/en/news/2024/01/11/Webhooks-Notifications-Simulator-and-Secret-Signature) + test cards (`APRO`, `FUND`, `SECU`, `OTHE`)

### Fase 3 — Integración con flujo de producto (semana 5)
- [ ] Onboarding: step 5 "Elegí tu plan" antes de `/admin`. Opción "empezar trial" crea subscription en MP con `free_trial`
- [ ] Dashboard: `/admin/settings/billing/page.tsx` — plan actual, días de trial restantes, tarjeta registrada, facturas, upgrade/downgrade/cancel
- [ ] Banner global en layout: "Te quedan X días de trial — agregá método de pago" (dismissible pero recurrente)
- [ ] Wire eventos → emails: 5 templates nuevos (`trial_started`, `trial_ending_soon`, `trial_ended`, `payment_succeeded`, `payment_failed`)
- [ ] **Server-side enforcement en TODOS los gates**: agentes (fix de fase 1), services limit, automation rules limit, broadcast campaigns limit, AI message quota

### Fase 4 — Facturación fiscal (semanas 6–7)
MP cobra pero no factura. Cada país tiene requisitos distintos:

| País | Requisito | Tool recomendado |
|---|---|---|
| Argentina | Factura Electrónica (AFIP/ARCA) | TusFacturas, Facturapi AR |
| México | CFDI vía PAC certificado | Facturapi, Facturama |
| Brasil | NFS-e (por municipio o nacional desde 2026) | Conta Azul, Omie, API municipal |
| Colombia | Factura electrónica DIAN | Alegra, Siigo |
| Chile | Documento Tributario Electrónico (SII) | Facturapi CL |
| Perú | Comprobante Electrónico SUNAT | Nubefact |
| Uruguay | e-Factura DGI | Alegra, ZureoTec |

Estrategia: **Facturapi primero** (cubre MX + CL + AR). Alegra como segundo gateway (CO + PE). Disparo desde evento `billing.payment.succeeded`. **Requisito de no-lanzamiento sin esto** en países con fiscalización estricta (MX, BR, AR).

### Fase 5 — Beta + hardening (semana 8)
- [ ] Feature flag: billing habilitado por tenant, activar gradualmente
- [ ] Correr ioffi (cliente actual) como primer tenant piloto
- [ ] Load testing de webhooks (1000 eventos/min simulados)
- [ ] Runbook de ops: webhook fail, refund manual, cambio de plan manual, suspensión manual
- [ ] Monitoreo: alertas Sentry en `billing.payment.failed` > threshold, en webhook signature mismatch, en cron reconciliation diff > N

---

## 5. Costos de transacción (input a pricing)

| País | Tarjeta crédito | Tarjeta débito | Settlement |
|---|---|---|---|
| México | ~3,49% + MXN $4 | ~2,95% + MXN $4 | 2–14 días hábiles |
| Argentina | 1,49%–6,29% (según provincia + tipo de tarjeta) | Menor | Variable; instant sale más caro |
| Brasil | ~4,99% (crédito 1 cuota, payout inmediato) | Menor | Pix aún más barato |
| Colombia | ~3,29% + COP $500 | ~2,99% | 2–5 días |
| Chile | ~3,19% + CLP $200 | ~2,89% | 2 días |

**vs Stripe LatAm**: Stripe ~3,6% + MXN $3 en MX, no disponible como adquirente local en AR, sin OXXO/SPEI/Boleto para suscripciones. Su lógica de billing es superior, pero la cobertura de métodos locales en LatAm es dramáticamente inferior. **Mantener MP como primario para LatAm; Stripe como secundario para cross-border/internacional.**

Fuentes:
- [MP AR fees](https://www.mercadopago.com.ar/ayuda/26748)
- [Stripe Pricing](https://stripe.com/pricing)
- [Marketon MX gateway comparison](https://marketon.mx/en/blogs/inicio/pasarelas-pago-mexico-comparadas)

---

## 6. Pitfalls conocidos de MercadoPago (mitigación)

1. **Webhooks de subscripción a veces nunca llegan en producción** ([sdk-php#576](https://github.com/mercadopago/sdk-php/discussions/576), [foro#10](https://github.com/MercadoPagoCommunity/foro/issues/10)).
   → *Mitigación:* Reconciliación cron obligatoria. Nunca confiar solo en webhook.
2. **x-signature validation difiere entre sandbox y producción** ([sdk-nodejs#318](https://github.com/mercadopago/sdk-nodejs/discussions/318)).
   → *Mitigación:* Loguear headers crudos en el primer deploy, testear validación en staging real antes de prod.
3. **Sandbox no envía webhooks reales** — solo vía Simulator.
   → *Mitigación:* Tests e2e en producción con montos mínimos + refund posterior.
4. **Retry behavior de tarjetas declinadas es opaco** (sin docs de cantidad/intervalos).
   → *Mitigación:* Poll `GET /preapproval/{id}` y leer `summarized.semaphore` (`green`/`yellow`/`red`).
5. **Time-jumping no soportado** para testear trials.
   → *Mitigación:* Crear `preapproval_plan` de testing con `frequency: 1, frequency_type: "days"` y esperar 24h.

---

## 7. Decisiones confirmadas (2026-04-22)

| # | Decisión | Resolución |
|---|---|---|
| 1 | **Moneda de cobro** | ✅ **USD como catálogo**, cobro al equivalente en moneda local. Actualizamos tabla de conversión mensualmente en `billing_plans.price_local_overrides JSONB` por país |
| 2 | **Tarjeta para trial** | ✅ **Starter sin tarjeta (7 días), Pro/Enterprise con tarjeta (15 días), Custom sin trial** |
| 3 | **Post-trial sin pago** | ✅ **7 días read-only + 15 días retención + archivo** (ver 3.5 actualizado) |
| 4 | **Plan Custom** | ✅ **Manual por super-admin**, sin pasar por MP. Endpoint protegido con role `super_admin`. Se revisará al integrar Stripe |
| 5 | **Facturación fiscal** | ✅ **Recibo simple día 1 en todos los países**. Facturapi (MX+CL+AR) en Fase 4. **No se vende en Brasil hasta tener NFS-e** |
| 6 | **Documentación** | ✅ `docs/billing-plan.md` + Sección 9 (facturación legal) agregada |

---

## 8. Próximos pasos inmediatos

✅ Decisiones confirmadas (ver Sección 7).
▶ **Arrancando Sprint 1** (Fase 1 — Fundación, 2 semanas). Task breakdown detallado en Sección 10.
⏭ Punto de sync al final de Sprint 1 antes de tocar MP en Sprint 2.

---

## 9. Facturación legal y modelo de entidad

### 9.1 La realidad del SaaS internacional en LatAm

Los SaaS globales (Notion, Slack, Figma, Zoom, Shopify) **sí emiten documento oficial**, pero en formato del país donde están constituidos — no es la "factura electrónica DIAN/CFDI/AFIP" local. Lo que hace legal ese recibo es que el proveedor esté registrado como **"prestador no-residente de servicios digitales"** en cada país donde vende.

### 9.2 Esquema por país

| País | Régimen para no-residentes | Tasa IVA | Qué emite el SaaS | Herramienta |
|---|---|---|---|---|
| **Colombia** | IVA sobre servicios desde el exterior (DIAN, desde 2018) | 19% | Invoice propio con línea IVA; deducible si registrado | Alegra si local / Quaderno si foreign |
| **México** | Ley IVA — prestadores extranjeros (desde 2020). [Lista pública SAT](https://kpmg.com/us/en/taxnewsflash/news/2025/06/tnf-mexico-list-of-registered-foreign-providers-of-digital-services.html) con 260+ empresas (abr 2025) | 16% | Recibo extranjero con IVA desglosado | Facturapi si local / Quaderno si foreign |
| **Argentina** | RG 5554/2024 (sin más retenciones auto). Percepción IVA por tarjeta | 21% | Invoice del extranjero + percepción en resumen | TusFacturas si local / Quaderno si foreign |
| **Chile** | Ley 21.210 — servicios digitales extranjeros (SII) | 19% | Boleta/invoice extranjero | Facturapi CL si local / Quaderno |
| **Brasil** | PIS/COFINS + ISS municipal (NFS-e nacional desde 2026) | 15–18% efectivo | Varía por municipio | **Postergamos Brasil** hasta fase 4 |
| **Perú** | 18% IGV sobre servicios digitales extranjeros (desde 2024) | 18% | Comprobante | Nubefact o Quaderno |
| **Uruguay** | e-Factura DGI para locales; registro voluntario extranjeros | 22% | e-Factura (si local) o invoice extranjero | Zureo Tec si local / Quaderno |

### 9.3 Los 2 caminos — entidad local vs. entidad internacional

#### Camino A — Parallly como entidad colombiana (o de país origen)
- Factura electrónica DIAN obligatoria desde primera venta local.
- Ventas a otros LatAm: exportación de servicios, exento de IVA local, pero cliente puede auto-retener.
- Obliga integración Alegra/Siigo desde día 1.
- **Ventajas:** simple en país propio, FX mínimo.
- **Desventajas:** fricción regional, tributación local completa, menos atractivo para inversión.

#### Camino B — Parallly como entidad internacional (Delaware LLC / Wyoming C-Corp) ✅ RECOMENDADO
- Operás como "proveedor extranjero de servicios digitales" en cada país.
- Registro voluntario en DIAN/SAT/SII/AFIP según volumen (umbrales por país).
- Emitís **tu propio invoice** en español/inglés con IVA del país del comprador.
- **No** necesitás factura electrónica local.
- **Ventajas:** una sola entidad para LatAm + internacional, stack fiscal simple, atractivo para inversores, escalable.
- **Desventajas:** setup inicial ~USD 2K–5K con abogado contable, registro país por país, algunos clientes locales no entienden que el invoice extranjero sí es válido.

### 9.4 Estrategia fiscal por fase de crecimiento

| Fase | MRR | Estrategia fiscal | Tool |
|---|---|---|---|
| **Lanzamiento** (0–10 clientes) | < USD $1K | Recibo PDF propio enviado por email al pagar (no es factura legal, cumple para gasto con tarjeta personal del cliente). Solo país origen. | Código propio generando PDF |
| **Validación** (10–50 clientes) | USD $1K–10K | **Paddle como Merchant of Record** — ellos son el vendedor legal, cobran, facturan, remiten impuestos en cada país. Vos recibís payout neto. Cobran ~5% + $0.50/txn. | [Paddle](https://www.paddle.com/) |
| **Escalado** (50+ clientes) | USD $10K–50K | Entidad Delaware LLC + registro en países top (MX, CO, CL) + MP+Stripe directos + [Quaderno](https://quaderno.io/) para compliance automático | Quaderno + MP + Stripe |
| **Consolidación** | USD $50K+ | Registros fiscales en todos los países top, equipo contable dedicado, posiblemente subsidiaria local en mercados grandes (MX, BR) | Fonoa + contadores locales |

### 9.5 Recomendación concreta para Parallly hoy

1. **Entidad legal**: Constituir **Delaware LLC o Wyoming C-Corp** (costo ~USD 300–800 vía [Stripe Atlas](https://stripe.com/atlas) o [Firstbase](https://firstbase.io/)). Esta es **decisión estratégica del founder**, pero la recomendación es clara.
2. **Fase Lanzamiento (ya)**: emitir recibo PDF propio al cobrar. Código nuestro, sin integración externa. Suficiente para los primeros 10 clientes.
3. **Fase Validación**: evaluar **Paddle (Merchant of Record)** si querés cero compliance overhead mientras validás el producto. Acepta el 5% extra a cambio de no tocar fiscalidad.
4. **Fase Escalado (meta Q4 2026)**: migrar a MP + Stripe directos con **Quaderno** automatizando IVA digital en cada país.
5. **Brasil = último**. Tiene la complejidad más alta (NFS-e municipal × 5.500 municipios hasta 2025, nacional desde 2026). Solo entrar cuando haya infraestructura madura.

### 9.6 Qué implica esto para el plan técnico (Secciones 1–8)

- El módulo `billing` no cambia — sigue emitiendo el recibo al cobrar MP exitosamente.
- El `billing_payments` con `invoice_pdf_url` puede inicialmente apuntar a un PDF que generamos nosotros (template simple con logo, datos del cliente, monto, IVA si aplica, identificador interno).
- En Fase 4 conectamos Facturapi/Alegra/Quaderno al evento `billing.payment.succeeded` cuando decidamos qué camino tomar.
- **No bloquea Sprint 1**. Seguimos.

---

## 10. Sprint 1 — Kickoff (Fase 1: Fundación, 2 semanas)

**Objetivo:** arquitectura de billing lista, sin provider aún, con todo testeable vía mocks. Al final del sprint tenemos: schema actualizado, módulo scaffolding, interfaz del provider, BillingService con lógica pura, enforcement de `maxAgents` en backend, seeds de los 4 planes, y templates de email base.

### Tarea 1.1 — Schema migration (Prisma)
**Archivos:** `apps/api/prisma/schema.prisma`, nueva migración.
**Cambios al `Tenant`:**
```prisma
model Tenant {
  // ... campos existentes
  billingEmail              String?
  billingCountry            String?   // ISO 3166-1 alpha-2
  subscriptionStatus        String?   @default("none") // none|trialing|active|past_due|cancelled|expired
  subscriptionId            String?   @unique
  trialEndsAt               DateTime?
  currentPeriodEnd          DateTime?
  paymentProviderCustomerId String?
  paymentProvider           String?   // mercadopago|stripe
}
```
**Tablas nuevas:** `billing_plans`, `billing_subscriptions`, `billing_events`, `billing_payments` (esquemas detallados en Sección 2.6).
**Verificación:** `npx prisma migrate dev --name add-billing` en dev → corre clean.

### Tarea 1.2 — Módulo `billing/` scaffolding
**Ubicación:** `apps/api/src/modules/billing/`
**Estructura:**
```
billing/
├── billing.module.ts
├── billing.service.ts           ← lógica de negocio pura
├── billing.controller.ts        ← endpoints REST
├── webhook.controller.ts        ← POST /billing/webhook/:provider
├── adapters/
│   ├── payment-provider.interface.ts
│   ├── mock-payment-provider.adapter.ts   ← para tests y dev
│   └── mercadopago.adapter.ts             ← stub por ahora, se implementa en Sprint 2
├── dto/
│   ├── create-subscription.dto.ts
│   ├── change-plan.dto.ts
│   └── webhook-event.dto.ts
├── types/
│   ├── normalized-billing-event.ts
│   ├── subscription-status.enum.ts
│   └── provider-types.ts
└── processors/
    └── reconciliation.processor.ts         ← cron jobs, stub por ahora
```

### Tarea 1.3 — Definir `IPaymentProvider` interface + tipos normalizados
**Archivo:** `adapters/payment-provider.interface.ts`
Definir la interfaz completa según Sección 2.3 + enum `BillingEventType` con los 12 eventos de Sección 2.4 + enum `SubscriptionStatus` con los 6 estados de Sección 2.5.

### Tarea 1.4 — `BillingService` skeleton
**Archivo:** `billing.service.ts`
Métodos a implementar (con lógica real, usando `IPaymentProvider` inyectado):
- `createTrialSubscription(tenantId, planSlug)` → crea row en `billing_subscriptions` con status `trialing`, fechas calculadas del plan, invoca `provider.createSubscription`
- `upgradeSubscription(tenantId, newPlanSlug)` → invoca `provider.changeSubscriptionPlan`
- `cancelSubscription(tenantId, opts)` → marca `cancel_at_period_end = true` o immediate
- `handleBillingEvent(event: NormalizedBillingEvent)` → switch sobre `event.type`, actualiza DB, emite EventEmitter local
- `getActiveSubscription(tenantId)` → lectura

### Tarea 1.5 — Event emitter con taxonomía normalizada
**Integración:** usar el `EventEmitter2` que ya está en el proyecto.
Publicar los 12 eventos de Sección 2.4 cuando `BillingService` actualiza estado. Aunque nadie los escuche todavía, deja el contrato listo para Fase 3.

### Tarea 1.6 — Fix server-side `maxAgents` (quick win de seguridad)
**Archivo:** `apps/api/src/modules/persona/persona.service.ts`, método `createAgent()`.
Agregar:
```typescript
const planFeatures = await this.throttleService.getPlanFeatures(tenantId);
const currentCount = await this.countActiveAgents(tenantId);
if (currentCount >= planFeatures.maxAgents) {
  throw new ForbiddenException({
    error: 'agent_limit_reached',
    message: `Tu plan ${plan} permite hasta ${planFeatures.maxAgents} agentes. Upgrade para agregar más.`,
    currentCount,
    maxAgents: planFeatures.maxAgents,
  });
}
```
Este fix es **independiente de billing**, cierra agujero de seguridad actual, puede mergearse solo.

### Tarea 1.7 — Seed de `billing_plans`
**Archivo:** nuevo `apps/api/prisma/seeds/billing-plans.seed.ts`
Crear los 4 registros:
```typescript
[
  { slug: 'starter', priceUsdCents: 4900, trialDays: 7, requiresCardForTrial: false, maxAgents: 1, ... },
  { slug: 'pro', priceUsdCents: 12900, trialDays: 15, requiresCardForTrial: true, maxAgents: 3, ... },
  { slug: 'enterprise', priceUsdCents: 34900, trialDays: 15, requiresCardForTrial: true, maxAgents: 10, ... },
  { slug: 'custom', priceUsdCents: 0, trialDays: 0, requiresCardForTrial: false, maxAgents: 999, ... },
]
```
`mp_plan_id` queda null — se populan en Sprint 2 cuando creamos los plans reales en MP.

### Tarea 1.8 — Seed de email templates de billing
**Archivo:** `apps/api/src/modules/email-templates/email-templates.service.ts`, extender `DEFAULT_TEMPLATES`.
Agregar 5 templates nuevos con `{{variable}}` placeholders:
1. `billing_trial_started` — bienvenida + fecha fin de trial
2. `billing_trial_ending_soon` — 3 días antes del fin
3. `billing_trial_ended` — trial vencido, cta agregar método
4. `billing_payment_succeeded` — confirmación de cobro + link a recibo PDF
5. `billing_payment_failed` — falla + cta actualizar tarjeta

### Tarea 1.9 — Tests del BillingService con MockPaymentProvider
**Archivo:** `billing.service.spec.ts`
Casos mínimos:
- `createTrialSubscription` persiste row + invoca provider + emite evento
- `handleBillingEvent(payment.succeeded)` transiciona `trialing → active`
- `handleBillingEvent(payment.failed)` transiciona `active → past_due`
- Idempotencia: mismo `provider_event_id` 2 veces → solo procesa 1

### Tarea 1.10 — README del módulo
**Archivo:** `apps/api/src/modules/billing/README.md`
Documentar la arquitectura, cómo agregar un nuevo provider, estado actual (MP pendiente para Sprint 2).

---

### Entregables de fin de Sprint 1
✅ Schema migrado en dev + producción (migración ya corrida)
✅ Módulo `billing/` con scaffolding completo
✅ `IPaymentProvider` interface + `MockPaymentProvider` funcional
✅ `BillingService` con tests verdes (mock-only)
✅ Fix de seguridad de `maxAgents` en producción (mergeable como PR independiente)
✅ Seeds de 4 planes + 5 email templates cargados
✅ README del módulo
❌ Aún NO hay cobro real. MP se integra en Sprint 2.

---

### Riesgos del Sprint 1
- **Migración de schema a tenants existentes**: ioffi ya existe sin estos campos. La migración default-ea `subscriptionStatus = 'none'`. Safe.
- **Tests que rompan en CI**: el MockPaymentProvider debe ser determinístico. Usar jest fake timers para fechas.
- **Interfaz mal diseñada**: si nos equivocamos en `IPaymentProvider`, al agregar Stripe habrá que cambiarla. Mitigación: revisar contra la API de Stripe Subscriptions antes de cerrar Sprint 1.

---

---

## Anexos

- Investigación de mercado LatAm: [`docs/market-research-latam.md`](./market-research-latam.md)
- Fuentes técnicas MP:
  - [Subscriptions Overview](https://www.mercadopago.com.ar/developers/en/docs/subscriptions/overview)
  - [Preapproval Plan reference](https://www.mercadopago.com.mx/developers/en/reference/subscriptions/_preapproval_plan/post)
  - [Webhook Simulator 2024](https://www.mercadopago.com.pe/developers/en/news/2024/01/11/Webhooks-Notifications-Simulator-and-Secret-Signature)
  - [SDK Node.js v2](https://github.com/mercadopago/sdk-nodejs)
- Fuentes fiscales:
  - [ARCA RG 5554/2024 — eliminación retenciones](https://www.argentina.gob.ar/noticias/se-derogaron-los-regimenes-de-retencion-de-iva-y-ganancias-los-cobros-electronicos)
  - [EDICOM Brazil NFS-e 2026](https://edicomgroup.com/electronic-invoicing/brazil)
  - [KPMG Mexico digital services 2025](https://kpmg.com/us/en/taxnewsflash/news/2025/06/tnf-mexico-list-of-registered-foreign-providers-of-digital-services.html)
