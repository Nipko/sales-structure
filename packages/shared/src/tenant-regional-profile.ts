/**
 * Operating identity, separated from billing identity.
 *
 * The platform used billing country, timezone, agent language and a free-text
 * Business Info country as partially interchangeable signals for the same
 * question, and fell back to Colombia when none answered. They are not the same
 * question:
 *
 * - `operatingCountry` governs terminology, formats, phone parsing and which
 *   regulatory sources the agent may cite.
 * - `billingCountry` governs price, tax and which rail charges the tenant.
 * - the CUSTOMER's country is a third thing, known per conversation, and it
 *   wins over both when we know it reliably.
 *
 * A Colombian company can bill from Colombia and run a hotel in Mexico whose
 * guests are Argentine. Every one of those three has a correct, different
 * answer, and collapsing them is what produced COP prices for Mexican guests
 * and `+57` on Argentine mobile numbers.
 */

export type Iso3166Alpha2 = string;
export type Iso4217 = string;
export type Bcp47Tag = string;
export type IanaTimezone = string;

/** How a resolved regional value was arrived at. */
export type RegionalValueSource =
    /** The tenant chose it explicitly. */
    | 'declared'
    /** Derived from another declared value (country → currency). */
    | 'derived'
    /** Guessed from a weaker signal (timezone → country). Needs confirmation. */
    | 'inferred'
    /** Nothing said anything; the platform default applied. */
    | 'fallback';

export interface RegionalValue<T> {
    value: T;
    source: RegionalValueSource;
    /** The signal it came from, e.g. `tenants.billing_country`. */
    from?: string;
}

/** Form of address. Not derivable from country alone — `vos` is regional. */
export type AddressForm = 'usted' | 'tu' | 'vos' | 'voce' | 'senhor_senhora';

export interface TenantRegionalProfileV1 {
    version: 1;
    tenantId: string;

    operatingCountry: RegionalValue<Iso3166Alpha2>;
    billingCountry: RegionalValue<Iso3166Alpha2>;
    /** Currency the business quotes and charges its own customers in. */
    operatingCurrency: RegionalValue<Iso4217>;
    timezone: RegionalValue<IanaTimezone>;
    /** BCP 47 conversational locale, e.g. `es-CO`, `pt-BR`. */
    locale: RegionalValue<Bcp47Tag>;
    /** ISO region used to parse phone numbers into E.164. */
    phoneRegion: RegionalValue<Iso3166Alpha2>;
    addressSchemaId: RegionalValue<string>;
    addressForm: RegionalValue<AddressForm>;

    countryPackId: string;
    countryPackVersion: string;
    /** Country packs start `draft`; only evidence promotes them. */
    countryPackStatus: CountryPackStatus;
    /** Reviewed generation vocabulary for the operating country. */
    preferredTerms?: Readonly<Record<string, string>>;
    /** Registers the agent must not generate for this country. */
    prohibitedRegisters?: readonly string[];

    /** Fields whose signals disagree and are queued for a human. */
    conflicts: RegionalConflict[];
    resolvedAt: string;
}

export type CountryPackStatus = 'draft' | 'fallback_only' | 'pilot' | 'certified';

export interface RegionalConflict {
    field: 'operating_country' | 'timezone' | 'currency' | 'locale' | 'phone_region';
    candidates: Array<{ value: string; from: string }>;
    suggested?: string;
}

/**
 * Countries the onboarding selector offers. The backend accepts ~62 codes
 * derived from a timezone map, which is a much weaker claim: accepting a code
 * in a DTO is not the same as having a certified market. Kept here so the two
 * lists stop drifting — the dashboard duplicated this array twice.
 */
export const ONBOARDING_COUNTRIES: readonly Iso3166Alpha2[] = [
    'CO', 'MX', 'AR', 'CL', 'PE', 'BR', 'UY', 'PY', 'BO', 'EC',
    'VE', 'CR', 'PA', 'DO', 'GT', 'US', 'CA',
];

/**
 * El país que la plataforma usa cuando NO SABE.
 *
 * Existe como constante con nombre, y no como `'CO'` escrito veinte veces,
 * porque un literal repetido no se puede auditar: nadie puede contestar
 * "¿dónde estamos asumiendo Colombia?" leyendo el código. Todo valor que salga
 * de acá viaja marcado `fallback`, y ese marcado es lo que permite que un
 * teléfono no se normalice y que el panel diga "puesto por defecto" en vez de
 * hacerlo pasar por una decisión del dueño.
 *
 * Cambiarlo NO es una decisión de producto menor: mueve la zona horaria, la
 * moneda y la forma de trato de todo tenant que todavía no declaró nada.
 */
export const PLATFORM_FALLBACK_COUNTRY = 'CO';

/** Default operating currency per country. ISO 4217, never a symbol. */
export const COUNTRY_DEFAULT_CURRENCY: Readonly<Record<string, Iso4217>> = {
    CO: 'COP', MX: 'MXN', AR: 'ARS', CL: 'CLP', PE: 'PEN', BR: 'BRL',
    UY: 'UYU', PY: 'PYG', BO: 'BOB', EC: 'USD', VE: 'USD', CR: 'CRC',
    PA: 'USD', DO: 'DOP', GT: 'GTQ', US: 'USD', CA: 'CAD', ES: 'EUR',
    SV: 'USD', HN: 'HNL', NI: 'NIO', PR: 'USD', CU: 'CUP',
};

/** Primary IANA timezone per country, for countries with one obvious zone. */
export const COUNTRY_DEFAULT_TIMEZONE: Readonly<Record<string, IanaTimezone>> = {
    CO: 'America/Bogota', MX: 'America/Mexico_City', AR: 'America/Argentina/Buenos_Aires',
    CL: 'America/Santiago', PE: 'America/Lima', BR: 'America/Sao_Paulo',
    UY: 'America/Montevideo', PY: 'America/Asuncion', BO: 'America/La_Paz',
    EC: 'America/Guayaquil', VE: 'America/Caracas', CR: 'America/Costa_Rica',
    PA: 'America/Panama', DO: 'America/Santo_Domingo', GT: 'America/Guatemala',
    US: 'America/New_York', CA: 'America/Toronto', ES: 'Europe/Madrid',
    SV: 'America/El_Salvador', HN: 'America/Tegucigalpa', NI: 'America/Managua',
    PR: 'America/Puerto_Rico', CU: 'America/Havana',
};

/** Default conversational locale per country. */
export const COUNTRY_DEFAULT_LOCALE: Readonly<Record<string, Bcp47Tag>> = {
    CO: 'es-CO', MX: 'es-MX', AR: 'es-AR', CL: 'es-CL', PE: 'es-PE',
    BR: 'pt-BR', UY: 'es-UY', PY: 'es-PY', BO: 'es-BO', EC: 'es-EC',
    VE: 'es-VE', CR: 'es-CR', PA: 'es-PA', DO: 'es-DO', GT: 'es-GT',
    US: 'en-US', CA: 'en-CA', ES: 'es-ES',
    SV: 'es-SV', HN: 'es-HN', NI: 'es-NI', PR: 'es-PR', CU: 'es-CU',
};

/**
 * Default form of address per country.
 *
 * Conservative on purpose: `usted` wherever the register is contested, because
 * over-familiarity costs more than formality in health, finance and complaints.
 * The RAE documents `vos` as the general informal form in Argentina, Uruguay and
 * Paraguay — it is not a single Latin American voseo that can be applied
 * everywhere, which is exactly the mistake the shipped guidance made by mixing
 * `resumí`/`entendé` into prompts for other countries.
 */
export const COUNTRY_DEFAULT_ADDRESS_FORM: Readonly<Record<string, AddressForm>> = {
    CO: 'usted', MX: 'usted', AR: 'vos', CL: 'usted', PE: 'usted',
    BR: 'voce', UY: 'vos', PY: 'vos', BO: 'usted', EC: 'usted',
    VE: 'tu', CR: 'usted', PA: 'usted', DO: 'usted', GT: 'usted',
    US: 'tu', CA: 'tu', ES: 'tu',
};

/**
 * Country-pack certification status.
 *
 * Every pack starts `draft`. A country accepted by a DTO is not a certified
 * market — promotion needs native-speaker review, a consented corpus and the
 * per-pack eval thresholds. US and CA are `fallback_only` because they cannot
 * be resolved by country alone: `en-US`/`es-US` and `en-CA`/`fr-CA` coexist,
 * regulation is state/provincial, and `+1` needs metadata rather than a prefix
 * comparison.
 */
export const COUNTRY_PACK_STATUS: Readonly<Record<string, CountryPackStatus>> = {
    CO: 'draft', MX: 'draft', AR: 'draft', CL: 'draft', PE: 'draft',
    BR: 'draft', UY: 'draft', PY: 'draft', BO: 'draft', EC: 'draft',
    VE: 'draft', CR: 'draft', PA: 'draft', DO: 'draft', GT: 'draft',
    US: 'fallback_only', CA: 'fallback_only',
};

export const FALLBACK_COUNTRY_PACK_ID = 'es-419';

/** Resolve a country's pack id, or the neutral regional fallback. */
export function countryPackIdFor(country?: string | null): string {
    const code = String(country || '').toUpperCase();
    return COUNTRY_DEFAULT_LOCALE[code] || FALLBACK_COUNTRY_PACK_ID;
}

export function countryPackStatusFor(country?: string | null): CountryPackStatus {
    const code = String(country || '').toUpperCase();
    return COUNTRY_PACK_STATUS[code] || 'fallback_only';
}
