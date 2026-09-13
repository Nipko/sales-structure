<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: node apps/api/scripts/outbound-producer-inventory.cjs
     Every row below is a call site the generator found in the source tree. -->

# Inventario de productores de mensajes salientes

Generado desde el código por `apps/api/scripts/outbound-producer-inventory.cjs`.

Desde el 1 de octubre de 2026 Meta cobra **cada mensaje de servicio entregado**
en WhatsApp. Cada efecto remoto separado es un cargo separado: tres burbujas en
lugar de una son tres cargos por la misma respuesta. Este archivo dice cuántos
lugares del repositorio pueden producir uno, por qué carril salen y cuántos
efectos puede llegar a producir **una sola respuesta lógica** en cada uno.

## Resumen

| | |
|---|---|
| Sitios de llamada encontrados | **31** |
| De ellos, que producen un mensaje cobrable | **30** |
| De ellos, presencia (no cobra Meta) | **1** |
| Archivos productores distintos | **22** |
| Sitios que **no** pasan por un carril durable | **1** |
| Sitios que pueden alcanzar WhatsApp (literal o dinámico) | **29** |
| Sitios donde **una respuesta puede volverse varios cargos** | **10** |

### Los cinco números que importan

El conteo de arriba mezcla tres cosas distintas: un botón de prueba de Telegram
que no pasa por un carril durable no es un agujero en una factura de WhatsApp.
Estas cinco filas separan lo que realmente se está midiendo, y la última es el
objetivo: **cero productores cobrables fuera del carril durable**.

| | |
|---|---|
| Sitios de llamada, en total | **31** |
| De ellos, capaces de alcanzar WhatsApp | **30** |
| De ellos, **cobrables por Meta** | **29** |
| De ellos, dentro de la frontera económica | **29** |
| De ellos, dentro del **carril durable** | **29** |

| | |
|---|---|
| Cobrables **fuera de la frontera económica** | **0** |
| Cobrables **fuera del carril durable** | **0** |
| Salidas al proveedor **sin admisión ni camino declarado** | **0** |

Por carril:

| Carril | Sitios | Qué garantiza |
|---|---:|---|
| `dispatch_outbox` | 14 | publishes an already-committed `agent_dispatch_outbox` row |
| `approved_effect` | 1 | `tool_approval_effects` row a person approved |
| `operational_notice` | 13 | `operational_notice_outbox`, written in the business transaction |
| `handoff_effects` | 1 | one row per destination of one transfer |
| `inline` | 1 | straight to the adapter, on the caller's stack |

## Los que esquivan el carril durable

Un productor `outbound_queue` o `inline` no tiene fila, ni lease, ni recibo
propio: un reinicio entre la decisión y el POST pierde el efecto o lo repite, y
nada le puede negar el gasto antes de emitirlo. Son los primeros que hay que
llevar a la admisión económica.

| Archivo:línea | Método | Carril | Canales | Efectos por respuesta |
|---|---|---|---|---|
| `modules/channels/channel-management.controller.ts:530` | `testTelegram` | `inline` | telegram | 1 (read) |

## Donde una respuesta se vuelve varios cargos

El sitio de envío casi nunca es donde ocurre el reparto. `enqueue` dentro de
`sendResponse` parece un efecto; el bucle que llama a `sendResponse` una vez por
burbuja está cuatrocientas líneas más arriba. Estas filas cuentan **en el
reparto**, que es donde una sola respuesta lógica se multiplica.

| Archivo:línea | Método | Carril | Efectos por respuesta | Por qué |
|---|---|---|---|---|
| `modules/analytics/alerts.service.ts:294` | `fireAlert` | `operational_notice` | **n(recipients)** | one effect per recipient — a campaign, not one answer (loop at the send) |
| `modules/appointments/appointment-payment.listener.ts:89` | `onPaid` | `operational_notice` | **n** | one effect per entry of `rows` (fan-out at line 51) |
| `modules/appointments/appointment-payment.listener.ts:107` | `onPaid` | `operational_notice` | **n** | one effect per entry of `rows` (fan-out at line 51) |
| `modules/appointments/appointment-payment.listener.ts:115` | `onPaid` | `operational_notice` | **n** | one effect per entry of `rows` (fan-out at line 51) |
| `modules/conversations/conversations.service.ts:6015` | `dispatchReplyThroughOutbox` | `dispatch_outbox` | **n(items)** | one committed row per item; the whole batch is one answer |
| `modules/conversations/tool-approval-effects.service.ts:37` | `schedule` | `approved_effect` | **n** | one effect per entry of `rows` (loop at the send) |
| `modules/education/education-enrollment-commands.ts:166` | `promote` | `operational_notice` | **n** | one effect per entry of `candidates` (loop at the send) |
| `modules/education/education-enrollment-commands.ts:171` | `promote` | `operational_notice` | **n** | one effect per entry of `candidates` (loop at the send) |
| `modules/orders/catalog-order-commands.ts:113` | `create` | `operational_notice` | **n** | one effect per entry of `terms.items` (loop at the send) |
| `modules/recall/recall.service.ts:250` | `recallOne` | `dispatch_outbox` | **n(recipients)** | one effect per recipient — a campaign, not one answer (fan-out at line 153) |

## Presencia, no mensajes

Se listan para que estén contados y para que nadie los sume al gasto: Meta cobra
mensajes entregados, y un indicador de "escribiendo" no lo es.

| Archivo:línea | Método | Primitiva |
|---|---|---|
| `modules/conversations/conversations.service.ts:1205` | `(top level)` | `.sendTypingIndicator` |

## Inventario completo, por archivo

### `apps/api/src/modules/agent-console/agent-console.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 568 | `replyThroughOutbox` | `dispatch.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/analytics/alerts.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 294 | `fireAlert` | `enqueueOperationalNotice` | `operational_notice` | cron '*/15 * * * *' | dynamic | n(recipients) | one effect per recipient — a campaign, not one answer (loop at the send) |

### `apps/api/src/modules/appointments/appointment-notifications.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 667 | `dispatchNotice` | `proactive.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/appointments/appointment-payment.listener.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 89 | `onPaid` | `enqueueOperationalNotice` | `operational_notice` | event 'tenant_payment.succeeded' | dynamic | n | one effect per entry of `rows` (fan-out at line 51) |
| 107 | `onPaid` | `enqueueOperationalNotice` | `operational_notice` | event 'tenant_payment.succeeded' | dynamic | n | one effect per entry of `rows` (fan-out at line 51) |
| 115 | `onPaid` | `enqueueOperationalNotice` | `operational_notice` | event 'tenant_payment.succeeded' | dynamic | n | one effect per entry of `rows` (fan-out at line 51) |

### `apps/api/src/modules/appointments/appointment-reminders.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 166 | `dispatchTemplate` | `proactive.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/appointments/appointments.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 435 | `create` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 734 | `createRecurring` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/automation/automation-jobs.processor.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 432 | `handleSendTemplate` | `proactive.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/automation/drip-sequence.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 799 | `executeStepAction` | `proactive.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/automation/nurturing.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 965 | `dispatch` | `proactive.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/broadcast/broadcast-queue.processor.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 205 | `dispatchWhatsApp` | `proactive.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/channels/channel-management.controller.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 530 | `testTelegram` | `.sendTextMessage` | `inline` | HTTP POST telegram/test | telegram | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/conversations/conversations.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 553 | `replyOnceThroughOutbox` | `proactiveDispatch.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 1205 | `(top level)` | `.sendTypingIndicator` | `inline` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 5921 | `resumeOwnedDispatchBatch` | `outboundQueue.enqueueDispatch` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 5972 | `dispatchReplyThroughOutbox` | `outboundQueue.enqueueDispatch` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 6015 | `dispatchReplyThroughOutbox` | `dispatchOutbox.prepare` | `dispatch_outbox` | called by another service | dynamic | n(items) | one committed row per item; the whole batch is one answer |

### `apps/api/src/modules/conversations/payment-outcome-notifier.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 147 | `notifyCustomer` | `dispatch.send` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/conversations/tool-approval-effects.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 37 | `schedule` | `enqueueApprovedEffect` | `approved_effect` | called by another service | dynamic | n | one effect per entry of `rows` (loop at the send) |

### `apps/api/src/modules/education/education-enrollment-commands.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 166 | `promote` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | n | one effect per entry of `candidates` (loop at the send) |
| 171 | `promote` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | n | one effect per entry of `candidates` (loop at the send) |

### `apps/api/src/modules/gyms/gyms.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 655 | `promoteFromWaitlist` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/handoff/handoff.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 397 | `executeHandoff` | `admitHandoffEffect` | `handoff_effects` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/orders/catalog-order-commands.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 113 | `create` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | n | one effect per entry of `terms.items` (loop at the send) |
| 227 | `advance` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/recall/recall.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 250 | `recallOne` | `proactive.send` | `dispatch_outbox` | called by another service | dynamic | n(recipients) | one effect per recipient — a campaign, not one answer (fan-out at line 153) |

### `apps/api/src/modules/tours/tours.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 441 | `createBooking` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/vacation-rental/properties.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 723 | `createBooking` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/whatsapp/whatsapp.controller.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 910 | `dispatchRest` | `dispatch.send` | `dispatch_outbox` | HTTP POST send/location | dynamic | 1 | one effect per invocation; no loop reaches this send |

## La frontera economica: cero productores cobrables fuera de ella

Desde el 1 de octubre de 2026 cada mensaje de servicio entregado en WhatsApp es
un cargo contra la WABA del propio negocio. El objetivo no es "menos bypasses":
es **cero productores WhatsApp cobrables fuera del carril economico**. Un numero
que tiene que quedarse en cero necesita una comprobacion que falle, no un
documento que envejezca — por eso esta seccion la genera el mismo barrido y
`--check` termina en 1 si deja de estar vacia.

La clasificacion es **estructural, no nominal**. No hay una lista de metodos
aprobados: para cada sitio de llamada se resuelve **donde sale realmente el
mensaje del proceso** — el carril lleva al procesador, y una llamada inline se
resuelve leyendo el tipo declarado del receptor y buscando esa clase en el
arbol — y se pregunta si **ese archivo** contiene una llamada a la autoridad
economica, con los comentarios y las plantillas quitados. Un productor nuevo
queda clasificado la primera vez que corre esto; borrar la admision de un
sumidero convierte en violacion a todos los productores que salen por ahi.

### Violaciones

**Ninguna.** Todo productor cobrable que puede alcanzar WhatsApp termina en un
archivo que pide permiso antes de emitir el efecto.

### Los sumideros, y la prueba de que piden permiso

Un sumidero es un archivo donde una peticion sale de verdad hacia el proveedor.
La columna "admision" no repite lo que dice un comentario: es el resultado de
buscar una llamada a la autoridad economica en el codigo del archivo.

| Archivo:linea | Que sale | Admision | Nota |
|---|---|---|---|
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:55` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:169` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:185` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:214` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:47` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:161` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:177` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:207` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:559` | strict dispatch transport | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:1012` | `ChannelGatewayService.sendMessage` | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:1068` | `ChannelGatewayService.sendMessage` | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:1273` | `ChannelGatewayService.sendMessage` | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:67` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:211` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:245` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:340` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:381` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:527` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:580` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:638` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/whatsapp/services/whatsapp-messaging.service.ts:311` | Graph `/{phone_number_id}/messages` POST | si | pide permiso antes de emitir |

### Productores cobrables y su sumidero

| Archivo:linea | Metodo | Carril | Termina en | Admision |
|---|---|---|---|---|
| `modules/agent-console/agent-console.service.ts:568` | `replyThroughOutbox` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/analytics/alerts.service.ts:294` | `fireAlert` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointment-notifications.service.ts:667` | `dispatchNotice` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointment-payment.listener.ts:89` | `onPaid` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointment-payment.listener.ts:107` | `onPaid` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointment-payment.listener.ts:115` | `onPaid` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointment-reminders.service.ts:166` | `dispatchTemplate` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointments.service.ts:435` | `create` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointments.service.ts:734` | `createRecurring` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/automation/automation-jobs.processor.ts:432` | `handleSendTemplate` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/automation/drip-sequence.service.ts:799` | `executeStepAction` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/automation/nurturing.service.ts:965` | `dispatch` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/broadcast/broadcast-queue.processor.ts:205` | `dispatchWhatsApp` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:553` | `replyOnceThroughOutbox` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:5921` | `resumeOwnedDispatchBatch` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:5972` | `dispatchReplyThroughOutbox` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:6015` | `dispatchReplyThroughOutbox` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/payment-outcome-notifier.service.ts:147` | `notifyCustomer` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/tool-approval-effects.service.ts:37` | `schedule` | `approved_effect` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/education/education-enrollment-commands.ts:166` | `promote` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/education/education-enrollment-commands.ts:171` | `promote` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/gyms/gyms.service.ts:655` | `promoteFromWaitlist` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/orders/catalog-order-commands.ts:113` | `create` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/orders/catalog-order-commands.ts:227` | `advance` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/recall/recall.service.ts:250` | `recallOne` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/tours/tours.service.ts:441` | `createBooking` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/vacation-rental/properties.service.ts:723` | `createBooking` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/whatsapp/whatsapp.controller.ts:910` | `dispatchRest` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |

### Lo que esta comprobacion no puede ver

1. Un receptor cuyo tipo no se declara en el archivo que lo usa: se reporta
   **sin resolver**, que cuenta como violacion. Eso es deliberado — no resolver
   nunca puede leerse como aprobar.
2. Un envio construido en tiempo de ejecucion (un `eval`, una URL armada por
   partes en otra variable). No existe hoy en el arbol, y si aparece hay que
   agregarlo a `PROVIDER_EGRESS`.
3. Si el gasto queda efectivamente **negado**: eso depende de la configuracion
   por tenant (`observe` frente a `enforce`), no del codigo. Esta seccion prueba
   que se **pide permiso**, no cual es la respuesta.

## Contraste con el inventario declarado

`modules/channels/external-effect-inventory.ts` mantiene una lista curada de
productores de efectos externos. Esta sección la compara **en las dos
direcciones**: lo que el barrido encuentra y ella no nombra, y lo que ella
nombra y el barrido no encuentra. Un desacuerdo no es un error de ninguno de
los dos — es exactamente el sitio donde hay que ir a mirar.

Entradas declaradas allí: **64**.

### Encontrados por el barrido y no declarados como productores

_Ninguno._

### Declarados y no encontrados por el barrido

Estos **no son productores de mensajes de canal**: escriben en un tercero (un
calendario, un cobro, un CRM), envían correo o SMS, o llaman a un webhook. El
barrido sólo busca las puertas de mensajería, así que su ausencia aquí es
esperada y su clasificación queda **fuera del alcance de este generador**.

| id declarado | carril | estado | fuente |
|---|---|---|---|
| `analytics.scheduled_reports` | `inline` | `live` | `modules/analytics/scheduled-reports.service.ts` |
| `auth.transactional_email` | `inline` | `live` | `modules/auth/auth.service.ts` |
| `auth.two_factor_sms` | `inline` | `off` | `modules/auth/platform-sms.service.ts` |
| `automation.http_request` | `domain_queue` | `live` | `modules/automation/handlers/http-request.handler.ts` |
| `billing.card_and_void` | `inline` | `live` | `modules/billing/adapters/wompi.adapter.ts` |
| `billing.lifecycle_email` | `inline` | `live` | `modules/billing/billing-email.service.ts` |
| `billing.recurring_charge` | `domain_queue` | `live` | `modules/billing/recurring/processors/renewal-charge.processor.ts` |
| `billing.stripe` | `inline` | `off` | `modules/billing/adapters/stripe.adapter.ts` |
| `calendar.event_write` | `domain_queue` | `live` | `modules/appointments/calendar-sync-outbox.service.ts` |
| `calendar.legacy_update` | `inline` | `legacy` | `modules/appointments/calendar-integration.service.ts` |
| `channel.email.inbound_reply` | `outbound_queue` | `internal_only` | `modules/channels/email/email.adapter.ts` |
| `channels.token_refresh` | `inline` | `live` | `modules/channels/instagram-token-refresh.service.ts` |
| `customer_portal.access_code` | `inline` | `live` | `modules/customer-portal/customer-portal.service.ts` |
| `external_crm.sync` | `domain_queue` | `live` | `modules/external-crm/external-crm.service.ts` |
| `feature_requests.status_email` | `inline` | `live` | `modules/feature-requests/feature-requests.service.ts` |
| `fiscal.invoice_email` | `domain_queue` | `live` | `modules/fiscal/fiscal-email.service.ts` |
| `fiscal.invoice_issue` | `domain_queue` | `live` | `modules/fiscal/adapters/factus.adapter.ts` |
| `handoff.agent_sms` | `handoff_effects` | `off` | `modules/sms-notifications/sms-notification-listener.service.ts` |
| `handoff.push` | `handoff_effects` | `live` | `modules/push/push-listener.service.ts` |
| `handoff.sla_escalation.email` | `operational_notice` | `live` | `modules/agent-console/agent-availability.service.ts` |
| `handoff.slack` | `handoff_effects` | `live` | `modules/slack/slack-listener.service.ts` |
| `human.email_template.test_send` | `inline` | `live` | `modules/email-templates/email-templates.service.ts` |
| `identity.verification_code` | `inline` | `live` | `modules/conversations/chat-identity.service.ts` |
| `integrations.commerce_readonly` | `inline` | `internal_only` | `modules/vertical-integrations/vertical-integrations.service.ts` |
| `integrations.outbox_scaffolding` | `domain_queue` | `off` | `modules/integrations/integration-outbox.worker.ts` |
| `invitations.user_invite` | `inline` | `live` | `modules/invitations/invitations.service.ts` |
| `mcp.remote_tool_call` | `tool_ledger` | `live` | `modules/mcp/mcp-client.service.ts` |
| `meta_compliance.data_request` | `inline` | `live` | `modules/meta-compliance/meta-compliance.service.ts` |
| `offboarding.external_revocation` | `inline` | `live` | `modules/offboarding/offboarding.service.ts` |
| `ops.coupon_alerts` | `inline` | `internal_only` | `modules/health/coupon-alert.listener.ts` |
| `ops.platform_alerts` | `inline` | `internal_only` | `modules/health/platform-monitor.service.ts` |
| `payments.tenant_payment_link` | `inline` | `live` | `modules/tenant-payments/tenant-payments.service.ts` |
| `public_api.webhook_subscriptions` | `delivery_outbox` | `live` | `modules/public-api/webhook-subscription.service.ts` |
| `push.operational_events` | `inline` | `live` | `modules/push/push-listener.service.ts` |
| `reviews.gbp_reply` | `inline` | `live` | `modules/reviews/reviews.service.ts` |
| `tenant.outbound_webhooks` | `inline` | `live` | `modules/webhooks/webhooks.service.ts` |
| `verticals.service_request` | `operational_notice` | `live` | `modules/home-services/home-services.service.ts` |
| `whatsapp.business_profile` | `inline` | `live` | `modules/whatsapp/services/whatsapp-connection.service.ts` |
| `whatsapp.template_management` | `inline` | `live` | `modules/whatsapp/services/whatsapp-template.service.ts` |

## Método y sus límites

El barrido busca **sitios de llamada** de estas primitivas:

| Primitiva | Carril |
|---|---|
| `outboundQueue.enqueueDispatch(` | `dispatch_outbox` |
| `dispatchOutbox.prepare(` | `dispatch_outbox` |
| `prepareDispatchBatch(` | `dispatch_outbox` |
| `proactive.send(` | `dispatch_outbox` |
| `proactiveDispatch.send(` | `dispatch_outbox` |
| `dispatch.send(` | `dispatch_outbox` |
| `enqueueApprovedEffect(` | `approved_effect` |
| `enqueueOperationalNotice(` | `operational_notice` |
| `admitHandoffEffect(` | `handoff_effects` |
| `outboundQueue.enqueue(` | `outbound_queue` |
| `channelGateway.sendMessage(` | `inline` |
| `transport.sendStrict(` | `dispatch_outbox` |
| `.sendTextMessage(` | `inline` |
| `.sendMediaMessage(` | `inline` |
| `.sendTemplate(` | `inline` |
| `.sendTemplateMessage(` | `inline` |
| `.sendInteractiveMessage(` | `inline` |
| `.sendFlowMessage(` | `inline` |
| `.sendLocationMessage(` | `inline` |
| `.sendTypingIndicator(` | `inline` |

Se excluyen por ruta los archivos que **definen** una primitiva (el camino, no
el conductor):

- `modules/channels/whatsapp/whatsapp.adapter.ts`
- `modules/channels/instagram/instagram.adapter.ts`
- `modules/channels/messenger/messenger.adapter.ts`
- `modules/channels/telegram/telegram.adapter.ts`
- `modules/channels/email/email.adapter.ts`
- `modules/channels/sms/sms.adapter.ts`
- `modules/channels/channel-gateway.service.ts`
- `modules/channels/outbound-queue.service.ts`
- `modules/channels/outbound-queue.processor.ts`
- `modules/channels/agent-dispatch-outbox.ts`
- `modules/channels/agent-dispatch-outbox.store.ts`
- `modules/channels/proactive-dispatch.service.ts`
- `modules/channels/dispatch-items.ts`
- `modules/channels/external-effect-inventory.ts`
- `modules/channels/strict-dispatch.ts`
- `modules/widget/widget.adapter.ts`
- `modules/handoff/handoff-effects.ts`
- `modules/operational-notices/operational-notice-outbox.ts`
- `modules/sms-notifications/sms-sender.service.ts`

Lo que este generador **no** puede ver, dicho aquí y no en una nota al pie,
porque un productor que se le escape es un productor que gasta en silencio:

1. Una primitiva de salida con un nombre que no está en la tabla de arriba. El
   contraste con el inventario declarado existe justamente para eso.
2. Un efecto en un tercero que no es un mensaje de canal (HTTP de automatización,
   una tool MCP que escribe, un cobro). Son efectos, no mensajes de WhatsApp.
3. Procesos fuera de `apps/api` y `apps/whatsapp`. El dashboard, la app móvil y
   la landing no envían: llaman a esta API.
4. Un conteo de efectos marcado `unknown` o `n`: depende de datos de ejecución.
   El generador no los adivina; decir "1" ahí sería subestimar el gasto.
