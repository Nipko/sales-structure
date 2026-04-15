import {
    Controller,
    Get,
    Post,
    Body,
    Query,
    Param,
    Res,
    Logger,
    Inject,
    forwardRef,
    Headers,
    Req,
    RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChannelGatewayService } from './channel-gateway.service';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelType } from '@parallext/shared';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappWebhookService } from '../whatsapp/services/whatsapp-webhook.service';
import { validateMetaSignature } from './meta-signature.util';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
    private readonly logger = new Logger(ChannelsController.name);

    constructor(
        private gateway: ChannelGatewayService,
        private whatsappAdapter: WhatsAppAdapter,
        private instagramAdapter: InstagramAdapter,
        private messengerAdapter: MessengerAdapter,
        private telegramAdapter: TelegramAdapter,
        private prisma: PrismaService,
        @Inject(forwardRef(() => ConversationsService))
        private conversationsService: ConversationsService,
        @Inject(forwardRef(() => WhatsappWebhookService))
        private whatsappWebhookService: WhatsappWebhookService,
        private configService: ConfigService,
        private redis: RedisService,
    ) { }

    // ==========================================
    // WhatsApp
    // ==========================================

    @Get('webhook/whatsapp')
    @ApiOperation({ summary: 'WhatsApp webhook verification' })
    verifyWhatsApp(@Query() query: any, @Res() res: Response) {
        const challenge = this.whatsappAdapter.verifyWebhook(query);
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    @Post('webhook/whatsapp')
    @ApiOperation({ summary: 'Receive WhatsApp webhook events' })
    async receiveWhatsApp(
        @Body() body: any,
        @Headers('x-hub-signature-256') signature: string,
        @Req() req: RawBodyRequest<Request>,
        @Res() res: Response,
    ) {
        if (!this.whatsappWebhookService.validateSignature(req.rawBody, signature)) {
            return res.status(401).send('Invalid signature');
        }

        this.whatsappWebhookService.handleWebhookPayload(body).catch((error) => {
            this.logger.error(`Error processing WhatsApp webhook: ${error}`);
        });

        return res.status(200).send('OK');
    }

    // ==========================================
    // Instagram DM
    // ==========================================

    @Get('webhook/instagram')
    @ApiOperation({ summary: 'Instagram webhook verification' })
    verifyInstagram(@Query() query: any, @Res() res: Response) {
        const challenge = this.instagramAdapter.verifyWebhook(query);
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    @Post('webhook/instagram')
    @ApiOperation({ summary: 'Receive Instagram DM webhook events' })
    async receiveInstagram(
        @Body() body: any,
        @Headers('x-hub-signature-256') signature: string,
        @Req() req: RawBodyRequest<Request>,
        @Res() res: Response,
    ) {
        const appSecret = this.configService.get<string>('META_APP_SECRET') || this.configService.get<string>('WHATSAPP_APP_SECRET');
        if (!validateMetaSignature(req.rawBody, signature, appSecret)) {
            return res.status(401).send('Invalid signature');
        }

        res.status(200).send('OK');

        try {
            const igUserId = body?.entry?.[0]?.id;
            if (!igUserId) return;

            // Idempotency check
            const messageId = body?.entry?.[0]?.messaging?.[0]?.message?.mid;
            if (messageId) {
                const idemKey = `idem:ig:${messageId}`;
                if (await this.redis.get(idemKey)) return;
                await this.redis.set(idemKey, '1', 86400);
            }

            const channelAccount = await this.prisma.channelAccount.findFirst({
                where: { channelType: 'instagram', accountId: igUserId, isActive: true },
            });

            if (!channelAccount) {
                this.logger.warn(`No tenant found for Instagram IG User ID: ${igUserId}`);
                return;
            }

            const normalized = await this.gateway.processIncomingWebhook('instagram', body, igUserId);
            if (!normalized) return;

            normalized.tenantId = channelAccount.tenantId;
            this.logger.log(`Incoming Instagram DM for tenant ${channelAccount.tenantId} from ${normalized.contactId}`);
            await this.conversationsService.processIncomingMessage(normalized);
        } catch (error) {
            this.logger.error(`Error processing Instagram webhook: ${error}`);
        }
    }

    // ==========================================
    // Facebook Messenger
    // ==========================================

    @Get('webhook/messenger')
    @ApiOperation({ summary: 'Messenger webhook verification' })
    verifyMessenger(@Query() query: any, @Res() res: Response) {
        const challenge = this.messengerAdapter.verifyWebhook(query);
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    @Post('webhook/messenger')
    @ApiOperation({ summary: 'Receive Messenger webhook events' })
    async receiveMessenger(
        @Body() body: any,
        @Headers('x-hub-signature-256') signature: string,
        @Req() req: RawBodyRequest<Request>,
        @Res() res: Response,
    ) {
        const appSecret = this.configService.get<string>('META_APP_SECRET') || this.configService.get<string>('WHATSAPP_APP_SECRET');
        if (!validateMetaSignature(req.rawBody, signature, appSecret)) {
            return res.status(401).send('Invalid signature');
        }

        res.status(200).send('OK');

        try {
            const pageId = body?.entry?.[0]?.id;
            if (!pageId) return;

            // Idempotency check
            const messageId = body?.entry?.[0]?.messaging?.[0]?.message?.mid;
            if (messageId) {
                const idemKey = `idem:fb:${messageId}`;
                if (await this.redis.get(idemKey)) return;
                await this.redis.set(idemKey, '1', 86400);
            }

            const channelAccount = await this.prisma.channelAccount.findFirst({
                where: { channelType: 'messenger', accountId: pageId, isActive: true },
            });

            if (!channelAccount) {
                this.logger.warn(`No tenant found for Messenger Page ID: ${pageId}`);
                return;
            }

            const normalized = await this.gateway.processIncomingWebhook('messenger', body, pageId);
            if (!normalized) return;

            normalized.tenantId = channelAccount.tenantId;
            this.logger.log(`Incoming Messenger message for tenant ${channelAccount.tenantId} from ${normalized.contactId}`);
            await this.conversationsService.processIncomingMessage(normalized);
        } catch (error) {
            this.logger.error(`Error processing Messenger webhook: ${error}`);
        }
    }

    // ==========================================
    // Telegram
    // ==========================================

    @Post('webhook/telegram/:botUsername')
    @ApiOperation({ summary: 'Receive Telegram Bot webhook updates (bot-specific URL)' })
    async receiveTelegramByBot(
        @Param('botUsername') botUsername: string,
        @Body() body: any,
        @Res() res: Response,
    ) {
        res.status(200).send('OK');
        await this.processTelegramUpdate(body, botUsername);
    }

    @Post('webhook/telegram')
    @ApiOperation({ summary: 'Receive Telegram Bot webhook updates (generic)' })
    async receiveTelegram(@Body() body: any, @Res() res: Response) {
        res.status(200).send('OK');
        await this.processTelegramUpdate(body, null);
    }

    private async processTelegramUpdate(body: any, botUsername: string | null): Promise<void> {
        try {
            // Idempotency check via update_id
            const updateId = body?.update_id;
            if (updateId) {
                const idemKey = `idem:tg:${updateId}`;
                if (await this.redis.get(idemKey)) return;
                await this.redis.set(idemKey, '1', 86400);
            }

            // Resolve tenant: prefer bot-specific URL, fallback to chat.id lookup
            let channelAccount: any;

            if (botUsername) {
                channelAccount = await this.prisma.channelAccount.findFirst({
                    where: { channelType: 'telegram', accountId: botUsername, isActive: true },
                });
            }

            if (!channelAccount) {
                // Fallback: find any active Telegram channel account for this bot
                // (for generic webhook URL with single-bot setups)
                channelAccount = await this.prisma.channelAccount.findFirst({
                    where: { channelType: 'telegram', isActive: true },
                });
            }

            if (!channelAccount) {
                this.logger.warn(`No tenant configured for Telegram bot: ${botUsername || 'unknown'}`);
                return;
            }

            const normalized = await this.gateway.processIncomingWebhook('telegram', body, channelAccount.accountId);
            if (!normalized) return;

            normalized.tenantId = channelAccount.tenantId;
            this.logger.log(`Incoming Telegram message for tenant ${channelAccount.tenantId} from ${normalized.contactId}`);
            await this.conversationsService.processIncomingMessage(normalized);
        } catch (error) {
            this.logger.error(`Error processing Telegram webhook: ${error}`);
        }
    }

    // ==========================================
    // Generic (fallback for future channels)
    // ==========================================

    @Post('webhook/:channelType')
    @ApiOperation({ summary: 'Generic channel webhook receiver' })
    async receiveGeneric(
        @Param('channelType') channelType: string,
        @Body() body: any,
        @Res() res: Response,
    ) {
        if (channelType === 'whatsapp') {
            return res.status(400).send('Use /channels/webhook/whatsapp');
        }

        res.status(200).send('OK');

        try {
            const normalized = await this.gateway.processIncomingWebhook(channelType as ChannelType, body, '');
            if (!normalized) return;

            if (!normalized.tenantId) {
                this.logger.warn(`Skipping ${channelType} inbound message without tenant context`);
                return;
            }

            await this.conversationsService.processIncomingMessage(normalized);
            this.logger.log(`Incoming ${channelType} message: ${normalized.contactId}`);
        } catch (error) {
            this.logger.error(`Error processing ${channelType} webhook: ${error}`);
        }
    }
}


