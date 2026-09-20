import { isSupportedBillingCountry } from '../../common/utils/billing-country.util';
import { normalizeBillingCountry } from './billing-country-config';
import type { BillingCycle } from './types/provider-types';

type PricedPlan = { priceUsdCents: number; priceLocalOverrides?: unknown };

/** The USD contract shared by the international catalog and hosted Checkout. */
export function resolveStripePlanPrice(
    plan: PricedPlan,
    billingCountry: string | null | undefined,
    cycle: BillingCycle,
): { amountCents: number; currency: 'USD' } | null {
    const country = normalizeBillingCountry(billingCountry);
    if (!country || country === 'CO' || !isSupportedBillingCountry(country)) return null;
    let amount: unknown = plan.priceUsdCents;
    if (cycle === 'annual') {
        const overrides = plan.priceLocalOverrides as Record<string, any> | null;
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null;
        const entryFor = (key: string) => overrides[key] ?? Object.entries(overrides)
            .find(([name]) => normalizeBillingCountry(name) === key)?.[1];
        const local = entryFor(country);
        // A local-currency annual quote is never converted into an authorized USD charge.
        const entry = local && String(local.annual?.currency || local.currency).trim().toUpperCase() === 'USD'
            && local.annual ? local : entryFor('USD');
        if (!entry || String(entry.annual?.currency || entry.currency).trim().toUpperCase() !== 'USD') return null;
        amount = entry.annual?.amountCents;
    }
    // Existing billing money columns are Int32. Do not manufacture annual discounts.
    if (!Number.isSafeInteger(amount) || Number(amount) <= 0 || Number(amount) > 2147483647) return null;
    return { amountCents: Number(amount), currency: 'USD' };
}
