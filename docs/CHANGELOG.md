# 📋 Changelog — Parallext Engine

> Registro de todos los cambios significativos del proyecto.

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
- **Settings Page Enhanced** — 7 configuration tabs: LLM, WhatsApp, Instagram, Messenger, Telegram, Chatwoot, General
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
