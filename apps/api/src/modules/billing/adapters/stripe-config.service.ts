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
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Stripe = require('stripe');
            this._client = new Stripe(key);
            this.logger.log('Stripe client initialized');
        }
        return this._client;
    }

    get webhookSecret(): string {
        return this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    }

    get isConfigured(): boolean {
        return !!this.config.get<string>('STRIPE_SECRET_KEY');
    }
}
