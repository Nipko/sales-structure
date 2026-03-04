# 📋 Changelog — Parallext Engine

> Registro de todos los cambios significativos del proyecto.

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
