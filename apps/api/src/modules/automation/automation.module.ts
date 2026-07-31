import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { AutomationService } from './automation.service';
import { ActionExecutorService } from './action-executor.service';
import { AutomationListenerService, AUTOMATION_JOBS_QUEUE } from './automation-listener.service';
import { AutomationJobsProcessor } from './automation-jobs.processor';
import { TemporalEvaluatorService } from './temporal-evaluator.service';
import { AutomationController } from './automation.controller';
import { AutomationTemplatesService } from './templates/automation-templates.service';
import { AutomationTemplatesController } from './templates/automation-templates.controller';
import { NurturingService, NURTURING_QUEUE } from './nurturing.service';
import { NurturingQueueProcessor } from './nurturing-queue.processor';
import { DripSequenceService } from './drip-sequence.service';
import { DripSequenceController } from './drip-sequence.controller';
import { HttpRequestHandler } from './handlers/http-request.handler';
import { HttpRequestService } from '../../common/services/http-request.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PersonaModule } from '../persona/persona.module';
import { AIModule } from '../ai/ai.module';
import { ChannelsModule } from '../channels/channels.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CrmModule } from '../crm/crm.module';

@Module({
    imports: [
        PrismaModule,
        forwardRef(() => WhatsappModule),
        PersonaModule,
        AIModule,
        forwardRef(() => ChannelsModule),
        AnalyticsModule,
        CrmModule,
        HttpModule.register({ timeout: 10_000 }),
        BullModule.registerQueue({ name: NURTURING_QUEUE }),
        BullModule.registerQueue({ name: AUTOMATION_JOBS_QUEUE }),
    ],
    controllers: [AutomationController, AutomationTemplatesController, DripSequenceController],
    providers: [
        AutomationService,
        ActionExecutorService,
        AutomationListenerService,
        AutomationJobsProcessor,
        TemporalEvaluatorService,
        AutomationTemplatesService,
        NurturingService,
        NurturingQueueProcessor,
        DripSequenceService,
        HttpRequestService,
        HttpRequestHandler,
    ],
    exports: [AutomationService, NurturingService, DripSequenceService],
})
export class AutomationModule {}
