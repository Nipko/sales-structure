import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { ExternalCrmService, CRM_SYNC_QUEUE, CrmSyncJob } from './external-crm.service';

@Processor(CRM_SYNC_QUEUE, {
    concurrency: 10,
    limiter: { max: 20, duration: 1000 },
})
export class ExternalCrmProcessor extends WorkerHost {
    private readonly logger = new Logger(ExternalCrmProcessor.name);

    constructor(private readonly service: ExternalCrmService) {
        super();
    }

    async process(job: Job<CrmSyncJob>): Promise<any> {
        await this.service.runJob(job.data);
        return { ok: true };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<CrmSyncJob>, err: Error) {
        this.logger.error(`crm-sync ${job.name} failed (attempt ${job.attemptsMade}): ${err.message}`);
        if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
            Sentry.captureException(err, {
                tags: { provider: job.data.provider, entity: job.data.entity, queue: CRM_SYNC_QUEUE },
                extra: { tenantId: job.data.tenantId, connectionId: job.data.connectionId, jobName: job.name },
            });
        }
    }
}
