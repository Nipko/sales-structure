# Requisitos del negocio (generado)

> **Generado** por `node packages/business-spec/bin/business-spec.cjs docs --write` desde `packages/business-spec/spec/*.yaml`.
> No editar a mano: la CI (`verify-artifacts`) falla si este archivo no coincide con la especificación.
> Formato: [business-requirements-format.md](business-requirements-format.md). Versión de la especificación: `1.0.0-rc.1`.

**95 requisitos** (51 del núcleo, 6 de plantilla de objeto instanciados 80 veces, 10 extras de objeto, 13 de perfil y 15 de dominio), 15 objetos, 29 perfiles, 9 dominios y 271 intenciones.

## Núcleo

| ID | Requisito | Nivel (regla) | Aplica si | Si falta | Predicado | Evaluación | Dónde se completa |
|---|---|---|---|---|---|---|---|
| `CORE.IDENTITY.NAME` | Nombre comercial del negocio | bloqueante (R1) | always | GAP | existe(display_name) y estado = confirmado y display_name ≠ slug técnico y ≠ 'Mi negocio' (valores por defecto del alta) | `custom` | /onboarding |
| `CORE.IDENTITY.DESCRIPTION` | Qué es y qué hace el negocio | bloqueante (R1) | always | NC+AV | existe(short) y válido(short) y estado = confirmado y audience no vacío | `custom` | /admin/settings/business-info |
| `CORE.IDENTITY.PROFILE` | Perfil efectivo, objetos habilitados y dominios | bloqueante (R1) | always | GAP | existe(subtype) confirmado y el mapeo subtipo→perfil resuelve y cuenta(objects_enabled, explícitos o default del perfil) ≥ 1 y todo hecho de dominio condicional del perfil declarado | `custom` | /onboarding |
| `CORE.IDENTITY.REGION` | País de operación, zona horaria, moneda e idioma base | bloqueante (R1) | always | GAP | operating_country, timezone y currency existen con origen declarado (no 'fallback') y country_pack resuelto | `custom` | /admin/settings/localization |
| `CORE.LOCATIONS.LIST` | Sedes y modalidad de atención | bloqueante (R1) | always | NC+AV | existe(modality) y (no incluye presencial o cuenta(locations con city y country válidos y confirmados) ≥ 1) | `custom` | /admin/settings/business-info |
| `CORE.LOCATIONS.ACCESS` | Cómo llegar, parqueadero, accesibilidad y amenidades del lugar | recomendado (R5) | modality_includes(presencial) | NC+AV | por sede: parking y accessibility existen (valor o vacío confirmado) | `confirmed_fields` {"fields":["parking","accessibility"]} | nuevo |
| `CORE.SERVICE_AREA` | Zona de cobertura (domicilio, servicio en sitio) | necesario (R4) · bloqueante (R2) si direct_commit_any([food_order, catalog_order, service_request]) | modality_includes(a_domicilio) or delivery_offered | PREG | cuenta(zones válidas y confirmadas) ≥ 1 y existe(outside_zone_policy) | `confirmed_fields` {"fields":["zones[]","outside_zone_policy"]} | nuevo |
| `CORE.DELIVERY.TERMS` | Condiciones de entrega, envío o recogida | necesario (R4) · bloqueante (R2) si direct_commit_any([food_order, catalog_order]) | delivery_offered | NC+AV | existe(methods) y existe(cost) y existe(eta) y estado = confirmado | `confirmed_fields` {"fields":["methods[]","cost","eta"]} | /admin/settings/policies (tipo shipping, texto) |
| `CORE.HOURS.REGULAR` | Horario habitual por día (fuente única) | bloqueante (R1) | always | NC+AV | 7 días declarados, válido(weekly_hours), estado = confirmado y sin_contradicción con config.hours ni con la agenda (§7.3) | `custom` | /admin/settings/business-hours |
| `CORE.HOURS.HOLIDAYS` | Qué hace el negocio en festivos del país | necesario (R4) | not hours_always_open | NC+AV | existe(default_rule) confirmado para el año en curso y no_caducado | `custom` | nuevo |
| `CORE.HOURS.EXCEPTIONS` | Cierres y horarios especiales puntuales (vacaciones, temporada) | recomendado (R5) | always | NC+AV | lista revisada (valor o vacío confirmado) en los últimos 90 días | `value_or_empty` {"max_age_days":90} | nuevo |
| `CORE.HOURS.BY_SERVICE` | Horarios distintos por servicio o área (cocina, check-in, urgencias, atención humana) | recomendado (R5) | always | NC+AV | vacío confirmado, o cuenta(entradas) ≥ 1 y todas válidas | `value_or_empty` | nuevo |
| `CORE.CONTACT.CHANNELS` | Teléfono, WhatsApp, correo, web y redes | necesario (R4) | always | NC+AV | cuenta(contact_point válidos y confirmados) ≥ 1 o vacío confirmado | `custom` | /admin/settings/business-info |
| `CORE.CONTACT.SPECIAL` | Reseñas, empleo, proveedores y portafolio | recomendado (R5) | always | HUM | valor o vacío confirmado | `value_or_empty` | nuevo |
| `CORE.LANGUAGES.SERVED` | Idiomas de atención (agente y personas) y traducción del contenido | necesario (R4) | always | NC+AV | human_languages confirmado y existe(content_source_language) | `confirmed_fields` {"fields":["human_languages[]","content_source_language"]} | /admin/settings/localization |
| `CORE.OFFER.ITEMS` | Catálogo activo (contrato común de ítem) | bloqueante (R1) | always | NC+AV | por cada objeto habilitado: cuenta(ítems activos, confirmados y no sembrados-sin-editar) ≥ 1 | `custom` | según objeto: /admin/service-catalog, /admin/catalog, /admin/menu, /admin/properties, /admin/tours, /admin/listings, /admin/courses, /admin/memberships, /admin/insurance, /admin/vehicles |
| `CORE.OFFER.PRICE_MODEL` | Precio por ítem con tipo de precio y estado | bloqueante (R1) | always | NC+AV | **bloqueante:** cuenta(ítems activos con precio confirmado o price_type = a_cotizar) ≥ 1 · **necesario:** todos(ítems activos, existe(price_type)) y cuenta(ítems activos con precio de estado ejemplo) = 0 | `custom` | pantallas de catálogo de cada objeto |
| `CORE.OFFER.ITEM_DETAILS` | Atributos, incluye/excluye, duración, modalidad e imágenes por ítem | necesario (R4) | always | NC+AV | por objeto: proporción de ítems activos con description confirmada y, si el objeto declara includes/excludes, ambas con valor o vacío confirmado = 100 % (parcial si < 100 %). Los campos required se evalúan solo en OBJ.<x>.CATALOG (un hueco, no dos). | `custom` | pantallas de catálogo |
| `CORE.OFFER.NOT_OFFERED` | Lo que el negocio declara que NO hace | necesario (R4) | always | NC+AV | lista revisada: valor o vacío confirmado | `value_or_empty` | nuevo |
| `CORE.OFFER.FEES` | Cargos adicionales e impuestos generales | necesario (R4) · bloqueante (R2) si object_enabled(lodging_booking) or object_enabled(rental) | always | NC+AV | valor o vacío confirmado | `value_or_empty` | nuevo |
| `CORE.OFFER.PROMOTIONS` | Promociones vigentes | recomendado (R5) | always | NC+AV | valor o vacío confirmado y no_caducado | `custom` | /admin/catalog/offers, promociones de /admin/menu; cupones de la plataforma: /admin/coupons |
| `CORE.OFFER.RECOMMENDATION_RULES` | Criterios del negocio para recomendar | recomendado (R5) | always | PREG | valor o vacío confirmado (vacío = sin criterio propio: el agente compara y pregunta) | `value_or_empty` | nuevo |
| `CORE.OFFER.CURRENCY_CONVERSION` | Política de conversión de moneda | recomendado (R5) | always | NC+AV | default aceptado o configurado | `default_accepted` | nuevo |
| `CORE.PAYMENT.METHODS` | Medios de pago aceptados | bloqueante (R1) | always | NC+AV | cuenta(methods confirmados) ≥ 1 | `count_min` {"path":"methods","min":1} | nuevo |
| `CORE.PAYMENT.TIMING_DEPOSIT` | Momento del pago y regla de anticipo o depósito | necesario (R4) · bloqueante (R2) si payment_required_any | any_object_with_write or sells_goods | NC+AV | existe(when) y existe(deposit) (o 'ninguno') confirmados | `confirmed_fields` {"fields":["when","deposit"]} | nuevo |
| `CORE.PAYMENT.FINANCING` | Cuotas, financiación, convenios y aseguradoras aceptadas | recomendado (R5) | always | NC+AV | installments e insurers_accepted declarados (valor o vacío confirmado) | `confirmed_fields` {"fields":["installments","insurers_accepted"]} | nuevo |
| `CORE.PAYMENT.AGENT_COLLECTS` | El agente envía enlaces de pago o cobra depósitos | recomendado (R5) · bloqueante (R2) si payment_required_any | any_object_with_write | HUM | mode configurado; si ≠ no, proveedor verificado | `custom` | /admin/settings/integrations |
| `CORE.PAYMENT.INVOICING` | Factura o comprobante | recomendado (R5) | always | HUM | required_fields y sla confirmados, o 'no emitimos factura' confirmado | `confirmed_fields` {"any_of":[["required_fields[]","sla"],["no_invoice"]]} | nuevo (verificado: /admin/settings/fiscal es el perfil fiscal del tenant para la facturación de la plataforma: settings.fiscalData + public.fiscal_invoices) |
| `CORE.POLICY.CANCELLATION_CHANGES` | Política de cancelación, cambios, no-show y llegada tarde (general) | bloqueante (R2) · necesario (R4) si not any_reservable_direct | any_object_reservable | NC+AV | cancel.deadline y cancel.charge confirmados (o 'ninguno') y sin_contradicción con FAQs | `custom` | /admin/settings/policies |
| `CORE.POLICY.REFUND_RETURNS` | Reembolsos, devoluciones y cambios de producto | necesario (R4) · bloqueante (R2) si direct_commit(catalog_order) | sells_goods or has_prepayment | NC+AV | returns.deadline y refunds confirmados (o 'no aplica' confirmado) | `confirmed_fields` {"any_of":[["returns.deadline","refunds"],["not_applicable"]]} | /admin/settings/policies |
| `CORE.POLICY.WARRANTY` | Garantía | necesario (R4) | object_enabled(catalog_order) or profile_in([P16, P26, P27]) | NC+AV | duration confirmada para cada categoría activa (o global) | `custom` | /admin/settings/policies |
| `CORE.POLICY.HOUSE_RULES` | Reglas de admisión (menores, mascotas, fumar, código de vestimenta, sin cita) | recomendado (R5) | modality_includes(presencial) | NC+AV | cada topic de params.required_topics del override del perfil declarado (allowed + rule); sin override: valor o vacío confirmado | `custom` | nuevo |
| `CORE.POLICY.CONSUMER_RIGHTS` | Derechos legales del consumidor y avisos obligatorios del país | necesario (R4) | always | NC+AV | country_pack resuelto contiene consumer_rights | `platform_pack` {"field":"consumerRights"} · plataforma | n/a (plataforma) |
| `CORE.PRIVACY.NOTICE` | Aviso de privacidad y responsable del tratamiento | bloqueante (R1) | always | HUM | existe versión activa con controller confirmado | `confirmed_fields` {"fields":["controller","url_or_text"]} | /admin/settings/policies (privacy) + textos legales |
| `CORE.PRIVACY.DATA_REQUESTS` | Baja de mensajes, acceso y borrado de datos | necesario (R4) | always | HUM | responsable y sla confirmados | `confirmed_fields` {"fields":["access_delete.responsible","access_delete.sla"]} | /admin/compliance |
| `CORE.PRIVACY.CUSTOMER_MEMORY` | Guardar preferencias y condiciones del cliente entre conversaciones | recomendado (R5) | always | PREG | default aceptado o configurado | `default_accepted` | nuevo |
| `CORE.HANDOFF.TEAM` | Quién recibe los traspasos y cómo se le avisa | bloqueante (R1) | always | GAP | cuenta(assignees activos) ≥ 1 y cuenta(notify_channels verificados) ≥ 1; sin asignación explícita cuenta el usuario admin activo con correo verificado y aviso de traspaso activo (users.notification_preferences.categories.handoff) | `custom` | /admin/settings/notifications + /admin/users |
| `CORE.HANDOFF.HOURS_SLA` | Horario de atención humana, tiempos y qué se le dice al cliente | bloqueante (R1) | always | HUM | human_hours y sla_in_hours y sla_out_of_hours confirmados | `confirmed_fields` {"fields":["human_hours","sla_in_hours","sla_out_of_hours"]} | /admin/agent (afterHoursMessage) — horario humano y SLA: nuevo |
| `CORE.HANDOFF.ALWAYS_HUMAN` | Qué requiere siempre a una persona | necesario (R4) | always | HUM | defaults aceptados (lista revisada por el dueño) | `default_accepted` | nuevo |
| `CORE.HANDOFF.RETURN_TO_AI` | Espera máxima del humano y regreso a la IA | necesario (R4) | always | HUM | default aceptado o configurado | `default_accepted` | nuevo |
| `CORE.PENDING.ROUTING` | Consultas pendientes al negocio («lo averiguo») | necesario (R4) | always | HUM | canal verificado y sla confirmado (o default aceptado) | `confirmed_fields` {"fields":["channel[]","sla"]} | nuevo |
| `CORE.PROC.OFFER_ACCEPTANCE` | Ofertas que el agente puede hacer y su efecto al aceptarlas | necesario (R4) | always | HUM | derivado: cumple si hay al menos una salida (HUM) y cada oferta habilitada tiene su precondición cumplida | `custom` · derivado · plataforma | n/a |
| `CORE.PROC.FOLLOW_UP_STATE` | Estado de lo pendiente (traspasos, consultas, solicitudes) | necesario (R4) | always | HUM | existe el registro unificado de pendientes (plataforma) y ref_cumple(CORE.HANDOFF.TEAM) y ref_cumple(CORE.PENDING.ROUTING) | `custom` · derivado · plataforma | n/a |
| `CORE.COMPLAINT.PROCEDURE` | Procedimiento de quejas (ticket común) | necesario (R4) | always | HUM | sla confirmado (o default aceptado) | `confirmed_fields` {"fields":["sla"]} | nuevo (verificado: /admin/cases son casos profesionales sobre opportunities, no quejas) |
| `CORE.COMPLAINT.COMPENSATIONS` | Compensaciones que el agente puede ofrecer | recomendado (R5) | always | HUM | default aceptado | `default_accepted` | nuevo |
| `CORE.ACCOUNT.IDENTITY_DEFAULT` | Nivel de identidad por defecto para leer registros del cliente | necesario (R4) | any_object_with_write | PREG | default aceptado o configurado | `default_accepted` | nuevo |
| `CORE.SAFETY.EMERGENCY_BASE` | Número general de emergencias del país | necesario (R4) · bloqueante (R3) si domain_any([health, mental_health, veterinary, insurance, finance, home_safety]) | always | EXT | ref_cumple(CORE.IDENTITY.REGION) y el pack del operating_country contiene el número general | `custom` · plataforma | n/a |
| `CORE.SAFETY.FORBIDDEN_TOPICS` | Temas que el negocio no quiere que el agente trate | recomendado (R5) | always | HUM | valor o vacío confirmado | `value_or_empty` | /admin/agent |
| `CORE.KNOWLEDGE.FAQ_HYGIENE` | FAQs con dato, editadas y sin duplicar campos | necesario (R4) | always | NC+AV | ninguno(faqs publicadas con estado sembrado-sin-editar o sin dato o de perfil ajeno) | `custom` | /admin/knowledge/faqs |
| `CORE.KNOWLEDGE.SOURCES` | Web y documentos del negocio para el copiloto y el conocimiento narrativo | recomendado (R5) | always | NC+AV | cuenta(documentos accesibles y no caducados) ≥ 1 o vacío confirmado ('no tengo web ni documentos') | `custom` | /admin/knowledge |
| `CORE.KNOWLEDGE.AGENT_INSTRUCTIONS` | Instrucciones del agente coherentes con los datos (reglas, temas, disparadores) | necesario (R4) | always | NC+AV | ninguno(instrucciones activas cuyo requires no cumple) y ninguno(instrucciones que contradicen un valor confirmado) | `custom` | /admin/agent |

## Plantilla de objeto (`OBJ.*`)

| ID | Requisito | Nivel (regla) | Aplica si | Si falta | Predicado | Evaluación | Dónde se completa |
|---|---|---|---|---|---|---|---|
| `OBJ.*.CATALOG` | Campos obligatorios del catálogo del objeto | bloqueante (R2) · necesario (R4) si not writes(<O>) | object_enabled(<O>) | NC+AV | todos(ítems activos del objeto, campos required confirmados); parcial = proporción | `custom` | pantalla de catálogo del objeto |
| `OBJ.*.AVAILABILITY_SOURCE` | Fuente de disponibilidad del objeto | bloqueante (R2) · necesario (R4) si not direct_commit(<O>) | object_enabled(<O>) and availability_kinds(<O>) ≠ [] | NC+AV | source declarado; si motor_nativo: hay disponibilidad cargada para ≥ 14 días; si integración: sincronizada < 24 h; si estado_manual: no_caducado | `custom` | pantalla del objeto + /admin/settings/integrations |
| `OBJ.*.WRITE_MODE` | Cómo se reserva o pide, quién confirma y qué se recapitula | bloqueante (R2) | object_enabled(<O>) | HUM | mode confirmado; si ≠ none: required_fields y confirmation_terms válidos; si request: sla; si direct: ref_cumple(OBJ.<O>.AVAILABILITY_SOURCE) | `custom` | nuevo (hoy implícito por vertical y por herramientas habilitadas; /admin/procedures para SOP) |
| `OBJ.*.CUSTOMER_REQUIREMENTS` | Requisitos y documentos del cliente para el trámite | necesario (R4) | object_enabled(<O>) | NC+AV | por trámite principal del objeto: valor o vacío confirmado | `value_or_empty` | nuevo |
| `OBJ.*.CHANGE_RULES` | Modificar y cancelar el objeto | bloqueante (R2) | object_enabled(<O>) and WRITE_MODE ≠ none | HUM | agent_can_modify y agent_can_cancel declarados y terms resuelve (a CORE.POLICY.CANCELLATION_CHANGES si aplica; si es n/a, al policy_terms propio) con plazo o cancel_until_status y cargo confirmados | `custom` | /admin/settings/policies (texto) — reglas por objeto: nuevo |
| `OBJ.*.ACCOUNT_READ` | Lectura de los registros del cliente («mis reservas/pedidos») | necesario (R4) · bloqueante (R3) si domain_any([health, mental_health, insurance, finance, legal]) | object_enabled(<O>) and WRITE_MODE ≠ none | HUM | readable declarado; si true: status_vocabulary completo e identity_level ≥ mínimo del dominio | `custom` | nuevo |

| Plantilla | Objetos que la instancian |
|---|---|
| `OBJ.*.CATALOG` | appointment, food_order, catalog_order, lodging_booking, tour_booking, real_estate, enrollment, membership, insurance, service_request, rental, pet_boarding, photo_session, professional_case |
| `OBJ.*.AVAILABILITY_SOURCE` | appointment, food_order, catalog_order, lodging_booking, tour_booking, real_estate, enrollment, membership, service_request, rental, pet_boarding, photo_session |
| `OBJ.*.WRITE_MODE` | appointment, food_order, catalog_order, lodging_booking, tour_booking, real_estate, enrollment, membership, insurance, service_request, rental, pet_boarding, photo_session, professional_case, lead |
| `OBJ.*.CUSTOMER_REQUIREMENTS` | appointment, catalog_order, lodging_booking, tour_booking, real_estate, enrollment, membership, insurance, service_request, rental, pet_boarding, professional_case |
| `OBJ.*.CHANGE_RULES` | appointment, food_order, catalog_order, lodging_booking, tour_booking, real_estate, enrollment, membership, service_request, rental, pet_boarding, photo_session |
| `OBJ.*.ACCOUNT_READ` | appointment, food_order, catalog_order, lodging_booking, tour_booking, real_estate, enrollment, membership, insurance, service_request, rental, pet_boarding, photo_session, professional_case, lead |

## Extras de objeto

| ID | Requisito | Nivel (regla) | Aplica si | Si falta | Predicado | Evaluación | Dónde se completa |
|---|---|---|---|---|---|---|---|
| `OBJ.APPOINTMENT.STAFF` | Profesionales, qué atiende cada uno e idiomas | necesario (R4) · bloqueante (R2) si books_by_staff | object_enabled(appointment) and staff_count > 1 | NC+AV | todos(servicios activos, ≥1 profesional confirmado) | `custom` | /admin/users + /admin/service-catalog |
| `OBJ.FOOD_ORDER.ALLERGENS_DIET` | Alérgenos y etiquetas de dieta (o declaración de no garantía) | bloqueante (R3) | object_enabled(food_order) | HUM | mode declarado y (por_plato completo o declaración_general confirmada) | `custom` | /admin/menu (8 alérgenos fijos: gluten, lactosa, huevo, mariscos, pescado, maní, soja, frutos secos; etiquetas vegetariano, vegano, sin_gluten…) |
| `OBJ.FOOD_ORDER.MODIFIERS` | Modificadores, tamaños y extras con precio | recomendado (R5) | object_enabled(food_order) | NC+AV | valor o vacío confirmado y accepts_free_notes declarado | `confirmed_fields` {"fields":["groups","accepts_free_notes"]} | nuevo |
| `OBJ.LODGING_BOOKING.CHECKIN_RULES` | Check-in, check-out, llegada temprana/tardía y registro de huéspedes | bloqueante (R2) | object_enabled(lodging_booking) | NC+AV | check_in_from y check_out_until confirmados | `confirmed_fields` {"fields":["check_in_from","check_out_until"]} | /admin/properties/[propertyId] |
| `OBJ.REAL_ESTATE.COSTS` | Costos asociados (administración, predial, comisión, estudio) | necesario (R4) | object_enabled(real_estate) | NC+AV | commission confirmada por operación y admin_fee por listado de arriendo | `custom` | /admin/listings/[listingId] |
| `OBJ.SERVICE_REQUEST.EMERGENCY_SERVICE` | Atención de urgencias (24 h, recargo, tiempo de llegada) | necesario (R4) | object_enabled(service_request) and variant ∈ [home_service, repair_order] | EXT | offered declarado; si true: hours confirmadas | `custom` | nuevo |
| `OBJ.SERVICE_REQUEST.ESTIMATE_APPROVAL` | Aprobación explícita de presupuestos y trabajos adicionales | bloqueante (R2) | object_enabled(service_request) and (variant = repair_order or estimate_required) | HUM | who_can_approve y confirms declarados | `confirmed_fields` {"fields":["who_can_approve","confirms"]} | /admin/repair-orders |
| `OBJ.RENTAL.DAMAGE_INSURANCE` | Coberturas, deducible y procedimiento de daños | necesario (R4) | object_enabled(rental) | NC+AV | deductible y assistance_line confirmados | `confirmed_fields` {"fields":["deductible","assistance_line"]} | nuevo |
| `OBJ.PET_BOARDING.CARE_RULES` | Alimentación, medicación y emergencia veterinaria durante la estadía | bloqueante (R3) | object_enabled(pet_boarding) | NC+AV | feeding, medication y vet_emergency confirmados | `confirmed_fields` {"fields":["feeding","medication","vet_emergency"]} | nuevo |
| `OBJ.PHOTO_SESSION.RIGHTS_DELIVERY` | Tiempo y formato de entrega, derechos de uso | necesario (R4) | object_enabled(photo_session) | NC+AV | delivery_time y usage_rights confirmados | `confirmed_fields` {"fields":["delivery_time","usage_rights"]} | nuevo |

## Perfiles

| ID | Requisito | Nivel (regla) | Aplica si | Si falta | Predicado | Evaluación | Dónde se completa |
|---|---|---|---|---|---|---|---|
| `PROF.P01.TABLE_RULES` | Reglas de reserva de mesa | bloqueante (R2) · necesario (R4) si not writes(appointment) | profile_in([P01]) and object_enabled(appointment) | HUM | max_party_online y late_tolerance confirmados | `confirmed_fields` {"fields":["max_party_online","late_tolerance"]} | nuevo |
| `PROF.P01.EVENTS_GROUPS` | Eventos, salones y menú de grupo | recomendado (R5) | profile_in([P01]) | HUM | valor o vacío confirmado | `value_or_empty` | nuevo |
| `PROF.P03.HOLD_SPECIAL_ORDER` | Apartar productos y pedidos especiales | recomendado (R5) | profile_in([P03]) | HUM | valor o vacío confirmado | `value_or_empty` | nuevo |
| `PROF.P05.NEARBY` | Qué hay cerca y distancias | recomendado (R5) | profile_in([P05]) | NC+AV | valor o vacío confirmado | `value_or_empty` | nuevo |
| `PROF.P06.TRAVEL_DOCS` | Documentos de viaje, visa y seguro (remisión a fuente oficial) | necesario (R4) | profile_in([P06]) | NC+AV | por cada destino internacional activo: official_source_url | `custom` | nuevo |
| `PROF.P07.FAIR_HOUSING` | No discriminación, no avalúo y privacidad de la dirección | bloqueante (R3) | profile_in([P07]) | HUM | default aceptado | `default_accepted` | nuevo |
| `PROF.P09.PREPARATIONS` | Preparación para procedimientos y exámenes | necesario (R4) | profile_in([P09, P08, P17]) | NC+AV | todos(servicios activos, preparation_ref declarado o 'no requiere' confirmado) y cada preparation_ref con instrucción confirmada | `custom` | nuevo |
| `PROF.P12.CONTRAINDICATIONS_AFTERCARE` | Contraindicaciones publicadas y cuidados antes/después | necesario (R4) | profile_in([P12]) | HUM | tratamientos activos con contraindicaciones confirmadas (valor o vacío) | `custom` | nuevo |
| `PROF.P14.ATTENDANCE_POLICIES` | Faltas, recuperación de clases y congelar | recomendado (R5) | profile_in([P14]) | NC+AV | valor o vacío confirmado | `value_or_empty` | nuevo |
| `PROF.P15.ADMISSIONS_CALENDAR` | Calendario y pasos de admisión, becas | necesario (R4) | profile_in([P15]) | NC+AV | periodo vigente con deadline confirmado | `custom` | nuevo |
| `PROF.P23.PRICING_PORTFOLIO` | Modelo de precios, rangos, tiempos y portafolio | necesario (R4) | profile_in([P23]) | PREG | model confirmado | `confirmed_fields` {"fields":["model[]"]} | nuevo |
| `PROF.P24.SELF_SERVICE` | Página de estado, centro de ayuda y autoservicio de acceso | necesario (R4) | profile_in([P24]) | HUM | password_reset_url confirmada | `confirmed_fields` {"fields":["password_reset_url"]} | nuevo |
| `PROF.P26.TRADE_IN` | Recepción de vehículo usado en parte de pago | necesario (R4) | profile_in([P26]) | HUM | accepted declarado | `confirmed_fields` {"fields":["accepted"]} | nuevo |

## Dominios regulados

| ID | Requisito | Nivel (regla) | Aplica si | Si falta | Predicado | Evaluación | Dónde se completa |
|---|---|---|---|---|---|---|---|
| `DOM.HEALTH.EMERGENCY_PROTOCOL` | Urgencias clínicas (línea propia y externa) y señales de alarma | bloqueante (R3) | domain(health) | EXT | external resuelto y own_urgent_line confirmada (valor o vacío) y red_flags aceptadas | `custom` | nuevo |
| `DOM.HEALTH.CLINICAL_SCOPE` | Alcance clínico del agente y descargo | bloqueante (R3) | domain(health) | HUM | disclaimer aceptado y requires_assessment revisado | `confirmed_fields` {"fields":["disclaimer","requires_assessment"]} | nuevo |
| `DOM.HEALTH.SENSITIVE_DATA` | Datos de salud: consentimiento, mínimo necesario y notificaciones discretas | bloqueante (R3) | domain(health) | HUM | consent_text confirmado y discreet_notifications declarado | `confirmed_fields` {"fields":["consent_text","discreet_notifications"]} | /admin/compliance |
| `DOM.MENTAL_HEALTH.CRISIS_PROTOCOL` | Protocolo de crisis y líneas de ayuda | bloqueante (R3) | domain(mental_health) | EXT | crisis_lines resueltas y professional_alert confirmado | `custom` | nuevo |
| `DOM.PHARMACY.PRESCRIPTION` | Venta bajo fórmula y validación farmacéutica | bloqueante (R3) | domain(pharmacy) | HUM | todos(ítems activos, requires_prescription confirmado) y farmacéutico asignado | `custom` | /admin/catalog (campo nuevo) |
| `DOM.VETERINARY.EMERGENCY` | Emergencias veterinarias y alcance clínico | bloqueante (R3) | domain(veterinary) | EXT | line confirmada y red_flags aceptadas | `confirmed_fields` {"fields":["line","red_flags"]} | nuevo |
| `DOM.INSURANCE.LICENSE_DISCLAIMER` | Licencia del intermediario y descargo de cobertura | bloqueante (R3) | domain(insurance) | HUM | license_id confirmado y disclaimer aceptado | `confirmed_fields` {"fields":["license_id","disclaimer"]} | nuevo |
| `DOM.INSURANCE.ASSISTANCE_LINES` | Líneas de asistencia 24 h por aseguradora y primer aviso de siniestro | bloqueante (R3) | domain(insurance) | EXT | todas las aseguradoras activas con línea confirmada | `custom` | nuevo |
| `DOM.FINANCE.RATES_DISCLOSURE` | Tasas, costos y descargo de simulación | bloqueante (R3) | domain(finance) | NC+AV | cada producto activo con rate_ea vigente y disclaimer aceptado | `custom` | nuevo |
| `DOM.FINANCE.FRAUD_KYC` | Prevención de fraude y verificación de identidad | bloqueante (R3) | domain(finance) | EXT | fraud_line confirmada | `confirmed_fields` {"fields":["fraud_line"]} | nuevo |
| `DOM.LEGAL.SCOPE_CONFIDENTIALITY` | Sin asesoría concreta, confidencialidad y conflicto de interés | bloqueante (R3) | domain(legal) | HUM | disclaimer aceptado | `confirmed_fields` {"fields":["disclaimer"]} | nuevo |
| `DOM.LEGAL.URGENT_DEADLINES` | Ruta prioritaria para plazos legales o fiscales | bloqueante (R3) | domain(legal) | HUM | priority_assignees y sla confirmados | `confirmed_fields` {"fields":["priority_assignees[]","sla"]} | nuevo |
| `DOM.MINORS.GUARDIAN_CONSENT` | Datos y trámites de menores con consentimiento del acudiente | bloqueante (R3) | domain(minors) | HUM | consent_text aceptado y guardian_fields configurados | `confirmed_fields` {"fields":["consent_text","guardian_fields[]"]} | nuevo |
| `DOM.HOME_SAFETY.HAZARD_PROTOCOL` | Riesgo de gas, electricidad o agua: instrucciones y números | bloqueante (R3) | domain(home_safety) | EXT | instructions aceptadas y numbers resueltos | `custom` | nuevo |
| `DOM.HOME_SAFETY.AUTHORITY_CHECK` | Verificar autoridad sobre el inmueble (cerrajería) | bloqueante (R3) | domain(home_safety) and subtype = cerrajeria | HUM | documents y verified_by confirmados | `confirmed_fields` {"fields":["documents","verified_by"]} | nuevo |

## Overrides de perfil, objeto y dominio

| Destino | Fuente | Efecto | Condición | Motivo |
|---|---|---|---|---|
| `CORE.OFFER.PRICE_MODEL` | profile:P00 | parámetro |  | se admite que todos los ítems sean a_cotizar |
| `OBJ.LEAD.WRITE_MODE` | profile:P00 | bloqueante (R2) |  | bloqueante (R2): sin él P00 no tiene acción |
| `CORE.OFFER.FEES` | profile:P01 | necesario (R4) |  | necesario (R4): propina/servicio y descorche (P01-7) |
| `CORE.POLICY.HOUSE_RULES` | profile:P01 | necesario (R4) |  | P01-5 (la accesibilidad va en CORE.LOCATIONS.ACCESS) |
| `CORE.HOURS.BY_SERVICE` | profile:P01 | necesario (R4) |  | necesario (R4): horario de cocina |
| `CORE.DELIVERY.TERMS` | profile:P02 | bloqueante (R2) |  | bloqueante (R2) |
| `CORE.SERVICE_AREA` | profile:P02 | bloqueante (R2) |  | bloqueante (R2) |
| `CORE.OFFER.PROMOTIONS` | profile:P02 | necesario (R4) |  | necesario (R4): 234 conversaciones QA |
| `CORE.COMPLAINT.PROCEDURE` | profile:P02 | necesario (R4) |  | necesario (R4) con reposición/reembolso de comida |
| `CORE.HOURS.BY_SERVICE` | profile:P02 | necesario (R4) |  | necesario (R4): horario de cocina y último pedido (fuera de él no se confirman pedidos) |
| `CORE.POLICY.WARRANTY` | profile:P03 | bloqueante (R2) |  | bloqueante (R2) |
| `CORE.POLICY.REFUND_RETURNS` | profile:P03 | bloqueante (R2) |  | bloqueante (R2) |
| `OBJ.CATALOG_ORDER.AVAILABILITY_SOURCE` | profile:P03 | necesario (R4) |  | necesario (R4) aunque WRITE_MODE ≠ direct (stock: 362 conv.) |
| `OBJ.CATALOG_ORDER.ACCOUNT_READ` | profile:P03 | necesario (R4) |  | necesario (R4) con payment_status visible obligatorio |
| `CORE.HOURS.REGULAR` | profile:P04 | parámetro |  | incluye turno/24 h (P04-5) |
| `CORE.POLICY.HOUSE_RULES` | profile:P05 | necesario (R4) |  | P05-7 |
| `OBJ.LODGING_BOOKING.AVAILABILITY_SOURCE` | profile:P05 | necesario (R4) |  | necesario (R4) incluso en request (disponibilidad por fechas: 46 % de fallo) |
| `OBJ.LODGING_BOOKING.CUSTOMER_REQUIREMENTS` | profile:P05 | necesario (R4) |  | necesario (R4): registro legal de huéspedes |
| `CORE.POLICY.CANCELLATION_CHANGES` | profile:P06 | bloqueante (R2) |  | bloqueante (R2) aunque todo sea solicitud: 52 % de fallo en política |
| `OBJ.TOUR_BOOKING.AVAILABILITY_SOURCE` | profile:P06 | necesario (R4) |  | necesario (R4) en request (fecha específica: 45 % de fallo) |
| `CORE.PAYMENT.FINANCING` | profile:P07 | necesario (R4) |  | necesario (R4): financiación/hipoteca (40 conv., 30 % fallo) |
| `OBJ.REAL_ESTATE.CUSTOMER_REQUIREMENTS` | profile:P07 | necesario (R4) |  | necesario (R4): documentos (61 % de fallo) |
| `CORE.PAYMENT.FINANCING` | profile:P08 | necesario (R4) |  | necesario (R4): seguros/convenios (39 % de fallo) |
| `OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS` | profile:P08 | necesario (R4) |  | necesario (R4): datos obligatorios y qué llevar (P08-4/5) |
| `OBJ.APPOINTMENT.STAFF` | profile:P09 | necesario (R4) |  | necesario (R4) siempre (especialidades) |
| `OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS` | profile:P09 | necesario (R4) |  | necesario (R4): órdenes y remisiones (P09-3) |
| `OBJ.APPOINTMENT.AVAILABILITY_SOURCE` | profile:P11 | bloqueante (R2) |  | bloqueante (R2) siempre (hueco disponible: 66 % de fallo) |
| `CORE.POLICY.HOUSE_RULES` | profile:P11 | necesario (R4) |  | P11-9 |
| `CORE.OFFER.RECOMMENDATION_RULES` | profile:P11 | necesario (R4) |  | necesario (R4): 18 % de las conversaciones del salón |
| `CORE.OFFER.PROMOTIONS` | profile:P13 | necesario (R4) |  | necesario (R4): clase de prueba (P13-2) |
| `CORE.POLICY.CONSUMER_RIGHTS` | profile:P13 | bloqueante (R2) |  | bloqueante (R2): derecho a cancelar la membresía |
| `CORE.HANDOFF.ALWAYS_HUMAN` | profile:P13 | parámetro |  | incluye condición de salud o lesión (P13-9) |
| `OBJ.ENROLLMENT.WRITE_MODE` | profile:P15 | parámetro |  | mode = request_to_business obligatorio (decisión humana) |
| `CORE.SERVICE_AREA` | profile:P16 | bloqueante (R2) |  | bloqueante (R2) |
| `CORE.POLICY.WARRANTY` | profile:P16 | necesario (R4) |  | necesario (R4): garantía de obra |
| `OBJ.APPOINTMENT.WRITE_MODE` | profile:P17 | parámetro |  | required_fields incluye mascota (especie, raza, edad, peso) |
| `CORE.HANDOFF.ALWAYS_HUMAN` | profile:P17 | parámetro |  | incluye estado de hospitalizados, eutanasia y duelo |
| `OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS` | profile:P18 | necesario (R4) |  | necesario (R4): vacunas y comportamiento |
| `CORE.HANDOFF.ALWAYS_HUMAN` | profile:P18 | parámetro |  | heridas o parásitos detectados → derivar a veterinaria |
| `CORE.SERVICE_AREA` | profile:P20 | necesario (R4) |  | necesario (R4): desplazamientos y recargo (P20-5) |
| `CORE.OFFER.PRICE_MODEL` | profile:P23 | parámetro |  | se admite que todo sea a_cotizar |
| `OBJ.MEMBERSHIP.ACCOUNT_READ` | profile:P24 | parámetro |  | identity_level ≥ otp para facturación |
| `CORE.HANDOFF.ALWAYS_HUMAN` | profile:P25 | parámetro |  | incluye asesoría de inversión y decisión de crédito |
| `CORE.POLICY.WARRANTY` | profile:P27 | necesario (R4) |  | necesario (R4): garantía de la reparación (meses o km) |
| `CORE.DELIVERY.TERMS` | object:food_order | bloqueante (R2) | variant = delivery | bloqueante (R2) si variant = delivery |
| `CORE.SERVICE_AREA` | object:food_order | bloqueante (R2) | variant = delivery | bloqueante (R2) si variant = delivery |
| `CORE.POLICY.REFUND_RETURNS` | object:catalog_order | bloqueante (R2) | direct_commit(catalog_order) | bloqueante (R2) si WRITE_MODE = direct_commit |
| `CORE.POLICY.WARRANTY` | object:catalog_order | bloqueante (R2) | direct_commit(catalog_order) | bloqueante (R2) si WRITE_MODE = direct_commit |
| `CORE.OFFER.FEES` | object:lodging_booking | bloqueante (R2) |  | bloqueante (R2): el total de la estancia depende de limpieza, persona extra e impuestos/tasas |
| `CORE.SERVICE_AREA` | object:service_request | bloqueante (R2) | variant = home_service | bloqueante (R2) en home_service |
| `CORE.OFFER.FEES` | object:rental | bloqueante (R2) |  | bloqueante (R2) |
| `CORE.PAYMENT.TIMING_DEPOSIT` | object:rental | bloqueante (R2) |  | bloqueante (R2): depósito/retención en tarjeta |
| `OBJ.RENTAL.CUSTOMER_REQUIREMENTS` | object:rental | bloqueante (R2) |  | bloqueante (R2): elegibilidad del conductor |
| `OBJ.PET_BOARDING.CUSTOMER_REQUIREMENTS` | object:pet_boarding | bloqueante (R3) |  | bloqueante (R3): vacunas y requisitos de ingreso |
| `CORE.PAYMENT.TIMING_DEPOSIT` | object:photo_session | bloqueante (R2) |  | bloqueante (R2): depósito para separar la fecha, reembolsable o no |
| `OBJ.APPOINTMENT.ACCOUNT_READ` | domain:health | bloqueante (R3) |  | bloqueante (R3), identity_level ≥ otp |
| `CORE.PRIVACY.CUSTOMER_MEMORY` | domain:health | parámetro |  | datos de salud solo con consentimiento explícito |
| `OBJ.APPOINTMENT.WRITE_MODE` | domain:health | parámetro |  | consent_required = true |
| `OBJ.APPOINTMENT.CHANGE_RULES` | domain:mental_health | parámetro |  | ask_reason = false |
| `OBJ.INSURANCE.ACCOUNT_READ` | domain:insurance | bloqueante (R3) |  | bloqueante (R3), identity_level ≥ otp |
| `OBJ.LEAD.ACCOUNT_READ` | domain:finance | bloqueante (R3) |  | bloqueante (R3), identity_level ≥ otp |
| `OBJ.PROFESSIONAL_CASE.ACCOUNT_READ` | domain:legal | bloqueante (R3) |  | bloqueante (R3), identity_level ≥ otp |

## Perfiles efectivos y subtipos

| Perfil | Nombre | Objetos por defecto | Dominios | Dominios condicionales | Subtipos |
|---|---|---|---|---|---|
| P00 | Genérico / otros | lead |  |  | `otro/__none__`, `event_planning/weddings` |
| P01 | Restaurante con servicio en sala | appointment(table), food_order |  |  | `restaurantes/casual_dining`, `restaurantes/cafeteria` |
| P02 | Comida rápida, domicilios y dark kitchen | food_order(delivery) |  |  | `restaurantes/comida_rapida`, `restaurantes/dark_kitchen` |
| P03 | Retail de catálogo | catalog_order |  |  | `retail/electronica`, `retail/hogar`, `retail/moda`, `retail/marketplace`, `technology/hardware`, `automotriz/repuestos` |
| P04 | Farmacia o droguería | catalog_order(pharmacy) | pharmacy, health |  | `salud/farmacia` |
| P05 | Alojamiento | lodging_booking |  |  | `turismo/hotel`, `turismo/alquiler_vacacional` |
| P06 | Tours y agencia de viajes | tour_booking, lead(quote) |  |  | `turismo/tours`, `turismo/agencia_viajes` |
| P07 | Inmobiliaria | real_estate, lead(owner_intake) |  | finance si simulates_financing | `inmobiliaria/venta`, `inmobiliaria/arriendo`, `inmobiliaria/comercial`, `inmobiliaria/promotora` |
| P08 | Odontología | appointment | health |  | `salud/dental` |
| P09 | Medicina general y especialistas | appointment | health |  | `salud/medica_general`, `salud/dermatologia` |
| P10 | Salud mental | appointment | health, mental_health | minors si treats_minors | `salud/psicologia` |
| P11 | Peluquería y barbería | appointment |  |  | `moda_belleza/salon_belleza`, `moda_belleza/barberia` |
| P12 | Estética y spa | appointment |  | health si offers_medical_aesthetic | `moda_belleza/estetica`, `moda_belleza/spa` |
| P13 | Gimnasio y estudio de clases | membership |  | minors si admits_minors | `gimnasios/gimnasio_general`, `gimnasios/crossfit`, `gimnasios/yoga_pilates`, `gimnasios/cycling`, `gimnasios/martial_arts` |
| P14 | Academias y cursos libres | enrollment |  | minors si min_age_under_18 | `education/idiomas`, `education/academia_baile`, `education/academia_musica`, `education/clases_particulares`, `education/autoescuela`, `education/online`, `education/capacitacion` |
| P15 | Educación formal y admisiones | enrollment(admission) | minors |  | `education/universitaria` |
| P16 | Servicios del hogar | service_request(home_service) | home_safety |  | `servicios_hogar/plomeria`, `servicios_hogar/electricidad`, `servicios_hogar/fumigacion`, `servicios_hogar/limpieza`, `servicios_hogar/jardineria`, `servicios_hogar/cerrajeria`, `servicios_hogar/pintura`, `construccion/contratista_general` |
| P17 | Veterinaria | appointment | veterinary |  | `veterinaria/clinica_general`, `veterinaria/hospital_24h`, `veterinaria/exoticos` |
| P18 | Servicios para mascotas | appointment |  |  | `pet_services/peluqueria`, `pet_services/paseos`, `pet_services/adiestramiento` |
| P19 | Hotel y guardería de mascotas | pet_boarding |  |  | `pet_services/hotel`, `pet_services/guarderia` |
| P20 | Fotografía | photo_session, lead(quote) |  | minors si photographs_minors | `fotografia/estudio`, `fotografia/bodas`, `fotografia/eventos`, `fotografia/producto` |
| P21 | Seguros | insurance | insurance |  | `seguros/broker`, `seguros/aseguradora`, `seguros/vida`, `seguros/auto`, `seguros/salud` |
| P22 | Servicios legales y contables | professional_case, appointment(consult) | legal |  | `servicios_profesionales/abogados`, `servicios_profesionales/contadores` |
| P23 | Consultoría y proyectos B2B | lead(quote), appointment(consult) |  |  | `servicios_profesionales/arquitectos`, `servicios_profesionales/consultores`, `technology/desarrollo` |
| P24 | SaaS y soporte de software | membership(saas_subscription), service_request(support_ticket) |  |  | `technology/saas`, `technology/soporte_ti_msp` |
| P25 | Finanzas: crédito y asesoría | lead(credit_application), appointment(consult) | finance |  | `finanzas/asesoria`, `finanzas/creditos`, `finanzas/pagos_recaudos` |
| P26 | Concesionario | catalog_order(dealer_inventory), appointment(test_drive), lead(quote) |  | finance si simulates_financing | `automotriz/concesionario` |
| P27 | Taller automotriz | service_request(repair_order) | home_safety |  | `automotriz/taller` |
| P28 | Alquiler de vehículos | rental(vehicle) |  |  | `automotriz/alquiler` |
