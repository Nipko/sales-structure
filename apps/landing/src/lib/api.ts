const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.parallly-chat.cloud/api/v1';

export const PRICING_COUNTRIES = [
    'CO', 'MX', 'AR', 'CL', 'PE', 'BR', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'DO', 'GT', 'US', 'CA',
] as const;
export type PricingCountry = typeof PRICING_COUNTRIES[number];

export interface ApiPlan {
    id?: string;
    slug: string;
    name: string;
    priceUsdCents: number;
    trialDays: number;
    requiresCardForTrial: boolean;
    requiresPaymentMethodAtSignup: boolean;
    providerConfigured: boolean;
    maxAgents: number;
    maxAiMessages: number;
    features: Record<string, unknown>;
    displayPriceCents: number;
    displayCurrency: string;
    priceSource: 'override' | 'fx' | 'usd';
    /** Total yearly charge in displayCurrency (override-only). Null when the plan has no annual price. */
    displayPriceAnnualCents?: number | null;
    /** % discount of the annual total vs paying the monthly price 12×. */
    annualDiscountPct?: number | null;
    displayCountry: string;
    monthlyAvailable: boolean;
    annualAvailable: boolean;
    trialAvailable: boolean;
    signupAvailable: boolean;
    signupUnavailableReason?: 'sales_led' | 'card_trial_not_supported' | 'provider_not_configured' | 'provider_plan_not_synchronized' | null;
    checkoutMode: 'self_serve' | 'contact_sales' | 'temporarily_unavailable';
    monthlyUnavailableReason?: 'sales_led' | 'country_not_supported' | 'provider_not_configured' | 'invalid_price' | 'provider_plan_not_synced' | null;
    annualUnavailableReason?: 'sales_led' | 'country_not_supported' | 'provider_not_configured' | 'annual_not_synchronized' | null;
}

export function detectPricingCountry(): PricingCountry {
    if (typeof navigator === 'undefined') return 'CO';

    try {
        for (const language of [navigator.language, ...(navigator.languages || [])]) {
            const region = new Intl.Locale(language).region?.toUpperCase();
            if (region && PRICING_COUNTRIES.includes(region as PricingCountry)) {
                return region as PricingCountry;
            }
        }
    } catch {
        // A malformed browser locale should not prevent the catalog from loading.
    }

    return 'CO';
}

export function pricingCountryName(country: PricingCountry, locale: string): string {
    try {
        return new Intl.DisplayNames([locale], { type: 'region' }).of(country) || country;
    } catch {
        return country;
    }
}

const CHANNEL_NAMES: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    messenger: 'Messenger',
    telegram: 'Telegram',
    sms: 'SMS',
    email: 'Email',
    web_widget: 'Web Widget',
};

export function formatChannelNames(channels: string[]): string {
    return channels
        .map((channel) => CHANNEL_NAMES[channel.toLowerCase()] ?? channel)
        .join(', ');
}

export async function fetchPlans(country: PricingCountry, signal?: AbortSignal): Promise<ApiPlan[] | null> {
    try {
        const normalizedCountry = country.trim().toUpperCase();
        const res = await fetch(`${API_URL}/billing/public/plans?country=${encodeURIComponent(normalizedCountry)}`, {
            cache: 'no-store',
            signal,
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json.success && Array.isArray(json.data) ? json.data : null;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        return null;
    }
}

export function formatMoney(cents: number, currency: string, locale: string): string {
    const amount = cents / 100;
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
    }).format(amount);
}
