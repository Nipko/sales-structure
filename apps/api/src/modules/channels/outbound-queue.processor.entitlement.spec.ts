import { OutboundQueueProcessor } from './outbound-queue.processor';
import { permissiveSpendGate, openPauseStore } from './__fixtures__/spend-gate-double';

describe('OutboundQueueProcessor subscription boundary', () => {
    function harness(subscriptionStatus: string) {
        const channelGateway = { sendMessage: jest.fn() };
        const throttle = {
            isOverLimit: jest.fn().mockResolvedValue(false),
            recordUsage: jest.fn().mockResolvedValue(undefined),
            reserveActionUsage: jest.fn().mockResolvedValue({ allowed: true, count: 1, adopted: false }),
            commitActionUsage: jest.fn().mockResolvedValue(undefined),
            releaseActionUsage: jest.fn().mockResolvedValue(undefined),
        };
        const channelToken = { getChannelToken: jest.fn() };
        const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue({
                isInternal: false,
                subscriptionStatus,
                subscription: {
                    status: subscriptionStatus,
                    trialEndsAt: null,
                    cancelAtPeriodEnd: false,
                    currentPeriodEnd: null,
                    cancellationReason: null,
                    dunningStartedAt: null,
                },
            }) },
        };
        const processor = new OutboundQueueProcessor(
            channelGateway as any,
            throttle as any,
            channelToken as any,
            redis as any,
            undefined,
            prisma as any,
            permissiveSpendGate(),
            openPauseStore(),
        );
        const job: any = {
            id: 'job-1',
            moveToDelayed: jest.fn().mockResolvedValue(undefined),
            data: {
                outbound: {
                    tenantId: '11111111-1111-4111-8111-111111111111',
                    channelType: 'sms',
                    channelAccountId: 'platform',
                    to: '+573001112233',
                    content: { type: 'text', text: 'hola' },
                },
            },
        };
        return { processor, job, throttle, channelGateway, channelToken };
    }

    it('drops a queued message before rate limit or provider work when pending_auth', async () => {
        const h = harness('pending_auth');

        await expect(h.processor.process(h.job)).resolves.toBe('skipped:payment_method_required');

        expect(h.throttle.isOverLimit).not.toHaveBeenCalled();
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
    });

    it('drops a legacy SMS job for good: SMS is a retired product (ADR 0020)', async () => {
        const h = harness('active');

        await expect(h.processor.process(h.job)).resolves.toBe('skipped:sms_retired');

        expect(h.throttle.reserveActionUsage).not.toHaveBeenCalled();
        expect(h.channelToken.getChannelToken).not.toHaveBeenCalled();
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
    });
});
