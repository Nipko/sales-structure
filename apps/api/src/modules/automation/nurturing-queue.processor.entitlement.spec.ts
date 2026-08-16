import { NurturingQueueProcessor } from './nurturing-queue.processor';

describe('NurturingQueueProcessor subscription boundary', () => {
    it.each(['drip-step', 'nurturing-follow-up'])(
        'discards a delayed %s before messaging or LLM work when billing is locked',
        async (name) => {
            const nurturing = { executeFollowUp: jest.fn() };
            const drip = { executeStep: jest.fn() };
            const prisma = {
                tenant: { findUnique: jest.fn().mockResolvedValue({
                    isInternal: false,
                    subscriptionStatus: 'pending_auth',
                    subscription: {
                        status: 'pending_auth', trialEndsAt: null, cancelAtPeriodEnd: false,
                        currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                    },
                }) },
            };
            const processor = new NurturingQueueProcessor(
                nurturing as any,
                drip as any,
                prisma as any,
            );
            const job: any = {
                id: 'job-1',
                name,
                data: {
                    tenantId: '11111111-1111-4111-8111-111111111111',
                    enrollmentId: 'enrollment-1',
                    conversationId: 'conversation-1',
                    leadId: 'lead-1',
                    attempt: 1,
                },
            };

            await expect(processor.process(job)).resolves.toBeUndefined();
            expect(drip.executeStep).not.toHaveBeenCalled();
            expect(nurturing.executeFollowUp).not.toHaveBeenCalled();
        },
    );
});
