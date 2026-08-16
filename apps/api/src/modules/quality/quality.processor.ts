import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { QualityService, QUALITY_QUEUE, QualityJob } from './quality.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';

@Processor(QUALITY_QUEUE, {
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
})
export class QualityProcessor extends WorkerHost {
    private readonly logger = new Logger(QualityProcessor.name);

    constructor(
        private readonly quality: QualityService,
        private readonly prisma: PrismaService,
    ) {
        super();
    }

    async process(job: Job<QualityJob>): Promise<any> {
        const access = await resolveTenantSubscriptionAccess(this.prisma, job.data.tenantId, 'write');
        if (!access.allowed) {
            if (access.restrictionLevel === 'unavailable') throw new Error('subscription_entitlement_unavailable');
            return { ok: false, skipped: true, reason: access.error };
        }
        await this.quality.scoreConversation(job.data.tenantId, job.data.conversationId);
        return { ok: true };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<QualityJob>, err: Error) {
        this.logger.error(`quality-scoring ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
        if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
            Sentry.captureException(err, {
                tags: { queue: QUALITY_QUEUE },
                extra: { tenantId: job.data?.tenantId, conversationId: job.data?.conversationId },
            });
        }
    }
}
