import { OperationalNoticeModule } from '../operational-notices/operational-notice.module';
import { WidgetDeliveryModule } from '../widget/widget-delivery.module';
import { WidgetChannelAdapter } from './widget.adapter';
import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelGatewayService } from './channel-gateway.service';
import { ChannelsController } from './channels.controller';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { SmsAdapter } from './sms/sms.adapter';
import { EmailAdapter } from './email/email.adapter';
import { EmailChannelService } from './email/email-channel.service';
import { EmailWebhookController } from './email/email-webhook.controller';
import { EmailWebhookSecurityService } from './email/email-webhook-security.service';
import { OutboundQueueProcessor, OUTBOUND_QUEUE } from './outbound-queue.processor';
import { OutboundQueueService } from './outbound-queue.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { DispatchRecoveryService } from './dispatch-recovery.service';
import { ChannelTokenService } from './channel-token.service';
import { ChannelManagementController } from './channel-management.controller';
import { InstagramTokenRefreshService } from './instagram-token-refresh.service';
import { WhatsappTokenHealthService } from './whatsapp-token-health.service';
import { WebhookTapService } from './webhook-tap.service';
import { WebhookTapController } from './webhook-tap.controller';
import { InboundQueueModule } from '../inbound/inbound-queue.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';
// AnalyticsModule removed — compliance check moved to ConversationsService to avoid DI issues in processor

@Module({
    imports: [
        WidgetDeliveryModule,
        OperationalNoticeModule,
        BullModule.registerQueue({ name: OUTBOUND_QUEUE }),
        // Plain import: InboundQueueModule is a dependency leaf (queue + a
        // service injecting only globals), so it cannot close a cycle.
        InboundQueueModule,
        // The outbound worker resolves approved effect references through a leaf
        // delivery port exported by ConversationsModule. Keep this cycle deferred.
        forwardRef(() => ConversationsModule),
        forwardRef(() => WhatsappModule),
        SmsCreditsModule,
    ],
    controllers: [ChannelsController, ChannelManagementController, WebhookTapController, EmailWebhookController],
    providers: [
        ChannelGatewayService,
        WidgetChannelAdapter,
        WhatsAppAdapter,
        InstagramAdapter,
        MessengerAdapter,
        TelegramAdapter,
        SmsAdapter,
        EmailAdapter,
        EmailChannelService,
        EmailWebhookSecurityService,
        OutboundQueueProcessor,
        OutboundQueueService,
        AgentDispatchOutboxStore,
        DispatchRecoveryService,
        ChannelTokenService,
        InstagramTokenRefreshService,
        WhatsappTokenHealthService,
        WebhookTapService,
    ],
    exports: [ChannelGatewayService, WhatsAppAdapter, SmsAdapter, EmailAdapter, EmailChannelService, OutboundQueueService, ChannelTokenService, WebhookTapService, AgentDispatchOutboxStore],
})
export class ChannelsModule implements OnModuleInit {
    constructor(
        private gateway: ChannelGatewayService,
        private whatsappAdapter: WhatsAppAdapter,
        private instagramAdapter: InstagramAdapter,
        private messengerAdapter: MessengerAdapter,
        private telegramAdapter: TelegramAdapter,
        private smsAdapter: SmsAdapter,
        private emailAdapter: EmailAdapter,
        private widgetAdapter: WidgetChannelAdapter,
    ) {}

    onModuleInit() {
        this.gateway.registerAdapter(this.whatsappAdapter);
        this.gateway.registerAdapter(this.instagramAdapter);
        this.gateway.registerAdapter(this.messengerAdapter);
        this.gateway.registerAdapter(this.telegramAdapter);
        this.gateway.registerAdapter(this.smsAdapter);
        this.gateway.registerAdapter(this.emailAdapter);
        this.gateway.registerAdapter(this.widgetAdapter);
    }
}
