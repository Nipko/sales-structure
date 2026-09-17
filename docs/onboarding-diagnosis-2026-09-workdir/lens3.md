# Lens 3 — Agent editor (/admin/agent/[agentId])

## Summary
The editor is a competent LATER-configuration surface wearing a day-0 costume. For a fresh vertical agent the novice meets five guidance blocks before the first field (global QualityAttentionBanner, AgentDraftStatus, AgentAssessmentPanel, HelpPanel, AgentReadinessBanner) plus four expert workspace links in the header (Evaluar/Publicar/Aprender/Fallos), each speaking a different vocabulary (borrador, versión operativa, candidato, bloqueo crítico, dependencias, misión). The good news, contradicting the video impression: validation DOES name the field and DOES switch tab + scroll + ring-highlight the first invalid one (page.tsx:396-418, 374-384) — but the toast that announces the failure is rendered GREEN with a check icon because the color test only looks for the substring "Error" (page.tsx:1041), so the person reads "Faltan datos obligatorios" as a success. Channel chips are bare toggles with no confirmation and no diff on save (page.tsx:315-323, 852/869); an accidental tap silently unassigns WhatsApp in the draft, exactly what happened at 21:36. The vertical patch never fills behavior.mainInstructions (verticals.service.ts:1921-1968), so the "Instrucciones principales" canvas is empty while the wizard claims "Preparamos a Asistente…"; and because orFallback keeps the existing name, the agent stays "Asistente". Tool cards (Catálogo, FAQs, Políticas, Promociones, CRM) are pure on/off with no link to where the data is loaded — "¿es solo prender y apagar?" is the correct reading of the code. Activating the agent from the editor is impossible: the switch only toasts "La reactivación requiere revisar y publicar una versión". The health-panel pieces exist (readiness banner names blockers with ?tab=&focus= deep links) but they are stacked on top of day-0 instead of living in one place.

## Journey
### /admin/agent/[agentId] first paint (fresh vertical agent, tenant_admin)
- QualityAttentionBanner (layout, red: 'Hay una acción crítica…')
- AgentDraftStatus (violet: Versión operativa N · Atendiendo / Todavía no hay un borrador / saveHint)
- AgentAssessmentPanel (Misión y preparación del agente · template_derived · Siguiente paso · Guiarme con Parallly Assist · Revisar dependencias y pruebas)
- PageHeader with 7 actions + kebab
- HelpPanel collapsed (¿Cómo configuro mi agente?)
- AgentReadinessBanner (status + 'Falta configurar' up to 3 named blockers + Ver calidad)
- Hero: avatar, name/role, Estado switch, Asignación de canales chips, draftScope note
- TabNav Persona / Instrucciones / Herramientas / Horario
- Sticky bar: Probar agente · error label · Guardar borrador
- Toast bottom-right
- required: persona.name, persona.role, persona.fallbackMessage, behavior.rules[≥1], behavior.handoffTriggers[≥1]
- words before first input: 250
- notes: words_before_first_input is an estimate [inferred] from the strings verified above; Persona tab fields: Nombre, Rol, Mensaje de bienvenida, Mensaje cuando no puede responder, Idioma/Industria (read-only, businessProfileManaged), tone cards, length cards, Personalización avanzada (humor…). Instrucciones tab: Instrucciones principales (empty textarea, 60-word placeholder), Protecciones de seguridad (always on), Reglas estrictas*, Temas prohibidos, Cuándo pasar a un humano*, Avanzado (required fields by context). Herramientas: Habilidades (Ventas/Soporte/Ambos), upsell, specialized tools, Citas, universal tools (Catálogo, FAQs, Políticas, Promociones, Órdenes, CRM), e-commerce, Documentos + Avanzado. Horario: ScheduleCard.

## Findings
### AE-01 [high/bug/cross/XS] Validation toast 'Faltan datos obligatorios' renders green with a check icon
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:1038-1044` [V] — toast.includes("Error") || toast.includes("error") ? "bg-red-500" : "bg-emerald-500" … <CheckCircle size={16} />
- `apps/dashboard/messages/es.json:4705` [V] — "blocked": "Faltan datos obligatorios para guardar. Revisa los campos marcados en rojo."
- **Impact:** The failure looks like a success (green, check mark). The person believes it saved, then hunts for 'campos en rojo' that the toast itself contradicts. Same for activationReview, editorChanged and channelOverviewUnavailableHint toasts.
- **Video:** ~22:00 'Faltan datos obligatorios para guardar'
- **Fix:** setToast({message, type}) like agent/page.tsx:193 already does; red + AlertTriangle for validation.blocked.
### AE-02 [critical/affordance/cross/S] Channel chips are bare toggles: one tap unassigns WhatsApp with no confirmation, no diff, no undo
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:315-323` [V] — function toggleChannel(channel) { setAssignedChannels(prev => prev.includes(channel) ? prev.filter(...) : [...prev, channel]); }
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:869-878` [V] — <button … aria-pressed={isAssigned} onClick={() => toggleChannel(ch)} className={chipCls(isAssigned)}> … {isAssigned && <CheckCircle/>}
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:39-55` [V] — Only types that actually have a CONNECTED account are rendered … `sms` is deliberately absent
- **Impact:** The chip looks like a label/badge, not a switch. Unassigning changes only a border color; the draft-scope note (assignmentReview.draftScope) says the operational version is untouched, so the person cannot tell whether WhatsApp is still attended. Only unconnected types are hidden (good); SMS never shown (good); but a stale assignment stays clickable.
- **Video:** 21:36 accidental unassign
- **Fix:** Render as labelled switch ('Atiende WhatsApp · Sí/No'), confirm on unassign of the only channel, and show a 'Cambios sin guardar: WhatsApp quitado' chip in the sticky bar.
### AE-03 [high/clutter/cross/M] Five guidance blocks + global critical banner render before the first field of a fresh agent
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:623-624, 700-708` [V] — <AgentDraftStatus …/> <AgentAssessmentPanel agentId={agentId} /> … <HelpPanel … tourId="agent_handoff_rules" /> … <AgentReadinessBanner …/>
- `apps/dashboard/src/app/admin/layout.tsx:210` [V] — <QualityAttentionBanner />
- `apps/dashboard/messages/es.json:qualityHealth.bannerCritical` [V] — Hay una acción crítica que requiere atención.
- **Impact:** Draft status ('Versión operativa 5 · Atendiendo / Todavía no hay un borrador'), mission panel ('Propuesta derivada de la plantilla'), readiness banner ('Configuración incompleta / N bloqueos críticos') and the red global banner all describe the SAME unfinished state in four vocabularies. None of them is the field to fill. 'faltan 4 dependencias' is not an es.json string, so that copy comes from the API or another component [inferred].
- **Video:** ~19:00 editor first paint
- **Fix:** For onboardingStage < live: render one block ('Te faltan 3 cosas: nombre, respuesta cuando no sabe, motivo de escalado') and hide draft/assessment/global banner. Keep them for the health panel.
### AE-04 [high/flow/day0/M] Header exposes four expert workspaces and a template kebab a day-0 owner must not need
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:644-660` [V] — Link …/releases {tReleases('openWorkspace')} … /publications … /learning … /regressions … {t("testAgent")} … {tDraft('save')}
- `apps/dashboard/messages/es.json:agentReleases/agentPublications/agentLearning/qualityRegressions.openWorkspace` [V] — Evaluar y revisar candidato · Publicar y ver historial · Aprender de conversaciones · Fallos y pruebas revisadas
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:679-693` [V] — changeTemplate … saveAsTemplate … setAsDefault
- **Impact:** Seven actions of equal visual weight. 'Guardar borrador' is not the end of anything: the person has no idea that draft→probar→candidato→publicar is the chain, and 'Cambiar plantilla' can overwrite what she just typed. 'Publicar y ver historial' sounds like the thing she wants but leads to a release workflow.
- **Fix:** Day-0: only 'Guardar y probar'. Move the four workspaces into a 'Calidad' tab or the health panel; gate 'Cambiar plantilla' behind confirm.
### AE-05 [high/state/cross/S] Activation switch cannot activate: it only toasts 'La reactivación requiere revisar y publicar una versión'
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:763 (hero), 420-424` [V] — onClick={() => isActive ? setConfirmActive(false) : setToast(tDraft('activationReview'))} … if (next) { setToast(tDraft('activationReview')); return; }
- `apps/dashboard/messages/es.json:agentDraft.activationReview` [V] — La reactivación requiere revisar y publicar una versión.
- **Impact:** A switch that only deactivates is a trap: once off, the owner is sent into the release flow without a link. Combined with AE-01 the toast is green.
- **Fix:** Disable the switch when inactive and replace with a button 'Publicar para activar' linking to /publications; or make the toast a link.
### AE-06 [medium/affordance/later_config/S] Tool cards are pure on/off with no path to load the data they need
- `apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx:506-525` [V] — <ToolToggleCard … family="catalog" title={t("catalogTitle")} … onToggle={(v) => toggleTool("catalog", v)} />
- `apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx:342, 383, 642, 655, 684, 802` [V] — only Links: /admin/appointments, email-templates, settings/billing, integrations/payments
- **Impact:** 'Catálogo de productos — Consultar productos, precios y stock' toggles on with nothing behind it; the agent will answer 'no tengo productos'. Only Citas has the 'Configura {items} antes de activar' pattern (configureBefore/goToAppointments), which is the right model.
- **Video:** 25:31 '¿es solo prender y apagar?'
- **Fix:** Reuse the appointments pattern: each card shows count of loaded items and a link ('0 productos · Cargar catálogo').
### AE-07 [high/vertical-defaults/day0/S] Derived vertical agent ships with empty 'Instrucciones principales' and the generic name 'Asistente'
- `apps/api/src/modules/verticals/verticals.service.ts:1921-1968` [V] — const persona = {…name: this.orFallback(existingPersona.name, pick(agentDef.name)) …}; const behavior = {…rules, forbiddenTopics, handoffTriggers}; — no mainInstructions
- `apps/api/src/modules/verticals/verticals.service.ts:1998-2000` [V] — return typeof current === 'string' && current.trim().length > 0 ? current : fallback;
- `apps/api/src/modules/persona/persona.service.ts:480-502` [V] — name: 'Asistente' … rules: [3] … handoffTriggers: [2] … forbiddenTopics: []
- **Impact:** The wizard says 'Preparamos a Asistente con lo que nos contaste' but the 180px canvas is blank; the placeholder is a 60-word paragraph about 'asesor de ventas'. Rules accordion has ≥3 default + vertical rules, handoff ≥2, prohibited 0+vertical [inferred counts for the dance case: no danza/baile entry in vertical-definitions.ts]. Name stays 'Asistente' because the default insert happens first and existing wins.
- **Video:** moment 5, empty canvas
- **Fix:** Seed mainInstructions from the vertical definition (agentDef.role + goals text) and let the wizard's name field overwrite the default when name === 'Asistente'.
### AE-08 [medium/affordance/day0/S] Fallback message has a generic placeholder while tone/length use choosable cards
- `apps/dashboard/messages/es.json:agent.identity.fallbackPlaceholder` [V] — Mensaje de respaldo cuando el agente no sabe cómo responder...
- `apps/dashboard/src/app/admin/agent/_components/PersonaTab.tsx:250-323` [V] — {t(`preset_${preset.id}`)} … {t(`preset_${preset.id}_desc`)} … {t(`length_${al.id}`)}
- `apps/dashboard/messages/es.json:agent.validation.fallbackRequired` [V] — Escribe qué debe decir cuando no sabe la respuesta. Sin esto, el agente puede inventar.
- **Impact:** Moment 4 worked because tone (5 cards: Amigable/Profesional/Formal/Casual/Empático) and length (3 cards) are pick-one with a one-line description. Fallback, greeting, rules and handoff triggers are blank textareas with 'ej.:' placeholders; the person must invent copy. The default config already has good sentences (persona.service.ts:488-502) that could be offered as chips.
- **Video:** moment 4 tone; 5 empty fields
- **Fix:** Add 2-3 suggestion chips under fallback/greeting/rules/handoff that fill the field on click (reuse the tone-card component).
### AE-09 [low/health/health_panel/XS] Deep-link ?tab=&focus= works, but the readiness banner names at most 3 blockers and sends the rest to the quality center
- `apps/dashboard/src/components/AgentReadinessBanner.tsx:22-37, 122-128` [V] — persona_identity: (id) => `/admin/agent/${id}?tab=persona&focus=name` … const namedBlockers = missing.slice(0, 3) … extraBlockers
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:365-384` [V] — setActiveTab(FOCUS_TAB[target]) … element?.scrollIntoView({ behavior: "smooth", block: "center" }) … setTimeout(() => setFocusField(null), 4_000)
- **Impact:** This is the one block that behaves like a health panel (named item → field). It is undermined by being one of five blocks; 'y 2 más' pushes to /admin/agent/quality where a novice gets lost.
- **Fix:** List all blockers (usually ≤5) and make this banner the single day-0 checklist inside the editor.
### AE-10 [low/help-drift/later_config/XS] Help panel is 6 steps / 192 words and its tour is only the handoff-rules tour
- `apps/dashboard/messages/es.json:help.agentEditor` [V] — 6 tips, 192 words; tip 6: 'Guarda el borrador, pruébalo, prepara la revisión, apruébala y publícala'
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:700-705` [V] — <HelpPanel title={th("agentEditor.title")} … tourId="agent_handoff_rules" />
- `apps/dashboard/src/components/ui/help-panel.tsx:86-88` [V] — defaultOpen = false … useState(defaultOpen)
- **Impact:** Collapsed by default (fine), but when opened it describes the five-stage release chain in one breath; 'Mostrarme cómo' only tours handoff rules, not name/fallback.
- **Fix:** Trim to 3 tips for day-0; tour the whole required-fields path.
### AE-11 [medium/jargon/later_config/S] Jargon outside 'Avanzado' in Herramientas: skillset, upsell intensity, discount cap, 'Herramientas especializadas/universales'
- `apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx:182-236, 398, 501` [V] — {t("skillsetTitle")} … {t("upsellTitle")} … {t("upsellIntensity")} … specializedToolsTitle … universalToolsTitle
- `apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx:818-866` [V] — advancedOpen … {t("advancedSearch")} — only RAG topK/threshold is folded
- `apps/dashboard/messages/es.json:agent.capabilities.upsell_*` [V] — Sutil / Moderada / Agresiva · Descuento máximo (%)
- **Impact:** Only search tuning (Avanzado: afinar la búsqueda) and required-fields (BehaviorSection:189) are hidden. A dance academy sees 'Intensidad: Agresiva', 'Descuento máximo', 'Tienda e-commerce', 'Historial de órdenes' on day 0.
- **Fix:** Collapse skillset/upsell/ecommerce/orders under Avanzado unless the vertical recommends them.

## What works
- Validation names the field in plain Spanish (agent.validation.* es.json) and revealFirstError switches tab + scrolls + 4s ring highlight (page.tsx:396-418, 374-384) [V]
- API mirrors the same 5 required fields with typed agent_invalid + fields (persona.service.ts:553-585) [V]
- Tone (5 cards) and answer length (3 cards) are the best pattern on the page: pick one, one-line description (PersonaTab.tsx:250-323) [V]
- Channel chips show only connected types, never SMS; empty state links to /admin/channels with 'Conectar canal' (page.tsx:39-55, 817-826) [V]
- Appointments tool card blocks activation until services/availability exist and links to Citas (CapabilitiesSection.tsx:299-343) [V]
- Readiness banner deep-links per blocker with ?tab=&focus= (AgentReadinessBanner.tsx:22-37) [V]
- Required-fields-per-context and RAG tuning are correctly folded under Avanzado (BehaviorSection.tsx:184-190, CapabilitiesSection.tsx:818-866) [V]
- Deactivation asks for confirmation with consequences spelled out (agent.activation.confirmDeactivateBody) [V]

## Regressions vs Sept plan
- **BROKEN** Single source of progress (InitialSetupCard) — editor should not re-explain readiness — d50d1670/a7337a10 added AgentDraftStatus + AgentAssessmentPanel above the header (page.tsx:623-624) on top of AgentReadinessBanner and the global QualityAttentionBanner.
- **DONE** Save blocks and names the missing field — page.tsx:396-418 + es.json agent.validation.*; only the toast color is wrong (AE-01).
- **PARTIAL** Guided tour 'Mostrarme cómo' on the editor — HelpPanel tourId="agent_handoff_rules" only (page.tsx:704); no tour for name/fallback.
- **BROKEN** Editor degraded to a simple agent editor (onboarding audit Jul: setup-wizard → editor) — Header now carries releases/publications/learning/regressions workspaces (page.tsx:644-647) and activation is gated by publish (page.tsx:420-424).

## Open questions
- Where does the copy 'Configuración incompleta: faltan 4 dependencias' come from? Not in es.json; likely API-provided assessment text or the readiness banner's blocker count — needs a runtime check.
- Does the wizard step 1 ('Tu agente') let the person rename 'Asistente', and does that name reach agent_personas before the vertical patch runs? (orFallback keeps the existing non-empty name.)
- After 'Guardar borrador', is there ever an in-editor CTA to publish, or must the person discover /publications by herself? AgentDraftStatus shows 'Probar este borrador' only when evaluationRevisionId exists (AgentDraftStatus.tsx:36).