import { Module } from '@nestjs/common';
import { AgentConsoleGateway } from './agent-console.gateway';
import { AgentConsoleService } from './agent-console.service';
import { AgentConsoleController } from './agent-console.controller';
import { CannedResponsesService } from './canned-responses.service';

@Module({
    providers: [AgentConsoleGateway, AgentConsoleService, CannedResponsesService],
    controllers: [AgentConsoleController],
    exports: [AgentConsoleService, AgentConsoleGateway],
})
export class AgentConsoleModule { }
