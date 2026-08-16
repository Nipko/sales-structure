import { BroadcastQueueProcessor } from './broadcast-queue.processor';

describe('BroadcastQueueProcessor subscription boundary', () => {
    it('marks the recipient failed without contacting a delivery provider when billing is locked', async () => {
        const messaging = { sendTemplate: jest.fn() };
        const crypto = {};
        const email = { send: jest.fn() };
        const prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    isInternal: false,
                    subscriptionStatus: 'pending_auth',
                    subscription: {
                        status: 'pending_auth',
                        trialEndsAt: null,
                        cancelAtPeriodEnd: false,
                        currentPeriodEnd: null,
                        cancellationReason: null,
                        dunningStartedAt: null,
                    },
                }),
            },
        };
        const broadcast = {
            updateRecipientStatus: jest.fn().mockResolvedValue(undefined),
            checkCampaignCompletion: jest.fn().mockResolvedValue(undefined),
        };
        const abTest = { updateVariantStats: jest.fn() };
        const tenantSms = { send: jest.fn() };
        const processor = new BroadcastQueueProcessor(
            messaging as any,
            crypto as any,
            email as any,
            prisma as any,
            broadcast as any,
            abTest as any,
            tenantSms as any,
        );
        const job: any = {
            id: 'job-1',
            attemptsMade: 0,
            data: {
                tenantId: '11111111-1111-4111-8111-111111111111',
                schemaName: 'tenant_test',
                campaignId: '22222222-2222-4222-8222-222222222222',
                recipientId: '33333333-3333-4333-8333-333333333333',
                channel: 'whatsapp',
            },
        };

        await expect(processor.process(job)).resolves.toBe('skipped:payment_method_required');

        expect(broadcast.updateRecipientStatus).toHaveBeenCalledWith(
            'tenant_test',
            '33333333-3333-4333-8333-333333333333',
            'failed',
            'payment_method_required',
        );
        expect(messaging.sendTemplate).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
        expect(tenantSms.send).not.toHaveBeenCalled();
    });
});
