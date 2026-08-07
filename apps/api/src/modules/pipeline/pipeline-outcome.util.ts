export type PipelineTerminalOutcome = 'won' | 'lost';
export type PipelineDealStatus = PipelineTerminalOutcome | 'open';

export interface PipelineStageOutcomeInput {
    is_terminal?: boolean | null;
    terminal_outcome?: string | null;
    default_probability?: number | string | null;
}

/**
 * Resolve the business outcome of a terminal stage without relying on its slug.
 *
 * `terminal_outcome` is mandatory for terminal stages. Probability is display/
 * forecasting metadata and is never allowed to decide a business outcome.
 */
export function resolveTerminalOutcome(stage: PipelineStageOutcomeInput): PipelineTerminalOutcome | null {
    if (!stage.is_terminal) return null;

    if (stage.terminal_outcome === 'won' || stage.terminal_outcome === 'lost') {
        return stage.terminal_outcome;
    }

    throw new Error('Terminal pipeline stage requires explicit terminal_outcome: won or lost');
}

/**
 * Resolve the Deal mirror status for an Opportunity. Exclusive historical
 * timestamps take precedence because a legacy opportunity slug may no longer
 * exist in a tenant's customized pipeline; otherwise the stage contract is
 * canonical. Ambiguous timestamps deliberately fall back to the stage.
 */
export function resolveMirroredDealStatus(
    stage: PipelineStageOutcomeInput,
    opportunity?: { won_at?: unknown; lost_at?: unknown },
): PipelineDealStatus {
    if (stage.is_terminal) return resolveTerminalOutcome(stage)!;
    if (opportunity?.won_at && !opportunity?.lost_at) return 'won';
    if (opportunity?.lost_at && !opportunity?.won_at) return 'lost';
    return 'open';
}
