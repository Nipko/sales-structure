import type { StrictDispatchOutcome } from './strict-dispatch-transport';

/**
 * What one provider answer proves, per provider.
 *
 * The rule this replaces was a blanket "any answered 5xx is a retryable
 * rejection". It is not true: a 5xx without a receipt does not show that the
 * provider did nothing, and treating it as a refusal invites a duplicate. The
 * opposite blanket rule is no better — calling every unrecognised 4xx unknown
 * would push ordinary invalid-number refusals into a reconciliation queue that
 * cannot resolve them.
 *
 * So the decision is grounded in what the provider's own contract says, and
 * anything outside it is `unknown`. Retrying requires evidence that the effect
 * did NOT happen; nothing weaker.
 */
export interface ProviderAnswer {
    readonly status: number;
    /** The provider's own message identifier, when it issued one. */
    readonly receipt?: string | null;
    /** Parsed provider error, when the body carried a recognisable one. */
    readonly error?: {
        readonly code?: number | string | null;
        readonly subcode?: number | string | null;
        /** The provider's own documented "try again" signal. */
        readonly isTransient?: boolean | null;
        readonly message?: string | null;
    } | null;
    /** False when the body could not be read at all — HTML from an edge, a cut stream. */
    readonly bodyReadable: boolean;
}

export type ProviderClassifier = (answer: ProviderAnswer) => StrictDispatchOutcome;

const unknown = (errorCode: string): StrictDispatchOutcome => ({ kind: 'unknown', errorCode });
const rejected = (errorCode: string, retryable: boolean): StrictDispatchOutcome =>
    ({ kind: 'rejected', errorCode, retryable });

/**
 * Meta Graph codes that document a temporary condition in which the message was
 * NOT created. Each is a documented rate limit or an explicitly temporary
 * service state, which is the evidence a retry needs.
 *
 * Sources: WhatsApp Cloud API and Graph API error reference. Anything absent
 * here is deliberately not retried, however plausible it looks.
 */
const META_TRANSIENT_CODES = new Set<number>([
    2,      // API Service — temporary problem due to downtime, retry
    4,      // Application request limit reached
    368,    // Temporarily blocked for policies violations
    613,    // Calls to this API have exceeded the rate limit
    80007,  // Rate limit issues
    130429, // Cloud API message throughput reached
    131048, // Spam rate limit hit
    131056, // Pair rate limit hit
    133016, // Too many requests
]);

/**
 * Meta Graph codes that document a definite refusal: the message was not
 * created and sending the identical payload again cannot change that.
 */
const META_PERMANENT_CODES = new Set<number>([
    3,      // Unknown method / capability
    10,     // Permission denied
    100,    // Invalid parameter
    190,    // Access token expired or invalid
    131008, // Required parameter is missing
    131009, // Parameter value is not valid
    131021, // Recipient cannot be the sender
    131026, // Message undeliverable
    131031, // Business account is restricted
    131047, // Re-engagement message — outside the customer service window
    131051, // Unsupported message type
    131052, // Media download error
    131053, // Media upload error
    132000, // Template param count mismatch
    132001, // Template does not exist
    132005, // Template hydrated text too long
    132007, // Template format character policy violated
    132012, // Template parameter format mismatch
    132015, // Template is paused
    132016, // Template is disabled
    133010, // Phone number not registered
]);

function metaCode(answer: ProviderAnswer): number | null {
    const raw = answer.error?.code;
    const value = typeof raw === 'string' ? Number(raw) : raw;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * WhatsApp Cloud API and Messenger both answer with the Graph error envelope.
 *
 * A Graph answer either creates the message and returns its id, or returns an
 * `error` object and creates nothing. That pairing is the contract, and it is
 * what lets a refusal be told apart from silence: an `error` object present and
 * no id means the effect did not happen. Only then does the code decide whether
 * another attempt is invited.
 */
export const metaGraphClassifier: ProviderClassifier = answer => {
    const receipt = typeof answer.receipt === 'string' ? answer.receipt.trim() : '';
    if (receipt) return { kind: 'accepted', receipt };
    // Accepted without an id: the effect may exist and cannot be named, so it
    // must never be resent and must never be reported as a receipt.
    if (answer.status >= 200 && answer.status < 300) return unknown('receipt_missing');
    if (!answer.bodyReadable) return unknown(`unreadable_body_http_${answer.status}`);

    const code = metaCode(answer);
    if (code === null) {
        // No Graph error object either. Nothing here says the effect did not
        // happen, whatever the status line suggests.
        return unknown(`unclassified_http_${answer.status}`);
    }
    const label = answer.error?.subcode != null ? `meta_${code}_${answer.error.subcode}` : `meta_${code}`;
    if (META_TRANSIENT_CODES.has(code)) return rejected(label, true);
    if (META_PERMANENT_CODES.has(code)) return rejected(label, false);
    // The provider's own transient flag is documented evidence; trust it only
    // when it is explicitly true.
    if (answer.error?.isTransient === true) return rejected(label, true);
    // A Graph error object with no id means nothing was created — a refusal —
    // but an unmapped code carries no evidence that trying again would differ.
    return rejected(label, false);
};

/**
 * Telegram Bot API status codes that document a refusal in which the message
 * was NOT sent. Telegram answers every call with `ok`, and `ok: false` is its
 * own statement that it did not act — but only for the client-error family.
 */
const TELEGRAM_PERMANENT_CODES = new Set<number>([
    400, // Bad Request — malformed chat_id, unparseable entities, bad media URL
    401, // Unauthorized — bot token revoked or wrong
    403, // Forbidden — blocked by the user, kicked from the chat, cannot initiate
    404, // Not Found — unknown method or token
    409, // Conflict — webhook and getUpdates both active
]);

/**
 * Telegram Bot API.
 *
 * The contract is `ok`: a successful call carries `result` and an unsuccessful
 * one carries `error_code` with a `description`. That is what separates a
 * refusal from silence here, the same role the Graph error envelope plays for
 * Meta. Two cases deliberately do not become rejections: a 429, which is a
 * documented rate limit and therefore the one code that invites another
 * attempt; and any 5xx, because Telegram does not promise that a failed
 * response means the update was not processed — calling that a refusal would
 * invite exactly the duplicate the outbox exists to prevent.
 */
export const telegramClassifier: ProviderClassifier = answer => {
    const receipt = typeof answer.receipt === 'string' ? answer.receipt.trim() : '';
    if (receipt) return { kind: 'accepted', receipt };
    if (!answer.bodyReadable) return unknown(`unreadable_body_http_${answer.status}`);
    // `ok: true` with no message id: something exists and cannot be named.
    if (!answer.error) return unknown('receipt_missing');

    const raw = answer.error.code;
    const code = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof code !== 'number' || !Number.isFinite(code)) return unknown(`unclassified_http_${answer.status}`);
    const label = `telegram_${code}`;
    if (code === 429) return rejected(label, true);
    if (TELEGRAM_PERMANENT_CODES.has(code)) return rejected(label, false);
    return unknown(label);
};

/** Read a Bot API answer, tolerating a body that is not the documented shape. */
export function telegramAnswer(status: number, body: any): ProviderAnswer {
    const readable = body !== null && body !== undefined && typeof body === 'object';
    const id = readable ? body?.result?.message_id : undefined;
    return {
        status,
        receipt: typeof id === 'number' || typeof id === 'string' ? String(id) : null,
        // `ok: false` is the error envelope; `error_code` may be absent on an
        // edge failure, and the status line stands in for it when it is.
        error: readable && body.ok === false
            ? { code: body.error_code ?? status, subcode: null, isTransient: null,
                message: typeof body.description === 'string' ? body.description : null }
            : null,
        bodyReadable: readable,
    };
}

/** No answer arrived. Never a rejection: the request may have been processed. */
export function classifyTransportFailure(error: unknown): StrictDispatchOutcome {
    const name = (error as any)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return unknown('provider_timeout');
    return unknown(`transport_failure:${String((error as any)?.message || error).slice(0, 80)}`);
}

/**
 * A channel whose adapter has not been migrated. Refused explicitly rather than
 * degraded to the loose gateway, so no channel silently loses these guarantees.
 */
export function transportNotAvailable(channelType: string): StrictDispatchOutcome {
    return { kind: 'rejected', errorCode: `transport_not_migrated:${channelType}`, retryable: false };
}

/** Read a Graph answer out of a parsed body, tolerating a shape we do not know. */
export function metaGraphAnswer(status: number, body: any, receiptPath: 'messages' | 'message_id'): ProviderAnswer {
    const readable = body !== null && body !== undefined && typeof body === 'object';
    const receipt = receiptPath === 'messages'
        ? body?.messages?.[0]?.id
        : body?.message_id;
    return {
        status,
        receipt: typeof receipt === 'string' ? receipt : null,
        error: readable && body.error && typeof body.error === 'object'
            ? { code: body.error.code ?? null, subcode: body.error.error_subcode ?? null,
                isTransient: typeof body.error.is_transient === 'boolean' ? body.error.is_transient : null,
                message: typeof body.error.message === 'string' ? body.error.message : null }
            : null,
        bodyReadable: readable,
    };
}
