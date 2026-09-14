import { scrubSentryEvent } from './sentry-redaction.util';

/** Nest's queue instrumentation captures this before BullMQ consumes it.
 * Match the complete control-flow exception, never a substring or a failed
 * moveToDelayed call. Avoid loading BullMQ before Sentry instrumentation starts.
 */
export function prepareSentryErrorEvent<T>(event: T): T | null {
    const values = (event as { exception?: { values?: Array<{ type?: string; value?: string }> } })?.exception?.values;
    if (values?.length === 1
        && values[0].type === 'DelayedError'
        && values[0].value === 'bullmq:movedToDelayed') return null;
    return scrubSentryEvent(event);
}
