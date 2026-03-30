import { Module } from '@nestjs/common';
import { AgentConsoleGateway } from './agent-console.gateway';
import { AgentConsoleService } from './agent-console.service';
import { AgentConsoleController } from './agent-console.controller';
import { CannedResponsesService } from './canned-responses.service';
import { ChannelsModule } from '../channels/channels.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AIModule } from '../ai/ai.module';
import { CopilotModule } from '../copilot/copilot.module';

@Module({
    imports: [ChannelsModule, WhatsappModule, AIModule, CopilotModule],
    providers: [AgentConsoleGateway, AgentConsoleService, CannedResponsesService],
    controllers: [AgentConsoleController],
    exports: [AgentConsoleService, AgentConsoleGateway],
})
export class AgentConsoleModule { }
