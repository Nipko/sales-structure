import { OutboundQueueProcessor } from './outbound-queue.processor';

describe('OutboundQueueProcessor subscription boundary', () => {
    function harness(subscriptionStatus: string) {
        const channelGateway = { sendMessage: jest.fn() };
        const throttle = {
            isOverLimit: jest.fn().mockResolvedValue(false),
            recordUsage: jest.fn().mockResolvedValue(undefined),
        };
        const channelToken = { getChannelToken: jest.fn() };
        const redis = { get: jest.fn(), set: jest.fn() };
        const tenantSms = { send: jest.fn().mockResolvedValue({ sent: true, sid: 'sms-1', segments: 1 }) };
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
            tenantSms as any,
            prisma as any,
        );
        const job: any = {
            id: undefined,
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
        return { processor, job, throttle, tenantSms, channelGateway };
    }

    it('drops a queued message before rate limit, balance or provider work when pending_auth', async () => {
        const h = harness('pending_auth');

        await expect(h.processor.process(h.job)).resolves.toBe('skipped:payment_method_required');

        expect(h.throttle.isOverLimit).not.toHaveBeenCalled();
        expect(h.tenantSms.send).not.toHaveBeenCalled();
        expect(h.channelGateway.sendMessage).not.toHaveBeenCalled();
    });

    it('still sends for an active subscription', async () => {
        const h = harness('active');

        await expect(h.processor.process(h.job)).resolves.toBe('sms-1');

        expect(h.tenantSms.send).toHaveBeenCalled();
        expect(h.throttle.recordUsage).toHaveBeenCalled();
    });
});
