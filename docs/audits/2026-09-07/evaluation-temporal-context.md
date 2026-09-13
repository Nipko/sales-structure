# E2 — Horarios y zona de los escenarios canónicos

Fecha: 2026-09-07. Implementación registrada en `6625a535`, sobre el contexto congelado de `a70995f7`. Corrige la diferencia entre el contexto capturado del núcleo y las fechas/horas usadas por los escenarios y comandos del namespace de evaluación.

## Problema y cambio

El núcleo ya daba precedencia a `contextInputs.businessHours` y a la región capturada, mientras `resolveCanonicalEvalFixtures` generaba fechas a partir de `snapshot.config.hours`. Un agente con horario legacy de Bogotá y horario de cuenta en Auckland podía recibir un escenario construido para otra fecha/zona. Además, `AppointmentsService.create` podía resolver la zona de un schema sintético mediante el lector regional público, que no tiene un tenant asociado y terminaba en el valor por defecto.

`evaluationTemporalInputs` aplica la misma precedencia factual del núcleo:

- Horario del tenant capturado antes del horario legacy del agente. La presencia de un horario vacío o 24/7 del tenant no hereda un horario cerrado del agente.
- Zona del horario del tenant, después zona del agente, después región capturada y finalmente el fallback existente.
- Días en inglés para la configuración de cuenta; compatibilidad es/en para el horario legacy del agente. Se conservan validaciones estrictas de horarios inválidos, contradictorios o demasiado cortos.
- En el formato de cuenta con `enabled`, `open/close` prevalecen sobre los antiguos `start/end`, como en el núcleo.

`prepareCanonicalEvalFixtures` proyecta los horarios efectivos en la fila sintética `persona_config` y en `availability_slots`, sin modificar el snapshot ni la configuración de origen. Los lectores de la agenda del namespace reciben así la zona usada para generar el escenario.

`evaluationNamespaceTimezone` comprueba tenant, esquema, token y expiración del lease, y exige exactamente una configuración activa con zona válida. Esa lectura ocurre con `FOR SHARE` dentro de la transacción del lector. Creación directa de citas, disponibilidad, creación desde herramienta y reprogramación usan este dato en evaluación. Una zona ausente, duplicada, inválida o sin lease vigente no se sustituye por Bogotá ni por metadata del llamador. La creación conserva la zona canónica en metadata.

El lease se vuelve a comprobar en los comandos mediante sus guardas existentes. El lock de esta lectura temporal termina con su transacción; no se afirma que mantenga bloqueada la configuración durante toda la conversación o llamada al modelo.

## Evidencia ejecutada

La validación del contenido exacto preparado para `6625a535` pasó **9 suites / 152 pruebas**, incluidas **37 con PostgreSQL/Prisma**, además de TypeScript API y `git diff --check`. El bloque registrado excluye los comandos nuevos de vehículos y mascotas y sus escenarios.

Antes de separar los commits, el directorio de trabajo combinado pasó **17 suites / 206 pruebas**. Esa evidencia incluye cambios de otros bloques aún locales en ese momento y no equivale a la validación aislada del commit temporal. La batería inicial de tres suites / 95 casos se solapa con esa ejecución.

Se añadieron nueve casos de contexto/fixtures y siete de PostgreSQL en la suite de comandos canónicos, que ahora contiene 44 casos. Entre ellos hay un recorrido con Prisma real que prepara los fixtures completos y crea la cita; su lector regional vivo está configurado para fallar si se invoca.

- Tenant en Auckland con horario martes 13:15–14:15 sustituye un horario legacy de Bogotá/lunes. Escenario, slots y configuración sintética concuerdan; el snapshot original permanece intacto.
- Horario vacío, null y 24/7 de cuenta conservan su significado. Un cierre o un formato de días inválido detiene el sembrado sin escrituras.
- La región capturada se usa si no hay zona declarada en horarios; una zona del agente conserva precedencia sobre ese fallback.
- El generador omite una hora inexistente de París por DST y busca el siguiente día elegible. La comparación con el núcleo Agent Test verifica la misma zona capturada.
- Una creación directa que intenta imponer Bogotá mediante metadata se rechaza si la hora no existe en París; una hora válida conserva París en la cita.
- Configuración temporal ausente, duplicada o inválida, lease vencido y token ajeno fallan sin crear citas.
- El recorrido Prisma prepara los datos, crea la cita a las 13:15 de Auckland y no consulta la región pública ni ejecuta calendario/eventos externos.
- La regresión cubre ciclos de agenda y pruebas de manejo, términos y capacidades, Agent Test, contexto capturado, simulación/aprendizaje, packs de tareas y bootstrap de Nest.

Comandos ejecutados, con `PARALLLY_ISOLATION_TEST_URL` apuntando únicamente a `parallly_eval_isolation` en loopback:

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='eval-canonical-fixtures.spec|isolated-canonical-commands.spec|temporal-capacity-contract.service.spec|ai-tool-executor.appointment-safety|agent-test-eval-writer|agent-test-live-parity|evaluation-turn-context|agent-test-zero-write|simulation-fidelity|learning-evaluation.spec|vehicle-task-eval-pack|pet-task-eval-pack|catalog-task-eval-pack|repair-task-eval-pack|canonical-task-eval-pack|app.bootstrap.spec' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false
git -c core.safecrlf=false diff --check
```

## Alcance restante

El reloj del sistema, `NOW/CURRENT_DATE`, vencimientos, retenciones y frescura de proveedores siguen vivos. Esta tanda no congela el tiempo de toda la plataforma ni resuelve todos los límites de fecha de sus lectores. La agenda y los catálogos de evaluación siguen usando datos sintéticos; la réplica comercial y RAG continúan pendientes. No se reducen dependencias del manifiesto global ni se certifican perfiles, idiomas o canales.

La modificación de la resolución de zona en comandos se limita al namespace de evaluación. La armonización completa de horarios/zonas de todas las superficies operativas, calendarios externos y reglas temporales sigue dentro del plan general.

No se hicieron migraciones en tenants existentes, push ni despliegue. La revisión automática volvió a autorizar las operaciones normales de Git y el bloque quedó registrado en `6625a535`, sin eludir permisos.
