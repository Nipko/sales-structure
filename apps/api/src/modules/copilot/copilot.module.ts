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
import { AgentContentProposalService } from './agent-content-proposal.service';
import { PersonaModule } from '../persona/persona.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
    // The content operations reuse the module that owns each table rather than
    // writing it themselves, so Assist can never be a second write path with
    // different rules. Appointments is a forwardRef for the same reason
    // ConversationsModule holds one: it reaches back through channels.
    imports: [ConfigModule, AIModule, KnowledgeModule, VerticalsModule, QualityModule, PersonaModule,
        ComplianceModule, CatalogModule, forwardRef(() => AppointmentsModule),
        forwardRef(() => TenantsModule), forwardRef(() => ConversationsModule)],
    controllers: [CopilotController],
    providers: [CopilotService, CopilotChatRateLimitGuard, CopilotRateLimitService, AgentAssessmentService,
        AgentConfigurationService, AgentContentProposalService],
    exports: [CopilotService],
})
export class CopilotModule {}
