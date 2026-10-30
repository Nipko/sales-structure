# Documentos generados

Todo dato estructural que se puede contar (tipos de negocio, requisitos por tipo, estado de cierre, manifiestos, auditorías de herramientas) se **genera** desde el código y la CI comprueba que no esté desfasado (`npm run verify:artifacts`, que corre en `deploy.yml`, `candidate.yml` y `vertical-quality.yml`). No se editan a mano.

Esta carpeta es el destino acordado (ADR 0005). Hoy los generados viven donde sus generadores y la CI los esperan; moverlos exige cambiar rutas en los generadores, `verify-artifacts.cjs`, `check-canary-figures.cjs`, `Dockerfile.landing`, la landing y varios specs, y se hará en un PR propio.

| Artefacto | Ubicación actual | Generador | Comprobación |
|---|---|---|---|
| Catálogo de industrias y tipos de negocio | [`../domain/business-types-catalog.md`](../domain/business-types-catalog.md) | `apps/api/scripts/business-types-catalog.cjs --write` | `--check` desde `verify-artifacts` |
| Requisitos del negocio por tipo | [`../domain/business-requirements.md`](../domain/business-requirements.md) | `packages/business-spec` (`business-spec docs --write`) | `--check` desde `verify-artifacts` |
| Estado de cierre, manifiesto de certificación, reporte de cierre | `../audits/2026-09-09/closure-*`, `certification-manifest.*` | `docs/audits/2026-09-09/generate-*.cjs` | `verify-artifacts` |
| Auditoría de perfiles de herramientas | `../audits/2026-09-11/tool-profile-audit.*` | `docs/audits/2026-09-11/generate-tool-profile-audit.cjs` | `verify-artifacts` |
| Inventario de productores salientes | `../audits/2026-09-10/outbound-producer-inventory.md` | `apps/api/scripts/outbound-producer-inventory.cjs` | comparado por `meta-october-rows.cjs` |
| Tabla de tarifas de WhatsApp | `apps/api/src/modules/billing/whatsapp-rates/` (insumos en `../research/2026-09-10/`) | `apps/api/scripts/generate-whatsapp-rates.cjs` | `--check` en `candidate.yml` y `vertical-quality.yml` |

Las cifras del canario de certificación que citan los documentos se comprueban con `node apps/api/scripts/check-canary-figures.cjs --check` sobre **todo** `docs/**/*.md`.
