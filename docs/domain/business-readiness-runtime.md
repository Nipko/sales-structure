# Preparación del negocio en tiempo de ejecución (R2–R3)

Cómo usa la plataforma la especificación (`packages/business-spec`) para decir si un tenant está listo para atender, y cómo se guardan los valores del negocio con su procedencia. Diseño: C0 §1.1, §2.1, §2.2, §2.5, §2.7, §2.9, §4.1 y §5 R2–R3. Decisiones de construcción: [ADR 0004](../decisions/0004-panel-de-preparacion-r2.md) (R2).

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
       └─ eventos readiness.evaluated / readiness.verdict_changed

PUT /readiness/:tenantId/business-facts/:requirementId
  └─ BusinessFactsService.write()
       ├─ validateRequirementValue(spec, id, valor)               ← el paquete; 400 con `issues` si no cumple
       ├─ UNA sentencia: requirement_values (version + 1) + requirement_value_versions (con actor)
       └─ evento business_fact.written → ReadinessInvalidationListener borra la caché
```

- **Una sola regla.** El veredicto, los huecos y su nivel los decide el motor. La API solo lee, guarda y sirve; el panel solo agrupa. `readiness:report` (CLI) y el panel dan el mismo veredicto sobre la misma foto (lo prueban `readiness.service.spec.ts` y `readiness-panel.spec.ts` con las 7 fotos golden).
- **`resultHash`** identifica el contenido del resultado, sin la hora: el historial tiene una fila por cambio real.
- **Caché.** Se invalida con `agent.config.updated`, `agent.version.updated` y `business_fact.written`. Las pantallas de catálogo de hoy no avisan: el panel siempre reevalúa al abrirse.

## API

| Método | Ruta | Roles | Uso |
|---|---|---|---|
| GET | `/readiness/:tenantId` | super_admin, tenant_admin, tenant_supervisor | Última evaluación (`{evaluationId, evaluatedAt, trigger, cached, result}`); `?refresh=1` reevalúa |
| GET | `/readiness/:tenantId/history?limit=30` | ídem | Una fila por resultado distinto: veredicto, conteos, bloqueantes, `trigger`, fecha |
| GET | `/readiness/:tenantId/requirements/:requirementId` | ídem | Definición del requisito y su evaluación actual |
| GET | `/readiness/:tenantId/snapshot` | super_admin | Foto `business-spec/tenant-snapshot@1` para `business-spec qa-truth` |
| GET | `/readiness/:tenantId/business-facts` | super_admin, tenant_admin, tenant_supervisor | Todos los valores con procedencia del tenant |
| GET | `/readiness/:tenantId/business-facts/:requirementId?scope=` | ídem | Un valor (alcance `''` por defecto) |
| GET | `/readiness/:tenantId/business-facts/:requirementId/versions` | ídem | Sus versiones: valor, estado, origen, actor y fecha |
| PUT | `/readiness/:tenantId/business-facts/:requirementId` | super_admin, tenant_admin | `{value, scopeKey?, expectedVersion?}` → escribe con `origin=owner_form`, confirmado; responde el valor y el delta (`verdictBefore`, `verdictAfter`, evaluación del requisito). 400 si no cumple la especificación, 409 si `expectedVersion` quedó vieja |
| POST | `/readiness/:tenantId/business-facts/defaults/accept` | super_admin, tenant_admin | `{ids[], specVersion}` → acepta los valores por defecto (§2.5); 409 si `specVersion` no es la vigente |

Una escritura de `super_admin` exige suplantación: el actor guarda el usuario efectivo y la delegación (`auditActor`), nunca solo uno de los dos.

## Almacenamiento

- `readiness_evaluations` (por tenant): `id`, `spec_version`, `snapshot_hash`, `result_hash`, `verdict` (`no_listo|limitado|listo`), `counts`, `result` (el `ReadinessResult` completo), `trigger` (`on_demand|refresh|invalidated`), `created_at`. Migración `20261030120000_add_readiness_evaluations`.
- `requirement_values` (por tenant, R3): una fila por `(requirement_id, scope_key)`. `value` tiene la forma de `data.structure` del requisito (`[]` = «no hay», confirmado); `status` `confirmed|example|seeded`; `origin` (`owner_form`, `copilot`, `import`, `integration`, `country_pack`, `default_accepted`, `pending_answer` y, solo desde la migración, `onboarding`, `platform_seed`, `legacy`, `legacy_inferred`); `confirmed_by`, `confirmed_at`, `source_ref`, `valid_until`, `spec_version`, `version`, `updated_at`. *Ausente*, *contradictorio* y *caducado* no se guardan: los calcula el motor.
- `requirement_value_versions` (append-only): la misma forma más `value_id`, `actor` (`{kind:'user', userId, role, delegation?}` o `{kind:'script', name}`) y `created_at`. Una fila por escritura.
- Columnas de procedencia (R3, C0 §2.2) en `services`, `menu_items`, `products`, `tour_packages`, `properties`, `real_estate_listings`, `courses`, `membership_plans`, `insurance_plans`, `vehicles`, `faqs` y `knowledge_documents`: `content_status` (default `confirmed`), `origin`, `confirmed_by`, `confirmed_at`, `source_ref`; en las tablas con precio, `price_type` (`fijo|desde|a_cotizar|gratis`) y `price_status` (`confirmed|example`). `services` y `membership_plans` conservan su `price_status` de antes (`confirmed|example|quote`, lo escriben sus pantallas): solo reciben `price_type`. Los paquetes de fotografía y el catálogo de servicios del hogar viven en `services`. La lista es `PROVENANCE_TABLES` del paquete.
- Las crea `tenant-schema.sql` y, en los tenants existentes, la migración `20261030140000_add_business_facts_provenance` (aditiva). `business-facts-schema.spec.ts` exige que las dos definiciones y `PROVENANCE_TABLES` coincidan.

**Única puerta de escritura.** `requirement_values` solo lo escribe `BusinessFactsService` (sus sentencias viven en `business-facts.statements.ts`, sin Nest ni Prisma, para que la migración use el mismo SQL). `business-facts-writes.spec.ts` falla con cualquier `INSERT` o `UPDATE` sobre `requirement_values` fuera de esos dos archivos y con cualquier `UPDATE`, `DELETE` o `TRUNCATE` sobre `requirement_value_versions`.

**Validación** (`validateRequirementValue`, en el paquete): requisito escribible (no catálogo, no derivado, no de plataforma), origen admitido por `sources.allowed`, `seeded` solo con `platform_seed`, alcance (`''`, `location:`, `object:`, `item:`), forma de `data.structure` (campos conocidos; las políticas admiten además `summary` y `title`, el horario `timezone`), `requerido`, `bool` y `enum`/`enum_list` cerrados. El resto de `data.validation` (prosa) lo aplica el evaluador al calcular la preparación.

**Aceptar defaults (§2.5).** Una fila por requisito con `predicate_kind: default_accepted`, `origin=default_accepted`, `value = null` (el default de la plataforma para esa `spec_version`) y la `spec_version` vigente. No pisa un valor que el negocio ya configuró.

## Cómo lee la foto la procedencia

- **Ítems y textos.** Una fila tiene procedencia real si trae `origin` y `content_status`, y `source_ref.row_updated_at` coincide con su `updated_at`. El `content_status` solo no prueba nada (su default de columna es `confirmed`). Si una pantalla que no conoce estas columnas edita la fila, su `updated_at` cambia y la fila vuelve a las reglas L (L6: editada → confirmada). Las listas vacías por defecto de columna (L4: `allergens`, `includes`, `required_fields`…) siguen sin contar como «vacío confirmado» también con procedencia real. Un `price_status = example` manda en cualquier tabla: un precio de ejemplo nunca cuenta como confirmado, aunque la fila declare `price_type`.
- **Valores.** Una fila de `requirement_values` escrita por `BusinessFactsService` manda sobre todo lo que dedujeron las reglas para ese requisito y alcance. Una fila **migrada** (`source_ref.migrated_from` + `migrated_hash`) reemplaza solo al valor heredado del que salió, y solo mientras ese almacenamiento conserve el valor migrado; si cambió después (sus pantallas siguen vivas hasta R3b), la copia se ignora y manda la lectura con reglas L. Los demás valores heredados del mismo requisito se siguen leyendo, así que una contradicción entre dos almacenamientos sigue a la vista.
- `snapshot.source.notes` cuenta cuántas filas y valores usaron procedencia real y cuántas copias migradas se ignoraron.

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

Las reglas viven en `packages/business-spec/src/legacy-status.ts`. Una regla de una tabla se borra del código cuando se cumplen las dos condiciones: (1) la migración corrió en producción para esa tabla con el dry-run al 100 % y el veredicto igual, y (2) todo escritor de la tabla escribe procedencia (si no, una edición desde una pantalla vieja necesita la regla para no quedar mal leída). Al cierre de R3 la migración no ha corrido en producción, así que **ninguna regla se retiró**:

| Regla | Tablas / almacenamientos | Se retira cuando |
|---|---|---|
| L1 | `services`, `membership_plans` (`price_status`) | backfill en producción + las pantallas de servicios y membresías escriben `price_type`/`price_status` y el runtime lee `price_type` (fin del `quote`) |
| L2 | `tenants.name`, `settings.subType`, `businessInfoDraft`, `customerTypes` | backfill en producción + el alta escribe `CORE.IDENTITY.*` por `BusinessFactsService` (R3b: identidad) |
| L3 | todas las tablas de §2.2 | backfill en producción + las pantallas de catálogo y FAQs escriben procedencia (formularios de R3) |
| L4 | listas y valores por defecto de columna | no se retira con el backfill: lo reemplazan los formularios que confirman «vacío» y el alcance `item:` de los depósitos (R3b) |
| L5 | `agent_personas.config_json.behavior.*`, `hours` | backfill en producción + la configuración de traspaso, temas prohibidos e instrucciones se escribe por `BusinessFactsService` |
| L6 | todas | igual que L3 para ítems; para valores, cuando cada almacenamiento relocalizado deja de escribirse (R3b: horario, políticas, identidad) |
| L7 | `menu_items`, `products`, `tour_packages`, `properties`, `real_estate_listings`, `courses`, `insurance_plans`, `vehicles` | backfill en producción + sus pantallas escriben `price_type` |

## Siembra del alta (R3, D5)

El alta y el cambio de vertical **no siembran FAQs** de plantilla (el paso `knowledge` solo enciende la herramienta de FAQs) y los servicios de muestra nacen **sin monto**, con la moneda del país y `price_status = example` (o `quote` si la receta lo cotiza). Los planes de membresía de muestra nacen en 0 (la columna es `NOT NULL`) marcados `example`. Las preguntas de la receta siguen viviendo en `vertical-definitions.ts` porque el asistente de configuración las muestra como guía; ya no se escriben en `faqs`.

## Panel

`/admin/readiness` (solo lectura en R2) muestra:
- el veredicto;
- los **Bloqueantes**;
- los **Necesarios**, con las intenciones que quedarán en «no consta»;
- los **Recomendados**, con su cobertura;
- **Calidad** y **Plataforma**;
- la cobertura por área y el historial.

Cada hueco enlaza a la pantalla donde se arregla hoy (`ui_target`), solo si el rol que mira puede abrirla. La tarjeta de Inicio muestra el veredicto y los 3 primeros bloqueantes (tarea `business` = veredicto ≠ `no_listo`). Los formularios del panel que escriben por `business-facts` llegan en el paso de interfaz de R3.

## Qué reemplazó

- **Retirado en R2:** `ReadinessCitationV1` y `readinessAudit` del contrato público; las tareas `knowledge`, `hours`, `appointments` y `team` de la tarjeta; los 20 chequeos de datos del negocio de `AgentQualityService`.
- **Retirado en R3:** la siembra de FAQs de plantilla (alta, extras de tours, dental e inmobiliaria, re-siembra y cambio de vertical) y los montos de ejemplo de los servicios y planes de muestra.
- **Sigue hasta R3b:** `settings.businessHours`, `agent_personas.config_json.hours`, la tabla `policies` y `companies` como identidad (expand: la migración ya escribió el lado nuevo); `price_status = quote`.
- **Sigue hasta R4:** `VerticalReadinessService`, `READINESS`, `TOOL_GROUP_READINESS` y `readiness-predicate-authority.util.ts` (C0 §4.2).
