# Runbook de evidencia para release vertical

**Versión:** 1
**Estado:** preflight estructural configurado; certificación E2E actual 0/18.

El deploy de producción solo acepta una atestación estructural guardada como secreto protegido `VERTICAL_RELEASE_EVIDENCE_JSON`. Su forma canónica está en [`vertical-release-evidence.schema.json`](./vertical-release-evidence.schema.json). El parser no consulta GitHub ni prueba que una URL/digest exista: esa verificación corresponde a los revisores protegidos y el JSON nunca constituye certificación por sí solo.

## Autoridad y vigencia

- El environment `production` debe exigir revisores independientes y restringir quién puede editar secretos/variables.
- `commitSha` debe ser exactamente el SHA del deploy.
- `issuedAt` y `expiresAt` tienen una ventana máxima de siete días.
- `certifiedVerticals` debe contener exactamente las 18 verticales canónicas.
- `approvalId` referencia la decisión del environment/release board; `approvedBy` identifica al revisor.

## Nueve artefactos obligatorios

Cada entrada debe tener `runId`, URL de GitHub Actions, digest SHA-256, resultado `passed`, SHA del commit y hora verificada. Los kinds son:

1. `postgres_bootstrap`
2. `redis_bullmq`
3. `real_model_eval`
4. `channel_sandbox`
5. `provider_sandbox`
6. `performance`
7. `chaos`
8. `rollback`
9. `canary`

El parser valida esquema, alcance, procedencia declarada, digest, commit y vigencia. El revisor del environment debe comprobar que las URLs/digests corresponden a artefactos inmutables y retenidos; el JSON por sí solo no constituye una ejecución.

## Secrets y variables

Secrets requeridos en `production`: `VERTICAL_RELEASE_DATABASE_URL`, `VERTICAL_RELEASE_REDIS_URL`, `VERTICAL_EVAL_OPENAI_API_KEY` y `VERTICAL_RELEASE_EVIDENCE_JSON`.

Variables requeridas con valor exacto `true`: `VERTICAL_REAL_MODEL_EVAL_READY`, `VERTICAL_CHANNEL_SANDBOX_READY`, `VERTICAL_PROVIDER_SANDBOX_READY`, `VERTICAL_BULLMQ_READY`, `VERTICAL_PERF_ENV_READY`, `VERTICAL_CHAOS_ENV_READY`, `VERTICAL_ROLLBACK_EVIDENCE_READY` y `VERTICAL_CANARY_READY`.

Una variable expresa readiness operativa, no reemplaza el artefacto del mismo gate. Si falta cualquiera de ambos, el deploy termina antes de tocar el VPS.
