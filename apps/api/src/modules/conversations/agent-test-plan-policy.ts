import type { ModelTier } from '@parallext/shared';

/** Mirrors the production plan-to-model routing contract. */
export function allowedModelTiersForPlan(planTier: unknown): ModelTier[] {
    switch (planTier) {
        case 'tier_1':
            return ['tier_1_premium', 'tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];
        case 'tier_2':
            return ['tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];
        case 'tier_4':
            return ['tier_4_budget'];
        case 'tier_3':
        default:
            return ['tier_3_efficient', 'tier_4_budget'];
    }
}

/** Mirrors production's cost circuit breaker once the monthly budget is spent. */
export function clampModelTiersToBudget(
    allowedTiers: readonly ModelTier[],
    spentUsdCents: number,
    budgetUsdCents: number,
): ModelTier[] {
    if (!(budgetUsdCents > 0) || spentUsdCents < budgetUsdCents) {
        return [...allowedTiers];
    }
    const clamped = allowedTiers.filter(
        tier => tier === 'tier_3_efficient' || tier === 'tier_4_budget',
    );
    return clamped.length ? clamped : ['tier_4_budget'];
}
