import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { SubscriptionEngineService } from './recurring/subscription-engine.service';
import {
    CHARGE_POLL_QUEUE,
    RENEWAL_QUEUE,
    RenewalSchedulerService,
} from './recurring/renewal-scheduler.service';
import { RenewalChargeProcessor } from './recurring/processors/renewal-charge.processor';
import { ChargePollProcessor } from './recurring/processors/charge-poll.processor';
import { EmailModule } from '../email/email.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingAdminController } from './billing-admin.controller';
import { BillingWebhookController } from './webhook.controller';
import { BillingPublicController } from './billing-public.controller';
import { CouponsService } from './coupons.service';
import { CouponGovernanceService } from './coupon-governance.service';
import { CouponsController } from './coupons.controller';
import { BillingEmailService } from './billing-email.service';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { MercadoPagoConfigService } from './adapters/mercadopago-config.service';
import { StripeAdapter } from './adapters/stripe.adapter';
import { StripeConfigService } from './adapters/stripe-config.service';
import { WompiAdapter } from './adapters/wompi.adapter';
import { WompiConfigService } from './adapters/wompi-config.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentRoutingService } from './payment-routing.service';
import { BillingReconciliationProcessor } from './processors/reconciliation.processor';
import { InvoiceGeneratorService } from './invoice-generator.service';
import { MediaProcessingModule } from '../media-processing/media-processing.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';
import { SmsCheckoutService } from './sms-checkout.service';
import { SmsCheckoutController } from './sms-checkout.controller';
import { BillingPlanCatalogService } from './billing-plan-catalog.service';

/**
 * Billing module — provider-agnostic subscription billing.
 *
 * Each adapter (MockPaymentProvider, MercadoPagoAdapter, …future StripeAdapter)
 * is registered as a provider here. PaymentProviderFactory (Sprint 2) selects
 * the active adapter per request based on Tenant.paymentProvider.
 *
 * EventEmitter2 is provided globally by app.module via @nestjs/event-emitter
 * so it is consumable in BillingService without an explicit import here.
 */
@Module({
    imports: [
        PrismaModule,
        RedisModule,
        EmailModule,
        MediaProcessingModule,
        FiscalModule,
        SmsCreditsModule,
        // Queues for the internal recurring engine. Both are dormant until a
        // subscription is switched to engine='internal'.
        BullModule.registerQueue({ name: RENEWAL_QUEUE }),
        BullModule.registerQueue({ name: CHARGE_POLL_QUEUE }),
    ],
    controllers: [BillingController, BillingAdminController, BillingPublicController, CouponsController, BillingWebhookController, SmsCheckoutController],
    providers: [
        BillingService,
        BillingEmailService,
        CouponsService,
        CouponGovernanceService,
        PaymentProviderFactory,
        PaymentRoutingService,
        MockPaymentProvider,
        MercadoPagoAdapter,
        MercadoPagoConfigService,
        StripeAdapter,
        StripeConfigService,
        WompiAdapter,
        WompiConfigService,
        BillingReconciliationProcessor,
        SubscriptionEngineService,
        RenewalSchedulerService,
        RenewalChargeProcessor,
        ChargePollProcessor,
        InvoiceGeneratorService,
        SmsCheckoutService,
        BillingPlanCatalogService,
    ],
    exports: [BillingService, CouponsService, InvoiceGeneratorService, PaymentRoutingService, PaymentProviderFactory],
})
export class BillingModule {}
