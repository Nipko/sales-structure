import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { PersonaModule } from '../persona/persona.module';
import { AIModule } from '../ai/ai.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsGateway } from './conversations.gateway';
import { HandoffModule } from '../handoff/handoff.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CrmModule } from '../crm/crm.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { AutomationModule } from '../automation/automation.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
    imports: [
        PersonaModule,
        AIModule,
        forwardRef(() => ChannelsModule),
        HandoffModule,
        KnowledgeModule,
        CrmModule,
        PipelineModule,
        forwardRef(() => AutomationModule),
        IdentityModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('auth.jwtSecret'),
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [ConversationsService, ConversationsGateway],
    controllers: [ConversationsController],
    exports: [ConversationsService, ConversationsGateway],
})
export class ConversationsModule {}
