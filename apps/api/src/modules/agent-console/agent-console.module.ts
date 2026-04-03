import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentConsoleGateway } from './agent-console.gateway';
import { AgentConsoleService } from './agent-console.service';
import { AgentConsoleController } from './agent-console.controller';
import { CannedResponsesService } from './canned-responses.service';
import { ChannelsModule } from '../channels/channels.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AIModule } from '../ai/ai.module';
import { CopilotModule } from '../copilot/copilot.module';

@Module({
    imports: [
        forwardRef(() => ChannelsModule),
        forwardRef(() => WhatsappModule),
        AIModule,
        CopilotModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('auth.jwtSecret'),
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [AgentConsoleGateway, AgentConsoleService, CannedResponsesService],
    controllers: [AgentConsoleController],
    exports: [AgentConsoleService, AgentConsoleGateway],
})
export class AgentConsoleModule {}
