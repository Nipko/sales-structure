# Estado de los programas A1–H3 y M0–M6/R0–R6, decidido por el código

Generado por `docs/audits/2026-09-09/generate-closure-report.cjs`. Cada fila declara una **condición**, y
el estado sale de ella: con una condición local sin cumplir la fila está `abierta`; con la condición
cumplida y un gate externo nombrado está `bloqueada`; sólo sin condición y sin gate está `aceptada`.
Cerrar un hueco cambia esta tabla cambiando el código, y reabrirlo la cambia de vuelta.

Revisión: `d3cd50f292c26eb49ad35dcfb8aa80698c9390b5`.

**El programa no está terminado.** 11 filas aceptadas, 20 bloqueadas por un
gate externo concreto y 8 abiertas; 0 perfiles certificados
de 76.

Sin contradicciones: ninguna fila se declara aceptada con una condición abierta o un gate pendiente, ninguna se declara bloqueada sin nombrar el gate y ninguna se declara abierta sin decir qué falta.

## Los gates externos

1. credenciales y cuentas de canal para pilotos reales (WhatsApp, Instagram, Messenger, Telegram).
2. credenciales de proveedor LLM, modelo, techo de gasto y autorización de ejecución.
3. personas nuevas reclutadas para sesiones moderadas.
4. cuentas autorizadas de alternativas y revisores ciegos.
5. autorización posterior para push, despliegue, migración y activación.
6. cuenta WABA, número, moneda, tarjeta, financiación, permisos y plantillas reales.
7. destinatario consentido, presupuesto y autorización de llamadas a Meta.

## Las filas

| ID | Estado | De dónde sale | Qué falta | Evidencia | Commits |
|---|---|---|---|---|---|
| A1 | **aceptada** | contador | — | Inventario calculado de 15 familias (`terms-binding-inventory.ts`). Cita y matrícula ligan comando y cobro; el pedido de catálogo pasó a cobrar desde `orders.catalog_terms` y a rechazar la fila que no acordó nada. Sin comando ligado: . Sin cobro ligado: . | `a806ef62` `f121dc5f` |
| A2 | **bloqueada** por gate 1 | **declaración** | — | Comando, retención, settlement, avisos durables y revisión sin reenvío implementados y probados con PostgreSQL. La conciliación contra un proveedor real no puede correrse sin su cuenta. | — |
| A3 | **bloqueada** por gate 1 | **declaración** | — | Propuesta, consentimiento, aprobación humana y entrega durable probados con PostgreSQL y Socket.IO. La entrega real necesita un canal conectado. | — |
| A4 | **bloqueada** por gate 1 | **declaración** | — | Transacciones, lectores, promoción y restauración única comprobadas contra PostgreSQL. | — |
| B1 | **bloqueada** por gate 1 | corrida (`docs/audits/2026-09-09/order-sensitivity-runs.md`) | — | El turno completo corre de punta a punta sobre PostgreSQL, Valkey, BullMQ y Socket.IO reales, con crash en cada frontera, una erasure en vuelo y los primitivos a través de un PgBouncer real en modo transacción. | — |
| B2 | **aceptada** | contador | — | Las 15 familias del registro tienen writer canónico auditado, con id de inbound compartido con el runtime y el ledger. Cero bloqueadas. | — |
| C1 | **bloqueada** por gate 1 | **declaración** | — | Árbitro, dueño por puerto, consentimiento por misión, corrección y reanudación probados en los cuatro idiomas del contrato (es/en/pt/fr). | — |
| C2 | **aceptada** | contador | — | Ciclos de agenda y de mascotas con recibos atómicos comprobados. El cierre de esta fila es el mismo que el de A1. | — |
| C3 | **bloqueada** por gate 2 | contador | — | Contratos MCP y dependencias base implementados. El ejecutor está cableado a servicio, cola y endpoint, y se ensaya sin proveedor; la cobertura por tarea la decide una corrida real: 0 perfiles certificados de 76. | — |
| D1 | **bloqueada** por gate 3 | **declaración** | — | Muestreo, revisión humana con CAS y anotaciones RAG implementados. No se certifica veracidad global y el propio informe lo dice; una revisión de muestra necesita personas. | — |
| D2 | **bloqueada** por gate 2 | contador | — | 17 casos etiquetados que cubren los 4 idiomas y los 7 desafíos declarados, con umbrales barridos y números publicados en `docs/runbooks/rag-quality-and-slo.md`. Lo que queda no es local: el entailment semántico necesita el modelo real, así que la fila pasa de abierta a bloqueada por el gate de LLM en vez de aceptarse con la mitad medida. | `f2a6a2e8` `7a9e7c18` `71387107` |
| D3 | **bloqueada** por gate 3 | **declaración** | — | Atribución observable y diagnóstico técnico probados. No equivalen a veracidad ni a entailment, y el informe lo dice. | — |
| E1 | **aceptada** | contador | — | 76 perfiles, 268 tareas, 146 que comprometen al negocio, y cero tareas sin caso positivo propio o sin verificador fuera de las 5 declaradas: `file_claim` en las cinco subtipos de seguros existe para probar que el escalón de identidad la rechaza, así que no hay efecto que verificar y un "positivo" sería el agente haciendo lo que no debe. Certificar estas tareas es H1. | — |
| E2 | **aceptada** | contador | — | 30 de 34 grupos son comerciales y 19 tienen su autoridad congelada entera. Las 11 restantes descansan únicamente en los 3 relojes aceptados con motivo escrito (wall_clock, CURRENT_DATE, readonly_channel_manager_ownership_projection), ninguno de los cuales se puede capturar: lo que los cierra es que el resultado viaje con el instante en que se tomó. La mitad concurrente la prueba `commercial-authority.postgres.spec.ts` contra PostgreSQL real, con dos tenants y dos workers. | `33dd2487` |
| E3 | **bloqueada** por gate 5 y 1 | **declaración** | — | Outbox durable, transporte estricto, recuperación, reconciliación con actor y evidencia, pantalla de operador y alerta real. El interruptor sigue apagado por defecto: encenderlo es una activación. | — |
| F1 | **bloqueada** por gate 2 | contador | — | Assessment común implementado y probado; su cierre es una corrida real de certificación, cuyo ejecutor ya existe y se ensaya sin proveedor. | — |
| F2 | **aceptada** | contador | — | Cada blocker y cada recomendación del assessment tiene resolución declarada, con prueba de cobertura que falla al aparecer un código sin ella; el universo lo produce el código que emite los códigos, no un barrido de texto. Las 8 operaciones que Assist no ejecuta declaran requisitos no secretos, preparación, pantalla exacta y qué releer al volver. | `37411849` `f2a976d6` |
| F3 | **bloqueada** por gate 3 | **declaración** | — | Recorridos por tareas verificadas implementados y con pruebas de accesibilidad automáticas. Las sesiones moderadas necesitan personas. | — |
| F4 | **bloqueada** por gate 3 | **declaración** | — | Un solo vocabulario de seis estados proyectado y mostrado en el tablero. La validación visual necesita personas. | — |
| G1 | **aceptada** | contador | — | 20 lugares inventariados con barrido del árbol de fuentes, cada uno diciendo qué lo alcanza y por qué. Abiertos: . | `d366baf3` |
| G2 | **bloqueada** por gate 3 | **declaración** | — | Curación y revisión en cuatro idiomas implementadas. La revisión humana de muestra necesita personas. | — |
| G3 | **bloqueada** por gate 1 | **declaración** | — | Comparación por runtime y evidencia en seis familias; publicación gradual y retiro implementados. | — |
| H1 | **bloqueada** por gate 2 | corrida (`docs/audits/2026-09-09/certification-manifest.md`) | — | Ejecutor durable construido: 3 tablas, arriendo con `clock_timestamp()`, resultado escrito una sola vez, reintento como intento nuevo, presupuesto y deadline verificados antes de entregar trabajo, invalidación por definición de escenario y por autoridad del agente, y el reporte alimentado desde esas filas. El manifiesto de costo por modelo está calculado. Ejecutarlo necesita una credencial y un techo de gasto autorizado. | `e1ac3943` `4ec45699` |
| H2 | **bloqueada** por gate 2 | **declaración** | — | Regresiones desde QA y ledger, linaje, identidad de misión y denominadores implementados; un resultado desconocido conserva ese estado y no se inventa tasa. Sus denominadores se llenan con la corrida de H1. | — |
| H3 | **bloqueada** por gate 4 y 1 y 3 | corrida (`docs/audits/2026-09-09/adversarial-validation.md`) | — | Harness local construido: corpus generado y estratificado desde el catálogo con verificadores de resultado, sujetos sintéticos ejecutados, 3 tablas de intentos y revisión ciega, y una negativa a enunciar comparación cuando falta el otro sujeto. Correr una alternativa necesita su cuenta. | `aaf41d62` |
| M0 | **aceptada** | contador | — | Censo derivado del árbol: 34 call sites, 30 cobrables, 0 fuera de la autoridad económica. El inventario de efectos declara 61 productores y 49 con al menos una propiedad en `none`. La condición es que el artefacto versionado se regenere desde el mismo HEAD, no que alguien lo haya leído. | — |
| M1 | **abierta** | contador | 18 productores de mensajería sin autoridad y 9 sin idempotencia (y después, gate 1 y 4) | Remitente, pagador y credencial salen del resolver único; la unión de autoridades cubre agente servido, 9 políticas proactivas (appointment_reminder, attendance_check, appointment_notification, appointment_cancellation, drip_step, nurturing_followup, broadcast_message, automation_rule_action, recall_reminder) y operador humano con 4 roles. BSUID/BISU y la coexistencia con el agente Meta siguen siendo trabajo de un solo escritor y no están en el código: esta fila no puede cerrarse por declaración. | — |
| M2 | **bloqueada** por gate 4 | contador | — | Tarifas versionadas `meta-ratecards-2026@cdc5b132567ab1e7` con 4 tarjetas, 5 categorías que Meta cobra por separado y undefined entregas de servicio gratuitas por número y mes calendario. La categoría aprobada y la ventana de servicio se leen de la base del tenant antes de admitir. Lo que falta es una cuenta real: tarifa aplicada por Meta al entregar y conciliación contra factura. | — |
| M3 | **aceptada** | contador | — | Autoridad económica transaccional con 5 alcances (number_month, account, business, contact, task), reserva antes del efecto y liquidación contra el recibo. Cero productores cobrables fuera del gate en este HEAD: lo verifica el censo, no esta frase. | — |
| M4 | **abierta** | **declaración** | la propuesta de precios y la transición de planes son una decisión comercial que nadie ha tomado (y después, gate 5) | Escenarios por país, canal, tarea y ciclo se pueden generar de los cinco planes vigentes, pero el cambio de precio, la capacidad ofrecida y la comunicación a clientes afectados no son trabajo de código. Se dice como declaración porque lo es: cambiar el código de esta área no cambia esta fila. | — |
| M5 | **abierta** | contador | 16 productores de mensajería sin borrado alcanzable (y después, gate 1 y 6) | Aprendizaje conserva origen y finalidad; publicación y rollback llegan a los derivados. El agente de negocio de Meta sigue apagado. El piloto real necesita cuenta, destinatario consentido y presupuesto autorizado, que son gates, no código. | — |
| M6 | **abierta** | **declaración** | marketing avanzado, Direct Send, llamadas/grupos y wallet de reventa no están construidos y están fuera del alcance de octubre por decisión explícita (y después, gate 5) | M5 los separa a M6 a propósito, con flags y elegibilidad propias, para que no bloqueen la continuidad básica. Se registra abierta en vez de omitirse: una fila que no aparece se lee como cerrada. | — |
| R0 | **abierta** | contador | 20 productores cobrables fuera del carril durable (10 en `inline`, 10 en `outbound_queue`) | De 30 call sites cobrables, 20 usan un carril que no escribe fila antes del POST — Redis es el registro, o no hay registro. Un productor ahí no puede contestar "¿esto salió?" después de un reinicio. El criterio principal de R6 es exactamente este número en cero. | — |
| R1 | **aceptada** | contador | — | El carril transporta 7 tipos de item (text, media, payment_link, flow, template, interactive, location), incluidos los menús y las ubicaciones que el carril REST manda todos los días. Los efectos se cuentan DESPUÉS de formarlos: un caption nativo viaja dentro del item donde el proveedor lo cobra como un mensaje, y como item propio donde no. | — |
| R2 | **aceptada** | contador | — | Esperar y suprimir son resultados durables y distintos de error, resolución y handoff, así que ningún catch los convierte en un texto cobrable. La política por defecto admite 1 mensaje(s) idéntico(s) en 10 minutos, con un enfriamiento de 10 minutos, y es revisable por tarea e idioma. | — |
| R3 | **bloqueada** por gate 4 | contador | — | Los 5 alcances se reservan en orden fijo dentro de una transacción, así que dos workers peleando por el último importe no pueden asignarlo dos veces. El mercado sale de la dirección del destinatario, nunca del país de la empresa, y un destino desconocido no tiene tarifa cero. | — |
| R4 | **abierta** | contador | 20 productores todavía pueden emitir sin fila durable (10 en `inline`, 10 en `outbound_queue`) | La consola humana, la API REST y las campañas necesitan la misma admisión que el agente: un handoff detiene la IA, pero las respuestas humanas siguen generando cargos. La autoridad de operador humano existe desde este HEAD; lo que falta es que cada productor la use, y eso se cuenta arriba. | — |
| R5 | **abierta** | **declaración** | la matriz de aceptación de 18 escenarios no está enlazada a pruebas nombradas, y el producto de control de gasto no está en canal, Assist ni activación | Se dice como declaración a propósito: hasta que cada escenario nombre la prueba que lo cubre, esta fila no puede salir de un contador, y un contador inventado sería peor que decir que falta. | — |
| R6 | **abierta** | contador | 20 productores pueden entregar fuera de la autorización aplicable (y después, gate 1 y 5 y 7) | El criterio principal de R6, textual: **ningún productor de WhatsApp puede generar una entrega fuera de la autorización aplicable**. Mientras el contador sea distinto de cero la fila está abierta, y después seguirá bloqueada por el modo observación, el canario con techo explícito y la autorización de activar `enforce`. | — |

## De dónde sale cada fila

21 filas salen de un contador leído del código: cerrar el hueco las cambia solo.
3 descansan sobre un artefacto de una corrida real, nombrado en la tabla.
**15 son declaraciones humanas pendientes de revisión**: A2, A3, A4, C1, D1, D3, E3, F3, F4, G2, G3, H2, M4, M6, R5. Cambiar el código de esas áreas no cambia su estado, y por eso se dicen aparte en vez de presentarse como calculadas.

## Los contadores de los que sale la tabla

| Autoridad | Valor |
|---|---:|
| Perfiles del catálogo | 76 |
| Tareas | 268 |
| Perfiles certificados | 0 |
| Tareas sin positivo o sin verificador, fuera de las declaradas | 0 |
| Familias con términos inventariadas | 15 |
| Familias sin comando ligado | 0 |
| Familias sin cobro ligado | 0 |
| Familias de writer bloqueadas | 0 |
| Lugares donde descansan las palabras del agente | 20 |
| De ellos, abiertos | 0 |
| Canales de autoservicio | 5 |
| Canales certificados | 0 |
| Operaciones que Assist deriva a una pantalla | 8 |
| Defectos en la tabla de resolución de Assist | 0 |
| Call sites de egress censados | 34 |
| De ellos, cobrables | 30 |
| Cobrables fuera del gate económico | 0 |
| Cobrables fuera del carril durable | 20 |
| Productores declarados en el inventario de efectos | 61 |
| De ellos, con alguna propiedad en `none` | 49 |
| Políticas proactivas registradas | 9 |
| Tipos de item que el carril durable transporta | 7 |
| Alcances de gasto | 5 |
| Entregas de servicio gratuitas por número y mes | undefined |

Para actualizar: `node docs/audits/2026-09-09/generate-closure-report.cjs` desde la raíz.
