import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService, BROADCAST_QUEUE, BroadcastJobData } from './broadcast.service';

@Processor(BROADCAST_QUEUE, {
    concurrency: 10,
    limiter: {
        max: 80,
        duration: 1000,
    },
})
export class BroadcastQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(BroadcastQueueProcessor.name);

    constructor(
        private readonly messagingService: WhatsappMessagingService,
        private readonly emailService: EmailService,
        private readonly prisma: PrismaService,
        private readonly broadcastService: BroadcastService,
    ) {
        super();
    }

    async process(job: Job<BroadcastJobData>): Promise<string> {
        const { channel, schemaName, campaignId, recipientId } = job.data;

        this.logger.debug(
            `Processing broadcast job ${job.id}: campaign=${campaignId} channel=${channel} attempt=${job.attemptsMade + 1}`,
        );

        try {
            let messageId: string;

            switch (channel) {
                case 'email':
                    messageId = await this.sendEmail(job.data);
                    break;
                case 'sms':
                    messageId = await this.sendSMS(job.data);
                    break;
                case 'whatsapp':
                default:
                    messageId = await this.sendWhatsApp(job.data);
                    break;
            }

            await this.broadcastService.updateRecipientStatus(schemaName, recipientId, 'sent', undefined, messageId);
            this.logger.log(`Broadcast sent: campaign=${campaignId} channel=${channel} messageId=${messageId}`);
            await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);
            return messageId;
        } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error';
            this.logger.error(`Broadcast failed: campaign=${campaignId} channel=${channel} attempt=${job.attemptsMade + 1}/3 error=${errorMessage}`);

            if (job.attemptsMade + 1 >= (job.opts?.attempts || 3)) {
                await this.broadcastService.updateRecipientStatus(schemaName, recipientId, 'failed', errorMessage);
                await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);
            }

            throw error;
        }
    }

    private async sendWhatsApp(data: BroadcastJobData): Promise<string> {
        const result = await this.messagingService.sendTemplate(
            data.schemaName,
            data.phone,
            data.templateName,
            data.templateLanguage,
            data.templateComponents,
        );
        return result.messageId;
    }

    private async sendEmail(data: BroadcastJobData): Promise<string> {
        if (!data.email) throw new Error('No email address for recipient');
        if (!data.emailSubject) throw new Error('No email subject configured');

        const sent = await this.emailService.send({
            to: data.email,
            subject: data.emailSubject,
            html: data.emailHtml || undefined,
            text: data.emailText || data.emailSubject,
        });

        if (!sent) throw new Error('Email delivery failed — SMTP not configured or transport error');
        return `email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }

    private async sendSMS(data: BroadcastJobData): Promise<string> {
        if (!data.phone) throw new Error('No phone number for SMS recipient');
        if (!data.smsBody) throw new Error('No SMS body configured');

        const channels = await this.prisma.$queryRaw<any[]>`
            SELECT access_token, account_id FROM channel_accounts
            WHERE tenant_id = ${data.tenantId}::uuid AND channel_type = 'sms' AND is_active = true
            LIMIT 1
        `;

        if (!channels?.length) throw new Error('No active SMS channel configured for this tenant');

        const { access_token, account_id } = channels[0];
        const [accountSid, authToken] = (access_token || '').split(':');
        if (!accountSid || !authToken) throw new Error('Invalid Twilio credentials');

        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const params = new URLSearchParams({ To: data.phone, From: account_id, Body: data.smsBody });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
            },
            body: params.toString(),
        });

        const result = await response.json() as any;
        if (result.error_code || result.status === 'failed') {
            throw new Error(`Twilio SMS error: ${result.message || 'Unknown error'}`);
        }

        return result.sid || '';
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<BroadcastJobData>, error: Error) {
        this.logger.error({ msg: 'Broadcast job failed', jobId: job.id, campaignId: job.data.campaignId, channel: job.data.channel, error: error.message });
        Sentry.captureException(error, { tags: { queue: 'broadcast-messages', campaignId: job.data.campaignId, channel: job.data.channel }, extra: { jobId: job.id } });
    }
}
