import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { PlatformMonitorService } from './platform-monitor.service';
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
        ),
    ],
    controllers: [HealthController],
    providers: [PlatformMonitorService],
    exports: [PlatformMonitorService],
})
export class HealthModule { }
