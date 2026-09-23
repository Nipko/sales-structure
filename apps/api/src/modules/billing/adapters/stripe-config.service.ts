import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StripeConfigService {
    private readonly logger = new Logger(StripeConfigService.name);
    private _client: any = null;

    constructor(private readonly config: ConfigService) {}

    get client(): any {
        if (!this._client) {
            const key = this.config.get<string>('STRIPE_SECRET_KEY');
            if (!key) {
                throw new Error('STRIPE_SECRET_KEY not configured');
            }
            // Carga perezosa: el SDK de Stripe solo se resuelve si el tenant
            // realmente usa Stripe, así que no puede ser un import de arriba.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Stripe = require('stripe');
            this._client = new Stripe(key, { timeout: 15000, maxNetworkRetries: 1 });
            this.logger.log('Stripe client initialized');
        }
        return this._client;
    }

    get webhookSecret(): string {
        return this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    }

    get isConfigured(): boolean {
        const key = this.config.get<string>('STRIPE_SECRET_KEY', '');
        return /^(sk|rk)_(test|live)_/.test(key)
            && (this.config.get<string>('NODE_ENV') !== 'production' || /^(sk|rk)_live_/.test(key))
            && this.webhookSecret.startsWith('whsec_');
    }

    get dashboardUrl(): string {
        const value = this.config.get<string>('DASHBOARD_URL', 'http://localhost:3001');
        const url = new URL(value);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
            throw new Error('Invalid DASHBOARD_URL for Stripe return URLs');
        }
        return `${url.origin}/admin/settings/billing`;
    }
}
