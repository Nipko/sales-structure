# Auditoría integral de las 18 verticales — agosto de 2026

**Sistema:** Parallly / Parallext Engine  
**Corte:** 6 de agosto de 2026  
**Código auditado:** `1af29db5607581e8fe5e52e57ba757f7e5dd631f`  
**Alcance oficial:** 18 verticales, 75 subtipos canónicos y el caso genérico `otro` (76 configuraciones)  
**Documento de pruebas asociado:** [`vertical-master-test-plan-2026-08.md`](./vertical-master-test-plan-2026-08.md)

> **Documento baseline, no estado actual:** el veredicto, la madurez, los P0/P1, los hallazgos de IA y la evidencia de este archivo describen el commit auditado del 6 de agosto. La fuente vigente del worktree es [`vertical-waves-execution-2026-08.md`](./vertical-waves-execution-2026-08.md); el detalle de contención está en [`wave-0-execution-2026-08.md`](./wave-0-execution-2026-08.md). Conservar estas tablas permite medir el cambio, pero no deben citarse como defectos aún abiertos sin reconciliarlas contra el consolidado.

## 1. Veredicto ejecutivo

El producto sí contiene **18 verticales canónicas**: 17 especializadas y `otro`. La fuente de verdad actual es `VERTICAL_REGISTRY` en `apps/api/src/modules/verticals/vertical-definitions.ts:1291-1309`.

Sin embargo, **ninguna de las 18 puede declararse completa, competitiva y certificada de punta a punta todavía**. Esto no significa que todas estén verdes: seis tienen una base de dominio avanzada, ocho tienen una base intermedia útil y cuatro son todavía presets horizontales con poca profundidad operacional. La falta de certificación se debe a fallos transversales que pueden invalidar incluso una vertical estructuralmente madura:

1. Endpoints verticales sin aislamiento de tenant.
2. Un `Agent Test` que se anuncia como no persistente, pero puede ejecutar escrituras reales.
3. Colisiones entre subtipos de industrias distintas.
4. Bootstrap no transaccional, sin estado de completitud y que deja planes sobre cuota desde el alta.
5. Semántica incorrecta de etapas terminales: el CRM puede marcar como perdida cualquier etapa final cuyo slug no sea literalmente `ganado`.
6. Catálogos paralelos y contradictorios en API, onboarding, dashboard, automatizaciones y landing.
7. Cero pruebas automatizadas específicas de verticales.

La plataforma horizontal, en cambio, es una base competitiva: identidad omnicanal, CRM propio, RAG, catálogo, políticas, booking determinista, handoff, colas, idempotencia, rate limits, multiagente, cuatro idiomas y aislamiento por schema. La brecha contra los líderes verticales no se resuelve principalmente con más prompts. Se resuelve conectando la conversación con **datos operativos vivos y acciones seguras**: PMS, POS, DMS, PIMS, SIS/LMS, FSM, EHR/PMS, sistemas de pólizas, pagos y contratos.

La posición recomendada es:

> **Parallly como capa conversacional de ventas, servicio y automatización sobre los sistemas operativos verticales, con CRM ligero propio cuando el cliente no tiene otro sistema.**

No se recomienda intentar reemplazar completamente un EHR, PMS, POS, DMS, SIS, FSM o PSA. La ventaja defendible está en la orquestación omnicanal, multilingüe y con IA sobre esos sistemas.

## 2. Qué significa “completa” y “competitiva”

Una vertical solo debe recibir la etiqueta **certificada** cuando demuestre estas diez capacidades de extremo a extremo:

1. Entiende y clasifica correctamente el caso.
2. Recupera datos vivos, con fuente y fecha de actualización.
3. Ejecuta la acción principal del negocio con permisos mínimos.
4. Maneja errores, no disponibilidad, concurrencia y cancelaciones.
5. Escala a humano con resumen, fuentes y acciones pendientes.
6. Persiste el resultado en el objeto de dominio correcto.
7. Registra consentimiento, identidad, aprobación y auditoría cuando aplican.
8. Mide el resultado comercial u operativo, no solo mensajes y tokens.
9. Se comporta correctamente en `es`, `en`, `pt` y `fr`.
10. Se abstiene de inventar cuando faltan datos, autorización o certeza.

La puntuación de este documento es **madurez estructural estática**, no una certificación de producción:

- **4–5:** dominio avanzado en código; todavía requiere cerrar hallazgos transversales y superar pruebas.
- **3–3.5:** vertical intermedia, útil pero incompleta frente al referente de industria.
- **2–2.5:** preset horizontal o dominio muy superficial.
- **Certificada:** solo después del plan de pruebas; hoy el conteo es **0/18**.

## 3. Método y límites de la auditoría

Se revisaron:

- Registro, definiciones localizadas, pipelines, FAQs, servicios y personas.
- Onboarding, bootstrap, cambio de industria, reseed y alta desde superadministración.
- Registro de tools, schemas, executor, prompt, booking, contexto por turno y Agent Test.
- Objetos y páginas de dashboard, checklist, tours guiados, KPIs y analítica.
- CRM, etapas terminales, automatizaciones, cuotas, permisos, multitenancy e integraciones.
- Landing y coherencia entre promesa comercial y capacidad real.
- Documentos históricos de julio, revalidados contra el código del corte.
- Benchmark competitivo actualizado con fuentes oficiales de producto y fuentes regulatorias primarias.

Limitaciones:

- No se usaron credenciales reales de Meta, Telegram, Twilio, Toast, Mindbody, Cliniko, calendarios, Mercado Pago ni sistemas verticales externos.
- No se certificó comportamiento en un ambiente productivo ni calidad de datos de tenants reales.
- Las puntuaciones no sustituyen pruebas E2E ni revisión jurídica por país.
- Los documentos de julio son material histórico útil, pero no son fuente de verdad del estado actual.

## 4. Inventario canónico y madurez actual

| # | Vertical | Subtipos | Seed inicial | Capacidad de dominio actual | Madurez | Brecha decisiva |
|---:|---|---:|---|---|---:|---|
| 1 | `salud` | 5 | 6 etapas, 5 FAQs, 3 servicios | Citas; tratamientos para subtipos seleccionados; Cliniko beta | 3.5/5 | Profundidad clínica no dental, consentimiento, PIMS/EHR y seguridad de datos |
| 2 | `moda_belleza` | 4 | 5 etapas, 5 FAQs, 3 servicios | Citas y tratamientos para spa/estética | 3/5 | Recursos/cabinas, staff, paquetes, créditos, POS y comisiones |
| 3 | `inmobiliaria` | 4 | 7 etapas, 5 FAQs, 3 servicios | Listings, búsqueda, medios, CRM y citas | 4/5 | Feed vivo, geografía, favoritos, alertas, routing y transaction milestones |
| 4 | `restaurantes` | 4 | 5 etapas, 5 FAQs, 3 servicios | Menú, promociones, pedidos, reservas; Toast beta | 4/5 | POS/KDS vivo, modificadores, stock 86, alergias, mesas/pacing y delivery |
| 5 | `automotriz` | 4 | 7 etapas, 5 FAQs, 3 servicios | Vehículos, test drives y citas | 4/5 | DMS, trade-in, órdenes de reparación, posventa y ruta de búsqueda |
| 6 | `turismo` | 4 | 6 etapas, 5 FAQs, 3 servicios | Tours o propiedades por subtipo, reservas e iCal | 4/5 | PMS/channel manager, UI por subtipo, moneda/tasas y semántica de noches |
| 7 | `education` | 4 | 6 etapas, 5 FAQs, 3 servicios | Cursos, cohortes, matrículas y placement test | 4/5 | SIS/LMS, documentos, estado de aplicación, menores y contexto activo |
| 8 | `finanzas` | 3 | 6 etapas, 6 FAQs, 1 servicio | Citas, CRM, FAQs y RAG | 2/5 | Sin productos, simulación, elegibilidad, KYC/AML ni toolset propio |
| 9 | `servicios_profesionales` | 4 | 6 etapas, 5 FAQs, 2 servicios base | Citas y estado de oportunidad como “caso” | 2.5/5 | Intake, conflicto, expediente/proyecto, documentos, contrato y facturación |
| 10 | `retail` | 4 | 6 etapas, 5 FAQs, 0 servicios | Catálogo, stock, ofertas y órdenes | 3.5/5 | Checkout/payment link, variantes, shipping, devoluciones, loyalty y analítica |
| 11 | `technology` | 4 | 7 etapas, 6 FAQs, 1 servicio | B2B genérico: citas, CRM, FAQ/RAG | 2/5 | Sin tickets, entitlement, SLA, status, telemetría ni toolset tecnológico |
| 12 | `veterinaria` | 4 | 6 etapas, 5 FAQs, 4 servicios | Mascotas, vacunas, triage y citas | 3.5/5 | Hospital 24h roto, PIMS, refill, consentimientos y resultados liberados |
| 13 | `gimnasios` | 5 | 6 etapas, 5 FAQs, 2 servicios | Membresías, clases, cupos, freeze; Mindbody beta | 4/5 | Cobro recurrente, créditos, acceso, waiver, churn y etapa ganada |
| 14 | `seguros` | 5 | 7 etapas, 5 FAQs, 0 servicios | Planes, cotización, pólizas, claims y OTP parcial | 3.5/5 | Productos versionados, carrier integration, FNOL seguro, firma y permisos |
| 15 | `servicios_hogar` | 7 | 6 etapas, 5 FAQs, 0 servicios | Solicitudes, estado y cancelación | 3.5/5 | Dispatch, ETA, work order, cotización, partes, staff y agenda coherente |
| 16 | `pet_services` | 5 | 6 etapas, 5 FAQs, 3 servicios | Mascotas, grooming/daycare y citas genéricas | 3.5/5 | `hotel` roto, noches/capacidad, vacunas, membresías, créditos y tareas |
| 17 | `fotografia` | 5 | 6 etapas, 5 FAQs, 3 servicios | Paquetes, portfolio, cotización, sesiones y citas | 3.5/5 | Hold, propuesta, contrato, depósito, galería, hitos y terminales coherentes |
| 18 | `otro` | 0 | 6 etapas, 5 FAQs, 0 servicios | Catálogo, CRM y conocimiento genérico | 2.5/5 | Debe evolucionar a constructor declarativo, no quedarse como plantilla vacía |

Totales:

- **6 avanzadas:** inmobiliaria, restaurantes, automotriz, turismo, education y gimnasios.
- **8 intermedias:** salud, moda/belleza, retail, veterinaria, seguros, servicios hogar, pet services y fotografía.
- **4 básicas/preset:** finanzas, servicios profesionales, technology y otro.
- **0 certificadas E2E.**

## 5. Trazabilidad real UI → API → DB → IA

```text
Onboarding dashboard
  -> POST /auth/complete-onboarding
  -> AuthService.completeOnboarding
  -> tenant global + usuario + schema tenant
  -> agente inicial + BusinessInfo
  -> VerticalsService.bootstrapVertical
       -> etapas + FAQs + servicios + disponibilidad
       -> flags de tools en agent_personas
       -> settings.verticalConfig
       -> invalidación de caches Redis

Runtime conversacional
  -> ConversationsService
       -> identidad unificada + persona por canal
       -> business/vertical/booking/memoria/RAG
       -> PromptAssembler: contrato + persona + turn XML
       -> registro de tools según flags/conexiones
       -> LLM -> AIToolExecutor -> schema tenant / integración
       -> OutboundQueue -> canal
       -> handoff -> consola humana

Dashboard
  -> GET /verticals/:tenantId
  -> AuthContext/useVerticalTerms
  -> sidebar, setup, KPIs, CRUDs y analítica vertical
```

Puntos fuertes confirmados:

- Las 18 definiciones contienen estructura localizada en `es/en/pt/fr`.
- Los slugs de etapas son únicos dentro de cada vertical y existe al menos una etapa terminal.
- Se identificaron **90 definiciones estáticas de tools y 90 casos estáticos en el executor**: no hay una tool estática registrada sin handler por simple nombre.
- La producción registra familias para citas, catálogo, conocimiento, CRM, ecommerce y once dominios verticales, además de Toast/Mindbody/Cliniko y MCP.
- El prompt separa contrato, persona y contexto del turno; RAG y resultados de tools están declarados como datos no confiables.
- Booking, mutex, colas, idempotencia, handoff y throttling constituyen una base horizontal fuerte.

Lo anterior demuestra construcción, pero no corrección semántica. Un handler existente puede seguir fallando por identidad, permisos, concurrencia, datos incompletos o modelo de dominio insuficiente.

### 5.1 Inventario de tools estáticas

| Familia | Cant. | Tools | Vertical/capability |
|---|---:|---|---|
| Appointments | 8 | `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details` | Agenda genérica de subtipos compatibles |
| Catalog/offers | 5 | `search_products`, `get_product`, `check_stock`, `send_product_image`, `list_active_offers` | Retail, farmacia, otro y agentes con catálogo |
| Knowledge | 3 | `search_faqs`, `get_policy`, `search_knowledge_base` | Transversal |
| CRM/context | 2 | `list_customer_orders`, `get_customer_context` | Transversal según persona |
| Ecommerce | 3 | `recommend_products`, `get_order_status`, `apply_discount` | Disponible por flag; no forma parte del Agent Test actual |
| Vacation rental | 8 | `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image` | Turismo hotel/alquiler |
| Tours | 6 | `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`, `cancel_tour_booking`, `list_my_tour_bookings` | Turismo tours/agencia |
| Treatments | 2 | `get_treatment_plan`, `list_upcoming_sessions` | Salud y belleza según subtipo |
| Listings | 3 | `search_listings`, `get_listing_details`, `send_listing_image` | Inmobiliaria |
| Vehicles | 3 | `search_vehicles`, `get_vehicle_details`, `send_vehicle_image` | Automotriz |
| Pets | 5 | `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet` | Veterinaria y pet services |
| Restaurants | 6 | `get_menu`, `get_promotions`, `place_order`, `cancel_order`, `check_order_status`, `list_my_orders` | Restaurantes |
| Gyms | 6 | `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `cancel_class_booking` | Gimnasios |
| Education | 6 | `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments` | Education |
| Insurance | 8 | `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`, `request_identity_code`, `verify_identity_code` | Seguros |
| Home services | 4 | `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request` | Servicios hogar |
| Pet services | 2 | `list_pet_services`, `check_daycare_availability` | Pet services |
| Photography | 5 | `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session` | Fotografía |
| Professional services | 1 | `get_case_status` | Servicios profesionales; ausente del Agent Test |
| Vertical integrations | 4 | `get_restaurant_menu`, `get_fitness_schedule`, `list_clinic_services`, `check_clinic_availability` | Toast, Mindbody y Cliniko beta |
| **Total** | **90** | Definición estática y handler por nombre presentes | No equivale a certificación funcional |

Además pueden descubrirse tools MCP dinámicas. Estas no pueden validarse por conteo estático y requieren contrato, namespace, permisos, timeout y sandbox por servidor.

## 6. Hallazgos priorizados y backlog de corrección

### 6.1 P0 — Bloquean una certificación segura

| ID | Hallazgo | Evidencia principal | Impacto | Criterio de cierre |
|---|---|---|---|---|
| VERT-P0-01 | `VerticalsController` no usa `TenantGuard` | `verticals.controller.ts:10-55` | Lectura cruzada y reseed de otro tenant por IDOR | Todas las rutas con tenant validan UUID, rol y pertenencia; pruebas negativas para 4 roles |
| VERT-P0-02 | Agent Test normal puede ejecutar tools reales | `agent-test.controller.ts:14-28`; `agent-test.service.ts:135-231` | Creación/cancelación de datos productivos desde una función “no persistente” | Dry-run obligatorio, schema sandbox o transacción reversible; cero writes verificadas |
| VERT-P0-03 | Colisión global de subtipos | `verticals.service.ts:43-110,160` | `pet_services/hotel` hereda `skipAgenda` de turismo y nace sin servicios/slots | Resolución por `(industry, subtype)` y contrato de las 76 combinaciones |
| VERT-P0-04 | `hospital_24h` genera cero slots | `verticals.service.ts:686-764` | Veterinaria 24/7 queda sin booking | Un solo estándar de días; 7 días y slots comprobados en DB |
| VERT-P0-05 | Bootstrap ignora cuotas del plan | `verticals.service.ts:125-324,437-667`; `seed-billing-plans.js:63-71,166-174` | El tenant nace sobre cuota y luego no puede administrar recursos | Política explícita para defaults vs cuota; ningún plan queda inválido después del alta |
| VERT-P0-06 | Bootstrap y schema no son transaccionales/verificables | `verticals.service.ts:443-764`; `prisma.service.ts:81-137`; `auth.service.ts:1676-1734` | Estados parciales reportados como éxito y reintentos que no reparan | Estado versionado `pending/complete/failed`, compensación/reanudación e invariantes post-bootstrap |
| VERT-P0-07 | Slugs terminales verticales se marcan como perdidos | `pipeline.service.ts:973-1070` | Revenue, forecasting y conversión incorrectos para las 18 | Terminal tiene outcome explícito `won/lost`; métricas leen outcome, no aliases de texto |
| VERT-P0-08 | XML dinámico del system prompt no se escapa de forma uniforme | `prompt-assembler.service.ts:110-201,258-274` | Nombre/contacto/config puede romper XML e inyectar etiquetas de sistema | Escape único para texto y atributos; fuzzing de todos los campos dinámicos |
| VERT-P0-09 | Integraciones verticales permiten URLs controladas por tenant | `vertical-integrations.service.ts:59-124,283-299,361-394` | SSRF a localhost, red privada o metadata cloud | HTTPS, allowlist oficial, bloqueo IP privada/redirect/DNS rebinding, timeout y límites |
| VERT-P0-10 | Riesgo de herencia de datos al reutilizar schema | `offboarding.service.ts:916-979`; `prisma.service.ts:224-270` | Si el drop falla y se reutiliza slug, un tenant nuevo puede heredar tablas no limpiadas | No eliminar registro hasta verificar drop; schema nuevo no reutilizable; prueba de fallo inyectado |
| VERT-P0-11 | Alta superadmin usa catálogo/planes obsoletos y no hace bootstrap | `CreateTenantModal.tsx:61-86`; `EditTenantModal.tsx:57-81`; `tenants.service.ts:28-79` | Tenants con slugs inválidos, plan `professional`, sin agente ni vertical | Usar manifest canónico, planes reales y el mismo provisioning idempotente del onboarding |
| VERT-P0-12 | Onboarding acepta `any` y fallback silencioso | `auth.controller.ts:540-546`; `auth.service.ts:1527-1734`; `vertical-definitions.ts:1312-1313` | Industria/subtipo inválido persiste mientras config cae a `otro` | DTO validado contra manifest; error explícito; normalización versionada de aliases |

### 6.2 P1 — Bloquean completitud y competitividad

| ID | Hallazgo | Impacto / corrección necesaria |
|---|---|---|
| VERT-P1-01 | No existe un manifest único para IDs, aliases, subtipos, tools, objetos, rutas, KPIs, planes y seguridad | Crear `VerticalCapabilityManifest` compartido y versionado; generar o consumir sus derivados en API, dashboard y landing |
| VERT-P1-02 | Onboarding contradice al registro | Corregir `pet_services`, `servicios_hogar` y `fotografia`; eliminar duplicación de `SUB_TYPES` |
| VERT-P1-03 | `finanzas/seguros` normaliza industria pero conserva subtipo inválido | Migrar a `seguros/broker` o pedir una selección válida; no guardar combinaciones imposibles |
| VERT-P1-04 | Agent Test no es paritario | Compartir constructor de tools/contexto con producción; incluir professional services, ecommerce, integraciones, MCP y Booking Engine en modo seguro |
| VERT-P1-05 | Agentes creados después del onboarding no heredan capacidades verticales | Resolver tools desde manifest por agente/vertical/subtipo, no solo mediante parche al agente inicial |
| VERT-P1-06 | Widget web usa un pipeline reducido | Enrutar widget por el mismo orquestador: identidad, vertical, RAG, tools, booking, memoria, business hours y handoff |
| VERT-P1-07 | Contexto de operaciones activas es incompleto | Incluir clases, matrículas, food orders, sesiones de foto, service requests, claims/casos y otras operaciones relevantes |
| VERT-P1-08 | Cambio de industria crea un tenant híbrido | Diseñar migración con preview, archivado/mapeo de datos, reseed, herramientas, persona y rollback; o bloquear cambio directo |
| VERT-P1-09 | Reseed solo repara FAQs y servicios | Convertirlo en reconciliador versionado de etapas, persona, tools, disponibilidad, contenidos e invariantes |
| VERT-P1-10 | `bookingEnabled` no refleja el subtipo ni la capacidad efectiva | Derivar capabilities resueltas: appointment, nightly booking, class, order, work order, project, membership, case |
| VERT-P1-11 | Readiness y navegación no son subtype-aware | Turismo, farmacia, dark kitchen, pet hotel y demás deben ver la ruta/objeto correcto; un solo resolver para sidebar, wizard, checklist y tours |
| VERT-P1-12 | Ocho verticales carecen de analítica específica | Añadir beauty, automotive, finance, professional services, retail, technology, pet services y other; validar semántica, no solo valores no nulos |
| VERT-P1-13 | Triggers y plantillas de automatización no coinciden con eventos/slugs | Contrato compilable UI↔backend; corregir `educacion/restaurante`; validar cuotas también al instalar/activar templates |
| VERT-P1-14 | Objetivos del onboarding se ignoran cuando existe una plantilla vertical | Resolver persona por `(vertical, subtype, goals)`; ventas, soporte, posventa y reservas deben producir agentes distintos |
| VERT-P1-15 | Reglas del prompt fuerzan cita/idioma incorrecto | Pitch solo si capability y contexto lo permiten; confirmaciones, incertidumbre y refusals en `<turn><language>` |
| VERT-P1-16 | Seguridad de identidad no es uniforme | Aplicar assurance levels a pólizas, claims, casos, pagos y PII; OTP/step-up antes de datos o acciones sensibles |
| VERT-P1-17 | Staff/resources no tiene administración completa | CRUD, habilidades, recursos, capacidad, sedes, horarios y asignación visibles; degradación explícita por plan |
| VERT-P1-18 | Pagos no están conectados a las acciones verticales | Payment link, depósito, cuotas, reembolso y conciliación como tools aprobables e idempotentes |
| VERT-P1-19 | Integraciones “conectadas” se infieren por credenciales | Health check, scopes, última sincronización, frescura, degradación y circuito abierto antes de registrar la tool |
| VERT-P1-20 | Promesa comercial contradice el runtime | Revisar demos y claims de landing; nunca inventar vacunas, precios, ETA, tickets, opciones o asesoría financiera |
| VERT-P1-21 | Ruta `/vehicles/:tenantId/search` puede ser interceptada por `:vehicleId` | Declarar estática antes de dinámica o usar rutas inequívocas; agregar test HTTP |
| VERT-P1-22 | Moneda inicial fija en COP | Resolver moneda por tenant/país; marcar precios seed como ejemplos editables o no sembrar montos sin confirmación |
| VERT-P1-23 | Paquete turístico de fin de semana tiene duración `0` | Modelar noches/rango de fechas; una cita de fallback de 30 minutos no representa un paquete |

### 6.3 P2 — Diferenciación y evolución

1. Transformar `otro` en un constructor declarativo de objetos, relaciones, pipelines, SLA, tools, restricciones y KPIs.
2. Añadir next-best-action explicable y siempre condicionado por stock, capacidad, elegibilidad y políticas reales.
3. Handoff con resumen estructurado, fuentes, confianza y acciones pendientes.
4. Voice/multimodal para industrias donde audio, imágenes o documentos son parte del intake.
5. Analítica por outcome: reserva, venta, inscripción, renovación, resolución, no-show, churn y margen.
6. Data lineage por resultado de tool: fuente, fetched-at, expires-at y política ante dato vencido.
7. Evaluaciones continuas de IA por vertical, subtipo, idioma y versión de prompt/modelo.
8. Localización monetaria, regulatoria y de formatos, además de traducción lingüística.

### 6.4 Mapa de evidencia de los P1

| ID | Evidencia principal en código |
|---|---|
| VERT-P1-01 | `vertical-definitions.ts:1291-1313`; `onboarding/page.tsx:43-180`; `apps/landing/src/data/verticals.ts` |
| VERT-P1-02 | `onboarding/page.tsx:68-180`; `verticals.controller.ts:54-63`; `vertical-definitions.ts:752-1285` |
| VERT-P1-03 | `auth.service.ts:1581-1589,1719-1728` |
| VERT-P1-04 | `agent-test.service.ts:128-175`; `conversations.service.ts:1847-1941` |
| VERT-P1-05 | `persona.service.ts:640-736,2603-2626,2736-2883` |
| VERT-P1-06 | `conversations.service.ts:2810-2990` |
| VERT-P1-07 | `conversations.service.ts:1509-1581` |
| VERT-P1-08 | `tenants.service.ts:241-298` |
| VERT-P1-09 | `verticals.service.ts:348-380` |
| VERT-P1-10 | `verticals.service.ts:43-110,153-169,300-310` |
| VERT-P1-11 | `vertical-catalog.util.ts:25-44`; `ToolsTour.tsx:26-92`; `ProductTour.tsx:23-37`; `AppSidebar.tsx:124-148`; `OnboardingChecklist.tsx:54-63` |
| VERT-P1-12 | `vertical-analytics.service.ts:164-194,242-509` |
| VERT-P1-13 | `automation-listener.service.ts:29-104`; `automation/templates/automation-templates.service.ts:37-87`; `dashboard/.../automation/page.tsx:44-51` |
| VERT-P1-14 | `persona.service.ts:2736-2844` |
| VERT-P1-15 | `prompt-assembler.service.ts:67-99` |
| VERT-P1-16 | `insurance-tools.ts`; `tier3-tools.ts`; handlers correspondientes en `ai-tool-executor.service.ts` |
| VERT-P1-17 | `dashboard/src/lib/api.ts:792-803`; `dashboard/.../service-requests/page.tsx:201-297` |
| VERT-P1-18 | `apps/api/src/modules/tenant-payments/`; ausencia de payment tools en `conversations/tools/` |
| VERT-P1-19 | `vertical-integrations.service.ts:59-124,283-299,361-394`; `conversations.service.ts:1881-1900` |
| VERT-P1-20 | `apps/landing/src/data/verticals.ts:62,139,156,201,248,278`; `apps/landing/messages/en.json:679` |
| VERT-P1-21 | `vehicle-inventory.controller.ts:53,131` |
| VERT-P1-22 | Servicios/precios en `vertical-definitions.ts` y overrides de `verticals.service.ts:75-108` |
| VERT-P1-23 | `vertical-definitions.ts:461` |

## 7. Hallazgos de IA y armonía con la plataforma

### Lo que está bien orientado

- El backend controla el flujo y la IA actúa como voz, especialmente en booking determinista.
- El prompt en tres capas evita mezclar configuración del usuario con instrucciones globales.
- RAG, FAQ, políticas, catálogo y business identity tienen responsabilidades distintas.
- La IA recibe lenguaje, zona horaria, negocio, contacto, memoria, reservas y conocimiento recuperado.
- En el baseline se identificaron 90 tools estáticas; el contrato operativo vigente contiene 92/92 registradas, con controles centrales completos para el registry estático.
- La regla de no inventar disponibilidad, precio o política está alineada con el producto.

### Lo que debe corregirse

- Escapar todos los campos XML, no solo RAG y algunos atributos.
- Tratar todo dato de `<turn>` como no confiable, no solamente RAG/tool results.
- Eliminar frases fijas en español o inglés dentro del contrato universal.
- No forzar un pitch de cita cuando la vertical/subtipo no agenda o cuando el usuario solo hace small talk.
- Unificar production, Agent Test, widget y simulaciones sobre el mismo pipeline configurable.
- Separar tools de lectura, escritura, sensibles y destructivas; aplicar confirmación y assurance level.
- Incorporar contexto activo de todos los objetos verticales.
- Guardar tool call, argumento redactado, resultado, duración, error, retry, fuente y frescura.
- Asegurar que tras handoff la IA deje de actuar y el humano reciba contexto completo.

### Modelo de autonomía recomendado

| Nivel | Tipo de acción | Regla |
|---|---|---|
| A0 | Responder con conocimiento público | Automático con fuente y abstención |
| A1 | Lectura de datos del propio contacto | Identidad de canal suficiente si no es sensible |
| A2 | Crear/cambiar cita, clase, pedido o solicitud | Confirmación explícita del cliente e idempotencia |
| A3 | Póliza, claim, caso profesional, PII, pago o firma | Step-up/OTP y auditoría |
| A4 | Reembolso, descuento alto, decisión clínica/financiera/legal o acción irreversible | Aprobación humana obligatoria |

## 8. Revisión competitiva transversal

Los referentes horizontales actuales ya combinan conocimiento, acciones y pruebas:

- [Respond.io AI Agents](https://respond.io/ai-agents), sus [fuentes de conocimiento](https://respond.io/help/ai-agents/managing-ai-knowledge-sources) y su [entorno de pruebas](https://respond.io/help/ai-agents/how-to-test-ai-agents).
- [HubSpot Customer Agent](https://knowledge.hubspot.com/customer-agent/set-up-the-customer-agent).
- [Intercom Fin](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained) y sus [data connectors/actions](https://www.intercom.com/help/en/articles/6298285-using-data-connectors-for-automation).
- [Kommo para WhatsApp](https://www.kommo.com/whatsapp/).
- [Zoho CRM/Zia](https://www.zoho.com/crm/ai-features-in-zoho-crm.html).
- [Shopify Inbox](https://apps.shopify.com/inbox).

Objetivos internos de paridad horizontal:

1. Datos vivos con procedencia y frescura.
2. Acciones tipadas, idempotentes y con permisos mínimos.
3. Separación read/write/sensitive y confirmaciones.
4. Pruebas seguras con perfiles, idiomas, documentos, imágenes y audio.
5. Handoff que detiene la IA y entrega contexto.
6. Outcome analytics y continuidad omnicanal.
7. Consentimiento, opt-out, retención y auditoría.
8. Observabilidad de tool calls, abstenciones, errores y reintentos.

Estos ocho puntos son el contrato objetivo de Parallly, no una afirmación de que cada competidor los implemente todos de forma tipada, idempotente y auditable. Las fuentes oficiales verifican piezas —conocimiento, acciones, pruebas, handoff, fuentes y logs—; la separación universal read/write/sensitive, consentimiento/retención end-to-end y observabilidad completa deben demostrarse con evidencia propia.

## 9. Benchmark y objetivo por vertical

Los objetivos siguientes son **benchmarks compuestos**. En varios dominios combinan dos o más suites y requisitos propios de seguridad; no implican que una sola plataforma ofrezca toda la lista ni que Parallly ya haya alcanzado esa paridad.

### 9.1 Salud

**Referentes:** [NexHealth](https://www.nexhealth.com/), [Tebra Patient Experience](https://www.tebra.com/patient-experience), [Doctoralia Colombia](https://pro.doctoralia.co/producto/agenda-doctoralia-para-especialistas).

**Objetivo de paridad:** agenda conectada al sistema clínico; sedes, especialidades y profesionales; formularios, consentimiento, seguro, depósito, no-show, lista de espera y recall. La IA puede hacer intake administrativo y escalamiento, pero no diagnosticar, prescribir ni revelar resultados no liberados.

### 9.2 Moda y belleza

**Referente:** [Zenoti](https://www.zenoti.com/) y su [matriz de capacidades](https://www.zenoti.com/pricing-zenoti).

**Objetivo de paridad:** servicios por profesional, habilidad, silla/cabina/equipo, duración variable, paquetes, membresías, créditos, depósitos, POS, consumibles, propinas, comisiones, rebooking y win-back.

### 9.3 Inmobiliaria

**Referentes:** [Lofty](https://lofty.com/), [Follow Up Boss](https://www.followupboss.com/), [Structurely](https://www.structurely.com/how-it-works).

**Objetivo de paridad:** inventario vivo, filtros geográficos, perfiles comprador/arrendatario/propietario, favoritos, búsquedas guardadas, alertas, routing, visitas coordinadas, timeline y dedupe cross-channel. No prometer precio, disponibilidad o crédito sin fuente.

### 9.4 Restaurantes

**Referentes:** [SevenRooms](https://sevenrooms.com/restaurants/), [Toast Online Ordering](https://pos.toasttab.com/products/online-ordering).

**Objetivo de paridad:** separar reservas, waitlist, pedidos, catering y eventos; menú/modificadores/alérgenos/stock vivo; POS/KDS, sucursal, mesas, pacing, delivery, ETA, depósitos y loyalty. Dudas de alergia siempre escalan.

### 9.5 Automotriz

**Referentes:** [Tekion](https://tekion.com/products), [Impel](https://impel.ai/blog/impel-ai-certified-by-mitsubishi/), [Podium Auto](https://www.podium.com/t/experience/auto).

**Objetivo de paridad:** inventario por VIN, test drive, agenda de servicio, historial del vehículo, orden de reparación, trade-in, DMS, aprobaciones, pagos y ciclo completo ventas/posventa.

### 9.6 Turismo

**Referentes:** [Cloudbeds](https://www.cloudbeds.com/channel-manager/), [Travefy CRM](https://travefy.com/products/crm), [Rezdy Resources](https://support.rezdy.com/hc/en-us/articles/19867793699612-What-Is-a-Resource-and-How-To-Set-Them-Up).

**Objetivo de paridad:** hotel/alquiler con PMS, noches, rate plans, impuestos, depósitos y channel manager; tours con sesiones, cupos, recursos, waivers y vouchers; agencia con propuestas, itinerarios, proveedores, comisiones y pagos.

### 9.7 Educación

**Referente:** [Element451](https://element451.com/element-admissions-ai-agent-teams) y su [CRM de ciclo estudiantil](https://element451.com/product/enterprise-crm).

**Objetivo de paridad:** prospecto→aplicante→admitido→matriculado; cohortes, requisitos, documentos, eventos, SIS/LMS, nurturing y permisos para menores. No garantizar admisión, beca o equivalencia.

### 9.8 Finanzas

**Referente:** [Salesforce Financial Services Cloud](https://www.salesforce.com/financial-services/cloud/guide/).

**Objetivo de paridad:** productos/tasas/costos versionados, elegibilidad determinista, KYC/AML, solicitudes, disclosures, step-up identity, quejas, auditoría y aprobaciones. Esta vertical necesita un toolset propio antes de venderse como solución profunda.

### 9.9 Servicios profesionales

**Referentes:** [Clio Grow](https://www.clio.com/grow/), [TaxDome](https://taxdome.com/), [Scoro](https://www.scoro.com/).

**Objetivo de paridad:** intake, conflicto, oportunidad, propuesta/SOW, contrato, firma, pago, proyecto/matter, portal documental, hitos, tiempos, capacidad, retainer y rentabilidad. La IA no emite opinión profesional concluyente.

### 9.10 Retail

**Referentes:** [Shopify Inbox](https://apps.shopify.com/inbox), [Shopify Sidekick](https://help.shopify.com/en/manual/ai-powered-tools/sidekick).

**Objetivo de paridad:** variantes, stock y precios vivos; carrito/checkout/payment link; shipping, tracking, devoluciones, loyalty, recovery y atribución de pedidos asistidos por IA. Descuentos/reembolsos requieren autorización.

### 9.11 Tecnología

**Referentes:** [Intercom Fin](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained), [HubSpot Customer Agent](https://knowledge.hubspot.com/customer-agent/set-up-the-customer-agent).

**Objetivo de paridad:** ventas, soporte, onboarding y customer success separados; cuenta/workspace/plan/entitlement, tickets, SLA, estado de servicio, telemetría permitida, procedimientos y redacción de secretos. Necesita toolset propio.

### 9.12 Veterinaria

**Referente:** [PetDesk](https://petdesk.com/veterinary-client-engagement-software).

**Objetivo de paridad:** tutor con múltiples mascotas, PIMS, vacunas/recalls, refill enviado al profesional, estimaciones, depósitos y resultados liberados. La IA no diagnostica ni calcula dosis.

### 9.13 Gimnasios

**Referente:** [Glofox](https://www.glofox.com/business-types/gym-management-software/).

**Objetivo de paridad:** contratos, créditos, cobro recurrente, clases/capacidad/waitlist, freeze/upgrade/cancelación, acceso, waiver, PT, asistencia y churn.

### 9.14 Seguros

**Referentes:** [InsuredMine](https://www.insuredmine.com/), [Salesforce Financial Services](https://www.salesforce.com/financial-services/cloud/service/).

**Objetivo de paridad:** producto/cobertura/exclusión/deducible/prima/vigencia versionados, intake, comparación con fuentes, firma, pólizas, renovaciones, FNOL, claims y routing por licencia. La IA no vincula cobertura ni decide un claim.

### 9.15 Servicios del hogar

**Referente:** [ServiceTitan](https://www.servicetitan.com/features) y su [dispatch inteligente](https://www.servicetitan.com/features/pro/dispatch).

**Objetivo de paridad:** dirección/zona, triage, media, work order, cotización/aprobación, dispatch por skill/ubicación, ETA, partes, inventario, factura, pago, garantía y rework.

### 9.16 Pet services

**Referente:** [MoeGo](https://www.moego.pet/), [boarding/daycare](https://help.moego.pet/en/articles/14085066-how-your-clients-book-boarding-daycare-online) y [membresías](https://help.moego.pet/en/articles/11380526-set-up-membership).

**Objetivo de paridad:** mascota, vacunas, comportamiento, medicación y dieta; boarding por noches, daycare por días, capacidad de kennels, add-ons, paquetes, membresías, créditos, acuerdos y tareas de cuidado. Algunas capacidades de MoeGo —incluidas membresías/créditos en determinados cortes— se documentan como beta o disponibilidad limitada; se usan como dirección competitiva, no como disponibilidad universal.

### 9.17 Fotografía

**Referente:** [HoneyBook para fotógrafos](https://www.honeybook.com/crm/photographers).

**Objetivo de paridad:** inquiry, date hold, propuesta, contrato, depósito/cuotas, cuestionario, shot list, hitos de edición/selección/entrega, portal, galería, copyright y releases.

### 9.18 Otro

**Referentes:** [Kommo](https://www.kommo.com/), [Respond.io](https://respond.io/ai-agents), [Zoho Custom Modules](https://help.zoho.com/portal/en/kb/crm/customize-crm-account/customizing-modules/articles/customize-modules).

**Objetivo recomendado:** convertirlo en “vertical builder”: objetos/relaciones, modo cita/pedido/proyecto/membresía/caso, calificación, pipeline, SLA, tool schema, políticas, KPIs y escenarios de prueba generados. Es una visión de producto propia; las referencias demuestran componentes configurables, no generación completa de tools, políticas, KPIs y pruebas.

## 10. Coherencia comercial y confianza

> **Línea base histórica:** los ejemplos siguientes motivaron el contrato de claims y ya no describen el landing remediado. Consultar su evidencia actual en el informe de Ola 0.

El landing mantiene un catálogo separado de aliases y contiene demos que la plataforma no puede sustentar con datos reales en un tenant nuevo:

- Inmobiliaria afirma tener 12 opciones (`apps/landing/src/data/verticals.ts:62`).
- Seguros presenta planes y precios específicos (`:139`).
- Veterinaria indica vacunas concretas (`:156`), una promesa clínicamente riesgosa.
- Servicios del hogar promete técnico en 35 minutos y rango de precio (`:201`).
- Tecnología promete crear un ticket prioritario y contacto en 15 minutos (`:248`) sin tool de tickets.
- Pet services afirma cupo y `$45k/noche` (`:278`) sin modelo correcto de boarding por noches.
- Inglés todavía dice “16 templates” mientras los demás idiomas dicen 18 (`apps/landing/messages/en.json:679`).

Debe existir un **contrato de promesas** automatizado: cada claim de marketing debe apuntar a una capability certificada o estar marcado explícitamente como ejemplo ficticio. Ninguna demo regulada debe diagnosticar, prometer cobertura, aprobación, disponibilidad o precio sin una fuente real.

## 11. Seguridad y regulación de referencia

Base colombiana para revisión jurídica, no sustituto de asesoría legal:

- [Ley 1581 de 2012](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981): autorización, finalidad, derechos, seguridad, confidencialidad y protección reforzada de menores.
- [Concepto SIC sobre tratamiento de datos e IA](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/regimen-de-tratamiento-de-datos-personales-debe-aplicarse-al-margen-de-los-procedimientos-metodologias-o).
- [Ley 2300 de 2023](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=213990): canales autorizados y horarios de contacto.
- Salud: [Resolución 1995 de 1999](https://www.minsalud.gov.co/normatividad_nuevo/resoluci%C3%93n%201995%20de%201999.pdf) y [Resolución 839 de 2017](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/DIJ/resolucion-839-de-2017.pdf).
- Finanzas: [Ley 1328 de 2009](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=36841).
- Gobernanza: [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework).
- Seguridad de agentes: [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) y [Excessive Agency](https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html).

## 12. Roadmap recomendado

### Ola 0 — Contención y verdad del sistema

Cerrar `VERT-P0-01` a `VERT-P0-12`, congelar claims no verificables y publicar un manifest canónico. No ampliar verticales antes de esta ola.

### Ola 1 — Contratos operativos comunes

Unificar provisioning, Agent Test, widget, tools, contextos activos, outcomes CRM, identidad, pagos, staff/resources, automatización y analítica. Resultado esperado: las 18 pueden superar un smoke test confiable.

### Ola 2 — Certificar las seis más maduras

Inmobiliaria, restaurantes, automotriz, turismo, education y gimnasios. Añadir primero los conectores y semantics que habilitan su acción principal real.

### Ola 3 — Profundizar las ocho intermedias

Salud, belleza, retail, veterinaria, seguros, hogar, pet services y fotografía. Prioridad a seguridad regulada, recursos/capacidad, pagos y objetos de operación.

### Ola 4 — Replantear las cuatro básicas

Finanzas y technology necesitan toolsets propios. Servicios profesionales necesita matter/project lifecycle. `otro` debe convertirse en constructor declarativo.

### Ola 5 — Diferenciación con IA

Next-best-action explicable, handoff enriquecido, multimodalidad, voz, outcome analytics, simulación avanzada y optimización continua de prompts/modelos por vertical.

## 13. Definition of Done global

Una corrección vertical no se considera terminada hasta que:

- Actualiza el manifest y sus aliases.
- Incluye migración/reconciliación para tenants existentes.
- Respeta roles, tenant isolation, plan y assurance level.
- Actualiza API, dashboard y los cuatro idiomas.
- Tiene unit, integration, contract y E2E tests pertinentes.
- Incluye telemetría y outcome.
- Funciona en Agent Test sin escribir producción.
- Tiene manejo de dato faltante/vencido y fallback humano.
- Actualiza la promesa comercial si cambia la capacidad.
- Pasa el quality gate definido en el plan maestro de pruebas.

## 14. Evidencia de verificación ejecutada

> Esta evidencia pertenece al corte pre-Ola 0. Los resultados consolidados vigentes están en [`wave-0-execution-2026-08.md`](./wave-0-execution-2026-08.md).

- API TypeScript: `tsc --noEmit` pasó.
- API Jest: 10 suites / 52 pruebas pasaron; `crm.controller.spec.ts` falló por no proveer `LeadScoringService` en el módulo de test.
- Bootstrap de aplicación pasó al inyectar un `JWT_SECRET` de prueba; la suite no es hermética y deja handles abiertos.
- Dashboard TypeScript no pudo completarse en este checkout porque `node_modules/onborda` no está instalado, aunque la dependencia figura declarada. Es una limitación del entorno local, no evidencia suficiente de un error de código.
- No existe cobertura automática específica para registro, bootstrap, subtipos, aliases, tools verticales, Agent Test, vehicle routes, staff ni matriz de 18 verticales.

## 15. Decisiones de producto del baseline

Las decisiones 1–3 quedaron resueltas por la Ola 0: los defaults consumen cuota con pisos compatibles; `finanzas/seguros` redirige a `seguros/broker`; y el cambio directo de vertical queda bloqueado hasta disponer de migración transaccional con preview/rollback. Se conservan abajo para trazabilidad del corte.

1. ¿Los defaults de vertical consumen cuota o existe una reserva de sistema fuera de cuota?
2. ¿`finanzas/seguros` se elimina o redirige explícitamente a `seguros/broker`?
3. ¿Se permite cambio de industria con migración o se crea un tenant/workspace nuevo?
4. ¿Qué seis verticales recibirán inversión de conectores primero después de seguridad?
5. ¿Qué acciones requieren OTP, aprobación humana o solo confirmación del cliente?
6. ¿Se mantiene retail en pausa o se completa payment link/checkout como prioridad?
7. ¿Cuál es el modelo de moneda y precios de ejemplo por país?
8. ¿`otro` será fallback mínimo o constructor vertical estratégico?

---

Este documento reemplazó las conclusiones numéricas de julio como **baseline del 6 de agosto**. El diagnóstico vigente, los cierres y las decisiones residuales deben leerse en el consolidado de Olas 0–5 y su registro final; los deep-dives históricos siguen siendo insumo de trazabilidad.
