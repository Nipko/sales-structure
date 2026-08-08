import type { VerticalAssuranceLevel } from '@parallext/shared';

/**
 * Canonical policy for every statically advertised AI tool.
 *
 * This registry describes the code-backed boundary as it exists today. Missing
 * confirmation/idempotency is represented explicitly instead of being inferred
 * from a tool name or hidden in a prompt. Dynamic MCP tools are intentionally
 * outside the static registry and receive an opaque, fail-safe policy below.
 */
export type ToolEffect = 'read' | 'write' | 'conditional_write';
export type ToolDataClassification = 'public' | 'contact' | 'sensitive';
export type ToolOwnership = 'none' | 'tenant_scope' | 'contact_scope' | 'resource_owner';
export type ToolIdempotency = 'not_applicable' | 'deterministic' | 'state_guarded' | 'central_ledger' | 'missing';
export type ToolExternalEffect = 'none' | 'provider_read' | 'provider_write' | 'channel_write' | 'opaque';
export type ToolDownstreamEffect = 'domain_event' | 'notification' | 'handoff';
export type ToolAssuranceEnforcement = 'none' | 'contact_context' | 'step_up' | 'central_guard' | 'missing';
export type ToolConfirmation = 'not_required' | 'runtime_enforced' | 'required_missing';
export type ToolHumanApproval = 'not_required' | 'runtime_enforced' | 'required_missing';

export interface ToolPolicy {
    effect: ToolEffect;
    dataClassification: ToolDataClassification;
    assurance: VerticalAssuranceLevel;
    assuranceEnforcement: ToolAssuranceEnforcement;
    ownership: ToolOwnership;
    idempotency: ToolIdempotency;
    externalEffect: ToolExternalEffect;
    downstreamEffects: readonly ToolDownstreamEffect[];
    confirmation: ToolConfirmation;
    humanApproval: ToolHumanApproval;
    agentTestAllowed: boolean;
}

type ToolPolicyOverrides = Partial<ToolPolicy>;
type ToolPolicyEntry = readonly [name: string, policy: ToolPolicy];

const publicRead = (overrides: ToolPolicyOverrides = {}): ToolPolicy => ({
    effect: 'read',
    dataClassification: 'public',
    assurance: 'A0',
    assuranceEnforcement: 'none',
    ownership: 'tenant_scope',
    idempotency: 'not_applicable',
    externalEffect: 'none',
    downstreamEffects: [],
    confirmation: 'not_required',
    humanApproval: 'not_required',
    agentTestAllowed: false,
    ...overrides,
});

const contactRead = (overrides: ToolPolicyOverrides = {}): ToolPolicy => ({
    ...publicRead(),
    dataClassification: 'contact',
    assurance: 'A1',
    assuranceEnforcement: 'contact_context',
    ownership: 'contact_scope',
    ...overrides,
});

const sensitiveRead = (overrides: ToolPolicyOverrides = {}): ToolPolicy => ({
    ...contactRead(),
    dataClassification: 'sensitive',
    ...overrides,
});

const contactWrite = (overrides: ToolPolicyOverrides = {}): ToolPolicy => ({
    effect: 'write',
    dataClassification: 'contact',
    assurance: 'A1',
    assuranceEnforcement: 'contact_context',
    ownership: 'contact_scope',
    idempotency: 'central_ledger',
    externalEffect: 'none',
    downstreamEffects: [],
    confirmation: 'runtime_enforced',
    humanApproval: 'not_required',
    agentTestAllowed: false,
    ...overrides,
});

const mediaWrite = (): ToolPolicy => contactWrite({
    dataClassification: 'public',
    externalEffect: 'channel_write',
    confirmation: 'not_required',
});

const stepUpSensitiveRead = (overrides: ToolPolicyOverrides = {}): ToolPolicy => sensitiveRead({
    assurance: 'A2',
    assuranceEnforcement: 'step_up',
    ...overrides,
});

const stepUpSensitiveWrite = (overrides: ToolPolicyOverrides = {}): ToolPolicy => contactWrite({
    dataClassification: 'sensitive',
    assurance: 'A2',
    assuranceEnforcement: 'step_up',
    ...overrides,
});

const entry = (name: string, policy: ToolPolicy): ToolPolicyEntry => [name, Object.freeze(policy)];

const TOOL_POLICY_ENTRIES = [
    // Appointments and calendar
    entry('list_services', publicRead({ agentTestAllowed: true })),
    entry('check_availability', publicRead({ externalEffect: 'provider_read' })),
    entry('create_appointment', contactWrite({
        externalEffect: 'provider_write',
        downstreamEffects: ['domain_event', 'notification'],
    })),
    entry('cancel_appointment', contactWrite({
        ownership: 'resource_owner',
        idempotency: 'state_guarded',
        downstreamEffects: ['domain_event', 'notification'],
    })),
    entry('reschedule_appointment', contactWrite({
        ownership: 'resource_owner',
        idempotency: 'state_guarded',
        externalEffect: 'provider_write',
        downstreamEffects: ['domain_event'],
    })),
    // Appointment payloads include time, service, meeting links and sometimes
    // regulated-domain context. A static policy cannot safely infer the tenant
    // industry here, so both reads use the stronger global A2 boundary.
    entry('get_appointment_details', stepUpSensitiveRead({ ownership: 'resource_owner' })),
    entry('list_customer_appointments', stepUpSensitiveRead()),
    entry('send_booking_link', publicRead()),

    // Catalog, CRM context, knowledge and e-commerce
    entry('search_products', publicRead({ agentTestAllowed: true })),
    entry('get_product', publicRead({ agentTestAllowed: true })),
    entry('check_stock', publicRead({ agentTestAllowed: true })),
    entry('send_product_image', mediaWrite()),
    entry('list_active_offers', publicRead({ agentTestAllowed: true })),
    entry('search_faqs', publicRead({
        effect: 'conditional_write',
        idempotency: 'central_ledger',
        agentTestAllowed: true,
    })),
    entry('get_policy', publicRead({
        effect: 'conditional_write',
        idempotency: 'state_guarded',
        agentTestAllowed: true,
    })),
    entry('search_knowledge_base', publicRead({
        effect: 'conditional_write',
        idempotency: 'central_ledger',
        externalEffect: 'provider_read',
        agentTestAllowed: true,
    })),
    entry('list_customer_orders', contactRead({ agentTestAllowed: true })),
    entry('get_customer_context', sensitiveRead({ agentTestAllowed: true })),
    // In production this may lazily prepare its local search tables. Agent Test
    // supplies persistence:disabled, which forces the audited read-only path.
    entry('recommend_products', publicRead({
        effect: 'conditional_write',
        idempotency: 'state_guarded',
        agentTestAllowed: true,
    })),
    entry('get_order_status', contactRead({ ownership: 'resource_owner', agentTestAllowed: true })),
    entry('apply_discount', contactWrite({
        dataClassification: 'sensitive',
        assurance: 'A4',
        assuranceEnforcement: 'central_guard',
        ownership: 'contact_scope',
        idempotency: 'central_ledger',
        confirmation: 'runtime_enforced',
        humanApproval: 'runtime_enforced',
    })),
    entry('create_payment_link', contactWrite({
        dataClassification: 'sensitive',
        assurance: 'A3',
        assuranceEnforcement: 'central_guard',
        ownership: 'resource_owner',
        idempotency: 'central_ledger',
        externalEffect: 'provider_write',
        downstreamEffects: ['handoff'],
        confirmation: 'runtime_enforced',
    })),
    entry('refund_payment', contactWrite({
        dataClassification: 'sensitive',
        assurance: 'A4',
        assuranceEnforcement: 'central_guard',
        ownership: 'resource_owner',
        idempotency: 'central_ledger',
        externalEffect: 'provider_write',
        downstreamEffects: ['handoff'],
        confirmation: 'runtime_enforced',
        humanApproval: 'runtime_enforced',
    })),

    // Vertical integration reads still update lazy local schema/cache/health.
    // The first three read synced vi_items; only availability calls Cliniko live.
    entry('get_restaurant_menu', publicRead({ effect: 'write', idempotency: 'state_guarded' })),
    entry('get_fitness_schedule', publicRead({ effect: 'write', idempotency: 'state_guarded' })),
    entry('list_clinic_services', publicRead({ effect: 'write', idempotency: 'state_guarded' })),
    entry('check_clinic_availability', publicRead({ effect: 'write', idempotency: 'state_guarded', externalEffect: 'provider_read' })),

    // Vacation rentals
    entry('list_properties', publicRead({ agentTestAllowed: true })),
    entry('check_property_availability', publicRead({ agentTestAllowed: true })),
    entry('get_property_details', publicRead({ agentTestAllowed: true })),
    // Physical-access instructions can expose addresses and access codes.
    entry('get_check_in_instructions', stepUpSensitiveRead({ ownership: 'resource_owner', agentTestAllowed: true })),
    entry('create_property_booking', contactWrite({ downstreamEffects: ['notification'] })),
    entry('cancel_property_booking', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded' })),
    entry('list_my_property_bookings', contactRead({ agentTestAllowed: true })),
    entry('send_property_image', mediaWrite()),

    // Tours and travel packages
    entry('search_packages', publicRead({ agentTestAllowed: true })),
    entry('get_package_details', publicRead({ agentTestAllowed: true })),
    entry('check_package_availability', publicRead({ agentTestAllowed: true })),
    entry('create_tour_booking', contactWrite({ downstreamEffects: ['notification'] })),
    entry('cancel_tour_booking', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded' })),
    entry('list_my_tour_bookings', contactRead({ agentTestAllowed: true })),

    // Health treatment context
    entry('get_treatment_plan', stepUpSensitiveRead({ agentTestAllowed: true })),
    entry('list_upcoming_sessions', stepUpSensitiveRead({ agentTestAllowed: true })),

    // Real estate and automotive
    entry('search_listings', publicRead({ agentTestAllowed: true })),
    entry('get_listing_details', publicRead({ agentTestAllowed: true })),
    entry('send_listing_image', mediaWrite()),
    entry('search_vehicles', publicRead({ agentTestAllowed: true })),
    entry('get_vehicle_details', publicRead({ agentTestAllowed: true })),
    entry('send_vehicle_image', mediaWrite()),

    // Pets and veterinary
    entry('list_pets_for_contact', sensitiveRead({ agentTestAllowed: true })),
    entry('register_pet', contactWrite({ dataClassification: 'sensitive' })),
    entry('get_vaccination_status', stepUpSensitiveRead({ ownership: 'resource_owner', agentTestAllowed: true })),
    entry('triage_pet_emergency', publicRead({
        effect: 'conditional_write',
        dataClassification: 'sensitive',
        ownership: 'none',
        idempotency: 'central_ledger',
        downstreamEffects: ['handoff'],
        agentTestAllowed: true,
    })),
    entry('update_pet', contactWrite({ dataClassification: 'sensitive', ownership: 'resource_owner', idempotency: 'state_guarded' })),

    // Restaurants
    entry('get_menu', publicRead({ agentTestAllowed: true })),
    entry('get_promotions', publicRead({ agentTestAllowed: true })),
    entry('place_order', contactWrite({ downstreamEffects: ['notification'] })),
    entry('cancel_order', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded', downstreamEffects: ['notification'] })),
    entry('check_order_status', sensitiveRead({ ownership: 'resource_owner', agentTestAllowed: true })),
    entry('list_my_orders', contactRead({ agentTestAllowed: true })),

    // Gyms
    entry('get_membership_plans', publicRead({ agentTestAllowed: true })),
    entry('get_class_schedule', publicRead({ agentTestAllowed: true })),
    entry('get_my_membership', sensitiveRead({ agentTestAllowed: true })),
    entry('book_class', contactWrite({ idempotency: 'state_guarded' })),
    entry('freeze_membership', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded' })),
    entry('cancel_class_booking', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded' })),

    // Education
    entry('get_courses', publicRead({ agentTestAllowed: true })),
    entry('get_course_schedule', publicRead({ agentTestAllowed: true })),
    entry('enroll_student', contactWrite()),
    // Despite its name, this creates the test row when one does not exist.
    entry('get_placement_test_link', contactWrite({ confirmation: 'not_required' })),
    entry('cancel_enrollment', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded' })),
    entry('list_my_enrollments', contactRead({ agentTestAllowed: true })),

    // Insurance and identity step-up
    entry('get_insurance_plans', publicRead({ agentTestAllowed: true })),
    entry('calculate_quote', contactWrite({ dataClassification: 'sensitive' })),
    entry('check_policy_status', stepUpSensitiveRead({
        effect: 'conditional_write',
        ownership: 'resource_owner',
        idempotency: 'central_ledger',
        externalEffect: 'channel_write',
        downstreamEffects: ['handoff'],
        agentTestAllowed: true,
    })),
    entry('request_identity_code', contactWrite({
        dataClassification: 'sensitive',
        externalEffect: 'channel_write',
        confirmation: 'not_required',
    })),
    entry('verify_identity_code', contactWrite({
        dataClassification: 'sensitive',
        confirmation: 'not_required',
    })),
    entry('file_claim', stepUpSensitiveWrite({ ownership: 'resource_owner', downstreamEffects: ['handoff', 'notification'] })),
    entry('list_my_claims', stepUpSensitiveRead({
        effect: 'conditional_write',
        idempotency: 'central_ledger',
        externalEffect: 'channel_write',
        downstreamEffects: ['handoff'],
        agentTestAllowed: true,
    })),
    entry('cancel_quote', contactWrite({ dataClassification: 'sensitive', ownership: 'resource_owner', idempotency: 'state_guarded' })),

    // Home services
    entry('create_service_request', contactWrite({ downstreamEffects: ['domain_event', 'notification', 'handoff'] })),
    entry('check_request_status', contactRead({ ownership: 'resource_owner', agentTestAllowed: true })),
    entry('list_my_requests', sensitiveRead({ agentTestAllowed: true })),
    entry('cancel_service_request', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded' })),

    // Pet services, photography and professional cases
    entry('list_pet_services', publicRead({ agentTestAllowed: true })),
    entry('check_daycare_availability', publicRead({ agentTestAllowed: true })),
    entry('list_photo_packages', publicRead({ agentTestAllowed: true })),
    entry('send_portfolio', mediaWrite()),
    entry('check_date_availability', publicRead({ agentTestAllowed: true })),
    entry('request_photo_quote', contactWrite({ downstreamEffects: ['domain_event', 'notification'] })),
    entry('cancel_photo_session', contactWrite({ ownership: 'resource_owner', idempotency: 'state_guarded' })),
    entry('get_case_status', stepUpSensitiveRead({ agentTestAllowed: true })),
] as const;

function buildRegistry(entries: readonly ToolPolicyEntry[]): Readonly<Record<string, ToolPolicy>> {
    const registry: Record<string, ToolPolicy> = {};
    for (const [name, policy] of entries) {
        if (registry[name]) throw new Error(`Duplicate tool policy: ${name}`);
        registry[name] = policy;
    }
    return Object.freeze(registry);
}

export const TOOL_POLICY_REGISTRY = buildRegistry(TOOL_POLICY_ENTRIES);
export const STATIC_TOOL_NAMES = Object.freeze(Object.keys(TOOL_POLICY_REGISTRY));

/** Opaque dynamic tools are never assumed to be reads. */
export const OPAQUE_MCP_TOOL_POLICY: Readonly<ToolPolicy> = Object.freeze({
    effect: 'write',
    dataClassification: 'sensitive',
    assurance: 'A4',
    assuranceEnforcement: 'missing',
    ownership: 'tenant_scope',
    idempotency: 'missing',
    externalEffect: 'opaque',
    downstreamEffects: [],
    confirmation: 'required_missing',
    humanApproval: 'required_missing',
    agentTestAllowed: false,
});

export function getToolPolicy(name: unknown): ToolPolicy | undefined {
    if (typeof name !== 'string') return undefined;
    if (name.startsWith('mcp__')) return OPAQUE_MCP_TOOL_POLICY;
    return TOOL_POLICY_REGISTRY[name];
}

export function isRegisteredStaticTool(name: unknown): name is string {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TOOL_POLICY_REGISTRY, name);
}

/**
 * Unknown and opaque tools are serialized fail-safe. Provider reads may run in
 * parallel; writes, outbound sends and opaque calls may not.
 */
export function toolRequiresSequentialExecution(name: unknown): boolean {
    const policy = getToolPolicy(name);
    if (!policy) return true;
    return policy.effect !== 'read'
        || policy.externalEffect === 'provider_write'
        || policy.externalEffect === 'channel_write'
        || policy.externalEffect === 'opaque';
}

/** A mixed batch is serialized whenever any tool can mutate or emit effects. */
export function toolBatchRequiresSequentialExecution(names: readonly unknown[]): boolean {
    return names.some(toolRequiresSequentialExecution);
}

export function getMissingToolControls(): Array<{
    name: string;
    missing: Array<'assurance' | 'idempotency' | 'confirmation' | 'human_approval'>;
}> {
    return STATIC_TOOL_NAMES.flatMap(name => {
        const policy = TOOL_POLICY_REGISTRY[name];
        const missing: Array<'assurance' | 'idempotency' | 'confirmation' | 'human_approval'> = [];
        if (policy.assuranceEnforcement === 'missing') missing.push('assurance');
        if (policy.idempotency === 'missing') missing.push('idempotency');
        if (policy.confirmation === 'required_missing') missing.push('confirmation');
        if (policy.humanApproval === 'required_missing') missing.push('human_approval');
        return missing.length ? [{ name, missing }] : [];
    });
}
