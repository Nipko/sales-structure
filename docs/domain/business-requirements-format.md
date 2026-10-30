# Formato de la especificación de requisitos del negocio

> **Base aprobada (K1).** Es `schema.md` v0.2 de la fase B2 (aprobado con D1–D15 el 30-oct-2026), traído al repositorio en la rebanada R1 sin cambios de fondo, más la §13 con lo que R1 agrega. Fuente de verdad en código: `packages/business-spec/` (`spec/*.yaml`, `spec/requirement.schema.json`, `src/`). La lectura humana de los requisitos se **genera**: [business-requirements.md](business-requirements.md). Decisiones: [ADR 0001](../decisions/0001-especificacion-unica.md) y [ADR 0002](../decisions/0002-decisiones-d1-d15-y-c0.md).


*Documento de la fase B2–B4 (aprobado). v0.2: defaults D1–D15 aprobados y validación con los tenants QA dental y comida (`validacion-dental-comida.md`). Define **el formato** de un requisito. Los requisitos concretos están en `core.yaml`, `objects.yaml` y `profiles.yaml`; la lectura humana, en `B2-requisitos.md`.*

## 1. Para qué sirve y quién lo consume

Un **requisito** describe algo que un negocio debe tener definido (un dato, un procedimiento, una política o una configuración) para que el agente pueda responder o actuar sobre una o más intenciones del cliente de B1. La misma definición la leen cinco consumidores:

| Consumidor | Qué lee del requisito | Qué produce |
|---|---|---|
| **C1 · Motor de preparación** (determinista) | `applies_when`, `criticality`, `readiness`, `data.validation`, estado de procedencia | Estado por requisito y por tenant: **no listo / modo limitado / listo**, con la lista de huecos |
| **C2 · Control de salida** | Requisitos bloqueantes aplicables | Permite o impide publicar el agente |
| **D · Agente** | `exposure`, `data`, estado del valor, `when_missing` | Qué leer en cada intención y qué hacer si el valor no es afirmable |
| **E · QA** | `answers`, `qa_truth`, estado del valor | La respuesta esperada de cada caso, sin adivinarla |
| **C6 · Interfaz** | `data.structure`, `collection` | El formulario, la importación o la pregunta del copiloto |

**Requisito ≠ valor.** El requisito es la definición (igual para todos los tenants). El **valor** es lo que un tenant cargó para ese requisito, siempre con su **procedencia** y su **estado** (§7). El motor de preparación compara valores contra requisitos.

## 2. Capas

| Capa | Sintaxis `layer` | Aplica a | Archivo |
|---|---|---|---|
| Núcleo | `core` | Todo negocio, siempre | `core.yaml` |
| Objeto transaccional | `object:<nombre>` | Tenants que habilitan ese objeto (cita, pedido, reserva…) | `objects.yaml` |
| Perfil efectivo | `profile:<P00…P28>` | Tenants de ese perfil (B1 §A) | `profiles.yaml` |
| Dominio regulado | `domain:<health|mental_health|pharmacy|veterinary|insurance|finance|legal|minors|home_safety>` | Perfiles que declaran el dominio | `profiles.yaml` (sección `domains`) |

Reglas de composición:
1. Un tenant tiene **un perfil efectivo**, uno o más **objetos** habilitados (el perfil propone los suyos por defecto) y cero o más **dominios** (los fija el perfil, no el dueño).
2. Los requisitos efectivos de un tenant = `core` ∪ `object:*` habilitados ∪ `profile:<suyo>` ∪ `domain:*` de su perfil.
3. Un perfil o dominio puede **subir** la criticidad de un requisito de otra capa (`overrides`). Nunca la baja, salvo decisión del dueño registrada como ADR. Un dominio nunca se puede bajar. Un override es un texto («nivel (Rn): motivo») o un mapa `{level, rule, params, why}`; `params` alimenta el predicado del requisito (p. ej. `required_topics` de `CORE.POLICY.HOUSE_RULES`). Si un override sube un requisito a R1–R4, su predicado debe ser evaluable (§9).
4. Los requisitos de objeto se escriben **una vez como plantilla** (`OBJ.*.CATALOG`, `OBJ.*.WRITE_MODE`…) y se instancian por objeto con su propio ID (`OBJ.APPOINTMENT.WRITE_MODE`). Cada objeto solo declara sus parámetros y sus requisitos extra.

## 3. Identificadores

- Formato: `CAPA.BLOQUE.NOMBRE` en mayúsculas, estable y sin versión. Ejemplos: `CORE.HOURS.REGULAR`, `OBJ.APPOINTMENT.AVAILABILITY_SOURCE`, `PROF.P02.DELIVERY_ZONES`, `DOM.HEALTH.EMERGENCY_PROTOCOL`.
- Prefijos: `CORE` (núcleo), `OBJ` (objeto; `OBJ.*` es la plantilla), `PROF.Pnn` (extra de perfil), `DOM.<DOMINIO>` (dominio regulado).
- Un ID **no se reutiliza**. Si un requisito se parte o se fusiona, el viejo queda como `deprecated_by: <ID>` hasta que ningún valor lo use.
- La especificación entera lleva `spec_version` (semver). Cambiar criticidad, `applies_when` o `when_missing` es versión menor; cambiar la estructura del dato es versión mayor y necesita migración de valores.

## 4. Campos de un requisito

```yaml
- id: CORE.HOURS.REGULAR                # estable (§3)
  title: Horario habitual por día        # para humanos
  layer: core                            # core | object:<x> | profile:<Pnn> | domain:<d>
  kind: knowledge                        # knowledge | procedure | policy | config
  applies_when: always                   # predicado sobre la configuración del tenant (§4.1)
  answers: [C03, C04, P11-2]             # intenciones de B1 que este requisito responde o habilita
  exposure: always_in_context            # always_in_context | read_on_intent | account_read | platform_only
  data:
    name: biz.hours                      # nombre lógico (glosario B1 §0.2)
    type: weekly_hours                   # tipo de la biblioteca §5
    structure: {...}                     # campos, cardinalidad y obligatoriedad
    validation: [...]                    # reglas deterministas
    example: {...}                       # ejemplo de valor bien formado
  criticality:
    level: bloqueante                    # bloqueante | necesario | recomendado
    rule: R1                             # regla de §6 que lo decide
    conditional: null                    # p. ej. "bloqueante si delivery.offered = true; si no, n/a"
  when_missing:
    code: NC+AV                          # PREG | NC+AV | HUM | EXT | GAP (§8)
    behavior: >-                         # comportamiento exacto del agente
      ...
    never: [...]                         # afirmaciones prohibidas cuando el valor no es afirmable
  sources:                               # fuentes admitidas para este requisito, en orden (§7.2)
    allowed: [owner_form, copilot_approved, import, integration, country_pack]
    accepts_text_evidence: false         # ¿un texto (FAQ/documento) puede cubrirlo? (§7.4)
  collection:
    channels: [form, copilot_extraction] # form | import | copilot_extraction | integration | platform | derived
    ui_today: /admin/settings/business-hours   # pantalla actual o "nuevo"
    storage_today: Tenant.settings.businessHours  # dónde vive hoy
    storage_status: parcial              # existe | parcial | nuevo
  readiness:
    predicate: >-                        # predicado determinista en palabras (§9)
      ...
    predicate_by_level: {...}            # opcional (§9): umbrales escalonados {bloqueante, necesario}; sustituye a predicate
    gap_message: "..."                   # qué ve el dueño cuando falla; texto o mapa por causa {ausente, ejemplo, sembrado, contradictorio, parcial, caducado}
    derived: false                       # true: requisito derivado de otros; se informa pero no genera hueco propio (§9)
  qa_truth: >-                           # cómo deriva QA la respuesta esperada (§10)
    ...
  owner_decision: E5                     # opcional: decisión pendiente que puede cambiarlo
  notes: ...
```

### 4.1 `applies_when`

Predicado sobre la **configuración** del tenant (nunca sobre sus datos de clientes). Vocabulario cerrado:
- `always`
- `object_enabled(<objeto>)`, `any_object_with_write`, `any_object_reservable` (objetos con fecha/hora: cita, alojamiento, tour, alquiler, sesión, mascota, inscripción a cohorte, clase)
- `profile_in([...])`, `domain(<d>)`
- `modality_includes(<presencial|online|a_domicilio>)`, `delivery_offered`, `sells_goods`, `has_prepayment`
- Combinaciones con `and`, `or`, `not`.

Si `applies_when` es falso, el requisito queda **n/a**: no cuenta para la preparación ni genera casos QA.

**Hechos de operación (v0.2).** Cada átomo tiene una fuente única; ninguno se lee de configuración técnica del agente.

| Átomo | Fuente | Si no está declarado |
|---|---|---|
| `object_enabled(o)` | `CORE.IDENTITY.PROFILE.objects_enabled` | `objects_default` del perfil |
| `variant(o)` | variante declarada del objeto | la variante por defecto del perfil (`food_order(delivery)` en P02) |
| `modality_includes(m)` | `CORE.IDENTITY.PROFILE.operating_facts.modality` (y `CORE.LOCATIONS.LIST` la referencia) | `operating_facts_defaults` del perfil (`profiles.yaml`); si es `null`, el requisito **aplica** |
| `delivery_offered` | `operating_facts.delivery_offered` | default del perfil |
| `sells_goods` | derivado: `object_enabled(food_order) or object_enabled(catalog_order)` | — |
| `has_prepayment` | derivado: algún `OBJ.<x>.WRITE_MODE.payment_required_to_confirm`, o `CORE.PAYMENT.TIMING_DEPOSIT.when ∈ {al_reservar, anticipo_parcial}` confirmado | default del perfil |
| `any_object_with_write`, `WRITE_MODE ≠ none` | `OBJ.<x>.WRITE_MODE.mode` | `default_write_mode` del objeto (`objects.yaml`) |
| `any_object_reservable` | objetos habilitados con fecha/hora (cita, alojamiento, tour, alquiler, sesión, mascota, cohorte, clase) | — |
| `hours_always_open` | `CORE.HOURS.REGULAR.always_open` (**no** `agent_personas.schedule_mode`, que es el horario del agente) | `false` |
| `staff_count` | profesionales activos reservables: `staff_members` activos ∪ usuarios con `availability_slots` activos | 0 |
| `estimate_required` | algún ítem activo con `estimate_required = true` | `false` |
| `subtype = x` | `settings.subType` | — |
| dominio condicional («health si …», «minors si …») | `operating_facts.conditional_domain_facts.<hecho>` | **no** se activa el dominio, pero el hecho sin declarar es un hueco **bloqueante** de `CORE.IDENTITY.PROFILE` |

Un hecho desconocido toma el valor por defecto del perfil. Si el perfil no tiene valor por defecto, el requisito **aplica** (falla segura) y `CORE.IDENTITY.PROFILE` pide declararlo.

### 4.2 `kind`

| Valor | Qué es | Ejemplo |
|---|---|---|
| `knowledge` | Un hecho del negocio que el agente afirma | Horario, dirección, precio, atributos |
| `procedure` | Cómo se ejecuta una acción: campos, quién confirma, SLA, qué se le dice al cliente | Reservar, traspasar, quejas, consulta pendiente |
| `policy` | Reglas con plazo, cargo y excepciones que el agente cita y aplica | Cancelación, reembolso, garantía, depósito |
| `config` | Una elección de funcionamiento que el agente obedece pero no recita | Modo de escritura, nivel de identidad, idiomas, conversión de moneda |

### 4.3 `exposure`

Cómo llega el valor al agente (fase D). Es parte del requisito porque el 18 % de los fallos (causa B de A4) son datos que existen y no llegan.
- `always_in_context`: va en cada turno (identidad, horario, contacto, pagos, idiomas, traspaso). Debe ser corto.
- `read_on_intent`: lo lee el código cuando la intención lo pide (catálogo, políticas, atributos). Es lectura **obligatoria** para las intenciones listadas en `answers`, no opcional para el modelo.
- `account_read`: registro del cliente, leído **en el turno** y con el nivel de identidad del objeto (P7).
- `platform_only`: lo usa la plataforma (gate, enrutamiento) y no se afirma al cliente.

## 5. Biblioteca de tipos

| Tipo | Estructura | Validación base |
|---|---|---|
| `text_i18n` | `{lang: texto}` con un idioma de origen | No vacío, ≤ límite por campo, sin plantilla («cuéntame…», «te confirmamos…») |
| `money` | `{amount, currency(ISO 4217), tax_included: bool}` | amount ≥ 0; currency válida |
| `price` | `money` + `unit` (por unidad, persona, noche, sesión, mes, hora, m², proyecto) + `price_type` (`fijo` \| `desde` \| `a_cotizar` \| `gratis`) | `a_cotizar` ⇒ sin amount; `desde` ⇒ amount > 0 |
| `duration` | `{min, max?, unit}` | min > 0; max ≥ min |
| `weekly_hours` | 7 días × lista de tramos `{open, close}`, `timezone` IANA | Tramos sin solapes; close > open o cruce de medianoche explícito; día sin tramos = cerrado declarado |
| `date_exception` | `{date | date_range, kind: cerrado|horario_especial|abierto_normal, hours?, reason}` | Fecha válida; si `horario_especial`, tramos válidos |
| `address` | `{line1, line2?, city, region?, country(ISO 3166), postal?, geo?, map_url?}` según `addressSchemaId` del país | Ciudad y país obligatorios; país = país de operación salvo sede extranjera declarada |
| `contact_point` | `{kind: phone|whatsapp|email|web|social|review|jobs|suppliers, value, label?, hours?}` | Teléfono E.164 con `phoneRegion`; correo y URL bien formados |
| `policy_terms` | `{summary(text_i18n), deadline?: duration antes del evento, charge?: money|porcentaje|"ninguno", refund?: {medio, plazo}, exceptions[]?, scope: global|por_objeto|por_item}` | Si el texto menciona un plazo o un cargo, los campos estructurados deben existir |
| `enum` / `enum_list` | Valores cerrados definidos en el requisito | Valor dentro del dominio |
| `ref` | Referencia a otro requisito o a un ítem | El destino existe y está activo |
| `procedure_spec` | `{required_fields[], confirms: agent|business|human_always, sla: duration, customer_message(text_i18n), channel_targets[]}` | Campos dentro del diccionario de campos del objeto; SLA > 0 |
| `item_list<X>` | Lista de ítems del objeto X con campos propios (`objects.yaml`) | Por ítem: campos obligatorios del objeto |

**Vacío confirmado.** Toda lista admite el valor explícito `[]` **confirmado** («no tenemos promociones», «no cobramos cargos extra», «no declaramos exclusiones»). Es distinto de *ausente* y es lo único que permite al agente **negar** (principio P1 de B1).

## 6. Criticidad: la regla que la decide

Se evalúa en orden; gana la primera regla que se cumpla.

| Regla | Nivel | Condición |
|---|---|---|
| **R1** | bloqueante | Responde una intención universal sin la cual el agente no puede presentarse sin inducir a error: quién es (C01), dónde y cómo atiende (C02), cuándo (C03), qué ofrece y con qué modelo de precio (C06, C09), cómo se paga (C14), a quién deriva (C30) y el aviso legal de datos (C28). |
| **R2** | bloqueante (condicional) | Es precondición de una **escritura habilitada**: si un objeto tiene `write_mode ≠ none`, su catálogo, su modo de escritura con términos de confirmación y sus reglas de cambio y cancelación. |
| **R3** | bloqueante (dominio) | Seguridad de personas, animales o bienes, o regulación del dominio: protocolo de emergencia o crisis, identidad fuerte para leer registros sensibles, alérgenos en comida, receta en farmacia, descargos obligatorios. |
| **R4** | necesario | Responde una intención con demanda observada ≥ 1 % de conversaciones o con fallo ≥ 30 % en B1 §D, o del núcleo de B1, y tiene un comportamiento seguro si falta (PREG, NC+AV o HUM). Sin él, el tenant opera en **modo limitado**. |
| **R5** | recomendado | Todo lo demás: mejora la calidad, baja frecuencia, o tiene un valor por defecto de plataforma razonable. |

Estado del tenant:
- **No listo**: falla al menos un requisito R1–R3 aplicable.
- **Listo en modo limitado**: R1–R3 cumplen y falla al menos un R4. La interfaz muestra qué intenciones (`answers`) quedarán en «no consta + lo averiguo».
- **Listo**: cumplen todos los R1–R4. Los R5 solo suman al puntaje de cobertura.

**Requisitos de plataforma (v0.2).** Si `sources.allowed ⊆ {country_pack, derived}` (p. ej. `CORE.POLICY.CONSUMER_RIGHTS`, `CORE.PROC.FOLLOW_UP_STATE`), el dueño no los puede cumplir. Su fallo va a la lista **«huecos de plataforma»**: bloquea el control de salida del país o de la versión, pero no baja el estado del tenant. La excepción es cuando la causa es un dato del tenant (p. ej. el pack no resuelve porque falta `CORE.IDENTITY.REGION`): entonces el hueco se atribuye a ese requisito del tenant (§9).

`criticality.conditional` expresa niveles dependientes de la configuración (p. ej. «bloqueante si `delivery_offered`; si no, n/a»). Un `override` de perfil o dominio cambia `level` y debe citar la regla (R2/R3) que lo justifica.

## 7. Procedencia y estado de un valor

### 7.1 Estados

| Estado | Significado | ¿El agente lo puede afirmar? | ¿Cuenta para la preparación? |
|---|---|---|---|
| **confirmado** | Lo cargó o aprobó el dueño (o un usuario con permiso), lo trae una integración activa, o es dato de plataforma mantenido (pack de país) | Sí | Sí |
| **ejemplo** | Valor ilustrativo puesto por la plataforma o marcado así por el dueño (p. ej. precio de muestra) | **No**. Puede decir que existe el ítem y que el valor «está por confirmar» | No |
| **sembrado-sin-editar** | Lo creó una receta de alta y nadie lo editó ni lo aprobó (FAQs de plantilla, servicios sembrados, textos por defecto) | **No**. Para el agente es *ausente*; si es un texto sin dato, no se publica | No, y además genera un hueco de calidad |
| **ausente** | No hay valor, o la única propuesta es del copiloto sin aprobar, o caducó (`max_age`, vigencia vencida) | No → `when_missing` | No |
| **contradictorio** | Dos fuentes **del mismo nivel** de precedencia dan valores incompatibles (p. ej. dos horarios confirmados distintos, o una FAQ confirmada que dice otro precio que el campo) | **No**. Se trata como ausente para afirmar (`when_missing`), sin revelar ninguno de los dos | No, y genera hueco «contradicción» |

Reglas:
1. **Las propuestas del copiloto (C3) no son valores.** Viven en una bandeja de aprobación; al aprobarse pasan a *confirmado* con `origin: copilot`.
2. **Aceptar un valor por defecto es confirmar.** Un default de plataforma que el dueño acepta en el alta queda *confirmado*; si nunca lo vio, queda *sembrado-sin-editar*. La aceptación se registra una vez por tenant como `defaults_acceptance {spec_version, ids[], accepted_by, accepted_at}`, y una sola pantalla cubre todos los requisitos cuyo predicado es «default aceptado» (traspaso, retorno a la IA, memoria, identidad, conversión de moneda, compensaciones, consultas pendientes). Un cambio de `spec_version` que cambie un default exige aceptarlo de nuevo.
5. **Datos del pack de país.** Cuentan como *confirmados*. Si el pack los marca `reviewStatus: unreviewed` (hoy, todos los números de emergencia), generan un aviso **de plataforma**, no un hueco del tenant.
3. **Caducidad.** Un requisito puede declarar `max_age` (p. ej. festivos: por año; stock manual: 24 h; promociones: su vigencia). Vencido, el valor pasa a *ausente* y el motor lo lista como «por renovar».
4. Cada valor guarda `{status, origin, confirmed_by, confirmed_at, source_ref}`. Hoy solo existe algo parecido en `services.price_status` y `membership_plans.price_status` (`confirmed|example|quote`, que mezcla estado y tipo de precio) y en `Tenant.regionalProvenance`; en el resto es **nuevo**.

### 7.2 Precedencia entre fuentes

De mayor a menor. Una fuente de mayor nivel **gana sin contradicción**; la diferencia se registra como aviso de calidad («la FAQ dice otra cosa que el campo»).

1. **Integración activa** del sistema del negocio para datos **volátiles** (stock, agenda, cupos, estado de un pedido). Para datos estables no gana a lo confirmado en formulario.
2. **Campo estructurado confirmado** (formulario, importación confirmada o propuesta del copiloto aprobada). Es el mismo nivel: el origen se guarda, pero no cambia la precedencia.
3. **Dato de plataforma** (pack de país: festivos, números de emergencia, derechos del consumidor). Gana sobre el negocio solo en datos legales o de seguridad; en festivos, la **excepción declarada por el negocio** gana al calendario.
4. **Dato estructurado del ítem** frente a dato general: el atributo del ítem gana a la regla general del negocio (la política de cancelación de un tour concreto gana a la general).
5. **Texto confirmado** (FAQ, documento, descripción libre): solo cubre requisitos con `accepts_text_evidence: true`, y siempre por debajo de cualquier campo estructurado (P2 de B1).
6. **Ejemplo / sembrado-sin-editar**: nunca afirmable.

### 7.3 Contradicciones que detecta el motor (deterministas)

- Mismo requisito con dos valores confirmados distintos (p. ej. horario en `settings.businessHours` y en la agenda de citas).
- Campo estructurado frente a texto confirmado cuando el texto contiene una cifra, hora, fecha o moneda que no coincide (extracción determinista de números y horas; la extracción semántica la propone el copiloto, no la decide).
- Ítem con `price_type = a_cotizar` y precio numérico en su descripción.
- Política con texto que menciona plazo o cargo y campos estructurados vacíos o distintos.

### 7.4 `accepts_text_evidence`

Algunos requisitos (p. ej. preparación para un procedimiento, manejo del miedo al dentista, instrucciones de seguridad de fumigación) son conocimiento narrativo y se cubren con una FAQ o documento **confirmado y con dato**. Los requisitos con cifras, horas, plazos o cargos **no** aceptan texto: exigen campos. Una FAQ «sin dato» (patrón de desvío: «cuéntame…», «te confirmamos…», «con gusto te compartimos…») nunca cubre nada y se marca como hueco.

**Excepción (R1.1, spec 1.1.0-rc.1):** `CORE.POLICY.WARRANTY` y `CORE.POLICY.REFUND_RETURNS` aceptan texto mientras no exista el formulario de políticas estructuradas. Cuenta una FAQ **publicada, confirmada (no sembrada, D5) y con dato** cuyo `covers` incluye el requisito; en los datos heredados `covers` se infiere del título (`FAQ_COVERS_RULES`). La verdad QA afirma el texto tal cual, sin añadir plazos ni condiciones.

### 7.5 Estado de los datos heredados (v0.2)

Mientras no exista `{status, origin, confirmed_at}` por valor, el motor decide el estado con estas reglas deterministas. Se aplican en orden y gana la primera:

| # | Regla | Estado |
|---|---|---|
| L1 | `price_status = example` (`services`, `membership_plans`) | ejemplo. `quote` = confirmado con `price_type = a_cotizar`; `confirmed` = confirmado |
| L2 | Valor copiado de las respuestas del alta: `tenants.name`, `settings.businessInfoDraft.*`, `settings.customerTypes`, `settings.subType` | confirmado (`origin: onboarding`) |
| L3 | Fila creada en la ventana de aprovisionamiento (`tenants.created_at` … `settings.verticalProvisioning.completedAt`) y nunca editada (`updated_at = created_at`) | sembrado-sin-editar |
| L4 | Columna con su valor por defecto de esquema (`menu_items.allergens '[]'`, `services.payment_policy 'none'`, `services.location_type 'in_person'`, `services.required_fields`, `currency 'COP'`) | sembrado-sin-editar. **Una lista vacía por defecto nunca es vacío confirmado.** |
| L5 | Campo de la configuración JSON de la persona (`agent_personas.config_json.behavior.*`, `hours`) igual al de su plantilla (`template_id`) | sembrado-sin-editar. El `updated_at` de la fila no prueba que se editara ese campo. |
| L6 | Cualquier otra fila creada o editada después del alta | confirmado (`origin: legacy`) |
| L7 | Precio numérico > 0, confirmado, en una tabla sin `price_status` ni `price_type` (`menu_items`, `products`…) | `price_type = fijo` (`origin: legacy_inferred`) |

Estas reglas se retiran tabla por tabla a medida que exista la procedencia real. Mientras rijan, la interfaz muestra «dato heredado: confírmalo» en todo lo que pasó por L6 o L7.

## 8. `when_missing`: comportamientos

El código decide; el modelo solo redacta. Las frases van en el idioma del mensaje del cliente (T04).

| Código | Cuándo | Comportamiento exacto |
|---|---|---|
| **PREG** | Falta un dato **del cliente** (fecha, cantidad, zona, cuál ítem) | Una sola pregunta concreta por turno. Si hay un único candidato, lo asume y lo dice. Nunca pide datos personales para responder una consulta de información (T03). |
| **NC+AV** | Falta un dato **del negocio** no crítico, o su estado no es afirmable | 1) Responde todo lo demás que sí consta. 2) Dice «no tengo ese dato confirmado» sobre el punto concreto, **sin negar** ni sustituir por una suposición. 3) Ofrece averiguarlo **solo si** `CORE.PENDING.ROUTING` cumple; si no, ofrece una persona (HUM) o el canal de contacto. 4) Si el cliente acepta (T01), crea la consulta pendiente, confirma «quedó registrada; el equipo suele responder en {sla}» y la marca para seguimiento (C31). Siempre genera **GAP**. |
| **HUM** | Criterio humano, excepción, negociación, queja, diagnóstico, o el cliente pide una persona | Crea el traspaso con resumen (intención, datos ya recogidos, qué falta). Dice el horario humano y el tiempo esperado de `CORE.HANDOFF.HOURS_SLA`; fuera de horario lo dice y deja la solicitud registrada. Al volver la conversación a la IA, un único aviso coherente (P6). |
| **EXT** | Riesgo para la vida, la salud, la seguridad o un bien; o tema regulado fuera del negocio | Primero el contacto de emergencia u oficial (pack de país o `DOM.*`), en una frase, sin preguntas comerciales antes. Después, si aplica, HUM. |
| **GAP** | Siempre que hubo NC+AV por un dato del negocio, o un valor caducado o contradictorio | Registra `{requirement_id, intent_id, tenant, conversation, count}` en la bandeja de «conocimiento pendiente» (C5) con el enlace a `collection.ui_*`. No es visible al cliente. |

`never` lista las afirmaciones prohibidas mientras el valor no sea afirmable. Las comunes a todo requisito son: negar un atributo («no incluye», «no tiene»), inferir ciudad, país o moneda, presentar un *ejemplo* como precio, y prometer un efecto (reserva, aviso, devolución) que ningún procedimiento respalda.

## 9. Preparación (`readiness`)

El predicado se escribe en palabras pero usa solo estas primitivas, para que se traduzca 1:1 a código:
- `existe(campo)` · `estado(campo) = confirmado` · `vacío_confirmado(lista)`
- `cuenta(lista, condición) ≥ n` · `todos(lista, condición)` · `ninguno(lista, condición)`
- `válido(campo)` (aplica `data.validation`) · `sin_contradicción(requisito)` · `no_caducado(campo)`
- `ref_cumple(<ID>)` (otro requisito cumple)

Reglas de escritura del predicado (v0.2):
- **Prohibido «opcional».** Todo requisito, incluido R5, tiene un predicado evaluable. Para R5 alimenta el puntaje de cobertura; si un override lo sube, ya está listo para bloquear. Para listas, el predicado mínimo es «valor o vacío confirmado».
- **n/a solo sale de `applies_when`.** Un predicado devuelve cumple, parcial o no cumple.
- **`predicate_by_level`** expresa umbrales escalonados en un mismo requisito (p. ej. `CORE.OFFER.PRICE_MODEL`: bloqueante si no hay ni un precio confirmado o «a cotizar»; necesario si queda algún precio de ejemplo o sin `price_type`). Cada nivel que falla cuenta para la regla de su nivel.
- **Derivados** (`derived: true`): se calculan e informan, pero no generan hueco propio, porque su causa ya es hueco de otro requisito.
- **Causa raíz.** Si un requisito falla solo porque falla otro del que depende (`ref_cumple`, o el pack que se resuelve por `CORE.IDENTITY.REGION`), el hueco se muestra una sola vez, en la raíz, con la lista de requisitos que arrastra.
- **`gap_message` por causa.** Cuando el mensaje depende de la causa (ausente frente a contradictorio), se usa un mapa.

Resultado por requisito: **cumple / parcial / no cumple / n/a**. *Parcial* solo existe en listas (p. ej. 40 de 50 ítems con precio confirmado) y cuenta como *no cumple* para la regla de su nivel, pero la interfaz muestra la proporción.

Cada fallo produce un **hueco** con: qué falta (`gap_message`), por qué importa (las intenciones de `answers` con su demanda de B1 §D) y dónde completarlo (`collection.ui_target` o `ui_today`).

## 10. Verdad QA (`qa_truth`)

El generador de casos deja de adivinar: para cada caso `(intención, entidad)` busca los requisitos cuyo `answers` contiene la intención, lee el valor del tenant con su estado y deriva la respuesta esperada con esta tabla:

| Estado del valor | Respuesta esperada | Afirmaciones prohibidas |
|---|---|---|
| confirmado | **AFIRMA** el valor (normalizado: moneda, unidad, día pedido). Totales y conversiones los calcula el oráculo determinista. | Cualquier valor distinto |
| confirmado con `price_type = desde` | AFIRMA con el calificador «desde» | El precio sin calificador |
| confirmado con `price_type = a_cotizar` | Sin cifra + procedimiento de cotización (PREG de sus campos) | Cualquier cifra |
| vacío confirmado | **NIEGA** («no hay promociones vigentes», «no cobramos cargos extra») | Inventar un elemento |
| ejemplo / sembrado-sin-editar | Reconoce el ítem; valor «por confirmar» + `when_missing` | El valor de ejemplo como hecho |
| ausente / caducado | `when_missing` del requisito (normalmente NC+AV) | Negar; inferir; usar el historial como fuente |
| contradictorio | Igual que ausente | Cualquiera de los valores en conflicto |
| intención de cuenta (`account_read`) | Lo que diga el registro del cliente leído con la identidad suficiente; si la identidad no alcanza, el paso de verificación | Conteos o fechas del historial del chat |

Cada caso QA guarda los `requirement_id` y el `status` que usó, para que un fallo se pueda atribuir a producto (el agente no siguió la especificación) o a dato (el tenant no lo tenía).

## 11. Correspondencia con el glosario de B1 (§0.2)

| Bloque B1 | Requisitos |
|---|---|
| `biz.profile` | `CORE.IDENTITY.*`, `CORE.LANGUAGES.SERVED` |
| `biz.locations[]` | `CORE.LOCATIONS.*`, `CORE.SERVICE_AREA` |
| `biz.hours`, `biz.hours_exceptions[]` | `CORE.HOURS.*` |
| `biz.contact` | `CORE.CONTACT.*` |
| `offer.items[]`, `offer.price`, `offer.not_offered[]` | `CORE.OFFER.*` + `OBJ.<x>.CATALOG` |
| `availability` | `OBJ.<x>.AVAILABILITY_SOURCE` |
| `payment` | `CORE.PAYMENT.*` |
| `promotions[]` | `CORE.OFFER.PROMOTIONS` |
| `policies.*` | `CORE.POLICY.*` + `OBJ.<x>.CHANGE_RULES` |
| `delivery` | `CORE.SERVICE_AREA`, `CORE.DELIVERY.TERMS` |
| `requirements` | `OBJ.<x>.CUSTOMER_REQUIREMENTS` |
| `proc.*` | `OBJ.<x>.WRITE_MODE`, `CORE.HANDOFF.*`, `CORE.PENDING.ROUTING`, `CORE.COMPLAINT.*`, `CORE.PROC.*` |
| `account.*` | `OBJ.<x>.ACCOUNT_READ`, `CORE.ACCOUNT.IDENTITY_DEFAULT` |
| `knowledge` | `CORE.KNOWLEDGE.*` |
| `safety.*` | `CORE.SAFETY.*`, `DOM.*` |

## 12. Advertencia sobre `storage_today` (actualizada en v0.2)

La columna «dónde vive hoy» se armó leyendo `tenant-schema.sql`, `schema.prisma` y las rutas de `apps/dashboard/src/app/admin` del worktree `lang-ubicado-4300` (commit base `6f79b0db`), sin abrir la base de datos ni el código de cada pantalla. Sirve para dimensionar el trabajo, no como contrato. Donde dice **nuevo** no hay lugar estructurado; donde dice **parcial** existe un lugar pero le falta estructura, procedencia o llegada al agente.

En la v0.2, los 19 «verificar» se resolvieron contra la base de datos QA y el commit `97bc0dcb` (`validacion-dental-comida.md` §4). Correcciones principales:
- Los datos del negocio (descripción, dirección, contacto) viven en la fila `is_primary` de **`companies`** del esquema del tenant, no en `settings.businessInfo`. `settings` solo guarda `businessInfoDraft`.
- `/admin/cases` son casos profesionales (`opportunities`), no quejas.
- `/admin/settings/fiscal` es la facturación de la plataforma al tenant.
- El pack de país solo contiene contactos de emergencia: no tiene festivos ni derechos del consumidor.

## 13. Adiciones de la rebanada R1 (spec 1.0.0-rc.1)

La v0.2 se trajo al repositorio como `1.0.0-rc.1`. Para que cada predicado sea evaluable por código (C0 §1.1) se agregaron estos campos; la prosa sigue siendo la lectura humana.

| Campo | Dónde | Qué hace |
|---|---|---|
| `readiness.predicate_kind` | cada requisito | `custom` (evaluador propio en `src/engine/evaluators/`) o una forma genérica: `confirmed_fields`, `value_or_empty`, `default_accepted`, `count_min`, `platform_pack`. La CI exige paridad ID ↔ evaluador en las dos direcciones. |
| `readiness.predicate_params` | genéricos | `fields` (`a.b` existe; `a[]` lista no vacía; una lista vacía cuenta como vacío confirmado), `any_of`, `path` + `min`, `max_age_days`, `field`. |
| `criticality.when` | requisitos con `conditional` | Versión evaluable del condicional: `[{if, level, rule}]`; gana la primera que se cumple. Los overrides de perfil, objeto y dominio se aplican después como **piso**: solo suben. |
| `subtypes` | `profiles.yaml` | Mapeo subtipo canónico → perfil. La CI comprueba que cubre exactamente `listCanonicalSubtypeExperienceProfileIds()`. |

**Átomos de expresión agregados** (además de los de §4.1): `writes(<o>)` (= `WRITE_MODE ≠ none`), `direct_commit(<o>)`, `direct_commit_any([…])`, `payment_required_any`, `any_reservable_direct`, `domain_any([…])`, `books_by_staff` (el `WRITE_MODE` de citas pide profesional) y `availability_kinds(<o>) ≠ []`. Un átomo desconocido es un defecto de la especificación (`UNEVALUABLE_EXPRESSION`).

**Reglas de evaluación que fija R1:**
- Un fallo con causa `plataforma` y sin causa raíz del tenant va a «huecos de plataforma» y no baja el veredicto (§6). Si la causa es un dato del tenant (sin país no se resuelve el pack), cuenta en su nivel y el hueco se muestra en la raíz (`CORE.IDENTITY.REGION`).
- Los requisitos `derived: true` se informan pero no cuentan para el veredicto: cuentan sus raíces.
- Con `predicate_by_level`, el umbral `bloqueante` falla en el nivel del requisito y el umbral `necesario` falla como R4.
- Los extras de perfil se activan por su `applies_when` (p. ej. `PROF.P09.PREPARATIONS` aplica a P08, P09 y P17).
- `CORE.HANDOFF.TEAM`: sin asignación explícita, cuenta el administrador activo con correo verificado y aviso de traspaso (D-09).
- ~~`qaTruth` de una intención~~ (reemplazado en R1.1, §14): la consulta es siempre por `requirement_id` (+ ítem).

**Datos heredados (§7.5) en R1:** L5 es aproximada (la plantilla de la persona vive en código, así que toda configuración de persona con `template_id` se trata como sembrada) y L4 se extiende a valores por defecto de columna equivalentes (`companies.country 'CO'`, `properties.check_in_time/check_out_time`, `products.requires_prescription`, listas `jsonb` vacías).

## 14. Adiciones de R1.1 (spec 1.1.0-rc.1)

Medición del criterio 6 (qaTruth contra la revisión humana) y sus arreglos F1–F7 y F10. Cambio menor de la especificación: solo `sources.accepts_text_evidence` (§7.4); la estructura del dato no cambia.

**Consulta (F10).** `qaTruth(spec, foto, {requirementId, itemId?, intent?})` devuelve **un** caso: el del requisito pedido. Una intención sola solo se acepta si es conversacional (T01–T11 → `CONVERSACIONAL`); para las demás, `requirementsForIntent()` da los candidatos y el generador elige uno. Si se pasa la intención, el requisito tiene que responderla. Un ítem solo convierte el caso en la ficha cuando el requisito es `OBJ.*.CATALOG`; en `OBJ.*.AVAILABILITY_SOURCE` el caso afirma lo que la fuente tiene cargado para ese ítem (salidas, stock), y en el resto el ítem da el alcance del valor (`scopeKey = item:<id>`, p. ej. financiación por listado).

**Estado por campo (F6, F7).** El caso de un ítem trae `fields` (estado de cada campo), `affirm` (solo los confirmados) y `unknown` (los que no constan):
- el precio y la moneda siguen `price_status` (L1); si la fila trae ese marcador explícito, el resto de la ficha se afirma aunque la fila sea del alta (el marcador dice qué es de ejemplo); sin marcador, una fila sembrada sigue entera «por confirmar»;
- un campo ausente o una lista vacía que nadie confirmó (default de columna) es «no consta» + AV y nunca habilita «no incluye»;
- con `address_privacy ≠ publica` la dirección no se afirma: se da la zona y se dice que se comparte al confirmar.

**Captura (F1–F5), con el estado de cada fila (§7.5):**

| Requisito | Origen nuevo | Estado |
|---|---|---|
| `CORE.HOURS.REGULAR` | `availability_slots` (la agenda), solo si no hay `settings.businessHours` ni `config.hours` de la persona — la misma precedencia que el runtime | el de sus filas: la agenda que siembra la plantilla del alta es **sembrada (L3)** |
| `CORE.POLICY.WARRANTY`, `CORE.POLICY.REFUND_RETURNS` | FAQ confirmada y con dato, `covers` inferido del título | confirmado (L6) |
| `OBJ.REAL_ESTATE.CATALOG` | `real_estate_listings.address` y `metadata.address_privacy` | el de la fila |
| `CORE.PAYMENT.FINANCING` (por listado) | `real_estate_listings.financing_available` | `true` → el de la fila; `false` es el default de la columna → **sembrado (L4)** |
| `OBJ.CATALOG_ORDER.CATALOG` / `AVAILABILITY_SOURCE` | `products.stock` | el de la fila |
| `OBJ.TOUR_BOOKING.CATALOG` / `AVAILABILITY_SOURCE` | `tour_packages.languages` → `guide_languages`; salidas futuras de `tour_inventory` → `departures` | lista vacía = no consta |
| `OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS` (por servicio) | `services.required_fields` | contrato del motor de reservas: la verdad QA es lo que pedirá (ver `when_missing`), aunque sea el default (L4 sigue valiendo para la preparación) |

El contenido que siembra la plantilla del alta (agenda, FAQs) y los defaults de columna no son verdad QA (D5; ADR 0006 propuesto).
