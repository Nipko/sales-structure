import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { BillingEventType } from './types/billing-event.enum';
import { SubscriptionStatus } from './types/subscription-status.enum';
import { NormalizedBillingEvent } from './types/provider-types';
import { FiscalConfigService } from '../fiscal/fiscal-config.service';
import { SmsCreditsService } from '../sms-credits/sms-credits.service';

/**
 * Unit tests for BillingService.
 *
 * Scope: state-machine correctness, idempotency, and the happy-path wiring of
 * create/upgrade/cancel. Prisma is mocked (no DB) — these tests exercise the
 * logic, not the persistence. Integration tests against a real DB live in
 * test/billing.e2e.spec.ts (Sprint 2+).
 */
describe('BillingService', () => {
    let service: BillingService;
    let mockProvider: MockPaymentProvider;
    let prismaMock: any;
    let redisMock: any;
    let eventEmitter: EventEmitter2;

    beforeEach(async () => {
        prismaMock = {
            tenant: { findUnique: jest.fn(), update: jest.fn() },
            billingPlan: { findUnique: jest.fn() },
            billingSubscription: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
            billingEvent: { findUnique: jest.fn(), create: jest.fn() },
            billingPayment: { create: jest.fn() },
            // $transaction receives a callback and invokes it with a tx object.
            // For unit tests we pass the same prismaMock so calls inside the
            // transaction hit the same mocks.
            $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
        };
        redisMock = { del: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BillingService,
                PaymentProviderFactory,
                MockPaymentProvider,
                // MercadoPagoAdapter would be pulled in by the factory but we
                // stub it here so the test module doesn't need its @Injectable
                // graph resolved.
                { provide: 'MercadoPagoAdapter', useValue: {} },
                EventEmitter2,
                { provide: PrismaService, useValue: prismaMock },
                { provide: RedisService, useValue: redisMock },
                {
                    provide: FiscalConfigService,
                    useValue: { getConfig: jest.fn().mockResolvedValue({ fiscalGateEnabled: false }) },
                },
                {
                    provide: SmsCreditsService,
                    useValue: { addCredits: jest.fn(), adjust: jest.fn() },
                },
            ],
        })
            // Override the factory to always return the mock provider so we
            // don't need a real MercadoPagoAdapter instance in this test.
            .overrideProvider(PaymentProviderFactory)
            .useFactory({
                factory: (mp: MockPaymentProvider) => ({
                    getByName: (_n: string) => mp,
                }),
                inject: [MockPaymentProvider],
            })
            .compile();

        service = module.get<BillingService>(BillingService);
        mockProvider = module.get<MockPaymentProvider>(MockPaymentProvider);
        eventEmitter = module.get<EventEmitter2>(EventEmitter2);
        mockProvider.reset();
    });

    it('is defined', () => {
        expect(service).toBeDefined();
    });

    // -------------------------------------------------------------------------
    // State machine — deriveSubscriptionPatch (private, accessed via any-cast)
    // -------------------------------------------------------------------------

    describe('state machine (deriveSubscriptionPatch)', () => {
        const derive = (type: BillingEventType, currentStatus: SubscriptionStatus) => {
            const event: NormalizedBillingEvent = {
                type,
                provider: 'mock',
                providerEventId: 'evt_x',
                occurredAt: new Date(),
                rawPayload: {},
            };
            return (service as any).deriveSubscriptionPatch(event, currentStatus);
        };

        it('PAYMENT_SUCCEEDED transitions trialing → active', () => {
            const patch = derive(BillingEventType.PAYMENT_SUCCEEDED, SubscriptionStatus.TRIALING);
            expect(patch?.status).toBe(SubscriptionStatus.ACTIVE);
        });

        it('PAYMENT_FAILED transitions active → past_due', () => {
            const patch = derive(BillingEventType.PAYMENT_FAILED, SubscriptionStatus.ACTIVE);
            expect(patch?.status).toBe(SubscriptionStatus.PAST_DUE);
        });

        it('PAYMENT_FAILED does NOT downgrade cancelled back to past_due', () => {
            const patch = derive(BillingEventType.PAYMENT_FAILED, SubscriptionStatus.CANCELLED);
            expect(patch).toBeNull();
        });

        it('SUBSCRIPTION_CANCELLED marks cancelled with cancelledAt timestamp', () => {
            const patch = derive(BillingEventType.SUBSCRIPTION_CANCELLED, SubscriptionStatus.ACTIVE);
            expect(patch?.status).toBe(SubscriptionStatus.CANCELLED);
            expect(patch?.cancelledAt).toBeInstanceOf(Date);
        });

        it('TRIAL_ENDED on trialing moves to past_due for the grace period', () => {
            const patch = derive(BillingEventType.TRIAL_ENDED, SubscriptionStatus.TRIALING);
            expect(patch?.status).toBe(SubscriptionStatus.PAST_DUE);
        });
    });

    // -------------------------------------------------------------------------
    // Upgrade durante un mes regalado por cupón: NO debe cobrar en el acto
    // -------------------------------------------------------------------------

    describe('upgradeSubscription during a gifted trial', () => {
        it('unlocks the new plan features without touching the provider (no early charge)', async () => {
            const future = new Date(Date.now() + 20 * 86_400_000); // 20 días de regalo
            const sub = {
                id: 'sub-1',
                tenantId: 'tenant-1',
                planId: 'plan-emp',
                status: SubscriptionStatus.TRIALING,
                provider: 'mercadopago',
                providerSubscriptionId: null, // trial con cupón: sin preapproval
                providerCustomerId: null,
                currentPeriodStart: new Date(),
                currentPeriodEnd: future,
                trialEndsAt: future,
                metadata: {},
            };
            prismaMock.billingSubscription.findUnique.mockResolvedValue(sub);
            prismaMock.billingPlan.findUnique.mockImplementation(({ where }: any) => {
                if (where.slug === 'pro') return Promise.resolve({ id: 'plan-pro', slug: 'pro', isActive: true, priceUsdCents: 12900 });
                if (where.id === 'plan-emp') return Promise.resolve({ id: 'plan-emp', slug: 'emprendedor', priceUsdCents: 2100 });
                return Promise.resolve(null);
            });
            const createSpy = jest.spyOn(mockProvider, 'createSubscription');

            const result = await service.upgradeSubscription('tenant-1', 'pro', 'card-token-xyz');

            // El proveedor NUNCA se toca: no hay cobro adelantado.
            expect(createSpy).not.toHaveBeenCalled();
            // Las features del plan nuevo se desbloquean localmente.
            expect(result.planId).toBe('plan-pro');
            const subUpdate = prismaMock.billingSubscription.update.mock.calls[0][0];
            expect(subUpdate.data.planId).toBe('plan-pro');
            // El regalo se preserva: no se pisa trialEndsAt ni se setea un preapproval.
            expect(subUpdate.data.providerSubscriptionId).toBeUndefined();
            expect(subUpdate.data.trialEndsAt).toBeUndefined();
            expect(prismaMock.tenant.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ plan: 'pro' }) }),
            );
        });
    });

    // -------------------------------------------------------------------------
    // Idempotency — handleBillingEvent with duplicate providerEventId
    // -------------------------------------------------------------------------

    describe('handleBillingEvent idempotency', () => {
        const buildEvent = (): NormalizedBillingEvent => ({
            type: BillingEventType.PAYMENT_SUCCEEDED,
            provider: 'mock',
            providerEventId: 'evt_dup_123',
            occurredAt: new Date(),
            providerSubscriptionId: 'mock_sub_x',
            rawPayload: { some: 'data' },
        });

        it('processes event on first delivery', async () => {
            prismaMock.billingEvent.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingEvent.create.mockResolvedValueOnce({});

            const result = await service.handleBillingEvent(buildEvent());
            expect(result.processed).toBe(true);
            expect(prismaMock.billingEvent.create).toHaveBeenCalled();
        });

        it('skips event on redelivery (duplicate providerEventId)', async () => {
            prismaMock.billingEvent.findUnique.mockResolvedValueOnce({ id: 'existing' });

            const result = await service.handleBillingEvent(buildEvent());
            expect(result.processed).toBe(false);
            expect(result.reason).toBe('duplicate');
            expect(prismaMock.billingEvent.create).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // createTrialSubscription — input validation
    // -------------------------------------------------------------------------

    describe('createTrialSubscription', () => {
        // Helper: NestJS HttpException.toString() doesn't serialize the
        // payload, so assert on the response body instead.
        const expectErrorCode = async (fn: () => Promise<unknown>, code: string) => {
            try {
                await fn();
                throw new Error('Expected function to throw but it resolved');
            } catch (err: any) {
                expect(err.getResponse?.()?.error ?? err.response?.error).toBe(code);
            }
        };

        it('rejects when tenant already has a subscription', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1', name: 'T1' });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce({ id: 'existing_sub', status: 'active' });

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'starter' }),
                'subscription_already_exists',
            );
        });

        it('rejects when Pro is selected without a card token', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1', name: 'T1' });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_pro', slug: 'pro', requiresCardForTrial: true,
                trialDays: 15, isActive: true, mpPlanId: 'mp_plan_pro',
            });

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'pro' /* no cardTokenId */ }),
                'card_required_for_trial',
            );
        });

        it('rejects when plan slug does not exist', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1' });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce(null);

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'ghost_plan' }),
                'plan_not_found',
            );
        });

        it('rejects when tenant does not exist', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce(null);

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 'ghost', planSlug: 'starter' }),
                'tenant_not_found',
            );
        });
    });
});
