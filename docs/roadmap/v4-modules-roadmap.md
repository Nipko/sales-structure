> **ROADMAP** — Especificaciones de módulos v4. No todos están implementados aún.
> Estado de progreso en [backlog.md](backlog.md).

# Parallly V4 — Guía de Implementación de Módulos Complementarios

> Propósito: complementar la guía previa enfocada en **CRM + WhatsApp Platform Manager** y detallar los demás módulos del producto para que un agente de código pueda empezar a implementarlos sin ambigüedad.
>
> En esta versión se profundiza especialmente el módulo **Intake / Landing**, porque debe construirse como módulo desacoplado del core y servir únicamente como punto de entrada al flujo comercial.

---

# 1. Alcance de este documento

Este documento cubre los módulos no desarrollados en profundidad en la guía centrada en CRM/WhatsApp:

1. **Intake / Landing Module**
2. **Campaigns & Courses Module**
3. **Carla AI Sales Agent Module**
4. **Knowledge Base / RAG Module**
5. **Workflow & Automation Module**
6. **Analytics & Reporting Module**
7. **Compliance & Audit Module**
8. **Identity / Access / Tenant Module**
9. **Shared Platform / Design / Infrastructure Considerations**

No reemplaza la guía de CRM/WhatsApp. La complementa.

---

# 2. Principios de arquitectura para estos módulos

## 2.1 Principio de desacoplamiento

Parallly debe dividirse en dos grandes zonas funcionales:

### A. Módulos de entrada
Captan o importan leads.

Ejemplos:
- Intake / Landing
- Importación CSV
- API externa
- Meta Lead Ads
- Formularios embebidos

### B. Módulos core
Procesan y convierten el lead.

Ejemplos:
- CRM
- Inbox
- WhatsApp
- IA
- Automation
- Analytics
- Compliance

**Regla:** ningún módulo de entrada debe contener lógica comercial profunda. Solo dispara eventos y crea/actualiza entidades base.

---

## 2.2 Principio de eventos de dominio

Todos estos módulos deben hablarse entre sí por eventos internos claros.

Eventos mínimos recomendados:
- `LeadCaptured`
- `LeadUpdated`
- `OpportunityCreated`
- `ConversationStarted`
- `InboundMessageReceived`
- `IntentClassified`
- `LeadScoreUpdated`
- `OpportunityStageChanged`
- `HandoffRequested`
- `TaskCreated`
- `ConsentRecorded`
- `OptOutDetected`
- `CampaignPerformanceUpdated`
- `KnowledgeResourceApproved`
- `AutomationRuleTriggered`

---

## 2.3 Principio de reemplazabilidad

Cada módulo debe poder evolucionar o reemplazarse sin romper el producto.

Ejemplos:
- cambiar el Intake sin romper CRM
- cambiar proveedor LLM sin romper Carla
- cambiar proveedor de email sin romper secuencias
- agregar otro canal sin romper Inbox

---

# 3. Módulo 1 — Intake / Landing

## 3.1 Propósito

Este módulo existe para:
- mostrar una landing o formulario
- capturar datos del lead
- guardar consentimiento y UTMs
- crear o actualizar lead/oportunidad
- disparar el inicio del flujo

**No debe convertirse en el centro del sistema.**

---

## 3.2 Objetivo funcional

Permitir que un tenant publique una página de captura simple o clonada, orientada a un curso/campaña, que al enviar el formulario:

1. valide campos,
2. registre consentimiento,
3. capture metadatos,
4. cree o actualice lead,
5. cree oportunidad,
6. emita `LeadCaptured`,
7. deje listo el flujo de WhatsApp/email.

---

## 3.3 Submódulos del Intake

### 3.3.1 Landing Pages
Responsable de:
- páginas públicas de captura
- variantes por campaña
- branding del tenant
- bloques de contenido estáticos
- CTA de formulario

### 3.3.2 Forms
Responsable de:
- definición del formulario
- validaciones
- mapeo de campos
- consentimiento
- submit handler

### 3.3.3 Intake Events
Responsable de:
- transformar submit en evento de dominio
- registrar trazabilidad
- publicar `LeadCaptured`

### 3.3.4 Tracking Capture
Responsable de:
- UTMs
- referrer
- source URL
- user agent
- IP
- device heurístico

---

## 3.4 Entidades del módulo

### LandingPage
- id
- tenant_id
- campaign_id
- course_id
- slug
- title
- subtitle
- hero_json
- sections_json
- status
- published_at
- created_at
- updated_at

### FormDefinition
- id
- tenant_id
- landing_page_id
- name
- version
- fields_json
- consent_text_version
- active
- created_at

### FormSubmission
- id
- tenant_id
- landing_page_id
- form_definition_id
- campaign_id
- course_id
- raw_payload_json
- normalized_payload_json
- source_url
- referrer
- utm_json
- ip_address
- user_agent
- created_at

### IntakeSource
- id
- tenant_id
- type
- name
- config_json
- active

---

## 3.5 Campos base del formulario

Versión inicial sugerida:
- first_name
- last_name
- company
- position
- email
- phone
- preferred_contact
- study_month
- interested_course
- consent_checkbox

Campos técnicos invisibles:
- landing_slug
- campaign_id
- course_id
- utm_source
- utm_medium
- utm_campaign
- utm_term
- utm_content
- referrer
- page_url
- user_agent

---

## 3.6 Reglas del Intake

### Regla 1 — Validación
Debe validar en frontend y backend.

### Regla 2 — Consentimiento obligatorio
No se puede procesar sin consentimiento simple.

### Regla 3 — Idempotencia razonable
Si la misma persona envía varias veces, no crear leads duplicados ciegamente.

### Regla 4 — Desacoplamiento
El submit no llama directamente a WhatsApp. Debe publicar evento o job.

### Regla 5 — Trazabilidad completa
Guardar payload original y payload normalizado.

---

## 3.7 APIs mínimas del módulo

### Públicas
- `GET /public/landing/:slug`
- `POST /public/forms/:formId/submit`

### Internas
- `POST /internal/intake/normalize`
- `POST /internal/intake/publish-event`

---

## 3.8 Flujo de implementación

1. render landing por slug
2. resolver campaign + course + branding
3. render formulario configurado
4. usuario envía
5. validar payload
6. persistir submission
7. registrar consentimiento
8. upsert lead
9. crear/update opportunity
10. publicar `LeadCaptured`
11. responder success al frontend

---

## 3.9 UI mínima

### Vista pública
- hero
- beneficios
- info del curso
- FAQs
- formulario fijo
- mensaje de envío exitoso

### Vista interna de administración
- listado de landings
- editar metadata básica
- vincular campaña
- vincular curso
- ver submissions
- duplicar landing

---

## 3.10 Criterios de aceptación

- una landing puede publicarse por tenant
- el submit crea o actualiza lead correctamente
- se crea oportunidad con campaña/curso correctos
- se guarda consentimiento
- se emite evento de inicio del flujo
- queda trazabilidad de UTMs y fuente

---

# 4. Módulo 2 — Campaigns & Courses

## 4.1 Propósito

Este módulo define la estructura comercial que alimenta a CRM, Intake, WhatsApp y Carla.

Debe resolver:
- catálogo de cursos
- campañas
- reglas comerciales por campaña
- mapeo de templates
- métricas por campaña

---

## 4.2 Submódulos

### Courses Catalog
- fichas de curso
- precios
- modalidad
- duración
- brochure
- políticas
- FAQs
- estado activo/inactivo

### Campaigns
- campañas de captación
- curso primario asociado
- ventanas horarias
- reglas de automatización
- fuentes de entrada

### Course Commercial Assets
- brochure
- recursos de venta
- FAQs comerciales
- variables de template

---

## 4.3 Entidades

### Course
- id
- tenant_id
- code
- name
- description
- modality
- duration
- price
- currency
- brochure_url
- faq_version
- policy_version
- active

### Campaign
- id
- tenant_id
- name
- code
- primary_course_id
- source_type
- active
- schedule_json
- default_owner_rule
- automation_profile_id
- created_at

### CampaignCourse
- campaign_id
- course_id
- is_primary

### CommercialOffer
- id
- tenant_id
- course_id
- campaign_id nullable
- offer_type
- title
- conditions_json
- valid_from
- valid_to
- active

---

## 4.4 Funciones clave

- crear curso
- editar precio
- activar/desactivar curso
- asociar brochure
- gestionar FAQs
- crear campaña
- asociar cursos a campaña
- mapear template WhatsApp/email por campaña
- definir reglas por horario
- definir owner default

---

## 4.5 Vistas UI

### Cursos
- listado
- ficha detalle
- recursos asociados
- FAQs
- historial de cambios

### Campañas
- listado
- estado
- curso principal
- canales asociados
- landing asociada
- templates asociados
- métricas rápidas

---

## 4.6 Criterios de aceptación

- se puede crear campaña con curso principal
- una campaña puede tener varios cursos asociados
- se pueden asociar templates por canal
- CRM e Intake consumen datos correctos del catálogo

---

# 5. Módulo 3 — Carla AI Sales Agent

## 5.1 Propósito

Carla es el agente comercial automatizado de Parallly.

Debe:
- responder
- nutrir
- calificar
- detectar intención
- scorear
- preparar cierre
- escalar a humano con sutileza

No debe:
- cerrar con pago directo si la política no lo permite
- improvisar información fuera de base documental
- violar reglas del tenant

---

## 5.2 Submódulos

### Prompt & Persona Manager
- prompt base
- tono
- objetivos
- reglas comerciales
- disclaimers internos

### Intent Classifier
- intención principal
- intención secundaria
- confidence

### Sales Reasoning Layer
- interpretación del momento comercial
- señales de compra
- detección de VIP/grupo

### Lead Scoring Layer
- score híbrido 1–10
- reglas + IA

### Handoff Layer
- decide cuándo y cómo pasar al humano

### Conversation Summary Layer
- resume contexto para agente humano

---

## 5.3 Entradas de Carla

Carla debe recibir como contexto:
- tenant
- campaña
- curso
- lead profile
- company data si existe
- stage actual
- score actual
- histórico resumido
- mensajes recientes
- recursos RAG relevantes
- reglas comerciales
- restricciones del canal

---

## 5.4 Salidas de Carla

- `reply_text`
- `intent_primary`
- `intent_secondary`
- `score_delta`
- `should_handoff`
- `handoff_reason`
- `summary_for_agent`
- `tags_to_apply`
- `suggested_stage`

---

## 5.5 Casos de uso obligatorios

1. primer contacto tras template
2. respuesta a dudas de precio
3. respuesta a fecha de inicio
4. respuesta a medios de pago
5. lead de grupo
6. lead interesado en varios cursos
7. lead sin respuesta tras follow-up
8. handoff por alta intención

---

## 5.6 Servicios backend

### CarlaConversationService
- genera respuestas
- construye contexto
- registra output

### CarlaIntentService
- clasifica intención

### CarlaScoringService
- combina reglas + output IA

### CarlaHandoffService
- determina transición a humano

### CarlaSummaryService
- resume oportunidad y conversación

---

## 5.7 Reglas principales

- score 7 = caliente
- score 9 = listo para cierre
- grupo = VIP
- varios cursos = VIP potencial
- si pide pago o confirma datos = revisar handoff
- Carla puede dar precio
- Carla no envía link de pago
- descuentos solo si política de grupo lo permite

---

## 5.8 UI de configuración

- prompt base
- tono
- objetivos por campaña
- reglas comerciales configurables
- activación/desactivación por tenant/campaña
- versionado y aprobación
- pruebas de mensaje

---

## 5.9 Criterios de aceptación

- Carla responde con contexto correcto
- clasifica intención
- actualiza score
- puede disparar handoff
- genera resumen útil para humano
- respeta reglas configuradas

---

# 6. Módulo 4 — Knowledge Base / RAG

## 6.1 Propósito

Dar a Carla y al sistema una base documental confiable y versionada.

Fuentes iniciales:
- fichas de curso
- FAQs
- brochure
- políticas
- contenido comercial
- textos manuales

---

## 6.2 Submódulos

### Resource Ingestion
- subir PDF
- subir DOC/TXT convertido
- pegar texto manual
- registrar URL fuente

### Chunking & Embeddings
- particionado
- embeddings
- indexación en pgvector

### Retrieval
- búsqueda contextual
- filtros por tenant/curso/campaña/tipo

### Approval & Versioning
- recurso borrador
- recurso aprobado
- versión activa

---

## 6.3 Entidades

### KnowledgeResource
- id
- tenant_id
- type
- title
- source
- source_url
- content_hash
- version
- status
- created_at

### KnowledgeChunk
- id
- resource_id
- chunk_index
- content
- embedding
- metadata_json

### KnowledgeApproval
- id
- resource_id
- approved_by
- approved_at
- notes

---

## 6.4 Flujo de implementación

1. usuario sube recurso
2. se parsea
3. se guarda texto canónico
4. se parte en chunks
5. se generan embeddings
6. se indexa
7. queda en borrador/aprobado
8. Carla solo consume recursos aprobados

---

## 6.5 UI mínima

- listado de recursos
- subir recurso
- ver texto extraído
- aprobar/rechazar
- versionado
- filtros por curso/campaña/tipo

---

## 6.6 Criterios de aceptación

- se puede subir recurso y aprobarlo
- Carla solo usa recursos aprobados
- retrieval responde por tenant y curso correctos

---

# 7. Módulo 5 — Workflow & Automation

## 7.1 Propósito

Ejecutar automatizaciones configurables sobre eventos del sistema.

Ejemplos:
- enviar template tras LeadCaptured
- esperar X minutos antes de contacto
- fallback a email
- crear tarea por handoff
- mover etapa por score
- follow-up si no responde

---

## 7.2 Submódulos

### Trigger Engine
Escucha eventos de dominio.

### Rules Engine
Evalúa condiciones.

### Action Executor
Ejecuta acciones.

### Job Scheduler
Espera, reintentos y ventanas horarias.

---

## 7.3 Entidades

### AutomationRule
- id
- tenant_id
- name
- trigger_type
- conditions_json
- actions_json
- active

### AutomationExecution
- id
- rule_id
- entity_type
- entity_id
- status
- started_at
- finished_at
- result_json

### WaitJob
- id
- tenant_id
- type
- run_at
- payload_json
- status

---

## 7.4 Acciones mínimas

- enviar WhatsApp template
- enviar email
- crear tarea
- actualizar stage
- aplicar tag
- asignar owner
- notificar al agente
- pedir handoff

---

## 7.5 Reglas mínimas iniciales

1. lead capturado → enviar template
2. si falla WhatsApp → fallback email
3. si score >= 9 → handoff + tarea
4. si grupo detectado → tag VIP + owner prioritario
5. si no responde en ventana definida → follow-up configurable

---

## 7.6 UI mínima

- listado de reglas
- activar/desactivar
- editar waits
- ver ejecuciones
- ver errores

---

## 7.7 Criterios de aceptación

- reglas se disparan por evento
- waits funcionan
- acciones quedan auditadas
- errores quedan visibles

---

# 8. Módulo 6 — Analytics & Reporting

## 8.1 Propósito

Dar visibilidad ejecutiva y operativa.

Debe cubrir:
- rendimiento comercial
- rendimiento de campañas
- rendimiento del canal
- rendimiento de Carla
- productividad operativa

---

## 8.2 Submódulos

### Executive Dashboard
- leads
- oportunidades
- conversiones
- cierre
- forecast

### Operations Dashboard
- conversaciones activas
- handoffs pendientes
- tareas
- SLA
- errores de canal

### Campaign Analytics
- volumen por campaña
- respuesta
- conversión
- costo estimado

### AI Analytics
- intenciones
- score distribution
- handoff rate
- intervención humana

---

## 8.3 Métricas mínimas

- leads captados
- leads respondidos
- leads calificados
- calientes
- listos para cierre
- ganados
- perdidos
- tasa de respuesta
- tiempo a primera respuesta
- tiempo a handoff
- mensajes promedio por conversación
- score promedio
- top intenciones
- leads por campaña
- leads por curso

---

## 8.4 Entidades recomendadas

Si no se hace warehouse aparte al inicio:
- vistas materializadas
- tablas agregadas por día/campaña/curso/owner/canal

### DailyMetrics
- tenant_id
- metric_date
- dimension_type
- dimension_id
- metrics_json

---

## 8.5 UI mínima

- dashboard ejecutivo
- dashboard operativo
- campaign dashboard
- exportación CSV

---

## 8.6 Criterios de aceptación

- dashboards muestran datos reales
- filtros por fecha/campaña/curso/owner
- exportación básica disponible

---

# 9. Módulo 7 — Compliance & Audit

## 9.1 Propósito

Cubrir trazabilidad comercial, consentimiento, opt-out, supresión y auditoría operativa.

---

## 9.2 Submódulos

### Consent Management
- versionado de texto legal
- registro de aceptación
- canal
- timestamp
- IP

### Opt-Out Management
- bloqueo de marketing por canal
- detección automática por palabras clave
- supresión operativa

### Data Deletion / Suppression
- solicitud de borrado
- procesamiento controlado
- conservación mínima necesaria

### Audit Trail
- cambios críticos del sistema
- quién hizo qué
- cuándo

---

## 9.3 Entidades

### LegalTextVersion
- id
- tenant_id
- channel
- version
- text
- active
- created_at

### ConsentRecord
- id
- tenant_id
- lead_id
- channel
- legal_text_version
- legal_text_snapshot
- ip_address
- user_agent
- source_url
- granted_at

### OptOutRecord
- id
- tenant_id
- lead_id
- channel
- scope
- reason
- detected_from
- created_at

### DeletionRequest
- id
- tenant_id
- lead_id
- requested_by
- status
- requested_at
- processed_at

### AuditEvent
- id
- tenant_id
- actor_type
- actor_id
- entity_type
- entity_id
- action
- metadata_json
- created_at

---

## 9.4 Reglas mínimas

- sin consentimiento no hay automatización comercial
- si hay opt-out, bloquear marketing del canal
- todo cambio crítico queda auditado
- solicitud de borrado debe poder registrarse y procesarse

---

## 9.5 UI mínima

- textos legales
- consent records por lead
- opt-outs
- deletion requests
- audit trail viewer

---

## 9.6 Criterios de aceptación

- consentimientos quedan trazables
- opt-out bloquea automatización
- cambios críticos se auditan

---

# 10. Módulo 8 — Identity / Access / Tenant

## 10.1 Propósito

Dar base multi-tenant segura para operación interna y futura venta como plataforma.

---

## 10.2 Submódulos

### Tenant Management
- tenant
- branding
- plan
- límites

### User Management
- usuarios
- invitaciones
- estado
- roles

### RBAC
- permisos por módulo
- permisos por acción

### SSO Base
- preparado para SSO empresarial

---

## 10.3 Entidades

### Tenant
- id
- name
- slug
- brand_name
- primary_color
- domain
- plan
- status

### User
- id
- tenant_id
- name
- email
- status
- role
- sso_provider

### RolePermission
- role
- permission_key

---

## 10.4 Roles iniciales

- superadmin
- admin_tenant
- supervisor
- agente
- viewer

---

## 10.5 Permisos base

- manage_users
- manage_channels
- manage_templates
- manage_campaigns
- manage_courses
- manage_automation
- manage_ai
- manage_compliance
- access_reports
- work_inbox
- move_pipeline
- export_data

---

## 10.6 UI mínima

- tenant settings
- branding
- usuarios
- roles
- permisos

---

## 10.7 Criterios de aceptación

- los permisos restringen vistas y acciones
- tenant aísla datos
- branding base aplicable

---

# 11. Shared UI / Design System mínimo

Aunque no vas a hacer un design system formal completo, sí necesitas una base compartida.

## Componentes mínimos
- AppShell
- Sidebar
- Topbar
- DataTable
- KanbanBoard
- DetailPanel
- ConversationPane
- Timeline
- StatCard
- KPIGrid
- FiltersBar
- Drawer
- Modal
- EmptyState
- ErrorState
- LoadingSkeleton
- Badge
- TagPill
- StatusIndicator

## Reglas visuales
- densidad media
- uso consistente de badges
- filtros siempre visibles
- panel lateral reutilizable para detalle
- responsive real en pantallas importantes
- dark mode opcional

---

# 12. Integración entre módulos

## Flujo principal integrado

1. Intake captura lead
2. Campaigns/Courses resuelven campaña y curso
3. CRM crea/actualiza lead y oportunidad
4. Automation dispara template
5. WhatsApp recibe respuesta
6. Carla clasifica + responde + scorea
7. CRM mueve etapa
8. Analytics agrega métricas
9. Compliance registra consent/opt-out/auditoría

---

# 13. Orden recomendado de construcción

## Release 1 — Foundations + Intake
- tenant
- auth
- branding base
- campaigns/courses básicos
- intake/landing
- form submission
- lead upsert
- opportunity create
- consent record

## Release 2 — Workflow básico
- LeadCaptured event
- automation engine mínimo
- waits
- action executor básico

## Release 3 — Carla + Knowledge base mínima
- knowledge resources
- retrieval simple
- Carla context builder
- Carla response pipeline
- score hybrid initial

## Release 4 — Analytics + Compliance UI
- dashboards básicos
- consent viewer
- opt-out viewer
- audit viewer

---

# 14. Vertical slice sugerido para empezar ya

Si quieres arrancar por un módulo diferente al de CRM/WhatsApp, el mejor siguiente módulo es:

## Intake / Landing

Porque:
- es finito
- tiene borde funcional claro
- desacopla el disparador del core
- fuerza a definir eventos, consentimiento y campaña/curso
- habilita pruebas reales del flujo comercial

### Alcance del primer vertical slice
- publicar landing por slug
- renderizar formulario
- validar envío
- guardar submission
- guardar consentimiento
- crear o actualizar lead
- crear oportunidad
- emitir LeadCaptured
- mostrar confirmación de envío

---

# 15. Backlog operativo del módulo Intake / Landing

## Épica: Intake / Landing Module

### Historia 1 — Publicar landing pública
**Como** visitante
**quiero** abrir una landing por URL
**para** ver la información del curso y enviar mis datos

#### Tareas
- crear entidad `LandingPage`
- endpoint público por slug
- resolver tenant/campaign/course
- render SSR/SPA según arquitectura elegida
- vista hero + secciones + CTA

#### Aceptación
- la landing carga por slug
- muestra contenido correcto
- está aislada por tenant

---

### Historia 2 — Renderizar formulario fijo configurable
**Como** admin
**quiero** tener una plantilla fija configurable
**para** reutilizar el intake sin construir un builder completo

#### Tareas
- definir `FormDefinition`
- render dinámico de campos base
- validación cliente
- validación servidor
- checkbox consentimiento obligatorio

#### Aceptación
- se pueden configurar labels/placeholder/campos visibles
- el backend valida los mismos campos

---

### Historia 3 — Guardar submission y trazabilidad
**Como** sistema
**quiero** registrar el envío completo
**para** tener trazabilidad del origen del lead

#### Tareas
- crear entidad `FormSubmission`
- guardar payload raw y normalized
- guardar UTMs
- guardar referrer y source URL
- guardar IP y user-agent

#### Aceptación
- cada submit queda persistido
- la trazabilidad es visible internamente

---

### Historia 4 — Crear o actualizar lead y oportunidad
**Como** sistema
**quiero** hacer upsert del lead
**para** evitar duplicados y mantener histórico

#### Tareas
- resolver deduplicación por email/teléfono
- crear lead si no existe
- actualizar lead si existe
- crear oportunidad vinculada a campaña/curso
- registrar actividad de origen

#### Aceptación
- no se crean duplicados innecesarios
- siempre se genera oportunidad o se actualiza la existente según regla

---

### Historia 5 — Emitir evento de inicio del flujo
**Como** sistema
**quiero** emitir `LeadCaptured`
**para** desacoplar el Intake del motor comercial

#### Tareas
- definir contrato del evento
- publicar evento tras éxito
- loguear publicación
- pruebas de idempotencia

#### Aceptación
- el evento contiene lead_id, opportunity_id, campaign_id, course_id, tenant_id
- el Intake no llama directamente a WhatsApp

---

# 16. Definition of Done global para estos módulos

Un módulo se considera aceptablemente implementado si:
- tiene entidades claras
- tiene endpoints/servicios definidos
- tiene UI mínima funcional
- registra auditoría en acciones críticas
- maneja errores comprensibles
- está aislado por tenant
- produce eventos o consume eventos cuando corresponda
- deja logs funcionales suficientes

---

# 17. Qué debe hacer el agente de código a continuación

## Instrucción recomendada
Tomar este documento y construir primero el módulo **Intake / Landing**, siguiendo este orden:

1. entidades y migraciones
2. endpoints públicos
3. UI pública de landing
4. formulario y validación
5. persistencia de submission
6. consentimiento
7. upsert lead
8. creación de oportunidad
9. evento `LeadCaptured`
10. vista interna de submissions

## Restricción importante
No mezclar lógica de WhatsApp ni de Carla dentro del módulo Intake.
Todo eso debe quedar aguas abajo del evento.

