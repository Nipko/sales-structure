/**
 * Per-tool approval for external MCP servers.
 *
 * MCP was a false affordance. Every discovered tool was advertised to the model
 * (`conversations.service`), while the central guard rejected every `mcp__*`
 * call as `opaque_tool_not_approved`. The model saw a capability it could never
 * use, spent turns trying, and the customer got a dead end — and the dashboard
 * said "connected", which an owner reads as "working".
 *
 * The fix is not to loosen the guard. An MCP tool is a remote function of
 * unknown effect: it may charge money, mutate a third-party record or leak
 * data, and nothing in `tools/list` tells us which. So publication becomes a
 * consequence of an explicit, reviewed policy per tool — the same fields every
 * native tool declares — instead of a consequence of a connection existing.
 *
 * Until a tool is approved it is **inspectable, not executable**, and the UI
 * must say exactly that.
 */
import type { ToolEffectDeclaration } from './mcp-approval.types';

export interface McpToolApproval {
    /** Server id as stored in `tenant.settings.mcpServers[].id`. */
    serverId: string;
    /** Remote tool name, unprefixed. */
    toolName: string;
    /** What this tool does to the world. Reviewed by a human, never inferred. */
    effect: ToolEffectDeclaration;
    /** Whether the customer must confirm before it runs. */
    requiresConfirmation: boolean;
    /** Whether a human must approve each individual call. */
    requiresHumanApproval: boolean;
    /** Who signed off, so an approval is auditable. */
    approvedBy: string;
    approvedAt: string;
    /** Free-text justification kept with the record. */
    notes?: string;
}

/** Registered (prefixed) name for a remote tool. */
export function mcpRegisteredName(serverId: string, toolName: string): string {
    return `mcp__${serverId}__${toolName}`;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** Read approvals from tenant settings, ignoring anything malformed. */
export function readMcpApprovals(settings: unknown): McpToolApproval[] {
    const raw = (settings as any)?.mcpToolApprovals;
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry: any) => (
        entry
        && isNonEmptyString(entry.serverId)
        && isNonEmptyString(entry.toolName)
        && isNonEmptyString(entry.effect)
        && isNonEmptyString(entry.approvedBy)
        && isNonEmptyString(entry.approvedAt)
        && typeof entry.requiresConfirmation === 'boolean'
        && typeof entry.requiresHumanApproval === 'boolean'
    ));
}

/**
 * Registered names the agent may be shown.
 *
 * A `write` or `payment` approval is deliberately NOT enough on its own: those
 * effects also need the confirmation flag, because an irreversible remote call
 * with no confirmation policy is precisely what the central guard exists to
 * stop. An approval that forgets it is treated as not approved rather than
 * silently downgraded.
 */
export function approvedMcpToolNames(settings: unknown): Set<string> {
    const approved = new Set<string>();
    for (const entry of readMcpApprovals(settings)) {
        if (entry.effect !== 'read' && !entry.requiresConfirmation) continue;
        approved.add(mcpRegisteredName(entry.serverId, entry.toolName));
    }
    return approved;
}

/** Look up one approval by registered name. */
export function findMcpApproval(
    settings: unknown,
    registeredName: string,
): McpToolApproval | null {
    for (const entry of readMcpApprovals(settings)) {
        if (mcpRegisteredName(entry.serverId, entry.toolName) === registeredName) return entry;
    }
    return null;
}
