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

    it('still redacts callback secrets in retained errors', () => {
        const event = { ...eventFor(new Error('Provider failed')),
            request: { url: '/tenant-payments/webhook/wompi/tenant-id/fixture-secret' } };
        expect(prepareSentryErrorEvent(event)?.request.url).toBe('/tenant-payments/webhook/wompi/tenant-id/[redacted]');
    });
});
