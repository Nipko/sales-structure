# Matriz estructural de herramientas por tipo de negocio

Origen: `863de91941712d29bdc4b277d7a7a5eefe2cf01a`. Fuentes y hashes completos en [JSON](./tool-profile-audit.json).

20 verticales; 76 tipos de negocio; 123 herramientas estáticas; 26 familias nativas; 268 tareas (146 transaccionales).

Este censo comprueba correspondencias de código. No ejecuta herramientas ni modelos, no consulta tenants y no certifica resultados comerciales. MCP dinámico no pertenece al censo estático. La ausencia de evidencia cargada no prueba que una cuenta nunca se haya probado.

Rutas declaradas ocultas: 0. Páginas inexistentes: 0. Herramientas sin definición/handler/política: 0/0/0.

| Vertical / tipo de negocio | Objeto principal | Familias | Tareas | Estrategia |
|---|---|---|---:|---|
| automotriz/alquiler | vehicle_rental | faqs, vehicles, vehicleRentals | 3 | build |
| automotriz/concesionario | vehicle | faqs, appointments, vehicles | 4 | hybrid |
| automotriz/repuestos | catalog_item | faqs, catalog | 5 | hybrid |
| automotriz/taller | repair_order | faqs, appointments, repairOrders | 7 | hybrid |
| construccion/contratista_general | lead | faqs | 1 | hybrid |
| education/capacitacion | course | faqs, appointments, education | 4 | build |
| education/idiomas | course | faqs, appointments, education | 4 | build |
| education/online | course | faqs, appointments, education | 4 | hybrid |
| education/universitaria | course | faqs, appointments, education | 4 | integrate |
| event_planning/weddings | lead | faqs | 1 | hybrid |
| finanzas/asesoria | appointment | faqs, appointments | 3 | integrate |
| finanzas/creditos | appointment | faqs, appointments | 3 | integrate |
| finanzas/pagos_recaudos | lead | faqs | 1 | hybrid |
| fotografia/bodas | photo_session | faqs, photography | 2 | build |
| fotografia/estudio | photo_session | faqs, photography | 2 | build |
| fotografia/eventos | photo_session | faqs, photography | 2 | build |
| fotografia/producto | photo_session | faqs, photography | 2 | hybrid |
| gimnasios/crossfit | membership | faqs, appointments, gyms | 4 | build |
| gimnasios/cycling | membership | faqs, appointments, gyms | 4 | build |
| gimnasios/gimnasio_general | membership | faqs, appointments, gyms | 4 | build |
| gimnasios/martial_arts | membership | faqs, appointments, gyms | 4 | build |
| gimnasios/yoga_pilates | membership | faqs, appointments, gyms | 4 | build |
| inmobiliaria/arriendo | real_estate_listing | faqs, appointments, realEstate | 4 | hybrid |
| inmobiliaria/comercial | real_estate_listing | faqs, appointments, realEstate | 4 | integrate |
| inmobiliaria/promotora | lead | faqs | 1 | hybrid |
| inmobiliaria/venta | real_estate_listing | faqs, appointments, realEstate | 4 | hybrid |
| moda_belleza/barberia | appointment | faqs, appointments | 3 | build |
| moda_belleza/estetica | appointment | faqs, appointments, treatments | 4 | hybrid |
| moda_belleza/salon_belleza | appointment | faqs, appointments | 3 | build |
| moda_belleza/spa | appointment | faqs, appointments, treatments | 4 | build |
| otro/__none__ | catalog_item | faqs, catalog | 5 | define |
| pet_services/adiestramiento | pet | faqs, appointments, petServices, pets | 6 | build |
| pet_services/guarderia | pet_boarding | faqs, petServices, pets, petBoarding | 5 | build |
| pet_services/hotel | pet_boarding | faqs, petServices, pets, petBoarding | 5 | build |
| pet_services/paseos | pet | faqs, appointments, petServices, pets | 6 | build |
| pet_services/peluqueria | pet | faqs, appointments, petServices, pets | 6 | build |
| restaurantes/cafeteria | food_order | faqs, appointments, restaurants | 5 | build |
| restaurantes/casual_dining | food_order | faqs, appointments, restaurants | 5 | hybrid |
| restaurantes/comida_rapida | food_order | faqs, restaurants | 3 | hybrid |
| restaurantes/dark_kitchen | food_order | faqs, restaurants | 3 | integrate |
| retail/electronica | catalog_item | faqs, catalog | 5 | build |
| retail/hogar | catalog_item | faqs, catalog, appointments | 7 | build |
| retail/marketplace | lead | faqs | 1 | hybrid |
| retail/moda | catalog_item | faqs, catalog | 5 | build |
| salud/dental | appointment | faqs, appointments, treatments | 4 | hybrid |
| salud/dermatologia | appointment | faqs, appointments, treatments | 4 | hybrid |
| salud/farmacia | catalog_item | faqs, catalog | 5 | hybrid |
| salud/medica_general | appointment | faqs, appointments | 3 | integrate |
| salud/psicologia | appointment | faqs, appointments, treatments | 4 | integrate |
| seguros/aseguradora | insurance_policy | faqs, insurance | 3 | integrate |
| seguros/auto | insurance_policy | faqs, insurance | 3 | integrate |
| seguros/broker | insurance_policy | faqs, insurance | 3 | hybrid |
| seguros/salud | insurance_policy | faqs, insurance | 3 | integrate |
| seguros/vida | insurance_policy | faqs, insurance | 3 | integrate |
| servicios_hogar/cerrajeria | service_request | faqs, homeServices | 2 | build |
| servicios_hogar/electricidad | service_request | faqs, homeServices | 2 | build |
| servicios_hogar/fumigacion | service_request | faqs, homeServices | 2 | hybrid |
| servicios_hogar/jardineria | service_request | faqs, homeServices | 2 | build |
| servicios_hogar/limpieza | service_request | faqs, homeServices | 2 | build |
| servicios_hogar/pintura | service_request | faqs, homeServices | 2 | build |
| servicios_hogar/plomeria | service_request | faqs, homeServices | 2 | build |
| servicios_profesionales/abogados | professional_case | faqs, appointments, professionalServices | 4 | hybrid |
| servicios_profesionales/arquitectos | professional_case | faqs, appointments, professionalServices | 4 | integrate |
| servicios_profesionales/consultores | professional_case | faqs, appointments, professionalServices | 4 | hybrid |
| servicios_profesionales/contadores | professional_case | faqs, appointments, professionalServices | 4 | hybrid |
| technology/desarrollo | appointment | faqs, appointments | 3 | integrate |
| technology/hardware | catalog_item | faqs, catalog | 5 | build |
| technology/saas | appointment | faqs, appointments | 3 | hybrid |
| technology/soporte_ti_msp | lead | faqs | 1 | hybrid |
| turismo/agencia_viajes | tour_package | faqs, tours | 2 | hybrid |
| turismo/alquiler_vacacional | property_booking | faqs, properties | 3 | hybrid |
| turismo/hotel | property_booking | faqs, properties | 3 | hybrid |
| turismo/tours | tour_package | faqs, tours | 2 | build |
| veterinaria/clinica_general | pet | faqs, appointments, pets | 5 | hybrid |
| veterinaria/exoticos | pet | faqs, appointments, pets | 5 | integrate |
| veterinaria/hospital_24h | pet | faqs, appointments, pets | 5 | integrate |

El JSON enumera cada herramienta, sus fuentes, política, handler, familias y tareas; cada perfil enumera sus rutas, readiness y herramientas. Los permisos de rol/plan/proveedor/datos deben verificarse en los tests y en el recorrido completo: este documento no los deduce de una ruta visible.
