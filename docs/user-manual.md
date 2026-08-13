# Parallly — Manual de Usuario

<p align="center">
  <img src="../docs/images/parallly-logo.png" alt="Parallly Logo" width="200" />
</p>

<p align="center">
  <strong>Plataforma de IA Conversacional Omnicanal</strong><br/>
  Guía completa para tenants — administradores, supervisores y agentes
</p>

<p align="center">
  Versión 4.4 — Agosto 2026
</p>

<p align="center">
  <sub>Manual para <strong>tenants</strong> (administradores, supervisores y agentes). Las funciones de <strong>super_admin</strong> de plataforma — Centro de Operaciones, impersonación, backups y Billing Ops (subs/pagos/reembolsos cross-tenant) — quedan fuera de este manual.</sub>
</p>

---

## Índice General

| # | Sección |
|---|---------|
| 1 | [Introducción](#1-introducción) |
| 2 | [Primeros pasos](#2-primeros-pasos) |
| 3 | [Roles y permisos](#3-roles-y-permisos) |
| 4 | [Dashboard](#4-dashboard) |
| 5 | [Navegación](#5-navegación) |
| 6 | [Inbox — Bandeja de entrada](#6-inbox--bandeja-de-entrada) |
| 7 | [CRM — Gestión de contactos](#7-crm--gestión-de-contactos) |
| 8 | [Agentes IA](#8-agentes-ia) |
| 9 | [Canales de comunicación](#9-canales-de-comunicación) |
| 10 | [Citas y agenda](#10-citas-y-agenda) |
| 11 | [Automatización](#11-automatización) |
| 12 | [Campañas y broadcast](#12-campañas-y-broadcast) |
| 13 | [Base de conocimiento](#13-base-de-conocimiento) |
| 14 | [Plantillas de email](#14-plantillas-de-email) |
| 15 | [Analytics y reportes](#15-analytics-y-reportes) |
| 16 | [Inventario y pedidos](#16-inventario-y-pedidos) |
| 17 | [Privacidad y cumplimiento](#17-privacidad-y-cumplimiento) |
| 18 | [Configuración general](#18-configuración-general) |
| 19 | [Gestión de usuarios](#19-gestión-de-usuarios) |
| 20 | [Facturación y planes](#20-facturación-y-planes) |
| 21 | [Adaptación por industria — verticales](#21-adaptación-por-industria--verticales) |
| 22 | [Sistema de recall (recordatorios)](#22-sistema-de-recall) |
| 23 | [Sistema de ayuda contextual](#23-sistema-de-ayuda-contextual) |
| 24 | [Conversaciones resueltas](#24-conversaciones-resueltas) |
| 25 | [Subir fotos a catálogos](#25-subir-fotos-a-catálogos) |
| 26 | [App móvil](#26-app-móvil) |
| 27 | [Procesamiento multimedia](#27-procesamiento-multimedia) |
| 28 | [Integraciones y API pública](#28-integraciones-y-api-pública) |
| 29 | [Probar agente — simulación](#29-probar-agente--simulación) |
| 30 | [Procedimientos (SOP)](#30-procedimientos-sop) |
| 31 | [Agente que vende — skillsets y upsell](#31-agente-que-vende--skillsets-y-upsell) |
| 32 | [Integraciones verticales (Toast / Mindbody / Cliniko)](#32-integraciones-verticales) |
| 33 | [Conectores MCP](#33-conectores-mcp) |
| 34 | [Organizaciones B2B y forecast](#34-organizaciones-b2b-y-forecast) |
| 35 | [Atribución de marketing](#35-atribución-de-marketing) |
| 36 | [Reseñas y reputación](#36-reseñas-y-reputación) |
| 37 | [Preguntas frecuentes (FAQ)](#37-preguntas-frecuentes) |

---

# 1. Introducción

Parallly es una plataforma SaaS que permite a negocios automatizar y centralizar conversaciones de ventas, soporte y atención al cliente a través de **WhatsApp, Instagram, Messenger, Telegram y un Web Chat Widget** — con agentes de inteligencia artificial que operan sobre tu catálogo, tu agenda y tu base de clientes reales. Email conserva un adaptador e ingreso técnico interno, pero no tiene configuración autoservicio certificada. El **SMS no es un canal conversacional**; cuando la cuenta tiene esa capacidad habilitada, se usa para **notificaciones salientes** por créditos (ver sección 20.14).

### ¿Para quién es Parallly?

- Negocios que reciben consultas por redes sociales o WhatsApp
- Empresas que quieren automatizar atención al cliente
- Equipos de ventas que necesitan un CRM integrado con canales de mensajería
- Profesionales que agendan citas (consultorios, asesorías, salones, talleres)
- Inmobiliarias, agencias de viajes, restaurantes, gimnasios, escuelas, aseguradoras, clínicas veterinarias, fotógrafos, servicios del hogar y más

### ¿Qué puedes hacer con Parallly?

- Conectar canales de mensajería en minutos
- Configurar agentes IA personalizados que atienden 24/7
- Agendar citas automáticamente con sincronización a Google Calendar
- Gestionar contactos, leads y pipeline de ventas
- Crear reglas de automatización
- Preparar borradores, audiencias y métricas de campañas; el envío de producción
  permanece deshabilitado por procedimiento hasta cerrar los controles descritos en
  la sección 12
- Analizar métricas de rendimiento
- Adaptar la experiencia a 18 industrias verticales con capacidades disponibles según el negocio

---

# 2. Primeros Pasos

## 2.1 Crear una cuenta

1. Ir a [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud)
2. Clic en **Registrarse**
3. Ingresar email y contraseña (o usar Google OAuth)
4. Verificar el email con el código de 6 dígitos que recibirás
5. Completar el asistente de onboarding (sección 2.2)

## 2.2 Asistente de Onboarding

Al crear tu cuenta, un asistente de **4 pasos** configura tu negocio.

### Paso 1 — Perfil de empresa

| Campo | Obligatorio |
|-------|:-----------:|
| Nombre de la empresa | ✅ |
| Sitio web | No |
| Teléfono | No |
| Email comercial | No |
| Descripción | No |
| Industria | ✅ |
| Sub-tipo de negocio | Adapta el agente |
| Tamaño | No |
| Zona horaria | ✅ |

### Paso 2 — Audiencia

Las opciones se adaptan a tu industria. Por ejemplo:
- **Salud**: Pacientes particulares, Por derivación, Obra social/prepaga
- **Inmobiliaria**: Compradores, Inversores, Arrendatarios
- **Restaurantes**: Comensales locales, Turistas, Corporativo

### Paso 3 — Objetivos

El título y opciones se adaptan al nombre del agente IA recomendado:
- **Salud**: "¿Cómo ayudará Sofía a tus pacientes?"
- **Inmobiliaria**: "¿Cómo ayudará Carlos a tus clientes?"
- **Restaurantes**: "¿Cómo ayudará Luca a tus comensales?"

### Paso 4 — Plan

Selecciona país de facturación, ciclo mensual/anual cuando esté disponible y una
opción del catálogo vivo. Los planes reconocidos son Emprendedor, Starter, Pro,
Enterprise y Custom; la elegibilidad, precio, periodo de prueba y forma de
contratación que devuelve el catálogo son la fuente vigente. Puedes revisar o cambiar
tu plan desde **Configuración → Facturación**.

### Configuración automática al terminar

- **Pipeline** con etapas adaptadas a tu industria
- **Agente IA** con nombre, rol, tono y herramientas pre-configurados
- **FAQs base** de tu sector
- **Servicios** ejemplo según tu tipo de negocio
- **Tablas verticales** activadas (menú, planes, propiedades, etc. según corresponda)

## 2.3 Iniciar sesión

| Método | Detalle |
|--------|---------|
| Email + contraseña | Credenciales habituales |
| Google OAuth | "Continuar con Google" |
| Recordarme | Sesión 14 días (sin esto: 8h) |

> Después de 60 minutos de inactividad aparece un modal con cuenta regresiva de 2 minutos. Si no respondes, la sesión cierra.

## 2.4 Recuperar contraseña

1. Login → "¿Olvidaste tu contraseña?"
2. Ingresa tu email
3. Recibes código OTP por correo
4. Ingresas el código y estableces nueva contraseña

---

# 3. Roles y Permisos

Parallly tiene **3 roles para tenants**, cada uno con permisos específicos. Los administradores definen quién es qué desde Configuración → Usuarios.

También puede aparecer `tenant_viewer` en cuentas heredadas. Es un rol de
compatibilidad limitado a Configuración personal; no se ofrece como rol normal al
invitar o editar miembros.

## 3.1 Resumen rápido

| Rol | A quién va | Acceso típico |
|-----|------------|---------------|
| **Tenant Admin** | Dueño del negocio, gerente | TODO — incluye facturación, canales, usuarios, agente IA |
| **Tenant Supervisor** | Líder de operaciones, jefe de equipo | Operación + analytics + automatización (sin facturación ni usuarios) |
| **Tenant Agent** | Asesor, vendedor, recepcionista | Bandeja, contactos, pipeline, citas y conocimiento en lectura |

## 3.2 Tenant Admin — Acceso completo

**Ideal para:** dueño/a del negocio, gerente general, persona que firma el contrato.

**Puede:**
- ✅ Todo lo del Supervisor y Agent
- ✅ Conectar y desconectar los canales autoservicio disponibles (WhatsApp, Instagram, Messenger y Telegram) — incluyendo varias conexiones del mismo tipo cuando el plan vigente lo permite; Web Chat se administra desde Integraciones
- ✅ Configurar agentes IA (crear, editar, asignar canales, eliminar)
- ✅ Gestionar usuarios (invitar, cambiar roles, desactivar)
- ✅ Cambiar plan de facturación, método de pago, pausar/cancelar
- ✅ Aplicar cupones promocionales
- ✅ Ver historial de pagos
- ✅ Configurar políticas de privacidad y compliance
- ✅ Ver y modificar configuración general de la empresa
- ✅ Acceder a base de conocimiento (cargar documentos)

**No puede:**
- Acceder a paneles de plataforma global (eso solo lo ven los super-admins de Parallly)

## 3.3 Tenant Supervisor — Operación + Analytics

**Ideal para:** jefe/a de equipo, supervisor/a comercial, líder de soporte.

**Puede:**
- ✅ Todo lo del Agent
- ✅ Crear y editar reglas de automatización
- ✅ Preparar borradores, audiencias y revisar métricas de campañas; el lanzamiento de producción aún no está certificado (ver sección 12)
- ✅ Cargar contenido a la base de conocimiento
- ✅ Ver analytics completas (CRM, agentes, canales, CSAT)
- ✅ Consultar el Centro de calidad de cada agente y sus recomendaciones
- ✅ Configurar etapas del pipeline y reglas de scoring
- ✅ Crear macros, plantillas de email y formularios pre-chat
- ✅ Definir campos personalizados, etapas/scoring, macros, media, plantillas y pre-chat
- ✅ Revisar el historial y controlar operativamente los cierres del pipeline; la aprobación automática aún no está certificada
- ✅ Hacer merge manual de contactos en duplicados

**No puede:**
- ❌ Conectar/desconectar canales
- ❌ Crear o eliminar agentes IA
- ❌ Modificar datos de empresa, horarios, localización o integraciones
- ❌ Ver ni cambiar facturación
- ❌ Gestionar usuarios

## 3.4 Tenant Agent — Operativo

**Ideal para:** asesor de ventas, recepcionista, agente de atención.

**Puede:**
- ✅ Atender conversaciones desde la bandeja (handoff humano)
- ✅ Ver y editar contactos / leads asignados
- ✅ Mover deals en el pipeline
- ✅ Agendar y reprogramar citas
- ✅ Ver el calendario propio y del negocio
- ✅ Ver y solicitar features (feature requests)
- ✅ Consultar la base de conocimiento en modo lectura

**No puede:**
- ❌ Configurar agentes IA, canales o automatizaciones
- ❌ Abrir las páginas de analytics o rendimiento del equipo
- ❌ Crear campañas masivas o cargar conocimiento
- ❌ Administrar media, macros, plantillas o formularios
- ❌ Modificar pipeline, scoring, o configuración del tenant
- ❌ Ver facturación ni gestionar usuarios

## 3.5 Cambiar el rol de un usuario

Solo un **Tenant Admin** puede cambiar roles:

1. Configuración → **Usuarios**
2. Click en el usuario
3. Selecciona el nuevo rol
4. Guarda

> **Importante:** Si bajás de Admin a Supervisor a alguien que tiene canales conectados, los canales siguen funcionando — solo se le quita la habilidad de modificarlos.

> **Nota sobre métricas personales:** el modelo de permisos contempla indicadores
> propios para Agent y la app móvil puede mostrarlos cuando el endpoint los autoriza,
> pero la página web `/admin/agent-analytics` está restringida actualmente a
> Admin/Supervisor. No uses esa URL como flujo para Agent.

---

# 4. Dashboard

**Ruta:** Menú → Dashboard
**Roles:** Admin/Supervisor. Agent inicia en Conversaciones; Viewer, en su Perfil.

El dashboard es tu vista general al iniciar sesión y se adapta a tu industria.

### Mensaje de bienvenida vertical

- **Salud**: "Bienvenido a tu consultorio virtual"
- **Restaurantes**: "Tu restaurante está listo"
- **Inmobiliaria**: "Tu agencia está lista para cerrar negocios"
- **General**: "Bienvenido a Parallly"

### KPIs por industria

| Industria | KPI 1 | KPI 2 | KPI 3 |
|-----------|-------|-------|-------|
| **Salud** | Citas hoy | Pacientes nuevos | No shows |
| **Veterinaria** | Citas hoy | Mascotas registradas | Vacunas próximas |
| **Restaurantes** | Pedidos hoy | Mesas ocupadas | Ingresos día |
| **Gimnasios** | Miembros activos | Clases hoy | Check-ins 7d |
| **Inmobiliaria** | Leads hoy | Visitas agendadas | Cierres mes |
| **Turismo** | Reservas día | Tours activos | Ocupación |
| **Educación** | Inscripciones | Cursos activos | Estudiantes |
| **Servicios hogar** | Solicitudes hoy | Emergencias | Técnicos disponibles |
| **General** | Conversaciones hoy | Leads nuevos | Tasa respuesta |

### Vista principal (homepage vertical)

Para algunas industrias el dashboard muestra una vista contextualizada:
- **Salud / Veterinaria / Belleza**: agenda del día con citas
- **Inmobiliaria / Automotriz**: lista de leads
- **Restaurantes**: pedidos en cocina + reservas
- **Otras**: actividad reciente

### Checklist de configuración

Banner con pasos pendientes para activar tu cuenta:
- Conectar al menos un canal
- Personalizar tu agente IA
- Crear un servicio/producto
- Cargar tu logo

Este checklist indica adopción y configuración inicial. No certifica la calidad del
agente ni sustituye sus pruebas o la evidencia de conversaciones reales.

---

# 5. Navegación

## 5.1 Menú principal — trabajo primero, administración después

El sidebar se organiza por la tarea que la persona quiere completar. Los grupos
secundarios pueden plegarse; el grupo de la página actual se abre siempre. El
orden no cambia entre páginas ni sesiones:

### ESENCIALES
- **Inicio** — resumen del negocio (admin/supervisor)
- **Conversaciones** — inbox y atención diaria
- **CRM** — contactos; contiene Embudo y Organizaciones cuando el rol lo permite

### IA Y CRECIMIENTO
- **Agente IA** — personalidad, capacidades y simulación (admin)
- **Procedimientos** y **Base de conocimiento**
- **Automatización** — reglas, secuencias y plantillas (admin/supervisor)
- **Campañas** — broadcasts (admin/supervisor)

### OPERACIÓN
- Destinos propios del rubro: Agenda, Propiedades, Tours, Inmuebles, Vehículos,
  Alquileres, Menú, Pedidos, Membresías, Clases, Cursos, Seguros, Solicitudes,
  Mascotas, Sesiones fotográficas, Inventario y Órdenes
- Solo aparecen los módulos respaldados por la vertical y el rol actual

### INSIGHTS
- **Análisis**, analítica CRM, atribución e informes (admin/supervisor)
- **Rendimiento del equipo** (admin/supervisor)
- **Centro de calidad** por agente (admin/supervisor, lectura y diagnóstico)

### ADMINISTRACIÓN
- Canales, usuarios, cumplimiento, facturación y solicitudes de funciones según rol

### Configuración (zona estable al fondo)
- Abre el hub local de Configuración y conserva la página de origen para poder volver

> **Ayudas de navegación:** `Ctrl/Cmd+K` abre la búsqueda global; `Alt+1`,
> `Alt+2` y `Alt+3` abren destinos frecuentes permitidos. Favoritos y recientes
> nunca muestran rutas incompatibles con el rol o la vertical.

## 5.2 Configuración — áreas por responsabilidad

El hub filtra sus áreas por rol. Un administrador del tenant puede ver hasta ocho:

| Sección | Contiene |
|---------|----------|
| **Cuenta** | Perfil, seguridad, notificaciones y apariencia |
| **Empresa** | Datos del negocio, localización, fiscal y horarios |
| **CRM y operación** | Pipeline, scoring, atributos, reserva pública y nurturing |
| **Conversaciones** | Pre-chat, plantillas, macros, multimedia y recall |
| **Canales e integraciones** | CRM, web chat, Slack, SMS, verticales, reseñas, pagos y e-commerce |
| **Desarrolladores** | Webhooks, MCP y API keys |
| **Gobierno y alertas** | Políticas, alertas y reportes |
| **Plan y facturación** | Suscripción, periodo y pagos |

Desde cualquier página, **Configuración** recibe un retorno interno seguro. El
botón “Volver a la sección anterior” restaura también filtros, query y hash.

## 5.3 Analítica — pestañas

Acceso solo para admin/supervisor. Pestañas disponibles:

| Pestaña | Contenido |
|---------|-----------|
| Resumen | KPIs principales |
| Conversaciones | Volumen, resolución, tiempo respuesta |
| CSAT | Valoraciones de satisfacción ya registradas |
| Embudo | Funnel de conversión |
| Velocidad | Días por etapa del pipeline |
| Win/Loss | Tasa de cierre y motivos |
| Agentes | Leaderboard, performance |
| Canales | Por canal de mensajería |
| Fuentes | Origen de leads |
| AI Insights | Análisis IA de tendencias |

---

# 6. Inbox — Bandeja de Entrada

**Ruta:** Esenciales → Conversaciones
**Roles:** Admin/Supervisor/Agent

## 6.1 Vista general

Layout de 3 columnas:
- **Izquierda**: lista de conversaciones (con filtros)
- **Centro**: hilo de mensajes
- **Derecha**: panel del contacto

Avatares con foto real (Instagram, WhatsApp Business, Messenger). Cuando el avatar expira o no carga, fallback a gradiente con inicial.

## 6.2 Filtros

Pills arriba de la lista:
- **Todas** — todas las conversaciones
- **Activas** — sin marcar resueltas
- **Asignadas a mí** — solo lo que tienes asignado
- **Sin asignar** — conversaciones huérfanas
- **Esperando humano** — handoff pendiente
- **Con humano** — ya tienen agente
- **Resueltas** — cerradas hace 72h o manualmente

Filtros por canal: WhatsApp, Instagram, Messenger y Telegram. Email puede aparecer en datos históricos o integraciones administradas, pero no implica que exista configuración autoservicio certificada.

## 6.3 Notificaciones de handoff

La campana en TopBar muestra 7 categorías:
- **handoff_direct** — el cliente pidió hablar con humano (rojo)
- **handoff_normal** — IA escaló por baja confianza (amarillo)
- **escalation** — supervisor: alguien lleva >5min sin responder (rojo + sonido)
- **system** — alertas de plataforma
- **billing** — pagos, trials terminando
- **mention** — alguien te etiquetó

## 6.4 Acciones de conversación

| Acción | Quién |
|--------|-------|
| Responder | Admin/Supervisor/Agent |
| Tomar control (handoff) | Admin/Supervisor/Agent |
| Devolver al bot | Admin/Supervisor/Agent |
| Snooze (posponer) | Admin/Supervisor/Agent |
| Marcar como resuelta | Admin/Supervisor/Agent |
| Archivar | Admin/Supervisor/Agent |
| Eliminar conversación | Admin |
| Asignar a otro agente | Admin/Supervisor |
| Mover etapa pipeline | Admin/Supervisor/Agent |
| Aplicar macro | Admin/Supervisor/Agent |
| Ver historial cross-canal | Admin/Supervisor/Agent |

## 6.5 Panel del contacto

Lateral derecho con tabs:
- **Info**: nombre, teléfono, canal de origen, tags, score
- **Pipeline**: etapa actual, valor del deal
- **Citas**: próximas y pasadas
- **Historial**: notas, actividades, llamadas
- **Custom fields**: campos personalizados según industria

## 6.6 Detección de colisiones (presencia en tiempo real)

Cuando varios agentes humanos abren la misma conversación al mismo tiempo, Parallly muestra **pills de presencia** con el nombre y color de cada agente que la tiene abierta.

**Cómo funciona:**

- Al abrir una conversación, tu presencia se registra automáticamente
- Si otro agente ya la tiene abierta, verás una pill coloreada con su nombre debajo del encabezado de la conversación (por ejemplo, una pill verde "María G." y una azul "Carlos P.")
- El sistema envía un heartbeat cada **15 segundos** para mantener la presencia activa
- Si un agente cierra la conversación o queda inactivo por más de **30 segundos**, su pill desaparece automáticamente

**¿Por qué es útil?**

- Evita que dos agentes respondan al mismo cliente simultáneamente
- Reduce confusión en equipos grandes con inbox compartido
- No requiere configuración — funciona de forma automática para todas las conversaciones

> **Tip:** Si ves la pill de otro agente, coordina por chat interno antes de responder. La pill solo indica que la conversación está abierta, no que alguien esté escribiendo.

---

# 7. CRM — Gestión de Contactos

## 7.1 Contactos

**Ruta:** Esenciales → CRM → Contactos
**Roles:** Admin/Supervisor/Agent (con limitaciones de edición según rol)

### Ver contactos

Tabla con columnas: nombre, canal, último mensaje, score, etapa pipeline, tags. Ordenable por cualquiera.

### Acciones principales

| Acción | Roles |
|--------|-------|
| Ver detalle | Admin/Supervisor/Agent |
| Editar | Admin/Supervisor/Agent |
| Crear lead | Admin/Supervisor/Agent |
| Archivar | Admin/Supervisor |
| Acciones masivas | Admin/Supervisor |
| Filtros avanzados | Admin/Supervisor/Agent |

### Crear un lead

1. Botón **+ Nuevo contacto**
2. Modal con campos: nombre, teléfono (obligatorio), email, etapa pipeline inicial
3. Guardar → aparece en la lista

> El teléfono se normaliza automáticamente a formato E.164 (CO, AR, MX, BR, CL, PE, EC, US/CA).

### Acciones masivas

Selecciona varios checkboxes → barra sticky abajo con:
- Cambiar etapa
- Agregar/quitar tag
- Archivar
- Asignar a agente

### Filtros avanzados

Drawer lateral con chips:
- Score (rango)
- Fecha de creación
- Última actividad
- Tags (múltiple)
- Canal de origen
- Etapa pipeline
- VIP / archivado

### Detalle del contacto (lead 360°)

Pestañas:
- **Resumen**: edición inline (nombre, email, teléfono, etapa, VIP, tags)
- **Score breakdown**: 5 factores expandibles (recencia, engagement, intent keywords, etapa, plan)
- **AI Insights**: análisis automático del comportamiento del lead
- **Custom fields**: campos personalizados según industria
- **Conversaciones**: historial cross-canal
- **Citas**: próximas y pasadas
- **Notas**: anotaciones del equipo
- **Actividades**: timeline de tareas y eventos
- **Documentos**: archivos compartidos
- *(verticales)* Planes de tratamiento, Mascotas, Pólizas, Cursos inscritos

## 7.2 Pipeline (Kanban)

**Ruta:** Esenciales → CRM → Embudo

Vista kanban con etapas configurables. Cada deal una tarjeta arrastrable.

### Personalizar etapas

Solo Admin/Supervisor desde Configuración → Pipeline:
- Reordenar arrastrando
- Editar color (8 colores) y probabilidad de cierre
- Marcar etapas terminales (ganado/perdido)
- Crear/eliminar etapas

### Aprobación de deals

La interfaz contiene elementos de aprobación, pero el bloqueo, la solicitud y la
revisión de una etapa terminal **no están certificados de punta a punta en esta
versión**. Una llamada directa puede mover la oportunidad sin completar esa
revisión. No uses este mecanismo como control financiero o de auditoría: limita
operativamente los cierres a Admin/Supervisor y revisa el historial de cada deal.

### Deduplicación

El pipeline muestra **un deal por lead** (DISTINCT ON lead_id) para no saturar con conversaciones duplicadas.

## 7.3 Segmentos

Filtros guardados que puedes reusar y compartir.

1. Aplicar filtros en la lista de contactos
2. Click "Guardar segmento" → nombre + descripción
3. Disponible en sidebar de Contactos

## 7.4 CRM Analytics

**Roles:** Admin/Supervisor

Pestañas (recharts):
- **Resumen**: KPIs (leads totales, nuevos, conversión, valor pipeline)
- **Embudo**: visualización por etapa
- **Velocidad**: días promedio en cada etapa
- **Win/Loss**: tasa de cierre + motivos
- **Agentes**: leaderboard
- **Fuentes**: por canal de adquisición

## 7.5 Identidad y Merge

**Roles:** Admin/Supervisor

### Merge automático

Si un contacto te escribe desde dos canales con el mismo número o email, Parallly los unifica automáticamente bajo un "Customer Profile".

### Sugerencias de merge

CRM → Identidad → pestaña **Sugerencias**:
- Lista de pares de contactos con alta similitud (nombre + teléfono parcial, etc.)
- Botón aprobar / rechazar para cada par

### Merge manual

1. Identidad → "Merge manual"
2. Selecciona contacto A y contacto B
3. Elige qué campos preservar de cada uno
4. Confirmar

## 7.6 Lead Scoring Configurable

**Roles:** Admin/Supervisor
**Ruta:** Configuración → Pipeline → Scoring

Configura los pesos de los 5 factores:
- **Recencia** (días desde última interacción) — peso 1-10
- **Engagement** (mensajes intercambiados) — peso 1-10
- **Intent keywords** — palabras clave de compra
- **Etapa pipeline** — score por etapa
- **Plan / valor** — si aplica a tu negocio

### Decaimiento

Configurable: el score baja N puntos cada X días sin actividad. Útil para que leads viejos no inflen el ranking.

## 7.7 AI Insights

Tarjeta en el detalle del lead con análisis automático:
- Probabilidad de cierre
- Próxima mejor acción
- Keywords identificadas
- Patrón de respuesta
- Riesgo de churn

## 7.8 Filtros Avanzados

Drawer con chips combinables. Multi-criterio (AND), guardable como segmento.

## 7.9 Alcance actual del Pipeline

**Roles:** Admin/Supervisor/Agent para operar; Admin/Supervisor para configurar etapas
**Ruta:** Esenciales → CRM → Embudo

La experiencia vigente garantiza el embudo activo del tenant: consultar etapas y
deals, crear o editar oportunidades y moverlas mediante la transición canónica. La
creación y administración de múltiples pipelines independientes no forma parte del
contrato backend expuesto actualmente, aunque existan referencias históricas en
planes o clientes antiguos.

Para separar procesos mientras esa capacidad no esté habilitada, usa etapas, tags,
segmentos y campos personalizados dentro del embudo activo.

---

# 8. Agentes IA

**Ruta:** IA y crecimiento → Agente IA
**Roles del listado y editor:** Tenant Admin

Supervisor y Agent pueden trabajar con conversaciones atendidas por la IA desde el
Inbox, pero no acceden al listado ni al editor de agentes. El Supervisor sí puede
consultar la evidencia de cada agente desde **Insights → Centro de calidad**.

## 8.1 Lista de agentes

Ves todos los agentes IA configurados. Cards con:
- Nombre, rol, plantilla base
- Canales asignados
- Estado activo/pausado
- Versión

### Banner de alerta

Si tienes canales conectados sin agente asignado, aparece banner rojo: "Tienes X canales sin agente — el bot no responderá".

### Acciones

- **Crear agente** — desde plantilla o blank
- **Duplicar** — copia exacta para experimentar
- **Editar** — abre el editor
- **Eliminar** — con confirmación
- **Guardar como plantilla** — para reusar

### Capacidad del plan

El número de agentes y el acceso a plantillas se obtienen del catálogo vigente y de
los overrides autorizados del tenant. La pantalla bloquea nuevas altas al alcanzar
la capacidad. Confirma el valor aplicable en **Configuración → Facturación** antes
de planificar una expansión.

## 8.2 Editor del agente

Hub con cards organizadas:

### Identidad
- Nombre del agente (ej: Sofía, Carlos, Maya)
- Rol / título
- Avatar

### Personalidad
- Tono (formal, amigable, técnico, empático)
- Estilo de comunicación
- Saludo inicial

### Modelo IA
- Proveedor (OpenAI, Anthropic, Google, xAI, DeepSeek)
- Modelo específico
- Tier (basic, pro, premium)
- Temperatura
- **Monitoreo de salud**: indicador en tiempo real del estado de cada proveedor LLM. Si un proveedor falla repetidamente, un **circuit breaker** lo desactiva temporalmente y el sistema hace fallback automático al siguiente proveedor configurado en la cadena
- **Ruteo por tarea**: las tareas de conversación (`conversation`) y las de uso de herramientas (`tool_calling`) pueden usar cadenas de modelos diferentes, optimizando costo y rendimiento según el tipo de operación

### Comportamiento
- Reglas custom (free text)
- Temas prohibidos
- Modo respuesta (siempre IA, siempre humano, híbrido)
- Activación / horario

### Asignación de conexiones

Selector de **conexiones** que este agente atiende. La regla es **un agente por conexión** (`agent_personas.channel_bindings`): cada agente se enlaza a cuentas concretas (por ejemplo, "WhatsApp — Ventas +57 300…" y "WhatsApp — Soporte +57 301…"), no a un canal genérico. Así podés tener un agente distinto por cada número o cuenta conectada. Cuántas conexiones del mismo tipo podés tener lo define tu plan (ver 9.8).

### Herramientas

Toggles para tools que el agente puede usar:
- Buscar en la base de conocimiento (RAG)
- Verificar disponibilidad de citas
- Crear citas
- Listar productos / servicios / propiedades
- Crear órdenes / reservas
- Solicitar handoff a humano
- Tools verticales según industria

### Sticky save bar

Barra inferior siempre visible con "Guardar cambios" — no perdés ediciones al hacer scroll.

## 8.3 Plantillas verticales

Al crear un agente nuevo, "Recomendados para tu negocio" aparece destacado según tu industria.

### Plantillas por industria

- **Salud / Veterinaria**: Sofía recepcionista, Sofía dental
- **Inmobiliaria**: Carlos asesor, Carlos venta, Carlos arriendo
- **Restaurantes**: Luca toma pedidos, Luca reservas
- **Gimnasios**: Trainer, recepción
- **Educación**: Asesor académico
- **Seguros**: Roberto cotizador, Roberto reclamos
- **Turismo**: Maya tours, Maya alquiler
- **Servicios hogar**: Toby plomería, Toby electricidad

### Plantillas generales

- Sales Advisor
- Support Agent
- FAQ Bot
- Appointment Scheduler
- Lead Qualifier
- Blank (configurar todo desde cero)

## 8.4 Test del agente

Modo simulador: chateá con tu agente sin afectar contactos reales. Útil antes de activarlo en producción.

Una conversación manual sirve para depurar, pero no demuestra calidad general. El
Centro de calidad usa por separado pruebas repetibles y evidencia real atribuida a la
versión del agente.

## 8.5 Centro de calidad del agente

**Ruta:** Insights → Centro de calidad (`/admin/agent/quality`)
**Roles:** Tenant Admin / Tenant Supervisor

Esta vista responde tres preguntas sin mezclarlas en un porcentaje decorativo:

1. **Preparación:** ¿están configurados el negocio, el conocimiento, el tono, las
   conexiones, las herramientas, la seguridad, el handoff y la operación aplicables?
2. **Calidad probada:** ¿la versión actual superó evaluaciones y simulaciones
   repetibles, y esa evidencia continúa vigente?
3. **Producción:** ¿qué muestran las conversaciones reales atribuidas a ese agente y
   a esa versión durante el periodo observado?

Selecciona un agente en la parte superior. La pantalla muestra la versión analizada,
el siguiente hito, los bloqueos críticos, los controles por dimensión, la última
evidencia de pruebas, el tamaño de la muestra real y las mejoras prioritarias. Una
capacidad deshabilitada que no forma parte del alcance puede aparecer como **No
aplica**; no reduce el resultado. Cuando falta volumen real aparece **Evidencia
insuficiente**, no un cero.

### Estados que puedes ver

| Estado | Cómo interpretarlo |
|--------|---------------------|
| **Aún no evaluado** | Todavía no hay evidencia suficiente para emitir un estado. |
| **Configuración incompleta** | Falta al menos un requisito o existe una advertencia de preparación. |
| **Agente en riesgo** | Una prueba crítica o una señal real importante requiere revisión. |
| **Listo para piloto controlado** | Preparación y pruebas permiten un piloto limitado; aún falta evidencia real suficiente. |
| **Operando con evidencia** | Hay configuración, pruebas vigentes y una muestra útil de producción. |
| **Revisión requerida** | La evidencia quedó desactualizada o el desempeño reciente se deterioró. |

Estos estados no son una certificación, no significan que el agente sea perfecto y
no garantizan resultados comerciales. Los evaluadores automáticos aportan evidencia;
una persona debe revisar los casos relevantes.

### Cómo usar las recomendaciones

- Empieza por las acciones **Críticas** y **Altas**; cada una indica el pilar, la
  dimensión y cuántos escenarios o interacciones la originaron cuando ese dato existe.
- Distingue si debes **reforzar conocimiento**, **ajustar comportamiento** o **reparar
  una capacidad** como una herramienta, integración o ruta de handoff.
- El Supervisor puede revisar y coordinar. Solo el Admin puede entrar al editor del
  agente o cambiar conexiones y configuración.
- El sistema no reescribe automáticamente prompts, políticas ni conocimiento. Después
  de un cambio, vuelve a probar la versión y verifica si producción confirma la mejora.
- La evidencia histórica sin una atribución inequívoca no se asigna retroactivamente a
  un agente. Por eso un agente recién instrumentado puede necesitar nuevas interacciones.

---

# 9. Canales de Comunicación

**Ruta:** Administración → Canales
**Roles:** Tenant Admin

## 9.1 WhatsApp

### Conectar (Embedded Signup v4)
1. Canales → WhatsApp → "Conectar"
2. Se abre flujo de Meta
3. Login con Facebook
4. Selecciona/creá tu WhatsApp Business Account (WABA)
5. Selecciona/agrega un número de teléfono
6. Verificación SMS o llamada
7. Aprobar permisos
8. Listo — el bot responde inmediatamente

### Funciones disponibles
- Mensajes de texto, imágenes, videos, documentos, audio
- Botones interactivos (Quick Replies, List Messages)
- Templates aprobados de Meta
- Recepción de ubicación, contactos
- Webhooks de delivery (entregado, leído)

### Templates de WhatsApp

Para enviar fuera de la ventana de 24h, necesitas plantillas aprobadas por Meta:
1. Configuración → Empresa → Templates
2. Crear plantilla → categoría (transactional/marketing) + idioma + variables
3. Enviar a Meta para aprobación (24-72h típicamente)

## 9.2 Instagram

### Conectar (OAuth + BroadcastChannel)
1. Canales → Instagram → "Conectar"
2. Popup con Instagram OAuth
3. Login con cuenta IG **Business** (no personal)
4. Aprobar `instagram_manage_messages`
5. Callback procesa el code
6. Token long-lived de 60 días + foto de perfil + username

### Renovación del token
Cron diario @6AM revisa y renueva tokens que expiran en menos de 30 días. Recibirás alerta si la renovación falla.

## 9.3 Messenger

### Conectar (FB SDK)
1. Canales → Messenger → "Conectar"
2. Modal con Facebook Login
3. Aprueba `pages_messaging`
4. Selecciona la página de Facebook
5. Token de página + foto de perfil
6. Listo

## 9.4 Telegram

### Conectar (Bot API)
1. Canales → Telegram → "Conectar"
2. Pegar el token del bot (desde @BotFather)
3. Parallly configura el webhook automáticamente
4. Listo

## 9.5 SMS — notificación saliente (no es un canal conversacional)

El **SMS conversacional no está disponible**. Cuando la plataforma y el plan de la
cuenta habilitan notificaciones SMS, Facturación muestra los paquetes, equivalencia,
saldo y checkout aplicables (ver 20.14). Solo entonces Campañas puede ofrecer SMS
como envío saliente medido.

Si esa sección o el canal no aparecen, la capacidad no está disponible para la cuenta;
no se debe inferir un proveedor, precio o equivalencia fija desde este manual.

> Los canales **conectables en autoservicio y conversacionales** son WhatsApp, Instagram, Messenger y Telegram. El Web Chat Widget es una superficie conversacional operativa que se configura aparte en **Configuración → Canales e integraciones → Web Chat**.

## 9.6 Email — estado actual

Email existe en el backend como **adaptador técnico y entrada inbound interna** para integraciones administradas. Esto no equivale a un canal conversacional certificado para autoservicio.

La pantalla **Canales → Email** existe, pero actualmente intenta usar rutas de configuración por tenant que el API no implementa. Por eso no debe usarse para ingresar credenciales ni asumirse que el botón de guardar deja el canal operativo.

Si tu organización necesita correo integrado, solicita una evaluación técnica a soporte. Hasta que el flujo de lectura, guardado, envío, recepción y respuesta se implemente y certifique de extremo a extremo, no se debe prometer que los correos aparecerán en Inbox ni que un agente IA podrá responderlos.

## 9.7 Desconectar un canal

La desconexión es **por cuenta/conexión**: si tenés varios números o cuentas del mismo tipo, cada uno se desconecta de forma independiente sin afectar a los demás.

1. Canales → click en el canal → elegí la conexión → "Desconectar"
2. Modal confirmación con resultado real:
   - **Verde** ✅ "Desconectado completamente": proveedor confirmó la desuscripción
   - **Amarillo** ⚠️ "Desconectado en plataforma — revisar el proveedor": tu BD se actualizó pero el proveedor podría seguir enviando. Causas: token expirado, cambio de permisos. Hay que entrar manualmente al proveedor (Meta Business Suite, etc.)
   - **Rojo** ❌: error de red — reintenta

## 9.8 Varias conexiones del mismo tipo (multi-cuenta)

Podés conectar **más de una cuenta del mismo canal** — por ejemplo dos números de WhatsApp, dos cuentas de Instagram o dos bots de Telegram — sin que sus conversaciones se mezclen.

- **Límite por plan y canal**: el catálogo y los overrides vigentes determinan cuántas conexiones admite cada tipo para tu cuenta. Consulta **Configuración → Facturación**; este manual no fija cantidades.
- **Contador visible**: cada tarjeta de canal en **Canales** muestra "**X de Y cuentas**" (Y = tu límite; ∞ si es ilimitado) y un enlace **"Conectar otra"** cuando todavía tenés cupo.
- **Tokens por cuenta**: cada conexión guarda su propio token de acceso (`channel_accounts.access_token`), de modo que los mensajes salen por el número o cuenta correctos.
- **Un agente por conexión**: podés asignar un agente IA distinto a cada cuenta (ver 8.2).
- **Emisor previsto en borradores de campaña**: cuando tenés más de una conexión,
  el borrador permite indicar desde qué número/cuenta debería salir. No lances una
  campaña real hasta que el selector de plantilla/emisor y la cancelación estén
  certificados según la sección 12.

La tarjeta del canal y **Configuración → Facturación** muestran el cupo efectivo. Si ambos difieren, no intentes inferir un valor desde tablas de seed o documentos históricos: solicita validación a soporte.

---

# 10. Citas y Agenda

**Ruta:** Operación → Agenda
**Roles:** Admin/Supervisor/Agent (configuración solo Admin/Supervisor)

## 10.1 Calendario

Vista mensual / semanal / diaria con todas las citas. Colores por servicio.

Acciones:
- Click en día → ver citas del día
- Click en cita → detalle (paciente, servicio, hora, ubicación)
- Reprogramar arrastrando
- Cancelar con motivo

## 10.2 Servicios

**Roles:** Admin/Supervisor

Define los servicios que ofreces:
- Nombre, descripción, duración (minutos)
- Precio (opcional)
- Buffer antes/después
- Tipo de ubicación: presencial / online / híbrido
- Link de videoconferencia (auto-generado para Meet o Teams)
- Dirección física
- Staff asignado (opcional, multi)
- Calendario asignado (opcional, para multi-calendar)
- Activo / inactivo

## 10.3 Disponibilidad

### Horario semanal

Configura por día de la semana qué horas estás disponible. Por staff o general.

### Fechas bloqueadas

Bloquea días específicos (vacaciones, feriados) — el agente IA no ofrecerá esos slots.

## 10.4 Calendarios conectados

### Google Calendar

1. Configuración → Agenda → Calendarios → "Conectar Google Calendar"
2. OAuth con Google
3. Selecciona qué calendario sincronizar
4. Listo — citas se crean en ambos lados

### Multi-calendar (según capacidad vigente)

La cantidad de calendarios se obtiene del plan activo y sus overrides. La pantalla
muestra el uso y el cupo aplicable; revísalo en **Configuración → Facturación**.

Resolución 3-tier al sincronizar:
1. Calendario específico del **servicio**
2. Calendario específico del **staff**
3. Calendario general del tenant

### Desconectar un calendario con citas futuras

La reasignación/cancelación guiada durante la desconexión no está certificada de
punta a punta. Antes de desconectar, reasigna o cancela manualmente todas las citas
futuras, recarga la agenda y confirma que ninguna siga vinculada. No confíes solo
en el mensaje visual de éxito.

## 10.5 Reserva por IA

El agente IA puede agendar citas usando un **state machine determinístico** (no LLM-driven):

1. **select_service** — bot pregunta qué servicio
2. **select_date** — fecha disponible
3. **select_time** — hora disponible
4. **confirm** — confirmación final + verificación anti-doble-booking
5. **booked** — cita creada

### Qué pasa al confirmar

- Se crea la cita en BD
- Se sincroniza con Google Calendar (si aplica)
- Se envía email de confirmación al cliente
- Se notifica al staff asignado
- Si es servicio online: se genera link Meet/Teams

### Después de la cita — Confirmación de asistencia

Cron horario (`@Cron('20 * * * *')`):
- Citas terminadas hace 2+ horas se marcan como `completed` automáticamente
- Mensaje de seguimiento opcional al cliente

---

# 11. Automatización

**Ruta:** IA y crecimiento → Automatización
**Roles:** Admin/Supervisor

## 11.1 Crear una regla (4 pasos)

1. **Trigger** — qué evento dispara la regla (mensaje recibido, lead creado, etapa cambió, etc.)
2. **Condiciones** — filtros (canal, palabras clave, etiqueta, score)
3. **Acciones** — qué hace (enviar mensaje, mover etapa, agregar tag, asignar agente, crear tarea)
4. **Programación** — inmediato o con delay

## 11.2 Secuencias de nurturing

Configurables: serie de mensajes con delays entre ellos. Cada paso puede:
- Enviar template
- Esperar X horas/días
- Esperar respuesta (con timeout)
- Bifurcar según respuesta
- Detener secuencia si el lead avanza de etapa

## 11.3 BullMQ y reintentos

Las acciones se procesan con BullMQ — 3 reintentos automáticos si falla. Visible en el log de la regla.

## 11.4 Acciones HTTP (llamadas a APIs externas)

Al crear una regla de automatización, entre las acciones disponibles encontrarás el nodo **"HTTP Request"** (color teal en el builder visual). Esto permite que tus automatizaciones se comuniquen con sistemas externos.

### Configurar una acción HTTP

1. En el builder de automatización, agrega una acción → selecciona **"HTTP Request"**
2. Configura los campos:
   - **Método**: GET, POST, PUT, PATCH o DELETE
   - **URL**: endpoint del servicio externo (ej: `https://tu-erp.com/api/leads`)
   - **Headers**: encabezados HTTP (Content-Type, Authorization, etc.)
   - **Body**: cuerpo de la petición (JSON). Soporta variables dinámicas:
     - `{{contact.name}}` — nombre del contacto
     - `{{contact.phone}}` — teléfono
     - `{{contact.email}}` — email
     - `{{deal.stage}}` — etapa actual del pipeline
     - `{{deal.value}}` — valor del deal
     - `{{conversation.channel}}` — canal de origen
3. **Mapeo de respuesta** (opcional): extrae campos de la respuesta JSON para usarlos en acciones posteriores de la misma regla

### Gestión de secretos

Para tokens de API y credenciales, usa la sección de **Secretos** en la configuración de la regla. Los secretos se almacenan cifrados y se referencian como `{{secrets.MI_TOKEN}}` en headers o body — nunca quedan expuestos en texto plano en la regla.

> **Tip:** Usa acciones HTTP para sincronizar leads con tu ERP, disparar webhooks en Slack, actualizar inventarios externos o registrar eventos en tu sistema de facturación.

## 11.5 Secuencias Drip

Las secuencias drip son flujos automatizados de **mensajes secuenciales con delays** entre cada paso. Ideales para nurturing de leads, onboarding de clientes o seguimiento post-venta.

**Ruta:** IA y crecimiento → Automatización → **Secuencias Drip**

### Crear una secuencia

1. Click **"+ Nueva secuencia"**
2. Nombre y descripción (ej: "Nurturing inmobiliaria — 7 días")
3. **Evento disparador**: qué inicia la secuencia para un contacto:
   - Lead creado
   - Etapa del pipeline cambió a X
   - Tag asignado
   - Formulario enviado
   - Manual (agregar contacto manualmente)
4. Click **"+ Agregar paso"** para cada mensaje de la secuencia

### Configurar cada paso

Cada paso tiene 3 componentes:

| Componente | Detalle |
|------------|---------|
| **Delay** | Tiempo de espera antes de enviar (minutos, horas o días) |
| **Tipo de mensaje** | Template aprobado, texto personalizado o mensaje generado por IA |
| **Condición de parada** | Cuándo sacar al contacto de la secuencia |

### Condiciones de parada automáticas

En la versión actual, la ejecución automática aplica:

- **Respuesta** del contacto.
- **Opt-out** del contacto.

La opción visible de **conversión** y las condiciones personalizadas todavía no se
evalúan automáticamente. Cuando el contacto convierta, desinscríbelo de forma
manual. Desactivar la secuencia evita nuevas inscripciones, pero los pasos ya
programados pueden continuar; desinscribe primero a los contactos activos.

### Ejemplo práctico

```
Día 0: "Hola {{nombre}}, gracias por tu interés en nuestros apartamentos..."
Día 2: "¿Sabías que tenemos financiación directa? Te cuento los beneficios..."
Día 5: "{{nombre}}, este fin de semana tenemos jornada de puertas abiertas..."
Día 10: "¿Te gustaría agendar una visita personalizada? Responde SÍ y te coordino"
```

> **Tip:** Mantén las secuencias cortas (3-5 pasos). Los leads que no responden después de 5 intentos tienen baja probabilidad de convertir — mejor redirige el esfuerzo.

## 11.6 Plantillas de automatización (galería)

Para facilitar la creación de reglas, Parallly ofrece una **galería de plantillas pre-configuradas** organizadas por categoría e industria.

**Ruta:** IA y crecimiento → Automatización → **Explorar plantillas**

### Categorías disponibles

- **Bienvenida**: mensaje de bienvenida al primer contacto, presentación del negocio
- **Nurturing**: secuencias de seguimiento para leads fríos o tibios
- **Recordatorios**: recordatorio de cita, de pago pendiente, de carrito abandonado
- **Clasificación**: auto-tagging por keywords, scoring automático, asignación a pipeline
- **Reactivación**: contactar leads inactivos, recall de clientes perdidos
- **Post-venta**: encuesta de satisfacción, solicitud de reseña, cross-sell

Las plantillas también se filtran por **industria** — si tu tenant es de salud, verás primero las plantillas de recordatorio de cita médica, confirmación de turno, etc.

### Instalar una plantilla

1. Navega o busca en la galería
2. Click en la plantilla → preview con descripción, trigger, condiciones y acciones
3. **"Instalar"** → se crea una copia de la regla en tu cuenta
4. Personaliza las variables (textos, delays, condiciones específicas de tu negocio)
5. La regla se crea **inactiva** por defecto — revísala y actívala cuando estés listo

> **Importante:** Las plantillas son un punto de partida. Siempre revisa y adapta los textos, delays y condiciones antes de activar.

---

# 12. Campañas y Broadcast

**Ruta:** IA y crecimiento → Campañas
**Roles:** Admin/Supervisor

## 12.1 Estado de disponibilidad

La pantalla permite preparar borradores, escoger una audiencia, revisar estados y
consultar métricas ya registradas. El lanzamiento desde el editor **no está
certificado de punta a punta para producción**:

- WhatsApp todavía no vincula de forma segura el texto escrito con el identificador
  y los componentes exactos de una plantilla aprobada por Meta.
- Una campaña programada no dispone de una acción operativa de cancelación.
- Email de campañas no habilita un canal conversacional de Email de autoservicio.

Hasta que la pantalla muestre un selector verificado de plantilla/emisor y una
acción de cancelación, no uses **Enviar ahora** ni programes campañas reales. Para
una prueba controlada, coordina primero con soporte.

## 12.2 Preparar un borrador

1. Crea la campaña y asigna un nombre interno sin datos sensibles.
2. Elige **Todos los contactos** o un segmento de **CRM → Segmentos**.
3. Revisa el número de destinatarios y las bajas de comunicación.
4. Guarda sin fecha de envío.

La capacidad vigente se consulta en la pantalla y en **Configuración →
Facturación**. Los controles A/B comparten la misma limitación del lanzamiento y
por ahora deben usarse solo como configuración de borrador.

## 12.3 Plantillas de WhatsApp

En **Canales → WhatsApp → Ver todas las plantillas** puedes consultar nombre
técnico, idioma, componentes y estado sincronizado con Meta. Parallly puede enviar
cuatro plantillas semilla (recordatorio de cita, confirmación de asistencia,
confirmación de pedido y pago recibido), pero Meta determina la aprobación y el
tiempo de revisión. Tener una plantilla aprobada no corrige por sí solo la
limitación actual del editor de campañas.

---

# 13. Base de Conocimiento

**Ruta:** IA y crecimiento → Base de conocimiento
**Roles:** Admin/Supervisor para editar; Agent en modo lectura

## 13.1 Tipos de contenido

- **FAQs** — preguntas y respuestas estructuradas
- **Documentos** — PDFs, DOCX, MD
- **URLs** — Parallly hace scraping y vectoriza
- **Texto libre** — políticas, manuales internos

## 13.2 Cómo lo usa el agente IA

RAG con pgvector: cuando el cliente pregunta algo, el agente busca chunks relevantes en tu KB y los inyecta en el prompt antes de responder.

## 13.3 Portal público

`https://admin.parallly-chat.cloud/kb/{tu-slug}` — versión pública de tu KB para clientes (light theme, sin auth). Ideal para enlazar desde tu web.

## 13.4 Análisis de brechas

**Ruta:** Base de Conocimiento → pestaña **"Brechas"**
**Roles:** Admin/Supervisor

El análisis de brechas te muestra dónde tu base de conocimiento tiene vacíos o contenido que necesita mejora, basándose en la interacción real de los clientes con el agente IA.

### Qué muestra

La pestaña Brechas organiza la información en tres categorías:

| Categoría | Qué contiene |
|-----------|-------------|
| **Consultas sin respuesta** | Preguntas de clientes que el agente no pudo responder porque no encontró información relevante en la KB |
| **Documentos con baja satisfacción** | Artículos que se usaron para responder pero recibieron reacciones negativas (thumbs down) |
| **Contenido obsoleto** | Documentos que no se actualizan hace tiempo y podrían necesitar revisión |

### Cómo se alimenta

El sistema de brechas se nutre de dos fuentes:

1. **Búsquedas RAG sin resultados**: cuando el agente busca en la KB y no encuentra chunks relevantes, la consulta se registra como "brecha"
2. **Feedback del inbox**: en cada respuesta del agente IA dentro del inbox, los agentes humanos pueden dar **thumbs up** 👍 o **thumbs down** 👎. Las respuestas negativas se vinculan al documento fuente para identificar contenido problemático

### Acciones recomendadas

- **Consultas sin respuesta** → crea un nuevo artículo o FAQ que cubra ese tema
- **Baja satisfacción** → revisa y mejora el documento fuente, agrega más detalle o corrige información incorrecta
- **Contenido obsoleto** → actualiza fechas, precios, políticas o elimina lo que ya no aplica

> **Tip:** Revisa la pestaña de brechas al menos una vez por semana. Es la forma más directa de mejorar la calidad de las respuestas de tu agente IA — cada brecha cerrada es un cliente mejor atendido.

---

# 14. Plantillas de Email

**Ruta:** Configuración → Plantillas de Email
**Roles:** Admin/Supervisor

## 14.1 Plantillas predeterminadas

Auto-creadas la primera vez que entrás:
- `appointment_confirmation` — confirmación de cita
- `appointment_reminder` — recordatorio antes de la cita
- `order_confirmation` — confirmación de orden
- `welcome` — bienvenida a nuevos clientes
- `recall` — recordatorio de visita

## 14.2 Flujos automáticos conectados

- Cita creada → `appointment_confirmation`
- 24h antes de la cita → `appointment_reminder`
- Orden completada → `order_confirmation`
- Cliente nuevo → `welcome`

## 14.3 Editor

- Visual con preview a la derecha
- Variables disponibles: `{{nombre}}`, `{{empresa}}`, `{{fecha}}`, `{{servicio}}`, etc.
- HTML + texto plano fallback
- Test send a tu propio email antes de activar

## 14.4 Template picker

Modal con 6 presets visuales — elige el estilo (corporativo, friendly, minimalista) y se rellena el contenido base.

---

# 15. Analytics y Reportes

**Roles:** Admin/Supervisor

## 15.1 Analytics del negocio

Pestañas:
- Resumen — KPIs principales
- Conversaciones — volumen y resolución
- CSAT — valoraciones de satisfacción registradas. En la versión actual, cerrar una conversación no envía una encuesta automática por el canal.
- Embudo, Velocidad, Win/Loss
- Fuentes — origen de leads

## 15.2 Reportes de agentes

Leaderboard con:
- Conversaciones atendidas
- Tiempo de primera respuesta
- Deals cerrados
- Tasa de conversión
- CSAT promedio

## 15.3 Indicadores personales del Agent

La app móvil puede presentar indicadores personales u operativos cuando el endpoint
y el tenant los autorizan. Esto **no habilita** la página web
`/admin/agent-analytics`: la ruta web de rendimiento del equipo está restringida a
Admin/Supervisor. Si el Agent necesita un informe adicional, debe solicitarlo a su
supervisor.

## 15.4 Tasa de resolución IA

**Roles:** Admin/Supervisor

Widget dedicado en la vista de Analytics que muestra qué porcentaje de conversaciones fueron resueltas completamente por el agente IA sin intervención humana, versus las que requirieron handoff a un agente.

### Qué muestra

- **Porcentaje de resolución IA**: conversaciones resueltas sin handoff / total de conversaciones × 100
- **Gráfico de tendencia**: evolución de la tasa a lo largo del tiempo (últimos 7, 30 o 90 días)
- **Desglose por canal**: tasa de resolución separada por las superficies que tengan conversaciones reales. Email solo aparece cuando existe una integración administrada con datos; no certifica configuración autoservicio

### Cómo se calcula

Una conversación se considera "resuelta por IA" si:
1. Se marcó como resuelta (manual o automáticamente por inactividad de 72h)
2. En ningún momento hubo handoff a un agente humano

### Cómo interpretar

Úsala como una señal operativa, no como una nota de calidad. Una tasa alta puede
coexistir con respuestas incorrectas o acciones no verificadas; una tasa baja puede
reflejar handoffs seguros y deliberados. Si cambia mucho por canal, revisa el tipo de
consultas, el agente asignado y las brechas de conocimiento.

Para decidir si un agente está preparado, probado y funcionando bien con evidencia
atribuida a su versión, consulta **Insights → Centro de calidad** (sección 8.5). Allí
la resolución verificada, la calidad conversacional observada, los fallos de
herramientas, los handoffs y los vacíos de conocimiento se muestran por separado.

---

# 16. Inventario y Pedidos

**Ruta:** Operación → Inventario / Pedidos
**Roles:** Inventario, Admin/Supervisor; Pedidos, Admin/Supervisor/Agent

## 16.1 Inventario

Catálogo de productos con stock:
- SKU, nombre, descripción, precio
- Stock actual
- Alertas de stock bajo
- Categorías
- Imágenes

## 16.2 Pedidos

Vista kanban: pendientes, confirmados, enviados, entregados, cancelados.

> Para industrias específicas hay vistas dedicadas: **Restaurantes** usa Pedidos de Comida en `/admin/food-orders` con tablero kanban tipo cocina.

---

# 17. Privacidad y Cumplimiento

**Ruta:** Configuración → Avanzado → Compliance
**Roles:** Admin

## 17.1 Funciones

- Detección automática de opt-out (palabras como "BAJA", "STOP", "NO MAS")
- Registro de consentimientos
- Audit log de accesos
- Exportación GDPR (descargar todos los datos de un contacto)
- Eliminación bajo solicitud (right-to-erasure)

## 17.2 Textos legales

**Ruta:** Configuración → Avanzado → Compliance → Textos legales

Permite gestionar todos los documentos legales que se presentan a los contactos. Cada texto legal tiene:

- **Nombre** y **descripción** del documento
- **Tipo de documento** — 7 tipos disponibles:
  - General
  - Política de privacidad
  - Términos de servicio
  - Consentimiento de procesamiento de datos
  - Divulgación de IA (AI disclosure)
  - Mensaje de opt-in
  - Confirmación de opt-out
- **Asignación multi-canal**: cada texto legal puede asociarse a los valores disponibles (WhatsApp, Instagram, Messenger, Telegram, SMS, Web, Email). Elegir Email aquí no conecta ni configura el canal; solo aplica cuando existe una integración administrada habilitada
- **Asignación multi-agente**: cada texto legal puede asignarse a agentes IA específicos. Si no se asigna a ninguno, aplica a todos los agentes
- **Filtro por tipo de documento** para localizar rápidamente los textos necesarios
- **Tarjeta visual mejorada**: cada texto legal muestra nombre, badge de tipo, versión, estado (activo/inactivo), chips de canales asignados y chips de agentes asignados

## 17.3 Baja automática

Si un cliente escribe "BAJA" o sinónimos → automáticamente:
- Marca el contacto como `opted_out`
- Detiene cualquier secuencia de nurturing
- No se le pueden enviar más broadcasts
- Queda registrado en audit_log

---

# 18. Configuración General

**Ruta:** Configuración

## 18.1 Cuenta (Admin, Supervisor, Agent, Viewer y Super Admin)
- Perfil personal
- Seguridad y cambio de contraseña
- Preferencias de notificaciones
- Apariencia

## 18.2 Empresa (Admin)
- Datos del negocio (nombre, dirección, teléfono, sitio)
- Logo (usado en emails y portal público)
- Horarios de atención
- Localización (idioma y zona horaria)

## 18.3 CRM, operación y conversaciones (Admin/Supervisor)
- Etapas del Pipeline
- Lead Scoring
- Custom attributes (campos personalizados)
- Reserva pública
- Macros (acciones rápidas con un click)
- Plantillas de email
- Pre-chat (formularios pre-conversación)
- Banco de medios

Nurturing y Recall son ajustes tenant-wide reservados actualmente a Admin.

## 18.4 IA avanzada (solo Super Admin de plataforma)

Las páginas de proveedores LLM, circuit breakers y ruteo global pertenecen a la
consola de plataforma. Un Tenant Admin configura el comportamiento de sus agentes
desde **IA y crecimiento → Agente IA**, pero no administra credenciales ni cadenas
globales de proveedores.

## 18.5 Seguridad (Admin, Supervisor, Agent, Viewer y Super Admin)

### Autenticación de dos factores (2FA)

**Ruta:** Configuración → Seguridad

Parallly soporta 2FA para proteger tu cuenta con un segundo paso al iniciar sesión.

**Métodos disponibles:**
1. **App autenticadora (TOTP)** — Google Authenticator, Authy, 1Password, etc. Escanea el QR y confirma el código de 6 dígitos
2. **Código por email** — recibís un código temporal de 6 dígitos a tu email registrado
3. **Códigos de respaldo** — 10 códigos de un solo uso que se generan al activar 2FA. Guardalos en un lugar seguro

**Activar 2FA:**
1. Configuración → Seguridad → "Activar 2FA"
2. Escanea el QR con tu app autenticadora
3. Ingresá el código de 6 dígitos para confirmar
4. Descargá los códigos de respaldo (solo se muestran una vez)

**Desactivar 2FA:**
1. Configuración → Seguridad → "Desactivar 2FA"
2. Confirma con tu contraseña actual

### Dispositivos de confianza

Cuando inicias sesión con 2FA, podés marcar **"Confiar en este dispositivo"**. Esto evita que te pida el segundo factor durante **30 días** en ese navegador.

- Cada dispositivo de confianza aparece en la lista con nombre, navegador y fecha
- Podés revocar dispositivos individualmente desde Configuración → Seguridad
- Al confiar un nuevo dispositivo, recibís un email de notificación de seguridad
- Si cambias tu contraseña, todos los dispositivos de confianza se revocan automáticamente

## 18.6 Canales, gobierno y desarrolladores

- **Admin:** canales e integraciones, políticas, compliance, webhooks, MCP y API keys.
- **Admin/Supervisor:** alertas y reportes.
- **Admin/Supervisor/Agent/Viewer y Super Admin:** solo los ajustes personales
  descritos en 18.1; este acceso no concede permisos de configuración del tenant.

## 18.7 Claves de API pública

**Ruta:** Configuración → Claves de API
**Roles:** Tenant Admin
**Planes:** según la capacidad `publicApi` del plan vigente

Las claves de API permiten que sistemas externos se conecten con tu cuenta de Parallly de forma programática — ideal para integraciones con tu ERP, CRM externo, sitio web o herramientas de automatización como Zapier o Make.

### Crear una clave de API

1. Configuración → **Claves de API** → **"+ Nueva clave"**
2. Nombre descriptivo (ej: "ERP Integración", "Zapier Webhook", "Sitio web")
3. **Seleccionar scopes** (permisos): elige qué puede hacer esta clave:
   - `read:contacts` / `write:contacts` — contactos
   - `read:deals` / `write:deals` — deals
   - `read:conversations` / `write:messages` — conversaciones y mensajes
   - `read:appointments` / `write:appointments` — citas
   - `read:webhooks` / `write:webhooks` — suscripciones webhook
   - `read:analytics` — analítica disponible en la API pública
4. Click **"Crear"**
5. Se muestra la clave completa **una sola vez** — cópiala y guárdala en un lugar seguro

### Advertencia de copia única

> **IMPORTANTE:** La clave se muestra completa solo en el momento de creación. Después solo verás los últimos 4 caracteres. Si la perdés, deberás revocarla y crear una nueva.

### Revocar o rotar una clave

1. Lista de claves → click en la clave
2. **"Revocar"** — la desactiva permanentemente. Cualquier sistema que la use dejará de funcionar
3. Para rotar: revoca la anterior y crea una nueva con los mismos scopes

### Uso de la clave

Incluye la clave en el header `X-API-Key` de tus peticiones HTTP:

```
GET https://api.parallly-chat.cloud/api/v1/bi-api/kpis
X-API-Key: pk_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

> **Tip:** Crea claves separadas por integración (una para Zapier, otra para tu ERP). Así si necesitas revocar una, no afectas a las demás.

## 18.8 Definiciones de triggers del Web Chat Widget

**Ruta:** Configuración → Canales e integraciones → Web Chat → **Triggers**
**Roles:** Tenant Admin

La pantalla permite guardar definiciones de triggers, pero el script público del
widget **todavía no las evalúa ni ejecuta en esta versión**. El chat que abre el
visitante sí funciona; no dependas de aperturas, burbujas o banners proactivos en
producción.

### Guardar una definición (sin ejecución pública todavía)

1. Configuración → Canales e integraciones → Web Chat → pestaña **Triggers**
2. Click **"+ Nuevo trigger"**
3. Selecciona la **condición** (cuándo se dispara):

| Condición | Descripción |
|-----------|-------------|
| **Tiempo en página** | Después de X segundos en la página actual |
| **Profundidad de scroll** | Cuando el visitante baja más del X% de la página |
| **Intención de salida** | Cuando el cursor se mueve hacia el botón de cerrar pestaña (exit intent) |
| **URL de la página** | Solo en páginas específicas (ej: `/precios`, `/contacto`) |
| **Número de visitas** | Cuando el visitante ha entrado N o más veces al sitio |

4. Selecciona la **acción** (qué hace al dispararse):

| Acción | Resultado |
|--------|-----------|
| **Abrir widget** | Se abre el chat automáticamente |
| **Mostrar burbuja** | Aparece un mensaje de burbuja junto al ícono del widget (ej: "¿Necesitas ayuda?") |
| **Mostrar banner** | Banner superior o inferior con mensaje y botón de acción |

5. Personaliza el **mensaje** del trigger.
6. Guarda la definición. El estado activo se almacena, pero no hace que el loader
   público la ejecute todavía.

### Ejemplos de configuración futura

- **Página de precios + 15 segundos** → burbuja: "¿Tienes dudas sobre nuestros planes? Te ayudo a elegir el mejor para ti"
- **Exit intent en checkout** → abrir widget: "¡Espera! ¿Puedo ayudarte a completar tu compra?"
- **3ra visita sin conversión** → banner: "Bienvenido de vuelta — agenda una demo gratuita"

> Estos ejemplos sirven para preparar la configuración; no describen un flujo
> operativo hasta que el cargador público incorpore el evaluador de triggers.

## 18.9 Suscripciones Webhook (integraciones externas)

**Ruta:** Configuración → Canales e integraciones → Webhooks
**Roles:** Tenant Admin

Las suscripciones webhook permiten que aplicaciones externas reciban notificaciones automáticas cuando ocurren eventos en tu cuenta de Parallly. Es la base para integraciones con **Zapier**, **Make (Integromat)**, **n8n** y cualquier sistema que consuma webhooks.

### Eventos disponibles

| Evento | Cuándo se dispara |
|--------|-------------------|
| `lead.created` | Se crea un nuevo contacto/lead |
| `message.received` | Llega un mensaje de un cliente (cualquier canal) |
| `conversation.closed` | Una conversación se marca como resuelta |
| `deal.stage_changed` | Un deal cambia de etapa en el pipeline |
| `appointment.booked` | Se agenda una nueva cita |

### Crear una suscripción webhook

1. Configuración → Avanzado → Webhooks → **"+ Nuevo webhook"**
2. **URL de destino**: la URL que recibirá los eventos (ej: tu endpoint en Zapier, Make o tu servidor)
3. **Eventos**: selecciona qué eventos quieres recibir
4. Guardar → Parallly envía un ping de verificación

### Payload

Cada evento se envía como POST con un payload JSON que incluye:
- `event`: nombre del evento
- `timestamp`: fecha/hora ISO
- `data`: objeto con los datos relevantes (contacto, mensaje, deal, cita, etc.)
- `tenantId`: identificador de tu tenant

### Ejemplo con Zapier

1. En Zapier, crea un Zap con trigger "Webhooks by Zapier → Catch Hook"
2. Copia la URL que te da Zapier
3. En Parallly, crea un webhook con esa URL y selecciona `lead.created`
4. Cada nuevo lead dispara el Zap → puedes enviarlo a Google Sheets, Slack, tu CRM externo, etc.

> **Tip:** Los webhooks se envían con reintentos automáticos (3 intentos con backoff exponencial). Si tu endpoint está caído temporalmente, no se pierden eventos.

---

# 19. Gestión de Usuarios

**Ruta:** Administración → Usuarios
**Roles:** Tenant Admin

## 19.1 Crear usuario

1. Botón "+ Invitar usuario"
2. Email + nombre + rol (admin / supervisor / agent)
3. Selecciona habilidades (skills) — para enrutar handoffs
4. Capacidad máxima de conversaciones simultáneas
5. Enviar — el usuario recibe email de invitación

## 19.2 Gestionar usuarios

- Editar rol y permisos
- Cambiar habilidades
- Reset password
- Activar / desactivar
- Ver actividad (últimas conversaciones, citas)

## 19.3 Habilidades del equipo

Tags como `WhatsApp`, `Inglés`, `Nivel-2`, `Pacientes-VIP`. Las usa el sistema de handoff con auto-assign para enrutar conversaciones al humano correcto.

Capacidad máxima: cuántas conversaciones puede tener un agente abiertas a la vez. Si está al máximo, el sistema busca el siguiente con skill compatible.

## 19.4 SLA y escalamiento

Cada conversación asignada tiene un SLA de 5 minutos por defecto:
- Si pasa sin respuesta → notificación al agente
- Si pasa 10 min → escala al supervisor (notificación de campana + sonido)

---

# 20. Facturación y Planes

**Ruta:** Configuración → Facturación
**Roles:** Tenant Admin

## 20.1 Catálogo vigente de planes

Parallly reconoce las familias **Emprendedor, Starter, Pro, Enterprise y Custom**,
pero la página solo muestra las filas activas que devuelve el catálogo de facturación.
Cada tarjeta informa el precio y moneda aplicables, ciclos disponibles, periodo de
prueba, límites y funciones incluidos para esa cuenta.

No uses precios o cuotas copiados de un documento antiguo: el catálogo activo y los
overrides del tenant son la fuente contractual vigente.

## 20.2 Precio, moneda y ciclo

El importe se presenta con la moneda y el periodo que devuelve la API para el país de
facturación. Si existe más de un ciclo, aparece el selector correspondiente; si un
plan o ciclo no está habilitado, no se ofrece como acción.

La tarjeta y el resumen de confirmación indican el total, la periodicidad y cualquier
ahorro aplicable. No asumas una moneda, descuento ni conversión fija fuera de esa vista.

## 20.3 Cambiar de plan

1. Abre **Configuración → Facturación**.
2. Selecciona una tarjeta cuyo botón de acción esté habilitado.
3. Revisa plan, ciclo, importe y fecha de efecto en el resumen.
4. Confirma solo si esos datos coinciden con lo esperado.

La API decide si el cambio es inmediato, programado o requiere contacto comercial.
La respuesta y el estado mostrados después de confirmar prevalecen sobre cualquier
regla histórica de upgrade o downgrade.

## 20.4 Método de pago

La acción para agregar o cambiar el método de pago aparece solo cuando el checkout
activo la soporta. El flujo puede abrir un formulario seguro o redirigir al proveedor
habilitado para la cuenta. Parallly muestra datos enmascarados y no solicita que pegues
credenciales sensibles en campos de texto libre.

Si el botón no aparece, consulta la modalidad indicada en la tarjeta del plan o
contacta al administrador comercial.

## 20.5 Pausar o reanudar

Estas acciones solo aparecen para suscripciones y proveedores compatibles. Antes de
confirmar, lee la fecha de efecto y las condiciones que presenta la interfaz.

Tras la operación, verifica el badge de estado y las fechas de acceso/cobro. Una
pausa no convierte las cuotas del plan en ilimitadas.

## 20.6 Pago pendiente y sincronización

Cuando la suscripción está en **Pago pendiente**, la página puede ofrecer **Cambiar
método de pago** y/o **Reintentar ahora**. La segunda acción consulta el estado real
del proveedor y actualiza la suscripción; no garantiza por sí sola un cobro exitoso.

Si ninguna acción está disponible, sigue el mensaje de la pantalla o contacta soporte
con el tenant, la hora y el identificador visible del pago, sin compartir datos de tarjeta.

## 20.7 Cancelar la suscripción

La interfaz muestra únicamente las modalidades permitidas para la suscripción, por
ejemplo cancelación al final del periodo o inmediata. El diálogo de confirmación
indica la fecha de pérdida de acceso y cualquier condición aplicable.

No presupongas reembolso, prorrateo ni conservación de acceso: verifica el resultado
y la fecha que devuelve la operación antes de cerrar el diálogo.

## 20.8 Cupones promocionales

Si la sección **Código de cupón** está visible:

1. Ingresa el código recibido.
2. Pulsa **Aplicar**.
3. Confirma el beneficio, vigencia y planes elegibles que devuelve el sistema.

Un código puede estar vencido, agotado, ya utilizado o no aplicar al plan/ciclo actual.
La respuesta del catálogo determina el descuento efectivo.

## 20.9 Historial de pagos

Cuando hay movimientos, la tabla muestra la fecha, monto, moneda, estado y referencia
disponible. Un comprobante o documento descargable solo aparece si el backend lo ha
publicado para ese pago; su ausencia no debe reemplazarse con un archivo inventado.

## 20.10 Periodo de prueba

La duración, necesidad de método de pago y acciones al vencimiento dependen del plan
y se muestran en su tarjeta y en el resumen de suscripción. Usa la fecha exacta de
finalización del panel para planificar la continuidad.

Los recordatorios, conservación de datos y restricciones posteriores al vencimiento
siguen la configuración vigente de la cuenta; no se debe asumir un plazo universal.

## 20.11 Uso y cuotas

Facturación puede mostrar consumo de mensajes IA, agentes, contactos, calendarios,
conocimiento, multimedia u otros recursos habilitados. Cada indicador compara uso y
cuota efectiva, incluidos overrides del tenant.

Si un recurso llega al límite, sigue el mensaje específico de esa capacidad. Algunas
funciones se bloquean y otras aplican un modo degradado; no todas reaccionan igual.

## 20.12 Después de un pago fallido

Un fallo puede cambiar el estado de la suscripción y mostrar un banner con acciones.
Revisa, en este orden:

1. estado y referencia del pago;
2. método disponible para corregirlo;
3. fecha límite o periodo de gracia que muestre la cuenta;
4. resultado después de reintentar o sincronizar.

Los reintentos, avisos y suspensión dependen del proveedor y de la política activa; no
hay un plazo universal que pueda inferirse de este manual.

## 20.13 Ciclos mensual y anual

El selector **Mensual / Anual** aparece solo si al menos un plan self-service publica
ambos ciclos. Cada tarjeta indica qué ciclo acepta, su importe y el ahorro devuelto por
el catálogo.

Al cambiar de ciclo, revisa el resumen: allí se informa si la operación es inmediata,
programada, requiere un nuevo método de pago o no está disponible.

## 20.14 Créditos SMS, cuando estén habilitados

SMS es una notificación saliente, no un canal conversacional (ver 9.5). La sección de
créditos solo aparece cuando la plataforma devuelve paquetes disponibles para la cuenta.

Si está visible, permite consultar saldo y consumo, elegir un paquete y continuar por
el checkout habilitado. El precio, moneda, acreditación y equivalencia de segmentos se
muestran antes de confirmar. Si la sección no aparece o la compra falla por capacidad
deshabilitada, no intentes enviar SMS desde Campañas y consulta al administrador.

## 20.15 Datos y documentos fiscales, cuando correspondan

La tarjeta **Datos fiscales** y los documentos relacionados dependen del país de
facturación, la configuración de plataforma y el proveedor activo. Si la cuenta los
requiere o los ofrece, completa únicamente los campos y tipos de documento que muestra
la pantalla y revisa el estado de cada documento publicado.

Un checkout puede pedir datos adicionales antes de continuar solo cuando el backend
lo indique para esa cuenta. Si la tarjeta o el aviso no aparecen, este manual no debe
interpretarse como una obligación fiscal universal.

---

# 21. Adaptación por Industria — Verticales

Parallly reconoce **18 industrias verticales**. El onboarding configura terminología,
pipeline, FAQs, servicios y módulos a partir de la industria y el subtipo; la pantalla
final también depende del rol, plan y capacidades publicadas para el tenant.

> **Alcance honesto:** las 18 verticales tienen comportamiento implementado, pero a
> agosto de 2026 ninguna cuenta todavía con certificación E2E completa. Usa estas
> secciones para operar lo que aparece habilitado en tu cuenta, no como garantía de
> cobertura total del sector. En actividades reguladas, decisiones sensibles y
> excepciones, interviene una persona autorizada.

| Vertical | Superficie principal posible |
|----------|------------------------------|
| Salud | Agenda y, según subtipo, planes de tratamiento |
| Moda y belleza | Agenda; catálogo/pedidos para boutique heredada |
| Inmobiliaria | Agenda e inmuebles |
| Restaurantes | Menú, pedidos y reservas |
| Automotriz | Vehículos; agenda, repuestos o alquiler según subtipo |
| Turismo | Tours o propiedades/estadías según subtipo |
| Educación | Cursos, cohortes e inscripciones |
| Finanzas | CRM y agenda, con handoff para decisiones financieras |
| Servicios profesionales | CRM, agenda y consulta contextual de casos |
| Retail | Inventario y pedidos |
| Tecnología | CRM/agenda; inventario y pedidos para hardware |
| Veterinaria | Agenda y mascotas |
| Gimnasios | Membresías y clases |
| Seguros | Cotizaciones, pólizas y reclamos con controles de rol |
| Servicios del hogar | Solicitudes de servicio |
| Servicios para mascotas | Agenda u hospedaje según subtipo |
| Fotografía | Sesiones fotográficas |
| Otro | CRM, catálogo y pedidos genéricos |

## 21.1 Turismo — Tours, Paquetes y Alquiler Vacacional

**Para quién:** agencias de viajes, operadores de tours, hoteles con experiencias, alquiler vacacional (Airbnb-style).

**Sub-tipos:**
- `tours` — agencias de día / multi-día
- `agencia_viajes` — operador full
- `alquiler_vacacional` — propiedades estilo Airbnb

### 21.1.1 Tours y Paquetes

**Ruta:** Operación → Tours

**Cómo crear paquetes:**
1. Tours → "Crear paquete"
2. Tipo: **Tour del día** (horas de duración) o **Paquete** (multi-día)
3. Nombre, destino, precio, capacidad máxima, idiomas
4. Guardar

**Cupos por fecha:**
1. Detalle del paquete → tab "Cupos por fecha"
2. "Agregar salida" → fecha + cupos totales + precio especial (opcional)
3. Barra de ocupación se actualiza visualmente
4. Sin fechas → el agente lo ofrece como "personalizable"

**Cómo el agente IA usa esto:**
"¿Qué tours tienen el sábado para 2 personas?" → llama `search_packages` → muestra opciones con disponibilidad → al confirmar llama `create_tour_booking`.

### 21.1.2 Propiedades (Alquiler vacacional)

**Ruta:** Operación → Propiedades

**Crear propiedad:**
1. Propiedades → "Crear propiedad"
2. Datos: nombre, dirección, capacidad, habitaciones, baños
3. **Amenidades** — 30 opciones en 6 categorías (acordeón):
   - Esenciales: WiFi, A/C, calefacción, agua caliente
   - Cocina: nevera, microondas, lavavajillas, cafetera
   - Confort: TV, Smart TV, Netflix, juegos
   - Espacio: piscina, jacuzzi, terraza, parrilla, estacionamiento
   - Seguridad: detector humo, caja fuerte, cámaras exteriores
   - Accesibilidad: rampa, baño accesible, ascensor

**Galería de imágenes:**
- Drag & drop, máximo 5 fotos, 2 MB cada una
- Reordenar, elegir foto portada
- Botones flecha para mover, ✓ para portada

**Límites por plan:** consulta **Configuración → Facturación**. Las cuotas de
propiedades se administran en runtime y pueden cambiar; una tabla histórica o un seed
del repositorio no reemplaza el límite mostrado para tu cuenta.

### 21.1.3 Calendario y sincronización iCal

**Tab Calendario:**
- Vista mensual con colores: verde (libre), rojo (reservado), ámbar (bloqueo manual), gris (pasado)
- Click en día disponible → click en otro día → modal "Bloquear del X al Y"

**Importar feeds (Airbnb / Booking):**
1. Tab "Calendario iCal" → "Agregar feed"
2. Nombre + plataforma + URL pública del calendario `.ics`
3. **Sync inmediato**: pill verde "OK" + N eventos importados, o roja con error
4. Cron cada 30 min sincroniza automáticamente

**Exportar tu calendario:**
1. Mismo tab → bloque "URL de exportación"
2. Click "Copiar" → pegá esa URL en Airbnb → "Sincronizar calendario"
3. Airbnb lee tu calendario aprox cada hora

**Anti-doble-booking:**
- Verificación en tiempo real al confirmar reserva
- iCal tiene delay 3-6h — para máxima protección, acepta reservas con 24h+ de anticipación

### 21.1.4 Reservas directas

1. Detalle de propiedad → tab "Reservas" → "Nueva reserva"
2. Fechas, huésped, teléfono, número de huéspedes
3. Precio se calcula automáticamente
4. Aparece en feed de exportación (Airbnb la ve)

### 21.1.5 Check-in

Tab "Check-in" en cada propiedad:
- Instrucciones (código de puerta, WiFi, parking)
- Reglas de la casa
- Hora de check-in / check-out
- El agente IA puede enviarlas automáticamente

## 21.2 Inmobiliaria — Listings de venta y arriendo

**Para quién:** inmobiliarias, asesores independientes, constructores con catálogo. NO para vacacional (eso es 21.1).

**Sidebar:** Inmuebles

**Cargar un inmueble:**
1. Inmuebles → "Crear inmueble"
2. Tipo: **Venta** o **Arriendo**
3. Datos: tipo (apartamento/casa/comercial/oficina/lote), precio, habitaciones, baños, m², parqueaderos, estrato, año
4. Dirección, barrio, ciudad
5. Para venta: marca crédito hipotecario / VIS si aplica
6. Para arriendo: administración (HOA), depósito, mínimo de meses

**Estados:**
`disponible` → `reservado` → `vendido` / `arrendado` / `inactivo`

**Cómo el agente IA usa esto:**
"Busco apto en Chapinero menos de 800M, 3 hab" → llama `search_listings` con esos filtros → muestra opciones reales → "¿Más info del segundo?" → llama `get_listing_details`.

**Filtros del agente:**
- transactionType, propertyKind, maxPrice/minPrice, minBedrooms, minAreaM2, neighborhood (búsqueda parcial), city.

## 21.3 Salud — Citas + Planes de Tratamiento

**Sub-tipos:** `dental`, `medico`, `fisioterapia`, `estetica`, `psicologia`, `general`

### 21.3.1 Planes de tratamiento

Para tratamientos multi-sesión (ortodoncia, fisioterapia, series estéticas, psicoterapia, etc.).

**Vista global:**
**Ruta:** Operación → Planes de tratamiento

Tabla con todos los planes activos/pausados/completados de la clínica:
- Paciente, plan, progreso (barra), estado, fecha inicio, costo
- Tabs por estado: Todos, Activos, Pausados, Completados, Cancelados
- Búsqueda por paciente o nombre del plan

**Vista por paciente:**
1. CRM → entra al lead/paciente
2. Tarjeta "Planes de tratamiento" en el panel izquierdo (collapsible)
3. "Crear plan" → tipo + sesiones totales + frecuencia + costo
4. Aparece la barra de progreso "0/N sesiones"

**Marcar sesiones completadas:**
- Expandir el plan → ves cada sesión
- Botón ✓ → progreso se actualiza
- Al completar todas → plan marca automáticamente como `completed`

**Cómo el agente IA usa esto:**
"¿Cuántas sesiones me faltan?" → `get_treatment_plan` → "Te quedan 5 sesiones de tu ortodoncia. Próxima 15 de mayo."

## 21.4 Veterinaria — Mascotas + Tratamientos

**Sub-tipos:** `clinica_general`, `especialidad`, `peluqueria_canina`, `daycare`

### 21.4.1 Fichas de mascotas

**Ruta:** Operación → Mascotas

Grid de cards de mascotas con:
- Foto / emoji por especie (🐕 perro, 🐈 gato, 🦜 ave, 🐰 conejo, 🦎 reptil)
- Nombre, raza, sexo, edad calculada
- Dueño (link al contacto)
- Conteo de vacunas
- Última visita (fecha)

**Filtros:**
- Tabs: Todas, Perros, Gatos, Otros
- Búsqueda por nombre, dueño o teléfono

**Crear / editar:**
Desde el detalle del contacto (dueño) → tarjeta "Mascotas" → "Agregar mascota":
- Nombre, especie, raza, sexo, esterilizado/a, fecha nacimiento, peso, color, microchip
- Alergias, condiciones crónicas, medicación actual
- Foto

**Vacunaciones:**
Detalle de la mascota → tab "Vacunas" → "Registrar vacuna" con tipo + fecha + lote + próxima fecha → el agente IA puede responder "¿Cuándo es la próxima vacuna de Toby?"

### 21.4.2 Planes de tratamiento veterinarios

Igual que 21.3 — sirve para tratamientos veterinarios multi-sesión (oncología, fisio, dietas).

## 21.5 Restaurantes — Menú + Pedidos

**Sub-tipos:** `restaurante`, `cafeteria`, `bar`, `delivery`, `cloud_kitchen`

### 21.5.1 Menú

**Ruta:** Operación → Menú

**Crear categoría:**
1. Menú → "Categoría" → nombre, orden visual

**Crear plato:**
1. "Crear plato" → categoría, nombre, descripción, precio
2. Foto (opcional)
3. Tags: vegetariano, vegano, sin gluten, picante, popular
4. Disponibilidad por horario
5. Ingredientes / opcionales con precio extra

### 21.5.2 Pedidos de comida (Kanban tipo cocina)

**Ruta:** Operación → Pedidos

Vista kanban con columnas:
- **Recibido** — entró pedido
- **En cocina** — preparándose
- **Listo** — para entregar / recoger
- **En camino** (delivery) — en ruta
- **Entregado** — completado
- **Cancelado**

Cada tarjeta muestra: número de pedido, items, total, tiempo desde creación, dirección (delivery), notas especiales.

Drag entre columnas para avanzar. Sonido de notificación al entrar nuevo pedido.

### 21.5.3 Promociones

Crear promos con dto. % o fijo, vigencia, condiciones (mín de pedido), aplicación automática vs código.

**Cómo el agente IA usa esto:**
"¿Tienen pizza?" → `list_menu_items(category: 'pizza')` → muestra opciones → al ordenar llama `create_food_order` → aparece en kanban de cocina.

## 21.6 Gimnasios — Membresías + Clases

**Sub-tipos:** `gimnasio`, `crossfit`, `yoga`, `pilates`, `boxeo`, `funcional`

### 21.6.1 Planes de membresía

**Ruta:** Operación → Membresías

**Crear plan:**
1. "Crear plan" → nombre (ej: Mensual, Trimestral), precio, duración (días)
2. Beneficios incluidos (clases, acceso fitness, parking, etc.)
3. Política de congelamiento (cuántos días puede pausar)

### 21.6.2 Miembros

Lista de miembros con:
- Nombre, plan actual, fecha inicio, vencimiento
- Estado: activo, congelado, expirado
- Check-ins recientes
- Plan congelado / despertar

### 21.6.3 Clases programadas

**Ruta:** Operación → Clases

Calendario con clases:
- Tipo (yoga, crossfit, spinning, funcional)
- Coach asignado
- Capacidad máxima + cupos disponibles
- Recurrencia (lunes/miércoles/viernes 7am)

### 21.6.4 Reservas y check-ins

- Miembros reservan clases via WhatsApp / Instagram
- Check-in al llegar al gym (manual o QR)
- Sistema de tasa de fill (% de ocupación) por clase
- Recall a inactivos (>30 días sin check-in)

**Cómo el agente IA usa esto:**
"¿Hay yoga mañana?" → `list_classes(date: tomorrow, type: 'yoga')` → ofrece horarios con cupos → al confirmar llama `book_class`.

## 21.7 Educación — Cursos y Cohortes

**Sub-tipos:** `escuela`, `instituto`, `idiomas`, `coaching`, `cursos_online`, `tutorias`

### 21.7.1 Cursos

**Ruta:** Operación → Cursos

**Crear curso:**
1. Nombre, descripción, duración (semanas), precio total
2. Modalidad: presencial / online / híbrido
3. Nivel: básico / intermedio / avanzado
4. Imagen de portada

### 21.7.2 Cohortes (camadas)

Cada curso tiene cohortes (versiones que arrancan en diferentes fechas):
- Fecha inicio / fin
- Capacidad máxima
- Docentes asignados
- Horario semanal
- Estado: planeada, abierta inscripciones, en curso, completada

### 21.7.3 Inscripciones

Lista de estudiantes inscritos a cada cohorte:
- Datos del alumno
- Estado pago: pendiente / pagado / parcial / vencido
- Tasa de pago general por cohorte

### 21.7.4 Pruebas de nivel

Para idiomas / coaching técnico:
- El agente IA toma datos básicos
- Asigna nivel sugerido
- Recomienda curso adecuado

**Cómo el agente IA usa esto:**
"Quiero aprender inglés" → `take_placement_test` → preguntas básicas → "Te recomiendo el nivel B1, este es el curso más cercano que arranca el 15 de junio".

## 21.8 Seguros — Planes, Cotizaciones, Pólizas y Reclamos

**Sub-tipos:** `salud`, `auto`, `hogar`, `vida`, `viaje`

### 21.8.1 Planes

**Ruta:** Operación → Seguros → Planes

**Crear plan:**
1. Nombre, tipo (salud/auto/hogar/vida/viaje)
2. Cobertura, exclusiones, precio mensual/anual
3. Edad mínima/máxima
4. Documentación requerida

### 21.8.2 Cotizaciones

Cliente pide cotización:
1. Agente IA toma datos básicos (edad, situación, intereses)
2. Llama `quote_insurance(planId, customerData)` → calcula prima
3. Genera cotización formal con vigencia (típicamente 15 días)
4. Cliente puede aceptar → pasa a póliza

### 21.8.3 Pólizas activas

Lista de pólizas vigentes:
- Cliente, plan, prima mensual
- Fecha emisión, vigencia
- Estado: activa, suspendida (impago), cancelada
- Número de póliza

### 21.8.4 Reclamos (claims)

**Ruta:** Operación → Seguros → Reclamos

Cliente reporta siniestro:
1. Datos del incidente (fecha, lugar, descripción)
2. Fotos / documentos
3. Estado: recibido → en revisión → aprobado / rechazado → pagado
4. Tracking del cliente: "¿Cómo va mi reclamo del 5 de mayo?"

## 21.9 Servicios del hogar — Despacho de técnicos

**Sub-tipos:** `plomeria`, `electricidad`, `fumigacion`, `limpieza`, `jardineria`, `aire_acondicionado`, `general`

### 21.9.1 Solicitudes de servicio

**Ruta:** Operación → Solicitudes

Vista priorizada por urgencia + scheduled_at:
- 🔴 Emergencia (fugas, sin luz)
- 🟠 Alta (urgente pero no crítico)
- 🟢 Normal
- 🔵 Flexible

**Cada solicitud:**
- Cliente (nombre, teléfono)
- Tipo de servicio
- Dirección + notas (referencia, "casa amarilla")
- Descripción del problema
- Fotos del problema
- Fecha/franja preferida ("mañana en la mañana", "14:00-16:00")
- Costo estimado (rango)
- Técnico asignado
- Estado: pendiente → cotizado → agendado → despachado → en curso → completado

### 21.9.2 Asignación de técnicos

Drag manual a un técnico, o el agente IA lo asigna automáticamente según skills (plomero / electricista) y carga.

**Cómo el agente IA usa esto:**
"Tengo una fuga en el baño" → `create_service_request(type: 'plomeria', urgency: 'emergencia', address, photos)` → confirma "Iván llega entre 9:00-11:00".

## 21.10 Servicios para mascotas — Daycare y peluquería canina

**Sub-tipo:** `pet_services`

Comparte ficha de mascotas (sección 21.4.1) + agenda de citas pero con servicios específicos:
- Baño y peluquería
- Daycare diario
- Hospedaje (boarding)
- Adiestramiento

## 21.11 Fotografía — Sesiones y galerías

**Sub-tipos:** `bodas`, `productos`, `eventos`, `retrato`, `familia`, `recien_nacido`

### 21.11.1 Sesiones

**Ruta:** Operación → Sesiones fotográficas

Cards por sesión con:
- Cliente, paquete contratado
- Tipo (boda / retrato / evento / producto / familia / recién nacido)
- Fecha programada, ubicación
- Estado: agendada → en curso → entregada → cancelada
- Precio + depósito pagado
- Tracking de entrega: "X / Y fotos entregadas"
- Link de galería (Pixieset, Pic-Time, Drive) cuando se entrega

**Tabs por estado:** Todas, Agendadas, En curso, Entregadas, Canceladas. Búsqueda por cliente o paquete.

### 21.11.2 Reserva por IA

"Quiero una sesión de boda para junio" → el agente toma fecha, paquete, ubicación → crea registro en `photo_sessions` con estado "agendada" → el equipo del estudio la confirma y completa con depósito.

### 21.11.3 Entrega de galería

1. Detalle de la sesión → "Marcar como entregada"
2. Pega URL de la galería (con contraseña opcional)
3. El sistema cambia a `delivered`, registra `deliveredAt`
4. El agente puede mandar el link al cliente automáticamente

## 21.12 Moda y belleza — Agenda, tratamientos y catálogo

**Subtipos vigentes:** salón de belleza, barbería, spa y estética. El subtipo
`boutique` se conserva para tenants heredados.

- Salón, barbería, spa y estética usan **Agenda** para servicios y disponibilidad.
- Spa y estética pueden habilitar **Planes de tratamiento**.
- Una boutique heredada usa catálogo/inventario y pedidos en vez de agenda.

El agente puede orientar y reservar con la información configurada, pero no debe
diagnosticar, garantizar resultados ni recomendar productos no autorizados.

## 21.13 Automotriz — Vehículos, citas, repuestos y alquiler

**Subtipos:** concesionario, taller, repuestos y alquiler.

- Concesionario y taller combinan inventario vehicular con agenda para visitas,
  revisiones o pruebas de manejo.
- Repuestos usa inventario y pedidos.
- Alquiler usa el workspace de alquileres de vehículos.

La pantalla exacta se deriva del subtipo y capacidades publicadas. Una prueba de
manejo creada no implica aprobación de financiación ni reserva definitiva del vehículo.

## 21.14 Finanzas — CRM y agenda con límites regulados

**Subtipos:** asesoría, fintech y créditos.

Esta vertical ofrece un preset horizontal de CRM, FAQs y agenda. Sirve para captar,
calificar y coordinar consultas; no automatiza aprobación de crédito, recomendaciones
de inversión, rentabilidades ni asesoría tributaria individual. Esas decisiones deben
pasar a una persona autorizada.

## 21.15 Servicios profesionales — Consultas y casos

**Subtipos:** abogados, contadores, arquitectos y consultores.

Combina CRM, FAQs y agenda. Cuando el tenant publica la capacidad correspondiente, el
agente puede consultar el estado contextual de un caso tras validar la identidad
requerida. No existe una promesa de expediente jurídico/contable completo ni de
asesoría profesional automática.

## 21.16 Retail — Inventario y pedidos

**Subtipos:** moda, electrónica, hogar y marketplace.

La operación principal usa **Inventario** y **Pedidos**. El catálogo permite consultar
productos disponibles y el flujo de órdenes usa los estados habilitados por el backend.
Precios, stock y condiciones deben venir de los datos vigentes del tenant; el agente no
debe inventarlos.

## 21.17 Tecnología — Demos, servicios y hardware

**Subtipos:** SaaS, consultoría TI, desarrollo y hardware.

- SaaS, consultoría y desarrollo usan CRM y agenda para demos o reuniones.
- Hardware usa inventario y pedidos.

La vertical ayuda a organizar el ciclo comercial, pero no sustituye herramientas de
gestión de proyectos, soporte técnico o licenciamiento si esas capacidades no aparecen
habilitadas en la cuenta.

## 21.18 Otro — Fallback genérico

Cuando una empresa no encaja en las categorías anteriores, Parallly usa un preset
estable de CRM, FAQs, catálogo y pedidos. El nombre de la operación se mantiene
genérico y no se infieren módulos especializados. Un Admin puede completar identidad,
pipeline, conocimiento y catálogo desde la web.

---

# 22. Sistema de Recall

**Para quién:** dentales (revisión semestral), gimnasios (inactividad), estética (series), veterinarias (vacunas), cualquier negocio con visitas recurrentes.

**Roles:** Admin/Supervisor

## 22.1 Configuración

**Ruta:** Configuración → Herramientas → Recall

| Campo | Detalle |
|-------|---------|
| Habilitado | On/Off |
| Días umbral | A partir de cuántos días sin visita disparar (ej: 180 dental) |
| Días cooldown | No re-disparar a la misma persona en N días |
| Canal | WhatsApp; Email solo para integraciones administradas habilitadas |
| Mensaje | Template con `{name}` y `{months}` |

La opción Email de Recall usa entrega administrada cuando está habilitada; no activa
la pantalla **Canales → Email** ni sustituye el contrato autoservicio faltante.

Ejemplo de mensaje:
```
Hola {name}, ya pasaron {months} meses desde tu última visita. ¿Quieres agendar tu cita de control?
```

## 22.2 Cron y disparo

- Cron diario a las 9 AM (hora del servidor)
- Busca contactos con `last_appointment_at` más viejo que `daysThreshold`
- Envía template via canal seleccionado (respeta límites de plan)
- Marca `next_recall_at` con cooldown — no spammea

## 22.3 Probarlo manualmente

Botón "Disparar ahora" — útil para pruebas controladas. Solo afecta a contactos que cumplen criterio.

> Para que `last_appointment_at` se actualice: marca las citas como `completed` desde Citas o deja que el cron las auto-complete después de 2h.

---

# 23. Sistema de Ayuda Contextual

Parallly combina las descripciones y estados vacíos de cada página con el asistente
global **Parallly Assist**. No todas las pantallas tienen un tutorial propio.

## 23.1 Ayuda de la página

- El título y la descripción explican el propósito de la sección.
- Los estados vacíos indican la primera acción disponible.
- Los mensajes de validación y error muestran cuándo reintentar o pedir ayuda.
- El breadcrumb y la búsqueda global ayudan a regresar o localizar otro módulo.

## 23.2 Parallly Assist

El botón flotante abre un chat que responde preguntas sobre el uso de la plataforma
con la base de ayuda versionada y el contexto autorizado de página, rol, plan y
vertical. También ofrece sugerencias rápidas y, para los roles habilitados, puede
reiniciar el tour. Sus respuestas siguen los permisos del usuario: conocer una
función no concede acceso a su pantalla.

> La fuente runtime de Parallly Assist es
> `apps/api/kb/assistant/{es,en,pt,fr}`. Este manual no se carga automáticamente en
> el asistente. El contrato de actualización está en
> [platform-assistant-knowledge.md](platform-assistant-knowledge.md).

## 23.3 Cómo usar ambas ayudas

1. Lee la descripción o el estado vacío si necesitas la primera acción de la página.
2. Abre el botón flotante para preguntar por esa sección o por un flujo entre páginas.
3. Indica qué quieres hacer. El sistema conoce la página actual y deriva rol y tenant de
   la sesión; no necesita confiar en un rol escrito dentro del chat.
4. Verifica que la ruta sugerida sea visible para tu cuenta.

Parallly Assist está autorizado para Tenant Admin, Tenant Supervisor y Tenant Agent;
`tenant_viewer` no tiene acceso al chat. En modo plataforma, `super_admin` debe usar
la documentación operativa correspondiente o entrar al tenant mediante el flujo
explícito de impersonación; no existe una KB runtime completa de plataforma.

---

# 24. Conversaciones Resueltas

Las conversaciones inactivas por 72+ horas se marcan automáticamente como `resolved` para limpiar el inbox.

## 24.1 Verlas

1. Bandeja → barra de filtros → click pill **"Resueltas"**
2. Aparecen ordenadas por fecha de resolución (más reciente arriba)
3. Click en una para ver el historial completo en modo solo-lectura

## 24.2 Reabrir una conversación

Dentro de la conversación resuelta:
- Banner gris con check verde + botón **"Reabrir conversación"**
- Click → vuelve al inbox activo
- Filtro cambia a "Todos" automáticamente

## 24.3 Cuándo conviene reabrir

- Cliente respondió por otro canal y querés continuar en chat
- Necesitas hacer follow-up manual
- Te equivocaste al cerrarla

---

# 25. Subir Fotos a Catálogos

Todas las pantallas de catálogo (Propiedades, Inmuebles, Tours, Menú, Mascotas) tienen pestaña dedicada **"Fotos"**:

1. **Drag & drop** o click para seleccionar — múltiples archivos
2. **Límites**: máximo 5 fotos por anuncio, 2 MB por foto, formato imagen
3. **Barra de progreso**: "Subiendo 3 de 5..."
4. **Reordenar**: hover sobre una foto → flechas ← → para mover, ✓ para "usar como portada"
5. **Foto portada**: la primera es la que aparece en cards de listado
6. **Cambios pendientes**: si reordenaste o eliminaste, barra sticky abajo "Cambios sin guardar" → click "Guardar"

Si una foto se rechaza (>2 MB o no es imagen), aparece mensaje específico con nombre del archivo. Las que sí pasaron se suben sin bloquear.

---

# 26. App Móvil

Parallly Mobile es una compañera operativa para Inbox, CRM, embudo, tareas,
disponibilidad y el workspace de la industria. No replica la configuración completa
del dashboard web.

- **Tabs:** Inbox, CRM, Operación adaptada y Más.
- **Conversación:** asignar/tomar control, devolver a IA, resolver, notas, macros,
  sugerencias y resumen, según rol y estado; los mensajes sin conexión pueden quedar
  en una outbox local aislada por cuenta hasta reconectar.
- **CRM:** consultar o crear leads y mover deals cuando el backend lo autoriza.
- **Operación:** agenda, estadías, tours, pedidos, clases, matrículas, seguros,
  solicitudes, sesiones, alquileres o mascotas según capacidades publicadas.
- **Más:** disponibilidad, tareas, indicadores permitidos, idioma, push y cuenta.

La configuración de canales, agentes IA, usuarios, facturación, empresa e
integraciones continúa en la web. Consulta la guía completa en
[mobile-user-manual.md](mobile-user-manual.md).

> La existencia del código o de un build de prueba no confirma aprobación ni
> visibilidad pública en una tienda. Comprueba la versión instalada y el estado de la
> publicación antes de una prueba.

---

# 27. Procesamiento Multimedia

Parallly permite que tus agentes IA comprendan mensajes de voz e imágenes enviados por los clientes, no solo texto.

## 27.1 ¿Cómo funciona?

Cuando un cliente envía un **audio** o **imagen** por cualquier canal (WhatsApp, Instagram, Messenger, Telegram):

1. El sistema descarga el archivo del canal correspondiente
2. Verifica que no se excedan los límites de tu plan (ver 27.3)
3. Procesa el contenido:
   - **Audio**: transcribe la nota de voz a texto usando IA (OpenAI Whisper)
   - **Imagen**: describe el contenido visual usando IA (visión por computadora)
4. Inyecta el resultado en la conversación antes de que el agente IA responda
5. El agente IA puede entonces responder con contexto completo

**Ejemplo audio:** El cliente envía un audio de 30 segundos preguntando por precios → el agente recibe `[El cliente envió un mensaje de voz: "Hola, quería saber cuánto cuesta el servicio de limpieza dental..."]` → responde con los precios.

**Ejemplo imagen:** El cliente envía foto de un producto dañado → el agente recibe `[El cliente envió una imagen: Se observa un producto electrónico con la pantalla rota...]` → responde con instrucciones de garantía.

## 27.2 Canales soportados

| Canal | Audio | Imagen |
|-------|-------|--------|
| WhatsApp | ✅ | ✅ |
| Instagram | ✅ | ✅ |
| Messenger | ✅ | ✅ |
| Telegram | ✅ | ✅ |
| SMS | ❌ | ❌ |
| Web Chat | ❌ | ❌ |

## 27.3 Límites y protección de uso

El backend obtiene las cuotas mensuales, duración máxima y límites de ráfaga desde
el plan vigente y los overrides del tenant. Consulta **Configuración →
Facturación** para confirmar los valores actuales; no uses cifras copiadas de una
versión anterior del catálogo.

Además hay protecciones automáticas contra abuso:
- Límite por conversación (ráfaga de 3-5 archivos en 5 minutos)
- Límite por tenant por hora (20-1.000 según plan)
- Presupuesto diario de costo (para evitar picos inesperados)

## 27.4 ¿Qué pasa cuando se alcanza el límite?

- El mensaje multimedia se registra normalmente en la conversación
- Pero NO se transcribe ni analiza — el agente IA recibe un texto genérico: "El cliente envió un audio" / "El cliente envió una imagen"
- El agente responde pidiendo que el cliente lo describa por texto
- Puedes monitorear tu uso en **Configuración → Facturación** (barras de uso multimedia)

## 27.5 Monitoreo de uso

En la página de **Facturación** (Configuración → Facturación) verás:

- **Barra de audio**: uso mensual con porcentaje (icono de micrófono)
- **Barra de imagen**: uso mensual con porcentaje (icono de ojo)
- Advertencia al 80%: banner ámbar "Te estás acercando al límite"
- Advertencia al 95%: banner rojo "Límite casi alcanzado" con link directo a mejorar plan

> **Tip:** Si necesitas procesar más multimedia, considera actualizar tu plan. El agente IA es más efectivo cuando puede entender audios e imágenes.

---

# 28. Integraciones y API Pública

Esta sección agrupa las funcionalidades de integración con sistemas externos. Para configuración detallada de cada una, consulta las secciones específicas:

| Funcionalidad | Sección | Descripción |
|--------------|---------|-------------|
| **Claves de API** | [18.7](#187-claves-de-api-pública) | Crear y gestionar API keys para acceso programático |
| **Webhooks** | [18.9](#189-suscripciones-webhook-integraciones-externas) | Recibir notificaciones de eventos en sistemas externos (Zapier, Make) |
| **Acciones HTTP** | [11.4](#114-acciones-http-llamadas-a-apis-externas) | Llamar APIs externas desde reglas de automatización |
| **Definiciones de Web Chat Triggers** | [18.8](#188-definiciones-de-triggers-del-web-chat-widget) | Preparar reglas; ejecución pública pendiente |

### Guía rápida de integración

**¿Quieres enviar datos de Parallly a otro sistema?**
→ Usa **Suscripciones Webhook** (18.9). Parallly enviará eventos (lead creado, cita agendada, etc.) a tu endpoint.

**¿Quieres leer o escribir datos desde otro sistema?**
→ Crea una **Clave de API** (18.7) y usa la API REST de Parallly.

**¿Quieres que una automatización llame a un servicio externo?**
→ Agrega una **Acción HTTP** (11.4) en tu regla de automatización.

**¿Quieres conectar con Zapier o Make?**
→ Combina Webhooks (para recibir eventos) + API Keys (para enviar datos). Configura el trigger en Zapier como "Catch Hook" y la acción con la API de Parallly.

---

# 29. Probar agente — Simulación

Antes de publicar cambios en tu agente IA, pruébalo contra conversaciones realistas sin tocar producción. Es como un "CI/CD para tu agente".

**Dónde:** menú → **Agente IA → Probar agente** (`/admin/agent/simulation`).

## 29.1 Cómo funciona

1. Elige el **agente** a probar.
2. Elige el **origen de escenarios**:
   - **Sintéticos** — la IA genera clientes variados de tu industria (fáciles, escépticos, molestos, comparadores de precio, etc.).
   - **Históricos** — reproduce conversaciones reales de tus clientes pasados.
3. Define cuántos escenarios correr (por defecto 50).
4. (Opcional) Elige una corrida previa como **línea base** para detectar regresiones.
5. Pulsa **Ejecutar simulación**.

La simulación corre en segundo plano: un "cliente simulado" conversa con tu agente y un evaluador IA califica cada conversación (resolución, tono, precisión, empatía).

> 🔒 **Seguro:** la simulación NUNCA crea citas, pedidos ni descuentos reales — las herramientas se desactivan durante la prueba.

## 29.2 Resultados

- **Puntaje promedio** (0-10) y **tasa de resolución** estimada.
- **Sub-puntajes** por dimensión (resolución, tono, precisión, empatía).
- **Detección de regresiones** vs. la línea base: te avisa si una respuesta empeoró.
- **Tabla de escenarios**: clic en cualquiera para ver la transcripción completa y los problemas detectados.

Úsalo cada vez que cambies la persona, las reglas o la base de conocimiento, antes de exponerlo a clientes reales.

---

# 30. Procedimientos (SOP)

Escribe un procedimiento operativo en español ("cuando pidan un reembolso: verifica la orden → si está entregada ofrece un cupón → si no, escala a un agente") y el agente lo ejecutará **paso a paso, sin improvisar el flujo**.

**Dónde:** menú → **Agente IA → Procedimientos** (`/admin/procedures`).

## 30.1 Crear un procedimiento

**Opción A — Escribe tu SOP (recomendada):**
1. Pulsa **Escribir SOP**.
2. Describe el procedimiento en lenguaje natural.
3. La IA lo **compila** a una secuencia de pasos determinísticos que quedan como **borrador** para tu revisión.

**Opción B — En blanco:** construye los pasos manualmente.

## 30.2 Tipos de paso

| Tipo | Qué hace |
|------|----------|
| **Mensaje** | Comunica algo al cliente |
| **Preguntar** | Pide un dato y lo guarda (ej: número de orden) |
| **Herramienta** | Ejecuta una acción (consultar pedido, buscar producto…) |
| **Condición** | Evalúa un dato y bifurca el flujo |
| **Escalar** | Transfiere a un agente humano |

## 30.3 Activar

- Define las **palabras que lo activan** (ej: "reembolso, devolución, garantía"). Cuando un cliente las menciona, el procedimiento arranca.
- Activa/desactiva el procedimiento y consulta su **versión** (se incrementa en cada cambio).

> El agente solo decide *cómo* expresar cada paso con naturalidad; el *flujo* lo controla el motor — por eso nunca se "inventa" pasos.

---

# 31. Agente que vende — Skillsets y upsell

Configura si tu agente **vende, da soporte, o ambos**, y cómo recomienda productos.

**Dónde:** menú → **Agente IA → (tu agente) → Capacidades**.

## 31.1 Skillset

- **Ventas** — recomienda y cierra ventas.
- **Soporte** — resuelve dudas y pedidos.
- **Ambos** — equilibra: primero resuelve, y cuando aporta valor, conecta con una recomendación.

## 31.2 Upsell / cross-sell

Cuando el skillset es Ventas o Ambos, puedes activar el **upsell** y elegir su intensidad:
- **Sutil** — sugiere complementos solo cuando encajan.
- **Moderada** — ofrece una mejora relevante por conversación.
- **Agresiva** — busca oportunidades en cada interacción (siempre con tacto).
- **Descuento máximo (%)** — tope que el agente puede ofrecer al negociar.

## 31.3 Tienda e-commerce

Si activas la tarjeta **Tienda e-commerce**, el agente puede:
- **Recomendar productos** del catálogo conectado (Shopify/WooCommerce) — nunca inventa productos.
- Consultar el **estado de un pedido** del cliente.
- Aprobar **descuentos** dentro del límite (si lo habilitas).

---

# 32. Integraciones verticales

Conecta tu **sistema real** por industria para que el agente trabaje con datos en vivo, no solo con prompts.

**Dónde:** **Configuración → Canales e integraciones → Integraciones verticales**.

| Integración | Industria | Qué sincroniza |
|-------------|-----------|----------------|
| **Toast** | Restaurantes | Menú, ítems y precios (toma de pedidos por chat) |
| **Mindbody** | Gimnasios | Clases y horarios |
| **Cliniko** | Salud | Tipos de cita y disponibilidad (sin acceder al historial clínico) |

Para cada una: ingresa las credenciales, pulsa **Probar** la conexión y **Sincronizar**. Una vez conectada, el agente usa automáticamente esos datos al responder.

---

# 33. Conectores MCP

**MCP (Model Context Protocol)** es un estándar abierto para conectar "herramientas de acción" a la IA, sin quedar atado a un proveedor.

**Dónde:** **Configuración → Desarrolladores → MCP**.

- **Tu servidor MCP** — expón las herramientas de tu agente (catálogo, FAQs, base de conocimiento…) a clientes MCP externos mediante un endpoint, autenticado con tu API Key.
- **Servidores MCP externos** — conecta servidores MCP de terceros (añadir/probar/activar): tu agente podrá usar sus herramientas automáticamente.

---

# 34. Organizaciones B2B y forecast

Agrupa contactos por **empresa/cuenta** y proyecta tus ingresos.

**Dónde:** menú → **CRM → Organizaciones** (`/admin/contacts/organizations`).

## 34.1 Organizaciones

- Crea cuentas empresariales con industria, sitio web, tamaño, etc.
- Cada cuenta muestra sus **contactos**, **deals abiertos** y **valor ponderado** del pipeline.
- Clic en una cuenta para ver su detalle (miembros + oportunidades).

## 34.2 Forecast (pronóstico)

- **Pipeline ponderado** — suma de (valor × probabilidad de cada etapa).
- **Comprometido** — valor en etapas con ≥80% de probabilidad.
- **Mejor caso** — valor total del pipeline abierto.
- **Velocidad** — días promedio para ganar + ventas por mes.
- Desglose del valor ponderado **por etapa**.

## 34.3 Deals estancados (rotting)

El sistema marca automáticamente las oportunidades abiertas **sin movimiento** durante demasiados días y las muestra como alertas, para que tu equipo las reactive.

---

# 35. Atribución de marketing

Mide el embudo **Anuncios → WhatsApp → venta** y el ROI de tus campañas.

**Dónde:** menú → **Análisis → Atribución** (`/admin/attribution`).

## 35.1 Click-to-WhatsApp

Cuando un cliente llega desde un **anuncio de Click-to-WhatsApp** (Facebook/Instagram), Parallly captura automáticamente el anuncio de origen. Luego verás:
- **Embudo**: clics → contactos → leads → ventas.
- **KPIs**: clics, conversiones, ingresos atribuidos, tasa de conversión.
- **Rendimiento por anuncio**: qué anuncio genera más ventas e ingresos.

## 35.2 Ingresos por campañas (broadcast)

Atribuye ingresos a tus campañas de broadcast: de los destinatarios que recibieron la campaña, cuántos compraron y cuánto ingreso generaron (ventana de 30 días).

Usa el selector de rango (30 / 90 / 365 días).

---

# 36. Reseñas y reputación

Conecta **Google Business Profile** y responde reseñas con IA en español.

**Dónde:** **Configuración → Canales e integraciones → Reseñas**.

## 36.1 Conectar

Pulsa **Conectar Google Business** y autoriza el acceso. Luego configura tu Account ID / Location ID.

## 36.2 Gestionar reseñas

- **Sincroniza** tus reseñas de Google.
- Verás el **rating promedio**, total, sin responder y negativas.
- Para cada reseña: pulsa **Sugerir con IA** para generar una respuesta en español (empática para reseñas negativas, cálida para positivas), edítala si quieres y **Publica la respuesta** directamente en Google.
- Activa la **respuesta automática** para que la IA responda sola las reseñas nuevas.

---

# 37. Preguntas Frecuentes

## General

**¿Cuánto cuesta Parallly?**
Depende del país, plan y ciclo disponibles. Consulta **Configuración → Facturación**:
las tarjetas se cargan desde el catálogo activo y muestran el importe, moneda, cuotas y
modalidad aplicables a tu cuenta.

**¿Puedo probar antes de pagar?**
Cuando un plan ofrece prueba, su tarjeta indica la duración, si requiere método de pago
y la fecha exacta de finalización. No todos los planes o países tienen la misma oferta.

**¿En qué países funciona?**
La disponibilidad comercial, moneda y método de cobro dependen del catálogo activo para
el país de facturación. Verifica la opción que muestra el checkout o consulta ventas.

**¿Cómo cambio de plan?**
Configuración → Facturación → selecciona una tarjeta habilitada y revisa el resumen. La
pantalla confirma si el cambio es inmediato, programado o requiere contacto comercial.

**¿Puedo pausar mi suscripción?**
Solo cuando la suscripción y el proveedor activos muestran la acción **Pausar**. Lee
las condiciones y verifica el estado y las fechas después de confirmar.

## Agente IA

**¿El agente puede operar 24/7?**
Sí. Configurable desde el editor: siempre activo, solo en horario, o híbrido.

**¿Puedo hacer que el agente entregue a humano en ciertos casos?**
Sí — palabras clave de handoff (ej: "hablar con persona") + reglas de baja confianza disparan entrega automática.

**¿Cómo entrena al agente con mi negocio?**
Carga FAQs, documentos y URLs en Base de Conocimiento. El agente busca con RAG cuando necesita info.

**¿Puedo tener varios agentes diferentes?**
Sí — **uno por conexión** según tu plan. Por ejemplo: un agente formal en un número de WhatsApp y otro más informal en tu Instagram.

## Canales

**¿Necesito aprobar templates de WhatsApp?**
Solo para mensajes salientes fuera de la ventana de 24h. Para conversaciones que el cliente inició, no.

**¿Funciona Instagram personal?**
No — solo Instagram Business. Es un requisito de Meta, no de Parallly.

**¿Cuántos canales puedo conectar?**
Podés conectar los canales autoservicio habilitados para tu cuenta y, cuando el plan vigente lo permita, **varias conexiones del mismo tipo** (p. ej. dos números de WhatsApp). Cada conexión puede tener su propio agente. Revisa el cupo aplicable en **Configuración → Facturación** y consulta las secciones 9.8 y 8.2.

## Citas

**¿Sincroniza con mi Google Calendar?**
Sí — OAuth desde Configuración → Agenda. Multi-calendar plan-gated.

**¿Qué pasa si dos personas reservan el mismo slot?**
Anti-doble-booking automático: el sistema verifica disponibilidad en el momento de confirmar y rechaza el segundo intento.

**¿Genera link de Meet o Teams?**
Sí — automáticamente para servicios con tipo `online` o `hibrido`.

## Multimedia

**¿El agente IA entiende audios e imágenes?**
Sí — transcribe notas de voz (Whisper) y describe imágenes (visión IA). Ver sección 27.

**¿Qué pasa si supero el límite de multimedia?**
Los mensajes se reciben pero no se procesan con IA. El agente responde pidiendo que el cliente escriba por texto. Ver límites en sección 27.3.

**¿Me cobran extra por multimedia?**
La disponibilidad, cuota y cualquier cargo aplicable son los que muestra tu plan
vigente en **Configuración → Facturación**.

## Seguridad

**¿Puedo activar 2FA?**
Sí — Configuración → Seguridad. Soporta app autenticadora (TOTP), código por email y códigos de respaldo.

**¿Qué son los dispositivos de confianza?**
Al marcar "Confiar en este dispositivo" al iniciar sesión con 2FA, no te pedirá el segundo factor por 30 días en ese navegador. Podés revocarlos en cualquier momento.

## Integraciones y API

**¿Puedo conectar Parallly con Zapier o Make?**
Sí — crea una suscripción webhook (Configuración → Avanzado → Webhooks) para recibir eventos, y usa las claves de API para enviar datos. Ver secciones 18.7 y 18.9.

**¿Cuántas API keys puedo crear?**
La pantalla muestra si la API pública está habilitada y cuántas claves permite el
plan vigente. Recomendamos una clave separada por integración.

**¿Parallly soporta email como canal?**
Email tiene un adaptador inbound interno para integraciones administradas, pero todavía no es un canal conversacional configurable y certificado en autoservicio. La pantalla **Canales → Email** no completa hoy ese contrato. Si necesitás la integración, solicita una evaluación técnica a soporte; ver sección 9.6.

**¿Puedo hacer pruebas A/B en campañas?**
Los controles A/B existen, pero el envío comparte el flujo de campañas que todavía
no está certificado para producción. Úsalos solo al preparar borradores; ver
sección 12.

**¿Puedo tener más de un pipeline?**
No hay un contrato operativo certificado para administrar varios pipelines. La
experiencia actual trabaja con el embudo activo del tenant.

**¿Qué son las secuencias drip?**
Son flujos automatizados de mensajes con esperas entre pasos. En esta versión se
detienen automáticamente por respuesta u opt-out; la condición de conversión
visible aún no se aplica. Desinscribe manualmente al contacto cuando convierta y
antes de pausar una secuencia con pasos ya programados. Ver sección 11.5.

## Datos y Privacidad

**¿Mis datos están aislados de otros tenants?**
Sí — cada tenant tiene su propio schema de PostgreSQL. Aislamiento total a nivel de base de datos.

**¿Puedo exportar todo?**
Sí — Configuración → Avanzado → "Exportar datos". GDPR compliant.

**¿Qué pasa si cancelo?**
Datos preservados por 90 días. Pasado ese tiempo, schema se elimina (audit log preservado por compliance).

**¿Cumple con GDPR / CCPA?**
Sí — registro de consentimientos, opt-out automático, right-to-erasure, audit log inmutable.

---

<p align="center">
  <strong>¿No encontraste lo que buscabas?</strong><br/>
  Contáctanos en <a href="mailto:soporte@parallly-chat.cloud">soporte@parallly-chat.cloud</a>
</p>

<p align="center">
  <em>Parallly — IA que conecta, vende y atiende</em>
</p>
