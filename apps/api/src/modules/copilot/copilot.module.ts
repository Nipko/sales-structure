import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { AIModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { VerticalsModule } from '../verticals/verticals.module';
import { CopilotChatRateLimitGuard } from './copilot-chat-rate-limit.guard';
import { CopilotRateLimitService } from './copilot-rate-limit.service';
import { QualityModule } from '../quality/quality.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AgentAssessmentService } from './agent-assessment.service';
import { AgentConfigurationService } from './agent-configuration.service';
import { PersonaModule } from '../persona/persona.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [ConfigModule, AIModule, KnowledgeModule, VerticalsModule, QualityModule, PersonaModule, forwardRef(() => TenantsModule), forwardRef(() => ConversationsModule)],
    controllers: [CopilotController],
    providers: [CopilotService, CopilotChatRateLimitGuard, CopilotRateLimitService, AgentAssessmentService, AgentConfigurationService],
    exports: [CopilotService],
})
export class CopilotModule {}
