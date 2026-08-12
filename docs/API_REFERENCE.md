# 🗂️ Estructura de la API — Parallext Engine

> Referencia rápida de los módulos y endpoints del backend.
> Actualizado: Agosto 11, 2026

> **⚠️ Prefijo global obligatorio.** Toda ruta del API (puerto 3000) lleva el prefijo
> `api/v1` — se aplica en `main.ts` (`app.setGlobalPrefix('api/v1')`, sin `exclude`).
> En este documento muchas secciones muestran la ruta "pelada" (`/auth/login`, `/media/...`,
> `/appointments/...`); la ruta real siempre es `/api/v1/<esa ruta>` (ej. `/api/v1/auth/login`).
> Base pública: `https://api.parallly-chat.cloud/api/v1`. El servicio WhatsApp (puerto 3002)
> también usa `api/v1` bajo `https://wa.parallly-chat.cloud/api/v1`.

> **Cobertura.** El API tiene **88 archivos `*.module.ts`** en `apps/api/src/modules`; este documento detalla
> los ~27 más usados. Muchos módulos verticales (`restaurants`, `gyms`, `pets`, `education`,
> `insurance`, `tours`, `photography`, `home-services`, `procedures`, `treatment-plans`,
> `recall`, `policies`, `intake`, `faqs`, `reviews`, `attribution`, `crm-b2b`, `mcp`,
> `vertical-integrations`, `vertical-analytics`, `simulation`, `quality`, `slack`, `push`,
> `trace`, `carla`, etc.) exponen endpoints propios no listados aquí. El dashboard (Next.js,
> puerto 3001) tiene **143 páginas** (`page.tsx`): 130 bajo `/admin` y 13 fuera de ese árbol.
> Estos conteos son un snapshot del filesystem, no un contrato de producto.

---

## Módulos

| Módulo | Directorio | Endpoints | Descripción |
|--------|-----------|-----------|------------|
| Auth | `modules/auth/` | 4 | JWT login, register, refresh, me |
| Agent Console | `modules/agent-console/` | 9 + WS | Inbox, chat, notas, canned responses |
| Pipeline | `modules/pipeline/` | 18 | Kanban, deals CRUD, etapas del embudo activo, analítica y auto-progress |
| Pipeline Automation (legacy) | `modules/pipeline/` | 5 | Rules engine y detección SLA bajo `/pipeline/automation` |
| Drip Sequences | `modules/automation/` | 9 | Secuencias automatizadas de mensajes |
| Automation Templates | `modules/automation/` | 3 | Plantillas de automatización por industria |
| Analytics | `modules/analytics/` | 5 | KPIs, leaderboard, CSAT |
| Tenants | `modules/tenants/` | 4 | Multi-tenant CRUD, AI usage stats |
| Settings | `modules/settings/` | 3 | API keys management |
| Public API Keys | `modules/public-api/` | 4 | API keys para integraciones externas |
| Public API v1 | `modules/public-api/` | 3 | Endpoints públicos con X-API-Key |
| Channels | `modules/channels/` | — | WhatsApp webhook, gateway |
| Email Ingress | `modules/channels/email/` | 1 específico | Adaptador e ingreso inbound interno; sin configuración tenant autoservicio certificada |
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
| Vehicle Inventory | `modules/verticals/` | 10 | Inventario vehicular, test drives, búsqueda IA (`vehicle-inventory.controller.ts`) |
| Billing | `modules/billing/` | 30+ | Suscripciones MercadoPago (ciclo mensual/anual), admin cross-tenant, checkout público, cupones, SMS checkout, webhook |
| Fiscal DIAN | `modules/fiscal/` | 13 | Facturación electrónica Colombia vía Factus (`IFiscalInvoiceProvider`), gate collect-before-pay |
| SMS Credits | `modules/sms-credits/` | 7 | Créditos SMS reseller (balance, ledger, paquetes, ajustes admin) |
| Channel Management | `modules/channels/` | 18 | Multi-canal por tipo: connect/disconnect por-cuenta, OAuth IG/Messenger, Telegram, SMS |
| Ops Center | `modules/health/` + `modules/tenants/` | 15+ | Salud plataforma (super_admin): incidentes, storage por-tenant, alert-config, banner de mantenimiento |
| SAML/SSO | `modules/auth/saml/` | 6 | Enterprise SSO via SAML 2.0 |
| Widget | `modules/widget/` | 13 + WS | Web chat widget embebible + triggers + Socket.IO `/widget` |
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
>
> Admin y Supervisor pueden consultar las conversaciones del tenant. Agent solo puede
> ver las conversaciones que tiene asignadas o que siguen sin asignar; las mutaciones
> requieren una conversación propia, salvo `claim`, que toma de forma atómica una
> conversación libre. La identidad del actor siempre se deriva del JWT.
| Método | Ruta | Descripción |
|--------|------|------------|
| GET | `/inbox/:tenantId?filter=&limit=&offset=` | Bandeja; el usuario para `mine` se deriva del JWT (filter: all/mine/unassigned/handoff/resolved/ai) |
| GET | `/conversation/:tenantId/:conversationId?limit=&before=` | Detalle (paginado) |
| GET | `/conversation/:tenantId/:conversationId/archives` | Mensajes archivados |
| POST | `/conversation/:tenantId/:conversationId/message` | Enviar mensaje |
| PUT | `/conversation/:tenantId/:conversationId/assign` | Asignar/reasignar a un miembro activo (Admin/Supervisor). Alias móvil v7 deprecado: Agent solo puede enviar su propio `agentId`; se ejecuta como `claim` atómico y nunca reasigna |
| PUT | `/conversation/:tenantId/:conversationId/claim` | Tomar atómicamente una conversación sin asignar; actor derivado del JWT |
| PUT | `/conversation/:tenantId/:conversationId/resolve` | Resolver |
| PUT | `/conversation/:tenantId/:conversationId/return-to-ai` | Devolver a IA |
| POST | `/conversation/:tenantId/:conversationId/reopen` | Reabrir |
| POST | `/conversation/:tenantId/:conversationId/note` | Nota interna |
| GET | `/conversation/:tenantId/:conversationId/suggest` | Sugerencia IA (era `ai-suggest`) |
| GET | `/conversation/:tenantId/:conversationId/next-action` | Próxima mejor acción (AI coach) |
| PUT | `/conversation/:tenantId/:conversationId/snooze` \| `/unsnooze` | Posponer / reactivar |
| PUT | `/conversation/:tenantId/:conversationId/archive` | Archivar |
| DELETE | `/conversation/:tenantId/:conversationId` | Eliminar conversación (solo Admin) |
| DELETE | `/conversation/:tenantId/:conversationId/message/:messageId` | Eliminar mensaje (solo Admin) |
| POST | `/conversations/:tenantId/bulk-archive` | Archivar en lote; respeta propiedad para Agent |
| POST | `/conversations/:tenantId/bulk-delete` | Eliminar en lote (solo Admin) |
| GET | `/stats/:tenantId/:agentId` | Estadísticas del agente (requiere `:agentId`) |
| GET/POST | `/canned/:tenantId` | Respuestas rápidas (era `canned-responses`) |
| PUT | `/canned/:tenantId/:id` | Actualizar respuesta rápida |
| GET/POST | `/macros/:tenantId` · PUT `/macros/:tenantId/:macroId` · POST `/macros/:tenantId/:macroId/execute` | Macros |
| PUT | `/status/:userId` | Estado propio; el usuario efectivo se deriva del JWT y no del parámetro |
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

Todos los endpoints de lectura requieren JWT + TenantGuard y rol
`tenant_admin`/`tenant_supervisor`. El opt-out de compliance es solo Admin.

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/commercial-overview/:tenantId` | Admin/Supervisor | Resumen comercial |
| GET | `/overview/:tenantId` | Admin/Supervisor | KPIs generales |
| GET | `/dashboard/:tenantId` | Admin/Supervisor | Dashboard agregado |
| GET | `/pipeline/:tenantId` | Admin/Supervisor | Analítica de pipeline |
| GET | `/conversations/:tenantId` | Admin/Supervisor | Analítica conversacional |
| GET | `/crm/:tenantId` | Admin/Supervisor | Métricas CRM |
| GET | `/whatsapp/:tenantId` | Admin/Supervisor | Métricas WhatsApp |
| GET | `/ai/:tenantId` | Admin/Supervisor | Uso/rendimiento IA |
| GET | `/campaigns/:tenantId` | Admin/Supervisor | Campañas |
| GET | `/funnel/:tenantId` | Admin/Supervisor | Embudo |
| GET | `/compliance/:tenantId` | Admin/Supervisor | Resumen compliance |
| POST | `/compliance/:tenantId/opt-out` | Admin | Registrar opt-out |

### Agent Analytics (`/api/v1/agent-analytics`)

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/overview/:tenantId` | Admin/Supervisor | Resumen de rendimiento |
| GET | `/agents/:tenantId` | Admin/Supervisor | Leaderboard |
| GET | `/csat/:tenantId` | Admin/Supervisor | Respuestas CSAT |
| GET | `/csat/:tenantId/distribution` | Admin/Supervisor | Distribución 1–5 |
| POST | `/csat/:tenantId` | Admin/Supervisor/Agent | Enviar CSAT |
| GET | `/:tenantId/channels` | Admin/Supervisor | Rendimiento por canal |
| GET | `/:tenantId/overview-series` | Admin/Supervisor | Serie temporal |
| GET | `/:tenantId/performance` | Admin/Supervisor | Performance detallada |

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

### Copilot y Parallly Assist (`/api/v1/copilot`)

Todos los endpoints usan JWT, RolesGuard y TenantGuard. El cliente no envía una
identidad confiable, `tenantId`, nombre ni rol en el body: se derivan del JWT y del
contexto validado por TenantGuard.

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| POST | `/chat` | Tenant Admin/Supervisor/Agent | Parallly Assist general de la plataforma |
| GET | `/:conversationId/suggestions` | Tenant Admin/Supervisor/Agent | Tres respuestas sugeridas |
| GET | `/:conversationId/summary` | Tenant Admin/Supervisor/Agent | Resumen de la conversación |
| GET | `/:conversationId/intent` | Tenant Admin/Supervisor/Agent | Intención detectada |
| POST | `/:conversationId/rewrite` | Tenant Admin/Supervisor/Agent | Reescribir borrador según tono |
| POST | `/:conversationId/ask` | Tenant Admin/Supervisor/Agent | Pregunta contextual sobre la conversación |

Body permitido para `POST /copilot/chat`:

```json
{
  "message": "¿Dónde configuro los horarios?",
  "page": "/admin/settings",
  "locale": "es",
  "history": [
    { "role": "user", "content": "Necesito configurar mi empresa" },
    { "role": "assistant", "content": "¿Qué parte deseas ajustar?" }
  ]
}
```

Solo se aceptan `message`, `page`, `locale` e `history`; `page` debe ser una ruta
interna `/admin`, el locale uno de `es/en/pt/fr` y el historial contiene únicamente
roles `user`/`assistant` dentro de límites acotados.

`/chat` aplica límites Redis por usuario y tenant (ventanas de minuto y día) y
responde `429` con `Retry-After` al excederlos. Las identidades y el plan no se
aceptan del cliente; el contexto de plan detallado solo se expone al Tenant Admin.

**Diferencia de alcance:** Parallly Assist (`/chat`) responde sobre el uso de la
plataforma con la KB localizada de `apps/api/kb/assistant` y contexto autorizado de
tenant/rol/vertical; el detalle de plan se incorpora solo para Tenant Admin. Los
endpoints por `conversationId` son el Copilot operativo del Inbox: trabajan sobre la
conversación autorizada y, en `ask`, pueden combinarla con conocimiento RAG del tenant.
Los seis endpoints excluyen de forma explícita a `tenant_viewer` y a `super_admin` en
modo plataforma.

### Broadcast (`/api/v1/broadcast`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| POST | `/campaigns` | Tenant Admin/Supervisor | Guardar configuración/borrador. El lanzamiento del editor no está certificado para producción |
| POST | `/campaigns/:id/launch` | Tenant Admin/Supervisor | Endpoint existente; no usar en producción hasta vincular plantilla WhatsApp exacta y añadir cancelación |
| GET | `/campaigns` | Tenant Admin/Supervisor | Listar campañas del tenant con stats |
| GET | `/campaigns/:id/stats` | Tenant Admin/Supervisor | Consultar métricas registradas |

No existe endpoint de cancelación de campañas programadas. Email de campaña es una
salida de plataforma y no certifica Email como canal conversacional autoservicio.

### WhatsApp Templates (`/api/v1/channels/whatsapp`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| GET | `/templates` | ✅ | Listar plantillas sincronizadas |
| POST | `/templates/sync` | ✅ admin | Sincronizar plantillas desde Meta |
| POST | `/templates/create` | ✅ admin | Crear plantilla y enviar a Meta para aprobación. Body: name, language, category, components[] |

### Custom Report Builder (`/api/v1/analytics-config`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|------------|
| GET | `/saved-reports/:tenantId` | JWT + TenantGuard; UI Supervisor+ | Listar reportes guardados |
| GET | `/saved-reports/:tenantId/:reportId` | JWT + TenantGuard; UI Supervisor+ | Obtener reporte por ID |
| POST | `/saved-reports/:tenantId` | Admin/Supervisor/Super Admin | Crear reporte (name, description, config) |
| PUT | `/saved-reports/:tenantId/:reportId` | Admin/Supervisor/Super Admin | Actualizar reporte |
| DELETE | `/saved-reports/:tenantId/:reportId` | Admin/Supervisor/Super Admin | Eliminar reporte |

### Alerts & Scheduled Reports (`/api/v1/analytics-config`)

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/alerts/:tenantId` | Cualquier rol autenticado + TenantGuard; UI Supervisor+ | Listar reglas |
| POST | `/alerts/:tenantId` | Admin/Supervisor/Super Admin | Crear regla |
| PUT | `/alerts/:tenantId/:ruleId` | Admin/Supervisor/Super Admin | Actualizar regla |
| DELETE | `/alerts/:tenantId/:ruleId` | Admin/Supervisor/Super Admin | Eliminar regla |
| GET | `/alerts/:tenantId/:ruleId/history` | Cualquier rol autenticado + TenantGuard; UI Supervisor+ | Historial de disparos |
| GET | `/reports/:tenantId` | Cualquier rol autenticado + TenantGuard; UI Supervisor+ | Configuración programada, sujeta al plan |
| POST | `/reports/:tenantId` | Admin/Supervisor/Super Admin | Crear/actualizar configuración, sujeta al plan |

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
| POST | `/auth/2fa/send-email` | Public + `twoFAToken` | Send the email fallback code during a 2FA challenge |
| POST | `/auth/2fa/verify` | Public + throttled + `twoFAToken` | Verify `totp`, `email`, `backup` or `sms` code and finish login |

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

## Customer Portal (`/portal/:tenantId`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/portal/:tenantId/request-access` | Public + throttled | Body `{ phone?: string, email?: string }`; sends a 6-digit OTP through the resolved channel |
| POST | `/portal/:tenantId/verify` | Public + throttled | Body `{ code: string, phone?: string, email?: string }`; returns the portal JWT |
| GET | `/portal/:tenantId/profile` | `X-Portal-Token` | Authenticated customer profile |
| GET | `/portal/:tenantId/conversations` | `X-Portal-Token` | Customer conversation history |
| GET | `/portal/:tenantId/appointments` | `X-Portal-Token` | Upcoming appointments |
| GET | `/portal/:tenantId/orders` | `X-Portal-Token` | Order history |

The controller verifies that the portal token belongs to the `tenantId` in the URL.

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
| POST | /vehicles/:tenantId/bulk-import | JWT | Import parsed CSV/XLSX rows |
| GET | /vehicles/:tenantId/:vehicleId | JWT | Get vehicle detail |
| PUT | /vehicles/:tenantId/:vehicleId | JWT | Update vehicle |
| PUT | /vehicles/:tenantId/:vehicleId/sold | JWT | Mark vehicle as sold |
| GET | /vehicles/:tenantId/stats | JWT | Inventory statistics |
| POST | /vehicles/:tenantId/test-drives | JWT | Schedule test drive |
| GET | /vehicles/:tenantId/test-drives/list?vehicleId=&status=&date= | JWT | List test drives |
| GET | /vehicles/:tenantId/search?make=&budgetMax=&category=&fuelType=&condition=&year= | JWT | AI-oriented vehicle search |

## SAML/SSO (`/auth/saml`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /auth/saml/check?email= | Public | Check if email domain has SSO configured |
| GET | /auth/saml/login?tenantId= | Public | Redirect to IdP login |
| POST | /auth/saml/acs | Public | ACS callback from IdP |
| GET | /auth/saml/metadata/:tenantId | Public | SP metadata XML |
| GET | /auth/saml/config | JWT (tenant_admin) | Get SAML config |
| PUT | /auth/saml/config | JWT (tenant_admin) | Update SAML config |

## Web Chat Widget

### Bootstrap público (`/widget`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/widget/loader.js` | Public | Embeddable loader script |
| GET | `/widget/config/:widgetId` | Public + origin policy | Public config and active triggers for the public `widgetId` |
| POST | `/widget/sessions` | Public + origin/rate limit | Create or resume a session; body `{widgetId, visitorId, name?, email?, phone?, page?}` |
| POST | `/widget/sessions/refresh` | Public + origin/rate limit | Refresh an existing session from `{token}` |

Messages are not REST endpoints. The browser connects to Socket.IO namespace
`/widget` with the session token in the handshake. It sends `widget:message`
(`{content, type?}`) and may send `widget:typing`. Server events include
`widget:connected`, `widget:history`, `widget:message-received`, `widget:typing`,
`widget:stream_start`, `widget:stream_chunk`, `widget:stream_end`,
`widget:stream_error`, `widget:message` (backward compatibility) and `widget:error`.

### Administración (`/widgets/:tenantId`)

All routes require JWT, TenantGuard and feature `widget`.

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/widgets/:tenantId` | Tenant Admin/Super Admin | List widgets |
| POST | `/widgets/:tenantId` | Tenant Admin/Super Admin | Create widget |
| PUT | `/widgets/:tenantId/:widgetId` | Tenant Admin/Super Admin | Update widget |
| DELETE | `/widgets/:tenantId/:widgetId` | Tenant Admin/Super Admin | Delete widget |
| GET | `/widgets/:tenantId/:widgetId/snippet` | Tenant Admin/Super Admin | Return embed snippet and public `widgetId` |

### Widget Triggers (`/widget/triggers`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/widget/triggers/:widgetConfigId` | JWT + tenant derivado de sesión | tenant_admin, super_admin | Listar definiciones del config UUID dentro del tenant |
| POST | `/widget/triggers/:widgetConfigId` | JWT + tenant derivado de sesión | tenant_admin, super_admin | Crear definición tenant-scoped, sujeta a cuota del plan |
| PUT | `/widget/triggers/:triggerId` | JWT + tenant derivado de sesión | tenant_admin, super_admin | Actualizar solo dentro del tenant autenticado |
| DELETE | `/widget/triggers/:triggerId` | JWT + tenant derivado de sesión | tenant_admin, super_admin | Eliminar solo dentro del tenant autenticado |

`widgetConfigId` es el UUID interno de `widget_configs`; no es el `widgetId` público.
El tenant nunca se acepta del body ni se infiere del UUID: se deriva de la sesión
(`super_admin` debe aportar un contexto de tenant explícito). Los IDs internos no se
proyectan en la configuración pública. El CRUD solo persiste definiciones: el
`widget-loader` actual aún no evalúa `cfg.triggers`, por lo que no hay ejecución
proactiva certificada.

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
| GET | `/api/v1/public/hooks` | X-API-Key | read:webhooks | Listar suscripciones webhook |
| POST | `/api/v1/public/hooks` | X-API-Key | write:webhooks | Suscribir webhook |
| DELETE | `/api/v1/public/hooks/:hookId` | X-API-Key | write:webhooks | Desuscribir webhook por ID |

---

## Drip Sequences (`/automation/drip-sequences`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/automation/drip-sequences/:tenantId` | JWT | tenant_admin, tenant_supervisor, super_admin | Listar secuencias |
| GET | `/automation/drip-sequences/:tenantId/:sequenceId` | JWT | tenant_admin, tenant_supervisor, super_admin | Obtener secuencia |
| POST | `/automation/drip-sequences/:tenantId` | JWT | tenant_admin, tenant_supervisor, super_admin | Crear secuencia |
| PUT | `/automation/drip-sequences/:tenantId/:sequenceId` | JWT | tenant_admin, tenant_supervisor, super_admin | Actualizar secuencia |
| DELETE | `/automation/drip-sequences/:tenantId/:sequenceId` | JWT | tenant_admin, tenant_supervisor, super_admin | Eliminar secuencia |
| POST | `/automation/drip-sequences/:tenantId/:sequenceId/toggle` | JWT | tenant_admin, tenant_supervisor, super_admin | Activar/desactivar |
| POST | `/automation/drip-sequences/:tenantId/:sequenceId/enroll` | JWT | tenant_admin, tenant_supervisor, super_admin | Inscribir contacto |
| POST | `/automation/drip-sequences/:tenantId/:sequenceId/enroll-segment` | JWT | tenant_admin, tenant_supervisor, super_admin | Inscribir segmento |
| POST | `/automation/drip-sequences/:tenantId/:sequenceId/unenroll` | JWT | tenant_admin, tenant_supervisor, super_admin | Desinscribir contacto |
| GET | `/automation/drip-sequences/:tenantId/:sequenceId/enrollments` | JWT | tenant_admin, tenant_supervisor, super_admin | Listar inscritos |

## Automation Templates (`/automation/templates`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/automation/templates` | Público | — | Listar catálogo (filtros: category, industry) |
| GET | `/automation/templates/:id` | Público | — | Obtener plantilla |
| POST | `/automation/templates/:tenantId/install` | JWT + TenantGuard | tenant_admin, tenant_supervisor, super_admin | Instalar plantilla |

---

## Broadcast A/B Testing (`/broadcast/campaigns`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/broadcast/campaigns/:id/variants` | JWT + TenantGuard | tenant_admin, tenant_supervisor | Obtener variantes A/B |
| POST | `/broadcast/campaigns/:id/winner` | JWT + TenantGuard | tenant_admin, tenant_supervisor | Seleccionar ganador A/B |

---

## Email ingress técnico (`/channels/email`)

Esta superficie respalda integraciones administradas. No constituye un contrato de
configuración autoservicio del canal Email.

| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| POST | `/channels/email/inbound` | JSON + secret compartido en header (por defecto `X-Email-Webhook-Secret`) | — | Ingreso técnico de email para una integración previamente administrada |
| GET | `/channels/email/config` | JWT + TenantGuard | Contexto tenant autenticado | Handler genérico `/:channelType/config`; devuelve instrucciones de webhook, no configuración ni credenciales del tenant |

No existen handlers `GET`/`PUT /channels/email/config/:tenantId`. La pantalla
`/admin/channels/email` intenta usar esas rutas, por lo que leer o guardar una
configuración desde esa UI no está soportado ni certificado. El endpoint genérico
`POST /channels/:channelType/connect` tampoco configura el servicio Email de extremo
a extremo y no debe documentarse como sustituto del contrato faltante.

El ingreso administrado falla cerrado: requiere `EMAIL_INBOUND_WEBHOOK_SECRET` (mínimo
32 caracteres), admite cambiar el nombre del header con
`EMAIL_INBOUND_WEBHOOK_HEADER`, limita tamaño/campos y aplica rate limit antes de
consultar qué tenant corresponde al destinatario. Sin secreto configurado responde
`503`; con credenciales inválidas, `401`.

Contrato del body: `Content-Type: application/json`, con `envelope.to` que contenga
exactamente un destinatario. Ese destinatario SMTP autenticado es la única fuente
para resolver el tenant; el header visible `to` se ignora y se reemplaza por el valor
canónico. Un adaptador/reverse proxy administrado debe transformar cualquier evento
multipart del proveedor e inyectar el secret. El multipart directo (incluido
SendGrid Inbound Parse) no está soportado y responde `415`. La idempotencia por
`Message-ID` está aislada por tenant y solo se marca completada después de que el
mensaje queda durable en la cola; un error de enqueue responde `500` y permite retry.
Controller, adapter y cola comparten el mismo `Message-ID` canónico (header primero,
campo JSON `message-id` como fallback), por lo que un retry conserva el mismo `jobId`
aunque falle la escritura posterior del marcador Redis. La resolución consulta hasta
dos configuraciones activas: si la dirección está repetida entre tenants, se rechaza
el enrutamiento y se registra un audit con hash, sin incluir la dirección ni tenant IDs.

---

## Knowledge Gap (`/knowledge`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| POST | `/knowledge/:tenantId/feedback` | JWT + TenantGuard | Admin/Supervisor/Agent | Enviar feedback KB |
| GET | `/knowledge/:tenantId/gap-report` | JWT + TenantGuard | Admin/Supervisor | Reporte de brechas |

---

## FAQs (`/faqs`)

| Método | Ruta | Auth / roles | Descripción |
|--------|------|--------------|-------------|
| GET | `/faqs/public/:tenantSlug` | Público | FAQs publicadas |
| GET | `/faqs/:tenantId` | Super Admin/Admin/Supervisor/Agent + TenantGuard | Listar; Agent lectura |
| GET | `/faqs/:tenantId/:id` | Super Admin/Admin/Supervisor/Agent + TenantGuard | Detalle; Agent lectura |
| POST | `/faqs/:tenantId` | Super Admin/Admin/Supervisor + TenantGuard | Crear |
| PUT | `/faqs/:tenantId/:id` | Super Admin/Admin/Supervisor + TenantGuard | Actualizar |
| DELETE | `/faqs/:tenantId/:id` | Super Admin/Admin/Supervisor + TenantGuard | Eliminar |

## KB Health (`/kb-health`)

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/kb-health/:tenantId` | Super Admin/Admin/Supervisor | Estado de salud de conocimiento |
| POST | `/kb-health/:tenantId/scan` | Super Admin/Admin/Supervisor | Ejecutar escaneo |
| POST | `/kb-health/:tenantId/:id/status` | Super Admin/Admin/Supervisor | Cambiar estado de hallazgo |

Todos requieren JWT, RolesGuard y TenantGuard.

## Ofertas (`/offers`)

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/offers/:tenantId` | Super Admin/Admin/Supervisor/Agent | Listar; admite `activeOnly` |
| GET | `/offers/:tenantId/:id` | Super Admin/Admin/Supervisor/Agent | Detalle |
| POST | `/offers/:tenantId` | Super Admin/Admin/Supervisor | Crear |
| PUT | `/offers/:tenantId/:id` | Super Admin/Admin/Supervisor | Actualizar |
| DELETE | `/offers/:tenantId/:id` | Super Admin/Admin/Supervisor | Eliminar |

## Órdenes (`/orders`)

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/orders/overview/:tenantId` | Admin/Supervisor/Agent | Resumen; para Agent omite métricas financieras restringidas |
| GET | `/orders/contacts/:tenantId` | Admin/Supervisor/Agent | Buscar contactos elegibles |
| POST | `/orders/:tenantId` | Admin/Supervisor/Agent | Crear orden |
| PUT | `/orders/:tenantId/:orderId/status` | Admin/Supervisor/Agent | Cambiar estado permitido por rol |
| GET | `/orders/:tenantId/:orderId/invoice` | Admin/Supervisor/Agent | Vista de factura |

Todos los endpoints privados anteriores usan TenantGuard. Un `super_admin` opera el
workspace tenant mediante el contexto de impersonación previsto por la interfaz.

---

## Pipeline — alcance expuesto

El controlador vigente expone Kanban, etapas, deals, analítica y automatización bajo
`/pipeline`. Aunque el cliente web conserva métodos para
`/pipeline/pipelines/:tenantId`, no existe un handler correspondiente en el backend
actual; esos métodos no deben documentarse ni consumirse como API disponible hasta
que el contrato sea implementado y probado.

---

## AI Resolution (`/dashboard-analytics/ai-resolution`)
| Método | Ruta | Auth | Roles | Descripción |
|--------|------|------|-------|-------------|
| GET | `/dashboard-analytics/ai-resolution/:tenantId` | JWT + TenantGuard | Super Admin/Admin/Supervisor | Estadísticas resolución IA |

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

La conexión admite únicamente Admin, Supervisor y Agent del tenant validado. Las
salas de conversación y de agente incluyen el tenant; abrir, escribir, resolver,
mostrar actividad o usar Copilot vuelve a comprobar visibilidad/propiedad. El room
general del tenant recibe señales de refresco, no el contenido sensible del hilo.

### Cliente → Servidor
| Event | Payload | Descripción |
|-------|---------|------------|
| `agent:join` | `{ agentId, tenantId }` | Conectar agente |
| `conversation:open` | `{ conversationId }` | Abrir chat |
| `conversation:send` | `{ conversationId, content, type }` | Enviar mensaje |
| `conversation:assign` | `{ conversationId, agentId }` | Admin/Supervisor reasignan; Agent solo reclama para sí una conversación libre |
| `conversation:resolve` | `{ conversationId }` | Resolver |
| `agent:typing` | `{ conversationId, typing }` | Escribiendo |

### Servidor → Cliente
| Event | Payload | Descripción |
|-------|---------|------------|
| `inbox:update` | `InboxData` | Actualización completa |
| `inbox:assigned` | `{ conversationId }` | Asignación recibida |
| `inbox:refresh` | — | Recargar inbox (datos cambiaron) |
| `inbox:handoff` | `{ conversationId, reason, metadata }` | Detalle de handoff para roles elevados, agente asignado o viewers autorizados |
| `inbox:handoff_completed` | `{ conversationId }` | Handoff resuelto, conversación devuelta a IA |
| `conversation:message` | `Message` | Mensaje solo en la sala tenant-scoped del chat autorizado |
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
