# Registro, corrección y evidencia de mascotas

Estado: implementación preparada como bloque incremental sobre `6925009c` y la consolidación de vehículos, sin despliegue ni migración de tenants existentes. Fecha de la auditoría original: 7 de septiembre de 2026. Continúa la ejecución del plan completo.

## Problemas corregidos

- El registro admitía omitir la especie y guardaba `dog` por defecto. El esquema de herramienta y el comando ahora exigen nombre y especie explícitos; una mención incompleta no autoriza inventarlos.
- La comprobación de propietario y la actualización estaban en consultas separadas. El comando ahora bloquea y vuelve a comprobar contacto, conversación, mascota y versión operativa del agente dentro de la transacción que escribe.
- El ledger del executor no hacía atómica la escritura de la ficha con su recibo de dominio. Un reintento tras una respuesta perdida podía duplicar el registro o aplicar una corrección antigua. El recibo y la ficha se confirman juntos; la misma clave con otros datos se rechaza.
- La prueba con Prisma real encontró que `birth_date` recibía un parámetro de tipo texto. Se añadió el cast de fecha tanto al registro como a la actualización, con cobertura de fecha válida, corrección y borrado explícito.

## Comportamiento implementado

`PetCommands` es el punto común de registro, actualización y desactivación de `PetsService`. Valida campos permitidos, especie, fecha civil, peso, booleanos y límites de texto; conserva los campos que no se modifican y acepta `null` para borrar los opcionales permitidos. Los argumentos del modelo no pueden transferir la ficha a otro propietario.

El executor entrega contacto, conversación, clave de idempotencia y autoridad operativa por parámetros privados. `register_pet` y `update_pet` se suman a las herramientas que comprueban tenant, agente, versión, hash y activación en la misma transacción del efecto. El total actual es quince herramientas protegidas; esto no implica que todos los efectos de la plataforma ya compartan esta protección.

La inicialización de `pet_command_receipts` se serializa entre instancias, antes de la transacción operativa. La prueba concurrente incluye el primer uso con la tabla ausente. El borrado de memoria elimina estos recibos derivados para la familia de contactos unificados; el tombstone impide recrearlos mediante nuevos comandos. Esta cobertura no certifica el borrado de las fichas originales, vacunas ni todos los derivados clínicos.

Se mantiene la política existente de registro: una solicitud de registrar no exige una segunda confirmación. `update_pet` exige confirmar la propuesta vigente. Las expresiones de corrección en es/en/pt/fr se incluyen únicamente en el token firmado de esa propuesta; una confirmación condicionada que cambia el peso sigue sin autorizarla. El contrato declarativo del dominio todavía resume esta tarea como `explicit`; falta representar por separado solicitud inicial y confirmación adicional, sin confundir esa etiqueta con una garantía de comprensión del lenguaje.

## Evaluación y aprendizaje

- Los dos writers están habilitados exclusivamente mediante el namespace aislado y su lease verificado. Agent Test ordinario continúa siendo de solo lectura.
- El sandbox incluye fichas, vacunas y recibos vacíos; los fixtures contienen mascotas y propietarios sintéticos. No se copian registros clínicos productivos.
- La selección conserva `list_pets_for_contact` como dependencia de registro y actualización cuando ese lector está autorizado.
- Hay seis escenarios propios por perfil e idioma: registrar, consultar sin duplicar, corregir, pedir especie faltante, responder una duda y rechazar una ficha ajena. Aplican a ocho perfiles de veterinaria y servicios para mascotas: **192 escenarios declarados**, todavía sin ejecuciones LLM por revisión/canal/idioma.
- Los verificadores comprueban conteo, propietario y campos del objeto. El escenario de ficha ajena conserva el objeto propio; la prohibición de modificar el ajeno tiene además prueba directa de comando con PostgreSQL.
- El verificador de aprendizaje exige ledger exitoso, recibo del mismo comando/contacto/objeto y coincidencia de todos los campos de negocio con la ficha actual. PostgreSQL reconstruye los tipos del recibo para comparar fechas y decimales correctamente. Una ficha corregida posteriormente, un recibo ajeno/ausente o una respuesta inconsistente quedan sin verificar. El recibo no prueba por sí solo pertinencia, exactitud clínica ni calidad de tono.

Matriz regenerada: **76 perfiles, 268 tareas, 146 transaccionales, 32 sin positivo propio, 10 sin verificador y cero perfiles certificados**. Antes de esta tanda los huecos eran 40 y 18. La reducción corresponde a la tarea de registro en ocho perfiles; no equivale a ocho perfiles certificados.

## Verificación ejecutada

Selección de **26 suites / 373 casos comprobados por bloques**. La última ejecución de los tres bloques PostgreSQL afectados pasa **60 casos**: 37 del executor canónico, 19 del comando de mascotas y cuatro de evidencia operacional mediante Prisma. Los cuatro casos del pack canónico pasan por separado; los otros 309 casos de 22 suites pasaron en la batería conjunta y no se suman nuevamente.

Se corrigieron dos fixtures antiguos de inventario de writers y el inventario de packs, y se añadió `uuid-ossp` a la preparación de la base aislada que usa el DDL real. La primera batería conjunta tuvo fallos en esos fixtures; el posterior recorrido Prisma descubrió el fallo real de fecha descrito arriba. Los bloques afectados se volvieron a ejecutar después de corregirlos.

TypeScript de API y shared pasa; `git diff --check` pasa. Incluye bootstrap NestJS, permisos, consentimiento, borrado de memoria, autoridad de agente, aprendizaje, packs y verificadores. No incluye revisión visual ni un proveedor/modelo externo.

Comandos desde la raíz (PowerShell; variables de conexión exclusivamente a bases sintéticas de loopback):

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='pet-commands.postgres|isolated-canonical-commands|isolated-eval-namespace|eval-canonical-fixtures|eval-effect-verifier|canonical-task-eval-pack|pet-task-eval-pack|pets.pagination|task-competence-matrix|agent-test-eval-writer|intent-normalizer.spec|tool-execution-control|tool-execution-authority|tool-subpermissions|ai-tool-executor.central-controls|compliance-memory-erasure|served-agent-authority.postgres|app.bootstrap.spec|learning-operation-evidence|learning-evaluation.spec|learning.integrity|tool-policy-registry' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='pet-commands.postgres|learning-operation-evidence.postgres|isolated-canonical-commands' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project packages/shared/tsconfig.json --noEmit --incremental false
node docs/audits/2026-09-07/generate-competence-matrix.cjs
git -c core.safecrlf=false diff --check
```

`PARALLLY_ISOLATION_TEST_URL` apunta a PostgreSQL sintético en 55437; `LEARNING_EVIDENCE_TEST_DATABASE_URL`, a la base sintética de conocimiento en 55439. Las suites comprueban host/nombre de base y limpian sus esquemas propios. Sin estas variables, las suites PostgreSQL se omiten y no constituyen esta evidencia.

## Frentes que permanecen abiertos

Integración real por perfil, canal y modelo; interpretación de solicitudes sin preguntas adicionales innecesarias; métricas de tono y utilidad; alojamiento/guardería y ciclos clínicos; revisión de privacidad de originales y lectores; publicación/piloto/rollback integral; evaluación con datos congelados bajo tráfico; pilotos de proveedores y usuarios nuevos. El objetivo completo continúa activo. El bloqueo histórico de commits por límite de uso ya no describe el estado actual: los bloques anteriores se han registrado incrementalmente. Este documento no afirma un despliegue ni una certificación de producción.

## Validación del bloque incremental preparado

La copia de verificación parte de `6925009c` más el candidato de vehículos `9d80f895e5b1d3b7a5efde27e525a794cd8f0c8de4cbf2c95f6c69e1f5b80d5f`; añade únicamente mascotas y una corrección de compatibilidad en una expectativa antigua de FAQ. No incluye réplica RAG, Simulation Replay ni los nuevos cambios de reentrancia de fuentes.

TypeScript de API y shared pasa. La selección actual contiene **26 suites / 389 casos comprobados por bloques**, sin casos omitidos. La primera ejecución aprobó 388 y falló una expectativa de cuatro argumentos del lector FAQ; el contrato de conocimiento capturado, ya registrado anteriormente, pasa un quinto argumento opcional. Se corrigió sólo esa expectativa y la suite afectada volvió a ejecutarse con **18/18 aprobados**. No se presenta el total de 389 como una única corrida general sin fallos ni se suman de nuevo los 17 casos repetidos.

Las pruebas PostgreSQL actuales aprobadas son **93**, incluidas dentro de esos 389: 19 del comando de mascotas mediante Prisma, 44 del executor aislado y sus ciclos, cuatro del verificador de aprendizaje, 17 de autoridad operacional y nueve del aislamiento PostgreSQL. El executor tiene más casos que la batería histórica porque la base actual ya incluye la captura temporal y los lectores de vehículo. Las dos pruebas restantes del archivo de aislamiento son pruebas de política SQL y no se cuentan como PostgreSQL.

La matriz fue regenerada desde esa copia: **76 perfiles, 268 tareas, 146 transaccionales, 32 sin caso positivo propio, 10 sin verificador y cero certificados**. Los escenarios declarados no se han convertido en evidencia de ejecución por modelo, idioma o canal. No se usaron proveedores externos ni datos reales de clientes.

La verificación final del índice integrado sobre `1e93a2df`, que también incluye el capturador RAG ya registrado, pasó **26 suites / 389 casos en una ejecución completa**, además de TypeScript API y shared sobre el índice. Ese total se solapa con el candidato anterior; no añade 389 casos nuevos. El contenido exportado para probar se cotejó con los blobs exactos del índice.
