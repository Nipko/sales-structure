/**
 * What Parallly Assist may create on the tenant's behalf — and, in the same
 * place and with the same weight, what it may not.
 *
 * `AGENT_CONFIGURATION_PATHS` gave Assist a bounded way to *change a setting*.
 * It could never create anything: a FAQ is not a `{path, value}`, so "write my
 * first FAQ" was impossible rather than merely unimplemented. This registry adds
 * the missing half — creation of content objects the tenant owns, reviews and
 * can delete — under the guarantees the configuration proposals already carry: a
 * reviewed digest, an expiry, idempotent replay, an audit row naming the real
 * actor, and a re-read after the write.
 *
 * Two rules give the file its shape.
 *
 *  1. **A whitelist, never a dispatch.** An operation is a declared entry with a
 *     target, a typed input, the roles that may ask for it and the gate it must
 *     pass. There is no "call service X, method Y" path anywhere: a key absent
 *     from `AGENT_EXECUTABLE_OPERATIONS` cannot be invoked at all, and the
 *     executor is a total map over that union so a new key without a handler
 *     fails to compile.
 *
 *  2. **Absence is declared, not left blank.** What Assist will *not* do is
 *     entries too, each with a reason and the screen that owns the decision.
 *     Channels need an OAuth round trip a chat cannot perform; roles and
 *     publication are privilege and customer-facing decisions that belong to a
 *     person on the screen that owns them; payment rails need credentials. A
 *     reader comparing this list against the product cannot mistake a deliberate
 *     boundary for an oversight, and the UI can route the person rather than
 *     apologise.
 *
 * No string in this file is user-facing. Reasons and violations are codes the
 * dashboard translates; the four message catalogues stay the dashboard's.
 */

export const AGENT_OPERATION_DOMAINS = [
    'knowledge', 'policies', 'catalogue', 'agenda', 'channels', 'roles', 'publication', 'payments',
] as const;
export type AgentOperationDomain = typeof AGENT_OPERATION_DOMAINS[number];

export type AgentOperationRole = 'super_admin' | 'tenant_admin' | 'tenant_supervisor' | 'tenant_agent';

/**
 * Operations Assist can actually perform. Every one writes a single row of text
 * the tenant owns, and every one is reachable from a screen where a person can
 * read it and delete it.
 */
export const AGENT_EXECUTABLE_OPERATIONS = [
    'knowledge.faq.create',
    'policies.legal_text.create',
    'catalogue.course.create',
    'agenda.service.create',
] as const;
export type AgentExecutableOperationKey = typeof AGENT_EXECUTABLE_OPERATIONS[number];

/** Declared, and deliberately not executable by Assist. Each names its screen. */
export const AGENT_ROUTED_OPERATIONS = [
    'channels.account.connect',
    'roles.member.grant',
    'publication.agent.publish',
    'payments.rail.configure',
    'agenda.appointment.book',
    'agenda.availability.replace',
    'catalogue.campaign.create',
    'catalogue.offer.create',
] as const;
export type AgentRoutedOperationKey = typeof AGENT_ROUTED_OPERATIONS[number];

export type AgentOperationKey = AgentExecutableOperationKey | AgentRoutedOperationKey;

/** Named so the whitelist can be audited line by line against the code it calls. */
export interface AgentOperationTarget {
    module: string;
    service: string;
    method: string;
    /** Tenant-schema table the row lands in. */
    table: string;
}

/**
 * The plan or readiness condition an operation must pass before it is proposed
 * *and* again before it is applied. `none` is a declaration, not an omission:
 * it has to say why no gate exists, so a missing key reads as a fact about the
 * plan catalogue rather than as something nobody thought about.
 */
export type AgentOperationGate =
    | { kind: 'plan_limit'; limitKey: string }
    | { kind: 'plan_feature'; featureKey: string }
    | { kind: 'none'; because: 'no_plan_key_exists' };

/** Why an operation is a route to a screen instead of something Assist runs. */
export type AgentOperationRouteReason =
    /** The connection is established by a redirect the user completes at the provider. */
    | 'oauth_round_trip_required'
    /** Granting or changing what a person may do is a privilege decision. */
    | 'privilege_decision'
    /** It puts something in front of the tenant's customers. */
    | 'customer_facing_decision'
    /** It needs secrets Assist must never ask for, hold or type. */
    | 'credentials_required'
    /** It sends, publishes, books or charges — the effect leaves the tenant's own records. */
    | 'outward_facing_effect'
    /** It commits the business to a price or a discount the agent will then quote. */
    | 'commercial_commitment'
    /** It replaces a whole existing set rather than adding one reviewable object. */
    | 'destructive_replacement';

interface AgentOperationCommon {
    key: AgentOperationKey;
    domain: AgentOperationDomain;
    target: AgentOperationTarget;
    /** Roles that may ask for this. Never wider than the owning screen allows. */
    roles: readonly AgentOperationRole[];
    /** The screen that owns the object, for review afterwards or for the handoff. */
    route: string;
}

export interface AgentExecutableOperation extends AgentOperationCommon {
    key: AgentExecutableOperationKey;
    availability: 'executable';
    gate: AgentOperationGate;
    /** A creation, so there is no prior state to diff against. */
    effect: 'create';
    /**
     * The only value this field accepts, and the point of the field. An
     * operation that would send a message, publish to a customer, move money or
     * touch a channel credential cannot be typed as executable at all — it has
     * to be declared routed, with a reason. The boundary is enforced by the
     * compiler rather than trusted to a comment.
     */
    sideEffects: 'tenant_record_only';
}

/**
 * A non-secret fact Assist may collect in the chat before opening the screen.
 *
 * "Non-secret" is the whole boundary and it is structural: a requirement whose
 * value would be a token, a key or a password cannot be declared here, because
 * the screens that need those are exactly the ones this list keeps Assist out
 * of. What is collected is the shape of the decision — which channel, which
 * provider, which role — so the person lands on the right screen already
 * knowing what they came to do.
 */
export interface AgentHandoffRequirement {
    readonly key: string;
    readonly kind: 'choice' | 'text';
    /** Exhaustive for `choice`. Anything else is refused rather than passed on. */
    readonly choices?: readonly string[];
    readonly optional?: boolean;
    /**
     * Query parameter this value is carried into the screen as. Omitted when the
     * screen does not read one — which is a fact about the screen and is stated
     * rather than faked with a parameter nothing honours.
     */
    readonly param?: string;
}

export interface AgentRoutedOperation extends AgentOperationCommon {
    key: AgentRoutedOperationKey;
    availability: 'route_to_screen';
    reason: AgentOperationRouteReason;
    /** What Assist gathers before sending the person anywhere. May be empty. */
    readonly requirements: readonly AgentHandoffRequirement[];
    /**
     * Quality check codes that must already be resolved for the screen to be
     * worth opening. Sending somebody to publish an agent with no channel is a
     * round trip that ends where it started.
     */
    readonly readiness: readonly string[];
    /**
     * What Assist re-reads when the person comes back, to report what actually
     * happened instead of assuming it worked. A quality check code, or
     * `assessment` for the whole thing.
     */
    readonly resultCheck: string;
}

export type AgentOperationDefinition = AgentExecutableOperation | AgentRoutedOperation;

export const AGENT_OPERATION_REGISTRY: readonly AgentOperationDefinition[] = Object.freeze([
    {
        key: 'knowledge.faq.create',
        domain: 'knowledge',
        availability: 'executable',
        effect: 'create',
        sideEffects: 'tenant_record_only',
        target: { module: 'knowledge', service: 'KnowledgeService', method: 'createResource', table: 'knowledge_resources' },
        roles: ['super_admin', 'tenant_admin', 'tenant_supervisor'],
        gate: { kind: 'plan_limit', limitKey: 'knowledgeArticles' },
        route: '/admin/knowledge/faqs',
    },
    {
        key: 'policies.legal_text.create',
        domain: 'policies',
        availability: 'executable',
        effect: 'create',
        sideEffects: 'tenant_record_only',
        target: { module: 'compliance', service: 'ComplianceService', method: 'createLegalText', table: 'legal_text_versions' },
        // The compliance screen restricts legal texts to the account admin, and
        // Assist must not be the wider door into the same table.
        roles: ['super_admin', 'tenant_admin'],
        gate: { kind: 'none', because: 'no_plan_key_exists' },
        route: '/admin/compliance',
    },
    {
        key: 'catalogue.course.create',
        domain: 'catalogue',
        availability: 'executable',
        effect: 'create',
        sideEffects: 'tenant_record_only',
        target: { module: 'catalog', service: 'CatalogService', method: 'createCourse', table: 'courses' },
        roles: ['super_admin', 'tenant_admin', 'tenant_supervisor'],
        gate: { kind: 'none', because: 'no_plan_key_exists' },
        route: '/admin/catalog/courses',
    },
    {
        key: 'agenda.service.create',
        domain: 'agenda',
        availability: 'executable',
        effect: 'create',
        sideEffects: 'tenant_record_only',
        target: { module: 'appointments', service: 'ServicesService', method: 'create', table: 'services' },
        roles: ['super_admin', 'tenant_admin', 'tenant_supervisor'],
        gate: { kind: 'plan_limit', limitKey: 'appointmentsServices' },
        route: '/admin/appointments',
    },

    // ── Declared and not executable ──────────────────────────────────────────
    {
        key: 'channels.account.connect',
        domain: 'channels',
        availability: 'route_to_screen',
        reason: 'oauth_round_trip_required',
        // The controller demands an `accessToken`, which is why this is a route
        // and not an operation. Which channel is not a secret, so Assist asks.
        requirements: [
            { key: 'channelType', kind: 'choice', param: 'type',
                choices: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_chat'] },
        ],
        readiness: [],
        resultCheck: 'channel_connection',
        target: { module: 'channels', service: 'ChannelManagementController', method: 'connect', table: 'public.channel_accounts' },
        roles: ['super_admin', 'tenant_admin'],
        route: '/admin/channels',
    },
    {
        key: 'roles.member.grant',
        domain: 'roles',
        availability: 'route_to_screen',
        reason: 'privilege_decision',
        // Which role is the decision itself, so it is gathered and then handed
        // over rather than applied: naming it does not grant it.
        requirements: [
            { key: 'role', kind: 'choice', choices: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] },
        ],
        readiness: [],
        resultCheck: 'human_handoff_route',
        target: { module: 'auth', service: 'AuthController', method: 'updateUser', table: 'public.users' },
        roles: ['super_admin', 'tenant_admin'],
        route: '/admin/users',
    },
    {
        key: 'publication.agent.publish',
        domain: 'publication',
        availability: 'route_to_screen',
        reason: 'customer_facing_decision',
        requirements: [],
        // Publishing an agent that nothing reaches, or that never escalates,
        // is a round trip back to where the person started.
        readiness: ['agent_active', 'channel_assignment', 'handoff_triggers', 'fallback_message'],
        resultCheck: 'assessment',
        target: { module: 'persona', service: 'AgentPublicationService', method: 'publish', table: 'agent_publication_events' },
        roles: ['super_admin', 'tenant_admin'],
        route: '/admin/agent',
    },
    {
        key: 'payments.rail.configure',
        domain: 'payments',
        availability: 'route_to_screen',
        reason: 'credentials_required',
        // `setConfig` takes accessToken, privateKey, webhookSecret and
        // eventsSecret. None of them can appear here: the provider is the only
        // part of that call Assist is allowed to know.
        requirements: [{ key: 'provider', kind: 'choice', choices: ['mercadopago', 'wompi'] }],
        readiness: [],
        resultCheck: 'assessment',
        target: { module: 'tenant-payments', service: 'TenantPaymentsService', method: 'setConfig', table: 'tenant_payment_provider_configs' },
        roles: ['super_admin', 'tenant_admin'],
        route: '/admin/settings/integrations/payments',
    },
    {
        // Booking is not a content object: it emits `appointment.created`, which
        // confirms and reminds the customer and syncs an external calendar.
        key: 'agenda.appointment.book',
        domain: 'agenda',
        availability: 'route_to_screen',
        reason: 'outward_facing_effect',
        requirements: [],
        // A booking screen with no service and no availability has nothing to
        // book, and the two checks that say so are the ones to fix first.
        readiness: ['tool_appointments'],
        resultCheck: 'tool_appointments',
        target: { module: 'appointments', service: 'AppointmentsService', method: 'create', table: 'appointments' },
        roles: ['super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent'],
        route: '/admin/appointments',
    },
    {
        // Saving availability replaces the person's whole week rather than adding
        // a row, so there is nothing for a reviewer to accept or delete.
        key: 'agenda.availability.replace',
        domain: 'agenda',
        availability: 'route_to_screen',
        reason: 'destructive_replacement',
        requirements: [],
        readiness: [],
        resultCheck: 'tool_appointments',
        target: { module: 'appointments', service: 'AppointmentsService', method: 'saveAvailability', table: 'availability_slots' },
        roles: ['super_admin', 'tenant_admin', 'tenant_supervisor'],
        route: '/admin/appointments',
    },
    {
        // A campaign schedules sends to the tenant's customers through a channel.
        key: 'catalogue.campaign.create',
        domain: 'catalogue',
        availability: 'route_to_screen',
        reason: 'outward_facing_effect',
        requirements: [],
        readiness: [],
        resultCheck: 'assessment',
        target: { module: 'catalog', service: 'CatalogService', method: 'createCampaign', table: 'campaigns' },
        roles: ['super_admin', 'tenant_admin', 'tenant_supervisor'],
        route: '/admin/catalog/campaigns',
    },
    {
        // An offer is a price the agent will then quote, structured in
        // `conditions_json` and bound to a course or campaign that must already
        // exist. Assist would be guessing at a commitment, not writing text.
        key: 'catalogue.offer.create',
        domain: 'catalogue',
        availability: 'route_to_screen',
        reason: 'commercial_commitment',
        requirements: [],
        // An offer is bound to a course or a campaign that must already exist,
        // so the catalogue check is what says the screen has anything to offer.
        readiness: ['tool_catalog'],
        resultCheck: 'tool_offers',
        target: { module: 'catalog', service: 'CatalogService', method: 'createOffer', table: 'commercial_offers' },
        roles: ['super_admin', 'tenant_admin', 'tenant_supervisor'],
        route: '/admin/catalog/offers',
    },
] as const satisfies readonly AgentOperationDefinition[]);

const REGISTRY_BY_KEY = new Map<string, AgentOperationDefinition>(
    AGENT_OPERATION_REGISTRY.map(definition => [definition.key, definition]),
);

export function getAgentOperation(key: string): AgentOperationDefinition | undefined {
    return REGISTRY_BY_KEY.get(key);
}

export function isExecutableAgentOperation(
    definition: AgentOperationDefinition | undefined,
): definition is AgentExecutableOperation {
    return definition?.availability === 'executable';
}

// ─── Typed inputs ───────────────────────────────────────────────────────────

export const AGENT_LEGAL_TEXT_TYPES = ['privacy', 'terms', 'data_processing', 'general'] as const;
export type AgentLegalTextType = typeof AGENT_LEGAL_TEXT_TYPES[number];

export const AGENT_COURSE_MODALITIES = ['presencial', 'virtual', 'hibrida'] as const;
export type AgentCourseModality = typeof AGENT_COURSE_MODALITIES[number];

export interface AgentOperationInputMap {
    'knowledge.faq.create': { title: string; content: string };
    'policies.legal_text.create': { name: string; type: AgentLegalTextType; text: string };
    'catalogue.course.create': {
        name: string; description: string; price?: number; currency?: string;
        durationHours?: number; modality?: AgentCourseModality;
    };
    'agenda.service.create': {
        name: string; description?: string; durationMinutes: number; price?: number; currency?: string;
    };
}
export type AgentOperationInput<K extends AgentExecutableOperationKey> = AgentOperationInputMap[K];

export type AgentOperationInputRule =
    | 'required' | 'type' | 'too_long' | 'out_of_range' | 'not_allowed' | 'unknown_field';

export interface AgentOperationInputViolation { field: string; rule: AgentOperationInputRule }

export type AgentOperationInputResult<K extends AgentExecutableOperationKey> =
    | { ok: true; value: AgentOperationInputMap[K] }
    | { ok: false; violations: AgentOperationInputViolation[] };

/** Hard ceilings. The plan may be stricter (the owning service still checks it). */
export const AGENT_OPERATION_INPUT_LIMITS = Object.freeze({
    title: 200,
    faqContent: 20_000,
    legalText: 50_000,
    description: 5_000,
    maxPrice: 1_000_000_000,
    minServiceMinutes: 5,
    maxServiceMinutes: 1_440,
    maxCourseHours: 10_000,
});

interface FieldReader {
    violations: AgentOperationInputViolation[];
    text(field: string, value: unknown, maxLength: number, required: boolean): string | undefined;
    number(field: string, value: unknown, min: number, max: number, required: boolean, integer: boolean): number | undefined;
    oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[], required: boolean): T | undefined;
    currency(field: string, value: unknown): string | undefined;
}

function reader(): FieldReader {
    const violations: AgentOperationInputViolation[] = [];
    const missing = (field: string, value: unknown, required: boolean): boolean => {
        if (value !== undefined && value !== null) return false;
        if (required) violations.push({ field, rule: 'required' });
        return true;
    };
    return {
        violations,
        text(field, value, maxLength, required) {
            if (missing(field, value, required)) return undefined;
            if (typeof value !== 'string') { violations.push({ field, rule: 'type' }); return undefined; }
            const trimmed = value.trim();
            if (!trimmed) { if (required) violations.push({ field, rule: 'required' }); return undefined; }
            if (trimmed.length > maxLength) { violations.push({ field, rule: 'too_long' }); return undefined; }
            return trimmed;
        },
        number(field, value, min, max, required, integer) {
            if (missing(field, value, required)) return undefined;
            if (typeof value !== 'number' || !Number.isFinite(value)) { violations.push({ field, rule: 'type' }); return undefined; }
            if (integer && !Number.isInteger(value)) { violations.push({ field, rule: 'type' }); return undefined; }
            if (value < min || value > max) { violations.push({ field, rule: 'out_of_range' }); return undefined; }
            return value;
        },
        oneOf(field, value, allowed, required) {
            if (missing(field, value, required)) return undefined;
            if (typeof value !== 'string') { violations.push({ field, rule: 'type' }); return undefined; }
            if (!(allowed as readonly string[]).includes(value)) { violations.push({ field, rule: 'not_allowed' }); return undefined; }
            return value as any;
        },
        currency(field, value) {
            if (value === undefined || value === null) return undefined;
            if (typeof value !== 'string') { violations.push({ field, rule: 'type' }); return undefined; }
            const code = value.trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(code)) { violations.push({ field, rule: 'not_allowed' }); return undefined; }
            return code;
        },
    };
}

/**
 * A field the model invented is a violation, not something to drop quietly:
 * silently ignoring it would let Assist tell the owner it set something it
 * never set.
 */
function rejectUnknownFields(raw: Record<string, unknown>, allowed: readonly string[], violations: AgentOperationInputViolation[]): void {
    for (const field of Object.keys(raw)) {
        if (!allowed.includes(field)) violations.push({ field, rule: 'unknown_field' });
    }
}

type InputValidator<K extends AgentExecutableOperationKey> = (raw: Record<string, unknown>) => AgentOperationInputResult<K>;

const L = AGENT_OPERATION_INPUT_LIMITS;

const VALIDATORS: { [K in AgentExecutableOperationKey]: InputValidator<K> } = {
    'knowledge.faq.create': raw => {
        const read = reader();
        rejectUnknownFields(raw, ['title', 'content'], read.violations);
        const title = read.text('title', raw.title, L.title, true);
        const content = read.text('content', raw.content, L.faqContent, true);
        if (read.violations.length) return { ok: false, violations: read.violations };
        return { ok: true, value: { title: title!, content: content! } };
    },
    'policies.legal_text.create': raw => {
        const read = reader();
        rejectUnknownFields(raw, ['name', 'type', 'text'], read.violations);
        const name = read.text('name', raw.name, L.title, true);
        const type = read.oneOf('type', raw.type, AGENT_LEGAL_TEXT_TYPES, true);
        const text = read.text('text', raw.text, L.legalText, true);
        if (read.violations.length) return { ok: false, violations: read.violations };
        return { ok: true, value: { name: name!, type: type!, text: text! } };
    },
    'catalogue.course.create': raw => {
        const read = reader();
        rejectUnknownFields(raw, ['name', 'description', 'price', 'currency', 'durationHours', 'modality'], read.violations);
        const name = read.text('name', raw.name, L.title, true);
        const description = read.text('description', raw.description, L.description, true);
        const price = read.number('price', raw.price, 0, L.maxPrice, false, false);
        const currency = read.currency('currency', raw.currency);
        const durationHours = read.number('durationHours', raw.durationHours, 1, L.maxCourseHours, false, true);
        const modality = read.oneOf('modality', raw.modality, AGENT_COURSE_MODALITIES, false);
        if (read.violations.length) return { ok: false, violations: read.violations };
        return {
            ok: true,
            value: {
                name: name!, description: description!,
                ...(price === undefined ? {} : { price }),
                ...(currency === undefined ? {} : { currency }),
                ...(durationHours === undefined ? {} : { durationHours }),
                ...(modality === undefined ? {} : { modality }),
            },
        };
    },
    'agenda.service.create': raw => {
        const read = reader();
        rejectUnknownFields(raw, ['name', 'description', 'durationMinutes', 'price', 'currency'], read.violations);
        const name = read.text('name', raw.name, L.title, true);
        const description = read.text('description', raw.description, L.description, false);
        const durationMinutes = read.number('durationMinutes', raw.durationMinutes, L.minServiceMinutes, L.maxServiceMinutes, true, true);
        const price = read.number('price', raw.price, 0, L.maxPrice, false, false);
        const currency = read.currency('currency', raw.currency);
        if (read.violations.length) return { ok: false, violations: read.violations };
        return {
            ok: true,
            value: {
                name: name!, durationMinutes: durationMinutes!,
                ...(description === undefined ? {} : { description }),
                ...(price === undefined ? {} : { price }),
                ...(currency === undefined ? {} : { currency }),
            },
        };
    },
};

export function validateAgentOperationInput<K extends AgentExecutableOperationKey>(
    operation: K,
    raw: unknown,
): AgentOperationInputResult<K> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, violations: [{ field: 'input', rule: 'type' }] };
    }
    return VALIDATORS[operation](raw as Record<string, unknown>);
}

// ─── Review, apply and the receipt ──────────────────────────────────────────

/**
 * What a reviewer sees before anything is written.
 *
 * A creation has no prior state, so `before` is null and `beforeState` says so
 * out loud. Rendering an empty diff here would read as "no changes" — the exact
 * opposite of what is about to happen.
 */
export interface AgentContentProposalPreview {
    before: null;
    beforeState: 'does_not_exist';
    /** Field by field, exactly what will be written. */
    after: Array<{ field: string; value: string | number | boolean }>;
}

export interface AgentContentProposal {
    id: string;
    operation: AgentExecutableOperationKey;
    domain: AgentOperationDomain;
    target: AgentOperationTarget;
    /** Where the person goes to read, edit or delete the object afterwards. */
    route: string;
    digest: string;
    status: 'proposed' | 'applied' | 'expired';
    expiresAt: string;
    preview: AgentContentProposalPreview;
    createdObjectId?: string;
}

/** `replayed` is never silence: the second apply returns the first object. */
export type AgentContentApplyOutcome = 'created' | 'replayed';

export type AgentContentVerificationReason =
    /** The proposal was claimed but its create never completed; nothing exists. */
    | 'object_missing'
    /** The row was written and the read-back did not answer. */
    | 'reread_failed'
    /** The object exists; the audit row could not be written beside it. */
    | 'audit_unavailable';

export interface AppliedAgentContentObject {
    proposal: AgentContentProposal;
    outcome: AgentContentApplyOutcome;
    object: { id: string; label: string; route: string } | null;
    /**
     * Whether the created row was read back and its audit written. It says
     * nothing about whether the content is any good — a person still reviews it
     * on `route`.
     */
    verification: 'verified' | 'unavailable';
    verificationReason: AgentContentVerificationReason | null;
}

// ─── The registry as this caller sees it ────────────────────────────────────

export type AgentOperationBlockedReason =
    | 'role_not_permitted'
    | 'plan_limit_reached'
    | 'plan_feature_missing'
    /** The gate itself could not be read, so the answer is no. */
    | 'gate_unavailable';

export type AgentOperationAvailabilityReason = AgentOperationBlockedReason | AgentOperationRouteReason;

export interface AgentOperationAvailability {
    key: AgentOperationKey;
    domain: AgentOperationDomain;
    /**
     * `executable` — this caller can propose it now.
     * `blocked` — Assist could run it, but this caller's role or plan says no.
     * `route_to_screen` — Assist will never run it; `route` owns the decision.
     */
    availability: 'executable' | 'blocked' | 'route_to_screen';
    route: string;
    reason: AgentOperationAvailabilityReason | null;
}

// ─── Handoff to the screen that owns the decision ───────────────────────────

/**
 * A route is not a handoff. "Andá a Canales" leaves the person to work out what
 * they came for, and Assist to guess afterwards whether it worked.
 *
 * A handoff is the four things the directive asks for, in one object: the
 * non-secret requirements gathered, the readiness that says the screen is worth
 * opening at all, the exact link with what the screen can honour already filled
 * in, and the check to re-read when they come back — so the answer is what
 * actually changed rather than an assumption that it did.
 */
export const AGENT_HANDOFF_RETURN_PARAM = 'assistOp' as const;

export interface AgentHandoffRefusal {
    /** Declared, absent, and not optional. */
    readonly missing: readonly string[];
    /** Supplied, and not one of the declared choices — or not a string at all. */
    readonly invalid: readonly string[];
    /** Supplied and not declared. Never forwarded: the link carries only what is declared. */
    readonly unknown: readonly string[];
}

export interface AgentHandoffPlan {
    readonly operation: AgentRoutedOperationKey;
    /** The screen, with the declared parameters that it honours already set. */
    readonly href: string;
    /** Everything gathered, including what no parameter carries, for the chat to keep. */
    readonly collected: Readonly<Record<string, string>>;
    /** Check codes that are not resolved yet, so the screen would be a round trip. */
    readonly readiness: readonly string[];
    /** What to re-read when the person comes back. */
    readonly resultCheck: string;
    readonly reason: AgentOperationRouteReason;
}

/**
 * Builds the handoff, or says exactly why it cannot.
 *
 * `unresolvedReadiness` is passed in rather than looked up: this file knows
 * which codes matter and has no way to know their status, and inventing a
 * status here would be the same mistake as a screen that assumes its own
 * preconditions.
 */
export function buildAgentHandoff(
    key: string,
    collected: Record<string, unknown> = {},
    unresolvedReadiness: readonly string[] = [],
): { ok: true; plan: AgentHandoffPlan } | { ok: false; refusal: AgentHandoffRefusal } {
    const definition = getAgentOperation(key);
    if (!definition || definition.availability !== 'route_to_screen') {
        return { ok: false, refusal: { missing: [], invalid: [], unknown: [key] } };
    }
    const declared = new Map(definition.requirements.map(requirement => [requirement.key, requirement]));
    const missing: string[] = [];
    const invalid: string[] = [];
    const unknown = Object.keys(collected).filter(field => !declared.has(field));
    const accepted: Record<string, string> = {};
    for (const requirement of definition.requirements) {
        const raw = collected[requirement.key];
        if (raw === undefined || raw === null || `${raw}`.trim() === '') {
            if (!requirement.optional) missing.push(requirement.key);
            continue;
        }
        if (typeof raw !== 'string') { invalid.push(requirement.key); continue; }
        const value = raw.trim();
        // A free-text value is bounded here rather than at the screen: it goes
        // into a URL, and a URL nobody bounded is a URL somebody will overflow.
        if (value.length > 120) { invalid.push(requirement.key); continue; }
        if (requirement.kind === 'choice' && !(requirement.choices ?? []).includes(value)) {
            invalid.push(requirement.key);
            continue;
        }
        accepted[requirement.key] = value;
    }
    if (missing.length || invalid.length) return { ok: false, refusal: { missing, invalid, unknown } };

    const params: string[] = [];
    for (const requirement of definition.requirements) {
        const value = accepted[requirement.key];
        if (requirement.param && value !== undefined) {
            params.push(`${requirement.param}=${encodeURIComponent(value)}`);
        }
    }
    // The return marker is always carried, even when the screen honours no
    // parameter of its own: it is what lets the person come back to the same
    // conversation instead of starting it again.
    params.push(`${AGENT_HANDOFF_RETURN_PARAM}=${encodeURIComponent(definition.key)}`);
    const href = `${definition.route}${definition.route.includes('?') ? '&' : '?'}${params.join('&')}`;
    return {
        ok: true,
        plan: {
            operation: definition.key,
            href,
            collected: Object.freeze({ ...accepted }),
            readiness: Object.freeze(definition.readiness.filter(code => unresolvedReadiness.includes(code))),
            resultCheck: definition.resultCheck,
            reason: definition.reason,
        },
    };
}

/** Every routed operation, for a UI or a prompt that has to list them. */
export function routedAgentOperations(): readonly AgentRoutedOperation[] {
    return Object.freeze(AGENT_OPERATION_REGISTRY
        .filter((definition): definition is AgentRoutedOperation => definition.availability === 'route_to_screen'));
}
