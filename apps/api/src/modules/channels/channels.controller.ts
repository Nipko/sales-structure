import { Controller, Get, Post, Body, Query, Param, Req, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChannelGatewayService } from './channel-gateway.service';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelType } from '@parallext/shared';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
    private readonly logger = new Logger(ChannelsController.name);

    constructor(
        private gateway: ChannelGatewayService,
        private whatsappAdapter: WhatsAppAdapter,
        private prisma: PrismaService,
    ) { }

    /**
     * WhatsApp webhook verification (GET)
     */
    @Get('webhook/whatsapp')
    @ApiOperation({ summary: 'WhatsApp webhook verification' })
    verifyWhatsApp(@Query() query: any, @Res() res: Response) {
        const challenge = this.whatsappAdapter.verifyWebhook(query);
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    /**
     * WhatsApp webhook receiver (POST)
     */
    @Post('webhook/whatsapp')
    @ApiOperation({ summary: 'Receive WhatsApp webhook events' })
    async receiveWhatsApp(@Body() body: any, @Res() res: Response) {
        // Always respond 200 immediately (Meta requirement)
        res.status(200).send('OK');

        try {
            // Extract phone_number_id from webhook
            const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
            if (!phoneNumberId) return;

            // Find tenant by channel account
            const channelAccount = await this.prisma.channelAccount.findFirst({
                where: {
                    channelType: 'whatsapp',
                    accountId: phoneNumberId,
                    isActive: true,
                },
            });

            if (!channelAccount) {
                this.logger.warn(`No tenant found for WhatsApp phone_number_id: ${phoneNumberId}`);
                return;
            }

            // Normalize the message
            const normalized = await this.gateway.processIncomingWebhook('whatsapp', body, phoneNumberId);
            if (!normalized) return;

            // Set the tenant ID
            normalized.tenantId = channelAccount.tenantId;

            this.logger.log(`Incoming WhatsApp message for tenant ${channelAccount.tenantId} from ${normalized.contactId}`);

            // TODO: Queue message for processing by the Conversation Orchestrator
            // await this.messageQueue.add('process-message', normalized);

        } catch (error) {
            this.logger.error(`Error processing WhatsApp webhook: ${error}`);
        }
    }

    /**
     * Generic webhook for other channels (future: Instagram, Messenger, Telegram)
     */
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
            // TODO: Queue for processing
        } catch (error) {
            this.logger.error(`Error processing ${channelType} webhook: ${error}`);
        }
    }
}
