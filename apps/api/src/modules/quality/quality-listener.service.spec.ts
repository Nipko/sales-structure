import { QualityListenerService } from './quality-listener.service';

describe('QualityListenerService', () => {
    it('reports a queue outage without failing conversation resolution', async () => {
        const quality = { enqueue: jest.fn().mockRejectedValue(new Error('queue unavailable')) };
        const listener = new QualityListenerService(quality as any);

        await expect(listener.handleResolved({
            tenantId: '11111111-1111-4111-8111-111111111111',
            conversationId: '22222222-2222-4222-8222-222222222222',
        })).resolves.toBeUndefined();
        expect(quality.enqueue).toHaveBeenCalledTimes(1);
    });

    it('ignores malformed events', async () => {
        const quality = { enqueue: jest.fn() };
        const listener = new QualityListenerService(quality as any);

        await listener.handleResolved({ tenantId: '', conversationId: '' });
        expect(quality.enqueue).not.toHaveBeenCalled();
    });
});
