import { DunningService } from './dunning.service';
import { BillingEventType } from '../types/billing-event.enum';
import { SubscriptionStatus } from '../types/subscription-status.enum';

/**
 * Dunning decides when a paying customer loses access. Every case here is a way
 * to lose a customer who would have paid — or to keep charging one who cannot.
 */
describe('DunningService', () => {
    function makeService(subPatch: any = {}, attemptPatch: any = {}) {
        const sub = {
            id: 'sub-1', tenantId: 't1', provider: 'wompi', engine: 'internal',
            status: SubscriptionStatus.ACTIVE,
            dunningState: 'none', dunningStartedAt: null, dunningAttempts: 0,
            currentPeriodEnd: new Date('2026-04-10T00:00:00Z'),
            defaultPaymentSourceId: 'src-1',
            ...subPatch,
        };
        const attempt = {
            id: 'a1', subscriptionId: 'sub-1', tenantId: 't1', purpose: 'renewal',
            periodStart: new Date('2026-04-10T00:00:00Z'),
            periodEnd: new Date('2026-05-10T00:00:00Z'),
            amountCents: 2_769_000, currency: 'COP', attemptNumber: 1,
            status: 'failed',
            paymentSourceId: 'src-1',
            ...attemptPatch,
        };
        const prisma: any = {
            billingSubscription: {
                findUnique: jest.fn().mockResolvedValue(sub),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            billingChargeAttempt: {
                findUnique: jest.fn().mockResolvedValue(attempt),
                findFirst: jest.fn().mockResolvedValue(attempt),
                count: jest.fn().mockResolvedValue(0),
            },
            billingPaymentSource: { update: jest.fn().mockResolvedValue({}) },
            tenant: { update: jest.fn().mockResolvedValue({}) },
            $queryRaw: jest.fn().mockResolvedValue([]),
        };
        prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
        const emitter = { emit: jest.fn() };
        const engine = { claimAttempt: jest.fn().mockResolvedValue({ id: 'a2', reference: 'r2', cycleKey: 'c' }) };
        const queue = { add: jest.fn().mockResolvedValue({}) };
        const cronLock = { runExclusive: jest.fn((_name, _ttl, fn) => fn()) };
        const redis = { del: jest.fn().mockResolvedValue(1) };
        return {
            service: new DunningService(
                prisma as any,
                emitter as any,
                engine as any,
                queue as any,
                cronLock as any,
                redis as any,
            ),
            prisma, emitter, engine, queue, cronLock, redis, sub, attempt,
        };
    }

    describe('the first decline', () => {
        it('retries WITHOUT suspending anything', async () => {
            // A bank declining at 2pm is routine. Cutting service over it is
            // self-inflicted churn: most of these pay on the second try.
            const { service, prisma, queue } = makeService();

            await service.advance('sub-1', 'a1', 'soft');

            const patch = prisma.billingSubscription.updateMany.mock.calls[0][0].data;
            expect(patch.dunningState).toBe('retrying');
            expect(patch.status).toBeUndefined(); // still active
            expect(queue.add).toHaveBeenCalled();
        });

        it('creates a NEW attempt row rather than replaying the failed request', async () => {
            // The provider has no idempotency key: reusing a reference risks the
            // same period being charged twice.
            const { service, engine } = makeService();

            await service.advance('sub-1', 'a1', 'soft');

            expect(engine.claimAttempt).toHaveBeenCalledWith(
                expect.objectContaining({ attemptNumber: 2, periodStart: expect.any(Date) }),
            );
        });

        it('keeps operation identity and upgrade settlement metadata on a retry', async () => {
            const metadata = {
                operationKey: 'plan-change:starter:pro:monthly:period-a',
                targetPlanId: 'plan-pro',
                targetAmountCents: 40_000_000,
            };
            const { service, engine } = makeService({}, {
                purpose: 'upgrade_proration',
                metadata,
            });

            await service.advance('sub-1', 'a1', 'soft');

            expect(engine.claimAttempt).toHaveBeenCalledWith(expect.objectContaining({
                purpose: 'upgrade_proration',
                operationKey: metadata.operationKey,
                metadata,
            }));
        });
    });

    describe('a permanently rejected instrument', () => {
        it('stops retrying and asks for a new payment method', async () => {
            // Retrying an expired card just burns the ladder while the customer
            // waits; what unblocks them is a different instrument.
            const { service, prisma, queue, emitter } = makeService();

            await service.advance('sub-1', 'a1', 'hard');

            expect(queue.add).not.toHaveBeenCalled();
            expect(prisma.billingPaymentSource.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'src-1' } }),
            );
            expect(emitter.emit).toHaveBeenCalledWith(
                BillingEventType.PAYMENT_FAILED,
                expect.objectContaining({ requiresNewPaymentMethod: true }),
            );
        });

        it('charges immediately when a new method arrives', async () => {
            const { service, queue } = makeService({ dunningState: 'soft_lock' });

            await service.onPaymentSourceAdded({ tenantId: 't1', subscriptionId: 'sub-1' });

            // Zero delay: the customer just did the thing that unblocks them.
            expect(queue.add).toHaveBeenCalledWith(
                'charge', expect.anything(), expect.objectContaining({ delay: 0 }),
            );
        });

        it('does not mark the source failed when a late approval wins the attempt lock', async () => {
            const { service, prisma, attempt } = makeService();
            prisma.billingChargeAttempt.findUnique
                .mockResolvedValueOnce(attempt)
                .mockResolvedValueOnce({ ...attempt, status: 'succeeded' });

            await service.advance('sub-1', 'a1', 'hard');

            expect(prisma.billingPaymentSource.update).not.toHaveBeenCalled();
            expect(prisma.billingSubscription.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('an unknown outcome', () => {
        it('freezes everything: no retry AND no suspension', async () => {
            // The money may already have moved. Retrying could charge twice;
            // suspending could cut off someone who already paid.
            const { service, prisma, queue, emitter } = makeService();

            await service.advance('sub-1', 'a1', 'indeterminate');

            expect(queue.add).not.toHaveBeenCalled();
            const patch = prisma.billingSubscription.updateMany.mock.calls[0][0].data;
            expect(patch.dunningState).toBe('indeterminate');
            expect(patch.status).toBeUndefined();
            expect(emitter.emit).not.toHaveBeenCalledWith(
                BillingEventType.SUBSCRIPTION_EXPIRED, expect.anything(),
            );
        });
    });

    describe('the ladder', () => {
        it('soft-locks once the retries have been failing for days', async () => {
            const { service, prisma, emitter } = makeService({
                dunningStartedAt: new Date(Date.now() - 4 * 86_400_000),
                dunningAttempts: 1,
            });

            await service.advance('sub-1', 'a1', 'soft');

            const patch = prisma.billingSubscription.updateMany.mock.calls[0][0].data;
            expect(patch.status).toBe(SubscriptionStatus.PAST_DUE);
            expect(patch.dunningState).toBe('soft_lock');
            expect(emitter.emit).toHaveBeenCalledWith(
                'billing.subscription.soft_locked', expect.objectContaining({ tenantId: 't1' }),
            );
        });

        it('expires only after the whole recovery window', async () => {
            const { service, prisma, emitter, queue } = makeService({
                dunningStartedAt: new Date(Date.now() - 11 * 86_400_000),
                dunningAttempts: 3,
            });

            await service.advance('sub-1', 'a1', 'soft');

            const patch = prisma.billingSubscription.updateMany.mock.calls[0][0].data;
            expect(patch.status).toBe(SubscriptionStatus.EXPIRED);
            expect(emitter.emit).toHaveBeenCalledWith(
                BillingEventType.SUBSCRIPTION_EXPIRED, expect.objectContaining({ subscriptionId: 'sub-1' }),
            );
            expect(queue.add).not.toHaveBeenCalled();
        });

        it('does not expire at attempt four before day ten', async () => {
            const { service, prisma } = makeService({
                dunningStartedAt: new Date(Date.now() - 4 * 86_400_000),
                dunningAttempts: 4,
            });

            await service.advance('sub-1', 'a1', 'soft');

            expect(prisma.billingSubscription.updateMany.mock.calls.every(
                ([call]: any[]) => call.data.status !== SubscriptionStatus.EXPIRED,
            )).toBe(true);
        });
    });

    describe('scope', () => {
        it('ignores subscriptions billed by the provider itself', async () => {
            // MercadoPago runs its own retry schedule; ours would duplicate it.
            const { service, prisma, queue } = makeService({ engine: 'provider' });

            await service.advance('sub-1', 'a1', 'soft');

            expect(prisma.billingSubscription.update).not.toHaveBeenCalled();
            expect(prisma.billingSubscription.updateMany).not.toHaveBeenCalled();
            expect(queue.add).not.toHaveBeenCalled();
        });

        it('ignores payment failures that did not come from our engine', async () => {
            const { service, prisma } = makeService();
            await service.onPaymentFailed({ tenantId: 't1' } as any);
            expect(prisma.billingSubscription.findUnique).not.toHaveBeenCalled();
        });

        it('ignores a stale failure event after the attempt was approved', async () => {
            const { service, prisma, engine, queue } = makeService({}, { status: 'succeeded' });

            await service.advance('sub-1', 'a1', 'soft');

            expect(prisma.billingSubscription.updateMany).not.toHaveBeenCalled();
            expect(engine.claimAttempt).not.toHaveBeenCalled();
            expect(queue.add).not.toHaveBeenCalled();
        });
    });

    describe('hasLiveAttempt', () => {
        it('reports a charge still in play so offboarding does not cut service', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.count.mockResolvedValue(1);
            expect(await service.hasLiveAttempt('sub-1')).toBe(true);

            const where = prisma.billingChargeAttempt.count.mock.calls[0][0].where;
            expect(where.status.in).toEqual(
                expect.arrayContaining(['scheduled', 'in_flight', 'pending_provider']),
            );
        });

        it('reports no live attempt when everything settled', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.count.mockResolvedValue(0);
            expect(await service.hasLiveAttempt('sub-1')).toBe(false);
        });
    });

    describe('entitlement cache invalidation', () => {
        const expectedKeys = [
            'sub_status:t1',
            'tenant_plan:t1',
            'plan_features:t1',
        ];

        it('evicts every entitlement view when a hard failure enters grace', async () => {
            const { service, redis } = makeService();

            await service.advance('sub-1', 'a1', 'hard');

            expect(redis.del.mock.calls.map(([key]: [string]) => key)).toEqual(
                expect.arrayContaining(expectedKeys),
            );
        });

        it('evicts every entitlement view when the account enters soft lock', async () => {
            const { service, redis } = makeService({
                dunningStartedAt: new Date(Date.now() - 4 * 86_400_000),
                dunningAttempts: 1,
            });

            await service.advance('sub-1', 'a1', 'soft');

            expect(redis.del.mock.calls.map(([key]: [string]) => key)).toEqual(
                expect.arrayContaining(expectedKeys),
            );
        });

        it('evicts every entitlement view when the account expires', async () => {
            const { service, redis } = makeService({
                dunningStartedAt: new Date(Date.now() - 11 * 86_400_000),
                dunningAttempts: 3,
            });

            await service.advance('sub-1', 'a1', 'soft');

            expect(redis.del.mock.calls.map(([key]: [string]) => key)).toEqual(
                expect.arrayContaining(expectedKeys),
            );
        });

        it('keeps the durable transition successful when Redis is unavailable', async () => {
            const { service, prisma, redis } = makeService();
            redis.del.mockRejectedValue(new Error('redis unavailable'));

            await expect(service.advance('sub-1', 'a1', 'hard')).resolves.toBeUndefined();

            expect(redis.del).toHaveBeenCalledTimes(3);
            expect(prisma.billingSubscription.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ dunningState: 'grace' }) }),
            );
        });

        it('does not overwrite a subscription that was paid after the failure snapshot', async () => {
            const { service, prisma, emitter } = makeService();
            prisma.billingSubscription.updateMany.mockResolvedValue({ count: 0 });

            await service.advance('sub-1', 'a1', 'hard');

            expect(prisma.billingPaymentSource.update).not.toHaveBeenCalled();
            expect(emitter.emit).not.toHaveBeenCalledWith(
                BillingEventType.PAYMENT_FAILED,
                expect.objectContaining({ requiresNewPaymentMethod: true }),
            );
        });
    });
});
