const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.parallly-chat.cloud/api/v1';

export interface ApiPlan {
    id: string;
    slug: string;
    name: string;
    priceUsdCents: number;
    trialDays: number;
    requiresCardForTrial: boolean;
    maxAgents: number;
    maxAiMessages: number;
    features: Record<string, any>;
    displayPriceCents: number;
    displayCurrency: string;
    priceSource: 'override' | 'fx' | 'usd';
    /** Total yearly charge in displayCurrency (override-only). Null when the plan has no annual price. */
    displayPriceAnnualCents?: number | null;
    mpPlanIdAnnual?: string | null;
    /** % discount of the annual total vs paying the monthly price 12×. */
    annualDiscountPct?: number | null;
}

export async function fetchPlans(country = 'CO'): Promise<ApiPlan[] | null> {
    try {
        const res = await fetch(`${API_URL}/billing/public/plans?country=${country}`, {
            next: { revalidate: 300 },
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json.success ? json.data : null;
    } catch {
        return null;
    }
}

export function formatCopPrice(cents: number): string {
    const pesos = Math.round(cents / 100);
    return '$' + pesos.toLocaleString('es-CO');
}
