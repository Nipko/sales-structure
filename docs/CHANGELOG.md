# 📋 Changelog — Parallext Engine

> Registro de todos los cambios significativos del proyecto.

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
