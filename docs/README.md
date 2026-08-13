# Parallext Engine — Documentación

_Última actualización: 2026-08-11_

Índice de la documentación del proyecto. La **fuente canónica** del índice es la tabla `## Documentation Index` en [`../CLAUDE.md`](../CLAUDE.md); este README la espeja para navegación humana. Cuando agregues o archives un doc, actualizá **ambos**.

> **Convención de estado:** los documentos vivos reflejan el código actual (codebase v4.x). Los documentos históricos/superseded viven en [`archive/`](archive/) con un banner **ARCHIVADO**; no los tomes como estado vigente.

---

## Arquitectura y referencia

| Documento | Descripción |
|-----------|-------------|
| [../CLAUDE.md](../CLAUDE.md) | Referencia rápida: arquitectura, convenciones, inventario, índice de docs (canónico) |
| [architecture-detail.md](architecture-detail.md) | Arquitectura detallada: flujo de mensajes, prompt layers (3), knowledge (5 tiers), LLM Router (routing por tarea, tiers, circuit breaker, cost breaker), auth/sesiones, OAuth, calendario, BullMQ, multi-canal por tipo |
| [modules-reference.md](modules-reference.md) | Inventario técnico; snapshot actual: 88 archivos `*.module.ts`, 144 páginas dashboard, colas y crons |
| [API_REFERENCE.md](API_REFERENCE.md) | Endpoints REST (todos bajo `/api/v1`), eventos WebSocket, migraciones, colas |
| [agent-quality-center.md](agent-quality-center.md) | Contrato del Centro de calidad: tres pilares, estados, atribución, evidencia y bucle de mejora seguro |
| [dashboard-navigation-architecture-2026-08.md](dashboard-navigation-architecture-2026-08.md) | Contrato de navegación tenant, orden, retorno, tour y decisiones de IA |
| [product-capabilities-reference.md](product-capabilities-reference.md) | Mapa canónico de superficies, roles, planes y las 18 verticales |
| [platform-assistant-knowledge.md](platform-assistant-knowledge.md) | Fuente runtime, alcance y proceso de publicación de Parallly Assist |
| [data-dictionary.md](data-dictionary.md) · [database-schema.dbml](database-schema.dbml) | Diccionario de datos y ERD (schema público + por-tenant) |
| [analytics-billing-reference.md](analytics-billing-reference.md) | Snapshot técnico de analytics/billing; precios, cuotas y features deben verificarse en `billing_plans` runtime |
| [CHANGELOG.md](CHANGELOG.md) | Historial de cambios por sesión |
| [../apps/api/CLAUDE.md](../apps/api/CLAUDE.md) · [../apps/dashboard/CLAUDE.md](../apps/dashboard/CLAUDE.md) · [../apps/whatsapp/CLAUDE.md](../apps/whatsapp/CLAUDE.md) | Contexto por app |

## Facturación & Billing

| Documento | Descripción |
|-----------|-------------|
| [billing-annual-cycle.md](billing-annual-cycle.md) | Ciclo mensual/anual, sync a MercadoPago, billing-ops cross-tenant, refund inline, reconciliación |
| [billing-runbook.md](billing-runbook.md) · [billing-mp-setup.md](billing-mp-setup.md) | Runbook de billing y setup de MercadoPago |
| [plan-profitability-2026-07.md](plan-profitability-2026-07.md) | Análisis de rentabilidad y precios COP por país |
| [facturacion-electronica-colombia-2026-06.md](facturacion-electronica-colombia-2026-06.md) | Facturación electrónica DIAN (Colombia) vía Factus |

## Canales & SMS

| Documento | Descripción |
|-----------|-------------|
| [multi-channel-per-type-implementation-2026-07.md](multi-channel-per-type-implementation-2026-07.md) | Multi-cuenta por tipo de canal (N conexiones del mismo tipo, agente por conexión) |
| [coexistence-manual.md](coexistence-manual.md) | Coexistencia WhatsApp (Embedded Signup + migración de historial) |
| [sms-monetization-packages-2026-07.md](sms-monetization-packages-2026-07.md) · [sms-notifications-implementation-plan-2026-07.md](sms-notifications-implementation-plan-2026-07.md) | SMS: créditos reseller (monetizado) + notificaciones transaccionales |

## Operaciones & Infraestructura

| Documento | Descripción |
|-----------|-------------|
| [operations-runbook.md](operations-runbook.md) | Runbook de operaciones + Ops Center (platform-monitor) |
| [observability-manual.md](observability-manual.md) | Observabilidad, salud de proveedores LLM |
| [backup-restore-runbook.md](backup-restore-runbook.md) · [backup-offsite-setup.md](backup-offsite-setup.md) | Backup/restore (verificación, drills, postmortems) + offsite (R2/S3) |
| [deploy-hardening-runbook.md](deploy-hardening-runbook.md) | Hardening del deploy (SSH key-only, throttling por IP real, backup pre-migración) |
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
| [appointments-manual.md](appointments-manual.md) · [analytics-manual.md](analytics-manual.md) · [offboarding-manual.md](offboarding-manual.md) | Citas, analytics, offboarding |
| [vertical-strategy.md](vertical-strategy.md) | Estrategia de adaptación por vertical |

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
| [mobile-app-plan.md](mobile-app-plan.md) | Plan histórico de implementación; usar el manual móvil para comportamiento actual |

## Estrategia & Research

| Documento | Descripción |
|-----------|-------------|
| [vertical-system-audit-2026-08.md](vertical-system-audit-2026-08.md) | Auditoría point-in-time de las 18 verticales; el manifest y la política de producto gobiernan el estado actual |
| [wave-0-execution-2026-08.md](wave-0-execution-2026-08.md) | Estado de ejecución de Ola 0: mitigaciones P0, evidencia automática, contrato comercial, manifest v1 y gates de integración pendientes |
| [vertical-master-test-plan-2026-08.md](vertical-master-test-plan-2026-08.md) | Plan maestro de certificación: 76 configuraciones, 1.520 escenarios de bootstrap, tools, IA, seguridad, UI, integraciones y quality gates |
| [competitive-analysis-2026-q2.md](competitive-analysis-2026-q2.md) | Análisis competitivo histórico Q2 2026; no usar como fuente de alcance vigente |
| [onboarding-redesign-2026-q2.md](onboarding-redesign-2026-q2.md) · [onboarding-redesign-implementation-plan.md](onboarding-redesign-implementation-plan.md) · [onboarding-audit-2026-06.md](onboarding-audit-2026-06.md) | Rediseño de onboarding + estado |
| [market-research-latam.md](market-research-latam.md) · [external-crm-integration-research.md](external-crm-integration-research.md) · [feature-board-research.md](feature-board-research.md) | Research |

## Archivado (histórico / superseded)

Documentos point-in-time o reemplazados, en [`archive/`](archive/). Se conservan como referencia; **no reflejan el estado actual**.

| Documento | Motivo |
|-----------|--------|
| [../MANUAL.md](../MANUAL.md) | Manual legacy congelado en v3.1.0 (Mar 2026) — desactualizado; usar [user-manual.md](user-manual.md) |
| [archive/competitive-analysis-2026-05.md](archive/competitive-analysis-2026-05.md) · [archive/competitive-analysis-2026-05-enhanced.md](archive/competitive-analysis-2026-05-enhanced.md) | Superseded por competitive-analysis-2026-q2.md |
| [archive/platform-audit-2026-05.md](archive/platform-audit-2026-05.md) · [archive/test-plan-2026-05.md](archive/test-plan-2026-05.md) · [archive/security-audit-2026-05-12.md](archive/security-audit-2026-05-12.md) | Snapshots may-2026 |
| [archive/platform-excellence-plan-2026-06.md](archive/platform-excellence-plan-2026-06.md) · [archive/platform-excellence-bugs-2026-06.json](archive/platform-excellence-bugs-2026-06.json) | Plan/bugs jun-2026 ejecutados |
| [archive/billing-plan.md](archive/billing-plan.md) | Snapshot abr-2026; matriz viva = `apps/api/prisma/seed-billing-plans.js` |
| [archive/roadmap/](archive/roadmap/) · [archive/specs/](archive/specs/) | Roadmap y specs de marzo-2026 (implementados) |
| [archive/add_parallly_arquitectura.md](archive/add_parallly_arquitectura.md) · [archive/guia-tema-visual-y-navegacion-plataforma.md](archive/guia-tema-visual-y-navegacion-plataforma.md) · [archive/sprint-tier1-technical.md](archive/sprint-tier1-technical.md) | Superseded por architecture-detail / design system |
| [archive/v3-crm-whatsapp-guide.md](archive/v3-crm-whatsapp-guide.md) | Plan v3, difiere de lo construido |

## Otros

| Documento | Descripción |
|-----------|-------------|
| [../parallly_api.postman_collection.json](../parallly_api.postman_collection.json) | Colección Postman para testing del API |
