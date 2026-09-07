# E2 — Lecturas, tráfico operativo y captura de entradas

Fecha: 2026-09-07. Alcance: AgentTest, Eval, Simulation y LearningEvaluation, su entrada común `ConversationsService.executeAgentTurn`, motores, capacidades, herramientas y lectores transitivos. Este documento describe el código inspeccionado; no certifica a todos los perfiles ni cambia las condiciones de publicación.

## Conclusión y decisión

No es correcto excluir `messages`, `contacts` o `conversations` del manifiesto global todavía. En AgentTest con namespace, el historial del agente y sus operaciones pertenecen a la sesión/fixtures; sin embargo, Simulation selecciona conversaciones reales para construir replays, Learning conserva referencias a fuentes reales, y Eval consume regresiones aprobadas derivadas de conversaciones. Esas dependencias necesitan una identidad y una guarda propias antes de dejar de firmar las tablas completas.

La frontera propuesta combina **capturas explícitas de lectores de contexto** y **una réplica de datos comerciales**, con fixtures separados para personas y operaciones. La réplica conserva versiones de catálogo, políticas, fuentes y sus relaciones; no copia historial de clientes, credenciales, triggers, referencias a secuencias productivas ni concesiones históricas de permisos. Los puertos que resuelven por `tenantId` deben recibir la captura explícita. Cambiar únicamente `session.schemaName` no los redirige.

Siguen vivas las comprobaciones de borrado/revocación de fuentes, identidad del tenant y del candidato, plan/permisos, conexión que posee un dominio, lease y presupuesto. La evidencia evaluada es histórica; no sustituye la validación canónica de precio, stock, cupo, titularidad o pago al ejecutar una operación real.

En esta tanda se implementa sólo el capturador candidato de `list_services`, con lectura MVCC, proyección explícita, hash, expiración y guarda obligatoria al consumir. Lleva `replacesGlobalManifest: false` y no se conecta a AgentTest, releases ni publicación. Demuestra una frontera útil sin declarar terminado el aislamiento de los demás lectores.

## Evidencia reproducible

`evaluation-service-catalog-capture.postgres.spec.ts` usa únicamente PostgreSQL desechable local y dos esquemas con UUID propios; elimina ambos al terminar.

- Un `INSERT` de mensaje operativo ajeno al catálogo hace fallar el `EvaluationRevisionService.assertCurrent` actual con `tenant.messages`.
- La captura del lector `list_services` conserva su hash después de ese mensaje, sin incorporar el texto ni contactos.
- Cambiar precio, anticipo, publicación/actividad o la estructura de `services` invalida la captura. El conjunto vacío también se registra: publicar la primera fila invalida una captura vacía.
- Capturar mientras otra conexión actualiza el precio conserva una sola revisión MVCC; la siguiente comprobación detecta el cambio.
- Configuración del agente, documentos y embeddings siguen invalidando el manifiesto global. No se modifica su exclusión de tablas ni su significado.
- La transacción del capturador rechaza escrituras con PostgreSQL `READ ONLY`; existe un adaptador compatible con Prisma que establece esta propiedad antes de consultar.
- Un consumo de captura falla si la guarda viva informa borrado, si el tenant no coincide, si expira o si se alteran los datos. `withCapturedServiceCatalog` mantiene el fence durante el consumidor, entrega una copia y vuelve a invocar la guarda en cada uso; no hay fallback a lectura fuente.
- Readiness y alojamiento consultan esquemas distintos de verdad en PostgreSQL aunque compartan tenant y, en alojamiento, el mismo ID de propiedad. No se accede a la caché productiva en evaluación.

El contrato `evaluation-reader-inventory.spec.ts` exige inventario exacto de las **62 lecturas ejecutables** y ausencia de duplicados. También contrasta la proyección piloto con columnas y predicado del lector canónico actual. `check_availability` es una lectura adicional permitida sólo por el adaptador canónico; 12 escritores canónicos comparten ese adaptador. El registro legacy de familias de writers no amplía esta superficie.

Validación final: **10 suites / 121 pruebas aprobadas**, incluidas **11 pruebas PostgreSQL** de esta tanda; TypeScript API sin errores. Se incluyeron regresiones de propiedades, ownership/fallos de Channel Manager, invalidación de caché, readiness, EffectiveCapability y TurnCapabilityComposer. La fixture legacy de Procedure en esta última suite ahora representa su checkpoint transaccional con privacidad; no se modificó la lógica del motor.

## Entradas que ya están congeladas

`AgentEvaluationSnapshot` sella configuración del agente y su versión/hash, revisión de borrador cuando aplica, alcance por canal, definiciones de procedimientos, descriptores MCP revisados, selección de release de aprendizaje y los datos `runtimeInputs` (salud saneada de proveedores, plan para routing, gasto capturado y conteos MCP). El manifiesto sella esas capturas junto con los artefactos/routing y dependencias de base de datos.

Una sesión guarda su historia, lenguaje, estado booking/procedure/foco, propuestas y cache temporal propios. Los datos de contacto y conversación enviados a `generateResponse` son sintéticos. El namespace recibe sólo fixtures expresos. El inbound que autoriza un comando tiene un ID persistido en `namespace.messages`; ledger, términos, propietarios y resultados de los 12 comandos canónicos se verifican ahí.

Congelar `runtimeInputs.planFeatures` no congela toda la capacidad: `EffectiveCapabilityService` y los pagos vuelven a resolver el plan. Congelar el ID/hash de learning tampoco elimina sus lecturas de disponibilidad/revocación. Esas distinciones son deliberadamente visibles en el inventario.

## Lectores fuera de snapshot o namespace

Inventario mantenido como datos en `apps/api/src/modules/evaluation-revision/evaluation-reader-inventory.ts`, sección `EVALUATION_CONTEXT_READS`:

| Puerto | Dato efectivo y frontera actual | Frontera necesaria |
|---|---|---|
| Business hours | `loadTenantBusinessHours` lee `public.tenants.settings.businessHours`; caché local a sesión | Capturar el valor efectivo que prevalece sobre horas del agente |
| Perfil regional | `RegionalProfile.resolve/build` lee identidad/settings del tenant; sin caché en contexto readonly | Captura de perfil/versión de country pack; guarda de configuración actual |
| Identidad del negocio | `BusinessInfo.getPrimaryWithoutWrites` resuelve schema fuente y lee `companies` | Puerto capturado; conservar selección primaria/fallback y orden |
| Vertical/objetivos | Bloque legacy lee tenant settings; `VerticalTurnContext.resolve` → `Verticals.getVerticalConfig` vuelve a leer fuente | Capturar terminología, subtipo y objetivos efectivos, además de config del agente |
| Objetos activos | SQL con schema elegido, limitado al contacto; policy fallback consulta tenant settings | Réplica de catálogo + fixtures de objetos/contactos; policy de captura |
| Memoria | `getMemory/retrieveFacts/resolveOwner` usa schema elegido, `contact_identities`, hechos/tombstone; embedding externo | Fixtures de memoria versionada; clave/versión de embedding y guarda de borrado de fuente cuando exista |
| Readiness | Predicados del registro `READINESS` contra schema elegido | Corregido: en readonly/namespace omite Redis; no sustituir conteos por el digest de `list_services` |
| Plan/capacidades | `EffectiveCapability.resolve` → Throttle lee plan y overrides fuente | Capturar decisión para reproducir; revalidar entitlement vivo por separado |
| Dueño del dominio | `SystemOfRecordBoundary.resolve` lee tenant settings y `cm_listings` del schema elegido | Capturar bindings/mapeos; conexión/propiedad del dominio siguen siendo guardas vivas |
| Pagos disponibles | PaymentOperation → TenantPayments.getRuntimeCapability/getConfig → provider config, secretos internos y heartbeat Redis; store.isAvailable lee estructura fuente | Captura saneada de capacidad, sin secretos; guardas vivas de plan/config/conexión |
| Proveedores/MCP | Composer recibe salud y descriptores sellados; la ruta legacy puede consultar proveedores/bindings en vivo si falta snapshot | Exigir captura completa; MCP y herramientas de proveedores siguen bloqueadas al ejecutar en AgentTest |
| RAG automático y herramienta | Knowledge resuelve schema fuente; documentos + embeddings + annotations de conflictos; embedding y reranker reales | Réplica versionada de documentos/chunks/índices/decisiones; misma búsqueda canónica y scope; no memoizar sólo el topK ganador |
| FAQ y políticas | Faqs.search / Policies.getActive resuelven tenant fuente | Puerto/schema explícito de captura, manteniendo selección activa/versiones |
| E-commerce y demás lecturas locales | Ejecutan SQL sobre schema de sesión | Catálogo replicado o fixtures completos; actualmente varias tablas no existen en namespace |
| Estilo aprendido | ID/hash congelado, pero Learning.readRelease/assertReleaseSourcesAvailable consulta releases/sources/examples/tombstones fuente | Release inmutable + guarda de fuentes específicas por cada uso; null mantiene aprendizaje deshabilitado |
| LLM | Router real para intención, reescritura, respuesta, tools y guardrails; juez/simulador y RAG tienen llamadas adicionales | Congelar política/entrada y observar provider/modelo efectivo; pesos/fallos externos siguen como limitación |
| Reloj | OS/DB `new Date`, `Date.now`, `NOW`, `CURRENT_DATE`; frescura de mirrors y expiraciones | Puerto de reloj para reproducción; nunca reemplazar reloj real de validación de operaciones productivas |
| Eval/QA | `eval_scenarios` y regresiones revisadas fuente; `withReviewedRegressionScenarios` usa guardas por fuente; efectos se leen en namespace | Congelar casos, conservar fence, IDs/hash de revisión y borrado por uso |
| Simulation replay/baseline | Selección de `conversations/messages` fuente; guarda textos con clave `replay:<id>`; baseline lee `simulation_runs` | Captura de origen con IDs/revisión/consentimiento/erasure; hoy no tiene el fence específico de regresiones |
| LearningEvaluation | Sources/holdout/release/evaluationRun/dependencyHash fuente; resultados canónicos en namespace; juez vivo | Captura de casos y release; preservar guards y aislamiento por brazo A/B |
| Control operativo | Quota/plan, fuente QA/learning, tenant activo, namespace lease, Redis/BullMQ budget/ownership | Guardas vivas; una captura no concede autoridad futura |

Los lectores de claves LLM consultan `platform_settings` y variables del proceso; la firma actual del router registra proveedor configurado/model registry/cadenas, no los pesos remotos ni todas las condiciones de fallo. Las llamadas en modo readonly no escriben afinidad, breaker ni trazas de cliente, pero el uso de proveedores sí consume cuota/coste operativo. El presupuesto no debe congelarse como permiso ilimitado.

El DTO de AgentTest sólo entra con texto. Procesamiento de medios y entrega/handoff del pipeline productivo no se alcanzan desde esta entrada; no se presentan como certificados por estas pruebas.

## Huecos de fixtures que impiden confundir evaluación con réplica

La allowlist estructural del namespace todavía no contiene estas dependencias de lectores SQL habilitados: `cm_listings`, `cm_reservations`, `commercial_offers`, `ecommerce_products`, `ical_blocks`, `insurance_plans`, `menu_categories`, `menu_promotions`, `pet_vaccinations`, `real_estate_listings`, `resource_rental_damages`, `resource_rental_events`, `resource_rental_inspections`, `treatment_plans`, `treatment_sessions`. Memoria también necesita sus tablas/fixtures, hoy ausentes de esa allowlist. FAQ/policies/knowledge no pertenecen a esta lista porque sus servicios aún leen fuente.

Que una tool esté permitida en readonly acredita su ruta de lectura, no que su familia tenga fixtures completos ni casos positivos. La falta de esas tablas puede causar error o degradación; no demuestra que el negocio real carezca del recurso. Añadir nombres a la allowlist requiere revisar FKs, tipos, defaults, índices, guards y fixtures, como se hizo para los comandos canónicos. El clon actual rechaza tipos externos no revisados: pgvector necesita una estrategia explícita de réplica/índice.

## Defectos de caché cerrados en esta tanda

1. `VerticalReadinessService.evaluate` usaba una clave por tenant y combinación de keys, aunque recibía otro schema. Una evaluación podía consumir el conteo productivo o guardarle el de fixtures durante 120 s. Ahora recibe executionContext del resolver, omite lecturas/escrituras Redis en readonly o `tenant_eval_*`, y la caché productiva incluye schema.
2. `LodgingSourceOfTruth.resolveForProperty` consultaba y escribía caché por tenant/propiedad al evaluar. Ahora no usa Redis en readonly/namespace. `list_properties` y `check_property_availability` propagan contexto a PropertiesService. `ChannelManager.getOwnershipConfig` devuelve sólo provider/syncInterval desde la configuración del tenant; no descifra ni devuelve credenciales. Un tenant inexistente, provider desconocido o configuración no legible no se convierte en autoridad local. Mapeo ausente con PMS externo sigue en estado unknown.

## Publicación CAS y equivalencia de evidencia

`assertSnapshotCurrent` que usa otra conexión no observa necesariamente el snapshot del TX de publicación. Aunque pase antes de actualizar, no es un CAS atómico de esas dependencias.

El CAS del agente puede atar en una sola transacción tenant/lifecycle, agente/version/config hash, revisión base y draft vigente, routing/conexión vinculada, plan/overrides y fila de plan, candidato/revisión humana/hash y selección de release. Las fuentes QA/learning necesitan su propio fence y revisión actual de IDs referenciados. No hace falta bloquear `messages` completos para ese CAS; tampoco debe afirmarse que ese CAS prueba equivalencia factual de toda la evaluación.

Mientras el requisito sea «manifiesto global actual», tráfico real puede invalidar la revisión. No se cambia ese requisito aquí. Una publicación que muestre evaluación histórica/as-of necesita un contrato distinto, explícito y revisado; no puede presentar como vigente un certificado que acaba de invalidarse.

## Orden de integración propuesto

1. Integrar puertos de identidad, horas, regional, vertical, plan/capacidad saneada y aprendizaje dentro del mismo session/core; rechazar captura incompleta, sin fallback fuente silencioso.
2. Crear réplica comercial consistente con FK y tipos revisados. Separar catálogo factual del estado de prueba (stock/cupos/objetos sintéticos). Mantener identidad/PII reales fuera de la réplica salvo origen de replay explícitamente autorizado y revocable.
3. Integrar RAG/FAQ/policies con scope de captura. Una búsqueda vacía y nuevas fuentes elegibles son dependencias; firmar sólo los IDs recuperados produce falsos negativos. Capturar la colección elegible y decisiones de conflictos, además de query/model/version.
4. Vincular todos los replays a IDs, hashes de contenido y guardas de revocación/borrado por uso. Mantener las guardas de regresiones aprobadas y releases aprendidos.
5. Instrumentar un test del adaptador completo que rechace cualquier SQL/servicio fuente no declarado durante una ejecución bajo réplica. Verificar todos los 62 lectores, los 12 writers, los motores y los caminos de error/reintento antes de acotar el manifiesto.
6. Sólo entonces sustituir el manifiesto global por dependencias efectivas: configuración, precios/políticas/catálogos, colecciones de fuentes, planes/conexiones, artefactos/model routing y fuentes seleccionadas. Probar tráfico irrelevante concurrente y cada cambio relevante, incluida fuente añadida/revocada, resultado vacío, downgrade, desconexión y borrado durante llamada.

## Matriz completa de herramientas

La siguiente tabla se genera del inventario revisado; `schema` significa fuente en preview y namespace en evaluación canónica. Cada grupo comparte el lector y sus dependencias.

| Herramientas | Lectores | Tablas del lector | Fuera de namespace |
|---|---|---|---|
| `list_services` | AIToolExecutor.listServices | `services` | No, salvo guards comunes |
| `search_products`, `get_product`, `check_stock` | AIToolExecutor.searchProducts/getProduct/checkStock | `products` | No, salvo guards comunes |
| `list_my_catalog_orders`, `get_catalog_order` | CatalogOrderCommands.listOwned/getOwned | `orders`, `order_items`, `contacts`, `customer_memory_erasure` | No, salvo guards comunes |
| `list_active_offers` | AIToolExecutor.listActiveOffers | `commercial_offers`, `courses` | wall_clock |
| `search_faqs` | FaqsService.search/readSchema | `faqs` | source_schema_by_tenantId |
| `get_policy` | PoliciesService.getActive | `policies` | source_schema_by_tenantId |
| `search_knowledge_base` | KnowledgeService.tenantHasKnowledge/searchRelevant; KnowledgeConflictService.annotations | `knowledge_documents`, `knowledge_embeddings`, `knowledge_conflict_cases`, `knowledge_conflict_decisions` | source_schema_by_tenantId, embedding_provider, reranker_router, CURRENT_DATE |
| `list_customer_orders`, `get_order_status` | AIToolExecutor.listCustomerOrders/getOrderStatus | `orders` | No, salvo guards comunes |
| `get_customer_context` | AIToolExecutor.getCustomerContext | `contacts`, `leads`, `opportunities` | No, salvo guards comunes |
| `recommend_products` | EcommerceService.searchProductsForAI; AIToolExecutor.searchProducts | `ecommerce_products`, `products` | No, salvo guards comunes |
| `list_properties`, `check_property_availability` | PropertiesService.checkAvailability; LodgingSourceOfTruthService.resolveForProperty | `properties`, `ical_blocks`, `property_bookings`, `cm_reservations`, `cm_listings` | public.tenants.settings.channelManager, readonly_channel_manager_ownership_projection, wall_clock |
| `get_property_details`, `get_check_in_instructions` | PropertiesService.getById; AIToolExecutor.getCheckInInstructions | `properties`, `property_bookings` | No, salvo guards comunes |
| `list_my_property_bookings` | AIToolExecutor.listMyPropertyBookings | `property_bookings`, `properties` | No, salvo guards comunes |
| `search_packages`, `get_package_details`, `check_package_availability` | ToursService.searchPackages/getPackage/listInventory/checkAvailability | `tour_packages`, `tour_inventory` | wall_clock |
| `list_my_tour_bookings` | AIToolExecutor.listMyTourBookings | `tour_bookings`, `tour_packages` | No, salvo guards comunes |
| `get_treatment_plan`, `list_upcoming_sessions` | TreatmentPlansService.summaryForContact | `treatment_plans`, `treatment_sessions` | No, salvo guards comunes |
| `search_listings`, `get_listing_details` | ListingsService.search/getById | `real_estate_listings` | No, salvo guards comunes |
| `search_vehicles`, `get_vehicle_details` | AIToolExecutor.searchVehicles/getVehicleDetails | `vehicles` | No, salvo guards comunes |
| `list_pets_for_contact`, `get_vaccination_status` | PetsService.summaryForContact/getById/listVaccinations | `pets`, `pet_vaccinations` | wall_clock |
| `triage_pet_emergency` | AIToolExecutor.triagePetEmergency | Ninguna (función pura) | No, salvo guards comunes |
| `get_menu`, `get_promotions` | RestaurantsService.searchMenu/listPromotions | `menu_items`, `menu_categories`, `menu_promotions` | wall_clock |
| `check_order_status`, `list_my_orders` | AIToolExecutor.checkOrderStatus/listMyOrders | `food_orders`, `food_order_items` | No, salvo guards comunes |
| `get_membership_plans`, `get_my_membership` | GymsService.listPlans/getMemberByContact | `membership_plans`, `members` | wall_clock |
| `get_class_schedule`, `get_my_class_bookings` | GymsService.upcomingClasses/listContactBookings | `fitness_classes`, `class_bookings` | wall_clock |
| `get_courses`, `get_course_schedule` | EducationService.listCourses/upcomingCohorts | `courses`, `course_cohorts` | wall_clock |
| `list_my_enrollments` | AIToolExecutor.listMyEnrollments | `enrollments`, `course_cohorts`, `courses` | No, salvo guards comunes |
| `get_insurance_plans`, `check_policy_status`, `list_my_claims` | InsuranceService.listPlans/getPolicyByNumber; AIToolExecutor.checkPolicyStatusTool/listMyClaimsTool | `insurance_plans`, `insurance_policies`, `insurance_claims` | No, salvo guards comunes |
| `list_home_services`, `check_home_service_availability` | HomeServicesService.listCapacityServices/checkAvailability; home-service-capacity | `services`, `service_requests` | wall_clock |
| `check_request_status`, `list_my_requests` | HomeServicesService.getRequestById; AIToolExecutor.listMyServiceRequestsTool | `service_requests` | No, salvo guards comunes |
| `list_pet_services`, `list_photo_packages` | AIToolExecutor.listConfiguredServicesTool | `services` | No, salvo guards comunes |
| `check_daycare_availability`, `check_vehicle_rental_availability`, `list_my_vehicle_rentals`, `get_vehicle_rental`, `list_my_pet_boardings`, `get_pet_boarding` | ResourceRentalsService.checkAvailability/list/getById | `services`, `vehicles`, `pets`, `contacts`, `resource_rentals`, `resource_rental_events`, `resource_rental_inspections`, `resource_rental_damages` | wall_clock |
| `list_my_repair_orders`, `get_repair_order` | RepairOrdersService.list/get | `repair_orders`, `customer_vehicles`, `contacts`, `staff_members`, `repair_order_events` | No, salvo guards comunes |
| `check_date_availability` | PhotographyService.checkDateAvailability; photography-date-capacity | `blocked_dates`, `appointments`, `photo_sessions` | wall_clock |
| `get_case_status` | AIToolExecutor.getCaseStatusTool | `opportunities`, `leads`, `pipeline_stages` | No, salvo guards comunes |
