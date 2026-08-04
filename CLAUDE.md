# Parallext Engine — Claude Code Context

## What is this project?
Multi-tenant conversational AI SaaS platform (Parallly) for automating sales across WhatsApp, Instagram, Messenger, Telegram, Email, and a Web Chat Widget. (SMS is a one-way reseller-credits notification product, not a conversational channel — conversational SMS was discarded.)
Monorepo with 5 apps (83 API modules, 139 dashboard pages), deployed on Hostinger VPS via Docker + Cloudflare Tunnel.

## Architecture (high-level)

```
Customer (WA/IG/Messenger/Telegram/SMS) → Channel API → API (port 3000) → ConversationsService
    → IdentityService → PersonaService.getPersonaForChannel(tenantId, channelType, accountId?)
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
  api/          — NestJS 10, port 3000. 83 modules
  dashboard/    — Next.js 16, port 3001. React 19, Tailwind + shadcn/ui + recharts. 139 pages
  whatsapp/     — NestJS 10, port 3002. Embedded Signup v4 + Meta webhook router
  landing/      — Next.js static export, port 80. parallly-chat.cloud, 4-language i18n
  mobile/       — React Native / Expo (@parallext/mobile). Agent inbox app. EAS build, Firebase, Sentry. Ships via EAS, NOT the web deploy pipeline (docs/ + apps/mobile are paths-ignored in deploy.yml)
packages/shared/ — TypeScript types
infra/docker/    — docker-compose.yml (dev), docker-compose.prod.yml, Dockerfiles
infra/nginx/     — Reverse proxy config (WebSocket upgrade enabled)
infra/scripts/   — setup-vps.sh, setup-fresh.sh, reset-db.sh, setup-production-crons.sh, harden-vps.sh
docs/            — Detailed reference (see Index at bottom)
```

## Key conventions (CRITICAL — apply to every task)

- **Language**: Code in English, user-facing strings in Spanish (Latin American market). ALL strings via i18n (next-intl, 4 languages: es/en/pt/fr). **Every page edit/creation MUST update all 4 JSON files**
- **Multi-tenancy**: Schema-per-tenant in PostgreSQL. Schema name from `tenants.schema_name`
- **Database queries**: `prisma.$queryRawUnsafe(sql, ...params)` — ALWAYS use `::uuid` casts. NO type arguments on `$queryRawUnsafe`
- **Global tables**: Prisma client directly (`prisma.tenant.findUnique(...)`)
- **Raw SQL column names**: snake_case (`is_active`, not `"isActive"`) — Prisma `@map` only applies to Prisma client. `users.name` is a generated column
- **Auth**: JWT with refresh token rotation (Redis-backed). 4 roles: super_admin, tenant_admin, tenant_supervisor, tenant_agent. Session timeout 60min with warning modal
- **Super_admin governance**: super_admin has NO implicit tenant (platform mode); `roles.ts` is deny-by-default — every new super_admin page/endpoint needs an explicit rule or access is denied. Acting on a tenant requires **impersonation** with a mandatory reason (`impersonate(superAdminId, tenantId, {reason, ticketId})`), 1h tokens, a paired session (`impersonationSid`), and audit writes attributed to the REAL super_admin (not the impersonated user). See `docs/superadmin-governance.md`
- **Database pooling**: PgBouncer (transaction mode) between apps and PostgreSQL. Use `DIRECT_DATABASE_URL` for Prisma migrations. Multi-statement SQL must be split into individual queries
- **Migraciones = expand-contract (OBLIGATORIO)**: el deploy migra ANTES de recrear contenedores, así que el código viejo corre contra el schema nuevo durante minutos. Solo cambios **aditivos** en un deploy (ADD COLUMN nullable, CREATE TABLE/INDEX, ampliar tipos). Un RENAME/DROP va en **dos deploys** (agregar + escribir en ambos lados → eliminar). Ver `docs/deploy-hardening-runbook.md` §6
- **Mensajes entrantes = cola**: todo webhook **encola y recién entonces confirma** (`InboundQueueService`, cola `inbound-messages`). Nunca llamar `processIncomingMessage` directo desde un controller: un reinicio mataría el turno sin nada que reintentar. El turno es idempotente vía índice único `messages.external_id` + marcador `turn:done:*` + `dedupeId` del saliente
- **Error tracking**: Sentry (@sentry/nestjs + profiling). `instrument.ts` must load before all modules
- **Guards**: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` on protected endpoints
- **CRM is built-in**: No external CRM. Handoff → internal agent console via WebSocket
- **Event-driven**: HandoffService emits events, AgentConsoleGateway listens via @OnEvent
- **Outbound messages**: Always through OutboundQueueService (BullMQ, 3 retries, priority by tenant plan)
- **Webhook idempotency**: Redis keys `idem:{channel}:{id}` with 24h TTL
- **LLM Router**: Task-based routing (conversation vs tool_calling). 4-tier fallback with circuit breaker. Plan-gated tier access
- **Redis**: noeviction policy (never allkeys-lru). BullMQ jobs must not be silently evicted
- **BigInt**: `BigInt.toJSON` polyfill in main.ts and worker.main.ts for PostgreSQL COUNT(*)
- **Channels**: Adapter pattern via `IChannelAdapter` (WhatsApp, Instagram, Messenger, Telegram, Email, Web Chat Widget). **One AI agent per _connection_** — with multi-channel-per-type a tenant can hold N connections of the same type (2 WhatsApp numbers, 2 IG accounts…), each bound to its own agent via `agent_personas.channel_bindings`, gated by `features.maxChannelAccounts` (default 1). Tokens are per-account (`channel_accounts.access_token`)
- **Conversation mutex**: Redis SETNX lock per conversation ID (`lock:conv:{conversationId}`, 30s TTL)
- **Booking state**: Redis (`booking:{conversationId}`, 1h TTL) primary, PostgreSQL backup. In directive mode, only last 4 messages sent to LLM
- **Multi-agent**: Plan-gated agent count. One agent per _connection_ (see Channels above)
- **Subscription plans**: **5 plans** — emprendedor (USD $21), starter ($49), pro ($129), enterprise ($349), custom (quote). Control agent count, template access, rate limits, calendar count, property count, SMS credits, media quotas. Source of truth: `apps/api/prisma/seed-billing-plans.js` + `billing_plans` table. Monthly/annual billing cycle (~15% annual discount) — see `docs/billing-annual-cycle.md`
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
- API: https://api.parallly-chat.cloud (NestJS, 83 modules)
- WhatsApp: https://wa.parallly-chat.cloud (NestJS, Embedded Signup)
- KB Portal: https://admin.parallly-chat.cloud/kb/{tenant-slug}
- BI API: https://api.parallly-chat.cloud/api/v1/bi-api/ (X-API-Key auth)
- GitHub: https://github.com/Nipko/sales-structure
- VPS: Hostinger Ubuntu, Docker (~14 containers: api, worker, dashboard, whatsapp, landing, postgres, redis, pgbouncer, tunnel + observability stack: grafana, loki, promtail, uptime-kuma, dozzle), Cloudflare Tunnel. Watchtower fue eliminado (jul 2026): competía con el deploy script — reiniciaba contenedores con código nuevo ANTES de las migraciones
- Deploy: Push to main → GitHub Actions → build 5 images → SSH (key-only auth) → `git reset --hard origin/main` → regenerate .env → migrate → rolling restart (worker→API→frontend). NOTE: `git reset --hard` restores tracked file modes — infra scripts MUST stay `100755` in git or cron loses the +x (see `docs/backup-restore-runbook.md`)
- Backups: Daily 2AM (DB public+tenant schemas + media + fiscal invoices + Redis), 7/4/2 daily/weekly/monthly rotation, offsite S3-compatible via rclone (Cloudflare R2). Honest heartbeat `backup:last_success` watched by the Ops Center (alerts if stale >26h). See `docs/backup-restore-runbook.md`
- Ops Center: super_admin `/admin/ops` + `health/platform-monitor.service.ts` — monitors disk/RAM/Redis/PgBouncer/queues/Sentry/LLM/SLA/backup-heartbeat/channel-tokens/payment-webhooks, raises incidents, Telegram/SMS/email alerts
- Cleanup: Weekly Sunday 5AM (Docker prune, temp files, journal logs)

---

## Documentation Index

When you need depth on a topic, read the relevant file. Don't load these proactively — only when the task touches them.

| Topic | File |
|-------|------|
| **Detailed architecture, prompt layers (3-tier), 5-tier knowledge, language detection, auth/sessions, OAuth flows, calendar, observability, BullMQ, pipeline hardening, production resilience, LLM Router task-based routing** | `docs/architecture-detail.md` |
| **83 modules reference + all endpoints + 139 dashboard pages + 11 BullMQ queues + ~46 cron jobs** | `docs/modules-reference.md` |
| **Platform audit (May 2026, ARCHIVED — historical snapshot)** | `docs/archive/platform-audit-2026-05.md` |
| **Analytics endpoints (12 dashboard + 7 BI), Redis keys, tenant/global schemas, billing, offboarding, financials, super admin, vertical adaptation, vacation rental, CRM overhaul, handoff system, AI usage dashboard** | `docs/analytics-billing-reference.md` |
| **Historical changelog (Session entries, navigation redesigns, security fixes, UX overhauls)** | `docs/CHANGELOG.md` |
| **Vertical adaptation strategy** | `docs/vertical-strategy.md` |
| **Auditoría del bootstrap por vertical (Jul 2026): qué de lo sembrado por industria llega al runtime y qué no. La persona vertical se escribía en la raíz de `config_json` y nadie la leía; el setup wizard hacía REPLACE y borraba los flags de herramienta; las verticales con agenda salían sin `availability_slots` → bucle de "no hay disponibilidad" al cliente final. Arreglado en `95f758f3`** | `docs/vertical-bootstrap-audit-2026-07.md` |
| **Auditoría de madurez de las 18 verticales (Jul 2026): matriz 18×12, 1 profunda / 9 medias / 8 superficiales. Inversión invertida vs demanda (belleza #1 sin nada dedicado; turismo la más rica); mucho valor construido y dormido (automotriz apagada por 1 flag, education con tabla colisionada, trigger inactivity sin listener); motor de reservas mono-recurso como hueco estructural. Datos crudos en `docs/vertical-audit-workdir/`** | `docs/vertical-maturity-audit-2026-07.md` |
| **Deep-dives por vertical (Jul 2026) — 18/18 dossiers, uno por industria: radiografía end-to-end, la experiencia real del dueño y del cliente final, huecos finos, lo que el rubro necesita, competencia y plan de inversión propio. Empezar por `_TEMPLATE.md` (spec + contexto de fixes ya desplegados) y `_PROGRESS.md` (los 18 veredictos en una línea). Tesis de cierre: *thin vertical, deep horizontal*** | `docs/vertical-deep-dives/` |
| **⭐ PLAN CONSOLIDADO de verticales (Jul 2026) — EMPEZAR ACÁ para ejecutar: los 390 ítems de los 18 dossiers deduplicados en 24 arreglos horizontales (ordenados por verticales-desbloqueadas/esfuerzo) + backlog por vertical + 13 decisiones que bloquean trabajo + 3 olas con criterio de "listo" + lo que NO se hace y por qué** | `docs/vertical-consolidated-plan-2026-07.md` |
| **Auditoría de iniciativas abiertas (ago 2026): 8 iniciativas fuera del plan de verticales, 37 hallazgos confirmados contra refutador (24 ya cerrados). Los 12 que quedan, con evidencia archivo:línea y el matiz del refutador — que en varios casos acota el alcance real** | `docs/audit-open-initiatives-2026-08.md` |
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
| **Competitive analysis (Q2 2026 — canonical): ~40 competidores en 6 clusters, 31 dimensiones code-grounded, blueprint por competidor, 8 macro-tendencias, pricing WhatsApp/Meta, plan priorizado** | `docs/competitive-analysis-2026-q2.md` (las versiones `-2026-05` y `-05-enhanced` están en `docs/archive/`) |
| **Platform test plan (May 2026, ARCHIVED — historical snapshot)** | `docs/archive/test-plan-2026-05.md` |
| **Onboarding redesign (Q2 2026): research + proposal — guided/mandatory first-channel flow, 13-competitor teardown, WhatsApp Embedded Signup deep-dive, feature normalization into 5 levels, cohesive with `/onboarding`** | `docs/onboarding-redesign-2026-q2.md` |
| **Onboarding redesign — technical implementation plan (file-by-file, endpoints, i18n, phases). Reuses existing `WhatsAppEmbeddedSignup` + route cards + ESU/coexistence backend; mostly wiring not building** | `docs/onboarding-redesign-implementation-plan.md` |
| **Facturación electrónica DIAN Colombia (Jun 2026): decisión proveedor/API (PT) vs integración directa; ganador Factus, 2º Alegra; capa `IFiscalInvoiceProvider` desacoplada del PSP; modelo `FiscalInvoice`; impacto LLC/Stripe (IVA servicios digitales del exterior); plan por fases, bloqueantes y TCO** | `docs/facturacion-electronica-colombia-2026-06.md` |
| **Notificaciones por SMS (Jul 2026): plan de implementación por fases (alertas super admin → handoff → OTP/2FA → suscriptores); WhatsApp‑first + SMS fallback; operador Twilio + Verify; planos plataforma vs tenant; gating por plan + cuotas; deuda del canal SMS a cerrar** | `docs/sms-notifications-implementation-plan-2026-07.md` |
| **SMS monetizado por paquetes (Jul 2026, IMPLEMENTADO F0-F3): modelo reseller — tenants compran créditos (1=1 segmento) para notificar one-way a sus clientes vía Twilio de plataforma; balance/ledger atómico, envío medido (broadcast + cola), compra MercadoPago pago único, UI tenant + super admin (tiers editables); canal conversacional descartado** | `docs/sms-monetization-packages-2026-07.md` |
| **Multi-cuenta por tipo de canal (Jul 2026): N conexiones del mismo tipo (2 números WhatsApp, 2 IG…) gateado por plan×canal (`features.maxChannelAccounts`, default 1) + override por tenant; tokens por-cuenta vía `channel_accounts.access_token` (sin migración global); agente por conexión (`agent_personas.channel_bindings`); anti-conflación de conversaciones; UI editor adaptativa + overview con contador/límite + disconnect por-cuenta. Fases 1-5 codificadas. Contratos + checklist + limitaciones v1** | `docs/multi-channel-per-type-implementation-2026-07.md` |
| **WhatsApp coexistence manual** | `docs/coexistence-manual.md` |
| **Operations runbook + Ops Center (platform-monitor: disk/RAM/Redis/PgBouncer/queues/Sentry/LLM/SLA/backup/tokens/webhooks)** | `docs/operations-runbook.md` |
| **Backup / restore runbook (verificación, restore, drills, postmortem incidente exec-bit 2026-07-23) + offsite setup (R2/S3)** | `docs/backup-restore-runbook.md`, `docs/backup-offsite-setup.md` |
| **Deploy hardening runbook (SSH key-only, throttling por IP real CF-Connecting-IP, backup pre-migración)** | `docs/deploy-hardening-runbook.md` |
| **Security specification (threat model, controles)** | `docs/security-specification.md` |
| **Super_admin governance & impersonación (platform mode, roles.ts deny-by-default, sesión emparejada, actor real en auditoría)** | `docs/superadmin-governance.md` |
| **Billing: ciclo anual/mensual, sync a MercadoPago, billing-ops cross-tenant, refund inline, reconciliación** | `docs/billing-annual-cycle.md` |
| **Pricing / rentabilidad (precios COP por país, márgenes)** | `docs/plan-profitability-2026-07.md` |
| **App móvil (`apps/mobile`, React Native/Expo): plan, EAS build, Sentry sourcemaps, GATE 0, Play Store, audit** | `docs/mobile-app-plan.md`, `docs/mobile-eas-build.md`, `docs/mobile-sentry-sourcemaps.md`, `docs/mobile-gate0-checklist.md`, `docs/play-store-publish-checklist.md`, `docs/mobile-app-audit-2026-q2.md` |
| **Onboarding audit (Jun 2026, estado fases 0-4)** | `docs/onboarding-audit-2026-06.md` |
| **Auditoría del onboarding (Jul 2026 — VIGENTE, supersede a la de jun): recorrido real end-to-end, nota 4.5/10. Causa raíz = `/onboarding` y `/admin/setup-wizard` son dos flujos que se pisan + el estado vive en 3 lugares sin autoridad. Camino canónico elegido: `/onboarding` extendido, setup-wizard degradado a editor de agente. Bloques "Ahora" y casi todo "Después" ya implementados** | `docs/onboarding-audit-2026-07.md` |
| **Marketing/contenido (Jul 2026): capacidades de creación de contenido operables desde Claude Code — stack local $0 (satori/sharp + Playwright + Remotion + ffmpeg), APIs de imagen/video/voz (fal.ai, Kling 3.0 es-LA, Veo 3.1, ElevenLabs, HeyGen), publicación (Meta directo + Postiz), precios verificados y fases** | `docs/marketing-content-capabilities-2026-07.md` |
| **Research: mercado LatAm, CRM externo, feature board** | `docs/market-research-latam.md`, `docs/external-crm-integration-research.md`, `docs/feature-board-research.md` |
| **Histórico / superseded** | `docs/archive/` (competitive-05/-enhanced, platform-audit, test-plan, security-audit, platform-excellence, roadmap/*, specs/*, billing-plan, add_parallly_arquitectura, guia-tema-visual) |
