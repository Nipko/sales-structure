# 0005 — Estructura de la base de conocimiento aprobado y limpieza K3

- Estado: aprobada
- Fecha: 2026-10-30 · Decide: dueño del producto (frente K aprobado el 30-oct-2026) · Autor: Claude (K3)
- Ámbito: `docs/`, `AGENTS.md` / `CLAUDE.md`, scripts y código muerto del monorepo. **No** toca tablas ni columnas.
- Número: 0004 queda libre para otro trabajo en paralelo; este ADR usa 0005 para no colisionar.

## Contexto

El inventario K2 (29-oct-2026) encontró en el repositorio unos 300 documentos históricos mezclados con los vigentes en la raíz de `docs/`, tres copias del contexto para agentes que se contradecían (`AGENTS.md`, `CLAUDE.md`, `.claude-memory/`), contradicciones activas (el README de billing decía que Stripe era trabajo futuro; la especificación de seguridad citaba límites y una CSP de un nginx que nunca se montó en producción), un enlace roto en el dashboard (`/docs/API_REFERENCE.md`), código y scripts sin referencias y archivos SQL que ningún proceso ejecuta. La regla del frente K: lo viejo se elimina o se actualiza; no se deja «por si acaso»; el historial queda en git y en los ADR.

Restricción que mandó en todo el trabajo: varios documentos de `docs/` los leen la CI, la landing y specs (`verify-artifacts.cjs`, `check-canary-figures.cjs`, `Dockerfile.landing`, `generate-closure-report.cjs`, `cutover-script.spec.ts`…). Lo que se movió se movió junto con su consumidor.

## Decisión

### Estructura

```
AGENTS.md            contexto único para agentes de código (CLAUDE.md solo lo importa)
docs/README.md       índice: documento, contenido, estado, último cambio, fuente de verdad en código
docs/decisions/      ADR NNNN-*.md (+ previas/: registros de decisión anteriores al formato ADR)
docs/domain/         reglas de negocio, catálogos generados, pagos, Meta, onboarding, manuales funcionales
docs/architecture/   arquitectura vigente, referencia de API, capacidades, calidad, Assist
docs/security/       especificación de seguridad y gobernanza super_admin
docs/operations/     runbooks y manuales de operación (runbooks/ puntuales)
docs/generated/      índice de artefactos generados y su comprobación en CI
docs/archive/        solo históricos que algo vigente cita
```

Reglas: entra solo lo aprobado; lo que se puede contar se genera; una fuente por tema; 90 días sin revisión = «revisar»; K4 (un cambio no está terminado sin actualizar la base y retirar lo que reemplaza). Lo histórico **se borra** salvo que un documento vivo, un ADR o un comentario de código lo cite; en ese caso va a `docs/archive/<periodo>/`.

### Qué se retiró y por qué (commits de la rama `claude/k3-cleanup`)

**Documentación (291 archivos borrados, 15 archivados, 4 fusiones).**
- Borrados porque nada vigente los cita: auditorías fechadas `docs/audits/2026-09-05`, `-07`, `-08`, `-14` (77) y partes no citadas de `-09`/`-10`/`-11`; handoffs `2026-09-08/09/11/12` (17, incluido un parche `.draft.patch` sin aplicar); el programa de verticales de julio–agosto (planes, gates, olas, bitácora, scorecards CSV, `vertical-deep-dives/`, `vertical-audit-workdir/`); el workdir del diagnóstico de onboarding y las auditorías de onboarding de junio–julio; investigación y planes ejecutados de agente, Assist, pagos, SMS, móvil y estrategia; `docs/research/2026-09-14`; el paquete de la campaña de Meta del 1-oct (`docs/communications/`) y su PDF regenerable (`output/`); `docs/CHANGELOG.md` (congelado en agosto), `MANUAL.md` (v3.1 de marzo), `data-dictionary.md` + `database-schema.dbml` (desactualizados: 33 de 49 modelos), `infrastructure-capacity-analysis.md` (go-live con Mercado Pago), `role-guards-pending.json`, `help-*`, logos SVG sin uso, la colección Postman de marzo, `.claude-memory/` (28 archivos de abril, con datos ya falsos) y `.agent/` (ordenaba actualizar el CHANGELOG congelado). Del archivo previo se conservó solo `billing-plan.md` (lo cita `reconciliation.processor.ts`).
- Archivados (los cita algo vigente): revisión visual del agente (fixture e2e), diagnóstico/propuesta/revisión/benchmark del onboarding de septiembre y su evidencia, rentabilidad de planes, validación Wompi, facturación DIAN, corrección comercial del 14-sep, plan aprobado y auditoría base de verticales, paquetes SMS, release Android 1.1.1.
- Fusiones: `AGENTS.md` + `CLAUDE.md` + `.claude-memory/` → `AGENTS.md` (sin secciones fechadas; puerto de PgBouncer corregido a 5432; sin el nginx inexistente). `SECURITY.md` → Anexo A de `security/security-specification.md`, que además se corrigió (sin nginx ni CSP en producción → hallazgo M-18; webhooks de billing Wompi/Stripe; SMS retirado). `apps/whatsapp/README.md` → `apps/whatsapp/CLAUDE.md`. Tres checklists de Play Store → `operations/runbooks/mobile-release.md`.
- Contradicciones y enlaces: README de billing (Stripe es el riel fuera de Colombia), enlace del dashboard a Swagger público `https://api.parallly-chat.cloud/docs/public`, imagen rota del manual de usuario, enlaces de documentos vivos a lo borrado.

**Código y configuración (35 archivos borrados).**
- `active-object-policy.ts`: el set `NON_SENSITIVE_VETERINARY_SUBTYPES` era una segunda copia de la tabla de alias dentro de una frontera de seguridad. El par se canonicaliza en la frontera (`canonicalSubtypeId`): `veterinaria/peluqueria_canina` se clasifica como `pet_services/peluqueria` y veterinaria es siempre sensible. Mismas decisiones para todos los pares actuales.
- Campo `industries` de `PERSONA_TEMPLATES` (nadie lo leía; claves que no son industrias del manifiesto). `KnowledgeService.searchChunks` (sin llamadores). `agent-test-plan-policy.ts`, `CopilotWidget.tsx` (sin montar desde abril), `data/changelog.ts`, tres primitivas UI sin uso.
- Scripts sin referencias: `purge-tenant.js` (borraba un tenant fijo), `test-create-schema.js`, `test-billing-flow.js`, `reconcile-tenant-plans.js`, `backfill-handoff-triggers.js`, `smoke-test.ts`, `benchmark-evaluation-revision.ts`, `migrate-mercadopago-to-wompi.js`, `add-missing-tables.js` (ya lanzaba `RETIRED`), dos one-off de i18n y `analyze-split.js` (ruta absoluta de otra máquina). `audit-plan-drift.js` y `audit-fiscal-reality.js` se mantienen y quedan documentados en `operations/operations-runbook.md`.
- `seed-gecko.sql` (escribía en tablas que ya no existen), `templates/personas/turismo.yaml` y los 13 `.sql` sueltos de marzo en `prisma/migrations/` (`001…007_*.sql`, `v4_*.sql`): Prisma solo aplica carpetas y ningún script los ejecutaba.
- `package.json`: `db:seed` apuntaba a un `prisma/seed.ts` inexistente y ahora ejecuta `seed-admin.ts` (lo que espera `reset-db.sh`); se quitaron `db:seed:gecko` y los `test:e2e` de api y whatsapp cuyo `jest-e2e.json` nunca existió.
- `infra/nginx/` (nada lo monta; `deploy-hardening-runbook.md` ya decía que no se aplica en producción). `.env.example`: `API_PORT`, `WA_PORT` (el código lee `PORT`); `WOMPI_WEBHOOK_URL` pasa a comentario y `deploy.yml` deja de escribirla (nadie la lee). `vertical-quality.yml` solo se dispara por los dos insumos de la landing en `docs/`, no por cualquier `docs/vertical-*`.

## Consecuencias

- Verificación: `node docs/audits/2026-09-09/verify-artifacts.cjs` y `node apps/api/scripts/check-canary-figures.cjs --check` pasan; `tsc --noEmit` de api y dashboard limpio; specs de la política de objetos activos, de workflows y de Prisma en verde. Los artefactos de cierre se regeneraron en el último commit.
- Los agentes leen un solo archivo de contexto. Lo que antes decía `CLAUDE.md` de «Counters» y el índice de documentos vive ahora en `AGENTS.md` y `docs/README.md`.
- Quien busque un documento borrado lo encuentra con `git log --diff-filter=D --name-only -- docs/` y lo recupera con `git show <commit>^:<ruta>`.

### Pendiente (no se hizo en K3, a propósito)

- **Tablas sin uso — migración preparada para aprobación.** No se borró ni alteró ninguna tabla o columna. La convención del repositorio no admite borradores sin aplicar en `prisma/migrations/` (el deploy aplica toda carpeta con `prisma migrate deploy`), así que la migración no se dejó escrita: se prepara cuando el dueño apruebe cada tabla, tras contar filas por schema y con respaldo, en dos pasos (expand-contract: sacarla del template y del código; `DROP` en el release siguiente). Candidatas (K2 §2):
  - Por tenant, sin lectura ni escritura real: `business_rules`, `tool_configs`, `intake_sources`, `campaign_courses`, `carla_personality_profiles`, `carla_prompt_templates`, `carla_conversation_context`, `knowledge_chunks`, `conversation_memory` (solo un `DELETE` en `agent-console.service.ts` que se quita en el mismo cambio), `dashboard_preferences`, `kb_health_issues`, `knowledge_approvals`, `vehicle_inquiries`, `wait_jobs`. `knowledge_resources` **está viva** y se mantiene.
  - Públicas legacy fuera de Prisma (en `TENANT_PUBLIC_PURGE_ORDER`): `daily_metrics`, `commercial_offers`, `knowledge_resources`, `carla_*`, `legal_text_versions`, `consent_records`, `opt_out_records`, `deletion_requests`, `canned_responses`, `wait_jobs`, `automation_rules`, `pipeline_stages` — verificar si existen y tienen filas.
  - SMS (`sms_package_orders`, `sms_credit_ledger`, `sms_credit_balances`) junto con los módulos `sms-credits/`, `sms-notifications/`, `sms-checkout.controller.ts`, el adaptador y el flag: decisión contable del dueño.
  - Tablas duplicadas dentro de `tenant-schema.sql` (`courses`, `customer_memory_erasure`, `eval_runs`, `operational_notice_outbox`): revisar si son pasos intencionales.
- **Reubicar generados e insumos** (`docs/audits/2026-09-09..12`, `handoffs/2026-09-10`, tarifas de `research/2026-09-10`, `appointments-manual.md`, `vertical-competitive-*`) a `docs/generated/`, `apps/api/data/` y `apps/landing/data/`: cambia rutas en generadores, `verify-artifacts`, `check-canary-figures`, `Dockerfile.landing`, la landing y specs. PR propio.
- **Manual de usuario vs. KB de Assist:** decisión del dueño (la KB es la que llega al producto).
- **Convertir `decisions/previas/` en ADR numerados** (retiro de Mercado Pago, Email, ledger, registro de verticales, decisiones de onboarding) y redactar el ADR de retiro de SMS.
- **Diccionario de datos generado** desde `schema.prisma` + `tenant-schema.sql` con `--check` en `verify-artifacts` (reemplaza al borrado).
- **release-please se mantiene:** está activo (rama `release-please--branches--main` actualizada el 2026-10-30); `VERSIONING.md` y `release.yml` siguen vigentes.
- **Hallazgo de seguridad M-18:** dashboard y landing sin Content-Security-Policy.

## Alternativas descartadas

- **Archivar todo lo histórico en `docs/archive/`** (propuesta original de K2): mantenía cientos de archivos que nadie lee y que el check de cifras del canario sigue escaneando. Git ya conserva el historial; solo se archiva lo que algo vigente cita.
- **Mover los generados en este mismo cambio:** mezcla limpieza documental con cambios de código y CI; se separa para que cada PR tenga un riesgo acotado.
- **Dejar un borrador de migración `DROP`** en `prisma/migrations/`: el deploy la aplicaría automáticamente.
