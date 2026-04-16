# Parallly

**Plataforma multi-tenant de IA conversacional para automatizar ventas en WhatsApp, Instagram, Messenger y Telegram**

[![Deploy](https://github.com/Nipko/sales-structure/actions/workflows/deploy.yml/badge.svg)](https://github.com/Nipko/sales-structure/actions)

| Servicio | URL | Puerto |
|----------|-----|--------|
| Landing | [parallly-chat.cloud](https://parallly-chat.cloud) | 80 |
| Dashboard | [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud) | 3001 |
| API | [api.parallly-chat.cloud](https://api.parallly-chat.cloud) | 3000 |
| WhatsApp Service | [wa.parallly-chat.cloud](https://wa.parallly-chat.cloud) | 3002 |
| KB Portal | [admin.parallly-chat.cloud/kb/{slug}](https://admin.parallly-chat.cloud/kb) | 3001 |
| BI API | [api.parallly-chat.cloud/api/v1/bi-api/](https://api.parallly-chat.cloud/api/v1/bi-api/) | 3000 |

---

## Que es Parallly

Una plataforma SaaS completa que permite a empresas en Latinoamerica automatizar sus ventas y atencion al cliente por mensajeria. Un agente de IA responde a los clientes 24/7 por WhatsApp, Instagram, Messenger y Telegram, califica leads, gestiona el CRM, y escala a agentes humanos cuando es necesario.

### Funcionalidades principales

**Canales de comunicacion (4)**
- WhatsApp Cloud API (Meta Embedded Signup v4)
- Instagram Direct Messages
- Facebook Messenger
- Telegram Bot API
- Arquitectura de adaptadores extensible para agregar nuevos canales

**Agente de IA**
- LLM Router inteligente con 5 proveedores (OpenAI, Anthropic, Google Gemini, DeepSeek, xAI Grok)
- 4 tiers de modelos con routing basado en valor del ticket, complejidad, etapa y sentimiento
- Personalidad configurable via YAML (tono, reglas, conocimiento)
- Knowledge Base con RAG (pgvector embeddings)
- Copilot para agentes humanos (sugerencias en tiempo real)

**CRM integrado**
- Leads con scoring automatico
- Pipeline Kanban con auto-progresion
- Contactos unificados cross-channel (Identity Service)
- Oportunidades de venta
- Segmentos dinamicos con filtros avanzados
- Custom attributes por entidad
- Import/Export CSV
- Notas, tareas, actividad por lead

**Inbox de agentes**
- Bandeja unificada estilo WhatsApp con notificaciones en tiempo real (WebSocket)
- Handoff automatico IA -> humano con 5 tipos de triggers
- Macros (acciones secuenciales predefinidas)
- Snooze de conversaciones con wake-up programado
- Disponibilidad por agente (online/busy/offline con auto-offline)
- CSAT surveys automaticos post-resolucion

**Automatizacion**
- Motor de reglas trigger -> condiciones -> acciones (wizard de 4 pasos)
- Nurturing automatico (3 intentos: 4h, 24h, 72h)
- BullMQ para procesamiento asincronico con retries
- Rate limiting por plan de tenant

**Broadcast y campanas**
- Envio masivo de templates WhatsApp
- Funnel de tracking: enviado -> entregado -> leido -> respondido
- Rate limiting configurable
- Soporte multi-canal

**Analytics completo (8 tabs)**
- Vista General: 6 KPIs con comparacion de periodos + volumen por canal + heatmap de horas pico
- IA & Bot: tasa de resolucion, contencion, costo por conversacion, uso por modelo
- Automatizacion: ejecuciones por regla, tasa de exito, volumen diario
- Campanas: funnel visual por campana con tasas de entrega y lectura
- Canales: distribucion y tendencia por canal
- CSAT: score con visualizacion de estrellas
- Anomalias: deteccion automatica via z-score (2 sigma en ventana de 30 dias)
- Cohortes: matriz de retencion por mes de primer contacto
- Panel real-time: 6 indicadores en vivo (polling 30s)
- Export CSV completo

**Alertas y reportes**
- Alertas por umbral: 6 metricas, evaluacion cada 15min, notificacion por email
- Reportes programados: email HTML semanal o mensual con KPIs y tendencias
- BI API: 7 endpoints con autenticacion por API key para Grafana/Metabase

**Seguridad y compliance**
- JWT con refresh token rotation (Redis-backed)
- Session timeout 60min con warning modal + sync multi-tab
- Google OAuth + email 2FA + password reset
- Cifrado AES-256-GCM para tokens de canales
- 4 roles: super_admin, tenant_admin, tenant_supervisor, tenant_agent
- Opt-out detection automatico + consent tracking
- Audit logging

**Multi-idioma**
- Dashboard y landing en 4 idiomas: Espanol, English, Portugues, Francais
- next-intl con 700+ keys por idioma

**Operaciones**
- Knowledge Base publica por tenant (portal /kb/{slug})
- Inventario y ordenes
- Email templates con editor + preview
- Appointments con slots de disponibilidad, fechas bloqueadas, deteccion de conflictos
- Media management (upload, resize webp, tags, logo)

---

## Arquitectura

```
Internet -> Cloudflare (SSL + Zero Trust Tunnel) -> Docker Stack (VPS 8GB RAM)
    |-- Landing           (Next.js static, port 80)
    |-- Dashboard         (Next.js 16, port 3001)
    |-- API               (NestJS 10, port 3000, 36 modules, Pino + Bull Board)
    |-- Worker            (BullMQ processors + cron jobs)
    |-- WhatsApp Service  (NestJS 10, port 3002)
    |-- PostgreSQL        (pgvector, schema-per-tenant)
    |-- PgBouncer         (transaction mode, 500->25 connections)
    |-- Redis             (cache, counters, BullMQ, refresh tokens)
    |-- Cloudflare Tunnel (cloudflared)
    |-- Sentry            (error tracking + profiling)
    |-- Dozzle            (real-time log viewer, port 9999)
    |-- Uptime Kuma       (endpoint monitoring + alerting, port 3003)
    |-- Grafana           (dashboards + alerting, port 3004)
    |-- Loki              (log aggregation, port 3100)
    |-- Watchtower        (auto-deploy on push to main)
```

### Flujo de mensaje

```
Cliente (WhatsApp/IG/Messenger/Telegram)
    -> Channel API (Meta/Telegram)
    -> API webhooks -> ChannelGatewayService -> IChannelAdapter.handleWebhook()
    -> ConversationsService.processIncomingMessage()
        -> IdentityService (resolver/crear perfil unificado)
        -> PersonaService (cargar config del agente IA)
        -> LLMRouter (seleccionar modelo por tier) -> LLM Provider -> respuesta
        -> OutboundQueueService (BullMQ, prioridad por plan) -> ChannelGatewayService -> Channel API -> Cliente

    Si handoff:
        -> HandoffService -> EventEmitter('handoff.escalated')
        -> AgentConsoleGateway (WebSocket /inbox)
        -> Agente humano responde via Dashboard -> AgentConsoleService -> Channel API
```

---

## Tech Stack

| Capa | Tecnologia |
|------|-----------|
| **Backend** | NestJS 10, TypeScript, Prisma ORM, BullMQ |
| **Frontend** | Next.js 16, React 19, Tailwind CSS, shadcn/ui, recharts, next-intl |
| **Database** | PostgreSQL 16 + pgvector, Redis 7 (noeviction) |
| **AI** | OpenAI GPT-4o, Anthropic Claude, Google Gemini, DeepSeek, xAI Grok |
| **Messaging** | WhatsApp Cloud API, Instagram Graph API, Messenger API, Telegram Bot API |
| **Infra** | Docker, PgBouncer, Cloudflare Tunnel, Nginx, Sentry |
| **CI/CD** | GitHub Actions -> SSH deploy -> Docker rebuild |
| **Monorepo** | npm workspaces + shared types package |

---

## Estructura del Monorepo

```
apps/
  api/          -- NestJS 10, 36 modules. Core business logic
  dashboard/    -- Next.js 16, 45+ pages. Admin panel + agent inbox
  whatsapp/     -- NestJS 10. Embedded Signup + Meta webhook router
  landing/      -- Next.js static export. Marketing site (4 idiomas)
packages/
  shared/       -- TypeScript types compartidos
infra/
  docker/       -- docker-compose (dev + prod), 5 Dockerfiles
  nginx/        -- Reverse proxy config
  scripts/      -- setup-vps.sh, setup-fresh.sh, reset-db.sh
docs/           -- Architecture specs, analytics manual, API reference
```

---

## API Modules (36)

| Categoria | Modulos |
|-----------|---------|
| **Infraestructura** | prisma, redis, health, throttle, internal |
| **Auth & Tenants** | auth (JWT + refresh rotation + Google OAuth + 2FA + session mgmt), tenants, settings |
| **Pipeline de mensajes** | channels (WA/IG/Messenger/Telegram), conversations, whatsapp, handoff, agent-console |
| **IA** | ai (router + 5 providers), persona, knowledge, copilot |
| **CRM & Ventas** | crm (leads, contacts, opportunities, custom-attrs, segments, import/export, notes, tasks, scoring), pipeline, catalog |
| **Automatizacion** | automation (rules engine, listener, processor, nurturing) |
| **Operaciones** | broadcast, inventory, orders, compliance, email, email-templates |
| **Media** | media (upload, resize webp, tags, logo, serve) |
| **Scheduling** | appointments (CRUD, availability, blocked dates, conflicts) |
| **Identidad** | identity (perfiles unificados, merge suggestions) |
| **Analytics** | analytics, dashboard-analytics (12 endpoints), agent-analytics, alerts, scheduled-reports, metrics-aggregation, bi-api, csat-trigger, compliance, audit |

---

## Dashboard (45+ paginas)

| Seccion | Paginas |
|---------|---------|
| **Auth** | Login (Remember Me), Forgot Password, Setup Password, Verify Email |
| **Onboarding** | Wizard de 4 pasos |
| **Core** | Dashboard overview, Inbox (chat real-time + notificaciones) |
| **CRM** | Contactos, Lead Detail, Pipeline Kanban, Segmentos |
| **IA** | Agent Config (wizard 6 pasos + modo custom), AI Settings |
| **Automatizacion** | Rules wizard (4 pasos), Settings |
| **Analytics** | Analytics V2 (8 tabs), Agent Performance (4 tabs legacy) |
| **Canales** | Overview, WhatsApp, Instagram, Messenger, Telegram setup |
| **Identidad** | Merge Suggestions |
| **Settings** | General, Custom Attributes, Macros, Pre-Chat Forms, Media, Email Templates, Change Password, Alertas & Reportes |
| **Scheduling** | Appointments (calendario, lista, disponibilidad) |
| **Operaciones** | Broadcast, Inventario, Ordenes, Compliance, Knowledge Base |
| **Publico** | /kb/{slug} (portal de ayuda, tema claro, sin auth) |

---

## BullMQ Queues (5)

| Queue | Concurrencia | Rate Limit | Proposito |
|-------|-------------|-----------|---------|
| outbound-messages | 5 | 20/s | Entrega de mensajes cross-channel |
| broadcast-messages | 10 | 80/s | Campanas masivas |
| automation-jobs | 10 | 30/s | Acciones de reglas de automatizacion |
| nurturing | 5 | 10/s | Secuencias de follow-up |
| conversation-snooze | 1 | -- | Wake-up de conversaciones snoozeadas |

---

## Cron Jobs (7)

| Horario | Que hace |
|---------|----------|
| Diario 2:00 AM | Agrega metricas del dia anterior en daily_metrics |
| Cada 15 min | Evalua reglas de alerta por umbral |
| Lunes 8:00 AM | Envia reporte semanal por email |
| Dia 1, 8:00 AM | Envia reporte mensual por email |
| Cada 5 min | Auto-offline agentes inactivos (15 min) |
| Cada 6 horas | Auto-resolve conversaciones stale (72h) |
| Cada 2 horas | Detecta conversaciones stale y programa nurturing |

---

## Setup Local

```bash
# Clonar
git clone https://github.com/Nipko/sales-structure.git
cd sales-structure

# Instalar dependencias
npm install

# Configurar variables
cp .env.example .env
# Editar .env con credenciales

# Levantar DB y Redis
cd infra/docker && docker compose up -d

# Migraciones
cd apps/api && npx prisma migrate dev

# Desarrollo
npm run dev              # API (:3000) + Dashboard (:3001) + WhatsApp (:3002)
npm run dev:api          # Solo API
npm run dev:dashboard    # Solo Dashboard
npm run dev:whatsapp     # Solo WhatsApp
```

---

## Verificacion antes de push

```bash
cd apps/api && npx tsc --noEmit        # Type errors
cd apps/api && npm run test:bootstrap  # NestJS DI errors
cd apps/dashboard && npx tsc --noEmit  # Dashboard types
cd apps/landing && npx tsc --noEmit    # Landing types
```

---

## Deploy (Produccion)

Push a `main` -> GitHub Actions -> build 5 Docker images -> SSH deploy -> migrate (DIRECT_DATABASE_URL) -> restart containers

VPS: Hostinger Ubuntu, Docker (10 containers incl. PgBouncer), Cloudflare Tunnel

---

## Documentacion

| Documento | Descripcion |
|-----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Contexto tecnico completo para desarrollo |
| [docs/analytics-manual.md](docs/analytics-manual.md) | Manual de analytics, alertas, BI API, anomalias, cohortes |
| [docs/observability-manual.md](docs/observability-manual.md) | Manual de observabilidad: Pino, Bull Board, Grafana, Loki, Uptime Kuma |
| [docs/SECURITY.md](docs/SECURITY.md) | Autenticacion, JWT, RBAC, cifrado |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Endpoints REST, WebSocket, BullMQ |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Historial de cambios |

---

## Licencia

Propiedad de Parallext / Nipko. Todos los derechos reservados.
