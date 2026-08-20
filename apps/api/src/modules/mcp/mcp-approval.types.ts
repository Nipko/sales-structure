/**
 * Effect an external MCP tool has on the world, as declared by the human who
 * approved it. Nothing in the MCP `tools/list` response carries this, so it is
 * reviewed rather than inferred — the whole point of the approval record.
 */
export type ToolEffectDeclaration =
    | 'read'
    | 'write'
    | 'payment'
    | 'notification'
    | 'irreversible';

/** Effects that can never run without a confirmed customer intent. */
export const MCP_EFFECTS_REQUIRING_CONFIRMATION: readonly ToolEffectDeclaration[] = [
    'write',
    'payment',
    'notification',
    'irreversible',
];
