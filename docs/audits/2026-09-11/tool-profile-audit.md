# Matriz estructural de herramientas por tipo de negocio

Origen: `12dfd746bd7cd2c2bff6a7c9ab29ff45ee605272`. Fuentes y hashes completos en [JSON](./tool-profile-audit.json).

20 verticales; 76 tipos de negocio; 123 herramientas estáticas; 26 familias nativas; 420 tareas (146 transaccionales).

Este censo comprueba correspondencias de código. No ejecuta herramientas ni modelos, no consulta tenants y no certifica resultados comerciales. MCP dinámico no pertenece al censo estático. La ausencia de evidencia cargada no prueba que una cuenta nunca se haya probado.

Rutas declaradas ocultas: 0. Páginas inexistentes: 0. Herramientas sin definición/handler/política: 0/0/0. Controles del runtime fuera de Assist/sin respaldo: 0/0.

| Vertical / tipo de negocio | Objeto principal | Familias | Tareas | Estrategia |
|---|---|---|---:|---|
| automotriz/alquiler | vehicle_rental | faqs, vehicles, vehicleRentals | 5 | build |
| automotriz/concesionario | vehicle | faqs, appointments, vehicles | 6 | hybrid |
| automotriz/repuestos | catalog_item | faqs, catalog | 7 | hybrid |
| automotriz/taller | repair_order | faqs, appointments, repairOrders | 9 | hybrid |
| construccion/contratista_general | lead | faqs | 3 | hybrid |
| education/capacitacion | course | faqs, appointments, education | 6 | build |
| education/idiomas | course | faqs, appointments, education | 6 | build |
| education/online | course | faqs, appointments, education | 6 | hybrid |
| education/universitaria | course | faqs, appointments, education | 6 | integrate |
| event_planning/weddings | lead | faqs | 3 | hybrid |
| finanzas/asesoria | appointment | faqs, appointments | 5 | integrate |
| finanzas/creditos | appointment | faqs, appointments | 5 | integrate |
| finanzas/pagos_recaudos | lead | faqs | 3 | hybrid |
| fotografia/bodas | photo_session | faqs, photography | 4 | build |
| fotografia/estudio | photo_session | faqs, photography | 4 | build |
| fotografia/eventos | photo_session | faqs, photography | 4 | build |
| fotografia/producto | photo_session | faqs, photography | 4 | hybrid |
| gimnasios/crossfit | membership | faqs, appointments, gyms | 6 | build |
| gimnasios/cycling | membership | faqs, appointments, gyms | 6 | build |
| gimnasios/gimnasio_general | membership | faqs, appointments, gyms | 6 | build |
| gimnasios/martial_arts | membership | faqs, appointments, gyms | 6 | build |
| gimnasios/yoga_pilates | membership | faqs, appointments, gyms | 6 | build |
| inmobiliaria/arriendo | real_estate_listing | faqs, appointments, realEstate | 6 | hybrid |
| inmobiliaria/comercial | real_estate_listing | faqs, appointments, realEstate | 6 | integrate |
| inmobiliaria/promotora | lead | faqs | 3 | hybrid |
| inmobiliaria/venta | real_estate_listing | faqs, appointments, realEstate | 6 | hybrid |
| moda_belleza/barberia | appointment | faqs, appointments | 5 | build |
| moda_belleza/estetica | appointment | faqs, appointments, treatments | 6 | hybrid |
| moda_belleza/salon_belleza | appointment | faqs, appointments | 5 | build |
| moda_belleza/spa | appointment | faqs, appointments, treatments | 6 | build |
| otro/__none__ | catalog_item | faqs, catalog | 7 | define |
| pet_services/adiestramiento | pet | faqs, appointments, petServices, pets | 8 | build |
| pet_services/guarderia | pet_boarding | faqs, petServices, pets, petBoarding | 7 | build |
| pet_services/hotel | pet_boarding | faqs, petServices, pets, petBoarding | 7 | build |
| pet_services/paseos | pet | faqs, appointments, petServices, pets | 8 | build |
| pet_services/peluqueria | pet | faqs, appointments, petServices, pets | 8 | build |
| restaurantes/cafeteria | food_order | faqs, appointments, restaurants | 7 | build |
| restaurantes/casual_dining | food_order | faqs, appointments, restaurants | 7 | hybrid |
| restaurantes/comida_rapida | food_order | faqs, restaurants | 5 | hybrid |
| restaurantes/dark_kitchen | food_order | faqs, restaurants | 5 | integrate |
| retail/electronica | catalog_item | faqs, catalog | 7 | build |
| retail/hogar | catalog_item | faqs, catalog, appointments | 9 | build |
| retail/marketplace | lead | faqs | 3 | hybrid |
| retail/moda | catalog_item | faqs, catalog | 7 | build |
| salud/dental | appointment | faqs, appointments, treatments | 6 | hybrid |
| salud/dermatologia | appointment | faqs, appointments, treatments | 6 | hybrid |
| salud/farmacia | catalog_item | faqs, catalog | 7 | hybrid |
| salud/medica_general | appointment | faqs, appointments | 5 | integrate |
| salud/psicologia | appointment | faqs, appointments, treatments | 6 | integrate |
| seguros/aseguradora | insurance_policy | faqs, insurance | 5 | integrate |
| seguros/auto | insurance_policy | faqs, insurance | 5 | integrate |
| seguros/broker | insurance_policy | faqs, insurance | 5 | hybrid |
| seguros/salud | insurance_policy | faqs, insurance | 5 | integrate |
| seguros/vida | insurance_policy | faqs, insurance | 5 | integrate |
| servicios_hogar/cerrajeria | service_request | faqs, homeServices | 4 | build |
| servicios_hogar/electricidad | service_request | faqs, homeServices | 4 | build |
| servicios_hogar/fumigacion | service_request | faqs, homeServices | 4 | hybrid |
| servicios_hogar/jardineria | service_request | faqs, homeServices | 4 | build |
| servicios_hogar/limpieza | service_request | faqs, homeServices | 4 | build |
| servicios_hogar/pintura | service_request | faqs, homeServices | 4 | build |
| servicios_hogar/plomeria | service_request | faqs, homeServices | 4 | build |
| servicios_profesionales/abogados | professional_case | faqs, appointments, professionalServices | 6 | hybrid |
| servicios_profesionales/arquitectos | professional_case | faqs, appointments, professionalServices | 6 | integrate |
| servicios_profesionales/consultores | professional_case | faqs, appointments, professionalServices | 6 | hybrid |
| servicios_profesionales/contadores | professional_case | faqs, appointments, professionalServices | 6 | hybrid |
| technology/desarrollo | appointment | faqs, appointments | 5 | integrate |
| technology/hardware | catalog_item | faqs, catalog | 7 | build |
| technology/saas | appointment | faqs, appointments | 5 | hybrid |
| technology/soporte_ti_msp | lead | faqs | 3 | hybrid |
| turismo/agencia_viajes | tour_package | faqs, tours | 4 | hybrid |
| turismo/alquiler_vacacional | property_booking | faqs, properties | 5 | hybrid |
| turismo/hotel | property_booking | faqs, properties | 5 | hybrid |
| turismo/tours | tour_package | faqs, tours | 4 | build |
| veterinaria/clinica_general | pet | faqs, appointments, pets | 7 | hybrid |
| veterinaria/exoticos | pet | faqs, appointments, pets | 7 | integrate |
| veterinaria/hospital_24h | pet | faqs, appointments, pets | 7 | integrate |

El JSON enumera cada herramienta, sus fuentes, política, handler, familias y tareas; cada perfil enumera sus rutas, readiness y herramientas. Los permisos de rol/plan/proveedor/datos deben verificarse en los tests y en el recorrido completo: este documento no los deduce de una ruta visible.
