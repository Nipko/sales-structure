import { Injectable, Logger, BadRequestException } from '@nestjs/common';
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
    private readonly conversationsService: ConversationsService,
    private readonly complianceService: ComplianceService,
  ) {}

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

    if (payload.object === 'whatsapp_business_account') {
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.field === 'messages') {
            const value = change.value;
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
     
     if (value.messages && value.messages.length > 0) {
         const msg = value.messages[0];
         const contact = value.contacts?.[0];

         // === FIX: Dynamic tenant resolution by phoneNumberId ===
         const tenantId = await this.resolveTenantId(phoneNumberId);
         if (!tenantId) {
           this.logger.warn(`No tenant found for phoneNumberId: ${phoneNumberId} — ignoring message`);
           return;
         }

         const fromPhone = msg.from;
         const messageText = msg.text?.body || '';

         // ---- Compliance: Opt-out detection ----
         if (messageText && this.complianceService.detectOptOut(messageText)) {
             this.logger.warn(`OptOut detected from ${fromPhone}: "${messageText}"`);
             await this.complianceService.processOptOut(tenantId, {
                 phone: fromPhone,
                 channel: 'whatsapp',
                 triggerMessage: messageText,
                 detectedFrom: 'keyword',
             });
             // Do NOT pass this message to AI/Conversations — respecting opt-out
             return;
         }

         const normalizedMsg = {
             tenantId,
             contactId: fromPhone,
             channelType: 'whatsapp',
             channelAccountId: phoneNumberId,
             content: { type: msg.type, text: messageText },
             metadata: { contactName: contact?.profile?.name }
         };
         
         try {
             await this.conversationsService.processIncomingMessage(normalizedMsg as any);
         } catch (error: any) {
             this.logger.error(`Error processing incoming message: ${error.message}`, error.stack);
         }
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
