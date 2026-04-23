import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ComplianceService } from '../../analytics/compliance.service';
import { WhatsappConnectionService } from './whatsapp-connection.service';
import { WhatsAppAdapter } from '../../channels/whatsapp/whatsapp.adapter';
import { RedisService } from '../../redis/redis.service';
import * as crypto from 'crypto';

@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  // In-memory cache: phoneNumberId → { tenantId, schemaName }
  private tenantCache = new Map<string, { tenantId: string; expiresAt: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Idempotency: processed message IDs (Redis-backed, see checkIdempotency)
  private readonly IDEMPOTENCY_TTL = 86400; // 24h

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversationsService: ConversationsService,
    private readonly complianceService: ComplianceService,
    private readonly whatsappConnection: WhatsappConnectionService,
    private readonly whatsappAdapter: WhatsAppAdapter,
    private readonly redis: RedisService,
  ) {}

  /**
   * Get the configured verify token for webhook setup display
   */
  getVerifyToken(): string {
    return this.configService.get<string>('WHATSAPP_VERIFY_TOKEN')
      || this.configService.get<string>('META_VERIFY_TOKEN')
      || '';
  }

  /**
   * Validate HMAC-SHA256 signature from Meta webhook
   */
  validateSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature) return false;

    const appSecret = this.configService.get<string>('META_APP_SECRET');
    if (!appSecret) {
      this.logger.warn('META_APP_SECRET not configured — skipping signature validation');
      return true; // Allow in dev if secret not set
    }

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  }

  verifyWebhook(mode: string, token: string, challenge: string) {
    const verifyToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verified correctly by Meta');
      return challenge;
    }

    this.logger.warn(`Failed webhook verification. Mode: ${mode}, Token passed: ${token}`);
    throw new BadRequestException('Verificación de webhook fallida');
  }

  async handleWebhookPayload(payload: any) {
    let handled = false;

    if (payload?.object === 'whatsapp_business_account') {
      const entries = payload?.entry ?? [];
      for (const entry of entries) {
        const wabaId = entry?.id as string | undefined;
        const changes = entry?.changes ?? [];
        for (const change of changes) {
          if (change?.field === 'messages') {
            const value = change?.value;
            const phoneNumberId = value?.metadata?.phone_number_id;

            if (phoneNumberId) {
               await this.processMessageEvent(phoneNumberId, value);
               handled = true;
            }
          } else if (change?.field === 'message_template_status_update' && wabaId) {
            await this.processTemplateStatusEvent(wabaId, change.value);
            handled = true;
          }
        }
      }
    }

    if (!handled) {
      this.logger.debug(`Unhandled webhook payload type: ${JSON.stringify(payload)}`);
    }
  }

  /**
   * Handle Meta's `message_template_status_update` field. Resolves the tenant
   * from the WABA id and delegates to WhatsappTemplateService. Never throws —
   * webhook processing must always return 200 or Meta will retry.
   */
  private async processTemplateStatusEvent(wabaId: string, value: any) {
    try {
      const tenantInfo = await this.resolveTenantFromWabaId(wabaId);
      if (!tenantInfo) {
        this.logger.warn(`No tenant found for WABA ${wabaId}, skipping template status update`);
        return;
      }

      const event = {
        message_template_id: String(value?.message_template_id || ''),
        message_template_name: String(value?.message_template_name || ''),
        message_template_language: String(value?.message_template_language || ''),
        event: String(value?.event || 'PENDING'),
        reason: value?.reason ? String(value.reason) : undefined,
      };

      await this.prisma.executeInTenantSchema(
        tenantInfo.schemaName,
        `UPDATE whatsapp_templates
            SET approval_status = $1,
                rejected_reason = $2,
                last_sync_at = NOW(),
                updated_at = NOW()
          WHERE meta_template_id = $3
             OR (name = $4 AND language = $5)`,
        [event.event, event.reason && event.reason !== 'NONE' ? event.reason : null,
         event.message_template_id, event.message_template_name, event.message_template_language],
      );
      this.logger.log(`Template status applied: ${event.message_template_name} (${event.message_template_language}) → ${event.event}`);
    } catch (err: any) {
      this.logger.warn(`Failed to process template status update for WABA ${wabaId}: ${err.message}`);
    }
  }

  private async resolveTenantFromWabaId(wabaId: string): Promise<{ tenantId: string; schemaName: string } | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; schema_name: string }>>`
        SELECT id, schema_name FROM tenants WHERE is_active = true
      `;
      for (const t of rows) {
        try {
          const match = await this.prisma.executeInTenantSchema<any[]>(
            t.schema_name,
            `SELECT 1 FROM whatsapp_channels WHERE meta_waba_id = $1 LIMIT 1`,
            [wabaId],
          );
          if (match.length > 0) return { tenantId: t.id, schemaName: t.schema_name };
        } catch {}
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`resolveTenantFromWabaId failed: ${e.message}`);
      return null;
    }
  }

  private async processMessageEvent(phoneNumberId: string, value: any) {
     this.logger.log(`Processing message event for phone_number_id: ${phoneNumberId}`);

     if (!value?.messages || value.messages.length === 0) return;

     const msg = value.messages[0];
     const contact = value?.contacts?.[0];
     const waMessageId = msg?.id; // wamid.xxx

     // === Idempotency check (Blueprint Paso 7) ===
     const idempotencyKey = `idem:wa:${waMessageId}`;
     const alreadyProcessed = await this.redis.get(idempotencyKey);
     if (alreadyProcessed) {
         this.logger.debug(`Duplicate webhook for message ${waMessageId}, skipping`);
         return;
     }
     // Mark as processing immediately to prevent race conditions
     await this.redis.set(idempotencyKey, '1', this.IDEMPOTENCY_TTL);

     // === Dynamic tenant resolution ===
     const tenantId = await this.resolveTenantId(phoneNumberId);
     if (!tenantId) {
         this.logger.warn(`No tenant found for phoneNumberId: ${phoneNumberId} — ignoring message`);
         return;
     }

     // === Read receipt — checks azules (Blueprint Paso 6) ===
     // Fire immediately, don't await — don't block message processing
     if (waMessageId) {
         this.resolveAccessTokenAndMarkRead(tenantId, phoneNumberId, waMessageId);
     }

     const fromPhone = msg?.from;
     const messageText = msg?.text?.body || '';

     // === Compliance: Opt-out detection (registers for admin review, does NOT block message) ===
     if (messageText && this.complianceService.detectOptOut(messageText)) {
         this.logger.warn(`OptOut candidate from ${fromPhone}: "${messageText}" — pending admin review`);
         this.complianceService.processOptOut(tenantId, {
             phone: fromPhone,
             channel: 'whatsapp',
             triggerMessage: messageText,
             detectedFrom: 'keyword',
         }).catch(e => this.logger.error(`OptOut registration failed: ${e.message}`));
         // Message continues to AI pipeline — admin reviews opt-out later
     }

     const normalizedMsg = {
         tenantId,
         contactId: fromPhone,
         channelType: 'whatsapp',
         channelAccountId: phoneNumberId,
         content: { type: msg.type, text: messageText },
         metadata: {
             contactName: contact?.profile?.name,
             waMessageId,
         },
     };

     try {
         await this.conversationsService.processIncomingMessage(normalizedMsg as any);
     } catch (error: any) {
         this.logger.error(`Error processing incoming message: ${error.message}`, error.stack);
     }
  }

  /**
   * Resolve access token for a tenant and send read receipt.
   * Fire-and-forget — errors are logged but don't block processing.
   */
  private resolveAccessTokenAndMarkRead(tenantId: string, phoneNumberId: string, waMessageId: string): void {
      this.prisma.getTenantSchemaName(tenantId)
          .then(schemaName => this.whatsappConnection.getValidAccessToken(schemaName))
          .then(creds => {
              this.whatsappAdapter.markAsRead(phoneNumberId, waMessageId, creds.accessToken);
          })
          .catch(e => {
              this.logger.warn(`Could not send read receipt for ${waMessageId}: ${e.message}`);
          });
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
