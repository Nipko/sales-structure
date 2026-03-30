# API Service — Claude Code Context

## Overview
NestJS 10 backend with 32+ modules. Port 3000. Global prefix: `/api/v1`.

## Module categories

**Infrastructure** (always available, global):
- `prisma/` — DB access. `executeInTenantSchema(schema, sql, params)` for tenant queries
- `redis/` — Cache, counters, rate limiting. Methods: get/set/del/getJson/setJson/tenantKey
- `health/` — GET /health

**Auth & Tenants**:
- `auth/` — JWT login/register/refresh. Bcrypt 12 rounds. `signupWithTenant()` creates tenant+user atomically
- `tenants/` — CRUD tenants. Each gets a PostgreSQL schema `tenant_{slug}`

**Message pipeline** (the core flow):
- `channels/` — Adapter pattern. WhatsApp/Instagram/Messenger/Telegram. `ChannelGatewayService` routes
- `channels/channel-token.service.ts` — Resolves access tokens per tenant (cached 5min in Redis)
- `channels/outbound-queue.service.ts` — BullMQ queue for outbound messages (3 retries)
- `conversations/` — Main orchestrator. `processIncomingMessage()` is the entry point
- `whatsapp/` — Webhook handling, connection management, templates, messaging

**AI**:
- `ai/router/` — LLM Router. 4 tiers, 5 providers. Composite scoring for model selection
- `ai/providers/` — OpenAI, Anthropic, Gemini, DeepSeek implementations
- `persona/` — YAML-based config with versioning. `buildSystemPrompt()` generates system prompt
- `knowledge/` — RAG with pgvector (partial implementation)

**Human handoff**:
- `handoff/` — Trigger detection + escalation. Emits `handoff.escalated` event
- `agent-console/` — WebSocket gateway (/agent namespace) + REST endpoints. Listens for handoff events

**CRM & Sales**:
- `crm/` — Contacts, leads, opportunities, notes, tasks, activities
- `pipeline/` — Kanban stages, deals, forecast
- `automation/` — Event-driven rules (auto-assign, auto-tag, SLA)
- `analytics/` — Redis counters + DB persistence. CSAT surveys

**Operations**:
- `broadcast/` — Mass template sending via BullMQ (rate limited 80msg/s)
- `catalog/` — Products/services
- `inventory/` — Stock management
- `orders/` — Order tracking
- `compliance/` — Opt-out detection, audit logging
- `email/` — Email service (partial)

## Tenant schema helper
```typescript
const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
const result = await this.prisma.executeInTenantSchema<any[]>(schemaName, sql, params);
```

## Adding a new module
1. Create folder in `src/modules/{name}/`
2. Create `{name}.module.ts`, `{name}.service.ts`, `{name}.controller.ts`
3. Add to `app.module.ts` imports
4. If it needs tenant data, use `executeInTenantSchema`
5. If it exposes REST, add `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)`
6. If it needs DB schema changes, add migration in `prisma/migrations/`
