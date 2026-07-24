# Analytics, Billing, Financials & Super Admin — Reference

_Actualizado: jul 2026 (v2026-07)._

> Todas las rutas cuelgan del prefijo global `/api/v1`. En este doc se listan sin el prefijo (p. ej. `/dashboard-analytics/…` = `/api/v1/dashboard-analytics/…`).
> Docs relacionados: `docs/billing-annual-cycle.md` (ciclo mensual/anual + precios COP), `docs/superadmin-governance.md` (gobernanza de impersonación), `docs/backup-restore-runbook.md` (backup offsite), `docs/facturacion-electronica-colombia-2026-06.md` (DIAN/Factus), `docs/sms-monetization-packages-2026-07.md` (créditos SMS), `docs/multi-channel-per-type-implementation-2026-07.md` (multi-cuenta por tipo).

---

## Analytics — Dashboard Endpoints (13 total under `/dashboard-analytics/`)

| Endpoint | Purpose |
|----------|---------|
| `GET overview-kpis/:tenantId` | 6 KPIs with automatic period comparison (% change) |
| `GET conversations-volume/:tenantId` | Daily volume stacked by channel |
| `GET response-times/:tenantId` | Median + P90 first response and resolution times |
| `GET ai-metrics/:tenantId` | AI resolution rate, containment, cost, model usage, handoff reasons |
| `GET ai-resolution/:tenantId` | AI resolution rate trend, by-channel breakdown, avg messages to resolution. Params: `start`, `end`, `granularity` |
| `GET heatmap/:tenantId` | 7-day x 24-hour message volume grid |
| `GET export/:tenantId` | Full CSV report download |
| `GET realtime/:tenantId` | Live: active convos, agents online/busy/offline, queue, messages today |
| `GET automation/:tenantId` | Rules count, execution stats, success rate, per-rule performance |
| `GET broadcast/:tenantId` | Campaign funnel (sent→delivered→read→failed) per campaign |
| `GET anomalies/:tenantId` | Z-score analysis, flags deviations >2σ from 30-day average |
| `GET cohorts/:tenantId` | Cohort retention matrix (contacts by first-contact month) |
| `GET appointments/:tenantId` | Appointment analytics (KPIs, daily volume, by service, by source, peak hours) |

## Alerts & Reports (under `/analytics-config/`)

| Endpoint | Purpose |
|----------|---------|
| `GET/POST/PUT/DELETE alerts/:tenantId` | CRUD alert rules |
| `GET alerts/:tenantId/:ruleId/history` | Alert trigger history |
| `GET/POST reports/:tenantId` | Scheduled report config (weekly/monthly email delivery) |
| `GET/POST/PUT/DELETE saved-reports/:tenantId` | Custom report builder — saved report definitions CRUD |
| `GET saved-reports/:tenantId/:reportId` | Single saved report |

## BI API (under `/bi-api/` — X-API-Key auth, no JWT)

| Endpoint | Purpose |
|----------|---------|
| `GET kpis` | KPIs with period comparison |
| `GET time-series` | Conversation volume time series |
| `GET ai-metrics` | AI resolution, containment, cost |
| `GET realtime` | Live stats |
| `GET export` | Full data export |
| `GET anomalies` | Detected anomalies |
| `GET cohorts` | Cohort retention analysis |

---

## Redis Keys

```
analytics:{tenantId}:{YYYY-MM-DD}:conversation_started  — Daily counter (7d TTL)
analytics:{tenantId}:{YYYY-MM-DD}:total                  — All messages/events
analytics:{tenantId}:{YYYY-MM-DD}:handoff_triggered      — Escalation counter
analytics:{tenantId}:{YYYY-MM-DD}:cost                   — LLM cost (float)
analytics:{tenantId}:{YYYY-MM-DD}:model:{modelName}      — Per-model usage
analytics:{tenantId}:{YYYY-MM-DD}:hourly:{0-23}          — Volume per hour
refresh:{userId}:{tokenId}                                — Refresh tokens (8h or 14d TTL)
booking:{conversationId}                                  — Booking engine state (1h TTL)
lock:conv:{conversationId}                                — Conversation processing mutex (30s TTL)
offboard:past_due:{tenantId}                              — Past-due timer start (30d TTL, 7d grace)
tenant_plan:{tenantId}                                    — Cached plan info
handoff:{tenantId}:{conversationId}                       — Handoff state (24h TTL)
vertical:{tenantId}                                       — Vertical config cache (10min TTL)
idem:wa:{id}, idem:ig:{id}, idem:fb:{id}, idem:tg:{id}, idem:sms:{id}  — Webhook idempotency (24h TTL)
idem:email:{messageId}                                     — Email idempotency (24h TTL)
idem:billing:{provider}:{providerEventId}                  — Billing webhook idempotency (48h TTL; MP redelivery window)
backup:last_success                                        — Backup heartbeat (Ops Center alerta si > backupStaleHours, default 26h)
viewing:{tenantId}:{conversationId}                        — ZSET, collision detection viewers (score=timestamp)
agent_viewing:{agentId}                                    — SET, reverse index of conversations an agent is viewing
api_rl:{keyId}:{minuteBucket}                              — Sliding window rate limiter for API keys
api_key:{keyHash}                                          — Cached API key lookup (60s TTL)
email_channel:tables_created                               — DDL cache for email config table (24h TTL)
email_channel:thread_table:{tenantId}                      — DDL cache for email threads (24h TTL)
```

## Tenant Schema Tables (Analytics & CRM)

```
analytics_events       — Event logging (event_type, conversation_id, data JSONB)
daily_metrics          — Pre-aggregated daily stats (dimension_type: global/channel/agent/hourly)
csat_surveys           — Customer satisfaction (1-5 rating + feedback)
conversation_assignments — Agent handoff tracking (first_response_at, resolved_at)
alert_rules            — Threshold alert config
alert_history          — Alert trigger history
scheduled_reports      — Report delivery config
dashboard_preferences  — Widget config per user
automation_executions  — Rule execution audit trail
agent_personas         — Multi-agent config
agent_templates        — Reusable agent templates
calendar_integrations  — External calendar connections (Google/Microsoft)
services               — Bookable services (+ location_type: in_person/online/hybrid)
pipeline_stages        — Configurable pipeline stages
scoring_config         — Lead scoring (weights JSONB, purchase_keywords, decay)
properties             — Vacation rental properties
ical_blocks            — Blocked periods imported from external iCal feeds
ical_feeds             — iCal feed URLs to import
property_bookings      — AI-created bookings for vacation rentals
drip_sequences         — Drip campaign sequence definitions (steps, delays, conditions)
drip_enrollments       — Contact enrollments in drip sequences (status, current step)
automation_secrets     — Encrypted secrets for automation HTTP actions
kb_feedback            — Knowledge base article feedback (thumbs up/down, comments)
pipelines              — Named pipeline definitions (default, custom per vertical)
email_threads          — Email conversation threading (in-reply-to, references)
campaign_variants      — A/B test variants for broadcast campaigns
```

## Global Prisma Tables (Billing, Finance, Fiscal, SMS credits, Ops)

_Todas viven en `public` (cross-tenant). Prisma model → `@@map` table name._

```
channel_accounts           — Conexiones por canal (multi-cuenta por tipo): access_token/refresh_token cifrados por-cuenta, UNIQUE(channel_type, account_id)
billing_plans              — 5 plan definitions (emprendedor/starter/pro/enterprise/custom). priceUsdCents + features JSONB + priceLocalOverrides (COP + annual.mpPlanId)
billing_subscriptions      — Per-tenant subscription (status, provider mercadopago|stripe|mock, pendingPlan diferido)
billing_payments           — Payment history (amountCents, currency, status, provider, invoiceNumber)
billing_events             — Append-only log + idempotencia: UNIQUE(provider, providerEventId)
billing_coupons            — Cupones (percent_off/amount_off/free_months), maxRedemptions, appliesToPlanIds
billing_coupon_redemptions — Un canje por tenant×cupón: UNIQUE(couponId, tenantId)
fiscal_invoices            — Facturación DIAN (Factus): CUFE, numbering, XML/PDF, acquirer_snapshot inmutable, type invoice|credit_note
sms_credit_balances        — Balance prepago de créditos SMS por tenant (UNIQUE tenant_id)
sms_credit_ledger          — Movimientos append-only (+purchase/-consumption/±adjustment/+refund), balance_after
sms_package_orders         — Compra de paquete (pago único MP): status pending|paid|failed|cancelled
financial_snapshots        — Monthly platform-wide SaaS metrics (MRR movements, plan distribution)
tenant_financial_snapshots — Per-tenant monthly snapshots (UNIQUE tenantId+snapshotMonth)
storage_snapshots          — Snapshot diario de disco/DB/media por-tenant + fila 'platform' (Ops Center)
platform_incidents         — Incidentes persistentes del Ops Center (severity, status active|acknowledged|resolved)
infra_costs                — Monthly infrastructure costs by category
exchange_rates             — Currency exchange rates
audit_logs                 — Offboarding, billing, fiscal e impersonación (userId = actor real)
api_keys                   — Public API key registry (key hash, tenant, permissions, rate limit)
automation_templates       — Shared automation rule templates (global library)
email_channel_configs      — Email channel configuration per tenant (SMTP/IMAP settings)
webhook_subscriptions      — Tenant webhook subscription endpoints (URL, events, secret)
widget_triggers            — Web chat widget trigger rules (conditions, actions, targeting)
```

---

## Billing System

- **Payment providers**: MercadoPago (LatAm, default) + Stripe adapter. Adapter pattern via `IPaymentProvider`; `PaymentProviderFactory` enruta según config del tenant. `mock` solo en dev
- **Plans**: 5 plans seeded en `billing_plans` (`seed-billing-plans.js`, create-only por defecto — el panel es la fuente de verdad), sincronizados a MercadoPago vía `billing-admin` `POST plans/:slug/sync-mp` (o `sync-mp-plans.js` por SSH)
- **Precios (USD/mes)**: emprendedor $21, starter $49, pro $129, enterprise $349, custom sales-led ($0). Overrides locales COP en `priceLocalOverrides.CO`
- **Ciclo mensual/anual**: el anual (~15% desc vs 12× mensual) crea un `preapproval_plan` MP separado; su id vive en `priceLocalOverrides[country].annual.mpPlanId` (el mensual en `.mpPlanId` / columna legacy `mpPlanId` solo CO). Ver `docs/billing-annual-cycle.md`
- **Subscription lifecycle**: pending_auth → trialing → active → past_due → cancelled/expired. `pendingPlan` + `pendingPlanChangeAt` difieren downgrades al fin de período
- **Trial**: Created at end of onboarding (emprendedor/starter 7d sin tarjeta; pro/enterprise 15d con tarjeta). Daily cron fires `trial.ending_soon` before end
- **Webhooks**: `POST /billing/webhook/:provider` (`:provider` ∈ mercadopago|stripe; `mock` solo fuera de producción). Firma verificada contra el raw body (fail-closed 401) → idempotencia Redis `idem:billing:{provider}:{eventId}` (48h) → idempotencia DB `billing_events` UNIQUE(provider, providerEventId). Siempre responde 200 al ingerir (incl. duplicados) para cortar reintentos
- **Reconciliation**: barrido past_due horario + detección de drift diaria (`reconciliation.processor`). On-demand desde `billing-admin` (`POST reconcile`, `POST tenants/:tenantId/reconcile`)
- **Plan quotas**: enforcement server-side (services, automation rules, broadcast, pipelines, drip, webhooks, widget triggers, channel accounts) vía `TenantThrottleService` leyendo `billing_plans.features` en runtime
- **Email templates**: 5 billing-specific (payment_success, payment_failed, trial_ending, subscription_cancelled, plan_upgraded)
- **Card tokenization**: MercadoPago para checkout self-serve (planes con `requiresCardForTrial`)
- **Cupones** (`/billing-coupons`): percent_off / amount_off / free_months. Admin CRUD (super_admin) + validate/redeem tenant-facing. `billing_coupons` + `billing_coupon_redemptions` (un canje por tenant×cupón)
- **Plan rate limits** (auto/h + outbound/h): emprendedor (0+100), starter (50+200), pro (500+2000), enterprise (5000+20000), custom (∞)
- **Plan agent count** (`maxAgents`): emprendedor=1, starter=1, pro=3, enterprise=10, custom=999
- **Plan calendar count** (`maxCalendars`): emprendedor=1, starter=1, pro=3, enterprise=10, custom=unlimited
- **Plan property count** (`maxProperties`): emprendedor=0, starter=2, pro=10, enterprise=50, custom=unlimited
- **Multi-cuenta por tipo** (`features.maxChannelAccounts`, default 1 por tipo): emprendedor/starter=1 todos; pro={whatsapp:2, messenger:3}; enterprise={whatsapp:3, instagram:2, messenger:5, telegram:2, sms:2}; custom=∞. Un agente por conexión vía `agent_personas.channel_bindings` (ver sección Multi-canal)

### Plan Feature Matrix (Competitive Analysis Additions)

| Feature | Emprendedor | Starter | Pro | Enterprise | Custom |
|---------|-------------|---------|-----|------------|--------|
| publicApi | false | false | true | true | true |
| publicApiKeys | 0 | 0 | 3 | -1 (unlimited) | -1 (unlimited) |
| publicApiRateLimit | 0 | 0 | 60 req/min | 300 req/min | 1000 req/min |
| httpRequestAction | false | false | true | true | true |
| maxPipelines | 1 | 1 | 3 | 10 | -1 (unlimited) |
| maxDripSequences | 0 | 3 | 10 | -1 (unlimited) | -1 (unlimited) |
| maxWebhookSubscriptions | 0 | 3 | 10 | -1 (unlimited) | -1 (unlimited) |
| abTestBroadcasts | false | false | true | true | true |
| widgetTriggers | 0 | 3 | 10 | -1 (unlimited) | -1 (unlimited) |
| channels += 'email' | no | yes | yes | yes | yes |

## Offboarding System

- **Tenant lifecycle**: active → cancelled (voluntary, keeps access until period end) → offboarded (7-step pipeline) → archived (schema dropped after 90d inactive)
- **7-step offboarding**: (1) disconnect all channels, (2) revoke sessions, (3) drain BullMQ queues, (4) deactivate tenant + users, (5) invalidate Redis caches, (6) audit log, (7) emit `tenant.offboarded` event
- **Grace period**: past_due tenants get 7-day grace via Redis `offboard:past_due:{tenantId}`. Cron @3AM enforces
- **Archive cleaner**: Cron @4AM drops schemas inactive >90 days
- **Endpoints**: `POST /offboarding/:tenantId/cancel` (tenant_admin), `POST /offboarding/:tenantId/suspend` (super_admin), `GET /offboarding/:tenantId/status`, `POST /offboarding/:tenantId/reactivate`, `POST /offboarding/:tenantId/extend-trial`

## Financials System

- **SaaS metrics**: MRR, ARR, ARPU, customer/revenue churn rate, LTV, quick ratio
- **Monthly snapshots**: Platform-wide + per-tenant. MRR movements (new, expansion, contraction, churned, reactivation)
- **Infra costs**: Manual entry by category (VPS, domain, etc.) + LLM costs aggregated from tenant schemas
- **Tenant profitability**: Revenue minus LLM cost per tenant
- **Endpoints**: 17 endpoints under `/financials/` (super_admin only):
  - JSON: `overview`, `mrr-trend`, `revenue`, `churn-trend`, `costs`, `tenant-profitability`, `trial-metrics`, `activation`, `forecast` (regresión lineal), `llm-usage` (drilldown live desde Redis, ventana 90d), `infra-costs` GET/POST, `exchange-rates` POST, `snapshot/generate` POST
  - CSV export: `export/revenue.csv`, `export/costs.csv`, `export/tenant-profitability.csv` (BOM UTF-8 para Excel)

---

## Super Admin Dashboard

- **Tenants Hub** (`/admin/tenants`): 6 tabs — Overview (all tenants + KPIs + vertical badge + health dot), Onboarding, Offboarding, Billing, Usage, Platform. 6 platform KPIs: tenants, users, active, messagesToday, pendingHandoffs, vertical distribution
- **Tenant Detail** (`/admin/tenants/[tenantId]`): 6 tabs — Info, Users, Channels, Billing, Engagement, AI Config
- **Modo plataforma (sin tenant implícito)**: el super_admin NO tiene tenant propio. `roles.ts` es **deny-by-default**: si ninguna regla de página matchea, se deniega el acceso a super_admin fuera de impersonación → cada página nueva nace gateada y hay que agregarle regla explícita. Operar dentro de un tenant requiere impersonación
- **Impersonación gobernada** (ver `docs/superadmin-governance.md`):
  - `POST /auth/impersonate/:tenantId` — **motivo obligatorio** (400 sin `reason`), `ticketId` opcional. Emite tokens de 1h con `isImpersonation: true`, `impersonatedBy` (id del super_admin) y `impersonationSid` en el JWT; sesión emparejada (refresh en Redis)
  - `POST /auth/impersonate/exit` — cierra la sesión y mata el refresh emparejado (acota la ventana de exposición)
  - **Actor real en auditoría**: las escrituras hechas durante impersonación registran al super_admin (`super_admin.impersonation_started`, `userId` = super_admin, nunca el usuario impersonado). `common/utils/audit-actor.util.ts` resuelve el actor real
  - Dashboard: banner ámbar `ImpersonationBanner` con botón "Exit"
- **Suspended Screen**: Full-page block when tenant `isActive: false`. Only action: logout
- **Financials** (`/admin/financials`): 5 tabs — Overview, Revenue, Customers, Costs, Settings
- **Health score formula** (0-100) — `tenants.service.ts getEngagement()`:
  - Channels connected (0-20): 20 si `channel_accounts` activas > 0
  - Agent configured (0-20): 20 si `agent_personas` > 0
  - FAQs (0-15): 15 si ≥3, 8 si >0, 0 si ninguna
  - Services (0-10): 10 si >0
  - Activity (0-35): 35 si hay mensajes en 7d, 15 si en 30d, 0 si no
- **Cross-tenant aggregation**: `getPlatformStats()` iterates all active tenant schemas

### Unified AI Usage Dashboard (May 2026)

**Endpoint:** `GET /tenants/ai-usage?months=3&tenantId=` (super_admin)

**Architecture:**
- `LLMRouterService.getUnifiedAiUsage()` aggregates data from 3 separate Redis key sets:
  - LLM stats: `ai:stats:{tenantId}:{date}:*` (tokens, cost, model usage)
  - Media stats: `media:audio:{tenantId}:{YYYY-MM}` + `media:image:{tenantId}:{YYYY-MM}`
  - Embeddings stats: `ai:stats:{tenantId}:{date}:embeddings:*`

**Dashboard Page:** `/admin/llm-stats`
- Monthly selector (1/3/6/12 months)
- 4 KPI tiles (total tokens, total cost, total requests, avg cost/request)
- Stacked monthly bar charts by category
- Category breakdown with percentages
- Provider attribution table
- Tenant ranking with per-tenant breakdown

**tenantId Propagation Fix:**
- Fixed 5 service call sites that never passed tenantId to Redis tracking:
  - copilot.service.ts (4 call sites)
  - intent-interpreter.service.ts
  - nurturing.service.ts
  - crm-insights.service.ts
  - agent-console.service.ts
- Added token estimation tracking to executeStream()
- Added embeddings tracking to knowledge.service.ts generateEmbedding()

**Redis Keys (AI stats):**
```
ai:stats:{tenantId}:{YYYY-MM-DD}:{category}:tokens    — Token count
ai:stats:{tenantId}:{YYYY-MM-DD}:{category}:cost      — Cost in cents
ai:stats:{tenantId}:{YYYY-MM-DD}:{category}:requests  — Request count
ai:stats:{tenantId}:{YYYY-MM-DD}:{category}:provider:{name} — Per-provider breakdown
```

### Super Admin — Platform Pages (`/admin/…`, gateadas a super_admin en `roles.ts`)

| Página | Propósito |
|--------|-----------|
| `/admin/tenants` (+`/[tenantId]`) | Tenants Hub + detalle por tenant |
| `/admin/financials` | SaaS metrics (5 tabs) |
| `/admin/llm-stats` | Unified AI usage |
| `/admin/billing-ops` | Suscripciones/pagos/eventos cross-tenant + reconciliación + refunds |
| `/admin/plans` | Editor del catálogo de planes + sync MP + badge sandbox/producción |
| `/admin/coupons` | CRUD de cupones + redenciones |
| `/admin/fiscal` | Config fiscal DIAN (modo CO_LOCAL/US_REMOTE), Factus, facturas globales |
| `/admin/sms-packages` | Tiers de créditos SMS + balances + ajustes |
| `/admin/ops` (+`/alerts`) | Ops Center (platform-monitor) + config de alertas |
| `/admin/incidents` | Incidentes persistentes (ack/resolve) |
| `/admin/storage` | Storage por-tenant, quota, tendencia de disco |
| `/admin/audit` | Bitácora de auditoría (billing, fiscal, impersonación) |
| `/admin/managed` | Tier done-for-you (garantía de resolución) |

### Billing Admin (`/billing-admin/*` — super_admin, "Billing Ops") — 15 endpoints

Traslada las consultas psql-por-SSH del runbook al panel. Auditadas con actor real.

| Endpoint | Propósito |
|----------|-----------|
| `GET plans` | Catálogo + `tenantCount` + `unknownFeatureKeys` por plan |
| `GET feature-registry` | Registro canónico de `features` (validación de tipos) |
| `GET plans/:slug` | Un plan |
| `PUT plans/:slug` | Editar plan (merge de `features` validado contra el registro, invalida cache) |
| `POST plans/:slug/invalidate-cache` | Refrescar entitlements sin editar |
| `GET provider-status` | Entorno MP (sandbox/producción) + webhook configurado |
| `POST plans/:slug/sync-mp` | Registrar/recrear `preapproval_plan` en MP por país×ciclo (`cycle` month/year) |
| `POST reconcile` | Reconciliación on-demand (`scope` full/past_due) |
| `POST tenants/:tenantId/reconcile` | Reconciliar un tenant contra el proveedor |
| `GET subscriptions` | Listado paginado (filtros status/provider/plan/q) |
| `GET payments` | Listado paginado (filtros status/provider/tenantId) |
| `GET events` | `billing_events` paginado (sin payload) |
| `POST payments/:paymentId/refund` | Refund inline (total o parcial) |
| `POST tenants/:tenantId/comp-plan` | Plan de cortesía time-boxed (motivo obligatorio) |
| `PUT tenants/:tenantId/plan` | Cambio de plan permanente (entitlement override, no toca la suscripción del PSP) |

---

## Multi-canal por tipo de canal (jul 2026)

- **N conexiones del mismo tipo** (2 números WhatsApp, 2 IG…) gateadas por `features.maxChannelAccounts` (default 1 por tipo) + override por tenant. Ver `docs/multi-channel-per-type-implementation-2026-07.md`
- **Tokens por-cuenta**: `channel_accounts.access_token`/`refresh_token` cifrados por conexión, sin migración global. `ChannelTokenService.getChannelToken(tenantId, channelType, accountId?)` resuelve el token por cuenta (cache 5min Redis)
- **Un agente por conexión**: `agent_personas.channel_bindings` liga cada persona a una conexión concreta; anti-conflación de conversaciones por `accountId`
- **UI**: editor adaptativo por canal + overview con contador/límite (`x/y conexiones`) + disconnect por-cuenta

---

## Facturación electrónica DIAN — Colombia (Factus)

Capa fiscal desacoplada del PSP (`IFiscalInvoiceProvider`; hoy adaptador **Factus**). Ver `docs/facturacion-electronica-colombia-2026-06.md`.

- **Modelo**: `fiscal_invoices` (global). Se crea en `billing.payment.succeeded` (cualquier PSP) y se emite async. Guarda CUFE/CUDE, numeración (prefijo+consecutivo), XML/PDF firmados y un `acquirer_snapshot` inmutable. `type`: invoice | credit_note | debit_note. `status`: pending | issued | failed | cancelled
- **Gate collect-before-pay** (`fiscalGateEnabled`, OFF por defecto): cuando está ON y el país de cobro lo requiere, exige el perfil fiscal (NIT/cédula + DV módulo 11) antes de cobrar. Opt-in "consumidor final" (DIAN 222222222222)
- **Tenant-facing** (`/fiscal/:tenantId/…`): `GET/PUT data` (perfil fiscal), `GET invoices`, `POST invoices/:id/retry`, `GET invoices/:id/pdf` (branded u oficial), `GET invoices/:id/xml`
- **Super admin** (`/fiscal-admin/*`): `GET/PUT config` (modo CO_LOCAL↔US_REMOTE auditado, tratamiento IVA, defaults Factus), `GET invoices` (global), `POST invoices/:id/retry`, `POST invoices/:id/reissue` (borra en Factus + re-emite si no hay CUFE; con CUFE es inmutable), `GET preview-invoice`, `POST test-invoice` (sandbox), `GET factus/health`, `GET factus/numbering-ranges`
- **Recuperación 409**: un `reference_code` ya usado en Factus se libera con delete (solo mientras no esté validado) para re-emitir sin colisión

---

## SMS monetizado por paquetes (créditos reseller)

Modelo reseller one-way: los tenants compran créditos prepagos (1 crédito = 1 segmento Twilio) para **notificar a sus clientes** vía el Twilio de la plataforma. El canal SMS conversacional (bidireccional) quedó **descartado**. Ver `docs/sms-monetization-packages-2026-07.md`.

- **Tablas**: `sms_credit_balances` (cache del total), `sms_credit_ledger` (movimientos append-only, `balance_after`), `sms_package_orders` (compra pago único MP, `external_reference` = order id, acreditación idempotente por webhook)
- **Endpoints** (`/sms-credits/*`):
  - Tenant: `GET :tenantId/balance`, `GET :tenantId/ledger`
  - Catálogo: `GET packages` (tiers activos)
  - Super admin: `GET/PUT admin/config` (tiers editables + sender), `GET admin/balances` (cross-tenant), `POST admin/:tenantId/adjust` (ajuste manual firmado, motivo obligatorio)
- **Compra**: `sms-checkout.*` en el módulo billing (preferencia MP, pago único)
- **Hardening**: kill-switch maestro del modelo reseller (apagado por defecto) + verificación de firma Twilio en el webhook

---

## Ops Center (super_admin) — módulo `health/` / `platform-monitor`

Centro de Operaciones para el super_admin. Liveness `GET /health` + `GET /health/detailed` (usado por el healthcheck de Docker y Uptime Kuma).

- **Servicios**: `platform-monitor.service` (cron de checks + alerting con cooldown vía email/Telegram/SMS), `incident.service`, `platform-storage.service` (disco + storage por-tenant + quota + history), `alert-config.service`, `sms-alert.service`, `telegram-alert.service`, `sentry-stats.service`
- **Checks**: salud/budget de proveedores LLM, fallos de webhook de billing (`billing:webhook:fail:*`), y **heartbeat de backup** (`backup:last_success` en Redis; alerta si > `backupStaleHours`, default 26h)
- **Endpoints**: `/health/llm-providers`, `/health/storage[ /overview | /tenants | /history ]`, `/health/incidents[ /summary | /:id/ack | /:id/resolve ]`, `GET|PUT /health/alert-config`, `POST /health/checks/run`, `POST /health/media-cleanup`
- **Tablas**: `platform_incidents` (persistentes, ack/resolve), `storage_snapshots` (snapshot diario disco/DB/media por-tenant + fila `platform`)
- **Backup**: `pg_dump` DENTRO del contenedor `parallext-postgres`; offsite vía rclone a Cloudflare R2; scripts de infra con exec-bit `100755`. Ver `docs/backup-restore-runbook.md`

---

## Vertical Adaptation System

- **Module**: `apps/api/src/modules/verticals/`
- **12 industries × 4 languages**: salud, moda_belleza, inmobiliaria, restaurantes, automotriz, turismo, education, finanzas, servicios_profesionales, retail, technology, otro
- **Sub-types**: 3-5 per industry (e.g., salud → dental, medica_general, estetica, psicologia, farmacia)
- **Bootstrap on onboarding**: `bootstrapVertical(tenantId, industry, subType, lang)` seeds:
  1. 5-7 pipeline stages per industry
  2. Patches default AI agent (name, persona, language, forbidden topics, handoff triggers)
  3. 5 seed FAQs tailored to industry
  4. 3 seed bookable services (for booking-enabled industries)
- **Prompt injection**: `<vertical_context>` XML in Layer 3 with `customer_noun`, `transaction_noun`, `service_noun`
- **Dashboard adaptation**: AuthContext fetches `verticalConfig` from `GET /verticals/:tenantId` on login. AppSidebar dynamic labels (CRM → "Pacientes" for salud) + hidden items per industry. `useVerticalTerms()` hook for locale-aware terminology
- **Config storage**: `tenant.settings.verticalConfig` JSONB
- **Cache**: Redis `vertical:{tenantId}` 10min TTL
- **Strategy doc**: `docs/vertical-strategy.md`

---

## Vacation Rental Module

- **Module**: `apps/api/src/modules/vacation-rental/`
- **4 tenant-schema tables**: `properties`, `ical_blocks`, `ical_feeds`, `property_bookings`
- **Plan-gated**: starter:2, pro:10, enterprise:50, custom:unlimited
- **Availability check**: `checkAvailability(propertyId, checkIn, checkOut)` merges `ical_blocks` (external) + `property_bookings` (internal)
- **iCal Import**: `IcalSyncService` parses Airbnb/Booking.com `.ics` using `node-ical`. Cron `*/30 * * * *`
- **iCal Export**: `ical-generator`. Includes both blocks and confirmed bookings
- **Public iCal endpoint**: `GET /public/ical/:tenantSlug/:propertyId/:token/calendar.ics` (no auth, token is `properties.ical_token`)
- **5 AI tools** (when `config.tools.vacationRental.enabled`): `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`
- **NPM packages**: `node-ical` + `ical-generator`

---

## CRM Overhaul (Apr 26-28, 2026)

- **Lead management**: Create modal (phone required), inline edit, archive with confirmation, restore from archive
- **Phone normalization**: `normalizePhoneE164()` in `common/utils/phone.util.ts`. Supports CO/AR/MX/BR/CL/PE/EC + US/CA. Auto-applied on creation and identity resolution
- **Auto-merge on phone match**: Identity service normalizes before lookup → automatic merge across channels
- **Bulk actions**: Checkbox + select-all + fixed bottom bar (change stage, add tag, archive)
- **Advanced filters**: Score min/max, date range, tags + existing stage/search
- **Pipeline stages config**: Full CRUD (`pipeline_stages` table) — name, slug, color, position, probability, sla_hours, is_terminal. Drag-to-reorder
- **CRM Analytics**: 4 tabs (Overview KPIs, Funnel, Velocity, Leaderboard). 6 endpoints under `/crm/analytics/:tenantId/`
- **Score transparency**: Expandable breakdown panel (5 factors)
- **Configurable scoring**: `scoring_config` table (weights JSON, purchase_keywords, decay). GET/POST `/crm/scoring-config/:tenantId`
- **Dynamic segments**: Rule-based filters auto-evaluated. CRUD + contact count
- **AI Insights**: GET `/crm/leads/:tenantId/:leadId/insight` — summary, recommended action, risk, top signals
- **Deal approval**: `PUT request-approval`, `PUT approve`, `PUT reject`. Fields: `approval_status`, `approval_stage`, `approved_by`

## Handoff System (Apr 26-28, 2026)

- **Email notifications**: HTML email with client name, phone, reason, last message, "Open Inbox" CTA
- **Skill-based routing**: `tryAutoAssign()` maps reasons to skill tags (frustration→complaints, explicit_request→general, max_failed→technical). Queries `users.skill_tags` array and `max_capacity`
- **SLA tracking**: `conversation_assignments` table with `sla_deadline` (default 5 min)
- **Supervisor escalation cron**: `escalateStaleHandoffs()` every 2 min. >5 min no response → `inbox:escalation` WebSocket
- **WebSocket events**: `inbox:handoff` (all tenant agents), `inbox:handoff_direct` (assigned), `inbox:escalation` (supervisor)
- **Dashboard**: Sound + visual badge on handoff events
