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
 * handler honours `evalMode` (suppressing calendar sync, notifications and
 * domain events) AND its table is in the eval service's cleanup allowlist, so a
 * verified run leaves nothing behind. Today that is exactly one tool.
 */
export const EVAL_WRITABLE_TOOL_NAMES: readonly string[] = Object.freeze([
    'create_appointment',
]);
const EVAL_WRITABLE_TOOLS = new Set(EVAL_WRITABLE_TOOL_NAMES);

export function isEvalWritableToolName(name: unknown): name is string {
    return typeof name === 'string' && EVAL_WRITABLE_TOOLS.has(name);
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
