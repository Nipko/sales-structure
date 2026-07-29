# Madurez vertical — auditoría exhaustiva (Jul 2026)

> **Método:** 8 mapeos (4 clústeres de verticales + 4 ejes transversales: booking/capacidad, mercado, UX del dashboard, arqueología de lo a medio construir), todos contra la misma rúbrica de 12 ejes puntuados 0-3. Los datos crudos con archivo:línea están en `docs/vertical-audit-workdir/`.
> **Advertencias de honestidad:** (1) **ningún hallazgo pasó ronda de refutación adversarial** — se sacrificó por límites de sesión; lo anclado con archivo:línea fue leído, pero nadie buscó activamente los mitigantes. (2) **Nada se ejecutó contra base real.** (3) `cluster-agenda.json` fue elaborado por el orquestador con menor profundidad declarada en pipeline y docs_estrategia (ver su campo `_provenance`).
> **Contexto:** el commit `95f758f3` (2026-07-27) ya arregló el bootstrap vertical (shape de persona, merge de tools, siembra de slots, FAQs encendidas, localización pt/fr/en, índices únicos). Esta auditoría describe el estado POST-arreglo.

---

## 1. Veredicto ejecutivo

De las 18 verticales (17 industrias + `otro`), **1 es profunda** (turismo), **9 son medias**, **8 son superficiales** y ninguna es estrictamente nominal — aunque finanzas y technology (12/36) rozan la línea. El promedio del catálogo es 18,4/36: la plataforma vertical está **a mitad de camino de su propia promesa**.

El patrón que explica casi todo: **la profundidad se invirtió donde había código interesante que escribir, no donde nuestros propios documentos dicen que está la demanda**. El market research (abr 2026) ordena la demanda LatAm: belleza/estética (88), dental (87), especialistas de salud (86), inmobiliaria (84), gimnasios (78) — y manda a diferir hospitality (*"Pursue later… Do not make hospitality the primary launch vertical"*, `market-research-latam.md:1014`). Sin embargo, la vertical más rica de la plataforma es turismo/alquiler vacacional (tours con cupos, vacation-rental multi-noche con iCal, Hostaway con sync real), mientras que **moda_belleza — el nicho #1 — no tiene ni una sola herramienta IA dedicada** y su caso típico (salón multi-silla) ni siquiera funciona con el motor de reservas actual.

El segundo patrón: **hay más valor construido y dormido que valor faltante**. Automotriz tiene un módulo de inventario completo (tablas, CRUD, test drives con detección de conflictos, herramientas IA escritas) que nadie puede usar porque `tools.vehicles` no se enciende en ningún bootstrap y no existe página para cargar autos. Education tiene módulo, 6 herramientas y página propia, pero su tabla colisiona con una tabla legacy y crear un curso falla. El trigger de `inactivity` — la base del pitch de recall dental y reactivación de gimnasios — se siembra en plantillas que ningún listener evalúa. Encender lo que ya existe cuesta una fracción de lo que costó construirlo.

**Las 3 decisiones que este documento le pide al dueño:**

1. **¿Realinear o monetizar el costo hundido?** El trimestre que viene puede ir a belleza/dental/estética (donde el research dice que está la plata y hoy no tenemos casi nada) o a monetizar turismo/VR ya construido vía un GTM barato (marketplace de Hostaway + case study, como sugiere el propio research). Son estrategias distintas; hoy no hay ninguna elegida y la inversión ocurre por inercia.
2. **¿Se aprueba el modelo de capacidad en reservas?** Sin `max_concurrent` en la ruta de chat (fase 1, S) y sin usar el `staffId` que las herramientas ya devuelven (fase 2, M), belleza multi-silla, restaurantes y clínicas multi-profesional no funcionan de verdad — y son 3 de los 5 nichos top. Es la única inversión de arquitectura que este informe pide.
3. **¿Se enciende lo dormido antes de construir nada nuevo?** Automotriz (1 línea + una página), education (5 ALTERs), alquiler_vacacional en el alta, `tools.properties` para hotelería, el trigger de inactividad. Es el mejor ratio impacto/esfuerzo de todo el documento.

---

## 2. La matriz de madurez

Ejes: **per**sona · **tool**s IA · **faq**s · **book**ing fit · **pipe**line · **term**inología/KPIs · **mod**ulos · **int**egraciones · **proc**edures · **onb**oarding · **sub**tipos · **doc**s/estrategia. Valores 0-3.

| Vertical | per | tool | faq | book | pipe | term | mod | int | proc | onb | sub | doc | **TOT** | Nivel |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| turismo | 2 | 3 | 3 | 3 | 2 | 2 | 3 | 2 | 1 | 2 | 2 | 3 | **28** | profunda |
| salud | 3 | 2 | 2 | 2 | 2 | 3 | 1 | 2 | 0 | 3 | 2 | 2 | **24** | media |
| inmobiliaria | 3 | 3 | 3 | 2 | 3 | 2 | 2 | 0 | 1 | 2 | 1 | 2 | **24** | media |
| restaurantes | 2 | 3 | 2 | 1 | 2 | 2 | 3 | 1 | 1 | 2 | 1 | 2 | **22** | media |
| servicios_hogar | 2 | 2 | 2 | 2 | 3 | 2 | 2 | 0 | 1 | 2 | 1 | 1 | **20** | media |
| veterinaria | 3 | 2 | 2 | 2 | 2 | 3 | 1 | 0 | 0 | 3 | 1 | 1 | **20** | media |
| gimnasios | 2 | 2 | 2 | 1 | 2 | 2 | 1 | 2 | 0 | 3 | 1 | 1 | **19** | media |
| automotriz | 2 | 1 | 2 | 2 | 3 | 2 | 1 | 0 | 1 | 2 | 1 | 2 | **19** | superficial* |
| education | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 0 | 1 | 2 | 1 | 1 | **18** | media* |
| seguros | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 0 | 1 | 2 | 1 | 1 | **18** | media |
| retail | 2 | 3 | 1 | 0† | 2 | 1 | 2 | 2 | 1 | 2 | 1 | 1 | **18** | superficial |
| pet_services | 2 | 1 | 2 | 1 | 2 | 2 | 2 | 0 | 1 | 2 | 1 | 1 | **17** | media |
| moda_belleza | 2 | 1 | 2 | 1 | 2 | 2 | 0 | 0 | 0 | 3 | 1 | 1 | **15** | superficial |
| fotografia | 2 | 2 | 1 | 2 | 2 | 2 | 0 | 0 | 0 | 2 | 1 | 1 | **15** | superficial |
| otro | 2 | 1 | 2 | 1 | 2 | 2 | 1 | 1 | 1 | 1 | 0 | 1 | **15** | superficial |
| servicios_profesionales | 2 | 0 | 1 | 2 | 2 | 2 | 0 | 0 | 1 | 2 | 1 | 1 | **14** | superficial |
| finanzas | 2 | 0 | 1 | 1 | 2 | 2 | 0 | 0 | 1 | 2 | 1 | 0 | **12** | superficial |
| technology | 2 | 0 | 1 | 2 | 2 | 1 | 0 | 0 | 1 | 2 | 1 | 0 | **12** | superficial |

\* Automotriz puntúa 19 pero se clasifica superficial porque su núcleo (inventario) es inalcanzable para el tenant; education puntúa 18 y es "media rota": el módulo existe pero la tabla colisionada impide usarlo. † El 0 de retail en booking es N/A por diseño (no agenda), no defecto.

**Lecturas que saltan a la vista:** la columna `proc` es casi toda ceros — el motor de SOPs (T2.12) existe y ninguna vertical tiene plantillas. La columna `int` muestra que solo 4 verticales tienen integración alguna, y las 3 de T3.19 (Toast/Mindbody/Cliniko) nunca se probaron en vivo. La columna `sub` es casi toda 1: los 74 sub-tipos del alta son cosméticos salvo dental, tours e inmobiliaria. Y las cuatro últimas filas (14 puntos o menos) son verticales que existen en el selector del alta pero apenas se distinguen de `otro`.

---

## 3. Los cuatro niveles

**Profunda (1): turismo.** Dos silos de inventario reales (tours con cupos por salida que se decrementan/restauran; vacation-rental con iCal bidireccional y Hostaway), 6 herramientas con partySize, página propia. Es la prueba de que la plataforma SABE hacer verticales profundas — el problema es que la hizo donde el research dijo "después". Inversión tipo: pulir junturas (subtipo hotel recibe FAQs de agencia; `tools.properties` nunca se auto-enciende; alquiler_vacacional ausente del alta) y decidir el GTM.

**Media (9): salud, inmobiliaria, restaurantes, servicios_hogar, veterinaria, gimnasios, education, seguros, pet_services.** Comparten el patrón "cara buena, motor a medias": persona y contenido dignos, alguna pieza real (módulo, tools), y un hueco estructural que rompe el caso de uso central — multi-profesional (salud), capacidad de mesas (restaurantes), cupos de clase (gimnasios), tabla colisionada (education), catálogo vacío el día 1 (seguros), estadía multi-día imposible (pet hotel). Inversión tipo: cerrar EL hueco #1 de cada una, no agregar features.

**Superficial (8): automotriz, retail, moda_belleza, fotografia, otro, servicios_profesionales, finanzas, technology.** Dos sub-grupos muy distintos: (a) **dormidas** — automotriz tiene el motor construido y apagado; retail vive del núcleo horizontal que sí funciona pero sin FAQs/KPIs propios; (b) **de plantilla** — moda_belleza, fotografia, finanzas, servicios_profesionales y technology son persona + pipeline + terminología y nada más. Inversión tipo: (a) encender; (b) decidir cuáles merecen músculo (belleza SÍ, por demanda #1) y cuáles se quedan honestamente genéricas.

**Nominal (0 formales).** Pero finanzas y technology (12/36) no aparecen siquiera en `vertical-strategy.md`: tienen código sin estrategia. O se les escribe una, o se asume en voz alta que son variantes decoradas de `otro`.

---

## 4. Ficha por vertical

**turismo (28, profunda).** Tiene: tours con cupos/salidas/descuento-niño (`tours.service.ts:191-295`), VR multi-noche + Hostaway, 6 tools con partySize. Hueco #1: el alta ignora el subtipo — hotel recibe servicios de tours como agendables y `tools.properties` jamás se enciende solo. Confuso: `createDefaultAgentFromGoals` elige `tpl_turismo_ventas` aunque el subtipo sea tours. QW: agregar alquiler_vacacional a SUB_TYPES; encender properties para hotel/VR; elegir plantilla por subtipo.

**salud (24, media).** Tiene: la agenda vertical más completa, Cliniko read-only real con test de conexión, extras dentales que cambian contenido de verdad. Hueco #1: multi-profesional roto por chat (el motor descarta el staffId; capacidad global 1). Confuso: staff-scheduling existe como módulo huérfano con SQL roto — parece que multi-staff funciona y no. QW: conectar el staffId que la tool ya devuelve; cron de re-sync Cliniko.

**inmobiliaria (24, media).** Tiene: inventario real con campos LatAm (estrato, VIS, codeudor — `listings.service.ts:163-231`), 3 tools encendidas por bootstrap, las mejores FAQs del clúster. Hueco #1: cero integraciones con portales (FincaRaiz/Metrocuadrado); el ruteo por zonas está completo en backend y muerto (0 llamadores). Confuso: labelOverride `catalog→'Propiedades'` apunta a un ítem que no existe; el ítem real es `listings`. QW: cablear `resolveAgentForZone` (falta 1 call site); ligar la visita al listing.

**restaurantes (22, media).** Tiene: dominio menú/pedidos completo y bien diseñado (alérgenos, modifiers, snapshots de precio, pipeline de cocina — `restaurants.service.ts:1-437`), 6 tools auto-encendidas. Hueco #1: reservar mesa = fecha+hora+PERSONAS y el motor no tiene partySize (0 hits en booking-engine); con slots a un solo usuario, UNA reserva concurrente por franja para todo el restaurante. Confuso: `tpl_restaurante_delivery` tiene `tools: {}` — la plantilla de delivery no puede llamar `place_order`. QW: 1 línea de tools a esa plantilla; dark_kitchen sin servicios de mesa.

**servicios_hogar (20, media).** Tiene: `service_requests` con urgencia y despacho, 3 tools reales, board propio, agregador en vertical-analytics. Hueco #1: nadie escucha `service_request.created` — una fuga de gas crea el request y ningún humano recibe notificación (`ai-tool-executor.service.ts:2541` emite; 0 listeners). Confuso: el KPI "Emergencias" muestra leads calientes (mapea a `leadsHot`). QW: listener de emergencia → inbox/email (patrón `handoff.escalated` ya existe).

**veterinaria (20, media).** Tiene: persona fuerte con triage, `register_pet` real, registro por contacto, objetivos de alta específicos. Hueco #1: los recordatorios de vacunación que la persona promete no tienen ningún mecanismo detrás. Confuso: "Peluquería canina" es sub-tipo de veterinaria Y de pet_services con label idéntico — elegir cambia materialmente el agente sin ninguna guía. QW: cupo de guardería configurable; automation semilla de recordatorio de vacunas.

**gimnasios (19, media).** Tiene: las tools de membresía mejor cableadas de la plataforma (`get_my_membership` con lógica real y upsell — `ai-tool-executor.service.ts:2234-2261`), Mindbody read-only. Hueco #1: la reserva de CLASE con cupo no existe — el flujo central del negocio muere en el momento de conversión. Confuso: la IA "sabe" las clases de Mindbody pero no puede inscribir a nadie. QW: filtrar clases pasadas + `synced_at` fresco; handoff con contexto ("quiere yoga del martes").

**automotriz (19, superficial-dormida).** Tiene: backend completo (vehicles/test_drives/markSold con conflictos por vehículo) y VEHICLE_TOOLS bien escritas. Hueco #1: `tools.vehicles` no se enciende NUNCA (el bootstrap no tiene rama automotriz) y no existe página ni sidebar para cargar inventario — el alta promete "mostrar inventario" y el agente no puede. Confuso: `searchVehiclesForAI` compara presupuesto sin convertir a centavos (código hoy muerto, trampa futura). QW: `enableSimpleTool('vehicles')` es 1 línea; la página /admin/vehicles usa un REST que ya existe.

**education (18, media-rota).** Tiene: módulo real (cohortes con asiento atómico), 6 tools, página propia. Hueco #1: la tabla `courses` de education colisiona con la `courses` legacy del catálogo (`tenant-schema.sql:312` gana sobre `:2198` por IF NOT EXISTS) — crear curso falla y `get_course_schedule` revienta; solo 2 de 7 columnas se parcharon. Confuso: DOS páginas de cursos con modelos distintos escribiendo en la misma tabla. QW: completar los 5 ALTER TABLE que faltan (el patrón ya está en `:2218-2219`).

**seguros (18, media).** Tiene: el único stack del clúster servicios que funciona entero (planes/cotizaciones/pólizas/reclamos con interpolación por edad). Hueco #1: nace con catálogo vacío — `calculate_quote` no tiene qué cotizar el día 1; y la etapa "Cotizado" está bloqueada por una regla `offer_required` que consulta un concepto legacy imposible de satisfacer. Riesgo: `check_policy_status`/`file_claim` responden con solo el número de póliza, sin la verificación de identidad que sus propias plantillas exigen. QW: quitar `offer_required`; sembrar 2-3 planes ejemplo.

**retail (18, superficial-por-diseño).** Tiene: el núcleo horizontal bien cableado (search_products/check_stock/send_product_image contra `products`; Shopify/Woo). Hueco #1: FAQs genéricas (recibe "¿política de devolución?" del fallback en vez de talles/envíos/seguimiento) y cero KPIs de pedidos. Confuso: `tpl_retail_postventa` inventa "plazo 30 días" para devoluciones — la clase de política no confirmada que `95f758f3` limpió de las FAQs sobrevive en la plantilla. QW: 5 FAQs retail reales; KPIs de pedidos; transition_rule `order_required`.

**pet_services (17, media).** Tiene: registry completo, plantillas bien escritas, y arranca con el agendador funcionando. Hueco #1: el servicio estrella sembrado "Hotel — noche" (1440 min) es matemáticamente imposible de agendar (no cabe en la ventana diaria de 600 min) → bucle eterno de "sugerí otra fecha" que NO escala porque sí hay slots. Confuso: frontera rota con veterinaria (mismo sub-tipo duplicado). QW: hotel como servicio no-agendable-por-slots; etapa terminal "Cancelado"; mapear sub-tipo tienda → `tpl_pet_tienda`.

**moda_belleza (15, superficial).** Tiene: el alta correcto y el caso una-manicurista-sola funciona post-`95f758f3`. Hueco #1: es el nicho **#1 en demanda de LatAm (88 pts)** y no tiene ni una herramienta IA dedicada, ni extras, ni las 3 features de lock-in que el research especificó (rebooking, galería antes/después, IG Stories); el salón multi-silla recibe "no hay disponibilidad" con 4 estilistas libres. Confuso: el nombre mezcla moda (retail) con belleza (agenda) — dos negocios opuestos compartiendo vertical. QW: `services.max_concurrent` ya existe y la ruta pública lo respeta — cablearlo al chat.

**fotografia (15, superficial).** Tiene: `check_date_availability` por DÍA real (modelo correcto para sesiones) y `list_photo_packages`. Hueco #1: el umbral "<5 citas/día" es fijo — un fotógrafo de bodas hace 1 evento/día; y no hay señas/anticipos, que es de lo que vive el rubro. QW: umbral configurable (sirve también a veterinaria); 3-4 FAQs propias con el patrón seedToursExtras.

**otro (15, superficial).** Tiene: un fallback digno — pipeline con reglas, FAQs honestas, terminología neutra. Hueco #1: lo que el usuario escribe en "otro: …" de objetivos/audiencia es **write-only** — se guarda en `settings.chatReasons/customerTypes` y ningún código lo lee jamás; el tenant que más necesita describir su negocio le habla a la nada. Confuso: doble slug `other`/`otro` según el flujo. QW: inyectar esos campos al bloque de negocio del prompt L3 — el dato ya está guardado.

**servicios_profesionales (14, superficial).** Tiene: persona correcta para regulados, pipeline plausible, booking de consultas funcional. Hueco #1: las tools que `vertical-strategy.md:158-166` propone (qualify_case, request_documents) nunca se construyeron; FAQs de "política de devolución" en un despacho jurídico. QW: FAQs por sub-tipo dominante; servicios sembrados por sub-tipo (contador ≠ abogado).

**finanzas (12, superficial).** Tiene: overrides prudentes para regulado, pipeline de crédito bien pensado. Hueco #1: la agenda sembrada está muerta — el alta promete "Agendar asesorías", el bootstrap siembra servicio+slots, pero `tpl_finanzas_calificador` no trae appointments y nada lo enciende. Confuso: el sub-tipo "seguros" dentro de finanzas duplica la vertical seguros sin rutear a ella (el broker se queda sin las 6 tools de insurance). QW: 1 línea de tools.appointments en la plantilla.

**technology (12, superficial).** Tiene: el mejor pipeline B2B del catálogo y plantillas SDR notables (BANT). Hueco #1: cero tools, KPIs genéricos, sidebar 100% genérico (labelOverrides vacío). Confuso: triggers de handoff "presupuesto >$50M" evaluados por substring contra el texto del cliente — jamás disparan. QW: reescribir triggers como keywords reales (RFP, licitación, SOC2); labelOverrides mínimos.

---

## 5. Los huecos estructurales (transversales)

**1. El motor de reservas es mono-recurso y eso rompe 3 de los 5 nichos top.** Servicio→fecha→hora contra slots de UN usuario, capacidad efectiva 1 por negocio vía chat; el `staffId` que `checkAvailability` ya devuelve se descarta al crear la cita, y `services.max_concurrent` existe, es editable y la ruta pública lo respeta — solo la ruta de chat lo ignora (eje booking). Además el chat ignora `blocked_dates`. Arquitectura mínima en dos fases: (F1, S) honrar `max_concurrent` en la ruta de chat; (F2, M) persistir el staffId devuelto. Sin tocar el motor, restaurantes puede simular mesas con eso.

**2. Integraciones a medio vivir que erosionan confianza.** Toast/Mindbody/Cliniko: adapters reales con auth y test de conexión, pero sync solo manual, ventana de 14 días en Mindbody y `getScheduleForAI` sin filtrar clases pasadas ni mirar `synced_at` — a la semana la IA ofrece horarios muertos (`vertical-integrations.service.ts:271-277, :362-372`). Y `vertical-strategy.md:338` las declara "✅ implementadas" cuando nunca se probaron con credenciales reales. Mínimo: filtro de frescura (XS) + cron de re-sync (S) + una prueba en vivo por adapter antes de venderlas.

**3. Features de plan vendidas sin pantalla.** `staffScheduling`, `vehicleInventory` y `channelManager` aparecen en el pricing del landing y en los feature-flags de planes, y ninguna tiene página en el dashboard (eje medio-construido, severidad alta). Un tenant que pague por eso no puede usarlo. O se construye la pantalla o se retira del pricing — dejarlo es la peor opción.

**4. La cosmética quedó una generación atrás de la estructura.** Las 6 verticales nuevas (veterinaria, gimnasios, seguros, servicios_hogar, pet_services, fotografia) tienen páginas dedicadas pero les falta la capa cosmética — y el saludo del panel les muestra la clave i18n cruda (`verticalWelcome.gimnasios`) por falta de guard en `admin/page.tsx:362`. Las 11 originales tienen la cosmética y menos estructura. El ToolsTour del asistente manda a inmobiliaria a la página de turismo y a automotriz/retail a páginas sin sidebar (`ToolsTour.tsx:54-57`).

**5. Los sub-tipos son un contrato roto en tres puntos.** (a) 74 sub-tipos en el alta y solo dental/tours/inmobiliaria cambian algo real; (b) las listas del alta están hardcodeadas y drifteadas del registry (falta alquiler_vacacional, sobra multiservicio, pet_services renombra claves) mientras `GET /verticals/definitions/all` — creado exactamente para esto — no tiene consumidores; (c) la clínica de estética, el comprador #1 según el research, cae en el hueco entre salud y moda_belleza: ningún sub-tipo la activa.

**6. Reglas de pipeline incompatibles con las verticales que las usan.** `offer_required` consulta `commercial_offers×course_id` (legacy) — imposible de satisfacer para seguros; las reservas de tours escriben en `tour_bookings`, no en `appointments`, así que no satisfacen `appointment_required`. Las verticales profundas rompen las reglas que las medianas cumplen.

**7. Señales emitidas al vacío.** `service_request.created` sin listeners (emergencias de hogar); `shouldHandoff:true` que ninguna capa consume; triggers de handoff condicionales ("presupuesto >$50M") evaluados por substring que jamás matchean; el trigger `inactivity` sembrado en plantillas que ningún cron evalúa — y es la base del pitch de recall dental/gym.

---

## 6. Lo pensado y no pulido — terminar o matar

| Ítem | Veredicto | Qué falta / qué borrar |
|---|---|---|
| **Inventario de vehículos (automotriz)** | **TERMINAR** | 1 línea en bootstrap + página /admin/vehicles sobre el REST existente + ítem sidebar. Es la vertical entera |
| **Tabla courses de education** | **TERMINAR** | 5 `ALTER TABLE ADD COLUMN IF NOT EXISTS` (el patrón ya está en `tenant-schema.sql:2218-2219`) |
| **Trigger `inactivity`** | **TERMINAR** | Un cron/listener que lo evalúe. Sostiene el pitch de recall dental y reactivación de gym (research #2 y #5) |
| **Ruteo por zonas inmobiliario** | **TERMINAR** | Backend completo; falta 1 call site + UI mínima de zonas (endpoints ya expuestos en `api.ts:1724-1726`) |
| **`slaHours` por vertical** | **TERMINAR** | La cadena tipo→seeder→motor→UI existe entera; sembrar valores para 5-6 verticales donde el SLA importa (hogar, salud, inmobiliaria) |
| **`afterHoursMessage` del registry** | **TERMINAR** | Escrito en 4 idiomas × 18 verticales; cablearlo a `config.hours.afterHoursMessage` en el patch de persona |
| **Toast/Mindbody/Cliniko** | **TERMINAR (fase confiabilidad)** | Filtro de frescura + re-sync cron + 1 prueba en vivo por adapter; corregir `vertical-strategy.md:338` que las sobre-declara |
| **`check_daycare_availability` (checkOut/petSize)** | **TERMINAR** | El schema promete validar la estadía y el handler la ignora; honrar el contrato o recortar el schema |
| **staff-scheduling (módulo)** | **MATAR** | Isla de 4 tablas sin consumidores, SQL roto en `getAvailableStaff`, duplica el modelo `service_staff` que sí se usa. El multi-staff real se construye sobre `service_staff` + el staffId del motor (§5.1) |
| **channel-manager (Hostaway API suelta)** | **MATAR como módulo aparte** | Duplica al vacation-rental completo, sin puerta de entrada, secretos en claro. Si la decisión 1 elige GTM hospitality, lo que sobreviva se integra como sync-source del vacation-rental (el puente `cm_listings.property_id` ya está insinuado y nadie lo escribe) |
| **Campo `deferred` del registry** | **MATAR** | Un escritor, cero lectores. Borrar |
| **`itemOrder` del sidebar** | **MATAR** | Lector desplegado, ningún escritor, la estrategia lo declara completado. Borrar el lector o sembrar en 2 verticales — elegimos borrar |
| **`verticalConfig.bookingEnabled` persistido** | **MATAR** | Solo lo usa el propio seeder; dejar de persistirlo |
| **`photos` JSONB de service_requests** | **MATAR** | Sin tool IA ni UI; borrar la columna en el próximo ciclo expand-contract o exponerla en el board — elegimos borrar |
| **Páginas duplicadas de cursos** | **MATAR /admin/catalog/courses** | Dos modelos escribiendo la misma tabla; sobrevive /admin/courses (education) tras el fix de schema |
| **`searchVehiclesForAI` duplicado** | **MATAR** | Bug de centavos en código sin llamadores; el executor ya lo hace bien |

---

## 7. El mercado

Nuestros propios documentos ya ordenaron la demanda y nadie los usó para asignar ingeniería. `market-research-latam.md` (§3): belleza/estética 88, dental 87, especialistas salud 86, inmobiliaria 84, gimnasios 78, restaurantes 77 — hospitality explícitamente "pursue later" (`:1014`). Contexto: comercio conversacional LatAm ~$18.2B, +35% YoY, WhatsApp 72% del volumen (`competitive-analysis:348`).

**Dónde estamos profundos vs dónde deberíamos:** la matriz demanda×profundidad del eje mercado muestra el desalineo en una fila: moda_belleza (demanda #1) = cero tools, cero módulos, cero integraciones — *"el peor desalineo del catálogo"*. Dental (#2) sí tiene extras reales pero la estética (parte del #1) no la activa ningún sub-tipo. Mientras, turismo/VR — la vertical que el research mandó a diferir — acumula dos módulos de inventario, iCal y OAuth con Hostaway.

**Pricing ciego a la industria:** todos los planes son rentables (59-77% bruto) pero la única palanca vertical es `maxProperties`. El add-on de hospitality (+$30) y el tier por outcome que los docs recomiendan nunca se crearon, con WTP documentado de $100-600/mes en hospitality y dentistas pagando ya $50-200/mes por herramientas menores. Hay plata en la mesa y ninguna decisión tomada.

**Qué no merece más inversión:** finanzas, technology, servicios_profesionales y retail como verticales profundas — sin demanda documentada que lo justifique ni diferenciación posible a corto plazo. Mantenerlas dignas (FAQs propias, quick wins de §4) y dejar de fingir que son verticales: son `otro` con buen vestuario. **Qué falta:** la decisión e-commerce (mercado gigante documentado, dimensión 5/10 en el análisis competitivo, decisión estratégica nunca tomada) y estética como sub-tipo activable.

**Higiene documental:** el análisis competitivo canónico quedó vencido a nuestro favor (dice "12 verticales" habiendo 17+otro; puntúa 2/10 capacidades ya construidas) — él mismo pedía revisión en agosto. `vertical-strategy.md` es mayormente code-grounded pero sobre-declara T3.19.

---

## 8. Plan priorizado

### Ahora (2 semanas) — ✅ IMPLEMENTADO 12/12 (`b9bd6332`, `5c2581db`, `60049164`, 29-jul)

Desviaciones respecto de lo planificado, todas documentadas en los commits: el fix de education necesitó además `slug DROP NOT NULL` (verificación §9); `offer_required` se quitó de **6** verticales y se conservó en education, cuyo artefacto sí existe (el barrido final encontró 7 usos, no 4); la selección de plantilla por sub-tipo cubrió también pet-tienda y delivery/dark kitchen; y el ítem #11 se implementó con cache `bizgoals:{tenantId}` (600s) para no agregar una query por turno. Nota operativa: los tenants ya sembrados conservan la regla `offer_required` vieja en sus `pipeline_stages` — el re-sync del embudo o el editor de etapas la corrigen; no se hizo backfill porque aún no hay producción real.



| # | Qué | Por qué | Dónde | Esf. |
|---|---|---|---|---|
| 1 | Guard `.has()` + 6×4 claves `verticalWelcome` | 6 verticales muestran la clave i18n cruda en el saludo del panel | `admin/page.tsx:362` + 4 JSON | XS |
| 2 | `enableSimpleTool('vehicles')` para automotriz | La vertical entera está apagada por 1 línea | `verticals.service.ts` | XS |
| 3 | 5 ALTER TABLE de education | Crear curso falla; desbloquea módulo + 6 tools | `tenant-schema.sql` (patrón `:2218`) | XS |
| 4 | Quitar `offer_required` de "Cotizado" + sembrar 2-3 planes seguros | Tablero bloqueado + cotizador vacío el día 1 | `vertical-definitions.ts:918`, bootstrap | S |
| 5 | `tools.appointments` en `tpl_finanzas_calificador`; `tools.restaurants` en `tpl_restaurante_delivery` | Dos promesas del alta muertas por flags | `persona.service.ts` | XS |
| 6 | alquiler_vacacional en SUB_TYPES + `tools.properties` para hotel/VR + plantilla por subtipo en turismo | La industria fantasma y el subtipo hotel con FAQs de agencia | `onboarding/page.tsx`, bootstrap | S |
| 7 | "Hotel — noche" no agendable por slots; umbral citas/día configurable | Bucle eterno de no-disponibilidad (pet) y sobreventa (foto/vet) | seed + `ai-tool-executor` | XS |
| 8 | Listener `service_request.created` (urgencia=emergencia → inbox/email) | Emergencias reales sin notificación humana | patrón `handoff.escalated` | S |
| 9 | Rutas del ToolsTour (inmobiliaria/automotriz/retail) | Última pantalla del asistente manda a páginas equivocadas | `ToolsTour.tsx:54-57` | XS |
| 10 | Mindbody: filtrar clases pasadas + `synced_at` fresco | La IA ofrece horarios muertos a la semana | `vertical-integrations.service.ts:362-372` | XS |
| 11 | Inyectar `chatReasons/customerTypes` al prompt L3 | El tenant "otro" describe su negocio a la nada | prompt-assembler + auth | S |
| 12 | Página /admin/vehicles + ítem sidebar | Sin ella el tenant no puede cargar autos aunque el tool esté on | REST ya existe | M |

### Trimestre — la decisión de arquitectura y el nicho #1

1. **Capacidad F1+F2** (§5.1): `max_concurrent` en chat (S) + staffId persistido (M). Desbloquea belleza multi-silla, restaurantes con concurrencia real y salud multi-médico. **Es el ítem de más impacto del documento.**
2. **Belleza como apuesta** (demanda #1): sub-tipo estética activable (salud y belleza), revivir el trigger `inactivity` (recall/rebooking — también sirve a dental y gym), y las 2-3 tools mínimas que el research especificó. Con F1 de capacidad, el salón multi-silla ya funciona.
3. **Reserva de clase con cupo (gimnasios)**: el patrón ya existe en la plataforma — `tour_inventory` modela cupos por salida que se decrementan; portarlo a clases (M/L).
4. **Fiabilidad de integraciones**: cron re-sync + prueba en vivo por adapter + corregir vertical-strategy (S/M).
5. **Consumir `GET /verticals/definitions/all` en el alta** — mata el drift de sub-tipos de raíz (ya estaba como ítem #18 del plan de onboarding).
6. **Cosmética de las 6 nuevas**: checklist + empty states + welcome (S).
7. **Decisión de pricing vertical** (add-on hospitality / palancas por industria) — decisión de negocio, el seed es trivial después.
8. **Retirar del pricing lo que no tiene pantalla** (o construirla): staffScheduling / channelManager (§5.3).

### Después

- Mesas con partySize (restaurantes) o integración de reservas de terceros.
- Write-path de inscripción (Mindbody / clases propias).
- Portales inmobiliarios (FincaRaiz, Metrocuadrado, Inmuebles24).
- La decisión e-commerce (checkout conversacional vs integración).
- Estadía multi-día genérica (pet hotel; VR ya la tiene).
- Procedures SOP por vertical para el top-5 (triage veterinario, urgencias dentales, anamnesis).
- Señas/anticipos (fotografía, tours) — el rubro vive de eso.
- GTM Hostaway si la decisión 1 lo aprueba (marketplace + case study, sin más ingeniería).

---

## 9. Qué no verificamos

**Actualización (29-jul): verificación manual de los 6 hallazgos que sostienen el plan "Ahora".** Resultado: **6/6 confirmados, cero refutados — y dos se agravaron al verificarlos:**

| Hallazgo | Veredicto | Detalle |
|---|---|---|
| Colisión tabla `courses` (education) | **CONFIRMADO Y PEOR** | Los 5 ALTERs no alcanzan: la tabla legacy que gana tiene `slug NOT NULL UNIQUE` (`tenant-schema.sql:316`) y `createCourse` inserta **sin** slug (`education.service.ts:52-56`) → el fix necesita además `ALTER COLUMN slug DROP NOT NULL` (o un default) |
| `tools.vehicles` nunca encendido | **CONFIRMADO** | grep de vehicles en `verticals.service.ts` y de su enable en plantillas: vacío; sin página `/admin/vehicles` en el dashboard |
| Bucle "Hotel — noche" (pet) | **CONFIRMADO** | Servicio de 1440 min sembrado (`vertical-definitions.ts:770`); el generador exige `min + totalBlock <= slotEndMin` (`ai-tool-executor.service.ts:1025`) → jamás cabe en una ventana diaria |
| Saludo con clave i18n cruda | **CONFIRMADO** | `admin/page.tsx:362` llama `tVw(vt.industry…)` sin guard `.has()`; `verticalWelcome` tiene solo 11 industrias + default — faltan las 6 nuevas |
| `offer_required` imposible (seguros) | **CONFIRMADO Y MÁS AMPLIO** | La regla consulta `commercial_offers JOIN leads.course_id` (`pipeline.service.ts:~894`) y la usan **4 etapas de 4 verticales distintas** (`vertical-definitions.ts:220, :366, :423, :918`) — el fix debe evaluar las cuatro, no solo la de seguros |
| Agenda muerta de finanzas | **CONFIRMADO** | `tpl_finanzas_calificador` trae solo `{crm, knowledge}` (`persona.service.ts:1848`) con `bookingEnabled: true` sembrando servicio+slots que nada consume |

- **El resto de los hallazgos no pasó ronda adversarial.** Los 8 mapeos citan archivo:línea leídos, pero fuera de los 6 de arriba ningún hallazgo tuvo un verificador buscando mitigantes. La experiencia de la auditoría anterior (bootstrap vertical) muestra que ~1 de cada 3 graves baja de severidad al verificarse.
- **Nada se ejecutó contra base real** — ni un alta, ni una conversación, ni una reserva.
- **cluster-agenda tiene menor profundidad declarada** (elaborado por el orquestador tras fallos de infraestructura; pipeline y docs_estrategia son estimaciones conservadoras).
- **Datos de producción que cambiarían las prioridades:** distribución real de tenants por industria (decide si belleza-primero es correcto también para NUESTRA base y no solo para el mercado), % de tenants con >1 profesional (dimensiona la urgencia de capacidad F2), y el comportamiento real de next-intl ante clave faltante (el bug del saludo se infirió del código, no se vio en pantalla).
- **El análisis competitivo canónico está vencido** y él mismo pedía revisión en agosto; §7 lo usa con esa reserva.
