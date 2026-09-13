# C1 — continuidad y autoridad de la misión

## Problema reproducido

Los motores conservaban sus estados de forma independiente, pero el orden del orquestador decidía quién consumía el mensaje. Un procedimiento esperando `reason:string` podía guardar «quiero reservar una cita» o «cambia mi correo…» como motivo. Dos gestiones pausadas no tenían una selección común. Una confirmación pendiente del ledger podía reaparecer después de cambiar de tarea. El token de WhatsApp Flow no estaba ligado de extremo a extremo a la revisión de la reserva.

## Cambio implementado

- Contrato `ConversationMissionFocusV1`: misión seleccionada, revisión de consentimiento, versión de escritura, respuesta esperada y referencias de intenciones pausadas. Los datos del formulario permanecen en su motor; el foco contiene identificadores.
- El árbitro del core elige antes de recoger campos o buscar consentimiento. Dos objetivos identificables piden una elección; pausar conserva los campos. La reanudación nombrada selecciona la gestión y vuelve a presentar cualquier propuesta anterior.
- La corrección debe identificar un único campo conocido. Se valida con su tipo y se vuelve al siguiente paso; se descartan respuestas derivadas. No se retrocede a través de un comando ya ejecutado. Incluye imperativos habituales en es/en/pt/fr.
- Los puertos de booking, procedimientos y herramientas tienen `executionOwner` propio. El control central comprueba ese dueño y el dominio sobre la política efectiva. Una llamada del modelo no puede apropiarse del consentimiento de un motor. Lecturas de conocimiento y MCP revisadas como lectura siguen disponibles.
- El token de consentimiento firma misión y revisión. Además debe coincidir con la propuesta esperada y responder a un mensaje anterior. El foco registra el inbound consumido y el core no vuelve a usarlo para otra tarea. El ledger sigue siendo la autoridad de idempotencia del comando.
- WhatsApp Flow requiere el token del formulario vigente, la misión, la revisión y `waiting_flow`. Un formulario viejo no sobrescribe el vigente. El comando vuelve a comprobar disponibilidad y términos canónicos.
- PostgreSQL guarda el foco con compare-and-set y el mismo fence de privacidad que el borrado. Los checkpoints de booking/procedimientos también verifican tombstone dentro de ese fence. Un checkpoint atrasado no puede restaurar campos después del borrado. Agent Test usa exclusivamente sus puertos de estado de sesión; no escribe estados en el tenant origen.
- `ProcedureProcessResult` devuelve identidad de la misión realmente procesada y sus resultados de herramientas. El core conserva esos resultados para evidencias, historial y guardrails, aunque al terminar se restaure otra misión pausada.
- Los errores de matrícula expuestos al diálogo se limitan a códigos conocidos; una excepción SQL arbitraria se convierte en `enrollment_operation_failed`.

## Evidencia

Validación ejecutada en Windows con Jest/ts-jest y PostgreSQL desechable en loopback. Cada caso PostgreSQL crea y destruye su propio namespace; usa DDL canónico, FKs y comandos reales, sin calendarios ni proveedores externos.

1. Batch general: **22 suites, 270 pruebas aprobadas**. Incluye motores, consentimiento central, Agent Test, guardrails, flujo público existente y 24 casos PostgreSQL.
2. Después de añadir cuatro recorridos de procedimiento real y las regresiones de lecturas/MCP: **4 suites, 87 pruebas aprobadas** (`isolated-canonical-commands`, `tool-execution-control.service`, `conversations.mission-continuity`, `native-evidence-writers-contract`). El archivo PostgreSQL suma **28 casos aprobados**.
3. TypeScript API: `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` aprobado.

La revisión cruzada añadió un recorrido PostgreSQL de Eval → Agent Test → core → ledger: el recorder retorna el ID de inbound insertado y los adaptadores conservan ese mismo ID. Un ID ausente se rechaza antes del modelo. El archivo canónico alcanza 29 casos PostgreSQL. Eval, Simulation y aprendizaje propagan ese identificador exclusivamente mediante opciones del servidor. El gate rechaza mensajes fuera de su límite en vez de cortar silenciosamente el desenlace. Agent Test permite elegir un borrador almacenado y mantiene esa revisión durante la sesión.

Aprendizaje toma sus mediciones antes/después del namespace propio con lease; no de las tablas del tenant fuente. Dos pruebas con Prisma/PostgreSQL comprueban la diferencia y que la fuente permanece intacta. La interpretación exacta de efectos y replays sigue en revisión separada.

Recorridos nuevos observados:

- En los cuatro idiomas: devolución recoge correo → nueva cita pausa devolución → pausar cita → continuación genérica pide elección → reanudación nombrada de cita/devolución → corrección del correo sin almacenarla como motivo.
- En los cuatro idiomas: cancelar un pedido conserva la reserva en curso y selecciona el dominio del objeto solicitado.
- En PostgreSQL, cuatro idiomas: propuesta de matrícula → cambiar a reserva → «sí» no matricula → volver a matrícula genera propuesta nueva → el mismo inbound no la confirma → una respuesta posterior crea una sola matrícula.
- En el core real, cuatro idiomas: dos herramientas de dominios distintos en el mismo turno no comparten autorización; el segundo «sí» crea una matrícula y cero reservas de gimnasio. Repetir ese inbound conserva exactamente esos conteos y el foco.
- Procedimiento real, cuatro idiomas: correo → propuesta de matrícula → consentimiento posterior → una matrícula, pago pendiente, cero reservas de gimnasio; el resultado canónico llega a las acciones recientes del core.
- Flow: owner ajeno, token antiguo o revisión cambiada producen cero citas; token vigente produce una, y replay conserva una.
- Compare-and-set rechaza una actualización concurrente. Tombstone rechaza foco y checkpoints atrasados de ambos motores sin reintroducir el correo borrado.

## Límites explícitos

El árbitro usa dominios, nombres y palabras de activación declarados, más lenguaje de control acotado. No pretende interpretar cualquier combinación arbitraria de lenguaje natural. Las correcciones ambiguas y las fechas que no pasan el contrato tipado piden aclaración. La continuación de una misión no confirma automáticamente una operación ni revierte un comando anterior.

El ledger, las reglas de identidad, los términos del dominio, la plantilla y las aprobaciones continúan decidiendo qué se puede ejecutar. El foco sólo restringe quién puede usar cada respuesta. Esta tanda no certifica todos los procedimientos que un tenant pueda escribir ni la recepción de mensajes por proveedores externos.
