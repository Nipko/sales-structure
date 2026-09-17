# Lens 6 — readiness/health truths (agent quality, assessment, operational state, setup card)

## Summary
There is no single "is my agent ready" truth. Five computations coexist, all fed by the same ~44 preparation checks but each collapsing them with a different rule and a different vocabulary: (1) AgentQualityOverview.status (6 states, "Configuración incompleta"…), (2) preparation pillar status blocked/needs_attention/ready, (3) AgentAssessment.state via rollUpOperationalState (pending/prepared/tested/operating/degraded/unknown) which the wizard prints as "El agente todavía no está listo para atender", (4) the attention summary of persisted signals which raises the global red bar "Hay una acción crítica", and (5) the setup card tasks (9-10 items, "{n}/{total} esenciales"). Plus a sixth runtime truth, VerticalReadinessService, that gates tools per turn and is documented as drifting from the checks. All of them read agent_personas (the operative version) and none read the draft the novice is editing, so during the entire wizard the verdict describes a version she is not touching. The roll-up rule is "worst wins": any warning (template mission not confirmed, tests never run, hours unset) makes the whole agent "pending", so a novice with everything essential done still reads "not ready" and sees a 9-item grid. Day-0 needs one truth with 3-4 items; the health panel needs the existing data (checks, eval runs, signals, production metrics, competence matrix, channel status, human availability) re-labelled in plain language and split by question: what can it answer, what is missing, how did it do, what now.

## Journey
### /admin/setup-wizard (video 00:15)
- trial banner
- header 'Conoce a tu agente'
- AgentDraftStatus 'Versión operativa y borrador' (setup-wizard/page.tsx:501)
- AgentAssessmentPanel 'Misión y preparación' with operational state 'Pendiente' + next task + Assist button + 'Revisar dependencias y pruebas' (:502; panel prints 'Esta evaluación describe la versión operativa')
- '¿Cómo funciona este asistente?' toggle
- stepper 1/2/3
- step content
- words before first input: 150
- notes: Two verdict widgets (draft status + operative assessment) precede the first field; both describe a version she is not editing.
### /admin/agent/[agentId] (editor)
- global QualityAttentionBanner red 'acción crítica' (layout.tsx:210)
- AgentDraftStatus (:623)
- AgentAssessmentPanel (:624)
- AgentReadinessBanner 'Configuración incompleta / Hay N bloqueos críticos / Falta configurar: …' (:708)
- amber 'Todavía no conectaste un canal' (:819)
- HelpPanel
- form tabs
- notes: Four readiness widgets on one screen from three computations (signals, assessment, overview).
### /admin (home, 30:15)
- amber connectBannerTitle (page.tsx:482)
- AgentHealthCard 'Salud de tus agentes' worstStatus + attention count (:546)
- InitialSetupCard 9-10 tasks 3-col grid '{n}/{total} esenciales' (:548)
- KPI tiles
- notes: Health card and setup card show different numbers for the same facts.
### /admin/agent/quality
- AgentAssessmentPanel
- PageHeader + HelpPanel
- agent selector
- status hero (6 statuses, next milestone, operational state, v#/dates)
- 'Tres capas de evidencia' 3 PillarCards
- 'Qué mejorar primero' recommendations
- 'Preparación por dimensión' 6 <details> with ~44 checks
- production metrics + top issues
- 'Cómo interpretar este centro' aside
- notes: page.tsx:181-218

## Findings
### R6-01 [critical/state/cross/L] Six readiness computations, five vocabularies, one agent
- `apps/api/src/modules/quality/agent-quality.service.ts:1068` [V] — status: criticalBlockers.length ? 'blocked' : hasFailure || hasWarning ? 'needs_attention' : 'ready'
- `apps/api/src/modules/quality/agent-quality.service.ts:1265-1278` [V] — resolveStatus → configuration_incomplete | at_risk | review_required | not_evaluated | operating_with_evidence | ready_for_pilot
- `apps/api/src/modules/copilot/agent-assessment.service.ts:376-380` [V] — state: rollUpOperationalState([operationalStateFromQuality(overview.status), ...tasks.map(task => task.state), ...statedChannels...
- `apps/api/src/modules/quality/agent-quality-signal.service.ts:394-423` [V] — attentionCount: openCritical + openHigh … worstStatus/topAction
- `apps/dashboard/src/lib/initial-setup.ts:38-50` [V] — done: task.status === "pass" || task.status === "not_applicable"
- `apps/api/src/common/utils/readiness-predicate-authority.util.ts:6-15` [V] — VerticalReadinessService counts rows … never audited against the query the TOOL runs, so the two drifted
- **Impact:** On one screen she reads 'Configuración incompleta' (quality status), 'Pendiente: todavía no está listo para atender' (operational state), 'Hay una acción crítica' (signals), '2/9 esenciales' (card) and 'Bloqueada' (pillar). Same facts, five verdicts; she cannot tell which one to believe or when she is done.
- **Video:** 00:15 wizard top: violet panels + 'Pendiente' before the stepper; 30:15 home grid of 9
- **Fix:** Declare AgentAssessment.tasks the only day-0 truth and derive banner/card/wizard from it; keep quality status for the health panel only; never show two verdict widgets on one screen.
### R6-02 [critical/state/day0/M] Every verdict is computed on the operative version; the draft she edits is never assessed
- `apps/api/src/modules/copilot/agent-assessment.service.ts:176` [V] — SELECT id, name, template_id, version, config_json, channels, channel_bindings FROM agent_personas
- `apps/api/src/modules/quality/agent-quality.service.ts:243-252` [V] — loadAgent … FROM agent_personas WHERE id = $1::uuid
- `apps/dashboard/src/components/quality/AgentAssessmentPanel.tsx:71` [V] — <p …>{tDraft('assessmentOperational')}</p>  // 'Esta evaluación describe la versión operativa. Prueba el borrador…'
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:501-502` [V] — <AgentDraftStatus workspace={workspace}…/> <AgentAssessmentPanel />
- `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:792` [V] — t("assignmentReview.draftScope") // 'Estas selecciones pertenecen al borrador. La evaluación de calidad describe la versión operativa'
- **Impact:** She fills the wizard, the 'Pendiente' panel above it never changes because it grades version 5 (operative), not her draft. Progress feels invisible; the small-win loop is broken. No code path (grep) makes quality or assessment read agent drafts.
- **Video:** Wizard 00:15 and editor: 'Esta evaluación describe la versión operativa. Prueba el borrador para evaluar sus cambios'
- **Fix:** Day-0: hide the operative-version assessment in the wizard entirely; show only step-local confirmations. Later: assess the draft (pass config_json of draft into buildPreparation) and label it 'borrador'.
### R6-03 [high/state/cross/M] 'Worst wins' roll-up: any warning makes the agent 'not ready to attend'
- `packages/shared/src/agent-operational-state.ts:70-82` [V] — case 'warning': return options.operationalIssue ? 'degraded' : 'pending'; case 'fail': return 'pending';
- `packages/shared/src/agent-operational-state.ts:142-149` [V] — if (known.includes('degraded')) return 'degraded'; if (known.includes('unknown')) return 'unknown'; return known.reduce(worst…)
- `apps/api/src/modules/copilot/agent-assessment.service.ts:241-245` [V] — key: 'mission', status: … configured ? 'pass' : 'warning' … configured ? undefined : 'pending'
- `apps/api/src/modules/copilot/agent-assessment.service.ts:305-308` [V] — tests … proven … ? 'pass' : 'warning'
- **Impact:** Mission is 'warning' until she explicitly saves it (template-derived), tests are 'warning' until an eval run passes, hours are warning if unset. Each alone yields agent state 'pending' → 'El agente todavía no está listo para atender: queda configuración por hacer' even when WhatsApp is connected and it could answer. The sentence is also false in the other direction: WhatsApp missing is also just 'pending'.
- **Video:** 00:15 'Pendiente: El agente todavía no está listo para atender' and 'Siguiente paso: Acordar la misión del agente'
- **Fix:** Separate 'can it answer' (critical checks only: active + channel connected/assigned + fallback + handoff route) from 'can it be better' (warnings). Roll-up for day-0 uses only the first set.
### R6-04 [high/clutter/day0/S] Every failing critical check becomes a persisted 'acción crítica' signal → global red bar on all screens
- `apps/api/src/modules/quality/agent-quality.service.ts:1174-1190` [V] — code: `fix_${check.code}` … severity: … check.critical ? 'critical' : 'high'
- `apps/dashboard/src/components/quality/QualityAttentionBanner.tsx:80-81, 106` [V] — if (pathname === "/admin/setup-wizard" || pathname.startsWith("/admin/agent/quality")) return null; … t(summary?.worstStatus === "at_risk" ? "bannerAtRisk" : "bannerCritical")
- `apps/dashboard/src/app/admin/layout.tsx:210` [V] — <QualityAttentionBanner />
- **Impact:** A brand-new tenant with no channel yet has channel_assignment/handoff_triggers failing → 'Hay una acción crítica que requiere atención. Revisa primero a Asistente' in red on every page (except wizard/quality). It reads like an outage, not like 'you have not finished setup'. The banner competes with the setup card and the amber 'no channel' banner on the same home.
- **Video:** Editor: red 'Hay una acción crítica… Revisa primero a Asistente' + violet incomplete panel + HelpPanel at once
- **Fix:** Suppress the attention bar while onboardingStage < live (or while assessment.nextTask is a setup task); reserve 'crítica' for regressions of a previously working agent (needs 'was operating' evidence, which signals already carry via agent_config_version).
### R6-05 [high/flow/day0/M] Setup card = 9-10 tasks in one flat grid; the two day-0 essentials are not distinguished from 'later' polish
- `packages/shared/src/agent-assessment-contract.ts:184-192` [V] — channel, agent, business, knowledge, team, hours, appointments…
- `apps/api/src/modules/copilot/agent-assessment.service.ts:241-270, 305` [V] — tasks: mission … for (const [key, codes] of Object.entries(AGENT_SETUP_TASK_CHECKS)) … catalog … tests
- `apps/dashboard/src/components/InitialSetupCard.tsx:125, 138` [V] — t("progress", { completed, total: items.length }) … <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
- **Impact:** Exactly the video reaction: 'O sea, tendría que trabajar en todos estos…'. The card is honest but undifferentiated: 'Acordar la misión', 'Probar los resultados', 'Confirmar tu horario' sit next to 'Conectar y asignar un canal'. dependsOn exists in the data (:247-254) but the UI ignores order/priority.
- **Video:** 30:15 home 'Puesta en marcha' 3x3 grid
- **Fix:** Render tasks in dependsOn order as a single 'next step' + collapsed 'después'. Day-0 set = channel + agent(fallback/handoff) + team; everything else under 'Mejorar después'.
### R6-06 [medium/jargon/health_panel/M] Health page speaks in pillars/dimensions/controls/evidence/snapshots — a novice cannot map it to 'what can my agent answer'
- `apps/dashboard/src/app/admin/agent/quality/page.tsx:204-218` [V] — statuses.* / nextMilestone / 'Tres capas de evidencia' PillarCard×3 / 'Qué mejorar primero' / 'Preparación por dimensión' <details>×6 / metrics+issues / 'Cómo interpretar este centro'
- `apps/dashboard/messages/es.json:agentQuality.*` [V] — 'controles aplicables superados', 'Prueba crítica superada', '{count} intentos', 'Evidencia automatizada; no es una certificación', 'Simulación complementaria', 'Atribución disponible desde', 'Desactualizada', 'Evidencia insuficiente'
- **Impact:** Terms she will not understand: pilar/capa de evidencia, dimensión, control, umbral, intentos, evidencia atribuida, hito, piloto controlado, desactualizada (stale), señal, posponer 24 h, versión v5, 'simulación complementaria: N escenarios'. The page answers 'is the evidence trustworthy' (auditor question), not 'what does my agent know / what happened with clients' (owner question).
- **Video:** n/a (user never reached /admin/agent/quality)
- **Fix:** Keep the data, re-frame into four owner questions (see design input); move pillars/dimensions/method aside into an 'Detalle técnico' collapsible.
### R6-07 [medium/validation/day0/S] Generic template agent named 'Asistente' passes persona_identity; identity check cannot flag the missing name the owner cares about
- `apps/api/src/modules/quality/agent-quality.service.ts:874` [V] — persona_identity … status(text(persona.name) && text(persona.role))
- **Impact:** The video agent 'Asistente' (template default) is green on identity; the panel says 'Propuesta derivada de la plantilla' only for the mission. Nothing tells her the agent still carries the template name/greeting, so the first customer would be greeted by 'Asistente'. [inferred] that template default name is 'Asistente' from the video; the check only tests non-empty text.
- **Video:** 00:15 'Preparamos a Asistente con lo que nos contaste'
- **Fix:** Add evidence 'templateDefault' to persona_identity (compare with template values) and make the wizard step 1 own the name as a required, visible win.
### R6-08 [medium/health/health_panel/M] Runtime tool gating (VerticalReadinessService) is a separate truth the health panel never shows
- `apps/api/src/modules/conversations/effective-capability.service.ts:336-349` [V] — const readinessKeys = [ … ] … evaluate(… [...new Set(readinessKeys)]
- `apps/api/src/common/utils/readiness-predicate-authority.util.ts:6-15` [V] — Readiness says "you have a service"; the availability read never touches `services` and answers out of `availability_slots`
- **Impact:** The live turn can refuse a tool (unmet readiness key) while the quality page shows 'Agenda y disponibilidad: Cumple'. The owner has no screen that says 'today your agent can book / cannot book because X'. The assessment's tools section (state per tool) is the closest but is hidden under 'Revisar dependencias y pruebas'.
- **Video:** n/a
- **Fix:** Expose ReadinessReport.unmet per intent in the health panel as 'Qué puede hacer hoy' with plain labels; reuse assessment.tools[].missing.readiness.
### R6-09 [low/help-drift/cross/XS] Dead 'Para que tu agente esté 100% listo' strings (4-item checklist) still shipped in i18n
- `apps/dashboard/messages/es.json:agent.readiness.*` [V] — 'Para que tu agente esté 100% listo', '{done} de {total} listo', items channel/about/hours/knowledge
- `apps/dashboard/src:grep readiness.title → no tsx match` [V] — no consumer
- **Impact:** None visible; but it is the 4-item shape a novice needs, and it survived only as text — a hint that the old simple checklist was replaced by the 9-item one.
- **Fix:** Delete or reuse as the day-0 subset label set.
### R6-10 [medium/health/cross/S] 'Tested' pillar goes stale on every agent save; tests never run = 'unknown' → next milestone 'Superar las pruebas críticas' for a novice with no channel
- `apps/api/src/modules/quality/agent-quality.service.ts:1086-1093, 1097-1101` [V] — if (evalDate && evalDate < agentUpdated) staleReasons.push('agent_configuration_changed_after_eval') … if (!evalRow) status = 'unknown'
- `apps/api/src/modules/quality/agent-quality.service.ts:227-233` [V] — nextMilestone: … tested.status === 'unknown' … ? 'pass_critical_tests'
- **Impact:** Once critical blockers clear, the very next thing the panel demands is an evaluation run ('Superar las pruebas críticas', 'Probar los resultados del agente'), and any later edit flips it to 'Desactualizada'. For day-0 the natural test is 'send yourself a WhatsApp', not an eval suite.
- **Fix:** On day-0 map 'tests' task to the live self-test (first real inbound message answered) and only introduce eval runs in the health panel.

## What works
- One server-side source for setup tasks: InitialSetupCard and AgentAssessmentPanel both read api.getAgentAssessment; initial-setup.ts:1-14 explicitly forbids a second client computation.
- Checks carry href + evidence + critical + weight and are mapped to guided tours (agent-assessment.service.ts:263), so a plain-language panel can be built without new data.
- channel_connection/channel_coverage were carefully de-duplicated (agent-quality.service.ts:924-975) so one cause does not produce two blockers, and 'unknown' is never reported as pass.
- Signal severity follows outcome not label (:1181-1188): a warning on a critical check is 'high', not 'critical'.
- Production pillar already computes quality_overall, verified_resolution_rate, handoff_rate, tool_failure_rate, open_knowledge_gaps with sample minimums (:1157-1161) — the raw material for '¿cómo le fue con clientes reales?'.
- Operational-state legend (agentOperationalState.states.*.meaning) is genuinely plain Spanish ('Lo leímos y falta hacerlo. Sabemos qué es y dónde se configura').

## Regressions vs Sept plan
- **PARTIAL** InitialSetupCard as the single source of progress — Card is single source for its own list (initial-setup.ts:38-50), but the wizard/editor now also show AgentAssessmentPanel + AgentDraftStatus + AgentReadinessBanner + global attention bar (d50d1670/a7337a10 additions), so 'progress' is shown by 4 widgets again.
- **DONE** One definition of 'connected' shared by Calidad and Canales — channel_connection reads tenant.channelLookupAvailable/connectedOperational (agent-quality.service.ts:929-960); card labels derive from the same check (initial-setup.ts:52-66).
- **BROKEN** Wizard as a simple 3-step path — setup-wizard/page.tsx:501-502 mounts draft status and operative assessment above the stepper (video 00:15).

## Open questions
- Is 'Configuración incompleta: faltan 4 dependencias' (video) the AgentReadinessBanner ('Configuración incompleta' + 'Hay 4 bloqueos críticos por resolver' + 'Falta configurar') or an Assist-generated sentence? No i18n string contains 'faltan … dependencias' [inferred: banner paraphrased].
- Does the tenant's template set the persona name to 'Asistente' (R6-07)? Not verified in template seeds.
- Design input for the health panel — mapping check-code → plain item → screen: agent_active→'Tu agente está encendido'→editor; channel_assignment+channel_connection+channel_coverage→'WhatsApp (u otro) recibe mensajes'→/admin/channels; fallback_message→'Sabe qué decir cuando no sabe'→editor?focus=fallback; handoff_triggers+human_handoff_route→'Cuándo pasa a una persona y quién la recibe'→editor?focus=handoff + /admin/users; business_identity/contact/context→'Sabe qué es tu negocio'→business-info; knowledge_coverage/rag_knowledge/tool_faqs/tool_policies→'Lo que puede responder' (list sources + open knowledge_gaps)→/admin/knowledge; tool_appointments(+services/slots)→'Puede agendar'→/admin/appointments; tool_catalog/ecommerce/offers→'Puede vender/mostrar catálogo'→inventory; business_hours/after_hours→'Sabe tu horario'; media_privacy_policy→'Puede recibir audios/fotos'; llm_limits/brand_voice/greeting/forbidden_topics/agent_language→'Ajustes finos' (never day-0). Missing data to answer the four questions: per-intent 'what can it answer today' from VerticalReadinessService.unmet + competence-matrix (exists at eval.controller:18 but not surfaced per owner), first-real-message self-test as evidence, human availability now (agent-console agents/:tenantId/available exists, not joined), per-tenant cost (billing usage exists; LLM cost only super_admin financials llm-usage), and a single 'qué hago ahora' = assessment.nextTask already exists but is buried under 'Revisar dependencias y pruebas'.