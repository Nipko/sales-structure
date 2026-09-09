# Estado del programa A1–H3, decidido por el código

Generado por `docs/audits/2026-09-09/generate-closure-report.cjs`. Cada fila declara una **condición**, y
el estado sale de ella: con una condición local sin cumplir la fila está `abierta`; con la condición
cumplida y un gate externo nombrado está `bloqueada`; sólo sin condición y sin gate está `aceptada`.
Cerrar un hueco cambia esta tabla cambiando el código, y reabrirlo la cambia de vuelta.

Revisión: `b9f67348ef116a9070e48f3ae16cc0fb9b5bc536`.

**El programa no está terminado.** 3 filas aceptadas, 17 bloqueadas por un
gate externo concreto y 5 abiertas; 0 perfiles certificados
de 76.

Sin contradicciones: ninguna fila se declara aceptada con una condición abierta o un gate pendiente, ninguna se declara bloqueada sin nombrar el gate y ninguna se declara abierta sin decir qué falta.

## Los cinco gates externos

1. credenciales y cuentas de canal para pilotos reales (WhatsApp, Instagram, Messenger, Telegram).
2. credenciales de proveedor LLM, modelo, techo de gasto y autorización de ejecución.
3. personas nuevas reclutadas para sesiones moderadas.
4. cuentas autorizadas de alternativas y revisores ciegos.
5. autorización posterior para push, despliegue, migración y activación.

## Las 25 filas

| ID | Estado | De dónde sale | Qué falta | Evidencia | Commits |
|---|---|---|---|---|---|
| A1 | **abierta** | contador | 10 familias sin comando ligado y 3 sin cobro ligado | Inventario calculado de 15 familias (`terms-binding-inventory.ts`). Cita y matrícula ligan comando y cobro; el pedido de catálogo pasó a cobrar desde `orders.catalog_terms` y a rechazar la fila que no acordó nada. Sin comando ligado: `appointment_transitions`, `repair_orders`, `class_bookings`, `insurance_quotes`, `property_bookings`, `tour_bookings`, `restaurant_orders`, `service_requests`, `photo_sessions`, `resource_rentals`. Sin cobro ligado: `property_bookings`, `tour_bookings`, `restaurant_orders`. | `a806ef62` `f121dc5f` |
| A2 | **bloqueada** por gate 1 | **declaración** | — | Comando, retención, settlement, avisos durables y revisión sin reenvío implementados y probados con PostgreSQL. La conciliación contra un proveedor real no puede correrse sin su cuenta. | — |
| A3 | **bloqueada** por gate 1 | **declaración** | — | Propuesta, consentimiento, aprobación humana y entrega durable probados con PostgreSQL y Socket.IO. La entrega real necesita un canal conectado. | — |
| A4 | **bloqueada** por gate 1 | **declaración** | — | Transacciones, lectores, promoción y restauración única comprobadas contra PostgreSQL. | — |
| B1 | **bloqueada** por gate 1 | corrida (`docs/audits/2026-09-09/order-sensitivity-runs.md`) | — | El turno completo corre de punta a punta sobre PostgreSQL, Valkey, BullMQ y Socket.IO reales, con crash en cada frontera, una erasure en vuelo y los primitivos a través de un PgBouncer real en modo transacción. | — |
| B2 | **aceptada** | contador | — | Las 15 familias del registro tienen writer canónico auditado, con id de inbound compartido con el runtime y el ledger. Cero bloqueadas. | — |
| C1 | **bloqueada** por gate 1 | **declaración** | — | Árbitro, dueño por puerto, consentimiento por misión, corrección y reanudación probados en los cuatro idiomas del contrato (es/en/pt/fr). | — |
| C2 | **abierta** | contador | 10 familias cuyo writer ejecuta sin que le muestren lo acordado | Ciclos de agenda y de mascotas con recibos atómicos comprobados. El cierre de esta fila es el mismo que el de A1. | — |
| C3 | **bloqueada** por gate 2 | contador | — | Contratos MCP y dependencias base implementados. El ejecutor está cableado a servicio, cola y endpoint, y se ensaya sin proveedor; la cobertura por tarea la decide una corrida real: 0 perfiles certificados de 76. | — |
| D1 | **bloqueada** por gate 3 | **declaración** | — | Muestreo, revisión humana con CAS y anotaciones RAG implementados. No se certifica veracidad global y el propio informe lo dice; una revisión de muestra necesita personas. | — |
| D2 | **abierta** | **declaración** | calidad semántica bajo carga sin dataset, umbrales ni números publicados | CAS, recuperación, fusión de identidad y borrado comprobados con pgvector real. Disponibilidad bajo carga está medida; calidad semántica bajo carga no, y una no es la otra. | — |
| D3 | **bloqueada** por gate 3 | **declaración** | — | Atribución observable y diagnóstico técnico probados. No equivalen a veracidad ni a entailment, y el informe lo dice. | — |
| E1 | **aceptada** | contador | — | 76 perfiles, 268 tareas, 146 que comprometen al negocio, y cero tareas sin caso positivo propio o sin verificador fuera de las 5 declaradas: `file_claim` en las cinco subtipos de seguros existe para probar que el escalón de identidad la rechaza, así que no hay efecto que verificar y un "positivo" sería el agente haciendo lo que no debe. Certificar estas tareas es H1. | — |
| E2 | **abierta** | **declaración** | lectores comerciales sin congelar y sin evaluación bajo tráfico concurrente | Núcleo, FAQs, políticas, temporalidad, réplica RAG administrada, jueces y retención integrados. | — |
| E3 | **bloqueada** por gate 5 y 1 | **declaración** | — | Outbox durable, transporte estricto, recuperación, reconciliación con actor y evidencia, pantalla de operador y alerta real. El interruptor sigue apagado por defecto: encenderlo es una activación. | — |
| F1 | **bloqueada** por gate 2 | contador | — | Assessment común implementado y probado; su cierre es una corrida real de certificación, cuyo ejecutor ya existe y se ensaya sin proveedor. | — |
| F2 | **aceptada** | contador | — | Cada blocker y cada recomendación del assessment tiene resolución declarada, con prueba de cobertura que falla al aparecer un código sin ella; el universo lo produce el código que emite los códigos, no un barrido de texto. Las 8 operaciones que Assist no ejecuta declaran requisitos no secretos, preparación, pantalla exacta y qué releer al volver. | `37411849` `f2a976d6` |
| F3 | **bloqueada** por gate 3 | **declaración** | — | Recorridos por tareas verificadas implementados y con pruebas de accesibilidad automáticas. Las sesiones moderadas necesitan personas. | — |
| F4 | **bloqueada** por gate 3 | **declaración** | — | Un solo vocabulario de seis estados proyectado y mostrado en el tablero. La validación visual necesita personas. | — |
| G1 | **abierta** | contador | 7 lugares donde las palabras del agente descansan sin alcance completo | 20 lugares inventariados con barrido del árbol de fuentes, cada uno diciendo qué lo alcanza y por qué. Abiertos: `eval_runs`, `simulation_runs`, `agent_release_evidence`, `quality_regression_cases`, `handoff_summary`, `quality_scores`, `outbound_queue_job`. | `d366baf3` |
| G2 | **bloqueada** por gate 3 | **declaración** | — | Curación y revisión en cuatro idiomas implementadas. La revisión humana de muestra necesita personas. | — |
| G3 | **bloqueada** por gate 1 | **declaración** | — | Comparación por runtime y evidencia en seis familias; publicación gradual y retiro implementados. | — |
| H1 | **bloqueada** por gate 2 | corrida (`docs/audits/2026-09-09/certification-manifest.md`) | — | Ejecutor durable construido: 3 tablas, arriendo con `clock_timestamp()`, resultado escrito una sola vez, reintento como intento nuevo, presupuesto y deadline verificados antes de entregar trabajo, invalidación por definición de escenario y por autoridad del agente, y el reporte alimentado desde esas filas. El manifiesto de costo por modelo está calculado. Ejecutarlo necesita una credencial y un techo de gasto autorizado. | `e1ac3943` `4ec45699` |
| H2 | **bloqueada** por gate 2 | **declaración** | — | Regresiones desde QA y ledger, linaje, identidad de misión y denominadores implementados; un resultado desconocido conserva ese estado y no se inventa tasa. Sus denominadores se llenan con la corrida de H1. | — |
| H3 | **bloqueada** por gate 4 y 1 y 3 | corrida (`docs/audits/2026-09-09/adversarial-validation.md`) | — | Harness local construido: corpus generado y estratificado desde el catálogo con verificadores de resultado, sujetos sintéticos ejecutados, 2 tablas de intentos y revisión ciega, y una negativa a enunciar comparación cuando falta el otro sujeto. Correr una alternativa necesita su cuenta. | `aaf41d62` |

## De dónde sale cada fila

8 filas salen de un contador leído del código: cerrar el hueco las cambia solo.
3 descansan sobre un artefacto de una corrida real, nombrado en la tabla.
**14 son declaraciones humanas pendientes de revisión**: A2, A3, A4, C1, D1, D2, D3, E2, E3, F3, F4, G2, G3, H2. Cambiar el código de esas áreas no cambia su estado, y por eso se dicen aparte en vez de presentarse como calculadas.

## Los contadores de los que sale la tabla

| Autoridad | Valor |
|---|---:|
| Perfiles del catálogo | 76 |
| Tareas | 268 |
| Perfiles certificados | 0 |
| Tareas sin positivo o sin verificador, fuera de las declaradas | 0 |
| Familias con términos inventariadas | 15 |
| Familias sin comando ligado | 10 |
| Familias sin cobro ligado | 3 |
| Familias de writer bloqueadas | 0 |
| Lugares donde descansan las palabras del agente | 20 |
| De ellos, abiertos | 7 |
| Canales de autoservicio | 5 |
| Canales certificados | 0 |
| Operaciones que Assist deriva a una pantalla | 8 |
| Defectos en la tabla de resolución de Assist | 0 |

Para actualizar: `node docs/audits/2026-09-09/generate-closure-report.cjs` desde la raíz.
