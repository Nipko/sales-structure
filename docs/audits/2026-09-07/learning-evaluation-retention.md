# Autoridad de fuentes y retiro de copias en evaluaciones de aprendizaje

7 de septiembre de 2026. Cambios locales posteriores a `b6db0507`; sin commit, push, despliegue ni migración sobre tenants existentes. Continúa `learning-runtime-source-authority.md`.

## Problema y comportamiento

Una evaluación copiaba mensajes históricos a un entorno temporal, pero la fuente no conservaba un índice durable de esas copias. Un worker interrumpido podía dejar datos que el retiro de la fuente desconocía. Además, comprobar fuentes antes del replay no protegía cada llamada posterior ni el guardado de resultados frente a cambios concurrentes.

Ahora `learning_releases.evaluation_namespaces` registra tenant, esquema origen, namespace, token de propietario, vencimiento e intento **antes de copiar texto histórico**. El registro valida el marcador real del namespace y el snapshot de la candidata. La copia usa una transacción breve que protege las fuentes originales; no depende de una comprobación anterior a la transacción.

| Momento | Garantía implementada |
|---|---|
| Registro y copia | Rechaza intento reemplazado, fuente editada, namespace ajeno, propietario incorrecto o snapshot cambiado antes de copiar |
| Generación del replay | Una sola autoridad por intento de proveedor valida candidata, fuentes de prueba, baseline congelado, ejemplos seleccionados y namespace registrado, antes y después de la llamada |
| Interpretación y reformulación de búsqueda | El adaptador común de sesión aplica la autoridad aun cuando no hay ejemplos de estilo seleccionados; un fallback local conserva el error en la traza |
| Juez A/B | Valida fuentes de candidata y baseline, incluso si el baseline no selecciona ejemplos en ese turno; no otorga puntuaciones favorables a una comparación no disponible |
| Checkpoint y resultado final | Lee y bloquea la revisión actual, verifica fuentes propias y del baseline y guarda el resultado en la misma transacción breve; no revive una revisión retirada |
| Terminación normal o por excepción | El worker limpia únicamente los nombres de namespace que usó; retirar un nombre ya eliminado es idempotente |
| Retiro de fuente o borrado de contacto | Retira revisiones directamente afectadas y descendientes por comparación, elimina copias registradas, snapshots y resultados; marca la evaluación terminada con fallo |
| Recuperación periódica | Limpia copias vencidas según el marcador real, también en tenants inactivos; solo recupera trabajos de tenants activos |

La limpieza usa el tenant, esquema origen y token exactos, además del lock de namespace. Si hay un propietario diferente o una dependencia externa impide el borrado con `RESTRICT`, la transacción conserva el índice y falla: no oculta una copia que no pudo retirar. El vencimiento almacenado en JSON es informativo; el marcador de PostgreSQL decide si la copia está vencida. La recuperación no requiere que empiece otra evaluación.

El retiro comparte el mismo fence de privacidad que el uso externo. Las llamadas de generación no mantienen locks de filas de conversaciones/contactos ni el lock de la tabla de identidades mientras esperan al proveedor. Una edición normal del chat puede avanzar; la comprobación posterior descarta el resultado tardío. El router sigue tratando una revocación como pérdida de autoridad de datos, sin reenviar el mismo prompt a otro proveedor.

El índice temporal se excluye únicamente del contenido de evaluación que firma el manifiesto. Las fuentes, snapshots y dependencias de negocio siguen formando parte de la revisión. La columna se crea antes de capturar el manifiesto; no se retiró ninguna dependencia operativa para hacer pasar pruebas.

## Verificación

Pruebas con PostgreSQL/Prisma real en bases locales desechables, más orquestador, adaptador, router y servicios reales con proveedores controlados. Se verificaron retiro tras ausencia de worker, descendientes de baseline sin referencia directa a la fuente, ownership manipulado con rollback, limpieza de un subconjunto de namespaces, cola perdida/completada, tenant inactivo, vencimiento durante una llamada, fuente modificada, baseline modificado con candidata intacta y checkpoints tardíos. La consulta de recuperación `to_regclass` usa el cast `::text` requerido por Prisma.

Cobertura ejecutada en esta tanda: **11 suites / 131 casos**, incluidos **40 PostgreSQL/Prisma de fuentes**, dos de lectura del namespace y cinco de manifiesto. Las últimas verificaciones por bloques pasaron **tres suites de aprendizaje / 74 casos** y **cinco suites de runtime, adaptadores y evaluador / 56 casos**. Las suites se solapan; no se suman. Router, manifiesto, namespace y bootstrap pasaron en la batería de integración previa a esos ajustes. TypeScript API y `git diff --check` pasan.

Se corrigió un fixture para verificar procedencia sin intentar abrir originales de holdout en un endpoint reservado a train. Se conserva la separación entre entrenamiento y prueba. No se realizaron llamadas a proveedores externos ni se certificó la calidad del juez con esta tanda.

## Frentes que continúan abiertos

- La continuación `learning-worker-ownership.md` agrega una identidad durable por invocación, reanudación desde el checkpoint actual y CAS de fallos/guardado. Continúan las pruebas de proceso y particiones entre cola, Redis, PostgreSQL y proveedor.
- La continuación `learning-external-source-authority.md` verifica embeddings y búsqueda/memoria históricas, además de reintentos internos de SDK. Continúan otras herramientas con clientes propios y el inventario completo de salidas externas; la protección de un adaptador no demuestra cobertura de todos sus clientes.
- Retención y retiro de todas las trazas técnicas y caches de sesión en memoria; la garantía de esta tanda se refiere al índice SQL, los namespaces y los resultados de aprendizaje registrados.
- Lectores congelados y réplica utilizable con tráfico concurrente, calibración semántica del juez, tareas completas con LLM por perfil/canal/idioma y mejora medida frente al baseline.
- Autoridad hasta despacho diferido y pruebas externas de fallos de red/proceso. Un fence de generación no puede borrar una petición ya recibida por un proveedor ni retirar un mensaje ya entregado.

El plan completo permanece activo. Pasar estas pruebas no convierte un tono agradable ni una evaluación aislada en evidencia de competencia de mercado.
