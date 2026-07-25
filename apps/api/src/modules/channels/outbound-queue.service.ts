import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OutboundMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { RedisService } from '../redis/redis.service';
import { OUTBOUND_QUEUE, OutboundJobData, pendingJobsKey } from './outbound-queue.processor';

@Injectable()
export class OutboundQueueService {
    private readonly logger = new Logger(OutboundQueueService.name);

    constructor(
        @InjectQueue(OUTBOUND_QUEUE)
        private outboundQueue: Queue<OutboundJobData>,
        private throttle: TenantThrottleService,
        private redis: RedisService,
    ) {}

    /**
     * Enqueue an outbound message with retry policy and plan-based priority.
     * 3 attempts, exponential backoff (2s, 4s, 8s).
     *
     * The access token is intentionally NOT stored in the job — it is resolved
     * fresh in the processor (avoids retaining a plaintext credential in Redis
     * for up to 24h, and uses the current token if it rotated since enqueue).
     */
    async enqueue(outbound: OutboundMessage, _accessToken?: string, delayMs?: number): Promise<void> {
        let priority = await this.throttle.getPriority(outbound.tenantId);

        // Per-tenant queue-depth backpressure: when a tenant exceeds maxPendingJobs
        // (e.g. a large broadcast), degrade its priority so its backlog yields to
        // other tenants. We never drop — that would lose a customer reply.
        const max = await this.throttle.getMaxPendingJobs(outbound.tenantId);
        if (Number.isFinite(max)) {
            const pending = await this.redis.incr(pendingJobsKey(outbound.tenantId));
            await this.redis.expire(pendingJobsKey(outbound.tenantId), 3600);
            if (pending > max) {
                priority = Math.max(priority, 100); // lower priority (higher number)
                this.logger.warn(`Outbound pending for tenant ${outbound.tenantId} = ${pending} > max ${max} — degrading priority`);
            }
        }

        await this.outboundQueue.add(
            'send',
            { outbound },
            {
                priority,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
                // Deterministic jobId when the caller supplied one: BullMQ ignores
                // an add whose jobId already exists, so re-playing a turn cannot
                // queue the same reply twice. Retention (1h completed) comfortably
                // covers any retry window.
                ...(outbound.dedupeId ? { jobId: outbound.dedupeId } : {}),
                removeOnComplete: { age: 3600 },
                removeOnFail: { age: 86400 },
            },
        );

        this.logger.debug(
            `Enqueued outbound to ${outbound.to} via ${outbound.channelType} (priority=${priority})`,
        );
    }
}
