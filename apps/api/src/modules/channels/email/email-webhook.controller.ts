import {
    Controller,
    Post,
    Body,
    Req,
    Logger,
    Res,
} from '@nestjs/common';
import { ApiConsumes, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { ChannelGatewayService } from '../channel-gateway.service';
import { RedisService } from '../../redis/redis.service';
import { EmailChannelService } from './email-channel.service';
import { InboundQueueService } from '../../inbound/inbound-queue.service';
import { EmailWebhookSecurityService } from './email-webhook-security.service';
import { canonicalEmailMessageId } from './email-message-id.util';

/**
 * Email Inbound Webhook Controller
 *
 * Managed endpoint that receives authenticated inbound email webhooks from a
 * trusted provider or reverse proxy. It is not a tenant self-service API.
 *
 * POST /api/v1/channels/email/inbound
 *
 * Contract: application/json from a managed provider adapter/reverse proxy.
 * Direct provider multipart is intentionally unsupported. The JSON includes a
 * canonical SMTP envelope plus bounded message fields.
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
        private readonly security: EmailWebhookSecurityService,
    ) {}

    @Post('inbound')
    @ApiOperation({ summary: 'Receive an authenticated managed inbound email webhook' })
    @ApiConsumes('application/json')
    @ApiHeader({
        name: 'X-Email-Webhook-Secret',
        required: true,
        description: 'Platform-managed shared secret (header name is runtime-configurable)',
    })
    @ApiResponse({ status: 401, description: 'Missing or invalid webhook secret' })
    @ApiResponse({ status: 413, description: 'Payload exceeds the configured limit' })
    @ApiResponse({ status: 415, description: 'Only authenticated JSON is accepted' })
    @ApiResponse({ status: 429, description: 'Webhook rate limit exceeded' })
    @ApiResponse({ status: 503, description: 'Inbound webhook secret is not configured' })
    async receiveInboundEmail(
        @Req() req: Request,
        @Body() body: unknown,
        @Res() res: Response,
    ) {
        // This is deliberately the first operation. No tenant lookup, Redis
        // idempotency claim or queue access is allowed before authenticity and
        // payload bounds have been established.
        const safeBody = await this.security.protect(req, body);

        // ACK after the message is durable in the queue, not before: the reply
        // used to run as a floating promise behind this early 200, so an API
        // restart killed it with nothing left to retry. The managed provider
        // adapter must retry non-2xx responses, so a failure here is recoverable.
        let processingLockKey: string | null = null;
        let processingLockToken: string | null = null;
        try {
            // 1. Extract recipient email to resolve tenant
            const envelope = safeBody.envelope as { to?: string[] } | undefined;
            const toEmail = envelope?.to?.[0] || '';

            if (!toEmail) {
                this.logger.warn('Inbound email webhook missing recipient address');
                return res.status(400).send('invalid envelope');
            }

            // 2. Resolve the tenant only from the canonical authenticated
            // envelope. Display headers (`body.to`) never participate.
            const tenantId = await this.emailChannelService.findTenantByInboundEmail(toEmail);

            if (!tenantId) {
                this.logger.warn('Inbound email route is not uniquely configured; delivery ignored');
                return res.status(200).send('OK');
            }
            const routeHash = createHash('sha256')
                .update(`${tenantId}:${toEmail}`, 'utf8')
                .digest('hex')
                .slice(0, 16);

            // 3. Extract Message-ID for tenant-scoped idempotency.
            const messageId = canonicalEmailMessageId(safeBody);
            if (messageId) {
                // The adapter consumes this same canonical value. This matters
                // when Queue.add succeeded but writing the completed marker did
                // not: the provider retry derives the identical BullMQ jobId.
                safeBody['message-id'] = messageId;
            }

            let completedKey: string | null = null;
            let messageIdDigest: string | null = null;
            if (messageId) {
                messageIdDigest = createHash('sha256').update(messageId, 'utf8').digest('hex');
                completedKey = `idem:email:${tenantId}:${messageIdDigest}`;
                if (await this.redis.get(completedKey)) {
                    this.logger.debug(`Duplicate email webhook ignored: ${messageIdDigest.slice(0, 12)}`);
                    return res.status(200).send('OK');
                }

                // A short ownership-token lock serializes concurrent deliveries.
                // It is released on every failure so the provider retry is not
                // suppressed. The durable completed marker is written only
                // after enqueue succeeds.
                processingLockKey = `lock:email:${tenantId}:${messageIdDigest}`;
                processingLockToken = await this.redis.acquireLockToken(processingLockKey, 300);
                if (!processingLockToken) {
                    return res.status(503).send('retry');
                }
                // Covers the small race where another request completed between
                // our initial marker check and lock acquisition.
                if (await this.redis.get(completedKey)) {
                    return res.status(200).send('OK');
                }
            }

            // 4. Process through the gateway adapter.
            const normalized = await this.gateway.processIncomingWebhook('email', safeBody, toEmail);
            if (!normalized) return res.status(200).send('OK');

            normalized.tenantId = tenantId;

            // Operational correlation without logging tenant IDs, addresses,
            // sender identity, subject or message content.
            this.logger.log(
                `Incoming email accepted routeHash=${routeHash} messageHash=${messageIdDigest?.slice(0, 16) || 'none'}`,
            );

            // 5. Hand to the inbound queue (durable) and only then ACK.
            await this.inboundQueue.enqueue(normalized);
            if (completedKey) {
                await this.redis.set(completedKey, '1', 86400);
            }

            return res.status(200).send('OK');
        } catch (error) {
            this.logger.error(`Error processing inbound email webhook: ${error}`);
            return res.status(500).send('retry');
        } finally {
            if (processingLockKey && processingLockToken) {
                await this.redis.releaseLockToken(processingLockKey, processingLockToken)
                    .catch(error => this.logger.error(`Failed to release inbound email lock: ${error}`));
            }
        }
    }

}
