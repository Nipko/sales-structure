# Relevo completo para Claude: cierre, revisión, staging y preparación de piloto

Fecha: 9 de septiembre de 2026. Punto de partida: `ecd02b09`. Lee antes de actuar:

- `docs/handoffs/2026-09-09/claude-predeployment-blockers-and-next-execution.md`;
- `docs/audits/2026-09-09/adversarial-validation.md`;
- `docs/audits/2026-09-09/closure-report.md` y su generador;
- `docs/audits/2026-09-09/closure-state.md` y su generador;
- `docs/audits/2026-09-09/certification-manifest.md`;
- `docs/agent-platform-implementation-progress.md`;
- los contratos de producto actuales mencionados en `AGENTS.md`.

## Mandato

Toma propiedad del programa completo hasta dejarlo listo para revisión y prueba en staging. No termines la tarea después de un bloque parcial ni porque aparezca un gate externo: termina todo lo independiente, prepara el paquete exacto del gate y continúa con el siguiente bloque. Sólo al final agrupa lo que realmente requiera al dueño en una solicitud concreta.

El estado actual no permite despliegue: 3/25 filas aceptadas, 17 bloqueadas y 5 abiertas; 0/76 perfiles y 0/5 canales certificados. Tu primer objetivo es **cero filas abiertas y cero defectos locales conocidos**. Después debes producir un candidato revisable, empujarlo a una rama de revisión si el acceso remoto está disponible, abrir un PR draft y validar staging. No empujes directamente a `main`, no hagas merge y no despliegues ni actives producción sin aprobación explícita del dueño sobre el PR y la evidencia de staging.

Esta instrucción reemplaza la prohibición anterior de push únicamente cuando se cumplan todos los gates locales de este documento: entonces queda autorizado crear una rama de revisión, hacer push de esa rama y abrir un **draft PR**. No autoriza merge, producción, llamadas a canales reales, benchmark externo ni gasto de LLM.

Preserva exactamente las seis entradas ajenas del árbol (`CLAUDE.md`, los dos module files con EOL, `docs/plan-profitability-2026-07.md`, `.validate-index.cjs` y `docs/whatsapp-meta-pricing-2026-10.md`). Usa staging por rutas explícitas; nunca `git add .` ni `git add -A`.

## Fase 1 — cerrar A1 y C2 en las quince familias

El inventario todavía reporta diez familias sin comando ligado y tres cobros sin términos ligados. Ciérralas mediante el mismo contrato, no con quince excepciones inconexas:

- `appointment_transitions`;
- `repair_orders`;
- `class_bookings`;
- `insurance_quotes`;
- `property_bookings`;
- `tour_bookings`;
- `restaurant_orders`;
- `service_requests`;
- `photo_sessions`;
- `resource_rentals`.

Para cada acción que compromete al negocio debe existir una propuesta canónica con versión, recursos, cantidades/fechas, precio y moneda cuando aplique, condiciones, identidad del cliente, autoridad del agente y hash. Debe mostrarse antes de escribir; una pregunta, corrección, cambio de intención o rechazo no autoriza. La confirmación sólo sirve para la misión y propuesta vigentes. Si cambian datos, disponibilidad, precio, términos o autoridad, se exige nueva revisión. Writer, receipt, historial, rollback/reconciliación y dedupe deben compartir `inboundMessageId` y autoridad.

Para `property_bookings`, `tour_bookings` y `restaurant_orders`, el cobro debe leer exclusivamente el monto/moneda aceptado y congelado. Nunca reconstruyas consentimiento desde una columna histórica. Los registros anteriores sin evidencia deben entrar en una cola/revisión de reconfirmación, con UI y mensaje de cliente claros. Extiende el dry-run histórico a todas las familias y produce contadores por tenant/estado/antigüedad sin PII.

Acceptance:

- `familiesWithUnboundCommand()` y `familiesWithUnboundCharge()` devuelven cero;
- casos positivos, rechazo, pregunta intermedia, corrección, cambio concurrente, replay, crash/commit incierto y privacidad en es/en/pt/fr;
- ninguna familia cobra, reserva, cancela, cotiza de forma vinculante o cambia estado sin términos vigentes;
- upgrade desde datos pre-términos probado sin inventar acuerdos.

## Fase 2 — cerrar G1 y todo lugar donde descansan palabras del agente

Cierra los siete stores abiertos con comportamiento real y barrido que impida regresiones:

1. `eval_runs`;
2. `simulation_runs`;
3. `agent_release_evidence`;
4. `quality_regression_cases`;
5. `handoff_summary` y su copia en CRM externo;
6. `quality_scores`;
7. `outbound_queue_job` legacy.

Cada store debe declarar y probar procedencia, retención, invalidación por release, erasure por contacto, outcome desconocido y recuperación. Conserva la decisión ya tomada de no reescribir historial entregado por un rollback de release.

Para CRM externo, persiste el identificador/receipt devuelto por el adapter y crea retract/reconcile idempotente con resultado estricto. Prueba con proveedor sintético accepted/rejected/unknown; la llamada real permanece en gate de canal.

No cierres `outbound_queue_job` activando un flag en producción. Migra el productor normal al outbox durable o elimina del job legacy palabras/recipiente y hazlo sólo una referencia durable. Mantén compatibilidad, kill switch, rollback y recuperación. Tras el cambio, una respuesta diferida debe sobrevivir crash/replay, respetar retiro/erasure antes de enviar y no duplicarse.

Acceptance: `openAgentOutputStores()` devuelve cero y el sweep encuentra cualquier nuevo writer de texto no inventariado.

## Fase 3 — cerrar D2: calidad semántica bajo carga

Construye una evaluación reproducible, no una prueba que sólo mide disponibilidad:

- dataset versionado y estratificado por vertical/perfil, idioma, tipo de fuente, ambigüedad, negación, conflicto, temporalidad, documento retirado y ausencia de respuesta;
- verdad esperada y citas/fragmentos autorizados por caso;
- métricas separadas para recall@k/MRR de retrieval, precisión de cita, groundedness/entailment, respuesta correcta, abstención correcta, fuga de fuente retirada, error y latencia p50/p95/p99;
- carga concurrente sobre PostgreSQL+pgvector con tenants aislados, actualización/retiro de conocimiento en vuelo y degradación del embedding/reranker;
- umbrales publicados con justificación y comparación contra baseline antes del cambio;
- resultados por es/en/pt/fr, tamaños de corpus y configuración reproducible.

Ejecuta localmente todo lo determinista. Si el judge generativo requiere credencial, deja el runner y adapter falso totalmente operables, mueve únicamente esa corrida al gate LLM y no declares calidad generativa aceptada. D2 sólo puede pasar a bloqueada si no queda implementación local.

## Fase 4 — cerrar E2: lectores comerciales congelados

Deriva un inventario de todos los lectores que influyen en precio, moneda, stock, disponibilidad, elegibilidad, cobertura, cupo, política, términos y resultado comercial. Cada ejecución/evaluación debe usar una revisión capturada con hash y dependencias exactas. El resultado caduca si cambia cualquier autoridad relevante y no debe mezclar lecturas antes/después de la captura.

Prueba bajo tráfico concurrente:

- modificación de precio/stock/política durante un turno;
- actualización y retiro RAG durante evaluación;
- dos workers y dos tenants;
- retry y reanudación;
- cache stale, réplica retrasada y proveedor degradado;
- lectura legacy que intente saltarse el snapshot.

Acceptance: inventario calculado con cero lectores comerciales sin autoridad congelada, evidencia invalidada selectivamente y métricas de carga publicadas.

## Fase 5 — terminar el ejecutor de certificación y C3/F1

Revisa que las correcciones `dcac01fa`, `28c95b6e` y `cbdb7e24` estén cableadas de extremo a extremo, no sólo verdes por función:

- controller protegido por Auth/Roles/TenantGuard y aislamiento super_admin;
- servicio, BullMQ producer/processor, recovery cron/watchtower y bootstrap DI;
- request-key idempotente, auditoría con actor real, pause/resume/cancel y estados terminales correctos;
- reserva presupuestaria atómica bajo concurrencia, ajuste al costo real, leases expirados y cero finalización con trabajo en vuelo o decisión de retry pendiente;
- sujeto/snapshot independiente por perfil, con invalidación selectiva;
- migración, bootstrap y `tenant-schema.sql` en paridad bajo PgBouncer;
- dry-run que atraviese el entrypoint real con runners falsos y escriba evidencia no certificable;
- ejecución hermética representativa de los 76 perfiles con adapter falso para probar planificación, partición, recovery y reporte sin gastar.

El runner real debe invocar el mismo Agent Test/EvalService, tools y verificadores que producción, fijar el modelo solicitado sin fallback silencioso y guardar el modelo servido. Si un modelo no puede ejecutar tools, queda rechazado por el plan.

C3 y F1 pueden quedar bloqueadas exclusivamente por el gate LLM una vez que todo el camino local anterior esté demostrado. No lances las 139.940 llamadas. Prepara una progresión:

1. smoke de 1 perfil × 1 idioma × Web Chat × pocos casos;
2. cohorte representativa y barata con límite pequeño;
3. una familia vertical completa;
4. catálogo completo sólo después de revisar costo, calidad y estabilidad.

Cada etapa requiere autorización explícita de modelo y techo de gasto.

## Fase 6 — benchmark realmente operable

Verifica desde controller/CLI hasta persistencia, runners, revisión ciega y reporte. El benchmark debe exigir a Parallly como sujeto, comparar exactamente el mismo corpus/hash/grants, aleatorizar con seed reproducible, confirmar efectos donde aterrizan, separar unknown de failure y medir setup, costo y latencia. Añade budget/deadline/cancel/recovery si todavía no están en el service operable. Ejecuta Parallly y alternativas sintéticas localmente; deja cuentas externas y revisores como único gate.

Nunca afirmes “mejor del mercado” sin comparación real, comparable y revisada.

## Fase 7 — Playwright y experiencia completa

Implementa y ejecuta Playwright hermético en `apps/e2e`, sin llamadas a producción:

- signup y onboarding de tenant nuevo hasta primer agente preparado;
- plantilla/subtipo, misión, herramientas, conocimiento, políticas, horario y canal;
- assessment → blocker → Assist → propuesta/diff → aplicar a borrador → relectura → prueba → publicar;
- creación guiada de FAQ/política/servicio y handoff de las ocho operaciones sensibles;
- tours: iniciar, completar meta, omitir, reanudar y repetir;
- OAuth simulado: retorno, error, cancelación y timeout;
- teclado, foco, lector de pantalla/axe, zoom/contraste;
- móvil y escritorio;
- es/en/pt/fr;
- roles tenant_admin/supervisor/agent/super_admin y aislamiento tenant;
- cero request inesperada, cero hostname productivo y capturas sólo ante fallo.

Corrige todos los defectos encontrados. Prepara el protocolo de sesiones moderadas, métricas de abandono/tiempo/ayuda y formulario de observación para ejecutar cuando existan personas nuevas.

## Fase 8 — revisión adversarial final

Antes de declarar cero filas abiertas:

- revisa cada uno de los 24 commits desde `a62361ca` y todos los nuevos commits por seguridad, multi-tenancy, autoridad, idempotencia, outcomes unknown, recuperación, privacidad, planes e i18n;
- busca paths sin caller, endpoints sin cliente, DDL sin migración, flags imposibles de operar, reports hardcodeados y tests que prueban su propio fixture;
- prueba concurrency/COMMIT incierto en cada nueva frontera durable;
- revisa que ningún controller protegido carezca de los tres guards requeridos;
- verifica UUID casts y SQL parametrizado, WebSocket tenant isolation, noeviction y outbound por el camino autorizado;
- ejecuta `npm run verify:artifacts` y demuestra que regenerar artefactos no deja diff;
- actualiza manuales y referencia de capacidades para todo comportamiento visible.

El cierre debe distinguir `derived`, `executed_evidence` y `declared`. Convierte declaraciones humanas en evidencia ejecutada cuando sea posible; lo que dependa realmente de personas/proveedores queda bloqueado con paquete exacto.

## Fase 9 — verificación integral del candidato

Sobre el HEAD final, sin cambios de código entre corridas:

- TypeScript en frío: api, dashboard, whatsapp, landing, mobile y shared;
- builds: shared, api, whatsapp, dashboard y landing;
- bootstrap Nest;
- suites completas API, dashboard y WhatsApp, cero fallidas y cero omitidas;
- tres corridas API con seeds/órdenes distintos y bases por worker;
- Playwright completo;
- PostgreSQL 17 + pgvector, Valkey noeviction, BullMQ, Socket.IO y PgBouncer transaction pool;
- migraciones, paridad, reaplicación, rollback y upgrade desde schema anterior bajo escritura;
- carga/caos del turno, outbox, términos, certificación y benchmark;
- `git diff --check`, artefactos frescos y `git status --short` sólo con las seis entradas ajenas.

Registra comandos, versiones, seed, duración, suite/test totals y fallos encontrados. Un rerun verde no borra un rojo: explica y corrige la causa.

## Fase 10 — rama de revisión y draft PR

Cuando haya cero filas abiertas y toda la verificación anterior esté verde:

1. crea una rama dedicada desde el HEAD actual, sin incluir los seis cambios ajenos; usa `claude/agent-platform-finalization-20260909` si no existe;
2. revisa que no haya secretos, dumps, logs pesados ni artefactos temporales;
3. haz push de esa rama, nunca de `main`;
4. abre draft PR con problema, comportamiento final, arquitectura, migraciones, flags, compatibilidad histórica, métricas, validación, gates externos, riesgos y rollback;
5. enlaza requisito → commits → pruebas → evidencia;
6. ejecuta checks remotos y corrige todo fallo hasta dejar el PR verde;
7. solicita revisión, pero no hagas merge.

Si no hay acceso remoto o `gh`, deja el branch local, título/body del PR en un archivo y comandos exactos para publicarlo; continúa preparando staging sin inventar éxito remoto.

## Fase 11 — staging y prueba segura

Con PR verde y credenciales de staging disponibles:

- respalda/verifica restauración del staging;
- ejecuta dry-run de migraciones y huérfanos;
- despliega a staging con outbox/certificación/benchmark y cualquier comportamiento riesgoso apagado inicialmente;
- aplica migraciones mediante `DIRECT_DATABASE_URL` y comprueba paridad;
- ejecuta smoke, API E2E, Playwright y escenarios de rollback;
- activa sólo fixtures/tenant de prueba;
- prueba kill switch y rollback real;
- observa SLOs, backlog, errores de términos, costos y aislamiento;
- publica evidencia y decisión go/no-go.

No uses clientes ni destinatarios reales sin autorización. No despliegues producción, no hagas merge y no actives una cohorte productiva hasta que el dueño revise el PR y el informe de staging y lo autorice explícitamente.

## Gates externos que debes preparar, no usar todavía

Entrega un solo paquete final con:

1. cuentas/destinatarios de prueba de WhatsApp, Instagram, Messenger y Telegram;
2. proveedor/modelo LLM elegido y presupuesto por etapa;
3. personas nuevas para onboarding, tours, accesibilidad y revisión de aprendizaje;
4. cuentas de alternativas y revisores ciegos;
5. aprobación de merge, deploy productivo, migraciones productivas y activación gradual.

Para cada gate incluye variables requeridas sin valores, alcance, duración, costo máximo, datos usados, criterios de aborto, rollback, consultas/métricas y evidencia esperada. No te detengas a pedirlos hasta terminar todo lo local y de staging que no dependa de ellos.

## Entrega final

No entregues un resumen de actividad. Entrega una decisión comprobable:

- reporte A1–H3 con cero `abierta`, procedencia por fila y artefactos frescos;
- matriz completa con lo aceptado y lo bloqueado exclusivamente por gates externos;
- explicación funcional de qué cambia para onboarding, Assist, configuración, operación del agente, tools, aprendizaje, canales y operadores;
- commits incrementales y diff total revisado;
- PR draft y checks remotos, o paquete exacto si falta acceso;
- resultado de staging y rollback, o bloqueo externo preciso si falta acceso;
- una sola lista de acciones requeridas del dueño para ejecutar pilotos/LLM/benchmark y autorizar producción.

Sigue trabajando hasta alcanzar ese estado. No declares “terminado” por haber construido infraestructura, por obtener una suite verde aislada o por transformar un pendiente local en una declaración manual.
