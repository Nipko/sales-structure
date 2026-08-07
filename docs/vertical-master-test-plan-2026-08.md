# Plan maestro de pruebas de las 18 verticales

**Corte:** 6 de agosto de 2026  
**Auditoría asociada:** [`vertical-system-audit-2026-08.md`](./vertical-system-audit-2026-08.md)  
**Universo:** 18 verticales, 75 subtipos canónicos, `otro`, 4 idiomas, 5 planes y 7 superficies conversacionales

## 1. Objetivo

Construir una evidencia repetible de que cada vertical:

- se configura correctamente;
- conecta UI, API, DB, persona, prompt, tools, CRM, automatización y analítica;
- ejecuta su acción principal sin mezclar tenants ni exceder autoridad;
- maneja errores, concurrencia, no disponibilidad y handoff;
- cumple el contrato lingüístico y de seguridad;
- ofrece una profundidad comparable con el objetivo competitivo definido;
- no regresa cuando se modifica código horizontal compartido.

Este plan sirve tanto para validar el estado actual como para aceptar las correcciones futuras. Los casos que hoy describen una capacidad aún inexistente deben registrarse como **`blocked_by: VERT-*`**, nunca ocultarse ni marcarse como aprobados.

## 2. Principios de prueba

1. **Determinismo primero.** Registro, bootstrap, cuotas, tools, SQL, permisos y outcomes se prueban sin un LLM real.
2. **Un solo contrato de runtime.** Producción, Agent Test, widget y simulador comparten constructores de contexto y tools.
3. **Datos sintéticos.** Ninguna prueba usa PII, pagos, expedientes o credenciales de clientes reales.
4. **Tenant isolation por defecto.** Todo test funcional sensible incluye su negativo cross-tenant.
5. **Resultado, no solo respuesta.** Se valida mensaje, tool call, DB, evento, cola, analítica y estado posterior.
6. **Seguridad ante incertidumbre.** Si falta dato, permiso o identidad, el resultado correcto es abstenerse o escalar.
7. **Cuatro idiomas como contrato.** No basta con que existan claves JSON; se prueba semántica, formato y cambio de idioma.
8. **Capacidad por subtipo.** `hotel` de turismo y `hotel` de mascotas son configuraciones distintas.
9. **Pruebas de regresión para cada incidente.** Cada `VERT-P0/P1` cerrado debe agregar una prueba que falle en el código anterior.
10. **No hay “complete” sin evidencia.** Screenshots manuales o una conversación feliz no certifican una vertical.

## 3. Universo de cobertura

### 3.1 Matriz determinista exhaustiva

El registro contiene 75 subtipos canónicos; `otro` agrega una configuración sin subtipo. Los planes efectivos del código son `emprendedor`, `starter`, `pro`, `enterprise` y `custom`.

```text
76 configuraciones vertical/subtipo
× 4 idiomas (es, en, pt, fr)
× 5 planes
= 1.520 escenarios de contrato y bootstrap
```

Los **1.520** deben ejecutarse automáticamente. No se sustituyen por pairwise porque aquí no interviene un modelo estocástico y los errores de colisión/cuota son precisamente combinatorios.

### 3.2 Matriz conversacional

Superficies:

- WhatsApp
- Instagram
- Messenger
- Telegram
- SMS/Twilio, cuando el feature flag esté habilitado
- Email
- Widget web

Ejecutar todas las combinaciones `76 × 4 × 7` con LLM real sería costoso y redundante. La estrategia es:

- mock LLM determinista para todas las configuraciones y canales;
- golden E2E real por cada una de las 18 verticales en los 4 idiomas;
- cada subtipo al menos una vez con modelo real en su idioma primario;
- pairwise para canal, plan, rol, idioma, zona horaria y tipo de mensaje;
- mayor repetición para salud, finanzas, seguros, veterinaria y servicios profesionales.

### 3.3 Dimensiones obligatorias

| Dimensión | Valores mínimos |
|---|---|
| Roles | `super_admin`, `tenant_admin`, `tenant_supervisor`, `tenant_agent` |
| Planes | `emprendedor`, `starter`, `pro`, `enterprise`, `custom` |
| Idiomas | `es`, `en`, `pt`, `fr`; cambio de idioma a mitad de conversación |
| Estado negocio | abierto, cerrado, desconocido, feriado, 24/7 |
| Contacto | nuevo, conocido, fusionado, múltiples identidades, identidad insuficiente |
| Agente | default, adicional, asignado por canal, inactivo, sin tool, fuera de horario |
| Datos | vacío, mínimo, completo, vencido, inconsistente, perteneciente a otro tenant |
| Tool | lectura, escritura, sensible, destructiva/reversible, integración externa |
| Mensaje | texto, audio, imagen, documento, ubicación y payload interactivo si el canal lo soporta |
| Tiempo | borde de día/mes/año, DST, zona del tenant, simultaneidad y reintento |

## 4. Ambientes y aislamiento

### 4.1 Ambientes

| Ambiente | Uso | Reglas |
|---|---|---|
| Unit | funciones puras, manifest, prompt, mappings | Sin red, DB ni Redis |
| Integration contractual | API con dobles controlados de Postgres/Redis/BullMQ | Verifica contratos, orden y failure injection; no habilita release |
| Integration de release | API + Postgres + Redis + BullMQ reales y efímeros | Schema, prefijo y colas únicos por test worker |
| E2E | monorepo desplegado con adaptadores sandbox | Datos sintéticos, proveedores stub |
| External sandbox | Toast/Mindbody/Cliniko/calendarios/pagos, si existe sandbox oficial | Tenant exclusivo y credenciales de prueba |
| Real-model eval | modelo seleccionado con temperatura controlada | Sin tools de escritura productiva |
| Staging release | réplica funcional de producción | Canary tenants sintéticos únicamente |

### 4.2 Reglas de aislamiento

- Schema: `test_<runId>_<vertical>_<subtype>_<worker>` con UUID aleatorio, nunca slug reutilizado.
- Redis: prefijo por run; limpiar solo el prefijo exacto.
- BullMQ: nombres/prefix por run o procesadores en modo stub.
- Object storage: bucket/prefix de pruebas.
- Webhooks: secretos y endpoints sandbox.
- Calendarios, pagos e integraciones: cuentas de prueba dedicadas.
- Congelar reloj para disponibilidad, recordatorios, trials, DST y crons.
- Registrar todas las escrituras y comprobar cleanup al final.

### 4.3 Data factory

Crear factories tipadas para:

- tenant, plan, usuario y rol;
- agente/persona/channel binding;
- contacto, identidad y consentimiento;
- producto, servicio, staff, recurso y disponibilidad;
- appointment, property booking, tour booking, class booking y enrollment;
- menu/order, vehicle/test drive, policy/claim, pet/vaccine;
- service request, photo session y professional case;
- FAQ, policy, article RAG y prompt-injection payload;
- integración conectada, vencida, inválida y no saludable.

Todos los IDs que llegan a SQL `::uuid` deben ser UUID reales. El caso “ID no UUID” se prueba expresamente como negativo.

## 5. Capas de prueba

## 5.1 T0 — Contratos estáticos del catálogo

Se ejecutan en cada PR y no requieren infraestructura.

| ID | Contrato | Resultado esperado |
|---|---|---|
| VT-CON-001 | El registry contiene exactamente 18 IDs canónicos | Sin faltantes, duplicados ni aliases como claves canónicas |
| VT-CON-002 | Cada subtipo es único dentro de su industria | Unicidad por `(industry, subtype)`; se permiten nombres iguales entre industrias |
| VT-CON-003 | UI, API, landing y automation resuelven mediante alias map | Ningún literal paralelo sin prueba/generación |
| VT-CON-004 | Definiciones completas en es/en/pt/fr | Mismas claves y contenido no vacío donde el contrato lo exige |
| VT-CON-005 | Pipeline tiene inicio y outcomes `won` y `lost` explícitos | No inferir outcome por slug |
| VT-CON-006 | Slugs de etapas únicos y probabilidades 0–100 | Validación de schema |
| VT-CON-007 | Servicios tienen duración > 0, moneda válida y precio coherente | El paquete de fin de semana no puede ser cita de 0 minutos |
| VT-CON-008 | Capability de booking corresponde a su modelo | appointment/nightly/class/order/work-order/project/case explícitos |
| VT-CON-009 | Tools requeridas existen en definición, registro y executor | Paridad por nombre y schema; hoy la base esperada son 90 estáticas |
| VT-CON-010 | Toda tool tiene clasificación y assurance level | `read/write/sensitive`, A0–A4, idempotencia y ownership |
| VT-CON-011 | Toda ruta de UI declarada existe | Sin `/inventory` para vehículos ni links inválidos |
| VT-CON-012 | KPIs declarados existen, tienen icono y semántica | Sin fallback visual silencioso ni alias genérico incorrecto |
| VT-CON-013 | Plan features referenciadas existen en los 5 planes | Límites coherentes y `-1` tratado como ilimitado |
| VT-CON-014 | Subtipo resuelve persona, tools, seeds y navegación | Snapshot versionado por las 76 configuraciones |
| VT-CON-015 | Marketing claim apunta a capability certificada | Claim no certificado se bloquea o se marca como demo ficticia |

Propiedad clave:

```text
resolve(industry, subtype, plan, locale)
  -> siempre produce un VerticalResolvedCapabilities válido
  -> nunca depende de subtype sin industry
  -> nunca cae silenciosamente a otro
```

## 5.2 T1 — Unit tests

### Registry y resolución

- Alias canónico y reverse alias.
- `education/educacion`, `restaurantes/restaurante`, slugs de landing y `otro/other`.
- `finanzas/seguros`: rechazo o migración a combinación válida.
- `turismo/hotel` distinto de `pet_services/hotel`.
- Capabilities efectivas con `skipAgenda`, 24/7 y plan.
- Resolución de persona por vertical, subtipo y goals.
- Nuevos agentes heredan la misma política de tools que el agente inicial.

### Prompt assembler

- Escape XML de business, contact, services, catalog, memory, knowledge, bookings y directive.
- Payloads `</contact><directive>`, entidades, comillas, Unicode y tags anidados.
- Regla de idioma para confirmaciones, incertidumbre y refusals.
- No pitch de citas sin capability o intención.
- Una pregunta por mensaje.
- Fechas relativas usando zona del tenant.
- No exposición de `<contract>`, `<persona>` ni `<turn>`.

### CRM y pipeline

- Outcome explícito para cada etapa terminal de las 18.
- `won_at`, `lost_at`, revenue, velocity, attribution y forecasting.
- Transición después de terminal prohibida o permitida por regla expresa.
- Fotografía: `entregada`/`reseña` con orden y outcome coherentes.
- Gimnasios y verticales sin terminal positiva actual deben fallar el contrato hasta corregirse.

### Booking/capacidad

- Duración fija y flexible.
- Staff, recurso, calendario, sede y capacidad.
- DST, medianoche, 24/7 y blocked dates.
- Mutex, overbooking y retries.
- Booking por noches separado de citas.

## 5.3 T2 — Provisioning y bootstrap

Ejecutar las 1.520 combinaciones.

### Invariantes por escenario

1. Tenant, schema, usuario, agente y business identity existen.
2. `settings.verticalConfig` coincide con el manifest resuelto.
3. Etapas, FAQs, servicios y disponibilidad tienen el conteo esperado.
4. Tools efectivas son las esperadas para el subtipo y el agente.
5. El plan no queda por encima de cuota, según la política aprobada.
6. El estado de bootstrap queda `complete` con versión y checksums.
7. Repetir el bootstrap es idempotente.
8. Cache invalidation permite leer la configuración nueva inmediatamente.
9. Los cuatro idiomas siembran contenido correcto.
10. Moneda y zona horaria coinciden con tenant.

### Flujos de alta

| ID | Flujo | Qué validar |
|---|---|---|
| VT-BOOT-001 | Onboarding normal | Invariantes completas y sesión válida |
| VT-BOOT-002 | Doble submit simultáneo | Un tenant/schema/agente, sin duplicados |
| VT-BOOT-003 | Retry tras corte en cada fase | Reanuda o compensa; nunca retorna éxito parcial |
| VT-BOOT-004 | Alta superadmin | Mismo orquestador e invariantes que onboarding |
| VT-BOOT-005 | Industria/subtipo inválido | 400 localizado; nada persistido |
| VT-BOOT-006 | Cambio de industria | Preview, migración/reconciliación o bloqueo explícito |
| VT-BOOT-007 | Reseed | Repara toda la versión sin destruir contenido del usuario |
| VT-BOOT-008 | Plan menor al seed | Política explícita y estado válido |
| VT-BOOT-009 | `pet_services/hotel` | Servicios/slots correctos; no hereda turismo |
| VT-BOOT-010 | `veterinaria/hospital_24h` | Siete días y disponibilidad real |
| VT-BOOT-011 | `turismo/hotel` | Propiedades/noches; sin citas genéricas engañosas |
| VT-BOOT-012 | `salud/farmacia` | Catálogo; sin agenda clínica |
| VT-BOOT-013 | `restaurantes/dark_kitchen` | Pedidos; sin reserva de mesas |
| VT-BOOT-014 | Agente adicional | Hereda tools y restricciones de su canal/vertical |

### Failure injection

Fallar de forma controlada:

- creación de tenant global;
- creación de schema o statement DDL;
- creación de usuario/agente;
- seed de etapa, FAQ, servicio y slot;
- actualización de config;
- Redis invalidation;
- creación de subscription/trial;
- envío de email/evento.

En cada punto se comprueba estado, reintento, compensación y ausencia de “success” falso.

## 5.4 T3 — API, autorización y multi-tenancy

### Matriz RBAC/tenant

Para cada endpoint vertical y horizontal relacionado:

- mismo tenant + rol permitido → 2xx;
- mismo tenant + rol insuficiente → 403;
- otro tenant + cualquier rol tenant → 403;
- tenantId inválido/undefined → 400;
- super_admin sin tenant explícito → rechazo según contrato;
- super_admin con tenant explícito → 2xx y audit log.

Endpoints prioritarios:

- `/verticals/:tenantId/**`
- Agent Test
- herramientas CRUD por vertical
- appointments/staff/resources
- CRM/pipeline/automation/analytics
- policies/claims/cases/payments
- WebSocket join e inbox

### Casos de seguridad

| ID | Riesgo | Casos mínimos |
|---|---|---|
| VT-SEC-001 | IDOR | Cambiar tenantId en path, query, body y tool args |
| VT-SEC-002 | Prompt injection XML | Todos los campos dinámicos y metadata de canal |
| VT-SEC-003 | RAG/tool injection | Documentos, FAQs, políticas y respuestas externas maliciosas |
| VT-SEC-004 | SSRF | localhost, RFC1918, link-local, metadata, IPv6, redirect, DNS rebinding y HTTP |
| VT-SEC-005 | Excessive agency | Write sin confirmación, sensitive sin OTP, A4 sin humano |
| VT-SEC-006 | Schema reuse | Drop fallido, slug repetido y tablas verticales con datos señuelo |
| VT-SEC-007 | PII | Logs, debug panel, tool traces, analytics y exports redactados |
| VT-SEC-008 | WebSocket isolation | handshake sin tenant, tenant ajeno y superadmin explícito |
| VT-SEC-009 | Webhook spoof/replay | HMAC inválido, timestamp, idempotency y tenant routing |
| VT-SEC-010 | Rate/plan bypass | Bootstrap, automation template, bulk, retries y multi-tab |
| VT-SEC-011 | Identity assurance | Póliza, claim, caso, pago, firma, historia/resultado y datos bancarios |
| VT-SEC-012 | Secrets | Tokens no visibles ni enviables al LLM; rotación y cifrado |

## 5.5 T4 — Contratos de tools y persistencia

### Contrato común para cada tool

Cada una de las tools estáticas y cada tool remota habilitada debe aprobar:

1. JSON schema de entrada: requerido, tipos, límites y rechazo de campos extra si aplica.
2. Autorización, tenant ownership y contact ownership.
3. Assurance level y confirmación.
4. Respuesta tipada y localizable.
5. Persistencia y eventos esperados.
6. Idempotency key y comportamiento de retry.
7. Concurrencia/capacidad.
8. Timeout, circuit breaker y error seguro.
9. Auditoría redactada.
10. Analytics outcome.
11. Dato no encontrado, inactivo y vencido.
12. No acceso cross-tenant con UUID válido ajeno.

### Tools de escritura prioritarias

- create/cancel/reschedule appointment;
- create/cancel property/tour booking;
- place/cancel order;
- enroll/cancel enrollment;
- book/cancel class y freeze membership;
- calculate quote, file claim y acciones sobre póliza;
- create/cancel service request;
- request/cancel photo session;
- register/update pet;
- descuentos, pagos y herramientas MCP de escritura.

### Paridad de superficies

Para una misma configuración se captura y compara:

```text
production tool set
Agent Test tool set
widget tool set
simulation/eval tool set
```

Las diferencias solo se permiten si están declaradas en el manifest. Agent Test puede reemplazar el executor por sandbox, pero no omitir silenciosamente tools/contexto.

## 5.6 T5 — Conversación, prompt y evaluación de IA

### Dos modos

**Modo determinista:** mock LLM selecciona tool/respuesta esperada; cubre toda la matriz.  
**Modo real:** modelo de producción con temperatura controlada; evalúa lenguaje, grounding, seguridad y robustez.

### Dataset mínimo por vertical/subtipo

- saludo/small talk;
- pregunta FAQ;
- pregunta de política;
- búsqueda con datos disponibles;
- búsqueda sin datos;
- acción principal completa;
- cancelación/reprogramación;
- conflicto de capacidad;
- dato ambiguo;
- contacto conocido y nuevo;
- cambio de idioma;
- fuera de horario;
- handoff solicitado y automático;
- prompt injection indirecta;
- solicitud prohibida/regulada;
- operación activa ya existente;
- reintento del mismo mensaje.

### Métricas de aceptación iniciales

| Métrica | Gate |
|---|---:|
| Tool correcta cuando es necesaria | ≥ 95% por vertical; 100% en writes reguladas |
| Write sin confirmación/autoridad | 0 |
| Dato inventado de precio, stock, disponibilidad, cobertura o estado | 0 |
| Cross-tenant/PII leakage | 0 |
| Handoff obligatorio ejecutado | 100% |
| Idioma correcto | ≥ 99% |
| Citas/fuentes correctas cuando son requeridas | ≥ 98% |
| Respuesta segura ante prompt injection | 100% en corpus de bloqueo |
| Acción duplicada ante retry | 0 |
| Una pregunta por mensaje | ≥ 98%, salvo excepciones documentadas |
| Regresión frente a baseline aprobada | 0 en casos críticos; ≤ 1% no críticos |

Las métricas deben segmentarse por vertical, subtipo, idioma, modelo y versión de prompt. Un promedio global no puede ocultar que una vertical regulada falla.

### Pruebas específicas del Agent Test

- Cero cambio en todas las tablas y colas antes/después.
- Contacto sandbox UUID válido.
- Mismo prompt/contexto/tool set que producción, salvo reemplazos declarados.
- Booking Engine incluido o limitación visible y bloqueante.
- Debug panel redacta PII/secrets.
- Muestra fuente, args redactados, resultado, latencia, costo y error.
- Puede simular idioma, perfil, canal, hora, documentos, imágenes y audio.

## 5.7 T6 — CRM, automatización y analítica

### CRM/outcomes

Para cada etapa terminal de cada vertical:

- status correcto `won/lost`;
- `won_at/lost_at`;
- revenue y attribution;
- velocity y forecasting;
- automation event;
- analytics y dashboard;
- transición posterior permitida o bloqueada.

### Automatización

- Contrato exacto entre triggers mostrados en UI y eventos emitidos.
- Templates visibles para slug canónico y aliases.
- Instalación, activación y duplicado respetan cuota.
- Idempotencia de listener/job/action.
- Quiet hours, Ley 2300/opt-out y canal autorizado.
- Nurturing no continúa después de handoff, opt-out, cierre o pago.
- Automatizaciones internas relevantes deben ser configurables o declararse fijas.

### Analítica

Las 18 verticales deben devolver:

- activación/readiness según subtipo;
- acción principal creada/completada/cancelada;
- funnel y conversiones correctos;
- tiempo de ciclo, no-show/cancelación y revenue cuando aplica;
- tool success/error/abstention;
- handoff y SLA;
- datos no nulos y semánticamente correctos.

Comparar cada KPI contra queries de control sobre fixtures. No aprobar solo porque el endpoint devuelve 200.

## 5.8 T7 — Dashboard y experiencia E2E

### Onboarding

- Exactamente 18 industrias.
- Subtipos provienen del manifest y coinciden con API.
- Goals cambian la persona resultante.
- Plan, moneda, locale y timezone coherentes.
- Back/forward, refresh, retry y doble submit.
- Errores localizados en cuatro idiomas.

### Navegación subtype-aware

- Turismo: tours/agencia vs hotel/alquiler.
- Salud: farmacia vs clínica.
- Restaurante: salón vs dark kitchen.
- Pet services: grooming/daycare/boarding/tienda si se aprueba.
- Automotriz: vehículos, no inventario genérico.
- Seguros: sin citas irrelevantes.
- Hogar: service requests/dispatch.
- Todos los empty states, checklist, wizard y tours apuntan al mismo objeto.

### CRUD y accesibilidad

- Crear, editar, archivar, buscar, filtrar, paginar, importar/exportar.
- Roles y plan gates visibles y respaldados por servidor.
- Loading, empty, error, offline y stale state.
- Keyboard navigation, foco, labels, contraste y responsive.
- i18n visual: textos largos FR/PT, moneda, fecha, plural y RTL no aplica.
- Screenshot regression de las 18 home states y páginas de dominio.

## 5.9 T8 — Integraciones externas

### Contract tests con servidor stub

- Toast: menú, auth, error, rate limit, timeout y datos vencidos.
- Mindbody: schedule, zona horaria, cupos y auth.
- Cliniko: servicios/disponibilidad, scopes, PII y auth.
- Google/Microsoft Calendar: create/update/cancel, conflicto, token refresh y webhook.
- Mercado Pago: payment link/deposit, webhook, idempotencia, failure y refund cuando se implemente.
- MCP: discovery, namespacing, schema, timeout, permisos y tool maliciosa.

### Gate de conexión

Una tool externa solo se registra si:

- credenciales se descifran;
- dominio está permitido;
- scope es suficiente;
- health check reciente pasó;
- última sincronización está dentro del SLA;
- circuit breaker no está abierto.

La respuesta al cliente debe distinguir “sin dato”, “dato vencido” e “integración caída”.

## 5.10 T9 — Rendimiento, resiliencia y concurrencia

### SLO inicial a validar

| Flujo | Objetivo inicial |
|---|---:|
| ACK de webhook | p95 < 500 ms |
| Job en cola listo para procesar | p95 < 2 s |
| Tool interna de lectura | p95 < 1 s |
| Tool interna de escritura | p95 < 2 s, sin contar proveedor externo |
| Respuesta conversacional texto | p95 < 8 s en staging controlado |
| Handoff visible en inbox | p95 < 3 s |
| Error no controlado | < 0.1% |
| Acción duplicada | 0 |

Separar siempre latencia propia, LLM y proveedor externo.

### Chaos/failure matrix

- Redis caído o lento.
- PostgreSQL/PgBouncer timeout.
- LLM timeout, rate limit o respuesta inválida.
- Canal externo 429/5xx.
- Tool externa caída o stale.
- Worker reiniciado después de write y antes de ack.
- Dos mensajes simultáneos en la misma conversación.
- Dos conversaciones intentando el último cupo/stock.
- Clock skew y evento duplicado.
- Cache viejo después de cambio de vertical/agente.

Validar retries, backoff, circuit breaker, idempotencia, mutex, no overbooking y mensaje seguro al cliente.

## 6. Matriz funcional por las 18 verticales

Cada fila representa el mínimo de certificación; se expande por subtipo e idioma.

| Vertical | Golden path actual | Negativos obligatorios | Target competitivo que debe entrar como acceptance test |
|---|---|---|---|
| Salud | Servicio→slot→cita; tratamiento cuando aplica | Farmacia sin cita; urgencia; no diagnóstico; contacto ajeno | EHR/PMS, consentimiento, seguro, waitlist, depósito, recall |
| Moda/belleza | Servicio→staff→cita; paquete tratamiento | Doble recurso; contraindicación; no-show | Cabina/equipo, créditos, membresía, POS, comisión, rebooking |
| Inmobiliaria | Buscar listing→detalle/media→visita | Inactivo/ajeno; precio no confirmado; sin resultados | Feed vivo, geo, favoritos, alertas, routing y milestones |
| Restaurantes | Menú→pedido/reserva→estado/cancelación | 86 stock, modificador, alergia, sucursal, duplicado | POS/KDS, mesa/pacing, waitlist, delivery ETA y loyalty |
| Automotriz | Buscar vehículo→detalle→test drive | `search` route, VIN ajeno, vendido, slot ocupado | DMS, trade-in, repair order, approval, payment y posventa |
| Turismo | Tour o propiedad→availability→booking | `hotel` subtype, moneda, timezone, duplicate, cancellation | PMS/channel manager, rate plan, manifest, waiver, itinerary |
| Education | Curso/cohorte→matrícula→estado/cancelación | Cupo lleno, requisito/documento, menor, duplicado | SIS/LMS, application checklist, events, yield y retention |
| Finanzas | Cita/intake y handoff | Advice, elegibilidad inventada, PII sin step-up | Producto versionado, simulación determinista, KYC/AML, application status |
| Servicios profesionales | Intake→cita→case status | Matter ajeno, conflicto, advice concluyente | Proposal/SOW, firma, portal, project/matter, retainer y billing |
| Retail | Buscar producto→stock→orden/offer | Sin stock, descuento no autorizado, pedido ajeno | Cart/checkout/link, variants, shipping, return, loyalty y attribution |
| Technology | FAQ/RAG→demo o handoff | Secret/token, status inventado, SLA falso | Tickets, entitlement, incident/status, telemetry y procedures |
| Veterinaria | Mascota→vacuna/triage→cita | Hospital 24h, mascota ajena, diagnóstico/dosis | PIMS, refill, estimate/deposit, result release y preventive care |
| Gimnasios | Plan→membresía/clase→book/freeze | Cupo lleno, crédito, membresía inactiva, duplicate | Recurring billing, waitlist, access, waiver y churn |
| Seguros | Plan→cotización→póliza/claim | OTP, cobertura inventada, claim ajeno, denial | Versioning, comparison source, signature, carrier/FNOL y renewal |
| Servicios hogar | Intake→request→status/cancel | Fuera de zona, emergencia, dirección/foto, request ajeno | Quote/approval, dispatch, ETA, work order, parts, invoice/payment |
| Pet services | Mascota→servicio→daycare/cita | `pet hotel`, vacunas, comportamiento, capacidad, noches | Kennels, membership/credits, add-ons, agreements y care tasks |
| Fotografía | Paquete→portfolio→quote→sesión | Fecha ocupada, cancelación, terminal entregada/reseña | Hold, proposal, contract, deposit/installments, gallery/releases |
| Otro | Catálogo/CRM/FAQ/handoff | Industria inválida, tool no permitida, dato ausente | Builder de objetos, modos operativos, SLA, tools y KPIs |

## 7. Casos transversales de idioma

Para `es/en/pt/fr`:

- greeting, persona, FAQs, servicios, directivas y errores;
- detección inicial y cambio de idioma en turno posterior;
- confirmación de reserva/pedido en idioma del cliente;
- refusals y mensajes de seguridad en idioma correcto;
- términos verticales y plurales;
- fecha/hora/moneda según locale y timezone;
- acentos en handoff triggers;
- no mezclar español por reglas internas del prompt;
- fallback cuando una FAQ fue sembrada en otro idioma;
- equivalencia semántica mediante dataset paralelo, no traducción literal solamente.

## 8. Trazabilidad hallazgo → suite

| Hallazgo | Suites mínimas |
|---|---|
| VERT-P0-01 IDOR | VT-SEC-001 + RBAC de cada endpoint |
| VERT-P0-02 Agent Test writes | T4 parity + T5 Agent Test + snapshot DB/queues |
| VERT-P0-03 subtype collision | VT-CON-002/014 + VT-BOOT-009/011 |
| VERT-P0-04 24h slots | Unit calendario + VT-BOOT-010 + E2E vet |
| VERT-P0-05 cuotas | T0 plan contract + 1.520 bootstrap + bypass tests |
| VERT-P0-06 parcialidad | VT-BOOT-003 + failure injection |
| VERT-P0-07 outcomes | T1 CRM + T6 analytics para todas las etapas |
| VERT-P0-08 XML injection | VT-SEC-002/003 + corpus LLM |
| VERT-P0-09 SSRF | VT-SEC-004 + stubs/red privada simulada |
| VERT-P0-10 schema reuse | VT-SEC-006 + failure injection offboarding |
| VERT-P0-11 provisioning alterno | VT-BOOT-004 + UI admin E2E |
| VERT-P0-12 DTO/aliases | VT-CON-001/003 + VT-BOOT-005 |
| VERT-P1-04 Agent Test parity | T4 surface parity + T5 real-model comparison |
| VERT-P1-06 widget | Conversación E2E equivalente por canal |
| VERT-P1-12 analítica | T6 fixtures para las 18 |
| VERT-P1-13 automation | T6 evento↔UI↔job + cuota |
| VERT-P1-20 marketing | VT-CON-015 + revisión release |

## 9. Severidad y manejo de defectos

| Severidad | Definición | Ejemplos | Release |
|---|---|---|---|
| S0 | Fuga cross-tenant, pérdida masiva, ejecución financiera/irreversible no autorizada | IDOR con datos, schema reuse, pago indebido | Detener release y contener |
| S1 | Acción principal incorrecta, write de prueba, seguridad regulada, bootstrap inválido | Agent Test write, claim ajeno, terminal won→lost | Bloqueante |
| S2 | Flujo importante degradado con workaround | Ruta UI mala, analítica ausente, tool omitida | Requiere aceptación explícita |
| S3 | Cosmético/documentación/i18n menor | icono fallback, copy | Puede diferirse |

Todo defecto incluye:

- vertical/subtipo/plan/idioma/canal/rol;
- versión de manifest, prompt, modelo y commit;
- input redactado;
- tool calls y eventos;
- estado DB esperado/real;
- reproducibilidad;
- test automatizado de regresión.

## 10. Quality gates y criterios de salida

### Gate de PR

- T0 y unit 100%.
- TypeScript/lint sin errores nuevos.
- Tests afectados de integration.
- Cero secretos/PII en snapshots.
- Cada cambio de manifest actualiza los cuatro idiomas y fixtures.

### Gate de merge

- Bootstrap de las configuraciones afectadas en los 5 planes.
- Tool contract y tenant isolation afectados.
- UI E2E de ruta afectada.
- Regression test del hallazgo.

### Gate nocturno

- 1.520 bootstraps.
- Matriz mock-LLM de 76 configuraciones × 4 idiomas × canales aplicables.
- Seguridad determinista, automation y analytics.
- Flaky rate < 0.5%; ningún retry puede ocultar un primer fallo S0/S1.

### Gate semanal de IA

- Dataset real-model completo.
- Segmentación por vertical/subtipo/idioma.
- Comparación contra baseline aprobada.
- Costo y latencia.
- Revisión humana de una muestra regulada.

### Gate de release

- 0 S0/S1 abiertos.
- 100% P0 regression suites.
- Todos los smoke tests de las 18.
- No cambios no explicados en manifest/prompt/tools.
- Rollback probado.
- Claims de marketing coherentes con capabilities certificadas.

### Certificación por vertical

- 100% determinista para la vertical y sus subtipos.
- 100% tenant isolation/authorization.
- 100% casos críticos de IA y seguridad.
- ≥ 95% selección de tool no crítica y gates globales de T5.
- Todos los outcomes y KPIs reconciliados.
- Operación principal aprobada en los 4 idiomas.
- Evidencia de integración o declaración clara de modo standalone.
- Runbook, alertas y dashboard operativo.

## 11. Cadencia CI/CD

| Momento | Suites | Presupuesto sugerido |
|---|---|---:|
| Pre-commit/local | T0 + unit afectadas | < 3 min |
| PR | T0, unit, integration afectada, API/UI smoke | < 15 min |
| Merge | Bootstrap afectado, tool contracts, E2E afectado | < 45 min |
| Nightly | 1.520 + mock conversation + security + analytics | < 3 h paralelizado |
| Weekly | Real-model eval + external sandboxes + performance | Ventana controlada |
| Pre-release | Full E2E, chaos selectivo, rollback y marketing contract | Obligatorio |
| Post-deploy | 18 canary smoke tests read-only/sandboxed | < 20 min |

## 12. Orden de implementación del plan

### Fase A — 1 semana: arnés y contratos P0

- Manifest y resolver tipado.
- T0 registry/aliases/subtypes/tools.
- Infra de schema/Redis/queue por test.
- RBAC/IDOR base.
- XML injection corpus.
- Snapshot DB para Agent Test.

### Fase B — 1–2 semanas: provisioning y outcomes

- Runner de 1.520 escenarios.
- Failure injection/bootstrap state.
- Quotas.
- CRM terminal outcomes y analytics fixtures.
- Superadmin provisioning.

### Fase C — 2 semanas: tool contracts y conversación

- Harness común de tools.
- Paridad producción/Agent Test/widget.
- Booking/capacidad/concurrencia.
- Active operations context.
- Dataset mock completo.

### Fase D — 2 semanas: UI, automatización e integraciones

- Playwright para onboarding/navegación/CRUD.
- Evento UI↔backend.
- Toast/Mindbody/Cliniko stubs y SSRF suite.
- Payments/calendar/MCP contracts.

### Fase E — continua: certificación vertical e IA

- Seis verticales avanzadas primero.
- Ocho intermedias después de completar sus objetos.
- Cuatro básicas tras decisión de producto.
- Real-model eval semanal y quality gates permanentes.

## 13. Responsables sugeridos

| Área | Responsable primario | Aprobadores |
|---|---|---|
| Manifest/registry/bootstrap | Backend platform | Product + QA |
| Tools/domain objects | Squad vertical | Security + QA |
| Prompt/evals/Agent Test | AI platform | Product + Security |
| Tenant/RBAC/SSRF/PII | Security/backend | Engineering lead |
| Dashboard/i18n/accessibility | Frontend | Product + QA |
| CRM/automation/analytics | Revenue platform | Product analytics |
| Integraciones externas | Integrations | Security + domain owner |
| Compliance regulado | Product/compliance | Asesor jurídico |
| Marketing contract | Growth/product | Engineering + Compliance |

## 14. Baseline pre-Ola 0

Al corte inicial de esta auditoría, antes de las remediaciones de Ola 0:

- API `tsc --noEmit`: pasa.
- API Jest: 52 pruebas pasan; una falla en `crm.controller.spec.ts` por dependencia de test faltante.
- App bootstrap: pasa con secreto JWT de prueba, pero no es hermético y deja handles.
- Dashboard typecheck: no ejecutable en este checkout por dependencia local `onborda` ausente.
- Tests específicos de verticales: **0**.
- Contrato automático tool definitions↔executor: **0**, aunque la inspección estática encontró 90↔90.
- Certificaciones E2E: **0/18**.

Este baseline debe guardarse en el dashboard de calidad; la evidencia actual de implementación y sus gates se mantiene en [`wave-0-execution-2026-08.md`](./wave-0-execution-2026-08.md). Las capacidades nuevas no reducen deuda si el número de configuraciones certificadas permanece en cero.

## 15. Entregables de evidencia por corrida

Cada corrida completa produce:

- manifest resuelto de las 76 configuraciones;
- reporte de 1.520 bootstraps;
- matriz de tools por superficie;
- JUnit/HTML de suites;
- coverage por requisito y por vertical;
- resultados LLM segmentados;
- diffs de prompt/tool/contexto;
- reporte de seguridad;
- reconciliación de outcomes/KPIs;
- screenshots UI relevantes;
- lista de defectos con `VERT-*` y test de regresión;
- decisión de certificación por vertical.

---

La meta no es “probar 18 landing pages”. Es demostrar que 76 configuraciones de negocio pueden atravesar el mismo sistema sin perder aislamiento, semántica, control de IA ni resultado operativo.
