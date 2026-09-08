import { OPERATIONAL_NOTICE_DELIVERY, type OperationalNoticeDeliveryPort, type OperationalNoticeReference } from '../operational-notices/operational-notice.contracts';
import { APPROVED_EFFECT_DELIVERY, ApprovalEffectSuppressed, type ApprovedEffectDeliveryPort, type ApprovedEffectReference } from './approved-effect-delivery.port';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job, DelayedError } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { ChannelGatewayService } from './channel-gateway.service';
import { ChannelTokenService } from './channel-token.service';
import { RedisService } from '../redis/redis.service';
import { OutboundMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { TenantNotificationSmsService } from '../sms-credits/tenant-notification-sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { DISPATCH_TERMINAL_STATES } from './agent-dispatch-outbox';
import { transportNotAvailable } from './strict-dispatch-transport';
import { OutboundQueueService } from './outbound-queue.service';

export const OUTBOUND_QUEUE = 'outbound-messages';

/** Per-tenant pending-jobs counter key (queue-depth backpressure). */
export const pendingJobsKey = (tenantId: string) => `outbound:pending:${tenantId}`;

/** Two identifiers, never a payload or a recipient: the outbox row is the record. */
export interface DispatchJobReference { tenantId: string; dispatchId: string }

export type OutboundJobData = { outbound: OutboundMessage; approvalEffect?: never; operationalNotice?: never; dispatch?: never }
    | { outbound?: never; approvalEffect: ApprovedEffectReference; operationalNotice?: never; dispatch?: never }
    | { outbound?: never; approvalEffect?: never; operationalNotice: OperationalNoticeReference; dispatch?: never }
    | { outbound?: never; approvalEffect?: never; operationalNotice?: never; dispatch: DispatchJobReference };

@Processor(OUTBOUND_QUEUE, {
    concurrency: 5,
    limiter: { max: 20, duration: 1000 },
})
export class OutboundQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(OutboundQueueProcessor.name);
    private outboundQueue?: OutboundQueueService;

    /**
     * Wired by the module after construction rather than injected.
     *
     * Adding any further constructor dependency to this WorkerHost — the queue
     * service, or even ModuleRef — closes a resolution cycle through
     * @nestjs/bullmq's own providers and the container never settles. The module
     * already wires adapters into the gateway the same way.
     */
    attachQueue(queue: OutboundQueueService): void { this.outboundQueue = queue; }

    constructor(
        private channelGateway: ChannelGatewayService,
        private throttle: TenantThrottleService,
        private channelToken: ChannelTokenService,
        private redis: RedisService,
        private tenantSms: TenantNotificationSmsService,
        private prisma: PrismaService,
        @Optional() @Inject(APPROVED_EFFECT_DELIVERY) private approvalEffects?: ApprovedEffectDeliveryPort,
        @Optional() @Inject(OPERATIONAL_NOTICE_DELIVERY) private operationalNotices?: OperationalNoticeDeliveryPort,
        @Optional() private dispatchOutbox?: AgentDispatchOutboxStore,
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

    /**
     * Deliver one dispatch row: at most one remote effect, at most one attempt.
     *
     * Everything before the admission is preparation and may not touch a
     * provider. The permission is granted in a short transaction that commits
     * before the request goes out, and what came back is recorded against that
     * exact lease. A retry re-enters here and re-admits — the outbox, not BullMQ,
     * is what bounds how many attempts this row can ever get.
     */
    private async processDispatch(reference: DispatchJobReference, job: Job<OutboundJobData>, token?: string): Promise<string> {
        const { tenantId, dispatchId } = reference;
        if (!this.dispatchOutbox) throw new Error('dispatch_outbox_unavailable');
        const existing = await this.dispatchOutbox.read(tenantId, dispatchId);
        if (!existing) return 'dispatch:missing';
        // A recovered job whose row already reached a terminal state must never
        // produce a second effect. An accepted receipt is read, not re-earned.
        if (DISPATCH_TERMINAL_STATES.includes(existing.state)) return `dispatch:${existing.state}`;

        /**
         * PostgreSQL is the only scheduler.
         *
         * Letting BullMQ keep its own backoff produced a silent loss: the row
         * was `failed` with a future `available_at`, the BullMQ retry arrived
         * first, admission answered `dispatch_not_available_yet`, the job
         * COMPLETED — and recovery then found a retained completed job and never
         * republished it. Every deliberate wait is now expressed by moving the
         * job to the durable date instead, which consumes no attempt and leaves
         * no completed job behind.
         */
        const waitUntil = async (availableAt: Date, why: string): Promise<never> => {
            const delay = Math.max(availableAt.getTime() - Date.now(), 1000);
            this.logger.warn(`[Dispatch] ${dispatchId} waiting ${delay}ms (${why})`);
            await job.moveToDelayed(Date.now() + delay, token);
            throw new DelayedError();
        };

        const preflight = async (errorCode: string, options?: { permanent?: boolean; retryInSeconds?: number }) => {
            const row = await this.dispatchOutbox!.failPreflight(tenantId, dispatchId, { errorCode, ...options });
            this.logger.warn(`[Dispatch] ${dispatchId} ${row.state} (${errorCode}) attempts=${row.attempts}`);
            // A row that may still be admitted keeps its job, rescheduled to the
            // date the database chose. Only a terminal row completes the job.
            if (row.state === 'failed') await waitUntil(row.availableAt, errorCode);
            return `dispatch:${row.state}:${errorCode}`;
        };

        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (!entitlement.allowed) {
            return preflight(`subscription_${entitlement.error ?? 'restricted'}`,
                { permanent: entitlement.restrictionLevel !== 'unavailable' });
        }
        // A throttled tenant consumes no attempt: re-schedule instead.
        if (await this.throttle.isOverLimit(tenantId, 'outbound')) {
            await job.moveToDelayed(Date.now() + 60_000, token);
            throw new DelayedError();
        }
        const transport = this.channelGateway.getStrictTransport(existing.binding!.channelType as any);
        if (!transport) {
            // Explicit refusal, never a silent fall back to the loose gateway.
            const refusal = transportNotAvailable(existing.binding!.channelType);
            return preflight(refusal.kind === 'rejected' ? refusal.errorCode : 'transport_not_migrated',
                { permanent: true });
        }
        let accessToken: string;
        try {
            accessToken = (await this.channelToken.getChannelToken(tenantId,
                existing.binding!.channelType as any, existing.binding!.channelAccountId)).accessToken;
        } catch (error: any) {
            return preflight(`channel_credentials_unavailable:${String(error?.message || '').slice(0, 60)}`);
        }

        let admitted;
        try {
            admitted = await this.dispatchOutbox.admit(tenantId, dispatchId);
        } catch (error: any) {
            const code = String(error?.code || error?.message || 'admission_failed');
            if (code.startsWith('dispatch_terminal:')) return `dispatch:${code}`;
            if (code === 'dispatch_lease_active') return 'dispatch:lease_held_elsewhere';
            if (code === 'dispatch_awaiting_predecessor') {
                // A stray or early job. The chain below is what normally brings
                // this item back; parking briefly keeps it as a safety net.
                await job.moveToDelayed(Date.now() + 2000, token);
                throw new DelayedError();
            }
            if (code === 'dispatch_predecessor_failed') {
                // A caption whose picture never arrived describes nothing.
                return preflight('predecessor_not_delivered', { permanent: true });
            }
            if (code === 'dispatch_not_available_yet') {
                // The durable schedule says later. Wait for it rather than
                // completing the job and losing the work to a retained id.
                const row = await this.dispatchOutbox!.read(tenantId, dispatchId);
                if (row) await waitUntil(row.availableAt, 'backoff');
                return 'dispatch:waiting_backoff';
            }
            // The scope, the routing, the sources or the binding no longer hold.
            // A later attempt cannot make this payload admissible again.
            return preflight(code, { permanent: true });
        }

        // COMMITTED. From here the request may go out exactly once, with no
        // tenant or agent lock held and no business transaction open.
        const outcome = await transport.sendStrict({
            itemKind: admitted.row.itemKind, to: admitted.row.binding!.recipient,
            channelAccountId: admitted.row.binding!.channelAccountId, payload: admitted.row.payload!,
        }, accessToken);

        try {
            if (outcome.kind === 'accepted') {
                await this.dispatchOutbox.settle(tenantId, dispatchId, admitted.leaseToken,
                    { kind: 'sent', receipt: outcome.receipt });
                await this.throttle.recordUsage(tenantId, 'outbound').catch(() => {});
                // Chain the next effect only now that this one actually arrived.
                // Order is enforced here, not by a delay somebody guessed.
                await this.chainNext(tenantId, dispatchId);
                return `dispatch:sent:${outcome.receipt}`;
            }
            if (outcome.kind === 'unknown') {
                // The provider may have acted. Never another POST for this item.
                await this.dispatchOutbox.settle(tenantId, dispatchId, admitted.leaseToken,
                    { kind: 'reconciliation_required', errorCode: outcome.errorCode });
                this.logger.error(`[Dispatch] ${dispatchId} outcome unknown (${outcome.errorCode}) — reconciliation required`);
                return `dispatch:reconciliation_required:${outcome.errorCode}`;
            }
            const settled = await this.dispatchOutbox.settle(tenantId, dispatchId, admitted.leaseToken,
                { kind: outcome.retryable ? 'failed' : 'suppressed', errorCode: outcome.errorCode });
            // Same rule as preflight: the database chose when, so honour it here
            // instead of throwing and letting BullMQ pick a different moment.
            if (settled.state === 'failed') await waitUntil(settled.availableAt, outcome.errorCode);
            return `dispatch:${settled.state}:${outcome.errorCode}`;
        } catch (error: any) {
            if (error instanceof DelayedError) throw error;
            // Recording the outcome failed. The row keeps its live permission, so
            // no other worker can send this item; when the lease lapses it becomes
            // a reconciliation, which is the honest state — especially after an
            // acceptance we observed but could not write down.
            this.logger.error(`[Dispatch] ${dispatchId} outcome not recorded (${outcome.kind}): ${error?.message}`);
            return `dispatch:outcome_unrecorded:${outcome.kind}`;
        }
    }

    /**
     * Publish the next effect of a batch, once this one has arrived.
     *
     * Never fatal: the effect that just went out is already recorded, and the
     * recovery pass republishes the head of any batch still holding work.
     */
    private async chainNext(tenantId: string, dispatchId: string): Promise<void> {
        try {
            const next = await this.dispatchOutbox!.nextInBatch(tenantId, dispatchId);
            if (!next) return;
            const queue = this.outboundQueue;
            if (!queue) throw new Error('outbound_queue_unavailable');
            await queue.enqueueDispatch(tenantId, next.id);
        } catch (error: any) {
            this.logger.warn(`[Dispatch] chain after ${dispatchId} deferred to recovery: ${error?.message}`);
        }
    }

    async process(job: Job<OutboundJobData>, token?: string): Promise<string | null> {
        if (job.data.dispatch) return this.processDispatch(job.data.dispatch, job, token);
        if (job.data.operationalNotice) {
            const reference=job.data.operationalNotice;
            if (!this.operationalNotices) throw new Error('operational_notice_delivery_unavailable');
            if (await this.throttle.isOverLimit(reference.tenantId,'outbound')) {
                await job.moveToDelayed(Date.now()+60000,token); throw new DelayedError();
            }
            return this.operationalNotices.deliver(reference,{prepare:async outbound=>{
                const creds=await this.channelToken.getChannelToken(outbound.tenantId,outbound.channelType,outbound.channelAccountId);
                return async()=>{
                    const result=await this.channelGateway.sendMessage(outbound,creds.accessToken);
                    if(result)await this.throttle.recordUsage(reference.tenantId,'outbound').catch(()=>{});
                    return result;
                };
            }});
        }
        if (job.data.approvalEffect) {
            const reference = job.data.approvalEffect;
            if (!this.approvalEffects) throw new Error('approval_effect_delivery_unavailable');
            if (await this.throttle.isOverLimit(reference.tenantId, 'outbound')) {
                await job.moveToDelayed(Date.now() + 60_000, token);
                throw new DelayedError();
            }
            return this.approvalEffects.deliver(reference, { prepare: async outbound => {
                const entitlement = await resolveTenantSubscriptionAccess(this.prisma, reference.tenantId, 'write');
                if (!entitlement.allowed) {
                    if (entitlement.restrictionLevel === 'unavailable') throw new Error('subscription_entitlement_unavailable');
                    throw new ApprovalEffectSuppressed('approval_effect_subscription_restricted');
                }
                if (outbound.metadata?.approvalEffectKind === 'handoff') return async () => null;
                const creds = await this.channelToken.getChannelToken(outbound.tenantId, outbound.channelType, outbound.channelAccountId);
                return async () => {
                    const result = await this.channelGateway.sendMessage(outbound, creds.accessToken);
                    if (result) await this.throttle.recordUsage(reference.tenantId, 'outbound').catch(() => {});
                    return result;
                };
            } });
        }
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

        // Queued replies, reminders and automations may execute after a trial,
        // paid period or dunning boundary. Revalidate at the last authoritative
        // point before SMS balance/provider work; HTTP and inbound guards cannot
        // protect a job that was enqueued hours earlier.
        const entitlement = await resolveTenantSubscriptionAccess(
            this.prisma,
            outbound.tenantId,
            'write',
        );
        if (!entitlement.allowed) {
            if (entitlement.restrictionLevel === 'unavailable') {
                throw new Error(`subscription_entitlement_unavailable:${entitlement.error ?? 'unknown'}`);
            }
            this.logger.warn(
                `[Outbound] Dropped job ${job.id} for tenant ${outbound.tenantId}: ${entitlement.error}`,
            );
            return `skipped:${entitlement.error ?? 'subscription_restricted'}`;
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
        if (job.data.outbound) this.decrPending(job.data.outbound.tenantId).catch(() => {});
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<OutboundJobData>, error: Error) {
        if (job.data.dispatch) {
            // The row carries the durable state; the job is only work.
            this.logger.error({ msg: 'Dispatch job failed', jobId: job.id, ...job.data.dispatch,
                attempt: job.attemptsMade, error: error.message });
            return;
        }
        if (job.data.operationalNotice) {
            this.logger.error({ msg:'Operational notice job failed', jobId:job.id, ...job.data.operationalNotice, attempt:job.attemptsMade });
            return;
        }
        if (job.data.approvalEffect) {
            this.logger.error({ msg: 'Approval effect job failed', jobId: job.id, ...job.data.approvalEffect, attempt: job.attemptsMade });
            return;
        }
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
