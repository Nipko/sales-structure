import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelsModule } from '../channels/channels.module';
import { SmsSenderService } from './sms-sender.service';
import { SmsNotificationsService } from './sms-notifications.service';
import { SmsNotificationListenerService } from './sms-notification-listener.service';
import { SmsNotificationsController } from './sms-notifications.controller';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';

/**
 * Transactional SMS notifications on the tenant plane (Phase 2+). Listens to
 * domain events (handoff.escalated) and sends via the tenant's own Twilio
 * number. TenantThrottleService is @Global, so no ThrottleModule import needed.
 */
@Module({
    imports: [PrismaModule, ChannelsModule, SmsCreditsModule],
    providers: [SmsSenderService, SmsNotificationsService, SmsNotificationListenerService],
    controllers: [SmsNotificationsController],
    exports: [SmsSenderService, SmsNotificationsService],
})
export class SmsNotificationsModule {}
