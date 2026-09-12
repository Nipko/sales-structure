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
| Sitios de llamada encontrados | **21** |
| De ellos, que producen un mensaje cobrable | **20** |
| De ellos, presencia (no cobra Meta) | **1** |
| Archivos productores distintos | **8** |
| Sitios que **no** pasan por un carril durable | **9** |
| Sitios que pueden alcanzar WhatsApp (literal o dinámico) | **18** |
| Sitios donde **una respuesta puede volverse varios cargos** | **10** |

### Los cinco números que importan

El conteo de arriba mezcla tres cosas distintas: un botón de prueba de Telegram
que no pasa por un carril durable no es un agujero en una factura de WhatsApp.
Estas cinco filas separan lo que realmente se está midiendo, y la última es el
objetivo: **cero productores cobrables fuera del carril durable**.

| | |
|---|---|
| Sitios de llamada, en total | **21** |
| De ellos, capaces de alcanzar WhatsApp | **19** |
| De ellos, **cobrables por Meta** | **18** |
| De ellos, dentro de la frontera económica | **18** |
| De ellos, dentro del **carril durable** | **11** |

| | |
|---|---|
| Cobrables **fuera de la frontera económica** | **0** |
| Cobrables **fuera del carril durable** | **7** |
| Salidas al proveedor **sin admisión ni camino declarado** | **0** |

Los que todavía están fuera del carril durable:

| Archivo:línea | Método | Carril |
|---|---|---|
| `modules/agent-console/agent-console.service.ts:622` | `sendAgentMessage` | `inline` |
| `modules/conversations/conversations.service.ts:2029` | `sendAfterHoursMessage` | `outbound_queue` |
| `modules/conversations/conversations.service.ts:2302` | `sendResponse` | `outbound_queue` |
| `modules/conversations/conversations.service.ts:2331` | `sendPaymentLink` | `outbound_queue` |
| `modules/conversations/conversations.service.ts:2354` | `sendMedia` | `outbound_queue` |
| `modules/conversations/conversations.service.ts:2404` | `sendFlow` | `outbound_queue` |
| `modules/conversations/conversations.service.ts:5994` | `sendCollectedFlow` | `outbound_queue` |

Por carril:

| Carril | Sitios | Qué garantiza |
|---|---:|---|
| `dispatch_outbox` | 3 | publishes an already-committed `agent_dispatch_outbox` row |
| `approved_effect` | 1 | `tool_approval_effects` row a person approved |
| `operational_notice` | 6 | `operational_notice_outbox`, written in the business transaction |
| `handoff_effects` | 1 | one row per destination of one transfer |
| `outbound_queue` | 6 | legacy BullMQ `send` job; Redis is the only record |
| `inline` | 3 | straight to the adapter, on the caller's stack |

## Los que esquivan el carril durable

Un productor `outbound_queue` o `inline` no tiene fila, ni lease, ni recibo
propio: un reinicio entre la decisión y el POST pierde el efecto o lo repite, y
nada le puede negar el gasto antes de emitirlo. Son los primeros que hay que
llevar a la admisión económica.

| Archivo:línea | Método | Carril | Canales | Efectos por respuesta |
|---|---|---|---|---|
| `modules/agent-console/agent-console.service.ts:622` | `sendAgentMessage` | `inline` | dynamic | 1 (read) |
| `modules/channels/channel-management.controller.ts:519` | `testTelegram` | `inline` | telegram | 1 (read) |
| `modules/channels/channel-management.controller.ts:1483` | `testSms` | `inline` | sms | 1 (read) |
| `modules/conversations/conversations.service.ts:2029` | `sendAfterHoursMessage` | `outbound_queue` | dynamic | 1 (read) |
| `modules/conversations/conversations.service.ts:2302` | `sendResponse` | `outbound_queue` | dynamic | n(bubbles) (derived) |
| `modules/conversations/conversations.service.ts:2331` | `sendPaymentLink` | `outbound_queue` | dynamic | n(links) (derived) |
| `modules/conversations/conversations.service.ts:2354` | `sendMedia` | `outbound_queue` | dynamic | n(media) (derived) |
| `modules/conversations/conversations.service.ts:2404` | `sendFlow` | `outbound_queue` | dynamic | 1 (read) |
| `modules/conversations/conversations.service.ts:5994` | `sendCollectedFlow` | `outbound_queue` | dynamic | 1 (read) |

## Donde una respuesta se vuelve varios cargos

El sitio de envío casi nunca es donde ocurre el reparto. `enqueue` dentro de
`sendResponse` parece un efecto; el bucle que llama a `sendResponse` una vez por
burbuja está cuatrocientas líneas más arriba. Estas filas cuentan **en el
reparto**, que es donde una sola respuesta lógica se multiplica.

| Archivo:línea | Método | Carril | Efectos por respuesta | Por qué |
|---|---|---|---|---|
| `modules/appointments/appointment-payment.listener.ts:89` | `onPaid` | `operational_notice` | **n** | one effect per entry of `rows` (fan-out at line 51) |
| `modules/appointments/appointment-payment.listener.ts:107` | `onPaid` | `operational_notice` | **n** | one effect per entry of `rows` (fan-out at line 51) |
| `modules/appointments/appointment-payment.listener.ts:115` | `onPaid` | `operational_notice` | **n** | one effect per entry of `rows` (fan-out at line 51) |
| `modules/conversations/conversations.service.ts:2302` | `sendResponse` | `outbound_queue` | **n(bubbles)** | one effect per text bubble (fan-out at line 1478) |
| `modules/conversations/conversations.service.ts:2331` | `sendPaymentLink` | `outbound_queue` | **n(links)** | one effect per canonical link (fan-out at line 1495) |
| `modules/conversations/conversations.service.ts:2354` | `sendMedia` | `outbound_queue` | **n(media)** | one effect per attachment (fan-out at line 1502) |
| `modules/conversations/conversations.service.ts:6083` | `dispatchReplyThroughOutbox` | `dispatch_outbox` | **n(items)** | one committed row per item; the whole batch is one answer |
| `modules/conversations/tool-approval-effects.service.ts:36` | `schedule` | `approved_effect` | **n** | one effect per entry of `rows` (loop at the send) |
| `modules/education/education-enrollment-commands.ts:106` | `promote` | `operational_notice` | **n** | one effect per entry of `candidates` (loop at the send) |
| `modules/education/education-enrollment-commands.ts:111` | `promote` | `operational_notice` | **n** | one effect per entry of `candidates` (loop at the send) |

## Presencia, no mensajes

Se listan para que estén contados y para que nadie los sume al gasto: Meta cobra
mensajes entregados, y un indicador de "escribiendo" no lo es.

| Archivo:línea | Método | Primitiva |
|---|---|---|
| `modules/conversations/conversations.service.ts:1175` | `(top level)` | `.sendTypingIndicator` |

## Inventario completo, por archivo

### `apps/api/src/modules/agent-console/agent-console.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 622 | `sendAgentMessage` | `channelGateway.sendMessage` | `inline` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/appointments/appointment-payment.listener.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 89 | `onPaid` | `enqueueOperationalNotice` | `operational_notice` | event 'tenant_payment.succeeded' | dynamic | n | one effect per entry of `rows` (fan-out at line 51) |
| 107 | `onPaid` | `enqueueOperationalNotice` | `operational_notice` | event 'tenant_payment.succeeded' | dynamic | n | one effect per entry of `rows` (fan-out at line 51) |
| 115 | `onPaid` | `enqueueOperationalNotice` | `operational_notice` | event 'tenant_payment.succeeded' | dynamic | n | one effect per entry of `rows` (fan-out at line 51) |

### `apps/api/src/modules/channels/channel-management.controller.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 519 | `testTelegram` | `.sendTextMessage` | `inline` | HTTP POST telegram/test | telegram | 1 | one effect per invocation; no loop reaches this send |
| 1483 | `testSms` | `.sendTextMessage` | `inline` | HTTP POST sms/test | sms | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/conversations/conversations.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 1175 | `(top level)` | `.sendTypingIndicator` | `inline` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 2029 | `sendAfterHoursMessage` | `outboundQueue.enqueue` | `outbound_queue` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 2302 | `sendResponse` | `outboundQueue.enqueue` | `outbound_queue` | called by another service | dynamic | n(bubbles) | one effect per text bubble (fan-out at line 1478) |
| 2331 | `sendPaymentLink` | `outboundQueue.enqueue` | `outbound_queue` | called by another service | dynamic | n(links) | one effect per canonical link (fan-out at line 1495) |
| 2354 | `sendMedia` | `outboundQueue.enqueue` | `outbound_queue` | called by another service | dynamic | n(media) | one effect per attachment (fan-out at line 1502) |
| 2404 | `sendFlow` | `outboundQueue.enqueue` | `outbound_queue` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 5968 | `resumeOwnedDispatchBatch` | `outboundQueue.enqueueDispatch` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 5994 | `sendCollectedFlow` | `outboundQueue.enqueue` | `outbound_queue` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 6038 | `dispatchReplyThroughOutbox` | `outboundQueue.enqueueDispatch` | `dispatch_outbox` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |
| 6083 | `dispatchReplyThroughOutbox` | `dispatchOutbox.prepare` | `dispatch_outbox` | called by another service | dynamic | n(items) | one committed row per item; the whole batch is one answer |

### `apps/api/src/modules/conversations/tool-approval-effects.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 36 | `schedule` | `enqueueApprovedEffect` | `approved_effect` | called by another service | dynamic | n | one effect per entry of `rows` (loop at the send) |

### `apps/api/src/modules/education/education-enrollment-commands.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 106 | `promote` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | n | one effect per entry of `candidates` (loop at the send) |
| 111 | `promote` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | n | one effect per entry of `candidates` (loop at the send) |

### `apps/api/src/modules/gyms/gyms.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 598 | `promoteFromWaitlist` | `enqueueOperationalNotice` | `operational_notice` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

### `apps/api/src/modules/handoff/handoff.service.ts`

| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |
|---:|---|---|---|---|---|---|---|
| 396 | `executeHandoff` | `admitHandoffEffect` | `handoff_effects` | called by another service | dynamic | 1 | one effect per invocation; no loop reaches this send |

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
| `apps/api/src/modules/agent-console/agent-console.service.ts:622` | `ChannelGatewayService.sendMessage` | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:55` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:169` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:185` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/instagram/instagram.adapter.ts:214` | Graph `/{phone_number_id}/messages` POST | camino | Instagram is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:47` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:161` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:177` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/messenger/messenger.adapter.ts:207` | Graph `/{phone_number_id}/messages` POST | camino | Messenger is not billed per message by its provider |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:437` | strict dispatch transport | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:822` | `ChannelGatewayService.sendMessage` | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:856` | `ChannelGatewayService.sendMessage` | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/outbound-queue.processor.ts:990` | `ChannelGatewayService.sendMessage` | si | pide permiso antes de emitir |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:55` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:199` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:231` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:326` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:366` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:511` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:563` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:620` | Graph `/{phone_number_id}/messages` POST | camino | the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above |
| `apps/api/src/modules/whatsapp/services/whatsapp-messaging.service.ts:293` | Graph `/{phone_number_id}/messages` POST | si | pide permiso antes de emitir |

### Productores cobrables y su sumidero

| Archivo:linea | Metodo | Carril | Termina en | Admision |
|---|---|---|---|---|
| `modules/agent-console/agent-console.service.ts:622` | `sendAgentMessage` | `inline` | `modules/agent-console/agent-console.service.ts` | si |
| `modules/appointments/appointment-payment.listener.ts:89` | `onPaid` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointment-payment.listener.ts:107` | `onPaid` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/appointments/appointment-payment.listener.ts:115` | `onPaid` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:2029` | `sendAfterHoursMessage` | `outbound_queue` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:2302` | `sendResponse` | `outbound_queue` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:2331` | `sendPaymentLink` | `outbound_queue` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:2354` | `sendMedia` | `outbound_queue` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:2404` | `sendFlow` | `outbound_queue` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:5968` | `resumeOwnedDispatchBatch` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:5994` | `sendCollectedFlow` | `outbound_queue` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:6038` | `dispatchReplyThroughOutbox` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/conversations.service.ts:6083` | `dispatchReplyThroughOutbox` | `dispatch_outbox` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/conversations/tool-approval-effects.service.ts:36` | `schedule` | `approved_effect` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/education/education-enrollment-commands.ts:106` | `promote` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/education/education-enrollment-commands.ts:111` | `promote` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |
| `modules/gyms/gyms.service.ts:598` | `promoteFromWaitlist` | `operational_notice` | `modules/channels/outbound-queue.processor.ts` | si |

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

Entradas declaradas allí: **59**.

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
| `analytics.threshold_alerts` | `inline` | `live` | `modules/analytics/alerts.service.ts` |
| `appointments.booking_confirmation` | `dispatch_outbox` | `live` | `modules/appointments/appointment-notifications.service.ts` |
| `appointments.cancellation_notice` | `dispatch_outbox` | `live` | `modules/appointments/appointment-notifications.service.ts` |
| `appointments.reminders` | `dispatch_outbox` | `live` | `modules/appointments/appointment-reminders.service.ts` |
| `auth.transactional_email` | `inline` | `live` | `modules/auth/auth.service.ts` |
| `auth.two_factor_sms` | `inline` | `off` | `modules/auth/platform-sms.service.ts` |
| `automation.drip_sequence` | `dispatch_outbox` | `live` | `modules/automation/drip-sequence.service.ts` |
| `automation.http_request` | `domain_queue` | `live` | `modules/automation/handlers/http-request.handler.ts` |
| `automation.nurturing` | `dispatch_outbox` | `live` | `modules/automation/nurturing.service.ts` |
| `automation.rule_template` | `dispatch_outbox` | `live` | `modules/automation/automation-jobs.processor.ts` |
| `billing.card_and_void` | `inline` | `live` | `modules/billing/adapters/wompi.adapter.ts` |
| `billing.lifecycle_email` | `inline` | `live` | `modules/billing/billing-email.service.ts` |
| `billing.recurring_charge` | `domain_queue` | `live` | `modules/billing/recurring/processors/renewal-charge.processor.ts` |
| `billing.stripe` | `inline` | `off` | `modules/billing/adapters/stripe.adapter.ts` |
| `broadcast.campaign` | `domain_queue` | `live` | `modules/broadcast/broadcast-queue.processor.ts` |
| `calendar.event_write` | `domain_queue` | `live` | `modules/appointments/calendar-sync-outbox.service.ts` |
| `calendar.legacy_update` | `inline` | `legacy` | `modules/appointments/calendar-integration.service.ts` |
| `channel.email.inbound_reply` | `outbound_queue` | `internal_only` | `modules/channels/email/email.adapter.ts` |
| `channels.token_refresh` | `inline` | `live` | `modules/channels/instagram-token-refresh.service.ts` |
| `customer_portal.access_code` | `inline` | `live` | `modules/customer-portal/customer-portal.service.ts` |
| `external_crm.sync` | `domain_queue` | `live` | `modules/external-crm/external-crm.service.ts` |
| `feature_requests.status_email` | `inline` | `live` | `modules/feature-requests/feature-requests.service.ts` |
| `fiscal.invoice_email` | `domain_queue` | `live` | `modules/fiscal/fiscal-email.service.ts` |
| `fiscal.invoice_issue` | `domain_queue` | `live` | `modules/fiscal/adapters/factus.adapter.ts` |
| `handoff.agent_sms` | `inline` | `off` | `modules/sms-notifications/sms-notification-listener.service.ts` |
| `handoff.push` | `inline` | `live` | `modules/push/push-listener.service.ts` |
| `handoff.sla_escalation.email` | `inline` | `live` | `modules/agent-console/agent-availability.service.ts` |
| `handoff.slack` | `inline` | `live` | `modules/slack/slack-listener.service.ts` |
| `human.email_template.test_send` | `inline` | `live` | `modules/email-templates/email-templates.service.ts` |
| `human.whatsapp.manual_send` | `inline` | `live` | `modules/whatsapp/whatsapp.controller.ts` |
| `identity.verification_code` | `inline` | `live` | `modules/conversations/chat-identity.service.ts` |
| `integrations.commerce_readonly` | `inline` | `internal_only` | `modules/vertical-integrations/vertical-integrations.service.ts` |
| `integrations.outbox_scaffolding` | `domain_queue` | `off` | `modules/integrations/integration-outbox.worker.ts` |
| `invitations.user_invite` | `inline` | `live` | `modules/invitations/invitations.service.ts` |
| `mcp.remote_tool_call` | `inline` | `live` | `modules/mcp/mcp-client.service.ts` |
| `meta_compliance.data_request` | `inline` | `live` | `modules/meta-compliance/meta-compliance.service.ts` |
| `offboarding.external_revocation` | `inline` | `live` | `modules/offboarding/offboarding.service.ts` |
| `ops.coupon_alerts` | `inline` | `internal_only` | `modules/health/coupon-alert.listener.ts` |
| `ops.platform_alerts` | `inline` | `internal_only` | `modules/health/platform-monitor.service.ts` |
| `payments.outcome_notice` | `outbound_queue` | `live` | `modules/conversations/payment-outcome-notifier.service.ts` |
| `payments.tenant_payment_link` | `inline` | `live` | `modules/tenant-payments/tenant-payments.service.ts` |
| `public_api.webhook_subscriptions` | `inline` | `live` | `modules/public-api/webhook-subscription.service.ts` |
| `recall.win_back` | `dispatch_outbox` | `live` | `modules/recall/recall.service.ts` |
| `reviews.gbp_reply` | `inline` | `live` | `modules/reviews/reviews.service.ts` |
| `tenant.outbound_webhooks` | `inline` | `live` | `modules/webhooks/webhooks.service.ts` |
| `verticals.service_request` | `inline` | `live` | `modules/verticals/service-request.listener.ts` |
| `whatsapp.business_profile` | `inline` | `live` | `modules/whatsapp/services/whatsapp-connection.service.ts` |
| `whatsapp.template_management` | `inline` | `live` | `modules/whatsapp/services/whatsapp-template.service.ts` |

## Método y sus límites

El barrido busca **sitios de llamada** de estas primitivas:

| Primitiva | Carril |
|---|---|
| `outboundQueue.enqueueDispatch(` | `dispatch_outbox` |
| `dispatchOutbox.prepare(` | `dispatch_outbox` |
| `prepareDispatchBatch(` | `dispatch_outbox` |
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
