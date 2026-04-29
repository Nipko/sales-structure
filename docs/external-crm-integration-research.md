# Integración con CRMs Externos — Investigación y Diseño Arquitectónico

**Proyecto:** Parallly (Parallext Engine)  
**Fecha:** Abril 2026  
**Propósito:** Diseño de la capa de sincronización con CRMs externos para tenants que ya poseen su propio CRM  
**Audiencia:** Equipo técnico + Product Owner

---

## Índice

1. [Contexto y Objetivo](#1-contexto-y-objetivo)
2. [Investigación por CRM — Tier 1](#2-investigación-por-crm--tier-1)
3. [Investigación por CRM — Tier 2](#3-investigación-por-crm--tier-2)
4. [Tabla Comparativa Consolidada](#4-tabla-comparativa-consolidada)
5. [Patrón de Integración Recomendado](#5-patrón-de-integración-recomendado)
6. [Capa de Abstracción ICrmAdapter](#6-capa-de-abstracción-icrm-adapter)
7. [Field Mapping UI](#7-field-mapping-ui)
8. [Conflict Resolution](#8-conflict-resolution)
9. [Initial Import Flow](#9-initial-import-flow)
10. [Almacenamiento de Secrets Multi-Tenant](#10-almacenamiento-de-secrets-multi-tenant)
11. [Plan Gating](#11-plan-gating)
12. [Roadmap de Implementación](#12-roadmap-de-implementación)
13. [Fallback Nativo](#13-fallback-nativo)
14. [Diferenciadores sobre Competidores](#14-diferenciadores-sobre-competidores)
15. [Riesgos Técnicos](#15-riesgos-técnicos)

---

## 1. Contexto y Objetivo

### El problema
Un porcentaje creciente de los prospectos de Parallly que pertenecen al segmento pro/enterprise ya tienen un CRM activo (HubSpot, Pipedrive, Kommo, Zoho u otro) con contactos, deals e historial. La objeción de ventas más frecuente es:

> "Ya tenemos nuestro CRM. No queremos duplicar datos ni tener dos sistemas desincronizados."

Sin integración con CRMs externos, Parallly pierde deals en el segmento medio-alto y se percibe como un punto ciego que rompe el flujo de información comercial.

### El objetivo
Diseñar una capa de integración que permita a los tenants de Parallly conectar opcionalmente su CRM externo para que:

- Contactos nuevos captados por Parallly (vía WhatsApp/IG/Messenger/Telegram) fluyan automáticamente al CRM externo.
- Leads y deals creados en Parallly se sincronicen con los pipelines del CRM externo.
- Notas, actividades y transcripciones de conversaciones queden registradas como activities/engagements en el CRM externo.
- Opcionalmente, contactos del CRM externo se importen a Parallly para enriquecer el perfil del cliente.

La integración es **opt-in**, plan-gated, y no reemplaza el CRM interno de Parallly (que sigue funcionando como sistema central para todos los tenants).

---

## 2. Investigación por CRM — Tier 1

### 2.1 HubSpot

#### Autenticación
- **Método preferido:** OAuth 2.0 (Authorization Code Flow). Para apps internas: Private Apps con access token estático.
- **API depreciada:** Las API Keys legacy quedaron eliminadas. Todo debe usar OAuth 2.0 o Private Apps.
- **Tokens:** Access token con duración indefinida para Private Apps; OAuth tokens tienen refresh tokens de larga duración.
- **2026 cambio importante:** HubSpot migró a date-based API versioning. El nuevo formato de endpoints es `/crm/objects/2026-03/contacts` en lugar de `/crm/v3/objects/contacts`. Las apps que se listen/recertifiquen en el Marketplace deben usar la versión `2026-03` o superior.
- **Scopes relevantes:**
  - `crm.objects.contacts.read` / `.write`
  - `crm.objects.deals.read` / `.write`
  - `crm.objects.companies.read` / `.write`
  - `crm.objects.notes.read` / `.write`
  - `crm.objects.tasks.read` / `.write`
  - `timeline` (para crear engagement timeline entries)
  - `crm.schemas.contacts.read` (para leer custom properties)

#### Modelo de datos
| Concepto Parallly | Objeto HubSpot | Notas |
|---|---|---|
| Contact | Contact | Propiedades: `firstname`, `lastname`, `email`, `phone`, `hs_whatsapp_phone_number` |
| Lead | Deal | Pipeline + stages configurables por tenant |
| Pipeline Stage | Deal Stage | Cada pipeline tiene sus propias stages |
| Note | Note (Engagement) | `POST /crm/v3/objects/notes` |
| Task | Task (Engagement) | `POST /crm/v3/objects/tasks` |
| Conversation transcript | Communication / Note | Se puede usar Engagements API para registrar historial |
| Custom attributes | Custom Properties | Definidas en portal HubSpot, accesibles via Property API |
| Company | Company | Objeto separado, asociable a Contact |

#### Endpoints clave
```
GET  /crm/v3/objects/contacts           — Listar contactos (paginado por cursor)
POST /crm/v3/objects/contacts           — Crear contacto
PATCH /crm/v3/objects/contacts/{id}     — Actualizar contacto
POST /crm/v3/objects/contacts/batch/create  — Crear hasta 100 contactos
POST /crm/v3/objects/contacts/batch/update  — Actualizar hasta 100 contactos
POST /crm/v3/objects/contacts/search    — Buscar por email/phone (deduplicación)

GET  /crm/v3/objects/deals              — Listar deals
POST /crm/v3/objects/deals              — Crear deal
PATCH /crm/v3/objects/deals/{id}        — Actualizar deal / mover stage
POST /crm/v3/objects/associations/...  — Asociar contact ↔ deal

POST /crm/v3/objects/notes             — Crear nota (asociable a contact o deal)
POST /crm/v3/objects/tasks             — Crear tarea
GET  /crm/v3/properties/contacts       — Listar propiedades (para field mapping)
```

#### Webhooks salientes (HubSpot → Parallly)
- HubSpot soporta webhooks via **Workflow triggers** (requiere Operations Hub o Enterprise) o via **App Webhook Subscriptions** (para apps OAuth).
- **Limitación crítica:** Los webhooks de Workflows para usuarios finales requieren plan Professional o Enterprise + Operations Hub (~$20/mes extra). En planes Free/Starter, los webhooks via Workflows no están disponibles.
- Para apps OAuth publicadas en Marketplace, los App Webhook Subscriptions funcionan en todos los tiers.
- Eventos disponibles: `contact.creation`, `contact.propertyChange`, `deal.creation`, `deal.propertyChange`, `deal.stageChange`.

#### Rate Limits
| Plan | Requests / 10s | Daily |
|---|---|---|
| Free | 100 | 250,000 |
| Starter | 100 | 250,000 |
| Professional | 190 | sin límite publicado |
| Enterprise | 190 | sin límite publicado |
| Add-on (+$500/mo) | 250 | 1,000,000 |

Para apps OAuth: 100 req/10s independiente del plan del tenant.

#### Bulk operations
- `POST /crm/v3/objects/contacts/batch/create`: hasta 100 registros por llamada.
- `POST /crm/v3/objects/contacts/batch/update`: hasta 100 registros.
- Para imports masivos iniciales (miles de contactos): HubSpot Import API (`/crm/v3/imports`) acepta CSV files hasta 1M registros, procesa async.

#### Pricing del API
- **Free:** API accesible, OAuth funciona. Limitaciones en webhooks de workflows.
- **Starter ($15-$20/mes):** Igual que Free en API. Sin webhooks de Workflows.
- **Professional:** Webhooks en Workflows disponibles.
- **Enterprise:** Todas las features. Mínimo ~$4,320/año.
- **Conclusión:** El 80% de clientes PYMEs tendrán plan Free o Starter. Los webhooks *de usuario* son limitados, pero si publicamos una app en Marketplace con OAuth, los App Webhook Subscriptions funcionan en todos los planes.

#### Marketplace
- HubSpot App Marketplace: publicación gratuita, requiere revisión y certificación.
- Beneficio: distribución orgánica + credibilidad + webhook access en todos los tiers.
- Desde 2026, apps nuevas no pueden usar legacy CRM cards; deben usar App Cards v2.
- Idioma: HubSpot soporta español nativo en su interfaz y documentación.

---

### 2.2 Salesforce

#### Autenticación
- **OAuth 2.0** obligatorio. Flujos disponibles: Authorization Code (para apps instaladas), Client Credentials (para server-to-server), JWT Bearer (M2M sin usuario).
- Connected App requerida: se registra en el org del cliente, genera `client_id` y `client_secret`.
- Endpoint de autorización: `https://login.salesforce.com/services/oauth2/authorize`
- Endpoint de token: `https://login.salesforce.com/services/oauth2/token`
- **Scopes relevantes:** `api`, `refresh_token`, `offline_access`

#### Modelo de datos
| Concepto Parallly | Objeto Salesforce | Notas |
|---|---|---|
| Contact | Contact + Lead (diferenciados) | Lead es prospecto no calificado; Contact es cliente |
| Lead (no calificado) | Lead | `POST /services/data/v60.0/sobjects/Lead` |
| Deal | Opportunity | Stage definida en el org |
| Pipeline | Pipeline (via Opportunity.StageName) | No es objeto separado |
| Note | Note / ContentNote | Note legacy o ContentNote moderno |
| Activity/Call | Activity (Task o Event) | Tasks son to-dos; Events son en tiempo real |
| Conversation | EmailMessage / custom object | No hay objeto nativo para WhatsApp |
| Custom attributes | Custom Fields en cualquier objeto | Requieren ser creados primero en el org |

#### Endpoints clave
```
POST /services/data/v60.0/sobjects/Contact      — Crear contacto
PATCH /services/data/v60.0/sobjects/Contact/{id} — Actualizar
POST /services/data/v60.0/composite/             — Crear múltiples objetos en 1 request
POST /services/data/v60.0/composite/batch        — Batch de hasta 25 requests
POST /services/data/v60.0/sobjects/Opportunity   — Crear deal
POST /services/data/v60.0/sobjects/Task          — Crear actividad/tarea
GET  /services/data/v60.0/query?q=SELECT+...     — SOQL query (paginado)
POST /services/data/v60.0/sobjects/Lead          — Crear lead
```

#### Webhooks salientes (Salesforce → Parallly)
- **Outbound Messages:** mecanismo nativo SOAP-based, menos moderno pero funcional.
- **Platform Events:** pub/sub nativo de Salesforce, requiere suscriptor.
- **Change Data Capture (CDC):** stream de cambios en objetos seleccionados. Requiere Streaming API.
- **Flow → HTTP Callout:** Flows de Salesforce pueden llamar webhooks externos.
- **Complejidad:** Alta. Configurar CDC o Platform Events en el org del cliente requiere permisos de admin y conocimientos de Salesforce.

#### Rate Limits
| Edición | API calls/24h | Notas |
|---|---|---|
| Enterprise | 100,000 | Base por org |
| Unlimited | 1,000,000+ | |
| Professional + API add-on | 15,000 | Add-on ~$25/user/mes |
| Developer | Ilimitado (sandbox) | Solo dev |

- **Limitación crítica:** Professional Edition NO incluye API access por defecto. Se requiere Enterprise mínimo, o add-on específico. Esto es una barrera real para PYMEs.
- Concurrent API request limit: 25 long-running requests.

#### Bulk operations
- **Bulk API 2.0:** Jobs asíncronos para cargas masivas (>10K registros). Divide en batches de hasta 10,000 registros por job.
- **Composite API:** hasta 25 sub-requests en 1 llamada HTTP.
- Para import inicial masivo: Bulk API 2.0 es la ruta correcta.

#### Pricing del API
- **Professional:** ~$80/usuario/mes. API access NO incluida por defecto.
- **Enterprise:** ~$165/usuario/mes. API access incluida.
- **Conclusión para Parallly:** Salesforce es viable técnicamente, pero el 60-70% de clientes LatAm que usan Salesforce están en Enterprise (industrias tradicionales: banca, seguros, telecomunicaciones). El costo de desarrollo y mantenimiento del adapter es alto. Prioridad baja para MVP.

#### Marketplace
- Salesforce AppExchange: publicación requiere Security Review (~$150 fee + semanas de revisión).
- Muy relevante para clientes enterprise. Alta credibilidad.
- Idioma: Salesforce soporta español nativo.

---

### 2.3 Pipedrive

#### Autenticación
- **OAuth 2.0** (recomendado para apps de terceros) y API tokens personales (para scripts internos).
- Authorization Code Flow: `https://oauth.pipedrive.com/oauth/authorize`
- Token endpoint: `https://oauth.pipedrive.com/oauth/token`
- **Migración crítica:** API V1 se depreca el **31 de julio de 2026**. La integración DEBE construirse sobre V2.
- OAuth tokens funcionan en ambas versiones (V1 y V2).

#### Modelo de datos
| Concepto Parallly | Objeto Pipedrive | Notas |
|---|---|---|
| Contact | Person | `persons` endpoint |
| Company | Organization | `organizations` endpoint |
| Lead (frio) | Lead | Objeto separado en Pipedrive (no es Deal) |
| Deal activo | Deal | Tiene pipeline_id + stage_id |
| Pipeline | Pipeline | Múltiples pipelines soportados |
| Note | Note | Asociable a Person, Deal, Org |
| Activity | Activity | Email, llamada, reunión, etc. |
| Custom attributes | Custom Fields | Definidos por usuario, accesibles via Fields API |

#### Endpoints clave (V2)
```
GET  /api/v2/persons                   — Listar personas (cursor-based pagination)
POST /api/v2/persons                   — Crear persona
PATCH /api/v2/persons/{id}             — Actualizar
POST /api/v2/persons/collection        — Batch create (hasta 500 por request)

GET  /api/v2/deals                     — Listar deals
POST /api/v2/deals                     — Crear deal
PATCH /api/v2/deals/{id}               — Mover stage

POST /api/v1/notes                     — Crear nota (V2 de notas pendiente)
GET  /api/v1/pipelines                 — Listar pipelines
GET  /api/v1/stages                    — Listar stages por pipeline
GET  /api/v1/dealFields                — Custom fields de deals (para field mapping)
```

#### Webhooks salientes (Pipedrive → Parallly)
- Pipedrive soporta webhooks nativos: `GET/POST /webhooks`
- Eventos: `added.person`, `updated.person`, `added.deal`, `updated.deal`, `deleted.deal`, etc.
- Límite: **40 webhooks por usuario** en la cuenta.
- Pipedrive envía payload JSON al URL configurado via POST.
- Soporte para todos los planes pagos.

#### Rate Limits (Token-Based Rate Limit — TBRL)
| Plan | Multiplier | Base daily tokens | Burst (2s window) OAuth |
|---|---|---|---|
| Lite | 1x | 30,000 | 80 tokens |
| Growth | 2x | 60,000 | 160 tokens |
| Premium | 5x | 150,000 | 400 tokens |
| Ultimate | 7x | 210,000 | 480 tokens |

Costos aproximados por operación:
- GET single: 2 tokens
- GET list: 20 tokens
- POST/PATCH: 10 tokens
- Search: 40 tokens

Para sync inicial de 10,000 contactos con plan Lite: 10,000 × 10 tokens = 100,000 tokens → necesita +3 días con el presupuesto diario. **Con batching y plan Growth es viable en 1-2 días.**

#### Bulk operations
- V2 soporta `collection` endpoint para batch: `POST /api/v2/persons/collection` hasta 500 registros.
- Import inicial grande: Pipedrive tiene Import UI nativa pero no Bulk API async. El batch de 500 es la mejor opción programática.

#### Pricing del API
- Todos los planes pagos incluyen API access.
- Lite: ~$15/usuario/mes. El plan más básico tiene API.
- Conclusión: Pipedrive es el más accesible técnica y económicamente. Muy popular en PYMEs LatAm.

#### Marketplace
- Pipedrive Marketplace: publicación requiere review. Acceso a ~100,000 empresas.
- Idioma: Pipedrive soporta español nativo.

---

### 2.4 Zoho CRM

#### Autenticación
- **OAuth 2.0** exclusivo (desde v8 en 2026, API keys legacy eliminadas).
- Autorización: `https://accounts.zoho.com/oauth/v2/auth`
- Token: `https://accounts.zoho.com/oauth/v2/token`
- Access tokens expiran en ~1 hora; refresh tokens son de larga duración.
- **Consideración LatAm:** El datacenter puede variar (EU, US, AU, IN). Para LatAm, generalmente `accounts.zoho.com` pero también `accounts.zoho.com.mx` para México. La URL base del API cambia: `https://www.zohoapis.com/crm/v8/`.

#### Modelo de datos
| Concepto Parallly | Módulo Zoho | Notas |
|---|---|---|
| Contact | Contacts | Módulo estándar |
| Lead | Leads | Módulo separado de Contacts |
| Deal | Deals (Potentials) | Asociado a Contact o Lead |
| Pipeline | Stages dentro de Deals | El campo `Stage` tiene valores configurables |
| Note | Notes | Sub-módulo de cualquier objeto |
| Activity | Activities (Tasks, Events, Calls) | Módulos separados |
| Custom attributes | Custom Fields | Definidos en cada módulo |
| Company | Accounts | Módulo estándar |

#### Endpoints clave (V8)
```
GET  /crm/v8/Contacts                  — Listar contactos (page + per_page)
POST /crm/v8/Contacts                  — Crear contacto (hasta 100 en array)
PUT  /crm/v8/Contacts                  — Upsert por duplicate_check_fields
POST /crm/v8/Leads                     — Crear lead
GET  /crm/v8/Deals                     — Listar deals
POST /crm/v8/Deals                     — Crear deal
POST /crm/v8/Contacts/{id}/Notes       — Crear nota asociada
GET  /crm/v8/settings/fields?module=Contacts — Custom fields (para mapping)
POST /crm/v8/bulk/write                — Bulk write hasta 25,000 registros (async)
GET  /crm/v8/bulk/read/{job_id}        — Bulk read resultado
```

#### Webhooks salientes (Zoho → Parallly)
- Zoho tiene **Workflow Rules** que pueden enviar notifications HTTP a URLs externas.
- Soporta todos los módulos principales: Leads, Contacts, Deals.
- Eventos: create, edit, delete, field change.
- **Disponible en todos los planes pagos** (Standard en adelante, no Free).
- Configuración desde la UI de Zoho en Automation → Workflow Rules.

#### Rate Limits
| Métrica | Límite |
|---|---|
| Mínimo diario por org | 4,000 créditos |
| Máximo diario | 25,000 créditos o 500 × nro de licencias |
| Créditos extra por licencia | +1,000 por usuario adicional |
| Ejemplo: 10 usuarios Enterprise | 50,000 + 10,000 = ~60,000 créditos/día |

- Cada API call = 1 crédito (operaciones simples).
- Bulk API consume créditos solo para el job, no por cada registro.

#### Bulk operations
- Bulk Write API: carga async hasta 25,000 registros por job.
- Ideal para import inicial.
- Requiere crear un job, subir CSV, esperar callback.
- Bulk Read: hasta 200,000 registros por job.

#### Pricing del API
- **Free (hasta 3 usuarios):** NO incluye API access. **Esto es bloqueante.**
- **Standard ($14/usuario/mes):** API access incluida con 4,000 créditos/día base.
- **Professional ($23/usuario/mes):** API access + más créditos.
- **Enterprise ($40/usuario/mes):** API access completa + Bulk API.
- Conclusión: El tenant debe tener al menos el plan Standard de Zoho para que la integración funcione.

#### Marketplace
- Zoho Marketplace: publicación disponible, audiencia de +1M de clientes Zoho (2026).
- Zoho reportó superar 1,000,000 de clientes en 2026.
- Idioma: Español nativo en toda la plataforma.

---

### 2.5 Monday.com CRM

#### Autenticación
- **OAuth 2.0** para apps públicas.
- API tokens personales para integraciones privadas.
- **GraphQL API** — no es REST. Todas las queries son POST a `https://api.monday.com/v2`.
- Authorization header: `Authorization: Bearer {token}`

#### Modelo de datos
Monday CRM es más flexible/menos opinionado que CRMs tradicionales:
| Concepto Parallly | Objeto Monday | Notas |
|---|---|---|
| Contact | Item (en board de Contacts) | No hay objeto "Contact" nativo, es un Item |
| Deal | Item (en board de Deals/CRM) | Columns definen campos |
| Pipeline Stage | Status column | Dropdown configurable |
| Note | Update (comment en item) | |
| Activity | Item o Update | No hay objeto Activity nativo |
| Custom attributes | Column (en board) | Cada board tiene sus propias columns |

**Problema:** El modelo flexible de Monday hace que cada cliente tenga una estructura diferente. El field mapping es más complejo que en CRMs tradicionales.

#### Webhooks salientes (Monday → Parallly)
- Monday soporta webhooks por eventos de board.
- Configuración via API: `POST /webhooks` o desde la UI de Automations.
- Eventos disponibles: `create_item`, `change_status_column_value`, `create_update`, etc.
- Funciona en todos los planes pagos.

#### Rate Limits
- Complexity-based: 10,000,000 de puntos de complejidad por minuto por cuenta.
- Burst limit: 5,000 requests por 10 segundos por IP.
- Para operaciones bulk, cada query tiene un "complexity" score que se puede consultar.

#### Pricing del API
- **Free:** API accesible pero limitada.
- **Basic ($9/usuario/mes):** API access completa.
- Conclusión: Monday CRM es viable técnicamente pero el modelo de datos no-estructurado hace costoso el mantenimiento del adapter. Prioridad media-baja.

---

## 3. Investigación por CRM — Tier 2

### 3.1 Kommo (antes amoCRM)

**Por qué es crítico para LatAm:** Kommo es uno de los CRMs más adoptados en México, Argentina, Colombia y Brasil para el segmento de ventas conversacionales. Su propuesta de valor central es la integración WhatsApp-first, lo que lo hace competidor directo de Parallly.

#### Autenticación
- **OAuth 2.0** con Authorization Code Flow.
- Tokens de larga duración disponibles para integraciones privadas.
- Cada cuenta Kommo tiene su propio subdominio: `{cuenta}.kommo.com`. El API base cambia por cliente: `https://{cuenta}.kommo.com/api/v4/`.

#### Modelo de datos
| Concepto Parallly | Objeto Kommo | Notas |
|---|---|---|
| Contact | contact | |
| Lead | lead | Concepto central en Kommo |
| Deal | lead (mismo objeto) | En Kommo, leads y deals son el mismo objeto |
| Pipeline | pipeline | Múltiples pipelines |
| Stage | status (dentro del lead) | |
| Note | note | |
| Activity | task | |
| Conversación | Chats API | API especial para mensajes |

#### Rate Limits
- **7 requests por segundo** por cuenta. Si se excede → HTTP 429.
- Bloqueo temporal en violaciones repetidas → HTTP 403.
- No hay límite diario documentado explícitamente, solo el de 7 req/s.
- Para sync de 10,000 contactos a 7 req/s: ~1,429 segundos (~24 minutos). Manejable.

#### Webhooks
- Soporte nativo de webhooks para eventos de contacto, lead, task.
- Configurables via API o via UI.

#### Relevancia
Kommo es **competidor directo** de Parallly en WhatsApp automation para LatAm. La integración tiene un componente estratégico interesante: muchos clientes usan Kommo solo como CRM pero no tienen su módulo de AI activo. Parallly puede actuar como la capa de AI/conversación y sincronizar con Kommo.

---

### 3.2 RD Station (Brasil + LatAm)

- **Dominante en Brasil** para marketing automation + CRM.
- API usa **OAuth 2.0**.
- Endpoints: `/api/v3/opportunities` (deals), `/api/v3/contacts`, `/api/v3/funnels`.
- Webhooks: hasta 10 por cuenta, trigger en conversión/oportunidad.
- Relevante especialmente si el tenant tiene operaciones en Brasil.
- Sin límite de rate documentado explícitamente; recomiendan backoff exponencial.
- **Plan mínimo con API:** RD Station Pro (~R$639/mes en Brasil).

---

### 3.3 Bitrix24

- Muy popular en hispanos por su **free tier robusto** (hasta usuarios ilimitados en cloud free).
- **API desde enero 2021 requiere plan pago**. Free plan ya no tiene API ni webhooks.
- Autenticación: OAuth 2.0 o webhooks entrantes estáticos.
- Endpoints: `crm.contact.add`, `crm.lead.add`, `crm.deal.add` (formato de llamada a método, no REST estándar).
- Rate limit: max 480 segundos de tiempo de ejecución por 10 minutos.
- Modelo de datos más complejo (Leads separados de Contacts/Deals).
- Webhooks salientes disponibles en planes pagos.
- Idioma: excelente soporte en español y ruso.

---

### 3.4 Freshsales (Freshworks)

- API usa **API Key** (más simple que OAuth pero menos seguro para multi-tenant).
- OAuth disponible para apps del marketplace.
- Rate limit: **1,000 requests/hora** por defecto. Aumentable por solicitud.
- Endpoints REST estándar: `/api/contacts`, `/api/deals`, `/api/sales_accounts`.
- Webhooks disponibles en todos los planes pagos.
- **Custom objects** disponibles en planes Enterprise.
- Idioma: inglés principalmente, soporte español limitado.
- Relevancia baja en LatAm versus los anteriores.

---

### 3.5 Close.com

- Orientado a inside sales, popular en startups B2B de LatAm que ya tienen presencia en EEUU.
- OAuth 2.0 y API keys.
- Modelo de datos: **Lead** es el contenedor central (empresa), contiene Contacts, Opportunities, Activities.
- Rate limits por endpoint group. Límites más altos que Freshsales (~200-1,000 req/10s dependiendo de endpoint).
- Webhooks nativos para todos los eventos del Event Log.
- Idioma: inglés. Sin soporte español nativo.
- Relevancia media para LatAm.

---

## 4. Tabla Comparativa Consolidada

| CRM | Auth | API Tier Mínimo | Rate Limit | Bulk API | Webhooks Salientes | LatAm Popularidad | Marketplace | ES Nativo |
|-----|------|-----------------|------------|----------|-------------------|------------------|-------------|-----------|
| **HubSpot** | OAuth 2.0 | Free (límites) | 100 req/10s | Batch 100 + Import CSV | Workflows (Pro+) / App Subs (todos) | ★★★★★ | Sí | Sí |
| **Salesforce** | OAuth 2.0 | Enterprise ($165/u/m) | 100K calls/día | Bulk API 2.0 | CDC, Platform Events, Outbound Msg | ★★★★ (enterprise) | Sí (AppExchange) | Sí |
| **Pipedrive** | OAuth 2.0 | Lite ($15/u/m) | TBRL (30K tokens/día base) | Batch 500 (V2) | Webhooks nativos | ★★★★ | Sí | Sí |
| **Zoho CRM** | OAuth 2.0 | Standard ($14/u/m) | 4K-60K créditos/día | Bulk Write 25K async | Workflow Rules | ★★★★ | Sí (Marketplace 1M) | Sí |
| **Monday CRM** | OAuth 2.0 | Basic ($9/u/m) | Complexity-based | GraphQL batch | Board Automations | ★★★ | Sí | Parcial |
| **Kommo** | OAuth 2.0 | Cualquier plan | 7 req/s | No nativo | Webhooks nativos | ★★★★★ (LatAm) | Sí | Sí |
| **RD Station** | OAuth 2.0 | Pro | No documentado | No | Webhooks (10/cuenta) | ★★★★ (Brasil) | Parcial | PT/ES |
| **Bitrix24** | OAuth 2.0 | Plan pago | 480s/10min | Batch manual | Webhooks salientes | ★★★★ | Sí | Sí |
| **Freshsales** | API Key / OAuth | Starter | 1K req/h | No | Webhooks | ★★ | Sí | No |
| **Close.com** | OAuth / API Key | Cualquier | Por endpoint | No | Event Log Webhooks | ★★ | Parcial | No |

---

## 5. Patrón de Integración Recomendado

### 5.1 Análisis de opciones

**Opción A: Sincronización unidireccional Parallly → CRM (push-only)**
- Parallly envía datos al CRM externo cuando ocurren eventos internos.
- No lee del CRM externo.
- Simplicidad alta. Riesgo de conflictos bajo.
- Desventaja: si el agente humano crea un deal en HubSpot, Parallly no lo sabe.

**Opción B: Sincronización bidireccional completa**
- Parallly escucha webhooks del CRM externo Y empuja cambios propios.
- Complejidad alta. Requiere conflict resolution.
- Ventaja: datos siempre frescos en ambos lados.

**Opción C: Bidireccional selectivo (recomendado para MVP)**
- Push siempre: Parallly → CRM (contactos nuevos, leads, actividades de conversación).
- Pull solo en onboarding inicial: CRM → Parallly (import masivo de contactos existentes).
- Pull incremental opcional: para enriquecer perfil cuando el agente lo solicita explícitamente.
- Webhooks del CRM → Parallly: solo para sincronizar cambios de stage/deal (evitar tener deals desactualizados en Parallly).

### 5.2 Patrón recomendado: Event-Driven + Onboarding Pull

```
[Evento interno Parallly]
       ↓ (EventEmitter)
[CrmSyncService]
       ↓ (BullMQ queue: crm-sync)
[CrmSyncProcessor]
       ↓
[ICrmAdapter.upsertContact() / createLead() / pushActivity()]
       ↓
[CRM Externo API]
```

```
[Onboarding: tenant conecta CRM]
       ↓
[CrmImportService.initiateImport()]
       ↓ (paginado, rate-limited, BullMQ)
[Pull masivo de contactos del CRM]
       ↓
[Merge con contacts de Parallly via IdentityService]
       ↓
[Progress UI via WebSocket]
```

```
[Webhook del CRM externo → POST /crm-sync/webhook/{tenantId}/{crmType}]
       ↓
[CrmWebhookController.handle()]
       ↓
[CrmSyncService.processExternalEvent()]
       ↓ (según tipo)
[Actualizar lead stage / enriquecer contacto / crear nota]
```

### 5.3 Justificación: ¿Por qué NO usar iPaaS embebido (Zapier/Make/n8n)?

- **Costo por tenant:** Zapier cobra por tarea, Make por operación. En volumen alto (cientos de tenants con miles de conversaciones) el costo se dispara.
- **Latencia:** Los iPaaS tienen latencia de 5-15 minutos en planes gratuitos/básicos. Para notificaciones de conversación en tiempo real, inaceptable.
- **Control:** No podemos ofrecer a nuestros tenants una experiencia integrada nativa si dependemos de Zapier.
- **Alternativa viable:** Nango o Ampersand como capa de gestión de OAuth tokens + SDK de sincronización. Reduce el código de infraestructura pero mantiene el control de la lógica.
- **Decisión:** Construir la capa de adaptadores propiamente, pero considerar Nango como gestor de tokens OAuth si el equipo es pequeño. Nango open-source es auto-hosteable.

### 5.4 Cola BullMQ dedicada para sync

Agregar una sexta queue: `crm-sync` con configuración:
- Concurrencia: 10 workers
- Rate limit: configurable por adapter (respeta los límites de cada CRM)
- Retries: 3 con exponential backoff
- Job types: `upsert-contact`, `create-lead`, `update-lead-stage`, `push-activity`, `pull-import-page`

---

## 6. Capa de Abstracción ICrmAdapter

### 6.1 Interfaz canónica

```typescript
// packages/shared/src/crm-adapter.interface.ts

export interface ICrmAdapter {
  readonly crmType: CrmType;
  
  // Auth lifecycle
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<CrmTokens>;
  refreshTokens(tokens: CrmTokens): Promise<CrmTokens>;
  validateConnection(tokens: CrmTokens): Promise<boolean>;
  
  // Contacts
  upsertContact(contact: CrmContact, tokens: CrmTokens): Promise<CrmExternalRef>;
  getContact(externalId: string, tokens: CrmTokens): Promise<CrmContact | null>;
  listContacts(cursor: string | null, tokens: CrmTokens): Promise<CrmContactPage>;
  
  // Leads / Deals
  createLead(lead: CrmLead, tokens: CrmTokens): Promise<CrmExternalRef>;
  updateLeadStage(externalId: string, stage: CrmStage, tokens: CrmTokens): Promise<void>;
  getLead(externalId: string, tokens: CrmTokens): Promise<CrmLead | null>;
  
  // Activities
  pushActivity(activity: CrmActivity, tokens: CrmTokens): Promise<CrmExternalRef>;
  
  // Schema introspection (para field mapping)
  listContactFields(tokens: CrmTokens): Promise<CrmField[]>;
  listLeadFields(tokens: CrmTokens): Promise<CrmField[]>;
  listPipelines(tokens: CrmTokens): Promise<CrmPipeline[]>;
  
  // Webhook management
  registerWebhook(url: string, events: CrmEvent[], tokens: CrmTokens): Promise<string>;
  unregisterWebhook(webhookId: string, tokens: CrmTokens): Promise<void>;
  parseWebhookPayload(payload: unknown, headers: Record<string, string>): CrmWebhookEvent;
}
```

### 6.2 Modelo canónico de datos (Parallly ↔ CRM)

```typescript
// Contacto canónico
export interface CrmContact {
  // Campos core (siempre mapeados)
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;            // Número de WhatsApp o teléfono principal
  company?: string;
  
  // Metadata Parallly
  paralllyContactId: string;  // UUID interno
  source: 'whatsapp' | 'instagram' | 'messenger' | 'telegram' | 'sms';
  firstSeenAt: Date;
  lastInteractionAt: Date;
  
  // Custom fields (extensión por tenant)
  customFields?: Record<string, string | number | boolean>;
}

// Lead / Deal canónico
export interface CrmLead {
  paralllyLeadId: string;
  contactRef: CrmExternalRef;  // Referencia al contacto en el CRM externo
  title: string;               // "Conversación WhatsApp — {nombre}"
  value?: number;
  currency?: string;
  pipelineId?: string;         // ID del pipeline en el CRM externo
  stageId?: string;            // ID del stage en el CRM externo
  paralllyStage: ParalllyLeadStage; // 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost'
  assignedToEmail?: string;
  createdAt: Date;
}

// Actividad canónica (conversación / nota / handoff)
export interface CrmActivity {
  type: 'conversation_summary' | 'note' | 'handoff' | 'appointment' | 'csat';
  contactRef: CrmExternalRef;
  leadRef?: CrmExternalRef;
  subject: string;
  body: string;                // Resumen o transcripción
  occurredAt: Date;
  channel: ChannelType;
  metadata?: Record<string, unknown>;
}

// Mapeo de stages Parallly → CRM (configurable por tenant)
export interface CrmStageMapping {
  paralllyStage: ParalllyLeadStage;
  externalPipelineId: string;
  externalStageId: string;
}

// Referencia cruzada para deduplicación
export interface CrmExternalRef {
  crmType: CrmType;
  externalId: string;
  externalUrl?: string;        // Link directo al registro en el CRM externo
}
```

### 6.3 Tabla de mapeo por CRM

| Campo Canónico | HubSpot | Pipedrive | Zoho CRM | Kommo | Salesforce |
|---|---|---|---|---|---|
| `firstName` | `firstname` | `first_name` | `First_Name` | `first_name` | `FirstName` |
| `lastName` | `lastname` | `last_name` | `Last_Name` | `last_name` | `LastName` |
| `email` | `email` | `email` (array) | `Email` | `custom_fields_values` | `Email` |
| `phone` | `phone` | `phone` (array) | `Phone` | `custom_fields_values` | `Phone` |
| `company` | `company` (property) | `org_id` | `Account_Name` | `company_name` | `AccountId` |
| Lead title | Deal `dealname` | Deal `title` | Deal `Deal_Name` | Lead `name` | Opportunity `Name` |
| Lead stage | Deal `dealstage` | Deal `stage_id` | Deal `Stage` | Lead `status_id` | Opp `StageName` |
| Note body | Note `hs_note_body` | Note `content` | Note `Note_Content` | Note `text` | Note `Body` |
| Activity timestamp | Engagement `hs_timestamp` | Activity `due_date` | Activity `Created_Time` | Note `created_at` | Task `ActivityDate` |

### 6.4 Implementaciones de adaptadores

```
apps/api/src/crm-integration/
  crm-integration.module.ts
  crm-integration.service.ts      # Orquestador principal
  crm-sync.processor.ts           # BullMQ processor (queue: crm-sync)
  crm-webhook.controller.ts       # POST /crm-sync/webhook/:tenantId/:crmType
  crm-import.service.ts           # Pull masivo en onboarding
  adapters/
    hubspot/
      hubspot.adapter.ts
      hubspot.field-mapper.ts
      hubspot.webhook-parser.ts
    pipedrive/
      pipedrive.adapter.ts
      pipedrive.field-mapper.ts
      pipedrive.webhook-parser.ts
    zoho/
      zoho.adapter.ts
      zoho.field-mapper.ts
      zoho.webhook-parser.ts
    kommo/
      kommo.adapter.ts
      kommo.field-mapper.ts
      kommo.webhook-parser.ts
    salesforce/
      salesforce.adapter.ts       # Fase 2
  entities/
    crm-connection.entity.ts      # Tabla: crm_connections (tenant schema)
    crm-contact-ref.entity.ts     # Tabla: crm_contact_refs
    crm_lead_ref.entity.ts        # Tabla: crm_lead_refs
    crm-sync-log.entity.ts        # Tabla: crm_sync_logs (auditoría)
    crm-field-mapping.entity.ts   # Tabla: crm_field_mappings (config por tenant)
```

### 6.5 Tablas de base de datos (tenant schema)

```sql
-- Conexión al CRM externo
CREATE TABLE crm_connections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_type    TEXT NOT NULL,           -- 'hubspot' | 'pipedrive' | 'zoho' | 'kommo' | 'salesforce'
  status      TEXT NOT NULL DEFAULT 'active',  -- active | error | paused
  access_token_enc  TEXT,             -- AES-256-GCM encrypted
  refresh_token_enc TEXT,             -- AES-256-GCM encrypted
  token_expires_at  TIMESTAMPTZ,
  external_account_id TEXT,           -- ID/portal de la cuenta en el CRM externo
  external_account_name TEXT,         -- Nombre del portal/cuenta
  webhook_id  TEXT,                   -- ID del webhook registrado en el CRM externo
  settings    JSONB DEFAULT '{}',     -- Configuración específica del adapter
  sync_enabled BOOLEAN DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Referencias cruzadas: contacto Parallly ↔ contacto CRM externo
CREATE TABLE crm_contact_refs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES crm_connections(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  external_url    TEXT,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, connection_id)
);

-- Referencias cruzadas: lead Parallly ↔ deal/lead CRM externo
CREATE TABLE crm_lead_refs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES crm_connections(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  external_url    TEXT,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id, connection_id)
);

-- Mapeo de campos (configurado por el tenant)
CREATE TABLE crm_field_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES crm_connections(id) ON DELETE CASCADE,
  object_type     TEXT NOT NULL,       -- 'contact' | 'lead' | 'activity'
  parallly_field  TEXT NOT NULL,       -- Campo canónico de Parallly
  external_field  TEXT NOT NULL,       -- Nombre de campo en el CRM externo
  direction       TEXT NOT NULL DEFAULT 'out',  -- 'out' | 'in' | 'both'
  transform       TEXT,                -- Expresión de transformación opcional
  UNIQUE(connection_id, object_type, parallly_field)
);

-- Log de sincronización (auditoría)
CREATE TABLE crm_sync_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES crm_connections(id),
  operation       TEXT NOT NULL,       -- 'upsert_contact' | 'create_lead' | etc.
  status          TEXT NOT NULL,       -- 'success' | 'error' | 'skipped'
  external_id     TEXT,
  error_message   TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Field Mapping UI

### 7.1 Filosofía

El field mapping manual completo (estilo Zapier) es poderoso pero genera fricción enorme en el onboarding. La mejor práctica observada en plataformas como Nango, Ampersand y el propio HubSpot es:

**Autodetección + override manual por campos custom.**

### 7.2 Flujo recomendado

**Paso 1: Conexión OAuth**
- Botón "Conectar HubSpot/Pipedrive/Zoho"
- OAuth popup → auth → callback → tokens guardados
- El sistema hace `listContactFields()` y `listLeadFields()` para descubrir el schema del CRM

**Paso 2: Mapping automático (sin intervención del usuario)**
El sistema intenta mapeo automático por nombre/tipo:
```
Parallly: firstName → HubSpot: firstname       ✓ Auto-matched
Parallly: lastName  → HubSpot: lastname        ✓ Auto-matched
Parallly: email     → HubSpot: email           ✓ Auto-matched
Parallly: phone     → HubSpot: phone           ✓ Auto-matched
Parallly: company   → HubSpot: company         ✓ Auto-matched
```

**Paso 3: UI de revisión (solo para unmapped y custom fields)**
Mostrar solo los campos que no se pudieron mapear automáticamente:
```
Parallly: customField("código_postal") → [ Seleccionar propiedad HubSpot... ▼ ]
Parallly: customField("segmento")      → [ Seleccionar propiedad HubSpot... ▼ ]
```

**Paso 4: Pipeline mapping**
```
Pipeline Parallly → [ Pipeline de HubSpot... ▼ ]
Stage "Nuevo"     → [ Stage HubSpot... ▼ ]
Stage "Calificado"→ [ Stage HubSpot... ▼ ]
Stage "Ganado"    → [ Stage HubSpot... ▼ ]
Stage "Perdido"   → [ Stage HubSpot... ▼ ]
```

**Paso 5: Configuración de sync**
```
[ ] Sincronizar contactos nuevos automáticamente
[ ] Sincronizar cambios de stage del lead
[ ] Enviar resumen de conversación como nota
[ ] Sincronizar citas agendadas como actividad
[ ] Importar contactos existentes del CRM (onboarding)
```

### 7.3 Decisiones de diseño clave

- **No mostrar todos los campos** del CRM externo al usuario. Solo los que Parallly conoce.
- **Permitir ignorar campos** que el tenant no quiere sincronizar.
- **Respetar tipos:** Si HubSpot tiene un campo numérico y Parallly tiene texto, mostrar advertencia.
- **Transformaciones básicas:** Permitir concatenar campos (`firstName + " " + lastName → fullName`).
- **Testing:** Botón "Probar mapping" que envía un contacto de prueba y muestra cómo quedaría en el CRM.

---

## 8. Conflict Resolution

### 8.1 El problema

Cuando un contacto existe en Parallly Y en el CRM externo y ambos se modifican independientemente antes de sincronizar, ¿quién gana?

### 8.2 Estrategia recomendada: Source-of-Truth por dominio de datos

Asignar "ownership" de cada tipo de dato a un sistema:

| Tipo de dato | Source of Truth | Razón |
|---|---|---|
| Datos de conversación (transcripciones, canal, mensajes) | **Parallly** siempre | Solo Parallly tiene esta data |
| Leads y actividades generadas por AI | **Parallly** siempre | El CRM externo no los genera |
| Datos de contacto enriquecidos (empresa, cargo, industria) | **CRM externo** tiene precedencia | El equipo de ventas los cuida ahí |
| Pipeline stage | Bidireccional con last-write-wins + timestamp | Ambos pueden cambiarlo |
| Notas y tareas manuales | Sistema donde se crearon | No se copian en sentido inverso |

### 8.3 Reglas de merge en upsertContact

1. Si el contacto no existe en el CRM externo → crear (no hay conflicto).
2. Si el contacto existe (match por email o phone):
   - Para campos core (nombre, empresa): si Parallly tiene el campo vacío y el CRM lo tiene → usar el del CRM.
   - Si ambos tienen valor diferente: **no sobreescribir**. Guardar en `crm_sync_logs` con status `skipped_conflict` y notificar opcionalmente al tenant.
3. Para stage de lead: comparar `updated_at`. El más reciente gana.

### 8.4 Conflict Queue (para resolución manual)

En casos ambiguos, los conflictos se encolan en una tabla `crm_sync_conflicts` con:
- Registro del conflicto (campo, valor Parallly, valor CRM externo, timestamps)
- UI en el dashboard: sección "Conflictos pendientes" en la configuración del CRM
- El tenant puede elegir qué valor mantener
- Tiempo de auto-resolución: 7 días (después de 7 días sin decisión, gana Parallly por defecto)

### 8.5 Deduplicación en import inicial

Al importar contactos del CRM externo:
- Match primario: `email` (normalizado a lowercase)
- Match secundario: `phone` (normalizado, sin espacios ni guiones)
- Match terciario: `firstName + lastName` (fuzzy, Levenshtein < 2)
- Si hay match → merge y crear `crm_contact_refs` de referencia cruzada
- Si no hay match → crear nuevo contacto en Parallly con `source: 'crm_import'`

---

## 9. Initial Import Flow

### 9.1 Cuándo ocurre

El import masivo se dispara una sola vez cuando el tenant conecta un CRM externo por primera vez. No es automático; el tenant debe confirmarlo explícitamente en el wizard de conexión.

### 9.2 Opciones que se ofrecen al tenant

```
¿Qué deseas importar de tu HubSpot?

○ Todos los contactos (recomendado)
○ Solo contactos con deals activos
○ Solo contactos creados en los últimos 90 días
○ No importar ahora (puedo hacerlo más tarde)

[ Estimar volumen ] → "Detectamos ~2,450 contactos en tu HubSpot"

[Iniciar importación]
```

### 9.3 Proceso técnico (paginado + rate-limited)

```
CrmImportService.initiateImport(tenantId, connectionId, importConfig):
  1. Crear job padre en crm_import_jobs (status: pending, total_pages: null)
  2. Encolar job: crm-sync queue, type: 'import-init', priority: low
  
CrmImportProcessor.handleInitPage(job):
  1. Llamar listContacts(cursor: null) → obtener primera página + total count
  2. Actualizar job con total_pages estimadas
  3. Encolar páginas restantes: 'import-page' jobs con cursor
  4. Emitir evento WebSocket al dashboard: crm.import.started { total, tenantId }

CrmImportProcessor.handleImportPage(job):
  1. Llamar listContacts(cursor: job.cursor)
  2. Para cada contacto:
     a. Intentar deduplicar via IdentityService
     b. Si existe: crear crm_contact_refs (link)
     c. Si no existe: crear contacto + crm_contact_refs
  3. Actualizar job: processed += page.length
  4. Emitir progreso via WebSocket: { processed, total, percentage }
  5. Encolar siguiente página si hay more: true
  
Completion:
  1. Actualizar job status: completed, completed_at: now()
  2. Emitir WebSocket: crm.import.completed { imported, merged, skipped }
  3. Notificación en dashboard: "Importación completada: 2,312 contactos importados, 138 fusionados"
```

### 9.4 Rate limiting durante import

Cada adapter implementa su propio throttle respeto:
- **HubSpot:** máximo 80 req/10s durante import (margen sobre límite de 100)
- **Pipedrive:** batch de 500 contactos por request, delay de 2s entre requests
- **Zoho:** usar Bulk Read API (no consume créditos individuales)
- **Kommo:** máximo 5 req/s durante import (margen sobre 7 req/s)

BullMQ `limiter` por queue y por adapter key:
```typescript
// Rate limit por adapter dentro del processor
const rateLimiter = new RateLimiter({
  max: ADAPTER_RATE_LIMITS[connection.crmType].requestsPerWindow,
  duration: ADAPTER_RATE_LIMITS[connection.crmType].windowMs,
});
```

### 9.5 Progress UI

La UI del dashboard muestra una progress card durante el import:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 67%
Importando contactos de HubSpot...
1,642 / 2,450 contactos procesados
138 fusionados con contactos existentes

[ Cancelar importación ]
```

El progreso se actualiza en tiempo real via el WebSocket del dashboard ya existente.

---

## 10. Almacenamiento de Secrets Multi-Tenant

### 10.1 Patrón existente a reutilizar

Parallly ya tiene `ChannelTokenService` que guarda access tokens de WhatsApp/IG/Messenger/Telegram encriptados con AES-256-GCM usando `ENCRYPTION_KEY`. Este patrón es exactamente lo que necesitamos.

### 10.2 Adaptación para CRM OAuth tokens

```typescript
// crm-token.service.ts (análogo a channel-token.service.ts)
@Injectable()
export class CrmTokenService {
  async saveTokens(connectionId: string, tokens: CrmTokens): Promise<void> {
    const encryptedAccess = this.encrypt(tokens.accessToken);
    const encryptedRefresh = this.encrypt(tokens.refreshToken);
    
    await this.prisma.$executeRawUnsafe(`
      UPDATE crm_connections 
      SET access_token_enc = $1, 
          refresh_token_enc = $2,
          token_expires_at = $3,
          updated_at = NOW()
      WHERE id = $4::uuid
    `, encryptedAccess, encryptedRefresh, tokens.expiresAt, connectionId);
  }
  
  async getTokens(connectionId: string): Promise<CrmTokens> {
    // Decrypt + return. Auto-refresh si expires_at < now() + 5min
  }
  
  async refreshIfNeeded(connectionId: string): Promise<CrmTokens> {
    const tokens = await this.getTokens(connectionId);
    if (tokens.expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
      const newTokens = await this.adapter.refreshTokens(tokens);
      await this.saveTokens(connectionId, newTokens);
      return newTokens;
    }
    return tokens;
  }
}
```

### 10.3 Cron de refresh proactivo

Agregar al cron schedule existente:
- `0 */4 * * *` — Revisar todos los `crm_connections` con `token_expires_at < NOW() + 1h` y refrescar proactivamente.
- Emitir alerta si el refresh falla (token revocado → el tenant debe reconectar).

### 10.4 Manejo de revocación

Cuando el tenant revoca el acceso desde su CRM (desinstala la app de HubSpot, por ejemplo):
- HubSpot envía un webhook de app.deauthorization.
- Kommo/Pipedrive notifican via webhook.
- `CrmWebhookController` captura el evento y marca la conexión como `status: revoked`.
- Se notifica al tenant via email y notificación en dashboard.

---

## 11. Plan Gating

### 11.1 Distribución recomendada

| Plan | CRM Connections | Import Masivo | Sync Bidireccional | Conflict Queue |
|---|---|---|---|---|
| **Starter** | 0 (no disponible) | — | — | — |
| **Pro** | 1 CRM | Sí (hasta 5K contactos) | Unidireccional (Parallly→CRM) | No |
| **Enterprise** | Hasta 3 CRMs | Sí (ilimitado) | Bidireccional completo | Sí |
| **Custom** | Ilimitados | Sí (ilimitado) | Bidireccional + API propia | Sí |

### 11.2 Justificación

- **Starter sin CRM:** Los clientes starter son negocios pequeños que probablemente no tienen CRM externo. Si lo tienen, es un catalizador para upgradear a Pro.
- **Pro con 1 CRM:** El 80% de los tenants Pro tendrán máximo un CRM. Esta limitación incentiva el upgrade a Enterprise.
- **Enterprise con 3 CRMs:** Empresas medianas que pueden tener HubSpot para marketing + Salesforce para enterprise sales + Zoho para soporte.
- **Sync unidireccional en Pro:** Reduce la complejidad de conflict resolution para el plan base. La mayoría de PYMEs solo necesitan que Parallly envíe datos al CRM, no al revés.

### 11.3 Implementación en código

```typescript
// En throttle/tenant-throttle.service.ts (extender PLAN_FEATURES)
export const PLAN_FEATURES = {
  starter: {
    // ...existente
    crm_connections: 0,
    crm_import_max_contacts: 0,
    crm_bidirectional: false,
  },
  pro: {
    // ...existente
    crm_connections: 1,
    crm_import_max_contacts: 5000,
    crm_bidirectional: false,
  },
  enterprise: {
    // ...existente
    crm_connections: 3,
    crm_import_max_contacts: -1, // ilimitado
    crm_bidirectional: true,
  },
  custom: {
    // ...existente
    crm_connections: -1, // ilimitado
    crm_import_max_contacts: -1,
    crm_bidirectional: true,
  },
};
```

### 11.4 UI de plan gating

En la página de Settings → Integrations CRM:
- Si el tenant es Starter: mostrar la card de integración CRM con badge "Pro" y CTA de upgrade.
- Si es Pro y ya tiene 1 CRM conectado: botón "Agregar CRM" deshabilitado con tooltip "Upgrade a Enterprise para conectar múltiples CRMs".

---

## 12. Roadmap de Implementación

### Fase 1 — MVP: HubSpot + Pipedrive (Semanas 1-6)

**¿Por qué estos dos?**

| Criterio | HubSpot | Pipedrive |
|---|---|---|
| Facilidad técnica | Alta (OAuth simple, REST, batch, docs excelentes) | Alta (OAuth simple, V2 bien documentada) |
| Tamaño de mercado LatAm | #1 PYMEs (free tier los atrae) | #2-3 PYMEs (fuerte en México/Argentina/Colombia) |
| Desbloqueador de ventas | "Ya tengo HubSpot" es la objeción #1 | "Usamos Pipedrive" es la objeción #3 |
| Webhooks bidireccionales | Viables (App Webhook Subscriptions) | Excelentes (40 webhooks nativos) |
| Bulk API | Sí (batch 100 + Import CSV) | Sí (batch 500 en V2) |

**Hitos Fase 1:**
1. Módulo `crm-integration` base + `ICrmAdapter` interface
2. Tablas de base de datos (`crm_connections`, `crm_contact_refs`, `crm_lead_refs`, `crm_field_mappings`, `crm_sync_logs`)
3. `HubSpotAdapter` completo (upsertContact, createLead, updateLeadStage, pushActivity, listContactFields, listPipelines, webhooks)
4. `PipedriveAdapter` completo (ídem)
5. `CrmSyncProcessor` con BullMQ queue `crm-sync`
6. `CrmWebhookController` para recibir webhooks de HubSpot y Pipedrive
7. `CrmImportService` para onboarding pull
8. `CrmTokenService` con refresh automático
9. Dashboard UI: página Settings → Integrations → CRM
   - Lista de integraciones disponibles
   - Wizard de conexión OAuth (HubSpot y Pipedrive)
   - Field mapping UI (auto + override manual)
   - Pipeline/stage mapping
   - Toggle para cada tipo de sync
   - Progress UI para import inicial
10. i18n: todas las strings en es/en/pt/fr

**Eventos de Parallly que disparan sync (Fase 1):**
- `contact.created` → `upsertContact` en el CRM
- `lead.created` → `createLead` en el CRM  
- `lead.stage_changed` → `updateLeadStage` en el CRM
- `conversation.handoff` → `pushActivity` (tipo: handoff) en el CRM
- `appointment.created` → `pushActivity` (tipo: appointment) en el CRM
- `csat.submitted` → `pushActivity` (tipo: csat con score) en el CRM
- `message.received` (batch diario) → Resumen diario de conversación como nota en el CRM

### Fase 2 — Zoho + Kommo (Semanas 7-12)

**¿Por qué en esta fase?**

- **Zoho:** Alta demanda en LatAm (1M+ clientes en 2026). Complejidad media por el sistema de créditos y datacenter variable. Requiere manejo especial del endpoint base por región.
- **Kommo:** Competidor directo. La integración tiene valor estratégico especial: muchos leads le dirán "uso Kommo para CRM pero quiero usar Parallly para la AI". Esto convierte una situación competitiva en una integrativa.

**Hitos Fase 2:**
1. `ZohoCRMAdapter` con soporte de Bulk API para import
2. `KommoAdapter` con Chats API para sync de conversaciones
3. Conflict Queue UI en dashboard
4. Sync bidireccional completo (para planes Enterprise)
5. Zoho Marketplace listing
6. Kommo Marketplace listing

### Fase 3 — Salesforce + Monday (Semanas 13-20)

**Salesforce:** Alta complejidad (Connected Apps, Bulk API 2.0, CDC), solo relevante para clientes enterprise. Requiere Salesforce AppExchange Security Review (~4-6 semanas).

**Monday.com:** El modelo de datos no-estructurado requiere un adapter más flexible. El impacto de mercado es menor que los anteriores.

**Hitos Fase 3:**
1. `SalesforceAdapter` con Bulk API 2.0 y Change Data Capture
2. AppExchange Security Review
3. `MondayAdapter` con GraphQL client
4. Bitrix24 y Freshsales como adaptadores adicionales (si hay demanda)
5. API Pública de CRM Sync para tenants enterprise que quieran una integración personalizada

---

## 13. Fallback Nativo

Si el tenant NO conecta un CRM externo, el CRM interno de Parallly funciona exactamente igual que hoy:

- Módulo `crm` propio: contacts, leads, opportunities, pipeline, notes, tasks, activities, segments, custom_attributes, import/export CSV.
- La integración con CRM externo es **100% opcional y aditiva**.
- Los tenants que sí conectan un CRM externo siguen teniendo el CRM interno disponible como vista secundaria.
- Los datos primarios siguen viviendo en el schema de Parallly. El CRM externo es un destino de sync, no la fuente de verdad primaria.

**Propuesta de valor diferenciada:**
- Sin CRM externo: "Parallly ES tu CRM + AI conversacional + canal de mensajería"
- Con CRM externo: "Parallly es la capa de AI/mensajería que potencia tu CRM existente"

Esto posiciona a Parallly como complementario en lugar de competidor para clientes que ya tienen inversión en HubSpot/Salesforce/Pipedrive.

---

## 14. Diferenciadores sobre Competidores

### 14.1 Versus Kommo
- Kommo tiene WhatsApp nativo PERO su AI es básica y orientada a automatizaciones simples (SalesBot).
- Parallly puede integrarse CON Kommo: la AI multi-agente de Parallly trabaja sobre WhatsApp y sincroniza leads/actividades en Kommo. Mejor de ambos mundos.
- Parallly soporta IG, Messenger, Telegram, SMS además de WhatsApp. Kommo tiene soporte parcial.

### 14.2 Versus Manychat
- Manychat no tiene CRM propio; depende 100% de integraciones externas.
- Parallly tiene CRM interno + sincronización con externos. Si el cliente no tiene CRM, no necesita Manychat + HubSpot. Parallly es todo en uno.
- La integración nativa de Parallly con CRMs es más profunda que la de Manychat (que solo usa Zapier/Make como intermediario).

### 14.3 Versus Wati / 360dialog
- Wati/360dialog son proveedores de acceso a WhatsApp API, no CRMs ni AI verdaderos.
- Su integración con CRMs es superficial (webhooks básicos via Zapier).
- Parallly tiene la capa de AI con RAG, prompt engineering, booking engine, y sincronización nativa con CRM.

### 14.4 Diferenciadores clave en la integración CRM

1. **Conversational context as CRM activity:** Parallly puede enviar al CRM un resumen estructurado de la conversación de WhatsApp, incluyendo: intención detectada, servicios consultados, objeciones, sentimiento del cliente. Ningún competidor hace esto con la profundidad del prompt architecture L1/L2/L3 de Parallly.

2. **Booking → CRM:** Cuando el booking engine agenda una cita, Parallly crea automáticamente la actividad en el CRM externo con todos los detalles. Esto cierra el loop entre WhatsApp → Calendario → CRM.

3. **CSAT → CRM score:** Los resultados de CSAT (1-5) se sincronizan como propiedades del contacto en el CRM externo. Los gerentes de ventas pueden ver en HubSpot qué clientes están insatisfechos.

4. **Lead scoring bidireccional:** El score calculado por Parallly (basado en engagement en conversaciones) puede enriquece el lead score del CRM externo. Los CRMs tienen lead scoring pero no tienen datos de conversaciones de WhatsApp.

5. **Sin latencia de iPaaS:** La sync ocurre via BullMQ queue con workers propios, no Zapier con delays de 5-15 minutos. Para un negocio que vende por WhatsApp, que el lead aparezca en HubSpot en segundos (no en 15 minutos) es diferencial.

6. **Multi-canal unificado:** Un solo contacto en el CRM externo recibe actividades de todos los canales (WhatsApp + IG + Telegram). Otros competidores solo integran WhatsApp.

---

## 15. Riesgos Técnicos

### 15.1 Riesgos principales

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Rate limit en import inicial masivo** | Alta (si cliente tiene >50K contactos) | Medio | Bulk API + cola con rate limiter + UI de progreso + opción de importar por segmento |
| **Token revocado en CRM externo** | Media | Alto (sync silenciosamente falla) | Monitoreo de errores 401, alertas al tenant, email de reconexión |
| **Cambios de schema en CRM externo** | Media | Medio | Versionado de adapters, smoke tests periódicos, alertas en errores de mapping |
| **Deduplicación incorrecta** | Alta (teléfonos en formato inconsistente) | Alto (datos duplicados o perdidos) | Normalización de phone (e.164), soft-match con confirmación del usuario |
| **Pipedrive API V1 deprecation julio 2026** | Certeza | Alto si ya empezamos con V1 | Construir directamente sobre V2 desde el inicio |
| **Salesforce Connected App approval** | Media | Bajo (solo afecta Fase 3) | Comenzar proceso de security review en paralelo con desarrollo |
| **Zoho datacenter por región** | Baja-Media | Medio | Detectar datacenter en OAuth callback, ajustar base URL por tenant |
| **Webhooks del CRM desconectados** | Media | Medio | Polling de fallback cada 15 min para cambios críticos (stage de deal) |
| **Conflictos de datos masivos en onboarding** | Media | Medio | Modo "merge preview" antes de confirmar import + conflict queue |
| **Seguridad: tokens robados** | Baja | Alto | Reuse del patrón AES-256-GCM de `channel-token.service.ts` + rotación periódica |

### 15.2 El mayor riesgo técnico

**El mayor riesgo es la deduplicación incorrecta durante el import inicial.** 

Si Parallly ya tiene 200 contactos y el CRM externo tiene 2,000, y el algoritmo de deduplicación falla (por ejemplo, teléfonos en formato `+52 55 1234-5678` vs `5215512345678`), el resultado puede ser:
- Duplicados masivos en ambos sistemas
- Pérdida de historial de conversaciones (asociadas a un contact_id que no matcheó)
- Datos incorrectos en el CRM del cliente

**Mitigación:** 
1. Normalización agresiva de teléfonos (libphone number para parsear e.164).
2. Matching por email como paso primario (más confiable).
3. Modo "preview" antes de confirmar el import: mostrar "Encontramos 138 posibles duplicados. ¿Confirmar fusión?"
4. Log completo de todas las decisiones de merge para auditoría.
5. Opción de deshacer el import en las primeras 24h.

---

## Apéndice A: Variables de entorno requeridas (a agregar)

```bash
# HubSpot OAuth App
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=

# Pipedrive OAuth App
PIPEDRIVE_CLIENT_ID=
PIPEDRIVE_CLIENT_SECRET=

# Zoho CRM OAuth
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=

# Kommo OAuth
KOMMO_CLIENT_ID=
KOMMO_CLIENT_SECRET=

# Salesforce Connected App (Fase 3)
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=

# CRM Webhook validation secrets (por CRM)
HUBSPOT_WEBHOOK_SECRET=
PIPEDRIVE_WEBHOOK_SECRET=
```

Estas variables deben agregarse al `deploy.yml` de GitHub Actions para no perderse en el próximo deploy (ver nota crítica en CLAUDE.md).

---

## Apéndice B: Endpoints nuevos en la API

```
POST   /api/v1/crm-integration/:tenantId/connect/:crmType       — Iniciar OAuth flow
GET    /api/v1/crm-integration/:tenantId/callback/:crmType       — OAuth callback
GET    /api/v1/crm-integration/:tenantId/connections             — Listar conexiones
DELETE /api/v1/crm-integration/:tenantId/connections/:connId     — Desconectar CRM
GET    /api/v1/crm-integration/:tenantId/connections/:connId/fields — Campos del CRM
GET    /api/v1/crm-integration/:tenantId/connections/:connId/pipelines — Pipelines
PUT    /api/v1/crm-integration/:tenantId/connections/:connId/mappings — Guardar field mapping
POST   /api/v1/crm-integration/:tenantId/connections/:connId/import  — Iniciar import
GET    /api/v1/crm-integration/:tenantId/connections/:connId/import/status — Status import
POST   /api/v1/crm-sync/webhook/:tenantId/:crmType               — Recibir webhooks del CRM (público, HMAC auth)
GET    /api/v1/crm-integration/:tenantId/sync-logs               — Auditoría de syncs
GET    /api/v1/crm-integration/:tenantId/conflicts               — Cola de conflictos pendientes
PUT    /api/v1/crm-integration/:tenantId/conflicts/:conflictId   — Resolver conflicto
```

---

*Documento preparado: Abril 2026. Basado en documentación oficial de HubSpot API 2026-03, Pipedrive API V2, Zoho CRM V8, Salesforce REST API v60, Kommo API V4, Monday Platform API, RD Station API, Bitrix24 REST API, Freshsales API, Close.com API.*
