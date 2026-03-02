import { Module, OnModuleInit } from '@nestjs/common';
import { ChannelGatewayService } from './channel-gateway.service';
import { ChannelsController } from './channels.controller';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';

@Module({
    controllers: [ChannelsController],
    providers: [ChannelGatewayService, WhatsAppAdapter],
    exports: [ChannelGatewayService],
})
export class ChannelsModule implements OnModuleInit {
    constructor(
        private gateway: ChannelGatewayService,
        private whatsappAdapter: WhatsAppAdapter,
    ) { }

    onModuleInit() {
        // Register all available channel adapters
        this.gateway.registerAdapter(this.whatsappAdapter);
        // Future: this.gateway.registerAdapter(this.instagramAdapter);
        // Future: this.gateway.registerAdapter(this.messengerAdapter);
        // Future: this.gateway.registerAdapter(this.telegramAdapter);
    }
}
