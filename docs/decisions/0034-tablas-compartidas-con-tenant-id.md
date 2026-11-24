# 0034 — Los datos de los tenants viven en tablas compartidas con `tenant_id` y seguridad por fila, no en un schema por tenant

- Estado: aprobada
- Fecha: 2026-11-24 · Decide: dueño del producto · Autor: Claude (agente), con el análisis de `docs/research/2026-11-23/aws-migration-analysis.md`
- Ámbito: `apps/api/prisma/tenant-schema.sql`, `modules/prisma/prisma.service.ts`, `apps/api/scripts/migrate-tenants.js`, todo módulo que consulta datos de tenant, `apps/whatsapp`, roles de PostgreSQL, respaldo y baja de tenants

## Contexto

Cada tenant recibe hoy un schema propio con las 249 tablas de la plantilla y sus 394 índices, sea cual sea su tipo de negocio: entre 1.000 y 1.400 relaciones por tenant. La clasificación de esas tablas es 79 de núcleo, 35 de funciones opcionales, 52 de verticales, 70 operativas o de telemetría y 13 sin uso aparente.

Con ese modelo un cluster de PostgreSQL sostiene cientos de tenants, no miles: cada conexión guarda en memoria el catálogo de las tablas que toca, las migraciones se repiten una vez por tenant y el arranque recorre todos los schemas. A 5.000 tenants la base de datos sería más de la mitad del costo de infraestructura (estimado en ~$5.900/mes contra ~$460–820 con tablas compartidas).

Las plataformas multi-tenant grandes que se pudieron verificar (Salesforce, Shopify, Notion, Slack, Figma, HubSpot, Zendesk) usan tablas compartidas con una columna de tenant, tenants agrupados en celdas y un directorio tenant → celda.

La plataforma no tiene todavía clientes reales: solo tenants de prueba que se darán de baja. Mover una tabla hoy es cambiar la plantilla y revisar su código; con clientes reales exigiría rellenar datos tenant por tenant.

## Decisión

1. **Destino.** Todas las tablas de datos de tenant pasan a un schema `shared`, una sola vez, con una columna `tenant_id uuid NOT NULL`. No queda ninguna tabla por tenant.
2. **Alcance antes de lanzar.** Las tres fases se completan antes de recibir clientes reales: (1) eliminar las 13 tablas sin uso y compartir las 70 operativas; (2) compartir las 52 verticales y las 35 de funciones opcionales; (3) compartir las 79 de núcleo.
3. **Aislamiento.** Toda tabla de `shared` tiene seguridad por fila activada y forzada (`ENABLE` + `FORCE ROW LEVEL SECURITY`) y una política que compara `tenant_id` con el parámetro de transacción `app.tenant_id`. El `tenant_id` toma ese mismo parámetro por defecto.
4. **Contexto de tenant.** Lo fijan únicamente los ayudantes de `PrismaService` (`executeInTenantSchema`, `transactionInTenantSchema`), con `set_config('app.tenant_id', $1, true)` en la misma transacción donde fijan el `search_path`. Sin contexto, la consulta falla: nunca devuelve filas de otro tenant.
5. **Rol de base de datos.** El runtime se conecta con un rol que no es superusuario, no es dueño de las tablas de `shared` y no tiene `BYPASSRLS`. Las migraciones usan otro rol. Un superusuario ignora la seguridad por fila, así que este punto es condición previa de todo lo demás.
6. **Definición de las tablas.** El DDL de `shared` vive en migraciones versionadas, no en la plantilla de tenant ni en código que crea tablas al vuelo. La creación perezosa (`CREATE TABLE IF NOT EXISTS` en servicios) se elimina para cada tabla que se mueve.
7. **Registro único.** Existe una lista canónica de tablas compartidas en código. De ella se derivan la prueba de aislamiento de la CI, el borrado de un tenant y la detección de tablas de tenant que tapen a una compartida.
8. **Llaves e índices.** Todo índice y toda restricción única de una tabla compartida empieza por `tenant_id`.
9. **Celdas.** `tenants` guarda la celda de cada tenant desde el inicio, aunque exista una sola. Un cliente grande puede tener celda propia.
10. **Convivencia.** Mientras dure la transición, el `search_path` es `<schema del tenant>, shared, public`. Una consulta sin calificar resuelve la tabla donde esté.

## Consecuencias

- **Reglas nuevas para todo código.** No interpolar `"${schema}".tabla` para tablas compartidas; no consultar datos de tenant fuera de los ayudantes; no crear tablas en ejecución; toda tabla nueva de tenant nace en `shared` con su política.
- **`AGENTS.md`.** La convención «Schema-per-tenant» queda en transición y se reescribe al cerrar la fase 3.
- **Lo que se pierde.** Aislamiento físico por schema; restaurar un tenant con `pg_dump -n`; borrarlo con `DROP SCHEMA`. Se reemplazan por la seguridad por fila forzada, la prueba de aislamiento en CI, y herramientas de exportación y borrado por `tenant_id`.
- **Llaves foráneas en transición.** Una tabla compartida no puede referenciar una tabla que sigue siendo por tenant. Esas llaves se retiran al mover la tabla y se restituyen en la fase 3.
- **Evaluaciones aisladas.** Los schemas efímeros `tenant_eval_*` y el hash de estructura de `evaluation-revision` dependen del modelo actual y se rediseñan dentro de la fase 1.
- **Vectores.** En tablas compartidas la búsqueda por defecto es exacta sobre un índice por `tenant_id`; los índices aproximados quedan para tenants grandes. Se decide con medición propia al llegar a `knowledge_embeddings` (fase 3).
- **Migraciones.** Una migración afecta a todos los tenants a la vez. La regla expand-contract sigue vigente. `migrate-tenants.js` y el DDL del arranque desaparecen al terminar la fase 3.
- **Operación.** El respaldo incluye el schema `shared`. El Ops Center deja de medir almacenamiento por schema y pasa a medirlo por `tenant_id`.

## Alternativas descartadas

- **Conservar el schema por tenant y repartir en celdas de ~300 tenants.** Funciona, pero el costo crece en línea recta con los tenants (17 instancias a 5.000 tenants, 334 a 100.000) y cada migración se multiplica por el número de schemas.
- **Crear bajo demanda solo las tablas que usa cada tipo de negocio.** Reduce la constante, no la pendiente. Obligaría a que la migración de tenants conozca el manifiesto de capacidades, a romper llaves foráneas del núcleo hacia `courses`, e invalidaría el hash de evaluaciones cada vez que se crea una tabla.
- **Un schema de vistas por tenant sobre tablas compartidas.** Evita tocar consultas, pero deja 249 entradas de catálogo por tenant: el problema de fondo sigue.
- **Filtrar por `tenant_id` solo en la aplicación, sin seguridad por fila.** Un filtro olvidado cruzaría datos entre tenants sin que nada lo detenga.
- **Detenerse en la fase 2 y lanzar con 79 tablas por tenant.** Aceptable técnicamente, pero deja para después la parte que exigirá rellenar datos de clientes reales.
- **Aurora Limitless, Aurora DSQL, Citus.** Limitless tiene un piso de costo alto y es innecesario a esta escala; DSQL no admite extensiones (sin pgvector); Citus no está disponible como servicio administrado en AWS.
