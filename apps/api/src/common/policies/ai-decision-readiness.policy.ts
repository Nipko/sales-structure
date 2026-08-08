export const AI_DECISION_OUTCOMES = [
    'conversation_next_best_action',
    'crm_lead_next_best_action',
] as const;
export type AiDecisionOutcome = typeof AI_DECISION_OUTCOMES[number];
export const AI_DECISION_MAX_LINEAGE_FRESHNESS_MS = 5 * 60_000;

export type AiDecisionLineageSource =
    | 'tenant.messages'
    | 'tenant.leads'
    | 'tenant.lead_message_aggregate';

export interface AiDecisionLineageEvidence {
    source: AiDecisionLineageSource;
    recordId: string;
    /** Time this exact projection was read from its authoritative source. */
    readAt: string;
    /** Optional source mutation time; old facts remain valid when freshly read. */
    sourceUpdatedAt?: string;
    /** Read snapshot must be reloaded after this time. */
    freshUntil: string;
}

export interface OutcomeEvaluationCertification {
    outcome: AiDecisionOutcome;
    suiteVersion: string;
    evaluatedAt: string;
    validUntil: string;
    passed: boolean;
    sampleSize: number;
    minimumSampleSize: number;
}

export interface AiDecisionReadinessInput {
    outcome: AiDecisionOutcome;
    lineage: readonly AiDecisionLineageEvidence[];
    evaluation?: OutcomeEvaluationCertification | null;
    now?: Date;
}

export interface AiDecisionReadinessResult {
    allowed: boolean;
    reasons: readonly string[];
}

function timestamp(value: unknown): number | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Closed-world readiness gate used immediately before any NBA provider call. */
export function evaluateAiDecisionReadiness(
    input: AiDecisionReadinessInput,
): AiDecisionReadinessResult {
    const now = (input.now || new Date()).getTime();
    const reasons: string[] = [];
    const evaluation = input.evaluation;

    if (!evaluation) {
        reasons.push('outcome_evaluation_missing');
    } else {
        const evaluatedAt = timestamp(evaluation.evaluatedAt);
        const validUntil = timestamp(evaluation.validUntil);
        if (evaluation.outcome !== input.outcome) reasons.push('outcome_evaluation_mismatch');
        if (!evaluation.suiteVersion?.trim()) reasons.push('outcome_evaluation_version_missing');
        if (evaluation.passed !== true) reasons.push('outcome_evaluation_failed');
        if (!Number.isInteger(evaluation.sampleSize)
            || !Number.isInteger(evaluation.minimumSampleSize)
            || evaluation.minimumSampleSize < 1
            || evaluation.sampleSize < evaluation.minimumSampleSize) {
            reasons.push('outcome_evaluation_sample_insufficient');
        }
        if (evaluatedAt === null || evaluatedAt > now) reasons.push('outcome_evaluation_time_invalid');
        if (validUntil === null || validUntil <= now) reasons.push('outcome_evaluation_expired');
    }

    if (!Array.isArray(input.lineage) || input.lineage.length === 0) {
        reasons.push('lineage_missing');
    } else {
        input.lineage.forEach((item, index) => {
            const readAt = timestamp(item?.readAt);
            const freshUntil = timestamp(item?.freshUntil);
            const sourceUpdatedAt = item?.sourceUpdatedAt === undefined
                ? undefined : timestamp(item.sourceUpdatedAt);
            if (!item?.source || !item?.recordId?.trim()) reasons.push(`lineage_${index}_identity_invalid`);
            if (readAt === null || readAt > now) reasons.push(`lineage_${index}_read_time_invalid`);
            if (freshUntil === null || freshUntil <= now || (readAt !== null && freshUntil <= readAt)) {
                reasons.push(`lineage_${index}_stale`);
            }
            if (readAt !== null && freshUntil !== null
                && freshUntil - readAt > AI_DECISION_MAX_LINEAGE_FRESHNESS_MS) {
                reasons.push(`lineage_${index}_freshness_unbounded`);
            }
            if (sourceUpdatedAt === null || (sourceUpdatedAt !== undefined && readAt !== null && sourceUpdatedAt > readAt)) {
                reasons.push(`lineage_${index}_source_time_invalid`);
            }
        });
    }

    return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function createFreshLineage(
    source: AiDecisionLineageSource,
    recordId: string,
    readAt: Date,
    sourceUpdatedAt?: unknown,
    freshnessMs = 60_000,
): AiDecisionLineageEvidence {
    const sourceDate = sourceUpdatedAt ? new Date(String(sourceUpdatedAt)) : undefined;
    return {
        source,
        recordId,
        readAt: readAt.toISOString(),
        sourceUpdatedAt: sourceDate && !Number.isNaN(sourceDate.getTime()) ? sourceDate.toISOString() : undefined,
        freshUntil: new Date(readAt.getTime() + freshnessMs).toISOString(),
    };
}
