import { FlowSendFailed } from './flow-fallback';

/**
 * ═══ READING "THIS BUSINESS CANNOT BE BILLED" OUT OF WHATEVER WAS THROWN ═══
 *
 * Four sinks send WhatsApp, and each of them holds the provider's refusal in a
 * different shape: a strict transport reduces it to `{errorCode}`, the gateway
 * catches an axios error, the Flow path throws `FlowSendFailed` carrying the
 * body, and the REST service reads Meta's envelope itself.
 *
 * The fact hidden in all four is the same one, and it is the only provider
 * error whose correct response is the opposite of the usual: Meta's 131042
 * means the business has no usable payment method, so every message from that
 * number will fail identically until a person adds a card in a different
 * company's interface. Retrying is not merely useless, it is the failure mode —
 * the queue fills, the customers hear nothing, and the logs say the same thing
 * ten thousand times without saying the one thing that fixes it.
 *
 * So this is one reader, used by every sink, rather than four almost-identical
 * `error?.response?.data?.error?.code` chains — the shape that already produced
 * two writers disagreeing about delivery receipts.
 */
export interface ProviderRefusal {
    /** Meta's numeric code as a string, when one was found. */
    readonly code: string | null;
    /** What Meta said, trimmed. Never a token, never a phone number. */
    readonly detail: string | null;
}

/** The Graph error object, wherever this particular thrower happened to put it. */
function graphError(error: any): any {
    if (!error || typeof error !== 'object') return null;
    return error.response?.data?.error
        ?? error.data?.error
        ?? error.body?.error
        ?? (error.error && typeof error.error === 'object' ? error.error : null)
        ?? null;
}

/**
 * What the provider refused with, from any of the four shapes.
 *
 * Returns nulls rather than throwing for anything unrecognised, because this
 * runs inside a failure path: an error while reading an error must not become
 * the error somebody sees.
 */
export function readProviderRefusal(error: unknown): ProviderRefusal {
    if (!error) return { code: null, detail: null };

    // The Flow path wraps the answer deliberately so the body survives.
    if (error instanceof FlowSendFailed) {
        const inner = graphError({ body: error.evidence?.body })
            ?? graphError(error.evidence?.cause);
        return {
            code: inner?.code !== undefined && inner?.code !== null ? String(inner.code) : null,
            detail: describe(inner) ?? truncate(String(error.message ?? '')),
        };
    }

    const found = graphError(error);
    if (found) {
        return {
            code: found.code !== undefined && found.code !== null ? String(found.code) : null,
            detail: describe(found),
        };
    }

    // Nothing structured. The message still gets through, because Meta
    // sometimes explains a funding problem in words where the code is generic,
    // and `detailSaysFunding` reads exactly that.
    const message = typeof error === 'string' ? error : String((error as any)?.message ?? '');
    return { code: null, detail: message ? truncate(message) : null };
}

function describe(found: any): string | null {
    if (!found) return null;
    const parts = [found.message, found.error_user_title, found.error_user_msg,
        found.error_data?.details].filter(Boolean).map(String);
    return parts.length ? truncate(parts.join(' — ')) : null;
}

function truncate(text: string): string {
    return text.slice(0, 400);
}
