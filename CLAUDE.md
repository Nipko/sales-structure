# Parallext Engine — Claude Code Context

## What is this project?
Multi-tenant conversational AI SaaS platform (Parallly) for automating sales across WhatsApp, Instagram, and Messenger.
Monorepo with 3 NestJS/Next.js apps, deployed on Hostinger VPS via Docker + Cloudflare Tunnel.

## Architecture

```
Customer (WhatsApp/IG/Messenger) → Meta Cloud API → WhatsApp Service (port 3002) OR API webhooks
    → API (port 3000) → ConversationsService (orchestrator)
        → IdentityService (resolve/create unified profile)
        → PersonaService (load agent config) → LLMRouter (select model by tier) → LLM Provider → response
        → OutboundQueueService (BullMQ, priority by plan) → ChannelGatewayService → Meta API → Customer

    If handoff triggered:
        → HandoffService → EventEmitter('handoff.escalated') → AgentConsoleGateway (WebSocket /inbox)
        → Human agent responds via Dashboard (port 3001) → AgentConsoleService → Meta API

    Rate limiting:
        → TenantThrottleService (per-plan: starter/pro/enterprise) checks Redis before every job
```

## Monorepo structure

```
apps/
  api/          — NestJS 10, port 3000. Core business logic, 31 modules
  dashboard/    — Next.js 16, port 3001. Admin panel (35+ pages), React 19, Tailwind + shadcn/ui
  whatsapp/     — NestJS 10, port 3002. Embedded Signup v4 + Meta webhook router
  landing/      — Next.js static export, port 80. Marketing landing page (parallly-chat.cloud)
packages/
  shared/       — TypeScript types (NormalizedMessage, OutboundMessage, TenantConfig, etc.)
infra/
  docker/       — docker-compose.yml (dev), docker-compose.prod.yml (prod), 5 Dockerfiles
  nginx/        — Reverse proxy config (WebSocket upgrade enabled)
  scripts/      — setup-vps.sh, setup-fresh.sh, reset-db.sh
docs/           — Architecture specs, visual guide, logo, API reference, changelog
```

## Key conventions

- **Language**: Code in English, user-facing strings in Spanish (Latin American market)
- **Multi-tenancy**: Schema-per-tenant in PostgreSQL. Schema name from `tenants.schema_name`
- **Database queries**: `prisma.executeInTenantSchema(schemaName, sql, params)` — ALWAYS use `::uuid` casts
- **Global tables**: Prisma client directly (`prisma.tenant.findUnique(...)`)
- **Raw SQL column names**: Use snake_case (`is_active`, not `"isActive"`) — Prisma `@map` only applies to Prisma client
- **Auth**: JWT with 4 roles: super_admin, tenant_admin, tenant_supervisor, tenant_agent
- **Guards**: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` on protected endpoints
- **CRM is built-in**: No external CRM. Handoff → internal agent console via WebSocket
- **Event-driven**: HandoffService emits events, AgentConsoleGateway listens via @OnEvent
- **Outbound messages**: Always through OutboundQueueService (BullMQ, 3 retries, priority by tenant plan)
- **Rate limiting**: TenantThrottleService (starter: 50 auto/h + 200 outbound/h, pro: 500+2000, enterprise: 5000+20000)
- **Webhook idempotency**: Redis keys `idem:wa:{id}`, `idem:ig:{id}`, `idem:fb:{id}` with 24h TTL
- **LLM Router**: Skips unconfigured providers. Auto-upgrades tier if no key available
- **Redis**: noeviction policy (never allkeys-lru). BullMQ jobs must not be silently evicted
- **BigInt**: `BigInt.toJSON` polyfill in main.ts and worker.main.ts for PostgreSQL COUNT(*)

## API modules (31 total)

| Category | Modules |
|----------|---------|
| **Infrastructure** | prisma, redis, health, throttle, internal |
| **Auth & Tenants** | auth, tenants, settings |
| **Message Pipeline** | channels, conversations, whatsapp, handoff, agent-console |
| **AI & Config** | ai (router + 5 providers), persona, knowledge, copilot |
| **CRM & Sales** | crm (leads, contacts, opportunities, custom-attrs, segments, import/export, notes, tasks, activity, scoring), pipeline, catalog |
| **Automation** | automation (rules engine, listener, jobs processor, nurturing, action executor) |
| **Operations** | broadcast, inventory, orders, compliance, email |
| **Identity** | identity (unified profiles, merge suggestions) |
| **Other** | carla (legacy, being replaced), intake (landing pages) |

## Module dependency flow

```
WhatsappModule → ConversationsModule → [PersonaModule, AIModule, ChannelsModule, HandoffModule, IdentityModule]
                                                                      ↓ (EventEmitter)
                                                              AgentConsoleModule
ChannelsModule provides: ChannelGatewayService, ChannelTokenService, OutboundQueueService, adapters (WA/IG/Messenger/Telegram)
ThrottleModule: @Global — TenantThrottleService available everywhere
```

## Key files for common tasks

| Task | Files |
|------|-------|
| Message flow | `conversations/conversations.service.ts` (orchestrator) |
| Add LLM provider | `ai/providers/*.provider.ts`, `ai/router/llm-router.service.ts` |
| Agent persona config | `persona/persona.service.ts`, `persona/persona.controller.ts` |
| Channel adapters | `channels/{channel}/*.adapter.ts`, `channels/channel-gateway.service.ts` |
| Channel management | `channels/channel-management.controller.ts` (connect IG/Messenger) |
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
| DB tenant schema | `apps/api/prisma/tenant-schema.sql` |
| Shared types | `packages/shared/src/index.ts` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` (89+ methods) |
| Dashboard auth | `apps/dashboard/src/contexts/AuthContext.tsx` |

## Dashboard pages (35+)

| Section | Pages |
|---------|-------|
| **Core** | Dashboard, Inbox (WhatsApp-style chat + notifications) |
| **CRM** | Contacts, Lead Detail, Pipeline (Kanban), Segments |
| **AI** | Agent Config (6-step wizard + custom prompt mode), AI Settings |
| **Automation** | Rules (4-step wizard), Settings |
| **Analytics** | Overview (4 tabs: Overview/Agents/Channels/CSAT), Agent Performance |
| **Channels** | Overview, WhatsApp Setup, Instagram Setup, Messenger Setup |
| **Identity** | Merge Suggestions (approve/reject) |
| **Settings** | General, Custom Attributes, Macros, Pre-Chat Forms |
| **Operations** | Broadcast, Inventory, Orders, Compliance, Knowledge Base |
| **Public** | `/kb/[tenantSlug]` (public help center, light theme, no auth) |

## BullMQ Queues (5 total)

| Queue | Concurrency | Rate Limit | Purpose |
|-------|------------|-----------|---------|
| outbound-messages | 5 | 20/s | Cross-channel message delivery |
| broadcast-messages | 10 | 80/s | Mass template campaigns |
| automation-jobs | 10 | 30/s | Automation rule actions |
| nurturing | 5 | 10/s | Follow-up sequences |
| conversation-snooze | 1 | — | Delayed wake-up for snoozed conversations |

## Verification before pushing

```bash
cd apps/api && npx tsc --noEmit        # Type errors
cd apps/api && npm run test:bootstrap  # NestJS DI errors (CRITICAL — tsc doesn't catch these)
cd apps/dashboard && npx tsc --noEmit  # Dashboard type errors
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
- `ENCRYPTION_KEY` — 64-char hex for AES-256-GCM (WhatsApp/IG/Messenger tokens)
- `INTERNAL_API_KEY` — Service-to-service auth (WhatsApp → API)
- `META_APP_ID/SECRET/CONFIG_ID/VERIFY_TOKEN` — Facebook app credentials
- `SYSTEM_USER_ID` — Meta Business System User (for permanent tokens)
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY` — At least one required

## Production

- Landing: https://parallly-chat.cloud (static, nginx container)
- Dashboard: https://admin.parallly-chat.cloud (Next.js, Tailwind + shadcn/ui)
- API: https://api.parallly-chat.cloud (NestJS, 31 modules)
- WhatsApp: https://wa.parallly-chat.cloud (NestJS, Embedded Signup)
- KB Portal: https://admin.parallly-chat.cloud/kb/{tenant-slug}
- GitHub: https://github.com/Nipko/sales-structure
- VPS: Hostinger Ubuntu, Docker (8 containers), Cloudflare Tunnel
- Deploy: Push to main → GitHub Actions → build 5 images → SSH deploy → migrate → restart
