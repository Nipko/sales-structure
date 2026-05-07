# 📋 Changelog — Parallext Engine

> Registro de todos los cambios significativos del proyecto.

---

## v5.2.0 — May 6, 2026 (Tier 1 Verticals Sprint + Channels Hardening)

### Sprint Tier 1 — Three new operational verticals

**Sprint #1 — Tours & Travel Packages** (`turismo` sub-types: `tours`, `agencia_viajes`)
- New schema: `tour_packages` (unified hours-based experiences + days-based packages), `tour_inventory` (per-departure capacity, optional), `tour_bookings` (status: reserved/confirmed/completed/cancelled/no_show)
- New `ToursModule` with 12 REST endpoints under `/tours/:tenantId/...`
- 4 AI tools (gated by `config.tools.tours.enabled`): `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`
- Dashboard: `/admin/tours` (list with sale/rent filter pills + create modal) and `/admin/tours/[id]` (Info/Cupos por fecha/Reservas tabs)
- Bootstrap: 5 ops-focused FAQs (transfer, child discount, languages, cancellation, meeting point) seeded automatically on `tours` / `agencia_viajes` sub-types; `config.tools.tours.enabled = true` flipped on default agent
- 2 vertical agent templates: `tpl_turismo_tours` (Maya — Tours del Día), `tpl_turismo_agencia` (Maya — Agencia de Viajes)

**Sprint #2 — Salud / Dental + transversal recall** (`salud` sub-type: `dental`)
- New schema: `treatment_plans` (multi-session treatments — orthodontics, physiotherapy, aesthetic series, etc.), `treatment_sessions` (per-session tracking, status pending/scheduled/completed/cancelled/no_show), plus `contacts.last_appointment_at` + `contacts.next_recall_at` columns with index
- New `TreatmentPlansModule` with 8 REST endpoints
- 2 AI tools (gated by `config.tools.treatments.enabled`): `get_treatment_plan`, `list_upcoming_sessions`
- Dashboard: `TreatmentPlansCard` collapsible component on lead detail (visible only when vertical=salud)
- New cron 9 AM daily: `RecallService.processRecalls` — re-engages contacts with `last_appointment_at` older than configured threshold via WhatsApp template (transversal: dental 6-month, gym lapse, aesthetic series)
- Recall config endpoints: `GET/PUT /recall/:tenantId/config`, `POST /recall/:tenantId/run-now`
- Hooks added to `appointments.update` and auto-complete cron to keep `contacts.last_appointment_at` fresh
- Vertical agent template: `tpl_salud_dental` (Sofía dental with urgency triggers + treatment plan integration)
- Bootstrap: 5 dental-specific FAQs (insurance, cost, pain management, orthodontics duration, emergencies) on sub-type `dental`

**Sprint #3 — Real Estate Listings** (`inmobiliaria` sub-types: `venta`, `arriendo`, `comercial`, `construccion`)
- New schema: `real_estate_listings` (transaction_type sale/rent + property_kind + price/HOA/deposit + bedrooms/bathrooms/m²/parking/stratum + lat/lon + amenities/images + status), `listing_zone_agents` (neighborhood → agent mapping for routing)
- New `ListingsModule` with 11 REST endpoints (CRUD, search, zone CRUD)
- 2 AI tools (gated by `config.tools.realEstate.enabled`): `search_listings`, `get_listing_details`
- Dashboard: `/admin/listings` (card grid with sale/rent filter) and `/admin/listings/[id]` (full editor with sale-only / rent-only fields)
- Sidebar visible only when vertical=inmobiliaria
- Vertical agent template: `tpl_inmobiliaria_listings` (Carlos with explicit search_listings rules + viewing booking flow)
- Bootstrap: 5 inmobiliaria FAQs (financing, viewings, commissions, documents, HOA)

### Vertical agent templates — 4 industries that had ZERO

Added 8 new templates so finanzas, servicios_profesionales, retail, and technology stop falling through to the generic builtins:
- **finanzas**: Roberto (calificador credit/insurance + renovaciones)
- **servicios_profesionales**: Elena (consulta inicial + seguimiento de casos)
- **retail**: Sofía (ventas + postventa)
- **technology**: Diego (BANT calificador B2B + soporte L1)

Each template ships with industry-tuned tools enabled, behavior rules, forbidden topics, and handoff triggers (e.g. finanzas blocks giving exact rates, servicios_profesionales escalates substantive case questions, retail captures preferences, technology refuses enterprise pricing).

`VERTICAL_PREFIXES` extended on the dashboard with `tpl_finanzas_`, `tpl_legal_`, `tpl_retail_`, `tpl_technology_` so they group under "Recomendados para tu negocio".

### Channels hardening — disconnect actually disconnects

- **Real provider unsubscribe on every channel**: WhatsApp now calls `DELETE /<waba>/subscribed_apps` (was no-op), Telegram captures `deleteWebhook` HTTP status (was best-effort `.catch`), Messenger iterates ALL Pages (was only first), Instagram captures status code, SMS clears `SmsUrl` on every IncomingPhoneNumber via Twilio API
- **`metadata.disconnected_at_provider`** flag stamped per channel — used by reactivate path to decide whether is_active flip is enough or full OAuth reconnect required
- **`audit_logs` row** for every disconnect (manual or via offboarding cron) with `triggeredBy`, `providerOk`, `providerError`
- **Honest UX**: dashboard shows green banner if provider OK, **amber banner** with concrete instruction if provider call failed ("revisar la integración manualmente"). Red banner only for network errors
- **Refresh tokens revoked** on disconnect when provider call succeeded
- **Frontend banners**: 3-state messaging (success/warning/error) on whatsapp/messenger/instagram/telegram/sms. New i18n key `disconnectPartial` × 4 languages
- **Reactivate path**: `OffboardingService.reactivate` now restores channel_accounts that the cron turned off, EXCEPT those marked `disconnected_at_provider=true` (those need fresh OAuth — flipping the flag back on would lie to the user)

### Tenant lifecycle — full purge with provider unsubscribe + media wipe

- **`OffboardingService.purgeTenant(tenantId)`** — 9-step orchestration: providers → queue drain → user IDs captured → public-schema rows (FK-safe order) → DROP SCHEMA CASCADE → `/data/media/{tenantId}/` wipe → tenants row → Redis (incl. refresh tokens per user) → emit `tenant.purged` event
- **`DELETE /offboarding/:tenantId/purge`** super_admin endpoint — irreversible, returns summary `{ channelsDisconnected, publicRowsDeleted, schemaDropped, mediaFilesRemoved, usersRevoked }`
- **`MediaService.deleteAllTenantFiles(tenantId)`** — recursive wipe of `/data/media/{tenantId}/` (logos, product photos, property photos, tour photos, attachments). Path traversal protection
- **New cron 5 AM daily**: `purgeStaleInactiveChannels` — hard-deletes `channel_accounts` rows with `is_active=false` and `disconnected_at >90 days` ago. Patrón Shopify/HubSpot: grace window for reconnect, automatic cleanup after. One audit_log batch per run with the list of purged channels
- **`infra/scripts/delete-tenant.sh`** — dual-mode: with `--api-token` (or `PARALLLY_SUPER_ADMIN_TOKEN` env) calls the purge endpoint (preferred). Without a token, falls back to direct SQL + Redis + filesystem wipe. Also revokes user refresh tokens via `refresh:<userId>:*` Redis keys
- **`infra/scripts/delete-tenant.sql`** — auto-resolves `schema_name` from the `tenants` row (was using display name and silently skipping `DROP SCHEMA`). Per-table `ROW_COUNT` logging. Adds missing `feature_request_subscribers`

### Inbox — recover auto-resolved conversations

`NurturingService` cron auto-marks conversations as `resolved` after 72h of inactivity, but the inbox query hid them with no way to find them. Added:
- New filter `'resolved'` in `getInbox` — inverts the base status filter, orders by `resolved_at DESC`, cap 200 rows
- Endpoint `POST /agent-console/conversation/:tenantId/:id/reopen` — flips status back to `'active'`, clears `resolved_at`
- Frontend: new "Resueltas" pill in the inbox toolbar; when viewing a resolved thread the message input hides and is replaced by a banner with check icon + "Reabrir conversación" button. After reopen, the filter switches to "all" automatically so the thread reappears
- 3 new i18n keys: `filterResolved`, `resolvedBanner`, `reopenConversation` (× 4 languages)

### Onboarding & setup-wizard fixes

- Setup wizard infinite-redirect bug: "Skip" only navigated to `/admin`, but the dashboard checked `setupWizardCompleted` and redirected back. New `POST /persona/:tenantId/setup-wizard/skip` flips the flag; "Finish" without a template now falls through to skip
- Setup wizard now serves vertical-specific templates: `GET /persona/templates?tenantId=...` resolves industry server-side, returns `getVerticalTemplates(industry) + getBuiltinTemplates()` normalised so the existing form code doesn't branch
- `POST /persona/:tenantId/setup-wizard` now resolves the templateId across all 3 sources (legacy, builtins, verticals)

### Vertical onboarding fixes (May 2 backlog)

- i18n industry keys aligned: `educación → education`, `tecnología → technology` in 4 languages (mismatch made dropdowns show empty labels)
- `completeOnboarding` response now includes `verticalConfig`; saved to localStorage so dashboard adapts immediately on first load
- `verticals.service.getVerticalConfig` rebuilds + persists config from `tenant.industry` for tenants created before the persistence fix
- `persona.service.listTemplates` resolves industry server-side from `tenant.settings.verticalConfig.industry || tenant.industry` when not passed by client
- Empty-state strings for finanzas / servicios_profesionales / retail / technology added to `verticalEmptyStates`, `verticalChecklist`, `verticalWelcome` (× 4 languages)
- Sidebar `nav.items.tours` was missing in 4 languages — caused literal "nav.items.tours" rendering

### Properties UX overhaul

- `iCal feed`: payload mapping fix (snake_case → camelCase) — was returning 400 silently. URL validation client-side. How-to panel with 3-step instructions in 4 languages
- `Photos tab` (new dedicated tab): drag-and-drop multi-upload, per-file size + type validation (max 5 photos × 2 MB each), progress bar `n of total`, set-as-cover action, reorder, sticky save bar appears only when dirty. Endpoint corrected (`/media/upload/{tenantId}` not `/media/upload`) and accessToken read from the right localStorage key
- `Calendar tab`: range block (click start → click end → modal with optional note), per-cell source label (Manual / Airbnb / Booking / Vrbo), tooltip with summary, unblock confirmation modal
- `Form numbers`: new `NumberField` component (`type=text` + `inputMode=numeric`) — fixes the "phantom 0 you can't delete" bug. Save now sends camelCase (was silently dropped by backend)
- `Property updateProperty`: response field mapping fixed
- `iCal sync`: auto-trigger sync on feed creation, surface error in UI, correct field names (`feed_name`, `last_sync_at`, `last_sync_status`, `last_sync_error`)
- `IcalExportPublicController` (new): public endpoint `GET /vacation-rental/:tenantId/properties/:propertyId/ical` — what the dashboard tells users to paste into Airbnb/Booking. Resolved 404 that broke external sync
- Media URL resolution: `<img src>` paths now resolve against API origin (`api.parallly-chat.cloud`) not dashboard origin

### Documentation reorganisation

- `CLAUDE.md` reduced 762 → 134 lines; full content moved to:
  - `docs/architecture-detail.md` (prompt layers, 5-tier knowledge, auth, OAuth flows, calendar, observability, BullMQ, pipeline)
  - `docs/modules-reference.md` (40 modules, key files, dashboard pages, cron jobs)
  - `docs/analytics-billing-reference.md` (analytics endpoints, Redis keys, schemas, billing, offboarding, financials, super admin, vertical, vacation rental, CRM, handoff)

---

## v5.1.1 — May 2, 2026

### Navigation Redesign (Definitive)
- **Sidebar corrected**: 3 named sections (OPERACIÓN, CRECIMIENTO, GESTIÓN) with 14 visible items
- Previous 8-item sidebar made platform feel empty — Automation, Channels, Knowledge Base, Users returned to main nav
- **Section grouping**: OPERACIÓN (Conversaciones, CRM, Embudo, Agenda, Propiedades), CRECIMIENTO (Campañas, Automatización, Agente IA, Base de Conocimiento), GESTIÓN (Analíticas, Canales, Usuarios)
- **Premium visual**: left-border active state (Linear pattern), tenant name header, user avatar footer, 240px width
- **Settings cleaned**: 5 sections, ZERO external links (was 8 sections with broken external links)
- **Role-based**: campaigns/automation/KB = supervisor+, aiAgent/users = admin+

### Breadcrumbs & i18n
- **79+ hardcoded strings** migrated to i18n in TopBar
- 47 breadcrumb labels, 7 notification categories, 3 theme labels, 3 user menu entries — all i18n
- 25 missing page labels added (settings subpages, properties, scoring config, etc.)
- New `topbar` namespace with ~90 keys in all 4 language files
- Zero hardcoded strings remaining in TopBar component

### Contextual Help System
- **HelpPanel component** (`components/ui/help-panel.tsx`) on ALL 15 admin pages
- Collapsible "?" pill button → expands to: title, description, YouTube iframe embed, image grid, tips list
- 15 section-specific help contents in 4 languages (~300 keys in `help` i18n namespace)
- YouTube embed: full width, `aspect-video` ratio, fullscreen-capable

---

## v5.1.0 — May 2, 2026

### Navigation Restructure
- **Sidebar reduced from 22 to 8 items** following HubSpot/Intercom/Zendesk patterns
- **Settings reorganized into 8 domain sections**: Account, Company, AI & Automation, Channels, Catalog & Data, Content, Team, Privacy & Advanced
- **Analytics consolidated**: 10 tabs (added CRM + Agents) — no more separate report pages
- **Role-based navigation**: campaigns=supervisor+, aiAgent=admin+, settings sections=admin+
- **10 orphan pages** now accessible via Settings (alerts, policies, landings, scoring config, pre-chat forms, etc.)
- **Propiedades** sidebar item scoped to turismo vertical only

### Onboarding Vertical Overhaul
- **Step 2 adapted per vertical**: "Pacientes particulares" (health), "Compradores" (real estate), etc.
- **Step 3 adapted per vertical**: "¿Cómo ayudará Sofía a tus pacientes?" with industry-specific goals
- **16 vertical agent templates** across 7 industries (salud, belleza, inmobiliaria, restaurantes, automotriz, turismo, educación)
- **Template picker**: "Recomendados para tu negocio" shown first when creating agents, filtered by tenant vertical

### Properties UX Overhaul
- **30 amenities in 6 categories** (was 12 flat checkboxes): Básicos, Dormitorio & Baño, Cocina, Exterior, Servicios, Seguridad
- **Description field** for rich property details in create/edit modal
- **Image gallery** with upload via MediaService — first image is card thumbnail in list view
- **Calendar as Tab 1** (most important view for vacation rental operators)
- **"Sync availability" banner** when no iCal feeds connected, links directly to iCal Feeds tab

### Email Templates Transversal
- **5 new default templates**: property_booking_confirmation, property_check_in_reminder, appointment_confirmation_email, appointment_reminder_email, handoff_notification
- **Automatic email flows**: booking → confirmation email, appointment created → confirmation email, handoff → template instead of hardcoded string
- **Template picker wizard**: 6 presets (appointment confirm, reminder, booking confirm, check-in reminder, welcome, team notification)
- **Total default templates**: 14

### Security Fixes
- **CRITICAL**: `getAvailableAgents()` cross-tenant data leakage — conversations table queried without schema scope. Fixed with `executeInTenantSchema`
- **Schema reuse**: `createTenantSchema()` now detects and cleans stale data when slug is reused after tenant deletion
- **Checklist fallback**: `.has()` check prevents MISSING_MESSAGE errors for undefined vertical keys in onboarding checklist
- **Analytics column**: `date` → `start_at` in appointment queries

---

## v5.0.0 — April 30, 2026

### Vertical Adaptation System (12 Industries)
- **Industry Auto-Bootstrap**: On tenant creation, the entire platform adapts based on selected industry — pipeline stages, AI agent persona, FAQs, services, business hours
- **12 Verticals**: salud, moda_belleza, inmobiliaria, restaurantes, automotriz, turismo, education, finanzas, servicios_profesionales, retail, technology, otro
- **Sub-types**: Each industry has 3-5 sub-types (e.g., salud → dental, medica_general, estetica, psicologia)
- **4-language support**: All vertical definitions in es/en/pt/fr
- **LLM Vertical Context**: `<vertical_context>` XML injected into prompt assembler with customer_noun, transaction_noun — the AI naturally uses industry vocabulary
- **Dashboard Visual Adaptation**: 
  - Contextual welcome ("Bienvenido a tu consultorio virtual, Dr. López")
  - Industry-specific homepage (agenda for clinics, recent leads for real estate)
  - Vertical KPIs (Citas Hoy/No Shows for health; Leads/Test Drives for automotive)
  - Empty states with industry vocabulary on 5 pages × 8 industries
  - Onboarding checklist adapted ("Configura tu asistente médico", "Carga tu menú")
- **Sidebar Adaptation**: Dynamic label overrides (CRM→Pacientes), hidden items (no Inventory for clinics), item reordering
- **useVerticalTerms() Hook**: Locale-aware terminology propagation across contacts, pipeline, inbox, analytics, broadcast, lead detail pages

### Vacation Rental Module
- **Properties CRUD**: Create/manage rental properties with plan-gated limits (starter:2, pro:10, enterprise:50)
- **iCal Import**: Parse Airbnb/Booking.com .ics feeds with node-ical, cron every 30 minutes
- **iCal Export**: Generate .ics feeds with ical-generator for platforms to consume
- **Public Feed**: `GET /public/ical/:tenantSlug/:propertyId/:token/calendar.ics` (no auth)
- **Anti-Double-Booking**: Availability check merges ical_blocks + property_bookings with overlap detection
- **5 AI Agent Tools**: list_properties, check_property_availability, get_property_details, get_check_in_instructions, create_property_booking
- **Dashboard**: Properties list page + detail page with 5 tabs (Info, Calendar, Bookings, iCal Feeds, Check-in)
- **Calendar View**: CSS grid month view with color-coded days (green=available, red=booked, amber=blocked external, gray=past)
- **4 New Tables**: properties, ical_blocks, ical_feeds, property_bookings

### Super Admin Enhancements
- **Tenant Engagement Endpoint**: `GET /tenants/:id/engagement` — messages 7d/30d, active conversations, handoffs, agents/FAQs/services/stages counts
- **Health Score System**: 0-100 per tenant (channels:20 + agent:20 + FAQs:15 + services:10 + activity:35)
- **Tenant Detail**: 6 tabs (added Engagement + AI Config with health score circle, activity KPIs, agents list, pipeline stages)
- **Tenants Overview**: Vertical badge column + health dot indicator
- **Platform Dashboard**: 6 KPIs (tenants, users, active, messagesToday, pendingHandoffs, vertical distribution)
- **Cross-Tenant Metrics**: getPlatformStats() aggregates messages + handoffs across all tenant schemas

### Frontend Features
- **Scoring Config Settings** (`/admin/settings/scoring-config`): Weight sliders (5 factors), purchase keyword tags, score decay toggle with days/factor controls
- **AI Insights Card**: Collapsible card on lead detail page, lazy-loads AI analysis on first expand
- **Deal Approval UI**: Pending/rejected badges on pipeline kanban, terminal stage drag interception, approve/reject actions (admin/supervisor)
- **Advanced Filter Drawer**: Slide-out panel on contacts page with score range, date range, tags + removable filter chips
- **Skill Tags Editor**: Inline tag editor on users page with 8 suggested skills + PUT /auth/users/:userId/skills endpoint
- **DisconnectChannelModal**: Unified custom modal replacing browser confirm() across all 5 channels (WhatsApp, Instagram, Messenger, Telegram, SMS)
- **Channel Cleanup**: Removed webhook config sections (Callback URL, Verify Token) from WhatsApp/Instagram/Messenger — setup is guided
- **WhatsApp Disconnect**: Added POST /channels/whatsapp/disconnect endpoint + disconnect button

### Production Resilience
- **PgBouncer**: DEFAULT_POOL_SIZE 25→50, MAX_CLIENT_CONN 500→1000, query_timeout 30→120s
- **PostgreSQL**: max_connections=200, work_mem=8MB, effective_cache_size=512MB
- **Prisma**: connection_limit per service (API=8, Worker=8, WhatsApp=4)
- **DB Retry**: 5-attempt exponential backoff in API + WhatsApp PrismaService
- **Redis Leaks**: Fixed unmanaged Redis connections in WhatsApp WebhooksService + HealthController
- **NurturingService**: Transaction timeout 15→30s + updated_at pre-filter for heavy queries
- **FeatureRequestsService**: Fixed column name `content` → `content_text`
- **Orders**: Split multi-statement SQL for PgBouncer compatibility
- **Docker**: Health check added to API container, start_period on all services

### Technical Debt Resolved
- Orders multi-statement query split into individual calls ✓
- Feature-requests TypeScript error (was already resolved) ✓
- PgBouncer connection exhaustion (root cause: 30 connections demanded > 25 pool) ✓

---

## v4.0.0 — April 13, 2026

### New Features
- **Google OAuth**: Sign in with Google, auto-link to existing accounts, complete onboarding flow (setup-password → verify-email → onboarding wizard)
- **Media Module**: Image upload with sharp resize (webp), company logo, tags system, public serving with CORP headers
- **Email Templates**: 4 default templates (appointment confirmation, reminder, order confirmation, welcome) with {{variable}} rendering and test send
- **Appointments**: Full scheduling system — CRUD, weekly availability per agent, blocked dates, conflict detection, AI-ready checkAvailableSlots
- **Professional Auth Emails**: Redesigned verification, password reset, 2FA, welcome, and password changed emails (respond.io style)
- **Password Reset**: Public forgot-password flow with 6-digit OTP
- **Email-based 2FA**: send-2fa + verify-2fa endpoints
- **Change Password**: Authenticated password change with current password verification
- **Notification Bell**: 7 categories (messages, handoffs, compliance, appointments, automation, orders, system) with real-time WebSocket events
- **Compliance Review Workflow**: Opt-outs now pending admin review (confirm/reject) instead of auto-blocking. Word-boundary regex prevents false positives

### Infrastructure
- **PgBouncer**: Connection pooler in transaction mode (500 client → 25 PG connections)
- **Sentry**: Error tracking + performance monitoring (@sentry/nestjs)
- **Docker**: 10 containers (added pgbouncer), media_data volume for file storage
- **Prisma directUrl**: Migrations bypass PgBouncer via DIRECT_DATABASE_URL

### Fixes
- Inbox timestamps: fixed field mapping (message.timestamp vs message.created_at)
- Contact "last interaction": now shows actual last inbound message date, not leads.updated_at
- Opt-out false positives: "trabajan" no longer matches keyword "baja" (word-boundary regex)
- Media CORP header: Cross-Origin-Resource-Policy for cross-subdomain image loading
- Deploy ALTER TABLE: split into separate -c flags to prevent cascade failure
- Agent analytics: m.sender → m.direction column fix

---

## [3.1.0] — 2026-03-30

### Pipeline de mensajes
- **Read receipts (checks azules)** — Llamada fire-and-forget a Meta API al recibir webhook
- **Idempotencia de webhooks** — Redis key `idem:wa:{waMessageId}` con TTL 24h
- **BullMQ outbound queue** — Cola `outbound-messages` con 3 reintentos y backoff exponencial
- **Context window truncation** — Historial limitado a 12K chars antes de enviar al LLM
- **Numeric casting** — `Number()` en temperature/maxTokens en los 4 LLM providers

### Handoff interno (sin Chatwoot)
- **HandoffService reescrito** — Usa EventEmitter2 (`handoff.escalated`, `handoff.completed`)
- **AgentConsoleGateway** — Escucha eventos via `@OnEvent`, notifica agentes por WebSocket
- **Auto-assign** — Asigna al agente con menos conversaciones activas

### Broadcast/Campaigns
- **BroadcastService** — Crear campañas, resolver recipients por tags/segmentos
- **BullMQ worker** — Rate limited 80 msg/s (límite Meta API), 3 reintentos
- **campaign_recipients** — Tracking por recipient: pending → queued → sent → delivered → read/failed

### Knowledge Base (RAG)
- **KnowledgeService** — Ingesta de documentos, chunking por párrafos, embeddings OpenAI text-embedding-3-small
- **pgvector** — Búsqueda semántica por cosine similarity en knowledge_chunks
- **Integración en ConversationsService** — Contexto RAG inyectado automáticamente en system prompt

### Arquitectura
- **ChannelTokenService** — Rompe circular dep Conversations↔WhatsApp, cache Redis 5min
- **InternalAuthGuard** — Auth dual JWT/x-internal-key para comunicación service-to-service
- **Meta Graph API v21.0** — Estandarizado en todos los servicios
- **Defensive webhook extraction** — Optional chaining en todo el payload de Meta

### Documentación
- **CLAUDE.md** — Archivos de contexto para raíz, API, Dashboard y WhatsApp service
- **Docs reorganizados** — `docs/specs/`, `docs/roadmap/`, `docs/archive/` con índice
- **MANUAL.md, SECURITY.md, API_REFERENCE.md** — Actualizados al estado actual

---

## [3.0.0] — 2026-03-22

### 📱 WhatsApp Embedded Signup v4 — Servicio Independiente
- **Nuevo servicio `apps/whatsapp`** — NestJS container independiente (puerto 3002) para onboarding de WhatsApp Business
- **OnboardingService** — Flujo completo de 10 pasos: validación → exchange → discovery → persistencia → webhook → sync
- **MetaGraphService** — Cliente completo para Meta Graph API con retry exponential backoff
- **WebhooksController** — Validación HMAC-SHA256, respuesta <5s, procesamiento async
- **WebhooksService** — Resolución de tenant por phoneNumberId con cache 3 capas
- **BullMQ Workers** — Colas webhooks, sync, onboarding, ops con prefijo wa:
- **Cifrado AES-256-GCM** — Tokens de Meta cifrados antes de almacenar
- **7 endpoints REST** — start, get, status (polling), retry, resync, cancel, list
- **Dockerfile.whatsapp** — Multi-stage build, Docker Compose y CI/CD actualizados
- **Prisma** — 2 nuevos modelos: WhatsappOnboarding (17 campos), WhatsappCredential
- **Fix crítico** — whatsapp-webhook.service.ts: resolución dinámica de tenant
- **Frontend** — Componente WhatsAppEmbeddedSignup con FB SDK + FB.login()
- **Documentación** — README, .env.example, CHANGELOG, API_REFERENCE actualizados

---

## [2.4.0] — 2026-03-08

### 📣 Broadcast & Campaign Management
- **Targeted Mass Messaging** — Send templated messages (e.g., WhatsApp, Instagram, Telegram) to all valid contacts simultaneously.
- **Dynamic Variable Injection** — Automatically replace `{{name}}` with the recipient's name from the CRM.
- **Campaign Dashboard** — Re-wired `/admin/broadcast` from mock data to live API. View campaign progress, total delivered, and delivery statuses.
- **Backend Architecture** — New scalable `BroadcastService` taking advantage of `executeInTenantSchema` and generating live `campaigns` and `campaign_logs` tables.
- **Staggered Dispatch** — Integrated minor delays in dispatch loops to minimize risks of channel rate-limiting.

---

## [2.3.0] — 2026-03-08

### 🧾 Quote & Invoice Generation Module
- **HTML Invoice Rendering** — Endpoint `GET /orders/:tenantId/:orderId/invoice` that renders an A4-optimized HTML invoice/quote.
- **Dynamic Content** — Displays Tenant Name, Customer Name, Items list, Quantities, Unit Prices, and Total amounts.
- **Dynamic Title** — Titling changes automatically between "Cotización" (if pending) and "Factura / Recibo" (if paid).
- **Dashboard Action** — Added a "Ver Recibo" quick-action button in the Orders list.

---

## [2.2.0] — 2026-03-08

### 🛒 Order & Reservation Management Module
- **New Dashboard Page** — Added `/admin/orders` to manage customer orders, sales, and reservations.
- **KPI Dashboards** — Total revenue, pending revenue, order count, and average ticket size.
- **Backend Service** — `OrdersService` integrating with the inventory module to adjust stock automatically upon order creation.
- **API Endpoints** — New set of `/orders` protected endpoints.

---

## [2.1.0] — 2026-03-04

### 📦 Inventory Management Module
- **New Dashboard Page** — Added `/admin/inventory` for managing products, categories, stock, and movements.
- **KPI & Stock Alerts** — Dynamic cards for total value, low stock, out of stock, and active items.
- **Backend Service** — `InventoryService` for managing CRUD, schema-level tables (`executeInTenantSchema`), and stock movements.
- **API Endpoints** — New set of `/inventory` protected endpoints.

---

## [2.0.0] — 2026-03-04

### 📡 Telegram Integration + Full Channel Settings
- **TelegramAdapter** — Full `IChannelAdapter` for Telegram Bot API (text, photos, docs, audio, video, voice, locations, contacts, stickers)
- **Webhook Endpoint** — `POST /channels/webhook/telegram` for receiving bot updates
- **Settings Page Enhanced** — 7 configuration tabs: LLM, WhatsApp, Instagram, Messenger, Telegram, General
- **All 4 Channel Adapters** — WhatsApp, Instagram DM, Facebook Messenger, and Telegram fully registered

---

## [1.9.0] — 2026-03-04

### 📱 Multi-Channel: Instagram DM + Facebook Messenger
- **InstagramAdapter** — Full `IChannelAdapter` for Instagram DMs (text, images, story mentions)
- **MessengerAdapter** — Full `IChannelAdapter` for Facebook Messenger (text, images, attachments, quick replies, locations)
- **Webhook Endpoints** — Dedicated `GET/POST /channels/webhook/instagram` and `/channels/webhook/messenger`
- **ChannelsModule** — Both adapters auto-registered via the Gateway pattern
- **Env Variables** — `INSTAGRAM_VERIFY_TOKEN`, `MESSENGER_VERIFY_TOKEN`, `MESSENGER_PAGE_ACCESS_TOKEN`

---

## [1.8.0] — 2026-03-04

### 🤖 Parallext Copilot (AI Assistant)
- **CopilotWidget** — Floating ✨ button + slide-out chat drawer on every admin page
- **Context-Aware** — System prompt includes user role, active tenant, and current page
- **Page Suggestions** — Contextual quick-action buttons per page (e.g. "¿Cómo creo un deal?" on Pipeline)
- **Backend** — `POST /copilot/chat` (NestJS, JWT-protected, OpenAI gpt-4o-mini, graceful fallback)
- **Full Platform Knowledge** — Knows all 13 modules, architecture, roles, and processes

---

## [1.7.0] — 2026-03-04

### 🚀 Complete Sidebar (Final 3 Pages)
- **Conversaciones** (`/admin/conversations`): Global inbox view, status filters, sentiment analysis badges, tag cloud summary
- **AI / LLM Router** (`/admin/ai`): Model latency monitoring (GPT-4o, Claude, etc.), routing rules table, and visual architecture diagram
- **Knowledge Base** (`/admin/knowledge`): RAG document manager, chunk stats, processing status, and web URL ingester

---

## [1.6.0] — 2026-03-04

### 👥 Users Management + 📢 Broadcast
- **Users page** (`/admin/users`): Stats cards, searchable table, role badges, "Nuevo Usuario" modal → `api.registerUser()`
- **Broadcast page** (`/admin/broadcast`): Campaign builder, delivery/read/reply metrics, progress bars, template preview with `{{name}}` substitution, scheduling
- **Sidebar**: Added Broadcast link with Megaphone icon
- **API Client**: Added `registerUser`, `createTenant`, `updateTenant`, `deactivateTenant`

---

## [1.5.0] — 2026-03-04

### ⚡ Interactive CRUD (Functional Dashboard)
- **Pipeline**: "Nuevo Deal" modal (título, contacto, valor, etapa, probabilidad) → `api.createDeal()`
- **Pipeline**: Drag & drop calls `api.moveDeal()` to persist changes + toast notification
- **Inbox**: Send message → optimistic UI + `api.sendMessage()`
- **Inbox**: Add internal note → `api.addNote()`
- **Inbox**: Resolve conversation → `api.resolveConversation()`
- **Automation**: "Nueva regla" modal (nombre, tipo, trigger, descripción) → `api.createRule()`
- **Automation**: Delete rule → `api.deleteRule()` with red toast
- All modals: glassmorphism + backdrop blur + animations

---

## [1.4.1] — 2026-03-04

### 🏢 Tenant Context & Full API Integration
- **TenantContext** (`contexts/TenantContext.tsx`) — Provider + `useTenant()` hook for tenant-scoped API calls
- **TenantSelector** — Dropdown in top bar for super_admin to switch between tenants
- **All 8 pages** connected: Dashboard, Tenants, Inbox, Settings, Pipeline, Analytics, Automation, Contacts
- Pages auto-reload data when super_admin switches tenant
- All pages show **LIVE/DEMO badge** for data source transparency

---

## [1.4.0] — 2026-03-03

### 🔗 Frontend → API Integration
- **API Client** (`lib/api.ts`) — Centralized HTTP client with JWT auth, auto-refresh on 401, 30+ typed methods
- **useApiData hook** (`hooks/useApiData.tsx`) — Loading/error/isLive states, mock data fallback, DataSourceBadge (LIVE/DEMO)
- **Dashboard** — Personalized greeting, live tenant count from API, LIVE/DEMO indicator
- **Tenants page** — Loads real tenants from API, falls back to mock data
- **Auth fixes** — Global prefix `/api/v1`, class-validator decorators, ValidationPipe fix, CORS config
- **Admin seed** — bcrypt-hashed admin user + SQL migration

---

## [1.3.0] — 2026-03-03

### 🔐 Autenticación y Seguridad
- **Auth Context** (`AuthContext.tsx`) — Provider con login, logout, hasRole, persistencia JWT
- **Login page** (`/login`) — Formulario premium con glassmorphism y error handling
- **Route guards** — AdminLayout redirige a /login si no autenticado
- **Top bar** — Muestra nombre, rol, y botón de logout
- **Admin seed** (`005_seed_admin_users.sql`) — super_admin + tenant_admin con bcrypt hash
- **SECURITY.md** — Documentación completa de autenticación y roles

### 📊 Entrega 3: Agent Analytics + CSAT
- **AgentAnalyticsService** — KPIs, leaderboard, CSAT distribution
- **AgentAnalyticsController** — 5 endpoints REST
- **Agent Analytics page** (`/admin/agent-analytics`) — 3 tabs (Overview, Leaderboard, CSAT)
- **Migration** `004_csat_surveys.sql` — Tabla CSAT con rating 1-5

---

## [1.2.0] — 2026-03-03

### 📈 Entrega 2: Sales Pipeline + Automation
- **PipelineService** — Kanban board data, deals CRUD, stage management, forecast
- **AutomationService** — Auto-assign (round-robin), auto-tag (keywords), SLA detection
- **PipelineController** — 10 endpoints REST
- **Pipeline page** (`/admin/pipeline`) — Kanban board con drag & drop
- **Automation page** (`/admin/automation`) — Reglas con toggle switches
- **Migration** `003_pipeline_automation.sql` — 3 tablas + 7 stages + 4 rules seed

---

## [1.1.0] — 2026-03-03

### 💬 Entrega 1: CRM & Live Agent Console
- **AgentConsoleGateway** — WebSocket (Socket.IO) real-time
- **AgentConsoleService** — Inbox, messaging, assignment, notes, AI suggestions
- **CannedResponsesService** — Quick replies con shortcodes y `{{variables}}`
- **AgentConsoleController** — 10 endpoints REST
- **Inbox page** (`/admin/inbox`) — 3 columnas (conversaciones, chat, contacto)
- **Contacts page** (`/admin/contacts`) — Tabla CRM con segments y búsqueda
- **Migration** `002_crm_agent_console.sql` — 3 tablas + enriquecimiento de contactos

---

## [1.0.0] — 2026-03-03

### 🚀 Foundation
- **CI/CD Pipeline** — GitHub Actions → GHCR → Watchtower auto-deploy
- **Multi-tenant architecture** — Schema-per-tenant PostgreSQL
- **LLM Router** — 4 tiers de modelos con 5 factores de routing
- **WhatsApp Cloud API** — Integración directa con Meta
- **Admin Dashboard** — Next.js 16, dark mode, glassmorphism
- **Settings page** — API keys management
- **Cloudflare Tunnel** — Zero Trust networking
