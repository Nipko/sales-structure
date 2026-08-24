import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    AddressForm,
    COUNTRY_DEFAULT_ADDRESS_FORM,
    COUNTRY_DEFAULT_CURRENCY,
    COUNTRY_DEFAULT_LOCALE,
    COUNTRY_DEFAULT_TIMEZONE,
    FALLBACK_COUNTRY_PACK_ID,
    PLATFORM_FALLBACK_COUNTRY,
    RegionalConflict,
    RegionalValue,
    RegionalValueSource,
    TenantRegionalProfileV1,
    countryPackIdFor,
    countryPackStatusFor,
    packForCountry,
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

/**
 * Qué columna escribe cada campo revisable, y cómo se valida su valor.
 *
 * Explícito y no derivado del nombre: `timezone` vive en `operating_timezone`
 * y `currency` en `operating_currency`, y una convención implícita que
 * "casi siempre" acierta es la que un día escribe la columna equivocada.
 */
const REVIEW_FIELD_COLUMN: Readonly<Record<string, {
    field: string;
    normalize: (value: string) => string | null;
}>> = Object.freeze({
    operating_country: {
        field: 'operatingCountry',
        normalize: (v) => (/^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null),
    },
    phone_region: {
        field: 'phoneRegion',
        normalize: (v) => (/^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null),
    },
    currency: {
        field: 'operatingCurrency',
        normalize: (v) => (/^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null),
    },
    timezone: {
        field: 'operatingTimezone',
        // Se valida contra la base de zonas del runtime, no contra una lista
        // propia que quedaría vieja con cada release de tzdata.
        normalize: (v) => {
            if (!v || v.length > 64) return null;
            try {
                new Intl.DateTimeFormat('en', { timeZone: v });
                return v;
            } catch {
                return null;
            }
        },
    },
    locale: {
        field: 'defaultLocale',
        normalize: (v) => (/^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})*$/.test(v) && v.length <= 35 ? v : null),
    },
});

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
        // `businessHours.timezone` entra a la precedencia porque los tres
        // servicios de citas ya lo leían por su cuenta. Sin él acá, centralizar
        // la resolución le habría CAMBIADO la zona a todo tenant que la tenía
        // cargada sólo ahí — un arreglo que rompe lo que venía funcionando.
        // Es `inferred`: el dueño configuró cuándo atiende, no dónde opera.
        const businessHoursTimezone = typeof settings.businessHours?.timezone === 'string'
            ? settings.businessHours.timezone
            : null;
        const timezone: RegionalValue<string> = tenant?.operatingTimezone
            ? value(String(tenant.operatingTimezone), 'declared', 'tenants.operating_timezone')
            : settingsTimezone
                ? value(settingsTimezone, 'declared', 'settings.timezone')
                : businessHoursTimezone
                    ? value(businessHoursTimezone, 'inferred', 'settings.businessHours.timezone')
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
        const languagePack = packForCountry(country);

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
            preferredTerms: languagePack?.preferredTerms
                ? Object.freeze({ ...languagePack.preferredTerms })
                : undefined,
            prohibitedRegisters: languagePack?.prohibitedRegisters
                ? Object.freeze([...languagePack.prohibitedRegisters])
                : undefined,
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

    /**
     * La zona horaria del negocio, resuelta en UN solo lugar.
     *
     * Estaba copiada en tres servicios de citas con **órdenes distintos**:
     * notificaciones probaba `settings.timezone` antes que las horas de
     * atención y recordatorios lo hacía al revés. El mismo tenant con las dos
     * cosas cargadas recibía el recordatorio calculado en una zona y el mensaje
     * de confirmación escrito en otra — y nadie lo veía, porque cada servicio
     * era coherente consigo mismo. Ninguna de las tres miraba la columna
     * declarada, y las tres terminaban en un `'America/Bogota'` literal.
     *
     * Acá la precedencia es una sola y la declarada gana.
     */
    async timezoneFor(tenantId: string): Promise<string> {
        const profile = await this.resolve(tenantId).catch(() => null);
        return profile?.timezone?.value || COUNTRY_DEFAULT_TIMEZONE[PLATFORM_FALLBACK_COUNTRY];
    }

    /** Igual, para los llamadores que sólo tienen el nombre del schema. */
    async timezoneForSchema(schemaName: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName },
                select: { id: true },
            });
            if (tenant?.id) return this.timezoneFor(tenant.id);
        } catch (error: any) {
            this.logger.warn(`[Regional] timezone por schema falló (${schemaName}): ${error?.message}`);
        }
        return COUNTRY_DEFAULT_TIMEZONE[PLATFORM_FALLBACK_COUNTRY];
    }

    /** Las revisiones abiertas, más el perfil que las produjo. */
    async listReviews(tenantId: string, status: 'pending' | 'resolved' | 'all' = 'pending') {
        const where: any = { tenantId };
        if (status !== 'all') where.status = status;
        return this.prisma.regionalIdentityReview.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
    }

    /**
     * Resolver una revisión ESCRIBE el valor declarado.
     *
     * Es la mitad que faltaba, y sin ella todo lo demás era decorativo: el
     * perfil detectaba los conflictos, la tabla los podía guardar y **nada**
     * podía convertir una decisión del dueño en la columna `declared` que el
     * resto del sistema lee. La rama `declared` era inalcanzable, así que el
     * país siempre venía inferido o de fallback — y un `fallback` es lo que
     * hace que un teléfono no se normalice y que el agente hable en la moneda
     * equivocada.
     *
     * Cada campo escribe SU columna. Nada se deduce de nada: elegir el país no
     * cambia la moneda por su cuenta, porque un negocio colombiano que cobra en
     * dólares existe y "corregirlo" le cambiaría los precios.
     */
    async resolveReview(
        tenantId: string,
        reviewId: string,
        input: { value: string; resolvedBy: string },
    ): Promise<{ field: string; value: string }> {
        const review = await this.prisma.regionalIdentityReview.findFirst({
            where: { id: reviewId, tenantId },
        });
        if (!review) throw new NotFoundException('Revisión regional no encontrada');
        if (review.status !== 'pending') {
            throw new BadRequestException('Esa revisión ya fue resuelta');
        }

        const value = String(input.value || '').trim();
        if (!value) throw new BadRequestException('Hay que elegir un valor');

        // Sólo se acepta uno de los candidatos que el sistema detectó. Un campo
        // libre acá sería otra puerta para escribir la identidad regional sin
        // que nadie mire, que es de donde vino el problema.
        const candidates = Array.isArray(review.candidates)
            ? (review.candidates as any[]).map(c => String(c?.value || ''))
            : [];
        if (candidates.length && !candidates.includes(value)) {
            throw new BadRequestException(
                `"${value}" no es uno de los valores detectados (${candidates.join(', ')})`,
            );
        }

        const column = REVIEW_FIELD_COLUMN[review.field];
        if (!column) throw new BadRequestException(`Campo regional desconocido: ${review.field}`);

        const normalized = column.normalize(value);
        if (!normalized) {
            throw new BadRequestException(`"${value}" no es un valor válido para ${review.field}`);
        }

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { [column.field]: normalized } as any,
        });
        await this.prisma.regionalIdentityReview.update({
            where: { id: reviewId },
            data: {
                status: 'resolved',
                resolvedBy: input.resolvedBy,
                resolvedAt: new Date(),
            },
        });
        // El perfil cacheado todavía dice lo viejo.
        await this.invalidate(tenantId);
        this.logger.log(
            `[Regional] ${review.field} declarado como ${normalized} para ${tenantId} por ${input.resolvedBy}`,
        );
        return { field: review.field, value: normalized };
    }

    /**
     * Declarar un valor regional sin que haya un conflicto detectado.
     *
     * Un tenant sin conflictos igual puede no haber declarado nada: sus señales
     * coinciden porque hay una sola, o porque no hay ninguna y todo cae a
     * fallback. Ese caso —el más común— no produce revisión, y sin esta puerta
     * seguiría sin poder declarar su país.
     */
    async declare(
        tenantId: string,
        field: string,
        value: string,
        declaredBy: string,
    ): Promise<{ field: string; value: string }> {
        const column = REVIEW_FIELD_COLUMN[field];
        if (!column) throw new BadRequestException(`Campo regional desconocido: ${field}`);
        const normalized = column.normalize(String(value || '').trim());
        if (!normalized) throw new BadRequestException(`"${value}" no es un valor válido para ${field}`);

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { [column.field]: normalized } as any,
        });
        // Un conflicto abierto sobre ese mismo campo queda contestado.
        await this.prisma.regionalIdentityReview.updateMany({
            where: { tenantId, field, status: 'pending' },
            data: { status: 'resolved', resolvedBy: declaredBy, resolvedAt: new Date() },
        });
        await this.invalidate(tenantId);
        this.logger.log(`[Regional] ${field} declarado como ${normalized} para ${tenantId}`);
        return { field, value: normalized };
    }
}
