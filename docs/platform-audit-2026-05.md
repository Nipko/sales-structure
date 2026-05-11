# Parallly — Auditoría Exhaustiva de Plataforma (Mayo 2026)

## Resumen Ejecutivo

**Módulos backend:** 58 (documentábamos 40)
**Páginas dashboard:** 78 (65+ admin + 13 públicas)
**Verticales:** 18 definidas, 10 con módulos dedicados
**Colas BullMQ:** 6 | **Cron jobs:** 26+
**Score general vs industria:** 7.2/10 (industria: 7.8/10) — *actualizado Mayo 11, 2026*
**Fortaleza #1:** AI (8/10, por encima del estándar)
**Brecha #1:** Integraciones (5/10) — Zapier native app pendiente

---

## PARTE 1: INVENTARIO DE FUNCIONALIDADES

### 1.1 — Funcionalidades con Backend + Frontend Completos ✅

| # | Funcionalidad | Backend | Frontend | i18n | Estándar |
|---|---|---|---|---|---|
| 1 | Auth (login/signup/2FA/OAuth Google+Microsoft) | ✅ 32 endpoints | ✅ 6 páginas | ✅ 4 idiomas | ✅ Competitivo |
| 2 | Inbox (consola agente, chat, notas, asignar, resolver) | ✅ 26 endpoints + WebSocket | ✅ Completo | ✅ | ✅ |
| 3 | CRM Contactos (leads, CRUD, bulk, import/export CSV) | ✅ 55+ endpoints | ✅ Lista + detalle 360° | ✅ | ✅ |
| 4 | Pipeline Kanban | ✅ CRUD stages + deals | ✅ Drag-and-drop | ✅ | ⚠️ Parcial* |
| 5 | Automatización (reglas trigger→acción) | ✅ 6 endpoints + BullMQ | ✅ Wizard 4 pasos | ✅ | ⚠️ Básico |
| 6 | Multi-Agente AI (plantillas, canal, schedule) | ✅ 16 endpoints | ✅ Lista + editor hub | ✅ | ✅ Diferenciador |
| 7 | Agent Test Console | ✅ Dry-run | ✅ Debug panel | ✅ | ✅ Diferenciador |
| 8 | Knowledge Base (RAG + KB público) | ✅ 8 endpoints + pgvector | ✅ Upload + portal público | ⚠️ Portal EN only | ⚠️ |
| 9 | FAQs | ✅ CRUD + público | ✅ Completo | ✅ | ✅ |
| 10 | Citas/Appointments | ✅ 31 endpoints + reminders | ✅ Calendar + list + availability | ✅ | ✅ |
| 11 | Public Booking | ✅ 5 endpoints público | ✅ Página pública multi-step | ⚠️ Solo en/es | ⚠️ |
| 12 | Google/Microsoft Calendar | ✅ OAuth + bidirectional sync | ✅ Conectar/desconectar | ✅ | ✅ |
| 13 | Canales (WA/IG/Messenger/Telegram/SMS) | ✅ 15+ endpoints por canal | ✅ Setup pages por canal | ✅ | ✅ |
| 14 | WhatsApp Templates | ✅ Sync + send + poll | ✅ Browse/manage | ✅ | ✅ |
| 15 | Broadcast (campañas masivas) | ✅ 4 endpoints + BullMQ 80/s | ✅ Crear + lanzar + stats | ✅ | ⚠️ Solo WA |
| 16 | Analytics Dashboard (8 tabs) | ✅ 12 endpoints + nightly aggregation | ✅ 8 tabs + export CSV | ✅ | ✅ |
| 17 | CRM Analytics (funnel, velocity, leaderboard) | ✅ 6 endpoints | ✅ 4 tabs recharts | ✅ | ✅ |
| 18 | Agent Analytics (performance, CSAT) | ✅ 9 endpoints | ✅ 4 tabs | ✅ | ✅ |
| 19 | Alertas (threshold rules + scheduled reports) | ✅ 7 endpoints + cron 15min | ✅ CRUD + history | ✅ | ✅ |
| 20 | BI API (externo, X-API-Key) | ✅ 7 endpoints | N/A (API externa) | N/A | ✅ |
| 21 | Billing (MercadoPago, suscripciones) | ✅ 16 endpoints + reconciliation | ✅ Plan + pagos + invoice PDF | ✅ | ⚠️ Solo LatAm |
| 22 | Cupones | ✅ 6 endpoints | ✅ CRUD super_admin | ✅ | ✅ |
| 23 | Financials (MRR, ARR, churn, LTV, forecast) | ✅ 15 endpoints + snapshot mensual | ✅ 5 tabs + CSV export | ✅ | ✅ Diferenciador |
| 24 | Gestión Tenants (super_admin) | ✅ 20+ endpoints | ✅ 6 tabs + detail | ✅ | ✅ |
| 25 | Offboarding (7-step pipeline) | ✅ 7 endpoints + 3 crons | ✅ Via tenant management | ✅ | ✅ |
| 26 | Users + Invitations | ✅ 11 endpoints | ✅ Lista + invitar + skills | ✅ | ✅ |
| 27 | Identity Merge (cross-channel) | ✅ 5 endpoints | ✅ Approve/reject | ✅ | ✅ |
| 28 | Compliance (opt-out, legal, GDPR) | ✅ 14 endpoints | ✅ Tenant + admin views | ✅ | ⚠️ |
| 29 | Media Bank (upload, logo, gallery) | ✅ 8 endpoints | ✅ Gallery + tags | ✅ | ✅ |
| 30 | Email Templates | ✅ 6 endpoints + test send | ✅ Editor + preview | ✅ | ✅ |
| 31 | Políticas (versionadas) | ✅ 6 endpoints + público | ✅ CRUD + versiones | ✅ | ✅ |
| 32 | Pre-chat Form | ✅ 2 endpoints | ✅ Builder + preview | ✅ | ✅ |
| 33 | Business Info | ✅ 3 endpoints + sync tenant | ✅ Editor completo | ✅ | ✅ |
| 34 | Scoring Config | ✅ 2 endpoints | ✅ Sliders 5 factores | ✅ | ✅ |
| 35 | Custom Attributes | ✅ 4 endpoints | ✅ CRUD dinámico | ✅ | ✅ |
| 36 | Pipeline Stages Config | ✅ 5 endpoints | ✅ Drag-to-reorder + color | ✅ | ✅ |
| 37 | Recall (re-engagement) | ✅ 3 endpoints + cron diario | ✅ Config + run-now | ✅ | ✅ |
| 38 | Feature Requests (votación, changelog) | ✅ 10 endpoints + AI signals | ✅ Browse + vote + comment | ✅ | ✅ Diferenciador |
| 39 | Platform Health | ✅ Queue inspection | ✅ BullMQ dashboard | ✅ | ✅ |
| 40 | Audit Logs | ✅ Tabla + endpoints | ✅ Viewer filtrable | ✅ | ✅ |
| 41 | LLM Observability | ✅ Redis aggregation | ✅ Cost/model/tenant drill-down | ✅ | ✅ Diferenciador |
| 42 | Webhook Live-Tail | ✅ Capture + poll | ✅ Viewer real-time | ✅ | ✅ |
| 43 | Acquisition Funnel | ✅ Via tenants stats | ✅ Funnel visualization | ✅ | ✅ |
| 44 | Vertical Analytics | ✅ 3 endpoints | ✅ Cross-tenant view | ✅ | ✅ |

### 1.2 — Verticales con Módulos Dedicados ✅

| # | Vertical | Backend Module | Dashboard Pages | AI Tools | Score |
|---|---|---|---|---|---|
| 45 | Turismo — Vacation Rental | ✅ properties + iCal sync | ✅ /properties + detail 5 tabs | ✅ 5 tools | 8/10 |
| 46 | Turismo — Tours | ✅ tours + inventory + bookings | ✅ /tours + detail | ✅ 4 tools | 8/10 |
| 47 | Inmobiliaria — Listings | ✅ listings + zones | ✅ /listings + detail | ✅ search_listings | 8/10 |
| 48 | Restaurantes — Menu + Orders | ✅ restaurants module | ✅ /menu + /food-orders | ✅ 4 tools | 8/10 |
| 49 | Gimnasios — Memberships + Classes | ✅ gyms module | ✅ /memberships + /classes | ✅ 5 tools | 8/10 |
| 50 | Veterinaria — Pets + Vaccinations | ✅ pets module | ✅ /pets | ✅ 4 tools | 8/10 |
| 51 | Salud — Treatment Plans | ✅ treatment-plans module | ✅ /treatment-plans | ✅ treatments flag | 8/10 |
| 52 | Educación — Courses + Enrollments | ✅ education module | ✅ /courses | ✅ 4 tools | 7/10 |
| 53 | Seguros — Plans + Quotes + Policies | ✅ insurance module | ✅ /insurance | ✅ 4 tools | 7/10 |
| 54 | Servicios del Hogar | ✅ home-services module | ✅ /service-requests | ✅ 2 tools | 7/10 |
| 55 | Fotografía — Sessions | ✅ photography module | ✅ /photo-sessions | ✅ photography flag | 6/10 |
| 56 | Pet Services | ✅ Reusa pets module | ✅ /pets (compartido) | ✅ petServices flag | 5/10 |

### 1.3 — Backend Existente SIN Frontend (Funcionalidad Oculta) ⚠️

| # | Funcionalidad Backend | Endpoints | ¿Por qué sin UI? |
|---|---|---|---|
| 57 | Copilot (AI assistant para agentes) | 5 endpoints (chat, suggestions, summary, intent, ask) | Integrado parcialmente en Inbox (suggest reply) pero sin página propia |
| 58 | External CRM (HubSpot/Pipedrive OAuth + import) | 10 endpoints + 2 BullMQ queues | ✅ Tiene UI en /settings/integrations/crm |
| 59 | Inventory (stock management) | 6 endpoints | Tiene página pero NO está en sidebar |
| 60 | Orders (order tracking) | 5 endpoints | Tiene página pero NO está en sidebar |
| 61 | Catalog/Offers | 10 endpoints | Tiene página pero NO está en sidebar |
| 62 | Landings (page builder) | 2 endpoints (admin) + 2 públicos | Página placeholder — feature no construido |
| 63 | Carla (AI profiles) | 8 endpoints | Sin página funcional |
| 64 | Meta Compliance (GDPR callbacks) | 3 endpoints | Infraestructura, no requiere UI |
| 65 | Internal (service-to-service) | 1 endpoint | Infraestructura |

### 1.4 — Páginas NO en Sidebar (Funcionalidad Accesible Solo por URL) ⚠️

| Página | Ruta | Motivo |
|---|---|---|
| Agent Analytics | /admin/agent-analytics | Debería estar en sidebar o fusionarse con analytics-v2 |
| CRM Analytics | /admin/crm-analytics | Debería estar en sidebar o fusionarse |
| Legacy Analytics | /admin/analytics | Reemplazado por analytics-v2, eliminar |
| Legacy AI Config | /admin/ai | Reemplazado por settings/ai-providers, eliminar |
| Conversations Archive | /admin/conversations | Útil pero no accesible |
| Inventory | /admin/inventory | Útil para retail/restaurantes pero oculto |
| Orders | /admin/orders | Útil pero oculto |
| Catalog Hub | /admin/catalog | Oculto |
| Compliance (tenant) | /admin/compliance | Útil pero no accesible |

### 1.5 — Métodos API sin Uso en Frontend

| Método | Endpoint | Estado |
|---|---|---|
| `createDeal` | POST pipeline/deals | Kanban es read-only en UI — no crea deals |
| `moveDeal` | PUT pipeline/deals/:id/move | Kanban no tiene drag funcional |
| `updateDeal` | PUT pipeline/deals/:id | Sin formulario de edición |
| `getPipelineFunnel` | GET pipeline/analytics/:tenantId | Sin visualización |
| `getConversationMetrics` | Legacy analytics endpoint | Reemplazado |
| `getCSATResponses` | Individual CSAT list | Solo distribución usada |
| `submitCSAT` | POST agent-analytics/csat | Solo automatizado |
| `cancelAccount` | Offboarding endpoint | No expuesto en UI self-service |
| `getCustomerProfile` | Identity unified profile | Identity page solo muestra merge suggestions |

---

## PARTE 2: GAPS I18N

| Página/Componente | Problema | Prioridad |
|---|---|---|
| KB Portal `/kb/[slug]` | 100% hardcoded English | 🔴 Alta |
| Public Booking `/book/[slug]` | Solo en/es inline, no usa next-intl | 🔴 Alta |
| Settings > Notifications | Labels hardcoded English | 🟡 Media |
| Admin layout loading text | "Cargando..." hardcoded Spanish | 🟢 Baja |
| Legacy Analytics page | Stage labels hardcoded English | 🟢 Baja (página deprecada) |

---

## PARTE 3: COMPARACIÓN CON INDUSTRIA

### Scorecard General

| Área | Parallly | Industria | Gap | Prioridad |
|---|---|---|---|---|
| AI Capabilities | **8/10** | 7/10 | **+1** ✅ | Mantener ventaja |
| Analytics Depth | 7/10 | 8/10 | -1 | 🟡 Media |
| Team Collaboration | 6/10 | 8/10 | -2 | 🟡 Media |
| Automation | 5/10 | 8/10 | -3 | 🔴 Alta |
| Customer Engagement | 5/10 | 8/10 | -3 | 🔴 Alta |
| Self-Service | 6/10 | 7/10 | -1 | 🟡 Media |
| **Integration Ecosystem** | **3/10** | 8/10 | **-5** | 🔴 Crítica |
| **Mobile Experience** | **3/10** | 7/10 | **-4** | 🔴 Alta |
| White-labeling | 6/10 | 7/10 | -1 | 🟡 Media |
| Security & Compliance | 6/10 | 8/10 | -2 | 🔴 Alta |
| **Web Chat Widget** | **0/10** | 8/10 | **-8** | 🔴 Crítica |
| **Ticketing System** | **0/10** | 8/10 | **-8** | 🟡 Media* |

*Ticketing es media porque Parallly es conversational-first, no ticket-first.

### Detalle por Área

#### 🔴 CRÍTICO: Integration Ecosystem (3/10)
**Lo que tenemos:** Google/Microsoft Calendar, MercadoPago, iCal, Twilio SMS, 5 LLM providers, HubSpot/Pipedrive (OAuth + import)
**Lo que falta:**
- ❌ Outbound webhooks (eventos → URL externa) — **MÁXIMA PRIORIDAD**
- ❌ Zapier / Make.com native app
- ❌ Stripe / PayPal (global payments)
- ❌ Shopify / WooCommerce / MercadoLibre
- ❌ Slack/Teams notifications para handoffs
- ❌ Google Sheets export/sync
- ❌ Public REST API documentado (solo BI API analytics)
- ❌ n8n / self-hosted automation

#### 🔴 CRÍTICO: Web Chat Widget (0/10)
**Lo que tenemos:** Nada — solo canales de messaging (WA/IG/Messenger/Telegram/SMS)
**Lo que falta:**
- ❌ Widget JS embebible para websites
- ❌ Proactive messaging triggers (exit intent, time on page)
- ❌ Customizable widget theme/colors
- ❌ Pre-chat form en widget
- ❌ Widget → conversación → AI → handoff flow

#### 🔴 ALTA: Automation (5/10)
**Lo que tenemos:** Rules engine con wizard UI, nurturing 3-attempt, execution audit
**Lo que falta:**
- ❌ Visual workflow builder (canvas drag-and-drop, branching)
- ❌ Multi-step sequences con delays configurables
- ❌ Conditional branching (if/then/else, A/B paths)
- ❌ Webhook-triggered automation (inbound HTTP → flow)
- ❌ Automation templates library

#### 🟡 MEDIA: Customer Engagement (7/10)
**Lo que tenemos:** Broadcast WA/Email/SMS multi-canal, nurturing, CSAT trigger, recall, campaign scheduling, WA template creation in-app, custom report builder
**Lo que falta:**
- ❌ Drip sequences configurables
- ❌ Segment → broadcast targeting (segmentos existen pero no conectados)
- ❌ A/B testing
- ❌ Campaign ROI tracking

#### 🔴 ALTA: Mobile Experience (3/10)
**Lo que tenemos:** Responsive CSS, dark/light themes
**Lo que falta:**
- ❌ PWA (manifest.json + service worker + push notifications)
- ❌ Mobile-optimized inbox (swipe actions, quick reply)
- ❌ Native app (iOS/Android) — largo plazo

#### 🟡 MEDIA: Security & Compliance (8/10)
**Lo que tenemos:** JWT + 2FA + refresh rotation, AES-256-GCM, RBAC, audit logs, schema isolation, SAML/SSO, GDPR per-contact erasure (11 tablas), plan enforcement gates
**Lo que falta:**
- ❌ IP allowlist/blocklist
- ❌ SOC 2 preparation

---

## PARTE 4: ANÁLISIS DE VERTICALES

### Matriz de Completitud por Vertical

| Vertical | Módulo | AI Tools | Dashboard | Pipeline | FAQs | Score | ¿Competitivo? |
|---|---|---|---|---|---|---|---|
| Turismo/VR | ✅ vacation-rental + tours | ✅ 9 tools | ✅ 4 páginas | ✅ 6 stages | ✅ 10 | **8/10** | ⚠️ Falta channel manager API |
| Restaurantes | ✅ restaurants | ✅ 4 tools | ✅ 2 páginas | ✅ 5 stages | ✅ 5 | **8/10** | ⚠️ Falta POS, reservas propias |
| Gimnasios | ✅ gyms | ✅ 5 tools | ✅ 2 páginas | ✅ pipeline | ✅ 5 | **8/10** | ⚠️ Falta pagos recurrentes |
| Veterinaria | ✅ pets | ✅ 4 tools | ✅ 1 página | ✅ pipeline | ✅ 5 | **8/10** | ⚠️ Falta historial clínico |
| Inmobiliaria | ✅ listings | ✅ search | ✅ 2 páginas | ✅ 7 stages | ✅ 10 | **8/10** | ⚠️ Falta portal sync |
| Salud | ✅ treatment-plans | ✅ treatments | ✅ 1 página | ✅ 6 stages | ✅ 10 | **8/10** | ⚠️ Falta SOAP notes |
| Educación | ✅ education | ✅ 4 tools | ✅ 1 página | ✅ 6 stages | ✅ 5 | **7/10** | ⚠️ Falta cobros, LMS |
| Seguros | ✅ insurance | ✅ 4 tools | ✅ 1 página | ✅ 6 stages | ✅ 5 | **7/10** | ⚠️ Falta docs, renovaciones |
| Servicios Hogar | ✅ home-services | ✅ 2 tools | ✅ 1 página | ✅ 6 stages | ✅ 5 | **7/10** | ❌ Falta dispatch, GPS |
| Fotografía | ✅ photography | ✅ flag | ✅ 1 página | ✅ pipeline | ✅ 5 | **6/10** | ❌ Falta portfolio, contratos |
| Moda/Belleza | ❌ Sin módulo | ❌ | ❌ | ✅ 5 stages | ✅ 5 | **5/10** | ❌ Falta staff scheduling |
| Automotriz | ❌ Sin módulo | ❌ | ❌ | ✅ 7 stages | ✅ 5 | **5/10** | ❌ Falta vehicle inventory |
| Pet Services | ⚠️ Reusa pets | ⚠️ flag | ⚠️ Compartido | ✅ pipeline | ✅ 5 | **5/10** | ❌ Falta grooming workflow |
| Finanzas | ❌ Sin módulo | ❌ | ❌ | ✅ 6 stages | ✅ 5 | **4/10** | ❌ Solo CRM genérico |
| Serv. Profesionales | ❌ Sin módulo | ❌ | ❌ | ✅ 6 stages | ✅ 5 | **4/10** | ❌ Solo CRM genérico |
| Retail | ❌ Sin módulo | ❌ | ❌ | ✅ pipeline | ✅ 5 | **3/10** | ❌ Falta e-commerce native |
| Technology | ❌ Sin módulo | ❌ | ❌ | ✅ 7 stages | ✅ 5 | **3/10** | ❌ Solo CRM genérico |
| Otro | ❌ Fallback | ❌ | ❌ | ✅ genérico | ❌ | **2/10** | ❌ Sin adaptación |

### Gaps Transversales de Verticales

| Gap | Verticales Afectadas | Competidor Referencia |
|---|---|---|
| No hay pasarela de pago en booking | TODOS los que agendan | Calendly, SimplyBook |
| No hay staff/technician scheduling | Belleza, Hogar, Salud | Fresha, Vagaro, Jobber |
| No hay notificaciones WhatsApp post-booking | TODOS | Todos los competidores |
| No hay channel manager API (solo iCal) | Turismo/VR | Hostaway, Guesty |
| No hay vehicle/product inventory schema | Automotriz, Retail | DealerSocket, Shopify |
| No hay clinical notes/SOAP | Salud, Veterinaria | Dentrix, eVetPractice |
| No hay payment tracking en enrollments | Educación | Hotmart, Teachable |

---

## PARTE 5: PLAN DE MEJORA PRIORIZADO

### TIER 1 — Alto ROI, Esfuerzo Bajo-Medio (1-2 semanas c/u)

| # | Feature | Impacto | Esfuerzo | Detalles |
|---|---|---|---|---|
| 1 | **Outbound Webhooks** | 🔴 Crítico | 3-5 días | Tabla `webhook_endpoints` (URL, events, secret). Emitir HTTP POST en eventos clave (new_lead, handoff, appointment_booked, message_received). Esto desbloquea Zapier/Make/n8n sin construir cada integración |
| 2 | **Broadcast Scheduling** | 🔴 Alto | 2-3 días | Agregar `scheduled_at` a broadcast. BullMQ delay. UI: date picker en campaign creation |
| 3 | **Segment → Broadcast Targeting** | 🔴 Alto | 2-3 días | Conectar segmentos existentes con broadcast. UI: dropdown de segmentos al crear campaña |
| 4 | **Exposer páginas ocultas en sidebar** | 🟡 Medio | 1 día | Agregar Inventory, Orders, Compliance, CRM Analytics, Agent Analytics al sidebar con visibility rules por vertical |
| 5 | **i18n KB Portal** | 🟡 Medio | 2 días | Migrar `/kb/[slug]` a next-intl, 4 idiomas |
| 6 | **i18n Public Booking** | 🟡 Medio | 1 día | Migrar `/book/[slug]` a next-intl, agregar pt/fr |
| 7 | **i18n Settings Notifications** | 🟢 Bajo | 0.5 días | Reemplazar strings hardcoded con useTranslations |
| 8 | **Pipeline Kanban write ops** | 🟡 Medio | 2 días | Conectar createDeal, moveDeal, updateDeal al UI. Drag-and-drop funcional |
| 9 | **Conversation auto-summary at handoff** | 🟡 Medio | 1-2 días | Una llamada LLM al escalar, mostrar en inbox panel |
| 10 | **Eliminar páginas legacy** | 🟢 Bajo | 0.5 días | Remover /admin/analytics y /admin/ai (reemplazadas) |

### TIER 2 — Medio Esfuerzo, Alto Impacto Competitivo (2-4 semanas c/u)

| # | Feature | Impacto | Esfuerzo | Detalles |
|---|---|---|---|---|
| 11 | ~~**PWA (Progressive Web App)**~~ | ✅ Hecho | — | manifest.json, service worker, push notifications, installable app |
| 12 | ~~**Multi-channel Campaigns**~~ | ✅ Hecho | — | Broadcast a WA + Email + SMS ya funcional. UI: channel selector, processor por canal, stats por canal, resolución inteligente de destinatarios |
| 13 | ~~**Visual Automation Builder**~~ | ✅ Hecho | — | React Flow canvas con nodos drag-and-drop, trigger/condition/action/delay nodes |
| 14 | ~~**Web Chat Widget**~~ | ✅ Hecho | — | JS snippet embebible, WebSocket gateway, configurator en dashboard, AI → handoff flow |
| 15 | ~~**WA Template Management in-app**~~ | ✅ Hecho | — | POST /channels/whatsapp/templates/create + modal con preview en vivo, envío a Meta Graph API, tracking de estado |
| 16 | ~~**SAML/SSO**~~ | ✅ Hecho | — | Passport MultiSaml strategy, per-tenant IdP config, domain check, force-SSO, JIT provisioning, UI config |
| 17 | ~~**Stripe Billing**~~ | ✅ Hecho | — | IPaymentProvider implementado, PaymentProviderFactory routes entre Stripe y MercadoPago |
| 18 | ~~**Custom Report Builder**~~ | ✅ Hecho | — | saved_reports table + CRUD API (5 endpoints) + /admin/report-builder con 16 métricas, 4 tipos de gráfico, recharts, guardar/editar/duplicar/favoritos |
| 19 | ~~**GDPR Contact Erasure API**~~ | ✅ Hecho | — | eraseContactData() anonimiza 11+ tablas, endpoint POST /compliance/erase-contact/:tenantId/:contactId, UI super-admin |

### TIER 3 — Largo Plazo, Estratégico (1-3 meses)

| # | Feature | Impacto | Esfuerzo | Detalles |
|---|---|---|---|---|
| 20 | **Zapier Native App** | 🔴 Crítico | 1-2 meses | Depende de outbound webhooks (#1). Publicar app en Zapier marketplace |
| 21 | **Shopify/WooCommerce Connector** | 🟡 Medio | 1 mes | E-commerce vertical. Cart abandonment, order status bots, product recommendations |
| 22 | **Native Mobile App** | 🟡 Medio | 2-3 meses | React Native. Agent inbox + push notifications. Crítico para LatAm (agentes en móvil) |
| 23 | **Voice AI Channel** | 🟡 Medio | 2-3 meses | Integración con Twilio/Retell. Phone calls con AI. Nuevo canal |
| 24 | **White-label / Reseller Mode** | 🟡 Medio | 1-2 meses | Custom domains para KB/booking, remove Parallly branding, agency reseller GTM |
| 25 | **Sentiment Analysis** | 🟡 Medio | 2 semanas | Real-time scoring per conversation. Auto-escalate on negative trend |
| 26 | **Customer Portal** | 🟡 Medio | 1-2 meses | Login para clientes finales. Ver historial, citas, status. Diferenciador |

---

## PARTE 6: VERTICALES — QUÉ FALTA PARA SER REFERENTE

### Verticales que necesitan módulo dedicado (actualmente solo CRM genérico)

| Vertical | Módulo Necesario | Esfuerzo | Features Clave |
|---|---|---|---|
| **Moda/Belleza** | `beauty` module | 2 semanas | Staff scheduling por servicio, loyalty program, product sales, before/after photos |
| **Automotriz** | `vehicles` module | 2 semanas | Vehicle inventory (VIN, year, mileage, photos), test drive scheduling, financing calculator, trade-in estimate |
| **Retail** | Integración e-commerce | 3-4 semanas | Shopify/WooCommerce connector, cart abandonment flow, product recommendation AI tool |
| **Technology** | No requiere módulo | — | Mejorar con: demo scheduling automation, proposal templates, SLA tracking via pipeline |
| **Finanzas** | `finance-services` module | 2 semanas | Pre-qualification flow, document collection, credit calculator, portfolio tracker |
| **Serv. Profesionales** | `professional` module | 1-2 semanas | Case management, document requests, billing/retainer tracking, time tracking |

### Mejoras a verticales existentes (para ser referente mundial)

| Vertical | Mejora | Esfuerzo | Impacto |
|---|---|---|---|
| **Turismo/VR** | Channel manager API (Hostaway/Guesty) en lugar de solo iCal | 3 semanas | 🔴 Elimina delay 6-12h de iCal |
| **Turismo/VR** | Payment link en booking (MercadoPago/Stripe) | 1 semana | 🔴 Monetización directa |
| **Restaurantes** | Reservas propias (no solo appointments genérico) | 1 semana | 🟡 Mesas, capacidad, turnos |
| **Restaurantes** | Kitchen display system integration | 2 semanas | 🟡 Diferenciador |
| **Gimnasios** | Pagos recurrentes de membresía | 2 semanas | 🔴 Revenue tracking |
| **Gimnasios** | Check-in QR/barcode | 1 semana | 🟡 UX |
| **Veterinaria** | Historial clínico + SOAP notes | 2 semanas | 🔴 Requerimiento profesional |
| **Salud** | Clinical notes + imaging | 2 semanas | 🔴 Requerimiento profesional |
| **Educación** | Payment tracking en enrollments | 1 semana | 🔴 Revenue |
| **Educación** | Attendance + certificados | 2 semanas | 🟡 Completitud |
| **Seguros** | Document attachment en claims | 1 semana | 🔴 Workflow básico |
| **Seguros** | Renewal reminder automation | 1 semana | 🟡 Retención |
| **Hogar** | Technician dispatch + scheduling | 2 semanas | 🔴 Operación básica |
| **Fotografía** | Gallery delivery link (tipo Shootproof) | 1 semana | 🟡 Diferenciador |
| **Fotografía** | Contratos + depósitos | 1 semana | 🟡 Revenue |

---

## PARTE 7: PREPARACIÓN PARA PLANES DE PAGO

### Feature Matrix Propuesta (para delimitar plans)

Las siguientes categorías deben controlarse por plan:

| Dimensión | Starter | Pro | Enterprise | Custom |
|---|---|---|---|---|
| **Agentes AI** | 1 | 3 | 10 | ∞ |
| **Calendarios** | 1 | 3 | 10 | ∞ |
| **Canales** | 2 | 4 | 5 (todos) | 5 |
| **Contactos** | 500 | 5,000 | 50,000 | ∞ |
| **Mensajes outbound/h** | 200 | 2,000 | 20,000 | ∞ |
| **Broadcasts/mes** | 2 | 10 | ∞ | ∞ |
| **Automation rules** | 3 | 15 | ∞ | ∞ |
| **Team members** | 2 | 5 | 25 | ∞ |
| **Knowledge docs** | 10 | 50 | 500 | ∞ |
| **Custom attributes** | 5 | 20 | ∞ | ∞ |
| **Email templates** | 4 (default) | 20 | ∞ | ∞ |
| **Media storage** | 100MB | 1GB | 10GB | ∞ |
| **API access (BI)** | ❌ | ❌ | ✅ | ✅ |
| **Outbound webhooks** | ❌ | 3 | ∞ | ∞ |
| **External CRM** | ❌ | ✅ 1 conexión | ✅ ∞ | ✅ |
| **Scheduled reports** | ❌ | Weekly | Weekly + Monthly | Custom |
| **SAML/SSO** | ❌ | ❌ | ✅ | ✅ |
| **White-label** | ❌ | ❌ | ❌ | ✅ |
| **Custom domain KB** | ❌ | ❌ | ✅ | ✅ |
| **Priority support** | Email | Email + Chat | Dedicated CSM | ✅ |
| **Data retention** | 6 meses | 1 año | 2 años | Custom |
| **Vertical modules** | Básico | Completo | Completo + API | ✅ |
| **LLM tier** | tier_3 (budget) | tier_2 | tier_1 (premium) | tier_1 |
| **Scoring + Insights** | Scoring básico | Scoring + AI Insights | ✅ | ✅ |
| **Recall campaigns** | ❌ | ✅ | ✅ | ✅ |
| **Pipeline stages** | 5 max | 15 | ∞ | ∞ |
| **Segments** | 3 | 15 | ∞ | ∞ |

### Features que TODOS los planes deben incluir (no gatear)
- Inbox con AI
- 1 canal mínimo
- CRM básico (contactos + pipeline)
- Appointments básico
- Business info + pre-chat form
- Analytics básico (overview)
- 2FA security
- i18n (4 idiomas)
- Vertical adaptation (sidebar, terminology, FAQs seed)

---

## PARTE 8: PRIORIZACIÓN EJECUTIVA

### Fase 1 — Foundation (Semanas 1-4) ✅ COMPLETADA
**Objetivo:** Cerrar gaps críticos que bloquean ventas

1. ~~Outbound Webhooks~~ ✅
2. ~~Pipeline Kanban write ops~~ ✅
3. ~~Broadcast scheduling + segment targeting~~ ✅
4. ~~Exposer páginas ocultas en sidebar~~ ✅
5. ~~i18n KB Portal + Public Booking~~ ✅
6. ~~Eliminar páginas legacy~~ ✅
7. ~~GDPR contact erasure API~~ ✅

### Fase 2 — Competitive Parity (Semanas 5-10) ✅ COMPLETADA
**Objetivo:** Alcanzar estándar de industria en las áreas más débiles

8. ~~PWA + push notifications~~ ✅
9. ~~Web Chat Widget~~ ✅
10. ~~Multi-channel campaigns~~ ✅
11. ~~Conversation auto-summary~~ ✅

### Fase 3 — Differentiation (Semanas 11-18) ✅ COMPLETADA
**Objetivo:** Features que nos separan de la competencia

12. ~~Visual Automation Builder~~ ✅
13. ~~Stripe billing~~ ✅
14. ~~SAML/SSO~~ ✅
15. ~~Vertical modules faltantes (Belleza, Automotriz)~~ ✅

### Fase 4 — World-Class (Meses 5-8)
**Objetivo:** Convertirse en referente

16. Zapier native app
17. Native mobile app
18. ~~Customer portal~~ ✅
19. ~~White-label mode~~ ✅
20. ~~Shopify/WooCommerce connector~~ ✅
21. Voice AI channel
22. ~~Channel manager API (turismo)~~ ✅

---

*Documento generado: Mayo 10, 2026 — Actualizado: Mayo 11, 2026*
*Fuentes: Auditoría automática de 67+ módulos backend, 80+ páginas frontend, 18 verticales, comparación con 15+ competidores*
*Tier 2 completado al 100%. Fases 1-3 completadas. Fase 4: 4/7 ítems completados.*
