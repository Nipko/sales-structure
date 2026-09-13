# Estado de los programas A1–H3, M0–M6/R0–R6, T1–T7 y L0–L6, decidido por el código

Generado por `docs/audits/2026-09-09/generate-closure-report.cjs`. Cada fila declara una **condición**, y
el estado sale de ella: con una condición local sin cumplir la fila está `abierta`; con la condición
cumplida y un gate externo nombrado está `bloqueada`; sólo sin condición y sin gate está `aceptada`.
Cerrar un hueco cambia esta tabla cambiando el código, y reabrirlo la cambia de vuelta.

Revisión: `0bb6fc5a6d4bf58838e0da8d06c7a9feb244361a`.

**El programa no está terminado.** 25 filas aceptadas, 27 bloqueadas por un
gate externo concreto, 0 abiertas y 1 diferidas por decisión
explícita de alcance; 0 perfiles certificados
de 76.

Sin contradicciones en las 53 filas: a cada una se le recalculó el estado a partir de sus propias condiciones, ninguna fila abierta deja de decir qué falta, ningún gate nombrado falta de la lista, ninguna cifra quedó sin resolver y todo artefacto citado existe.

Ese barrido corre dos veces: sobre las filas recién construidas y otra vez sobre las filas releídas del artefacto versionado, donde el estado es una cadena guardada que nadie recalculó. La primera pasada, sola, no podría fallar — el constructor deriva el estado de las mismas condiciones con las que se lo compara — y por eso no se presenta sola.

## Los gates externos

1. credenciales y cuentas de canal para pilotos reales (WhatsApp, Instagram, Messenger, Telegram).
2. credenciales de proveedor LLM, modelo, techo de gasto y autorización de ejecución.
3. personas nuevas reclutadas para sesiones moderadas.
4. cuentas autorizadas de alternativas y revisores ciegos.
5. autorización posterior para push, despliegue, migración y activación.
6. cuenta WABA, número, moneda, tarjeta, financiación, permisos y plantillas reales.
7. destinatario consentido, presupuesto y autorización de llamadas a Meta.
8. aprobación de responsables legal y financiero sobre contratos y copy comercial.

## Las filas

| ID | Estado | De dónde sale | Qué falta | Evidencia | Commits |
|---|---|---|---|---|---|
| A1 | **aceptada** | contador | — | Inventario calculado de 15 familias (`terms-binding-inventory.ts`). Cita y matrícula ligan comando y cobro; el pedido de catálogo pasó a cobrar desde `orders.catalog_terms` y a rechazar la fila que no acordó nada. Sin comando ligado: ninguna. Sin cobro ligado: ninguna. | `a806ef62` `f121dc5f` |
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
| E3 | **bloqueada** por gate 5 y 1 | **declaración** | — | Outbox durable obligatorio, transporte estricto, recuperación, reconciliación con actor y evidencia, pantalla de operador y alerta real. El ajuste heredado dispatch.normalOutbox sólo delimita la evidencia del canario; no puede devolver una respuesta al carril eliminado. | — |
| F1 | **bloqueada** por gate 2 | contador | — | Assessment común implementado y probado; su cierre es una corrida real de certificación, cuyo ejecutor ya existe y se ensaya sin proveedor. | — |
| F2 | **aceptada** | contador | — | Cada blocker y cada recomendación del assessment tiene resolución declarada, con prueba de cobertura que falla al aparecer un código sin ella; el universo lo produce el código que emite los códigos, no un barrido de texto. Las 8 operaciones que Assist no ejecuta declaran requisitos no secretos, preparación, pantalla exacta y qué releer al volver. | `37411849` `f2a976d6` |
| F3 | **bloqueada** por gate 3 | **declaración** | — | Recorridos por tareas verificadas implementados y con pruebas de accesibilidad automáticas. Las sesiones moderadas necesitan personas. | — |
| F4 | **bloqueada** por gate 3 | **declaración** | — | Un solo vocabulario de seis estados proyectado y mostrado en el tablero. La validación visual necesita personas. | — |
| G1 | **aceptada** | contador | — | 20 lugares inventariados con barrido del árbol de fuentes, cada uno diciendo qué lo alcanza y por qué. Abiertos: ninguno. | `d366baf3` |
| G2 | **bloqueada** por gate 3 | **declaración** | — | Curación y revisión en cuatro idiomas implementadas. La revisión humana de muestra necesita personas. | — |
| G3 | **bloqueada** por gate 1 | **declaración** | — | Comparación por runtime y evidencia en seis familias; publicación gradual y retiro implementados. | — |
| H1 | **bloqueada** por gate 2 | corrida (`docs/audits/2026-09-09/certification-manifest.md`) | — | Ejecutor durable construido: 3 tablas, arriendo con `clock_timestamp()`, resultado escrito una sola vez, reintento como intento nuevo, presupuesto y deadline verificados antes de entregar trabajo, invalidación por definición de escenario y por autoridad del agente, y el reporte alimentado desde esas filas. El manifiesto de costo por modelo está calculado. Ejecutarlo necesita una credencial y un techo de gasto autorizado. | `e1ac3943` `4ec45699` |
| H2 | **bloqueada** por gate 2 | **declaración** | — | Regresiones desde QA y ledger, linaje, identidad de misión y denominadores implementados; un resultado desconocido conserva ese estado y no se inventa tasa. Sus denominadores se llenan con la corrida de H1. | — |
| H3 | **bloqueada** por gate 4 y 1 y 3 | corrida (`docs/audits/2026-09-09/adversarial-validation.md`) | — | Harness local construido: corpus generado y estratificado desde el catálogo con verificadores de resultado, sujetos sintéticos ejecutados, 3 tablas de intentos y revisión ciega, y una negativa a enunciar comparación cuando falta el otro sujeto. Correr una alternativa necesita su cuenta. | `aaf41d62` |
| M0 | **aceptada** | contador | — | Censo derivado del árbol: 32 call sites, 29 cobrables, 0 fuera de la autoridad económica. El inventario de efectos declara 66 productores y 28 con al menos una propiedad en `none`. La condición es que el artefacto versionado se regenere desde el mismo HEAD, no que alguien lo haya leído. | — |
| M1 | **bloqueada** por gate 1 y 4 | contador | — | Remitente, pagador y credencial salen del resolver único; la unión de autoridades cubre agente servido, 9 políticas proactivas (appointment_reminder, attendance_check, appointment_notification, appointment_cancellation, drip_step, nurturing_followup, broadcast_message, automation_rule_action, recall_reminder) y operador humano con 4 roles. BSUID, la procedencia del token BISU y el control del hilo frente al agente de Meta ya están en el código y probados: un remitente sin teléfono se contesta en vez de descartarse, un token del portafolio del proveedor se rechaza en vez de firmar el envío de un tenant, y el control del hilo es durable y se recupera solo. Lo que falta es una cuenta real: ninguna de esas transiciones vio todavía un traspaso de verdad, y por eso la coexistencia va detrás de un interruptor apagado. El contador de esta fila mide otra cosa —productores de mensajería sin autoridad o sin idempotencia— y sigue siendo lo que la mantiene abierta. | — |
| M2 | **bloqueada** por gate 4 | contador | — | Tarifas versionadas `meta-ratecards-2026@cdc5b132567ab1e7` con 4 tarjetas, 5 categorías que Meta cobra por separado y 1000 entregas de servicio gratuitas por número y mes calendario. La categoría aprobada y la ventana de servicio se leen de la base del tenant antes de admitir. Lo que falta es una cuenta real: tarifa aplicada por Meta al entregar y conciliación contra factura. | — |
| M3 | **aceptada** | contador | — | Autoridad económica transaccional con 5 alcances (number_month, account, business, contact, task), reserva antes del efecto y liquidación contra el recibo. Cero productores cobrables fuera del gate en este HEAD: lo verifica el censo, no esta frase. | — |
| M4 | **bloqueada** por gate 5 | **declaración** | — | La decisión de producto está aplicada por la autoridad `WHATSAPP_OCTOBER_COMMERCIAL_POLICY`: precios y capacidad de los cinco planes sin cambio; techo observable por número de 2000 entregas/mes y por contacto de 60; aviso desde 2026-09-15 y fecha límite 2026-09-30. El ledger importa esa misma autoridad al crear contadores, por lo que el reporte no puede separarse del runtime. El análisis que sustenta la decisión queda en `docs/audits/2026-09-12/m4-pricing-proposal.md`: tarifas de servicio y marketing de seis mercados derivadas de la tarjeta de octubre, los cinco planes vigentes, el gasto real del cliente en dos extremos geográficos, un escenario elegido y cuatro alternativas descartadas. Falta publicar la versión desplegada, que pertenece al gate de release. | — |
| M5 | **bloqueada** por gate 1 y 6 | contador | — | Aprendizaje conserva origen y finalidad; publicación y rollback llegan a los derivados. El agente de negocio de Meta sigue apagado. El piloto real necesita cuenta, destinatario consentido y presupuesto autorizado, que son gates, no código. | — |
| M6 | **diferida** por decisión de alcance | **declaración** | diferida por dueño del producto (la decisión de alcance es comercial, no técnica); se reabre cuando se autorice el alcance para un release posterior, o Meta cambie la elegibilidad de alguna de esas superficies de modo que la continuidad básica dependa de una de ellas. Reabrir significa volver a `abierta` con trabajo local, no declararla aceptada. | Se registra DIFERIDA y no abierta: mantener abierto un release por alcance que alguien quitó a propósito es tenerlo abierto para siempre. Y no aceptada: nada de esto está construido, y una fila aceptada sobre funcionalidad inexistente es la única lectura peor. Tampoco se omite: esta tabla ya aprendió que una fila que no se imprime se lee como cerrada. | — |
| R0 | **aceptada** | contador | — | De 29 call sites cobrables, 0 usan un carril que no escribe fila antes del POST — Redis es el registro, o no hay registro. Un productor ahí no puede contestar "¿esto salió?" después de un reinicio. **Este número no es el criterio de R6**, que pregunta por la autorización aplicable y la mide con los productores fuera del gate económico. Lo que esta fila mide es la fila durable antes del POST; desde este HEAD todo productor cobrable la crea y ningún interruptor puede devolverlo al carril anterior. | — |
| R1 | **aceptada** | contador | — | El carril transporta 7 tipos de item (text, media, payment_link, flow, template, interactive, location), incluidos los menús y las ubicaciones que el carril REST manda todos los días. Los efectos se cuentan DESPUÉS de formarlos: un caption nativo viaja dentro del item donde el proveedor lo cobra como un mensaje, y como item propio donde no. | — |
| R2 | **aceptada** | contador | — | Esperar y suprimir son resultados durables y distintos de error, resolución y handoff, así que ningún catch los convierte en un texto cobrable. La política por defecto admite 1 mensaje(s) idéntico(s) en 10 minutos, con un enfriamiento de 10 minutos, y es revisable por tarea e idioma. | — |
| R3 | **bloqueada** por gate 4 | contador | — | Los 5 alcances se reservan en orden fijo dentro de una transacción, así que dos workers peleando por el último importe no pueden asignarlo dos veces. El mercado sale de la dirección del destinatario, nunca del país de la empresa, y un destino desconocido no tiene tarifa cero. | — |
| R4 | **aceptada** | contador | — | La consola humana, la API REST y las campañas necesitan la misma admisión que el agente: un handoff detiene la IA, pero las respuestas humanas siguen generando cargos. Desde este HEAD cada productor usa una fila durable y la autoridad correspondiente; cualquier ruta nueva vuelve a abrir este contador. | — |
| R5 | **aceptada** | contador | — | La matriz dejó de ser una tabla en un documento: sus 18 filas son datos, cada una nombra el archivo y UN TÍTULO POR MITAD del escenario, y una comprobación verifica que cada título sea el de un `it()` que de verdad corre — ni prosa, ni un `describe`, ni un `skip`. Una fila vale lo que su mitad más delgada: si una de ellas no está probada, la fila entera figura con `null` y dice qué haría falta, en vez de quedar fuera de la tabla para que la columna parezca llena — que es exactamente cómo un contador llega a cero sin que nadie cierre nada. | — |
| R6 | **bloqueada** por gate 1 y 5 y 7 | contador | — | El criterio principal de R6, textual: **ningún productor de WhatsApp puede generar una entrega fuera de la autorización aplicable**. Esa autorización es la autoridad económica transaccional, y el censo derivado del árbol cuenta 0 productores cobrables que llegan a un POST sin pasarla. Lo verifica una mutación que borra el gate del sink real, no esta frase. **Este contador sumó hasta este HEAD los 0 productores fuera del carril durable (), que es otra propiedad**: no hay fila antes del POST, así que nadie puede contestar "¿esto salió?" tras un reinicio. Esa propiedad se mide en R0 y R4 y también está en cero. Con la condición local cumplida esta fila queda bloqueada por el modo observación, el canario con techo explícito y la autorización de activar `enforce`. | — |
| T1 | **aceptada** | contador | — | Derivado del contrato de perfil de negocio contra los módulos que pueden actuar sobre cada bandera, excluyendo el propio contrato, el editor y las pruebas. Una bandera que sólo su esquema y su formulario mencionan es un control que el dueño puede mover sin consecuencia, y la pantalla dice que hizo algo. | — |
| T2 | **aceptada** | contador | — | Derivado de cada entrada no nula de `READINESS_PREDICATE_AUTHORITY`. Cada readiness cita el predicado que su herramienta evalúa y el registro se reduce únicamente cuando la corrección aterriza junto con su prueba. | — |
| T3 | **aceptada** | contador | — | Leído de la llamada, no de un comentario: the assessment passes a scope to intentEvidence. Sin scope el lector no puede reconocer evidencia producida bajo la configuración actual, y un agente probado se ve igual que uno que nadie probó. | — |
| T4 | **aceptada** | contador | — | Derivado de `DISCOVERY_ORDER` contra la tabla por elemento del tour. Un elemento que aparece en el panel y no en el recorrido es una pantalla a la que se manda al dueño sin decirle para qué sirve, qué datos necesita, qué puede confirmar ni qué cuesta. | — |
| T5 | **bloqueada** por gate 1 y 4 | contador | — | Universo canónico conservado: 76 perfiles, 268 tareas, 146 que comprometen al negocio. La verificación determinista local es lo que esta fila mide; la certificación por canal y modelo real sigue en cero (0/76) y es gate externo, no trabajo local. | — |
| T6 | **aceptada** | contador | — | Derivado del AST de `copilot.service.ts`: Assist inyecta `AgentContentProposalService`, consulta `listOperations`, deriva de sus veredictos la lista ejecutable y no vuelve a leer `effectiveCapabilities` como una autoridad paralela. | — |
| T7 | **aceptada** | contador | — | El programa de herramientas entra al gate oficial por UNA autoridad compartida: `verify-artifacts.cjs` ejecuta `generate-tool-profile-audit --check` junto con los otros generadores, y `candidate`, `deploy` y `vertical-quality` llaman a ese verificador en vez de llevar cada uno su propia lista. El artefacto de herramientas quedó stale sin impedir un cierre precisamente porque no estaba ahí. Que el gate se pone rojo ante una fuente modificada lo demuestra una prueba que cambia una fuente auditada y captura la transición, no la afirmación de que el árbol está al día. Las seis filas T1–T6 se derivan de lecturas del código, nunca de prosa ni de la existencia de un test. | — |
| L0 | **aceptada** | contador | — | La autoridad comercial está en registros versionados y seis verificadores independientes; el build público ejecuta el conjunto completo. | — |
| L1 | **aceptada** | contador | — | Planes, capacidades, tarifas de WhatsApp y decisiones pendientes salen de fuentes versionadas; no se completan con cifras de diseño. | — |
| L2 | **aceptada** | contador | — | La web distingue suscripción a Parallly, entregas que Meta cobra a la WABA y pagos que el cliente final hace directamente al negocio. | — |
| L3 | **aceptada** | contador | — | Cuatro demos ilustrativas declaran su naturaleza y evidencia; la comparación con Meta tiene superficie, fecha, fuente y límites. | — |
| L4 | **aceptada** | contador | — | La paridad cubre 4 idiomas. Las URLs indexables, el HTML inicial, canonical, hreflang y sitemap se miden por estructura, no por una cookie de navegador. | — |
| L5 | **bloqueada** por gate 8 | contador | — | Términos, privacidad y tratamiento tienen contenido en cuatro idiomas y un borrador coordinado. La aprobación de responsables legal y financiero sigue siendo externa. | — |
| L6 | **bloqueada** por gate 3 y 5 | contador | — | El build ejecuta paridad, claims, regresiones adversarias, costos y evidencia competitiva. La comprensión con usuarios nuevos y el ensayo del candidato pertenecen a sus gates externos. | — |

## De dónde sale cada fila

36 filas salen de un contador leído del código: cerrar el hueco las cambia solo.
3 descansan sobre un artefacto de una corrida real, nombrado en la tabla.
**14 son declaraciones humanas pendientes de revisión**: A2, A3, A4, C1, D1, D3, E3, F3, F4, G2, G3, H2, M4, M6. Cambiar el código de esas áreas no cambia su estado, y por eso se dicen aparte en vez de presentarse como calculadas.

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
| Call sites de egress censados | 32 |
| De ellos, cobrables | 29 |
| Cobrables fuera del gate económico | 0 |
| Cobrables fuera del carril durable | 0 |
| Productores declarados en el inventario de efectos | 66 |
| De ellos, con alguna propiedad en `none` | 28 |
| Políticas proactivas registradas | 9 |
| Tipos de item que el carril durable transporta | 7 |
| Alcances de gasto | 5 |
| Entregas de servicio gratuitas por número y mes | 1000 |
| Brechas SEO/localización de la landing | 0 |

Para actualizar: `node docs/audits/2026-09-09/generate-closure-report.cjs` desde la raíz.
