import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { ConversationsService } from '../conversations/conversations.service';
import { INBOUND_QUEUE, InboundJobData } from './inbound-queue.constants';

/**
 * Runs the AI turn for an inbound customer message.
 *
 * lockDuration must comfortably exceed a real turn: the measured p99 is ~100s
 * (800ms debounce + up to 36s waiting on the conversation lock + a 10-60s AI
 * call). With BullMQ's 30s default the lock would lapse mid-turn, the job would
 * be declared stalled and re-run — burning the single stalled rescue and
 * risking a second turn against the same message.
 */
@Processor(INBOUND_QUEUE, {
    concurrency: Number(process.env.INBOUND_CONCURRENCY ?? 4),
    lockDuration: 120_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
})
export class InboundQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(InboundQueueProcessor.name);

    constructor(private readonly conversations: ConversationsService) {
        super();
    }

    async process(job: Job<InboundJobData>): Promise<void> {
        const { msg, enqueuedAt } = job.data;
        const waitedMs = enqueuedAt ? Date.now() - enqueuedAt : undefined;

        this.logger.log(
            `[Inbound] Processing ${msg.channelType} message from ${msg.contactId} ` +
            `tenant=${msg.tenantId}${waitedMs !== undefined ? ` queued=${waitedMs}ms` : ''}`,
        );

        // The turn is idempotent end to end (external_id dedupe → turn:done
        // marker → outbound dedupeId), so a re-run after a restart resumes
        // without re-answering the customer.
        await this.conversations.processIncomingMessage(msg);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<InboundJobData>, error: Error) {
        const msg = job?.data?.msg;
        this.logger.error({
            msg: 'Inbound message failed — customer may be left without a reply',
            jobId: job?.id,
            attempt: job?.attemptsMade,
            tenantId: msg?.tenantId,
            channelType: msg?.channelType,
            contactId: msg?.contactId,
            error: error?.message,
        });
        Sentry.captureException(error, {
            tags: {
                queue: INBOUND_QUEUE,
                tenantId: msg?.tenantId,
                channelType: msg?.channelType,
            },
        });
    }
}
