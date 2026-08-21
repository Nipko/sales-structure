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

```
npx tsc --noEmit  → exit 0 en shared, api, dashboard, landing, whatsapp, mobile
jest apps/api        → 2628 passed / 290 suites (1 skipped), 0 fallos
jest apps/dashboard  →  207 passed /  25 suites, 0 fallos
jest apps/mobile     →  319 passed /  24 suites, 0 fallos
jest app.bootstrap   →    1 passed — DI de NestJS limpio
```

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
| **Contrato efectivo** | Le faltan entradas: salud/scopes/frescura del proveedor, jurisdicción, **rol** y **canal**. Y se resuelve **después** de Booking Engine y Procedures, no antes |
| **STOP** | Probado contra tools estáticas y asíncronas; **sin probar** contra Booking Engine, Procedures y fallo del resolutor. No llega al turno como `capability_status` ni produce handoff determinista |
| **Terminología por sub-tipo** | 14 de 76 perfiles. Los demás heredan de su industria por decisión, pero nadie verificó uno por uno que la herencia sea correcta |
| **Set dorado** | 4 a 7 escenarios por perfil. El objetivo del plan es **≥25 por perfil e idioma prioritario** |
| **Packs de país** | Los 15 de LatAm en `draft`. Ninguno se presenta como certificado, que es lo correcto, pero ninguno llegó a `pilot` |
| **Telemetría de navegación** | Sólo lo excepcional. Faltan tiempo-a-tarea, click depth, búsqueda y backtracking |
| **Secciones del shell** | `dailyWork` y `catalogAndResources` separadas; faltan `customers` y `commercial` como grupos propios |
| **Active Objects** | Cubre los objetos con loader. Varios writers crean cosas que el turno siguiente no ve |
| **Subpermisos de tool** (`canBook`, `canCancel`, `canCheckStock`, `canRecommend`) | Declarados en la config del agente; **no** se aplican en publicación ni en executor |

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

### ⏳ Pendiente interno — implementable hoy

Lo que sigue, en el orden acordado. **Ninguno depende de credencial, experto ni tenant piloto.**

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
| 11 | Migrar los consumidores de `normalizePhoneE164` al `TenantRegionalProfile`; eliminar el default `+57`; UI/API de revisión regional |
| 12 | Eliminar fallbacks productivos COP / es-CO / Bogotá fuera de decisiones regionales explícitas |
| 13 | Una sola fuente de schema para `products` |
| 14 | `VerticalPromptContractV2`, `IntentContract`, `SlotSchema`, `NavigationPolicy`, `CertificationEvidenceV2` |
| 15 | Los 76 contratos de dominio en `draft` |
| 16 | Evals ≥25 escenarios por perfil e idioma prioritario |
| 17 | Aplicar `canBook`, `canCancel`, `canCheckStock`, `canRecommend` en publicación y executor |
| 18 | Writers CRM mínimos + Active Objects para todos los writers |
| 19 | Profundidad nativa sin proveedor: ocupación/agrupamiento de boarding; conductor/depósito/contrato/calendario de flota; plantillas y semántica de turismo; superficie de `professional_case`; navegación y analítica restantes; perfiles `build` y partes nativas de `hybrid` |
| 20 | Scaffolding provider-neutral: outbox, webhook inbox, idempotencia, reconciliación y contract-test kit — con los writers externos apagados hasta tener sandbox |
