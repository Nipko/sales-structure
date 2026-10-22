import { scrubSentryEvent } from './sentry-redaction.util';

/** Nest's queue instrumentation captures this before BullMQ consumes it.
 * Match the complete control-flow exception, never a substring or a failed
 * moveToDelayed call. Avoid loading BullMQ before Sentry instrumentation starts.
 */
export function prepareSentryErrorEvent<T>(event: T): T | null {
    const values = (event as { exception?: { values?: Array<{ type?: string; value?: string; mechanism?: { type?: string } }> } })?.exception?.values;
    if (values?.length === 1
        && values[0].type === 'DelayedError'
        && values[0].value === 'bullmq:movedToDelayed') return null;
    if (values?.length && values.every(v => isProviderSdkCapture(v.mechanism?.type))) return null;
    return scrubSentryEvent(event);
}

/** Sentry's AI SDK instrumentation (`auto.ai.openai`, `auto.ai.anthropic`…) reports
 * every failed provider call as unhandled, before the LLM router sees it. The router
 * handles it — the next candidate answers, or the handoff classifier falls back to its
 * rules — and tracks provider health in its breaker and the Ops Center. A turn that
 * truly fails is still reported through the application's own error path.
 */
function isProviderSdkCapture(mechanism?: string): boolean {
    return typeof mechanism === 'string' && mechanism.startsWith('auto.ai.');
}
