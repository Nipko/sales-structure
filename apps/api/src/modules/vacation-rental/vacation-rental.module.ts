import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { IcalSyncService } from './ical-sync.service';
import { VacationRentalController } from './vacation-rental.controller';
import { IcalFeedController } from './ical-feed.controller';
import { IcalExportPublicController } from './ical-export-public.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { BookingPaymentListener } from './booking-payment.listener';

@Module({
    imports: [EmailTemplatesModule],
    controllers: [VacationRentalController, IcalFeedController, IcalExportPublicController],
    // El listener del cobro vive acá y no en tenant-payments: cada vertical
    // sabe qué significa "confirmar" lo suyo, y así el módulo de cobros no
    // necesita conocer a ninguna.
    providers: [PropertiesService, IcalSyncService, BookingPaymentListener],
    exports: [PropertiesService, IcalSyncService],
})
export class VacationRentalModule {}
