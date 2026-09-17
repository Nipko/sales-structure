# Lens 2 — /admin/setup-wizard ("Conoce a tu agente") and the draft/assessment/release layers stacked on it after the Sept plan

## Summary
The 3-step wizard shipped on Sep 4 still exists structurally (page with Esc, autosave on blur, test chat beside, "Conectar después" → channel_deferred, re-entry from Configuración), but two commits of Sep 7 (d50d1670, 751d23e7) mounted two always-on panels ABOVE the stepper — AgentDraftStatus ("Versión operativa y borrador") and AgentAssessmentPanel ("Misión y preparación del agente", with the Mission editor, "Siguiente paso", "Guiarme con Parallly Assist", "Revisar dependencias y pruebas") — and cb9088cb (Sep 13) rewrote the wizard copy around "borrador / versión revisada / publicar". Net effect for a novice: ~186 words, a violet "version" panel and a red-ish "Pendiente: el agente todavía no está listo" verdict before the first input, on an account created 60 seconds earlier. Technically, every edit in the wizard now goes to a DRAFT revision (api.saveAgentDraft) that never touches the operative agent; the wizard cannot publish it. Publishing requires a 5-step tour: save → test → "Iniciar evaluación" (LLM evaluation per channel×language, 3 runs each, consumes test budget) → human review with 6 checkboxes and every sample hash "seen" → Publicaciones. Meanwhile the operative template agent (v5, "Atendiendo", generic name "Asistente") is what actually answers as soon as a channel is bound, so the wizard's own copy ("empieza a responder después de publicar una versión aprobada", "publicarás la versión revisada al final") is false for day 0 and steers the owner away from the one thing that matters: connecting WhatsApp. The Mission task is 'pending' for every template-derived agent, so the assessment can never say anything but "not ready" on day 0 unless the owner fills three free-text boxes about objectives, success criteria and handoff conditions — a later-config/health surface leaked into day 0. Verdict vs Sept plan §12.1: DONE on structure, BROKEN on "one guide at a time", "AHA on the wizard screen", and "no auto tour".

## Journey
### /admin/setup-wizard step 1 — Tu agente
- Trial banner (admin layout, not wizard)
- Header: 'Conoce a tu agente' + 'Tres pasos para preparar y probar; publicarás la versión revisada al final' + Salir [page.tsx:483-499]
- AgentDraftStatus (violet): 'Versión operativa y borrador / Versión operativa N · Atendiendo / Todavía no hay un borrador / Guardar prepara una revisión…' + 'Probar este borrador' + Descartar (admins) [AgentDraftStatus.tsx:31-40; mounted page.tsx:501]
- AgentAssessmentPanel (violet): 'Misión y preparación del agente' + OperationalStateSummary ('Pendiente: El agente todavía no está listo…') + 'Esta evaluación describe la versión operativa…' + mission objective text + 'Propuesta derivada de la plantilla…' + 'Completa la puesta en marcha paso a paso con Parallly Assist…' + button 'Definir misión y resultados' + 'Siguiente paso: Acordar la misión del agente' + 'Guiarme con Parallly Assist' + <details> 'Revisar dependencias y pruebas' [AgentAssessmentPanel.tsx:63-77; mounted page.tsx:502]
- HelpPanel collapsed toggle '¿Cómo funciona este asistente?' (defaultOpen=false) [page.tsx:503-507; help-panel.tsx:86-88]
- Error alert (only on failed save) [page.tsx:510]
- Stepper 1 Tu agente / 2 Conecta WhatsApp / 3 Listo + 'Paso 1 de 3' [page.tsx:521-547]
- Card: 'Tu agente' + 'Preparamos a {name} con lo que nos contaste…' [page.tsx:553-558]
- Input 'Nombre del agente' + hint 'Es un nombre sugerido…' (FIRST INPUT) [page.tsx:563-574]
- Textarea 'Mensaje de bienvenida' [page.tsx:577-588]
- Autosave status line 'El borrador se guarda cuando sales del campo; la versión operativa no cambia.' [page.tsx:590-596]
- Link 'Cambiar plantilla' → /admin/agent [page.tsx:600-605]
- Right column 'Pruébalo' + AgentTestChat (tests draft if one exists, else operational; blocked while unsaved) [page.tsx:608-614]
- Footer nav Anterior / Siguiente [page.tsx:760-780]
- PWA 'Instalar Parallly' prompt + Assist mascot (global)
- required: none enforced client-side; server draft validation may reject (tDraft.saveFailed)
- words before first input: 186
- notes: 186 counted from es.json strings (header + draft panel + assessment panel + help toggle + stepper + card intro), excluding trial banner, OperationalStateSummary legend text and PWA popup — real count is higher.
### step 2 — Conecta WhatsApp
- Same three panels above the stepper (AgentDraftStatus, AgentAssessmentPanel, HelpPanel) persist
- 'Conecta WhatsApp' + 'Conecta el canal que recibirá mensajes. El agente empieza a responder después de asignar y publicar una versión aprobada.' [es.json setupWizard.connectStep.subtitle]
- If already connected: green 'Conectado' + Continuar + 'Otros canales' [page.tsx:633-660]
- Else WhatsAppConnectPanel (routes coexistence/new/migration) [page.tsx:665-672]
- 'Otros canales' SecondaryChannels [page.tsx:675-681]
- '¿No es buen momento?' + 'Conectar después' (stage channel_deferred + channelConnectSkippedAt) + 'Mostrarme dónde' (fires first_channel_whatsapp tour) [page.tsx:683-696, 430-438, 465-468]
- Esc disabled on this step unless WhatsApp already connected [page.tsx:423]
- notes: Copy contradicts runtime: operative template agent (is_active) answers as soon as bound; no publication needed [inferred from persona.service reading agent_personas; no release refs].
### step 3 — Listo
- Same three panels above
- 'Configuración inicial guardada' + 'Revisa y publica el borrador para convertirlo en la versión que atenderá a tus clientes.' (or deferred variant) [page.tsx:709-712]
- 3 essentials: Conectar WhatsApp / Cargar lo que tu agente debe saber / Invitar a una persona [page.tsx:718-724; es.json doneStep.essentials]
- 'Ir al panel' (finish: stage completed → /admin) [page.tsx:731-735]
- 'Revisar y publicar mi agente' (finish + fires publish_agent_revision 5-step tour; if no agentId writes PRODUCT_TOUR_PENDING_KEY) [page.tsx:440-463]
- notes: The wizard ends with a draft nobody has published and the operative agent still named 'Asistente'.

## Findings
### W2-01 [critical/clutter/cross/S] Two version/assessment panels sit above the stepper on every wizard step (day-0 buried under health/config layers)
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:501-507` [V] — {workspace && <AgentDraftStatus workspace={workspace} tenantId={tenantId} />}
<AgentAssessmentPanel />
<HelpPanel …
- `apps/dashboard/src/components/quality/AgentDraftStatus.tsx:31-35` [V] — {t('title')} … {t('operationalVersion',…)} · {t(… 'operationalActive' …)} … {t(workspace.draft ? 'draftPrepared' : 'noDraft')} … {t('saveHint')}
- `apps/dashboard/src/components/quality/AgentAssessmentPanel.tsx:63-77` [V] — <AgentOperationalStateSummary state={assessment.state}/> … {t('setupGuidance')} <AgentMissionEditor …/> … {t('next')}: … {t('askAssist')} … <details><summary>{t('details')}</summary>
- **Impact:** Nataly reads ~186 words, a version number, 'borrador', 'revisión', 'publicar' and a verdict 'El agente todavía no está listo' before she can type the agent's name. Nothing tells her which of the 4 buttons is the path; the stepper (the actual path) is the 7th block.
- **Video:** 00:15 first wizard screen
- **Fix:** Unmount AgentDraftStatus and AgentAssessmentPanel from setup-wizard (they belong to /admin/agent/[id] and the health panel). Keep at most a one-line saved indicator. Introduced by d50d1670 and 751d23e7 (git log -S).
### W2-02 [high/health/health_panel/M] Every template-derived agent is reported 'Pendiente / no está listo' because the Mission task is pending until the owner writes objective, success criteria and handoff conditions
- `apps/api/src/modules/copilot/agent-assessment.service.ts:241-245` [V] — key: 'mission', status: … configured ? 'pass' : 'warning' … configured ? undefined : 'pending'
- `apps/api/src/modules/copilot/agent-assessment.service.ts:376-382` [V] — state: rollUpOperationalState([ operationalStateFromQuality(overview.status), ...tasks.map(task => task.state), …
- `apps/dashboard/src/components/quality/AgentMissionEditor.tsx:58-64` [V] — <textarea required maxLength={2000} … objective … <textarea required … criteria … <textarea required … handoff
- `apps/dashboard/messages/es.json:agentOperationalState.agent.pending` [V] — El agente todavía no está listo para atender: queda configuración por hacer.
- **Impact:** A working, active, bootstrapped agent is labeled not ready on day 0; the only way to clear it is a three-textarea essay ('Cómo reconocer un buen resultado', 'Cuándo debe derivar a una persona') that then produces a 'propuesta' to 'revisar' and 'aplicar' into a draft — never into the live agent. The novice cannot get a small win here.
- **Video:** 00:15 'Pendiente: El agente todavía no está listo'
- **Fix:** Treat template mission as satisfied (status pass, source template_derived) for readiness; make mission editing an optional later-config improvement. Do not roll mission into the agent's day-0 state.
### W2-03 [critical/flow/day0/M] Wizard edits go to a draft nobody publishes; the wizard cannot end with the renamed agent live
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:328-339` [V] — const result = await api.saveAgentDraft(tenantId, current.agentId, saveAttempt.current.request); … return advanceStage(options);
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:440-463` [V] — finish … detail: { tourId: "publish_agent_revision", agentId … } … window.location.href = "/admin";
- `apps/dashboard/src/lib/guided-tours.ts:173-179` [V] — publish_agent_revision: … "agent-save" … "agent-test-configuration" … "agent-release-prepare" … "agent-release-review" … "agent-publication-publish"
- `apps/dashboard/src/lib/agent-release-review.ts:4-6, 46-63` [V] — RELEASE_REVIEW_CHECKS = ['objective','instructions','facts','tools','style','limits'] … canReviewRelease … seen … === sampleHashes
- `apps/api/src/modules/simulation/agent-release-contract.ts:55-65` [V] — expectedSamples=(candidate.channels?.length||0)*(…languages?.length||0) … eligibleForReview: complete && readiness.eligibleForReview && samples.length===expectedSamples && expectedSamples>0
- `apps/dashboard/messages/es.json:agentReleases.prepareHelp` [V] — Cada caso se prueba tres veces y todas deben pasar. La evaluación consume el presupuesto de pruebas de la cuenta.
- **Impact:** She renames 'Asistente' and edits the greeting; the live agent keeps 'Asistente' until she completes a 5-stop release pipeline (LLM evaluation per channel×language, 6 review checkboxes, viewing every sample, then Publicaciones). No day-0 user will do this; the wizard's 'Listo' is a dead end.
- **Video:** agent stayed 'Asistente' through the whole 48 min
- **Fix:** On day 0 (no prior publication / operational version untouched by the owner) let the wizard write name+greeting directly to the operational agent (the pre-d50d1670 applySetupTemplate customizations path still exists at page.tsx:343-357 and persona.controller.ts:415-500), or auto-publish a draft that only changes persona.name/greeting. Reserve the release pipeline for later config.
### W2-04 [high/copy/day0/S] Wizard copy says the agent only answers after 'publicar una versión aprobada'; runtime answers with the operative template agent as soon as a channel is bound
- `apps/dashboard/messages/es.json:setupWizard.connectStep.subtitle / pageSubtitle / doneStep.subtitle` [V] — El agente empieza a responder después de asignar y publicar una versión aprobada. | Tres pasos para preparar y probar; publicarás la versión revisada al final. | Revisa y publica el borrador para convertirlo en la versión que atenderá a tus clientes.
- `apps/dashboard/src/components/quality/AgentDraftStatus.tsx:33` [V] — {t('operationalVersion', { version })} · {t(workspace.operational.body.isActive ? 'operationalActive' : 'operationalInactive')}  → 'Versión operativa 5 · Atendiendo'
- `apps/api/src/modules/persona/persona.service.ts:grep candidate/agent_release → only template-resolution matches (3090-3094)` [V] — runtime persona resolution reads agent_personas; no release/candidate gating
- **Impact:** Contradiction on the same screen ('Atendiendo' vs 'no está listo' vs 'empieza a responder después de publicar'). She concludes there is a mandatory publish step before WhatsApp matters, which deprioritizes the one action that would have produced a first answer.
- **Video:** 00:15 / step 2 header
- **Fix:** Rewrite three keys (cb9088cb introduced them) to: 'Tu agente ya responde con esta configuración en cuanto conectes WhatsApp'. Mention drafts/publishing only when a draft exists.
### W2-05 [high/flow/later_config/S] 'Definir misión y resultados' / 'Siguiente paso: Acordar la misión' is the first CTA a novice sees and leads to a proposal→review→apply-to-draft loop
- `apps/dashboard/src/components/quality/AgentMissionEditor.tsx:41-51, 58-64` [V] — api.proposeAgentConfiguration(… changes: [{ path: 'mission', value: mission }] …) … <textarea required … objective / criteria / handoff
- `apps/dashboard/src/components/quality/AgentConfigurationReview.tsx:77-93` [V] — api.applyAgentConfiguration(activeTenantId, proposal.id, proposal.digest) … result.draft?.workspace.evaluationRevisionId && <a href=… /test?configurationRevisionId=
- `apps/dashboard/messages/es.json:agentConfiguration.proposalError` [V] — Completa el objetivo, al menos una tarea, resultados y condiciones de derivación.
- **Impact:** Nothing on day 0 requires a mission (runtime uses the template's role/scope, assessment.service.ts:213-219); ignoring it costs nothing except a permanent 'Pendiente'. But the panel presents it as 'Siguiente paso' with a violet primary button, so the novice believes it is step 0 of the wizard.
- **Video:** 00:15 buttons 'Definir misión y resultados' / 'Siguiente paso: Acordar la misión del agente'
- **Fix:** Remove mission from the wizard and from day-0 readiness; surface it in the agent editor as 'Afinar la misión (opcional)' once conversations exist.
### W2-06 [medium/jargon/health_panel/S] 'Guiarme con Parallly Assist' and 'Revisar dependencias y pruebas' expose health-panel internals (six-state legend, tools, required tests) inside the wizard
- `apps/dashboard/src/components/quality/AgentAssessmentPanel.tsx:70-75` [V] — openQualityAssistant({ … prompt: t('assistPrompt', { task: … }) }) — 'Ayúdame con este paso… guíame sin aplicar ni publicar cambios automáticamente.'
- `apps/dashboard/src/components/quality/AgentAssessmentPanel.tsx:77-127` [V] — <details> … tasksTitle … channelsTitle … testsTitle … 'Se revisan {count} escenarios de misión' … toolsTitle … <OperationalStateLegend …>
- **Impact:** 'Dependencias', 'escenarios de misión', 'herramientas publicadas', 'evidencia' are developer vocabulary. Assist opens a chat that by design will not do anything ('sin aplicar ni publicar'), so the 'guide me' button yields more text, not progress.
- **Video:** 00:15
- **Fix:** Keep this <details> in /admin/agent/[id] and the health panel only.
### W2-07 [low/flow/day0/XS] Finishing with the tour CTA can still arm the automatic product tour (plan said never write PRODUCT_TOUR_PENDING_KEY)
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:452-460` [V] — if (options.openTour && workspaceRef.current?.agentId) { … publish_agent_revision … } else if (options.openTour) localStorage.setItem(PRODUCT_TOUR_PENDING_KEY, "true");
- `apps/dashboard/src/components/tour/ProductTour.tsx:492-510` [V] — if (localStorage.getItem(TOUR_PENDING_KEY) !== "true") return; … startOnborda("main");
- `docs/assist-quality-guided-tours-plan-2026-09.md:694` [V] — no escribir `PRODUCT_TOUR_PENDING_KEY`
- **Impact:** Only when the workspace failed to load; otherwise the CTA fires the 5-step publish tour, which is a worse landing for a novice than the old product tour.
- **Video:** n/a
- **Fix:** Replace 'Revisar y publicar mi agente' with 'Ir a Inicio' and make the Home card the single next-step source.
### W2-08 [medium/state/day0/S] Test chat tests the DRAFT once a draft exists, while the assessment above describes the OPERATIVE version — two truths on one screen
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:613-614` [V] — <AgentTestChat … configurationRevisionId={workspace?.evaluationRevisionId ?? undefined} blocked={!workspace || Boolean(workspace.draft && !workspace.draft.currentBase) || hasUnsavedEdits || saving} />
- `apps/dashboard/messages/es.json:agentDraft.assessmentOperational / testingDraft` [V] — Esta evaluación describe la versión operativa. Prueba el borrador para evaluar sus cambios. | Estás probando el borrador guardado. Esta prueba no lo publica.
- **Impact:** After typing a name, the chat is blocked until blur-save, then says 'Estás probando el borrador… no lo publica' while the panel above says the operative version is 'Atendiendo'. She cannot tell which agent her customers will get.
- **Video:** 00:15 right column 'Pruébalo'
- **Fix:** On day 0 there should be exactly one version; see W2-03.
### W2-09 [low/state/day0/XS] Esc and 'Salir' write onboardingStage agent_reviewed even if nothing was reviewed; Home only redirects back while stage is account_created
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:399-409` [V] — exit … else { await advanceStage({ stage: "agent_reviewed" }); } router.push("/admin");
- `packages/shared/src/onboarding-stage-contract.ts:185, 200-202` [V] — redirect = isAdmin && stage === 'account_created' ? '/admin/setup-wizard' : null … showResumeBanner: isAdmin && (stage === 'channel_deferred' || setupWizardSkipped)
- **Impact:** Leaving on step 1 to look around marks the agent as reviewed; the resume banner appears only if she explicitly pressed 'Conectar después'. Re-entry exists but is hidden under Configuración → 'Asistente de configuración' (_settings-config.ts:100).
- **Video:** n/a
- **Fix:** Write agent_reviewed only from step≥1 or after a save; show the resume banner whenever stage < completed and no channel.

## What works
- Page (not modal) with a visible 'Salir' and Esc that never destroys data; stageOnly path leaves the agent untouched [page.tsx:310-325, 411-428; persona.controller.ts:238-249]
- Autosave on blur with visible 'Guardando / Borrador guardado' status and a shown error on failure [page.tsx:371-385, 509-518]
- 'Conectar después' persists channel_deferred + channelConnectSkippedAt and Home shows a resume banner [page.tsx:430-438; onboarding-stage-contract.ts:200]
- Step 2 keeps Esc disabled mid-connection to avoid a half-finished Meta signup [page.tsx:423]
- 'Mostrarme dónde' on step 2 fires the first_channel_whatsapp tour with concrete prerequisites [guided-tours es.json]
- Re-entry from Configuración exists [_settings-config.ts:100]; HelpPanel is collapsed by default [help-panel.tsx:88]
- Step 3 essentials are three plain-language items (canal, conocimiento, persona)

## Regressions vs Sept plan
- **DONE** 3 steps (Tu agente / Conectá WhatsApp / Listo) — page.tsx:53-57 STEPS; stepper at 521-547
- **DONE** Page with Esc, reopenable from Configuración — page.tsx:411-428; _settings-config.ts:100
- **PARTIAL** Derived agent with autosave + test chat beside (AHA on this screen) — Autosave and chat exist (page.tsx:566-614) but the chat is blocked until blur-save and tests a draft that will not go live; AHA cannot happen because the live agent is not what she edited (d50d1670, cb9088cb)
- **PARTIAL** No automatic tour; tour offered, not fired — page.tsx:452-460 still writes PRODUCT_TOUR_PENDING_KEY in the fallback branch; 'Revisar y publicar mi agente' fires publish_agent_revision tour (cb9088cb)
- **BROKEN** One guide at a time / no red quality warning on a fresh account — AgentAssessmentPanel (751d23e7) + AgentDraftStatus (d50d1670) mounted above the stepper on every step; assessment reports 'Pendiente: no está listo' on every template agent (agent-assessment.service.ts:241-245)
- **DONE** 'Cambiar plantilla' secondary link — page.tsx:600-605
- **DONE** 'Conectar después' persists channelConnectSkippedAt + channel_deferred — page.tsx:430-438; persona.controller.ts:238-249

## Open questions
- Does a fresh tenant's bootstrapped agent carry channels/channel_bindings pre-filled (evaluation-revision.service.ts:41-45)? If not, 'Iniciar evaluación' throws agent_release_channels_required and a 'Conectar después' tenant can never publish the wizard draft at all.
- Does the LLM test budget for a trial plan allow the 3-runs-per-case release evaluation (agentReleases.budget copy suggests it can stall)?
- Was there an owner decision to route wizard edits through drafts (d50d1670), or was it collateral from the editor refactor?