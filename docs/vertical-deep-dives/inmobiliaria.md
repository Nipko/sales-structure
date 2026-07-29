# Inmobiliaria — deep-dive (Jul 2026)

> Dossier 3/18. Fuentes: ficha `vertical-maturity-audit-2026-07.md:74` (24/36, media), `cluster-activos.json`, `eje-booking-capacidad.json`, código leído archivo:línea, y mercado SOLO desde `market-research-latam.md` / `vertical-strategy.md` / `competitive-analysis-2026-q2.md`. Estado post-fixes `95f758f3` / `b9bd6332` / `5c2581db` / `60049164` — nada de eso se re-reporta como roto.

## 1. Veredicto y tesis de inversión

**INVERTIR — con foco quirúrgico en el ciclo de la visita, no en más features.** Inmobiliaria es la demanda #4 de LatAm (84 pts, `market-research-latam.md:385`) y, a diferencia de belleza/dental/salud (#1-#3), acá el trabajo pesado YA está hecho: inventario real con campos LatAm (estrato, VIS, codeudor, administración — `tenant-schema.sql:1880-1914`), 3 tools IA encendidas solas por el bootstrap (`verticals.service.ts:94-97`), la mejor plantilla de persona del catálogo (`tpl_inmobiliaria_listings`, `persona.service.ts:1538-1590`), las mejores FAQs del clúster y página propia con sidebar. Es la vertical top-4 de demanda más cercana a "ganadora" por costo marginal.

Lo que la separa de serlo es una sola cosa, repetida en tres formas: **el evento de conversión del rubro — la visita — es genérico.** La cita no queda ligada a la propiedad (el asesor no sabe qué va a mostrar), el modelo de conflicto es el inverso al que la agencia necesita (dos visitas a propiedades distintas se bloquean entre sí; capacidad 1 por franja para toda la oficina), y el ruteo al asesor correcto — construido entero en backend — no tiene un solo llamador. A eso se suma el frío de activación: el inventario solo entra a mano, sin importar de los portales donde ese inventario ya vive (FincaRaiz/Metrocuadrado/Inmuebles24, `vertical-strategy.md:56,340` — 0 código). La tesis: 2-3 semanas de cirugía sobre la visita + ruteo + import cierran el gap entre "punto medio sólido" y la vertical que justifica el pitch del research (*"tu bot califica 50 leads por ti, agenda visitas automáticamente"*, `market-research-latam.md:501`).

## 2. Radiografía end-to-end

### Alta

- **Sub-tipos** (4): venta / arriendo / comercial / construccion (`onboarding/page.tsx:112-117`; registry `vertical-definitions.ts:192-197`). **Ninguno cambia nada**: `bootstrapVertical` no ramifica por sub-tipo para inmobiliaria (la rama :94-97 es incondicional) y `createDefaultAgentFromGoals` no tiene entrada inmobiliaria en `bySubType` (`persona.service.ts:2702-2713` — hoy mapea tours/agencia_viajes/tienda/delivery/dark_kitchen/dental).
- **Objetivos del alta**: calificar interesados (presupuesto, zona), agendar visitas, informar portafolio/financiación, seguimiento (`onboarding/page.tsx:209-214`). **Audiencias**: compradores / arrendatarios / inversionistas (`:310-314`). Post-`5c2581db` esos `chatReasons`/`customerTypes` sí llegan al prompt L3.

### Agente creado

`createDefaultAgentFromGoals` toma `verticalTemplates[0]` = **`tpl_inmobiliaria_ventas`** (`persona.service.ts:1482-1508`, selección :2694-2697): persona correcta (califica presupuesto/zona/urgencia, nunca garantiza valorización) pero `tools: { appointments }` y **cero menciones a `search_listings` en sus reglas**. La plantilla estrella `tpl_inmobiliaria_listings` (:1538-1590) — con disciplina de catálogo ("USA search_listings… no inventes propiedades"), reglas VIS/codeudor/administración y requiredFields name+phone — es la [2] del array y **nunca es el default**. El bootstrap luego enciende `tools.realEstate` sobre el agente default (`enableRealEstateTool`, `verticals.service.ts:913-934`), así que la IA TIENE la herramienta pero su persona no la instruye. Tercera plantilla: `tpl_inmobiliaria_soporte` (post-venta, :1510-1536).

### Bootstrap (qué siembra)

| Pieza | Contenido | Evidencia |
|---|---|---|
| Pipeline 7 etapas | Consulta → Calificado (name+phone+min_score 5) → Visita agendada (**appointment_required**) → Propuesta → Negociación (email_required) → Cerrado / Perdido | `vertical-definitions.ts:215-225` |
| FAQs | 5 del registry (:226-232) + 5 operativas extra: financiación, agendar visita, comisión, **documentos arriendo (codeudor, extractos)**, **administración aparte** | `verticals.service.ts:812-907` |
| Servicios | Visita guiada 60min, Asesoría hipotecaria 45min, Avalúo 120min $200.000 COP | `vertical-definitions.ts:233-237` |
| Disponibilidad | Slots desde businessHours L-V 8-18, S 9-14 (post-`95f758f3`) | `:238-241` + `verticals.service.ts:56-58` |
| Tool flag | `tools.realEstate.enabled=true` en el agente default | `verticals.service.ts:94-97` |
| Terminología/KPIs | interesado/negociación/propiedad; KPIs Leads Hoy, Visitas Hoy, Leads Calientes, Mensajes | `vertical-definitions.ts:198-204, 250-257` |

### Conversación — tabla de tools

| Tool | Qué hace | Gating | ¿Funciona e2e? |
|---|---|---|---|
| `search_listings` | Filtra `real_estate_listings` por venta/arriendo, tipo, precio, habitaciones, barrio (ILIKE parcial), ciudad, m²; devuelve 8 con estrato incluido | `cfgTools.realEstate.enabled` (`conversations.service.ts:1872-1874`) | **Sí** (`ai-tool-executor.service.ts:1824-1858` → `listings.service.ts:163-231`; solo `status='available'`) |
| `get_listing_details` | Ficha completa: hoa_fee, deposit, min_rental_months, financing_available, amenities, external_url | ídem | **Sí** (`:1860-1894`) |
| `send_listing_image` | Manda la 1ª foto real de la DB (URL nunca del LLM) | ídem | **Sí** (`:487-500`) — 1 foto, no carrusel |
| `create_appointment` (visita) | Cita genérica servicio→fecha→hora | `tools.appointments` | **Sí, pero sin listingId** — schema sin campo de propiedad (`appointment-tools.ts:27-43`), INSERT sin `metadata` (`ai-tool-executor.service.ts:1260-1269`) aunque la columna existe (`tenant-schema.sql:1345`) |
| `check_availability` / cancel / reschedule / booking link | Suite genérica completa | ídem | Sí, con el modelo de conflicto de §4.2 |
| crm / knowledge (RAG) | Horizontales | plantilla listings los trae; la default ventas no trae crm | Sí |

### Agenda / conflicto de visitas — verificado

- `findAppointmentConflict` (`ai-tool-executor.service.ts:1177-1195`): con `assigned_to NULL` — lo que produce toda cita de chat, porque el LLM no pasa staffId y el booking engine lo descarta — **cualquier cita solapada bloquea**: capacidad global 1 por franja para toda la agencia. La ruta dashboard (`appointments.service.ts:624-641`) chequea por usuario asignado. Nada, en ninguna ruta, conoce la propiedad.
- Consecuencia direccional (confirmada por `eje-booking-capacidad.json`, hallazgo inmobiliaria): dos interesados en propiedades **distintas** a la misma hora se bloquean (falso negativo de capacidad), y dos visitas al **mismo** inmueble en horarios distintos con datos en notas libres no se relacionan jamás (el reporting propiedad→visitas es imposible como dato).
- Además, cuando el cliente dice "quiero agendar una visita", el motor determinístico intercepta ANTES del LLM y ofrece la lista de servicios genéricos, con historial recortado a 4 mensajes en modo directivo — el listing del que se venía hablando queda fuera del flujo (mecánica documentada en `eje-booking-capacidad.json` §1; gatillo `tools.appointments.enabled`).

### Inventario y dashboard del tenant

- `/admin/listings`: cards con filtro venta/arriendo, creación con property_kind/estrato, detalle editable con status available/reserved/sold/rented (`listings/page.tsx:42-73`, `[listingId]/page.tsx:131-137, 182-183`). Sidebar propio gateado a la vertical (`AppSidebar.tsx:126`), ProductTour apunta a listings (`ProductTour.tsx:25`), ToolsTour corregido a `/admin/listings` (`ToolsTour.tsx:54-59`, fix `b9bd6332`), saludo vertical presente (`es.json:6103`), home del panel en modo pipeline (`admin/page.tsx:86`).
- `assigned_agent_id` ("which user owns this listing", `tenant-schema.sql:1909` + índice :1917): la API lo escribe (`listings.service.ts:94,125-128`) pero **no hay UI que lo setee ni código que lo lea** — el modelo de ruteo natural del rubro (asesor dueño del listing) está en el schema y dormido.

### Pipeline y analytics

- La regla `appointment_required` de "Visita agendada" **SÍ funciona** en esta vertical (las visitas escriben en `appointments`, a diferencia de tours): el embudo avanza solo. Punto genuinamente bueno.
- Aggregator real en vertical-analytics (venta/arriendo, precios promedio, vendidas/arrendadas del mes — `vertical-analytics.service.ts:412-420, 594-599`), check de activación por listings cargados (:124), métrica primaria = listings activos (:637).

### Ruteo por zonas (el muerto célebre)

Cadena completa: tabla `listing_zone_agents` (`tenant-schema.sql:1922-1929`) + CRUD y `resolveAgentForZone` (`listings.service.ts:235-277`) + 3 endpoints REST (`listings.controller.ts:99-125`) + cliente dashboard (`api.ts:1724-1728`). **Consumidores: cero.** `resolveAgentForZone` aparece una sola vez en todo `apps/` (su definición). Ninguna página del dashboard llama getZones/setZone (grep "zone" en `admin/listings/`: 0 hits). La promesa del docblock ("the conversation gets assigned automatically", `listings.service.ts:9-11`) no ocurre.

### Integraciones

**Cero.** Ni FincaRaiz, ni Metrocuadrado, ni Inmuebles24, ni Ciencuadras — solo la columna `external_url` para linkear la publicación (`tenant-schema.sql:1907`) y el pendiente declarado en `vertical-strategy.md:340`.

## 3. La experiencia hoy, contada honestamente

**(a) El dueño en sus primeros 30 minutos.** De lo mejor del catálogo: sale del alta con saludo vertical, sidebar "Propiedades", tour que apunta bien, pipeline con nombres del rubro y un formulario de listing que habla su idioma (estrato 1-6, administración, codeudor, VIS). El agente ya tiene las 3 tools encendidas sin tocar nada. Dónde se cae: (1) tiene que **tipear su inventario propiedad por propiedad** — su portafolio ya vive en FincaRaiz/Metrocuadrado y acá no hay ni import CSV; con 40 propiedades, eso es la tarde entera y el punto exacto donde abandona (el check de activación de Ops lo va a ver como "sin listings"); (2) si tiene 4 asesores, no encuentra dónde decir quién atiende qué zona ni de quién es cada listing — porque no existe esa pantalla; (3) los 4 sub-tipos que eligió con cuidado en el alta no cambiaron nada.

**(b) El cliente final por WhatsApp en sus primeros 3 mensajes.** Mensaje 1: saludo correcto de Carlos ("¿comprar, arrendar o vender?"). Mensaje 2: "busco apartamento en Chapinero, 2 habitaciones, hasta 2 millones" → `search_listings` devuelve opciones REALES con precio/m²/estrato y puede mandar foto real. Esto es genuinamente mejor que el 90% de los bots inmobiliarios que respondían con texto enlatado — la promesa del "conversational property search engine" del research está medio cumplida (falta el carrusel; hoy es texto + 1 foto). Mensaje 3, donde miente: "quiero visitarla el sábado" → el motor de reservas secuestra el turno, ofrece "Visita guiada / Asesoría hipotecaria / Avalúo comercial" (¿cuál propiedad? el flujo ya no lo sabe), agenda "Visita guiada 10:00" sin propiedad ni asesor — y si otro interesado ya reservó CUALQUIER cosa a las 10:00, responde "no hay disponibilidad" con 5 asesores libres. El asesor recibe una cita que dice "Visita guiada — Juan Pérez" y tiene que leer la conversación entera para saber qué inmueble mostrar.

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esf. |
|---|---|---|---|---|---|
| 1 | La visita no queda ligada al listing: `create_appointment` sin `listingId`; el INSERT ni siquiera escribe la columna `metadata` que existe | **Alta** | `appointment-tools.ts:27-43`; `ai-tool-executor.service.ts:1260-1269`; `tenant-schema.sql:1345` | Ver diseño en §5.2 | S |
| 2 | Conflicto de visitas invertido: `assigned_to NULL` → capacidad 1 por franja para toda la agencia; nada bloquea ni relaciona por propiedad | **Alta** | `ai-tool-executor.service.ts:1177-1195` (chat); `appointments.service.ts:624-641` (dashboard) | Asignar la visita al asesor resuelto (#3/#4) — con `assigned_to` real el conflicto pasa a ser por-asesor, que es el modelo correcto; el bloqueo por propiedad+franja llega gratis tras #1 (query sobre `metadata->>'listingId'`) | S (sobre F2 staff transversal) |
| 3 | Ruteo por zonas completo y muerto: 0 llamadores de `resolveAgentForZone`, 0 UI de zonas | Media | `listings.service.ts:267-277` (único hit en apps/); `api.ts:1724-1728` sin consumidores | 1 call site (§5.3) + tab "Zonas" en /admin/listings | S |
| 4 | `assigned_agent_id` del listing (el modelo de ruteo que el rubro usa de verdad) sin UI ni lectores | Media | `tenant-schema.sql:1909`; escritura API `listings.service.ts:125-128`; 0 lecturas en runtime | Selector de asesor en el detalle del listing + usarlo como primera fuente del ruteo (§5.3) | S |
| 5 | El default del alta es `tpl_inmobiliaria_ventas`, no la plantilla estrella: la persona activa jamás menciona `search_listings` aunque la tool esté encendida | Media | `persona.service.ts:2694-2697` (template[0]); `bySubType` sin inmobiliaria (:2702-2713); rules de ventas :1496-1500 | Mapear los 4 sub-tipos → `tpl_inmobiliaria_listings` en `bySubType` (o mover listings a [0]) | XS |
| 6 | El motor de reservas secuestra el turno de la visita y pierde el listing (historial 4 msgs en modo directivo) | Media | Mecánica en `eje-booking-capacidad.json` §1 (gatillo `tools.appointments.enabled`; hijack documentado); `booking-engine.service.ts:873` crea sin contexto | Memoria `metadata.lastListingId` en la conversación al llamar `get_listing_details`/`send_listing_image`; ambas rutas de creación la leen | S |
| 7 | Sub-tipos 100% cosméticos: arriendo (flujo documental distinto: codeudor, extractos, estudio) y construccion (venta sobre planos: separación/promesa) reciben lo mismo que venta | Media | `verticals.service.ts:94-97` incondicional; `onboarding/page.tsx:112-117` | §5.4 | S-M |
| 8 | labelOverride `catalog→'Propiedades'` muerto: el ítem real es `listings` | Baja | `vertical-definitions.ts:246` vs `AppSidebar.tsx:126` | Borrar el override (el ítem listings ya se llama bien) | XS |
| 9 | `setZoneAgent` con `city` NULL duplica mapeos en silencio: el índice único trata NULLs como distintos y el ON CONFLICT nunca dispara | Baja (trampa al construir la UI de #3) | `listings.service.ts:248-253`; `tenant-schema.sql:1929` (sin NULLS NOT DISTINCT) | `COALESCE(city,'')` en el índice o NULLS NOT DISTINCT | XS |
| 10 | La plantilla de automatización "Nuevas propiedades disponibles" no hace lo que su nombre promete: dispara por `stage_changed=calificado`, no por matching de propiedades nuevas | Baja | `seed-templates.ts:289-309` | Renombrar honesto o construir el matching (§5, diferenciador) | XS / M |
| 11 | `send_listing_image` manda 1 foto; el research pidió carrusel de listings en WhatsApp | Baja | `ai-tool-executor.service.ts:487-500`; `market-research-latam.md:495` | Carrusel/multi-imagen en el adapter WA | M |
| 12 | `slaHours` inexistente en el registry (0 hits) pese a que la auditoría lo marcó "TERMINAR" con inmobiliaria entre las beneficiarias | Baja (transversal) | grep slaHours en `vertical-definitions.ts`: 0 | Sembrar (ej. consulta: 24h, calificado: 48h) | XS |

## 5. Lo que esta industria necesita y no tenemos

### Mesa de entrada (sin esto no somos creíbles en el rubro)

**5.1 Import de inventario — la dirección correcta con los portales es IMPORTAR, no publicar.** La pregunta del rubro tiene respuesta en nuestros propios docs: el análisis competitivo manda "integrar, no profundizar" y advierte que replicar el system-of-record es "trampa de recursos" (`competitive-analysis-2026-q2.md:402-404`); el research define la feature como "surfacear listings en WhatsApp" — el catálogo conversacional — no como syndication (`market-research-latam.md:495`). La agencia YA mantiene su inventario en FincaRaiz/Metrocuadrado/Inmuebles24 (`vertical-strategy.md:56`); pedirle que lo re-tipee es el killer de activación (§3a). Publicar HACIA portales nos convertiría en el CRM inmobiliario de syndication — otra industria de software. Fases: CSV/XLSX (días) → feed XML/URL de la publicación con parse asistido (semanas). `external_url` ya existe para el link inverso.

**5.2 Visita ligada a la propiedad — diseño concreto del fix.** (a) `listingId` opcional en el schema de `create_appointment` con description "when booking a property viewing, pass the listingId from search_listings" (`appointment-tools.ts:29-42` — parámetro opcional, inofensivo para las otras 17 verticales); (b) en `createAppointment` (`ai-tool-executor.service.ts:1214+`): validar vía `listingsService.getById`, escribir `metadata` en el INSERT (`{listingId, listingName, neighborhood}` — hoy el INSERT omite la columna), enriquecer `service_name`/notas y la descripción del evento de calendario ("Propiedad: Torre X apto 502 — Chapinero"); (c) resolver `assigned_to` = `listing.assigned_agent_id` ?? `resolveAgentForZone(neighborhood, city)` ?? null — un solo cambio arregla a la vez el hueco #1, el #2 (el conflicto pasa a ser por-asesor) y da el call site que le falta al ruteo (#3); (d) fallback de contexto: guardar `lastListingId` en metadata de la conversación al llamar `get_listing_details`, y que tanto el executor como el booking engine (`booking-engine.service.ts:873`) lo lean al crear; (e) dashboard: mostrar la propiedad en la lista de citas (lee `metadata`). Total S-M, cero migraciones (columnas ya existen).

**5.3 Ruteo al asesor — terminar SÍ, pero con la clave correcta.** ¿Juguete o diferenciador? Ninguno: es **mesa de entrada pedida por nuestro propio research** — la feature #2 de 3 para el nicho es literalmente "route to the specific agent who handles that zone/property" (`market-research-latam.md:497`). Pero el orden de resolución importa: las agencias rutean primero por **dueño del listing** (captador/colocador — nuestro `assigned_agent_id`, ya en schema) y por zona como especialización/fallback. El backend de zonas ya está; falta: selector de asesor en el listing (UI, S), tab de zonas en /admin/listings (los métodos de `api.ts:1724-1728` esperan hace meses, S), y el call site único — dentro de `createAppointment` (§5.2c) y/o en `tryAutoAssign` del handoff, que ya rutea por skills. Sin la UI, terminar solo `resolveAgentForZone` sería cablear una tabla que ningún tenant puede llenar.

**5.4 Sub-tipos que hagan algo.** El diferencial real es **arriendo vs venta**, y es documental: arriendo = codeudor, extractos, estudio de arrendamiento, tiempos de aprobación (nuestras FAQs semilla YA lo saben — `verticals.service.ts:862-874` — pero se siembran igual para todos). Mínimo viable por sub-tipo, todo en la rama del bootstrap: arriendo → FAQs de requisitos/estudio + regla de persona "este negocio se dedica principalmente al arriendo" + default `transactionType='rent'` sugerido en la tool; construccion → etapa "Separación" en el pipeline (venta sobre planos) + FAQ de fiducia; comercial → sin cambios v1. Además pasar `subType` al `<vertical_context>` del prompt L3 (el canal ya existe post-`5c2581db`).

### Diferenciador (si se decide ganar el rubro)

- **Secuencia post-visita** — el research la declara sin competidor: *"No competitor offers a WhatsApp-native post-visit nurture sequence"* (`market-research-latam.md:499`). Requiere un trigger `appointment.completed` que hoy no existe (triggers reales: lead.captured, inactivity, stage_changed, new_message, sla_timeout — `seed-templates.ts`) conectado al cron de auto-complete que ya marca citas completadas. Con el linkage de §5.2, el paso "día 3: propiedades similares" se vuelve posible de verdad.
- **Matching de propiedades nuevas → interesados calificados** (hacer honesto el template #10): al crear un listing, buscar leads con custom attributes de zona/presupuesto compatibles y disparar la plantilla. Los custom attributes ya existen; falta el listener.
- **Pre-calificación estructurada**: `qualify_lead(budget, timeline, financing)` está en la spec de la vertical (`vertical-strategy.md:50`) y nunca se construyó — hoy la calificación vive en prosa de las rules. Persistir presupuesto/zona/financiación como custom attributes desde la conversación alimenta el matching y el scoring.
- **Carrusel de listings en WhatsApp** (#11) — el "search engine conversacional" completo del research :495.
- **Reporting propiedad→visitas→negocio** — imposible hoy sin #1; trivial después (GROUP BY `metadata->>'listingId'`).

## 6. Competencia del rubro

Nuestros docs no registran **ningún SaaS conversacional específico de inmobiliarias** en LatAm — el rubro se disputa entre los horizontales del cluster D, y eso es una oportunidad de posicionamiento:

- **Cliengo** (Argentina): "el perfil de cliente más parecido a Parallly", >13.000 negocios; su joya es exactamente el terreno de este vertical: *"captura+calificación+ruteo de leads desde el widget web"* (`competitive-analysis-2026-q2.md:370`). Es el nombre a ganar en inmobiliarias chicas de AR/CO.
- **Treble.ai** (Colombia, $15M): atribución Click-to-WhatsApp ads (`:363`) — el embudo típico del rubro es Facebook/IG ads → WhatsApp (`market-research-latam.md:483,486`); nuestra atribución CTWA (T3.22) ya compite ahí.
- **Leadsales/Kommo/Whaticket**: inbox+pipeline genérico sin catálogo de propiedades ni tools de inventario — ninguno muestra listings reales en la conversación (nuestra ventaja code-grounded: dimensión "Adaptación Vertical 8/10… ninguno comparable", `competitive-analysis-2026-q2.md:124`).
- El caso de negocio del research (`market-research-latam.md:481-501`): 50 leads/día por WhatsApp, 90% price-shoppers, pre-calificación IA convierte 7× vs email (RhinoAgents, `:111,590`); WTP alta — un cierre extra/año paga 5 años de Pro (`:483`). Colombia (Medellín/Bogotá) como cabeza de playa: *"agents manage 100% of leads via WhatsApp"* (`:242`).

**Quién gana hoy:** nadie con producto vertical; ganan los horizontales por distribución. Con visita-ligada + ruteo + import, seríamos el único player LatAm cuyo bot muestra inventario real, califica y agenda la visita con el asesor correcto — la definición literal de las 3 features que el research pidió (`:495-499`), de las que hoy tenemos 1,5.

## 7. Plan de inversión de ESTA vertical

### Quick wins (días)

| # | Qué | Dónde | Esf. |
|---|---|---|---|
| 1 | `bySubType`: los 4 sub-tipos inmobiliaria → `tpl_inmobiliaria_listings` | `persona.service.ts:2702-2713` | XS |
| 2 | `listingId` opcional en `create_appointment` + escribir `metadata` en el INSERT + calendario enriquecido | `appointment-tools.ts:29-42`, `ai-tool-executor.service.ts:1260-1269` | S |
| 3 | `lastListingId` en metadata de conversación (set en `get_listing_details`) como fallback de ambas rutas de creación | `ai-tool-executor.service.ts:1860+`, `booking-engine.service.ts:873` | S |
| 4 | Selector de asesor (`assigned_agent_id`) en el detalle del listing | `[listingId]/page.tsx` (+4 JSON i18n) | S |
| 5 | Borrar labelOverride `catalog` muerto; fix NULLs del índice de zonas | `vertical-definitions.ts:246`, `tenant-schema.sql:1929` | XS |
| 6 | Renombrar honesto el template "Nuevas propiedades disponibles" | `seed-templates.ts:291-296` | XS |

### Mediano (semanas)

| # | Qué | Dónde | Esf. |
|---|---|---|---|
| 7 | Ruteo completo: tab Zonas en /admin/listings (endpoints ya en `api.ts:1724-1728`) + resolución owner→zona→null en `createAppointment` y `tryAutoAssign` | listings UI, `ai-tool-executor`, handoff | S-M |
| 8 | Visitas con `assigned_to` real → conflicto por asesor (coordina con F2 staffId del plan transversal, que esta vertical necesita tanto como salud) | `ai-tool-executor.service.ts:1177-1195` | S (sobre F2) |
| 9 | Import CSV/XLSX de listings + mapeo de columnas | listings module + página | M |
| 10 | Bootstrap por sub-tipo: FAQs/regla arriendo, etapa Separación construccion, `subType` al prompt L3 | `verticals.service.ts:94-97`, prompt-assembler | S-M |
| 11 | Bloqueo/aviso por propiedad+franja (query sobre `metadata->>'listingId'`) | `createAppointment` | S |

### Apuesta (si se decide ganar el rubro)

- **Feed de portales** (XML/URL de FincaRaiz/Metrocuadrado/Inmuebles24) con re-sync — la activación pasa de tarde-entera a minutos. (M-L; validar formatos reales antes, ver §8.)
- **Trigger `appointment.completed` + secuencia post-visita semilla** (día 1/3/7/14 del research :499) — sin competidor documentado. (M)
- **Matching listing-nuevo → leads calificados** + `qualify_lead` estructurado persistiendo custom attributes. (M)
- **Carrusel WhatsApp de listings.** (M)
- Coherencia con §1: la apuesta NO incluye publicar hacia portales ni construir un CRM inmobiliario de syndication.

## 8. Qué no se verificó

- **Nada se ejecutó contra base real**: ni un alta inmobiliaria, ni una conversación con search_listings, ni una visita agendada. La semántica de `findAppointmentConflict` con `assignedTo NULL` se razonó del SQL (mismo caveat que declaró `eje-booking-capacidad.json`).
- La mecánica del hijack del booking engine (regex de intención, historial 4 mensajes) se cita del eje booking, que la leyó — yo verifiqué el gatillo (`tools.appointments.enabled` en las plantillas) y el create sin contexto (`booking-engine.service.ts:873` vía grep), no las líneas del intent-interpreter.
- **Formatos de import/feed de los portales** (FincaRaiz/Metrocuadrado/Inmuebles24/Ciencuadras): nuestros docs solo los nombran como pendiente; no hay información interna sobre sus APIs/feeds — la fase "feed de portales" necesita un spike de validación previo. Tampoco hay en nuestros docs nada sobre los CRMs inmobiliarios LatAm (Wasi, Tokko Broker) contra los que el import competiría/conviviría — hueco de research de mercado, no afirmo nada sobre ellos.
- No verifiqué el comportamiento de `localizeVerticalTemplates` para tenants en pt/fr/en sobre las 3 plantillas inmobiliaria (el colapso a 1 plantilla en lang≠es está reportado por cluster-activos para turismo; presumo que aplica igual acá, no lo leí).
- No hay datos de producción: cuántos tenants inmobiliaria existen, cuántos listings cargan antes de abandonar, ni cuántas visitas se agendan por chat — los tres números que dimensionarían el ROI real de §7.
