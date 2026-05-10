# Modules Reference

Complete reference for all 58 API modules, 78 dashboard pages, 6 BullMQ queues, and 28 cron jobs.

**Last updated:** May 2026 — full audit

---

## API Modules (58 total)

### Infrastructure (5 modules)

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

#### 3. health
- **Purpose:** Health check endpoint
- **Controller:** `health.controller.ts`
- **Endpoints:**
  - `GET /health` — Health check (no auth)

#### 4. throttle
- **Purpose:** Plan-based rate limiting and feature flags. `@Global()` module
- **Services:** `tenant-throttle.service.ts`, `feature-flags.service.ts`
- **Controller:** None (consumed by other modules)
- **Plan limits:** starter (1 agent, 200 outbound/h), pro (3 agents, 2000/h), enterprise (10 agents, 20000/h), custom (unlimited)
- **Calendar limits:** starter=1, pro=3, enterprise=10, custom=999

#### 5. internal
- **Purpose:** Service-to-service message injection (WhatsApp service → API)
- **Controller:** `internal.controller.ts`
- **Auth:** INTERNAL_API_KEY header
- **Endpoints:**
  - `POST /internal/inbound-message` — Inject message into processing pipeline

---

### Auth & Tenants (5 modules)

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
  - `POST /auth/impersonate/:tenantId` — Super admin impersonation (1h token, audit trail)
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
  - `0 3 * * *` — graceEnforcer: past_due >7d → offboard
  - `0 4 * * *` — archiveCleaner: drop schemas inactive >90d
  - `0 5 * * *` — purgeStaleInactiveChannels: clean stale channel credentials

---

### Message Pipeline (6 modules)

#### 11. channels
- **Purpose:** Multi-channel message routing, webhook handling, outbound queue
- **Services:** `channel-gateway.service.ts`, `channel-token.service.ts`, `outbound-queue.service.ts`, `instagram-token-refresh.service.ts`, `webhook-tap.service.ts`
- **Adapters:** `whatsapp/whatsapp.adapter.ts`, `instagram/instagram.adapter.ts`, `messenger/messenger.adapter.ts`, `sms/sms.adapter.ts`, `telegram/telegram.adapter.ts`
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
  - `GET /webhook-tap` — Debug: last captured webhook payload
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
- **Purpose:** Real-time agent workspace (WebSocket + REST)
- **Services:** `agent-console.service.ts`, `agent-availability.service.ts`, `canned-responses.service.ts`, `macros.service.ts`, `snooze.service.ts`
- **Gateway:** `agent-console.gateway.ts` (WebSocket `/inbox` namespace)
- **WebSocket Events:** `inbox:handoff`, `inbox:handoff_direct`, `inbox:escalation`
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
- **Purpose:** LLM routing with multi-provider failover
- **Services:** `LLMRouterService` (router)
- **Providers:** `OpenAIProvider` (GPT-4o, GPT-4.1-mini, GPT-4o-mini), `AnthropicProvider` (claude-3-5-sonnet), `GeminiProvider` (gemini-2.5-pro/flash), `DeepSeekProvider` (deepseek-chat), `XAIProvider` (grok-4-1-fast)
- **Controller:** None (consumed by conversations)
- **Key features:** 4-tier routing (premium→budget), cost tracking in Redis, auto-upgrades tier if provider unavailable

#### 18. persona
- **Purpose:** Multi-agent management, templates, channel assignment
- **Services:** `persona.service.ts`
- **Templates:** 6 built-in (Sales Advisor, Support Agent, FAQ Bot, Appointment Scheduler, Lead Qualifier, Blank)
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
- **Purpose:** RAG with pgvector — hybrid vector + keyword search with citations
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
- **Purpose:** Event-driven automation rules, nurturing sequences
- **Services:** `automation.service.ts`, `automation-listener.service.ts`, `nurturing.service.ts`, `action-executor.service.ts`
- **Controller:** `automation.controller.ts`
- **Endpoints:**
  - `GET /automation/rules/:tenantId` — List rules
  - `POST /automation/rules/:tenantId` — Create rule
  - `PUT /automation/rules/:tenantId/:ruleId` — Update rule
  - `PUT /automation/rules/:tenantId/:ruleId/toggle` — Toggle active
  - `GET /automation/rules/:tenantId/:ruleId/executions` — Execution history
  - `DELETE /automation/rules/:tenantId/:ruleId` — Delete rule
- **BullMQ queues:**
  - `automation-jobs` (concurrency: 10, 3 retries) — deferred rule actions
  - `nurturing` (rate-limited) — lead nurturing sequences
- **Cron jobs:**
  - `0 */6 * * *` — autoResolveStale: auto-resolve stale nurturing (72h)
  - `0 */2 * * *` — checkStaleConversationsAllTenants: detect stale conversations

---

### Billing & Finance (3 modules)

#### 26. billing
- **Purpose:** Subscription lifecycle, MercadoPago integration, invoices, coupons
- **Services:** `billing.service.ts`, `billing-email.service.ts`, `invoice-generator.service.ts`, `coupons.service.ts`, `payment-provider.factory.ts`
- **Adapters:** `mercadopago.adapter.ts`, `mercadopago-config.service.ts`, `mock-payment-provider.adapter.ts`
- **Processors:** `reconciliation.processor.ts`
- **Controllers:** `billing.controller.ts`, `billing-admin.controller.ts`, `coupons.controller.ts`, `webhook.controller.ts`
- **Endpoints:**
  - `GET /billing/plans` — List plans
  - `GET /billing/:tenantId/subscription` — Current subscription
  - `POST /billing/:tenantId/subscription` — Create subscription
  - `POST /billing/:tenantId/subscription/upgrade` — Upgrade plan
  - `POST /billing/:tenantId/subscription/cancel` — Cancel
  - `POST /billing/:tenantId/subscription/pause` — Pause
  - `POST /billing/:tenantId/subscription/resume` — Resume
  - `POST /billing/:tenantId/subscription/payment-method` — Update payment method
  - `POST /billing/:tenantId/subscription/cancel-pending-downgrade` — Cancel pending downgrade
  - `POST /billing/:tenantId/subscription/sync` — Force sync with provider
  - `GET /billing/:tenantId/usage` — Plan quota usage
  - `GET /billing/:tenantId/payments/:paymentId/invoice` — Download invoice PDF
  - `POST /billing-admin/payments/:paymentId/refund` — Refund (super_admin)
  - `POST /billing-admin/tenants/:tenantId/comp-plan` — Grant comp plan (super_admin)
  - `GET /billing-coupons/admin` — List coupons
  - `POST /billing-coupons/admin` — Create coupon
  - `PUT /billing-coupons/admin/:id` — Update coupon
  - `DELETE /billing-coupons/admin/:id` — Delete coupon
  - `GET /billing-coupons/admin/:id/redemptions` — Redemption history
  - `POST /billing-coupons/validate/:tenantId` — Validate coupon code
  - `POST /billing-coupons/redeem/:tenantId` — Redeem coupon
  - `POST /billing/webhook/:provider` — Payment provider webhook (HMAC verified)
- **Cron jobs:**
  - `EVERY_HOUR` — reconcilePastDue: sweep past-due subscriptions
  - `0 3 * * *` — fullReconciliation: daily drift detection
  - `30 2 * * *` — applyPendingDowngrades: apply scheduled downgrades
  - `0 9 * * *` — emitTrialEndingSoon: trial expiry notifications

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

---

### Analytics (1 module, multiple controllers)

#### 28. analytics
- **Purpose:** Platform analytics, BI API, alerts, CSAT, compliance audit, scheduled reports
- **Services:** `analytics.service.ts`, `dashboard-analytics.service.ts`, `agent-analytics.service.ts`, `alerts.service.ts`, `audit.service.ts`, `compliance.service.ts`, `csat-trigger.service.ts`, `metrics-aggregation.service.ts`, `scheduled-reports.service.ts`
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
- **Purpose:** Mass template campaigns via WhatsApp
- **Services:** `broadcast.service.ts`
- **Controller:** `broadcast.controller.ts`
- **Endpoints:**
  - `POST /broadcast/campaigns` — Create campaign
  - `POST /broadcast/campaigns/:id/launch` — Launch campaign
  - `GET /broadcast/campaigns` — List campaigns
  - `GET /broadcast/campaigns/:id/stats` — Campaign stats (sent→delivered→read→failed)
- **BullMQ:** `broadcast-messages` (concurrency: 10, 80 msg/s rate limit)

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
- **Purpose:** Privacy & consent management, opt-outs, legal texts, GDPR
- **Services:** `compliance.service.ts`
- **Controller:** `compliance.controller.ts`
- **Endpoints:**
  - `GET /compliance/legal-texts/:tenantId` — List legal texts
  - `POST /compliance/legal-texts/:tenantId` — Create/update
  - `GET /compliance/consents/:tenantId` — Consent records
  - `POST /compliance/consents/:tenantId` — Record consent
  - `GET /compliance/opt-outs/:tenantId` — Opt-out list
  - `GET /compliance/opt-outs/:tenantId/stats` — Opt-out statistics
  - `PUT /compliance/opt-outs/:tenantId/:id/confirm` — Confirm opt-out
  - `PUT /compliance/opt-outs/:tenantId/:id/reject` — Reject opt-out
  - `POST /compliance/opt-outs/:tenantId` — Manual opt-out
  - `GET /compliance/deletion-requests/:tenantId` — Deletion requests
  - `POST /compliance/deletion-requests/:tenantId` — Create deletion request
  - `PUT /compliance/deletion-requests/:tenantId/:id/process` — Process request
  - `GET /compliance/admin/overview` — Platform compliance overview (super_admin)
  - `POST /compliance/admin/export-contact-data/:tenantId/:contactId` — Export contact data

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

### Vertical-Specific Modules (12 modules)

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

---

### Other (3 modules)

#### 56. feature-requests
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

#### 57. meta-compliance
- **Purpose:** Meta (Facebook) GDPR data deletion callbacks
- **Services:** `meta-compliance.service.ts`
- **Controller:** `meta-compliance.controller.ts`
- **Endpoints:**
  - `POST /meta/data-deletion-callback` — Meta callback
  - `POST /meta/data-deletion-request` — Request deletion
  - `GET /meta/data-deletion/status` — Status

#### 58. carla
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

---

## BullMQ Queues (6 total)

| Queue | Module | Processor | Concurrency | Purpose |
|-------|--------|-----------|-------------|---------|
| `outbound-messages` | channels | `outbound-queue.processor.ts` | 5 | All outbound channel messages (3 retries, priority by plan) |
| `broadcast-messages` | broadcast | `broadcast-queue.processor.ts` | 10 | Mass template campaigns (80 msg/s rate limit) |
| `automation-jobs` | automation | `automation-jobs.processor.ts` | 10 | Deferred rule actions (3 retries) |
| `nurturing` | automation | `nurturing-queue.processor.ts` | rate-limited | Lead nurturing sequences |
| `crm-sync` | external-crm | `external-crm.processor.ts` | 10 | Bidirectional CRM sync (HubSpot/Pipedrive) |
| `crm-import` | external-crm | `crm-import.processor.ts` | 2 | Batch contact import from external CRMs |

---

## Cron Jobs (28 total)

| Schedule | Module | Method | Purpose |
|----------|--------|--------|---------|
| `*/2 * * * *` | agent-console | escalateStaleHandoffs | Escalate handoffs >5min → supervisor alert |
| `*/5 * * * *` | agent-console | checkInactivity | Mark agents idle after 15min |
| `*/5 * * * *` | pipeline | checkAllTenantSLAs | SLA violation detection |
| `*/15 * * * *` | appointments | send24hReminders | 24h appointment reminders |
| `*/15 * * * *` | analytics | evaluateAlerts | Threshold alert rule evaluation |
| `*/30 * * * *` | whatsapp | pollAll | Meta template status polling |
| `*/30 * * * *` | vacation-rental | syncAllFeeds | External iCal feed sync |
| `3,18,33,48 * * * *` | appointments | send1hReminders | 1h appointment reminders |
| `5,35 * * * *` | appointments | markNoShows | Mark no-show appointments |
| `10 * * * *` | analytics | sendPostAppointmentCSAT | Post-appointment survey |
| `20 * * * *` | appointments | autoCompleteAppointments | Auto-complete ended 2+h ago |
| `0 * * * *` | crm | refreshDynamicSegments | Hourly segment membership refresh |
| `0 */2 * * *` | automation | checkStaleConversations | Stale conversation detection |
| `0 */6 * * *` | automation | autoResolveStale | Auto-resolve stale nurturing (72h) |
| `0 */12 * * *` | appointments | renewWatchChannels | Renew Google Calendar push channels |
| `EVERY_HOUR` | billing | reconcilePastDue | Sweep past-due subscriptions |
| `0 2 * * *` | analytics | aggregateYesterday | Nightly metrics aggregation |
| `30 2 * * *` | billing | applyPendingDowngrades | Apply scheduled plan downgrades |
| `0 3 * * *` | offboarding | graceEnforcer | Past-due >7d → offboard |
| `0 3 * * *` | billing | fullReconciliation | Daily billing drift detection |
| `EVERY_DAY_AT_3AM` | feature-requests | recomputeRanking | Re-rank feature requests |
| `0 4 * * *` | offboarding | archiveCleaner | Drop schemas inactive >90d |
| `EVERY_DAY_AT_4AM` | feature-requests | extractConversationalSignals | Mine conversations for feature requests |
| `0 5 * * *` | offboarding | purgeStaleInactiveChannels | Clean stale channel credentials |
| `0 6 * * *` | channels | refreshExpiringSoonTokens | Instagram token refresh (30d window) |
| `0 8 * * 1` | analytics | sendWeeklyReports | Weekly email reports (Monday 8AM) |
| `0 9 * * *` | billing | emitTrialEndingSoon | Trial expiry notifications |
| `0 9 * * *` | recall | processRecalls | Daily re-engagement campaigns |
| `0 8 1 * *` | analytics | sendMonthlyReports | Monthly email reports |
| `0 1 1 * *` | financials | generateMonthlySnapshot | Monthly SaaS financial snapshot |

---

## Dashboard Pages (78 total)

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

### Growth Section (7)

| Route | Purpose | Role | i18n |
|-------|---------|------|------|
| `/admin/broadcast` | Campaign manager (WA templates) | Supervisor+ | ✅ |
| `/admin/automation` | Automation rules wizard (4-step) | Supervisor+ | ✅ |
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
| `/admin/analytics` | Legacy analytics (deprecated, not in sidebar) | Supervisor+ | ⚠️ |
| `/admin/ai` | Legacy LLM config (deprecated, not in sidebar) | Super admin | ⚠️ |

### Channels (8)

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

### Settings (20)

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
| `/admin/settings/integrations/crm` | External CRM connections | Admin | ✅ |
| `/admin/settings/ai-providers` | LLM API keys | Super admin | ✅ |
| `/admin/settings/ai-config` | LLM routing config | Super admin | ✅ |
| `/admin/settings/channels` | Global channel config | Super admin | ✅ |
| `/admin/settings/platform` | Maintenance mode | Super admin | ✅ |
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

### Super Admin Platform (11)

| Route | Purpose | i18n |
|-------|---------|------|
| `/admin/tenants` | Tenant management (6 tabs) | ✅ |
| `/admin/tenants/[tenantId]` | Tenant detail (4 tabs + flags + quotas) | ✅ |
| `/admin/financials` | SaaS financials (5 tabs + CSV export) | ✅ |
| `/admin/usage` | Platform usage / quota tracking | ✅ |
| `/admin/health` | Platform health + BullMQ inspection | ✅ |
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
| Dashboard API client (110+ methods) | `dashboard/src/lib/api.ts` |
| Auth context | `dashboard/src/contexts/AuthContext.tsx` |
| Tenant context | `dashboard/src/contexts/TenantContext.tsx` |
| Sidebar navigation | `dashboard/src/components/layout/AppSidebar.tsx` |
| Settings config | `dashboard/src/app/admin/settings/_settings-config.ts` |
| DB tenant schema template | `api/prisma/tenant-schema.sql` |
| Shared TypeScript types | `packages/shared/src/index.ts` |
