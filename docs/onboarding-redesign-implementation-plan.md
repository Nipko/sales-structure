# Plan técnico de implementación — Onboarding guiado (Q2 2026)

> **Qué es esto.** El plan de ejecución, file-by-file, del rediseño descrito en `docs/onboarding-redesign-2026-q2.md`. Convierte la Parte 8 (roadmap) en tareas concretas con archivos, endpoints, claves i18n y verificación. **Cuando se implemente, cada cambio de UI actualiza i18n en los 4 idiomas (es/en/pt/fr)** y se verifica con `tsc --noEmit` + `test:bootstrap`.
>
> **Hallazgo clave del recon:** casi todo el stack de conexión **ya existe**. Este plan es mayormente **cablear y reordenar componentes existentes**, no construir. La sección 1 es el inventario de reuso.
>
> **Fecha:** 2026-05-31 · **Estado:** plan listo para ejecución por fases.

---

## 1 — Inventario: lo que YA existe (reusar, no construir)

| Capacidad | Dónde vive hoy | Cómo se reusa en el onboarding |
|---|---|---|
| **Embedded Signup (componente React)** | `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppEmbeddedSignup.tsx` — props `{ tenantId, mode: "standard"\|"coexistence", onSuccess, onError }`, `FB.login` con `config_id`, code-exchange a `POST {WA_SERVICE_URL}/onboarding/start` | **Importar tal cual** en el paso "Conéctalo" |
| **Selector de rutas (nuevo/coexistencia/migración)** | `apps/dashboard/src/app/admin/channels/whatsapp/page.tsx` (líneas ~29-57 defs, ~203-241 UI) | **Extraer a componente compartido** `WhatsAppConnectPanel` y usarlo en ambos lugares |
| **Backend ESU completo (10 pasos)** | `apps/whatsapp/src/modules/onboarding/onboarding.controller.ts` (`POST /onboarding/start`, `GET /onboarding/{id}/status`, retry/resync) + `onboarding.service.ts` | **Sin cambios** |
| **Coexistencia + migración 6 meses** | `apps/whatsapp/src/modules/webhooks/webhooks.service.ts` (echoes, history fases 0/1/2, contactos) + `webhook.processor.ts` | **Sin cambios** |
| **Estado de conexión** | `GET /channels/whatsapp/status` → `{ status, channel }` (`apps/api/.../whatsapp.controller.ts:58`) | Polling en el paso Conéctalo |
| **Bootstrap del vertical** | `verticals.service.bootstrapVertical(tenantId, industry, subType, lang)` | **Sin cambios** (ya crea persona, pipeline, FAQs, servicios, tools) |
| **Agente por defecto** | `persona.service.createDefaultAgentFromGoals(tenantId, goals, createdBy?, industry?)` | **Sin cambios** |
| **Setup status** | `GET /persona/{tenantId}/setup-status` → `{ setupWizardCompleted, hasPersona, hasConversations, hasKnowledge, hasTeam, hasAutomation, hasTemplates }` | Extender (añadir `hasAnyChannel`) |
| **Crawl de URL → KB** | `POST /knowledge/documents/crawl` `{ url, title?, category? }` (`knowledge.controller.ts:212`) | Reusar para "pega tu web" |
| **Chat de prueba del agente** | `apps/dashboard/src/app/admin/agent/[agentId]/test/page.tsx` | Reusar/embeber en el paso "Pruébalo" |
| **Checklist de activación** | `apps/dashboard/src/components/OnboardingChecklist.tsx` (esenciales: agente→canal→prueba) | Promover a hub progresivo |
| **i18n de conexión** | `channels.whatsapp.*` (200+ claves: `routeNew*`, `routeCoexistence*`, `routeMigration*`, `coexSync*`) en 4 idiomas | Reusar; añadir solo `setupWizard.connect.*` y `setupWizard.test.*` |

> **Conclusión:** **0 trabajo de infraestructura.** El esfuerzo es: (a) extraer 1 componente compartido, (b) añadir 2 pasos al wizard, (c) reforzar el gating, (d) promover el checklist, (e) añadir ~2 namespaces i18n menores, (f) pequeños toques de backend (1 campo en setup-status, trial-first).

---

## 2 — Decisión de arquitectura

**`/admin/setup-wizard` se convierte en la espina guiada post-registro** (es el lugar natural: ya tiene plantilla → personaliza → canales). Se transforma su paso 3 de *"seleccionar canales"* a *"**conectar al menos un canal**"* (**WhatsApp destacado, pero IG/Messenger/Telegram/Email también cuentan**), y se añaden los pasos *"Pruébalo"* y *"Descúbrelo"* (tour guiado por vertical que pasa por el **copilot**). `/onboarding` (registro = "configuración inicial") se conserva y se recorta. El gating se refuerza para que **conectar ≥1 canal** sea el clímax obligatorio, con un escape suave que sigue empujando.

```
/onboarding (registro, recortado)                /admin/setup-wizard (espina guiada)
  1. Tu negocio + vertical  ──bootstrap──►          1. Tu agente (plantilla por vertical, pre-seleccionada)
  2. Objetivo (+ "pega tu web" opcional)            2. Personaliza (nombre/tono/saludo)
  3. Plan (trial-first, tarjeta diferida)           3. PRUÉBALO  (chat de prueba = "aha")     ← NUEVO
                                                     4. CONÉCTALO (≥1 canal, OBLIGATORIO)       ← TRANSFORMADO
                                                          WhatsApp⭐ / IG / Messenger / Telegram / Email
                                                     5. DESCÚBRELO (tour vertical + copilot)    ← NUEVO
                                                        → ¡Listo! /admin + checklist hub
```

**Por qué extender el wizard y no crear ruta nueva:** minimiza superficie, reusa el `completion` i18n y el flujo de `applySetupTemplate`/`skipSetupWizard` ya existentes, y mantiene la cohesión que pediste.

---

## 3 — FASE 0 — Quick wins (sin reestructurar el flujo)

Objetivo: medir y desfricción inmediata. Bajo riesgo.

### 3.1 — Instrumentar activación y TTFV
- **Backend:** emitir evento analítico cuando un canal pasa a `connected` (en `apps/whatsapp/.../onboarding.service.ts` paso "persistWhatsAppChannel" / o en `api` al confirmar status). Registrar `tenant_id`, `channel_type`, `ts`, y `signup_ts` para calcular TTFV.
- **Dónde:** módulo de analytics existente (`apps/api/src/modules/analytics/`). Añadir evento `activation_first_channel_connected`.
- **Verificación:** consultar el evento tras una conexión de prueba en producción.

### 3.2 — Promover el `OnboardingChecklist` a "progreso regalado"
- **Archivo:** `apps/dashboard/src/components/OnboardingChecklist.tsx`.
- Marcar `createAccount` y `configureAgent` como ✓ desde el inicio (ya lo están vía `hasPersona`); asegurar que el panel **no aparezca colapsado por defecto** hasta alcanzar activación (canal conectado). Hoy `handleDismiss` lo minimiza permanentemente vía `localStorage checklist_dismissed_{tenantId}` — condicionar: si **no** hay canal conectado, re-mostrar como píldora persistente (no permitir dismiss total).
- **i18n:** ninguno nuevo (usa `checklist.*`).

### 3.3 — Trial-first (diferir tarjeta)
- **Frontend:** `apps/dashboard/src/app/onboarding/page.tsx` paso 5 (Plan). Hacer que `emprendedor`/`starter` (ya sin tarjeta) sean el default visible y que la tarjeta de planes pagos sea **"añadir después de activar"** en lugar de bloqueante.
- **Payload:** `completeOnboarding` ya acepta `cardTokenId` opcional; permitir `plan` con trial sin `cardTokenId`.
- **Backend:** `auth.service.completeOnboarding` (`apps/api/.../auth.service.ts:1406`) — confirmar que crea suscripción `trialing` sin tarjeta (billing ya lo soporta). **Coordinar con billing** antes de tocar.
- **Riesgo:** medio (flujo de pago). Si hay duda, dejar para una sub-tarea con el equipo de billing.

### 3.4 — Mover "referido" fuera del camino crítico
- **Frontend:** `apps/dashboard/src/app/onboarding/page.tsx` — quitar el paso 4 (referral) del wizard obligatorio; convertirlo en micro-encuesta opcional post-activación (un modal pequeño en `/admin` la primera semana) o un dropdown opcional en el paso de plan.
- **i18n:** reutiliza `onboarding.referrals.*` / `onboarding.referralTitle`.
- **Resultado:** `/onboarding` pasa de 5 a 4 pasos.

---

## 4 — FASE 1 — El camino crítico (núcleo del rediseño)

Objetivo: que el primer canal se conecte **dentro del flujo guiado y obligatorio**. Reuso máximo.

### 4.1 — Extraer `WhatsAppConnectPanel` (componente compartido)
- **Nuevo archivo:** `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppConnectPanel.tsx`.
- Mover ahí la UI de selección de rutas (nuevo/coexistencia/migración) que hoy está inline en `channels/whatsapp/page.tsx:203-241`, envolviendo el `WhatsAppEmbeddedSignup` existente. Props: `{ tenantId, onConnected, variant?: "page" | "onboarding" }`.
- **Refactor:** `channels/whatsapp/page.tsx` pasa a consumir `WhatsAppConnectPanel` (sin cambio de comportamiento).
- **Añadir ruta "sandbox 555":** una 4ª opción "Probar con número de prueba" que llama al mismo `WhatsAppEmbeddedSignup` con `mode="standard"` y el flujo display-name-only de Meta (el backend ya hace asset discovery; verificar que `onboarding.service` acepta el número 555 — si no, es el único posible toque backend menor).
- **i18n:** reusar `channels.whatsapp.routeNew*` / `routeCoexistence*` / `routeMigration*`; añadir `channels.whatsapp.routeSandbox*` (title, short, tag, time, overview, step1-3).

### 4.2 — Añadir el paso "Conéctalo" (≥1 canal) al setup-wizard
- **Archivo:** `apps/dashboard/src/app/admin/setup-wizard/page.tsx`.
- Cambiar `STEPS` (líneas 139-143) de 3 a **5 pasos**: `[step1Title, step2Title, testTitle, connectTitle, discoverTitle]` (agente → personaliza → Pruébalo → Conéctalo → Descúbrelo).
- **El gate es "≥1 canal", no WhatsApp.** El paso presenta WhatsApp destacado + el resto de canales como opciones secundarias:
  - **WhatsApp (recomendado, destacado):** `<WhatsAppConnectPanel tenantId={tenantId} variant="onboarding" onConnected={...} />` (Coexistence/QR + número nuevo + sandbox 555).
  - **Otros canales (tarjetas compactas en la misma pantalla):** flujos ya existentes — Instagram (OAuth popup, `instagramOAuthConnect`), Messenger (FB SDK, `messengerOAuthConnect`), Telegram (bot token), Email (SMTP), Web-chat (widget). Reusan los componentes/páginas de `/admin/channels/*`; el paso solo los presenta. Extraer a `SecondaryChannels.tsx`.
- **Finish = cualquier canal activo.** El handler "finish" (`api.applySetupTemplate`, línea 109) se dispara **al detectar ≥1 canal conectado** (vía `getSetupStatus().hasAnyChannel` — ver 4.4 — o el overview de canales), o vía "Conectar después" (escape suave).
- **Estado de conexión:** polling cada 2-3s del canal elegido (`GET /channels/whatsapp/status` para WA; los OAuth de IG/Messenger resuelven vía callback/BroadcastChannel) mientras el paso está activo (timeout 60s con ayuda).
- **Pre-check de prerrequisitos** (solo WhatsApp, antes de abrir el popup de Meta): "¿número libre de WhatsApp? ¿acceso al SMS/OTP? ¿2FA en Meta? ¿Business Manager?" — mensajes del Anexo B del doc de rediseño.
- **i18n nuevo:** `setupWizard.connect.*` → `title, subtitle, recommendedWhatsapp, otherChannels, precheckTitle, precheck1-4, connecting, connected, connectedDesc, connectLater, errorRetry`.

### 4.3 — Añadir el paso "Pruébalo" (el "aha")
- **Archivo:** `apps/dashboard/src/app/admin/setup-wizard/page.tsx` (paso 3, antes de Conéctalo).
- Embeber un chat de prueba dual-pane reusando la lógica de `apps/dashboard/src/app/admin/agent/[agentId]/test/page.tsx` (extraer a `AgentTestChat` componente si hace falta). El agente ya existe (creado por el vertical) — el usuario solo escribe y ve la respuesta usando el contexto real del negocio. **No requiere canal.**
- **i18n nuevo:** `setupWizard.test.*` → `title, subtitle, placeholder, send, thinking, tryExamples, looksGood, continueToConnect`.

### 4.4 — Reforzar el gating (obligatorio pero no atrapante)
- **Archivo:** `apps/dashboard/src/app/admin/page.tsx` (líneas 105-125, lógica de bounce).
- Mantener el bounce a `/admin/setup-wizard` si `!setupWizardCompleted` (anti-loop de 30s ya existe).
- **Añadir** una condición de activación: si `setupWizardCompleted` pero **no hay canal conectado**, mostrar en `/admin` un **banner persistente** (reusar patrón `SetupBanner.tsx`) con CTA "Conecta tu WhatsApp" → vuelve al paso Conéctalo. No es un hard-lock (no atrapa), pero es visible y persistente hasta conectar.
- **Backend (extender setup-status):** añadir `hasAnyChannel` al payload de `GET /persona/{tenantId}/setup-status` (`persona.controller.ts:223-279` / `persona.service.getSetupStatus`) consultando `channel_accounts.is_active` o `whatsapp_channels.channel_status='connected'`. Hoy el checklist lo calcula aparte vía `/channels/overview`; centralizarlo simplifica.

### 4.5 — Continuidad de datos `/onboarding` → Conéctalo (pre-fill del ESU)
- El vertical, nombre de negocio, categoría y timezone capturados en `/onboarding` ya están en `business_info` / `tenant.settings`. Inyectarlos como pre-fill en `FB.login` (`WhatsAppEmbeddedSignup.tsx` `loginOptions.extras.setup`) para acortar las pantallas de Meta (somos Tech Provider con `config_id` propio).
- **Verificar** qué campos acepta el pre-fill del `config_id` actual (único pendiente con Meta).

### 4.6 — Añadir el paso "Descúbrelo" (tour guiado vertical-aware + copilot)
- **Archivos:** nuevo paso final en `apps/dashboard/src/app/admin/setup-wizard/page.tsx` + componente `apps/dashboard/src/app/admin/setup-wizard/_components/ToolsTour.tsx`.
- **Contenido en DOS bloques (énfasis distinto), vertical-aware:** mostrar **todas las herramientas relevantes** (no solo 3-5), seleccionadas por `verticalConfig.industry`. **Objetivo principal: las que hacen que el agente responda mejor.** Definir `TOUR_BY_VERTICAL` con dos listas:
  - **Bloque A — empoderan al agente (énfasis principal, con indicador de "completitud del agente"):** transversal → KB/FAQs (pega tu web), info de negocio (horarios/políticas), tono/reglas, procedimientos; salud/belleza/gym → servicios + agenda; retail/ecommerce → catálogo + sync Shopify/Woo; restaurantes → menú (+Toast); inmobiliaria → listados; + integraciones verticales (Mindbody/Cliniko/Toast).
  - **Bloque B — gestión (recorrido ligero, compacto al final):** CRM/pipeline, analíticas, broadcast, automatizaciones, inbox/handoff, equipo.
  - Cada item: `{ name, desc (para qué sirve), href, block: 'A'|'B' }`. Bloque A con peso visual; Bloque B compacto.
- **Tarjeta de copilot (última):** presenta el **Copilot** (`HelpAssistant.tsx`, ya montado en el layout; backend `POST /copilot/chat`). CTA "Abrir copiloto" que dispara el `HelpAssistant` (Sheet) — **sin lógica nueva**, solo enlazar al toggle existente.
- **No bloquea:** "Saltar tour" siempre visible; cada tarjeta "Configurar ahora / Más tarde". Lo no configurado queda en el checklist hub (5.2). Una tarjeta a la vez (no info-dump).
- **Reuso:** `HelpAssistant.tsx` (tab "guías" + chat del copilot) y la visibilidad por vertical del sidebar. UI ligera, sin lógica de negocio nueva.
- **i18n nuevo:** `setupWizard.discover.*` → `title, subtitle, skipTour, configureNow, later, copilotCardTitle, copilotCardDesc, openCopilot` + `setupWizard.discover.tools.{toolKey}.name/desc` por herramienta (reusar nombres ya existentes en `agent`/`channels`/sidebar donde aplique).

---

## 5 — FASE 2 — El hub progresivo (anti-abrumamiento)

### 5.1 — "Pega tu web/IG" → bootstrap del KB
- **Frontend:** en `/onboarding` paso 2 (Objetivo) **o** en el checklist hub, un input "pega la URL de tu sitio" que llama a `POST /knowledge/documents/crawl` (`{ url }`). Añadir método `api.crawlUrl(url, title?, category?)` en `apps/dashboard/src/lib/api.ts`.
- **Efecto:** el agente "sabe" del negocio sin carga manual (patrón Tidio/Leadsales). Las FAQs del vertical ya están sembradas; esto las complementa.
- **i18n:** `onboarding.crawlUrlLabel/Placeholder/Hint` o `checklist.crawlUrl*`.

### 5.2 — Checklist hub vertical-aware con divulgación progresiva
- **Archivo:** `apps/dashboard/src/components/OnboardingChecklist.tsx` (ya es vertical-aware vía `verticalChecklist.{industry}.*`).
- Reorganizar en los **niveles** del doc (Día-1 esenciales visibles; Recomendado revelado tras activación; Avanzado/Vertical bajo "más").
- Items condicionales por vertical: salud/turismo/gym → "configura servicios y agenda"; retail/ecommerce → "conecta tu catálogo". Usar `verticalConfig.industry` (ya en localStorage/tenant.settings).
- **i18n:** extender `checklist.items.*` y `verticalChecklist.{industry}.*` con los nuevos items (4 idiomas).

### 5.3 — Tooltips contextuales (después de la 1ª sesión)
- Introducir features avanzadas con tooltips/coach-marks **tras** activación (no durante). Reusar el `HelpPanel` contextual existente (15 páginas, ya implementado).

---

## 6 — FASE 3 — Normalización de lo avanzado (jerarquía)

Aplicar el **mapa de 5 niveles** (Parte 5 del doc de rediseño). Ninguna feature nueva entra a la ruta crítica.

### 6.1 — Gating por nivel + badges
- En el sidebar/checklist, marcar features Nivel 3 (Avanzado) con badge de plan y Nivel V (Vertical) con visibilidad condicional por `verticalConfig` (el sidebar ya oculta items por vertical — extender al checklist).
- Features afectadas: Procedimientos (T2.12), Simulación (T2.13), ecommerce/dual-skillset (T2.17), integraciones verticales (T3.19), MCP (T3.20), B2B orgs (T3.21), atribución (T3.22), reviews (T3.23), managed (T3.24).

### 6.2 — "Prueba → Despliega" con Simulación (Pro+)
- Reusar `apps/dashboard/src/app/admin/agent/simulation/` (T2.13) como gate **opt-in** de go-live para planes Pro+: auto-generar escenarios desde los procedimientos/KB del tenant; "pasar simulación" habilita el despliegue. No bloquea a la PYME estándar (que usa el "Pruébalo" ligero de la Fase 1).

---

## 7 — Resumen de cambios por archivo

| Archivo | Cambio | Fase |
|---|---|---|
| `apps/dashboard/.../channels/whatsapp/WhatsAppConnectPanel.tsx` | **Nuevo** (extraer selector de rutas + ESU) | 1 |
| `apps/dashboard/.../channels/whatsapp/page.tsx` | Refactor: consumir el panel | 1 |
| `apps/dashboard/.../setup-wizard/page.tsx` | +3 pasos (Pruébalo, Conéctalo multi-canal, Descúbrelo); polling; pre-check | 1 |
| `apps/dashboard/.../setup-wizard/_components/ToolsTour.tsx` | **Nuevo** — tour de herramientas vertical-aware + tarjeta de copilot | 1 |
| `apps/dashboard/.../setup-wizard/_components/SecondaryChannels.tsx` | **Nuevo** — tarjetas IG/Messenger/Telegram/Email/web-chat (reusan flujos existentes) | 1 |
| `apps/dashboard/.../agent/[agentId]/test/` → extraer `AgentTestChat` | Reuso en wizard | 1 |
| `apps/dashboard/src/app/admin/page.tsx` | Banner persistente si no hay canal | 1 |
| `apps/dashboard/src/components/OnboardingChecklist.tsx` | Progreso regalado + hub progresivo + niveles | 0/2 |
| `apps/dashboard/src/app/onboarding/page.tsx` | Quitar referral; trial-first; "pega tu web" | 0/2 |
| `apps/dashboard/src/lib/api.ts` | +`getWhatsappStatus`, +`crawlUrl` | 1/2 |
| `apps/api/.../persona/persona.service.ts` + `.controller.ts` | +`hasAnyChannel` en setup-status | 1 |
| `apps/api/.../auth/auth.service.ts` | Trial-first sin tarjeta (coordinar billing) | 0 |
| `apps/api/.../analytics/` | Evento `activation_first_channel_connected` + TTFV | 0 |
| `apps/whatsapp/.../onboarding.service.ts` | (Solo si hace falta) aceptar número sandbox 555 | 1 |
| `messages/{es,en,pt,fr}.json` | +`setupWizard.connect.*`, +`setupWizard.test.*`, +`setupWizard.discover.*`, +`channels.whatsapp.routeSandbox*`, items de checklist | 1/2 |

**Backend ESU/coexistencia/migración:** **sin cambios** (ya construido).

---

## 8 — Nuevas claves i18n (a replicar en los 4 idiomas)

```jsonc
// setupWizard.connect
{
  "title": "Conecta tu primer canal",
  "subtitle": "Es el último paso para empezar a recibir clientes. WhatsApp es el recomendado.",
  "recommendedWhatsapp": "Recomendado · WhatsApp",
  "otherChannels": "O conecta otro canal: Instagram, Messenger, Telegram, Email o web-chat",
  "precheckTitle": "Antes de empezar, confirma:",
  "precheck1": "Tu número no está activo en WhatsApp (o usarás Coexistencia)",
  "precheck2": "Tienes acceso al teléfono para recibir el código (SMS/llamada)",
  "precheck3": "Tu cuenta de Meta tiene verificación en dos pasos",
  "precheck4": "Tienes un Business Manager (o lo creas en el proceso)",
  "connecting": "Conectando con WhatsApp…",
  "connected": "¡Conectado!",
  "connectedDesc": "Tu agente ya está en vivo en {phone}.",
  "connectLater": "Conectar después",
  "errorRetry": "No se pudo conectar. Reintentar"
}
// setupWizard.test
{
  "title": "Pruébalo",
  "subtitle": "Chatea con tu agente y míralo responder con la info de tu negocio.",
  "placeholder": "Escribe como si fueras un cliente…",
  "send": "Enviar",
  "thinking": "Tu agente está pensando…",
  "tryExamples": "Prueba: «¿Qué precios manejan?» o «¿Tienen disponibilidad?»",
  "looksGood": "Se ve bien",
  "continueToConnect": "Conectar mi canal"
}
// channels.whatsapp.routeSandbox (complementa los route* existentes)
{
  "routeSandboxTitle": "Probar con número de prueba",
  "routeSandboxShort": "Explóralo sin compromiso",
  "routeSandboxTag": "Sandbox",
  "routeSandboxTime": "1 min, sin verificación"
}
// setupWizard.discover (tour guiado vertical-aware + copilot)
{
  "title": "Descubre lo que puedes hacer",
  "subtitle": "Estas son las herramientas clave para tu negocio. Configúralas cuando quieras.",
  "skipTour": "Saltar tour",
  "configureNow": "Configurar ahora",
  "later": "Más tarde",
  "copilotCardTitle": "Tu copiloto está aquí para ayudarte",
  "copilotCardDesc": "¿Dudas de cómo configurar algo? Pregúntale al copiloto: canales, CRM, citas, automatizaciones y más.",
  "openCopilot": "Abrir copiloto"
  // + discover.tools.{toolKey}.name/desc por herramienta del vertical
}
```

---

## 9 — Verificación (antes de cada push)

```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npm run test:bootstrap        # DI errors (tsc no los detecta)
cd apps/dashboard && npx tsc --noEmit
# i18n: confirmar que las 4 claves nuevas existen en es/en/pt/fr (sin strings hardcodeados)
```
**Pruebas funcionales en producción** (el usuario testea en prod): (a) flujo completo signup→conectar con Coexistencia/QR; (b) sandbox 555; (c) banner persistente si se omite el canal; (d) evento de activación + TTFV registrados.

---

## 10 — Secuencia recomendada y esfuerzo

| Orden | Bloque | Esfuerzo | Riesgo |
|---|---|---|---|
| 1 | Fase 0.1 (instrumentar activación/TTFV) | S | Bajo |
| 2 | Fase 1.1 (extraer `WhatsAppConnectPanel`) | S | Bajo (refactor) |
| 3 | Fase 1.2-1.6 (Conéctalo multi-canal + Pruébalo + Descúbrelo + gating) | **L** | Medio (UX central) |
| 4 | Fase 0.2/0.4 (checklist progreso regalado + quitar referral) | S | Bajo |
| 5 | Fase 1.5 + 2.1 (pre-fill ESU + "pega tu web") | M | Bajo |
| 6 | Fase 2.2-2.3 (hub progresivo + tooltips) | M | Bajo |
| 7 | Fase 0.3 (trial-first) | M | Medio (billing) |
| 8 | Fase 3 (normalización avanzada + simulación Pro+) | M | Bajo |

> **Recomendación:** empezar por los bloques 1-3 (el corazón del valor: medir + mover la conexión al flujo guiado). Es el 80% del impacto con reuso casi total de componentes ya construidos.

---

## Pendientes externos (no bloquean el grueso del plan)
- Confirmar **disponibilidad de Coexistencia país por país en LatAm** (restricción de Meta).
- Confirmar **campos pre-fillables** del `config_id` actual de Meta (Fase 1.5).
- Confirmar que `onboarding.service` acepta el **número de prueba 555** display-name-only (Fase 1.1); si no, es el único toque de backend.
- Coordinar **trial-first** con el equipo/lógica de billing (Fase 0.3).
