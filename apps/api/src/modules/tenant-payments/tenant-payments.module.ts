import { Module } from '@nestjs/common';
import { TenantPaymentsService } from './tenant-payments.service';
import { TenantPaymentsWebhookService } from './tenant-payments-webhook.service';
import { TenantPaymentsController } from './tenant-payments.controller';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { TenantMercadoPagoOperationProvider } from './tenant-mercadopago-operation.provider';
import { TenantPaymentStoreService } from './tenant-payment-store.service';
import { TenantWompiClient } from './tenant-wompi.client';
import { TenantWompiWebhookService } from './tenant-wompi-webhook.service';
import { TenantPaymentCredentialCryptoService } from './tenant-payment-credential-crypto.service';
import { TenantPaymentReconciliationService } from './tenant-payment-reconciliation.service';
import { TenantPaymentEventsListener } from './tenant-payment-events.listener';
import { TenantSalesReportService } from './tenant-sales-report.service';

/**
 * Cobros del tenant a su cliente final (D3).
 *
 * `WhatsappCryptoService` se provee directo en vez de importar WhatsappModule:
 * es un servicio sin estado sobre ENCRYPTION_KEY, y traer el módulo entero
 * arrastraría una dependencia pesada (y un forwardRef) por una función de
 * cifrado.
 */
@Module({
    providers: [
        TenantSalesReportService,
        TenantPaymentsService,
        TenantPaymentsWebhookService,
        TenantMercadoPagoOperationProvider,
        TenantPaymentStoreService,
        TenantWompiClient,
        TenantWompiWebhookService,
        TenantPaymentCredentialCryptoService,
        TenantPaymentReconciliationService,
        TenantPaymentEventsListener,
        WhatsappCryptoService,
    ],
    controllers: [TenantPaymentsController],
    exports: [TenantPaymentsService, TenantMercadoPagoOperationProvider, TenantPaymentReconciliationService],
})
export class TenantPaymentsModule {}
