---
id: inbox
title: "Bandeja de entrada y atención humana"
routes: ["/admin/inbox", "/admin/settings/macros", "/admin/settings/integrations/sms-notifications"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["inbox", "bandeja de entrada", "handoff", "tomar conversacion", "atender cliente", "agente humano", "devolver al bot", "notas internas", "macros", "respuestas rapidas", "posponer", "snooze", "asignar conversacion", "resolver conversacion", "copiloto", "resumen IA", "reescribir mensaje", "sugerencia IA", "notificaciones", "campana", "escalacion", "sin atender", "180 minutos", "vuelve a la ia"]
---

# Bandeja de entrada y atención humana

La **Bandeja de conversaciones** es donde tu equipo ve los chats en tiempo real y donde una persona puede tomar el control cuando la IA necesita ayuda. La encuentras en **Esenciales → Conversaciones**.

La pantalla tiene tres zonas: a la izquierda la lista de conversaciones (con filtros como **Todos**, **Míos**, **Sin asignar**, **Handoff** y **Resueltas**, además de filtros por canal), al centro el hilo de mensajes y a la derecha el panel del contacto con su información, notas y citas. Aquí llegan las conversaciones de tus superficies operativas: WhatsApp, Instagram, Messenger, Telegram y el chat de tu sitio web.

## Cómo tomar una conversación (handoff)

Cuando un cliente pide hablar con una persona, o la IA detecta que no puede resolver el caso, la conversación queda "esperando humano" y la IA se pausa.

1. Abre la conversación desde el Inbox (las que esperan atención se destacan en la lista).
2. Verás un aviso naranja: **Atención humana requerida** — "El asistente de IA ha sido pausado. El cliente está esperando respuesta de un humano."
3. Haz clic en **Atender conversación**. La conversación queda asignada a ti y ya puedes escribir directamente al cliente.

También puedes tomar con **Asignarme** una conversación que esté sin responsable. Si ya está asignada a otra persona, solo un administrador o supervisor puede reasignarla. Cuando la conversación queda contigo, la IA no responde: el cliente habla solo contigo.

## El resumen de IA al tomar una conversación

Para que no tengas que leer todo el historial, al abrir una conversación escalada verás un recuadro con el **Resumen de la conversación (IA)**: qué pidió el cliente, qué se habló y por qué se escaló.

Además, en cualquier momento puedes pulsar **Resumir** (sobre el cuadro de escritura) y el copiloto te muestra un resumen al instante, con la **Intención del cliente** y los temas **Pendientes** por resolver.

## Cómo devolver la conversación a la IA

Cuando ya resolviste el caso:

1. Haz clic en **Resolver** en el encabezado de la conversación.
2. Tu atención termina, la conversación se libera y el asistente de IA vuelve a encargarse de los próximos mensajes de ese cliente.

Las conversaciones sin actividad durante 72 horas se marcan como resueltas automáticamente para mantener tu bandeja limpia. Puedes verlas con el filtro **Resueltas**; ahí el historial es de solo lectura, y si necesitas retomarla usa **Reabrir conversación**.

**Si nadie la toma:** una conversación escalada que pasa **180 minutos (3 horas)** sin que ninguna persona del equipo responda, y con el cliente todavía esperando, vuelve sola a la IA: se libera el responsable y el agente retoma la charla. Es un piso de seguridad para que el cliente no quede en silencio, no un castigo ni una resolución: la conversación sigue en tu bandeja y puedes tomarla de nuevo cuando quieras.

## Copiloto del agente: sugerencias y reescritura

El copiloto te ayuda a responder mejor y más rápido:

- **Sugerencia IA**: en conversaciones que estás atendiendo, el copiloto propone una respuesta lista para usar. Pulsa **Usar sugerencia** para llevarla al cuadro de escritura (puedes editarla antes de enviar) o **Regenerar** para pedir otra.
- **Borrador de IA**: a veces la IA deja preparado un borrador para tu aprobación. Revísalo y elige **Usar borrador** o **Descartar**. Nada se envía sin tu confirmación.
- **Reescribir**: escribe tu respuesta como te salga y deja que el copiloto la pula. Junto al cuadro de escritura, pulsa **Reescribir** y elige el tono: **Profesional**, **Amigable**, **Empático**, **Más corto**, **Ampliar** o **Corregir ortografía**.

## Respuestas rápidas y macros

- **Respuestas rápidas**: en el cuadro de mensaje, escribe **/** y aparecerá la lista de respuestas predefinidas de tu equipo. Sigue escribiendo para filtrar y selecciona una; los datos del cliente (como su nombre) se completan solos.
- **Macros**: son secuencias de acciones que se ejecutan con un clic (por ejemplo: etiquetar, asignar, dejar una nota y enviar una respuesta, todo junto). En la conversación, abre el menú de acciones (⋯) y elige **Macros**.

Para crear macros, un administrador o supervisor va a **Configuración → Macros** y pulsa **Nueva macro**. Cada macro combina acciones como **Asignar a agente**, **Agregar etiqueta**, **Cambiar estado**, **Agregar nota** o **Enviar respuesta predefinida**, y puede ser de visibilidad **Personal** (solo tuya) o de **Equipo**.

## Notas internas

Las notas internas son comentarios entre colegas que el cliente nunca ve.

1. En la conversación, abre el menú de acciones (⋯) y elige **Notas internas**.
2. Escribe en el campo **Agregar nota interna...** y guarda.
3. La nota queda visible para todo el equipo en esa conversación y también en el historial del contacto.

Úsalas para dejar contexto antes de pasar el caso a otra persona ("cliente VIP, ya se le ofreció el descuento del 10%").

## Posponer una conversación (snooze)

Si un caso no puede avanzar ahora ("llámame el lunes"), no lo dejes ocupando tu bandeja:

1. Abre el menú de acciones (⋯) y elige **Posponer**.
2. Elige cuándo debe volver: **1 hora**, **3 horas**, **Mañana 9am** o **Próximo lunes**.
3. La conversación se oculta de la vista activa y reaparece automáticamente en la fecha elegida.

## Asignación entre agentes

- Cada conversación puede tener un responsable. Usa el filtro **Míos** para ver solo lo tuyo y **Sin asignar** para encontrar conversaciones huérfanas.
- Cualquier miembro habilitado del equipo puede tomar una conversación **sin asignar** con **Asignarme**; si ya estaba con otra persona, solo un administrador o supervisor puede reasignarla.
- Si configuras **habilidades (skills)** en los perfiles de tu equipo (menú **Usuarios**), Parallly enruta automáticamente cada escalamiento a la persona adecuada — por ejemplo, casos en inglés al agente que habla inglés.
- Las macros también pueden asignar a un agente específico como parte de sus acciones.
- Si una conversación escalada pasa varios minutos sin respuesta, los supervisores reciben un aviso en el panel. Ese aviso llama la atención; lo que realmente evita el silencio es el regreso automático a la IA a los 180 minutos.

La cantidad de personas que pueden usar Parallly depende de la capacidad de tu cuenta; consulta el uso y límite vigentes en **Plan y facturación**.

## Notificaciones

La **campana** en la barra superior concentra los avisos y los agrupa por categoría: **Mensajes**, **Transferencias** (escalamientos a humano), **Privacidad**, **Citas**, **Automatización**, **Órdenes** y **Sistema**. Los escalamientos directos (el cliente pidió un humano) se destacan en rojo; los escalamientos por baja confianza de la IA, en amarillo; y las alertas de supervisor llegan con sonido.

Si los avisos por SMS están habilitados para tu cuenta, actívalos en **Configuración → Canales e integraciones → Avisos por SMS**.

## Trabajo en equipo sin pisarse

Si dos personas abren la misma conversación a la vez, ambas ven una etiqueta de color con el nombre de la otra debajo del encabezado. Así evitas responderle al mismo cliente por duplicado. Funciona solo, sin configurar nada: la etiqueta desaparece cuando la otra persona cierra la conversación.

## Preguntas frecuentes

**¿La IA sigue respondiendo mientras atiendo yo?**
No. Desde que tomas la conversación, la IA queda pausada y el cliente habla solo contigo. Vuelve a activarse cuando pulsas **Resolver**.

**¿El cliente ve las notas internas o los resúmenes de IA?**
No. Las notas, los resúmenes y las sugerencias del copiloto son solo para tu equipo. Al cliente únicamente le llega lo que tú envías desde el cuadro de mensaje.

**¿Qué pasa si nadie toma una conversación escalada?**
Sigue apareciendo en el filtro de pendientes y los supervisores reciben un aviso en el panel para intervenir. Ese aviso no la retiene indefinidamente: si nadie del equipo respondió y el cliente sigue esperando, a los **180 minutos (3 horas)** la conversación **vuelve a la IA**, queda sin responsable y el agente retoma. Si quieres que la atienda una persona, tómala antes de ese plazo.

**¿Puedo hacer que ciertos casos lleguen siempre a la misma persona?**
Sí. Configura habilidades en los perfiles del equipo (menú **Usuarios**) para el enrutamiento automático, o crea una macro con la acción **Asignar a agente**.

**¿Una conversación pospuesta se pierde si el cliente escribe antes?**
No se pierde: la conversación reaparece automáticamente en la fecha que elegiste y el historial completo se conserva.

**¿Llegan mensajes de SMS a esta bandeja?**
No. La bandeja recibe WhatsApp, Instagram, Messenger, Telegram y el chat de tu sitio web. Los SMS solo salen como notificación de una vía a tus clientes, o como aviso a tu equipo; no abren una conversación aquí.

¿Necesitas más ayuda? Escríbenos en https://parallly-chat.cloud/support
