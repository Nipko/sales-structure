import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConnectionService } from './whatsapp-connection.service';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

@Injectable()
export class WhatsappMessagingService {
  private readonly logger = new Logger(WhatsappMessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly connectionService: WhatsappConnectionService,
  ) {}

  // ============================================================
  // 1. ENVIAR PLANTILLA PRE-APROBADA (Template Message)
  //    Obligatorio para iniciar conversaciones fuera de la ventana 24h
  // ============================================================
  async sendTemplate(
    schemaName: string,
    toPhone: string,
    templateName: string,
    language: string,
    components: any[]
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components,
      },
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, templateName);
  }

  // ============================================================
  // 2. ENVIAR TEXTO SIMPLE
  //    Solo funciona dentro de la ventana de 24h (customer-initiated)
  // ============================================================
  async sendTextMessage(
    schemaName: string,
    toPhone: string,
    text: string,
    conversationId?: string
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { body: text },
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // 3. ENVIAR MENSAJE INTERACTIVO (Botones de Reply / Listas)
  //    Funciona dentro de la ventana de 24h
  // ============================================================
  async sendInteractiveMessage(
    schemaName: string,
    toPhone: string,
    interactive: {
      type: 'button' | 'list';
      header?: { type: 'text'; text: string };
      body: { text: string };
      footer?: { text: string };
      action: any; // buttons[] o sections[]
    },
    conversationId?: string
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'interactive',
      interactive,
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // 4. ENVIAR MULTIMEDIA (Imagen, Audio, Documento, Video)
  //    Funciona dentro de la ventana de 24h
  // ============================================================
  async sendMediaMessage(
    schemaName: string,
    toPhone: string,
    mediaType: 'image' | 'audio' | 'document' | 'video',
    mediaUrl: string,
    caption?: string,
    filename?: string,
    conversationId?: string
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const mediaPayload: any = { link: mediaUrl };
    if (caption) mediaPayload.caption = caption;
    if (filename && mediaType === 'document') mediaPayload.filename = filename;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: mediaType,
      [mediaType]: mediaPayload,
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // 5. ENVIAR UBICACIÓN
  // ============================================================
  async sendLocationMessage(
    schemaName: string,
    toPhone: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    conversationId?: string
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'location',
      location: { latitude, longitude, name, address },
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // PRIVATE: Método central que envía a Meta y loguea en BD
  // ============================================================
  private async sendToMeta(
    schemaName: string,
    channelId: string,
    phoneNumberId: string,
    accessToken: string,
    payload: any,
    templateName?: string,
    conversationId?: string
  ): Promise<{ success: boolean; messageId: string }> {
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`;

    try {
      this.logger.log(`Sending ${payload.type} message to ${payload.to}`);

      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })
      );

      const messageId = response.data?.messages?.[0]?.id || `unknown-${Date.now()}`;
      this.logger.log(`Message sent successfully: ${messageId}`);

      // Loguear en BD
      await this.logMessage(schemaName, channelId, {
        providerMessageId: messageId,
        templateName: templateName || null,
        direction: 'outbound',
        status: 'sent',
        conversationId: conversationId || null,
        payload,
      });

      return { success: true, messageId };

    } catch (error: any) {
      const metaError = error?.response?.data?.error;
      const errorMessage = metaError?.message || error.message;
      const errorCode = metaError?.code || 'UNKNOWN';

      this.logger.error(`Failed to send message: [${errorCode}] ${errorMessage}`);

      // Loguear fallo en BD
      await this.logMessage(schemaName, channelId, {
        providerMessageId: null,
        templateName: templateName || null,
        direction: 'outbound',
        status: 'failed',
        conversationId: conversationId || null,
        payload,
        errorMessage,
      });

      throw new BadRequestException(
        `Error al enviar mensaje de WhatsApp: ${errorMessage}`
      );
    }
  }

  private async logMessage(schemaName: string, channelId: string, data: {
    providerMessageId: string | null;
    templateName: string | null;
    direction: string;
    status: string;
    conversationId: string | null;
    payload: any;
    errorMessage?: string;
  }) {
    try {
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_message_logs (
          channel_id, conversation_id, provider_message_id, template_name,
          direction, status, error_message, request_payload_json, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          channelId,
          data.conversationId,
          data.providerMessageId,
          data.templateName,
          data.direction,
          data.status,
          data.errorMessage || null,
          JSON.stringify(data.payload),
        ]
      );
    } catch (e: any) {
      this.logger.warn(`Failed to log message: ${e.message}`);
    }
  }
}
