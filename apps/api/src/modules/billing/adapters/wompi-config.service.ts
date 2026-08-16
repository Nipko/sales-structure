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
 * A missing credential logs a warning and lets the app boot: dev environments
 * that do not care about billing still run, while the routing layer keeps the
 * provider unroutable until the complete quartet is configured.
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

        if (!this._publicKey && !this._privateKey && !this._eventsSecret && !this._integritySecret) {
            this.logger.warn('WOMPI_* keys are not set — the Wompi adapter will refuse any real call');
            return;
        }

        const credentials = [
            { name: 'WOMPI_PUBLIC_KEY', value: this._publicKey, testPrefix: 'pub_test_', prodPrefix: 'pub_prod_' },
            { name: 'WOMPI_PRIVATE_KEY', value: this._privateKey, testPrefix: 'prv_test_', prodPrefix: 'prv_prod_' },
            { name: 'WOMPI_EVENTS_SECRET', value: this._eventsSecret, testPrefix: 'test_events_', prodPrefix: 'prod_events_' },
            { name: 'WOMPI_INTEGRITY_SECRET', value: this._integritySecret, testPrefix: 'test_integrity_', prodPrefix: 'prod_integrity_' },
        ];
        const resolved = credentials.map((credential) => ({
            ...credential,
            environment: this.environmentOfCredential(
                credential.value,
                credential.testPrefix,
                credential.prodPrefix,
            ),
        }));

        const invalid = resolved.filter((credential) => credential.value && credential.environment === 'unconfigured');
        if (invalid.length) {
            this._misconfigured = true;
            this._environment = 'unconfigured';
            this.logger.error(
                `Wompi credentials have an invalid role/prefix (${invalid.map((item) => item.name).join(', ')}) — adapter disabled`,
            );
            return;
        }

        const envs = resolved
            .map((credential) => credential.environment)
            .filter((e): e is Exclude<WompiEnvironment, 'unconfigured'> => e !== 'unconfigured');

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

        // `NODE_ENV=production` is where paid entitlements live. Accepting a
        // complete test quartet there would make sandbox approvals unlock real
        // tenant plans. Keep isolated production-mode staging possible only via
        // an explicit, conspicuous opt-in; the production deploy never sets it.
        if (
            process.env.NODE_ENV === 'production'
            && this._environment === 'sandbox'
            && process.env.WOMPI_ALLOW_SANDBOX_IN_PRODUCTION !== 'true'
        ) {
            this._misconfigured = true;
            this._environment = 'unconfigured';
            this.logger.error(
                'Wompi sandbox credentials are forbidden in NODE_ENV=production — adapter disabled',
            );
            return;
        }

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

    private environmentOfCredential(
        key: string | undefined,
        testPrefix: string,
        productionPrefix: string,
    ): WompiEnvironment {
        if (!key) return 'unconfigured';
        if (key.startsWith(testPrefix)) return 'sandbox';
        if (key.startsWith(productionPrefix)) return 'production';
        return 'unconfigured';
    }

    /**
     * True only for a complete rail.  A private/integrity pair can create a
     * charge, but without the public key acceptance/tokenization fails and
     * without the event secret settlement notifications cannot be trusted.
     * Routing must therefore fail closed unless all four credentials match.
     */
    isConfigured(): boolean {
        return !this._misconfigured
            && this._environment !== 'unconfigured'
            && Boolean(this._publicKey && this._privateKey && this._eventsSecret && this._integritySecret);
    }

    /** True when incoming webhooks can be verified. Separate from isConfigured: reading events needs only the events secret. */
    canVerifyWebhooks(): boolean {
        return !this._misconfigured
            && this._environment !== 'unconfigured'
            && Boolean(this._eventsSecret);
    }

    environment(): WompiEnvironment {
        return this._environment;
    }

    /** The API base URL is derived from the keys, never configured independently. */
    get baseUrl(): string {
        if (this._misconfigured || this._environment === 'unconfigured') {
            throw new Error('Wompi environment is not configured');
        }
        return this._environment === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
    }

    get publicKey(): string | undefined {
        return this._misconfigured || this._environment === 'unconfigured' ? undefined : this._publicKey;
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
        return this.canVerifyWebhooks() ? this._eventsSecret : undefined;
    }

    private requireConfigured(): void {
        if (!this.isConfigured()) {
            throw new Error(
                'Wompi is not configured. Set WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_EVENTS_SECRET and WOMPI_INTEGRITY_SECRET from the same environment.',
            );
        }
    }
}
