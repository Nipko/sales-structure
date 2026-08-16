import { AutomationJobsProcessor } from './automation-jobs.processor';

describe('AutomationJobsProcessor subscription boundary', () => {
    it('records a skipped execution before throttling or executing an action when billing is locked', async () => {
        const prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    isInternal: false,
                    subscriptionStatus: 'expired',
                    subscription: {
                        status: 'expired',
                        trialEndsAt: null,
                        cancelAtPeriodEnd: false,
                        currentPeriodEnd: null,
                        cancellationReason: null,
                        dunningStartedAt: null,
                    },
                }),
            },
            executeInTenantSchema: jest.fn().mockResolvedValue(undefined),
        };
        const whatsapp = { sendTemplate: jest.fn() };
        const throttle = { isLimited: jest.fn() };
        const http = { execute: jest.fn() };
        const pipeline = {};
        const processor = new AutomationJobsProcessor(
            prisma as any,
            whatsapp as any,
            throttle as any,
            http as any,
            pipeline as any,
        );
        const job: any = {
            attemptsMade: 0,
            data: {
                tenantId: '11111111-1111-4111-8111-111111111111',
                schemaName: 'tenant_test',
                executionId: '22222222-2222-4222-8222-222222222222',
                ruleId: '33333333-3333-4333-8333-333333333333',
                ruleName: 'follow-up',
                action: { type: 'http_request' },
                event: {},
            },
        };

        await expect(processor.process(job)).resolves.toEqual({
            skipped: true,
            reason: 'subscription_expired',
        });

        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(throttle.isLimited).not.toHaveBeenCalled();
        expect(http.execute).not.toHaveBeenCalled();
        expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });
});
