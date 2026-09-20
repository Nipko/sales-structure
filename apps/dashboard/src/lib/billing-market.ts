/** Signup carries an intention only; onboarding validates it against the API market catalog. */
export function normalizeBillingCountry(value: string | null): string | undefined {
    const normalized = value?.trim().toUpperCase();
    return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

export function selectBillingCountry(requested: string | undefined, detected: string | null, supported: readonly string[]): string | undefined {
    return [requested, detected].find((country): country is string => !!country && supported.includes(country));
}
