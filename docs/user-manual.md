# Parallly — Manual de Usuario

<p align="center">
  <img src="../docs/images/parallly-logo.png" alt="Parallly Logo" width="200" />
</p>

<p align="center">
  <strong>Plataforma de IA Conversacional Omnicanal</strong><br/>
  Guía completa para configurar y usar Parallly
</p>

<p align="center">
  Versión 1.0 — Abril 2026
</p>

---

## Índice General

| # | Sección | Página |
|---|---------|--------|
| 1 | [Introducción](#1-introducción) | |
| 2 | [Primeros Pasos](#2-primeros-pasos) | |
| 2.1 | [Crear una cuenta](#21-crear-una-cuenta) | |
| 2.2 | [Asistente de Onboarding](#22-asistente-de-onboarding) | |
| 2.3 | [Iniciar sesión](#23-iniciar-sesión) | |
| 2.4 | [Recuperar contraseña](#24-recuperar-contraseña) | |
| 3 | [Dashboard](#3-dashboard) | |
| 4 | [Inbox — Bandeja de Entrada](#4-inbox--bandeja-de-entrada) | |
| 4.1 | [Vista general](#41-vista-general) | |
| 4.2 | [Filtros](#42-filtros) | |
| 4.3 | [Acciones de conversación](#43-acciones-de-conversación) | |
| 4.4 | [Panel del contacto](#44-panel-del-contacto) | |
| 5 | [CRM — Gestión de Contactos](#5-crm--gestión-de-contactos) | |
| 5.1 | [Contactos](#51-contactos) | |
| 5.2 | [Pipeline (Kanban)](#52-pipeline-kanban) | |
| 5.3 | [Segmentos](#53-segmentos) | |
| 6 | [Agentes IA](#6-agentes-ia) | |
| 6.1 | [Lista de agentes](#61-lista-de-agentes) | |
| 6.2 | [Editor del agente](#62-editor-del-agente) | |
| 6.3 | [Plantillas](#63-plantillas) | |
| 6.4 | [Test del agente](#64-test-del-agente) | |
| 7 | [Canales de Comunicación](#7-canales-de-comunicación) | |
| 7.1 | [WhatsApp](#71-whatsapp) | |
| 7.2 | [Instagram](#72-instagram) | |
| 7.3 | [Messenger](#73-messenger) | |
| 7.4 | [Telegram](#74-telegram) | |
| 7.5 | [SMS (Twilio)](#75-sms-twilio) | |
| 7.6 | [Desconectar un canal](#76-desconectar-un-canal) | |
| 8 | [Citas y Agenda](#8-citas-y-agenda) | |
| 8.1 | [Calendario](#81-calendario) | |
| 8.2 | [Servicios](#82-servicios) | |
| 8.3 | [Disponibilidad](#83-disponibilidad) | |
| 8.4 | [Calendarios conectados](#84-calendarios-conectados) | |
| 8.5 | [Reserva por IA](#85-cómo-funciona-la-reserva-por-ia) | |
| 9 | [Automatización](#9-automatización) | |
| 10 | [Campañas y Broadcast](#10-campañas-y-broadcast) | |
| 11 | [Base de Conocimiento](#11-base-de-conocimiento) | |
| 12 | [Analytics y Reportes](#12-analytics-y-reportes) | |
| 13 | [Inventario y Pedidos](#13-inventario-y-pedidos) | |
| 14 | [Compliance y Privacidad](#14-compliance-y-privacidad) | |
| 15 | [Configuración](#15-configuración) | |
| 16 | [Gestión de Usuarios](#16-gestión-de-usuarios) | |
| 17 | [Facturación y Planes](#17-facturación-y-planes) | |
| 18 | [Preguntas Frecuentes (FAQ)](#18-preguntas-frecuentes) | |

---

# 1. Introducción

Parallly es una plataforma SaaS que permite a negocios automatizar y centralizar conversaciones de ventas, soporte y atención al cliente a través de WhatsApp, Instagram, Messenger, Telegram y SMS — todo con agentes de inteligencia artificial.

### ¿Para quién es Parallly?

- Negocios que reciben consultas por redes sociales o WhatsApp
- Empresas que quieren automatizar la atención al cliente
- Equipos de ventas que necesitan un CRM integrado con canales de mensajería
- Profesionales que agendan citas (consultorios, asesorías, salones)

### ¿Qué puedes hacer con Parallly?

- Conectar canales de mensajería en minutos
- Configurar agentes IA que atienden como humanos
- Agendar citas automáticamente con sincronización de calendario
- Gestionar contactos, leads y pipeline de ventas
- Crear reglas de automatización
- Enviar campañas masivas
- Analizar métricas de rendimiento

<!-- TODO: Imagen del dashboard general -->
![Dashboard de Parallly](images/placeholder-dashboard.png)
*Vista general del dashboard de Parallly*

---

# 2. Primeros Pasos

## 2.1 Crear una cuenta

1. Ir a [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud)
2. Clic en **Registrarse**
3. Ingresar email y contraseña
4. Verificar el email con el código de 6 dígitos que recibirás
5. Completar el asistente de onboarding (sección 2.2)

<!-- TODO: Screenshot del formulario de registro -->
![Registro](images/placeholder-signup.png)
*Formulario de registro*

> **Tip:** También puedes registrarte con tu cuenta de Google haciendo clic en "Continuar con Google".

---

## 2.2 Asistente de Onboarding

Al crear tu cuenta, un asistente de 5 pasos te guía para configurar tu negocio:

### Paso 1 — Perfil de empresa

<!-- TODO: Screenshot del paso 1 del onboarding -->
![Onboarding Paso 1](images/placeholder-onboarding-step1.png)
*Configuración del perfil de empresa*

| Campo | Descripción | Obligatorio |
|-------|-------------|:-----------:|
| Nombre de la empresa | El nombre de tu negocio | ✅ |
| Sitio web | URL de tu página web | No |
| Teléfono | Número de contacto del negocio | No |
| Email | Email de contacto comercial | No |
| Descripción | Qué hace tu negocio (usado por el agente IA) | No |
| Redes sociales | Instagram, Facebook, LinkedIn, TikTok | No |
| Industria | Sector de tu negocio | ✅ |
| Tamaño | Cantidad de empleados | No |
| Zona horaria | Tu zona horaria local | ✅ |

### Paso 2 — Audiencia
Selecciona tu público objetivo: B2C, B2B, Gobierno u Otro.

### Paso 3 — Objetivos
¿Para qué usarás Parallly? FAQ, Citas, Ventas, Soporte, Promociones, etc.

### Paso 4 — Referencia
¿Cómo conociste Parallly?

### Paso 5 — Plan y pago
Selecciona tu plan (Starter gratuito, Pro o Enterprise) y agrega método de pago si es necesario.

---

## 2.3 Iniciar sesión

<!-- TODO: Screenshot del login -->
![Login](images/placeholder-login.png)
*Pantalla de inicio de sesión*

| Método | Descripción |
|--------|-------------|
| Email + contraseña | Ingresa tus credenciales |
| Google OAuth | Clic en "Continuar con Google" |
| Recordarme | Mantiene la sesión por 14 días (sin esto, expira en 8 horas) |

> **Importante:** Después de 60 minutos sin actividad, aparece un modal de advertencia con cuenta regresiva de 2 minutos. Si no respondes, la sesión se cierra automáticamente.

---

## 2.4 Recuperar contraseña

1. En la pantalla de login, clic en **¿Olvidaste tu contraseña?**
2. Ingresa tu email registrado
3. Recibirás un código OTP por email
4. Ingresa el código y establece una nueva contraseña

---

# 3. Dashboard

**Ruta:** Menú → Dashboard

El dashboard es tu vista general del negocio al iniciar sesión.

<!-- TODO: Screenshot del dashboard -->
![Dashboard](images/placeholder-dashboard-full.png)
*Dashboard con KPIs y actividad reciente*

### Métricas principales

| Métrica | Descripción |
|---------|-------------|
| Leads hoy | Nuevos leads capturados en el día |
| Leads calientes | Leads con score alto listos para cerrar |
| Mensajes procesados | Total de mensajes IA enviados/recibidos hoy |
| Costo IA | Costo de los modelos de lenguaje usados hoy |

### Actividad reciente
Lista de las últimas interacciones: conversaciones nuevas, handoffs a humanos, y pedidos recibidos.

### Uso de modelos
Distribución de qué modelos IA se están usando con porcentajes y ahorro del router inteligente.

---

# 4. Inbox — Bandeja de Entrada

**Ruta:** Menú → Inbox

El inbox es tu centro de operaciones para conversaciones en tiempo real con clientes.

## 4.1 Vista general

<!-- TODO: Screenshot del inbox completo -->
![Inbox](images/placeholder-inbox.png)
*Bandeja de entrada con conversación activa*

La bandeja tiene 3 paneles:

| Panel | Contenido |
|-------|-----------|
| **Izquierda** | Lista de conversaciones con filtros y búsqueda |
| **Centro** | Chat activo con historial de mensajes |
| **Derecha** | Información del contacto, notas, tags |

---

## 4.2 Filtros

| Filtro | Muestra |
|--------|---------|
| Todos | Todas las conversaciones activas |
| Míos | Solo conversaciones asignadas a ti |
| Sin asignar | Conversaciones sin agente humano asignado |
| Handoff | Conversaciones escaladas que esperan atención humana |

También puedes buscar conversaciones por nombre del contacto o contenido del mensaje.

---

## 4.3 Acciones de conversación

<!-- TODO: Screenshot de la barra de acciones -->
![Acciones del inbox](images/placeholder-inbox-actions.png)
*Barra de acciones en la conversación*

| Acción | Icono | Descripción |
|--------|-------|-------------|
| **Responder** | 💬 | Envía un mensaje como agente humano |
| **Asignar** | 👤 | Asigna la conversación a un agente específico |
| **Resolver** | ✅ | Devuelve la conversación al agente IA |
| **Posponer** | ⏰ | Pausa por 1h, 3h, mañana, o lunes |
| **Macros** | ⚡ | Inserta respuestas predefinidas |
| **Archivar** | 📦 | Mueve al archivo (ya no aparece en inbox) |
| **Eliminar** | 🗑️ | Elimina permanentemente la conversación y mensajes |
| **Notas** | 📝 | Agrega notas internas (invisibles para el cliente) |

> **Atención:** La acción **Eliminar** es irreversible. Se eliminan todos los mensajes y la conversación permanentemente.

---

## 4.4 Panel del contacto

Al seleccionar una conversación, el panel derecho muestra:

- **Nombre** del contacto
- **Teléfono** y **email**
- **Canal** de comunicación (WhatsApp, Instagram, etc.)
- **Etapa** en el pipeline de ventas
- **Tags** asignados
- **Score** del contacto
- **Historial** de interacciones previas

---

# 5. CRM — Gestión de Contactos

## 5.1 Contactos

**Ruta:** Menú → CRM

<!-- TODO: Screenshot de la lista de contactos -->
![Contactos](images/placeholder-contacts.png)
*Lista de contactos con filtros*

### Ver contactos

La lista muestra todos tus clientes y leads con:
- Nombre y datos de contacto
- Etapa actual (Nuevo, Contactado, Respondió, Calificado, etc.)
- Tags asignados
- Fecha de última interacción
- Score de lead

### Acciones

| Acción | Descripción |
|--------|-------------|
| Buscar | Por nombre, email o teléfono |
| Filtrar | Por segmento, etapa, tag |
| Importar | Subir archivo CSV con contactos |
| Exportar | Descargar todos los contactos como CSV |
| Crear | Agregar contacto manualmente |

### Detalle del contacto

Al hacer clic en un contacto, ves su ficha completa:
- Información básica
- Historial de conversaciones
- Pipeline y etapa actual
- Notas internas del equipo
- Atributos personalizados

---

## 5.2 Pipeline (Kanban)

**Ruta:** Menú → Pipeline

<!-- TODO: Screenshot del pipeline Kanban -->
![Pipeline](images/placeholder-pipeline.png)
*Vista Kanban del pipeline de ventas*

Vista tipo tablero con columnas por etapa:

```
Nuevo → Contactado → Respondió → Calificado → Tibio → Caliente → Listo para cierre → Ganado / Perdido
```

- **Arrastra** tarjetas entre columnas para cambiar etapas
- Cada tarjeta muestra: nombre, valor del deal, días en la etapa
- **Métricas superiores:** valor total, pronóstico ponderado, cantidad de deals

---

## 5.3 Segmentos

**Ruta:** CRM → Segmentos

Crea filtros guardados para agrupar contactos automáticamente:

| Criterio | Ejemplo |
|----------|---------|
| Por etapa | Todos los "Calificados" |
| Por tag | Contactos con tag "VIP" |
| Por score | Score mayor a 50 |
| Por canal | Solo contactos de WhatsApp |
| Por fecha | Interacción en los últimos 7 días |

---

# 6. Agentes IA

## 6.1 Lista de agentes

**Ruta:** Menú → Agente IA

<!-- TODO: Screenshot de la lista de agentes -->
![Agentes](images/placeholder-agents.png)
*Lista de agentes IA configurados*

Cada tarjeta de agente muestra:
- Nombre y estado (activo/inactivo)
- Canales asignados (iconos)
- Cantidad de reglas y herramientas
- Badge de "Agente por defecto"

### Acciones

| Acción | Descripción |
|--------|-------------|
| Crear | Nuevo agente desde plantilla o en blanco |
| Editar | Abrir el editor de configuración |
| Clonar | Duplicar un agente existente |
| Eliminar | Borrar permanentemente |
| Predeterminado | Establecer como agente principal |

### Límites por plan

| Plan | Agentes IA |
|------|:----------:|
| Starter | 1 |
| Pro | 3 |
| Enterprise | 10 |

---

## 6.2 Editor del agente

**Ruta:** Agente IA → clic en un agente

<!-- TODO: Screenshot del editor de agente -->
![Editor de agente](images/placeholder-agent-editor.png)
*Editor de configuración del agente*

El editor tiene secciones tipo tarjeta:

### Identidad
- Nombre del agente (ej: "Andrea", "Carlos")
- Rol (ej: "Asesor de Ventas", "Soporte técnico")
- Saludo inicial
- Mensaje de despedida/fallback

### Personalidad
- Tono: formal, casual, amigable
- Uso de emojis: nunca, moderado, frecuente
- Humor: serio, ligero

### Modelo IA
- Selección del modelo principal
- Temperatura (creatividad: 0.0 - 1.0)
- Tokens máximos

### Comportamiento
- Reglas personalizadas (ej: "Nunca inventar precios")
- Temas prohibidos
- Triggers de handoff (cuándo escalar a humano)

### Asignación de canales
Cada canal se asigna a UN solo agente:
- WhatsApp → Agente A
- Instagram → Agente B
- etc.

### Herramientas
Activa funciones del agente:
- ✅ Citas (agendar, cancelar, consultar disponibilidad)
- ✅ Catálogo (buscar productos, precios)
- ✅ FAQs (buscar respuestas en la base de conocimiento)
- ✅ Políticas (consultar políticas del negocio)

---

## 6.3 Plantillas

6 plantillas predefinidas para empezar rápido:

| Plantilla | Ideal para |
|-----------|-----------|
| 🛒 Asesor de Ventas | Negocios que venden productos/servicios |
| 🎧 Agente de Soporte | Atención al cliente y resolución de problemas |
| ❓ Bot FAQ | Respuestas rápidas a preguntas frecuentes |
| 📅 Agendador de Citas | Consultorios, salones, asesorías |
| 🎯 Calificador de Leads | Clasificar leads por nivel de interés |
| ⬜ En Blanco | Configuración desde cero |

---

## 6.4 Test del agente

**Ruta:** Agente → botón Test

<!-- TODO: Screenshot del playground de test -->
![Test del agente](images/placeholder-agent-test.png)
*Playground para probar el agente en vivo*

Prueba tu agente sin afectar conversaciones reales:
- Envía mensajes y ve la respuesta del agente
- Panel de debug con 5 pestañas:
  - **System Prompt**: el prompt completo que recibe el LLM
  - **Tools**: herramientas llamadas y sus resultados
  - **RAG**: artículos de conocimiento recuperados
  - **Metrics**: tokens, costo, latencia, modelo usado
  - **Turn Context**: contexto XML del turno

---

# 7. Canales de Comunicación

**Ruta:** Menú → Canales

<!-- TODO: Screenshot de la vista general de canales -->
![Canales](images/placeholder-channels.png)
*Vista general de canales con estado de conexión*

---

## 7.1 WhatsApp

### Conectar

1. Ir a **Canales → WhatsApp**
2. Clic en **Conectar con WhatsApp**
3. Se abre el Embedded Signup de Meta
4. Autoriza tu cuenta de WhatsApp Business
5. Selecciona tu número de teléfono
6. ✅ Canal conectado automáticamente

<!-- TODO: Screenshot del proceso de conexión WhatsApp -->
![WhatsApp Setup](images/placeholder-whatsapp-setup.png)
*Proceso de conexión de WhatsApp*

### Funciones disponibles
- Envío y recepción de mensajes de texto, imágenes, documentos
- Plantillas de mensaje (Templates) para mensajes proactivos
- Indicador de escritura (typing)
- Confirmaciones de entrega y lectura

### Templates de WhatsApp

**Ruta:** Canales → WhatsApp → Templates

Crea y gestiona plantillas aprobadas por Meta para mensajes proactivos:
- Nombre del template
- Cuerpo con variables (`{{1}}`, `{{2}}`)
- Header opcional (texto o imagen)
- Footer y botones (URL, teléfono, respuesta rápida)

> **Nota:** Los templates requieren aprobación de Meta antes de poder usarse.

---

## 7.2 Instagram

### Conectar

1. Ir a **Canales → Instagram**
2. Clic en **Conectar con Instagram**
3. Se abre un popup para autorizar tu cuenta Business
4. Concede los permisos solicitados
5. ✅ Cuenta conectada automáticamente

<!-- TODO: Screenshot del proceso de conexión Instagram -->
![Instagram Setup](images/placeholder-instagram-setup.png)
*Proceso de conexión de Instagram*

> **Requisitos:**
> - Cuenta Instagram Business (no personal)
> - Permisos: `instagram_business_basic`, `instagram_business_manage_messages`

### Renovación del token
- El token se renueva automáticamente cada 30 días
- Si expira, verás un banner ámbar pidiendo reconectar
- Indicador visual muestra los días restantes del token

---

## 7.3 Messenger

### Conectar

1. Ir a **Canales → Messenger**
2. Clic en **Conectar con Facebook**
3. Inicia sesión con tu cuenta de Facebook
4. Autoriza los permisos de páginas
5. ✅ Parallly conecta automáticamente tus páginas con permiso de mensajería

<!-- TODO: Screenshot del proceso de conexión Messenger -->
![Messenger Setup](images/placeholder-messenger-setup.png)
*Proceso de conexión de Messenger*

---

## 7.4 Telegram

### Conectar

1. Abre Telegram y busca **@BotFather**
2. Envía `/newbot` y sigue las instrucciones para crear un bot
3. Copia el **token** del bot
4. En Parallly: **Canales → Telegram**
5. Pega el token y nombre del bot
6. Clic en **Conectar**

<!-- TODO: Screenshot del formulario de Telegram -->
![Telegram Setup](images/placeholder-telegram-setup.png)
*Formulario de conexión de Telegram*

---

## 7.5 SMS (Twilio)

### Conectar

1. Crea una cuenta en [twilio.com](https://www.twilio.com)
2. Obtén tu **Account SID** y **Auth Token**
3. Compra un número de teléfono en Twilio
4. En Parallly: **Canales → SMS**
5. Ingresa las credenciales y el número
6. Clic en **Conectar**

---

## 7.6 Desconectar un canal

En cada página de canal conectado:

1. Scroll hasta la sección **Desconectar**
2. Clic en el botón rojo **Desconectar**
3. Confirma la acción en el diálogo
4. ✅ El canal se desactiva inmediatamente

> **Nota:** Al desconectar, las conversaciones existentes permanecen en el inbox. Solo se dejan de recibir mensajes nuevos por ese canal.

---

# 8. Citas y Agenda

**Ruta:** Menú → Citas

<!-- TODO: Screenshot del calendario de citas -->
![Calendario](images/placeholder-appointments.png)
*Vista del calendario con citas agendadas*

## 8.1 Calendario

Vista semanal con todas las citas agendadas:
- Cada cita muestra servicio (color codificado), nombre del cliente, y hora
- Clic en un espacio vacío para crear una cita manual
- Clic en una cita existente para editar o cancelar

---

## 8.2 Servicios

**Ruta:** Citas → pestaña Servicios

<!-- TODO: Screenshot de la lista de servicios -->
![Servicios](images/placeholder-services.png)
*Gestión de servicios*

Configura los servicios que ofreces:

| Campo | Descripción |
|-------|-------------|
| Nombre | Nombre del servicio |
| Duración | Tiempo en minutos (15 min - 4 horas) |
| Precio | Costo del servicio |
| Buffer | Tiempo de descanso entre citas |
| Color | Color para identificar en el calendario |
| Modalidad | **Presencial**, **Online** o **Híbrido** |
| Dirección | Para servicios presenciales |
| Enlace de reunión | Para online (o se genera automáticamente con Meet/Teams) |

> **Tip:** Si dejas el enlace de reunión vacío y tienes Google Calendar o Microsoft Calendar conectado, Parallly genera automáticamente un enlace de Google Meet o Microsoft Teams.

---

## 8.3 Disponibilidad

**Ruta:** Citas → pestaña Configuración

<!-- TODO: Screenshot de la configuración de disponibilidad -->
![Disponibilidad](images/placeholder-availability.png)
*Configuración de horarios de disponibilidad*

### Horario semanal
- Activa/desactiva cada día de la semana con un toggle
- Establece hora de apertura y cierre por día
- Toggle **24/7** para disponibilidad completa

### Fechas bloqueadas
Agrega fechas donde no se aceptan citas:
- Festivos
- Vacaciones
- Eventos especiales

---

## 8.4 Calendarios conectados

Sincroniza con Google Calendar o Microsoft Outlook:

1. En la pestaña Configuración, busca la sección **Calendarios**
2. Clic en **Conectar Google** o **Conectar Microsoft**
3. Autoriza el acceso OAuth
4. Selecciona la asignación:
   - **General**: disponibilidad de todo el negocio
   - **Miembro del equipo**: agenda personal
   - **Servicio**: solo para ese servicio específico

### Límites por plan

| Plan | Calendarios |
|------|:-----------:|
| Starter | 1 |
| Pro | 3 |
| Enterprise | 10 |

> **Protección:** No puedes desconectar un calendario si tiene citas futuras asignadas. Primero cancela o reasigna las citas.

---

## 8.5 Cómo funciona la reserva por IA

<!-- TODO: Screenshot de una conversación de booking por WhatsApp -->
![Booking por IA](images/placeholder-booking-flow.png)
*Ejemplo de reserva de cita por WhatsApp*

Cuando un cliente escribe por WhatsApp pidiendo una cita, el agente IA maneja todo el flujo:

```
1. Cliente: "Hola, quiero agendar una cita"
2. Agente: Muestra servicios disponibles
3. Cliente: Elige un servicio
4. Agente: Pregunta la fecha
5. Cliente: "Mañana"
6. Agente: Muestra horarios disponibles (cruzando con calendario)
7. Cliente: Elige un horario
8. Agente: Pide nombre y email
9. Cliente: Confirma
10. ✅ Cita creada en Google Calendar + confirmación por WhatsApp
```

### Qué pasa al confirmar:
- Se crea un evento en el calendario conectado
- El cliente recibe una invitación por email
- Se envía confirmación por WhatsApp con los detalles
- Si el servicio es **Online**, se incluye el enlace de Meet/Teams
- El dashboard se actualiza en tiempo real

---

# 9. Automatización

**Ruta:** Menú → Automatización

<!-- TODO: Screenshot del wizard de automatización -->
![Automatización](images/placeholder-automation.png)
*Wizard de 4 pasos para crear reglas*

### Crear una regla (4 pasos)

#### Paso 1 — Trigger (¿Cuándo se activa?)

| Trigger | Descripción |
|---------|-------------|
| Lead capturado | Un nuevo lead entra al sistema |
| Mensaje recibido | El cliente envía un mensaje |
| Conversación asignada | Un agente toma la conversación |
| SLA vencido | El tiempo de respuesta se superó |
| Inactividad | El cliente no responde en X tiempo |
| Etapa cambiada | El lead avanza o retrocede en el pipeline |

#### Paso 2 — Condiciones (¿Bajo qué circunstancias?)

| Condición | Ejemplo |
|-----------|---------|
| Canal | = WhatsApp |
| Etapa | = Calificado |
| Score | > 50 |
| Tag | contiene "VIP" |
| Fuente | = campaña X |

#### Paso 3 — Acciones (¿Qué hacer?)

| Acción | Descripción |
|--------|-------------|
| Enviar template | Enviar un mensaje predefinido |
| Crear tarea | Asignar una tarea a un agente |
| Cambiar etapa | Mover el lead en el pipeline |
| Agregar tag | Etiquetar el contacto |
| Asignar agente | Asignar a un agente específico |
| Enviar notificación | Notificar al equipo |
| Webhook | Llamar un servicio externo |

> Cada acción puede tener un **delay** (retraso): inmediato, minutos, horas, o días.

#### Paso 4 — Guardar
Revisa el resumen y activa la regla con el toggle.

---

# 10. Campañas y Broadcast

**Ruta:** Menú → Campañas

<!-- TODO: Screenshot de campañas -->
![Campañas](images/placeholder-broadcast.png)
*Lista de campañas con métricas*

### Crear una campaña

1. Clic en **Nueva campaña**
2. Nombre de la campaña
3. Canal (WhatsApp, Instagram, SMS)
4. Template de mensaje
5. Audiencia (todos, segmento, lista personalizada)
6. Programar envío (ahora o fecha/hora futura)
7. **Enviar**

### Métricas de seguimiento

| Métrica | Descripción |
|---------|-------------|
| Enviados | Total de mensajes enviados |
| Entregados | Llegaron al dispositivo |
| Leídos | El cliente los abrió |
| Fallidos | No se pudieron entregar |
| Respuestas | Clientes que respondieron |

---

# 11. Base de Conocimiento

**Ruta:** Menú → Base de Conocimiento

<!-- TODO: Screenshot de la base de conocimiento -->
![Knowledge Base](images/placeholder-knowledge.png)
*Biblioteca de artículos y documentos*

### Tipos de contenido

| Tipo | Cómo agregar |
|------|-------------|
| **Manual** | Escribe el contenido directamente |
| **PDF** | Sube un archivo PDF |
| **URL** | Ingresa una URL para extraer contenido |
| **FAQ** | Pares de pregunta-respuesta |
| **Política** | Devoluciones, envío, garantía, etc. |

### Cómo lo usa el agente IA

Cuando un cliente hace una pregunta, el agente IA busca en tu base de conocimiento y responde con información verificada, citando la fuente: `[FAQ #3]`, `[Artículo: Horarios]`, `[Política: Devoluciones]`.

### Portal público

Tu base de conocimiento tiene un portal público accesible en:
```
admin.parallly-chat.cloud/kb/tu-empresa
```
Los clientes pueden buscar artículos sin contactar al agente.

---

# 12. Analytics y Reportes

## 12.1 Analytics del negocio

**Ruta:** Menú → Analytics

<!-- TODO: Screenshot de analytics -->
![Analytics](images/placeholder-analytics.png)
*Panel de analytics con métricas del negocio*

- Leads en el funnel de ventas
- Tasa de conversión
- Performance de campañas
- Distribución por fuente

## 12.2 Reportes de agentes

**Ruta:** Menú → Reportes

4 pestañas de reportes:

| Pestaña | Contenido |
|---------|-----------|
| **Resumen** | Conversaciones totales, tiempo de respuesta, tasa de handoff, CSAT |
| **Agentes** | Rendimiento individual (mensajes, tiempo, satisfacción) |
| **Canales** | Comparación WhatsApp vs Instagram vs otros |
| **CSAT** | Encuestas de satisfacción del cliente (1-5 estrellas) |

---

# 13. Inventario y Pedidos

## 13.1 Inventario

**Ruta:** Menú → Inventario

<!-- TODO: Screenshot del inventario -->
![Inventario](images/placeholder-inventory.png)
*Gestión de inventario con categorías*

- Crear productos con nombre, SKU, precio, stock
- Categorías con colores
- Alertas de stock bajo
- Historial de movimientos (entradas, salidas, ajustes)
- Importar/exportar productos (CSV)

## 13.2 Pedidos

**Ruta:** Menú → Pedidos

- Crear pedido con líneas de productos
- Estados: Pendiente → Confirmado → Pagado → Completado
- Historial de pagos
- Envío de confirmación por WhatsApp/email

---

# 14. Compliance y Privacidad

**Ruta:** Menú → Compliance

<!-- TODO: Screenshot de compliance -->
![Compliance](images/placeholder-compliance.png)
*Gestión de compliance y privacidad*

| Sección | Descripción |
|---------|-------------|
| **Textos legales** | Gestiona términos, política de privacidad, consentimiento |
| **Consentimientos** | Registro de consentimientos otorgados por clientes |
| **Opt-out** | Lista de clientes que pidieron no recibir más mensajes |
| **Eliminación** | Solicitudes de eliminación de datos (GDPR/Habeas Data) |

### Opt-out automático
Parallly detecta automáticamente cuando un cliente escribe keywords como "no quiero", "cancelar", "basta" y lo agrega a la lista de opt-out. Los mensajes proactivos (broadcasts, automaciones) se bloquean, pero las respuestas a mensajes del cliente siguen funcionando.

---

# 15. Configuración

**Ruta:** Menú → Configuración

<!-- TODO: Screenshot del hub de configuración -->
![Configuración](images/placeholder-settings.png)
*Hub de configuración con todas las opciones*

| Sección | Qué configura |
|---------|---------------|
| **Perfil** | Tu nombre, email, foto |
| **Seguridad** | Contraseña, 2FA, sesiones |
| **Notificaciones** | Qué alertas recibes y cómo |
| **Empresa** | Logo, colores, información del negocio |
| **Horario** | Horas de atención del negocio |
| **Atributos** | Campos personalizados para contactos |
| **Macros** | Respuestas predefinidas para el inbox |
| **Pre-chat** | Formulario antes de iniciar conversación |
| **Medios** | Biblioteca de imágenes y archivos |
| **Email Templates** | Plantillas de correo electrónico |
| **Alertas** | Reglas de alerta y webhooks |
| **Facturación** | Plan, pagos, método de pago |

---

# 16. Gestión de Usuarios

**Ruta:** Menú → Usuarios

<!-- TODO: Screenshot de gestión de usuarios -->
![Usuarios](images/placeholder-users.png)
*Gestión del equipo*

### Roles disponibles

| Rol | Acceso |
|-----|--------|
| **Admin** | Configuración completa, todos los módulos |
| **Agente** | Inbox, conversaciones, CRM básico |
| **Viewer** | Solo lectura (ver sin modificar) |

### Crear usuario

1. Clic en **Nuevo usuario**
2. Ingresa nombre, email, contraseña temporal
3. Selecciona el rol
4. El usuario recibe un email de invitación

### Gestionar usuarios
- Editar datos y cambiar rol
- Resetear contraseña
- Desactivar/activar usuario

---

# 17. Facturación y Planes

**Ruta:** Configuración → Facturación

<!-- TODO: Screenshot de la página de facturación -->
![Facturación](images/placeholder-billing.png)
*Plan actual y opciones de facturación*

### Comparación de planes

| Feature | Starter | Pro | Enterprise |
|---------|:-------:|:---:|:----------:|
| Precio | Gratis | $129/mes | $349/mes |
| Agentes IA | 1 | 3 | 10 |
| Calendarios | 1 | 3 | 10 |
| Plantillas | Básicas | Personalizadas | Todo |
| Prompt personalizado | ❌ | ✅ | ✅ |
| Soporte | Email | Prioritario | Dedicado |

### Cambiar plan
- Clic en **Cambiar plan** para upgrade o downgrade
- **Upgrade**: se aplica inmediatamente
- **Downgrade**: se aplica al final del periodo

### Cancelar cuenta

1. Ir a Configuración → Facturación
2. Clic en **Cancelar cuenta**
3. La cuenta permanece activa hasta el final del periodo pagado
4. Tienes **90 días** para reactivar antes de que se eliminen los datos

---

# 18. Preguntas Frecuentes

## General

<details>
<summary><strong>¿En qué idiomas funciona Parallly?</strong></summary>

El dashboard está disponible en **español, inglés, portugués y francés**. El agente IA detecta automáticamente el idioma del cliente y responde en ese idioma.
</details>

<details>
<summary><strong>¿Puedo usar Parallly en múltiples países?</strong></summary>

Sí. Configura la zona horaria y moneda por empresa. Los precios se manejan en la moneda local (COP, USD, BRL, EUR).
</details>

## Agente IA

<details>
<summary><strong>¿Qué modelos de IA usa Parallly?</strong></summary>

Por defecto: **Grok** (xAI) para conversación natural y **Gemini** para tool calling. También soporta OpenAI GPT-4, Anthropic Claude, y DeepSeek como alternativas.
</details>

<details>
<summary><strong>¿El agente IA puede agendar citas automáticamente?</strong></summary>

Sí. Configura servicios y disponibilidad, conecta tu calendario (Google/Microsoft), y el agente maneja todo el flujo de reserva: muestra servicios → pregunta fecha → muestra horarios → confirma → crea evento en calendario + envía confirmación.
</details>

<details>
<summary><strong>¿Puedo personalizar completamente el agente?</strong></summary>

Sí. Usa el **editor guiado** (identidad, personalidad, reglas) o el **modo prompt personalizado** para control total sobre el comportamiento del agente.
</details>

<details>
<summary><strong>¿El agente responde en el idioma del cliente?</strong></summary>

Sí. El agente detecta automáticamente el idioma del cliente (español, inglés, portugués, francés) y responde en ese idioma, manteniendo el tono configurado.
</details>

## Canales

<details>
<summary><strong>¿Puedo conectar múltiples canales a la vez?</strong></summary>

Sí. Puedes tener WhatsApp, Instagram, Messenger, Telegram y SMS conectados simultáneamente. Cada canal puede tener un agente IA diferente asignado.
</details>

<details>
<summary><strong>¿Qué pasa si desconecto un canal?</strong></summary>

Los mensajes dejan de llegar por ese canal. Las conversaciones existentes permanecen en el inbox. Puedes reconectar en cualquier momento.
</details>

<details>
<summary><strong>¿Necesito un número de WhatsApp Business?</strong></summary>

Sí. Parallly usa la WhatsApp Cloud API de Meta. Durante la conexión, vinculas tu cuenta de WhatsApp Business automáticamente mediante el Embedded Signup.
</details>

## Citas

<details>
<summary><strong>¿Se sincronizan las citas con mi calendario?</strong></summary>

Sí. Conecta Google Calendar o Microsoft Outlook. Las citas creadas por el agente IA aparecen automáticamente en tu calendario, y el cliente recibe una invitación por email.
</details>

<details>
<summary><strong>¿Puedo tener servicios online y presenciales?</strong></summary>

Sí. Cada servicio puede ser **Presencial**, **Online** o **Híbrido**. Los servicios online generan automáticamente un enlace de Google Meet o Microsoft Teams.
</details>

## Datos y Privacidad

<details>
<summary><strong>¿Dónde se almacenan mis datos?</strong></summary>

En servidores seguros con **aislamiento por empresa** (cada negocio tiene su propia base de datos). Los tokens y credenciales se encriptan con AES-256-GCM.
</details>

<details>
<summary><strong>¿Qué pasa con mis datos si cancelo?</strong></summary>

Tienes **90 días** para reactivar tu cuenta. Después de 90 días, los datos se eliminan permanentemente (incluidos contactos, conversaciones, y archivos).
</details>

<details>
<summary><strong>¿Cumplen con regulaciones de protección de datos?</strong></summary>

Sí. Parallly cumple con:
- **Ley 1581 de 2012** (Colombia — Habeas Data)
- **LFPDPPP** (México)
- Controles de opt-out, consentimiento, y solicitudes de eliminación integrados
</details>

---

<p align="center">
  <strong>¿No encontraste lo que buscabas?</strong><br/>
  Contáctanos en <a href="mailto:soporte@parallly-chat.cloud">soporte@parallly-chat.cloud</a>
</p>

<p align="center">
  <img src="images/placeholder-parallly-footer.png" alt="Parallly" width="120" /><br/>
  <em>Parallly — IA que conecta, vende y atiende</em>
</p>
