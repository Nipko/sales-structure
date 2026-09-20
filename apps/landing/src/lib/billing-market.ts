/** A language is not a billing country. Only explicit choice or trusted edge data can suggest one. */
export function resolveBillingCountry(
  requested: string | null,
  saved: string | null,
  detected: string | null,
  supportedCountries: readonly string[],
): string | null {
  for (const candidate of [requested, saved, detected]) {
    const normalized = candidate?.trim().toUpperCase();
    if (normalized && supportedCountries.includes(normalized)) return normalized;
  }
  return null;
}

export function subscriptionProvider(country: string | null): 'wompi' | 'stripe' | null {
  return country ? (country === 'CO' ? 'wompi' : 'stripe') : null;
}
