# Parallly — Estrategia de Verticalización por Tipo de Negocio
_Estrategia original: jul 2026 (v2) · revisión de octubre 2026: este documento ya no es fuente de verdad_

> **Este documento NO es la fuente de verdad de industrias, tipos de negocio ni herramientas.**
>
> - **Autoridad vigente:** [`docs/business-types-catalog.md`](business-types-catalog.md), generado desde el código (`node apps/api/scripts/business-types-catalog.cjs --write`) y comprobado por el CI. Lista las industrias y cada tipo de negocio con su id, nombre, disponibilidad (seleccionable, lista de espera o solo cuentas existentes), modo de producto, menú, familias y herramientas del agente.
> - Este archivo conserva la **estrategia y el razonamiento de producto** de julio de 2026. Las secciones marcadas *(histórico)* describen cómo se pensó la verticalización, no necesariamente cómo está hoy. Si algo de aquí contradice al catálogo o al código, manda el código.
> - Origen de los datos que sí siguen vigentes: `apps/api/src/modules/verticals/vertical-definitions.ts` (`VERTICAL_REGISTRY`), `packages/shared/src/subtype-experience-profile.ts`, `packages/shared/src/vertical-capability-manifest.ts`, `packages/shared/src/vertical-product-policy.ts` y `apps/api/src/modules/conversations/agent-tool-registry.ts`.

**Glosario.** *Industria* (en el código y en documentos antiguos: «vertical») = el sector; hay **20** en el registro y **18** visibles en el alta. *Tipo de negocio* (en el código: «subtipo» o «perfil») = la especialidad dentro de la industria; hay **80 canónicos** (72 seleccionables y 8 en lista de espera) y 85 configuraciones resolubles contando 5 que solo existen para cuentas anteriores. La interfaz rotula los dos selectores del alta «Industria» y «Tipo de negocio».

> **Alcance de este doc**: cubre SOLO la verticalización del producto — agente IA, terminología, pipeline, FAQs, KPIs, herramientas IA por sector y adaptación de dashboard/onboarding. Facturación/planes, fiscal DIAN, SMS y el Centro de Operaciones (super_admin) son **ortogonales** a la industria y viven en sus propios docs: `billing-annual-cycle.md`, `facturacion-electronica-colombia-2026-06.md`, `sms-monetization-packages-2026-07.md`, `superadmin-governance.md`, y Ops Center en `observability-manual.md`.

## Visión
Cuando un negocio completa el onboarding en Parallly, el sistema ya debe "entender" su industria: el agente IA usa vocabulario del sector, el pipeline tiene las etapas correctas, las FAQs más comunes están pre-cargadas, y el dashboard muestra KPIs relevantes. El objetivo es que el 80% de la configuración esté resuelta automáticamente.

El registro ejecutable es `VERTICAL_REGISTRY` en `apps/api/src/modules/verticals/vertical-definitions.ts`, un `Record<industrySlug, VerticalDefinition>` con las **20 industrias** actuales (incluida `otro`, el fallback genérico). `getVerticalDefinition(industry, subType?)` **lanza un error** si la industria no existe; no hay resolución silenciosa a `otro`. Sobre ese registro, los tipos de negocio (`industria/tipo`) los definen `subtype-experience-profile.ts` y el manifiesto de capacidades; el catálogo generado es la lista autorizada.

---

## Industrias prioritarias (Tier 1) *(histórico)*

Las tres secciones de Tier son el análisis de mercado y la hipótesis de producto de julio de 2026. Las cifras de mercado son estimaciones de esa fecha y no se mantienen. Las etapas de pipeline, terminología, KPIs y FAQs que realmente se siembran están en `VERTICAL_REGISTRY` (varias etapas difieren del diseño original). En cada sección, «Herramientas reales» enumera lo que existe hoy en el registro de herramientas; lo que el plan original imaginaba y no existe como herramienta se dice aparte.

### 1. Clínicas dentales / consultorios médicos
- **Mercado**: 600,000+ consultorios dentales solo en LatAm (Brasil ~350K, Colombia ~40K, México ~80K)
- **Dolor principal**: Responden WhatsApp manualmente 100% del tiempo, pierden pacientes por no responder fuera de horario
- **Agente sembrado**: "Sofía" (industria `salud`)
- **Herramientas reales** (tipos `salud/dental`, `salud/medica_general`, `salud/dermatologia`, `salud/psicologia`): `list_services`, `check_availability`, `create_appointment`, `reschedule_appointment`, `cancel_appointment`, `list_customer_appointments`, `get_appointment_details`, `send_booking_link`; con planes de tratamiento (odontología, dermatología, psicología): `get_treatment_plan`, `list_upcoming_sessions`.
- **Ideas del plan original que no existen como herramienta del agente**: seguimiento post-visita y verificación de seguros aceptados. El recordatorio pre-cita no es una herramienta: lo envía el servicio de recordatorios de citas.
- **Temas prohibidos**: ver el prompt base sembrado en `VERTICAL_REGISTRY.salud`.

### 2. Salones de belleza / barberías
- **Mercado**: ~500K+ en LatAm. WhatsApp es el canal #1 de reservas
- **Agente sembrado**: "Luna" (industria `moda_belleza`)
- **Herramientas reales** (`moda_belleza/salon_belleza`, `barberia`, `spa`, `estetica`): la familia de citas (`list_services`, `check_availability`, `create_appointment`, `reschedule_appointment`, `cancel_appointment`, `list_customer_appointments`, `get_appointment_details`, `send_booking_link`); spa y centro de estética añaden `get_treatment_plan` y `list_upcoming_sessions`. Las promociones activas las lee `list_active_offers` (familia `offers`, transversal).
- **Ideas del plan original que no existen como herramienta**: disponibilidad por estilista y envío de promociones personalizadas.

### 3. Inmobiliarias / bienes raíces
- **Mercado**: ~200K+ agencias en LatAm. Alto valor por transacción
- **Agente sembrado**: "Carlos" (industria `inmobiliaria`)
- **Herramientas reales** (`inmobiliaria/venta`, `arriendo`, `comercial`): `search_listings`, `get_listing_details`, `send_listing_image`, más la familia de citas para agendar visitas. El registro del prospecto usa las herramientas de CRM transversales (`ensure_crm_lead`, `create_crm_opportunity`, `move_crm_opportunity_stage`, `record_contact_interest`).
- **Ideas del plan original que no existen como herramienta**: calificar prospecto con presupuesto/financiación, información de créditos. `inmobiliaria/promotora` está en lista de espera e `inmobiliaria/construccion` solo existe para cuentas anteriores.
- **Integraciones**: portales (FincaRaiz, Metrocuadrado, Inmuebles24, Zillow) siguen siendo una idea, no una integración existente.

### 4. Restaurantes / dark kitchens
- **Mercado**: ~1M+ restaurantes en LatAm. Pedidos por WhatsApp son comunes
- **Agente sembrado**: "Luca" (industria `restaurantes`)
- **Herramientas reales** (`restaurantes/casual_dining`, `comida_rapida`, `cafeteria`, `dark_kitchen`): `get_menu`, `get_promotions`, `place_order`, `check_order_status`, `cancel_order`, `list_my_orders`. Restaurante casual y cafetería suman la familia de citas para reservar mesa; comida rápida y dark kitchen no la incluyen.
- **Ideas del plan original que no existen como herramienta**: consulta de disponibilidad de mesas con comensales por separado.

### 5. Automotriz / concesionarios
- **Mercado**: Alto valor por lead. Cada venta = $10K-$50K+ USD
- **Agente sembrado**: "Marco" (industria `automotriz`)
- **Herramientas reales**: concesionario (`automotriz/concesionario`): `search_vehicles`, `get_vehicle_details`, `send_vehicle_image`, `schedule_test_drive` y la familia de citas. Taller (`automotriz/taller`): órdenes de taller (`create_repair_order`, `list_my_repair_orders`, `get_repair_order`, `approve_repair`, `cancel_repair_order`) y citas. Repuestos (`automotriz/repuestos`): catálogo. Alquiler (`automotriz/alquiler`): `check_vehicle_rental_availability`, `create_vehicle_rental`, `list_my_vehicle_rentals`, `get_vehicle_rental`, `cancel_vehicle_rental`.
- **Ideas del plan original que no existen como herramienta**: calificación con retoma, opciones de financiamiento y estimado de retoma.

---

## Industrias Tier 2 — alto potencial *(histórico)*

### 6. Alojamientos turísticos / vacation rentals
- **Mercado**: $175B globalmente. 140K+ property managers profesionales
- **Agente sembrado**: "Maya" (industria `turismo`)
- **Herramientas reales** (`turismo/hotel`, `turismo/alquiler_vacacional`, familia `properties`): `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image`.
- **Ideas del plan original que no existen como herramienta**: cotización de precios por fechas, reglas de la casa, atracciones cercanas, reporte de incidentes y late checkout.
- **Integraciones**: Channel managers. Hoy el único con sincronización en vivo es Hostaway; `guesty` está contemplado en el tipo de proveedor pero sin sync, e `ical` es un fallback de solo lectura.
- **Nota de mercado (jul 2026)**: Airbnb no tenía API pública y Booking.com había pausado nuevos partners; la ruta es vía channel managers.

### 7. Gimnasios / estudios fitness
- **Agente sembrado**: "Alex" (industria `gimnasios`)
- **Herramientas reales** (familia `gyms`, más citas): `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `get_my_class_bookings`, `cancel_class_booking`.
- **Ideas del plan original que no existen como herramienta**: disponibilidad de entrenadores.

### 8. Veterinarias
- **Agente sembrado**: "Dra. Ana" (industria `veterinaria`)
- **Herramientas reales** (`veterinaria/clinica_general`, `hospital_24h`, `exoticos`; familia `pets` más citas): `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`.
- **Terminología**: "mascota", "tutor" (no "dueño").

### 9. Escuelas de idiomas / centros educativos
- **Agente sembrado**: "Pablo" (industria `education`)
- **Herramientas reales** (familia `education`, más citas): `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`. La industria `education` tiene hoy 8 tipos de negocio (idiomas, universitaria, online, capacitación, academia de baile, academia de música o arte, clases particulares y autoescuela).

### 10. Agencias de viajes / tour operators
- **Agente sembrado**: "Maya" (industria `turismo`)
- **Herramientas reales** (`turismo/agencia_viajes`, `turismo/tours`, familia `tours`): `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`, `cancel_tour_booking`, `list_my_tour_bookings`.
- **Ideas del plan original que no existen como herramienta**: cotización formal y datos de destino.

### 11. Seguros
- **Agente sembrado**: "Roberto" (industria `seguros`)
- **Herramientas reales** (familia `insurance`): `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`. Hoy `seguros/broker`, `seguros/vida` y `seguros/auto` son seleccionables; `seguros/aseguradora` y `seguros/salud` están en lista de espera.
- **Ideas del plan original que no existen como herramienta**: agendar consulta con un asesor como herramienta propia de seguros (la agenda es la familia de citas).

### 12. Servicios profesionales (abogados, contadores, arquitectos, consultores)
- **Agente sembrado**: "Elena" (industria `servicios_profesionales`)
- **Herramientas reales** (familia `professionalServices`, más citas): `get_case_status` (solo lectura). La pantalla de operación son los **Casos** del menú.
- **Ideas del plan original que no existen como herramienta**: evaluar caso, solicitar documentos y cotizar honorarios desde el chat.

---

## Industrias Tier 3 — nichos específicos *(histórico)*

### 13. Servicios del hogar (plomería, electricidad, fumigación, limpieza, jardinería, cerrajería, pintura)
- **Herramientas reales** (familia `homeServices`): `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.
- **Ideas del plan original que no existen como herramienta**: despacho de técnico desde el agente y cotización por área.

### 14. Servicios para mascotas (peluquería, guardería, hotel, paseos, adiestramiento)
- **Herramientas reales** (familias `petServices`, `pets`, `petBoarding`): `list_pet_services`, `check_daycare_availability`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`; guardería y hotel suman `create_pet_boarding`, `list_my_pet_boardings`, `get_pet_boarding`, `cancel_pet_boarding`; peluquería, paseos y adiestramiento suman la familia de citas.

### 15. Fotografía / estudios
- **Herramientas reales** (familia `photography`): `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session`. `fotografia/wedding_planner` solo existe para cuentas anteriores (Planeación de bodas es otra industria, `event_planning`, en lista de espera).

---

## Herramientas IA por industria (vigente: ver el catálogo)

Las herramientas del agente se definen en `apps/api/src/modules/conversations/tools/` y se agrupan en **familias** en `apps/api/src/modules/conversations/agent-tool-registry.ts` (`TOOL_FAMILIES`). Cada familia se enciende por agente con `persona.config.tools.<familia>.enabled`, y el manifiesto de cada tipo de negocio decide qué familias se publican. Para ver, tipo de negocio por tipo de negocio, qué familias y qué herramientas tiene, **lee el catálogo generado**: [`docs/business-types-catalog.md`](business-types-catalog.md) (tabla de familias y una ficha por tipo).

Notas de diseño que siguen vigentes:
- Un agente combina las herramientas de la familia de su tipo de negocio con las **transversales**: citas (`appointments`), base de conocimiento (`faqs`, `policies`, `knowledge`), CRM, ofertas y pedidos.
- Las herramientas que dependen de un proveedor externo conectado (`get_restaurant_menu` de Toast, `get_fitness_schedule` de Mindbody, `list_clinic_services` y `check_clinic_availability` de Cliniko) solo existen mientras el tenant tiene ese proveedor conectado (`vertical-integration-tools.ts`).
- La política de cada herramienta —si escribe, si exige confirmación o aprobación humana, si se permite en el probador del agente— vive en `apps/api/src/modules/conversations/tool-policy-registry.ts`.

---

## Módulos backend de verticalización (IMPLEMENTADO)

Además de las tools, la verticalización se apoya en módulos NestJS dedicados:

| Módulo | Ubicación | Qué hace |
|--------|-----------|----------|
| **VerticalsModule** | `modules/verticals/` (service + controller) | Sirve `VERTICAL_REGISTRY`, resuelve terminología/sidebar/KPIs y ejecuta `bootstrapVertical()` en el alta (pipeline, agente, FAQs, servicios, horario) |
| **Vehicle Inventory** | `verticals/vehicle-inventory.{service,controller}.ts` | Inventario automotriz: CRUD de vehículos, marcar vendido, prueba de manejo con detección de conflictos, búsqueda y estadísticas. Rutas `/vehicles/:tenantId` |
| **Staff Scheduling** | `verticals/staff-scheduling.{service,controller}.ts` | Agenda de personal: disponibilidad resolviendo servicio, horario, descansos y citas. Rutas `/staff/:tenantId` |
| **Vertical Analytics** | `modules/vertical-analytics/` | Analítica entre industrias (super_admin): `GET /vertical-analytics/overview`, `/industry/:industry` (detalle por industria) y `/tenant/:tenantId` (KPIs verticales del tenant) |
| **Vertical Integrations** | `modules/vertical-integrations/` | Adaptadores a SaaS verticales externos (Toast POS, Mindbody, Cliniko). Config en `tenant.settings.verticalIntegrations.{provider}`. Habilita las tools de `vertical-integration-tools.ts` solo por proveedor conectado |
| **Channel Manager** | `modules/channel-manager/` | Integración PMS para alquiler vacacional. **Hostaway** con OAuth y sincronización de listings/reservas. El `provider` admite `hostaway`, `guesty`, `ical` y `direct`; solo Hostaway tiene sincronización en vivo |
| **Vacation Rental** | `modules/vacation-rental/` | Propiedades propias, calendario iCal (importación y exportación) y registro de estadías |

> **Nota sobre alquiler vacacional**: existen DOS módulos complementarios —`vacation-rental` (propiedades propias, KB por propiedad e iCal) y `channel-manager` (sincroniza con un PMS externo tipo Hostaway)—. Si una unidad está vinculada a un Channel Manager, esa vinculación gobierna su disponibilidad; una unidad sin vínculo conserva el flujo nativo (ver `docs/product-capabilities-reference.md`).

---

## Adaptación del onboarding

### Paso 1: selección de industria y tipo de negocio (IMPLEMENTADO)
El alta muestra dos selectores: **Industria** y, después, **Tipo de negocio**. Los tipos viven en `VerticalDefinition.subTypes` (cada uno con `key` y `label` en 4 idiomas) y su disponibilidad (seleccionable, lista de espera o solo cuentas existentes) en `subtype-experience-profile.ts`; el alta solo ofrece los seleccionables y el servidor lo vuelve a validar al guardar. Ejemplos reales:
- `salud` → Odontología | Medicina general | Dermatología y medicina estética | Psicología y terapia | Farmacia
- `inmobiliaria` → Venta de inmuebles | Arriendo | Inmuebles comerciales (Promotora inmobiliaria está en lista de espera)
- `restaurantes` → Restaurante casual | Comida rápida | Cafetería | Dark kitchen / Delivery
- `automotriz` → Concesionario | Taller mecánico | Repuestos y accesorios | Alquiler de vehículos
- `moda_belleza` («Belleza y estética») → Salón de belleza | Barbería | Spa y bienestar | Centro de estética

La lista completa, con ids, está en el catálogo.

### Paso 2: lo que el alta pre-configura automáticamente

| Recurso | Qué se pre-carga |
|---------|-------------------|
| **Agente IA** | Nombre, personalidad, prompt base, temas prohibidos |
| **Pipeline stages** | Etapas específicas del sector |
| **FAQs** | Preguntas frecuentes del sector |
| **Servicios** | Servicios placeholder para industrias con booking |
| **Horario** | Default por industria |
| **Handoff triggers** | Palabras clave de escalación por industria |
| **Vertical context** | Bloque `<vertical_context>` en el turno L3 con los campos de `terminology` (`customerNoun`, `customerNounPlural`, `transactionNoun`, `serviceNoun`, `pipelineNoun` e `industryGuidance`) |

Solo seis industrias tienen **receta** de contenido inicial (`salud`, `moda_belleza`, `restaurantes`, `education`, `retail`, `servicios_hogar`), más cuatro capas de tipo para academias de educación. Las demás nacen con la definición base, y `otro` genera su propia receta con IA a partir de la descripción del alta.

### Paso 3: adaptación del dashboard

| Elemento | Cómo cambia |
|----------|-------------|
| **Nombre de los ítems del menú** | Cada industria (y algunos tipos de negocio) renombra el «CRM», el embudo y su pantalla principal. Ejemplos del código: salud → «Pacientes» y embudo «Seguimiento»; restaurantes → «Comensales» y «Oportunidades»; inmobiliaria → «Interesados» y «Negociaciones»; automotriz → «Clientes» y «Negociaciones». El nombre exacto por tipo de negocio está en el catálogo (línea «Menú» de cada ficha). |
| **Módulos visibles** | Salen de las capacidades del tipo de negocio: p. ej. Órdenes de taller para el taller mecánico, Casos para servicios profesionales, Estadías para hotel y alquiler vacacional, Reservas de tours para agencias y tours, Paquetes y servicios para servicios del hogar y fotografía. |
| **KPIs del dashboard** | Métricas relevantes al sector (no-shows para salud, visitas para inmobiliaria). |
| **Orden del menú** | El registro de trabajo diario propio del tipo de negocio va primero (`subtype-navigation.ts`). |

---

## Vacation rentals — detalle de integración *(histórico: análisis de julio 2026)*

### APIs disponibles (estado en jul 2026)

| Plataforma | API | Estado |
|------------|-----|--------|
| Airbnb | Cerrada (solo partners invitados) | No accesible directamente |
| Booking.com | Connectivity API | Pausada para nuevos partners |
| Vrbo/Expedia | Rapid API | Requiere aprobación |
| **Hostaway** | REST API pública | **Implementado** — módulo `channel-manager` (OAuth + sync de listings/reservas) |
| **Guesty** | OAuth 2.0 REST API | Pendiente (el tipo de proveedor lo contempla; sin sync en vivo) |
| **Lodgify** | REST API | Pendiente (adaptador en backlog) |
| **Rentals United** | REST API | Único con Despegar |
| **Cloudbeds** | REST API | Hotels + vacation rental |
| iCal | .ics universal | Fallback (solo lectura, 6-12h de retraso) |

### Arquitectura realmente implementada
El agente de un alojamiento usa la familia `properties` (`check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image`, `list_properties`). La disponibilidad sale del calendario de la unidad o, si la unidad está vinculada a un channel manager, de ese sistema. La arquitectura propuesta originalmente (herramientas `get_pricing`, `get_house_rules`, `create_reservation`, `report_issue`, `escalate_to_host`) **no se implementó con esos nombres**.

### Plan de implementación original *(histórico)*
1. Módulo `vacation-rental` en NestJS con adaptadores para channel managers
2. Sincronización de propiedades: el host conecta su cuenta y Parallly importa sus propiedades
3. KB por propiedad: reglas, amenidades, check-in
4. Motor de reservas multi-noche
5. Workflow de check-in con instrucciones automáticas

---

## Competencia en AI para vacation rentals *(histórico: jul 2026, no se mantiene)*

| Herramienta | Enfoque | Debilidad vs Parallly |
|-------------|---------|----------------------|
| HostBuddy AI | 95% automatización mensajes | Solo SMS/email, no WhatsApp |
| Alfred | Airbnb/Vrbo/WhatsApp | Solo USA, no LatAm |
| Enso Connect | Multi-agente AI | No WhatsApp nativo |
| Hostaway AI | Integrado en PMS | Solo funciona con Hostaway |

---

## Prioridad de implementación *(histórico)*

### Fase 1 — Backend bootstrap: completado
- `bootstrapVertical(industry)` en el alta
- Pre-carga de pipeline, agente IA, FAQs, servicios y horario
- `vertical_context` en `PromptAssemblerService`

### Fase 2 — Dashboard adaptation: completado
- Etiquetas del menú dinámicas por industria (`labelOverrides` + `hiddenItems`)
- KPIs verticales en analytics + `vertical-analytics` entre tenants (super_admin)
- Tipo de negocio en el wizard del alta

### Fase 3 — Vacation Rental module: completado
- Módulo `vacation-rental` (propiedades, iCal, tools de IA, dashboard)
- KB por propiedad
- Motor de reservas multi-noche
- Workflow de check-in

### Fase 4 — Más integraciones
- Hostaway adapter (`channel-manager`): hecho
- Adaptadores POS/PMS externos por industria (`vertical-integrations`: Toast, Mindbody, Cliniko): hecho
- Guesty adapter y Lodgify adapter: pendientes
- Portales inmobiliarios (FincaRaiz, Metrocuadrado, Inmuebles24…): pendientes

---

## Estado de implementación

La lista de verificación de julio de 2026 que vivía aquí (con cifras como «17 verticales» o «17 tool-files») quedó obsoleta y se retiró. Para el estado vigente:
- Industrias, tipos de negocio, disponibilidad, menú y herramientas: [`docs/business-types-catalog.md`](business-types-catalog.md).
- Qué está certificado y qué no: `packages/shared/src/vertical-product-policy.ts` (todas las industrias están hoy en `implemented_not_certified`) y `docs/product-capabilities-reference.md`.
- Pendiente de esta línea de trabajo: adaptadores de channel manager para Guesty y Lodgify.

### Bloqueado por terceros
- Webhooks en tiempo real de Airbnb/Booking (requiere aprobación de partner; hoy solo iCal de lectura con 6-12h de retraso)
