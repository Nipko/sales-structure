# API (`apps/api`) — Agent Context

NestJS 10 service on port 3000, global prefix `/api/v1` (`src/main.ts`). The worker (`src/worker.main.ts`) boots the same `AppModule` as an application context to run BullMQ processors and crons.

This file only adds what is specific to the API. Repository-wide rules (multi-tenancy, raw SQL, guards, expand-contract migrations, inbound queue, business facts R3–R7, plans, payments, verification commands) live in [`AGENTS.md`](../../AGENTS.md) and are not repeated here. Deeper references:

- [`docs/architecture/modules-reference.md`](../../docs/architecture/modules-reference.md) — per-module inventory (endpoints, services, tables). It is a snapshot: confirm in code.
- [`docs/architecture/architecture-detail.md`](../../docs/architecture/architecture-detail.md) — prompt layers, knowledge tiers, LLM router, auth, calendar, BullMQ.
- [`docs/domain/business-readiness-runtime.md`](../../docs/domain/business-readiness-runtime.md) — what the agent knows about the business and how it is gated.
- `src/modules/billing/README.md` — billing rails and plan catalog.

Counters (modules, queues, crons, Prisma models) drift: recompute them with the commands in `AGENTS.md`.

## Tenant data access

```typescript
// Tenant schema: always through executeInTenantSchema, with ::uuid casts and snake_case columns.
await this.prisma.executeInTenantSchema(schemaName,
    `SELECT id, is_active FROM leads WHERE id = $1::uuid AND contact_id = $2::uuid`,
    [leadId, contactId],
);
// Global tables: the Prisma client (this.prisma.tenant.findUnique(...)).
```

- A new tenant table goes in `prisma/tenant-schema.sql` (new tenants) **and** in an additive Prisma migration that creates it in every existing tenant schema (pattern: `prisma/migrations/20261030160000_add_go_live_gate`). Older modules still create tables lazily (`ensure*Tables`, tolerating `23505`/`42P07`); do not add new lazy tables.
- `COUNT(*)` returns BigInt; the `BigInt.toJSON` polyfill lives in `main.ts` and `worker.main.ts`.

## Adding a module

1. `src/modules/<name>/` with `<name>.module.ts`, service and controller; register it in `app.module.ts` (the worker boots the same module).
2. Protected routes: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)`; super_admin routes need an explicit rule in `packages/shared` roles (deny by default).
3. Cross-module calls that would create a cycle go through `EventEmitter2` (or `forwardRef` when unavoidable, as `mcp/` does with `ConversationsModule`).
4. Background work: a BullMQ queue + processor; anything that sends to a customer goes through the outbound queue / `ProactiveDispatchService`, never a direct provider call.
5. Run `npm run test:bootstrap` — `tsc` does not catch DI errors.

## Module areas

Folder names under `src/modules/`. One line each; details in `modules-reference.md`.

**Infrastructure.** `prisma` (`executeInTenantSchema`), `redis` (get/set/getJson/setJson/`tenantKey`/`isRateLimited`), `health` (Ops Center: `platform-monitor.service.ts` checks and alerts, incidents, storage, Sentry stats, backup heartbeat `backup:last_success`), `throttle` (global `TenantThrottleService`: plan features, limits and rate limits read at runtime; `plan-features.registry.ts` is the schema of `billing_plans.features`), `internal` (service-to-service endpoints used by the WhatsApp app: inbound message, channel-account quota, delivery status), `inbound` (`InboundQueueService`, queue `inbound-messages`, failed-job redrive), `trace` (per-turn traces), `system-updates`, `feature-requests`, `platform-communications`, `platform-notifications`.

**Auth and tenants.** `auth` (JWT + Redis refresh rotation, 2FA and trusted devices, Google OAuth, SAML/SSO in `saml.*`, governed impersonation — see `docs/security/superadmin-governance.md`; real actor resolved by `common/utils/audit-actor.util.ts`), `tenants`, `settings` (`platform_settings`), `invitations`, `offboarding` (offboarding pipeline + `offboarding-cron.service.ts`).

**Message pipeline.** `channels` (adapters per channel in `whatsapp/`, `instagram/`, `messenger/`, `telegram/`, `email/` and `widget.adapter.ts`; `channel-gateway.service.ts`, `channel-token.service.ts` with per-account tokens, `outbound-queue.service.ts`, `proactive-dispatch.service.ts`, `meta-signature.util.ts`, `instagram-token-refresh.service.ts`, `channel-management.controller.ts`), `whatsapp` (Meta webhooks, templates, connection), `widget` (Web Chat: config, public controller, WebSocket gateway), `conversations` (orchestrator; `processIncomingMessage()` is the turn entry point; booking engine, prompt assembler, tool executor, procedure engine), `media-processing` (audio transcription and image description before the LLM call, with quota layers from plan features), `meta-compliance`.

**AI and agent configuration.** `ai` (providers + `router/llm-router.service.ts`, tiers allowed by the plan's `llmTier`, circuit breaker, spend guard), `persona` (multi-agent: `resolvePersonaForChannel`/`getPersonaForChannel(tenantId, channelType, accountId?)`, agent CRUD, built-in and saved templates), `knowledge` (RAG with pgvector + public KB portal), `kb-health`, `faqs`, `policies`, `business-info`, `copilot` (agent assistant in the inbox), `procedures` (SOP graphs run by `conversations/procedure-engine.service.ts`), `mcp` (MCP client and server), `vertical-integrations` (Toast/Mindbody/Cliniko tools).

**Business readiness (R3–R7).** `readiness` (`BusinessFactsService`/`BusinessFactsReader`, `GoLiveService`), `pending-knowledge` (`PendingQuestionsService`), `onboarding-copilot` (`CopilotProposalsService`, proposals only), `rehearsal`. The rules for writing and reading them are in `AGENTS.md` and the ADRs; do not restate them in code comments elsewhere.

**Quality and evaluation.** `quality` (agent quality signals and judge), `simulation` (agent simulation, eval gate, certification and benchmark queues), `evaluation-revision`, `learning`, `vertical-contract-matrix`, `vertical-analytics`. See `docs/architecture/agent-quality-center.md`.

**Human handoff and inbox.** `handoff` (`shouldHandoff` reads the customer's text; the pipeline also honours a reply that promises a human — `promisesHumanHandoff` → `agent_promised_handoff`; skill-based auto-assign and SLA), `agent-console` (WebSocket `/inbox`, availability and SLA escalation, macros, snooze), `operational-notices`, `push`, `slack`.

**CRM and sales.** `crm` (contacts, leads, opportunities, custom attributes, segments, CSV import/export, CRM analytics, AI lead insights, deal approval), `crm-b2b` (organizations, forecasting, deal-rotting cron), `pipeline`, `identity` (cross-channel profiles, merge suggestions, manual merge), `external-crm`, `automation` (rules, nurturing, drips), `recall` (re-contact after a configurable number of days), `broadcast` (campaigns; the self-service editor is WhatsApp-only), `attribution` (CTWA referrals), `reviews` (Google Business Profile), `analytics` (dashboard KPIs, CSAT, alerts, scheduled reports, BI API).

**Commerce and verticals.** `catalog`, `inventory`, `orders`, `offers`, `intake`, `ecommerce` (Shopify/WooCommerce sync), `channel-manager` (external reservation systems), `appointments` (CRUD, availability, reminders, `calendar-integration.service.ts` with Google/Microsoft sync and service → staff → general calendar resolution), `verticals` (`vertical-definitions.ts`, `verticals.service.ts`, staff scheduling, vehicle inventory), and the per-vertical modules `education`, `gyms`, `home-services`, `insurance`, `listings`, `pets`, `photography`, `repair-orders`, `resource-rentals`, `restaurants`, `tours`, `treatment-plans`, `vacation-rental`.

**Billing and finance.** `billing` (subscription lifecycle on the runtime `billing_plans` catalog plus tenant overrides — never hard-code plan names, prices or limits; Wompi + internal recurring engine for Colombia in `recurring/`, Stripe hosted Checkout for other countries and disabled until enabled; Mercado Pago is retired as platform PSP and `payment-provider.factory.ts` fails hard for it; webhooks `POST /billing/webhook/:provider`; `processors/reconciliation.processor.ts`; coupons are `free_months` only), `financials` (SaaS metrics and monthly snapshots, super_admin), `fiscal` (invoices), `tenant-payments` (tenant → customer payment links: Wompi and Mercado Pago with the tenant's own encrypted credentials). See `docs/operations/billing-runbook.md`.

**Platform surface.** `public-api` (API keys, outgoing webhook subscriptions), `webhooks`, `integrations` (integration outbox), `customer-portal` (magic-link portal for end customers), `white-label` (gated by the `whiteLabel` plan feature), `managed` (done-for-you tier, super_admin), `compliance` (legal texts, consent, opt-out, erasure, audit), `media` (uploads and serving, `MEDIA_STORAGE_PATH`), `email`, `email-templates`.

**SMS.** Retired product (ADR 0018): `sms.platform_enabled` defaults to off and credits, checkout and notifications answer `sms_product_retired`; its modules are being removed. Do not build on them.

## Redis keys owned by the API

Besides the ones in `AGENTS.md` (`booking:*`, `lock:conv:*`, `idem:*`, `turn:done:*`):

```
handoff:{tenantId}:{conversationId}      handoff state
tenant_plan:{tenantId}, sub_status:{tenantId}   plan / subscription cache (deleted on change)
offboard:past_due:{tenantId}             past-due grace timer
trusted_device:{userId}:{tokenHash}      trusted-device lookup (2FA skip)
media:{audio|image}:{tenantId}:{YYYY-MM}, media:contact:*, media:conv:*, media:tenant_hour:*, media:cost:*   media quotas
llm:failures:{provider}                  router circuit breaker
ai:stats:{tenantId}:{date}:...           AI usage counters
procedure:{conversationId}, procedures:active:{tenantId}   procedure engine
mcp:tools:{tenantId}                     MCP tool cache
backup:last_success                      backup heartbeat read by the Ops Center
```
