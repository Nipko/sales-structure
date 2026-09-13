/**
 * ═══ WHAT TO RECORD WHEN A DURABLE DELIVERY DID NOT HAPPEN ═══
 *
 * Two lanes answer this question — approved effects and operational notices —
 * and until now each answered it with its own inline expression. They had the
 * same defect, and one of them could have been fixed without the other, which
 * is how two copies of a rule stop being one rule.
 *
 * ── THE DEFECT THIS EXISTS TO PREVENT ───────────────────────────────────────
 *
 * Both lanes set a boolean immediately BEFORE running the send closure. It is a
 * proxy for "a request may have left, so we cannot say what the customer got",
 * and on that reading the row is closed `reconciliation_required` — a state
 * both recovery queries deliberately EXCLUDE, because a message that might
 * have reached a phone must not be re-sent by a sweep.
 *
 * But the spend gate lives INSIDE that closure. So a refusal — a decision this
 * platform made before addressing anybody — arrived with the proxy already
 * true, and an effect nobody sent was filed as one that might have arrived.
 * Not lost in the ordinary sense: removed from every mechanism that could have
 * noticed it was missing.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A refusal is raised only by our own checks, every one of them before any
 * request. It is positive knowledge that nothing was sent, and positive
 * knowledge outranks a proxy. Everything else keeps the behaviour it had.
 */

export interface DeliveryOutcomeInput {
    /** `true` once a request may have left. A proxy, and only a proxy. */
    readonly started: boolean;
    /** Did WE refuse this, before addressing anybody? */
    readonly refused: boolean;
}

export interface DeliveryOutcome {
    readonly state: 'suppressed' | 'reconciliation_required' | 'failed';
    /** Which of the three codes the caller should record. */
    readonly reason: 'refused' | 'outcome_unknown' | 'preflight_failed';
}

/**
 * The state a failed durable delivery is closed in.
 *
 * Pure, and shared by both lanes, so the ordering cannot drift between them.
 */
export function deliveryOutcome(input: DeliveryOutcomeInput): DeliveryOutcome {
    // FIRST, and that is the whole fix. Asking `started` first is what filed a
    // refusal as an unknown outcome.
    if (input.refused) return { state: 'suppressed', reason: 'refused' };
    if (input.started) return { state: 'reconciliation_required', reason: 'outcome_unknown' };
    return { state: 'failed', reason: 'preflight_failed' };
}
