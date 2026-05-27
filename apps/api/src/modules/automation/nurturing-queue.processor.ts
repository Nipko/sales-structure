import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { NurturingService, NURTURING_QUEUE, NurturingJobData } from './nurturing.service';
import { DripSequenceService, DripStepJobData } from './drip-sequence.service';

@Processor(NURTURING_QUEUE, {
    limiter: {
        max: 10,
        duration: 1000,   // 10 jobs per second — don't overwhelm Meta API
    },
    concurrency: 5,
})
export class NurturingQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(NurturingQueueProcessor.name);

    constructor(
        private readonly nurturingService: NurturingService,
        private readonly dripSequenceService: DripSequenceService,
    ) {
        super();
    }

    async process(job: Job<NurturingJobData | DripStepJobData>): Promise<void> {
        switch (job.name) {
            case 'drip-step': {
                const { tenantId, enrollmentId } = job.data as DripStepJobData;
                this.logger.log(`Processing drip-step job ${job.id} — tenant=${tenantId} enrollment=${enrollmentId}`);
                await this.dripSequenceService.executeStep(tenantId, enrollmentId);
                this.logger.log(`Drip-step job ${job.id} completed successfully`);
                break;
            }
            default: {
                const { tenantId, conversationId, leadId, attempt } = job.data as NurturingJobData;
                this.logger.log(
                    `Processing nurturing job ${job.id} — ` +
                    `tenant=${tenantId} conv=${conversationId} attempt=${attempt}`,
                );
                await this.nurturingService.executeFollowUp(tenantId, conversationId, leadId, attempt);
                this.logger.log(`Nurturing job ${job.id} completed successfully`);
                break;
            }
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error) {
        const tenantId = (job.data as any)?.tenantId;
        this.logger.error({ msg: `${job.name} job failed`, jobId: job.id, tenantId, error: error.message });
        Sentry.captureException(error, { tags: { queue: 'nurturing', jobName: job.name, tenantId }, extra: { jobId: job.id, data: job.data } });
    }
}
