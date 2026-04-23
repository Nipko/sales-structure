import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './webhook.controller';
import { MockPaymentProvider } from './adapters/mock-payment-provider.adapter';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { PaymentProviderFactory } from './payment-provider.factory';
import { BillingReconciliationProcessor } from './processors/reconciliation.processor';

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
    imports: [PrismaModule, RedisModule],
    controllers: [BillingController, BillingWebhookController],
    providers: [
        BillingService,
        PaymentProviderFactory,
        MockPaymentProvider,
        MercadoPagoAdapter,
        BillingReconciliationProcessor,
    ],
    exports: [BillingService],
})
export class BillingModule {}
