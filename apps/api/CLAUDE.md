# API Service — Claude Code Context

## Overview
NestJS 10 backend with 40 modules. Port 3000. Global prefix: `/api/v1`.

## Module categories

**Infrastructure** (always available, global):
- `prisma/` — DB access. `executeInTenantSchema(schema, sql, params)` for tenant queries. ALWAYS use `::uuid` casts
- `redis/` — Cache, counters, rate limiting. Methods: get/set/del/getJson/setJson/tenantKey/isRateLimited
- `health/` — GET /health
- `throttle/` — @Global. TenantThrottleService: plan-based rate limiting (starter/pro/enterprise)
- `internal/` — Service-to-service endpoint (POST /internal/inbound-message)

**Auth & Tenants**:
- `auth/` — JWT login/register/refresh. Bcrypt 12 rounds. `signupWithTenant()` creates tenant+user atomically. `impersonate(tenantId)` generates 1h tokens with audit trail (super_admin only)
- `tenants/` — CRUD tenants. Each gets a PostgreSQL schema `tenant_{slug}`
- `settings/` — Platform settings CRUD from `platform_settings` table

**Message pipeline** (the core flow):
- `channels/` — Adapter pattern. WhatsApp/Instagram/Messenger/Telegram/SMS. `ChannelGatewayService` routes
- `channels/channel-token.service.ts` — Resolves access tokens per tenant (cached 5min in Redis)
- `channels/outbound-queue.service.ts` — BullMQ queue (3 retries, priority by tenant plan)
- `channels/channel-management.controller.ts` — Generic channel connect/status/config endpoints + Instagram OAuth + Messenger FB SDK token exchange
- `channels/meta-signature.util.ts` — Shared HMAC-SHA256 webhook validator
- `channels/instagram-token-refresh.service.ts` — Daily @6AM cron refreshes IG tokens expiring within 30 days (60-day lifetime)
- `conversations/` — Main orchestrator. `processIncomingMessage()` is the entry point. Updates `conversation.updated_at` on every message
- `conversations/` — Redis-backed booking state (primary Redis `booking:{conversationId}`, backup PG). Conversation mutex via Redis SETNX lock (`lock:conv:{conversationId}`, 30s TTL)
- `conversations/` — History limited to 4 messages when in directive (booking) mode
- `conversations/` — Intent interpreter: no early return on confirmation, supports numbered selection, stem matching
- `conversations/pre-chat.service.ts` — Pre-chat form data collection before AI responds
- `whatsapp/` — Webhook handling, connection management, templates, messaging

**AI**:
- `ai/router/` — LLM Router. 4 tiers, 5 providers. Skips unconfigured providers. Auto-upgrades tier
- `ai/tool-executor.service.ts` — Executes tool calls from LLM. Emits `appointment.created` event on booking. Triggers calendar sync. Adds conversation context to calendar event description. Event summary format: "Service — Customer Name"
- `ai/providers/` — OpenAI, Anthropic, Gemini, DeepSeek, xAI implementations
- `persona/` — YAML/JSON config with versioning. REST API for dashboard. Default fallback for new tenants
- `knowledge/` — RAG with pgvector + public KB portal endpoints
- `copilot/` — AI assistant for agents

**Human handoff**:
- `handoff/` — Trigger detection + escalation. Emits `handoff.escalated` event. Email notification to assigned agent. Skill-based routing (`tryAutoAssign` with skill_tags and max_capacity). SLA deadline on conversation_assignments (5 min default)
- `agent-console/` — WebSocket gateway (/inbox namespace). Agent availability, macros, snooze, canned responses. `inbox:handoff` + `inbox:handoff_direct` + `inbox:escalation` events
- `agent-console/agent-availability.service.ts` — SLA escalation cron (`*/2 * * * *`): escalates conversations waiting >5 min without response → emits `handoff.escalated_supervisor` → WebSocket `inbox:escalation`

**CRM & Sales**:
- `crm/` — Contacts, leads, opportunities, notes, tasks, activities, custom attributes, segments, import/export CSV. Enhanced: bulk-update, pipeline-stages CRUD, scoring-config, CRM analytics (overview/funnel/velocity/win-loss/leaderboard/sources), AI insights, deal approval workflow (request/approve/reject)
- `crm/services/crm-analytics/` — Dedicated analytics service: overview KPIs, conversion funnel, pipeline velocity, win/loss rate, agent leaderboard, source breakdown
- `crm/services/crm-insights/` — AI-powered lead insights (per-lead analysis)
- `pipeline/` — Kanban stages, deals, auto-progress from conversation signals. Configurable stages via `pipeline_stages` table
- `identity/` — Unified customer profiles, cross-channel contact linking, merge suggestions, **manual merge** (POST `/identity/:tenantId/manual-merge`)
- `automation/` — Event-driven rules (trigger→conditions→actions), nurturing sequences, BullMQ processors
- `analytics/` — Redis counters + DB persistence. CSAT surveys + trigger. Agent performance reports

**Billing & Finance**:
- `billing/` — MercadoPago integration. Subscription lifecycle (create/cancel/pause/resume/change). Webhook verification (HMAC-SHA256) + idempotency. Plan quotas enforcement. 5 billing email templates. Card tokenization for self-serve checkout
- `billing/adapters/mercadopago.adapter.ts` — IPaymentProvider implementation for MercadoPago Preapproval API
- `billing/webhook.controller.ts` — POST /billing/webhooks/mercadopago (verify + dispatch)
- `billing/processors/reconciliation.processor.ts` — Hourly past_due sweep + daily drift detection
- `financials/` — SaaS metrics (MRR, ARR, ARPU, churn, LTV, quick ratio). 11 endpoints under /financials/. Super_admin only
- `financials/financial-snapshot.service.ts` — Monthly cron (1st @1AM) snapshots MRR movements, per-tenant P&L, LLM costs from tenant schemas
- `offboarding/` — Tenant lifecycle management. 7-step offboarding pipeline (channels, sessions, queues, deactivate, cache, audit, event)
- `offboarding/offboarding-cron.service.ts` — Grace enforcer (3AM: past_due >7d → offboard) + archive cleaner (4AM: drop schemas inactive >90d)

**Operations**:
- `broadcast/` — Mass template sending via BullMQ (80msg/s rate limit)
- `catalog/` — Products/courses/campaigns
- `inventory/` — Stock management
- `orders/` — Order tracking
- `compliance/` — Opt-out detection, consent records, audit logging
- `email/` — Email service via nodemailer
- `intake/` — Landing page forms
- `offers/` — Promotional offers management
- `business-info/` — Tenant business identity (company details for prompt Layer 3)

**Media & Templates**:
- `media/` — Image upload (multer+sharp→webp), resize, serve, tags, company logo
- `email-templates/` — CRUD email templates, {{variable}} rendering, test send, auto-seed defaults
- `appointments/` — CRUD appointments, availability slots, blocked dates, conflict detection

## Raw SQL conventions
```typescript
// ALWAYS use ::uuid casts for UUID columns
await this.prisma.executeInTenantSchema(schemaName,
    `SELECT * FROM leads WHERE id = $1::uuid AND contact_id = $2::uuid`,
    [leadId, contactId],
);

// Use snake_case column names (NOT camelCase)
// is_active (correct) vs "isActive" (WRONG — will fail)

// BigInt from COUNT(*) is handled by polyfill in main.ts
```

## Adding a new module
1. Create folder in `src/modules/{name}/`
2. Create `{name}.module.ts`, `{name}.service.ts`, `{name}.controller.ts`
3. Add to `app.module.ts` imports
4. If it needs tenant data, use `executeInTenantSchema` with `::uuid` casts
5. If it exposes REST, add `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)`
6. If it needs to communicate with another module without circular deps, use `EventEmitter2`
7. If it has background jobs, register a BullMQ queue and processor
8. If it has public endpoints (no auth), skip the guards on those specific routes

## New modules (April 2026)

### Media Module
- `media/media.service.ts` — Upload (multer+sharp→webp), resize, serve, tags, company logo
- `media/media.controller.ts` — POST upload, POST logo, GET list, GET serve (public), PUT update meta, DELETE
- Storage: Docker volume /data/media/{tenantId}/{uuid}.webp
- Serve endpoint excluded from auth: GET /media/file/:tenantId/:fileName (with CORP header)

### Email Templates Module  
- `email-templates/email-templates.service.ts` — CRUD, 4 default templates, {{variable}} rendering, test send
- Templates: appointment_confirmation, appointment_reminder, order_confirmation, welcome
- Auto-seeds defaults on first access per tenant

### Appointments Module
- `appointments/appointments.service.ts` — CRUD, availability slots, blocked dates, conflict detection
- `appointments/appointments.controller.ts` — Static routes (availability, blocked-dates, check-slots) BEFORE dynamic :appointmentId routes. Includes `POST :tenantId/calendar/:integrationId/reassign-disconnect` for calendar disconnect with appointment reassignment
- `appointments/appointment-reminders.service.ts` — Attendance confirmation via messaging channel (post-appointment). Auto-complete cron (`@Cron('20 * * * *')`): marks confirmed appointments as completed after 2h. No-show follow-up messaging
- AI-ready: checkAvailableSlots for agent tool calls
- Services have `location_type` (in_person/online/hybrid), `meeting_link`, `location_address` columns

### Booking Engine (conversations/booking-engine.service.ts)
- Deterministic state machine for appointment scheduling via chat (no LLM flow decisions)
- **i18n**: All user-facing messages use `msg()` function with 4-language support (es/en/pt/fr). Language parameter passed from `conversations.service.ts` based on detected language
- **State machine steps**: select_service → select_date → select_time → confirm → booked (early return when step=booked)
- **Double booking protection**: Re-checks slot availability at confirm step before committing
- **Redis-backed state**: Primary storage in `booking:{conversationId}` (1h TTL), backup in PG `booking_state` column
- **History**: Conversation history limited to 4 messages when in directive (booking) mode

### Calendar Integration (appointments/calendar-integration.service.ts)
- **Multi-calendar**: Tenants can connect multiple Google Calendar accounts with assignment model
- **Plan-gated limits**: `maxCalendars` in PLAN_FEATURES (starter=1, pro=3, enterprise=10, custom=unlimited)
- **3-tier resolution**: When syncing, resolves calendar by: service-specific → staff-specific → general tenant calendar
- **Auto meeting links**: Generates Google Meet or Teams links for online/hybrid services
- **Disconnect protection**: Graceful handling when calendar is disconnected mid-use
- **Live WebSocket updates**: Emits calendar sync events to dashboard via WebSocket

### Multi-Agent System (April 2026)

**Tables (per-tenant schema):**
- `agent_personas` — Multiple AI agents per tenant with channel assignment, schedule, versioning
- `agent_templates` — Reusable persona configs (6 built-in + user-saved)

**Key service methods (persona.service.ts):**
- `getPersonaForChannel(tenantId, channelType)` — Channel-aware agent resolution (3-tier fallback: channel match → default → legacy)
- `listAgents(tenantId)` — Returns all agents with auto-migration from legacy persona_config
- `createAgent()`, `updateAgent()`, `deleteAgent()`, `duplicateAgent()` — Full CRUD
- `saveAsTemplate()`, `listTemplates()` — Template management
- `ensureMultiAgentTables()` — Lazy table creation for existing tenants
- `createDefaultAgentFromGoals()` — Maps onboarding goals to best template

**Pipeline change:**
- `conversations.service.ts` line ~90: `getActivePersona(tenantId)` → `getPersonaForChannel(tenantId, channelType)`

**Subscription plans (tenant-throttle.service.ts):**
- starter: 1 agent, no custom templates
- pro: 3 agents, custom templates + prompt
- enterprise: 10 agents, all features
- custom: unlimited, all features

**6 built-in templates:** Sales Advisor, Support Agent, FAQ Bot, Appointment Scheduler, Lead Qualifier, Blank

### SMS/Twilio Channel (April 2026)
- `channels/sms/sms.adapter.ts` — Twilio SMS adapter implementing IChannelAdapter
- Webhook handling, text message sending
- Channel management endpoints for connect/disconnect

## Infrastructure (April 2026)
- PgBouncer: transaction mode pooler between services and PostgreSQL
- Sentry: @sentry/nestjs with instrument.ts loaded before all modules
- Email layouts: email/email-layouts.ts (professional templates for auth flows)
- Google Calendar integration: `appointments/calendar-integration.service.ts` (multi-calendar, 3-tier resolution, auto meeting links)

## New Prisma Models (Apr 2026 — global schema)

- `BillingPlan` — 4 plans (slug, name, priceUsdCents, trialDays, features JSONB)
- `BillingSubscription` — Per-tenant (status: trialing/active/past_due/cancelled/expired, MercadoPago external IDs, trial dates)
- `BillingPayment` — Payment history (amountCents, status, provider reference, tenantId)
- `FinancialSnapshot` — Monthly platform-wide metrics (MRR, churn, costs, plan distribution). Unique on snapshotMonth
- `TenantFinancialSnapshot` — Per-tenant monthly (revenue, LLM cost, plan, messages). Unique on tenantId+snapshotMonth
- `InfraCost` — Monthly infra costs by category. Unique on month+category
- `ExchangeRate` — Currency rates. Unique on rateDate+fromCurrency+toCurrency
- `AuditLog` — Offboarding and billing audit trail (tenantId, action, resource, details JSONB)

## New Features (Apr 26-28, 2026)

### Phone Normalization
- `src/common/utils/phone.util.ts` — `normalizePhoneE164(raw, defaultCountryCode='57')`
- Supports: CO, AR, MX, BR, CL, PE, EC, US/CA
- Strips formatting, handles leading zeros, validates length
- Used in: lead creation, identity resolution, contact merge

### Prompt Assembler — Safety Guardrails
- `conversations/prompt-assembler.service.ts` — Layer 1 contract now includes universal safety guardrails
- Cannot be overridden by persona config (hardcoded in contract layer)
- Blocks: violence, weapons, illegal activities, self-harm, explicit content, discrimination, drugs, hacking, third-party PII, unqualified legal/financial advice

### CRM Endpoints (new)
| Endpoint | Purpose |
|----------|---------|
| `POST crm/leads/:tenantId/bulk-update` | Bulk update leads (change stage, add tag, archive) |
| `GET/POST crm/scoring-config/:tenantId` | Read/write scoring weights and decay config |
| `GET crm/analytics/:tenantId/overview` | CRM KPIs (total leads, new, conversion rate, pipeline value) |
| `GET crm/analytics/:tenantId/funnel` | Conversion funnel by stage |
| `GET crm/analytics/:tenantId/velocity` | Days per stage (pipeline velocity) |
| `GET crm/analytics/:tenantId/win-loss` | Win/loss rate with breakdown |
| `GET crm/analytics/:tenantId/leaderboard` | Agent performance ranking |
| `GET crm/analytics/:tenantId/sources` | Lead source breakdown |
| `GET crm/leads/:tenantId/:leadId/insight` | AI-generated lead insight |
| `PUT crm/opportunities/:tenantId/:id/request-approval` | Request deal stage approval |
| `PUT crm/opportunities/:tenantId/:id/approve` | Approve deal (moves to target stage) |
| `PUT crm/opportunities/:tenantId/:id/reject` | Reject deal (with reason) |
| `GET/POST/PUT/DELETE crm/pipeline-stages/:tenantId` | Pipeline stages CRUD |
| `PUT crm/pipeline-stages/:tenantId/reorder` | Reorder stages by position |

### Identity Endpoint (new)
| Endpoint | Purpose |
|----------|---------|
| `POST identity/:tenantId/manual-merge` | Manually merge two contacts (body: contactIdA, contactIdB) |

### Appointments Endpoints (new)
| Endpoint | Purpose |
|----------|---------|
| `POST appointments/:tenantId/calendar/:integrationId/reassign-disconnect` | Reassign future appointments to target calendar, then disconnect |

### Cron Jobs (new/updated)
| Cron | Service | Purpose |
|------|---------|---------|
| `20 * * * *` | AppointmentRemindersService | Auto-complete appointments ended 2+ hours ago |
| `*/2 * * * *` | AgentAvailabilityService | Escalate stale handoffs (>5 min no response → supervisor alert) |

## Redis Keys (API-specific)
```
booking:{conversationId}        — Booking engine state (1h TTL)
lock:conv:{conversationId}      — Conversation processing mutex via SETNX (30s TTL)
offboard:past_due:{tenantId}    — Past-due grace period timer (30d TTL, offboard after 7d)
tenant_plan:{tenantId}          — Cached plan info (invalidated on subscription change)
handoff:{tenantId}:{conversationId} — Handoff state (reason, startedAt, assignedTo) 24h TTL
```
