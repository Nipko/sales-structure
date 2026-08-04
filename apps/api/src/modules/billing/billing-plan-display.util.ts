type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Annual checkout is fail-closed: a price without a provider plan id (or vice
 * versa) is configuration-in-progress, not a purchasable billing cycle.
 */
export function resolveAnnualPlanDisplay(countryOverride: unknown, monthlyAmountCents: number) {
    const annual = isRecord(countryOverride) && isRecord(countryOverride.annual)
        ? countryOverride.annual
        : null;
    const amount = Number.isSafeInteger(annual?.amountCents) && Number(annual?.amountCents) > 0
        ? Number(annual?.amountCents)
        : null;
    const rawPlanId = typeof annual?.mpPlanId === 'string' ? annual.mpPlanId.trim() : '';
    const mpPlanIdAnnual = rawPlanId || null;
    const available = amount !== null && mpPlanIdAnnual !== null;
    const displayPriceAnnualCents = available ? amount : null;
    const annualDiscountPct = available && monthlyAmountCents > 0
        ? Math.round((1 - amount / (monthlyAmountCents * 12)) * 100)
        : null;

    return {
        displayPriceAnnualCents,
        mpPlanIdAnnual,
        annualDiscountPct,
    };
}
