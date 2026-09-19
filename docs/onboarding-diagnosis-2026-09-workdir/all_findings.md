| lens | id | sev | cat | scope | size | title |
|---|---|---|---|---|---|---|
| 1 | EF-1 | critical | vertical-defaults | day0 | M | A business outside the 18 industries is born generic: 'Asistente', no services, no availability, deflecting FAQs |
| 1 | EF-3 | critical | flow | day0 | L | Day-0 agent cannot answer price / location / schedule / trial-class; /onboarding never asks for them |
| 2 | W2-01 | critical | clutter | cross | S | Two version/assessment panels sit above the stepper on every wizard step (day-0 buried under health/config layers) |
| 2 | W2-03 | critical | flow | day0 | M | Wizard edits go to a draft nobody publishes; the wizard cannot end with the renamed agent live |
| 3 | AE-02 | critical | affordance | cross | S | Channel chips are bare toggles: one tap unassigns WhatsApp with no confirmation, no diff, no undo |
| 4 | H4-01 | critical | clutter | cross | M | Setup card became the full health checklist (9-10 items), not the 3-6 essentials the plan promised |
| 5 | L5-01 | critical | flow | day0 | M | A number already on Cloud API with another provider has no viable day-0 path and the UI never says so |
| 6 | R6-01 | critical | state | cross | L | Six readiness computations, five vocabularies, one agent |
| 6 | R6-02 | critical | state | day0 | M | Every verdict is computed on the operative version; the draft she edits is never assessed |
| 1 | EF-2 | high | vertical-defaults | day0 | XS | Vertical persona name never wins: template's 'Asistente' overrides Pablo/Alex/Sofía |
| 1 | EF-5 | high | state | cross | M | 'Otro' tenants that chose the goal 'Agendar citas' get an agent whose booking is silently off forever |
| 1 | EF-6 | high | clutter | day0 | S | Wizard first screen stacks draft/release + assessment panels above the 3-step stepper (regression vs §12.1) |
| 2 | W2-02 | high | health | health_panel | M | Every template-derived agent is reported 'Pendiente / no está listo' because the Mission task is pending until the owner writes objective, success criteria and handoff conditions |
| 2 | W2-04 | high | copy | day0 | S | Wizard copy says the agent only answers after 'publicar una versión aprobada'; runtime answers with the operative template agent as soon as a channel is bound |
| 2 | W2-05 | high | flow | later_config | S | 'Definir misión y resultados' / 'Siguiente paso: Acordar la misión' is the first CTA a novice sees and leads to a proposal→review→apply-to-draft loop |
| 3 | AE-01 | high | bug | cross | XS | Validation toast 'Faltan datos obligatorios' renders green with a check icon |
| 3 | AE-03 | high | clutter | cross | M | Five guidance blocks + global critical banner render before the first field of a fresh agent |
| 3 | AE-04 | high | flow | day0 | M | Header exposes four expert workspaces and a template kebab a day-0 owner must not need |
| 3 | AE-05 | high | state | cross | S | Activation switch cannot activate: it only toasts 'La reactivación requiere revisar y publicar una versión' |
| 3 | AE-07 | high | vertical-defaults | day0 | S | Derived vertical agent ships with empty 'Instrucciones principales' and the generic name 'Asistente' |
| 4 | H4-02 | high | clutter | day0 | S | 'One guide' rule holds only for the surfaces the plan named; 8-10 things still render on a channel-less home |
| 4 | H4-03 | high | flow | day0 | XS | PWA 'Instalar Parallly' popup interrupts day-0 with no stage or visit gate |
| 4 | H4-05 | high | affordance | day0 | S | Two items (mission, tests) have no 'Mostrarme dónde', and the first item is 'Acordar la misión', not the channel |
| 4 | H4-09 | high | metrics | health_panel | M | Activation metrics cannot tell whether onboarding works: no per-step drop-off, no time-to-first-test-reply, no item completion |
| 5 | L5-02 | high | state | day0 | S | 'Esperando autorización…' has no exit once the Meta window opened; Meta-side failures are reported only after the person closes the popup |
| 5 | L5-03 | high | flow | cross | M | Meta-free 'aha' exists but is never offered as the alternative when the Meta wall appears |
| 6 | R6-03 | high | state | cross | M | 'Worst wins' roll-up: any warning makes the agent 'not ready to attend' |
| 6 | R6-04 | high | clutter | day0 | S | Every failing critical check becomes a persisted 'acción crítica' signal → global red bar on all screens |
| 6 | R6-05 | high | flow | day0 | M | Setup card = 9-10 tasks in one flat grid; the two day-0 essentials are not distinguished from 'later' polish |
| 7 | H7-01 | high | help-drift | day0 | XS | Editor help tip 6 ('Arriba, prepara las asignaciones…') points the wrong way and was added after the wizard shipped |
| 7 | H7-02 | high | outdated | day0 | XS | Editor tip 1 names a 'pestaña Identidad' that does not exist — the word that sent the user to CRM dedup |
| 7 | H7-03 | high | help-drift | cross | S | The only test on help copy enforces the publish jargon in day-0 help instead of catching UI drift |
| 1 | EF-4 | medium | help-drift | day0 | S | 'audiences' is collected as required but never reaches the agent; 'about' does |
| 1 | EF-8 | medium | vertical-defaults | later_config | S | No template carries instructions, so the editor's 'Instrucciones principales' is a blank canvas on day 0 |
| 2 | W2-06 | medium | jargon | health_panel | S | 'Guiarme con Parallly Assist' and 'Revisar dependencias y pruebas' expose health-panel internals (six-state legend, tools, required tests) inside the wizard |
| 2 | W2-08 | medium | state | day0 | S | Test chat tests the DRAFT once a draft exists, while the assessment above describes the OPERATIVE version — two truths on one screen |
| 3 | AE-06 | medium | affordance | later_config | S | Tool cards are pure on/off with no path to load the data they need |
| 3 | AE-08 | medium | affordance | day0 | S | Fallback message has a generic placeholder while tone/length use choosable cards |
| 3 | AE-11 | medium | jargon | later_config | S | Jargon outside 'Avanzado' in Herramientas: skillset, upsell intensity, discount cap, 'Herramientas especializadas/universales' |
| 4 | H4-04 | medium | clutter | day0 | S | Mascot bubble is silenced only on /admin; on the wizard and editor it still greets and the avatar always shows |
| 4 | H4-06 | medium | copy | day0 | S | No next-step highlight, no time estimate, no 'what is enough' — progress is only 'N/M esenciales' |
| 4 | H4-07 | medium | state | cross | S | Plan's 'card writes completed at 100 %' never built; wizard 'Listo' writes completed without a channel and its tour CTA now launches a publish tour |
| 4 | H4-08 | medium | flow | later_config | S | Global search matches labels/route ids only; 'Identidad' can only reach CRM identity |
| 5 | L5-04 | medium | copy | day0 | S | Pre-check is a generic awareness gate that hides the routes and does not mention the 24 h window, the 7-day rule or the phone-in-hand |
| 5 | L5-05 | medium | help-drift | cross | XS | ~450 words before the Connect button plus a HelpPanel whose tips contradict the route catalogue |
| 5 | L5-06 | medium | copy | cross | S | Success message after connecting is hedged on the draft/release model instead of confirming the agent answers |
| 6 | R6-06 | medium | jargon | health_panel | M | Health page speaks in pillars/dimensions/controls/evidence/snapshots — a novice cannot map it to 'what can my agent answer' |
| 6 | R6-07 | medium | validation | day0 | S | Generic template agent named 'Asistente' passes persona_identity; identity check cannot flag the missing name the owner cares about |
| 6 | R6-08 | medium | health | health_panel | M | Runtime tool gating (VerticalReadinessService) is a separate truth the health panel never shows |
| 6 | R6-10 | medium | health | cross | S | 'Tested' pillar goes stale on every agent save; tests never run = 'unknown' → next milestone 'Superar las pruebas críticas' for a novice with no channel |
| 7 | H7-04 | medium | outdated | health_panel | XS | Home help sends a tenant admin to a super_admin-only route and uses stale KPI names |
| 7 | H7-05 | medium | outdated | later_config | XS | Agent list help quotes a red banner and a 'Principal' star that the UI labels differently |
| 7 | H7-06 | medium | jargon | cross | S | Assist mascot namespace ships 1,587 words of dead engineering copy |
| 7 | H7-07 | medium | help-drift | later_config | S | KB still documents SMS credits as a product and 'Probar agente' article predates drafts |
| 7 | H7-08 | medium | affordance | day0 | XS | Home and wizard help panels are the two day-0 panels WITHOUT a 'Mostrarme cómo' tour, while 16 later screens have one |
| 1 | EF-7 | low | flow | day0 | XS | Signup lets the owner in before email verification, then bounces to /verify-email on a later login |
| 2 | W2-07 | low | flow | day0 | XS | Finishing with the tour CTA can still arm the automatic product tour (plan said never write PRODUCT_TOUR_PENDING_KEY) |
| 2 | W2-09 | low | state | day0 | XS | Esc and 'Salir' write onboardingStage agent_reviewed even if nothing was reviewed; Home only redirects back while stage is account_created |
| 3 | AE-09 | low | health | health_panel | XS | Deep-link ?tab=&focus= works, but the readiness banner names at most 3 blockers and sends the rest to the quality center |
| 3 | AE-10 | low | help-drift | later_config | XS | Help panel is 6 steps / 192 words and its tour is only the handoff-rules tour |
| 4 | H4-10 | low | mobile | day0 | S | Mobile: tour is desktop-only, while PWA prompt, mascot and 2-column card stack at the bottom |
| 6 | R6-09 | low | help-drift | cross | XS | Dead 'Para que tu agente esté 100% listo' strings (4-item checklist) still shipped in i18n |
| 7 | H7-09 | low | clutter | day0 | M | Two tour engines coexist: legacy onborda ProductTour auto-starts from localStorage next to the 17 guided tours |
| 7 | H7-10 | low | help-drift | cross | XS | Help media: 103 pages pass mediaKey, zero assets exist (guarded, no 404s) — the README promises GIFs that never landed |