import { Module } from '@nestjs/common';
import { SmsCreditsService } from './sms-credits.service';
import { SmsCreditsController } from './sms-credits.controller';
import { TenantNotificationSmsService } from './tenant-notification-sms.service';
import { SmsKillSwitchService } from './sms-kill-switch.service';

@Module({
    providers: [SmsCreditsService, TenantNotificationSmsService, SmsKillSwitchService],
    controllers: [SmsCreditsController],
    exports: [SmsCreditsService, TenantNotificationSmsService, SmsKillSwitchService],
})
export class SmsCreditsModule { }
