# Otro — deep-dive (Jul 2026)

> Dossier 18 de 18. El fallback: la industria que recibe todo negocio que no calza en las otras 17.
> Sigue `_TEMPLATE.md`. Cierra la ronda: incluye una §9 con la lectura del catálogo como conjunto.

## 1. Veredicto y tesis de inversión

`otro` no es una vertical: es **el piso del producto**, y todo lo que se rompe acá se rompe para las 18. Hoy entrega un paquete honesto y chico — persona genérica, 6 etapas de embudo, 5 FAQs neutras, `tools.faqs` encendida — y es la **única** vertical del registro que hereda el pipeline por defecto tal cual, con sus `transitionRules` incluidas (`vertical-definitions.ts:507-514`); las cuatro verticales "genérica-honesta" (finanzas, servicios_profesionales, retail, technology) sobrescriben `pipeline` y **pierden** esas reglas. Esa herencia, que debería ser una ventaja, es también su peor defecto: la 4ª de sus 6 columnas — **Propuesta** — está gateada por `offer_required`, una regla que hace `JOIN` contra `leads.course_id` (`pipeline.service.ts:894-897`), una columna que solo escribe education. Para un tenant `otro` ese `JOIN` **nunca** matchea: la columna es inalcanzable a mano (`TRANSITION_RULE_FAILED:offer_required`) y el auto-progress la usa como destino de "lo compro" y por lo tanto **congela cada lead en Calificado para siempre**. El fallback del producto tiene el embudo roto por una regla de otra industria.

Qué podría ser: la respuesta digna al 100% de la cola larga LatAm. Y el mercado dice que esa cola es **corta**. Recorriendo los ~85 nichos que `market-research-latam.md` §2 lista país por país, exactamente **dos** no tienen vertical propia: *logistics & freight* (Panamá #3, `:196`) y *driving schools* (Honduras #4, `:143`); un tercero, la tiendita/abarrotes de México y Venezuela, cae en retail con incomodidad. Todo lo demás — farmacias (salud>farmacia), repuestos (automotriz>repuestos), agencias de viaje (turismo>agencia_viajes), legales (servicios_profesionales), brokers de seguros (seguros) — ya tiene casa. La ferretería, la papelería, la imprenta y el taller de bicicletas **no aparecen en ningún doc de mercado propio**: no son un segmento identificado, son residuo estadístico.

**Veredicto: MANTENER — pero arreglar el piso, que no es opcional.** No hay caso para invertir en `otro` como vertical (no hay demanda documentada, no hay features de rubro que construir porque no hay rubro). Sí lo hay, y urgente, para tratarla como **lo que efectivamente es: el contrato mínimo de la plataforma**. Los tres arreglos de §7-A no son "mejorar otro": son quitar `offer_required` de un pipeline que ninguna otra vertical usa, desbloquear el inventario para quien vende cosas, y dejar de mandar a `otro` en silencio a los tenants que el super_admin declara "Restaurante" en un modal con cuatro slugs muertos (`CreateTenantModal.tsx:61-67`). Y una respuesta directa a la pregunta del catálogo: si finanzas, servicios_profesionales y technology son "otro con vestuario", lo que las separa de `otro` no es profundidad — es **terminología, un pipeline propio y una persona con nombre**. Eso vale (§9), pero hoy cuesta caro: al sobrescribir `pipeline` pierden las reglas de transición y quedan con un embudo sin gobierno. `otro` conserva el gobierno y pierde la identidad. Ninguna de las cinco tiene las dos cosas.

---

## 2. Radiografía end-to-end

### 2.1 El alta

| Paso | Qué pasa con `otro` | Archivo:línea |
|---|---|---|
| Selector de industria | `otro` es la 18ª y última opción; el campo es **obligatorio** (`step1Complete` exige `!!industry`) | `onboarding/page.tsx:47`, `:483` |
| Sub-tipos | `SUB_TYPES['otro']` **no existe** → no se renderiza el segundo desplegable. Coherente con el registro: `OTRO.subTypes = []` | `onboarding/page.tsx:866`; `vertical-definitions.ts:504` (default de `createGenericVertical`) |
| Audiencias | Como `VERTICAL_AUDIENCES['otro']` no existe, cae al set genérico `["b2c","b2b","government","other"]` **y** habilita el campo libre "otro: …" | `onboarding/page.tsx:52`, `:939`, `:959` |
| Objetivos | Ídem: `GOAL_KEYS` genérico (8 opciones) + campo libre | `onboarding/page.tsx:54-57`, `:983`, `:1006` |
| Serialización | `goals`/`audiences` viajan con el texto libre embebido: `other:${goalOther}` | `onboarding/page.tsx:583-588` |
| Escritura | `settings.chatReasons` / `settings.customerTypes`; la columna `tenants.industry` recibe `industry \|\| 'other'` | `auth.service.ts:1616-1617`, `:1603` |

Nota importante: **`otro` es la única vertical donde el campo libre de objetivos/audiencia se puede llenar** — en las otras 17 el guard `!VERTICAL_AUDIENCES[industry]` / `!VERTICAL_GOALS[industry]` oculta el input cuando la industria tiene sus propias opciones. Es decir: la plataforma pide una descripción en prosa exactamente al tenant que no tiene rubro. Bien pensado.

**El doble slug, confirmado y acotado.** `auth.service.ts:1603` escribe `'other'` (inglés) en `tenants.industry` cuando `industry` viene vacío, mientras `:1704` bootstrapea con `'otro'`. Por el selector obligatorio del wizard esa rama no se alcanza desde la UI de alta; sí se alcanza por API directa. Pero el slug `'other'` **sí es alcanzable de otras formas y sí rompe cosas concretas**:

- `getVerticalConfig` reconstruye la config con `industry: tenant.industry` **verbatim** (`verticals.service.ts:212`) → un tenant `'other'` termina con `verticalConfig.industry === 'other'`, terminología correcta (el registro resuelve por fallback en `vertical-definitions.ts:1164`) pero **slug ajeno a todo el resto del código**.
- `/admin/vertical-analytics` agrupa con `t.industry || 'otro'` (`vertical-analytics.service.ts:61`) y el dashboard de super_admin con `t.industry || 'other'` (`admin/page.tsx:160`): **dos claves de fallback distintas en dos vistas de la misma plataforma**. Un tenant con `industry='other'` aparece como una barra separada de `otro` en la distribución por vertical.
- La etiqueta no explota porque las dos superficies tienen guard: `tInd.has(row.industry) ? tInd(row.industry) : row.industry` (`vertical-analytics/page.tsx:240`, `:294`, `:368`) y `defaultValue` en el badge de tenants (`TenantsOverviewTab.tsx:214`). Se ve el slug crudo, no un `MISSING_MESSAGE`.
- El checklist compara `vt.industry !== 'otro'` (`OnboardingChecklist.tsx:166`): con `'other'` la comparación da `true` y entra a buscar `tChecklist.has('other.<item>')`, que falla, y cae al copy genérico — el resultado correcto por accidente.

**Y hay una fuente de `'otro'` mucho peor que el default en inglés**: el modal con el que el super_admin crea tenants a mano ofrece siete industrias —`turismo, restaurante, ecommerce, servicios, salud, educacion, otro`— de las cuales **cuatro no existen en `VERTICAL_REGISTRY`** (`restaurante` sin s, `ecommerce`, `servicios`, `educacion` sin ese alias en el registro; el alias `educacion→education` solo vive en el mapa de plantillas de persona, `persona.service.ts:2590`). `getVerticalDefinition` las resuelve todas a `otro` en silencio (`vertical-definitions.ts:1164`). El mismo desplegable congelado está en `CreateTenantModal.tsx:61-67` y `EditTenantModal.tsx:57-63`. Traducido: **un tenant creado a mano como "Restaurante" es funcionalmente un tenant `otro`**, y su columna `industry` guarda un slug que ninguna vertical, ningún aggregator y ningún gate de sidebar reconoce.

Peor: `TenantsService.create()` (`tenants.service.ts:28-80`) **no llama a `bootstrapVertical`**. El único llamador en todo el repo es `auth.service.ts:1707`. Un tenant creado por el super_admin no recibe etapas, ni FAQs, ni persona vertical, ni agente por defecto. `TenantsService.update()` sí hace bien las cosas al cambiar de industria —reconstruye `verticalConfig`, invalida `vertical:{tenantId}`, audita y hasta **avisa por log cuando el slug no está en el registro** (`tenants.service.ts:244-250`)— pero no re-siembra contenido, y lo dice en el propio audit (`contentReseeded: false`, `:297`). El asimetría está documentada en el código y es correcta; lo que falta es el bootstrap en `create`.

### 2.2 Agente creado

`createDefaultAgentFromGoals` (`persona.service.ts:2672`) corre **antes** del bootstrap vertical. Para `otro`:

1. `getVerticalTemplates('otro')` devuelve un array de **2 plantillas** (`persona.service.ts:2496-2560`): `tpl_otro_ventas` y `tpl_otro_soporte`.
2. Gana `verticalTemplates[0]` = `tpl_otro_ventas` (`:2699`). El mapa `bySubType` (`:2704-2715`) no tiene ninguna clave de `otro` — no podría tenerla: `otro` no tiene sub-tipos.
3. **La rama por objetivos no corre.** La condición es `if (!industry || !this.getVerticalTemplates(industry, tenantLang))` (`:2726`): como `otro` sí tiene plantillas, el bloque de `goals.includes('appointments'|'support'|'faq'|'lead_qualification'|'sales')` (`:2727-2737`) se salta entero.

Consecuencia directa y verificable: **`tpl_otro_soporte` tiene cero caminos de selección en el alta**. El tenant que marca "soporte" como objetivo recibe el asistente de **ventas**. Es el mismo patrón que el dossier 17 documentó para technology, y acá es peor por simetría: la vertical tiene exactamente dos plantillas y una es inalcanzable.

Y hay un segundo efecto, este propio de `otro`: `tpl_otro_ventas` trae `tools.appointments: { enabled: true, canBook: true, canCancel: true }` (`persona.service.ts:2526`) y una regla que dice *"Si el prospecto está listo para comprar, **agenda una reunión** o escala al vendedor"* (`:2516`). Pero `OTRO.bookingEnabled === false` y `OTRO.services === []`. El recorrido completo:

- `countAppointmentsPrerequisites` da `services=0, slots=0` → la herramienta se apaga con el marcador `pendingPrerequisites: true` (`persona.service.ts:2754-2765`).
- `bootstrapVertical` **no siembra servicios** (`verticals.service.ts:49`, exige `bookingEnabled`) ni **disponibilidad** (`:56`, ídem).
- `restoreAppointmentsTool` corre igual, vuelve a contar 0/0, deja la herramienta apagada y **borra el marcador** (`verticals.service.ts:1111-1131`).

Resultado: el agente por defecto de `otro` nace con una regla de conducta que le ordena agendar reuniones y **sin la herramienta para hacerlo**. No es un bug de código —cada pieza hace lo correcto—, es una **contradicción de contenido** entre la plantilla y la definición de la vertical.

Fuera de español, `localizeVerticalTemplates` (`persona.service.ts:2618-2666`) colapsa a `templates[0]` y reemplaza persona + `behavior.rules/forbiddenTopics/handoffTriggers` con los del registro. Para `otro` eso significa cambiar las **5 reglas concretas** de `tpl_otro_ventas` ("captura nombre y teléfono", "usa la base de conocimiento", "escala reclamos") por las **2 frases genéricas** del registro (`vertical-definitions.ts:506`: *"Responde de forma profesional y concisa. Ofrece agendar reuniones cuando sea pertinente."*). `requiredFields` y `tools` sobreviven al spread. Es una pérdida menor comparada con lo que sufren technology o servicios_profesionales (que pierden plantillas enteras), pero la ironía se mantiene: en pt/fr/en, la regla que sobrevive es justamente **la de agendar**, que es la que no se puede cumplir.

### 2.3 Bootstrap — qué siembra exactamente

`bootstrapVertical(tenantId, 'otro', null, lang)` (`verticals.service.ts:22`) ejecuta, para esta vertical:

| Paso | ¿Corre para `otro`? | Qué deja |
|---|---|---|
| `seedPipelineStages` (`:36`) | **Sí** | 6 etapas con `transition_rules` reales: `contactado`→`phone_required`, `calificado`→`name_required`, **`propuesta`→`offer_required`** (`vertical-definitions.ts:509-511`) |
| `patchDefaultAgent` (`:39`) | Sí | Rellena huecos del shape canónico. Como `tpl_otro_ventas` ya trae todo, solo **une** `forbiddenTopics` y `handoffTriggers` del registro (`verticals.service.ts:334-341`) |
| `seedFaqs` + `enableSimpleTool('faqs')` (`:45-46`) | Sí | 5 FAQs genéricas (`vertical-definitions.ts:515-521`) + `tools.faqs` ON |
| `seedServices` (`:49`) | **No** — `bookingEnabled=false` y `services=[]` | — |
| `seedAvailability` (`:56`) | **No** — `bookingEnabled=false` | — |
| `restoreAppointmentsTool` (`:67`) | Sí | Deja `appointments` OFF y limpia el marcador |
| Ramas 4b-4j (tours, dental, inmobiliaria, pets, restaurants, gyms, education, insurance, homeServices, petServices, photography, vehicles) | **Ninguna** | — |
| Persistencia (`:157-176`) | Sí | `settings.verticalConfig` con `bookingEnabled: false` |

Las 5 FAQs semilla son honestas en el sentido que pide el propio archivo (`vertical-definitions.ts:9-16`: nunca afirmar una política que el tenant no confirmó): las cinco invitan a preguntar en vez de inventar. Pero una de ellas es una trampa transversal — ver §4-H4.

### 2.4 Conversación — herramientas reales

El registro de tools es por flag (`conversations.service.ts:1810-1834`). Para un tenant `otro` recién creado, `config.tools = { crm:true, knowledge:true, appointments:false, faqs:true }`:

| tool | qué hace | gating | ¿funciona e2e? |
|---|---|---|---|
| `search_faqs` (`FAQ_TOOL`) | Busca en las FAQs publicadas | `tools.faqs.enabled` — **ON por bootstrap** (`verticals.service.ts:46`) | **Sí.** 5 FAQs sembradas, tabla poblada, portal público funcionando |
| `search_knowledge_base` (`KB_TOOL`) | RAG sobre documentos del tenant | `tools.knowledge.enabled` — ON por plantilla (`persona.service.ts:2526`) | **Sí, pero vacío el día 1.** El tenant tiene que subir documentos en `/admin/knowledge`. Es el único vehículo para que un negocio sin rubro le enseñe al bot qué vende |
| `get_customer_context` (`CUSTOMER_CONTEXT_TOOL`) | Historial/atributos del contacto | `tools.crm.enabled` — ON por plantilla | **Sí** |
| `APPOINTMENT_TOOLS` | Agendar / cancelar / consultar cupos | `tools.appointments.enabled` — **OFF** tras el bootstrap | **No** el día 1. Recuperable a mano: crear servicios + `availability_slots` en `/admin/appointments` y encender el toggle (el gate de `updateAgent` lo valida ahí) |
| `CATALOG_TOOLS` (`search_products`, `get_product`, `check_stock`, `send_product_image`) | Catálogo y stock reales | `tools.catalog.enabled` — **OFF**, nadie la enciende para `otro` | **No, y sin camino.** Ver §4-H2: la UI de inventario está allow-listeada a retail/restaurantes |
| `POLICY_TOOL`, `OFFER_TOOL`, `ORDER_TOOL` | Políticas, promos, pedidos | `tools.policies/offers/orders` — todas **OFF** | No |
| Todas las tools verticales (properties, tours, vehicles, pets, restaurants, gyms, education, insurance, homeServices, petServices, photography, realEstate, treatments) | — | Flags que el bootstrap de `otro` no toca | No, correctamente |

**Tres tools reales.** Es el mínimo defendible: responder preguntas, recordar al cliente, aprender del material que el dueño suba. Lo que falta no es una tool de rubro (no hay rubro) — es que **el catálogo genérico, que ya existe entero y no es de nadie en particular, esté cerrado justo para el tenant sin vertical**.

### 2.5 Handoff — dos capas que se pisan

Antes de que la IA hable corre `detectHandoffTrigger` (`handoff.service.ts:53-113`), con **retorno temprano** y prioridad de plataforma sobre persona. Los `handoffTriggers` propios de `otro` son `queja formal | emergencia | solicitud de reembolso` (`vertical-definitions.ts:506`). Contra los `complaintKeywords` de plataforma (`handoff.service.ts:73-77`):

- `queja formal` → **inalcanzable**: `'queja'` ya matchea en el paso 2 (`:74`) y retorna `complaint`. El trigger propio nunca se evalúa (paso 6, `:107`).
- `solicitud de reembolso` → **inalcanzable**: `'reembolso'` matchea en el paso 2 (`:75`).
- `emergencia` → único que puede disparar, y lo hace por `includes` desnudo: *"no es una emergencia"*, *"la salida de emergencia"*, *"un número de emergencia"* escalan igual.

**2 de 3 muertos, 1 sobre-disparado.** Y la colisión más cara es transversal: `'devolucion'`/`'devolución'` es `complaintKeyword` de plataforma (`:75`) mientras `otro` **siembra la FAQ "¿Tienen política de devolución?"** (`vertical-definitions.ts:520`). El cliente que hace exactamente la pregunta que la plataforma preparó para él **escala a un humano antes de que el bot pueda leer su propia respuesta**. Lo mismo con `descuento` (`:85`) para el caso B2B/mayorista de una ferretería o una papelería.

### 2.6 Embudo y pipeline — el hallazgo central

Etapas sembradas para `otro`: `nuevo`(10) → `contactado`(25, `phone_required`) → `calificado`(40, `name_required`) → **`propuesta`(60, `offer_required`)** → `cerrado_ganado`(100, terminal) / `cerrado_perdido`(0, terminal).

`offer_required` se resuelve así (`pipeline.service.ts:888-902`):

```sql
SELECT 1 FROM commercial_offers co
JOIN leads l ON l.course_id = co.course_id
WHERE l.id = $1::uuid AND co.active = true
```

`leads.course_id` existe (`tenant-schema.sql:416`) — no hay error SQL, hay un `JOIN` que **nunca matchea** salvo que el lead esté enlazado a un curso. Y acá aparece la capa que hace el bloqueo definitivo, en tres pisos:

1. **La página de ofertas existe pero es inalcanzable.** `/admin/catalog/offers` está construida entera (CRUD, `api.listOffers/createOffer/updateOffer`, `lib/api.ts:1396-1402`) y permitida por rol (`roles.ts:180`), pero **`catalog` no es un ítem del sidebar** — el único enlace en todo el dashboard sale del ToolsTour **de retail** (`ToolsTour.tsx:65`), un tour de una sola pasada. Para `otro` (`ToolsTour.tsx:92`, `[]`) y para las otras 16 verticales, el hub `/admin/catalog` (cursos + campañas + ofertas) solo se alcanza tipeando la URL.
2. **Y aunque se alcance, el formulario no puede satisfacer la regla.** El `Form` de la página tiene `offerType, title, conditionsRaw, validFrom, validTo, active` (`catalog/offers/page.tsx:25-31`) y **no expone `courseId`**, aunque el servicio sí lo acepta (`offers.service.ts:85`, `:105`). Una oferta creada desde la UI nace con `course_id = NULL`.
3. **Y con ambos lados en NULL el `JOIN` sigue sin matchear**: en SQL `NULL = NULL` no es verdadero. La regla es insatisfacible por construcción para cualquier tenant que no venga de education.

Entonces:

- **Movimiento manual**: arrastrar una tarjeta a Propuesta lanza `BadRequestException('TRANSITION_RULE_FAILED:offer_required')` (`:901`), que la UI traduce a un toast (`pipeline/page.tsx:592`). No hay forma de satisfacerlo (ver los tres pisos de arriba).
- **Auto-progress**: `autoProgressFromConversation` (`:1260`) mapea el lenguaje de compra a `listo_para_cierre` (prob 95) y el interés fuerte a `caliente` (prob 80) (`:1303-1312`). Como `otro` sí tiene `pipeline_stages` propias, corre `mapGenericToTenantStage` (`:1443`), que elige la etapa **no terminal** de probabilidad más cercana: de 95 y de 80, la ganadora es siempre `propuesta` (60) — la única no terminal por encima de `calificado`(40). Y antes de escribir, `evaluateRulesForLead` falla → `return` sin avanzar, con log "Auto-progress held" (`:1373-1385`).

**Efecto neto para toda la vertical `otro`: ningún lead pasa jamás de "Calificado" por vía automática, y ninguna persona puede moverlo a "Propuesta" a mano.** El único camino a `cerrado_ganado` es un salto manual Calificado→Cerrado ganado (esa etapa no tiene reglas). El 4º de 6 carriles del tablero por defecto está muerto.

Vale precisar dos cosas para no exagerar: (a) el resto del gobierno **funciona bien** — `phone_required` y `name_required` son satisfacibles y son justamente lo que `tpl_otro_ventas` pide capturar (`persona.service.ts:2521-2524`), un encaje raro y bueno en esta ronda; (b) el `hold` es deliberado y correcto como diseño (`:1369-1372`: "soft-hold — leave it where it is"). El defecto no está en el motor de reglas: está en **una regla de education viviendo en el pipeline por defecto**.

Y el contraste que responde a la pregunta del catálogo: `otro` es la **única** de las cinco verticales construidas con `createGenericVertical` que **no sobrescribe `pipeline`**. Finanzas (`:545-552`), servicios_profesionales (`:569-576`), retail (`:594-601`) y technology (`:614-622`) definen sus propias etapas **sin una sola `transitionRules`** → `seedPipelineStages` escribe `[]` (`verticals.service.ts:264`). O sea: las cuatro verticales "con vestuario" tienen embudo con nombre propio y **cero gobierno**; `otro` tiene embudo genérico y **gobierno real, salvo por una regla imposible**.

### 2.7 Dashboard del tenant

- **Sidebar**: `otro` no aparece en ningún `verticals:[...]` (`AppSidebar.tsx:124-140`), así que ve el núcleo horizontal completo — Inbox, CRM/Pipeline/Organizaciones, **Agenda** (sin gate por `bookingEnabled`, `:122`), Campañas, Automatización, Agente, KB, Analytics, Canales — y **ninguna** página de rubro. Correcto por diseño, con dos excepciones caras: `inventory` y `orders` están allow-listeadas a `["retail","restaurantes"]` (`:139-140`), o sea que la ferretería no tiene dónde cargar productos (§4-H2); y **no existe ítem de sidebar para `/admin/catalog`** en ninguna vertical (§4-H1b).
- **`labelOverrides: {}` y `hiddenItems: []`** (`vertical-definitions.ts:524`): sin renombres. El sidebar dice "Contactos", "Embudo", "Agenda". Es lo correcto para un negocio sin rubro.
- **KPIs**: `leadsToday`, `leadsHot`, `messagesProcessed`, `llmCostToday` (`:526-529`). Los cuatro están soportados por el dashboard (`admin/page.tsx:69`, `:212`) — **funcionan**. `otro` es de las pocas verticales cuyo `leadsHot` está en la definición y en el render.
- **Checklist**: `OnboardingChecklist.tsx:166` excluye explícitamente a `otro` de la búsqueda de copy por industria y usa el genérico. Es una decisión deliberada y correcta.
- **ToolsTour**: `otro: []` (`ToolsTour.tsx:92`) y default `"otro"` (`:108`). Sin tour — coherente: no hay herramienta de rubro que mostrar. (Distinto del caso technology, donde `[]` sí era un hueco porque tenía agenda.)
- **Terminología**: cliente / clientes / venta / servicio / ventas (`vertical-definitions.ts:505`). Llega al prompt vía `<vertical_context>`.

### 2.8 `chatReasons` / `customerTypes` — verificación del fix `5c2581db`

El hallazgo #1 de la matriz para `otro` ("lo que el usuario escribe en 'otro: …' es write-only") **está resuelto y verificado**:

- Productor: `conversations.service.ts:1622-1648`. Lee `settings.chatReasons`/`customerTypes`, **desprefija `other:`** (`:1636` → `x.slice(6).trim()`), limita a 8 ítems, cachea 600s en `bizgoals:{tenantId}` y los mete en `turnContext.verticalContext.businessGoals/targetAudiences`.
- Consumidor: `prompt-assembler.service.ts:164-165` los emite como `<business_goals>` y `<target_audiences>` dentro de `<vertical_context>`, con el comentario que apunta explícitamente a esta vertical (`:161-163`).
- Regla que los activa: la #13 del contrato L1 (`:82`) instruye al modelo a usar `<vertical_context>`.

Funciona. Dos precisiones que la verificación deja al descubierto y que **no** estaban en el alcance del fix:

1. **Lo que baja al prompt para las opciones tildadas son las claves crudas del enum**, no prosa: `<business_goals>faq | appointments | lead_qualification</business_goals>`, `<target_audiences>b2c | government</target_audiences>`. El texto libre —el más valioso, y el único que existe en `otro`— sí baja en castellano legible. Es decir: el fix acierta exactamente donde importa, pero para el resto le pasa al LLM un vocabulario de programador.
2. **Ese dato se escribe una sola vez y no se puede editar nunca.** `chatReasons`/`customerTypes` tienen exactamente **dos referencias en todo el repo**: la escritura en `auth.service.ts:1616-1617` y la lectura en `conversations.service.ts:1639`. **Cero referencias en el dashboard.** El dueño que se describió mal en el minuto 3 de su vida como cliente no tiene pantalla donde corregirse. La vía de escape existe y es buena — `Configuración → Business Info` escribe `about`, que baja al prompt como `<business><about>` (`prompt-assembler.service.ts:133`; `settings/business-info/page.tsx`) — pero nadie le dice que ese es el lugar.

### 2.9 Integraciones

Ninguna. `otro` no tiene proveedor en T3.19 (Toast/Mindbody/Cliniko se gatean por conexión, no por vertical: `conversations.service.ts:1846-1850`), no tiene channel manager, no tiene e-commerce (`tools.ecommerce` apagada). Lo transversal sí le llega: MCP externo (`:1858`), CTWA/attribution, reviews de Google Business — nada de eso es vertical.

---

## 3. La experiencia hoy, contada honestamente

### (a) El dueño de la ferretería, primeros 30 minutos

Marca "Otro" en el paso 1 y el wizard **deja de preguntarle por sub-tipo** — se nota, y se nota bien: no hay un desplegable con opciones ajenas. En el paso 3 encuentra algo que ninguna de las otras 17 verticales ofrece: **un campo de texto libre** para describir su objetivo y su público. Escribe "vender tornillería y herramienta a maestros de obra". Ese texto **llega de verdad al prompt** (`5c2581db`, verificado en §2.8). Es el mejor momento del recorrido.

Entra al panel. Ve el núcleo entero sin renombres raros: Inbox, Contactos, Embudo, Agenda, Campañas, Agente, Base de conocimiento. **No ve Inventario ni Pedidos** — están reservados a retail y restaurantes (`AppSidebar.tsx:139-140`). Es dueño de una ferretería y **no tiene dónde poner los productos**. Va a "Base de conocimiento" y ahí sí puede subir su lista de precios como documento. Funciona, pero convierte un catálogo en un PDF que la IA lee: sin stock, sin foto, sin precio consultable.

Abre el Agente. Se llama "Asistente de Ventas" y sus reglas dicen *"Si el prospecto está listo para comprar, **agenda una reunión**"* — pero el toggle de Agenda está **apagado** (`verticals.service.ts:1123`) y si intenta encenderlo el gate le exige servicios + horarios que la vertical decidió no sembrar. Para una ferretería no querer agenda es correcto; **decirle al bot que agende y no dárselo, no**.

Abre el Embudo: seis columnas. Arrastra una tarjeta a "Propuesta" y recibe un error de prerrequisito que nunca va a poder satisfacer (§2.6). No hay pantalla de ofertas en el producto. Ese es el peor minuto de los treinta.

**Dónde brilla**: no le mienten con vocabulario ajeno; el texto libre del alta se usa de verdad; el checklist y el tour se callan en vez de inventar pasos de rubro; los 4 KPIs del panel funcionan.
**Dónde se cae**: no tiene catálogo. **Dónde miente**: el agente promete agendar; el embudo promete una columna que no admite a nadie.

### (b) El cliente final por WhatsApp, primeros 3 mensajes

**M1 — "Hola, ¿tienen brocas para concreto de 3/8?"**
El bot responde con `search_knowledge_base` si el dueño subió la lista, o con una respuesta general si no. **No puede consultar stock ni precio** (`CATALOG_TOOLS` apagada) y el contrato L1 le prohíbe inventar (`prompt-assembler.service.ts:69`). Con KB cargada: aceptable. Sin KB: un "déjame confirmarte" honesto pero inútil.

**M2 — "¿Y me hacen descuento si llevo una caja?"**
`'descuento'` es `discountKeyword` de plataforma (`handoff.service.ts:85`) → **escala a un humano antes de que la IA hable**. Para un negocio de mostrador con precio por volumen —el caso B2B típico de una ferretería, una papelería o una imprenta— eso es la conversación entera derivada a una persona. En un rubro con margen de negociación es defendible; como comportamiento por defecto y sin que el dueño lo sepa, no.

**M3 — "Ok, ¿cuál es la política de devolución?"**
`'devolucion'` es `complaintKeyword` de plataforma (`:75`) → **escala**. Y `otro` tiene sembrada exactamente esa FAQ (`vertical-definitions.ts:520`). **La plataforma preparó la respuesta y después bloqueó la pregunta.** Es la contradicción más limpia del dossier.

Y si en algún punto el cliente escribe "lo llevo" o "lo compro": el auto-progress apunta a `propuesta`, la regla `offer_required` falla, y la tarjeta **se queda en Calificado**. La venta ocurre en el chat y el embudo no se entera.

---

## 4. Huecos finos

| # | Hueco | Sev. | Evidencia | Arreglo | Esf. |
|---|---|---|---|---|---|
| **H1** | **`offer_required` en el pipeline por defecto**: la etapa `propuesta` de `otro` exige un `commercial_offers` enlazado por `leads.course_id` (concepto de education). Bloquea el movimiento manual y congela el auto-progress en `calificado` para toda la vertical | **Crítica** | `vertical-definitions.ts:511`; `pipeline.service.ts:888-902`; `tenant-schema.sql:416`; mapeo 95/80→`propuesta` en `pipeline.service.ts:1303-1312` + `:1443-1470` | Quitar `transitionRules: [{type:'offer_required'}]` de `:511` (el pipeline genérico solo lo usa `otro`). Alternativa conservadora: en `runRuleChecks`, tratar `offer_required` como no-aplicable cuando `leads.course_id IS NULL` | **S** |
| **H1b** | **El hub `/admin/catalog` (cursos + campañas + **ofertas**) no tiene entrada en el sidebar**: existe entero y permitido por rol, pero el único enlace del dashboard sale del ToolsTour **de retail**. Y su formulario de ofertas no expone `courseId`, así que ni siquiera tipeando la URL se puede satisfacer H1 | Media | `catalog/offers/page.tsx:25-31`; `lib/api.ts:1396-1402`; `offers.service.ts:85`, `:105`; `roles.ts:180`; único enlace: `ToolsTour.tsx:65`; sin ítem `catalog` en `AppSidebar.tsx:105-141` | Ítem de sidebar para `/admin/catalog` (o al menos para `offers`, que es transversal); campo `courseId` opcional en el formulario | **S** |
| **H2** | **El fallback no tiene catálogo**: `inventory`/`orders` allow-listeados a `["retail","restaurantes"]`, `tools.catalog` nunca encendida para `otro`. El negocio que vende cosas y no calza en retail no tiene dónde cargarlas (y el hub `/admin/catalog` tampoco es navegable — H1b) | **Alta** | `AppSidebar.tsx:139-140`; `conversations.service.ts:1814`; `catalog-tools.ts:7-51` | Agregar `otro` a los dos `verticals:[...]`. No encender `tools.catalog` en el bootstrap (sin productos daría tool vacía): encenderla cuando el tenant cargue el primer producto, o dejar el toggle visible en el editor de agente | **S** |
| **H3** | **`tpl_otro_soporte` inalcanzable**: 0 caminos de selección. `bySubType` no tiene claves de `otro` (no hay sub-tipos) y la rama por objetivos se saltea porque `getVerticalTemplates('otro')` es truthy | **Alta** | `persona.service.ts:2496`, `:2531`, `:2699`, `:2704-2715`, `:2726` | Dentro de la rama vertical, elegir por objetivo cuando hay >1 plantilla: `goals.includes('support') → tpl_*_soporte`. Aplica también a technology (2 plantillas, mismo síntoma) | **S** |
| **H4** | **La FAQ semilla que la plataforma bloquea**: `otro` siembra "¿Tienen política de devolución?" y `'devolucion'` es `complaintKeyword` de plataforma con retorno temprano | **Alta** | `vertical-definitions.ts:520`; `handoff.service.ts:75`, `:78-80` | Dos opciones no excluyentes: (a) exigir co-ocurrencia con señal de queja (`'quiero una devolución'`, `'exijo'`) en vez de la palabra suelta; (b) chequear FAQs antes de escalar por `complaint` cuando el texto es interrogativo | **M** |
| **H5** | **`handoffTriggers` de `otro`: 2 de 3 muertos, 1 sobre-disparado**: `queja formal` sombreado por `'queja'`, `solicitud de reembolso` por `'reembolso'`; `emergencia` matchea por substring desnudo | Media | `vertical-definitions.ts:506`; `handoff.service.ts:73-77` (paso 2, retorno temprano) vs `:107-111` (paso 6) | Reemplazar los 3 por triggers que no colisionen y sean útiles a un negocio sin rubro: `pedido mayorista`, `factura`, `garantia`, `entrega urgente` | **S** |
| **H6** | **La plantilla ordena agendar sin agenda**: `tpl_otro_ventas` trae `appointments.enabled=true` + regla "agenda una reunión", pero `OTRO.bookingEnabled=false` y `services=[]` garantizan que quede apagada | Media | `persona.service.ts:2516`, `:2526`, `:2754-2765`; `vertical-definitions.ts:531`, `:522`; `verticals.service.ts:49`, `:56`, `:1123` | Decidir en un solo lugar: o sembrar 1 servicio genérico ("Reunión — 30 min") + `bookingEnabled: true`, o quitar `appointments` y la regla de la plantilla. La primera opción es más útil (el asesor/consultor sin rubro es el `otro` más frecuente) | **S** |
| **H7** | **Modal de super_admin con 4 slugs muertos**: `restaurante`, `ecommerce`, `servicios`, `educacion` no están en `VERTICAL_REGISTRY` → resuelven a `otro` en silencio, y quedan escritos en `tenants.industry` como slugs que ningún gate de sidebar ni aggregator reconoce | Media | `CreateTenantModal.tsx:61-67`; `EditTenantModal.tsx:57-63`; `vertical-definitions.ts:1163-1164`; `AppSidebar.tsx:411-413` | Generar el desplegable desde `Object.keys(VERTICAL_REGISTRY)` (18 opciones) en vez de una lista congelada | **S** |
| **H8** | **`TenantsService.create()` no bootstrapea**: un tenant creado por super_admin queda sin etapas, FAQs, persona vertical ni agente. `bootstrapVertical` tiene **1 solo llamador** en todo el repo | Media | `tenants.service.ts:28-80`; único llamador `auth.service.ts:1707` | Llamar a `bootstrapVertical` + `createDefaultAgentFromGoals` desde `create()`, con el mismo `try/catch` no-fatal del alta | **M** |
| **H9** | **Doble clave de fallback en las dos vistas de plataforma**: `t.industry \|\| 'otro'` en el API de vertical-analytics vs `t.industry \|\| 'other'` en el dashboard de super_admin | Baja | `vertical-analytics.service.ts:61`; `admin/page.tsx:160`; origen del slug: `auth.service.ts:1603` | Unificar en `'otro'` en los tres puntos. Migración de datos opcional (`UPDATE tenants SET industry='otro' WHERE industry='other'`), aditiva y sin riesgo | **S** |
| **H10** | **El alta es irrepetible**: `chatReasons`/`customerTypes` se escriben una vez y no hay UI para editarlos. Y las opciones tildadas bajan al prompt como claves de enum (`lead_qualification`, `b2c`), no como prosa | Baja | 2 referencias totales: `auth.service.ts:1616-1617` (write), `conversations.service.ts:1639` (read); 0 en el dashboard | (a) Editar objetivos/audiencia desde `Configuración → Business Info` (misma pantalla que ya edita `about`), invalidando `bizgoals:{tenantId}`. (b) Mapear las claves a etiqueta i18n antes de emitir el XML | **M** |
| **H11** | **El texto libre no queda en ningún lado analizable**: `settings.chatReasons` es el único registro de qué hace un tenant `otro`, y `/admin/vertical-analytics` solo agrupa por `industry` y cuenta `settings.subType` — que para `otro` es siempre vacío | Baja (alta como oportunidad) | `vertical-analytics.service.ts:61-75` (solo `subType`); `INDUSTRY_AGGREGATORS` (`:248`) sin entrada `otro`; `detectActivationGaps` (`:119-130`) sin entrada `otro` | Ver §7-C: el drilldown de `otro` debería listar los `chatReasons` libres de sus tenants. Es una lectura de JSONB, no un módulo nuevo | **S** |

Aclaración deliberada sobre lo que **NO** es un hueco: que `otro` no tenga aggregator ni check de activación en `/admin/vertical-analytics` es **correcto** — no hay tabla de dominio cuya vacuidad signifique "no activado". Y que `ToolsTour.otro` esté vacío también: no hay herramienta de rubro que mostrar.

---

## 5. Lo que esta industria necesita y no tenemos

Esta sección es distinta a las 17 anteriores por una razón estructural: **`otro` no es una industria, así que no tiene features de rubro**. Lo que necesita es un contrato mínimo de dignidad. Y como el nombre de `otro` en el mercado es "la cola larga", conviene ser explícito sobre cuán larga es.

### 5.1 Cuánto mercado queda realmente afuera de las 17

Recorriendo los ~85 nichos que `market-research-latam.md` §2 enumera por país, **solo dos no tienen vertical propia**:

| Rubro sin vertical | Dónde aparece | Encaje más cercano hoy |
|---|---|---|
| **Logística / freight forwarders SMB** | Panamá #3 (`market-research-latam.md:194`) | Ninguno. `otro` |
| **Autoescuelas / driving schools** | Honduras #4 (`:141`) | `education` (cursos + cohortes ya sirven; no está en su lista de sub-tipos) |
| *(parcial)* Tienditas / abarrotes / mayorista informal | México (`:116`), Venezuela (`:255`), Paraguay/Ciudad del Este (`:349`) | `retail`, incómodo: es mostrador y volumen, no e-commerce |

Todo lo demás está cubierto, a veces con precisión: farmacias→`salud>farmacia` (Argentina #4, `:325`), repuestos→`automotriz>repuestos`, agencias de viaje→`turismo>agencia_viajes`, servicios legales→`servicios_profesionales`, home services→`servicios_hogar`, brokers→`seguros`. **La conclusión de mercado es que el catálogo de 17 cubre lo documentado casi por completo, y que `otro` no es un segmento desatendido sino el residuo.** Eso es un argumento fuerte contra invertir en `otro` como vertical — y uno igual de fuerte a favor de que el residuo funcione bien, porque quien cae ahí no tiene alternativa dentro del producto.

### 5.2 Mesa de entrada (sin esto no somos creíbles con un negocio sin rubro)

1. **Un catálogo genérico accesible.** Es el único "feature de rubro" que aplica a la cola larga entera: ferretería, papelería, imprenta, taller de bicicletas, distribuidora. El módulo (`inventory`, `catalog`, `CATALOG_TOOLS`) **existe completo**; lo que falta son dos strings en un allow-list (§4-H2).
2. **Un embudo que admita mover tarjetas.** §4-H1.
3. **Coherencia entre lo que la plantilla ordena y lo que la vertical habilita** (agenda). §4-H6.
4. **Que las preguntas normales de comercio no escalen por defecto.** "Descuento" y "devolución" son vocabulario cotidiano de mostrador, no señales de conflicto. §4-H4.

### 5.3 Diferenciador (solo si se decide)

1. **Vertical emergente por detección.** Hoy el dato existe (texto libre en `settings.chatReasons`) y **no hay ninguna superficie que lo lea con fines analíticos** (§4-H11). El mecanismo mínimo no requiere ML: listar en el drilldown de `/admin/vertical-analytics?industry=otro` los textos libres de cada tenant, ordenados. Con 30 tenants `otro` alcanza para ver a ojo si diez dicen "logística" o "importación". Si se quiere un paso más: agrupar por embedding (la infra pgvector ya está en `knowledge/` y `feature-requests` ya vectoriza texto libre, `feature-requests.service.ts:554`). **Esto es lo único de este dossier que puede cambiar la estrategia del catálogo**, y es barato.
2. **Un "bootstrap por descripción"**: en vez de sub-tipos, pedirle al tenant `otro` una descripción de 2 frases y generar con el LLM sus FAQs y su lista de servicios iniciales. Encaja con el motor de procedimientos (T2.12) que ya compila lenguaje natural a pasos (`procedures/`), y con la narrativa "Vibe Selling" que el análisis competitivo dice que hay que ganar (`competitive-analysis-2026-q2.md:215`). Es la respuesta correcta al problema "no tengo rubro": que el rubro lo describa el dueño y lo materialice la IA.

---

## 6. Competencia del rubro

No hay "competencia de la vertical otro": nadie vende a "negocios sin rubro". Lo que sí hay en nuestros docs es evidencia sobre **cómo compite un catálogo de verticales**, y es directamente aplicable:

- **La estrategia recomendada es explícitamente "thin vertical, deep horizontal"** (`competitive-analysis-2026-q2.md:404`): *"Los especialistas tienen años de profundidad en el system-of-record… Replicar eso es trampa de recursos… Nuestra ventaja defendible es la capa conversacional multicanal + booking determinístico."* Eso es, palabra por palabra, la tesis de `otro`: el valor está en el horizontal, y la vertical es empaque.
- **El diagnóstico honesto del propio doc**: *"Existen 9+ módulos verticales… Son 'data schema holders' con AI tools y terminología — útiles, pero no profundos"* (`:50`). Y en el cierre: *"Las verticales son esquemas, no integraciones. Solo Guesty es real. El foso es la narrativa + AI tools, no la profundidad"* (`:595`).
- **Los competidores que sí usan presets por industria validan el enfoque, no la profundidad**: Gupshup con "AI Agents pre-entrenados por industria" (`:362`, *"Valida directamente nuestro approach de verticales auto-bootstrap"*) y Thryv con presets por industria (`:420`), con pricing US-céntrico ($199-499/ubicación) que *"deja espacio enorme en LatAm"*.
- **El rival LatAm más directo compite con narrativa, no con verticales**: Leadsales y su "Vibe Selling" — *"no armes flujos; da contexto y deja que opere"* (`:371`, `:215`) — a $83.99/mes. Contra eso, un tenant `otro` bien atendido (KB + FAQs + CRM + campo libre que llega al prompt) es exactamente el producto competitivo; lo que le falta es catálogo y embudo funcional.
- **El inventario de plantillas verticales es activo de canal**: el doc propone un *"marketplace de plantillas verticales white-label"* para el modelo reseller (`:400`). Eso cambia la lectura de "¿sobran verticales?": aun las que no generan demanda directa son inventario para partners.

Y el dato de higiene que el propio análisis pedía revisar: sigue diciendo "12 verticales" cuando hay 17 + `otro` (`vertical-maturity-audit-2026-07.md:159`), repetido en `:431`, `:514`, `:589`.

---

## 7. Plan de inversión de ESTA vertical

Coherente con **MANTENER**: nada acá construye una vertical. Todo repara el piso — y por eso el retorno no es "otro mejora", es "las 18 mejoran" en los ítems A1, A4 y B1.

### A. Quick wins (días)

| # | Qué | Archivos | Esf. |
|---|---|---|---|
| **A1** | **Quitar `offer_required` del pipeline genérico.** Es la única `transitionRule` imposible de satisfacer fuera de education, y el pipeline genérico solo lo usa `otro`. Desbloquea la columna Propuesta y descongela el auto-progress | `vertical-definitions.ts:511` (borrar `transitionRules`); opcional: guard `course_id IS NULL` en `pipeline.service.ts:888-902` | **S** |
| **A2** | **Abrir el catálogo al fallback.** Agregar `"otro"` a los `verticals:[...]` de `inventory` y `orders`, y darle entrada de sidebar al hub `/admin/catalog` (hoy solo enlazado desde el tour de retail); dejar el toggle `catalog` visible en el editor de agente | `AppSidebar.tsx:139-140` y `:105-141`; i18n ×4 | **S** |
| **A3** | **Resolver la contradicción de la agenda.** Recomendado: sembrar 1 servicio genérico ("Reunión — 30 min", `durationMinutes: 30`, `price: 0`) y poner `bookingEnabled: true` en `OTRO`. Con eso `seedServices` + `seedAvailability` corren y `restoreAppointmentsTool` la reenciende sola — sin tocar una línea del motor | `vertical-definitions.ts:1136` (pasar config en vez de `{}`) | **S** |
| **A4** | **Plantilla por objetivo cuando la vertical tiene más de una.** Revive `tpl_otro_soporte` y `tpl_technology_soporte` con la misma línea | `persona.service.ts:2699-2723` | **S** |
| **A5** | **`handoffTriggers` que puedan disparar.** Cambiar `queja formal\|emergencia\|solicitud de reembolso` por `pedido mayorista\|factura electronica\|garantia\|entrega urgente` (sin tildes, según la convención de `vertical-definitions.ts:17-22`) | `vertical-definitions.ts:506` | **S** |
| **A6** | **Desplegable de industrias generado desde el registro** en los dos modales de super_admin (mata los 4 slugs muertos) | `CreateTenantModal.tsx:61-67`; `EditTenantModal.tsx:57-63`; i18n ×4 | **S** |
| **A7** | **Unificar el fallback en `'otro'`** en los tres puntos (`auth.service.ts:1603`, `admin/page.tsx:160`, `vertical-analytics.service.ts:61`) + `UPDATE` aditivo opcional | 3 archivos | **S** |

### B. Mediano (semanas)

| # | Qué | Archivos | Esf. |
|---|---|---|---|
| **B1** | **Que las preguntas de comercio no escalen por defecto.** `'devolucion'`/`'descuento'` sueltas no son señal de conflicto; exigir co-ocurrencia con marcador de queja o con forma imperativa, y consultar FAQs antes de escalar cuando el mensaje es interrogativo. Beneficia a retail, restaurantes, seguros y servicios_profesionales tanto como a `otro` | `handoff.service.ts:73-90`; test de regresión sobre las FAQs semilla de las 18 | **M** |
| **B2** | **Bootstrap en `TenantsService.create()`** — el tenant creado a mano deja de nacer hueco | `tenants.service.ts:28-80` | **M** |
| **B3** | **Editar objetivos/audiencia post-alta** desde `Configuración → Business Info`, con invalidación de `bizgoals:{tenantId}`; y mapear las claves de enum a etiqueta legible antes de emitirlas en `<business_goals>` | `settings/business-info/page.tsx`; `business-info` service; `conversations.service.ts:1634-1640`; i18n ×4 | **M** |

### C. Apuesta (solo si se decide)

**"Vertical emergente" — instrumentar el residuo antes de decidir el próximo rubro.** Hoy la plataforma no puede responder *"¿qué son, realmente, mis tenants `otro`?"*, y esa es la única pregunta cuya respuesta podría justificar la vertical #19. La versión mínima: en `getIndustryDrilldown('otro')` devolver también los `settings.chatReasons`/`customerTypes` de cada tenant (lectura de JSONB que ya se trae en el `select` de `getOverview`, `vertical-analytics.service.ts:43`), y renderizarlos como lista en el drilldown. La versión completa: vectorizar el texto libre con la infra pgvector existente y mostrar clusters con conteo, con un umbral explícito ("≥15 tenants describiendo lo mismo → candidata a vertical"). Esfuerzo: **S** la mínima, **M** la completa. Es la única inversión de este dossier que puede cambiar decisiones de producto, y su costo es una consulta y una tarjeta.

Y una decisión de copy, no de código, que corresponde plantear acá porque `otro` es donde más se nota: **el objetivo elegido en el alta no influye hoy en nada para 18 de 18 industrias** (`persona.service.ts:2726` saltea la rama para toda industria con plantillas, y las 18 tienen). O se implementa A4 —que le devuelve efecto real en las verticales con más de una plantilla— o se cambia el texto de esa pantalla para que no prometa personalización que no ocurre. La primera es una línea; la segunda es honestidad. **No hacer ninguna de las dos es la única opción mala.**

---

## 8. Qué no se verificó

- **No se corrió nada en vivo.** Todo el recorrido está inferido de código leído; no hay tenant `otro` real observado ni conversación de prueba ejecutada.
- **No se consultó la base de producción**: no sé cuántos tenants tienen `industry='otro'`, cuántos `'other'`, ni cuántos cargan los 4 slugs muertos del modal de super_admin. Todo el dossier trata esas rutas como *alcanzables*, no como *frecuentes*.
- **No se leyeron los textos libres reales** de `chatReasons`/`customerTypes` de ningún tenant: la afirmación de que ahí hay señal de vertical emergente es una hipótesis sobre un campo que existe, no una medición.
- **El conteo de "~85 nichos" de `market-research-latam.md` §2 es mío**, hecho leyendo las listas país por país; el doc no publica ese total. La clasificación "tiene vertical / no tiene" es un juicio de encaje, no una tabla del doc.
- **No se verificó el comportamiento de `mapGenericToTenantStage` con etapas personalizadas por el tenant**: el análisis de §2.6 asume las 6 etapas sembradas por el bootstrap. Un tenant que agregue una etapa no terminal de probabilidad ~90 cambiaría el destino del auto-progress.
- **No se revisó el flujo del widget web ni del portal público de FAQs** para `otro` en particular; se asume que se comportan como en el resto de las verticales.
- **No se auditó `procedures/` (T2.12)** como vía alternativa para dar flujo a un negocio sin rubro, más allá de constatar que existe y que compila lenguaje natural a pasos.

---

## 9. Nota de cierre de la ronda

Leídos los 17 dossiers previos, cinco patrones se repiten con una regularidad que ya no es casualidad. **(1) El defecto dominante no es la ausencia, es la inalcanzabilidad**: gimnasios tenía la reserva de clase entera y nadie podía crear miembros; automotriz tenía el motor y un flag apagado; seguros y education tienen tools contra tablas que ningún escritor puebla; fotografía tiene dos sistemas de reserva que no se ven entre sí. Se construyó mucho más de lo que se puede usar. **(2) La plataforma se sabotea antes de que la IA hable**: los `handoffTriggers` y `complaintKeywords` por substring con retorno temprano anularon el caso central de servicios_hogar (`emergencia`), automotriz (`prueba de manejo`), servicios_profesionales (`abogado`), technology (`no funciona`), seguros (`reclamo`), retail (`devolución`) y ahora `otro` (`devolución`, `descuento`) — **siete de dieciocho, siempre el mismo mecanismo**, y en cinco de esas siete el culpable es una lista de plataforma que el dueño del negocio no puede ver ni editar. **(3) El auto-progress inventa embudo sin gobierno**: en finanzas "pre-aprueba" créditos, en servicios_profesionales "abre expedientes", en technology infla el forecast — porque las verticales que sobrescriben `pipeline` pierden las `transitionRules`; e irónicamente la única que las conserva, `otro`, las tiene rotas por una regla ajena. **(4) Fuera de español se cae el trabajo fino**: `localizeVerticalTemplates` colapsa a `[0]` y borra la plantilla especializada justo en Brasil, en Puerto Rico y en Uruguay — mercados que los propios docs marcan como premium. **(5) Cinco rubros esperan el mismo cron temporal** (recall dental, vacunas veterinarias, inactividad de gimnasio, rebooking de belleza, renovación de pólizas): es una pieza, no cinco.

Sobre el catálogo como conjunto, lo que le diría al dueño: **no sobran verticales, sobra la creencia de que una vertical es un producto.** Los 18 dossiers muestran que la diferencia real entre `otro` (15/36) y finanzas/servicios_profesionales/technology (12-14/36) es terminología, un embudo con nombre y una persona con nombre propio — y eso **sí vale**, porque es lo que hace que la PYME se reconozca en el minuto 1 y es lo que los competidores validan (Gupshup, Thryv) y lo que un canal reseller puede revender como inventario. Lo que no vale es seguir agregando presets mientras el piso tiene el embudo bloqueado por una regla de otra industria, el catálogo cerrado para quien no es retail, y una capa de handoff que escala la pregunta que la propia plataforma sembró. El orden correcto es el que el análisis competitivo ya escribió y nadie contradijo en 18 dossiers: **thin vertical, deep horizontal** (`competitive-analysis-2026-q2.md:404`). Arreglar el horizontal mejora 18 verticales a la vez; profundizar una mejora una. Con esa vara, la lista de esta ronda casi se escribe sola: el cron temporal, el handoff que no se adelanta a la IA, el motor de reservas multi-recurso, y el gobierno del embudo. Y para la #19, no adivinar: **instrumentar `otro` y dejar que el mercado la nombre.**
