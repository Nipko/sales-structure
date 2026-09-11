import { OPERATIONAL_NOTICE_DELIVERY, type OperationalNoticeDeliveryPort, type OperationalNoticeReference } from '../operational-notices/operational-notice.contracts';
import { APPROVED_EFFECT_DELIVERY, ApprovalEffectSuppressed, type ApprovedEffectDeliveryPort, type ApprovedEffectReference } from './approved-effect-delivery.port';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job, DelayedError } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { createHash } from 'crypto';
import { ChannelGatewayService } from './channel-gateway.service';
import {
    WhatsappSendAdmissionService, fromSendContext, type Admission,
} from '../billing/whatsapp-spend/whatsapp-send-admission.service';
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
import { loadOutboundPayload, markOutboundPayloadSent } from './outbound-payload-store';

export const OUTBOUND_QUEUE = 'outbound-messages';

/** Per-tenant pending-jobs counter key (queue-depth backpressure). */
export const pendingJobsKey = (tenantId: string) => `outbound:pending:${tenantId}`;

/** Two identifiers, never a payload or a recipient: the outbox row is the record. */
export interface DispatchJobReference { tenantId: string; dispatchId: string }

/**
 * A reply that lives in the database, named by two ids.
 *
 * The `outbound` variant below carries the words and the recipient in Redis and
 * is kept for exactly one reason: jobs published before this deploy are still in
 * the queue when the worker restarts, and refusing them would drop replies
 * somebody is waiting for. New jobs use this.
 */
export interface OutboundPayloadReference {
    tenantId: string;
    payloadId: string;
}

export type OutboundJobData =
    { outbound: OutboundMessage; outboundRef?: never; approvalEffect?: never; operationalNotice?: never; dispatch?: never }
    | { outbound?: never; outboundRef: OutboundPayloadReference; approvalEffect?: never; operationalNotice?: never; dispatch?: never }
    | { outbound?: never; outboundRef?: never; approvalEffect: ApprovedEffectReference; operationalNotice?: never; dispatch?: never }
    | { outbound?: never; outboundRef?: never; approvalEffect?: never; operationalNotice: OperationalNoticeReference; dispatch?: never }
    | { outbound?: never; outboundRef?: never; approvalEffect?: never; operationalNotice?: never; dispatch: DispatchJobReference };

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
        // The economic boundary. Optional so a deployment that has not
        // wired it still SENDS — a money gate that silences a platform when
        // its own dependency is missing is worse than the bill it prevents.
        // When it is present, nothing chargeable leaves without passing it.
        @Optional() private spendGate?: WhatsappSendAdmissionService,
    ) {
        super();
    }

    /**
     * Ask the money gate, in the one shape both lanes use.
     *
     * Returns `null` when there is no gate wired at all, which the callers
     * read as "proceed, and record nothing".
     */
    private async admitSpend(input: {
        tenantId: string; schema?: string | null; channelType: string; channelAccountId: string;
        recipient: string; producer: string; contentDigest: string;
        contactId?: string | null; conversationId?: string | null;
        disposition?: 'reactive' | 'proactive';
        template?: { name?: string | null; category?: string | null } | null;
        insideServiceWindow?: boolean;
        binding?: Record<string, unknown>;
    }) {
        if (!this.spendGate) return null;
        let schema = input.schema ?? null;
        if (!schema) {
            try { schema = await this.prisma.getTenantSchemaName(input.tenantId); }
            catch { return null; }
        }
        try {
            // ── The identity comes from the RESOLVER, not from this call site ──
            //
            // Who pays, which credential, which display number: all of it is a
            // property of the connection, and the resolver is the one thing that
            // knows. Passing a hand-made triple here is what made `payer.kind`
            // depend on whether an optional parameter happened to be supplied —
            // and none of the three sinks supplied it, so every authorisation
            // failed on `payer_unknown`.
            let connection = {
                tenantId: input.tenantId, channelType: input.channelType,
                channelAccountId: input.channelAccountId,
            } as any;
            try {
                const resolved = await this.channelToken.resolveSendContext({
                    tenantId: input.tenantId, channelType: input.channelType as any,
                    channelAccountId: input.channelAccountId,
                    recipient: { scope: 'customer', address: input.recipient,
                        contactId: input.contactId ?? null },
                });
                connection = fromSendContext(resolved.context);
            } catch (error: any) {
                // A connection that cannot be resolved cannot be charged
                // either. The admission then blocks with its own diagnosis
                // rather than this lane inventing one.
                this.logger.warn(`[Spend] connection unresolved for ${input.producer}: `
                    + `${error?.message}`);
            }
            return await this.spendGate.admit({
                schema,
                connection,
                // Read to derive the tariff country and then dropped: what
                // reaches the ledger is the hash below, never the number.
                recipientAddress: input.recipient,
                // The recipient is hashed before it travels: this value ends
                // up in an effect key, a log line and a queue id.
                recipientRef: createHash('sha256').update(String(input.recipient)).digest('hex').slice(0, 32),
                contactId: input.contactId ?? null,
                producer: input.producer,
                contentDigest: input.contentDigest,
                admissionReason: input.producer,
                disposition: input.disposition,
                template: input.template ?? null,
                insideServiceWindow: input.insideServiceWindow,
                binding: input.binding as any,
            });
        } catch (error: any) {
            // An infrastructure failure in the gate must not stop a customer
            // being answered. It is logged loudly because an ungated send is
            // exactly what this whole boundary exists to make impossible.
            this.logger.error(`[Spend] gate unavailable for ${input.producer}: ${error?.message}`);
            return null;
        }
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
        //
        // The money is reserved BEFORE the request, never after: reserving
        // afterwards means it is spent before anything counts it.
        const admission = await this.admitSpend({
            tenantId, channelType: admitted.row.binding!.channelType,
            channelAccountId: admitted.row.binding!.channelAccountId,
            recipient: String(admitted.row.binding!.recipient ?? ''),
            producer: `dispatch_${admitted.row.itemKind}`,
            // An outbox item bound to an inbound message is an ANSWER: somebody
            // wrote and this is the reply. One with no inbound message is
            // something the platform started. The binding is the evidence; no
            // reading of the content is involved.
            disposition: admitted.row.binding!.inboundMessageId ? 'reactive' : 'proactive',
            contentDigest: String(dispatchId),
            contactId: admitted.row.binding!.contactId ?? null,
            binding: { dispatchItemId: dispatchId, batchId: admitted.row.batchId,
                inboundMessageId: admitted.row.binding!.inboundMessageId,
                itemIndex: admitted.row.itemIndex },
        });
        if (admission && admission.permitted
            && !(await this.beginOrStandDown({ tenantId } as OutboundMessage, admission))) {
            // The send right was taken while this worker prepared, or the intent
            // could not be recorded. Either way this attempt sends nothing and
            // the item stays claimable rather than being settled either way.
            return 'dispatch:deferred:transmission_not_owned';
        }
        if (admission && !admission.permitted) {
            // Refused on money, not on transport. The item is suppressed
            // rather than retried: a ceiling does not become permissive by
            // asking again, and the diagnosis says what to change.
            await this.dispatchOutbox.settle(tenantId, dispatchId, admitted.leaseToken,
                { kind: 'suppressed', errorCode: `spend_${admission.block?.code ?? 'refused'}` });
            return `dispatch:suppressed:spend_${admission.block?.code ?? 'refused'}`;
        }
        const outcome = await transport.sendStrict({
            itemKind: admitted.row.itemKind, to: admitted.row.binding!.recipient,
            channelAccountId: admitted.row.binding!.channelAccountId, payload: admitted.row.payload!,
        }, accessToken);

        try {
            if (outcome.kind === 'accepted') {
                // Accepted is not priced. The exposure stays until a status
                // webhook or a reconciliation says what it cost.
                if (admission) await this.spendGate!.record(await this.prisma.getTenantSchemaName(tenantId),
                    admission, { kind: 'delivered_unpriced', providerMessageId: outcome.receipt })
                    .catch(() => undefined);
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
                // The reservation is RETAINED for the same reason.
                if (admission) await this.spendGate!.record(await this.prisma.getTenantSchemaName(tenantId),
                    admission, { kind: 'timeout', errorCode: outcome.errorCode })
                    .catch(() => undefined);
                await this.dispatchOutbox.settle(tenantId, dispatchId, admitted.leaseToken,
                    { kind: 'reconciliation_required', errorCode: outcome.errorCode });
                this.logger.error(`[Dispatch] ${dispatchId} outcome unknown (${outcome.errorCode}) — reconciliation required`);
                return `dispatch:reconciliation_required:${outcome.errorCode}`;
            }
            // A refusal with no message id is the one positive negative that
            // releases the money. A retryable failure is not: the attempt may
            // still land, so the reservation is retained for the retry to adopt.
            if (admission) await this.spendGate!.record(await this.prisma.getTenantSchemaName(tenantId),
                admission, outcome.retryable
                    ? { kind: 'timeout', errorCode: outcome.errorCode }
                    : { kind: 'rejected', errorCode: outcome.errorCode })
                .catch(() => undefined);
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

    /**
     * Ask the gate for one loose outbound message.
     *
     * `'refused'` means a ceiling said no and the caller must not send.
     * `null` means there is no gate wired; anything else is the admission whose
     * outcome has to be recorded once the provider has answered.
     */
    /**
     * Say the request is beginning, and stand down if the right was taken.
     *
     * Committed BEFORE the fetch, always. Written after it, it would distinguish
     * nothing: anything recorded then already presupposes the POST happened, and
     * the whole point is to tell "crashed before sending" from "crashed after".
     */
    private async beginOrStandDown(outbound: OutboundMessage, admission: unknown): Promise<boolean> {
        if (!this.spendGate || !admission || admission === 'refused') return true;
        try {
            const schema = await this.prisma.getTenantSchemaName(outbound.tenantId);
            return await this.spendGate.beginTransmission(schema, admission as Admission);
        } catch (error: any) {
            // The intent could not be recorded. Sending anyway would produce a
            // POST nobody can classify afterwards.
            this.logger.error(`[Spend] could not begin transmission: ${error?.message}`);
            return false;
        }
    }

    private async gateOrSuppress(outbound: OutboundMessage, producer: string,
        disposition: 'reactive' | 'proactive') {
        const admission = await this.admitSpend({
            tenantId: outbound.tenantId,
            channelType: outbound.channelType,
            channelAccountId: String(outbound.channelAccountId ?? ''),
            recipient: String(outbound.to ?? ''),
            producer,
            disposition,
            // The body is digested, never carried: this value reaches an effect
            // key, a log line and a queue id, and none of those may hold a
            // customer's words.
            contentDigest: createHash('sha256')
                .update(JSON.stringify(outbound.content ?? null)).digest('hex').slice(0, 32),
            conversationId: (outbound.metadata as any)?.conversationId ?? null,
            contactId: (outbound.metadata as any)?.contactId ?? null,
        });
        if (admission && !admission.permitted) return 'refused' as const;
        return admission;
    }

    /**
     * What became of it, recorded against the reservation that authorised it.
     *
     * An accepted send is `delivered_unpriced`: acceptance is not a price, and
     * the exposure stands until a status webhook or a reconciliation says what
     * it cost. No result at all is a timeout, which never releases, because a
     * request whose answer was lost may well have put a message on a phone.
     */
    /**
     * Authorise the text a conclusively-refused Flow becomes.
     *
     * It is a SECOND remote effect — its own POST, its own charge, its own
     * receipt — so it gets its own reservation rather than riding on the one
     * that covered the Flow. The effect key differs because the producer does:
     * `…_flow_fallback` is not `…`, so a retry of either finds its own row.
     *
     * Returns false when the money authority refuses or cannot be reached.
     * Sending nothing is the honest answer there: the customer is no worse off
     * than if the Flow had simply failed, and nobody is billed for a message
     * that nothing authorised.
     */
    private async admitFlowFallback(outbound: OutboundMessage, producer: string,
        disposition: 'reactive' | 'proactive', errorCode: string): Promise<boolean> {
        if (!this.spendGate) return true;
        const admission = await this.admitSpend({
            tenantId: outbound.tenantId,
            channelType: outbound.channelType,
            channelAccountId: String(outbound.channelAccountId ?? ''),
            recipient: String(outbound.to ?? ''),
            producer: `${producer}_flow_fallback`,
            disposition,
            contentDigest: createHash('sha256')
                .update(`flow_fallback:${errorCode}:${JSON.stringify(outbound.content ?? null)}`)
                .digest('hex').slice(0, 32),
            conversationId: (outbound.metadata as any)?.conversationId ?? null,
            contactId: (outbound.metadata as any)?.contactId ?? null,
        });
        if (admission && !admission.permitted) {
            this.logger.warn(`[Spend] the text fallback for a refused Flow was itself refused`);
            return false;
        }
        this.fallbackAdmissions.set(outbound, admission);
        return true;
    }

    /**
     * The fallback's admission, parked between the hook and the outcome.
     *
     * A `WeakMap` keyed on the message being sent: the hook runs deep inside the
     * gateway and the outcome is recorded by the lane that called it, and
     * threading a value back through a callback signature would change the
     * gateway's contract for every channel to serve one of them.
     */
    private readonly fallbackAdmissions = new WeakMap<OutboundMessage, unknown>();

    private async recordSpend(outbound: OutboundMessage, admission: unknown, result: string | null) {
        if (!this.spendGate) return;
        // A Flow that was refused and fell back produced TWO effects. The Flow
        // is over — conclusively rejected, so its money goes back — and the text
        // is the one that carries the receipt.
        const fallback = this.fallbackAdmissions.get(outbound);
        if (fallback) {
            this.fallbackAdmissions.delete(outbound);
            await this.settle(outbound, admission, { kind: 'rejected', errorCode: 'flow_rejected' });
            await this.settle(outbound, fallback, result
                ? { kind: 'delivered_unpriced', providerMessageId: result }
                : { kind: 'timeout' });
            return;
        }
        await this.settle(outbound, admission, result
            ? { kind: 'delivered_unpriced', providerMessageId: result }
            : { kind: 'timeout' });
    }

    private async settle(outbound: OutboundMessage, admission: unknown, outcome: {
        kind: 'delivered_priced' | 'delivered_unpriced' | 'rejected' | 'timeout';
        providerMessageId?: string | null; errorCode?: string | null;
    }) {
        if (!admission || admission === 'refused' || !this.spendGate) return;
        try {
            const schema = await this.prisma.getTenantSchemaName(outbound.tenantId);
            await this.spendGate.record(schema, admission as Admission, outcome);
        } catch (error: any) {
            this.logger.error(`[Spend] outcome not recorded: ${error?.message}`);
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
                    const admission = await this.gateOrSuppress(outbound, 'operational_notice', 'proactive');
                    if (admission === 'refused') return null;
                    if (!(await this.beginOrStandDown(outbound, admission))) return null;
                    const result=await this.channelGateway.sendMessage(outbound,creds.accessToken,
                        { admitFallback: code => this.admitFlowFallback(
                            outbound, 'operational_notice', 'proactive', code) });
                    await this.recordSpend(outbound, admission, result);
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
                    const admission = await this.gateOrSuppress(outbound, 'approved_effect', 'reactive');
                    if (admission === 'refused') throw new ApprovalEffectSuppressed('spend_refused');
                    if (!(await this.beginOrStandDown(outbound, admission))) {
                        throw new ApprovalEffectSuppressed('transmission_not_owned');
                    }
                    const result = await this.channelGateway.sendMessage(outbound, creds.accessToken,
                        { admitFallback: code => this.admitFlowFallback(
                            outbound, 'approved_effect', 'reactive', code) });
                    await this.recordSpend(outbound, admission, result);
                    if (result) await this.throttle.recordUsage(reference.tenantId, 'outbound').catch(() => {});
                    return result;
                };
            } });
        }
        // Hydrate a referenced reply from the row that owns it.
        //
        // This is the last moment before the message leaves, which is exactly
        // where a retraction or an erasure has to be honoured: a payload that
        // was taken back while the job waited out its delay finds nothing to
        // send, and says so instead of sending a message nobody may send any
        // more. A payload already delivered finds nothing either, which is what
        // stops a replayed job producing a second copy.
        let hydrated = job.data.outbound as OutboundMessage | undefined;
        if (!hydrated && job.data.outboundRef) {
            const reference = job.data.outboundRef;
            const stored = await this.readOutboundPayload(reference.tenantId, reference.payloadId);
            if (!stored) {
                this.logger.warn(`[Outbound] Payload ${reference.payloadId} is gone — nothing to send`);
                return 'skipped:payload_missing';
            }
            if (!stored.payload) {
                this.logger.log(
                    `[Outbound] Payload ${reference.payloadId} was ${stored.redactedReason ?? 'cleared'} — not sending`);
                return `skipped:${stored.redactedReason ?? 'payload_redacted'}`;
            }
            hydrated = stored.payload as unknown as OutboundMessage;
        }
        if (!hydrated) throw new Error('outbound_payload_unavailable');
        const outbound: OutboundMessage = hydrated;
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

        // The last lane, and the busiest: every reply, link, picture and
        // proactive message that is not on the durable outbox. Gated here so
        // that "every chargeable send is authorised" is a property of the
        // code and not of a list somebody keeps up to date.
        const admission = await this.gateOrSuppress(outbound, 'outbound_queue',
            // A job carrying a conversation is a reply inside one; a job
            // without one is a campaign, a reminder or a drip step. Read from
            // the job, not from the words.
            (outbound.metadata as any)?.conversationId ? 'reactive' : 'proactive');
        if (admission === 'refused') {
            this.logger.warn(`[Outbound] refused on spend for tenant=${outbound.tenantId}`);
            return 'skipped:spend_refused';
        }
        if (!(await this.beginOrStandDown(outbound, admission))) {
            // Somebody else holds the right, or the intent could not be
            // recorded. Either way this attempt sends nothing.
            return 'skipped:transmission_not_owned';
        }
        const result = await this.channelGateway.sendMessage(outbound, creds.accessToken, {
            admitFallback: code => this.admitFlowFallback(outbound, 'outbound_queue',
                (outbound.metadata as any)?.conversationId ? 'reactive' : 'proactive', code),
        });
        await this.recordSpend(outbound, admission, result);

        if (!result) {
            throw new Error(`Failed to send message to ${outbound.to} via ${outbound.channelType}`);
        }

        // Delivered — mark before any post-send bookkeeping so a crash in the
        // lines below re-runs the job without re-sending to the customer.
        if (job.id) await this.redis.set(sentKey, String(result), 86400).catch(() => {});
        // And drop the words from the durable row. The row stays as the fact
        // that stops a replayed job sending a second copy; what it no longer
        // holds is a message that has already reached the person it was for.
        if (job.data.outboundRef) {
            await this.clearOutboundPayload(job.data.outboundRef.tenantId, job.data.outboundRef.payloadId);
        }

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

    /**
     * Reads a referenced reply out of the tenant that owns it.
     *
     * A tenant whose schema cannot be resolved, or that has no such table yet,
     * returns null rather than throwing: the job then reports that there is
     * nothing to send instead of retrying three times against a database that
     * will keep answering the same way.
     */
    private async readOutboundPayload(tenantId: string, payloadId: string) {
        try {
            const schema = await this.prisma.getTenantSchemaName(tenantId);
            if (!schema) return null;
            return await this.prisma.transactionInTenantSchema(schema, query =>
                loadOutboundPayload(((sql: string, params: any[] = []) => query(sql, params)) as any, payloadId));
        } catch (error: any) {
            this.logger.warn(`[Outbound] Could not read payload ${payloadId}: ${error?.message ?? error}`);
            return null;
        }
    }

    private async clearOutboundPayload(tenantId: string, payloadId: string): Promise<void> {
        try {
            const schema = await this.prisma.getTenantSchemaName(tenantId);
            if (!schema) return;
            await this.prisma.transactionInTenantSchema(schema, query =>
                markOutboundPayloadSent(((sql: string, params: any[] = []) => query(sql, params)) as any, payloadId));
        } catch (error: any) {
            // Best effort: the message is already with the provider, and the
            // sent marker in Redis is what stops the resend. Failing here must
            // not turn a delivered reply into a retried one.
            this.logger.warn(`[Outbound] Could not clear payload ${payloadId}: ${error?.message ?? error}`);
        }
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
        // A referenced job has no recipient in Redis, and that is the point: the
        // failure log says which row could not be delivered, not who it was for.
        // Sending the number to Sentry would put back exactly what moving the
        // payload into the database took out.
        if (job.data.outboundRef) {
            const reference = job.data.outboundRef;
            this.decrPending(reference.tenantId).catch(() => {});
            this.logger.error({
                msg: 'Outbound message failed after all retries',
                jobId: job.id, attempt: job.attemptsMade,
                tenantId: reference.tenantId, payloadId: reference.payloadId, error: error.message,
            });
            Sentry.captureException(error, {
                tags: { queue: 'outbound-messages', tenantId: reference.tenantId },
                extra: { jobId: job.id, payloadId: reference.payloadId, attempt: job.attemptsMade },
            });
            return;
        }
        const { outbound } = job.data;
        if (!outbound) return;
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
