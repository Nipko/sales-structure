/**
 * Reviewed read inventory, 2026-09-07. This is an audit contract, NOT an
 * allowlist, a dependency exclusion list or a replacement for the manifest.
 * `schema` means the explicit selected schema: source in preview, namespace
 * in a canonical evaluation. Fixtures contain no source customer data. Authorized Replay/Learning copies
 * are separately registered and protected by their live source fences.
 */
export const EVALUATION_READER_INVENTORY_VERSION = 6 as const;
export interface EvaluationToolReadGroup {
    tools: readonly string[];
    readers: readonly string[];
    tables: readonly string[];
    outsideNamespace: readonly string[];
}
const group = (tools: string[], readers: string[], tables: string[], outsideNamespace: string[] = []): EvaluationToolReadGroup =>
    ({ tools, readers, tables, outsideNamespace });

/** A contract test requires exact coverage of every currently executable read. */
export const EVALUATION_TOOL_READ_GROUPS: readonly EvaluationToolReadGroup[] = [
    group(['list_services'], ['AIToolExecutor.listServices'], ['services']),
    group(['search_products','get_product','check_stock'], ['AIToolExecutor.searchProducts/getProduct/checkStock'], ['products']),
    group(['list_my_catalog_orders','get_catalog_order'], ['CatalogOrderCommands.listOwned/getOwned'], ['orders','order_items','contacts','customer_memory_erasure']),
    group(['list_active_offers'], ['AIToolExecutor.listActiveOffers'], ['commercial_offers','courses'], ['wall_clock']),
    group(['search_faqs'], ['FaqsService.search/structuredKnowledgeRelation'], ['faqs'], ['sealed_eligible_collection','PostgreSQL_recordset_search']),
    group(['get_policy'], ['PoliciesService.getActive/structuredKnowledgeRelation'], ['policies'], ['sealed_eligible_collection','PostgreSQL_recordset_query']),
    group(['search_knowledge_base'], ['KnowledgeService.tenantHasKnowledge/searchRelevant','KnowledgeConflictService.annotations'],
        ['knowledge_documents','knowledge_embeddings','knowledge_conflict_cases','knowledge_conflict_decisions'],
        ['source_schema_by_tenantId_by_default','optional_owned_knowledge_replica','live_source_authority','embedding_provider','reranker_router','CURRENT_DATE']),
    group(['list_customer_orders','get_order_status'], ['AIToolExecutor.listCustomerOrders/getOrderStatus'], ['orders']),
    group(['get_customer_context'], ['AIToolExecutor.getCustomerContext'], ['contacts','leads','opportunities']),
    group(['recommend_products'], ['EcommerceService.searchProductsForAI','AIToolExecutor.searchProducts'], ['ecommerce_products','products']),
    group(['list_properties','check_property_availability'], ['PropertiesService.checkAvailability','LodgingSourceOfTruthService.resolveForProperty'],
        ['properties','ical_blocks','property_bookings','cm_reservations','cm_listings'], ['public.tenants.settings.channelManager','readonly_channel_manager_ownership_projection','wall_clock']),
    group(['get_property_details','get_check_in_instructions'], ['PropertiesService.getById','AIToolExecutor.getCheckInInstructions'], ['properties','property_bookings']),
    group(['list_my_property_bookings'], ['AIToolExecutor.listMyPropertyBookings'], ['property_bookings','properties']),
    group(['search_packages','get_package_details','check_package_availability'], ['ToursService.searchPackages/getPackage/listInventory/checkAvailability'], ['tour_packages','tour_inventory'], ['wall_clock']),
    group(['list_my_tour_bookings'], ['AIToolExecutor.listMyTourBookings'], ['tour_bookings','tour_packages']),
    group(['get_treatment_plan','list_upcoming_sessions'], ['TreatmentPlansService.summaryForContact'], ['treatment_plans','treatment_sessions']),
    group(['search_listings','get_listing_details'], ['ListingsService.search/getById'], ['real_estate_listings']),
    group(['search_vehicles','get_vehicle_details'], ['AIToolExecutor.searchVehicles/getVehicleDetails'], ['vehicles']),
    group(['list_pets_for_contact','get_vaccination_status'], ['PetsService.summaryForContact/getById/listVaccinations'], ['pets','pet_vaccinations'], ['wall_clock']),
    group(['triage_pet_emergency'], ['AIToolExecutor.triagePetEmergency'], []),
    group(['get_menu','get_promotions'], ['RestaurantsService.searchMenu/listPromotions'], ['menu_items','menu_categories','menu_promotions'], ['wall_clock']),
    group(['check_order_status','list_my_orders'], ['AIToolExecutor.checkOrderStatus/listMyOrders'], ['food_orders','food_order_items']),
    group(['get_membership_plans','get_my_membership'], ['GymsService.listPlans/getMemberByContact'], ['membership_plans','members'], ['wall_clock']),
    group(['get_class_schedule','get_my_class_bookings'], ['GymsService.upcomingClasses/listContactBookings'], ['fitness_classes','class_bookings'], ['wall_clock']),
    group(['get_courses','get_course_schedule'], ['EducationService.listCourses/upcomingCohorts'], ['courses','course_cohorts'], ['wall_clock']),
    group(['list_my_enrollments'], ['AIToolExecutor.listMyEnrollments'], ['enrollments','course_cohorts','courses']),
    group(['get_insurance_plans','check_policy_status','list_my_claims'], ['InsuranceService.listPlans/getPolicyByNumber','AIToolExecutor.checkPolicyStatusTool/listMyClaimsTool'], ['insurance_plans','insurance_policies','insurance_claims']),
    group(['list_home_services','check_home_service_availability'], ['HomeServicesService.listCapacityServices/checkAvailability','home-service-capacity'], ['services','service_requests'], ['wall_clock']),
    group(['check_request_status','list_my_requests'], ['HomeServicesService.getRequestById','AIToolExecutor.listMyServiceRequestsTool'], ['service_requests']),
    group(['list_pet_services','list_photo_packages'], ['AIToolExecutor.listConfiguredServicesTool'], ['services']),
    group(['check_daycare_availability','check_vehicle_rental_availability','list_my_vehicle_rentals','get_vehicle_rental','list_my_pet_boardings','get_pet_boarding'],
        ['ResourceRentalsService.checkAvailability/list/getById'], ['services','vehicles','pets','contacts','resource_rentals','resource_rental_events','resource_rental_inspections','resource_rental_damages'], ['wall_clock']),
    group(['list_my_repair_orders','get_repair_order'], ['RepairOrdersService.list/get'], ['repair_orders','customer_vehicles','contacts','staff_members','repair_order_events']),
    group(['check_date_availability'], ['PhotographyService.checkDateAvailability','photography-date-capacity'], ['blocked_dates','appointments','photo_sessions'], ['wall_clock']),
    group(['get_case_status'], ['AIToolExecutor.getCaseStatusTool'], ['opportunities','leads','pipeline_stages']),
];

export const EVALUATION_CONTEXT_READS = [
    { port: 'snapshot.capture', boundary: 'source_then_sealed', readers: 'Persona.getAgent/readConfigurationRevision; Revision.captureAgentReleaseScope/captureProcedures; Learning.getPublishedReleaseSnapshot; MCP.listPublishableTools; VerticalIntegrations.getAllHealth; Throttle.getPlanFeatures/getLlmSpendUsdCents', sources: 'agent_personas, agent_configuration_revisions, procedures, learning releases/sources/examples/erasure, public.tenants/settings, public.billing_plans, MCP configs/approvals, provider health + Redis spend' },
    { port: 'session.identity_history_state', boundary: 'session_and_namespace', readers: 'executeAgentTurn; AgentTurnSession; loadBookingState/loadToolContext/missionFocus; Procedure.forExecution; rewriteSearchQuery/history', sources: 'synthetic contact/conversation; caller scenario history; session metadata/cache; namespace messages + tool ledger + consent' },
    { port: 'core.business_hours', boundary: 'source_then_sealed', readers: 'Conversations.captureEvaluationContext/loadTenantBusinessHours', sources: 'snapshot.contextInputs.businessHours from public.tenants.settings; explicit absence, no per-turn tenant/cache lookup; global manifest retained' },
    { port: 'core.regional', boundary: 'source_then_sealed', readers: 'RegionalProfile.captureForEvaluation/build; Conversations.generateResponse', sources: 'snapshot.contextInputs.regional from strict tenant read + country packs; country/jurisdiction passed to capability resolver, no regional fallback when both supplied; global manifest retained' },
    { port: 'core.business', boundary: 'source_then_sealed', readers: 'BusinessInfo.captureForEvaluation/getPrimaryWithoutWrites; projectBusinessTurnContext', sources: 'snapshot.contextInputs.business from canonical companies projection; missing column legacy fallback only, no Redis/DDL; global manifest retained' },
    { port: 'core.vertical', boundary: 'source_then_sealed', readers: 'Conversations.captureEvaluationContext; VerticalTurnContext.resolve; Verticals.getVerticalConfig', sources: 'snapshot.contextInputs.vertical in es/en/pt/fr from tenant settings/industry/goals + subtype contracts; readonly bypasses Redis, no legacy per-turn reads; global manifest retained' },
    { port: 'core.active_objects', boundary: 'namespace_plus_sealed_policy', readers: 'ActiveOperationsContext.populateTurnContext/load/resolvePolicyContext; tenantActiveObjectPolicyContext', sources: 'selected schema contacts/owned operational tables; configured agent policy wins, otherwise snapshot.contextInputs.activeObjectPolicy preserves raw tenant industry/subtype including unknown values; no per-turn tenant policy lookup' },
    { port: 'core.memory', boundary: 'namespace_plus_embedding_provider', readers: 'CustomerMemory.getMemory/retrieveFacts/resolveOwner/conflicted facts', sources: 'selected schema customer_memory_facts/customer_memory_erasure/contact_identities; live embedding credentials/model and propagated source authority; canonical namespace still lacks memory fact fixtures' },
    { port: 'capability.plan', boundary: 'source_readonly', readers: 'EffectiveCapability.resolve; Throttle.getPlanFeatures/getTenantPlan; PaymentOperation.getRuntimeCapability', sources: 'public.tenants plan/overrides + billing_plans; snapshot plan used only by core LLM routing, not all capability resolution' },
    { port: 'capability.readiness', boundary: 'namespace_readonly', readers: 'VerticalReadiness.evaluate/countRows', sources: 'READINESS table predicates in selected schema; evaluation bypasses production Redis after this fix' },
    { port: 'capability.ownership', boundary: 'namespace_plus_source', readers: 'SystemOfRecordBoundary.resolve', sources: 'public.tenants.settings provider binding + selected schema cm_listings freshness' },
    { port: 'capability.money', boundary: 'source_readonly', readers: 'PaymentOperation.getRuntimeCapability; TenantPayments.getRuntimeCapability/activeRuntime; TenantPaymentStore.isAvailable', sources: 'public tenant payment provider config (secrets stay server-side), tenant schema payment table existence, billing feature; snapshot does not freeze this result' },
    { port: 'capability.providers_mcp', boundary: 'snapshot_with_live_fallback', readers: 'TurnCapabilityComposer.resolve', sources: 'frozen sanitized health + reviewed MCP descriptors; missing legacy snapshot falls back to live health/bindings/MCP; remote tools are execution-blocked in sessions' },
    { port: 'core.rag', boundary: 'source_plus_external', readers: 'Knowledge.tenantHasKnowledge/searchRelevant; KnowledgeConflict.annotations; generateEmbedding/ensureOpenAI; rerankChunks', sources: 'source documents/embeddings/conflict cases+decisions by default, optional private owned replica read port; propagated live source authority on embedding/reranking; live model configuration and CURRENT_DATE; attribution writes skipped' },
    { port: 'knowledge.replica_port', boundary: 'owned_replica_available_not_wired', readers: 'captureKnowledgeReplica/knowledgeReplicaSchema; Knowledge.tenantHasKnowledge/searchRelevant optional private evaluationKnowledge', sources: 'server-side MVCC copy of seven reviewed RAG/conflict-source projections; hash, ownership, source binding and expiring namespace lease; canonical PostgreSQL readers verified; not yet created/selected by AgentTest/Eval/Simulation/Learning; lifecycle, management/slots/usage and aggregated budget integration remain pending; source guards and global manifest remain required' },
    { port: 'tools.structured_knowledge', boundary: 'source_then_sealed', readers: 'Revision.captureStructuredKnowledge; Faqs.search; Policies.getActive; sessionToolExecutor', sources: 'complete published FAQs + active policies in one read-only MVCC transaction; explicit absent/present-empty collections; sealed snapshot recordsets preserve PostgreSQL predicates and ranking; global manifest remains live before/after use' },
    { port: 'core.ecommerce_sample', boundary: 'namespace', readers: 'Conversations catalog injection', sources: 'selected schema ecommerce_products' },
    { port: 'core.learning', boundary: 'sealed_release_plus_live_privacy', readers: 'Learning.getRuntimeExamples/readRelease/assertReleaseSourcesAvailable/runtimeSourceAuthority/runtimeDataSourceAuthority; withAgentSourceFence', sources: 'frozen release ID/hash and exact Inbox messages/source revisions; release/source/example/tombstone checks plus accumulated source footprint before and after provider attempts; nested Replay/Learning share only the active same-Prisma/schema source transaction; invalid sources stop reuse without repeating domain writers' },
    { port: 'core.models', boundary: 'live_guarded_router', readers: 'sessionLlmRouter; IntentInterpreter; rewriteSearchQuery; normal response/tool loop/output guardrails; Knowledge reranker/embedding', sources: 'router registry/settings/env + live provider; read-only context skips affinity/stat persistence, source authority is checked for each provider attempt, including SDK retry replacements; external weights/fallback/circuit/clock are not frozen' },
    { port: 'canonical_commands', boundary: 'owned_namespace', readers: 'ToolExecutionControl; canonical appointments/vehicle test drives/education/gyms/repair/catalog/pets ports; owned appointment readers; evaluationNamespaceTimezone', sources: 'namespace contacts/conversations/messages/ledger/terms/catalog/business rows; persona_config projects captured effective scheduling facts; timezone reads require current lease and one active row, with no public regional fallback; actor directory shadow; appointment readers use explicit synthetic_A2 fixture assurance, never live identity or OTP; no external providers/events; source lease owner + metadata introspection remain live' },
    { port: 'eval.runner', boundary: 'source_control_plane_plus_namespace', readers: 'Eval.listScenarios/profileOf/runGateV2; revision guards; source regression guards; verifyExpectedEffects; Quality.judgeTranscript', sources: 'source eval_scenarios and approved quality_regression_cases + reviews/revisions/contacts/messages/erasure via privacy guard; frozen scenarios/hash; namespace effect assertions; live judge router' },
    { port: 'simulation.runner', boundary: 'source_control_plane_plus_namespace', readers: 'Simulation.run/buildReplayScenarios/loadScenariosFromRun/buildSummary; captureSimulationReplays/assertSimulationReplayRun/withSimulationReplayRun/retireSimulationReplayRuns; withAgentSourceFence; synthetic generator/customer simulator/judge', sources: 'exact authorized source messages/contact/channel/agent and actor grant, baseline lineage and live revision/erasure checks; simulation_runs replay authority + namespace leases registered before copying; retirement clears descendants/results/copies, stale workers cannot restore them; source guard spans model/tool/judge use; generated/customer text and judge remain live LLM' },
    { port: 'learning.evaluator', boundary: 'source_control_plane_plus_namespace', readers: 'LearningEvaluation.start/process/guard/replay/databaseEvidence/judge; Learning.createEvaluationSnapshot/evaluationRun/dependencyHash; source authority and retention recovery', sources: 'source release/train/holdout lineage plus erasure revalidated at use/finalization; worker generation CAS and latest checkpoint under transaction, registered namespace leases before copying; ownership-bound expiry recovery also covers inactive tenants without restarting work; exact namespace object/ledger/receipt evidence; live judge router' },
    { port: 'authorization_privacy_usage', boundary: 'live_required', readers: 'AgentTest quota; namespace.assertOwned; source privacy/QA guards; release checkpoints; BullMQ/Redis leases and budget', sources: 'tenant lifecycle/membership/plan and quota, active source consent/erasure/review, namespace lease marker, job leases/budget; never replace with a historical grant' },
    { port: 'clock', boundary: 'live_unfrozen', readers: 'Date.now/new Date; SQL NOW/CURRENT_DATE; provider mirror freshness and holds; evaluationTemporalInputs', sources: 'OS/DB/provider clocks remain live; fixture dates use snapshot.capturedAt and captured tenant-hours > agent-hours schedule precedence, with tenant > agent > captured-region timezone precedence; no global frozen clock' },
] as const;
