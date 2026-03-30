import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { PersonaModule } from '../persona/persona.module';
import { AIModule } from '../ai/ai.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsGateway } from './conversations.gateway';
import { HandoffModule } from '../handoff/handoff.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
    imports: [
        PersonaModule,
        AIModule,
        ChannelsModule,
        HandoffModule,
        KnowledgeModule,
        JwtModule.register({}),
    ],
    providers: [ConversationsService, ConversationsGateway],
    controllers: [ConversationsController],
    exports: [ConversationsService, ConversationsGateway],
})
export class ConversationsModule {}

