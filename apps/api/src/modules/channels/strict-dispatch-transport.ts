import type { ChannelType } from '@parallext/shared';
import type { DispatchItemKind } from './agent-dispatch-outbox';

/**
 * A transport that says what actually happened.
 *
 * `ChannelGatewayService.sendMessage` cannot be reused for durable dispatch: it
 * catches everything and returns null, so a rejected phone number and a lost
 * connection look identical, and it silently falls back from a WhatsApp Flow to
 * plain text after ANY exception — including a timeout, where the Flow may well
 * have been delivered. An outbox whose states mean anything needs a transport
 * that distinguishes three cases and hides no retries.
 *
 *   - `accepted`   the provider issued a receipt. Never send this item again.
 *   - `rejected`   the provider answered and did not act. Retryable or not, but
 *                  in both cases nothing reached the customer.
 *   - `unknown`    no answer arrived. The request may have been processed, so
 *                  the item needs reconciliation and never a blind resend.
 *
 * One call performs exactly one remote effect. A caption is a separate item with
 * its own receipt, and a Flow is never turned into a text message here: any
 * fallback must be its own admitted item, after a rejection that was actually
 * demonstrated.
 */
export type StrictDispatchOutcome =
    | { readonly kind: 'accepted'; readonly receipt: string }
    | { readonly kind: 'rejected'; readonly errorCode: string; readonly retryable: boolean }
    | { readonly kind: 'unknown'; readonly errorCode: string };

export interface StrictDispatchRequest {
    readonly itemKind: DispatchItemKind;
    readonly to: string;
    readonly channelAccountId: string;
    /** Immutable payload of this one effect, as the outbox recorded it. */
    readonly payload: Record<string, any>;
}

export interface StrictDispatchTransport {
    readonly channelType: ChannelType;
    /** No hidden retry, no fallback, no swallowed error. Bounded by its own timeout. */
    sendStrict(request: StrictDispatchRequest, accessToken: string): Promise<StrictDispatchOutcome>;
}

/** Statuses where the provider answered and states it did not act. */
const DEFINITE_REJECTIONS = new Set([400, 401, 403, 404, 405, 410, 413, 415, 422]);
/** The provider answered that it did not act, and invites another attempt. */
const RETRYABLE_REJECTIONS = new Set([408, 425, 429]);

/**
 * Classify one provider HTTP answer.
 *
 * The 5xx reading is a deliberate product decision, not a technical fact: an
 * answered 5xx is treated as a retryable rejection rather than an unknown
 * outcome. Meta issues no message id in that case, and the alternative would
 * strand a customer reply behind a reconciliation nothing can resolve — there is
 * no id to reconcile a failed POST against. It trades a rare duplicate for not
 * losing a reply, which is the same trade the existing pipeline already makes
 * explicitly. A request that got NO answer stays unknown, because there the
 * provider may genuinely have processed it.
 */
export function classifyProviderResponse(
    status: number, receipt: string | null | undefined, errorCode?: string | null,
): StrictDispatchOutcome {
    const code = String(errorCode || `http_${status}`).slice(0, 120);
    if (status >= 200 && status < 300) {
        const id = typeof receipt === 'string' ? receipt.trim() : '';
        // Accepted without a usable id: the effect happened but cannot be named,
        // so resending would duplicate it and claiming a receipt would be false.
        return id ? { kind: 'accepted', receipt: id } : { kind: 'unknown', errorCode: 'receipt_missing' };
    }
    if (DEFINITE_REJECTIONS.has(status)) return { kind: 'rejected', errorCode: code, retryable: false };
    if (RETRYABLE_REJECTIONS.has(status)) return { kind: 'rejected', errorCode: code, retryable: true };
    if (status >= 500 && status < 600) return { kind: 'rejected', errorCode: code, retryable: true };
    // An answer we do not recognise is not evidence that nothing happened.
    return { kind: 'unknown', errorCode: code };
}

/** No answer arrived. Never a rejection: the request may have been processed. */
export function classifyTransportFailure(error: unknown): StrictDispatchOutcome {
    const raw = (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError'
        ? 'provider_timeout'
        : `transport_failure:${String((error as any)?.message || error).slice(0, 80)}`;
    return { kind: 'unknown', errorCode: raw };
}

/**
 * A channel whose adapter has not been migrated. Refused explicitly rather than
 * degraded to the loose gateway, so no channel silently loses these guarantees.
 */
export function transportNotAvailable(channelType: string): StrictDispatchOutcome {
    return { kind: 'rejected', errorCode: `transport_not_migrated:${channelType}`, retryable: false };
}
