import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentProviderFactory } from '../../payment-provider.factory';
import { PaymentProviderName } from '../../types/provider-types';
import { PaymentSourceKind } from '../../adapters/provider-capabilities';
import { SubscriptionEngineService } from '../subscription-engine.service';
import {
    CHARGE_POLL_QUEUE,
    nextBillingLocalDay,
    RENEWAL_QUEUE,
    RenewalSchedulerService,
    wompiTransactionLimitViolation,
    wompiMerchantTimezone,
} from '../renewal-scheduler.service';

/** Backoff for asking the provider what happened to a charge it accepted. */
const POLL_DELAYS_MS = [10_000, 30_000, 60_000, 180_000, 600_000, 1_800_000, 7_200_000];

/**
 * Executes ONE charge attempt. This is the only place in the platform that moves
 * a customer's money on a schedule, and it is written defensively on purpose.
 *
 * Order of operations, and why each step exists:
 *  1. Reserve the row (guarded UPDATE) — a job delivered twice stops here.
 *  2. Revalidate against live state — a row queued days ago has no authority now.
 *  3. Refuse if too late — a worker returning from an outage must not fire an
 *     avalanche of retroactive charges.
 *  4. Charge with NO network retry — the POST is not idempotent.
 *  5. PENDING is the normal answer: hand off to polling, which converges with
 *     the webhook on the same resolver.
 *  6. A timeout with no provider id is INDETERMINATE and terminal: the money may
 *     have moved, so we never try again for that cycle.
 */
@Processor(RENEWAL_QUEUE, { concurrency: 4 })
export class RenewalChargeProcessor extends WorkerHost {
    private readonly logger = new Logger(RenewalChargeProcessor.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly engine: SubscriptionEngineService,
        private readonly providerFactory: PaymentProviderFactory,
        private readonly capacity: RenewalSchedulerService,
        @InjectQueue(RENEWAL_QUEUE) private readonly renewalQueue: Queue,
        @InjectQueue(CHARGE_POLL_QUEUE) private readonly pollQueue: Queue,
    ) {
        super();
    }

    async process(job: Job<{ attemptId: string }>): Promise<void> {
        const { attemptId } = job.data || ({} as any);
        if (!attemptId) {
            this.logger.warn(`[Charge] Job ${job.id} carries no attemptId — discarded`);
            return;
        }

        // 1. Exclusive ownership. Losing this race is the correct outcome of a
        //    duplicate delivery, not an error.
        const attempt = await this.engine.reserveForExecution(attemptId);
        if (!attempt) {
            this.logger.debug(`[Charge] Attempt ${attemptId} is not schedulable (already taken or resolved)`);
            return;
        }

        // 2. Does this charge still make sense?
        const check = await this.engine.revalidate(attempt);
        if (!check.ok) {
            await this.engine.markAttempt(attemptId, 'abandoned', {
                failureCode: check.reason,
                settledAt: new Date(),
            });
            this.logger.log(`[Charge] Attempt ${attemptId} abandoned: ${check.reason}`);
            return;
        }

        // 3. Overdue attempts are dropped, not fired late.
        if (this.engine.isTooLate(attempt)) {
            await this.engine.markAttempt(attemptId, 'stale', {
                failureCode: 'too_late',
                settledAt: new Date(),
            });
            this.logger.error(
                `[Charge] Attempt ${attemptId} was scheduled for ${attempt.scheduled_at} and is too late to charge — marked stale`,
            );
            return;
        }

        const provider = attempt.provider as PaymentProviderName;
        const charging = this.providerFactory.getCharging(provider);

        const source = attempt.payment_source_id
            ? await this.prisma.billingPaymentSource.findFirst({
                where: {
                    id: attempt.payment_source_id,
                    tenantId: attempt.tenant_id,
                    provider: attempt.provider,
                },
            })
            : null;
        if (!source || source.status !== 'available') {
            // Funnel through the normal settlement so PAYMENT_FAILED reaches
            // Dunning. A direct row patch strands the subscription ACTIVE
            // forever because no retry/soft-lock/expiry transition is started.
            await this.engine.settleFailed(
                attemptId,
                {
                    status: 'error',
                    statusMessage: source ? `source_${source.status}` : 'no_payment_source',
                },
                'hard',
            );
            this.logger.warn(`[Charge] Attempt ${attemptId} has no usable payment source`);
            return;
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: attempt.tenant_id },
            select: { billingEmail: true },
        });

        // Acceptance contracts are short-lived JWTs, so they are fetched per
        // charge rather than cached.
        let acceptance;
        try {
            acceptance = await charging.getAcceptanceContracts();
        } catch (err: any) {
            // Not a payment failure: nothing was attempted, so it can be retried
            // safely by rescheduling the same attempt.
            const retryAt = new Date(Date.now() + 15 * 60_000);
            const rescheduled = await this.engine.markAttempt(attemptId, 'scheduled', {
                scheduledAt: retryAt,
                sentAt: null,
                failureCode: `acceptance_unavailable: ${err?.message}`,
                failureClass: 'soft',
                settledAt: null,
            });
            if (!rescheduled) return;
            await this.renewalQueue.add(
                'charge',
                { attemptId },
                {
                    jobId: `${attemptId}-acceptance-${retryAt.getTime()}`,
                    attempts: 1,
                    delay: Math.max(0, retryAt.getTime() - Date.now()),
                    removeOnComplete: { age: 86_400 },
                },
            );
            return;
        }

        // The contractual per-transaction limit applies to every purpose too.
        // Scheduler and onboarding checks improve feedback, but only this point
        // is common to initial, renewal, dunning and upgrade-proration jobs.
        if (provider === 'wompi') {
            const violation = wompiTransactionLimitViolation(attempt.amount_cents, attempt.currency);
            if (violation) {
                const retryAt = new Date(Date.now() + 60 * 60_000);
                const rescheduled = await this.engine.markAttempt(attemptId, 'scheduled', {
                    scheduledAt: retryAt,
                    sentAt: null,
                    failureCode: violation.error,
                    failureClass: null,
                    settledAt: null,
                });
                if (!rescheduled) return;
                await this.renewalQueue.add(
                    'charge',
                    { attemptId },
                    {
                        jobId: `${attemptId}-transaction-limit-${retryAt.getTime()}`,
                        attempts: 1,
                        delay: Math.max(0, retryAt.getTime() - Date.now()),
                        removeOnComplete: { age: 86_400 },
                    },
                ).catch((error: any) => {
                    this.logger.error(`[Charge] Could not enqueue limit-blocked attempt ${attemptId}: ${error?.message ?? error}`);
                });
                this.logger.error(
                    `[Charge] Attempt ${attemptId} blocked before provider POST: ${violation.error} `
                    + `(amount=${attempt.amount_cents} cents, limit=${violation.limitCents ?? 'missing'}).`,
                );
                return;
            }
        }

        // The platform merchant cap applies to every Wompi charge purpose —
        // acquisition, renewal and proration. Reserving here, immediately before
        // the non-idempotent POST, prevents initial/upgrade jobs (which do not
        // pass through the renewal scheduler) from bypassing it. The attempt id
        // is the Redis idempotency marker for duplicate job delivery.
        const capacityTimezone = wompiMerchantTimezone();
        const hasCapacity = await this.capacity.reserveDailyCapacity(
            attempt.amount_cents,
            attempt.currency,
            provider,
            attemptId,
            capacityTimezone,
        );
        if (!hasCapacity) {
            const retryAt = nextBillingLocalDay(new Date(), capacityTimezone);
            const rescheduled = await this.engine.markAttempt(attemptId, 'scheduled', {
                scheduledAt: retryAt,
                sentAt: null,
                failureCode: 'daily_capacity_deferred',
                failureClass: 'soft',
                settledAt: null,
            });
            if (!rescheduled) return;
            await this.renewalQueue.add(
                'charge',
                { attemptId },
                {
                    jobId: `${attemptId}-capacity-${retryAt.getTime()}`,
                    attempts: 1,
                    delay: Math.max(0, retryAt.getTime() - Date.now()),
                    removeOnComplete: { age: 172_800 },
                },
            ).catch((error: any) => {
                // The DB row remains scheduled. rescueOrphanAttempts will
                // republish it when Redis/BullMQ recovers.
                this.logger.error(`[Charge] Could not enqueue deferred attempt ${attemptId}: ${error?.message ?? error}`);
            });
            this.logger.warn(`[Charge] Attempt ${attemptId} deferred to ${retryAt.toISOString()} by merchant daily cap`);
            return;
        }

        if (!(await this.engine.markProviderPostStarted(attemptId))) {
            this.logger.warn(`[Charge] Attempt ${attemptId} lost ownership before the provider POST`);
            return;
        }

        // 4. The charge itself.
        let charge;
        try {
            charge = await charging.charge({
                reference: attempt.reference,
                amountCents: attempt.amount_cents,
                currency: attempt.currency,
                customerEmail: tenant?.billingEmail || '',
                providerSourceId: source.providerSourceId,
                sourceKind: source.kind as PaymentSourceKind,
                // Same amount every period: the card-on-file signal issuers score
                // recurring charges by.
                recurrent: true,
                acceptance,
            });
        } catch (err: any) {
            const hasProviderId = Boolean(err?.response?.providerChargeId);
            if (!hasProviderId && this.looksIndeterminate(err)) {
                // We do not know whether the money moved. Freeze it.
                await this.engine.markIndeterminate(attemptId, err?.message ?? 'request_failed');
                return;
            }
            const failureClass = this.engine.classifyFailure({ statusMessage: err?.message });
            await this.engine.settleFailed(attemptId, { status: 'error', statusMessage: err?.message }, failureClass);
            return;
        }

        // 5. Resolve, or wait for the outcome.
        if (charge.status === 'approved') {
            await this.engine.settleApproved(attemptId, charge);
            return;
        }
        if (charge.status === 'declined' || charge.status === 'error') {
            await this.engine.settleFailed(attemptId, charge, this.engine.classifyFailure(charge));
            return;
        }

        // PENDING — the normal path with an asynchronous provider.
        const markedPending = await this.engine.markAttempt(attemptId, 'pending_provider', {
            providerTxnId: charge.providerChargeId,
            providerStatus: charge.rawStatus ?? 'PENDING',
        });
        if (!markedPending) return;
        await this.pollQueue.add(
            'poll',
            { attemptId, providerChargeId: charge.providerChargeId, pollNumber: 0 },
            { jobId: `poll-${attemptId}-0`, attempts: 1, delay: POLL_DELAYS_MS[0], removeOnComplete: { age: 86_400 } },
        );
        this.logger.log(`[Charge] Attempt ${attemptId} is pending at the provider (${charge.providerChargeId})`);
    }

    /**
     * Whether a failure left the outcome unknown.
     *
     * A refusal the provider articulated (4xx with a body) is a decision we can
     * trust. A timeout, an aborted socket or a 5xx is not: the request may well
     * have been processed after we stopped listening.
     */
    private looksIndeterminate(err: any): boolean {
        const status = err?.response?.status ?? err?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) return false;
        const message = String(err?.message ?? '').toLowerCase();
        return message.includes('abort')
            || message.includes('timeout')
            || message.includes('econnreset')
            || message.includes('socket')
            || message.includes('network')
            || status === undefined
            || (typeof status === 'number' && status >= 500);
    }
}
