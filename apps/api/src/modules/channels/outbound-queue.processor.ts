import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, DelayedError } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { ChannelGatewayService } from './channel-gateway.service';
import { ChannelTokenService } from './channel-token.service';
import { RedisService } from '../redis/redis.service';
import { OutboundMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { TenantNotificationSmsService } from '../sms-credits/tenant-notification-sms.service';

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
        private tenantSms: TenantNotificationSmsService,
    ) {
        super();
    }

    /**
     * Marker proving THIS job already reached the provider. The deterministic
     * jobId stops a turn from queueing the same reply twice, but it cannot help
     * when the very same job runs again — which happens whenever the worker is
     * SIGKILLed mid-send and BullMQ's stalled-job recovery re-runs it.
     *
     * The marker is written AFTER a successful send, never before: a crash in
     * the sub-second gap between send and marker costs a rare duplicate, while
     * marking first would silently DROP a reply that was never delivered. For a
     * customer-facing message a duplicate is far cheaper than a loss.
     */
    private sentMarkerKey(jobId: string | undefined): string {
        return `outbound:sent:${jobId}`;
    }

    async process(job: Job<OutboundJobData>, token?: string): Promise<string | null> {
        const { outbound } = job.data;
        const startTime = Date.now();

        const sentKey = this.sentMarkerKey(job.id as string | undefined);
        if (job.id) {
            const alreadySent = await this.redis.get(sentKey).catch(() => null);
            if (alreadySent) {
                this.logger.warn(
                    `[Outbound] Job ${job.id} already delivered (${alreadySent}) — skipping re-send to ${outbound.to}`,
                );
                return alreadySent;
            }
        }

        // Per-tenant rate limit — read-only check (isOverLimit) so a delayed job's
        // repeated re-checks don't keep incrementing the counter and pin the tenant
        // over-limit forever. Don't throw a normal error (that burns one of the 3
        // attempts and a sustained throttle would DROP the message): re-schedule as
        // delayed (no attempt consumed) so it sends in the next window.
        if (await this.throttle.isOverLimit(outbound.tenantId, 'outbound')) {
            this.logger.warn(`[Outbound] Tenant ${outbound.tenantId} rate limited — delaying job ${job.id} 60s (no attempt consumed)`);
            await job.moveToDelayed(Date.now() + 60_000, token);
            throw new DelayedError();
        }

        // Reseller SMS: text SMS to a tenant's customer goes out via the PLATFORM
        // Twilio sender and is charged to the tenant's prepaid credit balance —
        // NOT the tenant's own Twilio. Insufficient credits / unconfigured platform
        // SMS is a permanent condition for this message: log + drop (don't burn the
        // 3 retries or fire a Sentry alert). MMS falls through to the legacy path.
        if (outbound.channelType === 'sms' && outbound.content?.type === 'text' && outbound.content?.text) {
            const res = await this.tenantSms.send(outbound.tenantId, outbound.to, outbound.content.text, {
                reason: (outbound.metadata as any)?.notificationReason || 'outbound',
                ref: (outbound.metadata as any)?.messageId,
            });
            if (!res.sent) {
                if (res.reason === 'insufficient_credits' || res.reason === 'platform_sms_unconfigured' || res.reason === 'monetization_disabled') {
                    this.logger.warn(`[Outbound][SMS] ${res.reason} tenant=${outbound.tenantId} to=${outbound.to} — dropped`);
                    return `skipped:${res.reason}`;
                }
                throw new Error(`SMS send failed to ${outbound.to}: ${res.error || res.reason}`);
            }
            await this.throttle.recordUsage(outbound.tenantId, 'outbound').catch(() => {});
            if (job.id) await this.redis.set(sentKey, res.sid || 'sms-sent', 86400).catch(() => {});
            this.logger.log(`[Outbound][SMS] sent to ${outbound.to} tenant=${outbound.tenantId} segments=${res.segments}`);
            return res.sid || 'sms-sent';
        }
        // Non-text SMS (MMS) is not supported on the reseller platform sender — drop
        // instead of falling through to a tenant Twilio token the reseller model has none of.
        if (outbound.channelType === 'sms') {
            this.logger.warn(`[Outbound][SMS] non-text (MMS) not supported on reseller SMS — dropped tenant=${outbound.tenantId} to=${outbound.to}`);
            return 'skipped:sms_mms_unsupported';
        }

        // Resolve the access token at send time (not stored in the job) — fresh
        // and never persisted in Redis as a plaintext credential.
        const creds = await this.channelToken.getChannelToken(outbound.tenantId, outbound.channelType, outbound.channelAccountId);

        this.logger.log(
            `[Outbound] Sending to ${outbound.to} via ${outbound.channelType} tenant=${outbound.tenantId}`,
        );

        const result = await this.channelGateway.sendMessage(outbound, creds.accessToken);

        if (!result) {
            throw new Error(`Failed to send message to ${outbound.to} via ${outbound.channelType}`);
        }

        // Delivered — mark before any post-send bookkeeping so a crash in the
        // lines below re-runs the job without re-sending to the customer.
        if (job.id) await this.redis.set(sentKey, String(result), 86400).catch(() => {});

        // Count the quota only on a SUCCESSFUL send (not on every check/retry).
        await this.throttle.recordUsage(outbound.tenantId, 'outbound').catch(() => {});

        // Customer→reply latency (server-receipt of the inbound → our reply sent). Both
        // ends use the server clock (receivedAt stamped at pipeline entry), so there's no
        // cross-clock skew; the guard still drops absurd values defensively.
        const inboundTs = Number((outbound.metadata as any)?.inboundTs);
        if (Number.isFinite(inboundTs) && inboundTs > 0) {
            const e2eMs = Date.now() - inboundTs;
            this.recordE2e(outbound.channelType, e2eMs).catch(() => {});
            this.logger.log(`[Outbound] customer→reply ${e2eMs}ms channel=${outbound.channelType}`);
        }

        const durationMs = Date.now() - startTime;
        this.logger.log(
            `[Outbound] Sent to ${outbound.to} via ${outbound.channelType} tenant=${outbound.tenantId} (${durationMs}ms)`,
        );

        return result;
    }

    /** Record an end-to-end (webhook→customer) latency sample into a capped Redis reservoir. */
    private async recordE2e(channel: string, ms: number): Promise<void> {
        if (!(ms >= 0 && ms <= 600_000)) return; // skip clock-skew / absurd values
        try {
            const key = `latency:e2e:${channel}:samples`;
            await this.redis.getClient().multi()
                .rpush(key, String(Math.round(ms)))
                .ltrim(key, -200, -1)
                .expire(key, 900)
                .exec();
        } catch { /* best-effort */ }
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
