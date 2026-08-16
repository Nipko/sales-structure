import { Module } from '@nestjs/common';
import { TenantPaymentsService } from './tenant-payments.service';
import { TenantPaymentsWebhookService } from './tenant-payments-webhook.service';
import { TenantPaymentsController } from './tenant-payments.controller';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { TenantMercadoPagoOperationProvider } from './tenant-mercadopago-operation.provider';

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
        TenantPaymentsService,
        TenantPaymentsWebhookService,
        TenantMercadoPagoOperationProvider,
        WhatsappCryptoService,
    ],
    controllers: [TenantPaymentsController],
    exports: [TenantPaymentsService, TenantMercadoPagoOperationProvider],
})
export class TenantPaymentsModule {}
