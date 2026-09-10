# Calidad de recuperación: qué se mide, con qué, y contra qué umbral

Un número sin la medición detrás es un umbral inventado. Este documento tiene
las mediciones, las condiciones exactas que las produjeron, y los umbrales que
se derivan de ellas — con el motivo de cada uno y quién lo vigila.

## Lo que esto mide, y lo que NO

Hasta ahora, todo lo que el repositorio sabía de su propio RAG era
observacional: `kb_retrieval_log` anota que un chunk pasó un umbral y
`knowledge-attribution.ts` anota si la respuesta *parecía* usarlo. Los dos se
niegan a afirmar corrección, y hacen bien — un puntaje no es una respuesta
relevante y un solapamiento literal no es entailment. Lo que faltaba era la
pregunta que importa: **cuando un cliente pregunta algo, ¿vuelve el pasaje
correcto, y se queda afuera el incorrecto?**

Eso no se puede medir sin escribir de antemano cuál es el pasaje correcto. El
dataset etiquetado (`modules/knowledge/evaluation/retrieval-dataset.ts`) es
justamente eso, estratificado por lo que de verdad se rompe: ambigüedad,
negación, conflicto entre fuentes, temporalidad, documento retirado y preguntas
que el corpus honestamente no contesta, en es/en/pt/fr.

**La única sustitución es el embedding, y está impresa en cada línea de cada
reporte.** `deterministic_lexical` es un vector de feature-hashing sobre
unigramas y bigramas: reproducible para siempre, gratis, y **no es**
`text-embedding-3-small`.

Con ese vector la corrida sí ejercita, de verdad: el SQL híbrido, la fusión RRF,
el umbral de similitud, las compuertas de jurisdicción/audiencia/agente/idioma,
la exclusión de documentos retirados, la abstención, la fuga y toda la latencia
bajo concurrencia. Son propiedades del **pipeline** y no dependen de qué modelo
produjo el vector.

Lo que **no** puede medir es el recall semántico — si el modelo real encuentra
un pasaje que no comparte ninguna palabra con la pregunta. Eso es una propiedad
del **modelo**, necesita el modelo real, y está en el gate de LLM. Ningún número
de este documento autoriza a declarar calidad generativa aceptada.

## Reproducir

```bash
export KNOWLEDGE_MEMORY_TEST_DATABASE_URL='postgresql://postgres:<clave-local>@127.0.0.1:55439/parallly_knowledge_eval_isolation'
export NODE_OPTIONS=--max-old-space-size=6144
cd apps/api && node ../../node_modules/jest/bin/jest.js --config jest.config.js --maxWorkers=2 \
  --runTestsByPath \
  src/modules/knowledge/evaluation/retrieval-quality.postgres.spec.ts \
  src/modules/knowledge/evaluation/retrieval-threshold.postgres.spec.ts \
  src/modules/knowledge/evaluation/retrieval-load.postgres.spec.ts
```

| Suite | Qué rompe | Qué publica |
|---|---|---|
| `retrieval-quality.postgres.spec.ts` | recuperación contra respuestas escritas, corpus de 14 y 214 documentos, retiro en vuelo, índice degradado | recall@5, MRR, respuesta, abstención, fugas, latencia por idioma y por desafío |
| `retrieval-threshold.postgres.spec.ts` | qué puede saltarse el umbral | fija la intención del BM25 en las dos direcciones |
| `retrieval-load.postgres.spec.ts` | 2 tenants, 8 buscadores concurrentes, retiro en vuelo, mitad del índice caída | p50/p95/p99 y aislamiento |

## Condiciones de la medición

- PostgreSQL 17.11 con pgvector 0.8.6, instancia local desechable en 55439.
- Embedding `deterministic_lexical` (1536 dims). **Cero llamadas a un modelo.**
- Corpus etiquetado: 14 documentos / 16 chunks. Crecido: +200 distractores
  generados que comparten vocabulario con el corpus y no contestan ningún caso.
- 17 casos, 4 idiomas, 7 desafíos. `k=5`, `topK=10`.
- Revisión del dataset impresa en cada reporte (`cd681dcb09b6` para el corpus
  chico; el corpus crecido tiene otra, porque el hash cubre corpus **y** casos).

## Lo medido

### Línea base — 14 documentos, umbral 0.15

| split | casos | recall@5 | MRR | respuesta | abstención | fugas | errores | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 17 | 0.833 | 0.722 | 0.833 | 0.200 | 0 | 0 | 3 | 15 | 15 |
| lang:en | 5 | 1.000 | 1.000 | 1.000 | 1.000 | 0 | 0 | 4 | 7 | 7 |
| lang:es | 7 | 0.750 | 0.583 | 0.750 | 0.000 | 0 | 0 | 3 | 15 | 15 |
| lang:fr | 3 | 1.000 | 0.667 | 1.000 | 0.000 | 0 | 0 | 4 | 4 | 4 |
| lang:pt | 2 | 0.500 | 0.500 | 0.500 | — | 0 | 0 | 3 | 3 | 3 |
| chal:plain | 6 | 1.000 | 0.889 | 1.000 | — | 0 | 0 | 3 | 15 | 15 |
| chal:negation | 3 | 0.333 | 0.333 | 0.333 | — | 0 | 0 | 3 | 4 | 4 |
| chal:ambiguity | 1 | 1.000 | 1.000 | 1.000 | — | 0 | 0 | 3 | 3 | 3 |
| chal:conflict | 1 | 1.000 | 1.000 | 1.000 | — | 0 | 0 | 7 | 7 | 7 |
| chal:temporality | 1 | 1.000 | 0.333 | 1.000 | — | 0 | 0 | 5 | 5 | 5 |
| chal:retired | 3 | — | — | — | 0.333 | 0 | 0 | 3 | 4 | 4 |
| chal:no_answer | 2 | — | — | — | 0.000 | 0 | 0 | 4 | 4 | 4 |

`—` es «no aplica», no cero: recall sobre un conjunto de verdad vacío no es cero,
es indefinido, y la abstención sólo se juzga donde el caso pide silencio.

**La negación es la celda floja (0.333)**, y era de esperarse con un embedding
léxico: «¿puedo llevar mi perro a la habitación?» y «no se aceptan mascotas»
comparten poquísimas palabras. Es exactamente la celda que hay que volver a
medir con el modelo real, porque es donde un embedding semántico debería ganar
más.

### Mismo dataset, 214 documentos

| split | casos | recall@5 | MRR | respuesta | abstención | fugas | errores |
|---|---:|---:|---:|---:|---:|---:|---:|
| overall | 17 | 0.458 | 0.382 | 0.417 | 0.000 | 0 | 0 |

**Recall cae de 0.833 a 0.458 agregando 200 distractores.** Ese es el resultado
más importante del documento y el motivo por el que el tamaño del corpus es una
condición publicada y no un detalle: un número tomado sobre catorce documentos
no dice casi nada de un tenant con cuatro mil. Cero fugas en las dos.

### Barrido de umbral (14 documentos)

| umbral | recall@5 | abstención | respuesta | fugas |
|---:|---:|---:|---:|---:|
| 0.05 | 0.833 | 0.000 | 0.833 | 0 |
| 0.15 | 0.833 | 0.200 | 0.833 | 0 |
| 0.25 | 0.417 | 0.800 | 0.417 | 0 |
| 0.35 | 0.167 | 0.800 | 0.167 | 0 |
| 0.45 | 0.083 | 1.000 | 0.083 | 0 |
| 0.55 | 0.000 | 1.000 | 0.000 | 0 |

Una curva de compromiso. **La forma es una propiedad del pipeline; dónde cae la
rodilla depende del embedding**, así que estos valores absolutos NO autorizan a
mover el 0.35 que usa el camino de conversación. Esa medición necesita el modelo
real y está pendiente en el gate de LLM.

### Carga concurrente

2 tenants, 8 buscadores en paralelo, 6 rondas, 300 distractores por tenant:

| serie | n | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| `search` | 48 | 10 ms | 30 ms | 30 ms | 30 ms |
| `search_saturated` | 16 | 59 ms | 360 ms | 360 ms | 360 ms |
| `search_during_withdrawal` | 8 | 6 ms | 10 ms | 10 ms | 10 ms |
| `search_degraded` (sin BM25) | 1 | 285 ms | — | — | 285 ms |

Percentil por rango más cercano, sin interpolación: un p99 impreso es siempre
una latencia que la corrida vio de verdad. Con n=48 el p95 y el p99 coinciden —
eso no es un error, es lo que significa no interpolar con pocas muestras.

## Comparación contra la línea base anterior al cambio

La evaluación encontró un defecto y este es el antes/contra-después, sobre las
mismas etiquetas, el mismo corpus y el mismo embedding:

| umbral | recall antes | abstención antes | recall después | abstención después |
|---:|---:|---:|---:|---:|
| 0.15 | 0.833 | 0.200 | 0.833 | 0.200 |
| 0.25 | 0.583 | 0.600 | 0.417 | 0.800 |
| 0.35 | 0.583 | 0.600 | 0.167 | 0.800 |
| 0.45 | 0.583 | 0.600 | 0.083 | 1.000 |
| 0.65 | 0.583 | 0.600 | 0.000 | 1.000 |

Antes, la abstención subía a 0.6 y se quedaba **plana**. Un umbral que no cambia
nada por encima de un punto no es un umbral. La causa: `keywordHit` — una señal
de puntaje graduada, que se enciende con **una** palabra de más de tres letras
compartida como substring — se estaba usando como permiso de admisión, así que
un chunk entraba con cualquier corte. El arreglo admite sólo por coincidencia
BM25 real (`plainto_tsquery` conjuga TODOS los lexemas de la pregunta), que es
exactamente el recall de término exacto que la excepción existía para proteger.
Cero fugas antes y después: las compuertas nunca fueron función del corte.

## Umbrales publicados

Cada uno con su base y quién lo vigila. Los que son **assertion** fallan la
corrida; los que son **evidencia** se publican y se comparan a mano.

| # | Objetivo | Base | Tipo | Quién |
|---|---|---|---|---|
| 1 | **Cero fugas** en cualquier umbral y cualquier tamaño de corpus | Medido: 0 en 7 umbrales × 2 tamaños. Una fuga es una promesa retirada, un margen interno o una norma extranjera llegando al cliente; no tiene tasa aceptable | assertion | `retrieval-quality.postgres.spec.ts` |
| 2 | **Cero errores** en la corrida etiquetada | Medido: 0. Un error no es un cero de calidad; si aparece, es defecto del SQL o del arnés | assertion | idem |
| 3 | **Existe un punto de trabajo**: algún corte donde la abstención es 1.0 y el recall > 0 | Medido: 0.45 con este embedding. Un sistema sin ese punto no está mal calibrado, está roto | assertion | idem |
| 4 | **El corte es monótono**: un umbral más estricto nunca devuelve más | Razonado y medido; es lo que hace que `similarityThreshold` signifique algo | assertion | `retrieval-threshold.postgres.spec.ts` |
| 5 | **Aislamiento entre tenants**: cero pasajes ajenos bajo concurrencia | Medido: 0 en 48 búsquedas concurrentes sobre 2 tenants | assertion | `retrieval-load.postgres.spec.ts` |
| 6 | **Nunca vacío por carga**: bajo saturación se contesta o se falla contado, jamás vacío en silencio | Medido: 0 vacías / 0 fallidas en 16 búsquedas saturadas. Un vacío se lee como abstención aguas abajo y el cliente no puede distinguirlo de «no tenemos nada» | assertion | idem |
| 7 | **Retiro efectivo en vuelo**: un documento retirado deja de ser recuperable sin reinicio ni caché que invalidar | Medido | assertion | idem |
| 8 | recall@5 ≥ 0.80 con 14 documentos, umbral 0.15 | Medido: 0.833 | evidencia | revisión humana del reporte |
| 9 | p95 de búsqueda ≤ 100 ms sin saturación | Medido: 30 ms con 8 concurrentes | evidencia | idem |

Los del 1 al 7 son invariantes: fallan la corrida porque su violación es un
defecto, no un número peor. El 8 y el 9 se publican en vez de asertarse, porque
un umbral de recall clavado con un embedding sustituto sería un número que nadie
justificó, y uno lo bastante bajo para pasar siempre no protege nada.

## Lo que este arnés NO cubre

- **Recall semántico.** Necesita el modelo real. Es lo más grande que falta.
- **Groundedness / entailment.** Lo que se mide es soporte **léxico**:
  ¿el texto que el caso declara como respaldo está en lo que volvió? Útil y
  real, pero no es entailment, y `semanticEntailment` queda en `not_evaluated`
  hasta que corra un juez. Es la misma línea que ya traza
  `knowledge-attribution.ts`.
- **El reranker LLM.** Existe (`rerankChunks`), está apagado en estas corridas y
  medirlo cuesta llamadas.
- **Corpus reales de tenants.** El corpus etiquetado es sintético a propósito:
  las etiquetas tienen que ser públicas y revisables, y un corpus de un cliente
  no lo es.
- **Escalas de decenas de miles de documentos.** Se midió a 14 y a 214, y la
  caída entre esos dos ya es el argumento de que hay que medir a la escala real
  antes de prometer nada.
