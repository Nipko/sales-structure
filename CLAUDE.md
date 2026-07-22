# Parallext Engine — Claude Code Context

## What is this project?
Multi-tenant conversational AI SaaS platform (Parallly) for automating sales across WhatsApp, Instagram, Messenger, Telegram, and SMS.
Monorepo with 4 NestJS/Next.js apps (78 API modules, 94 dashboard pages), deployed on Hostinger VPS via Docker + Cloudflare Tunnel.

## Architecture (high-level)

```
Customer (WA/IG/Messenger/Telegram/SMS) → Channel API → API (port 3000) → ConversationsService
    → IdentityService → PersonaService.getPersonaForChannel(tenantId, channelType)
    → BusinessInfoService + KnowledgeService (RAG) + BookingEngine
    → PromptAssemblerService (L1 contract + L2 persona + L3 turn) → LLMRouter → Provider
    → OutboundQueueService (BullMQ) → ChannelGatewayService → Customer

  If handoff: HandoffService → EventEmitter → AgentConsoleGateway (WebSocket /inbox)
  Rate limit: TenantThrottleService per-plan checks Redis before every job
```

For full message flow + module dependency graph see **`docs/architecture-detail.md`**.

## Monorepo structure

```
apps/
  api/          — NestJS 10, port 3000. 40 modules
  dashboard/    — Next.js 16, port 3001. React 19, Tailwind + shadcn/ui + recharts
  whatsapp/     — NestJS 10, port 3002. Embedded Signup v4 + Meta webhook router
  landing/      — Next.js static export, port 80. parallly-chat.cloud, 4-language i18n
packages/shared/ — TypeScript types
infra/docker/    — docker-compose.yml (dev), docker-compose.prod.yml, 5 Dockerfiles
infra/nginx/     — Reverse proxy config (WebSocket upgrade enabled)
infra/scripts/   — setup-vps.sh, setup-fresh.sh, reset-db.sh
docs/            — Detailed reference (see Index at bottom)
```

## Key conventions (CRITICAL — apply to every task)

- **Language**: Code in English, user-facing strings in Spanish (Latin American market). ALL strings via i18n (next-intl, 4 languages: es/en/pt/fr). **Every page edit/creation MUST update all 4 JSON files**
- **Multi-tenancy**: Schema-per-tenant in PostgreSQL. Schema name from `tenants.schema_name`
- **Database queries**: `prisma.$queryRawUnsafe(sql, ...params)` — ALWAYS use `::uuid` casts. NO type arguments on `$queryRawUnsafe`
- **Global tables**: Prisma client directly (`prisma.tenant.findUnique(...)`)
- **Raw SQL column names**: snake_case (`is_active`, not `"isActive"`) — Prisma `@map` only applies to Prisma client. `users.name` is a generated column
- **Auth**: JWT with refresh token rotation (Redis-backed). 4 roles: super_admin, tenant_admin, tenant_supervisor, tenant_agent. Session timeout 60min with warning modal
- **Database pooling**: PgBouncer (transaction mode) between apps and PostgreSQL. Use `DIRECT_DATABASE_URL` for Prisma migrations. Multi-statement SQL must be split into individual queries
- **Error tracking**: Sentry (@sentry/nestjs + profiling). `instrument.ts` must load before all modules
- **Guards**: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` on protected endpoints
- **CRM is built-in**: No external CRM. Handoff → internal agent console via WebSocket
- **Event-driven**: HandoffService emits events, AgentConsoleGateway listens via @OnEvent
- **Outbound messages**: Always through OutboundQueueService (BullMQ, 3 retries, priority by tenant plan)
- **Webhook idempotency**: Redis keys `idem:{channel}:{id}` with 24h TTL
- **LLM Router**: Task-based routing (conversation vs tool_calling). 4-tier fallback with circuit breaker. Plan-gated tier access
- **Redis**: noeviction policy (never allkeys-lru). BullMQ jobs must not be silently evicted
- **BigInt**: `BigInt.toJSON` polyfill in main.ts and worker.main.ts for PostgreSQL COUNT(*)
- **Channels**: Adapter pattern via `IChannelAdapter`. One AI agent per channel (hard rule)
- **Conversation mutex**: Redis SETNX lock per conversation ID (`lock:conv:{conversationId}`, 30s TTL)
- **Booking state**: Redis (`booking:{conversationId}`, 1h TTL) primary, PostgreSQL backup. In directive mode, only last 4 messages sent to LLM
- **Multi-agent**: Plan-gated (starter=1, pro=3, enterprise=10, custom=unlimited). One agent per channel
- **Subscription plans**: 4 plans control agent count, template access, rate limits, calendar count, property count
- **Multi-calendar**: Plan-gated (starter:1, pro:3, enterprise:10, custom:999). 3-tier resolution: service → staff → general fallback
- **Vacation Rental**: `Propiedades` sidebar item visible only when `verticalConfig.industry === 'turismo'`
- **Test in production**: User tests in production, never locally. Deploy via `git push` → GitHub Actions
- **No mocks for DB**: Integration tests hit real database

## Verification before pushing

```bash
cd apps/api && npx tsc --noEmit            # Type errors
cd apps/api && npm run test:bootstrap      # NestJS DI errors (CRITICAL — tsc doesn't catch)
cd apps/dashboard && npx tsc --noEmit      # Dashboard type errors
cd apps/landing && npx tsc --noEmit        # Landing type errors
docker exec parallext-pgbouncer pg_isready -h localhost -p 6432  # PgBouncer health
```

## Build & run

```bash
npm run dev                                 # All apps
npm run dev:api                             # API only
npm run dev:dashboard                       # Dashboard only
npm run dev:whatsapp                        # WhatsApp service only
cd apps/api && npx prisma generate          # After schema.prisma changes
cd infra/docker && docker compose up -d     # Dev infrastructure (postgres + redis)
```

## Environment variables (key ones)

See `.env.example`. Critical:
- `DATABASE_URL`, `DIRECT_DATABASE_URL` (bypasses PgBouncer for migrations)
- `INTERNAL_JWT_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (must differ), `INTERNAL_API_KEY`
- `ENCRYPTION_KEY` (64-char hex for AES-256-GCM)
- `META_APP_ID/SECRET/CONFIG_ID/VERIFY_TOKEN`, `SYSTEM_USER_ID`
- LLM keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY` (≥1 required)
- `SENTRY_DSN`, `GOOGLE_OAUTH_CLIENT_ID`, `SMTP_HOST/USER/PASS`, `MEDIA_STORAGE_PATH`
- `MERCADOPAGO_ACCESS_TOKEN/PUBLIC_KEY/WEBHOOK_SECRET`
- `NEXT_PUBLIC_INSTAGRAM_APP_ID`, `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI`, `NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID`

**CRITICAL**: `.env` regenerated on every deploy from GitHub Actions Secrets. New env vars MUST be added to BOTH GitHub Secrets AND `.github/workflows/deploy.yml` or they're lost on next deploy.

## Production

- Landing: https://parallly-chat.cloud (static, nginx, 4-lang i18n)
- Dashboard: https://admin.parallly-chat.cloud (Next.js)
- API: https://api.parallly-chat.cloud (NestJS, 67 modules)
- WhatsApp: https://wa.parallly-chat.cloud (NestJS, Embedded Signup)
- KB Portal: https://admin.parallly-chat.cloud/kb/{tenant-slug}
- BI API: https://api.parallly-chat.cloud/api/v1/bi-api/ (X-API-Key auth)
- GitHub: https://github.com/Nipko/sales-structure
- VPS: Hostinger Ubuntu, Docker (10 containers incl. PgBouncer), Cloudflare Tunnel
- Deploy: Push to main → GitHub Actions → build 5 images → SSH → regenerate .env → migrate → rolling restart (worker→API→frontend)
- Backups: Daily 2AM (DB + media + Redis), weekly/monthly copies, offsite via rclone (if configured)
- Cleanup: Weekly Sunday 5AM (Docker prune, temp files, journal logs)

---

## Documentation Index

When you need depth on a topic, read the relevant file. Don't load these proactively — only when the task touches them.

| Topic | File |
|-------|------|
| **Detailed architecture, prompt layers (3-tier), 5-tier knowledge, language detection, auth/sessions, OAuth flows, calendar, observability, BullMQ, pipeline hardening, production resilience, LLM Router task-based routing** | `docs/architecture-detail.md` |
| **68+ modules reference + all endpoints + 78 dashboard pages + 6 BullMQ queues + 28 cron jobs** | `docs/modules-reference.md` |
| **Platform audit (May 2026): functionality inventory, i18n gaps, industry scorecard, vertical matrix, improvement roadmap** | `docs/platform-audit-2026-05.md` |
| **Analytics endpoints (12 dashboard + 7 BI), Redis keys, tenant/global schemas, billing, offboarding, financials, super admin, vertical adaptation, vacation rental, CRM overhaul, handoff system, AI usage dashboard** | `docs/analytics-billing-reference.md` |
| **Historical changelog (Session entries, navigation redesigns, security fixes, UX overhauls)** | `docs/CHANGELOG.md` |
| **Vertical adaptation strategy** | `docs/vertical-strategy.md` |
| **Observability manual, LLM provider health monitoring** | `docs/observability-manual.md` |
| **Appointments manual** | `docs/appointments-manual.md` |
| **Analytics manual** | `docs/analytics-manual.md` |
| **Billing setup + runbook** | `docs/billing-mp-setup.md`, `docs/billing-runbook.md` |
| **Offboarding manual** | `docs/offboarding-manual.md` |
| **API reference** | `docs/API_REFERENCE.md` |
| **Data dictionary** | `docs/data-dictionary.md` |
| **Security policies** | `docs/SECURITY.md` |
| **Server installation** | `docs/server-installation.md` |
| **Infrastructure capacity, scaling projections, cost analysis, 1000-tenant scenario, provider comparison** | `docs/infrastructure-capacity-analysis.md` |
| **User manual** | `docs/user-manual.md` |
| **Competitive analysis (May 2026 Q2 — DEFINITIVO): ~40 competidores en 6 clusters (AI-native, incumbentes, messaging, LatAm, booking/vertical/all-in-one), 31 dimensiones code-grounded, joya de la corona + UX + blueprint por competidor, 8 macro-tendencias, pricing WhatsApp/Meta, plan priorizado** | `docs/competitive-analysis-2026-q2.md` (supersede `competitive-analysis-2026-05.md` y `-enhanced.md`) |
| **Platform test plan (May 2026): ~450 test items, 27 sections, 68 modules** | `docs/test-plan-2026-05.md` |
| **Onboarding redesign (Q2 2026): research + proposal — guided/mandatory first-channel flow, 13-competitor teardown, WhatsApp Embedded Signup deep-dive, feature normalization into 5 levels, cohesive with `/onboarding`** | `docs/onboarding-redesign-2026-q2.md` |
| **Onboarding redesign — technical implementation plan (file-by-file, endpoints, i18n, phases). Reuses existing `WhatsAppEmbeddedSignup` + route cards + ESU/coexistence backend; mostly wiring not building** | `docs/onboarding-redesign-implementation-plan.md` |
| **Facturación electrónica DIAN Colombia (Jun 2026): decisión proveedor/API (PT) vs integración directa; ganador Factus, 2º Alegra; capa `IFiscalInvoiceProvider` desacoplada del PSP; modelo `FiscalInvoice`; impacto LLC/Stripe (IVA servicios digitales del exterior); plan por fases, bloqueantes y TCO** | `docs/facturacion-electronica-colombia-2026-06.md` |
| **Notificaciones por SMS (Jul 2026): plan de implementación por fases (alertas super admin → handoff → OTP/2FA → suscriptores); WhatsApp‑first + SMS fallback; operador Twilio + Verify; planos plataforma vs tenant; gating por plan + cuotas; deuda del canal SMS a cerrar** | `docs/sms-notifications-implementation-plan-2026-07.md` |
| **SMS monetizado por paquetes (Jul 2026, IMPLEMENTADO F0-F3): modelo reseller — tenants compran créditos (1=1 segmento) para notificar one-way a sus clientes vía Twilio de plataforma; balance/ledger atómico, envío medido (broadcast + cola), compra MercadoPago pago único, UI tenant + super admin (tiers editables); canal conversacional descartado** | `docs/sms-monetization-packages-2026-07.md` |
| **Multi-cuenta por tipo de canal (Jul 2026): N conexiones del mismo tipo (2 números WhatsApp, 2 IG…) gateado por plan×canal (`features.maxChannelAccounts`, default 1) + override por tenant; tokens por-cuenta vía `channel_accounts.access_token` (sin migración global); agente por conexión (`agent_personas.channel_bindings`); anti-conflación de conversaciones; UI editor adaptativa + overview con contador/límite + disconnect por-cuenta. Fases 1-5 codificadas. Contratos + checklist + limitaciones v1** | `docs/multi-channel-per-type-implementation-2026-07.md` |
