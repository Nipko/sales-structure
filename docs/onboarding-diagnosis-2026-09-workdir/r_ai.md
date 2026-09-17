# RESEARCH Topic A — How best-in-class AI-agent products take a non-technical owner from zero to "my agent answered" (Intercom Fin, Tidio Lyro, Chatbase, Gorgias, Zendesk, Crisp Hugo, Freshworks Freddy, ManyChat, Landbot, Decagon) + verification of the benchmark doc §2 numbers

## Patterns
### Sources-first, prompt-free creation: day 0 asks only for name/avatar/business intro + a URL or files; behaviour rules are optional 'Guidance/Instructions' later
- who: Crisp Hugo, Chatbase, Freshworks, Zendesk, Intercom Fin [documented]
- url: https://help.crisp.chat/en/article/getting-started-with-hugo-ai-agent-w6gbux/
- what: Crisp: Agent>Settings asks avatar, name and 'provide an introduction to your business'; Train asks 'specify your URL, start the import' (plus Q&A snippets, CSV/PDF/TXT); only afterwards Guidance>Instructions ('name it and write down your prompt') and Routing, both optional. Chatbase: 'New AI Agent' -> pick sources (Files/Text/Website/Q&A/Notion) -> 'Create Agent' (training 2-5 min), instructions live under Build later. Freshdesk: 'Create AI Agent' = name, avatar, primary language; knowledge = files (35MB, 200/agent) or public URLs (10/agent, 3000 pages); instructions split into two plain boxes ('your products, services, and typical customer scenarios' and 'high-level rules'). Zendesk: create = brand + knowledge sources -> name/tone/languages -> default replies; use cases/procedures/actions are step 4 optional.
- applicability: Parallly day-0 should ask for business name, what you sell, and a website/Instagram/PDF/FAQ; never a prompt. Persona/tone/rules move to the later configuration surface.
### Playground/test BEFORE any channel is connected, with an inline 'Add answer' / 'revise answer' loop that turns a failed test into a stored Q&A
- who: Tidio Lyro, Chatbase, Crisp Hugo, Intercom Fin, Gorgias, Freshworks [documented]
- url: https://chatbase.co/docs/user-guides/quick-start/response-quality.md
- what: Chatbase: 'revise answer' on a bad reply stores it as a Q&A source badge, answered verbatim thereafter. Tidio (search snippets only; help center 403): 4-step quick setup = data sources -> Playground -> handoff/channels -> live; in the Playground an unknown question shows 'Add answer' inside the test widget. Crisp: Evaluate>Playground 'validate your setup before going live'. Intercom: Fin AI Agent>Test with Good/Poor marking + export, and a live test scoped by audience rule 'Email contains yourdomain'. Gorgias: Test conversations with 'Show reasoning'. Freshdesk: test 'simulate real-world scenarios' + externally shareable preview link.
- applicability: The Parallly 'Probar agente' step must be the first win, reachable before Meta/WhatsApp, and every 'I don't know' answer must offer a one-click 'Enseñarle la respuesta' that persists as knowledge.
### Channel connection is the LAST step and is a per-channel on/off toggle with a celebratory 'go live' moment; pausing is one switch
- who: Intercom Fin, Crisp Hugo, Gorgias, Zendesk, Chatbase [documented]
- url: https://www.intercom.com/help/en/articles/8286630-deploy-fin-ai-agent-over-chat
- what: Intercom: after Train and Test, the deploy page has a single 'Set Fin Live' button; pause is a toggle under Deploy>Chat; an introduction message is required to trigger. Crisp: Agent>Activation 'Tick the Enable agent for new conversation option', 'Select your default target', optionally 'choose specific conversation channels'; AI conversations land in an 'Automated' inbox, escalations in the main inbox. Gorgias: Deploy = turn on per channel; skills have 'Publish a skill draft to replace its live version'. Chatbase: no draft/publish at all — 'disabled' = workspace-only, 'enabled' = public.
- applicability: Parallly should not gate testing on WhatsApp; connect WhatsApp as step 3 of 3, with a visible 'Encender en WhatsApp' switch and an 'Apagar' that never loses config. Hide draft/publish words; use encendido/apagado.
### Readiness is shown as actionable gaps, not a percentage: clustered unresolved questions + impact-ranked recommendations with 'Add new content' buttons
- who: Intercom Fin, Tidio Lyro Suggestions, Gorgias Analyze, Freshworks Improve tab [documented]
- url: https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin
- what: Intercom Analyze>Recommendations: four reasons (Add new content / Edit existing / Review contradictory / Review duplicate), each with an impact score 'ranked by impact so you can prioritize the fixes that improve the most conversations', accept/edit/reject, create snippet directly. Analyze>Unresolved questions (https://fin.ai/help/en/articles/10672146-analyze-unresolved-questions): AI-named clusters; unresolved = no answer, asked for team, or abandoned; sort by volume/language; 'Add new content' button; shows which content Fin tried and its last-modified date. Tidio: Q&A suggestions from past conversations arrive labeled source 'Inbox', disabled until reviewed (https://www.tidio.com/blog/lyro-ai-training/). Gorgias Analyze: handover rate, CSAT, automation rate, coverage by topic.
- applicability: The 'panel de salud del agente' should be a list of what the agent could not answer this week + one-click fixes, plus a short 'lo que tu agente ya sabe responder' summary; a bare progress bar or score without an action is weaker than these.
### Templates / 'Build it for me' as the empty state: pick a vertical preset or describe the business in one sentence, get a draft, test immediately
- who: Landbot, ManyChat, Gorgias starting skills [documented]
- url: https://help.landbot.io/article/a6l84s29zv-build-it-for-me
- what: Landbot new bot offers three doors: 'Build it for me' / 'Start from scratch' / 'Use a template' (https://help.landbot.io/article/jmyarmlbih-getting-started-build-a-bot). 'Build it for me' = one text field (max 1000 chars) with preset prompts (Lead Generation, E-commerce, Lead Gen Quiz) -> 'Generate' -> 'draft bot' -> 'Test this bot' button right away. Gorgias starting skills = highest-volume topics first (order tracking, hours, returns) (https://docs.gorgias.com/en-US/navigate-ai-agent-from-setup-to-going-live-1993179). ManyChat (help center 403, search snippets): manychat.com/template/{id} -> 'Install' -> 'Preview this flow'; installed templates under Settings>Extensions>Installed templates; IG entry points require the channel connected first.
- applicability: Parallly already has 18 verticals: the empty state should be 'Elige tu rubro' + 'cuéntame tu negocio en una frase', producing a pre-filled agent that is testable in the same screen.
### Hard prerequisites are stated up-front and small (e.g. >=10 public help articles, Messenger installed) rather than discovered mid-flow
- who: Intercom Fin [documented]
- url: https://www.intercom.com/help/en/articles/8286630-deploy-fin-ai-agent-over-chat
- what: Deploy Fin over chat lists prerequisites before any step: Messenger installed, at least 10 public Help Center articles, billing permission to accept terms. The Gorgias flow is likewise a fixed 4-stage rail Train -> Test -> Deploy -> Analyze.
- applicability: The 48-min video failed on late-discovered Meta prerequisites; Parallly should show a 'necesitarás' card (número de WhatsApp, acceso a Facebook Business, tarjeta en la WABA) before the connect step, never inside it.
### Enterprise agents (Decagon/Sierra) test with simulated personas and pass/fail regression suites, but onboarding is sales-led over weeks — not a self-serve reference
- who: Decagon (Sierra: no public docs opened) [observed_secondhand]
- url: https://decagon.ai/blog/decagon-simulations
- what: Decagon autogenerates personas from failed historical transcripts; each simulation batch gives pass/fail with 'full traceability' and a Trace View; run before go-live, after launch and before AOP/knowledge changes. Search-only: Decagon onboarding ~6 weeks, Sierra ~90 days, no self-serve signup.
- applicability: Useful only for the internal quality centre (docs/agent-quality-center.md), not for the novice path.

## Metrics
- Chatbase initial training time after 'Create Agent': 2-5 minutes — https://chatbase.co/docs/user-guides/quick-start/your-first-agent.md — caveat: Vendor doc; depends on source size
- Intercom Fin prerequisite before deploy over chat: >= 10 public Help Center articles — https://www.intercom.com/help/en/articles/8286630-deploy-fin-ai-agent-over-chat — caveat: Vendor prerequisite, not an outcome metric
- Freshdesk AI agent knowledge limits: 10 public URLs / 3,000 pages; 200 files of 35 MB — https://support.freshdesk.com/support/solutions/articles/50000011519-set-up-ai-agent — caveat: Plan-dependent limits
- Decagon sales-led onboarding duration: ~6 weeks (Sierra ~90 days) — https://www.eesel.ai/blog/decagon-vs-sierra — caveat: Third-party comparison blog found via search; not opened with WebFetch

## Anti-patterns
- Asking for the WhatsApp/Meta connection before the owner has seen the agent answer anything (every vendor above tests first, connects last).
- Exposing a free-text prompt as the first configuration step (all vendors put instructions after sources; Freshdesk splits them into two plain-language boxes).
- A readiness percentage with no attached action; vendors show clustered unresolved questions and impact-ranked fixes instead.
- Draft/publish/version vocabulary for novices (Chatbase avoids it entirely; Gorgias confines 'Publish a skill draft' to the skills editor).
- Surfacing prerequisites (business verification, card on WABA, >=N articles) mid-flow instead of on a pre-step card.
- Blank empty state without a vertical template or 'describe your business' generator.

## Prior doc claims checked
- [unverifiable] Tidio: 'El 72% de los usuarios abandonaba antes de terminar' building 30-node decision trees (§2 line 29) — https://www.tidio.com/blog/lyro-ai-training/
- [unverifiable] Wati: 'Si pides Meta en el minuto 2, el 60% de los usuarios abandona' (§2 line 74) — https://support.wati.io/en/articles/11462428-prerequisites-before-you-get-started-with-wati
- [unverifiable] Calendly: 'El 85% de los usuarios nunca toca la configuración avanzada de buffers' (§2 line 83) — 
- [contradicted] Duolingo: showing 25% pre-filled progress raises completion to 89% (§2 line 84) — https://relaunch.ai/blog/duolingo-onboarding-teardown-7-b-tests-behind-their-9-conver.html

## Sources
- Intercom — Deploy Fin AI Agent over chat — https://www.intercom.com/help/en/articles/8286630-deploy-fin-ai-agent-over-chat — Prereqs, Train/Test/Set Fin Live, pause toggle, live test by audience rule
- Intercom — AI-powered content recommendations — https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin — Recommendations reasons, impact score, actions
- Fin — Analyze unresolved questions — https://fin.ai/help/en/articles/10672146-analyze-unresolved-questions — Clusters, definition of unresolved, Add new content
- Chatbase — Your first agent — https://chatbase.co/docs/user-guides/quick-start/your-first-agent.md — Create -> sources -> train -> playground -> deploy; enabled/disabled instead of publish
- Chatbase — Response quality — https://chatbase.co/docs/user-guides/quick-start/response-quality.md — 'revise answer' stored as Q&A
- Gorgias — Navigate AI Agent from setup to going live — https://docs.gorgias.com/en-US/navigate-ai-agent-from-setup-to-going-live-1993179 — Train/Test/Deploy/Analyze rail, starting skills, show reasoning, skill draft publish
- Zendesk — Getting started with AI agents — https://support.zendesk.com/hc/en-us/articles/8724978128282-Getting-started-with-AI-agents — Create steps; advanced use cases optional
- Crisp — Getting started with Hugo AI Agent — https://help.crisp.chat/en/article/getting-started-with-hugo-ai-agent-w6gbux/ — Settings -> Train -> Guidance -> Playground -> Activation
- Freshdesk — Set up AI Agent — https://support.freshdesk.com/support/solutions/articles/50000011519-set-up-ai-agent — 8-step setup, knowledge limits, preview link, channel mapping (Freshchat article 403; same Freddy product)
- Tidio blog — Lyro AI training — https://www.tidio.com/blog/lyro-ai-training/ — Data sources, Q&A suggestions from Inbox disabled until reviewed (help.tidio.com returned 403 x5)
- Landbot — Getting started build a bot — https://help.landbot.io/article/jmyarmlbih-getting-started-build-a-bot — Three entry doors, builder basics
- Landbot — Build it for me — https://help.landbot.io/article/a6l84s29zv-build-it-for-me — 1000-char description, presets, Generate, draft bot, Test this bot
- Decagon — Simulations — https://decagon.ai/blog/decagon-simulations — Persona simulations, pass/fail, Trace View
- ManyChat help (NOT fetched — 403 x3; search snippets only) — https://help.manychat.com/hc/en-us/articles/14281251748508-How-to-install-Manychat-templates — Install / Preview this flow / Installed templates location — low confidence
- Relaunch — Duolingo onboarding teardown (search snippet) — https://relaunch.ai/blog/duolingo-onboarding-teardown-7-b-tests-behind-their-9-conver.html — Duolingo figures are 8.9% conversion and +20% from endowed progress, not 89%