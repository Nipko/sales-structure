# RESEARCH C — Onboarding and setup-health playbook for non-technical SaaS users, with evidence (progressive disclosure, endowed progress, checklists, next-best-action, help systems, configuration-health surfaces, benchmarks)

## Patterns
### Progressive disclosure: show only the few most important options first; defer the rest to a second level, never more than two levels deep
- who: Nielsen Norman Group (Nielsen, 2006) [documented]
- url: https://www.nngroup.com/articles/progressive-disclosure/
- what: Initial screen shows a small set of high-priority options; secondary options behind an explicit 'more' action. More than two levels of disclosure disorients users. Distinguishes staged disclosure (wizard, linear) from progressive disclosure (branching).
- applicability: Parallly's guided path should expose 3-5 fields per step (business name, WhatsApp, one service) and push persona tone, buffers, multi-calendar etc. to the later configuration surfaces.
### Wizards for infrequent setup: label every step, highlight current step, reuse previous answers as defaults, allow exit-and-resume with state saved
- who: Nielsen Norman Group (wizards article) [documented]
- url: https://www.nngroup.com/articles/wizards/
- what: Wizards fit novices and infrequent processes like configuration; show a step list with current step highlighted and completed steps marked; do not let users skip ahead; allow exiting midway with state saved and resuming later; prefill defaults from prior use.
- applicability: The 48-min recording ended with WhatsApp unconnected: the wizard must persist partial progress (autosave per step) so a dropped Embedded Signup does not lose the persona/service data entered before.
### Smart defaults: users overwhelmingly keep defaults, so pre-populate the most common value and choose defaults that educate and prevent errors
- who: Nielsen Norman Group (The Power of Defaults; cites Joachims et al. 2005 eye-tracking) [documented]
- url: https://www.nngroup.com/articles/the-power-of-defaults/
- what: Joachims 2005: 42% click top result, and after swapping the top two results the top position still got 34% — position/default drives behavior. Recommendations: prepopulate predictable fields, avoid arbitrary/alphabetical defaults, optimize the default configuration since most users never change it.
- applicability: Vertical bootstrap (18 industries) should ship a working default persona, hours 24/7 or business-hours, and at least one availability slot so the agent answers on first message with zero extra config (the audit found verticals shipping without availability_slots).
### Inline validation on blur with positive confirmation, error message adjacent to the field
- who: Baymard Institute (2024) and Nielsen Norman Group (Krause 2019/2024) [documented]
- url: https://baymard.com/blog/inline-form-validation
- what: Baymard: 31% of benchmarked sites lack inline validation; validate after the user leaves the field (not on keystroke); show green positive validation to build confidence. NN/g errors-forms guideline 7 says the same and places the error next to the field.
- applicability: Phone number, WABA display name, and service price fields in the onboarding wizard should validate on blur with a green check; never block progression with a page-level error list.
### Onboarding tutorials/tours that interrupt (push revelations) are ignored and do not improve performance; contextual pull revelations do
- who: Nielsen Norman Group (Laubheimer 2023; Help & Documentation heuristic #10; adaptive help) [documented]
- url: https://www.nngroup.com/articles/onboarding-tutorials/
- what: Tutorials interrupt the task, are forgotten, and do not improve performance; prefer contextual tips triggered by user behavior, keep proactive help brief, easy to dismiss and re-findable later. Adaptive-help article adds: only use predictive help if accuracy is high because users learn to ignore bad suggestions; tooltips for simple, overlay for medium, full page for complex questions. No participant counts reported.
- applicability: Parallly's 15 guided tours should never auto-start; expose them via a 'Mostrarme cómo' launcher and per-screen contextual tips tied to the actual field.
### Teaching empty states: state system status, offer a pull revelation, and a direct button/path to populate (including a demo-data path)
- who: Nielsen Norman Group (empty state interface design) [documented]
- url: https://www.nngroup.com/articles/empty-state-interface-design/
- what: Empty states must say whether content is loading/absent/error, teach the feature in context, and give a direct pathway to the key task; Loggly offers two paths — add real source or explore with demo data.
- applicability: Empty Inbox, empty Knowledge Base and empty Calendar should each carry one primary action ('Enviar un mensaje de prueba', 'Subir tu lista de precios') and a demo/simulation path ('Probar agente').
### Endowed progress: artificially advancing users toward a goal raises completion (car wash 19% vs 34% over 9 months, 300 cards)
- who: Nunes & Drèze 2006, Journal of Consumer Research 32(4) — read via Coglode summary [observed_secondhand]
- url: https://www.coglode.com/nuggets/endowed-progress-effect
- what: 300 car-wash customers; 8-stamp card 19% completion vs 10-stamp card with 2 pre-stamped 34% over 9 months, same required effort. Primary paper (OUP/SSRN) could not be opened; no replication data located in this pass.
- applicability: Show the setup checklist already partially complete after signup ('2 de 6 listos': cuenta creada, vertical elegida) rather than 0%. Do not cite the Duolingo '25%->89%' number — no source found.
### Progress indicators: visible progress raises satisfaction and patience; bars should accelerate near the end; +12% tour completion with progress cues
- who: Nielsen Norman Group (progress indicators) and Chameleon 2025 benchmark [documented]
- url: https://www.nngroup.com/articles/progress-indicators/
- what: NN/g cites a University of Nebraska-Lincoln study: users seeing a moving bar were willing to wait ~3x longer; recommends percent-done for >10s and bars that speed up toward the end. Chameleon report: progress indicators raised tour completion ~12%.
- applicability: Show 'x de y pasos' in the onboarding header (Shopify pattern) and step dots inside each tour.
### Disappearing setup guide: checklist replaces the dashboard until launch, then disappears; 3 essential steps; one step expanded at a time; toast on completion; dismissible
- who: Shopify (App Home setup-guide pattern + Shopify Home help) [documented]
- url: https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide
- what: Setup guide = collapsible container with title, description and 'x out of y steps completed'; only one step expands at a time; each step has checkbox, label, one paragraph, illustration, primary/secondary buttons; toast on completion; dismiss X; recommends 3 essential steps. Shopify Home shows setup tasks instead of metrics while the store is in private mode; after launch the home shows metrics and cards.
- applicability: Parallly's 'tarjeta de puesta en marcha' should be the only progress source, occupy the dashboard until the first real reply, then collapse into the health panel.
### Next-best-action cards with a strict budget and expiry; critical operational cards cannot be dismissed
- who: Shopify Home (Sidekick Pulse, Insights, Home cards) [documented]
- url: https://help.shopify.com/en/manual/shopify-admin/shopify-home
- what: Home cards are dismissible via X/swipe except cards containing order tasks; Insights are capped at 3 per day and expire after 24h, only for stores with >=10 orders/week over 6 months; Sidekick Pulse shows proactive next-best-action cards from store data; a permanent 'Discover more' section cannot be dismissed.
- applicability: Health panel: max 3 recommendations visible, 24h expiry for soft ones, non-dismissible only for 'el agente no puede responder' class items (WhatsApp disconnected, token expired, no availability).
### One guide at a time via per-user rate limits; critical alerts exempt; user-launched tours exempt; rate limit overrides snooze/recurrence
- who: Chameleon (help center + 2025 benchmark) [documented]
- url: https://help.chameleon.io/en/articles/3513345-using-rate-limits-to-manage-experiences-frequency
- what: Rate limits cap unique experiences per user per timeframe; microsurveys evaluated before tours; critical experiences (status alerts) can be excluded and do not count; tours launched by the user from a launcher are never rate-limited; rate limits take priority over recurrence and snoozing. Benchmark: user-triggered tours ~51% completion vs 39% for set-delay; launcher/checklist-driven tours 67% vs 31% non-launcher.
- applicability: Implement a per-tenant-user 'one proactive nudge per session' budget in the dashboard; tours reachable from the help launcher bypass it; connection-down alerts bypass it.
### Tour length: completion falls steadily with steps — ~65% at 1 step, ~50% at 4, under 40% past 5 (Chameleon); 1-3 steps ~30% vs ~15% for 10+ (Pendo 2016)
- who: Chameleon 2025 benchmark (550M+ interactions) and Pendo (2016) [documented]
- url: https://www.chameleon.io/benchmark-report
- what: Chameleon report page numbers: 1-step ~65%, 2-step ~60%, 3-step ~55%, 4-step ~50%, 5+ <40%. Pendo 2016 blog: 1-3 step walkthroughs ~30%, >10 steps ~2x lower, no sample size. Chameleon blog posts quote different figures (72%/74%/16%) — inconsistent, use the report page.
- applicability: Cap every Parallly tour at 4 steps; split the 15 tours accordingly.
### Modal content: text-only modals complete more than text+video; embeddable cards get 1.5x CTA clicks vs modals; keep copy <=26 words
- who: Chameleon 2025 benchmark [documented]
- url: https://www.chameleon.io/benchmark-report
- what: Modal completion: text-only 44%, text+image 29%, text+video 21%; 37.5% average dismiss; 38% close within 4 seconds. Embeddable cards with images beat all tour engagement metrics.
- applicability: Do not front-load onboarding with an explainer video modal; use inline cards with one sentence and one button. Videos belong in the reactive help panel.
### AI-agent content readiness as a checklist of content factors plus budgeted, reviewable recommendations (impact score, accept/reject/edit, weekly batch of up to 20)
- who: Intercom Fin [documented]
- url: https://www.intercom.com/help/en/articles/7860255
- what: 14-factor readiness guidance (jobs-to-be-done titles, disambiguation, self-contained sections, alt text...), prioritize by last-updated and high-traffic content, Optimize dashboard surfaces high-volume + low-CX-score topics. Content-gap recommendations (article 11394959) are cards with an Impact score, summary and source conversations; accept/reject/edit with red/green diff; duplicates/contradictions computed weekly, up to 20 new recommendations each Monday.
- applicability: Parallly's health panel for the Knowledge Base: 'huecos' cards from unanswered conversations with an impact count, accept/edit/reject, refreshed weekly in a capped batch rather than a live stream.
### AI agent performance dashboard leads with 3 numbers: total conversations, automated resolution %, escalated %
- who: Zendesk AI agents [documented]
- url: https://support.zendesk.com/hc/en-us/articles/9748041653658
- what: Performance landing shows total conversations, automated resolutions %, escalated %, per agent/channel; readiness is handled via content strategies (article 7849915550618: analyze tickets, macros, existing docs, community, structure for AI) without a dedicated gap feature; readiness and performance are not separated as surfaces.
- applicability: Separate 'listo para operar' (readiness: connection, persona, availability, KB) from 'cómo va' (performance: respondidas, escaladas, reservas) — Zendesk's conflation is the gap to avoid.
### Configuration score 0-100 with per-recommendation uplift, Apply/Dismiss, dismissed items may reappear — and the known failure: dismissing counts the same as applying
- who: Google Ads optimization score; criticism by Search Engine Land (Saskin Gales, 2025-12-10) [documented]
- url: https://searchengineland.com/google-ads-recommendations-auto-apply-465909
- what: Official page: score 0-100%, each recommendation shows 0.1-100% score uplift, Apply/Apply all/Dismiss; dismissed may reappear. Criticism: dismissing gives the exact same uplift as applying, so 100% is reachable by dismissing everything; the score measures review, not performance; auto-apply makes unreviewed changes.
- applicability: If Parallly shows a health score, dismissals must not raise it; the score must derive from verified state (webhook received, test message answered), never from 'recommendation reviewed'.
### Lighthouse-style scorecard: weighted metrics, 3 color bands (0-49 red, 50-89 orange, 90-100 green), opportunities/diagnostics listed but not counted in the score
- who: Google Lighthouse [documented]
- url: https://developer.chrome.com/docs/lighthouse/performance/performance-scoring
- what: Score = weighted sum of metric scores mapped through log-normal curves; three bands; 'Opportunities' and 'Diagnostics' sections show what to fix with estimated savings but do not affect the score.
- applicability: Health panel vocabulary: 3 bands only (Rojo: el agente no responde / Naranja: responde pero pierde ventas / Verde: listo), with a separate 'Oportunidades' list that does not move the band.
### Account-health surface grouped by layer, urgency tier and compliance-vs-performance; only 'restricted' halts delivery; 'Request review' as the single action
- who: Meta Account Quality (third-party description; official Meta help pages returned title only) [observed_secondhand]
- url: https://goodmorningco.com/blog/meta-ads-account-quality-notifications
- what: Six statuses (Restricted/Disabled, Ad rejected, Below-average relevance, Low feedback score, Verification needed, Healthy); grouped by ad account / business portfolio / profile, by urgency (act today / this week / monitor) and by compliance vs performance; only restrictions stop delivery. Official pages 420781298634337 and 975570072950669 could not be fetched (locale/title-only), so mechanics are secondhand.
- applicability: Model Parallly channel health the same way: 'Desconectado' (stops replies) vs 'Advertencia' (quality/rate) vs 'Verificación pendiente', with one action per row.
### HubSpot Getting Started is a static topic hub; its in-app setup checklist/recommendations mechanics are not documented in the knowledge base
- who: HubSpot [inferred]
- url: https://knowledge.hubspot.com/get-started
- what: Nine topic areas (account setup, CRM, lead gen, sales, service, website, reporting, automation, glossary); no description of in-app progress tracking, checklist, or recommendation engine. Two deeper URLs returned 404.
- applicability: Do not model the health panel on 'HubSpot Recommendations' — no verifiable mechanics found; rely on Shopify/Intercom/Meta patterns instead.
### Help tied to UI: NN/g recommends help categorized by user task, in-context (tooltip -> overlay -> full page by complexity); no primary source found for 'single source of truth between UI labels and help text' as a studied practice
- who: Nielsen Norman Group (adaptive help; help & documentation) [inferred]
- url: https://www.nngroup.com/articles/pop-up-adaptive-help/
- what: User-initiated overlays, front-loaded keywords, retain search, movable/closable windows; predictive help only if highly accurate. The label-to-help single-source practice appears only in design-system/single-source-publishing material (search results), not as an evidence-backed UX study.
- applicability: Generate per-screen help from the same i18n keys as the labels (4 JSON files) so help never names a button that no longer exists — treat this as engineering hygiene, not as an evidence-backed UX claim.

## Metrics
- Activation rate (median): 37.5% — https://userpilot.com/blog/saas-product-metrics-benchmark-report/ — caveat: Userpilot 2025 report, 547 companies overall but n=62 for this metric; data from Userpilot customers' dashboards (selection bias); SLG 40.4% vs PLG 34.7%.
- Onboarding checklist completion rate: 19.2% — https://userpilot.com/blog/saas-product-metrics-benchmark-report/ — caveat: Userpilot 2025, n=188; measures checklists built in Userpilot, not native product setup flows.
- Time to value (median): 1 day 12 hours — https://userpilot.com/blog/saas-product-metrics-benchmark-report/ — caveat: Userpilot 2025, n=62; TTV definition set by each customer.
- Core feature adoption / Month-1 retention: 24.5% / 46.9% — https://userpilot.com/blog/saas-product-metrics-benchmark-report/ — caveat: n=181 and n=83 respectively; self-selected Userpilot customers.
- Tour completion by step count: 1 step ~65%, 4 steps ~50%, 5+ steps <40% — https://www.chameleon.io/benchmark-report — caveat: Chameleon 2025, 550M+ interactions from Chameleon customers; blog posts by the same vendor quote different numbers (72%/74%/16%).
- Checklist-launched vs non-launched tour completion: 67% vs 31% — https://www.chameleon.io/benchmark-report — caveat: Same Chameleon dataset; user-triggered tours 51% vs set-delay 39%; no company count disclosed.
- Modal completion by content type: text-only 44%, text+image 29%, text+video 21%; 37.5% dismiss — https://www.chameleon.io/benchmark-report — caveat: Chameleon customer data; content type correlates with message purpose, not causal.
- Walkthrough completion 1-3 steps vs >10 steps: ~30% vs ~15% — https://www.pendo.io/pendo-blog/state-walkthroughs-pendo/ — caveat: Pendo, October 2016, no sample size disclosed; the '2-4 steps ~50%, 8 steps 45%' figures circulate from another Pendo post that returned 404.
- Endowed progress completion: 19% (8-stamp) vs 34% (10-stamp, 2 pre-stamped) over 9 months — https://www.coglode.com/nuggets/endowed-progress-effect — caveat: Nunes & Drèze 2006, 300 cards, car wash; primary paper not opened (OUP served wrong article, SSRN 403).
- Activation rate range: 20-30% at standout PLG companies (2022); '20-40% normal' — https://openviewpartners.com/2022-product-benchmarks/ — caveat: UNVERIFIABLE in this pass: OpenView 2023 report page returned 404; values are from search snippets (2023 report ~1,000 participants).
- Appcues 'healthy' activation and checklist thresholds: activation 25-50%; checklist completion <30% signals friction — https://www.appcues.com/blog/user-onboarding-metrics — caveat: Opinion ranges without cited sample; the widely quoted '3-step 72% vs 7-step 16%' is NOT in this article.
- Sites lacking inline form validation: 31% — https://baymard.com/blog/inline-form-validation — caveat: Baymard e-commerce checkout benchmark (2024); not SaaS onboarding.
- Progress feedback effect on waiting: ~3x longer willingness to wait — https://www.nngroup.com/articles/progress-indicators/ — caveat: University of Nebraska-Lincoln study cited by NN/g; about wait tolerance, not setup completion.
- Investment wager effect on D7 retention (Duolingo): +14% — https://growth.design/case-studies/duolingo-user-retention — caveat: Growth.Design case study relaying a Duolingo claim; no methodology.

## Anti-patterns
- Health/optimization score that rises when a recommendation is dismissed (Google Ads): the score ends up measuring review activity, not whether the agent can answer; derive Parallly's score only from verified state.
- Auto-applying recommendations without review (Google Ads auto-apply): changes to persona/hours/availability must never be applied silently.
- Push tutorials/tours at first login (NN/g): ignored, interrupt the task, not remembered; the 48-min recording is a live example of explanation replacing progress.
- Video or image-heavy modals in the setup path (Chameleon: text+video modals complete at 21% vs 44% text-only).
- Tours longer than 4 steps (Chameleon/Pendo: completion halves).
- Multiple simultaneous nudges/tours (Chameleon rate limiting exists precisely because overlap kills completion); no budget = alarm fatigue.
- Unbounded recommendation streams: Shopify caps insights at 3/day with 24h expiry; Intercom batches up to 20 per week.
- Dismissible critical cards: Shopify forbids dismissing order-task cards; Meta makes 'restricted' the only status that halts delivery — Parallly must not let 'WhatsApp desconectado' be snoozed away.
- Conflating readiness with performance in one dashboard (Zendesk shows resolution % without a 'can it answer at all' readiness state).
- Starting the checklist at 0% (forfeits endowed progress) and keeping it visible forever after launch (Shopify hides setup tasks once the store is live).
- Progress state stored in several places with no authority (July onboarding audit); the checklist must be the single source of progress.
- Citing unsourced numbers in the internal docs: 'Tidio 72%', 'Wati 60%', 'Calendly 85%', 'Duolingo 25%->89%' — none traceable to a primary source.

## Prior doc claims checked
- [contradicted] Tidio: 72% of users abandoned decision-tree onboarding (docs/onboarding-ux-benchmark-and-video-audit.md L29) — https://userguiding.com/blog/user-onboarding-statistics
- [unverifiable] Wati: 60% abandon if Meta verification is asked in minute 2 (L74) — https://support.wati.io/en/articles/11462949-troubleshooting-embedded-signup-process-common-issues-and-how-to-resolve-them
- [unverifiable] Calendly: 85% of users never touch buffers (L83) — 
- [contradicted] Duolingo: starting the progress bar at 25% raised completion to 89% (L84, presented as endowed progress) — https://growth.design/case-studies/duolingo-user-retention
- [verified] Endowed progress effect exists (Nunes & Drèze 2006, 19% vs 34%) — https://www.coglode.com/nuggets/endowed-progress-effect
- [verified] Userpilot 2025: activation 37.5%, checklist completion 19.2% — https://userpilot.com/blog/saas-product-metrics-benchmark-report/
- [unverifiable] Appcues: 3-step tours 72% vs 7-step 16% completion — https://www.appcues.com/blog/user-onboarding-metrics
- [verified] Chameleon: tours launched from a checklist complete at 67% — https://www.chameleon.io/benchmark-report
- [unverifiable] HubSpot has a documented in-app setup checklist / Recommendations surface — https://knowledge.hubspot.com/get-started

## Sources
- NN/g Progressive Disclosure — https://www.nngroup.com/articles/progressive-disclosure/ — few options first, max two levels, staged vs progressive
- NN/g Onboarding Tutorials — https://www.nngroup.com/articles/onboarding-tutorials/ — tutorials interrupt and don't improve performance; pull revelations
- NN/g Errors in Forms — https://www.nngroup.com/articles/errors-forms-design-guidelines/ — validate on blur, error adjacent to field
- Baymard Inline Form Validation — https://baymard.com/blog/inline-form-validation — 31% lack inline validation; positive validation
- NN/g Wizards — https://www.nngroup.com/articles/wizards/ — step labels, defaults from prior use, exit-and-resume
- NN/g The Power of Defaults — https://www.nngroup.com/articles/the-power-of-defaults/ — Joachims 2005 numbers; default design rules
- NN/g Empty State Interface Design — https://www.nngroup.com/articles/empty-state-interface-design/ — status + pull revelation + direct path/demo data
- NN/g Progress Indicators — https://www.nngroup.com/articles/progress-indicators/ — 3x wait tolerance; accelerate near end
- NN/g Help and Documentation (heuristic 10) — https://www.nngroup.com/articles/help-and-documentation/ — push vs pull help, brief/dismissable/re-findable
- NN/g Pop-ups and Adaptive Help — https://www.nngroup.com/articles/pop-up-adaptive-help/ — user-initiated overlays; tooltip/overlay/full-page ladder
- Coglode Endowed Progress Effect — https://www.coglode.com/nuggets/endowed-progress-effect — Nunes & Drèze 2006 summary: 300 cards, 19% vs 34%
- Growth.Design Duolingo case study — https://growth.design/case-studies/duolingo-user-retention — streaks, progress bars, +14% D7 wager; no 25%->89% claim
- Shopify App Home setup-guide pattern — https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide — checklist anatomy, one step expanded, 3 essential steps, toast, dismiss
- Shopify Home page help — https://help.shopify.com/en/manual/shopify-admin/shopify-home — setup tasks replace metrics pre-launch; card dismiss rules; 3 insights/day 24h expiry; Sidekick next-best actions
- HubSpot Get Started hub — https://knowledge.hubspot.com/get-started — static topic hub; no in-app checklist mechanics
- Google Ads About optimization score — https://support.google.com/google-ads/answer/9061546 — 0-100%, uplift per recommendation, apply/dismiss, dismissed may reappear
- Search Engine Land — Google Ads recommendations and auto-apply — https://searchengineland.com/google-ads-recommendations-auto-apply-465909 — dismiss = same uplift; score measures review not performance
- Lighthouse performance scoring — https://developer.chrome.com/docs/lighthouse/performance/performance-scoring — weighted log-normal score, 3 bands, opportunities not scored
- Intercom — Optimizing content for Fin — https://www.intercom.com/help/en/articles/7860255 — 14 readiness factors, prioritization by traffic/last-updated
- Intercom — Fin content recommendations — https://www.intercom.com/help/en/articles/11394959 — impact score cards, accept/reject/edit, weekly batch up to 20
- Zendesk AI agents performance dashboard — https://support.zendesk.com/hc/en-us/articles/9748041653658 — total conversations / automated resolution % / escalated %
- Zendesk — 5 strategies for help center content for AI — https://support.zendesk.com/hc/en-us/articles/7849915550618-5-strategies-for-building-up-your-help-center-content-for-AI — content strategies; no dedicated gap feature
- GoodMorning — Meta Account Quality statuses (third-party) — https://goodmorningco.com/blog/meta-ads-account-quality-notifications — 6 statuses, grouping by layer/urgency/compliance vs performance
- Meta Business Help — About Quality Check (FAILED: title only) — https://www.facebook.com/business/help/420781298634337 — fetch returned only the page title
- Meta Business Help — About Advertising Restrictions (FAILED: title only) — https://www.facebook.com/business/help/975570072950669 — fetch returned only the page title
- Userpilot 2025 SaaS Product Metrics Benchmark — https://userpilot.com/blog/saas-product-metrics-benchmark-report/ — 547 companies; activation 37.5% (n=62), checklist 19.2% (n=188), TTV 1d12h
- Chameleon User Onboarding Benchmark Report 2025 — https://www.chameleon.io/benchmark-report — 550M+ interactions; tour/checklist/modal/launcher numbers
- Chameleon — Using Rate Limits — https://help.chameleon.io/en/articles/3513345-using-rate-limits-to-manage-experiences-frequency — per-user experience cap, critical exclusions, user-triggered exempt
- Appcues — user onboarding metrics (Detrik 2026-05-08) — https://www.appcues.com/blog/user-onboarding-metrics — activation 25-50%, checklist <30% = friction; opinion ranges
- Pendo — State of Walkthroughs (2016) — https://www.pendo.io/pendo-blog/state-walkthroughs-pendo/ — 1-3 steps ~30%, >10 steps ~2x lower; no sample size
- OpenView 2022 Product Benchmarks (search snippet only; 2023 page 404) — https://openviewpartners.com/2022-product-benchmarks/ — activation 20-30% at standout PLG — unverified
- UserGuiding onboarding statistics roundup (source of the generic '72%' figure) — https://userguiding.com/blog/user-onboarding-statistics — '72% abandon apps if too many steps' — no primary source, not Tidio