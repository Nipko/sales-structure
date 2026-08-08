import { BadRequestException } from '@nestjs/common';

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
 * Resolve the ISO-4217 minor-unit exponent from the runtime's ICU currency
 * data. Unknown three-letter labels are rejected instead of being treated as
 * two-decimal currencies. This is required before any FX arithmetic.
 */
export function requireCurrencyMinorUnitExponent(value: unknown): number {
    const currency = normalizeCurrencyCode(value, '');
    const supported = typeof (Intl as any).supportedValuesOf === 'function'
        ? new Set<string>((Intl as any).supportedValuesOf('currency'))
        : null;
    if (supported && !supported.has(currency)) {
        throw new BadRequestException(`currency is not a recognized ISO-4217 code: ${currency}`);
    }
    const options = new Intl.NumberFormat('en', {
        style: 'currency', currency,
    }).resolvedOptions();
    const exponent = options.maximumFractionDigits;
    if (typeof exponent !== 'number' || !Number.isInteger(exponent) || exponent < 0 || exponent > 4) {
        throw new BadRequestException(`currency minor-unit exponent is unsupported: ${currency}`);
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
