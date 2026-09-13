# E2 — Lecturas, tráfico operativo y captura de entradas

Fecha: 2026-09-07. Alcance: AgentTest, Eval, Simulation y LearningEvaluation, su entrada común `ConversationsService.executeAgentTurn`, motores, capacidades, herramientas y lectores transitivos. Reconciliado contra `5f036d10`; no certifica perfiles ni cambia las condiciones de publicación.

Contexto del núcleo, FAQs/políticas, temporalidad de fixtures, autoridad de fuentes de aprendizaje y Replay ya están integrados. Vehículos y mascotas amplían a quince los writers del adaptador canónico; tres lectores privados/adicionales conservan sus guardas. El capturador RAG dispone de gestor de referencias, reutilización y vencimiento. AgentTest captura la réplica y la comparte con Eval/Simulation/Learning y candidatas; el contexto automático y la herramienta seleccionan esa misma referencia privada. El presupuesto agregado bajo carga y los lectores comerciales restantes siguen pendientes. El capturador piloto de servicios sigue sin conectar y el manifiesto global se conserva completo.

Las pruebas de cada etapa están en [Contexto del núcleo](evaluation-core-context-capture.md), [Conocimiento estructurado](evaluation-structured-knowledge-capture.md), [Temporalidad](evaluation-temporal-context.md), [Réplica RAG](evaluation-knowledge-replica.md), [RAG administrado en el runtime](evaluation-managed-knowledge-runtime.md), [Retención de aprendizaje](learning-evaluation-retention.md), [Replay](simulation-replay-source-authority.md), [Vehículos](vehicle-appointment-consolidation.md) y [Mascotas](pet-command-lifecycle.md). El inventario TypeScript versión 7 describe las fronteras actuales; la evidencia original de la captura piloto se conserva abajo sin sumarla a las tandas posteriores.

## Conclusión y decisión

No es correcto excluir `messages`, `contacts` o `conversations` del manifiesto global todavía. En AgentTest con namespace, el historial del agente y sus operaciones pertenecen a la sesión/fixtures; sin embargo, Simulation selecciona conversaciones reales para construir replays, Learning conserva referencias a fuentes reales, y Eval consume regresiones aprobadas derivadas de conversaciones. Aprendizaje, Replay y regresiones revisadas ya incorporan identidades y guardas específicas. Eso no demuestra por sí solo que todos los lectores transitivos estén aislados ni autoriza retirar las firmas completas.

La frontera propuesta combina **capturas explícitas de lectores de contexto** y **una réplica de datos comerciales**, con fixtures separados para personas y operaciones. La réplica conserva versiones de catálogo, políticas, fuentes y sus relaciones; no copia historial de clientes, credenciales, triggers, referencias a secuencias productivas ni concesiones históricas de permisos. Los puertos que resuelven por `tenantId` deben recibir la captura explícita. Cambiar únicamente `session.schemaName` no los redirige.

Siguen vivas las comprobaciones de borrado/revocación de fuentes, identidad del tenant y del candidato, plan/permisos, conexión que posee un dominio, lease y presupuesto. La evidencia evaluada es histórica; no sustituye la validación canónica de precio, stock, cupo, titularidad o pago al ejecutar una operación real.

La tanda original de esta auditoría implementó sólo el capturador candidato de `list_services`, con lectura MVCC, proyección explícita, hash, expiración y guarda obligatoria al consumir. Lleva `replacesGlobalManifest: false` y no se conecta a AgentTest, releases ni publicación. Demuestra una frontera útil sin declarar terminado el aislamiento de los demás lectores.

## Evidencia reproducible de la tanda original

`evaluation-service-catalog-capture.postgres.spec.ts` usa únicamente PostgreSQL desechable local y dos esquemas con UUID propios; elimina ambos al terminar.

- Un `INSERT` de mensaje operativo ajeno al catálogo hace fallar el `EvaluationRevisionService.assertCurrent` actual con `tenant.messages`.
- La captura del lector `list_services` conserva su hash después de ese mensaje, sin incorporar el texto ni contactos.
- Cambiar precio, anticipo, publicación/actividad o la estructura de `services` invalida la captura. El conjunto vacío también se registra: publicar la primera fila invalida una captura vacía.
- Capturar mientras otra conexión actualiza el precio conserva una sola revisión MVCC; la siguiente comprobación detecta el cambio.
- Configuración del agente, documentos y embeddings siguen invalidando el manifiesto global. No se modifica su exclusión de tablas ni su significado.
- La transacción del capturador rechaza escrituras con PostgreSQL `READ ONLY`; existe un adaptador compatible con Prisma que establece esta propiedad antes de consultar.
- Un consumo de captura falla si la guarda viva informa borrado, si el tenant no coincide, si expira o si se alteran los datos. `withCapturedServiceCatalog` mantiene el fence durante el consumidor, entrega una copia y vuelve a invocar la guarda en cada uso; no hay fallback a lectura fuente.
- Readiness y alojamiento consultan esquemas distintos de verdad en PostgreSQL aunque compartan tenant y, en alojamiento, el mismo ID de propiedad. No se accede a la caché productiva en evaluación.

El contrato `evaluation-reader-inventory.spec.ts` exige inventario exacto de las **62 lecturas ejecutables** y ausencia de duplicados. También contrasta la proyección piloto con columnas y predicado del lector canónico actual. Actualmente `check_availability`, `get_appointment_details` y `list_customer_appointments` son las tres lecturas adicionales del adaptador canónico; quince writers comparten ese adaptador. La tanda original sólo incluía la primera lectura y doce writers. El registro legacy de familias de writers no amplía esta superficie.

Validación de aquella tanda: **10 suites / 121 pruebas aprobadas**, incluidas **11 pruebas PostgreSQL** de esta tanda; TypeScript API sin errores. Se incluyeron regresiones de propiedades, ownership/fallos de Channel Manager, invalidación de caché, readiness, EffectiveCapability y TurnCapabilityComposer. La fixture legacy de Procedure en esta última suite ahora representa su checkpoint transaccional con privacidad; no se modificó la lógica del motor.

## Entradas que ya están congeladas

`AgentEvaluationSnapshot` sella configuración del agente y su versión/hash, revisión de borrador cuando aplica, alcance por canal, definiciones de procedimientos, descriptores MCP revisados, selección de release de aprendizaje, el contexto `contextInputs`, las colecciones `structuredKnowledgeInputs`, la referencia administrada `knowledgeInputs` y los datos `runtimeInputs` (salud saneada de proveedores, plan para routing, gasto capturado y conteos MCP). El manifiesto sella esas capturas junto con los artefactos/routing y dependencias de base de datos.

Una sesión guarda su historia, lenguaje, estado booking/procedure/foco, propuestas y cache temporal propios. Los datos de contacto y conversación enviados a `generateResponse` son sintéticos. El namespace recibe fixtures expresos; Replay y aprendizaje pueden además copiar texto autorizado, con registro previo del lease, linaje y retiro de fuente. Eso no clona contactos reales como fixtures. El inbound que autoriza un comando tiene un ID persistido en `namespace.messages`; ledger, términos, propietarios y resultados de los quince comandos canónicos se verifican ahí.

Congelar `runtimeInputs.planFeatures` no congela toda la capacidad: `EffectiveCapabilityService` y los pagos vuelven a resolver el plan. Congelar el ID/hash de learning tampoco elimina sus lecturas de disponibilidad/revocación. Esas distinciones son deliberadamente visibles en el inventario.

## Fronteras actuales de los lectores

Inventario mantenido como datos en `apps/api/src/modules/evaluation-revision/evaluation-reader-inventory.ts`, sección `EVALUATION_CONTEXT_READS`. “Capturado” no elimina la comprobación viva del manifiesto ni convierte un permiso histórico en autorización para producir efectos.

| Puerto | Dato efectivo y frontera actual | Límite restante |
|---|---|---|
| Identidad, horario, región y vertical del negocio | Entradas privadas selladas; incluyen ausencia explícita, plantilla multilingüe y reglas regionales; el núcleo no relee estos datos por turno | Cambios relevantes siguen invalidando el manifiesto; no captura todos los catálogos ni proveedores |
| Objetos activos | Contacto y objetos del schema elegido; política del agente o fallback del tenant capturado | Estado sintético y catálogo comercial siguen siendo conjuntos distintos |
| Memoria | Hechos/identidades/tombstones del schema elegido; embedding propaga autoridad de fuente | Faltan tablas/fixtures de hechos en el namespace canónico; proveedor/modelo vivos |
| Readiness | Predicados sobre el schema elegido, sin Redis productivo en readonly | Conteos no prueban capacidad de un intervalo concreto ni reemplazan catálogo |
| Plan/capacidades | El routing recibe plan capturado; EffectiveCapability y pagos revalidan plan/overrides vivos | No toda capacidad está congelada; mantener entitlement como guarda viva |
| Dueño del dominio | Binding del tenant fuente y mapeo del schema elegido | La conexión/propiedad y frescura siguen vivas; no asumir autoridad local cuando falla la lectura |
| Pagos | Configuración/plan/estructura disponibles en vivo; secretos sólo internos | Captura saneada pendiente; no certificar settlement por un estado comercial |
| Proveedores/MCP | Salud y descriptores saneados del snapshot; ruta legacy con fallback vivo | Completar capturas de esas rutas; herramientas remotas siguen bloqueadas en sesiones |
| RAG automático/herramienta | Una referencia administrada y sellada selecciona documentos/embeddings/conflictos para ambos caminos | Propiedad, vencimiento y manifiesto vivo; autoridad compuesta por intento y retiro en la transacción de borrado; presupuesto agregado y rendimiento pendientes |
| FAQ/políticas | Colecciones elegibles completas bajo MVCC readonly y recordsets PostgreSQL sellados; ausente distinto de vacío | Manifiesto global sigue vivo; no memoizar sólo las filas ganadoras |
| E-commerce y lecturas locales | SQL sobre schema de sesión | Varias tablas/fixtures aún faltan; vacío y fallo no son equivalentes |
| Estilo aprendido | Release ID/hash congelado, Inbox exacto y fuentes revalidadas por intento y al persistir; footprint acumulado | Null deshabilita aprendizaje; revocación impide fallback con datos viejos y no repite writers; otras salidas diferidas/costo integral pendientes |
| LLM | Router revalida autoridad antes/después de cada intento, incluidos reintentos retirados de los SDK | Pesos, disponibilidad, costos aún no observados y fallos remotos siguen vivos |
| Temporalidad | Fixtures usan fecha capturada, horario efectivo del tenant sobre el agente y zona tenant → agente → región capturada; agenda exige lease y configuración única | OS/DB/proveedores mantienen reloj real para expiración, frescura y autorización |
| Comandos canónicos | Quince writers y tres lectores adicionales en namespace con lease, objetos/ledger/términos propios | Identidad de citas usa precondición synthetic_A2 declarada; no prueba OTP real ni proveedores |
| Eval/QA | Casos y revisiones fuente congelados con guardas por linaje; efectos exactos del namespace | Juez vivo y manifiesto integral; revisión conversacional no es resultado operacional |
| Simulation Replay/baseline | Grant evaluativo por actor, mensajes/versiones exactos, baselines y leases registrados antes de copiar; retiro terminal elimina derivados y bloquea workers atrasados | Guards de fuente en modelos/herramientas/juez; no revierte una solicitud externa ya aceptada ni autoriza aprendizaje automático |
| LearningEvaluation | Selección reservada/release y fuentes por uso/finalización; generación del worker con CAS; registro previo de copias y recuperación de leases vencidos, incluidos tenants inactivos | Evidencia por objeto/ledger/recibo; no toda familia tiene verificador; otras salidas/trazas y calibración pendientes |
| Fence anidado Replay/Learning | Helper privado conserva la misma conexión/transacción sólo para el Prisma/schema activo; evita segundo lock compartido detrás de borrado exclusivo | Rechaza scope cerrado/ajeno; no hace reentrantes comandos ni el adaptador general de Prisma |
| Control operativo | Quota/plan, tenant activo, fuente vigente, lease, presupuesto y ownership de cola | Guardas vivas obligatorias; una captura no concede autoridad futura |

Los lectores de claves LLM consultan `platform_settings` y variables del proceso; la firma actual del router registra proveedor configurado/model registry/cadenas, no los pesos remotos ni todas las condiciones de fallo. Las llamadas en modo readonly no escriben afinidad, breaker ni trazas de cliente, pero el uso de proveedores sí consume cuota/coste operativo. El presupuesto no debe congelarse como permiso ilimitado.

El DTO de AgentTest sólo entra con texto. Procesamiento de medios y entrega/handoff del pipeline productivo no se alcanzan desde esta entrada; no se presentan como certificados por estas pruebas.

## Huecos de fixtures que impiden confundir evaluación con réplica

La allowlist estructural del namespace todavía no contiene estas dependencias de lectores SQL habilitados: `cm_listings`, `cm_reservations`, `commercial_offers`, `ecommerce_products`, `ical_blocks`, `insurance_plans`, `menu_categories`, `menu_promotions`, `real_estate_listings`, `resource_rental_damages`, `resource_rental_events`, `resource_rental_inspections`, `treatment_plans`, `treatment_sessions`. Mascotas incorporó `pet_vaccinations` y sus recibos al namespace con su propia validación. Memoria ya tiene identidades/tombstones en esa allowlist, pero aún necesita `customer_memory_facts` y fixtures de hechos. FAQ/policies usan las colecciones capturadas; RAG mantiene un capturador/puerto de réplica separado y no debe confundirse con esta allowlist estructural.

Que una tool esté permitida en readonly acredita su ruta de lectura, no que su familia tenga fixtures completos ni casos positivos. La falta de esas tablas puede causar error o degradación; no demuestra que el negocio real carezca del recurso. Añadir nombres a la allowlist requiere revisar FKs, tipos, defaults, índices, guards y fixtures, como se hizo para los comandos canónicos. El clon actual rechaza tipos externos no revisados: el capturador RAG implementa una estrategia pgvector propia revisada y conectada por referencia explícita, que no amplía la allowlist general.

## Defectos de caché cerrados en esta tanda

1. `VerticalReadinessService.evaluate` usaba una clave por tenant y combinación de keys, aunque recibía otro schema. Una evaluación podía consumir el conteo productivo o guardarle el de fixtures durante 120 s. Ahora recibe executionContext del resolver, omite lecturas/escrituras Redis en readonly o `tenant_eval_*`, y la caché productiva incluye schema.
2. `LodgingSourceOfTruth.resolveForProperty` consultaba y escribía caché por tenant/propiedad al evaluar. Ahora no usa Redis en readonly/namespace. `list_properties` y `check_property_availability` propagan contexto a PropertiesService. `ChannelManager.getOwnershipConfig` devuelve sólo provider/syncInterval desde la configuración del tenant; no descifra ni devuelve credenciales. Un tenant inexistente, provider desconocido o configuración no legible no se convierte en autoridad local. Mapeo ausente con PMS externo sigue en estado unknown.

## Publicación CAS y equivalencia de evidencia

`assertSnapshotCurrent` que usa otra conexión no observa necesariamente el snapshot del TX de publicación. Aunque pase antes de actualizar, no es un CAS atómico de esas dependencias.

El CAS del agente puede atar en una sola transacción tenant/lifecycle, agente/version/config hash, revisión base y draft vigente, routing/conexión vinculada, plan/overrides y fila de plan, candidato/revisión humana/hash y selección de release. Las fuentes QA/learning necesitan su propio fence y revisión actual de IDs referenciados. No hace falta bloquear `messages` completos para ese CAS; tampoco debe afirmarse que ese CAS prueba equivalencia factual de toda la evaluación.

Mientras el requisito sea «manifiesto global actual», tráfico real puede invalidar la revisión. No se cambia ese requisito aquí. Una publicación que muestre evaluación histórica/as-of necesita un contrato distinto, explícito y revisado; no puede presentar como vigente un certificado que acaba de invalidarse.

## Orden de integración y pendientes actuales

1. Identidad, horas, región, vertical y conocimiento estructurado ya se integraron con rechazo de capturas incompletas. Completar la captura saneada de plan/capacidad y demás lectores vivos, conservando guardas de fuente y sin fallback silencioso.
2. Crear réplica comercial consistente con FK y tipos revisados. Separar catálogo factual del estado de prueba (stock/cupos/objetos sintéticos). Mantener identidad/PII reales fuera de la réplica salvo origen de replay explícitamente autorizado y revocable.
3. FAQ/policies ya capturan la colección elegible completa; RAG integra gestión, referencias de uso y consumo automático. Medir el coste agregado de captura, integridad, consultas y limpieza bajo carga. Búsqueda vacía y fuente nueva siguen siendo dependencias, no sólo el topK; conservar decisiones de conflictos y query/model/version.
4. Replay y aprendizaje ya vinculan fuentes, hashes, worker/copia y guardas por uso; conservar sus regresiones de revocación, borrado y recuperación al conectar nuevas fuentes o salidas. La reentrancia es exclusiva del fence privado de fuente, no del writer.
5. Instrumentar un test del adaptador completo que rechace cualquier SQL/servicio fuente no declarado durante una ejecución bajo réplica. Verificar los 62 lectores seguros, los tres lectores canónicos adicionales, los quince writers, los motores y los caminos de error/reintento antes de acotar el manifiesto.
6. Sólo entonces sustituir el manifiesto global por dependencias efectivas: configuración, precios/políticas/catálogos, colecciones de fuentes, planes/conexiones, artefactos/model routing y fuentes seleccionadas. Probar tráfico irrelevante concurrente y cada cambio relevante, incluida fuente añadida/revocada, resultado vacío, downgrade, desconexión y borrado durante llamada.

## Matriz completa de herramientas

La siguiente tabla se genera del inventario revisado; `schema` significa fuente en preview y namespace en evaluación canónica. Cada grupo comparte el lector y sus dependencias.

| Herramientas | Lectores | Tablas del lector | Fuera de namespace |
|---|---|---|---|
| `list_services` | AIToolExecutor.listServices | `services` | No, salvo guards comunes |
| `search_products`, `get_product`, `check_stock` | AIToolExecutor.searchProducts/getProduct/checkStock | `products` | No, salvo guards comunes |
| `list_my_catalog_orders`, `get_catalog_order` | CatalogOrderCommands.listOwned/getOwned | `orders`, `order_items`, `contacts`, `customer_memory_erasure` | No, salvo guards comunes |
| `list_active_offers` | AIToolExecutor.listActiveOffers | `commercial_offers`, `courses` | wall_clock |
| `search_faqs` | FaqsService.search/structuredKnowledgeRelation | `faqs` | sealed_eligible_collection, PostgreSQL_recordset_search |
| `get_policy` | PoliciesService.getActive/structuredKnowledgeRelation | `policies` | sealed_eligible_collection, PostgreSQL_recordset_query |
| `search_knowledge_base` | KnowledgeService.tenantHasKnowledge/searchRelevant; KnowledgeConflictService.annotations | `knowledge_documents`, `knowledge_embeddings`, `knowledge_conflict_cases`, `knowledge_conflict_decisions` | operational_source_by_tenantId, required_managed_replica_in_evaluation, live_source_authority, embedding_provider, reranker_router, CURRENT_DATE |
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
