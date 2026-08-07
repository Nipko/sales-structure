import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { PlatformMonitorService } from './platform-monitor.service';
import { PlatformStorageService } from './platform-storage.service';
import { IncidentService } from './incident.service';
import { TelegramAlertService } from './telegram-alert.service';
import { SmsAlertService } from './sms-alert.service';
import { AlertConfigService } from './alert-config.service';
import { SentryStatsService } from './sentry-stats.service';
import { CouponAlertListener } from './coupon-alert.listener';
import { MediaModule } from '../media/media.module';
import { AIModule } from '../ai/ai.module';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';

@Module({
    imports: [
        MediaModule,
        SmsCreditsModule,
        AIModule,
        BullModule.registerQueue(
            { name: 'outbound-messages' },
            { name: 'broadcast-messages' },
            { name: 'automation-jobs' },
            { name: 'nurturing' },
            { name: 'inbound-messages' },
        ),
    ],
    controllers: [HealthController],
    providers: [PlatformMonitorService, PlatformStorageService, IncidentService, TelegramAlertService, SmsAlertService, AlertConfigService, SentryStatsService, CouponAlertListener],
    exports: [PlatformMonitorService, PlatformStorageService, IncidentService, AlertConfigService],
})
export class HealthModule { }
