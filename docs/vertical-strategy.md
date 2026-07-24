# Parallly — Estrategia de Verticalización por Tipo de Negocio
_Actualizado: jul 2026 · v2_

> **Alcance de este doc**: cubre SOLO la verticalización del producto — agente IA, terminología, pipeline, FAQs, KPIs, herramientas IA por sector y adaptación de dashboard/onboarding. Facturación/planes, fiscal DIAN, SMS y el Centro de Operaciones (super_admin) son **ortogonales** a la vertical y viven en sus propios docs: `billing-annual-cycle.md`, `facturacion-electronica-colombia-2026-06.md`, `sms-monetization-packages-2026-07.md`, `superadmin-governance.md`, y Ops Center en `observability-manual.md`.

## Visión
Cuando un negocio completa el onboarding en Parallly, el sistema ya debe "entender" su industria: el agente IA usa vocabulario del sector, el pipeline tiene las etapas correctas, las FAQs más comunes están pre-cargadas, y el dashboard muestra KPIs relevantes. El objetivo es que el 80% de la configuración esté resuelta automáticamente.

La fuente única de verdad es `apps/api/src/modules/verticals/vertical-definitions.ts` → `VERTICAL_REGISTRY`, un `Record<industrySlug, VerticalDefinition>` con **17 verticales + `otro`** (fallback genérico). `getVerticalDefinition(industry)` resuelve cualquier slug desconocido a `otro`.

---

## Verticales Prioritarias (Tier 1 — Mayor densidad + ROI más claro)

### 1. Clínicas Dentales / Consultorios Médicos
- **Mercado**: 600,000+ consultorios dentales solo en LatAm (Brasil ~350K, Colombia ~40K, México ~80K)
- **Dolor principal**: Responden WhatsApp manualmente 100% del tiempo, pierden pacientes por no responder fuera de horario
- **Agente**: "Sofía" — profesional, empática
- **Herramientas del agente**:
  - `book_appointment(service, date, time)` — agendar citas
  - `check_availability(doctor, date_range)` — verificar disponibilidad
  - `get_services()` — listar servicios y precios
  - `send_reminder(appointment_id)` — recordatorio pre-cita
  - `post_visit_followup(patient_id)` — seguimiento post-visita
  - `check_insurance(provider_name)` — verificar si aceptan seguro
- **Pipeline**: Consulta → Cita agendada → Primera visita → Paciente activo → Seguimiento
- **Terminología**: "paciente" (no "cliente"), "cita" (no "reunión"), "consulta" (no "servicio")
- **KPIs**: Citas agendadas, tasa de no-shows, pacientes nuevos vs recurrentes
- **Temas prohibidos**: No dar diagnósticos, no recomendar medicamentos específicos

### 2. Salones de Belleza / Barberías
- **Mercado**: ~500K+ en LatAm. WhatsApp es el canal #1 de reservas
- **Agente**: "Luna" — amigable, moderna
- **Herramientas**:
  - `book_appointment(service, stylist, date, time)`
  - `get_services_with_prices()` — catálogo con duración y precio
  - `get_stylist_availability(stylist_id)`
  - `send_promotion(client_id, offer)` — enviar ofertas personalizadas
- **Pipeline**: Nuevo → Cita agendada → Primera visita → Cliente frecuente → VIP
- **Terminología**: "cita" (no "reunión"), "servicio" (corte, color, manicure)
- **KPIs**: Citas agendadas, confirmación, no-shows, servicio más solicitado, recurrencia

### 3. Inmobiliarias / Bienes Raíces
- **Mercado**: ~200K+ agencias en LatAm. Alto valor por transacción
- **Agente**: "Carlos" — profesional, consultivo
- **Herramientas**:
  - `search_properties(type, budget, location, bedrooms)` — buscar propiedades
  - `get_property_details(property_id)` — ficha técnica + fotos
  - `schedule_visit(property_id, date, time)` — agendar visita
  - `qualify_lead(budget, timeline, financing)` — calificar prospecto
  - `get_financing_info()` — información sobre créditos
  - `check_property_availability(property_id)` — verificar disponibilidad
- **Pipeline**: Lead → Calificado → Visita agendada → Propuesta enviada → Negociación → Cerrado
- **Terminología**: "propiedad" (no "producto"), "visita" (no "cita"), "prospecto" (no "contacto")
- **KPIs**: Leads calificados, visitas agendadas, conversión lead→visita, tiempo en pipeline
- **Integraciones**: Portales (FincaRaiz, Metrocuadrado, Inmuebles24, Zillow)

### 4. Restaurantes / Dark Kitchens
- **Mercado**: ~1M+ restaurantes en LatAm. Pedidos por WhatsApp son comunes
- **Agente**: "Luca" — cálido, amigable
- **Herramientas**:
  - `get_menu(category?)` — mostrar menú con precios
  - `make_reservation(date, time, guests)` — reservar mesa
  - `check_table_availability(date, time, guests)` — disponibilidad
  - `place_order(items[], delivery_address?)` — tomar pedido
  - `get_order_status(order_id)` — estado del pedido
  - `get_promotions()` — ofertas del día
- **Pipeline**: Interesado → Reserva confirmada → Visitó → Cliente recurrente
- **Terminología**: "reserva" (no "cita"), "mesa" (no "servicio"), "menú" (no "catálogo")
- **KPIs**: Reservas confirmadas, pedidos procesados, hora pico, recurrencia

### 5. Automotriz / Concesionarios
- **Mercado**: Alto valor por lead. Cada venta = $10K-$50K+ USD
- **Agente**: "Marco" — profesional, conocedor
- **Herramientas**:
  - `search_vehicles(type, brand, budget, year_range)` — buscar vehículos
  - `get_vehicle_details(vehicle_id)` — ficha técnica + fotos + precio
  - `schedule_test_drive(vehicle_id, date, time)` — agendar prueba de manejo
  - `qualify_lead(budget, trade_in, financing_needed)` — calificar
  - `get_financing_options(vehicle_id, down_payment)` — opciones de financiamiento
  - `get_trade_in_estimate(vehicle_info)` — estimado de retoma
- **Pipeline**: Lead → Contactado → Prueba de manejo → Propuesta → Financiamiento → Entrega
- **Terminología**: "vehículo", "prueba de manejo", "financiamiento", "retoma"
- **KPIs**: Leads calificados, pruebas agendadas, conversión, leads en financiamiento

---

## Verticales Tier 2 — Alto Potencial

### 6. Alojamientos Turísticos / Vacation Rentals
- **Mercado**: $175B globalmente. 140K+ property managers profesionales
- **Agente**: "Maya" — entusiasta, servicial
- **Herramientas**:
  - `check_availability(property_id, check_in, check_out, guests)`
  - `get_pricing(property_id, dates, guests)`
  - `get_property_details(property_id)` — amenidades, fotos, ubicación
  - `get_house_rules(property_id)` — reglas, check-in/out times
  - `get_check_in_instructions(reservation_id)` — código de puerta, WiFi, parking
  - `create_reservation(property_id, dates, guest_info)` — reserva directa
  - `get_nearby_attractions(property_id)` — restaurantes, playas, transporte
  - `report_issue(reservation_id, type, description)` — reportar problema
  - `request_late_checkout(reservation_id)` — solicitar late checkout
- **Pipeline**: Consulta → Cotización → Reserva → Check-in → Check-out → Reseña
- **Integraciones**: Channel managers (Hostaway API, Guesty API, Lodgify API, iCal fallback)
- **Nota**: Airbnb NO tiene API pública. Booking.com pausó nuevos partners. La ruta es vía channel managers.
- **Prioridad de integración**: Hostaway → Guesty → Lodgify → Rentals United (para Despegar en LatAm)

### 7. Gimnasios / Estudios Fitness
- **Agente**: "Alex" — motivador, energético
- **Herramientas**:
  - `get_membership_plans()` — planes y precios
  - `book_class(class_type, date, time)` — reservar clase
  - `get_class_schedule(date_range)` — horario de clases
  - `freeze_membership(member_id, months)` — congelar membresía
  - `get_trainer_availability(trainer_id)` — disponibilidad de entrenadores
- **Pipeline**: Interesado → Trial → Inscrito → Activo → Renovación

### 8. Veterinarias
- **Agente**: "Dra. Ana" — empática, cariñosa
- **Herramientas**:
  - `book_appointment(pet_type, service, date)`
  - `get_vaccination_schedule(pet_id)` — calendario de vacunas
  - `get_services()` — consulta, vacunación, cirugía, peluquería
  - `emergency_triage(symptoms)` — evaluar urgencia
- **Pipeline**: Consulta → Cita → Primera visita → Paciente registrado → Seguimiento
- **Terminología**: "mascota", "tutor" (no "dueño"), "paciente" (la mascota)

### 9. Escuelas de Idiomas / Centros Educativos
- **Agente**: "Pablo" — alentador, claro
- **Herramientas**:
  - `get_courses(language, level)` — cursos disponibles
  - `get_schedule(course_id)` — horarios
  - `enroll_student(course_id, student_info)` — inscripción
  - `get_placement_test_link()` — test de nivel
  - `get_pricing(course_id, modality)` — precios presencial/online
- **Pipeline**: Interesado → Test de nivel → Inscrito → Activo → Completó → Alumni

### 10. Agencias de Viajes / Tour Operators
- **Agente**: "Maya" — entusiasta, conocedora
- **Herramientas**:
  - `search_packages(destination, dates, budget, travelers)`
  - `get_package_details(package_id)` — itinerario completo
  - `create_quote(package_id, travelers)` — cotización
  - `check_availability(tour_id, date)` — disponibilidad de tours
  - `get_destination_info(destination)` — clima, documentos, tips
- **Pipeline**: Consulta → Cotización enviada → Reserva → Confirmado → Viajó → Post-viaje

### 11. Seguros
- **Agente**: "Roberto" — confiable, claro
- **Herramientas**:
  - `get_insurance_plans(type, coverage_level)`
  - `calculate_quote(plan_id, personal_info)`
  - `schedule_consultation(agent_id, date)`
  - `file_claim(policy_id, incident_type, description)`
  - `check_policy_status(policy_id)`
- **Pipeline**: Lead → Calificado → Cotización → Propuesta → Póliza emitida → Renovación

### 12. Servicios Profesionales (Abogados, Contadores)
- **Agente**: "Elena" — formal, precisa
- **Herramientas**:
  - `schedule_consultation(service_type, date, time)`
  - `get_services_and_fees()`
  - `qualify_case(case_type, description)` — evaluar caso
  - `request_documents(client_id, document_list)` — solicitar documentos
- **Pipeline**: Lead → Calificado → Consulta → Propuesta → Contrato → Activo → Renovación

---

## Verticales Tier 3 — Nichos Específicos

### 13. Servicios del Hogar (Plomería, Electricidad, Fumigación, Limpieza)
- **Herramientas**: `schedule_service()`, `get_quote(service_type, area)`, `dispatch_technician()`, `get_service_status()`
- **Pipeline**: Solicitud → Cotización → Agendado → En servicio → Completado → Seguimiento

### 14. Pet Services (Peluquería, Guardería, Hotel)
- **Herramientas**: `book_grooming()`, `check_daycare_availability()`, `get_pet_profile()`, `vaccination_check()`
- **Pipeline**: Consulta → Reserva → Servicio → Cliente frecuente

### 15. Fotografía / Estudios / Wedding Planners
- **Herramientas**: `check_date_availability()`, `get_packages()`, `create_quote()`, `share_portfolio()`
- **Pipeline**: Consulta → Cotización → Anticipo → Sesión agendada → Entrega → Reseña

---

## Herramientas IA por vertical (IMPLEMENTADO)

Cada vertical activa un set de tool-definitions específicas. Se registran en `apps/api/src/modules/conversations/tools/` y se enchufan por **feature flag por-agente** (`persona.config.tools.<key>.enabled`), tanto en el pipeline real (`conversations.service.ts`) como en el simulador (`agent-test.service.ts`). Un agente combina sus tools verticales con las **transversales**.

| Vertical(es) | Flag (`tools.<key>`) | Archivo | Herramientas (nombres reales) |
|--------------|----------------------|---------|-------------------------------|
| salud (odontología/estética/psicología…) | `treatments` | `treatment-tools.ts` | `get_treatment_plan`, `list_upcoming_sessions` |
| inmobiliaria | `realEstate` | `listings-tools.ts` | `search_listings`, `get_listing_details`, `send_listing_image` |
| automotriz | `vehicles` | `vehicle-tools.ts` | `search_vehicles`, `get_vehicle_details`, `send_vehicle_image` |
| restaurantes | `restaurants` | `restaurants-tools.ts` | `get_menu`, `get_promotions`, `place_order`, `check_order_status`, `cancel_order`, `list_my_orders` |
| turismo — alojamientos | `properties` | `vacation-rental-tools.ts` | `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image` |
| turismo — agencias/tours | `tours` | `tours-tools.ts` | `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`, `cancel_tour_booking`, `list_my_tour_bookings` |
| gimnasios | `gyms` | `gyms-tools.ts` | `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `cancel_class_booking` |
| education | `education` | `education-tools.ts` | `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments` |
| seguros | `insurance` | `insurance-tools.ts` | `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote` |
| veterinaria | `pets` | `pets-tools.ts` | `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet` |
| servicios_hogar | `homeServices` | `tier3-tools.ts` | `create_service_request`, `check_request_status`, `cancel_service_request` |
| pet_services | `petServices` | `tier3-tools.ts` | `list_pet_services`, `check_daycare_availability` |
| fotografia | `photography` | `tier3-tools.ts` | `list_photo_packages`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session` |
| retail / e-commerce | `ecommerce` / `catalog` | `ecommerce-tools.ts` + `catalog-tools.ts` | `recommend_products`, `get_order_status`, `apply_discount`, `search_products`, `check_stock`, `send_product_image`, `list_active_offers` |

**Transversales** (disponibles a cualquier vertical con la feature activa):
- `appointment-tools.ts` (flag `appointments`) — motor de agenda determinístico: `list_services`, `check_availability`, `create_appointment`, `reschedule_appointment`, `cancel_appointment`, `list_customer_appointments`, `get_appointment_details`, `send_booking_link`
- `knowledge-tools.ts` — RAG/KB: `search_faqs`, `get_policy`, `search_knowledge_base`
- `crm-tools.ts` — contexto de cliente: `list_customer_orders`, `get_customer_context`
- `vertical-integration-tools.ts` — gateado por proveedor externo conectado (ver módulo `vertical-integrations`): `get_restaurant_menu` (Toast), `get_fitness_schedule` (Mindbody), `list_clinic_services` / `check_clinic_availability` (Cliniko)

> Todas las tools de escritura pasan por `WRITE_TOOLS` (confirmación/side-effects controlados) y, en simulación, corren con `{disableTools:true}` para cero efectos en prod.

---

## Módulos backend de verticalización (IMPLEMENTADO)

Además de las tools, la verticalización se apoya en módulos NestJS dedicados:

| Módulo | Ubicación | Qué hace |
|--------|-----------|----------|
| **VerticalsModule** | `modules/verticals/` (service + controller) | Sirve `VERTICAL_REGISTRY`, resuelve terminología/sidebar/KPIs y ejecuta `bootstrapVertical()` en `completeOnboarding` (pipeline, agente, FAQs, servicios, horario) |
| **Vehicle Inventory** | `verticals/vehicle-inventory.{service,controller}.ts` | Inventario automotriz. Tablas lazy `vehicles`, `vehicle_inquiries`, `test_drives`. CRUD, `markSold()`, `scheduleTestDrive()` con detección de conflictos, búsqueda IA, stats. Rutas `/vehicles/:tenantId` |
| **Staff Scheduling** | `verticals/staff-scheduling.{service,controller}.ts` | Agenda de personal para salud/belleza. Tablas lazy `staff_members`, `staff_schedules`, `staff_service_links`, `staff_breaks`. Disponibilidad resolviendo servicio/horario/descanso/cita. Rutas `/staff/:tenantId` |
| **Vertical Analytics** | `modules/vertical-analytics/` | Analítica cross-vertical (super_admin): `GET /vertical-analytics/overview` (distribución + brechas de activación), `/industry/:industry` (drilldown por industria), `/tenant/:tenantId` (KPIs verticales del tenant) |
| **Vertical Integrations** | `modules/vertical-integrations/` | Adaptadores a SaaS verticales externos (Toast POS, Mindbody, Cliniko). Config en `tenant.settings.verticalIntegrations.{provider}`, tabla `vi_items`. Habilita las tools de `vertical-integration-tools.ts` sólo por proveedor conectado (`getConnectedProviders` cacheado) |
| **Channel Manager** | `modules/channel-manager/` | Integración PMS para alquiler vacacional. **Hostaway** con intercambio OAuth real + sync de listings/reservas (`api.hostaway.com/v1`). Tablas lazy `cm_listings`, `cm_reservations`, `cm_availability`. Detección de conflictos + calendario de disponibilidad. `provider` enum admite `hostaway`/`guesty`/`ical`/`direct`; sólo Hostaway tiene sync en vivo |

> **Nota sobre alquiler vacacional**: existen DOS módulos complementarios — `vacation-rental` (propiedades propias + KB por propiedad + iCal, sección abajo) y `channel-manager` (sincroniza con un PMS externo tipo Hostaway). Un tenant puede usar cualquiera de los dos.

---

## Adaptación del Onboarding (Propuesta)

### Paso 1: Selección de industria + Sub-tipo (IMPLEMENTADO)
Tras seleccionar industria se muestra un segundo selector de sub-tipo. Los sub-tipos viven en `VerticalDefinition.subTypes` (cada uno con `key` + `label` en 4 idiomas) y cubren las 17 verticales. Ejemplos reales del registro:
- `salud` → Odontología | Medicina general | Estética y dermatología | Psicología y terapia | Farmacia
- `inmobiliaria` → Venta | Arriendo | Inmuebles comerciales | Construcción y proyectos
- `restaurantes` → Restaurante casual | Comida rápida | Cafetería | Dark kitchen / Delivery
- `automotriz` → Concesionario | Taller mecánico | Repuestos y accesorios | Alquiler de vehículos
- `moda_belleza` → Salón de belleza | Barbería | Spa y bienestar | Boutique de moda

### Paso 2: Lo que `completeOnboarding` debe pre-configurar automáticamente

| Recurso | Qué se pre-carga |
|---------|-------------------|
| **Agente IA** | Nombre, personalidad, prompt base, temas prohibidos |
| **Pipeline stages** | 5-7 etapas específicas del sector |
| **FAQs** | 5 preguntas frecuentes del sector |
| **Servicios** | 3 servicios placeholder para industrias con booking |
| **Horario** | Default por industria (restaurantes nocturno, oficinas diurno) |
| **Handoff triggers** | Palabras clave de escalación por industria |
| **Vertical context** | Bloque `<vertical_context>` en el turno L3 con los 5 campos de `terminology`: `customerNoun`, `customerNounPlural`, `transactionNoun`, `serviceNoun`, `pipelineNoun` (+ `industryGuidance`). El contrato L1 lleva la **regla #13** que obliga al LLM a usar esa terminología |

### Paso 3: Adaptación del Dashboard

| Elemento | Cómo cambia |
|----------|-------------|
| **Sidebar labels** | "Contactos" → "Pacientes" (salud), "Prospectos" (automotriz) |
| **Pipeline nombre** | "Embudo de ventas" → "Pacientes" (salud), "Reservas" (restaurantes) |
| **KPIs del dashboard** | Métricas relevantes al sector (no-shows para salud, conversión para inmobiliaria) |
| **Orden del sidebar** | Citas primero para salud, CRM primero para inmobiliaria |

---

## Vacation Rentals — Detalle de Integración

### APIs Disponibles

| Plataforma | API | Estado |
|------------|-----|--------|
| Airbnb | Cerrada (solo partners invitados) | ❌ No accesible directamente |
| Booking.com | Connectivity API | ⏸️ Pausada para nuevos partners |
| Vrbo/Expedia | Rapid API | ✅ Requiere aprobación |
| **Hostaway** | REST API pública | ✅ **IMPLEMENTADO** — módulo `channel-manager` (OAuth + sync de listings/reservas) |
| **Guesty** | OAuth 2.0 REST API | 🔜 Pendiente (adaptador en backlog; `provider` ya contemplado) |
| **Lodgify** | REST API | 🔜 Pendiente (adaptador en backlog) |
| **Rentals United** | REST API | ✅ Único con Despegar |
| **Cloudbeds** | REST API | ✅ Hotels + vacation rental |
| iCal | .ics universal | ✅ Fallback (solo lectura, 6-12h delay) |

### Arquitectura de Integración Propuesta

```
Huésped (WhatsApp/Instagram)
    → Parallly AI Agent
        → check_availability() → Channel Manager API (Hostaway/Guesty)
        → get_pricing()        → Channel Manager API
        → get_house_rules()    → Parallly Knowledge Base (por propiedad)
        → get_amenities()      → Parallly Knowledge Base
        → create_reservation() → Channel Manager API + MercadoPago link
        → report_issue()       → Channel Manager tasks + notificación al anfitrión
        → escalate_to_host()   → Parallly handoff → WhatsApp al anfitrión
```

### Plan de Implementación
1. **Módulo `vacation-rental`** en NestJS con adaptadores para channel managers
2. **Sync de propiedades**: El host conecta su cuenta → Parallly importa todas las propiedades
3. **KB por propiedad**: Cada propiedad tiene su propia base de conocimiento (reglas, amenidades, check-in)
4. **Motor de reservas diferente**: Multi-noche, cleaning fee, check OTA conflicts
5. **Workflow de check-in**: Envío automático de instrucciones 24h antes

---

## Competencia en AI para Vacation Rentals

| Herramienta | Enfoque | Debilidad vs Parallly |
|-------------|---------|----------------------|
| HostBuddy AI | 95% automatización mensajes | Solo SMS/email, no WhatsApp |
| Alfred | Airbnb/Vrbo/WhatsApp | Solo USA, no LatAm |
| Enso Connect | Multi-agente AI | No WhatsApp nativo |
| Hostaway AI | Integrado en PMS | Solo funciona con Hostaway |

**Ventaja de Parallly**: WhatsApp + Instagram + Messenger + Telegram nativamente, español/portugués first, multi-tenant, multi-agente por canal, handoff a humano.

---

## Prioridad de Implementación

### Fase 1 — Backend bootstrap ✅ COMPLETADO
- `bootstrapVertical(industry)` en `completeOnboarding`
- Pre-seed pipeline stages, agente IA, FAQs, servicios, horario
- `vertical_context` XML en `PromptAssemblerService` (regla #13 del contrato L1)

### Fase 2 — Dashboard adaptation ✅ COMPLETADO
- Sidebar labels dinámicos por industria (`labelOverrides` + `hiddenItems`)
- KPIs verticales en analytics + `vertical-analytics` cross-tenant (super_admin)
- Sub-tipo en onboarding wizard (`subTypes` en las 17 verticales)

### Fase 3 — Vacation Rental module ✅ COMPLETADO
- Módulo `vacation-rental` (propiedades, iCal import/export, 5 tools IA, dashboard)
- KB por propiedad
- Motor de reservas multi-noche
- Workflow de check-in automático

### Fase 4 — Más integraciones (en curso)
- ✅ Hostaway adapter (`channel-manager`)
- ✅ Adaptadores POS/PMS externos por vertical (`vertical-integrations`: Toast, Mindbody, Cliniko)
- 🔜 Guesty adapter · Lodgify adapter
- 🔜 Portales inmobiliarios (FincaRaiz, Metrocuadrado, Inmuebles24…)

---

## Implementation Status (jul 2026)

### Completed
- [x] 17 verticales + `otro` con 4 idiomas en `VERTICAL_REGISTRY` (vertical-definitions.ts)
- [x] VerticalsModule (service + controller + module)
- [x] bootstrapVertical() in completeOnboarding (pipeline, agent, FAQs, services)
- [x] Prompt assembler `<vertical_context>` con la **regla #13** del contrato L1 y los 5 campos de `terminology`
- [x] Sidebar dynamic labels + hidden items + reordering
- [x] Dashboard KPIs dynamic per vertical + módulo `vertical-analytics` cross-tenant (super_admin)
- [x] Dashboard welcome contextual per industry
- [x] Dashboard homepage view (agenda for clinics, leads for real estate)
- [x] Empty states per industry on 5 pages
- [x] Onboarding checklist adapted per industry
- [x] useVerticalTerms() hook + propagation to 8+ pages
- [x] Onboarding sub-type dropdown (17 verticales + `otro`, cada una con `subTypes`)
- [x] Herramientas IA por vertical (17 tool-files) gateadas por `tools.<key>.enabled` — inmobiliaria (`search_listings`), restaurantes (`get_menu`), automotriz (`search_vehicles`), etc.
- [x] Vehicle Inventory + Staff Scheduling (dentro de `verticals/`)
- [x] Vertical Integrations (Toast / Mindbody / Cliniko) con tools gateadas por proveedor conectado
- [x] Channel Manager — Hostaway (OAuth + sync de listings/reservas)
- [x] Vacation Rental module (properties, iCal sync, AI tools, dashboard)
- [x] 8 AI tools for vacation rental (list, check availability, details, check-in, book, cancel, list bookings, send image)
- [x] iCal import from Airbnb/Booking.com (cron every 30 min)
- [x] iCal export public endpoint for platforms
- [x] Properties dashboard pages (list + detail with 5 tabs)

### Pendiente
- [ ] Adaptadores channel manager Guesty y Lodgify (`provider` ya contemplado; falta el sync en vivo)

### Bloqueado por terceros
- [ ] Webhooks en tiempo real de Airbnb/Booking (requiere aprobación de partner; hoy sólo iCal read-only con 6-12h de delay)
