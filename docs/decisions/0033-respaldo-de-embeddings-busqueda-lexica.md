# 0033 — Respaldo de embeddings: sin OpenAI, la búsqueda de conocimiento pasa al índice léxico en vez de fallar

- Estado: aprobada (decidida con la autorización autónoma del dueño; se revisa con él a su regreso)
- Fecha: 2026-11-11 · Decide: dueño · Autor: Claude
- Ámbito: `apps/api` (`modules/knowledge/knowledge.service.ts`, `modules/knowledge/embedding-fallback.ts`, `knowledge-contracts.ts`).

## Contexto

El 10-nov-2026 la cuenta de OpenAI se quedó sin crédito. El chat siguió funcionando gracias al fallback del router (ADR-0026) hacia DeepSeek y xAI, pero los embeddings no tienen respaldo: `KnowledgeService.generateEmbedding` llama siempre a OpenAI `text-embedding-3-small`. Cada búsqueda de conocimiento terminaba en error. Una medición de Claude Haiku 5.5 falló en 38 de 40 casos dental por el `429 You have no credits remaining` de los embeddings, aunque Haiku respondía bien.

Cómo se guardan hoy los vectores:

- `knowledge_embeddings.embedding vector(1536)` en cada esquema de tenant (y en las réplicas de evaluación), más `search_tsv tsvector` con índice GIN (`idx_ke_tsv`), que ya alimenta el pool BM25 de la búsqueda híbrida.
- `customer_memory_facts.embedding` y `learning_examples.embedding`, también de 1536 dimensiones.
- Todos los vectores son de `text-embedding-3-small`.

Qué proveedores configurados dan embeddings: OpenAI y Google (`gemini-embedding-001` admite `outputDimensionality = 1536`). Anthropic, DeepSeek y xAI no tienen API de embeddings.

## Decisión

1. **Modo degradado léxico.** Si no hay vector de consulta porque OpenAI no está disponible, `searchRelevant` y `searchFiltered` buscan solo en `search_tsv`:
   - El pool admite un fragmento si contiene **alguno** de los lexemas de la pregunta (`plainto_tsquery` con `&` cambiado por `|`). Se ordena por cuántos lexemas contiene y después por `ts_rank_cd`.
   - El `score` de cada resultado es la **cobertura**: qué parte de los lexemas de la pregunta está en el fragmento (0–1), más el mismo `LANG_BOOST` de siempre. Reemplaza a la similitud del vector frente a `similarityThreshold`. Así un umbral de 0,35 sigue queriendo decir «una parte apreciable de la pregunta está aquí», no «comparten una palabra».
   - La excepción al umbral (`_bm25`) se mantiene solo para la coincidencia estricta: el fragmento contiene **todos** los lexemas (`plainto_tsquery` con AND), igual que en el modo híbrido.
   - Las mismas compuertas de siempre: jurisdicción, vigencia, audiencia y agente, `knowledgeSourceAvailable`, reranker, conflictos y `trackRetrieval`.
   - Cada resultado lleva `retrievalMode: 'lexical_fallback'` (o `'hybrid'` en el modo normal) y `similarity = 0`.
2. **Qué cuenta como «OpenAI no disponible»** (`isEmbeddingOutage`): `classifyProviderError` (ADR-0026) da `quota`, `auth`, `rate_limit`, `unavailable` o `model_not_found`; o falta la clave (`embeddings_unavailable`); o el breaker está abierto. **Nunca** cuenta `LLMSourceAuthorityUnavailable`: una fuente revocada es evidencia que no se puede usar, no una caída, y sigue propagándose. Un 400 o un error de programación tampoco cuenta: sigue fallando como antes.
3. **Breakers.** `generateEmbedding` no llama a OpenAI si (a) el breaker compartido del router `llm:health:openai:open` está abierto (cuenta sin crédito o clave inválida, ADR-0026), o (b) el breaker propio del proceso está abierto. El breaker propio se abre 60 s tras cualquier caída, incluidos 429 de velocidad y 5xx. Una ráfaga de búsquedas durante una caída paga un solo intento fallido. Un «sin créditos» ya no se reintenta dentro del bucle con `sourceAuthority`.
4. **Registro de uso.** Una búsqueda servida sin vector no factura tokens. Por eso no toca `ai:stats:{tenant}:{día}:embeddings:calls|tokens|cost_centi_usd`. Solo suma 1 a `ai:stats:{tenant}:{día}:embeddings:lexical_fallback` (TTL de 90 días), salvo en contextos sin persistencia (Agent Test, réplicas de evaluación). Cada caída deja un `warn` `[KB] EMBEDDING_UNAVAILABLE openai {tipo}`, y cada búsqueda degradada, un `[KB] LEXICAL_FALLBACK`.
5. **Qué no cambia.**
   - La ingesta de documentos y `learning` (que guardan vectores) siguen necesitando OpenAI y fallan con un error claro. Guardar un fragmento sin vector lo dejaría fuera de la búsqueda híbrida para siempre.
   - La memoria de clientes ya caía a «hechos más recientes» cuando el embedding fallaba. Ahora llega a ese respaldo sin esperar los reintentos.

## Consecuencias

- Con OpenAI caído o sin crédito, el agente y el panel siguen recibiendo conocimiento relevante cuando la pregunta comparte palabras con el documento. Se pierde la recuperación por sinónimos o paráfrasis, la que solo da el vector.
- Una medición hecha durante una caída **no es comparable** con una normal: cambia la recuperación. Los resultados lo dicen (`retrievalMode`), el log lo marca y el contador por tenant y día permite descartar esos días. Antes la medición no medía nada, porque daba error.
- La cobertura como puntaje es una aproximación. Palabras interrogativas que no son stopwords («cuánto», «aceptan») bajan la cobertura. Con la pregunta «¿Cuánto cuesta una limpieza dental y aceptan seguros?», el mejor fragmento del tenant dental QA cubre 2 de 6 lexemas (0,33; 0,43 con el boost de idioma). No hace falta afinarlo mientras el modo degradado sea la excepción.
- Las analíticas de recuperación (`trackRetrieval`, umbral 0,35) mezclan puntajes de cobertura en los días con caída.

## Alternativas descartadas

- **Proveedor secundario con la misma dimensión (Gemini a 1536).** La dimensión coincide, pero el espacio vectorial no: un vector de consulta de Gemini comparado con vectores guardados de OpenAI da similitudes sin sentido, peores que la búsqueda léxica. Para que sirviera habría que guardar una segunda columna (`embedding_alt vector(1536)`) en `knowledge_embeddings`, en las réplicas de evaluación y en la memoria, y re-embeber todo el corpus de todos los tenants con Gemini. Además habría que mantener ambas columnas al ingerir, lo que pagaría dos embeddings por fragmento. Es el siguiente paso si las caídas de OpenAI se repiten o si un día hace falta paráfrasis durante una caída. La búsqueda léxica no lo bloquea.
- **Re-embeber todo con otro proveedor y cambiar de modelo.** Cambia la calidad de recuperación medida en todas las verticales y obliga a volver a medir. Se haría por calidad o costo, no por disponibilidad.
- **Guardar fragmentos sin vector durante la caída.** Quedarían invisibles para el pool vectorial sin un proceso de re-embebido. Fallar la ingesta con un error claro es más honesto.
- **Solo el breaker compartido del router.** Se abre solo por crédito o clave. Un 429 de velocidad o un 5xx seguirían costando un intento por búsqueda.
