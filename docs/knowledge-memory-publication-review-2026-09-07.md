# Integridad de publicación y memoria — D2

La validación se realizó con PostgreSQL 17.11 y pgvector 0.8.6 reales, en un contenedor desechable con almacenamiento tmpfs y puerto limitado a loopback. Los proveedores LLM/embeddings y Redis fueron sustituidos por respuestas sintéticas controladas; chunking, publicación SQL, dimensiones vectoriales, ranking, transacciones y locks se ejecutaron realmente. Una prueba adicional utiliza PrismaClient real con los métodos de PrismaService para comprobar serialización y parámetros.

## Fallos reproducidos y corregidos

- Una indexación retrasada comparaba `updated_at` como `Date` de JavaScript y perdía los microsegundos de PostgreSQL. Podía sobrescribir un cambio de audiencia dentro del mismo milisegundo. El control de revisión ahora conserva `updated_at::text`; también lo usa al registrar un fallo de embeddings, que antes podía quedar sin diagnóstico por la misma pérdida de precisión.
- Una extracción iniciada cuando el propietario era un contacto podía publicarse después de unificar la identidad y corregir la memoria desde otro canal. La publicación ahora estabiliza la familia de identidades, revalida el propietario y compara el snapshot antes de escribir. Una corrección del perfil también retira hechos anteriores de los contactos vinculados. El ranking semántico no puede dar prioridad a un valor legado sobre el atributo vigente del perfil.
- La fusión de perfiles eliminaba el perfil secundario sin trasladar sus hechos semánticos. Quedaban fuera de la recuperación y los hechos legados sin `source_contact_id` no eran alcanzables por el borrado posterior. La fusión ahora mueve las identidades, los hechos y la metadata en una transacción; conserva los IDs, evidencia y estados históricos. Si falla una operación intermedia, toda la fusión se revierte.
- El serializador real de Prisma rechaza columnas `void` y `regclass` en estas consultas. Los locks y las consultas de existencia pertinentes se convierten explícitamente a texto. La prueba de publicación, fusión y borrado por Prisma cubre esta diferencia frente al driver `pg`.

## Conflictos de memoria después de fusionar identidades

Si un `fact_key` tiene valores distintos en los perfiles fusionados, ambos se conservan como `conflicted`. Ninguno se publica como un hecho vigente. El agente recibe observaciones estructuradas, escapadas y acotadas; pide una aclaración sólo cuando el atributo importa para la solicitud actual. No expone claves técnicas o historia interna de la fusión.

Omitir un conflicto en una extracción no lo resuelve. Para sustituirlo o retirarlo, la extracción debe aportar una cita literal de un mensaje inbound posterior al momento del conflicto. Un mensaje previo, una afirmación del asistente o una respuesta inválida del extractor no habilitan la corrección. La cita demuestra procedencia; la interpretación semántica continúa siendo tarea del extractor y no se presenta como una certificación de verdad.

La retirada se expresa mediante `retractions` con la clave y evidencia. El historial se conserva como superseded para trazabilidad; el borrado de datos elimina tanto hechos activos como históricos. Los hechos legados sin claves se preservan sin inventar una clasificación de atributo.

## Orden de locks

La preparación LLM/embeddings ocurre fuera de las transacciones. La publicación de memoria toma un breve lock SHARE sobre `contact_identities` antes del lock del propietario. La fusión toma el lock compartido de privacidad, SHARE ROW EXCLUSIVE sobre identidades y luego los locks de memoria ordenados. El borrado toma privacidad exclusiva, SHARE sobre identidades y los mismos locks de memoria ordenados. Así una primera identidad, una fusión o un borrado no atraviesan la comprobación del propietario y su publicación.

## Pruebas reproducibles

`apps/api/src/modules/knowledge/knowledge-memory-publication.pg.spec.ts` se habilita con `KNOWLEDGE_MEMORY_TEST_DATABASE_URL`. Exige un host de loopback y una base desechable cuyo nombre termine en `_eval_isolation`. Crea y elimina exclusivamente su esquema aleatorio `tenant_memorykb_<uuid>`; instala pgvector en ese esquema si todavía no existe la extensión. No consulta tenants ni datos operativos.

La imagen probada fue `pgvector/pgvector:pg17`, digest `sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f`. Las pruebas abarcan fallos de proveedor y de almacenamiento, recuperación, CAS de contenido y metadatos, correcciones y expiración, extracción de dos canales, borrado concurrente y rollback, cambio de propietario, bloqueo observable en `pg_locks`, fusión de perfiles con y sin conflictos, retirada posterior y serialización real de Prisma.

Estas pruebas no evalúan calidad semántica de un proveedor externo, latencia bajo carga, ni inspección visual de una interfaz. La memoria del cliente conserva su función de personalización; no se convierte en autoridad para precios o resultados operacionales.
