import type { LLMResponse } from '../ai/interfaces/illm-provider.interface';
import type { JudgeResult } from './quality.service';

/**
 * Why a judge completion was refused. Codes, field names and enum values only:
 * the completion quotes the customer, so neither the log line nor the error that
 * reaches Sentry may carry any of its text. The old single message could not
 * tell a cut completion from a verdict that contradicted itself.
 */
export type QualityJudgeRejection =
    | 'empty_content'
    | 'content_filtered'
    | 'output_truncated'
    | 'not_json'
    | 'invalid_score'
    | 'invalid_resolution_status'
    | 'resolution_inconsistent'
    | 'invalid_flags'
    | 'invalid_resolution_reason';

export class QualityJudgeInvalidResponse extends Error {
    constructor(
        readonly reason: QualityJudgeRejection,
        readonly field: string | null,
        /** Enum-only diagnostics (`status=… resolved=…`), never judge text. */
        readonly detail: string | null = null,
    ) {
        // Keeps the historical prefix: alerts and log searches match on it.
        super(`QA judge returned an invalid response (${field ? `${reason}:${field}` : reason})`);
        this.name = 'QualityJudgeInvalidResponse';
    }
}

/** BullMQ hands the thrown instance back in-process; the name check survives a copy. */
export function isQualityJudgeInvalidResponse(error: unknown): error is QualityJudgeInvalidResponse {
    return error instanceof QualityJudgeInvalidResponse
        || ((error as any)?.name === 'QualityJudgeInvalidResponse' && typeof (error as any)?.reason === 'string');
}

const SCORES = ['overall', 'resolution', 'tone', 'accuracy', 'empathy'] as const;
const RESOLUTION_STATUSES: ReadonlyArray<string> = ['resolved', 'unresolved', 'needs_customer_input', 'not_assessable'];

const describeResolved = (value: unknown) =>
    value === undefined ? 'missing' : value === null || typeof value === 'boolean' ? String(value) : `type_${typeof value}`;
const describeStatus = (value: unknown) =>
    value === undefined ? 'missing' : value === null ? 'null' : RESOLUTION_STATUSES.includes(value as string) ? String(value) : 'other';

/**
 * Strict on purpose: a score or a resolved verdict the judge did not clearly
 * give is never invented, and a numeric string is still refused. The only
 * reading accepted beyond the literal contract is the one that moves towards
 * "unknown", never away from it (see below).
 */
export function parseJudgeResponse(response: Pick<LLMResponse, 'content'> & { finishReason?: string | null }): JudgeResult {
    try {
        return validate(typeof response.content === 'string' ? response.content : '');
    } catch (error) {
        // A completion the provider cut or filtered is not a malformed verdict:
        // it never finished. Only override the byte-level reasons — an object
        // that parsed completely was not truncated in any way that matters.
        if (error instanceof QualityJudgeInvalidResponse && (error.reason === 'not_json' || error.reason === 'empty_content')) {
            if (response.finishReason === 'length') throw new QualityJudgeInvalidResponse('output_truncated', null);
            if (response.finishReason === 'content_filter') throw new QualityJudgeInvalidResponse('content_filtered', null);
        }
        throw error;
    }
}

function validate(raw: string): JudgeResult {
    if (!raw.trim()) throw new QualityJudgeInvalidResponse('empty_content', null);
    let parsed: any;
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
    } catch {
        throw new QualityJudgeInvalidResponse('not_json', null);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new QualityJudgeInvalidResponse('not_json', null);

    for (const field of SCORES) {
        if (typeof parsed[field] !== 'number' || !Number.isFinite(parsed[field]) || parsed[field] < 0 || parsed[field] > 10) {
            throw new QualityJudgeInvalidResponse('invalid_score', field);
        }
    }

    const resolutionStatus = parsed.resolutionStatus ?? (parsed.resolved === true ? 'resolved' : parsed.resolved === false ? 'unresolved' : null);
    const detail = `status=${describeStatus(parsed.resolutionStatus)} resolved=${describeResolved(parsed.resolved)}`;
    if (!RESOLUTION_STATUSES.includes(resolutionStatus)) {
        throw new QualityJudgeInvalidResponse('invalid_resolution_status', 'resolutionStatus', detail);
    }
    const inconclusive = resolutionStatus === 'needs_customer_input' || resolutionStatus === 'not_assessable';
    // The rubric defines `resolved` as a projection of resolutionStatus and
    // steers greeting-only conversations to needs_customer_input, but the
    // pre-mission rubric taught "false si quedó pendiente" and a model can still
    // write that boolean. At temperature 0.2 a conversation that gets it once
    // gets it on every retry, so the job ends in Sentry with no verdict at all.
    // `false` or an omitted field next to an
    // inconclusive status both say "not resolved"; the status says why, and the
    // unknown reading is the only one that invents neither a success nor a
    // failure. `true` next to an inconclusive status is a contradiction and is
    // still refused, as is any mismatch on a conclusive status.
    const resolved = inconclusive && (parsed.resolved === false || parsed.resolved === undefined) ? null : parsed.resolved;
    if (inconclusive ? resolved !== null : resolved !== (resolutionStatus === 'resolved')) {
        throw new QualityJudgeInvalidResponse('resolution_inconsistent', 'resolved', detail);
    }
    if (!Array.isArray(parsed.flags) || parsed.flags.some((flag: unknown) => typeof flag !== 'string')) {
        throw new QualityJudgeInvalidResponse('invalid_flags', 'flags');
    }
    if (typeof parsed.resolutionReason !== 'string') {
        throw new QualityJudgeInvalidResponse('invalid_resolution_reason', 'resolutionReason');
    }
    return {
        overall: parsed.overall,
        resolution: parsed.resolution,
        tone: parsed.tone,
        accuracy: parsed.accuracy,
        empathy: parsed.empathy,
        flags: parsed.flags,
        resolved,
        resolutionStatus,
        resolutionReason: parsed.resolutionReason,
    };
}
