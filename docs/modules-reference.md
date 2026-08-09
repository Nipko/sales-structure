# Modules Reference

Complete reference for all 83 API modules, 139 dashboard pages (126 admin + 13 públicas), 11 BullMQ queues, and 46 cron jobs.

**Last updated:** jul 2026 — Multi-canal por tipo, billing anual + billing-ops, fiscal DIAN (Factus), backup offsite, SMS reseller, Ops Center, gobernanza super_admin

---

## API Modules (83 total)

### Infrastructure (6 modules)

#### 1. prisma
- **Purpose:** Database access layer. PgBouncer-aware connection pooling
- **Services:** `prisma.service.ts`
- **Key method:** `executeInTenantSchema(schema, sql, params)` for per-tenant queries
- **Controller:** None (infrastructure)
- **Notes:** Always use `::uuid` casts on UUID columns. Multi-statement SQL must be split (PgBouncer transaction mode)

#### 2. redis
- **Purpose:** Cache, counters, rate limiting, BullMQ backing store
- **Services:** `redis.service.ts`
- **Key methods:** get/set/del/getJson/setJson/tenantKey/isRateLimited/SETNX
- **Controller:** None (infrastructure)
- **Notes:** noeviction policy (never allkeys-lru). BullMQ jobs must not be silently evicted

#### 3. health (Ops Center)
- **Purpose:** Liveness/readiness + **Centro de Operaciones** del super_admin: monitoreo de plataforma (disco, memoria, colas, SLA, tokens de canal, presupuesto LLM, backups), incidentes, storage por-tenant y umbrales de alerta configurables
- **Services:** `platform-monitor.service.ts` (crons de chequeo + alerting con cooldown vía email/Telegram/SMS; incluye heartbeat de backup en Redis `backup:last_success`, alerta si edad > `backupStaleHours` default 26h), `incident.service.ts` (abrir/ack/resolver, dedup por clave), `platform-storage.service.ts` (disco + storage por-tenant + quota + history), `alert-config.service.ts` (umbrales), `sms-alert.service.ts`, `telegram-alert.service.ts`, `sentry-stats.service.ts`
- **Controller:** `health.controller.ts`
- **Endpoints:**
  - `GET /health` — Liveness (no auth; usado por Docker healthcheck + Uptime Kuma)
  - `GET /health/detailed` — Memoria/CPU/colas/latencias + alertas activas (no auth)
  - `GET /health/llm-providers` — Estado de salud de proveedores LLM (super_admin)
  - `GET /health/storage` — Reporte de almacenamiento de media (super_admin)
  - `GET /health/storage/overview` — Totales de disco + storage (super_admin)
  - `GET /health/storage/tenants` — Storage por-tenant (schema DB + media + quota) (super_admin)
  - `GET /health/storage/history` — Serie histórica para gráfico de tendencia (super_admin)
  - `GET /health/incidents` — Lista de incidentes (filtros status/severity, paginado) (super_admin)
  - `GET /health/incidents/summary` — Conteos por status/severity (super_admin)
  - `POST /health/incidents/:id/ack` — Reconocer incidente (super_admin)
  - `POST /health/incidents/:id/resolve` — Resolver incidente (super_admin)
  - `GET /health/alert-config` — Leer umbrales de alerta (super_admin)
  - `PUT /health/alert-config` — Actualizar umbrales (super_admin)
  - `POST /health/checks/run` — Ejecutar todos los chequeos on-demand (super_admin)
  - `POST /health/media-cleanup` — Limpieza de media huérfana (dryRun por defecto) (super_admin)
- **Cron jobs:**
  - `*/10 * * * *` — checkSystem: disco + memoria
  - `2,7,12,...,57 * * * *` — checkQueues: profundidad/estancamiento de colas BullMQ
  - `8,18,28,38,48,58 * * * *` — checkSlaBreaches: violaciones de SLA de handoff
  - `0 * * * *` — refreshAdmins: refresca emails de super_admins destinatarios de alertas
  - `0 * * * *` — checkChannelTokens: credenciales de canal con refresh fallido
  - `15 3 * * *` — checkStorage: alerta por disco/quota
  - `30 7 * * *` — checkRiskSignals: fallos de pago/webhook, presupuesto LLM y heartbeat de backup
- **Backups:** `pg_dump` corre DENTRO del contenedor `parallext-postgres`; offsite vía rclone a Cloudflare R2; heartbeat `backup:last_success` en Redis. Ver `docs/backup-restore-runbook.md` y `docs/backup-offsite-setup.md`

#### 4. throttle
- **Purpose:** Rate limiting por plan y feature flags. `@Global()` module. Lee `features` de `billing_plans` en runtime (cacheado; invalidado en cambios de plan)
- **Services:** `tenant-throttle.service.ts`, `feature-flags.service.ts`, `plan-features.registry.ts` (registro canónico de claves de `features` + validación)
- **Controller:** None (consumido por otros módulos)
- **5 planes:** emprendedor (USD $21), starter ($49), pro ($129), enterprise ($349), custom. Fuente: `prisma/seed-billing-plans.js` + tabla `billing_plans`
- **Calendar limits:** starter=1, pro=3, enterprise=10, custom=999
- **Multi-cuenta por tipo de canal:** `features.maxChannelAccounts` es un objeto `{ whatsapp, instagram, messenger, telegram, sms }` (default 1 por tipo). Resolución: override por-tenant (`quotaOverrides.maxChannelAccounts`) → feature del plan → default 1. Ej. pro: `{ whatsapp: 2, messenger: 3 }`; custom: `-1` (ilimitado). Consumido por los flujos de conexión de canal para gatear conexiones adicionales del mismo tipo

#### 5. internal
- **Purpose:** Service-to-service message injection (WhatsApp service → API)
- **Controller:** `internal.controller.ts`
- **Auth:** INTERNAL_API_KEY header
- **Endpoints:**
  - `POST /internal/inbound-message` — Inject message into processing pipeline

#### 5b. common/services
- **Purpose:** Shared utilities consumed by multiple modules
- **Services:** `http-request.service.ts` (shared HTTP client with SSRF protection, extracted from webhooks)
- **Controller:** None (infrastructure)
- **Key features:**
  - Blocks private/loopback IP ranges (SSRF prevention)
  - Configurable timeout + retries
  - Consumed by automation HTTP handler + webhook dispatching

---

### Auth & Tenants (6 modules)

#### 6. auth
- **Purpose:** Authentication, authorization, session management, OAuth, 2FA
- **Services:** `auth.service.ts`, `google-auth.service.ts`, `microsoft-auth.service.ts`
- **Strategy:** `jwt.strategy.ts` (Passport JWT)
- **Controller:** `auth.controller.ts`
- **Endpoints:**
  - `POST /auth/login` — Email/password login
  - `POST /auth/signup` — Tenant self-registration
  - `POST /auth/register` — Alternative registration
  - `POST /auth/refresh` — Refresh JWT (rotation + replay detection)
  - `POST /auth/logout` — Logout (revoke refresh token)
  - `POST /auth/me` — Get current user profile
  - `POST /auth/activity-ping` — Heartbeat to extend session (60min timeout)
  - `POST /auth/google` — Google OAuth login (GSI ID token)
  - `GET /auth/microsoft/url` — Get Microsoft OAuth URL
  - `GET /auth/microsoft/callback` — Microsoft OAuth callback
  - `POST /auth/exchange-code` — Exchange one-time OAuth code for tokens
  - `POST /auth/setup-password` — Set password for OAuth users
  - `POST /auth/send-verification` — Send email verification OTP
  - `POST /auth/verify-email` — Verify 6-digit email OTP
  - `POST /auth/complete-onboarding` — Mark onboarding complete
  - `POST /auth/forgot-password` — Request password reset OTP
  - `POST /auth/reset-password` — Reset password with OTP
  - `POST /auth/change-password` — Change password (authenticated)
  - `POST /auth/admin/reset-password` — Admin reset user password
  - `POST /auth/update-profile` — Update user profile
  - `POST /auth/impersonate/:tenantId` — Impersonación gobernada del super_admin. `impersonate(superAdminId, tenantId, {reason, ticketId})`: **motivo obligatorio** (400 sin él), token de 1h con `impersonatedBy`/`impersonationSid`, sesión emparejada (`endImpersonation` mata el refresh en Redis) y **actor real en auditoría** (`super_admin.impersonation_started`, `userId` = super_admin, nunca el usuario impersonado). `common/utils/audit-actor.util.ts` resuelve el actor real en las escrituras hechas durante la impersonación. Sin tenant implícito en modo plataforma; `roles.ts` deny-by-default. Ver `docs/superadmin-governance.md`
  - `GET /auth/tenant/timezone` — Get tenant timezone
  - `POST /auth/tenant/timezone` — Set tenant timezone
  - `GET /auth/users` — List tenant users
  - `PUT /auth/users/:userId/skills` — Update user skill tags
  - `GET /auth/2fa/status` — 2FA enrollment status
  - `POST /auth/2fa/setup` — Generate TOTP secret + QR code
  - `POST /auth/2fa/verify-setup` — Confirm TOTP enrollment
  - `POST /auth/2fa/disable` — Disable 2FA (password required)
  - `POST /auth/2fa/verify` — Verify TOTP/email/backup code at login
  - `POST /auth/2fa/send-email` — Send email OTP fallback
  - `POST /auth/2fa/backup-codes` — Generate/regenerate backup codes
  - `GET /auth/trusted-devices` — List user's trusted devices
  - `DELETE /auth/trusted-devices/:id` — Revoke a trusted device
- **Trusted devices:** When verifying 2FA with `trust_device: true`, a 30-day device token is stored (SHA-256 hash in `trusted_devices` table + Redis fast-lookup). Subsequent logins from trusted devices skip 2FA. Email notification on new trust. Password change revokes all

#### 7. tenants
- **Purpose:** Tenant management (super_admin), platform stats, queue inspection
- **Services:** `tenants.service.ts`
- **Controllers:** `tenants.controller.ts`, `platform-status.controller.ts`
- **Endpoints:**
  - `POST /tenants` — Create tenant
  - `GET /tenants` — List all tenants
  - `GET /tenants/stats` — Platform-wide stats
  - `GET /tenants/platform-billing` — Billing overview
  - `GET /tenants/platform-usage` — Usage overview
  - `GET /tenants/health` — Platform health
  - `GET /tenants/onboarding-funnel` — Signup→onboarding funnel
  - `GET /tenants/llm-stats` — LLM usage stats
  - `GET /tenants/audit-logs` — Cross-tenant audit logs
  - `GET /tenants/:id` — Tenant detail
  - `PATCH /tenants/:id` — Update tenant
  - `GET /tenants/:id/users` — Tenant users
  - `GET /tenants/:id/engagement` — Tenant engagement metrics
  - `POST /tenants/:id/deactivate` — Deactivate tenant
  - `GET /tenants/:id/quota-overrides` — Custom quotas
  - `PUT /tenants/:id/quota-overrides` — Set custom quotas
  - `GET /tenants/:id/feature-flags` — Feature flags
  - `PUT /tenants/:id/feature-flags` — Set feature flags
  - `GET /tenants/queue-jobs/:queueName/:state` — Inspect BullMQ queue
  - `GET /tenants/queue-jobs/:queueName/job/:jobId` — Inspect job
  - `DELETE /tenants/queue-jobs/:queueName/job/:jobId` — Remove job
  - `POST /tenants/queue-jobs/:queueName/job/:jobId/retry` — Retry job
  - `POST /tenants/queue-jobs/:queueName/clean` — Clean queue
  - `GET /platform-status` — Get maintenance mode status
  - `PUT /platform-status` — Update maintenance mode

#### 8. settings
- **Purpose:** Platform settings and API key management (super_admin)
- **Services:** `settings.service.ts`
- **Controller:** `settings.controller.ts`
- **Endpoints:**
  - `GET /settings` — Get platform settings
  - `PUT /settings` — Update platform settings
  - `GET /settings/api-keys` — List LLM provider API keys
  - `POST /settings/api-keys` — Set provider API key
  - `DELETE /settings/api-keys/:provider` — Remove provider key

#### 9. invitations
- **Purpose:** User invitation system (email invite → accept → join tenant)
- **Services:** `invitations.service.ts`
- **Controller:** `invitations.controller.ts`
- **Endpoints:**
  - `GET /tenants/:tenantId/invitations` — List pending invitations
  - `POST /tenants/:tenantId/invitations` — Send invitation email
  - `POST /tenants/:tenantId/invitations/:id/resend` — Resend invitation
  - `DELETE /tenants/:tenantId/invitations/:id` — Revoke invitation
  - `GET /invitations/by-token/:token` — Validate invite token (public)
  - `POST /invitations/by-token/:token/accept` — Accept invite (public)

#### 10. offboarding
- **Purpose:** Tenant lifecycle management (suspend, offboard, purge, reactivate)
- **Services:** `offboarding.service.ts`, `offboarding-cron.service.ts`
- **Controller:** `offboarding.controller.ts`
- **Endpoints:**
  - `POST /offboarding/:tenantId/cancel` — Initiate 7-step offboarding
  - `POST /offboarding/:tenantId/suspend` — Suspend tenant
  - `GET /offboarding/:tenantId/status` — Offboarding status
  - `POST /offboarding/:tenantId/reactivate` — Reactivate tenant
  - `POST /offboarding/:tenantId/reactivate-channels` — Reactivate channels
  - `DELETE /offboarding/:tenantId/purge` — Hard delete all tenant data
  - `POST /offboarding/:tenantId/extend-trial` — Extend trial period
- **Cron jobs:**
  - `*/30 * * * *` — trialExpiryDetector: detect expired trials → past_due (dedup via billing_events)
  - `0 3 * * *` — graceEnforcer: past_due >7d → expired, day 3 soft_lock (dedup via billing_events)
  - `0 4 * * *` — archiveCleaner: drop schemas inactive >90d
  - `0 5 * * *` — purgeStaleInactiveChannels: clean stale channel_accounts >90d inactive
- **Event listeners:**
  - `billing.payment.failed` — Start past_due grace timer in Redis
  - `billing.payment.succeeded` — Clear all grace timers, restore access

#### 10b. saml-sso (in auth/)
- **Purpose:** SAML/SSO enterprise authentication with JIT user provisioning
- **Services:** `saml.service.ts`
- **Strategy:** `multi-saml.strategy.ts` (Passport MultiSaml with `getSamlOptions` callback)
- **Controller:** `saml.controller.ts`
- **Endpoints:**
  - `GET /auth/saml/check` — Check if SSO is forced for email domain
  - `GET /auth/saml/login` — Initiate SAML login flow
  - `POST /auth/saml/acs` — Assertion Consumer Service (SAML callback)
  - `GET /auth/saml/metadata/:tenantId` — SP metadata XML (public)
  - `GET /auth/saml/config` — Get SAML config (tenant_admin, authenticated)
  - `PUT /auth/saml/config` — Update SAML config (tenant_admin, authenticated)
- **Key features:**
  - Config stored in `tenant.settings.saml`
  - Domain-based tenant lookup with Redis cache
  - JIT (Just-In-Time) user provisioning on first SAML login
  - `isSsoForced()` to enforce SSO-only login per tenant

---

### Message Pipeline (6 modules)

#### 11. channels
- **Purpose:** Multi-channel message routing, webhook handling, outbound queue
- **Services:** `channel-gateway.service.ts`, `channel-token.service.ts`, `outbound-queue.service.ts`, `instagram-token-refresh.service.ts`, `webhook-tap.service.ts`
- **Adapters:** `whatsapp/whatsapp.adapter.ts`, `instagram/instagram.adapter.ts`, `messenger/messenger.adapter.ts`, `sms/sms.adapter.ts`, `telegram/telegram.adapter.ts`, `email/email.adapter.ts` (EmailAdapter implementing IChannelAdapter)
- **Email sub-module:** `email/email-channel.service.ts` (config CRUD + thread tracking), `email/email-webhook.controller.ts`
- **Controllers:** `channels.controller.ts` (webhooks), `channel-management.controller.ts` (management), `webhook-tap.controller.ts` (debug)
- **Webhook Endpoints:**
  - `GET /channels/webhook/whatsapp` — WhatsApp verification
  - `POST /channels/webhook/whatsapp` — WhatsApp events
  - `GET /channels/webhook/instagram` — Instagram verification
  - `POST /channels/webhook/instagram` — Instagram events
  - `GET /channels/webhook/messenger` — Messenger verification
  - `POST /channels/webhook/messenger` — Messenger events
  - `POST /channels/webhook/sms/:phoneNumber` — SMS/Twilio
  - `POST /channels/webhook/telegram/:botUsername` — Telegram
  - `POST /channels/email/inbound` — Email inbound (SendGrid/SMTP parse)
- **Management Endpoints:**
  - `GET /channels/overview` — All channels status + agent assignment
  - `GET /channels/:channelType/status` — Channel status
  - `GET /channels/:channelType/config` — Channel config
  - `POST /channels/telegram/connect` — Connect Telegram bot
  - `POST /channels/telegram/test` — Test Telegram bot
  - `DELETE /channels/telegram/disconnect` — Disconnect Telegram
  - `POST /channels/messenger/oauth-connect` — Facebook SDK token exchange
  - `DELETE /channels/messenger/disconnect` — Disconnect Messenger
  - `POST /channels/instagram/oauth-connect` — Instagram OAuth
  - `DELETE /channels/instagram/disconnect` — Disconnect Instagram
  - `POST /channels/sms/connect` — Twilio credentials
  - `GET /channels/sms/status` — SMS status
  - `DELETE /channels/sms/disconnect` — Disconnect SMS
  - `POST /channels/sms/test` — Test SMS
  - > **Nota:** el **canal SMS conversacional fue descartado**. `channels/sms/sms.adapter.ts` (Twilio) queda como legacy; hoy SMS es solo **notificación one-way** (ver módulos `sms-credits` + `sms-notifications`). Los canales conversacionales activos son WhatsApp, Instagram, Messenger, Telegram, Email y Web Chat Widget (`widget/`)
  - **Email Channel:**
    - `GET /channels/email/config` — Email channel config
    - `PUT /channels/email/config` — Update email config (SMTP/SendGrid)
    - `DELETE /channels/email/disconnect` — Disconnect email channel
  - **Multi-cuenta por tipo (jul 2026):**
    - `POST /channels/:channelType/connect` — Conectar una cuenta ADICIONAL del mismo tipo (gateada por `features.maxChannelAccounts[type]`)
    - `DELETE /channels/:channelType/account/:accountId` — Desconectar una cuenta específica por `accountId` (no toca las demás)
    - `GET /channels/overview` y `GET /channels/:channelType/status` devuelven ahora `accounts[]` (una entrada por conexión) con su agente asignado
  - `GET /webhook-tap` — Debug: last captured webhook payload
- **Multi-cuenta por tipo:** N conexiones del mismo tipo (2 números WhatsApp, 2 IG…). Cada conexión es una fila en `channel_accounts` (unique `[channelType, accountId]`) con su propio `access_token` (tokens por-cuenta, sin migración global). `channel-token.service.ts` acepta `accountId` opcional: `getChannelToken(tenantId, channelType, accountId?)`. El binding agente↔conexión vive en `agent_personas.channel_bindings` (`"type:accountId"`); anti-conflación de conversaciones por `accountId`
- **Tenant tables (email):** `email_channel_configs` (id, provider, smtp_config, thread_tracking_enabled), `email_threads` (id, thread_id, conversation_id, subject)
- **BullMQ:** `outbound-messages` queue (concurrency: 5, 3 retries, priority by plan)
- **Cron:** `0 6 * * *` — refreshExpiringSoonTokens: Instagram token refresh (30-day window)

#### 12. whatsapp
- **Purpose:** WhatsApp-specific services (Embedded Signup, templates, messaging)
- **Services:** `whatsapp-connection.service.ts`, `whatsapp-messaging.service.ts`, `whatsapp-template.service.ts`, `whatsapp-template-poll.service.ts`, `whatsapp-webhook.service.ts`, `whatsapp-crypto.service.ts`
- **Controller:** `whatsapp.controller.ts`
- **Endpoints:**
  - `GET /channels/whatsapp/status` — Connection status
  - `GET /channels/whatsapp/config` — WA config
  - `POST /channels/whatsapp/connect/start` — Embedded Signup initiation
  - `POST /channels/whatsapp/connect/complete` — Complete Embedded Signup
  - `POST /channels/whatsapp/disconnect` — Disconnect
  - `GET /channels/whatsapp/templates` — List templates
  - `POST /channels/whatsapp/templates/sync` — Sync from Meta
  - `POST /channels/whatsapp/templates/create` — Create template and submit to Meta for approval
  - `POST /channels/whatsapp/send/template` — Send template message
  - `POST /channels/whatsapp/send/text` — Send text
  - `POST /channels/whatsapp/send/interactive` — Send buttons/lists
  - `POST /channels/whatsapp/send/media` — Send media
  - `POST /channels/whatsapp/send/location` — Send location
- **Cron:** `*/30 * * * *` — pollAll: poll Meta API for template approval status changes

#### 13. conversations
- **Purpose:** Main message orchestrator. Entry point: `processIncomingMessage()`
- **Services:** `conversations.service.ts`, `booking-engine.service.ts`, `intent-interpreter.service.ts`, `language-detector.service.ts`, `prompt-assembler.service.ts`, `pre-chat.service.ts`, `ai-tool-executor.service.ts`, `agent-test.service.ts`
- **AI Tools (14 sets):** `appointment-tools.ts`, `catalog-tools.ts`, `crm-tools.ts`, `education-tools.ts`, `gyms-tools.ts`, `insurance-tools.ts`, `knowledge-tools.ts`, `listings-tools.ts`, `pets-tools.ts`, `restaurants-tools.ts`, `tier3-tools.ts`, `tours-tools.ts`, `treatment-tools.ts`, `vacation-rental-tools.ts`
- **Controllers:** `conversations.controller.ts`, `agent-test.controller.ts`
- **Endpoints:**
  - `GET /conversations/prechat-form/:tenantId` — Get pre-chat form config
  - `POST /conversations/prechat-form/:tenantId` — Save pre-chat form config
  - `POST /conversations/test-message` — Test message through pipeline
  - `POST /agent-test/:tenantId/:agentId` — Test specific agent directly
- **Key features:**
  - Redis mutex per conversation (`lock:conv:{conversationId}`, 30s TTL)
  - 3-tier prompt assembly (L1 contract + safety → L2 persona → L3 turn context)
  - Deterministic booking state machine (select_service → date → time → confirm → booked)
  - Language detection (es/en/pt/fr, mid-conversation switching)
  - History limited to 4 messages in directive (booking) mode

#### 14. handoff
- **Purpose:** Human agent escalation with skill-based routing
- **Services:** `handoff.service.ts`
- **Controller:** `handoff.controller.ts`
- **Endpoints:**
  - `POST /handoff/:conversationId/complete` — Complete handoff
  - `POST /handoff/:conversationId/status` — Check handoff status
- **Key features:**
  - Emits `handoff.escalated` event via EventEmitter2
  - Skill-based routing (`tryAutoAssign` with skill_tags + max_capacity)
  - SLA deadline on conversation_assignments (5 min default)
  - State in Redis (`handoff:{tenantId}:{conversationId}`, 24h TTL)
  - Email notification to assigned agent

#### 15. agent-console
- **Purpose:** Real-time agent workspace (WebSocket + REST) with collision detection
- **Services:** `agent-console.service.ts`, `agent-availability.service.ts`, `canned-responses.service.ts`, `macros.service.ts`, `snooze.service.ts`, `collision-detection.service.ts` (Redis ZSET viewer tracking with heartbeat/cleanup)
- **Gateway:** `agent-console.gateway.ts` (WebSocket `/inbox` namespace)
- **WebSocket Events:** `inbox:handoff`, `inbox:handoff_direct`, `inbox:escalation`, `conversation:viewing_start`, `conversation:viewing_stop`, `conversation:viewing_heartbeat`, `conversation:viewers_update`
- **Controller:** `agent-console.controller.ts`
- **Endpoints:**
  - `GET /agent-console/inbox/:tenantId` — Fetch handoff inbox
  - `GET /agent-console/conversation/:tenantId/:conversationId` — Conversation detail
  - `POST /agent-console/conversation/:tenantId/:conversationId/message` — Send message
  - `POST /agent-console/conversation/:tenantId/:conversationId/note` — Add internal note
  - `GET /agent-console/conversation/:tenantId/:conversationId/suggest` — AI reply suggestion
  - `POST /agent-console/conversation/:tenantId/:conversationId/reopen` — Reopen
  - `PUT /agent-console/conversation/:tenantId/:conversationId/assign` — Assign
  - `PUT /agent-console/conversation/:tenantId/:conversationId/resolve` — Resolve
  - `PUT /agent-console/conversation/:tenantId/:conversationId/snooze` — Snooze
  - `PUT /agent-console/conversation/:tenantId/:conversationId/unsnooze` — Unsnooze
  - `PUT /agent-console/conversation/:tenantId/:conversationId/archive` — Archive
  - `DELETE /agent-console/conversation/:tenantId/:conversationId` — Delete
  - `DELETE /agent-console/conversation/:tenantId/:conversationId/message/:messageId` — Delete message
  - `POST /agent-console/conversations/:tenantId/bulk-archive` — Bulk archive
  - `POST /agent-console/conversations/:tenantId/bulk-delete` — Bulk delete
  - `GET /agent-console/stats/:tenantId/:agentId` — Agent stats
  - `GET /agent-console/canned/:tenantId` — List canned responses
  - `POST /agent-console/canned/:tenantId` — Create canned response
  - `PUT /agent-console/canned/:tenantId/:id` — Update canned response
  - `PUT /agent-console/status/:userId` — Update online status
  - `GET /agent-console/agents/:tenantId/available` — Available agents
  - `GET /agent-console/agents/:tenantId/status` — All agent statuses
  - `GET /agent-console/macros/:tenantId` — List macros
  - `POST /agent-console/macros/:tenantId` — Create macro
  - `PUT /agent-console/macros/:tenantId/:macroId` — Update macro
  - `POST /agent-console/macros/:tenantId/:macroId/execute` — Execute macro
- **Cron jobs:**
  - `*/5 * * * *` — checkInactivity: mark agents idle after 15min
  - `*/2 * * * *` — escalateStaleHandoffs: escalate >5min → `inbox:escalation`

#### 16. copilot
- **Purpose:** AI assistant for human agents (suggestions, summaries, intent)
- **Services:** `copilot.service.ts`
- **Controller:** `copilot.controller.ts`
- **Endpoints:**
  - `POST /copilot/chat` — Agent AI chat assistant
  - `GET /copilot/:conversationId/suggestions` — Reply suggestions
  - `GET /copilot/:conversationId/summary` — Conversation summary
  - `GET /copilot/:conversationId/intent` — Intent analysis
  - `POST /copilot/:conversationId/ask` — Ask question about conversation

---

### AI & Configuration (4 modules)

#### 17. ai
- **Purpose:** LLM routing with task-based model selection, automatic fallback, and circuit breaker
- **Services:** `LLMRouterService` (router), `ToolExecutorService` (function calling executor)
- **Providers:** `OpenAIProvider` (gpt-4o, gpt-4.1-mini), `AnthropicProvider` (claude-sonnet-4-6), `GeminiProvider` (gemini-2.5-flash), `DeepSeekProvider` (deepseek-chat), `XAIProvider` (grok-4-1-fast-non-reasoning)
- **Controller:** None (consumed by conversations)
- **Key features:**
  - Task-based routing: `conversation` vs `tool_calling` with ordered fallback chains
  - MODEL_REGISTRY: 8 models across 4 tiers (premium/high/balanced/budget)
  - Plan-based tier restrictions: starter (tier_3+4), pro (tier_2+3+4), enterprise (all)
  - Circuit breaker: in-memory health + Redis failure counters + EventEmitter2 alerts
  - Unified AI usage tracking: `getUnifiedAiUsage()` aggregates LLM + media + embeddings
  - Cost tracking in Redis per tenant/date/category/provider

#### 18. persona
- **Purpose:** Gestión multi-agente, plantillas, asignación por canal y **por conexión**
- **Services:** `persona.service.ts`
- **Templates:** 6 built-in (Sales Advisor, Support Agent, FAQ Bot, Appointment Scheduler, Lead Qualifier, Blank)
- **Un agente por conexión:** columna `agent_personas.channel_bindings TEXT[]` (índice GIN) con formato `"type:accountId"` (p. ej. `"whatsapp:15551234567"`). `getPersonaForChannel(tenantId, channelType, accountId?)` resuelve: binding exacto `type:accountId` → canal a nivel tipo → default → legacy. Escribir un binding lo remueve de otros agentes (exclusividad); gateado por `features.maxChannelAccounts`
- **Controller:** `persona.controller.ts`
- **Endpoints:**
  - `GET /persona/templates` — List all templates
  - `POST /persona/:tenantId/setup-wizard` — Apply vertical template at onboarding
  - `POST /persona/:tenantId/setup-wizard/skip` — Skip wizard
  - `GET /persona/:tenantId/setup-status` — Wizard status
  - `GET /persona/:tenantId/plan-features` — Plan feature flags
  - `GET /persona/:tenantId/active` — Active persona config
  - `GET /persona/:tenantId/versions` — Config version history
  - `PUT /persona/:tenantId` — Update persona
  - `GET /persona/:tenantId/agents` — List all agents
  - `GET /persona/:tenantId/agents/:agentId` — Agent detail
  - `POST /persona/:tenantId/agents` — Create agent
  - `PUT /persona/:tenantId/agents/:agentId` — Update agent
  - `DELETE /persona/:tenantId/agents/:agentId` — Delete agent
  - `POST /persona/:tenantId/agents/:agentId/duplicate` — Duplicate agent
  - `POST /persona/:tenantId/agents/:agentId/save-template` — Save as template
  - `GET /persona/:tenantId/agent-templates` — List user templates
  - `DELETE /persona/:tenantId/agent-templates/:templateId` — Delete template

#### 19. knowledge
- **Purpose:** RAG with pgvector — hybrid vector + keyword search with citations, feedback tracking
- **Services:** `knowledge.service.ts`
- **Controller:** `knowledge.controller.ts`
- **Endpoints:**
  - `POST /knowledge/documents` — Upload knowledge document
  - `GET /knowledge/documents` — List documents
  - `DELETE /knowledge/documents/:id` — Delete document
  - `POST /knowledge/search` — Semantic search
  - `GET /knowledge/resources/:tenantId` — Tenant resources
  - `GET /knowledge/search/:tenantId` — Tenant search
  - `GET /knowledge/public/:tenantSlug/articles` — Public KB portal (no auth)
  - `GET /knowledge/public/:tenantSlug/articles/:slug` — Single KB article (no auth)
- **Tenant tables:** `kb_feedback` (id, document_id, conversation_id, rating, comment, created_at)

#### 20. business-info
- **Purpose:** Company identity (name, about, phone, email, address, website, socials, logo) — data the AI agent surfaces to customers
- **Services:** `business-info.service.ts`
- **Controller:** `business-info.controller.ts`
- **Endpoints:**
  - `GET /business-info/public/:tenantSlug` — Public business card (no auth)
  - `GET /business-info/:tenantId` — Get primary identity (cached 10min Redis)
  - `PUT /business-info/:tenantId` — Upsert primary identity (syncs to tenant.settings)

---

### CRM & Sales (5 modules)

#### 21. crm
- **Purpose:** Full CRM — contacts, leads, opportunities, custom attributes, segments, scoring, analytics, AI insights, pipeline stages, import/export
- **Services:** `contacts.service.ts`, `activity.service.ts`, `crm-analytics.service.ts`, `crm-insights.service.ts`, `custom-attributes.service.ts`, `import-export.service.ts`, `lead-scoring.service.ts`, `notes.service.ts`, `segments.service.ts`, `tasks.service.ts`
- **Repositories:** `leads.repository.ts`, `opportunities.repository.ts`, `catalog.repository.ts`
- **Controller:** `crm.controller.ts`
- **Endpoints:**
  - **Leads:**
    - `GET /crm/leads/:tenantId` — List leads (search, filter, paginate)
    - `GET /crm/leads/:tenantId/:leadId` — Lead detail
    - `POST /crm/leads/:tenantId` — Create lead
    - `PUT /crm/leads/:tenantId/:leadId` — Update lead
    - `POST /crm/leads/:tenantId/bulk-update` — Bulk update (stage, tag, archive)
    - `DELETE /crm/leads/:tenantId/:leadId` — Archive lead
    - `PUT /crm/leads/:tenantId/:leadId/restore` — Restore archived lead
    - `GET /crm/leads/:tenantId/:leadId/score` — Score breakdown
    - `POST /crm/leads/:tenantId/:leadId/rescore` — Recalculate score
    - `GET /crm/leads/:tenantId/:leadId/insight` — AI-generated lead insight
  - **Opportunities:**
    - `GET /crm/opportunities/:tenantId` — List opportunities
    - `GET /crm/opportunities/:tenantId/:id` — Detail
    - `POST /crm/opportunities/:tenantId` — Create
    - `PUT /crm/opportunities/:tenantId/:id` — Update
    - `PUT /crm/opportunities/:tenantId/:id/request-approval` — Request deal approval
    - `PUT /crm/opportunities/:tenantId/:id/approve` — Approve deal
    - `PUT /crm/opportunities/:tenantId/:id/reject` — Reject deal
  - **Kanban:**
    - `GET /crm/kanban/:tenantId` — Kanban board data
    - `PUT /crm/kanban/:tenantId/:opportunityId/move` — Move card
  - **Notes/Tasks/Timeline:**
    - `GET /crm/notes/:tenantId/:leadId` — Lead notes
    - `POST /crm/notes/:tenantId` — Create note
    - `GET /crm/tasks/:tenantId` — Tasks list
    - `POST /crm/tasks/:tenantId` — Create task
    - `PUT /crm/tasks/:tenantId/:taskId/status` — Update task status
    - `GET /crm/timeline/:tenantId/:leadId` — Lead activity timeline
  - **Custom Attributes:**
    - `GET /crm/custom-attributes/:tenantId` — List definitions
    - `POST /crm/custom-attributes/:tenantId` — Create definition
    - `PUT /crm/custom-attributes/:tenantId/:id` — Update definition
    - `GET /crm/custom-attribute-values/:tenantId/:entityType/:entityId` — Get values
    - `POST /crm/custom-attribute-values/:tenantId/:entityType/:entityId` — Set values
  - **Segments:**
    - `GET /crm/segments/:tenantId` — List segments
    - `POST /crm/segments/:tenantId` — Create segment
    - `PUT /crm/segments/:tenantId/:segmentId` — Update segment
    - `GET /crm/segments/:tenantId/:segmentId/contacts` — Contacts in segment
  - **Import/Export:**
    - `POST /crm/import/:tenantId` — Import CSV
    - `GET /crm/export/:tenantId` — Export CSV
    - `GET /crm/import-template` — Download import template
  - **Pipeline Stages:**
    - `GET /crm/pipeline-stages/:tenantId` — List stages
    - `POST /crm/pipeline-stages/:tenantId` — Create stage
    - `PUT /crm/pipeline-stages/:tenantId/:stageId` — Update stage
    - `DELETE /crm/pipeline-stages/:tenantId/:stageId` — Delete stage
    - `PUT /crm/pipeline-stages/:tenantId/reorder` — Reorder stages
  - **Scoring Config:**
    - `GET /crm/scoring-config/:tenantId` — Get scoring weights
    - `POST /crm/scoring-config/:tenantId` — Update scoring weights
  - **CRM Analytics:**
    - `GET /crm/analytics/:tenantId/overview` — KPIs
    - `GET /crm/analytics/:tenantId/funnel` — Conversion funnel
    - `GET /crm/analytics/:tenantId/velocity` — Pipeline velocity
    - `GET /crm/analytics/:tenantId/win-loss` — Win/loss rate
    - `GET /crm/analytics/:tenantId/leaderboard` — Agent leaderboard
    - `GET /crm/analytics/:tenantId/sources` — Lead source breakdown
  - **Catalog (legacy):**
    - `GET /crm/courses/:tenantId` — Courses
    - `GET /crm/campaigns/:tenantId` — Campaigns
- **Cron:** `0 * * * *` — refreshDynamicSegments: hourly segment membership refresh

#### 22. pipeline
- **Purpose:** Kanban pipeline with automation and SLA tracking
- **Services:** `pipeline.service.ts`, `automation.service.ts`
- **Controller:** `pipeline.controller.ts`
- **Endpoints:**
  - `GET /pipeline/kanban/:tenantId` — Kanban board
  - `GET /pipeline/stages/:tenantId` — Pipeline stages
  - `POST /pipeline/stages/:tenantId` — Create stage
  - `GET /pipeline/deals/:tenantId` — List deals
  - `GET /pipeline/deals/:tenantId/:dealId` — Deal detail
  - `POST /pipeline/deals/:tenantId` — Create deal
  - `PUT /pipeline/deals/:tenantId/:dealId/move` — Move deal
  - `PUT /pipeline/deals/:tenantId/:dealId` — Update deal
  - `GET /pipeline/analytics/:tenantId` — Pipeline analytics
  - `GET /pipeline/sla-violations/:tenantId` — SLA violations
  - `GET /pipeline/automation/:tenantId` — Pipeline automation rules
  - `POST /pipeline/automation/:tenantId` — Create automation rule
  - `PUT /pipeline/automation/:tenantId/:ruleId/toggle` — Toggle rule
  - `DELETE /pipeline/automation/:tenantId/:ruleId` — Delete rule
- **Tenant tables:** `pipelines` (id, name, stages_json, default, created_at)
- **Cron:** `*/5 * * * *` — checkAllTenantSLAs: SLA violation detection

#### 23. identity
- **Purpose:** Unified customer profiles, cross-channel contact linking, merge
- **Services:** `identity.service.ts`
- **Controller:** `identity.controller.ts`
- **Endpoints:**
  - `GET /identity/:tenantId/suggestions` — Merge candidates
  - `POST /identity/:tenantId/suggestions/:id/approve` — Approve merge
  - `POST /identity/:tenantId/suggestions/:id/reject` — Reject suggestion
  - `GET /identity/:tenantId/profiles/:profileId` — Unified profile
  - `POST /identity/:tenantId/manual-merge` — Manual merge (contactIdA + contactIdB)

#### 24. external-crm
- **Purpose:** External CRM integration (HubSpot, Pipedrive) with OAuth + bidirectional sync + import
- **Services:** `external-crm.service.ts`, `crm-import.service.ts`, `crm-crypto.service.ts`
- **Adapters:** `hubspot.adapter.ts`, `pipedrive.adapter.ts`
- **Processors:** `external-crm.processor.ts`, `crm-import.processor.ts`
- **Controller:** `external-crm.controller.ts`
- **Endpoints:**
  - `GET /external-crm/providers` — List available CRM providers
  - `GET /external-crm/:tenantId/connections` — Active connections
  - `POST /external-crm/:tenantId/connect/:provider` — Connect CRM (OAuth)
  - `GET /external-crm/callback/:provider` — OAuth callback
  - `POST /external-crm/:tenantId/connections/:id/test` — Test connection
  - `DELETE /external-crm/:tenantId/connections/:id` — Disconnect
  - `GET /external-crm/:tenantId/connections/:id/import/preview` — Import preview
  - `POST /external-crm/:tenantId/connections/:id/import/start` — Start import
  - `GET /external-crm/:tenantId/imports/:importId` — Import status
  - `GET /external-crm/:tenantId/connections/:id/imports` — Import history
- **BullMQ queues:**
  - `crm-sync` (concurrency: 10) — bidirectional CRM sync
  - `crm-import` (concurrency: 2) — batch contact import

#### 25. automation
- **Purpose:** Event-driven automation rules, nurturing sequences, drip campaigns, HTTP actions, template library
- **Services:** `automation.service.ts`, `automation-listener.service.ts`, `nurturing.service.ts`, `action-executor.service.ts`, `drip-sequence.service.ts` (drip sequence CRUD + enrollment management), `templates/automation-templates.service.ts` (template library CRUD + install)
- **Handlers:** `handlers/http-request.handler.ts` (HTTP request action executor)
- **Utils:** `utils/variable-interpolator.ts` ({{variable}} replacement), `utils/response-extractor.ts` (JSONPath response mapping)
- **Controllers:** `automation.controller.ts`, `drip-sequence.controller.ts`, `templates/automation-templates.controller.ts`
- **Endpoints:**
  - `GET /automation/rules/:tenantId` — List rules
  - `POST /automation/rules/:tenantId` — Create rule
  - `PUT /automation/rules/:tenantId/:ruleId` — Update rule
  - `PUT /automation/rules/:tenantId/:ruleId/toggle` — Toggle active
  - `GET /automation/rules/:tenantId/:ruleId/executions` — Execution history
  - `DELETE /automation/rules/:tenantId/:ruleId` — Delete rule
  - **Drip Sequences:**
    - `GET /automation/drip-sequences/:tenantId` — List drip sequences
    - `POST /automation/drip-sequences/:tenantId` — Create drip sequence
    - `GET /automation/drip-sequences/:tenantId/:sequenceId` — Sequence detail
    - `PUT /automation/drip-sequences/:tenantId/:sequenceId` — Update sequence
    - `DELETE /automation/drip-sequences/:tenantId/:sequenceId` — Delete sequence
    - `POST /automation/drip-sequences/:tenantId/:sequenceId/enroll` — Enroll contacts
    - `POST /automation/drip-sequences/:tenantId/:sequenceId/unenroll` — Unenroll contacts
    - `PUT /automation/drip-sequences/:tenantId/:sequenceId/toggle` — Toggle active
  - **Template Library:**
    - `GET /automation/templates` — List automation templates
    - `GET /automation/templates/:templateId` — Template detail
    - `POST /automation/templates/:templateId/install` — Install template into tenant
- **Tenant tables:** `drip_sequences` (id, name, steps[], active), `drip_enrollments` (id, sequence_id, contact_id, current_step, status), `automation_secrets` (id, key, encrypted_value)
- **Global tables:** `automation_templates` (id, name, description, category, definition, install_count)
- **BullMQ queues:**
  - `automation-jobs` (concurrency: 10, 3 retries) — deferred rule actions
  - `nurturing` (rate-limited) — lead nurturing sequences
- **Cron jobs:**
  - `0 */6 * * *` — autoResolveStale: auto-resolve stale nurturing (72h)
  - `0 */2 * * *` — checkStaleConversationsAllTenants: detect stale conversations

---

### Billing & Finance (4 modules)

#### 26. billing
- **Purpose:** Ciclo de vida de suscripción, integración MercadoPago (Stripe alternativo), facturas, cupones, **ciclo mensual/anual (~15% desc)**, panel billing-ops cross-tenant (super_admin) y compra de paquetes de créditos SMS
- **Services:** `billing.service.ts`, `billing-email.service.ts`, `invoice-generator.service.ts`, `coupons.service.ts`, `payment-provider.factory.ts`, `sms-checkout.service.ts`
- **Adapters:** `mercadopago.adapter.ts`, `mercadopago-config.service.ts`, `stripe.adapter.ts`, `stripe-config.service.ts`, `mock-payment-provider.adapter.ts`
- **Processors:** `reconciliation.processor.ts`
- **Controllers:** `billing.controller.ts` (tenant), `billing-admin.controller.ts` (super_admin, billing-ops), `billing-public.controller.ts` (catálogo público), `coupons.controller.ts`, `sms-checkout.controller.ts`, `webhook.controller.ts`
- **Ciclo anual (~15% desc):** el anual crea un `preapproval_plan` de MP separado; su id se guarda en `priceLocalOverrides[country].annual.mpPlanId`. El precio en DB (editable vía `PUT /billing-admin/plans/:slug`) es solo lo que se MUESTRA; MP cobra el monto congelado en el `preapproval_plan`, así que un cambio de precio no es efectivo hasta correr `sync-mp`. Ver `docs/billing-annual-cycle.md`
- **Tenant endpoints (`/billing`):**
  - `GET /billing/plans` — Lista de planes (con overrides por país/moneda + anual)
  - `GET /billing/:tenantId/subscription` — Suscripción actual
  - `POST /billing/:tenantId/subscription` — Crear suscripción
  - `POST /billing/:tenantId/subscription/upgrade` — Cambiar de plan
  - `POST /billing/:tenantId/subscription/cancel|pause|resume` — Cancelar/pausar/reanudar
  - `POST /billing/:tenantId/subscription/payment-method` — Actualizar medio de pago
  - `POST /billing/:tenantId/subscription/cancel-pending-downgrade` — Cancelar downgrade pendiente
  - `POST /billing/:tenantId/subscription/sync` — Forzar sync con el proveedor
  - `GET /billing/:tenantId/usage` — Uso de cuotas del plan (incluye media: audio/imagen usado/límite/%, costo diario)
  - `GET /billing/:tenantId/restriction-status` — Estado de restricción (past_due/soft_lock)
  - `GET /billing/:tenantId/payments/:paymentId/invoice` — Descargar factura PDF
- **Public / catálogo:**
  - `GET /billing/public/plans` — Catálogo de planes público (para la landing `/precios` data-driven)
- **Billing-ops (super_admin, `/billing-admin`) — ~15 endpoints:**
  - `GET /billing-admin/plans` — Lista de planes con conteo de tenants + claves de feature desconocidas
  - `GET /billing-admin/feature-registry` — Registro canónico de claves de `features`
  - `GET /billing-admin/plans/:slug` — Detalle de plan
  - `PUT /billing-admin/plans/:slug` — Editar plan (features validadas + merge, precio, overrides país/anual; con auditoría before→after)
  - `POST /billing-admin/plans/:slug/invalidate-cache` — Invalidar caché de plan/features
  - `POST /billing-admin/plans/:slug/sync-mp` — Registrar/recrear el `preapproval_plan` de MP para plan+país (reemplaza el script SSH)
  - `GET /billing-admin/provider-status` — Badge sandbox/producción de MP
  - `POST /billing-admin/reconcile` — Reconciliación on-demand (scope past_due|full)
  - `POST /billing-admin/tenants/:tenantId/reconcile` — Reconciliar un tenant contra el proveedor
  - `GET /billing-admin/subscriptions` — Vista cross-tenant de suscripciones (filtros + paginado)
  - `GET /billing-admin/payments` — Vista cross-tenant de pagos
  - `GET /billing-admin/events` — Vista cross-tenant de billing_events
  - `POST /billing-admin/payments/:paymentId/refund` — Reembolso inline
  - `POST /billing-admin/tenants/:tenantId/comp-plan` — Otorgar plan de cortesía (time-boxed, motivo obligatorio)
  - `PUT /billing-admin/tenants/:tenantId/plan` — Cambio permanente de plan (override de entitlement; invalida cachés + auditoría)
- **Cupones (`/billing-coupons`):** `GET|POST /admin`, `PUT|DELETE /admin/:id`, `GET /admin/:id/redemptions`, `POST /validate/:tenantId`, `POST /redeem/:tenantId` (percent_off / amount_off / free_months)
- **Créditos SMS (`sms-checkout` → path `/sms-credits`):** `POST /sms-credits/:tenantId/checkout` (compra de paquete, pago único MP), `GET /sms-credits/:tenantId/orders` (historial de compras)
- **Webhook:** `POST /billing/webhook/:provider` — Webhook del proveedor (HMAC verificado + idempotencia)
- **Cron jobs:**
  - `EVERY_HOUR` — reconcilePastDue: barrido de suscripciones en mora
  - `0 3 * * *` — fullReconciliation: detección diaria de drift
  - `30 2 * * *` — applyPendingDowngrades: aplica downgrades programados
  - `0 9 * * *` — emitTrialEndingSoon: notificaciones de fin de trial

#### 27. financials
- **Purpose:** SaaS metrics dashboard (MRR, ARR, ARPU, churn, LTV, forecast)
- **Services:** `financials.service.ts`, `financial-snapshot.service.ts`
- **Controller:** `financials.controller.ts` (super_admin only)
- **Endpoints:**
  - `GET /financials/overview` — MRR, ARR, ARPU, LTV
  - `GET /financials/mrr-trend` — MRR trend
  - `GET /financials/revenue` — Revenue breakdown
  - `GET /financials/churn-trend` — Churn rate trend
  - `GET /financials/costs` — Platform costs
  - `GET /financials/tenant-profitability` — Per-tenant P&L
  - `GET /financials/trial-metrics` — Trial conversion
  - `GET /financials/infra-costs` — Infrastructure costs
  - `POST /financials/infra-costs` — Update infra cost
  - `POST /financials/exchange-rates` — Set exchange rates
  - `GET /financials/forecast` — MRR forecast (linear regression + 95% CI)
  - `GET /financials/llm-usage` — LLM cost breakdown from Redis
  - `POST /financials/snapshot/generate` — Manual snapshot trigger
  - `GET /financials/export/revenue.csv` — Export revenue CSV
  - `GET /financials/export/costs.csv` — Export costs CSV
  - `GET /financials/export/tenant-profitability.csv` — Export P&L CSV
- **Cron:** `0 1 1 * *` — generateMonthlySnapshot: 1st of month @1AM

#### 27b. stripe-adapter (in billing/)
- **Purpose:** Stripe payment provider adapter (alternative to MercadoPago)
- **Services:** `stripe.adapter.ts` (implements `IPaymentProvider`)
- **Factory:** `payment-provider.factory.ts` — routes between Stripe and MercadoPago based on tenant config
- **Controller:** None (consumed via PaymentProviderFactory)
- **Key methods:**
  - `createCustomer()` — Create Stripe customer
  - `createSubscription()` — Create recurring subscription
  - `cancelSubscription()` — Cancel active subscription
  - `createCheckoutSession()` — Generate Stripe Checkout URL
  - `constructWebhookEvent()` — Verify + parse Stripe webhook (signature validation)
- **Notes:** Tenant config determines which provider is active. Both Stripe and MercadoPago implement the same `IPaymentProvider` interface

---

### Analytics (1 module, multiple controllers)

#### 28. analytics
- **Purpose:** Platform analytics, BI API, alerts, CSAT, compliance audit, scheduled reports, custom report builder
- **Services:** `analytics.service.ts`, `dashboard-analytics.service.ts`, `agent-analytics.service.ts`, `alerts.service.ts`, `audit.service.ts`, `compliance.service.ts`, `csat-trigger.service.ts`, `metrics-aggregation.service.ts`, `scheduled-reports.service.ts`, `saved-reports.service.ts`
- **Controllers:** `analytics.controller.ts`, `dashboard-analytics.controller.ts`, `agent-analytics.controller.ts`, `alerts.controller.ts`, `bi-api.controller.ts`
- **Dashboard Analytics Endpoints:**
  - `GET /dashboard-analytics/overview-kpis/:tenantId`
  - `GET /dashboard-analytics/conversations-volume/:tenantId`
  - `GET /dashboard-analytics/response-times/:tenantId`
  - `GET /dashboard-analytics/ai-metrics/:tenantId`
  - `GET /dashboard-analytics/heatmap/:tenantId`
  - `GET /dashboard-analytics/export/:tenantId` — CSV export
  - `GET /dashboard-analytics/realtime/:tenantId`
  - `GET /dashboard-analytics/automation/:tenantId`
  - `GET /dashboard-analytics/broadcast/:tenantId`
  - `GET /dashboard-analytics/anomalies/:tenantId` — Z-score detection
  - `GET /dashboard-analytics/cohorts/:tenantId` — Retention matrix
  - `GET /dashboard-analytics/appointments/:tenantId`
- **Agent Analytics Endpoints:**
  - `GET /agent-analytics/overview/:tenantId`
  - `GET /agent-analytics/agents/:tenantId`
  - `GET /agent-analytics/csat/:tenantId`
  - `GET /agent-analytics/csat/:tenantId/distribution`
  - `POST /agent-analytics/csat/:tenantId` — Submit CSAT
  - `GET /agent-analytics/:tenantId/channels`
  - `GET /agent-analytics/:tenantId/overview-series`
  - `GET /agent-analytics/:tenantId/performance`
- **Legacy Analytics Endpoints:**
  - `GET /analytics/commercial-overview/:tenantId`
  - `GET /analytics/overview/:tenantId`
  - `GET /analytics/dashboard/:tenantId`
  - `GET /analytics/pipeline/:tenantId`
  - `GET /analytics/conversations/:tenantId`
  - `GET /analytics/crm/:tenantId`
  - `GET /analytics/whatsapp/:tenantId`
  - `GET /analytics/ai/:tenantId`
  - `GET /analytics/campaigns/:tenantId`
  - `GET /analytics/funnel/:tenantId`
  - `GET /analytics/compliance/:tenantId`
  - `GET /analytics/audit/:tenantId`
- **Alerts & Reports Endpoints:**
  - `GET /analytics-config/alerts/:tenantId` — List rules
  - `POST /analytics-config/alerts/:tenantId` — Create rule
  - `PUT /analytics-config/alerts/:tenantId/:ruleId` — Update rule
  - `DELETE /analytics-config/alerts/:tenantId/:ruleId` — Delete rule
  - `GET /analytics-config/alerts/:tenantId/:ruleId/history` — Alert history
  - `GET /analytics-config/reports/:tenantId` — Scheduled reports
  - `POST /analytics-config/reports/:tenantId` — Create scheduled report
- **Custom Report Builder Endpoints:**
  - `GET /analytics-config/saved-reports/:tenantId` — List saved reports
  - `GET /analytics-config/saved-reports/:tenantId/:reportId` — Get saved report
  - `POST /analytics-config/saved-reports/:tenantId` — Create saved report
  - `PUT /analytics-config/saved-reports/:tenantId/:reportId` — Update saved report
  - `DELETE /analytics-config/saved-reports/:tenantId/:reportId` — Delete saved report
- **BI API Endpoints (X-API-Key auth, no JWT):**
  - `GET /bi-api/kpis`
  - `GET /bi-api/time-series`
  - `GET /bi-api/ai-metrics`
  - `GET /bi-api/realtime`
  - `GET /bi-api/export`
  - `GET /bi-api/anomalies`
  - `GET /bi-api/cohorts`
- **Cron jobs:**
  - `*/15 * * * *` — evaluateAlerts: threshold rule evaluation
  - `0 2 * * *` — aggregateYesterday: nightly metrics aggregation
  - `0 8 * * 1` — sendWeeklyReports
  - `0 8 1 * *` — sendMonthlyReports
  - `10 * * * *` — sendPostAppointmentCSAT: post-appointment survey

---

### Scheduling (1 module)

#### 29. appointments
- **Purpose:** Appointments, services, availability, calendar integration, reminders, public booking
- **Services:** `appointments.service.ts`, `services.service.ts`, `calendar-integration.service.ts`, `appointment-notifications.service.ts`, `appointment-reminders.service.ts`
- **Controllers:** `appointments.controller.ts`, `calendar-callback.controller.ts`, `public-booking.controller.ts`
- **Endpoints:**
  - **Services:**
    - `GET /appointments/:tenantId/services` — List services
    - `POST /appointments/:tenantId/services` — Create service
    - `PUT /appointments/:tenantId/services/:serviceId` — Update
    - `DELETE /appointments/:tenantId/services/:serviceId` — Delete
    - `GET /appointments/:tenantId/services/:serviceId/staff` — Staff list
    - `POST /appointments/:tenantId/services/:serviceId/staff` — Assign staff
    - `DELETE /appointments/:tenantId/services/:serviceId/staff/:userId` — Unassign
  - **Calendar:**
    - `GET /appointments/:tenantId/calendar/integrations` — Connected calendars
    - `PUT /appointments/:tenantId/calendar/:id/assignment` — Calendar assignment
    - `GET /appointments/:tenantId/calendar/events` — Calendar events
    - `GET /appointments/:tenantId/calendar/google/connect` — Google OAuth
    - `GET /appointments/:tenantId/calendar/microsoft/connect` — Microsoft OAuth
    - `DELETE /appointments/:tenantId/calendar/:id` — Disconnect calendar
    - `POST /appointments/:tenantId/calendar/:id/reassign-disconnect` — Reassign + disconnect
    - `GET /calendar/google/callback` — Google OAuth callback
    - `GET /calendar/microsoft/callback` — Microsoft OAuth callback
  - **Availability:**
    - `GET /appointments/:tenantId/bookable-slots` — Bookable time slots
    - `GET /appointments/:tenantId/availability` — Availability config
    - `POST /appointments/:tenantId/availability` — Set availability
    - `GET /appointments/:tenantId/blocked-dates` — Blocked dates
    - `POST /appointments/:tenantId/blocked-dates` — Block date
    - `DELETE /appointments/:tenantId/blocked-dates/:dateId` — Unblock
    - `GET /appointments/:tenantId/check-slots` — Check specific slots
  - **Appointments CRUD:**
    - `GET /appointments/:tenantId` — List appointments
    - `POST /appointments/:tenantId` — Create appointment
    - `PUT /appointments/:tenantId/:id` — Update
    - `PUT /appointments/:tenantId/:id/cancel` — Cancel
    - `GET /appointments/:tenantId/:id` — Detail
  - **Recurring:**
    - `POST /appointments/:tenantId/recurring` — Create recurring
    - `GET /appointments/:tenantId/recurring/:groupId` — Get series
    - `PUT /appointments/:tenantId/recurring/:groupId/cancel` — Cancel series
  - **Public Booking Config:**
    - `GET /appointments/:tenantId/public-booking-config` — Config
    - `POST /appointments/:tenantId/public-booking-config` — Update config
  - **Public Booking (no auth):**
    - `GET /booking/:tenantSlug/info` — Tenant info
    - `GET /booking/:tenantSlug/services` — Available services
    - `GET /booking/:tenantSlug/services/:serviceId` — Service detail
    - `GET /booking/:tenantSlug/slots` — Available slots
    - `POST /booking/:tenantSlug/book` — Book appointment
- **Cron jobs:**
  - `*/15 * * * *` — send24hReminders
  - `3,18,33,48 * * * *` — send1hReminders
  - `5,35 * * * *` — markNoShows
  - `20 * * * *` — autoCompleteAppointments (ended 2+h ago)
  - `0 */12 * * *` — renewWatchChannels: renew Google Calendar push channels

---

### Operations (8 modules)

#### 30. broadcast
- **Purpose:** Multi-channel mass campaigns via WhatsApp, Email, and SMS with A/B testing
- **Services:** `broadcast.service.ts`, `ab-test.service.ts` (variant management, recipient assignment, z-test significance, auto-winner selection)
- **Controller:** `broadcast.controller.ts`
- **Processor:** `broadcast-queue.processor.ts` — Dispatches per channel (WA template send, Email SMTP, SMS Twilio)
- **Endpoints:**
  - `POST /broadcast/campaigns` — Create campaign (supports multi-channel: channels[], channelContent per channel)
  - `POST /broadcast/campaigns/:id/launch` — Launch campaign (queues per-recipient per-channel jobs)
  - `GET /broadcast/campaigns` — List campaigns with stats
  - `GET /broadcast/campaigns/:id/stats` — Campaign stats per channel (sent→delivered→read→failed)
  - **A/B Testing:**
    - `GET /broadcast/campaigns/:id/variants` — List campaign variants with performance stats
    - `POST /broadcast/campaigns/:id/winner` — Select winning variant (manual or auto via z-test)
- **Tenant tables:** `campaign_variants` (id, campaign_id, name, content, traffic_pct, stats_json)
- **Multi-channel:** UI supports WA + Email + SMS selection, smart recipient resolution (WA→Email→SMS fallback based on contact info), per-channel content (template/subject+html/body), per-channel delivery stats
- **BullMQ:** `broadcast-messages` (concurrency: 10, 80 msg/s rate limit)
- **Cron:** `* * * * *` — Auto-launch scheduled campaigns

#### 31. email
- **Purpose:** Transactional email via nodemailer
- **Services:** `email.service.ts` (includes `email-layouts.ts` for branded templates)
- **Controller:** None (infrastructure)

#### 32. email-templates
- **Purpose:** CRUD email templates with variable rendering and test send
- **Services:** `email-templates.service.ts`
- **Controller:** `email-templates.controller.ts`
- **Endpoints:**
  - `GET /email-templates/:tenantId` — List (auto-seeds 4 defaults)
  - `GET /email-templates/:tenantId/:templateId` — Detail
  - `POST /email-templates/:tenantId` — Create
  - `PUT /email-templates/:tenantId/:templateId` — Update
  - `DELETE /email-templates/:tenantId/:templateId` — Delete
  - `POST /email-templates/:tenantId/:templateId/test` — Send test email

#### 33. media
- **Purpose:** Image upload (multer + sharp → WebP), resize, logo, tags, public serve
- **Services:** `media.service.ts`
- **Controller:** `media.controller.ts`
- **Endpoints:**
  - `POST /media/upload/:tenantId` — Upload file
  - `POST /media/logo/:tenantId` — Upload company logo
  - `GET /media/list/:tenantId` — List files
  - `GET /media/tags/:tenantId` — List tags
  - `PUT /media/update/:tenantId/:fileId` — Update metadata
  - `DELETE /media/delete/:tenantId/:fileId` — Delete file
  - `GET /media/file/:tenantId/:fileName` — Serve file (public, no auth)
  - `GET /media/health` — Storage health

#### 34. compliance
- **Purpose:** Privacy & consent management, opt-outs, legal texts (multi-channel, multi-agent, typed), GDPR/LGPD erasure
- **Services:** `compliance.service.ts`
- **Controller:** `compliance.controller.ts`
- **Legal text types:** general, privacy_policy, terms_of_service, consent_to_process, ai_disclosure, opt_in_message, opt_out_confirmation
- **Legal text fields:** name, description, type, channels (TEXT[]), agent_ids (UUID[]), version, text, active
- **Endpoints:**
  - `GET /compliance/legal-texts/:tenantId` — List legal texts (ordered by updated_at)
  - `POST /compliance/legal-texts/:tenantId` — Create legal text (name, type, channels[], agent_ids[], text)
  - `PUT /compliance/legal-texts/:tenantId/:id` — Update legal text
  - `DELETE /compliance/legal-texts/:tenantId/:id` — Delete legal text
  - `GET /compliance/consents/:tenantId` — Consent records (optional leadId filter)
  - `POST /compliance/consents/:tenantId` — Record consent
  - `GET /compliance/opt-outs/:tenantId` — Opt-out list (status filter, pagination)
  - `GET /compliance/opt-outs/:tenantId/stats` — Opt-out statistics
  - `PUT /compliance/opt-outs/:tenantId/:id/confirm` — Confirm opt-out (with notes)
  - `PUT /compliance/opt-outs/:tenantId/:id/reject` — Reject opt-out (false positive, with notes)
  - `POST /compliance/opt-outs/:tenantId` — Manual opt-out
  - `GET /compliance/deletion-requests/:tenantId` — Deletion requests
  - `POST /compliance/deletion-requests/:tenantId` — Create deletion request
  - `PUT /compliance/deletion-requests/:tenantId/:id/process` — Process deletion (GDPR Art. 17 erasure)
  - `GET /compliance/audit-log/:tenantId` — Compliance audit log
  - `GET /compliance/admin/overview` — Cross-tenant compliance overview (super_admin)
  - `POST /compliance/admin/export-contact-data/:tenantId/:contactId` — GDPR data export (super_admin)
  - `POST /compliance/erase-contact/:tenantId/:contactId` — GDPR erasure (anonymizes 11 tables)

#### 35. inventory
- **Purpose:** Product stock management
- **Services:** `inventory.service.ts`
- **Controller:** `inventory.controller.ts`
- **Endpoints:**
  - `GET /inventory/overview/:tenantId` — Stock overview
  - `GET /inventory/products/:tenantId` — Product list
  - `POST /inventory/products/:tenantId` — Create product
  - `PUT /inventory/products/:tenantId/:productId` — Update product
  - `POST /inventory/products/:tenantId/:productId/stock` — Adjust stock
  - `POST /inventory/categories/:tenantId` — Create category

#### 36. orders
- **Purpose:** Order tracking and lifecycle
- **Services:** `orders.service.ts`
- **Controller:** `orders.controller.ts`
- **Endpoints:**
  - `GET /orders/overview/:tenantId` — Orders overview
  - `GET /orders/contacts/:tenantId` — Orders by contact
  - `POST /orders/:tenantId` — Create order
  - `PUT /orders/:tenantId/:orderId/status` — Update status
  - `GET /orders/:tenantId/:orderId/invoice` — Generate invoice

#### 37. offers
- **Purpose:** Promotional offers management
- **Services:** `offers.service.ts`
- **Controller:** `offers.controller.ts`
- **Endpoints:**
  - `GET /offers/:tenantId` — List offers
  - `GET /offers/:tenantId/:id` — Detail
  - `POST /offers/:tenantId` — Create
  - `PUT /offers/:tenantId/:id` — Update
  - `DELETE /offers/:tenantId/:id` — Delete

#### 38. recall
- **Purpose:** Re-engagement campaigns for dormant contacts
- **Services:** `recall.service.ts`
- **Controller:** `recall.controller.ts`
- **Endpoints:**
  - `GET /recall/:tenantId/config` — Campaign config
  - `PUT /recall/:tenantId/config` — Update config
  - `POST /recall/:tenantId/run-now` — Manual trigger
- **Cron:** `0 9 * * *` — processRecalls: daily re-engagement

---

### Content & Legal (3 modules)

#### 39. faqs
- **Purpose:** First-class Q&A pairs with categories and public endpoint
- **Services:** `faqs.service.ts`
- **Controller:** `faqs.controller.ts`
- **Endpoints:**
  - `GET /faqs/public/:tenantSlug` — Public FAQ list (no auth)
  - `GET /faqs/:tenantId` — List FAQs
  - `GET /faqs/:tenantId/:id` — Detail
  - `POST /faqs/:tenantId` — Create
  - `PUT /faqs/:tenantId/:id` — Update
  - `DELETE /faqs/:tenantId/:id` — Delete

#### 40. policies
- **Purpose:** Versioned legal/operational policies (return, privacy, cancellation, etc.)
- **Services:** `policies.service.ts`
- **Controller:** `policies.controller.ts`
- **Endpoints:**
  - `GET /policies/public/:tenantSlug/:type` — Public policy (no auth)
  - `GET /policies/:tenantId` — List policies
  - `GET /policies/:tenantId/:type` — Get policy by type
  - `GET /policies/:tenantId/:type/versions` — Version history
  - `POST /policies/:tenantId` — Create/update
  - `DELETE /policies/:tenantId/:id` — Delete

#### 41. catalog
- **Purpose:** Generic product/course/campaign catalog
- **Services:** `catalog.service.ts`
- **Controller:** `catalog.controller.ts`
- **Endpoints:**
  - `GET /catalog/courses/:tenantId` — Courses
  - `GET /catalog/courses/:tenantId/:id` — Course detail
  - `POST /catalog/courses/:tenantId` — Create course
  - `PUT /catalog/courses/:tenantId/:id` — Update
  - `GET /catalog/campaigns/:tenantId` — Campaigns
  - `GET /catalog/campaigns/:tenantId/:id` — Campaign detail
  - `POST /catalog/campaigns/:tenantId` — Create campaign
  - `PUT /catalog/campaigns/:tenantId/:id` — Update
  - `GET /catalog/offers/:tenantId` — Offers
  - `POST /catalog/offers/:tenantId` — Create offer

---

### Intake & Landing (1 module)

#### 42. intake
- **Purpose:** External lead forms and landing pages
- **Services:** `intake.service.ts`
- **Controllers:** `intake.controller.ts`, `form.controller.ts`, `landing.controller.ts`, `admin-landing.controller.ts`
- **Endpoints:**
  - `POST /intake/lead` — Ingest lead from external form
  - `POST /public/forms/:id/submit` — Submit public form (no auth)
  - `GET /public/landing/:slug` — Get landing page config (no auth)
  - `GET /intake/admin/landings/:tenantId` — List landing pages
  - `POST /intake/admin/landings/:tenantId` — Create landing page

---

### Vertical System (2 modules)

#### 43. verticals
- **Purpose:** Industry vertical definitions, onboarding bootstrap, UI config
- **Services:** `verticals.service.ts`
- **Definitions:** `vertical-definitions.ts` — 18 industries × 4 languages
- **Controller:** `verticals.controller.ts`
- **Endpoints:**
  - `GET /verticals/:tenantId` — Tenant's vertical config
  - `GET /verticals/definitions/all` — All industry definitions
- **Bootstrap:** Seeds pipeline stages, agent persona, FAQs, services, tool flags per industry

#### 44. vertical-analytics
- **Purpose:** Cross-tenant vertical analytics (super_admin)
- **Services:** `vertical-analytics.service.ts`
- **Controller:** `vertical-analytics.controller.ts`
- **Endpoints:**
  - `GET /vertical-analytics/overview` — Cross-industry KPI overview
  - `GET /vertical-analytics/industry/:industry` — Per-industry metrics
  - `GET /vertical-analytics/tenant/:tenantId` — Tenant vertical activity

---

### Vertical-Specific Modules (14 modules)

#### 45. vacation-rental (Turismo)
- **Purpose:** Properties, iCal sync, bookings, calendar blocks
- **Services:** `properties.service.ts`, `ical-sync.service.ts`
- **Controllers:** `vacation-rental.controller.ts`, `ical-feed.controller.ts`, `ical-export-public.controller.ts`
- **Endpoints:**
  - `GET /vacation-rental/:tenantId/properties` — List properties
  - `POST /vacation-rental/:tenantId/properties` — Create
  - `GET /vacation-rental/:tenantId/properties/:id` — Detail
  - `PUT /vacation-rental/:tenantId/properties/:id` — Update
  - `DELETE /vacation-rental/:tenantId/properties/:id` — Delete
  - `GET /vacation-rental/:tenantId/properties/:id/availability` — Availability
  - `GET /vacation-rental/:tenantId/properties/:id/calendar` — Monthly calendar
  - `POST /vacation-rental/:tenantId/properties/:id/blocks` — Block dates
  - `DELETE /vacation-rental/:tenantId/blocks/:blockId` — Unblock
  - `GET /vacation-rental/:tenantId/properties/:id/bookings` — Bookings
  - `POST /vacation-rental/:tenantId/properties/:id/bookings` — Create booking
  - `PUT /vacation-rental/:tenantId/bookings/:id/cancel` — Cancel booking
  - `GET /vacation-rental/:tenantId/properties/:id/feeds` — iCal feeds
  - `POST /vacation-rental/:tenantId/properties/:id/feeds` — Add feed
  - `PUT /vacation-rental/:tenantId/feeds/:id` — Update feed
  - `DELETE /vacation-rental/:tenantId/feeds/:id` — Remove feed
  - `POST /vacation-rental/:tenantId/feeds/:id/sync` — Manual sync
  - `GET /vacation-rental/:tenantId/properties/:id/ical` — Export iCal
  - `GET /public/ical/:tenantSlug/:propertyId/:token/calendar.ics` — Public iCal feed
- **AI Tools (5):** list_vacation_rentals, check_vacation_rental, get_rental_details, get_check_in_instructions, create_rental_booking
- **Cron:** `*/30 * * * *` — syncAllFeeds: sync external iCal feeds

#### 46. tours (Turismo)
- **Purpose:** Tour packages, departure inventory, bookings with capacity management
- **Services:** `tours.service.ts`
- **Controller:** `tours.controller.ts`
- **Endpoints:**
  - `GET /tours/:tenantId/packages` — List packages
  - `POST /tours/:tenantId/packages` — Create
  - `GET /tours/:tenantId/packages/:id` — Detail
  - `PUT /tours/:tenantId/packages/:id` — Update
  - `DELETE /tours/:tenantId/packages/:id` — Delete
  - `GET /tours/:tenantId/packages/:id/inventory` — Departure inventory
  - `POST /tours/:tenantId/packages/:id/inventory` — Add departure date
  - `DELETE /tours/:tenantId/inventory/:id` — Remove departure
  - `GET /tours/:tenantId/packages/:id/availability` — Availability
  - `GET /tours/:tenantId/bookings` — All bookings
  - `POST /tours/:tenantId/bookings` — Create booking
  - `PUT /tours/:tenantId/bookings/:id/cancel` — Cancel (restores capacity)
- **AI Tools (4):** search_packages, get_package_details, check_tour_availability, create_tour_booking

#### 47. listings (Inmobiliaria)
- **Purpose:** Real estate property listings, search with filters, zone-agent routing
- **Services:** `listings.service.ts`
- **Controller:** `listings.controller.ts`
- **Endpoints:**
  - `GET /listings/:tenantId` — List all
  - `POST /listings/:tenantId` — Create
  - `GET /listings/:tenantId/search` — Search with filters (type, kind, price, bedrooms, neighborhood)
  - `GET /listings/:tenantId/listings/:id` — Detail
  - `PUT /listings/:tenantId/listings/:id` — Update
  - `DELETE /listings/:tenantId/listings/:id` — Delete
  - `GET /listings/:tenantId/zones` — Zone mappings
  - `POST /listings/:tenantId/zones` — Create zone
  - `DELETE /listings/:tenantId/zones/:id` — Delete zone
- **AI Tools (1):** search_listings

#### 48. restaurants (Restaurantes)
- **Purpose:** Menu categories/items, promotions, orders with status lifecycle
- **Services:** `restaurants.service.ts`
- **Controller:** `restaurants.controller.ts`
- **Endpoints:**
  - `GET /restaurants/:tenantId/categories` — Menu categories
  - `POST /restaurants/:tenantId/categories` — Create category
  - `PUT /restaurants/:tenantId/categories/:id` — Update
  - `DELETE /restaurants/:tenantId/categories/:id` — Delete
  - `GET /restaurants/:tenantId/items` — Menu items
  - `GET /restaurants/:tenantId/items/:id` — Item detail
  - `POST /restaurants/:tenantId/items` — Create item
  - `PUT /restaurants/:tenantId/items/:id` — Update
  - `DELETE /restaurants/:tenantId/items/:id` — Delete
  - `GET /restaurants/:tenantId/orders` — Orders list
  - `GET /restaurants/:tenantId/orders/:id` — Order detail
  - `POST /restaurants/:tenantId/orders` — Create order
  - `PUT /restaurants/:tenantId/orders/:id/status` — Update status (received→preparing→ready→delivered)
  - `GET /restaurants/:tenantId/promotions` — Promotions
  - `POST /restaurants/:tenantId/promotions` — Create
  - `DELETE /restaurants/:tenantId/promotions/:id` — Delete
- **AI Tools (4):** get_menu, get_daily_promotions, place_order, get_order_status

#### 49. gyms (Gimnasios)
- **Purpose:** Membership plans, members, fitness classes, check-ins
- **Services:** `gyms.service.ts`
- **Controller:** `gyms.controller.ts`
- **Endpoints:**
  - `GET /gyms/:tenantId/plans` — Membership plans
  - `POST /gyms/:tenantId/plans` — Create plan
  - `PUT /gyms/:tenantId/plans/:id` — Update
  - `DELETE /gyms/:tenantId/plans/:id` — Delete
  - `GET /gyms/:tenantId/members` — Member list
  - `GET /gyms/:tenantId/members/:id` — Member detail
  - `POST /gyms/:tenantId/members` — Register member
  - `POST /gyms/:tenantId/members/:id/freeze` — Freeze membership
  - `POST /gyms/:tenantId/members/:id/unfreeze` — Unfreeze
  - `POST /gyms/:tenantId/members/:id/check-in` — Check-in
  - `GET /gyms/:tenantId/classes` — Class list
  - `POST /gyms/:tenantId/classes` — Create class
  - `POST /gyms/:tenantId/classes/:id/cancel` — Cancel class
  - `POST /gyms/:tenantId/classes/:id/book` — Book member into class
  - `DELETE /gyms/:tenantId/bookings/:id` — Cancel booking
- **AI Tools (5):** get_gym_plans, get_upcoming_classes, check_gym_membership, book_class, freeze_membership

#### 50. pets (Veterinaria / Pet Services)
- **Purpose:** Pet registry, vaccination records
- **Services:** `pets.service.ts`
- **Controller:** `pets.controller.ts`
- **Endpoints:**
  - `GET /pets/:tenantId/all` — All pets
  - `GET /pets/:tenantId/contacts/:contactId` — Pets by contact
  - `POST /pets/:tenantId/pets` — Register pet
  - `GET /pets/:tenantId/pets/:id` — Detail
  - `PUT /pets/:tenantId/pets/:id` — Update
  - `DELETE /pets/:tenantId/pets/:id` — Delete
  - `POST /pets/:tenantId/pets/:id/vaccinations` — Add vaccination record
  - `DELETE /pets/:tenantId/vaccinations/:id` — Delete record
- **AI Tools (4):** list_pets_for_contact, register_pet, get_pet_vaccinations, emergency triage

#### 51. treatment-plans (Salud)
- **Purpose:** Treatment plans with sessions for healthcare verticals
- **Services:** `treatment-plans.service.ts`
- **Controller:** `treatment-plans.controller.ts`
- **Endpoints:**
  - `GET /treatment-plans/:tenantId/all` — All plans
  - `GET /treatment-plans/:tenantId/contacts/:contactId` — Plans by contact
  - `POST /treatment-plans/:tenantId/plans` — Create plan
  - `GET /treatment-plans/:tenantId/plans/:id` — Detail
  - `PUT /treatment-plans/:tenantId/plans/:id` — Update
  - `DELETE /treatment-plans/:tenantId/plans/:id` — Delete
  - `POST /treatment-plans/:tenantId/plans/:id/sessions` — Add session
  - `PUT /treatment-plans/:tenantId/sessions/:id/complete` — Complete session
  - `PUT /treatment-plans/:tenantId/sessions/:id/cancel` — Cancel session

#### 52. education (Educación)
- **Purpose:** Courses, cohorts, enrollments, placement tests
- **Services:** `education.service.ts`
- **Controller:** `education.controller.ts`
- **Endpoints:**
  - `GET /education/:tenantId/courses` — List courses
  - `GET /education/:tenantId/courses/:id` — Detail
  - `POST /education/:tenantId/courses` — Create
  - `PUT /education/:tenantId/courses/:id` — Update
  - `DELETE /education/:tenantId/courses/:id` — Delete
  - `GET /education/:tenantId/cohorts` — Cohorts
  - `POST /education/:tenantId/cohorts` — Create cohort
  - `POST /education/:tenantId/cohorts/:id/cancel` — Cancel cohort
  - `GET /education/:tenantId/enrollments` — Enrollments
  - `POST /education/:tenantId/enrollments` — Enroll student
  - `PUT /education/:tenantId/enrollments/:id` — Update enrollment
- **AI Tools (4):** list_courses, get_upcoming_cohorts, enroll_student, get_placement_test

#### 53. insurance (Seguros)
- **Purpose:** Insurance plans, quotes, policies, claims
- **Services:** `insurance.service.ts`
- **Controller:** `insurance.controller.ts`
- **Endpoints:**
  - `GET /insurance/:tenantId/plans` — Plans
  - `POST /insurance/:tenantId/plans` — Create
  - `PUT /insurance/:tenantId/plans/:id` — Update
  - `DELETE /insurance/:tenantId/plans/:id` — Delete
  - `GET /insurance/:tenantId/quotes` — Quotes
  - `POST /insurance/:tenantId/quotes` — Create quote
  - `PUT /insurance/:tenantId/quotes/:id/status` — Update status
  - `GET /insurance/:tenantId/policies` — Policies
  - `GET /insurance/:tenantId/policies/by-number/:number` — Lookup by policy number
  - `POST /insurance/:tenantId/policies` — Issue policy
  - `GET /insurance/:tenantId/claims` — Claims
  - `POST /insurance/:tenantId/claims` — File claim
- **AI Tools (4):** get_insurance_plans, calculate_quote, check_policy_status, file_claim

#### 54. home-services (Servicios del Hogar)
- **Purpose:** Service requests with urgency levels and status tracking
- **Services:** `home-services.service.ts`
- **Controller:** `home-services.controller.ts`
- **Endpoints:**
  - `GET /home-services/:tenantId/requests` — List requests
  - `GET /home-services/:tenantId/requests/:id` — Detail
  - `POST /home-services/:tenantId/requests` — Create request
  - `PUT /home-services/:tenantId/requests/:id` — Update request
- **AI Tools (2):** create_service_request, get_service_request_status

#### 55. photography (Fotografía)
- **Purpose:** Photo session management with delivery tracking
- **Services:** `photography.service.ts`
- **Controller:** `photography.controller.ts`
- **Endpoints:**
  - `GET /photography/:tenantId/sessions` — List sessions
  - `GET /photography/:tenantId/sessions/:id` — Detail
  - `POST /photography/:tenantId/sessions` — Create session
  - `PUT /photography/:tenantId/sessions/:id` — Update
  - `PUT /photography/:tenantId/sessions/:id/deliver` — Mark as delivered

#### 56. staff-scheduling (in verticals/)
- **Purpose:** Staff member management, scheduling, service linking, break management, availability checking
- **Services:** `staff-scheduling.service.ts`
- **Controller:** `staff-scheduling.controller.ts`
- **Per-tenant tables:** `staff_members`, `staff_schedules`, `staff_service_links`, `staff_breaks`
- **Endpoints:**
  - `GET /staff/:tenantId` — List staff with schedule/service aggregation
  - `POST /staff/:tenantId` — Create staff member
  - `PUT /staff/:tenantId/:staffId` — Update staff member
  - `DELETE /staff/:tenantId/:staffId` — Delete staff member
  - `PUT /staff/:tenantId/:staffId/schedule` — Set weekly schedule
  - `POST /staff/:tenantId/:staffId/services` — Link services to staff
  - `DELETE /staff/:tenantId/:staffId/services/:serviceId` — Unlink service
  - `GET /staff/:tenantId/:staffId/breaks` — List breaks
  - `POST /staff/:tenantId/:staffId/breaks` — Add break
  - `DELETE /staff/:tenantId/breaks/:breakId` — Remove break
  - `GET /staff/:tenantId/:staffId/availability` — Check availability
- **Key features:**
  - Availability check considers service links, day schedules, breaks, and existing appointment conflicts
  - Schedule/service aggregation in list queries

#### 57. vehicle-inventory (in verticals/)
- **Purpose:** Vehicle stock management for automotive verticals (dealerships, rentals)
- **Services:** `vehicle-inventory.service.ts`
- **Controller:** `vehicle-inventory.controller.ts`
- **Per-tenant tables:** `vehicles`, `vehicle_inquiries`, `test_drives`
- **Endpoints:**
  - `GET /vehicles/:tenantId` — List vehicles
  - `POST /vehicles/:tenantId` — Create vehicle
  - `GET /vehicles/:tenantId/:vehicleId` — Detail
  - `PUT /vehicles/:tenantId/:vehicleId` — Update (dynamic SET clause)
  - `DELETE /vehicles/:tenantId/:vehicleId` — Delete vehicle
  - `POST /vehicles/:tenantId/:vehicleId/mark-sold` — Mark as sold (sold_at, price, buyer)
  - `POST /vehicles/:tenantId/:vehicleId/test-drive` — Schedule test drive (conflict detection)
  - `GET /vehicles/:tenantId/search` — AI-oriented search (budget, category, fuel filters)
  - `GET /vehicles/:tenantId/stats` — Inventory statistics
- **Key features:**
  - Full CRUD with dynamic SET clause for partial updates
  - `markSold()` records sold_at timestamp, final price, and buyer info
  - `scheduleTestDrive()` with time conflict detection
  - AI-oriented search endpoint with budget/category/fuel type filters
  - `getInventoryStats()` for dashboard KPIs

---

### Other (7 modules)

#### 58. customer-portal
- **Purpose:** Customer-facing portal with magic-link authentication and read-only access
- **Services:** `customer-portal.service.ts`
- **Controller:** `customer-portal.controller.ts`
- **Auth:** Magic-link (6-digit code, Redis 10min TTL, 5-attempt brute-force protection). JWT with `type: 'customer'`. Controller validates `X-Portal-Token` header
- **Endpoints:**
  - `POST /customer-portal/auth/request` — Request magic-link code
  - `POST /customer-portal/auth/verify` — Verify code and get JWT
  - `GET /customer-portal/profile` — Customer profile (read-only)
  - `GET /customer-portal/conversations` — Customer conversations (read-only)
  - `GET /customer-portal/appointments` — Customer appointments (read-only)
  - `GET /customer-portal/orders` — Customer orders (read-only)
- **Key features:**
  - 6-digit magic-link code with Redis TTL (10 minutes)
  - Brute-force protection (max 5 attempts per code)
  - Read-only endpoints — customers cannot modify data through portal
  - Separate JWT type (`customer`) from admin/agent tokens

#### 59. white-label
- **Purpose:** Per-tenant branding customization (logos, colors, domains, CSS)
- **Services:** `white-label.service.ts`
- **Controller:** `white-label.controller.ts`
- **Config fields:** brandName, logoUrl, faviconUrl, primaryColor, accentColor, customDomain, customCss, footerText, hidePoweredBy
- **Endpoints:**
  - `GET /white-label/:tenantId` — Get branding config (tenant_admin)
  - `PUT /white-label/:tenantId` — Update branding config (tenant_admin)
  - `GET /white-label/public/slug/:slug` — Public lookup by tenant slug (no auth)
  - `GET /white-label/public/domain` — Public lookup by custom domain (no auth)
- **Key features:**
  - Plan-gated to Custom plan only
  - Public lookup by slug or custom domain with Redis cache
  - `hidePoweredBy` flag removes platform branding
  - Custom CSS injection for full UI control

#### 60. ecommerce
- **Purpose:** E-commerce product sync (Shopify + WooCommerce) and cart abandonment tracking
- **Services:** `ecommerce.service.ts`
- **Controller:** `ecommerce.controller.ts`
- **Lazy tables:** `ecommerce_products`, `abandoned_carts` (created on first use per tenant)
- **Endpoints:**
  - `GET /ecommerce/:tenantId/config` — Get integration config
  - `PUT /ecommerce/:tenantId/config` — Update integration config
  - `POST /ecommerce/:tenantId/sync` — Trigger product sync from provider
  - `GET /ecommerce/:tenantId/products` — List synced products
  - `GET /ecommerce/:tenantId/products/search` — AI-oriented product search
- **Key features:**
  - Shopify Admin API integration
  - WooCommerce REST API integration
  - Lazy table creation (tables created per tenant on first use)
  - Cart abandonment tracking
  - AI-oriented search endpoint for conversational product lookup

#### 61. channel-manager
- **Purpose:** Channel management integration (Hostaway) for vacation rental distribution
- **Services:** `channel-manager.service.ts`
- **Controller:** `channel-manager.controller.ts`
- **Lazy tables:** `cm_listings`, `cm_reservations`, `cm_availability` (created on first use per tenant)
- **Endpoints:**
  - `GET /channel-manager/:tenantId/config` — Get config
  - `PUT /channel-manager/:tenantId/config` — Update config
  - `GET /channel-manager/:tenantId/listings` — List managed listings
  - `POST /channel-manager/:tenantId/listings` — Create listing
  - `GET /channel-manager/:tenantId/reservations` — List reservations
  - `POST /channel-manager/:tenantId/reservations` — Create reservation
  - `GET /channel-manager/:tenantId/availability` — Availability calendar (date series)
  - `POST /channel-manager/:tenantId/sync/hostaway` — Sync from Hostaway
- **Key features:**
  - Hostaway OAuth integration
  - Reservation conflict detection
  - Availability calendar with date series generation
  - Lazy table creation per tenant

#### 62. widget
- **Purpose:** Embeddable JavaScript chat widget for websites with proactive triggers
- **Services:** `widget.service.ts`, `widget-triggers.service.ts` (CRUD for proactive triggers)
- **Gateway:** `widget.gateway.ts` (WebSocket for real-time chat)
- **Controllers:** `widget-public.controller.ts`, `widget-triggers.controller.ts` (protected CRUD)
- **Endpoints:**
  - `GET /widget/:tenantId/config` — Get widget config (includes active triggers)
  - `PUT /widget/:tenantId/config` — Update widget config (authenticated)
  - `GET /widget/public/:tenantId/config` — Public widget config (no auth, CORS)
  - `POST /widget/public/:tenantId/conversation` — Start or resume conversation (no auth)
  - `GET /widget/public/:tenantId/conversation/:conversationId/messages` — Get messages (no auth)
  - **Proactive Triggers:**
    - `GET /widget/:tenantId/triggers` — List triggers
    - `POST /widget/:tenantId/triggers` — Create trigger
    - `PUT /widget/:tenantId/triggers/:triggerId` — Update trigger
    - `DELETE /widget/:tenantId/triggers/:triggerId` — Delete trigger
- **Global tables:** `widget_triggers` (id, tenant_id, name, type, conditions_json, message, active)
- **WebSocket Events:** Real-time message delivery for embedded chat
- **Config fields:** bubble color, position (bottom-left/bottom-right), welcome message, pre-chat form toggle
- **Key features:**
  - Cross-origin embed with CORS configuration
  - WebSocket gateway for real-time chat
  - Conversation management (create + resume)
  - Customizable bubble appearance and position
  - Proactive triggers (time-on-page, scroll depth, exit intent, URL match)

#### 63. feature-requests
- **Purpose:** User feature requests with voting, comments, AI signal extraction
- **Services:** `feature-requests.service.ts`
- **Controller:** `feature-requests.controller.ts`
- **Endpoints:**
  - `GET /feature-requests/changelog` — Public changelog
  - `GET /feature-requests` — List (search/filter)
  - `GET /feature-requests/similar` — Find similar requests (AI)
  - `GET /feature-requests/:id` — Detail
  - `POST /feature-requests` — Create request
  - `POST /feature-requests/:id/vote` — Upvote
  - `DELETE /feature-requests/:id/vote` — Remove vote
  - `GET /feature-requests/:id/comments` — Comments
  - `POST /feature-requests/:id/comments` — Add comment
  - `PATCH /feature-requests/:id/status` — Change status (super_admin)
  - `POST /feature-requests/:id/merge` — Merge duplicates (super_admin)
- **Cron jobs:**
  - `EVERY_DAY_AT_3AM` — recomputeRanking: re-rank by score/recency
  - `EVERY_DAY_AT_4AM` — extractConversationalSignals: mine conversations for implicit feature requests

#### 64. meta-compliance
- **Purpose:** Meta (Facebook) GDPR data deletion callbacks
- **Services:** `meta-compliance.service.ts`
- **Controller:** `meta-compliance.controller.ts`
- **Endpoints:**
  - `POST /meta/data-deletion-callback` — Meta callback
  - `POST /meta/data-deletion-request` — Request account and associated-data deletion (public, rate limited)
  - `GET /meta/data-deletion/status` — Status
  - `PATCH /meta/data-deletion/status/:code` — Advance request status (super_admin)

#### 65. carla
- **Purpose:** AI profile management (legacy/internal)
- **Services:** `carla.service.ts`
- **Controller:** `carla.controller.ts`
- **Endpoints:**
  - `GET /carla/profiles/:tenantId` — List profiles
  - `POST /carla/profiles/:tenantId` — Create
  - `PUT /carla/profiles/:tenantId/:id` — Update
  - `GET /carla/prompts/:tenantId` — Prompts
  - `POST /carla/prompts/:tenantId` — Create prompt
  - `PUT /carla/prompts/:tenantId/:id` — Update prompt
  - `GET /carla/context/:tenantId` — Context data
  - `GET /carla/context/:tenantId/build/:conversationId` — Build context for conversation

#### 66. public-api
- **Purpose:** Tenant-facing REST API with key-based auth, scoped access, rate limiting, and outbound webhooks
- **Services:** `public-api-key.service.ts` (API key CRUD, SHA-256 hashing, plan-gated limits), `webhook-subscription.service.ts` (subscribe/unsubscribe/dispatch with HMAC-SHA256), `webhook-event-listener.service.ts` (@OnEvent bridge for 5 event types)
- **Guards:** `public-api.guard.ts` (X-API-Key validation with Redis cache 60s), `public-api-rate-limit.guard.ts` (sliding window rate limiting), `api-scope.guard.ts` (scope-based access control)
- **Controller:** `public-api-key.controller.ts`, `public-api.controller.ts`
- **Endpoints:**
  - `GET /public-api/keys/:tenantId` — List API keys
  - `POST /public-api/keys/:tenantId` — Create API key (SHA-256 hashed, shown once)
  - `DELETE /public-api/keys/:tenantId/:keyId` — Revoke API key
  - `POST /public-api/keys/:tenantId/:keyId/rotate` — Rotate API key
  - `GET /api/v1/public/me` — API key identity info
  - `GET /api/v1/public/contacts` — List contacts (scoped)
  - `GET /api/v1/public/deals` — List deals (scoped)
  - `GET /api/v1/public/conversations` — List conversations (scoped)
  - `GET /api/v1/public/appointments` — List appointments (scoped)
  - `POST /api/v1/public/hooks` — Subscribe to webhook events
  - `DELETE /api/v1/public/hooks` — Unsubscribe from webhook events
- **Global tables:** `api_keys` (id, tenant_id, name, key_hash, scopes, last_used_at, expires_at)
- **Tenant tables:** `webhook_subscriptions` (id, url, events[], secret_hash, active)
- **Key features:**
  - Plan-gated key limits (starter=1, pro=3, enterprise=10, custom=unlimited)
  - Scopes: contacts:read, deals:read, conversations:read, appointments:read, hooks:manage
  - HMAC-SHA256 webhook payload signing
  - Redis-cached key validation (60s TTL)

#### 67. media-processing
- **Purpose:** Multimedia message processing — audio transcription (Whisper) and image vision (multi-provider) with 6-layer abuse prevention
- **Services:** `media-processing.service.ts` (orchestrator), `media-download.service.ts` (channel-specific download), `audio-transcription.service.ts` (OpenAI Whisper-1), `image-vision.service.ts` (multi-provider: Gemini/xAI/OpenAI), `media-throttle.service.ts` (6-layer abuse prevention)
- **Controller:** `media-processing.controller.ts`
- **Endpoints:**
  - `GET /media-processing/:tenantId/usage` — Media usage stats (super_admin or tenant_admin)
- **Pipeline integration:** Runs BEFORE LLM call in `conversations.service.ts → generateResponse()`. Transcribed/described text persisted to messages table for conversation history continuity
- **Download adapters:** WhatsApp (Media ID → Meta Graph API), Instagram/Messenger (direct CDN URL), Telegram (file_id → Bot API getFile). Max 25MB, 30s timeout
- **Audio:** OpenAI Whisper-1, OGG native (no ffmpeg), cost $0.006/min. Output: `[El cliente envió un mensaje de voz: "..."]`
- **Image:** Provider by plan tier — Emprendedor/Starter → Gemini Flash (cheapest), Pro/Enterprise → xAI then OpenAI fallback. `detail: 'low'` for cost optimization. Output: `[El cliente envió una imagen: ...]`
- **6-layer throttle:**
  1. Monthly quotas per media type (audio/image)
  2. Per-contact/day limit
  3. Per-conversation/5min burst limit
  4. Per-tenant/hour limit
  5. Daily budget circuit breaker (cents)
  6. Max audio duration (seconds)
- **Plan limits (in seed-billing-plans.js features.mediaProcessing):**

  | Limit | Emprendedor | Starter | Pro | Enterprise | Custom |
  |-------|-------------|---------|-----|------------|--------|
  | Audio/month | 30 | 150 | 500 | 2,000 | ∞ |
  | Images/month | 50 | 250 | 1,000 | 5,000 | ∞ |
  | Max audio sec | 120 | 180 | 300 | 300 | 600 |
  | Per contact/day | 10 | 20 | 30 | 50 | 100 |
  | Per conv/5min | 3 | 3 | 5 | 5 | 10 |
  | Per tenant/hour | 20 | 50 | 200 | 500 | 1,000 |
  | Daily budget ¢ | 10 | 25 | 100 | 500 | 5,000 |

- **Redis keys:**
  - `media:audio:{tenantId}:{YYYY-MM}` — Monthly audio count
  - `media:image:{tenantId}:{YYYY-MM}` — Monthly image count
  - `media:contact:{tenantId}:{contactId}:{YYYY-MM-DD}` — Per-contact daily count
  - `media:conv:{conversationId}:{5min-bucket}` — Per-conversation burst count
  - `media:tenant:{tenantId}:{hour-bucket}` — Per-tenant hourly count
  - `media:cost:{tenantId}:{YYYY-MM-DD}` — Daily cost accumulator (cents)
- **Dashboard integration:** Billing page shows audio/image usage bars with 80%/95% threshold warnings + upgrade CTA. Super admin tenant detail includes TenantMediaStats component

### Notificaciones, Integraciones, Fiscal y Ops (10 módulos — jun–jul 2026)

#### 68. fiscal
- **Purpose:** Facturación electrónica **DIAN Colombia** vía proveedor **Factus** (capa `IFiscalInvoiceProvider` desacoplada del PSP). Emite el documento oficial en Factus y adjunta un **PDF branded propio**; gate "cobrar-solo-con-datos-fiscales" (NIT/cédula)
- **Services:** `fiscal-invoice.service.ts`, `fiscal-config.service.ts`, `fiscal-pdf.service.ts` + `fiscal-branded.util.ts`, `fiscal-email.service.ts`, `fiscal-storage.service.ts`, `fiscal-provider.factory.ts` (+ `adapters/` Factus). Modos `CO_LOCAL` y `US_REMOTE`
- **Controllers:** `fiscal.controller.ts` (tenant, `/fiscal`), `fiscal-admin.controller.ts` (super_admin, `/fiscal-admin`)
- **Tenant endpoints:** `GET|PUT /fiscal/:tenantId/data` (datos fiscales del tenant), `GET /fiscal/:tenantId/invoices`, `POST /fiscal/:tenantId/invoices/:id/retry`, `GET /fiscal/:tenantId/invoices/:id/pdf`, `GET /fiscal/:tenantId/invoices/:id/xml`
- **Admin endpoints:** `GET|PUT /fiscal-admin/config`, `GET /fiscal-admin/invoices`, `POST /fiscal-admin/invoices/:id/retry`, `POST /fiscal-admin/invoices/:id/reissue` (recuperación 409: borrar+reemitir/reconciliar), `GET /fiscal-admin/preview-invoice`, `POST /fiscal-admin/test-invoice`, `GET /fiscal-admin/factus/health`, `GET /fiscal-admin/factus/numbering-ranges`
- **BullMQ:** `fiscal-invoice` (concurrency 3)
- **Model:** `FiscalInvoice` (global). Ver `docs/facturacion-electronica-colombia-2026-06.md`

#### 69. sms-credits
- **Purpose:** **SMS monetizado modelo reseller** — los tenants compran créditos (1 crédito = 1 segmento Twilio) para notificar one-way a sus clientes vía el Twilio de la plataforma. Balance/ledger atómico, envío medido, tiers editables por super_admin, **kill-switch** maestro (apagado por defecto)
- **Services:** `sms-credits.service.ts` (paquetes + balance/ledger), `tenant-notification-sms.service.ts` (envío medido one-way, broadcast + cola, firma Twilio)
- **Controller:** `sms-credits.controller.ts` (`/sms-credits`)
- **Endpoints:** `GET /sms-credits/packages` (tiers públicos), `GET|PUT /sms-credits/admin/config` (tiers + kill-switch, super_admin), `GET /sms-credits/admin/balances` (super_admin), `POST /sms-credits/admin/:tenantId/adjust` (ajuste manual, super_admin), `GET /sms-credits/:tenantId/balance`, `GET /sms-credits/:tenantId/ledger`
- **Compra:** vía `billing/sms-checkout` (`POST /sms-credits/:tenantId/checkout`, pago único MercadoPago). Ver `docs/sms-monetization-packages-2026-07.md`

#### 70. sms-notifications
- **Purpose:** SMS **transaccional** de plataforma (WhatsApp-first + **SMS fallback**): alertas super_admin, handoff al agente, OTP/2FA. Gate por plan (`smsNotifications`) + opt-in per-tenant. Operador Twilio (+ Verify para OTP)
- **Services:** `sms-notifications.service.ts`, `sms-notification-listener.service.ts` (@OnEvent handoff/escalación), `sms-sender.service.ts`, `sms-notification-i18n.ts`
- **Controller:** `sms-notifications.controller.ts` (`/sms-notifications`)
- **Endpoints:** `GET|PUT /sms-notifications/:tenantId/config` (opt-in + números destino). Ver `docs/sms-notifications-implementation-plan-2026-07.md`

#### 71. push
- **Purpose:** Notificaciones push a agentes/admins — **Web Push** (navegador) y **Expo** (app móvil `@parallext/mobile`). Escucha eventos de handoff/escalación y entrega push
- **Services:** `push.service.ts` (suscripciones + envío), `push-listener.service.ts` (@OnEvent), `push-i18n.ts`
- **Controller:** `push.controller.ts` (`/push`)
- **Endpoints:** `POST /push/subscribe` (Web Push), `POST /push/unsubscribe`, `POST /push/expo-subscribe` (token Expo de la app móvil)

#### 72. slack
- **Purpose:** Notificaciones a Slack en eventos de negocio clave (T2.16) vía webhook de Slack por-tenant. Mismo patrón listener que push
- **Services:** `slack.service.ts`, `slack-listener.service.ts` (@OnEvent)
- **Controller:** `slack.controller.ts` (`/slack`)
- **Endpoints:** `GET|PUT /slack/:tenantId/config`, `POST /slack/:tenantId/test`

#### 73. webhooks
- **Purpose:** **Webhooks salientes por-tenant** gestionables desde el dashboard (Settings → Integraciones → Webhooks): endpoints suscritos a eventos, firma HMAC, historial de entregas y reintento de prueba (complementa los hooks del `public-api`)
- **Services:** `webhooks.service.ts`, `webhooks-listener.service.ts` (@OnEvent → dispatch)
- **Controller:** `webhooks.controller.ts` (`/webhooks`)
- **Endpoints:** `GET /webhooks/events` (catálogo de eventos), `GET|POST /webhooks/:tenantId`, `PUT|DELETE /webhooks/:tenantId/:endpointId`, `POST /webhooks/:tenantId/:endpointId/regenerate-secret`, `GET /webhooks/:tenantId/:endpointId/deliveries`, `POST /webhooks/:tenantId/:endpointId/test`

#### 74. system-updates
- **Purpose:** Novedades/changelog de plataforma publicadas por super_admin y visibles a los tenants (con imágenes)
- **Services:** `system-updates.service.ts` (CRUD + almacenamiento de imágenes, máx 5MB, resize a 1200px)
- **Controller:** `system-updates.controller.ts` (`/system-updates`)
- **Endpoints:** `GET /system-updates` (feed publicado), `GET /system-updates/:id`, `GET /system-updates/image/:fileName` (público), `GET /system-updates/admin` (todas, super_admin), `POST /system-updates`, `PUT /system-updates/:id`, `DELETE /system-updates/:id`, `POST /system-updates/upload-image`

#### 75. trace
- **Purpose:** Traza de LLM **por turno** (T1.7) — pasos del pipeline por turno para observabilidad/depuración. Escrituras best-effort async desde el evento `llm.turn` / `llm.turn.steps`
- **Services:** `trace.service.ts`, `trace-listener.service.ts` (@OnEvent), `trace-maintenance.service.ts` (poda por retención)
- **Controller:** `trace.controller.ts` (`/trace`)
- **Endpoints:** `GET /trace/:tenantId/:conversationId`, `GET /trace/:tenantId/:conversationId/turns`
- **Cron:** `45 4 * * 0` — pruneOldTurnTraces: poda de trazas antiguas

#### 76. quality
- **Purpose:** **QA scoring** de conversaciones resueltas (T1.6) con LLM-judge; expone puntajes y conversaciones marcadas (flagged). Alimenta el gate de simulación (`QualityService.judgeTranscript`)
- **Services:** `quality.service.ts`, `quality-listener.service.ts` (@OnEvent resolución → encola), `quality.processor.ts`
- **Controller:** `quality.controller.ts` (`/quality`)
- **Endpoints:** `GET /quality/:tenantId` (resumen/puntajes), `GET /quality/:tenantId/flagged`
- **BullMQ:** `quality-scoring` (concurrency 5; registrada sin adaptador BullBoard)

#### 77. kb-health
- **Purpose:** **KB auto-healing** (T2.14, estilo Maven) — escaneo semanal que detecta docs obsoletos, consultas sin respuesta y baja cobertura; genera reporte de gaps y estado
- **Services:** `kb-health.service.ts`
- **Controller:** `kb-health.controller.ts` (`/kb-health`)
- **Endpoints:** `GET /kb-health/:tenantId`, `POST /kb-health/:tenantId/scan`, `POST /kb-health/:tenantId/:id/status`
- **Cron:** `0 5 * * 0` — weeklyScan: escaneo semanal de salud de KB

### Roadmap Q2 modules (8 modules — May 31, 2026)

| Module | Purpose | Key endpoints | Dashboard |
|--------|---------|---------------|-----------|
| `simulation/` | **T2.13** Agent simulation pre-deploy. Runs N simulated conversations vs persona/KB (no prod side-effects), graded by the QA LLM-judge; regression diff vs baseline. BullMQ queue `agent-simulation`, table `simulation_runs`. Reuses `AgentTestService` + `QualityService.judgeTranscript`. | `POST /simulation/:t/run`, `GET /simulation/:t`, `GET /simulation/:t/:runId` | `/admin/agent/simulation` |
| `procedures/` | **T2.12** Vertical procedures (AOP/SOP). NL→graph LLM compiler + CRUD; deterministic execution engine `ProcedureEngineService` (in conversations/, Redis state, message/ask/tool/condition/handoff steps). Table `procedures`. | `POST /procedures/:t/compile`, CRUD `/procedures/:t`, `PUT .../status` | `/admin/procedures` |
| `vertical-integrations/` | **T3.19** Real vertical integrations: Toast (menu), Mindbody (classes), Cliniko (appointment types + availability). Config in `tenant.settings`, table `vi_items`, AI tools per connected provider. | `/vertical-integrations/:t/config`, `.../:provider/sync\|test`, `.../items` | Settings → Integraciones → Verticales |
| `mcp/` | **T3.20** MCP native. Consume external MCP servers (`McpClientService`, tools namespaced `mcp__server__tool`) + expose platform tools (`McpServerService`, JSON-RPC at `POST /mcp/rpc`, API-key auth). forwardRef with ConversationsModule. | `/mcp/:t/servers` (CRUD/test/tools), `POST /mcp/rpc` | Settings → Integraciones → MCP |
| `crm-b2b/` | **T3.21** B2B organizations (on existing `companies` table) + weighted-pipeline forecast (`ForecastingService`) + deal-rotting cron (flags stale opps, `crm.deal_rotting`). | `/crm-b2b/:t/organizations` (CRUD), `.../forecast`, `.../rotting` | `/admin/contacts/organizations` |
| `attribution/` | **T3.22** Click-to-WhatsApp ads + revenue attribution. Captures WA `referral` (via whatsapp.adapter), derives Ads→WhatsApp→sale funnel + revenue at query time; broadcast revenue. Table `ctwa_attributions`. | `/attribution/:t/ctwa/summary\|ctwa/ads\|broadcast/revenue` | `/admin/attribution` |
| `reviews/` | **T3.23** Reviews & reputation. Google Business Profile OAuth, sync reviews (`gbp_reviews`), AI Spanish replies (rating-aware), post back; cron sync + auto-reply. | `GET /reviews/google/callback` (public), `/reviews/:t/*` | Settings → Integraciones → Reseñas |
| `managed/` | **T3.24** Done-for-you managed tier (super-admin). Per-tenant resolution guarantee in `tenant.settings.managed`; tracks verified resolution rate vs target (met/at_risk/breached). Leverages T0.1 + T1.8. | `/managed` (list), `/managed/:t/config\|report` | `/admin/managed` |

---

## BullMQ Queues (11 total)

| Queue | Module | Processor | Concurrency | Purpose |
|-------|--------|-----------|-------------|---------|
| `outbound-messages` | channels | `outbound-queue.processor.ts` | 5 | All outbound channel messages (3 retries, priority by plan) |
| `broadcast-messages` | broadcast | `broadcast-queue.processor.ts` | 10 | Mass template campaigns (80 msg/s rate limit) |
| `automation-jobs` | automation | `automation-jobs.processor.ts` | 10 | Deferred rule actions (3 retries) |
| `nurturing` | automation | `nurturing-queue.processor.ts` | rate-limited | Lead nurturing sequences |
| `conversation-snooze` | agent-console | delayed `unsnooze` jobs (`snooze.service.ts`) | delayed | Auto-reactivación de conversaciones en snooze al vencer el plazo |
| `crm-sync` | external-crm | `external-crm.processor.ts` | 10 | Bidirectional CRM sync (HubSpot/Pipedrive) |
| `crm-import` | external-crm | `crm-import.processor.ts` | 2 | Batch contact import from external CRMs |
| `agent-simulation` | simulation | `simulation.processor.ts` | 2 | Pre-deploy agent simulation runs (T2.13, attempts:1) |
| `eval-gate` | simulation | `eval-gate.processor.ts` | 1 | Pre-deploy eval gate (LLM-judge multi-turno, attempts:1; sin BullBoard) |
| `fiscal-invoice` | fiscal | `fiscal-invoice.processor.ts` | 3 | Emisión de factura electrónica DIAN vía Factus |
| `quality-scoring` | quality | `quality.processor.ts` | 5 | QA scoring de conversaciones resueltas (T1.6; sin BullBoard) |

> BullBoard expone 9 de las 11 colas. `quality-scoring` y `eval-gate` se registran sin adaptador BullBoard.

---

## Cron Jobs (46 total)

| Schedule | Module | Method | Purpose |
|----------|--------|--------|---------|
| `* * * * *` | broadcast | (auto-launch) | Lanzar campañas programadas |
| `*/2 * * * *` | agent-console | escalateStaleHandoffs | Escalate handoffs >5min → supervisor alert |
| `*/5 * * * *` | agent-console | checkInactivity | Mark agents idle after 15min |
| `*/5 * * * *` | pipeline | checkAllTenantSLAs | SLA violation detection |
| `*/10 * * * *` | health | checkSystem | Chequeo de disco + memoria |
| `*/15 * * * *` | appointments | send24hReminders | 24h appointment reminders |
| `*/15 * * * *` | analytics | evaluateAlerts | Threshold alert rule evaluation |
| `*/30 * * * *` | whatsapp | pollAll | Meta template status polling |
| `*/30 * * * *` | vacation-rental | syncAllFeeds | External iCal feed sync |
| `*/30 * * * *` | offboarding | trialExpiryDetector | Detect expired trials → past_due (dedup via billing_events) |
| `2,7,…,57 * * * *` | health | checkQueues | Profundidad/estancamiento de colas BullMQ |
| `3,18,33,48 * * * *` | appointments | send1hReminders | 1h appointment reminders |
| `5,35 * * * *` | appointments | markNoShows | Mark no-show appointments |
| `8,18,28,38,48,58 * * * *` | health | checkSlaBreaches | Violaciones de SLA de handoff |
| `20 * * * *` | appointments | autoCompleteAppointments | Auto-complete ended 2+h ago |
| `0 * * * *` | crm | refreshDynamicSegments | Hourly segment membership refresh |
| `0 * * * *` | health | refreshAdmins | Refresca super_admins destinatarios de alertas |
| `0 * * * *` | health | checkChannelTokens | Credenciales de canal con refresh fallido |
| `EVERY_HOUR` | billing | reconcilePastDue | Sweep past-due subscriptions |
| `0 */2 * * *` | automation | checkStaleConversationsAllTenants | Stale conversation detection |
| `30 */2 * * *` | automation | checkAbandonedBookingsAllTenants | Detección de reservas abandonadas |
| `0 */6 * * *` | automation | autoResolveStale | Auto-resolve stale nurturing (72h) |
| `0 */6 * * *` | crm-b2b | detectRotting | Flag stale open opportunities (per-tenant rottingDays) |
| `30 */6 * * *` | reviews | syncAll | Sync GBP reviews + auto-reply |
| `0 */12 * * *` | appointments | renewWatchChannels | Renew Google Calendar push channels |
| `0 1 1 * *` | financials | generateMonthlySnapshot | Monthly SaaS financial snapshot |
| `0 2 * * *` | analytics | aggregateYesterday | Nightly metrics aggregation |
| `30 2 * * *` | billing | applyPendingDowngrades | Apply scheduled plan downgrades |
| `0 3 * * *` | billing | fullReconciliation | Daily billing drift detection |
| `0 3 * * *` | offboarding | graceEnforcer | Past-due >7d → offboard (dedup via billing_events) |
| `15 3 * * *` | health | checkStorage | Alerta por disco/quota |
| `30 3 * * *` | offboarding | handleDailyArchiving | Archivado diario de historial de chat |
| `EVERY_DAY_AT_3AM` | feature-requests | recomputeRanking | Re-rank feature requests |
| `0 4 * * *` | offboarding | archiveCleaner | Drop schemas inactive >90d |
| `0 4 * * 0` | knowledge | handleWeeklyRecrawl | Recrawl semanal de URLs de KB (dom) |
| `30 4 * * 0` | media | scheduledCleanup | Limpieza semanal de media huérfana (dom) |
| `45 4 * * 0` | trace | pruneOldTurnTraces | Poda de trazas LLM por turno (dom) |
| `EVERY_DAY_AT_4AM` | feature-requests | extractConversationalSignals | Mine conversations for feature requests |
| `0 5 * * *` | offboarding | purgeStaleInactiveChannels | Clean stale channel credentials |
| `0 5 * * 0` | kb-health | weeklyScan | Escaneo semanal de salud de KB (dom) |
| `0 6 * * *` | channels | refreshExpiringSoonTokens | Instagram token refresh (30d window) |
| `30 7 * * *` | health | checkRiskSignals | Fallos de pago/webhook + presupuesto LLM + heartbeat de backup |
| `0 8 * * 1` | analytics | sendWeeklyReports | Weekly email reports (Monday 8AM) |
| `0 8 1 * *` | analytics | sendMonthlyReports | Monthly email reports |
| `0 9 * * *` | billing | emitTrialEndingSoon | Trial expiry notifications |
| `0 9 * * *` | recall | processRecalls | Daily re-engagement campaigns |

---

## Dashboard Pages (139 total — 126 admin + 13 públicas)

> Las tablas por sección de abajo cubren la navegación principal; no son exhaustivas de las 126 páginas admin (existen páginas nuevas de verticales, integraciones en `settings/integrations/*` — mcp, reviews, slack, sms-notifications, vertical, webhooks — y de super_admin listadas abajo).

### Public Pages (13)

| Route | Purpose | i18n |
|-------|---------|------|
| `/login` | Email/password + Google/Microsoft OAuth + 2FA | ✅ auth |
| `/signup` | Tenant self-signup | ✅ auth |
| `/forgot-password` | OTP → new password (3-step) | ✅ auth |
| `/verify-email` | 6-digit OTP verification | ✅ auth |
| `/setup-password` | Google OAuth password setup | ✅ auth |
| `/accept-invite/[token]` | Invitation acceptance | ✅ acceptInvite |
| `/auth/callback` | Microsoft OAuth code exchange | N/A |
| `/onboarding` | 4-step company wizard | ✅ onboarding |
| `/kb/[tenantSlug]` | Public KB portal | ⚠️ Hardcoded EN |
| `/kb/[tenantSlug]/[slug]` | KB article detail | ⚠️ Hardcoded EN |
| `/book/[tenantSlug]` | Public booking flow | ⚠️ Only en/es |
| `/admin/setup-wizard` | First-time agent setup | ✅ setupWizard |
| `/` | Root redirect | N/A |

### Admin Core (12)

| Route | Purpose | Role | i18n |
|-------|---------|------|------|
| `/admin` | Dashboard home (KPIs, activity, vertical-aware) | All | ✅ |
| `/admin/inbox` | Agent console (WhatsApp-style chat + WebSocket) | All | ✅ |
| `/admin/contacts` | CRM contacts list (search, filter, bulk, create) | All | ✅ |
| `/admin/contacts/[leadId]` | Lead 360° detail (edit, score, custom fields) | All | ✅ |
| `/admin/contacts/segments` | Contact segments | All | ✅ |
| `/admin/pipeline` | Sales pipeline Kanban | All | ✅ |
| `/admin/appointments` | Calendar + list + availability + services | All | ✅ |
| `/admin/identity` | Cross-channel merge suggestions | Supervisor+ | ✅ |
| `/admin/conversations` | Conversation archive (not in sidebar) | Supervisor+ | ⚠️ Partial |
| `/admin/compliance` | Privacy & consent (not in sidebar) | Admin | ✅ |
| `/admin/users` | User management + invitations | Admin | ✅ |
| `/admin/feature-requests` | Feature requests + voting + changelog | All | ✅ |

### Growth Section (10)

| Route | Purpose | Role | i18n |
|-------|---------|------|------|
| `/admin/broadcast` | Campaign manager (WA templates) | Supervisor+ | ✅ |
| `/admin/automation` | Automation rules wizard (4-step) | Supervisor+ | ✅ |
| `/admin/automation/drip-sequences` | Drip sequence list | Supervisor+ | ✅ |
| `/admin/automation/drip-sequences/[sequenceId]` | Sequence timeline editor | Supervisor+ | ✅ |
| `/admin/automation/templates` | Template gallery with install | Supervisor+ | ✅ |
| `/admin/agent` | AI agent list (multi-agent) | Admin | ✅ |
| `/admin/agent/[agentId]` | Agent editor (hub cards + channel assignment) | Admin | ✅ |
| `/admin/agent/[agentId]/test` | Agent test console with debug panel | Admin | ✅ |
| `/admin/knowledge` | Knowledge base (RAG documents) | Supervisor+ | ✅ |
| `/admin/knowledge/faqs` | FAQ management | Supervisor+ | ✅ |

### Analytics (5)

| Route | Purpose | Role | i18n |
|-------|---------|------|------|
| `/admin/analytics-v2` | Main analytics (8 tabs, CSV export) | Supervisor+ | ✅ |
| `/admin/crm-analytics` | CRM analytics (funnel, velocity, leaderboard) | Supervisor+ | ✅ |
| `/admin/agent-analytics` | Agent performance + CSAT (4 tabs) | All | ✅ |
| `/admin/report-builder` | Custom report builder (16 metrics, 4 chart types, save/edit/duplicate) | Admin | ✅ |
| `/admin/analytics` | Legacy analytics (deprecated, not in sidebar) | Supervisor+ | ⚠️ |
| `/admin/ai` | Legacy LLM config (deprecated, not in sidebar) | Super admin | ⚠️ |

### Channels (9)

| Route | Purpose | Role | i18n |
|-------|---------|------|------|
| `/admin/channels` | Channel overview + agent assignment status | Admin | ✅ |
| `/admin/channels/whatsapp` | WhatsApp Embedded Signup | Admin | ✅ |
| `/admin/channels/whatsapp/templates` | WA template management | Admin | ✅ |
| `/admin/channels/instagram` | Instagram OAuth setup | Admin | ✅ |
| `/admin/channels/instagram/callback` | IG OAuth callback | N/A | N/A |
| `/admin/channels/messenger` | Messenger FB SDK setup | Admin | ✅ |
| `/admin/channels/telegram` | Telegram bot setup | Admin | ✅ |
| `/admin/channels/sms` | SMS/Twilio setup | Admin | ✅ |
| `/admin/channels/email` | Email channel config (SMTP/SendGrid) | Admin | ✅ |

### Settings (22)

| Route | Purpose | Role | i18n |
|-------|---------|------|------|
| `/admin/settings` | Settings hub (card grid) | All | ✅ |
| `/admin/settings/profile` | User profile | All | ✅ |
| `/admin/settings/security` | 2FA management | All | ✅ |
| `/admin/settings/notifications` | Notification preferences | All | ⚠️ Hardcoded EN |
| `/admin/settings/appearance` | Theme switcher | All | ✅ |
| `/admin/settings/change-password` | Change password | All | ✅ |
| `/admin/settings/business-info` | Company identity | Admin | ✅ |
| `/admin/settings/policies` | Legal policies (versioned) | Admin | ✅ |
| `/admin/settings/localization` | Timezone, language | Admin | ✅ |
| `/admin/settings/business-hours` | Daily schedule | Admin | ✅ |
| `/admin/settings/pipeline` | Pipeline stages (drag-to-reorder) | Supervisor+ | ✅ |
| `/admin/settings/scoring-config` | Lead scoring weights | Supervisor+ | ✅ |
| `/admin/settings/custom-attributes` | Custom field definitions | Supervisor+ | ✅ |
| `/admin/settings/prechat` | Pre-chat form builder | Supervisor+ | ✅ |
| `/admin/settings/public-booking` | Public booking config | Supervisor+ | ✅ |
| `/admin/settings/email-templates` | Email template editor + preview | Supervisor+ | ✅ |
| `/admin/settings/macros` | Saved action sequences | Supervisor+ | ✅ |
| `/admin/settings/media` | Media library + logo | All | ✅ |
| `/admin/settings/recall` | Re-engagement campaign config | Admin | ✅ |
| `/admin/settings/alerts` | Alert rules + scheduled reports | Admin | ✅ |
| `/admin/settings/api-keys` | API key management (CRUD, copy-once, scopes) | Admin | ✅ |
| `/admin/settings/integrations/crm` | External CRM connections | Admin | ✅ |
| `/admin/settings/ai-providers` | LLM API keys | Super admin | ✅ |
| `/admin/settings/ai-config` | LLM routing config | Super admin | ✅ |
| `/admin/settings/channels` | Global channel config | Super admin | ✅ |
| `/admin/settings/platform` | Maintenance mode | Super admin | ✅ |
| `/admin/settings/integrations/web-chat/triggers` | Widget proactive trigger editor | Admin | ✅ |
| `/admin/settings/billing` | Subscription + payments + invoices | Admin | ✅ |

### Vertical-Specific Pages (13)

| Route | Vertical | Purpose | i18n |
|-------|----------|---------|------|
| `/admin/properties` | Turismo (VR) | Property list | ✅ |
| `/admin/properties/[id]` | Turismo (VR) | Property detail (5 tabs) | ✅ |
| `/admin/tours` | Turismo (tours) | Tour packages | ✅ |
| `/admin/tours/[id]` | Turismo (tours) | Tour detail + inventory | ✅ |
| `/admin/listings` | Inmobiliaria | Real estate listings | ✅ |
| `/admin/listings/[id]` | Inmobiliaria | Listing detail | ✅ |
| `/admin/menu` | Restaurantes | Menu + promotions | ✅ |
| `/admin/food-orders` | Restaurantes | Order queue | ✅ |
| `/admin/memberships` | Gimnasios | Plans + members | ✅ |
| `/admin/classes` | Gimnasios | Fitness classes | ✅ |
| `/admin/courses` | Educación | Courses + cohorts + enrollment | ✅ |
| `/admin/insurance` | Seguros | Plans + quotes + policies + claims | ✅ |
| `/admin/service-requests` | Serv. Hogar | Service requests | ✅ |
| `/admin/treatment-plans` | Salud | Treatment plans + sessions | ✅ |
| `/admin/pets` | Veterinaria | Pet registry + vaccinations | ✅ |
| `/admin/photo-sessions` | Fotografía | Photo sessions | ✅ |

### Super Admin Platform (20)

| Route | Purpose | i18n |
|-------|---------|------|
| `/admin/tenants` | Tenant management (6 tabs) | ✅ |
| `/admin/tenants/[tenantId]` | Tenant detail (4 tabs + flags + quotas) | ✅ |
| `/admin/financials` | SaaS financials (5 tabs + CSV export) | ✅ |
| `/admin/usage` | Platform usage / quota tracking | ✅ |
| `/admin/health` | Platform health + BullMQ inspection | ✅ |
| `/admin/ops` | Ops Center — monitoreo de plataforma + incidentes | ✅ |
| `/admin/ops/alerts` | Configuración de umbrales de alerta | ✅ |
| `/admin/incidents` | Incidentes de plataforma (ack/resolve) | ✅ |
| `/admin/storage` | Storage por-tenant (schema DB + media + quota + history) | ✅ |
| `/admin/plans` | Gestión de planes (features, precios, sync-mp, badge sandbox/prod) | ✅ |
| `/admin/billing-ops` | Billing-ops cross-tenant (suscripciones/pagos/eventos, reconcile, refund, comp-plan) | ✅ |
| `/admin/sms-packages` | Tiers de créditos SMS + kill-switch + balances | ✅ |
| `/admin/fiscal` | Facturación electrónica DIAN (config Factus, facturas, reemisión) | ✅ |
| `/admin/audit` | Audit log viewer | ✅ |
| `/admin/llm-stats` | LLM observability (cost/model/tenant) | ✅ |
| `/admin/webhooks` | Webhook live-tail | ✅ |
| `/admin/compliance-admin` | Cross-tenant compliance | ✅ |
| `/admin/funnel` | Acquisition funnel | ✅ |
| `/admin/vertical-analytics` | Vertical analytics | ✅ |
| `/admin/coupons` | Coupon management | ✅ |

### Hidden/Orphan Pages (not in sidebar, accessible by URL)

| Route | Purpose | Status |
|-------|---------|--------|
| `/admin/inventory` | Stock management | Functional but hidden |
| `/admin/orders` | Order tracking | Functional but hidden |
| `/admin/catalog` | Catalog hub (offers/courses/campaigns) | Functional but hidden |
| `/admin/catalog/offers` | Promotional offers | Functional but hidden |
| `/admin/landings` | Landing page builder | Placeholder only |

---

### Key Dashboard Components (competitive analysis features)

| Component | Location | Purpose |
|-----------|----------|---------|
| `ViewersIndicator.tsx` | `inbox/_components/` | Collision detection — shows who else is viewing a conversation |
| `KbFeedbackWidget.tsx` | `inbox/_components/` | KB feedback thumbs (up/down) on AI-sourced replies |
| `HttpRequestNode.tsx` | `automation/_components/` | Flow builder node for HTTP request actions |
| `VariableSelector.tsx` | `automation/_components/` | Variable picker ({{contact.name}}, {{deal.value}}, etc.) |
| `AiResolutionWidget.tsx` | `analytics-v2/_components/` | AI resolution rate chart (auto-resolved vs escalated) |

---

## Key Files Quick Reference

| Task | File |
|------|------|
| Message flow entry point | `conversations/conversations.service.ts` |
| Prompt assembly (3-layer + safety) | `conversations/prompt-assembler.service.ts` |
| Booking engine (deterministic) | `conversations/booking-engine.service.ts` |
| Intent interpreter | `conversations/intent-interpreter.service.ts` |
| Language detection | `conversations/language-detector.service.ts` |
| AI tool executor | `conversations/ai-tool-executor.service.ts` |
| LLM router (5 providers) | `ai/router/llm-router.service.ts` |
| Channel gateway | `channels/channel-gateway.service.ts` |
| Outbound queue | `channels/outbound-queue.service.ts` |
| Token resolver | `channels/channel-token.service.ts` |
| Meta webhook validation | `channels/meta-signature.util.ts` |
| Handoff + escalation | `handoff/handoff.service.ts` |
| Agent console WebSocket | `agent-console/agent-console.gateway.ts` |
| Agent availability + SLA | `agent-console/agent-availability.service.ts` |
| Multi-agent CRUD | `persona/persona.service.ts` |
| Agent templates (6 built-in) | `persona/templates/index.ts` |
| Vertical definitions (18 industries) | `verticals/vertical-definitions.ts` |
| Vertical bootstrap | `verticals/verticals.service.ts` |
| Plan features / rate limits | `throttle/tenant-throttle.service.ts` |
| Feature flags | `throttle/feature-flags.service.ts` |
| Phone normalization (E.164) | `common/utils/phone.util.ts` |
| Media processing orchestrator | `media-processing/media-processing.service.ts` |
| Media throttle (6-layer abuse prevention) | `media-processing/media-throttle.service.ts` |
| Audio transcription (Whisper) | `media-processing/audio-transcription.service.ts` |
| Image vision (multi-provider) | `media-processing/image-vision.service.ts` |
| Public API key service | `public-api/public-api-key.service.ts` |
| Public API guard (X-API-Key) | `public-api/public-api.guard.ts` |
| Webhook subscription dispatch | `public-api/webhook-subscription.service.ts` |
| Drip sequence engine | `automation/drip-sequence.service.ts` |
| Automation template library | `automation/templates/automation-templates.service.ts` |
| HTTP request handler (automation) | `automation/handlers/http-request.handler.ts` |
| Variable interpolation | `automation/utils/variable-interpolator.ts` |
| Shared HTTP client (SSRF-safe) | `common/services/http-request.service.ts` |
| Collision detection (agent console) | `agent-console/collision-detection.service.ts` |
| Email channel adapter | `channels/email/email.adapter.ts` |
| Email channel config | `channels/email/email-channel.service.ts` |
| A/B test engine (broadcast) | `broadcast/ab-test.service.ts` |
| Widget proactive triggers | `widget/widget-triggers.service.ts` |
| Dashboard API client (110+ methods) | `dashboard/src/lib/api.ts` |
| Auth context | `dashboard/src/contexts/AuthContext.tsx` |
| Tenant context | `dashboard/src/contexts/TenantContext.tsx` |
| Sidebar navigation | `dashboard/src/components/layout/AppSidebar.tsx` |
| Settings config | `dashboard/src/app/admin/settings/_settings-config.ts` |
| DB tenant schema template | `api/prisma/tenant-schema.sql` |
| Shared TypeScript types | `packages/shared/src/index.ts` |
