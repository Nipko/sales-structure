# Lens 1 — Entry flow and day-0 defaults (signup → /onboarding → what the tenant is born with)

## Summary
The entry path itself (signup → 4-step /onboarding → bridge → "Conoce a tu agente") is in good shape and matches the September plan §12.1 almost item by item: 4 signup fields or Google, step 1 with 4 required fields plus a collapsed "Más detalles (opcional)", timezone chip, single no-card plan card with "Ver otros planes", LocaleSwitcher + Ayuda link, client validation mirroring the DTO with server error codes mapped and auto-jump to the field, localStorage draft, bridge screen. The problem is what the tenant is BORN with and what happens on the very next screen. (1) A business that does not map to one of the 18 industries (Nataly's dance academy → almost certainly "Otro") is provisioned from `createGenericVertical`: agent named "Asistente", role "Asistente comercial", no services, no availability, `bookingEnabled:false`, and 5 FAQs whose answers are all non-answers ("escríbenos y te compartimos la dirección"). Even for a well-matched vertical (education), the template persona name overrides the vertical name because `orFallback(existingPersona.name, …)` keeps the template's value. (2) The day-0 agent cannot answer any of the four questions a dance-school prospect asks (price, location, schedule, trial class) because /onboarding never collects address/prices/schedule and the seeded FAQs deflect. (3) The one field the owner did type ("about") IS used in the prompt, but "audiences" is stored and never reaches the prompt. (4) The wizard the plan promised ("nombre y saludo, chat de prueba, sin aviso rojo") now stacks AgentDraftStatus + AgentAssessmentPanel on top of the 3-step stepper, which is the "ya me perdí" moment. Day-0 is not broken by missing features; it is broken by a generic birth plus later layers that bled into the first screen.

## Journey
### /signup
- LocaleSwitcher
- Google button
- firstName, lastName, email, password (required)
- submit → /onboarding
- required: firstName, lastName, email, password
- words before first input: 15
- notes: [V] signup/page.tsx:87-89, 228, 361-398. No plan choice here; pricing intent read from URL.
### /onboarding step 1 (empresa)
- Ayuda link + LocaleSwitcher
- 4-step progress bar (step1,step2,step3,step5)
- companyName*
- industry* (+subType* only moda_belleza/salud)
- orgSize*
- about* (hint: 'El agente IA usará esto…')
- timezone chip 'Detectamos … cambiar'
- 'Más detalles (opcional)' collapsed: website, phone, email, socials, coupon
- required: companyName, industry, subType (2 industries), orgSize, about
- words before first input: 20
- notes: [V] page.tsx:33, 702-714, 1048-1221. Draft in localStorage.
### /onboarding step 2 (audiencia)
- per-industry audience chips or generic b2c/b2b/government/other
- 'other' free text
- required: audiences ≥1
- notes: [V] page.tsx:715, 953-955; es.json onboarding.audiences / verticalAudiences. Stored in tenant.settings.customerTypes, NOT used in the prompt.
### /onboarding step 3 (objetivos)
- per-industry goal chips (education: faq/appointments/lead_qualification/support) or generic 6
- required: goals ≥1
- notes: [V] page.tsx:717, 956-958. Goals pick the persona template (resolver) and land in <business_goals>.
### /onboarding step 4 (plan)
- billing country
- single plan card (no-card trial) with trial days
- 'Ver otros planes'
- Crear cuenta
- required: plan, billingCycle
- notes: [V] page.tsx:698-700, 1551-1650.
### bridge → /admin/setup-wizard
- 'Cuenta creada / Ahora te presentamos a tu agente…' (1.4s)
- then wizard: trial banner, header, AgentDraftStatus, AgentAssessmentPanel, '¿Cómo funciona…' toggle, stepper, 'Tu agente — Preparamos a Asistente…' name + greeting + test chat
- required: agentName, greeting
- notes: [V] page.tsx:857-861, 916-917; setup-wizard/page.tsx:7, 22, 27, 226-236. Order above the stepper matches the video description.

## Findings
### EF-1 [critical/vertical-defaults/day0/M] A business outside the 18 industries is born generic: 'Asistente', no services, no availability, deflecting FAQs
- `apps/api/src/modules/verticals/vertical-definitions.ts:1299` [V] — const OTRO = createGenericVertical('otro', {});
- `apps/api/src/modules/verticals/vertical-definitions.ts:530,546,555` [V] — agent: { name: { es: 'Asistente' … } … services: [], … bookingEnabled: false
- `apps/api/src/modules/verticals/vertical-definitions.ts:542` [V] — '¿Dónde están ubicados?' → 'Con gusto te compartimos nuestra dirección y cómo llegar. Escríbenos y…'
- `apps/api/src/modules/persona/persona.service.ts:2861-2882` [V] — tpl_otro_ventas … persona.name 'Asistente', role 'Asistente comercial' … forbiddenTopics ['Precios no confirmados','Promesas de entrega sin verificar'…] handoffTriggers ['reclamo','queja formal','solicitud compleja','cliente insatisfecho']
- `apps/dashboard/messages/es.json:onboarding.industries` [V] — 18 keys: turismo, education, salud, … fotografia ('Fotografía / Eventos'), … otro — no dance/academy/entertainment
- **Impact:** Nataly read exactly these forbidden topics and handoff triggers at 16:43/17:42 in the video, so her tenant is on tpl_otro_ventas (industry Otro or event_planning). She was handed a nameless generic seller with nothing about classes, prices or location, and had to invent everything (Momentos 3, 5, 6).
- **Video:** 03:13 '¿lo dejamos así, Asistente?'; 16:43-17:42 reading the generic lists
- **Fix:** Add a 'Academia / clases' subtype (or route 'baile'/'danza' keywords to education/gimnasios) and make the generic vertical ask 3 concrete fields (what you sell, price range, address) instead of seeding deflecting FAQs.
### EF-2 [high/vertical-defaults/day0/XS] Vertical persona name never wins: template's 'Asistente' overrides Pablo/Alex/Sofía
- `apps/api/src/modules/verticals/verticals.service.ts:1922-1924` [V] — name: this.orFallback(existingPersona.name, pick(agentDef.name)), role: this.orFallback(existingPersona.role, …)
- `apps/api/src/modules/verticals/verticals.service.ts:1973` [V] — const displayName = persona.name || agent.name || 'Asistente';
- `apps/api/src/modules/persona/persona.service.ts:480,2867` [V] — buildDefaultPersona → persona.name: 'Asistente'; tpl_otro_ventas persona.name: 'Asistente'
- `apps/api/src/modules/persona/persona.service.ts:3108` [V] — deepMergeConfig(this.buildDefaultPersona(tenantId), template.config_json)
- **Impact:** Any template whose persona name is the placeholder 'Asistente' keeps it forever; the vertical registry's human name and role are only used when the template left them blank. The wizard then says 'Preparamos a Asistente', which reads as 'we prepared nothing'. Education templates do carry 'Pablo' (persona.service:2133), so this bites mostly the generic/otro path and any builtin template with the placeholder.
- **Video:** 00:15 'Preparamos a Asistente con lo que nos contaste'
- **Fix:** Treat 'Asistente'/'Assistant' as empty in orFallback (placeholder set), or apply vertical name when template_id is a generic tpl_otro_*.
### EF-3 [critical/flow/day0/L] Day-0 agent cannot answer price / location / schedule / trial-class; /onboarding never asks for them
- `apps/dashboard/src/app/onboarding/page.tsx:766-800` [V] — company: { name, website, phone, email, about, socialMedia, industry, subType, orgSize, timezone, country } — no address, no services/prices, no schedule
- `apps/api/src/modules/conversations/prompt-assembler.service.ts:260-269` [V] — if (b.about) … <about>; if (b.phone) …; if (b.website) …; if (b.address) … <address>
- `apps/api/src/modules/verticals/vertical-definitions.ts:501-511` [V] — education faqs '¿Cuánto cuesta?' → 'Los costos varían según el programa. Cuéntame cuál…'; services: Clase de prueba (price 0, 60 min), Tutoría 80000, Test de nivel
- `apps/api/src/modules/verticals/vertical-definitions.ts:513` [V] — businessHours mon-fri 07:00-20:00, sat 08:00-14:00 (hard-coded, not asked)
- **Impact:** For a dance academy in Bogotá the best available fit is 'education' (seeds a free 'Clase de prueba' + availability because bookingEnabled:true) or 'gimnasios' (group-class FAQs). Even then, on day 0 the bot answers '¿cuánto cuestan las clases?' with 'depende del programa', '¿dónde quedan?' with nothing (address is never collected), '¿qué horarios?' with the registry's 07-20 default, and can only book a 'Clase de prueba' if she picked education. Under 'Otro' none of the four is answerable and booking is off. Minimum data she must type today lives on 4 different screens: address → /admin/settings/business-info; prices → /admin/appointments services (or catalog); hours/availability → Citas → Config; trial-class → services + availability slots.
- **Video:** 08:37-13:30 dictating 'ubicación de nuestra sede, horarios, precios' into a blank textarea
- **Fix:** Step 1 of the wizard (or a step 0) should ask the 4 answers directly: 'What do you sell and from how much', 'Where are you', 'When are you open', and write them into companies.address, services and business hours — the fields the prompt already reads.
### EF-4 [medium/help-drift/day0/S] 'audiences' is collected as required but never reaches the agent; 'about' does
- `apps/dashboard/src/app/onboarding/page.tsx:715-717` [V] — case 1: return audiences.length > 0; case 2: return goals.length > 0;
- `apps/api/src/modules/auth/auth.service.ts:2153-2154,2238` [V] — const customerTypes = data.audiences || data.customerTypes; const chatReasons = data.goals … stored in tenant settings
- `apps/api/src/modules/conversations/prompt-assembler.service.ts:307` [V] — if (vc.businessGoals?.length) lines.push(`<business_goals>…`) — no customerTypes/audiences anywhere in the assembler
- `apps/api/src/modules/business-info/business-info.service.ts:258-277` [V] — chatReasons/customerTypes live in tenant.settings … read back for context
- **Impact:** A whole required step (audience) is dead weight for the agent; goals only pick the template and land in <business_goals>. The owner spends time on a screen that changes nothing the bot says.
- **Fix:** Either pipe customerTypes into <business> or drop the step and fold audience into 'about' hint.
### EF-5 [high/state/cross/M] 'Otro' tenants that chose the goal 'Agendar citas' get an agent whose booking is silently off forever
- `apps/api/src/modules/persona/persona.service.ts:2889` [V] — tools: { crm, knowledge, appointments: { enabled: true, canBook: true, canCancel: true } }
- `apps/api/src/modules/persona/persona.service.ts:3122-3131` [V] — if (services === 0 || slots === 0) appointments: { enabled: false, pendingPrerequisites: true } … the vertical bootstrap re-enables it once the agenda is seeded
- `apps/api/src/modules/verticals/verticals.service.ts:857-865,2703-2706` [V] — seedAvailability … restoreAppointmentsTool(schemaName, effectiveBooking, …) — only when booking is effective; generic vertical bookingEnabled:false
- **Impact:** The resolver maps goal 'appointments' for 'otro' to tpl_otro_ventas (resolver:253-255), the template turns booking on, signup turns it off because nothing is seeded, and the generic vertical never seeds. The owner sees 'faltan 4 dependencias' in the editor with no path back to 'you asked for booking; add one service and one schedule'.
- **Video:** 01:46 'Configuración incompleta: faltan 4 dependencias'
- **Fix:** When pendingPrerequisites is true, the health panel item must read 'Quieres agendar: crea 1 servicio y 1 horario' with a deep link, and the wizard step 1 should offer to create them.
### EF-6 [high/clutter/day0/S] Wizard first screen stacks draft/release + assessment panels above the 3-step stepper (regression vs §12.1)
- `apps/dashboard/src/app/admin/setup-wizard/page.tsx:7,22,27` [V] — import { AgentAssessmentPanel } …; import { AgentDraftStatus } …; import AgentTestChat …
- `docs/assist-quality-guided-tours-plan-2026-09.md:553-556,566` [V] — (1) Tu agente: 'Preparamos a Sofía…' nombre y saludo editables con autosave · chat de prueba al lado … Lo que desaparece: … el aviso rojo de calidad sobre una cuenta recién creada
- `apps/dashboard/messages/es.json:setupWizard.pageSubtitle` [V] — Tres pasos para preparar y probar; publicarás la versión revisada al final.
- **Impact:** The plan's screen was 'name + greeting + test chat'. Post-4f2390e4 commits (d50d1670 drafts/releases, a7337a10 readiness) added 'Versión operativa 5 · Atendiendo / Todavía no hay un borrador' and 'Pendiente: el agente todavía no está listo… Definir misión y resultados' BEFORE the stepper. A first-day owner reads 'versión operativa', 'borrador', 'publicar', 'dependencias' before she has typed her agent's name. Docs claim is contradicted by the shipped page.
- **Video:** 00:15 wizard top; 02:18 '¿Ese es el paso a paso? ¿Y este también? ¿Es lo mismo?'
- **Fix:** Gate AgentDraftStatus and AgentAssessmentPanel on onboardingStage past 'agent_ready' (or hide them inside the wizard entirely); keep them for the editor and the health panel.
### EF-7 [low/flow/day0/XS] Signup lets the owner in before email verification, then bounces to /verify-email on a later login
- `apps/dashboard/src/app/signup/page.tsx:222-228` [V] — if (data.data.verificationEmailSent === false) sessionStorage 'verificationEmailFailed' … router.push('/onboarding')
- `apps/dashboard/src/lib/onboarding-guide.ts:202-207` [V] — if (!user.onboardingCompleted) return '/onboarding'; if (!user.emailVerified) return '/verify-email'; return '/admin'
- **Impact:** Progressive verification is right for day 0, but a returning owner without a tenant yet and unverified email lands on a code screen with no wizard context. Minor; noted because it is a second door into the same flow.
- **Fix:** Keep, but make /verify-email say 'para volver a tu agente'.
### EF-8 [medium/vertical-defaults/later_config/S] No template carries instructions, so the editor's 'Instrucciones principales' is a blank canvas on day 0
- `apps/api/src/modules/persona/persona.service.ts:2870-2882` [V] — tpl_otro_ventas config_json: persona, behavior.rules[5], forbiddenTopics, handoffTriggers, requiredFields — no customInstructions (grep 'customInstructions|instructions:' in persona.service.ts + templates/index.ts → none)
- **Impact:** Nataly and Germán spent 3+ minutes dictating a sales prompt because the field labelled 'Describe en lenguaje natural cómo quieres que se comporte' was empty; the 5 seeded rules were on a different accordion and she did not connect them.
- **Video:** 08:37-13:30
- **Fix:** Render the seeded behavior.rules as the pre-filled instructions (one per line) and label the box 'Ajusta lo que ya preparamos'.

## What works
- Signup: 4 fields (email, password, firstName, lastName) or Google, LocaleSwitcher present, pushes straight to /onboarding (signup/page.tsx:87-89, 228, 250) [V]
- /onboarding step 1 = exactly the 4 required fields of §12.1 (companyName, industry(+subType only for moda_belleza|salud), orgSize, about) with 'Más detalles (opcional)' collapsed (page.tsx:702-714, 1101, 1220) [V]
- Timezone as detected chip with 'cambiar' (page.tsx:1176-1184); language selector + 'Ayuda' link to parallly-chat.cloud/support (page.tsx:35, 977-979) [V]
- Single plan card by default + 'Ver otros planes' (page.tsx:698-700, 1644-1650); no-card trial preferred (isNoCardTrial:163-168) [V]
- Validation mirrors DTO on the client; server 'validation_failed' with fields → focusField + step jump; known codes plan_unavailable/coupon_invalid/email_taken/tenant_exists/rate_limited mapped to i18n (page.tsx:875-905) [V]
- Per-user localStorage draft incl. current step, removed on success (page.tsx:579-649, 845) [V]
- Bridge 'Cuenta creada · Ahora te presentamos a tu agente…' without promising 'listo' (page.tsx:908-917, es.json onboarding.bridge) [V]
- Provisioning is ordered and resumable: schema → default agent → business identity upsert (about/phone/website/socials) → vertical bootstrap → subscription (auth.service.ts:2296-2345) [V]
- Tenant language = dashboard locale, not timezone (auth.service.ts:2196-2199) [V]
- 'about', phone, website reach the prompt via <business> (prompt-assembler:260-269); goals reach <business_goals> (:307) [V]
- Wizard edits only name + greeting with autosave and a test chat beside it (setup-wizard/page.tsx:27, 333, 349; es.json setupWizard.agentStep.autosaveHint) [V]
- Education vertical seeds a free 'Clase de prueba' + availability (bookingEnabled:true) so a correctly-classified academy could book a trial class on day 0 (vertical-definitions.ts:508, 521) [V]

## Regressions vs Sept plan
- **DONE** §12.1 [1] /signup 4 fields or Google — signup/page.tsx:87-89, 228 [V]
- **DONE** §12.1 [2] step 1 with 4 visible fields + 'Más detalles (opcional)' collapsed — onboarding/page.tsx:702-714, 1220-1221 [V]
- **DONE** §12.1 [2] timezone chip 'Detectamos … cambiar' — onboarding/page.tsx:1176-1184 [V]
- **DONE** §12.1 [2] single plan card + 'Ver otros planes' — onboarding/page.tsx:698-700, 1644-1650 [V]
- **DONE** §12.1 [2] language selector + Ayuda link — onboarding/page.tsx:35, 977-979 [V]
- **DONE** §12.1 [2] client validation with DTO rules, server errors mapped to i18n, auto-jump to field — onboarding/page.tsx:875-905 [V]
- **DONE** §12.1 bridge 'Cuenta creada · ahora te presentamos a tu agente' without 'listo' — onboarding/page.tsx:916-917; es.json onboarding.bridge [V]
- **PARTIAL** §12.1 [3](1) 'Preparamos a Sofía, recepcionista…' — a NAMED agent with a role — Text exists (es.json setupWizard.agentStep.prepared) but for 'otro' the name is 'Asistente' (vertical-definitions.ts:530; verticals.service.ts:1922) [V]
- **DONE** §12.1 [3](1) name + greeting editable with autosave, test chat beside, 'Cambiar plantilla' — setup-wizard/page.tsx:27, 333, 349, 570-582; es.json setupWizard.agentStep.autosaveHint/changeTemplate [V]
- **BROKEN** §12.1 'Lo que desaparece: … el aviso rojo de calidad sobre una cuenta recién creada' — AgentDraftStatus + AgentAssessmentPanel now render above the stepper in the wizard (setup-wizard/page.tsx:7, 22) [V]; video 00:15 shows 'Pendiente: el agente todavía no está listo' and the editor shows the red readiness banner [inferred from video]
- **PARTIAL** §12.1 [4] /admin: only the setup card with the channel item expanded while no channel — Video 30:15 shows amber banner + 9-item 3x3 card + 4 KPI tiles + mascot [inferred from video; outside this lens's files]

## Open questions
- Which industry did Nataly actually pick? The forbidden topics/handoff triggers she read match tpl_otro_ventas exactly, so 'otro', 'event_planning' or 'construccion' — check tenant 'Go Entertainment SAS' settings.industry in prod.
- Was the fallback field really blank at 04:24 or pre-filled with tpl_otro_ventas's 'Déjame conectarte con un miembro del equipo…' (persona.service:2871)? The transcript says she 'had to guess'; the template has a value — either the editor does not surface it or she overwrote it.
- Does the readiness/assessment code count `appointments.pendingPrerequisites` as one of the '4 dependencias'? (owned by the health-panel lens)
- vertical-subtype-persona-contract.ts was not read (budget); reconcileVerticalSubtypePersonaRules (verticals.service:1948) may add rules for education subtypes — irrelevant for 'otro' but worth a check for the dance-as-education recommendation.