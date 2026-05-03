# Architecture — Detailed Reference

Detailed reference for Parallext Engine internals. CLAUDE.md has the high-level picture; this file holds the depth.

---

## Message Flow (full)

```
Customer (WhatsApp/IG/Messenger/Telegram) → Meta Cloud API / Telegram Bot API → WhatsApp Service (port 3002) OR API webhooks
    → API (port 3000) → ConversationsService (orchestrator)
        → IdentityService (resolve/create unified profile)
        → PersonaService (load agent config) → getPersonaForChannel(tenantId, channelType) (select agent by channel)
            → BusinessInfoService (tenant identity) + KnowledgeService (RAG hybrid) + BookingEngine
            → PromptAssemblerService.assemble(config, turnContext) → L1 contract + L2 persona + L3 turn
            → LLMRouter (select model by tier) → LLM Provider → response
        → OutboundQueueService (BullMQ, priority by plan) → ChannelGatewayService → Channel API → Customer

    If handoff triggered:
        → HandoffService → EventEmitter('handoff.escalated') → AgentConsoleGateway (WebSocket /inbox)
        → Human agent responds via Dashboard (port 3001) → AgentConsoleService → Channel API

    Rate limiting:
        → TenantThrottleService (per-plan: starter/pro/enterprise/custom) checks Redis before every job

    Session management:
        → Refresh token rotation (Redis-backed) + idle timeout (60min) + BroadcastChannel multi-tab sync
```

## Module Dependency Flow

```
WhatsappModule → ConversationsModule → [PersonaModule, AIModule, ChannelsModule, HandoffModule, IdentityModule]
                                                                      ↓ (EventEmitter)
                                                              AgentConsoleModule
ChannelsModule provides: ChannelGatewayService, ChannelTokenService, OutboundQueueService, InstagramTokenRefreshService, adapters (WA/IG/Messenger/Telegram/SMS)
ThrottleModule: @Global — TenantThrottleService available everywhere
AnalyticsModule provides: AnalyticsService, DashboardAnalyticsService, AlertsService, ScheduledReportsService, BIApiController
BillingModule provides: BillingService, MercadoPagoAdapter, ReconciliationProcessor, BillingEmailService
FinancialsModule provides: FinancialsService, FinancialSnapshotService (super_admin only)
OffboardingModule provides: OffboardingService, OffboardingCronService (depends on all 5 BullMQ queues)
```

---

## Prompt Architecture (3 layers — Apr 2026 refactor)

The system prompt is ASSEMBLED per turn by `PromptAssemblerService`:

- **Layer 1 (Contract)** — hardcoded universal rules (10 rules) + safety guardrails. Golden rule: "One message, one purpose. Never ask more than one question per message." Sales awareness: guide LLM to connect customer needs to available services. Strict directive handling: "Say EXACTLY this information in a natural way." Also: backend controls flow, LLM is the voice, must cite retrieved knowledge, must use `<turn><language>`, must never leak context tags, anti-repetition (uses message_count in turn context). Identical for every agent.
- **Layer 2 (Persona)** — `<persona>…</persona>` from `PersonaService.buildSystemPrompt(config)`. 100% user configuration (name, role, personality, rules, forbidden topics, handoff triggers, business hours). In `editorMode: 'prompt'`, the user's free-form prompt replaces the guided body but STILL wrapped in `<persona>` so L1/L3 apply.
- **Layer 3 (Turn Context)** — `<turn>…</turn>` structured XML for this specific turn: language (auto-detected), timezone, now, upcoming_days, business_hours_status, business identity, contact profile, booking_state, available_services, retrieved_knowledge (from RAG + tools), message_count.

**Safety guardrails** (Layer 1, always active, cannot be overridden): blocks violence, weapons, illegal activities, self-harm, explicit content, discrimination, drugs, hacking, third-party PII, unqualified legal/financial advice. Response when triggered: "I'm not able to help with that. Is there anything else I can assist you with regarding our products or services?"

**Vertical context**: Layer 3 receives `<vertical_context>` XML block with `customer_noun`, `transaction_noun`, `service_noun` so the LLM uses correct terminology (paciente, no cliente; propiedad, no producto). Contract rule #11 enforces this.

**No prose instructions are mixed with user config.** Dates, language, business info, RAG hits — all appear as structured data inside `<turn>`, never as prepended/appended prose.

---

## 5-Tier Knowledge Architecture (Apr 2026)

1. **Business Identity** — inline in `<turn><business>` (always loaded, ~200 tokens). Managed in Settings → Business Info (extends `companies` table).
2. **Catalog / Inventory** — tools (`search_products`, `get_product`, `check_stock`). Registered when `config.tools.catalog.enabled`.
3. **FAQs** — dedicated `faqs` table + tool `search_faqs`. Full-text TSVECTOR search with ILIKE fallback. Managed in Knowledge → FAQs.
4. **Policies** — versioned `policies` table (unique active per type: shipping/return/warranty/cancellation/terms/privacy) + tool `get_policy`. Never hallucinated. Managed in Settings → Policies.
5. **Knowledge Base (RAG++)** — hybrid search (vector cosine + keyword ILIKE boost) with rerank and configurable `topK` + `similarityThreshold`. Citations in replies: `[FAQ #id]`, `[Policy: type]`, `[Article: title]`.

---

## Test Agent

Any agent can be tested live from the dashboard: `/admin/agent/[id]/test`. Endpoint `POST /api/v1/agent-test/:tenantId/:agentId` processes a message through the full pipeline (no persistence) and returns `reply + debug { systemPrompt, toolCalls, ragHits, tokens, cost, model, latencyMs, turnContext }`. Debug panel has 5 tabs: System Prompt, Tools, RAG, Metrics, Turn Context.

## Language Detection

`LanguageDetectorService` heuristically detects es/en/pt/fr from the inbound message. Default is configured agent language; auto-override when customer switches mid-conversation. Fed into `<turn><language>` so LLM answers in customer's language.

---

## Auth & Session Management

- **Access Token**: 15min JWT, auto-refreshed proactively every 12min
- **Refresh Token**: 8h default, 14d with "Remember Me". Stored in Redis, rotated on each use
- **Replay Detection**: If a refresh token is reused (already revoked), ALL user sessions are revoked
- **Idle Timeout**: 60min with 2-min warning modal + countdown. BroadcastChannel syncs across tabs
- **Logout**: Calls `POST /auth/logout` to revoke token, broadcasts to all tabs
- **Password Change**: Revokes all refresh tokens (force re-login)
- **Redis Keys**: `refresh:{userId}:{tokenId}` with TTL matching token lifetime
- **Roles**: super_admin, tenant_admin, tenant_supervisor, tenant_agent
- **Guards**: `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` on protected endpoints

---

## Channel OAuth Flows

- **Instagram OAuth**: User clicks "Connect" → opens popup to `https://www.instagram.com/oauth/authorize` with `instagram_basic,instagram_manage_messages` scopes → callback page at `/admin/channels/instagram/callback` exchanges code for long-lived token → stored encrypted. Daily cron @6AM refreshes tokens expiring within 30 days
- **Messenger FB SDK**: Page loads Facebook SDK → `FB.login()` with `pages_messaging,pages_manage_metadata` permissions → exchanges short-lived token for page token → stored encrypted. Uses `NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID`
- **BroadcastChannel sync**: OAuth popup results for IG and Messenger propagated to parent dashboard tab via BroadcastChannel API
- **Profile photos**: IG via Basic Display API on connect, Messenger via FB Graph `/me/picture` — displayed in channel overview and inbox

## Calendar System

- **Multi-calendar**: N calendars per tenant, plan-gated (starter:1, pro:3, enterprise:10, custom:999)
- **Calendar assignment model**: Each calendar assigned to staff, service, or general (fallback)
- **3-tier resolution**: service → staff → general when checking availability or creating events
- **Auto meeting links**: Google creates Meet link, Microsoft creates Teams link when service is online
- **Calendar sync on AI booking**: Appointments created by AI push to Google/Microsoft Calendar via `appointment.created` event
- **Event naming**: "Service Name — Customer Name". Description includes customer info + last 5 messages
- **Attendee invites**: Google `sendUpdates:'all'`, Microsoft auto-sends
- **Disconnect protection**: Can't disconnect calendar if future appointments exist (use reassign-disconnect endpoint)
- **Live updates**: WebSocket `appointmentCreated`/`Updated` events refresh dashboard

---

## Observability Stack

- **Logging**: Pino (nestjs-pino) structured JSON with tenantId/userId context. Pretty in dev, JSON in prod. Docker json-file driver, rotation 50MB x 5
- **BullMQ Dashboard**: Bull Board at `/api/v1/admin/queues` (auth via BULL_BOARD_TOKEN query param or X-Admin-Token header)
- **Error Tracking**: Sentry with `@OnWorkerEvent('failed')` on all 4 BullMQ processors
- **Log Viewer**: Dozzle (port 9999) → `logs.parallly-chat.cloud`
- **Endpoint Monitoring**: Uptime Kuma (port 3003) → `status.parallly-chat.cloud`
- **Dashboards**: Grafana (3004) + Loki (3100) + Promtail → `grafana.parallly-chat.cloud`
- **Log Pipeline**: Promtail reads Docker logs → Loki → Grafana queries
- **Log Persistence**: Docker volumes `parallext-api-logs`, `parallext-worker-logs`
- **All bound to 127.0.0.1** — exposed via Cloudflare Tunnel
- **Config files**: `infra/promtail/config.yml`, `infra/docker/docker-compose.prod.yml`
- **Full manual**: `docs/observability-manual.md`

## BullMQ Queues

| Queue | Concurrency | Rate Limit | Purpose |
|-------|------------|-----------|---------|
| outbound-messages | 5 | 20/s | Cross-channel message delivery |
| broadcast-messages | 10 | 80/s | Mass template campaigns |
| automation-jobs | 10 | 30/s | Automation rule actions |
| nurturing | 5 | 10/s | Follow-up sequences |
| conversation-snooze | 1 | — | Delayed wake-up for snoozed conversations |

---

## Pipeline Hardening (Apr 22-23, 2026)

- **conversation.updated_at fix**: `saveMessage` and `saveAiMessage` now UPDATE `conversations.updated_at`. Was frozen at creation time
- **Redis-backed booking state**: Primary store in Redis (1h TTL), PostgreSQL as backup. Loaded from Redis first
- **Conversation mutex**: Redis SETNX lock per conversation prevents race conditions
- **History limited in directive mode**: When booking engine handles, only last 4 messages sent to LLM (not full history)
- **Intent interpreter**: Confirmation no longer returns early, numbered selection, stem matching, single-word names accepted
- **Double booking protection**: Early return when step=booked. Duplicate check before INSERT
- **Greeting skip engine**: Greeting/farewell at idle properly skips booking engine

## Production Resilience (Apr 29, 2026)

Root cause: 3 Prisma instances (API main + API worker + WhatsApp) each defaulting to ~10 DB connections exceeded PgBouncer's pool of 25.

- **PgBouncer tuned**: pool_size 25→50, max_client_conn 500→1000, query_timeout 30→120s
- **PostgreSQL tuned**: max_connections=200, work_mem=8MB, effective_cache_size=512MB
- **Prisma connection limits**: API main=8, API worker=8, WhatsApp=4 (total ≤20)
- **DB retry with backoff**: PrismaService retries up to 5 attempts with exponential backoff
- **Redis connection leak fixes**: WebhooksService and HealthController properly release clients
- **NurturingService**: Transaction timeout 15s→30s + `updated_at > (now() - 73h)` pre-filter
