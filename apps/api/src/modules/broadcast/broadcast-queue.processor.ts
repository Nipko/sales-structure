import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
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
        private readonly broadcastService: BroadcastService,
    ) {
        super();
    }

    async process(job: Job<BroadcastJobData>): Promise<string> {
        const {
            schemaName,
            campaignId,
            recipientId,
            phone,
            templateName,
            templateLanguage,
            templateComponents,
        } = job.data;

        this.logger.debug(
            `Processing broadcast job ${job.id}: campaign=${campaignId} phone=${phone} attempt=${job.attemptsMade + 1}`,
        );

        try {
            const result = await this.messagingService.sendTemplate(
                schemaName,
                phone,
                templateName,
                templateLanguage,
                templateComponents,
            );

            // Mark recipient as sent
            await this.broadcastService.updateRecipientStatus(
                schemaName,
                recipientId,
                'sent',
                undefined,
                result.messageId,
            );

            this.logger.log(
                `Broadcast sent: campaign=${campaignId} phone=${phone} messageId=${result.messageId}`,
            );

            // Check if all recipients are done
            await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);

            return result.messageId;
        } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error';

            this.logger.error(
                `Broadcast failed: campaign=${campaignId} phone=${phone} attempt=${job.attemptsMade + 1}/3 error=${errorMessage}`,
            );

            // If this was the last attempt, mark as permanently failed
            if (job.attemptsMade + 1 >= (job.opts?.attempts || 3)) {
                await this.broadcastService.updateRecipientStatus(
                    schemaName,
                    recipientId,
                    'failed',
                    errorMessage,
                );

                // Check completion even on final failure
                await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);
            }

            // Re-throw to trigger BullMQ retry with exponential backoff
            throw error;
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<BroadcastJobData>, error: Error) {
        this.logger.error({ msg: 'Broadcast job failed', jobId: job.id, campaignId: job.data.campaignId, phone: job.data.phone, error: error.message });
        Sentry.captureException(error, { tags: { queue: 'broadcast-messages', campaignId: job.data.campaignId }, extra: { jobId: job.id, phone: job.data.phone } });
    }
}
