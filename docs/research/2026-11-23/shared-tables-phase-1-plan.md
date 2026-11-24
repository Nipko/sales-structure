# Tablas compartidas — plan de la fase 1

_Plan de trabajo de [ADR 0034](../../decisions/0034-tablas-compartidas-con-tenant-id.md). Fecha: 2026-11-24. Documento de trabajo: se retira cuando la fase 1 esté cerrada._

> **Cifras:** los conteos de este plan (249 tablas, 70 a mover, 166 restantes) se tomaron de una copia local 69 commits detrás de `main`. Sobre `main` actual la plantilla define 234 tablas distintas. Antes de cada lote hay que rehacer su inventario contra el código vigente.

**Qué entrega la fase 1:** el mecanismo de tablas compartidas probado de punta a punta, 70 tablas operativas movidas a `shared`, y 13 tablas sin uso fuera de la plantilla. Las tablas por tenant bajan de 249 a 166.

**Dónde se hace:** el VPS ya no existe (2026-11-24) y no hay datos que conservar. Hasta que el entorno de AWS esté en pie, cada cambio se prueba en la base de PostgreSQL de la CI; la prueba de punta a punta con un tenant real queda para el primer despliegue en AWS. Consecuencias sobre este plan: no hay tenants ni schemas previos que dar de baja, el rol `parallext` del contenedor desaparece (el dueño de la base será el usuario maestro de RDS) y la regla de dos despliegues para quitar tablas no aplica hasta el lanzamiento.

**Lo marcado «verificar»** son supuestos míos que hay que confirmar en el código antes de ejecutar ese paso.

---

## Paso 0 — Preparación (sin mover ninguna tabla)

**Estado (2026-11-24, rama `aws/shared-tables-step-0`):** hecho en código, pendiente de correr en la CI.

| Punto | Estado | Dónde |
|---|---|---|
| 0.1 Rol sin privilegios | Hecho: la migración crea `parallext_app` sin acceso y sin contraseña. Falta, al aprovisionar AWS, darle acceso y apuntar `DATABASE_URL` a él | `prisma/migrations/20261124120000_add_shared_schema` |
| 0.2 Schema `shared` y registro | Hecho. Además, la función `shared.apply_tenant_isolation(tabla)` concentra lo que hace compartida a una tabla | misma migración, `modules/prisma/shared-tables.ts` |
| 0.3 Contexto de tenant | Hecho, sin resolvedor ni caché: el id se lee del nombre físico del schema (termina en el UUID del tenant) y el entorno de evaluación recibe un id sintético de sus 32 dígitos. Un nombre sin id deja el contexto vacío y las tablas compartidas fallan. API y servicio de WhatsApp | `modules/prisma/tenant-context.ts` (copia idéntica en `apps/whatsapp`) |
| 0.4 Salvaguardas | Hecho: prueba de aislamiento como `parallext_app`, guardia de estilo, tope decreciente de archivos con creación perezosa (60) y detector de tablas que tapan en el arranque | `shared-tables-isolation.postgres.spec.ts`, `shared-tables-style.spec.ts`, `PrismaService.findShadowedSharedTables` |
| 0.5 Borrado y respaldo | Borrado hecho (`purgeTenantSharedData`, llamado en la purga). El respaldo se define con RDS, ya no con `backup.sh` | `offboarding.service.ts` |

Pendiente del paso 0: que toda la suite corra conectada como `parallext_app` (hoy la CI se conecta como dueño). Es lo que dirá qué más necesita el rol; se hace al montar la CI contra el entorno nuevo.

Nada de este paso cambia el comportamiento visible. Todo debe estar desplegado antes de mover la primera tabla.

### 0.1 Rol de base de datos sin privilegios

Es la condición previa de todo: **un superusuario ignora la seguridad por fila**. Hoy la aplicación se conecta como `parallext`, que es el usuario con el que se creó el contenedor de PostgreSQL y por tanto superusuario (verificar con `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'parallext'`).

- Crear el rol `parallext_app`: con `LOGIN`, sin `SUPERUSER`, sin `BYPASSRLS`.
- Permisos: `USAGE` y `CREATE` sobre la base (el runtime todavía crea schemas de tenant), propiedad o permisos completos sobre los schemas de tenant existentes, y sobre `shared` solo `USAGE` más `SELECT, INSERT, UPDATE, DELETE` en sus tablas (con `ALTER DEFAULT PRIVILEGES` para las que se creen después).
- `DATABASE_URL` (por PgBouncer) pasa a `parallext_app`; `DIRECT_DATABASE_URL` (migraciones) se queda con el dueño.
- PgBouncer: agregar el usuario a `userlist.txt` (`infra/pgbouncer/entrypoint.sh`).
- Despliegue: nueva variable en GitHub Secrets **y** en `deploy.yml`.
- Riesgo: los schemas de tenant existentes pertenecen a `parallext`; el rol nuevo necesita permisos sobre ellos o las consultas fallan. Probar primero con un tenant.

### 0.2 Schema `shared` y registro de tablas

- Migración de Prisma (SQL crudo) que crea el schema `shared` vacío y otorga `USAGE` a `parallext_app`.
- Archivo nuevo con la lista canónica, por ejemplo `apps/api/src/modules/prisma/shared-tables.ts`: nombre de cada tabla compartida y su fase. Empieza vacío.

### 0.3 Contexto de tenant en los ayudantes

`executeInTenantSchema` y `transactionInTenantSchema` (`prisma.service.ts:192-239`) reciben el **nombre del schema**, no el id del tenant. Hace falta un resolvedor schema → `tenant_id`:

- Caché en memoria con vencimiento corto, alimentada desde `tenants.schema_name`.
- Los schemas efímeros de evaluación (`tenant_eval_*`) no corresponden a ningún tenant. Propuesta: cada uno recibe un `tenant_id` sintético propio, de modo que sus filas en tablas compartidas quedan aisladas y se limpian borrando por ese id (verificar contra `simulation/isolated-eval-namespace.ts` y `eval-namespace-reaper`).
- Los dos ayudantes pasan a ejecutar, en la misma transacción:

```sql
SET LOCAL search_path TO "<schema>", shared, public;
SELECT set_config('app.tenant_id', $1, true);
```

- El servicio de WhatsApp (`apps/whatsapp`) tiene su propio acceso a datos y escribe `whatsapp_webhook_events`: necesita el mismo cambio antes del lote 3.

### 0.4 Salvaguardas

- **Prueba de aislamiento en CI** (PostgreSQL real, conectada como `parallext_app`): para cada tabla del registro, comprobar que tiene seguridad por fila activada y forzada y una política; insertar con el tenant A y confirmar que el tenant B no ve, no actualiza y no borra la fila; confirmar que sin contexto la consulta falla.
- **Detector de tablas que tapan:** si un schema de tenant conserva una tabla con el mismo nombre que una compartida, esa copia gana por ir primero en el `search_path`. Agregar una comprobación (en el Ops Center o en la tarea de migración) que liste esos casos.
- **Guardia de estilo:** una prueba que falle si aparece `"${...}".<tabla compartida>` o un `CREATE TABLE IF NOT EXISTS <tabla compartida>` en `apps/*/src`. Sigue el patrón de `business-facts-writes.spec.ts`.

### 0.5 Borrado y respaldo

- La baja de un tenant (`offboarding.service.ts`) agrega, además del `DROP SCHEMA`, un borrado por `tenant_id` en todas las tablas del registro.
- `infra/backup/backup.sh` incluye el schema `shared`.

**Criterio de salida del paso 0:** la suite existente pasa conectada como `parallext_app`; la prueba de aislamiento corre (con el registro vacío); un tenant de prueba funciona de punta a punta en producción.

---

## Receta por tabla

Para cada tabla que se mueve:

1. **Inventario.** Buscar en `apps/api/src` y `apps/whatsapp/src`:
   - consultas con el schema escrito a mano: `rg '"\$\{[^}]+\}"\.<tabla>\b'`
   - creación perezosa: `rg 'CREATE TABLE IF NOT EXISTS\s+("?\$\{[^}]+\}"?\.)?<tabla>\b'`
   - `ON CONFLICT` sobre restricciones únicas de la tabla
   - usos de `ensureCanonicalTables` que la nombren
   - listas que la mencionan: `EVALUATION_OUTPUT_TABLES` (`evaluation-revision.ts:44-70`), la lista de clonado de `isolated-eval-namespace.ts:75`, `EVALUATION_TOOL_READ_GROUPS`
2. **Migración.** `CREATE TABLE shared.<tabla>` con:
   - `tenant_id uuid NOT NULL DEFAULT current_setting('app.tenant_id')::uuid`
   - los índices de la plantilla, cada uno encabezado por `tenant_id`
   - las restricciones únicas con `tenant_id` incluido
   - `ENABLE` y `FORCE ROW LEVEL SECURITY`, política con `USING` y `WITH CHECK`
   - sin llaves foráneas hacia tablas que siguen siendo por tenant (se conserva la columna y su índice; la llave vuelve en la fase 3)
3. **Código.**
   - quitar la tabla de `tenant-schema.sql`
   - eliminar su creación perezosa. **Este punto es crítico:** con el `search_path` nuevo, un `CREATE TABLE IF NOT EXISTS` sin calificar crearía la tabla dentro del schema del tenant y taparía a la compartida
   - pasar por el ayudante las consultas que escribían el schema a mano
   - ajustar los `ON CONFLICT` cuyo destino cambió
   - agregarla al registro
4. **Verificación.** Prueba de aislamiento en verde; specs del módulo; `npx tsc --noEmit`; `npm run test:bootstrap`; `npm run test:migrate:tenants`; prueba manual del flujo en producción con un tenant creado después del cambio.

**Tenants de prueba existentes.** Quitar una tabla de la plantilla no la borra de los schemas ya creados, así que esos tenants seguirán escribiendo en su copia antigua. Es inofensivo, pero no prueban el camino nuevo. Dos opciones: dar de baja los tenants de prueba y crear otros tras cada lote (recomendado, coincide con la limpieza ya decidida), o borrar las copias con un script. Borrar tablas en schemas existentes requiere la aprobación del dueño, aunque los datos sean de prueba.

---

## Lotes

Ordenados de menor a mayor riesgo. Cada lote es un cambio desplegable por sí solo.

| Lote | Tablas | Contenido | Por qué en este orden |
|---|---|---|---|
| 1 · Piloto | 2 | `conversation_traces`, `turn_traces` | Un solo módulo (`trace/`), mucho volumen, sin efecto sobre el cliente si algo falla. Valida el mecanismo completo |
| 2 · Bandejas de salida | 9 | `agent_dispatch_outbox`, `agent_dispatch_outbox_sources`, `agent_dispatch_resolutions`, `operational_notice_outbox`, `operational_notice_reviews`, `outbound_payloads`, `tool_approval_outbox`, `agent_handoff_effects`, `tool_approval_effects` | Misma forma entre sí. Ojo: son el camino de salida de mensajes; probar envío real |
| 3 · Integraciones y registros | 12 | `whatsapp_webhook_events`, `whatsapp_message_logs`, `whatsapp_receipt_inbox`, `integration_outbox`, `integration_webhook_inbox`, `integration_reconciliations`, `webhook_deliveries`, `crm_sync_log`, `crm_note_receipts`, `gbp_reply_effects`, `calendar_sync_outbox`, `automation_executions` | Requiere el cambio en `apps/whatsapp` (paso 0.3). `whatsapp_message_logs` pierde su llave hacia el núcleo |
| 4 · Métricas, preparación y conocimiento | 14 | `analytics_events`, `daily_metrics`, `alert_history`, `readiness_evaluations`, `go_live_decisions`, `rehearsal_runs`, `rehearsal_results`, `kb_retrieval_log`, `kb_unanswered_queries`, `kb_feedback`, `knowledge_conflict_scans`, `vertical_migrations`, `vertical_migration_archives`, `vertical_migration_outbox` | `kb_unanswered_queries` figura como retirada en ADR 0011: confirmar si se mueve o se elimina. Las métricas alimentan el panel: `dashboard-analytics.service.ts` y `metrics-aggregation.service.ts` escriben el schema a mano (43 y 22 veces) |
| 5 · Calidad y evaluación | 30 | simulación, evaluación, certificación, benchmark, aprendizaje, misiones, candidatos de versión, muestreo y regresiones (dominio 9 del inventario, menos las dos trazas) | El más grande y el que obliga a rediseñar el entorno aislado de evaluación y el hash de `evaluation-revision`. `learning_examples` tiene vector y lo lee el ensamblador de prompts; `agent_release_*` condiciona la publicación |
| 6 · Gasto de WhatsApp | 3 | `whatsapp_spend_counters`, `whatsapp_spend_reservations`, `whatsapp_spend_allocations` | Es dinero: `spend-ledger.ts` tiene 49 referencias con schema a mano y 6 `ON CONFLICT`. Va al final, con el mecanismo ya rodado |

Total: 70.

### Dentro del lote 5

- **Entorno aislado.** Hoy clona tablas del schema del tenant a `tenant_eval_*`. Las tablas compartidas no se clonan: las filas del entorno aislado se distinguen por su `tenant_id` sintético (paso 0.3) y el limpiador borra por ese id.
- **Hash de estructura.** `evaluation-revision.service.ts:56-86` calcula un hash sobre las relaciones del schema del tenant. Al salir tablas de ese schema el hash cambia e invalida evaluaciones previas. Como solo hay tenants de prueba se acepta la invalidación; hay que decidir si el hash pasa a cubrir también `shared`.
- **Vector de `learning_examples`.** Índice B-tree por `tenant_id` y búsqueda exacta; sirve de ensayo para `knowledge_embeddings` en la fase 3.
- **Llaves hacia el núcleo** en `agent_mission_instances`, `agent_mission_turns`, `quality_regression_cases` y `quality_sampling_items`: se retiran hasta la fase 3.
- **Definiciones repetidas.** `eval_runs` está dos veces en la plantilla y `customer_memory_erasure` (núcleo, fase 3) se recrea desde varios de estos módulos: revisar que ninguna creación perezosa sobreviva.

---

## Limpieza: las 13 tablas sin uso

> **Ya resuelto en `main` (ADR 0019, 2026-11-05):** la plantilla dejó de crear estas tablas y `kb_unanswered_queries`. Sin VPS no queda ninguna copia que borrar. Lo que sigue se conserva solo como registro de lo que se pensaba hacer.

`business_rules`, `tool_configs`, `carla_personality_profiles`, `carla_prompt_templates`, `carla_conversation_context`, `campaign_courses`, `intake_sources`, `wait_jobs`, `knowledge_chunks`, `knowledge_approvals`, `kb_health_issues`, `dashboard_preferences`, `conversation_memory`.

- Se quitan de la plantilla en un cambio aparte, antes del lote 1.
- Confirmar una por una antes de quitarlas: la evidencia es ausencia de referencias en `apps/*/src` y `apps/api/scripts`, no una prueba de ejecución.
- `conversation_memory` tiene un `DELETE` en `agent-console.service.ts:1381` que hay que retirar.
- `knowledge_chunks`, `knowledge_approvals`, `kb_health_issues` y `dashboard_preferences` aparecen en listas de `evaluation-revision`: limpiarlas ahí también.
- De paso: los cinco nombres de la lista de clonado que no existen en ninguna plantilla (`tool_approval_events`, `appointment_settings`, `appointment_holds`, `appointment_blocked_dates`, `class_waitlist`).
- En los schemas existentes las tablas quedan hasta que el tenant se dé de baja.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El rol nuevo no tiene permisos sobre algo que el superusuario sí | Paso 0.1 se despliega solo y se prueba antes de tocar tablas |
| Una creación perezosa olvidada tapa la tabla compartida | Guardia de estilo (0.4) y detector de tablas que tapan |
| Una consulta fuera del ayudante llega sin contexto | Falla con error; la guardia de estilo la detecta antes |
| Rendimiento de las políticas | Índices encabezados por `tenant_id`; el parámetro envuelto en `(SELECT ...)` para que se evalúe una vez; medir en el lote 1 con `turn_traces` |
| Las consultas con schema a mano de analítica son muchas | Lote 4 se puede partir en dos si el cambio resulta grande |
| Se rompe el envío de mensajes en el lote 2 | Prueba real de envío por canal antes de dar por cerrado el lote |

## Criterio de salida de la fase 1

- 70 tablas en `shared`, todas en el registro y cubiertas por la prueba de aislamiento.
- La plantilla de tenant define 166 tablas.
- Ningún `CREATE TABLE IF NOT EXISTS` ni schema escrito a mano para esas 70 tablas.
- La baja de un tenant borra sus filas en `shared` y el respaldo las incluye.
- Un tenant nuevo funciona de punta a punta: mensaje entrante, respuesta, handoff, evaluación del agente y panel de analítica.
- `AGENTS.md` y `apps/api/CLAUDE.md` describen el modelo en transición.
