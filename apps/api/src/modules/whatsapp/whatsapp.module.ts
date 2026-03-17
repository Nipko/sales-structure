import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappConnectionService } from './services/whatsapp-connection.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';
import { WhatsappTemplateService } from './services/whatsapp-template.service';
import { WhatsappMessagingService } from './services/whatsapp-messaging.service';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { ConversationsModule } from '../conversations/conversations.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [PrismaModule, HttpModule, ConversationsModule, AnalyticsModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappConnectionService,
    WhatsappWebhookService,
    WhatsappTemplateService,
    WhatsappMessagingService,
  ],
  exports: [
    WhatsappConnectionService,
    WhatsappWebhookService,
    WhatsappTemplateService,
    WhatsappMessagingService,
  ],
})
export class WhatsappModule {}
