import type { ToolDefinition } from '@parallext/shared';
import { getToolPolicy } from './tool-policy-registry';
import { isAgentTestSafeToolName } from './agent-test-tool-policy';

/**
 * What Agent Test shows the operator versus what it is allowed to run.
 *
 * The test environment used to advertise a DIFFERENT, smaller toolset than
 * production and say nothing about the difference. So an owner could test an
 * agent, watch it behave, and ship something whose real contract they had never
 * seen: payments, OTP, vertical integrations, MCP and every writer were simply
 * absent from the screen.
 *
 * True parity cannot mean "execute everything", because Agent Test points at the
 * tenant's REAL schema — running writers there would book real appointments and
 * charge real cards to prove a prompt works. So parity is split in two, and both
 * halves are stated out loud:
 *
 * - **Resolution parity** — the same effective contract production would publish
 *   for this agent, right down to plan, provider health and readiness.
 * - **Execution honesty** — each tool says whether the test can run it and why
 *   not, instead of quietly vanishing.
 *
 * An operator who sees `create_payment_link — resolved, not executable in test`
 * knows two true things. One who saw nothing knew neither.
 */

export type ToolExecutabilityReason =
    | 'executable'
    /** A writer: running it would mutate the tenant's real data. */
    | 'writer_blocked_in_test'
    /** Reaches a third party we must not call from a test. */
    | 'external_effect_blocked_in_test'
    /** Needs an out-of-band code the test conversation cannot receive. */
    | 'step_up_unavailable_in_test'
    /** No reviewed policy: the same rule production applies. */
    | 'not_approved';

export interface ResolvedToolParity {
    name: string;
    /** Production would publish this tool for this agent, this turn. */
    resolved: true;
    executableInTest: boolean;
    reason: ToolExecutabilityReason;
    effect?: string;
    assurance?: string;
}

/**
 * Explain, per tool, whether Agent Test can execute it.
 *
 * Ordered from most to least specific so the reason an operator reads is the
 * one that actually applies: a payment writer is blocked because it is a
 * writer, not because it happens to also need step-up.
 */
export function explainToolExecutability(name: string): ToolExecutabilityReason {
    const policy = getToolPolicy(name);
    if (!policy) return 'not_approved';
    if (isAgentTestSafeToolName(name)) return 'executable';
    if (policy.effect === 'write') return 'writer_blocked_in_test';
    if (policy.externalEffect === 'provider_write' || policy.externalEffect === 'opaque') {
        return 'external_effect_blocked_in_test';
    }
    if (policy.assuranceEnforcement === 'step_up') return 'step_up_unavailable_in_test';
    return 'not_approved';
}

/**
 * The parity report shown alongside a test run.
 *
 * `resolvedTools` is what production would publish; `executedTools` is the
 * subset this environment may actually call. The gap between them is the point
 * of the report.
 */
export function buildToolParityReport(resolvedTools: readonly ToolDefinition[]): {
    resolvedCount: number;
    executableCount: number;
    tools: ResolvedToolParity[];
} {
    const tools = resolvedTools.map((tool): ResolvedToolParity => {
        const name = String(tool?.name || '');
        const policy = getToolPolicy(name);
        const reason = explainToolExecutability(name);
        return {
            name,
            resolved: true,
            executableInTest: reason === 'executable',
            reason,
            effect: policy?.effect,
            assurance: policy?.assurance,
        };
    });
    return {
        resolvedCount: tools.length,
        executableCount: tools.filter(t => t.executableInTest).length,
        tools,
    };
}
