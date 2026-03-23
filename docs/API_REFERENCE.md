# 🗂️ Estructura de la API — Parallext Engine

> Referencia rápida de todos los módulos y endpoints del backend.
> Actualizado: Marzo 22, 2026

---

## Módulos

| Módulo | Directorio | Endpoints | Descripción |
|--------|-----------|-----------|------------|
| Auth | `modules/auth/` | 4 | JWT login, register, refresh, me |
| Agent Console | `modules/agent-console/` | 9 + WS | Inbox, chat, notas, canned responses |
| Pipeline | `modules/pipeline/` | 6 | Kanban, deals CRUD, stages |
| Automation | `modules/pipeline/` | 5 | Rules engine, SLA detection |
| Analytics | `modules/analytics/` | 5 | KPIs, leaderboard, CSAT |
| Tenants | `modules/tenants/` | 3 | Multi-tenant CRUD |
| Settings | `modules/settings/` | 3 | API keys management |
| Channels | `modules/channels/` | — | WhatsApp webhook, gateway |
| AI | `modules/ai/` | — | LLM Router, providers |
| Conversations | `modules/conversations/` | — | Orchestrator |
| Persona | `modules/persona/` | — | YAML persona engine |
| Knowledge | `modules/knowledge/` | — | RAG pipeline |
| Handoff | `modules/handoff/` | — | Escalation triggers |
| Health | `modules/health/` | 1 | Health check |

### Servicio WhatsApp (puerto 3002) — `apps/whatsapp`

| Módulo | Directorio | Endpoints | Descripción |
|--------|-----------|-----------|------------|
| Onboarding | `modules/onboarding/` | 7 | Embedded Signup v4 flow |
| Webhooks | `modules/webhooks/` | 2 | Meta webhook handler (HMAC) |
| Meta Graph | `modules/meta-graph/` | — | Graph API client with retry |
| Jobs | `modules/jobs/` | — | BullMQ workers |
| Assets | `modules/assets/` | — | Template & phone sync |
| Audit | `modules/audit/` | — | Audit logging |
| Health | `modules/health/` | 2 | Liveness + readiness probes |

---

## Endpoints por módulo

### Auth (`/auth`)
| Método | Ruta | Auth | Roles |
|--------|------|------|-------|
| POST | `/auth/login` | ❌ | — |
| POST | `/auth/register` | ✅ | super_admin, tenant_admin |
| POST | `/auth/refresh` | ❌ | — |
| POST | `/auth/me` | ✅ | any |

### Agent Console (`/api/v1/agent-console`)
| Método | Ruta | Descripción |
|--------|------|------------|
| GET | `/inbox/:tenantId` | Bandeja de entrada |
| GET | `/conversation/:tenantId/:id` | Detalle |
| POST | `/conversation/:tenantId/:id/message` | Enviar mensaje |
| PUT | `/conversation/:tenantId/:id/assign` | Asignar agente |
| PUT | `/conversation/:tenantId/:id/resolve` | Resolver |
| POST | `/conversation/:tenantId/:id/note` | Nota interna |
| GET | `/stats/:tenantId` | Estadísticas |
| GET | `/canned-responses/:tenantId` | Respuestas rápidas |
| GET | `/ai-suggest/:tenantId/:id` | Sugerencia IA |

### Pipeline (`/api/v1/pipeline`)
| Método | Ruta | Descripción |
|--------|------|------------|
| GET | `/kanban/:tenantId` | Board Kanban |
| GET | `/stages/:tenantId` | Listar etapas |
| POST | `/stages/:tenantId` | Crear etapa |
| POST | `/deals/:tenantId` | Crear deal |
| PUT | `/deals/:tenantId/:dealId/move` | Mover deal |
| PUT | `/deals/:tenantId/:dealId` | Actualizar deal |

### Automation (`/api/v1/pipeline/automation`)
| Método | Ruta | Descripción |
|--------|------|------------|
| GET | `/:tenantId` | Listar reglas |
| POST | `/:tenantId` | Crear regla |
| PUT | `/:tenantId/:ruleId/toggle` | Activar/desactivar |
| DELETE | `/:tenantId/:ruleId` | Eliminar |
| GET | `/:tenantId/sla-violations` | Violaciones SLA |

### Analytics (`/api/v1/analytics`)
| Método | Ruta | Descripción |
|--------|------|------------|
| GET | `/overview/:tenantId` | KPIs generales |
| GET | `/agents/:tenantId` | Leaderboard |
| GET | `/csat/:tenantId` | Respuestas CSAT |
| GET | `/csat/:tenantId/distribution` | Distribución 1-5 |
| POST | `/csat/:tenantId` | Enviar CSAT |

### Settings (`/api/v1/settings`)
| Método | Ruta | Descripción |
|--------|------|------------|
| GET | `/api-keys` | Listar API keys |
| POST | `/api-keys` | Crear/actualizar |
| DELETE | `/api-keys/:provider` | Eliminar |

---

## WebSocket Events (namespace `/agent`)

### Cliente → Servidor
| Event | Payload | Descripción |
|-------|---------|------------|
| `agent:join` | `{ agentId, tenantId }` | Conectar agente |
| `conversation:open` | `{ conversationId }` | Abrir chat |
| `conversation:send` | `{ conversationId, content, type }` | Enviar mensaje |
| `conversation:assign` | `{ conversationId, agentId }` | Asignar |
| `conversation:resolve` | `{ conversationId }` | Resolver |
| `agent:typing` | `{ conversationId, typing }` | Escribiendo |

### Servidor → Cliente
| Event | Payload | Descripción |
|-------|---------|------------|
| `inbox:update` | `InboxData` | Actualización completa |
| `inbox:new_message` | `{ conversationId, message }` | Nuevo mensaje |
| `inbox:assigned` | `{ conversationId }` | Asignación recibida |
| `inbox:refresh` | — | Recargar inbox |
| `conversation:message` | `Message` | Mensaje en chat abierto |
| `conversation:resolved` | `{ conversationId }` | Chat cerrado |

---

## Migraciones SQL

| # | Archivo | Tablas |
|---|---------|--------|
| 001 | `001_base_schema.sql` | conversations, contacts, messages |
| 002 | `002_crm_agent_console.sql` | internal_notes, canned_responses, conversation_assignments |
| 003 | `003_pipeline_automation.sql` | pipeline_stages, deals, automation_rules |
| 004 | `004_csat_surveys.sql` | csat_surveys |
| 005 | `005_seed_admin_users.sql` | Seed: admin users |

---

## WhatsApp Onboarding Service (puerto 3002)

> Base URL: `https://wa.parallly-chat.cloud/api/v1`

### Onboarding (`/onboarding`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|------------|
| POST | `/onboarding/start` | ✅ | super_admin, tenant_admin | Iniciar onboarding WA Embedded Signup |
| GET | `/onboarding/:id` | ✅ | any | Detalle completo |
| GET | `/onboarding/:id/status` | ✅ | any | Estado (para polling) |
| POST | `/onboarding/:id/retry` | ✅ | super_admin, tenant_admin | Reintentar fallido |
| POST | `/onboarding/:id/resync` | ✅ | super_admin, tenant_admin | Re-sync assets |
| DELETE | `/onboarding/:id` | ✅ | super_admin, tenant_admin | Cancelar en progreso |
| GET | `/onboarding` | ✅ | super_admin | Listar todos |

### Webhooks (`/webhooks/whatsapp`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| GET | `/webhooks/whatsapp` | Público | Verificación Meta (challenge) |
| POST | `/webhooks/whatsapp` | HMAC-SHA256 | Recibir webhooks de Meta |

### Health (`/health`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| GET | `/health/live` | Público | Liveness probe |
| GET | `/health/ready` | Público | Readiness probe (DB + Redis) |

### Modelos Prisma (schema público)

| Modelo | Tabla | Propósito |
|--------|-------|-----------|
| WhatsappOnboarding | `whatsapp_onboardings` | Registro del flujo de onboarding (17 campos) |
| WhatsappCredential | `whatsapp_credentials` | Tokens cifrados AES-256-GCM por tenant |

### Tablas Tenant Schema (whatsapp)

| Tabla | Columnas nuevas |
|-------|----------------|
| `whatsapp_channels` | `is_coexistence`, `coexistence_status`, `onboarding_id` |
