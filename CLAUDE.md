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
  api/          — NestJS 10, port 3000. Core business logic, 37 modules
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
- **Database pooling**: PgBouncer (transaction mode) between apps and PostgreSQL. Use `DIRECT_DATABASE_URL` for Prisma migrations
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
- **Subscription plans**: 4 plans: starter, pro, enterprise, custom — controls agent count, template access, and rate limits
- **Channels**: Adapter pattern via `IChannelAdapter`. Supported: WhatsApp, Instagram, Messenger, Telegram, SMS (Twilio). One AI agent per channel (hard rule).

## Prompt Architecture (3 layers — Apr 2026 refactor)

The system prompt is ASSEMBLED per turn by `PromptAssemblerService`:

- **Layer 1 (Contract)** — hardcoded universal rules. Defines that backend controls flow, LLM is the voice, must cite retrieved knowledge, must use `<turn><language>`, must never leak context tags. Identical for every agent.
- **Layer 2 (Persona)** — `<persona>…</persona>` from `PersonaService.buildSystemPrompt(config)`. 100% user configuration (name, role, personality, rules, forbidden topics, handoff triggers, business hours). In `editorMode: 'prompt'`, the user's free-form prompt replaces the guided body but STILL wrapped in `<persona>` so L1/L3 apply.
- **Layer 3 (Turn Context)** — `<turn>…</turn>` structured XML for this specific turn: language (auto-detected), timezone, now, upcoming_days, business_hours_status, business identity, contact profile, booking_state, available_services, retrieved_knowledge (from RAG + tools).

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

## API modules (37 total)

| Category | Modules |
|----------|---------|
| **Infrastructure** | prisma, redis, health, throttle, internal |
| **Auth & Tenants** | auth (JWT + refresh rotation + Google OAuth + 2FA + password reset + session management), tenants, settings |
| **Message Pipeline** | channels (WhatsApp/IG/Messenger/Telegram/SMS adapters), conversations, whatsapp, handoff, agent-console |
| **AI & Config** | ai (router + 5 providers), persona (multi-agent CRUD, templates, channel assignment), knowledge, copilot |
| **CRM & Sales** | crm (leads, contacts, opportunities, custom-attrs, segments, import/export, notes, tasks, activity, scoring), pipeline, catalog |
| **Automation** | automation (rules engine, listener, jobs processor, nurturing, action executor) |
| **Operations** | broadcast, inventory, orders, compliance, email, email-templates |
| **Media & Files** | media (upload, resize, logo, tags, serve) |
| **Scheduling** | appointments (CRUD, availability slots, blocked dates, conflict detection) |
| **Identity** | identity (unified profiles, merge suggestions) |
| **Analytics** | analytics (Redis counters + DB), dashboard-analytics (KPIs, volume, response times, AI metrics, heatmap, anomalies, cohorts), agent-analytics, alerts, scheduled-reports, csat-trigger, compliance, audit, metrics-aggregation, bi-api |
| **Other** | carla (legacy, being replaced), intake (landing pages) |

## Module dependency flow

```
WhatsappModule → ConversationsModule → [PersonaModule, AIModule, ChannelsModule, HandoffModule, IdentityModule]
                                                                      ↓ (EventEmitter)
                                                              AgentConsoleModule
ChannelsModule provides: ChannelGatewayService, ChannelTokenService, OutboundQueueService, adapters (WA/IG/Messenger/Telegram/SMS)
ThrottleModule: @Global — TenantThrottleService available everywhere
AnalyticsModule provides: AnalyticsService, DashboardAnalyticsService, AlertsService, ScheduledReportsService, BIApiController
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
| DB tenant schema | `apps/api/prisma/tenant-schema.sql` |
| Shared types | `packages/shared/src/index.ts` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` (110+ methods) |
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

## Dashboard pages (50+)

| Section | Pages |
|---------|-------|
| **Auth** | Login (Remember Me, session expired banner), Forgot Password (OTP), Setup Password (Google OAuth), Verify Email (6-digit OTP) |
| **Onboarding** | 4-step company wizard |
| **Core** | Dashboard, Inbox (WhatsApp-style chat + notifications) |
| **CRM** | Contacts, Lead Detail, Pipeline (Kanban), Segments |
| **AI** | Agent List (multi-agent management, templates), Agent Editor (/agent/[agentId] — hub card grid + channel assignment + custom prompt mode), AI Settings |
| **Automation** | Rules (4-step wizard), Settings |
| **Analytics** | Analytics V2 (8 tabs: Overview/AI & Bot/Automation/Campaigns/Channels/CSAT/Anomalies/Cohorts), Agent Performance (legacy 4 tabs) |
| **Channels** | Overview, WhatsApp Setup, Instagram Setup, Messenger Setup, Telegram Setup, SMS/Twilio Setup |
| **Identity** | Merge Suggestions (approve/reject) |
| **Settings** | General, Custom Attributes, Macros, Pre-Chat Forms, Media (image bank + logo + tags), Email Templates (editor + preview), Change Password, **Alerts & Reports** (threshold alerts + scheduled email reports) |
| **Scheduling** | Appointments (week/day calendar, agenda, services + staff, config, analytics), Public Booking (/book/:tenantSlug) |
| **Operations** | Broadcast, Inventory, Orders, Compliance, Knowledge Base |
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
| `0 2 * * *` | MetricsAggregationService | Nightly aggregation into daily_metrics |
| `*/15 * * * *` | AlertsService | Evaluate threshold alert rules |
| `0 8 * * 1` | ScheduledReportsService | Send weekly email reports (Monday 8AM) |
| `0 8 1 * *` | ScheduledReportsService | Send monthly email reports (1st, 8AM) |
| `*/5 * * * *` | AgentAvailabilityService | Auto-offline inactive agents (15min) |
| `0 */6 * * *` | NurturingService | Auto-resolve stale conversations (72h) |
| `0 */2 * * *` | NurturingService | Check stale conversations for follow-up |
| `*/15 * * * *` | AppointmentRemindersService | Send 24h appointment reminders |
| `3,18,33,48 * * * *` | AppointmentRemindersService | Send 1h appointment reminders |
| `5,35 * * * *` | AppointmentRemindersService | Auto-mark no-shows + send follow-up |

### Redis Keys (Analytics)
```
analytics:{tenantId}:{YYYY-MM-DD}:conversation_started  — Daily counter (7d TTL)
analytics:{tenantId}:{YYYY-MM-DD}:total                  — All messages/events
analytics:{tenantId}:{YYYY-MM-DD}:handoff_triggered       — Escalation counter
analytics:{tenantId}:{YYYY-MM-DD}:cost                    — LLM cost (float)
analytics:{tenantId}:{YYYY-MM-DD}:model:{modelName}       — Per-model usage
analytics:{tenantId}:{YYYY-MM-DD}:hourly:{0-23}           — Volume per hour
refresh:{userId}:{tokenId}                                — Refresh tokens (8h or 14d TTL)
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
```

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

## Production

- Landing: https://parallly-chat.cloud (static, nginx container, 4-language i18n)
- Dashboard: https://admin.parallly-chat.cloud (Next.js, Tailwind + shadcn/ui + recharts)
- API: https://api.parallly-chat.cloud (NestJS, 37 modules, multi-agent)
- WhatsApp: https://wa.parallly-chat.cloud (NestJS, Embedded Signup)
- KB Portal: https://admin.parallly-chat.cloud/kb/{tenant-slug}
- BI API: https://api.parallly-chat.cloud/api/v1/bi-api/ (X-API-Key auth)
- GitHub: https://github.com/Nipko/sales-structure
- VPS: Hostinger Ubuntu, Docker (10 containers incl. PgBouncer), Cloudflare Tunnel
- PgBouncer: Transaction pooling mode, 500→25 connections (parallext-pgbouncer container)
- Sentry: Error tracking + profiling (@sentry/nestjs, instrument.ts loaded first)
- Deploy: Push to main → GitHub Actions → build 5 images → SSH deploy → **regenerate .env from secrets** → migrate (via DIRECT_DATABASE_URL) → restart
- **CRITICAL**: `.env` is regenerated on every deploy from GitHub Actions Secrets. New env vars MUST be added to both GitHub Secrets AND `.github/workflows/deploy.yml`, or they will be lost on next deploy
