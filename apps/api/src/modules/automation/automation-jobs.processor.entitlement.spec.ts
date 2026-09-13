import { AutomationJobsProcessor } from './automation-jobs.processor';

describe('AutomationJobsProcessor subscription boundary', () => {
    function activeTenant() {
        return {
            isInternal: false,
            subscriptionStatus: 'active',
            subscription: {
                status: 'active',
                trialEndsAt: null,
                cancelAtPeriodEnd: false,
                currentPeriodEnd: new Date(Date.now() + 86_400_000),
                cancellationReason: null,
                dunningStartedAt: null,
            },
        };
    }

    function job(overrides: Record<string, any> = {}): any {
        return {
            id: 'automation-22222222-2222-4222-8222-222222222222-0',
            attemptsMade: 0,
            opts: { attempts: 3 },
            data: {
                tenantId: '11111111-1111-4111-8111-111111111111',
                schemaName: 'tenant_test',
                executionId: '22222222-2222-4222-8222-222222222222',
                ruleId: '33333333-3333-4333-8333-333333333333',
                ruleName: 'follow-up',
                action: { type: 'http_request' },
                event: {},
            },
            ...overrides,
        };
    }

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
        const throttle = {
            reserveActionUsage: jest.fn(),
            commitActionUsage: jest.fn(),
        };
        const http = { execute: jest.fn() };
        const pipeline = {};
        const proactive = {};
        const processor = new AutomationJobsProcessor(
            prisma as any,
            throttle as any,
            http as any,
            pipeline as any,
            proactive as any,
        );

        await expect(processor.process(job())).resolves.toEqual({
            skipped: true,
            reason: 'subscription_expired',
        });

        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(throttle.reserveActionUsage).not.toHaveBeenCalled();
        expect(throttle.commitActionUsage).not.toHaveBeenCalled();
        expect(http.execute).not.toHaveBeenCalled();
    });

    it('uses one stable reservation for every retry of a logical action', async () => {
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue(activeTenant()) },
            executeInTenantSchema: jest.fn().mockResolvedValue(undefined),
        };
        const throttle = {
            reserveActionUsage: jest.fn()
                .mockResolvedValueOnce({ allowed: true, count: 1, adopted: false })
                .mockResolvedValueOnce({ allowed: true, count: 1, adopted: true }),
            commitActionUsage: jest.fn().mockResolvedValue(undefined),
        };
        const http = { execute: jest.fn().mockResolvedValue({ status: 200 }) };
        const processor = new AutomationJobsProcessor(
            prisma as any,
            throttle as any,
            http as any,
            {} as any,
            {} as any,
        );
        const first = job();
        const retry = job({ attemptsMade: 1 });

        await processor.process(first);
        await processor.process(retry);

        expect(throttle.reserveActionUsage).toHaveBeenNthCalledWith(
            1,
            first.data.tenantId,
            'automation',
            `automation-job:${first.id}`,
        );
        expect(throttle.reserveActionUsage).toHaveBeenNthCalledWith(
            2,
            first.data.tenantId,
            'automation',
            `automation-job:${first.id}`,
        );
        expect(throttle.commitActionUsage).toHaveBeenCalledTimes(2);
        expect(http.execute).toHaveBeenCalledTimes(2);
    });

    it('does not execute or commit when the atomic reservation is denied', async () => {
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue(activeTenant()) },
            executeInTenantSchema: jest.fn().mockResolvedValue(undefined),
        };
        const throttle = {
            reserveActionUsage: jest.fn().mockResolvedValue({ allowed: false, count: 10, adopted: false }),
            commitActionUsage: jest.fn(),
        };
        const http = { execute: jest.fn() };
        const processor = new AutomationJobsProcessor(
            prisma as any,
            throttle as any,
            http as any,
            {} as any,
            {} as any,
        );

        await expect(processor.process(job())).rejects.toThrow('rate limited for automation');
        expect(throttle.commitActionUsage).not.toHaveBeenCalled();
        expect(http.execute).not.toHaveBeenCalled();
    });

    it('refuses a job without a stable identity before it consumes quota', async () => {
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue(activeTenant()) },
            executeInTenantSchema: jest.fn().mockResolvedValue(undefined),
        };
        const throttle = { reserveActionUsage: jest.fn(), commitActionUsage: jest.fn() };
        const processor = new AutomationJobsProcessor(
            prisma as any,
            throttle as any,
            { execute: jest.fn() } as any,
            {} as any,
            {} as any,
        );

        await expect(processor.process(job({ id: undefined })))
            .rejects.toThrow('automation_job_missing_stable_id');
        expect(throttle.reserveActionUsage).not.toHaveBeenCalled();
    });
});
