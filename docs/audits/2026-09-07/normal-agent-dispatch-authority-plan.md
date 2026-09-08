# E3 — Autoridad y admisión de la salida normal del agente

Fecha: 2026-09-07. Estado: **revisión de código y propuesta; implementación pendiente**.

Esta revisión es de solo lectura de la salida normal. No modifica transporte, no invoca proveedores y no añade evidencia de ejecución. Las líneas citadas corresponden al árbol de trabajo inspeccionado; el guard de conexión está en el bloque de aprobación/routing que se registra por separado. Los tests enumerados abajo son referencias existentes o criterios propuestos, no una certificación nueva.

## 1. Hallazgos comprobados

| Frontera actual | Evidencia | Consecuencia |
| --- | --- | --- |
| El core conoce la autoridad, pero el transporte la pierde | `apps/api/src/modules/conversations/conversations.service.ts:934` pasa `servedAgentAuthority` a `generateResponse`; `:999` llama a `sendResponse` sin ella. Los helpers están en `:1716`, `:1748`, `:1764` y `:1808`. | Añadir un guard únicamente al executor no protege texto, medios ni Flow normales. |
| La recuperación conserva palabras, sin su origen | `conversations.service.ts:693` y `:954`: `turn:reply` guarda y recupera texto. `:5030` y `:5101`: la recuperación de Widget guarda texto/contacto/conversación, sin scope ni fuentes. | No se puede atribuir ese texto antiguo al scope recién resuelto al reintentar. |
| La historia y la cola son escrituras separadas | `conversations.service.ts:999` encola cada fragmento y después llama a `saveAiMessage`; `:3844` hace lo mismo con enlaces y medios. | Un fallo puede dejar solo una de las dos escrituras. Guardar historia no prueba envío. |
| Redis lleva el payload completo y admite un segundo intento sin identidad | `apps/api/src/modules/channels/outbound-queue.service.ts:44`, `:75`, `:85`. El job normal contiene `{outbound}`; ante error de `add`, elimina `jobId` y vuelve a añadirlo. | Un ACK perdido de Redis puede producir dos jobs. El contenido y destinatario sobreviven fuera del almacenamiento gobernado por borrado. |
| La cola normal no valida versión ni borrado del destinatario | `apps/api/src/modules/channels/outbound-queue.processor.ts:60`, `:101`, `:116`, `:179`. Revalida suscripción, throttle y credenciales, pero la deduplicación final es un marcador Redis posterior al proveedor. | Un envío obsoleto puede salir; un crash entre aceptación y marcador puede repetirlo. Los eventos `completed`/`failed` (`:230`, `:235`) no constituyen un recibo durable del proveedor. |
| El gateway borra información del fallo | `apps/api/src/modules/channels/channel-gateway.service.ts:100` devuelve `null` en su catch. En `:114`/`:133` intenta Flow y, tras cualquier excepción, envía texto alternativo. | Timeout y rechazo conocido no son equivalentes. Un Flow aceptado con ACK perdido puede ir seguido de otro mensaje. |
| Una llamada de medios puede contener dos efectos | `apps/api/src/modules/channels/messenger/messenger.adapter.ts:144` construye una imagen y un caption; el bucle `:173` hace dos POST y devuelve solo el último ID. | Una única admisión/receipt por llamada no describe los efectos reales. No repetir la imagen si solo falló el caption. |
| Web Chat ya dispone de persistencia y receipt local | `apps/api/src/modules/widget/widget-message-store.service.ts:77`, `:96`, `:130`, `:175`: binding de sesión/contacto, mensaje idempotente `pending`, publicación posterior y ACK autenticado. | Puede validar autoridad y guardar mensaje en una única TX; `stored` no significa que el navegador lo recibió. |
| El Widget directo también pierde la autoridad | `apps/api/src/modules/widget/widget.gateway.ts:307` recibe strings y en `:339` persiste como `source:'ai'`. `WidgetMessageStore.sendOutbound` (`:137`) tampoco recibe scope privado. | Debe llegar un resultado privado completo o una referencia a él, no inferir el origen desde metadata. |
| La atribución histórica de conversación no es la versión del turno | `conversations.service.ts:1333` conserva la primera atribución y marca conflictos posteriores. | No usarla como sustituto del scope original de la respuesta. |
| Existe un precedente de admisión externa | `apps/api/src/modules/tenant-payments/tenant-payment-store.service.ts:339` y `tenant-payments.service.ts:1135`: COMMIT autoriza un intento y el token solo vuelve a la invocación ganadora. | Permite separar una TX corta de la llamada externa y tratar el crash posterior como incierto. No es, por sí solo, una implementación de mensajes. |

El guard canónico de versión está en `apps/api/src/modules/persona/served-agent-authority.ts:44`. El guard de **conexión** en `:73` también comprueba el routing exacto: otro agente puede ganar prioridad sin cambiar el hash del anterior. Para esta nueva salida diferida se propone reutilizar el segundo. Ninguno debe ejecutarse con locks de tenant/agente abiertos durante una llamada al proveedor.

## 2. Contrato privado propuesto

Crear un resultado de turno interno que agrupe texto final y efectos de salida. Debe conservar:

- Tenant/schema, UUID de conversación/contacto/inbound persistidos y conexión exacta.
- `ServedAgentAuthority` de la resolución que produjo el resultado; nunca la resolución del reintento.
- Identidad estable de lote e ítems, tipo (`text`, `media`, `payment_link`, `flow`), orden y contenido inmutable.
- Referencias de procedencia de learning seleccionadas por el servidor: agente, release, hash de release, ejemplo y hash de su proyección exacta. No guardar ejemplos de entrenamiento ni callbacks en BullMQ.
- Referencias canónicas de los resultados de herramientas que originan enlaces/medios, cuando existan. No usar una URL propuesta por el modelo como prueba de pago o de creación de enlace.

El contrato vive en el backend. No añadir autoridad a un DTO, a argumentos de herramienta ni a `OutboundMessage.metadata`. Un job tampoco puede autodeclararse humano/sistema para saltarse el guard: la clase de productor se decide al crear la fila confiable.

Los helpers migrados de salida AI deben exigir ese contexto; su ausencia no deriva a la cola legacy. AgentTest/Eval/Simulation conservan el resultado para evaluación mediante el mismo core, pero no admiten ni encolan salida operativa. Un turno draft sigue produciendo una sugerencia privada, sin convertirse en un mensaje normal de cliente.

El `learningFootprint` ya acumula ejemplos usados entre iteraciones en `conversations.service.ts:3406`; el envío actual queda fuera de esa información. Como primer paso seguro, el texto y los captions generados conservan la unión de las fuentes usadas para producirlos. Una URL hidratada exclusivamente de un recibo canónico puede tener procedencia independiente, sin atribuirle palabras del modelo. No excluir fuentes basándose solo en que el resultado parece genérico.

La recuperación debe consultar el lote durable original. `turn:reply` y `widget:reply` pueden almacenar IDs de ese lote; los caches antiguos de texto no obtienen automáticamente autoridad vigente. Si no se puede recuperar el origen exacto, no despachar esas palabras. La recuperación de un turno con comandos ya ejecutados debe usar sus recibos y una respuesta sin nuevos writers, no reiniciar el turno completo.

## 3. DB/outbox y estados

Proponer un outbox de salida normal, con filas por ítem y un vínculo de lote/inbound. La fila contiene payload, binding, scope, procedencia privada, estado, attempts, lease/token, fecha disponible, error tipado y receipt. Índice único sobre identidad lógica tenant/conversación/inbound/ítem; otro índice para recuperar pendientes. Las referencias de fuentes necesitan un índice consultable para retirar copias por fuente/contacto aunque el release ya esté redactado.

Persistir el lote y su historia pendiente en una TX. BullMQ recibe únicamente `{tenantId,dispatchId}`; enqueue determinístico y recuperación desde DB, sin fallback a un job sin ID. Redis es transporte de trabajo, no la prueba de autoridad o aceptación. Un crash tras COMMIT y antes de enqueue se recupera desde el outbox.

Estados propuestos, sujetos al contrato de UI existente:

| Estado | Significado |
| --- | --- |
| `prepared` / `queued` | Contenido conservado; todavía no tiene permiso para una llamada externa. |
| `admitted` | Una invocación obtuvo permiso durable para **un** intento concreto. No equivale a envío. |
| `sent` | Existe receipt de aceptación del proveedor. No equivale a entrega/lectura. |
| `stored` | Web Chat guardó el mensaje localmente. El ACK de navegador es independiente. |
| `suppressed` | Se rechazó una nueva salida antes de que comenzara su llamada externa. |
| `failed` | Fallo conocido anterior al envío, recuperable de forma acotada. |
| `reconciliation_required` | El intento pudo llegar al proveedor o se perdió su ACK. No autoriza otro POST. |

Una marca `admitted` antigua no se convierte en permiso reutilizable al vencer el lease. El token vuelve solo a la invocación que obtuvo y observó el COMMIT. Ante ACK ambiguo del COMMIT, conservar identidad y estado incierto: una relectura vacía no prueba que la primera TX no pueda terminar después. Ante fallo del registro de resultado después de un receipt observado, conservar la evidencia y no reenviar. El receipt aceptado debe poder consultarse antes de aplicar guards destinados a una nueva admisión.

## 4. Ruta externa mínima correcta

1. **Preparación:** throttle, suscripción, credenciales actuales, validación de canal y preparación del request, fuera de la TX canónica. No hacer POST ni fallback en esta fase. Acotar también fallos previos repetidos; un rollback no puede borrar todos los attempts y producir recuperación infinita.
2. **Admisión corta:** privacidad → tenant → guard de conexión/tabla y agente → fuentes del resultado → fila de dispatch → conversación/contacto. Comparar scope/binding original con la fila bloqueada, validar fuentes y estado, verificar token de trabajo y grabar el permiso de un solo intento. Bloquear filas de origen en orden determinista y usar lectura compartida para el binding de destino; no actualizar conversación/contacto en esta TX ni escalar esos locks. Todo con la misma conexión. Bootstrap fuera del fence; no DDL o TX hija dentro.
3. **Uso del payload y llamada:** después del COMMIT, ejecutar solo el request admitido. Mantener el fence de privacidad necesario para leer/usar el payload y el destinatario, sin locks de tenant/agente ni TX de negocio anidada. Verificar tombstone, binding y que la copia no haya sido retirada antes de usarla. La finalización durable se hace después de salir del callback. Un borrado que ganó antes bloquea; uno que llega durante la llamada espera al uso ya iniciado. No reenviar al fallar el fence o su COMMIT.
4. **Resultado:** registrar receipt o incertidumbre con CAS del intento exacto. Una publicación posterior a la admisión no invalida ese permiso ya concedido; una publicación anterior impide concederlo. La privacidad no queda dispensada por haber admitido. Un receipt ya observado no se convierte en fallo reintentable por una comprobación posterior.

La preparación debe producir requests con **un solo efecto remoto**. El primer bloque externo puede cubrir texto y medios simples; Messenger requiere dividir imagen y caption en dos ítems, cada uno con su receipt. WhatsApp Flow requiere ítem propio ligado a misión/revisión/token; su fallback solo puede ser otro ítem admitido tras un rechazo demostrado anterior a aceptación. Un timeout del Flow nunca habilita automáticamente texto alternativo.

Hace falta un puerto estricto del gateway/adaptadores. Reutilizar sin cambios `sendMessage` mantendría el catch que transforma errores en `null` y el fallback ambiguo. El puerto nuevo debe distinguir fallo de preparación, rechazo conocido y resultado desconocido, limitar tiempos y evitar reintentos ocultos. La ruta manual/legacy puede conservar el método actual mientras se migra por separado. No prometer exactly-once remoto: sin soporte verificable del proveedor, la incertidumbre exige reconciliación y puede dejar un mensaje sin enviar.

## 5. Aprendizaje, revocación y efectos aceptados

`LearningService.runtimeDataSourceAuthority` (`apps/api/src/modules/learning/learning.service.ts:802`) encapsula un guard antes y después del callback. Su closure comprueba release/proyección y sus fuentes, incluidas las de validación. Reutiliza `assertReleaseSourcesAvailable` (`:715`), que alcanza `assertSourcesAvailable` (`:707`) y el origen de Inbox.

**No envolver enviar+guardar receipt en ese callback.** Puede rechazar el resultado después de que el proveedor ya lo aceptó. Tampoco llamarlo desde una TX de admisión normal: el wrapper podría abrir una segunda conexión con lock compartido detrás de un borrado exclusivo en cola. `apps/api/src/common/utils/agent-source-fence.ts` solo reutiliza su contexto servidor explícito; no vuelve reentrante cualquier transacción de negocio.

Extracción mínima propuesta, sin API pública: `assertRuntimeLearningFootprint(query, schema, {tenantId, agentId, entries})`. No resuelve schema, abre TX, invoca proveedor ni repara fuentes. Reconstruye la misma proyección de `RuntimeLearningExample`, compara hashes exactos y conserva las comprobaciones actuales de todas las fuentes/ejemplos del release. El servidor genera esas referencias al producir la respuesta. La admisión las verifica con su query, no con un callback externo.

La variante para admisión requiere además serializar el retiro hasta el COMMIT. Un `SELECT` sin locks no basta: `LearningService.rollback` (`:688`) usa `learning-release` y puede retirar un release sin tomar el fence exclusivo de privacidad. El guard corto debe mantener locks compartidos de los releases/proyecciones comprobados y los orígenes necesarios, con orden estable y sin atravesar proveedor. La extracción debe conservar una variante de solo lectura para los usos existentes; no imponer esos locks a todos los callbacks de modelos. Las carreras de rollback y edición de origen contra esta TX forman parte de la aceptación pendiente.

Separar estas situaciones:

- **Antes de una nueva admisión:** fuente retirada, proyección distinta, release no autorizado o borrado rechazan el texto derivado. Se puede preparar después una respuesta nueva sin aprendizaje y sin repetir comandos; no despachar el texto rechazado bajo un scope nuevo.
- **Después de la admisión:** el permiso describe una única salida concreta, no el derecho a seguir consultando o copiando el release. Un rollback del aprendizaje no transforma un intento ya concedido en una nueva generación. El borrado/retirada de copias aún exige que no se use un payload redactado antes de iniciar su envío.
- **Después de aceptación:** conservar el hecho/ID del receipt y no reenviar. Si un borrado exige retirar contenido derivado, redactar esa copia sin fingir que el proveedor no aceptó el mensaje. Un post-check de fuentes no puede deshacerlo.
- **Comandos ya aceptados:** una reserva, pago, matrícula o evento operativo no pierde su existencia por retirar ejemplos de estilo. Su notificación canónica se evalúa con sus propias reglas. No reiniciar el comando ni cancelar el recurso para recuperar la redacción del agente.

Integrar el outbox en `apps/api/src/modules/compliance/compliance.service.ts:344` y en el retiro de fuentes de learning, con el mismo fence exclusivo. Retirar/redactar copias afectadas, incluidos contactos vinculados; conservar solo la evidencia mínima sin PII necesaria para impedir replay. Finalizadores tardíos deben consultar tombstone/CAS y no repoblar payload. Para contenido ya guardado en Web Chat, el receipt local y la autorización de volver a mostrar contenido son hechos separados. La retirada debe impedir que el historial o un cache reconstruyan contenido borrado.

## 6. Web Chat: primer bloque ejecutable

La opción de menor alcance es transportar el resultado privado hasta una admisión local de Widget:

- Conservar el scope/footprint y la identidad del lote desde `streamWidgetMessage`; evitar que el gateway reciba solo strings y después invente su autoridad.
- Nueva entrada interna del store para salida AI: en una TX corta, guard de conexión + fuentes + binding de sesión/contacto + INSERT idempotente + receipt `stored`. Reutilizar `persistWithQuery`, sin cambiar el significado de `source:'agent'`, que corresponde a una persona del equipo.
- Publicar solo IDs tras COMMIT; recuperar mediante sesión autenticada y los mensajes persistidos. Un fallo del relay no crea otra fila. Un replay de una fila ya aceptada no se vuelve una nueva acción por publicar otra versión.
- Mantener controles actuales de acceso/revocación de sesión y borrado al leer/emitir. Nunca marcar `delivered` solo porque hubo persistencia o `socket.emit`.

Los mensajes normales con pago/media que hoy se concatenan en `finalResponse` deben conservar procedencia por ítem o, al menos, una clasificación conservadora explícita. Este bloque no debe declarar arreglada la salida externa ni el handoff canónico.

## 7. Archivos y secuencia de implementación

1. **Contrato privado y Widget.** Nuevos helpers de resultado/dispatch en `apps/api/src/modules/conversations/`; hunks de `conversations.service.ts`, `widget/widget.gateway.ts`, `widget/widget-message-store.service.ts`; extracción query-level en `learning/learning.service.ts`. Reutilizar `persona/served-agent-authority.ts`. Integrar borrado/retención de las nuevas copias desde el primer bloque que las persista.
2. **Outbox normal y recuperación.** Nuevo store/contrato interno de dispatch en `apps/api/src/modules/channels/`, su DDL/bootstrap y módulo; `channels/outbound-queue.service.ts`, `channels/outbound-queue.processor.ts`; `apps/api/prisma/tenant-schema.sql`; hooks estrechos de Compliance/learning. Registrar payload y scope antes de publicar IDs a BullMQ.
3. **Transporte estricto y adopción de texto.** `channels/channel-gateway.service.ts` y adaptadores WA/IG/Messenger/Telegram pertinentes. Migrar `sendResponse` y los caches/replay de Conversations. Mantener la ruta normal antigua explícitamente para productores aún no migrados.
4. **Medios, pago y Flow.** Adoptar `sendMedia`, `sendPaymentLink`, `sendFlow`; dividir subenvíos Messenger y eliminar el fallback ambiguo de la ruta nueva. Binding de Flow con misión/revisión/estado esperado. Mantener settlement y receipts de pago fuera de la autoridad de estilo.

Preservar separadamente `enqueueApprovedEffect`, `operationalNotice`, `AgentConsoleService.sendAgentMessage` y automatizaciones. Sus productores usan autoridades distintas. `agent-console/agent-console.service.ts:387` escribe mensajes humanos Widget y `:461` llama al gateway externo; `automation/drip-sequence.service.ts:662`/`:679` y `automation/nurturing.service.ts:565`/`:752`/`:796` usan la cola ordinaria. No exigirles un scope AI para mantener su comportamiento. Esto tampoco los certifica: quedan fuera de este bloque. Handoff, indicadores de escritura y otros despachos necesitan inventario/migración propios.

## 8. Aceptación y evidencia pendiente

Tests nuevos propuestos, usando PostgreSQL/Prisma real para transacciones y un transporte controlado sin llamar a proveedores:

1. Publicación antes de admisión: cero INSERT Widget/cero invocaciones externas. Publicación encolada durante admisión: orden de locks comprobado; un único permiso. Publicación después: conserva receipt/permiso previo, sin otro intento.
2. Otro agente obtiene la conexión sin cambiar el hash del primero: la salida pendiente se rechaza. Scope ausente, tenant/schema ajeno, scope sustituido, conexión/contacto cambiado: cero envío. Conversación con atribución v1 y turno legítimo v2 no se rechaza por esa atribución histórica.
3. Texto v1 en replay tras v2: no se etiqueta con v2. Lote parcial conserva palabras/índices originales; ningún writer se repite al recuperar un mensaje bloqueado.
4. Retiro de fuente, cambio de proyección y fuente heldout retirada antes de admisión: bloqueo. Retiro/rollback después del receipt: conserva evidencia sin duplicar. Borrado entre preparación y envío: no usa payload; finalizador tardío no lo restaura.
5. Privacy S → erasure X en cola → guard/uso: demostrar ausencia de segunda TX S y de locks de tenant/agente durante proveedor; no basta un mock del helper.
6. Lost ACK de INSERT/COMMIT/enqueue: identidad conservada, sin job sin ID. Crash antes del permiso: recuperación segura; crash tras permiso: reconciliación. Receipt recibido y fallo al guardarlo: nunca otro POST. Cinco fallos preenvío no vuelven a cero por rollback.
7. Messenger: imagen aceptada/caption fallido no repite imagen; receipts separados. Flow: timeout no hace fallback; rechazo explícito permite solo un fallback con su propia admisión. Ningún reintento oculto en adaptadores.
8. Widget: mismo resultado privado del core, rollback conjunto, ACK de COMMIT perdido, replay/reconexión y recibo autenticado. `stored` permanece distinto de `delivered`. Borrado impide recuperar texto mediante cache/historial.
9. Regresión de humanos, sugerencias draft, automations y avisos operativos: no pasan accidentalmente por la política de versión del modelo; no usar metadata pública para declarar esa excepción.

Referencias de tests existentes que deben conservarse o ampliarse: `widget/widget-delivery.postgres.spec.ts`, `conversations/conversations.widget-containment.spec.ts`, `channels/outbound-queue.processor.entitlement.spec.ts`, `channels/outbound-approved-effect.spec.ts`, `channels/outbound-operational-notice.spec.ts`, `tenant-payments/payment-agent-authority.postgres.spec.ts`, `ai/router/llm-source-authority.spec.ts` y `conversations/agent-turn-source-authority.spec.ts`. `conversations/media-delivery-dedupe.spec.ts` comprueba forma de código; no sustituye carreras, fallos parciales ni ACK perdido.

No se han ejecutado esas nuevas pruebas porque la implementación descrita aún no existe. La siguiente entrega debe declarar por canal y tipo de ítem qué admisión/receipt está probado; conectar funciones o añadir campos no basta para dar por cerrada esta frontera.
