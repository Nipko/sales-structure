# REVIEW — The novice owner (Nataly, dance academy with number on another provider and Instagram-first; a dentist with only personal WhatsApp on a phone and 20 min; a restaurant owner with no website who wants deliveries and reservations)

## Verdict
The skeleton (one decision per screen, recipe-first, test page before Meta, triage, "Después" with memory, jargon ban) is the right experience and would get the restaurant and the dentist to a first real reply if the recipes exist. It would still fail Nataly on day 0: the Instagram card describes a requirement the code does not use (Facebook page + Facebook login), so she goes off to create a page, and the WhatsApp "other provider" route hides that migration takes her number away from her current provider and takes days. The single biggest risk is the "Usar así" contradiction on example prices: either confirming the example makes the agent quote fake prices, or it leaves the step not actually done while the copy celebrates "ya puede responder cuánto cuestan las clases".

## Strengths
- §2 anatomy (question title, one-line why, complete example, Usar así / Después, visible win) is exactly what a novice needs and is testable (≤60 words before the example, 390 px).
- Recipe schema §3.1 with blank-space rule ('lo que no dijo la persona queda en blanco, nunca inventado') keeps the agent honest without asking the owner to write paragraphs.
- Step 3 as the aha moment with three test chips drawn from the recipe: the first visible win arrives before any Meta wall.
- Public test page of the web chat (D11) as an always-available channel: the only path that lets the migration-blocked Nataly and the no-website restaurant see the agent working today.
- WhatsApp triage question '¿Dónde vive hoy tu número?' with three-line requirements and errors that end in an action; Cancel while Meta's window is open.
- 'Después' with memory that reappears in the health card as the single next step, and Esc that saves — the two things that would have avoided the 15 lost minutes in the recording.
- Editor reorganized by the owner's own questions (Qué vende, Cómo habla, Cuándo llama a una persona…) with the same anatomy as day 0, plus search that understands 'precios', 'saludo'.

## Gaps
### G1 [blocking] 'Usar así' on a card with example prices is either a lie or a fake price
- where: §2 anatomy, §4 Paso 2 card 1, §10 D10
- why: §1 promises 'Usar así deja el paso listo sin escribir' and the victory says 'Ya puede responder cuánto cuestan las clases'; D10 says example prices are never told to a client until confirmed. Nataly presses Usar así on '$180.000 (ejemplo)'. Either that confirms a price she never set (agent quotes it to a real student) or the step is not really done and the step-3 chip '¿Cuánto cuestan las clases?' answers 'te confirmo el valor', which she reads as 'no funciona'.
- PROPOSAL: Split the row: service name is confirmable, price is a tap-to-fill field showing the example greyed with two chips: [Poner mi precio] [Por ahora no lo dice]. 'Usar así' confirms names/durations only. Victory copy becomes conditional: with prices → 'Ya sabe qué ofreces y cuánto cuesta'; without → 'Ya sabe qué ofreces. Los precios los confirma con una persona hasta que los pongas (toca el precio cuando quieras)'. Under the step-3 chat, when the reply defers a price: 'Respondió así porque no pusiste el precio de la mensualidad. Tócalo y ponlo.'
- evidence: onboarding-experience-design-2026-09.md §1 row 3, §2 rules, §4 Paso 2, D10

### G2 [blocking] Day 0 never asks who receives the chats the agent hands off
- where: §4 Paso 3 (Pasa a una persona cuando…), §4 Paso 6
- why: The diagnosis §6.2 listed 'una persona que reciba los chats' as one of 3-4 essentials; the six-step design dropped it. Step 3 makes the agent say 'Te paso con una persona del equipo' — for the dentist alone between patients nobody is in the inbox, so the promise to the patient is empty; the health panel only turns orange afterwards. The first 'Después' the owner never chose.
- PROPOSAL: In step 3, under the handoff motives, one pre-answered line: '¿Y a quién le avisa? → A ti, por correo a {email del alta} [Cambiar] · Invitar a alguien más (después)'. The owner is the default recipient with what we already know; no new screen. The 'cuando no sabe' options that mention a person are only offered when a recipient exists.
- evidence: onboarding-diagnosis-2026-09.md §6.2 'Inicio durante el día 0'; design §4 Paso 3 'dos decisiones ya tomadas'

### G3 [major] Instagram card demands a Facebook page and Facebook login the flow does not use
- where: §4 Paso 4 table row Instagram; §7 matrix 'Qué necesitas' and 'Triage previo'
- why: The dashboard connects Instagram with Instagram Login (instagram.com/oauth/authorize, scope instagram_business_basic,instagram_business_manage_messages), which does not require a linked Facebook page or a Facebook login. The design copies the old es.json requirement. Nataly, Instagram-first, would leave to create a Facebook page she does not need, and 'cuenta profesional' is never explained.
- PROPOSAL: Verify once against the current Meta flow, then: 'Qué necesitas: que tu cuenta de Instagram sea profesional (gratis, 1 minuto: en Instagram, Configuración → Tipo de cuenta → Cambiar a cuenta profesional; te mostramos las 3 pantallas). Entras con tu usuario de Instagram y aceptas.' Triage: '¿Ves "Panel profesional" en tu perfil de Instagram? Sí / No / No sé → cómo mirarlo'.
- evidence: apps/dashboard/src/app/admin/channels/instagram/page.tsx:134-138; apps/dashboard/src/app/admin/setup-wizard/_components/SecondaryChannels.tsx:104-106; apps/dashboard/messages/es.json:8239,9192,9194

### G4 [major] The 'other provider' WhatsApp route hides that the number leaves the other provider and takes days
- where: §4 Paso 4 WhatsApp triage option (c); §7 'Tiempo propio 5-20 min'
- why: A number can be on one API provider at a time. Nataly's current bot and inbox stop when the migration completes; the existing copy says 'sin tiempo de inactividad… se conservan tus activos', and the design's one-liner only mentions turning off 2FA. She cannot decide this in the flow, and the provider's answer takes days, so step 5 by WhatsApp is unreachable that day while the card promises 5-20 min.
- PROPOSAL: Option (c) copy: 'Tu número solo puede estar con un proveedor a la vez: cuando lo pases a Parallly deja de responder con el otro. Lo que hace falta: (1) pídele a tu proveedor apagar la verificación en dos pasos (suele tardar 1-3 días); (2) vuelve aquí y toca Conectar. Mientras tanto, {Nombre} ya atiende por Instagram y por su enlace.' Show the time estimate only after triage: coexistencia ~10 min, nuevo ~5 min, otro proveedor 'depende de tu proveedor', and route the person to the next channel card automatically.
- evidence: apps/dashboard/messages/es.json:3984,3996,4001; design §4 Paso 4 'WhatsApp'

### G5 [major] WhatsApp triage has no option for 'normal WhatsApp on my personal phone' and mobile-only connection is unstated
- where: §4 Paso 4 WhatsApp triage (4 options); 'Reglas del contenedor: todo cabe a 390 px'
- why: The dentist's number lives in regular WhatsApp on her only phone. Coexistence needs the WhatsApp Business app, so none of the four options fits and she picks wrong (the recording's pattern). On her mobile browser, coexistence also asks to scan a QR with the same phone that opened Meta's popup; the doc claims everything fits at 390 px but never says whether this route works from a phone.
- PROPOSAL: Add option 'En el WhatsApp normal de mi celular' → mini-step: 'Pásalo a WhatsApp Business (gratis, 5 min, conservas número y chats): instala WhatsApp Business, elige "usar este número", listo. Luego vuelve aquí.' Verify coexistence from a phone; if it needs a second screen, say it on the card: 'Este paso se hace mejor desde un computador. ¿Te enviamos el enlace por correo para hacerlo luego?' and count it as Después with memory.
- evidence: design §4 Paso 4; onboarding-diagnosis-2026-09.md §3.4

### G6 [major] Step 5 'te envías un mensaje' is impossible from the phone that holds the number
- where: §4 Paso 5; §7 row 'Cómo se prueba'
- why: Under coexistence the owner's only phone is the business number; WhatsApp does not let her chat with her own number. Instagram 'te escribes desde otra cuenta' assumes a second account Nataly may not have. The activation metric stalls at 'Esperando tu mensaje…' for the most common case.
- PROPOSAL: Step 5 copy: 'Pídele a alguien que le escriba a {número} (o usa otro celular). Te lo ponemos fácil: [Copiar enlace] [Enviarlo por correo]. También puedes probarlo ahora mismo en su enlace: [Abrir].' The live state must celebrate any inbound on any connected channel, and the 2-minute fallback shows system-verified checks ('Meta confirmó el número ✓ · Aún no llega un mensaje') instead of asking the person to check 'canal asignado' or 'agente encendido'.
- evidence: design §4 Paso 5 'Si no llega en dos minutos… número correcto, canal asignado, agente encendido'

### G7 [major] Restaurant needs deliveries AND reservations; the card offers one mechanism and the engine is single-resource
- where: §4 Paso 2 card 3; §3.3 recipe 'Restaurante'
- why: 'Un interruptor por el mecanismo del rubro' reads as one choice. The restaurant owner wants pedidos a domicilio and mesa para 4; the audit records a single-resource booking engine and 'falta pedido/cotización'. The recipe's test chip '¿Hacen domicilio a [barrio]?' needs delivery zones and fees that no card asks for. The copy would promise table booking by party size that the step cannot keep.
- PROPOSAL: Card 3 becomes multi-select with honest verbs: [Reservar mesa] [Tomar pedidos a domicilio] [Solo informar y pasar a una persona]. For each, a one-line consequence: 'Reservar mesa: toma fecha, hora y personas y te avisa para confirmar' (until capacity exists), 'Pedidos: toma el pedido y lo pasa por WhatsApp a la cocina'. Restaurant/retail recipe adds 'Zonas de entrega y costo' as a card-1 chip ('Chapinero · $5.000 (ejemplo)').
- evidence: design §4 Paso 2 card 3; CLAUDE.md vertical-maturity-audit note 'motor de reservas mono-recurso'

### G8 [major] 'Después' on something essential has no visible consequence in the step
- where: §2 rule 'Después salta con memoria'; §4 Paso 2 card 3, Paso 6
- why: The dentist taps Después on 'cómo te reservan' to save time. Nothing tells her that 'Necesito una cita' in step 3 will now end in a handoff to nobody (G2). The consequence only surfaces days later as an orange band in the health panel.
- PROPOSAL: Every Después on an essential card prints one line in place before leaving: 'Sin esto, {Nombre} tomará los datos de quien pida cita y te avisará para que tú confirmes.' The step-3 test chip adapts ('Necesito una cita' → shows exactly that behaviour). Step 6 summary lists what was deferred with its time: 'Dejaste para después: cómo te reservan (2 min)'.
- evidence: design §2, §4 Paso 6 'si algo esencial quedó en Después'

### G9 [major] Step 1 assumes the alta got the industry right; the academy falls in 'Otro' with no way to search
- where: §4 Paso 1 'industria y subtipo detectados desde el alta, como dos chips'
- why: The dance academy is proposed as a new subtype, but under which industry chip? Nataly sees 'Otro' and must decide between Educación, Deporte, Otro — a decision she cannot make. 'Otro' then forces the free-text sentence and a generated recipe instead of the hand-made one.
- PROPOSAL: Replace the two chips with a single search field: '¿Qué tipo de negocio tienes? Escribe una palabra: baile, dentista, restaurante…' with typeahead over the 75 subtypes and a synonym list (baile → academia de baile; dentista → odontología; domicilios → restaurante). 'Otro' appears only when the search finds nothing, with the sentence field.
- evidence: design §3.2, §4 Paso 1; onboarding-diagnosis-2026-09.md §3.1

### G10 [minor] Step 2 breaks 'one decision per screen' and does not fit a phone
- where: §4 Paso 2 (four cards, 3 min); §2 rule 'Una decisión por pantalla'; progress '2 de 7' vs 'Paso 2 de 6'
- why: Four cards with chips and inline editing stacked at 390 px is a long scroll where the dentist loses which card is done; the progress counter names 7 in §1 and 6 in §2/§4.
- PROPOSAL: On mobile each card is its own screen (2a-2d) with the same progress bar; desktop shows the column with one card expanded. Fix the counter to one number and show 'Paso 2 · 3 de 4 tarjetas'.
- evidence: design §1 row 1, §2 header, §4 Paso 2

### G11 [minor] Messenger, Telegram and web-chat cards still use words the target person does not know
- where: §4 Paso 4 table; §7 matrix
- why: 'Ser administrador de la página', 'crear el bot en BotFather y pegar el código', 'página de prueba' (sounds like not real), 'pegar dos líneas'. The restaurant owner with no website skips the web card even though its link is the only channel she can use today (Instagram bio, WhatsApp status).
- PROPOSAL: Messenger: 'Tienes que poder publicar en la página de Facebook de tu negocio desde tu cuenta (si la creaste tú, ya puedes). Entras con Facebook y eliges la página.' Telegram: 'Telegram te deja crear un contacto para tu negocio en 2 minutos dentro de la app (te mostramos los 4 mensajes que hay que enviar); al final te da una clave larga: pégala aquí.' Web chat: rename the card 'El enlace de {Nombre}': 'Un enlace donde cualquiera puede escribirle. Sirve para probar hoy y para ponerlo en tu bio de Instagram. Si tienes página web, te damos dos líneas para quien la maneja.'
- evidence: design §4 Paso 4 table, §7 matrix

### G12 [minor] Step 3 'why' nudges the agent toward pretending to be human
- where: §4 Paso 3 'Por qué'
- why: 'Así tus clientes van a sentir que hablan con alguien de tu equipo' — the program already fixed the contract so the agent never claims to be human; the why-line sells the opposite feeling to the owner.
- PROPOSAL: 'Así tus clientes sienten que los atiende alguien que conoce tu negocio.'
- evidence: design §4 Paso 3; CLAUDE.md vertical_program_execution note on 'sé humano'

## Concrete changes
- §2/§4 Paso 2 card 1: 'Usar así' confirms service names and durations; each price is a tap-to-fill field with chips [Poner mi precio] [Por ahora no lo dice]; victory copy: 'Ya sabe qué ofreces. Los precios los confirma con una persona hasta que los pongas.'
- §4 Paso 3, under the handoff motives: '¿Y a quién le avisa? → A ti, por correo a {email} [Cambiar] · Invitar a alguien más (después)'.
- §4 Paso 4 Instagram card: 'Que tu cuenta de Instagram sea profesional (gratis, 1 minuto: Configuración → Tipo de cuenta → Cambiar a cuenta profesional; te mostramos las 3 pantallas). Entras con tu usuario de Instagram y aceptas.' Triage: '¿Ves "Panel profesional" en tu perfil? Sí / No / No sé'.
- §4 Paso 4 WhatsApp option (c): 'Tu número solo puede estar con un proveedor a la vez: cuando lo pases a Parallly deja de responder con el otro. Pídele a tu proveedor apagar la verificación en dos pasos (1-3 días) y vuelve aquí. Mientras tanto, {Nombre} ya atiende por Instagram y por su enlace.'
- §4 Paso 4 WhatsApp triage: add option 'En el WhatsApp normal de mi celular' → 'Pásalo a WhatsApp Business (gratis, 5 min, conservas número y chats) y vuelve aquí.'
- §4 Paso 4: show the time estimate after triage, never on the card ('depende de tu proveedor' for migration).
- §4 Paso 5: 'Pídele a alguien que le escriba a {número} (o usa otro celular): [Copiar enlace] [Enviarlo por correo]. O pruébalo ahora en su enlace.' Celebrate any inbound on any connected channel; the 2-minute fallback shows system-verified checks, not 'canal asignado'.
- §4 Paso 2 card 3: multi-select [Reservar mesa/cita/clase] [Tomar pedidos a domicilio] [Pedir cotización] [Solo informar y pasar a una persona], each with a one-line consequence; restaurant/retail recipe adds 'Zonas de entrega y costo'.
- §2 rule for Después on an essential: print the consequence in place ('Sin esto, {Nombre} tomará los datos y te avisará para que tú confirmes') and list deferred items with their time in Paso 6.
- §4 Paso 1: replace the two chips with a search field over 75 subtypes plus synonyms ('baile, dentista, restaurante…'); 'Otro' only when nothing matches.
- §4 Paso 2 on mobile: one card per screen (2a-2d); unify the progress counter (6 vs 7).
- §4 Paso 4 web-chat card renamed 'El enlace de {Nombre}': 'Un enlace donde cualquiera puede escribirle. Sirve para probar hoy y para tu bio de Instagram.'

## Questions for owner
- Instagram: the code uses Instagram Login (no Facebook page). Is the 'página de Facebook' requirement in the copy a leftover, or does some tenant path still use the Facebook-page flow? This decides the Instagram card copy.
- Does WhatsApp coexistence work end-to-end from a mobile browser (the popup and the QR scan on the same phone)? If not, the day-0 flow must say so and offer the email-me-the-link route.
- Who receives handoffs by default on day 0: the owner's email from the alta, her own WhatsApp, or nobody until she invites someone? Recommendation: the owner, by what we already know.
- What does 'Usar así' mean on a row with an example price: confirmed real price or 'name confirmed, price pending'? The whole aha moment depends on this.
- For restaurants: does the booking engine handle party size and multiple tables today, or should day 0 promise 'toma la reserva y te avisa para confirmar'?