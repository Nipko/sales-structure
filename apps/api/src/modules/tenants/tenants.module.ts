import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { PlatformStatusController } from './platform-status.controller';

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
    controllers: [TenantsController, PlatformStatusController],
    providers: [TenantsService],
    exports: [TenantsService],
})
export class TenantsModule { }
