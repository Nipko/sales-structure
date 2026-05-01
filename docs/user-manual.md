# Parallly — Manual de Usuario

<p align="center">
  <img src="../docs/images/parallly-logo.png" alt="Parallly Logo" width="200" />
</p>

<p align="center">
  <strong>Plataforma de IA Conversacional Omnicanal</strong><br/>
  Guía completa para configurar y usar Parallly
</p>

<p align="center">
  Versión 3.0 — Mayo 2026
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
| 5.4 | [CRM Analytics](#54-crm-analytics) | |
| 5.5 | [Identidad y Merge](#55-identidad-y-merge) | |
| 5.6 | [Lead Scoring Configurable](#56-lead-scoring-configurable) | |
| 5.7 | [AI Insights](#57-ai-insights) | |
| 5.8 | [Aprobación de Deals](#58-aprobación-de-deals) | |
| 5.9 | [Filtros Avanzados](#59-filtros-avanzados) | |
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
| 14 | [Privacidad y Cumplimiento](#14-privacidad-y-cumplimiento) | |
| 15 | [Configuración](#15-configuración) | |
| 16 | [Gestión de Usuarios](#16-gestión-de-usuarios) | |
| 16.1 | [Habilidades del equipo](#161-habilidades-del-equipo) | |
| 17 | [Facturación y Planes](#17-facturación-y-planes) | |
| 18 | [Preguntas Frecuentes (FAQ)](#18-preguntas-frecuentes) | |
| 19 | [Adaptación por Industria (Verticales)](#19-adaptación-por-industria) | |
| 20 | [Propiedades y Alquiler Vacacional](#20-propiedades-y-alquiler-vacacional) | |
| 21 | [Panel de Super Administrador](#21-panel-de-super-administrador) | |

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

---

# 2. Primeros Pasos

## 2.1 Crear una cuenta

1. Ir a [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud)
2. Clic en **Registrarse**
3. Ingresar email y contraseña
4. Verificar el email con el código de 6 dígitos que recibirás
5. Completar el asistente de onboarding (sección 2.2)

> **Tip:** También puedes registrarte con tu cuenta de Google haciendo clic en "Continuar con Google".

---

## 2.2 Asistente de Onboarding

Al crear tu cuenta, un asistente de 5 pasos te guía para configurar tu negocio:

### Paso 1 — Perfil de empresa

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

La bandeja tiene 3 paneles:

| Panel | Contenido |
|-------|-----------|
| **Izquierda** | Lista de conversaciones con filtros y búsqueda |
| **Centro** | Chat activo con historial de mensajes |
| **Derecha** | Información del contacto (colapsable) |

Cada conversación en la lista muestra el **nombre de la cuenta del canal** y la **foto de perfil** del canal por donde llegó el mensaje, para que puedas identificar rápidamente de dónde viene cada conversación.

Las conversaciones nuevas llegan en **tiempo real** gracias a WebSocket: cuando un cliente nuevo escribe, la conversación aparece automáticamente en tu lista sin necesidad de recargar la página.

---

## 4.2 Filtros

| Filtro | Muestra |
|--------|---------|
| Todos | Todas las conversaciones activas |
| Míos | Solo conversaciones asignadas a ti |
| Sin asignar | Conversaciones sin agente humano asignado |
| Handoff | Conversaciones escaladas que esperan atención humana |

También puedes buscar conversaciones por nombre del contacto o contenido del mensaje.

### Notificaciones de handoff

Cuando una conversación se escala a un agente humano:

- **Sonido**: se reproduce una alerta auditiva en el dashboard
- **Badge visual**: aparece un indicador en la pestaña del navegador
- **Email**: el agente asignado recibe un correo con los detalles del cliente y un enlace directo al inbox
- **Escalamiento**: si nadie responde en 5 minutos, se alerta al supervisor

---

## 4.3 Acciones de conversación

La barra de acciones es **responsiva**: en pantallas pequeñas se muestran solo los iconos, y las acciones secundarias (archivar, eliminar) se agrupan en un menú desplegable **"Más"**.

| Acción | Descripción |
|--------|-------------|
| **Responder** | Envía un mensaje como agente humano |
| **Asignar** | Asigna la conversación a un agente específico |
| **Resolver** | Devuelve la conversación al agente IA |
| **Posponer** | Pausa por 1h, 3h, mañana, o lunes |
| **Macros** | Inserta respuestas predefinidas |
| **Archivar** | Mueve al archivo (muestra spinner de carga durante la acción) |
| **Eliminar** | Elimina permanentemente (muestra spinner de carga durante la acción) |
| **Notas** | Agrega notas internas (invisibles para el cliente) |

> **Atención:** La acción **Eliminar** es irreversible. Se eliminan todos los mensajes y la conversación permanentemente.

---

## 4.4 Panel del contacto

El panel derecho es **colapsable**: puedes ocultarlo o mostrarlo con un botón de toggle para ganar espacio en pantalla cuando no lo necesitas.

Al seleccionar una conversación, el panel muestra:

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

### Ver contactos

La lista muestra todos tus clientes y leads con:
- Nombre y datos de contacto
- Etapa actual (Nuevo, Contactado, Respondió, Calificado, etc.)
- Tags asignados
- Fecha de última interacción
- Score de lead
- **Iconos de canales**: cada contacto muestra badges circulares indicando todos los canales por los que ha interactuado (WhatsApp, Instagram, Messenger, etc.)
- **Conteo de conversaciones**: muestra el número real de conversaciones que ha tenido el contacto

Los contactos que han escrito por múltiples canales (por ejemplo, WhatsApp e Instagram) se **consolidan en una sola fila** mostrando todos los iconos de sus canales.

### Acciones principales

| Acción | Descripción |
|--------|-------------|
| **Buscar** | Por nombre, email o teléfono |
| **Filtrar** | Por segmento, etapa, tag, score mínimo/máximo, rango de fechas |
| **Importar** | Subir archivo CSV con contactos |
| **Exportar** | Descargar todos los contactos como CSV |
| **Crear** | Botón "Crear" abre un modal para agregar un lead nuevo |

### Crear un lead

Al hacer clic en el botón **"Crear"** en la lista de contactos, se abre un formulario modal con los siguientes campos:

| Campo | Obligatorio |
|-------|:-----------:|
| Nombre | No |
| Apellido | No |
| Teléfono | ✅ |
| Email | No |
| Etapa | No (se asigna "Nuevo" por defecto) |

### Acciones masivas (Bulk Actions)

Cada contacto en la lista tiene un **checkbox** para seleccionarlo. También hay un checkbox de **"Seleccionar todos"** en la cabecera.

Al seleccionar uno o más contactos, aparece una **barra de acciones fija** en la parte inferior con las siguientes opciones:

| Acción masiva | Descripción |
|---------------|-------------|
| **Cambiar etapa** | Mueve todos los seleccionados a una etapa del pipeline |
| **Agregar tag** | Agrega una etiqueta a todos los seleccionados |
| **Archivar** | Archiva los contactos seleccionados |

### Filtros avanzados

Además de los filtros básicos (etapa, tag, segmento), la lista soporta:

| Filtro | Descripción |
|--------|-------------|
| Score mínimo | Solo leads con score mayor o igual al valor indicado |
| Score máximo | Solo leads con score menor o igual al valor indicado |
| Fecha desde | Interacción posterior a esta fecha |
| Fecha hasta | Interacción anterior a esta fecha |
| Tags | Filtrar por uno o varios tags |

### Detalle del contacto

Al hacer clic en un contacto, ves su ficha completa:
- Información básica
- Historial de conversaciones
- Pipeline y etapa actual
- Notas internas del equipo
- Atributos personalizados (ver sección siguiente)

#### Editar un lead

En la vista de detalle, haz clic en el **icono de lápiz** para activar el modo de edición inline. Puedes modificar:
- Nombre
- Email
- Teléfono
- Etapa en el pipeline
- Marca VIP
- Tags

Al terminar, usa los botones **Guardar** o **Cancelar** para confirmar o descartar los cambios.

#### Archivar un lead

En la vista de detalle, haz clic en el **icono de archivo**. Aparece un diálogo de confirmación. Al confirmar, el lead pasa a estado archivado (no se elimina permanentemente, puedes recuperarlo).

#### Campos personalizados

La ficha del contacto incluye una tarjeta de **Campos personalizados** que muestra todos los atributos que hayas configurado (ver Configuración → Atributos). Los campos se renderizan según su tipo:

| Tipo de campo | Cómo se muestra |
|---------------|-----------------|
| Texto | Campo de texto libre |
| Número | Campo numérico |
| Booleano | Toggle encendido/apagado |
| Fecha | Selector de fecha |
| Selección | Menú desplegable con opciones |

Al modificar cualquier valor, aparece un botón **Guardar** para confirmar los cambios.

#### Score — Desglose transparente

Al hacer clic en el **número de score** del contacto, se expande un panel de desglose que muestra cómo se calcula el puntaje. Cada factor tiene una barra de progreso visual:

| Factor | Qué mide |
|--------|-----------|
| Engagement | Nivel de interacción (mensajes, respuestas) |
| Intención | Señales de compra detectadas por la IA |
| Recencia | Qué tan reciente fue la última interacción |
| Etapa | Posición en el pipeline de ventas |
| Perfil | Completitud de datos del contacto |

---

## 5.2 Pipeline (Kanban)

**Ruta:** Menú → Pipeline

Vista tipo tablero con columnas por etapa:

```
Nuevo → Contactado → Respondió → Calificado → Tibio → Caliente → Listo para cierre → Ganado / Perdido
```

- **Arrastra** tarjetas entre columnas para cambiar etapas
- Cada tarjeta muestra: nombre, valor del deal, días en la etapa
- **Métricas superiores:** valor total, pronóstico ponderado, cantidad de deals
- **Sin duplicados**: cada lead aparece como una sola tarjeta en el pipeline (no se crean oportunidades duplicadas)

### Personalizar etapas del pipeline

**Ruta:** Configuración → Pipeline

Puedes personalizar completamente las etapas de tu pipeline:
- **Reordenar**: arrastra las etapas para cambiar su posición
- **Editar**: modifica el nombre, color y probabilidad de cada etapa
- **Agregar**: crea nuevas etapas según tu proceso de ventas
- **Eliminar**: borra etapas que no uses
- **Terminal**: marca una etapa como terminal (ej: "Ganado", "Perdido") para indicar que el deal ya cerró
- **SLA**: configura horas máximas que un deal puede permanecer en cada etapa

### Aprobación de deals

Para deals de alto valor, puedes requerir aprobación antes de moverlos a una etapa superior:

1. En la tarjeta del deal, clic en **"Solicitar aprobación"**
2. Selecciona la etapa destino
3. Un supervisor o admin recibe la notificación
4. El supervisor puede **Aprobar** (mueve el deal) o **Rechazar** (con motivo)

Los deals pendientes de aprobación muestran un badge amarillo en el pipeline.

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

## 5.4 CRM Analytics

**Ruta:** Menú → CRM Analytics

Panel de analytics dedicado al CRM con 4 pestañas:

### Pestaña Overview (Resumen)

- **5 tarjetas de KPIs**: total de leads, leads nuevos del periodo, tasa de conversión, valor total del pipeline, tiempo promedio de cierre
- **Gráfico de barras**: distribución de leads por etapa del pipeline
- **Gráfico de pastel**: fuentes de leads (WhatsApp, Instagram, Messenger, etc.)
- **Resumen de resultados**: cantidad de deals ganados vs. perdidos con porcentajes

### Pestaña Funnel (Embudo)

Visualización del embudo de ventas con **barras horizontales** que muestran:
- Cantidad de leads en cada etapa
- Porcentaje de caída entre etapas (drop-off)
- Identificación de cuellos de botella en tu proceso

### Pestaña Velocity (Velocidad)

**Gráfico de barras** mostrando los días promedio que un lead permanece en cada etapa. Te ayuda a identificar dónde se estancan los deals y optimizar tu proceso de ventas.

### Pestaña Agents (Agentes)

Tabla de rendimiento tipo **leaderboard** con:
- Ranking de agentes (medallas para los 3 primeros)
- Deals cerrados por agente
- Valor total generado
- Tasa de conversión individual
- Tiempo promedio de cierre

---

## 5.5 Identidad y Merge

**Ruta:** Menú → Identidad

Parallly consolida automáticamente los contactos que interactúan por múltiples canales en un solo perfil unificado.

### Merge automático

Cuando un contacto escribe por dos canales diferentes usando el **mismo número de teléfono**, Parallly los unifica automáticamente en un solo perfil.

### Sugerencias de merge

Cuando la coincidencia es por **email** (pero no por teléfono), Parallly genera una sugerencia de merge que requiere tu aprobación.

En la página de Identidad verás una lista de sugerencias pendientes:
- **Perfil A** (ej: contacto de WhatsApp) y **Perfil B** (ej: contacto de Instagram)
- Motivo de la sugerencia (email compartido)
- Botones: **Aprobar** (fusiona los perfiles) o **Rechazar** (ignora la sugerencia)

### Contactos cross-canal

Los contactos que llegan por canales diferentes (ej: Instagram vs WhatsApp) y no comparten teléfono ni email requieren **merge manual** si determinas que son la misma persona.

### Merge manual

Para fusionar dos contactos manualmente:

1. Identifica los dos contactos que son la misma persona
2. En la página de Identidad, haz clic en **"Fusionar manualmente"**
3. Selecciona el **Contacto A** y el **Contacto B**
4. Confirma la fusión

Al fusionar:
- Se consolida el historial de conversaciones de ambos canales en un solo perfil
- Se preservan todos los mensajes, notas y actividades
- Los datos del perfil se combinan (el más completo prevalece)

> **Tip:** Cuando se fusionan dos perfiles, se conserva el historial de conversaciones de ambos canales en un solo contacto.

---

## 5.6 Lead Scoring Configurable

Configura cómo Parallly califica a tus leads automáticamente.

### Acceder
Configuración → Lead Scoring

### Pesos de calificación
Ajusta la importancia de cada factor arrastrando los sliders:
- **Engagement** (25%): Frecuencia de interacción del lead
- **Intención** (30%): Señales de compra detectadas por IA
- **Recencia** (20%): Qué tan reciente fue el último contacto
- **Progreso en pipeline** (15%): Avance en las etapas
- **Perfil completo** (10%): Datos de contacto disponibles

Los pesos deben sumar 100%.

### Palabras clave de compra
Agrega palabras que indican intención de compra: "precio", "costo", "comprar", "reservar", etc. El agente IA las detecta automáticamente.

### Decaimiento de score
Habilita para que leads inactivos pierdan puntuación gradualmente:
- **Días**: Después de cuántos días sin actividad inicia el decaimiento
- **Factor**: Cuánto se reduce (0.5 = se reduce a la mitad)

---

## 5.7 AI Insights

En el detalle de cada lead, hay una tarjeta colapsable "AI Insights" que genera un análisis inteligente con recomendaciones:

- Haz clic en la tarjeta para expandirla
- La primera vez que se expande, consulta a la IA para generar un análisis
- Incluye: siguiente mejor acción, nivel de interés, recomendaciones
- El resultado se cachea (no se recalcula al colapsar/expandir)

---

## 5.8 Aprobación de Deals

Cuando un deal se mueve a una etapa terminal (ej: "Cerrado ganado"), se requiere aprobación:

1. Al arrastrar un deal a una etapa terminal, aparece un modal de confirmación
2. El deal queda con badge **"Pendiente aprobación"** (amarillo)
3. Un administrador o supervisor puede:
   - ✅ **Aprobar**: El deal se mueve a la etapa final
   - ❌ **Rechazar**: Se solicita una razón y el deal vuelve a su etapa anterior

Los badges visibles en las tarjetas del kanban:
- 🟡 Pendiente aprobación
- 🔴 Rechazado (con razón visible)

---

## 5.9 Filtros Avanzados

En la página de Contactos, haz clic en **"Filtros avanzados"** para abrir el panel lateral:

- **Rango de score**: Filtra por puntuación mínima/máxima (1-10)
- **Rango de fechas**: Filtra por fecha de creación
- **Etiquetas**: Filtra por tags asignados

Los filtros activos se muestran como chips encima de la tabla. Cada chip tiene una X para eliminar ese filtro individualmente.

---

# 6. Agentes IA

## 6.1 Lista de agentes

**Ruta:** Menú → Agente IA

Cada tarjeta de agente muestra:
- Nombre y estado (activo/inactivo)
- Canales **conectados** asignados (solo se muestran los canales que están efectivamente conectados, no todos los asignados)
- Cantidad de reglas y herramientas
- Badge de "Agente por defecto"

### Banner de alerta

Si tienes canales conectados que **no tienen un agente IA asignado**, aparece un **banner rojo** en la parte superior de la página con el mensaje de advertencia y un botón **"Asignar agente ahora"** que te lleva directamente a la configuración de asignación.

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

El editor tiene secciones tipo tarjeta. Al realizar cambios, una **barra fija en la parte inferior** ("sticky save bar") permanece visible en todo momento para que puedas guardar sin necesidad de buscar el botón.

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

La sección de asignación **solo muestra los canales que tienes conectados** (no los que no has configurado aún). Cada canal se asigna a UN solo agente:
- WhatsApp → Agente A
- Instagram → Agente B
- etc.

### Herramientas
Activa funciones del agente:
- Citas (agendar, cancelar, consultar disponibilidad)
- Catálogo (buscar productos, precios)
- FAQs (buscar respuestas en la base de conocimiento)
- Políticas (consultar políticas del negocio)

### Checklist de configuración

El editor incluye un checklist que guía los pasos pendientes. El paso de conectar canal indica **"Conectar un canal de mensajería"** (genérico, no específico a WhatsApp) para reflejar que puedes empezar con cualquier canal.

---

## 6.3 Plantillas

6 plantillas predefinidas para empezar rápido:

| Plantilla | Ideal para |
|-----------|-----------|
| Asesor de Ventas | Negocios que venden productos/servicios |
| Agente de Soporte | Atención al cliente y resolución de problemas |
| Bot FAQ | Respuestas rápidas a preguntas frecuentes |
| Agendador de Citas | Consultorios, salones, asesorías |
| Calificador de Leads | Clasificar leads por nivel de interés |
| En Blanco | Configuración desde cero |

---

## 6.4 Test del agente

**Ruta:** Agente → botón Test

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

---

## 7.1 WhatsApp

### Conectar

1. Ir a **Canales → WhatsApp**
2. Clic en **Conectar con WhatsApp**
3. Se abre el Embedded Signup de Meta
4. Autoriza tu cuenta de WhatsApp Business
5. Selecciona tu número de teléfono
6. Canal conectado automáticamente

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
3. Se abre una **ventana popup** de autorización OAuth de Instagram
4. Inicia sesión con tu cuenta de Instagram Business
5. Concede los permisos solicitados
6. La ventana se cierra y tu cuenta queda conectada

Una vez conectado, verás el nombre de tu cuenta en formato **"Nombre (@username)"** junto con la **foto de perfil** obtenida automáticamente.

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
3. Se carga el **SDK de Facebook** y se abre el diálogo de login
4. Inicia sesión con tu cuenta de Facebook
5. Autoriza los permisos de páginas y mensajería
6. Parallly conecta automáticamente tus páginas con permiso de mensajería

Una vez conectado, se muestra la **foto de perfil** de la página obtenida a través del Graph API de Facebook.

> **Nota:** El token de página de Messenger **no expira**, por lo que no necesitas reconectar periódicamente como con Instagram.

---

## 7.4 Telegram

### Conectar

1. Abre Telegram y busca **@BotFather**
2. Envía `/newbot` y sigue las instrucciones para crear un bot
3. Copia el **token** del bot
4. En Parallly: **Canales → Telegram**
5. Pega el token y nombre del bot
6. Clic en **Conectar**

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
4. El canal se desactiva inmediatamente

> **Nota:** Al desconectar, las conversaciones existentes permanecen en el inbox. Solo se dejan de recibir mensajes nuevos por ese canal.

---

# 8. Citas y Agenda

**Ruta:** Menú → Citas

## 8.1 Calendario

Vista semanal con todas las citas agendadas:
- Cada cita muestra servicio (color codificado), nombre del cliente, y hora
- Clic en un espacio vacío para crear una cita manual
- Clic en una cita existente para editar o cancelar

---

## 8.2 Servicios

**Ruta:** Citas → pestaña Servicios

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
10. Cita creada en Google Calendar + confirmación por WhatsApp
```

### Qué pasa al confirmar:
- Se crea un evento en el calendario conectado
- El cliente recibe una invitación por email
- Se envía confirmación por WhatsApp con los detalles
- Si el servicio es **Online**, se incluye el enlace de Meet/Teams
- El dashboard se actualiza en tiempo real

### Después de la cita — Confirmación de asistencia

Una vez que la cita finaliza, Parallly envía automáticamente un mensaje al cliente por su canal de mensajería preguntando si asistió:

1. **Confirmación de asistencia**: "¿Pudiste asistir a tu cita de [servicio]?"
2. **Si confirma asistencia**: La cita se marca como completada y se dispara una encuesta de satisfacción (CSAT)
3. **Si no asistió (no-show)**: Se envía un mensaje de seguimiento ofreciendo reagendar
4. **Auto-completar**: Si después de 2 horas no hay respuesta pero la cita estaba confirmada, se marca automáticamente como completada

### Desconectar un calendario con citas futuras

Si intentas desconectar un calendario que tiene citas futuras:

1. Aparece un diálogo mostrando **cuántas citas** quedan pendientes
2. Se te da la opción de **reasignar** las citas a otro calendario conectado
3. Selecciona el calendario destino en el dropdown
4. Al confirmar, todas las citas futuras se mueven al nuevo calendario y luego se desconecta el original

> **Nota:** Si solo tienes un calendario, deberás cancelar las citas futuras manualmente antes de desconectar.

---

# 9. Automatización

**Ruta:** Menú → Automatización

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

# 14. Privacidad y Cumplimiento

**Ruta:** Menú → Compliance

| Sección | Descripción |
|---------|-------------|
| **Textos legales** | Gestiona términos, política de privacidad, consentimiento |
| **Consentimientos** | Registro de consentimientos otorgados por clientes |
| **Solicitudes de baja** | Lista de clientes que pidieron no recibir más mensajes |
| **Solicitudes de eliminación** | Solicitudes de eliminación de datos (GDPR/Habeas Data) |

### Baja automática
Parallly detecta automáticamente cuando un cliente escribe keywords como "no quiero", "cancelar", "basta" y lo agrega a la lista de solicitudes de baja. Los mensajes proactivos (broadcasts, automaciones) se bloquean, pero las respuestas a mensajes del cliente siguen funcionando.

---

# 15. Configuración

**Ruta:** Menú → Configuración

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
| **Pipeline** | Etapas del pipeline de ventas (ver abajo) |
| **Scoring** | Pesos de factores y configuración de decaimiento |
| **Facturación** | Plan, pagos, método de pago |

### Etapas del Pipeline

**Ruta:** Configuración → Pipeline

Personaliza las etapas de tu funnel de ventas:

1. **Reordenar**: arrastra y suelta las etapas para cambiar su orden
2. **Editar**: haz clic en una etapa para modificar su nombre, color representativo y probabilidad de cierre (%)
3. **Agregar**: clic en "Agregar etapa" para crear una nueva
4. **Eliminar**: borra etapas que ya no uses
5. **Marcar como terminal**: indica que una etapa es final (ej: "Ganado" o "Perdido"), lo que significa que el deal ya no avanza

Los cambios se reflejan inmediatamente en la vista de Pipeline (Kanban) y en todos los filtros del CRM.

---

# 16. Gestión de Usuarios

**Ruta:** Menú → Usuarios

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

## 16.1 Habilidades del equipo

Cada usuario puede tener **habilidades (skills)** asignadas que se usan para el enrutamiento inteligente de conversaciones:

1. Ve a **Usuarios** en el menú
2. En la columna "Skills", haz clic para editar
3. Escribe una habilidad y presiona Enter, o selecciona de las sugeridas:
   - ventas, soporte, técnico, facturación, quejas, general, vip, idiomas
4. Los cambios se guardan automáticamente

**¿Para qué sirven?** Cuando un cliente solicita atención humana, el sistema asigna al agente que tenga las habilidades más relevantes para el tipo de consulta.

---

# 17. Facturación y Planes

**Ruta:** Configuración → Facturación

### Comparación de planes

| Feature | Starter | Pro | Enterprise |
|---------|:-------:|:---:|:----------:|
| Precio | Gratis | $129/mes | $349/mes |
| Agentes IA | 1 | 3 | 10 |
| Calendarios | 1 | 3 | 10 |
| Plantillas | Básicas | Personalizadas | Todo |
| Prompt personalizado | No | Si | Si |
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
- Controles de solicitudes de baja, consentimiento, y solicitudes de eliminación integrados
</details>

---

# 19. Adaptación por Industria

Parallly se adapta automáticamente al tipo de negocio que seleccionas durante el registro. No es solo un cambio de nombre — toda la plataforma se reconfigura.

## 19.1 ¿Qué se adapta?

| Elemento | Ejemplo (Salud) | Ejemplo (Restaurantes) |
|----------|-----------------|------------------------|
| **Agente IA** | "Sofía" — profesional, empática | "Luca" — cálido, amigable |
| **Sidebar** | Pacientes, Seguimiento, Agenda Médica | Comensales, Reservas, Reservaciones |
| **Pipeline** | Consulta→Cita→Visita→Activo | Consulta→Reserva→Completada |
| **KPIs** | Citas Hoy, No Shows, Pacientes Nuevos | Reservas Hoy, Consultas, No Shows |
| **FAQs** | Horarios, pagos, emergencias | Menú, reservas, alergias |
| **Welcome** | "Bienvenido a tu consultorio virtual" | "Tu restaurante está listo" |
| **Empty states** | "Cuando llegue tu primer paciente..." | "Tus comensales aparecerán aquí..." |
| **Checklist** | "Configura tu asistente médico" | "Carga tu menú y horarios" |
| **Homepage** | Vista de agenda del día | Vista de agenda del día |

## 19.2 Industrias disponibles

1. **Salud** — Clínicas, consultorios, estética, psicología, farmacias
2. **Moda y Belleza** — Salones, barberías, spas, boutiques
3. **Inmobiliaria** — Venta, arriendo, comercial, construcción
4. **Restaurantes** — Casual dining, comida rápida, cafeterías, dark kitchens
5. **Automotriz** — Concesionarios, talleres, repuestos, alquiler
6. **Turismo** — Agencias de viajes, hoteles, tours, alquiler vacacional
7. **Educación** — Idiomas, universidades, cursos online, capacitación
8. **Finanzas** — Seguros, asesoría financiera, fintech, créditos
9. **Servicios Profesionales** — Abogados, contadores, arquitectos, consultores
10. **Retail** — Moda, electrónica, hogar, marketplace
11. **Tecnología** — SaaS, consultoría TI, desarrollo, hardware
12. **Otro** — Configuración genérica

## 19.3 Sub-tipo de negocio

Después de seleccionar tu industria, puedes elegir un sub-tipo para una configuración más precisa. Por ejemplo:
- Salud → **Odontología** vs **Psicología** vs **Estética**
- Restaurantes → **Casual dining** vs **Dark kitchen** vs **Cafetería**

## 19.4 Terminología automática

El agente IA usa vocabulario de tu industria en cada conversación:
- Salud: "paciente", "consulta", "cita médica"
- Inmobiliaria: "interesado", "propiedad", "visita"
- Restaurantes: "comensal", "reserva", "mesa"

No necesitas configurar nada — se activa automáticamente al registrarte.

## 19.5 Temas prohibidos por industria

Cada vertical tiene restricciones adicionales que el agente IA respeta:
- **Salud**: No da diagnósticos, no prescribe medicamentos
- **Finanzas**: No garantiza rendimientos, no solicita datos bancarios completos
- **Inmobiliaria**: No garantiza valorización, no discrimina por zona

---

# 20. Propiedades y Alquiler Vacacional

Para negocios de alquiler vacacional (Airbnb, Booking.com, etc.), Parallly ofrece un módulo completo de gestión de propiedades con sincronización de calendarios.

> **Nota**: Este módulo aparece en el sidebar como "Propiedades" cuando tu industria es Turismo (sub-tipo: alquiler vacacional).

## 20.1 Crear una propiedad

1. Ve a **Propiedades** en el menú
2. Clic en **"Agregar propiedad"**
3. Completa: nombre, dirección, ciudad, capacidad, habitaciones, baños
4. Configura el precio por noche y tarifa de limpieza
5. Selecciona amenidades (WiFi, piscina, parking, AC, etc.)
6. Guarda

### Límites por plan
| Plan | Propiedades máximas |
|------|---------------------|
| Starter | 2 |
| Pro | 10 |
| Enterprise | 50 |
| Custom | Ilimitado |

## 20.2 Calendario de disponibilidad

En el detalle de cada propiedad, el tab **Calendario** muestra una vista mensual:
- 🟢 Verde = disponible
- 🔴 Rojo = reservado (reserva directa en Parallly)
- 🟠 Naranja = bloqueado (importado de Airbnb/Booking)
- ⚫ Gris = fecha pasada

Navega entre meses con las flechas ← →.

## 20.3 Sincronización iCal (Airbnb / Booking.com)

### Importar disponibilidad (de Airbnb/Booking a Parallly)

1. Ve al tab **iCal Feeds** en el detalle de la propiedad
2. Clic en **"Agregar feed"**
3. Selecciona la plataforma (Airbnb, Booking.com, Vrbo, Otro)
4. Pega la **URL del calendario iCal** que te da la plataforma:
   - **Airbnb**: Ve a tu anuncio → Calendario → Disponibilidad → Sincronizar calendarios → Exportar calendario → Copia la URL
   - **Booking.com**: Extranet → Tarifas y disponibilidad → Exportar → Copia la URL
5. Parallly sincroniza automáticamente cada **30 minutos**
6. También puedes hacer clic en **"Sincronizar ahora"** para forzar una actualización

### Exportar disponibilidad (de Parallly a Airbnb/Booking)

1. En el tab **iCal Feeds**, copia la **URL de exportación** que Parallly genera
2. Ve a tu plataforma:
   - **Airbnb**: Calendario → Sincronizar → Importar calendario → Pega la URL
   - **Booking.com**: Extranet → Tarifas y disponibilidad → Importar → Pega la URL
3. La plataforma consultará esta URL periódicamente para ver tus fechas bloqueadas

### ¿Cómo se evitan las dobles reservas?

- Parallly verifica disponibilidad en TIEMPO REAL antes de aceptar cualquier reserva
- Consulta tanto las fechas importadas (Airbnb/Booking) como las reservas directas
- Si hay conflicto, la reserva se rechaza automáticamente
- **Importante**: iCal tiene un delay de 3-6 horas. Para protección máxima, acepta reservas con al menos 24h de anticipación.

## 20.4 Reservas directas

Crea reservas directamente en Parallly (sin pasar por Airbnb/Booking):

1. Ve al tab **Reservas** en el detalle de la propiedad
2. Clic en **"Nueva reserva"**
3. Completa: fechas, nombre del huésped, teléfono, número de huéspedes
4. El precio se calcula automáticamente
5. La reserva aparecerá en el feed de exportación para que las plataformas la vean

## 20.5 Instrucciones de Check-in

En el tab **Check-in** de cada propiedad:
- Escribe las instrucciones de llegada (código de puerta, WiFi, estacionamiento)
- Agrega las reglas de la casa
- Configura hora de check-in y check-out
- El agente IA puede enviar estas instrucciones automáticamente a los huéspedes

## 20.6 El agente IA y las propiedades

El agente IA puede:
- ✅ Verificar disponibilidad en tiempo real
- ✅ Mostrar detalles y amenidades de la propiedad
- ✅ Dar precio por noche con tarifa de limpieza
- ✅ Crear reservas directas
- ✅ Enviar instrucciones de check-in

---

# 21. Panel de Super Administrador

El super administrador tiene visibilidad y control completo sobre todos los tenants de la plataforma.

## 21.1 Dashboard de plataforma

6 KPIs en tiempo real:
- Tenants totales y activos
- Usuarios totales
- Mensajes hoy (cross-tenant)
- Handoffs pendientes
- Distribución por vertical

## 21.2 Detalle del tenant (6 tabs)

| Tab | Contenido |
|-----|-----------|
| **Info** | Datos de la empresa, industria, plan, fecha de creación |
| **Usuarios** | Lista de usuarios, roles, reset de contraseña |
| **Canales** | Canales conectados (WhatsApp, IG, Messenger, etc.) |
| **Facturación** | Estado de suscripción, plan, periodo |
| **Actividad** | Health score (0-100), mensajes 7d/30d, conversaciones activas, handoffs, agentes/FAQs/servicios configurados |
| **Config IA** | Agentes del tenant con canales asignados, pipeline stages configurados, info vertical |

## 21.3 Health Score

Cada tenant tiene un score de salud (0-100) calculado automáticamente:
- 🟢 ≥60: Saludable (canales conectados, agente configurado, actividad reciente)
- 🟡 30-59: Requiere atención
- 🔴 <30: Inactivo/dormido

**Fórmula**:
- Canales conectados: +20 puntos
- Agente IA configurado: +20 puntos
- FAQs cargadas (≥3): +15 puntos
- Servicios creados: +10 puntos
- Actividad reciente (mensajes 7d): +35 puntos

---

<p align="center">
  <strong>¿No encontraste lo que buscabas?</strong><br/>
  Contáctanos en <a href="mailto:soporte@parallly-chat.cloud">soporte@parallly-chat.cloud</a>
</p>

<p align="center">
  <em>Parallly — IA que conecta, vende y atiende</em>
</p>
