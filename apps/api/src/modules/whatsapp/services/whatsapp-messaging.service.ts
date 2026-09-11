import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConnectionService } from './whatsapp-connection.service';
import { toWhatsAppFormatting } from '../../../common/utils/channel-text-format.util';
import { WhatsappSendAdmissionService, type Admission } from '../../billing/whatsapp-spend/whatsapp-send-admission.service';

const META_GRAPH_VERSION = 'v21.0';

@Injectable()
export class WhatsappMessagingService {
  private readonly logger = new Logger(WhatsappMessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly connectionService: WhatsappConnectionService,
    // The third and last sink. This service builds its own payload and posts
    // it to Meta itself, so a gate on the queue would never see it — and every
    // template, every interactive card and every media message sent from a
    // controller comes through here.
    @Optional() private readonly spendGate?: WhatsappSendAdmissionService,
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
    components: any[],
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
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
    conversationId?: string,
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      // Second live WhatsApp route: this service builds its own payload and
      // never passed through the adapter, so Markdown from any caller reached
      // the customer raw. Two WhatsApp paths have bitten this repo before.
      text: { body: toWhatsAppFormatting(text) },
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
    conversationId?: string,
    /**
     * Which of the tenant's numbers sends — and therefore which WhatsApp
     * Business Account Meta bills from 1 October 2026. It could not be expressed
     * here at all, so the resolver returned the tenant's oldest connection and
     * the account that paid was a property of row order.
     *
     * Optional because most tenants have one number and naming it would be
     * ceremony. Omitting it is not a default: the resolver answers an unnamed
     * request only while there is exactly one, and refuses otherwise.
     */
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'interactive',
      interactive: {
        ...interactive,
        body: { ...interactive.body, text: toWhatsAppFormatting(interactive.body.text) },
      },
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
    conversationId?: string,
    /** Which number sends, and therefore which WABA Meta bills. See above. */
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const mediaPayload: any = { link: mediaUrl };
    if (caption) mediaPayload.caption = toWhatsAppFormatting(caption);
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
    conversationId?: string,
    /** Which number sends, and therefore which WABA Meta bills. See above. */
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
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

    // Reserved BEFORE the request. A reservation taken afterwards is a record
    // of money already spent, not a limit on spending it.
    const admission = await this.admitSpend(schemaName, phoneNumberId, payload, templateName);
    if (admission === 'refused') {
      throw new BadRequestException(
        'El envío fue rechazado por el límite de gasto de WhatsApp configurado para esta cuenta.',
      );
    }

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

      // Accepted, not priced: Meta answers with an id long before it says what
      // the delivery cost, so the reservation stands until a status webhook or
      // a reconciliation settles it.
      await this.recordSpend(schemaName, admission, { kind: 'delivered_unpriced', providerMessageId: messageId });

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

      // A refusal Meta names is proof nothing was delivered, so the money goes
      // back. Anything else — a timeout, a socket reset, a 5xx — may still have
      // put a message on a phone, and that reservation is retained.
      await this.recordSpend(schemaName, admission, metaError
        ? { kind: 'rejected', errorCode: String(errorCode) }
        : { kind: 'timeout', errorCode: String(errorCode) });

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

  /**
   * Ask the money gate for this one message.
   *
   * `'refused'` means a ceiling said no. `null` means there is no gate, or the
   * schema maps to no tenant, and the send proceeds unmetered rather than being
   * stopped by its own meter.
   */
  private async admitSpend(schemaName: string, phoneNumberId: string, payload: any, templateName?: string) {
    if (!this.spendGate) return null;
    try {
      const admission = await this.spendGate.admitBySchema(schemaName, {
        channelType: 'whatsapp',
        channelAccountId: phoneNumberId,
        // The recipient is hashed before it travels: this value ends up in an
        // effect key and in log lines.
        recipientRef: createHash('sha256').update(String(payload?.to ?? '')).digest('hex').slice(0, 32),
        // A template outside the 24h window is `utility` or `marketing` and is
        // priced differently from a service reply. Guessing `service` for all
        // of them would underprice every campaign, so the distinction is kept:
        // what a template's category actually IS comes from Meta, and until
        // that is bound the reservation carries `template` and prices as
        // unknown rather than as cheap.
        category: templateName ? 'template' : 'service',
        // A template is an initiation by definition — it exists to open a
        // conversation outside the 24-hour window — and a session message can
        // only be sent inside one, which means somebody wrote first. The
        // distinction comes from WhatsApp's own rules, not from a guess about
        // what the message says.
        disposition: templateName ? 'proactive' : 'reactive',
        producer: templateName ? 'whatsapp_rest_template' : `whatsapp_rest_${String(payload?.type ?? 'text')}`,
        contentDigest: createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 32),
        admissionReason: 'whatsapp_messaging_service',
      });
      if (admission && !admission.permitted) return 'refused' as const;
      return admission;
    } catch (error: any) {
      // An unreachable gate must not stop a customer being answered. It is
      // logged loudly because an ungated send is exactly what this boundary
      // exists to make impossible.
      this.logger.error(`[Spend] gate unavailable for whatsapp REST: ${error?.message}`);
      return null;
    }
  }

  private async recordSpend(schemaName: string, admission: unknown, outcome: {
    kind: 'delivered_priced' | 'delivered_unpriced' | 'rejected' | 'timeout';
    providerMessageId?: string | null; errorCode?: string | null;
  }) {
    if (!admission || admission === 'refused' || !this.spendGate) return;
    try {
      await this.spendGate.record(schemaName, admission as Admission, outcome);
    } catch (error: any) {
      this.logger.error(`[Spend] outcome not recorded: ${error?.message}`);
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
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, NOW())`,
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
