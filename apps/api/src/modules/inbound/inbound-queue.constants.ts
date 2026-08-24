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

export interface InboundJobData {
    msg: NormalizedMessage;
    enqueuedAt: number;
    /** Number of operator-equivalent retries after BullMQ exhausted attempts. */
    redriveCount?: number;
    /** Audit timestamp for the last automatic failed-set rescue. */
    lastRedrivenAt?: number;
}
