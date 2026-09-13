/**
 * ═══ WHEN META SAYS THE BUSINESS CANNOT PAY ═══
 *
 * From 1 October 2026 Meta charges the business's own WhatsApp Business Account
 * for every delivered service message. A WABA with no usable payment method
 * stops delivering — and it does not stop quietly. It answers, per message,
 * with an error that means "this account cannot be billed".
 *
 * Treated as an ordinary transport failure, that error is a catastrophe of a
 * specific and expensive kind: every message retries, every retry fails the same
 * way, the queue fills, and the tenant's customers hear nothing at all while the
 * logs fill with errors that all say the same thing. Nobody is told the one fact
 * that would fix it in ninety seconds — a card is missing, in Meta, on their
 * own account.
 *
 * ── WHY THIS IS A SEPARATE CLASSIFICATION ───────────────────────────────────
 *
 * Because the correct response is the opposite of the usual one. A transport
 * failure should be retried; this must NOT be, because every attempt is
 * identical and none of them can succeed until a human does something in a
 * different company's interface. A transport failure affects one message; this
 * affects every chargeable message from one account, and only that account — a
 * tenant with a second number on a funded WABA must keep working.
 *
 * ── WHAT IS IN THE SET, AND WHY IT IS SHORT ─────────────────────────────────
 *
 * `131042` is Meta's documented "business eligibility payment issue". It is here
 * because it is documented and because its meaning is unambiguous.
 *
 * Nothing else is guessed in. A code added from memory that turns out to mean
 * something else would pause a working account on a message that merely failed,
 * which is a self-inflicted outage — the exact failure this module exists to
 * prevent, caused by the module itself. New codes belong here only with the
 * documentation that says what they mean, and `detailSaysFunding` covers the
 * case where Meta explains the cause in words rather than in a code.
 */

/** Meta error codes that mean "this business account cannot be billed". */
export const FUNDING_ERROR_CODES: readonly number[] = Object.freeze([131042]);

/**
 * Phrases Meta uses when the code is generic but the explanation is not.
 *
 * Deliberately narrow and anchored on "payment"/"billing" together with a
 * failure word. A looser match would catch a message whose BODY mentions
 * payment — a tenant selling payment plans would pause itself.
 */
const FUNDING_PHRASES: readonly RegExp[] = Object.freeze([
    /business\s+eligibility\s+payment\s+issue/i,
    /payment\s+method[^.]{0,40}(missing|invalid|declined|expired|not\s+set)/i,
    /(add|update)\s+a\s+(valid\s+)?payment\s+method/i,
    /account\s+is\s+not\s+eligible[^.]{0,40}payment/i,
]);

export interface FundingSignal {
    /** Meta's numeric code, when there was one. */
    readonly code: number | null;
    /** Where it was seen: the immediate answer, or a later status webhook. */
    readonly source: 'http_response' | 'status_webhook';
    /** What Meta said, trimmed. Never a token, never a phone number. */
    readonly detail: string;
    readonly at: string;
}

/** Does this error code mean the business account cannot be billed? */
export function isFundingCode(code: unknown): boolean {
    const parsed = typeof code === 'number' ? code : Number(String(code ?? '').replace(/^\D*/, ''));
    return Number.isFinite(parsed) && FUNDING_ERROR_CODES.includes(parsed);
}

/** Did Meta explain a funding problem in words rather than in a code? */
export function detailSaysFunding(detail: unknown): boolean {
    const text = String(detail ?? '');
    if (!text) return false;
    return FUNDING_PHRASES.some(phrase => phrase.test(text));
}

/**
 * Classify one provider answer.
 *
 * Takes the shapes both roads actually produce: the Graph error object from an
 * HTTP response, and the flattened `{errorCode, errorDetail}` a status webhook
 * has already been reduced to. Returns `null` for everything that is not a
 * funding problem — which is almost everything, and must stay that way.
 */
export function fundingSignalFrom(input: {
    readonly source: FundingSignal['source'];
    readonly code?: unknown;
    readonly detail?: unknown;
    readonly at?: Date;
}): FundingSignal | null {
    // A namespaced code (`whatsapp:131042`) still has to be recognised: the
    // delivery-status writer namespaces every code it stores, and this reads
    // what that writer produced.
    const raw = String(input.code ?? '');
    const numeric = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
    const detail = String(input.detail ?? '').slice(0, 400);
    if (!isFundingCode(numeric) && !detailSaysFunding(detail)) return null;
    const parsed = Number(numeric);
    return Object.freeze({
        code: Number.isFinite(parsed) && parsed !== 0 ? parsed : null,
        source: input.source,
        detail: detail || 'Meta reported a business eligibility payment issue',
        at: (input.at ?? new Date()).toISOString(),
    });
}
