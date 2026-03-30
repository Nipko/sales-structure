import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AutomationService } from './automation.service';
import { ActionExecutorService } from './action-executor.service';
import { AutomationListenerService, AUTOMATION_JOBS_QUEUE } from './automation-listener.service';
import { AutomationJobsProcessor } from './automation-jobs.processor';
import { AutomationController } from './automation.controller';
import { NurturingService, NURTURING_QUEUE } from './nurturing.service';
import { NurturingQueueProcessor } from './nurturing-queue.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PersonaModule } from '../persona/persona.module';
import { AIModule } from '../ai/ai.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
    imports: [
        PrismaModule,
        forwardRef(() => WhatsappModule),
        PersonaModule,
        AIModule,
        forwardRef(() => ChannelsModule),
        BullModule.registerQueue({ name: NURTURING_QUEUE }),
        BullModule.registerQueue({ name: AUTOMATION_JOBS_QUEUE }),
    ],
    controllers: [AutomationController],
    providers: [
        AutomationService,
        ActionExecutorService,
        AutomationListenerService,
        AutomationJobsProcessor,
        NurturingService,
        NurturingQueueProcessor,
    ],
    exports: [AutomationService, NurturingService],
})
export class AutomationModule {}
