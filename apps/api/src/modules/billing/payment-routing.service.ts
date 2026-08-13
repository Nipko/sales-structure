import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import {
    PAYMENT_PROVIDER_NAMES,
    PaymentProviderName,
    isPaymentProviderName,
} from './types/provider-types';
import { providerSupportsCountry } from './adapters/provider-capabilities';
import { normalizeBillingCountry } from './billing-country-config';

/** Wompi payment methods that can be switched on independently once verified in production. */
export interface WompiMethodFlags {
    card: boolean;
    nequi: boolean;
    bancolombiaTransfer: boolean;
}

export interface ProviderRoutingConfig {
    /** L0 — kill switch per provider. Governs NEW acquisitions only. */
    providersEnabled: Record<PaymentProviderName, boolean>;
    /** L1 — default provider per ISO country code, plus the '*' catch-all. */
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
 * switch defaults to disabled for everything except MercadoPago.
 */
export const INTERNAL_RECURRING_ENGINE_AVAILABLE = true;

/**
 * Fail polarity is deliberately ASYMMETRIC.
 *
 * A new provider must never turn itself on because a setting was missing or a
 * JSON blob failed to parse, so everything defaults to OFF. MercadoPago is the
 * exception and defaults to ON: it is the only revenue path that works today,
 * and a Redis hiccup must not stop every tenant from paying.
 */
const DEFAULT_PROVIDERS_ENABLED: Record<PaymentProviderName, boolean> = {
    mercadopago: true,
    stripe: false,
    wompi: false,
    mock: false,
};

const DEFAULT_BY_COUNTRY: Record<string, PaymentProviderName> = {
    '*': 'mercadopago',
};

const DEFAULT_WOMPI_METHODS: WompiMethodFlags = {
    card: true,
    nequi: false,
    bancolombiaTransfer: false,
};

export interface ResolveProviderInput {
    /** Provider frozen on an existing subscription (L3). When present it wins outright. */
    subscriptionProvider?: string | null;
    /** Per-tenant override set by a super admin (L2). */
    tenantProvider?: string | null;
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
 * Decides WHICH payment provider handles a given tenant, and lets a super admin
 * change that decision at runtime — no deploy, no rebuild.
 *
 * Four levels, most specific first:
 *   L3 billing_subscriptions.provider  → frozen for the life of the subscription
 *   L2 tenants.payment_provider        → per-tenant override (audited)
 *   L1 billing.default_provider_by_country
 *   L0 billing.providers_enabled       → kill switch, applied as a filter
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
    ) {}

    // -------------------------------------------------------------------------
    // Config (platform_settings + Redis cache)
    // -------------------------------------------------------------------------

    async getConfig(): Promise<ProviderRoutingConfig> {
        try {
            const cached = await this.redis.getJson<ProviderRoutingConfig>(this.CACHE_KEY);
            if (cached) return cached;
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
            // DB unreachable: keep MercadoPago alive (fail-open) and everything
            // else off (fail-closed). Do NOT cache this degraded answer.
            this.logger.error(`[Billing] Could not read provider routing config: ${err?.message}. Using safe defaults.`);
        }

        return config;
    }

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
                if (country) result[country] = value;
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
                if (!country) {
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
                const caps = this.providerFactory.capabilitiesOf(value);
                if (country !== '*' && !providerSupportsCountry(caps, country)) {
                    throw new BadRequestException({
                        error: 'provider_country_unsupported',
                        message: `${value} cannot bill in ${country}.`,
                    });
                }
                merged[country] = value;
            }
            if (!merged['*']) merged['*'] = 'mercadopago';
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
        if (!isPaymentProviderName(subscriptionProvider)) {
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

        const usable = (name: PaymentProviderName): string | null => {
            if (!this.providerFactory.isRegistered(name)) return 'adapter_not_registered';
            if (!config.providersEnabled[name]) return 'provider_disabled';
            const caps = this.providerFactory.capabilitiesOf(name);
            if (!caps.nativeSubscriptions && !INTERNAL_RECURRING_ENGINE_AVAILABLE) {
                // Would create a tenant that can never be charged.
                return 'recurring_engine_unavailable';
            }
            if (!providerSupportsCountry(caps, country)) return 'country_unsupported';
            return null;
        };

        const candidates: Array<{ name: PaymentProviderName; level: ProviderResolution['level'] }> = [];

        if (isPaymentProviderName(input.tenantProvider)) {
            candidates.push({ name: input.tenantProvider, level: 'tenant' });
        }
        if (country && isPaymentProviderName(config.defaultByCountry[country])) {
            candidates.push({ name: config.defaultByCountry[country], level: 'country' });
        }
        if (isPaymentProviderName(config.defaultByCountry['*'])) {
            candidates.push({ name: config.defaultByCountry['*'], level: 'fallback' });
        }

        let firstBlocked: { name: PaymentProviderName; reason: string } | null = null;
        for (const candidate of candidates) {
            const blocked = usable(candidate.name);
            if (!blocked) {
                return {
                    provider: candidate.name,
                    level: candidate.level,
                    substituted: Boolean(firstBlocked),
                    reason: firstBlocked ? `${firstBlocked.name}:${firstBlocked.reason}` : undefined,
                };
            }
            if (!firstBlocked) firstBlocked = { name: candidate.name, reason: blocked };
        }

        // Nothing preferred is usable — take the first enabled provider that can
        // bill this country rather than failing the signup outright.
        for (const name of PAYMENT_PROVIDER_NAMES) {
            if (!usable(name)) {
                this.logger.warn(
                    `[Billing] Falling over to ${name} for country ${country ?? '(unknown)'}${input.tenantId ? ` (tenant ${input.tenantId})` : ''}`,
                );
                return {
                    provider: name,
                    level: 'failover',
                    substituted: true,
                    reason: firstBlocked ? `${firstBlocked.name}:${firstBlocked.reason}` : 'no_preferred_provider',
                };
            }
        }

        // Never fall back to a silent default: charging through the wrong
        // provider is worse than refusing the acquisition.
        throw new BadRequestException({
            error: 'no_payment_provider_available',
            message: country
                ? `No payment provider is currently enabled for country ${country}.`
                : 'No payment provider is currently enabled.',
            billingCountry: country ?? null,
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
        if (!providerSupportsCountry(caps, country)) {
            throw new BadRequestException({
                error: 'provider_country_unsupported',
                message: `Payment provider ${provider} cannot bill in ${country ?? '(unknown country)'}.`,
                providerName: provider,
                billingCountry: country ?? null,
            });
        }
    }
}
