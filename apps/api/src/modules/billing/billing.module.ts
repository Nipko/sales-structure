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
import { DunningService } from './recurring/dunning.service';
import { PaymentSourceService } from './recurring/payment-source.service';
import { ProrationService } from './recurring/proration.service';
import { PaymentSourceController } from './recurring/payment-source.controller';
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
 * Each adapter (MockPaymentProvider, MercadoPagoAdapter, WompiAdapter, …future
 * StripeAdapter) is registered as a provider here. Which one runs is decided by
 * PaymentRoutingService, not by a column: an existing subscription keeps the
 * provider it was born with, and a new one resolves through the super admin's
 * per-tenant override → the country default → the '*' rule. `Tenant.
 * paymentProvider` only records where the last subscription was created.
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
    controllers: [BillingController, BillingAdminController, BillingPublicController, CouponsController, BillingWebhookController, SmsCheckoutController, PaymentSourceController],
    providers: [
        BillingService,
        BillingEmailService,
        CouponsService,
        CouponGovernanceService,
        PaymentProviderFactory,
        PaymentRoutingService,
        MockPaymentProvider,
        StripeAdapter,
        StripeConfigService,
        WompiAdapter,
        WompiConfigService,
        BillingReconciliationProcessor,
        SubscriptionEngineService,
        RenewalSchedulerService,
        DunningService,
        PaymentSourceService,
        ProrationService,
        RenewalChargeProcessor,
        ChargePollProcessor,
        InvoiceGeneratorService,
        SmsCheckoutService,
        BillingPlanCatalogService,
    ],
    exports: [
        BillingService,
        CouponsService,
        InvoiceGeneratorService,
        PaymentRoutingService,
        PaymentProviderFactory,
        // Offboarding asks this before cutting service to a tenant whose charge
        // is still in flight.
        DunningService,
    ],
})
export class BillingModule {}
