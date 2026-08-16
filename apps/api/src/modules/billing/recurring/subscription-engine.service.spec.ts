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
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUnique: jest.fn(),
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            billingSubscription: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
            billingPayment: {
                create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
                findUnique: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
            },
            billingEvent: { create: jest.fn().mockResolvedValue({}) },
            billingPlan: { findUnique: jest.fn().mockResolvedValue({ slug: 'pro' }) },
            tenant: { findUnique: jest.fn().mockResolvedValue({ isActive: true }), update: jest.fn().mockResolvedValue({}) },
            $queryRaw: jest.fn().mockResolvedValue([{ id: 'a1', status: 'pending_provider' }]),
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
            expect(data.reference).toBe('sub_11111111222233334444555555555555_ren_20260410_1');
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

        it('gives two same-day upgrade operations different durable identities', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.create
                .mockResolvedValueOnce({ id: 'a1', reference: 'r1', cycleKey: 'c1' })
                .mockResolvedValueOnce({ id: 'a2', reference: 'r2', cycleKey: 'c2' });
            const base = {
                subscriptionId: '11111111-2222-3333-4444-555555555555',
                tenantId: 't1', provider: 'wompi' as const, purpose: 'upgrade_proration' as const,
                periodStart: new Date('2026-08-15T14:00:00Z'),
                periodEnd: new Date('2026-09-15T14:00:00Z'),
                amountCents: 100, currency: 'COP', scheduledAt: new Date(),
            };

            await service.claimAttempt({ ...base, operationKey: 'starter:pro:monthly:period-a' });
            await service.claimAttempt({ ...base, operationKey: 'pro:enterprise:monthly:period-b' });

            const [first, second] = prisma.billingChargeAttempt.create.mock.calls.map(([arg]: any[]) => arg.data);
            expect(first.cycleKey).not.toBe(second.cycleKey);
            expect(first.reference).not.toBe(second.reference);
            expect(first.reference.length).toBeLessThanOrEqual(64);
            expect(second.reference.length).toBeLessThanOrEqual(64);
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

        it.each(['initial', 'renewal'])('abandons a stale %s snapshot once an upgrade owns the next charge', async (purpose) => {
            const { service, prisma } = makeService();
            prisma.billingSubscription.findUnique.mockResolvedValue({
                ...baseSub,
                ...(purpose === 'initial' ? { status: SubscriptionStatus.PENDING_AUTH } : {}),
                pendingUpgradePlanId: 'plan-pro',
            });

            await expect(service.revalidate({ ...attempt, purpose })).resolves.toEqual({
                ok: false,
                reason: 'pending_upgrade_charge',
            });
            expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
        });

        it('rejects a retry when a sibling attempt already paid the cycle', async () => {
            const { service, prisma } = makeService();
            prisma.billingSubscription.findUnique.mockResolvedValue(baseSub);
            prisma.billingChargeAttempt.findFirst.mockResolvedValue({ id: 'paid-attempt' });

            await expect(service.revalidate({
                ...attempt,
                id: 'retry-attempt',
                purpose: 'renewal',
                cycleKey: 'sub-1.20260410.renewal',
            })).resolves.toEqual({ ok: false, reason: 'cycle_already_paid' });
            expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
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
            cycleKey: 'sub-1.20260410.renewal',
            reference: 'r',
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
            expect(prisma.billingChargeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    cycleKey: 'sub-1.20260410.renewal',
                    status: 'scheduled',
                }),
                data: expect.objectContaining({ status: 'superseded' }),
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
                purpose: 'upgrade_proration',
                metadata: { targetPlanId: 'plan-pro', targetAmountCents: 5_000_000, targetCurrency: 'COP' },
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
                purpose: 'upgrade_proration',
                metadata: { targetPlanId: 'plan-pro', targetAmountCents: 5_000_000, targetCurrency: 'COP' },
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

        it('re-checks the locked attempt and lets only the concurrent winner emit payment/fiscal work', async () => {
            const { service, prisma, emitter } = makeService();
            // Both resolvers saw pending_provider before entering the tx; by the
            // time this one obtains FOR UPDATE, the other already committed.
            prisma.billingChargeAttempt.findUnique.mockResolvedValue(attempt);
            prisma.$queryRaw.mockResolvedValueOnce([{ id: 'a1', status: 'succeeded' }]);

            await service.settleApproved('a1', charge);

            expect(prisma.billingPayment.create).not.toHaveBeenCalled();
            expect(prisma.billingSubscription.update).not.toHaveBeenCalled();
            expect(emitter.emit).not.toHaveBeenCalled();
        });
    });

    describe('settleFailed convergence', () => {
        it('does not overwrite an APPROVED result that won the attempt-row lock', async () => {
            const { service, prisma, emitter } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({
                id: 'a1', tenantId: 't1', subscriptionId: 'sub-1',
                status: 'succeeded', provider: 'wompi', providerTxnId: 'txn-1',
                reference: 'r', amountCents: 100, currency: 'COP', metadata: {},
            });

            await service.settleFailed('a1', {
                providerChargeId: 'txn-1', reference: 'r', amountCents: 100,
                currency: 'COP', status: 'declined',
            }, 'soft');

            expect(prisma.billingChargeAttempt.update).not.toHaveBeenCalled();
            expect(emitter.emit).not.toHaveBeenCalledWith(
                BillingEventType.PAYMENT_FAILED,
                expect.anything(),
            );
        });

        it('emits a declined outcome only once when webhook and poll duplicate it', async () => {
            const { service, prisma, emitter } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({
                id: 'a1', tenantId: 't1', subscriptionId: 'sub-1', status: 'failed',
                provider: 'wompi', reference: 'r', amountCents: 100, currency: 'COP', metadata: {},
            });

            await service.settleFailed('a1', {
                reference: 'r', amountCents: 100, currency: 'COP', status: 'declined',
            }, 'soft');

            expect(prisma.billingChargeAttempt.update).not.toHaveBeenCalled();
            expect(emitter.emit).not.toHaveBeenCalledWith(BillingEventType.PAYMENT_FAILED, expect.anything());
        });
    });

    describe('markAttempt convergence', () => {
        it('does not downgrade a webhook-settled attempt to pending_provider', async () => {
            const { service, prisma } = makeService();
            prisma.billingChargeAttempt.updateMany.mockResolvedValue({ count: 0 });

            await expect(service.markAttempt('a1', 'pending_provider', {
                providerTxnId: 'txn-1',
            })).resolves.toBe(false);

            expect(prisma.billingChargeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ status: { notIn: expect.arrayContaining(['succeeded']) } }),
            }));
        });
    });

    describe('settleRefunded', () => {
        it('finaliza la reserva y revoca entitlement una sola vez en un void total', async () => {
            const { service, prisma, emitter } = makeService();
            const attempt = {
                id: 'a1', tenantId: 't1', subscriptionId: 'sub-1', paymentId: 'pay-1',
                status: 'succeeded', provider: 'wompi', providerTxnId: 'txn-1',
                reference: 'r', amountCents: 100, currency: 'COP', metadata: {},
                periodEnd: new Date('2026-09-01T00:00:00.000Z'),
                settledAt: new Date('2026-08-01T00:00:00.000Z'),
                subscription: { id: 'sub-1', status: SubscriptionStatus.ACTIVE },
            };
            prisma.billingChargeAttempt.findUnique.mockResolvedValue(attempt);
            prisma.billingPayment.findUnique.mockResolvedValue({
                id: 'pay-1', tenantId: 't1', subscriptionId: 'sub-1', status: 'succeeded',
                providerPaymentId: 'txn-1', amountCents: 100, currency: 'COP',
                metadata: {
                    railEnvironment: 'production',
                    refundPendingAmountCents: 100,
                    refundPendingTotalCents: 100,
                },
            });
            prisma.billingSubscription.findUnique.mockResolvedValue({
                id: 'sub-1', status: SubscriptionStatus.ACTIVE, cancellationReason: null,
                currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
            });
            prisma.tenant.findUnique.mockResolvedValue({ isInternal: false });

            await service.settleRefunded('a1', {
                providerChargeId: 'txn-1', reference: 'r', amountCents: 100, currency: 'COP',
            });

            const paymentPatch = prisma.billingPayment.update.mock.calls[0][0].data;
            expect(paymentPatch.status).toBe('refunded');
            expect(paymentPatch.metadata.refundedAmountCents).toBe(100);
            expect(paymentPatch.metadata.refundPendingAmountCents).toBeUndefined();
            expect(paymentPatch.metadata.refundPendingTotalCents).toBeUndefined();
            expect(prisma.billingSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
            }));
            expect(emitter.emit).toHaveBeenCalledWith(
                BillingEventType.PAYMENT_REFUNDED,
                expect.objectContaining({ paymentId: 'pay-1', amountCents: 100 }),
            );
        });

        it('registra y factura el refund historico sin revocar un ciclo posterior pagado', async () => {
            const { service, prisma, emitter } = makeService();
            const attempt = {
                id: 'a-old', tenantId: 't1', subscriptionId: 'sub-1', paymentId: 'pay-old',
                status: 'succeeded', provider: 'wompi', providerTxnId: 'txn-old',
                reference: 'r-old', amountCents: 100, currency: 'COP', metadata: {},
                periodEnd: new Date('2026-08-01T00:00:00.000Z'),
                settledAt: new Date('2026-07-01T00:00:00.000Z'),
                subscription: { id: 'sub-1', status: SubscriptionStatus.ACTIVE },
            };
            prisma.billingChargeAttempt.findUnique.mockResolvedValue(attempt);
            prisma.billingChargeAttempt.findFirst.mockResolvedValue({ id: 'a-current' });
            prisma.billingPayment.findUnique.mockResolvedValue({
                id: 'pay-old', tenantId: 't1', subscriptionId: 'sub-1', status: 'succeeded',
                providerPaymentId: 'txn-old', amountCents: 100, currency: 'COP', metadata: {},
            });
            prisma.billingSubscription.findUnique.mockResolvedValue({
                id: 'sub-1', status: SubscriptionStatus.ACTIVE, cancellationReason: null,
                currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
            });
            prisma.tenant.findUnique.mockResolvedValue({ isInternal: false });

            await service.settleRefunded('a-old', {
                providerChargeId: 'txn-old', reference: 'r-old', amountCents: 100, currency: 'COP',
            });

            expect(prisma.billingPayment.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'refunded' }),
            }));
            expect(prisma.billingSubscription.update).not.toHaveBeenCalled();
            expect(prisma.tenant.update).not.toHaveBeenCalled();
            expect(emitter.emit).toHaveBeenCalledWith(
                BillingEventType.PAYMENT_REFUNDED,
                expect.objectContaining({ paymentId: 'pay-old', amountCents: 100 }),
            );
        });

        it('revoca el ciclo si lo unico posterior fue una prorrata de upgrade', async () => {
            const { service, prisma } = makeService();
            const periodEnd = new Date('2026-09-01T00:00:00.000Z');
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({
                id: 'a-initial', tenantId: 't1', subscriptionId: 'sub-1', paymentId: 'pay-initial',
                status: 'succeeded', purpose: 'initial', provider: 'wompi', providerTxnId: 'txn-initial',
                reference: 'r-initial', amountCents: 100, currency: 'COP', metadata: {},
                periodEnd, settledAt: new Date('2026-08-01T00:00:00.000Z'),
                subscription: { id: 'sub-1', status: SubscriptionStatus.ACTIVE },
            });
            // There is a later successful upgrade in the real ledger, but the
            // replacement query deliberately asks only for initial/renewal and
            // therefore returns none.
            prisma.billingChargeAttempt.findFirst.mockResolvedValue(null);
            prisma.billingPayment.findUnique.mockResolvedValue({
                id: 'pay-initial', tenantId: 't1', subscriptionId: 'sub-1', status: 'succeeded',
                providerPaymentId: 'txn-initial', amountCents: 100, currency: 'COP', metadata: {},
            });
            prisma.billingSubscription.findUnique.mockResolvedValue({
                id: 'sub-1', status: SubscriptionStatus.ACTIVE, cancellationReason: null,
                currentPeriodEnd: periodEnd,
            });
            prisma.tenant.findUnique.mockResolvedValue({ isInternal: false });

            await service.settleRefunded('a-initial', {
                providerChargeId: 'txn-initial', reference: 'r-initial', amountCents: 100, currency: 'COP',
            });

            expect(prisma.billingChargeAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ purpose: { in: ['initial', 'renewal'] } }),
            }));
            expect(prisma.billingSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
            }));
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

            const patch = prisma.billingChargeAttempt.updateMany.mock.calls[0][0].data;
            expect(patch.status).toBe('in_flight');
            expect(patch.failureClass).toBe('indeterminate');
            expect(patch.status).not.toBe('failed');
            expect(emitter.emit).toHaveBeenCalledWith(
                'billing.charge.indeterminate',
                expect.objectContaining({ reference: 'sub_x_20260410_1' }),
            );
        });

        it('does not overwrite an approval that won the row lock', async () => {
            const { service, prisma, emitter } = makeService();
            prisma.billingChargeAttempt.findUnique.mockResolvedValue({
                id: 'a1', status: 'succeeded', tenantId: 't1', subscriptionId: 'sub-1', reference: 'r',
            });

            await service.markIndeterminate('a1', 'late_worker_timeout');

            expect(prisma.billingChargeAttempt.updateMany).not.toHaveBeenCalled();
            expect(emitter.emit).not.toHaveBeenCalledWith('billing.charge.indeterminate', expect.anything());
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
