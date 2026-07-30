# Restaurantes — deep-dive (Jul 2026)

> Dossier 6/18. Fuentes: ficha en `docs/vertical-maturity-audit-2026-07.md` §4 (22/36, media), `docs/vertical-audit-workdir/cluster-activos.json`, y código leído archivo:línea. Estado asumido: bloque "Ahora" 12/12 implementado (`95f758f3`, `b9bd6332`, `5c2581db`, `60049164`) — nada de eso se re-reporta como roto.

## 1. Veredicto y tesis de inversión

**INVERTIR — pero en el pedido, no en la mesa.** Restaurantes es la demanda #6 de LatAm (77 pts) con el mercado más grande de todo el ranking (Mkt Size 10/10, único junto a e-commerce) y la disposición a pagar más baja del top-10 (WTP 5) — `market-research-latam.md:380-391`. El research encuadra el rubro como PEDIDOS: "WhatsApp ordering is endemic among small restaurants not on Rappi/iFood" (`:110`), delivery online de México $5.14B (`:110`), AOV de $45 en WhatsApp México (`:116`); las menciones país por país son casi todas "food delivery", no reservas. Y justo ahí la plataforma ya tiene su segundo dominio más completo después de turismo: menú con alérgenos, `place_order` con integridad de precios anti-manipulación, kanban de cocina real con auto-refresh, promociones con vigencia horaria (`restaurants.service.ts:1-437`, `food-orders/page.tsx`). El célebre hueco de booking_fit 1 — reservar mesa = fecha+hora+PERSONAS y el motor no tiene partySize — es real pero es el hueco del caso de uso **secundario**; importa menos de lo que la matriz sugiere. Lo que sí bloquea la venta hoy son tres cortes de circuito en el caso de uso primario: el pedido entra y **nadie del restaurante se entera** (`food_order.created` sin listeners), las promociones son **inalcanzables** (stack entero sin UI — patrón gimnasios), y el checklist manda a cargar el menú **al lugar equivocado** (Knowledge Base en vez de `/admin/menu`, dejando a `place_order` sin catálogo). Cerrar esos tres cuesta días; la capacidad de mesas es fase 2 y cuelga de la decisión transversal F1 que la auditoría ya le pidió al dueño.

## 2. Radiografía end-to-end

### 2.1 Alta

- Industria `restaurantes` en el selector (`apps/dashboard/src/app/onboarding/page.tsx:45`).
- Sub-tipos (`onboarding/page.tsx:106-111`): casual_dining, comida_rapida, cafeteria, dark_kitchen — **idénticos al registry** (`vertical-definitions.ts:266-271`); sin drift de claves (a diferencia de turismo/pet_services).
- Objetivos (`onboarding/page.tsx:215-220`): "Gestionar reservas de mesa", "Mostrar menú y recomendaciones", "Procesar pedidos a domicilio", "Enviar ofertas y eventos especiales". Audiencias (`:315-319`): comensales individuales, eventos corporativos y privados, clientes de delivery.
- Cumplimiento real de esos 4 objetivos hoy: menú y pedidos SÍ (con menú cargado); reservas "funciona" con capacidad 1; **"Enviar ofertas" es incumplible**: no existe UI de promociones (§4.2) y no hay ningún mecanismo de envío proactivo (broadcast genérico aparte).
- `chatReasons`/`customerTypes` llegan al prompt L3 vía `<vertical_context>` (fix `5c2581db`).

### 2.2 Agente creado

`createDefaultAgentFromGoals` (`persona.service.ts:2670-2721`) elige plantilla por industria y ramifica por sub-tipo vía `bySubType` (`:2702-2713`):

- casual_dining / comida_rapida / cafeteria → `verticalTemplates[0]` = **tpl_restaurante_reservas** (`persona.service.ts:1360-1387`): Luca cálido, reglas de alergias y escalado >8 personas, `tools: { appointments: {enabled, canBook, canCancel} }`. **No trae `tools.restaurants`** (§4.7).
- dark_kitchen → **tpl_restaurante_delivery** (`persona.service.ts:1389-1418`, mapeo `:2707`, fix `5c2581db`): persona de pedidos, `tools: { restaurants: {enabled: true} }` (fix `b9bd6332`, comentario `:1413-1415`). Sin appointments — correcto para el caso.
- La clave `delivery` de `bySubType` (`:2706`) no corresponde a ningún sub-tipo del alta ni del registry — entrada muerta, inocua.
- Gate blando de agenda (`:2752-2758`): appointments se apaga con marcador `pendingPrerequisites` (el agente nace antes del bootstrap) y `restoreAppointmentsTool` lo reenciende tras sembrar servicios+slots (`verticals.service.ts:67`) — flujo `95f758f3` operando como se diseñó.

### 2.3 Bootstrap (`verticals.service.ts`)

Rama restaurantes: `enableRestaurantsTool(schemaName)` (`verticals.service.ts:107-109`, impl `:998-1021`) — enciende `config.tools.restaurants.enabled` **solo en el agente default** (`WHERE is_default = true LIMIT 1`).

Siembra común — restaurantes NO ramifica por sub-tipo (no aparece en 4b-4d; cf. `cluster-activos.json` hallazgo "subtipos cosméticos"):
- Pipeline 5 etapas de RESERVAS (`vertical-definitions.ts:289-297`): Consulta → Reserva (`appointment_required`) → Confirmada (`name_required`+`phone_required`) → Completada / No Show.
- 5 FAQs (`vertical-definitions.ts:298-304`), post-`95f758f3` sin políticas inventadas + `tools.faqs` encendido.
- 3 servicios de mesa (`vertical-definitions.ts:305-309`): "Reserva mesa 2-4" (90 min), "Reserva grupo 5-8" (120 min), "Evento privado" (240 min), $0, `durationType 'fixed'` — **se siembran también para dark_kitchen** (`seedServices` corre para toda vertical con `bookingEnabled`, `verticals.service.ts:49-51`, sin mirar subType). §4.9.
- **Cero items de menú y cero categorías sembradas** — el catálogo del que vive la vertical nace vacío, sin demo ni guía (§3, §4.3).
- Disponibilidad desde businessHours (`verticals.service.ts:468-542`): lun-jue 11:00-23:00, vie/sáb 11:00-00:00 → 23:59 (`:527`), dom 11:00-22:00. **Todos los slots al owner** (`:493-503`) → capacidad concurrente 1 para todo el restaurante.

### 2.4 Conversación — tabla de tools

Registro gateado por `cfgTools?.restaurants?.enabled === true` (`conversations.service.ts:1881-1883`; el simulador también los incluye, `agent-test.service.ts:156`). `place_order`/`cancel_order` están en `WRITE_TOOLS` (`conversations.service.ts:178`) — dos escritores en el mismo turno se serializan. Definiciones en `conversations/tools/restaurants-tools.ts:14-130`; handlers en `ai-tool-executor.service.ts`.

| Tool | Qué hace | Gating | ¿Funciona e2e? |
|---|---|---|---|
| `get_menu` | `searchMenu`: query/categoría/tag/`excludeAllergens` (NOT `@>` por alérgeno)/maxPrice, tope 30 (`restaurants.service.ts:210-262`; handler `ai-tool-executor.service.ts:2023-2053`) | tools.restaurants | **Sí** — con menú cargado; vacío devuelve "No items match" |
| `get_promotions` | Vigentes + filtro runtime por día de semana y ventana horaria (`ai-tool-executor.service.ts:2055-2093`) | tools.restaurants | **Técnicamente sí — en la práctica siempre vacío**: no existe UI para crear promociones (§4.2) |
| `place_order` | Valida items contra `menu_items` activos y **fuerza el precio del catálogo** (anti-manipulación LLM, `:2113-2141`); crea `food_orders`+`food_order_items`; emite `food_order.created` (`:2157-2161`) | tools.restaurants | **Crea el pedido — pero el evento tiene 0 listeners: ninguna notificación llega al restaurante (§4.1)**. ETA hardcodeada "30-45 minutos" (`:2169`); currency siempre COP (§4.4) |
| `cancel_order` | IDOR guard por contacto; solo estados cancelables; razón a notes; emite `food_order.cancelled` (también 0 listeners) (`:2881-2910`) | tools.restaurants | **Sí** — con estados fantasma: acepta `['received','confirmed','pending']` (`:2890`) pero `confirmed`/`pending` no existen en el dominio (`received→preparing→ready→delivered/cancelled`, `tenant-schema.sql:2041`); la descripción del tool dice "pending or confirmed" (`restaurants-tools.ts:99`) sin mencionar `received`, el único cancelable real (§4.6) |
| `check_order_status` | Estado+items+total con IDOR guard (`:2912-2944`) | tools.restaurants | **Sí** |
| `list_my_orders` | Últimos pedidos del contacto (`:2946-2970`) | tools.restaurants | **Sí** |
| `create_appointment` (mesa) | Motor genérico servicio→fecha→hora | tools.appointments | **Parcial**: sin partySize (grep en `apps/api/src`: solo tours y email-templates lo tienen), capacidad 1 por franja; los servicios 2-4/5-8 simulan el tamaño de grupo |
| `get_restaurant_menu` (Toast) | Lee `vi_items` sincronizados del POS | proveedor conectado (T3.19) | **No probado en vivo** (transversal conocido) |

**Conteo placeholders vs params en `restaurants.service.ts`** (el patrón que cazó el P0 de turismo en `tours.service.ts`, commit `e4f67c94`): **todo alineado** — `createCategory` 3/3 (`:36-38`); `createItem` 11 columnas/11 placeholders/11 params (`:138-156`); `createOrder` 14/14/14 (`:322-348`); `food_order_items` 8/8/8 (`:357-372`); `createPromotion` 9/9/9 (`:408-425`); updates dinámicos con índice bien llevado (`updated_at = NOW()` se agrega sin placeholder y el WHERE usa el índice siguiente: `:52-56`, `:190-194`). También revisados los raw SQL del executor (`:2884`, `:2899` 2/2, `:2914-2917`, `:2948-2954`): correctos. **Acá no hay un create_tour_booking.** Sí hay un matiz de atomicidad: `createOrder` inserta la cabecera y después los items en un loop de queries individuales (`:352-374`, el comentario dice "one batch" pero no lo es); un fallo a mitad deja un pedido `received` con items parciales que la cocina podría preparar incompleto. Sin compensación — mismo espíritu que el hallazgo de turismo, severidad mucho menor (§4.12).

### 2.5 Agenda / inventario

- El inventario real es el menú: schema completo (`tenant-schema.sql:1990-2084` — categorías, items con alérgenos/tags/prep_time/calorías/sold-out flag, promociones), CRUD REST con guards (`restaurants.controller.ts:14, 24-113`) y página `/admin/menu` (CRUD de categorías+items, toggle disponibilidad, tags/alérgenos — `menu/page.tsx:70-135, 360-410`). Sin import masivo: 60 platos se cargan uno a uno (§4.13).
- Reservas de mesa: motor genérico. Sin mesas como recurso, sin turnos por mesa, sin lista de espera (ficha, `cluster-activos.json:137`).
- Columnas huérfanas en `food_orders`: `estimated_delivery_at` (nunca escrita — la ETA que ve el cliente es un string fijo), `payment_status` (nace 'pending', ningún flujo la mueve), `modifiers` (el tool no los expone: `restaurants-tools.ts:69-86`; solo REST).

### 2.6 Pipeline

Etapas de RESERVAS (§2.3). El ciclo de pedidos no tiene representación en el embudo: `place_order` no satisface ninguna transition_rule (`appointment_required` consulta `appointments`) — un dark_kitchen que vende delivery todo el día tiene las tarjetas apiladas en Consulta y KPIs de conversión que mienten. Mismo patrón que tours/`tour_bookings` (hallazgo 3 de `cluster-activos.json`); el arreglo análogo sería `order_required` (ya propuesto como QW para retail).

### 2.7 Dashboard del tenant

- Sidebar: `menu` (supervisor+) y `foodOrders` (agentes) solo para restaurantes (`AppSidebar.tsx:128,130`). `inventory`/`orders` declarados para restaurantes (`AppSidebar.tsx:139-140`) pero **ocultos** por `hiddenItems: ['inventory','catalog','orders']` del registry (`vertical-definitions.ts:320`; filtro en `AppSidebar.tsx:354-356,421,430`) — dos fuentes en conflicto, gana el registry; la declaración es config muerta (§4.14).
- labelOverrides: crm→"Comensales", pipeline→"Reservas", appointments→"Reservaciones" (`vertical-definitions.ts:315-319`) — los tres apuntan a items reales (a diferencia del `catalog` muerto de inmobiliaria/automotriz/retail).
- **`/admin/food-orders` es la mejor sorpresa de la vertical** (`food-orders/page.tsx:1-394`): kanban received→preparing→ready→delivered, avance de estado con 1 click, resaltado stale >30 min (`:201-202,209`), modal de detalle con instrucciones especiales, cancelación, **auto-refresh cada 15 s** (`:98-102`) pensado para dejarlo abierto en cocina. Lo que NO tiene: sonido de pedido nuevo, notificación fuera de la página (TopBar sin categoría de pedidos — grep `food_order` en `TopBar.tsx`: 0 hits), creación manual de pedido (el telefónico no se puede registrar).
- KPIs del panel (`vertical-definitions.ts:322-329`): Reservas Hoy, Consultas Hoy, No Shows, Mensajes — **cero KPIs de pedidos** (ni pedidos hoy ni GMV), pese a que `vertical-strategy.md:70` los especificó ("pedidos procesados, hora pico") y el aggregator de plataforma ya los calcula.
- Aggregator restaurantes (`vertical-analytics.service.ts:249-279`, solo visible para super_admin): menuItems, ordersTotal/gmvTotal, ordersWeek/gmvWeek, activePromotions, `kitchenInProgress` — este último **cuenta mal**: filtra `status NOT IN ('completed','cancelled')` (`:267`) pero el terminal real es `delivered` → todo pedido entregado suma a "cocina en curso" para siempre (§4.5).
- Cosmética original presente: `verticalWelcome.restaurantes` ("Tu restaurante está listo para recibir comensales", `messages/es.json:6104`), empty states (`es.json:5950-5956`) y checklist vertical (`es.json:6036-6042`) — pero el paso del checklist "Carga tu menú y horarios" (`addKnowledgeBase`) **apunta a `/admin/knowledge`** (`OnboardingChecklist.tsx:29`), no a `/admin/menu` (§4.3).

### 2.8 Integraciones

- **Toast** (T3.19): adapter real — login machine-client + `menus/v2` → `vi_items` (`vertical-integrations.service.ts:228-263`), test de conexión (`:204-208`), UI en settings/integrations/vertical. Solo LECTURA de menú; `place_order` escribe únicamente en `food_orders`, sin push al POS. Sync manual, sin cron, nunca probado con credenciales reales (transversales conocidos). Detalle propio: **currency hardcodeada 'USD'** en el upsert (`:254`) — un menú Toast sincronizado en LatAm mostraría precios en USD.
- Plataformas de delivery (Rappi/PedidosYa/iFood): nada. POS LatAm (Fudo, Siigo POS, Loyverse): nada — y **ninguno aparece en nuestros docs** (grep en `docs/`: 0 hits fuera del contexto "not on Rappi/iFood" de `market-research-latam.md:110`). La pregunta "¿Toast es siquiera el POS de LatAm?" no está respondida por nuestro research: Toast se eligió en el competitivo como el especialista global de referencia (`competitive-analysis-2026-q2.md:410`), no por presencia LatAm. §5 y §8.

## 3. La experiencia hoy, contada honestamente

**(a) El dueño en sus primeros 30 minutos.** El alta es de las buenas: sub-tipos correctos, objetivos que suenan a su negocio. Aterriza en un panel que lo saluda por su rubro, con sidebar de "Menú", "Pedidos", "Reservaciones", "Comensales" — la primera impresión es de producto vertical de verdad. Ahí empieza el desvío: el checklist le dice "Carga tu menú y horarios" y lo manda a la **Knowledge Base**; si obedece, sube su carta en PDF, el RAG podrá comentarla… y `place_order` seguirá sin poder vender nada, porque la integridad de precios exige filas en `menu_items` (`ai-tool-executor.service.ts:2129-2132`). Si en cambio descubre `/admin/menu` solo, carga los platos uno a uno (sin CSV). Encuentra el objetivo "Enviar ofertas" que eligió en el alta y no encuentra NINGUNA pantalla de promociones. Si es dark_kitchen, ve además una agenda de "Reserva mesa 2-4" y un KPI de "Reservas Hoy" que no significan nada para su negocio. El kanban de cocina, cuando lo abre, es excelente — pero nadie le dijo que tiene que dejarlo abierto: es la única forma de enterarse de un pedido.

**(b) El cliente final por WhatsApp en sus primeros 3 mensajes.** Con el menú cargado, la conversación de pedido es de lo mejor de la plataforma: "¿qué tienen sin gluten?" → `get_menu` con exclusión real de alérgenos; "quiero 2 hamburguesas y una limonada" → confirmación de items+total con precios del catálogo (el LLM no puede inventar precios) → pedido creado con dirección validada para delivery. Tres detalles mienten: la ETA "30-45 minutos" es un string fijo, no sale de `prep_time_minutes`; en México/Argentina el total puede volver etiquetado "COP" (§4.4); y "¿tienen promos hoy?" siempre responde que no hay (catálogo de promos incondicionalmente vacío). Después del pedido, silencio estructural: nadie del restaurante fue notificado, y si la cocina avanza el estado, al comensal no le llega nada — tiene que preguntar él. En reservas: "mesa para 6 el sábado" fluye razonable (elige "Reserva grupo 5-8", fecha, hora), pero a las 20:00 solo UNA reserva puede existir para todo el restaurante; el segundo comensal de la noche recibe "no hay disponibilidad" con el local vacío. Con servicios de 90 min y 12 h de ventana, el techo teórico es ~8 reservas/día para todo el local.

**Dónde brilla**: integridad de precios de `place_order` (único flujo de la plataforma que re-resuelve precios server-side contra catálogo), kanban de cocina con stale-warning, filtro de alérgenos, FAQs post-`95f758f3` honestas. **Dónde se cae**: el circuito operativo del pedido está cortado en la última milla (notificación) y en la primera (catálogo vacío + checklist que desvía). **Dónde miente**: ETA fija, moneda, promociones prometidas en el alta, y la etiqueta "Reservas" de un embudo que los pedidos jamás mueven.

## 4. Huecos finos

| # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **Pedido entra y nadie se entera**: `food_order.created`/`food_order.cancelled` emitidos con 0 listeners (grep `apps/`: solo la emisión, `ai-tool-executor.service.ts:2157,2904`); sin campana TopBar, sin email/SMS, sin sonido; el kanban refresca 15 s SOLO si está abierto | **Alta** — mata la propuesta de valor central | grep `food_order.created` = 1 hit; `TopBar.tsx` sin categoría pedidos | Listener → email a admin+supervisores + WS + chime en el kanban; el patrón exacto ya existe en `service-request.listener.ts` (emergencias de hogar, `5c2581db`) | S |
| 2 | **Promociones inalcanzables** (patrón gimnasios: existe e inalcanzable): tabla+service+REST+tool IA+métodos `api.ts:1565-1570` y **cero llamadores de UI** (grep `createMenuPromotion` en `apps/dashboard/src/app`: 0) | **Alta** — objetivo del alta "Enviar ofertas" incumplible; `get_promotions` siempre vacío | `menu/page.tsx` sin promociones; grep dashboard | Tab "Promociones" en `/admin/menu` sobre los 3 endpoints existentes | S |
| 3 | **Checklist desvía la activación #1**: paso `addKnowledgeBase` rotulado "Carga tu menú y horarios" para restaurantes (`es.json:6040`) apunta a `/admin/knowledge` (`OnboardingChecklist.tsx:29`); no existe paso que lleve a `/admin/menu`, y `place_order` depende de `menu_items` | **Alta** — activación del caso de uso central librada al azar | `OnboardingChecklist.tsx:24-34`; `ai-tool-executor.service.ts:2129-2132` | Paso vertical (o href por-vertical) → `/admin/menu` con check `menuItems > 0`; el aggregator ya cuenta menuItems | S |
| 4 | **Moneda del pedido siempre COP**: el INSERT de `createOrder` no incluye `currency` (`restaurants.service.ts:322-332`) → default de schema 'COP' (`tenant-schema.sql:2038`); `placeOrder` la devuelve al cliente (`:2167`) aunque los items estén en MXN/ARS | Media — rompe MX/AR/PE, mercado objetivo declarado | Código citado | Heredar currency del primer item resuelto (ya está en `priceMap`) o de business-info | XS |
| 5 | **`kitchenInProgress` cuenta los entregados**: `status NOT IN ('completed','cancelled')` con terminal real `delivered` (`vertical-analytics.service.ts:267`) — métrica monótonamente creciente | Baja (métrica super_admin) | Código citado | `NOT IN ('delivered','cancelled')` | XS |
| 6 | **Estados fantasma en cancelación**: handler acepta `['received','confirmed','pending']` (`:2890`) — dos no existen; la descripción del tool dice "pending or confirmed" sin nombrar `received` (`restaurants-tools.ts:99`) → el LLM puede negarse a cancelar un pedido cancelable sin llamar al tool | Media-baja | Código citado | Alinear lista y descripción al dominio real (`received`) | XS |
| 7 | **`tpl_restaurante_reservas` sin `tools.restaurants`** (`persona.service.ts:1384`): un segundo agente creado desde el editor con esa plantilla promete "muestra el menú" en su descripción y no puede llamar `get_menu` — espejo exacto del bug de delivery que `b9bd6332` arregló; el default lo salva solo porque el bootstrap lo parchea (`verticals.service.ts:998-1021`); mitigado por el toggle manual del editor (`CapabilitiesSection.tsx:30`) | Media-baja | Código citado | 1 línea: `restaurants: { enabled: true }` en la plantilla | XS |
| 8 | **ETA falsa**: "30-45 minutos"/"15-25" hardcodeadas (`ai-tool-executor.service.ts:2169`); `estimated_delivery_at` jamás se escribe (`tenant-schema.sql:2042`) | Media | Código citado | Calcular MAX(`prep_time_minutes`)+buffer configurable; persistir en la columna que ya existe | S |
| 9 | **dark_kitchen sigue recibiendo la agenda de mesas**: `seedServices`+`seedAvailability` corren para toda la vertical (`verticals.service.ts:49-58`) sin mirar subType → 3 servicios de mesa, slots y KPI "Reservas Hoy" en un negocio sin mesas (la plantilla delivery evita que el AGENTE los ofrezca; el dashboard queda contaminado) | Media | Código citado; `5c2581db` solo cambió la plantilla | Rama 4f-bis: si subType=dark_kitchen, no sembrar servicios/slots (o solo categoría ≠ 'reservas') | XS |
| 10 | **El embudo no ve pedidos**: ninguna transition_rule liga `food_orders`; etapas de reservas para todos los sub-tipos | Media | `vertical-definitions.ts:289-297`; patrón = hallazgo tours | Tipo `order_required` (análogo a `appointment_required`, mismo QW que retail) + etapa "Pedido" para dark_kitchen | S |
| 11 | **Sin cobro**: `payment_status` write-only; sin link MercadoPago en el chat pese a que el competitivo lo lista como gap a construir (`competitive-analysis-2026-q2.md:450,529`) | Media (apuesta, no bug) | Schema `:2040`; ningún escritor | Ver §7 apuesta | M-L |
| 12 | **`createOrder` no atómico**: cabecera + items en loop sin transacción (`restaurants.service.ts:352-374`; PgBouncer transaction-mode impide multi-statement casual); fallo a mitad = pedido `received` incompleto sin compensación | Media-baja (probabilidad baja, costo real) | Código citado | Compensación: si un insert de item falla, marcar el pedido `cancelled` + nota (patrón del fix de tours `e4f67c94`) | S |
| 13 | **Sin import de menú**: `menu/page.tsx` crea items de a uno; sin CSV ni foto-de-carta→items | Media-baja | `menu/page.tsx:360-410` | Import CSV mínimo (patrón bulk-import de KB ya existente) | S-M |
| 14 | Sidebar: `inventory`/`orders` declarados para restaurantes y ocultos por `hiddenItems` — config muerta en conflicto | Baja | `AppSidebar.tsx:139-140` vs `vertical-definitions.ts:320` | Quitar `restaurantes` de esas dos filas | XS |
| 15 | **Toast sync con currency 'USD' fija** (`vertical-integrations.service.ts:254`) + solo-lectura + sin re-sync | Baja hoy (0 tenants conectados) | Código citado | Currency del config; decisión POS LatAm antes de invertir más (§5) | XS |
| 16 | **Sin notificación proactiva de estado al comensal**: avanzar el kanban no dispara mensaje ("tu pedido salió") — el cliente debe preguntar | Media | `updateOrderStatus` (`restaurants.service.ts:379-389`) sin eventos ni outbound | Emitir `food_order.status_changed` → plantilla WA vía OutboundQueue (ventana 24h casi siempre abierta: el pedido acaba de ocurrir) | M |
| 17 | **partySize/capacidad** (transversal F1, no re-descubierto): sin `max_concurrent` en la ruta de chat, techo ~8 reservas/día por local; `services.max_concurrent` existe y la ruta pública lo respeta | Alta para reservas, secundaria para el rubro (§5) | Auditoría §5.1; grep partySize | F1 (S) + preguntar "¿para cuántos?" en el flow (los 2 servicios por tamaño ya segmentan) | S (F1) |

## 5. Lo que esta industria necesita y no tenemos

**La mesa de entrada del rubro es el PEDIDO, no la reserva.** Es la lectura consistente de nuestro research: el encuadre de la oportunidad es "WhatsApp ordering… endemic" fuera de Rappi/iFood (`market-research-latam.md:110`), las listas país por país repiten "food delivery" (Tegucigalpa `:138`, Managua `:166`, Caracas `:255`, Lima `:283`, Buenos Aires `:322`, dark kitchens fuera del ecosistema iFood en Brasil `:363`), y el AOV de $45 por WhatsApp (`:116`) es de pedidos. La reserva con partySize importa para casual dining — y la especificó nuestra propia estrategia (`vertical-strategy.md:63-64`: `make_reservation(date, time, guests)`, `check_table_availability(date, time, guests)` — nunca construidas tal cual) — pero el booking_fit 1 de la matriz castiga a la vertical por su caso secundario. Con F1 (`max_concurrent`) + los 3 servicios por tamaño, la reserva queda "suficiente" sin tocar el motor; mesas reales (floor plan, turnos, waitlist) son fase posterior y solo para el segmento mantel-largo.

**Mesa de entrada (sin esto no somos creíbles):**
1. **Circuito de pedido cerrado**: notificación al negocio (§4.1) + chime en cocina + estado proactivo al comensal (§4.16). Es lo que el statu quo (WhatsApp manual) hace por defecto: el dueño VE el mensaje. Hoy nuestra automatización lo deja ciego.
2. **Catálogo activable en minutos**: checklist → `/admin/menu` (§4.3) + import CSV (§4.13). El research dice que la WTP es 5/10: cada minuto de fricción de activación pesa doble.
3. **Promociones operables** (§4.2): el rubro vive de "martes 2x1" y happy hour; el motor runtime ya filtra por día/hora — falta solo la pantalla.
4. **Zonas y costo de envío**: la FAQ semilla promete "dime tu dirección y te confirmo si llegamos" (`vertical-definitions.ts:301`) pero no hay dato de zonas en ningún lado y `delivery_fee` llega siempre 0 desde la ruta IA (`placeOrder` no lo pasa; `createOrder` default 0, `restaurants.service.ts:316`). Config mínima de zonas/tarifa + inyección al prompt o tool `check_delivery_zone`.

**Diferenciadores (con base ya construida):**
- **Cobro en el chat**: link MercadoPago al confirmar pedido — el competitivo lo marca como gap vs Chatfuel/Yalo (`competitive-analysis-2026-q2.md:450`) y como jugada catálogo+checkout (`:529`); Podium valida payment-at-booking (`:418`), útil también como seña de "Evento privado". La infraestructura MP ya existe en billing.
- **Push al POS**: la tesis del competitivo es integrar, no profundizar (`:404`), y para Toast la integración valiosa es "toma de pedidos conversacional → POS" (`:410`, nicho caliente: Kickcall, Hostie). **Pero antes hay que validar el POS de LatAm**: Toast no tiene presencia relevante declarada en nuestros docs y el rubro local (Fudo, Siigo POS, Loyverse — candidatos a validar, no relevados) puede ser la mesa de entrada real de integraciones, junto con la pregunta de si el canal de pedidos a integrar es el POS o las plataformas (Rappi/PedidosYa). Nuestro research no responde esto (§8).
- **Reviews Google con IA** (T3.23, ya construido): el rubro más review-dependiente del catálogo; el competitivo la llama "el ancla de retención" (`:419`). Venderla como parte del pitch restaurantero es gratis.
- **Atribución CTWA** (T3.22, ya construido): ads de comida → WhatsApp → pedido medido. Ningún ajuste de código; solo GTM.

## 6. Competencia del rubro

Nuestros docs NO nombran un dueño del vertical restaurantes en LatAm messaging — ninguno de los ~40 competidores del análisis Q2 se posiciona restaurant-first. Lo que sí dicen:

- **El especialista global es Toast** (POS/KDS/inventario/payroll) y el movimiento correcto contra especialistas es "thin vertical, deep horizontal": integrarse, no replicar (`competitive-analysis-2026-q2.md:402-413`). El nicho caliente alrededor de Toast es la toma de pedidos conversacional que EMPUJA al POS (Kickcall, Hostie — `:410`), es decir: exactamente el lado que a nuestro `place_order` le falta.
- **El competidor operativo real es el statu quo + los marketplaces**: el research encuadra la oportunidad en los restaurantes que operan por WhatsApp manual fuera de Rappi/iFood (`market-research-latam.md:110`) — el pitch natural es canal directo sin comisión de marketplace, con la salvedad de que esa comparación de comisiones no está cuantificada en nuestros docs.
- **Los genéricos con checkout conversacional** (Chatfuel, Yalo con WhatsApp Pay/carrito — `competitive-analysis-2026-q2.md:450,529`) pueden armar un flujo de pedidos, pero sin dominio: sin alérgenos, sin kanban de cocina, sin snapshots de precio. Nuestra ventaja declarada — booking determinístico + CRM built-in + multi-agente (`:426-434`) — aplica entera al rubro.
- Del lado hospitality, el addendum del research (hoteles/VR) declara "pursue later" — eso es Segmento hotelero, no restaurantes; no debe leerse como freno a esta vertical.

Quién gana hoy: nadie del cluster D (Yalo/Blip/Leadsales/Whaticket) tiene dominio restaurantero según nuestro relevamiento; la vertical está abierta para quien cierre el circuito pedido→cocina→cobro a precio PYME. La amenaza direccional son los voice/order-bots estilo Kickcall/Hostie bajando de EEUU con integración POS nativa.

## 7. Plan de inversión de ESTA vertical

Coherente con §1: primero cerrar el circuito del pedido (días), después alinear cara-con-motor (semanas), y la apuesta solo si el dueño confirma restaurantes como nicho activo — el research lo pone #6 con WTP baja, así que la inversión grande debe ser barata en soporte y autoservible.

**Quick wins (días, en orden):**
1. Listener de `food_order.created` → email admin+supervisores + evento WS + chime/badge en `/admin/food-orders`. Copiar `service-request.listener.ts` (patrón `5c2581db`). — `apps/api/src/modules/verticals/` o `restaurants/`, `food-orders/page.tsx`. **S**
2. Tab Promociones en `/admin/menu` sobre `createMenuPromotion`/`listMenuPromotions`/`deleteMenuPromotion` ya expuestos (`api.ts:1565-1570`) + i18n 4 idiomas. — `menu/page.tsx`. **S**
3. Checklist: paso "Carga tu menú" → `/admin/menu` con check `menuItems > 0` (el conteo ya existe en el aggregator; exponerlo en setup-status). — `OnboardingChecklist.tsx`, `setup-status` endpoint, 4 JSON. **S**
4. Fixes XS en lote: currency del pedido desde el item resuelto (`restaurants.service.ts:322-348` + `ai-tool-executor.service.ts:2143-2155`); `kitchenInProgress` con `delivered` (`vertical-analytics.service.ts:267`); estados de `cancel_order` + descripción (`:2890`, `restaurants-tools.ts:99`); `tools.restaurants` en `tpl_restaurante_reservas` (`persona.service.ts:1384`); sidebar sin inventory/orders para restaurantes (`AppSidebar.tsx:139-140`); dark_kitchen sin seed de servicios de mesa (`verticals.service.ts:49-58`). **XS×6**

**Mediano (semanas):**
5. ETA real: MAX(`prep_time_minutes`)+buffer configurable, persistida en `estimated_delivery_at`, devuelta por place_order/check_order_status. **S**
6. Notificación proactiva de estado al comensal: `food_order.status_changed` desde `updateOrderStatus` → OutboundQueue (plantilla utility). — `restaurants.service.ts`, listener nuevo, plantillas. **M**
7. Embudo de pedidos: transition `order_required` + etapa "Pedido" para el pipeline de dark_kitchen/comida_rapida (ramificar `seedPipelineStages` por subType). — `pipeline.service.ts:877-886` (case nuevo), `vertical-definitions.ts`. **S-M**
8. KPIs de pedidos en el panel tenant (pedidosHoy, gmvSemana) — el shape de `dashboard.kpis` ya existe; los conteos ya están escritos en el aggregator. **S**
9. Zonas/tarifas de envío: config simple (lista de zonas + fee) + inyección al contexto del agente + `deliveryFee` en placeOrder. **M**
10. F1 capacidad (`max_concurrent` en ruta de chat — decisión transversal ya pedida al dueño): con eso, "Reserva mesa 2-4" con max_concurrent=N son N mesas simuladas y el flow pregunta personas eligiendo servicio. **S (una vez aprobada F1)**
11. Import CSV de menú (patrón bulk-import de KB). **S-M**

**Apuesta (solo si se decide invertir en el nicho):**
12. **Cobro conversacional**: link MercadoPago single-payment al confirmar pedido (la pieza MP de pago único ya existe en sms-checkout), `payment_status` vivo, conciliación en el kanban. Convierte la vertical en la única "pedido WhatsApp con cobro y cocina" a precio PYME del cluster D. **L**
13. **Survey POS/delivery LatAm y UN puente**: validar Fudo/Siigo/Loyverse/Rappi API (nada de esto está relevado en docs) y construir un solo conector de ESCRITURA de pedidos donde esté la masa; recalibrar la ficha de Toast (currency, re-sync) o degradarla honestamente. **M-L (tras research)**
14. **Carta pública QR**: página pública del menú desde `menu_items` (el comentario del schema ya lo insinúa, `tenant-schema.sql:2065-2067`), con deep-link a WhatsApp "pedir esto". Barata y viral en el rubro. **M**

## 8. Qué no se verificó

- **Toast en vivo**: adapter jamás ejercitado con credenciales reales (transversal T3.19); el hallazgo de currency USD es de lectura de código, no de sync real.
- **El mapa POS/delivery de LatAm**: Fudo/Siigo POS/Loyverse/Rappi/PedidosYa **no aparecen en ningún doc del repo** (verificado por grep); la afirmación "Toast no es el POS de LatAm" queda como hipótesis fuerte sin research propio — es exactamente el survey que pide §7.13.
- Runtime real de conversación: el flujo pedido/reserva se auditó por código y contra la ficha de la auditoría, no con un tenant restaurantes en producción (el usuario prueba en prod); en particular no se midió si el LLM se niega a cancelar pedidos `received` por la descripción del tool (§4.6) ni la tasa de acierto del intent "quiero pedir" vs el agendador.
- i18n: se verificó `es.json` (welcome/empty/checklist/objetivos); no se auditaron uno a uno en/pt/fr para los namespaces `foodOrders`/`menu`.
- El comportamiento de `searchMenu` con `category` exacta (ILIKE sin comodines, `restaurants.service.ts:227`) ante categorías con tilde/plural — sospecha de fricción menor, sin probar.
- Si el widget/canales sin teléfono degradan `place_order` (contactId siempre existe vía identity, pero no se siguió esa rama).
- `HelpPanel` de foodOrders (`mediaKey="foodOrders"`): no se verificó que el video/media exista.
