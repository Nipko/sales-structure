# API Service — Claude Code Context

## Overview
NestJS 10 backend with 34 modules. Port 3000. Global prefix: `/api/v1`.

## Module categories

**Infrastructure** (always available, global):
- `prisma/` — DB access. `executeInTenantSchema(schema, sql, params)` for tenant queries. ALWAYS use `::uuid` casts
- `redis/` — Cache, counters, rate limiting. Methods: get/set/del/getJson/setJson/tenantKey/isRateLimited
- `health/` — GET /health
- `throttle/` — @Global. TenantThrottleService: plan-based rate limiting (starter/pro/enterprise)
- `internal/` — Service-to-service endpoint (POST /internal/inbound-message)

**Auth & Tenants**:
- `auth/` — JWT login/register/refresh. Bcrypt 12 rounds. `signupWithTenant()` creates tenant+user atomically
- `tenants/` — CRUD tenants. Each gets a PostgreSQL schema `tenant_{slug}`
- `settings/` — Platform settings CRUD from `platform_settings` table

**Message pipeline** (the core flow):
- `channels/` — Adapter pattern. WhatsApp/Instagram/Messenger/Telegram. `ChannelGatewayService` routes
- `channels/channel-token.service.ts` — Resolves access tokens per tenant (cached 5min in Redis)
- `channels/outbound-queue.service.ts` — BullMQ queue (3 retries, priority by tenant plan)
- `channels/channel-management.controller.ts` — Generic channel connect/status/config endpoints
- `channels/meta-signature.util.ts` — Shared HMAC-SHA256 webhook validator
- `conversations/` — Main orchestrator. `processIncomingMessage()` is the entry point
- `conversations/pre-chat.service.ts` — Pre-chat form data collection before AI responds
- `whatsapp/` — Webhook handling, connection management, templates, messaging

**AI**:
- `ai/router/` — LLM Router. 4 tiers, 5 providers. Skips unconfigured providers. Auto-upgrades tier
- `ai/providers/` — OpenAI, Anthropic, Gemini, DeepSeek, xAI implementations
- `persona/` — YAML/JSON config with versioning. REST API for dashboard. Default fallback for new tenants
- `knowledge/` — RAG with pgvector + public KB portal endpoints
- `copilot/` — AI assistant for agents

**Human handoff**:
- `handoff/` — Trigger detection + escalation. Emits `handoff.escalated` event
- `agent-console/` — WebSocket gateway (/inbox namespace). Agent availability, macros, snooze, canned responses

**CRM & Sales**:
- `crm/` — Contacts, leads, opportunities, notes, tasks, activities, custom attributes, segments, import/export CSV
- `pipeline/` — Kanban stages, deals, auto-progress from conversation signals
- `identity/` — Unified customer profiles, cross-channel contact linking, merge suggestions
- `automation/` — Event-driven rules (trigger→conditions→actions), nurturing sequences, BullMQ processors
- `analytics/` — Redis counters + DB persistence. CSAT surveys + trigger. Agent performance reports

**Operations**:
- `broadcast/` — Mass template sending via BullMQ (80msg/s rate limit)
- `catalog/` — Products/courses/campaigns
- `inventory/` — Stock management
- `orders/` — Order tracking
- `compliance/` — Opt-out detection, consent records, audit logging
- `email/` — Email service via nodemailer
- `intake/` — Landing page forms

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
- `appointments/appointments.controller.ts` — Static routes (availability, blocked-dates, check-slots) BEFORE dynamic :appointmentId routes
- AI-ready: checkAvailableSlots for agent tool calls

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
- Google Calendar integration: `appointments/calendar-integration.service.ts`
