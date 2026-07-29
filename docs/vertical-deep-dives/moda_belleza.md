# Moda y Belleza — deep-dive (Jul 2026)

> Dossier 1/18 según `_TEMPLATE.md`. Estado del código al 29-jul-2026 (post `95f758f3`, `b9bd6332`, `5c2581db`, `60049164`). Toda cita archivo:línea fue leída en esta sesión.

## 1. Veredicto y tesis de inversión

**INVERTIR — pero en "belleza", no en "moda_belleza".** Hoy la vertical es la contradicción más cara del catálogo: el research interno la puntúa **#1 en demanda de LatAm (88 pts, `market-research-latam.md:382`)** con TAM estimado de $2-3B en gasto software direccionable (`:395`), y el código le entrega la ficha más flaca de las 18: persona + pipeline + 5 FAQs + 3 servicios sembrados, cero tools dedicadas, cero módulos, cero integraciones, cero agregación en vertical-analytics (`vertical-analytics.service.ts:625,642` — cae en `default: null`/`0`). Lo que sí funciona —la manicurista sola con agenda simple— funciona de verdad post-`95f758f3`, y esa base horizontal (booking determinístico + IG DM + broadcast + media + automation) es exactamente el stack que el research dice que este nicho necesita: no hay que construir una vertical desde cero, hay que cerrar UN hueco de arquitectura (capacidad multi-silla, fase F1 ya diseñada) y cablear 3 features de lock-in cuyas bases ya existen dormidas en el código. La apuesta belleza-primero SE SOSTIENE mirando el código de cerca — el costo de cerrar la brecha es chico en relación al desalineo que resuelve. Condición: partir el nombre. "Moda" (retail de ropa, sub-tipo `boutique`) es un negocio de flujo opuesto que hoy recibe servicios de salón sembrados como agendables; debe migrar a retail y dejar a esta vertical ser lo que su demanda es: **belleza y estética**.

## 2. Radiografía end-to-end

### 2.1 Alta

- Selector de industria: `moda_belleza` presente en `INDUSTRY_KEYS` (`apps/dashboard/src/app/onboarding/page.tsx:46`).
- Sub-tipos (hardcodeados en el alta, `onboarding/page.tsx:124-129`, espejo del registry `vertical-definitions.ts:120-125`): `salon_belleza`, `barberia`, `spa`, `boutique`. **Ninguno cambia nada en el bootstrap** — no hay rama por sub-tipo para esta industria en `verticals.service.ts` (las ramas existentes: turismo `:73-83`, salud/dental `:87-90`, inmobiliaria `:94-97`, etc.; moda_belleza no aparece).
- Objetivos del alta (`onboarding/page.tsx:203-208`): "Reservar citas de servicios", "Informar sobre servicios y precios", "Enviar promociones y ofertas", "Recomendar y vender productos". Audiencias (`:305-309`): individuales / eventos y grupos / VIP y membresías. Post-`5c2581db` los `chatReasons`/`customerTypes` sí llegan al prompt L3.

### 2.2 Agente creado

- `createDefaultAgentFromGoals` (`persona.service.ts:2670-2774`): con `industry='moda_belleza'` toma `verticalTemplates[0]` = **`tpl_belleza_reservas`** ("Luna - Reservas y Estilo", `persona.service.ts:1421-1449`): tono friendly/casual, reglas de venta complementaria, `tools: { appointments: {enabled, canBook, canCancel} }`, RAG on.
- El mapa sub-tipo→plantilla (`persona.service.ts:2702-2708`) cubre tours/agencia/tienda/delivery/dark_kitchen pero **NO `boutique`**: una boutique de moda recibe a "Luna - Reservas y Estilo" (persona de agenda) en lugar de `tpl_belleza_productos` ("Luna - Asesora de Productos", `:1451-1477`), que existe exactamente para ese caso.
- `tpl_belleza_productos` además promete en su descripción "procesa pedidos y gestiona membresías" y trae **`tools: {}`** (`persona.service.ts:1474`) — ni `catalog`, ni `orders`, ni nada de membresías (las tools de membresía existen pero son del flag `gyms`, `conversations.service.ts:1884-1886`). Misma clase de bug que el `tpl_restaurante_delivery` arreglado en `b9bd6332`.

### 2.3 Bootstrap (qué siembra)

Ruta 100% genérica de `bootstrapVertical` (`verticals.service.ts:22-177`), sin rama propia:

| Paso | Qué queda | Fuente |
|---|---|---|
| Pipeline | 5 etapas: Consulta → Cita agendada (`appointment_required`) → En servicio (name+phone) → Cliente frecuente → VIP (terminal, `min_score 8`) | `vertical-definitions.ts:143-151` |
| Persona | Patch canónico `config.persona.*`/`config.behavior.*`, rellena huecos y UNE forbidden/handoff (post-`95f758f3`) | `verticals.service.ts:287-362` |
| FAQs | 5 (servicios/precios, cómo agendar, promociones, cancelación, productos) — neutralizadas, sin políticas inventadas + `tools.faqs` ON | `vertical-definitions.ts:152-158`, `verticals.service.ts:45-46` |
| Servicios | 3 en COP: Corte y estilo 45min $40k, Color y tratamiento 120min $120k, Manicure+pedicure 60min $50k | `vertical-definitions.ts:159-163` |
| Disponibilidad | `availability_slots` lun-sáb 09:00-19:00 desde `businessHours` | `vertical-definitions.ts:164-167`, `verticals.service.ts:56-58` |
| Appointments tool | Re-encendida tras el gate blando del alta (`restoreAppointmentsTool`) | `verticals.service.ts:60-67` |
| Sidebar/KPIs | labelOverrides: crm→"Clientes", pipeline→"Citas", appointments→"Agenda"; KPIs appointmentsToday/leadsToday/noShowsWeek/messagesProcessed | `vertical-definitions.ts:168-183` |

Nota: los 3 servicios de salón se siembran **también para el sub-tipo `boutique`** (el seed no mira `subType`; `verticals.service.ts:49-51`) — la tienda de ropa nace ofreciendo "Corte y estilo" agendable.

### 2.4 Conversación — tabla de tools reales

Con el flag-set que deja el bootstrap (appointments + faqs; RAG on):

| Tool | Qué hace | Gating | ¿Funciona e2e? |
|---|---|---|---|
| `list_services` | Lista servicios activos | `tools.appointments` (`conversations.service.ts:1811-1813`) | Sí |
| `check_availability` | Slots reales por servicio+fecha (horarios, citas, Google Calendar); acepta `staffId` opcional y DEVUELVE `staffId`/`staffName` por slot | idem | Sí, pero capacidad 1 (ver 2.5) |
| `create_appointment` | Crea cita; acepta `staffId` → `assigned_to` | idem | Sí, pero el engine nunca le pasa staff |
| `cancel_appointment` / `reschedule_appointment` / `list_customer_appointments` / `get_appointment_details` / `send_booking_link` | Gestión completa de citas por chat | idem | Sí |
| `get_faq_answer` | FAQs sembradas | `tools.faqs` ON por bootstrap (`verticals.service.ts:46`) | Sí |
| RAG / KB | Respuestas desde knowledge base | `config.rag.enabled` en plantilla | Sí (si el tenant carga contenido) |
| **Dedicadas de belleza** | — | — | **No existen.** Cero `case` de belleza en `ai-tool-executor.service.ts`; las tools que `vertical-strategy.md:34-38` especificó (`book_appointment(service, stylist, …)`, `get_stylist_availability(stylist_id)`, `send_promotion`) nunca se construyeron |
| `treatments` (paquetes multi-sesión) | Planes de tratamiento por contacto (`treatment-plans.service.ts:5` — "orthodontics, physiotherapy…") | `tools.treatments` — solo lo enciende salud+dental (`verticals.service.ts:87-90`) | Existe y serviría para keratinas/depilación por sesiones; **nadie lo enciende para belleza** |

### 2.5 Agenda — el corazón, y el hueco

El motor es honesto y robusto para UN recurso: estado Redis, doble-check anti double-booking, escalada a humano ante `appointments_not_configured` (`booking-engine.service.ts:178-181,798-804`). Pero para un salón con 2+ estilistas:

- `check_availability` genera slots por ventana de `availability_slots` y descarta el slot si **cualquier** cita existente sin staff se superpone: `if (slot.user_id && apt.assigned_to && slot.user_id !== apt.assigned_to) return false;` (`ai-tool-executor.service.ts:1039`) — con `assigned_to = null` (el caso de toda cita creada por chat) una sola cita bloquea TODAS las ventanas.
- El booking engine llama `check_availability` **sin staffId** (`booking-engine.service.ts:784-786`) y `create_appointment` **sin staffId** (`:873-876`); el `staffId` que la tool devuelve por slot (`ai-tool-executor.service.ts:1093`) se pierde — `BookingState.slots` ni siquiera tipa el campo (`tools/appointment-tools.ts:103`).
- `services.max_concurrent` existe en el modelo, es editable (`services.service.ts:22,100`) y `getBookableSlots` lo honra (`appointments.service.ts:717,787`) — pero solo la ruta pública lo pasa (`public-booking.controller.ts:128`); la ruta autenticada del dashboard lo omite (`appointments.controller.ts:222-224` → default 1) y la ruta de chat ni usa esa función.

**Resultado:** el segundo cliente del mismo horario recibe "no hay disponibilidad" con 4 sillas libres. El ICP que el propio research usa para este nicho es multi-silla: *"A 2-stylist beauty salon in Bogotá answers 80+ WhatsApp messages per day"* (`market-research-latam.md:411`) y el target declarado de la plataforma es *"A beauty salon owner + 2 stylists"* (`:60`). No hay censo de % multi-silla en nuestros docs (no inventamos la cifra), pero **el caso central del ICP documentado — no el borde — es el que está roto**. Lo que F1 desbloquea exactamente: pasar `svc.maxConcurrent` a la generación de slots de la ruta de chat convierte "capacidad 1 por negocio" en "capacidad N por servicio" — el salón declara 4 sillas en el servicio y el chat deja de mentir, sin tocar arquitectura ni modelo de datos. F2 (persistir el `staffId` que ya viaja) agrega "con quién": preferencia de estilista y agenda por profesional.

### 2.6 Pipeline

5 etapas bien pensadas para el rubro (VIP con `min_score 8` como terminal positivo). `appointment_required` en "Cita agendada" es satisfacible (las citas de chat SÍ escriben en `appointments`, a diferencia de tours). Sin reglas rotas conocidas.

### 2.7 Dashboard del tenant

- KPIs genéricos de agenda (citas hoy / clientes nuevos / no-shows / mensajes; `vertical-definitions.ts:176-183`). Los KPIs que la estrategia pedía — "servicio más solicitado, recurrencia" (`vertical-strategy.md:41`) — no existen.
- `moda_belleza` está en `APPOINTMENT_INDUSTRIES` del panel (`admin/page.tsx:85`) → widget de citas visible. Cosmética completa por ser vertical "original": `verticalWelcome.moda_belleza` ("Tu salón de belleza está listo, {name}", `messages/es.json:6102`), checklist y empty-states poblados (`es.json:5936,6022`).
- **Cero páginas propias**: sin ítem de sidebar dedicado, sin ficha de cliente con historial de servicios/fotos, sin vista de staff. El ProductTour lo salta explícitamente: "moda_belleza … no tienen herramienta custom en el sidebar" (`ProductTour.tsx:16`).
- `vertical-analytics` (super admin) no agrega nada para esta industria (`vertical-analytics.service.ts:600-644`, sin case).

### 2.8 Integraciones

Ninguna. T3.19 trajo Toast/Mindbody/Cliniko (`conversations.service.ts:1846-1853`); del sector belleza (Booksy/Fresha/Treatwell, nombrados como estándar del rubro en `cluster-agenda.json:41`) no hay nada, y el análisis competitivo canónico ni releva el cluster de booking de belleza (`competitive-analysis-2026-q2.md:75` lista Mindbody/Toast/Cliniko como referencias verticales; ninguna de belleza).

## 3. La experiencia hoy, contada honestamente

**(a) El dueño en sus primeros 30 minutos.** Es de las mejores altas de la plataforma, porque el camino genérico está pulido y esta vertical es 100% camino genérico. Elige "Salón de belleza", objetivos con emojis del rubro, y sale con: Luna configurada con tono correcto, 5 FAQs decentes, 3 servicios con precios COP plausibles, agenda lun-sáb sembrada, pipeline con nombres de su negocio ("Cliente frecuente", "VIP") y un panel que lo saluda con "Tu salón de belleza está listo". Si es UNA persona con agenda simple, a los 30 minutos tiene un bot que agenda de verdad. Dónde empieza a mentir: si tiene 3 estilistas y lo primero que hace es probar dos reservas al mismo horario, descubre el "no hay disponibilidad" fantasma — y no hay ninguna pantalla que le explique por qué ni dónde declarar sus sillas (el campo `max_concurrent` existe pero la ruta que su bot usa lo ignora). Si eligió "Boutique de moda", el engaño es inmediato: su agente es una agendadora de citas y su catálogo son servicios de peluquería.

**(b) La clienta final por WhatsApp en sus primeros 3 mensajes.** "Hola, ¿precio de manicure?" → Luna responde bien (FAQ o `list_services`). "¿Tienen turno el sábado?" → slots reales del sábado. "Dale, a las 10" → nombre, email, confirmación con botones — un flujo digno que no alucina. Dónde brilla: nunca inventa horarios, confirma con resumen, botones interactivos. Dónde se cae: (1) si el sábado a las 10 ya hay UNA cita de cualquier otra clienta, dice que no hay lugar aunque haya 4 sillas; (2) "¿me atiende Karla?" — no puede: no hay noción de estilista en el flujo aunque la tool subyacente ya la soporte; (3) "¿hacen tinte y corte juntos?" — una reserva = un servicio de duración fija (`cluster-agenda.json:40`); (4) le manda una foto de uñas de Pinterest ("¿me pueden hacer esto?") — media-processing la describe como texto, pero la foto no queda en ningún lado asociada a su ficha: el historial visual que el rubro atesora se evapora.

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|---|
| 1 | Capacidad 1 por negocio en la ruta de chat: el multi-silla (ICP del research) recibe "no hay disponibilidad" con sillas libres | **Alta** | `ai-tool-executor.service.ts:1039` (toda cita sin staff bloquea todo); `booking-engine.service.ts:784-786,873-876` (nunca pasa staffId); `max_concurrent` solo en ruta pública (`public-booking.controller.ts:128`) | F1: leer `services.max_concurrent` en `checkAvailability` del executor y contar solapes por servicio en vez de bloquear global | S |
| 2 | El `staffId` que `check_availability` ya devuelve (`:1093`) se tira; `create_appointment` lo acepta (`:1252`) y nadie se lo pasa | Alta | `tools/appointment-tools.ts:103` (BookingState.slots sin staffId) | F2: propagar staffId slot→estado→create; habilita "con Karla" | M |
| 3 | Sub-tipo `boutique` recibe plantilla de agenda + 3 servicios de salón sembrados como agendables | Alta | `persona.service.ts:2702-2708` (sin boutique en bySubType); `verticals.service.ts:49-51` (seed ciego a subType) | Mapear `boutique → tpl_belleza_productos` + saltear seed de servicios/slots para boutique | XS/S |
| 4 | `tpl_belleza_productos` promete "procesa pedidos y gestiona membresías" con `tools: {}` | Media | `persona.service.ts:1453,1474` | Encender `catalog` (+`orders` si aplica) en la plantilla; reescribir descripción sin membresías o encender flag real | XS |
| 5 | Trigger `inactivity` sembrado y muerto: "Recuperar clientes inactivos" (30d) y "Re-engagement 14 días" existen como plantillas y ningún código evalúa tiempo transcurrido | **Alta** (es la base del rebooking, feature de lock-in #1 del research) | `seed-templates.ts:149,170` (trigger_type 'inactivity'); motor solo evalúa por evento entrante (`automation.service.ts:21-28`, `automation-listener.service.ts:47-50`); grep 'inactivity' en apps/api/src = solo seed-templates | Cron diario que consulte contactos sin actividad ≥N días y dispare las reglas `inactivity` | S/M |
| 6 | Reply a IG Story se aplana a placeholder: `[Respuesta a tu historia de Instagram]`, y se pierde cuál historia y su media; con texto, se pierde el contexto de story por el orden de parsing | Media | `instagram.adapter.ts:174-201` (`message.text` gana en `:176`; `reply_to.story` en `:196-198` descarta el asset) | Capturar `reply_to.story` (id/url) como atributo del mensaje/lead y pasarlo al contexto del turno | S |
| 7 | Fotos entrantes (antes/después, referencia de estilo) no se asocian al contacto: media-processing las describe para el LLM y las suelta | Media | `media-processing/*` describe y persiste texto al historial (CLAUDE.md api); no existe galería por contacto en CRM (sin tabla/UI; módulo `media/` es biblioteca del tenant, no per-contact) | Galería por contacto: auto-attach de imágenes entrantes al contact record + tab en CRM | M |
| 8 | Cero KPIs del rubro: "servicio más solicitado" y "recurrencia" especificados y ausentes; vertical-analytics sin case | Baja | `vertical-strategy.md:41`; `vertical-definitions.ts:176-183`; `vertical-analytics.service.ts:625` | 2 KPIs sobre `appointments` (top service 30d, % clientes con 2+ citas) | S |
| 9 | Servicios encadenados / duración variable no existen (tinte+corte) | Media | `cluster-agenda.json:40`; `duration_type` soporta fixed/flexible/open pero una cita = un servicio | Permitir multi-servicio en una reserva (suma de duraciones) — diseño chico sobre el engine | M |
| 10 | La clínica de estética no tiene casa: `spa` (moda_belleza) y "Estética y dermatología" (salud) no activan nada; el comprador #1 del research cae en el hueco | Alta | `eje-mercado.json:22-26`; bootstrap sin rama para `spa` (`verticals.service.ts` no trata moda_belleza) | Ver §5/§7: sub-tipo `estetica` activable con `treatments` ON | S |
| 11 | `handoffTriggers` por substring dudosos: "grupo grande" solo dispara si la clienta escribe esa frase literal | Baja | `vertical-definitions.ts:141` | Reescribir como keywords que el cliente sí tipea ("somos X", "novia", "boda") | XS |

Lo que está BIEN y hay que decirlo: el alta sembrada completa (servicios+slots+FAQs+persona canónica) funciona sin bucles post-`95f758f3`; el flujo de reserva 1-recurso es de lo más sólido de la plataforma (anti-doble-booking, escalada honesta); la cosmética (welcome/checklist/empty states) está completa; y el pipeline del rubro es coherente.

## 5. Lo que esta industria necesita y no tenemos

**Mesa de entrada (sin esto no somos creíbles en el rubro):**
1. **Multi-silla real por chat** (F1 capacidad + F2 staff). Es EL requisito: el rubro agenda por profesional. Todo salón con >1 silla hoy recibe un producto que miente.
2. **Preferencia de estilista** ("con Karla"): F2 + exponer `staffName` en los slots del engine (la tool ya lo devuelve, `ai-tool-executor.service.ts:1092-1093`).
3. **Recordatorio + rebooking**: recordatorios pre-cita ya existen (appointment-reminders); falta el trigger `inactivity` vivo para el "hace 3 semanas que no venís" — la plantilla de automation ya está escrita (`seed-templates.ts:139-158`).
4. **Depósitos/señas para citas largas** (color 120min): el research del rubro y el competitivo lo marcan — "Payment-at-booking … Reduce no-shows 40-60%; billing ya existe" (`competitive-analysis-2026-q2.md:543`, ítem #3 del plan priorizado, 1-2 semanas).

**Diferenciadores (el lock-in que especificó `market-research-latam.md:421-428`):**
1. **Rebooking cadences por servicio** (`:425`): campo "intervalo sugerido de re-reserva" por servicio + automation que agenda el WhatsApp a las N semanas ("¿Lista para tu siguiente keratina?"). Base existente: motor de automation + plantillas inactivity sembradas + `appointments.service` sabe cuándo fue la última cita. Falta: el campo por servicio y el evaluador temporal (hueco #5).
2. **Galería antes/después por contacto** (`:427`): "browsable chronologically… massive retention lock-in". Base existente: módulo `media/` (upload webp, tags), media-processing ya intercepta imágenes entrantes por canal. Falta: asociación imagen→contacto + tab de galería en CRM (hueco #7).
3. **Captura IG Story → booking** (`:423`): "technically available via Instagram Messaging API webhooks — none of the competitors offer this end-to-end". Base existente: canal IG completo (OAuth, webhook, adapter) y el punto exacto de intercepción ya identificado (`instagram.adapter.ts:195-198`). Falta: no aplanar el evento (hueco #6) + ruta directa al flujo de booking.
4. **Paquetes de sesiones** (6 depilaciones, 10 masajes): el módulo `treatment-plans` ya modela multi-sesión por contacto; encender `tools.treatments` para belleza/estética es un flag + copy (hoy solo dental lo recibe, `verticals.service.ts:87-90`).

**Integraciones LatAm concretas:** ninguna especificada por nuestros docs para belleza (a diferencia de dental→Dentalink). `cluster-agenda.json:41` nombra Booksy/Fresha/Treatwell como estándar que la clienta final conoce; no hay research propio de sus APIs — queda como pregunta abierta, no como plan.

**La partición del nombre (decisión recomendada):**
- Los sub-tipos reales son dos negocios: `salon_belleza`/`barberia`/`spa` = servicios con agenda (el 88 pts del research es de ELLOS: "Beauty & Aesthetics **Clinics**"); `boutique` = retail de moda, que el research puntúa aparte y más bajo ("E-Commerce Fashion & Retail", 72 pts, `market-research-latam.md:391`).
- **Recomendación: NO partir en dos verticales nuevas; reasignar.** (a) `boutique` se va: alias hacia `retail` en el alta (el registry de retail ya tiene el núcleo products/pedidos bien cableado). (b) `moda_belleza` se renombra cosméticamente a "Belleza y estética" (labels; el slug puede quedar por compatibilidad). (c) La clínica de estética vive ACÁ, no en salud: nuevo sub-tipo `estetica` que activa `treatments` + FAQs de preparación/contraindicaciones/paquetes de sesiones + persona propia — la opción que el propio eje mercado deja planteada ("fusionar en una vertical 'estética' con subtipos médica/no-médica", `eje-mercado.json:89`) se resuelve así: la estética no-médica (spa, cosmetología, depilación) acá con `estetica`; la dermatología/medicina estética en salud (donde ya hay Cliniko y persona clínica). Costo: una rama de bootstrap (patrón `seedDentalExtras` ya existe) + 1 entrada de sub-tipo + copy. Sin migración de datos: no hay producción real todavía.

## 6. Competencia del rubro

Lo que nuestros docs permiten afirmar:

- **No hay un ganador SaaS organizado del nicho en LatAm.** El research es explícito: *"The niche has near-zero organised SaaS competition with a product purpose-built for their workflow"* y por eso lo elige como camino más rápido a 100 clientes pagos (`market-research-latam.md:532-533`). La competencia real hoy es el WhatsApp manual de la dueña.
- **El análisis competitivo canónico (~40 players) no releva ningún vertical-specialist de belleza** — su cluster E cubre Mindbody (fitness), Toast (resto), Cliniko/Jane (salud), Guesty (VR) (`competitive-analysis-2026-q2.md:75,404-418`). La doctrina ahí definida aplica igual: *"thin vertical, deep horizontal"* — no replicar el system-of-record del rubro, ganar con la capa conversacional + booking determinístico (`:404`).
- Los horizontales que sí compiten en LatAm (Kommo $79-159, Leadsales $84, Whaticket/Wati $39, Chatfuel $69 — `plan-profitability-2026-07.md:83`) no tienen booking determinístico ni nada del workflow de belleza; Landbot lanzó un "AI Appointment Assistant" generativo que es nuestra comparación directa y nuestro punto de defensa ("no alucina", `competitive-analysis-2026-q2.md:365,513`).
- Las herramientas de booking del rubro que la clienta final conoce (Booksy/Fresha/Treatwell, `cluster-agenda.json:41`) no están analizadas en ningún doc nuestro — son link-de-reserva, no conversacionales; el research apuesta a que el canal del rubro en LatAm es WhatsApp/IG, no una app de directorio (`market-research-latam.md:112`: "WhatsApp appointment booking is already the norm, just done manually").
- Precio: Emprendedor $21 como ancla y Starter $49 son coherentes con el WTP del nicho ("At $49/mo, Parallly pays back in 2 saved hours per week", `market-research-latam.md:411`; márgenes 59-77% en todos los planes, `plan-profitability-2026-07.md:77`).

**Conclusión:** hoy este vertical no lo gana nadie en LatAm con un producto conversacional — es ganable. Nuestra ventaja documentada (booking que no alucina + IG+WA dual + precio PYME + MercadoPago) es exactamente el fit del nicho; el único bloqueo es que nuestro booking hoy es mono-silla.

## 7. Plan de inversión de ESTA vertical

Coherente con §1 (INVERTIR). Orden = dependencias reales.

**Quick wins (días):**
| # | Qué | Dónde | Esf. |
|---|---|---|---|
| QW1 | `boutique → tpl_belleza_productos` en `bySubType` + no sembrar servicios/slots para boutique | `persona.service.ts:2702-2708`, `verticals.service.ts:49-58` | XS |
| QW2 | `tools.catalog` en `tpl_belleza_productos` + descripción honesta (sin "membresías") | `persona.service.ts:1451-1477` | XS |
| QW3 | Encender `tools.treatments` cuando `industry='moda_belleza' && subType in (spa, estetica)` (patrón `enableTreatmentsTool` ya existe, `verticals.service.ts:937-961`) | `verticals.service.ts:85-90` | XS |
| QW4 | handoffTriggers realistas (novia/boda/somos N) | `vertical-definitions.ts:141` | XS |
| QW5 | 2 KPIs del rubro: servicio top 30d + % recurrencia | `vertical-definitions.ts:176-183` + agregador | S |

**Mediano (semanas) — el corazón de la apuesta:**
| # | Qué | Dónde | Esf. |
|---|---|---|---|
| M1 | **F1 capacidad**: honrar `services.max_concurrent` en `checkAvailability`/`checkSlotStillAvailable` del executor (y de paso en `appointments.controller.ts:222`) | `ai-tool-executor.service.ts:926-1096,1172-1189` | S |
| M2 | **F2 staff**: propagar el `staffId` que ya viaja (slot→BookingState→create_appointment→`assigned_to`); UI mínima de preferencia | `booking-engine.service.ts:784,873`, `tools/appointment-tools.ts:97-108` | M |
| M3 | **Evaluador del trigger `inactivity`** (cron diario, días-sin-actividad, dispara reglas sembradas). Sirve a belleza, dental y gym a la vez — ya es ítem "TERMINAR" de la auditoría de madurez (§6) | `automation/` nuevo cron + `automation.service.ts` | S/M |
| M4 | **Rebooking cadence por servicio**: campo `rebook_after_days` en services + automation semilla por vertical usando M3 | `services.service.ts`, seed | S |
| M5 | Sub-tipo `estetica` activable: entrada en SUB_TYPES + rama de bootstrap (FAQs de preparación/contraindicaciones sin consejo médico, treatments ON, persona) — resuelve el hueco transversal #5c de la auditoría | `vertical-definitions.ts:120-125`, `verticals.service.ts`, `onboarding/page.tsx:124-129` | S |

**Apuesta (si se confirma belleza-primero como GTM del trimestre):**
| # | Qué | Por qué | Esf. |
|---|---|---|---|
| A1 | Galería antes/después por contacto (auto-attach de imágenes entrantes + tab CRM + tags) | El lock-in #3 del research: *"clinic can't leave Parallly without losing their client photo history"* (`market-research-latam.md:427`) | M/L |
| A2 | IG Story → booking: capturar `reply_to.story` como origen del lead + entrar al flujo de citas | Lock-in #1; *"none of the competitors offer this end-to-end"* (`:423`) | M |
| A3 | Seña/payment-at-booking por chat (MercadoPago; ya priorizado #3 del plan competitivo `competitive-analysis-2026-q2.md:543`) | No-shows -40/60% en citas largas de color/tratamiento | M |
| A4 | Servicios encadenados (tinte+corte en una reserva) | Flujo real del rubro; hoy imposible | M |
| A5 | Renombre cosmético a "Belleza y estética" + alias de `boutique` hacia retail | Honestidad del catálogo; cierra la mezcla moda/belleza | S |

Qué NO hacer: integraciones Booksy/Fresha (sin research propio, y el canal del rubro ya es WhatsApp/IG); staff-scheduling módulo (marcado MATAR — el multi-staff real va por `service_staff` + F2); membresías de belleza (las tools de membership son de gimnasios; no duplicar).

## 8. Qué no se verificó

- **Runtime en vivo**: nada de esto se probó contra producción; todo es lectura de código. En particular el comportamiento exacto del flujo con `max_concurrent > 1` vía ruta pública no se ejecutó.
- **% real de salones multi-silla en LatAm**: ningún doc nuestro trae censo; se usó el ICP del research (dueña + 2 estilistas) como proxy. Cuantificar con datos de mercado externos queda fuera del alcance (regla: mercado solo desde nuestros docs).
- **`tpl_belleza_productos` end-to-end**: no se trazó si algún flujo del alta puede llegar a esa plantilla hoy (no hay sub-tipo mapeado); se asume inalcanzable salvo selección manual en el editor de agentes — no verificado en UI.
- **Payload real de Meta para story replies**: la estructura `message.reply_to.story` (qué campos trae: id, url, media) se afirmó desde el manejo del adapter y conocimiento del API, no desde un webhook real capturado.
- **Comportamiento de `treatment-plans` con servicios de belleza**: el módulo se leyó por encabezado y referencias; no se auditó su servicio completo en esta sesión.
- **Las cifras de mercado citadas** (88 pts, TAM $2-3B, 55% conversión) son del research interno de mayo 2026; no se re-validaron contra fuentes externas.
