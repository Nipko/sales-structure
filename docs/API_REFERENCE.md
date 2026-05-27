# 🗂️ Estructura de la API — Parallext Engine

> Referencia rápida de todos los módulos y endpoints del backend.
> Actualizado: Mayo 27, 2026

---

## Módulos

| Módulo | Directorio | Endpoints | Descripción |
|--------|-----------|-----------|------------|
| Auth | `modules/auth/` | 4 | JWT login, register, refresh, me |
| Agent Console | `modules/agent-console/` | 9 + WS | Inbox, chat, notas, canned responses |
| Pipeline | `modules/pipeline/` | 6 | Kanban, deals CRUD, stages |
| Automation | `modules/pipeline/` | 5 | Rules engine, SLA detection |
| Analytics | `modules/analytics/` | 5 | KPIs, leaderboard, CSAT |
| Tenants | `modules/tenants/` | 4 | Multi-tenant CRUD, AI usage stats |
| Settings | `modules/settings/` | 3 | API keys management |
| Channels | `modules/channels/` | — | WhatsApp webhook, gateway |
| AI | `modules/ai/` | — | LLM Router, providers |
| Conversations | `modules/conversations/` | — | Orchestrator |
| Persona | `modules/persona/` | — | YAML persona engine |
| Knowledge | `modules/knowledge/` | — | RAG pipeline |
| Handoff | `modules/handoff/` | 2 | Escalation triggers, EventEmitter2 |
| Broadcast | `modules/broadcast/` | 4 | Campañas masivas, BullMQ rate-limited |
| Health | `modules/health/` | 2 | Health check, LLM provider status |
| Customer Portal | `modules/customer-portal/` | 6 | Portal de autoservicio para clientes (OTP auth) |
| White Label | `modules/white-label/` | 4 | Branding personalizado por tenant |
| E-commerce | `modules/ecommerce/` | 5 | Catálogo de productos, sync con proveedores |
| Channel Manager | `modules/channel-manager/` | 8 | Listings, reservaciones, disponibilidad (turismo) |
| Staff Scheduling | `modules/staff/` | 8 | Personal, horarios, servicios, disponibilidad |
| Vehicle Inventory | `modules/vehicles/` | 8 | Inventario vehicular, test drives, búsqueda IA |
| SAML/SSO | `modules/auth/saml/` | 6 | Enterprise SSO via SAML 2.0 |
| Widget | `modules/widget/` | 6 | Web chat widget embebible |

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

### Health (`/health`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | Public | Basic health check |
| GET | /health/llm-providers | JWT (super_admin) | LLM provider health status. Returns per-provider health (name, healthy, lastFailure, failureCount, configured) |

### Tenants (`/api/v1/tenants`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /tenants/ai-usage?months=3&tenantId= | JWT (super_admin) | Unified AI usage statistics (LLM + media + embeddings). Query params: months (1/3/6/12), tenantId (optional filter). Returns monthly breakdown by category, provider, and tenant |

### Handoff (`/api/v1/handoff`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| POST | `/:conversationId/complete` | ✅ | Completar handoff y devolver a IA |
| POST | `/:conversationId/status` | ✅ | Consultar estado del handoff |

### Broadcast (`/api/v1/broadcast`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| POST | `/campaigns` | ✅ admin | Crear campaña multi-canal (WA/Email/SMS). Body: channels[], channelContent{} |
| GET | `/campaigns` | ✅ | Listar campañas del tenant con stats |
| POST | `/campaigns/:id/launch` | ✅ admin | Lanzar campaña (encola mensajes por canal) |
| GET | `/campaigns/:id/stats` | ✅ | Estadísticas de entrega por canal (sent→delivered→read→failed) |

### WhatsApp Templates (`/api/v1/channels/whatsapp`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| GET | `/templates` | ✅ | Listar plantillas sincronizadas |
| POST | `/templates/sync` | ✅ admin | Sincronizar plantillas desde Meta |
| POST | `/templates/create` | ✅ admin | Crear plantilla y enviar a Meta para aprobación. Body: name, language, category, components[] |

### Custom Report Builder (`/api/v1/analytics-config`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| GET | `/saved-reports/:tenantId` | ✅ | Listar reportes guardados |
| GET | `/saved-reports/:tenantId/:reportId` | ✅ | Obtener reporte por ID |
| POST | `/saved-reports/:tenantId` | ✅ admin | Crear reporte (name, description, config) |
| PUT | `/saved-reports/:tenantId/:reportId` | ✅ admin | Actualizar reporte |
| DELETE | `/saved-reports/:tenantId/:reportId` | ✅ admin | Eliminar reporte |

---

## Auth (new endpoints)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/google | Public | Login/register with Google OAuth |
| POST | /auth/setup-password | JWT | Set password for Google users |
| POST | /auth/send-verification | JWT | Send email verification OTP |
| POST | /auth/verify-email | JWT | Verify OTP code |
| POST | /auth/complete-onboarding | JWT | Create company + tenant |
| POST | /auth/forgot-password | Public | Request password reset code |
| POST | /auth/reset-password | Public | Reset password with code |
| POST | /auth/change-password | JWT | Change password (current required) |
| POST | /auth/send-2fa | JWT | Send 2FA code via email |
| POST | /auth/verify-2fa | JWT | Verify 2FA and get tokens |

## Media
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /media/upload/:tenantId | JWT | Upload image (multipart) |
| POST | /media/logo/:tenantId | JWT | Upload company logo |
| GET | /media/list/:tenantId | JWT | List media files |
| GET | /media/tags/:tenantId | JWT | Get all unique tags |
| PUT | /media/update/:tenantId/:fileId | JWT | Update label/description/tags |
| DELETE | /media/delete/:tenantId/:fileId | JWT | Delete media file |
| GET | /media/file/:tenantId/:fileName | Public | Serve image (webp) |
| GET | /media/health | Public | Storage diagnostic |

## Email Templates
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /email-templates/:tenantId | JWT | List templates |
| GET | /email-templates/:tenantId/:id | JWT | Get template by ID |
| POST | /email-templates/:tenantId | JWT | Create template |
| PUT | /email-templates/:tenantId/:id | JWT | Update template |
| DELETE | /email-templates/:tenantId/:id | JWT | Delete template |
| POST | /email-templates/:tenantId/:id/test | JWT | Send test email |

## Appointments
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /appointments/:tenantId | JWT | List appointments |
| POST | /appointments/:tenantId | JWT | Create appointment |
| PUT | /appointments/:tenantId/:id | JWT | Update appointment |
| PUT | /appointments/:tenantId/:id/cancel | JWT | Cancel appointment |
| GET | /appointments/:tenantId/:id | JWT | Get appointment by ID |
| GET | /appointments/:tenantId/availability | JWT | Get availability slots |
| POST | /appointments/:tenantId/availability | JWT | Save availability |
| GET | /appointments/:tenantId/blocked-dates | JWT | Get blocked dates |
| POST | /appointments/:tenantId/blocked-dates | JWT | Block a date |
| DELETE | /appointments/:tenantId/blocked-dates/:id | JWT | Unblock date |
| GET | /appointments/:tenantId/check-slots | JWT | Check available slots |

## Compliance (updated)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /compliance/opt-outs/:tenantId | JWT | List opt-outs (filter by status) |
| GET | /compliance/opt-outs/:tenantId/stats | JWT | Opt-out statistics |
| PUT | /compliance/opt-outs/:tenantId/:id/confirm | JWT | Confirm opt-out |
| PUT | /compliance/opt-outs/:tenantId/:id/reject | JWT | Reject (false positive) |
| PUT | /compliance/legal-texts/:tenantId/:id | JWT (tenant_admin) | Update legal text |
| DELETE | /compliance/legal-texts/:tenantId/:id | JWT (tenant_admin) | Delete legal text |
| GET | /compliance/audit-log/:tenantId | JWT | Compliance audit log |
| POST | /compliance/erase-contact/:tenantId/:contactId | JWT (tenant_admin, super_admin) | GDPR Article 17 erasure (anonymizes 11 tables) |

## Customer Portal (`/customer-portal`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /customer-portal/request-access | Public | Request access — body: `{tenantId, phone/email}` → sends 6-digit OTP |
| POST | /customer-portal/verify | Public | Verify OTP — body: `{tenantId, phone/email, code}` → returns JWT |
| GET | /customer-portal/profile | X-Portal-Token | Get contact profile |
| GET | /customer-portal/conversations | X-Portal-Token | List conversations |
| GET | /customer-portal/appointments | X-Portal-Token | List appointments |
| GET | /customer-portal/orders | X-Portal-Token | List orders |

## White Label (`/white-label`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /white-label/config | JWT (tenant_admin) | Get branding config |
| PUT | /white-label/config | JWT (tenant_admin) | Update branding config |
| GET | /white-label/public/slug/:slug | Public | Lookup tenant by slug |
| GET | /white-label/public/domain?domain= | Public | Lookup tenant by custom domain |

## E-commerce (`/ecommerce`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /ecommerce/config | JWT (tenant_admin) | Get e-commerce config |
| PUT | /ecommerce/config | JWT (tenant_admin) | Update config — body: `Partial<EcommerceConfig>` |
| POST | /ecommerce/sync | JWT (tenant_admin) | Sync products from provider |
| GET | /ecommerce/products?status=&search=&limit=&offset= | JWT | List products (paginated, filterable) |
| GET | /ecommerce/products/search?search=&maxPrice=&category= | JWT | AI-powered product search |

## Channel Manager (`/channel-manager`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /channel-manager/config | JWT (tenant_admin) | Get channel manager config |
| PUT | /channel-manager/config | JWT (tenant_admin) | Update config |
| GET | /channel-manager/listings | JWT | List all listings |
| POST | /channel-manager/listings | JWT | Create listing |
| GET | /channel-manager/reservations?listingId=&status=&fromDate=&toDate= | JWT | List reservations (filterable) |
| POST | /channel-manager/reservations | JWT | Create reservation (conflict detection) |
| GET | /channel-manager/availability?listingId=&from=&to= | JWT | Availability calendar |
| POST | /channel-manager/sync/hostaway | JWT (tenant_admin) | Sync from Hostaway |

## Staff Scheduling (`/staff/:tenantId`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /staff/:tenantId | JWT | List staff with schedules |
| POST | /staff/:tenantId | JWT | Create staff member |
| PUT | /staff/:tenantId/:staffId | JWT | Update staff member |
| DELETE | /staff/:tenantId/:staffId | JWT | Delete staff member |
| PUT | /staff/:tenantId/:staffId/schedule | JWT | Set weekly schedule |
| PUT | /staff/:tenantId/:staffId/services | JWT | Link services to staff |
| POST | /staff/:tenantId/:staffId/breaks | JWT | Add break |
| GET | /staff/:tenantId/available?serviceId=&date=&time= | JWT | Check availability |

## Vehicle Inventory (`/vehicles/:tenantId`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /vehicles/:tenantId | JWT | List vehicles |
| POST | /vehicles/:tenantId | JWT | Create vehicle |
| PUT | /vehicles/:tenantId/:vehicleId | JWT | Update vehicle |
| DELETE | /vehicles/:tenantId/:vehicleId | JWT | Delete vehicle |
| PUT | /vehicles/:tenantId/:vehicleId/sold | JWT | Mark vehicle as sold |
| GET | /vehicles/:tenantId/stats | JWT | Inventory statistics |
| POST | /vehicles/:tenantId/test-drives | JWT | Schedule test drive |
| GET | /vehicles/:tenantId/search?query=&maxBudget=&category=&fuelType= | JWT | AI-powered vehicle search |

## SAML/SSO (`/auth/saml`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /auth/saml/check?email= | Public | Check if email domain has SSO configured |
| GET | /auth/saml/login?tenantId= | Public | Redirect to IdP login |
| POST | /auth/saml/acs | Public | ACS callback from IdP |
| GET | /auth/saml/metadata/:tenantId | Public | SP metadata XML |
| GET | /auth/saml/config | JWT (tenant_admin) | Get SAML config |
| PUT | /auth/saml/config | JWT (tenant_admin) | Update SAML config |

## Widget (`/widget`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /widget/config/:tenantId | Public | Get widget config for embed |
| POST | /widget/conversations | Public | Create widget conversation |
| POST | /widget/conversations/:id/messages | Public | Send message in widget conversation |
| GET | /widget/conversations/:id/messages | Public | Get messages for widget conversation |
| GET | /widget/admin/config | JWT (tenant_admin) | Get widget admin config |
| PUT | /widget/admin/config | JWT (tenant_admin) | Update widget admin config |

---

## Colas BullMQ

| Cola | Descripción | Reintentos | Rate limit |
|------|------------|------------|------------|
| `outbound-messages` | Mensajes salientes individuales (respuestas IA, agente) | 3 (backoff exponencial) | — |
| `broadcast-messages` | Mensajes de campañas masivas | 3 | 80 msg/s |
| `wa:webhooks` | Procesamiento de webhooks entrantes de Meta | 3 | — |
| `wa:sync` | Sincronización de templates y teléfonos | 3 | — |

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
| `inbox:refresh` | — | Recargar inbox (datos cambiaron) |
| `inbox:handoff` | `{ conversationId, reason, metadata }` | Escalación de handoff recibida |
| `inbox:handoff_completed` | `{ conversationId }` | Handoff resuelto, conversación devuelta a IA |
| `conversation:message` | `Message` | Mensaje en chat abierto |
| `conversation:resolved` | `{ conversationId }` | Chat cerrado |

> Los eventos `inbox:handoff` e `inbox:handoff_completed` son emitidos por `AgentConsoleGateway`
> en respuesta a eventos internos `handoff.escalated` y `handoff.completed` de EventEmitter2.

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
