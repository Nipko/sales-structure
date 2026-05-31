# Parallly — Plan de Implementación Q2-Q3 2026

> Plan de ejecución derivado de `docs/competitive-analysis-2026-q2.md`.
> Fecha: 29 mayo 2026. Cada ítem está a nivel de archivos reales, tablas, endpoints, UX, i18n y criterios de aceptación.
> **Convenciones obligatorias** (de CLAUDE.md): i18n en los 4 archivos (es/en/pt/fr) en cada página; `$queryRawUnsafe` con casts `::uuid` y columnas snake_case; tablas globales vía Prisma client; LLM router con `tenantId` para tracking; trabajo async vía BullMQ; guards `AuthGuard('jwt'), RolesGuard, TenantGuard`; verificación pre-push (`tsc --noEmit` + `test:bootstrap`).

## Ítems APLAZADOS (no se trabajan ahora)
- **Tier 1 · #9** — Factura fiscal local (CFDI/NF-e)
- **Tier 2 · #15** — Parallly SaaS Mode + Wallet/rebilling
- **Tier 3 · #18** — Voice AI

---

# TIER 0 — Quick wins (0-6 semanas)

## T0.1 — Publicar Resolution Rate (dashboard + marketing)
**Objetivo:** Hacer visible la métrica de resolución IA (playbook Tidio). La infraestructura YA existe; falta exponerla.

**Estado actual:** `analytics/ai-resolution.service.ts` con `getResolutionStats()`, `getResolutionTrend()`, `getResolutionByChannel()`. Endpoint `GET /agent-analytics/:tenantId/overview` (controller `agent-analytics.controller.ts`). Columnas en `conversations`: `was_handed_off`, `handoff_at`, `ai_message_count`, `resolution_type` (`ai_resolved`/`agent_resolved`/`auto_resolved`/NULL). **No hay UI.**

**Backend:** Asegurar que el endpoint devuelva: tasa de resolución IA, tendencia temporal (serie por día/semana), desglose por canal, conteo total. Añadir, si falta, `GET /agent-analytics/:tenantId/ai-resolution` dedicado con `?range=30d`.

**Frontend:** Nueva página `apps/dashboard/src/app/admin/analytics/resolution/page.tsx`:
- KPI hero: "% conversaciones resueltas por IA" + delta vs período anterior.
- Gráfico de tendencia (recharts, area/line).
- Desglose por canal (barras).
- Tile de "mensajes IA promedio antes de handoff".
- Link/tab desde el dashboard de analytics existente.
- (Marketing) Sección en landing `apps/landing` mostrando un resolution rate agregado/anónimo como prueba social.

**i18n:** namespace `analyticsResolution` en es/en/pt/fr (KPIs, labels, tooltips).

**Esfuerzo:** 1 semana. **Criterios de aceptación:** página renderiza datos reales del tenant; cambia por rango; 0 strings hardcoded; `tsc` limpio.

---

## T0.2 — AI Rewriter + Summarizer en el inbox
**Objetivo:** Asistencia al agente humano (Kommo/Front): reescribir su borrador por tono y resumir el hilo. Alto valor percibido, bajo costo.

**Estado actual:** `copilot/copilot.service.ts` ya tiene `getSummary()` y `getSuggestions()`. **No** tiene `rewrite()`. Frontend inbox (`apps/dashboard/src/app/admin/inbox/page.tsx`, composer ~línea 400-450, estado `reply`) no consume copilot.

**Backend:**
- Nuevo método `rewriteReply(tenantId, conversationId, draft, tone)` en `copilot.service.ts` → LLM router `task:'conversation'`, `allowedTiers:['tier_3_efficient','tier_4_budget']`, `temperature:0.4`, `tenantId` para tracking. Tonos: `professional|friendly|empathetic|shorter|expand|fix_grammar`.
- Endpoint `POST /copilot/:conversationId/rewrite` `{ draft, tone }`.
- `getSummary()` ya existe → exponer en UI.

**Frontend (inbox):**
- Toolbar flotante sobre el `<textarea>` del composer: botones **Reescribir** (dropdown de tono), **Resumir conversación**, **Sugerencias** (las 3 que ya genera `getSuggestions`).
- "Reescribir" reemplaza/propone el texto en el composer (con undo).
- "Resumir" abre un panel lateral con el resumen + intent + datos clave.
- Loading states; manejar errores (no romper el composer).

**i18n:** namespace `copilotInbox` (botones, tonos, estados) en 4 idiomas.

**Esfuerzo:** 1-2 semanas. **Criterios:** reescritura respeta el idioma del cliente; tracking de uso registra `tenantId`; el composer nunca queda bloqueado por error.

---

## T0.3 — Payment-at-booking (cobro en el agendamiento)
**Objetivo:** Cobrar seña/total dentro del chat al reservar → reduce no-shows 40-60% (Calendly/Podium).

**Estado actual:** Booking engine determinístico (`conversations/booking-engine.service.ts`, estados `select_service→select_date→select_time→confirm→booked`). Tabla `services` ya tiene `price`, `currency`. Confirmación vía `AIToolExecutorService.executeAppointmentCreation()` → emite `appointment.created`. **MercadoPago adapter solo soporta preapproval (suscripción), NO one-time.**

**Backend:**
1. Migración tenant-schema: `ALTER TABLE services ADD COLUMN requires_payment BOOLEAN DEFAULT false, ADD COLUMN deposit_amount_cents INTEGER;` (split multi-statement en queries individuales por PgBouncer).
2. Nuevo método `createOneTimePayment(input)` en interface `IPaymentProvider` + implementación en `mercadopago.adapter.ts` (Payment/Preference API) y `stripe.adapter.ts` (PaymentIntent/Checkout link).
3. Nuevo estado en la state machine: `select_time → awaiting_payment → booked`. Si `service.requires_payment`:
   - Retener slot provisionalmente en Redis `booking_pending:{conversationId}` (TTL 15 min).
   - Generar orden de pago + link; enviar link en el chat.
   - Confirmar cita solo al recibir webhook de pago OK; liberar lock; emitir `appointment.created`.
   - Si expira (15 min) sin pago → liberar slot + mensaje al cliente.
4. Webhook de pago one-time → handler que matchea `external_reference = conversationId` y dispara confirmación.

**Frontend:** En la config de cada servicio (`apps/dashboard/.../services` o vertical): toggle "Requiere pago" + monto de seña. Mostrar estado de pago en la cita.

**i18n:** mensajes del bot (link de pago, expiración, confirmación) en 4 idiomas vía `msg()` del booking engine.

**Esfuerzo:** 1-2 semanas. **Criterios:** doble-booking imposible durante `awaiting_payment`; idempotencia del webhook (`idem:` Redis); funciona con MP y Stripe; i18n completo.

---

## T0.4 — Pricing transparente en tiers (público)
**Objetivo:** Matar el "contáctanos". Publicar planes claros (ventaja LatAm vs Yalo/Intercom opacos).

**Backend:** Ninguno (los planes/features ya existen en billing). Exponer matriz de features por plan si se quiere comparador dinámico.

**Frontend:** Sección/página de precios en `apps/landing` (4 idiomas) con tabla comparativa de los 4 planes, "IA incluida", WhatsApp pass-through transparente, ancla de entrada ~$29-49/mes. Reusar componentes de landing.

**i18n:** los 4 idiomas de landing.

**Esfuerzo:** 1 semana. **Criterios:** precios coherentes con la matriz de billing real; responsive; SEO básico.

---

## T0.5 — Narrativa "Vibe Selling LatAm"
**Objetivo:** Posicionar el auto-bootstrap de 12 verticales como "IA que vende sin que armes flujos" (igualar/ganar a Leadsales).

**Trabajo:** Copy de landing (hero + sección verticales) + textos de onboarding que refuercen "elige tu industria → tu agente queda listo". 4 idiomas. Sin código de backend.

**Esfuerzo:** 1 semana. **Criterios:** mensaje consistente landing↔onboarding; 4 idiomas.

---

# TIER 1 — Estándares nuevos que nadie tiene en LatAm (1-3 meses)
*(#9 aplazado)*

## T1.6 — CX Score / Quality Score automático (LLM-as-judge, 100% conversaciones)
**Objetivo:** Auditar el 100% de conversaciones (IA y humano) con un LLM evaluador barato (Decagon/Front/Zendesk). QA masivo a costo bajo.

**Backend:**
1. Migración tenant-schema: tabla `conversation_quality_scores` (`id uuid`, `conversation_id uuid`, `overall_score numeric`, `resolution_score`, `tone_score`, `accuracy_score`, `empathy_score`, `flags jsonb`, `rubric_version`, `scored_by` (`ai`/`human`), `created_at`). Índices por `conversation_id`, `created_at`.
2. Listener `@OnEvent('conversation.resolved')` (verificar nombre exacto del evento en `conversations.service.ts`/`agent-console.service.ts`) → encola job BullMQ en una nueva cola `quality-scoring`.
3. Processor: arma el transcript, llama LLM router `allowedTiers:['tier_3_efficient','tier_4_budget']` con rúbrica (resolución, tono, precisión, empatía, 0-10) → guarda score + flags (ej. "respondió con info no verificada", "no escaló cuando debía"). `tenantId` para tracking.
4. Endpoint `GET /agent-analytics/:tenantId/quality?range=&agentId=` con agregados.

**Frontend:** Tab "Calidad (QA)" en analytics: score promedio, distribución, por agente vs IA, lista de conversaciones flageadas (drill-down al inbox).

**i18n:** namespace `qualityScore` ×4.

**Esfuerzo:** 2-3 semanas. **Criterios:** se puntúa el 100% de conversaciones cerradas; costo controlado (tier barato); flags accionables; sin bloquear el cierre de conversación (async).

---

## T1.7 — Trace View / Observabilidad por conversación
**Objetivo:** Mostrar por turno qué proveedor del router respondió, qué chunks de pgvector se usaron, qué stage del pipeline, qué tools se llamaron, latencia y tokens (Decagon Trace View / Salesforce Command Center). Confianza pura.

**Backend:**
1. Capturar metadata por turno IA. Opción: extender metadata de `messages` o nueva tabla `conversation_traces` (`message_id`, `provider`, `model`, `tier`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `kb_chunk_ids jsonb`, `tools_called jsonb`, `pipeline_stage`, `fallback_used boolean`). Poblar desde `llm-router.service.ts` (ya conoce provider/model/tier/fallback) y desde `knowledge.service.ts` (chunks devueltos) y `tool-executor`.
2. Endpoint `GET /conversations/:id/trace`.

**Frontend:** En el inbox, panel "Traza" por conversación (timeline de turnos con badges: proveedor/modelo, latencia, chunks KB citados, tools, stage). Para super-admin: vista agregada (consumo por proveedor/tenant — extiende el AI usage dashboard existente a granularidad por-acción).

**i18n:** namespace `trace` ×4.

**Esfuerzo:** 2-3 semanas. **Criterios:** cada respuesta IA tiene traza; overhead despreciable (escritura async); útil para debug real.

---

## T1.8 — Validador de resolución de 2ª capa
**Objetivo:** Antes de contar/cobrar una conversación como "resuelta por IA", un LLM evaluador independiente confirma que realmente se resolvió (Zendesk: verificación por 2º modelo). Responde la objeción del outcome pricing y mejora la métrica.

**Backend:**
1. Listener al cierre con `resolution_type='ai_resolved'` → job BullMQ (puede compartir cola `quality-scoring` o nueva `resolution-verify`).
2. LLM evaluador (tier barato) decide `verified|not_verified` con razón. Si `not_verified` → reclasificar (`auto_resolved`/`unresolved`) y excluir de la tasa "verificada".
3. Nueva columna `conversations.resolution_verified BOOLEAN`. La métrica de T0.1 ofrece "resolución" y "resolución verificada".

**Frontend:** Mostrar "resolución verificada" como métrica destacada (más confiable). 

**i18n:** reusar `analyticsResolution`.

**Esfuerzo:** 1-2 semanas. **Dependencia:** T0.1 (métrica). **Criterios:** tasa verificada ≤ tasa bruta; razones auditables; async.

---

## T1.10 — Copilot gratis y embebido en toda la consola
**Objetivo:** Adopción (HubSpot Breeze Assistant gratis y universal). El copilot ya existe y NO está plan-gated — falta presencia en toda la UI.

**Backend:** Confirmar que `copilot.service.ts` no tiene gating por plan (auditoría dice que no). Mantener barato (tier 3/4) para que sea sostenible "gratis".

**Frontend:** Embeber copilot en: inbox (T0.2 ya añade rewriter/summarizer/suggestions), vista de contacto/CRM (resumen del lead, próxima mejor acción), y un launcher global (botón flotante "Asistente" que usa `POST /copilot/chat` para preguntas sobre el dashboard/datos).

**i18n:** namespace `copilotGlobal` ×4.

**Esfuerzo:** 1-2 semanas. **Dependencia:** T0.2. **Criterios:** copilot accesible en ≥3 superficies; disponible en todos los planes; costo por tier barato.

---

## T1.11 — Mobile inbox optimizado / PWA real (completar la PWA)
**Objetivo:** Cerrar la brecha mobile. La PWA shell existe (`manifest.ts`, `public/sw.js` con listeners push) pero está incompleta. Ver **Sección Mobile** abajo para la estrategia completa (PWA ahora + app nativa Expo después).

**Backend (push):**
1. Tabla global `push_subscriptions` (`user_id`, `tenant_id`, `endpoint`, `p256dh`, `auth`, `created_at`) — Prisma client (tabla global).
2. Módulo `notifications`: `PushNotificationService` con `web-push` + VAPID keys (env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` → añadir a GitHub Secrets + deploy.yml).
3. Endpoint `POST /notifications/subscribe` (recibe `PushSubscription`) y `DELETE /notifications/unsubscribe`.
4. Disparar push en eventos: `inbox:message` (no asignado/asignado a mí), `handoff`, `inbox:escalation` (SLA).

**Frontend (PWA):**
1. Registro de push en cliente (`pushManager.subscribe()` con VAPID public key) + UI de permiso.
2. Inbox optimizado para móvil: composer responsive, **swipe actions** (asignar/resolver/snooze), quick replies, bottom-nav, lista→detalle navegable en una columna.
3. **Cola offline de respuestas** (IndexedDB) + reintento al reconectar; reconexión de WebSocket al cambiar de red.
4. Install prompt (A2HS) y `/offline` ya existe.

**i18n:** namespace `pwa`/`notifications` ×4.

**Esfuerzo:** 2-3 semanas. **Criterios:** push funciona en Android (Chrome) e iOS (Safari 16.4+); inbox usable con una mano; respuestas no se pierden sin red.

---

# TIER 2 — Diferenciadores arquitectónicos (3-6 meses)
*(#15 aplazado)*

## T2.12 — Procedimientos por vertical (AOP/SOP) — nuestra mayor ventaja latente
**Objetivo:** Generalizar el motor determinístico del booking a "Procedimientos": el tenant escribe un SOP en español ("cuando pidan reembolso: verifica orden → ofrece cupón → si insisten, escala") y se compila a pasos determinísticos que el LLM ejecuta sin decidir el flujo (Decagon AOP / Lorikeet SOP).

**Backend:**
1. Nuevo módulo `procedures`. Tabla tenant-schema `procedures` (`id`, `name`, `trigger jsonb`, `steps jsonb`, `status`, `vertical`, `version`). Cada step: `type` (`ask`/`tool`/`condition`/`message`/`handoff`), `config`.
2. "Compilador": un endpoint que toma el SOP en lenguaje natural → LLM (tier alto, one-shot) → grafo de pasos estructurado (review humano antes de activar).
3. Motor de ejecución (reusa patrón del booking engine): determinístico, mantiene estado en Redis `procedure:{conversationId}`, llama tools del `tool-executor` y al LLM solo para lenguaje natural.
4. Integración con `conversations.service.ts`: si una intención dispara un procedimiento activo, entra en modo directivo (como booking).

**Frontend:** Editor visual de procedimientos (lista de pasos) + "escribe tu SOP" (genera el grafo) + activar/desactivar/versionar. Por vertical.

**i18n:** namespace `procedures` ×4 + textos del bot por idioma.

**Esfuerzo:** 4-6 semanas. **Criterios:** un SOP escrito en español ejecuta pasos determinísticos; no alucina el flujo; reusable por vertical; versionado.

---

## T2.13 — Agent Simulation pre-deploy
**Objetivo:** Probar el agente contra conversaciones reales y personas sintéticas antes de exponerlo (Sierra/Intercom). "CI/CD para tu agente IA". Nadie lo ofrece en LatAm.

**Backend:**
1. Nuevo módulo `simulation`. Tabla `simulation_runs` (`id`, `persona_version`, `kb_snapshot`, `scenarios jsonb`, `results jsonb`, `status`, `created_at`).
2. Fuente de escenarios: (a) replay de transcripts históricos reales (Postgres), (b) personas sintéticas generadas por LLM (intenciones por vertical).
3. Workers BullMQ corren N conversaciones simuladas contra la persona/KB actual; un LLM-judge evalúa resolución/CSAT estimado; diff vs versión anterior (regresión).
4. Endpoint `POST /simulation/run` + `GET /simulation/:id`.

**Frontend:** Pantalla "Probar agente": elegir escenarios/vertical → correr → resultados (resolución estimada, fallos, regresiones vs versión previa) → aprobar para producción.

**i18n:** namespace `simulation` ×4.

**Esfuerzo:** 3-4 semanas. **Dependencia:** T1.6 (LLM-as-judge reutilizable). **Criterios:** corre ≥50 escenarios; detecta regresión cuando empeora una respuesta; no toca producción.

---

## T2.14 — KB auto-sanante
**Objetivo:** El KB se mantiene solo: detecta contradicciones, contenido obsoleto y gaps, y sugiere updates (Maven). Ataca el fallo #1 de RAG.

**Backend:** Cron (extender `knowledge-recrawl.service.ts` o nuevo) que: (a) cruza embeddings buscando contradicciones (pares de chunks muy similares con conclusiones opuestas vía LLM-judge), (b) marca docs sin hits en 30+ días (ya hay content-gap analytics v5.4), (c) sugiere correcciones. Tabla `kb_health_issues` (`doc_id`, `type`, `detail`, `suggestion`, `status`).

**Frontend:** En Knowledge, sección "Salud del KB": lista de issues con "aplicar sugerencia" en un clic.

**i18n:** namespace `kbHealth` ×4.

**Esfuerzo:** 2-3 semanas. **Criterios:** detecta al menos contradicciones y staleness; sugerencias aplicables; corre en cron sin saturar.

---

## T2.16 — Zapier native app + Slack notifications
**Objetivo:** Ecosistema. REST API pública ya existe (v5.4) → publicar app oficial de Zapier + notificaciones a Slack.

**Backend:** Confirmar endpoints/scopes en `public-api`. Triggers (REST Hook, ya soportado): `new_lead`, `new_message`, `appointment_booked`, `handoff_triggered`. Actions: `create_lead`, `send_message`, `update_contact`. Slack: action/integration que postea a un webhook de Slack en handoff/venta/cita.

**Zapier app:** Proyecto aparte con Zapier Platform CLI consumiendo la API pública (auth por API key). Someter a revisión de Zapier.

**Frontend:** En integraciones del dashboard: conectar Slack (webhook URL) + documentación de Zapier.

**i18n:** namespace `integrations` ×4.

**Esfuerzo:** 2-3 semanas (+ tiempo de revisión Zapier). **Criterios:** triggers/actions funcionan end-to-end; Slack recibe eventos; API key con scopes correctos.

---

## T2.17 — Agente dual-skillset (vende + soporte) con contexto catálogo/pedido
**Objetivo:** El agente que vende, no solo responde (Gorgias). Un skillset de ventas (recomienda, upsell) + soporte, con contexto nativo de catálogo/pedido para verticales e-commerce/retail.

**Backend:** Extender persona/prompt-assembler con "skillset" configurable (`sales`/`support`/`both`). Para verticales con e-commerce (Shopify/WooCommerce ya integrados): inyectar contexto de catálogo + últimas órdenes del cliente en Layer 3 (turno). Nuevos AI tools: `recommend_products`, `get_order_status`, `apply_discount` (gated).

**Frontend:** En config del agente: elegir skillset + comportamiento de upsell. 

**i18n:** namespace `agentSkillset` ×4.

**Esfuerzo:** 3-4 semanas. **Dependencia:** e-commerce module. **Criterios:** el agente recomienda productos del catálogo real; upsell configurable; no inventa productos.

---

# TIER 3 — Frontera y profundidad (6-12 meses)
*(#18 aplazado)*

## T3.19 — Integraciones verticales reales (Toast, Mindbody, Cliniko)
**Objetivo:** Convertir verticales de "preset de prompts" a "conectados al sistema real" (hoy solo Guesty/Hostaway es real). Estrategia "thin vertical, deep horizontal": integrar, no construir el system-of-record.
**Backend:** Adapters por vertical (patrón del channel-manager existente): **Toast API** (menú/items/precios/order status → toma de pedidos conversacional), **Mindbody API** (clases/horarios/membresías), **Cliniko API** (citas/recordatorios sin tocar EHR → evita HIPAA). Cada uno: OAuth/API key, sync, AI tools.
**Esfuerzo:** 3-4 semanas por integración. **Criterios:** booking/órdenes reales empujadas al sistema externo.

## T3.20 — MCP nativo
**Objetivo:** Exponer/consumir Model Context Protocol para conectores de acciones (estándar abierto, evita lock-in).
**Backend:** Capa MCP sobre el `tool-executor`/LLM router. Permitir que tools (booking, CRM, pagos, e-commerce) se expongan/consuman vía MCP.
**Esfuerzo:** 3-4 semanas.

## T3.21 — CRM B2B (Organizaciones) + forecasting/rotting/weighted
**Objetivo:** Cerrar gaps de CRM enterprise.
**Backend:** Tabla `crm_organizations` + `organization_id` en contactos (relación). Pipeline: weighted value (probabilidad×monto), deal rotting (cron alerta deals sin movimiento X días), forecast básico por velocity.
**Frontend:** Vista de organización (contactos agrupados); alertas de rotting; weighted pipeline value en analytics.
**Esfuerzo:** 3-4 semanas.

## T3.22 — Click-to-WhatsApp ads attribution + revenue attribution
**Objetivo:** Medir embudo ads→WhatsApp→venta (Treble) + ROI de campañas.
**Backend:** Capturar referral/CTWA en el webhook de WhatsApp (Free Entry Point); atribuir conversiones a campañas/anuncios. Revenue attribution en broadcast.
**Esfuerzo:** 3-4 semanas.

## T3.23 — Reviews/reputación con IA en español
**Objetivo:** Módulo nuevo (Podium/Birdeye): conectar Google Business Profile y responder reviews con IA en español.
**Esfuerzo:** ~4 semanas.

## T3.24 — Tier "managed / done-for-you"
**Objetivo:** Modelo de negocio (Crescendo): nosotros configuramos verticales+KB+automatizaciones y garantizamos un % de resolución; monetizado por outcome. Principalmente ops + tracking de garantía (apalanca T0.1/T1.8).
**Esfuerzo:** ops + producto ligero.

---

# SECCIÓN ESPECIAL — Estrategia Mobile de Parallly

**Hallazgo:** la PWA NO está en cero. Existe `apps/dashboard/src/app/manifest.ts` (standalone, theme `#6c5ce7`, shortcuts a Inbox/Contactos) y `public/sw.js` (network-first, offline fallback `/offline`, listeners `push` y `notificationclick`). **Lo que falta:** flujo de suscripción push (cliente `pushManager.subscribe` + VAPID + `PushNotificationService` + tabla `push_subscriptions`), inbox optimizado para móvil, y cola offline.

**Recomendación: estrategia de dos fases.**

### Fase A — Completar la PWA (ahora = T1.11)
Reusa el 100% del dashboard Next.js. 2-3 semanas. Cierra la brecha de inmediato, funciona en Android (dominante en LatAm), sin fricción de app store. Entrega: push real, inbox mobile (swipe/quick-reply/bottom-nav), cola offline, reconexión WS, install prompt.

### Fase B — App nativa con Expo / React Native (proyecto nuevo `apps/mobile`)
La API ya está lista para consumirla: **REST pública v5.4** (`public-api`, X-API-Key/JWT) + **Socket.io `/inbox`**. Una app Expo añade: push nativo (FCM/APNS, más fiable que Web Push, sobre todo iOS), **login biométrico**, presencia en App Store/Play Store (descubrimiento + confianza en LatAm), mejor rendimiento en Android gama media. 2-3 meses, codebase separado en el monorepo.

### Qué debe llevar la app (core + por sector)
**Core (todos):** inbox unificado (WA/IG/Messenger/Telegram/SMS/Email), chat en tiempo real, **push** (mensaje nuevo / handoff / SLA), quick replies + macros, vista 360° del contacto, asignación, notas internas, **copilot (sugerencias/resumen/reescribir)**, reproducción de notas de voz + transcripción, media/imágenes, indicadores de colisión, resumen al handoff.

**CRM/Pipeline:** ver lead, pipeline kanban mobile, crear/actualizar deals, tareas/recordatorios.
**Booking:** citas de hoy, confirmar/reagendar, vista calendario, check-in.
**Analytics:** KPIs clave (resolution rate, performance del agente).
**Adaptación por vertical** (respeta `verticalConfig.industry` como el dashboard): turismo → disponibilidad de propiedades + reservas; gimnasios → clases + check-in; restaurantes → pedidos; salud → pacientes/citas del día.
**LatAm specifics:** español-first, modo bajo consumo de datos, Android 10+, login biométrico, dark mode, cola offline de respuestas.

---

# Secuencia de ejecución recomendada

1. **Sprint 1-2 (Tier 0):** T0.1 → T0.2 → T0.3 → T0.4/T0.5 (paralelo marketing).
2. **Sprint 3-6 (Tier 1):** T1.6 + T1.8 (comparten cola/LLM-judge) → T1.7 → T1.10 → T1.11 (PWA) [+ kickoff Fase B mobile si se decide].
3. **Sprint 7-14 (Tier 2):** T2.12 (procedimientos, el más estratégico) → T2.13 (simulación, reusa T1.6) → T2.14 → T2.16 → T2.17.
4. **Tier 3:** según prioridad de mercado (T3.21 CRM B2B y T3.22 attribution suelen pedirse primero).

**Verificación pre-push (siempre):** `cd apps/api && npx tsc --noEmit && npm run test:bootstrap`; `cd apps/dashboard && npx tsc --noEmit`; i18n en 4 idiomas.

---
*Generado: 29 mayo 2026. Deriva de `competitive-analysis-2026-q2.md`.*
