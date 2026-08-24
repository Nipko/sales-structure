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
import { STATIC_TOOL_NAMES, TOOL_POLICY_REGISTRY } from './tool-policy-registry';

/** Derived from the canonical registry; there is no second allowlist to drift. */
export const AGENT_TEST_SAFE_TOOL_NAMES: readonly string[] = Object.freeze(
    STATIC_TOOL_NAMES.filter(name => TOOL_POLICY_REGISTRY[name].agentTestAllowed),
);

export const AGENT_TEST_SANDBOX_CONTACT_ID = '00000000-0000-4000-8000-00000000a9e7';
export const EVAL_SANDBOX_CONTACT_ID = '00000000-0000-4000-8000-00000000eba1';
const ALLOWED_SANDBOX_CONTACT_IDS = new Set([
    AGENT_TEST_SANDBOX_CONTACT_ID,
    EVAL_SANDBOX_CONTACT_ID,
]);

export function isAgentTestSafeToolName(name: unknown): name is string {
    return typeof name === 'string' && TOOL_POLICY_REGISTRY[name]?.agentTestAllowed === true;
}

/**
 * Writers the evaluation gate may actually execute, against the eval sandbox
 * contact and nothing else.
 *
 * The gate was designed to assert real side-effects ("after this conversation an
 * appointment must exist") and could never pass: the only executable surface was
 * read-only, so every scenario with expected actions failed for a reason that had
 * nothing to do with the agent. A permanent false failure is worse than no gate,
 * because it teaches everyone to ignore it.
 *
 * Membership is earned, not assumed. A tool enters this list only once its
 * handler is replaced by the isolated `evalMode` adapter (which has no access
 * to calendar sync, notifications, providers or domain events) AND its table
 * is in the eval service's cleanup registry, so a verified run leaves nothing
 * behind. The registry below is the complete audited surface.
 */
export interface EvalWriterSandboxFamily {
    /**
     * audited: may persist only through the isolated eval adapter.
     * identity_challenge: may be invoked only to prove the identity step-up
     * denial; it
     * never reaches a domain writer and never sends an OTP from an eval.
     */
    status: 'audited' | 'identity_challenge' | 'pending';
    tools: readonly string[];
    table: string;
    contactColumn?: string;
    /** Why a pending family is not executable yet. */
    pendingReason?: string;
}

/**
 * Family-level sandbox registry. Pending entries are intentionally visible:
 * they are implementation work, not writers that silently disappear from the
 * eval plan. A family becomes executable only after its external effects are
 * suppressed and deterministic cleanup is proven.
 */
export const EVAL_WRITER_SANDBOX_FAMILIES: Readonly<Record<string, EvalWriterSandboxFamily>> = Object.freeze({
    appointments: Object.freeze({
        status: 'audited', tools: Object.freeze(['create_appointment']),
        table: 'appointments', contactColumn: 'contact_id',
    }),
    property_bookings: Object.freeze({
        status: 'audited', tools: Object.freeze(['create_property_booking']),
        table: 'property_bookings', contactColumn: 'contact_id',
    }),
    tour_bookings: Object.freeze({
        status: 'audited', tools: Object.freeze(['create_tour_booking']),
        table: 'tour_bookings', contactColumn: 'contact_id',
    }),
    restaurant_orders: Object.freeze({
        status: 'audited', tools: Object.freeze(['place_order']),
        table: 'food_orders', contactColumn: 'contact_id',
    }),
    class_bookings: Object.freeze({
        status: 'audited', tools: Object.freeze(['book_class']),
        table: 'class_bookings', contactColumn: 'contact_id',
    }),
    enrollments: Object.freeze({
        status: 'audited', tools: Object.freeze(['enroll_student']),
        table: 'enrollments', contactColumn: 'contact_id',
    }),
    service_requests: Object.freeze({
        status: 'audited', tools: Object.freeze(['create_service_request']),
        table: 'service_requests', contactColumn: 'contact_id',
    }),
    photo_sessions: Object.freeze({
        status: 'audited', tools: Object.freeze(['request_photo_quote']),
        table: 'photo_sessions', contactColumn: 'contact_id',
    }),
    resource_rentals: Object.freeze({
        status: 'audited', tools: Object.freeze(['create_vehicle_rental', 'create_pet_boarding']),
        table: 'resource_rentals', contactColumn: 'contact_id',
    }),
    catalog_orders: Object.freeze({
        status: 'audited', tools: Object.freeze(['place_catalog_order']),
        table: 'orders', contactColumn: 'contact_id',
    }),
    insurance_claims: Object.freeze({
        status: 'identity_challenge', tools: Object.freeze(['file_claim']),
        table: 'insurance_claims',
    }),
});

export const EVAL_WRITABLE_TOOL_NAMES: readonly string[] = Object.freeze(
    Object.values(EVAL_WRITER_SANDBOX_FAMILIES)
        .filter(family => family.status !== 'pending')
        .flatMap(family => family.tools),
);
export const EVAL_SANDBOX_MUTATING_TOOL_NAMES: readonly string[] = Object.freeze(
    Object.values(EVAL_WRITER_SANDBOX_FAMILIES)
        .filter(family => family.status === 'audited')
        .flatMap(family => family.tools),
);
const EVAL_WRITABLE_TOOLS = new Set(EVAL_WRITABLE_TOOL_NAMES);
const EVAL_SANDBOX_MUTATING_TOOLS = new Set(EVAL_SANDBOX_MUTATING_TOOL_NAMES);
const EVAL_IDENTITY_CHALLENGE_TOOLS = new Set(
    Object.values(EVAL_WRITER_SANDBOX_FAMILIES)
        .filter(family => family.status === 'identity_challenge')
        .flatMap(family => family.tools),
);

export function isEvalWritableToolName(name: unknown): name is string {
    return typeof name === 'string' && EVAL_WRITABLE_TOOLS.has(name);
}

export function isEvalSandboxMutatingToolName(name: unknown): name is string {
    return typeof name === 'string' && EVAL_SANDBOX_MUTATING_TOOLS.has(name);
}

export function isEvalIdentityChallengeToolName(name: unknown): name is string {
    return typeof name === 'string' && EVAL_IDENTITY_CHALLENGE_TOOLS.has(name);
}

/**
 * The eval gate may execute this tool right now: it is an audited writer AND the
 * run is bound to the eval sandbox contact. Both halves are required — the flag
 * alone is execution metadata, never permission to write a tenant's real data.
 */
export function canEvalExecuteWriter(name: unknown, contactId?: string): boolean {
    return isEvalWritableToolName(name)
        && contactId?.toLowerCase() === EVAL_SANDBOX_CONTACT_ID;
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
