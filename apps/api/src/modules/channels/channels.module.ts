import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelGatewayService } from './channel-gateway.service';
import { ChannelsController } from './channels.controller';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { OutboundQueueProcessor, OUTBOUND_QUEUE } from './outbound-queue.processor';
import { OutboundQueueService } from './outbound-queue.service';
import { ChannelTokenService } from './channel-token.service';
import { ChannelManagementController } from './channel-management.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
    imports: [
        BullModule.registerQueue({ name: OUTBOUND_QUEUE }),
        forwardRef(() => ConversationsModule),
        forwardRef(() => WhatsappModule),
    ],
    controllers: [ChannelsController, ChannelManagementController],
    providers: [
        ChannelGatewayService,
        WhatsAppAdapter,
        InstagramAdapter,
        MessengerAdapter,
        TelegramAdapter,
        OutboundQueueProcessor,
        OutboundQueueService,
        ChannelTokenService,
    ],
    exports: [ChannelGatewayService, WhatsAppAdapter, OutboundQueueService, ChannelTokenService],
})
export class ChannelsModule implements OnModuleInit {
    constructor(
        private gateway: ChannelGatewayService,
        private whatsappAdapter: WhatsAppAdapter,
        private instagramAdapter: InstagramAdapter,
        private messengerAdapter: MessengerAdapter,
        private telegramAdapter: TelegramAdapter,
    ) {}

    onModuleInit() {
        this.gateway.registerAdapter(this.whatsappAdapter);
        this.gateway.registerAdapter(this.instagramAdapter);
        this.gateway.registerAdapter(this.messengerAdapter);
        this.gateway.registerAdapter(this.telegramAdapter);
    }
}
