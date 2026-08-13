---
id: analytics-reportes
title: "Analytics y reportes"
routes: ["/admin", "/admin/analytics-v2", "/admin/crm-analytics", "/admin/agent-analytics", "/admin/report-builder", "/admin/settings/alerts"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["analytics", "analiticas", "metricas", "reportes", "estadisticas", "kpi", "dashboard", "panel", "csat", "satisfaccion", "encuesta", "embudo", "velocidad", "win loss", "ganados perdidos", "reporte personalizado", "reporte programado", "exportar csv", "rendimiento de agentes", "tasa de resolucion"]
---

# Analytics y reportes

Parallly mide lo que pasa en tus conversaciones y ventas para que tomes decisiones con datos. En **Insights** encontrarás **Analíticas**, **Analíticas CRM**, **Rendimiento de agentes**, **Atribución** y **Reportes personalizados**.

Las analíticas son para administradores y supervisores. Los usuarios con rol agente no tienen acceso a estas vistas; deben solicitar la información necesaria a un supervisor o administrador.

## El panel principal (Dashboard)

Al iniciar sesión llegas al **Dashboard**: tu vista general del día. Se adapta a tu industria — un consultorio ve "Citas hoy" y "Pacientes nuevos"; un restaurante ve "Pedidos hoy" e "Ingresos día"; un negocio general ve "Conversaciones hoy", "Leads nuevos" y "Tasa de respuesta". Admin/Supervisor también ve **Salud de tus agentes**; si quedan esenciales pendientes, aparece la tarjeta temporal **Puesta en marcha**.

## Cómo ver las métricas generales del negocio

1. En la barra lateral, abre **Insights → Analíticas**.
2. Elige uno de los períodos disponibles o define un rango personalizado.
3. Navega por las pestañas: **Vista General** (conversaciones, mensajes, resolución IA, tiempo de respuesta, CSAT promedio), **IA & Bot**, **Resolución IA**, **Calidad (QA)**, **CRM & Ventas**, **Agentes**, **Automatización**, **Campañas**, **Canales**, **CSAT**, **Anomalías** y **Cohortes**.
4. Usa **Exportar CSV** para descargar los datos y trabajarlos en tu hoja de cálculo.

### La tasa de resolución IA

En la pestaña **Resolución IA** ves qué porcentaje de conversaciones tu agente de IA resolvió solo, sin que un humano tuviera que intervenir, con su tendencia en el tiempo y el desglose por canal. Es una señal operativa, no una nota de calidad: una tasa alta puede coexistir con respuestas incorrectas y una tasa baja puede reflejar handoffs seguros. Si cambia mucho por canal, revisa las consultas, el agente asignado y las brechas de conocimiento.

## Cómo revisar el rendimiento de tus agentes y canales

1. Ve a **Insights → Rendimiento de agentes**.
2. Arriba ves cuatro indicadores del período: **Conversaciones**, **Tiempo prom. de respuesta**, **Tasa de resolución** y **CSAT promedio**.
3. Recorre las pestañas:
   - **Resumen** — volumen diario de conversaciones.
   - **Agentes** — tabla comparativa por agente (conversaciones, resueltas, tiempo de respuesta y CSAT), con distintivo de **IA** o **Humano**.
   - **Canales** — cuántas conversaciones llegan por cada canal y qué porcentaje del total representa.
   - **CSAT** — la satisfacción de tus clientes (ver más abajo).

## Cómo funciona la medición de satisfacción (CSAT)

La pestaña **CSAT** de **Rendimiento de agentes** muestra las valoraciones que ya estén registradas en la cuenta:

- **CSAT promedio** del período, con el total de respuestas.
- **Distribución por estrellas** — cuántos clientes calificaron con 5, con 4, etc.
- **Comentarios recientes** — lo que escribieron tus clientes, tal cual.

En la versión actual, cerrar una conversación no envía ni captura automáticamente una encuesta por el canal y tampoco genera una alerta en la campana. Si necesitas recolectar CSAT, usa un proceso o integración habilitada para tu cuenta y confirma que las respuestas aparezcan antes de basar decisiones en esta vista.

## Cómo analizar tu embudo de ventas (Analíticas CRM)

1. Ve a **Insights → Analíticas CRM**.
2. Arriba ves los indicadores clave: **Total leads**, **Oportunidades activas**, **Valor del pipeline**, **Score promedio** y **Tasa de conversión**.
3. Explora las pestañas:
   - **Resumen** — leads por etapa, fuentes de leads y el bloque **Ganados vs Perdidos**: cuántos negocios ganaste, cuántos perdiste, tu **Tasa de éxito**, el valor total ganado y las **Razones de pérdida** más frecuentes.
   - **Embudo** — cómo avanzan tus contactos etapa por etapa y dónde se caen.
   - **Velocidad** — cuántos días pasa en promedio una oportunidad en cada etapa. Si una etapa acumula muchos días, ahí está tu cuello de botella.
   - **Agentes** — ranking del equipo por negocios cerrados y valor vendido.

La vista **Atribución** (en **Insights**) complementa esto midiendo el camino completo de tus anuncios: clics → conversaciones → leads → ventas, con el retorno de cada campaña publicitaria.

## Cómo crear un reporte personalizado

Si necesitas un reporte con exactamente las métricas que te interesan:

1. Ve a **Insights → Reportes personalizados**.
2. Haz clic en **Nuevo reporte**.
3. Escribe el **Nombre del reporte** (ej. "Rendimiento semanal") y una **Descripción** opcional.
4. Elige el **Tipo de gráfico**: **Barras**, **Líneas**, **Área** o **Circular**.
5. En **Selecciona métricas**, marca las que quieras combinar. Están agrupadas en **Conversaciones** (conversaciones, mensajes, transferencias), **Inteligencia artificial** (resolución IA, contención), **Rendimiento** (tiempos de respuesta y resolución), **CRM** (leads, tasa de conversión, valor del pipeline) y **Operaciones** (citas, no asistencias, campañas, CSAT).
6. Ajusta el **Rango de fechas** y revisa la **Vista previa**.
7. Haz clic en **Guardar**.

Tus reportes guardados quedan en la misma página, listos para consultar cuando quieras. Cada uno tiene opciones para **Editar**, **Duplicar** (útil para crear variantes) y **Eliminar**.

## Cómo recibir reportes automáticos por email

Puedes recibir un resumen de tus indicadores en tu correo, sin entrar al panel:

1. Ve a **Configuración → Gobierno y alertas → Alertas del sistema**.
2. Baja hasta **Reportes programados**.
3. Elige una de las frecuencias y horarios disponibles para tu cuenta.
4. En **Destinatarios**, escribe los correos separados por comas.
5. Marca la casilla como **Habilitado** y haz clic en **Guardar cambios**.

Debajo verás la fecha del último envío. Si no aparece la opción, revisa su disponibilidad en **Plan y facturación**.

En esa misma página puedes crear **alertas del sistema**: notificaciones por email cuando una métrica supere un límite que definas (conversaciones activas, mensajes del día, escalaciones, entre otras). La plataforma las evalúa automáticamente.

## Preguntas frecuentes

**¿Quién puede ver las analíticas?**
Administradores y supervisores pueden acceder a estas vistas. Los agentes no tienen acceso directo a las páginas de analítica.

**¿Por qué una pestaña dice "sin datos"?**
El período elegido no tiene actividad. Amplía el rango de fechas (por ejemplo, de 7 a 30 días) o verifica que tus canales estén conectados y recibiendo conversaciones.

**¿Puedo descargar los datos?**
Sí: usa **Exportar CSV** en la Vista general de Análisis, o configura los **Reportes programados** para recibirlos por email.

**¿Los reportes programados están disponibles para mi cuenta?**
La pantalla y **Plan y facturación** muestran la disponibilidad vigente. Las vistas que puedes consultar permanecen visibles según tu rol y configuración.

**¿Cómo mejoro mi CSAT?**
Lee los **Comentarios recientes** de la pestaña CSAT: ahí tus clientes te dicen qué ajustar. Suele ayudar afinar el tono del agente de IA, completar tu base de conocimiento y responder rápido las conversaciones escaladas.

¿Necesitas más ayuda? Escríbenos en https://parallly-chat.cloud/support
