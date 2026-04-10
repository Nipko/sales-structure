# Especificación de Arquitectura — Plataforma Multicanal Parallly 

## 1. Objetivo

Construir una plataforma propia de automatización multicanal para Parallly que permita:

- centralizar la atención humana, automatizada y la operación comercial dentro de Parallly;
- unificar identidades de clientes entre WhatsApp, Instagram, Messenger, Email y futuros canales;
- operar un inbox multicanal propio sin dependencia estructural de terceros;
- gestionar un CRM propio con contactos, leads, oportunidades, tareas, etiquetas, atributos y trazabilidad completa;
- automatizar ventas y soporte mediante un agente conversacional configurable;
- gestionar conocimiento y recuperación semántica desde documentos, URLs, notas, FAQs y Google Drive;
- configurar desde frontend el comportamiento global y las diferencias por canal;
- versionar configuraciones y permitir publicación, aprobación y rollback;
- disparar notificaciones importantes por SMS y correo desde un servicio desacoplado.



---

## 2. Decisión arquitectónica central

### Decisión cerrada


Parallly pasa a ser:

- el CRM principal;
- el inbox multicanal principal;
- la consola operativa humana;
- la capa de automatización;
- la capa de identidad unificada;
- la plataforma de conocimiento y configuración.


---

## 3. Principios de diseño

1. **Parallly como sistema central del negocio**
   - Parallly concentra conversación, automatización, identidad, CRM y operación humana.
   - Las integraciones externas son adaptadores reemplazables, no piezas centrales.

2. **Identidad unificada propia**
   - No depender de identificadores nativos de canal como fuente principal de identidad.
   - Cada cliente tendrá un `customer_id` interno.

3. **Conversación por canal, contexto por cliente**
   - Cada conversación conserva su canal de origen.
   - El agente y los operadores trabajan con contexto unificado del cliente.

4. **Inbox propio desacoplado del canal**
   - La experiencia operativa humana ocurre en Parallly.
   - Los canales son transportes de entrada y salida, no la interfaz operativa.

5. **Configuración guiada, no constructor visual complejo**
   - El frontend será un panel guiado tipo wizard/formulario inteligente.
   - El sistema generará internamente políticas, prompts, bindings y reglas.

6. **Versionado de comportamiento**
   - Prompts, modelos, skills, conocimiento y políticas se publican por versión.
   - Toda ejecución queda asociada a una versión publicada.

7. **Herencia global + override por canal**
   - Si no hay configuración específica por canal, se hereda la global.
   - Si existe override, aplica solo a ese canal.

8. **Servicios desacoplados y orientados a eventos**
   - La plataforma debe crecer sin rehacer el núcleo.

---

## 4. Alcance funcional inicial

### Canales iniciales
- WhatsApp
- Instagram
- Messenger
- Email
- SMS (solo notificaciones importantes, no canal conversacional principal)

### Casos de uso principales
- atención automatizada de ventas;
- atención automatizada de soporte;
- handoff a humano dentro de Parallly;
- recuperación de contexto y conocimiento;
- actualización de etiquetas, atributos y estado CRM;
- envío de notificaciones críticas por SMS y/o Email;
- unificación automática o sugerida de identidad;
- gestión de leads y oportunidades comerciales;
- seguimiento operativo desde inbox propio.

---

## 5. Arquitectura de alto nivel

## Servicios principales

1. `channel-gateway-service`
2. `conversation-service`
3. `crm-service`
4. `identity-service`
5. `chat-orchestration-service`
6. `knowledge-service`
7. `config-service`
8. `notification-service`
9. `admin-frontend`

## Componentes transversales
- PostgreSQL 17
- pgvector
- Redis
- NATS JetStream
- Object Storage S3-compatible
- OpenTelemetry
- Keycloak/Auth provider

## Flujo principal de entrada

1. El mensaje llega a un canal conectado directamente a Parallly.
2. `channel-gateway-service` valida, autentica y normaliza el evento.
3. `identity-service` resuelve o crea el cliente.
4. `conversation-service` crea o reutiliza la conversación interna.
5. `crm-service` carga contexto comercial y operativo del cliente.
6. `config-service` entrega la configuración publicada aplicable.
7. `knowledge-service` aporta contexto semántico si aplica.
8. `chat-orchestration-service` decide si responder, usar skill, solicitar dato, escalar o notificar.
9. La respuesta se registra en Parallly.
10. `channel-gateway-service` la envía al canal correspondiente.
11. Todo queda auditado y trazado.

---

## 6. Stack tecnológico recomendado

## Backend
- **Node.js 22 LTS**
- **TypeScript**
- **NestJS** para todos los servicios iniciales

### Motivos
- acelera desarrollo paralelo por agentes IA;
- tipado fuerte extremo a extremo;
- ecosistema amplio para APIs, colas, validación y observabilidad;
- mantiene homogeneidad entre backend y frontend.

## Frontend
- **Next.js**
- **React**
- **TypeScript**
- **shadcn/ui**
- **TanStack Query**
- **Monaco Editor** para edición avanzada de prompts y JSON

## Datos e infraestructura
- **PostgreSQL 17** como base principal
- **pgvector** para búsqueda vectorial
- **Redis** para caché, locks, rate limiting e idempotencia
- **NATS JetStream** para eventos internos y colas livianas
- **MinIO / S3-compatible storage** para documentos y archivos
- **OpenTelemetry** para trazas, métricas y logs

## Evolución futura opcional
- Temporal para durable workflows si la complejidad operacional crece de forma importante.

---

## 7. Diseño de servicios

## 7.1 `channel-gateway-service`

### Responsabilidades
- conectar WhatsApp, Instagram, Messenger, Email y futuros canales;
- recibir webhooks directos de cada proveedor;
- validar firmas, autenticidad y permisos;
- normalizar eventos entrantes a un modelo común;
- enviar mensajes salientes;
- manejar delivery status, retries, rate limits e idempotencia;
- administrar cuentas, números, páginas, bandejas y credenciales por canal.

### Entradas
- webhooks de proveedores de canal;
- solicitudes internas de envío desde Parallly.

### Salidas
- eventos internos normalizados;
- mensajes salientes al canal;
- estados de entrega;
- errores y métricas operativas.

### Módulos internos
- `webhook-ingest`
- `signature-validator`
- `channel-normalizer`
- `outbound-dispatcher`
- `delivery-tracker`
- `rate-limit-manager`
- `credential-manager`

---

## 7.2 `conversation-service`

### Responsabilidades
- crear y mantener conversaciones internas;
- almacenar mensajes, adjuntos, notas internas y estados;
- manejar asignación a humano, cierre, reapertura y prioridad;
- soportar inbox unificado;
- exponer timeline completa de conversación;
- mantener SLA, ownership, tags y bandejas.

### Entidades sugeridas
- `inbox`
- `conversation`
- `conversation_participant`
- `message`
- `message_attachment`
- `internal_note`
- `conversation_assignment`
- `conversation_status_history`
- `conversation_tag`
- `conversation_sla`

---

## 7.3 `crm-service`

### Responsabilidades
- administrar ficha del cliente;
- gestionar leads, oportunidades y pipeline;
- guardar atributos personalizados, etiquetas y preferencias;
- registrar actividades, tareas y seguimiento;
- conectar objetos de negocio como cotizaciones, reservas o pagos;
- servir de fuente operativa para ventas y soporte.

### Entidades sugeridas
- `contact`
- `lead`
- `opportunity`
- `pipeline`
- `pipeline_stage`
- `crm_task`
- `crm_activity`
- `quote`
- `reservation`
- `payment`
- `custom_field`

---

## 7.4 `identity-service`

### Responsabilidades
- crear y mantener `customer_profile` maestro;
- almacenar identidades por canal;
- hacer matching determinístico y ponderado;
- ejecutar merges automáticos cuando la certeza sea clara;
- generar sugerencias cuando la certeza no sea suficiente;
- permitir unmerge;
- exponer perfil y contexto del cliente.

### Estrategia de matching

#### Determinístico fuerte
- teléfono exacto;
- documento exacto;
- email exacto.

#### Determinístico medio
- nombre completo exacto + evidencia contextual;
- email normalizado + alias conocidos.

#### Ponderado
- similitud de nombre;
- coincidencia parcial de email;
- misma reserva/pago/contexto;
- misma referencia externa.

### Política sugerida de merge
- score >= 0.95 → auto-merge
- score >= 0.75 y < 0.95 → sugerencia de revisión
- score < 0.75 → no sugerir

---

## 7.5 `chat-orchestration-service`

### Responsabilidades
- consumir eventos normalizados desde `channel-gateway-service`;
- cargar contexto conversacional, CRM e identidad;
- obtener configuración activa del agente;
- decidir acción del agente;
- invocar skills;
- producir respuesta multicanal;
- ejecutar handoff a humano;
- emitir eventos internos;
- registrar trazas y métricas.

### Entradas
- eventos internos de canal;
- callbacks de skills;
- solicitudes internas de simulación o runtime.

### Salidas
- respuestas al `conversation-service`;
- solicitudes de envío al `channel-gateway-service`;
- notas internas;
- cambios de estado conversacional;
- eventos a `notification-service`;
- logs y trazas.

### Reglas clave
- siempre usar configuración publicada, nunca drafts;
- idempotencia por `external_message_id` + `channel_account_id`;
- retries seguros en operaciones externas;
- timeout por fase;
- fallback a handoff humano si el flujo falla.

---

## 7.6 `knowledge-service`

### Responsabilidades
- ingestión de documentos y URLs;
- extracción de texto;
- chunking;
- embeddings;
- indexación en pgvector;
- retrieval semántico;
- filtros por colección, canal o agente;
- reindexación;
- versionado de fuentes.

### Fuentes soportadas en fase inicial
- PDF
- URLs
- notas manuales
- FAQs
- Google Drive

### Decisiones base
- usar PostgreSQL + pgvector;
- usar por defecto `text-embedding-3-small`;
- permitir `text-embedding-3-large` para colecciones críticas;
- exponer dimensiones configurables desde frontend.

---

## 7.7 `config-service`

### Responsabilidades
- administrar agentes;
- versionar configuración;
- mantener prompts, políticas, modelos, skills y bindings de conocimiento;
- manejar herencia global y overrides por canal;
- soportar draft, review, publish y rollback;
- versionar reglas de enrutamiento, asignación y operación del inbox.

### Ciclo de vida recomendado
- Draft
- In Review
- Published
- Archived

### Regla crítica
Cada ejecución de automatización debe referenciar un `agent_version_id` específico e inmutable.

---

## 7.8 `notification-service`

### Responsabilidades
- enviar SMS y Email de notificación;
- manejar proveedores y fallback;
- usar plantillas versionadas;
- reintentos y delivery status;
- rate limiting;
- deduplicación.

### Casos de uso iniciales
- pago pendiente;
- validación crítica;
- recordatorio importante;
- fallback de contacto;
- confirmación relevante.

---

## 8. Diseño del frontend guiado y operativo

## Objetivo
Ofrecer una experiencia simple para técnicos y administradores de negocio, evitando editores de flujo complejos y centralizando la operación humana en Parallly.

## Pantallas principales

### 8.1 Dashboard
- salud del sistema;
- conversaciones automáticas vs humanas;
- tasa de handoff;
- uso por canal;
- latencia;
- errores recientes;
- estado de indexación;
- notificaciones recientes;
- métricas comerciales.

### 8.2 Inbox multicanal
- bandejas activas;
- conversaciones abiertas, pendientes, cerradas y escaladas;
- filtros por canal, prioridad, estado, equipo y agente;
- vista timeline completa;
- notas internas;
- tags;
- asignación manual y automática;
- SLA y tiempos de respuesta.

### 8.3 CRM
- perfil unificado del cliente;
- contactos;
- leads;
- oportunidades;
- pipeline comercial;
- tareas y actividades;
- atributos personalizados;
- historial consolidado.

### 8.4 Configuración de agente (wizard)

#### Paso 1: Objetivo
- ventas
- soporte
- mixto

#### Paso 2: Canales activos
- WhatsApp
- Instagram
- Messenger
- Email
- SMS-notification

#### Paso 3: Comportamiento global
- idioma base
- tono
- formalidad
- objetivo
- restricciones
- longitud de respuesta
- reglas de seguridad

#### Paso 4: Diferencias por canal
- usar comportamiento global para todos
- o activar overrides por canal

#### Paso 5: Modelo
- proveedor
- modelo
- temperatura/creatividad
- top_p
- max tokens
- timeout
- fallback model

#### Paso 6: Skills
- seleccionar skills habilitados
- prioridad
- auto/manual
- timeout
- permisos por canal

#### Paso 7: Conocimiento
- subir PDF
- agregar URL
- agregar nota
- agregar FAQ
- conectar Google Drive
- elegir colección
- elegir si el conocimiento es global o por canal

#### Paso 8: Pruebas
- simular conversación
- correr casos predefinidos
- comparar contra versión publicada

#### Paso 9: Publicación
- guardar draft
- enviar a revisión
- aprobar
- publicar
- rollback

### 8.5 Gestión de identidad
- ver perfil unificado;
- ver identidades por canal;
- revisar sugerencias de merge;
- aprobar/rechazar;
- unmerge;
- editar preferencias.

### 8.6 Gestión de conocimiento
- colecciones;
- fuentes;
- estado de indexación;
- tamaño estimado;
- costo estimado;
- reindexación manual.

### 8.7 Notificaciones
- plantillas SMS;
- plantillas Email;
- proveedor por defecto;
- fallback;
- reglas de activación;
- vista de entregas.

### 8.8 Versiones
- ver cambios entre versiones;
- comparar prompts;
- comparar parámetros;
- restaurar una versión anterior.

---

## 9. Skills iniciales recomendados

### Core
- `detect_language`
- `classify_intent`
- `retrieve_knowledge`
- `summarize_conversation`
- `handoff_to_human`
- `check_customer_identity`
- `update_crm_tags`
- `update_crm_attributes`
- `create_internal_note`

### Ventas
- `lead_capture`
- `quote_builder`
- `availability_lookup`
- `pricing_lookup`
- `sales_followup_scheduler`

### Soporte
- `ticket_classifier`
- `faq_resolution`
- `status_lookup`
- `important_notification`

---

## 10. Modelo de datos inicial

## 10.1 Tablas de configuración
- `agents`
- `agent_versions`
- `prompts`
- `prompt_versions`
- `model_profiles`
- `generation_policies`
- `channel_overrides`
- `skill_definitions`
- `skill_bindings`
- `knowledge_bindings`
- `approval_requests`

## 10.2 Tablas de identidad
- `customer_profiles`
- `channel_identities`
- `identity_evidences`
- `merge_reviews`
- `merge_events`
- `customer_preferences`

## 10.3 Tablas conversacionales
- `inboxes`
- `channel_accounts`
- `channel_endpoints`
- `conversations`
- `conversation_participants`
- `messages`
- `message_attachments`
- `message_delivery_status`
- `internal_notes`
- `conversation_assignments`
- `conversation_status_history`
- `conversation_tags`
- `conversation_sla`

## 10.4 Tablas CRM
- `contacts`
- `leads`
- `opportunities`
- `pipelines`
- `pipeline_stages`
- `opportunity_stage_history`
- `crm_tasks`
- `crm_activities`
- `crm_custom_fields`
- `crm_field_values`
- `quotes`
- `reservations`
- `payments`
- `customer_segments`

## 10.5 Tablas de ejecución y runtime
- `message_events`
- `automation_runs`
- `automation_steps`
- `handoff_events`
- `runtime_errors`
- `routing_rules`
- `assignment_rules`
- `work_queues`

## 10.6 Tablas de conocimiento
- `knowledge_collections`
- `knowledge_sources`
- `knowledge_documents`
- `knowledge_chunks`
- `embedding_records`
- `index_jobs`

## 10.7 Tablas de notificaciones
- `notification_templates`
- `notification_requests`
- `notification_deliveries`
- `provider_bindings`

## 10.8 Tablas operativas y seguridad
- `users`
- `roles`
- `permissions`
- `api_keys`
- `audit_logs`
- `idempotency_keys`

---

## 11. Eventos internos sugeridos

### Entrantes
- `channel.message.received`
- `channel.message.delivery.updated`
- `channel.contact.updated`
- `channel.connection.failed`
- `channel.connection.restored`

### Conversación
- `conversation.created`
- `conversation.updated`
- `conversation.assigned`
- `conversation.handoff.requested`
- `conversation.closed`

### CRM
- `crm.contact.created`
- `crm.lead.created`
- `crm.opportunity.updated`
- `crm.task.created`

### Dominio
- `identity.customer.resolved`
- `identity.merge.suggested`
- `identity.merge.completed`
- `identity.merge.reverted`
- `knowledge.index.completed`
- `knowledge.index.failed`
- `agent.response.generated`
- `notification.requested`
- `notification.delivered`
- `notification.failed`
- `config.version.published`

---

## 12. API inicial sugerida

## 12.1 Channel Gateway Service
- `POST /webhooks/whatsapp`
- `POST /webhooks/instagram`
- `POST /webhooks/messenger`
- `POST /webhooks/email`
- `POST /channels/:channelId/send`
- `GET /channels`
- `POST /channels`
- `PATCH /channels/:id`
- `GET /channel-accounts`

## 12.2 Conversation Service
- `GET /conversations`
- `GET /conversations/:id`
- `POST /conversations/:id/assign`
- `POST /conversations/:id/notes`
- `POST /conversations/:id/tags`
- `POST /conversations/:id/messages`
- `POST /conversations/:id/close`
- `POST /conversations/:id/reopen`

## 12.3 CRM Service
- `GET /contacts`
- `POST /contacts`
- `GET /contacts/:id`
- `PATCH /contacts/:id`
- `GET /leads`
- `POST /leads`
- `GET /opportunities`
- `POST /opportunities`
- `PATCH /opportunities/:id/stage`
- `POST /crm/tasks`
- `GET /crm/pipelines`

## 12.4 Identity Service
- `POST /identity/resolve`
- `POST /identity/merge`
- `POST /identity/unmerge`
- `GET /identity/customers/:id`
- `GET /identity/merge-reviews`
- `POST /identity/merge-reviews/:id/approve`
- `POST /identity/merge-reviews/:id/reject`

## 12.5 Config Service
- `GET /agents`
- `POST /agents`
- `GET /agents/:id`
- `POST /agents/:id/drafts`
- `POST /agents/:id/review`
- `POST /agents/:id/publish`
- `POST /agents/:id/rollback`
- `GET /agents/:id/versions`

## 12.6 Knowledge Service
- `POST /knowledge/collections`
- `POST /knowledge/sources/pdf`
- `POST /knowledge/sources/url`
- `POST /knowledge/sources/note`
- `POST /knowledge/sources/faq`
- `POST /knowledge/sources/google-drive`
- `POST /knowledge/reindex/:collectionId`
- `POST /knowledge/search`

## 12.7 Notification Service
- `POST /notifications/send`
- `GET /notifications/templates`
- `POST /notifications/templates`
- `GET /notifications/deliveries`

## 12.8 Chat Orchestration Service
- `POST /runtime/simulate`
- `GET /runtime/runs/:id`

---

## 13. Herencia global y overrides por canal

## Regla base
Toda configuración se define primero a nivel global.

### Configuración global
- prompt base
- modelo base
- temperature
- policies
- skills activados
- conocimiento asignado
- reglas de handoff
- reglas de asignación
- reglas de enrutamiento

### Override por canal (opcional)
- prompt adicional por canal
- tono distinto
- skills extra o deshabilitados
- colección de conocimiento distinta
- límites distintos
- reglas de handoff distintas
- restricciones operativas específicas

---

## 14. Seguridad y robustez

### Seguridad
- autenticación centralizada para frontend y APIs administrativas;
- autorización por rol;
- secrets fuera del código;
- cifrado de secretos sensibles;
- validación de firmas de webhooks;
- expiración y rotación de credenciales;
- rate limiting.

### Robustez
- idempotencia para eventos entrantes;
- retries con backoff exponencial;
- dead-letter handling para fallos persistentes;
- timeouts por integraciones;
- circuit breakers para servicios externos;
- fallback a humano si el motor falla;
- versionado inmutable de configuración publicada.

### Observabilidad
- trazas distribuidas;
- métricas por servicio;
- correlación por `trace_id` y `conversation_id`;
- dashboards operativos;
- alertas por errores y latencia.

---

## 15. SMS y Email de notificaciones

## Reglas de uso
- no usar SMS como canal conversacional principal;
- usarlo solo para notificaciones importantes;
- permitir fallback a Email;
- todas las plantillas deben configurarse desde frontend.

---

## 16. Roadmap de implementación

## Fase 0 — Fundaciones
- repositorio mono o polyrepo definido;
- CI/CD básico;
- PostgreSQL, Redis, NATS y Storage operativos;
- OpenTelemetry base;
- auth del panel.

## Fase 1 — Núcleo conversacional propio
- `channel-gateway-service`
- `conversation-service`
- `crm-service` mínimo viable
- `identity-service` mínimo viable
- inbox propio mínimo funcional
- writeback completo a canales

## Fase 2 — Configuración y automatización
- `config-service` con draft/publish/rollback
- `chat-orchestration-service`
- frontend wizard básico
- handoff a humano dentro de Parallly

## Fase 3 — Conocimiento
- `knowledge-service`
- ingestión PDF/URL/notas/FAQ
- embeddings en pgvector
- configuración desde frontend

## Fase 4 — Skills y operación avanzada
- runtime de skills
- políticas más finas
- notas internas inteligentes
- reglas de asignación y colas
- SLA y métricas operativas

## Fase 5 — Notificaciones y negocio
- `notification-service`
- SMS con Twilio
- Email de notificaciones
- plantillas y fallback
- pipeline comercial y seguimiento avanzado

## Fase 6 — Extensiones
- segundo proveedor SMS
- conectores opcionales a terceros
- workflows durables avanzados si se requieren

---

## 17. Distribución sugerida de trabajo para agentes IA

## Agente A — Arquitectura backend
- contratos entre servicios
- estructura de proyectos
- librerías compartidas
- modelo de eventos

## Agente B — Identity Service
- esquema de datos
- matching engine
- merge workflows
- endpoints

## Agente C — Channel Gateway + Conversation
- webhook ingestion
- adaptadores por canal
- inbox runtime
- message delivery

## Agente D — CRM Service
- esquema de datos
- leads y oportunidades
- pipeline
- tareas y actividades

## Agente E — Chat Orchestration
- runtime policy resolution
- agent execution
- handoff
- integración con CRM/conversation

## Agente F — Knowledge Service
- ingestión
- chunking
- embeddings
- retrieval
- indexación

## Agente G — Config Service
- versionado
- draft/review/publish
- overrides por canal
- rollback

## Agente H — Frontend
- dashboard
- inbox
- CRM
- wizard guiado
- versiones
- identidad
- conocimiento
- notificaciones

## Agente I — Infra/DevOps
- docker compose inicial
- entornos
- observabilidad
- CI/CD
- secrets

---

## 18. Criterios de aceptación globales

1. Un mensaje entrante desde cualquier canal soportado puede:
   - resolverse a identidad unificada;
   - abrir o continuar una conversación interna propia;
   - cargar configuración publicada correcta;
   - usar conocimiento y skills;
   - responder o escalar;
   - reflejarse en el inbox de Parallly con mensaje, nota, tags y contexto CRM.

2. Un administrador puede:
   - crear un agente guiado;
   - dejar comportamiento global;
   - añadir diferencia por canal opcional;
   - elegir modelo y parámetros;
   - activar conocimiento;
   - publicar con aprobación;
   - hacer rollback.

3. Un operador humano puede:
   - atender conversaciones desde el inbox de Parallly;
   - ver el historial consolidado del cliente;
   - agregar notas y etiquetas;
   - actualizar estado CRM;
   - asumir, transferir o cerrar conversaciones.

4. El sistema puede:
   - sugerir merges;
   - auto-mergear en alta certeza;
   - deshacer merges;
   - enviar notificaciones SMS/Email;
   - trazar y auditar la ejecución.

---

## 19. Decisiones cerradas


- Parallly será el CRM propio.
- Parallly será el inbox multicanal propio.
- El frontend será guiado, no constructor visual complejo.
- La configuración será global con overrides por canal opcionales.
- El sistema será para Parallly, no multi-tenant real al inicio.
- El foco principal es ventas y soporte.
- SMS se usará para notificaciones importantes, con configuración visual.
- Stack inicial homogéneo: TypeScript + NestJS + Next.js + PostgreSQL + pgvector + Redis + NATS.

---

## 20. Próximo entregable recomendado

A partir de esta especificación, el siguiente nivel de detalle debe ser:

1. esquema SQL inicial;
2. contratos OpenAPI por servicio;
3. contratos de eventos;
4. estructura de repositorio;
5. blueprint del frontend;
6. historias de usuario por módulo;
7. plan de implementación por sprint.
