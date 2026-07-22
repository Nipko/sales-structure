import { Module } from '@nestjs/common';
import { SmsCreditsService } from './sms-credits.service';
import { SmsCreditsController } from './sms-credits.controller';
import { TenantNotificationSmsService } from './tenant-notification-sms.service';

@Module({
    providers: [SmsCreditsService, TenantNotificationSmsService],
    controllers: [SmsCreditsController],
    exports: [SmsCreditsService, TenantNotificationSmsService],
})
export class SmsCreditsModule { }
