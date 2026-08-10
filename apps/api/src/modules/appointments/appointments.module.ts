import { Module, forwardRef } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { CalendarCallbackController } from './calendar-callback.controller';
import { PublicBookingController } from './public-booking.controller';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';
import { ChannelsModule } from '../channels/channels.module';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
    imports: [
        forwardRef(() => ChannelsModule),
        EmailTemplatesModule,
        WhatsappModule,
        IdentityModule,
    ],
    controllers: [AppointmentsController, CalendarCallbackController, PublicBookingController],
    providers: [
        AppointmentsService, ServicesService, CalendarIntegrationService,
        CalendarSyncOutboxService, AppointmentRemindersService, AppointmentNotificationsService,
    ],
    exports: [AppointmentsService, ServicesService, CalendarIntegrationService, CalendarSyncOutboxService],
})
export class AppointmentsModule {}
