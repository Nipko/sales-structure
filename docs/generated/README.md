# Documentos generados

Todo dato estructural que se puede contar (tipos de negocio, requisitos por tipo, estado de cierre, manifiestos, auditorías de herramientas) se **genera** desde el código y la CI comprueba que no esté desfasado (`npm run verify:artifacts`, que corre en `deploy.yml`, `candidate.yml` y `vertical-quality.yml`). No se editan a mano.

Esta carpeta es el destino acordado (ADR 0005). Los generados del cierre de octubre viven aquí; sus generadores y el verificador compartido viven en `apps/api/scripts/artifacts/`. Los dos catálogos de dominio se quedan en `domain/` porque son documentos de lectura diaria. `deploy.yml` todavía llama `docs/audits/2026-09-09/verify-artifacts.cjs`, que solo reenvía al verificador nuevo.

| Artefacto | Ubicación | Generador | Comprobación |
|---|---|---|---|
| Catálogo de industrias y tipos de negocio | [`../domain/business-types-catalog.md`](../domain/business-types-catalog.md) | `apps/api/scripts/business-types-catalog.cjs --write` | `--check` desde `verify-artifacts` |
| Requisitos del negocio por tipo | [`../domain/business-requirements.md`](../domain/business-requirements.md) | `packages/business-spec` (`business-spec docs --write`) | `--check` desde `verify-artifacts` |
| Estado de cierre | [`closure-state.md`](closure-state.md) · [`.json`](closure-state.json) | `apps/api/scripts/artifacts/generate-closure-state.cjs` | `verify-artifacts` |
| Manifiesto de certificación | [`certification-manifest.md`](certification-manifest.md) · [`.json`](certification-manifest.json) | `apps/api/scripts/artifacts/generate-certification-manifest.cjs` | `verify-artifacts` |
| Reporte de cierre (lo lee la landing) | [`closure-report.md`](closure-report.md) · [`.json`](closure-report.json) | `apps/api/scripts/artifacts/generate-closure-report.cjs` (filas en `meta-october-rows.cjs`, `tools-programme-rows.cjs`, `landing-programme-rows.cjs`) | `verify-artifacts` |
| Auditoría de perfiles de herramientas | [`tool-profile-audit.md`](tool-profile-audit.md) · [`.json`](tool-profile-audit.json) | `apps/api/scripts/artifacts/generate-tool-profile-audit.cjs --write` | `verify-artifacts` |
| Inventario de productores salientes | [`outbound-producer-inventory.md`](outbound-producer-inventory.md) | `apps/api/scripts/outbound-producer-inventory.cjs` | `--check` en `candidate.yml` y `vertical-quality.yml`; comparado por `meta-october-rows.cjs` |
| Tabla de tarifas de WhatsApp | `apps/api/src/modules/billing/whatsapp-rates/whatsapp-rate-table.generated.ts` (insumos en `apps/api/data/whatsapp-rates/`) | `apps/api/scripts/generate-whatsapp-rates.cjs` | `--check` en `candidate.yml` y `vertical-quality.yml` |

Las cifras del canario de certificación que citan los documentos se comprueban con `node apps/api/scripts/check-canary-figures.cjs --check` sobre **todo** `docs/**/*.md`.
