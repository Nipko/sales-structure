import {
    BILLING_CURRENCY_BY_COUNTRY,
    isBillingCountry,
    normalizeBillingCountry,
} from './billing-country-config';

type JsonRecord = Record<string, any>;

export interface ProviderPlanInvalidation {
    country: string;
    cycle: 'month' | 'year';
    source: 'override' | 'legacy';
}

export interface PriceOverrideValidationIssue {
    path: string;
    code: 'unsupported_country' | 'duplicate_country' | 'invalid_object' | 'unknown_field'
        | 'invalid_currency' | 'invalid_amount' | 'zero_not_allowed';
    message: string;
}

export class PriceOverrideValidationError extends Error {
    constructor(readonly issues: PriceOverrideValidationIssue[]) {
        super('Invalid priceLocalOverrides');
    }
}

interface ReconcilePlanPriceSyncInput {
    planSlug: string;
    existingOverrides: unknown;
    incomingOverrides?: Record<string, any>;
    existingUsdPriceCents: number;
    nextUsdPriceCents: number;
    existingLegacyMpPlanId: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: JsonRecord, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function hasFixedAmount(record: unknown): boolean {
    return isRecord(record)
        && Number.isSafeInteger(record.amountCents)
        && record.amountCents >= 0;
}

function providerId(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function canonicalizeExistingOverrides(value: unknown): JsonRecord {
    if (!isRecord(value)) return {};

    const output: JsonRecord = {};
    // Lowercase aliases are folded first; an existing canonical uppercase key
    // wins when both exist because it is what checkout resolves today.
    const entries = Object.entries(value).sort(([left], [right]) =>
        Number(left === left.toUpperCase()) - Number(right === right.toUpperCase()));

    for (const [rawCountry, rawOverride] of entries) {
        const country = normalizeBillingCountry(rawCountry);
        if (!country || !isBillingCountry(country) || !isRecord(rawOverride)) {
            output[rawCountry] = rawOverride;
            continue;
        }
        const previous = isRecord(output[country]) ? output[country] : {};
        const previousAnnual = isRecord(previous.annual) ? previous.annual : {};
        const incomingAnnual = isRecord(rawOverride.annual) ? rawOverride.annual : null;
        output[country] = {
            ...previous,
            ...rawOverride,
            ...(incomingAnnual ? { annual: { ...previousAnnual, ...incomingAnnual } } : {}),
        };
    }
    return output;
}

function validateAmount(
    issues: PriceOverrideValidationIssue[],
    path: string,
    value: unknown,
    allowZero: boolean,
): value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        issues.push({
            path,
            code: 'invalid_amount',
            message: `${path} debe ser un entero seguro mayor o igual a 0, expresado en centavos.`,
        });
        return false;
    }
    if (value === 0 && !allowZero) {
        issues.push({
            path,
            code: 'zero_not_allowed',
            message: `${path} debe ser mayor que 0 para planes de autoservicio; 0 solo es válido para Custom.`,
        });
        return false;
    }
    return true;
}

/**
 * Merge an admin price patch while keeping provider IDs server-owned. Incoming
 * mpPlanId fields are intentionally ignored: only syncPlanToMp may create or
 * replace them. Amount/currency changes fail closed by clearing the affected ID.
 */
export function reconcilePlanPriceSync(input: ReconcilePlanPriceSyncInput): {
    priceLocalOverrides: JsonRecord;
    legacyMpPlanId: string | null;
    invalidated: ProviderPlanInvalidation[];
} {
    const existingOverrides = canonicalizeExistingOverrides(input.existingOverrides);
    const mergedOverrides: JsonRecord = Object.fromEntries(
        Object.entries(existingOverrides).map(([country, value]) => {
            if (!isRecord(value)) return [country, value];
            return [country, {
                ...value,
                ...(isRecord(value.annual) ? { annual: { ...value.annual } } : {}),
            }];
        }),
    );
    const invalidated: ProviderPlanInvalidation[] = [];
    const issues: PriceOverrideValidationIssue[] = [];
    const normalizedIncoming = new Map<string, JsonRecord>();
    const allowZero = input.planSlug === 'custom';
    let legacyMpPlanId = input.existingLegacyMpPlanId;

    for (const [rawCountry, rawOverride] of Object.entries(input.incomingOverrides ?? {})) {
        const country = normalizeBillingCountry(rawCountry);
        if (!country || !isBillingCountry(country)) {
            issues.push({
                path: `priceLocalOverrides.${rawCountry}`,
                code: 'unsupported_country',
                message: `País ${rawCountry || '(vacío)'} no soportado. Permitidos: ${Object.keys(BILLING_CURRENCY_BY_COUNTRY).join(', ')}.`,
            });
            continue;
        }
        if (normalizedIncoming.has(country)) {
            issues.push({
                path: `priceLocalOverrides.${rawCountry}`,
                code: 'duplicate_country',
                message: `El país ${country} aparece más de una vez con distinta capitalización. Enviá una sola clave ${country}.`,
            });
            continue;
        }
        if (!isRecord(rawOverride)) {
            issues.push({
                path: `priceLocalOverrides.${country}`,
                code: 'invalid_object',
                message: `priceLocalOverrides.${country} debe ser un objeto.`,
            });
            continue;
        }
        normalizedIncoming.set(country, rawOverride);
    }

    for (const [country, incomingCountry] of normalizedIncoming) {
        const path = `priceLocalOverrides.${country}`;
        const expectedCurrency = BILLING_CURRENCY_BY_COUNTRY[country as keyof typeof BILLING_CURRENCY_BY_COUNTRY];
        const allowedCountryKeys = new Set([
            'currency', 'amountCents', 'annual',
            // Provider id + fingerprint are accepted for backwards-compatible
            // full-object admin forms, but are deliberately never copied from
            // input. Only syncPlanToMp owns these fields.
            'mpPlanId', 'syncedAmountCents', 'syncedCurrency',
        ]);
        for (const key of Object.keys(incomingCountry)) {
            if (!allowedCountryKeys.has(key)) {
                issues.push({ path: `${path}.${key}`, code: 'unknown_field', message: `${path}.${key} no es un campo permitido.` });
            }
        }

        const existingCountry = isRecord(existingOverrides[country]) ? existingOverrides[country] : {};
        const nextCountry: JsonRecord = { ...existingCountry };
        const existingCurrency = typeof existingCountry.currency === 'string'
            ? existingCountry.currency.trim().toUpperCase()
            : expectedCurrency;

        if (hasOwn(incomingCountry, 'currency')) {
            const incomingCurrency = typeof incomingCountry.currency === 'string'
                ? incomingCountry.currency.trim().toUpperCase()
                : '';
            if (incomingCurrency !== expectedCurrency) {
                issues.push({
                    path: `${path}.currency`,
                    code: 'invalid_currency',
                    message: `${path}.currency debe ser ${expectedCurrency} para ${country}.`,
                });
            }
        }
        nextCountry.currency = expectedCurrency;

        const monthlyAmountChanged = hasOwn(incomingCountry, 'amountCents')
            && incomingCountry.amountCents !== existingCountry.amountCents;
        if (hasOwn(incomingCountry, 'amountCents')
            && validateAmount(issues, `${path}.amountCents`, incomingCountry.amountCents, allowZero)) {
            nextCountry.amountCents = incomingCountry.amountCents;
        }

        const existingMonthlyId = providerId(existingCountry.mpPlanId);
        if (existingMonthlyId) nextCountry.mpPlanId = existingMonthlyId;
        else delete nextCountry.mpPlanId;

        const currencyChanged = existingCurrency !== expectedCurrency;
        if (monthlyAmountChanged || currencyChanged) {
            if (existingMonthlyId) invalidated.push({ country, cycle: 'month', source: 'override' });
            delete nextCountry.mpPlanId;
            delete nextCountry.syncedAmountCents;
            delete nextCountry.syncedCurrency;
            if (country === 'CO') {
                if (legacyMpPlanId) invalidated.push({ country, cycle: 'month', source: 'legacy' });
                legacyMpPlanId = null;
            }
        }

        const existingAnnual = isRecord(existingCountry.annual) ? existingCountry.annual : {};
        const existingAnnualId = providerId(existingAnnual.mpPlanId);
        if (hasOwn(incomingCountry, 'annual')) {
            if (!isRecord(incomingCountry.annual)) {
                issues.push({
                    path: `${path}.annual`,
                    code: 'invalid_object',
                    message: `${path}.annual debe ser un objeto.`,
                });
            } else {
                const incomingAnnual = incomingCountry.annual;
                const allowedAnnualKeys = new Set([
                    'currency', 'amountCents', 'mpPlanId', 'syncedAmountCents', 'syncedCurrency',
                ]);
                for (const key of Object.keys(incomingAnnual)) {
                    if (!allowedAnnualKeys.has(key)) {
                        issues.push({ path: `${path}.annual.${key}`, code: 'unknown_field', message: `${path}.annual.${key} no es un campo permitido.` });
                    }
                }
                if (hasOwn(incomingAnnual, 'currency')) {
                    const incomingCurrency = typeof incomingAnnual.currency === 'string'
                        ? incomingAnnual.currency.trim().toUpperCase()
                        : '';
                    if (incomingCurrency !== expectedCurrency) {
                        issues.push({
                            path: `${path}.annual.currency`,
                            code: 'invalid_currency',
                            message: `${path}.annual.currency debe ser ${expectedCurrency} para ${country}.`,
                        });
                    }
                }

                const nextAnnual: JsonRecord = { ...existingAnnual, currency: expectedCurrency };
                const annualAmountChanged = hasOwn(incomingAnnual, 'amountCents')
                    && incomingAnnual.amountCents !== existingAnnual.amountCents;
                if (hasOwn(incomingAnnual, 'amountCents')
                    && validateAmount(issues, `${path}.annual.amountCents`, incomingAnnual.amountCents, allowZero)) {
                    nextAnnual.amountCents = incomingAnnual.amountCents;
                }
                if (existingAnnualId) nextAnnual.mpPlanId = existingAnnualId;
                else delete nextAnnual.mpPlanId;

                const existingAnnualCurrency = typeof existingAnnual.currency === 'string'
                    ? existingAnnual.currency.trim().toUpperCase()
                    : expectedCurrency;
                if (annualAmountChanged || currencyChanged || existingAnnualCurrency !== expectedCurrency) {
                    if (existingAnnualId) invalidated.push({ country, cycle: 'year', source: 'override' });
                    delete nextAnnual.mpPlanId;
                    delete nextAnnual.syncedAmountCents;
                    delete nextAnnual.syncedCurrency;
                }
                nextCountry.annual = nextAnnual;
            }
        } else if (isRecord(existingCountry.annual)) {
            nextCountry.annual = { ...existingCountry.annual };
        }

        mergedOverrides[country] = nextCountry;
    }

    if (issues.length > 0) throw new PriceOverrideValidationError(issues);

    // A provider plan created from USD+FX has no fixed local amount. If the USD
    // base changes, its old ID must not be reused. Fixed local prices are
    // independent of priceUsdCents and keep their synchronization state.
    if (input.nextUsdPriceCents !== input.existingUsdPriceCents) {
        for (const [rawCountry, value] of Object.entries(mergedOverrides)) {
            if (!isRecord(value) || hasFixedAmount(value)) continue;
            if (providerId(value.mpPlanId)) {
                invalidated.push({ country: rawCountry.toUpperCase(), cycle: 'month', source: 'override' });
            }
            delete value.mpPlanId;
            delete value.syncedAmountCents;
            delete value.syncedCurrency;
        }

        const coOverride = mergedOverrides.CO;
        if (!hasFixedAmount(coOverride) && legacyMpPlanId) {
            invalidated.push({ country: 'CO', cycle: 'month', source: 'legacy' });
            legacyMpPlanId = null;
        }
    }

    return { priceLocalOverrides: mergedOverrides, legacyMpPlanId, invalidated };
}
