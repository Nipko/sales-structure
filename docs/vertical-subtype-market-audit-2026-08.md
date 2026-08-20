# Auditoría competitiva 1:1 de verticales y subtipos — agosto de 2026

**Producto:** Parallly / Parallext Engine  
**Corte de código:** `1d483a2c2af6f3c2370fa40a929049b66dc58424`  
**Fecha de investigación:** 20 de agosto de 2026  
**Alcance:** 18 verticales, 75 subtipos canónicos y la configuración genérica `otro`  
**Naturaleza:** investigación y auditoría; este documento no implementa cambios ni certifica producción

**Complementos:** [auditoría 1:1 de prompts, variables, lenguaje y navegación](./vertical-subtype-prompt-navigation-audit-2026-08.md) · [auditoría integral de tools](./agent-tool-subtype-cohesion-audit-2026-08.md) · [packs lingüísticos por país](./country-language-behavior-packs-latam-2026-08.md) · [scorecard de experiencia](./vertical-subtype-experience-scorecard-2026-08.csv) · [plan maestro de implementación](./vertical-full-implementation-plan-2026-08.md)

## 1. Dictamen ejecutivo

Parallly tiene una base horizontal valiosa —mensajería multicanal, CRM, pipeline, RAG, herramientas de IA, handoff, automatización, analítica, cuatro idiomas y aislamiento por tenant—, pero **todavía no tiene 75 productos verticales diferenciados**. Tiene 75 opciones de selector que terminan resolviéndose en **27 perfiles funcionales efectivos**. De los 75 subtipos:

- **43 son esencialmente una etiqueta y un slug**: el subtipo llega como contexto al prompt, pero no cambia de forma determinista herramientas, objetos, interfaz ni flujo operativo;
- 32 tienen algún delta; 13 de esos deltas son solamente persona, servicio semilla, horario o nivel de privacidad;
- las 76 configuraciones pasan el contrato estático de 4 idiomas × 5 planes, pero la certificación real sigue en **0/18 verticales E2E**;
- las 18 verticales están marcadas en código como `implemented_not_certified` y `deepMarketingAllowed=false`.
- el inventario posterior confirma 95 tools estáticas alineadas con policy/executor, pero solo 48,3/100 de cohesión promedio por perfil: 17 de las 76 configuraciones están bloqueadas en la cadena tool→dato→writer;
- no existe regionalización operacional por país: la plataforma comercializa 15 mercados LatAm/BR más EE. UU./Canadá, pero el agente no recibe un country pack versionado ni filtra RAG regulatorio por jurisdicción.

La mejor preparación competitiva actual no supera la banda de **base funcional no competitiva**. Ningún subtipo alcanza 70/100. Las configuraciones más cercanas a un piloto controlado son tours, venta inmobiliaria, alquiler vacacional profesional, hotel boutique, restaurante de servicio rápido y concesionario. Esto no significa que puedan venderse como reemplazo de Rezdy, Lofty, Guesty, Cloudbeds, Toast o Tekion: significa que ya existe una base conversacional de dominio que puede profundizarse o integrarse.

### Hallazgos que cambian la prioridad

1. **El peor subtipo absoluto es `fotografia/wedding_planner`.** Se presenta como organización de bodas, pero recibe sesiones fotográficas, portafolio y cotización fotográfica; no tiene evento, presupuesto, proveedores, contratos, tareas, invitados ni cronograma. No está incompleto: está clasificado contra el producto equivocado.
2. **Inmobiliaria confirma exactamente el ejemplo planteado.** Backend, base de datos y agente soportan `listing.images` y `send_listing_image`, pero las pantallas normales de creación, detalle e importación de Listings no permiten cargar ni vincular imágenes. La capacidad existe en papel, pero no es activable por el tenant.
3. **Hay operaciones cuya UI y cuyo agente usan dos verdades distintas.** `automotriz/alquiler` y `pet_services/guarderia|hotel` muestran alquileres de recursos al humano, pero no existe writer de IA para crear esas reservas. Peor aún, la consulta conversacional de guardería cuenta `appointments`, mientras la operación manual persiste `resource_rentals`; puede informar una disponibilidad falsa.
4. **Fotografía nace sin paquetes.** Las definiciones declaran tres paquetes, pero `bookingEnabled:false` evita sembrarlos; `list_photo_packages` consulta `services`, por lo que un tenant nuevo puede recibir una lista vacía aunque el producto presupone que onboarding los creó.
5. **El plan comercial no forma parte del contrato de navegación vertical.** La UI decide por rol, vertical y subtipo, no por entitlements; el bootstrap solo cruza unas pocas cuotas. Puede exponer una página que después falle, o esconder capacidad legítima cuando el fallback de límites queda obsoleto.
6. **El sistema de readiness es informativo, no bloqueante.** Un tenant puede activar un perfil sin fotos, paquetes, cupos, personal, integraciones o datos mínimos.
7. **Móvil no reproduce el workspace vertical completo.** El resolver móvil omite Listings, Vehículos, Tratamientos, Fichas de mascota y Casos; para varias verticales el usuario termina viendo únicamente Agenda.

## 2. Cómo leer las puntuaciones

### 2.1 Preparación competitiva (0–100)

No mide cantidad de archivos ni calidad del prompt. Mide cuánto del flujo mínimo de mercado puede ejecutar hoy un tenant, frente al mejor referente especializado:

| Dimensión | Peso | Pregunta auditada |
|---|---:|---|
| Flujo central | 25 | ¿Completa el trabajo principal de punta a punta y maneja cancelación, cambios y excepciones? |
| Modelo de dominio | 15 | ¿Existen objetos, relaciones, estados e historial propios del subtipo? |
| Herramientas de IA | 15 | ¿El agente lee y escribe sobre datos reales sin inventar ni depender siempre de un humano? |
| UX de activación | 10 | ¿El tenant puede configurar, cargar y mantener todo lo necesario desde el panel? |
| Dato vivo e integraciones | 10 | ¿Precios, stock, capacidad, expedientes y estados provienen del sistema de verdad? |
| Seguridad y regulación | 10 | ¿Identidad, consentimiento, autorización, auditoría y límites regulatorios son adecuados? |
| Analítica operativa | 5 | ¿Mide el resultado propio del negocio, no solo conversaciones? |
| Especificidad del subtipo | 10 | ¿El subtipo cambia realmente el producto o es una etiqueta? |

| Banda | Interpretación |
|---:|---|
| 0–24 | Placeholder, clasificación equivocada o CRM horizontal; no vender como solución vertical |
| 25–39 | Capa superficial; útil para captar/calificar y derivar, no para operar el negocio |
| 40–54 | Base funcional para piloto controlado con alcance explícito y operaciones manuales |
| 55–69 | Base operativa sólida, todavía por debajo del líder y sin certificación productiva |
| 70–84 | Competitivo en el segmento definido |
| 85–100 | Referente de categoría |

La ausencia de E2E real limita las dimensiones de dato vivo, seguridad y flujo. Un buen contrato estático no recibe puntos de producción.

El resultado agregado es **34,2/100 de promedio y 33,5 de mediana**: 10 configuraciones quedan en 0–24, 43 en 25–39 y 23 en 40–54; ninguna llega a 55. Como toda evaluación experta, cada valor puntual debe leerse con un margen aproximado de ±4, sin que ese margen cambie los hallazgos estructurales ni el orden de los extremos.

### 2.2 Atractivo de mercado (0–100)

Es una prioridad direccional para Parallly, no una estimación de TAM. Combina tamaño/densidad del segmento, disposición a pagar, intensidad del trabajo manual en WhatsApp/Instagram, retención, ajuste al canal y, donde hay datos, factibilidad de distribución. Los valores con evidencia LatAm directa reutilizan la metodología de [`market-research-latam.md`](./market-research-latam.md); el resto se marca con menor confianza.

**Confianza de evidencia:** `A` = código + benchmark oficial + investigación LatAm específica; `B` = código + benchmark oficial + evidencia regional adyacente; `C` = código y benchmark oficial, pero evidencia de demanda local insuficiente. Los números no deben publicarse como tamaño de mercado.

La matriz completa en formato ordenable está en [`vertical-subtype-scorecard-2026-08.csv`](./vertical-subtype-scorecard-2026-08.csv).

### 2.3 Alertas

| Código | Significado |
|---|---|
| `STOP` | No prometer el subtipo como solución operativa completa |
| `MISCLASS` | El subtipo pertenece a otro modelo/producto |
| `SOR` | Requiere integrar el sistema de registro del sector antes de afirmar verdad operacional |
| `REG` | Requiere diseño y revisión jurídica por país |
| `LIVE` | Precio, inventario, disponibilidad o estado deben ser datos vivos |
| `CAP` | Requiere capacidad/recurso concurrente real |
| `PAY` | Pago, depósito, conciliación, reembolso o payout son parte del flujo central |
| `UX` | Backend existente pero no activable/configurable por el tenant |
| `WRITER` | El agente puede consultar o la UI puede operar, pero la IA no puede cerrar la acción |
| `E2E` | No existe certificación con infraestructura/proveedores/canales/modelos reales |

## 3. Inventario de herramientas realmente disponibles

Todos los perfiles heredan CRM/pipeline, FAQs/conocimiento, Inbox, Contactos y Pipeline. En las tablas se usan estos códigos; la lista siguiente muestra las llamadas reales para que “tener una herramienta” no se confunda con una etiqueta comercial.

| Código | Herramientas IA actuales | Superficie principal |
|---|---|---|
| `AGENDA` | listar servicios; consultar disponibilidad; crear, cancelar y reprogramar; detalle/lista del cliente; enviar link | Agenda |
| `CAT` | buscar/ver producto; stock; enviar imagen; crear pedido de catálogo; ofertas | Inventario + Pedidos, salvo drift indicado |
| `TRAT` | consultar plan de tratamiento y próximas sesiones; **sin writer** | Tratamientos |
| `LISTING` | buscar inmuebles; detalle; enviar hasta 3 imágenes | Listings + Agenda para visita |
| `REST` | menú; promociones; crear/cancelar pedido; estado/lista | Menú + Pedidos de comida |
| `VEH` | buscar/ver vehículo; enviar imagen; agendar test drive | Vehículos + Agenda |
| `RENT-UI` | CRUD humano de alquiler de recurso; **sin tool IA para crear alquiler** | Alquileres de recursos |
| `TOUR` | paquetes; detalle; disponibilidad; crear/cancelar/listar reserva | Tours |
| `STAY` | propiedades; detalle/imágenes; disponibilidad; check-in; crear/cancelar/listar estadía | Propiedades/Estadías |
| `EDU` | cursos; horarios; inscripción; prueba de nivel; cancelar/listar | Cursos + Agenda |
| `CASE` | solamente consultar estado de caso; sin UI propia de casos | Agenda |
| `PETREC` | listar/registrar/actualizar mascota; vacunas; triage de emergencia | Mascotas + Agenda |
| `GYM` | planes; clases; membresía; reservar/cancelar clase; congelar membresía | Membresías + Clases + Agenda |
| `INS` | planes; cotización; póliza; reclamo; identidad; cancelar/listar | Seguros |
| `HOME` | crear/cancelar/listar/consultar solicitud | Solicitudes de servicio |
| `PETSVC` | listar servicios y consultar guardería; **sin writer de boarding** | Mascotas + Agenda o `RENT-UI` |
| `PHOTO` | paquetes; portafolio; fecha; solicitar cotización; cancelar sesión | Sesiones fotográficas |

Los pagos de cliente son una capacidad transversal condicionada por plan, credenciales y política del ítem. Citas y estadías tienen retención y confirmación por pago; tours incorporó reserva pendiente y liberación de cupo, pero al corte faltan configuración completa en UI y el cierre automático pospago. Pedidos y cursos no tienen todavía el mismo contrato transaccional.

## 4. Auditoría 1:1 por subtipo

Las referencias de mercado son un **benchmark de capacidad**, no una recomendación de copiar un sistema de registro completo. El objetivo preferido para Parallly es ser la capa conversacional que consulta y ejecuta sobre el software operativo existente.

### 4.1 Salud

Base común: identidad/contacto, FAQ/RAG, CRM, agenda salvo farmacia. No hay historia clínica/EHR integrada ni UI de personal/recursos; `TRAT` es lectura. Referentes oficiales: [NexHealth](https://www.nexhealth.com/), [Pabau](https://pabau.com/features/), [SimplePractice](https://www.simplepractice.com/features/) y [PioneerRx](https://www.pioneerrx.com/pharmacy-software).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Dental | `AGENDA+TRAT`; perfil y servicios dentales. Acorde para captar, agendar y leer un plan; no para operar clínica. | Disponibilidad por profesional/sillón/tipo; intake y consentimientos; seguro/elegibilidad; historial y odontograma en PMS; recalls; pagos y no-show. NexHealth es el benchmark de capa de experiencia. | Integrar Dentalink/DentalWeb u otro PMS; recall semestral; formularios/consentimiento; staff y sillones; pagos/seguro. Construir experiencia conversacional, no odontograma. | **47** | **87 A** | `SOR REG CAP PAY E2E` |
| Medicina general | Solo `AGENDA`; es label-only. | Agenda por médico/sede/motivo; formularios; expediente, receta/lab/telemedicina mediante EHR; triage limitado; privacidad y consentimiento. | No confundir cita con atención médica. Integrar EHR/PMS y limitar IA a coordinación; intake y routing clínico deben ser gobernados. | **38** | **75 B** | `STOP SOR REG CAP E2E` |
| Dermatología | `AGENDA+TRAT`; mismo núcleo que psicología y dental con servicios semilla. | EMR, consentimientos, fotos clínicas antes/después con controles, tratamientos/paquetes, inventario de consumibles, seguimiento y pago. Pabau marca el mínimo. | Falta media clínica vinculada al paciente, consentimiento, protocolos pre/post, lotes/consumibles, staff/equipos y PMS. | **43** | **86 A** | `SOR REG CAP PAY UX E2E` |
| Psicología | `AGENDA+TRAT`; plan de tratamiento de lectura. | Expediente terapéutico seguro, notas/formularios, teleconsulta, recurrencia, paquetes/pago, portal y mensajería protegida. SimplePractice marca el mínimo. | El objeto “tratamiento” no sustituye notas clínicas. Integrar EHR/telehealth; controles de acceso reforzados, consentimiento y manejo de crisis fuera del LLM. | **40** | **86 A** | `SOR REG PAY E2E` |
| Farmacia | `CAT`; busca stock, envía imagen y crea pedido. Sin Agenda; el manifest publica Inventario pero omite Pedidos. | Receta/refill, validación farmacéutica, inventario Rx/OTC por lote y vencimiento, sustitución, POS/pago, entrega, auditoría y restricciones. PioneerRx ilustra la profundidad. | El catálogo genérico solo sirve OTC. No vender para dispensación sin PMS farmacéutico, validación humana, reglas por país, ruta Pedidos y trazabilidad. KPIs/assurance heredados son incoherentes. | **30** | **65 B** | `STOP SOR REG LIVE PAY UX E2E` |

### 4.2 Moda, belleza y bienestar

Base común: `AGENDA`; spa y estética añaden `TRAT`. Los subtipos no modelan estaciones, cabinas, equipos, duración variable por profesional, comisiones, paquetes, membresías, POS ni inventario. Referentes: [Zenoti](https://www.zenoti.com/pricing-zenoti), [Fresha](https://www.fresha.com/en-GB/for-business/features), [SQUIRE](https://getsquire.com/) y Pabau.

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Salón de belleza | Solo `AGENDA`; label-only. Acorde para citas simples. | Profesional + servicio + duración/precio; silla/cabina; depósito/no-show; POS; productos; comisiones; paquetes/membresías; rebooking y ficha de preferencias. | Staff Scheduling existe en backend para Pro+ pero no tiene UI. Añadir recursos, comisiones, POS/inventario, ficha estética, rebooking y recuperación. | **42** | **84 A** | `CAP PAY UX E2E` |
| Barbería | Solo `AGENDA`; funcionalmente igual al salón. | Barbero/silla, walk-in/cola, citas, paquetes o suscripción, POS, inventario, comisiones, historial de estilo y rebooking. SQUIRE es el benchmark específico. | Falta cola/walk-in, silla, membresía y caja; el nombre “barbería” no cambia el flujo. | **41** | **75 B** | `CAP PAY UX E2E` |
| Spa | `AGENDA+TRAT`; más acorde que salón para planes, pero `TRAT` solo lee. | Terapeuta + cabina/equipo, servicios simultáneos, paquetes/membresías, consentimientos, gift cards, POS, inventario, comisiones y seguimiento. | Modelar recursos y sesiones de paquete; writer de tratamiento; consentimiento, stock y checkout. Integrar POS/contabilidad. | **43** | **85 A** | `CAP PAY UX WRITER E2E` |
| Estética / medspa | `AGENDA+TRAT`; buena cuña comercial, baja profundidad clínica. | Todo lo de spa más EMR, fotos antes/después, consentimientos específicos, lotes/consumibles, protocolos, autorizaciones y trazabilidad clínica. | Es la mayor oportunidad, pero no puede tratarse como salón. Requiere modo regulado, integración EMR y media clínica protegida antes de marketing profundo. | **45** | **88 A** | `SOR REG CAP PAY UX E2E` |

### 4.3 Inmobiliaria

Los cuatro subtipos comparten `LISTING+AGENDA`; venta, arriendo y comercial solo cambian persona, construcción ni siquiera eso. Referentes: [Lofty](https://lofty.com/real-estate/crm), [Follow Up Boss](https://www.followupboss.com/features/action-plans), [Buildout](https://www.buildout.com/) y [Buildertrend](https://buildertrend.com/product-overview/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Venta | Buscar/filtrar inmueble, detalle, hasta 3 imágenes y visita. El núcleo es acorde. | Feed/listado vivo; fotos/planos/video; matching; lead routing/nurture; asesor y zona; visita ligada; favoritos; documentos/transacción; atribución. | **P0:** no se pueden cargar fotos en Listings desde la UI. Integrar portales/MLS locales o ERP, deduplicar y usar source+TTL; favoritos, oferta y transacción. | **52** | **84 A** | `LIVE UX SOR E2E` |
| Arriendo | Mismo perfil de venta; persona distinta. | Además: disponibilidad desde/hasta, canon + administración, requisitos, documentos, aplicación, screening/garantía, contrato, depósito y mantenimiento. | El modelo no diferencia inmueble en venta de unidad arrendable ni ciclo de aplicación. Crear workflow de arriendo o integrar property management; fotos siguen bloqueadas. | **48** | **84 A** | `LIVE UX SOR PAY REG E2E` |
| Comercial | Mismas Listings y visitas; persona distinta. | Propiedad/espacio, superficies y zoning, brochure/OM, comps, propietarios, prospecting, lease/sale deal, comisión y marketing/sindicación. Buildout marca el mínimo. | El catálogo residencial es insuficiente: unidades/espacios, documentos, comps, propietarios y deal room. Integrar data comercial; no reutilizar filtros sin contrato. | **39** | **70 B** | `STOP SOR LIVE UX E2E` |
| Construcción | Mismas Listings; label-only. Es un modelo equivocado para constructor/promotor. | Leads a propuesta/contrato; proyecto/unidad; presupuesto, estimate, cronograma, selecciones, cambios, documentos/fotos de avance, portal y pagos. Buildertrend marca el mínimo. | Decidir si significa “venta de proyecto nuevo” o “empresa constructora”. Si es constructor, mover a FSM/proyectos; Listings solo cubre unidades en venta. | **29** | **60 C** | `STOP MISCLASS SOR PAY E2E` |

### 4.4 Restaurantes

Casual y cafetería tienen `REST+AGENDA`; comida rápida y dark kitchen remueven Agenda. Referentes: [Toast](https://pos.toasttab.com/how-toast-works), [SevenRooms](https://sevenrooms.com/) y [Deliverect](https://www.deliverect.com/en/customer-type/restaurant).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Casual dining | Menú/promo/pedido + Agenda genérica. Acorde en conversación, no en salón/cocina. | Reservas por mesa/turno/party, waitlist, disponibilidad real, preferencias/CRM huésped, POS/KDS, modificadores, stock 86, pago, propina y fidelización. | Agenda no es table management. Integrar POS y reservas; estado cocina/entrega, modificadores y pagos. | **48** | **74 A** | `SOR LIVE CAP PAY E2E` |
| Comida rápida | `REST`, sin Agenda; delta real y razonable. | Menú/modificadores/combos; stock; pickup/delivery; pago; POS/KDS; ETA; cancelación/refund; promos/loyalty; multi-sede. | Conectar POS/KDS y delivery; el pedido nativo sin pago/inyectar a cocina crea doble digitación. Necesita dirección/zona/ETA y conciliación. | **50** | **76 A** | `SOR LIVE PAY E2E` |
| Cafetería | Igual a casual, incluida Agenda. | Quick service + mesas opcionales; variantes/tamaños/extras; pickup; fidelidad/suscripción; POS, stock de retail y cocina. | Definir si reserva mesas es real o ruido. Variantes, combos, POS y loyalty son centrales; posible híbrido retail-restaurante. | **46** | **70 B** | `SOR LIVE PAY E2E` |
| Dark kitchen | Igual a comida rápida; delta real. | Menús y marcas virtuales por canal; agregadores; inyección POS/KDS; 86 global; capacidad/ETA; dispatch, tracking, pago/refund y rentabilidad por marca/canal. | No basta recibir pedido WhatsApp. Integrar Rappi/PedidosYa/Uber/Deliverect o POS; multi-marca, delivery, SLA y conciliación. | **49** | **77 A** | `SOR LIVE CAP PAY E2E` |

### 4.5 Automotriz

Concesionario y taller comparten `VEH+AGENDA`; repuestos usa `CAT`; alquiler conserva consulta de vehículos y `RENT-UI`, sin writer de reserva. Referentes: [Tekion](https://tekion.com/products), [Impel](https://impel.ai/platform-overview/), [Shopmonkey](https://www.shopmonkey.io/) y [HQ Rental Software](https://hqrentalsoftware.com/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Concesionario | Inventario, imágenes, detalle y test drive; acorde como cuña de ventas. | VIN/trim/estado y precio vivo; multi-sede; 360/video; trade-in; financiación/F&I; lead routing; cita ligada al VIN; DMS/CRM; documentos y conversión. | Integrar DMS/inventory feed, no mantener verdad duplicada. Falta trade-in, financiación, journey compra, source+TTL y media rica. | **50** | **75 A** | `SOR LIVE REG PAY E2E` |
| Taller | Mismas tools de concesionario; persona de servicio. La herramienta principal sigue siendo buscar autos y test drive. | Vehículo/cliente; cita y bahía/técnico; inspección; estimate; aprobación; repair order; partes/labor; estado; factura/pago; recordatorios. Shopmonkey marca la cadena mínima. | Crear/integrar work order; inspección/fotos, presupuesto y aprobación por WhatsApp. `schedule_test_drive` es inapropiado para reparación. | **30** | **75 A** | `STOP MISCLASS SOR CAP PAY E2E` |
| Repuestos | `CAT`, pedido e imagen; delta real. | Fitment por VIN/marca/modelo/año; OEM/alternativas; existencias por bodega; proveedor/PO; precio vivo; backorder; envío/retiro; devolución/garantía. | Catálogo genérico no garantiza compatibilidad. Integrar parts catalog/ERP; UI/catálogo canónico tiene drift y debe validar fitment antes de ordenar. | **38** | **68 B** | `SOR LIVE PAY E2E` |
| Alquiler | Busca vehículos y muestra `RENT-UI`; **no puede crear alquiler por IA**. | Reserva por clase/unidad, disponibilidad por intervalo, tarifas/fees, sucursales, extras, conductor/licencia, depósito, contrato, daños, mantenimiento y channel sync. | P0 writer `create_vehicle_rental`, capacidad por intervalo y bloqueo; pago/depósito, contrato y elegibilidad. Integrar fleet/rental system cuando exista. | **27** | **66 B** | `STOP WRITER CAP LIVE PAY REG E2E` |

### 4.6 Turismo y hospitalidad

Agencia y tours usan `TOUR`; hotel y alquiler vacacional usan `STAY`. Son cuatro mercados de software distintos. Referentes: [Travefy](https://travefy.com/), [Cloudbeds](https://www.cloudbeds.com/hospitality-platform/), [Rezdy](https://support.rezdy.com/hc/en-us/articles/19867793699612-What-Is-a-Resource-and-How-To-Set-Them-Up) y [Guesty](https://www.guesty.com/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Agencia de viajes | Paquetes/tours y reservas; delta real, pero confunde agencia con operador. | Perfil viajero; intake; propuesta/itinerario multi-componente; proveedores y cotizaciones; versiones/aprobación; factura/pago; comisión; documentos y comunicación del viaje. Travefy marca el mínimo. | Crear itinerario/propuesta y supplier/commission o renombrar a operador de tours. No prometer vuelos/hoteles dinámicos sin GDS/bedbank. | **39** | **68 B** | `STOP MISCLASS SOR LIVE PAY E2E` |
| Hotel | Propiedades/estadías, imágenes, disponibilidad, check-in y reserva. Buena cuña boutique. | PMS, room type/rate plan, inventario y restricciones; channel manager/OTA; folio/pagos; housekeeping/tareas; check-in; upsell; perfil y mensajería. Cloudbeds marca el mínimo. | Integrar PMS/channel manager. El objeto “property” no sustituye habitación/rate plan/folio. Segmento defendible: boutique, no cadena ni PMS replacement. | **49** | **84 A** | `SOR LIVE CAP PAY E2E` |
| Tours / experiencias | Paquete, cupos, disponibilidad y reserva; el flujo más cercano al núcleo de mercado. | Sesiones/salidas; recursos compartidos (guía/vehículo/equipo); capacidad; pasajeros/manifest/pickup; extras; waiver; agentes/resellers; pago/refund y OTA. Rezdy marca el mínimo. | Pago-a-confirmar quedó parcial: falta UI de política y listener pospago. Añadir recursos, manifest, pickup, waiver, reseller/OTA y conciliación. | **52** | **74 B** | `CAP LIVE PAY UX E2E` |
| Alquiler vacacional | Estadía por propiedad, fotos, disponibilidad, check-in, iCal y retención/pago; buena base para operador profesional. | Channel manager API, tarifas/fees, reglas; guest verification; depósito/daños; contratos; limpieza/mantenimiento; owner accounting; pricing y comunicación OTA. Guesty marca el mínimo. | Enfocar gestores de varias unidades, no anfitrión 1–2. iCal ayuda, pero no sustituye sync API en tiempo real; integrar PMS/OTA y tareas operativas. | **51** | **86 A** | `SOR LIVE PAY REG E2E` |

### 4.7 Educación

Los cuatro subtipos son funcionalmente idénticos: `AGENDA+EDU`. Referentes: [Teachworks](https://www.teachworks.com/language-school-management-software), [Element451](https://element451.com/element-admissions-ai-agent-teams), [Thinkific](https://www.thinkific.com/) y [Arlo](https://www.arlo.co/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Idiomas | Cursos/horario/inscripción/prueba de nivel + Agenda; label-only, pero el flujo tiene ajuste parcial. | Grupos/niveles; docente/aula; recurrencia; placement; asistencia; notas/progreso; paquete/matrícula y pago; portal de alumno/padre; clases online. | Convertir curso en cohorte/grupo con cupo, recurrencia y docente; asistencia, facturación y progreso. Integrar LMS/videollamada. | **43** | **76 A** | `CAP PAY SOR E2E` |
| Universitaria | Misma herramienta de cursos; label-only. | Reclutamiento→solicitud→documentos→revisión/decisión→depósito→matrícula; programas/periodos; eventos; becas; comunicaciones; SIS/LMS e identidad del aspirante. Element451 marca el mínimo de admisiones. | `enroll_student` no es admissions. Integrar SIS/CRM de admisiones; documentos, estados, decisión y privacidad de menores cuando aplique. | **25** | **65 B** | `STOP MISCLASS SOR REG PAY E2E` |
| Educación online | Misma herramienta; no hay contenido ni progreso. | Builder/import de contenido; cohort/self-paced; lecciones, quizzes, assignments, progreso/certificado; comunidad; checkout/suscripción; analytics y LMS. Thinkific marca el mínimo. | Elegir capa de ventas/soporte sobre LMS, no construir LMS completo. Integrar Thinkific/Moodle; sincronizar enrollment y progreso. | **30** | **70 B** | `STOP SOR PAY E2E` |
| Capacitación | Misma herramienta; no diferencia B2B, público o interno. | Curso/sesión/instructor/venue; registros masivos; cliente empresa; invoice/PO; asistencia; certificados/licencias; e-learning; portal y reportes. Arlo marca el mínimo. | Modelar empresa, cohortes privadas, asistentes, logística, facturación y certificación. Integrar LMS para contenido. | **35** | **72 B** | `SOR CAP PAY E2E` |

### 4.8 Finanzas

Los tres subtipos son el mismo preset horizontal: CRM/pipeline, conocimiento y `AGENDA`. No existen cuentas financieras, objetivos, portafolios, solicitudes, underwriting, transacciones ni conectores. Referentes de capacidad: [Salesforce Financial Services Cloud](https://www.salesforce.com/financial-services/cloud/guide/) y [Blend](https://info.blend.com/hubfs/PDF/one_pager/Blend_Fact_Sheet.pdf).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Asesoría financiera | Solo Agenda; label-only. Útil para captar y derivar, no para asesorar. | Perfil financiero/household; objetivos y riesgo; onboarding/KYC; documentos; tareas/revisión; datos de portafolio desde custodio; consentimiento, suitability y auditoría. | Mantener IA en educación, intake y coordinación; nunca recomendar/ejecutar sin profesional y datos autorizados. Integrar CRM/custodio y diseñar cumplimiento por país. | **24** | **62 B** | `STOP SOR REG LIVE E2E` |
| Fintech | Solo Agenda; label-only. El nombre no define producto ni flujo. | Depende del modelo: cuenta/wallet/pago/crédito. En todos: identidad/KYC/AML, ledger/saldos/estados vivos, riesgo, soporte autenticado, disputas, consentimiento y trazabilidad. | **No implementar “fintech” genérico.** Exigir subtipo regulatorio y sistema de verdad concreto; hoy debe retirarse del selector o quedar como `otro` con alcance de soporte. | **17** | **55 C** | `STOP MISCLASS SOR REG LIVE E2E` |
| Créditos | Solo Agenda; label-only. | Solicitud estructurada; documentos/consentimientos; identidad; buró; pre-calificación; underwriting; oferta; firma; desembolso; calendario/estado; cobro y adverse-action donde aplique. Blend ilustra el flujo. | Integrar LOS/lender. Parallly puede captar, completar faltantes y explicar estados; no calcular aprobación ni tasa con conocimiento estático. | **20** | **67 B** | `STOP SOR REG LIVE PAY E2E` |

### 4.9 Servicios profesionales

Los cuatro heredan una persona legal y `AGENDA+CASE`; `CASE` solo consulta estado y no tiene pantalla propia. Contadores, arquitectos y consultores reciben algunos servicios semilla, pero no un modelo operativo. Referentes: [Clio Grow](https://www.clio.com/grow/), [TaxDome](https://taxdome.com/), [Monograph](https://monograph.com/) y [Scoro](https://www.scoro.com/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Abogados | Agenda + estado de caso sin UI; label-only. | Intake por materia; conflicto; lead→matter; consulta; documentos; e-sign/retainer; tareas/plazos; tiempo/factura/pago; portal; permisos y auditoría. Clio marca el mínimo. | Integrar practice-management; construir intake, calificación y comunicación segura. No dar asesoría jurídica no supervisada ni afirmar estado desde una FAQ. | **27** | **68 B** | `STOP SOR REG PAY UX E2E` |
| Contadores | Mismo núcleo, con servicios semilla contables. | Portal seguro; documentos/checklists; e-sign; workflow por periodo/entidad; deadlines; facturación/pago; comunicaciones; integración contable/fiscal. TaxDome marca el mínimo. | Falta cliente-entidad-periodo, solicitudes de documento y recurring workflow. Integrar software contable/fiscal; no manejar PII en chat abierto. | **25** | **70 B** | `STOP SOR REG PAY E2E` |
| Arquitectos | Mismo estado de caso, servicios semilla y privacidad A1; funcionalmente no es arquitectura. | Lead/propuesta/contrato; proyecto/fases; presupuesto; equipo/recursos; tiempo; entregables/versiones; aprobaciones; factura y rentabilidad. Monograph marca el mínimo. | Reubicar en proyectos/PSA. `get_case_status` no modela fase, entregable ni aprobación; no existe portal ni archivos de proyecto. | **19** | **55 C** | `STOP MISCLASS SOR PAY E2E` |
| Consultores | Igual a arquitectos con otros servicios semilla. | Oportunidad→SOW→proyecto; hitos/tareas; staffing/capacidad; tiempo/gasto; retainer; entregables; factura; margen y portal. Scoro marca el mínimo. | Integrar PSA/project management. Parallly puede vender, agendar y recoger requerimientos; no debe fingir delivery de proyecto. | **22** | **60 C** | `STOP SOR CAP PAY E2E` |

### 4.10 Retail

Los cuatro son idénticos: `CAT`, Inventario y Pedidos. No hay variación, POS, checkout transaccional general, fulfillment, devoluciones, multi-bodega ni conexión commerce. Referentes: [Shopify POS](https://www.shopify.com/pos/features), [Shopify Inventory](https://www.shopify.com/inventory-management) y, para marketplace, [Stripe Connect](https://docs.stripe.com/connect/marketplace).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Moda | Catálogo/stock/imagen/pedido; label-only. | Variantes talla/color, imágenes; stock por ubicación; checkout/pago; envío/pickup; cambio/devolución; promociones; POS; customer history, recomendaciones y back-in-stock. | Integrar Shopify/WooCommerce/ERP como SOR. Variantes, carritos, pago/fulfillment y devoluciones son P0; no duplicar inventario manual. | **39** | **72 A** | `SOR LIVE PAY E2E` |
| Electrónica | Mismo catálogo genérico. | Todo retail más specs/comparación, serial/IMEI, bundles, garantía, compatibilidad, preorder/backorder, fraude, RMA/servicio técnico. | Añadir atributos estructurados, serial/garantía/RMA y compatibilidad; integrar commerce/ERP. El RAG no sustituye datos de producto vivos. | **36** | **68 B** | `SOR LIVE PAY E2E` |
| Hogar | Mismo catálogo genérico. | Variantes/dimensiones/material; disponibilidad local; bundles; entrega programada/instalación; quote para voluminosos; fulfillment, devolución y POS. | No confundir con servicios del hogar. Integrar commerce/ERP y agregar entrega/instalación y cálculo de restricciones. | **38** | **66 B** | `SOR LIVE CAP PAY E2E` |
| Marketplace | Mismo catálogo/pedido de un solo merchant. Es un modelo estructuralmente distinto. | Seller onboarding/KYB; catálogo y órdenes por vendedor; comisiones; split/payout; tax; SLA; moderación; disputas/reembolsos; conciliación y riesgo. | Retirar del selector hasta definir merchant of record y jurisdicción. Requiere arquitectura multi-vendedor y rail como Connect; no es un override de retail. | **18** | **60 C** | `STOP MISCLASS SOR REG PAY E2E` |

### 4.11 Tecnología

SaaS, consultoría TI y desarrollo usan solo `AGENDA`; hardware usa `CAT`. La política del producto los reconoce como presets horizontales. Referentes: [Intercom Fin](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained), sus [Data Connectors](https://www.intercom.com/help/en/articles/6298285-using-data-connectors-for-automation), [ConnectWise PSA](https://www.connectwise.com/platform/psa) y Scoro.

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| SaaS | Solo Agenda; label-only. El horizontal omnicanal sí aporta valor de soporte/ventas. | Usuario/cuenta/plan; knowledge; estado/entitlements y uso vivos; tickets; SLA; diagnóstico; acciones seguras; escalation; product telemetry; CSAT y resolución. | Construir capa de soporte conectada: identify user, read/write billing/account/status, ticketing y product events. Fin compite con conocimiento + datos + acciones, no solo respuestas. | **29** | **70 B** | `STOP SOR LIVE REG E2E` |
| Consultoría TI | Agenda con servicio semilla. | Lead/SOW/proyecto; ticket/SLA; dispatch; activos/configuración; tiempo; contrato/retainer; factura; portal y rentabilidad. | Elegir managed services o proyectos. Integrar PSA/ticketing; hoy solo agenda la llamada inicial. | **22** | **55 C** | `STOP SOR CAP PAY E2E` |
| Desarrollo de software | Agenda con servicio semilla. | Discovery/estimate/SOW; backlog/milestones; equipo/capacidad; entregables/aceptación; time/budget; change request; factura y repositorio/ticket sync. | No construir Jira. Integrar project/dev tools y PSA; Parallly puede captar requisitos, actualizar y escalar con datos vivos. | **20** | **53 C** | `STOP SOR CAP PAY E2E` |
| Hardware | `CAT` y pedidos; delta real. | Catálogo/specs/compatibilidad, serial, stock, quote, checkout, fulfillment, warranty/RMA y soporte/ticket; B2B pricing cuando aplique. | Mismo gap que electrónica más soporte técnico; catálogo canónico tiene drift. Integrar ERP/commerce/help desk. | **35** | **62 C** | `SOR LIVE PAY E2E` |

### 4.12 Veterinaria

Los cuatro comparten `AGENDA+PETREC`; hospital solo siembra 24×7 y peluquería baja privacidad. No hay expediente clínico veterinario completo ni integración PIMS. Referentes: [ezyVet](https://www.ezyvet.com/features) y [PetDesk](https://info.petdesk.com/hubfs/2026%20PD%20State%20of%20Practice%20Management%20Report/State-of-Veterinary-Practice-Management-2026-Report-PetDesk.pdf).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Clínica general | Mascota, vacunas, triage y Agenda; buen contexto, sin medicina operativa. | PIMS/EMR, species/breed/weight; vacunas y recordatorios; consulta/diagnóstico/órdenes/recetas; inventario/lotes; estimate/consent; factura/pago y portal. | Integrar PIMS; limitar triage a emergencia y handoff. Falta owner-household, expediente, consentimientos, stock y billing. | **41** | **72 B** | `SOR REG LIVE PAY E2E` |
| Hospital 24h | Igual a clínica, con horario 24×7. El horario no crea hospital. | Urgencias/triage y severidad; colas; hospitalización/camas; turnos; órdenes/resultados; tratamientos/medicación; estimado/autorización; alta y transferencia. | No prometer “hospital 24h” sin capacidad, routing clínico, guardias y PIMS. El LLM no decide prioridad clínica. | **29** | **68 B** | `STOP SOR REG CAP LIVE E2E` |
| Exóticos | Igual a clínica; label-only. | Lo anterior más taxonomía/especie, rangos/protocolos, profesional competente, hábitat/dieta y disponibilidad de insumos especializados. | Subtipo no cambia datos ni routing. Requiere especialidad por staff y contenido clínico gobernado desde PIMS, no instrucciones generadas. | **34** | **55 C** | `STOP SOR REG CAP E2E` |
| Peluquería canina | Hereda vacunas, desparasitación y persona clínica; solo cambia privacidad. Se solapa con `pet_services/peluqueria`. | Perfil mascota/owner; breed/coat/temperament; servicio/add-ons; groomer; duración; grooming history/photos; vacunas/requisitos; depósito/no-show y pago. | Eliminar duplicidad: migrar a Pet Services. Hoy muestra herramientas clínicas innecesarias y no un workflow de grooming. | **35** | **65 B** | `MISCLASS CAP PAY E2E` |

### 4.13 Gimnasios y estudios

Los cinco comparten `AGENDA+GYM`; solo cambia la persona. El núcleo tiene membresía y clases, pero no cobro recurrente real, check-in/acceso, waivers, recursos específicos ni tracking del subtipo. Referentes: [Glofox](https://www.glofox.com/), [Wodify](https://www.wodify.com/solutions/crossfit-functional-fitness), [Mariana Tek](https://www.marianatek.com/features/business-management/) y [Zen Planner](https://zenplanner.com/martial-arts/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Gimnasio general | Planes, clases, reserva, freeze/cancel; la base es acorde. | Membresía/pack/drop-in; billing/recovery; check-in/acceso; clases/PT; waitlist; waiver; attendance; app/portal; retención y multi-sede. | Conectar pagos recurrentes, access/check-in y estados de entitlement. Staff/resources UI y reglas de acceso son P0. | **48** | **78 A** | `LIVE CAP PAY UX E2E` |
| CrossFit | Mismo GYM con persona CrossFit. | Todo gimnasio más WOD/programming, score/PR, benchmark, leaderboard, coach y performance history. Wodify marca la diferencia real. | Integrar Wodify o crear tracking de WOD; hoy “CrossFit” no cambia objetos ni herramientas. | **42** | **77 A** | `SOR CAP PAY E2E` |
| Yoga / Pilates | Mismo GYM con persona. | Clases/niveles; instructor; sala y, en Pilates, reformer/spot; packs/membresía; waitlist; sustituciones; waiver y booking visual. | Recursos/spot son indispensables; el selector mezcla yoga sin equipo y Pilates con equipo escaso. Considerar separar subtipos. | **43** | **80 A** | `CAP PAY UX E2E` |
| Cycling | Mismo GYM con persona. | Bicicleta/spot map, atributos/preferencias, waitlist/standby, paquetes/membresía, instructor y mantenimiento de equipos. Mariana Tek marca el mínimo. | Sin bike assignment la disponibilidad no es operativa. Requiere recurso numerado y selección visual. | **39** | **70 B** | `CAP LIVE PAY UX E2E` |
| Artes marciales | Mismo GYM con persona. | Familia/menor; membresía; asistencia; programa; cinturón/habilidad; currículo; evaluación; clases por nivel; billing y waivers. Zen Planner marca el mínimo. | Falta family account, consentimiento de menor y belt/skill tracking; no es solo una clase de gimnasio. | **36** | **73 B** | `REG CAP PAY E2E` |

### 4.14 Seguros

Los cinco subtipos son idénticos: `INS` con cotización, póliza, identidad y reclamo. El modelo distingue información sensible, pero no diferencia agencia de aseguradora ni líneas de negocio. Referentes: [Applied Epic](https://www1.appliedsystems.com/en-us/solutions/for-agents/agency-management-system/applied-epic), [InsuredMine](https://www.insuredmine.com/faq/), [Guidewire InsuranceSuite](https://www.guidewire.com/products) y [Salesforce Digital Insurance](https://www.salesforce.com/financial-services/digital-insurance-software/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Broker | Planes, quote preliminar, póliza/reclamo e identidad; mejor ajuste de la vertical. | Household/account; carriers/markets; intake por línea; submissions/quotes comparables; documentos/e-sign; bind/renewal; comisión; claims handoff y AMS sync. | Integrar AMS/carriers. `calculate_quote` solo es defendible con reglas/versiones y fuente viva; añadir consentimientos, renewal y documentos. | **39** | **74 A** | `SOR REG LIVE PAY E2E` |
| Aseguradora | Mismo perfil del broker. Es otro tipo de empresa y otra escala. | Product/rating/underwriting; policy administration; billing; claims FNOL→adjudicación→pago; reservas; fraude; reaseguro; compliance. Guidewire marca el core. | **No construir ni vender como carrier core.** Solo ofrecer engagement sobre APIs de PAS/claims/billing con controles empresariales. | **19** | **58 C** | `STOP MISCLASS SOR REG LIVE E2E` |
| Vida | Mismo INS, sin modelo de beneficiario ni underwriting de vida. | Asegurado/tomador/beneficiarios; needs analysis; health/lifestyle intake; ilustración; underwriting/evidence; e-sign; premium; policy service y claims sensibles. | Integrar carrier/illustration; identity y consentimiento reforzados. Nunca afirmar cobertura o aceptación antes de bind. | **32** | **72 B** | `STOP SOR REG LIVE E2E` |
| Auto | Mismo INS. | Vehículo/conductor/uso; coberturas/deducibles; rating; documentos; inspección/fotos; bind/pago; póliza; FNOL; daños/taller/status. | Añadir objetos y flujo auto; integrar rating/carrier/claims. Fotos de siniestro requieren cadena y controles, no banco de medios genérico. | **34** | **74 B** | `SOR REG LIVE PAY E2E` |
| Salud | Mismo INS. | Titular/dependientes; plan/red/cobertura; elegibilidad; preautorización; claim; documentos; explicación segura; identidad y datos sensibles. | Integrar payer/TPA. No mezclar seguro con atención clínica ni afirmar cobertura desde FAQ; controles de mínimo dato y jurisdicción. | **30** | **70 B** | `STOP SOR REG LIVE E2E` |

### 4.15 Servicios del hogar

Los siete son idénticos: `HOME`, sin Agenda genérica. El objeto solicitud es una buena base de intake, pero no existe dispatch, técnico/skills, ruta, estimate, work order, materiales, aprobación, factura ni recurrencia. Referentes: [ServiceTitan](https://www.servicetitan.com/industries/plumbing-software), [FieldRoutes](https://www.fieldroutes.com/solutions/pest-control-software), [Jobber Landscaping](https://www.getjobber.com/industries/landscaping/), [Jobber Cleaning](https://www.getjobber.com/industries/janitorial-software/) y [Housecall Pro Locksmith](https://www.housecallpro.com/industries/locksmith-software/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Plomería | Solicitud/estado/cancelación; label-only. | Dirección/urgencia; problema y media; skill; disponibilidad/dispatch; técnico/ETA; pricebook/estimate; aprobación; parts/work order; factura/pago y garantía. | Extender HOME a FSM común; integración con dispatch/mapas y pago. Fotos del problema deben vincularse a la solicitud. | **33** | **75 B** | `SOR CAP LIVE PAY E2E` |
| Electricidad | Mismo HOME. | Lo anterior más riesgo/voltaje, certificación del técnico, inspección, materiales y pruebas/cierre seguro. | Routing de emergencia y límites de seguridad deterministas; no dar instrucciones peligrosas por IA. Skills/certificaciones y checklist. | **31** | **72 B** | `REG CAP LIVE PAY E2E` |
| Fumigación | Mismo HOME. | Tipo de plaga/área; inspección; plan y recurrencia; ruta; técnico/licencia; químicos/lote; prep/aftercare; compliance; contrato/cobro. FieldRoutes marca el mínimo. | Requiere recurrencia, route density, sustancias y cumplimiento por país. No reutilizar request único como tratamiento completo. | **27** | **70 B** | `STOP SOR REG CAP PAY E2E` |
| Limpieza | Mismo HOME. | Propiedad/áreas; alcance/checklist; frecuencia; crew; duración/capacidad; supplies; quote; recurrencia; acceso; QA/fotos y pago. | Modelar recurring jobs, crew y checklist; rutas y sustitución. Buen candidato para FSM común. | **30** | **74 B** | `CAP LIVE PAY E2E` |
| Jardinería | Mismo HOME. | Sitio/superficie; servicios estacionales/recurrentes; crew/equipo; route; estimate; job/cambios; materiales; fotos; invoice/pago. | Recurrencia, sitio, cuadrilla/equipo y estimate son indispensables; integrar clima/mapas cuando afecte scheduling. | **28** | **68 B** | `CAP LIVE PAY E2E` |
| Cerrajería | Mismo HOME. | Emergencia/localización; tipo de cerradura/vehículo; técnico cercano; ETA; verificación de autoridad/propiedad; estimate; dispatch; pago y auditoría. | Antes de automatizar apertura debe existir verificación de identidad/autoridad y reglas antifraude. Dispatch 24/7 y precio vivo. | **25** | **63 C** | `STOP REG CAP LIVE PAY E2E` |
| Pintura | Mismo HOME. | Sitio/superficie/estado; visita o medición; quote; colores/materiales; crew; schedule; hitos/fotos; change order; invoice/pago y garantía. | Intake visual y estimate estructurado; proyecto multi-día, cuadrilla y materiales. Reutilizar FSM/proyectos, no request único. | **29** | **67 B** | `CAP PAY E2E` |

### 4.16 Servicios para mascotas

Peluquería, paseos y adiestramiento usan `AGENDA+PETSVC+PETREC`; guardería/hotel usan `PETSVC+PETREC+RENT-UI` sin Agenda ni writer. Referentes: [MoeGo](https://help.moego.pet/en), [MoeGo Boarding/Daycare](https://help.moego.pet/en/articles/14106724-boarding-daycare-overview) y [Time To Pet](https://www.timetopet.com/scheduling).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Peluquería | Mascota + servicios + Agenda; label-only pero tiene ajuste razonable. | Breed/coat/temperament; groomer; servicio/add-ons; duración/precio; vacunas/requisitos; grooming history/photos; depósito/no-show; pago y rebooking. | Separar servicio/slots por groomer; ficha grooming y media vinculada; pago y consentimientos. Consolidar duplicado veterinario. | **40** | **72 B** | `CAP PAY UX E2E` |
| Guardería | Mascota + consulta de disponibilidad + `RENT-UI`; no writer. | Capacidad por zona/tamaño/temperamento; evaluación; multi-pet; check-in/out; asistencia; alimentación/medicación; vacunas; add-ons; acuerdos, depósito y report card. | **P0:** disponibilidad conversacional cuenta appointments, UI escribe rentals. Unificar SOR y crear booking writer; capacidad y elegibilidad atómicas. | **27** | **68 B** | `STOP WRITER CAP LIVE REG PAY E2E` |
| Hotel | Igual a guardería con servicio nocturno. | Unidad/kennel por intervalo; capacidad; check-in/out; noches/fees; multi-pet; alimentación/meds; vacunas; acuerdos; depósito/cancelación y comunicación de estancia. | Mismo P0 más inventario nocturno real. No vender hasta evitar doble reserva y confirmar pago/contrato. | **25** | **69 B** | `STOP WRITER CAP LIVE REG PAY E2E` |
| Paseos | Agenda + mascotas; label-only y hereda servicios irrelevantes de grooming/boarding. | Duración/zona; walker/skills; recurring series; rutas; llaves/acceso; GPS/check-in-out; pet notes; foto/reporte; reemplazo; invoice/pago. Time To Pet marca el mínimo. | Crear servicio de campo recurrente y route/assignment. Agenda simple no prueba ejecución ni seguridad de acceso. | **31** | **65 B** | `SOR CAP LIVE REG PAY E2E` |
| Adiestramiento | Agenda + mascotas; label-only. | Evaluación; objetivo/comportamiento; trainer; paquete/sesiones; plan/homework; progreso; clases grupo/privado; vacunas/waiver; pago y comunicación. | Modelar programa y progreso; paquete/entitlements y safety routing. No reutilizar solo “baño y corte”. | **29** | **63 C** | `CAP REG PAY E2E` |

### 4.17 Fotografía y eventos

Los cinco subtipos son idénticos: `PHOTO`. En tenants nuevos los paquetes definidos no se siembran por la contradicción `bookingEnabled:false`; la ruta de sesiones no configura paquetes. Referentes: [HoneyBook para fotógrafos](https://www.honeybook.com/business-type/photographers), [Pixieset Studio Manager](https://pixieset.com/studio-manager/) y, para planners, [Aisle Planner](https://aisleplanner.com/).

| Subtipo | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Estudio | Paquetes/portfolio/fecha/quote/sesión, pero paquetes nacen vacíos; label-only. | Tipo/paquete; estudio/equipo/fotógrafo; date hold; propuesta/contrato; retainer; cuestionario; shot list; entrega/galería; invoice/pago y portal. | Reparar seed/UI de paquetes; recursos, hold, contrato/retainer y proyecto→galería. Integrar Pixieset para entrega. | **33** | **64 B** | `UX CAP PAY SOR E2E` |
| Bodas | Mismo PHOTO. | Lead→consulta→propuesta; fecha exclusiva; equipo/segundo fotógrafo; timeline; locaciones; contrato/retainer; cuestionario/shot list; gallery/album y pagos. HoneyBook/Pixieset marcan el mínimo. | Fecha tiene costo de oportunidad: hold y retainer atómicos. Falta timeline, contrato, equipo, entregables y pagos por hitos. | **31** | **72 B** | `UX CAP PAY E2E` |
| Eventos | Mismo PHOTO. | Evento/venue/horario; cobertura/equipo; acreditación; shot list; propuesta/contrato; entregables/SLA; facturación B2B y galería. | Distinguir evento corporativo/social, multi-fotógrafo y entregable/SLA. Paquetes vacíos bloquean activación. | **30** | **68 B** | `UX CAP PAY E2E` |
| Producto | Mismo PHOTO, aunque el recurso central suele ser proyecto/brief, no una fecha social. | Cliente/brief/SKU; volumen/variantes; shot list; set/equipo; muestras/logística; revisiones/aprobación; derechos/licencia; entrega y factura. | Modelar proyecto por productos/assets y ronda de aprobación. Agenda/quote genérico no cubre production workflow ni derechos. | **26** | **60 C** | `STOP MISCLASS SOR PAY E2E` |
| Wedding planner | Recibe sesiones, portafolio y cotización **fotográfica**; label-only. | Evento, pareja/cliente; presupuesto; checklist/timeline; proveedores/contratos; venue; invitados/seating; pagos; portal y colaboración. Aisle Planner marca la categoría. | **Peor ajuste de toda la matriz.** Retirar/reclasificar. Crear vertical Event Planning separada o integrar Aisle Planner; no intentar corregirla con prompt. | **11** | **70 B** | `STOP MISCLASS SOR PAY E2E` |

### 4.18 Otro

| Configuración | Actual y ajuste | Mínimo competitivo de mercado | Brecha puntual / decisión | Prep. | Mercado | Alertas |
|---|---|---|---|---:|---:|---|
| Otro / genérico | CRM/pipeline + FAQ + `CAT`, Inventario y Pedidos, aun cuando el negocio no venda productos. | Custom objects/fields, pipeline y forms configurables; reglas, permisos, reporting, APIs/webhooks y templates por proceso. | Convertir en preset horizontal explícito con elección de módulos; no activar Catálogo por defecto. El atractivo no se compara con una industria. | **25** | **50 C** | `STOP MISCLASS UX E2E` |

## 5. Ranking: dónde estamos peor y dónde hay una base aprovechable

### 5.1 Diez peores por preparación competitiva

| Puesto | Subtipo | Puntaje | Causa dominante |
|---:|---|---:|---|
| 1 | Fotografía / wedding planner | **11** | Clasificación equivocada: fotografía ≠ planificación de bodas |
| 2 | Finanzas / fintech | **17** | Nombre genérico regulado sin objeto ni flujo |
| 3 | Retail / marketplace | **18** | Comercio single-merchant presentado como multi-vendedor |
| 4 | Servicios profesionales / arquitectos | **19** | Estado de “caso” en lugar de proyecto, fases y entregables |
| 5 | Seguros / aseguradora | **19** | Flujo de broker presentado como carrier core |
| 6 | Tecnología / desarrollo | **20** | Agenda sin delivery de proyecto ni integración dev/PSA |
| 7 | Finanzas / créditos | **20** | Cita sin solicitud, underwriting ni LOS |
| 8 | Tecnología / consultoría TI | **22** | Agenda sin ticket/SLA/proyecto/retainer |
| 9 | Servicios profesionales / consultores | **22** | Estado de caso sin SOW, capacidad, tiempo o facturación |
| 10 | Finanzas / asesoría | **24** | Captación sin datos financieros, suitability ni sistema de verdad |

### 5.2 Diez mejores bases actuales

| Puesto | Subtipo | Puntaje | Qué ya existe | Por qué aún no es competitivo |
|---:|---|---:|---|---|
| 1= | Turismo / tours | **52** | Paquetes, disponibilidad, cupos, reserva y cancelación | Recursos, manifest, OTA y pago completo; 0 E2E |
| 1= | Inmobiliaria / venta | **52** | Listings, filtros, detalle, imagen y visita ligada | Fotos no cargables en UI, feed vivo y transacción |
| 3 | Turismo / alquiler vacacional | **51** | Propiedades, imágenes, estadía, iCal y hold/pago | Sync OTA/PMS, tareas, fees y operación multiunidad |
| 4= | Restaurantes / comida rápida | **50** | Menú, promociones, pedido y estado | POS/KDS, stock 86, pago, delivery y conciliación |
| 4= | Automotriz / concesionario | **50** | Vehículo, media y test drive | DMS/VIN vivo, trade-in, F&I y compra |
| 6= | Turismo / hotel | **49** | Estadía, imágenes, disponibilidad y check-in | PMS/channel manager, room type/rate/folio |
| 6= | Restaurantes / dark kitchen | **49** | Pedido sin Agenda, mejor encaje de perfil | Agregadores/POS/KDS, multi-marca y dispatch |
| 8= | Inmobiliaria / arriendo | **48** | Listings y visitas | Aplicación, contrato, depósito y mantenimiento |
| 8= | Restaurantes / casual dining | **48** | Pedido y reserva básica | Mesa/turno/waitlist, POS/KDS y guest CRM |
| 8= | Gimnasios / gimnasio general | **48** | Planes, clases y acciones de membresía | Billing real, check-in/acceso, staff y entitlement vivo |

**Conclusión competitiva:** la mejor configuración alcanza 52/100. Parallly tiene una **capa conversacional de dominio prometedora**, no paridad con el líder. El líder gana por operar sobre inventario, capacidad, dinero, documentos y estados vivos; Parallly gana potencialmente por WhatsApp/Instagram, cuatro idiomas, handoff y CRM unificado. La estrategia sensata es conectar ambas cosas.

## 6. Prioridad de producto: peor no significa primero

La prioridad de implementación debe cruzar atractivo, brecha, tractabilidad, riesgo y posibilidad de integración. No conviene empezar por los puntajes más bajos si requieren construir un carrier, un marketplace o un core bancario.

Como señal auxiliar se calculó `brecha de mercado = atractivo × (100 − preparación) / 100`. Sirve para descubrir deuda de alto valor, pero **no** es un roadmap automático: un resultado alto puede significar “reclasificar”, “integrar” o “no entrar”, no “construir más rápido”.

| Subtipo | Brecha | Lectura correcta |
|---|---:|---|
| Wedding planner | **62** | Reclasificar; no profundizar el módulo fotográfico |
| Créditos | **54** | Solo capa sobre LOS/KYC; entrada regulada |
| Psicología | **52** | Oportunidad alta, condicionada a EHR y protocolo clínico |
| Taller automotriz | **52** | Separar de concesionario e integrar shop-management |
| Limpieza | **52** | Construir sobre un FSM común; alta tractabilidad |
| Pet hotel | **52** | Corregir SOR/capacidad/writer antes de vender |
| Contadores | **52** | Integrar practice management y portal documental |
| Fumigación | **51** | FSM recurrente más cumplimiento y trazabilidad química |
| Pet guardería | **50** | Corregir inconsistencia de disponibilidad y reserva |
| Salón de belleza | **49** | Brecha atractiva y construible; candidato prioritario |

### 6.1 Orden recomendado

| Prioridad | Wedge | Por qué | Condición de entrada |
|---:|---|---|---|
| 1 | Belleza, spa y estética | Atractivo 84–88; flujo muy conversacional; brechas compartidas y construibles | Staff/recursos UI, depósitos/no-show, paquetes/membresías, ficha y rebooking; EMR solo para estética regulada |
| 2 | Dental y especialistas/psicología | Atractivo 86–87; alto valor de recall/no-show | PMS/EHR connector, formularios/consentimiento, staff y política clínica |
| 3 | Inmobiliaria venta/arriendo | Atractivo 84 y base 48–52 | Fotos de Listings P0, feed vivo, favoritos/matching y flujo arriendo diferenciado |
| 4 | Gimnasios/estudios | Base de clases/membresía ya existe y atractivo 70–80 | Billing/entitlement, check-in/acceso, recursos; overrides por CrossFit/Pilates/Cycling/Martial |
| 5 | Restaurantes quick service/dark kitchen | Alto volumen y ajuste al canal | Integración POS/KDS/delivery, stock/ETA/pago y conciliación; no construir POS |
| 6 | Auto dealer + taller | WTP alto y lead value; dealer tiene buena cuña | DMS connector; separar dealer de repair order; fotos/estimate/approval para taller |
| 7 | Hospitality profesional | Buena base y atractivo 84–86 en operador profesional/boutique | PMS/channel manager primero; segmentación estricta; completar pago/tareas/fees |
| 8 | Home services sobre un FSM común | Siete subtipos comparten 60–70% del core | Dispatch, crew/skills, route, estimate/approval, work order, invoice; overrides después |

### 6.2 Decisiones de catálogo antes de construir

- Retirar o reclasificar `wedding_planner`.
- Definir `inmobiliaria/construccion`: proyecto nuevo en venta o empresa constructora; no ambas.
- Consolidar `veterinaria/peluqueria_canina` con `pet_services/peluqueria`.
- Dividir o retirar `finanzas/fintech` hasta tener modelo regulatorio concreto.
- Separar agencia de viajes de operador de tours.
- Separar broker de aseguradora; la aseguradora solo debe ser una capa sobre APIs enterprise.
- Convertir marketplace en una iniciativa arquitectónica independiente o retirarlo.
- Definir `otro` como módulos opt-in, no catálogo por defecto.

## 7. Bloqueos transversales y advertencias “imposible sin…”

### P0 — bloquean una promesa comercial segura

1. **Certificación real:** PostgreSQL, Redis, BullMQ, canales, proveedor LLM, pagos e integraciones reales; hoy 0/18.
2. **Activación por subtipo y plan:** unir manifest, `requiredPlanFeatures`, cuotas, sidebar, onboarding y readiness bloqueante.
3. **Media ligada al objeto:** upload/orden/portada para Listings y flujos equivalentes de tours, menú, mascotas y sesiones; el banco genérico no basta.
4. **Una sola verdad de capacidad:** disponibilidad y escritura deben consultar el mismo objeto con lock/hold; corregir boarding/rentals.
5. **Writers faltantes:** alquiler de vehículo y boarding; confirmar pospago de tours.
6. **Staff/resources:** UI real para profesionales, sedes, cabinas, sillas, equipos, bahías, mesas, bikes, reformers, guías y crews.
7. **Sistemas de registro:** conectores bidireccionales con source, TTL, ownership, idempotencia y reconciliación. Sin esto, salud, finanzas, seguros, POS, DMS, PMS, LMS, PSA y FSM solo pueden ser intake/handoff.
8. **Dinero como estado:** pago, depósito, expiración, refund, conciliación y entitlement deben cerrar el workflow; un link enviado no prueba pago ni reserva.

### Imposible o desaconsejable antes de una decisión externa

| Área | No avanzar sin… | Riesgo si se omite |
|---|---|---|
| Salud/psicología/farmacia | País objetivo, counsel, clasificación de datos, consentimiento, profesional responsable y EHR/PMS | Daño clínico, exposición de datos, dispensación o consejo no autorizado |
| Finanzas/crédito/fintech | Producto exacto, licencia/partner, KYC/AML, LOS/ledger y reglas por país | Aprobación, saldo, tasa o recomendación falsa; riesgo regulatorio |
| Seguros | Jurisdicción, rol broker/carrier, rating/PAS/claims APIs y lenguaje aprobado | Cobertura/cotización/reclamo incorrecto |
| Marketplace | Merchant of record, KYB, impuestos, pagos multiparte, payout, refund/dispute y riesgo | Responsabilidad financiera y operativa no modelada |
| Hospital 24h | Operación real 24×7, disponibilidad de staff y protocolo de triage/escalamiento | Falsa seguridad en una emergencia |
| Universidad/menores | SIS/admissions, identity, documentos, consentimiento y política de menores | Matrícula falsa o tratamiento indebido de datos |
| Hospitality/real estate/rentals | SOR y sincronización viva; locks, hold y reconciliación | Doble reserva, precio o disponibilidad falsa |

## 8. Diferencia frente a la mejor competencia

| Parallly hoy | Líder especializado | Implicación |
|---|---|---|
| Omnicanal, WhatsApp/IG, cuatro idiomas, RAG, CRM y handoff compartidos | Profundidad del workflow y datos transaccionales del sector | Mantener el horizontal como diferenciador; no duplicar todo el vertical |
| Objetos nativos en algunas verticales | Sistema de registro con historial, documentos, dinero, inventario y capacidad | Construir conectores y contratos de verdad antes que más prompts |
| Tool calling con policies y assurance | Acciones con identidad, permisos, auditoría, reconciliación y contexto vivo | Cerrar gaps de autorización/outcome, especialmente regulados |
| 75 labels de onboarding | Producto realmente distinto por subtipo | Reducir catálogo o crear overrides verificables; el número no es valor |
| Analítica genérica y algunos KPIs verticales heredados | KPIs propios del resultado operativo | Permitir KPI override por subtipo; farmacia, fast food, rentals, hardware y boarding hoy heredan KPIs incorrectos |

## 9. Trazabilidad del diagnóstico interno

Fuentes de verdad revisadas:

- catálogo y labels: [`apps/api/src/modules/verticals/vertical-definitions.ts`](../apps/api/src/modules/verticals/vertical-definitions.ts);
- manifest v2, tools, rutas, readiness y assurance: [`packages/shared/src/vertical-capability-manifest.ts`](../packages/shared/src/vertical-capability-manifest.ts);
- policy de claims/certificación: [`packages/shared/src/vertical-product-policy.ts`](../packages/shared/src/vertical-product-policy.ts);
- bootstrap y overrides: [`apps/api/src/modules/verticals/verticals.service.ts`](../apps/api/src/modules/verticals/verticals.service.ts);
- herramientas y ejecución: [`apps/api/src/modules/conversations/ai-tool-executor.service.ts`](../apps/api/src/modules/conversations/ai-tool-executor.service.ts) y [`apps/api/src/modules/conversations/tools`](../apps/api/src/modules/conversations/tools);
- contratos por subtipo: [`apps/api/src/modules/persona/vertical-subtype-persona-contract.ts`](../apps/api/src/modules/persona/vertical-subtype-persona-contract.ts);
- resolución de UI: [`apps/dashboard/src/lib/vertical-dashboard-resolver.ts`](../apps/dashboard/src/lib/vertical-dashboard-resolver.ts);
- Listings: [`apps/dashboard/src/app/admin/listings/page.tsx`](../apps/dashboard/src/app/admin/listings/page.tsx) y [`apps/dashboard/src/app/admin/listings/[listingId]/page.tsx`](../apps/dashboard/src/app/admin/listings/[listingId]/page.tsx);
- planes y feature gating: [`apps/api/src/modules/throttle/plan-features.registry.ts`](../apps/api/src/modules/throttle/plan-features.registry.ts) y [`apps/dashboard/src/hooks/usePlanLimits.ts`](../apps/dashboard/src/hooks/usePlanLimits.ts);
- estado de pruebas: [`vertical-waves-execution-2026-08.md`](./vertical-waves-execution-2026-08.md).

## 10. Fuentes competitivas oficiales verificadas

La investigación priorizó páginas de producto y documentación del proveedor, no rankings SEO. Fecha de consulta: 20 de agosto de 2026.

| Dominio | Fuentes primarias utilizadas | Qué se contrastó |
|---|---|---|
| Salud/belleza | [NexHealth](https://www.nexhealth.com/), [Pabau](https://pabau.com/features/), [SimplePractice](https://www.simplepractice.com/features/), [PioneerRx](https://www.pioneerrx.com/pharmacy-software), [Zenoti](https://www.zenoti.com/pricing-zenoti), [Fresha](https://www.fresha.com/en-GB/for-business/features), [SQUIRE](https://getsquire.com/) | Scheduling, recursos, intake/consent, expediente, pagos, membresías, POS/inventario |
| Inmobiliaria/construcción | [Lofty](https://lofty.com/real-estate/crm), [Follow Up Boss](https://www.followupboss.com/features/action-plans), [Buildout](https://www.buildout.com/), [Buildertrend](https://buildertrend.com/product-overview/) | Listings/data, lead nurture, transaction, CRE, proyecto/estimate/portal |
| Restaurantes | [Toast](https://pos.toasttab.com/how-toast-works), [Deliverect](https://www.deliverect.com/en/customer-type/restaurant), [SevenRooms](https://sevenrooms.com/) | POS/KDS, ordering, delivery, menu/stock, mesas/waitlist, guest CRM |
| Automotriz | [Tekion](https://tekion.com/products), [Impel](https://impel.ai/platform-overview/), [Shopmonkey](https://www.shopmonkey.io/), [HQ Rental](https://hqrentalsoftware.com/) | DMS, VIN/media, sales/service, repair order, fleet/reservas |
| Turismo | [Travefy](https://travefy.com/), [Cloudbeds](https://www.cloudbeds.com/hospitality-platform/), [Rezdy](https://support.rezdy.com/hc/en-us/articles/19867793699612-What-Is-a-Resource-and-How-To-Set-Them-Up), [Guesty](https://www.guesty.com/) | Itinerario, PMS/channel manager, recursos/cupos, STR/OTA/operaciones |
| Educación | [Teachworks](https://www.teachworks.com/language-school-management-software), [Element451](https://element451.com/element-admissions-ai-agent-teams), [Thinkific](https://www.thinkific.com/), [Arlo](https://www.arlo.co/), [Moodle Workplace](https://moodle.com/us/products/workplace) | Escuela, admisiones, LMS/commerce, TMS/certificación |
| Finanzas/seguros | [Salesforce FSC](https://www.salesforce.com/financial-services/cloud/guide/), [Blend](https://info.blend.com/hubfs/PDF/one_pager/Blend_Fact_Sheet.pdf), [Applied Epic](https://www1.appliedsystems.com/en-us/solutions/for-agents/agency-management-system/applied-epic), [Guidewire](https://www.guidewire.com/products) | Customer/household, lending, broker lifecycle, carrier core |
| Profesionales/tech | [Clio](https://www.clio.com/grow/), [TaxDome](https://taxdome.com/), [Scoro](https://www.scoro.com/), [ConnectWise PSA](https://www.connectwise.com/platform/psa), [Intercom Fin](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained) | Intake/matter, documentos, project/PSA, tickets/SLA, datos/acciones de soporte |
| Retail/marketplace | [Shopify POS](https://www.shopify.com/pos/features), [Shopify Inventory](https://www.shopify.com/inventory-management), [Stripe Connect](https://docs.stripe.com/connect) | Comercio unificado, stock/fulfillment y marketplace multiparte |
| Veterinaria/pet | [ezyVet](https://www.ezyvet.com/features), [PetDesk 2026](https://info.petdesk.com/hubfs/2026%20PD%20State%20of%20Practice%20Management%20Report/State-of-Veterinary-Practice-Management-2026-Report-PetDesk.pdf), [MoeGo](https://help.moego.pet/en), [Time To Pet](https://www.timetopet.com/scheduling) | PIMS, engagement, grooming/boarding/capacidad y field service pet |
| Fitness | [Glofox](https://www.glofox.com/), [Wodify](https://www.wodify.com/solutions/crossfit-functional-fitness), [Mariana Tek](https://www.marianatek.com/features/business-management/), [Zen Planner](https://zenplanner.com/martial-arts/) | Membresías/billing/access, WOD, spot/equipment y belt/skills |
| Home services | [ServiceTitan](https://www.servicetitan.com/industries/plumbing-software), [FieldRoutes](https://www.fieldroutes.com/solutions/pest-control-software), [Jobber](https://www.getjobber.com/industries/landscaping/), [Housecall Pro](https://www.housecallpro.com/industries/locksmith-software/) | Dispatch/FSM, recurrencia/rutas, estimate/work order/invoice |
| Fotografía/eventos | [HoneyBook](https://www.honeybook.com/business-type/photographers), [Pixieset](https://pixieset.com/studio-manager/), [Aisle Planner](https://aisleplanner.com/) | Proyecto creativo, contrato/retainer/galería y planificación de boda |

## 11. Límites de esta auditoría

- El score competitivo es una evaluación experta reproducible con la rúbrica indicada; no es un benchmark de conversión con clientes reales.
- Los puntajes puntuales tienen un margen razonable de ±4; su uso correcto es priorizar y comparar bandas, no fingir precisión financiera.
- No se probaron tenants productivos ni se ejecutaron credenciales de terceros, pagos reales o canales certificados.
- Las reglas legales varían por país. `REG` significa “requiere diseño/counsel local”, no una conclusión jurídica.
- Las cifras de atractivo con confianza B/C deben validarse con entrevistas, win/loss, pricing tests y cohortes por país antes de decidir inversión.
- La auditoría compara capacidades mínimas. Parallly no necesita replicar cada módulo del líder si integra el sistema de registro y posee la capa conversacional.
