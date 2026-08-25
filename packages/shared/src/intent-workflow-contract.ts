import type { IntentContract } from './vertical-domain-contract';

export const INTENT_WORKFLOW_CONTRACT_VERSION = 1 as const;

export type IntentWorkflowClass = 'informational' | 'guided' | 'transactional' | 'regulated';
export type WorkflowReadiness =
    | 'ready'
    | 'blocked_missing_tools'
    | 'blocked_product'
    | 'blocked_external'
    | 'blocked_regulated_policy';

export interface WorkflowTransitionV1 {
    from: string;
    event: string;
    to: string;
}

export interface DeterministicWorkflowDefinitionV1 {
    version: typeof INTENT_WORKFLOW_CONTRACT_VERSION;
    id: string;
    label: string;
    class: 'transactional' | 'regulated';
    profilePattern: string;
    triggerTools: readonly string[];
    requiredTools: readonly string[];
    states: readonly string[];
    initialState: string;
    terminalStates: readonly string[];
    transitions: readonly WorkflowTransitionV1[];
    requiredSlots: readonly string[];
    validators: Readonly<Record<string, string>>;
    expiresAfterSeconds: number;
    resumable: true;
    cancellable: true;
    confirmation: 'explicit';
    approval: 'none' | 'human' | 'provider' | 'expert_policy';
    idempotencyKey: string;
    sideEffects: readonly string[];
    recovery: readonly string[];
    blockedBy: 'none' | 'product_decision' | 'external_provider' | 'regulated_policy';
}

export interface ResolvedIntentWorkflowV1 {
    version: typeof INTENT_WORKFLOW_CONTRACT_VERSION;
    intentKey: string;
    class: IntentWorkflowClass;
    workflowId: string;
    states: readonly string[];
    initialState: string;
    terminalStates: readonly string[];
    requiredSlots: readonly string[];
    confirmation: IntentContract['confirmation'];
    authoredToolPlan: readonly string[];
    runtimeToolPlan: readonly string[];
    missingTools: readonly string[];
    readiness: WorkflowReadiness;
    mayExecute: boolean;
    nextStateAuthority: 'none' | 'tool_executor' | 'backend_workflow';
    defaultDeny: boolean;
    blockedReason: string | null;
}

const txTransitions = (processing: string, success: string): readonly WorkflowTransitionV1[] => Object.freeze([
    Object.freeze({ from: 'collecting', event: 'slots_complete', to: 'confirming' }),
    Object.freeze({ from: 'confirming', event: 'confirmed', to: processing }),
    Object.freeze({ from: processing, event: 'committed', to: success }),
    Object.freeze({ from: processing, event: 'failed', to: 'recovery' }),
    Object.freeze({ from: 'recovery', event: 'resume', to: processing }),
    Object.freeze({ from: 'collecting', event: 'cancel', to: 'cancelled' }),
    Object.freeze({ from: 'confirming', event: 'cancel', to: 'cancelled' }),
    Object.freeze({ from: 'recovery', event: 'handoff', to: 'handoff' }),
]);

function workflow(input: Omit<DeterministicWorkflowDefinitionV1, 'version' | 'resumable' | 'cancellable' | 'confirmation'>): DeterministicWorkflowDefinitionV1 {
    return Object.freeze({
        version: INTENT_WORKFLOW_CONTRACT_VERSION,
        resumable: true,
        cancellable: true,
        confirmation: 'explicit',
        ...input,
    });
}

/** First deterministic queue approved in P29. Missing products stay explicit and fail closed. */
export const FIRST_DETERMINISTIC_WORKFLOW_QUEUE: readonly DeterministicWorkflowDefinitionV1[] = Object.freeze([
    workflow({
        id: 'payments.link_and_status', label: 'Payments', class: 'transactional', profilePattern: '*',
        triggerTools: Object.freeze(['create_payment_link']), requiredTools: Object.freeze(['create_payment_link', 'get_payment_status']),
        states: Object.freeze(['collecting', 'confirming', 'creating_link', 'awaiting_payment', 'paid', 'expired', 'cancelled', 'recovery', 'handoff']),
        initialState: 'collecting', terminalStates: Object.freeze(['paid', 'expired', 'cancelled', 'handoff']),
        transitions: Object.freeze([...txTransitions('creating_link', 'awaiting_payment'),
            Object.freeze({ from: 'awaiting_payment', event: 'provider_paid', to: 'paid' }),
            Object.freeze({ from: 'awaiting_payment', event: 'expire', to: 'expired' })]),
        requiredSlots: Object.freeze(['amount', 'currency', 'concept', 'contact']), validators: Object.freeze({ amount: 'positive_minor_units', currency: 'iso_4217', contact: 'canonical_contact' }),
        expiresAfterSeconds: 86_400, approval: 'provider', idempotencyKey: 'tenant+conversation+canonical_reference',
        sideEffects: Object.freeze(['payment_link', 'provider_status']), recovery: Object.freeze(['reconcile_provider', 'resume_status', 'handoff']), blockedBy: 'none',
    }),
    workflow({
        id: 'marketplace.checkout', label: 'Marketplace checkout', class: 'transactional', profilePattern: 'retail/marketplace',
        triggerTools: Object.freeze(['place_catalog_order']), requiredTools: Object.freeze(['get_product', 'check_stock', 'marketplace_checkout']),
        states: Object.freeze(['collecting', 'confirming', 'checking_seller', 'creating_order', 'awaiting_payment', 'confirmed', 'cancelled', 'recovery', 'handoff']),
        initialState: 'collecting', terminalStates: Object.freeze(['confirmed', 'cancelled', 'handoff']), transitions: txTransitions('creating_order', 'confirmed'),
        requiredSlots: Object.freeze(['seller', 'items', 'delivery', 'buyer']), validators: Object.freeze({ seller: 'kyb_approved', items: 'single_seller_partition', delivery: 'serviceable_zone' }),
        expiresAfterSeconds: 1_800, approval: 'provider', idempotencyKey: 'tenant+seller+cart+generation', sideEffects: Object.freeze(['seller_order', 'payout_ledger']),
        recovery: Object.freeze(['release_inventory', 'reconcile_payment', 'handoff']), blockedBy: 'product_decision',
    }),
    workflow({
        id: 'real_estate.unit_hold', label: 'Real-estate hold', class: 'transactional', profilePattern: 'inmobiliaria/*',
        triggerTools: Object.freeze(['create_property_hold']), requiredTools: Object.freeze(['get_listing_details', 'check_unit_availability', 'create_property_hold']),
        states: Object.freeze(['collecting', 'confirming', 'locking_unit', 'held', 'expired', 'cancelled', 'recovery', 'handoff']), initialState: 'collecting',
        terminalStates: Object.freeze(['held', 'expired', 'cancelled', 'handoff']), transitions: txTransitions('locking_unit', 'held'),
        requiredSlots: Object.freeze(['unit_id', 'contact', 'hold_until', 'price_version']), validators: Object.freeze({ unit_id: 'mapped_available_unit', hold_until: 'bounded_future', price_version: 'current_price_list' }),
        expiresAfterSeconds: 900, approval: 'provider', idempotencyKey: 'tenant+unit+contact+hold_window', sideEffects: Object.freeze(['unit_hold']), recovery: Object.freeze(['release_lock', 'reconcile_owner', 'handoff']), blockedBy: 'product_decision',
    }),
    workflow({
        id: 'resource.rental', label: 'Vehicle rental request', class: 'transactional', profilePattern: 'automotriz/alquiler',
        triggerTools: Object.freeze(['create_vehicle_rental']), requiredTools: Object.freeze(['check_vehicle_rental_availability', 'create_vehicle_rental']),
        states: Object.freeze(['collecting', 'confirming', 'identity_step_up', 'submitted', 'human_review', 'reserved', 'rejected', 'cancelled', 'expired', 'recovery', 'handoff']), initialState: 'collecting',
        terminalStates: Object.freeze(['reserved', 'rejected', 'cancelled', 'expired', 'handoff']),
        transitions: Object.freeze([
            Object.freeze({ from: 'collecting', event: 'slots_complete', to: 'confirming' }),
            Object.freeze({ from: 'confirming', event: 'confirmed', to: 'identity_step_up' }),
            Object.freeze({ from: 'identity_step_up', event: 'verified', to: 'submitted' }),
            Object.freeze({ from: 'submitted', event: 'request_recorded', to: 'human_review' }),
            Object.freeze({ from: 'human_review', event: 'approved', to: 'reserved' }),
            Object.freeze({ from: 'human_review', event: 'rejected', to: 'rejected' }),
            Object.freeze({ from: 'human_review', event: 'cancel', to: 'cancelled' }),
            Object.freeze({ from: 'identity_step_up', event: 'failed', to: 'recovery' }),
            Object.freeze({ from: 'recovery', event: 'resume', to: 'identity_step_up' }),
            Object.freeze({ from: 'recovery', event: 'handoff', to: 'handoff' }),
        ]),
        requiredSlots: Object.freeze(['resource_id', 'start', 'end', 'contact', 'driver']), validators: Object.freeze({ resource_id: 'active_resource', start: 'iso_date', end: 'half_open_after_start', driver: 'declared_driver_intake' }),
        expiresAfterSeconds: 86_400, approval: 'human', idempotencyKey: 'tenant+resource+date_range+contact', sideEffects: Object.freeze(['rental_request']), recovery: Object.freeze(['resume_identity', 'human_review', 'handoff']), blockedBy: 'none',
    }),
    workflow({
        id: 'resource.pet_boarding', label: 'Pet boarding', class: 'transactional', profilePattern: 'pet_services/*',
        triggerTools: Object.freeze(['create_pet_boarding']), requiredTools: Object.freeze(['check_daycare_availability', 'create_pet_boarding']),
        states: Object.freeze(['collecting', 'confirming', 'locking_resource', 'reserved', 'cancelled', 'expired', 'recovery', 'handoff']), initialState: 'collecting',
        terminalStates: Object.freeze(['reserved', 'cancelled', 'expired', 'handoff']), transitions: txTransitions('locking_resource', 'reserved'),
        requiredSlots: Object.freeze(['resource_id', 'service_id', 'start', 'end', 'contact']), validators: Object.freeze({ resource_id: 'active_pet', service_id: 'active_boarding_service', start: 'iso_date', end: 'half_open_after_start' }),
        expiresAfterSeconds: 1_800, approval: 'none', idempotencyKey: 'tenant+resource+date_range+contact', sideEffects: Object.freeze(['pet_boarding']), recovery: Object.freeze(['release_lock', 'resume_quote', 'handoff']), blockedBy: 'none',
    }),
    ...Object.freeze([
        ['repair.approval', 'Repair approval', 'automotriz/taller', 'approve_repair', 'repair_quote', 'none'],
        ['events.sensitive_rsvp', 'Sensitive RSVP', 'event_planning/*', 'confirm_sensitive_rsvp', 'guest_identity', 'product_decision'],
        ['locksmith.dispatch', 'Locksmith dispatch', 'servicios_hogar/cerrajeria', 'dispatch_locksmith', 'access_authorization', 'product_decision'],
        ['pharmacy.rx_intake', 'Rx intake', 'salud/farmacia', 'submit_rx_intake', 'prescription_reference', 'regulated_policy'],
        ['insurance.fnol', 'FNOL', 'seguros/*', 'create_fnol', 'policy_and_loss', 'external_provider'],
        ['health_insurance.identity_gate', 'Health-insurance identity gate', 'seguros/salud', 'verify_policyholder_identity', 'verified_identity', 'regulated_policy'],
    ].map(([id, label, profilePattern, tool, requiredSlot, blockedBy]) => workflow({
        id, label, class: blockedBy === 'regulated_policy' || id === 'insurance.fnol' ? 'regulated' : 'transactional', profilePattern,
        triggerTools: Object.freeze([tool]), requiredTools: Object.freeze([tool]),
        states: Object.freeze(['collecting', 'confirming', 'authorizing', 'committing', 'completed', 'cancelled', 'expired', 'recovery', 'handoff']),
        initialState: 'collecting', terminalStates: Object.freeze(['completed', 'cancelled', 'expired', 'handoff']), transitions: txTransitions('committing', 'completed'),
        requiredSlots: Object.freeze([requiredSlot, 'contact']), validators: Object.freeze({ [requiredSlot]: 'domain_authority_verified', contact: 'canonical_contact' }),
        expiresAfterSeconds: 900, approval: blockedBy === 'regulated_policy' ? 'expert_policy' : blockedBy === 'external_provider' ? 'provider' : 'human',
        idempotencyKey: `tenant+conversation+${id}+generation`, sideEffects: Object.freeze([id]), recovery: Object.freeze(['resume', 'rollback_if_supported', 'handoff']),
        blockedBy: blockedBy as DeterministicWorkflowDefinitionV1['blockedBy'],
    }))),
]);

export function classifyIntentWorkflow(intent: IntentContract): IntentWorkflowClass {
    if (intent.slots.some((slot) => slot.sensitivity === 'regulated')) return 'regulated';
    if (intent.commits) return 'transactional';
    if (intent.fallback === 'answer' && intent.toolPlan.every((tool) => /^(search|get|list|check|calculate)/.test(tool))) return 'informational';
    return 'guided';
}

function matchesProfile(pattern: string, profileId: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('/*')) return profileId.startsWith(pattern.slice(0, -1));
    return pattern === profileId;
}

export function resolveIntentWorkflow(input: {
    profileId: string;
    intent: IntentContract;
    publishedTools?: readonly string[];
}): ResolvedIntentWorkflowV1 {
    const classification = classifyIntentWorkflow(input.intent);
    const published = new Set(input.publishedTools || input.intent.toolPlan);
    const runtimeToolPlan = input.intent.toolPlan.filter((tool) => published.has(tool));
    const missingTools = input.intent.toolPlan.filter((tool) => !published.has(tool));
    const registered = FIRST_DETERMINISTIC_WORKFLOW_QUEUE.find((definition) =>
        matchesProfile(definition.profilePattern, input.profileId)
        && definition.triggerTools.some((tool) => input.intent.toolPlan.includes(tool)));
    const blockedBy = registered?.blockedBy || 'none';
    const readiness: WorkflowReadiness = blockedBy === 'product_decision'
        ? 'blocked_product'
        : blockedBy === 'external_provider'
            ? 'blocked_external'
            : blockedBy === 'regulated_policy' || classification === 'regulated'
                ? 'blocked_regulated_policy'
                : missingTools.length
                    ? 'blocked_missing_tools'
                    : 'ready';
    const stateful = classification === 'transactional' || classification === 'regulated';
    const states = registered?.states || (stateful ? input.intent.states : Object.freeze(['ready', 'completed']));
    return Object.freeze({
        version: INTENT_WORKFLOW_CONTRACT_VERSION,
        intentKey: input.intent.key,
        class: classification,
        workflowId: registered?.id || `derived:${input.profileId}:${input.intent.key}`,
        states: Object.freeze([...states]),
        initialState: registered?.initialState || states[0] || 'ready',
        terminalStates: registered?.terminalStates || Object.freeze([states.at(-1) || 'completed']),
        requiredSlots: registered?.requiredSlots || Object.freeze(input.intent.slots.filter((slot) => slot.required).map((slot) => slot.key)),
        confirmation: registered?.confirmation || input.intent.confirmation,
        authoredToolPlan: Object.freeze([...input.intent.toolPlan]),
        runtimeToolPlan: Object.freeze(runtimeToolPlan),
        missingTools: Object.freeze(missingTools),
        readiness,
        mayExecute: readiness === 'ready',
        nextStateAuthority: stateful ? 'backend_workflow' : classification === 'guided' ? 'tool_executor' : 'none',
        defaultDeny: readiness !== 'ready' || classification !== 'informational',
        blockedReason: readiness === 'ready' ? null : readiness,
    });
}

export function transitionDeterministicWorkflow(
    definition: DeterministicWorkflowDefinitionV1,
    currentState: string,
    event: string,
): { accepted: boolean; state: string; reason?: 'terminal' | 'invalid_transition' } {
    if (definition.terminalStates.includes(currentState)) return { accepted: false, state: currentState, reason: 'terminal' };
    const transition = definition.transitions.find((candidate) => candidate.from === currentState && candidate.event === event);
    return transition
        ? { accepted: true, state: transition.to }
        : { accepted: false, state: currentState, reason: 'invalid_transition' };
}
