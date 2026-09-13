import { OperationalNoticeModule } from '../operational-notices/operational-notice.module';
import { Module, forwardRef } from '@nestjs/common';
import { AppointmentCommandsModule } from './appointment-commands.module';
import { AppointmentsController } from './appointments.controller';
import { CalendarCallbackController } from './calendar-callback.controller';
import { PublicBookingController } from './public-booking.controller';
import { ServicesService } from './services.service';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { ChannelsModule } from '../channels/channels.module';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { IdentityModule } from '../identity/identity.module';
import { AppointmentPaymentListener } from './appointment-payment.listener';
import { PushModule } from '../push/push.module';

@Module({
    imports: [
        AppointmentCommandsModule,
        OperationalNoticeModule,
        forwardRef(() => ChannelsModule),
        EmailTemplatesModule,
        WhatsappModule,
        IdentityModule,
        PushModule,
    ],
    controllers: [AppointmentsController, CalendarCallbackController, PublicBookingController],
    providers: [
        ServicesService, AppointmentRemindersService, AppointmentNotificationsService,
        // Cada vertical sabe qué significa "confirmar" lo suyo; el módulo de
        // cobros no necesita conocer a ninguna.
        AppointmentPaymentListener,
    ],
    exports: [AppointmentCommandsModule, ServicesService],
})
export class AppointmentsModule {}
