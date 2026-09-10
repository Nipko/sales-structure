# Bloqueos del despacho durable, cerrados

8 de septiembre de 2026. Cierre del bloque inmediato obligatorio de la [directiva](../../handoffs/2026-09-08/claude-complete-plan-directive.md): los nueve riesgos que la revisión encontró sobre `64dc8d75`..`ec430c54` y que bloqueaban cualquier piloto. Sin push, sin despliegue, sin llamadas a proveedores reales.

## Commits

| Commit | Bloqueo cerrado | Validación sobre el índice exacto |
| --- | --- | --- |
| `4ec64a38` | Propiedad del lote ante COMMIT incierto y cambios del switch | 3 suites / 55 pruebas, dos PostgreSQL |
| `bfc08a1a` | Un solo reloj de reintentos (PostgreSQL), no dos | 3 suites / 24 pruebas, **BullMQ + Valkey reales** |
| `0635ac81` | Secuencia real de los efectos del lote | 7 suites / 87 pruebas, cola real y bootstrap |
| `6163de30` | Recibos del proveedor ligados al historial; estados verdaderos | Modelo probado con PostgreSQL; cableado del webhook con suite propia |
| `d31070f8` | Efectos internos del handoff recuperables | 5 suites / 73 pruebas, PostgreSQL real |
| `42c9282f` | Clasificación de errores por proveedor y código | 3 suites / 40 pruebas |
| `74fd1e1a` | Rollout seguro y operable | 3 suites / 28 pruebas, incluye bootstrap |
| `50e228f4` | Reconciliación operativa real + runbook | 2 suites / 59 pruebas, PostgreSQL real |

Los conteos se solapan; no sumarlos como cobertura nueva.

## Qué estaba mal y qué lo reemplaza

**1. El lote no era dueño de su respuesta.** El productor consultaba el interruptor *antes* de preguntar si ya existía un lote, y convertía cualquier excepción de `prepare` en permiso para usar la ruta legacy. Un ACK de COMMIT perdido dejaba el lote confirmado y la ruta vieja entregaba una segunda copia; un replay con el switch apagado hacía lo mismo sin fallo alguno. Ahora la propiedad se decide primero y el switch **solo** decide si se crea un lote nuevo. Tras una excepción ambigua se vuelve a preguntar bajo la identidad del lote; solo una ausencia demostrada libera la respuesta, y una respuesta ilegible **falla cerrado**. El binding se comprueba, no se asume: otra conversación, contacto, canal, cuenta o destinatario es conflicto, igual que dos `batch_id` para un inbound o índices no contiguos.

**2. Había dos relojes.** La fila quedaba `failed` con `available_at` futuro, el reintento de BullMQ llegaba antes, la admisión respondía `dispatch_not_available_yet`, el job **completaba**, y la recuperación encontraba un job retenido y no republicaba nunca. Ahora toda espera deliberada es `moveToDelayed` a la fecha durable con `DelayedError`: no gasta intento y no deja job completado. Los jobs de dispatch se encolan con `attempts: 1` porque BullMQ ya no planifica nada, y `enqueueDispatch` reactiva un job completado obsoleto cuando la fila todavía tiene trabajo.

**3. El orden era una esperanza.** `item_index * 1200` no sobrevive a dos workers, un proveedor lento o un reintento. La admisión de `N` comprueba ahora, en la misma transacción que otorgaría el permiso, que `N-1` **llegó**; y el worker encadena: publica el siguiente efecto cuando el actual se registra como enviado. La publicación ofrece solo la cabeza del lote. Política explícita por tipo: un `text` inmediatamente posterior a un `media` es su caption y se rechaza si la imagen no llegó; cualquier otro ítem —otra burbuja, un enlace canónico, un Flow— es cierto por sí solo y continúa.

**4. El recibo del proveedor no llegaba al historial.** `messages.external_id` guarda **nuestra** identidad de deduplicación y el `wamid` vivía en la fila de dispatch, así que el webhook de estados buscaba donde no estaba y no encontraba nada. Además una aceptación HTTP se escribía como `delivered`, que es una afirmación sobre el teléfono del cliente que un 200 no hace. Ahora: aceptación es `sent`; `delivered` y `read` solo llegan por webhook; el id se resuelve por la fila de dispatch (indexada por `receipt`); y el ciclo entero se aplica, una transacción por evento, con avance monótono, idempotencia ante repetidos y un rechazo aceptado sobre `sent` pero **nunca** sobre `delivered`/`read`.

**5. Los efectos internos del handoff se perdían.** Recibo, estado y nota confirman juntos, pero asignación, Redis, evento y correo ocurren después, y un crash en esa ventana dejaba un recibo que hacía retornar de inmediato a todo intento posterior: nadie asignado, nadie avisado. Cada paso es ahora una fase que se registra en el recibo y se salta si ya está. Un reanudado corre el mismo código sin la transición, así que no hay segunda nota, ni segundo aviso a la bandeja, ni segundo correo. Tres defectos que aparecieron al construirlo: `null` se borraba con `value ?? true`; "nadie a quien avisar" nunca cerraba su fase; y dos reanudaciones podían anunciarse a la vez, ahora serializadas por recibo.

**6. La clasificación era una regla global falsa.** "Todo 5xx respondido es rechazo reintentable" no es cierto: un 5xx sin recibo no demuestra que el proveedor no actuó. La clasificación es por proveedor. Para Meta el contrato es que una respuesta crea el mensaje y devuelve su id, o devuelve un objeto `error` y no crea nada — ese emparejamiento es lo que distingue un rechazo del silencio. Un `error` sin id es rechazo; solo entonces el código decide si se invita otro intento, desde una tabla de límites de tasa y estados temporales **documentados**, más `is_transient` cuando viene explícitamente en `true`. Un código no mapeado sigue siendo rechazo pero no se reintenta. Un 5xx sin `error` legible, o un cuerpo ilegible, es `unknown`.

**7. El interruptor podía apropiarse de una respuesta que no podía enviar.** Aceptaba cualquier string como canal. Ahora un canal debe estar **pedido y migrado**, comprobado contra el gateway. Y es operable: estado efectivo legible (pedido / migrado / en efecto / ignorado), escritura validada y auditada con el valor anterior y el actor real, caché invalidada en el acto y apagado total en una llamada. Sigue en `platform_settings` a propósito: decide cómo salen las respuestas, no es una función comercial de plan.

**8. `reconciliation_required` terminaba en un log.** Ahora hay cola listable y buscable por recibo o binding, backlog con antigüedad y SLA de una hora, y tres resoluciones auditadas. `retry` es la única que puede producir otro POST y exige por escrito evidencia de que el efecto **no** ocurrió — el silencio es lo que significa este estado, así que nunca puede ser la justificación. Ni el texto ni el número completo se exponen. [Runbook](../../runbooks/dispatch-reconciliation.md).

**9. La evidencia decía cosas falsas.** Corregido en su propio documento.

## Estado por capacidad — cinco cosas distintas

La confusión que la directiva señala se evita nombrando cada nivel por separado.

| Capacidad | Primitiva | Productor conectado | Transporte | Integración probada | Piloto certificado |
| --- | --- | --- | --- | --- | --- |
| Texto (burbujas) | sí | **sí** | WhatsApp, Messenger, Instagram, Telegram | BullMQ+Valkey+PostgreSQL reales | **no** |
| Medios | sí | **sí** | WhatsApp, Messenger, Instagram, Telegram | sí | no |
| Caption como efecto propio | sí | **sí** | WhatsApp, Messenger, Instagram, Telegram | sí | no |
| Enlace de pago canónico | sí | **sí** | WhatsApp, Messenger, Instagram, Telegram | sí | no |
| Flow | sí | **no** | WhatsApp (los otros tres lo rechazan) | sí | no |
| Web Chat (admisión local) | sí | sí | local autenticado | PostgreSQL + Socket.IO | no |

> **Actualizado el 8 de septiembre.** La tabla decía que sólo WhatsApp y Messenger tenían transporte estricto, y que medios, captions y enlaces tenían primitiva pero **ningún productor**. Ambas cosas se cerraron: Instagram y Telegram implementan `StrictDispatchTransport` (`527cc7b6`) y el productor entrega el turno entero —burbujas, enlace, foto y caption— en un solo lote (`6ddd1a70`). Detalle en [la extensión del despacho](dispatch-channels-and-turn.md).

Canales: **WhatsApp**, **Messenger**, **Instagram** y **Telegram** implementan `StrictDispatchTransport`. **Correo** no, y se rechaza explícitamente (`transport_not_migrated`) si alguna vez recibe una fila.

## Límites explícitos

- **Nada cambia en producción.** El interruptor está apagado y falla cerrado ante cualquier configuración que no pueda cumplirse.
- **Ningún proveedor real fue llamado.** Todas las respuestas de las pruebas son sintéticas, con forma de las reales y los identificadores reemplazados. Un piloto con credenciales de prueba autorizadas es un gate externo.
- ~~El productor normal solo alimenta **texto**.~~ **Desactualizado desde `6ddd1a70`**: el productor entrega el turno entero. Lo que sigue sin productor es el **Flow**, que tiene primitiva y transporte de WhatsApp pero ningún camino que lo produzca en la salida normal.
- La procedencia de aprendizaje sigue sin recogerse en turnos de mensajería: se registra footprint vacío, así que el borrado por release no alcanza esas filas (el borrado por contacto sí).
- ~~Las tablas nuevas se crean por bootstrap perezoso y están en `tenant-schema.sql`; la migración para tenants existentes es trabajo aparte.~~ **Cerrado en `498e7592`**: hay migración aditiva para los tenants existentes, con prueba de paridad entre las tres definiciones.
