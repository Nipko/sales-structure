# Outbox durable de la salida normal, transporte estricto y recuperación

8 de septiembre de 2026. Bloques 2 y 3 (parcial) del [plan de despacho de salida normal](../2026-09-07/normal-agent-dispatch-authority-plan.md), después de cerrar el bloque 6 (Web Chat) documentado [aquí](normal-widget-admission-and-handoff-receipt.md). Sin push, sin despliegue, sin llamadas a proveedores reales.

## Commits

| Commit | Comportamiento incorporado | Validación sobre el índice exacto |
| --- | --- | --- |
| `d5d58216` | `agent_dispatch_outbox`: una fila por efecto remoto, permiso de un intento, presupuesto que sobrevive al rollback, recibo aceptado como hecho histórico | TypeScript API pasa. 8 suites / 107 pruebas, incluida la suite nueva con PostgreSQL real y segunda conexión; cero omitidas |
| `4cf95267` | `sendStrict`: aceptado / rechazado / desconocido, sin fallback de Flow a texto, sin caption montado sobre la imagen | TypeScript API pasa. 9 suites / 101 pruebas; respuestas de proveedor sintéticas |
| `c0ed2dc6` | Admisión con autoridad de conexión, fuentes y binding en la misma conexión que escribe el permiso; fallo de preflight acotado | TypeScript API pasa. 6 suites / 47 pruebas, dos suites PostgreSQL |
| `7ed373be` | El worker entrega una fila con un solo intento admitido; BullMQ transporta dos identificadores | TypeScript API pasa. 10 suites / 107 pruebas |
| `3e7f78db` | Recuperación de pendientes, retiro de permisos vencidos y borrado que alcanza el outbox | TypeScript API pasa. 10 suites / 141 pruebas, cuatro suites PostgreSQL |

Los conteos se solapan entre bloques; no sumarlos como cobertura nueva.

## Qué reemplaza y por qué

La ruta normal actual no puede decir, de forma durable, si un intento concreto fue autorizado ni qué volvió de él:

- el job lleva el payload y el destinatario a Redis, fuera del almacenamiento que gobierna el borrado;
- historia y cola son dos escrituras separadas: un fallo puede dejar solo una;
- un ACK perdido de Redis puede producir dos jobs;
- lo único que separa un job reejecutado de una segunda entrega es un marcador escrito **después** de que el proveedor respondió;
- y el gateway convierte cualquier excepción en `null`, así que un número rechazado y una conexión perdida son el mismo valor.

`agent_dispatch_outbox` es ese registro. **Una fila por efecto remoto, nunca por llamada**: una imagen de Messenger y su caption son dos POST y un solo recibo no puede describir ambos, que es exactamente por qué un caption fallido reenviaba la foto.

## Las tres reglas de los estados

1. **`admitted` es permiso para UN intento.** Cuando su lease vence, la fila **no** vuelve a estar disponible: ese intento pudo llegar al proveedor. La admisión rechaza y **no escribe nada** — el rechazo revertiría su propia escritura, y mover la fila desde el intento de otro destruiría el lease que un reconciliador necesita. Una pasada confirmada aparte hace la transición conservando la identidad del intento.
2. **`attempts` sube en la transacción de admisión**, que confirma antes de la llamada externa. Un envío revertido no puede reiniciar la cuenta ni producir recuperación infinita. Agotar el presupuesto suprime la fila en lugar de dejar una que parece reintentable. Los fallos de **preflight** gastan el mismo presupuesto.
3. **Un recibo aceptado es un hecho histórico**: se lee sin pasar ninguna guarda pensada para una admisión nueva, y ningún informe posterior sobre el mismo intento lo degrada.

Ambos plazos se evalúan con el reloj de la base, en la misma sentencia que bloquea la fila: un reloj de aplicación desfasado nunca decide que un permiso sigue vivo.

## Transporte estricto

`sendStrict` devuelve uno de tres resultados para exactamente un efecto:

| Resultado | Significado |
| --- | --- |
| `accepted` | El proveedor emitió un recibo. Nunca se reenvía ese ítem. |
| `rejected` | El proveedor respondió y no actuó. Dice si otro intento está invitado. |
| `unknown` | No llegó respuesta. Pudo haberse procesado: reconciliación, jamás reenvío ciego. |

Un canal sin adaptador migrado se rechaza explícitamente (`transport_not_migrated`) en vez de degradarse al gateway suelto. WhatsApp está migrado; los demás conservan la ruta actual.

**Decisión de producto registrada como tal:** un 5xx *respondido* se lee como rechazo reintentable y no como resultado desconocido. Meta no emite id de mensaje en ese caso y no hay nada contra qué reconciliar un POST fallido, así que la alternativa deja una respuesta del cliente varada detrás de una reconciliación que no puede resolverse. Cambia un duplicado raro por no perder una respuesta — el mismo canje que el pipeline ya hace explícito. Una petición **sin respuesta** sigue siendo desconocida. Conviene confirmar este criterio al cierre.

## Admisión: qué se comprueba y en qué orden

Privacidad → tenant → agente que sirve **esta** conexión → fuentes de aprendizaje del payload → fila de dispatch → binding de destino en lectura compartida. Todo con la misma query que escribe el permiso, así que una publicación o un borrado que confirman en paralelo quedan enteramente antes o enteramente después. Ningún lock de tenant o agente se sostiene durante la llamada al proveedor: el permiso confirma primero y la petición sale después.

Comprobado con PostgreSQL real: una revisión de agente publicada, otro agente ganando esa conexión exacta sin tocar la versión ni el hash del primero, una fuente de entrenamiento retirada y una fuente **holdout** retirada rechazan el intento, y ninguno lo gasta.

## Recuperación y borrado

La pasada de recuperación republica lo que la cola nunca recibió, con los mismos identificadores deterministas, y marca `queued` **después** de publicar: un fallo antes de la marca republica los mismos ids, mientras que marcar primero podría ocultar una publicación perdida. Retira antes los permisos vencidos, para no republicar una fila que todavía sostiene uno. El fallo de un tenant no detiene el barrido, y corre en una sola instancia.

El borrado por contacto y el retiro de fuentes de aprendizaje alcanzan el outbox bajo el mismo fence exclusivo que las copias de Web Chat: se limpian palabras y destinatario de un ítem aún no enviado y la fila sobrevive, porque si no un job recuperado repoblaría el payload y entregaría lo borrado. Un tenant sin la tabla es un no-op; un outbox sin su índice de fuentes es una migración parcial y falla atómicamente.

## Límites explícitos

- **Ningún productor crea filas todavía.** No hay tráfico por este camino y el comportamiento actual no cambia: Conversations sigue encolando el job `send` heredado. Migrar `sendResponse`, la historia y los caches/replay es el paso siguiente del plan.
- Solo WhatsApp tiene transporte estricto. Instagram, Messenger, Telegram y correo se rechazan explícitamente si alguna vez reciben una fila.
- Medios, enlaces y Flow como ítems separados —con la división de imagen y caption y el fallback de Flow solo tras un rechazo demostrado— no están implementados.
- No se prometió exactly-once remoto. Un resultado desconocido exige conciliación y puede dejar un mensaje sin enviar.
- Las respuestas de proveedor de las pruebas son sintéticas. No hay piloto con Meta ni con ningún otro proveedor.
- El DDL está en `tenant-schema.sql` y en el bootstrap perezoso; no se aplicó a tenants existentes.
