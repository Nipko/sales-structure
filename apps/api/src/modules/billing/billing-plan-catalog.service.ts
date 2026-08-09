import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAnnualPlanDisplay } from './billing-plan-display.util';
import { MercadoPagoConfigService } from './adapters/mercadopago-config.service';
import {
    BILLING_CURRENCY_BY_COUNTRY,
    isBillingCountry,
    isMercadoPagoCountry,
    normalizeBillingCountry as normalizeCountry,
} from './billing-country-config';

type JsonRecord = Record<string, any>;

const PUBLIC_FEATURE_KEYS = [
    'channels', 'customPrompt', 'customTemplates', 'aiInsights', 'recall', 'llmTier',
    'maxContacts', 'pipelineStages', 'automationRules', 'broadcastCampaigns', 'segments',
    'customAttributes', 'externalCrm', 'outboundWebhooks', 'maxCalendars',
    'appointmentsServices', 'scheduledReports', 'biApi', 'widget', 'ecommerce',
    'staffScheduling', 'vehicleInventory', 'channelManager', 'seats', 'mediaStorageMb',
    'dataRetentionDays', 'knowledgeArticles', 'emailTemplates', 'sso', 'auditLog',
    'customDomainKb', 'prioritySupport', 'whiteLabel', 'salesLed',
] as const;

export type PlanCheckoutMode = 'self_serve' | 'contact_sales' | 'temporarily_unavailable';

export function normalizeBillingCountry(country?: string): string | null {
    return normalizeCountry(country);
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function providerId(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function findCountryOverride(overrides: unknown, country: string): JsonRecord | null {
    if (!isRecord(overrides)) return null;
    if (isRecord(overrides[country])) return overrides[country];
    const alias = Object.entries(overrides).find(([key, value]) =>
        normalizeCountry(key) === country && isRecord(value));
    return alias && isRecord(alias[1]) ? alias[1] : null;
}

function publicFeatures(value: unknown): JsonRecord {
    if (!isRecord(value)) return {};
    const projected: JsonRecord = {};
    for (const key of PUBLIC_FEATURE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(value, key)) projected[key] = value[key];
    }
    if (isRecord(value.mediaProcessing)) {
        projected.mediaProcessing = Object.fromEntries(
            ['audioPerMonth', 'imagePerMonth', 'maxAudioDurationSec']
                .filter((key) => Object.prototype.hasOwnProperty.call(value.mediaProcessing, key))
                .map((key) => [key, value.mediaProcessing[key]]),
        );
    }
    return projected;
}

/**
 * Single read model for every customer-facing plan catalog.
 *
 * Provider identifiers remain private. Callers get explicit availability and
 * checkout mode flags instead, so a configured display price is never mistaken
 * for a synchronized, chargeable provider plan.
 */
@Injectable()
export class BillingPlanCatalogService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly mpConfig: MercadoPagoConfigService,
    ) {}

    async listActivePlans(country?: string) {
        const requestedCountry = normalizeBillingCountry(country);
        // Billing already defaults subscription creation to Colombia. Returning
        // the same deterministic country keeps direct dashboard visits usable.
        const effectiveCountry = requestedCountry || 'CO';
        const billingCountrySupported = isBillingCountry(effectiveCountry);
        const providerConfigured = this.mpConfig.isConfigured();
        const plans = await this.prisma.billingPlan.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                slug: true,
                name: true,
                priceUsdCents: true,
                trialDays: true,
                requiresCardForTrial: true,
                maxAgents: true,
                maxAiMessages: true,
                features: true,
                priceLocalOverrides: true,
            },
        });

        const localPrice = billingCountrySupported
            ? await this.resolveLocalPrice(effectiveCountry)
            : null;

        return plans.map((plan: typeof plans[number]) => {
            // Keep provider metadata private even if a test double or a future
            // Prisma select accidentally returns more columns than requested.
            const {
                priceLocalOverrides,
                mpPlanId: _mpPlanId,
                mpPlanIdAnnual: _mpPlanIdAnnual,
                stripePlanId: _stripePlanId,
                ...catalogPlan
            } = plan as typeof plan & {
                mpPlanId?: unknown;
                mpPlanIdAnnual?: unknown;
                stripePlanId?: unknown;
            };
            const countryOverride = findCountryOverride(priceLocalOverrides, effectiveCountry);
            const expectedCurrency = billingCountrySupported
                ? BILLING_CURRENCY_BY_COUNTRY[effectiveCountry]
                : null;

            let displayCurrency = 'USD';
            let displayPriceCents = plan.priceUsdCents;
            let priceSource: 'override' | 'fx' | 'usd' = 'usd';

            if (
                Number.isSafeInteger(countryOverride?.amountCents)
                && Number(countryOverride?.amountCents) >= 0
                && expectedCurrency !== null
                && String(countryOverride?.currency || '').trim().toUpperCase() === expectedCurrency
            ) {
                displayCurrency = expectedCurrency;
                displayPriceCents = Number(countryOverride!.amountCents);
                priceSource = 'override';
            } else if (localPrice) {
                displayCurrency = localPrice.currency;
                displayPriceCents = Math.round(plan.priceUsdCents * localPrice.rate);
                priceSource = 'fx';
            }

            const annualDisplay = resolveAnnualPlanDisplay(countryOverride, displayPriceCents);
            const annualCurrency = isRecord(countryOverride?.annual)
                ? String(countryOverride.annual.currency || '').trim().toUpperCase()
                : '';
            const annualCurrencyReady = expectedCurrency !== null
                && annualCurrency === expectedCurrency;
            const features: JsonRecord = isRecord(plan.features) ? plan.features : {};
            const salesLed = plan.slug === 'custom' || features.salesLed === true;
            const providerCountrySupported = isMercadoPagoCountry(effectiveCountry);
            const monthlyProviderId = providerId(countryOverride?.mpPlanId);
            // A provider plan is a fixed local-currency amount. An FX preview or
            // USD fallback is display-only and cannot prove that the frozen MP
            // amount matches, even when a legacy CO id happens to exist.
            const configuredMonthlyPrice = priceSource === 'override'
                && displayCurrency === expectedCurrency
                && Number.isSafeInteger(displayPriceCents)
                && displayPriceCents > 0;
            const monthlyFingerprintReady = Number.isSafeInteger(countryOverride?.syncedAmountCents)
                && Number(countryOverride?.syncedAmountCents) === displayPriceCents
                && String(countryOverride?.syncedCurrency || '').trim().toUpperCase() === displayCurrency;
            const annualFingerprintReady = isRecord(countryOverride?.annual)
                && Number.isSafeInteger(countryOverride.annual.syncedAmountCents)
                && Number(countryOverride.annual.syncedAmountCents) === annualDisplay.displayPriceAnnualCents
                && String(countryOverride.annual.syncedCurrency || '').trim().toUpperCase() === expectedCurrency;
            const monthlyAvailable = !salesLed
                && providerConfigured
                && providerCountrySupported
                && configuredMonthlyPrice
                && monthlyFingerprintReady
                && monthlyProviderId !== null;
            const annualAvailable = !salesLed
                && providerConfigured
                && providerCountrySupported
                && annualCurrencyReady
                && annualFingerprintReady
                && annualDisplay.displayPriceAnnualCents !== null
                && annualDisplay.mpPlanIdAnnual !== null;

            // Mercado Pago card tokens are short-lived and the current local
            // trial flow does not attach/persist them. Until a provider-backed
            // card trial is implemented, acquisition must not collect a card and
            // imply that automatic conversion is ready.
            const cardTrialNotSupported = plan.trialDays > 0 && plan.requiresCardForTrial;
            const requiresPaymentMethodAtSignup = !salesLed
                && (plan.trialDays === 0 || plan.requiresCardForTrial);
            const trialAvailable = !salesLed
                && plan.trialDays > 0
                && !plan.requiresCardForTrial;
            const signupAvailable = !salesLed
                && !cardTrialNotSupported
                && providerConfigured
                && (trialAvailable || monthlyAvailable || annualAvailable);

            let checkoutMode: PlanCheckoutMode;
            if (salesLed || !providerCountrySupported) {
                checkoutMode = 'contact_sales';
            } else if (monthlyAvailable || annualAvailable) {
                checkoutMode = 'self_serve';
            } else {
                checkoutMode = 'temporarily_unavailable';
            }

            const monthlyUnavailableReason = monthlyAvailable
                ? null
                : salesLed
                    ? 'sales_led'
                    : !providerCountrySupported
                        ? 'country_not_supported'
                        : !providerConfigured
                            ? 'provider_not_configured'
                        : !configuredMonthlyPrice
                            ? 'invalid_price'
                            : 'provider_plan_not_synced';
            const annualUnavailableReason = annualAvailable
                ? null
                : salesLed
                    ? 'sales_led'
                    : !providerCountrySupported
                        ? 'country_not_supported'
                        : !providerConfigured
                            ? 'provider_not_configured'
                        : 'annual_not_synchronized';

            return {
                ...catalogPlan,
                displayCountry: effectiveCountry,
                displayPriceCents,
                displayCurrency,
                priceSource,
                displayPriceAnnualCents: annualAvailable
                    ? annualDisplay.displayPriceAnnualCents
                    : null,
                annualDiscountPct: annualAvailable
                    ? annualDisplay.annualDiscountPct
                    : null,
                monthlyAvailable,
                annualAvailable,
                trialAvailable,
                requiresPaymentMethodAtSignup,
                providerConfigured,
                signupAvailable,
                signupUnavailableReason: signupAvailable
                    ? null
                    : salesLed
                        ? 'sales_led'
                        : cardTrialNotSupported
                            ? 'card_trial_not_supported'
                            : !providerConfigured
                                ? 'provider_not_configured'
                            : 'provider_plan_not_synchronized',
                checkoutMode,
                monthlyUnavailableReason,
                annualUnavailableReason,
            };
        });
    }

    async listPublicPlans(country?: string) {
        const plans = await this.listActivePlans(country);
        return plans.map(({ id: _id, features, ...plan }) => ({
            ...plan,
            features: publicFeatures(features),
        }));
    }

    private async resolveLocalPrice(country: keyof typeof BILLING_CURRENCY_BY_COUNTRY): Promise<{ currency: string; rate: number } | null> {
        const currency = BILLING_CURRENCY_BY_COUNTRY[country];
        if (currency === 'USD') return null;

        const fx = await this.prisma.exchangeRate.findFirst({
            where: { fromCurrency: 'USD', toCurrency: currency },
            orderBy: { rateDate: 'desc' },
        });
        if (!fx) return null;
        return { currency, rate: Number(fx.rate) };
    }
}
