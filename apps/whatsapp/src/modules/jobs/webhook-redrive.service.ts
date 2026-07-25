import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Re-drives failed jobs in the `webhooks` queue.
 *
 * A job lands in the failed set when its attempts exhaust — typically because
 * the API was restarting longer than the retry window during a deploy. The
 * payload is retained (removeOnFail keeps it), but without this cron NOTHING
 * ever retried it: the customer message sat in Redis forever and the customer
 * never got a reply. This closes the loop automatically.
 *
 * Guardrails:
 * - Max 100 jobs per run (a burst after a long outage drains in a few runs).
 * - Max 5 re-drives per job (`redriveCount` in job.data) so a poison job
 *   (malformed payload, permanent 4xx) doesn't loop forever — after the cap
 *   it stays in the failed set for manual inspection.
 */
@Injectable()
export class WebhookRedriveService {
    private readonly logger = new Logger(WebhookRedriveService.name);
    private static readonly MAX_PER_RUN = 100;
    private static readonly MAX_REDRIVES = 5;

    constructor(@InjectQueue('webhooks') private readonly webhookQueue: Queue) {}

    @Cron('*/5 * * * *')
    async redriveFailedJobs() {
        let failed;
        try {
            failed = await this.webhookQueue.getFailed(0, WebhookRedriveService.MAX_PER_RUN - 1);
        } catch (e: any) {
            this.logger.warn(`Could not read failed set: ${e?.message}`);
            return;
        }
        if (!failed || failed.length === 0) return;

        let retried = 0;
        let capped = 0;
        for (const job of failed) {
            try {
                const redrives = Number(job.data?.redriveCount) || 0;
                if (redrives >= WebhookRedriveService.MAX_REDRIVES) {
                    capped++;
                    continue;
                }
                await job.updateData({ ...job.data, redriveCount: redrives + 1 });
                await job.retry();
                retried++;
            } catch (e: any) {
                // Job may have been retried/removed concurrently — not a problem.
                this.logger.debug(`Redrive skipped for job ${job.id}: ${e?.message}`);
            }
        }

        if (retried > 0 || capped > 0) {
            this.logger.log(
                `Webhook redrive: retried=${retried} capped=${capped} (failed set had ${failed.length})`,
            );
        }
    }
}
