# LENS 7 — Help system (help panels, guided tours, Assist KB)

## Summary
The help system is not outdated as a whole: KB articles were re-edited on Sep 4/13/15, 17 guided tours exist with a spec that fails when an anchor disappears, and every HelpPanel is collapsed by default. The problem is that it is three uncoordinated layers (HelpPanel tips, guided tours, KB/Assist) with no shared source of truth for UI labels, so the tips drift while the tours stay correct. On the exact screens in the video the drift is material: help.agentEditor tips[0] sends the novice to a "pestaña Identidad" that does not exist (tabs are Persona/Instrucciones/Herramientas/Horario), which is exactly the word Nataly then typed into global search and landed in CRM dedup; tips[5] (added Sep 13 by 6f02b278, after the wizard shipped) says "Arriba, prepara las asignaciones" while the panel itself renders ABOVE the assignment block on the same page; help.dashboard points to "Configuración → IA", a super_admin-only route. Worse, the only automated check on help copy (i18n-parity.spec L124-140) REQUIRES the word "publicar" in the day-0 editor and wizard help, institutionalising the draft/candidate/publish jargon on the first screen. The mascot namespace carries 1,587 words of dead engineering copy ("Calibración de Coseno", "RAG++", "HubSpot"). The KB still sells SMS credits (13-sms-creditos.md, FAQs in 01/06) although the owner switched SMS off, and 07-probar-agente predates drafts. Day 0 should show one help surface (the tour of the current step) and none of: 6-step editor panel, "¿Cómo funciona este asistente?" toggle, legacy onborda ProductTour, Assist mascot announce, KB links.

## Journey
### /admin/setup-wizard step 1 (help layer only)
- HelpPanel collapsed button '¿Cómo funciona este asistente?' (help.setupWizard, 121w when opened, 4 tips)
- Assist mascot launcher + announce bubble (helpAssistant.announce.*)
- Legacy onborda ProductTour may auto-start from localStorage TOUR_PENDING_KEY
- notes: HelpPanel has NO tourId although resume_setup_wizard exists; description already uses 'borrador / asignación / publica la versión aprobada' [V es.json help.setupWizard.description]
### /admin/agent/[agentId] (editor)
- HelpPanel help.agentEditor (189w, 6 numbered tips) at page.tsx L700
- Hero: activation toggle (agent-active L751) + channel assignment (agent-channels L781) — always rendered, no collapse
- TabNav Persona/Instrucciones/Herramientas/Horario L906
- tourId=agent_handoff_rules (6 steps, 116w) offered from the panel
- notes: Tips reference 'pestaña Identidad' (absent) and 'Arriba' (assignments are below the panel)
### /admin (home)
- HelpPanel help.dashboard (154w, 5 tips) at page.tsx L536, no tourId
- InitialSetupCard items with 'Mostrarme dónde' (tours by quality code)
- notes: home_first_steps tour exists (4 steps, 78w, good copy) but is only startable from ProductTour registry L120, not from the page's own help panel
### /admin/channels/whatsapp
- HelpPanel help.channelsWhatsapp (199w, 4 tips)
- tourId=first_channel_whatsapp (6 steps, 139w)
- notes: Tips and tour disagree on route naming: tips say 'Nuevo número / Coexistencia / Migración', tour says 'Ya usas la app... / número nuevo / otro proveedor'

## Findings
### H7-01 [high/help-drift/day0/XS] Editor help tip 6 ('Arriba, prepara las asignaciones…') points the wrong way and was added after the wizard shipped
- `apps/dashboard/messages/es.json:9271` — 6. Arriba, prepara las asignaciones de canal y el estado que quieres publicar. Guarda el borrador, pruébalo, prepara la revisión, apruébala y publícala
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:700-790` — <HelpPanel …agentEditor… /> (L700) … {/* Agent profile hero + channels */} (L704) … id={guidedTourAnchorId("agent-channels")} (L783)
- `git blame:6f02b278 2026-09-13` — docs(onboarding): separate connection from agent publication
- **Impact:** At 19:44 Nataly reads 'Arriba' and scrolls up and down without finding it; the panel sits above the assignment block, so 'arriba' is false from where she reads. The transcript's explanation ('otra pestaña oculta bajo un hero colapsado') is contradicted by code: same page, no tab, hero has no collapse state. One tip packs 5 verbs (guarda, prueba, prepara, aprueba, publica) that map to 3 different screens.
- **Fix:** Delete tip 6 on day 0; if kept for later config, say 'Abajo, en Canales que atiende' and make the tour (agent_handoff_rules) the only path for the multi-screen publish flow.
### H7-02 [high/outdated/day0/XS] Editor tip 1 names a 'pestaña Identidad' that does not exist — the word that sent the user to CRM dedup
- `apps/dashboard/messages/es.json:help.agentEditor.tips[0]` — 1. En la pestaña Identidad, pon el nombre y el rol del agente
- `apps/dashboard/messages/es.json:agent.tabs.*` — agent.tabs.persona = Persona | instructions = Instrucciones | tools = Herramientas | schedule = Horario
- `apps/dashboard/messages/es.json:nav.items.identity` — 'Identidad' → nav.items.identity (CRM /admin/identity)
- **Impact:** The help teaches a label the UI never shows; the global search for that label resolves to the CRM contact-dedup page (verified fact in brief). Help vocabulary and navigation vocabulary are different dictionaries.
- **Fix:** Tips must quote tab labels from the same i18n keys (agent.tabs.persona) instead of free text; add a spec that every quoted 'pestaña X' / 'botón X' exists as a value in es.json.
### H7-03 [high/help-drift/cross/S] The only test on help copy enforces the publish jargon in day-0 help instead of catching UI drift
- `apps/dashboard/src/lib/i18n-parity.spec.ts:124-140` — source.help.agentEditor.tips.join(" "), source.help.setupWizard.description … expect(copy).toMatch(publicationWord[locale])
- `apps/dashboard/messages/es.json:help.setupWizard.description` — Son tres pasos para preparar el borrador y conectar WhatsApp. Al terminar, revisa la asignación, prueba el borrador y publica la versión aprobada
- **Impact:** Any attempt to simplify the first-screen help to 'confirm name and greeting' would fail CI. The test guarantees the novice reads borrador/asignación/publicar before typing anything. No test compares tips with tab names, button labels or routes.
- **Fix:** Invert the assertion: day-0 panels (setupWizard, dashboard) must NOT contain borrador/candidato/publicar; move the publication guard to the later-config panels only. Add a label-existence spec (see H7-02).
### H7-04 [medium/outdated/health_panel/XS] Home help sends a tenant admin to a super_admin-only route and uses stale KPI names
- `apps/dashboard/messages/es.json:help.dashboard.tips[1]` — El dato "Costo IA Hoy" … ajusta el modelo desde Configuración → IA
- `apps/dashboard/src/lib/navigation-contract.ts:231` — pattern: "/admin/settings/ai-config" … scope: "platform"
- `apps/dashboard/messages/es.json:dashboard.llmCostToday` — Costo LLM Hoy
- **Impact:** On the screen where she said 'tendría que trabajar en todos estos…', the help adds a task she cannot do (no such menu for her) and names tiles that don't match. Erodes trust in every other tip.
- **Fix:** Drop tips 1-3 (KPI explanations) while the setup card is visible; on a 0-KPI home the only useful help is 'conecta WhatsApp'.
### H7-05 [medium/outdated/later_config/XS] Agent list help quotes a red banner and a 'Principal' star that the UI labels differently
- `apps/dashboard/messages/es.json:help.agent.tips[2..3]` — banner rojo de 'Canales sin agente' … marcar un agente como 'Principal'
- `apps/dashboard/messages/es.json:agent.unassignedChannels / agent.setAsDefault` — {count} canal(es) sin agente asignado / Establecer como predeterminado
- **Impact:** Same dictionary mismatch as H7-02: the reader hunts for words that are not on screen.
- **Fix:** Same fix as H7-02 (quote i18n values, spec that they exist).
### H7-06 [medium/jargon/cross/S] Assist mascot namespace ships 1,587 words of dead engineering copy
- `apps/dashboard/messages/es.json:helpAssistant.knowledge.sub1Desc / apiKeys / smtp / automation` — Calibración de Coseno … Establece la Similitud Coseno en `0.75` … Base de Conocimiento RAG++ … Sincronización con HubSpot … v=spf1 include:mailgun.org
- `apps/dashboard/src/components/HelpAssistant.tsx:whole file (grep)` — only announce.*, chat.*, drawerTitle, drawerSubtitle, footer.*, launcherTooltip consumed; 0 references to sub1/apiKeys/smtp/faqTitle/industryTitle
- **Impact:** Today invisible (dead keys), but it is ×4 locales of maintenance debt and a trap: any 'restore guides' change would surface cosine thresholds to a dance-academy owner. The mascot's live copy ('Guía & Soporte — Tu asistente interactivo paso a paso') competes with the wizard for the role of guide on the first screen.
- **Fix:** Delete unused helpAssistant.* keys in the 4 JSONs; suppress announce bubble while onboardingStage is inside the wizard.
### H7-07 [medium/help-drift/later_config/S] KB still documents SMS credits as a product and 'Probar agente' article predates drafts
- `apps/api/kb/assistant/es/13-sms-creditos.md:1-12` — title: "Créditos SMS y notificaciones por SMS" … no mention of apagado/desactivado
- `apps/api/kb/assistant/es/01-primeros-pasos.md:110-111` — **¿Y el canal SMS?** SMS no es un canal de conversación: sirve para enviar notificaciones a tus clientes mediante créditos
- `apps/api/kb/assistant/es/07-probar-agente.md:git log -1: 52038d17 2026-08-11` — last edit 2026-08-11, before d50d1670 (Sep 7 drafts); 1 'borrador' mention while 06-agentes-ia.md L119 promises 'chatear con la versión operativa o con el borrador guardado'
- `apps/api/kb/assistant/es/26-centro-calidad-agente.md:git log -1: 4f2390e4 2026-09-04` — 0 occurrences of 'borrador'; predates drafts and a7337a10 readiness alignment
- **Impact:** Assist answers with the KB; an owner asking 'cómo pruebo el borrador' gets an article that doesn't know drafts exist, and one asking about SMS is sold a switched-off feature (owner decision: SMS apagado). The KB contract spec (assistant-kb-contract.spec.ts) checks routes/roles/retired labels but not feature switches or draft vocabulary.
- **Fix:** Mark 13-sms-creditos as retired (or gate by feature flag in the KB loader); re-edit 07 and 26 for the draft/candidate flow; add a contract rule: articles referencing a feature flag must state its default state.
### H7-08 [medium/affordance/day0/XS] Home and wizard help panels are the two day-0 panels WITHOUT a 'Mostrarme cómo' tour, while 16 later screens have one
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:503-507` — <HelpPanel title={tHelp("setupWizard.title")} … tips=… /> (no tourId)
- `apps/dashboard/src/app/admin/page.tsx:536-541` — <HelpPanel title={tHelp("dashboard.title")} … mediaKey="dashboard" /> (no tourId)
- `apps/dashboard/src/components/tour/ProductTour.tsx:120-122` — home_first_steps: null, … resume_setup_wizard: "canEditAgent"
- **Impact:** The best-written help in the system (home_first_steps: 'Este es el paso que más cambia las cosas. Conectar WhatsApp toma unos 5 minutos') is unreachable from the home help panel; instead she gets 154 words of KPI tips.
- **Fix:** Pass tourId="home_first_steps" on /admin and tourId="resume_setup_wizard" on the wizard; make the tour button the panel's first element.
### H7-09 [low/clutter/day0/M] Two tour engines coexist: legacy onborda ProductTour auto-starts from localStorage next to the 17 guided tours
- `apps/dashboard/src/components/tour/ProductTour.tsx:297-312, 506-507` — const steps: any[] = [ { icon: "🤖", title: t("agent.title") … }, { icon: "🔌", … } ]; … if (localStorage.getItem(TOUR_PENDING_KEY) !== "true") return;
- `apps/dashboard/messages/es.json:helpAssistant.footer.restartTour` — footer.restartTour consumed by HelpAssistant.tsx
- **Impact:** A sidebar-pointing product tour can fire on top of the wizard's own guidance; the mascot footer offers to restart it. Three narrators (wizard, product tour, mascot) on one screen is the '3 banners' collapse of 00:35 repeated at the help layer.
- **Fix:** Retire the onborda product tour; keep guided tours as the single engine and gate them by onboardingStage.
### H7-10 [low/help-drift/cross/XS] Help media: 103 pages pass mediaKey, zero assets exist (guarded, no 404s) — the README promises GIFs that never landed
- `apps/dashboard/src/components/ui/help-panel.tsx:18-28` — const HELP_MEDIA_KEYS: ReadonlySet<string> = new Set<string>([]); … the folder only holds a README
- `apps/dashboard/public/help/README.md:1-30` — Animated GIFs / annotated screenshots shown inside each page's help panel … a missing asset hides itself silently
- **Impact:** No harm (no broken images), but no visual help exists anywhere; every page carries dead wiring.
- **Fix:** Remove mediaKey props or keep the allow-list; do not add GIFs for day-0 screens — the tour is the visual.

## What works
- guided-tours.spec.ts L147 fails when a tour anchor is no longer rendered by any screen [V] — the tours cannot silently drift; all 60+ anchors present in code
- Guided tour copy is short and human (home_first_steps 78w/4 steps; resume_setup_wizard 47w/3 steps; first_channel_whatsapp 139w/6 steps; 'Cuando los completes, esta tarjeta desaparece sola') [V]
- HelpPanel is collapsed by default on every page (no defaultOpen=true anywhere) and hides unresolved media instead of 404ing [V]
- KB README + assistant-kb-contract.spec enforce canonical routes, role denial, retired menu labels and 'no prices' [V]; 01/02/06 were re-edited Sep 13-15 with the current 3-step wizard and 'Conectar después' semantics [V]
- help.agentQuality copy is honest and short (131w): 'No es un puntaje: los bloqueos críticos mandan' [V]

## Regressions vs Sept plan
- **PARTIAL** HelpPanel offers 'Mostrarme cómo' (tourId) on every onboarding screen — 16 pages wired; /admin and /admin/setup-wizard HelpPanels have no tourId [V page.tsx L536, setup-wizard L503]
- **BROKEN** Help content 'just enough' on the wizard first screen — help.setupWizard.description now speaks of borrador/asignación/publicar and a spec (i18n-parity L124-140) requires the word 'publicar' [V]; tip 6 of agentEditor added Sep 13 by 6f02b278 after the plan
- **NEVER_DONE** Single help vocabulary aligned with UI labels — tips quote 'pestaña Identidad', 'Principal', 'Canales sin agente', 'Costo IA Hoy', 'Configuración → IA' — none exist as UI values [V es.json]
- **PARTIAL** KB reflects current flow (drafts, SMS off) — 07-probar-agente last edited Aug 11, 26-centro-calidad Sep 4, 13-sms-creditos still live [V git log]

## Open questions
- Is the legacy onborda ProductTour still meant to auto-start for new tenants (TOUR_PENDING_KEY), or should the 17 guided tours be the only engine? [inferred: both fire]
- Who owns the help.* tips (113 pages/504 tips)? No author/date metadata per page makes 'current' unverifiable; consider a lastReviewed field or generating tips from tour step copy.
- Should the KB loader skip articles whose feature flag is off (SMS) rather than relying on editors to retire them?