# Auditoría integral de herramientas, datos y agentes por subtipo — agosto de 2026

**Producto:** Parallly / Parallext Engine  
**Corte:** 20 de agosto de 2026  
**Alcance:** 95 tools estáticas, integraciones dinámicas, procedimientos, contexto/RAG, 18 verticales, 75 subtipos y `otro`  
**Naturaleza:** auditoría y diseño; no modifica funcionalidad ni certifica producción  
**Documentos relacionados:** [auditoría de prompts/navegación](./vertical-subtype-prompt-navigation-audit-2026-08.md), [packs de país](./country-language-behavior-packs-latam-2026-08.md) y [plan maestro](./vertical-full-implementation-plan-2026-08.md)

## 1. Dictamen ejecutivo

El núcleo estático de tools es más consistente que la experiencia de producto: existen **95 definiciones, 95 políticas centrales y 95 casos de ejecución**, sin drift nominal. Hay controles útiles de confirmación, idempotencia, ownership, step-up y evidencia antes de afirmar éxito. Sin embargo, esa fortaleza termina en el límite del executor.

No existe todavía un contrato efectivo único que una:

```text
subtipo → intención → capability → tool → plan → readiness
        → fuente viva → contexto entre turnos → writer → menú humano
        → permisos → resultado observable → test/certificación
```

Las tools se publican principalmente por toggles guardados en cada agente. La UI permite activar familias que no corresponden al subtipo; el manifiesto solo aporta defaults a agentes nuevos; los subpermisos suelen ser decorativos; Procedures puede invocar tools apagadas; varias integraciones se anuncian por estar conectadas, sin validar industria, agente o write-back; y el contexto vivo solo conserva cinco dominios.

Dos puntuaciones separan las preguntas correctas:

- **Cohesión del subsistema tool (0–100):** promedio **48,3/100**. Hay 17 perfiles bloqueados, 27 desalineados, 24 parciales, 6 parciales altos y solo 2 utilizables aunque incompletos. Matriz: [`agent-tool-subtype-code-scorecard-2026-08.csv`](./agent-tool-subtype-code-scorecard-2026-08.csv).
- **Cohesión integral estricta (0–5):** promedio **1,66/5**, exigiendo además contexto vivo, cierre, menú humano, plan y SoR. Ningún perfil llega a 4 o 5. Matriz: [`agent-tool-subtype-cohesion-scorecard-2026-08.csv`](./agent-tool-subtype-cohesion-scorecard-2026-08.csv).

Los bloqueos más graves son comprobables:

1. `place_catalog_order` está registrado, pero consulta una columna inexistente y rompe el cierre para farmacia, repuestos, retail, hardware y `otro`.
2. Alquiler de vehículos y boarding de mascotas tienen motor manual robusto, pero ninguna tool del agente.
3. Hotel/alquiler vacacional usa reservas locales mientras Channel Manager/Hostaway mantiene otro registro; el agente puede desconocer reservas externas o crear una que no llegue al PMS.
4. MCP se anuncia al LLM, pero el preflight bloquea toda tool `mcp__*`.
5. OTP no se deriva de las tools A2 publicadas; check-in de alojamiento y vacunación en boarding pueden pedir verificación que el agente no puede completar.
6. Procedures puede saltarse el gating del agente/subtipo y, simultáneamente, no interpola los datos que acaba de recoger.

## 2. Criterio de integración

Una tool solo se considera integrada cuando cumple todos estos puntos:

1. corresponde a una intención soportada del subtipo;
2. está declarada en su contrato y autorizada para ese agente, plan y rol;
3. tiene datos mínimos y readiness comprobados;
4. consulta el sistema de registro correcto, con fuente, frescura y salud visibles;
5. sus argumentos provienen de slots validados, no de defaults inventados por el LLM;
6. aplica confirmación, step-up, ownership e idempotencia según el efecto;
7. el writer persiste y devuelve evidencia canónica de éxito;
8. el objeto queda disponible en turnos siguientes y en el menú humano correcto;
9. error, timeout, duplicado, conflicto y compensación tienen salida reparable;
10. Agent Test/E2E demuestra el mismo camino que producción.

Un toggle, un botón, un nombre en el prompt o un caso en el executor no bastan por separado.

## 3. Inventario real de herramientas

### 3.1 Familias estáticas

| Familia | Cant. | Tools | Operación principal |
|---|---:|---|---|
| Citas | 8 | `list_services`, `check_availability`, `create_appointment`, `cancel_appointment`, `list_customer_appointments`, `send_booking_link`, `reschedule_appointment`, `get_appointment_details` | servicios, disponibilidad, citas y calendario |
| Catálogo | 5 | `search_products`, `get_product`, `check_stock`, `send_product_image`, `place_catalog_order` | productos, stock, imagen y pedido |
| Ofertas | 1 | `list_active_offers` | promociones vigentes |
| Conocimiento | 3 | `search_faqs`, `get_policy`, `search_knowledge_base` | FAQ, política versionada y RAG |
| CRM/pedidos | 2 | `list_customer_orders`, `get_customer_context` | contexto de contacto/lead/oportunidad/pedidos, solo lectura |
| E-commerce | 3 | `recommend_products`, `get_order_status`, `apply_discount` | recomendación, estado y descuento |
| Pagos | 3 | `create_payment_link`, `get_payment_status`, `refund_payment` | checkout y conciliación; refund no se publica al agente |
| Integraciones verticales | 4 | `get_restaurant_menu`, `get_fitness_schedule`, `list_clinic_services`, `check_clinic_availability` | lecturas Toast/Mindbody/Cliniko |
| Alojamientos | 8 | `list_properties`, `check_property_availability`, `get_property_details`, `get_check_in_instructions`, `create_property_booking`, `cancel_property_booking`, `list_my_property_bookings`, `send_property_image` | unidad, disponibilidad, reserva y check-in |
| Tours | 6 | `search_packages`, `get_package_details`, `check_package_availability`, `create_tour_booking`, `cancel_tour_booking`, `list_my_tour_bookings` | paquete/salida/reserva |
| Tratamientos | 2 | `get_treatment_plan`, `list_upcoming_sessions` | planes y sesiones, solo lectura A2 |
| Inmobiliaria | 3 | `search_listings`, `get_listing_details`, `send_listing_image` | búsqueda/detalle/media de listing |
| Vehículos | 4 | `search_vehicles`, `get_vehicle_details`, `send_vehicle_image`, `schedule_test_drive` | inventario y test drive |
| Mascotas | 5 | `list_pets_for_contact`, `register_pet`, `get_vaccination_status`, `triage_pet_emergency`, `update_pet` | ficha, vacunas y triage |
| Restaurantes | 6 | `get_menu`, `get_promotions`, `place_order`, `cancel_order`, `check_order_status`, `list_my_orders` | menú y pedidos de comida |
| Gimnasios | 6 | `get_membership_plans`, `get_class_schedule`, `get_my_membership`, `book_class`, `freeze_membership`, `cancel_class_booking` | membresía y clases |
| Educación | 6 | `get_courses`, `get_course_schedule`, `enroll_student`, `get_placement_test_link`, `cancel_enrollment`, `list_my_enrollments` | curso, prueba e inscripción |
| Seguros/identidad | 8 | `get_insurance_plans`, `calculate_quote`, `check_policy_status`, `file_claim`, `list_my_claims`, `cancel_quote`, `request_identity_code`, `verify_identity_code` | plan, quote, póliza, reclamo y OTP |
| Servicios hogar | 4 | `create_service_request`, `check_request_status`, `list_my_requests`, `cancel_service_request` | solicitud y seguimiento |
| Servicios mascotas | 2 | `list_pet_services`, `check_daycare_availability` | catálogo/capacidad, sin writer |
| Fotografía | 5 | `list_photo_packages`, `send_portfolio`, `check_date_availability`, `request_photo_quote`, `cancel_photo_session` | paquetes, media y cotización |
| Casos profesionales | 1 | `get_case_status` | estado derivado de oportunidad CRM, A2 |

Total: **95**.

### 3.2 Capas dinámicas

- Toast, Mindbody y Cliniko agregan cuatro lecturas cuando la conexión se reporta sana.
- MCP puede agregar N schemas remotos con nombres `mcp__{server}__{tool}`.
- Procedures ejecuta una secuencia determinista que puede incluir una tool estática por nombre.
- Booking Engine puede consumir el grupo Agenda antes del LLM.
- RAG prefetch, memoria, active objects, servicios y catálogo inline alimentan al agente aunque no todos sean tools visibles.

## 4. Qué está bien construido

- La paridad 95/95/95 entre definición, executor y política elimina una clase importante de drift.
- El registro central clasifica efecto, datos, assurance, ownership, idempotencia, external effect, confirmación y aprobación humana.
- Citas revalida disponibilidad/conflictos al escribir.
- Restaurante vuelve a leer el precio canónico y no confía en el precio propuesto por el modelo.
- Envío de media usa URLs persistidas y carruseles reales.
- El pipeline contiene un guard para impedir afirmar una acción de negocio sin writer exitoso.
- Pagos es la familia más cercana al contrato objetivo: el toggle no basta; se cruza en cada turno con plan y proveedor tenant-owned listo.

Estas fortalezas deben conservarse y generalizarse; no justifican certificar los perfiles que las rodean.

## 5. Cómo se nutre hoy el agente

| Fuente | Cómo entra | Cobertura/fortaleza | Brecha |
|---|---|---|---|
| Business Identity | `<turn><business>` | identidad base siempre disponible | país operativo no canónico; procedencia/frescura débiles |
| contacto/CRM | `<turn><contact>` + `get_customer_context` | perfil unificado y contexto comercial | CRM universal es lectura; no crea/califica/mueve/notea/tarea |
| servicios/agenda | inline + tools | booking determinista y objeto cita activo | subrecursos/staff/plan no cohesionados en varios subtipos |
| catálogo local | tools | búsqueda/stock/media | búsqueda puede incluir no disponibles; writer de orden roto |
| ecommerce sincronizado | hasta 12 filas inline + tools | catálogo proveedor disponible | `syncedAt` no llega claramente; descuentos sin proveedor |
| FAQ | tool | búsqueda dedicada | contadores/eventos de lectura pueden confundirse con write técnico |
| Policies | tool | política activa/versionada | no siempre activada ni filtrada por jurisdicción |
| RAG | prefetch + tool | búsqueda híbrida y citas | toggle duplicado; idioma base, no país/jurisdicción; datos del turno no siempre etiquetados como no confiables |
| memoria | `<turn>` | continuidad conversacional | no sustituye estado operativo ni fuente de verdad |
| active objects | `<turn><active_objects>` | cita, reserva de propiedad, tour y pedidos | solo cinco loaders; la mayoría de writes desaparece del contexto estable |
| recent actions | hasta seis eventos | evita alguna repetición | ventana corta; no sustituye object state |
| integraciones verticales | tools dinámicas | lecturas de proveedor | sync diario, staleness parcial y cero write-back |
| MCP | schemas remotos | descubrimiento/test | imposible ejecutar en conversación por política opaque fail-safe |
| Procedures | motor previo al LLM | SOP determinista | no filtra vertical/agente/capability; args recogidos no se interpolan |
| país/locale | señales dispersas | billing y UI parcial | no llega como contrato tipado a intent/tools/RAG |

## 6. Hallazgos P0

### 6.1 Catálogo ofrece productos incorrectos y no puede crear pedidos

`place_catalog_order` consulta `products.is_active`, pero el esquema usa `is_available`. La excepción ocurre antes del bloque que delega en OrdersService. A la vez, `search_products` elimina accidentalmente el predicado de disponibilidad mediante `conds.slice(0,-1)` y puede mostrar productos no disponibles; si no encuentra productos, busca cursos, mezclando dominios.

Impacto canónico: farmacia, repuestos, retail/moda, retail/electrónica, retail/hogar, marketplace, hardware y `otro` —ocho de 76— más cualquier agente que active catálogo manualmente.

Evidencia: `ai-tool-executor.service.ts:619-675,981-1006`; esquema `apps/api/prisma/tenant-schema.sql:403-419`.

### 6.2 Resource Rentals existe, pero el agente no lo conoce

`ResourceRentalsService` ya valida locks, solapamientos, capacidad y escritura para `vehicle_rental` y `pet_boarding`; la web tiene `/admin/resource-rentals`. No existen tool schema, registro ni executor para listar disponibilidad, crear, consultar o cancelar esos alquileres.

Impacto: `automotriz/alquiler`, `pet_services/guarderia` y `pet_services/hotel`. El manifiesto promete la capacidad y el menú muestra el objeto, pero la conversación termina en handoff o usa una tool equivocada.

Evidencia: `resource-rentals.service.ts:15-47,138-175,234-425`; manifest `vertical-capability-manifest.ts:561-565,805-815`.

### 6.3 Alojamiento tiene dos sistemas de registro

El agente consulta/escribe `properties/property_bookings`. Channel Manager mantiene `cm_listings/cm_reservations`, disponibilidad, conflictos y sincronización Hostaway. No hay bridge ni tool de Channel Manager en Conversations. Tampoco hay evidencia de cron que aplique `syncInterval`.

Riesgo: una reserva Hostaway puede ser invisible para el agente; una reserva del agente puede no llegar al PMS; ambas fuentes pueden aceptar el mismo inventario. Esto es un bloqueo comercial para hotel y apartamento turístico, no un detalle de menú.

Evidencia: `channel-manager.service.ts:48-114,153-339`; tools locales `vacation-rental-tools.ts`.

### 6.4 MCP es una affordance falsa

Los schemas se registran para el LLM y el executor contiene ruta MCP, pero preflight clasifica toda tool opaca como no aprobada y la bloquea. La UI debe decir **conectado para inspección, no autorizado para IA**, o no publicar sus tools hasta revisar política, scopes, datos, idempotencia, confirmación y aprobación.

Evidencia: `conversations.service.ts:2374-2381`; `ai-tool-executor.service.ts:226-231`; `tool-execution-control.service.ts:933-942`.

### 6.5 Descuento aparece aunque no puede completarse

`apply_discount` se registra desde `canApplyDiscount`; el único proveedor live soporta enlaces de pago y deriva descuento a handoff. El máximo configurado en la persona solo llega al prompt y no limita el entero 1–30 del backend.

Decisión: retirar toggle/tool hasta tener proveedor y enforcement server-side, o implementar la operación completa. No presentar “handoff automático” como descuento ejecutado.

### 6.6 OTP no se deriva de la política de las tools

Las tools de identidad se agregan solo si están activados insurance, appointments, treatments o professionalServices. Sin embargo, `get_check_in_instructions` y `get_vaccination_status` son A2 en otros perfiles. El control puede iniciar step-up, pero el LLM nunca recibe `verify_identity_code`.

La publicación OTP debe derivarse de **todas las tools efectivas A2**, no de una lista manual de grupos.

### 6.7 Procedures combina bypass y falta de datos

- carga todos los procedimientos activos sin filtrar el campo vertical;
- permite nombre de tool como string libre;
- ejecuta una tool estática aunque esté desactivada para el agente;
- conserva `state.collected`, pero pasa los args literales sin interpolar esas respuestas.

Debe compilarse contra el contrato efectivo del agente, validar schema/entitlement, versionar el plan de tool y renderizar argumentos desde slots tipados.

## 7. Hallazgos P1 de cohesión

### 7.1 Los subpermisos no gobiernan la publicación

`canBook`, `canCancel`, `canCheckStock` y `canRecommend` existen en configuración, pero el runtime publica la familia completa cuando `.enabled=true`. Una plantilla con `canCancel:false` sigue recibiendo `cancel_appointment`. Solo `canApplyDiscount` y `canCreateLinks` tienen efectos parciales/reales.

### 7.2 Manifest, config y agente pueden divergir

- El manifiesto mapea 17 grupos verticales, pero omite familias universales como CRM, Policies, Orders, Offers, E-commerce y Payments.
- `ToolsConfig` compartido omite `vehicles`, aunque dashboard y runtime lo usan.
- Los defaults del manifiesto solo se aplican al crear un agente; los agentes existentes no se reconcilian.
- Un valor explícito de template/agente prevalece, incluso si quedó obsoleto respecto del nuevo subtipo.
- El editor muestra tools especializadas de otras industrias y solo las ordena como “recomendadas”.

Se necesita `effectiveTools`, no inferir autoridad de un JSON editable.

### 7.3 CRM universal no es operacional

Todos los perfiles heredan CRM/pipeline, pero la base vertical solo activa FAQ; el grupo CRM manual ofrece dos lecturas. No hay tools para crear/calificar lead, crear/mover oportunidad, registrar nota/tarea, atributos o consentimiento. El agente conversa sobre ventas sin poder mantener el CRM que el humano usa.

### 7.4 Readiness es advisory

Salvo Agenda, pagos y alguna salud de integración, se puede publicar una familia vacía. No existe puerta equivalente para catálogo/stock, packages/salidas, propiedades/unidades, planes de seguros, clases, cursos, service capacity, fotos o policies. Un agente “habilitado” puede no tener nada que consultar.

### 7.5 Active Objects solo cubre cinco dominios

Se cargan citas, `property_bookings`, `tour_bookings`, orders y food orders. No se cargan membresías/clases, inscripciones, pólizas/reclamos, service requests, pets/vacunas, treatments, photo sessions, professional cases, listings, vehicles/test drives ni resource rentals.

El resultado de una tool puede desaparecer en el siguiente turno, aunque el cliente diga “cámbiala”, “¿en qué quedó?” o “cancela la anterior”.

### 7.6 Integraciones externas son lectura diferida, no operación integrada

- Toast/Mindbody/Cliniko se publican por conexión, no por subtipo/agente/plan.
- Sync es diario y el write-path está congelado.
- Los upserts no siempre eliminan registros desaparecidos.
- Menú/servicios no siempre devuelven `asOf/stale`.
- una clase Mindbody puede reservarse localmente, una cita Cliniko agendarse localmente y un pedido Toast crearse localmente, sin escribir al proveedor.
- si la familia local y externa están activas, aparecen tools semánticamente duplicadas sin prioridad de SoR.

Debe declararse para cada intención: `provider_read/local_write` no es una integración transaccional.

### 7.7 Tool retrieval no entiende el mercado

Nombres/descripciones son mayoritariamente ingleses; los boosts cubren pocos términos españoles. No hay aliases por subtipo o país. Los writers confirmables se fijan y pueden hacer crecer de nuevo el conjunto por encima del límite. Una respuesta como `sí` depende demasiado del estado previo y orden de registro.

El retrieval debe operar sobre intents/aliases normalizados desde el contrato de subtipo y el [country pack](./country-language-behavior-packs-latam-2026-08.md), no sobre overlap superficial.

### 7.8 Confirmación está fragmentada

El guard central es más seguro; Booking/IntentInterpreter acepta una lista más amplia. `listo`, `va`, `eso`, `dale` o `claro` pueden ejecutar Agenda y no confirmar otro writer, o viceversa según flujo. Country pack, efecto de tool y pending state deben alimentar un único clasificador determinista.

### 7.9 Toggles de email sin consumidor

La UI ofrece `emailConfirmations` para casi todas las familias, pero solo hay consumo code-backed en citas, tours y propiedades. El resto debe eliminarse o conectarse a un evento real, plantilla y evidencia de entrega.

### 7.10 Error y cero resultados no se distinguen

`list_customer_orders` devuelve `{orders:[]}` tras una excepción, sin `error`; el outcome guard lo clasifica como éxito. El agente puede decir “no tienes pedidos” cuando la consulta falló. Toda lectura necesita `status`, `source`, `asOf`, `stale`, `errorCode` y `retryable`.

### 7.11 Agent Test no representa producción

El entorno de prueba publica un subconjunto y solo permite ejecutar `create_appointment` entre writers. Omite pagos, OTP, integraciones, MCP, Procedures y casi todas las mutaciones. 24/95 tools ni siquiera aparecen nominalmente en specs; presencia de nombre tampoco equivale a ejecución del handler.

## 8. Resultado 1:1 por subtipo

Las dos matrices CSV contienen las 76 filas explícitas. No se agrupan subtipos hermanos para ocultar diferencias:

1. [`agent-tool-subtype-code-scorecard-2026-08.csv`](./agent-tool-subtype-code-scorecard-2026-08.csv) evalúa el subsistema tools con escala 0–100.
2. [`agent-tool-subtype-cohesion-scorecard-2026-08.csv`](./agent-tool-subtype-cohesion-scorecard-2026-08.csv) exige además active context, writer, menú, SoR y continuidad, con escala 0–5.

### 8.1 Peores bloqueos actuales

| Perfil | Tool score | Razón |
|---|---:|---|
| `finanzas/fintech` | 20 | producto indefinido y solo Agenda |
| `automotriz/alquiler` | 20 | motor Resource Rentals huérfano |
| `fotografia/wedding_planner` | 20 | producto/toolset equivocado |
| `finanzas/creditos` | 22 | sin solicitud/simulación/documentos/underwriting |
| `pet_services/guarderia` | 22 | disponibilidad sin writer y SoR divergente |
| `pet_services/hotel` | 22 | boarding manual no expuesto; OTP inalcanzable |
| `otro` | 23 | asume productos y writer roto |
| `retail/marketplace` | 24 | modelo monovendedor y writer roto |
| `salud/farmacia` | 25 | writer roto y flujo regulado ausente |
| `automotriz/repuestos` | 25 | writer roto y compatibilidad insuficiente |

### 8.2 Mejores bases, aún no certificables

| Perfil | Tool score | Base aprovechable | Condición pendiente |
|---|---:|---|---|
| `restaurantes/comida_rapida` | 72 | menú/pedido/estado/cancelación | POS/KDS/write-back/ETA/pago |
| `restaurantes/dark_kitchen` | 70 | pedido end-to-end local | multibrand/dispatch/POS |
| `automotriz/concesionario` | 68 | inventario/media/test drive | DMS/F&I/trade-in/contexto vehículo |
| `inmobiliaria/venta` | 67 | listing/media/visita | fotos UI, favoritos, docs y objeto activo |
| `turismo/tours` | 67 | catálogo/cupo/reserva/cancelación | operación global/pago/waiver/pickup |
| `inmobiliaria/arriendo` | 66 | búsqueda y visita | aplicación/screening/lease/depósito |

## 9. Contrato objetivo

```ts
type EffectiveAgentCapabilityContractV1 = {
  version: 1;
  tenantId: string;
  agentId: string;
  subtypeProfileId: string;
  countryPackId: string;
  countryPackVersion: string;
  planSnapshotId: string;

  intents: Array<{
    id: string;
    status: "disabled" | "read_only" | "handoff" | "transactional";
    requiredFacts: FactContract[];
    tools: Array<{
      name: string;
      effect: ToolEffect;
      sourceOfTruth: SourceContract;
      requiredPlanFeatures: string[];
      readinessChecks: string[];
      confirmationPolicyId: string;
      assurance: string;
      idempotency: string;
      activeObjectKind?: string;
      humanRoute?: string;
      failurePolicyId: string;
    }>;
  }>;

  resolvedAt: string;
  evidence: ResolutionEvidence[];
};
```

La resolución efectiva debe ser server-side y fail-closed:

```text
SubtypeExperienceProfile
  ∩ agent overrides permitidos
  ∩ runtime plan/quotas
  ∩ provider health/scopes/freshness
  ∩ readiness/data
  ∩ country/jurisdiction policy
  ∩ role/channel restrictions
  = tools publicables y acciones permitidas
```

El dashboard debe visualizar ese resultado, no permitir toggles que el servidor ignorará o que dejarán el agente en un callejón sin salida.

## 10. Orden de intervención

### P0 — integridad y promesa comercial

1. reparar `search_products` y `place_catalog_order`, con pruebas reales de writer;
2. exponer Resource Rentals con list/check/create/get/cancel y active object;
3. elegir SoR único de alojamiento y conectar Channel Manager/Hostaway bidireccionalmente o desactivar el writer local;
4. no publicar MCP hasta aprobar política por tool;
5. retirar `apply_discount` o implementar proveedor + límite server-side;
6. derivar OTP de todas las policies A2 efectivas;
7. compilar Procedures contra agent/subtype/plan y tipar/interpolar slots;
8. unificar clasificador de confirmación con country packs;
9. distinguir `empty` de `error/stale` en todas las lecturas;
10. bloquear perfiles que no puedan cerrar o hacer handoff honesto.

### P1 — coherencia de producto

1. crear registry único de `effectiveTools`;
2. aplicar subpermisos en registro y executor;
3. crear writers CRM universales mínimos;
4. expandir active objects a todos los writers;
5. hacer readiness bloqueante por intención;
6. conectar plan/quotas/rol/canal al mismo resolver;
7. declarar SoR/freshness/write-back por integración;
8. eliminar controles email sin consumidor;
9. hacer subtype/country-aware el retrieval;
10. igualar Agent Test, live y E2E.

### P2 — profundidad por mercado

Completar toolsets por ola, empezando por farmacia, alquiler, boarding, taller, construcción, fintech/créditos, marketplace, aseguradora y wedding planner; luego integrar los SoR especializados definidos en la auditoría competitiva.

## 11. Pruebas obligatorias por cada una de las 76 configuraciones

- snapshot de tools efectivas por plan, agente, país y readiness;
- ninguna tool fuera del manifest/autorización;
- cada intent soportado selecciona la familia correcta con aliases locales;
- lectura feliz, cero resultados, error, stale y provider down se distinguen;
- writer feliz, confirmación ambigua/negativa/corregida, duplicado y conflicto;
- ownership, step-up, aprobación humana e idempotencia;
- active object disponible al siguiente turno;
- cancelación/modificación opera sobre el mismo objeto y SoR;
- menú/deep-link abre ese mismo registro para el rol correcto;
- plan downgrade y cuota agotada producen explicación/handoff, nunca 403 sorpresivo;
- custom prompt/template no puede agregar autoridad;
- integración externa prueba read y write-back por separado;
- E2E en live, Agent Test, web y móvil con la misma resolución;
- trace contiene `profileId`, `countryPack`, `toolPolicy`, `source`, `asOf`, `planSnapshot`, `readiness` y outcome.

## 12. Trazabilidad técnica

| Tema | Fuente principal |
|---|---|
| definiciones de tools | `apps/api/src/modules/conversations/tools/*.ts` |
| registro dinámico al LLM | `conversations.service.ts:2316-2452` |
| executor | `ai-tool-executor.service.ts:103-584` y handlers posteriores |
| políticas centrales | `tool-policy-registry.ts:104-365`; `tool-execution-control.service.ts` |
| capability→grupo | `common/contracts/vertical-capability-tools.ts:8-26` |
| manifest por subtipo | `packages/shared/src/vertical-capability-manifest.ts:391-915` |
| defaults de agente nuevo | `persona/vertical-agent-defaults.util.ts:90-209` |
| active objects | `active-operations-context.service.ts:19-25,110-151,297-316` |
| retrieval | `tool-retrieval.service.ts:14-106` |
| procedures | `procedure-engine.service.ts:57-302`; `procedures.service.ts:293-323` |
| integraciones verticales | `vertical-integrations.service.ts:403-548,805-856` |
| Channel Manager | `channel-manager.service.ts:48-339` |
| Resource Rentals | `resource-rentals.service.ts:15-47,138-425` |
| editor de capabilities | `apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx` |
| Agent Test | `agent-test.service.ts:185-230`; `agent-test-tool-policy.ts:34-75` |

## 13. Condición de certificación

Una vertical no puede cambiar de `implemented_not_certified` ni habilitar marketing profundo porque sus tools “aparezcan”. Se necesita evidencia por subtipo de que el mismo objeto, precio, capacidad, estado y autorización sobreviven todo el recorrido conversacional y son operables por un humano en la interfaz correcta.
