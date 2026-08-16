import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { CrmImportService, CRM_IMPORT_QUEUE, CrmImportJob } from './crm-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';

/**
 * Single concurrency: imports are long-running per-tenant operations and we
 * want them serialized to avoid hammering the same provider with parallel
 * pull pages. Per-page rate limit is enforced by the provider's own quota.
 */
@Processor(CRM_IMPORT_QUEUE, { concurrency: 2 })
export class CrmImportProcessor extends WorkerHost {
    private readonly logger = new Logger(CrmImportProcessor.name);

    constructor(
        private readonly service: CrmImportService,
        private readonly prisma: PrismaService,
    ) {
        super();
    }

    async process(job: Job<CrmImportJob>): Promise<any> {
        const access = await resolveTenantSubscriptionAccess(this.prisma, job.data.tenantId, 'write');
        if (!access.allowed) {
            if (access.restrictionLevel === 'unavailable') throw new Error('subscription_entitlement_unavailable');
            return { ok: false, skipped: true, reason: access.error };
        }
        await this.service.runImport(job.data);
        return { ok: true };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<CrmImportJob>, err: Error) {
        this.logger.error(`crm-import ${job.name} failed: ${err.message}`);
        Sentry.captureException(err, {
            tags: { provider: job.data.provider, queue: CRM_IMPORT_QUEUE },
            extra: { tenantId: job.data.tenantId, importId: job.data.importId },
        });
    }
}
