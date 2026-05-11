import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IPaymentProvider } from './adapters/payment-provider.interface';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { StripeAdapter } from './adapters/stripe.adapter';
import { PaymentProviderName } from './types/provider-types';

@Injectable()
export class PaymentProviderFactory {
    private readonly logger = new Logger(PaymentProviderFactory.name);

    constructor(
        private readonly mockProvider: MockPaymentProvider,
        private readonly mercadoPagoAdapter: MercadoPagoAdapter,
        private readonly stripeAdapter: StripeAdapter,
    ) {}

    getByName(providerName: PaymentProviderName | string | null | undefined): IPaymentProvider {
        switch (providerName) {
            case 'stripe':
                return this.stripeAdapter;
            case 'mercadopago':
                return this.mercadoPagoAdapter;
            case 'mock':
                return this.mockProvider;
            default:
                return this.mercadoPagoAdapter;
        }
    }
}
