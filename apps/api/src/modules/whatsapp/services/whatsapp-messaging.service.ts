import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WhatsappMessagingService {
  private readonly logger = new Logger(WhatsappMessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
  ) {}

  async sendTemplate(
    schemaName: string, 
    toPhone: string, 
    templateName: string, 
    language: string, 
    components: any[]
  ) {
    // 1. Get channel config
    const channels = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT id, phone_number_id, access_token_ref FROM whatsapp_channels LIMIT 1`
    );

    if (!channels || channels.length === 0) {
      throw new BadRequestException('No hay canal de WhatsApp conectado');
    }

    const { id: channelId, phone_number_id, access_token_ref } = channels[0];

    // Remove any + sign for WhatsApp API
    const cleanPhone = toPhone.replace('+', '');

    // 2. Prepare Meta API request
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: components
      }
    };

    try {
      this.logger.log(`Sending template ${templateName} to ${cleanPhone}`);
      
      // In real code:
      // const response = await firstValueFrom(
      //   this.httpService.post(
      //     `https://graph.facebook.com/v20.0/${phone_number_id}/messages`,
      //     payload,
      //     { headers: { Authorization: \`Bearer \${access_token_ref}\` } }
      //   )
      // );
      
      // Mock successful response
      const mockMessageId = `wamid.HBgL${Math.random().toString(36).substring(7)}`;

      // 3. Log to database
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_message_logs (
          channel_id, provider_message_id, template_name, direction, status, request_payload_json, sent_at
        ) VALUES ($1, $2, $3, 'outbound', 'sent', $4, NOW())`,
        [channelId, mockMessageId, templateName, JSON.stringify(payload)]
      );

      return { success: true, messageId: mockMessageId };

    } catch (error) {
      this.logger.error(`Failed to send template: ${error.message}`);
      
      // Log failure
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_message_logs (
          channel_id, template_name, direction, status, error_message, request_payload_json
        ) VALUES ($1, $2, 'outbound', 'failed', $3, $4)`,
        [channelId, templateName, error.message, JSON.stringify(payload)]
      );

      throw new BadRequestException(`Fallo al enviar template: ${error.message}`);
    }
  }

  async sendTextMessage(
    schemaName: string, 
    toPhone: string, 
    text: string,
    conversationId?: string
  ) {
    const channels = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT id, phone_number_id, access_token_ref FROM whatsapp_channels LIMIT 1`
    );

    if (!channels || channels.length === 0) {
      this.logger.error(`No WhatsApp channel connected for schema ${schemaName}`);
      return null;
    }

    const { id: channelId, phone_number_id, access_token_ref } = channels[0];
    const cleanPhone = toPhone.replace('+', '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { body: text }
    };

    try {
      // Mock API call
      const mockMessageId = `wamid.HBgL${Math.random().toString(36).substring(7)}`;

      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_message_logs (
          channel_id, conversation_id, provider_message_id, direction, status, request_payload_json, sent_at
        ) VALUES ($1, $2, $3, 'outbound', 'sent', $4, NOW())`,
        [channelId, conversationId || null, mockMessageId, JSON.stringify(payload)]
      );

      return mockMessageId;
    } catch (error) {
       this.logger.error(`Error sending text: ${error.message}`);
       return null;
    }
  }
}
