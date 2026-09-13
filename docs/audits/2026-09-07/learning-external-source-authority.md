# Fuentes de aprendizaje en embeddings y reintentos de proveedores

7 de septiembre de 2026. Cambios locales posteriores a `b6db0507`, sin commit ni despliegue. Continúa las auditorías de fuentes, retención y ownership de workers de esta carpeta.

## Problema y cambio

La autoridad aplicada a `LLMRouter.execute` no abarcaba las llamadas de embeddings ni cada reintento interno de los SDK. Una revisión válida al comenzar podía enviar otra solicitud después de que su fuente cambiara. Además, las rutas que permiten continuar cuando falla RAG o memoria podían ocultar una fuente revocada como un fallo de servicio ordinario y producir evidencia evaluativa inválida.

`ExternalSourceAuthority` permite proteger resultados de cualquier tipo, incluidos vectores, sin guardar esos resultados en el contrato de autoridad. `LearningService.runtimeDataSourceAuthority` conserva los controles de tenant, agente, candidata/baseline, hashes, fuentes, intento, worker y namespace. La variante de generación delega en ese mismo control. La preparación de holdout y el análisis reutilizan su transacción ya abierta: no intentan adquirir otro lock de privacidad en una segunda conexión mientras un borrado espera.

| Recorrido | Comportamiento comprobado |
|---|---|
| Embedding del chat durante análisis/holdout | Comprueba la fuente antes y después de cada intento; una edición impide guardar el vector o avanzar al juez |
| Búsqueda automática en evaluación | Propaga la autoridad interna hasta embedding y reranking; una revocación interrumpe la evaluación |
| Herramienta `search_knowledge_base` | El adaptador de sesión y el ejecutor conservan el mismo control; no convierten la revocación en una lectura vacía ni en un error recuperable de herramienta |
| Memoria consultada con texto histórico | La revocación atraviesa las capas que normalmente toleran fallos de memoria; no se genera una respuesta evaluativa sustitutiva |
| Caché de embeddings de consulta | Las consultas con autoridad de fuente omiten lectura y escritura de la caché compartida |
| Generación de modelos | El router conserva un reintento transitorio con una comprobación nueva; deshabilita los reintentos internos para esas solicitudes mediante opciones de transporte separadas del input del modelo |

Los SDK de OpenAI permiten desactivar reintentos por solicitud; la documentación también aclara que los timeouts pueden reintentarse automáticamente. Se verificó la configuración en el código instalado y el comportamiento con transporte simulado. [OpenAI Docs: reintentos y timeouts](https://developers.openai.com/api/reference/typescript).

Para embeddings con fuente protegida hay hasta tres solicitudes explícitas, cada una con timeout de 45 segundos y `maxRetries:0`. La generación con fuente protegida conserva hasta dos solicitudes al mismo proveedor antes del fallback existente, cada una con comprobación propia. OpenAI, Anthropic, DeepSeek y xAI transmiten las opciones de transporte fuera del cuerpo HTTP. Las solicitudes sin autoridad de fuente conservan la política anterior de su SDK. El cliente instalado de Gemini fue inspeccionado: su ruta no contiene un reintento HTTP interno; no se ejecutó una prueba de transporte Gemini en esta tanda.

Una respuesta que llega después del cambio se descarta; el error conserva el uso reportado disponible sin incluir texto o vectores. Un rechazo por fuente no se trata como caída de proveedor ni habilita fallback. Los errores transitorios ordinarios sí permiten recuperación.

## Evidencia ejecutada

| Bloque | Resultado final |
|---|---|
| Fuentes PostgreSQL/Prisma y embeddings con SDK instalado | 2 suites / 58 casos, incluidos 51 PostgreSQL de fuentes y ownership |
| Paridad de Agent Test y semántica de herramientas de lectura | 2 suites / 27 casos |
| Router y transporte de OpenAI, Anthropic, DeepSeek y xAI | 2 suites / 34 casos; 28 usan providers y SDK reales con HTTP simulado |
| Regresión de conocimiento, memoria, aprendizaje, namespace, routing y bootstrap | 13 suites / 135 casos verificados por bloques; incluyen 19 PostgreSQL/pgvector de publicación/memoria y 2 de namespace |

Son **19 suites / 254 casos distintos dentro de esta selección**, ejecutados en varios bloques, no una corrida global del repositorio. Se solapan con tandas anteriores y no deben sumarse a ellas como nueva cobertura. TypeScript de API y `git diff --check` pasan.

El primer bloque amplio de regresión encontró cuatro fallos en el fixture de memoria: su tabla sintética `conversations` carecía de `metadata`, que la operación actual de borrado ya utiliza. Se actualizó ese DDL y se comprobó que el borrado elimina los estados personales de procedimiento, reserva y misión en ambos contactos del perfil. Los 19 casos de esa suite pasaron al repetirla; las otras 12 suites ya habían pasado. No se cambió el servicio de borrado para acomodar el fixture.

Las pruebas ejecutan el SQL y los servicios de la aplicación contra bases efímeras de loopback. Las claves y respuestas de proveedor son sintéticas; no hubo llamadas a proveedores, cambios en tenants operativos ni cobros externos.

Para reproducir, definir `LEARNING_EVIDENCE_TEST_DATABASE_URL` y `KNOWLEDGE_MEMORY_TEST_DATABASE_URL` con una base desechable de loopback cuyo nombre termine en `_eval_isolation`, con pgvector disponible. Los patrones ejecutados fueron:

```text
knowledge-source-authority|learning-inbox-source.postgres
read-semantics.spec|agent-test-live-parity
llm-source-transport|llm-source-authority
knowledge-integrity|knowledge.retrieval-attribution|knowledge-memory-publication.pg|customer-memory.integrity|ai-tool-executor.knowledge-policy|rag-jurisdiction|learning.integrity|learning-evaluation.spec|learning-evaluation-worker|learning-evidence.postgres|agent-turn-source-authority|llm-router.tool-floor|app.bootstrap.spec
```

Cada patrón se pasó a `node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='<patrón>' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent`. Después de corregir el fixture se repitió únicamente `knowledge-memory-publication.pg`. La comprobación de tipos fue `node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false`.

## Límites y continuación del plan

- La comprobación posterior no puede retirar una solicitud ya recibida por un proveedor. Las pruebas de particiones de proceso, expiración de transacción y red real continúan abiertas.
- La cobertura se refiere a generación no streaming y a las rutas históricas descritas; faltan otras salidas externas, despacho diferido y revisión completa de trazas/caches de sesión.
- El uso reportado en errores de embedding se conserva, pero falta integrarlo de extremo a extremo en presupuesto y costo de cada evaluación, incluidos intentos descartados. No se presenta la métrica de llamadas del modelo como costo total del recorrido.
- Los reintentos explícitos tienen espera breve acotada. Continúan la integración de `Retry-After`, jitter y un deadline global por tarea compatible con los límites de la transacción; no hay certificación de latencia bajo carga.
- La procedencia válida no prueba calidad semántica. Continúan selección diversa, calibración humana del juez, comparación de estilo y exactitud, lectores congelados utilizables con tráfico y competencia por perfil/canal/idioma.

Esta tanda fortalece D2, E1 y G1–G3 del plan. No completa el programa ni modifica la matriz de competencia: los casos positivos y verificadores de negocio pendientes siguen pendientes.
