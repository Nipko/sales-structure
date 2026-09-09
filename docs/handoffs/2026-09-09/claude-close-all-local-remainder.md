# Directiva para Claude: cerrar todo el remanente local antes de pedir gates externos

Fecha: 9 de septiembre de 2026. Punto de partida revisado: `30a79102..8ec67797` (94 commits locales). Esta directiva no autoriza push, despliegue, migraciones fuera de instancias desechables, activación de flags, llamadas a proveedores reales ni gasto en modelos o alternativas.

## Veredicto de la revisión

La tanda corrigió defectos graves y elevó mucho la base técnica: ledger durable del turno, recuperación, despacho estricto, PgBouncer real, migraciones bajo escritura, carga, accesibilidad por componentes y suites conectadas. Debe conservarse.

El programa no está terminado. La tabla A1–H3 del propio informe contiene **25 filas: 2 aceptadas y 23 no aceptadas**. El título “lo que queda: los cuatro gates externos” contradice la línea siguiente, que reconoce trabajo local en A1, B2, C2, D2, E2, F2, G1, H1 y el aislamiento del arnés. También faltan recorridos de navegador y ejecutores reales de certificación y benchmark.

No vuelvas a presentar el programa como cerrado mientras una fila conserve `No aceptado`, exista un hueco local conocido, haya cero perfiles certificados o una suite sea sensible al orden. Un contrato, una matriz calculada o un resumen que rechaza evidencia inválida son infraestructura; no son la ejecución que produce evidencia.

## Hallazgos nuevos que debes corregir

### 1. La certificación de perfiles no tiene ejecutor de catálogo

`agent-certification.ts` consume `AgentReleaseRunEvidence` ya fabricada y calcula el producto perfil × idioma × canal × modelo. Fuera de specs, sólo `task-competence-matrix.ts` lo consume. No existe servicio, job, CLI o endpoint que recorra los 76 perfiles, materialice sus agentes/fixtures, ejecute sus casos con `EvalService`, persista checkpoints y alimente esa certificación.

Construye un ejecutor durable y reanudable. Debe:

- derivar perfiles, tareas, idiomas soportados, canales compatibles y modelos realmente disponibles de fuentes canónicas;
- crear o resolver fixtures aislados por perfil sin compartir estado entre workers;
- ejecutar el mismo runtime del agente y los verificadores de efecto, no un simulador paralelo;
- guardar cada caso con identidad estable, snapshot/config/dependency hash, modelo servido real, canal, idioma, intento, costo, latencia, transcript, tools, verificación y estado;
- soportar checkpoint, reanudación, lease, límite de costo, deadline, cancelación y reintento sin repetir efectos;
- invalidar evidencia cuando cambie cualquiera de sus autoridades;
- publicar progreso y huecos por perfil/tarea/idioma/canal/modelo;
- alimentar `certifyProfiles` desde evidencia persistida, sin objetos construidos por el test;
- ofrecer dry-run con número exacto de llamadas, tiempo y costo máximo antes de pedir autorización para modelos reales.

La ejecución con modelos reales requiere una credencial de LLM y presupuesto autorizado. Eso es un **quinto gate externo** que el informe omitió; no lo mezcles con credenciales de Meta/Telegram.

Normaliza C1/H1 al alcance de idiomas que el producto declara: es/en/pt/fr. No mantengas “lenguaje arbitrario” como criterio si el contrato vigente sólo ofrece cuatro idiomas. Si decides ampliar idiomas, primero cambia el contrato, i18n, detección y pruebas; no lo presentes como dependencia de un proveedor de canal.

### 2. El “benchmark” es un validador de resultados, no un harness ejecutable

`agent-benchmark.ts` congela un corpus y resume intentos suministrados. No llama sujetos, no persiste intentos, no ejecuta Parallly, no adapta alternativas y no ofrece revisión ciega. Construye la parte local completa antes de pedir cuentas de competidores:

- generador de corpus congelado desde las tareas certificables, con muestras estratificadas y verificadores de resultado;
- runner de Parallly sobre el runtime real;
- interfaz de adaptadores para alternativas, con fixture/adapter falso para probar el protocolo sin llamadas externas;
- ledger de sujetos, intentos, revisiones, costos, latencias, setup y resultados confirmados;
- asignación ciega, orden aleatorio reproducible, control de comparabilidad y revisión humana;
- checkpoint, presupuesto, deadline, reanudación, exportación y reporte reproducible;
- API o CLI operable y pruebas E2E del flujo completo con sujetos sintéticos.

Las cuentas autorizadas siguen siendo gate externo sólo para ejecutar alternativas reales. La construcción del runner no lo es.

### 3. La matriz de canales confunde “sin pendiente” con “completo”

`channel-certification-matrix.ts` marca capacidades declaradas como `prepared`, pero `pending` sólo contiene celdas `pending`; `summariseChannelCertification.complete` cuenta una fila sin `pending`. Así puede llamar completa a una fila con capacidades únicamente declaradas y nunca operadas. Corrígelo:

- `complete`/`certified` sólo cuando toda capacidad en alcance esté `operating` y tenga evidencia E2E vigente;
- `prepared` debe aparecer como no certificada y como trabajo pendiente de prueba, aunque no falte implementación;
- separar claramente `implemented`, `operating`, `certified` y `out_of_scope`;
- enlazar cada celda a evidencia ejecutada con revisión/hash/timestamp, no sólo a una ruta de archivo;
- exponer la matriz en una superficie operable del dashboard con i18n es/en/pt/fr; hoy el endpoint `/channels/certification` no tiene consumidor en dashboard;
- mantener Email y SMS fuera de los canales conversacionales certificados.

El informe pide piloto de “correo”, pero el contrato del producto declara Email como adaptador inbound interno sin configuración tenant. Retíralo del gate de pilotos. Sólo inclúyelo si primero se aprueba y construye como canal bidireccional self-service completo.

### 4. La verificación visual no cubre onboarding ni Assist de extremo a extremo

Las nuevas pruebas de accesibilidad renderizan componentes. En `apps/e2e` no hay cambios de esta tanda y sólo existen recorridos generales de auth/navegación. Agrega Playwright hermético para:

- tenant nuevo desde signup/onboarding hasta primer agente listo;
- selección de plantilla y subtipo, assessment, corrección guiada y persistencia del contexto;
- Assist: pedir cambio, revisar diff, aplicar a borrador, relectura, prueba del borrador, publicar y observar el estado correcto;
- creación guiada de FAQ/política/servicio y navegación contextual de operaciones que exigen OAuth, credenciales, privilegios o efecto externo;
- tours por tarea, meta verificada, omitir/reanudar/repetir y ausencia de callejones sin salida;
- retorno/error/cancelación/timeout de OAuth mediante mocks;
- teclado, foco, lector de pantalla, zoom/contraste y tamaños móvil/escritorio;
- es/en/pt/fr y cero solicitudes inesperadas o hacia producción.

Prepara además el guion, criterios, telemetría y formulario de observación para sesiones moderadas. Ejecutarlas con personas nuevas sigue siendo gate externo.

### 5. Assist sólo ejecuta cuatro creaciones y deja ocho rutas

La frontera de seguridad es correcta: no debe tomar credenciales, conceder roles, publicar, cobrar o enviar sin acción humana. Pero F2 no puede cerrarse con cuatro objetos y enlaces genéricos. Audita cada bloqueo del assessment y garantiza un recorrido completo:

- para configuración propia y reversible, propuesta tipada, diff exacto, permisos, plan, CAS, idempotencia, auditoría, relectura y prueba del borrador;
- para contenido first-party seguro, ampliar sólo las operaciones necesarias por plantilla de negocio y reutilizar el servicio dueño de la pantalla;
- para decisiones externas/sensibles, recopilar requisitos no secretos, validar preparación, conservar el contexto, abrir la pantalla exacta preconfigurada y volver a Assist con el resultado actualizado;
- distinguir preparar, guardar borrador, verificar, publicar y operar; ningún smoke check puede aparecer como certificación;
- demostrar que todos los blockers/recommendations del assessment tienen una acción ejecutable o un handoff de UI específico, con test de cobertura que falle al aparecer un código sin resolución.

No conviertas las ocho operaciones en escritura automática por cumplir un contador. Cierra la experiencia guiada manteniendo la acción humana donde corresponde.

## Trabajo local reconocido por tu propio informe

Cierra en este orden, con commits incrementales y una prueba roja que justifique cada cambio:

1. **Aislamiento determinista del arnés.** Elimina la sensibilidad al orden de `agent-release.postgres.spec.ts` e `isolated-canonical-commands.spec.ts`. Usa base/schema/namespace por suite o serialización explícita donde la autoridad sea global. Ejecuta la suite varias veces, con orden/seed distintos y `--maxWorkers=2`; no aceptes “pasa sola” como cierre.
2. **A1.** Extiende consentimiento y términos ligados al comando/cobro a todas las familias e históricos aplicables. Inventario calculado, cero términos huérfanos y pruebas PostgreSQL positivas/negativas.
3. **B2/C2.** Sustituye todas las familias bloqueadas por writers canónicos con `inboundMessageId`, autoridad, recibo, deduplicación, historial/cierre atómico, recovery y erasure. La matriz debe reportar cero familias locales bloqueadas.
4. **D2.** Define y ejecuta calidad semántica bajo carga con dataset, métricas, umbrales, pgvector, concurrencia y degradación controlada. Publica números y límites; no equipares disponibilidad con calidad.
5. **E2.** Congela lectores comerciales restantes, incluye dependencia/revisión en snapshots y evalúa bajo tráfico concurrente. Evidencia caduca si cambia el lector o sus datos.
6. **F2.** Completa los recorridos de Assist descritos arriba y su cobertura por blocker/plantilla.
7. **G1.** Enumera y cubre todas las salidas/trazas restantes y el despacho diferido. Cada salida derivada de aprendizaje debe conservar release/source/consent/provenance, sobrevivir crash/replay y poder retirarse sin borrar historial ajeno.
8. **H1/H2.** Construye el ejecutor de certificación y alimenta el reporte desde su ledger. Corre todo lo que sea posible sin credenciales reales; deja un manifest exacto de lo que requiere LLM, costo y autorización.
9. **H3.** Construye el harness de benchmark y el paquete de pilotos; ejecuta sujetos sintéticos y Parallly local. Deja pendientes únicamente las llamadas que de verdad necesiten cuentas externas.
10. **Canales/UI/E2E.** Corrige la semántica de certificación, añade la superficie operativa y ejecuta Playwright completo.

## Gates externos reales después del cierre local

Cuando todo lo anterior esté verde, informa por separado:

1. Credenciales/cuentas/destinatarios de prueba de WhatsApp, Instagram, Messenger y Telegram para pilotos reales.
2. Credenciales de uno o más proveedores LLM, modelos concretos, techo de gasto y autorización para ejecutar la matriz generativa.
3. Personas nuevas reclutadas para sesiones moderadas de onboarding, tours, accesibilidad y revisión de aprendizaje.
4. Cuentas autorizadas de alternativas, sujetos concretos, presupuesto y revisores ciegos para el benchmark.
5. Autorización explícita posterior para push, despliegue, migraciones y activación gradual.

Antes de pedir cualquiera, deja preparado un paquete revisable: variables requeridas sin secretos, cuentas/canales exactos, destinatarios, casos, duración, costo máximo, criterios de abortar, rollback, métricas, consultas de verificación y evidencia esperada. No uses secretos en commits ni logs.

## Criterio de aceptación final

Entrega un informe generado desde autoridades ejecutables, no una narración manual. Debe incluir:

- las 25 filas A1–H3, cada una `aceptada`, `bloqueada por gate externo concreto` o `abierta`, sin contradicciones;
- cero trabajo local abierto y cero términos como “restantes”, “otras familias”, “otras salidas”, “fragilidad” o “por investigar”;
- matriz por los 76 perfiles y 268 tareas con evidencia por idioma/canal/modelo, distinguiendo ejecutado, aprobado, fallido, no aplicable y bloqueado;
- resultados reproducibles de API, dashboard, WhatsApp, landing, mobile, shared, builds, bootstrap, PostgreSQL/pgvector/Valkey/BullMQ/Socket.IO/PgBouncer, carga/caos y Playwright;
- al menos tres corridas completas consecutivas del arnés sensible al orden sin fallos ni omitidas, con seed/orden registrados;
- migraciones/paridad/dry-run/rollback bajo tráfico local;
- lista de gates externos exclusivamente con acciones imposibles de realizar localmente;
- `git status --short`, commits incrementales y trazabilidad requisito → commit → prueba → evidencia.

No hagas push, deploy, activación, llamadas a canales, llamadas a alternativas ni una ejecución generativa que produzca costo hasta recibir autorización explícita. Preserva las seis entradas ajenas ya declaradas y usa staging por rutas explícitas.
