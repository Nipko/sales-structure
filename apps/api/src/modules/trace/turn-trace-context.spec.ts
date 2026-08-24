import { TurnTraceContext } from './turn-trace-context';

describe('TurnTraceContext', () => {
    it('redacts PII and credentials while preserving operational evidence', () => {
        const trace = new TurnTraceContext({
            tenantId: 'tenant-1',
            conversationId: 'conversation-1',
        });

        trace.add('tool_result', 'provider_write', {
            email: 'buyer@example.com',
            phone: '+57 300 123 4567',
            accessToken: 'provider-token',
            providerToken: 'another-provider-token',
            nested: { client_secret: 'provider-secret' },
            totalTokens: 42,
            status: 'completed',
        });

        expect(trace.steps[0].metadata).toEqual({
            email: '[email]',
            phone: '[phone]',
            accessToken: '[secret]',
            providerToken: '[secret]',
            nested: { client_secret: '[secret]' },
            totalTokens: 42,
            status: 'completed',
        });
    });

    it('bounds arrays, objects and strings before persistence', () => {
        const trace = new TurnTraceContext({
            tenantId: 'tenant-1',
            conversationId: 'conversation-1',
        });
        trace.add('turn_context', 'context', {
            values: Array.from({ length: 30 }, (_, index) => index),
            long: 'x'.repeat(800),
            object: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`k${index}`, index])),
        });

        expect(trace.steps[0].metadata?.values).toHaveLength(20);
        expect(trace.steps[0].metadata?.long).toHaveLength(500);
        expect(Object.keys(trace.steps[0].metadata?.object || {})).toHaveLength(30);
    });

    it('redacts credentials and PII embedded in free-form text', () => {
        const trace = new TurnTraceContext({ tenantId: 'tenant-1', conversationId: 'conversation-1' });
        trace.add('tool_result', 'free-form', {
            note: 'Bearer abcdefghijklmnop eyJabcdefghijk.abcdefghijk.abcdefghijk '
                + 'https://user:pass@example.com/path?access_token=raw-token '
                + 'from 192.168.10.2 at Calle 93 # 12-40, Bogota',
        });

        const text = String(trace.steps[0].metadata?.note);
        for (const leaked of ['abcdefghijklmnop', 'user:pass', 'raw-token', '192.168.10.2', 'Calle 93']) {
            expect(text).not.toContain(leaked);
        }
        expect(text).toContain('[authorization]');
        expect(text).toContain('[credentials]');
        expect(text).toContain('[address]');
    });

    it('never persists an exception message and bounds the step count', async () => {
        const trace = new TurnTraceContext({ tenantId: 'tenant-1', conversationId: 'conversation-1' });
        await expect(trace.time(
            'tool_call',
            'failure',
            () => ({ operation: 'write' }),
            async () => {
                const error: any = new Error('Bearer provider-secret for buyer@example.com');
                error.code = 'UPSTREAM_FAILURE';
                throw error;
            },
        )).rejects.toThrow();

        expect(trace.steps[0].metadata).toEqual({
            operation: 'write',
            errorType: 'Error',
            errorCode: 'UPSTREAM_FAILURE',
        });
        for (let index = 0; index < 150; index += 1) trace.add('decision', `step-${index}`);
        expect(trace.steps).toHaveLength(100);
    });
});
