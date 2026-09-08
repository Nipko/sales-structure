import type { ApprovedEffectReference } from './approved-effect-delivery.port';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OutboundMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { RedisService } from '../redis/redis.service';
import { OUTBOUND_QUEUE, OutboundJobData, pendingJobsKey } from './outbound-queue.processor';
import { sanitizeJobId } from '../../common/utils/provider-message-id.util';

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
     * Publish a reference to a dispatch row the outbox already committed.
     *
     * Deliberately unlike `enqueue` below: there, dropping the jobId and adding
     * again is right, because Redis is the only record and losing the job means
     * losing the reply. Here the row IS the record, so an add that fails keeps
     * its deterministic identity and the row is recovered from the database
     * instead. Redis carries no payload and no recipient — only two ids.
     */
    async enqueueDispatch(tenantId: string, dispatchId: string, delayMs?: number): Promise<void> {
        const jobId = sanitizeJobId(`dispatch-${dispatchId}`);
        const existing = await this.outboundQueue.getJob(jobId);
        if (existing) {
            const state = await existing.getState();
            // A live job already carries this work.
            if (['active', 'waiting', 'delayed', 'waiting-children', 'prioritized'].includes(state)) return;
            if (state === 'failed') { await existing.retry(); return; }
            // A retained COMPLETED job used to make this a silent no-op: the row
            // still had work, recovery called here, the deterministic id existed,
            // and nothing was ever republished. Retention is a debugging
            // convenience, not a reason to abandon a pending effect.
            await existing.remove().catch(() => undefined);
        }
        await this.outboundQueue.add('dispatch', { dispatch: { tenantId, dispatchId } }, {
            jobId,
            priority: await this.throttle.getPriority(tenantId),
            // One attempt on purpose. Every deliberate wait is expressed by
            // moving the job to the date the outbox row holds, so PostgreSQL is
            // the only scheduler and BullMQ never picks a competing moment. An
            // unexpected exception fails the job, and the recovery pass — which
            // reads the durable row — is what brings it back.
            attempts: 1,
            ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        });
    }

    /** References only. Failure must keep its deterministic identity, never fall back to an unkeyed send. */
    async enqueueApprovedEffect(reference: ApprovedEffectReference): Promise<void> {
        const jobId = sanitizeJobId(`approval-effect-${reference.ticketId}-${reference.effectId}`);
        const existing = await this.outboundQueue.getJob(jobId);
        if (existing) {
            if (await existing.getState() === 'failed') await existing.retry();
            return;
        }
        await this.outboundQueue.add('approved-effect', { approvalEffect: {
            tenantId: reference.tenantId, ticketId: reference.ticketId, effectId: reference.effectId,
        } }, { jobId, priority: await this.throttle.getPriority(reference.tenantId), attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 86400 } });
    }

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

        const opts: any = {
            priority,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
            // Deterministic jobId when the caller supplied one: BullMQ ignores
            // an add whose jobId already exists, so re-playing a turn cannot
            // queue the same reply twice. Retention (1h completed) comfortably
            // covers any retry window.
            ...(outbound.dedupeId ? { jobId: sanitizeJobId(outbound.dedupeId) } : {}),
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        };

        try {
            await this.outboundQueue.add('send', { outbound }, opts);
        } catch (err: any) {
            // Dedupe is an OPTIMISATION; delivery is the contract. A malformed
            // jobId once made BullMQ throw here and the customer simply never
            // got their reply. Never let that trade go the wrong way again:
            // drop the id, log loudly, and still send.
            if (!opts.jobId) throw err;
            this.logger.error(
                `Outbound enqueue rejected with jobId="${opts.jobId}" (${err?.message}) — retrying WITHOUT dedupe so the reply still reaches the customer`,
            );
            delete opts.jobId;
            await this.outboundQueue.add('send', { outbound }, opts);
        }

        this.logger.debug(
            `Enqueued outbound to ${outbound.to} via ${outbound.channelType} (priority=${priority})`,
        );
    }
}
