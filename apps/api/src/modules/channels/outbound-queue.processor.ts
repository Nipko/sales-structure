import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, DelayedError } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { ChannelGatewayService } from './channel-gateway.service';
import { ChannelTokenService } from './channel-token.service';
import { RedisService } from '../redis/redis.service';
import { OutboundMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

export const OUTBOUND_QUEUE = 'outbound-messages';

/** Per-tenant pending-jobs counter key (queue-depth backpressure). */
export const pendingJobsKey = (tenantId: string) => `outbound:pending:${tenantId}`;

export interface OutboundJobData {
    outbound: OutboundMessage;
}

@Processor(OUTBOUND_QUEUE, {
    concurrency: 5,
    limiter: { max: 20, duration: 1000 },
})
export class OutboundQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(OutboundQueueProcessor.name);

    constructor(
        private channelGateway: ChannelGatewayService,
        private throttle: TenantThrottleService,
        private channelToken: ChannelTokenService,
        private redis: RedisService,
    ) {
        super();
    }

    async process(job: Job<OutboundJobData>, token?: string): Promise<string | null> {
        const { outbound } = job.data;
        const startTime = Date.now();

        // Per-tenant rate limit. Don't throw — that burns one of the 3 attempts,
        // and a sustained throttle would exhaust them and DROP the customer's
        // message. Instead re-schedule the job as delayed (no attempt consumed)
        // so it sends in the next window.
        if (await this.throttle.isLimited(outbound.tenantId, 'outbound')) {
            this.logger.warn(`[Outbound] Tenant ${outbound.tenantId} rate limited — delaying job ${job.id} 60s (no attempt consumed)`);
            await job.moveToDelayed(Date.now() + 60_000, token);
            throw new DelayedError();
        }

        // Resolve the access token at send time (not stored in the job) — fresh
        // and never persisted in Redis as a plaintext credential.
        const creds = await this.channelToken.getChannelToken(outbound.tenantId, outbound.channelType);

        this.logger.log(
            `[Outbound] Sending to ${outbound.to} via ${outbound.channelType} tenant=${outbound.tenantId}`,
        );

        const result = await this.channelGateway.sendMessage(outbound, creds.accessToken);

        if (!result) {
            throw new Error(`Failed to send message to ${outbound.to} via ${outbound.channelType}`);
        }

        const durationMs = Date.now() - startTime;
        this.logger.log(
            `[Outbound] Sent to ${outbound.to} via ${outbound.channelType} tenant=${outbound.tenantId} (${durationMs}ms)`,
        );

        return result;
    }

    /** Decrement the per-tenant pending counter when a job leaves the queue. */
    private async decrPending(tenantId: string): Promise<void> {
        const v = await this.redis.incrBy(pendingJobsKey(tenantId), -1).catch(() => 0);
        if (v < 0) await this.redis.set(pendingJobsKey(tenantId), '0', 3600).catch(() => {});
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job<OutboundJobData>) {
        this.decrPending(job.data.outbound.tenantId).catch(() => {});
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<OutboundJobData>, error: Error) {
        const { outbound } = job.data;
        this.decrPending(outbound.tenantId).catch(() => {});
        this.logger.error({
            msg: 'Outbound message failed after all retries',
            jobId: job.id,
            attempt: job.attemptsMade,
            tenantId: outbound.tenantId,
            channelType: outbound.channelType,
            to: outbound.to,
            channelAccountId: outbound.channelAccountId,
            error: error.message,
        });
        Sentry.captureException(error, {
            tags: { queue: 'outbound-messages', tenantId: outbound.tenantId, channel: outbound.channelType },
            extra: { jobId: job.id, to: outbound.to, attempt: job.attemptsMade },
        });
    }
}
