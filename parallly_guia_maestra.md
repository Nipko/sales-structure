
# Parallly — Guía maestra de alineación del producto, análisis del estado actual y ruta de construcción

**Base:** análisis del monorepo actual + definición funcional acordada para Parallly  
**Fecha:** 2026-03-17

## Resumen ejecutivo
El sistema actual ya tiene una base conversacional y multi-tenant útil, pero hoy sigue orientado a un engine genérico. Para convertirlo en Parallly, el trabajo principal no es rehacer todo, sino reencuadrar el producto, cerrar los vacíos críticos de LLM y copilot, profesionalizar el CRM de leads, separar el intake/landing como módulo independiente y completar los flujos comerciales, analíticos y de cumplimiento.

## 1. Propósito de esta guía
Esta guía une lo que ya existe, lo que falta para el producto objetivo y cómo reorganizar el sistema para que quede profesional, usable, escalable y coherente comercialmente.

## 2. Conclusión del análisis del estado actual
El monorepo auditado ya tiene una estructura fuerte en backend, dashboard, infraestructura y multitenancy. La base actual no debe desecharse. Debe aprovecharse como núcleo técnico sobre el cual se reorienta el producto hacia un CRM conversacional de lead qualification y lead warming para cursos.

### 2.1 Lo que sí conviene conservar
- Arquitectura base: Next.js + NestJS + PostgreSQL + Redis + Docker + Cloudflare Tunnel.
- Modelo multi-tenant ya implementado. Dado que hoy existe schema-per-tenant, conviene mantenerlo en esta fase para evitar una reingeniería temprana.
- Módulos ya útiles para Parallly: auth, tenants, channels, conversations, pipeline, handoff, broadcast, knowledge, persona, analytics, settings, agent-console, redis, prisma y health.
- Dashboard ya avanzado en inbox, pipeline, conversaciones, AI, broadcast, contacts, settings, tenants y users.
- Infraestructura y CI/CD ya listas para seguir construyendo sobre una base productiva.

### 2.2 Lo que no está resuelto y bloquea el producto
- La capa de IA real aún no está terminada: el router existe, pero faltan provider adapters para ejecutar llamadas efectivas a modelos.
- El copilot está incompleto: existe módulo/controlador, pero no el servicio que genera sugerencias útiles al humano.
- Las métricas del dashboard principal siguen parcialmente en mock, lo que impide una vista ejecutiva real.
- No existe todavía la formalización completa del dominio de lead comercial para cursos: lead, opportunity, score comercial, intención, campaña, curso y handoff dirigido a cierre.
- La parte de landing/formulario no está definida como módulo desacoplable; debe tratarse como intake module y no como núcleo del producto.
- No se evidencian tests visibles ni una capa mínima de validación end-to-end para el pipeline crítico.

## 3. Reencuadre del producto
Parallly no debe seguir viéndose como un engine conversacional genérico con catálogos y órdenes solamente. Debe reposicionarse como una plataforma de orquestación comercial para leads, donde la conversación es un medio y no el producto completo.

### 3.1 Nueva definición oficial
Parallly es una plataforma multi-tenant para captación, monitoreo, clasificación, calentamiento y preparación de leads para cierre comercial, usando formularios, WhatsApp, email, CRM conversacional, analítica y un agente IA especializado.

### 3.2 Principio estructural clave
La landing y el formulario de ejemplo deben quedar fuera del core del producto. Deben convertirse en un módulo separado llamado Intake / Landing Module, porque solo son un mecanismo de entrada y un disparador del flujo comercial.

## 4. Decisión arquitectónica recomendada
Seguir con un monolito modular, no pasar todavía a microservicios desplegados por separado. La meta no es reducir tamaño del código; la meta es separar responsabilidades de dominio.

## 5. Mapa entre lo que existe y el producto objetivo
### 5.1 Módulos existentes que encajan directamente
- auth
- tenants
- channels
- conversations
- pipeline
- handoff
- broadcast
- knowledge
- persona
- analytics
- agent-console
- settings

### 5.2 Módulos que deben redefinirse o ampliarse
- contacts -> Lead + Contact Profile + Company context
- pipeline -> motor comercial orientado a etapas, score, SLA y decisiones
- broadcast -> dominio de campaña/curso
- knowledge -> recursos por curso, versión, aprobación y uso por tenant
- analytics -> métricas comerciales
- orders -> secundario en V1

### 5.3 Módulos nuevos que faltan formalmente
- Intake / Landing Module
- Campaign Module
- Course Catalog Module
- Lead Scoring Module
- Consent & Compliance Module
- Template Management Module
- Opportunity / CRM Module
- Reporting Module
- Copilot Service real
- LLM Provider Layer real

## 6. Estructura objetivo de módulos
- Core Platform
- Intake
- CRM Comercial
- Conversational
- Campaigns & Courses
- AI Layer
- Knowledge
- Analytics
- Compliance
- Operations

## 7. Qué debe cambiar de inmediato en el modelo de producto
1. Renombrar la narrativa interna del proyecto.
2. Crear entidades explícitas de Campaign, Course, Lead, Opportunity, ConsentRecord y OptOutRecord.
3. Separar Form/Landing del dominio Conversational.
4. Modificar analytics para incluir métricas comerciales.
5. Agregar scoring híbrido 1 a 10.
6. Agregar clasificación de intención.
7. Agregar reglas de handoff sutil.
8. Convertir el dashboard principal en un dashboard ejecutivo real.

## 8. Lógica comercial mínima obligatoria
- Carla responde desde el primer mensaje.
- Carla puede dar precio.
- Carla no envía links de pago.
- Carla solo puede ofrecer descuentos o promociones si hay regla activa y contexto de grupo.
- Lead caliente = score 7 u 8.
- Lead listo para cierre = score 9 o 10.
- VIP / alto valor = grupo, varias personas o interés en varios cursos.
- Carla hace entrada sutil del humano cuando corresponda.

## 9. Ruta de ejecución recomendada
### Fase 1 - Alineación del dominio
- ADR y nuevo mapa de bounded contexts.
- Modelo de datos final de Lead, Opportunity, Campaign, Course, Consent y OptOut.

### Fase 2 - Bloqueantes técnicos
- Providers LLM reales.
- Copilot service.
- Dashboard stats reales.

### Fase 3 - CRM comercial
- Lead profile, opportunities, score, tareas, etapas.

### Fase 4 - Intake desacoplado
- Forms, UTM, consent, source attribution, evento LeadCaptured.

### Fase 5 - Campañas y cursos
- Cursos, campañas, templates, horarios y reglas.

### Fase 6 - Carla comercial
- Prompt base, intenciones, scoring, handoff y resúmenes.

### Fase 7 - Analítica y cumplimiento
- Dashboard ejecutivo, dashboard operativo, opt-out, supresión, borrado, exportaciones.

## 10. Lista concreta de tareas para el agente de código
1. Crear ADR-001 con la separación del Intake.
2. Refactorizar contacts hacia leads y companies.
3. Agregar opportunities.
4. Crear stages comerciales.
5. Implementar score híbrido.
6. Implementar intents.
7. Implementar provider adapters.
8. Completar runtime de Carla.
9. Completar copilot.service.ts.
10. Crear dashboard ejecutivo real.
11. Crear dashboard operativo.
12. Crear módulo intake.
13. Crear templates por curso/campaña.
14. Crear suppression/opt-out handling.
15. Agregar tests de integración para pipeline crítico.

## 11. Criterios de aceptación
- Captura de lead desacoplada.
- Actualización de lead existente con nueva oportunidad.
- Envío inicial con logs.
- Carla responde con RAG y políticas.
- Score dinámico.
- Handoff visible.
- Contexto suficiente para humano.
- Métricas reales.
- Consentimiento y opt-out funcionales.
- Módulo intake desacoplable sin romper el core.

## 12. Recomendación final
No rehacer desde cero. Ejecutar una reorientación controlada: mantener infraestructura y módulos maduros, completar bloqueantes técnicos y reconducir el dominio hacia Parallly como producto comercial centrado en leads, campañas, cursos, IA y cierre asistido por humano.
