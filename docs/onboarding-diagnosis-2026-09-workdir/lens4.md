# Lens 4 — Home (/admin) and everything that guides or interrupts

## Summary
The "one guide" rule of the September plan holds only for what it explicitly names (hero, agent-health card, red quality banner, mascot bubble, auto-tour are indeed silenced on /admin while no channel exists — page.tsx:546-553, QualityAttentionBanner.tsx:81, HelpAssistant.tsx:201). Everything the plan did not name still stacks: trial banner (returns every day), amber "connect" banner, dashboard HelpPanel with 5 tips, the setup card, four KPI tiles at 0 (unconditional, page.tsx:708), the mascot avatar itself, and a PWA install popup that fires the moment the browser allows (InstallPrompt.tsx:43-91, z-index 9999). That is 8-10 surfaces, matching the video. The setup card, meant in §12.3 to be 6 items "with the channel item expanded" and 3 essentials shown after the wizard, became a projection of the full agent-health assessment: mission, channel, agent, business, knowledge, team, hours, appointments, catalog, tests — 9-10 items in a 3x3 grid, two of them (mission, tests) with no "Mostrarme dónde" at all. This happened in 751d23e7 (Sep 7, added mission/tests tasks) and b5b71b60 (Sep 8, deleted the client-side 6-item definition). Nothing in the card or the home tells the owner which single item makes the agent answer on WhatsApp (only "channel" does), there is no time estimate, no next-step highlight, and the plan's "card writes completed at 100 %" was never built. Global search matches only labels/route ids, so "Identidad" can only reach /admin/identity; the agent is titled "Agente IA". Onboarding metrics measure signup→first channel and a 5-stage funnel; no per-step drop-off, no time-to-first-test-reply, no per-item completion, and onboardingStage is not aggregated anywhere.

## Journey
### /admin (tenant_admin, stage agent_reviewed, no channel, desktop, first visit)
- TopBar
- TrialCountdownBanner (dismissable per day)
- EmailVerificationBanner (if unverified)
- FiscalBanner [inferred: only when fiscal data missing]
- QualityAttentionBanner — SUPPRESSED (isOnboardingGuidanceOwningHome)
- Amber 'Todavía no conectaste un canal' banner with 2 CTAs (Conectar + Mostrarme dónde)
- Resume-wizard banner (only if channel_deferred/skipped)
- H1 + vertical greeting + DataSourceBadge
- HelpPanel 'dashboard' (5 tips, KPI-oriented)
- AgentHealthCard — SUPPRESSED
- InitialSetupCard 'Puesta en marcha' 9-10 items, grid 2/3 cols, N/M esenciales
- Empty-state hero — SUPPRESSED
- 4 KPI tiles at 0 (unconditional)
- vertical widgets / activity feed
- OVERLAY: PWA InstallPrompt bottom-center z9999 as soon as beforeinstallprompt fires
- OVERLAY: mascot avatar bottom-right z40 (bubble silenced only on /admin)
- OVERLAY: product tour only if wizard set parallly:tour:pending and width>=768
- words before first input: 0
- notes: ~8 visible blocks + 2-3 overlays. Matches the video (amber banner + 3x3 card + 4 zeros + mascot + PWA popup).

## Findings
### H4-01 [critical/clutter/cross/M] Setup card became the full health checklist (9-10 items), not the 3-6 essentials the plan promised
- `apps/api/src/modules/copilot/agent-assessment.service.ts:241-308` [V] — tasks = [mission] ... for AGENT_SETUP_TASK_CHECKS {channel, agent, business, knowledge, team, hours, appointments} ... push catalog ... push tests
- `apps/dashboard/src/lib/initial-setup.ts:7-16` [V] — This file used to carry a second, fully-tested implementation ... that no screen rendered ... extend the assessment instead
- `docs/assist-quality-guided-tours-plan-2026-09.md:593-607` [V] — §12.3: 6 items ... (3) Listo: qué sigue (los 3 esenciales de la tarjeta)
- `apps/dashboard/src/components/InitialSetupCard.tsx:137` [V] — <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
- **Impact:** Nataly sees nine equal boxes and says 'tendría que trabajar en todos estos…'. Nothing says only 'Conectar y asignar un canal' is what makes the agent answer; 'team', 'tests', 'mission', 'hours' read as mandatory.
- **Video:** 30:15 'O sea, tendría que trabajar en todos estos…'
- **Fix:** Split the assessment into `essential` (channel, agent reviewed, business) vs `improve` (rest); the day-0 card shows only essentials with the next one expanded and a single primary CTA; the rest moves to the health panel. Commits to revisit: 751d23e7 (mission/tests) and b5b71b60.
### H4-02 [high/clutter/day0/S] 'One guide' rule holds only for the surfaces the plan named; 8-10 things still render on a channel-less home
- `apps/dashboard/src/app/admin/page.tsx:708` [V] — {/* Stats Grid */} <div className="mb-8 grid ... lg:grid-cols-4"> {statConfig.map(
- `apps/dashboard/src/app/admin/page.tsx:537-549` [V] — <HelpPanel title={tHelp("dashboard.title")} ... {canViewAgentHealth && !setupCardOnly && !guideSilent && <AgentHealthCard />}
- `apps/dashboard/src/app/admin/layout.tsx:204-244` [V] — MaintenanceBanner, ImpersonationBanner, TopBar, TrialCountdownBanner, EmailVerificationBanner, FiscalBanner, QualityAttentionBanner ... InstallPrompt, OfflineIndicator, NavigationCommandPalette, HelpAssistant
- **Impact:** The suppression logic is real (hero, health card, red banner, bubble are silent) but the owner still meets an amber banner, a 9-item card, 4 zeros, a 5-tip help panel, a trial banner and a PWA popup at once. Two CTAs for the same channel action (banner + card item).
- **Video:** 30:15 home
- **Fix:** In setup_card_only: hide KPI grid and dashboard HelpPanel; merge the amber banner into the card's expanded channel item (one CTA); defer trial banner and PWA prompt until landing === 'normal'.
### H4-03 [high/flow/day0/XS] PWA 'Instalar Parallly' popup interrupts day-0 with no stage or visit gate
- `apps/dashboard/src/components/pwa/InstallPrompt.tsx:43-52, 91-111` [V] — window.addEventListener("beforeinstallprompt", handler) ... if (isStandalone || !canInstall || dismissed) return null; ... position: fixed, bottom: 20, zIndex: 9999
- **Impact:** First minute on the wizard, a dark box asks to install an app she has not yet used; it sits above everything (z 9999) and over the mascot on mobile.
- **Video:** 00:15 wizard first screen
- **Fix:** Subscribe to the onboarding landing signal and render only when landing === 'normal' (or after N sessions).
### H4-04 [medium/clutter/day0/S] Mascot bubble is silenced only on /admin; on the wizard and editor it still greets and the avatar always shows
- `apps/dashboard/src/components/HelpAssistant.tsx:198-240` [V] — if (setupCardIsTheGuide) { setIntro("done"); return; } ... sessionStorage.getItem(ANNOUNCED_KEY)
- `apps/dashboard/src/lib/onboarding-guide-signal.ts:26-30, 58-60` [V] — Sólo `/admin` publica ... isSetupCardTheActiveGuide = signal === "setup_card_only"
- `apps/dashboard/src/components/HelpAssistant.tsx:457` [V] — className="group fixed bottom-4 right-4 z-40 ..."
- **Impact:** On the wizard (signal 'unknown') the bubble pops after 0.9 s with 'Soy tu asistente de IA…' — one more voice next to 'Guiarme con Parallly Assist'. Dismiss memory is per browser session (sessionStorage), so it returns each new tab.
- **Video:** 00:15 mascot beside PWA popup
- **Fix:** Treat 'unknown' and the wizard route as 'guidance owns the screen'; persist announced flag in localStorage.
### H4-05 [high/affordance/day0/S] Two items (mission, tests) have no 'Mostrarme dónde', and the first item is 'Acordar la misión', not the channel
- `apps/api/src/modules/copilot/agent-assessment.service.ts:241-242, 304-308` [V] — key: 'mission' ... tourId: null ... key: 'tests' ... tourId: 'run_agent_tests'
- `apps/dashboard/src/components/InitialSetupCard.tsx:104, 153-160` [V] — const firstPending = items.find((item) => !item.done); ... {canShowMe && !item.verification && (<button ... {t("showMe")}
- **Impact:** The 'next' item (setup-next anchor) is the mission, which sends her back to the agent editor that already overwhelmed her; the channel is item 2. Mission has Continuar only. Note: tests tourId is set in code (run_agent_tests) but mission is null [V].
- **Video:** 30:15
- **Fix:** Order channel first when no channel exists; give every day-0 item a tour or drop it from day-0.
### H4-06 [medium/copy/day0/S] No next-step highlight, no time estimate, no 'what is enough' — progress is only 'N/M esenciales'
- `apps/dashboard/messages/es.json:qualityHealth.setup` [V] — progress: "{completed}/{total} esenciales"; description: "Solo los pasos esenciales disponibles para tu plan, rol e industria. Esta guía desaparece al completarlos."
- `apps/dashboard/src/components/InitialSetupCard.tsx:140-146` [V] — const isNext = firstPending?.key === item.key; ... {...(isNext ? { id: guidedTourAnchorId("setup-next") } : {})}
- **Impact:** Calling all 9 'esenciales' contradicts reality (a solo dance teacher does not need 'team'); 'isNext' only sets an id, no visual difference; the plan's 'canal expandido' and '~5 min' never appear.
- **Video:** 30:15
- **Fix:** Visual 'Siguiente' badge + one-line 'con esto el agente ya responde' after the channel item; time hints per item.
### H4-07 [medium/state/cross/S] Plan's 'card writes completed at 100 %' never built; wizard 'Listo' writes completed without a channel and its tour CTA now launches a publish tour
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:443-461` [V] — saveOrAdvance({ markCompleted: true, stage: "completed" }) ... if (options.openTour && workspaceRef.current?.agentId) { dispatch GUIDED_TOUR_START_EVENT tourId: "publish_agent_revision" ... } else if (options.openTour) localStorage.setItem(PRODUCT_TOUR_PENDING_KEY, "true")
- `packages/shared/src/onboarding-stage-contract.ts:47-48, 115` [V] — `completed` is deliberately absent: finishing the wizard is not connecting a channel ... Never returns `completed` from derivation alone
- `apps/dashboard/src/components/InitialSetupCard.tsx:96-99` [V] — onProgressRef.current?.({ total: items.length, completed }) — no API write
- **Impact:** 'Ver el recorrido del panel' on the Listo step opens a 'publish agent revision' tour (draft/release concept from d50d1670/cb9088cb) instead of the home tour the button promises; stage semantics drift between shared contract comment and wizard.
- **Fix:** Rename/route the CTA to what it does, or restore PRODUCT_TOUR_PENDING_KEY for the home tour; let the API advance to completed only when channel + essentials pass.
### H4-08 [medium/flow/later_config/S] Global search matches labels/route ids only; 'Identidad' can only reach CRM identity
- `apps/dashboard/src/components/layout/NavigationCommandPalette.tsx:169-172` [V] — normalizeSearch(`${entry.label} ${entry.route.id} ${entry.route.pattern.replaceAll("-", " ")}`).includes(normalizedQuery)
- `apps/dashboard/src/lib/navigation-contract.ts:68, 96` [V] — { id: "agents", pattern: "/admin/agent", titleKey: "nav.items.aiAgent" } ... { id: "identity", pattern: "/admin/identity", titleKey: "nav.items.identity" }
- `apps/dashboard/messages/es.json:nav.items.identity / agent.editor.identityTitle / agentQuality.checks.persona_identity` [V] — "Identidad" (CRM) vs "Identidad" (editor section) vs "Identidad y rol del agente" (check)
- **Impact:** The health check told her 'Identidad y rol del agente' is pending; searching that word lands in contact deduplication. Dynamic routes (/admin/agent/:id) are excluded from search, so the agent editor is unreachable by search at all.
- **Video:** search 'Identidad' → /admin/identity
- **Fix:** Add `keywords` to NavigationRouteDefinition (agent: identidad, nombre, saludo, personalidad); rename CRM item to 'Identidad de contactos'.
### H4-09 [high/metrics/health_panel/M] Activation metrics cannot tell whether onboarding works: no per-step drop-off, no time-to-first-test-reply, no item completion
- `apps/api/src/modules/financials/financials.service.ts:230-257` [V] — "activated" once it has >=1 active channel. TTFV = first active channel ... under_15min, under_1h, under_24h
- `apps/api/src/modules/tenants/tenants.service.ts:2060-2064` [V] — signups → 'Onboarding completado' → 'Canal conectado' → 'Primer mensaje' → 'Pagando'
- `apps/api/src/modules/tenants/tenant-stall-diagnosis.util.ts:64-114` [V] — channel_never_connected, no_agent, onboarding_incomplete, never_received_a_message, dormant, never_logged_in, no_knowledge_base
- **Impact:** For the owner of Parallly: Nataly's 48 minutes register as one 'onboarded, no channel' row. Which wizard step, which card item, or which banner lost her is invisible; onboardingStage (account_created/agent_reviewed/channel_deferred) is stored but never aggregated; test-chat first reply is not timestamped.
- **Fix:** Emit onboarding events (wizard step enter/exit, card item click, tour start/finish, first test reply) to a tenant-level table; add stage breakdown and wizard-step funnel to OnboardingMetricsCard/funnel page.
### H4-10 [low/mobile/day0/S] Mobile: tour is desktop-only, while PWA prompt, mascot and 2-column card stack at the bottom
- `apps/dashboard/src/lib/product-tour-contract.ts:5, 16-18` [V] — PRODUCT_TOUR_MIN_WIDTH = 768 ... canRunProductTourAtWidth
- `apps/dashboard/src/components/pwa/InstallPrompt.tsx:94-110` [V] — position: fixed, bottom: 20, left: 50%, zIndex: 9999, maxWidth: 400
- `apps/dashboard/src/components/HelpAssistant.tsx:457` [V] — fixed bottom-4 right-4 z-40
- **Impact:** On a phone 'Mostrarme dónde' buttons still render on the card [inferred: startTour dispatches regardless of width; guided tours' own width gate not read here] while the general tour will not start; the install box (400 px wide) covers the mascot and the card's last row.
- **Fix:** Hide install prompt below 768 px during onboarding; stack card single-column with the next item only on mobile.

## What works
- Fail-closed guide: UNKNOWN_ONBOARDING_GUIDE draws nothing until setup-status is read; a failed read no longer declares the account finished (lib/onboarding-guide.ts:123-140) [V].
- Single landing signal really silences the red quality banner, the hero, the health card and the mascot bubble on /admin while no channel exists (page.tsx:546-553, QualityAttentionBanner.tsx:81, HelpAssistant.tsx:201) [V].
- Setup card is fail-closed: an unreadable assessment shows 'No pudimos verificar estos pasos. No asumiremos que están incompletos' + Reintentar; unknown checks show Reintentar instead of a false 'Continuar' [V].
- Product tour is no longer auto-fired on login; it only starts from an explicit wizard choice or the Assist restart event, and only ≥768 px [V].
- Login redirect to the wizard requires a server-sent stage; old tenants no longer bounce to 'Conoce a tu agente' (onboarding-guide.ts:176-190) [V].
- Trial banner dismissal is per tenant per day and the soft-lock variant is correctly non-dismissable [V].

## Regressions vs Sept plan
- **PARTIAL** §12.1 [4] /admin ONE guide: channel missing → only the setup card with channel item expanded + Mostrarme dónde — page.tsx:476-553 suppresses hero/health/red banner/bubble, but adds an amber banner on top of the card, keeps KPI grid (708) and HelpPanel (537), no item expansion; PWA prompt and trial banner untouched
- **DONE** §12.1 [4] hero, auto tour and red quality banner suppressed while setup incomplete — page.tsx:463-466 isEmptyTenant gated by !setupCardOnly; shared contract offerTour false in setup_card_only; QualityAttentionBanner.tsx:81
- **BROKEN** §12.3 card items = channel + 5 critical checks (6), in that order — agent-assessment.service.ts:241-308 emits mission, channel, agent, business, knowledge, team, hours, appointments, catalog, tests (9-10); mission first; 751d23e7 + b5b71b60
- **PARTIAL** §12.3 two actions per item (Continuar + Mostrarme dónde) — InitialSetupCard.tsx:147-160; mission has tourId null (service:242) so only Continuar
- **NEVER_DONE** §12.3 card writes `completed` at 100 % — InitialSetupCard.tsx:96-99 only calls onProgress; no API call; grep finds no 'completed' writer outside the wizard finish
- **PARTIAL** §12.1 (3) Listo: 'Ver el recorrido del panel' offered, not fired — setup-wizard/page.tsx:452-460 fires publish_agent_revision tour when agentId exists; falls back to home tour pending key otherwise
- **DONE** §12.2 QualityAttentionBanner null on /admin while landing !== 'normal' — QualityAttentionBanner.tsx:81 isOnboardingGuidanceOwningHome (also covers 'unknown')

## Open questions
- Does FiscalBanner render for a brand-new CO tenant on day 0 (fiscal.gate_enabled default OFF)? Not read.
- Does the API refuse `stage: 'completed'` from the wizard when no channel exists (advanceOnboardingStage), or does the contract comment lie? persona.controller.ts:175-193 partially read.
- Is `catalog` applicable for industry 'danza/academia' (i.e. was the 9th item catalog or appointments in the video)?