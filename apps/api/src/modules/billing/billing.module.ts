import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingAdminController } from './billing-admin.controller';
import { BillingWebhookController } from './webhook.controller';
import { BillingPublicController } from './billing-public.controller';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { BillingEmailService } from './billing-email.service';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { MercadoPagoConfigService } from './adapters/mercadopago-config.service';
import { StripeAdapter } from './adapters/stripe.adapter';
import { StripeConfigService } from './adapters/stripe-config.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { BillingReconciliationProcessor } from './processors/reconciliation.processor';
import { InvoiceGeneratorService } from './invoice-generator.service';
import { MediaProcessingModule } from '../media-processing/media-processing.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';
import { SmsCheckoutService } from './sms-checkout.service';
import { SmsCheckoutController } from './sms-checkout.controller';

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
    imports: [PrismaModule, RedisModule, EmailModule, MediaProcessingModule, FiscalModule, SmsCreditsModule],
    controllers: [BillingController, BillingAdminController, BillingPublicController, CouponsController, BillingWebhookController, SmsCheckoutController],
    providers: [
        BillingService,
        BillingEmailService,
        CouponsService,
        PaymentProviderFactory,
        MockPaymentProvider,
        MercadoPagoAdapter,
        MercadoPagoConfigService,
        StripeAdapter,
        StripeConfigService,
        BillingReconciliationProcessor,
        InvoiceGeneratorService,
        SmsCheckoutService,
    ],
    exports: [BillingService, CouponsService, InvoiceGeneratorService],
})
export class BillingModule {}
