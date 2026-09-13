# Recibo canónico de handoff y admisión de la salida normal de Web Chat

8 de septiembre de 2026. Continuación de [el traspaso](../../handoffs/2026-09-08/claude-execution-handoff.md), que dejó la integración de salida normal conservada en un parche y sin activar. Este documento registra lo que se construyó, con qué se comprobó y qué sigue abierto. No hubo push, despliegue, llamadas a proveedores reales ni migración de tenants operativos.

## Commits

| Commit | Comportamiento incorporado | Validación sobre el índice exacto |
| --- | --- | --- |
| `64dc8d75` | Recibo durable de handoff ligado al inbound y a la transición exactos; transición atómica; `executeHandoffOnce` | TypeScript API pasa. 10 suites / 103 pruebas, incluidas cuatro suites PostgreSQL/Prisma y el bootstrap de NestJS; cero omitidas |
| `d2ffdf41` | Integración del parche conservado + admisión local autorizada por el recibo en los siete puntos de escalada | TypeScript API pasa. 15 suites / 171 pruebas, incluidas 5 suites PostgreSQL / 104 pruebas y el bootstrap; cero omitidas |
| `02dc2e9e` | Aceptación: historial borrado y sin seguimiento, carreras durante la admisión, frontera del COMMIT | TypeScript API pasa. 12 suites / 165 pruebas, incluidas 5 suites PostgreSQL y el bootstrap; cero omitidas |

Las baterías se solapan entre bloques; no sumarlas como cobertura nueva.

## El defecto y por qué hacía falta un recibo

El flujo podía ejecutar la transferencia, dejar la conversación en `waiting_human` e intentar después guardar el aviso. El store rechaza correctamente una respuesta nueva del modelo cuando la conversación pertenece a una persona: ocurría el handoff y el cliente recibía un error.

Ni el identificador Redis `hoff_<timestamp>` ni `metadata.handoff` sirven como autoridad. No nombran el inbound que causó la transferencia, no sobreviven como prueba cuando la conversación vuelve a la IA, y la metadata pública de conversación es alcanzable por cualquier escritor.

`agent_handoff_receipts` (esquema por tenant) registra la transferencia como hecho durable. Dos propiedades hacen el trabajo:

- `inbound_message_id` es UNIQUE. Un inbound transfiere una conversación como máximo una vez, así que recuperar el aviso nunca repite la transferencia y un webhook reenviado no puede escalar dos veces.
- `from_status` se lee bajo el lock de la fila de conversación en la misma transacción que hace la transición, y la tabla rechaza por CHECK un recibo cuyo `from_status` ya sea humano o terminal. El recibo es entonces prueba de que el agente todavía era dueño cuando empezó el turno.

El texto del aviso no se guarda. El recibo nombra un tipo y uno de cuatro idiomas; las palabras se derivan del catálogo cerrado (`handoff-notice.ts`) en el momento de la admisión. Ningún llamador puede suministrarlas.

## La transición es atómica

Estado, marca de resolución para analítica, nota interna y —cuando se pide— el recibo eran tres sentencias independientes y ahora confirman juntas. Un fallo entre ellas ya no puede dejar una conversación transferida sin nota, ni un recibo que describa una transición que no ocurrió. El DDL perezoso se elevó por encima de esa transacción. Este cambio aplica a **todos** los canales, no solo a Web Chat.

`executeHandoffOnce` escala una vez o recupera lo que un intento anterior registró. Un turno concurrente que pierde el índice único **o** el lock de fila revierte su transición entera y lee el recibo ganador: notas, asignación y notificaciones nunca se repiten para obtener un aviso que ya existe.

## Siete puntos de escalada, no dos

El traspaso pedía revisar el handoff directo y el posterior a herramientas. El barrido encontró **siete** lugares que pueden transferir durante un turno:

| Lugar | Aviso que el recibo debe |
| --- | --- |
| Disparador directo en `processWidgetMessage` | `queue_head` |
| Capacidad bloqueada (`capability_denied_intent`) | `none` — el texto del motor ya lo anuncia |
| Autoridad de reserva denegada | `transferring` |
| Motor de reservas sin salida | `none` |
| Motor de procedimientos | `none` |
| Escalada posterior al intake | `transferring` |
| Promesa del agente honrada | `none` — el modelo ya lo prometió |

Los siete ligan su transferencia al inbound cuando el turno es del núcleo de Web Chat. Una sola lectura indexada de ese recibo decide cómo se admite el turno: si existe, autoriza exactamente un mensaje, la respuesta que el turno ya había producido seguida de la frase determinista que el recibo nombra.

El recibo amplía **cuándo** pueden admitirse palabras, nunca **de quién**. Las palabras del modelo conservan cada control de autoridad, revisión y procedencia que enfrentan en una conversación que el agente todavía posee. Una conversación que alguien devolvió a la IA dentro del turno rechaza el aviso en vez de prometer una persona que nadie asignó, y el turno cae a admitir solo su propia respuesta.

Otros canales conservan la transferencia sin ligar: su ruta saliente no tiene una admisión local que un estado humano pueda rechazar, y ligarlos exige su propio inventario de persistencia del inbound.

## Evidencia por comportamiento

Todo con PostgreSQL real y, en las carreras, una segunda conexión sosteniendo locks reales; no un mock del helper.

- **Recibo** (`handoff-receipt.postgres.spec.ts`, 13 casos): registra estado e identidad de canal leídos de la fila bloqueada, no de lo que declara el llamador; rechaza conversación ya humana, terminal, inbound ausente/saliente/de otra conversación, contacto ajeno y alcance inválido; un segundo recibo para el mismo inbound se rechaza; el recibo revierte junto con la transición; se recupera por su vínculo exacto y sobrevive al borrado de los mensajes que nombra; a través del servicio, transfiere una vez y reproduce el aviso, y un turno concurrente recupera el recibo ganador sin una segunda transferencia.
- **Aviso** (`widget-agent-reply.postgres.spec.ts`, 8 casos): una respuesta simple del modelo sigue rechazada en conversación humana; el aviso del recibo se entrega una vez y se recupera; la respuesta previa del turno se conserva antes del aviso; las palabras del modelo aplican las mismas reglas de autoridad y procedencia, y sin ellas el aviso determinista no necesita revisión de agente; el borrado alcanza la respuesta preservada; sin recibo, o con el recibo de otro turno, se rechaza; devuelto a la IA dentro del turno, se rechaza; `none` sin texto previo guarda silencio y no crea fila.
- **Historial** (4 casos PostgreSQL + 3 del núcleo): procedencia heredada y confianza por mensaje; un saliente sin recibo es historial sin seguimiento, nunca prueba de ausencia de aprendizaje; un borrado entre leer el texto y leer su procedencia bloquea esas palabras; mensajes de otra conversación rechazados.
- **Carreras durante la admisión** (4 casos): versión publicada, cambio del agente que sirve la conexión y retiro de una fuente **holdout** detrás del fence exclusivo de privacidad se rechazan tras bloquear en el mismo lock que se toma en producción; un cambio ajeno sigue admitiendo; una edición de la propia conversación hace que la admisión se rinda de forma acotada en vez de encolarse tras la inversión de locks del editor de mensajes, y ese rechazo no envenena nada.
- **Frontera del COMMIT** (2 casos): mensaje, recibo e índice de fuentes revierten juntos; un COMMIT que el llamador vio fallar se recupera sin guardar la respuesta dos veces.

## Hallazgo: una suite del plan estaba en rojo antes de esta tanda

`conversations/conversations.widget-containment.spec.ts` —listada en el plan de despacho como suite a conservar— fallaba en `7c613864`. Se verificó en un worktree limpio de ese commit: el fixture seguía esperando la firma de `generateResponse` anterior al `operationalScope`. Los conteos de validación de la tanda anterior no la incluían. El parche conservado ya traía su corrección; quedó verde al integrarlo.

## Límites explícitos

- `stored` sigue sin significar que el navegador recibió nada. El recibo del navegador es un hecho aparte.
- La mitad de transporte de la aceptación tiene su propia evidencia en `widget-delivery.postgres.spec.ts`, incluidos replay con Socket.IO real y recibo autenticado, pero ese harness todavía no se condujo de extremo a extremo para una **respuesta normal** del agente.
- Recuperar un turno cuyos writers ya corrieron sigue reejecutándolos. Es el ítem abierto de generación durable; esta tanda no lo cambia ni lo empeora.
- Un cambio de revisión del agente entre la resolución y la admisión rechaza también el aviso cuando el turno traía palabras del modelo. Es la misma regla que aplica a una respuesta normal; la ventana es de milisegundos y no se inventó una admisión parcial que nada pruebe.
- El DDL está en `tenant-schema.sql` y en el bootstrap perezoso; no se aplicó a tenants existentes.
- La lectura del recibo ocurre una vez por turno de Web Chat. Es una consulta indexada, elegida sobre plomería en banda porque también cubre escaladas que este barrido no enumeró.
