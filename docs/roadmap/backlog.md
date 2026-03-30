# Parallly — Backlog técnico ejecutable
## Basado en el estado actual del sistema + ajustes requeridos para el producto objetivo

### 1. Propósito de este backlog
Este backlog traduce el análisis del sistema actual a un plan de ejecución concreto para llevar la base existente hacia Parallly como producto interno enterprise-ready para captura, nutrición, calificación y preparación de leads para cierre comercial. Está diseñado para que un agente de código pueda trabajar por módulos, con dependencias claras, criterios de aceptación y prioridades.

### 2. Resumen de la brecha entre lo actual y lo objetivo
La base actual ya cubre buena parte del motor conversacional, multitenancy, canales, knowledge, analytics, handoff, broadcast, inbox y pipeline conversacional. Lo que falta no es “hacer todo de cero”, sino reencuadrar el sistema hacia dominio comercial de leads y cursos, cerrar bloqueantes técnicos y separar correctamente el intake web del core de producto.

#### Lo ya aprovechable
- Arquitectura base en Next.js + NestJS + PostgreSQL + Redis sobre VPS.
- Multitenancy.
- Canales y webhook Meta.
- Conversations, pipeline engine, handoff, broadcast.
- Knowledge / pgvector.
- Dashboard con inbox, pipeline, contacts, analytics y settings.
- Integraciones operativas ya iniciadas para catálogo, pedidos, reglas y memoria.

#### Lo que debe refactorizarse o completarse para Parallly
- Formalizar dominios de Lead, Opportunity, Campaign, Course, Consent y Opt-out.
- Desacoplar la landing/formulario como módulo de intake separado.
- Implementar providers reales LLM.
- Convertir el pipeline actual de conversaciones a pipeline comercial.
- Aterrizar scoring, intención, handoff y dashboards comerciales.
- Pasar métricas mock a métricas reales.
- Definir panel de configuración comercial y de IA.
- Completar seguridad, compliance, auditoría y supresión/borrado.
- Añadir suite mínima de tests en partes críticas.

### 3. Decisión estructural clave
La landing y el formulario no deben quedar como núcleo del producto. Deben convertirse en un módulo desprendible:

**Módulo: Intake / Landing**
Responsable solo de:
- landing clonada o plantilla fija configurable
- captura de formulario
- validaciones
- consentimiento
- UTMs y attribution
- disparo de evento LeadCaptured

Todo lo demás debe vivir en el core de Parallly.

### 4. Arquitectura de dominios objetivo

#### Núcleo de producto
1. Identity & Access
2. Tenant & White-label
3. Intake / Landing
4. Lead Management
5. Opportunity & Pipeline
6. Campaign Management
7. Course Catalog
8. Conversational Inbox
9. WhatsApp Integration
10. Email Integration
11. Carla AI Sales Agent
12. Knowledge Base / RAG
13. Workflow & Automation Engine
14. Analytics & Reporting
15. Compliance & Consent
16. Audit & Operational Logs

### 5. Principios de ejecución
- No rehacer módulos ya maduros si pueden refactorizarse.
- Mantener monolito modular al inicio.
- Hacer primero lo bloqueante para operar con leads reales.
- Todo flujo clave debe dejar evento auditado.
- Toda automatización debe ser parametrizable.
- La IA no debe incrustar reglas comerciales hardcoded.
- El dashboard debe priorizar velocidad operativa y claridad visual.
- El módulo Intake debe poder separarse luego sin romper el core.

### 6. Orden recomendado de construcción
Orden macro:
1. Asegurar base técnica bloqueante.
2. Formalizar dominio comercial.
3. Separar intake web.
4. Conectar WhatsApp/email sobre el dominio nuevo.
5. Implementar Carla y scoring.
6. Completar dashboards y métricas reales.
7. Hardening y compliance.
8. Tests mínimos críticos.

---

# Épica 0 — Baseline, saneamiento y decisión de arquitectura

## Objetivo
Congelar el estado actual, documentar contratos, cerrar huecos del monorepo y dejar una línea base confiable antes de extender.

## Historias

### E0-H1. Auditoría técnica final del repositorio
**Tareas**
- Mapear todos los módulos backend existentes.
- Confirmar carpetas stub o incompletas.
- Validar qué páginas del dashboard usan datos reales vs mock.
- Confirmar entidades Prisma actuales y relaciones.
- Confirmar estrategia actual multi-tenant real en código.
- Confirmar qué adapters de canales están realmente operativos.

**Criterios de aceptación**
- Documento técnico de inventario de módulos.
- Matriz “usable / refactor / reemplazar / descartar”.
- Lista de endpoints existentes reutilizables.

### E0-H2. Normalización del dominio base
**Tareas**
- Definir glosario oficial: lead, contact, company, opportunity, campaign, course, conversation, consent, task, handoff.
- Decidir si `contacts` actuales se transforman en `leads` o si conviven ambos.
- Decidir correspondencia entre pipeline conversacional actual y pipeline comercial nuevo.
- Definir naming conventions de backend y frontend.

**Criterios de aceptación**
- Glosario aprobado.
- Mapa de migración de nombres y tablas.

### E0-H3. Plan de refactor sin romper producción interna
**Tareas**
- Definir feature flags o aislamiento por rutas para módulos nuevos.
- Crear estrategia de migración incremental.
- Definir qué módulos quedan “legacy-compatible”.

**Criterios de aceptación**
- Plan de transición por release.
- Sin cambios destructivos no controlados.

---

# Épica 1 — Dominio comercial de Parallly

## Objetivo
Crear el modelo de negocio real del producto sobre la base existente.

## Historias

### E1-H1. Modelo de datos comercial
**Tareas**
- Crear o adaptar entidades:
  - Lead
  - Company
  - Opportunity
  - Campaign
  - Course
  - Tag
  - Task
  - Note
  - ConsentRecord
  - OptOutRecord
- Añadir campos:
  - score 1–10
  - is_vip
  - preferred_contact
  - primary_intent / secondary_intent
  - stage comercial
  - attribution UTM
  - source/referrer
- Relacionar conversación con lead y opportunity.

**Criterios de aceptación**
- Esquema Prisma actualizado.
- Migraciones funcionales.
- Seeder mínimo.

### E1-H2. Reglas del pipeline comercial
**Tareas**
- Implementar etapas:
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
- Permitir transición automática y manual.
- Registrar SLA por etapa.
- Permitir reversión de etapa por humano.

**Criterios de aceptación**
- Pipeline visual y API consistentes.
- Cambios auditados.

### E1-H3. Asignación y ownership
**Tareas**
- Asignación por campaña.
- Asignación por curso.
- Reasignación manual.
- Transferencia entre agentes.
- Carga visible por agente.

**Criterios de aceptación**
- Las oportunidades nuevas quedan correctamente asignadas.
- Las transferencias conservan historial.

---

# Épica 2 — Módulo Intake / Landing desacoplable

## Objetivo
Separar la landing y el formulario como disparador de entrada, no como corazón del sistema.

## Historias

### E2-H1. Landing clonada configurable
**Tareas**
- Crear módulo o app separable para landing.
- Soportar plantilla fija configurable por curso/campaña.
- Clonar contenido actual de referencia.
- Mantener branding configurable por tenant si se requiere.
- Preparar publicación independiente del core.

**Criterios de aceptación**
- La landing funciona sin depender del dashboard.
- Puede emitir leads al core vía API/evento.

### E2-H2. Formulario de captura
**Tareas**
- Replicar campos actuales del formulario.
- Validación frontend + backend.
- Normalización de teléfono/email.
- Detección de duplicados.
- Update de ficha si lead ya existe.
- Guardar selected course / selected campaign.
- Guardar preferred contact aunque WhatsApp siempre dispare.

**Criterios de aceptación**
- Un submit válido crea o actualiza lead + opportunity.
- Duplicados no crean caos de datos.

### E2-H3. Consentimiento y trazabilidad
**Tareas**
- Guardar:
  - versión del texto legal
  - snapshot del texto
  - IP
  - user agent
  - URL origen
  - timestamp
- Asociar consentimiento por canal.

**Criterios de aceptación**
- Todo lead captado desde landing tiene ConsentRecord completo.

### E2-H4. Attribution
**Tareas**
- Capturar UTMs, referrer, gclid/fbclid si aplica.
- Persistir source/campaign metadata.
- Exponerlo en lead detail y analytics.

**Criterios de aceptación**
- Un lead puede trazarse hasta fuente/campaña.

### E2-H5. Evento de dominio
**Tareas**
- Emitir `LeadCaptured`.
- Consumirlo desde motor de automatización.
- Trazar todos los errores de ingestión.

**Criterios de aceptación**
- Submit correcto dispara evento y queda en audit log.

---

# Épica 3 — Integración WhatsApp y Email orientada a lead gen

## Objetivo
Conectar el intake y el dominio comercial con mensajería real y trazable.

## Historias

### E3-H1. WhatsApp template trigger
**Tareas**
- Consumir `LeadCaptured`.
- Validar horario de oficina.
- Aplicar espera configurable.
- Enviar plantilla de marketing por curso.
- Registrar message template, estado, error y respuesta Meta.
- Mostrar trazabilidad completa en timeline.

**Criterios de aceptación**
- Todo lead válido genera intento de primer contacto por WhatsApp.

### E3-H2. Fallback email
**Tareas**
- Si falla WhatsApp, evaluar regla de fallback.
- Enviar correo por curso/campaña.
- Registrar entrega y error.
- Exponer resultado en timeline.

**Criterios de aceptación**
- Fallos de WhatsApp no dejan lead sin contacto si fallback está activo.

### E3-H3. Panel Meta / canales
**Tareas**
- Configuración de webhook.
- Verify token.
- Callback URL.
- Visualización de eventos entrantes.
- Logs de validación.
- Panel de número / plantillas / estado.
- Preparación futura para BSP.

**Criterios de aceptación**
- Admin puede revisar y diagnosticar integración desde UI.

### E3-H4. Email templates por curso
**Tareas**
- Crear gestión de plantillas email.
- Asociarlas a curso/campaña.
- Variables dinámicas.
- Estados de activación.

**Criterios de aceptación**
- Cada curso puede definir su fallback email.

---

# Épica 4 — Inbox conversacional comercial

## Objetivo
Convertir el inbox existente en un inbox centrado en lead, opportunity y cierre.

## Historias

### E4-H1. Conversation-to-opportunity mapping
**Tareas**
- Toda conversación debe enlazar a un lead.
- Toda conversación comercial activa debe poder enlazar a una opportunity.
- Mostrar score, etapa y curso dentro de la vista conversacional.

**Criterios de aceptación**
- El agente ve contexto comercial sin cambiar de pantalla.

### E4-H2. Vista detalle de lead
**Tareas**
- Panel lateral o pantalla con:
  - perfil
  - score
  - etapa
  - etiquetas
  - campaña
  - curso
  - timeline
  - consentimientos
  - historial de mensajes
  - tareas
  - notas
- Filtros rápidos.

**Criterios de aceptación**
- Un asesor puede entender el caso completo en una sola vista.

### E4-H3. Notas, tareas y handoff interno
**Tareas**
- Crear tarea automática al entrar a score alto.
- Notas internas separadas del chat con cliente.
- Transferencia entre agentes.
- Alertas por SLA.

**Criterios de aceptación**
- El handoff de Carla al humano queda operativo y claro.

### E4-H4. Etiquetas controladas
**Tareas**
- Catálogo controlado por tenant.
- Etiquetas por lead y opportunity.
- Uso en filtros y analytics.

**Criterios de aceptación**
- Etiquetado consistente y explotable.

---

# Épica 5 — Carla AI Sales Agent

## Objetivo
Pasar del motor conversacional general a un agente comercial específico para cursos.

## Historias

### E5-H1. Providers reales de LLM
**Tareas**
- Implementar adapters reales:
  - OpenAI
  - Anthropic
  - Gemini
  - DeepSeek
- Conectar llm-router.
- Añadir fallback chain.
- Manejo de errores, timeouts y observabilidad funcional.
- Guardar costo/token por interacción.

**Criterios de aceptación**
- El router no solo decide, también ejecuta llamadas reales.

### E5-H2. Prompt y políticas de Carla
**Tareas**
- Definir system prompt base.
- Tono corporativo y orientado al cierre.
- Permitir precio.
- Prohibir link de pago.
- Permitir descuentos solo en contexto de grupo si existe regla.
- Parametrizar reglas comerciales.

**Criterios de aceptación**
- El prompt es versionable y configurable.

### E5-H3. Intención y scoring híbrido
**Tareas**
- Detectar:
  - precio
  - fechas
  - modalidad
  - duración
  - certificación
  - financiación
  - objeción económica
  - objeción tiempo
  - hablar con humano
  - no interesado
- Calcular score híbrido:
  - pregunta precio
  - confirma datos
  - pregunta fecha de inicio
  - pregunta medios de pago
  - responde rápido
  - grupo / varios cursos / varios cupos
- Marcar caliente desde 7.
- Marcar listo para cierre desde 9.

**Criterios de aceptación**
- Cada mensaje relevante puede actualizar score e intención.

### E5-H4. Handoff sutil
**Tareas**
- Crear trigger de handoff para:
  - score >= 9
  - grupo
  - VIP
  - intención clara de compra
  - confirmación de datos
  - consulta de pago
- Generar resumen automático para humano.
- Respuesta sutil de Carla anunciando continuidad.

**Criterios de aceptación**
- El humano entra con contexto suficiente y sin corte brusco.

### E5-H5. RAG comercial
**Tareas**
- Consumir FAQs, fichas, precios, brochures y políticas.
- Recuperación con contexto por curso.
- Panel de aprobación/versionado.
- Soporte para PDF, texto y FAQ manual.

**Criterios de aceptación**
- Carla responde con base documental, no improvisando.

---

# Épica 6 — Workflow & Automation Engine

## Objetivo
Hacer parametrizable el comportamiento comercial.

## Historias

### E6-H1. Reglas de envío
**Tareas**
- Espera configurable.
- Ventana horaria.
- Límite de intentos.
- Reintentos opcionales.
- Fallback email.
- Ramas por canal.

**Criterios de aceptación**
- El flujo inicial se ajusta sin tocar código.

### E6-H2. Reglas de nurturing
**Tareas**
- Secuencias si no responde.
- Máximo 3 intentos.
- Branches por intención.
- Crear tareas humanas por silencio o score.

**Criterios de aceptación**
- Se pueden definir automatizaciones comerciales básicas.

### E6-H3. Panel de automatización
**Tareas**
- Revisar `/admin/automation`.
- Construir si está incompleto.
- UI para triggers, waits, branches y acciones.

**Criterios de aceptación**
- Un admin puede editar reglas clave de nurturing.

---

# Épica 7 — Analytics & Reporting

## Objetivo
Convertir analytics general en analytics comercial real.

## Historias

### E7-H1. Métricas reales del dashboard
**Tareas**
- Reemplazar mocks actuales por consultas reales.
- Métricas:
  - leads nuevos
  - contactados
  - respondieron
  - calientes
  - listos para cierre
  - costo LLM
  - mensajes procesados
  - handoffs
  - oportunidades por etapa

**Criterios de aceptación**
- Dashboard principal sin cifras hardcoded.

### E7-H2. Dashboard ejecutivo
**Tareas**
- KPIs comerciales.
- Cohortes.
- Funnel por etapa.
- Rendimiento por curso/campaña/canal.
- Forecast.

**Criterios de aceptación**
- Vista para gerencia disponible y exportable.

### E7-H3. Dashboard operativo
**Tareas**
- Conversaciones activas.
- Tareas vencidas.
- SLA en riesgo.
- handoffs pendientes.
- score promedio.
- errores de integración.

**Criterios de aceptación**
- Supervisión diaria operativa.

### E7-H4. Dashboard IA
**Tareas**
- conversaciones atendidas por Carla
- tasa de handoff
- score generado
- intenciones
- costo por conversación
- correcciones humanas

**Criterios de aceptación**
- Se puede evaluar rendimiento real de Carla.

### E7-H5. Dashboard campañas
**Tareas**
- volumen por campaña
- respuesta
- conversión a caliente
- conversión a listo para cierre
- costo estimado IA + mensajería

**Criterios de aceptación**
- Marketing/comercial pueden comparar campañas.

---

# Épica 8 — Compliance, opt-out y seguridad funcional

## Objetivo
Cubrir trazabilidad comercial mínima seria y cumplimiento operativo.

## Historias

### E8-H1. Opt-out
**Tareas**
- Detectar STOP, BAJA, NO QUIERO, ELIMINAR.
- Bloquear comunicación comercial automatizada del canal.
- Registrar OptOutRecord.
- Evitar futuros envíos.

**Criterios de aceptación**
- Un usuario dado de baja no recibe nuevas secuencias automáticas.

### E8-H2. Borrado bajo solicitud
**Tareas**
- Flujo administrativo para supresión.
- Registro de solicitud.
- Borrado/anominización según política.
- Preservar mínimo rastro legal si aplica.

**Criterios de aceptación**
- Tenant puede gestionar solicitudes formalmente.

### E8-H3. Auditoría
**Tareas**
- Registrar:
  - cambios de etapa
  - reasignación
  - envío de mensajes
  - fallos de webhook
  - cambios de reglas IA
  - consentimientos
- Vista interna de audit trail.

**Criterios de aceptación**
- Eventos críticos trazables.

### E8-H4. SSO y seguridad de acceso
**Tareas**
- Definir proveedor SSO.
- Flujos de acceso enterprise.
- Permisos por rol.
- separación por tenant.

**Criterios de aceptación**
- Acceso robusto para operación empresarial.

---

# Épica 9 — Hardening técnico mínimo

## Objetivo
Reducir riesgo operativo del sistema actual.

## Historias

### E9-H1. Tests críticos
**Tareas**
- tests de integración para:
  - lead capture
  - whatsapp trigger
  - fallback email
  - scoring update
  - handoff
  - webhook inbound
- tests mínimos del pipeline central.

**Criterios de aceptación**
- Suite básica ejecutable en CI.

### E9-H2. Documentación viva mínima
**Tareas**
- API reference real.
- Security notes reales.
- README de módulos.
- Runbooks básicos de webhook y LLM.

**Criterios de aceptación**
- Otro desarrollador puede operar el sistema.

### E9-H3. Rate limiting y metering
**Tareas**
- rate limiting por tenant
- usage de tokens y mensajes
- visibilidad en analytics

**Criterios de aceptación**
- Base lista para futura monetización / control de abuso.

---

# Épica 10 — UI/UX productization

## Objetivo
Llevar el dashboard actual a una experiencia consistente y premium.

## Historias

### E10-H1. Sistema de navegación consistente
**Tareas**
- Revisar arquitectura de rutas.
- Unificar navegación lateral.
- Unificar headers, breadcrumbs, filtros, estados vacíos y loading.

**Criterios de aceptación**
- Navegación coherente en todas las vistas.

### E10-H2. Rediseño de vistas críticas
**Tareas**
- lead detail
- inbox
- conversation detail
- pipeline
- dashboard ejecutivo
- dashboard operativo
- configuración de campaña
- configuración de Carla

**Criterios de aceptación**
- Las vistas críticas priorizan rapidez y claridad.

### E10-H3. Onboarding y ayuda contextual
**Tareas**
- tooltips
- empty states
- checklists iniciales
- guía de “primer canal”, “primer curso”, “primera campaña”

**Criterios de aceptación**
- Un admin nuevo puede operar sin depender del desarrollador.

---

# Backlog secuenciado por releases

## Release 1 — Base comercial operable
Incluye:
- Épica 0
- Épica 1
- Épica 2
- E3-H1
- E4-H1
- E4-H2
- E5-H1
- E5-H2
- E5-H3 básico
- E7-H1
- E8-H1
- E9-H1 mínimo

**Resultado esperado**
Captura de leads desde landing desacoplada, creación/actualización de lead y opportunity, disparo inicial por WhatsApp, scoring básico y dashboard con métricas reales esenciales.

## Release 2 — Conversión asistida por IA
Incluye:
- resto de Épica 3
- resto de Épica 4
- resto de Épica 5
- Épica 6
- E7-H3
- E7-H4
- E8-H3

**Resultado esperado**
Carla operativa, inbox comercial robusto, handoff funcional y automatizaciones configurables.

## Release 3 — Capa ejecutiva y hardening
Incluye:
- E7-H2
- E7-H5
- E8-H2
- E8-H4
- Épica 9 restante
- Épica 10

**Resultado esperado**
Producto más pulido, auditable, presentable internamente y listo para seguir evolucionando a SaaS.

---

# Tareas técnicas inmediatas recomendadas

## Sprint 1
1. Confirmar inventario real del monorepo.
2. Definir modelo Lead/Opportunity/Campaign/Course en Prisma.
3. Diseñar migración desde `contacts` y `conversations`.
4. Crear Intake module separado.
5. Implementar evento `LeadCaptured`.
6. Implementar OpenAI provider primero y conectarlo al router.
7. Reemplazar métricas mock del dashboard principal.
8. Añadir tests del flujo lead capture → trigger WhatsApp.

## Sprint 2
1. Implementar WhatsApp template trigger por curso.
2. Implementar ConsentRecord y OptOutRecord.
3. Enlazar conversación con opportunity.
4. Añadir scoring híbrido inicial.
5. Añadir panel de lead detail.
6. Crear fallback email básico.
7. Añadir resumen para handoff.

## Sprint 3
1. Completar providers restantes.
2. Completar RAG comercial.
3. Crear dashboard operativo.
4. Crear panel de automatización.
5. Añadir tareas automáticas y SLA.

---

# Definiciones operativas obligatorias para el agente de código

## Reglas de negocio
- Score híbrido de 1 a 10.
- Caliente desde 7.
- Listo para cierre desde 9.
- VIP si detecta grupo, varios cursos o varias personas.
- Alto valor si detecta grupo.
- Carla puede dar precio.
- Carla no puede enviar link de pago.
- Carla solo puede ofrecer descuentos/promos si existe regla activa y contexto grupal.
- Handoff a humano debe ser sutil en chat y explícito internamente.
- WhatsApp se intenta siempre al capturar lead.
- Email queda canal disponible para apoyo/fallback.
- La landing debe quedar desacoplada y removable.

## Decisiones técnicas
- Mantener Next.js + NestJS + PostgreSQL + Redis + pgvector.
- Mantener VPS y Docker Compose por ahora.
- Mantener multi-tenant desde la base.
- No partir a microservicios físicos todavía.
- Priorizar monolito modular bien delimitado.

---

# Riesgos principales

1. Extender el sistema actual sin formalizar el dominio comercial puede dejar inconsistencias entre conversación y oportunidad.
2. Si la landing no se desacopla, el producto queda amarrado a una sola entrada y será más difícil convertirlo en producto general.
3. Si no se implementan providers LLM reales, Carla no pasa de arquitectura teórica.
4. Si se mantienen métricas mock, no habrá lectura operativa confiable.
5. Si no se añaden tests mínimos al pipeline crítico, cada cambio puede romper el flujo central.
6. Si no se modela bien consentimiento y opt-out desde el inicio, luego será costoso corregir.

---

# Definición de hecho por módulo

## Un módulo se considera “hecho” cuando:
- tiene modelo de datos o contratos claros
- tiene endpoints o handlers implementados
- tiene UI si aplica
- emite o consume eventos correctamente
- deja trazabilidad y errores
- no depende de mocks para la funcionalidad esencial
- tiene al menos pruebas mínimas del flujo principal
- tiene documentación operativa breve

---

# Instrucción final para el agente de código
Trabaja por releases y no por archivos sueltos. Antes de modificar una vista o servicio, identifica si forma parte del core de Parallly o del Intake / Landing module. No mezcles lógica comercial específica de cursos dentro del motor genérico si puede ir en configuración, reglas o dominio. Prioriza el camino más corto que deje el sistema operable con leads reales y trazabilidad real.
