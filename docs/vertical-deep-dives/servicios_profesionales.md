# Servicios profesionales — deep-dive (Jul 2026)

> Dossier 16/18 de `docs/vertical-deep-dives/`. Fuente: código leído (archivo:línea), ficha `vertical-maturity-audit-2026-07.md` §4 (14/36, superficial), `cluster-servicios.json`, y mercado solo desde nuestros docs.

## 1. Veredicto y tesis de inversión

**GENÉRICA-HONESTA — pero con más dignidad que finanzas, y con un auto-sabotaje que hay que apagar antes de vender un solo tenant.** Hoy es una `createGenericVertical` (`vertical-definitions.ts:560`) con cinco cosas propias bien hechas: persona formal correcta para un regulado (Elena, sin emojis, *"NUNCA des asesoría legal o contable — siempre escala al profesional"*, `persona.service.ts:1911`), terminología del rubro (`caso`/`casos`, sidebar `pipeline → "Casos"`, `:567,:577`), pipeline plausible de despacho (Consulta → Evaluación → Propuesta → En proceso → Completado/Declinado, `:569-576`), **dos** servicios sembrados con honorario real (Consulta inicial 30 min $100.000 COP, Asesoría especializada 60 min $200.000, `:580-581`) y la capa cosmética completa en 4 idiomas. Y cero de lo demás: cero tools de industria, cero módulos, cero rama en `bootstrapVertical`, cero FAQs propias (hereda las 5 genéricas, incluida *"¿Tienen política de devolución?"* en un despacho jurídico, `:515-521`), cero KPIs del rubro. El circuito de agendar-consulta **funciona end-to-end** — verificado en §2.5, y es la única vertical del Tier bajo cuyo servicio sembrado lleva precio y el motor lo muestra (`booking-engine.service.ts:770-773`).

**La diferencia estructural con finanzas: acá el contrato L1 no veta el negocio, lo ES.** En finanzas el L1 imborrable prohíbe *"Financial investment advice as if you were a licensed advisor"* (`prompt-assembler.service.ts:98`) — el núcleo del sub-tipo asesoría. Acá el L1 dice *"Legal advice as if you were an attorney (refer to a professional)"* (`:97`) y *"Disclosing other customers' personal information"* (`:95`) — que es **exactamente** lo que la plantilla del rubro ya ordena (`persona.service.ts:1911,:1915`). Es la única vertical del catálogo donde el guardrail que no se puede sobrescribir coincide con la política profesional del cliente. El secreto profesional tiene piso de plataforma, no solo de prompt.

**Y sin embargo el rubro se auto-sabotea en el primer mensaje.** `'abogado'` y `'demanda'` son `complaintKeywords` **de plataforma** (`handoff.service.ts:73-77`), evaluados en `conversations.service.ts:591` **antes** de la IA y con retorno temprano (`:619`). El mensaje de entrada canónico de un despacho — *"necesito un abogado"*, *"quiero poner una demanda"* — escala a la cola humana sin que Elena diga una palabra. Y el escape documentado para eso, `config.behavior.handoffCategories`, **tiene 0 escritores en todo el repo**: solo aparece en el comentario y en la lectura del propio servicio (`handoff.service.ts:55,:59`). Existente-pero-inalcanzable, en el peor lugar posible.

**Recomendación:** GENÉRICA-HONESTA **+ apagar el desactivador + gobernar las etapas**. No construir las 3 tools que propone `vertical-strategy.md:158-166` (`qualify_case`, `request_documents`, `get_services_and_fees`): dos son innecesarias —los honorarios ya viajan en `services` y la calificación del caso es texto libre que el LLM hace bien— y la tercera (`request_documents`) es **imposible hoy**: un PDF entrante muere en `conversations.service.ts:1383-1392` con *"solo puedo procesar texto, imágenes y audios"* y retorno temprano. **Ningún sub-tipo rutea a otra vertical** (a diferencia de `finanzas>seguros`): abogados/contadores/arquitectos/consultores no duplican nada existente. Sí hay una **frontera con technology** (`consultores` vs `consultoria_ti`) que resuelve el dossier 17.

---

## 2. Radiografía end-to-end

### 2.1 Alta (`apps/dashboard/src/app/onboarding/page.tsx`)

| Paso | Qué ve el dueño | Archivo:línea |
|---|---|---|
| Industria | "Servicios profesionales" (4 idiomas) | `:45`; `messages/es.json:3991` |
| Sub-tipo | Abogados · Contadores · Arquitectos · Consultores | `:136-141` |
| Objetivos | Agendar consultas · Evaluar tipo de caso · Información de servicios y honorarios · **Seguimiento de casos** | `:245-250` |
| Audiencia | Personas naturales · Empresas · **Casos legales/contables** | `:340-344` |

Los 4 sub-tipos coinciden exactamente con los del registry (`vertical-definitions.ts:561-566`): como finanzas, no hay drift entre la lista hardcodeada del alta y el registro. Y como finanzas, **ninguno hace nada**: no están en el mapa `bySubType` de `createDefaultAgentFromGoals` (`persona.service.ts:2704-2715`, que solo conoce tours/agencia_viajes/tienda/delivery/dark_kitchen/dental) ni en ninguna rama de `bootstrapVertical` (`verticals.service.ts:73-154`). El sub-tipo se persiste en `tenant.settings.subType` (`verticals.service.ts:173`) y muere ahí.

Detalle de UX propio: la tercera "audiencia" es **"Casos legales/contables"** (`:343`), que no es un público sino un tipo de asunto — en el resto de las verticales las tres opciones son personas (individuals/businesses/…). El dueño elige "a quién le vendo" y una de las tres respuestas es "a los casos".

Objetivos y audiencia sí llegan al prompt L3 post-`5c2581db` (`conversations.service.ts:1622-1648`, cache `bizgoals:{tenantId}` 600s). Es el único canal por el que el alta influye en el agente — y el objetivo **"Seguimiento de casos"** es texto que el LLM lee sin ninguna herramienta detrás (§4 #6).

### 2.2 Agente creado (`persona.service.ts`)

`createDefaultAgentFromGoals` (`:2672`) toma **siempre** `verticalTemplates[0]` cuando hay industria (`:2698-2699`). Servicios profesionales tiene 2 plantillas (`:1893-1958`) y ninguna entrada en `bySubType` → **los 4 sub-tipos reciben la misma**.

**`tpl_legal_consulta`** (`:1894-1928`) — "Elena - Consulta Inicial":
- Persona formal, `emojiUsage: 'none'`, greeting *"¿En qué área necesitas asesoría: legal, contable u otra?"* (`:1905`).
- Reglas (`:1909-1916`): pregunta el tipo de caso para asignar al profesional · **NUNCA des asesoría legal o contable** · aclara que la primera consulta puede tener costo y confirma antes de agendar · captura nombre, teléfono, email y resumen del caso · pregunta si hay urgencia o plazo legal/fiscal · **NO compartas detalles de otros clientes**.
- `forbiddenTopics` (`:1917`): asesoría legal específica · predicción de resultados de juicio · honorarios sin confirmar · información de otros clientes.
- `handoffTriggers` (`:1918`): `caso urgente`, `plazo legal vencido`, **`consulta sobre caso existente`**, **`cliente actual`**.
- `requiredFields` (`:1919-1923`): name, phone **y email** obligatorios (la única de las genéricas que exige email).
- `tools` (`:1925`): `appointments {canBook, canCancel}` + `crm` + `knowledge`.

Es una plantilla notablemente buena: es la única del catálogo que instruye explícitamente confidencialidad entre clientes y que pregunta por **plazo legal/fiscal** (la variable que define la urgencia real del rubro). Dos de sus cuatro triggers, sin embargo, son frases que ningún cliente escribe (§4 #7).

**`tpl_legal_seguimiento`** (`:1929-1957`) — postventa: verifica identidad *"con número de caso o referencia"* (`:1945`), comunica solo lo que el profesional autorizó (`:1946`), y si el cliente pide documentos *"confirma identidad y **dirige al portal seguro**"* (`:1948`). `tools: {appointments{canBook,canCancel}, crm}` — **sin `knowledge`**. **Nunca se selecciona sola** (gana `[0]`); el dueño tiene que descubrirla en el editor. Y el "portal seguro" que promete no existe como producto (§4 #5).

Después, `patchDefaultAgent` (`verticals.service.ts:293-367`) rellena huecos sin pisar la plantilla pero **une** `forbiddenTopics` y `handoffTriggers` (`:334-341`). Triggers efectivos = los 4 de la plantilla **+** `caso complejo|conflicto de intereses|queja formal|urgencia legal|audiencia` del registry (`vertical-definitions.ts:568`).

**Trampa de idioma.** `getVerticalTemplates` devuelve las 2 plantillas solo en español: para cualquier otro idioma `localizeVerticalTemplates` devuelve **una sola** (`persona.service.ts:2585-2586`, `:2658-2665`) y **reemplaza** `behavior.rules` y `forbiddenTopics` por los del registry (`:2653-2655`). Traducción concreta: un despacho que corre en inglés o portugués pierde `tpl_legal_seguimiento` entero y pierde las 6 reglas finas de la plantilla —incluida *"NO compartas detalles de otros clientes"* y *"captura … resumen del caso"*— a cambio de las 3 frases cortas del registry (`vertical-definitions.ts:568`). El piso de confidencialidad del L1 (`prompt-assembler.service.ts:95`) sobrevive; la regla explícita de la persona, no. Importa más de lo habitual acá: los **dos únicos mercados** donde nuestro research documenta demanda de este rubro son Uruguay y Puerto Rico, y de Puerto Rico dice literalmente *"English + Spanish bilingual"* (`market-research-latam.md:233`).

### 2.3 Bootstrap (`verticals.service.ts:22-183`)

Sin rama propia; solo el tronco común:

| Paso | Qué siembra | Línea |
|---|---|---|
| `seedPipelineStages` | 6 etapas de despacho con `transition_rules = '[]'` (la definición no trae ninguna) | `:36`, `:244-271` |
| `patchDefaultAgent` | rellena huecos + une triggers/prohibiciones | `:39` |
| `seedFaqs` + `enableSimpleTool('faqs')` | **las 5 FAQs genéricas** (horario, pagos, contacto, ubicación, **devoluciones**) | `:45-46` |
| `seedServices` | **2 servicios** con honorario: Consulta inicial 30min $100.000 COP, Asesoría especializada 60min $200.000 | `:49-51`; def. `vertical-definitions.ts:580-581` |
| `seedAvailability` | slots desde `businessHours` **genérico**: lun-vie 08:00-18:00 | `:56-58`; def. `:523` |
| `restoreAppointmentsTool` | reenciende `appointments` (services=2, slots>0) | `:67` |
| Ramas por industria (`:73-154`) | **ninguna aplica** | — |
| Config resuelta | terminology (cliente/caso/servicio profesional/casos), sidebar, dashboard, `bookingEnabled:true` | `:157-176` |

### 2.4 Conversación — qué puede hacer la IA de verdad

Registro por turno en `conversations.service.ts:1810-1901`. Un tenant recién creado lleva 4 flags: `appointments`, `crm`, `knowledge` (plantilla) + `faqs` (bootstrap).

| tool | qué hace | gating | ¿funciona e2e? |
|---|---|---|---|
| **Motor de reservas** (determinista, corre ANTES del LLM) | servicio→fecha→hora contra `availability_slots`; muestra duración **y honorario** (`booking-engine.service.ts:770-773`); interactivos en WA | `config.tools.appointments.enabled === true` (`:1655-1667`) | **Sí** — verificado en §2.5. Limitación transversal: capacidad 1 por franja |
| `APPOINTMENT_TOOLS` (`list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, +4) | consulta/crea/cancela cuando el motor no captura el turno | `cfgTools.appointments.enabled` (`:1811`) | Sí, misma limitación mono-recurso |
| `FAQ_TOOL` (`search_faqs`) | busca en las FAQs sembradas | `cfgTools.faqs.enabled` (`:1817`), encendido por bootstrap (`:46`) | Sí — pero el contenido no es del rubro (§4 #4) |
| `KB_TOOL` (`search_knowledge_base`) | RAG sobre la KB del tenant | `cfgTools.knowledge.enabled` (`:1823`) | Sí si el dueño carga documentos; vacío el día 1. **Ausente en `tpl_legal_seguimiento`** (`persona.service.ts:1954`) |
| `CUSTOMER_CONTEXT_TOOL` (`get_customer_context`) | lead score, tags, etapa, última interacción | `cfgTools.crm.enabled` (`:1832`) | Sí (solo lectura, `crm-tools.ts:24-28`) |
| `qualify_case` / `request_documents` / `get_services_and_fees` (`vertical-strategy.md:158-166`) | — | — | **No existen.** Barrido del `switch` de `ai-tool-executor.service.ts:76-340`: ninguna tool de este rubro. Ver §5 para cuáles valen |

**Lo bueno que hay que decir en voz alta:** `get_services_and_fees` **ya está cubierta** por `list_services` — los 2 servicios sembrados llevan `price` y `currency`, y tanto el motor determinista como la tool los devuelven. El objetivo del alta *"Información de servicios y honorarios"* se cumple el día 1 sin construir nada.

### 2.5 Agenda — circuito agendar-consulta verificado end-to-end

El encargo pedía verificar el circuito, no re-reportar el fix `b9bd6332`. Recorrido real:

1. **Alta** → `createDefaultAgentFromGoals` inserta `tpl_legal_consulta` con `appointments.enabled = true` (`persona.service.ts:1925`).
2. **Gate blando** (`persona.service.ts:2754-2765`): corre ANTES del bootstrap; sin servicios ni slots → apaga la tool y deja `pendingPrerequisites: true`.
3. **Bootstrap** siembra 2 servicios activos (`verticals.service.ts:49-51`) + slots lun-vie 08:00-18:00 (`:56-58`).
4. **`restoreAppointmentsTool`** (`:67`) ve el marcador, recuenta (`services=2, slots>0`) → `enabled: true` y borra el marcador.
5. **Runtime**: `conversations.service.ts:1655` lee el flag → entra el motor determinista; `:1811` registra además las APPOINTMENT_TOOLS.

**Veredicto: el circuito cierra, y mejor que en finanzas.** Las trampas conocidas no se dan: 30 y 60 min entran de sobra en la ventana de 600 min (no es la boda de 480 min de fotografía ni el "Hotel — noche" de pet_services), y el precio >0 no bloquea nada porque el motor solo lo **muestra** (`booking-engine.service.ts:770-773`) — no hay cobro en el chat, y la plantilla ya instruye *"aclara que la primera consulta puede tener costo y confirma antes de agendar"* (`persona.service.ts:1912`): prompt y motor dicen lo mismo. Riesgos que quedan, todos transversales: capacidad 1 (el despacho con 3 abogados rechaza al segundo cliente de las 10:00 — y acá duele más que en otras porque el modelo natural del rubro es *un profesional por caso*), y el chat ignora `blocked_dates`.

### 2.6 Pipeline — el activo, y el reverso más caro del catálogo

Las 6 etapas (`vertical-definitions.ts:569-576`) modelan bien el ciclo de un encargo profesional, con probabilidades 10/25/50/75/100/0 y dos terminales de polaridad opuesta. **No llevan `offer_required`**: esa regla vive en el pipeline genérico (`:511`) y esta vertical sobrescribe `pipeline` entero.

Reverso: **ninguna etapa tiene `transitionRules`** → se siembran `'[]'` (`verticals.service.ts:264`) y nada gobierna el avance. Y el auto-progress mapea los slugs genéricos a los del tenant **por probabilidad** (`pipeline.service.ts:1443-1471`, pool solo no-terminales, `<` estricto en empates). El mapeo real:

| Señal del cliente (es) | Slug genérico (prob) | Etapa del despacho donde cae |
|---|---|---|
| primera respuesta de la IA | `contactado` (20) | **Evaluación** (25) — más cerca que Consulta (10) |
| "me interesa", "dale", "perfecto", "listo" | `respondio` (30) | **Evaluación** (25) |
| "precio", "cuánto", "tarifa", "horario", "fecha" | `calificado` (50) | **Propuesta** (50, exacto) |
| **"reservar"**, **"pagar"**, "lo quiero", "confirmo" | `listo_para_cierre` (95) | **En proceso** (75) |

(Léxicos en `pipeline.service.ts:85-89`; señales en `:1303-1319`.) Es decir: **preguntar los honorarios manda el caso a "Propuesta"** —que en un despacho es un documento firmado, una carta de encargo— y **decir "reservar" para agendar la consulta manda el caso a "En proceso"**, que significa encargo aceptado y expediente abierto. Peor: `reservar`, `pagar` y `confirmo` son exactamente el vocabulario que el propio motor de reservas induce (§2.5). **La única cosa que esta vertical hace bien dispara la mentira más cara de su tablero.** Lo único que salva: el auto-progress nunca escribe terminales (`:1461`), así que "Completado" no se marca solo.

### 2.7 Dashboard del tenant

- **Sidebar** (`vertical-definitions.ts:577`): `crm → "Clientes"`, `pipeline → "Casos"`; oculta `inventory`, `orders`, `catalog`. Correcto.
- **KPIs**: no sobrescribe `dashboard` → hereda los 4 genéricos (`:525-530`): Leads Hoy · Leads Calientes · Mensajes · Costo IA. Cero KPIs del rubro (casos abiertos, consultas agendadas, casos por etapa).
- **Panel**: `admin/page.tsx:86` incluye la vertical en `PIPELINE_INDUSTRIES` → el widget del home carga **los últimos 5 leads** (`:264-272`), no las citas del día (`APPOINTMENT_INDUSTRIES` es solo salud/moda_belleza/restaurantes, `:85`). El rubro cuyo único producto funcional es la agenda es el que no ve la agenda en su home.
- **Página propia**: ninguna. `ToolsTour` la manda solo a `/admin/appointments` (`ToolsTour.tsx:81-83`) — honesto, es su única herramienta.
- **Cosmética**: **completa en 4 idiomas** (9 claves en cada JSON): objetivos (`es.json:4342`), audiencias (`:4435`), terminología (`:4481`), empty states (*"Tus casos en curso se mostrarán aquí"*, `:5985`), checklist (*"Configura tu recepción virtual"*, *"Carga tus servicios y honorarios"*, `:6071`) y saludo del panel (*"Tu firma profesional está lista, {name}"*, `:6109`). Es de las 11 originales: tiene la capa que les falta a las 6 nuevas.

### 2.8 Integraciones

Ninguna, ni existente ni planeada: sin gestor de expedientes, sin firma electrónica, sin facturación profesional, sin *trust accounting*. Las 3 de T3.19 (Toast/Mindbody/Cliniko) no aplican.

---

## 3. La experiencia hoy, contada honestamente

### (a) El dueño en sus primeros 30 minutos

Un estudio jurídico de 3 abogados en Montevideo elige "Servicios profesionales" → "Abogados" → marca los 4 objetivos, incluido "Seguimiento de casos". El alta se siente **precisa**: los sub-tipos son los suyos, el panel lo recibe con *"Tu firma profesional está lista"* y el checklist le habla en su idioma (*"Configura tu recepción virtual"*, *"Carga tus servicios y honorarios"*, *"Invita a tu equipo profesional"*). El sidebar dice "Clientes" y "Casos" y no le muestra Inventario ni Catálogo. Abre Citas y —a diferencia de casi toda vertical del Tier bajo— encuentra **dos** servicios con honorario ya cargado. Es la mejor primera impresión de una vertical sin módulo.

A los 10 minutos empieza el desajuste. Abre FAQs: cinco preguntas que no son de su rubro, una le pregunta por su **política de devolución**. Abre el embudo: seis columnas exactas de su despacho y ningún criterio para pasar de una a otra. Busca dónde vive el **expediente** —número de caso, materia, documentos, profesional asignado— y no hay dónde: el "caso" existe como palabra en el sidebar y como columna del Kanban, nunca como objeto. Busca el "portal seguro" que su segunda plantilla le promete al cliente y no lo encuentra en ninguna pantalla. Y el home le muestra "últimos leads" en vez de las consultas del día.

**Dónde brilla:** vestuario completo (persona, terminología, pipeline, cosmética 4 idiomas), y una agenda con honorarios que funciona sin tocar nada. **Dónde se cae:** el caso no existe como dato, y el objetivo #4 del alta ("Seguimiento de casos") no tiene ninguna maquinaria. **Dónde miente:** las FAQs sembradas, el "portal seguro" de la plantilla de seguimiento, y —la peor— el tablero, que abre expedientes solo porque alguien preguntó el precio.

### (b) El cliente final por WhatsApp, primeros 3 mensajes

> **— Hola, necesito un abogado para un despido.**
> — [Elena nunca responde. `handoff.service.ts:76` ve `'abogado'` en `complaintKeywords`, `conversations.service.ts:594-619` escala y contesta *"te paso con un asesor / estás en la posición N de la cola"*]

Este es el hallazgo central del dossier. El mensaje **más probable** que recibe un despacho por WhatsApp contiene la palabra que la plataforma clasifica como queja. La conversación pasa a `waiting_human` antes del primer turno de IA, con retorno temprano: no hay tool, no hay calificación de caso, no hay agenda. Lo mismo con *"quiero poner una demanda"* (`'demanda'`, `:76`). Un despacho que contrata "recepción virtual 24/7" descubre que la IA solo atiende a los clientes que **no** nombran su problema.

> **— ¿Cuánto cobran la primera consulta?**
> — La consulta inicial dura 30 minutos y tiene un valor de $100.000 COP. ¿Querés que te busque un horario?

Acá funciona bien: honorario real desde `services`, sin invención, con el disclaimer que la plantilla ordena. Efecto colateral en el mismo turno: *"cuánto"* es keyword de intención → el auto-progress mueve la tarjeta a **Propuesta** (§2.6). El socio abre el tablero y ve una propuesta de honorarios que nadie escribió.

> **— Dale, quiero reservar el martes. Te mando el contrato para que lo miren.** *(adjunta un PDF)*
> — Recibí tu mensaje, pero por ahora solo puedo procesar texto, imágenes y audios. ¿Podrías escribirme lo que necesitas?

Dos cosas en un turno. La primera mitad **funciona**: "reservar" entra al motor determinista y la consulta se agenda (§2.5) — aunque el mismo "reservar" empuja la tarjeta a **En proceso**. La segunda es el techo del rubro: el documento se rechaza en `conversations.service.ts:1383-1392` con **retorno temprano** — el LLM no corre, nadie se entera del contrato, y el archivo no se descarga ni se guarda en ningún lado (`media-processing` solo cubre `audio` e `image`, `:1360`). En el negocio que vive de documentos, el documento es el único tipo de mensaje que la plataforma contesta con una negativa.

**Riesgo aparte, y a favor:** si el cliente pide asesoría de fondo (*"¿me pueden decir si el despido fue justificado?"*), el L1 (`prompt-assembler.service.ts:97`) y la regla de la plantilla (`persona.service.ts:1911`) dicen lo mismo — derivar al profesional. Acá la política de la casa **es** la política del cliente. Detalle menor en la dirección contraria: la regla 15 del L1 obliga a confirmar reservas *"with relevant friendly emojis"* (`prompt-assembler.service.ts:84`) mientras la persona del despacho es `emojiUsage: 'none'` (`persona.service.ts:1904`) — la confirmación de la consulta jurídica sale con emojis por contrato.

---

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **`'abogado'` y `'demanda'` son `complaintKeywords` de plataforma**: el intake canónico del rubro escala a humano ANTES de la IA, con retorno temprano. Mismo patrón que `emergencia` en servicios_hogar, `reclamo` en seguros y `devolución` en retail — pero acá anula el caso de uso **principal**, no uno secundario | **Alta** | `handoff.service.ts:73-80` (lista); `conversations.service.ts:591-619` (evaluado antes del LLM + `return`) | Doble: (a) sacar `abogado` y `demanda` de `complaintKeywords` — son sustantivos del rubro, no señales de queja (`molesto`, `estafa`, `pésimo` sí lo son); (b) hacer alcanzable `handoffCategories` (#2) para que cualquier despacho pueda apagar `complaint` | **XS** (a) |
| 2 | **`handoffCategories` no tiene un solo escritor**: el mecanismo por-tenant para apagar categorías de handoff existe, está documentado en el propio código y **nadie lo escribe** — 0 ocurrencias fuera de `handoff.service.ts` en API y dashboard | **Alta** (transversal) | `handoff.service.ts:55,:59`; barrido de `handoffCategories` en `apps/api/src` + `apps/dashboard/src` → solo esas 2 líneas | Exponerlo en el editor de agente (sección de escalado) como 5 toggles: petición de humano · queja · descuento · VIP · reintentos. El lector ya existe; es UI + i18n×4 | **S** |
| 3 | **Los documentos son el único tipo de mensaje con respuesta negativa**: PDF/DOCX entrante → *"solo puedo procesar texto, imágenes y audios"* con **retorno temprano**; el archivo no se descarga, no se persiste, el LLM no corre. En el rubro que vive de documentos | **Alta** | `conversations.service.ts:1383-1392` (fallback + return); `:1360` (media-processing solo audio/image); el adapter **sí** parsea `document` con `mediaUrl`+`filename` (`whatsapp.adapter.ts:257-265`) — el dato llega y se tira | Mínimo digno y barato: no cortar el turno — persistir el adjunto con el pipeline de media que ya existe (`media/`, volumen `/data/media/{tenantId}`) y pasarle al LLM `[El cliente envió un documento: "contrato.pdf"]`, igual que se hace con audio e imagen. Sin OCR, sin lectura: recibir y avisar ya es el 80% del valor | **M** |
| 4 | **FAQs genéricas en un despacho**: hereda las 5 del fallback, incluida *"¿Tienen política de devolución?"*. Es literalmente el ejemplo que la auditoría de madurez usa para esta vertical | Media | `vertical-definitions.ts:515-521` + bloque `:560-583` (sin clave `faqs`) | 5 FAQs propias, y **por sub-tipo dominante** (patrón `seedToursExtras`/`seedDentalExtras`, ya existente). Propuesta en §7 | **S** |
| 5 | **El "portal seguro" que la plantilla promete no existe como producto**: `tpl_legal_seguimiento` instruye *"dirige al portal seguro"*. El módulo `customer-portal` existe con OTP de 6 dígitos (Redis 10min, 5 intentos) pero (a) **no tiene una sola página** en `apps/dashboard/src/app` ni en landing, (b) expone `profile`, `conversations`, `appointments`, `orders` — **no documentos ni casos** | **Alta** | `customer-portal.controller.ts:28-118` (6 endpoints, ninguno de documentos); búsqueda de UI de portal en `apps/dashboard/src` y `apps/landing/src` → 0 páginas | Dos caminos honestos: (a) **corto** — reescribir la regla para que no prometa lo que no hay ("agenda una reunión para revisar documentos"); (b) **si se invierte** — el portal ya tiene la autenticación resuelta (OTP), le falta la UI y un endpoint de documentos del contacto. La identidad del §4 #8 se resuelve con lo mismo | **XS** (a) / **M-L** (b) |
| 6 | **"Seguimiento de casos" es un objetivo del alta sin ninguna maquinaria**: no hay objeto caso (ni tabla, ni número, ni materia, ni profesional asignado); la plantilla que lo atiende no se selecciona nunca; y su regla *"verifica identidad con número de caso"* pide un dato que el sistema no emite | **Alta** | `onboarding/page.tsx:249`; `persona.service.ts:1929-1957` (plantilla) vs `:2698-2699` (siempre `[0]`); sin tabla de casos en el repo | Sin construir módulo: el "caso" **es** la oportunidad del pipeline (`opportunities` + `pipeline_stages`), que ya existe y ya se llama "Casos" en el sidebar. Falta (a) exponer un identificador legible de la oportunidad y (b) una tool de lectura `get_case_status(contact)` acotada al contacto resuelto del turno — el patrón exacto de `list_my_claims` en seguros | **M** |
| 7 | **Triggers de handoff que nadie escribe**: `consulta sobre caso existente` y `cliente actual` (plantilla, `:1918`) y `conflicto de intereses` (registry, `:568`) son descripciones de situación evaluadas con `text.includes()` contra el mensaje del cliente. Nunca disparan. En cambio `audiencia`, `urgencia legal` y `plazo legal vencido` sí son plausibles y están bien | Media | `handoff.service.ts:107-111` (substring); `persona.service.ts:1918`; `vertical-definitions.ts:568` | Reemplazar los 3 muertos por lo que la gente escribe: *"ya soy cliente"*, *"mi caso"*, *"mi expediente"*, *"el abogado que me atiende"*. Mismo defecto que technology (`presupuesto >$50M`) y finanzas (`monto > USD 50000`) | **XS** |
| 8 | **Confidencialidad sin need-to-know dentro del tenant**: cualquier usuario autenticado del despacho lee cualquier conversación. El inbox por defecto (`filter='all'`) no aplica **ningún** filtro por asignación, el `agentId` del filtro `mine` viaja como query param (no sale del JWT), y el endpoint de una conversación puntual no recibe siquiera la identidad del solicitante | **Alta** para el rubro (media en general) | `agent-console.controller.ts:12-13` (guards solo `jwt`+`RolesGuard`+`TenantGuard`), `:27-41` (`agentId` y `filter` desde query); `agent-console.service.ts:96-138` (el `switch` solo agrega `assigned_to` en `mine`; `all` queda sin restricción); `agent-console.controller.ts:54-67` (sin chequeo de propiedad) | No hace falta ACL por caso: alcanza con que el rol `tenant_agent` reciba solo conversaciones asignadas o sin asignar, forzado en el servicio contra el usuario del JWT y no contra el query. Es **la** función vendible del rubro (secreto profesional) y hoy es el hueco de compliance más citable | **M** |
| 9 | **El borrado GDPR deja el teléfono real en `campaign_recipients`**: el paso 6 busca `WHERE phone IN (SELECT phone FROM contacts WHERE id = $1)` **después** de que el paso 1 ya anonimizó `contacts.phone` a `[ERASED-xxxx]` → la subconsulta devuelve el marcador y las filas con el teléfono real nunca se tocan | Media (transversal) | `compliance.service.ts:205-210` (paso 1) vs `:244-250` (paso 6), ejecución secuencial con `await` | Capturar el teléfono antes del paso 1 y pasarlo por parámetro (o reordenar: `campaign_recipients` primero). Lo bueno: los pasos 3 y 4 **sí** redactan `messages.content_text` y limpian `conversations.metadata` (`:219-235`) — la conversación del caso legal sí se borra | **XS** |
| 10 | **Sin política de retención**: no hay purga por antigüedad de `messages`; el borrado es manual, por contacto y a pedido. Un despacho tiene obligación de conservación **y** de destrucción con plazos, y no puede declarar ninguno | Media | `compliance.service.ts` (solo `eraseContactData` a pedido, `:182`); sin cron de retención en el módulo | Retención por tenant (N meses) sobre `messages.content_text` reusando el redactado que ya existe. Sirve a salud y finanzas igual | **M** |
| 11 | **Sub-tipos 100% cosméticos**: 4 sub-tipos, 1 plantilla, 2 servicios iguales para todos. Un contador vende "declaración de renta" y "constitución de sociedad"; un arquitecto, "anteproyecto" y "visita técnica" | Media | `vertical-definitions.ts:561-566`; `persona.service.ts:2704-2715` (sin entradas); `verticals.service.ts:73-154` (sin rama) | 2-3 servicios y 5 FAQs por sub-tipo en el bootstrap. No hace falta plantilla nueva: la persona de Elena sirve a los cuatro | **S** |
| 12 | **Pipeline sin `transitionRules` + auto-progress que abre expedientes** (§2.6): "cuánto cobran" → Propuesta; "reservar" → En proceso. En un despacho, la etapa **es** una afirmación contractual | **Alta** | `vertical-definitions.ts:569-576` (sin `transitionRules`); `verticals.service.ts:264` (`'[]'`); mapeo `pipeline.service.ts:1443-1471`; léxicos `:85-89` | Sembrar reglas: Evaluación `[name_required, phone_required]`, Propuesta `[email_required]` (la plantilla ya exige email), En proceso `[appointment_required]`. El auto-progress las respeta como *soft-hold* (`:1373-1385`) y el board manual las exige duro. **Corta las dos mentiras sin tocar el motor** | **S** |
| 13 | **Fuera de español se pierde la mitad del vestuario**: `localizeVerticalTemplates` devuelve **una** plantilla y reemplaza `rules`/`forbiddenTopics` por los del registry → el despacho en inglés/portugués pierde `tpl_legal_seguimiento` y las 6 reglas finas (incluida la de confidencialidad entre clientes) | Media | `persona.service.ts:2585-2586`, `:2653-2665`; registry `vertical-definitions.ts:568` | Traducir las `rules`/`forbiddenTopics` de las 2 plantillas del rubro (12 frases) y localizar por plantilla en vez de colapsar a `[0]`. Es transversal, pero esta vertical y salud son las que más pierden | **S** (solo este rubro) / **M** (el mecanismo) |
| 14 | **KPIs y home ajenos al rubro**: hereda "Leads Hoy / Leads Calientes" y el home muestra los últimos 5 leads en vez de las consultas del día, en la vertical cuya única tool es la agenda | Media | `vertical-definitions.ts:525-530` (sin `dashboard`); `admin/page.tsx:85-86,:264-272` | 2 KPIs propios contra el dato real: "Casos abiertos" (COUNT no-terminal de `opportunities`) y "Consultas agendadas hoy" (`appointments`); y mover la industria a `APPOINTMENT_INDUSTRIES` — o mejor, incluirla en ambas listas (el widget ya soporta las dos ramas) | **S** |
| 15 | **La "audiencia" del alta ofrece un tipo de asunto como si fuera un público**: "Casos legales/contables" junto a "Personas naturales" y "Empresas" | Baja | `onboarding/page.tsx:340-344`; `es.json:4435` + 3 idiomas | Reemplazar por "Otros profesionales / despachos" o "Entidades públicas" | **XS** |
| 16 | **Emojis obligatorios en la confirmación de un despacho**: la regla 15 del L1 exige *"relevant friendly emojis"* en toda confirmación, contra `emojiUsage: 'none'` de la persona | Baja | `prompt-assembler.service.ts:84` vs `persona.service.ts:1904` | Condicionar la regla 15 a `persona.personality.emojiUsage !== 'none'`. Transversal (afecta a finanzas y seguros igual) | **XS** |
| 17 | **`tpl_legal_seguimiento` sin `knowledge`**: la plantilla de postventa no tiene la tool de KB, así que el cliente que pregunta algo general durante el seguimiento recibe improvisación en vez de la base cargada | Baja | `persona.service.ts:1954` (`tools: {appointments, crm}`) vs `:1925` (consulta sí la trae) | Agregar `knowledge: {enabled:true}`. Una línea | **XS** |

---

## 5. Lo que esta industria necesita y no tenemos

**Mesa de entrada** (sin esto no somos creíbles en el rubro):

1. **Que el agente atienda a quien dice "abogado"** (#1/#2). No es una feature: es dejar de bloquear el caso de uso. Sin esto, todo lo demás es decorado.
2. **Recibir documentos sin cortar la conversación** (#3). El rubro se comunica adjuntando. Recibir, guardar y avisar —sin leer ni interpretar— ya nos pone a la altura; hoy somos el único canal que responde "no puedo con eso".
3. **Confidencialidad demostrable dentro del tenant** (#8). El secreto profesional es EL diferenciador del rubro y hoy el argumento se cae en la primera pregunta seria: *"¿mi asistente puede leer los casos de familia?"*. Lo que **sí** tenemos y hay que saber vender, todo verificado: el L1 imborrable prohíbe divulgar datos de otros clientes y dar asesoría legal (`prompt-assembler.service.ts:95,:97`); el módulo `compliance/` trae textos legales tipados, registro de consentimientos, detección de opt-out, **borrado GDPR que redacta el contenido de los mensajes** (`compliance.service.ts:219-235`), exportación de datos del contacto y log de auditoría (`compliance.controller.ts:31-186`); el schema-per-tenant aísla físicamente los datos; y el cifrado AES-256-GCM protege credenciales. Falta el need-to-know interno (#8), la retención con plazo (#10) y el paso 6 roto del borrado (#9).
4. **Gobernanza de etapas** (#12). En un despacho, "Propuesta" y "En proceso" son hechos contractuales.
5. **El caso como identificador legible** (#6), reusando `opportunities`. Sin objeto nuevo.
6. **FAQs y servicios por sub-tipo** (#4/#11).

**Diferenciador** (solo si alguna vez se decidiera invertir — no es la recomendación):

- **Recordatorio de plazo (vencimiento fiscal / término procesal)**. Es el equivalente rubro del recall dental y de la renovación de póliza: sería el 7º vertical esperando el mismo evaluador temporal (belleza, dental, gym, seguros, vet, finanzas). Y acá el disparador es una **fecha del caso**, no inactividad — el mismo diseño ya cerrado en `seguros.md` sobre fechas de póliza. Un contador que avisa por WhatsApp "vence tu declaración el 15" tiene retención altísima.
- **Firma electrónica** de la carta de encargo/propuesta. Es lo que convierte "Propuesta" en un hecho verificable en vez de una probabilidad.
- **`qualify_case` como SOP en `procedures/`** (T2.12), no como tool nueva: materia → urgencia → plazo → resultado, con derivación. Es el patrón que `competitive-analysis-2026-q2.md:252-254` señala como nuestra validación (Lorikeet, grafo de decisión para *"fintech, salud, KYC"*).

**Integraciones LatAm que el rubro real usaría:** gestión de expedientes (Lexy, Lemontech/TimeBillingX en CL/CO), consulta de estado procesal (Rama Judicial CO, Poder Judicial), facturación electrónica —que ya tenemos vía Factus/DIAN para nuestro propio cobro—, y *trust accounting*. Ninguna es viable a escala PYME hoy, y `competitive-analysis-2026-q2.md:404` lo dice explícitamente: los especialistas tienen años de profundidad en el system-of-record (*"PMS, POS, EHR, trust accounting, compliance HIPAA"*), replicarlo es *"trampa de recursos y riesgo regulatorio"*, y nuestra ventaja defendible es *"la capa conversacional multicanal + booking determinístico"*. **Es el argumento técnico de la genérica-honesta, escrito por nosotros mismos.**

---

## 6. Competencia del rubro (solo desde nuestros docs)

- **Demanda documentada: existe, pero es chica y periférica.** El top-10 de nichos (`market-research-latam.md:380-391`) **no** incluye servicios profesionales. Sí aparece dos veces en el mapa por país: **Puerto Rico #4 "Legal services"** (`:230`) y **Uruguay #4 "Professional services (legal, accounting)"** (`:339`). Es más de lo que tiene finanzas como nicho propio (cero), y menos que cualquier vertical del top-10.
- **Y esas dos apariciones son de las mejores plazas para cobrar caro.** De Puerto Rico el research dice *"USD billing, US credit cards… Potentially the easiest billing environment in the region after Panama. Premium tier pricing could work here"* (`:233`). De Uruguay: *"Small but wealthy market… highest [internet] in LatAm and high SaaS willingness to pay. A natural Pro/Enterprise market despite small population"* (`:341`). Un despacho uruguayo o boricua es exactamente el tenant de plan Pro que `plan-profitability-2026-07.md` quiere. **No justifica un módulo; sí justifica que la vertical no sea vergonzosa.**
- **Nadie compite acá en nuestro mapa.** El clúster D LatAm —Yalo, Blip, Zenvia, Aivo, Cliengo, Treble, Botmaker, Leadsales, Whaticket, Auronix, Gupshup, 360dialog (`competitive-analysis-2026-q2.md:74`)— no tiene a ninguno posicionado en servicios profesionales. **Thryv** valida los presets por industria con pricing US-céntrico $199-499/ubicación (`:420`), que *"deja espacio enorme en LatAm"*. No hay un "Mindbody de los abogados" en nuestro análisis contra el que perder.
- **La estrategia canónica ya decidió este caso.** `competitive-analysis-2026-q2.md:404` — *"thin vertical, deep horizontal"*: integrar, no profundizar, donde el especialista dueño del system-of-record incluye explícitamente el *trust accounting* (el software del despacho). Servicios profesionales es el ejemplo de manual de esa doctrina: capa conversacional + agenda determinista, y nada de expediente.
- **`vertical-strategy.md:158-166` propone 4 tools para el rubro** (`schedule_consultation`, `get_services_and_fees`, `qualify_case`, `request_documents`) y ninguna se construyó. Auditadas contra el código: `schedule_consultation` **ya existe** (motor de reservas + APPOINTMENT_TOOLS), `get_services_and_fees` **ya existe** (`list_services` con `price`), `qualify_case` es texto libre que el LLM hace mejor sin tool (y como SOP si se invierte), y `request_documents` es **inconstruible** hasta arreglar #3. Es decir: la estrategia declaraba 4 huecos y el hueco real es **uno**, y está en la plataforma, no en la vertical.

---

## 7. Plan de inversión de ESTA vertical

Coherente con §1: **genérica-honesta + apagar el desactivador + gobernar las etapas**. Sin módulo, sin tablas nuevas, sin página propia.

**Quick wins (días)**

1. **Sacar `abogado` y `demanda` de `complaintKeywords`** (#1). `handoff.service.ts:76`. Es el ítem de mayor retorno del dossier: desbloquea el intake del rubro. **XS.**
2. **`transitionRules` en 3 etapas** (#12): Evaluación `[name_required, phone_required]`, Propuesta `[email_required]`, En proceso `[appointment_required]`. `vertical-definitions.ts:569-576`. Corta "preguntó el precio → Propuesta" y "reservó → En proceso" sin tocar el auto-progress. **S.**
3. **5 FAQs propias por sub-tipo dominante** (#4), patrón `seedToursExtras`, en 4 idiomas. Propuesta concreta:
   - **Abogados**: ¿cuánto cuesta la primera consulta y qué incluye? · ¿atienden mi materia (laboral/familia/penal/civil)? · ¿trabajan por cuota litis o por honorario fijo? · ¿cuánto suele demorar un proceso como el mío? · ¿qué documentos llevo a la primera reunión?
   - **Contadores**: ¿qué necesito para la declaración de renta? · ¿llevan la contabilidad mensual de una PYME? · ¿cuándo vence mi obligación? · ¿me ayudan con la constitución/registro de la sociedad? · ¿cómo cobran, por hora o por iguala?
   - **Arquitectos**: ¿hacen visita técnica y cuánto cuesta? · ¿qué incluye un anteproyecto? · ¿gestionan la licencia de construcción? · ¿cuánto demora el diseño? · ¿trabajan por m² o por porcentaje de obra?
   - **Consultores**: ¿cómo es la primera sesión de diagnóstico? · ¿trabajan por proyecto o por retainer? · ¿tienen casos en mi industria? · ¿firman NDA? · ¿el trabajo es remoto o presencial?
   Y quitar la de devoluciones. **S.**
4. **Triggers de handoff reales** (#7): reemplazar `consulta sobre caso existente` / `cliente actual` / `conflicto de intereses` por *"ya soy cliente"*, *"mi caso"*, *"mi expediente"*. `persona.service.ts:1918` + `vertical-definitions.ts:568`. **XS.**
5. **Reescribir la regla del "portal seguro"** (#5a) para que no prometa lo que no existe. `persona.service.ts:1948`. **XS.**
6. **`knowledge` en `tpl_legal_seguimiento`** (#17). Una línea, `persona.service.ts:1954`. **XS.**
7. **Arreglar el paso 6 del borrado GDPR** (#9). `compliance.service.ts:244-250`. Transversal, XS, y es el tipo de detalle que se pregunta en una venta a un despacho. **XS.**
8. **2 KPIs propios + agenda en el home** (#14). `vertical-definitions.ts` (bloque `dashboard`) + `admin/page.tsx:85-86`. **S.**
9. **Audiencia "Casos legales/contables" → un público real** (#15), 4 idiomas. **XS.**

**Mediano (semanas)**

1. **`handoffCategories` alcanzable** (#2): 5 toggles en el editor de agente + i18n×4. El lector ya existe; hoy el mecanismo está escrito y muerto. Sirve a las 18 verticales. **S.**
2. **Documentos entrantes que no cortan el turno** (#3): persistir el adjunto con el pipeline de media existente y pasarle al LLM `[El cliente envió un documento: "nombre.pdf"]`. Sin OCR. `conversations.service.ts:1383-1392` + `media-processing/`. **M.**
3. **Need-to-know del `tenant_agent`** (#8): el filtro de asignación se fuerza en el servicio, no en el query param. `agent-console.controller.ts:27-67` + `agent-console.service.ts`. Es la pata vendible de confidencialidad. **M.**
4. **El caso como identificador legible + `get_case_status`** (#6) sobre `opportunities`, patrón `list_my_claims` de seguros, identidad por `contact_id` del turno (nunca pidiendo documento — el L1 lo prohíbe, `prompt-assembler.service.ts:94`). **M.**
5. **Servicios y FAQs por sub-tipo** (#11) en el bootstrap. **S.**
6. **Traducir las reglas de las 2 plantillas + localizar por plantilla** (#13). **S** acá, **M** el mecanismo compartido.

**Apuesta (solo si el dueño decide invertir contra la recomendación)**

1. **Recordatorio de plazo del caso** (vencimiento fiscal / término procesal) sobre el evaluador temporal que ya esperan otras 6 verticales, disparado por **fecha del caso** y no por inactividad. Es el único diferenciador con retención real del rubro. **M-L** (compartido).
2. **Portal del cliente con documentos** (#5b): la autenticación OTP ya está resuelta (`customer-portal.service.ts`); falta UI y un endpoint de documentos. Cierra a la vez el "portal seguro" de la plantilla y la promesa de confidencialidad. **L.**
3. **SOP de calificación de caso** sobre `procedures/` (T2.12). **M.**

**Lo que NO se hace:** módulo `legal`/`cases` con tablas propias, expediente, control de términos procesales, *trust accounting*, integración con gestores de despacho ni consulta de estado procesal. Es exactamente la "trampa de recursos y riesgo regulatorio" que nuestro propio análisis competitivo nombra (`competitive-analysis-2026-q2.md:404`).

**Frontera con technology (para el dossier 17):** `consultores` (acá) y `consultoria_ti` (technology, `onboarding/page.tsx:150`) son el mismo negocio para muchos tenants, y hoy la elección decide dos personas opuestas — Elena formal de despacho vs el SDR B2B con BANT — sin ninguna guía en el alta. Mismo patrón que "Peluquería canina" en vet/pet y "Seguros" en finanzas/seguros. No lo resuelve este dossier: lo hereda el 17, que es quien conoce el lado B2B.

---

## 8. Qué no se verificó

- **Conversación real end-to-end**: los 3 turnos de §3(b) están reconstruidos leyendo el pipeline (orden handoff→media→LLM, registro de tools, motor de reservas, auto-progress), no ejecutando turnos contra la API. En particular, que `'abogado'` dentro de *"necesito un abogado"* dispare `complaint` se afirma del `some(kw => text.includes(kw))` (`handoff.service.ts:78`), sin correr la función.
- **Los mapeos de etapa de §2.6** se dedujeron del código (`mapGenericToTenantStage`, `bestDiff` con `<` estricto sobre pool no-terminal ordenado por `position ASC`, `pipeline.service.ts:1443-1471`), sin ejecutar.
- **Tenant real de servicios profesionales**: no hay producción; no se inspeccionó ningún schema sembrado. Todo el bootstrap es lectura del seeder.
- **El paso 6 roto del borrado GDPR** (#9) se dedujo del orden secuencial de los `await` (`compliance.service.ts:205` antes de `:244`); no se ejecutó el borrado contra una base con datos.
- **Ownership del inbox** (#8): se leyeron el controlador y el `switch` de filtros de `getInbox` (`agent-console.service.ts:96-138`), pero **no** el SQL completo que sigue (`:140+`) ni el resto de superficies que leen conversaciones (WebSocket `/inbox`, analytics, copiloto). La afirmación cubre estos dos endpoints REST, no una auditoría de acceso completa.
- **i18n de pt/fr/en más allá de la existencia de las claves**: se verificó que los 9 bloques existen en los 4 JSON, no la calidad de cada traducción.
- **Comportamiento del LLM ante la regla 15 vs `emojiUsage: 'none'`** (#16): se afirma la contradicción entre instrucciones, no cuál gana en el output.
- **Cuánto del volumen real de un despacho es "documento entrante"**: no hay dato en nuestros docs; la afirmación de §5 es una inferencia del rubro, no una cita.
