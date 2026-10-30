# Parallext Engine — Base de conocimiento

_Índice único de `docs/`. Última reorganización: 2026-10-30 (K3, [ADR 0005](decisions/0005-base-de-conocimiento-y-limpieza-k3.md))._

Contexto para agentes de código: [`../AGENTS.md`](../AGENTS.md) (`CLAUDE.md` solo lo importa). Ayuda al usuario final que llega al producto: la KB de Parallly Assist en [`../apps/api/kb/assistant/`](../apps/api/kb/assistant/) ([contrato](architecture/platform-assistant-knowledge.md)).

## Reglas de la base (K1–K4)

1. **Solo entra lo aprobado y vigente.** Planes ejecutados, auditorías fechadas, handoffs, borradores e investigación no entran: se borran (git conserva el historial) o, si algo vigente los cita, van a [`archive/`](archive/README.md).
2. **Lo que se puede contar se genera** y la CI lo comprueba ([`generated/`](generated/README.md)). No copies contadores ni listas a mano.
3. **Una fuente por tema.** Las decisiones viven como ADR en [`decisions/`](decisions/README.md).
4. **Regla de cierre (K4):** un cambio no está terminado si no actualiza el documento que corresponde aquí y retira lo que reemplaza.
5. **Revisión:** cada documento declara su última modificación de contenido. Si pasan **90 días** sin revisarlo, figura como «revisar» y se valida contra el código antes de confiar en él.

Dueño de todos los documentos: el dueño del producto, salvo los **generados**, cuyo dueño es su generador.

> **Glosario.** *Vertical* = industria (20 en `VERTICAL_REGISTRY`; 18 se pueden elegir al registrarse). *Tipo de negocio* = perfil industria/subtipo (80 canónicos = 72 seleccionables + 8 en lista de espera; 85 configuraciones resolubles contando 5 `legacy_only`). La lista generada es [`domain/business-types-catalog.md`](domain/business-types-catalog.md).

---

## Decisiones — [`decisions/`](decisions/README.md)

| Documento | Contenido | Estado | Últ. cambio | Fuente de verdad en código |
|---|---|---|---|---|
| [0001](decisions/0001-especificacion-unica.md) | Especificación de requisitos del negocio como fuente única | aprobada | 2026-10-30 | `packages/business-spec/` |
| [0002](decisions/0002-decisiones-d1-d15-y-c0.md) | Decisiones D1–D15 y respuestas C0 §7 | aprobada | 2026-10-30 | `packages/business-spec/spec/` |
| [0003](decisions/0003-subtipos-e-interpretaciones-r1.md) | Subtipos sin perfil e interpretaciones fijadas en R1 | aprobada | 2026-10-30 | `packages/business-spec/spec/` |
| [0005](decisions/0005-base-de-conocimiento-y-limpieza-k3.md) | Estructura de la base de conocimiento aprobado y limpieza K3 | aprobada | 2026-10-30 | — |
| [previas/](decisions/previas/) | Registros de decisión anteriores al formato ADR: retiro de Mercado Pago, Email fuera del self-service, ledger de 34 decisiones de producto, registro de decisiones de verticales, decisiones de onboarding. Vigentes salvo que un ADR los reemplace; pendientes de convertir a ADR | vigente | 2026-08-08 … 2026-09-18 | `demo-allowance.service.ts` cita D19 |

## Dominio — [`domain/`](domain/)

| Documento | Contenido | Estado | Últ. cambio | Fuente de verdad en código |
|---|---|---|---|---|
| [business-requirements-format.md](domain/business-requirements-format.md) | Formato de la especificación de requisitos (B2 v0.2 + R1) | aprobado | 2026-10-30 | `packages/business-spec/spec/requirement.schema.json` |
| [business-requirements.md](domain/business-requirements.md) | Requisitos por tipo de negocio | **generado** | — | `packages/business-spec/spec/*.yaml` |
| [business-readiness-runtime.md](domain/business-readiness-runtime.md) | Preparación del negocio en ejecución: API, historial, caché y panel (R2); valores con procedencia, migración L1–L7 y retiro de las reglas L (R3) | vigente | 2026-10-30 | `apps/api/src/modules/readiness/`, `packages/business-spec/src/{provenance,backfill,validate-value}.ts`, `apps/api/scripts/readiness/`, `apps/dashboard/src/app/admin/readiness/` |
| [business-types-catalog.md](domain/business-types-catalog.md) | 20 industrias y 80 tipos de negocio: seleccionables, en espera, legacy | **generado** | — | `vertical-definitions.ts`, `subtype-experience-profile.ts` |
| [billing-annual-cycle.md](domain/billing-annual-cycle.md) | Ciclo mensual/anual del motor Wompi, cambios de plan, billing-ops | vigente | 2026-09-19 | `modules/billing/recurring/` |
| [stripe-international-subscriptions-2026-09.md](domain/stripe-international-subscriptions-2026-09.md) | Suscripciones fuera de Colombia con Stripe | vigente | 2026-09-30 | `modules/billing/payment-routing.service.ts` |
| [tenant-customer-payments-wompi.md](domain/tenant-customer-payments-wompi.md) | Cobro del negocio a su cliente con su propia cuenta Wompi / Mercado Pago | vigente | 2026-08-17 | `modules/tenant-payments/` |
| [whatsapp-meta-pricing-2026-10.md](domain/whatsapp-meta-pricing-2026-10.md) | Meta cobra el mensaje de servicio desde el 1-oct-2026 | vigente | 2026-09-13 | `whatsapp-funding-readiness.ts`, `billing/whatsapp-rates/` |
| [coexistence-manual.md](domain/coexistence-manual.md) | Coexistencia WhatsApp Business App ↔ Cloud API | vigente | 2026-10-08 | `apps/whatsapp/`, `channel-certification-matrix.ts` |
| [onboarding-experience-design-2026-09.md](domain/onboarding-experience-design-2026-09.md) | Diseño de la configuración guiada (incluye la lista de jerga prohibida) | vigente | 2026-09-18 | `apps/dashboard/src/lib/i18n-parity.spec.ts` |
| [onboarding-implementation-closeout-2026-09-18.md](domain/onboarding-implementation-closeout-2026-09-18.md) | Cierre de implementación del onboarding de septiembre | vigente | 2026-09-18 | — |
| [vertical-strategy.md](domain/vertical-strategy.md) | Visión de adaptación por vertical (la lista vigente es el catálogo generado) | vigente | 2026-10-08 | — |
| [analytics-manual.md](domain/analytics-manual.md) | Analytics, alertas, BI API, anomalías, cohortes | vigente | 2026-08-24 | `modules/analytics/` |
| [user-manual.md](domain/user-manual.md) | Manual web para tenants | **pendiente de decisión**: la ayuda que llega al producto es la KB de Assist; decidir si este manual se mantiene o se retira | 2026-10-08 | `apps/api/kb/assistant/` |
| [mobile-user-manual.md](domain/mobile-user-manual.md) | Manual funcional de la app móvil | vigente | 2026-09-14 | `apps/mobile/` |
| [appointments-manual.md](appointments-manual.md) | Citas (sigue en la raíz de `docs/` porque lo copia `Dockerfile.landing`) | vigente | 2026-10-09 | `modules/appointments/` |

## Arquitectura — [`architecture/`](architecture/)

| Documento | Contenido | Estado | Últ. cambio | Fuente de verdad en código |
|---|---|---|---|---|
| [architecture-detail.md](architecture/architecture-detail.md) | Flujo de mensajes, capas de prompt, conocimiento, router LLM, auth, OAuth, calendario, BullMQ | vigente | 2026-08-11 | `modules/conversations/`, `modules/ai/` |
| [modules-reference.md](architecture/modules-reference.md) | Inventario de módulos, páginas, colas y crons | snapshot (cifras: «Counters» de `AGENTS.md`) | 2026-10-08 | `apps/api/src/modules/` |
| [api-reference.md](architecture/api-reference.md) | Endpoints REST principales, WebSocket y colas; no exhaustivo. La API pública está en Swagger `/docs/public` | vigente | 2026-10-30 | controllers; `main.ts` (Swagger) |
| [product-capabilities-reference.md](architecture/product-capabilities-reference.md) | Superficies, roles, planes y navegación | vigente | 2026-10-08 | `packages/shared/src/dashboard-page-access.ts` |
| [agent-quality-center.md](architecture/agent-quality-center.md) | Centro de calidad: pilares, estados, atribución y bucle de mejora | vigente | 2026-10-08 | `modules/quality/` |
| [platform-assistant-knowledge.md](architecture/platform-assistant-knowledge.md) | Fuente runtime, alcance y publicación de Parallly Assist | vigente | 2026-09-17 | `apps/api/kb/assistant/` |
| [analytics-billing-reference.md](architecture/analytics-billing-reference.md) | Referencia técnica de analytics y billing (precios: `billing_plans`) | snapshot | 2026-10-08 | `modules/analytics/`, `modules/billing/` |
| [multi-channel-per-type-implementation-2026-07.md](architecture/multi-channel-per-type-implementation-2026-07.md) | N conexiones del mismo tipo, agente por conexión | vigente | 2026-08-11 | `channel-certification-matrix.ts` |

## Seguridad — [`security/`](security/)

| Documento | Contenido | Estado | Últ. cambio | Fuente de verdad en código |
|---|---|---|---|---|
| [security-specification.md](security/security-specification.md) | Especificación de seguridad (incluye el antiguo `SECURITY.md` como Anexo A) y hallazgos pendientes | vigente | 2026-10-30 | `modules/auth/`, `common/guards/` |
| [superadmin-governance.md](security/superadmin-governance.md) | Modo plataforma, deny-by-default, impersonación con motivo y actor real | vigente | 2026-09-30 | `apps/dashboard/src/lib/roles.ts`, `dashboard-page-access.ts` |

## Operación — [`operations/`](operations/)

| Documento | Contenido | Estado | Últ. cambio | Fuente de verdad en código |
|---|---|---|---|---|
| [operations-runbook.md](operations/operations-runbook.md) | Ciclo de vida del tenant, canales, Ops Center, scripts de auditoría de billing | vigente | 2026-10-30 | `health/platform-monitor.service.ts` |
| [observability-manual.md](operations/observability-manual.md) | Logs, Bull Board, Grafana/Loki, Uptime Kuma, salud de proveedores LLM | vigente | 2026-09-12 | `infra/docker/docker-compose.prod.yml` |
| [backup-restore-runbook.md](operations/backup-restore-runbook.md) | Backup, restore, simulacros y postmortem del exec-bit | **revisar** (>90 días) | 2026-07-23 | `infra/backup/` |
| [backup-offsite-setup.md](operations/backup-offsite-setup.md) | Copia offsite (R2/S3) con rclone | **revisar** (>90 días) | 2026-07-21 | `infra/backup/backup.sh` |
| [deploy-hardening-runbook.md](operations/deploy-hardening-runbook.md) | SSH solo con llave, throttling por IP real, backup previo a migrar, expand-contract (§6) | **revisar** (>90 días) | 2026-07-24 | `.github/workflows/deploy.yml` |
| [server-installation.md](operations/server-installation.md) | Instalación de un servidor nuevo y GitHub Secrets | vigente | 2026-10-30 | `infra/scripts/setup-vps.sh` |
| [billing-runbook.md](operations/billing-runbook.md) | Wompi, DIAN y enlaces de cobro del tenant | vigente | 2026-09-30 | `modules/billing/` |
| [offboarding-manual.md](operations/offboarding-manual.md) | Baja de tenants | vigente | 2026-08-15 | `modules/offboarding/` |
| [platform-communications.md](operations/platform-communications.md) | Comunicaciones de la plataforma a los tenants | vigente | 2026-09-30 | `modules/platform-communications/` |
| [vertical-provisioning-v2-runbook.md](operations/vertical-provisioning-v2-runbook.md) | Provisioning vertical v2 | vigente | 2026-08-10 | `apps/api/scripts/reconcile-vertical-provisioning.js` |
| [vertical-release-runbook-2026-08.md](operations/vertical-release-runbook-2026-08.md) · [schema](operations/vertical-release-evidence.schema.json) | Evidencia para release vertical (tier `release` de `vertical-quality.yml`) | vigente | 2026-10-08 | `apps/api/scripts/run-vertical-release-readiness.cjs` |
| [mobile-eas-build.md](operations/mobile-eas-build.md) · [mobile-sentry-sourcemaps.md](operations/mobile-sentry-sourcemaps.md) | Build EAS y sourcemaps de Sentry de la app móvil | vigente / **revisar** (sourcemaps, >90 días) | 2026-09-14 / 2026-06-05 | `apps/mobile/eas.json` |
| [runbooks/](operations/runbooks/) | Release móvil, preflight de términos aceptados, carga y SLO del despacho, reconciliación del despacho, suite completa de la API, cambio de plataforma de octubre, calidad de recuperación (RAG) | vigente | 2026-09-09 … 2026-10-30 | `cutover-script.spec.ts` y `generate-closure-report.cjs` leen dos de ellos |

## Generados — [`generated/`](generated/README.md)

Artefactos generados, su generador y su comprobación en CI. Hoy viven junto a sus generadores (ver esa página).

## Fuera de la base aprobada

| Carpeta | Qué es | Por qué sigue en el repositorio |
|---|---|---|
| [archive/](archive/README.md) | Históricos citados por un documento vivo o por código | Evidencia; no reflejan el estado actual |
| [audits/](audits/) (`2026-09-09` … `2026-09-12`) | Evidencia y cierres de la certificación de septiembre | La CI los lee (`verify-artifacts`, `check-canary-figures`, landing). Se reubicarán junto con los generados |
| [handoffs/2026-09-10/](handoffs/2026-09-10/) | Instrucciones entre agentes de septiembre. **No son directivas vigentes** | `check-canary-figures.cjs` y `closure-artefact-generators.spec.ts` citan dos; los demás los citan esos mismos documentos |
| [research/2026-09-10/](research/2026-09-10/) | Tarifas oficiales de Meta (insumo de producto) e investigación de landing | `generate-whatsapp-rates.cjs` lee las tarjetas de tarifas; pendiente moverlas a `apps/api/data/` |
| [vertical-competitive-matrix-2026-08.md](vertical-competitive-matrix-2026-08.md) · [vertical-competitive-evidence.json](vertical-competitive-evidence.json) | Evidencia competitiva de la landing | `Dockerfile.landing` y `validate-competitive-evidence.cjs` |
