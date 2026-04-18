import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { CalendarCallbackController } from './calendar-callback.controller';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { ChannelsModule } from '../channels/channels.module';

@Module({
    imports: [ChannelsModule],
    controllers: [AppointmentsController, CalendarCallbackController],
    providers: [AppointmentsService, ServicesService, CalendarIntegrationService, AppointmentRemindersService],
    exports: [AppointmentsService, ServicesService, CalendarIntegrationService],
})
export class AppointmentsModule {}
