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
import { AppointmentPaymentListener } from './appointment-payment.listener';
import { PushModule } from '../push/push.module';
import { PaymentOutcomeNotifierService } from '../conversations/payment-outcome-notifier.service';

@Module({
    imports: [
        forwardRef(() => ChannelsModule),
        EmailTemplatesModule,
        WhatsappModule,
        IdentityModule,
        PushModule,
    ],
    controllers: [AppointmentsController, CalendarCallbackController, PublicBookingController],
    providers: [
        AppointmentsService, ServicesService, CalendarIntegrationService,
        CalendarSyncOutboxService, AppointmentRemindersService, AppointmentNotificationsService,
        // Cada vertical sabe qué significa "confirmar" lo suyo; el módulo de
        // cobros no necesita conocer a ninguna.
        AppointmentPaymentListener,
        // Explícito: al ser @Optional en el listener, no registrarlo no rompe
        // nada — el cliente simplemente nunca se entera de que su pago entró.
        PaymentOutcomeNotifierService,
    ],
    exports: [AppointmentsService, ServicesService, CalendarIntegrationService, CalendarSyncOutboxService],
})
export class AppointmentsModule {}
