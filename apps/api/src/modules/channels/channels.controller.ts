import { Controller, Get, Post, Body, Query, Param, Req, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChannelGatewayService } from './channel-gateway.service';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelType } from '@parallext/shared';

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
    async receiveWhatsApp(@Body() body: any, @Res() res: Response) {
        res.status(200).send('OK');

        try {
            const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
            if (!phoneNumberId) return;

            const channelAccount = await this.prisma.channelAccount.findFirst({
                where: { channelType: 'whatsapp', accountId: phoneNumberId, isActive: true },
            });

            if (!channelAccount) {
                this.logger.warn(`No tenant found for WhatsApp phone_number_id: ${phoneNumberId}`);
                return;
            }

            const normalized = await this.gateway.processIncomingWebhook('whatsapp', body, phoneNumberId);
            if (!normalized) return;

            normalized.tenantId = channelAccount.tenantId;
            this.logger.log(`Incoming WhatsApp message for tenant ${channelAccount.tenantId} from ${normalized.contactId}`);
        } catch (error) {
            this.logger.error(`Error processing WhatsApp webhook: ${error}`);
        }
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
    async receiveInstagram(@Body() body: any, @Res() res: Response) {
        res.status(200).send('OK');

        try {
            const igUserId = body?.entry?.[0]?.id;
            if (!igUserId) return;

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
    async receiveMessenger(@Body() body: any, @Res() res: Response) {
        res.status(200).send('OK');

        try {
            const pageId = body?.entry?.[0]?.id;
            if (!pageId) return;

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
        } catch (error) {
            this.logger.error(`Error processing Messenger webhook: ${error}`);
        }
    }

    // ==========================================
    // Telegram
    // ==========================================

    @Post('webhook/telegram')
    @ApiOperation({ summary: 'Receive Telegram Bot webhook updates' })
    async receiveTelegram(@Body() body: any, @Res() res: Response) {
        res.status(200).send('OK');

        try {
            // Telegram sends Update objects directly
            // The bot token is used to identify which tenant owns the bot
            const botId = body?.message?.from?.is_bot ? body?.message?.from?.id?.toString() : null;

            // Try to find the tenant by any configured telegram channel account
            const channelAccount = await this.prisma.channelAccount.findFirst({
                where: { channelType: 'telegram', isActive: true },
            });

            if (!channelAccount) {
                this.logger.warn('No tenant configured for Telegram');
                return;
            }

            const normalized = await this.gateway.processIncomingWebhook('telegram', body, channelAccount.accountId);
            if (!normalized) return;

            normalized.tenantId = channelAccount.tenantId;
            this.logger.log(`Incoming Telegram message for tenant ${channelAccount.tenantId} from ${normalized.contactId}`);
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
        res.status(200).send('OK');

        try {
            const normalized = await this.gateway.processIncomingWebhook(channelType as ChannelType, body, '');
            if (!normalized) return;

            this.logger.log(`Incoming ${channelType} message: ${normalized.contactId}`);
        } catch (error) {
            this.logger.error(`Error processing ${channelType} webhook: ${error}`);
        }
    }
}


