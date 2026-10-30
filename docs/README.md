# Parallext Engine — Documentación

_Última actualización: 2026-10-08_

Índice completo de `docs/`, agrupado por tema. [`../CLAUDE.md`](../CLAUDE.md) mantiene una **selección** del mismo índice para el contexto de los agentes de código (`## Documentation Index`); **este README es la lista completa**: cuando agregues o archives un documento, agrégalo aquí y, si es de los que un agente debe leer, también en `CLAUDE.md`.

> **Convención de estado:** los documentos vivos reflejan el código actual. Los históricos o superseded llevan un banner «Documento histórico (fecha) — no refleja el estado actual» o viven en [`archive/`](archive/) con banner **ARCHIVADO**. En las tablas de abajo, **(histórico)** significa «foto de una fecha»: no lo tomes como estado vigente.

> **Glosario.** *Vertical* = industria (20 en `VERTICAL_REGISTRY`; 18 se pueden elegir al registrarse). *Tipo de negocio* = perfil industria/subtipo (80 canónicos = 72 seleccionables + 8 en lista de espera; 85 configuraciones resolubles contando 5 `legacy_only`). La lista generada de industrias y tipos de negocio con su disponibilidad es [`business-types-catalog.md`](business-types-catalog.md); las autoridades de código son `apps/api/src/modules/verticals/vertical-definitions.ts` y `packages/shared/src/subtype-experience-profile.ts`.

> **Contadores.** Los números estructurales (módulos, páginas, colas, crons, modelos) cambian con cada release y se copiaban a mano en varios documentos con valores distintos. Se calculan con comandos: la tabla «Counters» de [`../CLAUDE.md`](../CLAUDE.md) trae el valor del 2026-10-08 y cómo recalcularlo. No copies esas cifras a documentos nuevos.

---

## Base de conocimiento aprobada (K1)

Solo entra lo aprobado; lo que se puede contar se **genera** y la CI lo verifica. Cada documento dice su fuente de verdad en código.

| Documento | Dueño | Estado | Última revisión | Fuente de verdad en código |
|-----------|-------|--------|-----------------|----------------------------|
| [domain/business-requirements-format.md](domain/business-requirements-format.md) | dueño del producto | aprobado (B2 v0.2 + R1) | 2026-10-30 | `packages/business-spec/spec/requirement.schema.json` |
| [domain/business-requirements.md](domain/business-requirements.md) | generado | **generado** (`business-spec docs --write`; `--check` en `verify-artifacts`) | — | `packages/business-spec/spec/*.yaml` |
| [decisions/](decisions/README.md) | dueño del producto | ADR aprobados: 0001 (especificación única), 0002 (D1–D15 y C0 §7) | 2026-10-30 | — |

## Arquitectura y referencia

| Documento | Descripción |
|-----------|-------------|
| [../CLAUDE.md](../CLAUDE.md) | Referencia rápida: arquitectura, convenciones, contadores, selección del índice de docs |
| [architecture-detail.md](architecture-detail.md) | Arquitectura detallada: flujo de mensajes, prompt layers (3), knowledge (5 tiers), LLM Router (routing por tarea, tiers, circuit breaker, cost breaker), auth/sesiones, OAuth, calendario, BullMQ, multi-canal por tipo |
| [modules-reference.md](modules-reference.md) | Inventario técnico de módulos API, páginas dashboard, colas y crons (snapshot; las cifras vigentes están en «Counters» de `CLAUDE.md`) |
| [API_REFERENCE.md](API_REFERENCE.md) | Endpoints REST (todos bajo `/api/v1`) de los módulos principales, eventos WebSocket y colas; no es exhaustivo |
| [agent-quality-center.md](agent-quality-center.md) | Contrato del Centro de calidad: tres pilares, estados, atribución, evidencia y bucle de mejora seguro |
| [product-capabilities-reference.md](product-capabilities-reference.md) | Mapa canónico de superficies, roles, planes y navegación |
| [business-types-catalog.md](business-types-catalog.md) | Catálogo generado de las 20 industrias y los 80 tipos de negocio (seleccionables, en espera, legacy) |
| [platform-assistant-knowledge.md](platform-assistant-knowledge.md) | Fuente runtime, alcance y proceso de publicación de Parallly Assist |
| [analytics-billing-reference.md](analytics-billing-reference.md) | Snapshot técnico de analytics/billing; precios, cuotas y features deben verificarse en `billing_plans` runtime |
| [product-decision-ledger-2026-08-24.md](product-decision-ledger-2026-08-24.md) | Registro fechado de 34 decisiones de producto de la intervención vertical |
| [../apps/api/CLAUDE.md](../apps/api/CLAUDE.md) · [../apps/dashboard/CLAUDE.md](../apps/dashboard/CLAUDE.md) · [../apps/whatsapp/CLAUDE.md](../apps/whatsapp/CLAUDE.md) | Contexto por app |

## Agente de IA, calidad y Assist

| Documento | Descripción |
|-----------|-------------|
| [agent-platform-visual-review-2026-09-07.md](archive/2026-09-agente/agent-platform-visual-review-2026-09-07.md) | Revisión visual local del agente (7-sep-2026; **(histórico)**) |

## Facturación & Billing

| Documento | Descripción |
|-----------|-------------|
| [billing-annual-cycle.md](billing-annual-cycle.md) | Ciclo mensual/anual del motor Wompi, cambios de plan y billing-ops cross-tenant |
| [billing-runbook.md](billing-runbook.md) · [wompi-integration-validation-2026-08.md](archive/2026-08-pagos/wompi-integration-validation-2026-08.md) | Runbook Wompi/DIAN y dictamen integral; Mercado Pago queda sólo para cobros tenant → cliente |
| [tenant-customer-payments-wompi.md](tenant-customer-payments-wompi.md) ·  | Cobro tenant-owned (Wompi/Mercado Pago del tenant): diseño, certificación y auditoría para el dueño |
| [stripe-international-subscriptions-2026-09.md](stripe-international-subscriptions-2026-09.md) | Suscripciones internacionales con Stripe |
| [mercadopago-retirement-2026-08.md](mercadopago-retirement-2026-08.md) | Retiro de Mercado Pago como PSP de plataforma |
| [plan-profitability-2026-07.md](archive/2026-08-pagos/plan-profitability-2026-07.md) | Análisis de rentabilidad y precios COP por país |
| [facturacion-electronica-colombia-2026-06.md](archive/2026-08-pagos/facturacion-electronica-colombia-2026-06.md) | Facturación electrónica DIAN (Colombia) vía Factus |
| [whatsapp-meta-pricing-2026-10.md](whatsapp-meta-pricing-2026-10.md) | Meta cobra el mensaje de servicio de WhatsApp desde el 1-oct-2026 |

## Canales, comunicaciones y SMS

| Documento | Descripción |
|-----------|-------------|
| [multi-channel-per-type-implementation-2026-07.md](multi-channel-per-type-implementation-2026-07.md) | Multi-cuenta por tipo de canal (N conexiones del mismo tipo, agente por conexión) |
| [coexistence-manual.md](coexistence-manual.md) | Coexistencia WhatsApp (Embedded Signup + migración de historial) |
| [email-channel-reopening-adr-2026-08-24.md](email-channel-reopening-adr-2026-08-24.md) | ADR: reapertura de Email como canal conversacional self-service |
| [platform-communications.md](platform-communications.md) ·  | Comunicaciones generales de la plataforma a los tenants y el aviso de Meta del 1-oct-2026 (4 idiomas) |
| [sms-monetization-packages-2026-07.md](archive/2026-07-sms/sms-monetization-packages-2026-07.md) ·  | SMS: créditos reseller y notificaciones. **(histórico)** El producto SMS está **retirado** (`sms_product_retired`, `sms-kill-switch.service.ts`) |

## Operaciones & Infraestructura

| Documento | Descripción |
|-----------|-------------|
| [operations-runbook.md](operations-runbook.md) | Runbook de operaciones + Ops Center (platform-monitor) |
| [observability-manual.md](observability-manual.md) | Observabilidad, salud de proveedores LLM |
| [backup-restore-runbook.md](backup-restore-runbook.md) · [backup-offsite-setup.md](backup-offsite-setup.md) | Backup/restore (verificación, drills, postmortems) + offsite (R2/S3) |
| [deploy-hardening-runbook.md](deploy-hardening-runbook.md) | Hardening del deploy (SSH key-only, throttling por IP real, backup pre-migración) |
| [runbooks/](runbooks/) | Runbooks puntuales: preflight de términos aceptados, carga y SLOs del despacho, reconciliación del despacho, suite completa de la API, cambio de plataforma de octubre, calidad de recuperación (RAG) |
| [server-installation.md](server-installation.md) | Instalación de servidor + GitHub Secrets |

## Seguridad

| Documento | Descripción |
|-----------|-------------|
| [security-specification.md](security-specification.md) | Especificación de seguridad (threat model, controles) |
| [superadmin-governance.md](superadmin-governance.md) | Gobernanza super_admin & impersonación (modo plataforma, deny-by-default, sesión emparejada, actor real) |

## Manuales

| Documento | Descripción |
|-----------|-------------|
| [user-manual.md](user-manual.md) | Manual de usuario (tenant) |
| [mobile-user-manual.md](mobile-user-manual.md) | Manual funcional de la app móvil y límites frente a la web |
| [appointments-manual.md](appointments-manual.md) · [analytics-manual.md](analytics-manual.md) · [offboarding-manual.md](offboarding-manual.md) | Citas, analytics, offboarding (manuales técnicos/internos) |
| [vertical-strategy.md](vertical-strategy.md) | Visión de adaptación por vertical (la lista vigente de tipos de negocio está en `business-types-catalog.md`) |

> La base que responde Parallly Assist vive en
> [`../apps/api/kb/assistant/`](../apps/api/kb/assistant/); el manual humano no la
> actualiza automáticamente.

## App móvil (`apps/mobile`, React Native/Expo)

| Documento | Descripción |
|-----------|-------------|
| [mobile-user-manual.md](mobile-user-manual.md) | Uso vigente: acceso, Inbox, CRM, workspace vertical, push y troubleshooting |
| [mobile-eas-build.md](mobile-eas-build.md) · [mobile-sentry-sourcemaps.md](mobile-sentry-sourcemaps.md) | Build EAS y Sentry sourcemaps; el estado de tienda es una foto fechada |
| [mobile-release-2026-09-14.md](archive/2026-09-movil/mobile-release-2026-09-14.md) ·  | Release Android 1.1.1 (14-sep-2026): compatibilidad, R8 y pasos finales de Play Console (**(histórico)**) |

## Programa de verticales (ago–sep 2026)

Para saber **qué tipos de negocio existen hoy** usa [`business-types-catalog.md`](business-types-catalog.md). Los documentos de esta sección son el historial del programa: las cifras que traen (17/18 verticales, 75/76 subtipos, 1.520 escenarios) eran ciertas a su fecha y **no** son las actuales.

| Documento | Descripción |
|-----------|-------------|
| [vertical-approved-implementation-plan-2026-08-24.md](archive/2026-08-verticales/vertical-approved-implementation-plan-2026-08-24.md) | **Plan definitivo** posterior a las decisiones del dueño (24-ago-2026) |
| [vertical-decision-register-2026-08.md](vertical-decision-register-2026-08.md) ·  | Registro final de decisiones y su implementación (**(histórico)**) |
| [vertical-system-audit-2026-08.md](archive/2026-08-verticales/vertical-system-audit-2026-08.md) | Auditoría point-in-time de las 18 verticales (6-ago-2026) |
| [vertical-competitive-matrix-2026-08.md](vertical-competitive-matrix-2026-08.md) ·  | Auditorías competitivas y de prompts/navegación por subtipo (ago-2026; **(histórico)**) |
| `vertical-*-scorecard-2026-08.csv`, `agent-tool-subtype-*-scorecard-2026-08.csv` | Hojas de cálculo del 20-ago-2026 con la taxonomía anterior (76 filas; incluyen legacy y omiten tipos nuevos): **(histórico)** |
| [vertical-provisioning-v2-runbook.md](vertical-provisioning-v2-runbook.md) | Runbook de provisioning vertical v2 |
| [vertical-release-runbook-2026-08.md](vertical-release-runbook-2026-08.md) | Runbook de evidencia para release vertical (el gate estricto vive en `vertical-quality.yml` tier `release`) |

## Onboarding

| Documento | Descripción |
|-----------|-------------|
| [onboarding-decisions-2026-09.md](onboarding-decisions-2026-09.md) · [onboarding-experience-design-2026-09.md](onboarding-experience-design-2026-09.md) · [onboarding-diagnosis-2026-09.md](archive/2026-09-onboarding/onboarding-diagnosis-2026-09.md) | Generación vigente (sep-2026): decisiones, diseño de la experiencia guiada y diagnóstico tras el video real |
| [onboarding-experience-plan-v2-2026-09.md](archive/2026-09-onboarding/onboarding-experience-plan-v2-2026-09.md) · [onboarding-review-and-completion-plan-2026-09-18.md](archive/2026-09-onboarding/onboarding-review-and-completion-plan-2026-09-18.md) · [onboarding-implementation-closeout-2026-09-18.md](onboarding-implementation-closeout-2026-09-18.md) | Propuesta v2, revisión y cierre de implementación (17–18 sep-2026), los más recientes |
| [onboarding-ux-benchmark-and-video-audit.md](archive/2026-09-onboarding/onboarding-ux-benchmark-and-video-audit.md) · `onboarding-diagnosis-2026-09-workdir/` | Borradores de investigación con nota de verificación (cifras sin fuente primaria) |

## Estrategia & Research

| Documento | Descripción |
|-----------|-------------|
| [research/](research/) | Investigación de septiembre 2026 (precios de Meta, rentabilidad por plan, posicionamiento y landing) |

## Auditorías y handoffs de septiembre 2026 (**histórico**)

| Carpeta | Descripción |
|---------|-------------|
| [audits/](audits/) | Evidencia y cierres del programa de certificación de sep-2026 (`2026-09-05` … `2026-09-14`). Son fotos fechadas: cada documento lleva su banner «Documento histórico». Los marcados «generado» (`closure-report`, `closure-state`, `certification-manifest`, `tool-profile-audit`, `outbound-producer-inventory`, `competence-matrix`) se regeneran con su script y no se editan a mano: `npm run verify:artifacts` |
| [handoffs/](handoffs/) | Instrucciones que se pasaron entre agentes (8–12 sep-2026). **No son directivas vigentes**: lo que dicen sobre «no hagas push/merge/deploy» ya no aplica; desde el 7-oct-2026 el merge con CI verde despliega solo |

## Archivado (histórico / superseded)

Documentos point-in-time o reemplazados, en [`archive/`](archive/). Se conservan como referencia; **no reflejan el estado actual**.

| Documento | Motivo |
|-----------|--------|
| [archive/billing-plan.md](archive/billing-plan.md) ·  | Snapshot abr-2026 (matriz viva = `apps/api/prisma/seed-billing-plans.js`) y setup de Mercado Pago (retirado) |

## Otros

| Documento | Descripción |
|-----------|-------------|
| [vertical-competitive-evidence.json](vertical-competitive-evidence.json) · [vertical-release-evidence.schema.json](vertical-release-evidence.schema.json) | Datos de trabajo y esquema de evidencia de release vertical |
