import { Module, forwardRef } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { IcalSyncService } from './ical-sync.service';
import { VacationRentalController } from './vacation-rental.controller';
import { IcalFeedController } from './ical-feed.controller';
import { IcalExportPublicController } from './ical-export-public.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { BookingPaymentListener } from './booking-payment.listener';
import { ChannelsModule } from '../channels/channels.module';
import { PaymentOutcomeNotifierService } from '../conversations/payment-outcome-notifier.service';
import { PushModule } from '../push/push.module';

@Module({
    // forwardRef: ChannelsModule cierra un ciclo con esta vertical. Se necesita
    // para que el avisador del pago pueda encolar el mensaje al huésped.
    imports: [EmailTemplatesModule, forwardRef(() => ChannelsModule), PushModule],
    controllers: [VacationRentalController, IcalFeedController, IcalExportPublicController],
    // El listener del cobro vive acá y no en tenant-payments: cada vertical
    // sabe qué significa "confirmar" lo suyo, y así el módulo de cobros no
    // necesita conocer a ninguna.
    providers: [
        PropertiesService, IcalSyncService, BookingPaymentListener,
        // El avisador se provee acá: al ser @Optional en el listener, NO
        // registrarlo no rompe nada — simplemente el huésped nunca se entera de
        // que su pago entró. Un fallo silencioso, que es el peor tipo.
        PaymentOutcomeNotifierService,
    ],
    exports: [PropertiesService, IcalSyncService],
})
export class VacationRentalModule {}
