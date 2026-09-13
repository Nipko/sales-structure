# Revisión de conflictos entre fuentes — D1

La base de conocimiento conserva diferencias potenciales junto con citas exactas, referencias y versiones de las dos fuentes. Una coincidencia literal confirma la procedencia de la cita; no demuestra que la interpretación del juez sea correcta ni decide cuál fuente dice la verdad.

## Flujo disponible

En **Conocimiento → Vacíos → Conflictos entre fuentes**, un administrador, supervisor o superadministrador puede analizar la muestra, comparar las citas, abrir las áreas de edición y registrar una decisión. Debe elegir la decisión, revisar su alcance y escribir qué verificó. No se selecciona una preferencia por defecto.

Las decisiones son preferir A, preferir B, distinguir situaciones diferentes o mantener la verificación pendiente. Se registran actor autenticado, motivo, audiencia, agente, país, hashes de contenido/metadatos y revisión. La pantalla vuelve a consultar el servidor después de cada solicitud, incluso si se perdió la respuesta. Una aprobación local u optimista no reemplaza esa consulta.

Los endpoints protegidos son `GET /kb-health/:tenantId/conflicts`, `POST /kb-health/:tenantId/conflicts/scan` y `POST /kb-health/:tenantId/conflicts/:caseId/review`. El último exige revisión esperada, los dos hashes, decisión, motivo y alcance; el actor se obtiene del JWT. El antiguo cambio de estado sin evidencia rechaza la operación. Los registros antiguos de `kb_health_issues` permanecen conservados, pero no se convierten en evidencia versionada ni habilitan preferencias; requieren un nuevo análisis.

## Integridad y uso por el agente

La publicación de observaciones y las revisiones bloquean primero las fuentes y luego el caso. Dos decisiones sobre la misma revisión no pueden sobrescribirse. Un cambio de contenido, autoridad, vigencia, audiencia, agentes o versión invalida la revisión previa. Cambiar la empresa primaria invalida la evidencia de la identidad anterior. Las claves foráneas eliminan casos y decisiones derivados cuando se elimina cualquiera de las fuentes.

La recuperación RAG automática y `search_knowledge_base` adjuntan anotaciones sólo al fragmento que contiene la cita y sólo cuando ambas fuentes siguen visibles para el agente, la audiencia, el país y la fecha del turno. Una revisión de otro alcance no transfiere su preferencia. La anotación conserva referencias, citas y alcance como datos escapados; el motivo libre del revisor no se inyecta como instrucción.

Una preferencia no modifica documentos ni reemplaza herramientas de precio, existencias, disponibilidad, cobro o resultados operacionales. Tampoco permite que un documento o FAQ reemplace una política o la identidad estructurada del negocio. Las fuentes canónicas mantienen su propia autoridad; esta entrega no altera sus herramientas para ordenar resultados según preferencias.

## Cobertura y límites visibles

El análisis compara documentos listos, FAQ publicadas, políticas activas y la identidad del negocio. Toma hasta 40 documentos, 40 FAQ, 12 políticas y una identidad, con un máximo de 4.000 caracteres por fuente y 12 pares preseleccionados por coincidencia léxica y alcance compatible. No analiza todo el catálogo operacional ni garantiza encontrar una diferencia expresada con vocabulario distinto. Los hashes se calculan sobre el texto completo y los metadatos, antes de truncar la muestra.

La interfaz distingue fuentes disponibles, pares seleccionados, pares revisados y pares sin resultado verificable. Fallos de lectura, respuestas inválidas del juez y citas inventadas no se contabilizan como ausencia de conflictos. Un informe sin hallazgos o una revisión humana no certifican la calidad global del agente.

La tabla de casos y la de decisiones forman parte del manifiesto de dependencias de evaluación. La tabla de informes de análisis sólo contiene contadores y códigos de error y se excluye como telemetría. Las evaluaciones con persistencia deshabilitada consultan anotaciones sin crear tablas o corregir el esquema.

## Verificación

Las pruebas cubren citas inventadas y booleanos ambiguos, alcance disjunto, cambios de fuente, CAS de revisión, atribución del actor, preferencia restringida frente a política, escape XML, anotación sólo del fragmento pertinente, estados desconocidos y recuperación de autoridad después de una respuesta perdida. El panel y sus mensajes se verifican en español, inglés, portugués y francés.

La suite `knowledge-conflict.pg.spec.ts` utiliza PostgreSQL real sólo cuando se define `KNOWLEDGE_CONFLICT_TEST_DATABASE_URL` con una base desechable de loopback cuyo nombre termina en `_eval_isolation`. Crea y elimina exclusivamente su esquema aleatorio `tenant_conflict_<uuid>`; no consulta tenants ni datos operativos. Cubre dos revisiones simultáneas, invalidación por metadatos, borrado en cascada para las cuatro clases de fuente y cambio de empresa primaria.

La inspección visual en navegador sigue impedida por el fallo de inicialización de CUA documentado en `agent-platform-visual-review-2026-09-07.md`. Las pruebas de renderizado y TypeScript no se presentan como una validación visual ni como una prueba de respuestas de un modelo real.
