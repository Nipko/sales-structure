# 📋 Changelog — Parallext Engine

> Registro de todos los cambios significativos del proyecto.
> **Última actualización documental: 2026-08-11.** `v6.7.0` es el último release
> histórico enumerado abajo; no debe interpretarse como la versión runtime vigente.

---

## Sin publicar — Ago 11, 2026 (referencias de producto y ayuda)

- Se actualiza el manual web a v4.4 con la navegación vigente, roles explícitos,
  onboarding de cuatro pasos, Parallly Assist, operación móvil y las 18 verticales.
- Se incorporan referencias canónicas de capacidades y del contrato editorial entre
  documentación humana y la KB runtime del asistente en cuatro idiomas.
- Parallly Assist unifica la ayuda en un único chat respaldado por 25 artículos en
  cada idioma (`es`, `en`, `pt`, `fr`); se retira la segunda guía factual embebida
  en el dashboard para evitar respuestas y rutas contradictorias.
- `/copilot/chat` deriva tenant, identidad y rol exclusivamente de la sesión, valida
  página, idioma e historial, y añade contexto efectivo de plan y vertical desde el
  servidor. La búsqueda filtra por rol y combina relevancia semántica con la página
  actual sin permitir que el inicio desplace coincidencias exactas.
- El cliente limita el historial y la longitud de los mensajes; los contratos de KB,
  seguridad y UI pasan a ser gates explícitos de los workflows de calidad y deploy.
- Se separan el manual móvil actual y el informe histórico del build Android v3. La
  documentación no presupone aprobación ni disponibilidad pública en Google Play.
- La referencia de API aclara el body permitido y la identidad derivada de JWT para
  `/copilot/chat`, además del alcance distinto del Copilot contextual de Inbox.
- Parallly Assist aplica límites Redis por usuario/tenant, filtra artículos por rol
  y no expone detalles de plan a Supervisor/Agent. La ayuda enlaza ahora a una ruta
  `/support` real y localizada.
- La documentación queda fail-closed ante flujos todavía no certificados: aprobación
  terminal de deals, desconexión/reasignación de calendarios, lanzamiento/cancelación
  de campañas, conversión/pausa de drip, encuesta CSAT automática, Email autoservicio
  y ejecución pública de triggers del widget.
- Se corrige el aislamiento tenant de los triggers del widget, se ocultan sus IDs en
  la configuración pública y se alinean los roles de campañas, canales, CRM e Inbox.
- Inbox y su WebSocket derivan actor/tenant de la sesión, separan visibilidad de
  capacidad de actuar, aíslan salas y fanout por tenant, limitan Agent a hilos
  propios o sin asignar y reservan borrados/reasignaciones destructivas al rol
  correspondiente. El Copilot contextual aplica la misma propiedad y límites de uso.
- Se mantiene temporalmente el `PUT .../assign` usado por la app móvil v7: para Agent
  solo acepta su propio ID y se traduce a `claim` atómico sobre conversaciones libres;
  no permite reasignar. Los clientes actuales usan `/claim` y el alias queda deprecado.
- Los campos protegidos de CRM (`assigned_to`, `archived_at`) solo cambian por sus
  flujos dedicados; el update genérico ya no permite evadir los controles de rol.
- El ingreso administrado de Email exige JSON autenticado, destinatario canónico de
  envelope, límites de tamaño/tasa e idempotencia post-cola aislada por tenant; sin
  secret válido permanece deshabilitado de forma segura.

---

## v6.7.0 — Jul 22-23, 2026 (Gobernanza de super_admin + backup offsite + hardening del deploy)

> Endurecimiento de plataforma: se cierra el modelo de acceso del super_admin, se blinda el pipeline de deploy y se añade respaldo offsite verificable. Ver `docs/superadmin-governance.md` y `docs/backup-restore-runbook.md`.

### Gobernanza de super_admin e impersonación auditada (`84f4a509`, `9e95aebd`, `9e2ba98c`)
- **Sin tenant implícito**: el super_admin ya no "es" un tenant al entrar; opera en modo plataforma. `roles.ts` deniega por defecto (cada página nueva necesita su regla) y las rutas de tenant sin regla quedan cerradas.
- **`impersonate(superAdminId, tenantId, { reason, ticketId })`**: motivo obligatorio, tokens de vida corta (1h), sesión emparejada vía `impersonationSid` para distinguir sesiones reales de impersonadas.
- **Actor real en auditoría**: las escrituras hechas durante una impersonación registran al super_admin real (`impersonatedBy`, `impersonatedUserId`, `impersonatedEmail`), nunca al tenant_admin suplantado.
- Fix tenants (super admin): acciones visibles (sticky + fila clickeable), `status.expired` i18n, límite de listado 20→500.

### Backup offsite + restore de facturas DIAN (`aaa89512`, `395d7849`, `436fa730`, `f95e0719`)
- **pg_dump/pg_restore DENTRO del contenedor `parallext-postgres`** (antes fallaba por cliente ausente en el host); `.env` leído sin `source` (valores sin comillas rompían el shell).
- **Sincronización offsite S3-compatible vía rclone** (AWS S3 / Cloudflare R2 / Backblaze B2), configurable por `.env` (`OFFSITE_BUCKET/PROVIDER/REGION/ENDPOINT/ACCESS_KEY/SECRET_KEY`); vacío = solo local.
- **Volumen persistente + backup de las facturas fiscales DIAN** (`fiscal-invoices.tar.gz`) por retención legal.
- **Heartbeat `backup:last_success`** en Redis: `PlatformMonitorService` levanta el incidente `backup:stale` cuando la edad supera `backupStaleHours` (default **26h**).
- **Fix (2026-07-23)**: los scripts de infra (`infra/backup/*.sh`, `infra/scripts/*.sh`) se marcan ejecutables en git (**`100755`**) para que el checkout del VPS los pueda correr.

### Hardening del deploy (`3505f32b`, `f112d423`, `38a6a984`)
- **SSH key-only auth**: se retira la password del deploy; claves de deploy en `.gitignore` (`deploy_key`, `*.pem`, `id_ed25519/rsa`).
- **Throttling por IP real** (`CF-Connecting-IP` detrás de Cloudflare) + más endpoints protegidos.
- **Backup pre-migración + fail-fast** en migrate/seed + alertas de webhook de pago; gate de pre-conexión SSH con backoff antes del deploy.

---

## v6.6.0 — Jul 20-22, 2026 (SMS: notificación transaccional Fases 1-3 + monetización reseller F0-F3)

> Dos pistas de SMS: **transaccional** (plataforma y tenant→agente) y **monetizada** (tenant→cliente por créditos). El canal SMS **conversacional** quedó **descartado**. Ver `docs/sms-monetization-packages-2026-07.md` y `docs/sms-notifications-implementation-plan-2026-07.md`.

### SMS transaccional — Fases 1-3 (`7e818017`)
- **Nuevo módulo `sms-notifications/`**: alertas a super admin (Fase 1), notificación de handoff al agente (Fase 2), OTP del Customer Portal + 2FA por SMS del dashboard (Fase 3).
- **WhatsApp-first + SMS fallback**; operador **Twilio + Verify**; planos plataforma vs tenant, gating por plan + cuotas.

### SMS monetizado por paquetes — modelo reseller F0-F3 (`192d074a`)
- **Nuevo módulo `sms-credits/`**: los tenants compran créditos (1 crédito = 1 segmento) para notificar **one-way** a sus clientes vía el Twilio de la plataforma.
- **Balance + ledger atómico**, envío medido (broadcast + cola), compra por **MercadoPago (pago único)** vía `billing/sms-checkout`; UI tenant + super admin (tiers editables).
- **Kill switch maestro** del modelo reseller (`SmsCreditsService.isEnabled()`), **apagado por defecto**: mientras esté off no se envía ni se cobra nada (`11df2352`).

### Firma del webhook Twilio (`5c7da544`)
- **Validación HMAC-SHA1 de `X-Twilio-Signature`** antes de cualquier efecto secundario (antes se aceptaba el webhook SMS sin verificar).

---

## v6.5.0 — Jul 21, 2026 (Billing: planes anuales + Billing Ops cross-tenant + Stripe US LLC + landing /precios)

> Los 5 planes — **Emprendedor USD $21 · Starter $49 · Pro $129 · Enterprise $349 · Custom** (fuente: `apps/api/prisma/seed-billing-plans.js` + tabla `billing_plans`) — pasan a soportar ciclo **mensual/anual** (~15% de descuento anual). Ver `docs/billing-annual-cycle.md`.

### Ciclo mensual/anual en MercadoPago (`bec1e560`, `bb2b0c0f`)
- **Backend**: `billing.service` resuelve `providerPlanId` por (plan × país × ciclo); `BillingCycle` (year/month) persistido en signup para que la conversión trial→pago vincule el plan correcto.
- **Frontend**: toggle mensual/anual en checkout + panel admin; `priceLocalOverrides` con `annual.amountCents` por moneda (COP).

### Billing Ops cross-tenant (`445ce9a5`, `7c3711ef`, `f5c34de6`)
- **`billing-admin.controller`** + página `/admin/billing-ops`: vistas cross-tenant de suscripciones/pagos/eventos, **refund inline**, **reconciliación on-demand** (`reconciliation.processor`), downgrade que sincroniza con MercadoPago, sync de planes con MP desde el panel + badge de entorno.
- **Auditoría** en cambios de precio/plan del catálogo; seed de planes **create-only** para no pisar ediciones hechas desde el panel; **editor de planes registry-driven** con overrides completos.

### Stripe adapter (US LLC) (`billing/adapters/stripe.adapter.ts`)
- **Adapter Stripe desacoplado** (`payment-provider.interface`) para la vía **US LLC**, en paralelo al de MercadoPago (CO).

### Landing /precios data-driven (`f57f5f35`, `6d4805c9`)
- **`/precios`** de la landing se alimenta de `billing_plans` reales (antes hardcodeada); precios COP de Starter/Pro actualizados + fix del toggle mensual/anual.

---

## v6.4.0 — Jul 20, 2026 (Multi-canal por tipo de canal — N conexiones del mismo tipo)

> Un tenant puede conectar **varias cuentas del mismo tipo** (2 números WhatsApp, 2 IG…), gateado por **plan × canal**. Ver `docs/multi-channel-per-type-implementation-2026-07.md`.

### Multi-cuenta por tipo (`268966aa`, `e589a705`, `0107d1cf`)
- **Gating**: `features.maxChannelAccounts` (default **1**) + override por tenant.
- **Tokens por-cuenta** vía `channel_accounts.access_token` (**sin migración global**).
- **Un agente por conexión**: `agent_personas.channel_bindings` mapea persona → cuenta; **anti-conflación** de conversaciones entre cuentas.
- **UI**: editor adaptativo + overview con contador/límite + **disconnect por-cuenta** que des-suscribe al proveedor (`39391597`).
- **Broadcast**: selector de número de origen en campañas (`3528de0f`); **WhatsApp**: selector de número/WABA al crear plantillas (`52c65005`).

---

## v6.3.0 — Jun 14 – Jul 10, 2026 (Facturación electrónica DIAN Colombia vía Factus + gate fiscal)

> **T1.9 «factura fiscal» dejó de estar aplazado.** Se implementó como **factura electrónica de venta (FEV) colombiana vía DIAN**, con **Factus** como proveedor tecnológico (PT) — NO CFDI (MX) ni NF-e (BR). Ver `docs/facturacion-electronica-colombia-2026-06.md`.

### Módulo fiscal (`f6c9904a`, `43b1691c`)
- **Nuevo módulo `fiscal/`** con capa `IFiscalInvoiceProvider` desacoplada del PSP; adapter **Factus** (`factus.adapter.ts`) + adapter remoto US (`us-remote.adapter.ts`).
- **Modelo `FiscalInvoice`** (`fiscal_invoices`), migración `20260614000000_add_fiscal_invoices`, cola BullMQ + processor; **rollout por fases** (no emite hasta que el proveedor esté configurado).
- **Payload alineado a la doc oficial de Factus**: códigos DIAN (`identification_document_code`, `tribute_code` 01/ZZ), IVA excluido, nota crédito, **QR construido desde el CUFE**, auto-recuperación en **409** (factura pendiente por enviar a la DIAN).
- **Representación gráfica propia** (marca azul Parallly `#3897f0`): valor en letras, prefijo/rango, TRM, adquirente real; envío por correo (Factus con `send_email=false`) con **PDF + XML firmado en .zip**.

### Gate de datos fiscales (`1767c6f7`, `a01321bf`, `23596e92`)
- **Colecta antes de cobrar** (patrón Stripe/MoR): exige NIT/cédula del tenant CO antes de un flujo con cobro; **el trial gratis no se bloquea**.
- **Toggle super-admin** `fiscal.gate_enabled` (**apagado por defecto**), modal de checkout "completa tus datos fiscales" (`FiscalGateModal`), **`FiscalBanner`** montado en el admin layout (`c615596a`).
- **Opt-in "consumidor final"** (DIAN `222222222222`) como fallback; selector de municipio (DANE); script de backfill de tenants CO sin datos fiscales.

### Super-admin fiscal (`0e113e1b`, `2399cfa2`, `93fb2670`)
- Módulo super-admin: preview de PDF sin Factus, emitir factura de prueba real, descarga solo del **PDF propio** (no el de Factus), acción **"Re-emitir (forzar)"** para facturas sin CUFE, archivado por retención.

---

## v6.2.0 — Jun 23-25, 2026 (Ops Center / Centro de Operaciones + purga de tenant + bootstrap canónico)

### Ops Center — Centro de Operaciones (`3d2a269f`, `0a00658b`, `9d49ddab`, `7c7a0663`)
- **Hub super_admin `/admin/ops`** (`health/platform-monitor.service`, `incident.service`, `platform-storage.service`, `sms-alert.service`): centro de incidentes + señales de riesgo cross-tenant.
- **Señales**: saturación de conexiones PG, saturación de PgBouncer (`SHOW POOLS`), profundidad de colas BullMQ, breach de SLA cross-tenant, tasa de errores de la app (Sentry), `backup:stale`, canal Telegram/SMS de alertas.
- **Umbrales de alerta configurables por UI** (`alert-config.service`); badge de incidentes en el sidebar; botón **"Ejecutar chequeos ahora"**.
- **Monitoreo de almacenamiento por tenant** + enforcement de cuota + alerta temprana (snapshots, proyección, tendencia).

### Purga de tenant limpia (`8a69c8cc`)
- **`purgeTenant`**: cancela la suscripción en el PSP, revoca OAuth y cierra huérfanos; **retiene lo fiscal (DIAN)** por retención legal y **nunca revoca** el `system_user_token` compartido de WhatsApp.

### Bootstrap canónico (`4e931798`)
- Scripts canónicos completos y autosuficientes (schema global, plantilla de tenant, deploy, env): una DB fresca o un tenant nuevo salen **completos**; no re-añadir SQL crudo a `deploy.yml` (usar migraciones). Gemini env es `GOOGLE_GENERATIVE_AI_API_KEY`.

---

## v6.1.0 — Jun 11-19, 2026 (App móvil + Onboarding guiado + WhatsApp Flows + i18n 4-idiomas + feature-gating por plan)

### App móvil — Parallly Mobile (Expo / React Native)
- **Nueva app `apps/mobile`** (`@parallext/mobile`, Expo SDK 54): inbox + CRM + agenda + analíticas; outbound (WhatsApp, notas de voz, plantillas con variables), traducción inline, escáner de tarjeta de visita, tiempo real vía socket con refresh de token; tipos compartidos vía `@parallext/shared`.
- **Push nativo Expo** (nuevo módulo `push/` en API, `exp.host` — FCM/APNS sin VAPID); build **EAS** + Sentry source maps + readiness Play Store.

### Onboarding guiado (`a89068b2`, `0e49947e`, `36df08f6`)
- **Ruta crítica trial-first** + checklist en 3 niveles; pre-check de prerrequisitos WhatsApp antes del ESU; **tour guiado interactivo (Onborda)** vertical-aware; CTA "probá tu agente" tras conectar WhatsApp; evento TTFV `activation_first_channel_connected`; empty-state guiado en el dashboard. Ver `docs/onboarding-redesign-2026-q2.md`.

### WhatsApp Flows en booking (`3401bcdb`, `3af3e6e7`, `2b7fe7f1`)
- **Emitir WhatsApp Flow** al inicio del booking + fast-forward `nfm_reply`→confirm con fallback a texto; toggle + Flow ID en config de citas; parseo `nfm_reply` en el webhook (coexistencia prod).

### Feature-gating por plan + circuit breaker de costo LLM (`31817e36`, `7daa5a5f`)
- **Blindaje del feature-gating por plan** + validación de planes + **circuit breaker de costo LLM** (techo de gasto mensual → degrada a modelos más baratos; el agente sigue respondiendo).

### i18n — cierre 4 idiomas (`94896820`, `e70006d2`, `340ca75a`, `d8534b32`)
- **Barrido completo de hardcode** de cara al usuario (dashboard + landing + backend + emails) en **es/en/pt/fr**; email-templates con infra multi-idioma (columna `language` + slug único por idioma + selección con fallback); cobertura mundial de zonas horarias (fuente única en `@parallext/shared`); routing LLM por valor del turno + presupuesto de historial por tokens.

---

## v6.0.0 — May 31, 2026 (Roadmap Competitivo Q2 — COMPLETO: Tier 2 + Tier 3)

> Cierre del plan `docs/implementation-plan-2026-q2.md`. 9 features desplegadas; todos los ítems no aplazados completados (Tier 0-3). Cada feature: módulo backend + integración + página dashboard + i18n ×4, verificada con `tsc` + `test:bootstrap`.

### Tier 2 — Diferenciadores arquitectónicos

#### T2.13 — Agent Simulation pre-deploy (`8548b11`)
- **Nuevo módulo `simulation/`**: "CI/CD para tu agente IA". Corre N conversaciones simuladas contra la persona/KB **sin tocar producción** y las califica con el LLM-judge de T1.6.
- Reusa `AgentTestService` (pipeline completo, sin persistir, con `disableTools` → cero efectos en prod) y `QualityService.judgeTranscript` (juez compartido extraído).
- Escenarios **sintéticos** (generados por LLM por vertical) o **replay** de transcripts reales; cliente-simulador LLM para multi-turno; **diff de regresión** vs. baseline.
- Cola BullMQ `agent-simulation`, tabla `simulation_runs`. Página `/admin/agent/simulation` con polling + drawer de transcripción.

#### T2.17 — Agente dual-skillset (vende + soporte) (`f306618`)
- `TenantConfig.skillset` (sales/support/both) + `upsell` (intensidad + descuento máx) + `tools.ecommerce`. Layer 2 de la persona renderiza un bloque `<skillset>`.
- Nuevas AI tools: `recommend_products` (catálogo real vía EcommerceService), `get_order_status`, `apply_discount` (cap duro 30%).
- Layer 3 inyecta `<catalog>` real + `<recent_orders>` del cliente → "nunca inventa productos".
- Editor de agente (Capacidades): selector de skillset + upsell + tarjeta e-commerce.

#### T2.12 — Procedimientos por vertical (AOP/SOP) (`f9785f0`)
- **Nuevo módulo `procedures/`**: el tenant escribe un SOP en español → **compilador LLM NL→grafo** (borrador para revisión) → motor determinístico lo ejecuta (el LLM solo expresa, nunca decide el flujo).
- `ProcedureEngineService` (reusa AIToolExecutor): estado Redis, matching por keywords, step types message/ask/tool/condition/handoff con branching, 1 directiva por turno.
- Integrado en `conversations.service` tras el booking (todo en try/catch — nunca rompe el chat). Página `/admin/procedures` con editor de pasos.

### Tier 3 — Frontera y profundidad

#### T3.19 — Integraciones verticales reales (`a75d339`)
- **Nuevo módulo `vertical-integrations/`**: adapters Toast (restaurantes: menú/precios), Mindbody (gimnasios: clases), Cliniko (salud: tipos de cita + disponibilidad, sin tocar EHR). Config en `tenant.settings`, tabla `vi_items`, AI tools por proveedor conectado. Página en Settings → Integraciones.

#### T3.20 — MCP nativo (`617ee95`)
- **Nuevo módulo `mcp/`**: **consumir** servidores MCP externos (el agente gana tools vía estándar abierto) + **exponer** las tools de la plataforma (JSON-RPC sobre Streamable HTTP, autenticado con API key). Página en Settings → Integraciones → MCP.

#### T3.21 — CRM B2B + forecast/rotting/weighted (`fba00ed`)
- **Nuevo módulo `crm-b2b/`**: organizaciones (sobre tabla `companies` existente), **valor ponderado** del pipeline (Σ valor × probabilidad), comprometido/mejor-caso, velocity, y **deal rotting** (cron 6h marca deals estancados). Página `/admin/contacts/organizations`.

#### T3.22 — Click-to-WhatsApp attribution + revenue (`a5a1fc7`)
- **Nuevo módulo `attribution/`**: captura el `referral` de anuncios CTWA en el webhook de WhatsApp; deriva el embudo Ads→WhatsApp→venta + ingresos por anuncio y por campaña broadcast. Página `/admin/attribution`.

#### T3.23 — Reviews/reputación con IA (`5330bd9`)
- **Nuevo módulo `reviews/`**: conecta Google Business Profile (OAuth), sincroniza reseñas, genera respuestas con IA en español (consciente del rating) y las publica; cron de sync + auto-reply. Página en Settings → Integraciones → Reseñas.

#### T3.24 — Tier managed / done-for-you (`d95af7e`)
- **Nuevo módulo `managed/`** (super-admin): marca tenants como gestionados con **garantía de % de resolución** y trackea lo real vs. objetivo (apalanca T0.1 + T1.8). Página `/admin/managed`.

### Aplazados (no trabajados)
T0.3 payment-at-booking · T2.15 SaaS Mode/rebilling · T3.18 Voice AI.

> **Actualización jun-jul 2026:** T1.9 «factura fiscal» dejó de estar aplazado — se implementó como **factura electrónica de venta (FEV) colombiana vía DIAN/Factus**, NO como CFDI (MX) ni NF-e (BR). Ver **v6.3.0** (Facturación electrónica DIAN vía Factus).

---

## v5.4.0 — May 27, 2026 (Public API + Workflows HTTP + Inbox Collision + Drip Sequences + Email Channel + Zapier)

### Fase A — Foundations

#### Public REST API + API Keys
- **Nuevo módulo `public-api/`**: Gestión completa de API keys (crear/revocar/rotar) con almacenamiento hasheado SHA-256 y permisos por scopes (11 scopes: contacts, conversations, deals, campaigns, knowledge, appointments, properties, analytics, agents, automations, webhooks)
- **Validación Redis-cached**: Lookup por hash con TTL, evita consulta DB en cada request
- **Rate limiting por plan**: Sliding-window — Pro: 60 rpm, Enterprise: 300 rpm. Headers estándar `X-RateLimit-Remaining/Reset`
- **Swagger docs** en todos los controllers del módulo público
- **Dashboard `settings/api-keys/page.tsx`**: Tabla de keys con copy-once display (la key completa solo se muestra al crear), checkboxes de scopes, gating por plan, revocación con confirmación

#### HTTP Request Step en Workflows
- **Nuevo action type `http_request`** en el motor de automatización: permite llamadas HTTP arbitrarias como paso de un workflow
- **`HttpRequestService` compartido** (extraído de webhooks) con protección SSRF (bloqueo de IPs privadas, resolución DNS previa)
- **Interpolación de variables**: `{{contact.name}}`, `{{contact.phone}}`, `{{conversation.id}}` en URL, headers y body
- **Extracción JSONPath** de la respuesta para alimentar pasos siguientes
- **Secrets cifrados** (AES-256-GCM) para tokens/API keys en headers de automatización
- **Timeout y retry configurables** por paso
- **Dashboard**: `HttpRequestNode.tsx` + `VariableSelector.tsx` integrados en FlowBuilder con preview de variables disponibles

#### Collision Detection en Inbox
- **Redis ZSET `viewing:{tenantId}:{conversationId}`** con heartbeats de agente cada 15s, limpieza de stale >30s
- **WebSocket events**: `conversation:viewing_start`, `conversation:viewing_stop`, `conversation:heartbeat`, `conversation:viewers_update`
- **Dashboard `ViewersIndicator.tsx`**: Avatares/pills de agentes activos en la conversación, tooltip con nombre y tiempo activo
- **Prevención de conflictos**: Indicador visual cuando otro agente ya está respondiendo en la misma conversación

#### AI Resolution Rate Tracking
- **Nuevas columnas en conversations**: `was_handed_off` (BOOLEAN), `handoff_at` (TIMESTAMPTZ), `ai_message_count` (INT), `resolution_type` (ENUM: ai_resolved, agent_resolved, auto_resolved)
- **Endpoint de analytics**: `GET /analytics-v2/:tenantId/ai-resolution` — tasa de resolución IA vs agente, tiempo promedio, tendencia semanal
- **Dashboard widget `AiResolutionWidget.tsx`**: KPI tiles (% resuelto por IA, por agente, auto), gráfico de tendencia, integrado en la página analytics-v2

### Fase B — Mid-Value Features

#### Drip Sequences
- **Nuevas tablas**: `drip_sequences` (nombre, estado, trigger, stop conditions) y `drip_enrollments` (contacto, paso actual, estado, timestamps)
- **Pasos con delays configurables**: Mensajes tipo template, AI-generated o custom con intervalos en minutos/horas/días
- **Stop conditions**: replied (contacto respondió), converted (deal cerrado), manual unenroll
- **Reutiliza BullMQ nurturing queue** con job type `drip_step` — misma infraestructura de retry y prioridad por plan
- **Dashboard**: Página de listado con estado/enrollments + editor timeline con step cards arrastrables, preview de mensaje, selector de delay

#### Content Gap Analytics para KB
- **Nueva tabla `kb_feedback`**: satisfaction scoring (thumbs up/down) vinculado a documentos de knowledge base por conversación
- **Gap report**: Queries sin respuesta (fallback count), documentos con baja satisfacción, detección de contenido stale (sin hits en 30+ días)
- **Dashboard**: Tab "Gaps" en la página de knowledge con tabla ordenable por impacto + `KbFeedbackWidget.tsx` con thumbs up/down en mensajes AI del inbox
- **Endpoint**: `GET /knowledge/:tenantId/gaps` — top queries sin match, documentos problemáticos, recomendaciones

#### Multiple Pipelines
- **Nueva tabla `pipelines`**: Soporte multi-pipeline con `pipeline_id` como FK en stages y deals
- **Migración**: Pipeline default creado automáticamente para tenants existentes, stages existentes vinculados
- **Plan-gated**: emprendedor: 1 pipeline, pro: 3, enterprise: 10
- **Dashboard**: Selector de pipeline por tabs sobre el kanban, modales CRUD para crear/editar/eliminar pipelines, drag de deals entre pipelines

#### Automation Templates Library
- **Tabla global `automation_templates`**: 15+ templates pre-construidos en 8 categorías (lead nurturing, follow-up, appointment, onboarding, re-engagement, feedback, upsell, notification) × 12 industrias
- **Flujo de instalación**: Al instalar, se crea `automation_rule` con sustitución de variables del tenant (nombre, industria, canal)
- **Dashboard**: Galería con filtros por categoría e industria, cards con descripción y preview, modal de instalación con personalización de variables antes de activar

### Fase C — Advanced Features

#### Zapier Webhook Subscriptions
- **Tabla global `webhook_subscriptions`**: Patrón REST Hook (subscribe/unsubscribe) compatible con Zapier, Make, n8n
- **HMAC-SHA256 signed dispatch**: Cada payload firmado con secret por suscripción, header `X-Parallly-Signature`
- **Event bridge**: 5 eventos — `lead.created`, `message.received`, `conversation.closed`, `deal.stage_changed`, `appointment.booked`
- **Protección SSRF**: Validación de URL destino (bloqueo IPs privadas, resolución DNS), retry con backoff exponencial (3 intentos)
- **Endpoints**: `POST /webhook-subscriptions/:tenantId/subscribe`, `DELETE .../unsubscribe`, `GET .../list`

#### Email as Channel
- **`EmailAdapter`** implementando `IChannelAdapter`: Integración completa de email como canal de conversación
- **Inbound**: SendGrid Inbound Parse webhook — recibe emails, parsea HTML, extrae thread ID, crea/continúa conversación
- **Outbound**: SMTP/SendGrid con templates HTML, tracking de threads (`email_threads` table), sanitización HTML (DOMPurify)
- **`'email'` añadido a ChannelType**: Un agente AI puede atender email igual que WhatsApp/IG/Messenger/Telegram/SMS
- **Idempotencia**: Redis key `idem:email:{messageId}` con 24h TTL
- **Dashboard `channels/email/page.tsx`**: Formulario de setup (dominio, SendGrid API key, dirección de recepción), verificación de DNS, estado de conexión

#### A/B Testing en Broadcasts
- **Nueva tabla `campaign_variants`**: Variantes A/B por campaña con porcentaje de split y contenido independiente
- **Asignación seeded random**: Distribución determinista de destinatarios por variante usando seed de campaña
- **Significancia estadística**: Z-test con auto-selección de ganador cuando p < 0.05
- **Auto-winner**: Al alcanzar significancia, la variante ganadora se envía automáticamente al grupo restante
- **Dashboard**: Editor de variantes side-by-side, slider de split (%), resultados con badges de significancia (delivered, read, replied por variante)

#### Proactive Widget Triggers
- **Nueva tabla `widget_triggers`**: Reglas de activación proactiva del web chat widget
- **5 tipos de condición**: `time_on_page` (segundos), `scroll_depth` (%), `exit_intent` (mouse leave viewport), `page_url` (regex match), `visit_count` (nth visit)
- **3 acciones**: `open_widget` (abre el chat), `show_bubble_message` (burbuja con texto custom), `show_banner` (banner superior/inferior)
- **Evaluación client-side**: Lógica en el SDK del widget con frequency capping (max 1 trigger por sesión por regla, configurable)
- **Dashboard**: Editor de reglas con selector de condición, configuración de acción, preview visual, toggle activo/inactivo

### Plan Gating Additions
- **Nuevas feature flags**: `publicApi`, `publicApiKeys`, `publicApiRateLimit`, `httpRequestAction`, `maxPipelines`, `maxDripSequences`, `maxWebhookSubscriptions`, `abTestBroadcasts`, `widgetTriggers`
- **`email` añadido a `channels[]`** en la configuración de plan
- **Enforcement**: Todos los endpoints nuevos verifican plan del tenant antes de ejecutar

### Notas Técnicas
- Todas las features incluyen i18n en 4 idiomas (es/en/pt/fr)
- Todos los queries usan `::uuid` casts, columnas snake_case, SQL dividido para compatibilidad PgBouncer
- Redis con TTLs explícitos en todas las keys nuevas (viewing: 60s, drip jobs: según delay, webhook retry: 5min)
- Patrón lazy table migration: tablas creadas en `add-missing-tables.js` al detectar ausencia

---

## v5.3.0 — May 27, 2026 (LLM Router Redesign + Compliance Overhaul + AI Usage Dashboard)

### LLM Router Redesign
- **Complete rewrite of LLMRouterService**: Replaced broken score-based routing with task-based routing. Two task types (`conversation` and `tool_calling`) with ordered fallback chains per task
- **MODEL_REGISTRY**: 8 models across 4 tiers — tier_1_premium (claude-sonnet-4-6), tier_2_high (gpt-4o, grok-4-1-fast), tier_3_balanced (gemini-2.5-flash, gpt-4.1-mini), tier_4_budget (deepseek-chat)
- **Circuit breaker pattern**: In-memory provider health tracking (2min cooldown), Redis failure counters (10min TTL)
- **Plan-based tier restrictions**: starter (tier_3+4), pro (tier_2+3+4), enterprise (all tiers). Auto-escalation to higher tiers when all candidates exhausted
- **Fixed**: Gemini excluded from `tool_calling` chains (provider doesn't implement function calling)
- **Fixed**: Previous dual-model routing (grok/gemini hardcoded) was completely inert — `routingFactors` path always overrode it

### LLM Health Monitoring
- **3-layer alerting**: WebSocket real-time → cron email (every 10min) → API health endpoint
- **`GET /health/llm-providers`** (super_admin): Returns per-provider health status
- **EventEmitter2 alerts** at 3/10/25 failure thresholds
- **Dashboard TopBar**: LLM alert notifications via `socket.on("system:llm_alert")` + browser push for critical alerts
- **i18n keys**: `llmCritical`, `llmWarning`, `llmDown` (× 4 languages)

### Compliance Module Redesign
- **Legal texts expanded**: Name (VARCHAR 255), description (TEXT), document type (7 standard types: general, privacy_policy, terms_of_service, consent_to_process, ai_disclosure, opt_in_message, opt_out_confirmation)
- **Multi-channel assignment**: `channels TEXT[]` array (was single VARCHAR channel)
- **Multi-agent assignment**: `agent_ids UUID[]` array
- **Dashboard**: Chip-based multi-select for channels and agents, type filter, improved card layout with color-coded badges
- **Migration**: `ALTER TABLE` for existing tenants in `add-missing-tables.js`

### Unified AI Usage Dashboard
- **Fixed zero-value bug**: `tenantId` was never threaded to Redis tracking at 5 service call sites (copilot, intent-interpreter, nurturing, crm-insights, agent-console)
- **Token tracking**: `executeStream()` in llm-router now tracks tokens; `generateEmbedding()` in knowledge.service writes Redis stats
- **`getUnifiedAiUsage()`**: Aggregates LLM + media + embeddings by month/category/provider
- **`GET /tenants/ai-usage`** (super_admin): New endpoint
- **Dashboard page rewritten**: Monthly selector, 4 KPI tiles, stacked bar charts, category breakdown, provider attribution, tenant ranking

### Agent Editor Redesign
- **Tabs layout**: Identity, Behavior, Tools, Advanced
- **Tone presets**: professional, friendly, casual, formal
- **All 12 vertical tools** exposed prominently in agent capabilities editor — no hidden tool section, all tools visible and easily toggleable

### CRM Import/Export
- **Native Excel (.xlsx) imports**: Drag-and-drop dropzone, E.164 phone dedup, delimiter detection, company resolution
- **Tabular Excel exports**: Full contact data export
- **Export download crash fixed**
- **Import template redesign**: Multi-sheet guidance

### Handoff Notifications
- **Real-time handoff notifications** in inbox
- **Browser push notifications** for new handoffs
- **Multi-agent cache invalidation fix**

### Other Features
- **Geographical country metrics**: Country-level analytics for tenants
- **Booking engine improvements**: Loop optimization, stale state clearing, variational Spanish templates
- **APPOINTMENT_TOOLS registration fix**: Tools were not registered in `conversations.service.ts`
- **Tool execution unblocked**: Tool execution was blocked when appointments disabled — properties/catalog/etc never ran

### Bug Fixes & Hardening
- **UUID casting fixes** across appointments, vacation-rental, KB, segments, and critical backend modules (8 commits)
- **Deep audit round 2**: Schema mismatches, uuid casts, error handling across API + dashboard
- **Critical security + stability fixes** from comprehensive audit
- **KB uuid casts** + standardized toast feedback across 6 pages
- **WhatsApp**: Removed nonexistent `messaging_limit` field from Meta API call
- **Migration**: `system_updates` table added
- **Error feedback**: Added to catalog and landings pages
- **iCal**: Soft-deleted feeds filtered from `listFeeds`
- **Property UX fixes**: Delete button, number coercion, currency default, snake_case→camelCase key mapping fix
- **Property create**: Sends snake_case keys correctly (API expects camelCase fix)

---

## v5.2.0 — May 6, 2026 (Tier 1 Verticals Sprint + Channels Hardening)

### Sprint Tier 1 — Three new operational verticals

**Sprint #1 — Tours & Travel Packages** (`turismo` sub-types: `tours`, `agencia_viajes`)
- New schema: `tour_packages` (unified hours-based experiences + days-based packages), `tour_inventory` (per-departure capacity, optional), `tour_bookings` (status: reserved/confirmed/completed/cancelled/no_show)
- New `ToursModule` with 12 REST endpoints under `/tours/:tenantId/...`
- 4 AI tools (gated by `config.tools.tours.enabled`): `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`
- Dashboard: `/admin/tours` (list with sale/rent filter pills + create modal) and `/admin/tours/[id]` (Info/Cupos por fecha/Reservas tabs)
- Bootstrap: 5 ops-focused FAQs (transfer, child discount, languages, cancellation, meeting point) seeded automatically on `tours` / `agencia_viajes` sub-types; `config.tools.tours.enabled = true` flipped on default agent
- 2 vertical agent templates: `tpl_turismo_tours` (Maya — Tours del Día), `tpl_turismo_agencia` (Maya — Agencia de Viajes)

**Sprint #2 — Salud / Dental + transversal recall** (`salud` sub-type: `dental`)
- New schema: `treatment_plans` (multi-session treatments — orthodontics, physiotherapy, aesthetic series, etc.), `treatment_sessions` (per-session tracking, status pending/scheduled/completed/cancelled/no_show), plus `contacts.last_appointment_at` + `contacts.next_recall_at` columns with index
- New `TreatmentPlansModule` with 8 REST endpoints
- 2 AI tools (gated by `config.tools.treatments.enabled`): `get_treatment_plan`, `list_upcoming_sessions`
- Dashboard: `TreatmentPlansCard` collapsible component on lead detail (visible only when vertical=salud)
- New cron 9 AM daily: `RecallService.processRecalls` — re-engages contacts with `last_appointment_at` older than configured threshold via WhatsApp template (transversal: dental 6-month, gym lapse, aesthetic series)
- Recall config endpoints: `GET/PUT /recall/:tenantId/config`, `POST /recall/:tenantId/run-now`
- Hooks added to `appointments.update` and auto-complete cron to keep `contacts.last_appointment_at` fresh
- Vertical agent template: `tpl_salud_dental` (Sofía dental with urgency triggers + treatment plan integration)
- Bootstrap: 5 dental-specific FAQs (insurance, cost, pain management, orthodontics duration, emergencies) on sub-type `dental`

**Sprint #3 — Real Estate Listings** (`inmobiliaria` sub-types: `venta`, `arriendo`, `comercial`, `construccion`)
- New schema: `real_estate_listings` (transaction_type sale/rent + property_kind + price/HOA/deposit + bedrooms/bathrooms/m²/parking/stratum + lat/lon + amenities/images + status), `listing_zone_agents` (neighborhood → agent mapping for routing)
- New `ListingsModule` with 11 REST endpoints (CRUD, search, zone CRUD)
- 2 AI tools (gated by `config.tools.realEstate.enabled`): `search_listings`, `get_listing_details`
- Dashboard: `/admin/listings` (card grid with sale/rent filter) and `/admin/listings/[id]` (full editor with sale-only / rent-only fields)
- Sidebar visible only when vertical=inmobiliaria
- Vertical agent template: `tpl_inmobiliaria_listings` (Carlos with explicit search_listings rules + viewing booking flow)
- Bootstrap: 5 inmobiliaria FAQs (financing, viewings, commissions, documents, HOA)

### Vertical agent templates — 4 industries that had ZERO

Added 8 new templates so finanzas, servicios_profesionales, retail, and technology stop falling through to the generic builtins:
- **finanzas**: Roberto (calificador credit/insurance + renovaciones)
- **servicios_profesionales**: Elena (consulta inicial + seguimiento de casos)
- **retail**: Sofía (ventas + postventa)
- **technology**: Diego (BANT calificador B2B + soporte L1)

Each template ships with industry-tuned tools enabled, behavior rules, forbidden topics, and handoff triggers (e.g. finanzas blocks giving exact rates, servicios_profesionales escalates substantive case questions, retail captures preferences, technology refuses enterprise pricing).

`VERTICAL_PREFIXES` extended on the dashboard with `tpl_finanzas_`, `tpl_legal_`, `tpl_retail_`, `tpl_technology_` so they group under "Recomendados para tu negocio".

### Channels hardening — disconnect actually disconnects

- **Real provider unsubscribe on every channel**: WhatsApp now calls `DELETE /<waba>/subscribed_apps` (was no-op), Telegram captures `deleteWebhook` HTTP status (was best-effort `.catch`), Messenger iterates ALL Pages (was only first), Instagram captures status code, SMS clears `SmsUrl` on every IncomingPhoneNumber via Twilio API
- **`metadata.disconnected_at_provider`** flag stamped per channel — used by reactivate path to decide whether is_active flip is enough or full OAuth reconnect required
- **`audit_logs` row** for every disconnect (manual or via offboarding cron) with `triggeredBy`, `providerOk`, `providerError`
- **Honest UX**: dashboard shows green banner if provider OK, **amber banner** with concrete instruction if provider call failed ("revisar la integración manualmente"). Red banner only for network errors
- **Refresh tokens revoked** on disconnect when provider call succeeded
- **Frontend banners**: 3-state messaging (success/warning/error) on whatsapp/messenger/instagram/telegram/sms. New i18n key `disconnectPartial` × 4 languages
- **Reactivate path**: `OffboardingService.reactivate` now restores channel_accounts that the cron turned off, EXCEPT those marked `disconnected_at_provider=true` (those need fresh OAuth — flipping the flag back on would lie to the user)

### Tenant lifecycle — full purge with provider unsubscribe + media wipe

- **`OffboardingService.purgeTenant(tenantId)`** — 9-step orchestration: providers → queue drain → user IDs captured → public-schema rows (FK-safe order) → DROP SCHEMA CASCADE → `/data/media/{tenantId}/` wipe → tenants row → Redis (incl. refresh tokens per user) → emit `tenant.purged` event
- **`DELETE /offboarding/:tenantId/purge`** super_admin endpoint — irreversible, returns summary `{ channelsDisconnected, publicRowsDeleted, schemaDropped, mediaFilesRemoved, usersRevoked }`
- **`MediaService.deleteAllTenantFiles(tenantId)`** — recursive wipe of `/data/media/{tenantId}/` (logos, product photos, property photos, tour photos, attachments). Path traversal protection
- **New cron 5 AM daily**: `purgeStaleInactiveChannels` — hard-deletes `channel_accounts` rows with `is_active=false` and `disconnected_at >90 days` ago. Patrón Shopify/HubSpot: grace window for reconnect, automatic cleanup after. One audit_log batch per run with the list of purged channels
- **`infra/scripts/delete-tenant.sh`** — dual-mode: with `--api-token` (or `PARALLLY_SUPER_ADMIN_TOKEN` env) calls the purge endpoint (preferred). Without a token, falls back to direct SQL + Redis + filesystem wipe. Also revokes user refresh tokens via `refresh:<userId>:*` Redis keys
- **`infra/scripts/delete-tenant.sql`** — auto-resolves `schema_name` from the `tenants` row (was using display name and silently skipping `DROP SCHEMA`). Per-table `ROW_COUNT` logging. Adds missing `feature_request_subscribers`

### Inbox — recover auto-resolved conversations

`NurturingService` cron auto-marks conversations as `resolved` after 72h of inactivity, but the inbox query hid them with no way to find them. Added:
- New filter `'resolved'` in `getInbox` — inverts the base status filter, orders by `resolved_at DESC`, cap 200 rows
- Endpoint `POST /agent-console/conversation/:tenantId/:id/reopen` — flips status back to `'active'`, clears `resolved_at`
- Frontend: new "Resueltas" pill in the inbox toolbar; when viewing a resolved thread the message input hides and is replaced by a banner with check icon + "Reabrir conversación" button. After reopen, the filter switches to "all" automatically so the thread reappears
- 3 new i18n keys: `filterResolved`, `resolvedBanner`, `reopenConversation` (× 4 languages)

### Onboarding & setup-wizard fixes

- Setup wizard infinite-redirect bug: "Skip" only navigated to `/admin`, but the dashboard checked `setupWizardCompleted` and redirected back. New `POST /persona/:tenantId/setup-wizard/skip` flips the flag; "Finish" without a template now falls through to skip
- Setup wizard now serves vertical-specific templates: `GET /persona/templates?tenantId=...` resolves industry server-side, returns `getVerticalTemplates(industry) + getBuiltinTemplates()` normalised so the existing form code doesn't branch
- `POST /persona/:tenantId/setup-wizard` now resolves the templateId across all 3 sources (legacy, builtins, verticals)

### Vertical onboarding fixes (May 2 backlog)

- i18n industry keys aligned: `educación → education`, `tecnología → technology` in 4 languages (mismatch made dropdowns show empty labels)
- `completeOnboarding` response now includes `verticalConfig`; saved to localStorage so dashboard adapts immediately on first load
- `verticals.service.getVerticalConfig` rebuilds + persists config from `tenant.industry` for tenants created before the persistence fix
- `persona.service.listTemplates` resolves industry server-side from `tenant.settings.verticalConfig.industry || tenant.industry` when not passed by client
- Empty-state strings for finanzas / servicios_profesionales / retail / technology added to `verticalEmptyStates`, `verticalChecklist`, `verticalWelcome` (× 4 languages)
- Sidebar `nav.items.tours` was missing in 4 languages — caused literal "nav.items.tours" rendering

### Properties UX overhaul

- `iCal feed`: payload mapping fix (snake_case → camelCase) — was returning 400 silently. URL validation client-side. How-to panel with 3-step instructions in 4 languages
- `Photos tab` (new dedicated tab): drag-and-drop multi-upload, per-file size + type validation (max 5 photos × 2 MB each), progress bar `n of total`, set-as-cover action, reorder, sticky save bar appears only when dirty. Endpoint corrected (`/media/upload/{tenantId}` not `/media/upload`) and accessToken read from the right localStorage key
- `Calendar tab`: range block (click start → click end → modal with optional note), per-cell source label (Manual / Airbnb / Booking / Vrbo), tooltip with summary, unblock confirmation modal
- `Form numbers`: new `NumberField` component (`type=text` + `inputMode=numeric`) — fixes the "phantom 0 you can't delete" bug. Save now sends camelCase (was silently dropped by backend)
- `Property updateProperty`: response field mapping fixed
- `iCal sync`: auto-trigger sync on feed creation, surface error in UI, correct field names (`feed_name`, `last_sync_at`, `last_sync_status`, `last_sync_error`)
- `IcalExportPublicController` (new): public endpoint `GET /vacation-rental/:tenantId/properties/:propertyId/ical` — what the dashboard tells users to paste into Airbnb/Booking. Resolved 404 that broke external sync
- Media URL resolution: `<img src>` paths now resolve against API origin (`api.parallly-chat.cloud`) not dashboard origin

### Documentation reorganisation

- `CLAUDE.md` reduced 762 → 134 lines; full content moved to:
  - `docs/architecture-detail.md` (prompt layers, 5-tier knowledge, auth, OAuth flows, calendar, observability, BullMQ, pipeline)
  - `docs/modules-reference.md` (40 modules, key files, dashboard pages, cron jobs)
  - `docs/analytics-billing-reference.md` (analytics endpoints, Redis keys, schemas, billing, offboarding, financials, super admin, vertical, vacation rental, CRM, handoff)

---

## v5.1.1 — May 2, 2026

### Navigation Redesign (Definitive)
- **Sidebar corrected**: 3 named sections (OPERACIÓN, CRECIMIENTO, GESTIÓN) with 14 visible items
- Previous 8-item sidebar made platform feel empty — Automation, Channels, Knowledge Base, Users returned to main nav
- **Section grouping**: OPERACIÓN (Conversaciones, CRM, Embudo, Agenda, Propiedades), CRECIMIENTO (Campañas, Automatización, Agente IA, Base de Conocimiento), GESTIÓN (Analíticas, Canales, Usuarios)
- **Premium visual**: left-border active state (Linear pattern), tenant name header, user avatar footer, 240px width
- **Settings cleaned**: 5 sections, ZERO external links (was 8 sections with broken external links)
- **Role-based**: campaigns/automation/KB = supervisor+, aiAgent/users = admin+

### Breadcrumbs & i18n
- **79+ hardcoded strings** migrated to i18n in TopBar
- 47 breadcrumb labels, 7 notification categories, 3 theme labels, 3 user menu entries — all i18n
- 25 missing page labels added (settings subpages, properties, scoring config, etc.)
- New `topbar` namespace with ~90 keys in all 4 language files
- Zero hardcoded strings remaining in TopBar component

### Contextual Help System
- **HelpPanel component** (`components/ui/help-panel.tsx`) on ALL 15 admin pages
- Collapsible "?" pill button → expands to: title, description, YouTube iframe embed, image grid, tips list
- 15 section-specific help contents in 4 languages (~300 keys in `help` i18n namespace)
- YouTube embed: full width, `aspect-video` ratio, fullscreen-capable

---

## v5.1.0 — May 2, 2026

### Navigation Restructure
- **Sidebar reduced from 22 to 8 items** following HubSpot/Intercom/Zendesk patterns
- **Settings reorganized into 8 domain sections**: Account, Company, AI & Automation, Channels, Catalog & Data, Content, Team, Privacy & Advanced
- **Analytics consolidated**: 10 tabs (added CRM + Agents) — no more separate report pages
- **Role-based navigation**: campaigns=supervisor+, aiAgent=admin+, settings sections=admin+
- **10 orphan pages** now accessible via Settings (alerts, policies, landings, scoring config, pre-chat forms, etc.)
- **Propiedades** sidebar item scoped to turismo vertical only

### Onboarding Vertical Overhaul
- **Step 2 adapted per vertical**: "Pacientes particulares" (health), "Compradores" (real estate), etc.
- **Step 3 adapted per vertical**: "¿Cómo ayudará Sofía a tus pacientes?" with industry-specific goals
- **16 vertical agent templates** across 7 industries (salud, belleza, inmobiliaria, restaurantes, automotriz, turismo, educación)
- **Template picker**: "Recomendados para tu negocio" shown first when creating agents, filtered by tenant vertical

### Properties UX Overhaul
- **30 amenities in 6 categories** (was 12 flat checkboxes): Básicos, Dormitorio & Baño, Cocina, Exterior, Servicios, Seguridad
- **Description field** for rich property details in create/edit modal
- **Image gallery** with upload via MediaService — first image is card thumbnail in list view
- **Calendar as Tab 1** (most important view for vacation rental operators)
- **"Sync availability" banner** when no iCal feeds connected, links directly to iCal Feeds tab

### Email Templates Transversal
- **5 new default templates**: property_booking_confirmation, property_check_in_reminder, appointment_confirmation_email, appointment_reminder_email, handoff_notification
- **Automatic email flows**: booking → confirmation email, appointment created → confirmation email, handoff → template instead of hardcoded string
- **Template picker wizard**: 6 presets (appointment confirm, reminder, booking confirm, check-in reminder, welcome, team notification)
- **Total default templates**: 14

### Security Fixes
- **CRITICAL**: `getAvailableAgents()` cross-tenant data leakage — conversations table queried without schema scope. Fixed with `executeInTenantSchema`
- **Schema reuse**: `createTenantSchema()` now detects and cleans stale data when slug is reused after tenant deletion
- **Checklist fallback**: `.has()` check prevents MISSING_MESSAGE errors for undefined vertical keys in onboarding checklist
- **Analytics column**: `date` → `start_at` in appointment queries

---

## v5.0.0 — April 30, 2026

### Vertical Adaptation System (12 Industries)
- **Industry Auto-Bootstrap**: On tenant creation, the entire platform adapts based on selected industry — pipeline stages, AI agent persona, FAQs, services, business hours
- **12 Verticals**: salud, moda_belleza, inmobiliaria, restaurantes, automotriz, turismo, education, finanzas, servicios_profesionales, retail, technology, otro
- **Sub-types**: Each industry has 3-5 sub-types (e.g., salud → dental, medica_general, estetica, psicologia)
- **4-language support**: All vertical definitions in es/en/pt/fr
- **LLM Vertical Context**: `<vertical_context>` XML injected into prompt assembler with customer_noun, transaction_noun — the AI naturally uses industry vocabulary
- **Dashboard Visual Adaptation**:
  - Contextual welcome ("Bienvenido a tu consultorio virtual, Dr. López")
  - Industry-specific homepage (agenda for clinics, recent leads for real estate)
  - Vertical KPIs (Citas Hoy/No Shows for health; Leads/Test Drives for automotive)
  - Empty states with industry vocabulary on 5 pages × 8 industries
  - Onboarding checklist adapted ("Configura tu asistente médico", "Carga tu menú")
- **Sidebar Adaptation**: Dynamic label overrides (CRM→Pacientes), hidden items (no Inventory for clinics), item reordering
- **useVerticalTerms() Hook**: Locale-aware terminology propagation across contacts, pipeline, inbox, analytics, broadcast, lead detail pages

### Vacation Rental Module
- **Properties CRUD**: Create/manage rental properties with plan-gated limits (starter:2, pro:10, enterprise:50)
- **iCal Import**: Parse Airbnb/Booking.com .ics feeds with node-ical, cron every 30 minutes
- **iCal Export**: Generate .ics feeds with ical-generator for platforms to consume
- **Public Feed**: `GET /public/ical/:tenantSlug/:propertyId/:token/calendar.ics` (no auth)
- **Anti-Double-Booking**: Availability check merges ical_blocks + property_bookings with overlap detection
- **5 AI Agent Tools**: list_properties, check_property_availability, get_property_details, get_check_in_instructions, create_property_booking
- **Dashboard**: Properties list page + detail page with 5 tabs (Info, Calendar, Bookings, iCal Feeds, Check-in)
- **Calendar View**: CSS grid month view with color-coded days (green=available, red=booked, amber=blocked external, gray=past)
- **4 New Tables**: properties, ical_blocks, ical_feeds, property_bookings

### Super Admin Enhancements
- **Tenant Engagement Endpoint**: `GET /tenants/:id/engagement` — messages 7d/30d, active conversations, handoffs, agents/FAQs/services/stages counts
- **Health Score System**: 0-100 per tenant (channels:20 + agent:20 + FAQs:15 + services:10 + activity:35)
- **Tenant Detail**: 6 tabs (added Engagement + AI Config with health score circle, activity KPIs, agents list, pipeline stages)
- **Tenants Overview**: Vertical badge column + health dot indicator
- **Platform Dashboard**: 6 KPIs (tenants, users, active, messagesToday, pendingHandoffs, vertical distribution)
- **Cross-Tenant Metrics**: getPlatformStats() aggregates messages + handoffs across all tenant schemas

### Frontend Features
- **Scoring Config Settings** (`/admin/settings/scoring-config`): Weight sliders (5 factors), purchase keyword tags, score decay toggle with days/factor controls
- **AI Insights Card**: Collapsible card on lead detail page, lazy-loads AI analysis on first expand
- **Deal Approval UI**: Pending/rejected badges on pipeline kanban, terminal stage drag interception, approve/reject actions (admin/supervisor)
- **Advanced Filter Drawer**: Slide-out panel on contacts page with score range, date range, tags + removable filter chips
- **Skill Tags Editor**: Inline tag editor on users page with 8 suggested skills + PUT /auth/users/:userId/skills endpoint
- **DisconnectChannelModal**: Unified custom modal replacing browser confirm() across all 5 channels (WhatsApp, Instagram, Messenger, Telegram, SMS)
- **Channel Cleanup**: Removed webhook config sections (Callback URL, Verify Token) from WhatsApp/Instagram/Messenger — setup is guided
- **WhatsApp Disconnect**: Added POST /channels/whatsapp/disconnect endpoint + disconnect button

### Production Resilience
- **PgBouncer**: DEFAULT_POOL_SIZE 25→50, MAX_CLIENT_CONN 500→1000, query_timeout 30→120s
- **PostgreSQL**: max_connections=200, work_mem=8MB, effective_cache_size=512MB
- **Prisma**: connection_limit per service (API=8, Worker=8, WhatsApp=4)
- **DB Retry**: 5-attempt exponential backoff in API + WhatsApp PrismaService
- **Redis Leaks**: Fixed unmanaged Redis connections in WhatsApp WebhooksService + HealthController
- **NurturingService**: Transaction timeout 15→30s + updated_at pre-filter for heavy queries
- **FeatureRequestsService**: Fixed column name `content` → `content_text`
- **Orders**: Split multi-statement SQL for PgBouncer compatibility
- **Docker**: Health check added to API container, start_period on all services

### Technical Debt Resolved
- Orders multi-statement query split into individual calls ✓
- Feature-requests TypeScript error (was already resolved) ✓
- PgBouncer connection exhaustion (root cause: 30 connections demanded > 25 pool) ✓

---

## v4.0.0 — April 13, 2026

### New Features
- **Google OAuth**: Sign in with Google, auto-link to existing accounts, complete onboarding flow (setup-password → verify-email → onboarding wizard)
- **Media Module**: Image upload with sharp resize (webp), company logo, tags system, public serving with CORP headers
- **Email Templates**: 4 default templates (appointment confirmation, reminder, order confirmation, welcome) with {{variable}} rendering and test send
- **Appointments**: Full scheduling system — CRUD, weekly availability per agent, blocked dates, conflict detection, AI-ready checkAvailableSlots
- **Professional Auth Emails**: Redesigned verification, password reset, 2FA, welcome, and password changed emails (respond.io style)
- **Password Reset**: Public forgot-password flow with 6-digit OTP
- **Email-based 2FA**: send-2fa + verify-2fa endpoints
- **Change Password**: Authenticated password change with current password verification
- **Notification Bell**: 7 categories (messages, handoffs, compliance, appointments, automation, orders, system) with real-time WebSocket events
- **Compliance Review Workflow**: Opt-outs now pending admin review (confirm/reject) instead of auto-blocking. Word-boundary regex prevents false positives

### Infrastructure
- **PgBouncer**: Connection pooler in transaction mode (500 client → 25 PG connections)
- **Sentry**: Error tracking + performance monitoring (@sentry/nestjs)
- **Docker**: 10 containers (added pgbouncer), media_data volume for file storage
- **Prisma directUrl**: Migrations bypass PgBouncer via DIRECT_DATABASE_URL

### Fixes
- Inbox timestamps: fixed field mapping (message.timestamp vs message.created_at)
- Contact "last interaction": now shows actual last inbound message date, not leads.updated_at
- Opt-out false positives: "trabajan" no longer matches keyword "baja" (word-boundary regex)
- Media CORP header: Cross-Origin-Resource-Policy for cross-subdomain image loading
- Deploy ALTER TABLE: split into separate -c flags to prevent cascade failure
- Agent analytics: m.sender → m.direction column fix

---

## [3.1.0] — 2026-03-30

### Pipeline de mensajes
- **Read receipts (checks azules)** — Llamada fire-and-forget a Meta API al recibir webhook
- **Idempotencia de webhooks** — Redis key `idem:wa:{waMessageId}` con TTL 24h
- **BullMQ outbound queue** — Cola `outbound-messages` con 3 reintentos y backoff exponencial
- **Context window truncation** — Historial limitado a 12K chars antes de enviar al LLM
- **Numeric casting** — `Number()` en temperature/maxTokens en los 4 LLM providers

### Handoff interno (sin Chatwoot)
- **HandoffService reescrito** — Usa EventEmitter2 (`handoff.escalated`, `handoff.completed`)
- **AgentConsoleGateway** — Escucha eventos via `@OnEvent`, notifica agentes por WebSocket
- **Auto-assign** — Asigna al agente con menos conversaciones activas

### Broadcast/Campaigns
- **BroadcastService** — Crear campañas, resolver recipients por tags/segmentos
- **BullMQ worker** — Rate limited 80 msg/s (límite Meta API), 3 reintentos
- **campaign_recipients** — Tracking por recipient: pending → queued → sent → delivered → read/failed

### Knowledge Base (RAG)
- **KnowledgeService** — Ingesta de documentos, chunking por párrafos, embeddings OpenAI text-embedding-3-small
- **pgvector** — Búsqueda semántica por cosine similarity en knowledge_chunks
- **Integración en ConversationsService** — Contexto RAG inyectado automáticamente en system prompt

### Arquitectura
- **ChannelTokenService** — Rompe circular dep Conversations↔WhatsApp, cache Redis 5min
- **InternalAuthGuard** — Auth dual JWT/x-internal-key para comunicación service-to-service
- **Meta Graph API v21.0** — Estandarizado en todos los servicios
- **Defensive webhook extraction** — Optional chaining en todo el payload de Meta

### Documentación
- **CLAUDE.md** — Archivos de contexto para raíz, API, Dashboard y WhatsApp service
- **Docs reorganizados** — `docs/specs/`, `docs/roadmap/`, `docs/archive/` con índice
- **MANUAL.md, SECURITY.md, API_REFERENCE.md** — Actualizados al estado actual

---

## [3.0.0] — 2026-03-22

### 📱 WhatsApp Embedded Signup v4 — Servicio Independiente
- **Nuevo servicio `apps/whatsapp`** — NestJS container independiente (puerto 3002) para onboarding de WhatsApp Business
- **OnboardingService** — Flujo completo de 10 pasos: validación → exchange → discovery → persistencia → webhook → sync
- **MetaGraphService** — Cliente completo para Meta Graph API con retry exponential backoff
- **WebhooksController** — Validación HMAC-SHA256, respuesta <5s, procesamiento async
- **WebhooksService** — Resolución de tenant por phoneNumberId con cache 3 capas
- **BullMQ Workers** — Colas webhooks, sync, onboarding, ops con prefijo wa:
- **Cifrado AES-256-GCM** — Tokens de Meta cifrados antes de almacenar
- **7 endpoints REST** — start, get, status (polling), retry, resync, cancel, list
- **Dockerfile.whatsapp** — Multi-stage build, Docker Compose y CI/CD actualizados
- **Prisma** — 2 nuevos modelos: WhatsappOnboarding (17 campos), WhatsappCredential
- **Fix crítico** — whatsapp-webhook.service.ts: resolución dinámica de tenant
- **Frontend** — Componente WhatsAppEmbeddedSignup con FB SDK + FB.login()
- **Documentación** — README, .env.example, CHANGELOG, API_REFERENCE actualizados

---

## [2.4.0] — 2026-03-08

### 📣 Broadcast & Campaign Management
- **Targeted Mass Messaging** — Send templated messages (e.g., WhatsApp, Instagram, Telegram) to all valid contacts simultaneously.
- **Dynamic Variable Injection** — Automatically replace `{{name}}` with the recipient's name from the CRM.
- **Campaign Dashboard** — Re-wired `/admin/broadcast` from mock data to live API. View campaign progress, total delivered, and delivery statuses.
- **Backend Architecture** — New scalable `BroadcastService` taking advantage of `executeInTenantSchema` and generating live `campaigns` and `campaign_logs` tables.
- **Staggered Dispatch** — Integrated minor delays in dispatch loops to minimize risks of channel rate-limiting.

---

## [2.3.0] — 2026-03-08

### 🧾 Quote & Invoice Generation Module
- **HTML Invoice Rendering** — Endpoint `GET /orders/:tenantId/:orderId/invoice` that renders an A4-optimized HTML invoice/quote.
- **Dynamic Content** — Displays Tenant Name, Customer Name, Items list, Quantities, Unit Prices, and Total amounts.
- **Dynamic Title** — Titling changes automatically between "Cotización" (if pending) and "Factura / Recibo" (if paid).
- **Dashboard Action** — Added a "Ver Recibo" quick-action button in the Orders list.

---

## [2.2.0] — 2026-03-08

### 🛒 Order & Reservation Management Module
- **New Dashboard Page** — Added `/admin/orders` to manage customer orders, sales, and reservations.
- **KPI Dashboards** — Total revenue, pending revenue, order count, and average ticket size.
- **Backend Service** — `OrdersService` integrating with the inventory module to adjust stock automatically upon order creation.
- **API Endpoints** — New set of `/orders` protected endpoints.

---

## [2.1.0] — 2026-03-04

### 📦 Inventory Management Module
- **New Dashboard Page** — Added `/admin/inventory` for managing products, categories, stock, and movements.
- **KPI & Stock Alerts** — Dynamic cards for total value, low stock, out of stock, and active items.
- **Backend Service** — `InventoryService` for managing CRUD, schema-level tables (`executeInTenantSchema`), and stock movements.
- **API Endpoints** — New set of `/inventory` protected endpoints.

---

## [2.0.0] — 2026-03-04

### 📡 Telegram Integration + Full Channel Settings
- **TelegramAdapter** — Full `IChannelAdapter` for Telegram Bot API (text, photos, docs, audio, video, voice, locations, contacts, stickers)
- **Webhook Endpoint** — `POST /channels/webhook/telegram` for receiving bot updates
- **Settings Page Enhanced** — 7 configuration tabs: LLM, WhatsApp, Instagram, Messenger, Telegram, General
- **All 4 Channel Adapters** — WhatsApp, Instagram DM, Facebook Messenger, and Telegram fully registered

---

## [1.9.0] — 2026-03-04

### 📱 Multi-Channel: Instagram DM + Facebook Messenger
- **InstagramAdapter** — Full `IChannelAdapter` for Instagram DMs (text, images, story mentions)
- **MessengerAdapter** — Full `IChannelAdapter` for Facebook Messenger (text, images, attachments, quick replies, locations)
- **Webhook Endpoints** — Dedicated `GET/POST /channels/webhook/instagram` and `/channels/webhook/messenger`
- **ChannelsModule** — Both adapters auto-registered via the Gateway pattern
- **Env Variables** — `INSTAGRAM_VERIFY_TOKEN`, `MESSENGER_VERIFY_TOKEN`, `MESSENGER_PAGE_ACCESS_TOKEN`

---

## [1.8.0] — 2026-03-04

### 🤖 Parallext Copilot (AI Assistant)
- **CopilotWidget** — Floating ✨ button + slide-out chat drawer on every admin page
- **Context-Aware** — System prompt includes user role, active tenant, and current page
- **Page Suggestions** — Contextual quick-action buttons per page (e.g. "¿Cómo creo un deal?" on Pipeline)
- **Backend** — `POST /copilot/chat` (NestJS, JWT-protected, OpenAI gpt-4o-mini, graceful fallback)
- **Full Platform Knowledge** — Knows all 13 modules, architecture, roles, and processes

---

## [1.7.0] — 2026-03-04

### 🚀 Complete Sidebar (Final 3 Pages)
- **Conversaciones** (`/admin/conversations`): Global inbox view, status filters, sentiment analysis badges, tag cloud summary
- **AI / LLM Router** (`/admin/ai`): Model latency monitoring (GPT-4o, Claude, etc.), routing rules table, and visual architecture diagram
- **Knowledge Base** (`/admin/knowledge`): RAG document manager, chunk stats, processing status, and web URL ingester

---

## [1.6.0] — 2026-03-04

### 👥 Users Management + 📢 Broadcast
- **Users page** (`/admin/users`): Stats cards, searchable table, role badges, "Nuevo Usuario" modal → `api.registerUser()`
- **Broadcast page** (`/admin/broadcast`): Campaign builder, delivery/read/reply metrics, progress bars, template preview with `{{name}}` substitution, scheduling
- **Sidebar**: Added Broadcast link with Megaphone icon
- **API Client**: Added `registerUser`, `createTenant`, `updateTenant`, `deactivateTenant`

---

## [1.5.0] — 2026-03-04

### ⚡ Interactive CRUD (Functional Dashboard)
- **Pipeline**: "Nuevo Deal" modal (título, contacto, valor, etapa, probabilidad) → `api.createDeal()`
- **Pipeline**: Drag & drop calls `api.moveDeal()` to persist changes + toast notification
- **Inbox**: Send message → optimistic UI + `api.sendMessage()`
- **Inbox**: Add internal note → `api.addNote()`
- **Inbox**: Resolve conversation → `api.resolveConversation()`
- **Automation**: "Nueva regla" modal (nombre, tipo, trigger, descripción) → `api.createRule()`
- **Automation**: Delete rule → `api.deleteRule()` with red toast
- All modals: glassmorphism + backdrop blur + animations

---

## [1.4.1] — 2026-03-04

### 🏢 Tenant Context & Full API Integration
- **TenantContext** (`contexts/TenantContext.tsx`) — Provider + `useTenant()` hook for tenant-scoped API calls
- **TenantSelector** — Dropdown in top bar for super_admin to switch between tenants
- **All 8 pages** connected: Dashboard, Tenants, Inbox, Settings, Pipeline, Analytics, Automation, Contacts
- Pages auto-reload data when super_admin switches tenant
- All pages show **LIVE/DEMO badge** for data source transparency

---

## [1.4.0] — 2026-03-03

### 🔗 Frontend → API Integration
- **API Client** (`lib/api.ts`) — Centralized HTTP client with JWT auth, auto-refresh on 401, 30+ typed methods
- **useApiData hook** (`hooks/useApiData.tsx`) — Loading/error/isLive states, mock data fallback, DataSourceBadge (LIVE/DEMO)
- **Dashboard** — Personalized greeting, live tenant count from API, LIVE/DEMO indicator
- **Tenants page** — Loads real tenants from API, falls back to mock data
- **Auth fixes** — Global prefix `/api/v1`, class-validator decorators, ValidationPipe fix, CORS config
- **Admin seed** — bcrypt-hashed admin user + SQL migration

---

## [1.3.0] — 2026-03-03

### 🔐 Autenticación y Seguridad
- **Auth Context** (`AuthContext.tsx`) — Provider con login, logout, hasRole, persistencia JWT
- **Login page** (`/login`) — Formulario premium con glassmorphism y error handling
- **Route guards** — AdminLayout redirige a /login si no autenticado
- **Top bar** — Muestra nombre, rol, y botón de logout
- **Admin seed** (`005_seed_admin_users.sql`) — super_admin + tenant_admin con bcrypt hash
- **SECURITY.md** — Documentación completa de autenticación y roles

### 📊 Entrega 3: Agent Analytics + CSAT
- **AgentAnalyticsService** — KPIs, leaderboard, CSAT distribution
- **AgentAnalyticsController** — 5 endpoints REST
- **Agent Analytics page** (`/admin/agent-analytics`) — 3 tabs (Overview, Leaderboard, CSAT)
- **Migration** `004_csat_surveys.sql` — Tabla CSAT con rating 1-5

---

## [1.2.0] — 2026-03-03

### 📈 Entrega 2: Sales Pipeline + Automation
- **PipelineService** — Kanban board data, deals CRUD, stage management, forecast
- **AutomationService** — Auto-assign (round-robin), auto-tag (keywords), SLA detection
- **PipelineController** — 10 endpoints REST
- **Pipeline page** (`/admin/pipeline`) — Kanban board con drag & drop
- **Automation page** (`/admin/automation`) — Reglas con toggle switches
- **Migration** `003_pipeline_automation.sql` — 3 tablas + 7 stages + 4 rules seed

---

## [1.1.0] — 2026-03-03

### 💬 Entrega 1: CRM & Live Agent Console
- **AgentConsoleGateway** — WebSocket (Socket.IO) real-time
- **AgentConsoleService** — Inbox, messaging, assignment, notes, AI suggestions
- **CannedResponsesService** — Quick replies con shortcodes y `{{variables}}`
- **AgentConsoleController** — 10 endpoints REST
- **Inbox page** (`/admin/inbox`) — 3 columnas (conversaciones, chat, contacto)
- **Contacts page** (`/admin/contacts`) — Tabla CRM con segments y búsqueda
- **Migration** `002_crm_agent_console.sql` — 3 tablas + enriquecimiento de contactos

---

## [1.0.0] — 2026-03-03

### 🚀 Foundation
- **CI/CD Pipeline** — GitHub Actions → GHCR → Watchtower auto-deploy
- **Multi-tenant architecture** — Schema-per-tenant PostgreSQL
- **LLM Router** — 4 tiers de modelos con 5 factores de routing
- **WhatsApp Cloud API** — Integración directa con Meta
- **Admin Dashboard** — Next.js 16, dark mode, glassmorphism
- **Settings page** — API keys management
- **Cloudflare Tunnel** — Zero Trust networking
