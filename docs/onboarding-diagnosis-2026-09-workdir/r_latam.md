# RESEARCH B — WhatsApp-first LatAm platforms and the Meta Embedded Signup wall (Wati, Kommo, Leadsales, Cliengo, Treble, Botmaker, Zenvia, Yalo, respond.io, Callbell, Chatfuel, Interakt, AiSensy, Gallabox + Meta primary docs)

## Patterns
### Meta ESU popup is a fixed 8-screen sequence; the partner only controls what happens before and after
- who: Meta (Embedded Signup docs) [documented]
- url: https://developers.facebook.com/docs/whatsapp/embedded-signup
- what: Popup = Facebook login → ToS → API pick → asset grants → portfolio select/create → WABA select/create → phone entry + OTP verify → display name. Returns WABA id, phone number id, exchange code. Ends with 'View your setup guide'. Meta documents NO popup-blocked/browser failures — partners fill that gap themselves.
- applicability: Parallly cannot shorten the wall; it can only pre-flight (checklist before opening) and post-flight (interpret the result). Everything Nataly hit inside the popup is Meta-owned.
### Free '+1 555' business numbers inside ESU: a real 'try without your number' path, auto-verified, no OTP
- who: Meta ESU overview; Wati [documented]
- url: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- what: Eligible businesses can 'claim up to two 555 business phone numbers' in the ESU popup, auto-verified (+1 555), display name still needs approval. Wati exposes this as a 3rd choice ('I will be using Meta's free number'): no OTP, but no campaigns/tiers/green tick, 'switch as soon as possible' (https://support.wati.io/hc/en-us/articles/12332675). Non-Solution-Partner customers must attach a payment method before messaging.
- applicability: Strongest candidate for Parallly's 'connect later / test first' path: let the owner finish ESU with a 555 number, have the agent answer a real WhatsApp message in minute 5, migrate to the real number later.
### Coexistence (keep the WhatsApp Business app, add the API) is the default recommended path for existing SMBs, but with eligibility and history gotchas
- who: Meta; Wati; Kommo; respond.io; Gallabox; Callbell [documented]
- url: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- what: Meta: app ≥2.24.17; flow is code/QR → in-app 'Connect to the Business Platform' → confirm history share; 20 mps fixed; groups/calls/broadcast/view-once unsupported; error 131060 on first message resolves in seconds. Kommo: 'New WhatsApp Business app accounts are not immediately eligible' (tenure + quality, Meta's sole decision); only last 30 days imported; 'Connected' after 10-15 min (https://support.kommo.com/docs/whatsapp-business-app-connect). Wati: 6 months 1:1 + 2 weeks media; skipping sync = 'offboard and onboard again'; 'Do not add a payment method to your WABA' (https://support.wati.io/hc/en-us/articles/11822421). respond.io: open the app every 14 days; echo messages don't trigger automation. Gallabox: 'This decision cannot be changed later' on history; 14+ days offline severs. Callbell/Kommo: excluded regions list (EU/UK/AU/JP/NG/PH/RU/KR/ZA/TR) — LatAm is fine.
- applicability: Parallly already ships coexistence; the missing piece is the plain-language warning set: brand-new Business-app accounts may be refused, history choice is one-shot, keep the phone online, app-sent messages won't wake the agent.
### 'What you need' checklist in question form, shown BEFORE the popup
- who: Treble; respond.io; Gallabox; Jelou; Kommo; Leadsales [documented]
- url: https://help.treble.ai/
- what: Treble: 6-step readiness list phrased as questions ('¿Tu línea telefónica está lista para recibir un código...?'). respond.io: SMS/call OTP, delete existing WA account, Business Manager admin, website, USD currency. Gallabox: 4 items (FBM, number not on other API, SIM active for OTP, Meta verification optional). Jelou: 'La SIM Card (chip celular) debe estar en un teléfono activo'. Leadsales: 'Meta Verified es un plus, no un requisito'. Kommo: 'One phone number can only be connected to one Kommo account'.
- applicability: Direct template for Parallly's pre-ESU card: 3-5 yes/no questions in Spanish, the SIM-in-hand one first, 'verificación de Meta NO es requisito' to kill a common fear.
### Error-code-to-action table for ESU failures (the thing Meta does not publish)
- who: Wati; respond.io [documented]
- url: https://support.wati.io/hc/en-us/articles/11462949
- what: Wati maps each ESU stage to Meta errors: 'This number is registered to an existing WhatsApp account' → delete or use Coexistence; 'Something has gone wrong' → Chrome/Edge desktop + enable pop-ups; 2FA required (2859009); too many OTP guesses → wait 12h; repeated failures → 72h lockout. respond.io lists 5: WABA connected elsewhere, permission #10, #133006 re-verify, display name rejected, 'Continue to feature setup' (https://help.respond.io/). Meta primary confirms: number already on WhatsApp must be deleted first, 2-step PIN must be set (https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers).
- applicability: Parallly should own an equivalent table in-product (not a help article): detect popup close without code → show 'pop-ups bloqueados / usa Chrome en computador'; detect 'number registered' → offer coexistence in one click.
### Trial without your number = sandbox/temporary number with hard caps (Interakt), NOT a browser bot tester
- who: Interakt; Wati; AiSensy [documented]
- url: https://www.interakt.shop/resource-center/
- what: Interakt: 14-day trial auto-provisions a temp number + sandbox join code (QR/prefilled message); 2 unique users/day, 2 notifications/day, 2 contacts; exit by connecting own number. Wati's 'Test Chatbot' requires an already-connected business number (you message it from your personal phone) — free, but not pre-Meta (https://support.wati.io/en/articles/11463032); 7-day trial is 'limited to your own number' (https://support.wati.io/en/articles/11462976). AiSensy: 14-day Pro trial + 500 AI msgs; 'sandbox' mentioned only in marketing snippet (https://aisensy.com/whatsapp-business-api).
- applicability: Parallly's web-chat widget + 'Probar agente' already beats most of these; the gap is a WhatsApp-shaped test (a Parallly-owned sandbox number the owner messages, Interakt-style) so the first win is on the channel the owner cares about.
### Post-connect 'send yourself a message' as the activation moment
- who: respond.io; Gallabox; Kommo [documented]
- url: https://help.respond.io/
- what: respond.io quick start ends with 'send a test message ... WhatsApp.me link' then reply from the Inbox. Gallabox post-connect: set greeting/away/hours + check status & limits. Kommo: shows 'Connected' and a data-import message in the widget; no test step documented. Meta ESU itself ends only with 'View your setup guide'.
- applicability: Parallly should make the wa.me self-message the explicit closing step of onboarding, with a live 'esperando tu mensaje…' state that flips to celebration when the agent answers — exactly the moment Nataly never reached.
### Concierge/enterprise vendors hide the wall behind a human (Zenvia, Yalo, Treble paid, Cliengo '30 min')
- who: Zenvia; Yalo; Treble; Cliengo [observed_secondhand]
- url: https://guiawabusiness.cliengo.com/integracion
- what: Cliengo: 5-step guide, 'en menos de 30 minutos', no sandbox. Treble: paid account required, green-shield verification framed as a stage. Zenvia (search snippets only, KB 403): activation performed by Zenvia's team, needs HTTPS site + fiscal docs, Meta verification ~24h. Yalo: no self-serve docs found; RFC/fiscal docs, 2-10 business days (secondhand). Botmaker: 7 steps, 250 biz-initiated/24h unverified, up to 2 numbers (https://help.botmaker.com/).
- applicability: Confirms the LatAm market norm: either a human does it or the user is on their own. A self-serve flow that behaves like a concierge (pre-flight, error translation, resumable) is the differentiator.
### Vendors recommend a NEW number and warn that migrating from another provider loses templates/bots/history
- who: Chatfuel; Kommo; Jelou; Meta [documented]
- url: https://support.kommo.com/docs/connect-whatsapp-business-to-kommo
- what: Kommo: from external providers 'templates, bots, and message history cannot be transferred'; personal WhatsApp users must delete first. Chatfuel (snippet; doc URLs 404): recommends a new number since it can't be in use elsewhere. Jelou: no coexistence, delete first, avoid Friday migrations, unverified 250/day. Meta: number 'already in use with WhatsApp' must be deleted; new portfolios capped at 2 numbers until verified/2,000 limit.
- applicability: Parallly's pre-flight should ask 'este número ya tiene WhatsApp?' and branch: personal → coexistence impossible, choose new number or delete; Business app → coexistence; other API provider → expect a clean migration with history loss.

## Metrics
- Kommo coexistence status flip to 'Connected': 10-15 minutes after linking; contact import up to 24h — https://support.kommo.com/docs/whatsapp-business-app-connect — caveat: Vendor doc, single platform.
- Interakt sandbox caps: 2 unique users/day, 2 notifications/day, 2 contacts, 14-day trial — https://www.interakt.shop/resource-center/ — caveat: Vendor doc; shows sandbox is demo-grade, not a workflow.
- Meta unverified-business messaging cap: 250 biz-initiated/24h (Botmaker, Jelou); 2 numbers per new portfolio → 20 after verification or 2,000 limit (Meta) — https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers — caveat: 250/day figure from vendor docs; Meta doc states tiering rules.
- ESU OTP lockouts: too many OTP guesses → 12h; repeated failures → 72h — https://support.wati.io/hc/en-us/articles/11462949 — caveat: Wati troubleshooting table, not Meta primary.
- WhatsApp API activation growth: '30%+ surge in activations Q4 2024' after free service conversations — https://m.aisensy.com/blog/whatsapp-statistics-for-businesses/ — caveat: Vendor marketing blog; not verifiable. No primary time-to-value/activation-rate data exists for ESU.
- Cliengo claimed setup time: 'en menos de 30 minutos' — https://guiawabusiness.cliengo.com/integracion — caveat: Marketing claim, no measurement.

## Anti-patterns
- Opening the Meta popup before any pre-flight question (SIM in hand? number already on WhatsApp? which browser?) — Meta documents none of the failure modes, so the user is left with 'Something has gone wrong'.
- Treating a closed/blocked popup as 'not connected yet' with no message — the platform must detect the missing exchange code and explain pop-ups/desktop Chrome.
- Making the history-sync choice look reversible (Gallabox/Wati: it is one-shot).
- Letting the owner add a payment method to the WABA when the partner bills it (Wati warns explicitly).
- Ending onboarding at 'Connected' without the self-message + first agent reply (Kommo, Meta ESU); the activation moment is never proven.
- Promising coexistence to a freshly created WhatsApp Business app account (Kommo: not immediately eligible, Meta's sole decision).
- Using a web-only bot tester as the 'test before Meta' (Wati's tester actually requires a connected number; prior doc claim was wrong).
- Citing unsourced funnel numbers such as '60% abandon if Meta is asked in minute 2' — nothing primary supports it.

## Prior doc claims checked
- [contradicted] Wati permite entrenar/probar el bot en el navegador antes de exigir la conexión con Meta — https://support.wati.io/en/articles/11463032-how-to-test-your-chatbot-in-wati
- [unverifiable] 60% de los usuarios abandona si se pide Meta en el minuto 2 — https://m.aisensy.com/blog/whatsapp-statistics-for-businesses/
- [verified] Meta ofrece números de prueba dentro del Embedded Signup (Tech Providers) — https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- [verified] Coexistencia requiere WhatsApp Business app ≥2.24.17 y comparte historial — https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- [unverifiable] Kommo alimenta el pipeline automáticamente tras conectar — https://support.kommo.com/docs/connect-whatsapp-business-to-kommo

## Sources
- Meta — Embedded Signup (developer docs) — https://developers.facebook.com/docs/whatsapp/embedded-signup — 8 popup screens, returned ids, 555 numbers, 'View your setup guide'
- Meta — Embedded Signup overview — https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/ — claim up to two 555 numbers, payment before messaging, business verification recommended not required
- Meta — Onboard WhatsApp Business app users (coexistence) — https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users — app version, code/QR flow, 20 mps, unsupported features, error 131060
- Meta — Business phone numbers — https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers — eligibility, delete-first rule, 2-step PIN, test number in Get Started, 2→20 number cap
- Wati — ESU troubleshooting — https://support.wati.io/hc/en-us/articles/11462949 — stage-by-stage error table
- Wati — Free 555 number — https://support.wati.io/hc/en-us/articles/12332675 — Meta free number option and limits
- Wati — Coexistence — https://support.wati.io/hc/en-us/articles/11822421 — 5 steps, history limits, WABA payment warning
- Wati — Test your chatbot — https://support.wati.io/en/articles/11463032-how-to-test-your-chatbot-in-wati — tester needs connected number
- Wati — 7-day free trial — https://support.wati.io/en/articles/11462976-explore-wati-with-a-7-day-free-trial — trial limited to own number
- Kommo — Connect WhatsApp Business app (coexistence) — https://support.kommo.com/docs/whatsapp-business-app-connect — eligibility, 30-day import, Connected in 10-15 min
- Kommo — Connect WhatsApp Business (Cloud API) — https://support.kommo.com/docs/connect-whatsapp-business-to-kommo — checklist, modal steps, migration caveats
- respond.io — WhatsApp quick start + coexistence — https://help.respond.io/ — 10 steps, 5 errors, self-message via wa.me, coexistence 14-day rule
- Interakt — sandbox — https://www.interakt.shop/resource-center/ — temp number sandbox caps
- Gallabox — connect + coexistence docs — https://docs.gallabox.com/ — 4-item checklist, one-shot history choice, 14-day offline sever
- Callbell — coexistence blog — https://www.callbell.eu/en/how-to-connect-whatsapp-business-with-callbell-using-coexistence/ — where connect lives, excluded regions (zendesk KB 403)
- Cliengo — guía WhatsApp Business — https://guiawabusiness.cliengo.com/integracion — 5 steps, '30 minutos'
- Treble — help center — https://help.treble.ai/ — question-form readiness checklist
- Botmaker — help — https://help.botmaker.com/ — 7 steps, 250/24h, 2 numbers
- Leadsales — requisitos WhatsApp API blog — https://leadsales.io/blog/ — 3 pillars, 'Meta Verified es un plus'
- Jelou — Onboarding WhatsApp (LatAm extra) — https://help.jelou.ai/es/articles/11662143-onboarding-conecta-tu-cuenta-de-whatsapp-a-jelou-facilmente — SIM-in-phone checklist, no coexistence, 250/day
- AiSensy — 14-day trial FAQ — https://wiki.aisensy.com/en/articles/11489899-aisensy-14-day-free-trial-faqs — trial scope; flows paid
- Zenvia — coexistência KB (403, snippet only) — https://zenvia.movidesk.com/kb/pt-br/article/561777/whatsapp-coexistencia-o-que-e-requisitos-e-como-usar-zcc — FETCH FAILED; search snippet: team-run activation, ~24h
- Chatfuel — connect number docs (404 after redirect, snippet only) — https://chatfuel.com/docs/connect-a-new-whatsapp-number-2c434b06ecf8801c99f2fcf71376cbe1 — FETCH FAILED; snippet: recommends new number
- AiSensy — statistics blog (metric caveat) — https://m.aisensy.com/blog/whatsapp-statistics-for-businesses/ — unverified activation growth claim