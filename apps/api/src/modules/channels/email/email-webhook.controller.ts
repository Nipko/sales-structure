import {
    Controller,
    Post,
    Body,
    Logger,
    Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ChannelGatewayService } from '../channel-gateway.service';
import { RedisService } from '../../redis/redis.service';
import { EmailChannelService } from './email-channel.service';
import { InboundQueueService } from '../../inbound/inbound-queue.service';

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
        private readonly emailChannelService: EmailChannelService,
        private readonly inboundQueue: InboundQueueService,
    ) {}

    @Post('inbound')
    @ApiOperation({ summary: 'Receive inbound email webhook (SendGrid Inbound Parse)' })
    async receiveInboundEmail(
        @Body() body: any,
        @Res() res: Response,
    ) {
        // ACK after the message is durable in the queue, not before: the reply
        // used to run as a floating promise behind this early 200, so an API
        // restart killed it with nothing left to retry. SendGrid retries a
        // non-2xx for ~72h, so a failure here is recoverable.
        try {
            // 1. Extract recipient email to resolve tenant
            const toRaw = body?.to || body?.envelope?.to?.[0] || '';
            const toEmail = this.extractEmailAddress(toRaw);

            if (!toEmail) {
                this.logger.warn('Inbound email webhook missing recipient address');
                return res.status(200).send('OK');
            }

            // 2. Extract Message-ID for idempotency
            const headers = body?.headers || '';
            const messageId = this.extractHeader(headers, 'Message-ID')
                || body?.['message-id']
                || '';

            // Idempotency: SET NX is atomic. The previous GET-then-SET let two
            // concurrent deliveries of the same Message-ID both pass the check.
            // (The queue's deterministic jobId is the durable backstop.)
            if (messageId) {
                const claimed = await this.redis.acquireLock(`idem:email:${messageId}`, 86400);
                if (!claimed) {
                    this.logger.debug(`Duplicate email webhook ignored: ${messageId}`);
                    return res.status(200).send('OK');
                }
            }

            // 3. Resolve tenant by matching recipient email to email_channel_configs
            const tenantId = await this.emailChannelService.findTenantByInboundEmail(toEmail);

            if (!tenantId) {
                this.logger.warn(`No tenant found for inbound email to: ${toEmail}`);
                return res.status(200).send('OK');
            }

            // 4. Process through the gateway adapter
            const normalized = await this.gateway.processIncomingWebhook('email', body, toEmail);
            if (!normalized) return res.status(200).send('OK');

            normalized.tenantId = tenantId;

            this.logger.log(`Incoming email for tenant ${tenantId} from ${normalized.contactId} subject="${(normalized.metadata as any)?.emailSubject || ''}"`.substring(0, 200));

            // 5. Hand to the inbound queue (durable) and only then ACK.
            await this.inboundQueue.enqueue(normalized);
        } catch (error) {
            this.logger.error(`Error processing inbound email webhook: ${error}`);
            return res.status(500).send('retry');
        }

        return res.status(200).send('OK');
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
