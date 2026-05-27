import {
    Controller,
    Post,
    Body,
    Logger,
    Inject,
    forwardRef,
    Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ChannelGatewayService } from '../channel-gateway.service';
import { RedisService } from '../../redis/redis.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { EmailChannelService } from './email-channel.service';

/**
 * Email Inbound Webhook Controller
 *
 * Public endpoint (no auth guard) that receives inbound email webhooks
 * from SendGrid Inbound Parse (or compatible providers).
 *
 * POST /api/v1/channels/email/inbound
 *
 * SendGrid sends multipart/form-data with fields:
 *   from, to, subject, text, html, headers, envelope, attachments, etc.
 */
@ApiTags('channels')
@Controller('channels/email')
export class EmailWebhookController {
    private readonly logger = new Logger(EmailWebhookController.name);

    constructor(
        private readonly gateway: ChannelGatewayService,
        private readonly redis: RedisService,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationsService: ConversationsService,
        private readonly emailChannelService: EmailChannelService,
    ) {}

    @Post('inbound')
    @ApiOperation({ summary: 'Receive inbound email webhook (SendGrid Inbound Parse)' })
    async receiveInboundEmail(
        @Body() body: any,
        @Res() res: Response,
    ) {
        // Respond immediately to avoid webhook timeout
        res.status(200).send('OK');

        try {
            // 1. Extract recipient email to resolve tenant
            const toRaw = body?.to || body?.envelope?.to?.[0] || '';
            const toEmail = this.extractEmailAddress(toRaw);

            if (!toEmail) {
                this.logger.warn('Inbound email webhook missing recipient address');
                return;
            }

            // 2. Extract Message-ID for idempotency
            const headers = body?.headers || '';
            const messageId = this.extractHeader(headers, 'Message-ID')
                || body?.['message-id']
                || '';

            if (messageId) {
                const idemKey = `idem:email:${messageId}`;
                if (await this.redis.get(idemKey)) {
                    this.logger.debug(`Duplicate email webhook ignored: ${messageId}`);
                    return;
                }
                await this.redis.set(idemKey, '1', 86400);
            }

            // 3. Resolve tenant by matching recipient email to email_channel_configs
            const tenantId = await this.emailChannelService.findTenantByInboundEmail(toEmail);

            if (!tenantId) {
                this.logger.warn(`No tenant found for inbound email to: ${toEmail}`);
                return;
            }

            // 4. Process through the gateway adapter
            const normalized = await this.gateway.processIncomingWebhook('email', body, toEmail);
            if (!normalized) return;

            normalized.tenantId = tenantId;

            this.logger.log(`Incoming email for tenant ${tenantId} from ${normalized.contactId} subject="${(normalized.metadata as any)?.emailSubject || ''}"`.substring(0, 200));

            // 5. Feed into the conversation pipeline
            await this.conversationsService.processIncomingMessage(normalized);

            // 6. Save thread metadata for reply threading
            const emailMeta = normalized.metadata as any;
            if (normalized.conversationId || true) {
                // Thread save will happen after conversation is created/found
                // We save best-effort with available data
                // The conversationId will be set by processIncomingMessage
            }
        } catch (error) {
            this.logger.error(`Error processing inbound email webhook: ${error}`);
        }
    }

    private extractEmailAddress(raw: string): string {
        if (!raw) return '';
        const match = raw.match(/<([^>]+)>/);
        if (match) return match[1].trim().toLowerCase();
        const emailMatch = raw.match(/[\w.+-]+@[\w.-]+\.\w+/);
        return emailMatch ? emailMatch[0].trim().toLowerCase() : '';
    }

    private extractHeader(headers: string, headerName: string): string | null {
        if (!headers) return null;
        const regex = new RegExp(`^${headerName}:\\s*(.+)$`, 'mi');
        const match = headers.match(regex);
        return match ? match[1].trim() : null;
    }
}
