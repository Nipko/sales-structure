# Directiva integrada: cierre técnico y adaptación para octubre

Fecha: 10 de septiembre de 2026. Base revisada: `7c9eb04b`. Objetivo del usuario: integrar el cierre de la plataforma y los cambios Meta/WhatsApp, pagos, control del gasto y experiencia comercial para estar preparados el **1 de octubre**.

## Mandato

Claude asume la integración y continúa con commits pequeños y verificables. Se puede desarrollar en paralelo; no se puede aprobar el candidato actual como listo para staging o producción. La revisión independiente encontró defectos locales adicionales. Tener host y credenciales no basta para ejecutar los scripts actuales.

**Decisión posterior del usuario:** «vamos a utilizar el mismo que ya tenemos […] tenemos algunos tenants que lo están probando». El destino será el **VPS y entorno operativo existentes**, con activación gradual en los tenants de prueba. Esta decisión reemplaza la exigencia previa de conseguir otro host como condición del release. No contratar ni preparar otro VPS por inercia, y no ejecutar scripts de seed/reset sintético en la base con tenants existentes.

Ese entorno debe tratarse como operativo aunque sus tenants estén probando. El piloto por tenant limita funciones nuevas; no aísla automáticamente migraciones, reinicios, cron ni consumo de CPU/memoria. Antes del despliegue, identificar servicios, recursos disponibles, tenants de prueba y no participantes mediante inventario sin secretos/PII. Si se necesita una instancia temporal adicional, puede estudiarse en el mismo VPS sólo con proyecto Compose, volúmenes, bases, Redis, puertos, dominios y secretos separados y capacidad suficiente; no es requisito de contratar infraestructura.

**Prioridad final del usuario, que prevalece sobre recomendaciones anteriores:** «no hagamos más trabajo para mantener lo anteriores […] hacemos migraciones […] a mano si toca pero priorizar el cambio completo de la plataforma». Entregar **una plataforma actualizada**, con un único camino operativo final. No invertir en soportar indefinidamente dos versiones, adaptadores legacy redundantes, doble escritura o compatibilidad del binario antiguo con el esquema nuevo. Se permite sustituir componentes, eliminar rutas obsoletas y actualizar contratos/pruebas para el comportamiento nuevo.

Se permite una ventana de mantenimiento y migraciones puntuales/manuales cuando sean la opción más directa. Preparar cada migración como procedimiento reproducible con alcance, conteo previo, transformación, comprobación posterior y recuperación. No implica borrar datos válidos, fabricar consentimiento, alterar cobros acordados ni repetir efectos externos. Esas obligaciones pertenecen a los datos del negocio, no a mantener el código anterior. Si exige romper compatibilidad de esquema, declararlo y planificar el corte completo; no construir compatibilidad extra sólo para evitar el corte.

Lee primero [la revisión del cierre](../../audits/2026-09-10/codex-release-readiness-review.md), [staging](../../audits/2026-09-10/codex-staging-review.md) y [certificación](../../audits/2026-09-10/codex-certification-runner-review.md). Reproduce sus casos antes de corregirlos. Reutiliza las pruebas de invariantes vigentes; actualiza o elimina contratos de comportamientos que se sustituyan. Añade pruebas en las fronteras reales que los dobles anteriores no cubrieron, sin preservar un camino obsoleto sólo para mantener verde su suite.

Incorpora como un solo programa estas directivas, sin reescribirlas en implementaciones independientes:

- [M0–M6: Meta, identidad, financiación, tarifas y planes](claude-meta-whatsapp-adaptation.md).
- [R0–R6: gasto de respuestas WhatsApp y conversaciones sin progreso](claude-whatsapp-response-spend-guardrails.md).
- [L0–L6: oferta, comparación y landing](claude-landing-meta-comparison.md).
- [Contrato de tarjeta Meta y separación de pagos](../../research/2026-09-10/meta-card-setup-and-security-contract.md).
- [Cierre técnico anterior](claude-release-closure-after-pr-review.md).

La aclaración del usuario sobre prioridad económica prevalece: proteger **los mensajes salientes de WhatsApp**, incluidos humanos y automatizaciones. No reabrir el control de modelos como proyecto general ni hacer que el rediseño económico de todos los consumidores IA enumerados en M3 bloquee esta entrega. Conserva los límites IA y corrige defectos concretos cuando afecten el release, como la contabilidad del ejecutor de certificación.

El objetivo sigue incluyendo M0–M5, R0–R6 y L0–L6. El orden de prioridad siguiente no declara terminado ni elimina el resto. M6 y APIs futuras conservan su carácter opcional. Si una parte no llega, presenta alcance preciso, impacto y alternativa de activación al usuario; no reduzcas silenciosamente el programa ni la protección. Las instrucciones históricas de migraciones exclusivamente aditivas, compatibilidad legacy y rollback del binario antiguo quedan subordinadas a la prioridad final de reemplazo completo.

## F0 — corregir las herramientas que deben probar el release

Este frente empieza inmediatamente y puede correr junto con contratos e implementación de producto. Las reparaciones que afectan al camino elegido, preflight, datos y presupuesto deben terminar antes de ejecutar ese camino con tenants/credenciales reales. Los defectos del workflow de staging siguen abiertos hasta corregirse, pero no constituyen por sí solos un veto a una ruta operativa distinta ya ensayada. No usar el workflow roto ni presentarlo como verificado.

1. **Entorno efectivo de ensayo y destino operativo.** Comprueba la configuración resuelta de Compose, el destino que usan los procesos y el bundle que ejecuta el navegador. Los valores validados por el guard deben ser los valores usados. Un `.env` no sobreescribe un valor explícito del Compose ni un `NEXT_PUBLIC_*` compilado. Si mantienes staging, aísla base, Redis, URLs, secretos, volúmenes y proyecto de Compose. Si el workflow ya no será utilizado, deshabilítalo o retíralo y reemplázalo por el camino de ensayo/despliegue elegido; no dediques una tanda a conservar un workflow que el producto no necesita.
2. **Guard también en rollback.** Toda rama que pueda conectar al host debe requerir éxito explícito del guard. Conserva limpieza tras fallos que ocurrieron después de admisión válida. Un `always()` no autoriza a ejecutar después de una confirmación, SHA o aislamiento rechazados.
3. **Comparación no vacía.** Inventario obligatorio y verificable de digests de producción; ausencia, conjunto vacío, formato inválido o cobertura insuficiente no prueban aislamiento. Prueba productor y consumidor con vectores independientes y valores sintéticos. No publiques secretos.
4. **Candidato antes de main.** Añade un camino de construcción y prueba de imágenes del SHA del PR sin activar el workflow de producción ni mover `latest` productivo. Identifica SHA completo y digest de las imágenes. Configuración del host, scripts, guard y artefactos deben corresponder al candidato identificado. Resuelve explícitamente los bundles distintos por entorno o una configuración pública en runtime verificable.
5. **Artefactos que sobreviven.** No escribas en `/tmp` de `docker compose run --rm` para leerlo luego desde `exec` de otro contenedor. Usa salida estructurada o un volumen/directorio por ejecución; limpia evidencia antigua y recoge los archivos del host en el job que los publicará. JSON de una corrida previa nunca cuenta como éxito de la actual.
6. **Piloto con efecto real del runtime.** `web_widget` no está en los canales del outbox estricto actual. No ensanches arbitrariamente ese contrato para satisfacer la prueba. Ensaya un canal soportado con transporte sintético explícito y salida externa denegada, comprobando productor, lote, efecto, recibo, historial, reinicio y limpieza. Separa ese ensayo del piloto de cuenta real. El valor SQL del interruptor no prueba que el runtime lo utilice.
7. **Runner de certificación tipado de extremo a extremo.** Consume el resultado real de `EvalService.runGateV2` y conserva verificación, modelo efectivamente servido y uso real. `any`, `results` inexistente y costo faltante convertido en cero ocultaron la incompatibilidad. Uso desconocido conserva exposición; no se inventa gratuidad. Propaga cancelación/lease/presupuesto antes de cada llamada, incluidos jueces y loops, y valida modelo solicitado frente a servido.
8. **Presupuesto del canario coherente.** Planificador, admisión, reserva por caso y liquidación deben describir el mismo trabajo. Cuenta también jueces, reintentos y llamadas adicionales que el runtime permita. El precio `US$0,76` actual no es un techo ejecutable demostrado. Regenera la propuesta de gasto después de corregir el contrato; no uses esa cifra como autorización de llamadas reales. Un perfil medido no certifica costo/calidad de los otros 75.
9. **Benchmark y reintentos.** El adaptador de benchmark tiene el mismo desacople; no registrar un resultado desconocido como fracaso confirmado/costo cero ni convertirlo en comparación válida. Aplicar los verificadores de efecto de la tarea. Reproducir en PostgreSQL la inserción de reintentos que omite `reserve_usd_cents`; cada intento debe conservar una reserva válida y autoridad vigente.
10. **Rutas, datos y preflight completo.** Corregir las rutas de salud/widget/webhook y el token sintético del ensayo que se use. Reproducir con PostgreSQL las formas SQL NULL/JSON null/acuerdo incompleto que el preflight actual puede no contar. Separar bootstrap realmente vacío de migración de datos existentes; nunca interpretar una inspección fallida como base vacía. Para el VPS elegido probar migración, cese de writers durante el corte, restore del backup y apertura con la versión nueva. **No se exige ejecutar el binario anterior sobre el esquema nuevo.** Estas revisiones sí afectan al despliegue operativo, aun sin usar staging.

Criterio de salida F0: el camino elegido ya no contiene los defectos, por reparación o por sustitución/eliminación comprobada del componente afectado; pruebas adversariales pasan, el ensamblado se ensaya con contenedores desechables y el candidato se puede construir y ejecutar sin merge. No mantener un componente sólo para hacer pasar su diagnóstico histórico. Marca por separado la ejecución posterior en el VPS operativo y, si se utiliza, cualquier instancia aislada. Pasar el guard de staging no autoriza resetear datos del entorno operativo; tampoco se debe relajar ese guard para admitir el VPS operativo como si fuera sintético.

## Contratos compartidos antes de dividir cambios grandes

El integrador fija un pequeño contrato tipado y versionado, con transformación explícita de las filas anteriores que deban conservarse:

1. Contexto inmutable de tenant, conexión/número, cuenta pagadora, credencial autorizada y destinatario con scope; teléfono opcional.
2. Efectos que se transmitirán realmente, su orden, identidad e idempotencia. Drenar, migrar o conciliar los lotes ya comprometidos antes del corte; no repetirlos ni reinterpretar un recibo existente como un efecto nuevo.
3. Autorización y reserva monetaria; resultado aceptado/rechazado/desconocido, entrega y conciliación posterior.
4. Resultado durable del turno: enviar, esperar, suprimir o escalar, sin fabricar una respuesta cobrable para representar silencio.
5. Financiación y readiness con estado, motivo, fuente y fecha; diferencia entre ausencia comprobada y desconocimiento.

No mantener dos outbox, ledgers de turnos o almacenes de autorización comercial como solución permanente. Extender o reemplazar la autoridad existente según el diseño final; si se reemplaza, migrar/conciliar su estado y retirar el camino anterior. La meta es una sola autoridad operativa, no compatibilidad indefinida.

## Trabajo en paralelo y propiedad de archivos

Cuatro frentes lógicos, con un solo integrador. Con tres subagentes disponibles, Claude puede asumir F0/integración y después D, mientras A/B/C avanzan. Puede redistribuir subtareas acotadas, manteniendo propietarios explícitos.

| Frente | Propiedad y entregables | Frontera que no debe editar en paralelo |
|---|---|---|
| A — cuenta, identidad y financiación | Selección exacta, `channel-token.service.ts`, salud de tokens, conexión, ingresos/webhooks API y servicio WhatsApp, identidad/BSUID, financiación y 131042. Entrega contexto y eventos normalizados. | `whatsapp-messaging.service.ts`, salida de `meta-graph.service.ts`, gateway y adaptadores de envío pertenecen a B. Separar ingress/egress si hoy comparten archivo antes de trabajar simultáneamente. |
| B — tarifas y autorización de envíos | Tarifas versionadas, cuota por número, precisión monetaria, reservas concurrentes, exposición incierta y liquidación. Unificar outbox/cola/gateway/transportes y REST/servicio WhatsApp; retirar las rutas redundantes. | No cambiar orquestación ni composición de C. Ninguna ruta que permanezca puede evitar la admisión económica por un flag. |
| C — conversación y productores | `conversations.service.ts`, ledger de turnos, `dispatch-items.ts`, prompts, debounce por conexión, pausa/reanudación, nurturing, recordatorios y automatizaciones. Compacción compatible y confirmaciones de operaciones ejecutadas. | No crear presupuestos ni transporte alternativo; usa B. Cambios al outbox se solicitan al propietario B. |
| D — experiencia, oferta y release | Dashboard de canales/pagos/consumo, onboarding, Assist/tours, landing completa, comparación, precios y propuesta comercial, i18n, accesibilidad. Integra F0, migraciones, pruebas y evidencia del candidato. | No anunciar límites/financiación como efectivos antes de integrar y probar A/B/C. No cambiar precios de clientes reales. |

**Propietario único: integrador.** `packages/shared` y sus exportaciones, `schema.prisma`, `tenant-schema.sql`, migraciones/generadores SQL, registros Nest, configuración global de tests, contratos de readiness y catálogos completos de traducción, workflows y Git del checkout compartido. Los frentes entregan propuestas pequeñas para esos archivos; el integrador las aplica en orden.

Usa worktrees independientes cuando sea posible, nacidos del mismo SHA convenido. Cada uno puede preparar commits en su rama; sólo el integrador actualiza el PR principal. Si se comparte directorio, un solo actor escribe el índice Git y cada archivo tiene propietario. No dos TypeScript builds, generadores o migradores sobre los mismos outputs. Cada frente que use PostgreSQL tendrá bases desechables distintas.

Preserva los cambios ajenos al iniciar y vuelve a comprobarlos antes de cada commit. En la revisión había cuatro entradas: `CLAUDE.md`, `docs/plan-profitability-2026-07.md`, `.validate-index.cjs`, `docs/whatsapp-meta-pricing-2026-10.md`. No es una autorización para tocar otras novedades concurrentes. Usa rutas explícitas, nunca `git add .`/`-A`; no rebase destructivo de la rama compartida.

## Primeras tandas concretas

- A: reproducir y eliminar la sustitución de un número solicitado por otro del tenant, incluida respuesta cacheada incompatible. Dos tenants/dos números; cero selección alternativa y cero envío cuando falta la conexión requerida. Inventariar llamadores que dependían del fallback.
- B: resolvedor puro de tarifas desde las fuentes oficiales conservadas, con versión, moneda, fecha efectiva, mercado desconocido y límites de precisión. Después reserva atómica PostgreSQL en la frontera económica compartida.
- C: medir lista actual de efectos, resolver lotes previos en el corte y compactar texto/enlace/caption donde el transporte lo soporte. Añadir espera durable y debounce por conexión preservando la identidad de transferencias/writers ya ejecutados.
- D/F0: corregir los bloqueos de staging/certificación y preparar componentes de información sobre los tres pagos. La revisión completa de landing sigue su directiva; corregir la verdad comercial no requiere esperar una cuenta Meta real.

Orden de integración: contratos → contexto A y tarifas B → reservas B y composición C → todos los transportes/productores → UI/readiness D → migraciones/candidato/ensayo → piloto autorizado. El inventario del VPS existente y el procedimiento de actualización se preparan al principio, no cuando ya terminó el frontend.

## Condiciones imprescindibles de la entrega de octubre

- Cada efecto WhatsApp conserva destinatario, conexión y pagador autorizados. Un reintento no cambia de cuenta.
- Adaptación de identidad sin perder clientes que no aporten teléfono. BSUID se aborda por su rollout vigente; no atribuirle una fecha universal del 1 de octubre no demostrada. Todas las entradas de Embedded Signup deben estar en v4 antes del retiro de v2 del 8 de octubre.
- El negocio entiende y completa pago directo a Meta mediante la superficie oficial. Parallly guía y vuelve a consultar; no implementa captura propia de tarjeta Meta. Manejar también partner y estado desconocido.
- La suscripción Parallly, el consumo Meta y los cobros a compradores con credenciales del negocio quedan separados en onboarding, configuración, precios y términos. Tarjeta adjunta no garantiza solvencia.
- 131042 y fallos posteriores a aceptación pausan la cuenta pertinente sin perder entradas ni repetir efectos; reanudación revisa vigencia, consentimiento, ventana, autoridad y presupuesto.
- Tarifas por moneda/mercado/categoría/vigencia; cuota de servicio por número/mes, no por país. Distinguir permiso para responder de gratuidad. Una ventaja no observable conserva incertidumbre; mercado desconocido nunca equivale a cero.
- Reserva monetaria antes de todo efecto facturable, para humano, IA, campaña, automatización, nurturing, recordatorio, REST, media y Flow cuando exista productor. Probar todas las rutas alcanzables. Un flag del nuevo outbox no evita este control.
- Límite agregado, por cuenta/contacto/tarea y máximo de precio unitario según autorización. Incertidumbre retiene exposición y conciliación no duplica cargos. No prometer controlar envíos generados por aplicaciones externas.
- Conversaciones repetitivas/ráfagas no generan gasto infinito. La espera no produce avisos cobrables en bucle; una reclamación o dificultad de comprensión no se clasifica automáticamente como abuso. Preservar tareas largas legítimas.
- Una operación ejecutada conserva historial y obligación recuperable de confirmación. Reservar la comunicación crítica antes de operaciones que la requieran; no dejar un cobro ejecutado sin resultado durable por alcanzar el límite.
- Protecciones básicas en todos los planes. Números de planes desde catálogo efectivo y contrato; propuestas de cambios comerciales versionadas y revisables, sin sustituir cuotas actuales por hipótesis del modelo financiero.
- Landing completa en cuatro idiomas, capacidades reales, comparación honesta, separación de cargos, requisitos y limitaciones. No afirmar 76 perfiles certificados, superioridad de mercado ni funcionamiento de un límite sólo dibujado en UI.
- Migraciones coherentes en los caminos canónicos, incluidas las de transformación/manuales que el corte requiera; backup/preflight, recuperación, activación y observabilidad ensayados sobre el candidato. No obligar a que toda migración sea aditiva.

## Calendario propuesto, con integración antes del último día

Estas fechas organizan el trabajo; no prueban capacidad ni garantizan terminar. Ajusta estimaciones tras los primeros contratos y registra desviaciones con alcance y motivo.

| Fechas de septiembre | Resultado esperable y condición para avanzar |
|---|---|
| 10–12 | Reproducciones F0, contratos compartidos, inventario completo de productores y primera tanda. Inventariar VPS existente, responsable y tenants/cuentas del piloto. |
| 13–18 | A/B/C funcionando con proveedores sintéticos: financiación, tarifas, reserva, compacción, pausas; F0 ensayable con contenedores y primeras pantallas D. |
| 19–23 | Todos los productores conectados, UI/Assist/tours/landing integrados, recuperación y concurrencia comprobadas. Ensayo del ensamblado y de upgrade/restore con bases desechables. |
| 24–26 | Candidato estable, puerta completa, migración/recuperación y recorrido real navegador→API→persistencia. Preparar corte del VPS a la plataforma nueva y comprobaciones con tenants de prueba. Sin interceptar la API en la prueba que se presente como integrada. |
| 27–29 | Actualización integral, validación operativa inicial en tenants/cuentas concretos, medición de mensajes/cargos, pausa/reanudación y correcciones. Abrir operación del resto de cuentas preparadas antes del cambio tarifario. |
| 30 | Reserva de recuperación y comprobación de financiación de las cuentas objetivo. No dejar implementación central para este día. |
| 1 de octubre | Verificar cambio de vigencia, pendientes en cola, estado de financiación, entrega, conciliación y alertas de las cuentas activadas. |

Si las garantías del camino elegido o admisión de todos los emisores siguen fallando, no promover la entrega por calendario. Proponer al usuario una activación acotada con alcance explícito, o mantener bloqueados los envíos afectados preservando entradas y atención interna. No dejar gasto silencioso como fallback.

El cambio tarifario de Meta afecta a las cuentas WhatsApp correspondientes aunque nuestras funciones nuevas estén apagadas. Al llegar octubre, cualquier cuenta que siga enviando debe tener financiación/condiciones y admisión de gasto resueltas; un canario de pocos tenants no protege por sí mismo a los demás. Preparar inventario de preparación de todas las cuentas activas y resolución de las que falten, sin atribuirle al flag control sobre tarifas del proveedor.

## Despliegue en el VPS existente

1. Capturar versión/digests actuales, estado de migraciones, colas, espacio y recursos. Identificar por ID los tenants piloto; no asumir que todos los tenants presentes son desechables ni que todos sus contactos aceptaron mensajes de prueba.
2. Ensayar backup **y restore** en un destino desechable; comprobar la transformación al esquema nuevo. Si el tamaño real vuelve inviable el ensayo previsto, medir y ajustar el procedimiento antes de tocar el VPS. No construir soporte del binario antiguo sobre el esquema nuevo para justificar rollback.
3. Construir y validar el candidato antes de merge. Preparar corte de contenedores y migraciones con efectos globales declarados. Pausar writers/jobs afectados, drenar o conservar entradas pendientes y efectos inciertos, y obtener una fotografía consistente. Un preflight previo no detiene escrituras posteriores.
4. Migrar y reemplazar la plataforma en la ventana de mantenimiento acordada. Las operaciones manuales deben quedar registradas y verificadas igual que los scripts. Retirar rutas obsoletas y comprobar que todos los productores restantes atraviesan la admisión económica. No mantener dos versiones por tenant.
5. Verificar primero con los tenants/cuentas de prueba identificados, límites y destinatarios autorizados. Medir entrega/duplicados, costos y reservas inciertas, errores de financiación, resolución de tareas y latencia. Reabrir el resto de cuentas preparadas según criterios previamente fijados. El piloto es de validación de la nueva versión, no mantenimiento de un runtime anterior en paralelo.
6. Diseñar recuperación según el momento: antes de admitir nuevas escrituras puede restaurarse el conjunto consistente de datos e imágenes; después de admitirlas, detener efectos afectados y corregir hacia adelante o ejecutar una reversión de datos probada. Nunca restaurar ciegamente el backup perdiendo operaciones posteriores. No borrar efectos pendientes, historial ni reservas; conciliarlos. Los cambios irreversibles del proveedor no se revierten al cambiar imagen.
7. Dejar una única versión operativa y las cuentas pendientes visibles. No configurar una espera automática o gasto prolongado sin que exista tarea programada y autorización correspondiente.

## Gates externos y trabajo que debe seguir abierto

Se puede implementar, migrar bases desechables y ensayar casi todo lo anterior sin pedir credenciales reales. Para completar la validación externa faltan elementos concretos:

1. Acceso y capacidad del VPS existente, inventario actual, responsable y ventana operativa. **El usuario ya decidió usar ese servidor**; no pedir otro host como bloqueo. Si se adopta instancia aislada en el mismo VPS, sus recursos/configuración deben estar realmente separados y caber sin degradar a los tenants.
2. Cuenta/número de prueba elegible, permisos, método de pago del negocio, destinatario consentido, responsable y presupuesto autorizado. No solicitar secretos en documentos o chat; usar el almacén establecido.
3. Credencial de modelo y presupuesto **recalculado** para canario/certificación, tras corregir el runner. Prueba sintética no certifica desempeño del modelo.
4. Usuarios nuevos para pruebas guiadas y de accesibilidad; los contratos Playwright con API interceptada no sustituyen esas sesiones.
5. Catálogo/contratos efectivos y decisión sobre cambios comerciales. Preparar diferencias concretas sin activar precios por hipótesis ni quitar derechos vendidos.
6. Aprobación del candidato y activación concreta. En el workflow actual, fusionar cambios desplegables a `main` dispara producción: no usar merge para conseguir imágenes de ensayo.

Certificación de 76 perfiles, benchmark competitivo y pilotos de los demás canales permanecen abiertos hasta evidencia real. No tienen que confundirse con la adaptación tarifaria: un release limitado puede mantener funciones sin certificar apagadas o claramente restringidas, previa decisión sobre el alcance. Eso no termina el programa completo ni autoriza claims universales.

## Entrega y revisión del integrador

Mantén un registro único de condiciones F0/M/R/L con `implementado`, `probado local`, `ensayado staging`, `verificado proveedor` y `decisión pendiente`, evidencia y SHA. Un archivo nuevo o una prueba que sólo verifica su propio fake no completa una condición. El historial de 610 suites no sustituye la puerta del candidato que incorpore estos cambios.

Pruebas por tanda: las mínimas pertinentes que reproduzcan el fallo y su reparación. Después del candidato integrado: suites API con PostgreSQL sin omisiones, typechecks fríos, builds, bootstrap, migraciones clean/upgrade/concurrentes, contratos de aislamiento y Compose, Playwright completo y recorridos HTTP reales relevantes. Captura resultados directamente de herramientas y señala qué fronteras siguen simuladas.

Casos adversariales indispensables: dos productores consumiendo el último presupuesto a la vez; timeout tras aceptación; COMMIT incierto; entrega tardía; precio que cambia antes de despacho; múltiples cuentas/mercados/monedas; cuota 999/1000/1001; humano y REST intentando omitir el guard; pausa con writer ya ejecutado; migración/reinicio con reservas inciertas; autorización de despliegue rechazada que no llega a SSH; navegador que sólo solicita dominios del entorno previsto; juez de certificación que consume presupuesto y uso ausente que no se liquida como cero.

Entrega final: commits por bloque, archivos/capacidades cambiados, criterios pendientes con responsable, pruebas en SHA final, inventario de productores cubiertos, propuesta comercial, coste/techo del piloto, evidencia de host/proveedor sólo si ocurrió, abortos/rollback y estado de archivos ajenos. Actualiza título y descripción del PR al alcance final. No digas “sólo faltan gates externos” mientras exista un defecto local conocido.

Conserva cualquier autorización específica ya otorgada por el usuario. La elección del VPS queda resuelta; no equivale a ordenar ejecutar ahora este candidato defectuoso. No inferir de esta directiva permiso para contratación, cambios comerciales efectivos ni llamadas con gasto. Prepara el candidato y solicita únicamente la aprobación final concreta que todavía falte. Los arreglos locales y ensayos sintéticos ya están dentro del trabajo autorizado.
