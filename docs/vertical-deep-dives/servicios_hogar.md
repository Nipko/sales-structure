# Servicios del Hogar — deep-dive (Jul 2026)

## 1. Veredicto y tesis de inversión

**MANTENER — como veterinaria: el código es mejor que su demanda documentada, y la única jugada defendible es cerrar el circuito de emergencia que hoy se auto-sabotea.** Es la ficha más sólida del Tier 3 (20/36): modelo de datos propio con urgencia y despacho (`service_requests`), 3 tools con SQL limpio (esta ronda no encontró ningún patrón tours: 14 columnas / 14 placeholders / 14 params), board dedicado, agregador propio en vertical-analytics. Pero el mercado, según NUESTROS docs, no existe como apuesta: el rubro aparece una sola vez en todo `market-research-latam.md` — #5 del top de Puerto Rico (`:231`, ciclo de recuperación post-huracán, mercado de 3.2M) — cero menciones en `competitive-analysis-2026-q2.md`, y el eje de mercado de la auditoría lo sentenció "fuera del top-10 — OK como tier 3, no invertir". Plomero/electricista por WhatsApp es EL caso de uso informal de LatAm, pero justamente por informal no hay una sola línea de WTP documentada; invertir GTM acá sería repetir turismo. Lo que SÍ hay que arreglar es vergonzoso de simple: el flujo estrella (una fuga de gas) hoy escala a humano ANTES de que la IA pueda registrar el request, con lo cual el listener de emergencias construido en `5c2581db` es inalcanzable en su caso nominal. Y me pronuncio contra la auditoría en un punto: la columna `photos` sentenciada a MATAR es la materia prima de la única feature que haría a esta vertical memorable (cotización por foto), y el 90% del pipeline para poblarla ya existe.

## 2. Radiografía end-to-end

### Alta

- Industria seleccionable en el paso 1 (`onboarding/page.tsx:47`). Sub-tipos **drifteados del registry, vigente**: el alta ofrece plomeria, electricidad, cerrajeria, limpieza, pintura y **multiservicio** (`onboarding/page.tsx:161-168`); el registry define plomeria, electricidad, **fumigacion**, limpieza, **jardineria**, cerrajeria, pintura (`vertical-definitions.ts:634-642`). Fumigación y jardinería no se pueden declarar al registrarse; `multiservicio` se guarda en `settings.subType` y no existe ni en el registry ni en el enum de la tool. Nota atenuante: el enum de `create_service_request` SÍ incluye fumigacion y jardineria (`tier3-tools.ts:19`), así que la IA clasifica bien esos trabajos aunque el alta no los ofrezca.
- Objetivos y audiencias propios y decentes (`onboarding/page.tsx:269-274, 361-366`): "Cotizar servicios", "Agendar visitas del técnico", "Seguimiento y garantía", con audiencias homeowners/renters/administradores/B2B. Los goals ya no eligen plantilla (rama muerta transversal, `persona.service.ts:2686-2707`): siempre gana `templates[0]` = tpl_hogar_cotizador; **tpl_hogar_seguimiento es inalcanzable desde el alta** aunque el goal "support" exista exactamente para eso.

### Agente creado

- ES: **Carlos** (`tpl_hogar_cotizador`, `persona.service.ts:2292-2324`) — reglas operativas buenas (urgencia antes de cotizar, dirección completa, seguridad "no manipule nada"), requiredFields name+phone. Segunda plantilla `tpl_hogar_seguimiento` (`:2326-2352`) para garantía/postventa, bien escrita, nunca elegida.
- EN/PT/FR: `localizeVerticalTemplates` (`persona.service.ts:2618-2656`) reemplaza las 6 reglas de Carlos por el resumen del registry — que en pt es UNA frase ('Sempre capture urgência. Emergências escalam.', `vertical-definitions.ts:659`) y en fr otra. La brecha ES-vs-resto es de las más grandes del catálogo en esta vertical.
- Contradicción de precios vigente (ya anotada por la auditoría, sigue igual): la regla de Carlos "Cotiza con rangos entre $X y $Y" (`persona.service.ts:2310`) convive con el forbidden de Diego "NUNCA inventes precios sin evaluación en sitio" (`vertical-definitions.ts:657,663`) tras el merge de `patchDefaultAgent` (`verticals.service.ts:275-338`: rules de la plantilla se conservan, forbidden se UNEN). Lo fino: no existe NINGUNA fuente de datos de precios que consultar (sin tabla de tarifas, sin tool de cotización), así que cualquier "rango" que dé el LLM es inventado por definición.

### Bootstrap

`verticals.service.ts:133-135`: pipeline + persona + 5 FAQs + `enableSimpleTool('homeServices')` (`:1055-1076`, flag sobre el agente default). `bookingEnabled: true` con `services: []` (`vertical-definitions.ts:692,712`) → se siembran `availability_slots` pero `restoreAppointmentsTool` deja el agendador APAGADO (0 servicios). **Es deliberado y es correcto**: el flujo del rubro es despacho (request → asignar → visita), no slots. Ningún branch por subType: los 6/7 sub-tipos no cambian nada.

### Conversación — tools

| Tool | Qué hace | Gating | ¿Funciona e2e? |
|---|---|---|---|
| `create_service_request` | INSERT en `service_requests` (tipo, urgencia, dirección, problema, fecha preferida) + emite `service_request.created` + responde con shouldHandoff si emergencia (`ai-tool-executor.service.ts:2529-2567`, `home-services.service.ts:51-75`) | `tools.homeServices.enabled` (registro `conversations.service.ts:1893-1895`; simulador `agent-test.service.ts:160`; mutex WRITE_TOOLS `conversations.service.ts:186`) | **SÍ** — SQL limpio (14/14/14, sin patrón tours). PERO en el caso emergencia casi nunca llega a ejecutarse (§3b, hueco #1). `preferredDate` va con `$11::date`: si el LLM manda "mañana" en vez de YYYY-MM-DD el INSERT revienta y la tool devuelve error |
| `check_request_status` | SELECT por id, devuelve status/técnico/fecha (`ai-tool-executor.service.ts:2569-2584`) | idem | **Funciona pero es inalcanzable en la práctica**: exige el UUID que el cliente jamás ve ni recuerda; no hay `list_my_requests` por contacto aunque el índice `idx_service_requests_contact` (`tenant-schema.sql:2417`) existe exactamente para eso. Además: sin check de ownership (cancel sí lo tiene, `:3136`) — cualquier UUID válido devuelve técnico y horario |
| `cancel_service_request` | Cancela si pending/scheduled, con ownership (`ai-tool-executor.service.ts:3132-3152`) | idem | **SÍ, con un void doble**: pasa `notes` con la razón a `updateRequest`, pero el map de columnas no tiene `notes` (`home-services.service.ts:81-91`) **y la tabla no tiene columna notes** (`tenant-schema.sql:2389-2415`) — el motivo de cancelación se descarta en silencio mientras la tool responde éxito (patrón update_pet) |

### Modelo de datos e inventario

`service_requests` (`tenant-schema.sql:2389-2418`): urgencia, dirección con notas, técnico (id UUID + nombre), estados de despacho, 3 índices correctos (status, contacto, urgencia parcial). Dos columnas muertas confirmadas por grep (`service_requests` aparece en solo 4 archivos del API, ninguno las escribe): `assigned_technician_id` (siempre NULL — el modal del board solo escribe el nombre en texto libre) y `photos` JSONB (0 escritores, 0 lectores; §5 para el pronunciamiento).

### Pipeline

Solicitud→Cotización→Agendado→En servicio→Completado→Cancelado (`vertical-definitions.ts:676-683`), con terminal negativo — el mejor embudo del clúster (pipeline 3/3 en la matriz). Dos peros: (a) "Agendado" exige `appointment_required` (`:679`) pero el flujo nativo de la vertical NO crea appointments (el despacho vive en `service_requests`) — instancia local del hueco transversal #6 de la auditoría: la regla pide un artefacto que las propias tools no producen, y el memory confirma que el move manual del board hoy ENFORCEA reglas; (b) **dos embudos paralelos sin costura**: el status del request (pending→quoted→scheduled→dispatched→in_progress→completed, `service-requests/page.tsx:49`) modela lo mismo que el pipeline CRM y no se hablan — completar un request no mueve el lead (grep: `service_requests` no aparece en `pipeline/`).

### Dashboard del tenant

- Board `/admin/service-requests` (`page.tsx`, 278 líneas): orden por urgencia, filtros all/active/emergency, avanzar estado, modal técnico/fecha/costo, resaltado de emergencias >30min pendientes (`:143-146`), auto-refresh 20s (`:78-82`). Gateado por vertical y capability (`AppSidebar.tsx:135`). Detalles: asignar técnico/fecha en el modal NO avanza el status (`:203-214` escribe solo 3 campos → el cliente que consulta ve "pending" con técnico asignado); el operador **no puede cancelar** desde el board (STATUS_FLOW sin cancelled, modal sin botón) — solo el cliente por chat.
- KPI **"Emergencias" sigue mintiendo** (fix XS conocido, confirmado vigente): el registry etiqueta `leadsHot` como Emergencias (`vertical-definitions.ts:707`) y `admin/page.tsx:74-84` sirve el leadsHot genérico (leads calientes por scoring). La cifra real existe — `emergencias30d` del agregador (`vertical-analytics.service.ts:481-486`) — pero solo la ve el super_admin.
- `verticalWelcome` ya existe en 4 idiomas (post-`b9bd6332`, `es.json:6115`); `verticalChecklist` sigue SIN entrada (11 industrias + default) → checklist genérico.
- ToolsTour (`ToolsTour.tsx:77-80`) manda a `/admin/service-requests` ✓ y a `/admin/appointments` — una página de citas que esta vertical mantiene apagada y sin servicios.

### Analytics de plataforma e integraciones

- Agregador propio sólido (`vertical-analytics.service.ts:469-491`: requests30d, emergencias30d, pending, completed, completionRatePct) + métrica primaria (`:639`). BIEN.
- **Activación falsa**: `detectActivationGaps` chequea `services` con `is_active=true` (`:126`) — la tabla que esta vertical deja vacía A PROPÓSITO (`services: []`). Todo tenant de hogar, incluso uno despachando 50 requests/mes, figura eternamente como "signed up but never finished setup" para ops. Debería contar `service_requests`.
- Integraciones del rubro: cero (nada tipo Jobber/Housecall Pro, sin rutas/mapas). Toast/Mindbody/Cliniko no aplican.

## 3. La experiencia hoy, contada honestamente

**(a) El dueño en sus primeros 30 minutos.** De lo mejor del Tier 3: elige "Servicios del hogar", su sub-tipo (salvo que fumigue o haga jardines — no están), y sale con Carlos configurado con reglas sensatas, 5 FAQs honestas que no inventan políticas, un pipeline que refleja su negocio real y un board de despacho con semáforo de urgencias en el sidebar. El saludo del panel ya lo reconoce ("Bienvenido a tu central de servicios"). Lo que no ve: el checklist es el genérico (le pide pasos de un negocio cualquiera), el tour le muestra una página de citas que su vertical no usa, y nada le dice que "asignar técnico" será para siempre un campo de texto libre. Si es extranjero (EN/PT/FR), su Carlos pierde las 6 reglas y queda con una frase.

**(b) El cliente final por WhatsApp en sus primeros 3 mensajes.** El caso normal brilla: "se me tapó el lavaplatos" → Carlos pregunta urgencia, dirección, ciudad, descripción → `create_service_request` → "te contactamos para confirmar fecha". El request aparece en el board ordenado por urgencia. Honesto y funcional. El caso estrella — la emergencia — se cae de la forma más irónica posible (hueco #1): decir "fuga de gas" o "es una emergencia" escala a humano ANTES de que la IA exista en el turno; el que describe el desastre sin las palabras mágicas ("sale agua a chorros del calefón") sí llega a la tool, al board y al email de emergencia. Y el tercer mensaje del día siguiente — "¿ya viene el técnico?" — muere: `check_request_status` necesita un UUID que nadie tiene. Donde miente: la cotización. Carlos tiene instrucción de dar rangos y ningún dato de dónde sacarlos; si el cliente manda la foto de la fuga, la visión la describe para el LLM (`media-processing.service.ts:130-148`) pero la imagen se descarta — el técnico nunca la verá.

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **La emergencia se come a sí misma**: los triggers efectivos incluyen 'emergencia' pelada, 'fuga de gas', 'inundación', 'cortocircuito', 'peligro' (registry `vertical-definitions.ts:669` split por '|' y unido con dedup a los de Carlos — `verticals.service.ts:332-335, 370-373, 392-403`); `shouldHandoff` corre ANTES de la IA (`conversations.service.ts:590-617`) por substring (`handoff.service.ts:107-109`) → el turno escala a humano SIN crear el request: el listener de `5c2581db` jamás dispara en su caso nominal, el board no se entera, el humano recibe un chat sin dirección ni datos. El `afterHoursMessage` (`:695`) encima instruye escribir "EMERGENCIA". Y la FAQ sembrada '¿Atienden emergencias 24/7?' (`:686`) contiene el trigger: preguntar la FAQ escala a humano | **P0 del caso central** | archivos citados | Sacar 'emergencia'/'fuga de gas'/'inundación'/'cortocircuito' de los handoffTriggers de registry y Carlos: la escalación de emergencia debe ocurrir DESPUÉS de la tool (el listener ya emailea; agregar handoff post-tool consumiendo el `shouldHandoff` que hoy nadie lee, `ai-tool-executor.service.ts:2562`) | S |
| 2 | El listener de emergencias no alcanza: solo `urgency=emergencia` (`service-request.listener.ts:27`) — las `alta` ("mismo día", `tier3-tools.ts:24`) no notifican a nadie; email-only, sin WebSocket → el board sigue enterándose por su refresh de 20s (`page.tsx:78-82`) | Media | archivos citados | Incluir `alta` con asunto distinto (o solo emergencia+alta fuera de horario); emitir evento al gateway del inbox (patrón `handoff.escalated`) | S |
| 3 | Razón de cancelación al void doble: el executor manda `notes` (`ai-tool-executor.service.ts:3143-3146`), el map de `updateRequest` no la tiene (`home-services.service.ts:81-91`) y la tabla no tiene la columna (`tenant-schema.sql:2389-2415`); éxito silencioso | Baja (dato perdido) | archivos citados | Guardarla en `metadata` JSONB (existe) o agregar columna + map | XS |
| 4 | `check_request_status` inutilizable en conversación nueva (exige UUID) y sin ownership (asimetría con cancel `:3136`) | Media | `ai-tool-executor.service.ts:2569-2584` | Tool `list_my_requests` por `contact_id` (el índice `:2417` ya existe; espejo de `list_my_claims` de seguros) + ownership en el check | S |
| 5 | Activación falsa en ops: chequea `services` que la vertical siembra vacía a propósito | Media (ruido operativo permanente) | `vertical-analytics.service.ts:126` vs `vertical-definitions.ts:692` | Cambiar el check a `service_requests` (sin activeFilter) | XS |
| 6 | KPI "Emergencias" = leads calientes (confirmado vigente) | Media (número que miente en la home) | `vertical-definitions.ts:707` + `admin/page.tsx:74-84` | COUNT de `service_requests` urgency=emergencia del día en getCommercialOverview cuando industry=servicios_hogar, o renombrar el label | XS-S |
| 7 | `appointment_required` en "Agendado" exige un artefacto que el flujo nativo no produce (despacho ≠ appointments); move manual del board queda bloqueado | Media | `vertical-definitions.ts:679`; instancia del transversal #6 | Cambiar la regla por una `service_request_required`-like o quitarla; alternativa barata: que asignar `scheduled_at` en el board satisfaga la transición | S |
| 8 | Dos embudos paralelos sin costura: status del request y pipeline CRM no se sincronizan | Media | `page.tsx:49` + grep `service_requests` ∉ `pipeline/` | Al completar/cancelar request, mover el lead vinculado (via `contact_id`) al stage espejo | M |
| 9 | Sub-tipos drifteados: alta sin fumigacion/jardineria, con multiservicio inexistente en registry/enum | Baja (cosmético hoy, trampa si algún día hay branch) | `onboarding/page.tsx:161-168` vs `vertical-definitions.ts:634-642` | Consumir `GET /verticals/definitions/all` (ítem transversal ya decidido); mientras: sumar las 2 claves y decidir multiservicio | XS |
| 10 | Asignar técnico/fecha no avanza el status; el operador no puede cancelar desde el board | Baja | `page.tsx:203-214, 49` | Auto-avance a `scheduled` al setear fecha+técnico; botón cancelar en el modal | S |
| 11 | Los "rangos" de cotización de Carlos no tienen fuente de datos: cualquier cifra es alucinada | Media | `persona.service.ts:2310` vs `vertical-definitions.ts:657` + sin tabla/tool de tarifas | Quitar la regla de rangos (alinear con Diego), o sembrar tarifas base por serviceType y una tool `get_service_rates` | XS (quitar) / M (tarifas) |
| 12 | EN/PT/FR pierden las reglas de Carlos (localización reemplaza por 1 frase del registry) | Baja-media | `persona.service.ts:2618-2656`, `vertical-definitions.ts:659-660` | Engordar rules pt/fr/en del registry para esta vertical (solo contenido) | XS |
| 13 | `verticalChecklist` sin entrada servicios_hogar (cae al genérico) | Baja | `es.json` verticalChecklist: 11 claves + default | 1 entrada × 2 namespaces × 4 idiomas | XS |

Lo que está BIEN y se dice igual de claro: el SQL de `home-services.service.ts` es de los más limpios de la ronda (placeholders/params correctos en INSERT y UPDATE dinámico, `::uuid` casts, LIMIT clampeado); el modelo request-no-slots es la decisión de diseño correcta para el rubro; el board con semáforo de >30min es útil de verdad; el agregador de plataforma está completo; las 5 FAQs post-fix no prometen nada que el negocio no confirmó.

## 5. Lo que esta industria necesita y no tenemos

**Mesa de entrada** (sin esto no somos creíbles en el rubro):
- **Emergencia que funciona de punta a punta**: registro estructurado + humano notificado en vivo (huecos #1-2). Hoy tenemos las dos mitades y un orden de evaluación que impide que se toquen.
- **Seguimiento consultable**: "¿ya viene el técnico?" es EL segundo mensaje del rubro (hueco #4).
- **Directorio de técnicos**: la asignación por texto libre funciona para el plomero solo; una empresa con 4 técnicos necesita al menos una lista con nombre+teléfono. **El veredicto MATAR de staff-scheduling NO deja huérfana a esta vertical**: el despacho no necesita disponibilidad/conflictos/breaks (eso era el módulo roto), necesita un directorio. QW: autocompletar desde `DISTINCT assigned_technician_name`; S: lista mínima de técnicos (en settings o tabla chica) que escriba por fin `assigned_technician_id`.
- Tarifas base por tipo de servicio (o quitar la promesa de rangos) — hueco #11.

**Diferenciador** (la única apuesta que justificaría más que mantenimiento):
- **Cotización por foto**. Acá contradigo la sentencia MATAR de la columna `photos` (`vertical-maturity-audit-2026-07.md` §6): (a) este rubro VIVE de "mandame una foto de la fuga" — la propia auditoría lo escribió ("la foto del problema es el 50% de la cotización"); (b) la plantilla de seguimiento ORDENA "Captura fotos si el cliente reporta un problema" (`persona.service.ts:2345`) — una promesa de producto ya escrita; (c) el pipeline está al 90%: la imagen entrante YA se descarga y describe (`media-processing.service.ts:130-131`) y el audio YA se persiste con `media.saveBuffer` + metadata (`:54-79,128`) — persistir la imagen es clonar ese best-effort, y poblar `photos` con la URL en `createServiceRequestTool` (adjuntando las últimas imágenes de la conversación) + renderizarlas en el modal del board es S-M, no L. Mi posición: si la decisión del dueño es hogar-mínimo, ejecutar el MATAR (coherencia); si se quiere UNA jugada en esta vertical, esta es, y la columna es su pieza — borrar ahora y recrear en 3 meses sería la clase de vaivén que el expand-contract encarece.
- Recurrencia (limpieza semanal/quincenal): no existe en `service_requests` ni en el motor — es el mismo hueco de recurrencia de gimnasios/belleza; la limpieza recurrente es un contrato, no N requests. Solo con demanda comprobada.
- `slaHours` sembrado (la cadena existe entera; hogar es el caso de uso obvio — ya está en el plan transversal, `vertical-maturity-audit-2026-07.md` §6).
- Rutas/zonas de cobertura: la FAQ "¿trabajan en mi zona?" responde "cuéntame tu dirección" y nadie valida nada. El ruteo por zonas de inmobiliaria (backend completo, muerto) sería reutilizable — solo si el rubro escala.

## 6. Competencia del rubro

Nuestros docs no registran NINGÚN competidor de home services: cero menciones en `competitive-analysis-2026-q2.md` (grep: hogar/plomer/Jobber/Housecall sin matches) y `vertical-strategy.md:171-173` define la vertical sin citar rivales. Los Jobber/Housecall Pro del mundo (nombrados solo en el workdir de la auditoría como "lo que no hay") son SaaS de field-services anglo, sin foco WhatsApp-LatAm — no compiten por nuestro cliente. La lectura honesta: no hay quien "gane este vertical hoy en LatAm" en nuestra evidencia porque el rubro opera en WhatsApp personal + libreta; nuestro competidor real es el cuaderno del plomero. Eso corta en dos direcciones: mercado sin dueño, y mercado que nunca demostró pagar — `market-research-latam.md` solo lo rankea en Puerto Rico (`:231`) y el eje de mercado lo dejó "fuera del top-10". Sin investigación de WTP nueva, no hay caso para GTM.

## 7. Plan de inversión de ESTA vertical

Coherente con MANTENER: cerrar el circuito central, no ampliar la superficie.

**Quick wins (días):**
1. Sacar las palabras de emergencia de los handoffTriggers (registry + Carlos) y escalar POST-tool consumiendo `shouldHandoff` — `vertical-definitions.ts:669`, `persona.service.ts:2315`, `ai-tool-executor.service.ts:2562` (S). Es el fix que hace que todo lo demás (tool, evento, listener, board) sirva en el caso para el que existe.
2. Listener: incluir `urgency=alta` + evento WebSocket al inbox — `service-request.listener.ts:27` (S).
3. Activación por `service_requests` — `vertical-analytics.service.ts:126` (XS). KPI Emergencias real o renombrado — `admin/page.tsx` (XS-S). Razón de cancelación a `metadata` — `home-services.service.ts:91` (XS).
4. Quitar "Cotiza con rangos" de Carlos — `persona.service.ts:2310` (XS). Sub-tipos: +fumigacion/jardineria, −multiservicio — `onboarding/page.tsx:161-168` (XS). Checklist + rules pt/fr (contenido, XS).

**Mediano (semanas):**
5. `list_my_requests` por contacto + ownership en el status check (S) — desbloquea el "¿ya viene?".
6. Regla de "Agendado" compatible con despacho + sync request→pipeline al completar/cancelar (S+M).
7. Directorio mínimo de técnicos (datalist primero, tabla chica después) que escriba `assigned_technician_id` (S); auto-avance de status al asignar (S).

**Apuesta (solo si el dueño decide que hogar es vitrina):**
8. Cotización por foto: persistir imagen entrante (clonar `persistInboundAudio`), adjuntar a `photos` en el create, galería en el modal del board (S-M total). Revertiría el MATAR de la columna — decisión explícita del dueño, no default.
9. Tarifas base por serviceType + `get_service_rates` (M). Recurrencia de limpieza: NO, hasta ver demanda.

## 8. Qué no se verificó

- Nada se ejecutó contra una DB real: el comportamiento de `$11::date` con entradas no-ISO, el enforcement efectivo de `appointment_required` en el move manual del board para ESTE registry, y el orden handoff-antes-que-IA se razonaron del código (`conversations.service.ts:590` es explícito, pero no se simuló una conversación).
- No se probó el listener de emergencias en vivo (SMTP) ni se midió si el email llega en <1min.
- La afirmación "0 escritores de `photos`/`assigned_technician_id`" sale de grep sobre `apps/api/src` + el board; no se auditó `apps/mobile`.
- WTP del rubro: solo se afirmó lo que los docs dicen (y no dicen); no hubo research nuevo.
