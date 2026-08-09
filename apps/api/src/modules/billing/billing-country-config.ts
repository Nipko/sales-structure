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

export function isBillingCountry(country: string): country is BillingCountry {
    return Object.prototype.hasOwnProperty.call(BILLING_CURRENCY_BY_COUNTRY, country);
}

export function isMercadoPagoCountry(country: string): country is keyof typeof MERCADOPAGO_CURRENCY_BY_COUNTRY {
    return Object.prototype.hasOwnProperty.call(MERCADOPAGO_CURRENCY_BY_COUNTRY, country);
}
