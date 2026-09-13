import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';

/** Shared agenda commands and calendar outbox, independent of channel controllers
 * and notification listeners. Vertical adapters use this same provider instance.
 */
@Module({
    providers: [AppointmentsService, CalendarIntegrationService, CalendarSyncOutboxService],
    exports: [AppointmentsService, CalendarIntegrationService, CalendarSyncOutboxService],
})
export class AppointmentCommandsModule {}
