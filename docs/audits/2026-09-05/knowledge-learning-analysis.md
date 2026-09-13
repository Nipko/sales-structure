# Conocimiento, memoria y aprendizaje selectivo del agente

Fecha: 5 de septiembre de 2026, America/Bogota. Complemento técnico del análisis de operación y del plan de configuración. Alcance: revisión de código local y reproducciones con dependencias sintéticas; no se evaluaron conversaciones, modelos ni tenants de producción. No se modificó producto.

## Conclusión

La plataforma cuenta con una base aprovechable de recuperación híbrida, fuentes estructuradas, memoria del cliente y evaluación. Todavía no cuenta con aprendizaje curado de la forma de responder a partir de chats. Importar esos chats como documentos normales de conocimiento mezclaría hechos privados, precios históricos, afirmaciones del agente y estilo. Esa ruta no debe convertirse en la implementación de «aprender de los mejores».

El objetivo debe ser un agente que usa hechos vigentes, procedimientos autorizados y una voz consistente, y cuya mejora se publica únicamente después de compararla contra evidencia independiente. La memoria del cliente, el conocimiento del negocio, el estilo y los casos de evaluación son productos de datos diferentes.

## Qué existe y conviene conservar

- `KnowledgeService.ingestDocument` procesa texto, PDF/DOCX y URLs, aplica límites y publica chunks solo cuando el documento está `ready` (`apps/api/src/modules/knowledge/knowledge.service.ts:76`, `:136`).
- La recuperación combina vector y búsqueda PostgreSQL `tsvector` mediante RRF, ofrece reescritura de preguntas de seguimiento, boost por idioma y reranker opcional. Se trata de `ts_rank`/búsqueda textual, aunque algunos comentarios lo llamen BM25; no hay que atribuirle un ranker BM25 que ese SQL no implementa (`knowledge.service.ts:718`, `:737`, `:742`, `:826`; `conversations.service.ts:2939`).
- Las políticas tienen versiones y una versión activa por tipo. Existen herramientas separadas para FAQs, políticas y documentos (`apps/api/src/modules/policies/policies.service.ts:74`; `apps/api/src/modules/conversations/tools/knowledge-tools.ts:14`, `:27`, `:43`).
- Hay historial de versiones de documentos, recrawl semanal, preguntas sin respuesta, feedback, detección de documentos poco útiles/desactualizados y detección de contradicciones entre documentos (`knowledge.service.ts:313`, `:872`, `:1625`; `knowledge-recrawl.service.ts:20`; `kb-health/kb-health.service.ts:61`).
- La persona guiada conserva identidad, tono, formalidad, emojis, humor y reglas. El modo libre conserva invariantes de prohibiciones, handoff, horarios y skillset. El contrato identifica conocimiento/herramientas como datos no confiables y el renderizado XML los escapa (`persona/persona.service.ts:173`, `:201`, `:214`; `conversations/prompt-assembler.service.ts:88`, `:450`).
- La memoria larga es optativa por agente, usa hechos y resumen por contacto, hechos semánticos por identidad unificada y fallback sin embeddings (`conversations.service.ts:2026`, `:3478`; `customer-memory.service.ts:76`, `:94`, `:155`). Es personalización del cliente; no aprende tono ni procedimientos del negocio.
- La simulación puede reconstruir scripts desde conversaciones históricas. Extrae los primeros turnos inbound de conversaciones recientes; no selecciona éxitos ni usa las respuestas humanas como ejemplos de estilo (`simulation/simulation.service.ts:324`).

## Hallazgos y cambios necesarios

### K1. Las dos entradas al conocimiento aplican distintas exigencias de relevancia

El RAG automático aplica el umbral del agente, idioma y reranker, y separa información recuperada y posible (`conversations.service.ts:2934–2996`). La herramienta `search_knowledge_base` invoca `searchRelevant` únicamente con contexto de ejecución y jurisdicción; el valor por defecto de umbral es 0 y tampoco transmite idioma, conversación, ni reranker (`ai-tool-executor.service.ts:2499–2529`; `knowledge.service.ts:683`).

Reproducción: un chunk con score 0,08 aparece en la herramienta como `status: ok`; en la clasificación automática con umbral predeterminado no entra en recuperados ni posibles. Esto demuestra una diferencia de selección, no que un modelo necesariamente lo vaya a usar mal.

Cambio: un contrato `RetrievalContext` compartido por pipeline, herramienta y pruebas: tenant, agente/perfil, idioma, país, fuente permitida, propósito, umbral/abstención, presupuesto, versión de conocimiento y atribución al turno. Limitar `topK` también en la herramienta. Distinguir «consulta ejecutada», «evidencia suficiente», «evidencia insuficiente» y «error». Una consulta ejecutada correctamente no acredita la pertinencia de sus resultados.

### K2. La autoridad regulatoria se pierde y su configuración no está conectada al flujo habitual

El SQL selecciona autoridad, país y vigencia (`knowledge.service.ts:713–716`), pero el mapeo final los descarta (`:781–792`). El pipeline intenta leer precisamente esos campos (`conversations.service.ts:2980–2984`) y el renderer sabe mostrarlos (`prompt-assembler.service.ts:458–462`), de modo que la conexión está rota. La reproducción conserva cero de cinco campos.

Además, `is_regulated` tiene default falso (`apps/api/prisma/tenant-schema.sql:370`) y los contratos normales de subida y actualización/metadatos no permiten fijarlo junto a jurisdicción, autoridad y vigencia (`knowledge.controller.ts:33`, `:60`, `:89`; `knowledge.service.ts:1043`). El gate solo protege documentos correctamente clasificados; no demuestra que los documentos cargados por autoservicio hayan sido clasificados. No se inspeccionaron cargas o backfills de producción.

Cambio: fuente tipada y revisión de alcance al importar, con editor accesible desde Assist; identidad de fuente/version/chunk propagada hasta la evidencia de respuesta. Para preguntas que requieren autoridad específica, no afirmar vigencia cuando esta sea desconocida. No exigir metadatos regulatorios a un simple FAQ operativo.

### K3. La salud detectada todavía no controla la autoridad de los datos que recibe el agente

El scan de contradicciones se limita a los 300 chunks más recientes, 40 parejas candidatas y hasta 12 parejas juzgadas; compara documentos distintos, no cubre contradicciones internas ni con catálogo/FAQs/políticas (`kb-health.service.ts:21–25`, `:66–119`). Registrar o resolver un issue cambia el registro de salud (`:138`, `:226`); no modifica qué fuente puede usar el retrieval. El SQL de búsqueda no consulta esos issues (`knowledge.service.ts:718–739`). Si falla el juez, su fallback equivale a no detectar contradicción (`kb-health.service.ts:156`, `:188`).

Esto es diagnóstico parcial, no reparación automática ni garantía de consistencia. El recrawl publica inmediatamente el contenido nuevo si puede reindexarlo; no pasa por una comparación de respuestas o un control de conflicto (`knowledge.service.ts:266`).

Cambio: precedencia por tipo de hecho. Precio, stock, disponibilidad, estados de pedido y pagos se consultan en el sistema que los administra; las políticas activas prevalecen sobre documentos explicativos y chats históricos; las FAQs aprobadas contestan las preguntas canónicas. Cada afirmación crítica debe asociarse a la fuente/version/fecha pertinente. Un conflicto abierto sobre el mismo hecho produce aclaración o escalamiento, no una mezcla de ambas fuentes. El resultado del scan debe ser `complete/partial/failed` con cobertura visible.

### K4. Tres categorías de falencias del conocimiento quedan ocultas en la UI

`getGapReport` devuelve `lowSatisfactionDocs`, `staleDocuments` y `falsePositiveCounts` (`knowledge.service.ts:1722–1725`). La UI lee `lowSatisfaction`, `staleDocs` y `falsePositiveCount` (`apps/dashboard/src/app/admin/knowledge/page.tsx:1157–1159`, `:1198`, `:1243`). El desempaquetado de `res.data` no corrige nombres (`:444`).

Reproducción de contrato: el servicio devuelve un documento insatisfactorio, uno antiguo y dos falsos positivos; las expresiones vigentes de la UI producen cero para las tres categorías. Se verificó el contrato, no una sesión de navegador.

Cambio: DTO compartido, conteos inequívocos y acción correctiva que conecte fuente, evidencia, agente afectado y verificación posterior. No llamar «resuelto» a un issue solo porque se cerró su registro.

### K5. Actualizar un documento puede retirar la última fuente válida antes de tener su reemplazo

La actualización guarda el texto anterior, marca el documento `processing`, borra los embeddings vigentes e intenta generar los nuevos. Si falla, marca `error`, sin restaurar la versión activa (`knowledge.service.ts:313–359`). El retrieval solo lee documentos `ready`. Reproducción confirmada con fallo de embeddings sintético.

Cambio: versiones inmutables de chunks y publicación atómica de un puntero a la versión activa. La nueva versión se prepara y verifica en segundo plano; un fallo deja vigente la anterior y genera una falencia visible. Asegurar rollback y revocación de las referencias derivadas. La antigüedad del documento y el instante de la consulta deben ser campos distintos.

### K6. La memoria del cliente no tiene todavía semántica suficiente de corrección y borrado

El extractor recibe mensajes inbound y outbound, sin evidencia de operación ni atribución detallada del origen del hecho, y devuelve strings (`customer-memory.service.ts:158–195`). Pedir al LLM no guardar datos sensibles innecesarios (`:175`) no es clasificación, minimización o validación determinista del resultado. Una afirmación errónea del agente podría convertirse en memoria; riesgo identificado por el flujo, no demostrado mediante un modelo real.

La vista fusionada reemplaza hechos, pero la capa semántica hace upserts y solo poda a los 12 más recientes (`:198–206`, `:215–264`). No revoca explícitamente los que el extractor retiró. Reproducción pública de extracción y recuperación, en el fallback soportado sin embeddings: la nueva vista contiene solo la preferencia corregida, mientras la recuperación semántica vuelve a ofrecer ambas preferencias. Con embeddings hay deduplicación por cercanía, pero esa cercanía tampoco constituye una regla de contradicción o supersesión.

La operación existente para borrar los datos del contacto no incluye `customer_memories` ni `customer_memory_facts` (`compliance/compliance.service.ts:182–299`). Las tablas de memoria no tienen FK con cascade (`customer-memory.service.ts:46–63`). La reproducción contabiliza diez comandos de borrado/anonimización, cero sobre memoria. Es un hallazgo de cobertura de borrado; no es una evaluación jurídica.

Cambio: hechos tipados con sujeto/atributo/valor, fuente y fragmento de origen, fecha de observación, clase de sensibilidad, estado `candidate/active/superseded/revoked`, confianza basada en evidencia, TTL cuando corresponda y motivo de actualización. Separar lo dicho por el cliente de lo confirmado por una herramienta. Resolver contradicciones, permitir revisar/corregir/olvidar y propagar eliminación hacia embeddings, ejemplos, evaluaciones, resúmenes y cachés con trazabilidad.

### K7. «Fue recuperado» no prueba «fundamentó correctamente la respuesta»

`was_used` se calcula a partir del score antes de generar la respuesta (`knowledge.service.ts:872–910`). La mejora reciente de ese umbral ayuda a detectar vacíos, pero no observa qué afirmaciones utilizó finalmente el modelo ni si estaban sustentadas. El feedback calcula promedios por documento; no publica ajustes de comportamiento ni selecciona ejemplos de calidad (`:1625–1659`).

Cambio: separar métricas de recuperación, evidencia disponible, afirmaciones sustentadas, uso indebido de fuente y resultado final. Conservar la atribución de conversación/turno/agente/versión. El aprendizaje necesita corregir las causas, no subir un score de similitud.

### K8. Compartir conocimiento de tenant es una decisión válida; hace falta poder declarar su alcance

La búsqueda se ejecuta en el schema del tenant y la caché de embeddings de consultas incluye tenant (`knowledge.service.ts:681`, `:1404`). No se encontró una fuga entre tenants en esta revisión. Actualmente el conjunto de documentos está compartido por todos los agentes habilitados para conocimiento; no existe selector por agente, objetivo, producto o rol en `searchRelevant` (`:653–679`).

Compartirlo puede ser exactamente lo deseado. Para negocios con varias marcas, áreas o responsabilidades, conviene añadir colecciones compartidas y asignaciones opcionales por agente/perfil. Un alcance debe ser una autorización del backend, no una petición libre del modelo. Diferenciar también visibilidad pública del portal, visibilidad interna del personal y contenido que el agente puede comunicar a clientes.

## Diseño del aprendizaje desde chats

### Cinco almacenes separados

| Producto de datos | Qué contiene | Qué nunca debe autorizar por sí mismo |
|---|---|---|
| Conocimiento del negocio | Hechos aprobados, fuentes, ámbito, vigencia | Precios/stock/estados actuales tomados de una charla antigua |
| Guía de voz | Tono, longitud, trato regional, empatía, estructura, expresiones preferidas | Promesas, permisos, políticas ni hechos nuevos |
| Ejemplos conversacionales | Fragmentos curados con situación, respuesta preferida y motivo | Una acción real, una identidad de cliente o un resultado de herramienta |
| Memoria del cliente | Preferencias/contexto autorizado para ese cliente | Generalizar sus condiciones privadas a otros clientes |
| Evaluaciones | Casos completos, resultados esperados y fallos conocidos | Entrar en el contexto de los casos reservados para medir progreso |

Los procedimientos operativos permanecen en contratos/herramientas/workflows del backend. Si un chat revela una buena secuencia de trabajo, se propone convertirla en un procedimiento declarado y probado; no se copia un «ya reservé» como si fuese una ejecución real.

### Flujo ejecutable

1. **Importar y delimitar.** Conector o archivo de chat con tenant, propietario, fuente, formato, idioma, zona horaria, canal, negocio/subtipo y roles originales. Parsear turnos, archivos y timestamps; conservar hash y límites de tamaño; detectar duplicados. El material nuevo entra a cuarentena y nunca se incorpora directamente a conocimiento/voz activos.
2. **Minimizar.** Detectar y remover datos de otros clientes, credenciales, documentos, teléfonos/correos/direcciones no necesarios y referencias de pago. Sustituir valores con placeholders consistentes. Registrar el linaje suficiente para retirar todo lo derivado después. Procesar únicamente material autorizado para ese propósito; clasificación y acceso se aplican en backend.
3. **Reconstruir el episodio.** Conservar la necesidad, contexto inicial, preguntas, objeciones, decisiones, herramientas, fallos, handoff y desenlace. Un mensaje amable fuera de contexto no es un ejemplo de competencia. Distinguir respuesta humana, bot y herramienta cuando la fuente lo permita; marcar desconocido si no.
4. **Calificar con varias señales.** Resultado verificado en el backend o etiqueta humana explícita, exactitud de los hechos, cumplimiento de instrucciones, pertinencia de herramientas, reparación de errores, eficiencia, claridad, empatía y ausencia de promesas indebidas. CSAT, venta o cierre de conversación son señales auxiliares: una venta obtenida inventando un descuento no es un modelo válido. Si no hay evidencia de resultado, conservar como candidato de estilo o caso de evaluación, sin certificarlo como éxito operativo.
5. **Seleccionar por fragmento y diversidad.** Admitir lo mejor de un episodio aunque el resto sea imperfecto; rechazar errores concretos. Seleccionar por intención, etapa, dificultad, canal, idioma, subtipo y situaciones infrecuentes, no por repetición o popularidad. Agrupar duplicados para que cien saludos similares no desplacen buenas resoluciones de objeciones. Guardar pares preferido/rechazado y una explicación cuando ayuden.
6. **Proponer cambios separados.** Generar una guía de voz compacta y ejemplos desidentificados; extraer candidatos a FAQ/hechos que necesiten contrastarse con fuente autorizada; proponer cambios de workflow por otra vía. Assist muestra qué se aprendería, de qué fragmentos y por qué, con aceptación/rechazo/edición por el responsable. Aplicar la autorización ya concedida por el usuario cuando corresponda; no introducir confirmaciones repetidas por cada microcambio.
7. **Versionar y probar.** Crear un paquete candidato con config de misión, voz, ejemplos, KB, catálogo de herramientas y modelos/proveedores identificados. Reservar conversaciones completas para evaluación independiente antes de extraer ejemplos; separar por conversación/origen para evitar que una paráfrasis del mismo caso caiga en ambos conjuntos. Comparar baseline y candidato con los mismos escenarios y errores controlados, resultados verificables y revisión humana de tono.
8. **Publicar y observar.** Publicación gradual por agente/perfil, rollback a paquete anterior, medición de resultados/costo/latencia y regresiones por intención/idioma/canal. Cambios de modelo, política, herramienta o fuente vuelven a disparar las pruebas pertinentes. Fallos de producción crean candidatos a regresión; no reentrenan automáticamente al agente ni se convierten en buenos ejemplos.

### Contratos mínimos sugeridos

- `LearningSource`: tenant, alcance autorizado, origen, hash, estado, retención, referencias a conversaciones y permiso de uso registrado.
- `LearningEpisode`: actor/rol por turno, contexto relevante, resultado y su evidencia, canal/idioma, etiquetas de negocio y misión, clasificación de datos, trazas de herramientas disponibles.
- `LearningCandidate`: tipo `style/example/knowledge/procedure/eval`, fragmentos de origen, transformación/redacción, dimensiones de calidad, exclusiones, explicación, revisión y estado.
- `AgentBehaviorVersion`: guía de voz, ejemplos aprobados y su alcance, versión base de persona, reglas invariantes, huellas de dependencias y conjunto de evaluaciones utilizado.
- `LearningEvaluation`: comparación contra baseline, casos reservados, resultados operativos, groundedness, tono, seguridad, herramientas, tokens/costo/latencia y fallos de infraestructura separados de fallos del agente.

El pipeline incorpora la guía compacta de voz al bloque estable de persona. Cuando hagan falta ejemplos, recupera pocos, con presupuesto, filtrados por situación/idioma/canal/alcance, en un bloque explícito de ejemplos de estilo. No los agrega como mensajes de herramienta ni como operaciones realizadas. Hechos variables se resuelven desde fuentes actuales; incluso un ejemplo muy bueno debe perder autoridad frente a estas.

No hace falta empezar por fine-tuning: la primera implementación debe poder demostrar el beneficio de guía+ejemplos curados y corregirlo/revertirlo por tenant. Cualquier ajuste de pesos sería una etapa posterior con datos suficientes y ventaja medible frente a esa base.

## Criterios de aceptación que deben añadirse al plan principal

1. Pregunta idéntica produce la misma política de fuentes y abstención por RAG automático, herramienta y evaluación; se conservan documento/version/chunk/autoridad/vigencia hasta la traza.
2. Un documento marcado para otro país o vencido queda fuera cuando corresponde; un documento no clasificado no se presenta como autoridad regulatoria verificada.
3. Un precio o política históricos en un chat nunca reemplazan catálogo/política vigentes. Una frase «pedido confirmado» importada nunca satisface una aserción de pedido real.
4. Se detecta el conflicto entre fuentes y se muestra en Salud y Assist con fuente afectada y acción; un fallo del scan muestra cobertura desconocida/parcial.
5. Fallar al reindexar deja activa la última versión aprobada. El rollback restablece recuperación y dependencias coherentes.
6. Corregir una preferencia retira el hecho anterior de todas las vistas; borrar/olvidar un contacto invalida memoria y derivados correspondientes.
7. Ningún chat importado cambia producción por el solo hecho de importarse. Un candidato muestra exactamente la voz/ejemplos/hechos/procedimiento propuestos y su origen.
8. Una conversación con buena empatía y mala ejecución puede aportar un fragmento de estilo desidentificado, pero no se clasifica como éxito operativo.
9. Los casos reservados no aparecen entre ejemplos recuperables ni textos derivados de entrenamiento. La división se hace por conversación/origen, no por mensajes individuales.
10. Comparación end-to-end incluye ejecución positiva, cancelación/negación, datos incompletos, cliente que cambia de idea, múltiples intenciones, fallos y resultados inciertos, duplicados, cambio de idioma, conflicto de fuentes, objeción y handoff con continuidad.
11. No regresión de invariantes críticos; mejora de tono comprobada mediante comparación ciega humana o rubricada y calibrada, sin degradar resolución, exactitud, uso de herramientas, costo ni latencia por encima del presupuesto acordado.
12. Conocimiento compartido por tenant sigue funcionando; asignaciones específicas solo restringen cuando están configuradas. No compartir chats o derivados entre tenants por defecto.

## Evidencia reproducible

- `reproduce-knowledge-learning.cjs` ejecuta métodos reales con dependencias sintéticas y escribe `knowledge-learning-output.json`. Comando: `node docs/audits/2026-09-05/reproduce-knowledge-learning.cjs`.
- Seis reproducciones: metadatos eliminados; umbral distinto en herramienta; contrato de gaps; memoria obsoleta que reaparece; cobertura de borrado que omite memoria; pérdida de disponibilidad de fuente al fallar reemplazo.
- Suites ejecutadas: `rag-jurisdiction.spec.ts`, `knowledge.retrieval-attribution.spec.ts`, `prompt-invariants.spec.ts`, `persona-prompt-escaping.spec.ts`: 4 suites, 33 pruebas, todas pasaron. Esto protege parte de las bases existentes; no valida el aprendizaje futuro. El test vigente de metadatos regulatorios verifica el texto del SELECT, no los campos devueltos, por lo que pasa a pesar de K2.
