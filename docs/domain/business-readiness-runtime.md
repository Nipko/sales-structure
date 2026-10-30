# Preparación del negocio en tiempo de ejecución (R2)

Cómo usa la plataforma la especificación (`packages/business-spec`) para decir si un tenant está listo para atender. Diseño: C0 §1.1, §2.7, §4.1 y §5 R2. Decisiones de construcción: [ADR 0004](../decisions/0004-panel-de-preparacion-r2.md).

## Flujo

```
GET /readiness/:tenantId[?refresh=1]
  └─ ReadinessService
       ├─ Redis readiness:{tenant}:{spec_version} (10 min) ── si está y no hay refresh → respuesta
       ├─ SnapshotReader (un SELECT en transacción READ ONLY; sin columnas sensibles)
       ├─ fromLegacyRows → evaluate(spec, foto, ahora)           ← @parallext/business-spec, puro
       ├─ readiness_evaluations: INSERT solo si result_hash cambió
       └─ eventos readiness.evaluated / readiness.verdict_changed
```

- **Una sola regla.** El veredicto, los huecos y su nivel los decide el motor. La API solo lee, guarda y sirve; el panel solo agrupa. `readiness:report` (CLI) y el panel dan el mismo veredicto sobre la misma foto (lo prueban `readiness.service.spec.ts` y `readiness-panel.spec.ts` con las 7 fotos golden).
- **`resultHash`** identifica el contenido del resultado, sin la hora: el historial tiene una fila por cambio real.
- **Caché.** Se invalida con `agent.config.updated` y `agent.version.updated`; en R3 también con `business_fact.written`. El panel siempre reevalúa al abrirse.

## API

| Método | Ruta | Roles | Uso |
|---|---|---|---|
| GET | `/readiness/:tenantId` | super_admin, tenant_admin, tenant_supervisor | Última evaluación (`{evaluationId, evaluatedAt, trigger, cached, result}`); `?refresh=1` reevalúa |
| GET | `/readiness/:tenantId/history?limit=30` | ídem | Una fila por resultado distinto: veredicto, conteos, bloqueantes, `trigger`, fecha |
| GET | `/readiness/:tenantId/requirements/:requirementId` | ídem | Definición del requisito y su evaluación actual |
| GET | `/readiness/:tenantId/snapshot` | super_admin | Foto `business-spec/tenant-snapshot@1` para `business-spec qa-truth` |

## Almacenamiento

`readiness_evaluations` (por tenant): `id`, `spec_version`, `snapshot_hash`, `result_hash`, `verdict` (`no_listo|limitado|listo`), `counts`, `result` (el `ReadinessResult` completo), `trigger` (`on_demand|refresh|invalidated`), `created_at`. Se crea en `tenant-schema.sql` y, en los tenants existentes, con la migración `20261030120000_add_readiness_evaluations`.

## Panel

`/admin/readiness` (solo lectura) muestra:
- el veredicto;
- los **Bloqueantes**;
- los **Necesarios**, con las intenciones que quedarán en «no consta»;
- los **Recomendados**, con su cobertura;
- **Calidad** y **Plataforma**;
- la cobertura por área y el historial.

Cada hueco enlaza a la pantalla donde se arregla hoy (`ui_target`), solo si el rol que mira puede abrirla. La tarjeta de Inicio muestra el veredicto y los 3 primeros bloqueantes (tarea `business` = veredicto ≠ `no_listo`).

## Qué reemplazó

- **Retirado en R2:** `ReadinessCitationV1` y `readinessAudit` del contrato público; las tareas `knowledge`, `hours`, `appointments` y `team` de la tarjeta; los 20 chequeos de datos del negocio de `AgentQualityService`.
- **Sigue hasta R4:** `VerticalReadinessService`, `READINESS`, `TOOL_GROUP_READINESS` y `readiness-predicate-authority.util.ts` (C0 §4.2).
