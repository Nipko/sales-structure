# Finanzas — deep-dive (Jul 2026)

> Dossier 15/18 de `docs/vertical-deep-dives/`. Fuente: código leído (archivo:línea), ficha `vertical-maturity-audit-2026-07.md` §4, `cluster-servicios.json`, y mercado solo desde nuestros docs.

## 1. Veredicto y tesis de inversión

**GENÉRICA-HONESTA — con una excepción que se rutea, no se construye.** Hoy finanzas es exactamente lo que dice la matriz (12/36): una `createGenericVertical` (`vertical-definitions.ts:536`) con tres cosas propias bien hechas — persona prudente (Roberto, formal, "nunca garantices rendimientos ni aprobación"), el mejor pipeline de crédito del catálogo (Consulta→Pre-aprobación→Documentación→Evaluación→Aprobado/Rechazado, `:545-552`) y la capa cosmética completa en 4 idiomas (checklist, empty states, saludo del panel) — y cero de todo lo demás: cero tools de industria, cero módulos, cero rama en `bootstrapVertical`, cero FAQs propias (hereda las 5 genéricas, incluida "¿Tienen política de devolución?" en una financiera, `:516-520`), cero KPIs del rubro y cero líneas en `vertical-strategy.md`. Post-`b9bd6332` sí hace bien **una** cosa completa: pre-califica por chat y agenda la asesoría — circuito verificado end-to-end en §2.5.

**Por qué no invertir en profundidad.** Ningún doc nuestro rankea "finanzas" como nicho: el top-10 de `market-research-latam.md:380-391` no la incluye — lo que sí incluye es **Insurance Brokers #9 (WTP 9/10)**. Y las tres apariciones de "financial" en el mapa por país son literalmente *"Financial services / **insurance brokers**"* (Panamá #1 `:192`, Argentina #3 `:324`, Brasil #4 `:364`). La demanda documentada de finanzas **es demanda de seguros**. A eso se suma un techo estructural que ninguna vertical más tiene: el contrato L1 imborrable prohíbe *"Financial investment advice as if you were a licensed advisor"* y *"Requesting … government IDs"* (`prompt-assembler.service.ts:94,:98`) — el acto central del sub-tipo "asesoría financiera" y la captura que su propia plantilla ordena están enumerados como prohibidos en la capa que no se puede sobrescribir. Un rubro cuyo núcleo nuestro propio contrato de seguridad veta no puede ser una vertical profunda honesta.

**Recomendación:** (a) **rutear `finanzas>seguros` → vertical `seguros`** en el alta — hoy ese sub-tipo duplica una vertical entera sin puente y deja al broker sin las 6 tools de insurance, sin `/admin/insurance` (el ítem del sidebar está gateado a `verticals: ["seguros"]`, `AppSidebar.tsx:134`) y sin catálogo; es el único caso de finanzas con WTP documentado y no requiere construir nada; (b) mantener el resto **genérico y digno**: 5 FAQs del rubro, KPIs de solicitudes, `transitionRules` en el pipeline, y quitar la contradicción cédula-vs-L1 heredando el diseño ya cerrado en `seguros.md` (contact_id match + OTP del customer portal, nunca pedir el documento por chat). Nada de módulo financiero: sin buró, sin core bancario y sin scoring no hay diferenciación posible.

---

## 2. Radiografía end-to-end

### 2.1 Alta (`apps/dashboard/src/app/onboarding/page.tsx`)

| Paso | Qué ve el dueño | Archivo:línea |
|---|---|---|
| Industria | "Finanzas / Banca" (4 idiomas) | `:46`; `messages/es.json:3995` |
| Sub-tipo | Seguros · Asesoría financiera · Fintech · Créditos y préstamos | `:130-135` |
| Objetivos | Pre-calificar solicitudes · Informar sobre productos financieros · **Agendar asesorías** · Soporte y seguimiento | `:239-244` |
| Audiencia | Personas naturales · Empresas y PYMES · **Inversionistas** | `:335-339` |

Los 4 sub-tipos coinciden exactamente con los del registry (`vertical-definitions.ts:537-542`): finanzas es de las pocas verticales **sin drift** entre la lista hardcodeada del alta y el registry. Pero **ninguno de los 4 hace nada**: no aparecen en el mapa `bySubType` de `createDefaultAgentFromGoals` (`persona.service.ts:2704-2715`) ni en ninguna rama de `bootstrapVertical` (`verticals.service.ts:73-154`). El sub-tipo se persiste en `tenant.settings.subType` (`verticals.service.ts:173`) y muere ahí.

Los objetivos y la audiencia sí llegan al prompt L3 post-`5c2581db` (`conversations.service.ts:1622-1648`, cache `bizgoals:{tenantId}` 600s): "Pre-calificar solicitudes" e "Inversionistas" son texto que el LLM lee. Es el único canal por el que el alta influye en el agente.

### 2.2 Agente creado (`persona.service.ts`)

`createDefaultAgentFromGoals` (`:2672`) toma **siempre** `verticalTemplates[0]` cuando hay industria (`:2698-2699`); los goals solo eligen plantilla si NO hay plantilla vertical (`:2726`). Finanzas no tiene entrada en `bySubType` → **los 4 sub-tipos reciben el mismo agente**.

**`tpl_finanzas_calificador`** (`:1823-1861`) — "Roberto, Pre-calificador de Créditos":
- Persona formal, sin emojis, greeting "¿crédito, seguro o asesoría?" (`:1833`).
- Reglas (`:1837-1844`): *pregunta monto solicitado, ingreso mensual y plazo deseado* · nunca prometas aprobación · *captura nombre completo, cédula/RFC, teléfono y email antes de escalar* · si piden tasas exactas escala · reclamos escalan · aclara que la información es general.
- `handoffTriggers` (`:1846`): `reclamo`, `cifras exactas de tasas`, `queja regulatoria`, `caso complejo`, `monto > USD 50000`.
- `requiredFields` (`:1847-1851`): name y phone obligatorios.
- `tools` (`:1858`): `crm` + `knowledge` + **`appointments {canBook, canCancel}`** ← el fix `b9bd6332`.

**`tpl_finanzas_renovaciones`** (`:1863-1890`) — postventa: verifica identidad con *cédula + fecha de nacimiento o referencia de póliza* (`:1878`), no comparte saldos por chat ("usa portal seguro", `:1880`), `tools: {crm, appointments{canCancel:false}}` (`:1887`). **Nunca se selecciona sola** — solo si el dueño la elige a mano.

Después, `patchDefaultAgent` (`verticals.service.ts:293-363`) rellena huecos con el registry sin pisar la plantilla, pero **une** `forbiddenTopics` y `handoffTriggers`. Triggers efectivos del agente de finanzas = los 5 de la plantilla **+** `solicitud formal|monto alto|queja regulatoria|reclamo|fraude` del registry (`vertical-definitions.ts:544`).

### 2.3 Bootstrap (`verticals.service.ts:22-183`)

Finanzas **no tiene rama propia**; recibe solo el tronco común:

| Paso | Qué siembra en finanzas | Línea |
|---|---|---|
| `seedPipelineStages` | 6 etapas de crédito con `transition_rules = '[]'` (la definición no trae ninguna) | `:36`, `:244-271` |
| `patchDefaultAgent` | rellena huecos + une triggers/prohibiciones | `:39` |
| `seedFaqs` + `enableSimpleTool('faqs')` | **las 5 FAQs genéricas** (horario, pagos, contacto, ubicación, devoluciones) | `:45-46` |
| `seedServices` | 1 servicio: "Asesoría gratuita", 30 min, $0 COP | `:49-51`; def. `vertical-definitions.ts:556` |
| `seedAvailability` | slots desde `businessHours` **genérico**: lun-vie 08:00-18:00 | `:56-58`; def. `:523` |
| `restoreAppointmentsTool` | reenciende `appointments` (services=1, slots>0) | `:67`, `:1100-1143` |
| Ramas por industria (`:73-154`) | **ninguna aplica** — ni siquiera `enableInsuranceTool`, que está gateado a `industry === 'seguros'` (`:125-127`) | — |
| Config resuelta | terminology (cliente/solicitud/producto financiero/solicitudes), sidebar, dashboard, `bookingEnabled:true` | `:157-176` |

### 2.4 Conversación — qué puede hacer la IA de verdad

Registro por turno en `conversations.service.ts:1810-1901`. Un tenant de finanzas recién creado lleva 4 flags: `appointments`, `crm`, `knowledge` (plantilla) + `faqs` (bootstrap).

| tool | qué hace | gating | ¿funciona e2e? |
|---|---|---|---|
| **Motor de reservas** (determinista, corre ANTES del LLM) | servicio→fecha→hora contra `availability_slots`; emite interactivos en WA | `config.tools.appointments.enabled === true` (`:1655-1667`) | **Sí** post-`b9bd6332` — verificado en §2.5. Limitación transversal: capacidad 1 por franja |
| `APPOINTMENT_TOOLS` (`list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, +4) | consulta/crea/cancela cuando el motor no captura el turno | `cfgTools.appointments.enabled` (`:1811`) | Sí, con la misma limitación mono-recurso |
| `FAQ_TOOL` (`search_faqs`) | busca en las FAQs sembradas | `cfgTools.faqs.enabled` (`:1817`), encendido por bootstrap (`:46`) | Sí — pero el contenido no es financiero (§4 #4) |
| `KB_TOOL` (`search_knowledge_base`) | RAG sobre la KB del tenant | `cfgTools.knowledge.enabled` (`:1823`) | Sí si el dueño carga documentos; vacío el día 1 |
| `CUSTOMER_CONTEXT_TOOL` (`get_customer_context`) | lead score, tags, etapa, última interacción | `cfgTools.crm.enabled` (`:1832`) | Sí (solo lectura, `crm-tools.ts:24-28`) |
| `INSURANCE_TOOLS` (6) | planes, cotización, póliza, reclamo | `cfgTools.insurance.enabled` (`:1890`) — solo lo enciende `industry==='seguros'` | **No para finanzas**, ni con sub-tipo `seguros`. Hueco #1 |
| *pre-calificación estructurada* | — | — | **No existe**: ninguna de las 80+ tools del executor escribe datos del cliente (§4 #2) |

**Lo que no hay y el rubro pediría:** simulador de cuota, captura de solicitud, consulta de estado de solicitud, subida de documentos. Ninguna existe ni está planeada — el barrido del `switch` de `ai-tool-executor.service.ts:76-340` no tiene una sola tool financiera.

### 2.5 Agenda — circuito agendar-asesoría verificado end-to-end

El encargo pedía verificar el circuito completo, no re-reportar el fix. Recorrido real:

1. **Alta** → `createDefaultAgentFromGoals` inserta `tpl_finanzas_calificador` con `appointments.enabled = true` (`persona.service.ts:1858`).
2. **Gate blando** (`persona.service.ts:2754-2765`): corre ANTES del bootstrap; el schema aún no tiene servicios ni slots → apaga la tool y deja `pendingPrerequisites: true`.
3. **Bootstrap** siembra 1 servicio activo (`verticals.service.ts:49-51`) + slots lun-vie 08:00-18:00 (`:56-58`).
4. **`restoreAppointmentsTool`** (`:1100-1143`) ve el marcador, recuenta (`services=1, slots>0`) → `enabled: true` y borra el marcador.
5. **Runtime**: `conversations.service.ts:1655` lee el flag → entra el motor determinista; `:1811` registra además las APPOINTMENT_TOOLS.

**Veredicto: el circuito cierra.** Las dos trampas que lo rompen en otras verticales no se dan acá: el servicio dura 30 min y entra de sobra en la ventana diaria de 600 min (no es el "Hotel — noche" de pet_services ni la boda de 480 min de fotografía), y el precio $0 no exige pasarela. Riesgos que sí quedan, todos transversales y conocidos: capacidad 1 (la financiera con 3 asesores rechaza al segundo cliente de las 10:00) y el chat ignora `blocked_dates`. Detalle propio de finanzas: el horario sembrado sale del `businessHours` **genérico** (08:00-18:00 lun-vie), no de uno del rubro — para una asesoría financiera es razonable; es de las pocas verticales donde el default genérico no miente.

### 2.6 Pipeline — el activo, y su reverso

Las 6 etapas (`vertical-definitions.ts:545-552`) modelan el ciclo real de un crédito con probabilidades sensatas (10/30/50/70/100/0) y dos terminales de polaridad opuesta. **No llevan `offer_required`** — esa regla vive en el pipeline genérico de `createGenericVertical` (`:511`) y finanzas sobrescribe `pipeline` entero, así que nunca la heredó (precisión sobre el listado de `5c2581db`: en finanzas no había nada que quitar).

Reverso: **ninguna etapa tiene `transitionRules`** → se siembran con `'[]'` (`verticals.service.ts:264`) y nada gobierna el avance. Y como el auto-progress mapea los slugs genéricos a los del tenant **por probabilidad** (`pipeline.service.ts:1443-1471`), el mapeo real en finanzas es:

| Señal del cliente (es) | Slug genérico (prob) | Etapa de finanzas donde cae |
|---|---|---|
| primera respuesta de la IA | `contactado` (20) | Consulta (10) — empata con Pre-aprobación (30) y gana la anterior por `<` estricto → **no avanza** |
| "me interesa", "dale", "perfecto" | `respondio` (30) | **Pre-aprobación** (30, exacto) |
| "precio", "cuánto", "tasa", "cuándo" | `calificado` (50) | **Documentación** (50, exacto) |
| "lo quiero", "confirmo", "pagar" | `listo_para_cierre` (95) | **Evaluación** (70) |

(Léxicos en `pipeline.service.ts:85-89`.) Es decir: **decir "me interesa" pre-aprueba un crédito y preguntar el precio lo manda a Documentación** — sin un dato capturado ni un documento recibido, y sin ninguna regla que lo frene porque finanzas no tiene ninguna. En un rubro regulado, una tarjeta en "Pre-aprobación" es una afirmación de hecho sobre un proceso crediticio que no ocurrió. Lo único que salva: el auto-progress nunca mueve a terminal (el pool es solo no-terminales, `:1461`), así que "Aprobado" nunca se escribe solo.

### 2.7 Dashboard del tenant

- **Sidebar** (`vertical-definitions.ts:553`): `crm → "Clientes"`, `pipeline → "Solicitudes"`; oculta `inventory`, `orders`, `catalog`. Correcto.
- **KPIs**: finanzas no sobrescribe `dashboard` → hereda los 4 genéricos (`:525-530`): Leads Hoy · Leads Calientes · Mensajes · Costo IA. Cero KPIs del rubro (solicitudes por etapa, monto solicitado, tasa de aprobación).
- **Página propia**: ninguna. `admin/page.tsx:86` incluye finanzas en `PIPELINE_INDUSTRIES` (el panel muestra el embudo en vez de la agenda) y el `ToolsTour` la manda solo a `/admin/appointments` (`ToolsTour.tsx:84-86`) — honesto: es la única herramienta que tiene.
- **Cosmética**: **completa en 4 idiomas** — objetivos y audiencias (`es.json:4336,4430`), terminología (`:4480`), empty states ("Las solicitudes de crédito o pólizas iniciarán aquí", `:5978`), checklist ("Configura tu asistente financiero", `:6064`) y saludo del panel ("Tu oficina financiera está lista, {name}", `:6108`). Finanzas es de las 11 originales: tiene la capa que les falta a las 6 nuevas.

### 2.8 Integraciones

Ninguna, ni existente ni planeada: sin core bancario, sin buró (DataCrédito/TransUnion), sin originación, sin firma electrónica. Las 3 de T3.19 (Toast/Mindbody/Cliniko) no aplican.

---

## 3. La experiencia hoy, contada honestamente

### (a) El dueño en sus primeros 30 minutos

Una asesoría de créditos de 3 personas en Bogotá elige "Finanzas / Banca" → "Créditos y préstamos" → marca los 4 objetivos, incluido "Agendar asesorías". El alta se siente **precisa**: los sub-tipos son los suyos, la audiencia dice "Personas naturales / Empresas y PYMES / Inversionistas", el panel lo recibe con "Tu oficina financiera está lista" y el checklist le habla en su idioma ("Carga tus productos y políticas", "Invita a tus asesores"). El sidebar dice "Clientes" y "Solicitudes" y no le muestra Inventario ni Catálogo. **Es la mejor primera impresión del Tier "de plantilla".**

A los 10 minutos empieza el desajuste. Abre Citas: hay **un** servicio, "Asesoría gratuita, 30 min, $0", y horarios lun-vie 08:00-18:00 que él no puso. Abre el embudo: seis columnas exactas de su negocio (Consulta → … → Aprobado/Rechazado) y ningún criterio para pasar de una a otra. Abre FAQs y encuentra cinco preguntas que no son de su rubro — una le pregunta por su **política de devolución**. Busca dónde cargar sus productos (crédito de libre inversión, libranza, microcrédito) y no hay dónde: la única vía es la base de conocimiento como texto. Si eligió el sub-tipo "Seguros", el desajuste es mayor: no aparece ninguna pantalla de pólizas, porque el ítem `/admin/insurance` del sidebar está gateado a `verticals: ["seguros"]` (`AppSidebar.tsx:134`) y él eligió finanzas.

**Dónde brilla:** el vestuario (persona, terminología, pipeline, cosmética) y que la agenda funciona sin tocar nada. **Dónde se cae:** no hay ningún objeto de negocio propio — el producto financiero no existe como dato. **Dónde miente:** las FAQs sembradas (habla de devoluciones), y el sub-tipo "Seguros" que promete un rubro entero y entrega el genérico.

### (b) El cliente final por WhatsApp, primeros 3 mensajes

> **— Hola, quiero información de un crédito de libre inversión.**
> — Hola, soy Roberto, asesor financiero. ¿En qué producto puedo orientarte: crédito, seguro o asesoría?

Bien: la persona es la correcta y el tono es el del rubro.

> **— Necesito $30 millones a 48 meses, gano $4.500.000. ¿Cuánto me quedaría la cuota?**
> — [respuesta libre del LLM: no puede calcular con datos reales; deriva a asesor o da un rango con disclaimer]

Acá se ve el hueco central. El cliente entregó los **tres** datos que la plantilla ordena pedir (monto, plazo, ingreso) y **no hay dónde guardarlos**: ninguna tool escribe atributos del contacto (§4 #2), así que el dato vive solo en el texto del mensaje. El asesor humano que reciba el caso va a leer la conversación entera para reconstruirlo. Y si el cliente hubiera pedido la tasa exacta, la palabra dispara el handoff por trigger — correcto y deseado en un regulado.

Efecto colateral en el mismo turno: "cuánto" es keyword de intención → el auto-progress lo mueve a **Documentación** (§2.6). El dueño ve en su tablero un crédito "en documentación" que solo hizo una pregunta.

> **— Listo, agendame con un asesor.**
> — [motor de reservas: propone "Asesoría gratuita", ofrece fechas, confirma]

Cierra bien. **Este es el producto real de finanzas hoy y funciona**: recibir, calificar en lenguaje natural, escalar por los temas correctos y agendar. Lo que no hace es dejar rastro estructurado de la calificación — que es justo lo que el nombre de la plantilla promete ("Pre-calificador").

**Riesgo aparte:** si el cliente pregunta "¿me conviene invertir en un CDT o en un fondo?", el contrato L1 (`prompt-assembler.service.ts:98`) instruye responder *"I'm not able to help with that…"* para asesoría de inversión. En el sub-tipo "Asesoría financiera", cuya audiencia declarada incluye "Inversionistas", el agente rechaza la consulta central del negocio. No es un bug: es la política de la casa, y es la razón honesta por la que finanzas no puede ser profunda.

---

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **`finanzas>seguros` duplica la vertical seguros sin puente**: el broker recibe persona de créditos, pipeline de crédito, sin `INSURANCE_TOOLS` (gate `industry==='seguros'`), sin `/admin/insurance` (sidebar gateado a `verticals:["seguros"]`) y sin planes. Además el label "Seguros" aparece DOS veces en el mismo wizard (industria `:46` y sub-tipo `:131`) sin ninguna guía — el mismo patrón del "Peluquería canina" vet/pet | **Alta** | `vertical-definitions.ts:538`; `verticals.service.ts:125-127`; `conversations.service.ts:1890`; `AppSidebar.tsx:134`; `onboarding/page.tsx:46,131` | Rutear en el punto único de normalización `auth.service.ts:1562` (`const industry = company.industry \|\| data.industry`): si `industry==='finanzas' && subType==='seguros'` → `industry='seguros'`, `subType='broker'`. Fluye solo a `tenant.industry` (`:1593`), agente (`:1663`), business info (`:1679`) y bootstrap (`:1694`). **No** alcanza con encender la tool en el bootstrap: sin el ítem de sidebar el catálogo queda impoblable (existente-pero-inalcanzable) | **XS** (2 líneas) + quitar el sub-tipo del alta |
| 2 | **La pre-calificación no tiene destino**: la plantilla ordena capturar monto/ingreso/plazo (`persona.service.ts:1838`) y ninguna de las 80+ tools del executor escribe datos del contacto — no existe `update_contact`, `set_custom_attribute` ni equivalente. El riel SÍ existe: `custom_attribute_values` + `custom_attribute_definitions` con tipos, y el motor de reglas ya los lee (`pipeline.service.ts:838-855`, tipos `custom_attribute_required`/`custom_attribute_equals`) | **Alta** | Barrido completo del `switch` `ai-tool-executor.service.ts:76-340` (0 tools de escritura sobre contacto/lead); `crm.controller.ts:364` (límite de plan `customAttributes` — la feature está vendida) | Una tool transversal `save_customer_field(key, value)` acotada a definiciones existentes del tenant + sembrar 3 definiciones en el bootstrap de finanzas (`monto_solicitado`, `ingreso_mensual`, `plazo_meses`). Sirve a technology (BANT), servicios_profesionales (tipo de caso) y `otro` | **M** |
| 3 | **Pipeline sin `transitionRules` + auto-progress que "pre-aprueba"**: "me interesa"→Pre-aprobación, "cuánto"→Documentación (§2.6). En un regulado, la etapa es una afirmación de hecho | **Alta** | `vertical-definitions.ts:545-552` (sin `transitionRules`); `verticals.service.ts:264` (`'[]'`); mapeo por probabilidad `pipeline.service.ts:1443-1471`; léxicos `:85-89` | Sembrar reglas: Pre-aprobación `[name_required, phone_required]`, Documentación `[custom_attribute_required: monto_solicitado]` (requiere #2), Evaluación `[appointment_required]`. El auto-progress ya las respeta como *soft-hold* (`:1373-1385`) y el board manual las exige duro | **S** (dependiente de #2 para la de Documentación) |
| 4 | **FAQs genéricas en una financiera**: hereda las 5 del fallback, incluida "¿Tienen política de devolución?" — finanzas no sobrescribe `faqs` en `createGenericVertical` | Media | `vertical-definitions.ts:515-521` + bloque FINANZAS `:536-557` (sin clave `faqs`) | 5 FAQs propias en el estilo prudente del registry: requisitos, tiempos de aprobación, documentos, tasas ("te las confirma un asesor"), seguridad de datos. Patrón `seedToursExtras` ya existe | **S** |
| 5 | **Contradicción cédula ↔ contrato L1**: la plantilla ordena "captura nombre completo, cédula/RFC" (`:1840`) y la de renovaciones "verifica identidad (cédula + fecha de nacimiento)" (`:1878`), mientras el L1 imborrable prohíbe pedir *government IDs* | Media | `persona.service.ts:1840,:1878` vs `prompt-assembler.service.ts:94` | **Heredar el diseño de `seguros.md`** (no rediseñar): quitar la cédula de las 2 plantillas; identidad = match por `contact_id` (el contacto ya está resuelto en el turno) y, cuando no matchea, OTP del customer portal existente | **XS** (plantillas) + M (OTP, compartido con seguros) |
| 6 | **KPIs y objetivos declarados sin métrica**: hereda "Leads Hoy / Leads Calientes"; el rubro mide solicitudes por etapa y monto en trámite. El dato existe (`opportunities`, `pipeline_stages`) | Media | `vertical-definitions.ts:525-530` (FINANZAS sin `dashboard`) | 2 KPIs propios: "Solicitudes activas" (COUNT no-terminal) y "En evaluación". Mismo patrón que el KPI de seguros, pero contra el dato real (evitar el vicio `leadsHot` con label nuevo) | **S** |
| 7 | **Triggers de handoff que nunca disparan**: `monto > USD 50000` (`:1846`) y `monto alto` (registry `:544`) son condiciones lógicas evaluadas por `text.includes()` (`handoff.service.ts:107-111`) | Baja | `handoff.service.ts:107-111` | Reemplazar por keywords reales del rubro ("crédito empresarial", "hipotecario", "libranza", "millones") o dejar la señal estructurada para cuando exista #2 | **XS** |
| 8 | **Solapamiento silencioso de triggers**: `reclamo` está en la plantilla (`:1846`) Y en el registry (`:544`) Y en `complaintKeywords` del núcleo (`handoff.service.ts:74`), junto con `devolucion`, `reembolso`, `demanda`, `abogado`. En finanzas el escalado de reclamos es **deseado**, así que acá el solapamiento no rompe nada (a diferencia de seguros/hogar/retail, donde anula el intake) — pero conviene saberlo antes de construir cualquier flujo de postventa financiera | Baja (informativa) | `handoff.service.ts:73-80` | Ninguno hoy. Si algún día existe un intake de reclamos financieros, sacar `reclamo` de los triggers primero | — |
| 9 | **Un solo servicio sembrado para 4 sub-tipos**: "Asesoría gratuita" sirve a créditos y a asesoría, pero un fintech o un corredor esperan otra cosa; y el sub-tipo no cambia nada (`bySubType` sin entradas de finanzas) | Baja | `vertical-definitions.ts:556`; `persona.service.ts:2704-2715` | Con #1 resuelto quedan 3 sub-tipos; sembrar 2 servicios por sub-tipo (créditos: "Asesoría de crédito"; asesoría: "Diagnóstico financiero"). Barato pero de bajo retorno | XS |
| 10 | **`tpl_finanzas_renovaciones` inalcanzable de hecho**: buena plantilla (verificación, no-datos-por-chat, escalado de cambios contractuales) que nunca se selecciona automáticamente; el dueño tiene que descubrirla en el editor | Baja | `persona.service.ts:1863`; selección `:2698-2699` | Si se implementa el multi-agente por conexión, ofrecerla como "segundo agente sugerido" en el checklist. Alternativa barata: mencionarla en el ToolsTour | XS-S |

---

## 5. Lo que esta industria necesita y no tenemos

**Mesa de entrada** (sin esto no somos creíbles en el rubro):

1. **Rastro estructurado de la pre-calificación** (#2). Es el nombre de la plantilla y el objetivo #1 del alta. Sin monto/ingreso/plazo como campos, "pre-calificador" es una etiqueta: el asesor humano relee el chat.
2. **Producto financiero como objeto** — hoy no hay dónde declarar "Crédito de libre inversión: monto 5-50M, plazo 12-72m, requisitos X". La KB como texto libre es el sustituto y hace que la IA improvise cifras, justo lo que las reglas prohíben. No hace falta un módulo: bastaría reusar `services`/`catalog` con campos de rango.
3. **Gobernanza de etapas** (#3). En un regulado, mover una tarjeta a "Pre-aprobación" sin datos es un riesgo, no un detalle de UX.
4. **Política de identidad coherente** (#5) — la contradicción actual deja el comportamiento a merced del modelo del router.
5. **FAQs del rubro** (#4).

**Diferenciador** (solo si alguna vez se decidiera invertir — no es la recomendación):

- **Simulador de cuota determinista**: monto+plazo+tasa configurada por el tenant → cuota, con disclaimer. Es aritmética, no asesoría; esquiva el veto del L1 y es lo que el cliente pregunta en el mensaje 2. Encaja con el patrón "grafo determinista" que `competitive-analysis-2026-q2.md:254` marca como nuestra validación.
- **Checklist de documentos con recepción por WhatsApp**: el rubro vive de "mándame la cédula, el certificado laboral y los extractos". La persistencia de imagen ya existe para el pipeline de media; el problema no es técnico sino de política (documentos de identidad).
- **Cobranza / recordatorio de cuota**: sería el 6º rubro esperando el evaluador temporal (belleza, dental, gym, seguros, vet). Alto valor y alto riesgo regulatorio.

**Integraciones LatAm que el rubro real usaría:** buró (DataCrédito/TransUnion CO, Círculo de Crédito MX, Serasa BR), firma electrónica y core de originación. Ninguna es viable a nuestra escala PYME hoy: son integraciones enterprise, con contratos y compliance propios. **Es el argumento técnico de la genérica-honesta.**

---

## 6. Competencia del rubro (solo desde nuestros docs)

- **No hay competidor PYME de "finanzas" en nuestro mapa.** El clúster D (LatAm) —Yalo, Blip, Zenvia, Aivo, Cliengo, Treble, Botmaker, Leadsales, Whaticket, Auronix, Gupshup, 360dialog (`competitive-analysis-2026-q2.md:74`)— no tiene a ninguno posicionado por vertical financiera. Los que sirven banca en LatAm lo hacen desde el enterprise: **Blip** ($60M SoftBank+Microsoft, `:355`) y **Auronix** (México, con WhatsApp Pay, `:357`). Nuestro propio posicionamiento es explícito: *"El Yalo de las PYMES"* (`:500`) y evitar Brasil de frente (`:521`).
- **El único competidor que ataca lo regulado por diseño es Lorikeet** (`:252`): agente que sigue **SOPs como grafo de decisión** para casos multi-paso en *"fintech, salud, KYC"* — y la lectura del propio doc es que **valida nuestro patrón** (RAG + grafo determinista, `:254`). Traducción para finanzas: si algún día se invierte, el vehículo es el motor de procedimientos (T2.12, módulo `procedures/`) con un SOP de pre-calificación, **no** un módulo financiero nuevo.
- **La demanda documentada del rubro es de seguros, no de finanzas.** El top-10 de nichos (`market-research-latam.md:380-391`) tiene **Insurance Brokers #9, WTP 9/10** y ninguna entrada de crédito/fintech. Las 3 apariciones por país son "Financial services / **insurance brokers**": Panamá #1 con la nota *"Financial services SMBs have higher willingness to pay than typical LatAm SMBs"* (`:198`), Argentina #3 (`:324`), Brasil #4 (`:364`). **Esto es exactamente lo que sostiene el ruteo de #1**: donde nuestros docs ven plata en "finanzas", el negocio real es el corredor de seguros — y para ese ya tenemos una vertical con módulo, tools y página.
- **Panamá es el caso de uso más creíble** de finanzas-no-seguros que aparece en los docs (hub financiero, economía en USD sin fricción de FX para nuestro billing, `:198`) — pero el nicho listado ahí también son brokers.

---

## 7. Plan de inversión de ESTA vertical

Coherente con §1: **genérica-honesta + 1 ruteo**. Nada de módulo. Todo lo de abajo es dignidad o reutilización.

**Quick wins (días)**

1. **Ruteo `finanzas>seguros` → `seguros`** (#1). 2 líneas en `auth.service.ts:1562` + quitar el sub-tipo de `onboarding/page.tsx:131` (y de `vertical-definitions.ts:538`) + i18n en los 4 JSON. **XS.** Es el ítem de mayor retorno del dossier.
2. **5 FAQs propias** (#4) en el estilo prudente del registry, patrón `seedToursExtras`. `vertical-definitions.ts` + 4 idiomas. **S.**
3. **Quitar cédula/RFC de las 2 plantillas** (#5). `persona.service.ts:1840,:1878`. **XS.**
4. **Triggers de handoff reales** (#7): reemplazar `monto > USD 50000` / `monto alto` por keywords que el cliente escribe. `persona.service.ts:1846`, `vertical-definitions.ts:544`. **XS.**
5. **2 KPIs de solicitudes** (#6) contra `opportunities`/`pipeline_stages`, no contra `leadsHot`. **S.**

**Mediano (semanas)**

1. **`save_customer_field` + 3 definiciones sembradas** (#2). Tool transversal acotada a las definiciones existentes del tenant; finanzas siembra `monto_solicitado`, `ingreso_mensual`, `plazo_meses`. Sirve también a technology, servicios_profesionales y `otro` — se justifica por la suma, no por finanzas sola. `ai-tool-executor.service.ts` + `verticals.service.ts` + `conversations.service.ts` (registro y `WRITE_TOOLS`). **M.**
2. **`transitionRules` en las 6 etapas** (#3), apoyadas en #2. `vertical-definitions.ts:545-552`. **S.**
3. **Identidad sin cédula** (#5b): reuso del OTP del customer portal. **Compartido con seguros** — se hace una vez, se cobra en dos verticales. **M.**

**Apuesta (solo si el dueño decide invertir contra la recomendación)**

1. **SOP de pre-calificación sobre `procedures/`** (T2.12): el flujo monto→ingreso→plazo→resultado como grafo determinista, con el simulador de cuota como paso de cálculo. Es el camino que valida Lorikeet (`competitive-analysis:252-254`) y no requiere módulo nuevo. **M-L.**
2. **Producto financiero como objeto** reusando `services`/`catalog` con rangos (monto min/max, plazo, requisitos) + una tool `get_financial_products`. **M.**
3. Todo lo demás (buró, originación, cobranza) queda explícitamente **fuera**: integraciones enterprise sin caso PYME documentado.

**Lo que NO se hace:** módulo `finance` con tablas propias, KYC, scoring, ni página `/admin/finance`. Finanzas se queda con el núcleo horizontal + agenda + pipeline gobernado, que es exactamente lo que su mercado documentado (inexistente como nicho propio) justifica.

---

## 8. Qué no se verificó

- **Conversación real end-to-end**: el recorrido de §3(b) está reconstruido leyendo el pipeline (registro de tools, motor de reservas, auto-progress, handoff), no ejecutando un turno contra la API. En particular, la respuesta concreta del LLM a "¿me conviene invertir en un CDT?" bajo el guardrail L1 `:98` no se probó — se afirma la instrucción, no el output.
- **El empate 10-vs-30 del mapeo `contactado`** (§2.6) se dedujo del código (`bestDiff` con `<` estricto sobre un pool ordenado por `position ASC`, `pipeline.service.ts:1430-1433`), sin ejecutar la función.
- **Tenant real de finanzas**: no hay producción; no se inspeccionó ningún schema sembrado. Todo lo del bootstrap es lectura del seeder.
- **i18n de pt/fr/en más allá de la existencia de las claves**: se verificó que los 6 bloques de finanzas existen en los 4 JSON, no la calidad de cada traducción.
- **`localizeVerticalTemplates`**: no se revisó si las 2 plantillas de finanzas se localizan bien fuera de `es` (en pet_services ese camino tenía el bug de `templates[0]`). Como finanzas no usa `bySubType`, el riesgo es menor, pero no está descartado.
- **Costo del ruteo #1 sobre tenants ya sembrados**: no hay producción, así que no se diseñó backfill para un tenant que ya eligió `finanzas>seguros`.
