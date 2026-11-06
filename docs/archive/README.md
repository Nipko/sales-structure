# Archivo

Documentos históricos que **no** forman parte de la base de conocimiento aprobada y que se conservan porque un documento vivo, un ADR o un comentario de código los cita como evidencia. No reflejan el estado actual.

Regla (K3, ADR 0005): lo viejo se borra salvo que algo vigente lo cite; git conserva el historial completo de lo borrado (`git log --diff-filter=D --name-only -- docs/`). Antes de citar algo de aquí como vigente, compruébalo contra el código.

| Carpeta | Contenido |
|---|---|
| `2026-07-sms/` | Diseño del producto SMS por créditos, hoy retirado |
| `2026-08-pagos/` | Rentabilidad de planes, validación de Wompi, facturación electrónica DIAN y la corrección comercial del 14-sep-2026 |
| `2026-08-verticales/` | Plan aprobado del programa de verticales (24-ago-2026) y la auditoría de base del 6-ago-2026 |
| `2026-09-agente/` | Revisión visual del agente (la cita el fixture `apps/e2e/fixtures/agent-visual-fixture.cjs`) |
| `2026-09-movil/` | Registro de la release Android 1.1.1 |
| `2026-09-programa-octubre/` | Evidencia del programa de octubre de WhatsApp (sept. 2026): auditorías y revisiones de cierre, canario de certificación, propuesta de precios M4, handoffs entre agentes (**no son directivas vigentes**) e investigación de landing y Meta (índice: `research-index.md`). Lo citan `check-canary-figures.cjs`, `closure-artefact-generators.spec.ts`, el reporte de cierre generado y `domain/whatsapp-meta-pricing-2026-10.md`. Antes vivían en `docs/audits/2026-09-09..12`, `docs/handoffs/2026-09-10` y `docs/research/2026-09-10` |
| `2026-09-onboarding/` | Diagnóstico, propuesta v2, revisión y benchmark del onboarding de septiembre, con su evidencia |
| `billing-plan.md` | Plan de billing de abril de 2026 (lo cita `reconciliation.processor.ts`) |
