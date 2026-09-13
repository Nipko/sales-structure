# Claude: bloqueo de despliegue y siguiente ejecución

Fecha: 9 de septiembre de 2026. HEAD revisado: `1422f491`. No autoriza push, deploy, migraciones externas, activación de flags, llamadas a canales, modelos ni alternativas.

## Veredicto

El lote mejoró sustancialmente el programa, pero todavía no es un candidato de despliegue. El reporte generado declara 3/25 filas aceptadas, 15 bloqueadas por gates y 7 abiertas; conserva 0/76 perfiles certificados, 0/5 canales certificados y no ejecutó el Playwright solicitado. Antes de pedir gates externos hay defectos locales adicionales en el ejecutor de certificación y falta repetir la verificación integral después de los últimos cambios.

Primero valida adversarialmente cada hallazgo de este documento. Si alguno no aplica, demuéstralo con un recorrido ejecutable y una prueba que reproduzca la condición; no lo cierres con una explicación.

## P0: el ejecutor de certificación todavía no puede ejecutar el producto

`certification-ledger.ts` implementa almacenamiento, leases y un driver que recibe `CertificationCaseRunner`, pero el propio archivo declara que no ejecuta nada. Fuera de specs y generadores de documentación no hay importadores de `planCertificationLedger`, `driveCertificationRun` ni `certificationEvidenceFromLedger`. No están registrados en `SimulationModule`, ningún processor/servicio/controller los llama y no existe CLI operable. `benchmark-harness.ts` tiene la misma desconexión: funciones y pruebas PostgreSQL, sin módulo, job, comando ni UI/API que las opere.

Construye el camino real y hermético antes de pedir una credencial:

- servicio y processor/CLI explícito para planear, iniciar, pausar, cancelar, reanudar, consultar progreso y obtener el informe;
- runner de Parallly que resuelva el perfil, cree su fixture aislado, invoque el mismo `EvalService`/Agent Test con tools y verificador real, y devuelva transcript, modelo servido, costo, latencia y verificación;
- instalación de tablas mediante migración/bootstrap canónico con paridad, no DDL sólo alcanzable desde una función sin caller;
- permisos, auditoría, idempotencia y recuperación de publicación de jobs;
- modo dry-run sin proveedor y adapter falso que pruebe todo el cableado desde el entrypoint hasta el ledger;
- benchmark operable del mismo modo, incluyendo runner de Parallly y adapter falso de alternativa.

## P0: la autoridad del run no representa 76 perfiles

`CertificationRunInput` almacena un único `agentId`, `configHash` y `dependencyRevision`, aunque `planCertificationRun` puede incluir los 76 perfiles. Un perfil equivale a una configuración/plantilla distinta; una autoridad única no prueba las otras 75. El runner inyectado sólo recibe el lease con `profileId` y hoy no existe ninguna autoridad durable por perfil que ate el caso a la configuración realmente ejecutada.

Rediseña una de estas dos opciones y justifícala:

- un run padre con un sujeto/agent snapshot independiente por perfil, cada uno con agentId/configHash/dependencyRevision/mission/tool grants; o
- un run por perfil, agrupado por un batch de catálogo.

La evidencia sellada debe nombrar el sujeto exacto de cada perfil. Cambiar una plantilla invalida sólo la evidencia que depende de ella; cambiar una autoridad compartida invalida las dependientes. Añade una prueba negativa donde dos perfiles usan configuraciones diferentes y demuestra que la evidencia de uno no certifica al otro.

## P0: presupuesto concurrente y finalización prematura

`leaseCertificationCase` compara el presupuesto contra `SUM(cost_usd_cents)` de resultados ya escritos. No reserva el costo máximo de casos actualmente leased. Varios workers pueden arrendar trabajo mientras `spent` sigue sin cambiar, por lo que el exceso no está acotado a un caso como afirma el manifiesto; está acotado por todos los casos simultáneos. La prueba actual es secuencial y no cubre esto.

Además, cuando no encuentra una fila claimable llama `stopCertificationRun(..., 'complete')`. Si todos los pendientes están leased por otros workers, marca el run `finished` antes de que esos resultados regresen.

Corrige con reserva de presupuesto por lease o una contabilidad equivalente atómica; libera/ajusta la reserva al settle. Distingue `sin trabajo claimable porque sigue en vuelo` de `completo`. Un run sólo termina cuando no quedan pending, leased recuperables ni decisiones de retry. Prueba con workers concurrentes, lease perdido, resultado más caro/barato que la reserva, crash, deadline y cancelación. `driveCertificationRun` debe manejar explícitamente un `recordCertificationCase` rechazado y no contarlo como resultado propio.

## P1: el reporte sólo está parcialmente generado

La afirmación “cada fila sale del código” es demasiado amplia. A2–A4, B1, C1, D1/D3, E3, F3/F4, G2/G3 y sus gates se declaran manualmente; D2 y E2 son literalmente `open: 1`. Esto evita contradicciones de forma, pero no verifica las condiciones. Cambiar el código de esas áreas no cambia su estado.

Mantén la tabla, pero distingue `derived`, `executed_evidence` y `declared`. Cada fila aceptada o bloqueada debe apuntar a una autoridad ejecutable o quedar marcada como declaración pendiente de revisión. El `closure-report.json` versionado está generado para `1deec8d9`, no para HEAD `1422f491`; regenera al final y haz que CI falle si los artefactos no corresponden a HEAD o están desactualizados.

## P1: trabajo local que el propio reporte mantiene abierto

Cierra sin saltar ninguna fila:

1. A1/C2: diez familias sin comando/consentimiento ligado y tres sin cobro ligado.
2. D2: dataset, umbrales y resultados de calidad semántica bajo carga.
3. E2: lectores comerciales congelados y evaluación bajo tráfico concurrente.
4. G1: siete stores abiertos (`eval_runs`, `simulation_runs`, `agent_release_evidence`, `quality_regression_cases`, `handoff_summary`, `quality_scores`, `outbound_queue_job`). No cierres `outbound_queue_job` activando producción: elimina el camino legacy o migra localmente su productor al outbox bajo una transición segura y comprobable.
5. C3/F1: deben quedar bloqueadas sólo después de que el runner real exista y se haya ejecutado todo lo posible con adapter falso; la certificación generativa seguirá en gate LLM.
6. Ítem 10: Playwright hermético completo para onboarding, Assist, tours, publicación, OAuth simulado, teclado/foco/accesibilidad, móvil/escritorio y es/en/pt/fr.

## P1: compatibilidad de órdenes y citas existentes

El nuevo cobro de catálogo falla cerrado si una orden histórica no tiene `catalog_terms`. Eso es correcto para no cobrar una cifra no aceptada, pero desplegarlo puede bloquear pagos activos. El propio inventario reconoce históricos pendientes. El cambio equivalente en citas debe revisarse con el mismo criterio.

Antes de despliegue:

- genera dry-run por tenant con conteo e IDs/estados agregados de órdenes, citas y demás compromisos huérfanos, sin exponer PII;
- define qué filas pueden reconstruirse de evidencia durable y cuáles requieren revisión humana/reconfirmación;
- implementa UI/cola operativa para resolverlas y un comportamiento claro para el cliente;
- prueba upgrade con datos anteriores a las columnas de términos, rollback y convivencia entre versión vieja/nueva;
- publica métricas y alerta de intentos de cobro rechazados por falta de términos.

No hagas backfill inventando consentimiento a partir de `total_amount`.

## Verificación necesaria después de corregir

Los últimos 24 commits tocaron API, dashboard y shared. La verificación final registrada sólo repitió la suite API; el informe principal todavía muestra números anteriores del dashboard. Ejecuta en HEAD final:

- TypeScript en frío de los seis paquetes;
- cinco builds;
- bootstrap Nest;
- suites completas API, dashboard y WhatsApp;
- al menos tres órdenes de suite API con bases por worker;
- Playwright completo;
- migraciones/paridad/dry-run/rollback y compatibilidad desde un schema pre-lote;
- carga/caos del outbox y del nuevo runner concurrente;
- `git diff --check`, generadores reproducibles y artefactos con revisión HEAD.

## Camino de entrega

Sólo cuando el reporte tenga cero filas `abierta`, el runner real esté cableado, Playwright esté verde y la compatibilidad histórica tenga una operación segura, prepara un candidato de piloto. El orden posterior es:

1. push a rama de revisión y revisión completa de los commits/migraciones;
2. deploy a staging con flags apagados;
3. migraciones y dry-run de huérfanos;
4. smoke/E2E en staging;
5. autorización y ejecución de una cohorte pequeña de certificación LLM con presupuesto bajo;
6. piloto de un tenant/canal, outbox habilitado sólo para esa cohorte, observando SLO/rollback;
7. pilotos restantes y sesiones con usuarios;
8. benchmark autorizado;
9. rollout gradual con kill switch y rollback comprobados.

No despliegues directamente a producción ni actives el outbox para todos. Mantén commits incrementales, conserva las seis entradas ajenas y entrega trazabilidad requisito → commit → prueba → evidencia.
