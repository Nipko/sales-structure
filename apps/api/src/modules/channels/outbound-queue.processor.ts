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
import { SpendMeterUnavailable } from '../billing/whatsapp-spend/spend-unavailable';
import { refusalMayClear, spendRetryDelaySeconds } from '../billing/whatsapp-spend/spend-diagnosis';
import { isConnectionRefusal } from './connection-refusal';
import { readProviderRefusal } from './funding-failure';
import { AccountPauseStore } from './account-pause-store';
import { ChannelTokenService } from './channel-token.service';
import { RedisService } from '../redis/redis.service';
import { OutboundMessage, isScopedAddressKey } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { TenantNotificationSmsService } from '../sms-credits/tenant-notification-sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { DISPATCH_TERMINAL_STATES, DISPATCH_MAX_ATTEMPTS } from './agent-dispatch-outbox';
import { transportNotAvailable } from './strict-dispatch-transport';
import { dispatchPriceFacts } from './dispatch-price-facts';
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
        // The economic boundary. NOT optional: this processor can send
        // WhatsApp, and a deployment with a WhatsApp sender and no money
        // authority is exactly the configuration that produced unmeasured
        // sends. Nest refuses to build the module instead, at boot, where a
        // person is watching — rather than at 3am on a customer message.
        //
        // It sits BEFORE the optional ports because it is not optional, and a
        // required parameter after an optional one is not expressible: the
        // position itself is part of the statement.
        private spendGate: WhatsappSendAdmissionService,
        // The one provider refusal whose correct answer is to STOP: Meta's
        // 131042 says the business has no usable payment method, so every
        // message from that number fails identically until a person adds a
        // card. Required for the same reason the gate is — a sender that
        // cannot notice this retries into a wall until the queue is full.
        private pauses: AccountPauseStore,
        @Optional() @Inject(APPROVED_EFFECT_DELIVERY) private approvalEffects?: ApprovedEffectDeliveryPort,
        @Optional() @Inject(OPERATIONAL_NOTICE_DELIVERY) private operationalNotices?: OperationalNoticeDeliveryPort,
        @Optional() private dispatchOutbox?: AgentDispatchOutboxStore,
    ) {
        super();
    }

    /**
     * Ask the money gate, in the one shape every lane uses.
     *
     * It either returns an admission or THROWS. There is no third answer any
     * more: the old `null` meant "no gate wired — carry on", and every caller
     * obligingly carried on, which is how an unreachable database turned into
     * an unmeasured message and an unrecorded charge.
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
        if (!this.spendGate) {
            // Not optional any more. A deployment reaching this line has a
            // WhatsApp sender and no money authority, which is the
            // configuration that produced unmeasured sends.
            throw new SpendMeterUnavailable('no spend authority is wired into this process');
        }
        let schema = input.schema ?? null;
        if (!schema) {
            try { schema = await this.prisma.getTenantSchemaName(input.tenantId); }
            catch (error) {
                throw new SpendMeterUnavailable(
                    `tenant schema unresolved for ${input.tenantId}`, error);
            }
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
            //
            // There is no fallback triple any more. A hand-made
            // `{tenantId, channelType, channelAccountId}` has no payer and no
            // credential, so the authority answered `payer_unknown` for it —
            // which under `enforce` would have silenced this lane while
            // looking like a budget decision. A connection that will not
            // resolve REFUSES, with the resolver's own diagnosis attached.
            const resolved = await this.channelToken.resolveSendContext({
                tenantId: input.tenantId, channelType: input.channelType as any,
                channelAccountId: input.channelAccountId,
                recipient: { scope: 'customer', address: input.recipient,
                    contactId: input.contactId ?? null },
            });
            return await this.spendGate.admit({
                schema,
                connection: fromSendContext(resolved.context),
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
            // A refused connection is an ANSWER, not an outage: a disconnected
            // number, a revoked credential, two numbers and none named. It
            // carries its own code and its own HTTP status, and re-raising it
            // unchanged keeps that diagnosis instead of burying it under a
            // retry the condition will outlive.
            if (isConnectionRefusal(error)) throw error;
            // ── AN UNAVAILABLE METER DEFERS. IT NEVER PERMITS. ──────────────
            //
            // This used to return `null`, which every caller read as "no gate
            // wired — carry on". So a schema that could not be resolved or a
            // database that blinked produced a message on a customer's phone, a
            // charge on the business's account, and no record of either.
            //
            // Throwing hands the job back to BullMQ, which retries it with
            // backoff. The customer waits seconds; nobody is billed for a
            // message nothing counted. Inbound is untouched.
            this.logger.error(`[Spend] meter unavailable for ${input.producer}: `
                + `${error?.message}. Deferring the effect rather than sending it unmeasured.`);
            throw error instanceof SpendMeterUnavailable
                ? error
                : new SpendMeterUnavailable(`admission failed for ${input.producer}`, error);
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
        // ── WHO STARTED THIS, AND WHAT IT IS ────────────────────────────────
        //
        // `origin_kind` is a column, and it is read rather than inferred. The
        // old rule was "does this row name an inbound message" — but a
        // PROACTIVE origin also derives a UUID for that column, so every
        // reminder and every campaign was billed as an ANSWER. Reactive traffic
        // escapes the soft stop by design, so a ceiling meant to pause
        // campaigns paused nothing at all.
        const proactive = admitted.row.originKind === 'proactive';
        // And the producer is the POLICY's own name when there is one, not
        // `dispatch_text`. A census that cannot tell a reminder from a campaign
        // cannot tell an operator which of them filled their ceiling, and a
        // repetition guard keyed on it cannot tell them apart either.
        const scope = admitted.row.operationalScope as Record<string, any>;
        const producer = proactive && typeof scope?.producer === 'string' && scope.producer
            ? `proactive_${scope.producer}`
            : `dispatch_${admitted.row.itemKind}`;
        // ── WHAT DECIDES THE PRICE, READ RATHER THAN GUESSED ────────────────
        //
        // Meta charges by the template's APPROVED category and by whether the
        // 24-hour service window is open. Both are written down in this
        // tenant's own database, and this lane was passing neither: every
        // template arrived as `template_category_missing`, which under
        // `enforce` refuses an approved template and under `observe` prices it
        // at the ceiling — for a fact one join away.
        let schemaPromise: Promise<string> | null = null;
        const priceFacts = await dispatchPriceFacts(
            async (sql, params) => {
                schemaPromise ??= this.prisma.getTenantSchemaName(tenantId);
                return this.prisma.executeInTenantSchema(await schemaPromise, sql, params ?? []);
            },
            {
                itemKind: admitted.row.itemKind,
                templateName: (admitted.row.payload as any)?.templateName ?? null,
                channelAccountId: admitted.row.binding!.channelAccountId,
                conversationId: admitted.row.binding!.conversationId ?? null,
                onUnreadable: (what, error: any) => this.logger.warn(
                    `[Dispatch] ${dispatchId}: ${what} unreadable (${error?.message}); `
                    + 'the admission will price it as unestablished'),
            });
        // ── THE LEASE MUST NOT OUTLIVE A FAILED DECISION ────────────────────
        //
        // `admitSpend` raises when the meter cannot answer, and that happens
        // BEFORE `sendStrict`, so this attempt provably sent nothing. Letting
        // the exception escape left the row `admitted` with a live lease, and
        // the lease sweep later turned it into `reconciliation_required` — the
        // state that means "somebody may have sent this". A meter outage was
        // being recorded as a possible duplicate delivery, and a person had to
        // resolve by hand something nobody had attempted.
        //
        // Handed back instead: `failed` is retryable, the row keeps its
        // payload, and the next pass re-admits it.
        let admission: Awaited<ReturnType<OutboundQueueProcessor['admitSpend']>>;
        try {
            admission = await this.admitSpend({
                tenantId, channelType: admitted.row.binding!.channelType,
                channelAccountId: admitted.row.binding!.channelAccountId,
                recipient: String(admitted.row.binding!.recipient ?? ''),
                producer,
                disposition: proactive ? 'proactive' : 'reactive',
                contentDigest: String(dispatchId),
                contactId: admitted.row.binding!.contactId ?? null,
                template: priceFacts.template,
                insideServiceWindow: priceFacts.insideServiceWindow,
                binding: { dispatchItemId: dispatchId, batchId: admitted.row.batchId,
                    inboundMessageId: admitted.row.binding!.inboundMessageId,
                    itemIndex: admitted.row.itemIndex },
            });
        } catch (error: any) {
            const settled = await this.dispatchOutbox.settle(tenantId, dispatchId,
                admitted.leaseToken,
                { kind: 'failed', errorCode: 'spend_meter_unavailable' })
                .catch(() => null);
            this.logger.error(`[Dispatch] ${dispatchId}: the spend meter could not answer `
                + `(${error?.message}); the lease was handed back and nothing was sent`);
            if (settled?.state === 'failed') await waitUntil(settled.availableAt, 'spend_meter_unavailable');
            return 'dispatch:failed:spend_meter_unavailable';
        }
        if (admission && admission.permitted
            && !(await this.beginOrStandDown({ tenantId } as OutboundMessage, admission))) {
            // The send right was taken while this worker prepared, or the intent
            // could not be recorded. Either way this attempt sends nothing and
            // the item stays claimable rather than being settled either way.
            return 'dispatch:deferred:transmission_not_owned';
        }
        if (admission && !admission.permitted) {
            // ── A CONDITION THAT CLEARS IS NOT A DECISION THAT STANDS ───────
            //
            // Refused on money, not on transport. A CEILING is a decision: it
            // does not become permissive by asking again, so the item is
            // suppressed and the diagnosis says what to change.
            //
            // A funding pause is not that. It clears the moment somebody adds a
            // card, and this row may be the confirmation of an order the
            // customer already placed — R4 is explicit that a budget pause
            // cancels no orders and erases no replies. Suppressing it does not
            // delay the message, it deletes it, and the customer is left with a
            // purchase nobody ever acknowledged.
            //
            // So a refusal that CAN clear settles as `failed`: retryable, the
            // payload kept, and the durable backoff is what stops it spinning.
            const code = admission.block?.code ?? 'refused';
            if (refusalMayClear(code)) {
                // The delay is asked for rather than defaulted. Without it the
                // outbox used thirty seconds, and with five attempts that is a
                // two-minute window for conditions whose own annotations say
                // "an administrator can set it at any moment" and "clears on a
                // reconnect" — neither of which happens in two minutes. The
                // ladder is next to the list it is about, and it makes the
                // window about fifty minutes.
                const retryInSeconds = spendRetryDelaySeconds(admitted.row.attempts);
                const settled = await this.dispatchOutbox.settle(tenantId, dispatchId,
                    admitted.leaseToken, { kind: 'failed', errorCode: `spend_${code}`, retryInSeconds })
                    .catch(() => null);
                this.logger.warn(`[Dispatch] ${dispatchId}: held back by ${code}; `
                    + `kept and retried in ${retryInSeconds}s `
                    + `(attempt ${admitted.row.attempts} of ${DISPATCH_MAX_ATTEMPTS})`);
                if (settled?.state === 'failed') await waitUntil(settled.availableAt, `spend_${code}`);
                return `dispatch:failed:spend_${code}`;
            }
            await this.dispatchOutbox.settle(tenantId, dispatchId, admitted.leaseToken,
                { kind: 'suppressed', errorCode: `spend_${code}` });
            return `dispatch:suppressed:spend_${code}`;
        }
        const outcome = await transport.sendStrict({
            itemKind: admitted.row.itemKind, to: admitted.row.binding!.recipient,
            channelAccountId: admitted.row.binding!.channelAccountId, payload: admitted.row.payload!,
        }, accessToken);

        // ── THE ONE REFUSAL THAT MUST STOP THE LANE ────────────────────
        //
        // The strict transport already reduced Meta's answer to an error code
        // and then threw it away. 131042 means the business cannot be billed:
        // this item's retry, and every other item for this number, will fail
        // identically until somebody adds a card.
        const strictOutbound = { tenantId, channelType: admitted.row.binding!.channelType,
            channelAccountId: admitted.row.binding!.channelAccountId } as OutboundMessage;
        if (outcome.kind === 'accepted') await this.resumeIfPaused(strictOutbound);
        else if ((outcome as any).errorCode) {
            await this.observeFunding(strictOutbound,
                { error: { code: String((outcome as any).errorCode).replace(/^\D*/, '') } });
        }

        try {
            if (outcome.kind === 'accepted') {
                // Accepted is not priced. The exposure stays until a status
                // webhook or a reconciliation says what it cost.
                if (admission) await this.spendGate!.record(await this.prisma.getTenantSchemaName(tenantId),
                    admission, { kind: 'accepted', providerMessageId: outcome.receipt })
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
            // ── THREE ANSWERS, NOT TWO ──────────────────────────────────────
            //
            // A refusal with no message id is the one positive negative that
            // releases the money. A RETRYABLE refusal is neither that nor a
            // timeout: the provider answered, so nothing was created — but its
            // own contract invites the identical request again.
            //
            // Recording it as a timeout retained the money and moved the
            // reservation to `indeterminate`, which `mayTransmit` refuses. So
            // the outbox dutifully scheduled the retry and the spend gate
            // turned it away as `effect_already_resolved`: one rate limit, one
            // message abandoned for ever, with the row saying `failed` and
            // nothing saying why it never came back.
            //
            // `rejected_retryable` keeps the reservation `held` and hands the
            // send right back, so the retry re-claims THE SAME row.
            if (admission) await this.spendGate!.record(await this.prisma.getTenantSchemaName(tenantId),
                admission, outcome.retryable
                    ? { kind: 'rejected_retryable', errorCode: outcome.errorCode }
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
        // No `!this.spendGate` escape here. There is always a gate now, and a
        // branch that said "no gate, go ahead" would be the one branch that
        // sends without a transmission right.
        if (!admission || admission === 'refused') return true;
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
        disposition: 'reactive' | 'proactive',
        durable?: { messageId?: string | null; jobId?: string | null }) {
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
            // ── WHAT MAKES A RETRY FIND ITS OWN EFFECT ──────────────────
            //
            // The persisted message row first: it is written before the send,
            // so its id survives a body that is re-rendered between attempts.
            // The queue job second: one id for every attempt of that job.
            // Without either, the key is the content — and a greeting that
            // interpolates the time is a different effect every minute.
            binding: {
                messageId: durable?.messageId
                    ?? (outbound.metadata as any)?.messageId ?? null,
                inboundMessageId: (outbound.metadata as any)?.inboundMessageId ?? null,
                jobId: durable?.jobId ?? null,
            },
        });
        if (admission && !admission.permitted) {
            // Collapsed to one word for the caller, because these three sinks
            // have no retry to offer and the only question they can answer is
            // whether to send. The CODE is still said out loud here: a
            // condition that could have cleared, dropped because this lane
            // cannot hold anything, is exactly the thing an operator would
            // otherwise never learn — and `spend_refused` alone sends them to
            // look at a ceiling that is not the problem.
            const code = admission.block?.code ?? 'refused';
            this.logger.warn(`[Spend] ${producer} dropped tenant=${outbound.tenantId} on ${code}`
                + (refusalMayClear(code)
                    ? ' — a condition that CAN clear, and this lane keeps nothing'
                    : ''));
            return 'refused' as const;
        }
        return admission;
    }

    /**
     * What became of it, recorded against the reservation that authorised it.
     *
     * An accepted send is exactly that: `accepted`. The POST's answer says Meta
     * HAS the message, not that a phone does — and from October 2026 the charge
     * lands on delivery. The exposure stands, and the status webhook that
     * arrives seconds later is what decides whether it became a charge.
     *
     * No result at all is a timeout, which never releases, because a request
     * whose answer was lost may well have put a message on a phone.
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
        disposition: 'reactive' | 'proactive', errorCode: string,
        durable?: { messageId?: string | null; jobId?: string | null }): Promise<boolean> {
        let admission: Admission | null;
        try {
            admission = await this.admitSpend({
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
                // The SAME durable identity as the Flow it replaces. The
                // producer differs (`..._flow_fallback`), and the producer is
                // part of the key, so this is its own effect with its own
                // reservation — while still being recognisably the fallback of
                // that message rather than a free-floating send.
                binding: {
                    messageId: durable?.messageId
                        ?? (outbound.metadata as any)?.messageId ?? null,
                    inboundMessageId: (outbound.metadata as any)?.inboundMessageId ?? null,
                    jobId: durable?.jobId ?? null,
                },
            });
        } catch (error: any) {
            // ── WHY THIS ONE CATCHES INSTEAD OF DEFERRING ───────────────────
            //
            // This hook runs AFTER the Flow POST. Throwing would hand the whole
            // job back to BullMQ, and the retry would post the Flow again. So
            // the honest answer here is the one the doc comment already
            // promised: send nothing. The customer is no worse off than if the
            // Flow had simply failed, and no unmeasured message goes out.
            this.logger.error(`[Spend] the text fallback could not be authorised: `
                + `${error?.message}. Sending nothing.`);
            return false;
        }
        if (admission && !admission.permitted) {
            this.logger.warn(`[Spend] the text fallback for a refused Flow was itself refused`);
            return false;
        }
        this.fallbackAdmissions.set(outbound, admission);
        return true;
    }

    /**
     * Notice, in whatever the provider threw, the refusal that means "no card".
     *
     * Never throws and never blocks: it runs on a path where a message has just
     * failed, and a failure while recording why must not become a second
     * failure that hides the first.
     */
    private async observeFunding(outbound: OutboundMessage, error: unknown): Promise<void> {
        if (outbound.channelType !== 'whatsapp') return;
        const refusal = readProviderRefusal(error);
        await this.pauses.observeFunding(outbound.tenantId,
            String(outbound.channelAccountId ?? ''),
            { source: 'http_response', code: refusal.code, detail: refusal.detail })
            .catch(() => undefined);
    }

    /**
     * Meta took a message from this account, which is the only proof billing
     * works again — produced by the platform rather than claimed by anybody.
     */
    private async resumeIfPaused(outbound: OutboundMessage): Promise<void> {
        if (outbound.channelType !== 'whatsapp') return;
        await this.pauses.clear(outbound.tenantId, String(outbound.channelAccountId ?? ''),
            { by: 'provider_accepted' }).catch(() => undefined);
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

    /**
     * Flows that Meta refused CONCLUSIVELY, whether or not a text replaced them.
     *
     * Marked the moment the gateway asks whether a fallback may be sent, which
     * it only does after classifying the failure as a definite refusal — the
     * ambiguous ones never reach the hook at all.
     *
     * Without this mark, a refusal the fallback could not follow was recorded
     * as a TIMEOUT: no message id came back, so the outcome reader assumed
     * nobody could say what happened and retained the whole reservation as
     * `indeterminate`. But somebody could say: Meta had said no. The money was
     * held for a message provably never sent, the ceiling filled with it, and a
     * person was eventually asked to resolve by hand an effect whose answer was
     * already in a log line.
     */
    private readonly conclusivelyRefusedFlows = new WeakSet<OutboundMessage>();

    /**
     * The two hooks every gateway call has to pass, built in one place.
     *
     * Written as a helper rather than repeated at each sink because the first
     * thing `admitFallback` now does is record a fact about the FLOW — and a
     * fact that four call sites each remember to record is a fact three of them
     * will eventually forget.
     */
    private flowHooks(outbound: OutboundMessage, producer: string,
        disposition: 'reactive' | 'proactive',
        durable?: { messageId?: string | null; jobId?: string | null }) {
        return {
            admitFallback: async (code: string) => {
                // BEFORE anything is decided about a replacement: whether the
                // Flow died is Meta's answer and whether a text may follow is
                // ours, and tying them together is what let a refusal with no
                // authorised fallback be filed as "we do not know".
                this.conclusivelyRefusedFlows.add(outbound);
                return this.admitFlowFallback(outbound, producer, disposition, code, durable);
            },
            observeFailure: (error: unknown) => this.observeFunding(outbound, error),
        };
    }

    private async recordSpend(outbound: OutboundMessage, admission: unknown, result: string | null) {
        if (!this.spendGate) return;
        const refused = this.conclusivelyRefusedFlows.has(outbound);
        if (refused) this.conclusivelyRefusedFlows.delete(outbound);
        // A Flow that was refused and fell back produced TWO effects. The Flow
        // is over — conclusively rejected, so its money goes back — and the text
        // is the one that carries the receipt.
        const fallback = this.fallbackAdmissions.get(outbound);
        if (fallback) {
            this.fallbackAdmissions.delete(outbound);
            await this.settle(outbound, admission, { kind: 'rejected', errorCode: 'flow_rejected' });
            await this.settle(outbound, fallback, result
                ? { kind: 'accepted', providerMessageId: result }
                : { kind: 'timeout' });
            return;
        }
        // ── A REFUSAL NOBODY COULD REPLACE IS STILL A REFUSAL ───────────────
        //
        // No fallback was authorised — the money authority said no, or could
        // not be reached. That changes nothing about the FLOW: Meta refused it
        // definitively and nothing was delivered, so the reservation goes back.
        // Recording it as a timeout held the whole amount as `indeterminate`
        // for a message provably never sent.
        if (refused) {
            await this.settle(outbound, admission,
                { kind: 'rejected', errorCode: 'flow_rejected_without_fallback' });
            return;
        }
        await this.settle(outbound, admission, result
            ? { kind: 'accepted', providerMessageId: result }
            : { kind: 'timeout' });
    }

    private async settle(outbound: OutboundMessage, admission: unknown, outcome: {
        kind: 'delivered_priced' | 'accepted' | 'rejected' | 'rejected_retryable' | 'timeout';
        providerMessageId?: string | null; errorCode?: string | null;
    }) {
        if (!admission || admission === 'refused' || !this.spendGate) return;
        try {
            const schema = await this.prisma.getTenantSchemaName(outbound.tenantId);
            await this.spendGate.record(schema, admission as Admission, outcome);
        } catch (error: any) {
            // Deliberately NOT fatal, and the asymmetry is the point: the
            // message has already gone out. Throwing here would retry a
            // delivered message, which costs a second charge to fix a
            // bookkeeping problem. The lease sweeper turns an unrecorded
            // outcome into visible exposure, which is the honest state.
            this.logger.error(`[Spend] outcome not recorded after sending: ${error?.message}. `
                + `The lease sweeper will surface it as exposure.`);
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
                    // The notice row is the durable identity: one row, one
                    // notice, and a retry of this job reads the same id.
                    const admission = await this.gateOrSuppress(outbound, 'operational_notice',
                        'proactive', { messageId: `notice:${reference.noticeId}` });
                    if (admission === 'refused') return null;
                    if (!(await this.beginOrStandDown(outbound, admission))) return null;
                    const result=await this.channelGateway.sendMessage(outbound,creds.accessToken,
                        this.flowHooks(outbound, 'operational_notice', 'proactive',
                            { messageId: `notice:${reference.noticeId}` }));
                    await this.recordSpend(outbound, admission, result);
                    if (result) await this.resumeIfPaused(outbound);
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
                    // The approved effect row: one ticket, one effect, and the
                    // pair survives a restart and a re-render of the body.
                    const admission = await this.gateOrSuppress(outbound, 'approved_effect',
                        'reactive', { messageId: `effect:${reference.ticketId}:${reference.effectId}` });
                    if (admission === 'refused') throw new ApprovalEffectSuppressed('spend_refused');
                    if (!(await this.beginOrStandDown(outbound, admission))) {
                        throw new ApprovalEffectSuppressed('transmission_not_owned');
                    }
                    const result = await this.channelGateway.sendMessage(outbound, creds.accessToken,
                        this.flowHooks(outbound, 'approved_effect', 'reactive',
                            { messageId: `effect:${reference.ticketId}:${reference.effectId}` }));
                    await this.recordSpend(outbound, admission, result);
                    if (result) await this.resumeIfPaused(outbound);
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

        // ── A RECIPIENT THIS LANE CANNOT ADDRESS ────────────────────────────
        //
        // Before the credential, before the money gate, before any POST. The
        // spend authority refuses this by name too — `recipient_not_addressable`
        // — and that refusal is what covers the other three sinks. It is asked
        // again here for one reason: the job's return value is the only thing an
        // operator reads afterwards, and `skipped:spend_refused` says a budget
        // stopped it, which sends somebody to look at a ceiling that is not the
        // problem.
        //
        // Returns, never throws. An exception burns one of the attempts, and at
        // the end of them the reply is dropped with nothing saying why — while
        // waiting changes nothing about a destination that does not exist.
        // Nothing is released because nothing was reserved: this is before
        // `gateOrSuppress`, which is the only thing here that reserves.
        if (isScopedAddressKey(outbound.to)) {
            this.logger.warn(`[Outbound] tenant=${outbound.tenantId}: recipient is a `
                + 'business-scoped id, which no endpoint accepts as a destination. Not sent, '
                + 'not retried, nothing reserved.');
            return 'skipped:recipient_not_addressable';
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
            (outbound.metadata as any)?.conversationId ? 'reactive' : 'proactive',
            { jobId: job.id ?? null });
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
            ...this.flowHooks(outbound, 'outbound_queue',
                (outbound.metadata as any)?.conversationId ? 'reactive' : 'proactive',
                { jobId: job.id ?? null }),
        });
        await this.recordSpend(outbound, admission, result);
        if (result) await this.resumeIfPaused(outbound);

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
