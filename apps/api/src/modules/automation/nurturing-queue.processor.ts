import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NurturingService, NURTURING_QUEUE, NurturingJobData } from './nurturing.service';

@Processor(NURTURING_QUEUE, {
    limiter: {
        max: 10,
        duration: 1000,   // 10 jobs per second — don't overwhelm Meta API
    },
    concurrency: 5,
})
export class NurturingQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(NurturingQueueProcessor.name);

    constructor(private readonly nurturingService: NurturingService) {
        super();
    }

    async process(job: Job<NurturingJobData>): Promise<void> {
        const { tenantId, conversationId, leadId, attempt } = job.data;

        this.logger.log(
            `Processing nurturing job ${job.id} — ` +
            `tenant=${tenantId} conv=${conversationId} attempt=${attempt}`,
        );

        await this.nurturingService.executeFollowUp(tenantId, conversationId, leadId, attempt);

        this.logger.log(`Nurturing job ${job.id} completed successfully`);
    }
}
