# Analytics, Billing, Financials & Super Admin — Reference

---

## Analytics — Dashboard Endpoints (12 total under `/dashboard-analytics/`)

| Endpoint | Purpose |
|----------|---------|
| `GET overview-kpis/:tenantId` | 6 KPIs with automatic period comparison (% change) |
| `GET conversations-volume/:tenantId` | Daily volume stacked by channel |
| `GET response-times/:tenantId` | Median + P90 first response and resolution times |
| `GET ai-metrics/:tenantId` | AI resolution rate, containment, cost, model usage, handoff reasons |
| `GET heatmap/:tenantId` | 7-day x 24-hour message volume grid |
| `GET export/:tenantId` | Full CSV report download |
| `GET realtime/:tenantId` | Live: active convos, agents online/busy/offline, queue, messages today |
| `GET automation/:tenantId` | Rules count, execution stats, success rate, per-rule performance |
| `GET broadcast/:tenantId` | Campaign funnel (sent→delivered→read→failed) per campaign |
| `GET anomalies/:tenantId` | Z-score analysis, flags deviations >2σ from 30-day average |
| `GET cohorts/:tenantId` | Cohort retention matrix (contacts by first-contact month) |

## Alerts & Reports (under `/analytics-config/`)

| Endpoint | Purpose |
|----------|---------|
| `GET/POST/PUT/DELETE alerts/:tenantId` | CRUD alert rules |
| `GET alerts/:tenantId/:ruleId/history` | Alert trigger history |
| `GET/POST reports/:tenantId` | Scheduled report config |

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
```

## Global Prisma Tables (Billing & Finance)

```
billing_plans              — 4 plan definitions (starter/pro/enterprise/custom)
billing_subscriptions      — Per-tenant subscription
billing_payments           — Payment history
financial_snapshots        — Monthly platform-wide SaaS metrics
tenant_financial_snapshots — Per-tenant monthly snapshots
infra_costs                — Monthly infrastructure costs by category
exchange_rates             — Currency exchange rates
audit_logs                 — Offboarding and billing audit trail
```

---

## Billing System

- **Payment provider**: MercadoPago (LatAm). Adapter pattern via `IPaymentProvider`
- **Plans**: 4 plans seeded in `billing_plans`, synced to MercadoPago via `sync-mp-plans.js`
- **Subscription lifecycle**: trialing → active → past_due → cancelled/expired
- **Trial**: Created at end of onboarding. Daily cron fires `trial.ending_soon` 3 days before end
- **Webhooks**: `POST /billing/webhooks/mercadopago` with HMAC-SHA256 + Redis idempotency
- **Reconciliation**: Hourly past_due sweep + daily drift detection
- **Plan quotas**: Server-side enforcement on services, automation rules, broadcast limits
- **Email templates**: 5 billing-specific (payment_success, payment_failed, trial_ending, subscription_cancelled, plan_upgraded)
- **Card tokenization**: MercadoPago for Pro/Enterprise self-serve checkout
- **Plan rate limits**: starter (50 auto/h + 200 outbound/h), pro (500+2000), enterprise (5000+20000)
- **Plan agent count**: starter=1, pro=3, enterprise=10, custom=unlimited
- **Plan calendar count**: starter=1, pro=3, enterprise=10, custom=999
- **Plan property count**: starter=2, pro=10, enterprise=50, custom=unlimited

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
- **Endpoints**: 11 endpoints under `/financials/` (overview, mrr-trend, revenue, churn-trend, costs, tenant-profitability, trial-metrics, infra-costs GET/POST, exchange-rates, snapshot/generate). Super_admin only

---

## Super Admin Dashboard

- **Tenants Hub** (`/admin/tenants`): 6 tabs — Overview (all tenants + KPIs + vertical badge + health dot), Onboarding, Offboarding, Billing, Usage, Platform. 6 platform KPIs: tenants, users, active, messagesToday, pendingHandoffs, vertical distribution
- **Tenant Detail** (`/admin/tenants/[tenantId]`): 6 tabs — Info, Users, Channels, Billing, Engagement, AI Config
- **Impersonation**: `POST /auth/impersonate/:tenantId` generates 1h tokens with `isImpersonation: true` + `impersonatedBy` in JWT. Dashboard shows amber `ImpersonationBanner` with "Exit" button
- **Suspended Screen**: Full-page block when tenant `isActive: false`. Only action: logout
- **Financials** (`/admin/financials`): 5 tabs — Overview, Revenue, Customers, Costs, Settings
- **Health score formula** (0-100):
  - Channels connected (0-20): 20 if ≥1 active
  - Agent configured (0-20): 20 if has persona + model
  - FAQs (0-15): 8 if ≥1, 15 if ≥5
  - Services (0-10): 10 if ≥1
  - Activity (0-35): 35 if msg in 7d, 20 if in 30d, 5 if only historic
- **Cross-tenant aggregation**: `getPlatformStats()` iterates all active tenant schemas

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
