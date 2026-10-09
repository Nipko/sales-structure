# Parallext Engine — Documentación

_Última actualización: 2026-10-08_

Índice completo de `docs/`, agrupado por tema. [`../CLAUDE.md`](../CLAUDE.md) mantiene una **selección** del mismo índice para el contexto de los agentes de código (`## Documentation Index`); **este README es la lista completa**: cuando agregues o archives un documento, agrégalo aquí y, si es de los que un agente debe leer, también en `CLAUDE.md`.

> **Convención de estado:** los documentos vivos reflejan el código actual. Los históricos o superseded llevan un banner «Documento histórico (fecha) — no refleja el estado actual» o viven en [`archive/`](archive/) con banner **ARCHIVADO**. En las tablas de abajo, **(histórico)** significa «foto de una fecha»: no lo tomes como estado vigente.

> **Glosario.** *Vertical* = industria (20 en `VERTICAL_REGISTRY`; 18 se pueden elegir al registrarse). *Tipo de negocio* = perfil industria/subtipo (80 canónicos = 72 seleccionables + 8 en lista de espera; 85 configuraciones resolubles contando 5 `legacy_only`). La lista generada de industrias y tipos de negocio con su disponibilidad es [`business-types-catalog.md`](business-types-catalog.md); las autoridades de código son `apps/api/src/modules/verticals/vertical-definitions.ts` y `packages/shared/src/subtype-experience-profile.ts`.

> **Contadores.** Los números estructurales (módulos, páginas, colas, crons, modelos) cambian con cada release y se copiaban a mano en varios documentos con valores distintos. Se calculan con comandos: la tabla «Counters» de [`../CLAUDE.md`](../CLAUDE.md) trae el valor del 2026-10-08 y cómo recalcularlo. No copies esas cifras a documentos nuevos.

---

## Arquitectura y referencia

| Documento | Descripción |
|-----------|-------------|
| [../CLAUDE.md](../CLAUDE.md) | Referencia rápida: arquitectura, convenciones, contadores, selección del índice de docs |
| [architecture-detail.md](architecture-detail.md) | Arquitectura detallada: flujo de mensajes, prompt layers (3), knowledge (5 tiers), LLM Router (routing por tarea, tiers, circuit breaker, cost breaker), auth/sesiones, OAuth, calendario, BullMQ, multi-canal por tipo |
| [modules-reference.md](modules-reference.md) | Inventario técnico de módulos API, páginas dashboard, colas y crons (snapshot; las cifras vigentes están en «Counters» de `CLAUDE.md`) |
| [API_REFERENCE.md](API_REFERENCE.md) | Endpoints REST (todos bajo `/api/v1`) de los módulos principales, eventos WebSocket y colas; no es exhaustivo |
| [agent-quality-center.md](agent-quality-center.md) | Contrato del Centro de calidad: tres pilares, estados, atribución, evidencia y bucle de mejora seguro |
| [dashboard-navigation-architecture-2026-08.md](dashboard-navigation-architecture-2026-08.md) | Contratos técnicos de navegación tenant (orden, retorno, tour, acceso); los grupos vigentes del menú están en `product-capabilities-reference.md` |
| [product-capabilities-reference.md](product-capabilities-reference.md) | Mapa canónico de superficies, roles, planes y navegación |
| [business-types-catalog.md](business-types-catalog.md) | Catálogo generado de las 20 industrias y los 80 tipos de negocio (seleccionables, en espera, legacy) |
| [platform-assistant-knowledge.md](platform-assistant-knowledge.md) | Fuente runtime, alcance y proceso de publicación de Parallly Assist |
| [data-dictionary.md](data-dictionary.md) · [database-schema.dbml](database-schema.dbml) | Diccionario de datos y ERD (schema público + por-tenant); **desactualizados desde julio**, la fuente es `prisma/schema.prisma` + migraciones (ver el banner de cada uno) |
| [analytics-billing-reference.md](analytics-billing-reference.md) | Snapshot técnico de analytics/billing; precios, cuotas y features deben verificarse en `billing_plans` runtime |
| [CHANGELOG.md](CHANGELOG.md) | Historial de cambios por sesión (congelado en ago-2026; después, releases y PRs de GitHub) |
| [product-decision-ledger-2026-08-24.md](product-decision-ledger-2026-08-24.md) | Registro fechado de 34 decisiones de producto de la intervención vertical |
| [../apps/api/CLAUDE.md](../apps/api/CLAUDE.md) · [../apps/dashboard/CLAUDE.md](../apps/dashboard/CLAUDE.md) · [../apps/whatsapp/CLAUDE.md](../apps/whatsapp/CLAUDE.md) | Contexto por app |

## Agente de IA, calidad y Assist

| Documento | Descripción |
|-----------|-------------|
| [agent-reliability-diagnosis-2026-08.md](agent-reliability-diagnosis-2026-08.md) | Diagnóstico y estrategia del agente (ago-2026) |
| [agent-audit-decente-2026-08.md](agent-audit-decente-2026-08.md) · [agent-system-analysis-2026-08.md](agent-system-analysis-2026-08.md) | Scorecard de experiencia y análisis previo del sistema (ago-2026; **(histórico)**) |
| [agent-runtime-learning-plan-2026-09-05.md](agent-runtime-learning-plan-2026-09-05.md) · [agent-platform-implementation-progress.md](agent-platform-implementation-progress.md) | Plan de operación, competencia y aprendizaje del agente y su avance de ejecución (sep-2026) |
| [agent-platform-visual-review-2026-09-07.md](agent-platform-visual-review-2026-09-07.md) | Revisión visual local del agente (7-sep-2026; **(histórico)**) |
| [assist-quality-guided-tours-plan-2026-09.md](assist-quality-guided-tours-plan-2026-09.md) · [assist-agent-experience-audit-2026-09-05.md](assist-agent-experience-audit-2026-09-05.md) | Assist veraz, recorridos guiados y validación integral de Assist (sep-2026) |
| [catalog-orders-runtime-review-2026-09-07.md](catalog-orders-runtime-review-2026-09-07.md) · [repair-orders-runtime-review-2026-09-07.md](repair-orders-runtime-review-2026-09-07.md) | Revisión del ciclo canónico de catálogo/pedidos y de taller (7-sep-2026; **(histórico)**) |
| [knowledge-conflict-review-2026-09-07.md](knowledge-conflict-review-2026-09-07.md) · [knowledge-memory-publication-review-2026-09-07.md](knowledge-memory-publication-review-2026-09-07.md) · [learning-operation-evidence-review-2026-09-07.md](learning-operation-evidence-review-2026-09-07.md) | Revisiones D1/D2 de conocimiento y evidencia de aprendizaje (7-sep-2026; **(histórico)**) |
| [help-panel-audit-2026-06.md](help-panel-audit-2026-06.md) · [help-gifs-todo.md](help-gifs-todo.md) | Auditoría del panel de ayuda (jun-2026) y GIFs pendientes |

## Facturación & Billing

| Documento | Descripción |
|-----------|-------------|
| [billing-annual-cycle.md](billing-annual-cycle.md) | Ciclo mensual/anual del motor Wompi, cambios de plan y billing-ops cross-tenant |
| [billing-runbook.md](billing-runbook.md) · [wompi-integration-validation-2026-08.md](wompi-integration-validation-2026-08.md) | Runbook Wompi/DIAN y dictamen integral; Mercado Pago queda sólo para cobros tenant → cliente |
| [tenant-customer-payments-wompi.md](tenant-customer-payments-wompi.md) · [tenant-payments-audit-2026-08.md](tenant-payments-audit-2026-08.md) | Cobro tenant-owned (Wompi/Mercado Pago del tenant): diseño, certificación y auditoría para el dueño |
| [stripe-international-subscriptions-2026-09.md](stripe-international-subscriptions-2026-09.md) | Suscripciones internacionales con Stripe |
| [mercadopago-retirement-2026-08.md](mercadopago-retirement-2026-08.md) | Retiro de Mercado Pago como PSP de plataforma |
| [payments-audit-2026-08.md](payments-audit-2026-08.md) | Auditoría del sistema de pagos (31-ago-2026) |
| [pasarela-wompi-research-2026-08.md](pasarela-wompi-research-2026-08.md) · [wompi-provider-routing-implementation-plan-2026-08.md](wompi-provider-routing-implementation-plan-2026-08.md) · [merchant-of-record-research-2026-08.md](merchant-of-record-research-2026-08.md) | Investigación Wompi, plan de ejecución con operador conmutable y Merchant of Record (ago-2026) |
| [plan-profitability-2026-07.md](plan-profitability-2026-07.md) | Análisis de rentabilidad y precios COP por país |
| [facturacion-electronica-colombia-2026-06.md](facturacion-electronica-colombia-2026-06.md) | Facturación electrónica DIAN (Colombia) vía Factus |
| [whatsapp-meta-pricing-2026-10.md](whatsapp-meta-pricing-2026-10.md) | Meta cobra el mensaje de servicio de WhatsApp desde el 1-oct-2026 |

## Canales, comunicaciones y SMS

| Documento | Descripción |
|-----------|-------------|
| [multi-channel-per-type-implementation-2026-07.md](multi-channel-per-type-implementation-2026-07.md) | Multi-cuenta por tipo de canal (N conexiones del mismo tipo, agente por conexión) |
| [coexistence-manual.md](coexistence-manual.md) | Coexistencia WhatsApp (Embedded Signup + migración de historial) |
| [email-channel-reopening-adr-2026-08-24.md](email-channel-reopening-adr-2026-08-24.md) | ADR: reapertura de Email como canal conversacional self-service |
| [platform-communications.md](platform-communications.md) · [communications/meta-whatsapp-2026-10/](communications/meta-whatsapp-2026-10/) | Comunicaciones generales de la plataforma a los tenants y el aviso de Meta del 1-oct-2026 (4 idiomas) |
| [sms-monetization-packages-2026-07.md](sms-monetization-packages-2026-07.md) · [sms-notifications-implementation-plan-2026-07.md](sms-notifications-implementation-plan-2026-07.md) | SMS: créditos reseller y notificaciones. **(histórico)** El producto SMS está **retirado** (`sms_product_retired`, `sms-kill-switch.service.ts`) |

## Operaciones & Infraestructura

| Documento | Descripción |
|-----------|-------------|
| [operations-runbook.md](operations-runbook.md) | Runbook de operaciones + Ops Center (platform-monitor) |
| [observability-manual.md](observability-manual.md) | Observabilidad, salud de proveedores LLM |
| [backup-restore-runbook.md](backup-restore-runbook.md) · [backup-offsite-setup.md](backup-offsite-setup.md) | Backup/restore (verificación, drills, postmortems) + offsite (R2/S3) |
| [deploy-hardening-runbook.md](deploy-hardening-runbook.md) | Hardening del deploy (SSH key-only, throttling por IP real, backup pre-migración) |
| [runbooks/](runbooks/) | Runbooks puntuales: preflight de términos aceptados, carga y SLOs del despacho, reconciliación del despacho, suite completa de la API, cambio de plataforma de octubre, calidad de recuperación (RAG) |
| [infrastructure-capacity-analysis.md](infrastructure-capacity-analysis.md) | Capacidad, proyecciones de escala, costos |
| [server-installation.md](server-installation.md) | Instalación de servidor + GitHub Secrets |

## Seguridad

| Documento | Descripción |
|-----------|-------------|
| [security-specification.md](security-specification.md) | Especificación de seguridad (threat model, controles) |
| [SECURITY.md](SECURITY.md) | Políticas de seguridad (auth, JWT, RBAC, cifrado, webhooks) |
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
| [mobile-functional-test-2026-08.md](mobile-functional-test-2026-08.md) | Evidencia histórica del build v3 y seguimientos posteriores; no representa por sí sola el release vigente |
| [mobile-gate0-checklist.md](mobile-gate0-checklist.md) · [play-store-publish-checklist.md](play-store-publish-checklist.md) · [mobile-app-audit-2026-q2.md](mobile-app-audit-2026-q2.md) | GATE 0, estado de Play fechado y auditoría point-in-time |
| [mobile-release-2026-09-14.md](mobile-release-2026-09-14.md) · [mobile-play-compatibility-2026-09-14.md](mobile-play-compatibility-2026-09-14.md) · [mobile-android-r8-2026-09-14.md](mobile-android-r8-2026-09-14.md) · [play-console-pasos-finales.md](play-console-pasos-finales.md) | Release Android 1.1.1 (14-sep-2026): compatibilidad, R8 y pasos finales de Play Console (**(histórico)**) |
| [google-signin-diagnostico-2026-08.md](google-signin-diagnostico-2026-08.md) | Diagnóstico del login con Google en la app móvil (ago-2026) |
| [mobile-app-plan.md](mobile-app-plan.md) | Plan histórico de implementación; usar el manual móvil para comportamiento actual |

## Programa de verticales (ago–sep 2026)

Para saber **qué tipos de negocio existen hoy** usa [`business-types-catalog.md`](business-types-catalog.md). Los documentos de esta sección son el historial del programa: las cifras que traen (17/18 verticales, 75/76 subtipos, 1.520 escenarios) eran ciertas a su fecha y **no** son las actuales.

| Documento | Descripción |
|-----------|-------------|
| [vertical-approved-implementation-plan-2026-08-24.md](vertical-approved-implementation-plan-2026-08-24.md) | **Plan definitivo** posterior a las decisiones del dueño (24-ago-2026) |
| [vertical-implementation-execution-log.md](vertical-implementation-execution-log.md) | Bitácora de ejecución: unidad por unidad, gates y bloqueos |
| [vertical-decision-register-2026-08.md](vertical-decision-register-2026-08.md) · [vertical-decisions-implementation-2026-08.md](vertical-decisions-implementation-2026-08.md) | Registro final de decisiones y su implementación (**(histórico)**) |
| [vertical-phase-1-gate-2026-08-24.md](vertical-phase-1-gate-2026-08-24.md) · [vertical-phase-2-gate-2026-08-24.md](vertical-phase-2-gate-2026-08-24.md) · [vertical-phase-3-gate-2026-08-24.md](vertical-phase-3-gate-2026-08-24.md) | Gates de las fases 1–3: taxonomía, contratos compartidos, autoría 1:1 (**(histórico)**; cifras del 24-ago) |
| [vertical-phase4-platform-evidence-2026-08-24.md](vertical-phase4-platform-evidence-2026-08-24.md) · [vertical-phase5-rental-evidence-2026-08-25.md](vertical-phase5-rental-evidence-2026-08-25.md) · [vertical-phase5-workshop-evidence-2026-08-25.md](vertical-phase5-workshop-evidence-2026-08-25.md) | Evidencia de cierre de las fases 4 y 5 (plataforma, alquiler, taller) |
| [vertical-waves-execution-2026-08.md](vertical-waves-execution-2026-08.md) · [wave-0-execution-2026-08.md](wave-0-execution-2026-08.md) · [wave-0-onboarding-persona-resolution.md](wave-0-onboarding-persona-resolution.md) | Ejecución de las Olas 0–5 y de la Ola 0 (**(histórico)**) |
| [vertical-full-implementation-plan-2026-08.md](vertical-full-implementation-plan-2026-08.md) · [vertical-consolidated-plan-2026-07.md](vertical-consolidated-plan-2026-07.md) | Planes anteriores, superseded por el plan definitivo del 24-ago |
| [vertical-intervention-status-2026-08-23.md](vertical-intervention-status-2026-08-23.md) | Cierre de la intervención vertical a 23-ago-2026 (**(histórico)**: cifras de esa fecha) |
| [vertical-system-audit-2026-08.md](vertical-system-audit-2026-08.md) | Auditoría point-in-time de las 18 verticales (6-ago-2026) |
| [vertical-master-test-plan-2026-08.md](vertical-master-test-plan-2026-08.md) | Plan maestro de pruebas (**(histórico)**: 75 subtipos + otro, 1.520 escenarios) |
| [vertical-bootstrap-audit-2026-07.md](vertical-bootstrap-audit-2026-07.md) · [vertical-maturity-audit-2026-07.md](vertical-maturity-audit-2026-07.md) · [vertical-deep-dives/](vertical-deep-dives/) | Auditorías y dossiers de julio (**(histórico)**; cubren 18 de las 20 industrias) |
| [vertical-subtype-market-audit-2026-08.md](vertical-subtype-market-audit-2026-08.md) · [vertical-competitive-matrix-2026-08.md](vertical-competitive-matrix-2026-08.md) · [vertical-subtype-prompt-navigation-audit-2026-08.md](vertical-subtype-prompt-navigation-audit-2026-08.md) | Auditorías competitivas y de prompts/navegación por subtipo (ago-2026; **(histórico)**) |
| [agent-tool-subtype-cohesion-audit-2026-08.md](agent-tool-subtype-cohesion-audit-2026-08.md) | Herramientas, datos y agentes por subtipo (20-ago-2026; **(histórico)**: 95 tools, 75 subtipos; hoy hay 123 tools estáticas y 80 tipos de negocio) |
| `vertical-*-scorecard-2026-08.csv`, `agent-tool-subtype-*-scorecard-2026-08.csv` | Hojas de cálculo del 20-ago-2026 con la taxonomía anterior (76 filas; incluyen legacy y omiten tipos nuevos): **(histórico)** |
| [country-language-behavior-packs-latam-2026-08.md](country-language-behavior-packs-latam-2026-08.md) | Especificación de comportamiento lingüístico por país |
| [vertical-provisioning-v2-runbook.md](vertical-provisioning-v2-runbook.md) | Runbook de provisioning vertical v2 |
| [vertical-release-runbook-2026-08.md](vertical-release-runbook-2026-08.md) | Runbook de evidencia para release vertical (el gate estricto vive en `vertical-quality.yml` tier `release`) |
| [audit-open-initiatives-2026-08.md](audit-open-initiatives-2026-08.md) | Auditoría de iniciativas abiertas fuera del plan de verticales (ago-2026) |

## Onboarding

| Documento | Descripción |
|-----------|-------------|
| [onboarding-decisions-2026-09.md](onboarding-decisions-2026-09.md) · [onboarding-experience-design-2026-09.md](onboarding-experience-design-2026-09.md) · [onboarding-diagnosis-2026-09.md](onboarding-diagnosis-2026-09.md) | Generación vigente (sep-2026): decisiones, diseño de la experiencia guiada y diagnóstico tras el video real |
| [onboarding-experience-plan-v2-2026-09.md](onboarding-experience-plan-v2-2026-09.md) · [onboarding-review-and-completion-plan-2026-09-18.md](onboarding-review-and-completion-plan-2026-09-18.md) · [onboarding-implementation-closeout-2026-09-18.md](onboarding-implementation-closeout-2026-09-18.md) | Propuesta v2, revisión y cierre de implementación (17–18 sep-2026), los más recientes |
| [onboarding-ux-benchmark-and-video-audit.md](onboarding-ux-benchmark-and-video-audit.md) · [onboarding-video-transcript-analysis.md](onboarding-video-transcript-analysis.md) · `onboarding-diagnosis-2026-09-workdir/` | Borradores de investigación con nota de verificación (cifras sin fuente primaria) |
| [onboarding-audit-2026-07.md](onboarding-audit-2026-07.md) · [onboarding-audit-2026-06.md](onboarding-audit-2026-06.md) | Auditorías de jul y jun-2026 (**(histórico)**, supersedidas por la generación de sep) |
| [onboarding-redesign-2026-q2.md](onboarding-redesign-2026-q2.md) · [onboarding-redesign-implementation-plan.md](onboarding-redesign-implementation-plan.md) | Rediseño Q2-2026 y plan de implementación (**(histórico)**) |

## Estrategia & Research

| Documento | Descripción |
|-----------|-------------|
| [implementation-plan-2026-q2.md](implementation-plan-2026-q2.md) | Plan de implementación Q2–Q3 2026 (**(histórico)**) |
| [competitive-analysis-2026-q2.md](competitive-analysis-2026-q2.md) | Análisis competitivo histórico Q2 2026; no usar como fuente de alcance vigente |
| [marketing-content-capabilities-2026-07.md](marketing-content-capabilities-2026-07.md) | Capacidades de creación de contenido de marketing |
| [market-research-latam.md](market-research-latam.md) · [external-crm-integration-research.md](external-crm-integration-research.md) · [feature-board-research.md](feature-board-research.md) | Research |
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
| [../MANUAL.md](../MANUAL.md) | Manual legacy congelado en v3.1.0 (Mar 2026) — desactualizado; usar [user-manual.md](user-manual.md) |
| [archive/competitive-analysis-2026-05.md](archive/competitive-analysis-2026-05.md) · [archive/competitive-analysis-2026-05-enhanced.md](archive/competitive-analysis-2026-05-enhanced.md) | Superseded por competitive-analysis-2026-q2.md |
| [archive/platform-audit-2026-05.md](archive/platform-audit-2026-05.md) · [archive/test-plan-2026-05.md](archive/test-plan-2026-05.md) · [archive/security-audit-2026-05-12.md](archive/security-audit-2026-05-12.md) | Snapshots may-2026 |
| [archive/platform-excellence-plan-2026-06.md](archive/platform-excellence-plan-2026-06.md) · [archive/platform-excellence-bugs-2026-06.json](archive/platform-excellence-bugs-2026-06.json) | Plan/bugs jun-2026 ejecutados |
| [archive/billing-plan.md](archive/billing-plan.md) · [archive/billing-mp-setup.md](archive/billing-mp-setup.md) | Snapshot abr-2026 (matriz viva = `apps/api/prisma/seed-billing-plans.js`) y setup de Mercado Pago (retirado) |
| [archive/roadmap/](archive/roadmap/) · [archive/specs/](archive/specs/) | Roadmap y specs de marzo-2026 (implementados) |
| [archive/add_parallly_arquitectura.md](archive/add_parallly_arquitectura.md) · [archive/guia-tema-visual-y-navegacion-plataforma.md](archive/guia-tema-visual-y-navegacion-plataforma.md) · [archive/sprint-tier1-technical.md](archive/sprint-tier1-technical.md) · [archive/installation-manual.md](archive/installation-manual.md) | Superseded por architecture-detail / design system / server-installation |
| [archive/v3-crm-whatsapp-guide.md](archive/v3-crm-whatsapp-guide.md) | Plan v3, difiere de lo construido |

## Otros

| Documento | Descripción |
|-----------|-------------|
| [../parallly_api.postman_collection.json](../parallly_api.postman_collection.json) | Colección Postman para testing del API |
| [role-guards-pending.json](role-guards-pending.json) · [vertical-competitive-evidence.json](vertical-competitive-evidence.json) · [vertical-release-evidence.schema.json](vertical-release-evidence.schema.json) | Datos de trabajo y esquema de evidencia de release vertical |
