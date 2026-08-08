import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OffboardingService } from './offboarding.service';
import { OffboardingCronService } from './offboarding-cron.service';
import { OffboardingController } from './offboarding.controller';
import { ArchiveMaintenanceService } from './archive-maintenance.service';
import { MediaModule } from '../media/media.module';
import { BillingModule } from '../billing/billing.module';

@Module({
    imports: [
        MediaModule,
        BillingModule,
        BullModule.registerQueue(
            { name: 'outbound-messages' },
            { name: 'broadcast-messages' },
            { name: 'automation-jobs' },
            { name: 'nurturing' },
            { name: 'conversation-snooze' },
            { name: 'inbound-messages' },
            { name: 'fiscal-invoice' },
            { name: 'crm-sync' },
            { name: 'crm-import' },
            { name: 'quality-scoring' },
            { name: 'agent-simulation' },
            { name: 'eval-gate' },
        ),
    ],
    providers: [OffboardingService, OffboardingCronService, ArchiveMaintenanceService],
    controllers: [OffboardingController],
    exports: [OffboardingService, ArchiveMaintenanceService],
})
export class OffboardingModule {}
