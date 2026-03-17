import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ComplianceService } from '../../analytics/compliance.service';
import * as crypto from 'crypto';

@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

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

  // TODO: Add Signature verification middleware later

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
         
         // Mocking the tenant lookup for vertical slice 
         // In production: search tenant by phoneNumberId in a shared registry
         const tenantId = 'demo-tenant-1'; 
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
}
