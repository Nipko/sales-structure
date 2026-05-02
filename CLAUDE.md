# Parallext Engine — Claude Code Context

## What is this project?
Multi-tenant conversational AI SaaS platform (Parallly) for automating sales across WhatsApp, Instagram, Messenger, and Telegram.
Monorepo with 4 NestJS/Next.js apps, deployed on Hostinger VPS via Docker + Cloudflare Tunnel.

## Architecture

```
Customer (WhatsApp/IG/Messenger/Telegram) → Meta Cloud API / Telegram Bot API → WhatsApp Service (port 3002) OR API webhooks
    → API (port 3000) → ConversationsService (orchestrator)
        → IdentityService (resolve/create unified profile)
        → PersonaService (load agent config) → getPersonaForChannel(tenantId, channelType) (select agent by channel)
            → BusinessInfoService (tenant identity) + KnowledgeService (RAG hybrid) + BookingEngine
            → PromptAssemblerService.assemble(config, turnContext) → L1 contract + L2 persona + L3 turn
            → LLMRouter (select model by tier) → LLM Provider → response
        → OutboundQueueService (BullMQ, priority by plan) → ChannelGatewayService → Channel API → Customer

    If handoff triggered:
        → HandoffService → EventEmitter('handoff.escalated') → AgentConsoleGateway (WebSocket /inbox)
        → Human agent responds via Dashboard (port 3001) → AgentConsoleService → Channel API

    Rate limiting:
        → TenantThrottleService (per-plan: starter/pro/enterprise/custom) checks Redis before every job

    Session management:
        → Refresh token rotation (Redis-backed) + idle timeout (60min) + BroadcastChannel multi-tab sync
```

## Monorepo structure

```
apps/
  api/          — NestJS 10, port 3000. Core business logic, 40 modules
  dashboard/    — Next.js 16, port 3001. Admin panel (50+ pages), React 19, Tailwind + shadcn/ui + recharts
  whatsapp/     — NestJS 10, port 3002. Embedded Signup v4 + Meta webhook router
  landing/      — Next.js static export, port 80. Marketing landing page (parallly-chat.cloud), 4-language i18n
packages/
  shared/       — TypeScript types (NormalizedMessage, OutboundMessage, TenantConfig, ChannelType, etc.)
infra/
  docker/       — docker-compose.yml (dev), docker-compose.prod.yml (prod), 5 Dockerfiles
  nginx/        — Reverse proxy config (WebSocket upgrade enabled)
  scripts/      — setup-vps.sh, setup-fresh.sh, reset-db.sh
docs/           — Architecture specs, visual guide, logo, API reference, changelog
```

## Key conventions

- **Language**: Code in English, user-facing strings in Spanish (Latin American market). ALL strings via i18n (next-intl, 4 languages: es/en/pt/fr)
- **Multi-tenancy**: Schema-per-tenant in PostgreSQL. Schema name from `tenants.schema_name`
- **Database queries**: `prisma.$queryRawUnsafe(sql, ...params)` — ALWAYS use `::uuid` casts. NO type arguments on `$queryRawUnsafe`
- **Global tables**: Prisma client directly (`prisma.tenant.findUnique(...)`)
- **Raw SQL column names**: Use snake_case (`is_active`, not `"isActive"`) — Prisma `@map` only applies to Prisma client
- **Auth**: JWT with refresh token rotation (Redis-backed). 4 roles: super_admin, tenant_admin, tenant_supervisor, tenant_agent. Google OAuth, email 2FA, password reset. Session timeout 60min with warning modal
- **Database pooling**: PgBouncer (transaction mode) between apps and PostgreSQL. Use `DIRECT_DATABASE_URL` for Prisma migrations. PostgreSQL tuned: `max_locks_per_transaction=256`, `shared_buffers=256MB`. Multi-statement SQL must be split into individual queries for PgBouncer compatibility
- **Error tracking**: Sentry (@sentry/nestjs + profiling). `instrument.ts` must load before all modules
- **Guards**: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` on protected endpoints
- **CRM is built-in**: No external CRM. Handoff → internal agent console via WebSocket
- **Event-driven**: HandoffService emits events, AgentConsoleGateway listens via @OnEvent
- **Outbound messages**: Always through OutboundQueueService (BullMQ, 3 retries, priority by tenant plan)
- **Rate limiting**: TenantThrottleService (starter: 50 auto/h + 200 outbound/h, pro: 500+2000, enterprise: 5000+20000)
- **Webhook idempotency**: Redis keys `idem:wa:{id}`, `idem:ig:{id}`, `idem:fb:{id}`, `idem:tg:{id}`, `idem:sms:{id}` with 24h TTL
- **LLM Router**: Skips unconfigured providers. Auto-upgrades tier if no key available
- **Redis**: noeviction policy (never allkeys-lru). BullMQ jobs must not be silently evicted
- **BigInt**: `BigInt.toJSON` polyfill in main.ts and worker.main.ts for PostgreSQL COUNT(*)
- **i18n**: Every page edit/creation MUST include i18n updates in all 4 JSON files (es/en/pt/fr)
- **Multi-agent**: Each tenant can have N agents (plan-gated: starter=1, pro=3, enterprise=10, custom=unlimited). One agent per channel. Pipeline uses getPersonaForChannel() for routing.
- **Subscription plans**: 4 plans: starter, pro, enterprise, custom — controls agent count, template access, rate limits, and calendar count
- **Channels**: Adapter pattern via `IChannelAdapter`. Supported: WhatsApp, Instagram, Messenger, Telegram, SMS (Twilio). One AI agent per channel (hard rule).
- **Conversation mutex**: Redis SETNX lock per conversation ID (`lock:conv:{conversationId}`, 30s TTL) prevents race conditions when messages arrive simultaneously
- **Booking state**: Redis-backed (`booking:{conversationId}`, 1h TTL) as primary, PostgreSQL as backup. Loaded from Redis first. In directive mode, only last 4 messages sent to LLM (not full history) to prevent LLM from ignoring directives
- **Booking engine i18n**: All 21 directive strings in 4 languages (es/en/pt/fr). Language auto-detected from customer message. No LLM translation needed
- **Multi-calendar**: N calendars per tenant, plan-gated (starter:1, pro:3, enterprise:10, custom:999). 3-tier resolution: service → staff → general fallback. Auto meeting links (Google Meet / Microsoft Teams). Calendar sync on AI booking via `appointment.created` event

## Prompt Architecture (3 layers — Apr 2026 refactor)

The system prompt is ASSEMBLED per turn by `PromptAssemblerService`:

- **Layer 1 (Contract)** — hardcoded universal rules (10 rules) + safety guardrails. Golden rule: "One message, one purpose. Never ask more than one question per message." Sales awareness: guide LLM to connect customer needs to available services. Strict directive handling: "Say EXACTLY this information in a natural way." Also: backend controls flow, LLM is the voice, must cite retrieved knowledge, must use `<turn><language>`, must never leak context tags, anti-repetition (uses message_count in turn context). **Safety guardrails** (always active, cannot be overridden): blocks violence, weapons, illegal activities, self-harm, explicit content, discrimination, drugs, hacking, third-party PII, unqualified legal/financial advice. Identical for every agent.
- **Layer 2 (Persona)** — `<persona>…</persona>` from `PersonaService.buildSystemPrompt(config)`. 100% user configuration (name, role, personality, rules, forbidden topics, handoff triggers, business hours). In `editorMode: 'prompt'`, the user's free-form prompt replaces the guided body but STILL wrapped in `<persona>` so L1/L3 apply.
- **Layer 3 (Turn Context)** — `<turn>…</turn>` structured XML for this specific turn: language (auto-detected), timezone, now, upcoming_days, business_hours_status, business identity, contact profile, booking_state, available_services, retrieved_knowledge (from RAG + tools), message_count.

**No prose instructions are mixed with user config.** Dates, language, business info, RAG hits — all appear as structured data inside `<turn>`, never as prepended/appended prose.

## 5-Tier Knowledge Architecture (Apr 2026)

1. **Business Identity** — inline in `<turn><business>` (always loaded, ~200 tokens). Managed in Settings → Business Info (extends `companies` table).
2. **Catalog / Inventory** — tools (`search_products`, `get_product`, `check_stock`). Registered when `config.tools.catalog.enabled`.
3. **FAQs** — dedicated `faqs` table + tool `search_faqs`. Full-text TSVECTOR search with ILIKE fallback. Managed in Knowledge → FAQs.
4. **Policies** — versioned `policies` table (unique active per type: shipping/return/warranty/cancellation/terms/privacy) + tool `get_policy`. Never hallucinated. Managed in Settings → Policies.
5. **Knowledge Base (RAG++)** — hybrid search (vector cosine + keyword ILIKE boost) with rerank and configurable `topK` + `similarityThreshold`. Citations in replies: `[FAQ #id]`, `[Policy: type]`, `[Article: title]`.

## Test Agent

Any agent can be tested live from the dashboard: `/admin/agent/[id]/test`. The endpoint `POST /api/v1/agent-test/:tenantId/:agentId` processes a message through the full pipeline (no persistence) and returns `reply + debug { systemPrompt, toolCalls, ragHits, tokens, cost, model, latencyMs, turnContext }`. Debug panel has 5 tabs: System Prompt, Tools, RAG, Metrics, Turn Context.

## Language Detection

`LanguageDetectorService` heuristically detects es/en/pt/fr from the inbound message. Default is the configured agent language; auto-override when the customer switches languages mid-conversation. Fed into `<turn><language>` so the LLM answers in the customer's language.

## API modules (40 total)

| Category | Modules |
|----------|---------|
| **Infrastructure** | prisma, redis, health, throttle, internal |
| **Auth & Tenants** | auth (JWT + refresh rotation + Google OAuth + 2FA + password reset + session management + impersonation), tenants, settings |
| **Message Pipeline** | channels (WhatsApp/IG/Messenger/Telegram/SMS adapters + IG OAuth + Messenger FB SDK + IG token refresh cron), conversations, whatsapp, handoff, agent-console |
| **AI & Config** | ai (router + 5 providers), persona (multi-agent CRUD, templates, channel assignment), knowledge, copilot |
| **CRM & Sales** | crm (leads, contacts, opportunities, custom-attrs, segments, import/export, notes, tasks, activity, scoring, analytics, insights, deal-approval, bulk-update, pipeline-stages), pipeline, catalog |
| **Automation** | automation (rules engine, listener, jobs processor, nurturing, action executor) |
| **Billing & Finance** | billing (MercadoPago adapter, webhook, reconciliation cron, email listeners, plan quotas), financials (SaaS metrics, snapshots, infra costs, exchange rates), offboarding (tenant lifecycle, grace enforcer cron, archive cleaner) |
| **Operations** | broadcast, inventory, orders, compliance, email, email-templates, offers, business-info |
| **Media & Files** | media (upload, resize, logo, tags, serve) |
| **Scheduling** | appointments (CRUD, availability slots, blocked dates, conflict detection, multi-calendar, Google/Microsoft sync) |
| **Identity** | identity (unified profiles, merge suggestions, manual merge, phone normalization) |
| **Analytics** | analytics (Redis counters + DB), dashboard-analytics (KPIs, volume, response times, AI metrics, heatmap, anomalies, cohorts), agent-analytics, alerts, scheduled-reports, csat-trigger, compliance, audit, metrics-aggregation, bi-api |
| **Vertical** | verticals (industry bootstrap, UI config, terminology, vertical-definitions) |
| **Vacation Rental** | vacation-rental (properties CRUD, iCal import/export, availability, 5 AI tools) |
| **Other** | carla (legacy, being replaced), intake (landing pages) |

## Module dependency flow

```
WhatsappModule → ConversationsModule → [PersonaModule, AIModule, ChannelsModule, HandoffModule, IdentityModule]
                                                                      ↓ (EventEmitter)
                                                              AgentConsoleModule
ChannelsModule provides: ChannelGatewayService, ChannelTokenService, OutboundQueueService, InstagramTokenRefreshService, adapters (WA/IG/Messenger/Telegram/SMS)
ThrottleModule: @Global — TenantThrottleService available everywhere
AnalyticsModule provides: AnalyticsService, DashboardAnalyticsService, AlertsService, ScheduledReportsService, BIApiController
BillingModule provides: BillingService, MercadoPagoAdapter, ReconciliationProcessor, BillingEmailService
FinancialsModule provides: FinancialsService, FinancialSnapshotService (super_admin only)
OffboardingModule provides: OffboardingService, OffboardingCronService (depends on all 5 BullMQ queues)
```

## Key files for common tasks

| Task | Files |
|------|-------|
| Message flow | `conversations/conversations.service.ts` (orchestrator) |
| Add LLM provider | `ai/providers/*.provider.ts`, `ai/router/llm-router.service.ts` |
| Agent persona config | `persona/persona.service.ts`, `persona/persona.controller.ts` |
| Channel adapters | `channels/{channel}/*.adapter.ts`, `channels/channel-gateway.service.ts` |
| Channel management | `channels/channel-management.controller.ts` (connect IG/Messenger/Telegram/SMS) |
| Webhook validation | `channels/meta-signature.util.ts` (shared HMAC validator) |
| Handoff logic | `handoff/handoff.service.ts` |
| Agent console | `agent-console/agent-console.gateway.ts` (WebSocket), `.service.ts` |
| Agent availability | `agent-console/agent-availability.service.ts` |
| Macros | `agent-console/macros.service.ts` |
| Conversation snooze | `agent-console/snooze.service.ts` |
| Automation rules | `automation/automation-listener.service.ts`, `automation-jobs.processor.ts` |
| Nurturing | `automation/nurturing.service.ts` (3-attempt follow-up) |
| Rate limiting | `throttle/tenant-throttle.service.ts` |
| Identity/merge | `identity/identity.service.ts` |
| CSAT surveys | `analytics/csat-trigger.service.ts` |
| Custom attributes | `crm/services/custom-attributes/custom-attributes.service.ts` |
| Contact segments | `crm/services/segments/segments.service.ts` |
| Import/Export CSV | `crm/services/import-export/import-export.service.ts` |
| Pre-chat forms | `conversations/pre-chat.service.ts` |
| Knowledge (RAG) | `knowledge/knowledge.service.ts` |
| KB public portal | `GET /knowledge/public/:tenantSlug/articles` (no auth) |
| Outbound sending | `channels/outbound-queue.service.ts` → processor |
| Token resolution | `channels/channel-token.service.ts` |
| **Analytics dashboard** | `analytics/dashboard-analytics.service.ts` (KPIs, volume, heatmap, AI metrics, anomalies, cohorts) |
| **Analytics controller** | `analytics/dashboard-analytics.controller.ts` (12 endpoints) |
| **Alerts system** | `analytics/alerts.service.ts` (CRUD + cron eval every 15min) |
| **Scheduled reports** | `analytics/scheduled-reports.service.ts` (weekly/monthly email) |
| **BI API** | `analytics/bi-api.controller.ts` (X-API-Key auth, 7 endpoints) |
| **Metrics cron** | `analytics/metrics-aggregation.service.ts` (nightly @2AM) |
| **Session management** | `auth/auth.service.ts` (refresh rotation, Redis, logout, revoke) |
| **Idle timer** | `dashboard/src/hooks/useIdleTimer.ts` (60min, BroadcastChannel) |
| **Session modal** | `dashboard/src/components/SessionTimeoutModal.tsx` |
| **Help panel** | `dashboard/src/components/ui/help-panel.tsx` (contextual help with YouTube support, on all 15 admin pages) |
| DB tenant schema | `apps/api/prisma/tenant-schema.sql` |
| Shared types | `packages/shared/src/index.ts` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` (105+ methods) |
| Dashboard auth | `apps/dashboard/src/contexts/AuthContext.tsx` |
| Media management | `media/media.service.ts`, `media/media.controller.ts` |
| Email templates | `email-templates/email-templates.service.ts` |
| Appointments | `appointments/appointments.service.ts`, `.controller.ts` |
| Email layouts | `email/email-layouts.ts` (verification, reset, 2FA, welcome) |
| Google OAuth | `auth/google-auth.service.ts` |
| Sentry | `instrument.ts` (loaded before all modules) |
| Multi-agent CRUD | `persona/persona.service.ts` (listAgents, createAgent, getPersonaForChannel) |
| Agent templates | `persona/persona.service.ts` (getBuiltinTemplates, saveAsTemplate, listTemplates) |
| Plan features | `throttle/tenant-throttle.service.ts` (PLAN_FEATURES, getPlanFeatures) |
| Agent editor | `dashboard/src/app/admin/agent/[agentId]/page.tsx` |
| Agent list | `dashboard/src/app/admin/agent/page.tsx` |
| Setup banner | `dashboard/src/components/SetupBanner.tsx` |
| SMS adapter | `channels/sms/sms.adapter.ts` |
| IG token refresh | `channels/instagram-token-refresh.service.ts` (daily @6AM, 30-day pre-expiry) |
| Offboarding | `offboarding/offboarding.service.ts` (7-step pipeline: channels, sessions, queues, deactivate, cache, audit, event) |
| Offboarding cron | `offboarding/offboarding-cron.service.ts` (grace enforcer @3AM, archive cleaner @4AM) |
| Financials | `financials/financials.service.ts` (MRR, ARR, ARPU, churn, LTV, quick ratio, tenant profitability) |
| Financial snapshots | `financials/financial-snapshot.service.ts` (monthly @1AM, MRR movements, per-tenant snapshots) |
| Billing | `billing/billing.service.ts` (MercadoPago adapter, subscription lifecycle, plan quotas) |
| Billing webhooks | `billing/webhook.controller.ts` (HMAC-SHA256 verify + idempotency + dispatch) |
| Billing reconciliation | `billing/processors/reconciliation.processor.ts` (hourly past_due sweep + daily drift) |
| Impersonation | `auth/auth.service.ts` (impersonate method, 1h tokens, audit trail) |
| Suspended screen | `dashboard/src/components/SuspendedScreen.tsx` |
| Impersonation banner | `dashboard/src/components/ImpersonationBanner.tsx` |
| Financials dashboard | `dashboard/src/app/admin/financials/page.tsx` (5 tabs) |
| Billing settings | `dashboard/src/app/admin/settings/billing/page.tsx` |
| Booking engine | `appointments/booking-engine.service.ts` (deterministic flow, Redis state) |
| Booking i18n | `appointments/booking-messages.ts` (21 directives x 4 languages) |
| Calendar integrations | `appointments/calendar-integration.service.ts` (Google/Microsoft sync) |
| Intent interpreter | `appointments/intent-interpreter.service.ts` (NLP for booking intents) |
| **CRM Analytics** | `crm/services/crm-analytics/crm-analytics.service.ts` (overview, funnel, velocity, win-loss, leaderboard, sources) |
| **CRM AI Insights** | `crm/services/crm-insights/crm-insights.service.ts` (per-lead AI insight) |
| **Phone normalization** | `common/utils/phone.util.ts` (E.164 normalization for LatAm) |
| **Handoff notifications** | `handoff/handoff.service.ts` (email + skill routing + SLA) |
| **SLA escalation** | `agent-console/agent-availability.service.ts` (escalateStaleHandoffs @2min) |
| **Appointment completion** | `appointments/appointment-reminders.service.ts` (auto-complete + attendance confirmation) |
| **Calendar reassign** | `appointments/appointments.controller.ts` (reassign-disconnect endpoint) |
| **Prompt assembler** | `conversations/prompt-assembler.service.ts` (3-layer + safety guardrails) |
| **Identity manual merge** | `identity/identity.controller.ts` (POST manual-merge) |
| **Pipeline stages** | `crm/crm.controller.ts` (CRUD pipeline-stages endpoints) |
| **Vertical definitions** | `verticals/vertical-definitions.ts` (12 industries × 4 languages with sub-types) |
| **Vertical service** | `verticals/verticals.service.ts` (bootstrapVertical, getVerticalConfig) |
| **Vertical terms hook** | `dashboard/src/hooks/useVerticalTerms.ts` |
| **Properties service** | `vacation-rental/properties.service.ts` (CRUD + availability anti-double-booking) |
| **iCal sync** | `vacation-rental/ical-sync.service.ts` (import/export .ics + 30-min cron) |
| **Scoring config page** | `dashboard/src/app/admin/settings/scoring-config/page.tsx` |
| **Properties pages** | `dashboard/src/app/admin/properties/` (list + detail with 5 tabs) |
| **Disconnect modal** | `dashboard/src/components/ui/disconnect-channel-modal.tsx` |

## Dashboard pages (60+)

| Section | Pages |
|---------|-------|
| **Auth** | Login (Remember Me, session expired banner), Forgot Password (OTP), Setup Password (Google OAuth), Verify Email (6-digit OTP) |
| **Onboarding** | 5-step company wizard (step 5: plan picker — Starter self-serve, Pro/Enterprise tagged for contact) |
| **Core** | Dashboard, Inbox (WhatsApp-style chat + channel identification + notifications), Trial Countdown Banner (persistent, all admin pages) |
| **CRM** | Contacts (bulk actions, advanced filters, create modal), Lead Detail (inline edit, archive, custom fields, score breakdown, AI insight), Pipeline/Embudo (Kanban, configurable stages), Segments, CRM Analytics (4 tabs) |
| **AI** | Agent List (multi-agent management, templates), Agent Editor (/agent/[agentId] — hub card grid + channel assignment + custom prompt mode), AI Settings |
| **Automation** | Rules (4-step wizard), Settings |
| **Analytics** | Analytics V2 (8 tabs: Overview/AI & Bot/Automation/Campaigns/Channels/CSAT/Anomalies/Cohorts), Agent Performance (legacy 4 tabs) |
| **Channels** | Overview, WhatsApp Setup, Instagram Setup (OAuth popup + callback), Messenger Setup (FB SDK Login), Telegram Setup, SMS/Twilio Setup |
| **Identity** | Merge Suggestions (approve/reject), Manual Merge (cross-channel contacts) |
| **Settings** | General, Custom Attributes, Macros, Pre-Chat Forms, Media (image bank + logo + tags), Email Templates (editor + preview), Change Password, **Alerts & Reports**, **Billing** (plan, countdown, actions, payment history), **Scoring Config** (weight sliders, keyword tags, decay toggle) |
| **Scheduling** | Appointments (week/day calendar, agenda, services + staff + modality, config + multi-calendar, analytics), Public Booking (/book/:tenantSlug) |
| **Operations** | Broadcast, Inventory, Orders, Compliance, Knowledge Base |
| **Properties** | Properties List (/admin/properties), Property Detail (/admin/properties/[id] — 5 tabs: Info/Calendar/Bookings/iCal Feeds/Check-in). Sidebar visible only when vertical = turismo |
| **Super Admin** | Tenants Hub (6 tabs: Overview/Onboarding/Offboarding/Billing/Usage/Platform + detail page + impersonation), Financials (5 tabs: Overview/Revenue/Customers/Costs/Settings) |
| **Suspended** | SuspendedScreen (full-page block for suspended tenants) |
| **Public** | `/kb/[tenantSlug]` (public help center, light theme, no auth) |

## Analytics System (Comprehensive)

### Dashboard Analytics Endpoints (12 total under /dashboard-analytics/)
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

### Alerts & Reports (under /analytics-config/)
| Endpoint | Purpose |
|----------|---------|
| `GET/POST/PUT/DELETE alerts/:tenantId` | CRUD alert rules |
| `GET alerts/:tenantId/:ruleId/history` | Alert trigger history |
| `GET/POST reports/:tenantId` | Scheduled report config (frequency + recipients) |

### BI API (under /bi-api/ — X-API-Key auth, no JWT)
| Endpoint | Purpose |
|----------|---------|
| `GET kpis` | KPIs with period comparison |
| `GET time-series` | Conversation volume time series |
| `GET ai-metrics` | AI resolution, containment, cost |
| `GET realtime` | Live stats |
| `GET export` | Full data export (KPIs + time series + AI + channels) |
| `GET anomalies` | Detected anomalies |
| `GET cohorts` | Cohort retention analysis |

### Cron Jobs
| Cron | Service | Purpose |
|------|---------|---------|
| `0 1 1 * *` | FinancialSnapshotService | Monthly financial snapshot (1st, 1AM) |
| `0 2 * * *` | MetricsAggregationService | Nightly aggregation into daily_metrics |
| `0 3 * * *` | OffboardingCronService | Grace period enforcer (past_due >7d → offboard, cancelled period ended → offboard) |
| `0 4 * * *` | OffboardingCronService | Archive cleaner (drop schemas of tenants inactive >90 days) |
| `0 6 * * *` | InstagramTokenRefreshService | Refresh IG tokens expiring within 30 days |
| `*/15 * * * *` | AlertsService | Evaluate threshold alert rules |
| `0 8 * * 1` | ScheduledReportsService | Send weekly email reports (Monday 8AM) |
| `0 8 1 * *` | ScheduledReportsService | Send monthly email reports (1st, 8AM) |
| `*/5 * * * *` | AgentAvailabilityService | Auto-offline inactive agents (15min) |
| `0 */6 * * *` | NurturingService | Auto-resolve stale conversations (72h) |
| `0 */2 * * *` | NurturingService | Check stale conversations for follow-up |
| `*/15 * * * *` | AppointmentRemindersService | Send 24h appointment reminders |
| `3,18,33,48 * * * *` | AppointmentRemindersService | Send 1h appointment reminders |
| `5,35 * * * *` | AppointmentRemindersService | Auto-mark no-shows + send follow-up |
| `20 * * * *` | AppointmentRemindersService | Auto-complete confirmed appointments (ended 2+ hours ago) |
| `*/2 * * * *` | AgentAvailabilityService | Escalate stale handoffs (>5 min no response → supervisor) |
| `*/30 * * * *` | IcalSyncService | Sync all active iCal feeds across tenants (import Airbnb/Booking.com blocks) |
| daily | BillingService | Trial ending soon (3 days before trial end) |
| hourly | ReconciliationProcessor | Past_due sweep + daily drift detection |

### Redis Keys (Analytics)
```
analytics:{tenantId}:{YYYY-MM-DD}:conversation_started  — Daily counter (7d TTL)
analytics:{tenantId}:{YYYY-MM-DD}:total                  — All messages/events
analytics:{tenantId}:{YYYY-MM-DD}:handoff_triggered       — Escalation counter
analytics:{tenantId}:{YYYY-MM-DD}:cost                    — LLM cost (float)
analytics:{tenantId}:{YYYY-MM-DD}:model:{modelName}       — Per-model usage
analytics:{tenantId}:{YYYY-MM-DD}:hourly:{0-23}           — Volume per hour
refresh:{userId}:{tokenId}                                — Refresh tokens (8h or 14d TTL)
booking:{conversationId}                                  — Booking engine state (1h TTL)
lock:conv:{conversationId}                                — Conversation processing mutex (30s TTL)
offboard:past_due:{tenantId}                              — Past-due timer start (30d TTL, 7d grace)
tenant_plan:{tenantId}                                    — Cached plan info (invalidated on offboard/reactivate)
handoff:{tenantId}:{conversationId}                       — Handoff state (reason, startedAt, assignedTo) 24h TTL
vertical:{tenantId}                                       — Vertical config cache (10min TTL)
```

### Tenant Schema Tables (Analytics)
```
analytics_events       — Event logging (event_type, conversation_id, data JSONB)
daily_metrics          — Pre-aggregated daily stats (dimension_type: global/channel/agent/hourly)
csat_surveys           — Customer satisfaction (1-5 rating + feedback)
conversation_assignments — Agent handoff tracking (first_response_at, resolved_at)
alert_rules            — Threshold alert config (metric, operator, threshold, cooldown)
alert_history          — Alert trigger history
scheduled_reports      — Report delivery config (frequency, recipients)
dashboard_preferences  — Widget config per user
automation_executions  — Rule execution audit trail
agent_personas         — Multi-agent config (name, model, system prompt, channel assignment, template_id)
agent_templates        — Reusable agent templates (builtin + tenant-created)
calendar_integrations  — External calendar connections (Google/Microsoft), label, assignment_type, assignment_id
services               — Bookable services (+ location_type: in_person/online/hybrid, location_address, meeting_link)
pipeline_stages        — Configurable pipeline stages (name, slug, color, position, probability, sla_hours, is_terminal)
scoring_config         — Lead scoring configuration (weights JSONB, purchase_keywords, decay settings)
properties             — Vacation rental properties (name, description, max_guests, amenities JSONB, ical_token)
ical_blocks            — Blocked periods imported from external iCal feeds (property_id, start_date, end_date, source_uid, summary)
ical_feeds             — iCal feed URLs to import (property_id, url, platform, last_synced_at)
property_bookings      — AI-created bookings for vacation rentals (property_id, contact_id, check_in, check_out, status)
```

### Global Prisma Tables (Billing & Finance)
```
billing_plans              — 4 plan definitions (starter/pro/enterprise/custom) with prices
billing_subscriptions      — Per-tenant subscription (status, trial, MercadoPago external IDs)
billing_payments           — Payment history (amount, status, provider reference)
financial_snapshots        — Monthly platform-wide SaaS metrics (MRR, churn, costs, plan distribution)
tenant_financial_snapshots — Per-tenant monthly snapshots (revenue, LLM cost, plan, message count)
infra_costs                — Monthly infrastructure costs by category (VPS, domain, etc.)
exchange_rates             — Currency exchange rates for multi-currency support
audit_logs                 — Offboarding and billing audit trail
```

## Billing System (Apr 2026)

- **Payment provider**: MercadoPago (LatAm market). Adapter pattern via `IPaymentProvider` interface
- **Plans**: 4 plans seeded in `billing_plans` table, synced to MercadoPago via `sync-mp-plans.js`
- **Subscription lifecycle**: trialing → active → past_due → cancelled/expired. State machine in `BillingService`
- **Trial**: Created at end of onboarding (`completeOnboarding`). Daily cron fires `trial.ending_soon` 3 days before end
- **Webhooks**: `POST /billing/webhooks/mercadopago` with HMAC-SHA256 verification + Redis idempotency
- **Reconciliation**: Hourly past_due sweep + daily drift detection via `ReconciliationProcessor`
- **Plan quotas**: Server-side enforcement on services count, automation rules count, broadcast limits
- **Email templates**: 5 billing-specific templates (payment_success, payment_failed, trial_ending, subscription_cancelled, plan_upgraded)
- **Dashboard pages**: `/admin/settings/billing` (plan info, countdown, actions, payment history), onboarding step 5 (plan picker)
- **Card tokenization**: MercadoPago card tokenization for Pro/Enterprise self-serve checkout

## Offboarding System (Apr 2026)

- **Tenant lifecycle**: active → cancelled (voluntary, keeps access until period end) → offboarded (7-step pipeline) → archived (schema dropped after 90d inactive)
- **7-step offboarding pipeline**: (1) disconnect all channels (WhatsApp WABA unsubscribe, Telegram webhook delete), (2) revoke all user sessions, (3) drain BullMQ queues, (4) deactivate tenant + users, (5) invalidate Redis caches, (6) audit log, (7) emit `tenant.offboarded` event
- **Grace period**: past_due tenants get 7-day grace via Redis key `offboard:past_due:{tenantId}`. Cron at 3AM enforces
- **Archive cleaner**: Cron at 4AM drops schemas of tenants inactive >90 days
- **Admin actions**: suspend (immediate offboard), reactivate (restore access), extend trial
- **Billing event listeners**: `billing.payment.failed` starts grace timer, `billing.payment.succeeded` clears it
- **Endpoints**: `POST /offboarding/:tenantId/cancel` (tenant_admin), `POST /offboarding/:tenantId/suspend` (super_admin), `GET /offboarding/:tenantId/status`, `POST /offboarding/:tenantId/reactivate`, `POST /offboarding/:tenantId/extend-trial`

## Financials System (Apr 2026)

- **SaaS metrics**: MRR, ARR, ARPU, customer/revenue churn rate, LTV, quick ratio
- **Monthly snapshots**: Platform-wide + per-tenant. MRR movements (new, expansion, contraction, churned, reactivation)
- **Infra costs**: Manual entry by category (VPS, domain, etc.) + LLM costs aggregated from tenant schemas
- **Tenant profitability**: Revenue minus LLM cost per tenant, with margin calculation
- **Trial metrics**: Active trials, ending soon (7d), conversion rate
- **Endpoints**: 11 endpoints under `/financials/` (overview, mrr-trend, revenue, churn-trend, costs, tenant-profitability, trial-metrics, infra-costs GET/POST, exchange-rates, snapshot/generate). All super_admin only

## Super Admin Dashboard (Apr 2026)

- **Tenants Hub** (`/admin/tenants`): 6 tabs — Overview (all tenants + KPIs + vertical badge + health dot columns), Onboarding (new tenants), Offboarding (cancelled/suspended), Billing (subscription status), Usage (platform metrics), Platform (health). Overview shows 6 platform KPIs: tenants, users, active, messagesToday, pendingHandoffs, vertical distribution
- **Tenant Detail** (`/admin/tenants/[tenantId]`): 6 tabs — Info, Users, Channels, Billing, Engagement, AI Config. Edit tenant, suspend, impersonate
- **Impersonation**: `POST /auth/impersonate/:tenantId` generates 1h tokens with `isImpersonation: true` + `impersonatedBy` in JWT. Dashboard shows amber `ImpersonationBanner` with "Exit" button. LocalStorage-based state preservation
- **Suspended Screen**: Full-page block (`SuspendedScreen` component) shown when tenant `isActive: false`. Only action: logout
- **Financials** (`/admin/financials`): 5 tabs — Overview (KPIs: MRR, ARR, ARPU, churn, LTV), Revenue (trend + payments), Customers (churn trend + profitability), Costs (LLM + infra), Settings (infra cost entry, exchange rates, manual snapshot)

## Channel OAuth Flows (Apr 2026)

- **Instagram OAuth**: User clicks "Connect" → opens popup to `https://www.instagram.com/oauth/authorize` with `instagram_basic,instagram_manage_messages` scopes → callback page at `/admin/channels/instagram/callback` exchanges code for long-lived token → stored encrypted. Daily cron refreshes tokens expiring within 30 days
- **Messenger FB SDK**: Page loads Facebook SDK → `FB.login()` with `pages_messaging,pages_manage_metadata` permissions → exchanges short-lived token for page token → stored encrypted. Uses `NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID` for FB Login configuration
- **Environment vars**: `NEXT_PUBLIC_INSTAGRAM_APP_ID`, `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI`, `NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID`

## Auth & Session Management

- **Access Token**: 15min JWT, auto-refreshed proactively every 12min
- **Refresh Token**: 8h default, 14d with "Remember Me". Stored in Redis, rotated on each use
- **Replay Detection**: If a refresh token is reused (already revoked), ALL user sessions are revoked
- **Idle Timeout**: 60min with 2-min warning modal + countdown. BroadcastChannel syncs across tabs
- **Logout**: Calls `POST /auth/logout` to revoke token, broadcasts to all tabs
- **Password Change**: Revokes all refresh tokens (force re-login)
- **Redis Keys**: `refresh:{userId}:{tokenId}` with TTL matching token lifetime

## BullMQ Queues (5 total)

| Queue | Concurrency | Rate Limit | Purpose |
|-------|------------|-----------|---------|
| outbound-messages | 5 | 20/s | Cross-channel message delivery |
| broadcast-messages | 10 | 80/s | Mass template campaigns |
| automation-jobs | 10 | 30/s | Automation rule actions |
| nurturing | 5 | 10/s | Follow-up sequences |
| conversation-snooze | 1 | — | Delayed wake-up for snoozed conversations |

## Observability Stack

- **Logging**: Pino (nestjs-pino) structured JSON with tenantId/userId context. Pretty in dev, JSON in prod. Docker json-file driver with rotation (50MB x 5)
- **BullMQ Dashboard**: Bull Board at `/api/v1/admin/queues` (auth via BULL_BOARD_TOKEN query param or X-Admin-Token header). All 5 queues visible
- **Error Tracking**: Sentry with `@OnWorkerEvent('failed')` on all 4 BullMQ processors (outbound, broadcast, automation, nurturing)
- **Log Viewer**: Dozzle (port 9999) — real-time Docker log viewer with search → `logs.parallly-chat.cloud`
- **Endpoint Monitoring**: Uptime Kuma (port 3003) — monitors API/Dashboard/WA/Landing/PG/Redis with email+Telegram alerts → `status.parallly-chat.cloud`
- **Dashboards**: Grafana (port 3004) + Loki (port 3100) + Promtail — log aggregation, dashboards, alerting → `grafana.parallly-chat.cloud`
- **Log Pipeline**: Promtail reads Docker logs → sends to Loki → Grafana queries Loki
- **Log Persistence**: Docker volumes `parallext-api-logs`, `parallext-worker-logs` survive deploys
- **All observability bound to 127.0.0.1** — exposed through Cloudflare Tunnel (hostnames use service name, not container_name)
- **Config files**: `infra/promtail/config.yml` (Promtail), `infra/docker/docker-compose.prod.yml` (all services)
- **Full manual**: `docs/observability-manual.md`

## i18n (4 languages)

- **Dashboard**: next-intl, 4 files in `apps/dashboard/messages/` (es/en/pt/fr), ~700 lines each
- **Landing**: next-intl via custom LangProvider (React Context), 4 files in `apps/landing/messages/`, 15 sections fully translated
- **Convention**: Every page edit MUST include i18n updates in all 4 JSON files
- **Status**: 0 hardcoded Spanish strings remaining as of April 18, 2026. All dashboard strings use next-intl with 4 languages

## Calendar System (Apr 22-23, 2026)

- **Multi-calendar**: N calendars per tenant, plan-gated (starter:1, pro:3, enterprise:10, custom:999)
- **Calendar assignment model**: Each calendar assigned to staff, service, or general (fallback)
- **3-tier resolution**: service → staff → general when checking availability or creating events
- **Auto meeting links**: Google creates Meet link, Microsoft creates Teams link when service is online
- **Calendar sync on AI booking**: Appointments created by AI push to Google/Microsoft Calendar automatically via `appointment.created` event
- **Event naming**: "Service Name — Customer Name" format. Description includes customer info + last 5 messages
- **Attendee invites**: Google `sendUpdates:'all'`, Microsoft auto-sends
- **Disconnect protection**: Can't disconnect calendar if future appointments exist
- **Live calendar updates**: WebSocket `appointmentCreated`/`Updated` events refresh dashboard in real-time

## Navigation Restructure (May 2, 2026)

- **Sidebar reduced from 22 to 8 items**: Conversaciones, CRM, Embudo, Agenda, Campañas, Análisis, Agente IA, Propiedades — following HubSpot/Intercom/Zendesk patterns
- **Settings separated at bottom**: No longer in the main nav; all settings accessible via dedicated Configuración hub
- **Role-based nav**: Campañas requires supervisor+, Agente IA requires admin+, Settings sections require admin+
- **Settings reorganized into 8 domain sections**: Cuenta, Empresa, IA & Automatización, Canales, Catálogo & Datos, Contenido, Equipo, Privacidad & Avanzado
- **Analytics consolidated**: 10 tabs (added CRM Analytics + Agentes — no more separate report pages)
- **10 orphan pages now accessible via Settings**: alerts, policies, landings, scoring config, pre-chat forms, media, macros, compliance, knowledge base, etc.
- **Propiedades** sidebar item visible only when vertical = turismo

## Onboarding Vertical Overhaul (May 2, 2026)

- **Step 2 (Audiencia) adapts per vertical**: "Pacientes particulares / Por derivación / Obra social" for salud; "Compradores / Inversores / Arrendatarios" for inmobiliaria
- **Step 3 (Objetivos) adapts per vertical** with dynamic title: "¿Cómo ayudará Sofía a tus pacientes?" (using agent name from vertical config)
- **16 vertical agent templates** across 7 industries (salud, belleza, inmobiliaria, restaurantes, automotriz, turismo, educación) in `persona/persona.service.ts`
- **Template picker**: shows "Recomendados para tu negocio" section first when creating a new agent, filtered by tenant vertical

## Properties UX Overhaul (May 2, 2026)

- **30 amenities in 6 categories**: Básicos (WiFi/AC/heating/TV/washer/dryer), Dormitorio & Baño (towels/linens/hair dryer/iron/wardrobe), Cocina (full kitchen/microwave/coffee/dishes/fridge/freezer), Exterior (pool/BBQ/patio/balcony/garden/parking), Servicios (gym/spa/breakfast/concierge/elevator/wheelchair), Seguridad (lock/safe/fire extinguisher/smoke detector/security)
- **Description field** for rich property details (textarea in create/edit modal)
- **Image gallery** with upload via MediaService — first image becomes card thumbnail in list view
- **Calendar as Tab 1** (most important view for vacation rental operators; was previously not the default)
- **"Sync availability" banner** shown in Calendar tab when no iCal feeds are connected, with direct link to iCal Feeds tab

## Email Templates Transversal (May 2, 2026)

- **5 new default templates seeded**: `property_booking_confirmation`, `property_check_in_reminder`, `appointment_confirmation_email`, `appointment_reminder_email`, `handoff_notification`
- **Connected to flows**: booking engine → sends `property_booking_confirmation` email automatically; appointment created → sends `appointment_confirmation_email`; handoff triggers → uses `handoff_notification` template instead of hardcoded string
- **Template picker wizard**: "Crear desde plantilla" button in email editor opens modal with 6 presets (appointment confirm, reminder, booking confirm, check-in reminder, welcome, team notification)
- **Total default templates**: 14 (9 previous + 5 new)

## Security Fixes (May 1-2, 2026)

- **CRITICAL**: `getAvailableAgents()` in `agent-console.service.ts` was querying the `conversations` table without schema scope — leaked agent data across tenants. Fixed with `executeInTenantSchema`
- **Schema reuse cleanup**: `createTenantSchema()` in `tenants.service.ts` now detects an existing schema (from a deleted tenant reusing the same slug) and cleans stale data before bootstrapping
- **Checklist fallback**: Onboarding vertical checklist uses `.has()` guard to prevent `MISSING_MESSAGE` errors for undefined vertical keys

## Service Modality (Apr 22-23, 2026)

- **location_type**: `in_person` | `online` | `hybrid` on services table
- **location_address**: Physical address for in-person services
- **meeting_link**: Pre-configured meeting URL (or auto-generated from calendar provider)
- **Dashboard UI**: ServiceModal has modality buttons, conditional address/link fields

## Pipeline Hardening (Apr 22-23, 2026)

- **conversation.updated_at fix**: `saveMessage` and `saveAiMessage` now UPDATE `conversations.updated_at`. Was frozen at creation time — root cause of state being lost every turn
- **Redis-backed booking state**: Primary store in Redis (1h TTL), PostgreSQL as backup. Loaded from Redis first
- **Conversation mutex**: Redis SETNX lock per conversation prevents race conditions on simultaneous messages
- **History limited in directive mode**: When booking engine handles, only last 4 messages sent to LLM (not full history). Prevents LLM from ignoring directives
- **Intent interpreter improvements**: Confirmation no longer returns early (extracts service/date/time too). Numbered selection ("el 1", "la 2", ordinals). Stem matching for fuzzy service names. Single-word names accepted
- **Double booking protection**: Early return when step=booked. Duplicate check before INSERT (same contact+service+time)
- **Greeting skip engine**: Greeting/farewell at idle properly skips booking engine

## CRM Overhaul (Apr 26-28, 2026)

5-phase CRM enhancement:

- **Lead management**: Create lead modal (phone required), inline edit (name/email/phone/stage/VIP/tags), archive with confirmation dialog, restore from archive
- **Phone normalization**: `normalizePhoneE164()` utility in `common/utils/phone.util.ts`. Supports LatAm (CO/AR/MX/BR/CL/PE/EC) + US/CA. Auto-applied on lead creation and identity resolution
- **Auto-merge on phone match**: Identity service normalizes phone before lookup → automatic merge when same E.164 number detected across channels
- **Custom field values**: Per-contact custom attribute values rendered by type (text/number/boolean/date/select) in lead detail view
- **Bulk actions**: Checkbox selection + "select all" + fixed bottom action bar (change stage, add tag, archive)
- **Advanced filters**: Score min/max, date range, tags, combined with existing stage/search filters
- **Pipeline stages config**: Full CRUD (`pipeline_stages` table) with name, slug, color, position, probability, SLA hours, is_terminal flag. Drag-to-reorder
- **CRM Analytics dashboard**: Dedicated analytics with 4 tabs (Overview KPIs, Funnel visualization, Pipeline Velocity, Agent Leaderboard). 6 endpoints under `/crm/analytics/:tenantId/`
- **Score transparency**: Expandable breakdown panel showing 5 factors (engagement, intent, recency, stage, profile) with visual progress bars
- **Configurable scoring**: `scoring_config` table (weights JSON, purchase_keywords array, decay_enabled, decay_days, decay_factor). Endpoints: GET/POST `/crm/scoring-config/:tenantId`
- **Dynamic segments**: Rule-based filters (stage, tag, score, channel, date) auto-evaluated on query. CRUD + contact count endpoint
- **AI Insights**: `CrmInsightsService` provides per-lead AI analysis. Endpoint: GET `/crm/leads/:tenantId/:leadId/insight`
- **Deal approval workflow**: 3 endpoints — `PUT request-approval` (sets pending status), `PUT approve` (moves to target stage), `PUT reject` (with reason). Fields: `approval_status`, `approval_stage`, `approved_by` on opportunities table

## Handoff System Enhancement (Apr 26-28, 2026)

3-phase improvement to human handoff:

- **Email notifications**: When handoff triggers and an agent is assigned, an HTML email is sent with client name, phone, reason, last message, and "Open Inbox" CTA button
- **Skill-based routing**: `tryAutoAssign()` maps handoff reasons to skill tags (frustration→complaints, explicit_request→general, max_failed→technical). Queries `users.skill_tags` array and `max_capacity` column. Prefers matching skills, falls back to least-loaded
- **SLA tracking**: Conversation assignments include `sla_deadline` (default 5 min). Creates record in `conversation_assignments` table
- **Supervisor escalation cron**: `AgentAvailabilityService.escalateStaleHandoffs()` runs every 2 minutes. Finds conversations waiting >5 min without agent response → emits `handoff.escalated_supervisor` event → WebSocket `inbox:escalation` to dashboard. Marks as escalated to avoid re-processing
- **WebSocket notifications**: `inbox:handoff` broadcast to all tenant agents + direct `inbox:handoff_direct` to assigned agent. `inbox:escalation` for supervisor alerts
- **Dashboard sound/visual**: Client-side sound notification + visual badge on handoff events (driven by WebSocket)

## Appointment Completion System (Apr 26-28, 2026)

- **Attendance confirmation**: After appointment end time, sends message to customer via their messaging channel asking if they attended. Source metadata: `appointment_attendance_check`
- **Auto-complete cron**: `@Cron('20 * * * *')` — every hour at :20, marks confirmed appointments as completed if they ended 2+ hours ago (runs after no-show detection at :35)
- **CSAT trigger**: After completion, triggers customer satisfaction survey via messaging channel
- **No-show follow-up**: Sends follow-up message to no-shows offering to reschedule

## Calendar Disconnect with Reassignment (Apr 26-28, 2026)

- **Reassign-or-cancel flow**: When disconnecting a calendar with future appointments, API returns count + other available calendars
- **Endpoint**: `POST /appointments/:tenantId/calendar/:integrationId/reassign-disconnect` — reassigns all future appointments to target calendar, then disconnects source
- **Dashboard UI**: Modal shows appointment count and dropdown to select target calendar before confirming disconnect

## Safety Guardrails — Layer 1 (Apr 26-28, 2026)

Universal forbidden topics in the prompt contract layer (cannot be overridden by persona config):
- Violence, weapons, illegal activities, self-harm
- Explicit sexual content, child exploitation
- Discrimination, hate speech
- Drug manufacturing or procurement
- Hacking, malware, social engineering
- Personal information of third parties
- Legal advice (refer to professional)
- Financial investment advice (refer to licensed advisor)

Response when triggered: "I'm not able to help with that. Is there anything else I can assist you with regarding our products or services?"

## Identity — Manual Merge (Apr 26-28, 2026)

- **Endpoint**: `POST /identity/:tenantId/manual-merge` with `{ contactIdA, contactIdB }`
- **Dashboard UI**: In contact detail or identity page, select two contacts to merge manually
- **Use case**: Cross-channel contacts without matching phone/email that a human identifies as the same person
- **Preserves**: All conversation history from both contacts consolidated into one unified profile

## Inbox Improvements (Apr 26-28, 2026)

- **Responsive toolbar**: Actions collapse to icon-only on small screens, secondary actions in "More" dropdown menu
- **Collapsible contact panel**: Right panel toggles visibility for more chat space
- **Safe dates**: All date rendering uses safe parsing to prevent hydration mismatches
- **Channel account info**: Each conversation shows the channel account name + profile photo for identification
- **BroadcastChannel OAuth**: Instagram/Messenger OAuth popup results propagated to parent window via BroadcastChannel API

## Pipeline Rename & Configuration (Apr 26-28, 2026)

- **Renamed**: Pipeline section now called "Embudo de ventas" in Spanish i18n
- **Configurable stages**: Settings page with drag-to-reorder, edit (name/color/probability/SLA), add, delete, terminal toggle
- **`pipeline_stages` table**: id, tenant_id, name, slug, color, position, default_probability, sla_hours, is_terminal
- **Full i18n**: All pipeline stage management UI in 4 languages

## Channel Improvements (Apr 26-28, 2026)

- **Instagram profile photos**: Fetched via IG Basic Display API on connect, displayed in channel overview and inbox
- **Messenger profile photos**: Fetched via FB Graph API (`/me/picture`), displayed alongside page name
- **BroadcastChannel OAuth sync**: OAuth popup results for IG and Messenger propagated to parent dashboard tab via BroadcastChannel API (no polling needed)

## Vertical Adaptation System (Apr 29-30, 2026)

- **Purpose**: When a tenant selects their industry during onboarding, the entire platform adapts automatically — UI labels, AI persona, pipeline stages, FAQs, services, and sidebar navigation
- **Module**: `apps/api/src/modules/verticals/` — VerticalsService, VerticalsController, vertical-definitions.ts
- **12 industries × 4 languages**: salud, moda_belleza, inmobiliaria, restaurantes, automotriz, turismo, education, finanzas, servicios_profesionales, retail, technology, otro. Each definition carries es/en/pt/fr term sets
- **Sub-types**: Each industry has 3-5 sub-types (e.g., salud → dental, medica_general, estetica, psicologia, farmacia). Sub-type refines bootstrap content
- **Bootstrap on onboarding**: `completeOnboarding()` calls `bootstrapVertical(tenantId, industry, subType, lang)` which:
  1. Seeds 5-7 pipeline stages per industry (e.g., salud: nuevo_paciente → consulta_agendada → en_tratamiento → seguimiento → alta)
  2. Patches default AI agent (name, persona, language, forbidden topics, handoff triggers)
  3. Creates 5 seed FAQs tailored to the industry
  4. Creates 3 seed bookable services for booking-enabled industries
- **Prompt assembler — `<vertical_context>` injection**: Layer 3 turn context receives an XML block with `customer_noun`, `transaction_noun`, `service_noun` so the LLM uses correct terminology without hallucinating
- **Contract rule #11**: "Use the vertical terminology naturally (paciente, no cliente; propiedad, no producto)"
- **Dashboard visual adaptation**:
  - `AuthContext` fetches and stores `verticalConfig` from `GET /verticals/:tenantId` on login
  - `AppSidebar`: dynamic label overrides (e.g., CRM → "Pacientes" for salud) + hidden items per industry (no Inventory for clinics; Propiedades visible only for turismo)
  - `useVerticalTerms()` hook returns locale-aware terminology for use in page copy
  - Homepage view changes per vertical: agenda-first for clinics, lead funnel for inmobiliaria
  - Empty states per industry ("Cuando llegue tu primer paciente...", "Tu primer inmueble aparecerá aquí...")
  - Onboarding checklist step labels adapt ("Configura tu asistente médico" vs "Configura tu agente de ventas")
  - Contextual welcome message on dashboard ("Bienvenido a tu consultorio virtual")
- **Config storage**: `tenant.settings.verticalConfig` JSONB column — snapshot stored at onboarding completion
- **Cache**: Redis key `vertical:{tenantId}` with 10min TTL
- **Strategy doc**: `docs/vertical-strategy.md` (complete research + roadmap)

## Vacation Rental Module (Apr 30, 2026)

- **Module**: `apps/api/src/modules/vacation-rental/` — VacationRentalModule, PropertiesService, IcalSyncService, VacationRentalController
- **4 tenant-schema tables**: `properties`, `ical_blocks`, `ical_feeds`, `property_bookings` (see Tenant Schema Tables above)
- **Properties CRUD**: Plan-gated limits (starter:2, pro:10, enterprise:50, custom:unlimited). Fields: name, description, max_guests, amenities JSONB, check-in instructions, ical_token (random UUID for public export URL)
- **Availability check**: `checkAvailability(propertyId, checkIn, checkOut)` merges `ical_blocks` (external) + `property_bookings` (internal) to prevent double-booking
- **iCal Import**: `IcalSyncService` parses Airbnb/Booking.com `.ics` feeds using `node-ical`. Upserts blocks by `source_uid`. Cron `*/30 * * * *` syncs all active feeds across tenants
- **iCal Export**: Generates `.ics` using `ical-generator`. Includes both `ical_blocks` (external blocks) and confirmed `property_bookings`
- **Public iCal endpoint**: `GET /public/ical/:tenantSlug/:propertyId/:token/calendar.ics` — no auth, token is `properties.ical_token`. Used by Airbnb/Booking.com to subscribe to the property calendar
- **5 AI agent tools** (registered when `config.tools.vacationRental.enabled`):
  - `list_properties` — list all properties with occupancy status
  - `check_property_availability` — check dates for a specific property
  - `get_property_details` — full property info (amenities, rules, pricing)
  - `get_check_in_instructions` — retrieves check-in instructions for confirmed guest
  - `create_property_booking` — creates a booking after guest confirms dates + details
- **Dashboard pages**: `/admin/properties` (list with plan-limit badge) + `/admin/properties/[id]` (5 tabs: Info, Calendar, Bookings, iCal Feeds, Check-in Instructions)
- **Sidebar visibility**: "Propiedades" menu item visible only when `verticalConfig.industry === 'turismo'`
- **NPM packages**: `node-ical` (iCal parser) + `ical-generator` (iCal writer)

## Super Admin Enhancements (Apr 29-30, 2026)

- **Tenant engagement endpoint**: `GET /tenants/:id/engagement` returns messages 7d/30d, active conversations, handoffs triggered, agents count, FAQs count, services count, health score (0-100)
- **Health score formula** (0-100):
  - Channels connected (0-20): 20 if ≥1 channel active
  - Agent configured (0-20): 20 if agent has persona + model set
  - FAQs (0-15): 8 if ≥1 FAQ, 15 if ≥5 FAQs
  - Services (0-10): 10 if ≥1 service configured
  - Activity (0-35): 35 if messages in last 7d, 20 if in last 30d, 5 if only historic
- **Tenant Detail expanded to 6 tabs**: Info, Users, Channels, Billing, Engagement (health score + activity metrics), AI Config (agent personas + model view)
- **Tenants overview enhancements**: Vertical badge column (industry pill) + health dot column (green/yellow/red based on score)
- **Platform KPIs** on overview: 6 cards — total tenants, total users, active tenants (msg last 30d), messagesToday (cross-schema), pendingHandoffs (cross-schema), vertical distribution (pie)
- **Cross-tenant aggregation**: `getPlatformStats()` iterates all active tenant schemas to aggregate messages + handoffs — used for platform KPIs and super admin overview

## Frontend Features Completed (Apr 30, 2026)

- **Scoring Config settings page** (`/admin/settings/scoring-config`): weight sliders for 5 scoring factors (engagement, intent, recency, stage, profile completeness), purchase keyword tag input, decay toggle with decay_days + decay_factor inputs. Calls GET/POST `/crm/scoring-config/:tenantId`
- **AI Insights card on lead detail**: Collapsible panel on lead detail page, lazy-loaded on expand. Calls `GET /crm/leads/:tenantId/:leadId/insight`. Shows: summary, recommended action, risk level, top signals. Skeleton while loading
- **Deal approval UI on pipeline kanban**: Pending-approval badge on opportunity cards, approve/reject buttons visible to supervisors/admins. Terminal stage interception: moving a card to a terminal stage triggers approval-request flow instead of direct move
- **Advanced filter drawer for contacts**: Slide-out drawer panel with score min/max range sliders, creation date range pickers, tags multi-select + active filter chips. Merges with existing stage/search filters
- **Skill tags editor on users page**: Inline tag editor on user rows with 8 suggested skills (ventas, soporte, quejas, técnico, general, facturación, citas, cobranza). Calls `PUT /auth/users/:userId/skills` to persist `users.skill_tags` array
- **DisconnectChannelModal** (`dashboard/src/components/ui/disconnect-channel-modal.tsx`): Unified custom confirmation modal replacing browser `confirm()` on all 5 channel disconnect actions. Shows channel name, warning text, confirm/cancel buttons with destructive styling
- **Channel UX cleanup**: Removed internal webhook config sections from WhatsApp, Instagram, and Messenger setup pages (not needed by users). Added explicit "Disconnect WhatsApp" button to WhatsApp setup page (was missing)

## Production Resilience Fix (Apr 29, 2026)

Root cause: 3 Prisma instances (API main + API worker + WhatsApp) each defaulting to ~10 DB connections exceeded PgBouncer's pool of 25, causing `connection pool timeout` errors under load.

- **PgBouncer tuned**: pool_size 25→50, max_client_conn 500→1000, query_timeout 30→120s
- **PostgreSQL tuned**: max_connections=200 (was 100), work_mem=8MB, effective_cache_size=512MB
- **Prisma connection limits set explicitly**: API main=8, API worker=8, WhatsApp=4 (total ≤20, leaves headroom for migrations/admin)
- **DB retry with backoff**: Both API and WhatsApp `PrismaService` now retry failed connections up to 5 attempts with exponential backoff before throwing
- **Redis connection leak fixes**: `WebhooksService` (WhatsApp) and `HealthController` now properly release Redis client instances after use
- **NurturingService fixes**: Transaction timeout 15s→30s + added `updated_at > (now() - 73h)` pre-filter to avoid scanning full conversations table
- **FeatureRequestsService column fix**: Raw SQL referenced `content` column (Prisma alias) instead of correct DB column name `content_text`

## Navigation Redesign — Definitive (May 2, 2026)

Sidebar redesigned twice — first attempt (22→8 items) made platform feel empty. Final version:
- **3 named sections**: OPERACIÓN (Conversaciones, CRM, Embudo, Agenda, Propiedades), CRECIMIENTO (Campañas, Automatización, Agente IA, Base de Conocimiento), GESTIÓN (Analíticas, Canales, Usuarios)
- **14 items total**: Automation, Channels, Knowledge Base, and Users returned to the sidebar after the 8-item version removed them
- **Settings**: 5 clean sections with ZERO external links — Account, Company, Tools, AI, Advanced (was 8 sections with broken external links)
- **Premium visual**: left-border active state (Linear/Stripe pattern), 240px sidebar width, 16px icons, tenant name in header, user avatar in footer
- **Role-based**: Campañas/Automatización/KB visible to supervisor+, Agente IA/Usuarios visible to admin+
- **Key file**: `dashboard/src/components/AppSidebar.tsx`

## Breadcrumbs & i18n Completion (May 2, 2026)

- ALL 47 breadcrumb `pathLabels` migrated from hardcoded English to i18n (4 languages)
- 25 missing page labels added (settings subpages, properties, scoring config, etc.)
- 7 notification category labels, 3 theme labels, 3 user menu entries — all i18n
- WebSocket event strings migrated from hardcoded Spanish to i18n
- New `topbar` i18n namespace with ~90 keys in all 4 language files
- Zero hardcoded strings remaining in `TopBar` component

## Contextual Help System (May 2, 2026)

- **Component**: `dashboard/src/components/ui/help-panel.tsx`
- Collapsible "?" pill button → expands to: title, description, YouTube video iframe embed, image grid, tips list
- Integrated into ALL 15 admin pages with section-specific content
- **YouTube embed**: pass `videoUrl="https://www.youtube.com/embed/VIDEO_ID"` prop; renders at full width with `aspect-video` ratio
- Help content stored in `help` i18n namespace (15 sections × 4 languages, ~300 keys total)
- Content covers: what the section does, practical tips, and links to related features

## Verification before pushing

```bash
cd apps/api && npx tsc --noEmit        # Type errors
cd apps/api && npm run test:bootstrap  # NestJS DI errors (CRITICAL — tsc doesn't catch these)
cd apps/dashboard && npx tsc --noEmit  # Dashboard type errors
cd apps/landing && npx tsc --noEmit    # Landing type errors
# Check PgBouncer health
docker exec parallext-pgbouncer pg_isready -h localhost -p 6432
```

## Build & run

```bash
npm run dev                             # All apps
npm run dev:api                         # API only
npm run dev:dashboard                   # Dashboard only
npm run dev:whatsapp                    # WhatsApp service only
cd apps/api && npx prisma generate      # Regenerate Prisma client after schema.prisma changes
cd infra/docker && docker compose up -d # Dev infrastructure (postgres + redis)
```

## Environment variables

See `.env.example`. Key ones:
- `DATABASE_URL` — PostgreSQL connection string
- `INTERNAL_JWT_SECRET` — JWT secret shared between API and WhatsApp service
- `JWT_SECRET` — Access token signing secret
- `JWT_REFRESH_SECRET` — Refresh token signing secret (MUST be different from JWT_SECRET). Falls back to insecure default if not set
- `ENCRYPTION_KEY` — 64-char hex for AES-256-GCM (WhatsApp/IG/Messenger/Telegram tokens)
- `INTERNAL_API_KEY` — Service-to-service auth (WhatsApp → API)
- `META_APP_ID/SECRET/CONFIG_ID/VERIFY_TOKEN` — Facebook app credentials
- `SYSTEM_USER_ID` — Meta Business System User (for permanent tokens)
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY` — At least one required
- `SENTRY_DSN` — Sentry error tracking DSN
- `DIRECT_DATABASE_URL` — Direct PostgreSQL connection (bypasses PgBouncer for migrations)
- `GOOGLE_OAUTH_CLIENT_ID` — Google Sign-In client ID
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` — Email service
- `MEDIA_STORAGE_PATH` — /data/media (Docker volume)
- `MERCADOPAGO_ACCESS_TOKEN` — MercadoPago API token (sandbox or production)
- `MERCADOPAGO_PUBLIC_KEY` — MercadoPago public key (for card tokenization)
- `MERCADOPAGO_WEBHOOK_SECRET` — HMAC-SHA256 secret for webhook verification
- `NEXT_PUBLIC_INSTAGRAM_APP_ID` — Instagram OAuth app ID
- `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI` — Instagram OAuth redirect URI
- `NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID` — Facebook Login configuration ID for Messenger

## Production

- Landing: https://parallly-chat.cloud (static, nginx container, 4-language i18n)
- Dashboard: https://admin.parallly-chat.cloud (Next.js, Tailwind + shadcn/ui + recharts)
- API: https://api.parallly-chat.cloud (NestJS, 40 modules, multi-agent)
- WhatsApp: https://wa.parallly-chat.cloud (NestJS, Embedded Signup)
- KB Portal: https://admin.parallly-chat.cloud/kb/{tenant-slug}
- BI API: https://api.parallly-chat.cloud/api/v1/bi-api/ (X-API-Key auth)
- GitHub: https://github.com/Nipko/sales-structure
- VPS: Hostinger Ubuntu, Docker (10 containers incl. PgBouncer), Cloudflare Tunnel
- PgBouncer: Transaction pooling mode, 500→25 connections (parallext-pgbouncer container)
- Sentry: Error tracking + profiling (@sentry/nestjs, instrument.ts loaded first)
- Deploy: Push to main → GitHub Actions → build 5 images → SSH deploy → **regenerate .env from secrets** → migrate (via DIRECT_DATABASE_URL) → restart
- **CRITICAL**: `.env` is regenerated on every deploy from GitHub Actions Secrets. New env vars MUST be added to both GitHub Secrets AND `.github/workflows/deploy.yml`, or they will be lost on next deploy
