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
const EVAL_SANDBOX_CONTACT_ID = '00000000-0000-4000-8000-00000000eba1';
const ALLOWED_SANDBOX_CONTACT_IDS = new Set([
    AGENT_TEST_SANDBOX_CONTACT_ID,
    EVAL_SANDBOX_CONTACT_ID,
]);

export function isAgentTestSafeToolName(name: unknown): name is string {
    return typeof name === 'string' && TOOL_POLICY_REGISTRY[name]?.agentTestAllowed === true;
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
