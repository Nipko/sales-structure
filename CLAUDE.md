# Parallext Engine — Claude Code Context

## What is this project?
Multi-tenant conversational AI SaaS platform for automating WhatsApp sales.
Monorepo with 3 NestJS/Next.js apps, deployed on Hostinger VPS via Docker + Cloudflare Tunnel.

## Architecture (critical to understand)

```
WhatsApp User → Meta Cloud API → WhatsApp Service (port 3002, webhook receiver)
    → API (port 3000) → ConversationsService (orchestrator)
        → PersonaService (load config) → LLMRouter (select model) → LLM Provider → response
        → OutboundQueueService (BullMQ) → ChannelGatewayService → Meta API → WhatsApp User

    If handoff triggered:
        → HandoffService → EventEmitter('handoff.escalated') → AgentConsoleGateway (WebSocket)
        → Human agent responds via Dashboard (port 3001) → AgentConsoleService → Meta API
```

## Monorepo structure

```
apps/
  api/          — NestJS 10, port 3000. Core business logic, 32+ modules
  dashboard/    — Next.js 16, port 3001. Admin panel, React 19 + Tailwind 4
  whatsapp/     — NestJS 10, port 3002. Embedded Signup v4 + Meta webhook router
packages/
  shared/       — TypeScript types shared across apps (NormalizedMessage, OutboundMessage, etc.)
infra/
  docker/       — docker-compose.yml (dev), docker-compose.prod.yml (prod), Dockerfiles
  nginx/        — Reverse proxy config
  scripts/      — VPS setup
```

## Key conventions

- **Language**: Code in English, user-facing strings in Spanish (Latin American market)
- **Multi-tenancy**: Schema-per-tenant in PostgreSQL. Schema name: `tenant_{slug_with_underscores}`
- **Database queries**: Use `prisma.executeInTenantSchema(schemaName, sql, params)` for tenant data
- **Global tables**: Use Prisma client directly (`prisma.tenant.findUnique(...)`)
- **Auth**: JWT with 4 roles: super_admin, tenant_admin, tenant_supervisor, tenant_agent
- **Guards**: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` on protected endpoints
- **No Chatwoot**: The CRM is built-in. Handoff goes to internal agent console via WebSocket, NOT Chatwoot
- **Event-driven handoff**: HandoffService emits events, AgentConsoleGateway listens via @OnEvent
- **Outbound messages**: Always go through OutboundQueueService (BullMQ, 3 retries, exponential backoff)
- **Webhook idempotency**: Redis key `idem:wa:{waMessageId}` with 24h TTL
- **Read receipts**: Fire-and-forget `markAsRead()` call to Meta API immediately on webhook receipt
- **LLM numeric params**: Always cast with `Number()` — PostgreSQL numeric columns return strings via Prisma

## Module dependency flow (no circular deps)

```
WhatsappModule → ConversationsModule → [PersonaModule, AIModule, ChannelsModule, HandoffModule]
                                                                      ↓ (EventEmitter)
                                                              AgentConsoleModule
ChannelsModule provides: ChannelGatewayService, ChannelTokenService, OutboundQueueService, WhatsAppAdapter
```

- `ChannelTokenService` resolves access tokens (breaks circular dep between Conversations↔WhatsApp)
- `HandoffService` uses `EventEmitter2` (breaks circular dep between Handoff↔AgentConsole)

## Key files for common tasks

| Task | Files |
|------|-------|
| Message flow | `conversations/conversations.service.ts` (orchestrator) |
| Add LLM provider | `ai/providers/*.provider.ts`, `ai/router/llm-router.service.ts` |
| Persona config | `persona/persona.service.ts`, `templates/personas/*.yaml` |
| Channel adapter | `channels/{channel}/*.adapter.ts`, `channels/channel-gateway.service.ts` |
| Handoff logic | `handoff/handoff.service.ts` |
| Agent console | `agent-console/agent-console.gateway.ts` (WebSocket), `.service.ts` (business logic) |
| WhatsApp webhook | `whatsapp/services/whatsapp-webhook.service.ts` |
| Outbound sending | `channels/outbound-queue.service.ts` → `outbound-queue.processor.ts` |
| Token resolution | `channels/channel-token.service.ts` |
| DB migrations | `apps/api/prisma/migrations/` |
| Tenant schema | `apps/api/prisma/tenant-schema.sql` |
| Shared types | `packages/shared/src/index.ts` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` |
| Dashboard auth | `apps/dashboard/src/contexts/AuthContext.tsx` |

## Build & run

```bash
# Dev (all apps)
npm run dev

# Dev (single app)
npm run dev:api
npm run dev:dashboard
npm run dev:whatsapp

# Type check
cd apps/api && npx tsc --noEmit

# DB migrations
npm run db:migrate
npm run db:seed

# Docker (dev infra only)
cd infra/docker && docker compose up -d

# Docker (prod)
cd infra/docker && docker compose -f docker-compose.prod.yml up -d
```

## Environment variables

See `.env.example` for all variables. Key ones:
- `DATABASE_URL` — PostgreSQL connection string
- `INTERNAL_JWT_SECRET` — Shared JWT secret between API and WhatsApp service
- `ENCRYPTION_KEY` — 64-char hex for AES-256-GCM token encryption
- `META_APP_ID/SECRET` — Facebook app credentials
- `OPENAI_API_KEY` etc. — At least one LLM provider required

## Pilot tenant

Gecko Aventura (Colombian adventure tourism company). Tenant UUID: `00000000-0000-0000-0000-000000000001`. Schema: `tenant_gecko`. Persona: Sofia Henao (friendly tourism agent).

## Production URLs

- Dashboard: https://admin.parallly-chat.cloud
- API: https://api.parallly-chat.cloud
- WhatsApp: https://wa.parallly-chat.cloud
- GitHub: https://github.com/Nipko/sales-structure
