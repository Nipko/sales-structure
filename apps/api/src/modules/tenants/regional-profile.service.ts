import { Injectable, Logger } from '@nestjs/common';
import {
    AddressForm,
    COUNTRY_DEFAULT_ADDRESS_FORM,
    COUNTRY_DEFAULT_CURRENCY,
    COUNTRY_DEFAULT_LOCALE,
    COUNTRY_DEFAULT_TIMEZONE,
    FALLBACK_COUNTRY_PACK_ID,
    RegionalConflict,
    RegionalValue,
    RegionalValueSource,
    TenantRegionalProfileV1,
    countryPackIdFor,
    countryPackStatusFor,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * The one resolver for "where does this tenant operate".
 *
 * Country, currency, timezone, locale and phone prefix were each decided in
 * several places with different precedences, and every one of them ended at a
 * Colombian default: `es-CO`, `America/Bogota`, `COP`, `+57`. A Brazilian
 * tenant could start with a Colombian agent identity, quote in COP, and have
 * its customers' phone numbers rewritten with `+57` — which in the identity
 * module can merge two different people into one contact.
 *
 * Precedence, highest first:
 *
 *  1. what the tenant DECLARED (`tenants.operating_*`);
 *  2. what is DERIVED from a declared value (country → currency);
 *  3. what can be INFERRED from a weaker signal (timezone → country) — recorded
 *     as inferred, never silently promoted to declared;
 *  4. the platform FALLBACK.
 *
 * Every value carries its source, because a wrong value that looks chosen is
 * far more expensive to debug than one that admits it was a guess.
 */

const CACHE_TTL_SECONDS = 300;
const PLATFORM_FALLBACK_COUNTRY = 'CO';

/** Timezone → country, for the inference step only. */
const TIMEZONE_COUNTRY: Readonly<Record<string, string>> = {
    'America/Bogota': 'CO', 'America/Mexico_City': 'MX', 'America/Cancun': 'MX',
    'America/Monterrey': 'MX', 'America/Tijuana': 'MX',
    'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR',
    'America/Argentina/Mendoza': 'AR', 'America/Santiago': 'CL',
    'America/Lima': 'PE', 'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR',
    'America/Fortaleza': 'BR', 'America/Manaus': 'BR', 'America/Recife': 'BR',
    'America/Montevideo': 'UY', 'America/Asuncion': 'PY', 'America/La_Paz': 'BO',
    'America/Guayaquil': 'EC', 'Pacific/Galapagos': 'EC', 'America/Caracas': 'VE',
    'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Santo_Domingo': 'DO',
    'America/Guatemala': 'GT', 'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN',
    'America/Managua': 'NI', 'America/Puerto_Rico': 'PR', 'America/Havana': 'CU',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
    'America/Los_Angeles': 'US', 'America/Phoenix': 'US',
    'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
    'Europe/Madrid': 'ES',
};

function normalizeCountry(value: unknown): string | null {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
}

function normalizeCurrency(value: unknown): string | null {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
}

function value<T>(v: T, source: RegionalValueSource, from?: string): RegionalValue<T> {
    return from ? { value: v, source, from } : { value: v, source };
}

@Injectable()
export class RegionalProfileService {
    private readonly logger = new Logger(RegionalProfileService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    async resolve(tenantId: string): Promise<TenantRegionalProfileV1> {
        const cacheKey = `regional:${tenantId}`;
        try {
            const cached = await this.redis.getJson<TenantRegionalProfileV1>(cacheKey);
            if (cached) return cached;
        } catch { /* A cache miss is not a failure. */ }

        const profile = await this.build(tenantId);
        try {
            await this.redis.setJson(cacheKey, profile, CACHE_TTL_SECONDS);
        } catch { /* Correct but uncached. */ }
        return profile;
    }

    async invalidate(tenantId: string): Promise<void> {
        await this.redis.del(`regional:${tenantId}`).catch(() => undefined);
    }

    /**
     * La región con la que se puede normalizar un teléfono — o `null`.
     *
     * Devuelve `null` cuando la procedencia es `fallback`, y ésa es toda la
     * idea: un fallback es "no sabemos, pusimos algo para seguir". Usarlo para
     * decidir a qué país pertenece un número es el `+57` de antes con otro
     * nombre — sólo que ahora escondido detrás de un servicio que parece
     * saber. Sin región, el normalizador devuelve `null` y el llamador se
     * queda con el número tal como lo escribió el cliente, que es la verdad.
     *
     * Un fallo de lectura tampoco inventa: `null` es "no sé", no "Colombia".
     */
    async phoneRegionFor(tenantId: string): Promise<string | null> {
        try {
            const profile = await this.resolve(tenantId);
            const region = profile.phoneRegion;
            if (!region || region.source === 'fallback') return null;
            // `derived` de un país que a su vez es fallback no sabe más que él.
            if (region.source === 'derived'
                && profile.operatingCountry?.source === 'fallback') {
                return null;
            }
            return region.value || null;
        } catch (error: any) {
            this.logger.warn(`[Regional] phoneRegion unavailable for ${tenantId}: ${error?.message}`);
            return null;
        }
    }

    private async build(tenantId: string): Promise<TenantRegionalProfileV1> {
        let tenant: any = null;
        try {
            tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    id: true, language: true, settings: true,
                    operatingCurrency: true, billingCountry: true,
                    operatingCountry: true, operatingTimezone: true,
                    defaultLocale: true, phoneRegion: true, addressSchemaId: true,
                    countryPackId: true, countryPackVersion: true,
                },
            });
        } catch (error: any) {
            this.logger.warn(`[Regional] tenant read failed for ${tenantId}: ${error?.message}`);
        }
        return this.compose(tenantId, tenant);
    }

    /**
     * Pure composition, exported for tests: the precedence rules are the whole
     * point of this service and must be assertable without a database.
     */
    compose(tenantId: string, tenant: any): TenantRegionalProfileV1 {
        const settings = (tenant?.settings as any) || {};
        const settingsTimezone = typeof settings.timezone === 'string' ? settings.timezone : null;
        const businessCountry = normalizeCountry(settings.businessInfo?.country);
        const billingCountry = normalizeCountry(tenant?.billingCountry);
        const conflicts: RegionalConflict[] = [];

        // ---- operating country -------------------------------------------
        let operatingCountry: RegionalValue<string>;
        const declaredCountry = normalizeCountry(tenant?.operatingCountry);
        if (declaredCountry) {
            operatingCountry = value(declaredCountry, 'declared', 'tenants.operating_country');
        } else if (businessCountry) {
            // Business Info is typed by the tenant about its own operation, so it
            // is a better signal than the billing relationship — but it is free
            // text with no validation, hence `inferred`.
            operatingCountry = value(businessCountry, 'inferred', 'business_info.country');
        } else if (billingCountry) {
            operatingCountry = value(billingCountry, 'inferred', 'tenants.billing_country');
        } else {
            const fromTimezone = settingsTimezone ? TIMEZONE_COUNTRY[settingsTimezone] : undefined;
            operatingCountry = fromTimezone
                ? value(fromTimezone, 'inferred', 'settings.timezone')
                : value(PLATFORM_FALLBACK_COUNTRY, 'fallback');
        }

        // A disagreement between signals is a question for the tenant, not
        // something to resolve by precedence and forget.
        const countryCandidates = [
            billingCountry ? { value: billingCountry, from: 'tenants.billing_country' } : null,
            businessCountry ? { value: businessCountry, from: 'business_info.country' } : null,
            settingsTimezone && TIMEZONE_COUNTRY[settingsTimezone]
                ? { value: TIMEZONE_COUNTRY[settingsTimezone], from: 'settings.timezone' }
                : null,
        ].filter(Boolean) as Array<{ value: string; from: string }>;
        const distinctCountries = new Set(countryCandidates.map(c => c.value));
        if (!declaredCountry && distinctCountries.size > 1) {
            conflicts.push({
                field: 'operating_country',
                candidates: countryCandidates,
                suggested: operatingCountry.value,
            });
        }

        const country = operatingCountry.value;

        // ---- timezone -----------------------------------------------------
        const timezone: RegionalValue<string> = tenant?.operatingTimezone
            ? value(String(tenant.operatingTimezone), 'declared', 'tenants.operating_timezone')
            : settingsTimezone
                ? value(settingsTimezone, 'declared', 'settings.timezone')
                : COUNTRY_DEFAULT_TIMEZONE[country]
                    ? value(COUNTRY_DEFAULT_TIMEZONE[country], 'derived', 'operating_country')
                    : value(COUNTRY_DEFAULT_TIMEZONE[PLATFORM_FALLBACK_COUNTRY], 'fallback');

        if (settingsTimezone
            && TIMEZONE_COUNTRY[settingsTimezone]
            && TIMEZONE_COUNTRY[settingsTimezone] !== country) {
            conflicts.push({
                field: 'timezone',
                candidates: [
                    { value: settingsTimezone, from: 'settings.timezone' },
                    { value: COUNTRY_DEFAULT_TIMEZONE[country] || '', from: 'operating_country' },
                ],
                suggested: settingsTimezone,
            });
        }

        // ---- currency -----------------------------------------------------
        const declaredCurrency = normalizeCurrency(tenant?.operatingCurrency);
        const operatingCurrency: RegionalValue<string> = declaredCurrency
            ? value(declaredCurrency, 'declared', 'tenants.operating_currency')
            : COUNTRY_DEFAULT_CURRENCY[country]
                ? value(COUNTRY_DEFAULT_CURRENCY[country], 'derived', 'operating_country')
                : value(COUNTRY_DEFAULT_CURRENCY[PLATFORM_FALLBACK_COUNTRY], 'fallback');

        if (declaredCurrency
            && COUNTRY_DEFAULT_CURRENCY[country]
            && declaredCurrency !== COUNTRY_DEFAULT_CURRENCY[country]) {
            // Legitimate for a dollarised business, so it is surfaced rather
            // than corrected.
            conflicts.push({
                field: 'currency',
                candidates: [
                    { value: declaredCurrency, from: 'tenants.operating_currency' },
                    { value: COUNTRY_DEFAULT_CURRENCY[country], from: 'operating_country' },
                ],
                suggested: declaredCurrency,
            });
        }

        // ---- locale -------------------------------------------------------
        const declaredLocale = typeof tenant?.defaultLocale === 'string' ? tenant.defaultLocale : null;
        const agentLanguage = typeof tenant?.language === 'string' ? tenant.language : null;
        const locale: RegionalValue<string> = declaredLocale
            ? value(declaredLocale, 'declared', 'tenants.default_locale')
            : COUNTRY_DEFAULT_LOCALE[country]
                ? value(COUNTRY_DEFAULT_LOCALE[country], 'derived', 'operating_country')
                : agentLanguage
                    ? value(agentLanguage, 'inferred', 'tenants.language')
                    : value('es-419', 'fallback');

        // `es-CO` is the column default, so an unedited tenant carries it
        // without ever having chosen it. Only a language that disagrees on the
        // BASE language is a real conflict worth a human's time.
        if (agentLanguage
            && !declaredLocale
            && agentLanguage.slice(0, 2) !== locale.value.slice(0, 2)) {
            conflicts.push({
                field: 'locale',
                candidates: [
                    { value: agentLanguage, from: 'tenants.language' },
                    { value: locale.value, from: 'operating_country' },
                ],
                suggested: locale.value,
            });
        }

        // ---- phone region -------------------------------------------------
        const phoneRegion: RegionalValue<string> = normalizeCountry(tenant?.phoneRegion)
            ? value(normalizeCountry(tenant?.phoneRegion)!, 'declared', 'tenants.phone_region')
            : value(country, 'derived', 'operating_country');

        // ---- address schema + form of address ------------------------------
        const addressSchemaId: RegionalValue<string> = tenant?.addressSchemaId
            ? value(String(tenant.addressSchemaId), 'declared', 'tenants.address_schema_id')
            : value(country, 'derived', 'operating_country');

        const addressForm: RegionalValue<AddressForm> = COUNTRY_DEFAULT_ADDRESS_FORM[country]
            ? value(COUNTRY_DEFAULT_ADDRESS_FORM[country], 'derived', 'operating_country')
            : value('usted', 'fallback');

        return {
            version: 1,
            tenantId,
            operatingCountry,
            billingCountry: billingCountry
                ? value(billingCountry, 'declared', 'tenants.billing_country')
                : value(country, 'inferred', 'operating_country'),
            operatingCurrency,
            timezone,
            locale,
            phoneRegion,
            addressSchemaId,
            addressForm,
            countryPackId: String(tenant?.countryPackId || countryPackIdFor(country) || FALLBACK_COUNTRY_PACK_ID),
            countryPackVersion: String(tenant?.countryPackVersion || '1'),
            countryPackStatus: countryPackStatusFor(country),
            conflicts,
            resolvedAt: new Date().toISOString(),
        };
    }

    /**
     * Persist the conflicts this tenant's signals produce.
     *
     * Deliberately does NOT rewrite anything. Guessing an operating country and
     * writing it silently changes the tenant's product — its terminology, its
     * currency, its regulatory sources. Phone numbers are worse still: a
     * "correction" applied to numbers historically normalised to `+57` can merge
     * two different people into one contact, and no undo puts that back.
     */
    async queueConflictsForReview(tenantId: string): Promise<number> {
        const profile = await this.resolve(tenantId);
        if (!profile.conflicts.length) return 0;

        let queued = 0;
        for (const conflict of profile.conflicts) {
            try {
                const existing = await this.prisma.regionalIdentityReview.findFirst({
                    where: { tenantId, field: conflict.field, status: 'pending' },
                    select: { id: true },
                });
                if (existing) {
                    await this.prisma.regionalIdentityReview.update({
                        where: { id: existing.id },
                        data: {
                            candidates: conflict.candidates as any,
                            suggested: conflict.suggested ?? null,
                        },
                    });
                } else {
                    await this.prisma.regionalIdentityReview.create({
                        data: {
                            tenantId,
                            field: conflict.field,
                            candidates: conflict.candidates as any,
                            suggested: conflict.suggested ?? null,
                        },
                    });
                }
                queued++;
            } catch (error: any) {
                this.logger.warn(`[Regional] could not queue ${conflict.field} for ${tenantId}: ${error?.message}`);
            }
        }
        return queued;
    }
}
