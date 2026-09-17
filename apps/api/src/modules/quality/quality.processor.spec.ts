jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/nestjs';
import { QualityProcessor } from './quality.processor';
import { QualityService, QUALITY_QUEUE } from './quality.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

describe('QualityProcessor failure reporting', () => {
    const captureException = Sentry.captureException as jest.Mock;
    beforeEach(() => captureException.mockReset());

    /** The error exactly as the judge raises it, not a hand-built stand-in. */
    async function judgeError(content: string): Promise<Error> {
        const llmRouter: any = { execute: jest.fn(async () => ({ content, finishReason: 'stop' })) };
        const service = new QualityService({} as any, {} as any, llmRouter, {} as any, {} as any);
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        return service.judgeTranscript(TENANT_ID, 'Cliente: Hola').then(
            () => { throw new Error('judge unexpectedly accepted the verdict'); },
            (error: Error) => error,
        );
    }

    function processor() {
        const instance = new QualityProcessor({} as any, {} as any);
        jest.spyOn((instance as any).logger, 'error').mockImplementation(() => undefined);
        return instance;
    }
    const job = (attemptsMade: number) => ({ id: `q-${CONVERSATION_ID}`, attemptsMade, opts: { attempts: 3 },
        data: { tenantId: TENANT_ID, conversationId: CONVERSATION_ID } }) as any;

    it('reports a refused judge verdict once, as a warning grouped by why it was refused', async () => {
        const error = await judgeError(JSON.stringify({ overall: 8, resolution: 8, tone: 8, accuracy: 8, empathy: 8,
            flags: [], resolved: true, resolutionStatus: 'needs_customer_input', resolutionReason: 'Esperando datos.' }));

        processor().onFailed(job(1), error);
        expect(captureException).not.toHaveBeenCalled();

        processor().onFailed(job(3), error);
        expect(captureException).toHaveBeenCalledTimes(1);
        expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({
            level: 'warning',
            fingerprint: ['quality-judge-invalid-response', 'resolution_inconsistent'],
            tags: expect.objectContaining({ queue: QUALITY_QUEUE, judge_reason: 'resolution_inconsistent' }),
            extra: expect.objectContaining({ tenantId: TENANT_ID, conversationId: CONVERSATION_ID, field: 'resolved' }),
        }));
    });

    it('keeps any other final failure an error, as before', () => {
        const error = new Error('provider unavailable');
        processor().onFailed(job(3), error);
        expect(captureException).toHaveBeenCalledWith(error, {
            tags: { queue: QUALITY_QUEUE },
            extra: { tenantId: TENANT_ID, conversationId: CONVERSATION_ID },
        });
    });
});
