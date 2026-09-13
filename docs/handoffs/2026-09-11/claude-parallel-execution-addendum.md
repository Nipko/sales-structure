# Addendum para Claude: cierre paralelo seguro desde `0da81979`

Actualización de alcance: incorporar también
[herramientas, 76 tipos de negocio y Assist](./claude-tools-business-profile-alignment.md).
Sus pendientes locales forman parte del mismo cierre; no quedan resueltos por
terminar el carril durable de WhatsApp.

## Mandato

Continúa el programa de cierre definido en
[`claude-whatsapp-runtime-and-release-local-closure-v2.md`](./claude-whatsapp-runtime-and-release-local-closure-v2.md).
Este documento reemplaza cualquier declaración de que las fases 1 y 2 están
completas y organiza el trabajo restante para usar agentes en paralelo sin
dividir la autoridad central entre varios escritores.

El punto de partida auditado es `0da81979814b97e437f325f1bf4795bd4c3cf037`.
Antes de crear frentes de implementación, confirma que el HEAD contiene ese
commit y conserva intactas estas cuatro entradas ajenas:

- `CLAUDE.md`
- `docs/plan-profitability-2026-07.md`
- `.validate-index.cjs`
- `docs/whatsapp-meta-pricing-2026-10.md`

No uses `git add .`. Haz commits pequeños por invariante. No hagas push, merge,
deploy, activación de `enforce`, llamadas a proveedores, modelos pagos ni gasto.
No presentes una ola parcial como cierre del programa.

## Gate 0 serial: corregir la autoridad común antes de repartir productores

Una auditoría independiente reprodujo brechas en las fases declaradas cerradas.
El integrador principal debe corregirlas primero, en serie, porque todas las
ramas de productores dependerán de estos contratos.

### Recibos, reintentos y credenciales

1. Un receipt que llega antes de que se persista el `wamid` no puede quedar
   terminal como `applied/unknown_receipt`. Debe conservarse pendiente y
   reaplicarse idempotentemente cuando aparezca la asociación. Prueba el orden
   receipt → accepted, duplicados, dos workers, `delivered`, `failed` y 131042.
2. Un rechazo concluyente pero retryable, como 429 o un 5xx clasificado por el
   contrato, no es un timeout. El outbox y el ledger deben permitir el siguiente
   intento sin duplicar reserva ni POST. Prueba dos intentos con el store real,
   ledger real y conteo de solicitudes.
3. Un 2xx sin `messages[0].id` no puede inventar `unknown-${Date.now()}` ni
   registrarse como aceptación. Trátalo como resultado indeterminado e incidente
   de contrato, sin segundo POST automático.
4. La lectura de una pausa económica debe fallar cerrada. Un error de Redis o
   PostgreSQL no equivale a “no pausado”.
5. La revocación de credenciales debe ser monotónica y fail-closed aun si falla
   `INCR`, Redis se recupera o una resolución cruza una rotación. Un fallo al
   leer `channel_accounts` tampoco puede declarar utilizable la conexión.
6. La actualización de estado de plantillas por webhook debe reintentarse si la
   escritura falla; no tragues el error y completes el job. Mantén el aislamiento
   ya logrado por WABA.
7. Elimina o unifica la segunda implementación divergente de
   `resolveSendContext`; una ruta futura no puede volver a `payer.kind=unknown`.

### Fundación del carril proactivo

1. No falsifiques `ServedAgentAuthority` para un scheduler. Modela una autoridad
   durable y verificable de primer nivel para el origen proactivo, por ejemplo
   una unión cerrada `served_agent | proactive_policy`, con tenant, conexión,
   productor, entidad/revisión y versión de política. Revalídala dentro de la
   misma transacción que concede el lease. Los recordatorios actuales pasan un
   objeto sin `kind` ni hash y el store real responde
   `dispatch_authority_required`.
2. Conserva `originKind` en la fila leída y úsalo para decidir
   `reactive/proactive`. La presencia de `inboundMessageId` no sirve: el origen
   proactivo también deriva un UUID y hoy se cobra como reactivo.
3. Conserva procedencia real del productor y revisión de dominio. No reemplaces
   todo por `dispatch_${itemKind}`. El procesador debe poder revalidar que una
   cita, campaña, regla o tarea sigue vigente antes del POST. Cancelar o
   reprogramar después de preparar debe suprimir o reemplazar el efecto con una
   transición auditable; una repetición no puede adoptar un payload viejo.
4. Valida `conversationId`, `contactId`, `channelType` y `channelAccountId`
   juntos en preparación y admisión. Un efecto no puede escribir en el historial
   de otro número y cobrar desde el número almacenado.
5. `conversationFor` debe crear o encontrar una conversación activa sin carrera.
   Añade una restricción/llave o un lock transaccional; no reutilices una
   conversación resuelta o archivada y no delegues a un supuesto merge posterior.
6. Decide gasto antes de entregar un lease capaz de transmitir, o revoca el
   lease de forma atómica cuando la admisión económica falla antes del POST. Una
   caída del medidor no puede dejar un lease `admitted` que luego parezca un
   posible envío y pase a reconciliación.
7. Pasa al gate toda la semántica que decide el precio: template y su categoría,
   ventana de servicio comprobada, país/remitente, tipo de item y cualquier otro
   dato autoritativo. Bajo `enforce`, una plantilla válida no puede caer en
   `category_unknown`; un texto proactivo no puede asumirse dentro de ventana.
8. Extiende `DispatchItem` y el transporte para cubrir los efectos REST reales,
   incluidos interactive y location, antes de migrar esos endpoints. Un tipo no
   soportado no cuenta como productor migrado.
9. `ProactiveDispatchService.send` debe devolver un resultado cerrado y
   comprobable (`prepared`, `already_present`, `suppressed`, `deferred` o error),
   no un UUID/null ambiguo. Los productores sólo escriben su flag “sent” después
   de que el efecto durable correcto exista. Los recordatorios actuales convierten
   un `false` en `void` y después marcan la cita como avisada.
10. Prueba los recordatorios a través de `AppointmentRemindersService` con
    PostgreSQL y el `AgentDispatchOutboxStore` reales. Incluye sender incorrecto,
    cita cancelada/reprogramada, dos crons, crash antes y después de publicar,
    COMMIT incierto y que el flag queda falso cuando no se preparó el efecto.

No empieces la migración paralela hasta que este gate tenga pruebas rojas antes
del arreglo, verdes después, mutaciones en los enlaces críticos y el inventario
regenerado desde el mismo HEAD.

## Cómo usar agentes en paralelo

Usa un worktree y una rama por agente, todos creados desde el mismo commit que
cierra Gate 0. Nunca permitas dos escritores sobre el mismo working tree. Cada
agente debe recibir dueño exclusivo de archivos, objetivo, pruebas y condición
de salida. El integrador principal conserva la autoridad sobre los contratos
compartidos y hace los cherry-picks uno por uno.

Archivos reservados al integrador durante la migración:

- `agent-dispatch-outbox.ts`
- `agent-dispatch-outbox.store.ts`
- `outbound-queue.processor.ts`
- `proactive-dispatch.service.ts`
- `channels.module.ts`
- schemas, migraciones y tipos compartidos del carril
- el generador e inventario final de productores

Ningún agente de productores debe editar esos archivos. Si descubre que falta
una capacidad común, entrega un test mínimo o una descripción reproducible al
integrador y espera la nueva base antes de continuar.

### Ola 1: llevar los 21 call sites cobrables al carril durable

Primero vuelve a ejecutar el generador porque el artefacto versionado está
desactualizado. Usa su lista actual, no números de línea copiados. Con el censo
de `0da81979`, la partición inicial es:

**Agente A — automatización y campañas (7 call sites):**

- `automation/automation-jobs.processor.ts`
- `automation/drip-sequence.service.ts` (3)
- `automation/nurturing.service.ts` (2)
- `broadcast/broadcast-queue.processor.ts`

**Agente B — conversación, humano y REST (12 call sites):**

- `agent-console/agent-console.service.ts`
- `conversations/conversations.service.ts` (6)
- `whatsapp/whatsapp.controller.ts` (5)

Si la suma del censo demuestra que este frente es demasiado grande, separa REST
en otro worktree. No dividas `conversations.service.ts` entre dos escritores.

**Agente C — operaciones (2 call sites):**

- `appointments/appointment-notifications.service.ts`
- `recall/recall.service.ts`

Cada migración debe aportar una identidad lógica basada en el registro durable
del dominio, número pagador explícito, conversación/contacto exactos, categoría
y ventana correctas, revisión revalidable y transición del flag de negocio sólo
después de preparar. Prueba replay, dos workers, cancelación, fallo de cola,
fallo de proveedor y resultado incierto. La condición de salida de la ola es:

- cero productores WhatsApp cobrables fuera del gate económico;
- cero productores WhatsApp cobrables fuera del carril durable;
- cero tipos de item aceptados por la API que el carril no pueda representar;
- generador y artefacto en paridad con el HEAD.

### Frente paralelo independiente: candidato y cutover

Un agente adicional puede trabajar al mismo tiempo sólo sobre:

- `.github/workflows/candidate.yml` y workflows de release relacionados;
- `infra/scripts/**` y `infra/docker/docker-compose.prod.yml`;
- pruebas de esos scripts y `docs/runbooks/october-cutover.md`.

Debe cerrar los puntos 1–10 de la fase 6: autorización ligada al SHA y environment
protegido, permisos mínimos por job, mapa servicio→repositorio, artefactos sólo
desde runs verdes, stack real, write barrier, dump/restore fatal, rutas/cwd,
digests y reanudación. No debe tocar runtime de canales, schemas de aplicación,
dashboard ni archivos de productores.

### Ola 2: producto y control operable

Después de congelar el contrato API del gasto, abre dos worktrees:

1. **Backend de producto:** readiness de financiación, límites por WABA/número,
   consumo por mes calendario y país/categoría, selector obligatorio de conexión,
   estimador de campaña y estados autoritativos.
2. **Experiencia:** Dashboard, onboarding, Assist, tours, accesibilidad, landing,
   manuales, ayuda contextual y `apps/api/kb/assistant/{es,en,pt,fr}`. Toda cadena
   nueva o modificada debe existir en es/en/pt/fr. Prueba escritorio, móvil,
   teclado y lector de pantalla.

El frontend consume un contrato congelado; no permitas que ambos agentes editen
el mismo DTO mientras trabajan.

### Ola 3: identidad Meta y autoridad de cierre

La implementación BSUID/BISU y coexistencia con el agente Meta debe tener un
solo escritor porque cruza ingress, identidad, conversación, outbox, CRM,
aprendizaje y erasure. Otros agentes pueden hacer auditorías de sólo lectura y
crear casos adversariales, pero no editar esos hotspots en paralelo.

En otro worktree independiente, añade M0–M6/R0–R6 a
`generate-closure-report.cjs`, conecta cada fila con una condición ejecutable y
haz que el costo/cantidad del canario provenga de un solo generador.

## Integración y validación

El integrador hace cherry-pick de una rama a la vez y corre sus pruebas focales
antes de la siguiente. Cada worktree con PostgreSQL usa una base o schema propio
y un namespace Valkey propio. No ejecutes suites completas concurrentes contra
una base compartida: eso mide contaminación entre agentes, no el producto.

Cuando todo esté integrado:

1. regenera inventarios y reportes;
2. ejecuta migración limpia, upgrade y bajo carga;
3. ejecuta suite completa, tres órdenes, Dashboard, Playwright escritorio/móvil,
   typechecks, builds, bootstrap, lint y todos los `--check`;
4. lanza dos revisores adversariales de sólo lectura: uno para runtime/economía y
   otro para producto/release;
5. corrige todos sus hallazgos y repite la validación sobre el nuevo HEAD.

El informe final debe indicar el rango exacto, commits, pruebas del HEAD final,
censo derivado, brechas locales (deben ser cero) y gates externos. Que una suite
esté verde no reemplaza la prueba de los caminos reales descritos arriba.
