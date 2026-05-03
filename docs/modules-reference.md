# Modules Reference

Reference tables for the 40 API modules, key files, and dashboard pages.

---

## API modules (40 total)

| Category | Modules |
|----------|---------|
| **Infrastructure** | prisma, redis, health, throttle, internal |
| **Auth & Tenants** | auth (JWT + refresh rotation + Google OAuth + 2FA + password reset + session management + impersonation), tenants, settings |
| **Message Pipeline** | channels (WhatsApp/IG/Messenger/Telegram/SMS adapters + IG OAuth + Messenger FB SDK + IG token refresh cron), conversations, whatsapp, handoff, agent-console |
| **AI & Config** | ai (router + 5 providers), persona (multi-agent CRUD, templates, channel assignment), knowledge, copilot |
| **CRM & Sales** | crm (leads, contacts, opportunities, custom-attrs, segments, import/export, notes, tasks, activity, scoring, analytics, insights, deal-approval, bulk-update, pipeline-stages), pipeline, catalog |
| **Automation** | automation (rules engine, listener, jobs processor, nurturing, action executor) |
| **Billing & Finance** | billing (MercadoPago adapter, webhook, reconciliation cron, email listeners, plan quotas), financials (SaaS metrics, snapshots, infra costs, exchange rates), offboarding (tenant lifecycle, grace enforcer cron, archive cleaner) |
| **Operations** | broadcast, inventory, orders, compliance, email, email-templates, offers, business-info |
| **Media & Files** | media (upload, resize, logo, tags, serve) |
| **Scheduling** | appointments (CRUD, availability slots, blocked dates, conflict detection, multi-calendar, Google/Microsoft sync) |
| **Identity** | identity (unified profiles, merge suggestions, manual merge, phone normalization) |
| **Analytics** | analytics (Redis counters + DB), dashboard-analytics (KPIs, volume, response times, AI metrics, heatmap, anomalies, cohorts), agent-analytics, alerts, scheduled-reports, csat-trigger, compliance, audit, metrics-aggregation, bi-api |
| **Vertical** | verticals (industry bootstrap, UI config, terminology, vertical-definitions) |
| **Vacation Rental** | vacation-rental (properties CRUD, iCal import/export, availability, 5 AI tools) |
| **Other** | carla (legacy, being replaced), intake (landing pages) |

---

## Key files for common tasks

| Task | Files |
|------|-------|
| Message flow | `conversations/conversations.service.ts` (orchestrator) |
| Add LLM provider | `ai/providers/*.provider.ts`, `ai/router/llm-router.service.ts` |
| Agent persona config | `persona/persona.service.ts`, `persona/persona.controller.ts` |
| Channel adapters | `channels/{channel}/*.adapter.ts`, `channels/channel-gateway.service.ts` |
| Channel management | `channels/channel-management.controller.ts` (connect IG/Messenger/Telegram/SMS) |
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
| **Analytics dashboard** | `analytics/dashboard-analytics.service.ts` |
| **Analytics controller** | `analytics/dashboard-analytics.controller.ts` (12 endpoints) |
| **Alerts system** | `analytics/alerts.service.ts` (CRUD + cron eval every 15min) |
| **Scheduled reports** | `analytics/scheduled-reports.service.ts` |
| **BI API** | `analytics/bi-api.controller.ts` (X-API-Key auth, 7 endpoints) |
| **Metrics cron** | `analytics/metrics-aggregation.service.ts` (nightly @2AM) |
| **Session management** | `auth/auth.service.ts` |
| **Idle timer** | `dashboard/src/hooks/useIdleTimer.ts` |
| **Session modal** | `dashboard/src/components/SessionTimeoutModal.tsx` |
| **Help panel** | `dashboard/src/components/ui/help-panel.tsx` |
| DB tenant schema | `apps/api/prisma/tenant-schema.sql` |
| Shared types | `packages/shared/src/index.ts` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` (105+ methods) |
| Dashboard auth | `apps/dashboard/src/contexts/AuthContext.tsx` |
| Media management | `media/media.service.ts`, `media/media.controller.ts` |
| Email templates | `email-templates/email-templates.service.ts` |
| Appointments | `appointments/appointments.service.ts`, `.controller.ts` |
| Email layouts | `email/email-layouts.ts` |
| Google OAuth | `auth/google-auth.service.ts` |
| Sentry | `instrument.ts` (loaded before all modules) |
| Multi-agent CRUD | `persona/persona.service.ts` |
| Agent templates | `persona/persona.service.ts` (getBuiltinTemplates, saveAsTemplate) |
| Plan features | `throttle/tenant-throttle.service.ts` (PLAN_FEATURES) |
| Agent editor | `dashboard/src/app/admin/agent/[agentId]/page.tsx` |
| Agent list | `dashboard/src/app/admin/agent/page.tsx` |
| Setup banner | `dashboard/src/components/SetupBanner.tsx` |
| SMS adapter | `channels/sms/sms.adapter.ts` |
| IG token refresh | `channels/instagram-token-refresh.service.ts` |
| Offboarding | `offboarding/offboarding.service.ts` (7-step pipeline) |
| Offboarding cron | `offboarding/offboarding-cron.service.ts` |
| Financials | `financials/financials.service.ts` |
| Financial snapshots | `financials/financial-snapshot.service.ts` |
| Billing | `billing/billing.service.ts` |
| Billing webhooks | `billing/webhook.controller.ts` |
| Billing reconciliation | `billing/processors/reconciliation.processor.ts` |
| Impersonation | `auth/auth.service.ts` (impersonate method) |
| Suspended screen | `dashboard/src/components/SuspendedScreen.tsx` |
| Impersonation banner | `dashboard/src/components/ImpersonationBanner.tsx` |
| Financials dashboard | `dashboard/src/app/admin/financials/page.tsx` |
| Billing settings | `dashboard/src/app/admin/settings/billing/page.tsx` |
| Booking engine | `appointments/booking-engine.service.ts` |
| Booking i18n | `appointments/booking-messages.ts` (21 directives x 4 languages) |
| Calendar integrations | `appointments/calendar-integration.service.ts` |
| Intent interpreter | `appointments/intent-interpreter.service.ts` |
| **CRM Analytics** | `crm/services/crm-analytics/crm-analytics.service.ts` |
| **CRM AI Insights** | `crm/services/crm-insights/crm-insights.service.ts` |
| **Phone normalization** | `common/utils/phone.util.ts` (E.164 for LatAm) |
| **Handoff notifications** | `handoff/handoff.service.ts` |
| **SLA escalation** | `agent-console/agent-availability.service.ts` |
| **Appointment completion** | `appointments/appointment-reminders.service.ts` |
| **Calendar reassign** | `appointments/appointments.controller.ts` (reassign-disconnect) |
| **Prompt assembler** | `conversations/prompt-assembler.service.ts` (3-layer + safety) |
| **Identity manual merge** | `identity/identity.controller.ts` (POST manual-merge) |
| **Pipeline stages** | `crm/crm.controller.ts` (CRUD pipeline-stages) |
| **Vertical definitions** | `verticals/vertical-definitions.ts` (12 industries × 4 langs) |
| **Vertical service** | `verticals/verticals.service.ts` |
| **Vertical terms hook** | `dashboard/src/hooks/useVerticalTerms.ts` |
| **Properties service** | `vacation-rental/properties.service.ts` |
| **iCal sync** | `vacation-rental/ical-sync.service.ts` |
| **Scoring config page** | `dashboard/src/app/admin/settings/scoring-config/page.tsx` |
| **Properties pages** | `dashboard/src/app/admin/properties/` |
| **Disconnect modal** | `dashboard/src/components/ui/disconnect-channel-modal.tsx` |

---

## Dashboard pages (60+)

| Section | Pages |
|---------|-------|
| **Auth** | Login (Remember Me, session expired banner), Forgot Password (OTP), Setup Password (Google OAuth), Verify Email (6-digit OTP) |
| **Onboarding** | 5-step company wizard (step 5: plan picker — Starter self-serve, Pro/Enterprise tagged for contact) |
| **Core** | Dashboard, Inbox (WhatsApp-style chat + channel identification + notifications), Trial Countdown Banner |
| **CRM** | Contacts (bulk actions, advanced filters, create modal), Lead Detail (inline edit, archive, custom fields, score breakdown, AI insight), Pipeline/Embudo (Kanban, configurable stages), Segments, CRM Analytics (4 tabs) |
| **AI** | Agent List (multi-agent management, templates), Agent Editor (`/agent/[agentId]` — hub card grid + channel assignment + custom prompt mode), AI Settings |
| **Automation** | Rules (4-step wizard), Settings |
| **Analytics** | Analytics V2 (8 tabs: Overview/AI & Bot/Automation/Campaigns/Channels/CSAT/Anomalies/Cohorts), Agent Performance (legacy 4 tabs) |
| **Channels** | Overview, WhatsApp Setup, Instagram Setup (OAuth popup + callback), Messenger Setup (FB SDK Login), Telegram Setup, SMS/Twilio Setup |
| **Identity** | Merge Suggestions (approve/reject), Manual Merge (cross-channel contacts) |
| **Settings** | General, Custom Attributes, Macros, Pre-Chat Forms, Media, Email Templates, Change Password, **Alerts & Reports**, **Billing**, **Scoring Config** |
| **Scheduling** | Appointments (week/day calendar, agenda, services + staff + modality, config + multi-calendar, analytics), Public Booking (`/book/:tenantSlug`) |
| **Operations** | Broadcast, Inventory, Orders, Compliance, Knowledge Base |
| **Properties** | Properties List (`/admin/properties`), Property Detail (`/admin/properties/[id]` — 5 tabs: Info/Calendar/Bookings/iCal Feeds/Check-in). Sidebar visible only when vertical = turismo |
| **Super Admin** | Tenants Hub (6 tabs), Financials (5 tabs) |
| **Suspended** | SuspendedScreen (full-page block) |
| **Public** | `/kb/[tenantSlug]` (public help center, light theme, no auth) |

---

## Cron Jobs

| Cron | Service | Purpose |
|------|---------|---------|
| `0 1 1 * *` | FinancialSnapshotService | Monthly financial snapshot (1st, 1AM) |
| `0 2 * * *` | MetricsAggregationService | Nightly aggregation into daily_metrics |
| `0 3 * * *` | OffboardingCronService | Grace period enforcer |
| `0 4 * * *` | OffboardingCronService | Archive cleaner (drop schemas inactive >90d) |
| `0 6 * * *` | InstagramTokenRefreshService | Refresh IG tokens expiring within 30 days |
| `*/15 * * * *` | AlertsService | Evaluate threshold alert rules |
| `0 8 * * 1` | ScheduledReportsService | Send weekly email reports (Monday 8AM) |
| `0 8 1 * *` | ScheduledReportsService | Send monthly email reports |
| `*/5 * * * *` | AgentAvailabilityService | Auto-offline inactive agents (15min) |
| `0 */6 * * *` | NurturingService | Auto-resolve stale conversations (72h) |
| `0 */2 * * *` | NurturingService | Check stale conversations for follow-up |
| `*/15 * * * *` | AppointmentRemindersService | Send 24h appointment reminders |
| `3,18,33,48 * * * *` | AppointmentRemindersService | Send 1h appointment reminders |
| `5,35 * * * *` | AppointmentRemindersService | Auto-mark no-shows + follow-up |
| `20 * * * *` | AppointmentRemindersService | Auto-complete confirmed appointments |
| `*/2 * * * *` | AgentAvailabilityService | Escalate stale handoffs (>5 min) |
| `*/30 * * * *` | IcalSyncService | Sync iCal feeds (Airbnb/Booking.com) |
| daily | BillingService | Trial ending soon (3 days before) |
| hourly | ReconciliationProcessor | Past_due sweep + drift detection |
