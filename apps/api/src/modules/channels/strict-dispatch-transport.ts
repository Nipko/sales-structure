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

// Classification lives in `provider-error-classification.ts`: what an answer
// proves depends on the provider's own contract, not on the status line alone.
export {
    classifyTransportFailure, metaGraphAnswer, metaGraphClassifier, transportNotAvailable,
    type ProviderAnswer, type ProviderClassifier,
} from './provider-error-classification';
