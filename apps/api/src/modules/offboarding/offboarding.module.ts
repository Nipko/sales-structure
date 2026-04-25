import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OffboardingService } from './offboarding.service';
import { OffboardingCronService } from './offboarding-cron.service';
import { OffboardingController } from './offboarding.controller';

@Module({
    imports: [
        BullModule.registerQueue(
            { name: 'outbound-messages' },
            { name: 'broadcast-messages' },
            { name: 'automation-jobs' },
            { name: 'nurturing' },
            { name: 'conversation-snooze' },
        ),
    ],
    providers: [OffboardingService, OffboardingCronService],
    controllers: [OffboardingController],
    exports: [OffboardingService],
})
export class OffboardingModule {}
