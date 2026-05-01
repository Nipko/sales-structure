# Parallly — Estrategia de Verticalización por Tipo de Negocio

## Visión
Cuando un negocio completa el onboarding en Parallly, el sistema ya debe "entender" su industria: el agente IA usa vocabulario del sector, el pipeline tiene las etapas correctas, las FAQs más comunes están pre-cargadas, y el dashboard muestra KPIs relevantes. El objetivo es que el 80% de la configuración esté resuelta automáticamente.

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

## Adaptación del Onboarding (Propuesta)

### Paso 1: Selección de industria (ya existe) + Sub-tipo (NUEVO)
Después de seleccionar industria, mostrar un segundo selector:
- `salud` → Clínica dental | Consultorio médico | Centro de estética | Farmacia
- `inmobiliaria` → Venta | Arriendo | Ambos | Administración de propiedades
- `restaurantes` → Restaurante | Dark kitchen | Cafetería | Bar
- `turismo` → Hotel | Apartamentos turísticos | Agencia de viajes | Tour operator
- `automotriz` → Concesionario nuevo | Usado | Taller | Lavadero

### Paso 2: Lo que `completeOnboarding` debe pre-configurar automáticamente

| Recurso | Qué se pre-carga |
|---------|-------------------|
| **Agente IA** | Nombre, personalidad, prompt base, temas prohibidos |
| **Pipeline stages** | 5-7 etapas específicas del sector |
| **FAQs** | 5 preguntas frecuentes del sector |
| **Servicios** | 3 servicios placeholder para industrias con booking |
| **Horario** | Default por industria (restaurantes nocturno, oficinas diurno) |
| **Handoff triggers** | Palabras clave de escalación por industria |
| **Vertical context** | customer_noun, transaction_noun, service_noun para el LLM |

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
| **Hostaway** | REST API pública | ✅ **Mejor opción** — sandbox disponible |
| **Guesty** | OAuth 2.0 REST API | ✅ Enterprise segment |
| **Lodgify** | REST API | ✅ Entry-level operators |
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

### Fase 1 — Backend bootstrap (1-2 sprints)
- `verticalBootstrap(industry)` en `completeOnboarding`
- Pre-seed pipeline stages, agente IA, FAQs, servicios, horario
- `vertical_context` XML en `PromptAssemblerService`

### Fase 2 — Dashboard adaptation (2-3 sprints)
- Sidebar labels dinámicos por industria
- KPIs verticales en analytics
- Sub-tipo en onboarding wizard

### Fase 3 — Vacation Rental module (3-4 sprints)
- Hostaway adapter
- Property sync + KB por propiedad
- Motor de reservas multi-noche
- Workflow de check-in automático

### Fase 4 — Más integraciones (ongoing)
- Guesty adapter
- Lodgify adapter
- Integraciones por vertical (portales inmobiliarios, POS restaurantes, etc.)
