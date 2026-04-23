import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MercadoPagoConfig, PreApproval, PreApprovalPlan, Payment } from 'mercadopago';

/**
 * Thin wrapper around the MercadoPago SDK's MercadoPagoConfig that exposes
 * typed client instances for the three resources the adapter uses:
 *  - PreApprovalPlan (plan catalog, created once per tier × country)
 *  - PreApproval (per-tenant subscriptions)
 *  - Payment (individual charge records, referenced from webhooks)
 *
 * Using one shared MercadoPagoConfig across all clients avoids re-creating
 * HTTP agents and lets us centralise access-token resolution + sandbox/prod
 * detection + webhook secret lookup for the HMAC verifier (Sprint 2.5).
 */
@Injectable()
export class MercadoPagoConfigService implements OnModuleInit {
    private readonly logger = new Logger(MercadoPagoConfigService.name);
    private config!: MercadoPagoConfig;
    private _preApproval!: PreApproval;
    private _preApprovalPlan!: PreApprovalPlan;
    private _payment!: Payment;
    private _webhookSecret: string | undefined;

    onModuleInit() {
        const accessToken = process.env.MP_ACCESS_TOKEN;
        this._webhookSecret = process.env.MP_WEBHOOK_SECRET;

        if (!accessToken) {
            // Intentional: we let the app boot without MP credentials so
            // development environments that don't care about billing can still
            // run. Any adapter method that actually reaches MP will throw
            // IsConfigured()-guarded errors.
            this.logger.warn('MP_ACCESS_TOKEN is not set — MercadoPagoAdapter will refuse any real calls');
            return;
        }

        this.config = new MercadoPagoConfig({
            accessToken,
            options: {
                // default timeout 5s → 10s so subscription creation has room
                // for MP's frequent latency spikes in LatAm
                timeout: 10_000,
                idempotencyKey: undefined, // set per-request in the adapter
            },
        });
        this._preApproval = new PreApproval(this.config);
        this._preApprovalPlan = new PreApprovalPlan(this.config);
        this._payment = new Payment(this.config);

        this.logger.log(`MercadoPago SDK initialised in ${this.environment()} mode`);
        if (!this._webhookSecret) {
            this.logger.warn('MP_WEBHOOK_SECRET is not set — webhook signature verification will fail');
        }
    }

    /** True if env vars are populated and clients are ready. */
    isConfigured(): boolean {
        return Boolean(this.config && this._preApproval);
    }

    /**
     * sandbox/production inference by token prefix. MP uses TEST-* for sandbox
     * and APP_USR-* for production credentials. Useful for logs and future
     * conditional behaviour (e.g., shorter timeouts in tests).
     */
    environment(): 'sandbox' | 'production' | 'unconfigured' {
        const token = process.env.MP_ACCESS_TOKEN;
        if (!token) return 'unconfigured';
        if (token.startsWith('TEST-')) return 'sandbox';
        if (token.startsWith('APP_USR-')) return 'production';
        return 'production'; // conservative default for anything unrecognised
    }

    get preApproval(): PreApproval {
        this.requireConfigured();
        return this._preApproval;
    }

    get preApprovalPlan(): PreApprovalPlan {
        this.requireConfigured();
        return this._preApprovalPlan;
    }

    get payment(): Payment {
        this.requireConfigured();
        return this._payment;
    }

    /** Used by verifyWebhookSignature in Sprint 2.5. */
    get webhookSecret(): string | undefined {
        return this._webhookSecret;
    }

    private requireConfigured(): void {
        if (!this.isConfigured()) {
            throw new Error(
                'MercadoPago is not configured. Set MP_ACCESS_TOKEN (and MP_WEBHOOK_SECRET for webhooks) in the environment.',
            );
        }
    }
}
