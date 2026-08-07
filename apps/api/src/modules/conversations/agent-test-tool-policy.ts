/**
 * Agent Test runs against the tenant's real schema, so its executable surface is
 * deliberately smaller than production: only audited, read-only tools may reach
 * AIToolExecutorService. The policy is enforced both when tools are advertised to
 * the model and immediately before execution (the model may still hallucinate an
 * unadvertised tool call).
 *
 * Known vertical integrations are not included yet because their current read
 * paths can lazily create/cache tables or call an external provider. Dynamic MCP
 * tools are also default-denied: MCP discovery does not expose a trustworthy
 * read-only/side-effect contract. Both families need a dedicated sandbox adapter
 * before Agent Test can execute them safely.
 */
export const AGENT_TEST_SAFE_TOOL_NAMES = [
    // Appointments
    'list_services',
    'check_availability',
    'list_customer_appointments',
    'get_appointment_details',

    // Catalog, knowledge and CRM context
    'search_products',
    'get_product',
    'check_stock',
    'list_active_offers',
    'search_faqs',
    'get_policy',
    'search_knowledge_base',
    'list_customer_orders',
    'get_customer_context',

    // E-commerce (read-only subset; apply_discount is intentionally excluded)
    'recommend_products',
    'get_order_status',

    // Vacation rentals and tours
    'list_properties',
    'check_property_availability',
    'get_property_details',
    'get_check_in_instructions',
    'list_my_property_bookings',
    'search_packages',
    'get_package_details',
    'check_package_availability',
    'list_my_tour_bookings',

    // Health, real estate and automotive
    'get_treatment_plan',
    'list_upcoming_sessions',
    'search_listings',
    'get_listing_details',
    'search_vehicles',
    'get_vehicle_details',

    // Veterinary and restaurants
    'list_pets_for_contact',
    'get_vaccination_status',
    'triage_pet_emergency',
    'get_menu',
    'get_promotions',
    'check_order_status',
    'list_my_orders',

    // Gyms and education
    'get_membership_plans',
    'get_class_schedule',
    'get_my_membership',
    'get_courses',
    'get_course_schedule',
    'list_my_enrollments',

    // Insurance (identity-code and quote/claim writers are excluded)
    'get_insurance_plans',
    'check_policy_status',
    'list_my_claims',

    // Tier 3 verticals and professional services
    'check_request_status',
    'list_my_requests',
    'list_pet_services',
    'check_daycare_availability',
    'list_photo_packages',
    'check_date_availability',
    'get_case_status',
] as const;

const AGENT_TEST_SAFE_TOOL_SET = new Set<string>(AGENT_TEST_SAFE_TOOL_NAMES);

export const AGENT_TEST_SANDBOX_CONTACT_ID = '00000000-0000-4000-8000-00000000a9e7';
const EVAL_SANDBOX_CONTACT_ID = '00000000-0000-4000-8000-00000000eba1';
const ALLOWED_SANDBOX_CONTACT_IDS = new Set([
    AGENT_TEST_SANDBOX_CONTACT_ID,
    EVAL_SANDBOX_CONTACT_ID,
]);

export function isAgentTestSafeToolName(name: unknown): name is string {
    return typeof name === 'string' && AGENT_TEST_SAFE_TOOL_SET.has(name);
}

/**
 * Never let an invalid pseudo-id or an arbitrary real contact UUID reach the
 * read-only test queries. The second id is the fixed internal eval identity.
 */
export function resolveAgentTestContactId(candidate?: string): string {
    const normalized = candidate?.toLowerCase();
    return normalized && ALLOWED_SANDBOX_CONTACT_IDS.has(normalized)
        ? normalized
        : AGENT_TEST_SANDBOX_CONTACT_ID;
}

export function agentTestBlockedToolResult(toolName: string): Record<string, unknown> {
    return {
        error: 'agent_test_read_only',
        tool: toolName,
        persisted: false,
        message: 'Esta acción no se ejecuta en Agent Test porque el modo de prueba es de solo lectura.',
    };
}
