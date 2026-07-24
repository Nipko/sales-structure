---
id: analytics-reportes
title: "Analytics y reportes"
routes: ["/admin", "/admin/analytics-v2", "/admin/crm-analytics", "/admin/agent-analytics", "/admin/report-builder", "/admin/settings/alerts"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["analytics", "analiticas", "metricas", "reportes", "estadisticas", "kpi", "dashboard", "panel", "csat", "satisfaccion", "encuesta", "embudo", "velocidad", "win loss", "ganados perdidos", "reporte personalizado", "reporte programado", "exportar csv", "rendimiento de agentes", "tasa de resolucion"]
---

# Analytics y reportes

Parallly mide todo lo que pasa en tus conversaciones y ventas para que tomes decisiones con datos. Las analíticas viven en la barra lateral, sección **Gestión**, dentro del menú **Análisis**, que agrupa cinco vistas: **Vista general**, **Analíticas CRM**, **Rendimiento de agentes**, **Atribución** y **Reportes personalizados**.

Las analíticas completas son para administradores y supervisores. Los usuarios con rol agente ven únicamente sus propias métricas.

## El panel principal (Dashboard)

Al iniciar sesión llegas al **Dashboard**: tu vista general del día. Se adapta a tu industria — un consultorio ve "Citas hoy" y "Pacientes nuevos"; un restaurante ve "Pedidos hoy" e "Ingresos día"; un negocio general ve "Conversaciones hoy", "Leads nuevos" y "Tasa de respuesta". Si tu cuenta es nueva, también verás un checklist con los pasos pendientes para activarla (conectar un canal, personalizar tu agente, etc.).

## Cómo ver las métricas generales del negocio

1. En la barra lateral, abre **Análisis** → **Vista general**.
2. Elige el período arriba: **7 días**, **30 días**, **90 días** o **Personalizado** (rango de fechas a tu medida).
3. Navega por las pestañas: **Vista General** (conversaciones, mensajes, resolución IA, tiempo de respuesta, CSAT promedio), **IA & Bot**, **Resolución IA**, **Calidad (QA)**, **CRM & Ventas**, **Agentes**, **Automatización**, **Campañas**, **Canales**, **CSAT**, **Anomalías** y **Cohortes**.
4. Usa **Exportar CSV** para descargar los datos y trabajarlos en tu hoja de cálculo.

### La tasa de resolución IA

En la pestaña **Resolución IA** ves qué porcentaje de conversaciones tu agente de IA resolvió solo, sin que un humano tuviera que intervenir, con su tendencia en el tiempo y el desglose por canal. Como referencia:

| Tasa | Qué significa |
|------|---------------|
| Más de 80% | Excelente: tu agente y tu base de conocimiento están bien afinados |
| 60–80% | Buena: revisa qué preguntas quedan sin respuesta para mejorar |
| Menos de 60% | Necesita atención: probablemente faltan FAQs o las reglas de escalación son muy sensibles |

Si la tasa es baja en un canal específico, revisa qué tipo de consultas llegan por ahí: quizás ese público necesita contenido propio en tu base de conocimiento.

## Cómo revisar el rendimiento de tus agentes y canales

1. Ve a **Análisis** → **Rendimiento de agentes**.
2. Arriba ves cuatro indicadores del período: **Conversaciones**, **Tiempo prom. de respuesta**, **Tasa de resolución** y **CSAT promedio**.
3. Recorre las pestañas:
   - **Resumen** — volumen diario de conversaciones.
   - **Agentes** — tabla comparativa por agente (conversaciones, resueltas, tiempo de respuesta y CSAT), con distintivo de **IA** o **Humano**.
   - **Canales** — cuántas conversaciones llegan por cada canal y qué porcentaje del total representa.
   - **CSAT** — la satisfacción de tus clientes (ver más abajo).

Si tu rol es agente, en esta misma sección ves solo tus propios números: tus conversaciones, tu tiempo de respuesta y tus resultados.

## Cómo funciona la medición de satisfacción (CSAT)

Cuando una conversación se cierra, Parallly puede enviarle al cliente una breve encuesta por el mismo canal donde conversó: le pide una calificación de **1 a 5** (donde 5 es muy satisfecho) y un comentario opcional.

Los resultados se ven en la pestaña **CSAT** de **Rendimiento de agentes**:

- **CSAT promedio** del período, con el total de respuestas.
- **Distribución por estrellas** — cuántos clientes calificaron con 5, con 4, etc.
- **Comentarios recientes** — lo que escribieron tus clientes, tal cual.

Además, cada vez que un cliente responde una encuesta, la campana de notificaciones te avisa.

## Cómo analizar tu embudo de ventas (Analíticas CRM)

1. Ve a **Análisis** → **Analíticas CRM**.
2. Arriba ves los indicadores clave: **Total leads**, **Oportunidades activas**, **Valor del pipeline**, **Score promedio** y **Tasa de conversión**.
3. Explora las pestañas:
   - **Resumen** — leads por etapa, fuentes de leads y el bloque **Ganados vs Perdidos**: cuántos negocios ganaste, cuántos perdiste, tu **Tasa de éxito**, el valor total ganado y las **Razones de pérdida** más frecuentes.
   - **Embudo** — cómo avanzan tus contactos etapa por etapa y dónde se caen.
   - **Velocidad** — cuántos días pasa en promedio una oportunidad en cada etapa. Si una etapa acumula muchos días, ahí está tu cuello de botella.
   - **Agentes** — ranking del equipo por negocios cerrados y valor vendido.

La vista **Atribución** (en el mismo menú **Análisis**) complementa esto midiendo el camino completo de tus anuncios: clics → conversaciones → leads → ventas, con el retorno de cada campaña publicitaria.

## Cómo crear un reporte personalizado

Si necesitas un reporte con exactamente las métricas que te interesan:

1. Ve a **Análisis** → **Reportes personalizados**.
2. Haz clic en **Nuevo reporte**.
3. Escribe el **Nombre del reporte** (ej. "Rendimiento semanal") y una **Descripción** opcional.
4. Elige el **Tipo de gráfico**: **Barras**, **Líneas**, **Área** o **Circular**.
5. En **Selecciona métricas**, marca las que quieras combinar. Están agrupadas en **Conversaciones** (conversaciones, mensajes, transferencias), **Inteligencia artificial** (resolución IA, contención), **Rendimiento** (tiempos de respuesta y resolución), **CRM** (leads, tasa de conversión, valor del pipeline) y **Operaciones** (citas, no asistencias, campañas, CSAT).
6. Ajusta el **Rango de fechas** y revisa la **Vista previa**.
7. Haz clic en **Guardar**.

Tus reportes guardados quedan en la misma página, listos para consultar cuando quieras. Cada uno tiene opciones para **Editar**, **Duplicar** (útil para crear variantes) y **Eliminar**.

## Cómo recibir reportes automáticos por email

Puedes recibir un resumen de tus indicadores en tu correo, sin entrar al panel:

1. Ve a **Configuración** → sección **Integraciones y alertas** → **Alertas del sistema**.
2. Baja hasta **Reportes programados**.
3. Elige la **Frecuencia**: **Semanal (Lunes 8 AM)** o **Mensual (Día 1, 8 AM)**.
4. En **Destinatarios**, escribe los correos separados por comas.
5. Marca la casilla como **Habilitado** y haz clic en **Guardar cambios**.

Debajo verás la fecha del último envío. Los reportes programados están disponibles desde el plan **Pro** en adelante.

En esa misma página puedes crear **alertas del sistema**: notificaciones por email cuando una métrica supere un límite que definas (conversaciones activas, mensajes del día, escalaciones, entre otras). Se revisan cada 15 minutos.

## Preguntas frecuentes

**¿Quién puede ver las analíticas?**
Administradores y supervisores ven todo. Los agentes ven solo sus propias métricas en **Rendimiento de agentes**.

**¿Por qué una pestaña dice "sin datos"?**
El período elegido no tiene actividad. Amplía el rango de fechas (por ejemplo, de 7 a 30 días) o verifica que tus canales estén conectados y recibiendo conversaciones.

**¿Puedo descargar los datos?**
Sí: usa **Exportar CSV** en la Vista general de Análisis, o configura los **Reportes programados** para recibirlos por email.

**¿Los reportes programados están en todos los planes?**
No. Están disponibles en los planes **Pro**, **Enterprise** y **Custom**. En Emprendedor y Starter puedes consultar todas las analíticas dentro del panel.

**¿Cómo mejoro mi CSAT?**
Lee los **Comentarios recientes** de la pestaña CSAT: ahí tus clientes te dicen qué ajustar. Suele ayudar afinar el tono del agente de IA, completar tu base de conocimiento y responder rápido las conversaciones escaladas.

¿Necesitas más ayuda? Escríbenos en https://parallly-chat.cloud/support
