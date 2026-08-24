import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CronLockService } from '../redis/cron-lock.service';
import { INBOUND_QUEUE, type InboundJobData } from './inbound-queue.constants';

const REDRIVE_BATCH = 100;
const MAX_REDRIVES = 2;
const MIN_FAILED_AGE_MS = 60_000;

/**
 * Rescues customer messages after BullMQ exhausts its normal three attempts.
 *
 * A failed inbound job is not ordinary background noise: the provider already
 * received a 200 and will not redeliver it, so leaving the job in the failed set
 * means a customer message is permanently unanswered. Redrive is deliberately
 * bounded and auditable; deterministic failures get at most two later chances
 * and then remain visible for an operator instead of looping forever.
 */
@Injectable()
export class InboundFailedRedriveService {
    private readonly logger = new Logger(InboundFailedRedriveService.name);

    constructor(
        @InjectQueue(INBOUND_QUEUE) private readonly queue: Queue<InboundJobData>,
        private readonly cronLock: CronLockService,
    ) {}

    @Cron('*/5 * * * *')
    async redriveCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'inbound.failedRedrive',
            240,
            () => this.redriveFailedJobs(),
            { prefer: 'worker' },
        );
    }

    async redriveFailedJobs(now = Date.now()): Promise<{
        inspected: number;
        retried: number;
        exhausted: number;
        tooRecent: number;
        errors: number;
    }> {
        const failed = await this.queue.getFailed(0, REDRIVE_BATCH - 1);
        const result = { inspected: failed.length, retried: 0, exhausted: 0, tooRecent: 0, errors: 0 };

        for (const job of failed) {
            const failedAt = Number(job.finishedOn || job.processedOn || 0);
            if (!failedAt || now - failedAt < MIN_FAILED_AGE_MS) {
                result.tooRecent += 1;
                continue;
            }

            const count = Number(job.data?.redriveCount || 0);
            if (count >= MAX_REDRIVES) {
                result.exhausted += 1;
                continue;
            }

            try {
                await job.updateData({
                    ...job.data,
                    redriveCount: count + 1,
                    lastRedrivenAt: now,
                });
                await job.retry('failed');
                result.retried += 1;
                this.logger.warn(
                    `[Inbound] Re-drove failed job=${job.id || 'unknown'} `
                    + `tenant=${job.data?.msg?.tenantId || 'unknown'} rescue=${count + 1}/${MAX_REDRIVES}`,
                );
            } catch (error: any) {
                // The twin process may have won the same retry after the failed
                // list was read. That is safe; keep the error observable for a
                // real Redis/state failure and let the next cron inspect again.
                result.errors += 1;
                this.logger.error(
                    `[Inbound] Failed to re-drive job=${job.id || 'unknown'}: ${error?.message || error}`,
                );
            }
        }

        if (result.exhausted > 0) {
            this.logger.error(
                `[Inbound] ${result.exhausted} job(s) exhausted ${MAX_REDRIVES} automatic redrives; operator review required`,
            );
        }
        return result;
    }
}
