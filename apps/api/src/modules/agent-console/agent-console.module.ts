import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentConsoleGateway } from './agent-console.gateway';
import { AgentConsoleService } from './agent-console.service';
import { AgentConsoleController } from './agent-console.controller';
import { CannedResponsesService } from './canned-responses.service';
import { AgentAvailabilityService } from './agent-availability.service';
import { MacrosService } from './macros.service';
import { SnoozeService, SNOOZE_QUEUE } from './snooze.service';
import { BullModule } from '@nestjs/bullmq';
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
        BullModule.registerQueue({ name: SNOOZE_QUEUE }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('auth.jwtSecret'),
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [AgentConsoleGateway, AgentConsoleService, CannedResponsesService, AgentAvailabilityService, MacrosService, SnoozeService],
    controllers: [AgentConsoleController],
    exports: [AgentConsoleService, AgentConsoleGateway, AgentAvailabilityService],
})
export class AgentConsoleModule {}
