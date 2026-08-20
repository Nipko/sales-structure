import { Module, forwardRef } from '@nestjs/common';
import { ToursService } from './tours.service';
import { ToursController } from './tours.controller';
import { TourPaymentListener } from './tour-payment.listener';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { ChannelsModule } from '../channels/channels.module';
import { PushModule } from '../push/push.module';
import { PaymentOutcomeNotifierService } from '../conversations/payment-outcome-notifier.service';

@Module({
    // forwardRef: ChannelsModule cierra un ciclo con esta vertical. Se necesita
    // para que el avisador del pago pueda encolar el mensaje al cliente.
    imports: [EmailTemplatesModule, forwardRef(() => ChannelsModule), PushModule],
    controllers: [ToursController],
    // El listener del cobro vive acá y no en tenant-payments: cada vertical sabe
    // qué significa "confirmar" lo suyo. Y el avisador se registra explícito
    // porque en el listener es @Optional: no registrarlo no rompe nada, el
    // cliente simplemente nunca se entera de que su pago entró.
    providers: [ToursService, TourPaymentListener, PaymentOutcomeNotifierService],
    exports: [ToursService],
})
export class ToursModule {}
