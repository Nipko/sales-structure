# Education — deep-dive (Jul 2026)

> Dossier 9/18. Primer documento que ve la vertical DESPUÉS del desbloqueo de la tabla `courses` (`b9bd6332`: 5 ALTERs + `slug DROP NOT NULL`). Todo lo afirmado tiene archivo:línea leído en esta sesión.

## 1. Veredicto y tesis de inversión

**INVERTIR — en terminar lo desbloqueado, no en construir de cero.** Education es la vertical con mejor relación esfuerzo/retorno del clúster servicios: demanda #7 de LatAm (76 pts, con retention 9/10 — la tercera más alta del top-10, `market-research-latam.md:388`), y el único rubro del top-10 fuera de los ya atendidos que llega con módulo transaccional propio construido. Desde ayer el circuito estrella — curso → cohorte → inscripción por chat — **funciona end-to-end por primera vez** (verificado tool por tool en §2). Pero el desbloqueo dejó la vertical al 85%, y el 15% restante es exactamente donde está la plata: la inscripción queda en `payment_status='pending'` para siempre porque **nadie puede marcarla pagada** (el endpoint existe, la UI no lo llama), el test de nivel promete un link que **no puede existir** (cero escritores de `test_url` en todo el repo), y la cancelación miente ("liberamos tu cupo") sin devolver el asiento — cohortes que se agotan artificialmente. Son arreglos de días, no de semanas. La fusión de las dos páginas de cursos (mandato de la auditoría: MATAR la legacy) es más simple de lo temido porque ambas escriben la MISMA tabla física: es una fusión de UI, no de datos.

## 2. Radiografía end-to-end

### Alta (sub-tipos, objetivos)

Sub-tipos reales: `idiomas`, `universitaria`, `online`, `capacitacion` (`vertical-definitions.ts:461-466`). Son **100% cosméticos**: no hay entrada education en el mapa `bySubType` de selección de plantilla (`persona.service.ts:2704-2715` — solo tours/agencia/tienda/delivery/dark_kitchen/dental), no hay rama por sub-tipo en el bootstrap (`verticals.service.ts:69-148` — turismo y salud-dental sí las tienen), y no siembran cursos ejemplo distintos (no se siembra NINGÚN curso, ver abajo). Una escuela de idiomas y una capacitadora corporativa reciben exactamente lo mismo.

### Agente creado

Una sola plantilla: `tpl_educacion_inscripciones` — "Pablo, Asesor Académico" (`persona.service.ts:1790-1819`). Trae `tools: { appointments }` solamente; el flag `education` NO viene en la plantilla — lo enciende el bootstrap (abajo). Consecuencia menor: un agente creado DESPUÉS desde el editor con esta plantilla nace sin las 6 tools de cursos hasta que alguien prende el toggle. Localización a en/pt/fr vía registry (`localizeVerticalTemplates`, `persona.service.ts:2618-2666`; alias `educacion→education` en `:2590-2592`).

### Bootstrap (qué siembra)

`bootstrapVertical` (`verticals.service.ts:22-177`) para education:
1. 6 etapas de pipeline (ver abajo).
2. Persona vertical al agente default (shape canónico post-`95f758f3`).
3. 5 FAQs propias + `tools.faqs` on (`:45-46`).
4. 3 servicios de agenda + slots desde `businessHours` (`:49-58`): Clase de prueba (60min, $0), Tutoría personalizada (60min, $80.000), Test de nivel (30min, $0) (`vertical-definitions.ts:484-488`).
5. `restoreAppointmentsTool` (`:67`).
6. `enableEducationTool` (`:119-121`, `:1166-1189`) → `tools.education.enabled=true` en el agente default.

**Lo que NO siembra: ni un curso ni una cohorte.** `get_courses` devuelve vacío el día 1 aunque la tool esté encendida. Es el único insumo que el circuito no puede autoabastecer.

### Conversación — tabla de tools

Gating: `conversations.service.ts:1887-1889` (`cfgTools?.education?.enabled === true` suma `EDUCATION_TOOLS`). Ejecutor: `ai-tool-executor.service.ts:277-294` (dispatch), handlers `:2310-2420` y `:3001-3057`. **Los placeholders/params de TODOS los INSERT/UPDATE de `education.service.ts` están limpios** (verificado uno a uno; `createCohort` reúsa `$7` para `max_capacity` y `available_seats` a propósito — 10 columnas, 9 params, correcto). No hay patrón tours acá.

| Tool | Qué hace | Gating | ¿Funciona e2e? |
|------|----------|--------|----------------|
| `get_courses` | Lista cursos activos con filtros subject/level/modality (`education.service.ts:27-39`) | `tools.education` | **SÍ** post-fix. Pero día 1 vacío (sin semillas) y el filtro `modality='online'` pierde cursos creados en la página legacy (`'virtual'`, ver abajo) |
| `get_course_schedule` | Cohortes abiertas próximos 60 días con asientos (`upcomingCohorts`, `:156-182`) | idem | **SÍ** post-fix — seleccionaba `duration_weeks`/`certification` inexistentes; los ALTERs de `tenant-schema.sql:2224-2228` lo revivieron |
| `enroll_student` | Inscribe + descuenta asiento (`enrollStudent`, `:207-245`) | idem | **SÍ, con letra chica**: check→INSERT→decremento son 3 statements sin transacción — con carrera puede sobre-inscribir (el decremento tiene guard `available_seats > 0` pero el INSERT ya quedó). Responde "Payment pending to confirm the seat" (`ai-tool-executor.service.ts:2392`) |
| `get_placement_test_link` | Busca/crea placement test del contacto (`:2399-2420`) | idem | **NO — callejón sin salida al 100%**: crea la fila con `test_url` NULL y responde "Test URL pending — ask the academic team to upload it". No existe NINGÚN escritor de `test_url` en el repo: el controller no tiene endpoints de placement (`education.controller.ts` completo: courses/cohorts/enrollments), el dashboard no tiene ni página ni llamada (grep `placement` en `apps/dashboard/src`: 0 archivos fuera de messages) |
| `cancel_enrollment` | Cancela inscripción propia (IDOR guard OK) (`:3003-3026`) | idem | **A MEDIAS y miente**: pone `status='cancelled'` pero (a) **no devuelve el asiento** — el mensaje "The seat has been released" es falso (grep `available_seats`: solo tours tiene el `+1`; education solo decrementa) y una cohorte `full` queda `full` para siempre; (b) `cancellationReason` se descarta en silencio (el map de `updateEnrollment`, `education.service.ts:251-255`, no tiene esa clave ni existe la columna); (c) la descripción dice "pending or enrolled" y el código permite `['enrolled','active']` |
| `list_my_enrollments` | Inscripciones del contacto (`:3028-3057`) | idem | SÍ, con detalle: excluye `dropped/refunded` pero **no** `cancelled` — lo cancelado se sigue listando |

**¿"enroll_student exige get_course_schedule antes" corta el flujo?** No: es instrucción de prompt (doc de la tool, `education-tools.ts:26,39`), no un check de código — `enrollStudentTool` acepta cualquier `cohortId` válido. El flujo real "me interesa inglés B1" → el LLM llama `get_courses`/`get_course_schedule` → cohortes con `cohort_id` → confirma nombre/mail → `enroll_student`. Con cursos+cohortes cargados, **el circuito conversacional completo hoy FUNCIONA**. Donde puede morir antes: (1) catálogo vacío día 1 → "No courses match" y las FAQs deflectan ("cuéntame qué te interesa" sin datos); (2) si el interesado dice "¿hay **disponibilidad**?" o "quiero **reservar** un cupo", el regex del booking engine (`intent-interpreter.service.ts:336`: `agendar|cita|reservar|turno|programar|disponib|book|appointment|schedule`) secuestra el turno hacia la agenda de citas y ofrece "Clase de prueba / Tutoría / Test de nivel" en vez de cohortes. El verbo natural del rubro ("inscribirme", "matricularme") NO está en el regex — por eso el secuestro es parcial, no total como en gimnasios.

### Agenda

Las 3 citas 1:1 (prueba/tutoría/test) calzan bien con el motor mono-recurso; la capacidad real del rubro vive en cohortes (modelo correcto — el hueco estructural transversal pega menos acá). El "Test de nivel" como servicio agendable ES el camino que funciona para nivelación presencial; el link digital es el que está muerto.

### Pipeline

6 etapas propias (`vertical-definitions.ts:469-476`): interesado → info_enviada (`email_required`) → inscrito (`name_required`+`phone_required`) → activo → completado / desercion. **Precisión sobre `offer_required` que corrige al commit `5c2581db`**: el mensaje del commit dice "se CONSERVA en education", pero las etapas de education **no la tienen ni la tenían** — la 7ª ocurrencia pre-fix era la etapa "Propuesta" del pipeline genérico (`createGenericVertical`, hoy `vertical-definitions.ts:511`), que es donde la regla sobrevive (verificado con `git show 5c2581db^`: las 7 ocurrencias eran inmobiliaria/automotriz/turismo/genérico/servicios_hogar/fotografia/seguros). Lo que sí es cierto: education es el único vertical donde el artefacto de la regla existe completo — `commercial_offers` se escribe desde `/admin/catalog/offers` (`catalog.service.ts:138-156`) y `leads.course_id` desde el intake de landing pages (`intake.service.ts:273-288, 312-315`). Ojo: un lead nacido por CHAT nunca recibe `course_id` (ni `enroll_student` lo setea), así que si un tenant configura `offer_required` a mano en el editor de etapas (sigue ofrecida: `settings/pipeline/page.tsx:445`), solo los leads de landing podrían pasarla.

### Dashboard del tenant

- Sidebar: "Cursos" → `/admin/courses`, solo education, capability `canEditPipeline` (`AppSidebar.tsx:133`). Labels: CRM→"Estudiantes", pipeline→"Inscripciones" (`vertical-definitions.ts:490`).
- `/admin/courses` (`page.tsx`, 525 líneas): 3 pestañas. **Cursos: CRUD completo** (modal con subject/level/modality/duración/precio/certificación → `api.createCourse`). **Cohortes: alta por curso + cancelar** (no hay editar — el controller solo tiene create/cancel: cambiar horario/instructor/cupo exige cancelar y recrear). **Inscripciones: SOLO LECTURA** — `api.createEnrollment` y `api.updateEnrollment` existen (`api.ts:1648-1651`) con **0 llamadores** en todo el dashboard: el dueño no puede registrar un alumno walk-in ni marcar una matrícula pagada. `payment_status` nace `'pending'` (`tenant-schema.sql:2266`) y no hay superficie que lo cambie. (El patrón gimnasios de la ronda, en versión parcial: acá el alta de cursos SÍ existe; lo inalcanzable es la escritura de inscripciones.)
- No hay pestaña ni página de placement tests: lo que Pablo crea por chat es invisible para el dueño.
- KPI "Matrículas Hoy" usa la key `appointmentsToday` (`vertical-definitions.ts:493`): cuenta citas (clases de prueba), no matrículas.
- `STATUS_COLORS` de la tabla de inscripciones no tiene `cancelled` (`page.tsx:72-78`) — cosmético.

### Las DOS páginas de cursos (y el diseño de la fusión)

La misma tabla física, dos shapes: la legacy `courses` del catálogo (`tenant-schema.sql:312-329`) gana por `IF NOT EXISTS` y el shape education llega entero por ALTER (`:2222-2233`).

- `/admin/catalog/courses` (legacy): NO está en el sidebar; se llega por el hub `/admin/catalog` (linkeado desde el ToolsTour del setup-wizard, `ToolsTour.tsx:65`; `roles.ts:180` lo permite a admin/supervisor). Escribe vía `POST /catalog/courses` (`catalog.service.ts:28-47`): genera `slug`, acepta `code` y `brochure_url`, y usa el vocabulario de modalidad `presencial|virtual|hibrido` — **distinto** del de education (`presencial|online|hybrid`): un curso "virtual" legacy no matchea el filtro `modality='online'` de `get_courses`. Su botón Editar está muerto (`catalog/courses/page.tsx:127`, sin onClick).
- Qué usa la legacy que education no cubre: `code`, `slug`, `brochure_url` (el PDF del programa — útil real), y sobre todo sus VECINOS: campañas (`campaigns.course_id`, selector en `catalog/campaigns/page.tsx:38` lee `/catalog/courses`), ofertas (`commercial_offers.course_id` — el artefacto de `offer_required`) y landings de intake (`landing_pages.course_id`).
- **Fusión concreta sin romper `offer_required`**: como todos los vecinos referencian `courses.id` de la MISMA tabla, no hay migración de datos. (1) Agregar `brochure_url` (y opcional `code`) al modal de `/admin/courses` y al map de `updateCourse` de education (`education.service.ts:74-80`); (2) normalizar modalidad legacy→education (`UPDATE courses SET modality='online' WHERE modality='virtual'` + `'hybrid' WHERE 'hibrido'`, aceptando ambos en el filtro mientras tanto); (3) apuntar el selector de campañas/ofertas a `GET /education/:tenantId/courses` (o dejar `/catalog/courses` GET como alias de solo lectura); (4) borrar la página `/admin/catalog/courses` y su card del hub, conservando campañas y ofertas (que son quienes mantienen vivo `offer_required`); (5) retirar el POST/PUT legacy de catalog al final (expand-contract: primero UI, después endpoints). La regla lee `commercial_offers` + `leads.course_id`; ninguno depende de la página que muere.

### Integraciones

Cero. Sin LMS (Moodle/Classroom), sin videollamada (aunque `course_cohorts.meeting_url` ya existe en el schema, `tenant-schema.sql:2247` — nadie lo llena desde la UI: el modal de cohorte solo tiene `room`), sin pasarela de matrícula. T3.19 no incluyó education.

## 3. La experiencia hoy, contada honestamente

**(a) El dueño en sus primeros 30 minutos.** El alta es digna: elige "Educación", sub-tipo, y sale con Pablo configurado, 6 etapas con nombres del rubro, FAQs, agenda con 3 servicios sensatos y el welcome "Tu centro educativo está listo" (`es.json` `verticalWelcome.education` — education está entre las verticales con clave propia). El primer tropiezo es del checklist: el paso "**Carga tus cursos y programas**" (`verticalChecklist.education.addKnowledgeBase`) apunta a `/admin/knowledge` (`OnboardingChecklist.tsx:29`) — la KB, no `/admin/courses`. El dueño obediente termina con su catálogo como texto RAG: Pablo podrá *hablar* de los cursos pero `get_course_schedule` seguirá vacío y no habrá nada que inscribir — el mismo desvío que el dossier de restaurantes cazó con el menú. Si en cambio descubre "Cursos" en el sidebar, la experiencia es buena: crear curso y colgarle una cohorte funciona a la primera (desde ayer). Lo que no va a poder hacer: registrar una inscripción a mano, marcar una como pagada, ver los tests de nivel que Pablo va creando, o editar una cohorte ya publicada.

**(b) El cliente final por WhatsApp en sus primeros 3 mensajes.** Con catálogo cargado: "Hola, ¿info del curso de inglés B1?" → Pablo saluda, `get_courses`/`get_course_schedule` → "El B1 intensivo arranca el 12 de agosto, lun-mié 18:00, quedan 5 cupos, $450.000" — nivel top del producto. "Quiero inscribirme" → confirma nombre y mail → `enroll_student` → "Listo, quedaste inscrito. El pago queda pendiente para confirmar el cupo". Ahí se acaba la magia: nadie le va a poder cobrar ni confirmar (no hay link de pago, y el dueño no puede marcar pagado). Dónde miente: si pide el **test de nivel online**, Pablo responde eternamente "el link está pendiente, consultá al equipo académico" (el link no puede existir); si **cancela**, le dicen "tu cupo fue liberado" y el cupo NO se libera. Dónde se desvía: "¿tienen **disponibilidad**?" puede caer al motor de citas y recibir de respuesta la agenda de clases de prueba en vez de las cohortes.

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|-------|-----------|-----------|---------|----------|
| 1 | `cancel_enrollment` no devuelve el asiento ni reabre la cohorte `full`; el mensaje al alumno afirma lo contrario | **Alta** (cupos fantasma acumulativos) | `ai-tool-executor.service.ts:3003-3026`; grep `available_seats`: el `+1` solo existe en tours (`tours.service.ts:331,404`) | `UPDATE course_cohorts SET available_seats = available_seats + 1, status = CASE WHEN status='full' THEN 'open' ELSE status END` en el cancel | XS |
| 2 | Inscripciones de solo-lectura: `createEnrollment`/`updateEnrollment` con 0 llamadores — ni walk-in ni marcar pagado | **Alta** (el dinero queda `pending` para siempre) | `api.ts:1648-1651`; grep `api.createEnrollment\|api.updateEnrollment` en dashboard: 0 resultados; `admin/courses/page.tsx:292-344` sin botones | Botón "Inscribir alumno" (cohorte+contacto) + acción "Marcar pagado" / editar estado en la fila | S |
| 3 | Placement test sin salida: ningún escritor de `test_url` en el repo | **Alta** (la tool promete y jamás cumple) | `education.controller.ts` (sin endpoints placement); grep `placement` en `apps/dashboard/src`: solo messages; executor `:2413-2415` | Campo "URL del test de nivel" (por materia o global) + endpoint; o degradar la tool a ofrecer el SERVICIO "Test de nivel" agendable, que sí funciona | S |
| 4 | Checklist manda el catálogo a la KB | Media | `verticalChecklist.education.addKnowledgeBase` = "Carga tus cursos y programas" → href `/admin/knowledge` (`OnboardingChecklist.tsx:29` + `es.json`) | Ítem education-specific apuntando a `/admin/courses` (los 4 JSON) | XS |
| 5 | Carrera en `enrollStudent`: check→INSERT→decremento en 3 statements; doble inscripción con 1 asiento posible | Media | `education.service.ts:218-243` | Decrementar PRIMERO con `WHERE available_seats > 0 RETURNING` y solo entonces insertar (patrón `tours.service.ts:282-283`) | S |
| 6 | Vocabulario de modalidad partido en la misma columna: legacy `virtual/hibrido` vs education `online/hybrid` | Media | `catalog/courses/page.tsx:166-168` vs `admin/courses/page.tsx:71`; filtro `education.service.ts:33` | Normalizar datos + unificar enum en la fusión (§2) | XS |
| 7 | `cancellationReason` se pierde en silencio (sin columna ni clave en el map) | Baja | `ai-tool-executor.service.ts:3017-3020` → `education.service.ts:251-255` | Concatenar en `notes` o agregar columna | XS |
| 8 | KPI "Matrículas Hoy" cuenta citas | Baja | `vertical-definitions.ts:493` (`appointmentsToday`) | Key `enrollmentsToday` (COUNT enrollments del día) o relabel honesto | XS-S |
| 9 | "disponib/reservar" desvían la consulta de cupos al motor de citas | Media | `intent-interpreter.service.ts:336` | Con `tools.education` on, no capturar cuando el texto menciona curso/matrícula; o sumar cohortes al catálogo del interpreter | S |
| 10 | `cancelCohort` deja las inscripciones vivas: nadie avisa a los ya inscritos ni cambia su estado | Media | `education.service.ts:145-153` (solo toca la cohorte) | Al cancelar: marcar enrollments + evento para notificación saliente | S-M |
| 11 | Sin cohort edit (endpoint ni UI): cambiar horario/instructor = cancelar y recrear | Baja | `education.controller.ts:77-89` (solo create/cancel) | `PUT /cohorts/:id` + modal de edición | S |
| 12 | `list_my_enrollments` sigue listando `cancelled` | Baja | `ai-tool-executor.service.ts:3037` (`NOT IN ('dropped','refunded')`) | Agregar `'cancelled'` al exclude | XS |
| 13 | Descripción de `cancel_enrollment` ("pending or enrolled") desincronizada del código (`enrolled\|active`) | Baja | `education-tools.ts:63` vs executor `:3012` | Alinear texto | XS |
| 14 | Sub-tipos sin efecto: ni plantilla ni semillas distintas | Media | `persona.service.ts:2704-2715` sin claves education; bootstrap sin rama education-específica | Sembrar 1-2 cursos ejemplo POR sub-tipo (idiomas: "Inglés A1/B1"; capacitacion: "Excel corporativo"…) — resuelve además el día-1 vacío | S |
| 15 | Agente nuevo desde plantilla nace sin `tools.education` (solo el default del bootstrap lo recibe) | Baja | `persona.service.ts:1815` (`tools: {appointments}`) | Agregar `education: {enabled:true}` a la plantilla | XS |

## 5. Lo que esta industria necesita y no tenemos

El rubro real del research es amplio y consistente entre países: tutoring/preparatorias en México (16,6% CAGR LatAm; "WhatsApp is the enrollment and communication channel of choice", `market-research-latam.md:113`), colegios privados + tutoring en Colombia (`:244`) y Guatemala (`:126`), colegios + **escuelas de idiomas** en Costa Rica (`:181`), tutoring/coaching en Argentina (`:326`) y Brasil — el EdTech de mayor CAGR de LatAm, portugués-first (`:365`). El mercado de tutoría online LatAm: US$637M en 2023 creciendo 16,6% anual (`:399`). La matrícula (y su cobro) es el momento de conversión del rubro; la retención 9/10 del scoring viene de los ciclos académicos recurrentes.

**Mesa de entrada (sin esto no somos creíbles en el rubro):**
- **Cobro de matrícula/mensualidad**: `enrollments.payment_status` y `amount_paid` existen (`tenant-schema.sql:2266-2267`) pero nada los conecta a pagos — ni link de MercadoPago en la confirmación de `enroll_student`, ni registro manual (hueco #2). Hoy el funnel termina en un "pago pendiente" eterno: el paso que el research define como LA conversión del rubro.
- **Recordatorio de inicio de cohorte**: `starts_at` está en la DB; no existe ningún saliente "tu curso arranca mañana a las 18:00, aula 2". Sin esto la deserción pre-inicio es invisible.
- **Test de nivel operativo** (hueco #3): o el link real, o abrazar el servicio agendable que ya funciona. `vertical-strategy.md:128-136` planificaba el pipeline con "Test de nivel" como ETAPA (Interesado → Test de nivel → Inscrito → … → Alumni); lo shippeado la degradó a servicio + tool rota, y la etapa Alumni (el activo de re-venta) desapareció.
- **Brochure por WhatsApp**: `brochure_url` legacy es la pieza que el rubro usa a diario (mandar el PDF del programa) — rescatarla en la fusión, y que Pablo pueda enviarla.

**Diferenciador:**
- **Re-matrícula / progresión de nivel**: el alumno que termina A2 es el lead más caliente de B1. `completion_percent`/`final_grade`/`completed_at` ya existen en enrollments; el evaluador temporal del recall (el mismo motor que piden dental/gimnasios/belleza) aplicado a "cohorte terminó y no se reinscribió" sería el lock-in del rubro — es la retention 9/10 del scoring hecha feature.
- **Cohortes online de verdad**: `meeting_url` existe en el schema y no tiene campo en el modal; llenarlo y entregarlo al inscrito confirmado haría que el sub-tipo `online` deje de ser cosmético.
- **Campañas por curso**: el mundo legacy (campaigns + landings + ofertas por `course_id`, `catalog.service.ts:66-156`, `intake.service.ts`) es en realidad el kit de admisiones que el rubro necesita en temporada de matrículas — está construido y desconectado del módulo education. Reconectarlo (campaña de WhatsApp segmentada a interesados de un curso) es diferenciador barato.
- Integración LMS (Moodle/Classroom) — no existe nada ni está en ningún doc; es apuesta, no mesa de entrada.

## 6. Competencia del rubro

**Ningún competidor del análisis canónico está posicionado en educación.** El barrido de `competitive-analysis-2026-q2.md` (~40 competidores, 31 dimensiones) no arroja NINGUNA mención de education/tutoring/escuelas como vertical atendida por ningún player — las únicas apariciones de "idiomas" son conteos de idiomas soportados por productos de IA (`:207,232,294`). Los generalistas LatAm del análisis (Cliengo, Leadsales, Treble, respond.io, etc.) venden a academias lo mismo que a cualquier PYME: inbox + bot genérico, sin catálogo de cursos, sin cohortes con cupos, sin inscripción transaccional. `vertical-strategy.md:128` ya identificaba "Escuelas de Idiomas / Centros Educativos" como vertical #9 con casi todas las tools hoy construidas (faltó `get_pricing`, cubierta dentro de `get_courses`).

Conclusión honesta: en el mapa competitivo relevado el vertical está **sin dueño**, con demanda #7 y la tercera retención más alta del top-10 (`market-research-latam.md:388`). El riesgo no es un competidor conversacional sino el statu quo (secretaría + Excel + WhatsApp manual) y los CRMs de admisiones no relevados en nuestros docs — no hay evidencia interna sobre ellos, y afirmar más sería inventar. La sección 4 del research (roadmaps por nicho) solo desarrolla los top-5: education no tiene plan de demanda dedicado — coherente con el `docs_estrategia=1` de la matriz de madurez.

## 7. Plan de inversión de ESTA vertical

**Quick wins (días):**
1. Devolver el asiento en `cancel_enrollment` + excluir `cancelled` del listado + alinear la descripción de la tool (huecos 1, 12, 13) — `ai-tool-executor.service.ts`. XS.
2. Checklist education → `/admin/courses` (hueco 4) — 4 JSON + `OnboardingChecklist`. XS.
3. Semillas por sub-tipo: 1-2 cursos + 1 cohorte demo en `bootstrapVertical` (hueco 14) — mata el día-1 vacío. S.
4. Normalizar modalidad + KPI honesto (huecos 6, 8). XS-S.
5. `tools.education` en `tpl_educacion_inscripciones` (hueco 15). XS.

**Mediano (semanas):**
6. Escritura de inscripciones en `/admin/courses`: inscribir walk-in + marcar pagado (hueco 2) — los métodos de `api.ts` ya existen, es solo UI. S-M.
7. Placement test con salida (hueco 3): campo URL + visibilidad para el dueño, o pivot explícito al servicio agendable. S.
8. Fusión de catálogos (§2): `brochure_url`/`code` al modal education, normalización de modalidad, redirect de campañas/ofertas, MATAR `/admin/catalog/courses` sin tocar `offer_required`. M.
9. `enrollStudent` decrement-first (hueco 5) + `cancelCohort` con cascada/notificación (hueco 10) + cohort edit (hueco 11). M.

**Apuesta (si se decide invertir):**
10. **Cobro de matrícula**: link de MercadoPago de pago único (la infra de SMS-créditos ya cobra one-shot con MP) adjunto a la confirmación de `enroll_student`; webhook → `payment_status='paid'` + notificación al dueño. Convierte el circuito en caja. M-L.
11. **Recall de re-matrícula** sobre `completed_at`/`final_grade` con el evaluador temporal compartido con dental/gym/belleza. M.
12. **Recordatorio de inicio de cohorte** (cron sobre `starts_at` + saliente por el canal del contacto) + reconexión de campañas por curso al módulo education. M.

## 8. Qué no se verificó

- **Nada se ejecutó contra una DB viva**: todo es análisis estático. En particular no se verificó que los 5 ALTERs + `DROP NOT NULL` de `b9bd6332` hayan corrido en los schemas de tenants ya existentes (el archivo `tenant-schema.sql` se aplica a schemas nuevos; para los viejos depende del mecanismo de sync de schema en deploy).
- **La conversación real con LLM**: que Pablo efectivamente encadene `get_courses` → `get_course_schedule` → `enroll_student` en el orden correcto es comportamiento de modelo; se verificó que las herramientas llegan al prompt y que los handlers funcionan, no la orquestación en vivo.
- **Semántica transaccional de `executeInTenantSchema`** bajo PgBouncer transaction-mode: se asumió que cada llamada es su propia transacción (base del hallazgo de carrera #5); no se leyó la implementación en `prisma.service.ts` en esta sesión.
- **i18n completo del namespace `courses`** en los 4 JSON (solo se leyó es.json en profundidad).
- El flujo **campañas/ofertas/landings end-to-end** (mundo legacy): se verificaron escritores y lectores de las tablas, no una campaña corriendo.
- **Simulador**: la afirmación de la auditoría de que education no tiene escenarios curados (`simulation.service.ts:330-342`) se tomó del workdir del cluster; no se re-leyó el archivo.
