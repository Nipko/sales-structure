import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { ConversationsService } from '../conversations/conversations.service';
import { INBOUND_QUEUE, InboundJobData } from './inbound-queue.constants';
import { providerMessageId } from '../../common/utils/provider-message-id.util';

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
        const pmid = providerMessageId(msg) || job.id || 'unknown';
        const traceId = pmid;

        this.logger.log(
            `[Inbound] Processing ${msg.channelType} message from ${msg.contactId} ` +
            `tenant=${msg.tenantId}${waitedMs !== undefined ? ` queued=${waitedMs}ms` : ''} trace=${traceId}`,
        );
        // D1/D12 metric: inbound lag >5s indicates worker stall (gap 1787112490837 without Processing)
        if (waitedMs !== undefined && waitedMs > 5000) {
            this.logger.warn(`[Inbound] High lag ${waitedMs}ms trace=${traceId} tenant=${msg.tenantId} — possible worker stall`);
            Sentry.captureMessage(`Inbound high lag ${waitedMs}ms`, {
                level: 'warning',
                tags: { queue: INBOUND_QUEUE, tenantId: msg.tenantId, traceId },
                extra: { waitedMs, pmid },
            });
        }

        // The turn is idempotent end to end (external_id dedupe → turn:done
        // marker → outbound dedupeId), so a re-run after a restart resumes
        // without re-answering the customer.
        await this.conversations.processIncomingMessage(msg);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<InboundJobData>, error: Error) {
        const msg = job?.data?.msg;
        const pmid = msg ? providerMessageId(msg) : undefined;
        this.logger.error({
            msg: 'Inbound message failed — customer may be left without a reply',
            jobId: job?.id,
            attempt: job?.attemptsMade,
            tenantId: msg?.tenantId,
            channelType: msg?.channelType,
            contactId: msg?.contactId,
            traceId: pmid || job?.id,
            error: error?.message,
        });
        Sentry.captureException(error, {
            tags: {
                queue: INBOUND_QUEUE,
                tenantId: msg?.tenantId,
                channelType: msg?.channelType,
                traceId: pmid || String(job?.id || ''),
            },
        });
    }

    @OnWorkerEvent('stalled')
    onStalled(jobId: string) {
        this.logger.error(`[Inbound] Job stalled ${jobId} — lockDuration may be too short or worker GC paused`);
        Sentry.captureMessage(`Inbound job stalled ${jobId}`, { level: 'error', tags: { queue: INBOUND_QUEUE } });
    }
}
