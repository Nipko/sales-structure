import { PaymentProviderName } from '../types/provider-types';

/**
 * Payment source kinds a provider can charge without the customer present
 * (merchant-initiated). Anything not listed here needs the customer to act on
 * every charge, which forces the link + reminder collection pattern instead of
 * a silent renewal.
 */
export type PaymentSourceKind =
    | 'card'
    | 'nequi'
    | 'daviplata'
    | 'bancolombia_transfer'
    | 'pse'
    | 'provider_native';

/**
 * What a provider can actually do.
 *
 * BillingService must branch on these flags, never on the provider NAME.
 * A string comparison like `sub.provider === 'mercadopago'` silently does the
 * wrong thing the moment a fourth provider appears; a capability check keeps
 * working because a new adapter has to declare what it supports.
 */
export interface ProviderCapabilities {
    /**
     * The provider owns the billing calendar: it schedules renewals, charges
     * them and retries failures on its own (MercadoPago preapproval, Stripe
     * subscriptions). When false, OUR recurring engine does all of that and the
     * provider is only asked to execute single charges against a stored source.
     */
    nativeSubscriptions: boolean;

    /** Reusable payment instruments the merchant can charge later (Wompi payment sources, Stripe payment methods). */
    storedPaymentSources: boolean;

    /** The provider keeps a remote plan catalog that must be synchronized (MP preapproval_plan). When false we store the frozen price instead of a remote id. */
    planCatalog: boolean;

    /** A subscription can move to another plan in place, without cancel + recreate. */
    changePlanInPlace: boolean;

    /** Native pause/resume of billing. */
    pauseResume: boolean;

    /** The provider computes proration on plan changes. When false, we compute it. */
    nativeProration: boolean;

    /**
     * refunds:
     *  - 'full'      → arbitrary refunds through the API (MP, Stripe)
     *  - 'void_only' → only pre-settlement voids, and only for some methods (Wompi cards)
     *  - 'none'      → no API at all; money is returned out of band
     * Anything other than 'full' must degrade the inline refund UI to
     * "manual refund registered" — never fake success.
     */
    refunds: 'full' | 'void_only' | 'none';

    /**
     * A charge never returns its final outcome synchronously: the POST returns
     * PENDING and the result arrives by webhook or polling (Wompi). Callers must
     * not treat a successful HTTP response as a successful payment.
     */
    asyncSettlement: boolean;

    /** Currencies the provider can charge. Empty array = no restriction known. */
    currencies: readonly string[];

    /** Payment source kinds this provider can charge unattended. */
    unattendedMethods: readonly PaymentSourceKind[];

    /** The provider requires terms/data-processing acceptance tokens on every charge (Wompi habeas data). */
    requiresAcceptanceTokens: boolean;

    /** ISO-3166-1 alpha-2 countries the provider can bill in. Empty = unrestricted. */
    countries: readonly string[];
}

export const MERCADOPAGO_CAPABILITIES: ProviderCapabilities = {
    nativeSubscriptions: true,
    storedPaymentSources: false,
    planCatalog: true,
    changePlanInPlace: false, // MP needs cancel + recreate
    pauseResume: true,
    nativeProration: false,
    refunds: 'full',
    asyncSettlement: false,
    currencies: ['COP', 'ARS', 'MXN', 'CLP', 'PEN', 'UYU', 'BRL'],
    unattendedMethods: ['provider_native'],
    requiresAcceptanceTokens: false,
    countries: ['CO', 'AR', 'MX', 'CL', 'PE', 'UY', 'BR'],
};

export const STRIPE_CAPABILITIES: ProviderCapabilities = {
    nativeSubscriptions: true,
    storedPaymentSources: true,
    planCatalog: true,
    changePlanInPlace: true,
    pauseResume: true,
    nativeProration: true,
    refunds: 'full',
    asyncSettlement: false,
    currencies: [],
    unattendedMethods: ['provider_native', 'card'],
    requiresAcceptanceTokens: false,
    /**
     * Explicit allowlist, NOT an empty "unrestricted" list: Stripe does not
     * operate in Colombia (in LatAm only Brazil and Mexico), and an empty list
     * would let the router send Colombian tenants there. Extend as we open
     * markets — the operating countries of the entity we bill through.
     */
    countries: [
        // LatAm — the only two Stripe supports
        'BR', 'MX',
        // North America
        'US', 'CA',
        // Europe
        'GB', 'IE', 'ES', 'PT', 'FR', 'DE', 'IT', 'NL', 'BE', 'AT', 'CH',
        'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'RO', 'GR', 'LU',
        // APAC
        'AU', 'NZ', 'JP', 'SG', 'HK', 'MY',
    ],
};

/**
 * Wompi (Bancolombia). Colombia and COP only, no subscription objects at all:
 * we tokenize a payment source once and fire one transaction per period from
 * our own scheduler. Every charge is asynchronous (always born PENDING) and
 * there is no refund endpoint — only pre-settlement card voids.
 */
export const WOMPI_CAPABILITIES: ProviderCapabilities = {
    nativeSubscriptions: false,
    storedPaymentSources: true,
    planCatalog: false,
    changePlanInPlace: false,
    pauseResume: false,
    nativeProration: false,
    refunds: 'void_only',
    asyncSettlement: true,
    currencies: ['COP'],
    // Daviplata needs a commercial activation we deliberately avoid, so it is
    // not listed. Nequi / Bancolombia transfer ship behind their own flags.
    unattendedMethods: ['card', 'nequi', 'bancolombia_transfer'],
    requiresAcceptanceTokens: true,
    countries: ['CO'],
};

export const MOCK_CAPABILITIES: ProviderCapabilities = {
    nativeSubscriptions: true,
    storedPaymentSources: true,
    planCatalog: true,
    changePlanInPlace: true,
    pauseResume: true,
    nativeProration: false,
    refunds: 'full',
    asyncSettlement: false,
    currencies: [],
    unattendedMethods: ['provider_native', 'card'],
    requiresAcceptanceTokens: false,
    countries: [],
};

export const PROVIDER_CAPABILITIES: Record<PaymentProviderName, ProviderCapabilities> = {
    mercadopago: MERCADOPAGO_CAPABILITIES,
    stripe: STRIPE_CAPABILITIES,
    wompi: WOMPI_CAPABILITIES,
    mock: MOCK_CAPABILITIES,
};

/** True when the provider can bill a tenant in this country. Empty country list = unrestricted. */
export function providerSupportsCountry(
    caps: ProviderCapabilities,
    country?: string | null,
): boolean {
    if (!caps.countries.length) return true;
    const code = (country || '').trim().toUpperCase();
    if (!code) return false;
    return caps.countries.includes(code);
}
