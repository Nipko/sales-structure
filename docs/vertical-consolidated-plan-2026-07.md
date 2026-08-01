# Plan consolidado de verticales — qué hacer (Jul 2026)

> **De dónde sale.** De los 18 deep-dives por vertical (`docs/vertical-deep-dives/*.md`, §4 "Huecos finos" y §7 "Plan de inversión") cruzados con la auditoría de madurez (`docs/vertical-maturity-audit-2026-07.md`) y la de bootstrap (`docs/vertical-bootstrap-audit-2026-07.md`).
>
> **Cuánto se consolidó.** ~390 ítems accionables extraídos de los dossiers → **24 arreglos horizontales**, **~55 ítems verticales** y **~20 descartes explícitos**. La compresión no es cosmética: el mismo problema aparecía contado por hasta 6 dossiers distintos (el motor de reservas mono-recurso, el evaluador temporal, el handoff por substring, el sub-tipo sin consecuencias). Cada uno de esos es UN ítem acá.
>
> **Lo ya arreglado no está.** Los fixes desplegados de la ronda (bootstrap canónico, merge de tools, `availability_slots`, `tools.vehicles` + `/admin/vehicles`, tabla `courses` desbloqueada, `duration_type 'open'`, listener de emergencias de hogar, P0 de tours, forecast con `is_terminal`, etc.) fueron excluidos aunque algún dossier los mencione como pendientes.
>
> **⚠ Advertencia de confianza.** Casi nada de esto pasó por una ronda adversarial. Los dossiers son lectura de código de una sola pasada: la evidencia con `archivo:línea` es fuerte, pero la conclusión ("esto no funciona") no fue reproducida en runtime salvo en los casos que ya se arreglaron. Ver §7 antes de tocar algo caro.

---

## 1. Cómo leer este plan

**La tesis, en 5 líneas.** *Thin vertical, deep horizontal.* Las 18 verticales no fallan cada una por su cuenta: fallan por 6 defectos horizontales que se manifiestan 18 veces. El motor de reservas asume un recurso único; el motor de automations solo reacciona a eventos entrantes y nunca al paso del tiempo; el handoff por substring corre antes que la IA y mata las tools de intake; el sub-tipo que el dueño elige en el alta casi nunca cambia nada; la cita no se liga al objeto de negocio; y el dinero del cliente final no tiene circuito. Arreglar esos seis mejora 18 verticales a la vez, y cuesta menos que cualquier vertical sola.

**La regla de orden.** Primero lo horizontal que destraba N verticales (§3). Después lo vertical, por prioridad de mercado (§4). Un ítem vertical solo sube de prioridad si es un P0 suelto que no depende de nada (por ejemplo: en gimnasios no hay forma de dar de alta un miembro, y sin miembros ninguna tool del rubro responde).

**Qué está bloqueado.** Hay 12 decisiones del dueño (§2) que bloquean trabajo real. Los ítems bloqueados están marcados con **🔒D-n**. No se puede empezar la Ola 3 sin resolverlas; la Ola 1 está diseñada para no depender de ninguna.

**Convención de esfuerzo.** XS = menos de medio día · S = 1-2 días · M = ~1 semana · L = 2+ semanas.

---

## 2. Las decisiones que bloquean trabajo

| # | Decisión | Qué desbloquea | Qué pasa si no se decide | Recomendación |
|---|----------|----------------|--------------------------|---------------|
| **D1** | **Cirugía del motor de reservas**: ¿F1 (capacidad por servicio) como parche y F2 (staff persistido) después, o F2 directo? | H-1, H-2 y con ellos belleza, salud, restaurantes, veterinaria, gimnasios, inmobiliaria, pet_services | El techo de todo tenant de agenda sigue siendo ~1 reserva por franja para todo el local: el segundo cliente de la noche recibe "no hay disponibilidad" con el local vacío | **Las dos, en ese orden.** F1 ya (S, sin modelo nuevo) porque es lo que destraba mesas/sillas/consultorios; F2 en Ola 2 porque salud e inmobiliaria dicen explícitamente que F1 no les alcanza (necesitan agenda por profesional/asesor). No esperar F2 para cobrar el valor de F1 |
| **D2** | **Evaluador temporal transversal**: ¿un cron diario con "sabores" por vertical, o implementaciones separadas? | H-3, y con él el recall de vacunas (vet), el recall semestral (dental), la reactivación de inactivos (gym), el rebooking (belleza), el vencimiento de pólizas (seguros), la re-matrícula (education), el pre-arrival y el review request (turismo) | Al menos 12 ítems de 7 dossiers quedan sin motor. Las plantillas con `trigger_type='inactivity'` ya sembradas (`seed-templates.ts:149,170`) siguen siendo decoración: nadie las evalúa | **Un solo cron, sí.** Es una inversión M compartida por 7 verticales; hacerlo por vertical es pagarlo 7 veces. Diseño en §3/H-3. Cargarlo contra veterinaria + dental, que es donde el dato temporal ya está explícito en la DB |
| **D3** | **Cobro al cliente final**: ¿se habilitan credenciales de pago por-tenant (token MP del tenant o marketplace/split)? Hoy toda la infra MP cobra con credenciales de Parallly | La seña anti-no-show (belleza, salud, fotografía), el checkout de retail, el anticipo de tours, el pedido pago de restaurantes y la matrícula de education. Cinco verticales con el circuito de dinero cortado por una sola causa | Cinco verticales terminan su mejor conversación en "pago pendiente" eterno. `payment_status` existe write-only en pedidos (`tenant-schema.sql:2040`), tours (`:1809`) e inscripciones (`:2266`) y nadie lo escribe | **Sí, pero como spike acotado primero** (2-3 días: ¿MP marketplace/split o token del tenant en `channel_accounts`-style cifrado?). No arrancar la implementación completa hasta tener la respuesta. Es la decisión de mayor palanca comercial del plan |
| **D4** | **Gate de plan sobre el objeto central**: `maxProperties=0` (turismo) y `vehicleInventory=false` (automotriz, emprendedor **y** starter) hacen que la vertical nazca muerta el día 1 | El día 1 de turismo y automotriz. Hoy el trial recibe un 403 crudo en español al intentar cargar su primer auto (`feature.guard.ts:48-55`) | Todo lo demás que se construya para esas dos verticales es para tenants que no pueden existir en los planes de entrada | **Encender el flag en todos los planes y gatear por cantidad** (`maxVehicles`/`maxProperties` en el registry + `enforcePlanLimit` en el create, patrón `tours.service.ts:51`). Una tabla vacía no cuesta nada. Mínimo indispensable si se rechaza: upsell-state en la página en vez del 403 |
| **D5** | **Partición del catálogo belleza/moda**: mover `boutique` a retail, renombrar la vertical a "Belleza y estética", crear el sub-tipo `estetica` (no-médico), y dejar en salud solo "Dermatología y medicina estética" | 4 ítems de los dossiers 1 y 2 (que coinciden explícitamente) + que la vertical #1 de demanda deje de mezclar dos negocios de flujo opuesto | La tienda de ropa sigue naciendo con agendadora de peluquería y "Corte y estilo" agendable; la clínica de estética (comprador #1 del research) sigue cayendo en el hueco entre belleza y salud | **Sí, las tres.** Sin migración de datos (no hay producción real). Agregar el helper de frontera en el selector del alta: *"¿hay médico prescribiendo? → Salud; si no → Belleza"* |
| **D6** | **Merge de rules plantilla-vs-registry** en `patchDefaultAgent`: ¿gana la plantilla (hoy, `verticals.service.ts:309,327`) o se unen? | Que las reglas verticales del registry —las que instruyen las tools— lleguen al agente activo en las 18 verticales. Hoy las tools verticales solo se conocen por su descripción JSON | Las 6 tools de gym, las de seguros y las de education quedan des-instruidas en todo tenant cuya plantilla traiga rules propias | **Unir**, como ya se hace con `forbidden` y `handoffTriggers`. Es una línea de política con efecto en las 18 |
| **D7** | **Orden del handoff**: los triggers por substring corren antes de la IA (`conversations.service.ts:590-601`) y anulan las tools de intake en al menos 4 verticales | H-4. Que file_claim (seguros), create_service_request (hogar), qualify_financing (automotriz) y el triage vet capturen el intake estructurado ANTES de escalar | Se sigue podando listas de palabras vertical por vertical, para siempre. "¿ofrecen financiación?" seguirá escalando a humano contradiciendo la FAQ sembrada | **Cambiarlo a nivel plataforma**: consumir `shouldHandoff` del resultado de la tool (post-tool) y reservar el substring para emergencias reales. Los tool results ya devuelven el flag (`ai-tool-executor.service.ts:2520,2562`) y **nadie lo lee** |
| **D8** | **Identidad en verticales reguladas**: ¿las plantillas dejan de pedir cédula/DNI y la identidad se verifica con el OTP del Customer Portal, o se abre excepción en el contrato L1? | Seguros, finanzas y salud dejan de recibir órdenes opuestas por turno (`prompt-assembler.service.ts:94` prohíbe pedir government IDs; `persona.service.ts:2243,2274` las ordena) | Se acumulan documentos de identidad en `applicant_data` JSONB sin cifrar (`tenant-schema.sql:2329`) y el LLM decide caso a caso a quién obedecer | **Sacar la cédula de las plantillas** y verificar con `customer-portal.service.ts:66,101,194-205` (código 6 dígitos, Redis 10min, tope 5 intentos), que ya existe y no se usa desde el chat |
| **D9** | **GTM del trimestre**: ¿belleza-primero o dental-primero? | Condiciona las apuestas caras: galería antes/después + IG Story→booking + seña (belleza) vs recall semestral + research Dentalink/DentalWeb (dental) | Se financian las dos a medias y no gana ninguna | **Belleza-primero.** Es la vertical #1 de demanda del research y su unlock más grande (F1 capacidad) ya está en el camino crítico horizontal. Dental hereda el evaluador temporal sin costo marginal y queda como GTM #2 del trimestre siguiente |
| **D10** | **Integraciones verticales** (Cliniko, Mindbody, Toast, Hostaway): ¿se fiabilizan, se congelan, o se les escribe write-path? | Deja de sangrar inversión en PMS que el segmento LatAm de 5-25 empleados probablemente no usa | Cuatro integraciones read-only, sin cron de re-sync, nunca probadas en vivo, que igual aparecen en el material de venta | **Congelar los write-paths de las cuatro. Fiabilizar la lectura con UN cron transversal (H-20).** Excepción: Hostaway sube a "operable" (UI + credenciales cifradas + import one-shot `cm_listings→properties`) solo si se aprueba D12 |
| **D11** | **Research faltante**: automotriz (0 menciones en el competitivo), veterinaria (no está en el top-10 ni en el mapa país por país), pet_services (0 menciones), servicios_hogar (1 mención, sin WTP), POS/delivery LatAm para restaurantes, regulación de seguros (SFC/CNSF/SUSEP) | Que las apuestas de esas verticales sean tesis y no fe | Se invierte en profundidad donde el research nunca señaló demanda — exactamente el error que ya se cometió con turismo | **Financiar dos, no seis**: (a) el mapa POS/delivery LatAm (Fudo, Siigo POS, Loyverse, Rappi, PedidosYa) porque decide un conector de escritura caro; (b) veterinaria, porque es la vertical con más código dormido y cero validación. Las otras cuatro quedan explícitamente sin GTM (§5) |
| **D12** | **Turismo — GTM y monetización**: ¿1 design partner Segment B + case study + listing en el marketplace de Hostaway, y Hospitality Add-on de +$30 sobre Pro/Enterprise? | Monetizar el silo más profundo del catálogo (costo hundido ya pagado). El add-on gatearía pre-arrival, review request y Hostaway | La vertical con más código construido sigue en pausa comercial. Costo restante estimado: 3-5 semanas, no los 2-3 meses del research de abril | **Sí al add-on** (es billing, no ingeniería nueva, y le pone precio a lo ya construido). **Discovery antes del listing**: 5 conversaciones con property managers para validar el GTM, no la ingeniería |
| **D13** | **E-commerce (retail) — apuesta profunda**: webhooks bidireccionales, carrito abandonado, checkout in-chat, catálogo Meta, atribución CTWA | Un mercado de $18.2B con 72% de uso de WhatsApp | Ranking interno #10, WTP 5, retención 5, y competidores a 9/10 (Chatfuel a $69 ya tiene pagos in-chat) | **NO ahora.** Solo los quick wins + el circuito mínimo del pedido. El dossier pide explícitamente no arrancarla por inercia. Reevaluar si D3 (cobro al cliente final) sale bien: sin cobro propio, retail no es competitivo |

**Decisiones menores, agrupadas (higiene del selector de alta).** Las junto porque son la misma clase de problema: sub-tipos que el alta ofrece y el producto no soporta. Recomendación única: **si el sub-tipo no ramifica nada, se saca del selector o se le da rama (H-7)**. Casos: `peluqueria_canina` duplicado entre veterinaria y pet_services (→ re-etiquetar "Clínica con peluquería" + helper de frontera "¿hay médico veterinario?"); `farmacia` en salud (→ persona de catálogo con guardrail de recetas, sin agenda sembrada); `alquiler` en automotriz (→ degradar a genérico, el motor mono-slot no cotiza "del 12 al 15"); `multiservicio` en servicios_hogar (existe en el alta y no en el registry → sumarlo o sacarlo); `marketplace` en retail (→ quitarlo, es multi-vendor, no PYME).

---

## 3. Los arreglos horizontales (ordenados por verticales-desbloqueadas / esfuerzo)

| # | Arreglo | Patrón | Verticales que desbloquea | Sev | Esf | Evidencia |
|---|---------|--------|---------------------------|-----|-----|-----------|
| **H-1** | **F1 — honrar `services.max_concurrent` en la ruta de chat** | capacidad-reservas | belleza, salud, restaurantes, veterinaria, gimnasios, inmobiliaria, pet_services, turismo (8) | crítica | S | `ai-tool-executor.service.ts:1039` (toda cita sin staff bloquea todas las ventanas); `booking-engine.service.ts:784-786,873-876`; solo la ruta pública lo respeta (`public-booking.controller.ts:128`); `appointments.controller.ts:222-224` default 1; `appointments.service.ts:717,787` ya lo honra |
| **H-2** | **F2 — `staffId`/`assigned_to` real y persistido en la reserva** | existente-pero-inalcanzable | salud, inmobiliaria, belleza, veterinaria, automotriz (5) | alta | M | `ai-tool-executor.service.ts:1092-1093` (check_availability YA devuelve staffId/staffName), `:1252` (create_appointment YA lo acepta), `:1177-1195`; `appointment-tools.ts:97-108` (BookingState sin staffId); `booking-engine.service.ts:784,873` |
| **H-3** | **Evaluador temporal transversal (cron diario que emite eventos de dominio) + ampliar el bus de triggers** 🔒D2 | evaluador-temporal | veterinaria, salud, gimnasios, belleza, seguros, education, turismo, pet_services (8) | alta | M | `automation.service.ts:21-28` + `automation-listener.service.ts:29,47-50` (solo evalúa por evento entrante); `seed-templates.ts:149,170,246-266` (plantillas `inactivity` sin evaluador); `tenant-schema.sql:1978` (índice `idx_pet_vaccinations_due` sin consumidor), `:2361` (índice `(status,next_payment_at)` sin cron) |
| **H-4** | **Capturar-y-escalar: consumir `shouldHandoff` post-tool y despodar los triggers por substring** 🔒D7 | trigger-vs-tool | seguros, servicios_hogar, automotriz, veterinaria, pet_services (5) | alta | S | `ai-tool-executor.service.ts:2520` (file_claim) y `:2562` (create_service_request) devuelven `shouldHandoff:true` y **0 lectores**; `conversations.service.ts:590-601` (substring pre-IA); `handoff.service.ts:107-111`; `persona.service.ts:1615,2247`; `vertical-definitions.ts:917` |
| **H-5** | **Yield vertical del motor de citas: `handled:false` cuando la vertical tiene tools propias de reserva/inventario** | trigger-vs-tool | gimnasios, turismo, inmobiliaria, restaurantes, education, pet_services (6) | crítica | S | `intent-interpreter.service.ts:336` (regex `agendar\|cita\|reservar\|turno\|programar\|disponib`); `booking-engine.service.ts:611,717-720`; `conversations.service.ts:1744,1907` (handled → `tools=[]`), flag disponible en `:1713`; grep de carve-out vertical en el engine = 0 |
| **H-6** | **Ligar la cita al objeto de negocio: `metadata.{listingId,petId,vehicleId}` en `create_appointment`** | otro | inmobiliaria, veterinaria, automotriz (3) | alta | M | `ai-tool-executor.service.ts:1260-1269` (el INSERT omite `metadata`) pese a que la columna existe (`tenant-schema.sql:1345`) y la ruta dashboard sí la escribe (`appointments.service.ts:264-268`); `booking-engine.service.ts:186-196` (BookingState sin noción de objeto); `appointment-tools.ts:27-43` |
| **H-7** | **El sub-tipo debe tener consecuencias: (a) mapa `bySubType` completo, (b) rama de seed por sub-tipo, (c) `subType` al `<vertical_context>` del L3** | existente-pero-inalcanzable | salud, belleza, inmobiliaria, gimnasios, turismo, restaurantes, veterinaria, automotriz, education (9) | alta | S por vertical | `persona.service.ts:2694-2697` (default = `templates[0]`), `:2702-2713` (bySubType sin dental, boutique, inmobiliaria, gimnasios, hotel, taller, education); `verticals.service.ts:49-58,101-103` (seedServices/seedAvailability ciegos al subType); `vertical-definitions.ts:1108-1111` |
| **H-8** | **Checklist de onboarding por vertical con href y check propios** | existente-pero-inalcanzable | turismo, restaurantes, automotriz, education, gimnasios, inmobiliaria, seguros (7) | alta | S | `OnboardingChecklist.tsx:24-34,29` (href fijo a `/admin/knowledge`, check `hasKnowledge`); `es.json:6014+,6040` ("Carga tu menú", "Carga tu inventario", "Carga tus cursos" → todos a la KB); `ai-tool-executor.service.ts:2129-2132` (place_order exige filas en `menu_items`, no PDFs en la KB) |
| **H-9** | **KPI del home contra la tabla real de cada vertical (dejar de re-etiquetar `appointmentsToday`)** | otro | turismo, gimnasios, restaurantes, automotriz, education, seguros, servicios_hogar, veterinaria (8) | media | S | `vertical-definitions.ts:445` ("Reservas Confirmadas"), `:1037`, `:399` ("Test Drives Hoy"), `:493` ("Matrículas Hoy") — todos = `appointmentsToday`; `analytics.service.ts:345-349` cuenta la tabla `appointments`; el aggregator del super admin ya calcula lo correcto (`vertical-analytics.service.ts:249-279,455-467`) |
| **H-10** | **Atomicidad de cupos/asientos: decrement-first con guard antes del INSERT** | asientos-cupos | gimnasios, turismo, education (3) | media | S | `gyms.service.ts:379-413` (check e INSERT no atómicos); `tours.service.ts:259-316` (el propio comentario dice "racy… FOR UPDATE is the upgrade path", `:278-279`); `education.service.ts:218-243` (check → INSERT → decremento, 3 statements sin transacción) |
| **H-11** | **`enableSimpleTool` solo enciende el flag en el agente default → el 2º agente nace mudo** | existente-pero-inalcanzable | todas (multi-canal/multi-agente) | media | XS | `verticals.service.ts:1055-1076` (`WHERE is_default = true LIMIT 1`); mismo patrón en `enableRestaurantsTool` (`:998-1021`) y `enablePetsTool` (`:969-992`) |
| **H-12** | **Política de merge de rules plantilla-vs-registry** 🔒D6 | otro | todas (18) | media | S | `verticals.service.ts:309,327` (`existingRules.length > 0 ? existingRules : registry`): las rules del registry —las que instruyen las tools— nunca llegan si la plantilla trae las suyas |
| **H-13** | **`localizeVerticalTemplates` colapsa N plantillas verticales a una fuera de español** | existente-pero-inalcanzable | todas (pt/fr/en; Brasil es P3 del GTM) | media | M | `persona.service.ts:2616-2664` (base = `templates[0]`), `:2714-2718` (el lookup por sub-tipo falla contra el array colapsado): un operador de tours en pt pierde su persona y hereda `appointments:true` |
| **H-14** | **`blocked_dates` en el `checkAvailability` de la ruta de chat** | capacidad-reservas | salud, belleza, veterinaria, todas las de agenda | media | S | `ai-tool-executor.service.ts:976-994` (solo `availability_slots` + `appointments` + calendar busy); el patrón correcto está en `appointments.service.ts:598,736` |
| **H-15** | **Transition rules sobre objetos reales: `booking_required` / `order_required` (hoy solo `appointment_required`)** | otro | turismo, restaurantes, retail, gimnasios, education (5) | alta | S | `pipeline.service.ts:877-887` (consulta SOLO la tabla `appointments`); `vertical-definitions.ts:424,289-297`: el embudo no avanza aunque el bot cierre reservas o pedidos reales todo el día |
| **H-16** | **Exponer al tenant el gap-detector de activación que hoy solo ve el super_admin** | existente-pero-inalcanzable | todas (18) | media | S | `vertical-analytics.service.ts:119-130` (la plataforma ya sabe que el catálogo está vacío; el tenant no) |
| **H-17** | **Gate de plan sobre el objeto central: encender el flag y gatear por cantidad** 🔒D4 | existente-pero-inalcanzable | turismo, automotriz (2, pero es su día 1) | crítica | XS | `seed-billing-plans.js:52,107,205`; `vehicle-inventory.controller.ts:14-15` (`@RequireFeature` en todo el controller) + `feature.guard.ts:48-55` (403 duro); `tenant-throttle.service.ts:202-205,314-329` |
| **H-18** | **Cron de re-sync + señal de frescura para integraciones verticales** 🔒D10 | otro | gimnasios (Mindbody), salud (Cliniko), restaurantes (Toast), turismo (Hostaway) | media | S | `vertical-integrations.service.ts:190-202,270-297` (sync manual, ventana 14 días); grep `@Cron` en el módulo = 0; grep `@Cron` en channel-manager = 0 |
| **H-19** | **Import masivo (CSV/XLSX) con mapeo de columnas, como componente compartido** | otro | inmobiliaria, gimnasios, restaurantes, automotriz, education (5) | alta | M | Dossiers §3a/§5: 40 propiedades / 200 miembros / 60 platos / 40 autos cargados de a uno es el punto de abandono documentado; `menu/page.tsx:360-410`; existe patrón reusable en el bulk-import de la KB |
| **H-20** | **Trigger `appointment.completed` + secuencia post-visita semilla** | trigger-vs-tool | inmobiliaria, salud, belleza, automotriz, veterinaria (5) | media | M | `seed-templates.ts` (triggers reales: `lead.captured`, `inactivity`, `stage_changed`, `new_message`, `sla_timeout`; no existe `appointment.completed`) pese a que el cron de auto-complete ya marca las citas; `market-research-latam.md:499` |
| **H-21** | **Identidad determinista con el OTP del Customer Portal + limpiar la contradicción L1↔plantillas** 🔒D8 | otro | seguros, finanzas, salud (3) | alta | M | `customer-portal.service.ts:66,101,194-205` (OTP existente, 0 uso desde el chat); `prompt-assembler.service.ts:94` vs `persona.service.ts:2243,2274`; `ai-tool-executor.service.ts:2481-2499` (check_policy_status devuelve titular y prima sin acreditación) |
| **H-22** | **Cobro conversacional: link MP de pago único + `payment_status` vivo** 🔒D3 | dinero-no-cierra | belleza, salud, turismo, restaurantes, education, retail, fotografía (7) | media | L | `tenant-schema.sql:2040` (pedidos), `:1809` (tours), `:2266-2267` (inscripciones) — todas write-only; `competitive-analysis-2026-q2.md:450,529,543`; la pieza MP de pago único ya existe en el checkout de créditos SMS |
| **H-23** | **Galería de media por contacto (auto-attach de imagen entrante + tab en el CRM)** | otro | belleza, salud, veterinaria, automotriz, seguros, servicios_hogar (6) | media | L | Media-processing describe la imagen y persiste texto al historial; el módulo `media/` es biblioteca del tenant, no per-contact; `tenant-schema.sql:2374` (`insurance_claims.documents` JSONB nunca escrito) |
| **H-24** | **Catálogo visual en el canal: carrusel multi-imagen + contexto de `reply_to.story` de IG** | otro | inmobiliaria, retail, restaurantes, turismo, automotriz, belleza (6) | baja | M | `ai-tool-executor.service.ts:487-500` (send_listing_image manda 1 foto); `instagram.adapter.ts:174-201` (el texto gana en `:176` y `reply_to.story` en `:196-198` se aplana a un placeholder, descartando el asset); `market-research-latam.md:423,495` |

**Ítem de higiene con costo XS que no merece fila propia:** sembrar `slaHours` en las etapas del registry (`vertical-definitions.ts:72-77`, grep `slaHours` = 0) — el motor de `sla_timeout` y su UI ya están construidos y nunca disparan por falta de datos.

### Diseño de los 5 primeros

**H-1 — F1, capacidad por servicio en la ruta de chat.**
El campo `services.max_concurrent` ya existe, es editable y la ruta pública lo respeta (`public-booking.controller.ts:128`); lo que falta es que el executor y el motor lo lean. Tocar `checkAvailability` y `checkSlotStillAvailable` en `ai-tool-executor.service.ts:976-1046`: en vez de "existe alguna cita solapada → bloqueado", contar solapes **por servicio** y comparar contra `max_concurrent`. Pasar además `maxConcurrent` en `appointments.controller.ts:222-224`, hoy hardcodeado en 1. Cuidado #1: hoy una cita con `assigned_to NULL` bloquea *todas* las ventanas, así que el conteo debe ser por servicio y no global, o el fix no cambia nada. Cuidado #2: sin UI el dueño no puede declarar sus 4 sillas — va junto un campo "¿cuántos clientes en paralelo?" en la edición de servicio (+4 JSON i18n). Cuidado #3: en restaurantes esto además exige preguntar el tamaño del grupo al elegir servicio (`grep partySize` en `apps/api/src` = solo tours), si no "Reserva mesa 2-4" con `max_concurrent=N` simula N mesas de tamaño desconocido.

**H-5 — Yield vertical del motor de citas.**
Es una línea de decisión, no un módulo. En `intent-interpreter.service.ts:336` la regex `agendar|cita|reservar|turno|programar|disponib` captura el turno y `conversations.service.ts:1744,1907` lo cierra con `tools=[]`: la vertical pierde sus herramientas justo en el momento de conversión. El diseño: en `decide()` del booking engine, si el agente tiene una tool vertical de reserva/inventario encendida (`tools.gyms`, `tools.tours/properties`, `tools.listings`, `tools.restaurants`, `tools.education`) **y** el texto menciona un objeto de esa vertical (clase, disciplina, curso, propiedad, habitación, mesa) o el servicio no matchea los sembrados → devolver `handled:false` y dejar pasar el turno a la IA con sus tools. El flag ya está disponible en `conversations.service.ts:1713`. Cuidado: no invertir el default — las verticales de agenda pura (salud, belleza, veterinaria) deben seguir entrando al motor determinista, que es donde el motor gana. Efecto secundario valioso: el motor deja de descartar el contexto vertical (en modo directivo solo viajan los últimos 4 mensajes), lo que hoy hace que la visita se agende sin saber de qué propiedad se venía hablando.

**H-4 — Capturar-y-escalar (el patrón `trigger-vs-tool` en sus 4 niveles).**
Cuatro dossiers describen el mismo choque: una lista de palabras evaluada por substring **antes** de la IA (`conversations.service.ts:590-601` → `handoff.service.ts:107-111`) escala el turno y con eso mata la tool de intake que la propia vertical construyó. Casos: "reclamo/siniestro" mata `file_claim` (seguros), "financiación" mata la FAQ que promete responderla (automotriz, `persona.service.ts:1615`), "emergencia" precede a `create_service_request` (hogar), y el triage vet queda apagado durante un booking. Un solo diseño los cubre: (1) implementar el post-proceso que lee `shouldHandoff` del resultado de cualquier tool y escala después del intake — el flag ya se devuelve en `ai-tool-executor.service.ts:2520,2562` y no lo lee nadie; (2) depurar las listas de triggers dejando solo lo que debe escalar *sin* intake previo (accidente en curso, urgencia médica real, negociación final de precio); (3) backfillear los tenants ya sembrados, porque arreglar el registry no reescribe las listas mergeadas que ya están en la DB. Ese punto 3 es el que se olvida siempre.

**H-7 — El sub-tipo debe tener consecuencias.**
Hoy el dueño elige con cuidado entre 4 sub-tipos y en la mayoría de las verticales no cambia absolutamente nada. Tres patas del mismo diseño: (a) completar `persona.service.ts:2702-2713` — falta dental, boutique, los 4 de inmobiliaria, los de gimnasios, hotel/alquiler_vacacional, taller y los de education; hoy el default es `templates[0]` y por eso la plantilla rica (dental, listings, clases) es literalmente inalcanzable desde el alta. (b) ramificar `verticals.service.ts:49-58` por `subType` — `seedServices`/`seedAvailability` corren para toda vertical con `bookingEnabled` sin mirar nada, y por eso el hotel recibe "Tour día completo" como agenda, la dark kitchen recibe "Reserva mesa 2-4" y la farmacia recibe una agendadora de consultas médicas; el mismo mecanismo resuelve `hospital_24h` (slots 7×24). (c) pasar `subType` al `<vertical_context>` del prompt L3 — el canal ya existe post-`5c2581db`, y con eso muchos sub-tipos no necesitan rama de bootstrap en absoluto. Regla de cierre: **si después de esto un sub-tipo sigue sin ramificar nada, se saca del selector** (ver el bloque de decisiones menores en §2).

**H-3 — Evaluador temporal transversal.**
El motor de automations solo reacciona a eventos entrantes (`automation-listener.service.ts:29`, único `@OnEvent('lead.captured')`), así que todo lo que depende del *paso del tiempo* no existe: las plantillas con `trigger_type='inactivity'` ya sembradas (`seed-templates.ts:149,170`) no las evalúa nadie. Diseño: **un** cron diario por tenant que consulte fuentes temporales según la vertical y emita eventos de dominio (`vaccination.due`, `recall.due`, `member.inactive`, `rebooking.due`, `policy.expiring`, `cohort.starting`, `stay.arriving`, `stay.ended`) que el motor de automations ya sabe consumir. Los índices para las queries ya están: `idx_pet_vaccinations_due` (`tenant-schema.sql:1978`), `(status,next_payment_at)` de pólizas (`:2361`), `current_period_end` de miembros, `starts_at` de cohortes, `check_in/check_out` de reservas. Requisitos no negociables: dedupe por `(rule, entity, período)` en `automation_executions` — si no, un cron diario spamea todos los días al mismo contacto — y respeto de opt-outs. Empezar por el sabor más barato: la vacuna vet, donde la fecha es un dato explícito y no una inferencia. Cuidado: la ventana de 24h de WhatsApp casi nunca está abierta para estos casos, así que cada sabor necesita su plantilla de utilidad aprobada.

---

## 4. El backlog vertical, por prioridad de mercado

Nada de lo que ya está en §3 se repite acá. Cuando un ítem vertical depende de un horizontal, se referencia con **(ver H-n)**.

### 4.1 Belleza y estética *(vertical #1 de demanda — 88 pts)*

| Ítem | Sev | Esf | Desbloquea |
|------|-----|-----|-----------|
| Sub-tipo `boutique` → `tpl_belleza_productos` y **no** sembrarle servicios de salón 🔒D5 (parte de H-7) | alta | XS | La tienda de ropa deja de nacer con agendadora de peluquería y "Corte y estilo" agendable (`persona.service.ts:1451-1477` — la plantilla existe y nadie la recibe) |
| Crear el sub-tipo `estetica` con rama propia (FAQs de preparación/contraindicaciones sin consejo médico, `treatments` ON) 🔒D5 | alta | S | La clínica de estética no-médica, comprador #1 del research, deja de caer en el hueco entre belleza y salud |
| Encender `tools.treatments` para spa/estética (`enableTreatmentsTool` ya existe, `verticals.service.ts:937-961`) | media | XS | Paquetes de sesiones (6 depilaciones, 10 masajes, keratinas) con un módulo construido y hoy exclusivo de dental |
| `rebook_after_days` por servicio + cadencia de re-reserva (ver H-3) | alta | S | Rebooking automático por servicio: el lock-in que el research valúa como retención del rubro |
| Encender `tools.catalog` en `tpl_belleza_productos` + reescribir su descripción (promete "gestiona membresías" con `tools:{}`, `persona.service.ts:1453,1474`) | media | XS | Una plantilla de productos que puede mostrar catálogo en vez de prometerlo |

*Menores:* handoffTriggers realistas ("novia", "boda", "somos N", "evento") en vez de la frase literal "grupo grande" (`vertical-definitions.ts:141`); 2 KPIs propios (servicio top 30d, % de recurrencia) — el aggregator cae en `default null` hoy (`vertical-analytics.service.ts:625`).

### 4.2 Salud *(demanda #2 — dental es el nicho)*

| Ítem | Sev | Esf | Desbloquea |
|------|-----|-----|-----------|
| Sub-tipo `dental` → `tpl_salud_dental` (parte de H-7) | alta | XS | Triage de urgencias, valoración previa y las reglas que enseñan `get_treatment_plan`/`list_upcoming_sessions` (`persona.service.ts:1299-1355`) |
| Recall dental por servicio + preset "Dental Templates" de 1 click (ver H-3) | alta | S | El pitch económico #1 del nicho (payback < 1 día según el research); `treatment_plans.frequency_days` ya modela la cadencia |
| `treatments` + FAQs propias para `estetica` y `psicologia` (hoy solo dental tiene rama, `verticals.service.ts:87-90`) | media | S | Series de sesiones y paquetes 5/10 — feature #1 del nicho de especialistas |
| Cancellation recapture: al cancelar, ofrecer los 3 próximos slots | media | M | Recuperar la franja cancelada sin humano; el engine ya sabe cancelar y consultar disponibilidad |
| Higiene de datos de salud: aviso de privacidad en el saludo/FAQ semilla + retención configurable 🔒(política) | alta | M | Vender a clínicas sin riesgo reputacional: hoy la historia clínica espontánea viaja a los 5 proveedores del router |

*Menores:* 2 KPIs de treatment-plans en el home del tenant (el super admin ya los calcula, `vertical-analytics.service.ts:493-514`); corregir los docs que sobre-declaran multi-staff e integraciones probadas (`vertical-strategy.md:338,361`, `market-research-latam.md:438`).

### 4.3 Inmobiliaria

| Ítem | Sev | Esf | Desbloquea |
|------|-----|-----|-----------|
| Ligar la visita al listing (`listingId` en create_appointment → metadata, ver H-6) | alta | S | El asesor sabe qué inmueble va a mostrar; habilita bloqueo por propiedad+franja y el reporting propiedad→visitas→negocio |
| Resolver `assigned_to` de la visita: dueño del listing → zona → null (habilita H-1/H-2 en el rubro) | alta | S | Dos visitas simultáneas a propiedades distintas dejan de bloquearse (`ai-tool-executor.service.ts:1177-1195`) |
| Import CSV/XLSX de listings (ver H-19) | alta | M | La activación pasa de "tarde entera" a minutos; hoy el inventario entra a mano propiedad por propiedad |
| Terminar el ruteo por zonas: tab "Zonas" en `/admin/listings` + selector de asesor + call sites | media | M | `listing_zone_agents` + `resolveAgentForZone` (`listings.service.ts:235-277`) + endpoints (`listings.controller.ts:99-125`) están construidos con **0 llamadores** |
| Los 4 sub-tipos → `tpl_inmobiliaria_listings` (parte de H-7) | media | XS | La persona activa instruye `search_listings`, la tool que el bootstrap ya enciende (`persona.service.ts:1538-1590`, hoy inalcanzable) |

*Menores:* `lastListingId` en metadata de la conversación como fallback de contexto; matching listing-nuevo → leads calificados compatibles (hoy la plantilla "Nuevas propiedades disponibles" dispara por `stage_changed`, `seed-templates.ts:289-309` — renombrarla o construir el matching); índice único de `listing_zone_agents` con `city NULL` (el `ON CONFLICT` nunca dispara, `tenant-schema.sql:1929`); borrar el `labelOverride catalog→'Propiedades'` muerto.

### 4.4 Gimnasios

| Ítem | Sev | Esf | Desbloquea |
|------|-----|-----|-----------|
| **Alta de miembros operable desde el producto** (modal "Nuevo miembro" + acción "convertir a miembro") | crítica | M | `createGymMember` existe con **0 llamadores** (`api.ts:1591`): hoy `get_my_membership`, `book_class`, `freeze_membership` y `cancel_class_booking` responden "no active membership" al 100% de los clientes |
| Recurrencia semanal de clases (`class_templates` + cron materializador de 14 días) | alta | M | El dueño deja de teclear cada clase de cada semana; sin esto la adopción muere por fatiga de carga |
| Automation de reactivación por inactividad (sabor gym de H-3) + recordatorio de renovación sobre `current_period_end` | alta | M | El pitch de retención del rubro (día 7 sin venir recupera 15-20% del churn silencioso, `market-research-latam.md:507`) |
| Import CSV de miembros (ver H-19) + sembrar `membership_plans` en el bootstrap | alta | M | El día 1 de un gym con padrón de 200; `get_membership_plans` deja de devolver vacío |
| Waitlist viva: insertar en espera al llenarse y promover al cancelar | media | M | Feature que según el research ningún competidor LatAm ofrece WhatsApp-native (`tenant-schema.sql:2169,2175` ya tienen el estado y el índice) |

*Menores:* sacar "Plan Mensual" de los servicios agendables (`vertical-definitions.ts:1018` — hoy es reservable como cita de 30 min); alinear las rules de las plantillas gym con las 6 tools reales (depende de H-12); regla de desambiguación Mindbody-vs-nativo; KPI real contra `class_bookings`; `verticalChecklist` de gimnasios en los 4 idiomas; check-ins con productor y consumidor reales.

### 4.5 Turismo *(el silo más profundo del catálogo)*

| Ítem | Sev | Esf | Desbloquea |
|------|-----|-----|-----------|
| `tpl_turismo_hospitality` (appointments OFF + reglas de properties) + hotel/alquiler_vacacional en `bySubType` (parte de H-5/H-7) | alta | M | "Quiero una habitación del 10 al 15" deja de ser secuestrado por el motor de citas y termina en reserva real |
| Pre-arrival workflow (instrucciones de check-in 24h antes) + review request post-checkout (sabores de H-3) | alta | M | Pain #1 documentado de los 3 segmentos; convierte "bot que responde" en hospitality tool (`market-research-latam.md:884,898`) |
| Turnover mismo-día en propiedades: el predicado de solape cuenta el check-out como ocupado (`properties.service.ts:119,123`) | media | S | Una noche vendible extra por estadía — plata real del rubro |
| Camino `reserved→confirmed` para `tour_bookings` + excluir canceladas del GMV | media | S | La métrica primaria de la industria deja de ser 0 estructural (`vertical-analytics.service.ts:455-467,638`) |
| Hostaway operable: UI, cron, credenciales cifradas, import one-shot `cm_listings→properties` 🔒D10/D12 | media | M | El GTM "WhatsApp automation for Hostaway" sin construir integración runtime (`channel-manager.service.ts:63,118-142` — credenciales en claro hoy) |

*Menores:* exigir `min_nights` en el write-path (hoy solo se informa); emails de confirmación en el idioma detectado (TODOs explícitos en `tours.service.ts:342-356`, `properties.service.ts:283-295`); registro manual de seña + `payment_status` visible; corregir el activation gap-check (cuenta `tour_packages` y reporta `missing:'properties'`, `vertical-analytics.service.ts:125`); textos y rutas por sub-tipo (hoy "Tu agencia de viajes está lista" para los 4).

### 4.6 Restaurantes

| Ítem | Sev | Esf | Desbloquea |
|------|-----|-----|-----------|
| Listener de `food_order.created/cancelled` → email + WS + chime en el kanban | alta | S | Los eventos se emiten (`ai-tool-executor.service.ts:2157,2904`) con **0 listeners**: hoy el pedido muere en silencio salvo que alguien deje el kanban abierto |
| Tab "Promociones" en `/admin/menu` sobre los 3 endpoints ya expuestos (0 llamadores, `api.ts:1565-1570`) | alta | S | El objetivo del alta "enviar ofertas"; `get_promotions` deja de responder siempre vacío |
| Notificación proactiva de estado del pedido (`food_order.status_changed` → OutboundQueue) | media | M | Avanzar el kanban avisa al comensal en vez de obligarlo a preguntar; la ventana de 24h casi siempre está abierta |
| Zonas de entrega + tarifa configurables (`delivery_fee` real en `place_order`) | media | M | La FAQ semilla promete "dime tu dirección y te confirmo si llegamos" y hoy no hay con qué verificarlo |
| Import CSV de menú (ver H-19) + KPIs de pedidos en el panel | media | M | Activación de un restaurante con 60 platos; el dueño de delivery ve su negocio y no solo reservas de mesa |

*Menores:* heredar la moneda del item en vez del default COP (`restaurants.service.ts:322-332`); `kitchenInProgress` excluye `completed` cuando el terminal real es `delivered`; estados cancelables de `cancel_order` alineados con el dominio (acepta dos estados inexistentes); `tools.restaurants` en `tpl_restaurante_reservas`; ETA real desde `prep_time_minutes`; compensación en `createOrder` si falla un item; alta manual de pedido telefónico; `modifiers` en el schema del tool.

### 4.7 El resto, agrupado

**Veterinaria** — recall de vacunas (el sabor más barato de H-3, y la promesa visible del alta); `isUpToDate` honesto en `get_vaccination_status` (con 0 vacunas hoy devuelve `true`, `ai-tool-executor.service.ts:1964-1970`); KPI + lista filtrable de "vacunas vencidas" en `/admin/pets` (la query ya existe, solo la ve el super admin); habilitar treatment-plans para vet (1 línea en `contacts/[leadId]/page.tsx:50` + rama del bootstrap); alta de mascota desde `/admin/pets` (hoy galería sin botón); sumar las `urgentSignals` del triage a los handoffTriggers sembrados. Ver también H-6 (petId en la cita) y D11 (research antes de invertir).

**Automotriz** — encender el gate de inventario (H-17) es el prerequisito de todo lo demás; campo de fotos en el modal de vehículos (el REST ya acepta `photos[]`, `vehicle-inventory.service.ts:190`, y el render está listo — en autos usados la foto **es** el producto); quitar "financiación" de los handoffTriggers y backfillear (H-4); test drive ligado al vehículo (H-6); sub-tipo `taller` → `tpl_automotriz_servicio` (H-7); captura estructurada de financiación y retoma → custom attributes del lead; import CSV (H-19); aggregator + activation-gap ausentes (`vertical-analytics.service.ts:119-130,248`).

**Education** — habilitar la escritura de inscripciones en `/admin/courses` (inscribir walk-in + marcar pagado; `api.createEnrollment`/`updateEnrollment` tienen **0 llamadores**, `api.ts:1648-1651` — hoy el dinero queda `pending` para siempre); ejecutar la fusión de catálogos y matar `/admin/catalog/courses` (misma tabla física, es fusión de UI sin migración de datos; rescatar `brochure_url` y `code`); decrement-first en `enrollStudent` (H-10); normalizar `virtual/hibrido` → `online/hybrid` (los cursos de la página legacy son invisibles para `get_courses`); sembrar 1-2 cursos y una cohorte demo por sub-tipo; recordatorio de inicio de cohorte y re-matrícula (H-3). Placement test y cobro de matrícula: 🔒D3/D14.

**Seguros** — modal "Emitir póliza" en la tab Pólizas (POST existe, 0 llamadores: 3 de las 6 tools operan contra una tabla que el producto no puede poblar); revivir `cancel_quote` (exige un status `pending` que nadie escribe; las quotes nacen `sent`, `insurance.service.ts:162` — la tool falla el 100% de las veces); gatear `check_policy_status`/`file_claim` por contacto del chat (hoy exponen titular, prima y fechas con solo adivinar un número de póliza) y verificar con H-21; emitir `insurance_claim.filed` + listener; cron de vencimiento de pólizas (sabor de H-3, el activo del corredor); mover la etapa "Renovación" antes de la terminal "Póliza emitida"; sembrar planes por sub-tipo; enviar el email `insurance_quote_confirmation` que ya está sembrado en 4 idiomas y tiene **0 senders**; accept/reject de cotizaciones (endpoint existente, 0 llamadores).

**Servicios del hogar** — sacar las palabras de emergencia de los handoffTriggers y escalar POST-tool (crítico, S: hoy "fuga de gas" escala **sin** registrar el request con dirección, y el listener que construimos nunca dispara en su caso nominal — es el sabor de H-4 en esta vertical, `vertical-definitions.ts:669` + `persona.service.ts:2315`); quitar de Carlos la regla de "cotizar con rangos entre $X y $Y" (XS — sin tarifas en ninguna tabla, toda cifra que dé el bot es alucinada **por instrucción explícita**); `list_my_requests` por contacto + ownership en `check_request_status` (S — "¿ya viene el técnico?", el segundo mensaje del rubro, hoy exige un UUID que el cliente nunca vio, y sin ownership es fuga de datos); ampliar el listener a `urgency=alta` + campana WebSocket al inbox (S); directorio mínimo de técnicos que escriba `assigned_technician_id` (S — hoy siempre NULL, el despacho es texto libre); engordar las rules pt/fr/en del registry (XS — el tenant extranjero recibe una frase donde el español tiene 6 reglas operativas).

**Pet_services** — sembrar "Guardería diurna" con `durationType: 'open'` (alta/XS: 480 min fixed hoy deja al negocio entero sin turnos de nada, baños incluidos, hasta las 16:00); hacer honesto `check_daycare_availability` — rango checkIn→checkOut, filtro por categoría, `blocked_dates` y `max_concurrent` (S: su propio schema promete `checkOut` y `petSize` y el handler los ignora); unificar la fuente de capacidad entre ese check y `create_appointment` (S — hoy el bot afirma cupo que no puede reservar en el mismo turno); etapa terminal "Cancelado" (XS — sin ella la pérdida no existe como concepto y el win/loss queda cojo); quitar 'enfermedad' de los handoffTriggers (XS — rompe la reserva a mitad por una palabra que el propio bot indujo); documentar las dos salidas del pet shop híbrido (XS, cero ingeniería).

**Retail** — 🔒D13 gobierna la apuesta grande, pero hay trabajo que no depende de ella: eliminar los flags fantasma `syncOrders` y `cartAbandonmentEnabled` (alta/XS — dejar de vender lo que no corre); ítem de sidebar de Ofertas (XS — hoy la IA puede listar ofertas que no hay dónde cargar); página `settings/integrations/ecommerce` (crítica/M — la integración Shopify/Woo está marcada ✅ en el análisis competitivo y **no existe para el tenant**); webhooks Shopify/Woo + sync paginado con cron (L — hoy es una foto vieja de 250 productos); carrito abandonado con webhook `checkouts/create` (L — la tabla ya modela el circuito entero y `handleCartAbandonment` tiene 0 llamadores; es el caso estrella del comercio conversacional); checkout conversacional (L) **solo si D13 sale en SÍ**.

**Fotografía** — listener de `photo_session.requested` (alta/XS: emisor único, 0 `@OnEvent` — el fotógrafo no se entera de una cotización nueva sin abrir la página); sumar las sesiones **señadas** al conteo de `check_date_availability` (S — hoy hay doble booking entre los dos caminos de reserva, y la seña es el bloqueo correcto del rubro); hacer alcanzable el circuito de entrega en `/admin/photo-sessions` (S — página 100% read-only, `create/update/deliver` con 0 llamadores); `send_portfolio` sobre el módulo media con tag 'portfolio' (S — responde "¿me mostrás tu trabajo?", la primera pregunta real, y cumple la promesa del alta); ampliar el sábado sembrado o marcar la boda como `open` (XS — el servicio más caro del rubro es inagendable justo el día en que ocurren las bodas).

**Finanzas** — `transitionRules` en las 6 etapas (alta/S: en un rubro regulado, una tarjeta en "Pre-aprobación" es una afirmación de hecho sobre un proceso crediticio); quitar la captura de cédula/RFC de las dos plantillas (XS — elimina la contradicción con el contrato L1, que hoy deja el comportamiento a merced del modelo); 5 FAQs propias en el estilo prudente del registry (S — una financiera responde hoy sobre su política de devoluciones); 2 KPIs de solicitudes contra `opportunities` (S); modelar el producto financiero reusando services/catalog con rangos (M) y simulador de cuota determinista —aritmética, no asesoría— (M): las dos juntas responden la pregunta del mensaje 2 sin cruzar el L1.

**Servicios profesionales** — reescribir la regla del "portal seguro" en `tpl_legal_seguimiento` (alta/XS: le promete al cliente final un producto que no tiene una sola pantalla); `transitionRules` en 3 etapas (S — corta las dos mentiras del tablero: "preguntar honorarios → Propuesta" y "decir reservar → En proceso", esta última inducida por el propio motor de reservas); el caso como identificador legible + `get_case_status` sobre `opportunities` (M — el 4º objetivo del alta deja de ser texto sin maquinaria); reemplazar los 3 handoffTriggers muertos (XS); 5 FAQs por sub-tipo dominante (S — es el ejemplo que la propia matriz usó: "¿tienen política de devolución?" en un despacho jurídico); servicios y FAQs por sub-tipo en el bootstrap (S — hoy un contador y un arquitecto reciben los mismos 2 servicios).

**Technology** — reescribir los 8 handoffTriggers como keywords tipeables (alta/S: 6 de 8 están muertos por construcción — dos son comparaciones numéricas evaluadas por substring); `transitionRules` mínimas en el embudo B2B (S — el auto-progress mueve a Demo a quien dijo "me interesa" y a Propuesta a quien preguntó el precio, en la única vertical que existe para medir un embudo); 5 FAQs propias (S — hoy le pregunta la dirección física a una empresa remota que vende suscripciones); KPIs B2B propios (M — pipeline ponderado, demos, win rate, ciclo, en vez de "Leads Hoy / Costo IA"); `labelOverrides` mínimos y borrar el `hiddenItems` no-op (XS, higiene).

**Otro** — abrir el catálogo genérico al fallback (alta/S: `inventory` y `orders` están allow-listeados a retail, así que la ferretería, la papelería, la imprenta y el taller de bicicletas no tienen dónde cargar productos — es el ítem que más negocios reales destraba de esta sub-sección); resolver la contradicción de agenda (S — la plantilla por defecto ordena "agenda una reunión" y nace sin la herramienta para hacerlo); reemplazar los handoffTriggers (S — dos sombreados y 'emergencia' sobre-dispara con "no es una emergencia").

---

## 5. Lo que NO vamos a hacer, y por qué

Esta sección vale tanto como el backlog: sin ella, alguien retoma en tres meses una inversión que ya se descartó con razones.

**Código que se borra (matar, no arreglar).**
- `searchVehiclesForAI` y su endpoint sombreado `GET :tenantId/search` — el `@Get(':tenantId/:vehicleId')` declarado antes (`vehicle-inventory.controller.ts:52`) hace explotar el cast `::uuid`: devuelve 500 siempre. Además arrastra un bug de centavos en `:284`, listo para revivir mal. El executor usa su propio SQL corregido.
- `test_drives` — muere en favor de `appointments` + `metadata.vehicleId` (H-6). Hoy tiene un solo escritor alcanzable (curl), sin transiciones de estado, con una tab read-only que la hace parecer una feature. 🔒(confirmar con el dueño antes de tocar el circuito de venta).
- `/admin/catalog/courses` — página legacy sobre la misma tabla física que `/admin/courses`, con un botón "Editar" sin `onClick`. Se fusiona y se borra (expand-contract: primero rescatar `brochure_url`/`code` y apuntar campañas y ofertas al endpoint nuevo, después retirar POST/PUT legacy).
- `labelOverrides.catalog` de inmobiliaria y de automotriz — apuntan a un `labelKey` que `AppSidebar` nunca encuentra; el ítem real ya se llama bien.
- Restaurantes en las filas `inventory`/`orders` del sidebar — config muerta que pierde contra `hiddenItems` (`vertical-definitions.ts:320`).
- `vehicle_inquiries` — o se escribe desde `get_vehicle_details`/`send_vehicle_image`, o se borra en el próximo ciclo expand-contract. Hoy: 0 escritores, 0 lectores, solo DDL y docs. 🔒(decisión del dueño).

**Integraciones: se congela el write-path de todas.** Cliniko (nunca probada en vivo; el rubro LatAm usa Dentalink/DentalWeb), Mindbody (no hay evidencia de que sea el software del gym LatAm de 5-25 empleados; la pregunta quedó formalmente abierta), Toast (elegido como especialista global, no por presencia LatAm), Guesty/Lodgify (no se escriben adapters hasta tener el case study de Hostaway). Lo único que se hace es H-18: cron de re-sync y señal de frescura, para que lo que ya existe no mienta. *Regla de fondo:* "integrar, no profundizar" — y antes de integrar, saber con qué (D11).

**Sindicación a portales inmobiliarios: no.** La doctrina es **importar, nunca publicar**. Y ni siquiera el import arranca antes de un spike que valide los formatos reales de FincaRaiz/Metrocuadrado/Inmuebles24, que hoy no están documentados en ningún lado.

**WhatsApp Flows para pre-intake: todavía no.** Alcanza con preguntas de intake como paso post-booking del engine. Flows es el camino largo para el mismo resultado.

**Recurrencia de reservas (pet_services y servicios_hogar): diferida.** Los dos dossiers la piden y los dos recomiendan **no** construirla hasta ver demanda comprobada.

**Historia clínica completa en veterinaria: no.** Es pasar de "agenda + carné" a software clínico, y eso solo se decide después del research del rubro (D11).

**E-commerce, apuesta profunda: no ahora** (D13). Y el sub-tipo `marketplace` de retail se quita del selector: es multi-vendor, no PYME.

**GTM comercial en verticales sin research: no se financia.** Automotriz, veterinaria, pet_services y servicios_hogar quedan en mantenimiento hasta que exista evidencia de demanda. Los arreglos baratos sí se hacen (son costura, no inversión); las apuestas no. Fotografía se mantiene explícitamente sin GTM: 0 menciones en los tres docs de mercado.

**Pet_services no se fusiona con veterinaria.** Se comparte el *módulo* (`pets` ya vive en el schema de todo tenant y prestarlo son ~3 líneas), no la vertical. Fusionarlas exigiría sub-tipos médico/no-médico reales en una plataforma donde los sub-tipos son cosméticos — que es justamente lo que H-7 recién viene a arreglar.

---

## 6. Secuencia sugerida

### Ola 1 — dos semanas: destrabar lo que ya está construido ✅ COMPLETA (jul 2026)

Horizontales XS/S de máxima palanca, más los P0 sueltos que no dependen de nada.

- ✅ **H-1** F1 capacidad por servicio en la ruta de chat + campo en la UI de servicios (+4 JSON i18n).
- ✅ **H-5** Yield vertical del motor de citas.
- ✅ **H-4** Consumir `shouldHandoff` post-tool + depurar y **backfillear** los triggers por substring.
- ✅ **H-7** El sub-tipo con consecuencias: mapa `bySubType` completo + `subType` al L3 (la rama de seed se reparte entre las olas).
- ✅ **H-11** `enableSimpleTool` sobre cualquier agente, no solo el default (XS).
- ✅ **H-14** `blocked_dates` en el `checkAvailability` del executor.
- ✅ **H-15** `appointment_required` sobre las 5 tablas reales + `order_required` nuevo (se adelantó de Ola 2 porque cayó en el mismo archivo que H-14).
- ✅ **H-17** Gates de inventario por cantidad (D4 aplicado según su recomendación). **Mueve la matriz de planes** — ver nota en el commit `9c56fbe5`.
- ✅ **P0 sueltos:** alta de miembros de gimnasio; listener de pedidos de restaurante; modal de emisión de póliza y `cancel_quote` revivida en seguros; escritura de inscripciones en education; `isUpToDate` honesto en vet; gate por contacto en `check_policy_status`/`file_claim`.

**Hallazgos nuevos, encontrados al ejecutar** (no estaban en el análisis original):

- La fuga de `check_policy_status` tenía **gemela en veterinaria**: `get_vaccination_status` devolvía la historia clínica de cualquier mascota con solo pasar su id. Gateada igual. → *El gate por propiedad es un patrón sistémico, no dos casos: cualquier tool que reciba un id de objeto y no lo cruce contra el `contactId` de la conversación es la misma fuga. Auditar el resto en Ola 2.*
- `cancel_enrollment` escribía un status (`'cancelled'`) fuera del vocabulario de su tabla y perdía el motivo en silencio (`cancellationReason` no está en el mapa de `updateEnrollment`). Misma clase que el `pending`/`sent` de `cancel_quote`: **desalineación de vocabulario entre quien escribe y quien valida**.
- `getPlanLimit` devuelve `0` para una clave ausente, y el seed de planes es create-only. Toda feature-key nueva **exige migración de backfill** o bloquea a los tenants existentes.

**Criterio de listo:** un salón con 4 sillas, una clínica con 3 consultorios y un restaurante con 10 mesas reciben más de una reserva por franja. Un gym puede dar de alta un miembro y sus 6 tools responden. Un pedido de restaurante llega a alguien. "¿Ofrecen financiación?" no escala a humano. Un tenant trial de turismo o automotriz puede cargar su primer objeto.

### Ola 2 — los horizontales ✅ COMPLETOS (jul 2026); quedan las cuatro verticales

- ✅ **H-3** Evaluador temporal transversal (D2 aplicado). Se implementaron **nueve** sabores, no dos: la lógica de buscar/deduplicar/respetar-opt-out/disparar es idéntica para todos, así que se declararon como datos (`temporal-flavors.ts`) y sale gratis el resto. Incluye `inactivity`, que enciende las tres plantillas que `seed-templates.ts` ya sembraba y **nadie evaluaba**.
- ✅ **H-2** F2: `staffId`/`assigned_to` persistido + nombre del profesional en las franjas y en el resumen de confirmación.
- ✅ **H-6** Objeto de negocio ligado a la cita (listing / pet / vehículo), con la etiqueta legible en el evento de calendario.
- ✅ **H-8** Checklist con href y check propios por vertical.
- ✅ **H-9** KPIs del home contra las tablas reales.
- ✅ **H-10** Atomicidad de cupos en gym, tours y education.
- ✅ **H-15** `appointment_required` / `order_required` (adelantado a Ola 1).
- ✅ **H-12** Merge de rules (D6 aplicado) y ✅ **H-13** localización de plantillas verticales.
- ✅ **Verticales:** belleza (sub-tipo `boutique` sin agenda + `treatments` en spa/estética + `tools.catalog` en la plantilla de productos + rebooking por servicio), salud (dental + recall por servicio + recuperación de cancelaciones), inmobiliaria (visita ligada al listing + `assigned_to` en cascada + panel de zonas), gimnasios (alta de miembros + clases con recurrencia + lista de espera + planes sembrados).

### Barrido adicional sobre el backlog vertical (§4), jul 2026

Fuera de las cuatro verticales de la ola, se cerraron los ítems de **alta severidad y esfuerzo XS/S** del resto:

- **`otro`** — `inventory`/`orders` abiertos al fallback + `tools.catalog`. Es el ítem que más negocios reales destraba: la ferretería, la papelería y la imprenta no tenían dónde cargar un producto.
- **Plantillas que ordenaban mentir** — se quitó "cotiza con rangos ($X a $Y)" de servicios_hogar (no hay tabla de tarifas: toda cifra era inventada *por instrucción*), la promesa del "portal seguro" inexistente (×2), y la captura de cédula/DNI/RFC de **seis** plantillas que contradecían el contrato L1.
- **`handoffTriggers` muertos por construcción** — technology (incluida una comparación numérica como palabra clave) y servicios_profesionales.
- **pet_services** — "Guardería diurna" a `durationType: 'open'`: 480 min fijos tapaban la agenda entera del día.
- **fotografía** — listener de `photo_session.requested` (1 emisor, 0 oyentes).
- **restaurantes** — panel de promociones (3 endpoints sin llamador; `get_promotions` respondía vacío siempre).
- **servicios_hogar** — `list_my_requests`: "¿ya viene el técnico?" exigía un UUID que el cliente nunca vio.
- **Genérica** — recuperación de cancelaciones (3 horarios alternativos en el mismo turno) para todas las verticales de agenda.

**Hallazgos nuevos de esta ola:**

- **La fuga de acceso físico.** El barrido del gate de propiedad (ver Ola 1) encontró que `get_check_in_instructions` entregaba el código de la puerta y la dirección exacta de cualquier alojamiento a quien nombrara su `propertyId` — y `list_properties` devuelve el catálogo entero de ids. No era una fuga de datos: era seguridad física de una casa que en ese momento podía estar ocupada por otro huésped.
- **El KPI no estaba aproximado, estaba vacío.** Las cuatro etiquetas re-etiquetadas colgaban de `appointments`, una tabla que esas verticales no usan para eso. Un gym con 30 reservas leía "Reservas Clases: 0" en la primera pantalla del panel.
- **El checklist certificaba lo incorrecto.** Peor que no guiar: el tilde verde sobre el PDF en la KB le quita al dueño el motivo para seguir buscando por qué su menú no funciona.
- **`H-2` iba a introducir su propio bug.** Al agregar `staffId` al estado había que limpiarlo en los cuatro sitios donde se resetean las franjas; sin eso la profesional de la fecha vieja se filtraba a la cita nueva.
- **Todo `@Cron` corre dos veces** (API y worker cargan el mismo `AppModule` con `ScheduleModule`). Es inocuo para los crons idempotentes que ya existían; para uno que le escribe a clientes finales hizo falta un lock explícito. **Vale auditar los ~46 crons con este criterio.**

**Criterio de listo:** una clínica ofrece "10:00 con la Dra. X" y persiste quién atiende. Un tutor recibe el recordatorio de vacuna sin que nadie lo dispare a mano. Una agencia sabe qué propiedad se muestra en cada visita y quién la muestra. Un dueño que sigue el checklist termina con su catálogo cargado en la tabla que las tools leen, no en un PDF de la KB. Ningún KPI del home cuenta citas haciéndose pasar por otra cosa.

### Ola 3 — lo que depende de decisiones *(pendiente)*

**Lo que queda del backlog vertical y por qué.** Todo lo que sobrevive a la ejecución de jul 2026 cae en tres cajones, ninguno de ellos "se nos pasó":

1. **Bloqueado por una decisión del dueño** — cobro al cliente final (D3), partición belleza/moda (D5), integraciones (D10), turismo (D12), retail (D13), research (D11).
2. **Esfuerzo M/L con dependencia real** — import masivo (H-19), galería por contacto (H-23), carrusel (H-24), webhooks de e-commerce, checkout conversacional, notificación proactiva de estado de pedido, zonas de entrega con tarifa.
3. **Higiene de bajo impacto** — `labelOverrides` de technology, textos por sub-tipo en turismo, moneda heredada del ítem en restaurantes, y la fusión de `/admin/catalog/courses`.



- **H-22** Cobro conversacional (🔒D3): arrancar por el spike de credenciales por-tenant; después seña de belleza/salud, matrícula de education, anticipo de tours, pedido pago de restaurantes.
- **H-19** Import masivo como componente compartido (5 verticales).
- **H-21** Identidad determinista con OTP (🔒D8) y **H-18** cron de integraciones (🔒D10).
- **H-20** `appointment.completed` + secuencias post-visita; **H-23** galería por contacto; **H-24** carrusel y contexto de story.
- **Research financiado** (🔒D11): mapa POS/delivery LatAm y veterinaria.
- **Turismo** (🔒D12): Hospitality Add-on + discovery de design partner + Hostaway operable.

**Criterio de listo:** un cliente final paga una seña por WhatsApp y la cita queda marcada como señada. Un tenant carga 200 miembros, 40 propiedades o 60 platos en minutos. Una aseguradora verifica identidad sin pedir cédula. Y hay una tesis escrita —no fe— detrás de la próxima vertical en la que se invierta.

---

## 7. Qué no está verificado

**Cobertura de la extracción — cerrada.** La primera pasada de consolidación dejó 8 verticales (servicios_hogar, pet_services, retail, fotografía, finanzas, servicios profesionales, technology y otro) resumidas en un párrafo: los lectores **sí** habían extraído sus ítems —162 en total, 15 a 28 por vertical— pero no llegaron a la redacción de §4.7. Se recuperaron de los resultados de extracción y se escribieron sus sub-secciones completas. Las 18 verticales están cubiertas. Lo que sigue sin estar es la **profundidad pareja**: las 6 primeras tienen tabla propia con severidad y esfuerzo por ítem, las 12 restantes van en prosa priorizada — si alguna de esas 12 se elige para invertir, conviene expandirla al formato de tabla antes de planificarla en detalle.

**Ningún ítem pasó por ronda adversarial.** Los dossiers son lectura de código de una sola pasada. La evidencia `archivo:línea` es sólida (se puede abrir y mirar), pero la *conclusión* de comportamiento no fue reproducida en runtime. Antes de tocar, conviene confirmar en producción:

- **H-1 / H-2.** El diagnóstico "capacidad 1 por franja para todo el local" se sostiene en la lectura de `ai-tool-executor.service.ts:1039`, pero no hay una prueba registrada de dos reservas paralelas fallando. Es el ítem más caro del plan por número de verticales afectadas: vale media hora de prueba en vivo antes de la cirugía.
- **H-3.** "Grep `inactivity` fuera de `seed-templates` = 0" es evidencia negativa: prueba que no hay código que *mencione* el trigger, no que no exista otra ruta que lo evalúe. Confirmar con una automation sembrada y un contacto inactivo real.
- **H-4.** El orden substring-antes-de-IA está claro en el código, pero cuántas conversaciones reales escalan de más es desconocido. Un conteo sobre handoffs de los últimos 30 días diría si es un problema de producción o de laboratorio.
- **H-13.** Que `localizeVerticalTemplates` colapse las plantillas fuera de español se deduce de `templates[0]`; hay que verlo con un tenant `pt` real antes de invertir una M.
- **Ítems de un solo dossier sin `archivo:línea`.** Galería por contacto (H-23), carné de vacunas por foto, hospitalización con partes diarios, historia clínica ligera, recall multi-mascota, import CSV de vehículos, expediente de retoma. Están marcados en los dossiers como "sin archivo:línea" — son propuestas, no hallazgos. Ninguno entra en Ola 1 o 2 por eso.
- **Afirmaciones de mercado.** Los números de `market-research-latam.md` y `competitive-analysis-2026-q2.md` (rankings, WTP, "ningún competidor ofrece X") son de Q2 2026 y no se re-verificaron en esta ronda. Las decisiones D9, D12 y D13 se apoyan fuerte en ellos.

**Lo que sí está verificado:** todo lo que se excluyó por estar ya implementado (bootstrap canónico, merge de tools, `availability_slots`, `tools.vehicles`, tabla `courses`, `duration_type 'open'`, forecast con `is_terminal`, etc.) fue confirmado como desplegado o commiteado antes de escribir este plan.


---

## 8. Cierre de ejecución — jul 2026

Auditoría de brecha sobre **todas** las fuentes (los 24 horizontales, el backlog de las 18 verticales, la auditoría de onboarding, la de madurez y los cabos sueltos), con cada ítem verificado contra el código y cada "pendiente" sometido a un refutador. **240 ítems auditados.**

### Lo que se cerró además de las Olas 1 y 2

- **H-16** detector de activación: estaba definido **dos veces** y ya había divergido (turismo contaba `tour_packages` y reportaba `missing:'properties'`); faltaban automotriz, retail y `otro`. Una sola definición en `common/utils/vertical-catalog.util.ts`.
- **H-20** `appointment.completed` + `runRulesForTrigger` genérico + plantilla post-visita sembrada.
- **`transitionRules`** en finanzas, servicios profesionales y technology (9 etapas): los tres embudos movían tarjetas sin ninguna evidencia.
- **Seguridad**: los 9 endpoints que mutan el agente estaban abiertos a cualquier usuario del tenant (`RolesGuard` permite por defecto sin `@Roles`).
- **Disponibilidad**: guardería y fotografía compartían un handler que ignoraba el rango, la capacidad real y `blocked_dates`.
- **Circuitos sin puerta**: entrega de fotografía, conexión de tienda e-commerce, ítem de Ofertas en el sidebar.
- **Higiene**: flags fantasma de e-commerce, regla que contradecía su propio fix, `handoffTriggers` muertos, reglas pt/fr enanas, etapa terminal de pérdida en pet_services, `hiddenItems` no-op.

### Hallazgos fuera del plan, encontrados al ejecutar

1. **28 de 48 crons producían efectos duplicados en producción.** La API y el worker cargan el mismo `AppModule` con `ScheduleModule`, así que todo `@Cron` corría dos veces. Cero de los 28 pudo refutarse. Resuelto con `CronLockService` (falla abierto, no libera al terminar, y permite fijar qué proceso gana cuando el resultado tiene que llegar a un gateway WebSocket).
2. **El worker archivaba conversaciones a almacenamiento efímero y después borraba de Postgres.**
3. **9 de 29 acciones de automatización sembradas no existían** en el motor y se registraban como `success`; y había un **segundo motor muerto** que las implementaba con otro vocabulario, lo que hacía invisible el problema.
4. **Cuatro desajustes de vocabulario de la misma familia**: `pending`/`sent` en cotizaciones, `cancelled`/`dropped` en inscripciones, `change_stage`/`update_stage` en acciones, `delay`/`delay_seconds` en retardos. Dos partes del sistema nombrando distinto la misma cosa y fallando en silencio.
5. **Una migración de tenants sistemáticamente rota salía en deploy verde.**

### Lo que queda, y por qué

| Motivo | Ítems |
|---|---|
| **Bloqueado por decisión del dueño** | D3 cobro al cliente final (H-22, checkout), D5 partición belleza/moda (sub-tipo `estetica`), D10 integraciones (H-18, Hostaway), D13 apuesta retail (carrito abandonado, webhooks), política de verificación de email |
| **Esfuerzo M/L con dependencia real** | H-19 import masivo, H-21 identidad con OTP, H-23 galería por contacto, H-24 carrusel, producto financiero + simulador de cuota, KPIs B2B propios |

### Segunda pasada — lo que se cerró después (jul 2026)

**Guardas de rol: 276 → 0.** Se auditaron las 249 rutas mutantes candidatas y quedaron todas resueltas: 237 con `@Roles` aplicado (82 permisivas, cuyo riesgo es estructuralmente nulo porque un guard de tres roles no puede bloquear a nadie; 155 verificadas contra `roles.ts` y contra el llamador real del dashboard) y 12 **bajadas a propósito** por sobre-restringir. El registro completo, con el motivo de cada baja, queda en `docs/role-guards-pending.json`.

Tres hallazgos de esa auditoría valen más que el conteo:

- **Canales se ensanchó en vez de cerrarse.** El sidebar los gatea por `canManageChannels` (solo admin), pero `/admin/page.tsx` deja entrar al supervisor por el checklist de onboarding y las páginas no se auto-gatean. Admin-only habría roto a usuarios que hoy funcionan.
- **Verbo mutante ≠ escritura.** `POST /knowledge/search` y `POST /knowledge/:t/feedback` son lecturas que el agente hace desde el inbox; cerrarlas habría roto la operación diaria. Quedaron abiertas.
- **La UI iba por detrás del backend.** Tres páginas (KB, agenda, banco de medios) traían un `const { user } = useAuth()` declarado y sin usar: mostraban los controles de edición a todos. Se gatearon KB y agenda; en medios se bajó la restricción porque `roles.ts` le da esa página a los cuatro roles y no existe capability que separe ver de editar — restringir habría sido inventar una regla que la spec no tiene.

**Contenido, ya no pendiente:**

- **FAQs propias** de finanzas (6), servicios profesionales (5) y technology (6). Las tres se construyen con `createGenericVertical` y heredaban las genéricas, que para una financiera son incorrectas ("¿tienen política de devolución?" sobre un crédito). Las respuestas respetan las reglas del agente en lugar de contradecirlas: una FAQ sembrada entra por RAG como hecho del negocio y pesa más que el prompt.
- **`POST verticals/:tenantId/reseed-content`**: el bootstrap corre una sola vez, así que todo contenido agregado después solo llegaba a tenants futuros. Re-siembra únicamente FAQs y servicios, que insertan con `ON CONFLICT DO NOTHING` y por lo tanto solo pueden agregar. No toca embudo, persona ni disponibilidad, cuyos seeds son de reemplazo.
- **`send_portfolio`** (fotografía): la pregunta que cierra la venta del rubro es "¿tienen fotos de trabajos anteriores?" y el agente solo podía describirlas. Sale del banco de medios por etiqueta, tope de 4, con caída de categoría al portafolio general. El marcador `_mediaToSend` ahora acepta lista.
- **Directorio de técnicos**: `assigned_technician_id` existía y no lo escribía nadie — el despacho pedía el nombre como texto libre. Ahora se elige de `staff_members`, con caída a texto libre si el directorio está vacío.
- **`get_case_status`** salió del bucket bloqueado: la dependencia era "hace falta un id legible", y se disuelve igual que en servicios a domicilio — la tool no recibe parámetros y resuelve por el contacto. Devuelve el nombre de la etapa (no el slug) y una referencia corta que el cliente puede repetir por teléfono.
