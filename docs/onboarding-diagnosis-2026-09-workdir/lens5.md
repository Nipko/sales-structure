# Lens 5 — Connecting WhatsApp and seeing the agent answer (/admin/channels, /admin/channels/whatsapp, WhatsAppEmbeddedSignup, whatsapp onboarding.service, wizard test chat)

## Summary
The WhatsApp connection screen is technically the most mature piece of the onboarding: the Sept plan §12.4 is essentially DONE in code (shared route catalogue, brief, pre-check on both screens, 21 translated error cards with Retry, popup watchdog, COMPLETED_WITH_WARNINGS card, "Probá tu agente" wa.me card in page and wizard, mobile note). What killed Nataly's session is not a missing error card but three product gaps the code cannot paper over. (1) The screen has no way to recognise her real situation: a number already on Cloud API with another BSP. The default-selected "Recomendado" route (coexistence) demands the WhatsApp Business App and a QR she could never scan; the only applicable route ("Migrar desde otro proveedor") is third, un-recommended, and requires 2FA turned off at the old provider and the same Business Manager — impossible inside one call. The pre-check is three generic awareness boxes, not a diagnosis. (2) Once the Meta window opens, the watchdog deliberately stands down, so a Meta-side rejection inside the popup leaves "Esperando autorización…" until the person closes the window; the mapped error then says "vuelve a intentar" without naming the route she should have taken. (3) The novice reads ~450 words before the button, and help.channels/help.channelsWhatsapp contradict the routes ("elimínalo de la app", "página de Facebook", "Migración… dejarás de recibir mensajes en la app"). Meta-free "aha" exists (wizard test chat, /admin/agent/simulation) but is buried under a draft/release model and never proposed as the alternative when the Meta wall appears; nothing in the connect screen says "you can already chat with your agent while you sort out Meta".

## Journey
### /admin/channels
- PageHeader Canales + subtitle
- HelpPanel 'connect_channel' (collapsed by default; 161 words + 5 tips when open)
- LoadFailureNotice (only on read failure)
- 4 cards WhatsApp/Instagram/Messenger/Telegram with Conectado/Desconectado + count/limit
- words before first input: 30
- notes: Web widget not a card (lives at /admin/settings/integrations/web-chat). HelpPanel tip 1 asks for a Facebook page.
### /admin/channels/whatsapp (not connected)
- Header + status pill
- HelpPanel first_channel_whatsapp (collapsed)
- metaBrief paragraph
- 'Elige tu método de conexión' header
- Pre-check: 3 boxes → button 'Confirmá los puntos para continuar'
- (after gate) 3 route cards, coexistence pre-selected 'Recomendado'
- WhatsAppRouteBrief: overview, sync yes/no, limits, 4 steps, 4 reqs, 24 h warning
- Connect button ('Esperando autorización…' while launching) + securityNote
- error card (amber, title+action+Reintentar) when a failure is reported
- required: 3 pre-check boxes, route choice (defaulted)
- words before first input: 150
- notes: ≈452 words before the Connect button on the coexistence route.
### Meta popup → return
- 3-step progress (auth/connecting/activating)
- 'Canal conectado. Número: X' toast
- Warnings card if COMPLETED_WITH_WARNINGS
- 'Probá tu agente' wa.me card (hedged copy)
- profile/templates/spend blocks
- words before first input: 0
- notes: No Meta-free alternative shown on failure.

## Findings
### L5-01 [critical/flow/day0/M] A number already on Cloud API with another provider has no viable day-0 path and the UI never says so
- `apps/dashboard/src/app/admin/channels/whatsapp/whatsapp-connect-routes.ts:44-52` [V] — id: "coexistence", mode: "coexistence", recommended: true
- `apps/dashboard/src/app/admin/channels/whatsapp/page.tsx:69` [V] — useState<WhatsAppConnectRouteId>("coexistence")
- `apps/dashboard/messages/es.json:channels.whatsapp.routeMigrationReq1-2, routeMigrationShort` [V] — Ambas cuentas (origen y destino) bajo el mismo Meta Business Manager / Verificación en dos pasos (2FA) desactivada en el proveedor actual
- `apps/whatsapp/src/modules/onboarding/onboarding.service.ts:314-315` [V] — Phone may already be registered — this is not fatal
- `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppPrerequisites.tsx:8-14` [V] — Es un gate suave (awareness), no validación dura
- **Impact:** Nataly's number was 'una cuenta API' (Germán 36:40). The pre-selected Recomendado route asks for the Business App + QR she does not have; the only fitting route (Migrar) is third, unmarked, and needs the old BSP to disable 2FA first — nothing she could do on the call. No question ('¿Dónde vive hoy tu número?') routes her, no error names the right route, and the service treats 'already registered' as non-fatal so nobody learns why.
- **Video:** 33:45 'pide las tres… QR… este WhatsApp no está abierto' → 36:40 'es una cuenta API'
- **Fix:** Replace the 3 checkboxes with one triage question ('Mi número: está en la app Business en un celular / es nuevo / ya lo usa otro proveedor de API / no sé'), pre-select the route from the answer, and for the BSP case show a one-line plan ('pedí a tu proveedor apagar el 2FA; mientras tanto probá tu agente acá') with the Meta-free test CTA.
### L5-02 [high/state/day0/S] 'Esperando autorización…' has no exit once the Meta window opened; Meta-side failures are reported only after the person closes the popup
- `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppEmbeddedSignup.tsx:91-92, 555-569` [V] — const windowNeverOpened = () => !focusLostRef.current && !metaSignalRef.current; const giveUp = () => { if (!launchingRef.current || !windowNeverOpened()) return;
- `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppEmbeddedSignup.tsx:378-390` [V] — if (!response.authResponse?.code) { … reportFailure({ key: details ? "metaError" : "authorization"
- `apps/dashboard/messages/es.json:channels.whatsapp.errors.authorization / metaError` [V] — La ventana se cerró antes de terminar. Vuelve a intentar… / Meta rechazó la conexión. Vuelve a intentar.
- **Impact:** The 75 s/4 s watchdog only fires when the popup never opened (popup blocked). After focus is lost there is no timer by design, so while Meta shows its own error inside the popup the button stays 'Esperando autorización…' (39:18) until she closes the window; the card that follows says 'vuelve a intentar' with no diagnosis of the route. Paths that end here: popup blocked (mapped), SDK not loaded (mapped, button disabled), config_id missing (mapped, non-retryable), Meta ERROR/CANCEL postMessage (mapped), user closes (mapped 'authorization'), Meta error left open inside the popup (unbounded wait).
- **Video:** 39:18 'Esperando autorización…' → 40:26 'parece que hay un error ahí'
- **Fix:** While launching after focus loss, render a live hint under the button ('La ventana de Meta está abierta; si ves un error ahí, cerrala y te decimos qué hacer') plus a 'Cancelar' link that resets state; map Meta detail strings containing 'already in use/ya está registrado' to a route-specific action (Migrar).
### L5-03 [high/flow/cross/M] Meta-free 'aha' exists but is never offered as the alternative when the Meta wall appears
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:609-616` [V] — <AgentTestChat … blocked={!workspace || Boolean(workspace.draft && !workspace.draft.currentBase) || hasUnsavedEdits || saving} />
- `apps/dashboard/src/app/admin/setup-wizard/_components/AgentTestChat.tsx:64` [V] — tDraft(blocked ? 'saveBeforeTest' : configurationRevisionId ? 'testingDraft' : 'testingOperational')
- `apps/dashboard/src/app/admin/channels/whatsapp/page.tsx:353-371` [V] — {isConnected && phoneNumber && ( … whatsapp-test … wa.me
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:683-693` [V] — connectStep.laterTitle / connect.connectLater → stage: "channel_deferred"
- **Impact:** Inventory today: (a) wizard step-1 test chat (bottom of a long screen; blocked when a draft lacks a verified base or edits are unsaved; tests the operational version if no draft); (b) /admin/agent/simulation (help.agentSimulation, reachable from Agentes IA only [inferred]); (c) /admin/agent/[id]/test = prompt/tools/contract inspector for developers, not a novice surface; (d) web widget at /admin/settings/integrations/web-chat, absent from the Canales cards; (e) wa.me card only after a real connect. None is shareable with a colleague (no link/QR), and neither the channels page nor the failed connect state points to any of them. 'Conectar después' exists but does not say 'you can already chat with your agent'.
- **Video:** 40:48 'fue apenas el avance hasta ahí' — 48 min, zero answers
- **Fix:** On /admin/channels/whatsapp (not connected or after a failure) and on the Home banner, add a 'Probá tu agente ahora, sin WhatsApp' block linking to the simulation/test chat; make the web widget a Canales card with a copyable demo link so the owner can show a colleague.
### L5-04 [medium/copy/day0/S] Pre-check is a generic awareness gate that hides the routes and does not mention the 24 h window, the 7-day rule or the phone-in-hand
- `apps/dashboard/src/app/admin/channels/whatsapp/page.tsx:406-414` [V] — {!prereqsOk ? ( … <WhatsAppPrerequisites onContinue={() => setPrereqsOk(true)} /> ) : ( … Route cards
- `apps/dashboard/messages/es.json:setupWizard.connect.prereqs.item1-3` [V] — Tené esto a mano… Un número de teléfono para WhatsApp… código de verificación… Una cuenta de Facebook
- `apps/dashboard/messages/es.json:channels.whatsapp.routeCoexNote, routeCoexistenceReq3` [V] — Tienes 24 horas después de conectar… / El número debe tener al menos 7 días de actividad en la app
- **Impact:** She read the three boxes as three mandatory requirements ('pide las tres: SMS, Facebook y el QR'). The boxes come BEFORE the route choice, so she must promise things she does not know apply; the real per-route needs (phone with the app in hand for the QR, 24 h to authorise history, 2FA off at the provider) only appear in the brief after the gate. Copy also switches to voseo ('Tené', 'Confirmá') while the rest of the screen is tuteo.
- **Video:** 33:45
- **Fix:** Merge pre-check into the route card (each card lists 2-3 concrete 'necesitás ahora' items) and drop the ticking gate; align to tuteo.
### L5-05 [medium/help-drift/cross/XS] ~450 words before the Connect button plus a HelpPanel whose tips contradict the route catalogue
- `apps/dashboard/messages/es.json:help.channelsWhatsapp.tips[0..1]` [V] — si ya lo usas en tu celular, primero elimínalo de la app … 'Migración' para trasladar el número a la API (dejarás de recibir mensajes en la app)
- `apps/dashboard/messages/es.json:help.channels.tips[0], help.channelsWhatsapp.tips[2]` [V] — Vas a necesitar una cuenta de WhatsApp Business y una página de Facebook / selecciona la página de Facebook asociada a tu negocio
- `apps/dashboard/messages/es.json:channels.whatsapp.routeMigrationOverview` [V] — Transfiere tu número desde otro proveedor de API de WhatsApp Business (Wati, 360dialog…)
- `apps/dashboard/src/app/admin/channels/page.tsx:25-64, 165-171` [V] — 4 static cards (whatsapp/instagram/messenger/telegram); HelpPanel tourId="connect_channel"
- **Impact:** help.channelsWhatsapp (199 words) tells her to delete WhatsApp from her phone — the opposite of the Recomendado coexistence route — and describes 'Migración' as leaving the app, while the card says it is for BSP numbers. help.channels says a Facebook page is needed (it is not for WhatsApp) and omits the web widget. Word count before the button on the coexistence route ≈452 (prereqs 62 + brief 279 + frame 82 + other cards 29). Email/SMS help drift not present in these two namespaces [V: no email/sms mention].
- **Video:** 33:45 (HelpPanel open above the cards)
- **Fix:** Rewrite the 4 tips of help.channelsWhatsapp to mirror the three route cards (4 languages); delete 'página de Facebook' from help.channels; collapse the brief's sync/limits blocks behind a 'Ver detalles' toggle.
### L5-06 [medium/copy/cross/S] Success message after connecting is hedged on the draft/release model instead of confirming the agent answers
- `apps/dashboard/messages/es.json:channels.whatsapp.testAgentDesc` [V] — Si este número tiene un agente activo con una versión publicada, envíale un WhatsApp a {number} para probarla. Si no responde, revisa la asignación y la publicación del agente.
- `apps/dashboard/messages/es.json:setupWizard.connectStep.subtitle, doneStep.subtitle` [V] — El agente empieza a responder después de asignar y publicar una versión aprobada. / Revisa y publica el borrador…
- `apps/dashboard/src/app/admin/channels/whatsapp/page.tsx:334-350` [V] — connectWarnings … twn(`codes.${warning}`)
- **Impact:** Even on success the 'Probá tu agente' card says 'if… if not, check assignment and publication' — two concepts introduced by d50d1670 that the novice has not met. The card cannot tell her whether the number is actually bound to an active, published agent (it only checks isConnected && phoneNumber), so the first wa.me message can go unanswered with no in-product explanation. Warnings card is correctly implemented (2 codes emitted by the service).
- **Video:** n/a (never reached)
- **Fix:** Compute readiness server-side (channel bound to active persona with a release) and render one of two cards: 'Listo: escribile ahora' vs 'Falta asignar/publicar → botón'.

## What works
- Shared route catalogue + WhatsAppRouteBrief consumed by both wizard and page (whatsapp-connect-routes.ts:1-14, WhatsAppConnectPanel.tsx:130) — one experience, sandbox route correctly removed.
- 21 error cards (title + next action + Retry, Plan link for planLimit) mapped from 13 service codes + HTTP 402/403/409 (WhatsAppEmbeddedSignup.tsx:98-121, 176-188, 651-680); raw server prose goes to console, not screen.
- Popup-blocked watchdog with focus probe (4 s) and 75 s backstop that never fires while the person is inside Meta (WhatsAppEmbeddedSignup.tsx:548-569).
- COMPLETED_WITH_WARNINGS → codes (onboarding.service.ts:43-46, 524, 669) → translated amber card (page.tsx:334-350, WhatsAppConnectPanel.tsx:49-60).
- 'Probá tu agente' wa.me card on page and in wizard, wizard advances to Listo only on the person's click (WhatsAppConnectPanel.tsx:81-98, setup-wizard/page.tsx onAcknowledged).
- Mobile note under 768 px (mobileNote) and 'ya hay un onboarding en progreso' resolved by polling the existing one before telling the person to wait (page 455-470, pollExistingOnboarding).
- firstChannelConnectedAt + onboardingStage advance are idempotent (channel-management.controller.ts:63-93).

## Regressions vs Sept plan
- **DONE** §12.4 shared WHATSAPP_CONNECT_ROUTES, 'Número de prueba' removed — whatsapp-connect-routes.ts:17-75 [V]
- **DONE** §12.4 WhatsAppRouteBrief in both places before the button — page.tsx:461, WhatsAppConnectPanel.tsx:130 [V]
- **DONE** §12.4 pre-check also on the page — page.tsx:406-414 [V] — but it gates the route cards (L5-04)
- **DONE** §12.4 error map code→i18n with action/link, polling of in-progress onboarding, retryable — WhatsAppEmbeddedSignup.tsx:98-121, 455-470, es.json channels.whatsapp.errors (21 keys) [V]
- **PARTIAL** §12.4 Meta window timeout 60-90 s + focus signal + Reintentar — 75 s/4 s exist but by design only when the window never opened; no exit once focus lost (WhatsAppEmbeddedSignup.tsx:555-569) [V]
- **DONE** §12.4 COMPLETED_WITH_WARNINGS with warnings[] codes + amber card + Probá tu agente — onboarding.service.ts:43-46,492-524; page.tsx:334-371 [V]
- **DONE** §12.4 Probá tu agente in the wizard; advance waits for click — WhatsAppConnectPanel.tsx:81-98; setup-wizard/page.tsx onAcknowledged→LAST_STEP [V]
- **DONE** §12.4 <768 px notice — WhatsAppEmbeddedSignup.tsx:93, 590 mobileNote [V]
- **NEVER_DONE** §12.6 help.channelsWhatsapp aligned with the real routes — tips still say 'elimínalo de la app' and 'Migración… dejarás de recibir mensajes en la app' (es.json help.channelsWhatsapp) [V]

## Open questions
- What exact Meta error appeared at 40:26 (inside the popup vs our card)? Only production logs / the tenant's whatsapp_onboarding row for Go Entertainment SAS can tell; the code cannot learn a Meta-side 'number in use' from the popup.
- Is the BSP number's WABA under a Business Manager the tenant controls? If not, migration is a multi-day process and the product should say so before the click.
- Is /admin/agent/simulation linked anywhere reachable from Home or the channels page for a tenant_admin? (not grepped; [inferred] only from the agent area).