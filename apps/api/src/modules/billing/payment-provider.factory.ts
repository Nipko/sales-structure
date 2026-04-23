import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IPaymentProvider } from './adapters/payment-provider.interface';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { PaymentProviderName } from './types/provider-types';

/**
 * Selects the IPaymentProvider adapter to use for a given operation.
 *
 * BillingService never imports a concrete adapter — it always goes through this
 * factory. That keeps the provider choice a runtime concern that can be per
 * tenant, per country, or per feature flag without any service-layer changes
 * when new providers are added.
 *
 * Current resolution strategy:
 *  - Caller passes the tenant's paymentProvider string (from Tenant.paymentProvider).
 *  - `mercadopago` and `stripe` route to their adapters.
 *  - `mock` routes to the in-memory mock (used by tests and local dev).
 *  - Null/unknown defaults to MercadoPago — the primary LatAm provider. A
 *    misconfigured tenant will surface via the NotImplementedException thrown
 *    from MercadoPagoAdapter until Sprint 2 wires it up.
 */
@Injectable()
export class PaymentProviderFactory {
    private readonly logger = new Logger(PaymentProviderFactory.name);

    constructor(
        private readonly mockProvider: MockPaymentProvider,
        private readonly mercadoPagoAdapter: MercadoPagoAdapter,
    ) {}

    getByName(providerName: PaymentProviderName | string | null | undefined): IPaymentProvider {
        switch (providerName) {
            case 'mercadopago':
                return this.mercadoPagoAdapter;
            case 'mock':
                return this.mockProvider;
            case 'stripe':
                throw new NotFoundException({
                    error: 'provider_not_available',
                    message: 'Stripe adapter is not registered yet (planned for Phase 4).',
                });
            default:
                // Tenants without an explicit provider default to MercadoPago
                // (primary LatAm target). Safe because new subscriptions go
                // through createSubscription which fails loudly if MP is not
                // wired yet rather than silently misbehaving.
                return this.mercadoPagoAdapter;
        }
    }
}
