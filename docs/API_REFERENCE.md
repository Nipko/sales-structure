# 🗂️ Estructura de la API — Parallext Engine

> Referencia rápida de todos los módulos y endpoints del backend.
> Actualizado: Marzo 3, 2026

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
