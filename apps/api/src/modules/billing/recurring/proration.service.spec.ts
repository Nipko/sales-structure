import { ProrationService } from './proration.service';

/**
 * Proration is money the customer sees on their statement. Every case here is a
 * way to overcharge them, undercharge ourselves, or promise something the
 * provider cannot deliver.
 */
describe('ProrationService', () => {
    function makeService() {
        const prisma: any = {
            billingCreditLedger: {
                create: jest.fn().mockResolvedValue({}),
                aggregate: jest.fn().mockResolvedValue({ _sum: { deltaCents: 0 } }),
            },
            billingSubscription: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) },
        };
        return { service: new ProrationService(prisma as any), prisma };
    }

    const TZ = 'America/Bogota';

    describe('computeUpgrade', () => {
        it('credits the unused half of the period against the new plan', () => {
            const { service } = makeService();
            const result = service.computeUpgrade({
                now: new Date('2026-04-25T12:00:00Z'),           // halfway through
                currentPeriodStart: new Date('2026-04-10T12:00:00Z'),
                currentPeriodEnd: new Date('2026-05-10T12:00:00Z'),
                paidCents: 2_769_000,        // Starter
                newAmountCents: 7_577_000,   // Pro
                targetCycle: 'monthly',
                anchorDay: 10,
                timezone: TZ,
            });

            // ~15 of 30 days unused → about half of what was paid.
            expect(result.unusedCents).toBeGreaterThan(1_300_000);
            expect(result.unusedCents).toBeLessThan(1_450_000);
            expect(result.chargeCents).toBe(7_577_000 - result.unusedCents);
            expect(result.reason).toBe('upgrade');
        });

        it('values the unused time from what was PAID, not from the list price', () => {
            // A tenant on a coupon or a country override paid less; crediting the
            // list price would hand them money they never spent.
            const { service } = makeService();
            const result = service.computeUpgrade({
                now: new Date('2026-04-25T12:00:00Z'),
                currentPeriodStart: new Date('2026-04-10T12:00:00Z'),
                currentPeriodEnd: new Date('2026-05-10T12:00:00Z'),
                paidCents: 1_000_000,        // discounted
                newAmountCents: 7_577_000,
                targetCycle: 'monthly',
                anchorDay: 10,
                timezone: TZ,
            });
            expect(result.unusedCents).toBeLessThan(600_000);
        });

        it('starts a fresh period anchored to the original day', () => {
            const { service } = makeService();
            const result = service.computeUpgrade({
                now: new Date('2026-04-25T12:00:00Z'),
                currentPeriodStart: new Date('2026-04-10T12:00:00Z'),
                currentPeriodEnd: new Date('2026-05-10T12:00:00Z'),
                paidCents: 2_769_000,
                newAmountCents: 7_577_000,
                targetCycle: 'monthly',
                anchorDay: 31,
                timezone: TZ,
            });
            expect(result.periodStart).toEqual(new Date('2026-04-25T12:00:00Z'));
            // May has 31 days, so the anchor lands exactly.
            expect(result.periodEnd.getUTCDate()).toBe(31);
        });

        it('applies existing credit before charging', () => {
            const { service } = makeService();
            const result = service.computeUpgrade({
                now: new Date('2026-04-25T12:00:00Z'),
                currentPeriodStart: new Date('2026-04-10T12:00:00Z'),
                currentPeriodEnd: new Date('2026-05-10T12:00:00Z'),
                paidCents: 2_769_000,
                newAmountCents: 7_577_000,
                targetCycle: 'monthly',
                anchorDay: 10,
                timezone: TZ,
                creditBalanceCents: 1_000_000,
            });
            expect(result.creditAppliedCents).toBe(1_000_000);
            expect(result.chargeCents).toBe(7_577_000 - result.unusedCents - 1_000_000);
        });

        it('charges nothing when the unused time already covers the new plan', () => {
            const { service } = makeService();
            const result = service.computeUpgrade({
                now: new Date('2026-04-11T12:00:00Z'),   // one day in
                currentPeriodStart: new Date('2026-04-10T12:00:00Z'),
                currentPeriodEnd: new Date('2027-04-10T12:00:00Z'), // annual
                paidCents: 27_690_000,
                newAmountCents: 2_000_000,
                targetCycle: 'monthly',
                anchorDay: 10,
                timezone: TZ,
            });
            expect(result.chargeCents).toBe(0);
            expect(result.creditGeneratedCents).toBeGreaterThan(0);
            expect(result.reason).toBe('covered_by_unused_time');
        });

        it('skips a charge too small to be worth the transaction fee', () => {
            // The provider takes a fixed fee per transaction: below the floor we
            // would lose money and put a pointless line on the statement.
            const { service } = makeService();
            const result = service.computeUpgrade({
                now: new Date('2026-04-11T12:00:00Z'),
                currentPeriodStart: new Date('2026-04-10T12:00:00Z'),
                currentPeriodEnd: new Date('2026-05-10T12:00:00Z'),
                paidCents: 2_769_000,
                newAmountCents: 2_800_000,
                targetCycle: 'monthly',
                anchorDay: 10,
                timezone: TZ,
            });
            expect(result.chargeCents).toBe(0);
            expect(result.reason).toBe('below_minimum_charge');
        });
    });

    describe('computeDowngrade', () => {
        it('defers to the end of the paid period by default', () => {
            // The customer paid for this period; they keep what they bought.
            const { service } = makeService();
            const periodEnd = new Date('2026-05-10T12:00:00Z');
            const result = service.computeDowngrade({
                now: new Date('2026-04-25T12:00:00Z'),
                currentPeriodEnd: periodEnd,
                immediate: false,
            });
            expect(result.effectiveAt).toEqual(periodEnd);
            expect(result.creditGeneratedCents).toBe(0);
        });

        it('turns the unused time into CREDIT, never a refund', () => {
            // There is no refund API: promising money back would be a promise we
            // cannot keep.
            const { service } = makeService();
            const result = service.computeDowngrade({
                now: new Date('2026-04-25T12:00:00Z'),
                currentPeriodStart: new Date('2026-04-10T12:00:00Z'),
                currentPeriodEnd: new Date('2026-05-10T12:00:00Z'),
                paidCents: 7_577_000,
                immediate: true,
                timezone: TZ,
            });
            expect(result.creditGeneratedCents).toBeGreaterThan(0);
            expect(result.reason).toBe('immediate_with_credit');
        });
    });

    describe('credit ledger', () => {
        it('appends a movement and refreshes the cached balance', async () => {
            const { service, prisma } = makeService();
            prisma.billingCreditLedger.aggregate.mockResolvedValue({ _sum: { deltaCents: 1_500_000 } });

            const result = await service.recordCredit({
                tenantId: 't1', subscriptionId: 'sub-1',
                deltaCents: 1_500_000, currency: 'COP', reason: 'downgrade_proration',
            });

            expect(prisma.billingCreditLedger.create).toHaveBeenCalled();
            expect(result.balanceCents).toBe(1_500_000);
            expect(prisma.billingSubscription.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { creditBalanceCents: 1_500_000 } }),
            );
        });

        it('recomputes the balance from the ledger, not from the cached column', async () => {
            // The column is a cache; only the ledger can explain where a credit
            // came from.
            const { service, prisma } = makeService();
            prisma.billingCreditLedger.aggregate.mockResolvedValue({ _sum: { deltaCents: -500 } });
            expect(await service.recalculateBalance('t1', 'sub-1')).toBe(-500);
        });

        it('treats an empty ledger as zero rather than null', async () => {
            const { service, prisma } = makeService();
            prisma.billingCreditLedger.aggregate.mockResolvedValue({ _sum: { deltaCents: null } });
            expect(await service.getBalance('t1')).toBe(0);
        });
    });
});
