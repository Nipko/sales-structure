# Auditoría del bootstrap por vertical — Julio 2026

> ¿Lo que sembramos por industria llega realmente a la IA y al cliente final del tenant?
> Método: 4 rastreadores paralelos siguiendo cada dato desde su INSERT hasta su lector en runtime, + ronda de refutación adversarial sobre los hallazgos graves.
> Resultado: 32 hallazgos, 12 graves, 6 verificados adversarialmente, 0 refutados (la verificación bajó severidad en 3 al encontrar mitigantes reales).
> **Nada se ejecutó: todo es lectura estática de código.**

Disparador: la auditoría del onboarding (`docs/onboarding-audit-2026-07.md`) dejó tres sospechas fuera de tabla y sin verificar. Las tres resultaron ciertas, y el rastreo destapó dos roturas mayores que nadie sospechaba.

---
# ¿La adaptación por vertical funciona de verdad?

## 1. Respuesta directa

**Sí, pero a medias — y las dos mitades no son las que uno esperaría.** Lo que el cliente final efectivamente percibe de la vertical es la **terminología** (que sí baja al prompt y el contrato le ordena al modelo usarla: `prompt-assembler.service.ts:153-161` + regla 13 en `:82`), los **servicios** (el motor de reservas los lista textualmente por WhatsApp: `booking-engine.service.ts:706-714`) y, del lado del tenant, las **etapas del embudo** con sus reglas de transición (`pipeline.service.ts:759`, `:1312-1346`) y las **etiquetas/KPIs del panel** (`AppSidebar.tsx:355-356`, `admin/page.tsx:74-84`). Eso funciona.

Lo decorativo es más de lo que parece, y lo grave no estaba en las sospechas. **Toda la persona vertical de las 18 industrias —nombre, rol, saludo, reglas de negocio, temas prohibidos, disparadores de handoff— nunca llega al modelo**: `patchDefaultAgent` la escribe en la raíz de `config_json` (`verticals.service.ts:241-258`) y el único lector del prompt lee `config.persona.*` / `config.behavior.*` (`persona.service.ts:141-191`). Se corta ahí, en silencio. Lo que el bot realmente usa es la plantilla que se insertó un paso antes (`persona.service.ts:2545`), que además está **solo en español** para todos los tenants, porque `getVerticalTemplates(industry, lang)` declara el parámetro `lang` y nunca lo usa (`persona.service.ts:1176`). Un tenant brasileño recibe FAQs, etapas y servicios en portugués, y su agente en castellano.

Y hay una interacción perversa que vale más que cualquier hallazgo aislado: **el asistente guiado es a la vez el parche y el destructor**. Apaga la herramienta de citas cuando no hay horarios cargados —evitando el bucle de "no hay disponibilidad"— pero al guardar reemplaza el `config_json` entero (`persona.service.ts:758`, REPLACE sin merge) y se lleva puestos los flags de herramienta vertical que el bootstrap acababa de encender (gimnasios, restaurantes, seguros, educación, servicios del hogar, pet services, fotografía). El tenant que hace las cosas "bien" pierde su toolset de industria; el que saltea el asistente conserva el toolset pero queda con el agendador prometiendo turnos que no puede tomar.

---

## 2. Las tres sospechas

| | Veredicto | Evidencia decisiva |
|---|---|---|
| **S1** — las FAQs sembradas nunca llegan a la IA porque nadie enciende `tools.faqs` | **CONFIRMADA** (impacto menor al enunciado) | `verticals.service.ts:288-294` inserta con `is_published=true`; `conversations.service.ts:1772-1774` registra `FAQ_TOOL` solo `if (cfgTools?.faqs?.enabled === true)`. Ninguna de las ~56 plantillas define el flag (`persona/templates/index.ts:7-40` ni siquiera declara el campo `tools`; grep "faq" en `persona.service.ts` = 6 hits, todos ids/nombres/goal). Irónico: el propio `tpl_faq` (`persona.service.ts:973-995`) tampoco lo trae. |
| **S2** — las verticales con agenda arrancan sin `availability_slots` | **CONFIRMADA, y peor** | `bootstrapVertical` (`verticals.service.ts:20-137`) inserta solo en `pipeline_stages` (:209), `faqs` (:289) y `services` (:313); cero INSERT a `availability_slots` (único escritor en todo el repo: `appointments.service.ts:508-527`, UI manual). Pero el agente arranca con la herramienta **encendida** (`persona.service.ts:1204/:1380/:2073/:2111`), así que no es "no ofrece": es que ofrece, pide fecha y responde "No hay disponibilidad" para siempre (`booking-engine.service.ts:724-736`). |
| **S3** — el contenido semilla que leen los clientes está sin tildes | **CONFIRMADA en el dato** | La pista es literal: `vertical-definitions.ts:66` = `'¿Cual es el horario de atencion?'`. Medición: de 346 cadenas `es` de faqs+services+terminology, 298 (86%) no tienen ni un diacrítico; 11 de 18 verticales con cero. Sale por el endpoint **público sin auth** `GET /faqs/public/:tenantSlug` (`faqs.controller.ts:12-17`). Corrección: la parte más visible que uno supondría —el saludo del agente— no cuenta, porque no llega (ver §3). |

---

## 3. La cadena, dónde se corta

**Corte 1 — la persona vertical (el más grave, no sospechado)**

```
vertical-definitions.ts  agent.{name,role,greeting,rules,forbiddenTopics,handoffTriggers} ×18 verticales ×4 idiomas
  → verticals.service.ts:241-258  patchDefaultAgent escribe en la RAÍZ de config_json
  → agent_personas.config_json
  → persona.service.ts:469/:484/:497  se usa crudo como TenantConfig, sin normalizar
  ✂ persona.service.ts:141-191  buildGuidedPersonaBlock lee config.persona.* y config.behavior.*
```
Grep de `config.greeting` / `config.role` / `config.rules` / `config.forbiddenTopics` / `config.handoffTriggers` a nivel raíz en `apps/api/src/modules`: **cero lectores**. Lo único que sobrevive es la columna `agent_personas.name` (`verticals.service.ts:262-263`), que sí se muestra en el listado (`admin/agent/page.tsx:271`). Efecto observable: en seguros la lista dice "Roberto" (`vertical-definitions.ts:875`) y el bot se presenta como "Andrés" (`persona.service.ts:2157`); en pet_services "Toby" (`:712`) vs "Luna" (`persona.service.ts:2293`).

**Corte 2 — las FAQs**

```
verticals.service.ts:39-40 seedFaqs → :288-294 INSERT faqs (is_published=true)
  ✂ conversations.service.ts:1772  if (cfgTools?.faqs?.enabled === true)  ← nunca true
  ✗ prompt-assembler.service.ts   grep "faq" = 0 hits (no hay bloque de FAQs en ninguna capa)
  ✗ knowledge.service.ts          el RAG lee knowledge_embeddings/documents, nunca faqs
```
Único encendido automático: `persona.controller.ts:114-121` vía `customizations.enabledCapabilities` — campo que ningún cliente del monorepo envía (`setup-wizard/page.tsx:203`,`:224`). Queda el toggle manual del editor (`CapabilitiesSection.tsx:377`, arranca apagado).

**Corte 3 — la agenda**

```
persona.service.ts:2545 plantilla[0] con tools.appointments.enabled=true → :2566 INSERT agent_personas (sin gate)
verticals.service.ts:33-45 siembra services, NO slots  |  patchDefaultAgent :241 hace spread → preserva el flag
  → conversations.service.ts:1627-1639 el motor determinista se activa
  → booking-engine.service.ts:651-652 → checkAvailability :718
  → ai-tool-executor.service.ts:982-999 devuelve error:'appointments_not_configured'
  ✂ booking-engine.service.ts:724  solo evalúa (result.available && result.slots.length); el campo `error` no se lee
  → :734-736 borra state.date, vuelve a 'ask_date', responde msg('noAvailability')  → bucle
```
`appointments_not_configured` aparece **una sola vez en todo el repo** (`ai-tool-executor.service.ts:995`): nadie lo consume. El bucle tampoco autoescala: `failedAttempts` solo sube en el catch de excepción del LLM (`conversations.service.ts:2271-2284`) y se resetea en cada respuesta exitosa (`:2251-2261`), así que la regla `>=3` de `handoff.service.ts:101-103` nunca dispara.

**Corte 4 — el idioma del agente**

```
auth.service.ts:1580-1584 calcula tenantLang (BR/PT→pt, FR→fr)
  → persona.service.ts:2543 getVerticalTemplates(industry, tenantLang)
  ✂ persona.service.ts:1176  `lang` aparece exactamente una vez: en la firma. Nunca se usa en el cuerpo.
```
El `templateMap` (`:2489-2509`) cubre las 18 industrias, así que la rama que devolvería inglés (`:901-902`) es inalcanzable.

**Corte 5 — el asistente borra los flags verticales**

```
verticals.service.ts:758/:784/:814/:839/:865  enciende tools.{restaurants,gyms,homeServices,insurance,education,…}
  → persona.controller.ts:165-169  updateAgent(..., configJson: config)  ← config clonado de la plantilla
  ✂ persona.service.ts:758  config_json = $N::jsonb con JSON.stringify → REPLACE, no merge
```
Verificado que las plantillas de esas verticales no traen el flag (gimnasios `persona.service.ts:2111` = `{appointments, crm, knowledge}`; restaurantes `:1321` = `{appointments}`), y el mapeo de capacidades del wizard solo conoce appointments/catalog/crm/knowledge/faqs/offers (`persona.controller.ts:116-123`). No hay forma de recuperarlos desde ninguna UI.

---

## 4. Lo que sí llega (para no exagerar el diagnóstico)

| Sembrado | Destino | Lector real | ¿Lo percibe el cliente final? |
|---|---|---|---|
| Etapas de pipeline + colores + posición | `pipeline_stages` (`verticals.service.ts:209`) | Board CRM `pipeline.service.ts:1315,1406,1496`; auto-avance `:1312-1346` | No, pero gobierna dónde cae su lead |
| `transition_rules` (appointment/name/phone/email/offer/min_score) | `pipeline_stages.transition_rules` (`:214`) | `pipeline.service.ts:759` → `runRuleChecks :842-900`; aplica en drag manual y auto-avance | No |
| Servicios (si `bookingEnabled`) | `services` (`:313`) | `list_services` → `booking-engine.service.ts:261`, `:706-714` | **Sí**, texto literal por WhatsApp |
| Terminología (customerNoun, transactionNoun, serviceNoun) | `settings.verticalConfig` (`:115-134`) | `conversations.service.ts:1611-1620` → `prompt-assembler.service.ts:153-161`; regla 13 en `:82`; panel `useVerticalTerms.ts:12-16` | **Sí**, es lo único de la vertical garantizado en el prompt |
| Flags `tools.{tours,treatments,realEstate,pets,restaurants,gyms,…}` | `config_json.tools` (`:431-877`) | `conversations.service.ts:1818-1856` registra el toolset | Sí, **mientras sobrevivan al wizard** |
| Etiquetas del sidebar (`labelOverrides`) | `settings.verticalConfig` | `AppSidebar.tsx:355-356,440,443` | No |
| KPIs del dashboard | `settings.verticalConfig` | `admin/page.tsx:74-84`; las 6 claves existen en `analytics.service.ts:238-249` | No |
| `agent_personas.name` | columna | `admin/agent/page.tsx:271,563` | No (el bot usa `config.persona.name`) |
| `subType` | `settings` | `tenants.service.ts:678,702`; `vertical-analytics.service.ts:63,233` | No |
| FAQs | `faqs` | Portal público `faqs.controller.ts:12-17` y `/admin/knowledge/faqs` | Sí en el portal, **no** vía el bot |

También corresponde decirlo con claridad: **las FAQs que el tenant escribe en el asistente sí llegan a la IA**, porque van al KB (`setup-wizard/page.tsx:238-242`, `createKnowledgeDoc(..., "faq")`) y el RAG automático las levanta. El agujero es solo el de las FAQs que escribimos nosotros.

---

## 5. Problemas, por prioridad

| # | Problema | Severidad | Evidencia | Impacto | Esfuerzo |
|---|---|---|---|---|---|
| 1 | El asistente guiado reemplaza `config_json` entero y borra los flags de herramienta vertical | **crítica** | `persona.controller.ts:165-169` + `persona.service.ts:758` (REPLACE, sin `deepMergeConfig`); flags solo del bootstrap en `verticals.service.ts:758,784,814,839,865`; plantillas sin el flag (`persona.service.ts:1321,2111,2181,1747,2248,2316,2386`) | Gimnasio, restaurante, seguros, educación, servicios del hogar, pet services y fotografía pierden su toolset para siempre al completar el wizard. Sin recuperación desde UI | M |
| 2 | La persona vertical de las 18 industrias se escribe en un shape que nadie lee | **alta** | `verticals.service.ts:241-258` (raíz) vs `persona.service.ts:141-191` (`config.persona.*`/`config.behavior.*`); `buildDefaultPersona:312-366` fija el shape canónico; grep raíz = 0 lectores | Reglas de negocio, temas prohibidos y disparadores de handoff por industria nunca aplican. Nombre partido: lista dice "Roberto", bot dice "Andrés" | S |
| 3 | Verticales con agenda: herramienta encendida + cero `availability_slots` → bucle de "no hay disponibilidad" | **alta** (reportada crítica; el wizard mitiga) | Cadena completa en §3 corte 3. Mitigante no visto en el rastreo original: `persona.controller.ts:133-152` auto-apaga si slots=0, y ese paso del wizard (índice 1) corre **antes** de conectar canal (`setup-wizard/page.tsx:265-270`) | Afecta a quien saltea/abandona el asistente (`persona.controller.ts:226-247`, `admin/page.tsx:143`). Falla silenciosa: ni el tenant ni la plataforma se enteran | S |
| 4 | Todo tenant no hispanohablante recibe su agente en español | **alta** | `persona.service.ts:1176`: `lang` solo aparece en la firma; `templateMap:2489-2509` cubre las 18 industrias; ejemplo `:1186-1192` greeting en castellano | El brasileño ve panel, FAQs y etapas en portugués y el bot le habla en español. Más visible que cualquier tilde | L |
| 5 | El bootstrap no es idempotente: los `ON CONFLICT DO NOTHING` no pueden dispararse | **alta** *(sin verificar adversarialmente)* | `verticals.service.ts:212,292,316,417,547,648` sin target; `tenant-schema.sql:571-585` (pipeline_stages), `:1260-1274` (services), `:1507-1525` (faqs) solo tienen PK UUID, ningún UNIQUE | Cualquier re-seed futuro duplica etapas, FAQs y servicios en silencio. Hoy solo salva el guard de `auth.service.ts:1519-1555` | S |
| 6 | Cambiar de industria deja al tenant con la vertical vieja para siempre | **alta** *(sin verificar)* | `tenants.service.ts:209-227` invalida `tenant:{id}:config`/`:schema` pero **no** `vertical:{tenantId}` ni reescribe `settings.verticalConfig`; `getVerticalConfig` prioriza ese objeto (`verticals.service.ts:157,163`) | El super_admin corrige la industria y el prompt sigue diciendo "paciente". Sin diagnóstico posible desde la UI | M |
| 7 | Las FAQs semilla son inalcanzables para la IA (S1) | **media** | §3 corte 2 | Acotado: horarios, servicios y precios ya están en el prompt (`prompt-assembler.service.ts:113,128-151,188-196`). Lo genuinamente perdido: métodos de pago, documentos, política de cancelación y los extras de tours/dental/inmobiliaria. El L1 prohíbe inventar (`:69`), así que degrada a fallback/handoff, no a alucinación | XS |
| 8 | El motor de reservas descarta `appointments_not_configured` | **media** | `ai-tool-executor.service.ts:993-998` lo emite; `booking-engine.service.ts:724` no lo lee; grep = 1 sola aparición en todo el repo | Convierte una falla detectable en un bucle mudo dentro de la conversación (la condición sí se ve en el panel y en Loki) | XS |
| 9 | `assertAppointmentsPrerequisites` protege la tabla equivocada | **media** | Definido en `persona.service.ts:2581-2603`, invocado solo desde `:81-84` (`savePersonaFromYaml` → `persona_config`, legacy). `createAgent:608`, `updateAgent:701` y `createDefaultAgentFromGoals:2566` escriben `agent_personas` sin gate; el runtime lee `agent_personas` primero (`:445-508`) | El estado malo nace en el alta, no en el editor. La reja de la UI (`CapabilitiesSection.tsx:46-50`) se evade por API | S |
| 10 | El auto-disable del wizard deja al agente prometiendo turnos sin poder tomarlos, y nadie lo reactiva | **media** | `persona.controller.ts:133-152` apaga en silencio (solo `logger`); `appointments.service.ts:508-528` no toca personas ni emite evento. La promesa viene del contrato L1 (`prompt-assembler.service.ts:78`, regla 9, incondicional) y de la plantilla (`persona.service.ts:1190,1195`) — **no** de `vertical-definitions.ts:37`, que no llega | Recuperable por el tenant en Agente → Herramientas (`CapabilitiesSection.tsx:222-253`), pero nadie le avisa | M |
| 11 | Contenido semilla sin tildes en el texto público (S3) | **media** *(dato verificado; impacto sin ronda adversarial)* | `vertical-definitions.ts:66,67,69,141,213,216,288`; 86% de las cadenas `es` que lee el cliente sin diacríticos; contamina además el `to_tsvector('simple', …)` de `verticals.service.ts:291` | Portal KB público y respuestas del bot con faltas de ortografía firmadas por el negocio del tenant | M |
| 12 | `/admin/settings/company` escribe la industria en la tabla **global** `platform_settings` | **media** *(sin verificar)* | `settings/company/page.tsx:53-57` → `PUT /settings` (`settings.controller.ts:27-49`, `@Roles('super_admin','tenant_admin')`, **sin TenantGuard**) → `settings.service.ts:89-93`. Página huérfana: no está en `_settings-config.ts:57-67` | El tenant cree que cambió su industria y no cambió nada; y un `tenant_admin` puede sobrescribir config global compartida | S |
| 13 | `definition.businessHours` existe para las 18 verticales y no se siembra ni se lee | **media** *(sin verificar)* | Definido en `vertical-definitions.ts:77-80,149-152,223,295,369,426,469,503,673,757,842,918,1003,1089`; `bootstrapVertical:33-134` no lo toca; el pipeline lee `tenant.settings.businessHours` (`conversations.service.ts:920`) | El tenant arranca sin horario comercial, y es la fuente natural (ya escrita y traducida) para sembrar los slots del #3 | S |
| 14 | Campos del contrato vertical con lector sin dato o dato sin lector | **baja** *(sin verificar)* | `sla_hours` se escribe (`verticals.service.ts:213`) y se lee (`pipeline.service.ts:576,677,937`) pero ninguna vertical define `slaHours` → siempre NULL; `sidebar.itemOrder` lo lee `AppSidebar.tsx:359` y nadie lo define; `verticalConfig.bookingEnabled` se persiste y solo lo usa el propio seeder (`:43`); `terminology.pipelineNoun` no llega al prompt; `'catalog'` en `hiddenItems` no matchea ningún labelKey; `definition.deferred` (`:435`) sin lector | Falsa sensación de configurabilidad. La maquinaria de SLA por etapa está construida y nunca se activa | S |
| 15 | El servidor MCP expone `search_faqs` sin gate de configuración | **baja** *(sin verificar)* | `mcp-server.service.ts:19-30` (`EXPOSED_TOOLS` incluye `FAQ_TOOL`), `tools/list :77-80` sin consultar `config.tools` | Un cliente MCP externo lee las FAQs que el propio agente del tenant no alcanza. Read-only y autenticado, pero muestra divergencia entre las dos listas de tools | S |
| 16 | `bootstrapVertical` escribe `config_json` y servicios sin invalidar sus caches | **baja** *(sin verificar)* | El archivo solo usa Redis para `vertical:{tenantId}` (`:147,:190`); `persona:{tenantId}:channel:*` tiene TTL 600s (`persona.service.ts:448-452`) y `booking:services:{tenantId}` 300s (`booking-engine.service.ts:254-265`); `invalidatePersonaCaches` existe en `persona.service.ts:579-600` | Nulo en el alta (caches fríos), pero hace inseguro cualquier re-seed sobre un tenant vivo | XS |

---

## 6. Qué hacer

**Arreglo real, por relación impacto/esfuerzo:**

1. **Preservar `tools` en el guardado del wizard** (#1). En `persona.controller.ts` (antes de `:165`) leer el `config_json` actual del agente por defecto y fusionar la clave `tools`; o hacer que `updateAgent` (`persona.service.ts:701-787`) aplique `deepMergeConfig` sobre `tools` en vez de reemplazar. Es el único hallazgo que destruye funcionalidad ya entregada. — *M*
2. **Corregir el shape de `patchDefaultAgent`** (#2). En `verticals.service.ts:241-258`, escribir `persona: { ...existing.persona, name, role, greeting, personality:{tone,formality} }` y `behavior: { ...existing.behavior, rules[], forbiddenTopics[], handoffTriggers[] }`. Ojo: `rules` viene como string en la definición y el lector espera array (splitear como ya se hace en `:252-257`). Decidir además si el patch pisa a la plantilla o solo rellena huecos — hoy la plantilla es la fuente real y está mejor escrita. — *S*
3. **Cerrar el agujero de la agenda por los dos lados** (#3, #8, #9). (a) Llamar `assertAppointmentsPrerequisites` desde `createDefaultAgentFromGoals` (`persona.service.ts:2566`), `createAgent` (`:608`) y `updateAgent` (`:701`) cuando `tools.appointments.enabled === true`; (b) en `booking-engine.service.ts:724`, si `result.error === 'appointments_not_configured'` → mensaje i18n + handoff en vez de `msg('noAvailability')`; agregar la clave a los 4 idiomas del diccionario (`:20-140`). Los dos son baratos y el segundo convierte un bucle mudo en una escalada honesta. — *XS + S*
4. **Sembrar `availability_slots` desde `definition.businessHours`** (#3, #13). Un `seedAvailability(schemaName, definition)` en `verticals.service.ts` cuando `definition.bookingEnabled`, convirtiendo `{mon:'08:00-18:00',…}` a filas. Ojo al shape: `buildGuidedPersonaBlock` (`persona.service.ts:210-233`) espera `{is247, timezone, schedule:{dia:{open,close,enabled}}}`, no el string del registry. Resuelve de raíz el #3 y le da destino al dato muerto. — *S*
5. **Encender `tools.faqs` en el bootstrap** (#7). `await this.enableSimpleTool(schemaName, 'faqs')` después de `seedFaqs` (`verticals.service.ts:40`), siguiendo el patrón ya usado 11 veces (`:51-112`). **Con una condición**: ese contenido lo escribimos nosotros sin validación del tenant ("aceptamos efectivo, tarjeta y transferencia", "cancelaciones tardías generan cargo del 50%"). Encenderlo a ciegas hace que el bot afirme políticas de pago y cobro no confirmadas por el negocio. Lo correcto es encenderlo **junto con** una revisión del texto, o marcar esas FAQs como borrador hasta que el tenant las apruebe. — *XS*
6. **Índices únicos + targets explícitos** (#5). `CREATE UNIQUE INDEX` sobre `pipeline_stages(tenant_id, slug)`, `services(name)`, `faqs(question)` en `tenant-schema.sql` (es aditivo, respeta expand-contract) y apuntar los `ON CONFLICT`. Prerrequisito de cualquier endpoint de re-seed. — *S*
7. **Re-bootstrap al cambiar de industria** (#6). En `tenants.service.ts:update`, borrar `vertical:{id}`, reconstruir `settings.verticalConfig` y llamar `invalidatePersonaCaches`. Depende del #6 anterior para no duplicar. — *M*
8. **Idioma del agente** (#4). Parche honesto e inmediato: para `lang !== 'es'`, construir la persona desde `VERTICAL_REGISTRY[industry].agent[lang]` (que ya existe traducido en los 4 idiomas) en vez de la plantilla castellana. Se combina naturalmente con el arreglo #2 y evita traducir 40 plantillas. — *L → S si se hace junto con #2*
9. **Revisar `PUT /settings`** (#12). Verificar qué claves acepta y si alguna es sensible; restringir a `super_admin` o scopear por tenant. Y decidir el destino de la página huérfana. — *S*

**Cosmético / higiene (no urgente):**

- Pasada ortográfica sobre las cadenas `es` de `vertical-definitions.ts` (#11), usando como referencia de estilo las verticales Tier 3 que ya están bien escritas (`:665-671`, `:745-751`, `:830-835`, `:910-915`). Complementario: cambiar `to_tsvector('simple', …)` por `'spanish'` con unaccent para que el matching no dependa de las tildes.
- Decidir por campo el destino de `slaHours`, `itemOrder`, `bookingEnabled`, `pipelineNoun`, `deferred` y los `hiddenItems` redundantes (#14): poblarlos o borrarlos.
- Invalidar `persona:*` y `booking:services:*` al final de `bootstrapVertical` (#16).
- Filtrar `EXPOSED_TOOLS` por la config del agente (#15).
- Marcar el resultado del bootstrap en `settings` (`{at, ok, failedSteps[]}`) y exponerlo en el checklist: hoy `auth.service.ts:1691-1706` traga el error y el backfill de `getVerticalConfig:163-187` solo repone lo cosmético, así que un fallo transitorio deja al tenant a medias con la UI viéndose bien.

---

## 7. Qué no pudimos verificar

- **Sin ronda adversarial**: los hallazgos #5, #6, #12, #13, #14, #15, #16 y el impacto del #11 quedaron con una sola pasada de lectura. El mecanismo de cada uno está anclado en líneas leídas, pero no se buscaron activamente mitigantes ni caminos alternativos, que es exactamente donde la verificación bajó severidades en el resto (tres de los cinco "graves" pasaron de alta/crítica a media al aparecer mitigantes reales).
- **Del #1 (el wizard borra los flags) tengo la confirmación pero no el ajuste de severidad** de la ronda adversarial: la verificación quedó cortada. El mecanismo está confirmado línea por línea (`persona.service.ts:758` hace REPLACE); lo que no puedo afirmar es si existe algún mitigante que reduzca la población afectada, como pasó con el #3.
- **Nada se ejecutó**: todo es lectura estática. No se corrió un alta real contra una base para observar el `config_json` resultante ni una conversación de prueba. La afirmación más fácil de comprobar empíricamente —y la que más conviene comprobar antes de tocar nada— es el #2: dar de alta un tenant de seguros y ver si el bot se presenta como "Roberto" o como "Andrés".
- **No se midió frecuencia**: cuántos tenants reales saltean el asistente (población del #3) vs. cuántos lo completan (población del #1) es dato de producción, no de código. Los dos caminos son mutuamente excluyentes, así que esa proporción decide cuál de los dos arreglos va primero.
