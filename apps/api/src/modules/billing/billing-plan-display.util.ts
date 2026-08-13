type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether the annual cycle is purchasable, and at what price.
 *
 * Fail-closed by design: a price without the provider binding it needs (or vice
 * versa) is configuration-in-progress, not a purchasable billing cycle.
 *
 * What "the binding it needs" means depends on the provider:
 *  - providers with a remote plan catalog (MercadoPago) require a synced plan id
 *  - providers billed by our own engine (Wompi) have no remote id at all — the
 *    frozen local amount IS the contract
 *
 * `mpPlanIdAnnual` is kept in the payload for one deploy because the dashboard
 * still gates the monthly/annual toggle on it. New consumers must read
 * `annualAvailable`: gating on an MP-specific field would silently hide the
 * annual cycle — and its discount — for every other provider, with no error.
 */
export function resolveAnnualPlanDisplay(
    countryOverride: unknown,
    monthlyAmountCents: number,
    options?: { requiresProviderPlanId?: boolean },
) {
    const requiresProviderPlanId = options?.requiresProviderPlanId ?? true;
    const annual = isRecord(countryOverride) && isRecord(countryOverride.annual)
        ? countryOverride.annual
        : null;
    const amount = Number.isSafeInteger(annual?.amountCents) && Number(annual?.amountCents) > 0
        ? Number(annual?.amountCents)
        : null;
    const rawPlanId = typeof annual?.mpPlanId === 'string' ? annual.mpPlanId.trim() : '';
    const mpPlanIdAnnual = rawPlanId || null;
    const available = amount !== null && (!requiresProviderPlanId || mpPlanIdAnnual !== null);
    const displayPriceAnnualCents = available ? amount : null;
    const annualDiscountPct = available && monthlyAmountCents > 0 && amount !== null
        ? Math.round((1 - amount / (monthlyAmountCents * 12)) * 100)
        : null;

    return {
        displayPriceAnnualCents,
        /** @deprecated MercadoPago-specific. Read `annualAvailable` instead. */
        mpPlanIdAnnual,
        annualAvailable: available,
        annualDiscountPct,
    };
}
