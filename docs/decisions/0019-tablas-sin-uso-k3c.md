# 0019 — Tablas sin uso: dejar de crearlas (fase 1) y borrarlas después del respaldo (fase 2)

- Estado: aprobada (fase 1); fase 2 pendiente de confirmar el respaldo
- Fecha: 2026-11-05 · Decide: dueño del producto (delegó las decisiones pendientes de K3 en la opción más recomendada) · Autor: Claude (K3c)
- Ámbito: `apps/api/prisma/tenant-schema.sql`, `apps/api/src/modules/verticals/vehicle-inventory.service.ts`, documentos de referencia. La fase 1 **no** borra tablas, columnas ni filas.

## Contexto

Los ADR 0005 y 0017 dejaron para el dueño una lista de tablas que nada lee ni escribe. Se volvió a comprobar contra `origin/main` (`dc746866`) con `git grep` de cada nombre en todo el monorepo:

- **Por tenant (15):** `business_rules`, `tool_configs`, `intake_sources`, `campaign_courses`, `carla_personality_profiles`, `carla_prompt_templates`, `carla_conversation_context`, `knowledge_chunks`, `knowledge_approvals`, `conversation_memory`, `dashboard_preferences`, `kb_health_issues`, `vehicle_inquiries`, `wait_jobs` y `kb_unanswered_queries` (sin escritor desde R5, ADR 0011). Solo aparecen en su `CREATE TABLE` de la plantilla, en el DDL perezoso de `vehicle_inquiries` y en código de **limpieza** (ver abajo). La especificación (`packages/business-spec`) las nombra solo como descripción del almacenamiento de hoy.
- **Públicas legacy:** `daily_metrics`, `commercial_offers`, `knowledge_resources`, `carla_personality_profiles`, `carla_prompt_templates`, `legal_text_versions`, `consent_records`, `opt_out_records`, `deletion_requests`, `canned_responses`, `wait_jobs`, `automation_rules`, `pipeline_stages`. Ningún código ni migración vigente las crea (venían de los SQL sueltos 002/003 y `v4_*`, retirados en K3); solo las nombra `TENANT_PUBLIC_PURGE_ORDER` para que la purga de un tenant las limpie si existen.
- **SMS:** `sms_package_orders`, `sms_credit_ledger`, `sms_credit_balances` quedan sin código cuando se retira SMS (ADR 0020) y van con la fase 2.

Las migraciones son expand-contract (`AGENTS.md`): el código viejo corre minutos contra el schema nuevo, y borrar una tabla con datos exige el visto bueno del dueño y un respaldo.

## Decisión

**Fase 1 (este cambio, rama `claude/k3c-unused-tables`):**

1. La plantilla `tenant-schema.sql` deja de crear las 15 tablas por tenant y sus índices: un tenant nuevo ya no las recibe. Los tenants existentes las conservan con sus filas (la plantilla solo usa `IF NOT EXISTS`, nunca borra).
2. `VehicleInventoryService` deja de crear `vehicle_inquiries` de forma perezosa.
3. Se quitan de la plantilla dos `CREATE TABLE` duplicados que nunca corrían porque la primera definición gana por `IF NOT EXISTS`: el segundo `courses` (el shape de education sigue llegando por sus `ALTER`) y el segundo `customer_memory_erasure` fuera de bloques generados. Los duplicados dentro de bloques `-- BEGIN/END` (`eval_runs`, `operational_notice_outbox`, el tercer `customer_memory_erasure`) se quedan: los reescriben los generadores de `apps/api/prisma/generate-*.cjs` y deben coincidir con sus migraciones.
4. Se actualizan los documentos de referencia que las listaban como vigentes.

Se **queda** a propósito hasta la fase 2, porque protege datos personales mientras las filas existan: el `DELETE` de `conversation_memory` al borrar una conversación (`agent-console.service.ts`), el de `kb_unanswered_queries` en el borrado de memoria del cliente (`compliance.service.ts`), `infra/scripts/reset-chat.sh` y las tablas públicas de `TENANT_PUBLIC_PURGE_ORDER` (la purga falla cerrada si encuentra una tabla pública con `tenant_id` sin clasificar). Tampoco se tocan las listas de `evaluation-revision`: cambiarlas cambia el sello de dependencias de las evaluaciones certificadas.

**Respaldo (antes de la fase 2):** `k3c-tablas-respaldo.sh` (en las notas de la sesión) cuenta filas por schema y deja un `pg_dump` por tabla en `/root/backups/k3-<fecha>/`, con `conteos.tsv` y `SHA256SUMS`. Solo lee.

**Fase 2 (rama `claude/k3c-drop-unused-tables`, PR en borrador, no se fusiona hasta confirmar el respaldo):** una migración aditiva-inversa con `DROP TABLE IF EXISTS` por tenant y en `public`, y el retiro del código de limpieza que solo existía para esas filas.

## Consecuencias

- Tenants nuevos sin 15 tablas muertas; ningún dato se pierde en la fase 1.
- La fase 2 es irreversible salvo restaurar el respaldo, por eso va aparte y en borrador.

## Alternativas descartadas

- Borrar en el mismo despliegue: viola expand-contract y no deja respaldo verificado.
- Quitar ya el código de limpieza: dejaría filas con datos personales sin borrar cuando un cliente pide el olvido.
