import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { PersonaModule } from '../persona/persona.module';
import { AIModule } from '../ai/ai.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsGateway } from './conversations.gateway';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
    imports: [
        PersonaModule,
        AIModule,
        forwardRef(() => ChannelsModule),
        forwardRef(() => WhatsappModule),
        JwtModule.register({}),
    ],
    providers: [ConversationsService, ConversationsGateway],
    controllers: [ConversationsController],
    exports: [ConversationsService, ConversationsGateway],
})
export class ConversationsModule { }

