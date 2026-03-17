# Parallly V3 — Guía Detallada de Implementación para Agente de Código

## 0. Propósito del documento

Este documento define de manera operativa y detallada cómo debe implementarse **Parallly** a partir de lo ya construido, corrigiendo el enfoque para que el corazón del producto sea:

- **CRM comercial completo**
- **Inbox conversacional**
- **Gestor interno de WhatsApp / Meta**
- **Agente IA Carla**
- **Campañas, cursos y automatización comercial**

Y dejando la **landing / formulario** como un módulo aparte, desacoplable, que solo actúa como **intake / disparador de entrada**.

Este documento está pensado para que un agente de código pueda empezar a construir por módulos, sin perder el enfoque de producto, sin sobrediseñar, pero con base enterprise-ready.

---

# 1. Decisiones ya cerradas

## 1.1 Nombre del producto
**Parallly**

## 1.2 Objetivo principal
Calificar, calentar y entregar leads listos para cierre comercial.

## 1.3 Resultado esperado del sistema
El sistema debe llevar al lead hasta el punto donde:
- confirma intención de tomar el curso
- confirma sus datos
- queda listo para pago / intervención final humana

## 1.4 Naturaleza del producto
- interno por ahora
- arquitectura preparada para multi-tenant
- preparado para SaaS futuro
- white-label futuro

## 1.5 Canales iniciales
- WhatsApp
- Email

## 1.6 Canal principal de interacción
WhatsApp

## 1.7 Landing / formulario
- sí existe, pero es **módulo separado**
- no es el core del producto
- debe poder desacoplarse luego

## 1.8 CRM
Debe ser **completo**, no una integración ligera.

## 1.9 Agente IA
- nombre: **Carla**
- identidad: experta de SGS Academy
- estilo: corporativo y orientado al cierre
- puede dar precio
- no puede enviar link de pago
- solo puede ofrecer descuentos/promos en contexto grupal y si existe regla comercial configurada

## 1.10 Scoring
- híbrido: reglas + IA
- escala 1–10
- caliente desde 7
- listo para cierre desde 9

## 1.11 Lead VIP / alto valor
- lead grupal
- interesado en varios cursos
- múltiples personas / cupos

## 1.12 Handoff a humano
- Carla debe hacerlo de forma sutil en la conversación
- internamente debe quedar marcado, auditado y notificado

## 1.13 Stack aprobado
- Frontend: **Next.js**
- Backend: **NestJS**
- DB: **PostgreSQL**
- Cola / jobs: **Redis + BullMQ**
- embeddings / RAG: **pgvector**
- deploy: **VPS**
- arquitectura: **monolito modular preparado para posterior extracción**

---

# 2. Visión de arquitectura de producto

## 2.1 Principio central
Parallly debe dividirse en dominios claros. El sistema no debe girar alrededor de la landing, sino alrededor del **CRM + Conversación + WhatsApp + IA**.

## 2.2 Módulos de primer nivel

1. **Identity & Access**
2. **Tenant & Settings**
3. **Intake / Landing**
4. **CRM Core**
5. **Inbox Conversacional**
6. **WhatsApp Platform Manager**
7. **Email Channel**
8. **Campaigns & Courses**
9. **Carla AI Agent**
10. **Knowledge Base / RAG**
11. **Automation Engine**
12. **Analytics & Reporting**
13. **Compliance & Consent**
14. **Audit & Operational Logs**

## 2.3 Criterio de separación
Todo lo que sea captación por formulario debe emitir eventos hacia el core, pero no debe acoplar el producto a una landing específica.

---

# 3. Arquitectura técnica recomendada

## 3.1 Frontend
**Next.js + TypeScript + Tailwind + shadcn/ui**

### Requisitos
- App Router
- layouts por secciones
- autorización por rol
- vistas de dashboard rápidas
- tablas/filtros eficientes
- tiempo real en inbox
- soporte dark mode
- responsive real

## 3.2 Backend
**NestJS + TypeScript**

### Requisitos
- modular por dominio
- DTOs claros
- validación centralizada
- services desacoplados
- jobs desacoplados del request lifecycle
- adapters externos por provider

## 3.3 Base de datos
**PostgreSQL**

### Requisitos
- multi-tenant por `tenant_id`
- índices en entidades de búsqueda frecuente
- tablas de auditoría y logs separadas del dominio core cuando aplique
- pgvector para base documental / RAG

## 3.4 Redis + BullMQ
Usar para:
- envío diferido de templates
- fallback email
- procesamiento de webhook pesado
- sincronización de templates
- health checks
- reintentos
- tareas automáticas
- actualización de métricas agregadas

## 3.5 Tiempo real
- WebSockets para inbox y alertas operativas

## 3.6 Despliegue
- Docker Compose en VPS
- entornos mínimos: dev y prod
- variables sensibles fuera del repositorio

---

# 4. Módulo Intake / Landing (desacoplado)

## 4.1 Propósito
Capturar leads desde landing / formulario y disparar el flujo comercial.

## 4.2 Importante
Este módulo **no es el sistema principal**. Debe ser reemplazable.

## 4.3 Responsabilidades
- render de landing
- render y validación de formulario
- consentimiento
- captura de UTMs / referrer
- envío del formulario
- creación/actualización de lead vía servicio core
- emisión de evento `LeadCaptured`

## 4.4 Funciones mínimas
- clon de landing y contenido actual
- plantilla fija configurable
- formulario con los campos actuales
- validación frontend/backend
- persistencia de consentimiento legal aceptado
- captura de IP, user-agent, source_url, legal_text_version

## 4.5 Resultado al enviar formulario
Debe:
1. crear o actualizar lead
2. crear oportunidad
3. vincular campaña y curso
4. registrar actividad
5. encolar job de contacto inicial

## 4.6 No debe contener
- lógica del CRM
- lógica del inbox
- lógica fuerte de scoring
- lógica de asignación humana avanzada
- estado operativo del canal

---

# 5. CRM Core — Diseño completo

## 5.1 Objetivo
Ser el corazón comercial del sistema.

## 5.2 Submódulos del CRM

### 5.2.1 Leads
Responsable de la entidad de captación principal.

#### Funciones
- crear lead
- actualizar lead
- deduplicar por teléfono y/o email
- merge lógico
- consultar historial
- listar con filtros
- exportar

#### Reglas
- si existe mismo teléfono o email, actualizar ficha en vez de duplicar
- mantener trazabilidad por campaña/oportunidad
- no perder histórico de captación

#### Campos sugeridos
- id
- tenant_id
- first_name
- last_name
- email
- phone
- position
- company_name_raw
- preferred_contact
- source
- lifecycle_stage
- score
- is_vip
- owner_user_id
- created_at
- updated_at

### 5.2.2 Contacts
Separar de lead para futuro B2B maduro.

#### Propósito
Normalizar personas cuando una misma entra varias veces por campañas distintas.

#### Funciones
- consolidar identidad del contacto
- relacionar múltiples leads / oportunidades al mismo contacto

### 5.2.3 Companies
#### Propósito
Soportar ventas corporativas y grupales.

#### Funciones
- agrupar contactos
- detectar oportunidades de grupo
- consolidar ventas por empresa

#### Campos
- id
- tenant_id
- name
- industry
- size
- domain
- notes
- owner

### 5.2.4 Opportunities
Entidad comercial principal.

#### Funciones
- crear oportunidad por curso/campaña
- asignar owner
- actualizar etapa
- actualizar score
- marcar ready_to_close
- marcar ganado/perdido
- registrar motivo de pérdida

#### Campos
- id
- tenant_id
- lead_id
- contact_id nullable
- company_id nullable
- campaign_id
- course_id
- stage
- score
- owner_user_id
- estimated_group_size nullable
- is_group
- is_high_value
- intent_primary
- intent_secondary
- ready_to_close_at nullable
- won_at nullable
- lost_at nullable
- loss_reason nullable

### 5.2.5 Pipeline
#### Etapas definidas
- nuevo
- contactado
- respondió
- calificado
- tibio
- caliente
- listo para cierre
- ganado
- perdido
- no interesado

#### Requisitos
- configurable por tenant
- orden configurable
- movimiento manual
- movimiento automático por reglas/IA
- auditoría obligatoria
- SLA por etapa

### 5.2.6 Tasks
#### Propósito
Hacer el CRM operable por humanos.

#### Tipos mínimos
- llamar lead
- responder manualmente
- revisar handoff
- revisar lead VIP
- seguimiento
- confirmar pago
- revisar error de canal

#### Requisitos
- vencimiento
- prioridad
- asignación
- completado / cancelado
- creación automática por automatización

### 5.2.7 Notes
#### Tipos
- nota libre
- resumen IA
- nota del agente
- observación de venta
- motivo de pérdida
- observación de compliance

### 5.2.8 Tags
Catálogo controlado.

#### Ejemplos iniciales
- vip
- grupo
- varios-cursos
- pricing
- alto-potencial
- pendiente-pago
- objecion-precio
- objecion-tiempo
- requiere-humano
- no-contactar

### 5.2.9 Activity Timeline
Vista consolidada de eventos del lead/oportunidad.

#### Debe registrar
- formulario enviado
- consentimiento aceptado
- template enviado
- email enviado
- mensaje recibido
- score actualizado
- etapa cambiada
- tag agregada
- tarea creada
- nota agregada
- handoff solicitado
- humano asignado
- opt-out
- oportunidad ganada/perdida

---

# 6. Inbox Conversacional

## 6.1 Objetivo
Permitir que IA y humano trabajen sobre la misma conversación sin perder contexto.

## 6.2 Entidades base
- Conversation
- Message
- ConversationParticipant interno si luego se requiere
- HandoffEvent

## 6.3 Capacidades mínimas
- listado de conversaciones
- filtros por estado, owner, stage, score, canal, campaña, curso
- detalle de conversación en tiempo real
- notas internas
- timeline lateral
- score visible
- etapa visible
- resumen IA
- handoff indicator
- asignación / reasignación
- unread / prioridad

## 6.4 Estados de conversación sugeridos
- open
- waiting_ai
- waiting_human
- handoff_requested
- resolved
- closed
- blocked

## 6.5 Message model
Cada mensaje debe guardar:
- id
- tenant_id
- conversation_id
- provider_message_id
- direction
- sender_type (`lead`, `ai`, `human`, `system`)
- sender_id nullable
- channel (`whatsapp`, `email`)
- content
- content_type
- template_name nullable
- delivery_status
- intent_detected nullable
- intent_confidence nullable
- metadata_json
- created_at

## 6.6 Reglas clave
- toda respuesta entrante debe crear mensaje y actualizar última actividad
- mensajes IA y humanos deben coexistir en el hilo
- handoff no debe romper la conversación
- toda reasignación debe auditarse

---

# 7. WhatsApp Platform Manager — Diseño completo

## 7.1 Objetivo
Que un admin pueda **configurar WhatsApp desde dentro de Parallly** y dejar un número funcional.

## 7.2 Este módulo debe ser de primer nivel
No tratarlo como simple integración. Debe tener UI, backend, logs, configuración y pruebas.

## 7.3 Submódulos
1. Connection Setup
2. Business / WABA Mapping
3. Number Management
4. Webhook Management
5. Template Management
6. Messaging Service
7. Monitoring & Logs
8. Compliance Guard

## 7.4 Flujo deseado para conectar un número

### Paso 1 — Canales
Pantalla con listado de canales.

#### Debe mostrar
- WhatsApp
- Email
- estado del canal
- acciones rápidas

### Paso 2 — Conectar WhatsApp
Pantalla inicial con:
- estado actual
- Meta app asociada
- permisos requeridos
- botón iniciar onboarding

### Paso 3 — Embedded Signup / Onboarding controlado
El flujo debe permitir capturar y persistir:
- meta_business_id
- waba_id
- phone_number_id
- display_phone_number
- display_name
- permisos concedidos
- estado onboarding

### Paso 4 — Número conectado
Pantalla de confirmación:
- número conectado
- display name
- status de display name
- quality rating
- messaging tier
- fecha conexión

### Paso 5 — Configuración de Webhook
Pantalla técnica interna con:
- callback URL
- verify token status
- subscribed fields
- último webhook recibido
- prueba de challenge
- errores recientes

### Paso 6 — Templates
Pantalla con:
- templates sincronizados
- categoría
- idioma
- estado de aprobación
- curso asociado
- campaña asociada
- prueba de envío

### Paso 7 — Test de canal
Permitir:
- enviar template de prueba
- ver estado sent / delivered / read
- ver logs del request y response

### Paso 8 — Canal listo
Checklist final:
- onboarding ok
- número ok
- webhook ok
- templates disponibles
- prueba enviada ok

## 7.5 Entidades principales del módulo WhatsApp

### WhatsAppChannel
Campos sugeridos:
- id
- tenant_id
- provider_type
- meta_business_id
- meta_waba_id
- phone_number_id
- display_phone_number
- display_name
- display_name_status
- quality_rating
- messaging_limit_tier
- access_token_ref
- app_id
- webhook_verify_token_ref
- webhook_callback_url
- webhook_subscription_status
- channel_status
- connected_at
- last_healthcheck_at

### WhatsAppTemplate
- id
- tenant_id
- channel_id
- course_id nullable
- campaign_id nullable
- name
- language
- category
- components_json
- approval_status
- last_sync_at

### WhatsAppWebhookEvent
- id
- tenant_id
- channel_id
- event_type
- payload_json
- dedupe_key
- processing_status
- processing_result
- processed_at
- created_at

### WhatsAppMessageLog
- id
- tenant_id
- channel_id
- conversation_id nullable
- provider_message_id
- template_name nullable
- direction
- status
- error_code nullable
- error_message nullable
- request_payload_json
- response_payload_json
- sent_at nullable
- delivered_at nullable
- read_at nullable
- created_at

## 7.6 Servicios backend requeridos

### WhatsAppConnectionService
Responsable de:
- iniciar y finalizar onboarding
- persistir assets conectados
- health checks
- desconectar canal

### WhatsAppWebhookService
Responsable de:
- verify GET challenge
- validar firma
- parsear payload
- deduplicar eventos
- enrutar procesamiento

### WhatsAppMessagingService
Responsable de:
- enviar template
- enviar mensajes de seguimiento permitidos
- guardar logs
- actualizar status

### WhatsAppTemplateService
Responsable de:
- sincronizar templates
- mapear estados
- validar variables
- asociar template a curso/campaña

### WhatsAppMonitoringService
Responsable de:
- health check
- warnings
- quality/status del número
- alertas operativas

### WhatsAppComplianceService
Responsable de:
- validar consentimiento
- validar opt-out
- validar horario permitido
- bloquear marketing si aplica

## 7.7 Eventos webhook mínimos a procesar
- inbound messages
- message status updates
- template status updates
- display name / phone updates
- account updates relevantes

## 7.8 Reglas antes de enviar template marketing
Validar siempre:
- lead válido
- oportunidad válida
- canal activo
- template aprobado
- variables completas
- consentimiento vigente para el canal
- no existe opt-out activo
- horario permitido

## 7.9 Errores que se deben clasificar
- auth / token
- permissions
- webhook invalid
- signature failed
- template rejected
- template variables invalid
- number inactive
- display name issue
- delivery failure
- unknown provider failure

---

# 8. Email Channel

## 8.1 Rol de email en V1
Email queda como canal operativo y fallback.

## 8.2 Funciones
- fallback si falla WhatsApp inicial
- soporte a secuencias básicas
- plantillas por curso/campaña
- tracking básico si se implementa desde inicio

## 8.3 Entidades mínimas
- EmailChannelConfig
- EmailTemplate
- EmailSendLog

## 8.4 Reglas
- respetar opt-out si luego se amplía por canal
- permitir fallback configurable
- auditar envíos

---

# 9. Campaigns & Courses

## 9.1 Campaigns
Debe permitir:
- crear campañas
- asociar curso
- definir ventanas horarias
- definir template inicial
- definir fallback
- definir owner rules
- definir reglas de automatización
- visualizar performance

## 9.2 Courses
Debe permitir:
- nombre
- descripción
- modalidad
- duración
- precio
- brochure
- FAQs
- políticas
- promociones
- recursos de venta

## 9.3 Relación campaña / curso / template
Una campaña puede:
- empujar un curso principal
- tener template específico
- tener reglas propias
- alimentar scoring y atribución

---

# 10. Carla AI Agent

## 10.1 Objetivo
Automatizar la primera conversación comercial para calificar, nutrir y preparar el cierre.

## 10.2 Capacidades obligatorias
- responder desde el primer mensaje del lead
- responder en español
- usar RAG
- dar precio
- resolver dudas frecuentes
- detectar intención principal/secundaria
- recalcular score
- detectar lead grupal / VIP
- identificar momento de handoff
- generar resumen para humano

## 10.3 Restricciones
- no enviar link de pago
- no inventar políticas
- no prometer descuentos salvo regla configurada
- no prometer disponibilidad si no está confirmada por fuentes válidas

## 10.4 Handoff sutil
Cuando detecte intención alta o lead VIP debe:
1. enviar transición sutil al lead
2. marcar `handoff_requested`
3. crear tarea al humano
4. dejar resumen interno
5. cambiar estado conversacional

## 10.5 Resumen IA para humano
Debe incluir:
- lead
- curso de interés
- score
- señales detectadas
- objeciones
- intención principal
- si es grupo o no
- por qué se escaló
- qué falta para cerrar

---

# 11. Knowledge Base / RAG

## 11.1 Objetivo
Dar a Carla y al CRM contexto documental confiable.

## 11.2 Tipos de recursos
- ficha de curso
- FAQs
- brochure PDF
- políticas
- texto manual
- enlaces web si luego se amplía

## 11.3 Requisitos
- versionado
- aprobación
- hash de contenido
- embeddings
- trazabilidad de fuente
- refresh controlado

## 11.4 Entidad sugerida
### KnowledgeResource
- id
- tenant_id
- type
- title
- source
- version
- content_hash
- approved
- active
- metadata_json
- created_at

---

# 12. Automation Engine

## 12.1 Objetivo
Centralizar reglas operativas del sistema.

## 12.2 Automatizaciones mínimas
- contacto inicial tras formulario
- espera configurable antes de primer mensaje
- fallback email
- creación de tarea tras handoff
- reasignación por campaña/curso
- actualización automática de etapa
- bloqueo de envíos por opt-out
- recordatorios internos

## 12.3 Entidad sugerida
### AutomationRule
- id
- tenant_id
- name
- trigger_type
- conditions_json
- actions_json
- active

## 12.4 Triggers mínimos
- LeadCaptured
- TemplateFailed
- InboundMessageReceived
- ScoreReachedThreshold
- HandoffRequested
- TaskOverdue
- OpportunityStageChanged

---

# 13. Analytics & Reporting

## 13.1 Dashboards obligatorios

### Ejecutivo
- leads nuevos
- leads por campaña
- leads por curso
- tasa de respuesta
- tasa de calientes
- tasa de listos para cierre
- oportunidades ganadas
- forecast
- costo estimado por lead/oportunidad

### Operativo
- conversaciones activas
- handoffs abiertos
- tareas vencidas
- SLA en riesgo
- score promedio
- principales intenciones
- tiempo a primera respuesta
- tiempo a handoff
- errores de canal

### CRM
- conversiones por etapa
- aging por etapa
- owner performance
- oportunidad por campaña
- pérdida por motivo

### WhatsApp
- mensajes enviados
- delivered
- read
- templates con error
- quality del número
- fallos operativos

### IA
- conversaciones atendidas por Carla
- tasa de handoff
- score promedio generado
- intenciones detectadas
- errores o intervenciones manuales

---

# 14. Compliance & Consent

## 14.1 Requisitos obligatorios
- guardar consentimiento
- guardar versión del texto legal
- guardar snapshot del texto aceptado
- guardar IP
- guardar user-agent
- guardar source_url
- guardar timestamp

## 14.2 Opt-out
El sistema debe detectar palabras y acciones de baja.

### Palabras base
- stop
- baja
- no quiero
- eliminar
- no contactar

## 14.3 Recomendación operativa
Bloquear inmediatamente la automatización comercial del canal afectado y conservar registro mínimo de supresión.

## 14.4 Entidades
### ConsentRecord
- id
- tenant_id
- lead_id
- channel
- consent_type
- legal_text_version
- legal_text_snapshot
- ip_address
- user_agent
- source_url
- granted_at
- revoked_at nullable

### OptOutRecord
- id
- tenant_id
- lead_id
- channel
- scope
- reason
- detected_from
- created_at

---

# 15. Audit & Logs

## 15.1 AuditEvent
Registrar siempre:
- cambio de owner
- cambio de etapa
- cambio de score manual
- edición de lead
- edición de campaña
- edición de curso
- cambios en canal WhatsApp
- cambios en templates
- handoff solicitado
- cierre/pérdida
- configuración de reglas

## 15.2 Operational logs
Separar del audit funcional.

### Debe incluir
- webhooks recibidos
- errores de provider
- jobs fallidos
- reintentos
- fallos de template
- health checks

---

# 16. Diseño de UI/UX mínimo para implementación

## 16.1 Principios
- rapidez primero
- elegancia sin exceso visual
- estilo moderno tipo CRM premium
- navegación clara
- pantallas orientadas a operación

## 16.2 Vistas prioritarias
1. login
2. dashboard ejecutivo
3. dashboard operativo
4. leads list
5. lead detail 360
6. pipeline board
7. inbox list
8. conversation detail
9. campaigns
10. courses
11. channels
12. WhatsApp setup
13. templates
14. Carla settings
15. knowledge base
16. compliance settings

## 16.3 Vista Lead 360
Debe contener:
- perfil
- empresa
- oportunidad actual
- score
- tags
- timeline
- tareas
- conversación
- consentimientos
- flags operativas

## 16.4 Vista WhatsApp Setup
Tabs sugeridos:
- Resumen
- Conexión
- Número
- Webhooks
- Templates
- Pruebas
- Logs
- Permisos

---

# 17. Organización de módulos de backend (NestJS)

## 17.1 Propuesta de módulos
- auth
- users
- tenants
- intake
- leads
- contacts
- companies
- opportunities
- pipeline
- tags
- notes
- tasks
- conversations
- messages
- campaigns
- courses
- whatsapp
- email
- ai-agent
- knowledge-base
- automations
- analytics
- compliance
- audit
- files
- shared

## 17.2 Regla importante
No mezclar integración de provider con lógica de dominio.

Ejemplo:
- `whatsapp` contiene adapters y servicios del canal
- `conversations` contiene lógica de conversación
- `opportunities` contiene lógica comercial

---

# 18. Endpoints / contratos funcionales mínimos

## 18.1 Intake
- `POST /public/intake/forms/:slug/submit`
- `GET /public/intake/forms/:slug`

## 18.2 Leads
- `GET /crm/leads`
- `GET /crm/leads/:id`
- `PATCH /crm/leads/:id`
- `POST /crm/leads/:id/tags`
- `POST /crm/leads/:id/notes`
- `POST /crm/leads/:id/tasks`

## 18.3 Opportunities
- `GET /crm/opportunities`
- `GET /crm/opportunities/:id`
- `PATCH /crm/opportunities/:id`
- `POST /crm/opportunities/:id/stage`
- `POST /crm/opportunities/:id/assign`

## 18.4 Conversations
- `GET /inbox/conversations`
- `GET /inbox/conversations/:id`
- `POST /inbox/conversations/:id/assign`
- `POST /inbox/conversations/:id/notes`
- `POST /inbox/conversations/:id/messages`

## 18.5 WhatsApp
- `POST /channels/whatsapp/connect/start`
- `POST /channels/whatsapp/connect/complete`
- `GET /channels/whatsapp/status`
- `GET /channels/whatsapp/templates`
- `POST /channels/whatsapp/templates/sync`
- `POST /channels/whatsapp/test-send`
- `GET /channels/whatsapp/logs`
- `GET /channels/whatsapp/webhook` (verify)
- `POST /channels/whatsapp/webhook`

## 18.6 Campaigns / Courses
- `GET /campaigns`
- `POST /campaigns`
- `GET /courses`
- `POST /courses`

## 18.7 AI
- `GET /ai/settings`
- `PATCH /ai/settings`
- `POST /ai/rebuild-knowledge-index`

## 18.8 Analytics
- `GET /analytics/executive`
- `GET /analytics/operational`
- `GET /analytics/crm`
- `GET /analytics/whatsapp`
- `GET /analytics/ai`

---

# 19. Prioridades de implementación por releases

## Release 1 — Base CRM + Intake + WhatsApp mínimo funcional
Objetivo: capturar lead, crear oportunidad, conectar canal y enviar primer mensaje.

### Incluir
- auth básico
- tenants
- intake desacoplado
- leads
- opportunities
- campaigns
- courses
- WhatsAppChannel
- webhook verify + receive
- template send inicial
- logs de envío
- UI básica de channels
- dashboard operativo mínimo

## Release 2 — Inbox + Carla básica
Objetivo: recibir mensajes, responder con IA y escalar a humano.

### Incluir
- conversations
- messages
- inbox UI
- Carla base
- score híbrido v1
- handoff
- tareas automáticas
- notes
- tags

## Release 3 — CRM completo operativo
Objetivo: operación comercial real.

### Incluir
- pipeline board
- lead 360
- tasks completas
- notes completas
- companies/contacts
- SLA
- asignación avanzada
- email fallback
- timeline consolidado

## Release 4 — WhatsApp manager completo
Objetivo: canal administrable profesionalmente.

### Incluir
- UI de onboarding interno completa
- templates sync
- test send
- logs avanzados
- webhook viewer
- error classifications
- health checks

## Release 5 — Analytics + Compliance + hardening
Objetivo: plataforma controlable y auditada.

### Incluir
- dashboards ejecutivos
- dashboards CRM/WhatsApp/IA
- consent y opt-out completos
- exportaciones
- auditoría extendida
- borrado bajo solicitud

---

# 20. Backlog detallado por épicas

## Épica 1 — Identity & Tenant Foundation
### Historias
- como admin, quiero iniciar sesión y gestionar acceso
- como plataforma, quiero aislar datos por tenant
- como admin, quiero configurar branding básico

### Tareas
- crear tablas tenant/user/membership
- implementar RBAC
- middleware de tenant context
- settings base por tenant
- seed de tenant demo

### Criterios de aceptación
- ningún dato cruza entre tenants
- rutas protegidas por rol
- branding configurable básico

---

## Épica 2 — Intake / Landing desacoplado
### Historias
- como visitante, quiero enviar formulario de interés
- como sistema, quiero disparar el flujo comercial al enviar formulario

### Tareas
- clonar landing actual en módulo separado
- crear esquema del formulario
- validaciones FE/BE
- persistir consentimiento
- capturar UTMs y metadata
- emitir `LeadCaptured`

### Criterios
- submit válido crea/actualiza lead y oportunidad
- consentimiento queda registrado
- landing no depende del inbox ni de WhatsApp UI

---

## Épica 3 — CRM Core
### Historias
- como agente, quiero ver y gestionar leads
- como agente, quiero mover oportunidades por etapas
- como agente, quiero ver histórico completo del lead

### Tareas
- implementar Lead aggregate
- implementar Opportunity aggregate
- implementar pipeline stages configurables
- implementar tags
- implementar notes
- implementar tasks
- implementar activity timeline
- crear lead list + filters
- crear lead 360 view
- crear pipeline board

### Criterios
- lead deduplica correctamente
- oportunidad conserva trazabilidad por campaña/curso
- pipeline es usable y auditable

---

## Épica 4 — Inbox Conversacional
### Historias
- como agente, quiero ver conversaciones activas
- como agente, quiero responder y revisar notas internas
- como sistema, quiero soportar IA y humano en la misma conversación

### Tareas
- crear tablas conversation/message
- construir inbox list
- construir conversation detail
- websockets para actualización en tiempo real
- notas internas de conversación
- asignación/reasignación
- unread/prioridad

### Criterios
- mensajes entrantes aparecen en tiempo real
- handoff no rompe hilo
- la conversación muestra score, etapa y resumen IA

---

## Épica 5 — WhatsApp Platform Manager
### Historias
- como admin, quiero conectar un número desde Parallly
- como admin, quiero validar webhook y ver logs
- como admin, quiero sincronizar templates y probar envíos

### Tareas
- crear entidad WhatsAppChannel
- crear entidad WhatsAppTemplate
- crear entidad WhatsAppWebhookEvent
- crear entidad WhatsAppMessageLog
- implementar connect start/complete
- implementar status endpoint
- implementar webhook GET/POST
- implementar firma y dedupe
- implementar envío template
- implementar sync templates
- construir UI canales
- construir UI setup whatsapp
- construir UI logs
- construir UI test send

### Criterios
- admin puede dejar un número conectado y operativo
- webhook recibe y procesa eventos
- test send queda registrado con trazabilidad completa

---

## Épica 6 — Carla AI Agent
### Historias
- como lead, quiero recibir respuesta inmediata
- como agente, quiero que Carla precalifique antes de mi intervención
- como sistema, quiero detectar el mejor momento para escalar

### Tareas
- prompt base de Carla
- servicio de inferencia
- intent classifier
- score updater
- handoff detector
- resumen IA para humano
- settings configurables

### Criterios
- Carla responde desde el primer mensaje
- score se actualiza automáticamente
- handoff se dispara correctamente para score>=9 o lead VIP

---

## Épica 7 — Campaigns & Courses
### Historias
- como admin, quiero configurar campañas y cursos
- como sistema, quiero mapear template por curso/campaña

### Tareas
- CRUD campaigns
- CRUD courses
- asociación template-curso-campaña
- reglas horarias
- fallback rules
- vista performance básica

### Criterios
- se puede disparar template correcto según campaña y curso
- campañas quedan trazables en oportunidades

---

## Épica 8 — Email Channel
### Historias
- como sistema, quiero tener fallback a email si falla WhatsApp

### Tareas
- configuración channel email
- plantillas email
- send log
- fallback job

### Criterios
- si falla WhatsApp y regla activa, email se dispara y audita

---

## Épica 9 — Knowledge Base / RAG
### Historias
- como admin, quiero subir contenido para Carla
- como Carla, quiero responder con conocimiento controlado

### Tareas
- recurso documental
- ingestión texto/PDF/FAQ
- embeddings
- retrieval service
- versionado y aprobación

### Criterios
- Carla responde con fuente disponible y corpus activo

---

## Épica 10 — Compliance & Audit
### Historias
- como negocio, quiero demostrar consentimiento y gestionar bajas
- como admin, quiero auditar acciones críticas

### Tareas
- ConsentRecord
- OptOutRecord
- parser palabras de baja
- bloqueo canal comercial
- audit events
- solicitud de borrado

### Criterios
- opt-out bloquea automatización del canal
- consentimiento queda completo y versionado

---

## Épica 11 — Analytics
### Historias
- como gerente, quiero ver conversión y performance
- como operador, quiero ver estado operativo del sistema

### Tareas
- executive dashboard
- operational dashboard
- CRM dashboard
- WhatsApp dashboard
- AI dashboard

### Criterios
- métricas clave visibles por tenant, campaña, curso y período

---

# 21. Sprint sugerido inicial para el agente

## Sprint 1
- auth/tenant base
- estructura modular backend/frontend
- lead + opportunity base
- intake submit funcional
- campaign + course mínimo

## Sprint 2
- WhatsAppChannel base
- webhook GET/POST
- template send inicial
- logs básicos de WhatsApp
- UI channels básica

## Sprint 3
- conversations/messages
- inbox list/detail
- Carla base
- score híbrido v1
- handoff + task automática

## Sprint 4
- lead 360
- pipeline board
- tags/notes/tasks
- timeline
- email fallback

## Sprint 5
- WhatsApp setup completo
- template sync
- test send
- compliance
- dashboards operativos

---

# 22. Criterios de calidad para el agente de código

## 22.1 No hacer
- no acoplar landing al core
- no meter lógica comercial en componentes frontend
- no mezclar adapters Meta con dominio CRM
- no usar mocks permanentes para métricas críticas
- no guardar secretos visibles en UI

## 22.2 Sí hacer
- usar DTOs y schemas claros
- separar dominio, integración y presentación
- auditar acciones críticas
- instrumentar logs legibles
- dejar feature flags simples donde haga falta
- documentar variables de entorno
- crear seeds útiles para demo

## 22.3 Definition of Done por historia
Una historia no está terminada si falta alguno de estos puntos cuando aplique:
- backend funcional
- UI mínima usable
- validación
- auditoría/logs
- manejo de error razonable
- seed/demo path

---

# 23. Resultado final esperado cuando esta guía se implemente

Parallly debe quedar como una plataforma donde:
- un lead entra por un intake desacoplado
- se crea o actualiza en el CRM
- se abre oportunidad por campaña/curso
- el canal WhatsApp puede configurarse desde dentro de la app
- un número puede quedar conectado y probado
- Carla responde y califica
- el CRM registra score, etapa, tareas, notas e historial
- el humano toma el relevo cuando corresponde
- la operación puede medirse, auditarse y mantenerse

---

# 24. Tarea inmediata para el agente de código

## Orden de arranque recomendado
1. consolidar estructura de módulos
2. cerrar modelo de datos CRM + WhatsApp
3. implementar intake -> lead -> opportunity
4. implementar canal WhatsApp mínimo conectable
5. implementar inbox y mensajes
6. implementar Carla base
7. completar CRM operativo

## Primer entregable exigible
Un vertical slice funcional que haga esto:
- visitante llena formulario
- sistema crea/actualiza lead
- crea oportunidad
- envía template WhatsApp
- registra log del envío
- si responde, crea conversación
- Carla responde
- si score sube a 9 o detecta grupo, se genera handoff y tarea humana

Ese vertical slice es el primer hito real de Parallly.
