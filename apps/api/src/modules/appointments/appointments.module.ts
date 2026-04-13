import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { CalendarCallbackController } from './calendar-callback.controller';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';

@Module({
    controllers: [AppointmentsController, CalendarCallbackController],
    providers: [AppointmentsService, ServicesService, CalendarIntegrationService],
    exports: [AppointmentsService, ServicesService, CalendarIntegrationService],
})
export class AppointmentsModule {}
