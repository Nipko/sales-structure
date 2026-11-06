# 0017 — Limpieza K3, segunda pasada: código muerto, textos huérfanos y documentos sin lector

- Estado: aprobada
- Fecha: 2026-11-04 · Decide: dueño del producto (frente K, autonomía sin borrados irreversibles) · Autor: Claude (K3b)
- Ámbito: `apps/landing/src/components`, `apps/landing/messages`, `apps/dashboard/messages`, `apps/api/src/modules/crm`, `docs/`. **No** toca tablas, columnas ni filas.

## Contexto

La primera pasada (ADR 0005, PR #323) retiró unos 330 archivos con el inventario K2 del 29-oct. Desde entonces entraron las fases C y D y el código cambió mucho, así que la segunda pasada se rehízo desde `origin/main` (`a4342549`) con evidencia nueva en lugar de confiar en el inventario:

- barrido de importaciones de todo el monorepo (relativas y `@/`): archivos sin ningún importador;
- `git grep` de cada nombre y ruta en `apps/`, `packages/`, `.github/`, scripts y `apps/e2e`, porque varios validadores leen archivos por ruta;
- claves de mensajes sin llamada `t()` ni clave dinámica;
- documentos de `docs/` sin nadie que los cite;
- scripts de `apps/*/scripts` sin referencia.

## Decisión

Se retira, en tres PR temáticos:

1. **Código muerto** (rama `claude/k3b-dead-code`). Las secciones de la landing anteriores al rediseño del 14-sep (`41a8d9e6`): `HeroSection`, `HowItWorks`, `FeaturesGrid`, `ComparisonTable`, `ProblemSection`, `AiControlSection`, `LabelledDemos`, `MobileAppSection`, `ResultsBand`, `ToolsShowcase`, `VibeSellingBand`, `ui/SectionHeader`, tres ilustraciones y seis demos que solo montaba `LabelledDemos`, con sus espacios de mensajes (`aiControl`, `comparison`, `mobileApp`, `tools`, `vibeSelling`). En la API, `crm/services/contacts/ContactsService`, que no es provider de ningún módulo.
2. **Textos huérfanos del dashboard** (rama `claude/k3b-dashboard-i18n`): `smsNotificationsIntegration`, `checklist`, `verticalChecklist`, las claves de la lista vieja de «consultas sin respuesta» (`knowledge.gaps.unanswered*` y afines, retirada por R5, ADR 0011) y seis claves de `knowledge.analytics` que la pestaña no muestra.
3. **Documentos** (esta rama, `claude/k3b-docs`): el handoff `docs/handoffs/2026-09-10/claude-whatsapp-spend-runtime-continuation.md` (nadie lo cita) y la revisión `docs/audits/2026-09-10/whatsapp-spend-batch-independent-review.md` (solo la citaba ese handoff). Se documentan en `operations/operations-runbook.md` los tres scripts operativos que no tenían referencia y siguen sirviendo (`verify-wompi-flow.js`, `fiscal-backfill-report.js`, `audit-uuid-casts.js`). Se corrige `apps/api/CLAUDE.md`, que todavía presentaba SMS como canal Twilio.

### Lo que el inventario marcaba y se queda, con su evidencia

- **Desmontados, pero un validador los lee por ruta:** `TestimonialsSection`, `TrustRow`, `VerticalsShowcase` y `demos/OrderPaymentDemo` (`apps/landing/scripts/validate-marketing-claims.cjs`); `howItWorks.*` (el mismo script exige `howItWorks.step2Desc`). Retirarlos exige cambiar antes el validador.
- **`ToolsTour.tsx`** del asistente de configuración: no se monta desde `4f2390e4` (4-sep), pero lo leen `docs/audits/2026-09-11/tools-programme-rows.cjs` (artefacto de cierre verificado en CI) y dos specs. Va con la reubicación de los generados (ADR 0005, pendiente).
- **Generados e insumos de `docs/audits/2026-09-09..12`, `handoffs/2026-09-10`, `research/2026-09-10`:** los leen `verify-artifacts.cjs`, `check-canary-figures.cjs`, `generate-whatsapp-rates.cjs`, la landing y specs (ADR 0005).
- **Lo viejo del rediseño que espera su paso contract:** `VerticalReadinessService`, `READINESS`, `TOOL_GROUP_READINESS`, `TOOL_READINESS`, `readiness-predicate-authority.util.ts` y los interruptores `canBook`/`canCancel` siguen como referencia de la sombra hasta aplicar `readiness.writeModeCapability` en todos los tenants (ADR 0010 §10). `settings.businessHours`, `config_json.hours` como horario, `policies` y `companies` como identidad siguen hasta el contract de R3b (ADR 0009). Las reglas L siguen (`legacy-status.ts`, `docs/domain/business-readiness-runtime.md`).
- **Scripts operativos sin referencia:** se documentan en el runbook en vez de borrarse. `apps/landing/scripts/verify-export-navigation.cjs` (comprueba enlaces del export estático) no está en ningún `package.json`: se deja para que la landing decida si lo cuelga de `build`.
- **Flags:** no se encontró ningún flag de configuración siempre encendido o siempre apagado fuera de `sms.platform_enabled`, que depende de la decisión sobre SMS.

**Actualización K3c (2026-11-05).** Los tres primeros puntos y el de `verify-export-navigation.cjs` se resolvieron por decisión del dueño:
- Los validadores de la landing leen lo que se renderiza: `TestimonialsSection`, `TrustRow`, `VerticalsShowcase` (y lo que solo él montaba: `MultiChannelShowcase`, tres widgets, `CLUSTER_LABELS`), `demos/OrderPaymentDemo`, `data/testimonial-evidence.ts` y los mensajes `howItWorks`, `testimonials`, `trust`, `demos`, `solutions.heroTitle/heroSubtitle` y las claves de `verticals`/`channels` que solo usaban esas secciones se retiraron. Las reglas que protegían se reescribieron sobre las páginas vivas (sin testimonios en fuente ni mensajes; sin insignias de partner en ninguna fuente ni idioma; el aviso `solutions.validationRequired` de cada industria; el titular de `/soluciones` frente al estado canónico de certificación; cada demo renderizada registrada).
- La landing ya no lee el reporte de cierre: el conteo de canales que publica se compara con la matriz de certificación de canales dentro de `generate-closure-report.cjs` (`landingCapabilityDrift`), que falla en todo modo desde `npm run verify:artifacts`. `Dockerfile.landing` deja de copiar el reporte.
- `ToolsTour.tsx` y sus dos specs se retiraron con las claves `setupWizard.discover.*` que solo él usaba (queda `opensInNewTab`). La fila T4 del reporte de cierre queda congelada como histórica (`declared`), sin lectura.
- Generados e insumos reubicados (ADR 0005, PR de K3c).
- `verify-export-navigation.cjs` pasa (3656 enlaces en 156 documentos, menos de un segundo) y quedó al final de `npm run build` de la landing.

### Para decisión del dueño (base de datos y SMS)

Sin cambios en esta pasada; la lista de ADR 0005 («Pendiente») sigue vigente y se confirmó contra `main`:

- Por tenant, sin lectura ni escritura real: `business_rules`, `tool_configs`, `intake_sources`, `campaign_courses`, `carla_*` (3), `knowledge_chunks`, `conversation_memory`, `dashboard_preferences`, `kb_health_issues`, `knowledge_approvals`, `vehicle_inquiries`, `wait_jobs`.
- `kb_unanswered_queries`: sin escritor desde R5; el borrado de datos personales la sigue limpiando (`compliance.service.ts`) mientras exista (ADR 0011 §8).
- Públicas legacy de `TENANT_PUBLIC_PURGE_ORDER` (`prisma.service.ts`): verificar si existen y tienen filas.
- SMS: módulos `sms-credits/`, `sms-notifications/`, `billing/sms-checkout.*`, el adaptador, el flag, las pantallas `/admin/channels/sms`, `/admin/sms-packages` y `/admin/settings/integrations/sms-notifications`, y las tablas `sms_package_orders`, `sms_credit_ledger`, `sms_credit_balances` (créditos ya vendidos: decisión contable).
- `CREATE TABLE` duplicados en `tenant-schema.sql` (`courses`, `customer_memory_erasure`, `eval_runs`, `operational_notice_outbox`).

## Consecuencias

- Cada PR lleva su verificación (typecheck de las apps tocadas, `check:claims` de la landing, paridad i18n, specs que leen los mensajes, `verify:artifacts`).
- Un archivo borrado se recupera con `git show <commit>^:<ruta>`.

## Alternativas descartadas

- **Editar el validador de afirmaciones para retirar también `TestimonialsSection`, `TrustRow` y `VerticalsShowcase`:** el validador es la defensa de lo que la landing promete; cambiarlo es una decisión de producto, no limpieza.
- **Retirar pantallas del dashboard por «no enlazadas»:** el barrido de rutas no es fiable (el menú resuelve rutas desde contratos compartidos) y varias son de super_admin o se abren desde Assist; sin evidencia de que nadie las usa, se quedan.
