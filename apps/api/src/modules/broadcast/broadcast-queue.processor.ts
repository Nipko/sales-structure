import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService, BROADCAST_QUEUE, BroadcastJobData } from './broadcast.service';
import { AbTestService } from './ab-test.service';
import { TenantNotificationSmsService } from '../sms-credits/tenant-notification-sms.service';

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
        private readonly cryptoService: WhatsappCryptoService,
        private readonly emailService: EmailService,
        private readonly prisma: PrismaService,
        private readonly broadcastService: BroadcastService,
        private readonly abTestService: AbTestService,
        private readonly tenantSms: TenantNotificationSmsService,
    ) {
        super();
    }

    async process(job: Job<BroadcastJobData>): Promise<string> {
        const { channel, schemaName, campaignId, recipientId } = job.data;

        this.logger.debug(
            `Processing broadcast job ${job.id}: campaign=${campaignId} channel=${channel} attempt=${job.attemptsMade + 1}`,
        );

        // --- SEND: the ONLY step allowed to trigger a BullMQ retry ---
        let messageId: string;
        try {
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
        } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error';

            // Out-of-credits is permanent for this recipient — mark failed and DO NOT
            // retry (a retry just re-checks the empty balance; no send, no charge).
            if (errorMessage === 'INSUFFICIENT_SMS_CREDITS') {
                this.logger.warn(`Broadcast SMS dropped (no credits): campaign=${campaignId} recipient=${recipientId}`);
                await this.markFailed(schemaName, campaignId, recipientId, job.data.variantId, 'insufficient_sms_credits');
                return 'skipped:insufficient_credits';
            }

            this.logger.error(`Broadcast failed: campaign=${campaignId} channel=${channel} attempt=${job.attemptsMade + 1}/3 error=${errorMessage}`);
            if (job.attemptsMade + 1 >= (job.opts?.attempts || 3)) {
                await this.markFailed(schemaName, campaignId, recipientId, job.data.variantId, errorMessage);
            }
            throw error; // let BullMQ retry the SEND only
        }

        // --- BOOKKEEPING: must NEVER re-trigger the send ---
        // The message is already delivered (and, for SMS, already charged). A failure
        // here must not re-queue the job — otherwise the customer gets a duplicate
        // message and the tenant is double-charged. So we log and swallow.
        try {
            await this.broadcastService.updateRecipientStatus(schemaName, recipientId, 'sent', undefined, messageId);
            if (job.data.variantId) {
                try { await this.abTestService.updateVariantStats(schemaName, job.data.variantId, 'sent'); } catch { /* tables may not exist */ }
            }
            await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);
        } catch (bookErr: any) {
            this.logger.error(`Broadcast post-send bookkeeping failed (message ${messageId} already delivered): ${bookErr?.message || bookErr}`);
        }

        this.logger.log(`Broadcast sent: campaign=${campaignId} channel=${channel} messageId=${messageId}`);
        return messageId;
    }

    /** Mark a recipient failed + update A/B stats + check campaign completion. */
    private async markFailed(schemaName: string, campaignId: string, recipientId: string, variantId: string | undefined, reason: string): Promise<void> {
        await this.broadcastService.updateRecipientStatus(schemaName, recipientId, 'failed', reason);
        if (variantId) {
            try { await this.abTestService.updateVariantStats(schemaName, variantId, 'failed'); } catch { /* tables may not exist */ }
        }
        await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);
    }

    private async sendWhatsApp(data: BroadcastJobData): Promise<string> {
        const result = await this.messagingService.sendTemplate(
            data.schemaName,
            data.phone,
            data.templateName,
            data.templateLanguage,
            data.templateComponents,
            data.channelAccountId, // send FROM this number when the campaign picked one
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

        // Reseller model: broadcast SMS is delivered via the PLATFORM Twilio sender
        // and charged to the tenant's prepaid SMS credit balance (1 credit/segment),
        // NOT the tenant's own Twilio. `ref` is stable per recipient for audit.
        const res = await this.tenantSms.send(data.tenantId, data.phone, data.smsBody, {
            reason: 'broadcast',
            ref: `bcast:${data.campaignId}:${data.recipientId}`,
            metadata: { campaignId: data.campaignId },
        });
        if (res.sent) return res.sid || '';
        if (res.reason === 'insufficient_credits') throw new Error('INSUFFICIENT_SMS_CREDITS');
        if (res.reason === 'platform_sms_unconfigured') throw new Error('SMS de plataforma no configurado');
        throw new Error(`Twilio SMS error: ${res.error || res.reason}`);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<BroadcastJobData>, error: Error) {
        this.logger.error({ msg: 'Broadcast job failed', jobId: job.id, campaignId: job.data.campaignId, channel: job.data.channel, error: error.message });
        // Out-of-credits is an expected business condition, not an incident — keep it out of Sentry.
        if (error.message === 'INSUFFICIENT_SMS_CREDITS') return;
        Sentry.captureException(error, { tags: { queue: 'broadcast-messages', campaignId: job.data.campaignId, channel: job.data.channel }, extra: { jobId: job.id } });
    }
}
