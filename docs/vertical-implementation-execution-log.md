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

