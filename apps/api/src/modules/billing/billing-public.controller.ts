import { Controller, Get, Query } from '@nestjs/common';
import { BillingPlanCatalogService } from './billing-plan-catalog.service';
import { PaymentRoutingService } from './payment-routing.service';
import { MercadoPagoConfigService } from './adapters/mercadopago-config.service';
import { WompiConfigService } from './adapters/wompi-config.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { normalizeBillingCountry } from './billing-country-config';
import { DEFAULT_BILLING_COUNTRY } from '../../common/utils/billing-country.util';

@Controller('billing/public')
export class BillingPublicController {
    constructor(
        private readonly planCatalog: BillingPlanCatalogService,
        private readonly routing: PaymentRoutingService,
        private readonly mpConfig: MercadoPagoConfigService,
        private readonly wompiConfig: WompiConfigService,
        private readonly providerFactory: PaymentProviderFactory,
    ) {}

    @Get('plans')
    async listPlans(@Query('country') country?: string) {
        const plans = await this.planCatalog.listPublicPlans(country);
        return { success: true, data: plans };
    }

    /**
     * Which provider the checkout must render, and the publishable key its SDK
     * needs, resolved at REQUEST time.
     *
     * This exists so switching the payment operator is a settings change instead
     * of a rebuild: `NEXT_PUBLIC_*` keys are baked into the dashboard bundle at
     * build time, so a frontend reading the key from its own env could never
     * follow a runtime switch. Only publishable keys are returned — never a
     * private key, an access token or a webhook secret.
     */
    @Get('config')
    async publicConfig(@Query('country') country?: string) {
        // Default to Colombia when the caller omits the country, exactly as the
        // plan catalog and subscription creation do. Without it every provider
        // fails its country check and this endpoint — whose whole job is handing
        // the checkout its publishable key — would always error.
        const effectiveCountry = normalizeBillingCountry(country) || DEFAULT_BILLING_COUNTRY;
        const resolution = await this.routing.resolveForNewSubscription({ billingCountry: effectiveCountry });
        const provider = resolution.provider;
        const capabilities = this.providerFactory.capabilitiesOf(provider);

        let publicKey: string | null = null;
        let environment: string | null = null;
        if (provider === 'mercadopago') {
            publicKey = this.mpConfig.publicKey || null;
            environment = this.mpConfig.environment();
        } else if (provider === 'wompi') {
            publicKey = this.wompiConfig.publicKey || null;
            environment = this.wompiConfig.environment();
        }

        const routingConfig = await this.routing.getConfig();

        return {
            success: true,
            data: {
                provider,
                country: effectiveCountry,
                publicKey,
                environment,
                /** Methods the checkout may offer for this provider. */
                methods: provider === 'wompi'
                    ? Object.entries(routingConfig.wompiMethods)
                          .filter(([, enabled]) => enabled)
                          .map(([method]) => method)
                    : ['card'],
                /** Charges settle asynchronously — the UI must show a pending state instead of assuming success. */
                asyncSettlement: capabilities.asyncSettlement,
                requiresAcceptanceTokens: capabilities.requiresAcceptanceTokens,
            },
        };
    }
}
