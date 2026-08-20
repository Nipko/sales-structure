import type { ToolDefinition } from '@parallext/shared';
import { ASSURANCE_LEVEL_MATRIX } from '@parallext/shared';
import { getToolPolicy } from './tool-policy-registry';
import { IDENTITY_STEP_UP_TOOLS } from './tools/insurance-tools';

/**
 * Publishes the OTP pair whenever the turn carries a tool that needs step-up.
 *
 * The guarded reads and their key were decided independently: step-up
 * publication was a hand-kept list of four tool families (`insurance`,
 * `appointments`, `treatments`, `professionalServices`), while the assurance
 * level that actually triggers verification lives on each tool's policy. Any A2
 * tool outside those four families — `get_check_in_instructions` for a rental,
 * `get_vaccination_status` for a groomer, `get_case_status`, `list_my_claims` —
 * made the guard send a code the agent then had no tool to consume. The
 * customer typed the code into a conversation that could not read it, and the
 * turn looped until it escalated.
 *
 * Deriving from the published set makes that class of dead end impossible: the
 * key ships exactly when a lock is present, for every family, forever.
 */
export function identityStepUpToolsFor(tools: readonly ToolDefinition[]): ToolDefinition[] {
    const stepUpNames = new Set(IDENTITY_STEP_UP_TOOLS.map(tool => String(tool.name)));
    let needsStepUp = false;

    for (const tool of tools) {
        const name = String(tool?.name || '');
        if (!name || stepUpNames.has(name)) continue;
        const policy = getToolPolicy(name);
        if (!policy) continue;
        if (ASSURANCE_LEVEL_MATRIX[policy.assurance]?.requiresStepUpIdentity) {
            needsStepUp = true;
            break;
        }
    }
    if (!needsStepUp) return [];

    const published = new Set(tools.map(tool => String(tool?.name || '')));
    return IDENTITY_STEP_UP_TOOLS.filter(tool => !published.has(String(tool.name)));
}

/**
 * Tool names that must survive the per-turn relevance cut.
 *
 * The retrieval step keeps ten tools and pins confirmable writers, which the
 * OTP tools are not — they are `confirmation: 'not_required'` reads. So the cut
 * could drop `verify_identity_code` on precisely the turn the customer typed
 * their code. Pinning them costs two slots and removes a dead end that only
 * appears under load, which is the worst kind to debug.
 */
export function identityStepUpToolNames(): string[] {
    return IDENTITY_STEP_UP_TOOLS.map(tool => String(tool.name));
}
