# Salud — deep-dive (Jul 2026)

> Dossier 2/18 según `_TEMPLATE.md`. Estado del código al 29-jul-2026 (post `95f758f3`, `b9bd6332`, `5c2581db`, `60049164`). Toda cita archivo:línea fue leída en esta sesión.

## 1. Veredicto y tesis de inversión

**INVERTIR — con la advertencia de que "la agenda más completa" no es la mesa de entrada del rubro.** Salud concentra la demanda #2 y #3 de LatAm en una sola vertical (dental 87 pts, especialistas 86 — `market-research-latam.md:383-384`) y es, de lejos, la mejor ficha del clúster de agenda: persona clínica en 4 idiomas, el único sub-tipo del catálogo que cambia contenido real (dental: 5 FAQs propias + `tools.treatments`), el único módulo multi-sesión de la plataforma (treatment-plans con página, card en CRM, tools IA y agregación en vertical-analytics), recordatorios 24h/2h + no-show follow-up ya en producción, y la única integración de salud (Cliniko) con auth y test de conexión reales. El problema es que ese 24/36 está repartido en el lugar equivocado del ICP: **el caso que HOY funciona entero es el psicólogo/nutricionista solista (demanda #3), y el caso que paga más y retiene más — la clínica dental multi-profesional (demanda #2) — está roto en su flujo central**: capacidad 1 por negocio vía chat, `staffId` descartado, y "¿me puede atender la Dra. X?" imposible. Para salud, F1 (capacidad) NO alcanza como sí alcanza para belleza: sillas intercambiables no modelan una clínica donde el paciente elige profesional y cada médico tiene su agenda — la mesa de entrada dental es F2 (staff persistido) + agenda por profesional visible. El segundo desalineo: el pitch económico del research para dental es el **recall semestral** ("the entire business model of preventive dentistry", `:446`) y su mecanismo — el trigger `inactivity` — está sembrado como plantilla de automation de salud que ningún código evalúa. Y la única integración construida (Cliniko) es el PMS equivocado para LatAm: el research documenta que los dentistas de MX/CO/CL ya pagan $50-200/mes por **Dentalink/DentalWeb** (`:536`), la integración que pedía como "category killer" (`:450`). Sobre estética: **coincidimos con el dossier 1** — la estética no-médica vive en belleza; el sub-tipo `estetica` de salud queda para dermatología/medicina estética y hoy no activa nada (§5).

## 2. Radiografía end-to-end

### 2.1 Alta

- `salud` presente en `INDUSTRY_KEYS` del alta (`apps/dashboard/src/app/onboarding/page.tsx:44`).
- Sub-tipos (hardcodeados `onboarding/page.tsx:65-71`, espejo del registry `vertical-definitions.ts:31-37`): `dental`, `medica_general`, `estetica` ("Estética y dermatología"), `psicologia`, `farmacia`. **Solo `dental` cambia algo real** (rama del bootstrap, §2.3); los otros 4 son cosméticos — incluida `farmacia`, que no es un negocio de agenda y nace igual con agendador y servicios de consulta sembrados.
- Objetivos del alta (`onboarding/page.tsx:179-184`): "Agendar citas médicas", "Responder preguntas de pacientes", "Atención y seguimiento post-consulta", "Recordatorios de citas y tratamientos". Audiencias (`:285-289`): particulares / empresas y convenios / pacientes con seguro médico. Post-`5c2581db` llegan al prompt L3 vía `<vertical_context>`.

### 2.2 Agente creado

- `createDefaultAgentFromGoals` (`persona.service.ts:2670-2774`): con `industry='salud'` toma `verticalTemplates[0]` = **`tpl_salud_recepcion`** ("Sofía - Recepción Médica", `persona.service.ts:1243-1270`): tono professional/formal, reglas correctas (nunca diagnósticos, confirmar datos antes de agendar), `tools: { appointments: {enabled, canBook, canCancel} }`, RAG on.
- Existen 3 plantillas de salud (`persona.service.ts:1241-1356`): recepción, seguimiento post-consulta, y **`tpl_salud_dental`** ("Sofía - Recepción Odontológica", `:1299-1355`) — la más rica de la vertical: reglas de triage de urgencias, valoración previa de 30min para ortodoncia/blanqueamiento, instrucción explícita de usar `get_treatment_plan`/`list_upcoming_sessions`, requiredFields name+phone, y tools `appointments + treatments + crm + knowledge`.
- **El mapa sub-tipo→plantilla NO incluye `dental`** (`persona.service.ts:2702-2708` cubre solo tours/agencia/tienda/delivery/dark_kitchen): la clínica dental recibe a la recepcionista genérica. El bootstrap le enciende `tools.treatments` igual (§2.3), pero las reglas que le enseñan al agente CUÁNDO usar esa tool, el protocolo de urgencias dentales y la valoración previa viven en la plantilla que nadie recibe. Misma clase de bug que tours pre-`5c2581db`.
- Para tenants en pt/fr/en, `localizeVerticalTemplates` devuelve UNA sola plantilla construida desde el registry (`persona.service.ts:2616-2664`) — la variante dental ni existe fuera de español.

### 2.3 Bootstrap (qué siembra)

Ruta genérica de `bootstrapVertical` (`verticals.service.ts:22-177`) + la ÚNICA rama por sub-tipo con contenido del catálogo (`:87-90`):

| Paso | Qué queda | Fuente |
|---|---|---|
| Pipeline | 6 etapas: Consulta inicial → Cita agendada (`appointment_required`) → Primera visita (name+phone) → Paciente activo (`email_required`) → Seguimiento → Alta (terminal) | `vertical-definitions.ts:70-79` |
| Persona | Patch canónico rellena-huecos + UNIÓN de forbidden/handoff del registry (diagnósticos, prescripción, datos de otros pacientes; "urgencia medica", "emergencia", "dolor intenso"…) | `verticals.service.ts:287-362`, `vertical-definitions.ts:57-68` |
| FAQs | 5 (horarios, pagos/seguro, emergencia → urgencias, cancelar/reprogramar, documentos primera visita) — neutralizadas + `tools.faqs` ON | `vertical-definitions.ts:80-86`, `verticals.service.ts:45-46` |
| Servicios | 3 en COP: Consulta general 30min $80k, Consulta especializada 45min $120k, Control y seguimiento 20min $50k | `vertical-definitions.ts:87-91` |
| Disponibilidad | `availability_slots` lun-vie 08:00-18:00, sáb 08:00-13:00, a nombre del owner | `vertical-definitions.ts:92-95`, `verticals.service.ts:56-58,468-542` |
| Appointments tool | Re-encendida tras el gate blando del alta (`restoreAppointmentsTool`) | `verticals.service.ts:60-67,1094-1137` |
| **Sub-tipo dental** | `seedDentalExtras`: 5 FAQs dentales de verdad (convenios/EPS, costo de limpieza, miedo al dentista, duración de ortodoncia "12-24 meses con citas mensuales", urgencias con escalada) + `enableTreatmentsTool` | `verticals.service.ts:87-90,711-806,940-963` |
| Sidebar/KPIs | crm→"Pacientes", pipeline→"Seguimiento", appointments→"Agenda Médica"; KPIs: Citas Hoy / Pacientes Nuevos / No Shows (semana) / Mensajes | `vertical-definitions.ts:96-111` |

### 2.4 Conversación — tabla de tools reales

Con el flag-set del bootstrap (appointments + faqs; dental suma treatments; Cliniko conectado suma 2):

| Tool | Qué hace | Gating | ¿Funciona e2e? |
|---|---|---|---|
| `list_services` / `check_availability` / `create_appointment` / `cancel` / `reschedule` / `list_customer_appointments` / `get_appointment_details` / `send_booking_link` | Ciclo completo de citas por chat | `tools.appointments` (`conversations.service.ts:1811-1813`) | Sí para UN profesional; capacidad 1 y sin staff (§2.5) |
| `get_faq_answer` | FAQs sembradas (las dentales son buenas) | `tools.faqs` ON por bootstrap (`verticals.service.ts:46`) | Sí |
| `get_treatment_plan` | Progreso del plan activo del contacto (sesiones totales/completadas/restantes, % avance) | `tools.treatments` — solo dental lo enciende (`verticals.service.ts:87-90`; registro `conversations.service.ts:1869-1871`) | Sí (`ai-tool-executor.service.ts:1776-1801` → `treatment-plans.service.ts:257-281`) |
| `list_upcoming_sessions` | Próximas sesiones del plan | idem | Sí (`ai-tool-executor.service.ts:1803+`) |
| `list_clinic_services` | Tipos de cita sincronizados de Cliniko (`vi_items`) | Cliniko conectado (`conversations.service.ts:1850`) | Lee lo sincronizado; sync solo manual (§2.8) |
| `check_clinic_availability` | Disponibilidad EN VIVO de Cliniko | idem | Live, pero exige `businessId`+`practitionerId` únicos en config (`vertical-integrations.service.ts:327-346`) |
| RAG / KB | Convenios, preparaciones, precios si el tenant carga contenido | `config.rag.enabled` en plantilla | Sí |
| `check_insurance`, `post_visit_followup` | Especificadas por la estrategia (`vertical-strategy.md:24-25`) | — | **No existen** |

### 2.5 Agenda — la más completa del catálogo, y el mismo techo

Lo que está BIEN y es del rubro: recordatorios pre-cita 24h y 2h por plantilla WhatsApp aprobada (crons `appointment-reminders.service.ts:24-25,47-48`), confirmación de asistencia post-cita (`:69`), auto-complete (`:91`) y follow-up de no-shows — exactamente el pitch anti-no-show del research (`market-research-latam.md:435`). El flujo determinístico no alucina, tiene guard anti double-booking con lock por (staff,fecha) (`ai-tool-executor.service.ts:1247-1272`) y escala a humano ante agenda no configurada (`booking-engine.service.ts:801-804`, `ai-tool-executor.service.ts:1105-1119`).

El techo (transversal, impacto específico en salud):

- `check_availability` acepta `staffId`, filtra ventanas por profesional (`ai-tool-executor.service.ts:968-974`) y DEVUELVE `staffId`/`staffName` por slot (`:1089-1094`) — pero el booking engine llama sin staffId (`booking-engine.service.ts:784-786`) y crea sin staffId (`:873-876`); `BookingState.slots` ni tipa el campo (`tools/appointment-tools.ts:103`). Toda cita de chat queda `assigned_to = null`.
- Con `assigned_to = null`, una sola cita bloquea TODAS las ventanas del horario (`ai-tool-executor.service.ts:1038-1046`): **una clínica con 3 consultorios atiende 1 paciente por franja vía chat**. El research sobre-declara justo esto: lista "Appointments module with multi-staff … conflict detection" como algo que YA hacemos para dental (`market-research-latam.md:438`) — por chat, no es verdad.
- `blocked_dates` existe y las rutas del módulo appointments lo consultan (`appointments.service.ts:598,736`), pero el `checkAvailability` del executor de chat no lo mira (`ai-tool-executor.service.ts:976-994`: solo availability_slots + appointments + calendar busy): el paciente puede reservar el feriado que la clínica bloqueó.
- La tabla `service_staff` existe en el schema tenant (`prisma.service.ts:244`) — el vínculo servicio↔profesional que F2 necesita ya tiene dónde vivir. El módulo staff-scheduling NO es ese camino: la auditoría lo marcó MATAR (SQL roto, 0 consumidores — `vertical-maturity-audit-2026-07.md:138`).

**Por qué F1 solo no alcanza en salud:** `services.max_concurrent` modela N recursos intercambiables — correcto para sillas de manicure, insuficiente para una clínica donde "Consulta especializada" la dan 2 de los 5 médicos, cada uno con SU agenda y SU paciente que lo pide por nombre. El caso dental multi-profesional necesita F2 (persistir el staffId que ya viaja) + oferta de slots "con la Dra. X" + agenda por profesional en el dashboard. F1 le sirve a salud solo como parche intermedio (dejar de mentir disponibilidad global).

### 2.6 Pipeline

6 etapas correctas para el rubro (`vertical-definitions.ts:70-79`): journey clínico real (primera visita ≠ paciente activo ≠ alta). `appointment_required` en "Cita agendada" es satisfacible (las citas de chat SÍ escriben en `appointments`). Sin reglas rotas conocidas; salud no usa `offer_required` (limpiada de otras 6 verticales en `5c2581db`).

### 2.7 Dashboard del tenant

- Ítem de sidebar propio: **"Planes de tratamiento"** (`/admin/treatment-plans`), compartido con veterinaria (`AppSidebar.tsx:136`), con página global (lista, filtros por estado, contadores — `treatment-plans.service.ts:26-64`) y card por contacto en CRM (`components/TreatmentPlansCard.tsx`).
- ProductTour SÍ cubre salud (`ProductTour.tsx:33`: salud → treatmentPlans). Cosmética completa por ser vertical original: `verticalWelcome` con guard (`admin/page.tsx:364`), y salud está en `APPOINTMENT_INDUSTRIES` (`admin/page.tsx:85`) → widget de citas del día en el home.
- KPIs: los 4 genéricos de agenda incluyen `noShowsWeek` — el KPI correcto del rubro. Falta lo que treatment-plans ya sabría responder (planes activos, sesiones de la semana) como KPI del home del tenant.
- `vertical-analytics` (super admin) SÍ agrega salud (`vertical-analytics.service.ts:493-514,612-616`): treatments activos/completados, sesiones 7d; headline = planes activos (`:640`). De las pocas verticales con case propio.

### 2.8 Integraciones

**Cliniko** (T3.19, `vertical-integrations.service.ts`): config en `tenant.settings.verticalIntegrations.cliniko` con `apiKey/baseUrl/businessId/practitionerId` (`:23-29`), test de conexión real (`:215-219`), sync de appointment_types a `vi_items` (`:305-324`) y disponibilidad live (`:327-346`). Tres límites: (1) **read-only** — no hay write-path: la IA muestra horarios de Cliniko pero la reserva no entra a Cliniko ni a nuestro `appointments`; (2) **sync manual** — no existe cron de re-sync (dispatch solo en `sync()`, `:190-202`); (3) **`practitionerId` es UNO en la config** — hasta la integración es mono-profesional. Nunca probada en vivo (sin credenciales; `vertical-strategy.md:338,361` la sobre-declara "✅"). Y la pregunta de fondo: **Cliniko (Australia/NZ) no es el PMS que usa el rubro en LatAm** — el research dice que dentistas de México/Colombia/Chile pagan Dentalink o DentalWeb (`market-research-latam.md:536`) y pedía exactamente esa integración bi-direccional como "the category killer … eliminates the 'but I already have software' objection" (`:450`). Cliniko se construyó porque el análisis competitivo lo listó como referencia del clúster E (`competitive-analysis-2026-q2.md:411`: "Cliniko API — citas/recordatorios sin tocar el EHR (evita HIPAA)"), no porque el mercado objetivo lo use.

## 3. La experiencia hoy, contada honestamente

**(a) El dueño en sus primeros 30 minutos.** El psicólogo o nutricionista solista tiene el mejor primer día de la plataforma: elige "Psicología y terapia", sale con Sofía formal y prudente, 5 FAQs sensatas, 3 servicios con precios plausibles, agenda lun-sáb sembrada, pipeline que habla de "Primera visita" y "Paciente activo", recordatorios 24h/2h listos para encender y un panel que le muestra las citas de hoy. Su flujo real — 20-40 pacientes, todo por WhatsApp — está cubierto de verdad. La clínica dental de 3 odontólogos vive otra historia: el alta la trata idéntica salvo 5 FAQs extra y una tool de tratamientos que su agente no sabe usar (la plantilla dental con las instrucciones nunca se le asigna); no hay ninguna pantalla donde declarar "somos 3 doctores con estas agendas" que el bot respete (el módulo de citas asigna staff, pero el chat lo ignora); y al probar dos reservas en la misma franja descubre el "no hay disponibilidad" fantasma. La farmacia directamente recibió el producto equivocado: una agendadora de consultas médicas.

**(b) El paciente por WhatsApp en sus primeros 3 mensajes.** "Hola, ¿atienden ortodoncia?" → bien: FAQ dental sembrada responde con rango honesto (12-24 meses) e invita a valoración. "¿Tienen cita el jueves con la Dra. Martínez?" → acá se cae: no existe noción de profesional en el flujo; el bot ofrece slots anónimos de la clínica entera, y si otro paciente ya tomó las 10:00 con CUALQUIER doctor, esa franja desaparece para todos. "Me duele mucho una muela" → el handoff trigger "dolor intenso" (registry + FAQ de urgencias) escala correctamente — el triage de urgencias es de lo mejor del vertical. Donde miente sin saberlo: el paciente de ortodoncia que pregunta "¿cuándo es mi próxima cita del plan?" solo obtiene respuesta real si el tenant es dental (flag encendido), si la clínica cargó el plan a mano en `/admin/treatment-plans`, y aún así el agente no tiene ninguna regla que le diga que esa tool existe (plantilla no asignada). Y todo lo que el paciente cuenta espontáneamente — "soy diabético, tomo losartán" — queda persistido en `messages` y viaja al proveedor LLM de turno (§4, hueco #8).

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|---|
| 1 | Multi-profesional roto por chat: capacidad 1 global + staffId descartado; "con la Dra. X" imposible. Rompe el ICP dental (demanda #2) | **Alta** | `ai-tool-executor.service.ts:1038-1046`; `booking-engine.service.ts:784-786,873-876`; `appointment-tools.ts:103` | F1 (max_concurrent en chat) como parche + **F2** (propagar staffId slot→estado→create; ya viaja `:1089-1094` y `create_appointment` lo acepta `:1252`) + oferta de slots por profesional | S+M |
| 2 | Sub-tipo `dental` no mapea a `tpl_salud_dental`: el agente recibe la tool `treatments` sin las reglas que enseñan a usarla, ni el protocolo de urgencias/valoración | Alta | `persona.service.ts:2702-2708` (bySubType sin dental) vs `verticals.service.ts:87-90` (flag ON igual) | 1 entrada en `bySubType`: `dental: 'tpl_salud_dental'` | XS |
| 3 | Recall semestral muerto: la plantilla dental promete "maneja recall semestral" (`persona.service.ts:1301`), la automation "Recordatorio de control" (industry salud) está sembrada con `trigger_type: 'inactivity'` — y ningún código evalúa inactividad | **Alta** (es el pitch económico #1 del research para dental, `market-research-latam.md:446`) | `seed-templates.ts:246-266` (y :149,:170 las genéricas); grep `inactivity` en `apps/api/src` = solo seed-templates; el motor evalúa por evento entrante (`automation-listener.service.ts:29,47-50`: `@OnEvent('lead.captured')` → `WHERE trigger_type = $1`) | Cron evaluador de inactividad (mismo ítem TERMINAR de la auditoría, sirve a belleza/gym/dental a la vez) + cadencia por servicio | S/M |
| 4 | Cliniko: PMS equivocado para LatAm (el rubro paga Dentalink/DentalWeb), read-only, sync manual, `practitionerId` único, nunca probado en vivo | Media | `vertical-integrations.service.ts:23-29,190-202,327-346`; `market-research-latam.md:450,536`; `vertical-strategy.md:338` sobre-declara | No invertir más en Cliniko; research de API Dentalink/DentalWeb antes de construir nada (§5); si Cliniko queda, cron re-sync + prueba viva |  S (fiabilidad) / research |
| 5 | `blocked_dates` ignorado por la ruta de chat: se reserva el feriado bloqueado | Media | `ai-tool-executor.service.ts:976-994` (no consulta blocked_dates); sí lo hacen `appointments.service.ts:598,736` | Añadir el filtro de blocked_dates al `checkAvailability` del executor | XS/S |
| 6 | Sub-tipo `farmacia` recibe agendador + 3 servicios de consulta sembrados: no es un negocio de citas | Media | `vertical-definitions.ts:36` (subtipo existe), `verticals.service.ts:49-58` (seed ciego a subType) | Farmacia → no sembrar servicios/slots; persona de catálogo+pedidos con guardrail de medicamentos con receta (o mapear a retail con overrides) | S |
| 7 | Sub-tipos `estetica` y `psicologia` cosméticos: la dermatología no activa `treatments` (series de sesiones) ni FAQs de preparación/contraindicaciones; psicología no activa paquetes de sesiones ni ajusta la persona (confidencialidad, cancelaciones) | Media | `verticals.service.ts:87-90` (solo dental tiene rama); `market-research-latam.md:471` (session packages = feature #1 de especialistas) | Extender la rama: `estetica`/`psicologia` → `enableTreatmentsTool` + FAQs propias (patrón `seedDentalExtras` ya existe) | S |
| 8 | Historia clínica espontánea sin tratamiento especial: lo que el paciente cuenta ("soy diabético…") persiste en `messages` sin retención/redacción diferencial y viaja a los 5 proveedores LLM del router según plan (los planes baratos rutean a los proveedores más económicos). El L1 prohíbe diagnosticar (`prompt-assembler.service.ts:96`) — regula lo que el bot DICE, no lo que RECIBE y almacena | Media/Alta (riesgo reputacional/regulatorio del rubro) | `compliance.service.ts:177-252` (erasure/redacción existe pero solo bajo demanda GDPR); no existe política de retención ni redacción proactiva (no encontrada: grep retention/redact en compliance) | Corto: aviso de privacidad de salud en el saludo/FAQ + documentar DPA de proveedores. Medio: retención configurable por vertical + opción de pin de proveedor LLM por tenant | S / M |
| 9 | KPIs del home no usan treatment-plans: la clínica no ve "planes activos / sesiones esta semana" aunque el agregador super-admin ya lo calcula | Baja | `vertical-definitions.ts:104-111` (4 KPIs genéricos) vs `vertical-analytics.service.ts:493-514` | 2 KPIs de treatments para salud (datos ya disponibles) | S |
| 10 | `slaHours` sin sembrar para salud pese a cadena completa tipo→seeder→motor→UI (ítem TERMINAR de la auditoría) | Baja | `vertical-definitions.ts:72-77` (stages sin slaHours); `vertical-maturity-audit-2026-07.md:134` | Sembrar SLA en Consulta inicial (ej. 2h) | XS |
| 11 | Pre-intake inexistente: el research pide formulario pre-cita por WhatsApp Flows (72% completion, feature #4 dental `market-research-latam.md:452`); hoy no hay nada equivalente por WhatsApp (pre-chat es del widget) | Media | grep Flows en `apps/api/src` sin resultado de intake (no verificado exhaustivamente, §8) | Diseño aparte; corto plazo: preguntas de intake como paso post-booking del engine | M/L |

Lo que está BIEN y hay que decirlo: el ciclo de recordatorios/no-show es real y completo (24h, 2h, confirmación de asistencia, auto-complete, follow-up — `appointment-reminders.service.ts`); el triage de urgencias por handoff triggers + FAQ funciona; las FAQs dentales son las mejores del catálogo junto a tours/inmobiliaria; treatment-plans es un módulo de verdad con `frequency_days` y `expected_end_at` que ya modelan la ortodoncia mensual (`treatment-plans.service.ts:101-103`); y salud tiene la cosmética completa (welcome, tour, widget de citas, analytics case).

## 5. Lo que esta industria necesita y no tenemos

**Mesa de entrada (sin esto no somos creíbles en dental/clínicas):**
1. **Agenda por profesional visible por chat** ("con la Dra. X", slots por médico): F2 + exponer `staffName` (la tool ya lo devuelve). Es EL requisito de la clínica; sin esto solo somos creíbles para el solista. La estrategia original ya lo especificaba: `check_availability(doctor, date_range)` (`vertical-strategy.md:21`).
2. **Recall vivo**: evaluador del trigger `inactivity` + cadencia por servicio (control 6 meses; la FAQ sembrada ya fija "ortodoncia: citas mensuales" — con `treatment_plans.frequency_days=30` la base de datos ya lo sabe). El research lo cuantifica: payback < 1 día para la clínica (`market-research-latam.md:435,446`).
3. **Capacidad honesta** (F1) mientras F2 llega: dejar de decir "no hay disponibilidad" con consultorios libres.
4. **Respetar `blocked_dates` en chat** — un bot que agenda en feriado destruye confianza clínica en una conversación.

**Diferenciadores (donde ya tenemos ventaja de base):**
1. **Treatment-plans conversacional completo**: somos los únicos con el objeto construido ("completely absent from every competitor", `market-research-latam.md:448`); falta cerrar el circuito — asignar plantilla dental (hueco #2), recordatorios por hito de pago (base MP existe; `payment-at-booking` es la jugada Podium, `competitive-analysis-2026-q2.md:418`) y creación de plan desde la valoración.
2. **Paquetes de sesiones para especialistas** (5/10 sesiones de psicología/nutrición): es el feature #1 del nicho #3 (`market-research-latam.md:471`) y `treatment_plans` lo modela tal cual (total_sessions/completed/auto-notify al agotarse = 1 automation).
3. **Cancellation recapture** (`:475`): al cancelar dentro de 24h, ofrecer los 3 próximos slots — el engine ya sabe cancelar y consultar disponibilidad; falta el enganche evento→flujo.
4. **Pre-intake por WhatsApp** (`:452`): diferencial dental #4; largo plazo Flows, corto plazo preguntas post-booking.

**Integraciones LatAm concretas:** la que el research nombra es **Dentalink/DentalWeb** (`:450,536`) — no hay research propio de sus APIs (queda como tarea previa, no como plan comprometido). Cliniko se mantiene en modo fiabilidad mínima o se congela. Para especialistas solistas, ninguna integración es mesa de entrada: su "sistema" es WhatsApp + agenda — exactamente nosotros.

**El sub-tipo estética — pronunciamiento explícito (coordina con dossier 1):** **De acuerdo con moda_belleza: la clínica de estética NO-médica (cosmetología, depilación, spa) debe vivir en belleza** con su sub-tipo `estetica` activable. Argumentos desde salud: (a) el flujo de la estética no-médica es el de belleza (rebooking por cadencia, galería antes/después, IG-first), no el clínico (historia, seguros, urgencias); (b) la persona de salud es formal y sin emojis (`persona.service.ts:1252`) — tono equivocado para ese negocio; (c) el 88 del research es de "Beauty & Aesthetics Clinics" como categoría comercial, no médica. Lo que salud CONSERVA es la **dermatología/medicina estética** (procedimientos médicos, consentimientos, contraindicaciones): el sub-tipo `estetica` de salud se re-etiqueta honestamente como "Dermatología y medicina estética" y activa `treatments` + FAQs de preparación/contraindicaciones — sin duplicar lo de belleza. La frontera práctica para el que se registra: ¿hay médico prescribiendo? → salud; ¿no? → belleza. Esa guía debe estar visible en el selector del alta (hoy no hay ninguna).

## 6. Competencia del rubro

Solo desde nuestros docs:

- **El system-of-record del rubro NO es nuestro rival, es el objetor.** Los dentistas LatAm ya pagan $50-200/mes por Dentalink/DentalWeb (`market-research-latam.md:536`) — "entienden ROI de software", lo que los hace el segundo mejor nicho GTM, pero la objeción de venta es "ya tengo software": el research la neutraliza con integración, no con reemplazo (`:450`). La doctrina del análisis competitivo coincide: "thin vertical, deep horizontal" — no construir EHR/charting/insurance billing (`competitive-analysis-2026-q2.md:402-404`), y anota que **Cliniko no tiene IA** y Jane apenas un AI Scribe (`:411`): la capa conversacional está vacante en el rubro.
- **Ningún competidor conversacional LatAm tiene el stack clínico**: los horizontales de WhatsApp (Kommo, Leadsales, Whaticket, Wati, Chatfuel) no tienen booking determinístico ni objetos de tratamiento; nuestro treatment-plans es "completely absent from every competitor" según el research (`market-research-latam.md:448`) — la ventaja es real y está construida, solo desconectada del agente por el hueco #2.
- **Dónde se gana geográficamente**: el research marca dental como GTM #2 en Colombia+Chile+Ecuador+Costa Rica (`:535-536`), con vignettes específicas — turismo dental en Costa Rica (`:179-184`), densidad de clínicas en Quito con facturación en USD (`:268-274`), alto gasto dental per cápita en Chile (`:310`). La estrategia interna dimensiona 600K+ consultorios dentales en LatAm (`vertical-strategy.md:16`).
- **Precio**: la clínica que pierde $225-450/día en no-shows (`market-research-latam.md:435`) compra Starter $49 con payback < 1 día; el especialista solista a $21-49 reemplaza un asistente virtual part-time (`:460`).

**Conclusión:** el rubro es ganable en dos velocidades — especialistas solistas HOY con el producto actual (nadie más tiene booking WhatsApp que no alucine a ese precio), clínicas dentales DESPUÉS de F2+recall (sin eso, la demo multi-doctor se cae en el minuto 2 frente a una recepcionista humana).

## 7. Plan de inversión de ESTA vertical

Coherente con §1 (INVERTIR, en dos velocidades). Orden = dependencias.

**Quick wins (días):**
| # | Qué | Dónde | Esf. |
|---|---|---|---|
| QW1 | `dental: 'tpl_salud_dental'` en `bySubType` (la plantilla rica existe y nadie la recibe) | `persona.service.ts:2702-2708` | XS |
| QW2 | `blocked_dates` en el `checkAvailability` del executor | `ai-tool-executor.service.ts:976-994` (patrón en `appointments.service.ts:736`) | XS/S |
| QW3 | `estetica`/`psicologia` → `enableTreatmentsTool` (dermatología en series; paquetes de sesiones) | `verticals.service.ts:87-90` | XS |
| QW4 | 2 KPIs de treatments en el home de salud (datos ya calculados por el agregador) | `vertical-definitions.ts:104-111` + agregador tenant | S |
| QW5 | `slaHours` en "Consulta inicial" | `vertical-definitions.ts:72` | XS |
| QW6 | Corregir `vertical-strategy.md:338,361` (T3.19 sobre-declarado) y la afirmación multi-staff del research al citarla en material de venta | docs | XS |

**Mediano (semanas) — el corazón:**
| # | Qué | Dónde | Esf. |
|---|---|---|---|
| M1 | **F1 capacidad** en la ruta de chat (parche honesto mientras F2 llega; compartido con belleza/restaurantes) | `ai-tool-executor.service.ts:926-1096` | S |
| M2 | **F2 staff persistido + oferta por profesional**: staffId slot→BookingState→create; slots presentados "10:00 con la Dra. X"; preferencia de profesional en el flujo. Para salud F2 es mesa de entrada, no mejora | `booking-engine.service.ts:784,873`, `appointment-tools.ts:97-108` | M |
| M3 | **Evaluador `inactivity`** (cron días-sin-actividad → dispara reglas sembradas; la de salud ya existe sembrada) | `automation/` + `seed-templates.ts:246-266` | S/M |
| M4 | **Recall por servicio**: `rebook_after_days` en services + preset "Dental Templates" 1-click (research `:446`); ortodoncia usa `frequency_days` de treatment-plans | `services.service.ts`, seed, M3 | S |
| M5 | **Farmacia honesta**: no sembrar agenda; persona catálogo+pedidos con guardrail de recetas | `verticals.service.ts`, `vertical-definitions.ts:36` | S |
| M6 | Higiene de datos de salud: aviso de privacidad sembrado + retención/redacción configurable (diseño chico sobre compliance existente) | `compliance/`, FAQs semilla | S/M |

**Apuesta (si dental se confirma como GTM #2 tras belleza):**
| # | Qué | Por qué | Esf. |
|---|---|---|---|
| A1 | Research API Dentalink/DentalWeb → integración read-first (citas hacia Parallly) y luego push de intake | "The category killer" del nicho (`market-research-latam.md:450`); elimina la objeción "ya tengo software" | research + L |
| A2 | Circuito completo treatment-plans: creación desde valoración + hitos de pago con link MP en WhatsApp | Único en el mercado (`:448`); base de billing existe | M/L |
| A3 | Pre-intake WhatsApp (Flows o post-booking del engine) | Feature #4 dental (`:452`), 72% completion | M/L |
| A4 | Cancellation recapture (evento cancel → ofrecer 3 slots) | Feature #3 especialistas (`:475`); todo el stack ya existe | M |
| A5 | Cliniko: decisión explícita congelar-o-fiabilizar (cron re-sync + prueba viva SI algún tenant real lo pide) | No gastar en el PMS que el mercado objetivo no usa | S |

Qué NO hacer: EHR/historia clínica propia ni charting (doctrina anti-trampa de recursos, `competitive-analysis-2026-q2.md:404`); staff-scheduling módulo (MATAR confirmado — el multi-staff va por `service_staff` + F2); más adapters de PMS sin research de mercado previo; y NO absorber la estética no-médica (vive en belleza, §5).

## 8. Qué no se verificó

- **Nada se ejecutó contra base real** — todo es lectura de código; en particular no se corrió un alta con sub-tipo dental para confirmar el orden `createDefaultAgentFromGoals` → `bootstrapVertical` en runtime (se leyó en `auth.service` vía comentarios de `persona.service.ts:2735-2741`, no el call site).
- **Cliniko en vivo**: cero pruebas con credenciales reales (limitación heredada de T3.19, declarada también por la auditoría).
- **El comportamiento del LLM con `treatments` ON sin reglas de plantilla**: se afirma que el agente "no sabe usar" la tool por ausencia de instrucciones; el modelo podría descubrirla solo por la descripción de la tool — no se probó (la severidad del hueco #2 podría bajar).
- **Pre-intake / WhatsApp Flows**: se buscó de forma no exhaustiva; "no existe" se afirma para un flujo de intake pre-cita por WhatsApp, no para Flows en general.
- **La ruta del proveedor LLM por plan** (hueco #8): la afirmación "planes baratos rutean a proveedores más económicos" viene de la config del router documentada (CLAUDE.md, plan-gated tiers), no de leer `ai/router` en esta sesión.
- **% real de clínicas multi-profesional en el ICP dental**: ningún doc interno trae censo; se usó el propio research (target "mid-size dental clinic" en el segmento 2, `market-research-latam.md:75`) como proxy. Regla respetada: no se inventó la cifra.
- **Marco regulatorio LatAm de datos de salud** (habeas data CO, LGPD BR): nuestros docs de mercado no lo cubren y este dossier no lo inventó — es un hueco de research que el hueco #8 hereda.
- **Cifras de mercado** (87/86 pts, $2.71B dental software, 600K consultorios): del research interno abr-may 2026, no re-validadas contra fuentes externas.
