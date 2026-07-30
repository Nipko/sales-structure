# Technology — deep-dive (Jul 2026)

## 1. Veredicto y tesis de inversión

**GENÉRICA-HONESTA + reparar los números B2B.** Technology es hoy `createGenericVertical` con cuatro overrides (`vertical-definitions.ts:605-627`): terminología deal/pipeline/solución, el mejor pipeline B2B del catálogo (Lead→Discovery→Demo→Propuesta→Negociación→Cerrado/Perdido), dos plantillas realmente buenas (Diego SDR con BANT explícito y Diego Soporte N1 con embudo de troubleshooting, `persona.service.ts:2024-2091`) y un servicio "Demo personalizada" de 45min que el motor de reservas agenda de verdad. Cero tools de industria, cero módulo, cero integraciones, cero estrategia escrita — y no aparece en `vertical-strategy.md` ni en el top-10 de demanda de `market-research-latam.md:380-391`.

La lente de la ironía (nosotros SOMOS un SaaS B2B: ¿qué usaríamos de nuestro propio producto para vendernos?) da la respuesta más honesta del dossier: **usaríamos casi exactamente lo que ya existe** — canal WhatsApp, Diego SDR, demo agendada, KB con precios/features, handoff al AE con resumen, embudo B2B, organizaciones. El núcleo horizontal ES el producto de esta industria, porque nuestro núcleo es un asistente de ventas B2B. Eso significa que no hay tools que valgan la pena construir (como en servicios_profesionales, las que uno imaginaría — `enrich_lead`, `qualify_bant` — o son inconstruibles sin proveedor de datos, o su destino no existe: **ninguna de las 85 tools del executor escribe atributos estructurados sobre un contacto**). Y no hay ruteo que hacer (a diferencia de `finanzas>seguros`): los 4 sub-tipos son variantes del mismo motion.

Pero "genérica" no significa "sana". La misma lente revela el hueco real, y no es de conversación sino **de números**: `ForecastingService` (T3.21, el módulo más relevante para esta vertical) excluye del pipeline abierto los slugs `('ganado','perdido','no_interesado')` (`forecasting.service.ts:4`) y technology cierra en **`cerrado`** — así que **cada deal ganado se queda para siempre dentro del pipeline abierto, ponderado al 100%**, la velocidad (`WHERE stage = 'ganado' AND won_at IS NOT NULL`, `:62-64`) siempre devuelve null, y `won_at` ni siquiera se escribe porque solo se setea cuando el destino es literalmente `'ganado'` (`opportunities.repository.ts:314`). Encima el auto-progress asciende a **Propuesta (55%)** a quien pregunta "¿cuánto cuesta?" sin una sola `transitionRule` que lo frene. Resultado: la única vertical de la casa que existe para medir un embudo B2B es la que reporta un forecast inflado y una tasa de cierre de 0%. Eso se arregla en días, no en trimestres, y beneficia a las 17 verticales restantes (todas cierran con slug propio).

Recomendación: **no invertir en profundidad vertical** (nada que construir, ninguna demanda documentada, ningún competidor que gane este rubro en LatAm por profundidad), **sí invertir ~1 semana en los quick wins de §7 bloque A** — que son en su mayoría bugs horizontales que esta vertical hace visibles. Y una nota de GTM que vale más que la vertical misma: los docs de mercado no piden "vender a empresas de tecnología", piden **vender a través de ellas** (`competitive-analysis-2026-q2.md:135` — Reseller/SaaS Mode 2/10, "el motor de crecimiento viral con agencias LatAm"). La consultora TI y la agencia de desarrollo no son un vertical objetivo: son el canal de distribución que no existe.

## 2. Radiografía end-to-end

### 2.1 Alta (onboarding)

| Paso | Qué ofrece | Archivo:línea |
|---|---|---|
| Industria | "Tecnología" es una de las 18, posición 6 de la lista | `onboarding/page.tsx:44`; i18n `es.json → onboarding.industries.technology` |
| Sub-tipos | saas / consultoria_ti / desarrollo / hardware | `onboarding/page.tsx:148-153` = `vertical-definitions.ts:606-611` (espejo exacto) |
| Audiencias | b2b (Empresas y PYMES) / startups / developers | `onboarding/page.tsx:350-355` |
| Objetivos | lead_qualification / appointments / support / faq | `onboarding/page.tsx:257-262` |
| Ruteo de industria | **ninguno** | `auth.service.ts:1571` normaliza únicamente `finanzas>seguros`; technology pasa tal cual |

El sub-tipo se guarda en `tenant.settings.subType` (`verticals.service.ts:159,173,213`) y **no cambia absolutamente nada** aguas abajo: ni plantilla, ni FAQs, ni servicios, ni tools. Un integrador de hardware y redes (venta con visita técnica, garantías, RMA) recibe idéntico setup que un SaaS puro. Esto es honesto de decir en voz alta: los 4 sub-tipos son cosméticos, igual que en 15 de las 18 verticales.

Audiencias y objetivos SÍ llegan al prompt: `5c2581db` los inyecta en L3 como `<business_goals>` / `<target_audiences>` dentro de `<vertical_context>` (`prompt-assembler.service.ts:161-165`). Es la única vía por la que "startups" o "developers" tocan el comportamiento del bot.

### 2.2 Agente creado

`createDefaultAgentFromGoals` (`persona.service.ts:2672`) resuelve así:

1. Hay plantillas verticales para technology → **siempre gana `templates[0]` = `tpl_technology_ventas` (Diego SDR)** (`:2697-2699`).
2. El mapa `bySubType` (`:2704-2715`) cubre tours/agencia_viajes/tienda/delivery/dark_kitchen/dental. **No tiene entrada para technology** — correcto, no hay una segunda plantilla por sub-tipo que elegir.
3. La rama de objetivos (`:2726-2738`) solo corre **si no hubo plantilla vertical**. Consecuencia concreta: el objetivo **"Soporte técnico nivel 1"** que el alta ofrece explícitamente (`onboarding/page.tsx:260`) **nunca selecciona `tpl_technology_soporte`**. El tenant que se dio de alta para hacer soporte recibe un SDR que califica BANT y agenda demos.
4. Si la plantilla trae `appointments.enabled` (Diego SDR lo trae, `:2056`) y el schema aún no tiene servicios/slots, se apaga con marcador `pendingPrerequisites` (`:2754-2762`) y el bootstrap la vuelve a encender (`verticals.service.ts:66`). Circuito verificado: technology es `bookingEnabled:true` con 1 servicio → se restaura.

**Fuera de español el activo principal se degrada.** `getVerticalTemplates(industry, lang)` con `lang !== 'es'` pasa por `localizeVerticalTemplates` (`persona.service.ts:2586`, `2618-2667`), que **devuelve un array de UN solo elemento** (`return [{...base}]`, `:2658`) reconstruido desde el registry:

- `tpl_technology_soporte` **desaparece** del catálogo (ni auto-seleccionable ni elegible en el picker del editor).
- Las 6 reglas BANT de Diego se reemplazan por las 3 frases del registry (`:2653` → "Califica el nivel técnico del cliente. Ofrece demos. Para proyectos enterprise, escala."). Se pierden textualmente: BANT explícito, "pregunta tamaño de equipo/industria/caso de uso", "identifica decision-maker", **"agenda demo SOLO con leads calificados"**, "para precios enterprise NUNCA des números", "captura nombre, cargo, empresa, teléfono y email corporativo".
- El agente pasa a llamarse **Ana** (registry) en vez de **Diego** (plantilla), con rol "Technology advisor".

Sobrevive `requiredFields` (name/email obligatorios) y `tools`, porque el spread conserva las claves que el localizador no pisa (`:2651-2656`). El daño es la personalidad y el método de venta: **la vertical cuyo único activo diferencial son las reglas BANT las pierde exactamente en los idiomas de su comprador más probable** (un dev shop brasileño, una consultora TI angloparlante).

En español, `patchDefaultAgent` (`verticals.service.ts:293-344`) rellena huecos sin pisar: mantiene las reglas de Diego (`:333`, `existingRules.length > 0`) y **fusiona** `forbiddenTopics` y `handoffTriggers` del registry con los de la plantilla (`:334-341`). El agente español termina con los 8 triggers de las dos fuentes (ver §4-#3).

### 2.3 Bootstrap

`bootstrapVertical` (`verticals.service.ts:22`) para technology recorre **solo el camino genérico** — no hay ninguna rama `if (industry === 'technology')` entre las 10 que existen (`:73-149`):

| Paso | Qué siembra | Línea |
|---|---|---|
| 1 | 7 etapas del pipeline con `transition_rules = '[]'` (la definición no trae ninguna) | `:36` → `seedPipelineStages:244-271` |
| 2 | Persona vertical fusionada sobre la plantilla | `:39` → `patchDefaultAgent:293` |
| 3 | 5 FAQs **genéricas** + `tools.faqs` encendida | `:44-45` |
| 4 | 1 servicio: "Demo personalizada", 45min, precio 0, COP, categoría demos | `:50` → `vertical-definitions.ts:625-627` |
| 4a | `availability_slots` desde `businessHours` genérico (lun-vie 08:00-18:00) | `:57` |
| 4a-bis | `restoreAppointmentsTool` | `:66` |
| 5 | `verticalConfig` (terminología, sidebar, KPIs, bookingEnabled) a `tenant.settings` | `:153-171` |

Las 5 FAQs son las de `createGenericVertical` (`vertical-definitions.ts:515-521`): horario de atención, métodos de pago, cómo contactarlos, **"¿Dónde están ubicados?"** y **"¿Tienen política de devolución?"**. Para un SaaS remoto, dos de cinco son absurdas y ninguna cubre lo que realmente preguntan (trial, planes, seguridad/SOC2, integraciones, soporte).

### 2.4 Conversación — tools reales

El agente por defecto de un tenant technology termina con: `appointments` (de la plantilla), `crm`, `knowledge` (de la plantilla) y `faqs` (del bootstrap).

| tool | qué hace | gating | ¿funciona e2e? |
|---|---|---|---|
| Motor de reservas (determinista, no es "tool") | servicio→fecha→hora→confirmar sobre `services` + `availability_slots` | `tools.appointments.enabled` (`conversations.service.ts:1666`) | **Sí.** 45min entra en la ventana 08:00-18:00; 1 solo servicio → el match por palabra ("demo") es inmediato (`booking-engine.service.ts:527-533`) |
| `create_appointment` / `cancel_appointment` / `reschedule_appointment` / `check_availability` / `list_customer_appointments` / `get_appointment_details` | agenda vía LLM cuando el motor no toma el turno | `tools.appointments` | Sí (mismo motor de citas del resto de la casa) |
| `get_customer_context` | lee el historial/atributos del contacto | `tools.crm.enabled` (`conversations.service.ts:1832-1833`) | Sí, **solo lectura** |
| `search_knowledge_base` | RAG sobre la KB del tenant | `tools.knowledge.enabled` (`conversations.service.ts:1823`) | Sí — es la pata que un SaaS más va a usar (docs, pricing público, changelog) |
| `search_faqs` | busca en las FAQs sembradas | `tools.faqs.enabled` | Sí, pero sobre las 5 genéricas |
| `list_services` | lista "Demo personalizada" | siempre que haya servicios | Sí |
| **Ninguna tool de industria** | — | — | — |

No existe `qualify_lead`, `enrich_company`, `create_trial`, `check_integration`, ni nada equivalente. Confirmado barriendo los 85 nombres de tool de `conversations/tools/*.ts`: **ninguna escribe atributos estructurados sobre un lead/contacto**. Las respuestas BANT que Diego consigue viven únicamente en el transcript.

Lo que sí llega intacto al AE: `HandoffService.executeHandoff` genera un **resumen por LLM de los últimos 20 mensajes** (`handoff.service.ts:~131-140`) y lo manda por email + WebSocket al inbox, con auto-asignación por skills. En la práctica, ese resumen ES el "BANT capturado" — imperfecto pero real, y explica por qué la ausencia de tool de calificación duele menos de lo que la matriz sugiere.

### 2.5 Agenda / inventario

No hay inventario: `hiddenItems: ['inventory','catalog']` (`vertical-definitions.ts:623`). Ambos son **no-ops**: en `AppSidebar.tsx` el ítem `inventory` (`:139`) y `orders` (`:140`) ya están allow-listeados a `verticals:["retail","restaurantes"]`, y **no existe ningún `labelKey: "catalog"`** en el árbol del sidebar. El filtro por `hiddenItems` (`AppSidebar.tsx:421,430`) no tiene nada que ocultar.

Agenda: 1 servicio, ventana lun-vie 08:00-18:00. El hueco transversal del motor mono-recurso (capacidad 1) **no afecta a esta vertical**: una demo la da una persona y no hay concurrencia esperada. Es de las pocas verticales donde el motor calza sin reservas.

### 2.6 Pipeline

7 etapas sembradas con `transition_rules = '[]'` — technology sobrescribe el `pipeline` completo del genérico (`vertical-definitions.ts:614-622`) y su array de stages **no declara `transitionRules` en ninguna**, mientras el genérico sí traía `phone_required`/`name_required`/`offer_required` (`:509-511`). O sea: al especializar el embudo se perdió toda la gobernanza que el genérico tenía. Nada frena un avance.

Y hay auto-progress. `autoProgressFromConversation` (`pipeline.service.ts:1260-1400`) clasifica el mensaje del cliente por keywords (`AUTO_PROGRESS_KEYWORDS`, `:84-105`) y resuelve el destino genérico contra las etapas del tenant por **cercanía de probabilidad** (`mapGenericToTenantStage:1443-1471`). Para las 5 etapas no terminales de technology (lead 5, discovery 15, demo 35, propuesta 55, negociación 75):

| Señal del cliente | Destino genérico (prob) | Etapa technology escrita |
|---|---|---|
| primera respuesta de la IA | contactado (20) | **Discovery** (15) |
| "me interesa", "suena bien", "perfecto" | respondio (30) | **Demo** (35) |
| "precio", "cuánto", "costo", "tarifa" | calificado (50) | **Propuesta** (55) |
| intención + sentimiento muy positivo | caliente (80) | **Negociación** (75) |
| "lo quiero", "confirmo", "comprar" | listo_para_cierre (95) | **Negociación** (75) |

Es decir: **preguntar el precio mueve la tarjeta a "Propuesta enviada" (55%)**, y decir "me interesa" la mueve a "Demo" sin que exista ninguna demo. La gobernanza que debería frenar esto (`evaluateRulesForLead`, `:1375`) evalúa un array vacío y deja pasar todo.

### 2.7 Dashboard del tenant

**Lo que está bien** (technology es de las verticales "originales", con cosmética completa):

- `verticalWelcome.technology` → "Tu plataforma SaaS está lista, {name}".
- `verticalChecklist.technology` → "Configura tu SDR virtual", "Carga features, precios y FAQs técnicas", "Invita a tu equipo de ventas y soporte".
- `verticalEmptyStates.technology` → "Tus prospectos B2B aparecerán cuando agenden demo", "Tus oportunidades SaaS iniciarán aquí".
- Está en `PIPELINE_INDUSTRIES` (`admin/page.tsx:86`) → el home muestra el panel "Últimos leads" (`:607-640`).

**Lo que no**:

- `labelOverrides: {}` (`vertical-definitions.ts:623`) → el sidebar dice "Contactos / Embudo / Organizaciones" genéricos. Finanzas (`:553`), servicios_profesionales (`:577`) y retail (`:602`) sí tienen overrides; technology no.
- KPIs heredados del genérico: leadsToday / leadsHot / messagesProcessed / llmCostToday (`vertical-definitions.ts:525-530`). Ni pipeline value, ni demos agendadas, ni win rate — las 4 cifras que un equipo B2B mira.
- `ToolsTour` → `technology: []` (`setup-wizard/_components/ToolsTour.tsx:91`), mientras finanzas y servicios_profesionales sí reciben la tarjeta de Agenda (`:81-87`). La vertical cuyo objetivo declarado es "Agendar demos y reuniones" es la única con agenda cuyo tour no la muestra.
- No está en `APPOINTMENT_INDUSTRIES` (`admin/page.tsx:85`) → el home no muestra "demos de hoy", solo leads.

### 2.8 crm-b2b (T3.21) — ¿huérfano o conectado?

**Ni gateado ni promocionado: es horizontal y está vivo.** El módulo existe entero (`crm-b2b/organizations.service.ts`, `forecasting.service.ts`, `deal-rotting-cron.service.ts`, `crm-b2b.controller.ts`) y **tiene UI**: `/admin/contacts/organizations` está en el sidebar para cualquier vertical con `capability: "canEditPipeline"` (`AppSidebar.tsx:119`) y la página consume los tres endpoints — organizaciones, forecast y rotting (`contacts/organizations/page.tsx:49-51`). No es el patrón gimnasios/seguros de "backend sin UI".

Dos matices:

1. **El cron de rotting emite al vacío.** `crm.deal_rotting` se emite en `deal-rotting-cron.service.ts:77` y **no tiene un solo `@OnEvent` en todo el repo** (barrido de los 45 listeners de `apps/api/src`). El flag `metadata.is_rotting` sí se persiste (`:72`) y la página lo consulta a demanda, así que la información existe — pero nadie **avisa**: ni email, ni push, ni Slack, ni SMS, ni webhook, aunque los 5 listeners existan para otros eventos. En una vertical B2B el deal que se pudre en silencio es precisamente lo que uno quiere que grite.
2. **El forecast miente para esta vertical** (ver §4-#1). El módulo está bien construido y mal alineado con los slugs verticales.

`competitive-analysis-2026-q2.md:51` todavía afirma "CRM B2B: no existe entidad Organización/Empresa" — el doc quedó desactualizado por T3.21 (`:576` sí lo lista como construido). Vale corregirlo cuando se toque ese doc.

## 3. La experiencia hoy, contada honestamente

### (a) El dueño en sus primeros 30 minutos

Un fundador de un SaaS colombiano de 6 personas se da de alta. Elige Tecnología → SaaS → "Empresas y PYMES" + "Startups" → marca "Calificar leads B2B" y "Agendar demos". El bridge le dice **"Tu plataforma SaaS está lista"** y la checklist le habla en su idioma: *configura tu SDR virtual*, *carga features, precios y FAQs técnicas*. Buena primera impresión, y no es casualidad: technology tiene las tres capas cosméticas completas.

Entra al editor de agente y encuentra a **Diego, Sales Development Representative**, con seis reglas que cualquier VP of Sales firmaría (BANT, decision-maker, "nunca des precios enterprise"). Este es el mejor momento del producto para esta vertical: la plantilla es genuinamente buena y se nota escrita por alguien que vendió software.

Va al embudo y ve **Lead → Discovery → Demo → Propuesta → Negociación → Cerrado / Perdido**. Es su embudo, no el de una peluquería. Segundo buen momento.

Después empieza el desajuste, todo en el mismo tono menor:

- La sección de **Agenda** tiene un servicio, "Demo personalizada 45min", y horario lun-vie 08:00-18:00. Nadie se lo explicó (el tour de herramientas no le muestra Agenda: `technology: []`), lo encuentra de casualidad.
- Las **FAQs** que le sembramos le preguntan por su *política de devolución* y por *dónde están ubicados*. Es una empresa remota que vende suscripciones.
- El **sidebar** dice Contactos, Embudo, Organizaciones — lo mismo que vería una veterinaria. La terminología "deal/pipeline" que sí escribimos en el registry no llega a un solo label de la UI.
- Los **KPIs** del home son Leads Hoy / Leads Calientes / Mensajes / Costo IA. Ninguno es una cifra de venta B2B.
- Si su dashboard está en inglés o portugués (probable: es un SaaS), Diego **no existe**: le atiende "Ana, Technology advisor" con tres frases genéricas, y la plantilla de Soporte N1 no aparece en ningún lado.

A los 30 minutos la sensación correcta es: *"esto entiende cómo vendo, pero no está hecho para mí"*. Que es exactamente lo que "genérica-honesta" debería sentirse — con la salvedad de que un par de detalles (FAQs de devoluciones, sidebar sin adaptar) empujan la percepción de "genérica" a "descuidada" por muy poco dinero.

Lo que **no** verá en 30 minutos, y es lo grave: dentro de un mes su forecast va a estar inflado y su tasa de cierre en 0%.

### (b) El cliente final por WhatsApp en sus primeros 3 mensajes

**Camino de ventas (el que la vertical promete):**

> **Cliente:** "Hola, vi su producto, quiero una demo"

El intent interpreter marca `select_service` (o `serviceMentioned`, porque el único servicio se llama "Demo personalizada" y el match por palabra encuentra "demo": `booking-engine.service.ts:527-533`), y el **motor determinista toma el turno antes que el LLM** (`conversations.service.ts:1712-1720`). Diego no llega a hablar. La respuesta es "¿Para qué fecha te sirve?" — y en dos mensajes más hay una demo agendada **sin una sola pregunta de BANT**. La regla estrella de la plantilla, *"Agenda demo SOLO con leads calificados"*, es literalmente inejecutable: el motor que agenda no lee las reglas de la persona. Es el mismo patrón que en gimnasios secuestra "quiero reservar", pero acá el daño es mayor porque **calificar antes de agendar ES el producto** de un SDR.

> **Cliente:** "¿Cuánto cuesta para 50 usuarios?"

Acá el producto se comporta bien: Diego tiene prohibido dar precios enterprise, la KB responde lo que sea público, y si el cliente insiste con "¿me haces un mejor precio?" el `discount_request` de plataforma (`handoff.service.ts:85-90`) escala a un humano que sí puede aprobar. **En esta vertical ese keyword de plataforma está alineado con la regla de la plantilla** — vale decirlo, porque en retail y en postventa el mismo mecanismo hace daño. Lo que sí ocurre en silencio: esa pregunta mueve la tarjeta a **Propuesta (55%)** y engorda el forecast.

**Camino de soporte (el que el alta ofrece y el producto no entrega):**

> **Cliente:** "Hola, no funciona el login"

`'no funciona'` es un **complaintKeyword de PLATAFORMA** (`handoff.service.ts:76-79`), evaluado en el paso 5 del pipeline **antes de generar respuesta** y con retorno temprano (`conversations.service.ts:590-594`). El cliente recibe "te derivo con un agente, sos el número N en la cola". El embudo de troubleshooting de Diego Soporte —*¿qué intentaste? ¿qué pasó? ¿qué esperabas?*— nunca corre. Y el agravante: ese template **tampoco es el que está activo**, porque `createDefaultAgentFromGoals` siempre elige `templates[0]`. El objetivo "Soporte técnico nivel 1" que el tenant marcó en el alta no tiene ningún efecto en ninguna parte del sistema.

Traducido: de los 4 objetivos que el alta ofrece a esta vertical, **calificar leads** queda a medias (el motor de citas lo puentea), **agendar demos** funciona, **FAQ de producto** funciona (KB + RAG, es la pata más sólida) y **soporte N1** no existe operativamente.

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **El deal ganado nunca sale del pipeline abierto y la velocidad es siempre null.** El forecast del tenant B2B miente hacia arriba, para siempre | **crítica** | `forecasting.service.ts:4` `OPEN = o.stage NOT IN ('ganado','perdido','no_interesado')`; technology cierra en **`cerrado`** (`vertical-definitions.ts:620`). Todo won queda `OPEN`, con `default_probability = 100` → suma 100% de su valor a `weighted_value` (`:32`) y a `committed_value` (`:33`). Velocidad: `WHERE stage = 'ganado' AND won_at IS NOT NULL` (`:62-64`) → siempre vacía. Y `won_at` **solo se escribe si el destino es literalmente `'ganado'`** (`opportunities.repository.ts:314`, `contacts.service.ts:243`) → inalcanzable para technology. Mismo defecto en `crm-analytics.service.ts:103,142,194-200` (win-rate, leaderboard) y `attribution.service.ts:118-119,155-156,192-193` (revenue atribuido = 0). `analytics.service.ts:368` **sí** contempla el alias (`IN ('ganado','cerrado','cerrado_ganado','entregado','completado')`) — o sea, el problema ya está resuelto en un lugar y no en los otros cuatro | Extraer la lista de alias a una constante compartida (`WON_STAGE_SLUGS` / `LOST_STAGE_SLUGS`), o mejor: resolver por `pipeline_stages.is_terminal + default_probability >= 50` en vez de por slug. Y escribir `won_at` cuando la etapa destino sea terminal-ganadora, no cuando el slug sea `'ganado'`. Afecta a **las 18 verticales** (ninguna cierra en `ganado`), pero solo esta la mira | **M** |
| 2 | **El motor de reservas secuestra "demo" y anula el BANT.** La regla estrella de la plantilla es inejecutable | alta | El gate del motor solo exige `toolsEnabled` (`conversations.service.ts:1666`); con `serviceMentioned` el engine toma el turno (`booking-engine.service.ts:527-533, 611, 718`) y devuelve `handled` antes del LLM (`conversations.service.ts:1712-1725`). El único servicio se llama "Demo personalizada" → cualquier mensaje con "demo" entra. Regla anulada: `persona.service.ts:2044` | Dos opciones: (a) permitir que la persona declare `requiredFields` de calificación como **precondición del motor** (el motor ya tiene fase de captura de nombre/email — extenderla a 1-2 campos configurables); (b) más barato: cambiar el nombre del servicio sembrado a "Demo con un especialista" y confiar en que el LLM califique antes — no resuelve el fondo. Recomendado (a), y sirve a salud/inmobiliaria igual | **M/L** |
| 3 | **6 de 8 handoffTriggers no pueden disparar.** Se evalúan por substring literal | alta | `handoff.service.ts:107-109` (`text.includes(trigger.toLowerCase())`). El agente español termina con los 8 fusionados por `patchDefaultAgent:338-341`: del registry `proyecto enterprise / integracion compleja / incidente de seguridad / presupuesto >$50M` (`vertical-definitions.ts:613`) y de la plantilla `empresa > 100 empleados / integración técnica compleja / requerimiento de SOC2/ISO / partnership` (`persona.service.ts:2049`). Muertos por construcción: `presupuesto >$50M`, `empresa > 100 empleados` (nadie escribe una comparación). Muertos en la práctica: `requerimiento de SOC2/ISO` (el cliente escribe "necesitamos SOC2"), `integración técnica compleja`, `proyecto enterprise`. Muerto por acentos: `integracion compleja` (registry, sin tilde) no matchea "integración compleja". Vivos: `partnership`, `incidente de seguridad` | Reescribir ambas listas como keywords que un humano tipea: `licitación\|licitacion\|RFP\|RFI\|SOC2\|SOC 2\|ISO 27001\|on-premise\|SLA\|contrato marco\|partnership\|integración\|integracion`. 2 líneas (registry + plantilla). **La forma correcta a futuro**: los umbrales numéricos ("presupuesto > X") no son triggers de texto — son reglas del motor de automatización sobre atributos del lead, que hoy no tienen quién los escriba (ver #8) | **S** |
| 4 | **`'no funciona'` es complaintKeyword de PLATAFORMA: el soporte N1 escala antes de existir** | alta | `handoff.service.ts:76-79` incluye `'no funciona'` en `complaintKeywords`; se evalúa en el paso 5 con retorno temprano (`conversations.service.ts:590-594`). Es la frase de apertura canónica de un ticket de soporte de software. La plantilla `tpl_technology_soporte` (`persona.service.ts:2061-2090`) empieza con "Cuéntame qué error o problema estás viendo" — nunca llega | El escape existe (`handoffCategories: { complaint: false }`, `handoff.service.ts:55-59`) pero **no tiene un solo escritor en el repo** (2 ocurrencias en todo el monorepo: el comentario y el lector) (mismo hallazgo que servicios_profesionales). Camino barato: exponer las 5 categorías como toggles en el editor de agente y apagar `complaint` por defecto cuando la plantilla activa es de soporte. Alternativa: sacar `'no funciona'` de la lista de plataforma (es la única entrada que describe un síntoma de producto en vez de un estado emocional) | **S** |
| 5 | **El objetivo "Soporte técnico nivel 1" del alta no hace nada** | alta | `persona.service.ts:2696-2699` (siempre `templates[0]`) + `:2726` (la rama por objetivos solo corre sin plantilla vertical). El objetivo se ofrece en `onboarding/page.tsx:260` e i18n `onboarding.verticalGoals.technology.support` | Añadir al mapa `bySubType`/goals una preferencia: si `goals` incluye `support` y existe `tpl_{industry}_soporte`, elegir esa. Sirve también a retail/salud si algún día se suman plantillas de soporte | **S** |
| 6 | **Fuera de `es` se pierde la plantilla de soporte y las 6 reglas BANT** | alta | `localizeVerticalTemplates` devuelve `[{...templates[0]}]` (`persona.service.ts:2658-2666`) y sobrescribe `rules`/`forbiddenTopics`/`handoffTriggers` desde el registry (`:2651-2656`). En en/pt/fr: 1 sola plantilla, persona "Ana" en vez de "Diego", reglas reducidas a 3 frases. Afecta desproporcionadamente a esta vertical (su comprador es el más probable de operar en inglés/portugués) | Localizar el **array completo** (mapear cada plantilla, no solo `[0]`) y, cuando la plantilla ya trae `rules` propias, **no pisarlas** con las del registry — el mismo criterio de "rellenar huecos, no pisar" que ya usa `patchDefaultAgent:333`. Beneficia a las 17 verticales con 2+ plantillas | **M** |
| 7 | **Auto-progress infla el forecast sin una sola regla que lo frene** | alta | Etapas sembradas con `transition_rules = '[]'` (`vertical-definitions.ts:614-622` no declara `transitionRules`; `verticals.service.ts:264` serializa `|| []`). Mapeo por probabilidad (`pipeline.service.ts:1443-1471`): "precio/cuánto/costo" → calificado(50) → **Propuesta (55)**; "me interesa" → respondio(30) → **Demo (35)**; "lo quiero/confirmo" → **Negociación (75)**. `evaluateRulesForLead` (`:1375`) no tiene nada que evaluar. En una vertical con forecast ponderado, cada tire-kicker suma 55% del valor estimado | Mínimo coherente con el motor: `appointment_required` en **Demo** (no hay demo sin cita agendada — la señal existe y es barata) y `offer_required` en **Propuesta**. Ambas reglas ya están implementadas en `pipeline.service.ts`. Nota: `offer_required` consulta `commercial_offers` (concepto del catálogo legacy) — verificar que un tenant B2B pueda crear una oferta antes de activarla, o el tablero se bloquea como pasó en seguros | **S/M** |
| 8 | **La calificación BANT no tiene dónde guardarse** | media | Barrido de los 85 nombres de tool en `conversations/tools/*.ts`: ninguna escribe atributos sobre contacto/lead (`get_customer_context` es solo lectura). Las respuestas de presupuesto/autoridad/plazo viven en el transcript y en el resumen LLM del handoff (`handoff.service.ts:~131`) | Existe el riel: `custom_attribute_*` es un tipo de condición del motor de reglas (mismo hallazgo que finanzas). Una única tool horizontal `save_customer_attribute(key, value)` desbloquea BANT en technology, presupuesto en finanzas, urgencia en servicios_profesionales y zona en inmobiliaria. **Es la tool que sí vale la pena** — pero es horizontal, no de esta vertical | **M** |
| 9 | **`crm.deal_rotting` se emite y nadie escucha** | media | Emitido en `deal-rotting-cron.service.ts:77`; **0 `@OnEvent`** en los 45 listeners del repo. El dato sí es alcanzable a demanda (`contacts/organizations/page.tsx:51` → `GET /crm-b2b/:t/rotting`), pero no hay notificación por ningún canal, con 5 listeners genéricos ya existentes (email, push, Slack, SMS, webhooks) | Sumar `crm.deal_rotting` a `webhooks-listener.service.ts` y `push-listener.service.ts` (patrón idéntico al de `handoff.escalated`), o a una regla de automatización. ~20 líneas | **S** |
| 10 | **FAQs genéricas fuera de rubro** | media | `vertical-definitions.ts:515-521` sembradas tal cual: "¿Dónde están ubicados?" y "¿Tienen política de devolución?" para una empresa de software. Faltan las 5 obvias: trial, planes/facturación, seguridad y tratamiento de datos, integraciones/API, canales y tiempos de soporte | 5 FAQs propias en el bloque `TECHNOLOGY`, estilo prudente ("te lo confirma un especialista" para precios enterprise). El patrón `seedToursExtras`/`seedDentalExtras` (`verticals.service.ts:562-787`) existe para copiar, aunque acá alcanza con el array `faqs` de la definición | **S** |
| 11 | **`labelOverrides: {}` — el dashboard no dice una sola palabra del rubro** | baja | `vertical-definitions.ts:623`; consumido en `AppSidebar.tsx:442,445`. La terminología deal/pipeline sí existe en el registry (`:612`) y se inyecta al prompt, pero no toca la UI. Retail sí tiene overrides (`:602`) | 3 líneas: `crm→"Cuentas"`, `pipeline→"Deals"`, `appointments→"Demos"` en los 4 idiomas | **S** |
| 12 | **`hiddenItems: ['inventory','catalog']` es un no-op doble** | baja | `inventory` (`AppSidebar.tsx:139`) y `orders` (`:140`) ya están allow-listeados a retail/restaurantes; **no existe ningún `labelKey: "catalog"`** en el árbol | Borrar la línea o dejarla documentada como defensiva. Cosmético, pero es deuda que confunde a quien lee la definición | **S** |
| 13 | **KPIs genéricos en la vertical más numérica del catálogo** | media | `vertical-definitions.ts:525-530` heredados: leadsToday/leadsHot/messagesProcessed/llmCostToday. Un equipo B2B mira pipeline ponderado, demos de la semana, win rate y ciclo de venta — y las cuatro cifras **ya existen** en `forecasting.service.ts` y `crm-analytics.service.ts` (una vez arreglado #1) | KPIs propios apuntando a claves nuevas del endpoint de overview. Depende de #1: publicar un forecast hoy sería publicar un número falso | **M** |
| 14 | **La vertical con agenda que el tour de herramientas no muestra** | baja | `ToolsTour.tsx:91` → `technology: []`, mientras `finanzas` y `servicios_profesionales` sí traen la tarjeta de Agenda (`:81-87`). Y no está en `APPOINTMENT_INDUSTRIES` (`admin/page.tsx:85`), así que el home tampoco muestra las demos del día | `technology: [{ key: "appointments", ... }]` (1 línea) y sumarla al panel de citas del home o dejar el de leads a propósito (defendible: en B2B el leadflow manda) | **S** |
| 15 | **"deal" se le dice al CLIENTE, no al vendedor** | baja | `transactionNoun: 'deal'` (`vertical-definitions.ts:612`) se inyecta como `<transaction_noun>` (`prompt-assembler.service.ts:158`) y la regla 13 del contrato L1 ordena *"refer to transactions as `<transaction_noun>`"* (`:82`). El prospecto lee "tu deal" — jerga del vendedor, no del comprador. Los otros verticales no tienen este problema porque su `transactionNoun` es del lado del cliente ("reserva", "pedido", "cita") | `transactionNoun: 'propuesta'` / `'proposal'` / `'proposta'` / `'proposition'`; dejar "deal" para `labelOverrides` de la UI del tenant (#11), que es donde la jerga sí corresponde | **S** |
| 16 | **Los 4 sub-tipos no cambian nada** | baja | `bySubType` (`persona.service.ts:2704-2715`) sin entrada technology; sin rama en `bootstrapVertical`. Hardware y redes (visita técnica, garantías, RMA) recibe el mismo setup que un SaaS | **No arreglar como "profundidad"**: es coherente con el veredicto genérica-honesta. Si algo, diferenciar los servicios sembrados (`consultoria_ti` → "Sesión de diagnóstico"; `hardware` → "Visita técnica") es un `if` de 5 líneas con retorno real | **S** |

## 5. Lo que esta industria necesita y no tenemos

Conviene separar dos compradores que el alta mezcla bajo "Tecnología", porque necesitan cosas distintas:

**(A) SaaS / producto** — vende suscripciones, su embudo es el nuestro.
**(B) Consultoría TI / desarrollo / hardware** — vende proyectos y horas, su embudo es el de servicios_profesionales con otro vocabulario.

### Mesa de entrada (sin esto no somos creíbles en el rubro)

| Necesidad | Estado | Nota |
|---|---|---|
| **Números de embudo que no mientan** (forecast, win rate, ciclo) | **roto** (§4-#1) | Es *la* mesa de entrada de esta industria: un equipo B2B evalúa una herramienta de ventas por sus números. Hoy el forecast infla y el win rate da 0 |
| Calificar antes de agendar | a medias (§4-#2) | Un SDR que agenda demos sin calificar le hace perder tiempo al AE — el problema que el producto dice resolver |
| FAQs del rubro (trial, planes, seguridad, integraciones) | falta (§4-#10) | Barato |
| KB sobre documentación pública | **tenemos y funciona bien** | RAG + crawling de URLs (KB fase 1-2). Para un SaaS con docs públicas es la pata más fuerte del producto, sin construir nada |
| Handoff al AE con contexto | **tenemos** | Resumen LLM + skill-based routing + SLA de 5min. Es mejor de lo que la matriz 12/36 sugiere |
| Agenda de demos con Google Calendar / Meet | **tenemos** | `calendar-integration.service.ts`, links de Meet/Teams automáticos para servicios `online`. Encaja perfecto y nadie se lo cuenta al tenant (§4-#14) |
| Soporte N1 operativo | **roto** (§4-#4, #5) | Dos arreglos S lo dejan funcionando |

### Diferenciador (si se decidiera invertir — no se recomienda)

- **Lead enrichment por dominio de email** (empresa, tamaño, industria desde `@empresa.com`). Es lo primero que un SDR real hace. Requiere proveedor de datos externo (Clearbit/Apollo y equivalentes) con costo por lookup — no es construible "gratis" y no hay ningún research nuestro que lo respalde. Lo dejo nombrado y descartado.
- **Trial/PLG loop**: crear una cuenta de prueba desde el chat y hacer seguimiento del onboarding del trial. Requiere integración por-tenant con el producto del tenant — inconstruible de forma genérica.
- **Ticketing / integración con Jira-Linear-Zendesk**: el `docs/external-crm-integration-research.md` cubre CRMs, no ticketing. Sería el pedido real de un SaaS con soporte, y hoy no existe nada ni planeado.
- **Cotizador de proyectos por horas** (comprador B): es el mismo hueco que servicios_profesionales, y ese dossier ya concluyó que no vale.

### La lectura de mercado que importa

Los docs no piden vender **a** empresas de tecnología; piden vender **a través** de ellas. `competitive-analysis-2026-q2.md:135` puntúa **Reseller / SaaS Mode en 2/10** con la nota *"El motor de crecimiento viral con agencias LatAm"*, y `:399-400` propone copiarle a Vendasta el *offset model* + un **marketplace de plantillas verticales white-label** ("los 12 verticales son inventario natural"). Una agencia digital o una consultora TI de Medellín encaja mejor como **partner que revende Parallly a sus clientes** que como tenant que usa Diego para vender su propio software. Eso es una decisión de producto/GTM, no de vertical — pero es la conversión más alta que puede salir de este dossier.

## 6. Competencia del rubro

Nadie "gana el vertical technology" en LatAm, porque no es un vertical que los competidores persigan: es el segmento donde **todos** los actores horizontales compiten con todos. Lo que sí dicen nuestros docs:

- **Rasayel** — *"B2B WhatsApp, mínimo 5-10 asientos (fricción). Integración nativa HubSpot/Pipedrive"* (`competitive-analysis-2026-q2.md:342`). Es el competidor más cercano a este caso de uso, y el doc saca la lección correcta: *"nosotros somos CRM built-in, no necesitamos integrar"*. Nuestro embudo B2B propio + organizaciones es la respuesta.
- **HubSpot** es el techo de la dimensión CRM: 6/10 nosotros vs 10 (`:106`), y de CRM B2B/Organizaciones (`:449`, `:576`). T3.21 cerró parte de esa brecha (organizaciones + forecast + rotting), aunque el doc todavía no lo refleja en la línea `:51`.
- **GoHighLevel** (`:391-394`) y **Vendasta** (`:399-400`) no compiten por este tenant: compiten por el **canal**. Su producto es "convertí a tu agencia en reseller con su propio P&L". Es la amenaza y la oportunidad real de este rubro.
- **Yalo** (`:354`) es enterprise B2B puro (Walmart, Coca-Cola FEMSA) y explícitamente *"ignora a la PYME"* — no toca a nuestro comprador.

En demanda documentada, technology no existe: **no está en el top-10 ponderado** de `market-research-latam.md:380-391` (que lidera Belleza 88, Dental 87, Salud 86, Inmobiliaria 84) ni tiene sección propia en ningún país. Lo más cercano es la mención de que *"Medellín's tech ecosystem (Ruta N) makes enterprise/agency pilots feasible"* (`:247`) — otra vez: pilotos de **agencia**, no de SaaS-como-cliente. Y no aparece en `vertical-strategy.md` (verificado: cero menciones de technology/tecnología; la única coincidencia con "consultor" es del bloque de clínicas). La matriz de madurez ya lo había dicho sin rodeos: *"finanzas y technology (12/36) no aparecen siquiera en `vertical-strategy.md`: tienen código sin estrategia"* (`vertical-maturity-audit-2026-07.md:64`).

Conclusión de §6: no hay a quién ganarle acá, porque no hay una plaza. La inversión defendible en "technology" no es vertical, es horizontal (los números del embudo) o de canal (reseller).

## 7. Plan de inversión de ESTA vertical

Coherente con GENÉRICA-HONESTA: **nada de módulo, nada de tools de industria, nada de integraciones**. Solo (A) los bugs que esta vertical hace visibles y que valen para todo el catálogo, y (B) la dignidad cosmética que ya se pagó en 11 verticales y a esta le falta.

### Bloque A — Quick wins (días). Hacer todos.

| # | Ítem | Archivos | Esfuerzo |
|---|---|---|---|
| A1 | **Alias de etapa ganada/perdida en una constante compartida** y resolución por `is_terminal + probability` en vez de slug literal; escribir `won_at` cuando la etapa destino sea terminal-ganadora | `crm-b2b/forecasting.service.ts:4,32-33,62-64`; `crm/services/crm-analytics/crm-analytics.service.ts:103,142,194-200`; `attribution/attribution.service.ts:118-119,155-156,192-193`; `crm/repositories/opportunities.repository.ts:314`; `crm/services/contacts/contacts.service.ts:243` (referencia ya correcta: `analytics/analytics.service.ts:368`) | **M** (1-2 días, alto valor, 18 verticales) |
| A2 | Reescribir los handoffTriggers como keywords tipeables (RFP, licitación, SOC2, ISO 27001, on-premise, SLA, contrato marco, partnership) | `vertical-definitions.ts:613`; `persona.service.ts:2049` | S |
| A3 | Sacar `'no funciona'` de `complaintKeywords` de plataforma **o** exponer `handoffCategories` como toggles del editor de agente | `handoff.service.ts:76-79` (+ editor si se elige la segunda) | S |
| A4 | El objetivo `support` del alta selecciona `tpl_{industry}_soporte` cuando existe | `persona.service.ts:2696-2738` | S |
| A5 | 5 FAQs propias del rubro (trial, planes/facturación, seguridad de datos, integraciones/API, canales y tiempos de soporte) | `vertical-definitions.ts` bloque `TECHNOLOGY` | S |
| A6 | `labelOverrides` mínimos (crm→Cuentas, pipeline→Deals, appointments→Demos) en 4 idiomas + borrar el `hiddenItems` no-op | `vertical-definitions.ts:623` | S |
| A7 | `ToolsTour.technology` con la tarjeta de Agenda | `setup-wizard/_components/ToolsTour.tsx:91` | S |
| A8 | `transactionNoun` cara al cliente: "propuesta"/"proposal"/"proposta"/"proposition" | `vertical-definitions.ts:612` | S |
| A9 | Listeners para `crm.deal_rotting` (webhooks + push, patrón `handoff.escalated`) | `webhooks/webhooks-listener.service.ts`, `push/push-listener.service.ts` | S |

### Bloque B — Mediano (semanas). Hacer 1 y 2; 3 solo si se hace por otra vertical.

1. **`transitionRules` mínimas en el embudo B2B** — `appointment_required` en Demo, y `offer_required` en Propuesta **solo tras verificar** que un tenant B2B pueda crear una `commercial_offer` (en seguros esa regla bloqueó el tablero, `cluster-servicios.json`). Sin esto, el auto-progress seguirá inflando el forecast que A1 acaba de arreglar. `vertical-definitions.ts:614-622`. **S/M**
2. **Localización completa de plantillas** — mapear el array entero y no pisar `rules` propias con las del registry. Devuelve Diego SDR (con BANT) y Diego Soporte a en/pt/fr, y arregla el mismo daño en las otras 16 verticales con 2+ plantillas. `persona.service.ts:2618-2667`. **M**
3. **`save_customer_attribute(key, value)`** — una tool horizontal de escritura sobre el contacto. Es la única tool que este dossier considera justificada, y **no es de technology**: desbloquea BANT acá, pre-calificación en finanzas, urgencia en servicios_profesionales y zona/presupuesto en inmobiliaria, y le da destino real a las condiciones `custom_attribute_*` del motor de reglas. **M**

### Bloque C — Apuesta: NO en esta vertical

No se recomienda ninguna apuesta vertical en technology. La apuesta adyacente que los docs sí respaldan es **Reseller / SaaS Mode** (`competitive-analysis-2026-q2.md:135,391-400,444`): convertir a agencias y consultoras TI en revendedores con sub-cuentas, wallet y rebilling. Eso convierte a este rubro de "tenant mediocre" en "canal de distribución", y es una decisión de plataforma que excede este dossier. Queda anotada, no propuesta acá.

## 8. Qué no se verificó

- **Nada se corrió en vivo.** Todo el análisis es lectura de código; no se creó un tenant technology ni se ejecutó una conversación real. En particular, el secuestro del motor de reservas ante "quiero una demo" (§4-#2) se infiere del código del interpretador + engine (`booking-engine.service.ts:527-533,611,718`), no de un log.
- **No se leyó el `intent-interpreter` completo** (su prompt al LLM): se verificaron la interfaz de intents (`intent-interpreter.service.ts:14-28`) y el consumo en el engine, pero no la clasificación exacta que el LLM da a "quiero una demo" en cada idioma.
- **No se midió el impacto numérico de #1** sobre datos reales (no hay tenant technology en producción conocido). El razonamiento es sobre el SQL, que es inequívoco.
- **`crm-analytics` y `attribution` se verificaron por grep de `'ganado'`**, no leyendo cada query entera: la lista de líneas afectadas es correcta pero podría haber más ocurrencias en queries que no usan ese literal.
- **No se auditaron los 4 idiomas de i18n** para technology: se verificó `es.json` completo (9 claves) y se asume paridad en en/pt/fr, sin comprobarla.
- **No se revisó `simulation`/`procedures`** aplicados a esta vertical (la matriz ya les puso 1 y son transversales).
- **No se evaluó `MCP`** (T3.20) como sustituto de las tools ausentes: un tenant technology es el más capaz de conectar su propio servidor MCP (`mcp/mcp-client.service.ts`, tools `mcp__server__tool` registradas en `conversations.service.ts:1858-1859`). Es una hipótesis atractiva —la vertical técnica se auto-construye sus tools— y no se investigó su viabilidad real (UI de configuración, autenticación, plan gating).
- **No se verificó si `commercial_offers` es poblable por un tenant B2B**, lo que condiciona la recomendación B1 (`offer_required`).
