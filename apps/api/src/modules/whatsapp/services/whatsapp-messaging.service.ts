import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConnectionService } from './whatsapp-connection.service';
import { toWhatsAppFormatting } from '../../../common/utils/channel-text-format.util';
import { WhatsappSendAdmissionService, type Admission } from '../../billing/whatsapp-spend/whatsapp-send-admission.service';
import { AccountPauseStore } from '../../channels/account-pause-store';

const META_GRAPH_VERSION = 'v21.0';

/**
 * What the money gate needs that a phone number and a payload cannot supply.
 *
 * Optional everywhere: a caller that does not pass it still sends, and the
 * effect is still reserved against the account. What it adds is the narrower
 * ceilings — the campaign's own budget, the per-contact limit — which cannot be
 * enforced against an effect that does not know which campaign or which contact
 * it belongs to.
 */
export interface WhatsappSendSpendContext {
    /** The campaign, broadcast or automation this message belongs to. */
    readonly taskId?: string | null;
    readonly contactId?: string | null;
    /** Distinguishes the second message of one effect from a repeat of the first. */
    readonly ordinal?: number;
    /**
     * Meta's own approved category for the template — `MARKETING`, `UTILITY`,
     * `AUTHENTICATION`. Supplied by the caller when it already read the
     * template row; otherwise this service reads it itself.
     */
    readonly templateCategory?: string | null;
}

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
    // The first of the two places Meta says the business cannot be billed: the
    // answer to this very request. The other is a status webhook minutes later.
    @Optional() private readonly pauses?: AccountPauseStore,
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
    spend?: WhatsappSendSpendContext,
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

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, templateName,
      undefined, spend);
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
    conversationId?: string,
    spend?: WhatsappSendSpendContext,
  ): Promise<{ success: boolean; messageId: string }> {
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`;

    // Reserved BEFORE the request. A reservation taken afterwards is a record
    // of money already spent, not a limit on spending it.
    const admission = await this.admitSpend(schemaName, phoneNumberId, payload, templateName, spend);
    // The intent to send, written BEFORE the request. After it, it would
    // distinguish nothing: anything recorded then already presupposes the POST
    // happened, and the point is to tell a crash before sending from one after.
    if (admission && admission !== 'refused' && this.spendGate
      && !(await this.spendGate.beginTransmission(schemaName, admission as Admission))) {
      throw new BadRequestException(
        'Otro intento ya tiene el derecho de enviar este mensaje; no se envio dos veces.');
    }
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

      // Meta took a message from this account. That is the only proof billing
      // works again, and it is produced by the platform rather than claimed by
      // anybody — so a pause that was in force lifts here, by itself.
      await this.resumeIfPaused(schemaName, phoneNumberId);

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

      // "This business account cannot be billed" is not a transport failure and
      // must not be retried: every attempt is identical and none can succeed
      // until a person adds a card, in Meta, on their own account. Recorded
      // here so the NEXT message is refused before it is even priced.
      await this.observeFunding(schemaName, phoneNumberId, errorCode,
        metaError?.error_data?.details ?? errorMessage);

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
  private async admitSpend(schemaName: string, phoneNumberId: string, payload: any,
    templateName?: string, spend?: WhatsappSendSpendContext) {
    if (!this.spendGate) return null;
    try {
      // The approval category, from the row the template sync wrote. Read here
      // rather than demanded from every caller: five public methods and a dozen
      // producers would each have had to remember, and the one that forgot
      // would have priced a campaign as a reply.
      const category = spend?.templateCategory ?? (templateName
        ? await this.templateCategory(schemaName, templateName)
        : null);
      const admission = await this.spendGate.admitBySchema(schemaName, {
        channelType: 'whatsapp',
        channelAccountId: phoneNumberId,
        // The recipient is hashed before it travels: this value ends up in an
        // effect key and in log lines.
        recipientRef: createHash('sha256').update(String(payload?.to ?? '')).digest('hex').slice(0, 32),
        // ── The category, from Meta's own approval ─────────────────────
        //
        // This used to pass the literal `'template'`, which is not one of
        // Meta's five: the rate card had no row for it, so every template send
        // priced as unknown and its exposure was invisible. The real category
        // is the one Meta approved the template AS, and it is read from the
        // templates table below.
        template: templateName ? { name: templateName, category } : null,
        // A session message can only be delivered inside the window — Meta
        // refuses it otherwise — so a non-template send here IS `service`.
        insideServiceWindow: templateName ? undefined : true,
        // The destination, read to derive the tariff country and then dropped.
        recipientAddress: String(payload?.to ?? ''),
        // A template is an initiation by definition — it exists to open a
        // conversation outside the 24-hour window — and a session message can
        // only be sent inside one, which means somebody wrote first. The
        // distinction comes from WhatsApp's own rules, not from a guess about
        // what the message says.
        disposition: templateName ? 'proactive' : 'reactive',
        producer: templateName ? 'whatsapp_rest_template' : `whatsapp_rest_${String(payload?.type ?? 'text')}`,
        contentDigest: createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 32),
        admissionReason: 'whatsapp_messaging_service',
        // Without these two the effect can only be counted against the account.
        // With them it also lands on the campaign's own budget and the contact's
        // limit — which is what stops one batch, or one contact, from consuming
        // a whole month.
        taskId: spend?.taskId ?? null,
        contactId: spend?.contactId ?? null,
        ordinal: spend?.ordinal ?? 0,
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

  /**
   * Tell the pause store what Meta just said, if what it said was about money.
   *
   * Never throws and never blocks: this runs after a message has already
   * failed, and failing to record why must not become a second failure that
   * hides the first.
   */
  private async observeFunding(schemaName: string, phoneNumberId: string,
    code: unknown, detail: unknown) {
    if (!this.pauses || !this.spendGate) return;
    try {
      const tenantId = await this.spendGate.tenantForSchema(schemaName);
      if (!tenantId) return;
      await this.pauses.observeFunding(tenantId, phoneNumberId,
        { source: 'http_response', code, detail });
    } catch (error: any) {
      this.logger.error(`[Pause] funding signal not recorded: ${error?.message}`);
    }
  }

  private async resumeIfPaused(schemaName: string, phoneNumberId: string) {
    if (!this.pauses || !this.spendGate) return;
    try {
      const tenantId = await this.spendGate.tenantForSchema(schemaName);
      if (!tenantId) return;
      await this.pauses.clear(tenantId, phoneNumberId, { by: 'provider_accepted' });
    } catch { /* a resumed account that stays marked paused is visible and safe */ }
  }

  /**
   * Meta's approved category for one template, from the row the sync wrote.
   *
   * Returns null rather than throwing: a lookup that fails leaves the category
   * unknown, which is a diagnosis the admission already knows how to give. It
   * must never become a reason not to send.
   */
  private async templateCategory(schemaName: string, templateName: string): Promise<string | null> {
    try {
      const rows = await this.prisma.executeInTenantSchema<any[]>(
        schemaName,
        `SELECT category FROM whatsapp_templates
          WHERE name = $1 AND category IS NOT NULL
          ORDER BY last_sync_at DESC NULLS LAST LIMIT 1`,
        [templateName],
      );
      return rows?.[0]?.category ?? null;
    } catch (error: any) {
      this.logger.warn(`[Spend] template category unreadable for ${templateName}: ${error?.message}`);
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
