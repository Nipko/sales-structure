import { BillingEventType } from '../billing/types/billing-event.enum';
import { OffboardingCronService } from './offboarding-cron.service';

describe('OffboardingCronService billing recovery clocks', () => {
    const now = new Date('2026-08-15T12:00:00.000Z');

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(now);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function makeService(options: {
        expiredTrials?: any[];
        pastDueTenants?: any[];
        subscription?: any;
        expiredComps?: any[];
        endedScheduled?: any[];
    } = {}) {
        const prisma: any = {
            billingSubscription: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    if (where.status === 'trialing') return Promise.resolve(options.expiredTrials ?? []);
                    if (where.cancellationReason?.startsWith === 'comp:') {
                        return Promise.resolve(options.expiredComps ?? []);
                    }
                    if (where.cancelAtPeriodEnd === true) {
                        return Promise.resolve(options.endedScheduled ?? []);
                    }
                    return Promise.resolve([]);
                }),
                findUnique: jest.fn().mockResolvedValue(options.subscription ?? null),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            tenant: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    if (where.subscriptionStatus === 'past_due') {
                        return Promise.resolve(options.pastDueTenants ?? []);
                    }
                    return Promise.resolve([]);
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            billingEvent: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn().mockImplementation((fn: any) => fn(prisma)),
        };
        const redis: any = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
        };
        const offboarding = {
            executeOffboarding: jest.fn(),
            purgeTenant: jest.fn(),
        };
        const emitter = { emit: jest.fn() };
        const cronLock = { runExclusive: jest.fn((_name, _ttl, fn) => fn()) };
        const dunning = { hasLiveAttempt: jest.fn().mockResolvedValue(false) };
        return {
            service: new OffboardingCronService(
                prisma,
                redis,
                offboarding as any,
                emitter as any,
                cronLock as any,
                dunning as any,
            ),
            prisma,
            redis,
            emitter,
            dunning,
        };
    }

    it('anchors an expired trial recovery window durably at trialEndsAt', async () => {
        const trialEndsAt = new Date('2026-08-14T08:00:00.000Z');
        const { service, prisma, redis, emitter } = makeService({
            expiredTrials: [{ id: 'sub-1', tenantId: 'tenant-1', trialEndsAt }],
        });
        // Cache availability must not decide whether the durable transition and
        // its event complete.
        redis.del.mockRejectedValue(new Error('redis unavailable'));
        redis.set.mockRejectedValue(new Error('redis unavailable'));

        await service.trialExpiryDetector();

        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'sub-1',
                status: 'trialing',
                trialEndsAt,
            },
            data: {
                status: 'past_due',
                dunningState: 'grace',
                dunningStartedAt: trialEndsAt,
            },
        });
        expect(prisma.billingEvent.create).toHaveBeenCalled();
        expect(emitter.emit).toHaveBeenCalledWith(
            BillingEventType.TRIAL_ENDED,
            { tenantId: 'tenant-1', subscriptionId: 'sub-1' },
        );
    });

    it('does not let a stale Redis timer override the durable day-10 clock', async () => {
        const { service, prisma, redis, emitter } = makeService({
            pastDueTenants: [{ id: 'tenant-1', name: 'Tenant' }],
            subscription: {
                id: 'sub-1',
                engine: 'internal',
                dunningState: 'soft_lock',
                dunningStartedAt: new Date(now.getTime() - 8 * 86_400_000),
            },
        });
        redis.get.mockImplementation((key: string) => Promise.resolve(
            key.startsWith('offboard:past_due:')
                ? new Date(now.getTime() - 20 * 86_400_000).toISOString()
                : null,
        ));

        await service.graceEnforcer();

        expect(redis.get).not.toHaveBeenCalledWith('offboard:past_due:tenant-1');
        expect(prisma.billingSubscription.updateMany).not.toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'expired' }) }),
        );
        expect(emitter.emit).toHaveBeenCalledWith(
            'billing.subscription.soft_locked',
            { tenantId: 'tenant-1', daysRemaining: 2 },
        );
    });

    it('expires at durable day 10 and tolerates cache invalidation failure', async () => {
        const { service, prisma, redis, emitter } = makeService({
            pastDueTenants: [{ id: 'tenant-1', name: 'Tenant' }],
            subscription: {
                id: 'sub-1',
                engine: 'internal',
                dunningState: 'soft_lock',
                dunningStartedAt: new Date(now.getTime() - 11 * 86_400_000),
            },
        });
        redis.del.mockRejectedValue(new Error('redis unavailable'));

        await service.graceEnforcer();

        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                id: 'sub-1',
                tenantId: 'tenant-1',
                status: 'past_due',
            }),
            data: { status: 'expired', dunningState: 'suspended' },
        });
        expect(prisma.tenant.update).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            data: { subscriptionStatus: 'expired' },
        });
        expect(emitter.emit).toHaveBeenCalledWith(
            BillingEventType.SUBSCRIPTION_EXPIRED,
            { tenantId: 'tenant-1' },
        );
    });

    it('backfills a legacy Redis timer into dunningStartedAt before enforcing it', async () => {
        const legacyStartedAt = new Date(now.getTime() - 11 * 86_400_000);
        const { service, prisma, redis } = makeService({
            pastDueTenants: [{ id: 'tenant-1', name: 'Tenant' }],
            subscription: {
                id: 'sub-1',
                engine: 'internal',
                dunningState: 'grace',
                dunningStartedAt: null,
            },
        });
        redis.get.mockResolvedValue(legacyStartedAt.toISOString());

        await service.graceEnforcer();

        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 'sub-1',
                status: 'past_due',
                dunningStartedAt: null,
            }),
            data: expect.objectContaining({ dunningStartedAt: legacyStartedAt }),
        }));
        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'expired' }) }),
        );
    });

    it('does not overwrite or emit after an expired trial was paid concurrently', async () => {
        const trialEndsAt = new Date('2026-08-14T08:00:00.000Z');
        const { service, prisma, emitter } = makeService({
            expiredTrials: [{ id: 'sub-1', tenantId: 'tenant-1', trialEndsAt }],
        });
        prisma.billingSubscription.updateMany.mockResolvedValue({ count: 0 });

        await service.trialExpiryDetector();

        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(prisma.billingEvent.create).not.toHaveBeenCalled();
        expect(emitter.emit).not.toHaveBeenCalledWith(BillingEventType.TRIAL_ENDED, expect.anything());
    });

    it('does not expire the tenant when a payment wins the grace-period CAS', async () => {
        const { service, prisma, emitter } = makeService({
            pastDueTenants: [{ id: 'tenant-1', name: 'Tenant' }],
            subscription: {
                id: 'sub-1', engine: 'internal', dunningState: 'soft_lock',
                dunningStartedAt: new Date(now.getTime() - 11 * 86_400_000),
            },
        });
        prisma.billingSubscription.updateMany.mockResolvedValue({ count: 0 });

        await service.graceEnforcer();

        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(prisma.billingEvent.create).not.toHaveBeenCalled();
        expect(emitter.emit).not.toHaveBeenCalledWith(BillingEventType.SUBSCRIPTION_EXPIRED, expect.anything());
    });

    it('does not expire a comp plan that was extended after the cron snapshot', async () => {
        const currentPeriodEnd = new Date(now.getTime() - 1_000);
        const { service, prisma, redis } = makeService({
            expiredComps: [{
                id: 'sub-comp', tenantId: 'tenant-comp', status: 'active',
                cancellationReason: 'comp:partner', currentPeriodEnd,
            }],
        });
        prisma.billingSubscription.updateMany.mockResolvedValue({ count: 0 });

        await service.graceEnforcer();

        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 'sub-comp', status: 'active', cancellationReason: 'comp:partner', currentPeriodEnd,
            }),
        }));
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(redis.del).not.toHaveBeenCalledWith('sub_status:tenant-comp');
    });

    it('does not cancel a renewed subscription after a stale period-end snapshot', async () => {
        const currentPeriodEnd = new Date(now.getTime() - 1_000);
        const { service, prisma, redis } = makeService({
            endedScheduled: [{
                id: 'sub-cancel', tenantId: 'tenant-cancel', status: 'active',
                cancelAtPeriodEnd: true, currentPeriodEnd,
            }],
        });
        prisma.billingSubscription.updateMany.mockResolvedValue({ count: 0 });

        await service.graceEnforcer();

        expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 'sub-cancel', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd,
            }),
        }));
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(redis.del).not.toHaveBeenCalledWith('sub_status:tenant-cancel');
    });
});
