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
| `a850726c` | División de un turno en efectos: caption como ítem propio, enlace de pago aparte, Flow sin fallback; transporte estricto de Messenger | TypeScript API pasa. 9 suites / 78 pruebas |
| `6dd0294c` | Historia y dispatch en una sola transacción, con estado que sigue al resultado real; interruptor de despliegue apagado por defecto | TypeScript API pasa. 9 suites / 119 pruebas, tres suites PostgreSQL |
| `36570a4b` | La respuesta del modelo toma el camino durable cuando el interruptor lo habilita | TypeScript API pasa. 10 suites / 128 pruebas, tres suites PostgreSQL |
| `d0ab788c` | El fixture de la carrera de borrado responde la consulta de tablas del outbox | TypeScript API sobre el índice; 2 suites / 9 casos |

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

> **Corregido en `42c9282f`.** Esta sección registraba como decisión de producto que *todo* 5xx respondido se leyera como rechazo reintentable. Era incorrecto: un 5xx sin recibo no demuestra que el proveedor no actuó, y reintentar sobre él invita justo al duplicado que el outbox existe para evitar. La clasificación es ahora **por proveedor y por código documentado**; ver [los bloqueos cerrados](dispatch-blockers-closed.md).

## Admisión: qué se comprueba y en qué orden

Privacidad → tenant → agente que sirve **esta** conexión → fuentes de aprendizaje del payload → fila de dispatch → binding de destino en lectura compartida. Todo con la misma query que escribe el permiso, así que una publicación o un borrado que confirman en paralelo quedan enteramente antes o enteramente después. Ningún lock de tenant o agente se sostiene durante la llamada al proveedor: el permiso confirma primero y la petición sale después.

Comprobado con PostgreSQL real: una revisión de agente publicada, otro agente ganando esa conexión exacta sin tocar la versión ni el hash del primero, una fuente de entrenamiento retirada y una fuente **holdout** retirada rechazan el intento, y ninguno lo gasta.

## Recuperación y borrado

La pasada de recuperación republica lo que la cola nunca recibió, con los mismos identificadores deterministas, y marca `queued` **después** de publicar: un fallo antes de la marca republica los mismos ids, mientras que marcar primero podría ocultar una publicación perdida. Retira antes los permisos vencidos, para no republicar una fila que todavía sostiene uno. El fallo de un tenant no detiene el barrido, y corre en una sola instancia.

El borrado por contacto y el retiro de fuentes de aprendizaje alcanzan el outbox bajo el mismo fence exclusivo que las copias de Web Chat: se limpian palabras y destinatario de un ítem aún no enviado y la fila sobrevive, porque si no un job recuperado repoblaría el payload y entregaría lo borrado. Un tenant sin la tabla es un no-op; un outbox sin su índice de fuentes es una migración parcial y falla atómicamente.

## Historia, interruptor y productor

**Historia y dispatch confirman juntos.** Eran dos escrituras independientes, así que un fallo podía dejar una sola; y la fila de historia decía `delivered` **antes** de haber enviado nada, con lo cual el registro era una afirmación y no un hecho. Ahora se escribe `pending` junto a su efecto, pasa a `delivered` solo cuando un proveedor emite recibo, y a `failed` solo ante un rechazo definitivo. **Un resultado incierto se queda en `pending` a propósito**: llamarlo fallido sería tan falso como llamarlo entregado cuando el proveedor pudo haber actuado.

El índice de deduplicación se **comprueba** en lugar de intentarse: una sentencia fallida aborta la transacción entera, así que el catch-y-reintento que `saveAiMessage` puede permitirse —cada uno de sus inserts es su propia transacción— aquí no tendría con qué recuperarse. Un esquema con el índice atrasado pierde esa segunda línea de defensa, nunca la respuesta.

**El interruptor está apagado por defecto** (`platform_settings`, clave `dispatch.normalOutbox`): lista explícita de canales y lista opcional de tenants piloto. Encender el interruptor maestro solo no cambia nada, y cualquier valor ilegible o malformado significa apagado, porque fallar abierto pondría entrega no probada frente a clientes.

**El productor es únicamente la respuesta del modelo.** Avisos de citas, texto de handoff, fallbacks de cuota y automatizaciones conservan sus productores y sus autoridades. La vuelta atrás está acotada por lo confirmado: antes del COMMIT de `prepare`, cualquier cosa devuelve falso y el camino actual sigue debiendo la respuesta; después del COMMIT ese lote es dueño de la respuesta y una publicación fallida se recupera, nunca se reenvía por el camino viejo, que la entregaría dos veces.

**Los turnos de mensajería no recogen procedencia de aprendizaje todavía**, así que no se registra ninguna. Un footprint vacío es el valor honesto; inventarlo haría parecer que el borrado por release alcanzó esas palabras. El borrado **por contacto** sí las alcanza. Cerrar el hueco exige que el colector de procedencia funcione fuera de Web Chat, donde hoy además filtra el historial por recibos que las respuestas de mensajería no tienen.

## Regresión medida contra el commit de partida

La suite completa de la API se ejecutó en un worktree limpio de `7c613864` y sobre este árbol, con las mismas bases desechables:

| | Suites | Pruebas |
| --- | --- | --- |
| `7c613864` (partida) | 498/524, **19 en rojo** | 5.370 pasan, 23 fallan |
| Este árbol | 512/535, **16 en rojo** | 5.520 pasan, 20 fallan |

**Cero suites nuevas en rojo.** Las 16 que siguen fallando ya fallaban en el commit de partida y no son de este trabajo. La comparación también aisló la única regresión introducida —el fixture de `tool-control-erasure-race`, corregido en `d0ab788c`— y confirmó que `conversations.widget-containment` estaba en rojo antes y ahora pasa.

## Límites explícitos

- **Nada cambia en producción.** El interruptor está apagado, apagado para todo canal no listado, y apagado cuando la configuración no se puede leer, así que el productor devuelve falso en todas partes hasta que alguien lo escriba deliberadamente.
- ~~Solo WhatsApp tiene transporte estricto.~~ **Desactualizado desde `a850726c`**: Messenger también lo implementa. **Corregido de nuevo en `527cc7b6`**: Instagram y Telegram también lo implementan; sólo correo se rechaza explícitamente. Estado vigente por canal en [los bloqueos cerrados](dispatch-blockers-closed.md).
- ~~Medios, enlaces y Flow como ítems separados no están implementados.~~ **Desactualizado desde `a850726c`**: `buildDispatchItems` ya los separa, con la división de imagen y caption. Lo que quedaba abierto era el **productor**, y **se cerró en `6ddd1a70`** para medios, captions y enlaces canónicos: entrega el turno entero en un solo lote. Sigue sin productor únicamente el **Flow**.
- No se prometió exactly-once remoto. Un resultado desconocido exige conciliación y puede dejar un mensaje sin enviar.
- Las respuestas de proveedor de las pruebas son sintéticas. No hay piloto con Meta ni con ningún otro proveedor.
- ~~El DDL está en `tenant-schema.sql` y en el bootstrap perezoso; no se aplicó a tenants existentes.~~ **Cerrado en `498e7592`**: hay migración aditiva para los tenants existentes y una prueba de paridad entre las tres definiciones. No se aplicó a ninguna base real.
