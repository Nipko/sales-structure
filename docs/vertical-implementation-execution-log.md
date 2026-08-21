# Registro de ejecución — Programa de verticales 1:1 (ago 2026)

**Inicio:** 2026-08-20
**Fuentes rectoras:** `AGENTS.md`, `docs/vertical-full-implementation-plan-2026-08.md`, `docs/agent-tool-subtype-cohesion-audit-2026-08.md`, `docs/vertical-subtype-prompt-navigation-audit-2026-08.md`, `docs/country-language-behavior-packs-latam-2026-08.md`, `docs/vertical-subtype-market-audit-2026-08.md`, scorecards CSV 1:1 (76 perfiles).

Este documento es el registro operativo, no un diagnóstico nuevo. Cada unidad ejecutable se anota con archivos tocados, pruebas corridas y resultado.

## 0. Baseline del worktree

| Ítem | Estado |
|---|---|
| Rama | `main` |
| Cambios preexistentes | 9 documentos sin trackear en `docs/` (las fuentes rectoras + scorecards). **Conservados intactos.** |
| `apps/api` `tsc --noEmit` | ✅ exit 0 (baseline limpio) |
| `apps/dashboard` `tsc --noEmit` | pendiente |
| Suite jest | pendiente (usar `--maxWorkers=2`; `--runInBand` no termina) |

## 1. Conteos canónicos (invariantes del programa)

- 18 verticales
- 75 subtipos + `otro` = **76 configuraciones**
- 95 tools estáticas

## 2. Bitácora por unidad

### U2 — P0-2 · Exponer Resource Rentals al agente (vehículo y boarding)

**Fase 2 · Épica H · Paquetes "Resource Rentals", "Alquiler vehículo" y "Boarding pet"**

`ResourceRentalsService` ya tenía locks por recurso, solapamiento medio-abierto y capacidad por noche, y `/admin/resource-rentals` ya mostraba el objeto. Lo que no existía era una puerta conversacional: el manifiesto prometía la capability, el menú mostraba el registro y toda reserva terminaba en handoff. En guardería era peor: `check_daycare_availability` contaba la ocupación en `appointments` mientras la reserva se escribe en `resource_rentals` — dos contadores del mismo cupo, así que el cliente podía oír "sí hay lugar" y ser rechazado en el mismo turno.

**ADR-002 — `resource_rentals` es el único SoR de alquiler de vehículo y de estadías de mascota.**
La disponibilidad ahora deriva de `ResourceRentalsService.checkAvailability`, que ejecuta las MISMAS consultas de solapamiento y capacidad que el writer. No queda ningún segundo contador. Reversible por feature flag: apagar `tools.vehicleRentals` / `tools.petBoarding` devuelve el perfil a handoff honesto sin tocar datos.

**Servicio** (`resource-rentals.service.ts`)
- `list()` acepta `contactId` y `activeOnly` — la propiedad se filtra en la consulta, no después de cargar reservas ajenas al contexto del modelo.
- `getById()`, `checkAvailability()` y `cancelForContact()` nuevos. `cancelForContact` verifica dueño dentro de la misma transacción que escribe: `transition()` sigue siendo el camino del panel y exige rol de staff.

**Tools nuevas (9)** — `tools/resource-rental-tools.ts`
`check_vehicle_rental_availability`, `create_vehicle_rental`, `list_my_vehicle_rentals`, `get_vehicle_rental`, `cancel_vehicle_rental`, `create_pet_boarding`, `list_my_pet_boardings`, `get_pet_boarding`, `cancel_pet_boarding`. Total de tools estáticas: **95 → 104**, con paridad definición/executor/policy verificada en CI.

**Contrato**
- `VerticalToolGroup` += `vehicleRentals`, `petBoarding`; `VerticalPrimaryObject` += `vehicle_rental`, `pet_boarding`; `VerticalReadinessKey` += `boarding_capacity`.
- Manifiesto: `automotriz/alquiler` y `pet_services/{guarderia,hotel}` reciben el grupo que su capability prometía desde siempre. `peluqueria`, `paseos`, `adiestramiento`, `concesionario`, `taller` y `repuestos` **no** lo reciben.
- `VERTICAL_TOOL_CAPABILITY` mapea los dos grupos nuevos; `PRIMARY_OBJECT_ROUTE` mapea ambos objetos a `/admin/resource-rentals`.
- `ToolsConfig` compartido: se agregan `vehicleRentals`, `petBoarding` y **`vehicles`**, que dashboard y runtime leían desde siempre sin estar declarado (hallazgo 7.2 de la auditoría de tools).
- Agent Test registra los mismos dos grupos (paridad parcial hacia P0-12).
- i18n `vt_vehicleRentals_*` / `vt_petBoarding_*` en es/en/pt/fr.

**Writers con contrato completo:** confirmación `runtime_enforced`, idempotencia `state_guarded`, ownership `resource_owner` en cancelaciones, `humanRoute` a `/admin/resource-rentals?...` en cada respuesta, y conflicto tipado (`rental_conflict` con `conflictStart`/`conflictEnd`/`fullNight`/`capacity`) en vez de "falló".

**Pruebas**
- `resource-rental-tools.spec.ts` (26 casos): contrato de policy, gating por subtipo (positivo y negativo), disponibilidad libre/ocupada/rota, writer feliz, dato faltante, conflicto, ownership ajeno, cruce de dominios vehículo↔mascota, cupo re-sourceado, estadía de un día = una noche, sin servicio configurado, y fallo de lectura que no se convierte en "no hay cupo".
- `tool-policy-registry.spec.ts`: conteo canónico 95 → **104** con los 9 nombres nuevos listados explícitamente. La aserción de paridad se mantiene intacta.
- `agent-test.service.spec.ts`: el fixture `ALL_TOOL_FLAGS` se completa con los dos grupos nuevos (la aserción es igualdad de conjuntos, así que el fixture debe ser exhaustivo).

**Verificación**
```
npx tsc --noEmit                                    → exit 0
npx jest --testPathPattern=bootstrap                → 1/1 ✅ (DI limpio)
npx jest --maxWorkers=2  (suite completa)           → 2344 passed, 269/270 suites
```
El único fallo de la suite completa es `app.bootstrap.spec.ts` por variables de entorno ausentes en el shell, no por código. Comando reproducible:
```
JWT_SECRET=x JWT_REFRESH_SECRET=y INTERNAL_JWT_SECRET=z ENCRYPTION_KEY=<64 hex> \
NODE_OPTIONS=--max-old-space-size=8192 npx jest --maxWorkers=2
```

**Perfiles desbloqueados (3):** `automotriz/alquiler`, `pet_services/guarderia`, `pet_services/hotel` — pasan de "el agente promete y deriva" a "el agente cierra sobre el mismo registro que ve el humano".

### U3 — P0-3 · Split-brain de alojamiento: `property_bookings` vs Channel Manager/Hostaway

**Fase 2 · Épica F/H · Paquete "Channel Manager" (tamaño XL del plan)**

Estado encontrado: **tres registros independientes de la misma noche.** `property_bookings` tenía las tools de IA, los pagos y el cron de iCal. `cm_reservations` se llenaba solo con un botón manual — sin cron pese al campo `syncInterval`, sin webhooks y sin write-back. No existía puente en ninguna dirección (`grep` cruzado: 0 coincidencias); el único vestigio era `cm_listings.property_id`, una columna que nadie leía ni escribía. Los dos podían vender la misma noche.

**ADR-003 — Regla asimétrica: las lecturas suman, las escrituras fallan cerradas.**
El peligro está en la dirección de escritura, así que el tratamiento no es simétrico:
- **Leer:** una propiedad enlazada a una publicación del channel manager suma `cm_reservations` a su conjunto de conflictos. El agente ya no ofrece una noche que el PMS vendió.
- **Escribir:** cuando el channel manager es dueño de la unidad, el writer local queda **apagado** y el turno va a un humano. Escribir localmente crearía una reserva que el PMS nunca conoce — un doble booking con pasos extra. El write-back a Hostaway exige credenciales verificadas y mapeo certificado por versión de proveedor; hasta entonces la respuesta honesta es "lo confirma el equipo".
Reversible: desenlazar la propiedad (`PUT /channel-manager/mappings` con `propertyId: null`) devuelve la unidad al writer local.

**Nuevo**
- `channel-manager/lodging-source-of-truth.service.ts` — resuelve por propiedad `{sor, connected, provider, listingId, lastSyncedAt, stale, health, writerBlockedReason}`, cacheado 60 s. Falla **abierto a local** (un tenant sin integración es el caso común) pero nunca degrada a local una unidad que sí está enlazada: mapeo y config se leen juntos.
- `channel-manager/channel-manager-sync.service.ts` — el cron que `syncInterval` prometía y nadie ejecutaba. Tick cada 15 min, sincroniza solo los tenants cuyo intervalo venció, bajo `CronLockService` (`prefer: 'worker'`, TTL 450 s) porque API y worker arrancan el mismo `AppModule` y si no cada sync pegaría dos veces contra el rate limit del proveedor. **Pull-only**, declarado como tal.
- `PUT /channel-manager/mappings` + `GET /channel-manager/mappings` — enlazar/desenlazar una propiedad con una publicación. Uno-a-uno estricto: una publicación ya enlazada a otra propiedad se rechaza con `property_already_mapped` en vez de re-apuntarse en silencio. Invalida el caché del resolutor.

**Modificado**
- `PropertiesService.checkAvailability(..., tenantId?)` — suma conflictos del espejo y devuelve `source`, `asOf`, `stale`, `health`, `canBookDirectly`, `writerBlockedReason`.
- `PropertiesService.createBooking` — rechaza con `ConflictException('channel_manager_owns_calendar')` **antes de abrir la transacción**.
- Executor: `check_property_availability` explica que el equipo confirma; `create_property_booking` devuelve `shouldHandoff: true` con proveedor y frescura, y tipa además `duplicate_property_booking`. El `catch` genérico ya no filtra `e.message` (podía traer SQL) al modelo.
- `tenantId` se propaga por `listProperties`, `check_property_availability`, `create_property_booking` y las dos rutas del controlador. El `tenantId` del body se ignora: manda el del parámetro autenticado.

**Decisión de seguridad no obvia:** un espejo **ilegible** devuelve un conflicto bloqueante, no un conjunto vacío. Tratar "no pude leer `cm_reservations`" como "no hay nada reservado" es exactamente el doble booking que este guard existe para impedir.

**Pruebas** — `lodging-source-of-truth.spec.ts` (16 casos): local no consulta el espejo; noche vendida en Hostaway bloquea; espejo ilegible ≠ libre; stale/health declarados; sin resolutor inyectado se comporta como local; el writer rechaza **antes** de abrir transacción; el mensaje de rechazo no filtra SQL ni identificadores; unidad propia sí escribe; y los 8 casos del resolutor (sin conexión, `direct`, conectado-sin-enlazar, enlazado, espejo viejo, nunca sincronizado, tablas ausentes, caché).

**Verificación**
```
npx tsc --noEmit                          → exit 0
npx jest --maxWorkers=2 (suite completa)  → 2361 passed / 271 suites, 0 fallos
```

**BLOQUEO EXTERNO registrado:** el write-back Hostaway (`create/update/cancel` hacia el PMS) requiere credenciales de sandbox del proveedor y certificación por versión de API. Queda `STOP` con comportamiento fail-closed + handoff, no simulado. Perfiles afectados: `turismo/hotel`, `turismo/alquiler_vacacional` cuando el tenant usa channel manager. Sin channel manager, ambos operan con writer local completo.

### U4 — P0-4/5/6 · Honestidad de tools: MCP, descuento y OTP

**Fase 2 · Épica H · Paquete "Tool honesty"**

Tres affordances que el modelo veía y no podía usar. Las tres tienen la misma forma: la publicación se decidía en un lugar y la ejecución en otro, y nadie los cruzaba.

#### P0-4 — MCP: descubrir no es autorizar

`conversations.service.ts` anunciaba al modelo **toda** tool que reportara un servidor MCP conectado, mientras `tool-execution-control.service.ts` rechazaba **toda** llamada `mcp__*` con `opaque_tool_not_approved`. El modelo perseguía una capacidad que jamás podía dispararse, y el panel decía "conectado", que un dueño lee como "funcionando".

**ADR-004 — La publicación MCP es consecuencia de una policy revisada por tool, no de que exista una conexión.**
Una tool MCP es una función remota de efecto desconocido: puede cobrar, mutar un registro de terceros o filtrar datos, y nada en `tools/list` lo dice. Por eso se declara a mano: `effect`, `requiresConfirmation`, `requiresHumanApproval`, `approvedBy`, `approvedAt`. Sin aprobación queda **inspeccionable, no ejecutable**.

- `mcp/mcp-tool-approval.ts` + `mcp/mcp-approval.types.ts` (nuevos) — contrato y lectura defensiva de `tenant.settings.mcpToolApprovals`. Un registro malformado se descarta, nunca se asume aprobado.
- `McpClientService.listPublishableTools()` / `getApproval()` / `listApprovals()` / `setApproval()`. Aprobar un efecto no-lectura **sin** confirmación se rechaza con 400 en vez de guardarse e ignorarse: un dueño que tilda "que la IA cobre" y ve que se guardó, cree que funciona.
- `GET /mcp/:tenantId/tools` ahora devuelve `authorizedForAgent` por tool + `meta.discovered` vs `meta.authorizedForAgent`. `PUT /mcp/:tenantId/tool-approvals` registra/revoca; `approvedBy` sale del usuario autenticado, nunca del body — una traza que el llamador puede falsificar no es una traza.
- El guard central lee **la misma** aprobación (`request.mcpApproval`, resuelta por el executor que ya tiene el cliente MCP) y falla cerrado. Publicación y ejecución ya no pueden discrepar en ninguna dirección.

#### P0-5 — `apply_discount`: publicación atada a que alguien pueda aplicarlo

Se registraba desde `tools.ecommerce.canApplyDiscount` a secas. El único proveedor vivo (`TenantMercadoPagoOperationProvider`) declara `supports(kind) === 'payment_link'` y nada más, así que **cada** llamada terminaba en `handoffUnavailable`. Además, `upsell.maxDiscountPercent` solo llegaba al prompt: el backend aceptaba 1–30 sin importar el techo del negocio.

- `PaymentRuntimeCapability` gana `discountsAvailable`, derivado de `planEnabled && supports('discount') && provider.ready`. No se infiere de `ready`: un proveedor puede estar sano para links y no tener descuentos.
- `discountToolsForRuntime()` — tres condiciones independientes y todas obligatorias: toggle del agente, techo utilizable y proveedor capaz. La tercera es la que faltaba.
- `applyDiscount(..., maxPercent?)` — el techo del tenant se aplica **server-side**. Techo 0 ⇒ `discounts_disabled` + handoff. El error informa `maxPercent` para que el agente no adivine.
- El contrato del proveedor se acotó a `Omit<..., 'planEnabled' | 'discountsAvailable' | 'maxDiscountPercent'>`: un proveedor no puede declarar una capacidad de dinero que no implementó.

**Resultado neto hoy:** con los proveedores actuales `apply_discount` **no se publica**. Se reactiva sola el día que un proveedor implemente la operación — no hay que acordarse de volver a encenderla.

#### P0-6 — El OTP se deriva de las policies A2 efectivas

La publicación del par OTP era una lista escrita a mano de cuatro familias (`insurance`, `appointments`, `treatments`, `professionalServices`), mientras el `assurance` que dispara la verificación vive en la policy de cada tool. Cualquier tool A2 fuera de esa lista — `get_check_in_instructions` en un alquiler, `get_vaccination_status` en una peluquería, `get_case_status`, `list_my_claims` — hacía que el guard mandara un código que el agente no tenía cómo consumir. El cliente escribía el código en una conversación que no podía leerlo y el turno giraba hasta escalar.

- `identity-step-up-registration.ts` (nuevo) — `identityStepUpToolsFor(tools)` recorre las tools realmente publicadas y consulta `ASSURANCE_LEVEL_MATRIX[...].requiresStepUpIdentity`. La derivación corre **al final**, después de registrar todas las familias, para ver el conjunto real.
- El par OTP se **fija** (`pinned`) en el recorte de 10 tools. No es un writer confirmable, así que el pin de writers lo ignoraba: el recorte podía descartar `verify_identity_code` justo en el turno en que el cliente escribía su código.

**Pruebas** — `tool-honesty.spec.ts` (15 casos) + `payment-tool-registration.spec.ts` (reescrito, 10 casos): derivación OTP por cada tool A2 del registro (recorrido exhaustivo, no una muestra), sin cerradura no hay llave, la llave sola no cuenta como cerradura, no duplica; MCP sin aprobaciones publica cero, lectura aprobada sí, escritura sin confirmación **no**, registros malformados se descartan; descuento sin toggle / sin proveedor / con techo 0 / completo.

`payment-operation.service.spec.ts`: dos aserciones de forma exacta se actualizan con `discountsAvailable: false` — el valor correcto en ambos escenarios (plan caído y ledger caído), no una relajación.

**Verificación**
```
npx tsc --noEmit                         → exit 0
npx jest --maxWorkers=2 (suite completa) → 2379 passed / 272 suites, 0 fallos
```

### U5 — P0-7 · Procedures compilado contra agente/subtipo/plan + registro único de tools

**Fase 1 (contratos) + Fase 2 · Épica H · Paquete "Tool honesty"**

Procedures combinaba dos defectos opuestos: podía **saltarse** el gating del agente y, al mismo tiempo, **no le pasaba** a la tool los datos que acababa de recoger.

- Cargaba todos los procedimientos activos con `WHERE status = 'active'` y nada más, ignorando el campo `vertical` que ya guardaba en cada fila. Un procedimiento escrito para el restaurante se disparaba dentro de una conversación del gimnasio del mismo tenant.
- Aceptaba cualquier string como nombre de tool y lo mandaba al executor tal cual, sin `opts` — sin `channelType`, sin contexto de ejecución. Un paso podía correr una familia que el agente tenía apagada.
- Pasaba `step.config.args` **literal**. El propio ejemplo del compilador pide `numero_orden` al cliente y llama a `get_order_status` con `"args": {}`: el número que el cliente acababa de escribir nunca podía llegar. Las tools con scope de contacto parecían funcionar solo porque `contactId` es un parámetro posicional.

**Registro único de tools** — `conversations/agent-tool-registry.ts` (nuevo)

`staticToolsForAgentConfig(cfgTools)` es ahora **la** lista de familias. Antes era una cadena de `if (cfgTools?.x?.enabled)` escrita tres veces: en `generateResponse`, en `agent-test.service` y ausente por completo del motor de procedimientos. Esa duplicación es la causa directa de dos síntomas del audit — Procedures llamando familias apagadas y Agent Test anunciando un conjunto distinto de producción.

- `conversations.service.ts`: 25 bloques `if` colapsados a una línea; **17 imports muertos** eliminados.
- `agent-test.service.ts`: su copia de la lista colapsada a la misma llamada; 24 imports muertos eliminados. Una tool nueva ya no puede existir en producción y faltar en Agent Test.
- Separación explícita: el registro responde *"qué autoriza la config de este agente"*, no *"qué es ejecutable ahora"*. Plan, cuota, salud del proveedor y readiness siguen siendo puertas por turno — una tool puede estar autorizada y ser rechazada al ejecutar, que es el orden correcto.

**ADR-005 — Un paso `tool` sin contrato de agente no ejecuta nada.**
Sin contexto no se puede distinguir una tool autorizada de una arbitraria, así que nada está autorizado. Un procedimiento que se frena es recuperable; uno que corre una tool que el tenant apagó, no.

**ADR-006 — `refund_payment` es nombrable por un SOP escrito a mano, nunca por el modelo.**
Nunca se anuncia al LLM (`payment v1` la deja fuera a propósito), así que el modelo no puede elegirla. Un paso autorizado por el tenant es otra cosa: el guard central le sigue exigiendo A4, confirmación explícita, ticket de aprobación humana, ownership y ledger de idempotencia antes de mover un peso.

**Interpolación tipada** — `conversations/procedure-slot-interpolation.ts` (nuevo)

`{{ campo }}` con rutas por punto sobre `state.collected`. Un placeholder que ocupa todo el string **conserva el tipo** del valor; embebido en texto interpola como string. `step.config.slots` declara `type` (`string|number|integer|boolean|date|uuid`) y `required`; la coerción es estricta — `"tres"` no es `3`, y dejarlo pasar como `NaN` llegaría a la tool como un argumento silenciosamente equivocado. Un placeholder sin resolver **frena el paso** en lugar de llamar con el literal, que es cómo se crea una reserva a nombre de `{{ guest_name }}`.

**Filtro por vertical:** `vertical` vacío = horizontal (aplica a todo); con valor, matchea contra industria **o** subtipo, porque los autores etiquetan con lo que piensan. Se selecciona también en la ruta de reanudación: un procedimiento re-etiquetado a mitad de conversación se abandona limpio en vez de continuar porque la consulta de resume olvidaba preguntar.

**Pruebas** — `procedure-compilation.spec.ts` (24 casos): tool autorizada / fuera de familia / sin contrato (fail-closed) / mensaje que no filtra nombres internos; vertical ajena, propia, por subtipo, horizontal y re-etiquetado en curso; interpolación feliz y placeholder sin resolver; 8 casos de interpolación tipada (tipo conservado, texto embebido, coerción, tipo inválido, fecha imposible `2026-02-31`, requerido ausente, literal intacto, ruta con punto); 5 casos del registro único.
`procedure-engine.central-controls.spec.ts` recibe el contrato de agente que el gate ahora exige — el invariante que probaba (handshake del writer) queda intacto.

**Verificación**
```
npx tsc --noEmit                         → exit 0
npx eslint (archivos tocados)            → limpio
npx jest --maxWorkers=2 (suite completa) → 2403 passed / 273 suites, 0 fallos
```

### U6 — P0-8 · Semántica de lectura: `empty` ≠ `stale` ≠ `provider_down` ≠ `error`

**Fase 2 · Épica H · Paquete "Tool honesty"**

El guard de outcome define éxito como *"el objeto no trae `error`"* (`outcome-claim.util.ts:61-67`). Varias lecturas atrapaban la excepción y devolvían la colección vacía **sin** ese campo, así que una consulta que reventó se clasificaba como exitosa y respaldaba una afirmación al cliente.

| Handler | Antes | Ahora |
|---|---|---|
| `list_customer_orders` | `{orders: []}` tras excepción → "no tenés pedidos" | `status:'error'` + `error:'read_failed'`, sin `orders` |
| `list_active_offers` | `{offers: []}` tras excepción | idem |
| `search_knowledge_base` | `{chunks: []}` tanto sin KB como tras fallo | `empty` con motivo / `empty` sin resultados / `error` |
| `check_stock` | el `catch` caía a `{error:'Product not found'}` | `error` si falla; `empty` con `product:null` si de verdad no existe |
| `get_customer_context` | 3 catches silenciosos → `{contact:null, lead:null, opportunitiesCount:0}` | contacto roto ⇒ `error`; CRM parcial ⇒ `ok` + `health:'degraded'` + `unreadable:[...]` + `opportunitiesCount:null` |
| familia `list_my_*` | `{bookings: [], error}` — ambiguo | solo el fallo; la colección vacía se descarta |

Perder una venta por una caída es malo; decirle al cliente que **no vendemos** lo que pidió es peor, porque se va y no vuelve. Ese es el caso de `check_stock`. Y `get_customer_context` era el peor de todos: una base caída se leía como "cliente nuevo", y el agente saludaba como desconocido a un cliente de diez años.

**Contrato compartido** (creado en U1, aplicado acá): `readOk` detecta el vacío **desde el payload**, así que nadie puede reportar `ok` con cero filas. Cada lectura declara `source` y `asOf`; `stale` se deriva del presupuesto de frescura por fuente (`tenant_db` = 0 porque se lee en vivo; un espejo de channel manager, 1 h).

**Fuga de texto del driver:** ~50 handlers hacen `return { error: e.message }`, y el texto crudo iba en `error`, no en `message` — justo el campo que `sanitizeToolResultForModel` **no** miraba. `relation "tenant_x.orders" does not exist` llegaba entero al modelo, que se lo parafraseaba al cliente. El saneo ahora limpia ambos campos, conserva los códigos estables (`slot_taken`, `unknown_property`) sobre los que el modelo razona, y neutraliza en el idioma del turno. Arreglarlo en el punto de estrangulamiento cubre los ~50 sitios sin una edición masiva riesgosa.

**Pruebas** — `read-semantics.spec.ts` (17 casos): vacío real vs consulta rota en cada handler corregido, `unauthorized` sin contacto, lectura parcial del CRM, las tres semánticas de RAG, detección de vacío desde payload, `stale` por presupuesto, `tenant_db` nunca stale, todo fallo lleva `error`, mensajes sin detalle técnico, y los 4 casos del saneo (incluido que no toca un resultado exitoso).

**Verificación**
```
npx tsc --noEmit                         → exit 0
npx jest --maxWorkers=2 (suite completa) → 2420 passed / 274 suites, 0 fallos
```

### U7 — P0-9 · Fundación regional: país operativo ≠ país de facturación

**Fase 2 · Épica I · Paquete "Regional foundation" (tamaño XL del plan)**

País, moneda, huso, locale y prefijo telefónico se decidían en varios lugares con precedencias distintas, y **todos** terminaban en un default colombiano: `es-CO`, `America/Bogota`, `COP`, `+57`. Un tenant brasileño podía arrancar con identidad colombiana, cotizar en COP y ver los teléfonos de sus clientes reescritos con `+57` — que en el módulo de identidad no es cosmético: los contactos se emparejan por E.164, así que puede **fusionar a dos personas distintas en un solo contacto**, y eso no tiene deshacer.

**ADR-007 — Tres preguntas distintas, tres respuestas.**
`operatingCountry` gobierna terminología, formatos, teléfono y qué fuentes regulatorias puede citar el agente. `billingCountry` gobierna precio, impuesto y riel de cobro. El país del **cliente** es una tercera cosa, se conoce por conversación, y gana sobre las otras dos cuando se conoce con confianza. Una empresa colombiana puede facturar desde Colombia y operar un hotel en México cuyos huéspedes son argentinos: las tres tienen respuesta correcta y distinta.

**Migración** `20260820120000_separate_operating_identity` — **puramente aditiva**, como exige expand-contract (el deploy migra antes de recrear contenedores; el código viejo corre contra este schema durante minutos). Columnas nullable sin default en `tenants`: `operating_country`, `operating_timezone`, `default_locale`, `phone_region`, `address_schema_id`, `country_pack_id`, `country_pack_version`, `regional_provenance`. CHECKs de formato ISO (un código en minúscula o de tres letras falla en silencio en cada lookup, así que se rechaza en el borde).

**Nada se backfillea.** Un país operativo adivinado es peor que uno ausente, porque parece decidido. La tabla nueva `regional_identity_reviews` (una fila abierta por tenant/campo, índice único parcial) lleva cada discrepancia a un humano. Clasificada en `TENANT_PUBLIC_PURGE_ORDER` — el guard de purga la detectó de inmediato, que es exactamente su función.

**Contrato** `packages/shared/src/tenant-regional-profile.ts`: `TenantRegionalProfileV1`, `RegionalValue<T>` con `source` (`declared|derived|inferred|fallback`) y `from`. **Cada valor lleva su procedencia**, porque un valor equivocado que parece elegido cuesta mucho más de depurar que uno que admite ser una conjetura. Incluye `ONBOARDING_COUNTRIES` (la lista de 17 que el dashboard duplicaba **dos veces**), monedas, husos, locales y formas de tratamiento por país, y `COUNTRY_PACK_STATUS`.

**Resolutor** `tenants/regional-profile.service.ts` — precedencia declarado > derivado > inferido > fallback, cacheado 5 min. `compose()` es puro y exportado: las reglas de precedencia son el punto del servicio y deben poder afirmarse sin base de datos. `queueConflictsForReview()` **no reescribe nada**.

**Tratamiento:** `usted` donde el registro está en disputa (la sobre-familiaridad cuesta más que la formalidad en salud, finanzas y reclamos). `vos` solo en AR/UY/PY — la RAE lo documenta como tratamiento informal general ahí; **no** existe un voseo latinoamericano único, que es justo el error del guidance desplegado, que mezclaba `resumí`/`entendé` en prompts de otros países. US/CA quedan `fallback_only`: no se resuelven por país solo (`en-US`/`es-US`, `en-CA`/`fr-CA`, regulación estatal, y `+1` necesita metadatos y no comparación de prefijo).

**Teléfono:** `normalizePhoneE164(raw, defaultRegion)` acepta región ISO o código de marcación. El código del tenant se prueba **primero**, si no un número mexicano que empieza en 57 se lee como colombiano. `phoneCountryMismatch()` detecta discrepancias históricas **para armar cola de revisión, nunca para reescribir**.
> Los 13 llamadores siguen usando el default: migrarlos uno a uno es un paso revisable aparte de hacer que la función *pueda* estar bien. El test lo fija explícitamente.

**Turno:** `TurnContext.regional` (bloque tipado) → `<regional>` en el prompt con país, moneda, locale, tratamiento y `country_pack id/version/status`. Viaja como **dato**, nunca como lista de modismos a imitar: inyectar cientos de regionalismos en un system prompt enseña caricatura, no comprensión. El huso del turno sale del perfil en vez del literal colombiano.

**Pruebas** — `regional-profile.service.spec.ts` (26 casos): las 4 capas de precedencia por campo, tratamiento por país (incluido "CO/MX/PE **no** heredan voseo"), 5 casos de conflicto (y el silencio correcto cuando `es-CO` es solo el default de la columna), estado de packs, y 6 de teléfono incluido el caso que documenta la corrupción original.

**Verificación**
```
apps/api        npx tsc --noEmit → exit 0
apps/dashboard  npx tsc --noEmit → exit 0
apps/landing    npx tsc --noEmit → exit 0
apps/mobile     npx tsc --noEmit → exit 0
npx jest --maxWorkers=2          → 2446 passed / 275 suites, 0 fallos
```

### U8 — P0-10 · Un solo clasificador de confirmación, handoff y opt-out

**Fase 2/3 · Épica I · Paquete "Consentimiento"**

Ocho léxicos independientes decidían lo mismo. **Cuatro** listas de afirmación discrepaban en catorce tokens: la más amplia vivía en el intérprete de intención y la más angosta en el guard central — el único que gobierna reservar, cobrar y cancelar. Así que `listo`, el "sí" más común de Colombia, estaba en tres de ellas y **no** en esa: el cliente lo escribía, el motor de reservas llamaba a `createBooking(..., 'text_confirmation')`, el guard releía la misma palabra, devolvía `unclear` y escalaba. **El cliente dijo que sí y le tocó un humano.**

**ADR-008 — La fuerza vive en el alias; el EFECTO decide si alcanza.**
Ampliar el guard habría sido el error opuesto y más caro: dejaría que `listo` autorice un cobro. Cada alias declara su confianza y cada acción su efecto:

| | `parameter` / `transactional` | `high_impact` (dinero, consentimiento, irreversible) |
|---|---|---|
| `sí`, `confirmo`, `autorizo` (high) | ✅ | ✅ |
| `dale`, `listo`, `de una`, `hágale` (medium) | ✅ | ❌ pide palabras explícitas |
| `ok`, `perfecto`, `claro` (acknowledge) | ✅ solo si **responde** al desafío | ❌ nunca |
| `sí, pero…`, `dale si…` | ❌ | ❌ |

El efecto se deriva de la policy de la tool (`confirmationEffectForPolicy`): A3/A4, aprobación humana o escritura sensible ⇒ `high_impact`; el resto de escrituras ⇒ `transactional`. Un llamador que olvide declararlo obtiene la lectura más estricta.

**Nuevo**
- `packages/shared/src/country-language-pack.ts` — contrato de pack + base panregional (~110 aliases es/en/pt/fr con confianza y notas) + **15 packs LatAm/BR** y US/CA en `fallback_only`. Cada entrada es **candidata** hasta validarse con hablantes nativos y corpus: por eso todos arrancan `draft`. El Diccionario de americanismos es descriptivo — documenta que una forma existe, no su frecuencia actual, y menos que constituya consentimiento comercial.
- `apps/api/src/common/conversation/intent-normalizer.ts` — `normalizeCustomerIntent` (intent + confianza + evidencia + pack), `authorizesEffect`, `classifyConfirmation`, `confirmationEffectForPolicy`. Orden deliberado: opt-out y cancelación por encima de todo; corrección por encima de afirmación (quien corrige un dato no está confirmando el anterior).

**Convergencia:** el guard central, el intérprete de intención (y con él el motor de reservas) y el handoff leen el mismo clasificador. El opt-out **reutiliza** `intake-i18n`, que ya era la implementación revisada en 4 idiomas.

**Dos defectos que encontraron las pruebas nuevas:**
1. `isOptOutMessage` comparaba contra el texto **crudo** mientras sus patrones están escritos sin acentos, así que `não me contate` y `cancelar inscrição` — las grafías normales — nunca coincidían. Una revocación de consentimiento que no se oye es un problema de cumplimiento, no cosmético. Corregido en la fuente, para sus 4 consumidores.
2. Un `si` **después** de una afirmación es "if", no "sí": `dale si me confirmás el precio` es una condición y se leía como consentimiento.

**Handoff:** `shouldHandoff` normaliza acentos (antes `devolución`/`devolucion` y `pésimo`/`pesimo` había que listarlos dos veces, y el resto de acentuadas simplemente se perdían) y la petición de humano pasa al clasificador compartido — con pt (`atendente`, `falar com uma pessoa`), fr (`conseiller`, `parler à un humain`) y el `asesor` a secas que es como pide la región. La detección de humano ignora el techo de longitud: se pide dentro de una queja, no como palabra suelta.

**Country packs en runtime:** el guard resuelve el país operativo vía `RegionalProfileService` (falla a la base panregional, nunca adivina) y el intérprete lo recibe **por parámetro** — nunca en `this`, porque es un singleton compartido y guardar el país de un tenant filtraría al turno del siguiente.

**Pruebas** — `intent-normalizer.spec.ts` (22 casos): afirmación explícita vs contextual vs reconocimiento por efecto; verbo explícito tras abridor contextual (`dale, confirmo`); sí matizado, negación, cancelación vs rechazo, corrección; `siempre no` mexicano; expresiones nacionales reconocidas; **15 pares país/expresión que no autorizan dinero**; sin pack no hay fallback colombiano; los 15 packs en `draft` y US/CA `fallback_only`; humano dentro de mensaje largo; opt-out; derivación de efecto; mensaje largo y entrada no textual.
`tool-execution-control.service.spec.ts`: la aserción de `dale`/`perfecto`/`de una` pasa a ser **consciente del efecto** — prueba que cierran una cita y que **no** pueden autorizar un cargo. Es más estricta que la anterior, no más laxa.

**Verificación:** `tsc` exit 0 · suite completa **2468 passed / 276 suites**.

### U9 — P0-11 · Jurisdicción, autoridad y vigencia en RAG regulado

**Fase 2/3 · Épica I**

El retrieval filtraba solo por `status = 'ready'`. El idioma existía pero **solo como boost de ranking**, así que dos países que comparten idioma competían por la misma pregunta y ganaba el mejor embebido: una norma colombiana respondía a un cliente mexicano, con fluidez y **con cita**. En salud, finanzas, seguros y legal eso no es un problema de relevancia — es una respuesta equivocada con una fuente adjunta, que es peor que no responder.

**Esquema** (`tenant-schema.sql` + `add-missing-tables.js`, aditivo con `IF NOT EXISTS`): `knowledge_documents` gana `jurisdiction`, `authority`, `valid_from`, `valid_to`, `is_regulated` (default `false`) + índices parciales.

**ADR-009 — El filtro es duro solo para lo marcado como regulado.**
La mayor parte de una base de conocimiento es material propio del negocio y aplica donde sea que opere; excluirlo por país rompería a todos para proteger a unos pocos. Un documento con `is_regulated = true` exige país coincidente **y** vigencia: una norma vencida citada como actual es su propia clase de respuesta equivocada. **Sin jurisdicción conocida no se devuelve ninguna fuente regulada** — responder sobre normas sin saber de qué país es exactamente lo que el filtro existe para impedir.

La jurisdicción viaja como **parámetro** (`$3`/`$4`), nunca interpolada. El resultado arrastra `authority`, `jurisdiction` y vigencia hasta `<retrieved_knowledge>`, donde el ítem se marca `regulated="true"` con `jurisdiction`, `authority`, `valid_from` y `valid_to`: una respuesta regulatoria sin autoridad ni ventana de vigencia no se puede auditar después.

**Pruebas** — `rag-jurisdiction.spec.ts` (6 casos): parámetro no interpolado, no regulado nunca excluido, regulado exige país + vigencia, sin jurisdicción no hay regulado, columnas de auditoría presentes, normalización a mayúsculas.

**Verificación:** `tsc` (api + dashboard) exit 0 · suite completa **2474 passed / 277 suites**.

### U10 — P0-12 · Agent Test resuelve el mismo contrato que producción

**Fase 2/6 · Épica H · Paquete "Tool honesty" / "Agent Test parity"**

Agent Test anunciaba un toolset **distinto y más chico**, y no lo decía. Pagos, OTP, integraciones verticales, MCP, descuento y todos los writers estaban simplemente **ausentes de la pantalla**. Un dueño podía probar un agente, verlo comportarse bien y publicar algo cuyo contrato real nunca había visto. Además corría con reloj y moneda colombianos fuera cual fuera el tenant, y sin el filtro jurisdiccional del RAG — así que sus respuestas sobre "mañana", sobre precios y sobre normas no eran las que daría producción.

**ADR-010 — La paridad se parte en dos, y las dos mitades se dicen en voz alta.**
Paridad no puede significar "ejecutar todo": Agent Test apunta al **schema real** del tenant, y correr writers ahí crearía citas de verdad y cobraría tarjetas de verdad para demostrar que un prompt funciona.

- **Paridad de resolución** — se resuelve el mismo contrato efectivo que publicaría producción: pagos según capability de proveedor, descuento según el mismo gate de U4, integraciones verticales por conexión, MCP solo con aprobación revisada, par OTP derivado de las A2 realmente resueltas, y perfil regional + jurisdicción del RAG.
- **Honestidad de ejecución** — cada tool declara si acá se puede correr y **por qué no**, en vez de desaparecer en silencio.

Un operador que lee `create_payment_link — resuelta, no ejecutable en prueba` sabe dos cosas ciertas. Uno que no veía nada no sabía ninguna.

**Nuevo:** `agent-test-parity.ts` — `explainToolExecutability` con motivos ordenados de más a menos específico (un writer de pagos se bloquea *por ser writer*, no porque además necesite step-up): `executable`, `writer_blocked_in_test`, `external_effect_blocked_in_test`, `step_up_unavailable_in_test`, `not_approved`.

**Superficie:** `TestAgentDebugInfo` gana `toolParity` y `regional`; el panel de depuración suma una pestaña **Contrato** con el conteo resuelto/ejecutable, el país/moneda/pack de la corrida y una tarjeta por tool con su motivo. i18n en es/en/pt/fr.

> Nota de proceso: el primer intento de agregar las claves hizo `json.load`/`json.dump`, que reflowea la indentación y re-escapa todo el no-ASCII — 1.215 líneas de diff para cuatro claves, imposible de revisar. Revertido y rehecho con inserción textual: **19 líneas por idioma**.

**Pruebas** — `agent-test-parity.spec.ts` (9 casos): toda tool segura es ejecutable; un writer se reporta **bloqueado, no ausente**; una lectura A2 fuera de la lista explica el step-up faltante (el conjunto se calcula del registro, así que el test no envejece); MCP sin policy no es ejecutable; **el motivo de cada una de las 104 tools coincide con su `agentTestAllowed`, sin excepciones sueltas**; el reporte cuenta resueltas y ejecutables por separado; efecto y assurance presentes para auditar; reporte vacío no rompe.

**Verificación**
```
apps/api        npx tsc --noEmit → exit 0
apps/dashboard  npx tsc --noEmit → exit 0
npx jest --maxWorkers=2          → 2483 passed / 278 suites, 0 fallos
```

---

## 3. Estado de los 12 P0 de integridad (orden obligatorio del plan)

| # | P0 | Estado | Unidad |
|---:|---|---|---|
| 1 | Reparar `search_products` y `place_catalog_order` | ✅ | U1 |
| 2 | Exponer Resource Rentals (vehículo y boarding) | ✅ | U2 |
| 3 | Unificar/bloquear split-brain de alojamiento | ✅ lectura unificada + writer fail-closed; **write-back Hostaway bloqueado por credenciales** | U3 |
| 4 | No anunciar MCP sin policy aprobada por tool | ✅ | U4 |
| 5 | Retirar o completar `apply_discount` | ✅ despublicado por capability + techo server-side | U4 |
| 6 | Derivar OTP de las policies A2 efectivas | ✅ | U4 |
| 7 | Procedures respeta agente/subtipo/plan/slots tipados | ✅ | U5 |
| 8 | Distinguir `empty`/`stale`/`provider_down`/`error` | ✅ | U6 |
| 9 | Separar país operativo/facturación/locale/tz/moneda/teléfono | ✅ contrato, resolutor, migración y cola de revisión | U7 |
| 10 | Unificar confirmación/handoff/opt-out por efecto y país | ✅ | U8 |
| 11 | Jurisdicción/autoridad/vigencia en RAG regulado | ✅ | U9 |
| 12 | Agent Test = producción | ✅ resolución idéntica + honestidad de ejecución | U10 |

**Estado acumulado:** `tsc` limpio en las 5 apps · **2483 tests verdes, 0 fallos** · 0 regresiones introducidas.

---

## 4. Fase 1 — Contratos compartidos

### U11 — Registro único `SubtypeExperienceProfile` + puerta de CI de los 76 perfiles

**Fase 1 · Épica A (gobierno y taxonomía) · Gate 1**

El selector ofrecía 75 subtipos sobre unos **27 perfiles efectivos**: una etiqueta que el tenant elegía en el alta y que casi no cambiaba nada río abajo. Y cada superficie contestaba por su cuenta "qué es este negocio" — el manifiesto sabía capacidades, el resolver de persona sabía una plantilla, el sidebar sabía rutas, marketing sabía un claim, y ninguno coincidía.

**ADR-011 — El registro compone; no duplica.**
`SubtypeExperienceProfile` **no** repite lo que el manifiesto ya posee (capabilities, tool groups, objeto primario, rutas, readiness, assurance): eso se **compone** en `resolve()`, así que un cambio aterriza en un solo lugar. Acá vive lo que el manifiesto no opina: hasta dónde se puede **vender** el perfil, si se puede vender, qué **no** promete y la evidencia auditada detrás de esa decisión. El propio plan registra el riesgo de "explosión de 76 forks" (§14): en el momento en que una diferencia puede vivir en un componente compartido, no puede vivir en 76 entradas.

**Nuevo:** `packages/shared/src/subtype-experience-profile.ts` — los 76 perfiles con `strategy` (`build|integrate|hybrid|define|migrate|stop`), `wave` 0-4, `scope` comercial (`captacion|calificacion|cotizacion|coordinacion|operacion_ligera|operacion_integrada`), alertas de auditoría verbatim, benchmark, brecha principal, puntajes auditados y **exclusiones explícitas** por vertical. Generado desde `vertical-subtype-scorecard-2026-08.csv` para no transcribir 76 filas a mano, que es la clase de error que nadie ve en revisión.

**ADR-012 — Migrar no es bloquear.**
`veterinaria/peluqueria_canina` estaba marcado `stop` **y** tenía alias a `pet_services/peluqueria`: las dos cosas se contradicen. Un id migrado **sí** es vendible — como la experiencia que siempre debió ser. Se agrega `strategy: 'migrate'` con `migratesTo` y `migrationNote`, y `commercialisable` sigue al perfil **resuelto**, no al id pedido. Lo detectó la prueba de contrato, no una lectura.

**ADR-013 — `fotografia/wedding_planner` NO se aliasa.**
Es la decisión opuesta a grooming y por la misma razón: Event Planning todavía no existe como industria, así que no hay a dónde mandarlo con honestidad. Apuntarlo de vuelta a fotografía recrearía la clasificación errónea que un alias debería arreglar. Queda `stop` con el motivo señalando Event Planning.

**8 perfiles bloqueados con motivo de párrafo** (no de una línea, que no le explica nada a quien lo hereda): construcción, fintech, marketplace, consultoría TI, aseguradora, seguros/salud, wedding planner y farmacia*.
\* farmacia queda `hybrid/ola 1` — el writer ya funciona (U1); la alerta STOP del audit era por el flujo Rx, cubierto por sus exclusiones.

**Endpoint** `GET /verticals/:tenantId/effective-profile` — una sola lectura de qué es el negocio y qué puede prometer: id pedido vs resuelto, migración, alcance comercial, estado de certificación, exclusiones, capability del manifiesto, evidencia de auditoría y perfil regional con sus conflictos. **Derivado en cada llamada**, nunca almacenado: así no puede convertirse en una quinta opinión que se desincroniza de las otras cuatro.

**Puerta de CI** — `subtype-experience-profile.spec.ts` (20 casos):
- **Conteos canónicos:** 18 verticales, 75 subtipos + `otro` = 76; el registro cubre **exactamente** las configuraciones del manifiesto, sin agrupar hermanos ni inventar subtipos.
- **Honestidad comercial:** todo perfil declara estrategia/ola/alcance/referente/exclusiones; un bloqueado siempre dice por qué (>80 caracteres); solo un bloqueado lleva motivo; las 5 taxonomías ambiguas están bloqueadas y grooming resuelve a Pet Services.
- **Alcance vs objeto:** un perfil que promete `operacion_*` no puede tener `lead` como objeto primario — vender "operación" sobre un embudo es la confusión que el plan prohíbe.
- **MISCLASS acotado:** taller, agencia de viajes, universitaria, arquitectos y foto de producto heredan el producto de otro subtipo; eso limita la **profundidad** que pueden prometer, no su existencia. Ninguno puede venderse como operación de lo que confunde.
- **Composición:** resuelve del manifiesto vivo; **no guarda copia** de capabilities/routes/toolGroups/readiness; un id desconocido **falla** en vez de caer a un perfil por defecto; los alias legacy resuelven y los ids pre-manifiesto (`boutique`, `tienda`, `delivery`) no vuelven al selector.
- **Sin divergencia capacidad↔tools↔policy:** todo grupo del manifiesto mapea a una capability, **publica tools reales** (un grupo vacío es una capacidad prometida que nadie puede usar), todas tienen policy central, y **ningún writer se publica sin confirmación, idempotencia ni assurance**.

**Verificación**
```
npx tsc --noEmit (api + shared)          → exit 0
npx jest --maxWorkers=2 (suite completa) → 2503 passed / 279 suites, 0 fallos
```

### U12 — `EffectiveAgentCapabilityContractV1` + readiness bloqueante

**Fase 1 · Épica E/H · §3.4 del plan · Gate 1**

Las tools se publicaban desde toggles guardados en cada agente. La UI dejaba encender familias que no tenían nada que ver con el subtipo; el manifiesto solo aportaba defaults a agentes **nuevos**, así que uno existente conservaba lo que tuviera desde su alta; readiness era `advisory` desde la v1 del manifiesto y **nunca tuvo evaluador detrás**; y el gate de plan, cuando ocurría, ocurría en otro lado. Siete sistemas tenían cada uno una parte de la decisión y ninguno la tenía entera.

**ADR-014 — El subtipo es un techo, no una sugerencia.**
Un toggle solo puede **acotar** lo que el manifiesto concede. Ningún JSON que el tenant pueda editar amplía autoridad — que era exactamente cómo una peluquería canina podía encender la familia de seguros.

**ADR-015 — Toda exclusión lleva motivo.**
Una tool que desaparece en silencio le enseña al dueño que no existe. Una que dice "tu plan no incluye esto" o "no tenés productos cargados" le enseña qué hacer. Siete motivos tipados: `not_in_subtype`, `agent_disabled`, `plan_missing_feature`, `readiness_unmet`, `provider_unavailable`, `not_approved`, `external_system_of_record`.

**Readiness que sí comprueba** — `verticals/vertical-readiness.service.ts` (nuevo)

"Habilitado" y "tiene algo con qué responder" nunca fueron el mismo reclamo, y solo se hacía el primero: un tenant podía encender catálogo con cero productos, el agente publicaba `search_products` y al cliente se le decía que el negocio no vende nada.

Cada clave es un COUNT contra **la misma tabla que la tool consulta**, así que readiness no puede desincronizarse de lo que se pregunta. 18 claves mapeadas con su texto de reparación y su ruta. Tres decisiones no obvias:
- Una tabla que el tenant nunca aprovisionó cuenta **cero** (respuesta real), no error.
- Un lookup **caído** deja la clave como satisfecha y marca `degraded`: desconocido no es incumplido, y apagar un agente que funciona por una consulta caída sería el mismo error de "error leído como vacío" que el contrato de lectura existe para evitar.
- `professional_cases` y `pipeline` quedan deliberadamente **fuera**: la primera se deriva de oportunidades que todo tenant tiene, la segunda se siembra en el aprovisionamiento. Bloquear por cualquiera sería bloquear por algo que el tenant no puede accionar.
- `boarding_capacity` exige categoría de alojamiento **y** `max_concurrent >= 1`: un servicio de guardería sin concurrencia dejaría al agente cotizando un cupo que no puede honrar.
- El COUNT va con `LIMIT 50`, para que un tenant con un millón de filas no pague un conteo completo para responder "¿hay al menos una?".

**Contrato** — `packages/shared/src/effective-capability-contract.ts` + `conversations/effective-capability.service.ts`. Intersección obligatoria y fail-closed: subtipo ∩ overrides del agente ∩ plan/cuotas ∩ readiness ∩ país. Lleva `version`, `subtypeProfileId`, `planSnapshot`, `countryPackId`, `publishedTools`, `publishedGroups`, `excluded[]`, `unmetReadiness[]`, `degraded` y `resolvedAt`.

**Runtime:** el contrato tiene la última palabra sobre qué se publica y **solo acota** — un contrato que no resuelve deja el turno como estaba en vez de silenciar un agente que funciona. Las familias asíncronas (pagos, integraciones, MCP, par OTP) conservan sus propias puertas y pasan sin tocar. Se agrega el paso de traza `capability_contract`: sin él, "¿por qué el agente no usó X?" es incontestable después del hecho, y esa pregunta es la mayor parte del soporte de agentes.

**Pruebas** — `effective-capability.spec.ts` (13 casos): familia fuera del subtipo descartada con motivo; familia concedida-pero-apagada reportada; publicación correcta; plan sin feature no publica dinero; plan ilegible **no** concede en silencio; sin datos no publica y dice qué cargar (con ruta); solo evalúa readiness de las familias que sobrevivieron las puertas anteriores; readiness ilegible marca degradado **sin** apagar el agente; contrato trazable con versión/perfil/plan/país; toda exclusión con motivo legible; subtipo desconocido falla en vez de publicar de más.

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard) → exit 0
npx jest --testPathPattern=bootstrap        → 1/1 ✅ (DI limpio)
npx jest --maxWorkers=2 (suite completa)    → 2516 passed / 280 suites, 0 fallos
```

### U13 — P0 §6.1 · El falso menú "Reservas": dos objetos no comparten etiqueta

**Fase 2/4 · Épica D · Paquete "Turismo semántico"**

`/admin/pipeline` es el Kanban del CRM — oportunidades con etapas. Las definiciones verticales lo renombraban con el nombre de un objeto operativo **real** en ocho industrias:

| Vertical | Se llamaba | El objeto real vive en |
|---|---|---|
| Turismo | **Reservas** | `property_bookings` / `tour_bookings` |
| Restaurantes | **Reservas** | reserva de mesa + `food_orders` |
| Servicios del hogar | **Solicitudes** | `service_requests` |
| Seguros (×2) | **Cotizaciones** | `insurance_quotes` |
| Educación (×2) | **Inscripciones** | inscripción real a curso |
| Belleza | **Citas** | `appointments` |
| Finanzas | **Solicitudes** | — (promesa sin objeto) |
| Profesionales | **Casos** | — (promete matter management inexistente) |

El costo no es cosmético. Un agente que busca las reservas de hoy abre un **embudo de ventas**; el objeto que necesita está en otro lado y muchas veces detrás de un permiso que no tiene. La auditoría encontró esto intentando hallar una reserva en Turismo y no pudiendo — y eso disparó toda la revisión.

**ADR-016 — Allowlist de vocabulario comercial, no denylist de sustantivos operativos.**
Una denylist crece cada vez que una vertical gana un objeto, y el día que se atrasa es el día que se publica una colisión. `CRM_FUNNEL_LABELS` declara lo que el embudo **puede** llamarse en los 4 idiomas; `OPERATIONAL_OBJECT_LABELS` documenta lo que cada palabra ya significa. Mientras las dos listas sean disjuntas —verificado en CI— pasar la primera prueba implica pasar la segunda.

**10 etiquetas renombradas** a `Oportunidades`/`Opportunities`/`Oportunidades`/`Opportunités`. Las que **ya** eran comerciales no se tocaron: `Negociaciones` (inmobiliaria, automotriz), `Ventas` (retail), `Seguimiento` (salud, veterinaria) — renombrarlas habría sido perder lenguaje del rubro sin ganar nada.

**Pruebas** — `navigation-semantics.spec.ts` (7 casos): hay etiquetas que revisar (si llega a cero, alguien borró los overrides en vez de arreglarlos); toda etiqueta usa vocabulario comercial; ninguna nombra un objeto operativo; las dos listas son disjuntas en los 4 idiomas; **todo override tiene las 4 traducciones** (uno incompleto deja al tenant viendo español dentro de una interfaz en otro idioma); las verticales del hallazgo quedaron corregidas; las que ya estaban bien no se tocaron.

**Verificación:** `tsc` exit 0 · suite completa **2523 passed / 281 suites**.


### U14 — P0 §6.1 · Los dos registros que no existían: estadías y salidas

**Fase 2/4 · Épica D · Paquete "Turismo semántico"**

U13 corrigió la **etiqueta**. Faltaba el objeto: la auditoría no encontró una reserva en Turismo porque no había dónde buscarla. `/admin/properties` y `/admin/tours` son **catálogos** —la ficha del alojamiento, el paquete que se vende—, y la reserva vivía anidada dentro de la ficha, detrás del permiso de catálogo. El recorrido para encontrar la salida de mañana era: abrir el producto que la vende, entrar a su pestaña, y ser supervisor.

**ADR-017 — El registro operativo se separa de su catálogo, y va primero.**
Administrar unidades y operar reservas son dos trabajos con dos permisos. `/admin/stays` y `/admin/tour-bookings` son ítems propios de navegación, por encima de `/admin/properties` y `/admin/tours`, y viven en `canHandleConversations` mientras el catálogo se queda en `canEditPipeline`: quien cerró una estadía en una conversación tiene que poder encontrarla después.

**Lo que ya existía y nadie alcanzaba** — `GET /tours/:tenantId/bookings` estaba escrito, sin `@Roles`, desde hacía meses; ninguna pantalla lo llamaba. Del lado de alojamiento no había lectura global: `listAllBookings` (nueva) agrega filtros por estado/unidad/rango/búsqueda, total y paginación, con rango **semiabierto** igual que disponibilidad, `LEFT JOIN contacts` para el nombre de respaldo y `origin` derivado de `conversation_id`.

**Dos defectos que aparecieron al construir la pantalla, no en la auditoría:**

1. **La consulta de tours no daba nombre a quien reservó.** `listBookings` seleccionaba `b.*` sin unir `contacts`. Una salida reservada por el agente en una conversación puede no tener `guest_name` escrito a mano: el manifiesto habría listado viajeros sin nombre. Ahora une contactos y expone `origin`.
2. **Los alias del cliente no eran las columnas de la tabla.** La página se escribió contra `customer_name` / `customer_phone`; en `tour_bookings` las columnas son `guest_name` / `guest_phone`. Un alias equivocado no rompe nada visible desde el backend — la pantalla se dibuja entera y muestra **"Sin viajero" en cada fila** con los datos correctos abajo. Es el mismo modo de falla que "error leído como vacío", y por eso las columnas que la pantalla lee ahora se afirman **contra la consulta**, no del lado del cliente.

**Formatos regionales** — la pantalla de estadías formateaba fechas y moneda con `es-CO` fijo. La app corre en cuatro idiomas; ahora usa el locale activo.

**Puertas que el ítem nuevo tuvo que atravesar** (las tres las encontró la suite, no una revisión):
- `navigation-contract.ts` — toda página bajo `/admin` necesita entrada en el registro canónico o el breadcrumb muestra el slug crudo.
- `roles.ts` — deny-by-default: sin regla explícita la página queda inalcanzable para todos. Ambas incluyen `tenant_agent`, a diferencia de sus catálogos.
- `vertical-dashboard-resolver` — el manifiesto suma `/admin/stays` a los subtipos de alojamiento y `/admin/tour-bookings` a los de tours.

**i18n** — dos namespaces (`stays`, `tourBookings`) + etiqueta de menú + breadcrumb, en es/en/pt/fr. Un estado que el backend agregue mañana se muestra crudo antes que romper la fila: la reserva sigue siendo legible.

**Pruebas** — `stay-register.spec.ts` (7 casos): lectura completa con unidad, contacto de respaldo y autor; conteo caído leído como cero; **todo filtro parametrizado** con placeholders en orden y rango semiabierto; estado/uuid/fecha inválidos rechazados (incluye intento de inyección); tamaño de página acotado arriba y abajo; el manifiesto de tours expone las columnas que muestra; filtro por paquete como uuid. Más los tres contratos de navegación que ahora cubren las rutas nuevas.

**Verificación**
```
npx tsc --noEmit (api + dashboard)  → exit 0
jest apps/api      → 2530 passed / 282 suites, 0 fallos
jest apps/dashboard → 161 passed / 20 suites, 0 fallos
```

### U15 — P0 §8.3 · Fotos de Listings: la única parte que el dueño podía tocar era la que faltaba

**Fase 2 · Épica C · Paquete "Fotos Listings"**

Inmobiliaria confirma el patrón que la auditoría de mercado nombró primero: `real_estate_listings.images` existe en la base, `send_listing_image` está registrada, tiene política de tool y sanea lo que le entrega a Meta — y las tres pantallas donde el tenant carga inmuebles (alta, detalle, import) no permitían cargar una sola foto. La capacidad estaba entera salvo el extremo que el dueño alcanza.

**ADR-018 — Un solo gestor de fotos, no uno por objeto.**
Ya existía uno completo, escrito **adentro** de la pestaña Fotos de una propiedad de alquiler vacacional. Copiarlo a Inmuebles habría dejado dos validaciones de tamaño, dos límites y dos textos que se corrigen por separado. Se extrajo a `components/media/PhotoManager.tsx` y hoy lo usan alojamiento e inmuebles; el helper `resolveMediaUrl`, que vivía duplicado en **seis** pantallas, pasó a `lib/media-url.ts`.

**ADR-019 — Las fotos se guardan solas.**
La versión anterior tenía barra de guardado aparte. El archivo ya está subido cuando aparece en la grilla: lo único pendiente era la asociación, así que cerrar la pestaña dejaba la foto en el servidor y el objeto sin ella. Ahora cada cambio (subir, reordenar, portada, borrar) persiste al instante, y si el guardado falla **se revierte y se dice por qué** — mostrar un orden que la base no tiene es peor que no reordenar.

**Un defecto silencioso en el camino de importación**

`bulk-import` reusa el `create` de siempre, así que una columna `images` habría llegado como **cadena** —una celda de planilla es una cadena— y `JSON.stringify('a.jpg,b.jpg')` guarda una cadena en una columna `jsonb` donde el que envía la foto espera un arreglo. Resultado: fila cargada, cero fotos, ningún error en ningún lado. `normalizeListingImages` normaliza donde se **escribe**: acepta arreglo o celda separada por coma/punto y coma/barra/salto, deduplica conservando el orden, y descarta lo que un canal no puede ir a buscar (`javascript:`, `data:`, protocol-relative). El mismo normalizador corre en alta y en edición: editar no puede ser la puerta por la que entra lo que el alta rechaza.

**Además:** `update` no validaba el uuid (el id llega de una tool call, igual que en `getById`); los cinco tipos de inmueble estaban en **español fijo** dentro de una app de cuatro idiomas.

**Readiness — decisión de no bloquear.** `listings` sigue midiendo inmuebles publicados, no fotos. Sin fotos el agente igual busca, filtra y da detalles; apagar la familia entera por una galería vacía castigaría lo que sí funciona. `send_listing_image` ya devuelve un error honesto por inmueble, y el estado vacío del gestor explica que la portada es lo que el cliente ve primero.

**i18n** — las 12 cadenas de fotos se **mudaron** de `properties` al namespace `photoManager` conservando sus cuatro traducciones (reescribirlas habría sido perder trabajo hecho); 4 nuevas (`title`, `limitReached`, `agentHint`, `saveFailed`) y 3 muertas eliminadas. Nuevas en `listings`: columna de import y los cinco tipos de inmueble.

**Pruebas** — `listing-images.spec.ts` (10 casos): arreglo respetado en orden; celda de planilla partida en sus tres separadores; todo lo que un canal no puede buscar descartado; duplicados fuera sin reordenar; tope de galería; valor ausente leído como "sin fotos", no como error; normalización en alta con la ruta de import; normalización en edición; una edición que no menciona fotos no las toca; uuid inválido rechazado antes de tocar la base.

**Verificación**
```
npx tsc --noEmit (api + dashboard)  → exit 0
jest apps/api      → 2540 passed / 283 suites, 0 fallos
jest apps/dashboard → 161 passed / 20 suites, 0 fallos
```

### U16 — P0 §8.3 · Fotografía nace sin paquetes, y el consejo para arreglarlo llevaba a una puerta cerrada

**Fase 2 · Épica B/C · Paquete "Fotografía"**

La definición de la vertical declara tres paquetes. Ninguno se escribía nunca. `fotografia` lleva `bookingEnabled: false` —un fotógrafo de bodas no vende franjas de 30 minutos— y **ese mismo flag apagaba el sembrado de servicios**, que es donde viven los paquetes. El estudio arrancaba con la tabla vacía, `list_photo_packages` devolvía cero, y el agente le decía al cliente que no hay nada que ofrecer.

El mecanismo para separar las dos cosas ya existía: `seedServicesWithoutAgenda`, que usan `pet_services/guarderia` y `pet_services/hotel`. Fotografía simplemente no estaba en el registro — el mismo patrón "existente pero inalcanzable" que el plan censó cuatro veces.

**Paquetes por sub-tipo, no por industria.** Sembrarle "Producto e-commerce" a un fotógrafo de bodas es trabajo de borrado el día 1. `estudio` recibe familiar/retrato/book, `bodas` boda completa/preboda/civil, `eventos` corporativo/social, `producto` e-commerce/con modelo. Los precios son base editable; el valor del preset es que el nombre corresponda al rubro desde el primer día.

**ADR-020 — `wedding_planner` no recibe paquetes de fotografía.**
Organiza bodas; no las fotografía. Es el peor subtipo de la auditoría —clasificado contra el producto equivocado— y su separación a Event Planning es su propia unidad. Sembrarle sesiones de fotos sería confirmarle una promesa falsa; sin paquetes queda con readiness incumplido, que es la verdad.

**El CTA de reparación llevaba a una pantalla que el tenant no ve**

`photo_sessions` y `boarding_capacity` decían "sembrá tus paquetes" y apuntaban a `/admin/appointments/config`. Fotografía, guardería y hotel de mascotas **no tienen Agenda en su menú** — el manifiesto se la quita a propósito. El consejo era correcto y el destino inalcanzable: el dueño no podía editar lo que el bootstrap le sembraba ni cargar lo que le faltaba.

**ADR-021 — Un catálogo de paquetes propio, con el editor de siempre.**
`/admin/service-catalog` monta el **mismo** `ServicesTab` + `ServiceModal` de la Agenda. El estado y los handlers se extrajeron a `hooks/useServiceCatalog.ts` sin cambiar comportamiento: un segundo formulario habría divergido la primera vez que alguien agregara un campo a uno solo. Vive en `canEditPipeline` (catálogo), no en el permiso del que opera; el registro operativo de sesiones sigue donde estaba. Los `notify`/textos van por ref para que los handlers no cambien de identidad en cada render.

Se publica para los 4 sub-tipos reales de fotografía y para guardería/hotel de mascotas, y **no** para las verticales que ya tienen Agenda: dos pantallas para lo mismo es la duplicación que esto viene a evitar.

**Semántica de lectura** — `listConfiguredServicesTool` (la que sirve `list_photo_packages` y `list_pet_services`) devolvía `{ error: <mensaje del driver> }` en el fallo y una lista vacía con un texto en inglés en el catálogo vacío. Ahora usa el contrato: `empty` con explicación al cliente, `read_failed` con mensaje seguro y `error` que el turno trata como tool fallida.

**Pruebas** — `photography-packages.spec.ts` (15 casos): los 4 sub-tipos siembran paquetes con la agenda apagada; cada uno recibe los suyos (bodas no recibe producto y viceversa); todo paquete lleva 4 idiomas, precio y duración; `wedding_planner` no recibe paquetes de fotografía; las dos claves de readiness apuntan a una ruta que el tenant puede abrir; las 6 configuraciones publican el catálogo **sin** recuperar Agenda; salud no lo duplica. Más `verticals.service.spec.ts`, cuya prueba anterior afirmaba el defecto ("no se siembra ningún servicio") y ahora afirma los tres paquetes de estudio.

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard)  → exit 0
jest src/app.bootstrap.spec.ts               → 1/1 ✅ (DI limpio)
jest apps/api      → 2555 passed / 284 suites, 0 fallos
jest apps/dashboard → 161 passed / 20 suites, 0 fallos
```

### U17 — P0 §8.3 · Farmacia: el pedido sin dónde verse, el tablero de otra clínica y la receta que nadie miraba

**Fase 2 · Épica B/C/E · Paquete "Farmacia"**

`salud/farmacia` es el único subtipo de salud sin agenda y con catálogo, y heredaba todo lo de una clínica. Tres cosas rotas y una peligrosa.

**1. El writer existía; la superficie de lectura no.** El manifiesto le publicaba `/admin/inventory` y omitía `/admin/orders`. El agente creaba el pedido con `place_catalog_order` y el dueño no tenía dónde verlo: el pedido existía sólo en la conversación.

**2. Tablero de clínica en un negocio sin agenda.** KPIs heredados: citas de hoy, inasistencias de la semana, tratamientos activos y sesiones completadas. Cuatro números que siempre valen cero. El tipo `VerticalSubtypeCapabilityOverride` **no permitía** override de KPIs —la auditoría lo listó como causa compartida con fast food, alquileres, hardware y guardería—, así que se agregó `kpiContract?` al override y la resolución lo respeta. Farmacia queda con productos/stock/pedidos/GMV.

**3. Assurance sobre tools que no publica.** Heredaba `get_treatment_plan: A2` y `list_upcoming_sessions: A2`; una farmacia no tiene ninguna de las dos. Gatear lo inexistente no protege nada. Ahora enforce sobre lo que sí tiene: `place_catalog_order: A1` — el pedido es del cliente y se arma sobre su nombre y su dirección.

**4. La receta.** El catálogo genérico trata a todo por igual: disponible ⇒ el agente lo busca, lo cotiza y arma el pedido. En una farmacia eso significa que un medicamento de venta bajo fórmula se podía pedir por WhatsApp sin que ningún farmacéutico viera nada, y la conversación quedaba como si el negocio lo hubiera aceptado.

**ADR-022 — El bloqueo de la fórmula médica vive en el writer, no en el prompt.**
Una instrucción de texto la puede pisar un prompt personalizado; el rechazo del writer no. `products.requires_prescription` (aditivo, `false` por defecto — en las otras siete verticales de catálogo nada requiere receta, y un default `true` habría apagado el catálogo de todos los tenants existentes). `place_catalog_order` rechaza con `prescription_required` **nombrando el producto**, para que el agente pueda decir cuál es en vez de un "no se pudo" que el cliente lee como que el negocio no lo tiene.

**ADR-023 — El producto recetado se sigue mostrando.**
Ocultarlo del catálogo sería mentir por omisión: la farmacia lo tiene. `search_products`, `get_product` y `check_stock` devuelven `requiresPrescription`, así que el agente sabe el límite **antes** de confirmar y no lo descubre al cerrar. Haber stock y poder venderlo por chat no son lo mismo.

**ADR-024 — Quitar la marca requiere supervisión.**
El alta de producto la puede hacer un agente. Desmarcar "venta bajo fórmula" amplía lo que el agente de IA puede vender por chat —justo lo que el bloqueo existe para impedir—, así que el controller lo rechaza para `tenant_agent` a nivel de campo, no de endpoint.

**Deriva encontrada al pasar:** `inventory.service.ts` tiene una **segunda** definición de `products` dentro de `ensureInventoryTables`, paralela a `tenant-schema.sql`. Hubo que agregar la columna en las dos más un `ALTER ... IF NOT EXISTS` de rescate. Queda registrada como tarea aparte: mientras existan dos definiciones, la próxima columna se olvida en una.

**Lo que NO se hizo, y por qué.** El perfil sigue en **STOP**: dispensación real, refill, lote/vencimiento, sustitución y trazabilidad exigen un PMS farmacéutico (PioneerRx marca la profundidad) y validación humana con reglas por país. Esto no vende dispensación: la impide y la deriva a una persona.

**Pruebas** — `pharmacy-prescription.spec.ts` (9 casos): el pedido de venta libre funciona igual que antes; el recetado se rechaza nombrando el producto y **sin escribir nada**; el **carrito mezclado** se rechaza entero (aceptar la parte OTC y callar el resto le dice al cliente que su pedido está completo cuando le falta justo lo que fue a buscar); el recetado sigue apareciendo en búsqueda, marcado; `check_stock` reporta la marca; el manifiesto publica Pedidos; no muestra tablero de clínica; enforce sobre la acción que sí tiene; los subtipos clínicos quedan intactos. Más la corrección de `vertical-dashboard-resolver.spec.ts`, cuya aserción afirmaba el defecto (farmacia = sólo Inventario).

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard)  → exit 0
jest src/app.bootstrap.spec.ts               → 1/1 ✅ (DI limpio)
jest apps/api      → 2564 passed / 285 suites, 0 fallos
jest apps/dashboard → 161 passed / 20 suites, 0 fallos
```

### U18 — P0 §8.3 · Prompt correctness: lo que el prompt efectivo decía y lo que nadie quiso decir

**Fase 2/3 · Épica F · Paquete "Prompt correctness"**

Cuatro defectos del prompt efectivo, cada uno con su propia manera de ser invisible.

**1. Personalizar el agente apagaba las protecciones del rubro.**

`buildSystemPrompt` en modo libre devolvía **solo** el texto del dueño. Con eso desaparecían los temas prohibidos, los disparadores de handoff, el horario y el skillset: una clínica que escribía su propio prompt perdía "no des diagnósticos" y "derivá una urgencia" sin que nada lo dijera. El defecto es peor que un olvido porque el dueño cree que sumó, no que restó.

**ADR-025 — El prompt libre reemplaza la voz, no las barreras.**
El texto propio sustituye identidad, personalidad y reglas —eso es lo que el dueño quiere cambiar—; los temas prohibidos, el handoff, el horario y el skillset se re-emiten siempre. Los cuatro bloques pasaron a métodos propios porque ahora los comparten dos caminos; escritos en línea, cambiar el modo del editor los borraba sin que nadie lo notara.

**2. `both` por defecto era una orden de vender que nadie eligió.**

El renderer usaba `both` cuando no había configuración e inyectaba con él una instrucción de venta consultiva y otra de "conectá la consulta con una recomendación". Así una recepción médica, una psicóloga, un estudio jurídico, una veterinaria y una financiera recibían una orden de vender — en conversaciones que empiezan con un síntoma, una deuda, un siniestro o un juicio.

**ADR-026 — El default sale del rubro; la regla de no-pitch no es un default.**
`skillsetPolicyForIndustry` marca cinco rubros como *care-first* (salud, veterinaria, finanzas, seguros, servicios profesionales) con default `support`. El criterio no es "regulado": es que la conversación típica arranca con un problema de la persona y no con una intención de compra. Si el dueño elige `sales` explícitamente, **se respeta** — es su negocio. Lo que no se negocia es `<no_pitch>`: no se abre una venta sobre un síntoma, una urgencia o un reclamo, se elija lo que se elija. Se puede hablar de precios cuando los preguntan.

**3. Las instrucciones venían en inglés.**

`Act as a consultative salesperson…` dentro de un bloque cuyo resto —nombre, rol, reglas, temas prohibidos— viene en el idioma del tenant. Un prompt mezclado empuja al modelo a contestar en el idioma equivocado. Las cuatro guías (`sales`, `support`, `balance`, `no_pitch`) más los tres niveles de upsell viven ahora en `agent-skillset-policy.ts` en es/en/pt/fr. Sin idioma declarado cae al **español**, que es el mercado de la plataforma, no al inglés, que no lo es para nadie.

**4. Ningún `requiredField` vertical llegaba nunca al prompt.**

Trece plantillas guardaban `{ name: { required: true } }`; el contrato es `Record<contexto, RequiredField[]>` y el renderer salta lo que no es arreglo. Se descartaban en silencio. Y aunque la forma hubiera sido correcta, **la sección entera se suprimía con Agenda activa**, que es el caso de casi todas esas plantillas.

**ADR-027 — Normalizar la forma heredada; suprimir por campo, no por sección.**
`normalizeRequiredFields` acepta las dos formas y traduce la vieja con preguntas de identidad que ya son iguales en todos los rubros (nombre, teléfono, correo) en cuatro idiomas. Una clave heredada sin pregunta escrita **se descarta**: inventarle una pregunta al dueño sería ponerle palabras al agente. Y con Agenda activa se suprimen sólo los campos que el motor determinista ya pregunta (`name`, `phone`) en vez de tirar todo, así que un correo o un NIT declarado por la plantilla sí llega.

**5. Cinco entradas de sub-tipo pisaban la meta del dueño sin aportar nada.**

`casual_dining`, `abogados`, `broker`, `aseguradora` y `bodas` apuntaban al **mismo** template que el default de su vertical. Aun así devolvían `source: 'subtype'` y bloqueaban la plantilla que la meta habría elegido: el dueño marcaba "posventa" en el alta y recibía igual el guion de reservas o de consulta inicial. Ahora una entrada que no difiere del default deja pasar la meta, y sin meta que la contradiga resuelve como siempre. Documentar el mapeo está bien; que pise una decisión del dueño sin agregar contenido, no.

**Pruebas** — `prompt-invariants.spec.ts` (19 casos): el prompt libre conserva prohibidos/handoff/horario/skillset/no-pitch y **sí** reemplaza identidad y reglas; texto vacío cae al bloque guiado; los cinco rubros care-first no reciben orden de vender; retail sí; una elección explícita se respeta y no-pitch igual se emite; un valor que no es skillset se ignora. `required-fields`: la forma heredada se traduce en los 4 idiomas, con Agenda sólo se cae lo que el motor pregunta, un contrato bien formado no se toca, una clave sin pregunta escrita se descarta, la basura no rompe, y el campo **llega al prompt** — que es lo que nunca pasaba. Más `onboarding-persona-resolver.spec.ts`, cuya tabla afirmaba que las cinco entradas vacías debían ganar, y `persona-prompt-escaping.spec.ts`, cuya prueba afirmaba que la guía venía **siempre en inglés**.

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard)  → exit 0
jest src/app.bootstrap.spec.ts               → 1/1 ✅ (DI limpio)
jest apps/api      → 2588 passed / 286 suites, 0 fallos
jest apps/dashboard → 161 passed / 20 suites, 0 fallos
```

### U19 — P0 §8.3 · Ninguna opción visible termina en 403

**Fase 2/4 · Épica D/G · Paquetes "Plan/readiness" y "Catálogo/pedidos"**

**El menú no sabía qué plan tiene el tenant.** `canAccessDashboardNavigationPath` decidía por rol y por vertical, y por nada más. El backend sí gatea: `@RequireFeature` y `isFeatureEnabled` devuelven `feature_not_available` con 403. El resultado era una opción visible que al hacer clic no llevaba a ningún lado, y el dueño no aprendía que existe un plan que la incluye — aprendía que la aplicación falla.

**ADR-028 — Candado, no ocultamiento.**
Esconder la opción cumple la letra del criterio y pierde el producto: el dueño no se entera nunca de que la capacidad existe. La opción se muestra con candado y **cambia de destino**: lleva a Facturación en vez de a la pantalla que va a rechazarlo. La promesa del menú se cumple siempre, y el rótulo dice por qué.

**ADR-029 — Desconocido no es denegado.**
Si la consulta del plan no volvió, `navigationPlanDecision` devuelve `unknown` y no bloquea nada. Esconder medio menú porque una consulta falló es peor que un clic que rebota, y el backend enforza igual — no se abre ningún permiso al fallar abierto acá. Sólo un `false` **conocido** bloquea. Las claves de cupo se leen como las escribe el plan: `0` bloquea, `-1` es ilimitado.

**Alcance deliberadamente chico:** sólo entran las rutas cuyo backend gatea la pantalla **entera** (`/admin/vehicles` → `vehicleInventory`, `/admin/settings/integrations/web-chat` → `widget`, `/admin/settings/recall` → `recall`). Una página donde el plan apaga una pestaña o un botón no entra: ahí la pantalla sirve igual y esconderla sería peor. Una prueba de contrato exige que toda ruta del mapa exista en el registro de navegación, así que el mapa no puede envejecer en silencio.

**Catálogo/pedidos — la superficie de lectura, verificada.** La auditoría contó ocho perfiles que crean pedido; farmacia era el que no publicaba `/admin/orders` (U17). `catalog-order-surface.spec.ts` recorre las 76 configuraciones, toma las que declaran `catalog_search` y exige que **todas** publiquen Inventario **y** Pedidos. El writer ya era transaccional con snapshot del catálogo bloqueado, así que un cliente no puede bajar un precio ni inventar stock.

**Pruebas** — `navigation-plan-gate.spec.ts` (9 casos): el mapa sólo apunta a rutas reales; una ruta sin gate no se toca; `false` bloquea; `true` abre; los cuatro sabores de "no se sabe" reportan `unknown` y no `locked`; los cupos numéricos se leen bien; query string y barra final no confunden; un path que no es string no rompe. Más `catalog-order-surface.spec.ts` (9 casos, uno por perfil de catálogo).

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard)  → exit 0
jest apps/api      → 2597 passed / 287 suites, 0 fallos
jest apps/dashboard → 172 passed / 21 suites, 0 fallos
```

### U20 — P0 §8.3 · Operar una estadía desde el registro, sin abrir antes la ficha

**Fase 2/4 · Épica D · Paquete "Reservas alojamiento"**

U14 le dio a las estadías una pantalla propia. Era de solo lectura: para cargar una reserva o cancelarla había que volver a abrir la tarjeta del alojamiento — que es exactamente el recorrido que el registro vino a eliminar. El criterio del plan dice ver, **crear** y **cancelar** sin Kanban ni ficha.

**ADR-030 — La persona del equipo no puede tener menos autoridad que el modelo.**
`createBooking` ya aceptaba `tenant_agent`; `cancelBooking` exigía supervisión. Mientras tanto el agente de IA **sí** cancelaba (`cancel_property_booking`, con confirmación y verificación de titular). Quien atiende, tiene más contexto y responde por lo que hace, quedaba por debajo. Cancelar se alinea con crear. Administrar el alojamiento sigue por encima: eso es catálogo, no operación.

**El alta comprueba disponibilidad antes de intentar.** El rechazo del servidor llega con las fechas ya cargadas y no dice cuáles sí hay; verificar antes convierte un error en una decisión. El contacto es opcional, así que un huésped de mostrador se carga con nombre y teléfono sin inventarle una ficha de CRM.

**El channel manager tiene motivo propio.** Cuando el calendario lo administra Hostaway, `createBooking` falla cerrado con `channel_manager_owns_calendar` — no hay write-back certificado, así que una fila local sería una reserva que el calendario real del anfitrión nunca conoce. La pantalla muestra **ese** mensaje y no un "no se pudo" que invita a reintentar. El bloqueo externo sigue registrado; esto no lo levanta, lo hace legible.

**Pruebas** — `stay-register-actions.spec.ts` (3 casos): crear y cancelar comparten exactamente el mismo conjunto de roles; administrar unidades sigue por encima del rol operativo; una estadía que administra el channel manager se rechaza con `ConflictException` y con proveedor y motivo en el cuerpo.

**Verificación**
```
npx tsc --noEmit (api + dashboard)  → exit 0
jest apps/api      → 2600 passed / 288 suites, 0 fallos
jest apps/dashboard → 172 passed / 21 suites, 0 fallos
```

## Cierre de Fase 2 — estado paquete por paquete

El plan no enuncia un "Gate 2" explícito: la aceptación de la Fase 2 es la columna *Aceptación* de cada paquete de §8.3. Estado al cierre:

| Paquete P0 | Estado | Dónde |
|---|---|---|
| Reservas alojamiento | ✅ | U14 (registro global) + U20 (crear/cancelar desde el registro) |
| Turismo semántico | ✅ parcial | U13 (etiquetas) + U14 (objetos). *Alojamientos/Habitaciones y plantillas hotel/STR son terminología → Fase 3* |
| Tours global | ✅ | U14 |
| Boarding pet | ✅ | U2 (tools) sobre el motor existente; ocupación/agrupamiento → Fase 5 |
| Alquiler vehículo | ✅ | U2 (tools) sobre el motor existente; depósito/contrato/calendario de flota → Fase 5 |
| Fotos Listings | ✅ | U15 |
| Fotografía | ✅ | U16 |
| Farmacia | ✅ | U17 (perfil sigue STOP por diseño: no vende dispensación) |
| Prompt correctness | ✅ | U18 |
| Plan/readiness | ✅ | U12 (readiness bloqueante) + U19 (plan en navegación) |
| Catálogo/pedidos | ✅ | U19 (guarda de los 8 perfiles) + correcciones previas del writer |
| Resource Rentals | ✅ | U2 |
| Tool honesty | ✅ | U4 + U5 |
| Regional foundation | ✅ | U7 |
| Consentimiento/RAG | ✅ | U8 + U9 |
| **Channel Manager** | 🔒 **BLOQUEADO** | Write-back a Hostaway exige credenciales sandbox y certificación por versión de API. Queda **fail-closed** con motivo tipado (`channel_manager_owns_calendar`) y handoff honesto — U3, reafirmado en U20 |

Un solo paquete queda abierto y su bloqueo es externo, no de código: sin sandbox no hay forma de probar el write-back, y publicarlo sin probarlo sería exactamente la doble reserva que el fail-closed evita.

## Fase 3 — Autoría de prompts, variables, plantillas y lenguaje

### U21 — Cada perfil llama a las cosas por su nombre

**Fase 3 · Épica F · Paso 6 (glosario canónico y avoid-list)**

La terminología vivía a nivel **industria**: 18 juegos de sustantivos para 76 negocios. Un hotel y un alquiler vacacional comparten "Turismo" y no comparten casi nada más —el primero vende habitaciones-noche, el segundo una casa entera— y a los dos la aplicación les decía **Propiedades**. Un taller y un concesionario comparten "Automotriz": uno recibe órdenes de trabajo, el otro vende autos. La palabra equivocada no es cosmética: es lo que el agente le dice al cliente y lo que el dueño busca en el menú.

**ADR-031 — Sólo se declara el perfil donde el sustantivo de la industria está mal.**
Un subtipo que usa bien el término de su vertical **no aparece** en el pack, y esa ausencia es la señal de que no hace falta — no un olvido. Un pack con las 76 entradas rellenas obligaría a mantener 76 juegos de sinónimos donde 18 alcanzan, y la primera vez que alguien no lo actualice quedará una palabra vieja con aspecto de decisión. 14 perfiles declaran hoy: los cuatro de Turismo, tres de Automotriz, tres de Pet Services, farmacia, dos de Restaurantes, arriendo inmobiliario y bodas.

**ADR-032 — La avoid-list no es estilo: es lo que el perfil no hace.**
Una dark kitchen no tiene salón, así que "reserva de mesa" promete algo inexistente. Una farmacia que le dice "paciente" a quien compra jabón abre una conversación clínica que no puede tener por chat. Un taller no ofrece prueba de manejo. Las palabras van al turno como `<avoid_terms>` y el contrato L1 dice explícitamente por qué: *esas palabras significan otra cosa en este negocio, o prometen algo que no hace*.

**Una misma resolución para las tres superficies.** El turno del agente (`verticalContext`), el hook del panel (`useVerticalTerms`) y el contrato L1 leen el mismo pack: sub-tipo primero, industria como respaldo. Antes el panel resolvía por industria y el prompt también, así que las dos estaban igual de equivocadas y en el mismo lugar.

**Pruebas** — `subtype-terminology.spec.ts` (9 casos): el pack sólo nombra perfiles del registro canónico (una entrada muerta no puede quedar); **todo sustantivo declarado tiene sus cuatro idiomas**; la resolución respeta el idioma pedido y cae al español para uno que todavía no existe; los tres negocios de turismo quedan separados; un perfil sin palabra propia devuelve `null` y no un objeto vacío; cada avoid-list nombra lo que corresponde; **ninguna palabra prohibida es a la vez un sustantivo que ese mismo perfil debe usar** — eso sería una contradicción que el modelo resolvería solo, mal. Más dos casos sobre el prompt: los términos llegan al turno y, sin términos propios, el bloque no aparece (nada vacío que el modelo interprete).

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard)  → exit 0
jest apps/api      → 2609 passed / 289 suites, 0 fallos
jest apps/dashboard → 172 passed / 21 suites, 0 fallos
```

### U22 — El set dorado mide lo que cada perfil puede romper

**Fase 3 · Épica F · Pasos 9-10 (eval pack y escenarios no-pitch)**

El set dorado con el que se mide un agente antes de activarlo eran **cuatro escenarios genéricos** —saludo, precio, agendar, fuera de tema— iguales para los 76 perfiles. Ninguno tocaba lo que de verdad puede salir mal en cada rubro: que el agente abra una venta sobre un síntoma, que le prometa una mesa a una dark kitchen que no tiene salón, o que improvise una respuesta sobre algo que su perfil declara que NO hace.

**ADR-033 — Los escenarios se derivan, no se inventan.**
Cada escenario nuevo sale de un hecho **ya declarado** en el registro: la avoid-list del perfil (U21), el estado care-first del rubro (U18) y las `exclusions` del perfil (U11). Un escenario inventado sería una prueba que mide una expectativa que nadie escribió — y la primera vez que falle, nadie va a saber si el agente está mal o si la prueba lo estaba.

Tres tipos de escenario, cada uno condicionado a que el perfil declare el riesgo:
- **`no_pitch_sensitive`** — sólo en los cinco rubros care-first, con un mensaje real del rubro (un dolor, un siniestro, una demanda, una mascota decaída, dos cuotas atrasadas) seguido de *"¿y eso qué me costaría?"*. El criterio dice explícitamente que **responder el precio es correcto**: la regla prohíbe abrir la venta, no responder lo que preguntan. Un criterio que castigara contestar enseñaría a callar, que es peor que vender de más.
- **`avoid_terms`** — sólo donde el perfil declara palabras prohibidas, y el criterio las **nombra todas**.
- **`declared_limit`** — sólo donde el perfil declara exclusiones; el agente debe decirlo y ofrecer derivar, no improvisar ni prometer gestionarlo.

Cada escenario viaja con su `origin`, para que el dueño sepa por qué está ahí y no lo borre por error. Un perfil que el registro no conoce no suma escenarios: medir contra una expectativa inexistente es peor que no medir.

**Pruebas** — `subtype-eval-pack.spec.ts` (10 casos): los cuatro universales siempre están; no-pitch aparece exactamente en los rubros care-first y en ninguno más; el criterio de no-pitch dice que responder el precio sigue siendo correcto; vocabulario sólo donde hay palabras declaradas, nombrándolas todas; una exclusión se vuelve un escenario a rechazar; un perfil desconocido no inventa nada; el origen viaja con cada escenario; **ninguna clave se repite en ninguno de los 76 perfiles** (el seed usa `ON CONFLICT (key)`, así que una clave repetida se pisaría sola); todo escenario tiene mensaje y criterio suficientes para que el juez pueda puntuar.

**Verificación**
```
npx tsc --noEmit (api + shared)  → exit 0
jest src/app.bootstrap.spec.ts   → 1/1 ✅ (DI limpio)
jest apps/api                    → 2619 passed / 290 suites, 0 fallos
```

### U23 — El país estaba en el turno y nadie lo leía

**Fase 3 · Épica H · Paso 13 (formatos regionales y forma de trato)**

U7 separó el país operativo del país de facturación y puso `<regional>` en el turno con país, moneda, locale, forma de trato y el pack del país con su estado. Faltaba lo que lo convierte en comportamiento: **ninguna regla del contrato le decía al modelo que lo usara**. Un tenant mexicano recibía `currency: MXN`, `addressForm: usted` y `locale: es-MX` como datos que nadie leía — el mismo patrón "existente pero inalcanzable" que el plan censó cuatro veces.

Dos reglas, y la segunda importa más que la primera:

**Regla 20 — trato y formatos.** El código de forma de trato es opaco (`voce` no significa nada suelto), así que la regla lleva la glosa: `usted` formal, `tu` informal, `vos` voseo rioplatense, `voce` você brasileño, `senhor_senhora` formal. Fechas, horas, números, teléfonos y direcciones se escriben como los escribe el locale.

**ADR-034 — Convertir un importe es inventarlo.**
El turno no trae tipo de cambio, así que cualquier equivalencia que el modelo escriba se la inventó. La regla es explícita y negativa: el precio conserva **exactamente** la moneda que trae el dato —si el catálogo o la tool dicen COP, se dice COP—, sin reformularlo en otra moneda, sin equivalencia aproximada y sin aplicar una tasa. `<regional><currency>` es sólo lo que el negocio cotiza **cuando el dato no trae moneda propia**. Sin esta regla, un tenant con `currency: MXN` y un catálogo en COP tenía todo lo necesario para producir un precio falso con aspecto de servicio.

**Pruebas** — `prompt-assembler.contract.spec.ts` (+2 casos, fijados por significado y no por redacción, como el resto del archivo): el contrato nombra el bloque regional, la forma de trato **con sus cinco códigos glosados** y el locale; y prohíbe convertir, nombrando la tasa de cambio que no tiene y la regla de que la moneda del dato manda.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api           → 2621 passed / 290 suites, 0 fallos
```

## Fase 4 — Navegación, home, Inbox y móvil

### U24 — El teléfono mostraba menos negocio que la pantalla grande

**Fase 4 · Épica D · Pasos 7 y 8 de §8.5**

**Móvil: un solo espacio operativo.** `resolveVerticalWorkspace` recorría una lista de prioridad y devolvía **el primero** que coincidía; el resto desaparecía del teléfono. Un gimnasio veía las clases y perdía la agenda; una escuela de idiomas veía las inscripciones y perdía las citas de admisión; un restaurante con salón veía los pedidos y perdía las reservas de mesa. **Once de los 76 perfiles** declaran más de una operación.

**ADR-035 — El conmutador aparece sólo cuando hay algo que conmutar.**
`resolveVerticalWorkspaces` devuelve todos los espacios en el mismo orden de prioridad, y **el primero es idéntico** al que devolvía el resolutor singular — una prueba lo verifica perfil por perfil, así que nada cambia para un negocio de una sola operación, que no gana una pestaña que no le sirve.

**ADR-036 — Una configuración v1 conserva exactamente lo que tenía.**
El resolutor plural sólo se abre con manifiesto vigente y capacidades publicadas. Un tenant que no reconcilió mantiene su único espacio: sumarle pestañas sería cambiarle la app sin aviso, y el resto del sistema ya trata la v1 como una valla, no como un caso a mejorar.

**Un defecto de la propia pantalla, encontrado al conectar el conmutador:** el título se resolvía llamando de nuevo al resolutor singular, que devuelve **siempre el primero**. Con el conmutador activo eso hacía que el título contradijera la pestaña elegida. Ahora sale del espacio que se está mostrando (`workspaceOfKind(kind)`).

**i18n residual (paso 8).** `Info` estaba escrito en inglés en las pestañas de propiedad y de tour dentro de una app de cuatro idiomas — ahora `Datos / Details / Dados / Informations`. Y en Campañas, cuatro estados (`Draft/Active/Paused/Finished`) vivían en una tabla de colores **con traducción ya existente que la pantalla sí usaba**: el literal inglés era una traducción muerta que la próxima edición podía volver a mostrar. Se eliminó el campo.

**Pruebas** — `verticalWorkspaces.test.ts` (9 casos): el primer espacio es idéntico al del resolutor singular **en los 76 perfiles**; gimnasio, escuela y restaurante casual reciben sus dos espacios; retail, guardería y alquiler de vehículos siguen con uno (las dos últimas pierden la agenda a propósito en el manifiesto); ningún espacio se repite; **toda capacidad operativa de todo perfil tiene su espacio en el teléfono** — si alguien agrega una capacidad y olvida el mapeo, el negocio quedaría invisible en móvil y nadie se enteraría; un perfil sin capacidades publica `none`; una configuración v1 conserva su único espacio.

**Verificación**
```
npx tsc --noEmit (api + dashboard + mobile)  → exit 0
jest apps/mobile    → 319 passed / 24 suites, 0 fallos
jest apps/api       → 2621 passed / 290 suites, 0 fallos
jest apps/dashboard → 172 passed / 21 suites, 0 fallos
```

### U25 — Operar no es administrar el catálogo

**Fase 4 · Épica D · Paso 3 de §8.5 (dividir permisos `view|operate` de `manage catalog`)**

Cada superficie vertical decidía su permiso **pantalla por pantalla**, sin registro que dijera qué era cada una. Así se llegó a tres asignaciones que cierran trabajo sin proteger nada:

| Superficie | Estaba en | Qué es de verdad |
|---|---|---|
| Sesiones fotográficas | catálogo | El **registro** de un estudio: pedidas, agendadas, entregadas. Su catálogo real son los paquetes, que hasta U16 ni siquiera tenían pantalla |
| Seguros | catálogo | **Mixta**: sólo la pestaña de planes es catálogo; cotizaciones, pólizas y siniestros son operación pura |
| Membresías | catálogo | **Mixta**: los planes son catálogo; el padrón con congelar, descongelar y renovar es trabajo de todos los días |

En las tres, quien atiende conversaciones no podía abrir la pantalla — perdía el objeto entero, no la parte que había que proteger. Es exactamente el criterio del Gate 4: *catálogo restringido sin bloquear operación*.

**ADR-037 — Tres tipos de superficie, no dos.**
`register` (quien opera), `catalogue` (supervisión) y `mixed` (se abre **operando** y el catálogo se gatea **adentro**). Cerrar una pantalla mixta para proteger una pestaña es tirar la mitad operativa; la alternativa —dividirla en dos rutas— es trabajo del paso 4 y no hacía falta para dejar de bloquear a quien opera hoy.

**No abre ningún 403.** La API de seguros ya estaba bien partida: las lecturas aceptan cualquier rol de tenant, crear cotización y siniestro acepta al agente, y sólo los planes exigen supervisión. Lo mismo en gimnasios. El defecto era del panel, no del backend: la pantalla se cerraba delante de endpoints que sí respondían.

**Pruebas** — `navigation-surface-kind.spec.ts` (6 casos): **todo ítem del panel está clasificado** (uno sin clasificar es una decisión que nadie tomó) y ninguna clasificación apunta a un ítem inexistente; **la capacidad de cada línea del menú se afirma contra la clasificación**, leyendo el archivo del sidebar — así la asignación deja de depender del criterio de quien escribe la línea; el guardia de rutas deja entrar al rol operativo en **todo** registro y mixta (una capacidad de menú que el guardia contradice deja la opción visible y la pantalla cerrada); y el catálogo sigue **cerrado**, porque abrirlo de más es el error opuesto.

**Verificación**
```
npx tsc --noEmit (shared + dashboard)  → exit 0
jest apps/dashboard → 178 passed / 22 suites, 0 fallos
```

### U26 — El Inbox muestra el objeto del que se está hablando

**Fase 4 · Épica D · Paso 5 de §8.5 (panel contextual con allowlist de datos)**

El panel del Inbox mostraba el contacto y el canal. Quien atendía leía *"confirmame la reserva"* y tenía que adivinar cuál, salir a buscarla y volver — mientras el agente de IA recibía ese mismo objeto **en cada turno** desde hacía un release, en `activeObjects`.

**ADR-038 — El panel ve lo mismo que el modelo, ni más ni menos.**
El endpoint devuelve el contrato `ActiveObjectContextItemV1` tal cual: tipo, estado, clase de estado, fuente, referencia, etiqueta, fechas, importe, moneda y sujeto. Esa lista **ya es** la allowlist que pide el plan, revisada cuando se construyó para el prompt; inventar una segunda para la pantalla habría creado dos que divergen. Una prueba lee el componente y falla si renderiza un campo fuera de la lista — sin eso, el panel deja de ser una lista revisada y pasa a ser una ventana a la base.

**ADR-039 — Enlace declarado o ningún enlace.**
`ACTIVE_OBJECT_DEEP_LINKS` decide para **los 24 tipos**; `professional_case` vale `null` porque todavía no tiene pantalla propia, y eso es una decisión escrita, no un olvido. Una prueba verifica que todo enlace apunte a una ruta que el registro de navegación realmente tiene: una ruta inventada termina en 404, que es peor que no ofrecer enlace.

**Tres estados distintos, tres textos distintos.** Cargando, vacío (no se muestra nada), caído ("no se pudo leer lo que este contacto tiene abierto — **no quiere decir que no tenga nada**") y parcial ("una de las consultas no respondió"). Una consulta caída que se ve igual que "no tiene nada abierto" hace que quien atiende actúe sobre una ausencia falsa: la misma regla que el contrato de lectura impone al agente, aplicada a la persona.

**Sin contacto no es un error.** Una conversación recién abierta por un número desconocido no tiene contacto todavía; el endpoint devuelve vacío en vez de fallar y mandar a buscar un problema que no existe.

**Un defecto propio, encontrado al arrancar:** el mapa de enlaces importaba `ACTIVE_OBJECT_KINDS` **como valor** desde `index.ts`, que re-exporta este archivo mucho antes de definir esa constante. El resultado era `undefined` en tiempo de evaluación y Nest fallaba al arrancar, lejos del archivo culpable. Ahora se importa solo el tipo y la lista se deriva de las propias claves del mapa.

**Pruebas** — `active-object-deep-link.spec.ts` (5 casos): hay decisión para **todos** los tipos; todo enlace apunta a una ruta real del registro; los objetos operativos van a su registro; `null` para el que no tiene pantalla; y el componente **sólo** renderiza campos del contrato acotado.

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard)  → exit 0
jest src/app.bootstrap.spec.ts → 1/1 ✅ (DI limpio)
jest apps/api       → 2621 passed / 290 suites, 0 fallos
jest apps/dashboard → 183 passed / 23 suites, 0 fallos
```

### U27 — El trabajo diario, arriba y separado de su catálogo

**Fase 4 · Épica D · Pasos 1 y 2 de §8.5 (orden del shell y grupos por perfil)**

Registros y catálogos vivían mezclados en **una sola sección** llamada "Operación", y esa sección estaba **debajo** de IA y crecimiento. Quien atiende conversaciones recorría automatizaciones, campañas y fichas de producto para llegar a su propia agenda.

**ADR-040 — El corte de secciones sale de la clasificación, no del criterio de quien agrega la línea.**
`NAVIGATION_SURFACE_KIND` (U25) ya declara cada superficie como registro, catálogo o mixta. **Trabajo diario** recibe los registros y las mixtas; **Catálogo y recursos** recibe los catálogos. Una prueba lee el archivo del sidebar, extrae los ítems de cada sección y falla si alguno cayó del lado equivocado o aparece en las dos — así el corte no se degrada con la próxima línea que alguien agregue.

**Trabajo diario sube por encima de IA y crecimiento**, verificado por posición en el archivo. Es el criterio del Gate 4: la operación primaria no puede estar detrás de las herramientas de crecimiento, que además el rol operativo mayormente no puede usar.

**Lo que NO se hizo, y por qué.** El plan nombra también `customers` y `commercial` como grupos propios. Hoy contactos, embudo y organizaciones viven como un ítem con hijos, y separarlos exige reestructurar la relación padre/hijo del menú — más churn de navegación del que justifica sin poder validarlo con usuarios. Queda anotado como resto del paso 2.

**Verificación**
```
npx tsc --noEmit (dashboard)  → exit 0
jest apps/dashboard → 185 passed / 23 suites, 0 fallos
```

### U28 — El tablero de Inicio muestra los KPIs de ESTE negocio, y con color

**Fase 4 · Épica D/E · Paso 6 de §8.5 (Home dependiente del perfil)**

Tres defectos en la misma pantalla, el primero de los cuales U17 dejó a medio camino sin que se notara.

**1. Las claves salían de la industria, no del perfil.** U17 le dio a `salud/farmacia` un `kpiContract` propio —productos, stock, pedidos, GMV— porque heredaba el tablero de una clínica: citas de hoy, inasistencias, tratamientos activos. Pero el Home leía `verticalConfig.dashboard.kpis`, que es la lista de la **industria**: el promedio de hasta cinco negocios distintos. El override existía y la pantalla no lo miraba. Ahora las **claves** salen del contrato del manifiesto (resuelto por sub-tipo) y las etiquetas, íconos y colores siguen saliendo de la definición vertical, que es donde están escritos en cuatro idiomas.

**2. Los KPIs verticales salían sin color.** El color se armaba como `` `text-[${kpi.color}]` `` en tiempo de ejecución. Tailwind sólo genera las clases que encuentra **escritas** en el código: esa clase nunca existió en el CSS. Los cuatro KPIs por defecto —que usan clases literales— sí tenían color, así que el negocio con tablero propio veía **menos** que el que no lo tenía. Ahora el hex va por `style`, y una prueba prohíbe volver a construir una clase de Tailwind desde un valor de runtime.

**3. "Hoy" en español.** `` `${customerNounPlural} Hoy` `` dentro de una app de cuatro idiomas.

**Pruebas** — `home-kpi-contract.spec.ts` (5 casos): el Home lee el contrato versionado; **ninguna clase de Tailwind se arma desde un valor de runtime** (verificado por patrón, así que tampoco vuelve en otra línea); las 76 configuraciones resuelven un tablero no vacío; el de farmacia no es el de una clínica; y no queda la palabra en español.

**Verificación**
```
npx tsc --noEmit (dashboard)  → exit 0
jest apps/dashboard → 190 passed / 24 suites, 0 fallos
```

### U29 — Llegar a la pantalla no es llegar al objeto

**Fase 4 · Épica D · Paso 4 de §8.5 (`?tab=` y defaults por rol)**

U26 le dio a cada objeto del panel del Inbox su enlace. Para los tres objetos de seguros —póliza, siniestro, cotización— ese enlace era `/admin/insurance` a secas: quien venía por un siniestro aterrizaba en la **pestaña de planes** y tenía que buscarlo de nuevo. El enlace cumplía la letra y no el trabajo.

**El `?tab=` es parte del enlace.** `insurance_claim` va a `/admin/insurance?tab=claims`, y la pantalla lo lee. La validación es doble y en el orden que importa: contra la lista de pestañas **y contra el permiso**, así que un enlace viejo, uno escrito a mano o uno guardado por alguien con otro rol no abre nada que el rol actual no pueda ver — cae a la primera pestaña que sí puede.

**El default por rol ya estaba** desde U25: sin permiso de catálogo, la primera pestaña es la operativa y no la de planes.

**Pruebas** — `active-object-deep-link.spec.ts` (+2 casos): los tres objetos de seguros abren su pestaña, y la ruta sin query sigue existiendo en el registro de navegación; y —la que evita el enlace muerto— **todo valor de `tab` que se emite existe en la pantalla**, verificado leyendo el archivo: emitir `?tab=siniestros` cuando la pantalla espera `claims` daría un enlace que parece funcionar y aterriza donde no es.

**Verificación**
```
npx tsc --noEmit (shared + dashboard)  → exit 0
jest apps/dashboard → 192 passed / 24 suites, 0 fallos
jest apps/api       → 2621 passed / 290 suites, 0 fallos
```

### U30 — Contar los callejones sin salida que el Gate 4 dice que no existen

**Fase 4 · Épica D · Paso 9 de §8.5 (telemetría de navegación)**

El Gate 4 pide *cero opción visible que termine en 403 o dead end*. Hasta acá eso se verificaba **estructuralmente**: los mapas, los permisos, las rutas. Pero la estructura sólo cubre lo que alguien pensó en declarar — un tenant con configuración rara, un enlace guardado hace meses o un rol que cambió a mitad de sesión producen el mismo síntoma sin que ningún mapa esté mal.

**ADR-041 — Sólo lo excepcional.**
Se emiten tres eventos: `access_denied`, `dead_end` y `plan_locked`. **No** se emite cada vista de ruta: sería un volumen que le cuesta almacenamiento al tenant para medir lo que ya funciona. Un 403 y un callejón son raros por construcción, y si dejan de serlo eso es exactamente el hallazgo. Se reusa `analytics_events`, que ya existe con `event_type` + `data`: una segunda tabla de eventos sería la duplicación que este programa viene removiendo.

**ADR-042 — Allowlist de campos, y se descarta el registro entero.**
Cuatro campos: ruta, motivo tipado, rol y requisito faltante. Ninguno identifica a una persona. Un **denylist** crece cada vez que alguien agrega un campo, y el día que se atrasa es el día que se guarda un dato personal en una tabla de analítica. Ante un campo desconocido se descarta el registro **completo**, no el campo: guardar la mitad buena esconde el problema hasta que aparezca lo que no debía estar.

**La ruta también lleva datos.** `/admin/contacts/<uuid>` pasa cualquier patrón de ruta razonable y metería el identificador de un contacto en la tabla. Todo segmento que parezca un id —uuid, numérico, hex largo— rechaza el registro. Recortarlo habría dejado una ruta que no es la que ocurrió.

**Medir no puede empeorar lo que se mide.** La cola vive en memoria, agrupa 3 s, se manda sin `await` y sin propagar el fallo; si el usuario cierra la pestaña se pierde lo pendiente, y está bien: perder telemetría es infinitamente mejor que retrasar una navegación. Un mismo tropiezo no se cuenta dos veces aunque React vuelva a renderizar.

**El endpoint lo abre el rol operativo a propósito**, contra el `@Roles` de la clase: es justamente quien choca con esto, y uno que sólo acepte supervisión mediría a quien no lo sufre.

**Un error de tipos ajeno, encontrado al compilar:** `agent-quality.service.ts` tenía un `.catch(() => [])` que infiere `never[]` y hacía fallar el `.filter` de abajo. Sus dos hermanos del mismo bloque ya lo anotaban bien. Se corrigió igual: un error que bloquea el typecheck bloquea el deploy, sea de quien sea.

**Lo que NO se hizo.** Tiempo-a-tarea, click depth, búsqueda y backtracking necesitan instrumentar el recorrido completo, no el tropiezo. Son analítica de producto, no de corrección, y quedan anotados como resto del paso 9.

**Pruebas** — `navigation-telemetry.spec.ts` (8 casos, uno parametrizado ×4 y otro ×5): se acepta la forma que emite el panel; un nombre de evento no declarado se descarta; **un correo, un nombre, texto libre o un id descartan el registro entero**; una ruta con id, con query, absoluta o vacía se rechaza; el motivo tiene que ser tipado; los opcionales siguen siendo opcionales; el lote se acota y descarta sólo lo inválido; la basura no rompe.

**Verificación**
```
npx tsc --noEmit (api + shared + dashboard)  → exit 0
jest src/app.bootstrap.spec.ts → 1/1 ✅ (DI limpio)
jest apps/api       → 2621 passed / 290 suites, 0 fallos
jest apps/dashboard → 207 passed / 25 suites, 0 fallos
```

### U31 — Se medía que el agente rechazara lo que nadie le había dicho

**Fase 3 · Épica F · Pasos 1 y 2 (scope y límites del perfil)**

U22 puso en el set dorado un escenario `declared_limit`: se le pide al agente algo que su perfil declara que **no** hace y se mide si lo rechaza con claridad. Esas exclusiones viven en el registro de perfiles desde U11 — y **nada se las decía al agente**. La prueba medía al modelo adivinando, no al sistema.

Ahora el turno lleva `<not_offered>` y el contrato dice qué hacer con él: decirlo sin rodeos en el idioma del cliente y ofrecer pasar a una persona. Sin improvisar una respuesta y sin prometer gestionarlo.

**La parte que evita el peor error:** *el límite es del negocio, no de tus herramientas*. Un perfil de salud declara que no lleva expediente clínico ni da diagnóstico; que exista una tool de tratamientos —porque otro subtipo de la misma industria la usa— no es permiso para hacerlo. Sin esa frase, un modelo con una herramienta disponible tiende a leer disponibilidad como autorización.

**Un perfil que el registro no conoce no declara límites**, y no se le inventa ninguno: un límite falso hace que el agente rechace algo que el negocio **sí** hace, que es el error simétrico y peor de explicar.

Se resuelve aparte de la terminología porque un perfil puede tener límites sin tener sustantivos propios — de hecho la mayoría está en ese caso.

**Pruebas** — `subtype-terminology.spec.ts` (+2 casos): los límites llegan al turno; el contrato nombra el bloque, dice que no se hace, ofrece derivar y **contiene explícitamente** que el límite es del negocio y no de las herramientas. Y el caso de ausencia se amplía: sin límites declarados el bloque no aparece.

**Verificación**
```
npx tsc --noEmit (api + shared)  → exit 0
jest apps/api → 2623 passed / 290 suites, 0 fallos
```

### U32 — `stop` era documentación: un perfil bloqueado seguía cerrando operaciones

**Fase 2/5 · Épica A/G · El bloqueo que no bloqueaba**

Siete perfiles están declarados `strategy: 'stop'` en el registro desde U11 — `fintech`, `marketplace`, `aseguradora`, `wedding_planner`, `construccion`, `technology/consultoria_ti` y `veterinaria/salud`. El registro lo declaraba, la auditoría lo contaba, los dossiers lo justificaban… **y el runtime publicaba sus writers igual que en un perfil certificado**. Un `stop` que igual reserva, cotiza o abre un siniestro es exactamente lo que el bloqueo existía para impedir.

Grepear `strategy === 'stop'` en todo `apps/api` devolvía cero resultados de negocio. Era el mismo patrón "existente pero inalcanzable" que el plan censó cuatro veces, con la vuelta cruel de que lo inalcanzable era **la protección**.

**ADR-043 — Un perfil bloqueado no cierra nada, pero sigue hablando.**
El contrato efectivo descarta toda tool cuyo `effect` no sea `read`, con motivo `profile_blocked` y un texto que el panel puede mostrar: *"Este tipo de negocio todavía no puede cerrar operaciones por chat; el equipo las confirma."* Las **lecturas se conservan a propósito**: el negocio existe y responde preguntas con honestidad — una aseguradora sigue pudiendo decir qué planes tiene. Lo que no puede es comprometerse con algo que su modelo de producto todavía no sostiene, y para eso está el handoff, que sigue publicado.

Esto cierra el criterio del Gate 5 por el lado que sí depende de nosotros: *"el flujo central funciona de punta a punta en su alcance declarado, **o el perfil sigue STOP**"*. Hasta acá la segunda mitad de esa frase no tenía código detrás.

**Pruebas** — `effective-capability.spec.ts` (+3 casos): un perfil bloqueado no publica ninguna tool que escriba; conserva la lectura de su rubro y el motivo es legible; y un perfil **no** bloqueado de la misma industria (`seguros/broker`) sigue publicando sus writers — sin eso, el gate podría estar apagando a todos y la prueba no lo notaría.

**Verificación**
```
npx tsc --noEmit (api + shared)  → exit 0
jest apps/api       → 2626 passed / 290 suites, 0 fallos
jest apps/dashboard → 207 passed / 25 suites, 0 fallos
```

### U33 — El bloqueo tapaba la puerta principal y dejaba abierta la de servicio

**Fase 2/5 · Épica G · Continuación de U32**

U32 hizo real el `stop`… en el contrato estático. Pero el propio comentario del runtime lo decía: *"las familias que se resuelven asincrónicamente —pagos, descuentos, integraciones, MCP— se agregan fuera del contrato estático y conservan sus propias puertas"*. Esas familias **pasaban sin tocar**. Una aseguradora bloqueada seguía pudiendo generar un enlace de pago: se le cerró la reserva y se le dejó el cobro.

El contrato ahora expone `writersBlocked`, y el turno lo aplica a la lista **completa** de tools, no sólo a las estáticas.

**ADR-044 — En un perfil bloqueado, desconocido es no.**
El filtro conserva únicamente lo que tiene política revisada **y** efecto `read`. Una tool sin política —una MCP, por ejemplo— cae. En cualquier otro perfil eso sería demasiado agresivo; en uno bloqueado es la única lectura correcta de "no puede comprometer al negocio con nada".

**Pruebas** — `effective-capability.spec.ts` (+1 caso): el perfil bloqueado expone `writersBlocked: true` y el no bloqueado de la misma industria `false` — sin la comparación, un flag siempre-verdadero pasaría la prueba.

**Verificación**
```
npx tsc --noEmit (api + shared)  → exit 0
jest src/app.bootstrap.spec.ts → 1/1 ✅ (DI limpio)
jest apps/api → 2627 passed / 290 suites, 0 fallos
```

### U34 — El contrato decía "sé humano" y nada decía que no lo afirmes

**Fase 3 · Épica F · Paso 1 (role disclosure)**

La regla 8 del contrato decía literalmente *"Be a human having a conversation"*. La persona lleva nombre propio —Sofía, Camila, Diego— y el cliente no tiene forma de saber qué hay del otro lado. **Nada en el contrato le decía al modelo que no podía afirmar que era una persona**, y la regla que sí hablaba del tema empujaba en la dirección contraria.

Es un ítem nombrado del plan (*"Escribir scope, role disclosure, límites y claims permitidos"*) y una exposición real: un cliente que pregunta "¿sos una persona?" merece una respuesta honesta, y en varios mercados eso además se exige.

**Dos cambios, y el segundo depende del primero.** La regla 8 se reescribió para que no pueda leerse como permiso: *"Converse like a person… This is about **how you write**, never about what you are."* Y la regla 8b dice lo que faltaba: sos el asistente del negocio, no parte de su equipo y no una persona; nunca afirmes ni sugieras ser humano, ni te atribuyas cuerpo, ubicación o vida personal; si te preguntan —de frente o de costado— decilo con claridad y ofrecé pasar con alguien del equipo.

**Y el nombre propio no es una excusa:** la regla lo dice explícitamente — *el nombre es cómo te llaman, no una afirmación sobre lo que sos*. Sin esa frase, un modelo con persona "Sofía" tiene un argumento para no desmentir.

**Pruebas** — `prompt-assembler.contract.spec.ts` (+1 caso, fijado por significado): el contrato nombra la divulgación de rol, prohíbe afirmar o sugerir ser humano, ofrece derivar, desactiva la excusa del nombre propio, y **ya no contiene** la frase vieja que se leía como permiso.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2628 passed / 290 suites, 0 fallos
```

### U35 — El contrato llegaba tarde a su propia decisión, y la puerta no era una sola

**Pendientes internos 1, 2, 3, 4 y 5 · avance parcial del 10**

El contrato efectivo se resolvía **al final** del turno, cuando el motor determinista ya había podido crear una cita, Procedures ya había podido invocar un writer y las familias asíncronas —pagos, integraciones, MCP— ya se habían agregado. Un perfil bloqueado tenía tres caminos para escribir antes de que nadie le preguntara si podía.

Y el bloqueo se había cerrado tres veces —lista de tools, motor de reservas, Procedures— **cada vez donde se había visto el problema**. Los tres son llamadores del mismo ejecutor, y el ejecutor no preguntaba nada: apareció una cuarta puerta (la confirmación server-side del "sí") por el mismo motivo por el que aparecerá una quinta.

**Cinco cambios, en este orden:**

1. **El contrato se resuelve primero.** Una sola vez, antes que nada, y su resultado gobierna el motor determinista, Procedures y la publicación. Lo que el contrato no autoriza no se intenta: se deriva.
2. **Entradas que faltaban.** El contrato ya sabía subtipo ∩ agente ∩ plan ∩ readiness; ahora también rol, canal, país/jurisdicción y **salud/scopes/frescura del proveedor**. Un rol no operativo y un canal no conversacional bloquean la escritura igual que un perfil `stop`.
3. **La puerta baja al ejecutor.** `AIToolExecutorService.execute()` recibe la decisión del turno y rechaza lo que compromete al negocio, venga del llamador que venga — incluido el que todavía no existe. Devuelve `capability_blocked` con `shouldHandoff`, no un fallo silencioso.
4. **`commitsBusiness` como campo de política de primera clase.** El primer intento filtró por `effect === 'write'` y mató siete lecturas semánticas (`search_faqs`, `get_policy`, `search_knowledge_base`, `recommend_products`…), el par de identidad y las cuatro lecturas de proveedor: un perfil bloqueado quedaba además **mudo**, que es peor que el problema que el bloqueo evita. La regla correcta no es "no escribe una fila" sino **"no compromete al negocio"**.
5. **`<capability_status>` en el turno.** El backend ya cerraba la puerta; el modelo no sabía por qué y seguía prometiendo lo que la puerta iba a rechazar. Ahora viaja como dato, con la regla 23 del contrato L1: no ofrezcas ni prometas, decí que necesita a alguien del equipo, no nombres el motivo interno y no lo presentes como una falla temporal.

**Dos correcciones sobre el propio trabajo**, encontradas al probarlo:

- La primera versión de la compuerta de proveedor gateaba las **familias** `restaurants`, `gyms` y `treatments`, que son **nativas** (su readiness apunta a `menu_items`, tablas propias). Habría apagado a todo restaurante que nunca integró nada. Lo que depende del proveedor son cuatro lecturas concretas, y ahí quedó la compuerta — que además es la mitad del pendiente 10: esas cuatro pasaron de publicarse por estar *conectadas* y fuera del contrato, a publicarlas el contrato con salud, scopes y frescura.
- `degraded` significa "una entrada de la decisión no se pudo leer", **no** "no se puede operar". La primera versión de la regla 23 se disparaba con cualquier estado distinto de `ok`, y un restaurante sano habría dejado de tomar reservas porque una consulta de plan falló. El bloque lleva ahora `writes="allowed|blocked"` y la regla mira eso.

**Lo que NO se tocó:** `tool-approval-workflow.service.ts` ejecuta tras la aprobación **de una persona**. Un perfil bloqueado deriva a un humano; que ese humano después apruebe es exactamente el desenlace que el bloqueo busca, no una fuga.

**Pruebas** — `capability-stop-profiles.spec.ts` (nuevo, 36 casos): los 7 perfiles STOP leídos del registro —no de una lista a mano— contra las cinco puertas. Además: 8 casos de proveedor en `effective-capability.spec.ts` (conectado ≠ sano ≠ fresco, y la familia nativa que sobrevive sin proveedor) y 4 en `prompt-assembler.contract.spec.ts`. Tres specs existentes cambiaron de expectativa porque el ejecutor recibe un argumento más.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2676 passed / 291 suites (1 skipped), 0 fallos
jest app.bootstrap → 1 passed — DI de NestJS limpio
```
> El bootstrap exige `ENCRYPTION_KEY` de 64 hex en el shell; sin él falla por entorno, no por DI.

### U36 — El selector ofrecía los siete perfiles que el runtime bloquea

**Pendiente interno 6**

El runtime ya no deja que un perfil `stop` cierre operaciones (U32, U33, U35). El **selector del alta seguía ofreciéndolos**: `GET /verticals/definitions/all` itera el registro entero sin mirar el perfil, y `resolveVerticalSelection` sólo validaba pertenencia a la industria. Un dueño podía anotarse hoy en `seguros/aseguradora` y recibir un producto que por diseño no puede reservar, cotizar ni cobrar. La honestidad estaba puesta en el turno; faltaba en la venta.

**Un eje nuevo, separado de la estrategia.** `strategy` dice CÓMO se entrega —nativo, integrado, migrado— y es una decisión de producto; `availability` dice si el selector lo ofrece. Mezclarlos habría sido un error: un perfil `migrate` es perfectamente vendible (es la experiencia que siempre debió ser) y un `build` puede estar en piloto mientras se termina. Cuatro estados: `selectable`, `pilot` (por invitación de un super_admin), `waitlist` (hay demanda registrada y todavía no producto) y `legacy_only`.

**La disponibilidad se DERIVA cuando no se declara** — `stop → legacy_only`, cualquier otra → `selectable`. Anotar las siete entradas a mano habría dejado la puerta abierta a la octava: el día que alguien agregue un perfil bloqueado nuevo y se olvide del campo, el selector lo ofrecería. Se declara explícito sólo cuando la respuesta no se deduce de la estrategia.

**La puerta está en el servidor, no en el `<select>`.** Filtrar una opción la esconde; no la cierra: `industry` y `subType` son strings libres en el DTO del alta. `resolveVerticalSelection` toma ahora una **superficie** — `signup` acepta `selectable`; `admin_create` acepta además `pilot`; `existing` no restringe nada. Los tres puntos de entrada quedaron cableados: alta self-service, alta administrativa y migración de vertical (mover a un tenant HACIA un perfil es una elección nueva).

**`legacy_only` es lo que hace posible cerrar sin romper a nadie.** El tenant que ya está en uno de los siete sigue resolviendo su perfil, guardando y operando; **no se lo migra en silencio**. Por eso el catálogo del API sigue devolviendo los 75 subtipos completos —sacarlos del payload dejaría a su propia pantalla sin saber cómo llamarlo— y lo que se agrega es la anotación: `availability` en cada subtipo y en `meta`. Cada superficie recorta; el helper `offerableSubTypes(subTypes, allowed, keep)` conserva siempre el subtipo que el tenant ya tiene.

**Sin dato = elegible, a propósito.** Un dashboard nuevo contra un API viejo no puede quedarse con el selector vacío y bloquear todas las altas. Es seguro porque la decisión real la toma el servidor.

**Pruebas** — `vertical-identifiers.spec.ts` (+26): los 7 perfiles leídos del registro se rechazan en `signup` y en `admin_create`, y **siguen resolviendo** para el tenant que ya los tiene; un perfil ofrecido pasa en las tres superficies; la derivación cierra al `stop` que nadie anotó. `verticals.controller.spec.ts` (+2): el catálogo no pierde nada y cada subtipo lleva su disponibilidad. `vertical-catalog.spec.ts` (nuevo, dashboard): el recorte por superficie y la conservación de `keep`. Una prueba de concurrencia cambió su fixture porque usaba `retail/marketplace` como vertical arbitraria.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api, dashboard
jest apps/api       → 2702 passed / 291 suites (1 skipped), 0 fallos
jest apps/dashboard →  212 passed /  26 suites, 0 fallos
```

### U37 — La puerta de servicio del alojamiento, y las claves que se veían tapadas pero no lo estaban

**Pendientes internos 7 y 8**

**El writer del agente ya fallaba cerrado** cuando el PMS es dueño del calendario: `LodgingSourceOfTruthService` existe exactamente para eso y su comentario lo dice —*"escribir localmente crea una reserva que el PMS nunca conoce; eso es un doble booking con pasos extra"*—. `POST /channel-manager/reservations` no preguntaba nada: insertaba `provider = 'direct'` en **cualquier** listado, incluidos los de Hostaway. El mismo defecto que esa asimetría existe para evitar, entrando por otra puerta.

Ahora el alta lee el proveedor del listado y rechaza los que tienen su libro mayor afuera (`hostaway`, `guesty`) **diciendo dónde crearla**: un "no se puede" sin destino deja al dueño buscando un botón que no existe. `ical` no está en esa lista a propósito — un feed iCal es el calendario del propio tenant publicado hacia las OTAs, así que la reserva directa ahí es el caso normal y el bloqueo viaja en el export.

**Y el conflicto se medía contra una palabra que el proveedor no usa.** El filtro era `status = 'confirmed'`; Hostaway manda `new`, `modified`, `ownerStay`, `awaitingPayment`. Una estadía sincronizada no bloqueaba nada. Se invirtió la pregunta: la lista enumera lo que **libera** la fecha y todo lo demás ocupa, así que un estado que el proveedor invente mañana bloquea por defecto —no saber si ocupa no es saber que está libre—. La misma corrección va en el calendario de disponibilidad y en el contador de reservas activas, que tenían el mismo filtro: el calendario mostraba libre una noche vendida.

**Las credenciales estaban en claro.** Hostaway, Guesty, Toast, Mindbody y Cliniko vivían como texto plano en `tenant.settings`, y su endpoint las tapaba con `***` — protección que se ve en pantalla y no existe en la base. Cualquier backup, cualquier volcado y **`GET /tenants/:id`** (que devolvía el JSONB entero: sólo `tenantPayments` estaba redactado) las entregaba completas.

Se cierran **las dos mitades, porque una sin la otra no sirve**: cifrado en reposo con `TenantSecretCryptoService` —hermano del sobre de pagos, misma mecánica AES-256-GCM con keyring rotable, espacio de nombres distinto a propósito— y las claves fuera del contrato genérico del tenant. Cifrar sin lo segundo sólo movería el problema un paso: una respuesta que devuelve el sobre entero lo saca del sobre.

El AAD ata cada valor a su tenant, scope, proveedor y campo: copiar la fila de un tenant a otro, o el `apiKey` de Cliniko al slot de Mindbody, rompe la autenticación en vez de redirigir una integración en silencio.

**Tres decisiones de migración**, que son lo que hace que esto no rompa a nadie:
- Lo que hoy está en claro **se sigue leyendo** y se re-guarda cifrado en el mismo camino, sin una migración aparte que alguien tenga que acordarse de correr.
- Leer texto plano **no exige clave** —no hay nada que descifrar—, así que una instancia con la variable mal puesta no pierde las integraciones que ya funcionaban. Guardar una credencial nueva **sí** falla cerrado: persistir un secreto que no se puede cifrar es el defecto que esto viene a cerrar.
- Un sobre **corrupto no se degrada a texto plano**: se omite el campo. Usar el ciphertext como credencial haría que el error dijera "el proveedor rechazó la clave" en vez de "el sobre está roto".

**Sin variables nuevas obligatorias:** `TENANT_SECRET_KEY` cae a `ENCRYPTION_KEY`, que ya está desplegada. Rotar la clave requiere agregar `TENANT_SECRET_KEY` / `TENANT_SECRET_KEY_ID` / `TENANT_SECRET_PREVIOUS_KEYS` a Secrets **y** a `deploy.yml`, como toda variable nueva.

**Pruebas** — `channel-manager-reservations.spec.ts` (nuevo, 10): rechazo por proveedor con motivo accionable, `ical` y `direct` que sí pasan, y el predicado de ocupación verificado sobre la consulta real. `tenant-secret-crypto.service.spec.ts` (nuevo, 18): el sobre no se abre desde otro tenant/scope/proveedor/campo, la rotación lee lo viejo y pide reescritura, y el puente de migración no degrada un sobre roto. `vertical-integrations.credentials.spec.ts` (nuevo, 9): nada del secreto aparece en lo persistido, el `***` del panel no pisa la credencial guardada, lo viejo en claro se re-cifra solo, y las dos claves quedan fuera del contrato genérico.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2739 passed / 294 suites (1 skipped), 0 fallos
```

### U38 — Había que probar para poder probar

**Pendiente interno 9**

El botón **Probar** sólo aparecía cuando el proveedor estaba `connected`, y `connected` exige `credentialValidated`, que se enciende **probando**. Peor: guardar la credencial resetea la salud a "sin validar" a propósito —guardar no es haber verificado—, así que **después de guardar la única acción disponible era volver a guardar**. Un callejón sin salida cerrado sobre sí mismo.

La causa es una confusión de dos momentos con un solo nombre. Ahora se llaman distinto: `configured` (hay credencial guardada) enciende la fila de acciones; `connected` (además se validó contra el proveedor) es lo único que habilita **Sincronizar**, porque sincronizar antes de validar sólo produce un error del proveedor. El camino queda dicho en la pantalla: Guardar → Probar → Sincronizar.

**La salud ya se calculaba y nadie la mostraba.** `materializeIntegrationHealth` sabe desde hace un release si la credencial fue validada, qué permisos concedió el proveedor de los que hacen falta, de cuándo es el último dato traído y si el circuito está abierto. El dueño veía "Conectado" o nada: una integración con el token vencido, con la mitad de los permisos o sincronizada hace tres días se veía **idéntica** a una sana, y se enteraba por un cliente que preguntó por un horario que no existía. El panel nuevo muestra estado, validación, frescura con antigüedad legible, permisos faltantes, último error y circuito.

**Y ofrecía las tres integraciones a todo el mundo.** Una peluquería veía "Toast (POS de restaurante)" como algo que podría conectar. Ofrecer lo que no aplica no es neutral: le enseña al dueño que la pantalla no sabe qué negocio tiene, y entonces tampoco confía en lo que sí le muestra. El filtro sale del **manifiesto** —la misma fuente que decide qué puede hacer el agente—, así que un subtipo que mañana gane `restaurants` ve Toast sin tocar esta pantalla. Dos excepciones deliberadas: lo ya configurado se muestra **siempre** (si no, un tenant que migró de vertical pierde el botón de desconectar y la credencial queda viva sin pantalla que la administre), y sin config resuelta no se filtra nada.

Detalle que faltaba: **Probar es lo que actualiza la salud**, y la pantalla no recargaba — el panel mostraba el estado anterior a la prueba recién hecha.

**Pruebas** — `vertical-integrations.ui-contract.spec.ts` (nuevo, 14): lee el fuente de la página igual que `vertical-catalog-consumers.spec.ts`, porque lo que hay que fijar es que la pantalla no vuelva a decidir con `connected` lo que se decide con `configured`. Verifica también que los grupos de tools que nombra existan de verdad en el manifiesto — uno mal escrito escondería la integración para siempre y en silencio.

**i18n**: `verticalIntegrations.health.*` y `testFirst` en los 4 idiomas.

**Verificación**
```
npx tsc --noEmit  → exit 0 en api y dashboard
jest apps/api       → 2753 passed / 295 suites (1 skipped), 0 fallos
jest apps/dashboard →  212 passed /  26 suites, 0 fallos
```

### U39 — Una tool remota no tiene nombre que valga, pero sí una firma

**Pendiente interno 10 (mitad restante)**

Las cuatro lecturas de proveedor ya habían entrado al contrato en U35. Faltaba MCP, y ahí el problema es distinto: una tool remota **no tiene política propia** —el nombre lo eligió un tercero y no dice nada—, así que el contrato la trataba a toda como comprometedora. Correcto como default y equivocado como final: un perfil bloqueado perdía también sus **consultas** remotas y quedaba mudo, que es el resultado que el bloqueo existe para evitar, no para causar.

Lo único que sabe qué hace una tool remota es **la aprobación que una persona firmó**: el registro ya guarda `effect`, revisado y auditable, y ya se rechaza aprobar un efecto que no sea lectura sin confirmación. Eso es lo que ahora decide.

**Dos lados, porque una sola mitad no alcanza:**
- **Publicación** — `listPublishableTools` adjunta el efecto revisado a cada tool, y el filtro del contrato deja pasar `effect: 'read'` cuando la escritura está bloqueada.
- **Ejecución** — la aprobación se resuelve **antes** de la puerta de capacidad, no en el preflight. Resolverla tarde era exactamente por qué la puerta no tenía con qué distinguir una consulta de un cobro. Es la misma resolución de antes, movida arriba, no una consulta nueva.

**Sin efecto revisado, no pasa.** Una tool aprobada antes de que existiera el campo, o una aprobación ilegible, es desconocida — y desconocida no pasa cuando la escritura está bloqueada.

**El Channel Manager no aporta tools propias.** Sus reservas llegan al agente por `check_property_availability`, que es una tool estática con política revisada y ya está bajo el contrato: no hay nada que reclasificar ahí.

**Pruebas** — `capability-stop-profiles.spec.ts` (+3): con el perfil bloqueado, una escritura aprobada cae, una tool sin efecto revisado cae, y una lectura firmada por una persona pasa.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2756 passed / 295 suites (1 skipped), 0 fallos
```

### U40 — El `+57` que nadie pasaba y todos heredaban

**Pendiente interno 11 (primera mitad)**

`normalizePhoneE164` tenía `defaultCountryCode = '57'` y **ninguna** de las catorce llamadas lo pasaba. Un número mexicano o argentino escrito sin prefijo se volvía colombiano. En identidad eso no es cosmético: los contactos se cruzan por `phone_normalized`, así que dos personas distintas terminaban **fusionadas en un solo contacto**, y no hay deshacer que las separe.

**El default se eliminó, no se cambió.** Sin país no hay país: un número nacional sin región devuelve `null`. Todos los llamadores ya hacían `normalizePhoneE164(x) || x`, así que no se pierde el dato — se pierde una certeza falsa. Un E.164 explícito sigue funcionando sin región, porque perder el prefijo que el cliente **sí** escribió es el error opuesto.

**Y el barrido de prefijos también inventaba.** El bucle genérico aceptaba cualquier código con el que el número empezara, sin mirar el largo: `5512345678` se leía como Brasil —`55` más ocho dígitos, un largo que Brasil no usa— y salía un `+55…` con la misma confianza que uno real. Un prefijo no es una identificación; coincidir en dos dígitos le pasa a cualquier número. Ahora el barrido exige un largo nacional válido, y el "mejor esfuerzo" con largo raro sobrevive **sólo** cuando el dueño declaró su país.

**`phoneRegionFor(tenantId)` devuelve `null` cuando la procedencia es `fallback`**, y ésa es toda la idea. Un fallback es "no sabemos, pusimos algo para seguir"; usarlo para decidir a qué país pertenece un número es el `+57` de antes con otro nombre, sólo que escondido detrás de un servicio que parece saber. Un `derived` que cuelga de un país que a su vez es fallback tampoco sabe más que él.

**Los catorce llamadores, con la consecuencia de cada uno anotada** — identidad (fusiona personas), leads y su `phone_normalized` (deduplica), import CSV (mil filas de una, y el error ahora distingue "archivo mal" de "falta declarar el país"), import de CRM externo y su preview (que clasificaba con otra regla que la importación: el dueño veía 12 coincidencias y se creaban 12 contactos), reserva pública, padrón de gimnasio, la llave de identidad y el OTP del portal (mandar el código a un número inventado es mandárselo a otra persona), el opt-out de SMS (el peor: no encuentra el opt-out y le escribe a quien pidió no recibir), el contacto que crea el canal, y el 2FA de un usuario de plataforma.

`RegionalProfileService` pasó a un módulo **global** propio: sus consumidores son transversales y colgarlo de `TenantsModule` obligaba a nueve módulos a importar Tenants entero —con sus controladores— sólo para saber en qué país opera el negocio, cerrando varios ciclos.

**Pruebas** — `phone-region-consumers.spec.ts` (nuevo, 17): que la función no invente un país, que un prefijo no alcance para identificar, que el país declarado gane sobre el barrido, y —la mitad que se pierde primero— que **ningún llamador vuelva a omitir la región**, barriendo el fuente, porque una llamada de un solo argumento compila perfecto. Esa prueba encontró un consumidor que se me había pasado (el preview del import de CRM). `regional-profile.service.spec.ts` invirtió la aserción que documentaba el defecto.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2774 passed / 296 suites (1 skipped), 0 fallos
```

### U41 — Detectar sin poder decidir es un diagnóstico sin tratamiento

**Pendiente interno 11 (segunda mitad)**

El perfil regional distingue lo que el dueño **declaró** de lo que se dedujo, se infirió o se puso por defecto, y detecta cuándo las señales se contradicen —moneda que no corresponde al país, país de facturación distinto del que el dueño escribió en Business Info—. Faltaban las dos puntas:

- **`queueConflictsForReview` no tenía ningún llamador.** La tabla `regional_identity_reviews` estaba permanentemente vacía. Un detector sin disparador es una función que compila.
- **No existía forma de declarar un valor.** La rama `declared` era **inalcanzable**: el país siempre llegaba `inferred` o `fallback`. Y un `fallback` no es un detalle de procedencia — es exactamente lo que hace que un teléfono no se normalice (U40) y que el agente hable de precios en la moneda equivocada.

**El disparador** es un cron nocturno con lock (`prefer: 'worker'`, porque todo `@Cron` corre en API y worker), que recorre los tenants activos. Deliberadamente lento y barato: las señales que producen un conflicto cambian cuando alguien edita la configuración, no solas, y el encolado es idempotente —actualiza la revisión pendiente en vez de acumular filas—. Un tenant que falla no para el barrido de los demás.

**La decisión** entra por dos puertas. `resolveReview` acepta **sólo uno de los candidatos detectados** —un campo libre sería otra puerta para escribir la identidad regional sin que nadie mire, que es de donde vino el problema— y `declare` cubre el caso más común, que **no produce conflicto**: un tenant que nunca declaró nada tiene una sola señal, o ninguna. Sin esa segunda puerta seguiría sin poder decir en qué país opera.

**Cada campo escribe su propia columna y nada se deduce de nada.** Elegir el país no cambia la moneda por su cuenta: un negocio colombiano que cobra en dólares existe, y "corregirlo" le cambiaría los precios. El mapa campo→columna es explícito, no derivado del nombre, porque una convención que "casi siempre" acierta es la que un día escribe la columna equivocada. La zona horaria se valida contra la base de zonas del runtime, no contra una lista propia que quedaría vieja con cada tzdata.

**La pantalla muestra la procedencia**, que es el punto entero. Con el mismo texto en pantalla, "el negocio dijo que opera en México" y "nadie dijo nada y pusimos Colombia para poder seguir" son indistinguibles — y la segunda es la que rompe cosas.

**Y de paso, el formulario de Localización dejaba de ser honesto** (adelanta parte del pendiente 12): pintaba `America/Bogota`, `COP` y `es-CO` como valores iniciales **antes de leer nada**, así que un negocio mexicano que entraba a cambiar el formato de fecha y apretaba Guardar declaraba —sin verlo— que opera en Bogotá y cobra en pesos colombianos. Ahora los campos sin dato quedan en "Sin definir" y no se guarda lo que el dueño no eligió: mandar `""` borraría un valor declarado antes, y mandar el placeholder lo declararía.

**Pruebas** — `regional-review.spec.ts` (nuevo, 17): la escritura por columna para los cinco campos, el rechazo de un valor fuera de los candidatos, de un formato inválido, de una zona horaria inventada y de una revisión ajena o ya resuelta; la invalidación del caché (sin ella el perfil sigue diciendo lo viejo); y el cron con su tenant que falla.

**i18n**: `settings.regionalIdentity.*` y `localizationPage.undefined` en los 4 idiomas.

**Verificación**
```
npx tsc --noEmit  → exit 0 en api y dashboard
jest apps/api       → 2791 passed / 297 suites (1 skipped), 0 fallos
jest apps/dashboard →  212 passed /  26 suites, 0 fallos
```

### U42 — Colombia escrita en el código, en veinte lugares que decidían

**Pendiente interno 12**

Los literales `'America/Bogota'` y `"COP"` no eran defaults de presentación: **decidían**.

**La zona horaria estaba copiada en tres servicios de citas con órdenes DISTINTOS.** Notificaciones probaba `settings.timezone` antes que las horas de atención; recordatorios lo hacía al revés. Un tenant con las dos cosas cargadas recibía el recordatorio **calculado** en una zona y el mensaje de confirmación **escrito** en otra — y nadie lo veía, porque cada servicio era coherente consigo mismo. Ninguno de los tres miraba la zona **declarada**, y los tres terminaban en Bogotá. Ahora hay una sola precedencia, con la declarada arriba de todo. `businessHours.timezone` entró a esa precedencia (como `inferred`: el dueño configuró cuándo atiende, no dónde opera) porque sin él centralizar le habría **cambiado** la zona a todo tenant que la tenía cargada sólo ahí — un arreglo que rompe lo que venía funcionando.

Lo mismo en el calendario (los eventos de Google se creaban en horario colombiano para un negocio mexicano que ya había declarado su país, y el cliente veía la cita corrida en su propio calendario), en el horario comercial de la automatización (a las 8 en Bogotá son las 7 en Ciudad de México: la secuencia de nurturing salía una hora antes de abrir) y en el endpoint de zona horaria del panel. En el **alta**, la zona ahora sale del país que el dueño acaba de elegir — sembrar Bogotá ahí era declarar por él en el único momento en que sí sabemos dónde opera.

**`PLATFORM_FALLBACK_COUNTRY` pasó a ser una constante exportada** en lugar de `'CO'` escrito veinte veces. Un literal repetido no se puede auditar: nadie puede contestar *"¿dónde estamos asumiendo Colombia?"* leyendo el código. Y todo lo que sale de ahí viaja marcado `fallback`, que es lo que permite que el panel diga "puesto por defecto" en vez de hacerlo pasar por una decisión del dueño.

**Y la moneda era peor**, porque queda guardada. Quince pantallas ponían `currency: item?.currency || "COP"` como valor inicial: un negocio mexicano cargando su primer plato, plan, curso, póliza, propiedad o vehículo guardaba el precio **en pesos colombianos** sin verlo, y el agente después se lo dice al cliente en COP. Dos pantallas eran peores todavía —Pedidos y Estadías **ignoraban la moneda que el registro sí traía** y lo pintaban todo en COP—, que es convertir un importe sin tipo de cambio: exactamente lo que la regla 22 del contrato del agente prohíbe, hecho por la pantalla con la que el dueño le cobra al cliente.

`useOperatingCurrency()` resuelve la moneda del negocio y devuelve **`null` mientras carga**: pintar COP "un ratito" es cómo se guardaba antes, porque el dueño puede apretar Guardar en ese ratito. Y `formatMoney` **no pone símbolo cuando no hay moneda** — un número desnudo es incómodo, uno con el símbolo equivocado es una cifra falsa que alguien puede cobrar.

**Lo que se dejó con COP, a propósito y por ruta explícita:** facturación electrónica DIAN (Colombia por definición), el catálogo de paquetes de SMS y el tipo de cambio de la plataforma (se cobran por el riel local, Wompi/COP). La lista es explícita y no una heurística: una lista se puede discutir, un `includes("fiscal")` se olvida.

**Pruebas** — `no-hardcoded-currency.spec.ts` (nuevo, 7): barre el fuente del dashboard buscando la forma que decide (`currency: "COP"`, `|| "COP"`), porque el literal es fácil de volver a escribir y **nadie lo nota — la pantalla se ve bien en Colombia, que es donde se prueba**. Más el contrato de `formatMoney`: sin moneda no hay símbolo, una moneda malformada se trata como ausente, y un importe ausente no se dibuja como `$0` (afirmar un precio que nadie puso).

**Verificación**
```
npx tsc --noEmit  → exit 0 en api y dashboard
jest apps/api       → 2791 passed / 297 suites (1 skipped), 0 fallos
jest apps/dashboard →  219 passed /  27 suites, 0 fallos
```

### U43 — La misma tabla escrita dos veces, y ya no decían lo mismo

**Pendiente interno 13**

Veintisiete tablas tenían su DDL escrito **dos veces**: en `prisma/tenant-schema.sql` y otra vez, a mano, dentro del `ensureTables` perezoso del módulo que las usa. Dos copias no se mantienen iguales solas, y éstas **ya habían divergido en las dos direcciones**:

- **`orders`** en código no tenía la columna `items` —que el canónico declara `JSONB NOT NULL`— y ponía `currency` como `VARCHAR(3)` contra `VARCHAR(10)`. Un tenant creado por ese camino tiene una tabla distinta de la que el resto del código supone.
- **`campaign_recipients`** en código tenía `provider_message_id`, que el canónico **no** tenía. Y el envío de campañas la escribe en **cada mensaje**. Para un tenant provisto por el camino canónico —o sea, **todos los nuevos**— el `CREATE TABLE IF NOT EXISTS` perezoso era un no-op, esa columna nunca se creaba y el primer envío de campaña fallaba con *"column does not exist"*. La columna se agregó al canónico (aditiva, expand-contract).
- **`product_categories`** la creaba sin `sort_order` y con `name` más corto.

Ése es el modo de falla que hace cara la duplicación: **aparece meses después, en un tenant, y no se reproduce en ninguno de los otros**.

**La solución no fue borrar la creación perezosa** —existe para reparar schemas viejos y ese trabajo es real—, sino quitarle la *definición*. `PrismaService.ensureCanonicalTables(schema, tablas)` carga `tenant-schema.sql` y ejecuta **el subconjunto de sus sentencias** que tocan esas tablas. La fuente sigue siendo una sola; la reparación perezosa sigue existiendo.

Dos detalles del filtro: compara contra `."tabla"` y no contra `tabla`, porque `ecommerce_products` contiene `products` como substring y una coincidencia por substring arrastraría tablas ajenas en un orden que no respeta sus claves; y si no encuentra DDL para una tabla pedida **tira**, porque el silencio sería peor que el defecto — el módulo creería que reparó y seguiría escribiendo contra una tabla inexistente.

Migradas: `products`, `product_categories`, `stock_movements`, `orders`, `order_items`, `campaign_recipients` — las que divergían. Las otras 21 copias siguen siendo byte-equivalentes hoy, y la prueba de abajo las vigila.

**Pruebas** — `tenant-schema-single-source.spec.ts` (nuevo, 4): parsea el canónico (incluidos los `ADD COLUMN` posteriores, que son igual de canónicos) y cada copia perezosa, y falla si a una le falta una columna **o si inventa una que el canónico no tiene** — que es la dirección que rompe a los tenants nuevos y la que nadie mira. Más un guard de regresión sobre las seis ya unificadas, y una aserción de que el parseo encontró tablas: si falla, todo lo demás pasaría sin verificar nada.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2795 passed / 298 suites (1 skipped), 0 fallos
```

### U44 — Qué conversaciones sabe sostener un perfil: nadie lo sabía

**Pendientes internos 14 y 15**

Cada pieza de la verdad de un subtipo vivía en su registro: el manifiesto sabe sus capacidades y rutas, la terminología sus sustantivos, el perfil comercial hasta dónde se vende, el eval pack qué medirle. **Ninguno sabía qué conversaciones tiene que sostener** — qué intenciones reconoce, qué datos necesita para cada una, cuáles de esos datos son sensibles, cuáles se guardan y cuáles se olvidan al terminar el turno, qué confirma antes de comprometerse, y qué hace cuando no puede. Eso se resolvía en el prompt: texto libre, distinto en cada perfil, imposible de verificar.

Los cinco contratos (`SlotSchema`, `IntentContract`, `NavigationPolicy`, `VerticalPromptContractV2`, `CertificationEvidenceV2`) y los 76 borradores salieron en la misma unidad porque separarlos habría dado un tipo sin un solo dato dentro.

**Los 76 se DERIVAN, no se escriben.** Un contrato escrito a mano para 76 perfiles son 76 oportunidades de prometer por escrito algo que el runtime no hace. Todo lo que se puede deducir de un registro existente se deduce; **lo que no, queda marcado como hueco explícito (`unresolved`) en vez de rellenarse con algo plausible** — un hueco visible se cierra, uno relleno se olvida.

La regla que sostiene lo demás: **una intención sólo existe si su familia de tools existe**. La familia es la evidencia de que el runtime puede sostener esa conversación; declarar una sin ella sería exactamente el defecto que este contrato viene a cerrar. Y el `scope` comercial es lo único que autoriza una afirmación: un perfil de captación no puede prometer que reserva **aunque tenga las tools para hacerlo**.

**`SlotSchema` obliga a decir cuatro cosas de cada dato** que el prompt nunca decía: qué tan delicado es (`public`/`personal`/`sensitive`/`regulated`), de dónde sale (`customer`/`tool`/`derived`/`tenant_config`), cuánto vive (`turn`/`conversation`/`record`/`never`) y si hay que repetírselo al cliente antes de usarlo.

**Ninguno nace certificado, y no puede.** `CertificationEvidenceV2` incluye un requisito —corrida end-to-end contra un tenant real— que **una derivación no puede satisfacer**: sale `satisfied: false` siempre, por diseño. Los 7 perfiles bloqueados salen `blocked`, no `draft`. Marcar certificado sin evidencia E2E es de lo que el encargo prohíbe explícitamente, y acá es imposible por construcción, no por disciplina.

**Un hallazgo del propio trabajo:** son 76 ids y **75 contratos**. `veterinaria/peluqueria_canina` es un alias de `pet_services/peluqueria`, y que el alias tuviera contrato propio sería la misclasificación que el alias existe para reparar — una peluquería canina con persona clínica y "recorrido del paciente". La prueba lo fija con ese nombre.

**Pruebas** — `vertical-domain-contract.spec.ts` (nuevo, 96): los 76 perfiles uno por uno contra su manifiesto; toda intención que compromete pide confirmación explícita y **puede terminar en una persona** (sin estado terminal humano, un fallo deja al cliente esperando); todo deep link apunta a una ruta que el perfil tiene; cada slot declara sensibilidad, origen y persistencia; y `domainContractGaps` devuelve **motivos, no un booleano** — "no está listo" sin el motivo es lo que hace que nadie lo cierre nunca.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared y api
jest apps/api → 2891 passed / 299 suites (1 skipped), 0 fallos
```

### U45 — Cinco escenarios no miden un agente: miden que arranca

**Pendiente interno 16**

El set dorado eran cuatro universales —saludo, precio, agendar, fuera de tema— más, con suerte, tres derivados de la avoid-list y las exclusiones. **Lo que de verdad sale mal no estaba cubierto en ningún perfil**: pedir un dato que ya tiene, tratar una duda como una confirmación, dar por hecha una reserva que la tool rechazó, prometer una capacidad que el perfil no tiene.

Ahora el mínimo es **29 escenarios por perfil en los cuatro idiomas** (piso declarado: 25), y ninguno se escribió a mano. Escribir 25 × 76 × 4 son **7.600 oportunidades de medir una expectativa que nadie escribió**; cada escenario sale de un hecho ya declarado —una intención del contrato de dominio (U44), un término prohibido, una exclusión, una capacidad ausente— y el texto se arma con plantillas por idioma. La variación entre perfiles viene de los datos del perfil, no de la redacción.

**Cinco sondas por intención**, que son cinco fallas distintas y no variantes de redacción: camino feliz, falta un dato (no lo inventa), sin confirmación (**dudar no es confirmar**), la herramienta falló (**nunca afirma que quedó hecho sin un resultado que lo confirme**) y lo pide dos veces (usa lo que ya sabe). Las dos del medio corren **sólo sobre intenciones que comprometen**: un escenario de "la reserva falló" sobre una búsqueda de FAQs mide una falla que no existe.

**Catorce sondas de perfil** que aplican a todos: suplantación —"¿sos una persona?"—, conversión de moneda (la misma regla que el contrato del agente: convertir sin tipo de cambio es inventar), presión y urgencia, datos de un tercero, contradicción del cliente, cambio de idioma, precio sin dato cargado, pedido de humano, opt-out (**no es una objeción que se rebate**), documento enviado sin que se lo pidan, reclamo enojado, fuera de horario, no re-presentarse en el segundo turno, y mensaje vacío.

**Uno por término prohibido y uno por exclusión**, no uno por perfil: la lista entera en un solo escenario mide la primera y deja las otras sin probar.

**Dos correcciones sobre el propio trabajo:**
- Las capacidades ausentes se deducían de los **nombres de tool**, y eso decía que una comida rápida no puede dar una lista de productos con precios —no tiene el grupo `catalog`— cuando `get_menu` hace exactamente eso. Se derivan del **manifiesto**, que ya las declara: una segunda deducción a partir de nombres sólo se equivoca distinto.
- La pregunta de una capacidad ausente tiene que ser una que **sólo esa capacidad conteste**. "Lista de productos con precios" la contesta también un menú, así que probaba como ausente algo que el perfil sí resuelve; el stock es lo propio del catálogo.

**Pruebas** — `subtype-eval-coverage.spec.ts` (nuevo, 19): el piso en los cuatro idiomas perfil por perfil, que **los cuatro cubran lo mismo** (un idioma con menos escenarios es un mercado peor medido, y no se nota hasta que un cliente escribe en portugués), que cada escenario viaje en el idioma pedido, que un perfil desconocido reciba **cero** —medir contra una expectativa inexistente es peor que no medir—, y que ningún derivado pise una clave escrita a mano.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared y api
jest apps/api → 2910 passed / 300 suites (1 skipped), 0 fallos
```

### U46 — Las casillas que el dueño apagaba y no apagaban nada

**Pendiente interno 17**

`canBook`, `canCancel`, `canCheckStock` y `canRecommend` existen en el tipo, la pantalla del agente los muestra como casillas y el bootstrap los siembra por vertical. **Ningún lugar los leía.** Un dueño que destildaba "puede cancelar" veía la casilla apagada y el agente cancelaba igual.

Un control que existe en la interfaz y no en el sistema es **peor que no tenerlo**: el control que no está no se confía, y éste sí — se apaga y se cierra la pantalla creyendo que quedó apagado.

**`reschedule_appointment` cae bajo `canCancel`, a propósito.** Reprogramar libera el turno original. Que no estuviera cubierta por ninguna de las dos casillas era la fuga más silenciosa: el dueño apagaba cancelar y el agente reprogramaba, que para su agenda es exactamente lo mismo.

**El subpermiso recorta, no apaga la familia.** Apagar "puede agendar" saca `create_appointment` y `send_booking_link` y deja `list_services` y `check_availability`: el agente sigue pudiendo hablar de la agenda, que es lo que el dueño quiso.

**Ausente = permitido, deliberadamente.** Un agente guardado antes de que la clave existiera no puede quedarse sin reservar por un cambio de contrato. Sólo un `false` explícito recorta.

**Y no alcanza con no publicarlas.** Publicar cubre el loop del LLM; el motor determinista de reservas, Procedures y la confirmación server-side llaman **por nombre**. Así que la verificación baja también al ejecutor —la misma puerta común de U35—, y el motor de reservas no corre cuando `canBook` está en `false`: sin eso, la casilla apagaba la tool del modelo y dejaba viva la del motor, que es justamente la que reserva.

El mensaje de rechazo **no promete reintentar**: no es un fallo ni una falta de capacidad temporal, es una decisión del dueño.

**Pruebas** — `tool-subpermissions.spec.ts` (nuevo, 9): cada bandera retira lo suyo y sólo lo suyo, reprogramar cae con cancelar, ausente sigue permitido, una familia apagada no publica nada, y el ejecutor rechaza la tool apagada **aunque la llamen por nombre** sin tocar la base.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2919 passed / 301 suites (1 skipped), 0 fallos
```

### U47 — El CRM tenía dos tools y las dos leían

**Pendiente interno 18 (primera mitad)**

El agente descubría en la conversación que el cliente prefiere los martes, que le interesa el plan anual, que ya lo llamaron dos veces sin respuesta — y **nada de eso llegaba al CRM**. Quedaba en el historial del hilo, que ningún vendedor lee, y el humano que tomaba la conversación después empezaba de cero.

**Por qué sólo tres, y por qué éstas.** Un writer de CRM manejado por un modelo es una superficie peligrosa distinta de una reserva: no falla ruidosamente, **ensucia**. Un lead con la etapa equivocada, una etiqueta inventada o un campo pisado no se nota hasta que alguien construye un reporte encima. Las tres son **aditivas y no destructivas**: agregan una nota, suman una etiqueta, registran un interés.

**`update_lead_stage` no está, a propósito.** Existe un motor de transiciones con reglas que el dueño configuró; dejar que el modelo salte por encima lo volvería decorativo. Una prueba lo fija: no puede aparecer ninguna tool con `stage`/`pipeline` en el nombre.

**Tres decisiones que hacen que no ensucie:**
- **Sin lead no se crea uno.** Crearlo desde una conversación metería en el embudo a cualquiera que preguntó un horario.
- **La etiqueta tiene que existir.** Si no existe, falla y lo dice. Inventarla es cómo el equipo arma un segmento y le faltan la mitad de los contactos, porque el agente escribió "VIP" donde ellos usan "vip".
- **El interés no pisa lo que una persona clasificó.** Escribe `primary_intent` sólo si está vacío; si ya hay uno, va al secundario. Pisar es la forma silenciosa de que el equipo deje de confiar en el campo.

**Y no comprometen al negocio**, así que sobreviven cuando la escritura está bloqueada (U35): un perfil bloqueado se dedica justamente a capturar y derivar, y quitarle la anotación lo dejaría capturando en el aire. Tampoco piden confirmación al cliente — pedirle que confirme una nota interna es ruido que además le revela que se está tomando nota de él.

La nota queda **atribuida** (`created_by = 'agent'`): el equipo tiene que poder distinguir lo que anotó el agente de lo que escribió una persona.

**Pruebas** — `crm-writers.spec.ts` (nuevo, 11) y el conteo del registro canónico de tools de 104 a 107, que es la puerta que exige política revisada, rama del ejecutor y definición para cada tool.

**Verificación**
```
npx tsc --noEmit (api)  → exit 0
jest apps/api → 2930 passed / 302 suites (1 skipped), 0 fallos
```

### U48 — El agente escribía filas que el turno siguiente no podía ver

**Pendiente interno 18 (segunda mitad)**

Cinco cargadores para veintidós tipos declarados. Un socio preguntaba *"¿cuántas clases me quedan?"* y el agente, que acababa de reservarle una, **no tenía dónde mirar**: el dato estaba en la fila que él mismo había escrito.

Peor: `create_vehicle_rental` y `create_pet_boarding` escribían un alquiler que **no tenía ningún tipo declarado**. El cliente preguntaba "¿hasta cuándo lo tengo?" y la fila recién creada era literalmente invisible para el agente.

**Cinco cargadores nuevos** —membresías (con los créditos que quedan), clases reservadas, inscripciones, sesiones de foto y alquileres de recurso— y **dos tipos nuevos**: `vehicle_rental` y `pet_boarding`. Una fila y dos tipos, porque el objeto que el cliente tiene en la cabeza es el auto o la mascota, no "el alquiler".

**Y dos sujetos que faltaban.** `tour_booking` y `enrollment` viajaban sin decir de qué paquete o de qué curso eran — el mismo defecto que ya se había arreglado en alojamiento: sin el sujeto, el único identificador que el modelo tiene a mano es el de la reserva, y lo pasa como `packageId`; la escritura falla **después** del "sí" del cliente.

**Lo que NO se carga tampoco es un olvido.** Tratamientos, seguros, casos profesionales y solicitudes de servicio son `tool_only`: se leen sólo con una tool que exige verificación de identidad, y meterlos en el turno sería saltarse esa puerta. `catalog_item` queda fuera por otro motivo, también declarado: un producto no está "activo" para un cliente, aparece cuando una tool lo devuelve — cargarlo sería meterle el catálogo entero al agente en cada mensaje.

**Quince estados que caían en `unknown`.** `frozen`, `waitlist`, `attended`, `enrolled`, `dropped`, `picked_up`, `returned`, `checked_out`… los escribe la propia plataforma y el clasificador no los conocía: el agente tenía la fila delante y no sabía si la membresía estaba congelada o la clase en lista de espera. Uno que nadie declara **sigue** siendo `unknown`, porque adivinar una clase para una palabra que el sistema no escribe sería inventar significado.

**Y `<recent_actions>` sobrevivía un solo turno.** `persistToolContext` hacía `jsonb_set` del arreglo entero, así que **pisaba** en vez de acumular: el agente buscaba una propiedad en el turno 1, el cliente preguntaba otra cosa en el 2, y en el 3 volvía a buscar la misma — porque ya no recordaba haberlo hecho. Peor: un identificador que una tool devolvió en el turno 1 desaparecía, y el modelo se inventaba uno para reemplazarlo. Ahora se concatena y se recorta **en la misma sentencia**, para que dos turnos concurrentes no se pisen leyendo y escribiendo por separado, y el `ORDER BY` de la agregación restaura el orden cronológico — el lector hace `slice(-N)`, así que dejarlo al revés le habría dado las acciones más **viejas**.

**Pruebas** — `active-objects-coverage.spec.ts` (nuevo, 46): todo tipo permitido en el turno tiene quien lo produzca, los `tool_only` **no** se cargan, los cargadores se encienden con la capacidad del negocio (un negocio sin esas familias no paga la consulta: cada cargador es una consulta por turno), los deep links de los dos tipos nuevos apuntan a una pantalla que existe, y los quince estados se clasifican.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared y api
jest apps/api       → 2976 passed / 303 suites (1 skipped), 0 fallos
jest apps/dashboard →  219 passed /  27 suites, 0 fallos
```

### U49 — El cuaderno de la guardería y el de la agencia de autos

**Pendiente interno 19 (alquiler y guardería)**

El conductor de un auto, el depósito en garantía, el contrato firmado, la jaula donde duerme el perro y con qué otros perros puede compartir patio vivían —cuando vivían— sueltos en `metadata`, un JSONB libre. **Libre significa que cada llamador lo escribía distinto**: el panel guardaba `driverName`, un import ponía `driver_name` y el agente no escribía ninguno. Nadie podía construir una pantalla encima porque no había dos filas con la misma forma.

Nada de esto necesita un proveedor externo: es información que el negocio ya tiene **en un cuaderno**.

**Cuatro reglas que el contrato hace cumplir, y por qué:**
- **Un monto sin moneda no se guarda.** Un número sin moneda es una cifra que alguien va a cobrar en la que le parezca.
- **Retener el depósito exige decir por qué.** Retener plata sin motivo escrito es el reclamo del mes que viene sin nada con qué contestarlo.
- **Un contrato "firmado" necesita evidencia** —fecha o documento—, o no está firmado.
- **"Sólo con su grupo" exige decir cuál.** Sin el grupo, el campo no le sirve a quien arma los patios por la mañana, que es exactamente la información que existe para dar.

**Lo que deliberadamente NO está:** cobrar el depósito (eso es el riel de pagos, con sus propias puertas), firmar el contrato con validez legal (necesita un proveedor certificado) y **la medicación de la mascota** — es dato clínico, vive en el registro de la mascota con su nivel de acceso, no en el metadata de una estadía que el panel lista sin verificar identidad. Una prueba lo fija: si alguien manda `medication`, no se guarda.

**La vista de ocupación es una sola para los dos rubros**, porque es el mismo dato: una flota y una guardería tienen recursos que se ocupan por rangos de días. La pantalla era una lista ordenada por fecha — para saber si el auto 3 está libre el jueves había que leerla entera y cruzar fechas a mano, y quien arma los patios necesita exactamente lo contrario de una lista: **una fila por recurso**. Hacer dos pantallas habría duplicado el mismo cálculo con dos bugs.

**Dos detalles de la tira que son bugs si se hacen mal:** la salida es el día en que se libera —un alquiler que termina el jueves deja el auto disponible **ese** jueves, y pintarlo ocupado perdería un día de flota por reserva—; y las fechas se parsean como UTC explícito, porque `new Date('2026-09-10').getDate()` las corre un día en cualquier huso al oeste, que es medio continente.

**Los detalles se editan por su propio endpoint**, separado del estado: registrar el kilometraje de entrada no es cerrar el alquiler, y cerrarlo tiene reglas de quién puede hacerlo que no aplican a anotar con quién sale al patio el perro. La actualización es una **fusión superficial**: quien registra el kilometraje no debería tener que reenviar el conductor y el depósito para no borrarlos.

**Pruebas** — `resource-rental-details.spec.ts` (nuevo, 21) sobre las cuatro reglas, la ausencia deliberada del campo clínico, el acotado de pertenencias y que el tipo elige el contrato (`compatibility` no significa nada para un auto y se descarta en vez de guardarse como si fuera un campo del vehículo).

**i18n**: `resourceRentals.occupancy.*`, `resourceRentals.details.*` y `action.details` en los 4 idiomas.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api       → 2992 passed / 304 suites (1 skipped), 0 fallos
jest apps/dashboard →  219 passed /  27 suites, 0 fallos
```

### U50 — El objeto primario del rubro no tenía pantalla

**Pendiente interno 19 (`professional_case`)**

El manifiesto declara `primaryObject: 'professional_case'` para `servicios_profesionales` y le daba **una sola ruta: `/admin/appointments`**. El objeto central del rubro no tenía superficie, así que el equipo abría el **embudo de ventas** y leía "Oportunidades", "Valor del negocio" y "Probabilidad de cierre" sobre el expediente de un cliente. Y el enlace de un caso mencionado en el Inbox iba a `null` —sin destino— porque no había a dónde.

Es la contradicción exacta que la regla de navegación ya nombra: dos objetos no comparten etiqueta, y acá el objeto operativo del rubro estaba usando la etiqueta comercial de otro.

**No se creó una tabla.** Un caso **es** una oportunidad del embudo: eso ya estaba decidido y `get_case_status` lo usa así desde hace releases. Crear `professional_cases` habría partido el dato en dos y dejado al agente y al panel mirando registros distintos. Lo que faltaba era **leerlo con las palabras del rubro**: referencia, etapa, cuándo se abrió, cuándo se movió, de quién es.

**La referencia corta es la MISMA que el agente le dice al cliente por chat** (los primeros 8 caracteres del id, en mayúsculas). Que el equipo viera otra habría hecho imposible cruzarlas cuando el cliente llama por teléfono y la repite.

**Sólo lectura, a propósito.** Abrir y mover un caso pasa por el motor de transiciones del embudo, con las reglas que el estudio configuró. Una escritura paralela desde esta pantalla las volvería decorativas — el mismo motivo por el que U47 no le dio al agente una tool para mover etapas.

**Cinco registros que había que tocar** para que la pantalla exista de verdad, y los cuatro contratos que lo verificaron: el registro canónico de navegación, la clasificación de superficie (`register`, no `catalogue`: clasificarla como catálogo la habría puesto detrás del permiso de configuración que un agente humano no tiene), el resolutor de items por capacidad, la ruta del manifiesto y `roles.ts` —deny-by-default: sin regla explícita, la pantalla existe y nadie puede abrirla—.

Las cuatro pruebas de contrato del dashboard **fallaron en el primer intento** y cada una señaló un registro que faltaba. Es exactamente para eso que existen.

**i18n**: `cases.*` y `nav.items.cases` en los 4 idiomas.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api       → 2992 passed / 304 suites (1 skipped), 0 fallos
jest apps/dashboard →  220 passed /  27 suites, 0 fallos
```

### U51 — Cuatro problemas × N proveedores = N formas distintas de fallar

**Pendiente interno 20**

Cada integración que se agregó resolvió los mismos cuatro problemas **de nuevo y distinto**: cómo no perder una escritura con el proveedor caído, cómo no procesar dos veces el mismo webhook, cómo saber si los dos lados siguen diciendo lo mismo, y cómo probar el adapter sin credenciales.

**Nada de este andamiaje sabe qué es Hostaway, Toast o Cliniko.** El contrato es sobre la mecánica —una escritura pendiente, un evento recibido, una comparación— y el adapter aporta el significado. Un contrato que nombra al proveedor termina con un `if (provider === 'x')` por cada rareza, y ésa es la forma en que un andamiaje compartido deja de serlo.

**Los escritores externos están APAGADOS**, y es lo primero que hay que entender del diseño:
- La allowlist es **por proveedor**, no un booleano global: certificar Hostaway no certifica Toast, y un `INTEGRATIONS_WRITE=true` habría encendido los dos.
- Es una variable de **plataforma**, no de tenant: encenderlo porque alguien conectó credenciales es cómo se manda la primera escritura a producción sin que nadie la haya probado.
- Con el interruptor apagado el outbox **igual encola** (`suppressed`) y la intención queda registrada. Descartarla sería perder la operación en silencio; el día que el proveedor se certifique, sale.

**Las decisiones que hacen que esto funcione, y el modo de falla de cada una:**
- **La clave de idempotencia se deriva del hecho de negocio**, no de un contador. Reintentar es repetir la MISMA escritura; un UUID por intento crea **una reserva nueva en cada reintento** — exactamente el modo de falla que un outbox existe para evitar. Una clave incompleta **tira** en vez de colisionar, porque una clave con un hueco deduplica dos escrituras que no son la misma.
- **El arrendamiento vence.** Sin `lease_expires_at`, un worker que muere deja una escritura en `in_flight` para siempre y un reinicio en el momento equivocado congela una reserva hasta que alguien la mira a mano.
- **La espera tiene techo.** Importa más que la curva: sin él, el octavo intento cae a horas y una caída de diez minutos del proveedor deja escrituras esperando media tarde.
- **Morir es una decisión.** Una escritura que reintenta para siempre es una que nadie mira nunca.
- **El dedupe de webhooks va por `(proveedor, evento)`**, no sólo por el id: dos proveedores pueden usar el mismo contador y no hay nada que lo impida. Un proveedor reenvía cuando no recibe un 200 a tiempo, y una reserva procesada dos veces es una reserva doble.
- **La reconciliación reporta y no corrige.** Corregir automáticamente es cómo una lectura desactualizada del proveedor borra una reserva local que sí existe. Y "sin drift" e "incompleta" son campos distintos: confundirlos declara sanas dos integraciones que nunca se compararon.

**El kit de contract-test verifica lo que se puede verificar SIN credenciales** —que `list` devuelva algo iterable con ids, que las claves sean deterministas, que `write` no se declare si no está implementado— y dice explícitamente qué queda fuera. Un adapter de sólo lectura es válido, que es el estado de todos hoy; declarar `write` y tirar sería peor, porque el outbox lo trataría como entregable y lo reintentaría ocho veces.

**Un defecto del propio kit, encontrado al probarlo:** verificar un adapter sin proveedor hacía **explotar el kit** en vez de reportarlo. El adapter que más falta revisar habría sido justo el que no se podía revisar.

**Pruebas** — `integration-scaffolding.spec.ts` (nuevo, 24). Las tres tablas nuevas viven en el schema del tenant, así que el purge —que dropea el schema entero— no necesita clasificarlas; la puerta de clasificación es sólo para tablas públicas, y sus 28 pruebas siguen verdes.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared y api
jest apps/api → 3016 passed / 305 suites (1 skipped), 0 fallos
jest app.bootstrap → 1 passed — DI limpio con el módulo global nuevo
```

### U52 — El manifiesto declaraba métricas que el agregador no devolvía

**Pendiente interno 19 (analítica)**

El manifiesto declara, por industria, **las claves exactas que devuelve el agregador** —lo dice su propio comentario— y nadie lo comparaba nunca contra el código.

`servicios_hogar` declaraba `completed` y `completionRatePct`. El agregador devolvía `pending` y `avgCompletionRatePct`, y **no devolvía `completed` en absoluto**. La estadística por tenant sí la calculaba, y el agregado la perdía al sumar: el negocio veía cuántas solicitudes quedaban pendientes y **nunca cuántas había cerrado** — que es la cuenta que le dice si el mes fue bueno.

**Las dos mitades se arreglaron cada una en su lado:**
- El agregador ahora suma `completed`. El dato ya existía; sólo se perdía en el camino.
- El contrato pasa a declarar `avgCompletionRatePct`, que es como se llama lo que devuelve. A nivel plataforma la tasa es un promedio **entre tenants**; llamarla `completionRatePct` decía que era la tasa de un negocio, que es otro número.

**La semántica y las plantillas de turismo ya estaban.** Los cuatro subtipos tienen su terminología completa en los cuatro idiomas —un hotel vende habitaciones y recibe huéspedes, un alquiler vacacional vende alojamientos y recibe estadías, y ninguno de los dos dice "propiedad", que es una inmobiliaria—, los registros de estadías y salidas existen desde U14/U20 y la plantilla de confirmación de salida está en los cuatro idiomas. Buscarle trabajo pendiente a eso habría sido inventarlo.

**Pruebas** — `vertical-analytics-contract.spec.ts` (nuevo, 8): industria por industria, cada métrica declarada tiene que existir en el agregador. Más la regla que evita el error opuesto: "implementada" sin métricas es **peor** que "no disponible", porque el panel muestra una tarjeta vacía en vez de decir que todavía no hay dato.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api       → 3039 passed / 306 suites (1 skipped), 0 fallos
jest apps/dashboard →  220 passed /  27 suites, 0 fallos
```

### U53 — Una pantalla que existe y a la que no se llega es lo mismo que no tenerla

**Últimos dos parciales: secciones del shell y telemetría de navegación**

**`/admin/cases` no estaba en el menú.** Se creó completa en U50 —endpoint, página, permisos, i18n, cuatro registros de contrato— y el menú no la listaba. Las tres pruebas de contrato que existían pasaron, porque **las tres miran registros y ninguna mira el menú**. Ahora hay una que lo mira, y recorre los 40 ítems verticales en las dos direcciones: ninguno falta en el menú, y el menú no lista uno que el resolutor no conozca —eso lo dejaría visible para rubros que no tienen esa capacidad—.

**`essentials` mezclaba tres trabajos.** Los contactos colgaban de un ítem llamado "CRM" con el embudo de ventas adentro, así que buscar el teléfono de un cliente obligaba a entrar por una sección que habla de negociaciones. Son dos trabajos y los hace gente distinta: quien atiende busca a la persona, quien vende mira el embudo. Quedan tres secciones —`essentials` (lo que se abre primero), `customers` (las personas), `commercial` (el embudo y las ofertas)— y las ofertas se mudaron del catálogo: una oferta es una palanca comercial, no una ficha de producto.

**La telemetría contaba tropiezos y no esfuerzo.** Un 403, un callejón sin salida, una opción bloqueada por plan: eso dice si algo está **roto**, no si encontrar las cosas **cuesta**. Un menú donde todo funciona y nada se encuentra produce **cero eventos** y usuarios que se van.

Tres episodios nuevos, y ninguno se emite por vista:
- **Llegó a una pantalla operativa**, con cuánto tardó y cuántos clics le llevó. Una pantalla de catálogo **no** cierra el episodio: pasar por el catálogo suele ser parte del camino, no el destino, y cerrarlo ahí mediría el paseo en vez de la tarea.
- **Volvió sobre sus pasos** dentro de diez segundos. Es la señal más honesta de que el menú lo mandó al lugar equivocado: no hay error, no hay 403, y el camino no era. Más de diez segundos y volver es una decisión, no un error.
- **Usó el buscador** en vez del menú. Un buscador muy usado no es un buscador exitoso: es un menú donde no se encuentra lo que se busca. Se cuenta la elección y no la apertura — abrirlo y cerrarlo no dice nada.

**El tiempo viaja en cubos, no en milisegundos**, y la profundidad tiene tope 9. El número exacto no cambia ninguna decisión y sí permitiría reconstruir minuto a minuto lo que hizo una persona, que es justo lo que esta tabla no debe poder hacer. Un valor imposible cae en `lost`, no en `instant`: `instant` diría que el usuario fue directo, que es lo contrario de lo que sabemos cuando el dato no tiene sentido.

**Y qué cuenta como pantalla operativa sale de la clasificación que ya existe** (`register`/`mixed`), no de una lista aparte: una segunda lista se desincroniza el día que alguien agrega una pantalla, y el síntoma sería una métrica que empeora sin que nada haya empeorado.

**Un defecto propio, encontrado al probarlo:** el saneo aceptaba `clickDepth: "3"` porque `Number("3")` es 3. Aceptar algo convertible es la clase de laxitud que el resto de ese saneo rechaza explícitamente.

**Pruebas** — `sidebar-reachability.spec.ts` (nuevo, 27) y `navigation-effort.spec.ts` (nuevo, 17), incluida la que verifica que lo nuevo **no aflojó lo que ya se protegía**: una ruta con un uuid sigue rechazándose.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api       → 3039 passed / 306 suites (1 skipped), 0 fallos
jest apps/dashboard →  264 passed /  29 suites, 0 fallos
```

### U54 — Llamarle "solución" a un switch

**Último parcial interno: la herencia de terminología**

15 de 76 perfiles declaran su propia terminología; los 61 restantes **heredan la de su industria por decisión**. La decisión es razonable —una clínica dental y una dermatológica dicen "paciente" igual— y nadie verificaba que siguiera siéndolo.

Revisar los 61 uno por uno necesita a alguien que conozca cada rubro, y eso está donde tiene que estar: en el bloqueo externo, como revisión de dominio. Lo que **sí** se puede verificar sin un experto es la contradicción mecánica: **un subtipo cuyo objeto primario difiere del de sus hermanos no puede heredar el mismo sustantivo que ellos.**

Esa regla encontró uno: **`technology/hardware`**. El rubro entero habla como un SaaS B2B —"solución", "deal", "demo"— y tres de sus cuatro subtipos venden justamente eso. `hardware` vende **equipos**: su objeto primario en el manifiesto es `catalog_item`, no una cita. Llamarle "solución" a un switch y "deal" a una venta de mostrador es el idioma de otro negocio, y su avoid-list ahora prohíbe además "licencia" y "suscripción" — un vendedor de equipos no las vende, y ofrecerlas es prometer algo que no hace.

**Dos reglas más que la puerta fija**, porque son las dos formas de romper una terminología sin notarlo:
- Un sustantivo **a medias** es peor que ninguno: el agente cae al español en una conversación en portugués y suena a error de sistema.
- Una avoid-list **no puede prohibir la palabra que el propio perfil usa**, o el agente se queda sin forma de nombrar lo que el negocio vende.

**Pruebas** — `subtype-terminology-inheritance.spec.ts` (nuevo, 4).

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api       → 3043 passed / 307 suites (1 skipped), 0 fallos
jest apps/dashboard →  264 passed /  29 suites, 0 fallos
```

### U55 — La autorización era por negación: lo que nadie prohibió, estaba permitido

**P0-A · puntos 1, 2, 3 y 5 — autoridad de ejecución**

`AIToolExecutorService.execute` es la puerta común. Por ahí pasan siete llamadores: el bucle del LLM, el motor de reservas, Procedures, la confirmación diferida del "sí", el banco de pruebas del agente, el servidor MCP y el reanudador de aprobaciones humanas. Y preguntaba **dos** cosas, las dos **opcionales**:

```ts
async execute(schema, tenantId, contactId, toolName, args, conversationId?, opts?: {…})
```

De ahí salían tres defectos que se sostenían entre sí:

1. **La ausencia de opinión valía como permiso.** `opts` era opcional; cinco de los siete llamadores no lo pasaban. El más visible: `mcp-server.service.ts:99` —un endpoint autenticado por API key, expuesto a terceros— llamaba `execute(schema, tenantId, '', name, args)` y su única defensa era un `if` con una lista local. Y `conversations.service.ts:2244` refrescaba el catálogo con `list_services` sin opts ni `conversationId`.
2. **Se autorizaba por negación.** Las dos preguntas eran "¿el dueño apagó ESTA tool?" y "¿el negocio está bloqueado?". Una tool que nadie hubiera pensado en prohibir estaba permitida **por omisión** — y cada familia nueva nacía autorizada.
3. **Y el resolutor caído era el camino más permisivo.** En Procedures la autorización *caía* a `procedureAuthorizedToolNames(agent.toolsConfig)` cuando el contrato no llegaba. La config del agente es lo que el dueño **prefiere**, no lo que el sistema **concede**: no sabe de plan, de habilitación, de salud del proveedor ni de perfil bloqueado.

**Lo que se hizo.** La pregunta se dio vuelta: ya no es "¿alguien prohibió esto?" sino **"¿qué se publicó para este turno?"**. `ToolExecutionAuthority` + `decideToolAuthority()` viven en `shared` —la misma decisión la tienen que tomar el ejecutor y el motor, y tres copias divergen— y `opts.authority` pasó a ser **obligatoria**: quitarla es un error de compilación, no un turno permisivo. Los siete llamadores declaran su origen (`turn_contract`, `agent_test`, `human_approval`, `mcp_server`, `system`) y su alcance exacto; el de aprobación humana y el del banco de pruebas autorizan **una sola tool**, la del ticket o la que el filtro acaba de aprobar.

**El orden de los cuatro motivos no es cosmético.** Vencida → bloqueada → apagada por el dueño → no publicada. Sin ese orden, una tool que el dueño apagó dentro de un perfil bloqueado se reportaba como "no autorizada", y eso manda a revisar el plan cuando la respuesta era volver a encenderla en la pantalla del agente.

**Punto 2 — el "sí" se ejecutaba con el permiso de ayer.** `findPendingConfirmation` filtraba por `status`, `confirmation_token IS NOT NULL` y `confirmation_expires_at > NOW()`: **sólo tiempo**. El ticket sobrevive turnos, y entre la pregunta y el "sí" el dueño puede apagar la familia, puede vencer una habilitación, puede caerse el proveedor, puede bajar el plan. Ahora el ticket se ejecuta contra el contrato **de este turno** y, si dejó de estar publicado, cae con motivo tipado y escala como `denied:<tool>:<motivo>` en vez de escribir una fila que hoy nadie autoriza.

**Punto 5 — el handoff se disparaba por el perfil, no por la operación.** Estaba en `conversations.service.ts`, en el momento de **resolver** el contrato:

```ts
if (!writesAuthorised) pendingOperationHandoff = `capability:${capability.status.status}`;
```

Es decir: en un perfil bloqueado, alguien que sólo saluda o pregunta el horario **abría un caso en la cola de agentes humanos**. Y el perfil bloqueado es justamente el que más conversaciones informativas tiene —porque no cierra operaciones—, así que la cola se llenaba de conversaciones que nadie necesitaba atender y las que sí lo necesitaban quedaban enterradas. Ahora escala `isToolAuthorityDenial(result.error)`: un pedido concreto que el sistema no pudo cumplir.

**Un detalle que casi se pierde: el recorte a 10 tools no autoriza.** La lista autorizada se congela **después** del filtro del contrato y **antes** del recorte por relevancia. Derivarla del recorte convertiría "esta tool no era relevante para este mensaje" en "esta tool no está autorizada" — y mandaría a una persona una conversación que no lo necesita.

**Una prueba que pasaba por la razón equivocada.** `capability-stop-profiles.spec.ts` llamaba `toolStepAuthorized({authorisedTools: […]}, 'file_claim')` con los **argumentos invertidos**: el objeto llegaba como nombre de tool y la cadena como agente, así que la función salía por `agent.toolsConfig === undefined` sin mirar nunca la lista publicada. Habría dado `false` con cualquier entrada. Corregida, y con el contrapunto que le faltaba: lo que sí se publicó, pasa.

**ADR — por qué la autoridad no cae a nada.** Un llamador sin autoridad podría "heredar" el contrato del turno buscándolo en Redis. Se descartó: eso reintroduce exactamente el defecto: el camino que no declaró nada vuelve a ser el que más puede. Sin autoridad no se ejecuta, y el compilador lo impide antes de que llegue a producción.

**Riesgos que quedan**
- **El reanudador de aprobaciones no re-resuelve el contrato.** Su autoridad es la decisión de la persona, acotada a la tool del ticket. Si el dueño apaga esa familia entre la aprobación y el resume, la operación corre igual. Cerrarlo requiere resolver el contrato efectivo desde ahí, y el ticket no guarda el agente ni el canal con los que se resolvió. **Es trabajo interno pendiente**, no un bloqueo.
- **`TOOL_AUTHORITY_MAX_AGE_SECONDS = 120`** es un techo elegido, no medido: un turno con RAG lento y varias tools secuenciales podría acercarse. Si aparece `authority_stale` en producción sin que nada esté mal, el número —no la regla— es lo que hay que revisar.

**Pruebas** — `tool-execution-authority.spec.ts` (nuevo, 16: positivas y negativas, la decisión aislada y la misma decisión en la puerta) + `__fixtures__/tool-authority.fixture.ts` (deliberadamente **sin** un `allowAll()`: una autoridad que autorice todo pondría en verde justo los casos que el default-deny tiene que atrapar) + 15 specs existentes que ahora declaran su premisa de autorización en vez de heredarla.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
npm run test:bootstrap → 1 passed (sin errores de DI)
jest apps/api       → 3060 passed / 308 suites (1 skipped, 10 skipped tests), 0 fallos
```

**Lo que esto NO cierra.** El gate de P0-A pide además **pruebas E2E live** (punto 6) y la separación de tools core/verticales/proveedor/MCP (punto 4). Ninguna de las dos está hecha. La fase sigue abierta.

### U56 — La separación existía, implementada como una resta de conjuntos en un solo lugar

**P0-A · punto 4 — separar tools core/globales, verticales, proveedor y MCP**

Las cuatro procedencias ya estaban implícitas en el sistema y ninguna estaba **declarada**. La única parte donde la distinción tenía efecto era una línea del filtro del contrato:

```ts
const staticNames = new Set(staticToolsForAgentConfig(cfgTools ?? {}).map(t => String(t.name)));
tools = tools.filter(t => !staticNames.has(name) || allowed.has(name));
```

Se lee como "el contrato manda". Lo que hace es: *"si esta tool sale de una familia que el dueño encendió, tiene que estar publicada; **todo lo demás pasa**"*. Es una resta de conjuntos recalculada en el sitio de publicación, y de ahí salen tres problemas:

1. **No dice cuál es la excepción ni por qué.** Un lector no puede saber que las exentas son pagos y la llave de identidad — hay que reconstruirlo comparando dos funciones.
2. **Cambia de significado sola.** Si una familia se mueve de estática a asincrónica —o al revés—, la resta cambia y la guarda deja de guardar sin que nada lo indique.
3. **Desconocido pasaba.** Un nombre que no estuviera en el conjunto recalculado atravesaba el filtro. En una puerta cuyo trabajo es decidir permisos, ese es el default equivocado.

**Las cuatro procedencias, y por qué son cuatro.** No se distinguen por lo que la tool *hace* sino por **qué puertas tiene que pasar además**:

| Procedencia | Qué la habilita | Puerta adicional |
|---|---|---|
| `core` | cualquier tenant, cualquier industria | dueño + plan |
| `vertical` | sólo dentro de una industria | manifiesto del subtipo |
| `provider` | el tenant conectó un tercero | salud + alcance del token + frescura |
| `mcp` | un servidor de un tercero | revisión humana **por tool** |

`origin` es un campo del registro de política y **no se puede escribir por entrada**: lo estampa `buildRegistry` desde la taxonomía. Una tool vertical marcada `core` a mano sería exactamente el error que la separación existe para impedir, y nadie lo vería leyendo la línea.

**Dos límites que la prueba fija y que no son obvios.** `create_payment_link` **no** es `provider`: existe cuando el dueño habilita cobros, no cuando conecta un PSP concreto —el PSP se resuelve por país en runtime y la tool sobrevive a cambiarlo—, así que lo que se cae con el proveedor es la ejecución, no la publicación. Y `get_menu` **sí** es `vertical`, no `provider`: `restaurants` es una familia nativa que funciona sin Toast; gatearla por el proveedor habría apagado a todo restaurante que nunca integró nada. La que depende de Toast es `get_restaurant_menu`, y es por tool.

**La excepción quedó nombrada.** `ASYNC_GATED_TOOL_NAMES` son seis y sólo seis: las cuatro de dinero y el par de OTP. La llave de identidad se deriva de las tools A2 que el turno terminó publicando —no de una familia—, y esa derivación corre al final: recortarla contra el contrato dejaría al cliente escribiendo un código en una conversación que no puede leerlo.

**ADR — por qué la taxonomía se declara a mano y no se deriva de las familias.** Derivarla haría que el registro de política importara `agent-tool-registry`, que arrastra las 25 definiciones de tools: un módulo de política que hoy es una tabla pasaría a depender de todo el árbol de tools. Se declara a mano y la coherencia la fija `tool-origin-taxonomy.spec.ts`, que es el único lugar que puede mirar las dos listas a la vez — incluida la comprobación de que las dos listas de familias **cubren el registro entero**, sin la cual una familia nueva sin clasificar quedaría fuera de las dos verificaciones y pasaría en verde sin ser mirada.

**Riesgos que quedan**
- `VERTICAL_FAMILIES` y `CORE_FAMILIES` viven en el spec. Una familia nueva rompe la prueba de cobertura —que es el punto—, pero rompe con un mensaje que hay que leer para entender qué falta clasificar.
- `publishedByOrigin` se calcula y todavía **no se muestra en ninguna pantalla**. La traza ya puede contestar "¿por qué este turno no pudo leer el menú?"; la superficie de Ops que lo exponga es trabajo interno pendiente.

**Pruebas** — `tool-origin-taxonomy.spec.ts` (nuevo, 15).

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api     → 3075 passed / 309 suites (1 skipped, 10 skipped tests), 0 fallos
```

### U57 — Cada pieza en verde y el sistema abierto

**P0-A · punto 6 — pruebas E2E, no sólo unitarias**

El defecto que cerró U55 **no estaba en ninguna puerta**. El contrato resolvía bien y tenía sus pruebas; el ejecutor preguntaba bien y tenía las suyas. Entre los dos había cinco llamadores que no pasaban nada. Ese agujero es invisible para una prueba unitaria por construcción: cada unidad se verifica contra un doble que sí le pasa lo que espera.

Lo que se agrega corre la cadena real —`EffectiveCapabilityService` → autoridad del turno → `AIToolExecutorService`— y los **dos motores que escriben por fuera del bucle de tools**, que son los que nunca alcanzó filtrar la lista publicada. Lo único simulado es el borde: base, Redis y el modelo. No hay credenciales de terceros ni se toca ningún sistema externo: lo que se verifica es **nuestro** encadenamiento, que es donde estaba el agujero.

**Los nueve escenarios**, cada uno una forma distinta de que el permiso no llegue:

- Una barbería agenda y **no** puede abrir un siniestro: el techo del subtipo llega hasta el ejecutor sin que nadie lo repita, y la exclusión queda explicada en el contrato en vez de simplemente ausente.
- Un perfil bloqueado **contesta** una FAQ y **no** cierra una cita, en el mismo turno y con la misma autoridad.
- Un canal no certificado bloquea la escritura con el perfil certificado — el mismo tenant que sí agenda por WhatsApp.
- Un rol desconocido la bloquea también.
- El motor de reservas con perfil bloqueado: el "sí" **no produce una cita**.
- El motor de reservas con el subpermiso apagado: tampoco, con el perfil certificado.
- El "sí" del cliente contra un contrato que **cambió entre la pregunta y la confirmación**: la tool se despublicó, el token sigue vigente, y ya no corre.
- Procedures se detiene **antes** del ejecutor y con el motivo exacto.
- ...y el mensaje al cliente no nombra la tool ni la configuración.

**Dos premisas mías que la corrida desmintió, y quedaron en el spec:**
- Escribí un caso con `role: 'tenant_admin'` esperando que bloqueara. No bloquea, y **está bien**: los cuatro roles del producto son operativos. Lo que la puerta atrapa es un rol que no reconocemos —una integración nueva, un token viejo, un valor mal escrito—. El caso quedó reescrito para medir eso.
- Y afirmé "cero consultas a la base" en los casos del motor de reservas. Falso: el motor lee el catálogo de servicios legítimamente, y `list_services` sobrevive incluso a un perfil bloqueado —que es justamente el punto—. La aserción correcta es que **no se escribió una cita**, y así quedó. Pedir cero llamadas habría pasado en verde midiendo otra cosa.

**El riesgo que sí se cerró, y cómo.** La primera versión del E2E replicaba el armado de la autoridad en un helper del spec, porque la regla vivía dentro de `generateResponse` —mil setecientas líneas, treinta y nueve dependencias— y no había forma de invocarla sin construir el orquestador entero. Replicar es la forma más silenciosa de que la prueba y el código dejen de decir lo mismo: las dos empiezan iguales y una cambia.

Se extrajo a `turn-authority.ts`, tres entradas y ninguna dependencia. Ahora la prueba ejercita **la misma función que corre en producción**, y tres reglas que antes no se podían mirar quedaron fijadas: que un contrato irresoluble produzca una autoridad **vieja** y no una vacía —una lista vacía con fecha de hoy se lee como "alguien decidió no publicar nada", y nadie decidió—; que la lista del bucle del LLM pueda ser más chica que la de los motores compartiendo el mismo sello temporal; y que lo que el dueño apagó viaje **dentro** de la autoridad, con su propio motivo, y no como un parámetro aparte.

**Riesgos que quedan**
- El E2E entra por `EffectiveCapabilityService.resolve`, por `buildTurnAuthority` y por los motores, **no** por `processIncomingMessage`. Lo que queda sin cubrir no es la regla sino el *orden*: en qué momento del turno se congela cada lista. Trabajo interno pendiente.
- No hay corrida contra base real. La cadena de decisión no la toca, pero un `INSERT` que el guard deje pasar y la base rechace por constraint es un caso que estas pruebas no ven.

**Pruebas** — `tool-authority.e2e.spec.ts` (nuevo, 12) + `turn-authority.ts` (nuevo, extracción).

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
npm run test:bootstrap → 1 passed (sin errores de DI)
jest apps/api     → 3087 passed / 310 suites (1 skipped, 10 skipped tests), 0 fallos
```

### U58 — "No pude averiguarlo" se leía como "es local", y local es el estado que escribe

**P0-B · punto 7 — una unidad mapeada nunca puede degradar a escritura local**

El archivo lo decía con todas las letras:

> *"What never fails open is the opposite direction — a property known to be mapped is never downgraded to local by a transient error, **because the mapping row is read in the same query as the config**."*

Las dos afirmaciones eran falsas. Son **dos** lecturas separadas, y las dos devolvían `local` al fallar. Sumado al `catch` del llamador, había **tres caminos** por los que una unidad que administra Hostaway terminaba escribiéndose en el registro local:

1. `getConfig(tenantId)` fallaba → `return localOnly`. Y `getConfig` **descifra**: una clave de cifrado rotada, un `settings` corrupto o un timeout contra `tenants` bastaban.
2. La consulta a `cm_listings` fallaba → `return { ...localOnly, connected: true }`. El comentario ahí decía *"the table may not exist yet for this tenant, which simply means no property is bridged"* — conflando "esa tabla no existe" (una respuesta) con "la consulta falló" (no saber).
3. `properties.service.resolveSor` tenía su propio `catch` → `fallback` con `sor: 'local'`.

`local` no es un estado neutro: es **el que permite escribir**. Cada uno de esos tres caminos era una forma de vender una noche que el PMS ya había vendido — la única falla que le cuesta al anfitrión el huésped y la reseña.

**El arreglo es el orden de lectura, no un `try` más.** El mapeo se lee **primero**, porque es la verdad sobre quién administra la unidad y no depende de poder leer ni descifrar la config. Y aparece un tercer estado: `unknown`.

- `42P01` (la tabla no existe) es una **respuesta**: este tenant nunca puenteó nada → `local`. Es el único error que puede concluir `local`, y se reconoce por el código de PostgreSQL, no por "algo salió mal".
- Cualquier otra falla → `unknown`, y `unknown` no escribe.
- Con la unidad mapeada, el proveedor sale de **la fila**, no de la config: el bloqueo ya no depende de un dato que sólo sirve para redactar el mensaje.

**`localWriterAllowed()` en vez de comparar contra un estado.** La guarda era `if (sor.sor === 'channel_manager') throw` — bloquea **un** estado y deja pasar todo lo demás por omisión. Con un estado nuevo, el que más había que bloquear habría pasado. Ahora se pregunta "¿está permitido?".

**La mitad de lectura del mismo defecto.** `checkAvailability` reportaba `stale: sor.sor === 'channel_manager' ? sor.stale : false`. Con `unknown`, eso decía `stale: false`: una respuesta calculada **sólo** con el registro local, presentada como completa, a la que puede faltarle justo la noche que el PMS ya vendió. Ahora sólo `local` reporta frescura plena.

**`unknown` no se cachea.** Guardarlo convertiría el tropiezo de una consulta en un minuto entero de reservas directas bloqueadas para ese alojamiento. La próxima llamada vuelve a preguntar.

**ADR — por qué `unknown` bloquea y no advierte.** La alternativa era dejar escribir y marcar la reserva como "a confirmar". Se descartó: la fila local ya existe y ya ocupó la noche en nuestro registro; el aviso viaja a un humano que puede tardar horas, y mientras tanto el agente ya la ofrece como vendida. Bloquear cuesta un mensaje; escribir cuesta la noche vendida dos veces.

**Riesgos que quedan**
- `invalidate(tenantId)` **sin** `propertyId` no borra nada: no hay forma barata de enumerar las claves, y la ventana la acota el TTL de 60s. Después de que un sync mapee una unidad nueva, una reserva directa puede colarse durante ese minuto. Es trabajo interno pendiente —un índice de propiedades por tenant, o un sello de versión por tenant en la clave—, no un bloqueo.
- El texto `relation ... cm_listings ... does not exist` se acepta como equivalente a `42P01` porque Prisma no siempre preserva el código. Es deliberadamente estrecho, pero sigue siendo comparar contra un mensaje.
- La escritura de vuelta a Hostaway sigue sin existir: el estado correcto de una unidad mapeada es "lo confirma el equipo". Eso es **bloqueo externo** (credenciales y sandbox), sin cambios.

**Pruebas** — `lodging-source-of-truth.spec.ts` (+7, 23 en total).

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api     → 3094 passed / 310 suites (1 skipped, 10 skipped tests), 0 fallos
```

### U59 — El techo del subtipo no alcanzaba a lo que viene de afuera

**P0-B · punto 8 — matriz proveedor↔subtipo, y evitar lectura externa + escritor local**

Dos defectos que salen del mismo lugar: las lecturas de proveedor se agregaban **después** del manifiesto del subtipo, fuera de su alcance.

**(a) Ninguna matriz de industria.** El bucle publicaba las tools de un proveedor mirando sólo salud, conexión y frescura. Un taller mecánico que conectara Mindbody publicaba `get_fitness_schedule` — sano, fresco, conectado y ajeno. El manifiesto es un techo para las familias nativas y no lo era para las externas, que son justamente las que traen datos de **otro sistema**.

**(b) Lectura externa + escritor local, otra vez.** Es la forma exacta del defecto de alojamiento (U58), en otros dos rubros:

| Proveedor | Se lee de allá | Se escribe acá | Qué produce |
|---|---|---|---|
| Mindbody | `get_fitness_schedule` | `book_class` | dos personas en el mismo cupo |
| Cliniko | `check_clinic_availability` | `create_appointment` | dos pacientes en la sala de espera |
| Toast | `get_restaurant_menu` | `place_order` | — el menú no es un turno |

Toast queda deliberadamente fuera: administra el **menú**, no el calendario. Leer de allá y tomar el pedido acá no vende dos veces nada. Igualar los tres "porque son proveedores" habría apagado a todo restaurante integrado sin ningún riesgo que evitar.

**Un registro en vez de dos mapas.** `PROVIDER_TOOLS` y `PROVIDER_FRESHNESS_BUDGET_SECONDS` eran dos objetos paralelos indexados por el mismo nombre — la forma clásica de que uno crezca y el otro no. Ahora son un `ProviderIntegrationPolicy` por proveedor con las cuatro cosas juntas: industrias, tools, presupuesto de frescura y escritores locales desplazados. Esto también adelanta parte del punto 9: el presupuesto de frescura ya no vive suelto.

**Tres decisiones de borde que las pruebas fijan:**
- **Un proveedor caído no desplaza nada.** Desplazar con el proveedor sin responder dejaría al gimnasio sin ninguna de las dos formas de reservar: la externa que no contesta y la local que le quitamos. El desplazamiento sólo ocurre cuando la lectura externa **efectivamente se publicó**.
- **La consulta local sobrevive.** Con Cliniko vivo caen las tres escrituras de agenda y `check_availability` se queda: preguntar no compromete a nadie.
- **El gimnasio que nunca integró nada sigue reservando.** La familia es nativa; gatearla por el proveedor habría apagado a la mayoría para proteger a la minoría.

**Una prueba que iba a pasar por el motivo equivocado.** `effective-capability.spec.ts` verificaba que un perfil bloqueado conserva la lectura externa usando **una aseguradora con Cliniko conectado** — un sistema clínico en una industria que no es la suya. Con la matriz, esa combinación ya no publica nada, así que el caso habría quedado en verde sin ejercitar nunca lo que mira. Se reescribió con un consultorio bloqueado **por canal**, que es un emparejamiento real.

**Riesgos que quedan**
- La matriz es por **industria**, no por subtipo. Cliniko vale para `salud` entera, incluida `salud/farmacia`, donde una agenda clínica probablemente no signifique lo mismo. Afinarlo a subtipo necesita saber qué vende cada proveedor en cada uno: es revisión de dominio, y va con el resto de esa revisión al bloqueo externo.
- El desplazamiento es **estático por proveedor**, no por unidad. En alojamiento la decisión es por propiedad —una puede estar puenteada y la otra no—; acá, con Cliniko vivo, caen las escrituras de agenda del tenant entero. Es lo conservador y puede ser de más para un consultorio que use Cliniko sólo para una sede. Un mapeo por recurso es trabajo interno pendiente.
- Sigue sin haber escritura de vuelta a ningún proveedor. Es **bloqueo externo** (credenciales), sin cambios.

**Pruebas** — `effective-capability.spec.ts` (+7, 32 en total).

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api     → 3101 passed / 310 suites (1 skipped, 10 skipped tests), 0 fallos
```

### U60 — Tres números que decidían lo mismo y no se hablaban

**P0-B · punto 9 — unificar frescura, cron y estado mostrado en UI**

La pregunta "¿este dato del proveedor sigue sirviendo?" se contestaba en tres lugares, con tres respuestas distintas, y cada una era defendible sola:

| Quién | Qué decía | Efecto |
|---|---|---|
| El cron de re-sync | corre **1 vez por día** (`@Cron('0 5 * * *')`) | el espejo tiene ~24h de edad normal |
| El contrato efectivo | presupuesto de **900s** (Mindbody, Cliniko) | a los 15 minutos deja de publicar la tool |
| La salud y el panel | `stale` a las **36h** | verde durante todo ese tiempo |

Puestos juntos: **las lecturas espejadas quedaban despublicadas 23 horas y 45 minutos de cada día**, y el panel del dueño mostraba verde el día entero. "Sincronizado hace 2 horas, sano" en la pantalla, y el agente contestando que no puede consultar la grilla. Nadie puede reconciliar eso mirando el producto — no es un error visible, es una función que no existe y una pantalla que dice que sí.

**Por qué se desincronizaron.** "Frescura" son **dos cosas** que llevaban un solo nombre:

- **Frescura del espejo**: cuán viejo es lo que copiamos. Sólo tiene sentido comparada contra **cada cuánto corre el sync**. Un presupuesto menor que la cadencia apaga la función siempre, por definición — y nadie lo veía porque los dos números vivían en archivos distintos.
- **Liveza de la conexión**: si la credencial y el circuito funcionan ahora. Es lo único que gobierna a las lecturas que van **en vivo**.

`check_clinic_availability` va en vivo a `available_times` de Cliniko: aplicarle el presupuesto del espejo era medirle la edad a un dato que se acababa de traer. Las otras tres salen de `vi_items`.

**Lo que se hizo.** `packages/shared/src/provider-integration-policy.ts` es ahora el único lugar donde vive el número, con la cadencia declarada al lado y las tools separadas en espejadas vs en vivo. El módulo de salud y el contrato efectivo leen de ahí. `providerFreshnessContradictions()` devuelve los proveedores cuyo presupuesto **no** es coherente con su propia cadencia, y una prueba de contrato exige que esa lista esté vacía y que el margen aguante que un día de sync falle sin apagar nada (dos días seguidos sí apagan: a esa altura el dato no sirve).

**La tercera pata: el panel no podía explicar el estado que más falta hacía.** Desde U59 un proveedor puede estar conectado, validado, con scopes completos y sincronizado hace un segundo — y el contrato no publicar ni una de sus tools, porque el negocio no es de ese rubro. El panel decía **sano**. Se agregó `industryEligible` al contrato de salud y el estado `not_applicable`, que va **antes** de los estados de salud (decir "sano" de algo que el agente nunca usa es la contradicción a eliminar) y **después** de `unavailable` (una integración que nadie configuró no necesita la explicación larga). Panel + i18n en los 4 idiomas.

**ADR — por qué el presupuesto subió a 36h en vez de acelerar el cron.** Sincronizar cada 15 minutos son ~96 llamadas diarias por tenant y por proveedor contra APIs con límite de tasa, para catálogos que cambian de a poco. Se eligió alinear el presupuesto a la cadencia real, que además es el número que la pantalla ya mostraba.

**Riesgos que quedan**
- **Una grilla de clases espejada 24h antes puede afirmar cupo que ya no existe.** `get_fitness_schedule` devuelve `available` desde el espejo. El filtro de clases pasadas y la marca `stale` ya existen y ayudan, pero no cubren "la clase existe y se llenó". Cerrarlo bien es leer disponibilidad en vivo de Mindbody, como hace Cliniko. **Trabajo interno pendiente**, y queda anotado como lo que es: hoy ese dato puede estar viejo.
- La cadencia del cron está declarada como constante y verificada contra sí misma, no contra la expresión `@Cron`. Si alguien cambia la expresión y no la constante, la prueba sigue en verde.
- Toast y el Channel Manager tienen relojes propios (`syncInterval` por tenant, con multiplicador ×3). No entraron a este registro: son otro riel de sincronización. Unificarlos es trabajo interno pendiente.

**Pruebas** — `provider-freshness-coherence.spec.ts` (nuevo, 13) + panel e i18n ×4.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
jest apps/api       → 3114 passed / 311 suites (1 skipped, 10 skipped tests), 0 fallos
jest apps/dashboard →  264 passed /  29 suites, 0 fallos
```

### U61 — Guardar la configuración destruía la credencial, de dos formas distintas

**P0-B · punto 10 — secretos: migración dry-run/apply/cutover, cero plaintext, máscara `***`, cambio de provider, updates atómicos**

Cinco cosas que se sostenían entre sí. Las dos primeras son defectos con consecuencia inmediata:

**(1) La máscara del panel se guardaba como credencial.** El panel enmascara con `***` y devuelve eso al guardar. Las integraciones verticales lo reconocían; el channel manager **no**. Un dueño que abría la pantalla, cambiaba el intervalo de sincronización y guardaba, **cifraba los tres asteriscos y los almacenaba como clave de API**. Sin error, sin aviso: a partir de ahí la integración mandaba `***` al proveedor.

**(2) Cambiar de proveedor tapiaba la integración.** El sobre ata el valor a su proveedor por AAD, así que una clave de Hostaway no se descifra como si fuera de Guesty — eso está bien. Lo que estaba mal es qué pasaba después: el guardado conservaba el sobre viejo (`isEnvelope` → no lo re-cifra), la config quedaba diciendo `guesty` con un secreto de `hostaway`, y **cada** lectura posterior tiraba `tenant_secret_decryption_failed`. Sin forma de saber por qué, y —desde U58— con las reservas del alojamiento bloqueadas de rebote. Un secreto del proveedor anterior no significa nada para el nuevo: ahora se descarta y se piden credenciales de nuevo.

**(3) Updates no atómicos sobre un JSONB que comparten diez módulos.** En `tenant.settings` viven marca blanca, SSO, channel manager, integraciones verticales, su salud, e-commerce, Slack, reseñas, tier gestionado, MCP y SMS. Casi todos escribían `update({ settings: { ...settings, miRama } })`, que manda **una foto vieja del objeto completo**: lo que otro módulo escribió entre la lectura y la escritura desaparece, sin error, sin conflicto y sin traza.

Y no es teórico: el re-cifrado corre **desde una lectura**, en segundo plano (`.catch()`), disparado por una conversación cualquiera. Un dueño guardando su SSO en ese momento lo ve desaparecer; o al revés, su guardado pisa el re-cifrado y la credencial vuelve a quedar en claro. La técnica correcta ya estaba en el repositorio —`updateHealth` usa `jsonb_set` y lo explica— y se usaba en **un** lugar; ahora es una utilidad con cuatro formas (reemplazar rama, fusionar rama, reemplazar hoja, borrar hoja) y los caminos de secretos la usan.

**(4) La máscara se derivaba de una lista escrita a mano.** El channel manager enmascaraba `apiKey` y `apiSecret` por literal; las verticales, la unión de los tres proveedores. Hoy coinciden por casualidad — un proveedor nuevo con otro nombre de campo sale **sin enmascarar por una respuesta HTTP**. Ahora sale del registro de campos secretos de cada módulo.

**(5) La migración, y la puerta que no se podía cerrar.** El re-cifrado oportunista sólo alcanza a quien es leído: un tenant que conectó Hostaway y no volvió a tener una conversación de alojamiento conserva su clave en claro por meses, sin error y con el panel mostrándola enmascarada igual. Y mientras quede **uno solo**, el puente que acepta texto plano tiene que seguir abierto — con lo cual cualquier valor que reaparezca en claro (una restauración de backup vieja, una edición a mano del JSONB) se lee como si nada.

`scripts/migrate-tenant-secrets.js` tiene los tres modos en el orden en que esto se hace sin romper nada: `--dry-run` cuenta y ubica sin escribir; `--apply` cifra con un `jsonb_set` por secreto y **condicionado a que el valor no haya cambiado** (`AND settings #>> path = $4`), porque corre sobre producción con el sistema andando; `--cutover` verifica que no quede nada y dice qué variable poner —sin ponerla, porque activar el rechazo es una decisión de despliegue—. Con `TENANT_SECRET_PLAINTEXT=reject`, un secreto en claro pasa a ser un error ruidoso.

**Un defecto que casi entra con el arreglo.** El script copia el AAD porque no puede importar el servicio (arrastraría medio NestJS y dejaría de correr con `node`). Lo escribí como cadena unida por dos puntos; el servicio usa `JSON.stringify([...])`. Habría producido sobres que el runtime **no puede abrir** — integraciones tapiadas en producción después de una migración que dice "listo". Lo atrapó la prueba de ida y vuelta contra el servicio real, que es la única forma de no dejarlo librado a compararlos a ojo.

**Y una prueba mía que pasaba sin verificar nada.** El primer intento de "las listas del script y del runtime coinciden" sólo comprobaba que los servicios estuvieran definidos. Se exportaron los registros de campos secretos de los dos módulos y ahora se comparan de verdad, campo por campo, incluidos los identificadores de AAD — porque el script podría conocer `clientSecret` y mandar `clientsecret`, y el sobre sería ilegible.

**Riesgos que quedan**
- **Los otros ~8 módulos que escriben `settings` siguen con el patrón que pierde datos** (marca blanca, SSO, Slack, reseñas, e-commerce, MCP, gestionado, SMS). La utilidad existe y esos caminos no se convirtieron: quedan fuera del alcance de "secretos" y son **trabajo interno pendiente**.
- El corte (`TENANT_SECRET_PLAINTEXT=reject`) **no está activado**, y no puede estarlo hasta correr la migración contra producción. Eso es del dueño, no del código.
- La variable nueva necesita entrar a los Secrets de GitHub **y** a `deploy.yml`, o el próximo deploy la pierde al regenerar el `.env`. El propio `--cutover` lo imprime.

**Pruebas** — `tenant-secret-migration.spec.ts` (nuevo, 15), `channel-manager-secrets.spec.ts` (nuevo, 8), `tenant-settings-branch.fixture.ts` (nuevo, doble que aplica la semántica de `jsonb_set`), + specs de integraciones verticales actualizados al camino de escritura real.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
npm run test:bootstrap → 1 passed (sin errores de DI)
jest apps/api     → 3137 passed / 313 suites (1 skipped, 10 skipped tests), 0 fallos
```

### U62 — El andamiaje no tenía quién lo corriera

**P0-B · punto 11 — convertir el scaffolding en adapters/workers reales, con expiry, review, idempotencia por conexión y migraciones para tenants existentes**

`IntegrationOutboxService` tenía cola, arrendamiento con vencimiento, reintentos con espera exponencial y techo, muerte por agotamiento, dedupe de webhooks y reconciliación con detección de deriva. Todo bien construido. Y **cero llamadores**: ningún módulo lo importaba, ningún proceso drenaba la cola, ninguna entrada salía nunca.

Peor que "no se usa todavía": el servicio **promete** en su propio comentario que *"el día que el proveedor se certifique, sale"*. No era cierto. Las entradas nacen `suppressed` mientras el proveedor no está certificado y `claim` sólo mira `pending`/`retrying`; encender el interruptor no liberaba nada de lo acumulado. Intención registrada que nunca se ejecuta es peor que perderla — parece que va a salir.

**Lo que faltaba, pieza por pieza:**

- **El worker.** Corre cada minuto con `CronLockService` (API y worker levantan el mismo AppModule; sin el candado todo corre dos veces, y dos veces contra el límite de tasa de un tercero). Hace cuatro cosas en orden: vence, libera, reclama con arrendamiento, entrega.
- **El adapter.** No había interfaz: "convertirlo en adapters" era una intención sin forma, y cada proveedor iba a inventar la suya con un `switch` en el worker. `IntegrationWriteAdapter` declara proveedor, **qué operaciones sabe hacer** y `write()`. El registro rechaza el duplicado en vez de pisarlo: cuál gana dependería del orden de carga de los módulos, y ese defecto se ve distinto en cada despliegue.
- **El vencimiento.** Un outbox sin TTL no se puede revisar: crece con intención que nadie va a ejecutar y esconde lo que sí importa. Siete días, y no es retención sino honestidad — una reserva encolada hace tres meses entregada hoy no repara nada: crea una reserva que nadie pidió, para una fecha que pasó, en el calendario de alguien que no la espera. **Vencer corre antes que liberar**, por eso mismo.
- **La revisión.** Todo esto vivía en una tabla por tenant que nadie podía consultar. `GET /integrations/rail` dice qué proveedores están certificados y cuáles tienen adapter —y el cruce: *certificado sin adapter* es el interruptor encendido sin nadie que ejecute—; `GET /integrations/outbox/:tenantId` lista lo muerto, suprimido y vencido. Ambos `super_admin`, y **el payload nunca viaja**: puede traer datos del cliente final del tenant.
- **La idempotencia por conexión.** La unicidad era `(proveedor, clave)`, correcto sólo mientras haya UNA conexión por proveedor. Con dos cuentas de Hostaway —dos carteras, dos credenciales— el mismo hecho de negocio deriva la misma clave, la segunda choca contra la fila de la primera y **su escritura desaparece**: el `ON CONFLICT` la convierte en un toque de `updated_at`. La conexión entra a la clave **sólo cuando existe**, para que las claves ya guardadas deriven igual: cambiar la forma de todas convertiría cada pendiente en una entrada nueva y el proveedor recibiría la operación dos veces.
- **Las migraciones.** Los schemas creados antes de que existiera el andamiaje no tienen sus tablas. Insertar contra una tabla ausente tiraba `42P01`, y el llamador —que suele estar en un `.catch()`— perdía la intención en silencio, exactamente lo que un outbox existe para impedir. `enqueue` repara con `ensureCanonicalTables`, y la columna nueva entra por expand-contract (`ADD COLUMN IF NOT EXISTS`, nullable), que es lo que exige el orden del deploy: migra antes de recrear contenedores.

**Sin adapter, la entrada muere con motivo.** Hoy **no hay ninguno registrado** —ninguna integración externa está certificada— y eso es lo correcto: el riel funciona, la escritura real espera autorización. Lo que cambió es que ahora se ve: `no_adapter_registered` y `operation_not_supported:<op>` en vez de una cola creciendo en silencio. Y un fallo declarado no recuperable muere en el acto: un payload que el proveedor rechaza por inválido no mejora esperando, y ocho reintentos son ocho llamadas inútiles y ocho veces más tarde que alguien lo mire.

**Riesgos que quedan**
- **No hay ningún adapter escrito.** Escribir el de Hostaway necesita credenciales de sandbox y certificación — **bloqueo externo**, sin cambios. Lo que sí está es dónde enchufarlo.
- **No hay pantalla.** La revisión es API-only; el Ops Center no la muestra. Trabajo interno pendiente.
- **La columna `connection_id` no la escribe nadie todavía**: ningún llamador pasa `connectionId` porque ningún llamador encola. Existe para que la primera integración multi-cuenta no tenga que migrar datos.
- **El worker recorre todos los tenants activos cada minuto.** Con la cola vacía son dos consultas baratas por tenant, pero escala lineal con la base. Cuando haya volumen habrá que filtrar por "tenants con entradas", y eso es trabajo interno pendiente.

**Pruebas** — `integration-outbox.worker.spec.ts` (nuevo, 19) + `integration-scaffolding.spec.ts` ajustado al camino que repara el schema.

**Verificación**
```
npx tsc --noEmit  → exit 0 en shared, api y dashboard
npm run test:bootstrap → 1 passed (sin errores de DI; necesita --max-old-space-size=8192)
jest apps/api     → 3156 passed / 314 suites (1 skipped, 10 skipped tests), 0 fallos
```

## Estado del programa — cinco categorías, sin mezclar

> **Nota de corrección (ago 2026).** La versión anterior de esta sección declaraba fases "cerradas" apoyándose en que su gate mínimo pasaba, y metía en una sola tabla de "bloqueos" cosas que no dependen de nadie de afuera. Era una lectura optimista: **un gate que pasa no es una fase completa**, y llamar "bloqueo" a trabajo interno pendiente lo saca del radar. Se reclasifica todo en cinco categorías que no se mezclan:
>
> | Categoría | Qué significa | Qué se puede hacer con eso |
> |---|---|---|
> | ✅ **Implementado y verificado** | Código + pruebas que lo fijan + verificación corrida | Nada; sólo no romperlo |
> | ◐ **Parcial** | Funciona, pero no cumple el criterio completo del plan | Trabajo interno, sin dependencias |
> | 🔒 **Fail-closed temporal** | Deliberadamente apagado en código, con motivo tipado y handoff | Se enciende cuando llegue lo externo |
> | ⛔ **Bloqueo externo** | Necesita credencial, proveedor, experto, tenant piloto o decisión irreversible del dueño | Nada de nuestro lado |
> | ⏳ **Pendiente interno** | Implementable hoy, sin depender de nadie | **Lo que sigue** |

### Verificación completa

Al cerrar los 20 pendientes internos (U33-U52):

```
npx tsc --noEmit  → exit 0 en shared, api, dashboard
jest apps/api        → 3039 passed / 306 suites (1 skipped), 0 fallos
jest apps/dashboard  →  220 passed /  27 suites, 0 fallos
jest app.bootstrap   →    1 passed — DI de NestJS limpio
```
> El bootstrap exige `ENCRYPTION_KEY` de 64 hex en el shell; sin él falla por entorno, no por DI.

Línea de base al empezar esta tanda: 2628 API / 207 dashboard. **+411 pruebas en API y +13 en dashboard**, ninguna debilitada. Las que cambiaron de expectativa lo hicieron porque **afirmaban el defecto** y cada una quedó anotada con por qué: el `+57` por defecto que documentaba la corrupción, `professional_case` "sin pantalla propia", el conteo de tools estático, y tres fixtures que usaban `retail/marketplace` —un perfil bloqueado— como vertical arbitraria.

Línea de base al empezar la sesión: 2523 API / 161 dashboard. Ninguna prueba fue debilitada; las que cambiaron de expectativa lo hicieron porque **afirmaban el defecto** (farmacia sin Pedidos, guía de skillset siempre en inglés, cinco plantillas vacías que ganaban a la meta del dueño, fotografía sin paquetes), y cada una quedó anotada con por qué.

### ✅ Implementado y verificado

Código en su lugar, pruebas que lo fijan, verificación corrida.

| Qué | Dónde |
|---|---|
| Registro único de los 76 perfiles + puerta de CI | U11 |
| `EffectiveAgentCapabilityContractV1` con subtipo ∩ agente ∩ plan ∩ readiness, readiness **bloqueante** con CTA de reparación | U12 |
| Semántica de lectura (`empty` ≠ `stale` ≠ `provider_down` ≠ `error`) en las tools que la usan | U6, extendida en U16 y U17 |
| Clasificador único de confirmación, handoff y opt-out, por efecto y país | U8 |
| Jurisdicción, autoridad y vigencia en RAG regulado | U9 |
| Agent Test resuelve el mismo contrato que producción | U10 |
| Registros globales de estadías y salidas, con crear y cancelar desde el registro | U14, U20 |
| Fotos de inmuebles end-to-end, con normalización en el borde de escritura | U15 |
| Paquetes de fotografía sembrados por sub-tipo + catálogo de servicios alcanzable | U16 |
| Farmacia: Pedidos publicado, KPIs propios, assurance real, receta bloqueada **en el writer** | U17 |
| Invariantes del prompt en modo libre; skillset por rubro con no-pitch; guías en 4 idiomas; `requiredFields` normalizado | U18 |
| Plan en la navegación: candado en vez de 403 | U19 |
| Terminología por sub-tipo con avoid-list, en turno y panel | U21 |
| Set dorado derivado de lo que el perfil declara | U22 |
| Trato, formatos regionales y prohibición de convertir importes | U23 |
| Móvil con todos los espacios operativos del negocio | U24 |
| Clasificación `register`/`catalogue`/`mixed` aplicada a menú y guardia de rutas | U25 |
| Panel del Inbox con allowlist de campos y deep link por objeto, con `?tab=` | U26, U29 |
| Secciones de navegación derivadas de la clasificación | U27 |
| Home con KPIs del perfil y color que de verdad se renderiza | U28 |
| Telemetría de 403 / dead end / plan bloqueado, con allowlist y sin PII | U30 |
| Límites declarados del perfil en el prompt | U31 |
| `strategy: 'stop'` con efecto real sobre writers estáticos y asíncronos | U32, U33 |
| Divulgación de rol: el agente no se hace pasar por persona | U34 |

### ◐ Parcial — funciona, no cumple el criterio completo

| Qué | Qué falta para completo |
|---|---|
| ~~**Contrato efectivo**~~ | ✅ **U33/U35**: entra rol, canal, jurisdicción y salud/scopes/frescura del proveedor, y se resuelve ANTES de los tres motores |
| ~~**STOP**~~ | ✅ **U35**: los 7 perfiles contra las cinco puertas, `capability_status` en el turno y handoff determinista |
| **Terminología por sub-tipo** | ◐ **U54**: 15 de 76 declaran la propia y la contradicción *mecánica* de la herencia quedó cerrada con una puerta que la vigila. Lo que queda —revisar los 61 heredados uno por uno— **necesita a alguien que conozca el rubro**, y está en el bloqueo externo como revisión de dominio |
| ~~**Set dorado**~~ | ✅ **U45**: mínimo 29 por perfil en los cuatro idiomas |
| **Packs de país** | Los 15 de LatAm en `draft`. Ninguno se presenta como certificado, que es lo correcto, pero llegar a `pilot` exige un tenant real de ese país |
| ~~**Telemetría de navegación**~~ | ✅ **U53**: tiempo-a-tarea, profundidad de clics, búsqueda y backtracking |
| ~~**Secciones del shell**~~ | ✅ **U53**: `customers` y `commercial` como grupos propios |
| ~~**Active Objects**~~ | ✅ **U48**: cinco cargadores nuevos, dos tipos que no existían y dos sujetos que faltaban |
| ~~**Subpermisos de tool**~~ | ✅ **U46**: se aplican en publicación y en el ejecutor |

### 🔒 Fail-closed temporal — apagado a propósito hasta que llegue lo externo

| Qué | Cómo está apagado | Qué lo enciende |
|---|---|---|
| Write-back a Channel Manager | `createBooking` falla con `channel_manager_owns_calendar`, proveedor, `asOf` y mensaje al cliente; la UI lo muestra | Sandbox Hostaway + certificación por versión de API |
| Writers de los 7 perfiles `stop` | `writersBlocked` quita toda tool que no sea `read` con política revisada | La decisión de producto de cada perfil (ver bloqueo externo) |
| Cobro en perfiles `stop` | El filtro corre sobre la lista completa, después de pagos e integraciones | Ídem |

### ⛔ Bloqueo externo — nada de nuestro lado

| Bloqueo | Qué se necesita | Quién |
|---|---|---|
| Channel Manager (Hostaway) | Credenciales de sandbox y certificación por versión de API | Proveedor |
| Olas 2-4 de integraciones (Toast, Mindbody, Cliniko, PMS farmacéutico, DMS, PAS, core financiero) | Credenciales y sandbox por proveedor | Proveedor |
| `fintech` | Elegir la familia de producto antes de definir el flujo | Dueño |
| `marketplace` | Modelo multi-vendedor, KYB y payouts | Dueño |
| `fotografia/wedding_planner` | Event Planning como experiencia propia: cambia el conteo canónico | Dueño (irreversible + migración) |
| `inmobiliaria/construccion` | Venta de proyecto vs empresa constructora | Dueño (taxonomía + migración) |
| Revisión de dominio de los contratos por perfil | Experto por rubro, que el plan exige antes de certificar | Dueño + experto |
| Fase 6 — pilotos y certificación | 3-5 tenants por perfil, shadow mode, evidencia E2E, sign-off | Dueño |

### ⏳ Pendiente interno

#### Tanda vigente — reapertura del dueño (ago 2026)

> **Corrección.** La tanda anterior se cerró diciendo que lo que quedaba dependía de terceros. No era exacto: quedaba —y queda— trabajo interno. El dueño lo reabrió en 19 puntos ordenados. Esta tabla es el estado honesto de esos 19, y se actualiza por paquete, no al final.

| # | Paquete | Estado |
|---|---|---|
| 1 | `allowedTools`/`effectiveSnapshot` obligatorios + default-deny en el ejecutor | ✅ **U55** |
| 2 | Revalidar pending confirmations contra el snapshot vigente | ✅ **U55** |
| 3 | Autorización exacta en Booking y Procedures | ✅ **U55** |
| 4 | Separar tools core/globales, verticales, proveedor y MCP | ✅ **U56** |
| 5 | Handoff STOP sólo ante operación denegada | ✅ **U55** |
| 6 | Pruebas E2E live (no sólo unitarias) | ◐ **U57** — la cadena real sin mocks entre las piezas que deciden, contra la misma función que corre en producción; falta el *orden* del turno (`processIncomingMessage`) y una corrida contra base real |
| 7 | Hostaway: una unidad mapeada nunca degrada a escritura local | ✅ **U58** |
| 8 | Matriz provider↔subtipo; evitar lectura externa + writer local | ◐ **U59** — matriz por **industria** (no por subtipo) y desplazamiento estático por proveedor (no por recurso); afinar ambos necesita revisión de dominio |
| 9 | Unificar freshness, cron y estado mostrado en UI | ◐ **U60** — un solo número compartido, cadencia verificada y estado `not_applicable` en el panel; falta la disponibilidad en vivo de Mindbody y unificar el reloj del Channel Manager |
| 10 | Secretos: dry-run/apply/cutover, cero plaintext, máscara `***`, cambio de provider, updates atómicos | ◐ **U61** — las cinco piezas construidas y probadas; el corte a `reject` depende de correr la migración en producción, y los ~8 módulos restantes que escriben `settings` siguen con el patrón que pierde datos |
| 11 | Scaffolding → adapters/workers reales (expiry, review, idempotencia por conexión, migración de tenants existentes) | ◐ **U62** — worker, contrato de adapter, vencimiento, revisión, identidad por conexión y reparación de schema; **ningún adapter escrito** (necesita sandbox del proveedor) y la revisión no tiene pantalla |
| 12 | Intent/Slot/ToolPlan para los 19 grupos y los 76 perfiles | ⏳ pendiente |
| 13 | Eliminar los 72 gaps; conectar contrato con prompt, runtime, UI, móvil y effective-profile | ⏳ pendiente |
| 14 | Terminología e idioma por perfil/país | ⏳ pendiente |
| 15 | Sacar guidance español global y voseo fuera de su país | ⏳ pendiente |
| 16 | Golden evals reales ES/EN/PT/FR con el resolver de producción | ⏳ pendiente |
| 17 | CRM mínimo + writer→ActiveObject→deep-link | ⏳ pendiente |
| 18 | Backlog nativo de los 31 `build` y 23 `hybrid` | ⏳ pendiente |
| 19 | Aliases y migraciones taxonómicas | ⏳ pendiente |

**Además, salido de U55 y no en la lista original:** el reanudador de aprobaciones humanas no re-resuelve el contrato efectivo (ver riesgos de U55). Trabajo interno.

#### Tanda anterior — los 20, cerrados

Los veinte quedaron implementados, con pruebas que los fijan y suites completas verdes. **La lista se conserva tachada, no borrada**: lo que se cerró y con qué unidad es la única forma de contestar después "¿esto ya se hizo?" sin volver a auditarlo.

| # | Pendiente |
|---|---|
| ~~1~~ | ✅ cerrado en **U33** |
| ~~2~~ | ✅ cerrado en **U33** |
| ~~3~~ | ✅ cerrado en **U33** |
| ~~4~~ | ✅ cerrado en **U33** |
| ~~5~~ | ✅ cerrado en **U33** |
| ~~6~~ | ✅ cerrado en **U36** |
| ~~7~~ | ✅ cerrado en **U37** |
| ~~8~~ | ✅ cerrado en **U37** |
| ~~9~~ | ✅ cerrado en **U38** |
| ~~10~~ | ✅ cerrado entre **U35** (las 4 lecturas de proveedor) y **U39** (MCP). El Channel Manager no aporta tools propias: sus reservas entran por `check_property_availability`, que ya tiene política revisada |
| ~~11~~ | ✅ cerrado entre **U40** (consumidores + default `+57`) y **U41** (revisión regional: API, cron y pantalla) |
| ~~12~~ | ✅ cerrado en **U42** |
| ~~13~~ | ✅ cerrado en **U43** |
| ~~14~~ | ✅ cerrado en **U44** |
| ~~15~~ | ✅ cerrado en **U44** |
| ~~16~~ | ✅ cerrado en **U45** |
| ~~17~~ | ✅ cerrado en **U46** |
| ~~18~~ | ✅ cerrado entre **U47** (writers CRM) y **U48** (Active Objects) |
| ~~19~~ | ✅ cerrado entre **U49** (alquiler y guardería), **U50** (superficie de `professional_case`) y **U52** (analítica declarada vs devuelta). La semántica y las plantillas de turismo ya estaban: terminología de los 4 subtipos, registros de estadías y salidas y plantillas de confirmación, hechas en U14/U15/U20 |
| ~~20~~ | ✅ cerrado en **U51** |
