import { NormalizedMessage } from '@parallext/shared';

/**
 * Queue that carries an inbound customer message from the webhook edge to the
 * AI turn that answers it.
 *
 * Kept in its own leaf file — importing a constant must never drag a processor
 * (and its whole DI graph) into a producer. OUTBOUND_QUEUE lives inside
 * outbound-queue.processor.ts precisely the wrong way; under CJS circular
 * resolution that pattern can resolve to `undefined`.
 */
export const INBOUND_QUEUE = 'inbound-messages';

/**
 * A customer message that never reached the queue.
 *
 * A webhook body carries several independent things, and most failures in one
 * of them must NOT travel back to the provider: a status receipt we could not
 * write, or a body we can never parse, would come back forever if we answered
 * 5xx, and forever is worse than the loss. The single exception is a customer
 * message that did not become durable — there the redelivery is precisely what
 * we want, and a 200 turns a transient outage into a message nobody will ever
 * answer.
 *
 * So the ingress needs to tell those two apart, and this is the marker that
 * does it: it means "we do not have this message". `InboundQueueService.enqueue`
 * discards a structurally broken message with `return` and never a throw, so
 * anything it does throw is infrastructure and belongs in here.
 */
export class InboundNotDurableError extends Error {
    constructor(
        /** The provider's id for the message, when it sent one. */
        readonly providerMessageId: string | undefined,
        /** What actually failed, kept for the log at the edge. */
        readonly reason: unknown,
    ) {
        super(`inbound_not_durable${providerMessageId ? `: ${providerMessageId}` : ''}`);
        this.name = 'InboundNotDurableError';
    }
}

export interface InboundJobData {
    msg: NormalizedMessage;
    enqueuedAt: number;
    /** Number of operator-equivalent retries after BullMQ exhausted attempts. */
    redriveCount?: number;
    /** Audit timestamp for the last automatic failed-set rescue. */
    lastRedrivenAt?: number;
}
