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
| `2026-09-onboarding/` | Diagnóstico, propuesta v2, revisión y benchmark del onboarding de septiembre, con su evidencia |
| `billing-plan.md` | Plan de billing de abril de 2026 (lo cita `reconciliation.processor.ts`) |
