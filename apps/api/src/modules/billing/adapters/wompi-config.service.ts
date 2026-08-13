import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export type WompiEnvironment = 'sandbox' | 'production' | 'unconfigured';

const SANDBOX_BASE_URL = 'https://sandbox.wompi.co/v1';
const PRODUCTION_BASE_URL = 'https://production.wompi.co/v1';

/**
 * Wompi credentials and environment resolution.
 *
 * Wompi issues FOUR secrets per environment, each with a different job:
 *   pub_*        publishable key — browser tokenization + public reads
 *   prv_*        private key — payment sources, charges, voids
 *   *_events_*   verifies the SHA-256 checksum of incoming webhooks
 *   *_integrity_ signs every outgoing transaction
 *
 * The environment is derived from the KEY PREFIX rather than from a separate
 * env var, so a test key can never be pointed at the production API by
 * misconfiguration. Mismatched prefixes are refused outright.
 *
 * Like the MercadoPago config service, a missing credential logs a warning and
 * lets the app boot: dev environments that do not care about billing still run,
 * and the routing layer keeps the provider unroutable until it is configured.
 */
@Injectable()
export class WompiConfigService implements OnModuleInit {
    private readonly logger = new Logger(WompiConfigService.name);

    private _publicKey?: string;
    private _privateKey?: string;
    private _eventsSecret?: string;
    private _integritySecret?: string;
    private _environment: WompiEnvironment = 'unconfigured';
    private _misconfigured = false;

    onModuleInit() {
        this._publicKey = process.env.WOMPI_PUBLIC_KEY?.trim() || undefined;
        this._privateKey = process.env.WOMPI_PRIVATE_KEY?.trim() || undefined;
        this._eventsSecret = process.env.WOMPI_EVENTS_SECRET?.trim() || undefined;
        this._integritySecret = process.env.WOMPI_INTEGRITY_SECRET?.trim() || undefined;

        if (!this._publicKey && !this._privateKey) {
            this.logger.warn('WOMPI_* keys are not set — the Wompi adapter will refuse any real call');
            return;
        }

        const envs = [
            this.environmentOfKey(this._publicKey, 'pub_'),
            this.environmentOfKey(this._privateKey, 'prv_'),
            this.environmentOfEventKey(this._eventsSecret),
            this.environmentOfEventKey(this._integritySecret),
        ].filter((e): e is Exclude<WompiEnvironment, 'unconfigured'> => e !== 'unconfigured');

        const distinct = Array.from(new Set(envs));
        if (distinct.length > 1) {
            // Mixing a sandbox key with a production one would charge real money
            // from a test flow (or silently fail every signature). Refuse both.
            this._misconfigured = true;
            this._environment = 'unconfigured';
            this.logger.error(
                `Wompi keys mix environments (${distinct.join(' + ')}) — the adapter is disabled until they all match`,
            );
            return;
        }

        if (!distinct.length) {
            this._environment = 'unconfigured';
            this.logger.warn('Wompi keys have an unrecognized prefix — cannot determine the environment');
            return;
        }
        this._environment = distinct[0];

        const missing = [
            !this._publicKey && 'WOMPI_PUBLIC_KEY',
            !this._privateKey && 'WOMPI_PRIVATE_KEY',
            !this._eventsSecret && 'WOMPI_EVENTS_SECRET',
            !this._integritySecret && 'WOMPI_INTEGRITY_SECRET',
        ].filter(Boolean);
        if (missing.length) {
            this.logger.warn(`Wompi is partially configured (${this._environment}); missing: ${missing.join(', ')}`);
        } else {
            this.logger.log(`Wompi initialised in ${this._environment} mode`);
        }
    }

    private environmentOfKey(key: string | undefined, prefix: string): WompiEnvironment {
        if (!key) return 'unconfigured';
        if (key.startsWith(`${prefix}test_`)) return 'sandbox';
        if (key.startsWith(`${prefix}prod_`)) return 'production';
        return 'unconfigured';
    }

    /** Event/integrity secrets carry the environment FIRST: `test_events_…`, `prod_integrity_…`. */
    private environmentOfEventKey(key: string | undefined): WompiEnvironment {
        if (!key) return 'unconfigured';
        if (key.startsWith('test_')) return 'sandbox';
        if (key.startsWith('prod_')) return 'production';
        return 'unconfigured';
    }

    /** True when charges can actually be executed (private key + integrity secret + a known environment). */
    isConfigured(): boolean {
        return !this._misconfigured
            && this._environment !== 'unconfigured'
            && Boolean(this._privateKey && this._integritySecret);
    }

    /** True when incoming webhooks can be verified. Separate from isConfigured: reading events needs only the events secret. */
    canVerifyWebhooks(): boolean {
        return !this._misconfigured && Boolean(this._eventsSecret);
    }

    environment(): WompiEnvironment {
        return this._environment;
    }

    /** The API base URL is derived from the keys, never configured independently. */
    get baseUrl(): string {
        return this._environment === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
    }

    get publicKey(): string | undefined {
        return this._publicKey;
    }

    get privateKey(): string {
        this.requireConfigured();
        return this._privateKey!;
    }

    get integritySecret(): string {
        this.requireConfigured();
        return this._integritySecret!;
    }

    get eventsSecret(): string | undefined {
        return this._eventsSecret;
    }

    private requireConfigured(): void {
        if (!this.isConfigured()) {
            throw new Error(
                'Wompi is not configured. Set WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_EVENTS_SECRET and WOMPI_INTEGRITY_SECRET from the same environment.',
            );
        }
    }
}
