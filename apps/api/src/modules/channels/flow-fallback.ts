import { metaGraphAnswer, metaGraphClassifier } from './provider-error-classification';

/**
 * ═══ WHEN A FAILED FLOW MAY BECOME A SECOND MESSAGE ═══
 *
 * A WhatsApp Flow that Meta refuses should not leave the customer with
 * nothing, so the gateway falls back to sending the body as text. That is good
 * behaviour resting on a dangerous assumption: that the failure PROVED the Flow
 * did not happen.
 *
 * It did not. The catch swallowed every error — a 400 for an unpublished flow,
 * and equally a ten-second timeout, a reset connection, an HTML error page from
 * an edge. On a timeout the Flow may well have been delivered, and the fallback
 * put a second message on the customer's phone and a second charge on the
 * business's account, under one reservation that could only ever settle once.
 *
 * So the question this module answers is narrow and conservative:
 *
 *     does this failure PROVE that nothing was delivered?
 *
 * Only then may a second effect be created. Anything else is `indeterminate`:
 * the effect goes to reconciliation, the customer may or may not have received
 * the Flow, and the platform does not guess by sending again.
 *
 * ── WHY IT DEFERS TO THE SHARED CLASSIFIER ──────────────────────────────────
 *
 * Because "what does this provider answer prove" already has one answer in this
 * repository, grounded in Meta's own documented codes. A second opinion here
 * would eventually disagree with the durable lane about the same HTTP status,
 * and the two lanes would then handle one failure two ways.
 */

/**
 * What the adapter knows about a refused Flow.
 *
 * Thrown rather than returned because the adapter's contract is
 * `Promise<string>`, and every caller already handles the throw. What is new is
 * that the throw CARRIES the evidence: a bare `Error(message)` is exactly what
 * made a timeout indistinguishable from a rejection.
 */
export class FlowSendFailed extends Error {
    constructor(
        message: string,
        readonly evidence: {
            /** HTTP status, when an answer arrived at all. */
            readonly status?: number | null;
            /** The parsed body, when it could be read. */
            readonly body?: unknown;
            /** The underlying transport error, when no answer arrived. */
            readonly cause?: unknown;
        },
    ) {
        super(message);
        this.name = 'FlowSendFailed';
    }
}

export type FlowFailure =
    /** Meta refused it, conclusively. Nothing was delivered; a fallback is honest. */
    | { readonly kind: 'rejected'; readonly errorCode: string; readonly mayFallBack: true }
    /** No proof either way. The Flow may have arrived; a second POST must not happen. */
    | { readonly kind: 'indeterminate'; readonly errorCode: string; readonly mayFallBack: false };

/**
 * Classify a failed Flow attempt.
 *
 * Defaults to `indeterminate` for everything it does not recognise, which is
 * the expensive-looking choice and the cheap one: a Flow left in reconciliation
 * costs an operator a lookup, and a duplicate costs the business a charge and
 * the customer a second buzz for a message they already have.
 */
export function classifyFlowFailure(error: unknown): FlowFailure {
    const evidence = error instanceof FlowSendFailed ? error.evidence : null;

    // No answer at all — timeout, abort, reset. The request may have been
    // processed; nothing here says otherwise.
    if (!evidence || evidence.status === null || evidence.status === undefined) {
        const name = (evidence?.cause as any)?.name ?? (error as any)?.name;
        return Object.freeze({
            kind: 'indeterminate' as const,
            errorCode: name === 'TimeoutError' || name === 'AbortError'
                ? 'flow_provider_timeout'
                : `flow_transport_failure:${String((error as any)?.message || error).slice(0, 60)}`,
            mayFallBack: false as const,
        });
    }

    const outcome = metaGraphClassifier(
        metaGraphAnswer(evidence.status, evidence.body, 'messages'));

    // A receipt means Meta took it. That is not a failure to fall back from,
    // whatever else the answer said.
    if (outcome.kind === 'accepted') {
        return Object.freeze({
            kind: 'indeterminate' as const, errorCode: 'flow_accepted_after_all',
            mayFallBack: false as const,
        });
    }
    // A RETRYABLE rejection is Meta saying "not now". It does not prove the
    // message was never queued on some other attempt, and the effect is going
    // to be retried as itself — a fallback here would be a third message.
    if (outcome.kind === 'rejected' && !outcome.retryable) {
        return Object.freeze({
            kind: 'rejected' as const, errorCode: outcome.errorCode, mayFallBack: true as const,
        });
    }
    return Object.freeze({
        kind: 'indeterminate' as const,
        errorCode: outcome.kind === 'rejected' ? `retryable:${outcome.errorCode}` : outcome.errorCode,
        mayFallBack: false as const,
    });
}
