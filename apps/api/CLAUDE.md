# API Service — Claude Code Context

## Overview
NestJS 10 backend with 67 modules. Port 3000. Global prefix: `/api/v1`.

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
- `whatsapp/` — Webhook handling, connection management, templates (sync + in-app creation via Meta API), messaging

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
- `analytics/` — Redis counters + DB persistence. CSAT surveys + trigger. Agent performance reports. Custom report builder (saved_reports CRUD). Scheduled reports (weekly/monthly email)

**Billing & Finance**:
- `billing/` — MercadoPago integration. Subscription lifecycle (create/cancel/pause/resume/change). Webhook verification (HMAC-SHA256) + idempotency. Plan quotas enforcement. 5 billing email templates. Card tokenization for self-serve checkout
- `billing/adapters/mercadopago.adapter.ts` — IPaymentProvider implementation for MercadoPago Preapproval API
- `billing/webhook.controller.ts` — POST /billing/webhooks/mercadopago (verify + dispatch)
- `billing/processors/reconciliation.processor.ts` — Hourly past_due sweep + daily drift detection
- `financials/` — SaaS metrics (MRR, ARR, ARPU, churn, LTV, quick ratio). 11 endpoints under /financials/. Super_admin only
- `financials/financial-snapshot.service.ts` — Monthly cron (1st @1AM) snapshots MRR movements, per-tenant P&L, LLM costs from tenant schemas
- `offboarding/` — Tenant lifecycle management. 7-step offboarding pipeline (channels, sessions, queues, deactivate, cache, audit, event)
- `offboarding/offboarding-cron.service.ts` — Trial expiry detector (*/30min), grace enforcer (3AM), archive cleaner (4AM), stale channel purge (5AM). All event emitters dedup via billing_events UNIQUE(provider, providerEventId)

**Operations**:
- `broadcast/` — Multi-channel campaigns (WA/Email/SMS), BullMQ (80msg/s rate limit), smart recipient resolution, per-channel stats
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

## New modules (May 2026)

### Customer Portal Module
- `customer-portal/customer-portal.service.ts` — Magic-link auth: 6-digit code (Redis, 10min TTL, 5-attempt brute-force), JWT with type:'customer'
- `customer-portal/customer-portal.controller.ts` — Public: request-access, verify. Authenticated via X-Portal-Token: profile, conversations, appointments, orders

### White Label Module
- `white-label/white-label.service.ts` — Per-tenant branding config (brandName, logoUrl, colors, customDomain, customCss, hidePoweredBy). Plan-gated to Custom plan. Public lookup by slug/domain with Redis cache
- `white-label/white-label.controller.ts` — GET/PUT config (tenant_admin), GET public/slug/:slug, GET public/domain

### E-commerce Module
- `ecommerce/ecommerce.service.ts` — Shopify Admin API + WooCommerce REST API product sync. Lazy tables: ecommerce_products, abandoned_carts. Cart abandonment tracking. AI product search
- `ecommerce/ecommerce.controller.ts` — GET/PUT config, POST sync, GET products, GET products/search

### Channel Manager Module
- `channel-manager/channel-manager.service.ts` — Hostaway OAuth integration. Lazy tables: cm_listings, cm_reservations, cm_availability. Reservation conflict detection. Availability calendar with date series
- `channel-manager/channel-manager.controller.ts` — GET/PUT config, CRUD listings, CRUD reservations, GET availability, POST sync/hostaway

### SAML/SSO (in auth module)
- `auth/saml.service.ts` — Config CRUD in tenant.settings.saml, domain-based tenant lookup (Redis cache), JIT user provisioning, isSsoForced()
- `auth/saml.strategy.ts` — MultiSamlStrategy with per-tenant IdP config via getSamlOptions callback
- `auth/saml.controller.ts` — Public: check, login, acs, metadata/:tenantId. Authenticated: GET/PUT config

### Stripe Billing Adapter (in billing module)
- `billing/adapters/stripe.adapter.ts` — IPaymentProvider for Stripe: createCustomer, createSubscription, cancelSubscription, createCheckoutSession, constructWebhookEvent
- `billing/payment-provider.factory.ts` — Routes between Stripe and MercadoPago based on tenant config

### Staff Scheduling (in verticals module)
- `verticals/staff-scheduling.service.ts` — Lazy tables: staff_members, staff_schedules, staff_service_links, staff_breaks. Availability check with service/schedule/break/appointment conflict resolution
- `verticals/staff-scheduling.controller.ts` — CRUD under /staff/:tenantId, schedule, services, breaks, availability

### Vehicle Inventory (in verticals module)
- `verticals/vehicle-inventory.service.ts` — Lazy tables: vehicles, vehicle_inquiries, test_drives. Full CRUD, markSold(), scheduleTestDrive() with conflict detection, AI search, stats
- `verticals/vehicle-inventory.controller.ts` — CRUD under /vehicles/:tenantId, sold, test-drives, search, stats

### Web Chat Widget
- `widget/widget.service.ts` — Config CRUD, conversation management for embeddable chat
- `widget/widget.gateway.ts` — WebSocket gateway for real-time widget chat
- `widget/widget-public.controller.ts` — Public endpoints for widget embed, CORS configured
- `widget/widget.module.ts` — Imports for WebSocket + HTTP

### Multimedia Processing Module (May 2026)
- `media-processing/media-processing.service.ts` — Orchestrator: checkQuota → download → process (audio/image) → recordUsage → trackStats. Returns text context or null (throttled/failed). Output: `[El cliente envió un mensaje de voz: "..."]` / `[El cliente envió una imagen: ...]`
- `media-processing/media-download.service.ts` — Channel-specific download: WhatsApp (Media ID → Meta Graph API), IG/Messenger (direct CDN URL), Telegram (file_id → Bot API getFile). MAX_DOWNLOAD_SIZE=25MB, DOWNLOAD_TIMEOUT_MS=30s
- `media-processing/audio-transcription.service.ts` — OpenAI Whisper-1 via `openai` SDK, uses `toFile()` for buffer conversion. OGG natively supported (no ffmpeg). Cost: $0.006/min
- `media-processing/image-vision.service.ts` — Provider selection by plan tier: Emprendedor/Starter → Gemini Flash (cheapest), Pro/Enterprise → xAI then OpenAI fallback. Uses `detail: 'low'` for cost optimization
- `media-processing/media-throttle.service.ts` — 6-layer abuse prevention: (1) monthly quotas per media type, (2) per-contact/day, (3) per-conversation/5min burst, (4) per-tenant/hour, (5) daily budget circuit breaker in cents, (6) max audio duration in seconds. Limits read from plan features via TenantThrottleService. `-1` = Infinity at runtime
- `media-processing/media-processing.controller.ts` — GET `:tenantId/usage` super admin/tenant stats
- `media-processing/media-processing.module.ts` — Exports: MediaProcessingService, MediaThrottleService

**Pipeline integration:** Media processing runs BEFORE the LLM call in `conversations.service.ts → generateResponse()`. Transcribed/described text persisted back to messages table for history continuity.

**Plan limits (in seed-billing-plans.js features.mediaProcessing):**

| Limit | Emprendedor | Starter | Pro | Enterprise | Custom |
|-------|-------------|---------|-----|------------|--------|
| Audio/month | 30 | 150 | 500 | 2,000 | ∞ |
| Images/month | 50 | 250 | 1,000 | 5,000 | ∞ |
| Max audio sec | 120 | 180 | 300 | 300 | 600 |
| Per contact/day | 10 | 20 | 30 | 50 | 100 |
| Per conv/5min | 3 | 3 | 5 | 5 | 10 |
| Per tenant/hour | 20 | 50 | 200 | 500 | 1,000 |
| Daily budget ¢ | 10 | 25 | 100 | 500 | 5,000 |

**Dashboard integration:** Billing page shows media usage counters (audio/image bars with 80%/95% threshold warnings + upgrade CTA). Super admin tenant detail shows TenantMediaStats component.

## Trusted Devices (in auth module, May 2026)
- `trusted_devices` table: skip 2FA for 30 days on remembered browsers
- Token stored as SHA-256 hash, matched via `token_hash` column
- Endpoints: managed via `POST /auth/2fa/verify` (trust_device flag), `GET /auth/trusted-devices`, `DELETE /auth/trusted-devices/:id`
- Redis key: `trusted_device:{userId}:{tokenHash}` (30d TTL, fast lookup before DB)
- Email notification sent when new device is trusted
- Device management UI in dashboard Settings → Security

## Redis Keys (API-specific)
```
booking:{conversationId}        — Booking engine state (1h TTL)
lock:conv:{conversationId}      — Conversation processing mutex via SETNX (30s TTL)
offboard:past_due:{tenantId}    — Past-due grace period timer (30d TTL, offboard after 7d)
billing:soft_lock_notified:{tenantId} — Dedup flag for day-3 soft lock notification (7d TTL)
tenant_plan:{tenantId}          — Cached plan info (invalidated on subscription change)
sub_status:{tenantId}           — Cached subscription status (invalidated on change)
handoff:{tenantId}:{conversationId} — Handoff state (reason, startedAt, assignedTo) 24h TTL
trusted_device:{userId}:{tokenHash} — Trusted device fast lookup (30d TTL)
media:audio:{tenantId}:{YYYY-MM}   — Monthly audio transcription count
media:image:{tenantId}:{YYYY-MM}   — Monthly image vision count
media:contact:{tenantId}:{contactId}:{YYYY-MM-DD} — Per-contact daily media count
media:conv:{conversationId}:{5min-bucket} — Per-conversation burst count
media:tenant:{tenantId}:{hour-bucket} — Per-tenant hourly media count
media:cost:{tenantId}:{YYYY-MM-DD}  — Daily media cost accumulator (cents)
```
