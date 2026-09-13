# E2 — Réplica de RAG y lectores canónicos

Fecha: 2026-09-07. Capturador separado para commit sobre la infraestructura ya registrada; la integración de consumidores permanece pendiente.

## Estado

Implementados el capturador de una réplica relacional de conocimiento, su referencia privada, la validación de integridad/lease y la opción de lectura en `KnowledgeService`. Probados con Prisma, PostgreSQL y pgvector reales. **Agent Test, Eval, Simulation y Learning todavía no crean ni seleccionan automáticamente esta réplica.** El RAG de esos recorridos continúa leyendo su fuente como indica el inventario; E2 sigue abierto.

## Copia y selección

`captureKnowledgeReplica` crea un namespace propio en una transacción `REPEATABLE READ`. Copia los datos con `INSERT ... SELECT` dentro de PostgreSQL: el corpus y los vectores no viajan a Node ni quedan repetidos en el JSON del snapshot. La referencia contiene propietario, token, caducidad, esquema de origen, estado/conteo/hash de las colecciones y sello de integridad.

Las siete proyecciones revisadas cubren:

- Documentos listos y sus embeddings, con texto, versión, idioma, ámbito, audiencia, agentes, jurisdicción y vigencia.
- FAQs publicadas, políticas activas y filas de identidad del negocio necesarias para comprobar las fuentes relacionadas de un conflicto.
- Casos de conflicto que apuntan a documentos capturados y sus decisiones. No se copian actores, motivos privados del revisor ni campos que el lector no utiliza.

Los defaults, triggers, funciones y credenciales del origen no se clonan. Las tablas se crean a partir de definiciones expresas; relaciones externas/vistas y tipos o collations no revisados se rechazan. Los campos opcionales de identidad conservan ausencia/null. Se preserva el tipo temporal del origen (`timestamp` o `timestamptz`), evitando que una conversión cambie los hashes de revisión o el día de vigencia. Se acepta explícitamente el almacenamiento legacy sin `search_tsv`: la copia registra búsqueda de palabras ausente, conserva vectores y no repara el origen.

La ausencia de una tabla se registra y no se transforma en una tabla vacía. El capturador limita cada colección a 100.000 filas y la suma de las proyecciones a 512 MiB lógicos; superar cualquiera de los límites aborta la transacción. El corpus no se trunca. Estos son límites técnicos de esta primitiva, **no cuotas de un plan**.

La asignación administrada opcional usa cuatro nombres de namespace deterministas por tenant, cada uno con una reserva lógica de 512 MiB. Una captura concurrente sobre un slot ocupado falla sin borrar la copia que ganó. Se guarda un descriptor del corpus, sus bytes lógicos y una referencia de uso con agente, token y expiración; el lector administrado exige esa referencia vigente. Esta base no impone todavía un presupuesto global de disco: la ruta de captura sin asignación sigue disponible, los índices tienen sobrecosto físico y falta que un gestor seleccione/reutilice/libere slots y referencias. La disposición actual retira el namespace completo; no debe emplearse como liberación de una referencia compartida hasta implementar ese gestor.

`knowledgeReplicaSchema` verifica la referencia, su permiso de uso readonly, el propietario, el vínculo actual tenant→schema, la caducidad del marcador y el contenido de las colecciones en una transacción MVCC readonly. Una copia alterada, vencida, ajena o ilegible se rechaza antes de solicitar embeddings. La comprobación termina con esa transacción: no mantiene un lock durante la búsqueda o llamada al modelo. Los consumidores deben conservar las guardas vivas de fuentes, permisos y consumo; esta referencia no otorga autoridad futura.

`KnowledgeService.tenantHasKnowledge` y `searchRelevant` admiten la referencia únicamente en una opción interna. Ejecutan su búsqueda vectorial, tsvector, filtros, fusión y anotaciones originales contra la copia. La selección de conflictos sigue comprobando hash, audiencia, agente, jurisdicción y preferencias revisadas mediante `KnowledgeConflictService`.

## Fallos descubiertos y corregidos

La primera ejecución real detectó `cached plan must not change result type`: el lector devolvía `varchar` en el origen y `text` en la réplica usando la misma consulta preparada de Prisma. Se normalizaron las proyecciones textuales del RAG. La consulta de anotaciones pasó de `c.*` a los campos que consume, evitando también cambiar el número de columnas del resultado entre esquemas. Se añadieron desempates por ID en los pools y casos para que los empates no dependan del orden físico de las filas.

La regresión actualizó dos fixtures unitarios que reconocían la antigua forma del SQL y un fixture PostgreSQL de atribución al que le faltaba `conversations.metadata`, utilizado por el borrado real. No se cambió la lógica de borrado para acomodar ese fixture.

## Evidencia

La copia del contenido exacto preparado para commit pasó **10 suites / 103 pruebas**, incluida la suite de réplica con **24 casos PostgreSQL/pgvector**. TypeScript API sobre el índice y `git diff --check` pasan. La batería incluye búsqueda y conflictos, publicación de documentos/memoria, atribución y borrado, jurisdicción, autoridad de fuentes, semántica de lecturas y bootstrap de Nest. Los tres selectores de base de datos apuntan exclusivamente al PostgreSQL/pgvector de loopback `parallly_knowledge_eval_isolation`.

La batería histórica de 99 pruebas y la comprobación anterior de 21 casos de réplica se solapan con esta ejecución; no se suman como pruebas adicionales. El inventario de lectores se registrará junto con los demás ciclos que describe y no forma parte de este commit del capturador.

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='evaluation-knowledge-replica.postgres.spec|knowledge-conflict|knowledge-memory-publication.pg.spec|knowledge-source-authority.spec|knowledge-contracts|knowledge-attribution|knowledge.*search|jurisdiction|read-semantics.spec|app.bootstrap.spec' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false
```

La suite PostgreSQL ampliada pasa **24 casos**, incluidos tres nuevos de asignación administrada, carrera por un slot y referencias de uso ausentes, ajenas o vencidas. Esta ejecución amplía la evidencia histórica anterior; no prueba todavía un gestor de reutilización o su integración al runtime. Entre los casos:

- Coincidencia de resultados y procedencia entre fuente y réplica en cuatro idiomas, sin cache productiva ni resolución posterior del schema fuente por el lector.
- Filtros de audiencia, agente, país, fechas y estado; corpus vacío, tabla ausente y primera fuente elegible.
- Preferencias revisadas de documentos frente a documentos, FAQs, políticas e identidad.
- Preservación de revisiones y fechas de fuentes con tipos temporales distintos, incluida precisión de microsegundos en el almacenamiento.
- Edición concurrente entre copia de documentos y embeddings: ambos conservan la misma revisión MVCC.
- Cambio de fuente: la copia conserva su contenido histórico y el manifiesto integral vivo rechaza la evaluación obsoleta.
- Sello/token ajeno, cambio de vínculo del tenant, alteración de la copia, expiración y uso operativo no autorizado.
- Falta de columna, vista o dominio no revisado y corpus de más de 100.000 filas: rechazo sin namespace parcial.
- Limpieza por el mecanismo común `reapExpired`, disposición repetida y conservación del origen.

Las llamadas de embeddings usan un vector sintético; no se hicieron peticiones a proveedores. La prueba de capacidad no es una medición de rendimiento de búsquedas a ese volumen.

## Siguiente integración obligatoria

1. Registrar la propiedad y el ciclo de vida de la réplica antes de crearla desde `captureSnapshot`; sellar su referencia en `AgentEvaluationSnapshot`, ligar schema/agente/revisión y limpiar capturas fallidas. Incorporar presupuesto agregado por tenant, recuperación tras crash y limpieza periódica que incluya tenants inactivos. La limpieza disponible como método no demuestra que esos recorridos ya la invoquen.
2. Conectar RAG automático y `search_knowledge_base` a la misma referencia privada, ignorando parámetros del modelo. Separar integridad del snapshot conservado para revisión humana de vigencia del lease requerida para volver a ejecutar. Exigir la copia en evaluación y contabilizar su indisponibilidad como fallo, sin fallback al origen.
3. Integrar retiro por borrado/revocación de fuentes y las guardas antes de cada uso externo. Un lease de una hora no sustituye una política de privacidad ni garantiza borrado inmediato de derivados.
4. Medir costo de captura, hashes, almacenamiento y consultas bajo carga. La réplica actual tiene índices de documento, tsvector y decisiones; la búsqueda vectorial no tiene todavía un índice ANN certificado. Comparar planes/recall, límites y rendimiento antes de habilitarla ampliamente.
5. Completar réplica comercial, reloj y demás lectores; mantener el manifiesto integral hasta probar todas las dependencias. El reloj SQL/OS, proveedor de embeddings y reranker continúan vivos. Esta tanda no certifica verdad semántica, perfiles, canales ni liderazgo de mercado.

Sin migración de tenants existentes, push ni despliegue. La revisión automática volvió a autorizar los commits normales; el registro incremental conserva separada esta primitiva de la integración pendiente.
