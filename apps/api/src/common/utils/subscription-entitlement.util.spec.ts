import {
    evaluateSubscriptionAccess,
    readSubscriptionEntitlement,
    resolveTenantSubscriptionAccess,
    type SubscriptionEntitlementSnapshot,
} from './subscription-entitlement.util';

describe('subscription entitlement policy', () => {
    const base: SubscriptionEntitlementSnapshot = {
        isInternal: false,
        status: 'active',
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        cancellationReason: null,
        dunningStartedAt: null,
    };
    const now = new Date('2026-08-15T12:00:00.000Z');

    it.each(['pending_auth', 'expired'])(
        'hard-locks %s on read and write',
        (status) => {
            expect(evaluateSubscriptionAccess({ ...base, status }, 'read', now)).toMatchObject({
                allowed: false,
                restrictionLevel: 'hard_lock',
            });
            expect(evaluateSubscriptionAccess({ ...base, status }, 'write', now)).toMatchObject({
                allowed: false,
                restrictionLevel: 'hard_lock',
            });
        },
    );

    it('fails closed when a commercial tenant has no subscription state', () => {
        expect(evaluateSubscriptionAccess({ ...base, status: null }, 'read', now)).toMatchObject({
            allowed: false,
            restrictionLevel: 'unavailable',
            error: 'subscription_status_unavailable',
        });
        expect(evaluateSubscriptionAccess({ ...base, status: null, isInternal: true }, 'write', now))
            .toMatchObject({ allowed: true });
    });

    it('keeps a proven paid cancellation window open, then locks at its boundary', () => {
        const cancelled = {
            ...base,
            status: 'cancelled',
            cancelAtPeriodEnd: true,
            currentPeriodEnd: new Date('2026-08-16T12:00:00.000Z'),
        };
        expect(evaluateSubscriptionAccess(cancelled, 'write', now).allowed).toBe(true);
        expect(evaluateSubscriptionAccess(cancelled, 'read', cancelled.currentPeriodEnd)).toMatchObject({
            allowed: false,
            restrictionLevel: 'hard_lock',
        });
    });

    it('enforces an active cancel-at-period-end row at the exact boundary, before cron cleanup', () => {
        const scheduled = {
            ...base,
            status: 'active',
            cancelAtPeriodEnd: true,
            currentPeriodEnd: new Date('2026-08-16T12:00:00.000Z'),
        };
        expect(evaluateSubscriptionAccess(scheduled, 'write', now).allowed).toBe(true);
        expect(evaluateSubscriptionAccess(scheduled, 'read', scheduled.currentPeriodEnd)).toMatchObject({
            allowed: false,
            error: 'subscription_expired',
        });
    });

    it('expires a courtesy plan exactly at its durable period end', () => {
        const comp = {
            ...base,
            status: 'active',
            cancellationReason: 'comp: design partner',
            currentPeriodEnd: new Date(now.getTime() + 1),
        };
        expect(evaluateSubscriptionAccess(comp, 'write', now).allowed).toBe(true);
        expect(evaluateSubscriptionAccess(comp, 'read', comp.currentPeriodEnd)).toMatchObject({
            allowed: false,
            error: 'subscription_expired',
        });
        expect(evaluateSubscriptionAccess({ ...comp, isInternal: true }, 'write', comp.currentPeriodEnd))
            .toMatchObject({ allowed: true });
    });

    it('projects the D0/D3/D10 trial recovery clock even when the detector cron is late', () => {
        expect(evaluateSubscriptionAccess({
            ...base,
            status: 'trialing',
            trialEndsAt: new Date(now.getTime() + 1),
        }, 'write', now).allowed).toBe(true);
        expect(evaluateSubscriptionAccess({
            ...base,
            status: 'trialing',
            trialEndsAt: now,
        }, 'write', now)).toMatchObject({
            allowed: true,
            restrictionLevel: 'none',
        });
        expect(evaluateSubscriptionAccess({
            ...base,
            status: 'trialing',
            trialEndsAt: new Date(now.getTime() - 4 * 86_400_000),
        }, 'write', now)).toMatchObject({
            allowed: false,
            error: 'subscription_restricted',
        });
        expect(evaluateSubscriptionAccess({ ...base, status: 'trialing' }, 'read', now)).toMatchObject({
            allowed: false,
            restrictionLevel: 'unavailable',
        });
    });

    it('fails closed for cancelled rows that cannot prove a deferred paid period', () => {
        expect(evaluateSubscriptionAccess({ ...base, status: 'cancelled' }, 'read', now)).toMatchObject({
            allowed: false,
            error: 'subscription_expired',
        });
    });

    it('makes a voluntary pause read-only without requiring a dunning clock', () => {
        const paused = { ...base, status: 'past_due', cancellationReason: 'paused: vacation' };
        expect(evaluateSubscriptionAccess(paused, 'read', now).allowed).toBe(true);
        expect(evaluateSubscriptionAccess(paused, 'write', now)).toMatchObject({
            allowed: false,
            error: 'subscription_paused',
            restrictionLevel: 'soft_lock',
        });
    });

    it('uses the durable D3/D10 dunning clock consistently', () => {
        const day4 = {
            ...base,
            status: 'past_due',
            dunningStartedAt: new Date(now.getTime() - 4 * 86_400_000),
        };
        expect(evaluateSubscriptionAccess(day4, 'read', now).allowed).toBe(true);
        expect(evaluateSubscriptionAccess(day4, 'write', now)).toMatchObject({
            allowed: false,
            error: 'subscription_restricted',
            daysRemaining: 6,
        });

        const day10 = { ...day4, dunningStartedAt: new Date(now.getTime() - 10 * 86_400_000) };
        expect(evaluateSubscriptionAccess(day10, 'read', now)).toMatchObject({
            allowed: false,
            restrictionLevel: 'hard_lock',
        });
    });

    it('reads the canonical subscription facts and fails closed on database outage', async () => {
        const prisma: any = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    subscriptionStatus: 'cancelled',
                    subscription: {
                        status: 'cancelled',
                        isInternal: false,
                        trialEndsAt: null,
                        cancelAtPeriodEnd: true,
                        currentPeriodEnd: new Date('2026-08-20T00:00:00.000Z'),
                        cancellationReason: 'requested',
                        dunningStartedAt: null,
                    },
                }),
            },
        };
        await expect(readSubscriptionEntitlement(prisma, 'tenant-1')).resolves.toMatchObject({
            status: 'cancelled',
            cancelAtPeriodEnd: true,
        });

        prisma.tenant.findUnique.mockResolvedValue({
            isInternal: false,
            subscriptionStatus: 'active',
            subscription: {
                status: 'past_due',
                trialEndsAt: null,
                cancelAtPeriodEnd: false,
                currentPeriodEnd: null,
                cancellationReason: null,
                dunningStartedAt: new Date('2026-08-14T00:00:00.000Z'),
            },
        });
        await expect(readSubscriptionEntitlement(prisma, 'tenant-1')).resolves.toMatchObject({
            status: 'past_due',
        });

        prisma.tenant.findUnique.mockResolvedValue({
            isInternal: false,
            subscriptionStatus: 'active',
            subscription: null,
        });
        await expect(resolveTenantSubscriptionAccess(prisma, 'tenant-1', 'read')).resolves.toMatchObject({
            allowed: false,
            restrictionLevel: 'unavailable',
        });

        prisma.tenant.findUnique.mockRejectedValue(new Error('database down'));
        await expect(resolveTenantSubscriptionAccess(prisma, 'tenant-1', 'read')).resolves.toMatchObject({
            allowed: false,
            restrictionLevel: 'unavailable',
        });
    });
});
