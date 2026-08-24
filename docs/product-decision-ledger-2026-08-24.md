# Registro de decisiones de producto — intervención vertical

Fecha de apertura: 24 de agosto de 2026

Estado: decisiones del dueño cerradas; aprobaciones externas pendientes

Alcance: decisiones del dueño de producto; no autoriza todavía cambios de taxonomía, migraciones ni activación de integraciones.

## Regla de cierre

Cada decisión se revisa 1:1. Una resolución queda cerrada únicamente cuando registra:

1. opción aprobada;
2. alcance incluido y excluido;
3. impacto en taxonomía, tenants existentes, menús, prompts, variables, tools, fuente de verdad y claims comerciales;
4. condición de migración o activación;
5. riesgos y evidencia todavía requerida.

Las aprobaciones expertas, de país, proveedor y piloto se controlan por separado: una decisión de producto no certifica por sí sola el subtipo.

## Estado general

| Grupo | Total | Cerradas | Pendientes |
|---|---:|---:|---:|
| Perfiles `strategy: stop` | 7 | 7 | 0 |
| Gates auditables por subtipo | 17 | 17 | 0 |
| Decisiones transversales | 8 | 8 | 0 |
| Política de locales/mercados | 2 | 2 | 0 |
| **Total decisiones del dueño** | **34** | **34** | **0** |

Fuera de estas 34 decisiones siguen existiendo 21 aprobaciones regulatorias/de dominio, 60 revisiones de terminología heredada y 15 promociones de packs de país. No se contarán como cerradas hasta tener la evidencia y el responsable requeridos.

## Orden de resolución aplicado

Se resolvieron primero las siete taxonomías o alcances bloqueados, en este orden: `P03`, `P04`, `P01`, `P02`, `P05`, `P06`, `P07`. Después se cerraron los gates 1:1 (`P08`–`P24`), las decisiones transversales (`P25`–`P32`) y las dos políticas de mercado (`P33`–`P34`). La aprobación autoriza incorporarlas al plan de implementación; no ejecuta migraciones ni elimina los gates de evidencia.

## Decisiones fundamentales

| ID | Perfil/tema | Decisión requerida | Estado |
|---|---|---|---|
| P01 | `finanzas/fintech` | Elegir una familia concreta de producto antes de definir ledger, regulación, KYC/AML, disputas, menús y tools. | **Aprobada — 24-08-2026** |
| P02 | `retail/marketplace` | Definir merchant of record, modelo multi-vendedor, KYB, comisiones, payouts y disputas. | **Aprobada — 24-08-2026** |
| P03 | `fotografia/wedding_planner` | Separar la planificación de bodas de Fotografía y convertirla en una familia propia de planificación de eventos. | **Aprobada — 24-08-2026** |
| P04 | `inmobiliaria/construccion` | Separar venta/promoción de proyectos inmobiliarios de gestión de obra/contratista. | **Aprobada — 24-08-2026** |
| P05 | `technology/consultoria_ti` | Elegir mesa de servicio MSP o consultoría por proyectos. | **Aprobada — 24-08-2026** |
| P06 | `seguros/aseguradora` | Definir capa conversacional integrada y el PAS/core con autoridad para operación de carrier. | **Aprobada — 24-08-2026** |
| P07 | `seguros/salud` | Definir core de pagador, controles sobre PHI y alcance de elegibilidad, autorizaciones y EOB. | **Aprobada — 24-08-2026** |

### Resolución P01 — `finanzas/fintech`

**Opción aprobada:** retirar el subtipo genérico `fintech` y reemplazarlo por una familia concreta de **Pagos y recaudos**.

**Contrato aprobado para el futuro plan de implementación:**

- Parallly funcionará como capa conversacional y operativa de onboarding, atención, seguimiento y escalamiento; nunca como core financiero.
- El alcance incluirá recepción documental, captura de datos KYC/KYB, enlaces o intenciones de pago mediante proveedores autorizados, consulta de estado, comisiones y conciliación, y gestión de casos por rechazo, devolución o disputa.
- Capturar KYC/KYB no autoriza a Parallly a aprobarlo. El resultado, riesgo, estado del pago, saldo, conciliación y resolución de disputas provendrán del proveedor/core como SoR.
- Cada lectura mostrará proveedor, estado, `asOf`/frescura y modo degradado. Cada writer exigirá permiso, readiness, confirmación, idempotencia y adapter certificado.
- Menús operativos previstos: Operación/pagos, Clientes o comercios, Onboarding/KYC, Conciliación, Casos/disputas e Integraciones; el CRM comercial permanecerá separado.
- Los prompts y templates no prometerán aprobación, disponibilidad de fondos, reverso, devolución ni fecha de liquidación sin respuesta verificable del SoR.
- `fintech` permanecerá como alias legacy fuera del selector. Remesas, wallet/neobanco, inversión, crédito y otras familias solo podrán aparecer después como subtipos independientes con contrato y revisión propios.

**Exclusiones:** custodia de fondos, balances o ledger nativo, transferencias/remesas directas, productos de inversión o crédito, consejo financiero, decisiones KYC/AML, congelamiento de fondos y resolución autónoma de disputas.

**Condición de activación:** proveedor y versión de API certificados; sandbox con transacciones aprobadas, rechazadas, pendientes, reversadas y disputadas; webhooks firmados e idempotentes; conciliación y rollback demostrados; revisión legal por jurisdicción; piloto y sign-off.

**Alerta:** las capacidades actuales de cobro de tenants son una base técnica, no evidencia de que Parallly pueda operar como PSP. Las credenciales, fondos y conciliación de cada tenant continuarán aislados de la facturación de la plataforma.

### Resolución P02 — `retail/marketplace`

**Opción aprobada:** marketplace multivendedor de intermediación, sin custodia de fondos y sin convertir a Parallly en merchant of record.

**Contrato aprobado para el futuro plan de implementación:**

- El tenant será el operador del marketplace; cada vendedor será el comerciante legal y responsable de sus productos, inventario, impuestos, cumplimiento, garantías y devoluciones.
- Cada vendedor tendrá identidad, estado, KYB, catálogo, inventario, políticas, pedidos, liquidaciones y casos aislados. Ninguna herramienta podrá operar un recurso sin `seller_id`/ownership verificable.
- El PSP o plataforma de marketplace autorizada será el SoR de KYB, cobro, comisión, split y payout. Parallly solo mostrará su estado y ejecutará operaciones expresamente soportadas por un adapter certificado.
- La primera certificación permitirá un vendedor por checkout. Un carrito multivendedor requerirá posteriormente división determinista de órdenes, pagos, envíos, impuestos, devoluciones, disputas e idempotencia.
- Parallly cubrirá búsqueda conversacional, selección de vendedor/producto, checkout alojado autorizado, consulta de pedido y creación/escalamiento de casos.
- Menús previstos: Vendedores, Catálogo, Pedidos, Compradores, Comisiones/payouts, Disputas e Integraciones. El pipeline comercial seguirá separado de pedidos y liquidaciones.
- Prompts, variables y templates identificarán siempre vendedor responsable, políticas aplicables, moneda, impuestos, disponibilidad, `asOf`, estado de pago/payout y autoridad de cada acción.
- `retail/marketplace` permanecerá fail-closed hasta existir contrato multi-tenant/multi-seller, proveedor y migración; no reutilizará silenciosamente el flujo monovendedor de e-commerce.

**Exclusiones iniciales:** custodia de fondos, payouts manuales, merchant of record de Parallly, inventario sin ownership, carrito multivendedor, compensación interna, crédito al vendedor y decisiones KYB/fraude/disputa sin proveedor.

**Condición de activación:** modelo contractual del operador y vendedores; PSP con connected accounts/marketplace; KYB, comisiones, payout, refund, chargeback y conciliación probados en sandbox; aislamiento por vendedor; revisión fiscal/legal por país; piloto y sign-off.

**Alerta:** incluso sin custodia, el operador puede conservar obligaciones frente al comprador según la jurisdicción. El claim comercial no podrá prometer “marketplace listo” hasta validar contratos, impuestos, devoluciones y protección al consumidor en cada mercado.

### Resolución P03 — `wedding_planner`

**Opción aprobada:** crear una familia canónica propia de planificación de eventos, con bodas como subtipo, y retirar `fotografia/wedding_planner` del selector de Fotografía.

**Contrato aprobado para el futuro plan de implementación:**

- Fotografía continúa cubriendo sesiones, paquetes, producción y entrega de material; no planificación integral de bodas.
- La nueva familia tendrá como objetos primarios evento, cliente/pareja, invitados, proveedores, presupuesto, cronograma, checklist, espacios, contratos, pagos y RSVP/seating cuando corresponda.
- Sus menús, prompts, variables, templates, términos, tools, navegación, permisos, Active Objects, SoR y evals serán propios; no heredará el toolset de fotografía.
- `fotografia/wedding_planner` quedará como alias de compatibilidad para identificar datos heredados, pero no volverá al selector ni habilitará writers por sí solo.
- Ningún tenant existente se reasignará silenciosamente. Permanecerá en estado legacy/fail-closed hasta completar preflight, clasificación, vista previa del cambio, consentimiento de migración y rollback.
- El slug canónico definitivo, el nombre comercial en los cuatro idiomas y el incremento del conteo canónico se fijarán en el plan de implementación después de cerrar las 34 decisiones.

**Exclusiones:** la aprobación no activa venta de entradas, catering, pagos, RSVP, seating, contratación de proveedores ni migraciones. Cada capacidad deberá aprobar su fuente de verdad, permisos, readiness y evidencia antes de publicarse.

### Resolución P04 — `inmobiliaria/construccion`

**Opción aprobada:** dividir el subtipo actual en dos experiencias canónicas independientes:

1. **Desarrollo inmobiliario/promotora:** comercialización de proyectos nuevos con proyecto, torre/bloque, etapa, tipología y unidad como jerarquía operativa; inventario y disponibilidad, listas de precios, leads, visitas, separación/reserva y planes de pago.
2. **Construcción/contratista:** ejecución y seguimiento de obras con proyecto/obra, presupuesto, fases, hitos y avances; materiales, subcontratistas, órdenes de trabajo, cambios, inspecciones, incidencias y entregables.

**Contrato aprobado para el futuro plan de implementación:**

- Cada experiencia tendrá navegación, prompts, variables, templates, términos, tools, permisos, Active Objects, workflows, SoR, integraciones, evals y benchmark propios.
- El CRM de venta permanecerá separado de los registros operativos: una oportunidad no se llamará unidad, reserva, obra, presupuesto ni orden de trabajo.
- El modelo de promotora no prometerá administración completa de obra; el modelo de contratista no publicará inventario inmobiliario ni reservas de unidades salvo que se agregue después una experiencia comercial explícita.
- `inmobiliaria/construccion` quedará como alias legacy, fuera del selector para nuevas altas.
- Cada tenant existente deberá clasificarse mediante `business_model` y preflight de datos. No habrá inferencia destructiva ni migración silenciosa.
- Si un tenant realmente opera ambos modelos, usará dos espacios/experiencias coordinados y fuentes de verdad explícitas; no un contrato mezclado.
- Los slugs definitivos, nombres comerciales en cuatro idiomas, aliases y cambio del conteo canónico se fijarán al construir el plan de implementación final.

**Condición de migración:** inventario de tenants afectados, clasificación confirmada por el dueño del tenant, vista previa, backup, migración idempotente, verificación posterior y rollback. Hasta entonces el perfil heredado permanece legacy/fail-closed para writers no certificados.

**Alerta:** esta división cambia la taxonomía canónica y puede revelar tenants híbridos. Antes de codificar será obligatorio definir qué datos pertenecen a cada espacio y evitar duplicar contactos, oportunidades, documentos o pagos.

### Resolución P05 — `technology/consultoria_ti`

**Opción aprobada:** reemplazar el perfil ambiguo por **Soporte TI / MSP**, orientado a mesa de servicio. La consultoría tecnológica por proyectos se atenderá mediante `servicios_profesionales/consultores` o un futuro subtipo de proyectos TI, pero no se mezclará con tickets/SLA.

**Contrato operativo:** solicitud/ticket, solicitante, organización, sede, activo, categoría, impacto, urgencia, prioridad, SLA, técnico, agenda/dispatch, aprobaciones y resolución. Menús: Mesa de servicio, Tickets, Organizaciones, Activos, Agenda/dispatch, SLA, Conocimiento e Integraciones. Parallly podrá ofrecer intake y casos ligeros; un ITSM/PSA será SoR cuando exista binding.

**Prompts/tools:** recopilar diagnóstico seguro, consultar conocimiento autorizado, crear/consultar/actualizar tickets dentro de permisos, coordinar atención y escalar. Nunca pedir contraseñas, secretos o códigos MFA; nunca ejecutar comandos, acceso remoto o cambios de infraestructura autónomos.

**Exclusiones y gate:** SOW, staffing, hitos, entregables, tiempo, facturación y rentabilidad de proyectos pertenecen a Consultores. Activos, SLA complejos, contratos MSP y automatización remota necesitan ITSM/PSA certificado, revisión de seguridad y piloto.

### Resolución P06 — `seguros/aseguradora`

**Opción aprobada:** mantener **Aseguradora** únicamente como capa conversacional integrada al PAS/core del carrier; no construir un core asegurador nativo.

**Contrato operativo:** prospecto/asegurado, póliza, cobertura publicada, recibo, beneficiario autorizado, FNOL/aviso inicial, siniestro/caso, documentos, cita y estado. Menús: Clientes, Pólizas, Cotizaciones/solicitudes, Siniestros, Pagos/documentos, Casos y Compliance. El PAS/core será SoR de producto, pricing, underwriting, emisión, endosos, cobranza, reservas, decisión y pago del siniestro.

**Prompts/tools:** explicar solo información recuperada, capturar solicitudes y FNOL, consultar estados con verificación de identidad, cargar documentos y escalar. Nunca confirmar cobertura, prima final, emisión, aceptación, responsabilidad, reserva, indemnización o fecha de pago sin respuesta autoritativa.

**Exclusiones y gate:** underwriting, bind/issue, endosos, cancelación, cobertura, reservas, fraude y claims settlement no serán nativos. El perfil permanece no comercializable hasta definir país/ramo, PAS/core, identidad reforzada, adapter certificado, revisión regulatoria y piloto.

### Resolución P07 — `seguros/salud`

**Opción aprobada:** ofrecer una capa de servicio al afiliado/pagador estrictamente integrada; el core del pagador y sus redes serán la autoridad de elegibilidad, beneficios, autorizaciones, reclamaciones y EOB.

**Contrato operativo:** afiliado/dependiente, plan, elegibilidad, beneficio, red/prestador, autorización, reclamación, EOB, documento, caso y escalamiento. Menús: Afiliados, Elegibilidad/beneficios, Red, Autorizaciones, Reclamaciones/EOB, Casos y Privacidad.

**Prompts/tools:** verificación reforzada antes de PHI; mínimo dato necesario; consultas con `asOf`; intake documental; explicación textual no clínica de estados recuperados; handoff seguro. Nunca diagnosticar, recomendar tratamiento, prometer cobertura, interpretar necesidad médica, aprobar autorización/reclamación ni revelar datos de otro miembro.

**Exclusiones y gate:** no se almacenará un EHR ni se replicará el core de pagador. El perfil permanece fail-closed hasta definir jurisdicción, base legal/consentimiento, retención, auditoría, controles PHI, core/red real, adapter certificado, revisión de privacidad/seguros y piloto.

## Gates auditables por subtipo

| ID | Perfil | Gate | Estado |
|---|---|---|---|
| P08 | `salud/farmacia` | Límite OTC/pedidos frente a dispensación regulada. | **Aprobada — 24-08-2026** |
| P09 | `automotriz/taller` | Alcance liviano del taller sin prometer DMS o diagnóstico. | **Aprobada — 24-08-2026** |
| P10 | `automotriz/taller` | Confirmar `repair order` como objeto operativo y corregir clasificación. | **Aprobada — 24-08-2026** |
| P11 | `automotriz/alquiler` | Disponibilidad, elegibilidad, depósito, contrato y daños. | **Aprobada — 24-08-2026** |
| P12 | `turismo/agencia_viajes` | Agencia/intermediación frente a tour operator. | **Aprobada — 24-08-2026** |
| P13 | `turismo/agencia_viajes` | Ownership de itinerario/cotización y corrección de clasificación. | **Aprobada — 24-08-2026** |
| P14 | `education/online` | Coordinación/venta frente a LMS, evaluación, progreso y certificados. | **Aprobada — 24-08-2026** |
| P15 | `servicios_profesionales/abogados` | Captación/coordinación sin asesoría jurídica ni sustitución de matter management. | **Aprobada — 24-08-2026** |
| P16 | `servicios_profesionales/contadores` | Coordinación documental sin criterio fiscal/contable automatizado. | **Aprobada — 24-08-2026** |
| P17 | `servicios_profesionales/consultores` | CRM/propuesta frente a delivery, staffing, tiempo y rentabilidad. | **Aprobada — 24-08-2026** |
| P18 | `technology/saas` | Venta/soporte frente a entitlement, billing y acciones administrativas. | **Aprobada — 24-08-2026** |
| P19 | `servicios_hogar/fumigacion` | Licencias, químicos/lotes, recurrencia y compliance. | **Aprobada — 24-08-2026** |
| P20 | `servicios_hogar/cerrajeria` | Verificación de autoridad antes de dispatch o acceso. | **Aprobada — 24-08-2026** |
| P21 | `pet_services/guarderia` | Retirar o mantener contención tras revisar requisitos de la capacidad nativa. | **Aprobada — 24-08-2026** |
| P22 | `pet_services/hotel` | Noches, alimentación, medicación, contrato y depósito. | **Aprobada — 24-08-2026** |
| P23 | `fotografia/producto` | Alcance fotográfico permitido. | **Aprobada — 24-08-2026** |
| P24 | `fotografia/producto` | Mantener en Fotografía o migrar a DAM/producción comercial. | **Aprobada — 24-08-2026** |

### Acta 1:1 de P08–P24

| ID | Resolución aprobada | Contrato operativo, menús, prompts y tools | Exclusiones, SoR y gate |
|---|---|---|---|
| P08 | Farmacia cubre catálogo y pedidos OTC, más recepción/seguimiento de recetas bajo validación farmacéutica; se retira la contención histórica solo para ese alcance. | Objetos: producto, disponibilidad, pedido, paciente verificado, receta/documento y validación. Menús: Pedidos, Catálogo/stock, Recetas por validar, Clientes, Entregas y Compliance. El agente puede buscar OTC, crear pedido, recibir receta y consultar estado. | PMS/farmacéutico autorizado decide dispensación, sustitución, dosis, interacciones y validez. Sin diagnóstico ni consejo clínico. Requiere país, licencia, categorías OTC/Rx, privacidad, adapter o cola humana y eval regulatorio. |
| P09 | Se aprueba Taller liviano para intake, agenda, recepción, estimación, autorización y seguimiento; no se presenta como DMS ni herramienta de diagnóstico. | Menús: Citas/recepción, Órdenes de reparación, Vehículos/clientes, Presupuestos/aprobaciones, Técnicos/agenda, Repuestos y Entregas. Prompts recopilan síntoma declarado sin inventar causa; tools crean solicitud/cita/RO y consultan estado. | Diagnóstico, tiempos de reparación, repuestos, garantía y precio final provienen del taller/DMS y técnico. Operaciones profundas requieren DMS/parts catalog certificado y piloto. |
| P10 | `repair_order`/orden de reparación será el objeto operativo canónico; oportunidad CRM, cita y presupuesto conservarán identidades distintas. | La RO enlaza vehículo, odómetro, síntomas, inspección, trabajos, repuestos, técnico, estimado, aprobaciones y estados. Active Object y deep link apuntarán a la RO, no al pipeline. | Migración debe evitar renombrar oportunidades o citas como RO. Alias y labels serán locales; se exige integridad de relaciones, permisos por rol y trazabilidad de aprobaciones. |
| P11 | Se aprueba Alquiler automotriz nativo ligero: disponibilidad, solicitud, elegibilidad, reserva, depósito, contrato, entrega/devolución y reporte de daños. | Menús: Disponibilidad/reservas, Flota, Clientes/conductores, Contratos, Entregas/devoluciones, Daños y Pagos. Variables incluyen sede, categoría/vehículo, fechas, conductor, licencia, edad, depósito, extras y estado. | Identidad/licencia, fraude, cobro, seguro y contrato deben validarse por humano/proveedor. Sin telemática, pricing dinámico o decisión de cobertura nativos. Requiere locks de capacidad, pagos, firma/OTP, inspección y piloto. |
| P12 | Agencia de viajes será intermediaria/comercializadora; Tour operator permanece como experiencia separada para inventario y operación propia. | Menús: Solicitudes, Cotizaciones, Viajeros, Itinerarios, Reservas, Documentos/pagos y Casos. El agente capta preferencias, arma opciones publicadas, solicita reserva y acompaña cambios. | No se inventan cupos, tarifas, visa, políticas ni confirmaciones. Proveedores/GDS/operadores conservan inventario y reserva. Requiere disclosure de intermediación y revisión de consumidor/turismo. |
| P13 | Parallly será SoR del lead, requisitos y borrador de cotización; GDS/proveedor/backoffice será SoR de precio vivo, disponibilidad, PNR, ticket, reserva confirmada e itinerario final. | Cada opción/cotización registra proveedor, moneda, vigencia, `asOf`, reglas y estado. Tools separan buscar/cotizar/solicitar/confirmar/cancelar y no convierten un borrador en reserva. | Sin integración viva se ofrece solicitud con handoff, no confirmación. Mapping, expiración, reconciliación, cancelaciones, reembolsos e idempotencia deben probarse por proveedor. |
| P14 | Educación online cubre captación, matrícula, acceso, soporte y coordinación; el LMS controla contenido, progreso, evaluación y certificados. | Menús: Admisiones/matrículas, Estudiantes, Cursos/cohortes, Acceso/soporte, Progreso enlazado, Certificados enlazados y Pagos. El agente consulta catálogo, requisitos, acceso y estado publicado. | Nunca alterar notas, progreso, evaluación o certificado fuera del LMS. Requiere adapter LMS, identidad del estudiante/tutor, consentimiento, política de menores y piloto. |
| P15 | Abogados cubre intake, conflicto, consulta, documentos y estado administrativo del asunto, sin ejercer derecho. | Menús: Intake/conflictos, Clientes, Asuntos/casos, Calendario/plazos, Documentos, Consultas y Facturación enlazada. Prompts usan disclaimer contextual y derivan consejo al profesional. | Practice/matter management y abogado son SoR de conflicto, estrategia, plazo y consejo. Sin predicciones, interpretación legal ni creación de relación abogado-cliente implícita. Revisión por jurisdicción obligatoria. |
| P16 | Contadores cubre coordinación documental, checklist, vencimientos, citas y estado del trabajo; no criterio fiscal/contable autónomo. | Menús: Clientes/entidades, Trabajos, Vencimientos, Documentos, Declaraciones enlazadas, Consultas y Facturación. Tools solicitan faltantes y consultan estados autorizados. | Software contable/fiscal y contador son SoR de cifras, clasificación, cálculo, filing y consejo. Requiere período/autoridad explícitos, privacidad, revisión país y adapter cuando se prometa estado real. |
| P17 | Consultores separa Ventas de Delivery: Parallly cubre lead, discovery, propuesta/SOW y coordinación ligera; un PSA controla staffing, tiempo, gastos, facturación y rentabilidad cuando se necesiten. | Menús: Ventas/propuestas, Engagements, Entregables/hitos, Agenda, Documentos y PSA/facturación enlazada. Oportunidad, SOW, engagement y entregable son objetos distintos. | No prometer capacidad, fecha, consumo de retainer o margen sin PSA. Requiere approval de alcance/cambios, SoR por objeto, integración y piloto para operación avanzada. |
| P18 | SaaS cubre adquisición, onboarding, soporte y acciones administrativas integradas; entitlement y billing permanecen en el producto SaaS/core de suscripción. | Menús: Prospectos, Cuentas/usuarios, Onboarding, Tickets, Suscripción/uso enlazados, Incidentes e Integraciones. Tools leen plan/estado/entitlement y ejecutan acciones allowlisted con confirmación. | Sin inventar acceso, consumo, factura, crédito o SLA. Cambios de plan, usuarios, seguridad y datos exigen API, autoridad e idempotencia. Nunca pedir secretos ni ejecutar acciones destructivas sin aprobación reforzada. |
| P19 | Fumigación se aprueba como servicio regulado con inspección, cotización, agenda, orden, recurrencia y registro de aplicación. | Menús: Solicitudes/inspecciones, Agenda, Órdenes, Clientes/sedes, Químicos/lotes, Técnicos/licencias, Recurrencias y Compliance. Variables incluyen plaga declarada, sitio, riesgo, personas/animales, producto/lote y aftercare publicado. | Solo técnico licenciado decide sustancia, dosis, tratamiento y reingreso. Requiere licencias, SDS, lotes, trazabilidad, restricciones locales, field-service/stock y revisión experta país. |
| P20 | Cerrajería permite intake y agenda/dispatch únicamente después de verificar autoridad proporcional al riesgo. | Menús: Solicitudes por verificar, Agenda/dispatch, Clientes/ubicaciones, Técnicos, Evidencia/consentimiento y Auditoría. El agente recoge situación y prueba autorizada sin revelar criterios internos de fraude. | Nunca enseñar bypass, guardar códigos/llaves, despachar apertura sensible solo por afirmación ni atender acceso ilegal. Emergencias físicas se derivan a autoridades. Requiere policy de identidad/propiedad, OTP/documento, retención mínima y humano. |
| P21 | Guardería de mascotas queda habilitable como experiencia diurna propia; se retira la contención histórica tras readiness y revisión experta. | Objetos: mascota/tutor, vacunas, temperamento, alimentación/medicación, cupo por zona, reserva, check-in/out, consentimiento e incidente. Menús: Hoy/check-in, Reservas, Mascotas, Cupos, Cuidados, Incidentes y Pagos. | No aceptar sin requisitos vigentes ni dar consejo veterinario. Capacidad transaccional, aislamiento, autorizaciones médicas, emergencia, depósito y normativa local deben validarse antes del claim. |
| P22 | Hotel de mascotas queda como experiencia nocturna separada de guardería, con noches, alojamiento, cuidados y depósito. | Menús: Ocupación/estadías, Reservas, Mascotas/tutores, Alojamientos, Alimentación/medicación, Incidentes, Contratos y Pagos. Variables incluyen check-in/out, unidad, noches, convivencia, pertenencias y contacto de emergencia. | No reutilizar una cita como estadía. Requiere lock de ocupación, vacunas, consentimiento, protocolo veterinario, contrato, depósito, cancelación y revisión local. |
| P23 | Fotografía de producto cubre producción comercial ligera: brief, SKUs, shot list, estilo/fondo, logística de muestras, sesión, selección, retoque, revisiones, licencia y entrega. | Menús: Solicitudes/cotizaciones, Trabajos, Productos/shot lists, Calendario/recursos, Muestras, Revisiones/aprobaciones y Entregas/licencias. El agente cotiza solo desde paquetes/reglas publicadas. | No gestionar todo el ciclo de marketing, PIM o DAM. Uso, territorios, duración, urgencia, formatos y derechos deben ser variables explícitas; almacenamiento/entrega y aprobación requieren evidencia. |
| P24 | `fotografia/producto` permanece en Fotografía con un objeto `production_job`; no migra a DAM ni a una familia de planificación de eventos. | El job enlaza brief, productos/SKUs, sesión, activos, versiones, revisión y entrega. Se corrige el toolset para no tratarlo como sesión genérica ni wedding planning. | Si un cliente necesita DAM/PIM/campañas, se integra o se clasifica en otro producto. Alias/migración deben conservar trabajos y archivos; media permissions y licencias son gate de activación. |

## Decisiones transversales

| ID | Tema | Decisión requerida | Estado |
|---|---|---|---|
| P25 | Verificación de correo | Bloqueo completo o verificación progresiva con gates sensibles. | **Aprobada — 24-08-2026** |
| P26 | SMS reseller | Mantener retirado o reabrir como producto unidireccional con contrato económico y operativo propio. | **Aprobada — 24-08-2026** |
| P27 | Analytics multi-cuenta | Agregado por tipo de canal o drill-down por `channel_account`. | **Aprobada — 24-08-2026** |
| P28 | Email | Adapter inbound interno o canal tenant self-service certificado. | **Aprobada — 24-08-2026** |
| P29 | Planner de intents | `toolPlan` declarativo con ejecutor default-deny o planner/FSM determinista. | **Aprobada — 24-08-2026** |
| P30 | Reloj Channel Manager | `syncInterval` tenant separado o freshness/telemetría unificados. | **Aprobada — 24-08-2026** |
| P31 | Binding de proveedor | Desplazamiento conservador tenant-wide o binding obligatorio por recurso/sede. | **Aprobada — 24-08-2026** |
| P32 | Mindbody | Agenda espejada con `asOf` o disponibilidad live obligatoria para prometer cupo. | **Aprobada — 24-08-2026** |

### Acta 1:1 de P25–P32

| ID | Resolución aprobada | Contrato y efecto | Gate/alerta |
|---|---|---|---|
| P25 | Mantener verificación de correo **progresiva**, con gates obligatorios para acciones sensibles y producción. | Un usuario no verificado puede entrar, corregir su correo, completar configuración no operativa y probar en sandbox. Debe verificar antes de activar canales, agentes o integraciones; enviar mensajes/campañas; invitar usuarios; cargar secretos; configurar cobros; comprar/activar entitlement pagado o ejecutar acciones administrativas sensibles. La UI mostrará estado, reenvío, cambio de correo y recuperación. | El backend, no solo el menú, aplica los gates. Sesiones no verificadas tendrán límites antiabuso y restricción temporal; el flujo debe cubrir rebotes, cambio de correo, OAuth, rescate y auditoría sin bloquear soporte. |
| P26 | Mantener **retirado SMS reseller**. SMS conserva únicamente compatibilidad legacy y no se ofrece como canal conversacional ni producto nuevo. | Se ocultan alta, precios y claims. Webhooks/status necesarios para obligaciones heredadas pueden permanecer aislados. Una reapertura será un proyecto separado de notificación unidireccional, nunca una conexión de agente. | Reabrir exigiría país/proveedor, fiscalidad, consentimiento/opt-out, sender registration, pricing/margen, créditos, callback final por SID, refund selectivo, soporte y piloto. No forma parte del plan vertical inmediato. |
| P27 | Conservar el agregado por `channel_type` como vista predeterminada y añadir drill-down/filtro/exportación por `channel_account`. | KPIs, series, CSV y BI podrán desglosar cada número/conexión con ID estable y label administrable; el total seguirá reconciliando exactamente con la suma de cuentas. RBAC limitará cuentas por rol/asignación y evitará exponer identificadores sensibles. | Requiere backfill de atribución, tratamiento de cuentas desconectadas/renombradas, cardinalidad, permisos, prueba de reconciliación y retención. No se cambia la métrica histórica silenciosamente. |
| P28 | Mantener Email como **adapter inbound interno**, fuera del selector self-service y del pivot de canales certificados. | Se documenta como capacidad interna/legacy; no se prometen configuración tenant, agente por conexión, outbound, métricas de conversación o SLA. La UI sin backend se retira u oculta. | Convertirlo en canal requerirá proyecto propio: OAuth/IMAP/provider, threading, attachments, spam/bounce, identidad, consentimiento, outbound, configuración, observabilidad, soporte, analytics, E2E y certificación. |
| P29 | Adoptar arquitectura **híbrida**: `toolPlan` declarativo + ejecutor default-deny para conversación general, y máquinas de estado deterministas solo para workflows transaccionales o de alto riesgo. | Booking, pagos, confirmaciones, aprobaciones, cancelaciones y operaciones reguladas tendrán estado, transiciones, recuperación e idempotencia explícitos. Descubrimiento, FAQs y calificación seguirán guiados por LLM con tools efectivas. Agent Test mostrará plan, estado, tools faltantes y motivo de bloqueo. | No construir un FSM universal. Cada nuevo workflow determinista requiere contrato de estados, expiración, reanudación, handoff, rollback y evals. El LLM nunca será autoridad de commit. |
| P30 | Unificar Channel Manager con el registro común de **freshness/health/telemetría**; `syncInterval` tenant queda como configuración de frecuencia, no como segundo reloj semántico. | Una misma evaluación publicará provider, recurso/binding, último intento, último éxito, `asOf`, SLA, freshness, health y degraded reason para runtime, UI, alertas y auditoría. | Migración compatible y shadow comparison obligatorias. No se reactivan writers por health degradado; ownership y freshness son dimensiones separadas. |
| P31 | Exigir **binding por recurso/propiedad/sede/agenda** antes de certificar operación mixta. Sin mapping suficiente se mantiene desplazamiento conservador tenant-wide/fail-closed. | Cada capability resolverá ownership por objeto; lectura, escritura, caché, reconciliación y UI mostrarán el mismo binding. Un recurso externo nunca caerá a writer nativo durante una caída del proveedor. | Se requiere taxonomía y mapping por provider, validación de duplicados, tombstones, remapeo, caché generacional, reconciliación y rollback. Desplazar de más es aceptable temporalmente; escribir en dos SoR no. |
| P32 | Mindbody solo puede prometer **disponibilidad** después de una consulta live/hold autorizado. El espejo con `asOf` sirve para descubrimiento informativo, no para confirmar cupo. | Si no existe consulta live, el agente comunica que la clase aparece programada y ofrece verificar/escalar; no dice “hay cupo”. Reserva y cancelación permanecen fail-closed sin adapter certificado y reconciliación. | Requiere sandbox/cuenta real, versión API, rate limits, paginación, waitlist, hold/booking, idempotencia, freshness, fallos y piloto. El marketing no usará “disponibilidad en tiempo real” hasta demostrarlo. |

## Política de locales y mercados

| ID | Tema | Decisión requerida | Estado |
|---|---|---|---|
| P33 | Estados Unidos y Canadá | Elegir países/locales objetivo, idiomas, fallback, formatos y claims comerciales. | **Aprobada — 24-08-2026** |
| P34 | Países reconocidos pero no comercializados | Mantener reconocimiento técnico sin claim, activar mercados priorizados o retirar cobertura aparente. | **Aprobada — 24-08-2026** |

### Resolución P33 — Estados Unidos y Canadá

**Opción aprobada:** crear packs separados y explícitos, inicialmente en estado `draft/pilot`, sin usar un paquete genérico de Norteamérica.

- Estados Unidos: `en-US` primario y `es-US` como experiencia conversacional soportada; USD, zona horaria y estado/ZIP explícitos. El país del tenant manda sobre idioma o prefijo telefónico.
- Canadá: `en-CA` y `fr-CA`; CAD, provincia/código postal y zona horaria explícitos. La generación debe respetar la preferencia lingüística y no convertir el francés genérico en validación legal de Quebec.
- Fechas potencialmente ambiguas se confirmarán con mes en palabras o formato inequívoco, además de zona horaria cuando afecte una operación. Teléfonos se normalizan a E.164 sin fusionar identidades solo por el prefijo `+1`.
- Reconocimiento y generación se separan: el agente puede entender variantes frecuentes, pero usa términos preferidos del pack y evita imitar estereotipos, acentos o slang no configurado.
- Ningún claim regulado, fiscal, sanitario, financiero, asegurador o de privacidad se hereda desde LatAm. Cada sector necesita revisión por país/provincia/estado cuando aplique.

**Gate de promoción:** corpus y hablantes nativos; revisión legal/sectorial; formatos, direcciones, consentimiento, opt-out y accesibilidad; PSP/proveedor soportado; evals por idioma y tenant piloto. Hasta entonces el claim será `preview/pilot`, no cobertura certificada.

### Resolución P34 — países reconocidos pero no comercializados

**Opción aprobada:** conservar reconocimiento técnico de códigos de país para compatibilidad, pero separar cuatro estados de disponibilidad: `recognized`, `preview`, `pilot` y `certified`.

- `recognized`: acepta y conserva datos del país, pero no aparece como mercado comercial certificado; usa idioma genérico soportado y formatos explícitos configurados por el tenant.
- `preview`: onboarding asistido y capacidades no reguladas limitadas, con advertencia visible y tools de país fail-closed.
- `pilot`: pack cultural revisado, proveedores básicos y tenants controlados, todavía sin claim general.
- `certified`: revisión cultural/sectorial, pagos/proveedores, evals, soporte, documentación y sign-off completos.
- La web pública, onboarding, selector, prompts, agentes y runtime leerán el mismo estado. Reconocer un número, moneda o código ISO no habilita fiscalidad, pagos, consejo regulado ni frases locales.
- El fallback será neutral y explícito: idioma soportado, moneda/zona/fecha/dirección configuradas, sin inferir consentimiento ni usar modismos de otro país.

**Gate de promoción:** owner de mercado, pack versionado, hablante/corpus, revisión legal por vertical, proveedor/PSP, soporte operativo, evals y piloto. Si falta, se mantiene reconocimiento técnico sin promesa comercial.

## Próximo gate

Las decisiones del dueño están cerradas. El siguiente bloque no es otra preferencia de producto: consiste en obtener y registrar las aprobaciones expertas, culturales, de proveedor y piloto enumeradas en la sección final.

## Cola restante después de la toma de decisiones

| Bloque | Cantidad/alcance | Estado | Evidencia de cierre |
|---|---:|---|---|
| Revisión regulatoria/de dominio | 21 `expert_gate` | Pendiente externo | Policy y eval versionados, firmados por especialista y asesor de jurisdicción cuando aplique. |
| Terminología 1:1 | 60 perfiles con herencia de industria | Pendiente externo | Glosario por subtipo/idioma, términos preferidos/prohibidos, variables y templates revisados por experto. |
| Packs de país | 15 packs `draft`, más US/CA aprobados aquí | Pendiente externo | Corpus/hablante nativo, normalizadores, formatos, consentimiento, evals y promoción formal a `pilot/certified`. |
| Taxonomías aprobadas | Event Planning, Promotora, Construcción, Pagos y recaudos, Marketplace y Soporte TI/MSP | Pendiente de plan/código | Slugs/nombres i18n, aliases, conteo canónico, contratos, manifests, migración dry-run, backup y rollback. |
| Proveedores/Core | Hostaway, Toast, Mindbody, Cliniko y PMS/DMS/PAS/core/ITSM/PSP aplicables | Pendiente externo | Credenciales sandbox, versión API, mapping, health/freshness, idempotencia, reconciliación, fallos y certificación. |
| Pilotos | 3–5 tenants por perfil priorizado | Pendiente externo | E2E con DB/Redis/canal/modelo/proveedor reales, métricas, canary, rollback y sign-off de producto, dominio, seguridad y operaciones. |

### Regla para el plan de implementación

El plan siguiente deberá convertir cada resolución P01–P34 en cambios trazables de taxonomía, contratos compartidos, prompts, variables, templates, términos, tools, SoR, navegación, permisos, i18n, migraciones, telemetría y pruebas. Ningún perfil pasará de `stop`, `legacy`, `draft` o `pilot` por la sola existencia de esta acta: la disponibilidad se cambia únicamente cuando su gate técnico y externo esté demostrado.

La conversión quedó documentada en el [plan definitivo de implementación vertical](./vertical-approved-implementation-plan-2026-08-24.md), que es la autoridad vigente para fases, paquetes, dependencias, gates, migraciones, pilotos y Definition of Done.
