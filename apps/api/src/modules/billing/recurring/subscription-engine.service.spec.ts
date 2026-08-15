import { SubscriptionEngineService } from './subscription-engine.service';
import { BillingEventType } from '../types/billing-event.enum';
import { SubscriptionStatus } from '../types/subscription-status.enum';

/**
 * These tests guard the invariants that keep the engine from charging a customer
 * twice — or from charging one who should not be charged at all. Every case here
 * corresponds to a way real money goes wrong.
 */
describe('SubscriptionEngineService', () => {
    function makeService(overrides: { prisma?: any; emitter?: any; wompiConfig?: any } = {}) {
        // Explicitly `any`: $transaction references `prisma` inside its own
        // initializer, which TypeScript cannot infer (TS7022).
        const prisma: any = {
            billingChargeAttempt: {
                create: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
                findUnique: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
            },
            billingSubscription: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
            billingPayment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }) },
            billingEvent: { create: jest.fn().mockResolvedValue({}) },
            billingPlan: { findUnique: jest.fn().mockResolvedValue({ slug: 'pro' }) },
            tenant: { findUnique: jest.fn().mockResolvedValue({ isActive: true }), update: jest.fn().mockResolvedValue({}) },
            $queryRaw: jest.fn(),
            $transaction: jest.fn(async (cb: any) => cb(prisma)),
            ...overrides.prisma,
        };
        const redis = { del: jest.fn().mockResolvedValue(undefined) };
        const emitter = overrides.emitter ?? { emit: jest.fn() };
        const providerFactory = { getCharging: jest.fn(), capabilitiesOf: jest.fn() };
        // Sandbox por defecto, que es como corre el riel hoy: el pago queda
        // sellado como de prueba y la capa fiscal no gasta un consecutivo real.
        const wompiConfig = overrides.wompiConfig ?? { environment: () => 'sandbox' };
        return {
            service: new SubscriptionEngineService(prisma as any, redis as any, emitter as any, providerFactory as any, wompiConfig as any),
            prisma,
            emitter,
            redis,
        };
    }

    describe('claimAttempt', () => {
        it('claims a cycle and derives a colon-free key and reference', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.create.mockResolvedValue({ id: 'a1', reference: 'r', cycleKey: 'c' });

            await service.claimAttempt({
                subscriptionId: '11111111-2222-3333-4444-555555555555',
                tenantId: 't1',
                provider: 'wompi',
                purpose: 'renewal',
                periodStart: new Date('2026-04-10T00:00:00Z'),
                periodEnd: new Date('2026-05-10T00:00:00Z'),
                amountCents: 2_769_000,
                currency: 'COP',
                scheduledAt: new Date('2026-04-10T14:00:00Z'),
            });

            const data = prisma.billingChargeAttempt.create.mock.calls[0][0].data;
            expect(data.cycleKey).toBe('11111111-2222-3333-4444-555555555555.20260410.renewal');
            expect(data.reference).toBe('sub_11111111_20260410_1');
            expect(data.status).toBe('scheduled');
            // The frozen amount travels with the claim; the charge never re-reads a price.
            expect(data.amountCents).toBe(2_769_000);
            expect(data.cycleKey).not.toContain(':');
        });

        it('returns null when the cycle is already claimed instead of raising', async () => {
            // This is the normal outcome of the duplicated cron (API + worker),
            // and it is precisely what stops the second charge.
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.create.mockRejectedValue({ code: 'P2002' });

            const result = await service.claimAttempt({
                subscriptionId: 'sub-1', tenantId: 't1', provider: 'wompi', purpose: 'renewal',
                periodStart: new Date(), periodEnd: new Date(), amountCents: 100, currency: 'COP',
                scheduledAt: new Date(),
            });

            expect(result).toBeNull();
        });

        it('propagates unexpected database errors instead of swallowing them', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.create.mockRejectedValue(new Error('connection lost'));

            await expect(service.claimAttempt({
                subscriptionId: 'sub-1', tenantId: 't1', provider: 'wompi', purpose: 'renewal',
                periodStart: new Date(), periodEnd: new Date(), amountCents: 100, currency: 'COP',
                scheduledAt: new Date(),
            })).rejects.toThrow('connection lost');
        });
    });

    describe('reserveForExecution', () => {
        it('returns the row only when the guarded update matched', async () => {
            const { service, prisma } = makeService();
            prisma.$queryRaw.mockResolvedValue([{ id: 'a1', status: 'in_flight' }]);
            expect(await service.reserveForExecution('a1')).toMatchObject({ id: 'a1' });
        });

        it('returns null when another worker already took it', async () => {
            const { service, prisma } = makeService();
            prisma.$queryRaw.mockResolvedValue([]);
            expect(await service.reserveForExecution('a1')).toBeNull();
        });
    });

    describe('revalidate', () => {
        const attempt = { subscriptionId: 'sub-1', amountCents: 2_769_000 };
        const baseSub = {
            id: 'sub-1', tenantId: 't1', engine: 'internal',
            status: SubscriptionStatus.ACTIVE, cancelAtPeriodEnd: false,
            cancellationReason: null, chargeAmountCents: 2_769_000,
        };

        it('accepts a healthy active subscription', async () => {
            const { service, prisma } = makeService();
            prisma.billingSubscription.findUnique.mockResolvedValue(baseSub);
            expect(await service.revalidate(attempt)).toEqual({ ok: true });
        });

        it.each([
            ['cancelled subscription', { status: SubscriptionStatus.CANCELLED }, 'status_cancelled'],
            ['scheduled to stop at period end', { cancelAtPeriodEnd: true }, 'cancel_at_period_end'],
            ['comp plan', { cancellationReason: 'comp: employee' }, 'comp_plan'],
            ['engine switched back to the provider', { engine: 'provider' }, 'engine_disabled'],
            ['amount changed since scheduling', { chargeAmountCents: 3_000_000 }, 'amount_changed'],
        ])('refuses to charge a %s', async (_label, patch, expectedReason) => {
            const { service, prisma } = makeService();
            prisma.billingSubscription.findUnique.mockResolvedValue({ ...baseSub, ...patch });
            expect(await service.revalidate(attempt)).toEqual({ ok: false, reason: expectedReason });
        });

        it('refuses when the tenant was deactivated', async () => {
            const { service, prisma } = makeService();
            prisma.billingSubscription.findUnique.mockResolvedValue(baseSub);
            prisma.tenant.findUnique.mockResolvedValue({ isActive: false });
            expect(await service.revalidate(attempt)).toEqual({ ok: false, reason: 'tenant_inactive' });
        });
    });

    describe('isTooLate', () => {
        it('accepts an attempt scheduled a few hours ago', () => {
            const { service } = makeService();
            const attempt = { scheduledAt: new Date(Date.now() - 3 * 3_600_000) };
            expect(service.isTooLate(attempt)).toBe(false);
        });

        it('refuses an attempt scheduled days ago', () => {
            // A worker returning from a long outage must not fire an avalanche of
            // retroactive charges on a day unrelated to the billing date.
            const { service } = makeService();
            const attempt = { scheduledAt: new Date(Date.now() - 5 * 24 * 3_600_000) };
            expect(service.isTooLate(attempt)).toBe(true);
        });
    });

    describe('classifyFailure', () => {
        it.each([
            ['tarjeta vencida', 'hard'],
            ['Card expired', 'hard'],
            ['Tarjeta robada', 'hard'],
            ['fondos insuficientes', 'soft'],
            ['issuer unavailable', 'soft'],
        ])('classifies "%s" as %s', (message, expected) => {
            const { service } = makeService();
            // Retrying a hard failure only burns attempts: what the customer
            // needs is a different instrument, not another try.
            expect(service.classifyFailure({ statusMessage: message })).toBe(expected);
        });
    });

    describe('settleApproved', () => {
        const attempt = {
            id: 'a1', tenantId: 't1', subscriptionId: 'sub-1', status: 'pending_provider',
            amountCents: 2_769_000, currency: 'COP', provider: 'wompi',
            periodStart: new Date('2026-04-10T00:00:00Z'),
            periodEnd: new Date('2026-05-10T00:00:00Z'),
            subscription: {
                id: 'sub-1', tenantId: 't1', billingAnchorDay: 10, billingTimezone: 'America/Bogota',
                chargeAmountCents: 2_769_000, chargeCurrency: 'COP', metadata: { billingCycle: 'monthly' },
                pendingUpgradePlanId: null,
            },
        };
        const charge = { providerChargeId: 'txn-1', status: 'approved' as const, reference: 'r', amountCents: 2_769_000, currency: 'COP', settledAt: new Date() };

        it('records the payment, advances the period and emits the fiscal event', async () => {
            const { service, prisma, emitter } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue(attempt);

            await service.settleApproved('a1', charge);

            expect(prisma.billingPayment.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ providerPaymentId: 'txn-1', status: 'succeeded' }),
            }));
            // One fiscal invoice per attempt, enforced by UNIQUE(payment_id).
            expect(prisma.billingChargeAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'succeeded', paymentId: 'pay-1' }),
            }));
            // DIAN invoicing keys off this exact event.
            expect(emitter.emit).toHaveBeenCalledWith(
                BillingEventType.PAYMENT_SUCCEEDED,
                expect.objectContaining({ providerPaymentId: 'txn-1', tenantId: 't1' }),
            );
        });

        it('espeja el plan en tenants al cobrarse una mejora: de ahí salen los límites', async () => {
            // `tenants.plan` es el campo desnormalizado que leen el rate limiter
            // y las features. Sin este espejo el cliente pagaba el upgrade y
            // seguía capado en el plan viejo.
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({
                ...attempt,
                subscription: { ...attempt.subscription, pendingUpgradePlanId: 'plan-pro' },
            });

            await service.settleApproved('a1', charge);

            expect(prisma.billingSubscription.update.mock.calls[0][0].data).toMatchObject({
                planId: 'plan-pro', pendingUpgradePlanId: null,
            });
            expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ plan: 'pro' }),
            }));
        });

        it('no toca el plan del tenant en una renovación normal', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue(attempt);

            await service.settleApproved('a1', charge);

            const patch = prisma.tenant.update.mock.calls[0][0].data;
            expect(patch.plan).toBeUndefined();
            expect(prisma.billingPlan.findUnique).not.toHaveBeenCalled();
        });

        it('advances the subscription to the next period and clears any dunning', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue(attempt);

            await service.settleApproved('a1', charge);

            const patch = prisma.billingSubscription.update.mock.calls[0][0].data;
            expect(patch.status).toBe(SubscriptionStatus.ACTIVE);
            expect(patch.currentPeriodEnd).toEqual(attempt.periodEnd);
            expect(patch.dunningState).toBe('none');
            expect(patch.dunningAttempts).toBe(0);
            // Next charge is anchored to the new period, not to "now + 30 days".
            expect(patch.nextChargeAt).toBeInstanceOf(Date);
            expect(patch.nextChargeAt.getTime()).toBeGreaterThan(attempt.periodEnd.getTime() - 86_400_000);
        });

        it('applies a plan upgrade only once the charge lands', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({
                ...attempt,
                subscription: { ...attempt.subscription, pendingUpgradePlanId: 'plan-pro' },
            });

            await service.settleApproved('a1', charge);

            const patch = prisma.billingSubscription.update.mock.calls[0][0].data;
            expect(patch.planId).toBe('plan-pro');
            expect(patch.pendingUpgradePlanId).toBeNull();
        });

        it('is a no-op when the attempt already settled', async () => {
            // Webhook and polling both land here; the second one must not create
            // a second payment row — nor a second DIAN invoice.
            const { service, prisma, emitter } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({ ...attempt, status: 'succeeded' });

            await service.settleApproved('a1', charge);

            expect(prisma.billingPayment.create).not.toHaveBeenCalled();
            expect(emitter.emit).not.toHaveBeenCalled();
        });
    });

    describe('markIndeterminate', () => {
        it('freezes the attempt and raises an incident WITHOUT marking it failed', async () => {
            // Marking it failed would let the dunning policy create another
            // attempt for the same cycle — and the money may already have moved.
            const { service, prisma, emitter } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({
                id: 'a1', tenantId: 't1', subscriptionId: 'sub-1', reference: 'sub_x_20260410_1', metadata: {},
            });

            await service.markIndeterminate('a1', 'timeout');

            const patch = prisma.billingChargeAttempt.update.mock.calls[0][0].data;
            expect(patch.status).toBe('in_flight');
            expect(patch.failureClass).toBe('indeterminate');
            expect(patch.status).not.toBe('failed');
            expect(emitter.emit).toHaveBeenCalledWith(
                'billing.charge.indeterminate',
                expect.objectContaining({ reference: 'sub_x_20260410_1' }),
            );
        });
    });

    describe('computeNextCycle', () => {
        it('anchors the next period instead of adding a fixed number of days', () => {
            const { service } = makeService();
            const result = service.computeNextCycle({
                id: 'sub-1',
                currentPeriodEnd: new Date('2026-01-31T00:00:00Z'),
                billingAnchorDay: 31,
                billingTimezone: 'America/Bogota',
                chargeAmountCents: 100,
                chargeCurrency: 'COP',
                metadata: { billingCycle: 'monthly' },
            });
            // February clamps to the 28th...
            expect(result.periodEnd.toISOString().slice(0, 10)).toBe('2026-02-28');
            // ...and the anchor is preserved so March returns to the 31st.
            expect(result.anchorDay).toBe(31);
        });
    });
});
