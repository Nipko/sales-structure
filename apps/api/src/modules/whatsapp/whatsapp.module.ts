import { Module, forwardRef } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappConnectionService } from './services/whatsapp-connection.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';
import { WhatsappTemplateService } from './services/whatsapp-template.service';
import { WhatsappTemplatePollService } from './services/whatsapp-template-poll.service';
import { WhatsappMessagingService } from './services/whatsapp-messaging.service';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { ConversationsModule } from '../conversations/conversations.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ChannelsModule } from '../channels/channels.module';
import { TenantsModule } from '../tenants/tenants.module';
import { WhatsappCryptoService } from './services/whatsapp-crypto.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    TenantsModule,
    forwardRef(() => ConversationsModule),
    AnalyticsModule,
    forwardRef(() => ChannelsModule),
  ],
  controllers: [WhatsappController],
  providers: [
    WhatsappCryptoService,
    WhatsappConnectionService,
    WhatsappWebhookService,
    WhatsappTemplateService,
    WhatsappTemplatePollService,
    WhatsappMessagingService,
  ],
  exports: [
    WhatsappCryptoService,
    WhatsappConnectionService,
    WhatsappWebhookService,
    WhatsappTemplateService,
    WhatsappMessagingService,
  ],
})
export class WhatsappModule {}
