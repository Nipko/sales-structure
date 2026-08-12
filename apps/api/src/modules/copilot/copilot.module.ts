import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { AIModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { VerticalsModule } from '../verticals/verticals.module';
import { CopilotChatRateLimitGuard } from './copilot-chat-rate-limit.guard';
import { CopilotRateLimitService } from './copilot-rate-limit.service';

@Module({
    imports: [ConfigModule, AIModule, KnowledgeModule, VerticalsModule],
    controllers: [CopilotController],
    providers: [CopilotService, CopilotChatRateLimitGuard, CopilotRateLimitService],
    exports: [CopilotService],
})
export class CopilotModule {}
