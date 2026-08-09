import { BillingPlanCatalogService, normalizeBillingCountry } from './billing-plan-catalog.service';

describe('BillingPlanCatalogService', () => {
    const basePlan = {
        id: 'plan-id',
        slug: 'starter',
        name: 'Starter',
        priceUsdCents: 4_900,
        trialDays: 7,
        requiresCardForTrial: false,
        maxAgents: 1,
        maxAiMessages: 5_000,
        features: { channels: ['whatsapp'] },
        mpPlanId: null,
    };

    function serviceWith(plans: any[], fx: any = null, providerConfigured = true) {
        const prisma = {
            billingPlan: { findMany: jest.fn().mockResolvedValue(plans) },
            exchangeRate: { findFirst: jest.fn().mockResolvedValue(fx) },
        };
        return {
            service: new BillingPlanCatalogService(
                prisma as any,
                { isConfigured: () => providerConfigured } as any,
            ),
            prisma,
        };
    }

    it('normalizes country aliases and exposes a synchronized monthly checkout without provider ids', async () => {
        const { service, prisma } = serviceWith([{
            ...basePlan,
            priceLocalOverrides: {
                co: {
                    currency: 'COP',
                    amountCents: 27_690_000,
                    mpPlanId: 'private-month-id',
                    syncedAmountCents: 27_690_000,
                    syncedCurrency: 'COP',
                },
            },
        }]);

        const [plan] = await service.listActivePlans(' co ');

        expect(normalizeBillingCountry(' co ')).toBe('CO');
        expect(prisma.exchangeRate.findFirst).toHaveBeenCalledWith({
            where: { fromCurrency: 'USD', toCurrency: 'COP' },
            orderBy: { rateDate: 'desc' },
        });
        expect(plan).toMatchObject({
            displayCountry: 'CO',
            displayCurrency: 'COP',
            displayPriceCents: 27_690_000,
            priceSource: 'override',
            monthlyAvailable: true,
            checkoutMode: 'self_serve',
            requiresPaymentMethodAtSignup: false,
        });
        expect(plan).not.toHaveProperty('priceLocalOverrides');
        expect(plan).not.toHaveProperty('mpPlanId');
        expect(plan).not.toHaveProperty('mpPlanIdAnnual');
        expect(JSON.stringify(plan)).not.toContain('private-month-id');
    });

    it('requires both annual amount and provider id before declaring annual available', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            mpPlanId: 'legacy-co-month',
            priceLocalOverrides: {
                CO: {
                    currency: 'COP',
                    amountCents: 27_690_000,
                    mpPlanId: 'co-month-id',
                    syncedAmountCents: 27_690_000,
                    syncedCurrency: 'COP',
                    annual: { amountCents: 282_438_000 },
                },
            },
        }]);

        const [plan] = await service.listActivePlans('CO');

        expect(plan).toMatchObject({
            monthlyAvailable: true,
            annualAvailable: false,
            displayPriceAnnualCents: null,
            annualDiscountPct: null,
            annualUnavailableReason: 'annual_not_synchronized',
        });
        expect(plan).not.toHaveProperty('mpPlanIdAnnual');
    });

    it('publishes annual availability while keeping its provider id private', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            priceLocalOverrides: {
                MX: {
                    currency: 'MXN',
                    amountCents: 100_000,
                    mpPlanId: 'private-month-id',
                    syncedAmountCents: 100_000,
                    syncedCurrency: 'MXN',
                    annual: {
                        currency: 'MXN',
                        amountCents: 1_100_000,
                        mpPlanId: 'private-year-id',
                        syncedAmountCents: 1_100_000,
                        syncedCurrency: 'MXN',
                    },
                },
            },
        }]);

        const [plan] = await service.listActivePlans('mx');

        expect(plan).toMatchObject({
            monthlyAvailable: true,
            annualAvailable: true,
            checkoutMode: 'self_serve',
            displayPriceAnnualCents: 1_100_000,
        });
        expect(JSON.stringify(plan)).not.toContain('private-month-id');
        expect(JSON.stringify(plan)).not.toContain('private-year-id');
    });

    it('keeps configured prices visible but routes unsupported provider countries to sales', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            priceLocalOverrides: {
                US: { currency: 'USD', amountCents: 4_900, mpPlanId: 'not-usable-here' },
            },
        }]);

        const [plan] = await service.listActivePlans('US');

        expect(plan).toMatchObject({
            displayCountry: 'US',
            displayCurrency: 'USD',
            displayPriceCents: 4_900,
            monthlyAvailable: false,
            checkoutMode: 'contact_sales',
            monthlyUnavailableReason: 'country_not_supported',
        });
    });

    it('marks supported but unsynchronized countries temporarily unavailable', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            priceLocalOverrides: {
                AR: { currency: 'ARS', amountCents: 5_000 },
            },
        }]);

        const [plan] = await service.listActivePlans('AR');

        expect(plan).toMatchObject({
            displayPriceCents: 5_000,
            monthlyAvailable: false,
            checkoutMode: 'temporarily_unavailable',
            monthlyUnavailableReason: 'provider_plan_not_synced',
        });
    });

    it('keeps zero-value Custom prices visible and always sales-led', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            slug: 'custom',
            priceUsdCents: 0,
            features: { salesLed: true },
            priceLocalOverrides: {
                CO: { currency: 'COP', amountCents: 0, mpPlanId: 'should-never-be-public' },
            },
        }]);

        const [plan] = await service.listActivePlans('CO');

        expect(plan).toMatchObject({
            displayCurrency: 'COP',
            displayPriceCents: 0,
            monthlyAvailable: false,
            annualAvailable: false,
            checkoutMode: 'contact_sales',
            monthlyUnavailableReason: 'sales_led',
        });
        expect(JSON.stringify(plan)).not.toContain('should-never-be-public');
    });

    it('defaults a missing country to CO but never silently maps an invalid country to CO checkout', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            mpPlanId: 'legacy-co-month',
            priceLocalOverrides: {
                CO: {
                    currency: 'COP',
                    amountCents: 27_690_000,
                    mpPlanId: 'co-month-id',
                    syncedAmountCents: 27_690_000,
                    syncedCurrency: 'COP',
                },
            },
        }]);

        const [fallback] = await service.listActivePlans();
        const [invalid] = await service.listActivePlans('ZZ');

        expect(fallback).toMatchObject({ displayCountry: 'CO', monthlyAvailable: true });
        expect(invalid).toMatchObject({
            displayCountry: 'ZZ',
            monthlyAvailable: false,
            checkoutMode: 'contact_sales',
        });
    });

    it('fails closed for historical ids that have no server-owned price fingerprint', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            priceLocalOverrides: {
                CO: { currency: 'COP', amountCents: 27_690_000, mpPlanId: 'historical-id' },
            },
        }]);

        const [plan] = await service.listActivePlans('CO');

        expect(plan).toMatchObject({
            displayPriceCents: 27_690_000,
            monthlyAvailable: false,
            checkoutMode: 'temporarily_unavailable',
            monthlyUnavailableReason: 'provider_plan_not_synced',
            trialAvailable: true,
            signupAvailable: true,
        });
    });

    it('blocks card-backed trial acquisition until the provider can retain the payment method', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            requiresCardForTrial: true,
            priceLocalOverrides: {
                CO: {
                    currency: 'COP',
                    amountCents: 27_690_000,
                    mpPlanId: 'synced-id',
                    syncedAmountCents: 27_690_000,
                    syncedCurrency: 'COP',
                },
            },
        }]);

        const [plan] = await service.listActivePlans('CO');

        expect(plan).toMatchObject({
            monthlyAvailable: true,
            trialAvailable: false,
            requiresPaymentMethodAtSignup: true,
            signupAvailable: false,
            signupUnavailableReason: 'card_trial_not_supported',
        });
    });

    it('never advertises checkout when provider credentials are not configured', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            trialDays: 0,
            priceLocalOverrides: {
                CO: {
                    currency: 'COP',
                    amountCents: 27_690_000,
                    mpPlanId: 'verified-id',
                    syncedAmountCents: 27_690_000,
                    syncedCurrency: 'COP',
                },
            },
        }], null, false);

        const [plan] = await service.listActivePlans('CO');

        expect(plan).toMatchObject({
            monthlyAvailable: false,
            annualAvailable: false,
            signupAvailable: false,
            checkoutMode: 'temporarily_unavailable',
            monthlyUnavailableReason: 'provider_not_configured',
        });
    });

    it('projects the public catalog without UUIDs or internal budgets/rate limits', async () => {
        const { service } = serviceWith([{
            ...basePlan,
            features: {
                channels: ['whatsapp'],
                maxCalendars: 3,
                rateLimits: { outbound: 2_000 },
                llmBudgetCents: 999,
                mediaProcessing: {
                    audioPerMonth: 100,
                    imagePerMonth: 50,
                    dailyBudgetCentsUsd: 500,
                },
            },
            priceLocalOverrides: {},
        }]);

        const [plan] = await service.listPublicPlans('CO');

        expect(plan).not.toHaveProperty('id');
        expect(plan.features).toMatchObject({
            channels: ['whatsapp'],
            maxCalendars: 3,
            mediaProcessing: { audioPerMonth: 100, imagePerMonth: 50 },
        });
        expect(plan.features).not.toHaveProperty('rateLimits');
        expect(plan.features).not.toHaveProperty('llmBudgetCents');
        expect(plan.features.mediaProcessing).not.toHaveProperty('dailyBudgetCentsUsd');
    });
});
