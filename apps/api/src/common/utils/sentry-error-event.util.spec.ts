import { DelayedError } from 'bullmq';
import { prepareSentryErrorEvent } from './sentry-error-event.util';

describe('queue error reporting', () => {
    const eventFor = (error: Error) => ({ exception: { values: [{ type: error.name, value: error.message,
        mechanism: { handled: false, type: 'auto.queue.nestjs.bullmq' } }] } });

    it('drops the exact deliberate-delay signal captured by Nest queue instrumentation', () => {
        expect(prepareSentryErrorEvent(eventFor(new DelayedError()))).toBeNull();
    });

    it('retains move failures, spend failures and similarly named application errors', () => {
        for (const error of [new Error('Missing lock for job. moveToDelayed'), new Error('spend_meter_unavailable'),
            new Error('bullmq:movedToDelayed'), new DelayedError('unexpected delayed failure')]) {
            const event = eventFor(error);
            expect(prepareSentryErrorEvent(event)).toBe(event);
        }
        const chained = eventFor(new DelayedError());
        chained.exception.values.push(eventFor(new Error('Redis unavailable')).exception.values[0]);
        expect(prepareSentryErrorEvent(chained)).toBe(chained);
    });

    it('drops provider failures captured by the AI SDK instrumentation, which the router handles', () => {
        const capture = (type: string, value: string) => ({ exception: { values: [{ type: 'Error', value,
            mechanism: { handled: false, type } }] } });
        // Production 2026-10-22: xAI at capacity in the handoff classifier, DeepSeek DNS failure mid-turn.
        expect(prepareSentryErrorEvent(capture('auto.ai.openai', '429 The model is currently at capacity due to high demand.'))).toBeNull();
        expect(prepareSentryErrorEvent(capture('auto.ai.openai', 'Connection error.'))).toBeNull();
        expect(prepareSentryErrorEvent(capture('auto.ai.openai.stream', 'Connection error.'))).toBeNull();
        expect(prepareSentryErrorEvent(capture('auto.ai.anthropic', 'overloaded_error'))).toBeNull();
    });

    it('retains provider errors that reach the application error path', () => {
        for (const type of ['generic', 'auto.http.nestjs', 'auto.queue.nestjs.bullmq', 'auto.aix']) {
            const event = { exception: { values: [{ type: 'Error', value: 'All 4 LLM providers failed',
                mechanism: { handled: false, type } }] } };
            expect(prepareSentryErrorEvent(event)).toBe(event);
        }
        const mixed = { exception: { values: [
            { type: 'Error', value: 'Connection error.', mechanism: { handled: false, type: 'auto.ai.openai' } },
            { type: 'Error', value: 'turn failed', mechanism: { handled: false, type: 'generic' } },
        ] } };
        expect(prepareSentryErrorEvent(mixed)).toBe(mixed);
        const bare = { exception: { values: [{ type: 'Error', value: 'no mechanism' }] } };
        expect(prepareSentryErrorEvent(bare)).toBe(bare);
    });

    it('still redacts callback secrets in retained errors', () => {
        const event = { ...eventFor(new Error('Provider failed')),
            request: { url: '/tenant-payments/webhook/wompi/tenant-id/fixture-secret' } };
        expect(prepareSentryErrorEvent(event)?.request.url).toBe('/tenant-payments/webhook/wompi/tenant-id/[redacted]');
    });
});
