import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { IPaymentProvider } from './adapters/payment-provider.interface';
import { IChargingProvider } from './adapters/charging-provider.interface';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { StripeAdapter } from './adapters/stripe.adapter';
import { WompiAdapter } from './adapters/wompi.adapter';
import { PaymentProviderName } from './types/provider-types';
import { PROVIDER_CAPABILITIES, ProviderCapabilities } from './adapters/provider-capabilities';

@Injectable()
export class PaymentProviderFactory {
    private readonly logger = new Logger(PaymentProviderFactory.name);

    constructor(
        private readonly mockProvider: MockPaymentProvider,
        private readonly mercadoPagoAdapter: MercadoPagoAdapter,
        private readonly stripeAdapter: StripeAdapter,
        private readonly wompiAdapter: WompiAdapter,
    ) {}

    /**
     * Resolve the adapter for a provider name.
     *
     * Throws on anything unknown. There is deliberately NO default: falling back
     * to MercadoPago would run charges, cancellations and refunds against the
     * wrong provider with ids that belong to another one — a silent money bug.
     * A missing adapter must fail loudly at the call site instead.
     */
    getByName(providerName: PaymentProviderName | string | null | undefined): IPaymentProvider {
        switch (providerName) {
            case 'stripe':
                return this.stripeAdapter;
            case 'mercadopago':
                return this.mercadoPagoAdapter;
            case 'wompi':
                return this.wompiAdapter;
            case 'mock':
                return this.mockProvider;
            default:
                this.logger.error(`[Billing] No adapter registered for payment provider '${providerName}'`);
                throw new BadRequestException({
                    error: 'unknown_payment_provider',
                    message: `No payment adapter is registered for '${providerName ?? '(none)'}'.`,
                    providerName: providerName ?? null,
                });
        }
    }

    /**
     * Resolve the charging interface for providers without native subscriptions.
     * Throws when the adapter does not implement it — the recurring engine must
     * never silently no-op on a charge.
     */
    getCharging(providerName: PaymentProviderName | string | null | undefined): IChargingProvider {
        const adapter = this.getByName(providerName) as unknown as Partial<IChargingProvider>;
        if (typeof adapter.charge !== 'function') {
            throw new BadRequestException({
                error: 'provider_not_chargeable',
                message: `Provider '${providerName}' does not support direct charges against a stored payment source.`,
                providerName: providerName ?? null,
            });
        }
        return adapter as IChargingProvider;
    }

    /**
     * What the provider can do. Business code branches on this, never on the
     * provider name — see ProviderCapabilities.
     */
    capabilitiesOf(providerName: PaymentProviderName | string | null | undefined): ProviderCapabilities {
        const caps = PROVIDER_CAPABILITIES[providerName as PaymentProviderName];
        if (!caps) {
            throw new BadRequestException({
                error: 'unknown_payment_provider',
                message: `No capabilities declared for payment provider '${providerName ?? '(none)'}'.`,
                providerName: providerName ?? null,
            });
        }
        return caps;
    }

    /** True when an adapter is registered for this name (does not validate credentials). */
    isRegistered(providerName: PaymentProviderName | string | null | undefined): boolean {
        return providerName === 'stripe'
            || providerName === 'mercadopago'
            || providerName === 'wompi'
            || providerName === 'mock';
    }
}
