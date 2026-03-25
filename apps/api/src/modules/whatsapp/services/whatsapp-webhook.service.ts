import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ComplianceService } from '../../analytics/compliance.service';
import * as crypto from 'crypto';

@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  // In-memory cache: phoneNumberId → { tenantId, schemaName }
  private tenantCache = new Map<string, { tenantId: string; expiresAt: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversationsService: ConversationsService,
    private readonly complianceService: ComplianceService,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string) {
    const verifyToken = this.getVerifyToken();

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verified correctly by Meta');
      return challenge;
    }

    this.logger.warn(`Failed webhook verification. Mode: ${mode}, Token passed: ${token}`);
    throw new BadRequestException('Verificación de webhook fallida');
  }

  getVerifyToken(): string {
    return (
      this.configService.get<string>('META_VERIFY_TOKEN') ||
      this.configService.get<string>('WHATSAPP_VERIFY_TOKEN') ||
      ''
    );
  }

  validateSignature(rawBody: Buffer | string | undefined, signature?: string): boolean {
    if (!signature) return false;

    const appSecret = this.configService.get<string>('META_APP_SECRET')
      || this.configService.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      // Fail-safe in production.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('META_APP_SECRET is required in production for webhook signature validation');
        return false;
      }
      this.logger.warn('META_APP_SECRET not configured — skipping signature validation (DEV ONLY)');
      return true;
    }

    if (!rawBody) {
      this.logger.warn('Raw body not available for signature validation');
      return false;
    }

    try {
      const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
      const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(bodyBuffer).digest('hex')}`;
      const receivedBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);
      if (receivedBuffer.length !== expectedBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
    } catch (error: any) {
      this.logger.error(`Error validating webhook signature: ${error.message}`);
      return false;
    }
  }

  async handleWebhookPayload(payload: any) {
    let handled = false;

    if (payload.object === 'whatsapp_business_account') {
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            const value = change.value || {};
            const phoneNumberId = value.metadata?.phone_number_id;

            if (phoneNumberId) {
              await this.processMessageEvent(phoneNumberId, value);
              handled = true;
            }
          }
        }
      }
    }

    if (!handled) {
      this.logger.debug(`Unhandled webhook payload type: ${JSON.stringify(payload)}`);
    }
  }

  private async processMessageEvent(phoneNumberId: string, value: any) {
    this.logger.log(`Processing message event for phone_number_id: ${phoneNumberId}`);

    const tenantId = await this.resolveTenantId(phoneNumberId);
    if (!tenantId) {
      this.logger.warn(`No tenant found for phoneNumberId: ${phoneNumberId} — ignoring message`);
      return;
    }

    const schemaName = await this.prisma.getTenantSchemaName(tenantId);
    const contacts: any[] = value.contacts || [];
    const contactsByWaId = new Map<string, any>(
      contacts
        .filter((c) => typeof c?.wa_id === 'string')
        .map((c) => [c.wa_id, c]),
    );

    for (const msg of value.messages || []) {
      await this.processInboundMessage(tenantId, schemaName, phoneNumberId, msg, contactsByWaId, contacts);
    }

    for (const status of value.statuses || []) {
      await this.processStatusUpdate(schemaName, status);
    }
  }

  private async processInboundMessage(
    tenantId: string,
    schemaName: string,
    phoneNumberId: string,
    msg: any,
    contactsByWaId: Map<string, any>,
    contacts: any[],
  ) {
    const waMessageId = msg?.id;
    if (!waMessageId) return;

    // Dedupe Meta retries.
    const existing = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT id FROM messages WHERE external_id = $1 LIMIT 1`,
      [waMessageId],
    );
    if (existing?.length) {
      this.logger.debug(`Duplicate inbound WhatsApp message ignored: ${waMessageId}`);
      return;
    }

    const contact = contactsByWaId.get(msg.from) || contacts[0];
    const content = this.parseIncomingContent(msg);
    const text = content.type === 'text' ? (content as any).text || '' : '';

    if (text && this.complianceService.detectOptOut(text)) {
      this.logger.warn(`OptOut detected from ${msg.from}: "${text}"`);
      await this.complianceService.processOptOut(tenantId, {
        phone: msg.from,
        channel: 'whatsapp',
        triggerMessage: text,
        detectedFrom: 'keyword',
      });
      return;
    }

    const normalizedMsg = {
      tenantId,
      contactId: msg.from,
      channelType: 'whatsapp',
      channelAccountId: phoneNumberId,
      content,
      metadata: {
        contactName: contact?.profile?.name,
        waMessageId,
        phoneNumberId,
      },
    };

    try {
      await this.conversationsService.processIncomingMessage(normalizedMsg as any);
    } catch (error: any) {
      this.logger.error(`Error processing incoming message: ${error.message}`, error.stack);
    }
  }

  private async processStatusUpdate(schemaName: string, status: any) {
    const providerMessageId = status?.id;
    const providerStatus = status?.status;
    if (!providerMessageId || !providerStatus) return;

    try {
      await this.prisma.executeInTenantSchema(
        schemaName,
        `UPDATE whatsapp_message_logs
         SET status = $1,
             delivered_at = CASE WHEN $1 = 'delivered' AND delivered_at IS NULL THEN NOW() ELSE delivered_at END,
             read_at = CASE WHEN $1 = 'read' AND read_at IS NULL THEN NOW() ELSE read_at END
         WHERE provider_message_id = $2`,
        [providerStatus, providerMessageId],
      );

      await this.prisma.executeInTenantSchema(
        schemaName,
        `UPDATE messages SET status = $1 WHERE external_id = $2`,
        [providerStatus, providerMessageId],
      );
    } catch (error: any) {
      this.logger.warn(`Could not apply status update for ${providerMessageId}: ${error.message}`);
    }
  }

  private parseIncomingContent(message: any): any {
    switch (message?.type) {
      case 'text':
        return { type: 'text', text: message.text?.body || '' };
      case 'image':
        return {
          type: 'image',
          mediaUrl: message.image?.id,
          caption: message.image?.caption,
          mimeType: message.image?.mime_type,
        };
      case 'audio':
        return {
          type: 'audio',
          mediaUrl: message.audio?.id,
          mimeType: message.audio?.mime_type,
        };
      case 'video':
        return {
          type: 'video',
          mediaUrl: message.video?.id,
          caption: message.video?.caption,
          mimeType: message.video?.mime_type,
        };
      case 'document':
        return {
          type: 'document',
          mediaUrl: message.document?.id,
          filename: message.document?.filename,
          mimeType: message.document?.mime_type,
        };
      case 'location':
        return {
          type: 'location',
          latitude: message.location?.latitude,
          longitude: message.location?.longitude,
          text: message.location?.name,
        };
      case 'button':
        return { type: 'text', text: message.button?.text || '' };
      case 'interactive':
        return {
          type: 'text',
          text: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '',
        };
      default:
        return { type: 'text', text: `[${message?.type || 'unknown'}]` };
    }
  }

  /**
   * Resolve tenantId from phone_number_id using channel_accounts table.
   * Uses in-memory cache with 5-minute TTL to avoid DB hits on every webhook.
   */
  private async resolveTenantId(phoneNumberId: string): Promise<string | null> {
    // Check in-memory cache first
    const cached = this.tenantCache.get(phoneNumberId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tenantId;
    }

    // Query channel_accounts table (public schema)
    try {
      const account = await this.prisma.channelAccount.findFirst({
        where: {
          channelType: 'whatsapp',
          accountId: phoneNumberId,
          isActive: true,
        },
        select: { tenantId: true },
      });

      if (!account) {
        this.logger.warn(`No active channel_account for phoneNumberId: ${phoneNumberId}`);
        return null;
      }

      // Cache for 5 minutes
      this.tenantCache.set(phoneNumberId, {
        tenantId: account.tenantId,
        expiresAt: Date.now() + this.CACHE_TTL,
      });

      return account.tenantId;
    } catch (error: any) {
      this.logger.error(`Error resolving tenant for phoneNumberId ${phoneNumberId}: ${error.message}`);
      return null;
    }
  }
}
