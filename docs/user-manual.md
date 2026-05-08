# Parallly — Manual de Usuario

<p align="center">
  <img src="../docs/images/parallly-logo.png" alt="Parallly Logo" width="200" />
</p>

<p align="center">
  <strong>Plataforma de IA Conversacional Omnicanal</strong><br/>
  Guía completa para tenants — administradores, supervisores y agentes
</p>

<p align="center">
  Versión 4.0 — Mayo 2026
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
| 26 | [Preguntas frecuentes (FAQ)](#26-preguntas-frecuentes) |

---

# 1. Introducción

Parallly es una plataforma SaaS que permite a negocios automatizar y centralizar conversaciones de ventas, soporte y atención al cliente a través de **WhatsApp, Instagram, Messenger, Telegram y SMS** — con agentes de inteligencia artificial que operan sobre tu catálogo, tu agenda y tu base de clientes reales.

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
- Enviar campañas masivas
- Analizar métricas de rendimiento
- Adaptar la plataforma a más de 16 industrias verticales

---

# 2. Primeros Pasos

## 2.1 Crear una cuenta

1. Ir a [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud)
2. Clic en **Registrarse**
3. Ingresar email y contraseña (o usar Google OAuth)
4. Verificar el email con el código de 6 dígitos que recibirás
5. Completar el asistente de onboarding (sección 2.2)

## 2.2 Asistente de Onboarding

Al crear tu cuenta, un asistente de 5 pasos configura tu negocio:

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

### Paso 4 — Referencia
¿Cómo conociste Parallly? (Google, Instagram, recomendación, etc.)

### Paso 5 — Plan
Seleccionas plan (Starter, Pro o Enterprise) y método de pago si es necesario.

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

## 3.1 Resumen rápido

| Rol | A quién va | Acceso típico |
|-----|------------|---------------|
| **Tenant Admin** | Dueño del negocio, gerente | TODO — incluye facturación, canales, usuarios, agente IA |
| **Tenant Supervisor** | Líder de operaciones, jefe de equipo | Operación + analytics + automatización (sin facturación ni usuarios) |
| **Tenant Agent** | Asesor, vendedor, recepcionista | Solo bandeja, contactos, citas, su propia performance |

## 3.2 Tenant Admin — Acceso completo

**Ideal para:** dueño/a del negocio, gerente general, persona que firma el contrato.

**Puede:**
- ✅ Todo lo del Supervisor y Agent
- ✅ Conectar y desconectar canales (WhatsApp, Instagram, Messenger, Telegram, SMS)
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
- ✅ Crear y enviar campañas de broadcast
- ✅ Cargar contenido a la base de conocimiento
- ✅ Ver analytics completas (CRM, agentes, canales, CSAT)
- ✅ Configurar etapas del pipeline y reglas de scoring
- ✅ Crear macros, plantillas de email y formularios pre-chat
- ✅ Definir campos personalizados, horarios de atención y localización
- ✅ Aprobar deals que requieren aprobación
- ✅ Hacer merge manual de contactos en duplicados

**No puede:**
- ❌ Conectar/desconectar canales
- ❌ Crear o eliminar agentes IA
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
- ✅ Ver sus propias métricas en agent-analytics
- ✅ Ver y solicitar features (feature requests)
- ✅ Acceder a media (logos, fotos compartidas)

**No puede:**
- ❌ Configurar agentes IA, canales o automatizaciones
- ❌ Ver analytics generales (solo las propias)
- ❌ Crear campañas masivas o cargar conocimiento
- ❌ Modificar pipeline, scoring, o configuración del tenant
- ❌ Ver facturación ni gestionar usuarios

## 3.5 Cambiar el rol de un usuario

Solo un **Tenant Admin** puede cambiar roles:

1. Configuración → **Usuarios**
2. Click en el usuario
3. Selecciona el nuevo rol
4. Guarda

> **Importante:** Si bajás de Admin a Supervisor a alguien que tiene canales conectados, los canales siguen funcionando — solo se le quita la habilidad de modificarlos.

---

# 4. Dashboard

**Ruta:** Menú → Dashboard
**Roles:** Todos

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

---

# 5. Navegación

## 5.1 Menú principal — 3 secciones, items dinámicos

El sidebar se organiza en 3 secciones nombradas:

### OPERACIÓN
- **Bandeja de entrada** — conversaciones activas
- **Contactos** — CRM
- **Pipeline** — kanban de deals
- **Agenda** — citas y disponibilidad
- *(verticales)* Propiedades, Tours, Inmuebles, Menú, Pedidos, Membresías, Clases, Cursos, Seguros, Solicitudes, Mascotas, Sesiones fotográficas, Planes de tratamiento

### CRECIMIENTO
- **Campañas** — broadcasts (admin/supervisor)
- **Automatización** — reglas (admin/supervisor)
- **Base de conocimiento** — RAG (admin/supervisor)
- **Analíticas** — métricas (admin/supervisor)

### GESTIÓN
- **Agente IA** — configuración (admin)
- **Canales** — conexiones (admin)
- **Usuarios** — equipo (admin)

### Configuración (al fondo)
Sección con 5 áreas (ver siguiente sección).

> **Adaptación vertical:** los items específicos de una industria solo aparecen si tu negocio es de esa vertical. Por ejemplo, "Propiedades" solo lo ven los tenants de Turismo.

## 5.2 Configuración — 5 secciones

| Sección | Contiene |
|---------|----------|
| **Cuenta** | Mi perfil, cambiar contraseña, sesiones |
| **Empresa** | Datos del negocio, horarios, localización, custom attributes |
| **Herramientas** | Pipeline, scoring, macros, plantillas email, pre-chat, recall |
| **IA** | Configuración del modelo, comportamiento avanzado |
| **Avanzado** | Compliance, exportación de datos, webhooks (admin) |

## 5.3 Analítica — pestañas

Acceso solo para admin/supervisor. Pestañas disponibles:

| Pestaña | Contenido |
|---------|-----------|
| Resumen | KPIs principales |
| Conversaciones | Volumen, resolución, tiempo respuesta |
| CSAT | Encuestas de satisfacción |
| Embudo | Funnel de conversión |
| Velocidad | Días por etapa del pipeline |
| Win/Loss | Tasa de cierre y motivos |
| Agentes | Leaderboard, performance |
| Canales | Por canal de mensajería |
| Fuentes | Origen de leads |
| AI Insights | Análisis IA de tendencias |

---

# 6. Inbox — Bandeja de Entrada

**Ruta:** Sidebar → Bandeja de entrada
**Roles:** Todos

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

Filtros por canal: WhatsApp, Instagram, Messenger, Telegram, SMS.

## 6.3 Notificaciones de handoff

La campana en TopBar muestra 7 categorías:
- **handoff_direct** — el cliente pidió hablar con humano (rojo)
- **handoff_normal** — IA escaló por baja confianza (amarillo)
- **escalation** — supervisor: alguien lleva >5min sin responder (rojo + sonido)
- **system** — alertas de plataforma
- **billing** — pagos, trials terminando
- **csat** — encuesta respondida
- **mention** — alguien te etiquetó

## 6.4 Acciones de conversación

| Acción | Quién |
|--------|-------|
| Responder | Todos |
| Tomar control (handoff) | Todos |
| Devolver al bot | Todos |
| Snooze (posponer) | Todos |
| Marcar como resuelta | Todos |
| Archivar | Todos |
| Eliminar conversación | Admin |
| Asignar a otro agente | Admin/Supervisor |
| Mover etapa pipeline | Todos |
| Aplicar macro | Todos |
| Ver historial cross-canal | Todos |

## 6.5 Panel del contacto

Lateral derecho con tabs:
- **Info**: nombre, teléfono, canal de origen, tags, score
- **Pipeline**: etapa actual, valor del deal
- **Citas**: próximas y pasadas
- **Historial**: notas, actividades, llamadas
- **Custom fields**: campos personalizados según industria

---

# 7. CRM — Gestión de Contactos

## 7.1 Contactos

**Ruta:** Sidebar → Contactos
**Roles:** Todos (con limitaciones de edición según rol)

### Ver contactos

Tabla con columnas: nombre, canal, último mensaje, score, etapa pipeline, tags. Ordenable por cualquiera.

### Acciones principales

| Acción | Roles |
|--------|-------|
| Ver detalle | Todos |
| Editar | Todos |
| Crear lead | Todos |
| Archivar | Admin/Supervisor |
| Acciones masivas | Admin/Supervisor |
| Filtros avanzados | Todos |

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

**Ruta:** Sidebar → Pipeline

Vista kanban con etapas configurables. Cada deal una tarjeta arrastrable.

### Personalizar etapas

Solo Admin/Supervisor desde Configuración → Pipeline:
- Reordenar arrastrando
- Editar color (8 colores) y probabilidad de cierre
- Marcar etapas terminales (ganado/perdido)
- Crear/eliminar etapas

### Aprobación de deals

Para etapas marcadas como "requieren aprobación":
- Agente mueve la tarjeta → aparece badge amarillo "Pendiente"
- Supervisor/Admin revisa y aprueba/rechaza con motivo
- Solo entonces avanza a la siguiente etapa

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

Sidebar → Identidad → tab "Sugerencias":
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

---

# 8. Agentes IA

**Ruta:** Sidebar → Agente IA
**Roles:** Tenant Admin (lectura limitada para Supervisor desde inbox)

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

### Límites por plan

| Plan | Agentes IA | Plantillas custom |
|------|-----------|-------------------|
| Starter | 1 | No |
| Pro | 3 | Sí |
| Enterprise | 10 | Sí |
| Custom | Ilimitado | Sí |

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

### Comportamiento
- Reglas custom (free text)
- Temas prohibidos
- Modo respuesta (siempre IA, siempre humano, híbrido)
- Activación / horario

### Asignación de canales

Selector de canales que este agente atiende. **Regla dura**: un canal solo puede tener UN agente.

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

---

# 9. Canales de Comunicación

**Ruta:** Sidebar → Canales
**Roles:** Tenant Admin (lectura para los demás)

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

## 9.5 SMS (Twilio)

### Conectar
1. Canales → SMS → "Conectar"
2. Ingresar Account SID, Auth Token y número Twilio
3. Configurar webhook en Twilio: `https://api.parallly-chat.cloud/api/v1/sms/webhook/{tenantId}`
4. Listo

## 9.6 Desconectar un canal

1. Canales → click en el canal → "Desconectar"
2. Modal confirmación con resultado real:
   - **Verde** ✅ "Desconectado completamente": proveedor confirmó la desuscripción
   - **Amarillo** ⚠️ "Desconectado en plataforma — revisar el proveedor": tu BD se actualizó pero el proveedor podría seguir enviando. Causas: token expirado, cambio de permisos. Hay que entrar manualmente al proveedor (Meta Business Suite, etc.)
   - **Rojo** ❌: error de red — reintenta

---

# 10. Citas y Agenda

**Ruta:** Sidebar → Agenda
**Roles:** Todos (configuración solo Admin/Supervisor)

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

### Multi-calendar (plan-gated)

| Plan | Calendarios |
|------|-------------|
| Starter | 1 |
| Pro | 3 |
| Enterprise | 10 |
| Custom | Ilimitados |

Resolución 3-tier al sincronizar:
1. Calendario específico del **servicio**
2. Calendario específico del **staff**
3. Calendario general del tenant

### Desconectar un calendario con citas futuras

Si el calendario tiene citas futuras, antes de desconectar:
1. Botón "Reasignar a otro calendario"
2. Selecciona destino
3. Las citas se mueven y luego se desconecta

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

**Ruta:** Sidebar → Automatización
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

---

# 12. Campañas y Broadcast

**Ruta:** Sidebar → Campañas
**Roles:** Admin/Supervisor

## 12.1 Crear una campaña

1. Selecciona segmento (o sube CSV)
2. Selecciona template aprobado de WhatsApp
3. Personaliza variables ({{nombre}}, {{empresa}}, etc.)
4. Programa envío (inmediato o futuro)
5. Confirmar → entra a cola con rate limit (80 msg/s)

## 12.2 Métricas de seguimiento

- Total enviados / pendientes / errores
- Tasa de entrega
- Tasa de lectura
- Tasa de respuesta
- Click-through (si hay buttons)

## 12.3 Límites por plan

| Plan | Campañas/mes |
|------|--------------|
| Starter | 3 |
| Pro | Ilimitadas |
| Enterprise | Ilimitadas |

---

# 13. Base de Conocimiento

**Ruta:** Sidebar → Base de Conocimiento
**Roles:** Admin/Supervisor

## 13.1 Tipos de contenido

- **FAQs** — preguntas y respuestas estructuradas
- **Documentos** — PDFs, DOCX, MD
- **URLs** — Parallly hace scraping y vectoriza
- **Texto libre** — políticas, manuales internos

## 13.2 Cómo lo usa el agente IA

RAG con pgvector: cuando el cliente pregunta algo, el agente busca chunks relevantes en tu KB y los inyecta en el prompt antes de responder.

## 13.3 Portal público

`https://admin.parallly-chat.cloud/kb/{tu-slug}` — versión pública de tu KB para clientes (light theme, sin auth). Ideal para enlazar desde tu web.

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

**Roles:** Admin/Supervisor (los Agents ven solo sus propias métricas)

## 15.1 Analytics del negocio

Pestañas:
- Resumen — KPIs principales
- Conversaciones — volumen y resolución
- CSAT — satisfacción del cliente (encuestas post-cierre)
- Embudo, Velocidad, Win/Loss
- Fuentes — origen de leads

## 15.2 Reportes de agentes

Leaderboard con:
- Conversaciones atendidas
- Tiempo de primera respuesta
- Deals cerrados
- Tasa de conversión
- CSAT promedio

## 15.3 Mis métricas (rol Agent)

Cada agente ve solo sus propias métricas en `/admin/agent-analytics`:
- Mis conversaciones hoy / semana / mes
- Mi tiempo de respuesta
- Mis deals
- Mi ranking interno

---

# 16. Inventario y Pedidos

**Ruta:** Sidebar → Inventario / Pedidos
**Roles:** Todos (Admin/Supervisor para gestionar productos)

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

## 17.2 Baja automática

Si un cliente escribe "BAJA" o sinónimos → automáticamente:
- Marca el contacto como `opted_out`
- Detiene cualquier secuencia de nurturing
- No se le pueden enviar más broadcasts
- Queda registrado en audit_log

---

# 18. Configuración General

**Ruta:** Sidebar → Configuración

## 18.1 Cuenta (todos los roles)
- Mi perfil (nombre, foto, idioma de la UI)
- Cambiar contraseña
- Sesiones activas
- Cerrar sesión en todos los dispositivos

## 18.2 Empresa (Admin)
- Datos del negocio (nombre, dirección, teléfono, sitio)
- Logo (usado en emails y portal público)
- Horarios de atención
- Localización (idioma y zona horaria)
- Custom attributes (campos personalizados)

## 18.3 Herramientas (Admin/Supervisor)
- Etapas del Pipeline
- Lead Scoring
- Macros (acciones rápidas con un click)
- Plantillas de email
- Pre-chat (formularios pre-conversación)
- Sistema de Recall (recordatorios automáticos)

## 18.4 IA (Admin)
- Modelo por defecto del tenant
- Configuración global de comportamiento del agente

## 18.5 Avanzado (Admin)
- Compliance (consentimientos, opt-outs, GDPR)
- Webhooks de salida (para integrar con sistemas externos)
- Exportar datos
- API keys del tenant

---

# 19. Gestión de Usuarios

**Ruta:** Sidebar → Usuarios
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

## 20.1 Planes disponibles

| Plan | Precio mensual | Agentes IA | Mensajes IA/mes | Calendarios | Trial |
|------|----------------|-----------|-----------------|-------------|-------|
| **Starter** | USD $39 | 1 | 5.000 | 1 | 7 días |
| **Pro** | USD $129 | 3 | 25.000 | 3 | 15 días |
| **Enterprise** | USD $349 | 10 | 100.000 | 10 | 15 días |
| **Custom** | A medida | Ilimitados | Ilimitados | Ilimitados | — |

## 20.2 Precio en moneda local

El dashboard detecta tu país (campo `billingCountry`) y muestra automáticamente:
- Precio en moneda local si hay override curado (CO/AR/MX/CL/PE/UY/BR principal)
- Precio convertido por tasa FX si no hay override (con leyenda "≈ USD X")
- Precio en USD si no hay datos de FX

Las monedas soportadas para display: COP, ARS, MXN, CLP, PEN, UYU, BRL, USD.

## 20.3 Cambiar plan

1. Configuración → Facturación
2. Click en el plan deseado
3. Si subis (upgrade): se requiere tarjeta — pago inmediato del nuevo plan
4. Si bajas: aplica al final del período actual (no se cobra de nuevo)

> MercadoPago no soporta cambio de plan dinámico — el sistema cancela la suscripción vieja y crea una nueva con el nuevo plan.

## 20.4 Cambiar tarjeta

1. Botón "Cambiar tarjeta"
2. Modal de MercadoPago para tokenizar nueva tarjeta
3. Confirmar — el cobro siguiente se hace con la nueva

## 20.5 Pausar suscripción

**Para tomar un descanso sin cancelar.**

1. Botón "Pausar suscripción"
2. Modal pide motivo (opcional, queda en audit log)
3. Confirmar → el proveedor deja de cobrarte

Mientras está pausada:
- Banner ámbar "Tu suscripción está pausada"
- Solo aparece el botón "Reanudar"
- Los límites del plan siguen aplicando (no son ilimitados durante la pausa)

### Reanudar
Click en "Reanudar" → vuelve a `ACTIVE` (o `TRIALING` si aún quedaba trial). Próximo cobro en la fecha original del ciclo.

## 20.6 Reintentar cobro (recovery de past_due)

Si tu suscripción quedó en estado **"Pago pendiente"** (past_due) por una tarjeta rechazada, hay 2 caminos:

1. **Cambiar la tarjeta** y esperar al próximo intento del cron (cada hora)
2. **"Reintentar cobro ahora"** — botón verde que fuerza una sincronización inmediata con MercadoPago

Si MercadoPago ya reintentó en background y el cobro fue exitoso, este botón actualiza tu estado al toque.

## 20.7 Cancelar suscripción

Dos opciones:

| Opción | Comportamiento |
|--------|----------------|
| **Cancelar al final del período** | Conservas acceso hasta `currentPeriodEnd`. Banner ámbar te avisa la fecha. |
| **Cancelar inmediatamente** | Acceso revocado al instante. Sin reembolso del período actual (a menos que pidas refund por separado). |

## 20.8 Aplicar cupón promocional

Si recibiste un código promocional (campaña, regalo de Parallly, etc.):

1. Configuración → Facturación
2. Sección "Código de cupón"
3. Pegá el código (se normaliza a mayúsculas automáticamente)
4. Click "Aplicar"

3 tipos de cupones:
- **% de descuento** durante N ciclos de cobro
- **Monto fijo** descontado durante N ciclos
- **Meses gratis** — extiende tu trial sin cobrar

Errores posibles al aplicar:
- "Cupón no existe"
- "Vencido"
- "Llegó al máximo de canjes"
- "No aplica a tu plan actual"
- "Ya usaste este cupón antes"

## 20.9 Historial de pagos

Tabla con últimos 20 pagos:
- Fecha
- Monto (en moneda original del cobro)
- Estado (Exitoso / Fallido / Reembolsado / Pendiente)
- Factura PDF (cuando esté disponible)

## 20.10 Trial — recordatorios

3 días antes de que termine tu trial, recibís email automático: "Tu prueba termina pronto — agregá una tarjeta para seguir".

Si el trial vence sin tarjeta:
- Suscripción pasa a `expired`
- Acceso a la plataforma revocado (banner de "Suscripción vencida" al hacer login)
- Datos preservados — se reactivan al pagar

## 20.11 Pasos post-pago fallido

Cuando un cobro falla, MercadoPago reintenta automáticamente con su lógica de retries. Mientras tanto:
1. Tu suscripción queda en `past_due`
2. Email automático "Pago fallido" con instrucciones
3. Banner en dashboard
4. Después de 7 días sin recuperar → suspensión automática del tenant

---

# 21. Adaptación por Industria — Verticales

Parallly opera 16 industrias verticales. Cada una activa funcionalidades específicas durante el onboarding.

## 21.1 Turismo — Tours, Paquetes y Alquiler Vacacional

**Para quién:** agencias de viajes, operadores de tours, hoteles con experiencias, alquiler vacacional (Airbnb-style).

**Sub-tipos:**
- `tours` — agencias de día / multi-día
- `agencia_viajes` — operador full
- `alquiler_vacacional` — propiedades estilo Airbnb

### 21.1.1 Tours y Paquetes

**Ruta:** Sidebar → Tours

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

**Ruta:** Sidebar → Propiedades

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

**Límites por plan:**

| Plan | Propiedades |
|------|-------------|
| Starter | 1 |
| Pro | 3 |
| Enterprise | 10 |
| Custom | 999 |

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
**Ruta:** Sidebar → Planes de Tratamiento

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

**Ruta:** Sidebar → Mascotas

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

**Ruta:** Sidebar → Menú

**Crear categoría:**
1. Menú → "Categoría" → nombre, orden visual

**Crear plato:**
1. "Crear plato" → categoría, nombre, descripción, precio
2. Foto (opcional)
3. Tags: vegetariano, vegano, sin gluten, picante, popular
4. Disponibilidad por horario
5. Ingredientes / opcionales con precio extra

### 21.5.2 Pedidos de comida (Kanban tipo cocina)

**Ruta:** Sidebar → Pedidos

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

**Ruta:** Sidebar → Membresías

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

**Ruta:** Sidebar → Clases

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

**Ruta:** Sidebar → Cursos

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

**Ruta:** Sidebar → Seguros → Planes

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

**Ruta:** Sidebar → Seguros → Reclamos

Cliente reporta siniestro:
1. Datos del incidente (fecha, lugar, descripción)
2. Fotos / documentos
3. Estado: recibido → en revisión → aprobado / rechazado → pagado
4. Tracking del cliente: "¿Cómo va mi reclamo del 5 de mayo?"

## 21.9 Servicios del hogar — Despacho de técnicos

**Sub-tipos:** `plomeria`, `electricidad`, `fumigacion`, `limpieza`, `jardineria`, `aire_acondicionado`, `general`

### 21.9.1 Solicitudes de servicio

**Ruta:** Sidebar → Solicitudes

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

**Ruta:** Sidebar → Sesiones fotográficas

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
| Canal | WhatsApp / Email |
| Mensaje | Template con `{name}` y `{months}` |

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

Cada sección de la plataforma tiene un botón **"?"** que despliega ayuda específica.

## 23.1 Qué muestra

- Descripción de la sección
- Video tutorial (cuando esté disponible — embebido de YouTube)
- Imágenes de referencia
- Tips prácticos

## 23.2 Dónde aparece

15 secciones principales: Conversaciones, CRM, Embudo, Agenda, Propiedades, Campañas, Automatización, Agente IA, Conocimiento, Analíticas, Canales, Usuarios, Configuración, Plantillas, Plan.

## 23.3 Cómo usar

1. Botón **"?"** esquina superior derecha
2. Click → expande panel con la información
3. Click otra vez → colapsa para recuperar espacio

> Si aún no hay video para tu sección, la ayuda textual y los tips siguen disponibles. Los videos se irán agregando gradualmente.

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

# 26. Preguntas Frecuentes

## General

**¿Cuánto cuesta Parallly?**
Desde USD $39/mes (Starter). Ver tabla completa en sección 20.1.

**¿Puedo probar antes de pagar?**
Sí: 7 días en Starter, 15 días en Pro y Enterprise. Sin tarjeta para Starter.

**¿En qué países funciona?**
Toda Latinoamérica. Soporte de moneda local: COP, ARS, MXN, CLP, PEN, UYU, BRL, USD.

**¿Cómo cambio de plan?**
Configuración → Facturación → click en el plan deseado. Si bajás aplica al final del período actual.

**¿Puedo pausar mi suscripción?**
Sí — botón "Pausar" en Facturación. No se cobra mientras esté pausada y los datos se preservan.

## Agente IA

**¿El agente puede operar 24/7?**
Sí. Configurable desde el editor: siempre activo, solo en horario, o híbrido.

**¿Puedo hacer que el agente entregue a humano en ciertos casos?**
Sí — palabras clave de handoff (ej: "hablar con persona") + reglas de baja confianza disparan entrega automática.

**¿Cómo entrena al agente con mi negocio?**
Carga FAQs, documentos y URLs en Base de Conocimiento. El agente busca con RAG cuando necesita info.

**¿Puedo tener varios agentes diferentes?**
Sí — uno por canal según tu plan. Por ejemplo: Sofía formal en email, Sofía amigable en Instagram.

## Canales

**¿Necesito aprobar templates de WhatsApp?**
Solo para mensajes salientes fuera de la ventana de 24h. Para conversaciones que el cliente inició, no.

**¿Funciona Instagram personal?**
No — solo Instagram Business. Es un requisito de Meta, no de Parallly.

**¿Cuántos canales puedo conectar?**
Sin límite por número de canales — el límite real es por agentes IA (1 agente = 1 canal).

## Citas

**¿Sincroniza con mi Google Calendar?**
Sí — OAuth desde Configuración → Agenda. Multi-calendar plan-gated.

**¿Qué pasa si dos personas reservan el mismo slot?**
Anti-doble-booking automático: el sistema verifica disponibilidad en el momento de confirmar y rechaza el segundo intento.

**¿Genera link de Meet o Teams?**
Sí — automáticamente para servicios con tipo `online` o `hibrido`.

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
