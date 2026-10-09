# Runbook de evidencia para release vertical

**Versión:** 1 (revisado el 2026-10-08)
**Estado:** preflight estructural configurado; certificación E2E actual 0/18.

> **Qué bloquea y qué no (verificado contra `.github/workflows/deploy.yml` y `vertical-quality.yml`, 2026-10-08).** En un deploy ordinario (push a `main`) el preflight corre con `REQUIRE_EXTERNAL_GATES: 'false'`: genera el informe y lo publica como artefacto `production-readiness-*`, pero **no bloquea** el deploy aunque falten evidencias o variables (el comentario de `deploy.yml` lo dice: «Missing advanced evidence is reported in the artifact but does not block an ordinary deployment»). Lo único que sí detiene un deploy ordinario es el baseline mínimo (`DATABASE_URL` y `REDIS_HOST`/`REDIS_URL`). El gate estricto, que falla cerrado, es el workflow manual `vertical-quality.yml` con `tier=release` (`REQUIRE_EXTERNAL_GATES=true`). Además, desde el 2026-10-07 el environment `production` **no tiene aprobación manual** en el deploy ordinario (decisión del dueño): se despliega al fusionar con CI verde.

El preflight (`apps/api/scripts/run-vertical-release-readiness.cjs`) valida una atestación estructural guardada como secreto protegido `VERTICAL_RELEASE_EVIDENCE_JSON`. Su forma canónica está en [`vertical-release-evidence.schema.json`](./vertical-release-evidence.schema.json). El parser no consulta GitHub ni prueba que una URL/digest exista: esa verificación corresponde a los revisores protegidos y el JSON nunca constituye certificación por sí solo.

## Autoridad y vigencia

- Para el tier `release`, la atestación debe provenir de un environment protegido (`attestationSource: github_environment_protected`) cuyos revisores sean independientes y que restrinja quién puede editar secretos/variables. Esa exigencia es de quien emite la atestación; no es una aprobación previa del deploy ordinario.
- `commitSha` debe ser exactamente el SHA del deploy.
- `issuedAt` y `expiresAt` tienen una ventana máxima de siete días.
- `certifiedVerticals` debe contener exactamente las 18 industrias seleccionables que enumera el validador (`canonicalIndustries` en el script). Las otras dos industrias del registro (`event_planning`, `construccion`) solo tienen tipos de negocio en lista de espera; la lista vigente está en `docs/business-types-catalog.md`.
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

Una variable expresa readiness operativa, no reemplaza el artefacto del mismo gate. Si falta cualquiera de ambos, el informe lo marca (`externalGatesReady: false`, `attestationStructurallyValid: false`): el tier `release` termina en rojo y el deploy ordinario continúa.
