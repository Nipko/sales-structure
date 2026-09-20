import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import {
    PAYMENT_PROVIDER_NAMES,
    PaymentProviderName,
    isPaymentProviderName,
    isLegacyPaymentProviderName,
} from './types/provider-types';
import { providerSupportsCountry } from './adapters/provider-capabilities';
import { normalizeBillingCountry } from './billing-country-config';
import { WompiConfigService } from './adapters/wompi-config.service';
import { StripeConfigService } from './adapters/stripe-config.service';
import { isSupportedBillingCountry } from '../../common/utils/billing-country.util';

/** Wompi payment methods that can be switched on independently once verified in production. */
export interface WompiMethodFlags {
    card: boolean;
    nequi: boolean;
    bancolombiaTransfer: boolean;
}

export interface ProviderRoutingConfig {
    /** L0 — kill switch per provider. Governs NEW acquisitions only. */
    providersEnabled: Record<PaymentProviderName, boolean>;
    /** Market policy: CO uses Wompi; all other recognized countries use Stripe. */
    defaultByCountry: Record<string, PaymentProviderName>;
    /** Which Wompi methods the checkout may offer. */
    wompiMethods: WompiMethodFlags;
}

/**
 * Partial update. `defaultByCountry` accepts `null` as an explicit DELETE of a
 * country rule — without it a merge could only ever add rules, and an operator
 * who removed a row in the UI would watch it reappear on the next refresh.
 */
export interface ProviderRoutingPatch {
    providersEnabled?: Partial<Record<PaymentProviderName, boolean>>;
    defaultByCountry?: Record<string, PaymentProviderName | null>;
    wompiMethods?: Partial<WompiMethodFlags>;
}

const SETTING_PROVIDERS_ENABLED = 'billing.providers_enabled';
const SETTING_DEFAULT_BY_COUNTRY = 'billing.default_provider_by_country';
const SETTING_WOMPI_METHODS = 'billing.wompi_methods_enabled';

/**
 * Whether OUR recurring billing engine (scheduler + retries + dunning) exists.
 *
 * Providers without native subscriptions can only bill through that engine, so
 * while it did not exist, routing an acquisition to one of them produced a
 * tenant that could never be charged: the trial started fine and then every path
 * to pay refused, surfacing a month later one tenant at a time.
 *
 * The engine now ships complete — scheduling, charging, polling, dunning,
 * reconciliation, stored payment methods and proration — so the switch accepts
 * these providers. They still stay OFF until an operator enables them: the kill
 * switch defaults to disabled for everything except Wompi.
 */
export const INTERNAL_RECURRING_ENGINE_AVAILABLE = true;

/**
 * Fail polarity is deliberately ASYMMETRIC.
 *
 * A new provider must never turn itself on because a setting was missing or a
 * JSON blob failed to parse, so everything defaults to OFF. Wompi is the
 * exception and defaults to ON: it is the only revenue path that exists — a
 * Redis hiccup must not stop every Colombian tenant from paying. These defaults
 * are the posture the system takes when it cannot read its configuration, so
 * they must always describe the desired steady state.
 *
 * MercadoPago no aparece: está RETIRADO como PSP de plataforma (decisión del
 * dueño, ago 2026 — el collector nunca salió de non_compliant). No es ruteable
 * ni habilitable; el literal sobrevive solo para leer filas históricas. La
 * cuenta MP del TENANT (enlaces de pago a sus clientes) vive en
 * modules/tenant-payments y no pasa por este switch.
 */
const DEFAULT_PROVIDERS_ENABLED: Record<PaymentProviderName, boolean> = {
    mercadopago: false,
    stripe: false,
    wompi: true,
    mock: false,
};

/**
 * New subscriptions have a fixed market partition. Country rules and tenant
 * pins cannot send Colombia to Stripe or international customers to Wompi.
 */
const DEFAULT_BY_COUNTRY: Record<string, PaymentProviderName> = {
    CO: 'wompi',
    '*': 'stripe',
};

/**
 * Card is the only method enabled by default. Nequi and Botón Bancolombia are
 * implemented end to end, but remain behind independent flags until the merchant
 * activation and a real production smoke test for each method have passed.
 */
const DEFAULT_WOMPI_METHODS: WompiMethodFlags = {
    card: true,
    nequi: false,
    bancolombiaTransfer: false,
};

export interface ResolveProviderInput {
    /** Provider frozen on an existing subscription (L3). When present it wins outright. */
    subscriptionProvider?: string | null;
    /**
     * Legacy per-tenant pin. Honored only when it agrees with the country
     * partition; existing subscriptions keep their original provider separately.
     */
    tenantOverride?: string | null;
    /** Tenant billing country, used for the L1 default and to reject providers that cannot bill there. */
    billingCountry?: string | null;
    /** Set for diagnostics only. */
    tenantId?: string;
}

export interface ProviderResolution {
    provider: PaymentProviderName;
    /** Which level decided, for logging and for the admin UI. */
    level: 'subscription' | 'tenant' | 'country' | 'fallback' | 'failover';
    /** True when the preferred provider was skipped because it was disabled or cannot bill the country. */
    substituted: boolean;
    reason?: string;
}

/**
 * Keeps new Colombian subscriptions on Wompi and international subscriptions
 * on Stripe. Runtime kill switches can close a rail, never substitute the other.
 * Existing subscriptions retain their immutable provider.
 *
 * Scope note: L0 gates NEW acquisitions only. Disabling a provider must never
 * stop us from processing webhooks, reconciling, or charging subscriptions that
 * already live there — that would silently drop real money.
 */
@Injectable()
export class PaymentRoutingService {
    private readonly logger = new Logger(PaymentRoutingService.name);
    private readonly CACHE_KEY = 'billing:provider_routing';
    private readonly CACHE_TTL = 300; // 5 minutes, same as the fiscal config

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly providerFactory: PaymentProviderFactory,
        private readonly wompiConfig: WompiConfigService,
        private readonly stripeConfig: StripeConfigService,
    ) {}

    // -------------------------------------------------------------------------
    // Config (platform_settings + Redis cache)
    // -------------------------------------------------------------------------

    async getConfig(): Promise<ProviderRoutingConfig> {
        try {
            const cached = await this.redis.getJson<ProviderRoutingConfig>(this.CACHE_KEY);
            if (cached) return {
                ...cached,
                defaultByCountry: this.parseDefaultByCountry(JSON.stringify(cached.defaultByCountry)),
            };
        } catch {
            // Cache read failures fall through to the DB — never to a wrong default.
        }

        let config: ProviderRoutingConfig = {
            providersEnabled: { ...DEFAULT_PROVIDERS_ENABLED },
            defaultByCountry: { ...DEFAULT_BY_COUNTRY },
            wompiMethods: { ...DEFAULT_WOMPI_METHODS },
        };

        try {
            const rows = await this.prisma.$queryRaw<any[]>`
                SELECT key, value FROM platform_settings WHERE key LIKE 'billing.%'
            `;
            const map = new Map<string, string>(rows.map((r: any) => [String(r.key), String(r.value ?? '')]));
            config = {
                providersEnabled: this.parseProvidersEnabled(map.get(SETTING_PROVIDERS_ENABLED)),
                defaultByCountry: this.parseDefaultByCountry(map.get(SETTING_DEFAULT_BY_COUNTRY)),
                wompiMethods: this.parseWompiMethods(map.get(SETTING_WOMPI_METHODS)),
            };
            await this.redis.setJson(this.CACHE_KEY, config, this.CACHE_TTL).catch(() => undefined);
        } catch (err: any) {
            // DB unreachable: use the fail-safe defaults above (Wompi is the only
            // platform rail). Do NOT cache this degraded answer.
            this.logger.error(`[Billing] Could not read provider routing config: ${err?.message}. Using safe defaults.`);
        }

        return config;
    }

    // Ambos parsers iteran SOLO los nombres ruteables: una fila guardada antes
    // del retiro de MercadoPago ('mercadopago':true, '*':'mercadopago') se
    // ignora al leer y cae al default. Así el retiro no depende de que la
    // migración de datos haya corrido — la config vieja simplemente deja de
    // poder nombrar al proveedor retirado.
    private parseProvidersEnabled(raw?: string): Record<PaymentProviderName, boolean> {
        const result = { ...DEFAULT_PROVIDERS_ENABLED };
        if (!raw || !raw.trim()) return result;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return result;
            for (const name of PAYMENT_PROVIDER_NAMES) {
                if (typeof parsed[name] === 'boolean') result[name] = parsed[name];
            }
        } catch {
            this.logger.warn(`${SETTING_PROVIDERS_ENABLED} is not valid JSON — using safe defaults`);
        }
        return result;
    }

    private parseDefaultByCountry(raw?: string): Record<string, PaymentProviderName> {
        const result = { ...DEFAULT_BY_COUNTRY };
        if (!raw || !raw.trim()) return result;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return result;
            for (const [key, value] of Object.entries(parsed)) {
                if (!isPaymentProviderName(value)) continue;
                const country = key === '*' ? '*' : normalizeBillingCountry(key);
                const expected = country === 'CO' ? 'wompi' : 'stripe';
                if (country && (country === '*' || isSupportedBillingCountry(country)) && value === expected) {
                    result[country] = value;
                }
            }
        } catch {
            this.logger.warn(`${SETTING_DEFAULT_BY_COUNTRY} is not valid JSON — using safe defaults`);
        }
        return result;
    }

    private parseWompiMethods(raw?: string): WompiMethodFlags {
        const result = { ...DEFAULT_WOMPI_METHODS };
        if (!raw || !raw.trim()) return result;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return result;
            if (typeof parsed.card === 'boolean') result.card = parsed.card;
            if (typeof parsed.nequi === 'boolean') result.nequi = parsed.nequi;
            if (typeof parsed.bancolombiaTransfer === 'boolean') result.bancolombiaTransfer = parsed.bancolombiaTransfer;
            // Tolerate the snake_case spelling used in the Wompi docs.
            if (typeof parsed.bancolombia_transfer === 'boolean') result.bancolombiaTransfer = parsed.bancolombia_transfer;
        } catch {
            this.logger.warn(`${SETTING_WOMPI_METHODS} is not valid JSON — using safe defaults`);
        }
        return result;
    }

    /**
     * Read straight from the database, no cache and no safe-default fallback.
     *
     * A WRITE must never merge onto guessed values: if the SELECT failed
     * transiently, `getConfig()` would hand back the defaults, and persisting a
     * partial patch on top of them would quietly re-enable MercadoPago and
     * disable everything else — overwriting the real configuration.
     */
    private async getConfigStrict(): Promise<ProviderRoutingConfig> {
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT key, value FROM platform_settings WHERE key LIKE 'billing.%'
        `;
        const map = new Map<string, string>(rows.map((r: any) => [String(r.key), String(r.value ?? '')]));
        return {
            providersEnabled: this.parseProvidersEnabled(map.get(SETTING_PROVIDERS_ENABLED)),
            defaultByCountry: this.parseDefaultByCountry(map.get(SETTING_DEFAULT_BY_COUNTRY)),
            wompiMethods: this.parseWompiMethods(map.get(SETTING_WOMPI_METHODS)),
        };
    }

    /** Persist a partial routing config and invalidate the cache immediately. */
    async updateConfig(patch: ProviderRoutingPatch): Promise<ProviderRoutingConfig> {
        const current = await this.getConfigStrict();
        const updates: Record<string, string> = {};

        if (patch.providersEnabled) {
            const merged = { ...current.providersEnabled };
            for (const name of PAYMENT_PROVIDER_NAMES) {
                const value = patch.providersEnabled[name];
                if (typeof value === 'boolean') {
                    if (value && !INTERNAL_RECURRING_ENGINE_AVAILABLE) {
                        const caps = this.providerFactory.capabilitiesOf(name);
                        if (!caps.nativeSubscriptions) {
                            // Fail here, loudly, instead of letting acquisitions
                            // through to a provider that cannot renew them.
                            throw new BadRequestException({
                                error: 'recurring_engine_unavailable',
                                message: `${name} has no native subscriptions and the internal recurring engine is not available yet, so it cannot take new subscriptions. Enabling it would create tenants that can never be charged.`,
                                providerName: name,
                            });
                        }
                    }
                    merged[name] = value;
                }
            }
            // 'mock' bypasses signature verification — it must never be routable in production.
            if (process.env.NODE_ENV === 'production') merged.mock = false;
            updates[SETTING_PROVIDERS_ENABLED] = JSON.stringify(merged);
        }

        if (patch.defaultByCountry) {
            const merged = { ...current.defaultByCountry };
            for (const [key, value] of Object.entries(patch.defaultByCountry)) {
                const country = key === '*' ? '*' : normalizeBillingCountry(key);
                if (!country || (country !== '*' && !isSupportedBillingCountry(country))) {
                    throw new BadRequestException({ error: 'invalid_country', message: `Invalid country code: ${key}` });
                }
                if (value === null) {
                    // Explicit delete: the country falls back to the catch-all.
                    if (country === '*') {
                        throw new BadRequestException({
                            error: 'catch_all_required',
                            message: 'The "*" fallback cannot be removed — every country must resolve to a provider.',
                        });
                    }
                    delete merged[country];
                    continue;
                }
                if (!isPaymentProviderName(value)) {
                    throw new BadRequestException({
                        error: 'unknown_payment_provider',
                        message: `Unknown provider '${value}' for country ${country}.`,
                    });
                }
                if (value !== (country === 'CO' ? 'wompi' : 'stripe')) {
                    throw new BadRequestException({
                        error: 'provider_country_unsupported',
                        message: 'Colombia uses Wompi; international subscriptions use Stripe.',
                    });
                }
                const caps = this.providerFactory.capabilitiesOf(value);
                if (country !== '*' && !providerSupportsCountry(caps, country)) {
                    throw new BadRequestException({
                        error: 'provider_country_unsupported',
                        message: `${value} cannot bill in ${country}.`,
                    });
                }
                merged[country] = value;
            }
            // Persist the same partition the acquisition resolver enforces.
            merged.CO = 'wompi';
            merged['*'] = 'stripe';
            updates[SETTING_DEFAULT_BY_COUNTRY] = JSON.stringify(merged);
        }

        if (patch.wompiMethods) {
            const merged = { ...current.wompiMethods, ...patch.wompiMethods };
            updates[SETTING_WOMPI_METHODS] = JSON.stringify(merged);
        }

        for (const [key, value] of Object.entries(updates)) {
            await this.prisma.$executeRaw`
                INSERT INTO platform_settings (key, value, category, updated_at)
                VALUES (${key}, ${value}, 'billing', NOW())
                ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
            `;
        }

        await this.redis.del(this.CACHE_KEY).catch(() => undefined);
        this.logger.log(`[Billing] Provider routing updated (${Object.keys(updates).length} keys)`);
        return this.getConfig();
    }

    /** Drop the cached routing config (used after a direct settings write). */
    async invalidate(): Promise<void> {
        await this.redis.del(this.CACHE_KEY).catch(() => undefined);
    }

    // -------------------------------------------------------------------------
    // Resolution
    // -------------------------------------------------------------------------

    /**
     * Resolve the provider for an operation on an EXISTING subscription.
     * The provider a subscription was created with is frozen for its lifetime:
     * its ids, its stored payment source and its webhooks only mean something at
     * that provider. The kill switch does not apply here on purpose.
     */
    resolveForSubscription(subscriptionProvider: string | null | undefined): PaymentProviderName {
        // Se valida contra los nombres LEGADOS, no contra los ruteables: una
        // suscripción vieja de un proveedor retirado no es un dato corrupto, y
        // sus lecturas (estado, historial, cancelación) tienen que funcionar.
        if (!isLegacyPaymentProviderName(subscriptionProvider)) {
            throw new BadRequestException({
                error: 'unknown_payment_provider',
                message: `Subscription references unknown provider '${subscriptionProvider ?? '(none)'}'.`,
            });
        }
        return subscriptionProvider;
    }

    /**
     * Resolve the provider for a NEW acquisition (trial start, first paid plan).
     * This is where the country partitioning and the kill switch apply.
     */
    async resolveForNewSubscription(input: ResolveProviderInput): Promise<ProviderResolution> {
        const config = await this.getConfig();
        const country = normalizeBillingCountry(input.billingCountry);
        if (!country || !isSupportedBillingCountry(country)) {
            throw new BadRequestException({ error: 'invalid_billing_country', billingCountry: country });
        }

        const usable = (name: PaymentProviderName): string | null => {
            if (!this.providerFactory.isRegistered(name)) return 'adapter_not_registered';
            if (!config.providersEnabled[name]) return 'provider_disabled';
            // A runtime switch is intent, not readiness. Advertising Wompi with
            // a missing/partial/mixed quartet sends onboarding through expensive
            // tenant provisioning only to fail at the final billing write.
            if (name === 'wompi' && !this.wompiConfig.isConfigured()) {
                return 'provider_not_configured';
            }
            if (name === 'stripe' && !this.stripeConfig.isConfigured) {
                return 'provider_not_configured';
            }
            const caps = this.providerFactory.capabilitiesOf(name);
            if (!caps.nativeSubscriptions && !INTERNAL_RECURRING_ENGINE_AVAILABLE) {
                // Would create a tenant that can never be charged.
                return 'recurring_engine_unavailable';
            }
            if (!providerSupportsCountry(caps, country)) return 'country_unsupported';
            return null;
        };

        const requiredProvider = country === 'CO' ? 'wompi' : 'stripe';
        const blocked = usable(requiredProvider);
        if (!blocked) {
            const ignoredOverride = !!input.tenantOverride && input.tenantOverride !== requiredProvider;
            return {
                provider: requiredProvider,
                level: input.tenantOverride === requiredProvider ? 'tenant' : 'country',
                substituted: ignoredOverride,
                reason: ignoredOverride ? `${input.tenantOverride}:country_policy` : undefined,
            };
        }

        // Never fall back to a silent default: charging through the wrong
        // provider is worse than refusing the acquisition.
        throw new BadRequestException({
            error: 'no_payment_provider_available',
            message: country
                ? `No payment provider is currently enabled for country ${country}.`
                : 'No payment provider is currently enabled.',
            billingCountry: country ?? null,
            providerName: requiredProvider,
            reason: blocked,
        });
    }

    /** Guard for entry points: refuse a provider that is off or cannot bill the country. */
    async assertUsableForNewSubscription(
        provider: PaymentProviderName,
        billingCountry?: string | null,
    ): Promise<void> {
        const config = await this.getConfig();
        if (!config.providersEnabled[provider]) {
            throw new BadRequestException({
                error: 'provider_disabled',
                message: `Payment provider ${provider} is currently disabled for new subscriptions.`,
                providerName: provider,
            });
        }
        const caps = this.providerFactory.capabilitiesOf(provider);
        if (!caps.nativeSubscriptions && !INTERNAL_RECURRING_ENGINE_AVAILABLE) {
            throw new BadRequestException({
                error: 'recurring_engine_unavailable',
                message: `${provider} can only bill through the internal recurring engine, which is not available yet.`,
                providerName: provider,
            });
        }
        const country = normalizeBillingCountry(billingCountry);
        if (!country || !isSupportedBillingCountry(country)
            || provider !== (country === 'CO' ? 'wompi' : 'stripe')
            || !providerSupportsCountry(caps, country)) {
            throw new BadRequestException({
                error: 'provider_country_unsupported',
                message: `Payment provider ${provider} cannot bill in ${country ?? '(unknown country)'}.`,
                providerName: provider,
                billingCountry: country ?? null,
            });
        }
        if (!this.providerFactory.isRegistered(provider)
            || (provider === 'wompi' && !this.wompiConfig.isConfigured())
            || (provider === 'stripe' && !this.stripeConfig.isConfigured)) {
            throw new BadRequestException({ error: 'provider_not_configured', providerName: provider });
        }
    }
}
