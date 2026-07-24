# 🗂️ Estructura de la API — Parallext Engine

> Referencia rápida de los módulos y endpoints del backend.
> Actualizado: Julio 23, 2026

> **⚠️ Prefijo global obligatorio.** Toda ruta del API (puerto 3000) lleva el prefijo
> `api/v1` — se aplica en `main.ts` (`app.setGlobalPrefix('api/v1')`, sin `exclude`).
> En este documento muchas secciones muestran la ruta "pelada" (`/auth/login`, `/media/...`,
> `/appointments/...`); la ruta real siempre es `/api/v1/<esa ruta>` (ej. `/api/v1/auth/login`).
> Base pública: `https://api.parallly-chat.cloud/api/v1`. El servicio WhatsApp (puerto 3002)
> también usa `api/v1` bajo `https://wa.parallly-chat.cloud/api/v1`.

> **Cobertura.** El API tiene **83 módulos** en `apps/api/src/modules`; este documento detalla
> los ~27 más usados. Muchos módulos verticales (`restaurants`, `gyms`, `pets`, `education`,
> `insurance`, `tours`, `photography`, `home-services`, `procedures`, `treatment-plans`,
> `recall`, `policies`, `intake`, `faqs`, `reviews`, `attribution`, `crm-b2b`, `mcp`,
> `vertical-integrations`, `vertical-analytics`, `simulation`, `quality`, `slack`, `push`,
> `trace`, `carla`, etc.) exponen endpoints propios no listados aquí. El dashboard (Next.js,
> puerto 3001) tiene **139 páginas** (`page.tsx`).

---

## Módulos

| Módulo | Directorio | Endpoints | Descripción |
|--------|-----------|-----------|------------|
| Auth | `modules/auth/` | 4 | JWT login, register, refresh, me |
| Agent Console | `modules/agent-console/` | 9 + WS | Inbox, chat, notas, canned responses |
| Pipeline | `modules/pipeline/` | 10 | Kanban, deals CRUD, stages, pipelines multi |
| Automation | `modules/pipeline/` | 5 | Rules engine, SLA detection |
| Drip Sequences | `modules/automation/` | 9 | Secuencias automatizadas de mensajes |
| Automation Templates | `modules/automation/` | 3 | Plantillas de automatización por industria |
| Analytics | `modules/analytics/` | 5 | KPIs, leaderboard, CSAT |
| Tenants | `modules/tenants/` | 4 | Multi-tenant CRUD, AI usage stats |
| Settings | `modules/settings/` | 3 | API keys management |
| Public API Keys | `modules/public-api/` | 4 | API keys para integraciones externas |
| Public API v1 | `modules/public-api/` | 3 | Endpoints públicos con X-API-Key |
| Channels | `modules/channels/` | — | WhatsApp webhook, gateway |
| Email Channel | `modules/channels/email/` | 3 | Canal de email (SendGrid inbound) |
| AI | `modules/ai/` | — | LLM Router, providers |
| Conversations | `modules/conversations/` | — | Orchestrator |
| Persona | `modules/persona/` | — | YAML persona engine |
| Knowledge | `modules/knowledge/` | 2 | RAG pipeline, feedback, gap report |
| Handoff | `modules/handoff/` | 2 | Escalation triggers, EventEmitter2 |
| Broadcast | `modules/broadcast/` | 6 | Campañas masivas, A/B testing, BullMQ rate-limited |
| Health | `modules/health/` | 2 | Health check, LLM provider status |
| Customer Portal | `modules/customer-portal/` | 6 | Portal de autoservicio para clientes (OTP auth) |
| White Label | `modules/white-label/` | 4 | Branding personalizado por tenant |
| E-commerce | `modules/ecommerce/` | 5 | Catálogo de productos, sync con proveedores |
| Channel Manager | `modules/channel-manager/` | 8 | Listings, reservaciones, disponibilidad (turismo) |
| Staff Scheduling | `modules/verticals/` | 8 | Personal, horarios, servicios, disponibilidad (`staff-scheduling.controller.ts`) |
| Vehicle Inventory | `modules/verticals/` | 8 | Inventario vehicular, test drives, búsqueda IA (`vehicle-inventory.controller.ts`) |
| Billing | `modules/billing/` | 30+ | Suscripciones MercadoPago (ciclo mensual/anual), admin cross-tenant, checkout público, cupones, SMS checkout, webhook |
| Fiscal DIAN | `modules/fiscal/` | 13 | Facturación electrónica Colombia vía Factus (`IFiscalInvoiceProvider`), gate collect-before-pay |
| SMS Credits | `modules/sms-credits/` | 7 | Créditos SMS reseller (balance, ledger, paquetes, ajustes admin) |
| Channel Management | `modules/channels/` | 18 | Multi-canal por tipo: connect/disconnect por-cuenta, OAuth IG/Messenger, Telegram, SMS |
| Ops Center | `modules/health/` + `modules/tenants/` | 15+ | Salud plataforma (super_admin): incidentes, storage por-tenant, alert-config, banner de mantenimiento |
| SAML/SSO | `modules/auth/saml/` | 6 | Enterprise SSO via SAML 2.0 |
| Widget | `modules/widget/` | 10 | Web chat widget embebible + triggers |
| Dashboard Analytics | `modules/dashboard-analytics/` | 1 | Estadísticas resolución IA |

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
> `@Controller('agent-console')` + `AuthGuard('jwt')` + RolesGuard + TenantGuard.
| Método | Ruta | Descripción |
|--------|------|------------|
| GET | `/inbox/:tenantId?agentId=&filter=&limit=&offset=` | Bandeja (filter: all/mine/unassigned/handoff/resolved/ai) |
| GET | `/conversation/:tenantId/:conversationId?limit=&before=` | Detalle (paginado) |
| GET | `/conversation/:tenantId/:conversationId/archives` | Mensajes archivados |
| POST | `/conversation/:tenantId/:conversationId/message` | Enviar mensaje |
| PUT | `/conversation/:tenantId/:conversationId/assign` | Asignar agente |
| PUT | `/conversation/:tenantId/:conversationId/resolve` | Resolver |
| PUT | `/conversation/:tenantId/:conversationId/return-to-ai` | Devolver a IA |
| POST | `/conversation/:tenantId/:conversationId/reopen` | Reabrir |
| POST | `/conversation/:tenantId/:conversationId/note` | Nota interna |
| GET | `/conversation/:tenantId/:conversationId/suggest` | Sugerencia IA (era `ai-suggest`) |
| GET | `/conversation/:tenantId/:conversationId/next-action` | Próxima mejor acción (AI coach) |
| PUT | `/conversation/:tenantId/:conversationId/snooze` \| `/unsnooze` | Posponer / reactivar |
| PUT | `/conversation/:tenantId/:conversationId/archive` | Archivar |
| DELETE | `/conversation/:tenantId/:conversationId` | Eliminar conversación |
| DELETE | `/conversation/:tenantId/:conversationId/message/:messageId` | Eliminar mensaje |
| POST | `/conversations/:tenantId/bulk-archive` \| `/bulk-delete` | Acciones masivas |
| GET | `/stats/:tenantId/:agentId` | Estadísticas del agente (requiere `:agentId`) |
| GET/POST | `/canned/:tenantId` | Respuestas rápidas (era `canned-responses`) |
| PUT | `/canned/:tenantId/:id` | Actualizar respuesta rápida |
| GET/POST | `/macros/:tenantId` · PUT `/macros/:tenantId/:macroId` · POST `/macros/:tenantId/:macroId/execute` | Macros |
| PUT | `/status/:userId` | Estado de disponibilidad del agente |
| GET | `/agents/:tenantId/available` \| `/agents/:tenantId/status` | Agentes disponibles / con estado |
| POST | `/translate/:tenantId` | Traducir texto (LLM) |
| POST | `/scan-card/:tenantId` | Escanear tarjeta de presentación (visión) |

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

### Widget Triggers (`/widget/triggers`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/widget/triggers/:tenantId` | JWT | tenant_admin | Listar triggers |
| POST | `/widget/triggers/:tenantId` | JWT | tenant_admin | Crear trigger |
| PUT | `/widget/triggers/:tenantId/:id` | JWT | tenant_admin | Actualizar trigger |
| DELETE | `/widget/triggers/:tenantId/:id` | JWT | tenant_admin | Eliminar trigger |

---

## Public API Keys (`/public-api/keys`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/public-api/keys/:tenantId` | JWT | super_admin, tenant_admin | Listar API keys del tenant |
| POST | `/public-api/keys/:tenantId` | JWT | super_admin, tenant_admin | Crear API key (name, scopes, expiresAt?) |
| DELETE | `/public-api/keys/:tenantId/:keyId` | JWT | super_admin, tenant_admin | Revocar API key |
| POST | `/public-api/keys/:tenantId/:keyId/rotate` | JWT | super_admin, tenant_admin | Rotar API key |

## Public API v1 (`/api/v1/public` — auth via X-API-Key)
| Método | Ruta | Auth | Scopes | Descripción |
|--------|------|------|--------|-------------|
| GET | `/api/v1/public/me` | X-API-Key | — | Test de autenticación |
| POST | `/api/v1/public/hooks` | X-API-Key | write:webhooks | Suscribir webhook |
| DELETE | `/api/v1/public/hooks` | X-API-Key | write:webhooks | Desuscribir webhook |

---

## Drip Sequences (`/automation/drip-sequences`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/automation/drip-sequences/:tenantId` | JWT | tenant_admin+ | Listar secuencias |
| GET | `/automation/drip-sequences/:tenantId/:id` | JWT | tenant_admin+ | Obtener secuencia |
| POST | `/automation/drip-sequences/:tenantId` | JWT | tenant_admin+ | Crear secuencia |
| PUT | `/automation/drip-sequences/:tenantId/:id` | JWT | tenant_admin+ | Actualizar secuencia |
| DELETE | `/automation/drip-sequences/:tenantId/:id` | JWT | tenant_admin+ | Eliminar secuencia |
| POST | `/automation/drip-sequences/:tenantId/:id/toggle` | JWT | tenant_admin+ | Activar/desactivar |
| POST | `/automation/drip-sequences/:tenantId/:id/enroll` | JWT | tenant_admin+ | Inscribir contacto |
| POST | `/automation/drip-sequences/:tenantId/:id/unenroll` | JWT | tenant_admin+ | Desinscribir contacto |
| GET | `/automation/drip-sequences/:tenantId/:id/enrollments` | JWT | tenant_admin+ | Listar inscritos |

## Automation Templates (`/automation/templates`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/automation/templates` | JWT | any | Listar plantillas (filtros: category, industry) |
| GET | `/automation/templates/:id` | JWT | any | Obtener plantilla |
| POST | `/automation/templates/:tenantId/install` | JWT | tenant_admin+ | Instalar plantilla |

---

## Broadcast A/B Testing (`/broadcast/campaigns`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/broadcast/campaigns/:id/variants` | JWT | tenant_admin+ | Obtener variantes A/B |
| POST | `/broadcast/campaigns/:id/winner` | JWT | tenant_admin+ | Seleccionar ganador A/B |

---

## Email Channel (`/channels/email`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| POST | `/channels/email/inbound` | None (webhook) | — | Recibir email entrante (SendGrid Parse) |
| GET | `/channels/email/config/:tenantId` | JWT | tenant_admin+ | Obtener config email |
| PUT | `/channels/email/config/:tenantId` | JWT | tenant_admin+ | Guardar config email |

---

## Knowledge Gap (`/knowledge`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| POST | `/knowledge/:tenantId/feedback` | JWT | any | Enviar feedback KB |
| GET | `/knowledge/:tenantId/gap-report` | JWT | tenant_admin+ | Reporte de brechas |

---

## Pipeline — Pipelines CRUD (`/pipeline/pipelines`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/pipeline/pipelines/:tenantId` | JWT | tenant_admin+ | Listar pipelines |
| POST | `/pipeline/pipelines/:tenantId` | JWT | tenant_admin+ | Crear pipeline |
| PUT | `/pipeline/pipelines/:tenantId/:id` | JWT | tenant_admin+ | Actualizar pipeline |
| DELETE | `/pipeline/pipelines/:tenantId/:id` | JWT | tenant_admin+ | Eliminar pipeline |

---

## AI Resolution (`/dashboard-analytics/ai-resolution`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/dashboard-analytics/ai-resolution/:tenantId` | JWT | tenant_admin+ | Estadísticas resolución IA |

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
