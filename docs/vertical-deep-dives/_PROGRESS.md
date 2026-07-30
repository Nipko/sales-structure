# Deep-dives por vertical — progreso

> Un dossier por vertical, uno a la vez, siguiendo `_TEMPLATE.md`. Orden = prioridad de mercado según `market-research-latam.md` §3, con turismo adelantado por la decisión GTM pendiente. Cada dossier se commitea al completarse: si un límite de sesión corta el proceso, lo hecho queda entero y la próxima sesión retoma desde la primera fila `pendiente`.

| # | Vertical | Estado | Fecha | Notas |
|---|----------|--------|-------|-------|
| 1 | moda_belleza | completo | 2026-07-29 | INVERTIR (en belleza, no en moda): la apuesta #1 se sostiene — F1 capacidad + inactivity vivo + 3 lock-ins con bases ya en código; boutique migra a retail y la estética vive acá |
| 2 | salud | completo | 2026-07-29 | INVERTIR en dos velocidades: especialistas solistas funcionan HOY; dental (el que paga) exige F2 staff + recall vivo; Cliniko es el PMS equivocado (LatAm paga Dentalink); estética no-médica cede a belleza, salud retiene dermatología |
| 3 | inmobiliaria | completo | 2026-07-29 | INVERTIR con cirugía en el ciclo de la visita: la top-4 de demanda más barata de ganar (inventario+tools ya reales); el gap es visita sin listing + conflicto invertido + ruteo muerto + import de portales (importar, no publicar) |
| 4 | gimnasios | completo | 2026-07-29 | INVERTIR en despertar, no en construir: la reserva de clase con cupo YA existe entera (módulo gyms de mayo, corrige a la auditoría) pero es inalcanzable — nadie puede crear miembros (0 UI) y el motor de citas secuestra "quiero reservar"; nada que portar de tour_inventory, falta recurrencia semanal + waitlist + inactivity |
| 5 | turismo | completo | 2026-07-29 | INVERTIR en reparar y monetizar lo hundido: create_tour_booking está ROTO desde may-27 (INSERT 17 placeholders/15 params, quema cupos por intento) y el trial (maxProperties=0) bloquea el día 1; el GTM Hostaway NO necesita el puente cm_→properties (properties+iCal ya alcanzan) — faltan ~3-5 semanas (fix + pre-arrival + review + UI Hostaway), no los 2-3 meses del research |
| 6 | restaurantes | completo | 2026-07-29 | INVERTIR en el pedido, no en la mesa: partySize es el hueco del caso secundario (LatAm = pedidos WhatsApp); lo que corta la venta es el circuito del pedido — food_order.created sin listeners (nadie se entera), promociones enteras sin UI (patrón gimnasios) y checklist que manda el menú a la KB dejando place_order sin catálogo; SQL de restaurants.service.ts limpio (sin el patrón tours) |
| 7 | veterinaria | completo | 2026-07-29 | MANTENER + una jugada: el rubro no está rankeado en NINGÚN doc de mercado (invertir GTM sería turismo otra vez) pero el código es el mejor del clúster para el solista; el recall de vacunas se enciende casi gratis (next_due_at ya indexado, el evaluador temporal es el mismo de dental/gym/belleza); frontera cerrada: médico=vet, grooming/hotel=pet_services (label duplicado en el alta); cazados: update_pet no-op silencioso (claves snake vs camel) y create_appointment sin duration_type (la pernocta open se consulta pero no se reserva) |
| 8 | automotriz | completo | 2026-07-29 | INVERTIR en costura, no en construcción: el motor encendido ayer funciona (SQL limpio, DDL sin drift, página completa) pero 3 cables anulan el caso central — vehicleInventory=false en emprendedor/starter repite la trampa trial de turismo (403 el día 1), "prueba de manejo"/"financiación" son handoff triggers por substring que escalan la conversión ANTES del booking engine, y la UI no carga fotos (send_vehicle_image muerta); GET /search sombreado por orden de rutas → searchVehiclesForAI (bug centavos) sigue con 0 llamadores, confirma MATAR; vehicle_inquiries 0 escritores/0 lectores; test drive del chat sin vehicleId (linkage vía appointments.metadata ya viable) |
| 9 | education | pendiente | | Recién desbloqueada (schema) |
| 10 | seguros | pendiente | | Regulada; verificación de identidad en tools |
| 11 | servicios_hogar | pendiente | | |
| 12 | pet_services | pendiente | | Frontera con veterinaria |
| 13 | fotografia | pendiente | | |
| 14 | retail | pendiente | | Decisión e-commerce pendiente |
| 15 | finanzas | pendiente | | Candidata a GENÉRICA-HONESTA |
| 16 | servicios_profesionales | pendiente | | Candidata a GENÉRICA-HONESTA |
| 17 | technology | pendiente | | Candidata a GENÉRICA-HONESTA |
| 18 | otro | pendiente | | El fallback: dignidad del caso no cubierto |
