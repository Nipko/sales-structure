# E2 — Preguntas frecuentes y políticas capturadas

Fecha: 2026-09-07. Base del checkout: `b6db0507`, con las tandas locales posteriores conservadas. Amplía la captura del contexto del núcleo con dos lectores de conocimiento estructurado. El capturador de servicios y RAG todavía no se integran en esta tanda.

## Cambio operativo

`AgentTestService.captureSnapshot` obtiene las colecciones completas de FAQs publicadas y políticas activas mediante `EvaluationRevisionService.captureStructuredKnowledge`. Ambas se leen en una transacción PostgreSQL `REPEATABLE READ` y `READ ONLY`, junto con la pertenencia del esquema al tenant y la hora de captura. La firma inicial y la comprobación final del manifiesto global siguen envolviendo la construcción completa del snapshot.

La proyección contiene sólo columnas de los lectores. No copia FAQs sin publicar, políticas inactivas, autor de la política, metadatos arbitrarios ni credenciales. La captura diferencia tabla ausente y colección presente vacía. Una vista, esquema ajeno, columna ilegible o error de consulta no se convierten en resultados vacíos. La ausencia verificada de una tabla queda registrada; intentar consultar ese lector informa `evaluation_structured_knowledge_source_absent`.

El snapshot privado incorpora `structuredKnowledgeInputs` y el manifiesto lo sella con `frozen.structured_knowledge`. Se comprueban tenant, esquema origen, formato e integridad. Snapshots anteriores sin las dos colecciones deben recapturarse y reevaluarse; no se rellenan leyendo el estado actual.

| Recorrido | Comportamiento |
|---|---|
| `search_faqs` | El adaptador de sesión transmite la colección privada a `FaqsService.search`. Sus mismos predicados de texto completo, ILIKE y plegado de tildes se ejecutan sobre un recordset PostgreSQL parametrizado. No vuelve a resolver el esquema ni a leer la tabla FAQ para esa búsqueda. |
| `get_policy` | `PoliciesService.getActive` conserva validación de tipo, versión, proyección y predicado `is_active`. En evaluación consulta la colección capturada sin caché productiva. |
| Mensajería normal y editores | Conservan los lectores vivos; no aceptan una captura en modo con persistencia habilitada. |
| Agent Test / Eval / Simulation / LearningEvaluation | Usan la captura del snapshot a través del adaptador común. El modelo no puede sustituirla enviando un campo homónimo en sus argumentos. |

La consulta FAQ también corrige un defecto de relevancia del lector vivo: `ORDER BY rank DESC` colocaba primero los vectores nulos. Ahora usa `NULLS LAST` y un desempate por ID después del orden configurado. Las coincidencias indexadas preceden al fallback sin vector y los empates tienen un orden reproducible en ambos recorridos.

## Verificación

**18 suites / 214 pruebas pasan** en una única batería final. TypeScript API y `git diff --check` pasan. Esta cifra se solapa con baterías de tandas anteriores y no debe sumarse a ellas como cobertura independiente.

La tanda añade **14 casos PostgreSQL/Prisma** y **ocho casos de integración del snapshot**. La base es desechable local; cada suite crea tenant/esquema propios, usa las definiciones reales de las tablas FAQ/policies y elimina únicamente su ámbito al terminar.

- Paridad entre lectores vivos y capturados para es/fr/pt/en, tildes, vector nulo, consultas sin resultado y texto con caracteres de SQL. La serialización JSONB conserva los valores que devuelven los servicios.
- Ranking de coincidencias indexadas y desempate estable con inserciones en el orden contrario al esperado.
- Exclusión de contenido no publicado/inactivo y de la identidad del autor; preservación de versión y fechas de las políticas.
- Resultados históricos inmutables inspeccionados directamente en el puerto; la guarda global rechaza después los cambios de FAQ/política y nuevas publicaciones. La prueba directa del puerto no sustituye esa guarda.
- Una colección vacía permanece vacía; publicar su primera fuente invalida el manifiesto anterior.
- Una edición de política desde otra conexión entre las lecturas de FAQ y política no mezcla revisiones. La transacción rechaza un `UPDATE`.
- Tabla ausente, vista con consulta oculta y columna ausente se distinguen de un resultado vacío, sin DDL de reparación ni fallback fuente.
- Captura incompleta, alterada, de otro tenant/esquema o usada en modo vivo se rechaza. El sello interno no permite cambiar contenido sin invalidar también la firma del snapshot.
- Recorrido del núcleo Agent Test con herramientas reales de FAQ/policies y manifiesto PostgreSQL: las respuestas proceden de la captura. El LLM, el preflight de herramientas y otros bordes del fixture siguen simulados; no es una certificación del proveedor ni de una vertical.
- Regresión de bootstrap, cero escrituras, core/contexto, operaciones canónicas aisladas, release, simulación, aprendizaje y autoridad de fuentes externas.

Comandos ejecutados, con `PARALLLY_ISOLATION_TEST_URL` y `AGENT_RELEASE_TEST_DATABASE_URL` configuradas exclusivamente para `parallly_eval_isolation` en loopback:

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='evaluation-structured-knowledge|evaluation-turn-context|agent-test.service.spec|agent-test-live-parity|agent-test-zero-write|agent-evaluation-snapshot|evaluation-reader-inventory|evaluation-revision.postgres|agent-release.postgres|isolated-canonical-commands|app.bootstrap.spec|simulation-fidelity|learning-evaluation.spec|read-semantics|knowledge-source-authority|agent-turn-source-authority' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false
git -c core.safecrlf=false diff --check
```

## Límites y siguiente integración

1. **No se reduce el manifiesto global.** Sus lecturas siguen ejecutándose antes y después del uso. La edición de estas fuentes y el tráfico de otras tablas todavía pueden invalidar una evaluación larga. Estas comprobaciones no mantienen un bloqueo de toda la base durante una llamada al modelo ni garantizan revocación instantánea dentro de esa llamada.
2. La transacción MVCC cubre ambas colecciones estructuradas; la construcción completa del snapshot conserva varias capturas y su validación global. No se afirma una transacción única para todos los datos del agente.
3. `search_knowledge_base`, RAG automático, embeddings, memoria, conflictos y reranker conservan sus fronteras previas. No se presenta esta tanda como aislamiento de todo el conocimiento.
4. Catálogo, agenda y otras familias requieren datos comerciales coherentes con los comandos. Los fixtures canónicos actuales siguen siendo sintéticos. La diferencia entre sus horarios legacy y la precedencia de horarios capturados del núcleo se corrigió en una tanda posterior: [Contexto temporal de evaluación](C:/Users/USER/Desktop/Sales_Structure/docs/audits/2026-09-07/evaluation-temporal-context.md). La réplica comercial continúa pendiente.
5. La captura rechaza más de 20.000 filas por colección o más de 25 MiB en conjunto, sin truncar resultados. Son límites internos de recursos, no cuotas comerciales. Faltan benchmark de volumen, optimización del transporte de recordsets y verificación de todos los recorridos de retención de snapshots históricos. Copiar sólo contenido publicado no equivale a anonimizar texto libre.
6. Se conserva el significado actual de política activa (`is_active`); esta tanda no agrega publicación por fechas ni corrige el ciclo transaccional de edición de políticas. La calidad semántica, citas correctas y resultados por misión siguen necesitando evaluación y calibración.

No hay cambios de páginas, despliegue, push ni migraciones en tenants existentes. Las modificaciones siguen locales: el revisor automático rechazó previamente el siguiente commit por límite de uso, y los tres subagentes continúan en error por ese mismo límite. No se reintentó ni se eludió la restricción; el índice anterior de 11 archivos se conserva.
