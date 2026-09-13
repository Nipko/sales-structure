# Procedencia privada de aprendizaje en runtime

Fecha: 2026-09-07. Estado: **implementado y registrado en `54379f90`, con revisión y validación exacta del índice**. Este bloque es un prerrequisito de la admisión de mensajes; todavía no conecta consumidores de admisión ni crea un outbox. El wrapper de fuentes del modelo sí reutiliza el helper de lectura.

## Contrato implementado

El helper interno [learning-runtime-footprint.ts](../../../apps/api/src/modules/learning/learning-runtime-footprint.ts) exporta:

- `createRuntimeLearningFootprint(tenantId, agentId, examples)`: produce un objeto serializable de versión `1`, tenant/agente y entradas `{releaseId, releaseHash, exampleId, projectionHash}`. No conserva texto de los ejemplos. Deduplica entradas idénticas y rechaza proyecciones diferentes para una misma identidad release/ejemplo. Distintos releases permanecen separados, para conservar la unión de fuentes usada durante un turno.
- `assertRuntimeLearningFootprint(query, schema, expectedScope, footprint, options)`: usa exclusivamente la conexión suministrada. Comprueba scope esperado y binding tenant/schema mediante `public.tenants` y `current_schema()`. No resuelve schema, abre transacciones, hace DDL ni invoca proveedores.

El hash cubre la proyección completa de `RuntimeLearningExample`, incluidos rationale, hechos requeridos y `authority:'style_only'`; el orden de inserción de claves no cambia el hash. Las propiedades adicionales también afectan la comparación. El guard reconstruye la proyección desde el snapshot del release y exige coincidencia exacta. **El hash detecta cambios; no es una firma ni autentica al productor.** El origen confiable sigue siendo el servidor y su base de datos. No existe un DTO público para este contrato.

Una selección vacía es explícita: `entries:[]`. El helper directo comprueba su scope y binding igualmente; no concede autoridad operativa. El wrapper de modelos conserva su ruta anterior sin consultas cuando no hay ejemplos ni scope de evaluación, después de validar la forma del scope privado. No inventa una fuente o un permiso global por esa ausencia.

## Lectura y admisión

`mode:'readonly'` no añade locks de filas, tablas o privacidad. El propietario del callback conserva el fence existente. Solo esta variante permite `allowCandidate:true`, como opción interna del preview/evaluación; la admisión requiere releases publicados.

`mode:'admission'` adquiere el lock compartido de privacidad **en la misma query/conexión** y el lock compartido de la fila de tenant. Debe llamarse antes de otros locks o después del fence de privacidad ya adquirido por el propietario. No sustituye los guards de agente, conexión o comando del consumidor.

La admisión bloquea los releases en orden estable y conserva locks compartidos de fuentes y ejemplos vigentes. Para fuentes Inbox, reutiliza la comprobación de identidad/historial y sus locks actuales: tabla de identidades y filas de conversación/contacto; estas últimas usan `NOWAIT`. Una edición que ya ganó puede hacer fallar la admisión. Si la admisión ganó, el trigger de revisión del historial impide que la edición cruce su COMMIT. Los locks deben terminar con esa transacción corta; **ningún callback de proveedor debe ejecutarse dentro de ella**.

No basta el fence de privacidad para serializar todo retiro: `LearningService.rollback` puede cambiar el release sin tomar el lock exclusivo de privacidad. El lock de su fila mantiene la comprobación de admisión válida hasta COMMIT. El borrado y la retirada de fuentes usan su fence exclusivo y esperan una admisión compartida activa.

## Fuentes y wrapper existente

El guard conserva todas las fuentes de entrenamiento **y holdout** referenciadas por el release, aunque la respuesta solo use uno de sus ejemplos. Comprueba snapshot/hash/estado del release, pertenencia al agente, fuentes activas sin tombstone, procedencia Inbox y todos los ejemplos vigentes enumerados por el release. No muestrea fuentes. Para imports de archivo conserva la comprobación existente de disponibilidad; no inventa un historial Inbox que ese import no tiene.

[LearningService.runtimeDataSourceAuthority](../../../apps/api/src/modules/learning/learning.service.ts) reutiliza la extracción para sus comprobaciones anteriores y posteriores al proveedor. Conserva el preview, el scope privado de evaluación, el rechazo de fuentes cambiadas, el uso facturado de respuestas descartadas y la propagación del error original del proveedor. No añade los locks de admisión a los modelos.

El guard de admisión aún no crea un efecto. Un rollback o borrado posterior no se resuelve aquí como entrega, cancelación de un comando o borrado de copias: esas políticas pertenecen al futuro consumidor. Tampoco debe usarse el wrapper de modelos alrededor de un envío irreversible: su comprobación posterior puede rechazar texto generado, pero no deshacer un mensaje aceptado por un proveedor. Siguen pendientes el outbox, los receipts, la retención de sus copias y los consumidores Web Chat/externos.

## Evidencia ejecutada

La validación final sobre el índice exacto pasó **API TypeScript y 11 suites / 200 pruebas**, incluidas **86 PostgreSQL/Prisma en tres suites**, sin casos omitidos. Incluye 32 tests unitarios nuevos y 15 tests nuevos con PostgreSQL/Prisma reales. Las carreras verifican mediante `pg_blocking_pids` que rollback, retiro del ejemplo, edición de holdout y retirada de fuente esperan el COMMIT; también repiten el guard sobre la misma query con el exclusivo de privacidad ya en cola. Se comprueban hashes, scope vacío/ajeno, preview y preservación del wrapper readonly.

Suites exactas:

- `apps/api/src/modules/learning/learning-runtime-footprint.spec.ts`
- `apps/api/src/modules/learning/learning-runtime-footprint.postgres.spec.ts`
- `apps/api/src/modules/learning/learning-inbox-source.postgres.spec.ts`
- `apps/api/src/modules/learning/learning.integrity.spec.ts`
- `apps/api/src/modules/ai/router/llm-source-authority.spec.ts`
- `apps/api/src/modules/learning/learning-evaluation.spec.ts`
- `apps/api/src/modules/conversations/agent-turn-source-authority.spec.ts`
- `apps/api/src/modules/conversations/agent-test-live-parity.spec.ts`
- `apps/api/src/modules/conversations/conversations.runtime-integrity.spec.ts`
- `apps/api/src/modules/simulation/simulation-replay.postgres.spec.ts`
- `apps/api/src/app.bootstrap.spec.ts`

La primera batería del árbol de trabajo pasó cinco suites / 125 casos. La integración exacta detectó dos fixtures incompletos de Replay: no registraban el tenant real y su tabla de ejemplos omitía `agent_id`, presente en producción. Se añadieron esos datos y su limpieza sintética; no se debilitó el guard. La suite de Replay pasó sus 20 casos y la batería final completa pasó después sobre el índice actualizado. Las cifras se solapan y no se suman como cobertura nueva.

Comandos de la batería inicial, desde la raíz del repositorio, con `LEARNING_EVIDENCE_TEST_DATABASE_URL` apuntando exclusivamente al PostgreSQL desechable de loopback autorizado:

```text
node --max-old-space-size=8192 node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='learning-runtime-footprint.spec|learning-runtime-footprint.postgres.spec|learning-inbox-source.postgres.spec|learning.integrity.spec|llm-source-authority.spec' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node --max-old-space-size=8192 node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false --pretty false
```

La validación final usó `node .validate-index.cjs apps/api/tsconfig.json`, la exportación verificada del índice y `node scratch/validate-learning-footprint-index.cjs`; resultados locales en `scratch/learning-footprint-commit/index-results.json`, selección en `index-subject.json` y log en `index-tests.log`. Esos auxiliares permanecen fuera del commit. Las pruebas crean y eliminan su schema sintético; no invocan proveedores ni prueban una integración de despacho que todavía no existe.
