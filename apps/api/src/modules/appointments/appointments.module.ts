import { Module, forwardRef } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { CalendarCallbackController } from './calendar-callback.controller';
import { PublicBookingController } from './public-booking.controller';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { ChannelsModule } from '../channels/channels.module';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    imports: [
        forwardRef(() => ChannelsModule),
        EmailTemplatesModule,
    ],
    controllers: [AppointmentsController, CalendarCallbackController, PublicBookingController],
    providers: [
        AppointmentsService, ServicesService, CalendarIntegrationService,
        AppointmentRemindersService, AppointmentNotificationsService,
    ],
    exports: [AppointmentsService, ServicesService, CalendarIntegrationService],
})
export class AppointmentsModule {}
