# 📖 Parallext Engine — Manual de la Plataforma

> Versión 3.0.0 · Actualizado: Marzo 22, 2026

---

## 📑 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Módulos del Backend (API)](#módulos-del-backend-api)
4. [WhatsApp Onboarding Service](#whatsapp-onboarding-service)
5. [Dashboard (Frontend)](#dashboard-frontend)
6. [Base de Datos](#base-de-datos)
7. [API Reference](#api-reference)
8. [Autenticación y Roles](#autenticación-y-roles)
9. [Despliegue y CI/CD](#despliegue-y-cicd)
10. [Configuración del Entorno](#configuración-del-entorno)

---

## 1. Visión General

**Parallext Engine** es una plataforma multi-tenant de IA conversacional que permite a empresas automatizar ventas y atención al cliente por WhatsApp, con un CRM integrado, pipeline de ventas, y analytics de agentes.

### Capacidades principales:
- 🏢 **Multi-tenant** con aislamiento schema-per-tenant en PostgreSQL
- 🤖 **IA Conversacional** con router inteligente de 4 tiers de modelos LLM
- 📱 **WhatsApp Cloud API** integración directa con Meta
- 💼 **CRM completo** — Inbox en tiempo real, contactos, pipeline de ventas
- ⚡ **Automatización** — Auto-asignación, auto-tag, SLA, follow-ups
- 📊 **Analytics** — Leaderboard de agentes, CSAT, métricas en tiempo real
- 🛡️ **Seguridad** — JWT + refresh tokens, RBAC, Cloudflare Zero Trust

---

## 2. Arquitectura del Sistema

```
Internet → Cloudflare (SSL + Zero Trust Tunnel) → Docker Stack (VPS)
   ├── 📊 Dashboard         (Next.js 16, port 3001)
   ├── 🔌 API               (NestJS 10, port 3000)
   ├── 📱 WhatsApp Service   (NestJS 10, port 3002)
   ├── 🐘 PostgreSQL         (pgvector, schema-per-tenant)
   ├── 🔴 Redis              (caché, contadores, BullMQ)
   └── 🌐 Tunnel             (cloudflared)
```

### Flujo de un mensaje WhatsApp:
```
WhatsApp → Meta Cloud API → Webhook → Channel Gateway → Conversation Orchestrator
    → Persona Engine → LLM Router → Respuesta → WhatsApp
    → (si handoff) → Agent Console WebSocket → Agente humano
```

---

## 3. Módulos del Backend (API)

### 3.1 Auth (`/auth`)
Sistema de autenticación con JWT.

| Endpoint | Método | Descripción |
|----------|--------|------------|
| `/auth/login` | POST | Login con email/password → tokens |
| `/auth/register` | POST | Crear usuario (solo admins) |
| `/auth/refresh` | POST | Renovar access token |
| `/auth/me` | POST | Info del usuario autenticado |

**Roles disponibles:**
- `super_admin` — Control total de la plataforma
- `tenant_admin` — Admin de un tenant específico
- `tenant_supervisor` — Supervisor de agentes
- `tenant_agent` — Agente de atención

---

### 3.2 Agent Console (`/api/v1/agent-console`)
Console de agente en tiempo real con WebSocket.

| Endpoint | Método | Descripción |
|----------|--------|------------|
| `/api/v1/agent-console/inbox/:tenantId` | GET | Bandeja de entrada con filtros |
| `/api/v1/agent-console/conversation/:tenantId/:id` | GET | Detalle de conversación |
| `/api/v1/agent-console/conversation/:tenantId/:id/message` | POST | Enviar mensaje como agente |
| `/api/v1/agent-console/conversation/:tenantId/:id/assign` | PUT | Asignar conversación |
| `/api/v1/agent-console/conversation/:tenantId/:id/resolve` | PUT | Resolver conversación |
| `/api/v1/agent-console/conversation/:tenantId/:id/note` | POST | Agregar nota interna |
| `/api/v1/agent-console/stats/:tenantId` | GET | Estadísticas del agente |
| `/api/v1/agent-console/canned-responses/:tenantId` | GET | Respuestas rápidas |
| `/api/v1/agent-console/ai-suggest/:tenantId/:id` | GET | Sugerencia IA |

**WebSocket Events** (namespace `/agent`):
| Evento | Dirección | Descripción |
|--------|-----------|------------|
| `agent:join` | → Server | Agente se conecta |
| `conversation:open` | → Server | Abrir conversación |
| `conversation:send` | → Server | Enviar mensaje |
| `conversation:assign` | → Server | Asignar |
| `conversation:resolve` | → Server | Resolver |
| `agent:typing` | → Server | Indicador de escritura |
| `inbox:update` | ← Server | Actualización de bandeja |
| `inbox:new_message` | ← Server | Nuevo mensaje entrante |
| `conversation:message` | ← Server | Mensaje en conversación abierta |
| `conversation:resolved` | ← Server | Conversación resuelta |

**Respuestas Rápidas (Canned Responses):**
- Uso de `/shortcode` en el input para insertar respuestas predefinidas
- Variables interpolables: `{{nombre}}`, `{{telefono}}`, `{{empresa}}`
- CRUD completo para gestionar shortcodes

---

### 3.3 Pipeline de Ventas (`/api/v1/pipeline`)
Gestión de oportunidades de venta estilo Kanban.

| Endpoint | Método | Descripción |
|----------|--------|------------|
| `/api/v1/pipeline/kanban/:tenantId` | GET | Datos del tablero Kanban |
| `/api/v1/pipeline/stages/:tenantId` | GET | Listar etapas |
| `/api/v1/pipeline/stages/:tenantId` | POST | Crear etapa |
| `/api/v1/pipeline/deals/:tenantId` | POST | Crear deal |
| `/api/v1/pipeline/deals/:tenantId/:dealId/move` | PUT | Mover deal entre etapas |
| `/api/v1/pipeline/deals/:tenantId/:dealId` | PUT | Actualizar deal |

**Etapas por defecto:**
1. Lead nuevo (10%)
2. Contactado (25%)
3. Calificado (50%)
4. Propuesta enviada (70%)
5. Negociación (85%)
6. Cerrado ganado (100%)
7. Cerrado perdido (0%)

**Forecast:** Calcula valor total, valor ponderado (por probabilidad), y promedio por deal.

---

### 3.4 Automatización (`/api/v1/pipeline/automation`)
Motor de reglas para automatizar procesos.

| Endpoint | Método | Descripción |
|----------|--------|------------|
| `/api/v1/pipeline/automation/:tenantId` | GET | Listar reglas |
| `/api/v1/pipeline/automation/:tenantId` | POST | Crear regla |
| `/api/v1/pipeline/automation/:tenantId/:ruleId/toggle` | PUT | Activar/desactivar regla |
| `/api/v1/pipeline/automation/:tenantId/:ruleId` | DELETE | Eliminar regla |
| `/api/v1/pipeline/automation/:tenantId/sla-violations` | GET | Ver violaciones SLA |

**Tipos de regla:**
| Tipo | Descripción |
|------|------------|
| `auto_assign` | Asigna conversaciones por round-robin al pool de agentes |
| `auto_tag` | Etiqueta contactos automáticamente basado en keywords del mensaje |
| `sla_alert` | Alerta cuando se excede el tiempo máximo de respuesta |
| `auto_reply` | Envía respuesta automática (ej: fuera de horario) |
| `follow_up` | Mensaje de seguimiento tras inactividad del contacto |

---

### 3.5 Analytics de Agentes (`/api/v1/analytics`)

| Endpoint | Método | Descripción |
|----------|--------|------------|
| `/api/v1/analytics/overview/:tenantId` | GET | KPIs generales |
| `/api/v1/analytics/agents/:tenantId` | GET | Leaderboard de agentes |
| `/api/v1/analytics/csat/:tenantId` | GET | Respuestas CSAT |
| `/api/v1/analytics/csat/:tenantId/distribution` | GET | Distribución 1-5 estrellas |
| `/api/v1/analytics/csat/:tenantId` | POST | Enviar encuesta CSAT |

**KPIs del overview:**
- Total de conversaciones
- Resueltas hoy
- Tiempo promedio de primera respuesta
- Tiempo promedio de resolución
- CSAT promedio + tendencia semanal
- Agentes activos
- Tasa de handoff IA→humano
- % resolución automática sin humano

---

### 3.6 Tenants (`/api/v1/tenants`)
Gestión multi-tenant.

| Endpoint | Método | Descripción |
|----------|--------|------------|
| `/api/v1/tenants` | GET | Listar todos los tenants |
| `/api/v1/tenants/:id` | GET | Detalle de tenant |
| `/api/v1/tenants` | POST | Crear tenant (crea schema aislado) |

---

### 3.7 Settings (`/api/v1/settings`)
Configuración de API keys y servicios.

| Endpoint | Método | Descripción |
|----------|--------|------------|
| `/api/v1/settings/api-keys` | GET | Listar API keys |
| `/api/v1/settings/api-keys` | POST | Agregar/actualizar API key |
| `/api/v1/settings/api-keys/:provider` | DELETE | Eliminar API key |

---

### 3.8 Otros Módulos

| Módulo | Descripción |
|--------|------------|
| **Channels** | Gateway de mensajería, adaptador WhatsApp Cloud API |
| **AI** | LLM Router inteligente (4 tiers), providers OpenAI/Claude/Gemini/Grok/DeepSeek |
| **Conversations** | Orquestador principal de conversaciones |
| **Persona** | Motor de personalidades configurables via YAML |
| **Knowledge** | RAG pipeline con pgvector para embeddings |
| **Handoff** | Detección de 5 tipos de triggers para escalación humana |
| **Health** | Health check endpoint |

---

## 4. WhatsApp Onboarding Service (puerto 3002)

Servicio NestJS independiente que maneja el flujo completo de **WhatsApp Embedded Signup v4**.

**Base URL**: `https://wa.parallly-chat.cloud/api/v1`

### 4.1 Onboarding (`/onboarding`)

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|------------|
| `/onboarding/start` | POST | ✅ admin | Iniciar Embedded Signup (10 pasos) |
| `/onboarding/:id` | GET | ✅ | Detalle completo |
| `/onboarding/:id/status` | GET | ✅ | Estado para polling |
| `/onboarding/:id/retry` | POST | ✅ admin | Reintentar fallido |
| `/onboarding/:id/resync` | POST | ✅ admin | Re-sync templates/phones |
| `/onboarding/:id` | DELETE | ✅ admin | Cancelar en progreso |
| `/onboarding` | GET | ✅ super | Listar todos |

### 4.2 Webhooks (`/webhooks/whatsapp`)

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|------------|
| `/webhooks/whatsapp` | GET | Público | Verificación Meta (challenge/response) |
| `/webhooks/whatsapp` | POST | HMAC-SHA256 | Recibir eventos webhook |

### 4.3 Flujo de Onboarding (10 pasos)
```
1. Validar pre-condiciones (tenant, config, no duplicados)
2. Crear registro WhatsappOnboarding
3. Exchange code → access_token (Meta Graph API)
4. Descubrir WABAs + phone numbers
5. Persistir canal en tenant schema
6. Registrar channel_account público
7. Almacenar credential cifrada (AES-256-GCM)
8. Suscribir webhook de la WABA
9. Sincronizar templates (async, BullMQ)
10. Marcar COMPLETED
```

### 4.4 Seguridad
- **JWT compartido** con API via `INTERNAL_JWT_SECRET`
- **HMAC-SHA256** validación de firma de webhooks Meta
- **AES-256-GCM** cifrado de tokens almacenados
- **Cache 3 capas** para resolución de tenant (memoria + Redis + DB)
- **Idempotencia** con dedupe keys en Redis

### 4.5 BullMQ Queues (prefijo `wa:`)
- `webhooks` — mensajes, statuses, template updates, account updates
- `sync` — sincronización de templates y teléfonos
- `onboarding` / `ops` — reservadas para futuras tareas

---

## 5. Dashboard (Frontend)

### Páginas disponibles:

| Ruta | Página | Descripción |
|------|--------|------------|
| `/admin` | Dashboard | Overview con KPIs y estadísticas generales |
| `/admin/inbox` | Inbox | Consola de agente 3 columnas (conversaciones, chat, contacto) |
| `/admin/contacts` | Contactos | Tabla CRM con segmentos, búsqueda, tags, lifetime value |
| `/admin/pipeline` | Pipeline | Tablero Kanban drag & drop con forecast |
| `/admin/automation` | Automatización | Reglas con toggle, triggers, stats de ejecución |
| `/admin/agent-analytics` | Analytics | 3 tabs: Resumen KPIs, Leaderboard, CSAT |
| `/admin/tenants` | Tenants | Gestión de clientes/empresas |
| `/admin/settings` | Configuración | API keys, webhooks, integrations |
| `/login` | Login | Autenticación (JWT) |

### Sidebar de navegación:
Inbox → Dashboard → Tenants → Contactos → Pipeline → Automatización → Conversaciones → AI/LLM → Knowledge → Analytics → Usuarios → Configuración

### Arquitectura Frontend-API:

**API Client** (`lib/api.ts`):
- Cliente HTTP centralizado con JWT auto-refresh
- 30+ métodos tipados para todos los módulos
- Si 401 → auto-refresh token → retry → si falla → logout

**TenantContext** (`contexts/TenantContext.tsx`):
- `super_admin`: Selector dropdown en el top bar para cambiar tenant
- `tenant_admin / agent`: Usa su tenantId asignado automáticamente
- Al cambiar tenant, todas las páginas recargan datos

**DataSourceBadge** (● LIVE / ● DEMO):
- Cada página muestra si los datos son reales (API) o mock
- Si la API devuelve datos → badge verde **LIVE**
- Si la API falla → datos mock con badge amarillo **DEMO**

```
Page → useEffect → api.getXXX(tenantId)
                      ↓
              lib/api.ts → authFetch()
                      ↓
          ┌─ 200 → setState(data) → ● LIVE
          ├─ 401 → refreshToken → retry
          └─ Error → keep mock → ● DEMO
```

---

## 6. Base de Datos

### Esquema Global (public):
- `tenants` — Empresas clientes
- `users` — Usuarios del sistema con roles
- `whatsapp_onboardings` — Registro del flujo de onboarding (17 campos)
- `whatsapp_credentials` — Tokens cifrados AES-256-GCM por tenant
- `channel_accounts` — Registro de canales activos para routing de webhooks

### Esquema por Tenant (ej: `tenant_gecko`):
- `contacts` — Contactos CRM (tags, segment, custom_fields, lifetime_value)
- `conversations` — Conversaciones con status y metadata
- `messages` — Mensajes con sender (customer/ai/agent/system)
- `conversation_assignments` — Asignaciones agente-conversación con SLA
- `internal_notes` — Notas internas entre agentes
- `canned_responses` — Respuestas rápidas con shortcodes
- `pipeline_stages` — Etapas del pipeline configurables
- `deals` — Oportunidades de venta
- `automation_rules` — Reglas de automatización
- `csat_surveys` — Encuestas de satisfacción (1-5 estrellas)
- `knowledge_chunks` — Trozos de conocimiento con embeddings
- `whatsapp_channels` — Canales WhatsApp conectados (con campos `is_coexistence`, `onboarding_id`)
- `whatsapp_templates` — Templates sincronizados desde Meta
- `whatsapp_webhook_events` — Log de eventos webhook con dedup
- `whatsapp_message_logs` — Log detallado de mensajes WA

### Migraciones:
1. `001_base_schema.sql` — Esquema base (conversations, contacts, messages)
2. `002_crm_agent_console.sql` — CRM (notes, canned_responses, assignments)
3. `003_pipeline_automation.sql` — Pipeline (stages, deals, rules)
4. `004_csat_surveys.sql` — CSAT

---

## 7. API Reference

### Formato de respuesta estándar:
```json
{
  "success": true,
  "data": { ... }
}
```

### Errores:
```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

### Autenticación:
```
Authorization: Bearer <access_token>
```

---

## 8. Autenticación y Roles

### Flujo de login:
```
POST /auth/login { email, password }
→ { accessToken (15m), refreshToken (7d), user }
```

### Flujo de refresh:
```
POST /auth/refresh { refreshToken }
→ { accessToken (15m) }
```

### Matriz de permisos:

| Acción | super_admin | tenant_admin | tenant_supervisor | tenant_agent |
|--------|:-----------:|:------------:|:-----------------:|:------------:|
| Ver todos los tenants | ✅ | ❌ | ❌ | ❌ |
| Crear tenants | ✅ | ❌ | ❌ | ❌ |
| Crear usuarios | ✅ | ✅ (su tenant) | ❌ | ❌ |
| Ver inbox | ✅ | ✅ | ✅ | ✅ |
| Asignar conversaciones | ✅ | ✅ | ✅ | ❌ |
| Resolver conversaciones | ✅ | ✅ | ✅ | ✅ |
| Gestionar pipeline | ✅ | ✅ | ✅ | ✅ |
| Crear reglas de automatización | ✅ | ✅ | ❌ | ❌ |
| Ver analytics | ✅ | ✅ | ✅ | ❌ |
| Gestionar API keys | ✅ | ✅ | ❌ | ❌ |
| Gestionar configuración | ✅ | ✅ | ❌ | ❌ |

---

## 9. Despliegue y CI/CD

### Pipeline automático:
```
Push a main → GitHub Actions → Build Docker images → Push a GHCR
→ Watchtower (VPS) → Pull automático → Deploy sin downtime
```

### Contenedores en producción:
| Container | Imagen | Puerto |
|-----------|--------|--------|
| parallext-api | ghcr.io/nipko/parallext-api | 3000 |
| parallext-dashboard | ghcr.io/nipko/parallext-dashboard | 3001 |
| parallext-whatsapp | ghcr.io/nipko/parallext-whatsapp | 3002 |
| parallext-postgres | postgres:16 | 5432 |
| parallext-redis | redis:7-alpine | 6379 |
| parallext-tunnel | cloudflare/cloudflared | — |
| parallext-watchtower | containrrr/watchtower | — |

### Deploy manual (emergencia):
```bash
ssh root@VPS
cd /opt/parallext-engine
git pull origin main
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
```

---

## 10. Configuración del Entorno

### Variables de entorno (`.env`):
```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/parallext
DB_PASSWORD=...

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Auth (compartido API + WhatsApp)
INTERNAL_JWT_SECRET=...

# AI Providers
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_AI_KEY=...

# WhatsApp Service (puerto 3002)
ENCRYPTION_KEY=... (64 caracteres hex)
META_APP_ID=...
META_APP_SECRET=...
META_VERIFY_TOKEN=...
META_CONFIG_ID=...
META_GRAPH_VERSION=v21.0

# Frontend
NEXT_PUBLIC_API_URL=https://api.parallly-chat.cloud/api/v1
NEXT_PUBLIC_WA_SERVICE_URL=https://wa.parallly-chat.cloud/api/v1
NEXT_PUBLIC_META_APP_ID=...
NEXT_PUBLIC_META_CONFIG_ID=...

# Cloudflare
CLOUDFLARE_TUNNEL_TOKEN=...
```

---

## 📞 Soporte

Para dudas técnicas o nuevas funcionalidades, contactar al equipo de desarrollo.

**URLs de producción:**
- Dashboard: https://admin.parallly-chat.cloud/admin
- API: https://api.parallly-chat.cloud
- WhatsApp Service: https://wa.parallly-chat.cloud

---

*Última actualización: 2026-03-22 — v3.0.0*
