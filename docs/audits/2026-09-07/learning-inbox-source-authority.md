# Aprendizaje desde Inbox: versión exacta de la fuente

7 de septiembre de 2026. Cambios locales sobre `b6db0507`; sin commit ni despliegue.

## Problema reproducido

La importación leía conversación/contacto y mensajes en consultas distintas. Guardaba el transcript redactado y los identificadores originales, pero no la versión del chat revisado. El guard de releases comprobaba fuentes activas, ejemplos no retirados y tombstones. Un chat editado, reasignado o cambiado de canal podía seguir aportando ejemplos aprobados. Abrir el original mostraba la conversación actual, aunque ya no correspondiera a la revisión.

## Implementación

- `learning-inbox-source.ts` captura identidad, atribución, canal, revisión QA, perfiles unificados y mensajes en una sola consulta MVCC. Conserva orden determinista por fecha/ID, IDs de mensajes y hashes del original y del transcript redactado. La evidencia nueva no almacena otro original sin redactar.
- La transacción de importación comprueba de nuevo esa captura. Los commits que usan fuentes bloquean conversación/contacto y la relación de identidades; el trigger QA real serializa las ediciones de mensajes. El borrado, retiro y reimportación comparten el fence de privacidad con el análisis externo. El grupo de train/holdout se vuelve a comprobar dentro de la transacción.
- La misma fuente activa y verificada devuelve duplicado. Una importación explícita nueva genera ejemplos pendientes; una conversación cambiada retira y limpia fuentes anteriores, ejemplos, revisiones y releases, incluidos derivados de holdout y evaluaciones. Retirar y después importar explícitamente tampoco recupera una aprobación anterior.
- Los originales, análisis, revisiones, selección del candidato, comprobaciones de evaluación, publicación y recuperación de ejemplos verifican la fuente. Las importaciones Inbox anteriores sin evidencia requieren reimportación y revisión; no se les atribuye una versión por inferencia. Las importaciones de archivos siguen separadas.
- El análisis y los embeddings de holdout mantienen un fence compartido de privacidad durante la llamada externa. Se comprueba la fuente antes del proveedor y antes del commit; un resultado tardío tras una edición se descarta. Los cambios de deduplicación de otros ejemplos quedan en esa misma transacción.
- La pantalla indica fuentes cambiadas, impide aprobar/seleccionar/publicar esas evidencias, permite reimportar desde el ejemplo y conserva retiro/rollback. No muestra porcentaje de tráfico activo cuando la fuente dejó de ser válida. Textos y pruebas de render en es/en/pt/fr; sin revisión visual de navegador.

Las pruebas PostgreSQL encontraron además dos fallos existentes: `SELECT e.*` intentaba deserializar `embedding vector` con Prisma y el borrado leía `regclass` sin cast. Las consultas de ejemplos ahora proyectan columnas explícitas y `to_regclass` devuelve texto. Los locks advisory devuelven texto compatible con Prisma.

## Validación

Integración final: **cinco suites API / 51 pruebas pasan**, incluidas **18 PostgreSQL/Prisma de procedencia Inbox** y dos de namespaces de aprendizaje, más evaluación, integridad y bootstrap de `AppModule`. Interfaz: **dos suites / 27 pruebas pasan** en los cuatro idiomas. API y dashboard pasan TypeScript; `git diff --check` pasa. Estas cifras se solapan con baterías anteriores y no deben sumarse como certificaciones nuevas.

La suite `learning-inbox-source.postgres.spec.ts` usa Prisma y PostgreSQL/pgvector reales en la instancia desechable de loopback. Crea y elimina exclusivamente un schema aleatorio propio; utiliza la función/trigger QA de `tenant-schema.sql`. No usa datos de clientes ni un proveedor LLM externo.

Casos: captura/redacción/duplicado; edición entre lectura e importación; reimportación tras retiro; actividad de otro cliente; análisis/revisión válidos con fence de privacidad; cambio de texto, append, borrado de mensaje, reasignación, canal, identidad, perfil unificado, fuente legada y alteración de transcript; retiro de derivados de train/holdout; tombstone/borrado; bloqueo real de edición concurrente; resultado del evaluador posterior a una edición. Los dobles de proveedor prueban el contrato, no la calidad semántica de sus juicios.

## Límites y siguiente integración

Esta tanda no termina E2 ni certifica el aprendizaje. La integración posterior de los ejemplos con cada intento del LLM operativo, su recuperación y las correcciones está descrita en `learning-runtime-source-authority.md`. Continúan pendientes el ciclo completo de evaluación, sus copias temporales y recuperación tras crash, retención de trazas derivadas y despacho diferido. Una comprobación previa/posterior aislada no equivale a mantener esa autoridad durante todo el uso externo.

El manifiesto global de evaluación sigue vigilando tablas completas: tráfico ajeno aún puede invalidar una evaluación larga, aunque el guard nuevo de una fuente concreta no lo hace. No se retiró ninguna firma global. Faltan los puertos de lectura congelados/réplica de negocio y conocimiento, la calibración semántica de la curación y medir mejora real de tono/utilidad sin regresiones. El recuento de cobertura de la interfaz sigue contando importaciones activas; no certifica por sí solo que el conjunto reservado sea válido para publicar.

La revisión automática de commits permanece indisponible por cuota. Se conserva el índice anterior sin mezclar esta tanda y sin eludir ese bloqueo.
