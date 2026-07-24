---
id: broadcast
title: "Campañas y difusión (broadcast)"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campaña", "campañas", "broadcast", "difusión", "envío masivo", "mensajes masivos", "whatsapp masivo", "plantilla", "plantillas de whatsapp", "template", "segmento", "destinatarios", "audiencia", "programar envío", "promociones", "marketing", "entregado", "leído", "prueba a/b", "número emisor"]
---

# Campañas y difusión (broadcast)

Una **campaña** (o broadcast) es un mensaje que envías de una sola vez a muchos de tus contactos: una promoción, un anuncio, un recordatorio general. Se envía por **WhatsApp** y/o **Email**, a todos tus contactos o a un segmento específico.

Encuentras las campañas en la barra lateral, sección **Crecimiento → Campañas**. Pueden crearlas los usuarios con rol de **administrador** o **supervisor** (los agentes no).

## Antes de empezar

- **WhatsApp usa plantillas aprobadas por Meta.** Para escribirle a un cliente que no te ha hablado en las últimas 24 horas, WhatsApp exige que el mensaje sea una plantilla revisada y aprobada por Meta. Revisa tus plantillas en **Canales → WhatsApp** (verás el resumen de plantillas y el botón **Ver todas las plantillas**).
- **Prepara tu audiencia.** Puedes enviar a **Todos los contactos** o a un **Segmento** (grupo guardado de contactos con filtros, por ejemplo "clientes VIP"). Los segmentos se crean en **CRM → Segmentos**.
- **Verifica tu plan.** El plan Emprendedor no incluye campañas y Starter permite hasta 3 por mes (ver tabla de límites más abajo).

## Cómo crear y enviar una campaña

1. Ve a **Crecimiento → Campañas** y haz clic en **Nueva campaña**.
2. Escribe el **Nombre de la campaña** (por ejemplo, "Promo Verano 2026"). Es solo para uso interno.
3. En **Canales de envío**, elige **WhatsApp**, **Email** o ambos.
4. Redacta el contenido de cada canal:
   - **Plantilla WhatsApp**: escribe el texto del mensaje. Usa `{{name}}` para insertar el nombre de cada contacto automáticamente. Recuerda que debe corresponder a una plantilla aprobada por Meta si vas a contactar clientes fuera de la ventana de 24 horas.
   - **Contenido del email**: asunto y cuerpo del correo.
5. Si tienes **más de un número de WhatsApp conectado**, aparece el selector **Enviar desde el número**: elige desde qué número sale la campaña, o deja **Número principal (por defecto)**.
6. En **Audiencia**, elige **Todos los contactos** o **Segmento** (y selecciona cuál; verás cuántos contactos incluye).
7. En **Fecha de envío (opcional)**:
   - Si eliges fecha y hora, el botón dirá **Programar** y la campaña saldrá sola en ese momento.
   - Si la dejas vacía, el botón dirá **Guardar borrador** y la campaña queda guardada sin enviarse.
8. Para enviar un borrador de inmediato, ábrelo en la lista y usa **Enviar ahora**.

> Tip: los envíos masivos salen a un ritmo controlado para proteger tu número de WhatsApp. Si la campaña es grande, es normal que tarde varios minutos en completarse.

## Estados de una campaña

Cada campaña muestra su estado en la lista: **Borrador** (guardada, sin programar), **Programada**, **Enviando**, **Enviada**, **Completada** o **Fallida**.

## Métricas: cómo leer los resultados

En la parte superior de **Campañas** ves los totales: **Campañas**, **Enviadas**, **Programadas** y **Respuestas**. Además, cada campaña muestra su embudo:

- **Destinatarios** — a cuántos contactos se dirigió.
- **Entregado** — cuántos mensajes llegaron al teléfono o buzón del cliente.
- **Leído** — cuántos lo abrieron (WhatsApp reporta lecturas cuando el cliente las tiene activadas).
- **Respondieron** — cuántos contestaron el mensaje.

Si además quieres saber cuántas **ventas** generó cada campaña, revisa **Ingresos por campañas** en la sección de atribución de Analíticas.

## Pruebas A/B (planes Pro y superiores)

Con el interruptor **Probar dos variantes (A/B)** al crear la campaña puedes enviar dos versiones del mensaje y descubrir cuál funciona mejor:

1. Activa **Probar dos variantes (A/B)** y redacta la **Variante A** y la **Variante B**.
2. Ajusta la **División del envío** (qué porcentaje de la audiencia recibe cada variante).
3. Opcional: activa **Auto-selección** para que el sistema detecte la variante ganadora y la use automáticamente con el resto de la audiencia.
4. Después del envío, la campaña muestra resultados por variante (enviados, entregados, tasa de lectura) y puedes usar **Seleccionar ganadora**.

> Consejo: cambia un solo elemento entre variantes (el texto, la oferta o el llamado a la acción). Así sabrás exactamente qué hizo la diferencia.

## Plantillas de WhatsApp: crear y aprobar

Ruta: **Canales → WhatsApp → Ver todas las plantillas**.

- **Crear plantilla**: dale un nombre (minúsculas y guiones bajos, ej. `recordatorio_pago`), elige idioma y categoría, escribe encabezado, cuerpo (con variables como `{{1}}`), pie y hasta 3 botones. Al terminar, **Enviar a Meta**.
- Meta la revisa normalmente entre minutos y 72 horas. Los estados son **Aprobadas**, **Pendientes** y **Rechazadas** (con el motivo del rechazo visible).
- **Sincronizar desde Meta** trae las plantillas que ya tengas aprobadas en tu cuenta.
- Al conectar WhatsApp, Parallly envía automáticamente 3 **plantillas semilla** de utilidad (recordatorio de cita, confirmación de pedido y pago recibido) que Meta suele aprobar en minutos.
- Si tienes varios números, al crear la plantilla eliges el **Número / cuenta** al que pertenece.

## Límites por plan

| Plan | Campañas por mes | Pruebas A/B | Segmentos | Contactos |
|------|-----------------|-------------|-----------|-----------|
| Emprendedor | No incluido | — | — | 100 |
| Starter | 3 | No | 3 | 500 |
| Pro | Ilimitadas | Sí | 15 | 5.000 |
| Enterprise | Ilimitadas | Sí | Ilimitados | 50.000 |
| Custom | Ilimitadas | Sí | Ilimitados | Ilimitados |

Otros límites relacionados: el canal **Email** está disponible desde el plan Starter, y la cantidad de **números de WhatsApp** que puedes conectar depende del plan (Pro: 2, Enterprise: 3, Custom: sin límite). Puedes subir de plan en **Configuración → Facturación**.

## ¿Y el SMS?

El SMS en Parallly **no es un canal de conversación**: es una notificación de una sola vía que funciona con **créditos** (1 crédito = 1 segmento de SMS) y sale por la infraestructura de la plataforma, sin que necesites contratar nada aparte. La compra de paquetes y tu saldo se gestionan en **Configuración → Facturación**. Si la opción de SMS no aparece al crear tu campaña, es porque aún no está habilitada para tu cuenta.

## Preguntas frecuentes

**¿Por qué no veo la sección Campañas?**
Tu rol debe ser administrador o supervisor, y tu plan debe incluir campañas (el plan Emprendedor no las incluye).

**¿Puedo cancelar una campaña programada?**
Mientras esté en estado **Programada** puedes gestionarla desde la lista antes de la hora de envío. Una vez en estado **Enviando**, los mensajes ya están saliendo.

**¿Por qué mi campaña de WhatsApp no llega a algunos contactos?**
Las causas más comunes: la plantilla no está **Aprobada** por Meta, el contacto se dio de baja (no se le envían más difusiones) o el número ya no existe. Revisa el estado de la plantilla en **Canales → WhatsApp**.

**¿Puedo personalizar el mensaje con el nombre de cada cliente?**
Sí: escribe `{{name}}` en el texto y cada contacto recibirá su propio nombre.

**¿Cuánto tarda Meta en aprobar una plantilla?**
Normalmente entre unos minutos y 72 horas. Verás el estado (Pendiente/Aprobada/Rechazada) en la lista de plantillas.

**¿La campaña la responde la IA?**
Si un cliente contesta tu campaña de WhatsApp, la respuesta entra como una conversación normal y la atiende el agente de IA de esa conexión.

¿Necesitas más ayuda? Escríbenos en https://parallly-chat.cloud/support
