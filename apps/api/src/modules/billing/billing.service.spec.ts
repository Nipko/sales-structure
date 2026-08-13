import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { BillingEventType } from './types/billing-event.enum';
import { SubscriptionStatus } from './types/subscription-status.enum';
import { NormalizedBillingEvent, PaymentProviderName } from './types/provider-types';
import { PROVIDER_CAPABILITIES } from './adapters/provider-capabilities';
import { PaymentRoutingService } from './payment-routing.service';
import { WompiConfigService } from './adapters/wompi-config.service';
import { SubscriptionEngineService } from './recurring/subscription-engine.service';
import { FiscalConfigService } from '../fiscal/fiscal-config.service';
import { SmsCreditsService } from '../sms-credits/sms-credits.service';
import { MercadoPagoConfigService } from './adapters/mercadopago-config.service';

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
    let mpConfigMock: { isConfigured: jest.Mock };
    let eventEmitter: EventEmitter2;
    let module: TestingModule;

    beforeEach(async () => {
        prismaMock = {
            tenant: { findUnique: jest.fn(), update: jest.fn() },
            billingPlan: { findUnique: jest.fn() },
            billingSubscription: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
            billingEvent: { findUnique: jest.fn(), create: jest.fn() },
            billingPayment: { create: jest.fn() },
            auditLog: { create: jest.fn() },
            // $transaction receives a callback and invokes it with a tx object.
            // For unit tests we pass the same prismaMock so calls inside the
            // transaction hit the same mocks.
            $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
        };
        redisMock = { del: jest.fn() };
        mpConfigMock = { isConfigured: jest.fn().mockReturnValue(true) };

        module = await Test.createTestingModule({
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
                {
                    provide: MercadoPagoConfigService,
                    useValue: mpConfigMock,
                },
                {
                    provide: WompiConfigService,
                    useValue: { isConfigured: jest.fn().mockReturnValue(false) },
                },
                {
                    // These tests exercise the provider-native path, where no
                    // engine charge attempt exists.
                    provide: SubscriptionEngineService,
                    useValue: {
                        settleApproved: jest.fn(),
                        settleFailed: jest.fn(),
                        classifyFailure: jest.fn().mockReturnValue('soft'),
                    },
                },
                {
                    // Routing resolves to MercadoPago, matching the previous
                    // hardcoded default these tests were written against.
                    provide: PaymentRoutingService,
                    useValue: {
                        resolveForNewSubscription: jest.fn().mockResolvedValue({
                            provider: 'mercadopago',
                            level: 'country',
                            substituted: false,
                        }),
                        resolveForSubscription: (p: string) => p,
                        getConfig: jest.fn().mockResolvedValue({
                            providersEnabled: { mercadopago: true, stripe: false, wompi: false, mock: false },
                            defaultByCountry: { '*': 'mercadopago' },
                            wompiMethods: { card: true, nequi: false, bancolombiaTransfer: false },
                        }),
                    },
                },
            ],
        })
            // Override the factory to always return the mock provider so we
            // don't need a real MercadoPagoAdapter instance in this test.
            // Capabilities stay REAL per provider name so the service takes the
            // same branch it would in production.
            .overrideProvider(PaymentProviderFactory)
            .useFactory({
                factory: (mp: MockPaymentProvider) => ({
                    getByName: (_n: string) => mp,
                    capabilitiesOf: (n: string) =>
                        PROVIDER_CAPABILITIES[n as PaymentProviderName] ?? PROVIDER_CAPABILITIES.mock,
                    isRegistered: () => true,
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

    describe('engine charge convergence', () => {
        it('routes a webhook about an engine charge to the engine, not the generic patch', async () => {
            // The webhook and the engine's own polling race to report the same
            // outcome. Applying the generic subscription patch here as well
            // would count the payment twice — and issue a second DIAN invoice.
            const engine = module.get(SubscriptionEngineService) as any;
            prismaMock.billingEvent.findUnique.mockResolvedValue(null);
            prismaMock.billingChargeAttempt = {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'a1', tenantId: 't1', subscriptionId: 'sub-1',
                    reference: 'sub_x_20260410_1', providerTxnId: 'txn-1',
                    amountCents: 2_769_000, currency: 'COP',
                }),
            };
            prismaMock.billingEvent.create.mockResolvedValue({});

            const result = await service.handleBillingEvent({
                type: BillingEventType.PAYMENT_SUCCEEDED,
                provider: 'wompi',
                providerEventId: 'transaction.updated.txn-1.APPROVED',
                providerPaymentId: 'txn-1',
                occurredAt: new Date(),
                rawPayload: { data: { transaction: { reference: 'sub_x_20260410_1' } } },
            } as any);

            expect(engine.settleApproved).toHaveBeenCalledWith('a1', expect.objectContaining({
                providerChargeId: 'txn-1',
            }));
            expect(result).toEqual({ processed: true, reason: 'engine_settled' });
            // The generic path must not also touch the subscription.
            expect(prismaMock.billingSubscription.update).not.toHaveBeenCalled();
        });

        it('leaves provider-native events alone', async () => {
            const engine = module.get(SubscriptionEngineService) as any;
            prismaMock.billingEvent.findUnique.mockResolvedValue(null);
            prismaMock.billingChargeAttempt = { findFirst: jest.fn().mockResolvedValue(null) };
            prismaMock.billingSubscription.findUnique.mockResolvedValue(null);
            prismaMock.billingEvent.create.mockResolvedValue({});

            await service.handleBillingEvent({
                type: BillingEventType.PAYMENT_SUCCEEDED,
                provider: 'mercadopago',
                providerEventId: 'mp-1',
                providerPaymentId: 'mp-payment-1',
                occurredAt: new Date(),
                rawPayload: {},
            } as any);

            expect(engine.settleApproved).not.toHaveBeenCalled();
        });
    });

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

            const result = await service.upgradeSubscription('tenant-1', 'pro');

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

        it.each([undefined, 'short-lived-card-token'])('rejects card-backed local trials before discarding token %s', async (cardTokenId) => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1', name: 'T1' });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_pro', slug: 'pro', requiresCardForTrial: true,
                trialDays: 15, isActive: true, mpPlanId: 'mp_plan_pro', features: {},
            });

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'pro', cardTokenId }),
                'card_trial_not_supported',
            );
        });

        it('never silently discards a payment token during a local trial plan change', async () => {
            // A token during a local trial means "start charging me". It must
            // never be dropped: either the conversion goes through, or the call
            // fails loudly. Here the target plan is not synchronized with the
            // provider, so the conversion is refused instead of silently
            // downgrading to a local-only plan swap.
            const future = new Date(Date.now() + 20 * 86_400_000);
            prismaMock.billingSubscription.findUnique.mockResolvedValue({
                id: 'sub-1', tenantId: 'tenant-1', planId: 'plan-emp',
                status: SubscriptionStatus.TRIALING, provider: 'mercadopago',
                providerSubscriptionId: null, trialEndsAt: future, metadata: {},
            });
            prismaMock.billingPlan.findUnique.mockImplementation(({ where }: any) => {
                if (where.slug === 'pro') return Promise.resolve({
                    id: 'plan-pro', slug: 'pro', isActive: true, priceUsdCents: 12_900,
                    requiresCardForTrial: false, features: {}, priceLocalOverrides: {},
                });
                if (where.id === 'plan-emp') return Promise.resolve({ id: 'plan-emp', priceUsdCents: 2_100 });
                return Promise.resolve(null);
            });
            prismaMock.tenant.findUnique.mockResolvedValue({
                id: 'tenant-1', name: 'T1', billingCountry: 'CO', billingEmail: 'a@b.co', settings: {},
            });
            const createSpy = jest.spyOn(mockProvider, 'createSubscription');

            await expect(service.upgradeSubscription('tenant-1', 'pro', 'card-token')).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'provider_plan_not_synchronized' }),
            });
            expect(createSpy).not.toHaveBeenCalled();
            expect(prismaMock.billingSubscription.update).not.toHaveBeenCalled();
        });

        it('converts a local trial into a paid subscription on the SAME plan', async () => {
            // The most common conversion: "keep my plan, start charging me".
            // This used to be impossible — same plan was rejected as `same_plan`
            // and any other plan as `local_trial_plan_change_not_supported`, so a
            // trial could only lapse.
            const future = new Date(Date.now() + 3 * 86_400_000);
            prismaMock.billingSubscription.findUnique.mockResolvedValue({
                id: 'sub-1', tenantId: 'tenant-1', planId: 'plan-starter',
                status: SubscriptionStatus.TRIALING, provider: 'mercadopago',
                // A local trial never created a provider customer — the
                // conversion has to create one on the way in.
                providerSubscriptionId: null, providerCustomerId: null,
                trialEndsAt: future, metadata: { billingCycle: 'monthly' },
                currentPeriodStart: null, currentPeriodEnd: null,
            });
            const syncedPlan = {
                id: 'plan-starter', slug: 'starter', isActive: true, priceUsdCents: 4_900,
                requiresCardForTrial: false, features: {}, stripePlanId: null, mpPlanId: null,
                priceLocalOverrides: {
                    CO: {
                        currency: 'COP', amountCents: 27_690_000, mpPlanId: 'mp-starter-co',
                        syncedAmountCents: 27_690_000, syncedCurrency: 'COP',
                    },
                },
            };
            prismaMock.billingPlan.findUnique.mockImplementation(({ where }: any) =>
                Promise.resolve(where.slug === 'starter' || where.id === 'plan-starter' ? syncedPlan : null));
            prismaMock.tenant.findUnique.mockResolvedValue({
                id: 'tenant-1', name: 'T1', billingCountry: 'CO', billingEmail: 'owner@tenant.co',
                paymentProviderCustomerId: null, settings: {},
            });
            const createSpy = jest.spyOn(mockProvider, 'createSubscription');

            await service.upgradeSubscription('tenant-1', 'starter', 'card-token');

            expect(createSpy).toHaveBeenCalledTimes(1);
            expect(prismaMock.billingSubscription.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'sub-1' },
                    data: expect.objectContaining({ planId: 'plan-starter' }),
                }),
            );
        });

        it('still rejects the same plan when there is no payment method to convert with', async () => {
            prismaMock.billingSubscription.findUnique.mockResolvedValue({
                id: 'sub-1', tenantId: 'tenant-1', planId: 'plan-starter',
                status: SubscriptionStatus.TRIALING, provider: 'mercadopago',
                providerSubscriptionId: null, trialEndsAt: new Date(Date.now() + 86_400_000),
                metadata: {},
            });
            prismaMock.billingPlan.findUnique.mockResolvedValue({
                id: 'plan-starter', slug: 'starter', isActive: true, priceUsdCents: 4_900,
                requiresCardForTrial: false, features: {},
            });

            await expect(service.upgradeSubscription('tenant-1', 'starter')).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'same_plan' }),
            });
        });

        it('keeps requiring a card for a zero-day self-serve plan', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1', name: 'T1' });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_paid', slug: 'paid-now', requiresCardForTrial: false,
                trialDays: 0, isActive: true, features: {},
            });

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'paid-now' }),
                'card_required_for_trial',
            );
        });

        it('requires an annual provider fingerprint even for a local no-card trial', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({
                id: 't1', name: 'T1', paymentProvider: 'mercadopago', billingCountry: 'CO',
            });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_starter', slug: 'starter', requiresCardForTrial: false,
                trialDays: 7, isActive: true, features: {}, mpPlanId: 'legacy-id',
                stripePlanId: null, priceLocalOverrides: {},
            });

            await expectErrorCode(
                () => service.createTrialSubscription({
                    tenantId: 't1', planSlug: 'starter', billingCycle: 'annual',
                }),
                'provider_plan_not_synchronized',
            );
        });

        it('fails closed for a local no-card Mercado Pago trial when the provider is not configured', async () => {
            mpConfigMock.isConfigured.mockReturnValueOnce(false);
            prismaMock.tenant.findUnique.mockResolvedValueOnce({
                id: 't1', name: 'T1', paymentProvider: 'mercadopago', billingCountry: 'CO',
            });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_starter', slug: 'starter', requiresCardForTrial: false,
                trialDays: 7, isActive: true, features: {},
            });

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'starter' }),
                'provider_not_configured',
            );
            expect(prismaMock.billingSubscription.create).not.toHaveBeenCalled();
        });

        it('blocks sales-led plans from the self-serve trial endpoint', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1', name: 'T1' });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_custom', slug: 'custom', requiresCardForTrial: false,
                trialDays: 0, isActive: true, features: { salesLed: true },
            });

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'custom' }),
                'sales_led_plan_not_self_serve',
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

    describe('scheduled downgrade provider ordering', () => {
        const synchronizedTargetPlan = {
            id: 'plan-starter',
            slug: 'starter',
            isActive: true,
            priceUsdCents: 2_100,
            mpPlanId: null,
            stripePlanId: null,
            requiresCardForTrial: false,
            features: {},
            priceLocalOverrides: {
                CO: {
                    currency: 'COP',
                    amountCents: 8_900_000,
                    mpPlanId: 'mp-starter-co',
                    syncedAmountCents: 8_900_000,
                    syncedCurrency: 'COP',
                },
            },
        };

        const dueDowngrade = (providerSubscriptionId: string | null = 'mp-sub-1') => ({
            id: 'sub-downgrade',
            tenantId: 'tenant-1',
            planId: 'plan-pro',
            pendingPlanId: 'plan-starter',
            pendingPlanChangeAt: new Date(Date.now() - 60_000),
            provider: 'mercadopago',
            providerSubscriptionId,
            metadata: { billingCycle: 'monthly' },
        });

        it('does not schedule a provider-backed downgrade when the target fingerprint is stale', async () => {
            const sub = dueDowngrade();
            prismaMock.billingSubscription.findUnique.mockResolvedValue(sub);
            prismaMock.billingPlan.findUnique.mockImplementation(({ where }: any) => {
                if (where.slug === 'starter') {
                    return Promise.resolve({
                        ...synchronizedTargetPlan,
                        priceLocalOverrides: {
                            CO: {
                                currency: 'COP', amountCents: 8_900_000,
                                mpPlanId: 'stale-id', syncedAmountCents: 8_000_000,
                                syncedCurrency: 'COP',
                            },
                        },
                    });
                }
                if (where.id === 'plan-pro') return Promise.resolve({ id: 'plan-pro', priceUsdCents: 12_900 });
                return Promise.resolve(null);
            });
            prismaMock.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', billingCountry: 'CO' });

            await expect(service.upgradeSubscription('tenant-1', 'starter')).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'provider_plan_not_synchronized' }),
            });
            expect(prismaMock.billingSubscription.update).not.toHaveBeenCalled();
            expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
        });

        it('retains pending downgrade and entitlements when provider confirmation fails', async () => {
            const sub = dueDowngrade();
            prismaMock.billingSubscription.findMany.mockResolvedValue([sub]);
            prismaMock.billingPlan.findUnique.mockResolvedValue(synchronizedTargetPlan);
            prismaMock.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', billingCountry: 'CO' });
            const providerChange = jest.spyOn(mockProvider, 'changeSubscriptionPlan')
                .mockRejectedValueOnce(new Error('provider rejected plan change'));

            const result = await service.applyPendingPlanChanges();

            expect(result).toEqual({ applied: 0 });
            expect(providerChange).toHaveBeenCalledWith('mp-sub-1', 'mp-starter-co');
            expect(prismaMock.billingSubscription.update).not.toHaveBeenCalled();
            expect(prismaMock.tenant.update).not.toHaveBeenCalled();
            expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'subscription_downgrade_provider_sync_failed',
                    tenantId: 'tenant-1',
                }),
            });
        });

        it('confirms the provider before atomically applying local entitlements', async () => {
            const sub = dueDowngrade();
            prismaMock.billingSubscription.findMany.mockResolvedValue([sub]);
            prismaMock.billingPlan.findUnique.mockResolvedValue(synchronizedTargetPlan);
            prismaMock.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', billingCountry: 'CO' });
            const providerChange = jest.spyOn(mockProvider, 'changeSubscriptionPlan')
                .mockResolvedValueOnce({} as any);

            const result = await service.applyPendingPlanChanges();

            expect(result).toEqual({ applied: 1 });
            expect(providerChange).toHaveBeenCalledWith('mp-sub-1', 'mp-starter-co');
            expect(prismaMock.billingSubscription.update).toHaveBeenCalledWith({
                where: { id: 'sub-downgrade' },
                data: expect.objectContaining({
                    planId: 'plan-starter',
                    pendingPlanId: null,
                    pendingPlanChangeAt: null,
                }),
            });
            expect(providerChange.mock.invocationCallOrder[0]).toBeLessThan(
                prismaMock.billingSubscription.update.mock.invocationCallOrder[0],
            );
            expect(prismaMock.tenant.update).toHaveBeenCalledWith({
                where: { id: 'tenant-1' },
                data: { plan: 'starter' },
            });
        });

        it('applies a local pending downgrade without provider metadata or calls', async () => {
            const sub = dueDowngrade(null);
            prismaMock.billingSubscription.findMany.mockResolvedValue([sub]);
            prismaMock.billingPlan.findUnique.mockResolvedValue({
                ...synchronizedTargetPlan,
                priceLocalOverrides: {},
            });
            prismaMock.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', billingCountry: 'CO' });
            const providerChange = jest.spyOn(mockProvider, 'changeSubscriptionPlan');

            const result = await service.applyPendingPlanChanges();

            expect(result).toEqual({ applied: 1 });
            expect(providerChange).not.toHaveBeenCalled();
            expect(prismaMock.billingSubscription.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ pendingPlanId: null }),
                }),
            );
        });
    });

    describe('Mercado Pago provider-plan fingerprint', () => {
        const resolve = (plan: any, country: string, cycle: 'monthly' | 'annual' = 'monthly') =>
            (service as any).resolveProviderPlanId(plan, 'mercadopago', country, cycle);

        it('accepts only a country cycle whose id, amount and currency fingerprint match', () => {
            const plan = {
                mpPlanId: 'legacy-id',
                stripePlanId: null,
                priceLocalOverrides: {
                    co: {
                        currency: 'COP',
                        amountCents: 27_690_000,
                        mpPlanId: 'verified-id',
                        syncedAmountCents: 27_690_000,
                        syncedCurrency: 'cop',
                    },
                },
            };

            expect(resolve(plan, ' co ')).toBe('verified-id');
        });

        it('rejects an unknown billing country before persisting a local trial', async () => {
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1', billingCountry: null });

            await expect(service.createTrialSubscription({
                tenantId: 't1', planSlug: 'starter', billingCountry: 'zz',
            })).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'invalid_billing_country' }),
            });
            expect(prismaMock.billingSubscription.create).not.toHaveBeenCalled();
        });

        it.each([
            ['historical id without fingerprint', {
                CO: { currency: 'COP', amountCents: 100, mpPlanId: 'historical-id' },
            }, 'monthly'],
            ['legacy top-level id without country proof', {}, 'monthly'],
            ['annual fingerprint with stale amount', {
                CO: {
                    currency: 'COP', amountCents: 100,
                    annual: {
                        currency: 'COP', amountCents: 1_000, mpPlanId: 'annual-id',
                        syncedAmountCents: 900, syncedCurrency: 'COP',
                    },
                },
            }, 'annual'],
            ['country with unsupported Mercado Pago currency', {
                US: {
                    currency: 'USD', amountCents: 100, mpPlanId: 'us-id',
                    syncedAmountCents: 100, syncedCurrency: 'USD',
                },
            }, 'monthly'],
        ])('fails closed for %s', (_label, priceLocalOverrides, cycle) => {
            try {
                resolve({ mpPlanId: 'legacy-id', stripePlanId: null, priceLocalOverrides }, 'US' in priceLocalOverrides ? 'US' : 'CO', cycle as any);
                throw new Error('expected provider sync error');
            } catch (error: any) {
                expect(error.getResponse?.()?.error ?? error.response?.error).toBe('provider_plan_not_synchronized');
            }
        });
    });
});
