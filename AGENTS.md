# Parallext Engine — Agent Context

Single source of context for coding agents (Codex, Claude Code and others). `CLAUDE.md` only imports this file. Per-app context lives in `apps/<app>/CLAUDE.md`. The full documentation index — with owner, status and source of truth in code for every approved document — is [`docs/README.md`](docs/README.md); approved decisions are ADRs in [`docs/decisions/`](docs/decisions/README.md).

> **Rule (K4):** a change is not done until it updates the knowledge base it affects and retires what it replaces. Do not add dated changelog sections here: history lives in git, PRs and ADRs.

## What is this project?

Multi-tenant conversational AI SaaS platform (Parallly) for automating sales and service across WhatsApp, Instagram, Messenger, Telegram and a Web Chat widget. Email has an internal inbound adapter but no certified tenant self-service configuration. SMS is a **retired product** (platform kill switch `sms.platform_enabled` defaults to off; credits, checkout and notifications answer `sms_product_retired`) and was never a conversational channel.

Monorepo with 5 apps, deployed on a Hostinger VPS via Docker + Cloudflare Tunnel; mobile binaries ship separately through EAS / Google Play. Structural counters drift: recompute them (see "Counters") instead of copying numbers into docs.

**Glossary (use it consistently).** *Vertical* = industry (20 in `VERTICAL_REGISTRY`, 18 selectable at sign-up). *Business type* (tipo de negocio) = industry/subtype profile (80 canonical = 72 selectable + 8 waitlist; 85 resolvable configurations including 5 `legacy_only`). The generated list is `docs/domain/business-types-catalog.md`; the code authorities are `apps/api/src/modules/verticals/vertical-definitions.ts` and `packages/shared/src/subtype-experience-profile.ts`. Business requirements per type live in the single specification `packages/business-spec/` (ADR 0001), rendered to `docs/domain/business-requirements.md`.

Current product scope: `docs/architecture/product-capabilities-reference.md`, `docs/architecture/platform-assistant-knowledge.md` and the Assist knowledge base `apps/api/kb/assistant/` (the help that actually reaches users).

## Architecture (high-level)

```
Customer (WA/IG/Messenger/Telegram/Web Chat) → Channel ingress (WhatsApp service :3002 or API webhooks)
    → InboundQueueService (BullMQ `inbound-messages`) → API (port 3000) → ConversationsService
    → IdentityService → PersonaService.getPersonaForChannel(tenantId, channelType, accountId?)
    → BusinessInfoService + KnowledgeService (RAG) + BookingEngine
    → PromptAssemblerService (L1 contract + L2 persona + L3 turn) → LLMRouter → Provider
    → OutboundQueueService (BullMQ) → ChannelGatewayService → Customer

  If handoff: HandoffService → EventEmitter → AgentConsoleGateway (WebSocket /inbox)
  Rate limit: TenantThrottleService per-plan checks Redis before every job
```

Prompt layers, the 5-tier knowledge model, language detection, auth/sessions, OAuth, calendar, BullMQ and the LLM router are described in `docs/architecture/architecture-detail.md`. The backend owns flow decisions (booking engine, directives); the LLM is the voice.

## Monorepo structure

```
apps/
  api/          — NestJS 10, port 3000 (`*.module.ts` count: see Counters)
  dashboard/    — Next.js 16, port 3001. React 19, Tailwind + shadcn/ui + recharts
  whatsapp/     — NestJS 10, port 3002. Embedded Signup v4 + Meta webhook router
  landing/      — Next.js static export, port 80. parallly-chat.cloud, 4-language i18n
  mobile/       — React Native / Expo (@parallext/mobile). Agent inbox app. Ships via EAS, NOT the web deploy (docs/ and apps/mobile are paths-ignored in deploy.yml)
packages/shared/        — Shared TypeScript types and policies (roles, page access, subtype profiles)
packages/business-spec/ — Business requirements specification (YAML + schema + CLI)
infra/docker/    — docker-compose.yml (dev), docker-compose.prod.yml, Dockerfiles
infra/scripts/   — setup-vps.sh, setup-fresh.sh, reset-db.sh, setup-production-crons.sh, harden-vps.sh
infra/backup/    — backup.sh / restore.sh (cron on the VPS)
docs/            — Knowledge base (index: docs/README.md)
```

There is no reverse proxy config in the repo: production ingress is the Cloudflare Tunnel service (`tunnel` in `docker-compose.prod.yml`); the landing image builds its own nginx config inline (`Dockerfile.landing`).

## Key conventions (CRITICAL — apply to every task)

- **Language**: Code in English, user-facing strings in Spanish (Latin American market). ALL strings via i18n (next-intl, 4 languages: es/en/pt/fr). **Every page edit/creation MUST update all 4 JSON files**
- **Multi-tenancy**: Schema-per-tenant in PostgreSQL. Schema name from `tenants.schema_name`
- **Database queries**: `prisma.$queryRawUnsafe(sql, ...params)` — ALWAYS use `::uuid` casts. NO type arguments on `$queryRawUnsafe`. NEVER interpolate tenantId or user input into SQL strings: parameters only (`$N::uuid`)
- **Global tables**: Prisma client directly (`prisma.tenant.findUnique(...)`)
- **Raw SQL column names**: snake_case (`is_active`, not `"isActive"`) — Prisma `@map` only applies to Prisma client. `users.name` is a generated column
- **Auth**: JWT with refresh token rotation (Redis-backed). 5 roles: super_admin, tenant_admin, tenant_supervisor, tenant_agent, tenant_viewer (`packages/shared/src/index.ts`). Session timeout 60min with warning modal
- **Super_admin governance**: super_admin has NO implicit tenant (platform mode); `roles.ts` is deny-by-default — every new super_admin page/endpoint needs an explicit rule or access is denied. Acting on a tenant requires **impersonation** with a mandatory reason (`impersonate(superAdminId, tenantId, {reason, ticketId})`), 1h tokens, a paired session (`impersonationSid`), and audit writes attributed to the REAL super_admin. See `docs/security/superadmin-governance.md`
- **Guards**: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` on protected endpoints. `TenantGuard` UUID-validates tenantId params
- **WebSocket tenant isolation**: every gateway MUST validate tenantId before `join()` and reject connections without one
- **Database pooling**: PgBouncer (transaction mode) between apps and PostgreSQL. Use `DIRECT_DATABASE_URL` for Prisma migrations. Multi-statement SQL must be split into individual queries
- **Migraciones = expand-contract (OBLIGATORIO)**: el deploy migra ANTES de recrear contenedores, así que el código viejo corre contra el schema nuevo durante minutos. Solo cambios **aditivos** en un deploy (ADD COLUMN nullable, CREATE TABLE/INDEX, ampliar tipos). Un RENAME/DROP va en **dos deploys** (agregar + escribir en ambos lados → eliminar). Ver `docs/operations/deploy-hardening-runbook.md` §6. Dropping a table or column that may hold data needs the owner's approval, one by one, with a backup
- **Mensajes entrantes = cola**: todo webhook **encola y recién entonces confirma** (`InboundQueueService`, cola `inbound-messages`). Nunca llamar `processIncomingMessage` directo desde un controller: un reinicio mataría el turno sin nada que reintentar. El turno es idempotente vía índice único `messages.external_id` + marcador `turn:done:*` + `dedupeId` del saliente. **`InboundQueueService.enqueue` valida y descarta** lo estructuralmente inválido (`tenantId`/`contactId`/`channelType`/`channelAccountId` vacíos) — es la frontera común a los 7 productores, así que la validación va ahí y no en el webhook de turno. Descarta con `return`, nunca `throw`: lanzar propaga un 5xx y el proveedor redelivera el mismo cuerpo roto en bucle. **Nunca coercionar `contactId` a `''`**: el índice único `(channel_type, external_id)` fusionaría a todos los remitentes desconocidos en UN contacto. Y esa validación **no puede exigir `direction === 'inbound'`**: la cola también transporta los salientes de solo-guardado de coexistencia (`waba_echo`, `historical`)
- **Valores del negocio (readiness R3)**: `requirement_values` se escribe SOLO con `BusinessFactsService` (valida contra `@parallext/business-spec`, sube `version`, deja la versión con su actor y emite `business_fact.written`); `business-facts-writes.spec.ts` falla con cualquier otro `INSERT`/`UPDATE`. Una escritura que cambie la procedencia de una fila de catálogo o texto estampa `source_ref.row_updated_at`. **El agente lee horario, políticas, `not_offered` e identidad SOLO con `BusinessFactsReader` (R3b)**: no leas `settings.businessHours`, la tabla `policies` ni `companies` (`is_primary`) en código nuevo del runtime, y no vuelvas a poner la lista de plataforma `exclusions` del perfil en el prompt (`<not_offered>` es `CORE.OFFER.NOT_OFFERED` del negocio). Detalle: `docs/domain/business-readiness-runtime.md`
- **Error tracking**: Sentry (@sentry/nestjs + profiling). `instrument.ts` must load before all modules
- **CRM is built-in**: No external CRM (no Chatwoot). Handoff → internal agent console via WebSocket
- **Event-driven**: HandoffService emits events, AgentConsoleGateway listens via @OnEvent
- **Outbound messages**: Always through OutboundQueueService (BullMQ, 3 retries, priority by tenant plan)
- **Webhook idempotency**: Redis keys `idem:{channel}:{id}` with 24h TTL
- **LLM Router**: Task-based routing (conversation vs tool_calling). 4-tier fallback with circuit breaker. Plan-gated tier access. Skips unconfigured providers
- **Redis**: noeviction policy (never allkeys-lru). BullMQ jobs must not be silently evicted
- **BigInt**: `BigInt.toJSON` polyfill in main.ts and worker.main.ts for PostgreSQL COUNT(*)
- **Channels**: Adapter pattern via `IChannelAdapter` (WhatsApp, Instagram, Messenger, Telegram and Web Chat Widget). Email is an internal inbound adapter, not a certified self-service connection: `/admin/channels/email` redirects to `/admin/channels` since 2026-08-25. **One AI agent per operational connection** — multi-account availability and limits come from the tenant's runtime plan; tokens are per-account (`channel_accounts.access_token`)
- **Conversation mutex**: Redis SETNX lock per conversation ID (`lock:conv:{conversationId}`, 30s TTL)
- **Booking state**: Redis (`booking:{conversationId}`, 1h TTL) primary, PostgreSQL backup. In directive mode, only last 4 messages sent to LLM. Directive strings exist in the 4 languages; no LLM translation
- **Multi-agent / multi-calendar**: counts come from the runtime plan/overrides. Calendar resolution: service → staff → general fallback
- **Subscription plans**: names, prices, billing cycles, quotas and feature flags come from the runtime `billing_plans` catalog plus authorized tenant overrides. Do not copy fixed prices or limits into prompts/docs. The seed is only a provisioning baseline; see `docs/domain/billing-annual-cycle.md`
- **Payments**: Wompi is the platform subscription rail for Colombia/COP (internal renewal engine); Stripe (hosted Checkout) serves recognized non-Colombian billing countries and stays disabled until explicitly enabled. Mercado Pago was retired as platform PSP (Aug 2026); it survives only for tenant → customer payment links in `tenant-payments`. See `docs/domain/stripe-international-subscriptions-2026-09.md` and `docs/operations/billing-runbook.md`
- **Vertical sidebar items**: visibility is decided by `apps/dashboard/src/lib/vertical-dashboard-resolver.ts` from the capabilities of the industry/subtype (e.g. `nightly_booking` → `stays` + `properties`), and `AppSidebar.tsx` gates each item with `verticalItem: "<key>"`, never with `industry === ...`
- **Test in production**: The owner tests in production, never locally. Deploy via merge to `main` → GitHub Actions
- **No mocks for DB**: Integration tests hit a real database

## Key files for common tasks

Paths relative to `apps/api/src/modules/` unless they start with `apps/`, `dashboard/` or `packages/`.

| Task | Files |
|------|-------|
| Message flow | `conversations/conversations.service.ts` (orchestrator) |
| Add LLM provider | `ai/providers/*.provider.ts`, `ai/router/llm-router.service.ts` |
| Agent persona config | `persona/persona.service.ts`, `persona/persona.controller.ts` |
| Channel adapters | `channels/{channel}/*.adapter.ts`, `channels/channel-gateway.service.ts` |
| Channel management | `channels/channel-management.controller.ts` (connect IG/Messenger/Telegram; the SMS routes answer `sms_product_retired`) |
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
| Agent editor | `dashboard/src/app/admin/agent/[agentId]/page.tsx` |
| Agent list | `dashboard/src/app/admin/agent/page.tsx` |
| Setup banner | `dashboard/src/components/SetupBanner.tsx` |
| SMS adapter (legacy; product retired) | `channels/sms/sms.adapter.ts` |
| IG token refresh | `channels/instagram-token-refresh.service.ts` (daily @6AM, 30-day pre-expiry) |
| Offboarding | `offboarding/offboarding.service.ts` (7-step pipeline: channels, sessions, queues, deactivate, cache, audit, event) |
| Offboarding cron | `offboarding/offboarding-cron.service.ts` (grace enforcer @3AM, archive cleaner @4AM) |
| Financials | `financials/financials.service.ts` (MRR, ARR, ARPU, churn, LTV, quick ratio, tenant profitability) |
| Financial snapshots | `financials/financial-snapshot.service.ts` (monthly @1AM, MRR movements, per-tenant snapshots) |
| Billing | `billing/billing.service.ts` (Wompi/internal-engine subscription lifecycle, plan quotas) |
| Billing webhooks | `billing/webhook.controller.ts` (HMAC-SHA256 verify + idempotency + dispatch) |
| Billing reconciliation | `billing/processors/reconciliation.processor.ts` (hourly past_due sweep + daily drift) |
| Impersonation | `auth/auth.service.ts` (impersonate method, 1h tokens, audit trail) |
| Suspended screen | `dashboard/src/components/SuspendedScreen.tsx` |
| Impersonation banner | `dashboard/src/components/ImpersonationBanner.tsx` |
| Financials dashboard | `dashboard/src/app/admin/financials/page.tsx` (5 tabs) |
| Billing settings | `dashboard/src/app/admin/settings/billing/page.tsx` |
| Booking engine | `conversations/booking-engine.service.ts` (deterministic flow, Redis state) |
| Calendar integrations | `appointments/calendar-integration.service.ts` (Google/Microsoft sync) |
| Intent interpreter | `conversations/intent-interpreter.service.ts` (NLP for booking intents) |
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
| **Vertical definitions** | `verticals/vertical-definitions.ts` plus the shared manifest/policy (20 industries in `VERTICAL_REGISTRY`, 18 selectable; 80 canonical business types, 4 languages; see `docs/domain/business-types-catalog.md`) |
| **Vertical service** | `verticals/verticals.service.ts` (bootstrapVertical, getVerticalConfig) |
| **Vertical terms hook** | `dashboard/src/hooks/useVerticalTerms.ts` |


## Verification before pushing

```bash
cd apps/api && npx tsc --noEmit            # Type errors
cd apps/api && npm run test:bootstrap      # NestJS DI errors (CRITICAL — tsc doesn't catch)
cd apps/dashboard && npx tsc --noEmit      # Dashboard type errors
cd apps/landing && npx tsc --noEmit        # Landing type errors
npm run verify:artifacts                   # Generated documents (closure report, catalogs, business spec) still match the code
node apps/api/scripts/check-canary-figures.cjs --check   # Every docs/*.md agrees with the canary planner
docker exec parallext-pgbouncer pg_isready -h localhost -p 5432  # PgBouncer health (production compose port)
```

Jest: run with `--runInBand` and explicit spec paths; the full API suite is described in `docs/operations/runbooks/full-api-suite.md`.

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
- `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_SECRET`, `WOMPI_INTEGRITY_SECRET` — platform subscriptions in Colombia. There are no platform-level Mercado Pago credentials; a tenant that charges its own customers stores its own encrypted credentials (`modules/tenant-payments`)
- `OWNER_COUPON_PIN` — owner PIN for high-impact coupons. Lives in Secrets, NOT in the DB. Governance in `billing/coupon-governance.service.ts` (`platform_settings` key `coupons.governance`)
- `NEXT_PUBLIC_INSTAGRAM_APP_ID`, `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI`, `NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID`

**CRITICAL**: `.env` is regenerated on every deploy from GitHub Actions Secrets. New env vars MUST be added to BOTH GitHub Secrets AND `.github/workflows/deploy.yml` or they're lost on next deploy.

## Production

- Landing: https://parallly-chat.cloud (static, nginx, 4-lang i18n)
- Dashboard: https://admin.parallly-chat.cloud (Next.js)
- API: https://api.parallly-chat.cloud (NestJS; Swagger only outside production, public spec at `/docs/public`)
- WhatsApp: https://wa.parallly-chat.cloud (NestJS, Embedded Signup)
- KB Portal: https://admin.parallly-chat.cloud/kb/{tenant-slug}
- BI API: https://api.parallly-chat.cloud/api/v1/bi-api/ (X-API-Key auth)
- GitHub: https://github.com/Nipko/sales-structure
- VPS: Hostinger Ubuntu, Docker (services in `infra/docker/docker-compose.prod.yml`: api, worker, dashboard, whatsapp, landing, postgres, redis, pgbouncer, tunnel + observability: grafana, loki, promtail, uptime-kuma, dozzle), Cloudflare Tunnel. Watchtower was removed (Jul 2026): it restarted containers with new code BEFORE migrations
- Deploy: merge to `main` → GitHub Actions (`deploy.yml`: `validate` — typecheck, migrations on a fresh DB, boot smoke, vertical contract matrix and generated-artefact checks — → `build-and-push` (also waits for the Playwright smoke `e2e-smoke`) → `deploy`). **Since 2026-10-07 there is no manual approval in `production`.** Deploy steps: build 5 images → SSH (key-only) → `git reset --hard origin/main` → regenerate .env → migrate → rolling restart (worker→API→frontend). `git reset --hard` restores tracked file modes — infra scripts MUST stay `100755` in git or cron loses the +x (see `docs/operations/backup-restore-runbook.md`)
- Backups: daily 2AM (DB public+tenant schemas + media + fiscal invoices + Redis), 7/4/2 rotation, offsite via rclone (Cloudflare R2). Heartbeat `backup:last_success` watched by the Ops Center (alerts if stale >26h). See `docs/operations/backup-restore-runbook.md`
- Ops Center: super_admin `/admin/ops` + `health/platform-monitor.service.ts` — disk/RAM/Redis/PgBouncer/queues/Sentry/LLM/SLA/backup-heartbeat/channel-tokens/payment-webhooks; raises incidents and alerts by Telegram/email
- Other workflows in `.github/workflows/`: `candidate.yml` (manual, or on a PR labelled `build-candidate-<first 12 chars of head SHA>`: builds images for a commit not on main, never deploys), `release.yml` (release-please: keeps a release PR open on branch `release-please--branches--main`; merging it tags and writes the root `CHANGELOG.md`), `playwright.yml` (browser E2E on PRs touching dashboard/landing/e2e, plus nightly) and `vertical-quality.yml` (vertical evidence tiers `contract|integration|weekly|release`; only the manual `release` tier fails closed on missing external evidence)

## Counters (snapshot 2026-10-30 — recompute, do not copy)

| What | Value | Command |
|------|-------|---------|
| API module files | 101 | `find apps/api/src -name "*.module.ts" \| wc -l` |
| Dashboard pages | 163 | `find apps/dashboard/src/app -name page.tsx \| wc -l` |
| BullMQ queues | 13 | `grep -rn "registerQueue" apps/api/src --include=*.module.ts` |
| `@Cron` decorators | — | `grep -rn "@Cron(" apps/api/src --include=*.ts \| grep -v spec \| wc -l` |
| Prisma models | 49 | `grep -c "^model " apps/api/prisma/schema.prisma` |

## Where to read more

Read only what the task touches. The complete, maintained index is [`docs/README.md`](docs/README.md). Most used:

| Topic | File |
|-------|------|
| Architecture detail (prompt layers, knowledge tiers, router, auth, calendar, BullMQ) | `docs/architecture/architecture-detail.md` |
| Modules, pages, queues, crons (snapshot inventory) | `docs/architecture/modules-reference.md` |
| Business types (generated) | `docs/domain/business-types-catalog.md` |
| Business requirements spec (generated) and format | `docs/domain/business-requirements.md`, `docs/domain/business-requirements-format.md` |
| Approved decisions | `docs/decisions/` |
| Security | `docs/security/security-specification.md`, `docs/security/superadmin-governance.md` |
| Billing and payments | `docs/operations/billing-runbook.md`, `docs/domain/billing-annual-cycle.md`, `docs/domain/stripe-international-subscriptions-2026-09.md`, `docs/domain/tenant-customer-payments-wompi.md` |
| WhatsApp pricing (Meta charges service messages since 2026-10-01) | `docs/domain/whatsapp-meta-pricing-2026-10.md` |
| Operations | `docs/operations/operations-runbook.md`, `docs/operations/observability-manual.md`, `docs/operations/backup-restore-runbook.md`, `docs/operations/deploy-hardening-runbook.md`, `docs/operations/runbooks/` |
| Onboarding decisions and design | `docs/decisions/previas/onboarding-decisions-2026-09.md`, `docs/domain/onboarding-experience-design-2026-09.md` |
| Quality center / Assist | `docs/architecture/agent-quality-center.md`, `docs/architecture/platform-assistant-knowledge.md` |
