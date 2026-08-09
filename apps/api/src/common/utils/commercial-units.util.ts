import { BadRequestException } from '@nestjs/common';

/**
 * Pinned ISO-4217 minor-unit exponents for currencies the platform accepts in
 * commercial and FX lineage. Do not use ICU for this: its currency data can
 * differ between Node builds (notably COP), which would make persisted minor
 * units mean different things across environments.
 *
 * This registry is deliberately allow-listed. Adding a currency is a finance
 * contract change and must include its ISO exponent and conversion coverage.
 */
const ISO_4217_MINOR_UNIT_EXPONENTS: Readonly<Record<string, 0 | 2 | 3 | 4>> = Object.freeze({
    // Platform billing and LatAm operating currencies.
    ARS: 2,
    BOB: 2,
    BRL: 2,
    CLP: 0,
    COP: 2,
    CRC: 2,
    DOP: 2,
    GTQ: 2,
    HNL: 2,
    MXN: 2,
    NIO: 2,
    PAB: 2,
    PEN: 2,
    PYG: 0,
    UYU: 2,
    USD: 2,
    VES: 2,

    // Common provider/import currencies supported by commercial operations.
    AED: 2,
    AUD: 2,
    BHD: 3,
    BIF: 0,
    CAD: 2,
    CHF: 2,
    CLF: 4,
    CNY: 2,
    CZK: 2,
    DKK: 2,
    DJF: 0,
    EGP: 2,
    EUR: 2,
    GBP: 2,
    GNF: 0,
    HKD: 2,
    IDR: 2,
    ILS: 2,
    INR: 2,
    IQD: 3,
    ISK: 0,
    JOD: 3,
    JPY: 0,
    KMF: 0,
    KRW: 0,
    KWD: 3,
    LYD: 3,
    MYR: 2,
    NOK: 2,
    NZD: 2,
    OMR: 3,
    PHP: 2,
    PLN: 2,
    RON: 2,
    RWF: 0,
    SAR: 2,
    SEK: 2,
    SGD: 2,
    THB: 2,
    TND: 3,
    TRY: 2,
    TWD: 2,
    UGX: 0,
    VND: 0,
    VUV: 0,
    XAF: 0,
    XOF: 0,
    XPF: 0,
    ZAR: 2,
});

/**
 * Currency and duration values cross several vertical tables. Keep their
 * syntactic validation in one place so every writer applies the same rules
 * without guessing a tenant's commercial currency or converting prices.
 */
export function normalizeCurrencyCode(value: unknown, fallback = 'COP'): string {
    const candidate = typeof value === 'string' && value.trim()
        ? value.trim().toUpperCase()
        : fallback.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(candidate)) {
        throw new BadRequestException('currency must be a three-letter uppercase code');
    }
    return candidate;
}

/**
 * Resolve the pinned ISO-4217 minor-unit exponent. Unknown three-letter
 * labels are rejected instead of being treated as two-decimal currencies.
 * This is required before any FX arithmetic.
 */
export function requireCurrencyMinorUnitExponent(value: unknown): number {
    const currency = normalizeCurrencyCode(value, '');
    const exponent = ISO_4217_MINOR_UNIT_EXPONENTS[currency];
    if (exponent === undefined) {
        throw new BadRequestException(`currency is not an explicitly supported ISO-4217 code: ${currency}`);
    }
    return exponent;
}

/** PostgreSQL duration columns in the vertical schemas are integer units. */
export function requirePositiveIntegerUnit(value: unknown, field: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BadRequestException(`${field} must be a positive integer`);
    }
    return parsed;
}

/** Optional duration fields remain null when the domain has no known value. */
export function optionalPositiveIntegerUnit(value: unknown, field: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    return requirePositiveIntegerUnit(value, field);
}
