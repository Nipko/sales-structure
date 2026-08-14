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
import { ProrationService } from './recurring/proration.service';
import { RENEWAL_QUEUE } from './recurring/renewal-scheduler.service';
import { getQueueToken } from '@nestjs/bullmq';
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
    let module: TestingModule;

    beforeEach(async () => {
        prismaMock = {
            tenant: { findUnique: jest.fn(), update: jest.fn() },
            billingPlan: { findUnique: jest.fn() },
            billingSubscription: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
            billingEvent: { findUnique: jest.fn(), create: jest.fn() },
            billingPaymentSource: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
            billingChargeAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
            billingPayment: { create: jest.fn() },
            auditLog: { create: jest.fn() },
            // $transaction receives a callback and invokes it with a tx object.
            // For unit tests we pass the same prismaMock so calls inside the
            // transaction hit the same mocks.
            $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
        };
        redisMock = { del: jest.fn() };

        module = await Test.createTestingModule({
            providers: [
                BillingService,
                PaymentProviderFactory,
                MockPaymentProvider,
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
                        claimAttempt: jest.fn(),
                    },
                },
                {
                    provide: ProrationService,
                    useValue: {
                        computeUpgrade: jest.fn(),
                        recordCredit: jest.fn(),
                    },
                },
                {
                    provide: getQueueToken(RENEWAL_QUEUE),
                    useValue: { add: jest.fn() },
                },
                {
                    // Routing resolves to 'mock' — the lab provider with every
                    // capability — so the tests exercise real branches without
                    // depending on the retired MercadoPago rail.
                    provide: PaymentRoutingService,
                    useValue: {
                        resolveForNewSubscription: jest.fn().mockResolvedValue({
                            provider: 'mock',
                            level: 'country',
                            substituted: false,
                        }),
                        resolveForSubscription: (p: string) => p,
                        getConfig: jest.fn().mockResolvedValue({
                            providersEnabled: { mercadopago: false, stripe: false, wompi: true, mock: true },
                            defaultByCountry: { CO: 'wompi', '*': 'wompi' },
                            wompiMethods: { card: true, nequi: false, bancolombiaTransfer: false },
                        }),
                    },
                },
            ],
        })
            // Override the factory to always return the mock provider so no
            // real adapter graph is needed. Capabilities stay REAL per provider
            // name so the service takes the same branch it would in production.
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

        it.each([undefined, 'short-lived-card-token'])('rejects card-backed local trials when the provider cannot retain the method (token %s)', async (cardTokenId) => {
            // La regla es por CAPACIDAD: un trial con tarjeta promete cobro
            // automatico al vencer, y sin instrumentos guardados la promesa es
            // falsa. Se simula un proveedor sin retencion parcheando las
            // capabilities del factory.
            prismaMock.tenant.findUnique.mockResolvedValueOnce({ id: 't1', name: 'T1' });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_pro', slug: 'pro', requiresCardForTrial: true,
                trialDays: 15, isActive: true, mpPlanId: 'mp_plan_pro', features: {},
            });
            const factory = module.get<PaymentProviderFactory>(PaymentProviderFactory) as any;
            const originalCaps = factory.capabilitiesOf;
            factory.capabilitiesOf = (n: string) => ({ ...originalCaps(n), storedPaymentSources: false });
            try {
                await expectErrorCode(
                    () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'pro', cardTokenId }),
                    'card_trial_not_supported',
                );
            } finally {
                factory.capabilitiesOf = originalCaps;
            }
        });

        it('never silently discards a payment token during a local trial plan change', async () => {
            // A token during a local trial means "start charging me". It must
            // never be dropped: either the conversion goes through, or the call
            // fails loudly. La conversion por token era el flujo de MercadoPago
            // (cancel+recreate) y MercadoPago esta retirado: una fila legada
            // que llegue aca falla con nombre, sin tragarse el token.
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
                response: expect.objectContaining({ error: 'provider_retired' }),
            });
            expect(createSpy).not.toHaveBeenCalled();
            expect(prismaMock.billingSubscription.update).not.toHaveBeenCalled();
        });

        it('rejects the retired token-based conversion of a legacy MP trial with a clear name', async () => {
            // "Keep my plan, start charging me" via token era el flujo de
            // MercadoPago. Bajo Wompi la conversion vive en addPaymentSource →
            // armEngineForNewSource (probado en payment-source-engine-arming):
            // guardar la tarjeta arma el motor y el cobro cae al vencer. Una
            // fila legada MP que intente el camino viejo falla con nombre —
            // el backfill de la migracion la re-apunta a Wompi.
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

            await expect(service.upgradeSubscription('tenant-1', 'starter', 'card-token'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ error: 'provider_retired' }),
                });
            expect(createSpy).not.toHaveBeenCalled();
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
            // Stripe: proveedor con catalogo remoto. El anual exige un id de
            // plan verificado del lado del proveedor incluso durante el trial.
            const routing = module.get<PaymentRoutingService>(PaymentRoutingService) as any;
            routing.resolveForNewSubscription.mockResolvedValueOnce({
                provider: 'stripe', level: 'country', substituted: false,
            });

            await expectErrorCode(
                () => service.createTrialSubscription({
                    tenantId: 't1', planSlug: 'starter', billingCycle: 'annual',
                }),
                'provider_plan_not_configured',
            );
        });

        it('fails closed if anything still resolves the retired provider for an acquisition', async () => {
            // Inalcanzable via ruteo (mercadopago no es ruteable); la guarda
            // ataja un uso directo con el nombre legado.
            prismaMock.tenant.findUnique.mockResolvedValueOnce({
                id: 't1', name: 'T1', paymentProvider: 'mercadopago', billingCountry: 'CO',
            });
            prismaMock.billingSubscription.findUnique.mockResolvedValueOnce(null);
            prismaMock.billingPlan.findUnique.mockResolvedValueOnce({
                id: 'plan_starter', slug: 'starter', requiresCardForTrial: false,
                trialDays: 7, isActive: true, features: {},
            });
            const routing = module.get<PaymentRoutingService>(PaymentRoutingService) as any;
            routing.resolveForNewSubscription.mockResolvedValueOnce({
                provider: 'mercadopago', level: 'country', substituted: false,
            });

            await expectErrorCode(
                () => service.createTrialSubscription({ tenantId: 't1', planSlug: 'starter' }),
                'provider_retired',
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

        const dueDowngrade = (providerSubscriptionId: string | null = 'mock-sub-1') => ({
            id: 'sub-downgrade',
            tenantId: 'tenant-1',
            planId: 'plan-pro',
            pendingPlanId: 'plan-starter',
            pendingPlanChangeAt: new Date(Date.now() - 60_000),
            // 'mock': proveedor con suscripciones nativas y catalogo remoto.
            // La maquinaria de downgrade programado es generica; el que la
            // estrenaba (MercadoPago) esta retirado.
            provider: 'mock',
            providerSubscriptionId,
            metadata: { billingCycle: 'monthly' },
        });

        it('does not schedule a provider-backed downgrade when the target has no provider plan', async () => {
            // Proveedor con catalogo remoto (Stripe) y un plan destino sin id
            // registrado del otro lado: programar el downgrade seria prometer
            // un cambio que el proveedor no puede ejecutar.
            const sub = { ...dueDowngrade('stripe-sub-1'), provider: 'stripe' };
            prismaMock.billingSubscription.findUnique.mockResolvedValue(sub);
            prismaMock.billingPlan.findUnique.mockImplementation(({ where }: any) => {
                if (where.slug === 'starter') {
                    return Promise.resolve({
                        ...synchronizedTargetPlan,
                        stripePlanId: null,
                    });
                }
                if (where.id === 'plan-pro') return Promise.resolve({ id: 'plan-pro', priceUsdCents: 12_900 });
                return Promise.resolve(null);
            });
            prismaMock.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', billingCountry: 'CO' });

            await expect(service.upgradeSubscription('tenant-1', 'starter')).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'provider_plan_not_configured' }),
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
            expect(providerChange).toHaveBeenCalledWith('mock-sub-1', 'mock-plan');
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
            expect(providerChange).toHaveBeenCalledWith('mock-sub-1', 'mock-plan');
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

    describe('retired provider plan resolution', () => {
        it('rejects any plan resolution against the retired provider with a clear name', () => {
            // Aca vivia la validacion de fingerprints de MercadoPago (id +
            // monto + moneda verificados por el servidor). La rama se retiro
            // completa con el proveedor: cualquier resolucion contra el nombre
            // legado falla con provider_retired, sin importar el estado del
            // plan. La higiene de fingerprints del catalogo remoto vigente
            // sigue cubierta por billing-plan-price-sync.util.spec.
            const resolve = (plan: any, country: string, cycle: 'monthly' | 'annual' = 'monthly') =>
                (service as any).resolveProviderPlanId(plan, 'mercadopago', country, cycle);

            for (const cycle of ['monthly', 'annual'] as const) {
                try {
                    resolve({ mpPlanId: 'legacy-id', stripePlanId: null, priceLocalOverrides: {
                        CO: { currency: 'COP', amountCents: 100, mpPlanId: 'x', syncedAmountCents: 100, syncedCurrency: 'COP' },
                    } }, 'CO', cycle);
                    throw new Error('expected provider_retired');
                } catch (error: any) {
                    expect(error.getResponse?.()?.error ?? error.response?.error).toBe('provider_retired');
                }
            }
        });
    });

    describe('cancelar bajo un operador sin suscripciones nativas', () => {
        const wompiSub = {
            id: 'sub-w', tenantId: 'tenant-w', provider: 'wompi',
            // Wompi NUNCA tiene este id: no existe el objeto suscripción.
            providerSubscriptionId: null,
            status: 'active', engine: 'internal',
        };

        it('deja cancelar aunque no exista una suscripción del proveedor', async () => {
            // Antes: 400 `missing_provider_subscription` contra un operador que
            // jamás va a tener ese id — el cliente no podía darse de baja.
            prismaMock.billingSubscription.findUnique.mockResolvedValue(wompiSub);
            prismaMock.billingSubscription.update.mockResolvedValue({ ...wompiSub, cancelAtPeriodEnd: true });
            prismaMock.tenant.update.mockResolvedValue({});

            await expect(service.cancelSubscription('tenant-w')).resolves.toBeUndefined();

            // Frenar el cobro ES la cancelación: el barrido excluye
            // `cancelAtPeriodEnd`, así que nadie vuelve a agendar.
            expect(prismaMock.billingSubscription.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ cancelAtPeriodEnd: true }),
                }),
            );
        });

        it('cancela de inmediato cuando se pide', async () => {
            prismaMock.billingSubscription.findUnique.mockResolvedValue(wompiSub);
            prismaMock.billingSubscription.update.mockResolvedValue({});
            prismaMock.tenant.update.mockResolvedValue({});

            await service.cancelSubscription('tenant-w', { immediate: true });

            expect(prismaMock.billingSubscription.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: 'cancelled',
                        cancelAtPeriodEnd: false,
                    }),
                }),
            );
        });

        it('dice que no sabe pausar, en vez de pedir un id que no existe', async () => {
            prismaMock.billingSubscription.findUnique.mockResolvedValue(wompiSub);

            await expect(service.pauseSubscription('tenant-w')).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'pause_unsupported' }),
            });
        });
    });

    describe('subir de plan estando en un trial local', () => {
        const trialEndsAt = new Date(Date.now() + 8 * 86_400_000);
        const trialSub = {
            id: 'sub-t', tenantId: 'tenant-t', planId: 'plan-starter',
            provider: 'wompi', providerSubscriptionId: null,
            status: 'trialing', engine: 'provider',
            trialEndsAt, metadata: { billingCycle: 'monthly' },
            billingTimezone: null, billingAnchorDay: null,
        };
        const proPlan = {
            id: 'plan-pro', slug: 'pro', isActive: true,
            priceUsdCents: 9_900, trialDays: 15, requiresCardForTrial: true,
            features: {}, priceLocalOverrides: { CO: { currency: 'COP', amountCents: 75_770_000 } },
        };

        beforeEach(() => {
            prismaMock.billingSubscription.findUnique.mockResolvedValue(trialSub);
            prismaMock.billingPlan.findUnique.mockImplementation(async ({ where }: any) =>
                where.slug === 'pro' ? proPlan : { id: 'plan-starter', slug: 'starter', priceUsdCents: 4_900, features: {} });
            prismaMock.tenant.findUnique.mockResolvedValue({ id: 'tenant-t', billingCountry: 'CO' });
            prismaMock.billingSubscription.update.mockResolvedValue({});
            prismaMock.tenant.update.mockResolvedValue({});
        });

        it('lo rechaza si no hay con qué cobrar cuando el trial venza', async () => {
            prismaMock.billingPaymentSource.findFirst.mockResolvedValue(null);

            await expect(service.upgradeSubscription('tenant-t', 'pro')).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'local_trial_plan_change_not_supported' }),
            });
        });

        it('con una tarjeta guardada sube el plan y difiere el cobro al fin del trial', async () => {
            // El bloqueo venía de que la única pasarela no sabía retener un medio
            // de pago. Con instrumentos guardados la promesa se sostiene, y sin
            // esto el cliente queda en trial sin forma de subir de plan.
            prismaMock.billingPaymentSource.findFirst.mockResolvedValue({
                id: 'src-1', supportsUnattended: true, status: 'available',
            });

            await service.upgradeSubscription('tenant-t', 'pro');

            const data = prismaMock.billingSubscription.update.mock.calls[0][0].data;
            expect(data.planId).toBe('plan-pro');
            expect(data.engine).toBe('internal');
            // El precio se congela con el del plan NUEVO: sin esto el tenant
            // estrena el plan superior y al vencer se le cobra el viejo.
            expect(data.chargeAmountCents).toBe(75_770_000);
            expect(data.chargeCurrency).toBe('COP');
            expect(data.defaultPaymentSourceId).toBe('src-1');
            // No se le quitan los días prometidos.
            expect(data.nextChargeAt).toEqual(trialEndsAt);
        });
    });
});
