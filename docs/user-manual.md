# Parallly — Manual de Usuario

<p align="center">
  <img src="../docs/images/parallly-logo.png" alt="Parallly Logo" width="200" />
</p>

<p align="center">
  <strong>Plataforma de IA Conversacional Omnicanal</strong><br/>
  Guía completa para tenants — administradores, supervisores y agentes
</p>

<p align="center">
  Versión 4.6 — Octubre 2026
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
| 21 | [Adaptación por industria y tipo de negocio](#21-adaptación-por-industria-y-tipo-de-negocio) |
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

Parallly es una plataforma SaaS que permite a negocios automatizar y centralizar conversaciones de ventas, soporte y atención al cliente a través de **WhatsApp, Instagram, Messenger, Telegram y un Web Chat Widget** — con agentes de inteligencia artificial que operan sobre tu catálogo, tu agenda y tu base de clientes reales. Email conserva un adaptador e ingreso técnico interno, pero no tiene configuración autoservicio certificada. **SMS está retirado para altas, compras, configuración y campañas nuevas**; solo se conservan saldos, historial, callbacks y cierres necesarios para obligaciones heredadas.

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
- Adaptar la experiencia a 18 industrias seleccionables y a su tipo de negocio dentro del contrato técnico de 20 industrias y 80 tipos de negocio canónicos (72 seleccionables y 8 en lista de espera); la lista completa está en [`business-types-catalog.md`](business-types-catalog.md)

---

# 2. Primeros Pasos

> **Fuente vigente para el usuario final:** los artículos runtime de Parallly Assist
> (`apps/api/kb/assistant/{es,en,pt,fr}/01-primeros-pasos.md` y `02-canales-whatsapp.md`).
> Este manual es apoyo editorial; si difieren, manda la KB, que es lo que el usuario lee
> dentro del panel. Ver `docs/platform-assistant-knowledge.md`.

## 2.1 Crear una cuenta

1. Ir a [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud)
2. Clic en **Registrarse**
3. Ingresar email y contraseña (o usar Google OAuth)
4. Al enviar el formulario se entra **directo** al asistente de onboarding (sección 2.2).
   No hay ningún código que esperar en ese momento: el correo de verificación sale en
   segundo plano y **no bloquea** la puesta en marcha (sección 2.4)
5. Al terminar el onboarding, el panel abre el asistente **Conoce a tu agente** de
   3 pasos (sección 2.2)

## 2.2 Asistente de Onboarding

Al crear tu cuenta, un asistente de **4 pasos** configura tu negocio.

Los cuatro pasos se rotulan **Tu empresa**, **Tus clientes**, **Objetivos** y **Plan**.

### Paso 1 — Tu empresa

Título «Tu empresa» («Cuéntanos sobre tu negocio»).

| Campo | Obligatorio |
|-------|:-----------:|
| Nombre de la empresa | ✅ |
| Industria | ✅ |
| Tipo de negocio (aparece al elegir una industria que ofrece tipos) | ✅ |
| Sobre tu empresa (descripción breve; el agente la usa para responder sobre tu negocio) | ✅ |
| Tamaño de la empresa | ✅ |
| Zona horaria (se detecta sola y puedes cambiarla) | ✅ |
| Más detalles (opcional): sitio web, teléfono, email de contacto, redes sociales y código promocional | No |

Los dos selectores se rotulan **Industria** y **Tipo de negocio**. El tipo de negocio
adapta el agente, el menú y las herramientas; solo se ofrecen los tipos seleccionables
(ver la sección 21 y el [catálogo](business-types-catalog.md)).

### Paso 2 — Tus clientes

Título «Tus clientes» y pregunta «¿A quién le vendes?». Eliges una o más opciones, y
se adaptan a tu industria. Por ejemplo:
- **Salud**: Pacientes particulares, Empresas y convenios, Pacientes con seguro médico
- **Inmobiliaria**: Compradores, Arrendatarios, Inversionistas
- **Restaurantes**: Comensales individuales, Eventos corporativos y privados, Clientes de delivery

### Paso 3 — Objetivos

Título «¿Qué quieres lograr con Parallly?». Eliges una o más opciones, y se adaptan
a tu industria. Por ejemplo:
- **Salud**: Agendar citas médicas, Responder preguntas de pacientes, Atención y seguimiento post-consulta, Recordatorios de citas y tratamientos
- **Inmobiliaria**: Calificar interesados (presupuesto, zona), Agendar visitas a propiedades, Informar sobre portafolio y financiación, Seguimiento de prospectos
- **Restaurantes**: Gestionar reservas de mesa, Mostrar menú y recomendaciones, Procesar pedidos a domicilio, Enviar ofertas y eventos especiales

### Paso 4 — Plan

Título «Elige tu plan». Selecciona país de facturación, ciclo mensual/anual cuando
esté disponible y una opción del catálogo vivo. Los planes reconocidos son
Emprendedor, Starter, Pro, Enterprise y Custom; la elegibilidad, precio, periodo de
prueba y forma de contratación que devuelve el catálogo son la fuente vigente. Puedes
revisar o cambiar tu plan desde **Administración → Facturación** (la pantalla se
llama **Plan y facturación**).

### Configuración automática al terminar

- **Pipeline** con etapas adaptadas a tu industria
- **Agente IA** con nombre, rol, tono y herramientas pre-configurados
- **FAQs base** de tu sector
- **Servicios** ejemplo según tu tipo de negocio
- **Módulos de tu tipo de negocio** activados (menú, planes, propiedades, etc. según corresponda)

### Después del onboarding: «Conoce a tu agente»

El panel abre un segundo asistente de **3 pasos** (título **Conoce a tu agente**),
reabrible desde **Configuración → Asistente de configuración** (ruta
`/admin/setup-wizard`, solo `tenant_admin`). Los pasos se rotulan **Tu agente**,
**Conecta tu canal** y **Listo**:

1. **Tu agente** — no se elige plantilla: el agente ya viene derivado de la industria y
   los objetivos declarados, con nombre, rol y saludo. El paso sirve para confirmarlo o
   ajustarlo (nombre y mensaje de bienvenida) y probarlo en el chat de al lado.
   **Cambiar plantilla** es un botón secundario que lleva a la lista de agentes.
2. **Conecta tu canal** — pregunta «¿Por dónde te escriben tus clientes?». El asistente
   recomienda primero el canal que corresponde a tu rubro («Para tu negocio, empieza
   por…»); si tu plan no lo incluye, lo muestra bloqueado y sugiere otro mientras
   tanto. En WhatsApp muestra los requisitos, la ruta de conexión (coexistencia
   recomendada, número nuevo o migración; **no** hay ruta de número de prueba) y el
   botón que abre la ventana de Meta. **Conectar después** persiste el estado y se
   recuerda desde Inicio.
3. **Listo** — título «Configuración inicial guardada»; muestra los mismos esenciales
   de la tarjeta **Puesta en marcha**.

El asistente prepara un **borrador**. Conectar WhatsApp no lo publica ni asigna por sí
solo. Si existe el workspace del agente, el cierre ofrece **Revisar y publicar mi
agente**: el recorrido abre el editor, la prueba del borrador, la preparación y
revisión del candidato, y finalmente la confirmación de publicación. Los clientes
reciben esa configuración y esas asignaciones únicamente después de publicar la
versión aprobada.

La tarjeta **Puesta en marcha** de Inicio es la única fuente de progreso: sus ítems se
derivan de los checks críticos de preparación más el canal, y cada ítem ofrece
**Continuar** y **Mostrarme dónde** (recorrido guiado de solo lectura, escritorio).

## 2.3 Iniciar sesión

| Método | Detalle |
|--------|---------|
| Email + contraseña | Credenciales habituales |
| Google OAuth | "Continuar con Google" |
| Recordarme | Sesión 14 días (sin esto: 8h) |

> Después de 60 minutos de inactividad aparece un modal con cuenta regresiva de 2 minutos. Si no respondes, la sesión cierra.

## 2.4 Verificación progresiva del correo

Una cuenta creada con email puede completar onboarding, consultar configuración y usar
Agent Test/sandbox antes de verificar. El aviso superior permite reenviar el código o
corregir un correo mal escrito. El reenvío, el cambio y los intentos de código tienen
límites antiabuso.

Hasta verificar, el servidor —no solo el menú— bloquea activación o desconexión de
canales/agentes/integraciones, outbound y campañas, invitaciones, secretos, cobros,
exportaciones y administración sensible. El error devuelve el estado
`unverified|pending_change|restricted`, la capacidad afectada y la ruta de reparación.
Google solo verifica la cuenta si el token firmado trae `email_verified=true`; OAuth e
invitaciones aceptadas registran estado `verified`.

## 2.5 Recuperar contraseña

1. Login → "¿Olvidaste tu contraseña?"
2. Ingresa tu email
3. Recibes código OTP por correo
4. Ingresas el código y estableces nueva contraseña

---

# 3. Roles y Permisos

Parallly tiene **3 roles para tenants**, cada uno con permisos específicos. Los administradores definen quién es qué desde Administración → Usuarios.

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

1. Administración → **Usuarios**
2. Click en el usuario
3. Selecciona el nuevo rol
4. Guarda

> **Importante:** Si bajas de Admin a Supervisor a alguien que tiene canales conectados, los canales siguen funcionando — solo se le quita la habilidad de modificarlos.

> **Nota sobre métricas personales:** el modelo de permisos contempla indicadores
> propios para Agent y la app móvil puede mostrarlos cuando el endpoint los autoriza,
> pero la página web `/admin/agent-analytics` está restringida actualmente a
> Admin/Supervisor. No uses esa URL como flujo para Agent.

---

# 4. Dashboard

**Ruta:** Esenciales → Inicio
**Roles:** Admin/Supervisor. Agent inicia en Conversaciones. Una cuenta heredada
`tenant_viewer` sólo puede abrir sus ajustes personales.

El dashboard es tu vista general al iniciar sesión y se adapta a tu industria.

### Mensaje de bienvenida por industria

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

### Vista principal (inicio por industria)

Para algunas industrias el dashboard muestra una vista contextualizada:
- **Salud / Veterinaria / Belleza**: agenda del día con citas
- **Inmobiliaria / Automotriz**: lista de leads
- **Restaurantes**: pedidos en cocina + reservas
- **Otras**: actividad reciente

### Puesta en marcha y Salud de agentes

Inicio presenta dos ayudas distintas para Admin/Supervisor:

- **Salud de tus agentes** permanece visible y resume el estado más delicado, cuántos
  agentes abarca y cuántas acciones Críticas o Altas siguen abiertas. Desde
  la prioridad principal puedes ir a la corrección permitida, abrir el Centro de
  calidad o pedir una explicación a Parallly Assist.
- **Puesta en marcha** aparece solo mientras existan pasos esenciales pendientes y
  disponibles para el plan, rol e industria: configurar el agente, conectar un canal
  conversacional certificado y agregar conocimiento o el catálogo operativo que
  corresponda. Desaparece al completar sus pasos.

Puesta en marcha reemplaza el antiguo checklist flotante y su pastilla `8/9`; no
incluye tareas avanzadas ni persigue al usuario entre secciones. Si una fuente no se
puede verificar, muestra un estado de reintento en vez de inventar una tarea
pendiente. Esta guía indica adopción inicial: no certifica la calidad del agente ni
sustituye pruebas o evidencia real.

---

# 5. Navegación

## 5.1 Menú principal — trabajo primero, administración después

El sidebar se organiza por la tarea que la persona quiere completar. Los grupos
secundarios pueden plegarse; el grupo de la página actual se abre siempre. El
orden no cambia entre páginas ni sesiones:

### ESENCIALES
- **Inicio** — resumen del negocio (admin/supervisor)
- **Conversaciones** — inbox y atención diaria

### CLIENTES
- **CRM** — las personas: contactos y su ficha
- **Organizaciones** — cuentas B2B (admin/supervisor)

### COMERCIAL
- **Embudo de ventas** — el pipeline de oportunidades (el nombre cambia según la
  industria: por ejemplo «Seguimiento», «Oportunidades» o «Negociaciones»)
- **Ofertas** (admin/supervisor)

### TRABAJO DIARIO
- Los **registros** que se operan cada día, según el tipo de negocio: Citas (o Agenda,
  Reservas, Reservaciones), Reservas (las estadías de hoteles y alquileres
  vacacionales), Reservas de tours, Alquileres y estadías, Órdenes de taller, Pedidos
  (de comida o de catálogo), Solicitudes, Clases, Sesiones fotográficas, Mascotas,
  Casos, Membresías y Seguros
- Solo aparecen los módulos que respalda tu tipo de negocio y tu rol

### CATÁLOGO Y RECURSOS
- Lo que **configura** el trabajo diario, según el tipo de negocio: Propiedades, Tours
  y Paquetes, Inmuebles, Vehículos, Menú, Cursos, Planes de tratamiento, Paquetes y
  servicios e Inventario (admin/supervisor)

### IA Y CRECIMIENTO
- **Agente IA** — personalidad, capacidades y simulación (admin); incluye **Probar agente**
- **Procedimientos** y **Base de conocimiento**
- **Automatización** — reglas, secuencias drip y plantillas (admin/supervisor)
- **Campañas** — broadcasts (admin/supervisor)

### INSIGHTS
- **Análisis** (con Analíticas CRM, Atribución y Reportes personalizados), **Ventas**,
  **Salud de agentes** y **Rendimiento de agentes**. Análisis, Salud de agentes y
  Rendimiento están disponibles para admin/supervisor; **Ventas** solo para admin

### ADMINISTRACIÓN
- **Canales**, **Usuarios**, **Privacidad**, **Facturación** y **Mejoras** (solicitudes de
  funciones), según rol. Canales, Usuarios, Privacidad y Facturación son de admin

### CONFIGURACIÓN (zona estable al fondo)
- **Configuración** abre el hub local de Configuración y conserva la página de origen
  para poder volver

Los nombres del trabajo diario y del catálogo cambian según la industria y el tipo
de negocio (la lista exacta de cada tipo de negocio está en el
[catálogo](business-types-catalog.md)): son el mismo módulo con otro rótulo.

> **Ayudas de navegación:** `Ctrl/Cmd+K` abre la búsqueda global; `Alt+1`,
> `Alt+2` y `Alt+3` abren destinos frecuentes permitidos. Favoritos y recientes
> nunca muestran rutas incompatibles con el rol o el tipo de negocio.

## 5.2 Configuración — áreas por responsabilidad

El hub filtra sus áreas por rol. Un administrador del tenant puede ver hasta ocho:

| Sección | Contiene |
|---------|----------|
| **Cuenta** | Perfil, seguridad, notificaciones y apariencia |
| **Empresa** | Datos del negocio, localización, fiscal y horarios |
| **CRM y operación** | Pipeline, scoring, atributos, reserva pública y nurturing |
| **Conversaciones** | Pre-chat, plantillas, macros, multimedia y recall |
| **Canales e integraciones** | CRM, web chat, Slack, verticales, reseñas, pagos y e-commerce |
| **Desarrolladores** | Webhooks, MCP y API keys |
| **Gobierno y alertas** | Políticas, alertas y reportes |
| **Plan y facturación** | Suscripción, periodo y pagos |

Desde cualquier página, **Configuración** recibe un retorno interno seguro. El
botón “Volver a la sección anterior” restaura también filtros, query y hash.

## 5.3 Analítica — pestañas

Ruta: Insights → **Análisis**. Acceso solo para admin/supervisor. La pantalla tiene
**12 pestañas**:

| Pestaña | Contenido |
|---------|-----------|
| Vista General | Conversaciones, mensajes, resolución IA, tiempo de respuesta, CSAT promedio y costo LLM; volumen por canal, tiempos de respuesta (mediana y P90) y horas pico |
| IA & Bot | Resolución IA, tasa de contención, conversaciones resueltas por la IA, escalaciones y sus razones, costo total y uso por modelo |
| Resolución IA | Tasa de resolución por la IA (ver 15.4) |
| Calidad (QA) | Puntaje promedio sobre 10 de las conversaciones evaluadas, subpuntajes, distribución, tasa de resolución verificada y conversaciones marcadas para revisión |
| CRM & Ventas | Acceso a **CRM Analytics** (embudo de ventas, velocidad del pipeline, win/loss y leaderboard) |
| Agentes | Acceso a **Reportes de Agentes** (rendimiento por agente, tiempos de respuesta, CSAT y leaderboard) |
| Automatización | Reglas totales y activas, ejecuciones, tasa de éxito y rendimiento por regla |
| Campañas | Embudo de campañas (enviados, entregados, leídos y fallidos) y tasas de entrega y lectura por campaña |
| Canales | Volumen por canal y rendimiento por cuenta operativa |
| CSAT | Valoraciones de satisfacción ya registradas |
| Anomalías | Anomalías detectadas en el período |
| Cohortes | Retención por cohortes |

Embudo, velocidad por etapa y win/loss **no** son pestañas de esta pantalla: viven en
CRM Analytics (Insights → Análisis → Analíticas CRM).

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

## 6.3 Notificaciones

La campana de la barra superior reúne los avisos en siete categorías visibles:
**Mensajes, Transferencias, Cumplimiento, Citas, Automatización, Pedidos y Sistema**.
Los avisos directos de transferencia se resaltan en rojo y los originados por baja
confianza de la IA, en amarillo.

Cada usuario puede abrir **Configuración → Notificaciones** para apagar categorías o
el sonido. La selección se guarda en su cuenta, se conserva al cambiar de dispositivo
y filtra tanto la campana en vivo como las notificaciones push que el servidor envía a
ese usuario. Activar push en el navegador es un permiso adicional por dispositivo: una
categoría habilitada no sustituye ese permiso, y quitarlo no cambia las preferencias de
la cuenta. Esta pantalla no programa resúmenes por correo.

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

> **Tip:** Si ves la pill de otro agente, deja una nota interna o coordina con tu equipo antes de responder. La pill solo indica que la conversación está abierta, no que alguien esté escribiendo.

---

# 7. CRM — Gestión de Contactos

## 7.1 Contactos

**Ruta:** Clientes → CRM
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
- *(según el tipo de negocio)* Planes de tratamiento, Mascotas, Pólizas, Cursos inscritos

## 7.2 Pipeline (Kanban)

**Ruta:** Comercial → Embudo de ventas

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
**Ruta:** Comercial → Embudo de ventas

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
consultar la evidencia de cada agente desde **Insights → Salud de agentes**.

## 8.1 Lista de agentes

Ves todos los agentes IA configurados. Cards con:
- Nombre, rol, plantilla base
- Canales asignados
- Estado activo/pausado
- Versión

### Banner de alerta

Si tienes canales conectados sin agente asignado, aparece banner rojo: "Tienes X canales sin agente — el bot no responderá".

### Acciones

- **Crear agente** — desde una plantilla recomendada, general, propia o en blanco; se
  crea sin conexiones operativas y abre el editor para revisión
- **Duplicar** — copia exacta para experimentar
- **Editar** — abre el editor
- **Retirar de uso** — con confirmación; desactiva el agente, libera sus conexiones y
  conserva el registro
- **Guardar como plantilla** — copia la versión operativa para reusar
- **Establecer como predeterminado** — se propone en el borrador y sólo toma efecto al
  publicar la revisión

### Capacidad del plan

El número de agentes y el acceso a plantillas se obtienen del catálogo vigente y de
los overrides autorizados del tenant. La pantalla bloquea nuevas altas al alcanzar
la capacidad. Confirma el valor aplicable en **Administración → Facturación** antes
de planificar una expansión.

## 8.2 Editor del agente

Hub con cards organizadas:

### Identidad
- Nombre del agente (ej: Sofía, Carlos, Maya)
- Rol / título
- Avatar

### Personalidad
- Estilo de comunicación
- Uso de emojis y humor
- Extensión de respuesta: concisa, estándar o detallada
- Saludo inicial

### Comportamiento
- Instrucción principal y reglas concretas
- Temas prohibidos
- Datos que debe pedir en cada contexto
- Mensaje cuando no puede responder
- Motivos para pasar a una persona
- Ventas, soporte o ambos; intensidad de recomendaciones y techo de descuento cuando
  corresponda
- Comportamiento fuera del horario comercial compartido por la cuenta

### Asignación de conexiones

Selector de **conexiones** que este agente debe atender. La regla es **un agente por
conexión** (`agent_personas.channel_bindings`): cada agente se enlaza a cuentas
concretas, no a un canal genérico. La selección se guarda en el borrador; la
reasignación ocurre al publicar la revisión aprobada. Cuántas conexiones del mismo
tipo puedes tener lo define tu plan (ver 9.8).

### Herramientas

Interruptores para las capacidades que el agente puede usar:
- Buscar en la base de conocimiento (RAG)
- Verificar disponibilidad de citas
- Crear citas
- Listar productos / servicios / propiedades
- Crear órdenes / reservas
- Solicitar handoff a humano
- Herramientas especializadas según el **tipo de negocio** efectivo

El editor sólo ofrece las familias compatibles con el perfil del tenant y explica si
falta un dato, plan o proveedor. Guardar un interruptor prepara el permiso en el
borrador; no cambia por sí solo la versión operativa.

Los interruptores pertenecen a cada agente: no desactivan el trabajo manual del
equipo ni conceden acceso a módulos fuera del plan, rol o tipo de negocio. Por
ejemplo, desactivar **Citas** para la IA no impide gestionar citas manualmente.

El menú lateral y los módulos relacionados muestran el estado de las herramientas
en las versiones operativas de todos los agentes de la cuenta:

- **IA desactivada**: ningún agente tiene habilitada una herramienta relacionada.
- **Solo agentes pausados**: únicamente agentes pausados la tienen habilitada.
- **IA configurada**: al menos un agente activo la tiene habilitada; no significa
  que todos la tengan ni que estén listos para ejecutarla. Siguen aplicándose los
  permisos, datos, conexiones y requisitos de cada herramienta.
- **IA por verificar**: no se pudo comprobar la configuración. No equivale a estar
  desactivada y no bloquea el trabajo manual.

Los cambios guardados como borrador no alteran este indicador hasta publicarse.
Desde el aviso del módulo puedes actualizar el estado y, si tu rol lo permite,
abrir **Revisar agentes y herramientas**.

### Guardado y publicación

La barra inferior **Guardar borrador** conserva la revisión sin cambiar el agente que
atiende clientes. Después debes probar ese borrador, abrir **Revisar una versión**,
preparar y aprobar el candidato, y usar **Publicar y ver historial**. La publicación
vuelve operativos la configuración, las conexiones y la condición de predeterminado.

Parallly Assist puede revisar los controles guiados y proponer cambios seguros. Al
aceptarlos también guarda un borrador: nunca publica, activa ni cambia conexiones por
su cuenta y no recibe credenciales o secretos.

## 8.3 Plantillas por industria

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

Modo simulador: chatea con la versión operativa o con el borrador guardado sin afectar
contactos reales. Úsalo antes de preparar, aprobar y publicar una revisión.

Los pasos pendientes de una cuenta nueva son **puesta en marcha**, no deterioro del
agente. El panel de misión ofrece el siguiente paso y **Guiarme con Parallly Assist**;
Assist vuelve a revisar la configuración antes de orientar o preparar una propuesta.
**Requiere atención** indica una comprobación o problema para revisar, sin afirmar
que antes funcionaba. La lista de capacidades por canal no acredita su conexión:
esa comprobación pertenece al paso **Conectar y asignar un canal**.

La evaluación conversacional considera la misión de la versión que produjo las
respuestas, cuando está disponible. Un seguimiento solicitado o una derivación
correcta pueden cumplir el objetivo sin cerrar una venta. Si falta la configuración
histórica o parte de la transcripción, la evaluación no debe inventarlas.
El puntaje no certifica ventas, pagos, reservas ni conversión comercial: esos
resultados requieren sus registros operativos. Las notas de criterios anteriores
se conservan como historial; no se recalifican automáticamente ni se comparan como
mejoras o caídas frente a un criterio diferente. Para comparar, prueba ambas
versiones bajo el criterio actual.

Si el cliente todavía no ha precisado su consulta y el agente pide los datos
necesarios, el simulador puede mostrar **Espera información del cliente**. No es
un fallo ni una venta perdida. La tasa de resolución conversacional usa solo los
casos concluyentes y muestra cuántos esperan datos o no tienen evidencia
suficiente; cuando ninguno es concluyente, no muestra un 0% inventado.

Una conversación manual sirve para depurar, pero no demuestra calidad general. El
Centro de calidad usa por separado pruebas repetibles y evidencia real atribuida a la
versión del agente.

## 8.5 Centro de calidad del agente

**Ruta:** Insights → Salud de agentes (`/admin/agent/quality`)
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

### Dónde aparece la atención prioritaria

- En **Inicio**, la tarjeta Salud de tus agentes siempre ofrece el resumen.
- En **Insights → Salud de agentes**, el badge suma solo señales **Críticas + Altas
  abiertas**. El número no es un puntaje ni incluye prioridades medias o bajas.
- El aviso global aparece únicamente si existe una señal crítica abierta o el peor
  estado es **Agente en riesgo**. Puedes revisar, preguntar a Assist o **Posponer 24
  h**. Posponer oculta temporalmente esa señal; no afirma que fue corregida.

Los avisos de Salud de agentes viven dentro del dashboard. Esta función no envía por
sí sola correos ni notificaciones push.

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

Las recomendaciones mantienen snapshots y señales por agente y versión. Cambios de
configuración, resultados de QA, evaluaciones y simulaciones actualizan el diagnóstico;
un proceso acotado periódico recupera eventos que se hayan perdido. Las recurrencias
se agrupan para evitar avisos duplicados. **Posponer** administra la atención visible;
el backend conserva además estados de reconocimiento y reemplazo para integraciones
autorizadas. Solo evidencia nueva puede resolver la causa.

---

# 9. Canales de Comunicación

**Ruta:** Administración → Canales
**Roles:** Tenant Admin

## 9.1 WhatsApp

### Conectar (Embedded Signup v4)
1. Canales → WhatsApp → "Conectar"
2. Se abre flujo de Meta
3. Login con Facebook
4. Selecciona o crea tu WhatsApp Business Account (WABA)
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

### Perfil de negocio por número

En **Canales → WhatsApp → Perfil**, si hay más de un número conectado aparece un
selector. El número efectivo se muestra siempre bajo el nombre verificado; descripción,
dirección, foto, calidad y límite de mensajería corresponden al número seleccionado.
Conectar un número adicional no puede reemplazar silenciosamente una credencial
permanente por otra temporal: la conexión se publica solo después de validar que la
credencial cubre todas las WABA ya conectadas.

### Templates de WhatsApp

Para enviar fuera de la ventana de 24h, necesitas plantillas aprobadas por Meta:
1. Canales → WhatsApp → **Ver todas las plantillas** (`/admin/channels/whatsapp/templates`)
2. **Crear plantilla** → nombre (solo minúsculas, números y guiones bajos), número o
   cuenta, idioma, categoría (`UTILITY`, `MARKETING` o `AUTHENTICATION`), encabezado y
   pie opcionales, cuerpo con variables (`{{1}}`, `{{2}}`…) y hasta 3 botones
3. **Enviar a Meta** para aprobación; el estado pasa a aprobada cuando Meta la revisa
   y el tiempo de revisión lo determina Meta

### Costo de entrega: Meta le cobra a la cuenta del tenant

Desde el **1 de octubre de 2026**, Meta cobra **cada mensaje de servicio entregado**
contra la **cuenta de WhatsApp Business del propio tenant**. Parallly es proveedor de
tecnología ante Meta: **no paga ese consumo, no lo factura y no lo incluye en el plan**.
El tenant carga su medio de pago en las herramientas de Meta (WhatsApp Manager →
Facturación y pagos) y Meta le cobra ahí.

Consecuencia operativa: **una cuenta sin medio de pago válido deja de entregar los
mensajes de servicio**. No degrada, corta. Para el negocio eso se ve como un agente que
dejó de responder, aunque su suscripción a Parallly esté al día; los mensajes entrantes
se siguen recibiendo y guardando.

**Cuota gratis**: **1.000 mensajes de servicio por número y por mes calendario**, sin
acumulación, en la zona horaria de la cuenta de WhatsApp Business. No es por país, ni por
contacto, ni cubre plantillas (marketing, utilidad y autenticación se cobran aparte y no
consumen la cuota). La cifra y la fecha viven en
`apps/api/src/modules/billing/whatsapp-rates/whatsapp-rate-table.generated.ts`
(`WHATSAPP_FREE_SERVICE_ALLOWANCE`), derivadas de tarjetas de tarifas preservadas; no se
copian a mano en ningún otro lado.

**Tarifas**: este manual no las transcribe. Meta revisa sus tarjetas por trimestre y cobra
según el país de **quien recibe**, así que cualquier número escrito aquí queda viejo en la
próxima revisión. La fuente vigente es la tabla generada citada arriba y
`docs/whatsapp-meta-pricing-2026-10.md`.

**Qué ve el tenant.** En **Canales → WhatsApp**, la tarjeta **Cobro de WhatsApp (Meta)**
muestra el avance de la cuota gratis, el gasto del período separado por moneda, los
contactos más costosos, los envíos sin confirmar y los números con envío pausado. La
pantalla **Canales** solo la abre el Tenant Admin, así que en el panel la ve él y es
quien puede **Reanudar envíos**; la API de lectura (`GET /whatsapp/spend/*`) también
admite al Tenant Supervisor, pero solo mediante la API. Endpoints:
`GET /whatsapp/spend/summary`, `/consumption`, `/awaiting-resolution`, `/pauses`, `/policy`,
`POST /whatsapp/spend/resolve` y `/pauses/:channelAccountId/resume`.

**Pausa por cobro y regreso.** Cuando Meta responde que la cuenta no puede facturarse
(clase de error `131042`), Parallly pausa los envíos cobrables **de ese número**, no del
tenant ni de los demás números, y no reintenta. La pausa se levanta sola cuando Meta
acepta un envío; como un número pausado no envía, el Tenant Admin puede declarar que
arregló el medio de pago con **Reanudar envíos**. Es una declaración registrada, no una
comprobación: si Meta vuelve a rechazar, el número se pausa de nuevo en el siguiente
intento.

**Construido vs detrás de un interruptor.**

| Pieza | Estado |
|-------|--------|
| Tarifas, cuota gratis y clasificación de categoría | Construido (tabla generada + resolutor puro) |
| Medición del gasto, reserva por envío y conciliación | Construido (`whatsapp-spend`, ledger transaccional) |
| Autorización en los tres puntos de salida | Construido (`WhatsappSendAdmissionService`) |
| Lectura de gasto, cuota, pausas y reanudación en el panel | Construido (`/admin/channels/whatsapp`) |
| **Frenar envíos al llegar a un tope** | **Apagado por defecto**: `observe` mide y deja pasar. Un Tenant Admin puede activar **Protección de gasto** en Canales → WhatsApp; el cambio a `enforce` se guarda con auditoría y toma efecto antes del siguiente envío |
| Fijar un tope de gasto desde el producto | Cada mes se crean valores iniciales de 2.000 entregas por número y 60 por contacto. La API autenticada `GET/POST /whatsapp/spend/ceilings` permite leer y ajustar cada alcance; el panel muestra los valores y controla si se aplican |

Un tope, cuando se habilite, acota **lo que Parallly envía** por esa conexión. No limita
lo que otra herramienta conectada a la misma cuenta de WhatsApp Business le cobre a Meta,
no es un límite que Meta aplique y no cambia la tarifa.

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

## 9.5 SMS — producto retirado

El **SMS conversacional y el reseller de notificaciones están retirados para altas
nuevas**. Las conexiones, pruebas y compras responden `sms_product_retired`; las rutas
de canal y configuración redirigen a superficies vigentes; Facturación no publica
paquetes o precios; Campañas no ofrece SMS.

Saldos, ledger, órdenes históricas, callbacks tardíos, desconexión y administración
interna pueden permanecer para obligaciones heredadas. Eso no habilita una conexión,
una compra, una notificación nueva ni una campaña.

Si esa sección o el canal no aparecen, la capacidad no está disponible para la cuenta;
no se debe inferir un proveedor, precio o equivalencia fija desde este manual.

> Los canales **conectables en autoservicio y conversacionales** son WhatsApp, Instagram, Messenger y Telegram. El Web Chat Widget es una superficie conversacional operativa que se configura aparte en **Configuración → Canales e integraciones → Web Chat**.

## 9.6 Email — estado actual

Email existe en el backend como **adaptador técnico y entrada inbound interna** para integraciones administradas. Esto no equivale a un canal conversacional certificado para autoservicio.

La ruta heredada **Canales → Email** redirige al inventario de canales certificados;
no muestra formulario ni permite ingresar credenciales. El servidor también rechaza
Email en la conexión genérica, en asignaciones nuevas de agentes y en campañas.

Si tu organización necesita correo integrado, solicita una evaluación técnica a soporte. Hasta que el flujo de lectura, guardado, envío, recepción y respuesta se implemente y certifique de extremo a extremo, no se debe prometer que los correos aparecerán en Inbox ni que un agente IA podrá responderlos.

## 9.7 Desconectar un canal

La desconexión es **por cuenta/conexión**: si tienes varios números o cuentas del mismo tipo, cada uno se desconecta de forma independiente sin afectar a los demás.

1. Canales → click en el canal → elige la conexión → "Desconectar"
2. Modal confirmación con resultado real:
   - **Verde** ✅ "Desconectado completamente": proveedor confirmó la desuscripción
   - **Amarillo** ⚠️ "Desconectado en plataforma — revisar el proveedor": tu BD se actualizó pero el proveedor podría seguir enviando. Causas: token expirado, cambio de permisos. Hay que entrar manualmente al proveedor (Meta Business Suite, etc.)
   - **Rojo** ❌: error de red — reintenta

## 9.8 Varias conexiones del mismo tipo (multi-cuenta)

Puedes conectar **más de una cuenta del mismo canal** — por ejemplo dos números de WhatsApp, dos cuentas de Instagram o dos bots de Telegram — sin que sus conversaciones se mezclen.

- **Límite por plan y canal**: el catálogo y los overrides vigentes determinan cuántas conexiones admite cada tipo para tu cuenta. Consulta **Administración → Facturación**; este manual no fija cantidades.
- **Contador visible**: cada tarjeta de canal en **Canales** muestra "**X de Y cuentas**" (Y = tu límite; ∞ si es ilimitado) y un enlace **"Conectar otra"** cuando todavía tienes cupo.
- **Tokens por cuenta**: cada conexión guarda su propio token de acceso (`channel_accounts.access_token`), de modo que los mensajes salen por el número o cuenta correctos.
- **Un agente por conexión**: puedes asignar un agente IA distinto a cada cuenta (ver 8.2).
- **Emisor previsto en borradores de campaña**: cuando tienes más de una conexión,
  el borrador permite indicar desde qué número/cuenta debería salir. No lances una
  campaña real hasta que el selector de plantilla/emisor y la cancelación estén
  certificados según la sección 12.

La tarjeta del canal y **Administración → Facturación** muestran el cupo efectivo. Si ambos difieren, no intentes inferir un valor desde tablas de seed o documentos históricos: solicita validación a soporte.

---

# 10. Citas y Agenda

**Ruta:** Trabajo diario → **Citas** (según el tipo de negocio el menú la rotula
«Agenda», «Reservas» o «Reservaciones»; es el mismo módulo)
**Roles:** Admin/Supervisor/Agent (configuración solo Admin/Supervisor)

La pantalla **Citas y Agendamiento** tiene cinco pestañas: **Calendario**, **Agenda**
(lista de citas), **Servicios disponibles**, **Configuración** y **Analíticas**.

## 10.1 Calendario

Pestaña **Calendario**: vista **semanal** o **diaria** con las citas (no hay vista
mensual). Puedes ocultar o mostrar las canceladas.

Acciones:
- Click en el encabezado de un día → pasa a la vista diaria de ese día
- Click en un espacio libre → crear una cita en ese día y hora
- Click en una cita → abrirla para ver o editar sus datos
- Reprogramar arrastrando la cita a otro espacio
- Cancelar con motivo

## 10.2 Servicios

**Roles:** Admin/Supervisor
**Dónde:** Citas → pestaña **Servicios disponibles** → **Nuevo servicio**

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

En Citas → pestaña **Configuración** → sección **Horario de atención**: elige
**Disponible 24/7** u **Horario personalizado** y marca, día por día, las horas en que
atiendes. Guarda los cambios: sin horario guardado el agente no tiene disponibilidad
real que ofrecer.

### Fechas bloqueadas

En la misma pestaña **Configuración**, sección **Fechas bloqueadas** → **Bloquear
fecha** (vacaciones, feriados): el agente IA no ofrecerá esos horarios.

## 10.4 Calendarios conectados

### Google Calendar

1. Citas → pestaña **Configuración** → sección **Calendarios conectados** → **Conectar Google Calendar** (o **Conectar Outlook**)
2. OAuth con Google
3. Selecciona qué calendario sincronizar
4. Listo — citas se crean en ambos lados

### Multi-calendar (según capacidad vigente)

La cantidad de calendarios se obtiene del plan activo y sus overrides. La pantalla
muestra el uso y el cupo aplicable; revísalo en **Administración → Facturación**.

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

La pantalla permite preparar borradores WhatsApp, escoger una audiencia, revisar
estados y consultar métricas ya registradas. El servidor rechaza campañas nuevas o
lanzamientos heredados que incluyan Email, SMS u otro canal no certificado. El
lanzamiento WhatsApp desde el editor **no está certificado de punta a punta para
producción**:

- WhatsApp todavía no vincula de forma segura el texto escrito con el identificador
  y los componentes exactos de una plantilla aprobada por Meta.
- Una campaña programada no dispone de una acción operativa de cancelación.
- Email y SMS no aparecen como opciones de campañas nuevas; los registros heredados
  se conservan para auditoría, pero no se pueden lanzar.

Hasta que la pantalla muestre un selector verificado de plantilla/emisor y una
acción de cancelación, no uses **Enviar ahora** ni programes campañas reales. Para
una prueba controlada, coordina primero con soporte.

## 12.2 Preparar un borrador

1. Crea la campaña y asigna un nombre interno sin datos sensibles.
2. Elige **Todos los contactos** o un segmento de **Clientes → CRM → Segmentos**.
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

Auto-creadas la primera vez que entras:
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
- **Desglose por canal**: tasa de resolución separada por las superficies que tengan conversaciones reales. Email solo aparece cuando existe una integración administrada con datos; no certifica configuración autoservicio.
- **Cuentas operativas**: atribución por número, página, bot o conexión. Conserva la
  etiqueta histórica, muestra conexiones desconectadas y separa eventos sin cuenta
  atribuible para no mezclar el rendimiento de dos cuentas del mismo canal.

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
atribuida a su versión, consulta **Insights → Salud de agentes** (sección 8.5). Allí
la resolución verificada, la calidad conversacional observada, los fallos de
herramientas, los handoffs y los vacíos de conocimiento se muestran por separado.

---

# 16. Inventario y Pedidos

**Ruta:** Catálogo y recursos → **Inventario** (en algunos rubros se rotula «Productos», «Repuestos» o «Equipos») · Trabajo diario → **Pedidos**
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
- Detiene el turno actual antes de consultar al modelo o responder
- Crea una revisión pendiente; si era un falso positivo, rechazarla vuelve a habilitar los envíos
- Queda registrado en audit_log

---

# 18. Configuración General

**Ruta:** Configuración

## 18.1 Cuenta (Admin, Supervisor, Agent y Super Admin)
- Perfil personal
- Seguridad y cambio de contraseña
- Preferencias de notificaciones por usuario: siete categorías para campana y push,
  sonido del panel y activación push separada por dispositivo
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

## 18.5 Seguridad (Admin, Supervisor, Agent y Super Admin)

### Autenticación de dos factores (2FA)

**Ruta:** Configuración → Seguridad

Parallly soporta 2FA para proteger tu cuenta con un segundo paso al iniciar sesión.

**Métodos disponibles:**
1. **App autenticadora (TOTP)** — Google Authenticator, Authy, 1Password, etc. Escanea el QR y confirma el código de 6 dígitos
2. **Código por email** — recibes un código temporal de 6 dígitos a tu email registrado
3. **Códigos de respaldo** — 10 códigos de un solo uso que se generan al activar 2FA. Guardalos en un lugar seguro

**Activar 2FA:**
1. Configuración → Seguridad → "Activar 2FA"
2. Escanea el QR con tu app autenticadora
3. Ingresa el código de 6 dígitos para confirmar
4. Descarga los códigos de respaldo (solo se muestran una vez)

**Desactivar 2FA:**
1. Configuración → Seguridad → "Desactivar 2FA"
2. Confirma con tu contraseña actual

### Dispositivos de confianza

Cuando inicias sesión con 2FA, puedes marcar **"Confiar en este dispositivo"**. Esto evita que te pida el segundo factor durante **30 días** en ese navegador.

- Cada dispositivo de confianza aparece en la lista con nombre, navegador y fecha
- Puedes revocar dispositivos individualmente desde Configuración → Seguridad
- Al confiar un nuevo dispositivo, recibes un email de notificación de seguridad
- Si cambias tu contraseña, todos los dispositivos de confianza se revocan automáticamente

## 18.6 Canales, gobierno y desarrolladores

- **Admin:** canales e integraciones, políticas, compliance, webhooks, MCP y API keys.
- **Admin/Supervisor:** alertas y reportes.
- **Admin/Supervisor/Agent y Super Admin:** solo los ajustes personales descritos
  en 18.1; este acceso no concede permisos de configuración del tenant. Una cuenta
  heredada `tenant_viewer` conserva exclusivamente este mismo acceso personal.

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

> **IMPORTANTE:** La clave se muestra completa solo en el momento de creación. Después solo verás los últimos 4 caracteres. Si la pierdes, deberás revocarla y crear una nueva.

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

**Ruta:** Administración → Facturación
**Roles:** Tenant Admin

## 20.1 Catálogo vigente de planes

Parallly reconoce las familias **Emprendedor, Starter, Pro, Enterprise y Custom**,
pero la página solo muestra las filas activas que devuelve el catálogo de facturación.
Cada tarjeta informa el precio y moneda aplicables, ciclos disponibles, periodo de
prueba, límites y funciones incluidos para esa cuenta.

No uses precios o cuotas copiados de un documento antiguo: el catálogo activo y los
overrides del tenant son la fuente contractual vigente.

**La suscripción no cubre la entrega por WhatsApp.** Desde el 1 de octubre de 2026, Meta
cobra los mensajes de servicio entregados contra la cuenta de WhatsApp Business del propio
tenant, con el medio de pago que él carga en Meta; ese dinero no pasa por Parallly y esa
factura no aparece en Facturación. Son dos pagos separados y cambiar de plan no cambia lo
que Meta cobra. Detalle, cuota gratis y qué se ve en el panel: **§9.1, "Costo de entrega"**.

## 20.2 Precio, moneda y ciclo

El importe se presenta con la moneda y el periodo que devuelve la API para el país de
facturación. Si existe más de un ciclo, aparece el selector correspondiente; si un
plan o ciclo no está habilitado, no se ofrece como acción.

La tarjeta y el resumen de confirmación indican el total, la periodicidad y cualquier
ahorro aplicable. No asumas una moneda, descuento ni conversión fija fuera de esa vista.

## 20.3 Cambiar de plan

1. Abre **Administración → Facturación**.
2. Selecciona una tarjeta cuyo botón de acción esté habilitado.
3. Revisa plan, ciclo, importe y fecha de efecto en el resumen.
4. Confirma solo si esos datos coinciden con lo esperado.

La API decide si el cambio es inmediato, programado o requiere contacto comercial.
La respuesta y el estado mostrados después de confirmar prevalecen sobre cualquier
regla histórica de upgrade o downgrade.

## 20.4 Método de pago (Wompi en Colombia, Stripe en el resto)

Las suscripciones nuevas de Parallly se procesan según el país de facturación que
confirmas: **Colombia usa Wompi** y los demás países admitidos usan **Stripe**
(sección 20.15). Una suscripción existente conserva su proveedor. Lo que sigue
describe Wompi; con Stripe continúas en la página segura de Stripe para autorizar el
pago o administrar la suscripción, y los datos de la tarjeta se ingresan allí.

La pantalla de Wompi ofrece únicamente
los medios que Billing Ops haya habilitado; si todos están apagados, bloquea el
checkout en lugar de mostrar una tarjeta por defecto.

- **Tarjeta:** los datos viajan directamente del navegador a Wompi. Parallly no
  recibe PAN ni CVV.
- **Nequi:** ingresa el celular, acepta la solicitud push en la app y mantén la
  pantalla abierta hasta la aprobación.
- **Botón Bancolombia:** abre la autorización, elige la cuenta y vuelve a la misma
  pantalla; el sistema retoma la intención y verifica el estado.

En los tres casos debes abrir y aceptar por separado los términos del servicio y
la autorización de datos personales. Un medio pendiente o rechazado no activa el
plan. Solo una fuente marcada como disponible permite un cobro.

No pegues llaves privadas ni credenciales del comercio en este formulario. Las
cuentas Wompi o Mercado Pago de **Configuración → Cobros a clientes** pertenecen a otro flujo:
sirven para que tu negocio cobre a sus clientes mediante enlaces, nunca para pagar
la suscripción de Parallly. Cada cuenta es del tenant, usa un webhook separado y
el agente sólo confirma un pago después de la validación canónica del proveedor.

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
disponible. El PDF de esta tabla es un **comprobante comercial**. Una factura
electrónica DIAN oficial, con CUFE/XML, se consulta en **Datos fiscales** y puede
tener un estado distinto mientras Factus termina la emisión.

Las cuentas internas de la propia empresa no reciben factura ni comprobante de venta:
no existe una venta al tenant. Los pagos de sandbox tampoco generan una factura DIAN
real.

## 20.10 Periodo de prueba

La duración, necesidad de método de pago y acciones al vencimiento dependen del plan
y se muestran en su tarjeta y en el resumen de suscripción. Usa la fecha exacta de
finalización del panel para planificar la continuidad.

Cuando el plan requiere medio desde el alta, el proceso ocurre en dos fases: primero
se crea la cuenta como **Autorización pendiente**, sin acceso pagado; después se
autoriza el medio. Si el plan incluye prueba, esta empieza al aprobarse la fuente y el
panel muestra fecha e importe del próximo cobro. Si no incluye prueba, el primer cobro
se procesa de inmediato y el plan solo se activa cuando Wompi lo aprueba. No se cambia
silenciosamente a otro plan.

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

## 20.14 Saldos e historial SMS heredados

SMS está retirado (ver 9.5). El panel tenant no publica paquetes, precios ni checkout.
Las APIs de saldo, ledger y órdenes pueden seguir disponibles para conciliación de
compras anteriores; no autorizan consumo nuevo. El super_admin conserva la vista y el
ajuste manual necesarios para soporte/obligaciones legacy, sin reabrir el producto.

## 20.15 Datos y documentos fiscales, cuando correspondan

La tarjeta **Datos fiscales** y los documentos relacionados dependen del país de
facturación, la configuración de plataforma y el proveedor activo. Si la cuenta los
requiere o los ofrece, completa únicamente los campos y tipos de documento que muestra
la pantalla y revisa el estado de cada documento publicado.

Un checkout puede pedir datos adicionales antes de continuar solo cuando el backend
lo indique para esa cuenta. Si la tarjeta o el aviso no aparecen, este manual no debe
interpretarse como una obligación fiscal universal.

En Colombia, un cobro real aprobado puede iniciar la FEV DIAN. Un cobro Wompi en
sandbox, una cuenta marcada como interna o un movimiento sin contraprestación queda
registrado como omitido y no consume numeración. Si falta configuración fiscal, el
documento debe quedar bloqueado y visible para reintento; no se considera emitido.

La clasificación de cuenta propia se conserva con el pago. Marcar una cuenta como
propia después de una venta real no borra sus documentos ni cambia la clasificación
de ese cobro anterior. Los estados **Omitida** y **Anulada** no se reemiten mediante
el reintento ordinario.

Para suscripciones internacionales cobradas por Stripe, el modo fiscal Colombia
puede conservar simultáneamente Factus para Colombia y el emisor LLC para el
exterior. La LLC emite un recibo comercial y, para devoluciones, una nota de crédito
comercial. Esos documentos no tienen CUFE ni validación DIAN y no acreditan por sí
solos el cumplimiento tributario de todos los países.

---

# 21. Adaptación por Industria y Tipo de Negocio

Al crear la cuenta eliges una **Industria** y un **Tipo de negocio** (así se rotulan los
dos selectores del alta). Parallly mantiene un contrato técnico de **20 industrias y
80 tipos de negocio canónicos** (72 seleccionables y 8 en lista de espera), más 5
configuraciones que solo existen para cuentas anteriores: 85 resolubles en total.
(En el código y en documentos antiguos la industria se llama «vertical» y el tipo de
negocio «subtipo» o «perfil».) La industria agrupa capacidades; el tipo de negocio
combina industria y subtipo y determina las herramientas, rutas, términos y requisitos
efectivos. Hoy el onboarding ofrece **18 industrias con al menos un tipo de negocio
seleccionable**. Planeación de eventos y construcción están presentes en el manifiesto
para conservar identidad y evolución del producto, pero sus tipos actuales permanecen
en lista de espera.

> **Lista autorizada:** la lista completa de industrias y tipos de negocio —con id,
> nombre, disponibilidad, menú, familias y herramientas del agente— está en
> [`business-types-catalog.md`](business-types-catalog.md), un documento **generado
> desde el código** que el CI mantiene al día. Esta sección resume y explica cómo
> operar cada módulo; si algo difiere, manda el catálogo.

> **Alcance honesto:** los tipos de negocio ofrecidos tienen comportamiento
> implementado, pero a octubre de 2026 ninguno cuenta todavía con certificación E2E
> completa. Usa estas secciones para operar lo que aparece habilitado en tu cuenta, no
> como garantía de cobertura total del sector. En actividades reguladas, decisiones
> sensibles y excepciones, interviene una persona autorizada.

### Tipos de negocio por industria

Los ids son los de `industria/tipo` (por ejemplo `salud/dental`).

| Industria (`id`) | Tipos de negocio seleccionables (`id` y nombre) | En lista de espera | Solo cuentas existentes |
|---|---|---|---|
| Salud (`salud`) | `dental` Odontología · `medica_general` Medicina general · `dermatologia` Dermatología y medicina estética · `psicologia` Psicología y terapia · `farmacia` Farmacia | — | — |
| Belleza y estética (`moda_belleza`) | `salon_belleza` Salón de belleza · `barberia` Barbería · `spa` Spa y bienestar · `estetica` Centro de estética | — | — |
| Inmobiliaria (`inmobiliaria`) | `venta` Venta de inmuebles · `arriendo` Arriendo · `comercial` Inmuebles comerciales | `promotora` Promotora inmobiliaria | `construccion` Construcción y proyectos |
| Restaurantes / Gastronomía (`restaurantes`) | `casual_dining` Restaurante casual · `comida_rapida` Comida rápida · `cafeteria` Cafetería · `dark_kitchen` Dark kitchen / Delivery | — | — |
| Automotriz (`automotriz`) | `concesionario` Concesionario · `taller` Taller mecánico · `repuestos` Repuestos y accesorios · `alquiler` Alquiler de vehículos | — | — |
| Turismo (`turismo`) | `agencia_viajes` Agencia de viajes · `hotel` Hotel / Hostal · `tours` Tours y actividades · `alquiler_vacacional` Alquiler vacacional | — | — |
| Educación (`education`) | `idiomas` Escuela de idiomas · `universitaria` Universidad / Instituto · `online` Cursos online · `capacitacion` Capacitación empresarial · `academia_baile` Academia de baile · `academia_musica` Academia de música o arte · `clases_particulares` Clases particulares y tutorías · `autoescuela` Autoescuela | — | — |
| Finanzas / Banca (`finanzas`) | `asesoria` Asesoría financiera · `creditos` Créditos y préstamos | `pagos_recaudos` Pagos y recaudos | `fintech` Fintech |
| Servicios profesionales (`servicios_profesionales`) | `abogados` Abogados · `contadores` Contadores · `arquitectos` Arquitectos · `consultores` Consultores | — | — |
| Retail / Comercio (`retail`) | `moda` Moda y ropa · `electronica` Electrónica · `hogar` Hogar y decoración | `marketplace` Marketplace / E-commerce | — |
| Tecnología (`technology`) | `saas` SaaS · `desarrollo` Desarrollo de software · `hardware` Hardware y redes | `soporte_ti_msp` Soporte TI y MSP | `consultoria_ti` Consultoría TI |
| Veterinaria (`veterinaria`) | `clinica_general` Clínica de pequeñas especies · `hospital_24h` Hospital veterinario 24h · `exoticos` Animales exóticos | — | `peluqueria_canina` Peluquería canina / felina (hoy es `pet_services/peluqueria`) |
| Gimnasios y Fitness (`gimnasios`) | `gimnasio_general` Gimnasio tradicional · `crossfit` Box CrossFit · `yoga_pilates` Estudio de yoga / pilates · `cycling` Cycling / spinning · `martial_arts` Artes marciales | — | — |
| Seguros (`seguros`) | `broker` Broker / Corredor · `vida` Especialista en vida · `auto` Especialista en auto | `aseguradora` Aseguradora · `salud` Especialista en salud | — |
| Servicios del hogar (`servicios_hogar`) | `plomeria` Plomería · `electricidad` Electricidad · `fumigacion` Fumigación · `limpieza` Limpieza · `jardineria` Jardinería · `cerrajeria` Cerrajería · `pintura` Pintura | — | — |
| Servicios para mascotas (`pet_services`) | `peluqueria` Peluquería canina/felina · `guarderia` Guardería diurna · `hotel` Hotel canino · `paseos` Paseos · `adiestramiento` Adiestramiento | — | — |
| Fotografía / Eventos (`fotografia`) | `estudio` Estudio fotográfico · `bodas` Wedding photography · `eventos` Eventos sociales y corporativos · `producto` Fotografía de producto | — | `wedding_planner` Wedding planner |
| Planeación de eventos (`event_planning`; oculta en el alta) | — | `weddings` Planeación de bodas | — |
| Construcción (`construccion`; oculta en el alta) | — | `contratista_general` Contratista general | — |
| Otro (`otro`) | (sin tipo de negocio) | — | — |

Un tipo **en lista de espera** existe como tipo pero no se ofrece en el alta y su
operación completa sigue cerrada. Un tipo **solo para cuentas existentes** ya no se
ofrece, pero sigue funcionando en las cuentas que lo tenían.

### Superficie principal por industria

| Industria | Superficie principal posible |
|-----------|------------------------------|
| Salud | Citas; Planes de tratamiento en odontología, dermatología y psicología; Pedidos e Inventario en farmacia |
| Belleza y estética | Citas; Planes de tratamiento en spa y centro de estética |
| Inmobiliaria | Citas (visitas) e Inmuebles |
| Restaurantes | Menú y Pedidos; reservas de mesa (Citas) en restaurante casual y cafetería |
| Automotriz | Concesionario: Vehículos y Citas; taller: Órdenes de taller y Citas; repuestos: Inventario y Pedidos; alquiler: Alquileres y Vehículos |
| Turismo | Agencia de viajes y tours: Reservas de tours y Tours y Paquetes; hotel y alquiler vacacional: Reservas (estadías) y Propiedades |
| Educación | Citas y Cursos (cohortes e inscripciones) |
| Finanzas | CRM y Citas, con traspaso a una persona para decisiones financieras |
| Servicios profesionales | CRM, Casos y Citas |
| Retail | Inventario y Pedidos; hogar y decoración suma Citas y Paquetes y servicios |
| Tecnología | CRM y Citas; Inventario y Pedidos para hardware |
| Veterinaria | Citas y Mascotas |
| Gimnasios | Membresías, Clases y reservas |
| Seguros | Planes, cotizaciones, pólizas y reclamos con controles de rol |
| Servicios del hogar | Solicitudes de servicio y Paquetes y servicios |
| Servicios para mascotas | Citas y Mascotas; guardería y hotel: Alquileres y estadías, Mascotas y Paquetes y servicios |
| Fotografía | Sesiones fotográficas y Paquetes y servicios |
| Otro | CRM, catálogo y pedidos genéricos |

Los nombres exactos del menú cambian según el tipo de negocio (por ejemplo el taller
mecánico ve «Órdenes de trabajo» y el hotel ve «Reservas» y «Habitaciones»); están en
el [catálogo](business-types-catalog.md), línea «Menú» de cada ficha.

## 21.1 Turismo — Tours, Paquetes y Alquiler Vacacional

**Para quién:** agencias de viajes, operadores de tours, hoteles con experiencias, alquiler vacacional (Airbnb-style).

**Tipos de negocio:**
- `turismo/tours` — tours y actividades (de día o multi-día)
- `turismo/agencia_viajes` — agencia de viajes
- `turismo/hotel` — hotel / hostal
- `turismo/alquiler_vacacional` — propiedades estilo Airbnb

Tours y agencia de viajes usan **Tours y Paquetes** y **Reservas de tours**; hotel y
alquiler vacacional usan **Propiedades** y **Reservas** (estadías).

### 21.1.1 Tours y Paquetes

**Ruta:** Catálogo y recursos → **Tours y Paquetes** (en el menú de la agencia se
rotula «Paquetes» y en el de tours, «Tours»); las salidas del día con sus viajeros
están en Trabajo diario → **Reservas de tours** (`/admin/tour-bookings`)

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

### 21.1.2 Propiedades (hotel y alquiler vacacional)

**Ruta:** Catálogo y recursos → Propiedades (en el menú del hotel se rotula
«Habitaciones» y en el del alquiler vacacional, «Alojamientos»)

**Crear propiedad:**
1. Propiedades → "Agregar propiedad"
2. Datos: nombre, dirección, ciudad, huéspedes máximos, habitaciones, baños, precio por
   noche, tarifa de limpieza, noches mínimas y moneda
3. **Amenidades** — 32 opciones en 6 categorías:
   - Esenciales: WiFi, aire acondicionado, calefacción, cocina, lavadora, secadora, TV, plancha
   - Baños: jacuzzi, bañera, secador de cabello, artículos de aseo
   - Exterior: piscina, estacionamiento, jardín, BBQ/parrilla, balcón, terraza, vista al mar, vista a la montaña
   - Seguridad: cámaras de seguridad, detector de humo, botiquín, caja fuerte
   - Entretenimiento: gimnasio, sala de juegos, Netflix/streaming, libros
   - Especiales: acepta mascotas, ascensor, accesible, espacio de trabajo

**Galería de imágenes:**
- Drag & drop, máximo 5 fotos, 2 MB cada una
- Reordenar, elegir foto portada
- Botones flecha para mover, ✓ para portada

**Límites por plan:** consulta **Administración → Facturación**. Las cuotas de
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
2. Click "Copiar" → pega esa URL en Airbnb → "Sincronizar calendario"
3. Airbnb lee tu calendario aprox cada hora

**Anti-doble-booking:**
- Verificación en tiempo real al confirmar reserva
- iCal tiene delay 3-6h — para máxima protección, acepta reservas con 24h+ de anticipación

### 21.1.4 Registro de estadías

**Ruta:** Trabajo diario → Reservas (`/admin/stays`; en inglés, «Stays»)

Esta pantalla es el registro operativo de estadías y no el Kanban del embudo. Permite
buscar, paginar, crear y cancelar reservas dentro de los permisos vigentes. La columna
de origen distingue las creadas por el agente de las creadas manualmente. **Propiedades**
permanece separada como catálogo y configuración del alojamiento.

### 21.1.5 Reservas directas

1. Detalle de propiedad → tab "Reservas" → "Nueva reserva"
2. Fechas, huésped, teléfono, número de huéspedes
3. Precio se calcula automáticamente
4. Aparece en feed de exportación (Airbnb la ve)

### 21.1.6 Check-in

Tab "Check-in" en cada propiedad:
- Instrucciones (código de puerta, WiFi, parking)
- Reglas de la casa
- Hora de check-in / check-out
- El agente IA puede enviarlas automáticamente

## 21.2 Inmobiliaria — Listings de venta y arriendo

**Para quién:** inmobiliarias y asesores independientes: `inmobiliaria/venta`, `inmobiliaria/arriendo` e `inmobiliaria/comercial`. NO para vacacional (eso es 21.1). Promotora inmobiliaria (`inmobiliaria/promotora`) está en lista de espera y Construcción y proyectos (`inmobiliaria/construccion`) solo existe para cuentas anteriores.

**Menú:** Catálogo y recursos → Inmuebles (en algunos tipos se rotula «Propiedades»); las visitas se agendan en Citas

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

**Filtros del agente** (todos opcionales):
- tipo de operación (venta o arriendo), tipo de inmueble, precio máximo, mínimo de habitaciones, barrio y ciudad.

## 21.3 Salud — Citas + Planes de Tratamiento

**Tipos de negocio:** `salud/dental`, `salud/medica_general`, `salud/dermatologia`,
`salud/psicologia` y `salud/farmacia`.

- Todos usan **Citas** salvo farmacia, que usa **Pedidos** e **Inventario**
  («Productos»).
- **Planes de tratamiento** están disponibles en odontología, dermatología y medicina
  estética, y psicología y terapia (y, en Belleza y estética, en spa y bienestar y en
  centro de estética). Medicina general no los incluye.

### 21.3.1 Planes de tratamiento

Para tratamientos multi-sesión (ortodoncia, series estéticas, psicoterapia, etc.).

**Vista global:**
**Ruta:** Catálogo y recursos → Planes de tratamiento

Tabla con todos los planes activos/pausados/completados de la clínica:
- Paciente, plan, progreso (barra), estado, fecha inicio, costo
- Tabs por estado: Todos, Activos, Pausados, Completados, Cancelados
- Búsqueda por paciente o nombre del plan

**Vista por paciente:**
1. Clientes → CRM → entra al lead/paciente
2. Tarjeta "Planes de tratamiento" en el panel izquierdo (collapsible)
3. "Crear plan" → tipo + sesiones totales + frecuencia + costo
4. Aparece la barra de progreso "0/N sesiones"

**Marcar sesiones completadas:**
- Expandir el plan → ves cada sesión
- Botón ✓ → progreso se actualiza
- Al completar todas → plan marca automáticamente como `completed`

**Cómo el agente IA usa esto:**
"¿Cuántas sesiones me faltan?" → `get_treatment_plan` → "Te quedan 5 sesiones de tu ortodoncia. Próxima 15 de mayo."

## 21.4 Veterinaria — Citas y Mascotas

**Tipos de negocio:** `veterinaria/clinica_general`, `veterinaria/hospital_24h` y
`veterinaria/exoticos`. La peluquería canina que antes colgaba de veterinaria
(`veterinaria/peluqueria_canina`) hoy es `pet_services/peluqueria` (sección 21.10).

### 21.4.1 Fichas de mascotas

**Ruta:** Trabajo diario → Mascotas (junto a la agenda, que en veterinaria se rotula
«Agenda»)

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

### 21.4.2 Qué hace el agente

Con la familia **Veterinaria** el agente consulta las fichas de mascotas del cliente
(`list_pets_for_contact`), puede registrar o actualizar una mascota
(`register_pet`, `update_pet`), consulta el estado de vacunación
(`get_vaccination_status`) y clasifica la urgencia de una emergencia
(`triage_pet_emergency`) para pasarla al equipo. Los tipos de veterinaria no incluyen
**Planes de tratamiento**.

## 21.5 Restaurantes — Menú + Pedidos

**Tipos de negocio:** `restaurantes/casual_dining`, `restaurantes/comida_rapida`,
`restaurantes/cafeteria` y `restaurantes/dark_kitchen`. Restaurante casual y cafetería
suman la agenda de mesas (en el menú, «Reservaciones»); comida rápida y dark kitchen no.

### 21.5.1 Menú

**Ruta:** Catálogo y recursos → Menú

**Crear categoría:**
1. Menú → campo **Nueva categoría…** → escribe el nombre

**Crear plato:**
1. **Agregar plato** → nombre del plato, descripción, categoría, precio y tiempo de
   preparación (min)
2. Etiquetas: vegetariano, vegano, sin gluten, picante, saludable, popular
3. Alérgenos
4. Marca un plato como **Agotado** o **Disponible** durante el servicio

### 21.5.2 Pedidos en cocina (kanban)

**Ruta:** Trabajo diario → Pedidos (`/admin/food-orders`); la pantalla se titula
**Pedidos en cocina**

Vista kanban en tiempo real con cinco columnas:
- **Recibidos** — entró el pedido
- **Preparando** — se está preparando
- **Listos** — para entregar o recoger
- **Entregados** — completado
- **Cancelados**

Al abrir una tarjeta ves los ítems, subtotal, domicilio, dirección de entrega, descuento,
total, cliente y pago, y puedes avanzar el pedido (**Marcar como preparando**,
**Marcar como listo**, **Marcar como entregado**) o cancelarlo.

### 21.5.3 Promociones

En la pantalla **Menú**, sección **Promociones**: crea promociones con un título, un
descuento en porcentaje o de monto fijo, una vigencia («Válida hasta») y un horario
opcional. El agente las menciona cuando el cliente pregunta por ofertas.

**Cómo el agente IA usa esto:**
"¿Tienen pizza?" → `get_menu` (por texto, categoría o etiqueta) → muestra opciones → al ordenar llama `place_order` → aparece en kanban de cocina. El agente también puede consultar el estado de un pedido (`check_order_status`), cancelarlo (`cancel_order`) y listar los del cliente (`list_my_orders`).

## 21.6 Gimnasios — Membresías + Clases

**Tipos de negocio:** `gimnasios/gimnasio_general`, `gimnasios/crossfit`,
`gimnasios/yoga_pilates`, `gimnasios/cycling` y `gimnasios/martial_arts`. Todos usan
**Membresías**, **Clases** y la agenda de reservas (en el menú, «Reservas»).

### 21.6.1 Planes de membresía

**Ruta:** Trabajo diario → Membresías (pestañas **Planes**, **Miembros** y **Clases**)

**Crear plan:**
1. **Crear plan** → nombre (ej: Mensual, Trimestral), descripción, precio y duración (días)
2. Créditos de clases (vacío = ilimitado), sesiones de personal training, pases de invitado
   y días de congelamiento
3. Estado del precio: confirmado, gratis o se cotiza. El agente solo dice los precios
   confirmados; un precio de ejemplo de la receta no se dice hasta que lo confirmes

### 21.6.2 Miembros

Pestaña **Miembros**, con búsqueda por nombre, teléfono o número:
- Miembro, plan actual, estado (activo, congelado, vencido, cancelado), vencimiento y créditos
- **Nuevo miembro** (el número de socio se genera solo si lo dejas vacío)
- **Congelar** (días a congelar; el vencimiento se extiende el mismo número de días al
  reactivar) y **Reactivar**

### 21.6.3 Clases programadas

**Ruta:** Trabajo diario → Clases (`/admin/classes`, «Clases programadas»); también en
la pestaña **Clases** de Membresías.

**Crear clase:** nombre, tipo, nivel, instructor (opcional), fecha y hora, duración,
capacidad, créditos y sala (opcional). En Membresías puedes **repetir semanas** para crear
la misma clase cada semana. **Cancelar clase** libera a quienes la habían reservado.

**Cómo el agente IA usa esto:**
"¿Hay yoga mañana?" → `get_class_schedule` → ofrece horarios con cupos → al confirmar llama `book_class`. También consulta planes (`get_membership_plans`), la membresía y las reservas del cliente (`get_my_membership`, `get_my_class_bookings`), congela la membresía (`freeze_membership`) y cancela reservas de clase (`cancel_class_booking`).

## 21.7 Educación — Cursos y Cohortes

**Tipos de negocio:** `education/idiomas`, `education/universitaria`,
`education/online`, `education/capacitacion`, `education/academia_baile`,
`education/academia_musica`, `education/clases_particulares` y
`education/autoescuela`. Los ocho usan **Citas** y **Cursos**.

### 21.7.1 Cursos

**Ruta:** Catálogo y recursos → Cursos (pantalla «Cursos y cohortes», con pestañas
**Cursos**, **Cohortes** e **Inscripciones**)

**Crear curso:** **Crear curso** → nombre, descripción, materia, nivel (A1, B2,
principiante, etc.), horas y semanas de duración, precio y certificación.

### 21.7.2 Cohortes (grupos)

Cada curso tiene cohortes (grupos que arrancan en diferentes fechas). En la pestaña
**Cohortes** → **Nueva cohorte**:
- Código (por ejemplo 2026-A2-MAÑANA), instructor y horario
- Fecha de inicio y de fin
- Capacidad y aula
- Estado: abierta, llena, cancelada o finalizada

### 21.7.3 Inscripciones

Pestaña **Inscripciones** → **Inscribir alumno** (eliges grupo, contacto del CRM y
nombre del alumno):
- Estado: inscrito, cursando, completado, dado de baja o reembolsado
- Pago: pendiente, parcial, pagado o reembolsado, con el monto pagado

### 21.7.4 Prueba de nivel

Para idiomas y otras materias con nivel, el agente IA puede compartir el enlace de la
prueba de nivel del contacto (`get_placement_test_link`, con la materia opcional). El
agente **entrega el enlace**; no toma la prueba ni calcula el nivel por sí mismo.

**Cómo el agente IA usa esto:**
"Quiero aprender inglés" → `get_courses` y `get_course_schedule` → muestra cursos y horarios disponibles → si el alumno quiere saber su nivel, comparte el enlace de la prueba (`get_placement_test_link`) → al confirmar, inscribe (`enroll_student`). También puede cancelar una inscripción (`cancel_enrollment`) y listar las del alumno (`list_my_enrollments`).

## 21.8 Seguros — Planes, Cotizaciones, Pólizas y Reclamos

**Tipos de negocio:** `seguros/broker`, `seguros/vida` y `seguros/auto`.
`seguros/aseguradora` y `seguros/salud` están en lista de espera: no se ofrecen en el
alta y su operación completa sigue cerrada.

**Ruta:** Trabajo diario → **Seguros** (en el menú de seguros se rotula «Pólizas»). La
pantalla tiene cuatro pestañas: **Planes**, **Cotizaciones**, **Pólizas** y **Reclamos**.

### 21.8.1 Planes

**Crear plan:** **Crear plan** → nombre, tipo de seguro (por ejemplo vida, salud, auto,
hogar o viaje), descripción, prima mínima y máxima (mensual), cobertura máxima, deducible
y edad mínima y máxima.

### 21.8.2 Cotizaciones

Cuando el cliente pide una cotización:
1. El agente IA consulta los planes (`get_insurance_plans`) y toma los datos necesarios
2. Calcula la prima con `calculate_quote`
3. La cotización aparece en la pestaña **Cotizaciones** con su estado (enviada, aceptada,
   rechazada o vencida)
4. Si el cliente acepta, el equipo emite la póliza con **Emitir póliza**; una cotización
   ya aceptada no se vuelve a emitir

El agente también puede cancelar una cotización (`cancel_quote`).

### 21.8.3 Pólizas

Pestaña **Pólizas**: lista de pólizas con su número, asegurado, plan, prima y estado
(activa, suspendida, vencida o cancelada). **Nueva póliza** exige número de póliza,
contacto vinculado, asegurado y prima; sin contacto vinculado el cliente no puede
consultar su póliza por WhatsApp (`check_policy_status`).

### 21.8.4 Reclamos (siniestros)

Pestaña **Reclamos**: número de reclamo, tipo de siniestro, fecha de radicación, monto
reclamado y estado (radicado, en revisión, aprobado, rechazado o pagado). El cliente
reporta el siniestro por el chat (`file_claim`) y puede consultar sus reclamos
(`list_my_claims`): "¿Cómo va mi reclamo del 5 de mayo?".

## 21.9 Servicios del hogar — Despacho de técnicos

**Tipos de negocio:** `servicios_hogar/plomeria`, `servicios_hogar/electricidad`,
`servicios_hogar/fumigacion`, `servicios_hogar/limpieza`, `servicios_hogar/jardineria`,
`servicios_hogar/cerrajeria` y `servicios_hogar/pintura`. Usan **Solicitudes** y
**Paquetes y servicios**.

### 21.9.1 Solicitudes de servicio

**Ruta:** Trabajo diario → **Solicitudes** (en el menú de servicios del hogar se rotula
«Servicios»; la pantalla se titula «Solicitudes de servicio»)

Filtros: **Todas**, **Activas** y **Emergencias**. Las solicitudes llevan una urgencia
(emergencia, alta, normal o flexible) que el agente fija según lo que cuenta el cliente:
emergencia = inundación, sin luz o riesgo de seguridad; alta = el mismo día; normal =
en 2-3 días; flexible = cuando convenga.

**Cada solicitud:**
- Cliente (nombre, teléfono) y dirección con sus notas
- Tipo de servicio y problema reportado
- Fecha y franja preferidas
- Fecha programada y costo estimado
- Técnico asignado
- Estado: pendiente → cotizado → agendado → despachado → en curso → completado
  (**Avanzar** pasa al siguiente estado; para pasar a agendado hay que fijar la fecha)

### 21.9.2 Asignación de técnicos

La asignación es **manual**: en cada solicitud eliges o escribes el técnico. La lista usa
el equipo activo configurado en Citas → Personal. No hay asignación automática por habilidades ni por carga.

### 21.9.3 Paquetes y servicios

**Ruta:** Catálogo y recursos → **Paquetes y servicios** (`/admin/service-catalog`): lo
que el negocio vende, con su duración, su precio y su capacidad. Sin al menos un
paquete cargado, el agente responde que no hay nada para ofrecer.

**Cómo el agente IA usa esto:**
"Tengo una fuga en el baño" → `list_home_services` y `check_home_service_availability` → `create_service_request` con tipo de servicio, urgencia, dirección y descripción del problema → la solicitud queda registrada y el equipo la cotiza y la agenda. El agente también consulta el estado (`check_request_status`), lista las solicitudes del cliente (`list_my_requests`) y puede cancelarlas (`cancel_service_request`). Una fecha preferida es solo información de recepción: no promete una visita.

## 21.10 Servicios para mascotas — Peluquería, guardería, hotel, paseos y adiestramiento

**Tipos de negocio:** `pet_services/peluqueria`, `pet_services/guarderia`,
`pet_services/hotel`, `pet_services/paseos` y `pet_services/adiestramiento`.

- Peluquería, paseos y adiestramiento usan la agenda de reservas (en el menú,
  «Reservas») y las fichas de **Mascotas** (en el menú de peluquería se rotulan
  «Servicios»); la ficha funciona como en la sección 21.4.1.
- Guardería diurna y hotel canino usan **Alquileres y estadías** (en el menú,
  «Estadías»), **Mascotas** y **Paquetes y servicios**.

**Ruta de estadías:** Trabajo diario → Alquileres y estadías (`/admin/resource-rentals`),
sección **Estadías de mascotas**: reservas, ingresos y salidas de cada mascota (estados
reservada, mascota ingresada, mascota retirada, rechazada, cancelada). Antes de crear una
estadía registra la mascota y su contacto responsable, y en Citas → Servicios define un
servicio con categoría hotel o guardería y una capacidad mayor a cero.

El agente consulta los servicios (`list_pet_services`) y la disponibilidad de guardería
(`check_daycare_availability`) y, en guardería y hotel, crea, consulta y cancela
estadías (`create_pet_boarding`, `get_pet_boarding`, `list_my_pet_boardings`,
`cancel_pet_boarding`).

La peluquería canina que antes figuraba bajo veterinaria (`veterinaria/peluqueria_canina`)
solo existe para cuentas anteriores; una cuenta nueva elige `pet_services/peluqueria`.

## 21.11 Fotografía — Sesiones y galerías

**Tipos de negocio:** `fotografia/estudio`, `fotografia/bodas`, `fotografia/eventos` y
`fotografia/producto`. `fotografia/wedding_planner` solo existe para cuentas
anteriores (un wedding planner opera evento, presupuesto y proveedores, que no es la
operación de fotografía). Usan **Sesiones fotográficas** y **Paquetes y servicios**.

### 21.11.1 Sesiones

**Ruta:** Trabajo diario → Sesiones fotográficas (`/admin/photo-sessions`; en el menú de
fotografía se rotula «Sesiones» o «Paquetes»)

Tabla de sesiones con:
- Cliente, tipo (boda, retrato, evento, producto, familia, recién nacido u otro), paquete,
  fecha, estado, precio y galería
- Estados: solicitada → agendada → en curso → entregada, o cancelada
- Acciones: **Confirmar fecha**, **Empezar** y **Entregar**

**Tabs por estado:** Todas, Solicitadas, Agendadas, En curso, Entregadas, Canceladas.
Búsqueda por cliente o paquete.

### 21.11.2 Reserva por IA

"Quiero una sesión de boda para junio" → el agente consulta los paquetes
(`list_photo_packages`), puede enviar el portafolio (`send_portfolio`), consulta la
disponibilidad de una fecha (`check_date_availability`) y registra la solicitud
(`request_photo_quote`). La sesión queda **solicitada** y el equipo del estudio la
confirma con **Confirmar fecha**. El agente también puede cancelar una sesión
(`cancel_photo_session`).

### 21.11.3 Entrega de galería

1. En la sesión → **Entregar**
2. Pega el link de la galería (con contraseña opcional) e indica las fotos entregadas
3. La sesión pasa a entregada

### 21.11.4 Paquetes y servicios

**Ruta:** Catálogo y recursos → **Paquetes y servicios**: los paquetes que ofrece el
estudio, con su duración, precio y capacidad.

## 21.12 Belleza y estética — Agenda, tratamientos y catálogo

**Tipos de negocio** (industria `moda_belleza`, que el selector rotula «Belleza y
estética»): `moda_belleza/salon_belleza`, `moda_belleza/barberia`,
`moda_belleza/spa` y `moda_belleza/estetica`.

- Los cuatro usan **Citas** para servicios y disponibilidad.
- Spa y bienestar y centro de estética añaden **Planes de tratamiento**.
- El id antiguo `moda_belleza/boutique` ya no se ofrece y se resuelve como
  `retail/moda` (sección 21.16).

El agente puede orientar y reservar con la información configurada, pero no debe
diagnosticar, garantizar resultados ni recomendar productos no autorizados.

## 21.13 Automotriz — Vehículos, citas, repuestos, taller y alquiler

**Tipos de negocio:** `automotriz/concesionario`, `automotriz/taller`,
`automotriz/repuestos` y `automotriz/alquiler`.

- **Concesionario**: **Citas** y **Vehículos** (Catálogo y recursos). El agente busca
  vehículos (`search_vehicles`), muestra su ficha e imágenes (`get_vehicle_details`,
  `send_vehicle_image`) y puede agendar una prueba de manejo (`schedule_test_drive`),
  que además necesita la familia de citas.
- **Taller mecánico**: **Órdenes de taller** (sección 21.13.1) y **Citas**. El taller no
  usa el inventario de vehículos.
- **Repuestos**: **Inventario** (en el menú, «Repuestos») y **Pedidos**.
- **Alquiler de vehículos**: **Alquileres y estadías** (sección 21.13.2) y **Vehículos**
  (en el menú, «Flota»).

La pantalla exacta se deriva del tipo de negocio y las capacidades publicadas. Una
prueba de manejo creada no implica aprobación de financiación ni reserva definitiva del
vehículo.

### 21.13.1 Órdenes de taller

**Ruta:** Trabajo diario → **Órdenes de taller** (`/admin/repair-orders`; en el menú
del taller mecánico se rotula «Órdenes de trabajo»). El técnico asignado se elige del
equipo activo configurado en Citas → Personal.

- Tablero con las métricas **Órdenes abiertas**, **Esperando aprobación**, **Listas para
  entregar** y **Entregadas en 30 días**; búsqueda por placa, VIN, vehículo o motivo.
- **Nueva orden**: contacto, vehículo (marca, modelo, año, kilometraje y **placa o VIN**,
  uno de los dos es obligatorio), motivo y síntomas reportados por el cliente.
- Estados: recepción → en diagnóstico/cotización → esperando aprobación → aprobada → en
  reparación → lista para entregar → entregada (también estimado rechazado y cancelada).
- **Publicar estimado**: el estimado pasa a aprobación del cliente. El equipo puede
  **Registrar aprobación** o **Registrar rechazo** indicando cómo y cuándo decidió el
  cliente.
- El motivo reportado es el relato del cliente, no un diagnóstico técnico ni una
  promesa de reparación; el diagnóstico del técnico solo lo escribe el equipo del taller.

**Cómo el agente IA usa esto:** abre la recepción cuando el cliente identifica su
vehículo (`create_repair_order`), consulta las órdenes del cliente
(`list_my_repair_orders`, `get_repair_order`), registra la decisión explícita del cliente
sobre el estimado vigente (`approve_repair`) y puede cancelar una orden mientras aún se
permita (`cancel_repair_order`). Nunca convierte síntomas en diagnóstico, precio ni
duración de reparación.

### 21.13.2 Alquiler de vehículos

**Ruta:** Trabajo diario → **Alquileres y estadías** (`/admin/resource-rentals`; en el
menú del alquiler de vehículos se rotula «Reservas»), sección **Reservas de vehículos**:
solicitudes, requisitos y control de entrega, devolución y daños.

- Estados: pendiente de revisión, reservada, vehículo entregado, vehículo devuelto,
  rechazada y cancelada.
- Acciones: **Entregar vehículo**, **Registrar devolución** y **Cancelar**.
- La solicitud del agente queda para revisión antes de reservar el vehículo.
- Configuración previa: agrega los vehículos y márcalos disponibles en **Vehículos**
  («Flota»).

El agente consulta la disponibilidad (`check_vehicle_rental_availability`) y crea,
consulta, lista y cancela alquileres (`create_vehicle_rental`, `get_vehicle_rental`,
`list_my_vehicle_rentals`, `cancel_vehicle_rental`).

## 21.14 Finanzas — CRM y agenda con límites regulados

**Tipos de negocio:** `finanzas/asesoria` y `finanzas/creditos`.
`finanzas/pagos_recaudos` está en lista de espera y `finanzas/fintech` solo existe
para cuentas anteriores («Fintech» no es un producto: pagos, wallet, remesas, neobanco e
inversión tienen licencias, ledgers y riesgos incompatibles).

Esta industria ofrece un preset horizontal de CRM, FAQs y agenda. Sirve para captar,
calificar y coordinar consultas; no automatiza aprobación de crédito, recomendaciones
de inversión, rentabilidades ni asesoría tributaria individual. Esas decisiones deben
pasar a una persona autorizada.

## 21.15 Servicios profesionales — Consultas y casos

**Tipos de negocio:** `servicios_profesionales/abogados`, `/contadores`, `/arquitectos`
y `/consultores`.

Combina CRM, FAQs, agenda y **Casos**.

**Ruta:** Trabajo diario → **Casos** (`/admin/cases`): los expedientes del estudio, con
referencia, cliente, etapa y último movimiento; filtros **Abiertos**, **Cerrados** y
**Todos**, y acceso a la conversación. Un caso se abre cuando una consulta avanza en el
embudo, y el agente puede consultar su estado por chat (`get_case_status`, solo
lectura) tras validar la identidad requerida. No existe una promesa de expediente
jurídico/contable completo, de cotización o propuesta por chat, ni de asesoría
profesional automática.

## 21.16 Retail — Inventario y pedidos

**Tipos de negocio:** `retail/moda` (Moda y ropa), `retail/electronica` y
`retail/hogar` (Hogar y decoración). `retail/marketplace` está en lista de espera
(operar un marketplace exige merchant of record, alta de vendedores, órdenes
multi-vendedor, comisiones, pagos a vendedores y disputas). Los ids antiguos
`moda_belleza/boutique` y `pet_services/tienda` se resuelven como `retail/moda`.

La operación principal usa **Inventario** (en el menú, «Productos») y **Pedidos**; hogar y
decoración suma **Citas** y **Paquetes y servicios**. El catálogo permite consultar
productos disponibles y el flujo de órdenes usa los estados habilitados por el backend.
Precios, stock y condiciones deben venir de los datos vigentes del tenant; el agente no
debe inventarlos.

## 21.17 Tecnología — Demos, servicios y hardware

**Tipos de negocio:** `technology/saas`, `technology/desarrollo` y
`technology/hardware`. `technology/soporte_ti_msp` está en lista de espera y
`technology/consultoria_ti` solo existe para cuentas anteriores (la mesa de servicio
MSP y la consultoría por proyectos son dos productos distintos).

- SaaS y desarrollo de software usan CRM y agenda para demos o reuniones.
- Hardware y redes usa inventario (en el menú, «Equipos») y pedidos.

La industria ayuda a organizar el ciclo comercial, pero no sustituye herramientas de
gestión de proyectos, soporte técnico o licenciamiento si esas capacidades no aparecen
habilitadas en la cuenta.

## 21.18 Otro — Fallback genérico

Cuando una empresa no encaja en las categorías anteriores, Parallly usa un preset
estable de CRM, FAQs, catálogo y pedidos. El nombre de la operación se mantiene
genérico y no se infieren módulos especializados. Un Admin puede completar identidad,
pipeline, conocimiento y catálogo desde la web. La receta inicial de esta industria no
se escribe a mano: Parallly propone una generada con IA a partir de la frase que pusiste
en el alta sobre qué hace tu negocio; aparece como sugerencia y no reemplaza lo que ya
cambiaste.

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
con la base de ayuda versionada y el contexto autorizado de página, rol, plan,
industria y tipo de negocio. También ofrece sugerencias rápidas y, para los roles habilitados, puede
reiniciar el tour. Sus respuestas siguen los permisos del usuario: conocer una
función no concede acceso a su pantalla.

Desde **Salud de tus agentes** o un aviso crítico, Admin/Supervisor también puede
elegir **Preguntar a Assist**. El chat recibe un objetivo de calidad validado por el
servidor y explica una sola prioridad usando el estado vigente del agente. Admin puede
recibir una ruta de reparación; Supervisor recibe una ruta de revisión sin obtener
permisos de edición.

Ese contexto contiene solo códigos y agregados necesarios —estado, versión, hito,
bloqueadores, vigencia de pruebas, tamaño de muestra, gravedad, pilar, dimensión y
conteo—. No entrega al modelo transcripciones, texto de clientes, IDs de conversación,
prompts, consultas de recuperación, texto libre del evaluador ni secretos. Parallly
Assist puede proponer cambios en los controles guiados autorizados del agente y, tras
la confirmación del Admin, guardarlos como borrador. No cambia el prompt personalizado,
el contenido de políticas o documentos, credenciales, conexiones, activación ni
publicación; tampoco
confirma cambios que no hizo ni envía comunicaciones externas.

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

- Cliente respondió por otro canal y quieres continuar en chat
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

- **Tabs:** Inbox, CRM, la pestaña de trabajo diario (se rotula «Citas» y cambia de nombre según el tipo de negocio) y Más.
- **Conversación:** asignar/tomar control, devolver a IA, resolver, notas, macros,
  sugerencias y resumen, según rol y estado; los mensajes sin conexión pueden quedar
  en una outbox local aislada por cuenta hasta reconectar.
- **CRM:** consultar o crear leads y mover deals cuando el backend lo autoriza.
- **Trabajo diario:** agenda, estadías, tours, pedidos, clases, matrículas, seguros,
  solicitudes, sesiones, alquileres o mascotas según capacidades publicadas. El
  workspace móvil no incluye **Órdenes de taller** ni **Casos** (servicios
  profesionales): se operan en la web.
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
- Puedes monitorear tu uso en **Administración → Facturación** (barras de uso multimedia)

## 27.5 Monitoreo de uso

En la página de **Facturación** (Administración → Facturación) verás:

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
| **Mindbody** | Gimnasios | Descubrimiento de clases y horarios espejados; no confirma cupo en vivo ni reserva |
| **Cliniko** | Salud | Tipos de cita y disponibilidad (sin acceder al historial clínico) |

Para cada una: ingresa las credenciales, pulsa **Probar** la conexión y
**Sincronizar**. Una vez conectada, el agente usa esos datos dentro del modo declarado
por proveedor. En Mindbody, el resultado incluye fecha de observación y deriva a
handoff o lista de espera si el cliente pide disponibilidad viva.

La pantalla distingue conexión viva de frescura del espejo. Una lectura en vivo no se
apaga porque el último espejo sea antiguo; una lectura servida desde el espejo sí muestra
su fecha y falla cerrado cuando supera el presupuesto del proveedor.

Cada integración expone además la conexión, recurso y versión de API observados. El
panel de **mapeos de recursos** relaciona un objeto local con uno externo de forma
versionada. Duplicados quedan en conflicto, una desconexión crea tombstones y un
mapeo nunca habilita escrituras externas por sí solo.

## 32.1 Channel Manager para alojamiento

**Dónde:** **Configuración → Canales e integraciones → Channel Manager**, solo para
`turismo/hotel` y `turismo/alquiler_vacacional`.

- La configuración, prueba, sincronización y mapeo de publicación ↔ propiedad son
  operaciones distintas; se puede probar antes de guardar.
- Las credenciales nunca se devuelven en claro al navegador.
- Una propiedad sin mapeo usa el registro nativo de Parallly.
- Una propiedad mapeada suma las reservas remotas a conflictos y bloquea el writer
  local si el proveedor es el sistema de registro.
- El write-back externo permanece deshabilitado hasta certificar el adapter y su
  versión en sandbox. El estado conectado por sí solo no habilita escrituras.

---

# 33. Conectores MCP

**MCP (Model Context Protocol)** es un estándar abierto para conectar "herramientas de acción" a la IA, sin quedar atado a un proveedor.

**Dónde:** **Configuración → Desarrolladores → MCP**.

- **Tu servidor MCP** — expón las herramientas de tu agente (catálogo, FAQs, base de conocimiento…) a clientes MCP externos mediante un endpoint, autenticado con tu API Key.
- **Servidores MCP externos** — conectar o descubrir un servidor no autoriza sus
  herramientas. Un administrador debe revisar cada tool y declarar efecto,
  confirmación y aprobación humana. Solo entonces puede publicarse al agente; una
  tool desconocida o no aprobada permanece bloqueada.

---

# 34. Organizaciones B2B y forecast

Agrupa contactos por **empresa/cuenta** y proyecta tus ingresos.

**Dónde:** menú → **Clientes → Organizaciones** (`/admin/contacts/organizations`).

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
Depende del país, plan y ciclo disponibles. Consulta **Administración → Facturación**:
las tarjetas se cargan desde el catálogo activo y muestran el importe, moneda, cuotas y
modalidad aplicables a tu cuenta.

**¿Puedo probar antes de pagar?**
Cuando un plan ofrece prueba, su tarjeta indica la duración, si requiere método de pago
y la fecha exacta de finalización. No todos los planes o países tienen la misma oferta.

**¿En qué países funciona?**
La disponibilidad comercial, moneda y método de cobro dependen del catálogo activo para
el país de facturación. Verifica la opción que muestra el checkout o consulta ventas.

**¿Cómo cambio de plan?**
Administración → Facturación → selecciona una tarjeta habilitada y revisa el resumen. La
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
Puedes conectar los canales autoservicio habilitados para tu cuenta y, cuando el plan vigente lo permita, **varias conexiones del mismo tipo** (p. ej. dos números de WhatsApp). Cada conexión puede tener su propio agente. Revisa el cupo aplicable en **Administración → Facturación** y consulta las secciones 9.8 y 8.2.

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
vigente en **Administración → Facturación**.

## Seguridad

**¿Puedo activar 2FA?**
Sí — Configuración → Seguridad. Soporta app autenticadora (TOTP), código por email y códigos de respaldo.

**¿Qué son los dispositivos de confianza?**
Al marcar "Confiar en este dispositivo" al iniciar sesión con 2FA, no te pedirá el segundo factor por 30 días en ese navegador. Puedes revocarlos en cualquier momento.

## Integraciones y API

**¿Puedo conectar Parallly con Zapier o Make?**
Sí — crea una suscripción webhook (Configuración → Avanzado → Webhooks) para recibir eventos, y usa las claves de API para enviar datos. Ver secciones 18.7 y 18.9.

**¿Cuántas API keys puedo crear?**
La pantalla muestra si la API pública está habilitada y cuántas claves permite el
plan vigente. Recomendamos una clave separada por integración.

**¿Parallly soporta email como canal?**
Email tiene un adaptador inbound interno para integraciones administradas, pero no es
un canal conversacional configurable en autoservicio. Su ruta heredada redirige al
inventario certificado y el servidor rechaza conexiones, asignaciones y campañas
nuevas de Email. Si necesitas la integración, solicita una evaluación técnica a
soporte; ver sección 9.6.

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
