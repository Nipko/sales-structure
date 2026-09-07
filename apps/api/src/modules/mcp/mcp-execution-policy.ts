import type { ToolPolicy } from '../conversations/tool-policy-registry';
import { hasExecutableMcpReview, type McpToolApproval } from './mcp-tool-approval';

/** A reviewed remote contract crosses exactly the same controls as native tools. */
export function reviewedMcpPolicy(approval: McpToolApproval | null | undefined): ToolPolicy | null {
    if (!hasExecutableMcpReview(approval)) return null;
    const writes = approval.effect !== 'read';
    const gatedRead = !writes && (approval.requiresConfirmation || approval.requiresHumanApproval);
    const assurance = approval.effect === 'irreversible' ? 'A4'
        : approval.effect === 'payment' ? 'A3'
            : approval.dataClassification === 'sensitive' ? 'A2'
                : writes || approval.dataClassification === 'contact' ? 'A1' : 'A0';
    return {
        effect: writes ? 'write' : gatedRead ? 'conditional_write' : 'read',
        dataClassification: approval.dataClassification!, assurance,
        assuranceEnforcement: 'central_guard',
        ownership: approval.contactIdArgument ? 'contact_scope' : 'tenant_scope',
        idempotency: writes || gatedRead ? 'central_ledger' : 'not_applicable',
        externalEffect: writes ? 'provider_write' : 'provider_read',
        downstreamEffects: [],
        confirmation: approval.requiresConfirmation ? 'runtime_enforced' : 'not_required',
        humanApproval: approval.requiresHumanApproval ? 'runtime_enforced' : 'not_required',
        agentTestAllowed: false, origin: 'mcp', commitsBusiness: writes,
    };
}
