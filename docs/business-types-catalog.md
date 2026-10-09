<!-- GENERADO. No editar a mano: regenera con `node apps/api/scripts/business-types-catalog.cjs --write`. -->

# Catálogo de industrias y tipos de negocio

> **Documento generado desde el código.** No lo edites a mano: tus cambios se pierden y el CI falla si el archivo no coincide con los registros.
>
> - Regenerar: `node apps/api/scripts/business-types-catalog.cjs --write`
> - Comprobar (lo que corre el CI): `node apps/api/scripts/business-types-catalog.cjs --check`, invocado por `docs/audits/2026-09-09/verify-artifacts.cjs`.
> - Si añades una industria, un tipo de negocio, una familia de herramientas o cambias su disponibilidad, regenera y confirma el resultado en el mismo commit.

Este es el único listado vigente de industrias y tipos de negocio. Cualquier cifra o lista distinta en otro documento está desactualizada: manda este archivo.

## Glosario

- **Industria** (en el código y en documentos antiguos: «vertical»): el sector del negocio. Es el primer selector del alta, rotulado «Industria».
- **Tipo de negocio** (en el código: «subtipo» o «perfil»): la especialidad dentro de la industria, identificada como `industria/tipo`. Es el segundo selector del alta, rotulado «Tipo de negocio». Define el menú, las herramientas del agente y los datos que el dueño debe cargar.
- **Disponibilidad** de un tipo de negocio:
  - *seleccionable*: aparece en el alta y se puede elegir.
  - *lista de espera*: existe como tipo canónico pero no se ofrece en el alta; su operación completa sigue cerrada hasta cumplir las puertas indicadas en su ficha («Motivo del cierre»). Lo que se publica hoy para cada uno está en su ficha.
  - *solo cuentas existentes* (`legacy_only` o alias): ya no se ofrece; sigue funcionando para los tenants que lo tenían.
- **Modo de producto**: cómo trata el producto a la industria (ancla de certificación, producto vertical, preset horizontal o genérico). Ninguna industria está certificada hoy salvo que la tabla diga otra cosa.
- **Familia de herramientas**: grupo de herramientas del agente que el dueño activa en el editor del agente. Una herramienta pertenece a una sola familia.

## Resumen

- **20 industrias** en el registro; **18** se ven en el alta (`event_planning` y `construccion` solo tienen tipos en lista de espera y el selector las oculta).
- **85 configuraciones** industria/tipo resolubles: **80 tipos de negocio canónicos** (72 seleccionables + 8 en lista de espera) y, solo para cuentas anteriores, **5 con ficha propia + 3 alias** (`legacy_only`; los alias son ids antiguos sin ficha que resuelven a otro tipo, ver la tabla de alias).
- **123 herramientas estáticas del agente**: 113 repartidas en **26 familias** y 10 fuera de familia (cobros, identidad y herramientas de proveedor externo, ver más abajo). Las herramientas de integraciones MCP son dinámicas y no figuran aquí.
- Recetas de industria (contenido inicial que se siembra en el alta): `salud`, `moda_belleza`, `restaurantes`, `education`, `retail`, `servicios_hogar`. Las demás industrias nacen con la definición base. `otro` genera su propia receta con IA a partir de la descripción del alta. Capas de receta por tipo de negocio (se suman a la receta de la industria): Academia de baile (`education/academia_baile`), Academia de música o arte (`education/academia_musica`), Clases particulares y tutorías (`education/clases_particulares`), Autoescuela (`education/autoescuela`) — 4 en total.

## Industrias

| Industria (`id`) | Nombre en el alta | Modo de producto | Certificación | En el alta | Receta | Tipos (selec. / espera / existentes) |
|---|---|---|---|---|---|---|
| `salud` | Salud | producto vertical | implementado, no certificado | sí | sí | 5 / 0 / 0 |
| `moda_belleza` | Belleza y estética | producto vertical | implementado, no certificado | sí | sí | 4 / 0 / 0 |
| `inmobiliaria` | Inmobiliaria | producto vertical | implementado, no certificado | sí | no | 3 / 1 / 1 |
| `restaurantes` | Restaurantes / Gastronomía | ancla de certificación | implementado, no certificado | sí | sí | 4 / 0 / 0 |
| `automotriz` | Automotriz | producto vertical | implementado, no certificado | sí | no | 4 / 0 / 0 |
| `turismo` | Turismo | ancla de certificación | implementado, no certificado | sí | no | 4 / 0 / 0 |
| `education` | Educación | producto vertical | implementado, no certificado | sí | sí | 8 / 0 / 0 |
| `finanzas` | Finanzas / Banca | preset horizontal | implementado, no certificado | sí | no | 2 / 1 / 1 |
| `servicios_profesionales` | Servicios profesionales | preset horizontal | implementado, no certificado | sí | no | 4 / 0 / 0 |
| `retail` | Retail / Comercio | producto vertical | implementado, no certificado | sí | sí | 3 / 1 / 0 |
| `technology` | Tecnología | preset horizontal | implementado, no certificado | sí | no | 3 / 1 / 1 |
| `veterinaria` | Veterinaria | producto vertical | implementado, no certificado | sí | no | 3 / 0 / 1 |
| `gimnasios` | Gimnasios y Fitness | producto vertical | implementado, no certificado | sí | no | 5 / 0 / 0 |
| `seguros` | Seguros | producto vertical | implementado, no certificado | sí | no | 3 / 2 / 0 |
| `servicios_hogar` | Servicios del hogar | ancla de certificación | implementado, no certificado | sí | sí | 7 / 0 / 0 |
| `pet_services` | Servicios para mascotas | producto vertical | implementado, no certificado | sí | no | 5 / 0 / 0 |
| `fotografia` | Fotografía / Eventos | producto vertical | implementado, no certificado | sí | no | 4 / 0 / 1 |
| `event_planning` | — | producto vertical | implementado, no certificado | no | no | 0 / 1 / 0 |
| `construccion` | — | producto vertical | implementado, no certificado | no | no | 0 / 1 / 0 |
| `otro` | Otro | genérico (fallback) | implementado, no certificado | sí | no | 1 / 0 / 0 |

Anclas de certificación: `restaurantes`, `turismo`, `servicios_hogar`. Los nombres de la columna «Nombre en el alta» son los del selector (`onboarding.industries` en `apps/dashboard/messages/es.json`).

## Familias de herramientas

Nombre = cómo rotula la familia la pantalla Agente IA → Capacidades (`agent.capabilities` en `apps/dashboard/messages/es.json`). El manifiesto de cada tipo de negocio decide qué familias se publican (línea «Familias de herramientas» de cada ficha) y el dueño las enciende en el editor del agente. Las familias `offers`, `policies`, `knowledge`, `orders`, `crm`, `ecommerce` no figuran en ningún tipo porque no dependen de él: las activa la configuración del agente.

| Familia | Nombre en el editor | Herramientas |
|---|---|---|
| `appointments` | Agendamiento de citas | `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details` |
| `catalog` | Catálogo de productos | `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order` |
| `offers` | Promociones activas | `list_active_offers` |
| `faqs` | Preguntas frecuentes | `search_faqs` |
| `policies` | Políticas del negocio | `get_policy` |
| `knowledge` | Documentos y páginas web que el agente puede consultar | `search_knowledge_base` |
| `orders` | Historial de órdenes | `list_customer_orders` |
| `crm` | CRM, prospectos y seguimiento | `get_customer_context`, `ensure_crm_lead`, `create_crm_opportunity`, `move_crm_opportunity_stage`, `create_follow_up_task`, `record_contact_consent`, `add_contact_note`, `tag_contact`, `record_contact_interest` |
| `ecommerce` | Tienda e-commerce | `recommend_products`, `get_order_status` |
| `properties` | Propiedades (alojamiento) | `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image` |
| `tours` | Tours y paquetes | `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`, `cancel_tour_booking`, `list_my_tour_bookings` |
| `treatments` | Planes de tratamiento | `get_treatment_plan`, `list_upcoming_sessions` |
| `realEstate` | Inmuebles | `search_listings`, `get_listing_details`, `send_listing_image` |
| `vehicles` | Vehículos | `search_vehicles`, `get_vehicle_details`, `send_vehicle_image`, `schedule_test_drive` |
| `pets` | Veterinaria | `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet` |
| `restaurants` | Restaurante | `get_menu`, `get_promotions`, `place_order`, `cancel_order`, `check_order_status`, `list_my_orders` |
| `gyms` | Gimnasio | `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `get_my_class_bookings`, `cancel_class_booking` |
| `education` | Educación | `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments` |
| `insurance` | Seguros | `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote` |
| `homeServices` | Servicios del hogar | `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request` |
| `petServices` | Servicios para mascotas | `list_pet_services`, `check_daycare_availability` |
| `vehicleRentals` | Alquiler de vehículos | `check_vehicle_rental_availability`, `create_vehicle_rental`, `list_my_vehicle_rentals`, `get_vehicle_rental`, `cancel_vehicle_rental` |
| `petBoarding` | Guardería y hotel | `create_pet_boarding`, `list_my_pet_boardings`, `get_pet_boarding`, `cancel_pet_boarding` |
| `photography` | Fotografía | `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session` |
| `professionalServices` | Casos del despacho | `get_case_status` |
| `repairOrders` | Órdenes de taller | `create_repair_order`, `list_my_repair_orders`, `get_repair_order`, `approve_repair`, `cancel_repair_order` |

Herramientas estáticas fuera de familia: `apply_discount`, `create_payment_link`, `get_payment_status`, `refund_payment`, `get_restaurant_menu`, `get_fitness_schedule`, `list_clinic_services`, `check_clinic_availability`, `request_identity_code`, `verify_identity_code`. Las de cobros (`apply_discount`, `create_payment_link`, `get_payment_status`, `refund_payment`) requieren la familia de pagos (`payments`) y el plan correspondiente, `request_identity_code` y `verify_identity_code` son las de verificación de identidad, y las 4 restantes (origen «proveedor») solo existen mientras el tenant tiene conectado el sistema externo correspondiente.

Subpermisos que el dueño puede apagar dentro de una familia: `appointments.canBook` (`create_appointment`, `schedule_test_drive`, `send_booking_link`); `appointments.canCancel` (`cancel_appointment`, `reschedule_appointment`); `catalog.canCheckStock` (`check_stock`); `ecommerce.canRecommend` (`recommend_products`).

## Ids antiguos que ya no se pueden elegir (alias)

Estos ids siguen resolviendo para que ninguna cuenta cambie de producto sin avisar. Nunca vuelven al selector del alta.

| Id antiguo | Se resuelve como |
|---|---|
| `veterinaria/peluqueria_canina` | `pet_services/peluqueria` (Peluquería canina/felina) |
| `moda_belleza/boutique` | `retail/moda` (Moda y ropa) |
| `pet_services/tienda` | `retail/moda` (Moda y ropa) |
| `restaurantes/delivery` | `restaurantes/comida_rapida` (Comida rápida) |

## Tipos de negocio por industria

Cómo leer cada ficha:

- **Menú**: lo que ve el dueño en la barra lateral para ese tipo de negocio, con el nombre exacto del menú (varía por industria y por tipo) y la sección donde aparece. «CRM» es el ítem de personas (la pantalla de contactos) y «Embudo» el del embudo de ventas; ambos se renombran por industria. Además de lo listado, todos ven Conversaciones, Agente IA, Base de Conocimiento, Campañas, Análisis, Canales, Usuarios y Facturación según su rol y plan.
- **Familias y herramientas**: las que el producto publica para ese tipo. Las herramientas se limitan además por plan, rol y por lo que el dueño active en el editor del agente.

### Salud (`salud`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: sí.

#### Odontología — `salud/dental`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Pacientes», Embudo «Seguimiento»; «Citas» (`/admin/appointments`) en Trabajo diario; «Planes de tratamiento» (`/admin/treatment-plans`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `treatments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_treatment_plan`, `list_upcoming_sessions`.

#### Medicina general — `salud/medica_general`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Pacientes», Embudo «Seguimiento»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Dermatología y medicina estética — `salud/dermatologia`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Pacientes», Embudo «Seguimiento»; «Citas» (`/admin/appointments`) en Trabajo diario; «Planes de tratamiento» (`/admin/treatment-plans`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `treatments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_treatment_plan`, `list_upcoming_sessions`.

#### Psicología y terapia — `salud/psicologia`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Pacientes», Embudo «Seguimiento»; «Citas» (`/admin/appointments`) en Trabajo diario; «Planes de tratamiento» (`/admin/treatment-plans`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `treatments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_treatment_plan`, `list_upcoming_sessions`.

#### Farmacia — `salud/farmacia`

- Disponibilidad: **seleccionable**.
- Objeto principal: `catalog_item`.
- Menú: CRM «Pacientes», Embudo «Seguimiento»; «Pedidos» (`/admin/orders`) en Trabajo diario; «Productos» (`/admin/inventory`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `catalog`.
- Herramientas: `search_faqs`, `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order`.

### Belleza y estética (`moda_belleza`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: sí.

#### Salón de belleza — `moda_belleza/salon_belleza`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Barbería — `moda_belleza/barberia`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Spa y bienestar — `moda_belleza/spa`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Planes de tratamiento» (`/admin/treatment-plans`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `treatments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_treatment_plan`, `list_upcoming_sessions`.

#### Centro de estética — `moda_belleza/estetica`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Planes de tratamiento» (`/admin/treatment-plans`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `treatments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_treatment_plan`, `list_upcoming_sessions`.

### Inmobiliaria (`inmobiliaria`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: no.

#### Venta de inmuebles — `inmobiliaria/venta`

- Disponibilidad: **seleccionable**.
- Objeto principal: `real_estate_listing`.
- Menú: CRM «Interesados», Embudo «Negociaciones»; «Citas» (`/admin/appointments`) en Trabajo diario; «Propiedades» (`/admin/listings`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `realEstate`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `search_listings`, `get_listing_details`, `send_listing_image`.

#### Arriendo — `inmobiliaria/arriendo`

- Disponibilidad: **seleccionable**.
- Objeto principal: `real_estate_listing`.
- Menú: CRM «Interesados», Embudo «Negociaciones»; «Citas» (`/admin/appointments`) en Trabajo diario; «Inmuebles» (`/admin/listings`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `realEstate`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `search_listings`, `get_listing_details`, `send_listing_image`.

#### Inmuebles comerciales — `inmobiliaria/comercial`

- Disponibilidad: **seleccionable**.
- Objeto principal: `real_estate_listing`.
- Menú: CRM «Interesados», Embudo «Negociaciones»; «Citas» (`/admin/appointments`) en Trabajo diario; «Propiedades» (`/admin/listings`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `realEstate`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `search_listings`, `get_listing_details`, `send_listing_image`.

#### Construcción y proyectos — `inmobiliaria/construccion`

- Disponibilidad: **solo cuentas existentes** · no canónico.
- Motivo del cierre: Taxonomia sin resolver: promotor de proyecto nuevo y contratista de obra son dos negocios con objetos, ciclos y compradores distintos. `business_model` es obligatorio antes de escribir prompt, variables o menu.
- Objeto principal: `real_estate_listing`.
- Menú: CRM «Interesados», Embudo «Negociaciones»; «Citas» (`/admin/appointments`) en Trabajo diario; «Propiedades» (`/admin/listings`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `realEstate`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `search_listings`, `get_listing_details`, `send_listing_image`.

#### Promotora inmobiliaria — `inmobiliaria/promotora`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: El destino taxonómico existe, pero no se habilita hasta tener objetos de proyecto/unidad, pagos y evidencia E2E.
- Objeto principal: `lead`.
- Menú: CRM «Interesados», Embudo «Negociaciones»; sin módulos propios del tipo de negocio.
- Familias de herramientas: `faqs`.
- Herramientas: `search_faqs`.

### Restaurantes / Gastronomía (`restaurantes`)

Modo de producto: ancla de certificación · implementado, no certificado · visible en el alta · receta de industria: sí.

#### Restaurante casual — `restaurantes/casual_dining`

- Disponibilidad: **seleccionable**.
- Objeto principal: `food_order`.
- Menú: CRM «Comensales», Embudo «Oportunidades»; «Pedidos» (`/admin/food-orders`) en Trabajo diario; «Reservaciones» (`/admin/appointments`) en Trabajo diario; «Menú» (`/admin/menu`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `restaurants`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_menu`, `get_promotions`, `place_order`, `cancel_order`, `check_order_status`, `list_my_orders`.

#### Comida rápida — `restaurantes/comida_rapida`

- Disponibilidad: **seleccionable**.
- Objeto principal: `food_order`.
- Menú: CRM «Comensales», Embudo «Oportunidades»; «Pedidos» (`/admin/food-orders`) en Trabajo diario; «Menú» (`/admin/menu`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `restaurants`.
- Herramientas: `search_faqs`, `get_menu`, `get_promotions`, `place_order`, `cancel_order`, `check_order_status`, `list_my_orders`.

#### Cafetería — `restaurantes/cafeteria`

- Disponibilidad: **seleccionable**.
- Objeto principal: `food_order`.
- Menú: CRM «Comensales», Embudo «Oportunidades»; «Pedidos» (`/admin/food-orders`) en Trabajo diario; «Reservaciones» (`/admin/appointments`) en Trabajo diario; «Menú» (`/admin/menu`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `restaurants`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_menu`, `get_promotions`, `place_order`, `cancel_order`, `check_order_status`, `list_my_orders`.

#### Dark kitchen / Delivery — `restaurantes/dark_kitchen`

- Disponibilidad: **seleccionable**.
- Objeto principal: `food_order`.
- Menú: CRM «Comensales», Embudo «Oportunidades»; «Pedidos» (`/admin/food-orders`) en Trabajo diario; «Menú» (`/admin/menu`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `restaurants`.
- Herramientas: `search_faqs`, `get_menu`, `get_promotions`, `place_order`, `cancel_order`, `check_order_status`, `list_my_orders`.

### Automotriz (`automotriz`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: no.

#### Concesionario — `automotriz/concesionario`

- Disponibilidad: **seleccionable**.
- Objeto principal: `vehicle`.
- Menú: CRM «Clientes», Embudo «Negociaciones»; «Citas» (`/admin/appointments`) en Trabajo diario; «Vehículos» (`/admin/vehicles`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `vehicles`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `search_vehicles`, `get_vehicle_details`, `send_vehicle_image`, `schedule_test_drive`.

#### Taller mecánico — `automotriz/taller`

- Disponibilidad: **seleccionable**.
- Objeto principal: `repair_order`.
- Menú: CRM «Clientes», Embudo «Negociaciones»; «Órdenes de trabajo» (`/admin/repair-orders`) en Trabajo diario; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `repairOrders`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `create_repair_order`, `list_my_repair_orders`, `get_repair_order`, `approve_repair`, `cancel_repair_order`.

#### Repuestos y accesorios — `automotriz/repuestos`

- Disponibilidad: **seleccionable**.
- Objeto principal: `catalog_item`.
- Menú: CRM «Clientes», Embudo «Negociaciones»; «Pedidos» (`/admin/orders`) en Trabajo diario; «Repuestos» (`/admin/inventory`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `catalog`.
- Herramientas: `search_faqs`, `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order`.

#### Alquiler de vehículos — `automotriz/alquiler`

- Disponibilidad: **seleccionable**.
- Objeto principal: `vehicle_rental`.
- Menú: CRM «Clientes», Embudo «Negociaciones»; «Reservas» (`/admin/resource-rentals`) en Trabajo diario; «Flota» (`/admin/vehicles`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `vehicles`, `vehicleRentals`.
- Herramientas: `search_faqs`, `search_vehicles`, `get_vehicle_details`, `send_vehicle_image`, `schedule_test_drive`, `check_vehicle_rental_availability`, `create_vehicle_rental`, `list_my_vehicle_rentals`, `get_vehicle_rental`, `cancel_vehicle_rental`.

### Turismo (`turismo`)

Modo de producto: ancla de certificación · implementado, no certificado · visible en el alta · receta de industria: no.

#### Agencia de viajes — `turismo/agencia_viajes`

- Disponibilidad: **seleccionable**.
- Objeto principal: `tour_package`.
- Menú: CRM «Viajeros», Embudo «Oportunidades»; «Reservas de tours» (`/admin/tour-bookings`) en Trabajo diario; «Paquetes» (`/admin/tours`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `tours`.
- Herramientas: `search_faqs`, `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`, `cancel_tour_booking`, `list_my_tour_bookings`.

#### Hotel / Hostal — `turismo/hotel`

- Disponibilidad: **seleccionable**.
- Objeto principal: `property_booking`.
- Menú: CRM «Viajeros», Embudo «Oportunidades»; «Reservas» (`/admin/stays`) en Trabajo diario; «Habitaciones» (`/admin/properties`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `properties`.
- Herramientas: `search_faqs`, `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image`.

#### Tours y actividades — `turismo/tours`

- Disponibilidad: **seleccionable**.
- Objeto principal: `tour_package`.
- Menú: CRM «Viajeros», Embudo «Oportunidades»; «Reservas de tours» (`/admin/tour-bookings`) en Trabajo diario; «Tours» (`/admin/tours`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `tours`.
- Herramientas: `search_faqs`, `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`, `cancel_tour_booking`, `list_my_tour_bookings`.

#### Alquiler vacacional — `turismo/alquiler_vacacional`

- Disponibilidad: **seleccionable**.
- Objeto principal: `property_booking`.
- Menú: CRM «Viajeros», Embudo «Oportunidades»; «Reservas» (`/admin/stays`) en Trabajo diario; «Alojamientos» (`/admin/properties`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `properties`.
- Herramientas: `search_faqs`, `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image`.

### Educación (`education`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: sí.

#### Escuela de idiomas — `education/idiomas`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

#### Universidad / Instituto — `education/universitaria`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

#### Cursos online — `education/online`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

#### Capacitación empresarial — `education/capacitacion`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

#### Academia de baile — `education/academia_baile`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

#### Academia de música o arte — `education/academia_musica`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

#### Clases particulares y tutorías — `education/clases_particulares`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

#### Autoescuela — `education/autoescuela`

- Disponibilidad: **seleccionable**.
- Objeto principal: `course`.
- Menú: CRM «Estudiantes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario; «Cursos» (`/admin/courses`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `appointments`, `education`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments`.

### Finanzas / Banca (`finanzas`)

Modo de producto: preset horizontal · implementado, no certificado · visible en el alta · receta de industria: no.

#### Asesoría financiera — `finanzas/asesoria`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Fintech — `finanzas/fintech`

- Disponibilidad: **solo cuentas existentes** · no canónico.
- Motivo del cierre: "Fintech" no es un producto: pagos, wallet, remesas, neobanco e inversion tienen licencias, ledgers y riesgos incompatibles. Taxonomia, gating y contratos existen; el perfil no se comercializa hasta elegir familia.
- Objeto principal: `appointment`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Pagos y recaudos — `finanzas/pagos_recaudos`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: Solo se habilita con PSP y modelo contractual definidos; el catálogo no autoriza mover dinero ni crear KYC ficticio.
- Objeto principal: `lead`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; sin módulos propios del tipo de negocio.
- Familias de herramientas: `faqs`.
- Herramientas: `search_faqs`.

#### Créditos y préstamos — `finanzas/creditos`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

### Servicios profesionales (`servicios_profesionales`)

Modo de producto: preset horizontal · implementado, no certificado · visible en el alta · receta de industria: no.

#### Abogados — `servicios_profesionales/abogados`

- Disponibilidad: **seleccionable**.
- Objeto principal: `professional_case`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Casos» (`/admin/cases`) en Trabajo diario; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `professionalServices`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_case_status`.

#### Contadores — `servicios_profesionales/contadores`

- Disponibilidad: **seleccionable**.
- Objeto principal: `professional_case`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Casos» (`/admin/cases`) en Trabajo diario; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `professionalServices`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_case_status`.

#### Arquitectos — `servicios_profesionales/arquitectos`

- Disponibilidad: **seleccionable**.
- Objeto principal: `professional_case`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Casos» (`/admin/cases`) en Trabajo diario; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `professionalServices`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_case_status`.

#### Consultores — `servicios_profesionales/consultores`

- Disponibilidad: **seleccionable**.
- Objeto principal: `professional_case`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Casos» (`/admin/cases`) en Trabajo diario; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `professionalServices`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_case_status`.

### Retail / Comercio (`retail`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: sí.

#### Moda y ropa — `retail/moda`

- Disponibilidad: **seleccionable**.
- Objeto principal: `catalog_item`.
- Menú: CRM «Clientes», Embudo «Ventas»; «Pedidos» (`/admin/orders`) en Trabajo diario; «Productos» (`/admin/inventory`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `catalog`.
- Herramientas: `search_faqs`, `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order`.

#### Electrónica — `retail/electronica`

- Disponibilidad: **seleccionable**.
- Objeto principal: `catalog_item`.
- Menú: CRM «Clientes», Embudo «Ventas»; «Pedidos» (`/admin/orders`) en Trabajo diario; «Productos» (`/admin/inventory`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `catalog`.
- Herramientas: `search_faqs`, `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order`.

#### Hogar y decoración — `retail/hogar`

- Disponibilidad: **seleccionable**.
- Objeto principal: `catalog_item`.
- Menú: CRM «Clientes», Embudo «Ventas»; «Pedidos» (`/admin/orders`) en Trabajo diario; «Productos» (`/admin/inventory`) en Catálogo y recursos; «Citas» (`/admin/appointments`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `catalog`, `appointments`.
- Herramientas: `search_faqs`, `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Marketplace / E-commerce — `retail/marketplace`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: Operar un marketplace exige merchant of record, alta de vendedores con KYB, orden multi-vendedor, comision, payout y disputas. Reutilizar el comercio monovendedor produciria ordenes que nadie puede liquidar.
- Objeto principal: `lead`.
- Menú: CRM «Clientes», Embudo «Ventas»; sin módulos propios del tipo de negocio.
- Familias de herramientas: `faqs`.
- Herramientas: `search_faqs`.

### Tecnología (`technology`)

Modo de producto: preset horizontal · implementado, no certificado · visible en el alta · receta de industria: no.

#### SaaS — `technology/saas`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Cuentas», Embudo «Pipeline»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Consultoría TI — `technology/consultoria_ti`

- Disponibilidad: **solo cuentas existentes** · no canónico.
- Motivo del cierre: Mesa de servicio MSP y consultoria por proyectos son dos productos: uno vive de SLA y activos, el otro de alcance y entregables. Elegir antes de construir.
- Objeto principal: `appointment`.
- Menú: CRM «Cuentas», Embudo «Pipeline»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Soporte TI y MSP — `technology/soporte_ti_msp`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: El perfil MSP queda cerrado hasta integrar el sistema de registro y probar identidad, autorización y auditoría E2E.
- Objeto principal: `lead`.
- Menú: CRM «Cuentas», Embudo «Pipeline»; sin módulos propios del tipo de negocio.
- Familias de herramientas: `faqs`.
- Herramientas: `search_faqs`.

#### Desarrollo de software — `technology/desarrollo`

- Disponibilidad: **seleccionable**.
- Objeto principal: `appointment`.
- Menú: CRM «Cuentas», Embudo «Pipeline»; «Citas» (`/admin/appointments`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`.

#### Hardware y redes — `technology/hardware`

- Disponibilidad: **seleccionable**.
- Objeto principal: `catalog_item`.
- Menú: CRM «Cuentas», Embudo «Pipeline»; «Pedidos» (`/admin/orders`) en Trabajo diario; «Equipos» (`/admin/inventory`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `catalog`.
- Herramientas: `search_faqs`, `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order`.

### Veterinaria (`veterinaria`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: no.

#### Clínica de pequeñas especies — `veterinaria/clinica_general`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet`.
- Menú: CRM «Tutores», Embudo «Seguimiento»; «Agenda» (`/admin/appointments`) en Trabajo diario; «Mascotas» (`/admin/pets`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `pets`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`.

#### Hospital veterinario 24h — `veterinaria/hospital_24h`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet`.
- Menú: CRM «Tutores», Embudo «Seguimiento»; «Agenda» (`/admin/appointments`) en Trabajo diario; «Mascotas» (`/admin/pets`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `pets`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`.

#### Animales exóticos — `veterinaria/exoticos`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet`.
- Menú: CRM «Tutores», Embudo «Seguimiento»; «Agenda» (`/admin/appointments`) en Trabajo diario; «Mascotas» (`/admin/pets`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `pets`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`.

#### Peluquería canina / felina — `veterinaria/peluqueria_canina`

- Disponibilidad: **solo cuentas existentes** · alias de `pet_services/peluqueria` (las cuentas nuevas usan ese).
- Menú y herramientas: los de `pet_services/peluqueria`.

### Gimnasios y Fitness (`gimnasios`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: no.

#### Gimnasio tradicional — `gimnasios/gimnasio_general`

- Disponibilidad: **seleccionable**.
- Objeto principal: `membership`.
- Menú: CRM «Miembros», Embudo «Oportunidades»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Membresías» (`/admin/memberships`) en Trabajo diario; «Clases» (`/admin/classes`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `gyms`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `get_my_class_bookings`, `cancel_class_booking`.

#### Box CrossFit — `gimnasios/crossfit`

- Disponibilidad: **seleccionable**.
- Objeto principal: `membership`.
- Menú: CRM «Miembros», Embudo «Oportunidades»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Membresías» (`/admin/memberships`) en Trabajo diario; «Clases» (`/admin/classes`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `gyms`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `get_my_class_bookings`, `cancel_class_booking`.

#### Estudio de yoga / pilates — `gimnasios/yoga_pilates`

- Disponibilidad: **seleccionable**.
- Objeto principal: `membership`.
- Menú: CRM «Miembros», Embudo «Oportunidades»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Membresías» (`/admin/memberships`) en Trabajo diario; «Clases» (`/admin/classes`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `gyms`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `get_my_class_bookings`, `cancel_class_booking`.

#### Cycling / spinning — `gimnasios/cycling`

- Disponibilidad: **seleccionable**.
- Objeto principal: `membership`.
- Menú: CRM «Miembros», Embudo «Oportunidades»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Membresías» (`/admin/memberships`) en Trabajo diario; «Clases» (`/admin/classes`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `gyms`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `get_my_class_bookings`, `cancel_class_booking`.

#### Artes marciales — `gimnasios/martial_arts`

- Disponibilidad: **seleccionable**.
- Objeto principal: `membership`.
- Menú: CRM «Miembros», Embudo «Oportunidades»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Membresías» (`/admin/memberships`) en Trabajo diario; «Clases» (`/admin/classes`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `gyms`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `get_my_class_bookings`, `cancel_class_booking`.

### Seguros (`seguros`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: no.

#### Broker / Corredor — `seguros/broker`

- Disponibilidad: **seleccionable**.
- Objeto principal: `insurance_policy`.
- Menú: CRM «Asegurados», Embudo «Oportunidades»; «Pólizas» (`/admin/insurance`) en Trabajo diario.
- Familias de herramientas: `faqs`, `insurance`.
- Herramientas: `search_faqs`, `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`.

#### Aseguradora — `seguros/aseguradora`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: Una carrier necesita PAS, billing y claims con autoridad de suscripcion. Parallly es capa conversacional sobre esos sistemas, nunca su reemplazo.
- Objeto principal: `insurance_policy`.
- Menú: CRM «Asegurados», Embudo «Oportunidades»; «Pólizas» (`/admin/insurance`) en Trabajo diario.
- Familias de herramientas: `faqs`, `insurance`.
- Herramientas: `search_faqs`, `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`.

#### Especialista en vida — `seguros/vida`

- Disponibilidad: **seleccionable**.
- Objeto principal: `insurance_policy`.
- Menú: CRM «Asegurados», Embudo «Oportunidades»; «Pólizas» (`/admin/insurance`) en Trabajo diario.
- Familias de herramientas: `faqs`, `insurance`.
- Herramientas: `search_faqs`, `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`.

#### Especialista en auto — `seguros/auto`

- Disponibilidad: **seleccionable**.
- Objeto principal: `insurance_policy`.
- Menú: CRM «Asegurados», Embudo «Oportunidades»; «Pólizas» (`/admin/insurance`) en Trabajo diario.
- Familias de herramientas: `faqs`, `insurance`.
- Herramientas: `search_faqs`, `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`.

#### Especialista en salud — `seguros/salud`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: Elegibilidad, autorizaciones y EOB son PHI con verificacion reforzada y core del pagador. Sin ese sistema no hay respuesta correcta que dar.
- Objeto principal: `insurance_policy`.
- Menú: CRM «Asegurados», Embudo «Oportunidades»; «Pólizas» (`/admin/insurance`) en Trabajo diario.
- Familias de herramientas: `faqs`, `insurance`.
- Herramientas: `search_faqs`, `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`.

### Servicios del hogar (`servicios_hogar`)

Modo de producto: ancla de certificación · implementado, no certificado · visible en el alta · receta de industria: sí.

#### Plomería — `servicios_hogar/plomeria`

- Disponibilidad: **seleccionable**.
- Objeto principal: `service_request`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Servicios» (`/admin/service-requests`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `homeServices`.
- Herramientas: `search_faqs`, `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.

#### Electricidad — `servicios_hogar/electricidad`

- Disponibilidad: **seleccionable**.
- Objeto principal: `service_request`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Servicios» (`/admin/service-requests`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `homeServices`.
- Herramientas: `search_faqs`, `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.

#### Fumigación — `servicios_hogar/fumigacion`

- Disponibilidad: **seleccionable**.
- Objeto principal: `service_request`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Servicios» (`/admin/service-requests`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `homeServices`.
- Herramientas: `search_faqs`, `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.

#### Limpieza — `servicios_hogar/limpieza`

- Disponibilidad: **seleccionable**.
- Objeto principal: `service_request`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Servicios» (`/admin/service-requests`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `homeServices`.
- Herramientas: `search_faqs`, `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.

#### Jardinería — `servicios_hogar/jardineria`

- Disponibilidad: **seleccionable**.
- Objeto principal: `service_request`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Servicios» (`/admin/service-requests`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `homeServices`.
- Herramientas: `search_faqs`, `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.

#### Cerrajería — `servicios_hogar/cerrajeria`

- Disponibilidad: **seleccionable**.
- Objeto principal: `service_request`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Servicios» (`/admin/service-requests`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `homeServices`.
- Herramientas: `search_faqs`, `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.

#### Pintura — `servicios_hogar/pintura`

- Disponibilidad: **seleccionable**.
- Objeto principal: `service_request`.
- Menú: CRM «Clientes», Embudo «Oportunidades»; «Servicios» (`/admin/service-requests`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `homeServices`.
- Herramientas: `search_faqs`, `list_home_services`, `check_home_service_availability`, `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request`.

### Servicios para mascotas (`pet_services`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: no.

#### Peluquería canina/felina — `pet_services/peluqueria`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet`.
- Menú: CRM «Tutores», Embudo «Embudo de ventas»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Servicios» (`/admin/pets`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `petServices`, `pets`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `list_pet_services`, `check_daycare_availability`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`.

#### Guardería diurna — `pet_services/guarderia`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet_boarding`.
- Menú: CRM «Tutores», Embudo «Embudo de ventas»; «Estadías» (`/admin/resource-rentals`) en Trabajo diario; «Mascotas» (`/admin/pets`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `petServices`, `pets`, `petBoarding`.
- Herramientas: `search_faqs`, `list_pet_services`, `check_daycare_availability`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`, `create_pet_boarding`, `list_my_pet_boardings`, `get_pet_boarding`, `cancel_pet_boarding`.

#### Hotel canino — `pet_services/hotel`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet_boarding`.
- Menú: CRM «Tutores», Embudo «Embudo de ventas»; «Estadías» (`/admin/resource-rentals`) en Trabajo diario; «Mascotas» (`/admin/pets`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `petServices`, `pets`, `petBoarding`.
- Herramientas: `search_faqs`, `list_pet_services`, `check_daycare_availability`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`, `create_pet_boarding`, `list_my_pet_boardings`, `get_pet_boarding`, `cancel_pet_boarding`.

#### Paseos — `pet_services/paseos`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet`.
- Menú: CRM «Tutores», Embudo «Embudo de ventas»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Mascotas» (`/admin/pets`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `petServices`, `pets`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `list_pet_services`, `check_daycare_availability`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`.

#### Adiestramiento — `pet_services/adiestramiento`

- Disponibilidad: **seleccionable**.
- Objeto principal: `pet`.
- Menú: CRM «Tutores», Embudo «Embudo de ventas»; «Reservas» (`/admin/appointments`) en Trabajo diario; «Mascotas» (`/admin/pets`) en Trabajo diario.
- Familias de herramientas: `faqs`, `appointments`, `petServices`, `pets`.
- Herramientas: `search_faqs`, `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details`, `list_pet_services`, `check_daycare_availability`, `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet`.

### Fotografía / Eventos (`fotografia`)

Modo de producto: producto vertical · implementado, no certificado · visible en el alta · receta de industria: no.

#### Estudio fotográfico — `fotografia/estudio`

- Disponibilidad: **seleccionable**.
- Objeto principal: `photo_session`.
- Menú: CRM «CRM», Embudo «Oportunidades»; «Sesiones» (`/admin/photo-sessions`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `photography`.
- Herramientas: `search_faqs`, `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session`.

#### Wedding photography — `fotografia/bodas`

- Disponibilidad: **seleccionable**.
- Objeto principal: `photo_session`.
- Menú: CRM «CRM», Embudo «Oportunidades»; «Paquetes» (`/admin/photo-sessions`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `photography`.
- Herramientas: `search_faqs`, `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session`.

#### Eventos sociales y corporativos — `fotografia/eventos`

- Disponibilidad: **seleccionable**.
- Objeto principal: `photo_session`.
- Menú: CRM «CRM», Embudo «Oportunidades»; «Sesiones» (`/admin/photo-sessions`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `photography`.
- Herramientas: `search_faqs`, `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session`.

#### Fotografía de producto — `fotografia/producto`

- Disponibilidad: **seleccionable**.
- Objeto principal: `photo_session`.
- Menú: CRM «CRM», Embudo «Oportunidades»; «Sesiones» (`/admin/photo-sessions`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `photography`.
- Herramientas: `search_faqs`, `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session`.

#### Wedding planner — `fotografia/wedding_planner`

- Disponibilidad: **solo cuentas existentes** · no canónico.
- Motivo del cierre: Recibe el producto de fotografia completo, que no es su negocio: un planner opera evento, presupuesto, proveedores, invitados y seating. Migra a Event Planning.
- Objeto principal: `photo_session`.
- Menú: CRM «CRM», Embudo «Oportunidades»; «Sesiones» (`/admin/photo-sessions`) en Trabajo diario; «Paquetes y servicios» (`/admin/service-catalog`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `photography`.
- Herramientas: `search_faqs`, `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session`.

### event_planning (`event_planning`)

Modo de producto: producto vertical · implementado, no certificado · oculta en el alta · receta de industria: no.

#### Planeación de bodas — `event_planning/weddings`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: La clasificación ya es correcta; la operación sigue cerrada hasta implementar objetos, permisos, pagos y evidencia E2E.
- Objeto principal: `lead`.
- Menú: CRM «CRM», Embudo «Embudo de ventas»; sin módulos propios del tipo de negocio.
- Familias de herramientas: `faqs`.
- Herramientas: `search_faqs`.

### construccion (`construccion`)

Modo de producto: producto vertical · implementado, no certificado · oculta en el alta · receta de industria: no.

#### Contratista general — `construccion/contratista_general`

- Disponibilidad: **lista de espera**.
- Motivo del cierre: El destino taxonómico existe, pero sus writers esperan sistema de registro, permisos de obra y evidencia E2E.
- Objeto principal: `lead`.
- Menú: CRM «CRM», Embudo «Embudo de ventas»; sin módulos propios del tipo de negocio.
- Familias de herramientas: `faqs`.
- Herramientas: `search_faqs`.

### Otro (`otro`)

Modo de producto: genérico (fallback) · implementado, no certificado · visible en el alta · receta de industria: no.

#### Otro (sin tipo de negocio) — `otro/__none__`

- Disponibilidad: **seleccionable**.
- Objeto principal: `catalog_item`.
- Menú: CRM «CRM», Embudo «Embudo de ventas»; «Pedidos» (`/admin/orders`) en Trabajo diario; «Inventario» (`/admin/inventory`) en Catálogo y recursos.
- Familias de herramientas: `faqs`, `catalog`.
- Herramientas: `search_faqs`, `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order`, `list_my_catalog_orders`, `get_catalog_order`, `cancel_catalog_order`.

