/**
 * Narrow tier: countries with a CHARGING CURRENCY configured. Subset of the wide
 * tier (`SUPPORTED_BILLING_COUNTRIES` in `common/utils/billing-country.util.ts`),
 * which is the single list of countries we recognize as a tenant billing country.
 *
 * The two tiers answer different questions and must not be conflated:
 *  - wide  → may this value be stored on `tenants.billing_country`? (identity +
 *    fiscal document routing; validated at onboarding and at PATCH /fiscal)
 *  - narrow → can we quote and charge in local currency? (plan catalog, price
 *    sync, provider charging). A recognized country outside this map is a valid
 *    tenant: the catalog quotes it in USD.
 */
export const BILLING_CURRENCY_BY_COUNTRY = {
    CO: 'COP',
    MX: 'MXN',
    AR: 'ARS',
    CL: 'CLP',
    PE: 'PEN',
    BR: 'BRL',
    UY: 'UYU',
    PY: 'PYG',
    BO: 'BOB',
    EC: 'USD',
    VE: 'USD',
    CR: 'CRC',
    PA: 'USD',
    DO: 'DOP',
    GT: 'GTQ',
    US: 'USD',
    CA: 'CAD',
} as const;

export type BillingCountry = keyof typeof BILLING_CURRENCY_BY_COUNTRY;

/** Countries where this installation can create MercadoPago subscription plans. */
export const MERCADOPAGO_CURRENCY_BY_COUNTRY = {
    CO: 'COP',
    AR: 'ARS',
    MX: 'MXN',
    CL: 'CLP',
    PE: 'PEN',
    UY: 'UYU',
    BR: 'BRL',
} as const satisfies Partial<Record<BillingCountry, string>>;

export function normalizeBillingCountry(country?: string | null): string | null {
    const normalized = country?.trim().toUpperCase();
    return normalized || null;
}

/** Narrow tier: does this country have a charging currency configured? */
export function hasBillingCurrency(country: string): country is BillingCountry {
    return Object.prototype.hasOwnProperty.call(BILLING_CURRENCY_BY_COUNTRY, country);
}

/**
 * @deprecated Ambiguous name — it reads like "is this a valid billing country?"
 * but only answers the narrow currency question. Use `hasBillingCurrency` for
 * pricing/charging and `isSupportedBillingCountry` (common/utils) for validation
 * of a stored tenant country. Kept so existing call sites keep compiling.
 */
export function isBillingCountry(country: string): country is BillingCountry {
    return hasBillingCurrency(country);
}

export function isMercadoPagoCountry(country: string): country is keyof typeof MERCADOPAGO_CURRENCY_BY_COUNTRY {
    return Object.prototype.hasOwnProperty.call(MERCADOPAGO_CURRENCY_BY_COUNTRY, country);
}
