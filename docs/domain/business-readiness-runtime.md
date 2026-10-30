# Preparación del negocio en tiempo de ejecución (R2–R7)

Cómo usa la plataforma la especificación (`packages/business-spec`) para decir si un tenant está listo para atender, y cómo se guardan los valores del negocio con su procedencia. Diseño: C0 §1.1, §2.1, §2.2, §2.5, §2.7, §2.9, §4.1 y §5 R2–R3. Decisiones de construcción: [ADR 0004](../decisions/0004-panel-de-preparacion-r2.md) (R2), [ADR 0007](../decisions/0007-procedencia-y-valores-del-negocio-r3.md) (R3, procedencia), [ADR 0008](../decisions/0008-formularios-del-panel-r3.md) (R3, formularios) , [ADR 0009](../decisions/0009-unificacion-horario-politicas-identidad-r3b.md) (R3b, lo que lee el agente), [ADR 0010](../decisions/0010-control-de-salida-y-contrato-del-turno-r4.md) (R4: contrato del turno, control de salida y `WRITE_MODE`), [ADR 0011](../decisions/0011-bucle-de-conocimiento-pendiente-r5.md) (R5: conocimiento pendiente) y [ADR 0012](../decisions/0012-copiloto-de-onboarding-r6.md) (R6: copiloto de onboarding).

## Flujo

```
GET /readiness/:tenantId[?refresh=1]
  └─ ReadinessService
       ├─ Redis readiness:{tenant}:{spec_version} (10 min) ── si está y no hay refresh → respuesta
       ├─ SnapshotReader (un SELECT en transacción READ ONLY; sin columnas sensibles)
       │     filas de hoy + requirement_values + columnas de procedencia (si el tenant ya las tiene)
       ├─ fromLegacyRows → evaluate(spec, foto, ahora)           ← @parallext/business-spec, puro
       │     procedencia real donde vale; reglas L1–L7 para el resto
       ├─ readiness_evaluations: INSERT solo si result_hash cambió
       ├─ R4: buildTurnContract(spec, foto, resultado) → Redis readiness:contract:{tenant}:{spec_version} (misma vida)
       └─ eventos readiness.evaluated / readiness.verdict_changed

PUT /readiness/:tenantId/business-facts/:requirementId
  └─ BusinessFactsService.write()
       ├─ validateRequirementValue(spec, id, valor)               ← el paquete; 400 con `issues` si no cumple
       ├─ R3b: proyección al almacenamiento de hoy (horario, políticas, identidad) en la MISMA transacción
       ├─ UNA sentencia: requirement_values (version + 1) + requirement_value_versions (con actor)
       └─ evento business_fact.written → cachés de preparación y del agente

Turno del agente (R3b)
  └─ BusinessFactsReader.hours() / policy() / notOffered() / identity()
       ├─ fuentes: public.tenants + companies (is_primary) + policies activas + requirement_values (RUNTIME_FACT_IDS)
       └─ resolveBusinessHours / resolvePolicy / resolveNotOffered / resolveIdentity  ← @parallext/business-spec, puro
            misma regla que la foto: valor del dueño vigente, si no el almacenamiento de hoy tal cual

Mensaje entrante de un canal real (R4)
  └─ GoLiveService.check()  ← decideGoLive: publicado → atiende; no publicado → no (salvo lista blanca)
       ├─ go_live_decisions: una fila por mensaje (sombra y aplicado)
       └─ bandera readiness.goLiveGate apagada (sombra): sigue igual · encendida: aviso fijo + bandeja humana

Turno del agente (R4), también en Agent Test
  ├─ ReadinessContextService.forTurn() → <knowledge_status> en la capa 3; la regla 20 del contrato L1 dice qué hacer
  └─ EffectiveCapabilityService: writeModeDecision (WRITE_MODE por objeto) junto a la exclusión vieja
       └─ bandera readiness.writeModeCapability apagada (sombra): solo registra · encendida: saca los escritores

Conocimiento pendiente (R5)
  ├─ búsqueda de conocimiento sin resultado relevante → pending_questions (gap; +1 ocurrencia por tema)
  ├─ <offers pending_question="true"> → TurnCapabilityComposer publica register_pending_question
  │     cliente «sí» → el agente la llama → PendingQuestionsService.acceptWait: espera + open + SLA
  │     (Agent Test, evaluación y borradores: en seco, sin fila ni aviso)
  └─ dueño en /admin/readiness/pending
        ├─ responder una vez → answered
        ├─ guardar como dato → BusinessFactsService.write (owner_form, source_ref.via=pending) → stored + reevaluación
        └─ PendingAnswerNotifier, por espera: ProactiveDispatchService (autoridad pending_answer_ready), en su idioma,
             solo dentro de la ventana de 24 h (fuera: template_required)
```

- **Una sola regla.** El veredicto, los huecos y su nivel los decide el motor. La API solo lee, guarda y sirve; el panel solo agrupa. `readiness:report` (CLI) y el panel dan el mismo veredicto sobre la misma foto (lo prueban `readiness.service.spec.ts` y `readiness-panel.spec.ts` con las 7 fotos golden).
- **`resultHash`** identifica el contenido del resultado, sin la hora: el historial tiene una fila por cambio real.
- **Caché.** Se invalida con `agent.config.updated`, `agent.version.updated` y `business_fact.written`. Las pantallas de catálogo de hoy no avisan: el panel siempre reevalúa al abrirse.

## API

| Método | Ruta | Roles | Uso |
|---|---|---|---|
| GET | `/readiness/:tenantId` | super_admin, tenant_admin, tenant_supervisor | Última evaluación (`{evaluationId, evaluatedAt, trigger, cached, result, formRequirementIds, screenTargets}`); `?refresh=1` reevalúa |
| GET | `/readiness/:tenantId/history?limit=30` | ídem | Una fila por resultado distinto: veredicto, conteos, bloqueantes, `trigger`, fecha |
| GET | `/readiness/:tenantId/requirements/:requirementId` | ídem | Lo que abre el cajón: definición, evaluación actual, descriptor de formulario (`form`), valor que lee el motor con su procedencia (`current`, también heredado) y fila de `requirement_values` con su versión (`fact`) |
| GET | `/readiness/:tenantId/snapshot` | super_admin | Foto `business-spec/tenant-snapshot@1` para `business-spec qa-truth` |
| GET | `/readiness/:tenantId/business-facts` | super_admin, tenant_admin, tenant_supervisor | Todos los valores con procedencia del tenant |
| GET | `/readiness/:tenantId/business-facts/:requirementId?scope=` | ídem | Un valor (alcance `''` por defecto) |
| GET | `/readiness/:tenantId/business-facts/:requirementId/versions` | ídem | Sus versiones: valor, estado, origen, actor y fecha |
| PUT | `/readiness/:tenantId/business-facts/:requirementId` | super_admin, tenant_admin | `{value, scopeKey?, expectedVersion?}` → escribe con `origin=owner_form`, confirmado; responde el valor y el delta (`verdictBefore`, `verdictAfter`, evaluación del requisito). 400 si no cumple la especificación, 409 si `expectedVersion` quedó vieja |
| GET | `/readiness/:tenantId/business-facts/defaults` | super_admin, tenant_admin, tenant_supervisor | Requisitos del tenant con `predicate_kind: default_accepted`: pregunta, qué hace el default (`when_missing.behavior`) y estado (`accepted`, `configured`, `pending`) |
| POST | `/readiness/:tenantId/business-facts/defaults/accept` | super_admin, tenant_admin | `{ids[], specVersion}` → acepta los valores por defecto (§2.5); 409 si `specVersion` no es la vigente |
| GET | `/readiness/:tenantId/go-live?days=7` | super_admin, tenant_admin, tenant_supervisor | Control de salida (R4): `state` (`off`/`on`), cuándo y quién, `ack`, `mode` (`shadow`/`enforce`), la decisión de hoy, la última registrada y el informe de sombra (`summary`: total, `wouldBlock`, `byReason`) |
| POST | `/readiness/:tenantId/go-live` | super_admin (suplantando), tenant_admin | `{ack?: string[]}` → publica. 409 con `blockingGaps` si `no_listo`; si `limitado`, 409 con `limitedIntents` y `missing` hasta que `ack` las traiga todas |
| POST | `/readiness/:tenantId/go-live/off` | super_admin (suplantando), tenant_admin | Despublica |
| GET | `/readiness/:tenantId/pending?status=active` | super_admin, tenant_admin, tenant_supervisor | Bandeja de conocimiento pendiente (R5): `items` (pregunta, requisito, demanda, esperas, SLA, `overdue`) y `counts` por estado más `overdue`. `status`: `active` (gap + open), un estado o `all` |
| GET | `/readiness/:tenantId/pending/:id` | ídem | Una consulta con sus esperas (`notifyStatus` de cada una) |
| POST | `/readiness/:tenantId/pending/:id/answer` | super_admin (suplantando), tenant_admin | `{mode:'once', text}` → `answered`; `{mode:'store', value, expectedVersion?, scopeKey?, text?}` → escribe el requisito por BusinessFactsService, reevalúa (devuelve el delta como el `PUT`) y deja `stored` todas las abiertas del requisito. Las dos avisan a las esperas y devuelven `notified` |
| POST | `/readiness/:tenantId/pending/:id/dismiss` · `…/close` · `…/notify` | super_admin (suplantando), tenant_admin | Descartar (sin aviso), cerrar lo respondido, reintentar el aviso de las esperas que quedaron `waiting` |
| POST | `/readiness/:tenantId/copilot/run` | super_admin (suplantando), tenant_admin | Copiloto (R6): «Analizar mis fuentes». Devuelve `{runId, model, sources, targets, proposed, contradictions, questions, discarded[], note}`; 429 `copilot_daily_cap` tras 10 ejecuciones en 24 h |
| GET | `/readiness/:tenantId/copilot/proposals?status=open` | super_admin, tenant_admin, tenant_supervisor | Propuestas del copiloto (`open` = `proposed`, un estado o `all`) con `counts` por estado; cada una con `kind`, requisito, valor, valor de hoy, versiones, pregunta, evidencia, ejecución y caducidad |
| GET | `/readiness/:tenantId/copilot/proposals/:id` | ídem | Una propuesta |
| POST | `/readiness/:tenantId/copilot/proposals/:id/approve` | super_admin (suplantando), tenant_admin | `{value?, expectedVersion?}` (con `value` = editar y aprobar) → escribe por BusinessFactsService con `origin=copilot` y la propuesta en `source_ref`; responde como el `PUT` del cajón más `proposal`. 409 si no está abierta; 400 si es una pregunta o una contradicción entre fuentes sin `value` |
| POST | `/readiness/:tenantId/copilot/proposals/:id/reject` | super_admin (suplantando), tenant_admin | `{note?}` → `rejected`, con quién y cuándo |
| POST | `/readiness/:tenantId/rehearsal/runs` | super_admin, tenant_admin | Ensayo (R7): `{agentId?, seed?, maxCases? (≤ 40), languages?, repeatOf?}` → crea la ejecución con su banco congelado y la corre en segundo plano. 409 si ya hay una en curso o no hay agente activo, 429 con 6 ensayos en el día |
| GET | `/readiness/:tenantId/rehearsal/runs` · `…/runs/:id` | super_admin, tenant_admin, tenant_supervisor | Ejecuciones (estado, progreso, tasa de aciertos, costo) y el informe de una: resultados por caso con la conversación, los chequeos, la clase del fallo y pass^k del mismo banco |

Una escritura de `super_admin` exige suplantación: el actor guarda el usuario efectivo y la delegación (`auditActor`), nunca solo uno de los dos.

## Almacenamiento

- `readiness_evaluations` (por tenant): `id`, `spec_version`, `snapshot_hash`, `result_hash`, `verdict` (`no_listo|limitado|listo`), `counts`, `result` (el `ReadinessResult` completo), `trigger` (`on_demand|refresh|invalidated`), `created_at`. Migración `20261030120000_add_readiness_evaluations`.
- `requirement_values` (por tenant, R3): una fila por `(requirement_id, scope_key)`. `value` tiene la forma de `data.structure` del requisito (`[]` = «no hay», confirmado); `status` `confirmed|example|seeded`; `origin` (`owner_form`, `copilot`, `import`, `integration`, `country_pack`, `default_accepted`, `pending_answer` y, solo desde la migración, `onboarding`, `platform_seed`, `legacy`, `legacy_inferred`); `confirmed_by`, `confirmed_at`, `source_ref`, `valid_until`, `spec_version`, `version`, `updated_at`. *Ausente*, *contradictorio* y *caducado* no se guardan: los calcula el motor.
- `requirement_value_versions` (append-only): la misma forma más `value_id`, `actor` (`{kind:'user', userId, role, delegation?}` o `{kind:'script', name}`) y `created_at`. Una fila por escritura.
- Columnas de procedencia (R3, C0 §2.2) en `services`, `menu_items`, `products`, `tour_packages`, `properties`, `real_estate_listings`, `courses`, `membership_plans`, `insurance_plans`, `vehicles`, `faqs` y `knowledge_documents`: `content_status` (default `confirmed`), `origin`, `confirmed_by`, `confirmed_at`, `source_ref`; en las tablas con precio, `price_type` (`fijo|desde|a_cotizar|gratis`) y `price_status` (`confirmed|example`). `services` y `membership_plans` conservan su `price_status` de antes (`confirmed|example|quote`, lo escriben sus pantallas): solo reciben `price_type`. Los paquetes de fotografía y el catálogo de servicios del hogar viven en `services`. La lista es `PROVENANCE_TABLES` del paquete.
- Las crea `tenant-schema.sql` y, en los tenants existentes, la migración `20261030140000_add_business_facts_provenance` (aditiva). `business-facts-schema.spec.ts` exige que las dos definiciones y `PROVENANCE_TABLES` coincidan.
- R4: `public.tenants.go_live_state` (`off`/`on`, default `off`), `go_live_at`, `go_live_by`, `go_live_spec_version`, `go_live_ack` (el reconocimiento de «limitado»); y `go_live_decisions` por tenant: `channel_type`, `conversation_id`, `mode` (`shadow`/`enforce`), `serve`, `reason`, `go_live_state`, `verdict`, `spec_version`, `created_at`. Migración `20261030160000_add_go_live_gate` (aditiva); `go-live-schema.spec.ts` exige que `tenant-schema.sql` y la migración coincidan.
- R5: `pending_questions` por tenant (C0 §2.6): `requirement_id`, `item_ref`, `intent_id`, `topic_key` (`req:<id>[#<ítem>]` o `q:<hash>` de la pregunta normalizada), `sample_question`, `sample_conversation_id`, `language`, `source` (`agent`/`retrieval`), `status` (`gap|open|answered|stored|closed|dismissed`), `occurrences`, `waiters_count`, `first_seen_at`, `last_seen_at`, `sla_due_at`, `answered_by`, `answered_at`, `answer_text`, `stored_value_id`, `closed_at`, `updated_at`; índice único parcial `(topic_key) WHERE status IN ('gap','open')`. `pending_question_waiters`: `pending_question_id`, `conversation_id`, `contact_id`, `language`, `accepted_at`, `notified_at`, `notify_status` (`waiting|sent|template_required|opted_out|skipped_human|skipped_closed|no_channel|sandbox|failed|dismissed`), `notify_detail`; una por `(pending_question_id, conversation_id)`. Migración `20261030180000_add_pending_questions` (aditiva); `pending-questions-schema.spec.ts` exige que coincidan. Solo escribe `PendingQuestionsService` (y el hueco de la búsqueda, con su misma sentencia `recordGapStatement`). `kb_unanswered_queries` queda sin escritores ni lectores y con sus filas: su `DROP` es una tarea del dueño (ADR 0011 §8).
- R6: `agent_content_proposals` (el ledger de Assist) gana `requirement_id`, `target_ref`, `evidence`, `extraction_run_id`, `decided_by`, `decided_at`, `decision_note` y los estados `rejected` y `superseded`; `requirement_values` gana el CHECK `requirement_values_copilot_confirmed` (`origin=copilot` exige `status=confirmed` y `confirmed_by`, `NOT VALID`). Migración `20261030200000_extend_agent_content_proposals_copilot` (aditiva); `copilot-proposals-schema.spec.ts` exige que coincida con `tenant-schema.sql`.
- R7: `rehearsal_runs` por tenant: `agent_id`, `status` (`running|completed|stopped|failed|interrupted`), `seed`, `spec_version`, `snapshot_hash`, `bank_hash`, `bank` (el banco congelado), `repeat_of`, `attempt`, `case_count`, `completed_count`, `summary`, `pass_rate`, `models`, `input_tokens`, `output_tokens`, `judge_calls`, `judge_tokens`, `cost_usd`, `error`, `requested_by`, `started_at`, `completed_at`. `rehearsal_results`: `run_id`, `case_key`, `intent_id`, `requirement_ids`, `item_id`, `language`, `expected`, `value_state`, `outcome` (`answered|missing_data|wrong|inconclusive|error`), `miss_class` (`dato|producto`), `decided_by`, `reason`, `turns`, `tool_calls`, `checks`, `judge`, `model`, tokens y `latency_ms`; uno por `(run_id, case_key)`. Migración `20261030200000_add_rehearsal_runs` (aditiva); `rehearsal-schema.spec.ts` exige que coincidan. Solo escribe `RehearsalService`; son salida de la evaluación (`EVALUATION_OUTPUT_TABLES`).

**Única puerta de escritura.** `requirement_values` solo lo escribe `BusinessFactsService` (sus sentencias viven en `business-facts.statements.ts`, sin Nest ni Prisma, para que la migración use el mismo SQL). `business-facts-writes.spec.ts` falla con cualquier `INSERT` o `UPDATE` sobre `requirement_values` fuera de esos dos archivos y con cualquier `UPDATE`, `DELETE` o `TRUNCATE` sobre `requirement_value_versions`.

**Validación** (`validateRequirementValue`, en el paquete): requisito escribible (no catálogo, no derivado, no de plataforma), origen admitido por `sources.allowed`, `seeded` solo con `platform_seed`, alcance (`''`, `location:`, `object:`, `item:`), forma de `data.structure` (campos conocidos; las políticas admiten además `summary` y `title`, el horario `timezone`), `requerido`, `bool` y `enum`/`enum_list` cerrados. El resto de `data.validation` (prosa) lo aplica el evaluador al calcular la preparación.

**Aceptar defaults (§2.5).** Una fila por requisito con `predicate_kind: default_accepted`, `origin=default_accepted`, `value = null` (el default de la plataforma para esa `spec_version`) y la `spec_version` vigente. No pisa un valor que el negocio ya configuró.

## Cómo lee la foto la procedencia

- **Ítems y textos.** Una fila tiene procedencia real si trae `origin` y `content_status`, y `source_ref.row_updated_at` coincide con su `updated_at`. El `content_status` solo no prueba nada (su default de columna es `confirmed`). Si una pantalla que no conoce estas columnas edita la fila, su `updated_at` cambia y la fila vuelve a las reglas L (L6: editada → confirmada). Las listas vacías por defecto de columna (L4: `allergens`, `includes`, `required_fields`…) siguen sin contar como «vacío confirmado» también con procedencia real. Un `price_status = example` manda en cualquier tabla: un precio de ejemplo nunca cuenta como confirmado, aunque la fila declare `price_type`.
- **Valores.** Una fila de `requirement_values` escrita por `BusinessFactsService` manda sobre todo lo que dedujeron las reglas para ese requisito y alcance. Una fila **migrada** (`source_ref.migrated_from` + `migrated_hash`) reemplaza solo al valor heredado del que salió, y solo mientras ese almacenamiento conserve el valor migrado; si cambió después (sus pantallas siguen vivas hasta R3b), la copia se ignora y manda la lectura con reglas L. Los demás valores heredados del mismo requisito se siguen leyendo, así que una contradicción entre dos almacenamientos sigue a la vista.
- **Valores proyectados (R3b).** Una fila escrita por `BusinessFactsService` con `source_ref.projected_to` y `projected_hash` manda como cualquier valor del dueño mientras el almacenamiento `projected_to` siga diciendo lo que la proyección escribió (misma huella de lo que la foto lee de ahí, también cuando no lee nada). Si una pantalla vieja lo editó después, la fila se ignora y manda la lectura con reglas L.
- `snapshot.source.notes` cuenta cuántas filas y valores usaron procedencia real y cuántas copias migradas o proyecciones editadas se ignoraron.

## Lo que lee el agente (R3b)

Diseño: C0 §2.3 (horario único, políticas estructuradas, `not_offered`, identidad) y §5 R3b. Decisiones: [ADR 0009](../decisions/0009-unificacion-horario-politicas-identidad-r3b.md).

El agente lee horario, políticas, `not_offered` e identidad **solo** por `BusinessFactsReader` (`apps/api/src/modules/readiness/business-facts.reader.ts`). El lector carga las fuentes (`public.tenants`, la fila de identidad de `companies`, las filas activas de `policies` y las filas de `requirement_values` de `RUNTIME_FACT_IDS`) y la decisión la toma el paquete (`packages/business-spec/src/business-facts.ts`) con **la misma regla que la foto del motor**: el panel y el agente no pueden decir cosas distintas del mismo dato.

| Lectura | Requisito | Quién la usa | Si no hay valor del dueño vigente |
|---|---|---|---|
| `hours()` | `CORE.HOURS.REGULAR` (+ `CORE.HANDOFF.HOURS_SLA.out_of_hours_message`) | turno (`loadTenantBusinessHours`), contexto sellado de evaluación, compuerta fuera de horario de automatizaciones, fecha local de alojamiento, estado de configuración del agente | `settings.businessHours` tal cual |
| `policy(type)` | `CORE.POLICY.CANCELLATION_CHANGES`, `REFUND_RETURNS`, `WARRANTY`, `CORE.PRIVACY.NOTICE`, `CORE.DELIVERY.TERMS` | `get_policy` (turno vivo) | fila activa de `policies` (`terms` no tiene requisito: siempre `policies`) |
| `notOffered()` | `CORE.OFFER.NOT_OFFERED` | `<not_offered>` del prompt (`VerticalTurnContextService` y respaldo del turno), respuesta de «catálogo sobre FAQ» | nada: sin valor confirmado no hay `<not_offered>` |
| `identity(base)` | `CORE.IDENTITY.NAME`, `.DESCRIPTION`, `CORE.LOCATIONS.LIST`, `CORE.CONTACT.CHANNELS` | identidad del turno y del contexto sellado (encima de `BusinessInfoService`) | la fila de `companies` |

**Precedencia** (ADR 0007 §2, ADR 0009):
- Un valor escrito por `BusinessFactsService` manda. Si se proyectó al almacenamiento de hoy (`source_ref.projected_to` + `projected_hash`), manda **solo mientras esa proyección siga intacta**: si una pantalla vieja edita después el almacenamiento, la edición es lo más reciente y manda, en el agente y en el motor a la vez (`applyRequirementValues`).
- Un valor migrado (`migrated_from`) es una copia del almacenamiento de hoy: mientras la fuente no cambie es idéntico a ella, y si cambió ya no vale. En los dos casos el agente sigue leyendo la fuente tal cual: sin valores del dueño, lo que ve el agente es exactamente lo de antes (lo prueban `business-facts.spec.ts` en los 7 tenants QA y `business-facts.reader.spec.ts`).
- La forma del horario es la de `settings.businessHours` (días en inglés, `{enabled, open, close}`). Un día con varios tramos lleva el envolvente en `open/close` y los tramos en `windows`: la compuerta fuera de horario abre solo dentro de un tramo y el prompt dice cada tramo. La validación de reservas contra el horario (`business-window.ts`) sigue con el envolvente; la agenda decide.
- El mensaje fuera de horario del dueño (`HOURS_SLA.out_of_hours_message`) reemplaza al de la cuenta (`settings.businessHours.afterHoursMessage`); el `afterHoursMessageOverride` del agente sigue ganando.
- `get_policy` devuelve `{type, title, content, version}` y, solo si el dueño declaró campos estructurados, `terms`. El texto es `renderPolicyText(valor)`: el resumen y una línea por campo; es el mismo texto que se proyecta a `policies.content`.
- Caché: las fuentes se guardan 60 s en Redis (`business-facts:sources:{tenant}`), salvo para las políticas (texto de consentimiento: siempre la versión durable) y en contextos sin persistencia. `business_fact.written` borra esa clave, `biz_hours:{tenant}` y `business-info:{tenant}:primary` (`BusinessFactsCacheListener`); si la proyección tocó `settings` o `tenants.name`, `BusinessFactProjectionListener` hace lo que la pantalla vieja hace al guardar (`TenantsService.finalizeConfigurationUpdate`, aviso de dependencias de calidad).

**Lo que sigue fuera del lector, y por qué** (ADR 0009 §8):
- `agent_personas.config_json.hours`: `aiOutsideHours` y `afterHoursMessageOverride` son conducta del agente (como `schedule_mode`, D-14), no hechos del negocio. El horario del agente sigue siendo el respaldo cuando el negocio no tiene horario, hasta la release siguiente.
- El consentimiento (`prepareContactConsent`) referencia la fila de `policies` (`consent_records.policy_id`); `legal_text_versions` y `consent_records` no cambian. La proyección crea la versión que el consentimiento referencia.
- La evaluación sellada reproduce su copia congelada de `policies` (`get_policy` con `structuredKnowledgeInputs`).
- `RegionalProfileService` usa `settings.businessHours.timezone` como zona inferida de la región (`CORE.IDENTITY.REGION`, no el horario); la proyección la mantiene igual a la zona de `CORE.HOURS.REGULAR`.
- Escritores viejos que siguen vivos: la pantalla de horario (`TenantsService`), el asistente de configuración (`persona.controller`), la propuesta del copiloto (`account.businessHours`), las pantallas de políticas (`PoliciesService`) y de identidad (`BusinessInfoService`), y el alta (`tenants.name`). Lo que escriben manda por la regla de la huella.
- `definition.businessHours` de las recetas de vertical es la agenda sembrada de la plataforma, no el horario del negocio.

### Escritura doble (expand) y lo que se retira en la release siguiente

`BusinessFactsService.write()` escribe un valor **confirmado, de alcance global y no migrado** de estos requisitos también en su almacenamiento de hoy, **en la misma transacción** (si el valor da 409, la proyección se deshace). Las sentencias viven en `business-facts.statements.ts` (`legacyPatchStatements`).

| Requisito | Se proyecta a | Notas |
|---|---|---|
| `CORE.HOURS.REGULAR` | `tenants.settings.businessHours` (+ sube `agent_personas.version`, como la pantalla) | un tramo por día (el envolvente): la pantalla vieja no sabe de varios; conserva `afterHoursMessage` |
| `CORE.IDENTITY.NAME` | `tenants.name` | `companies.name` no se toca (lo edita la pantalla de identidad); el agente lee `display_name` |
| `CORE.IDENTITY.DESCRIPTION` | `companies.about` (fila `is_primary`) y `settings.customerTypes` | `category_label` solo vive en `requirement_values` |
| `CORE.LOCATIONS.LIST` | `companies.address/city/country` de la sede principal | las demás sedes y la modalidad solo en `requirement_values` |
| `CORE.CONTACT.CHANNELS` | `companies.phone` (o WhatsApp), `email`, `website`, `social_links` | |
| `CORE.POLICY.*`, `CORE.PRIVACY.NOTICE`, `CORE.DELIVERY.TERMS` | versión nueva activa en `policies` (`cancellation`, `return`, `warranty`, `privacy`, `shipping`) | sin tabla `policies` en el esquema no se proyecta |

`CORE.OFFER.NOT_OFFERED` y `CORE.HANDOFF.HOURS_SLA` no tienen almacenamiento viejo que proyectar.

**Release siguiente (contract)** — se retira, con aprobación del dueño para lo que tiene datos (K3, C0 §7.3):

| Qué | Cuándo se puede |
|---|---|
| Las proyecciones de `legacyPatchStatements` y `BusinessFactProjectionListener` | cuando las pantallas de horario, políticas, identidad, el asistente y el copiloto escriban por `BusinessFactsService` |
| La lectura de respaldo de `settings.businessHours`, `policies` y `companies` en `business-facts.ts` | ídem; el lector pasa a leer solo `requirement_values` |
| `tenants.settings.businessHours` (clave de `settings`) y `agent_personas.config_json.hours.schedule` como horario | ídem, más la zona de la región sin `businessHours.timezone` |
| Tabla `policies` | migrar `consent_records` a la versión de `requirement_value_versions`, contar, respaldar y aprobación explícita del dueño (C0 §7.3) |
| `companies.is_primary` como identidad, `companies.about/address/city/country/phone/email/website/social_links` como fuente del agente | ídem: aprobación explícita del dueño; la fila sigue siendo de CRM |
| `tenants.name` como identidad visible | cuando el alta escriba `CORE.IDENTITY.NAME` (también retira L2) |
| El enlace secundario «pantalla actual» del cajón (ADR 0008 §6) | cuando la pantalla vieja deje de escribir |


## Contrato del turno (R4, C0 §1.2)

`buildTurnContract(spec, foto, resultado)` (`packages/business-spec/src/contract/turn.ts`) arma el contrato y `renderKnowledgeStatus` lo pinta como `<knowledge_status>` en la capa 3 del prompt, en vivo y en Agent Test (el agente se comporta igual en cualquier estado del tenant). Una evaluación sellada no lo lleva.

- `<fact id>`: afirmable, con su valor compacto; `source="items|text|default"` cuando sale de los ítems, de una FAQ confirmada o del default aceptado. Hoy solo los `always_in_context`: la API todavía no pasa las intenciones del turno.
- `<unknown code="NC+AV|PREG|HUM|EXT|GAP">`: los IDs aplicables que no constan, marcados `[seeded]`, `[example]`, `[contradictory]`, `[stale]` o `[n/m]`. No depende de detectar la intención.
- `<never>`: las prohibiciones propias de los requisitos EXT y HUM; las comunes van en la regla 20.
- `<offers pending_question handoff [handoff_hours] [writes]>`: `writes` solo cuando `WRITE_MODE` está aplicado.

La regla 20 del contrato L1 (`RULE_20_KNOWLEDGE_STATUS`) dice qué hacer con cada código y absorbe la de «no ofrecido»; sin bloque, el contrato es el de antes. Presupuesto: ≤ 2.200 caracteres en los 7 tenants QA (≈ 600 tokens; `turn-contract.spec.ts`). Qué reglas se retiraron y cuáles quedan para la fase D: ADR 0010 §4.

## Control de salida (R4, C0 §1.2)

- **Binario.** Publicado (`go_live_state = on`) atiende; no publicado no atiende, salvo los contactos de `settings.goLive.testContacts` (lista blanca temporal de C0 §7.2: teléfonos, comparados por dígitos, o correos). Un publicado que cae a `no_listo` sigue atendiendo y el panel lo dice. Agent Test, el ensayo y las evaluaciones nunca pasan por aquí.
- **Publicar** desde `/admin/readiness` (tarjeta «Atención a clientes reales»): `no_listo` no puede; `limitado` exige marcar cada intención que quedará en «no consta» (queda en `go_live_ack`); `listo` publica directo.
- **Modo sombra (por defecto).** Cada mensaje entrante de un canal real registra la decisión y no cambia nada. Informe por tenant: `GET /readiness/:t/go-live?days=7`. Entre tenants, en el VPS, por cada esquema de tenant: `SELECT reason, serve, count(*) FROM <schema>.go_live_decisions WHERE created_at > now() - interval '7 days' GROUP BY reason, serve`.
- **Aplicar.** Encender la bandera `readiness.goLiveGate` del tenant (super_admin → banderas, sin despliegue) **después de 7 días de sombra**, con el informe revisado y el tenant publicado o en la lista blanca si debe seguir atendiendo. Aplicado: el mensaje se guarda, el cliente recibe un aviso fijo en su idioma (es/en/pt/fr) y la conversación pasa a la bandeja humana; en el web chat la IA no responde (el aviso fijo del web chat está pendiente). Apagar la bandera vuelve a sombra.

## `WRITE_MODE` y escritores (R4)

El modo que declara el negocio (`OBJ.<X>.WRITE_MODE`) decide qué escritores usa el agente; los interruptores por agente (`canBook`, `canCancel`…) solo restringen (ADR 0010 §8). Sin modo declarado, el objeto solo informa. `EffectiveCapabilityService` deja `writeModeDecision` en el contrato de capacidades y registra `[capability-write-mode] {tenantId, mode, onlyNew, objects}` cuando la regla nueva sacaría escritores que la vieja publica. Se aplica con la bandera `readiness.writeModeCapability`, con los mismos 7 días de sombra; antes de encenderla, cada objeto que deba reservar o pedir necesita su `WRITE_MODE` en el panel. `required_fields` es una lista cerrada: `customer_fields_common` + `customer_fields` del objeto (`objects.yaml`); un campo libre guardado antes sigue valiendo.

## Conocimiento pendiente (R5, C0 §1.5)

- **Demanda (`gap`).** Una búsqueda de conocimiento sin resultado relevante (la misma condición que antes llenaba `kb_unanswered_queries`) suma una ocurrencia al tema en `pending_questions`, dentro de la transacción de analítica y con su bloqueo de privacidad. Un tenant sin la tabla todavía la salta. El GAP «por turno con NC+AV» de C0 §1.2 no se registra aún: falta el mapa de las claves del intérprete a los IDs de B1 (el mismo pendiente de ADR 0010).
- **«Lo averiguo».** Solo si `<offers pending_question="true">` (`CORE.PENDING.ROUTING` cumple), `TurnCapabilityComposerService` publica `register_pending_question` (política: no compromete al negocio, sobrevive a un perfil bloqueado; `conditional_write`). La regla 20 dice: ofrecerlo y llamarla solo después del «sí». La herramienta deja la espera de la conversación (idioma, contacto), pasa la consulta a `open` y fija `sla_due_at` con el SLA del requisito (4 h por D10). Devuelve `expectedWithinHours` para que el agente diga el plazo. Repetirla en la misma conversación no agrega otra espera. Con persistencia apagada (Agent Test, evaluación, borradores) corre en seco: misma respuesta, sin fila ni aviso.
- **Deduplicación.** `topic_key` = requisito (y su ítem) si el agente lo nombra y la especificación lo conoce; si no, el hash de la pregunta normalizada (minúsculas, sin acentos ni signos). Diez clientes con la misma pregunta = una consulta abierta con diez esperas (`pending-questions.service.spec.ts`).
- **La bandeja** (`/admin/readiness/pending`, enlace con contador en el panel): demanda, esperas, plazo y vencidas. «Responder solo esta vez» (texto, no es dato), «Guardar como dato» (el cajón del requisito de R3c; guarda por la bandeja, que escribe por `BusinessFactsService` con `source_ref.via=pending`, reevalúa y resuelve todas las consultas abiertas de ese requisito) y «Descartar» (sin aviso). Una consulta sin requisito solo se responde o se descarta.
- **Aviso al cliente.** Por cada espera `waiting`: contacto de prueba → `sandbox`; conversación con una persona → `skipped_human`; cerrada → `skipped_closed`; baja en el registro de opt-out → `opted_out`; WhatsApp, Instagram o Messenger fuera de la ventana de 24 h → `template_required` (la plantilla utilitaria `pending_answer_ready` no existe aprobada; ADR 0011 §6); si no, un texto fijo en su idioma (es/en/pt/fr) con la respuesta del dueño tal cual, por `ProactiveDispatchService` con la autoridad `pending_answer_ready` (se revalida al enviar: si la respuesta cambió o se descartó, el procesador lo suprime). Un fallo transitorio deja la espera en `waiting` y la bandeja lo reintenta.
- **No entró en R5** (ADR 0011 §9): el aviso al dueño por WhatsApp o correo (hoy: la bandeja y su contador), el recordatorio al vencer el SLA, la plantilla `pending_answer_ready`, que el agente redacte la respuesta desde el valor guardado, el modo «no aplica» que guarda `NOT_OFFERED` y la lectura del estado para C31.

## Copiloto de onboarding (R6, C0 §1.3)

- **Qué lee.** Los `knowledge_documents` confirmados del negocio (las páginas web solo del dominio que declaró en `companies.website`; nunca contenido sembrado o de ejemplo) y sus FAQs publicadas con dato. No raspa nada nuevo. Recorta cada fuente (12.000 caracteres, 60.000 en total) y marca su contenido como dato, nunca instrucciones.
- **Qué propone.** Valores para los requisitos que aplican, admiten `copilot_approved` y siguen ausentes, sembrados, de ejemplo o caducados; un solo pedido a `gpt-4o-mini` (JSON, temperatura 0) por ejecución, con tope de 10 ejecuciones por tenant cada 24 h.
- **Qué decide el código** (`checkCopilotProposal` del paquete): estructura del requisito (`validateRequirementValue`), cada cita literal en la fuente que nombra y cada cifra del valor presente en una cita. Si algo falla, la propuesta se descarta entera y se cuenta.
- **Contradicciones y contenido genérico.** Una versión distinta del valor confirmado, o dos fuentes que no coinciden, son una contradicción que el dueño resuelve eligiendo; una FAQ publicada sembrada, de ejemplo o sin dato es una pregunta (`CORE.KNOWLEDGE.FAQ_HYGIENE`). Nada de esto escribe.
- **Aprobar.** Desde `/admin/readiness/copilot`: aprobar, editar y aprobar (el cajón de R3c con el valor propuesto y la evidencia) o rechazar. Aprobar escribe por `BusinessFactsService` con `origin=copilot`, `confirmed_by` = la persona y `source_ref = {via:'copilot', proposal_id, extraction_run_id, edited, evidence}`. Las propuestas caducan a los 30 días y quedan `superseded` si llega otra más nueva o un valor por otra puerta.
- **Una propuesta nunca cuenta para la preparación**: el motor no lee `agent_content_proposals`.
- **No entró en R6** (ADR 0012): propuestas de ítems de catálogo y su aprobación en lote, el catálogo como fuente, la cola BullMQ y los disparos automáticos, la medición de las aceptaciones #1 y #5, y el tope de costo por plan.

## Ensayo antes de salir (R7, C0 §1.4)

- **Banco.** `generateRehearsal` (`@parallext/business-spec`) sobre la foto del tenant: ≤ 40 preguntas de las intenciones del perfil efectivo (núcleo + perfil), ponderadas por la demanda de B1 §D, con las frases de `intents.yaml` en un idioma atendido y un ítem real del tenant cuando la frase lo nombra. La respuesta esperada de cada caso es la de `qaTruth()` (requisito + ítem), con los chequeos que se derivan de ella: cifras que debe decir, cifras que nunca debe decir (ejemplo, sembrado, conflicto), COTIZA sin dinero, «desde», y «lo averiguo» registrado tras el «sí» si el contrato lo ofrece. Sembrado y reproducible (`bankHash`): la misma foto y la misma semilla dan el mismo banco. `business-spec rehearsal --snapshot f.json` entrega el mismo banco fuera de la API (arnés QA, fase E).
- **Ejecución.** `RehearsalService` corre cada caso por `AgentTestService.test` en vista previa sobre una foto del agente congelada: herramientas de solo lectura (los escritores quedan bloqueados, «lo averiguo» en seco), sin entregas, sin notificaciones y sin el control de salida (no hay fila en `go_live_decisions`). Una ejecución a la vez, 6 por día, 10 minutos de reloj; la cuota de IA agotada la detiene. Solo escribe `rehearsal_runs` y `rehearsal_results`.
- **Calificación.** `gradeCase`: los fallos deterministas deciden («respondió mal», clase producto); con evidencia de «no consta», traspaso o pregunta, el caso pasa; sin evidencia decide el juez de paráfrasis (`RehearsalJudge`, marcado), que nunca anula un fallo determinista. Resultados: «responde bien», «no lo sabe porque falta X» (clase dato, abre el formulario del requisito), «respondió mal» (fallo de la plataforma, no del dueño), inconcluso, error. Tasa de aciertos = (responde bien + falta X) / calificados.
- **pass^k.** «Repetir el mismo ensayo» reutiliza el banco congelado; el informe da pass^k sobre todas las ejecuciones con ese `bank_hash`.
- **Consultivo.** No habilita ni bloquea la salida (C0 §6 pregunta 7). Decisiones: ADR 0013.

## Migración de los tenants existentes (`backfill-provenance`, C0 §2.9)

`apps/api/scripts/readiness/backfill-provenance.cjs` aplica L1–L7 una vez y deja escrita la procedencia. Siempre primero `--dry-run`:

```
node scripts/readiness/backfill-provenance.cjs --psql "<comando psql>" --all-qa --dry-run --out-md informe.md
node scripts/readiness/backfill-provenance.cjs --psql "<comando psql>" --tenant tenant_x --apply
node scripts/readiness/backfill-provenance.cjs --fixtures packages/business-spec/test/fixtures/qa-tenants --dry-run
```

- El plan lo calcula el paquete (`planProvenanceBackfill`), con la misma función que usa la lectura (`legacyRowProvenance`): migración y lectura no pueden divergir.
- Por esquema aplica el plan en memoria y exige el mismo veredicto y el mismo `resultHash` antes y después; si difieren, no escribe ese esquema. Con `--apply` escribe todo el esquema en una transacción (sentencias de `BusinessFactsService`, actor `{kind:'script', name:'backfill-provenance'}`) y vuelve a planear: debe quedar 0 pendiente.
- Idempotente: no toca filas con procedencia vigente ni valores que ya tienen fila (`ON CONFLICT DO NOTHING`).
- Ítems y textos: L3 → `seeded`/`platform_seed`; L6 → `confirmed`/`legacy`; L1 `example` → `price_status=example`; L7 → `price_type=fijo`, `origin=legacy_inferred`. `price_status = quote` → `price_type = a_cotizar` **sin** tocar `price_status` (las pantallas y el runtime de hoy leen `quote`; reescribirlo a `confirmed` es el paso «contract», cuando el runtime lea `price_type`).
- Valores, como **expand** (el almacenamiento de hoy queda donde está): L2 (`tenants.name`, `settings.subType`, `businessInfoDraft`, `customerTypes`) → `confirmed`/`onboarding`; L5 (configuración de la persona igual a la plantilla) → `seeded`/`platform_seed`; L6 → `confirmed`/`legacy` (el panel dice «dato heredado: confírmalo»); `settings.businessHours` → `CORE.HOURS.REGULAR`; `policies` → sus `CORE.POLICY.*` y `CORE.PRIVACY.NOTICE` con el texto en `summary`; depósito por ítem → alcance `item:<id>`. Si dos almacenamientos confirmados se contradicen, copia el más reciente y nombra al otro en `contradiction_with` (el otro se sigue leyendo: la contradicción no se esconde).
- No copia: L4 (el requisito sigue ausente), la región (C0 §2.3 reutiliza `tenants.operating_*`), el horario deducido de la agenda y las promociones (tablas de catálogo). Un valor heredado que no cumple la especificación (p. ej. `audience` fuera de `B2C|B2B`) no se copia y sigue leyéndose con reglas L; el informe lo lista.
- Las FAQs sembradas quedan `seeded`; despublicarlas exige avisar antes al dueño (D5) y el script solo las cuenta.

## Reglas L: cuándo se retira cada una

Las reglas viven en `packages/business-spec/src/legacy-status.ts`. Una regla de una tabla se borra del código cuando se cumplen las dos condiciones: (1) la migración corrió en producción para esa tabla con el dry-run al 100 % y el veredicto igual, y (2) todo escritor de la tabla escribe procedencia (si no, una edición desde una pantalla vieja necesita la regla para no quedar mal leída). Al cierre de R3 la migración no había corrido. **Al cierre de R3b** la condición (1) se cumple en los 23 esquemas, pero la (2) no se cumple en ninguna tabla: en esta release los almacenamientos de horario, políticas e identidad siguen escribiéndose (proyección de `BusinessFactsService` y pantallas viejas, ADR 0009), y una edición vieja vuelve a necesitar su regla. **Ninguna regla se retiró**; la columna dice qué falta:

| Regla | Tablas / almacenamientos | Se retira cuando |
|---|---|---|
| L1 | `services`, `membership_plans` (`price_status`) | backfill en producción + las pantallas de servicios y membresías escriben `price_type`/`price_status` y el runtime lee `price_type` (fin del `quote`) |
| L2 | `tenants.name`, `settings.subType`, `businessInfoDraft`, `customerTypes` | ~~backfill en producción~~ (hecho) + el alta escribe `CORE.IDENTITY.*` por `BusinessFactsService` (R3b dejó `tenants.name` y `customerTypes` como proyección; el alta sigue escribiéndolos directo) |
| L3 | todas las tablas de §2.2 | backfill en producción + las pantallas de catálogo y FAQs escriben procedencia (formularios de R3) |
| L4 | listas y valores por defecto de columna | no se retira con el backfill: lo reemplazan los formularios que confirman «vacío» y el alcance `item:` de los depósitos (R3b) |
| L5 | `agent_personas.config_json.behavior.*`, `hours` | ~~backfill en producción~~ (hecho) + la configuración de traspaso, temas prohibidos e instrucciones se escribe por `BusinessFactsService`; para `hours`, la release siguiente de R3b (el horario del agente deja de ser respaldo) |
| L6 | todas | igual que L3 para ítems; para valores, cuando cada almacenamiento relocalizado deja de escribirse: la release siguiente de R3b (contract), al retirar las proyecciones y las pantallas viejas de horario, políticas e identidad |
| L7 | `menu_items`, `products`, `tour_packages`, `properties`, `real_estate_listings`, `courses`, `insurance_plans`, `vehicles` | backfill en producción + sus pantallas escriben `price_type` |

## Siembra del alta (R3, D5)

El alta y el cambio de vertical **no siembran FAQs** de plantilla (el paso `knowledge` solo enciende la herramienta de FAQs) y los servicios de muestra nacen **sin monto**, con la moneda del país y `price_status = example` (o `quote` si la receta lo cotiza). Los planes de membresía de muestra nacen en 0 (la columna es `NOT NULL`) marcados `example`. Las preguntas de la receta siguen viviendo en `vertical-definitions.ts` porque el asistente de configuración las muestra como guía; ya no se escriben en `faqs`.

## Panel

`/admin/readiness` muestra:
- el veredicto;
- los **Bloqueantes**;
- los **Necesarios**, con las intenciones que quedarán en «no consta»;
- los **Recomendados**, con su cobertura;
- **Calidad** y **Plataforma**;
- la cobertura por área y el historial.

La tarjeta de Inicio muestra el veredicto y los 3 primeros bloqueantes (tarea `business` = veredicto ≠ `no_listo`).

### Formularios (R3, C6)

Cada hueco tiene una acción:

- **Cajón** (`Completar`): si el requisito está en `formRequirementIds`. El cajón pide `GET …/requirements/:id` y `…/business-facts/:id/versions`, precarga el formulario con la fila guardada o, si no hay, con el valor que lee el motor (un dato heredado se confirma revisándolo y guardando), valida en el cliente, guarda con `PUT …/business-facts/:id` y `expectedVersion`, muestra el veredicto antes y después y el historial de versiones, y el panel recarga. El supervisor ve el cajón sin poder guardar. `/admin/readiness?open=ID` abre el cajón al llegar; así enlaza la tarjeta de Inicio los bloqueantes con formulario.
- **Pantalla del objeto**: los ítems de catálogo (`CORE.OFFER.ITEMS`, `OBJ.*.CATALOG`, `PRICE_MODEL`, `ITEM_DETAILS`) y las FAQs siguen en sus pantallas (C0 §1.6). Para los del núcleo, la API manda en `screenTargets` la pantalla de catálogo del primer objeto habilitado del tenant (menú para un restaurante, catálogo para una tienda), en lugar del `ui_target` fijo de servicios.
- **Nada que hacer**: datos de plataforma, derivados o que solo aporta una integración.

El descriptor sale de `formFor(requisito, spec)` (`packages/business-spec/src/forms/descriptor.ts`): un campo por clave de `data.structure`, con el componente que decide su descripción (`enum […]`, `enum_list […]`, `bool`, `duration`, `money`, `weekly_hours`, `lista de {…}`, `text_i18n`…). Los 13 bloqueantes del núcleo y `OBJ.*.WRITE_MODE` / `OBJ.*.CHANGE_RULES` llevan ajustes explícitos para la forma que leen sus evaluadores (horario por día con tramos `{open, close}`, plazo y cargo de cancelación, `ref` a la política general o condiciones propias, campos que solo se piden con `request_to_business`…). Los componentes por tipo están en `apps/dashboard/src/components/readiness/`; la validación del cliente (`readiness-forms.ts`) interpreta el descriptor y `readiness-forms.spec.ts` la cruza con `validateRequirementValue` en todos los formularios: lo que el cliente deja guardar, la API lo acepta.

**Desde R3b** el agente lee lo que guarda el cajón (`BusinessFactsReader`) y la escritura se proyecta a la pantalla vieja. El enlace a la pantalla actual sigue como acción secundaria mientras esa pantalla escriba: una edición allí manda (ADR 0009 §3); se retira en la release siguiente.

### Valores por defecto

`/admin/readiness/defaults` lista los requisitos con `predicate_kind: default_accepted` que aplican al tenant (conversión de moneda, memoria del cliente, casos que atiende siempre una persona, retorno a la IA, compensaciones, identidad…), con lo que hace la plataforma si no se configura (`when_missing.behavior`). Aceptar llama a `POST …/defaults/accept` con la `spec_version` vigente; un valor que el dueño ya configuró no se pisa. «Configurar a mi medida» abre el cajón del requisito.

## Qué reemplazó

- **Retirado en R2:** `ReadinessCitationV1` y `readinessAudit` del contrato público; las tareas `knowledge`, `hours`, `appointments` y `team` de la tarjeta; los 20 chequeos de datos del negocio de `AgentQualityService`.
- **Retirado en R3:** la siembra de FAQs de plantilla (alta, extras de tours, dental e inmobiliaria, re-siembra y cambio de vertical) y los montos de ejemplo de los servicios y planes de muestra. Con los formularios: la acción «Pronto podrás completarlo aquí» de los huecos sin pantalla (`readinessPanel.action.comingSoon`) y el enlace de los huecos con formulario como acción principal (queda como secundario dentro del cajón hasta R3b).
- **Retirado en R3b:** la lectura directa del agente de `settings.businessHours`, `policies` y `companies` (pasa por `BusinessFactsReader`); el `notOffered` de plataforma por perfil en el prompt (`VerticalTurnContextService`, el respaldo del turno), en el contrato de dominio (`prompt.notOffered` y su `unresolved`) y en los packs de evaluación (escenarios `declared_limit`/`limit_N`: 18.704 casos por canal en lugar de 19.768); el «no ofrecemos X» de «catálogo sobre FAQ» sin entrada del negocio (ahora «no veo X»); la regla de prompt 20 como lista de plataforma (se reescribió para la lista del negocio).
- **Sigue hasta la release siguiente (contract de R3b):** `settings.businessHours`, `agent_personas.config_json.hours` como horario, la tabla `policies` y `companies` como identidad, escritos por las pantallas viejas y por la proyección (tabla de la sección «Escritura doble»); `price_status = quote`.
- **Retirado en R4:** la regla de prompt 20 «NOT OFFERED» como regla aparte (con `<knowledge_status>` la absorbe la regla 20 «KNOWLEDGE STATUS»); `WRITE_MODE.required_fields` como lista abierta. Las reglas 22a, 20b, 13h y 5/6 quedan para la fase D (ADR 0010 §4).
- **Retirado en R5 (K4):** el registro `kb_unanswered_queries` como cola (su escritor en `KnowledgeService.trackRetrieval`, la lista de «Preguntas sin respuesta» de Analíticas con «Resolver» y crear artículo, `POST /knowledge/analytics/:t/resolve/:id`, `unansweredQueries` de `GET /knowledge/analytics/:t` y del informe de brechas, y su KPI); las sugerencias de artículos por IA sobre esas preguntas (`POST /knowledge/suggestions/:t`, `generateArticleSuggestions`, la sección «Sugerencias de artículos (IA)» y sus textos). La tabla queda con sus filas: la borra el dueño (ADR 0011 §8); el borrado de datos personales la sigue limpiando mientras exista.
- **Retirado en R6 (K4):** la FAQ de Assist (`knowledge.faq.create`) sin requisito ni procedencia: la propuesta guarda `requirement_id = CORE.KNOWLEDGE.SOURCES` y aplicarla estampa el documento ingerido con `origin=copilot`, `confirmed_by` y la propuesta en `source_ref` (`BusinessFactsService.stampRowProvenance`); antes el motor lo leía con las reglas L. Las sugerencias de artículos por IA ya se habían retirado en R5.
- **Retirado en R7 (K4):** los casos de conocimiento de `composeSubtypeEvalPack` (el universal `price_question` y las sondas `price_without_data` y `after_hours`; 17.744 casos por canal en lugar de 18.704): su verdad la da `qaTruth` en el ensayo. El generador viejo del arnés QA (CATGEN/FAQGEN) vive fuera del repositorio; su reemplazo es `business-spec rehearsal` (ADR 0013 §11).
- **Sigue hasta aplicar `readiness.writeModeCapability` en todos los tenants:** `VerticalReadinessService`, `READINESS`, `VerticalReadinessKey`, el `readiness` del manifiesto, `TOOL_GROUP_READINESS`, `TOOL_READINESS` y `readiness-predicate-authority.util.ts` (C0 §4.2): son la exclusión vieja contra la que se mide la sombra. Con ellos se retiran los interruptores `canBook`/`canCancel` de la pantalla del agente.
