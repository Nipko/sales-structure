import { Module } from '@nestjs/common';
import { HandoffService } from './handoff.service';
import { HandoffReturnReplayService } from './handoff-return-replay.service';
import { InboundQueueModule } from '../inbound/inbound-queue.module';
import { HandoffController } from './handoff.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { AIModule } from '../ai/ai.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
    imports: [EmailTemplatesModule, AIModule, AnalyticsModule, InboundQueueModule],
    providers: [HandoffService, HandoffReturnReplayService],
    controllers: [HandoffController],
    exports: [HandoffService],
})
export class HandoffModule {}
