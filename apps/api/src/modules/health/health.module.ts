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
import { MediaModule } from '../media/media.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [
        MediaModule,
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
    providers: [PlatformMonitorService, PlatformStorageService, IncidentService, TelegramAlertService, SmsAlertService, AlertConfigService, SentryStatsService],
    exports: [PlatformMonitorService, PlatformStorageService, IncidentService, AlertConfigService],
})
export class HealthModule { }
