import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { PersonaModule } from '../persona/persona.module';
import { AIModule } from '../ai/ai.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
    imports: [PersonaModule, AIModule, ChannelsModule],
    providers: [ConversationsService],
    controllers: [ConversationsController],
    exports: [ConversationsService],
})
export class ConversationsModule { }
