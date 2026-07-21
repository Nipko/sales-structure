import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('billing/public')
export class BillingPublicController {
    constructor(private readonly prisma: PrismaService) {}

    @Get('plans')
    async listPlans(@Query('country') country?: string) {
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

        const localPrice = country ? await this.resolveLocalPrice(country) : null;

        const enriched = plans.map((p: typeof plans[number]) => {
            const overrides = (p.priceLocalOverrides ?? {}) as Record<string, any>;
            const countryOverride = country ? overrides[country] : null;

            let displayCurrency: string = 'USD';
            let displayPriceCents: number = p.priceUsdCents;
            let priceSource: 'override' | 'fx' | 'usd' = 'usd';

            if (countryOverride?.amountCents && countryOverride?.currency) {
                displayCurrency = countryOverride.currency;
                displayPriceCents = countryOverride.amountCents;
                priceSource = 'override';
            } else if (localPrice) {
                displayCurrency = localPrice.currency;
                displayPriceCents = Math.round(p.priceUsdCents * localPrice.rate);
                priceSource = 'fx';
            }

            // Annual cycle (override-only): total yearly charge + its MP plan id +
            // the % discount vs paying the monthly price 12×.
            const annual = countryOverride?.annual;
            const displayPriceAnnualCents: number | null = annual?.amountCents ?? null;
            const mpPlanIdAnnual: string | null = annual?.mpPlanId ?? null;
            const annualDiscountPct: number | null =
                displayPriceAnnualCents && displayPriceCents > 0
                    ? Math.round((1 - displayPriceAnnualCents / (displayPriceCents * 12)) * 100)
                    : null;

            return {
                ...p,
                displayPriceCents,
                displayCurrency,
                priceSource,
                displayPriceAnnualCents,
                mpPlanIdAnnual,
                annualDiscountPct,
            };
        });

        return { success: true, data: enriched };
    }

    private async resolveLocalPrice(country: string): Promise<{ currency: string; rate: number } | null> {
        const COUNTRY_CURRENCY: Record<string, string> = {
            CO: 'COP', AR: 'ARS', MX: 'MXN', CL: 'CLP', PE: 'PEN', UY: 'UYU',
            BR: 'BRL', US: 'USD', CA: 'USD', PY: 'PYG', BO: 'BOB', EC: 'USD',
            VE: 'USD', CR: 'CRC', PA: 'USD', DO: 'DOP', GT: 'GTQ',
        };
        const currency = COUNTRY_CURRENCY[country.toUpperCase()];
        if (!currency || currency === 'USD') return null;

        const fx = await this.prisma.exchangeRate.findFirst({
            where: { fromCurrency: 'USD', toCurrency: currency },
            orderBy: { rateDate: 'desc' },
        });
        if (!fx) return null;
        return { currency, rate: Number(fx.rate) };
    }
}
