import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing.service';
import { PaymentProviderFactory } from '../payment-provider.factory';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { BillingEventType } from '../types/billing-event.enum';
import { PaymentProviderName } from '../types/provider-types';
import { CronLockService } from '../../redis/cron-lock.service';
import { SmsCheckoutService } from '../sms-checkout.service';
import { SubscriptionEngineService } from '../recurring/subscription-engine.service';

/**
 * Billing reconciliation.
 *
 * Background: MercadoPago webhooks are reportedly unreliable in production
 * for the `subscription_preapproval` topic (multiple developer community
 * reports — see docs/billing-plan.md Section 6). Rather than trust webhooks
 * alone, we run two cron jobs that poll the provider directly to detect drift
 * and repair DB state before the user notices anything wrong.
 *
 * Hourly (reconcilePastDue): for every subscription currently marked
 * past_due, ask the provider for the current state. If the provider now says
 * the payment succeeded, transition to active. If still failing past the
 * retry window, transition to cancelled.
 *
 * Daily at 03:00 (fullReconciliation): sweep every non-terminal subscription
 * and compare the provider's reported status against our DB. Any mismatch is
 * logged (eventually Sentry) and repaired by re-processing the latest state.
 *
 * A third job (emitTrialEndingSoon at 09:00) is scheduled separately in
 * Sprint 3 when the email sender is wired — kept out of this file for now.
 */
@Injectable()
export class BillingReconciliationProcessor {
    private readonly logger = new Logger(BillingReconciliationProcessor.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly billingService: BillingService,
        private readonly providerFactory: PaymentProviderFactory,
        private readonly eventEmitter: EventEmitter2,
        private readonly cronLock: CronLockService,
        private readonly smsCheckout: SmsCheckoutService,
        private readonly engine: SubscriptionEngineService,
    ) {}

    /**
     * Cada 15 minutos: rescatar las compras de SMS que MP cobró y cuyo webhook
     * nunca llegó. Vive acá porque es exactamente el mismo problema que
     * `reconcilePastDue` —confiar en un webhook que este mismo adaptador
     * advierte que es poco confiable— sólo que del lado del pago único.
     */
    @Cron('*/15 * * * *')
    async sweepSmsOrdersCron() {
        await this.cronLock.runExclusive('reconciliation.sweepSmsOrders', 840, async () => {
            const res = await this.smsCheckout.sweepPendingOrders();
            if (res.credited > 0) {
                this.logger.warn(`[Reconcile][SMS] ${res.credited} de ${res.checked} órdenes pendientes estaban pagas y se acreditaron`);
            }
        });
    }

    /**
     * Every hour at minute 0.
     * Repair subscriptions stuck in past_due by asking the provider directly.
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron(CronExpression.EVERY_HOUR)
    async reconcilePastDueCron() {
        await this.cronLock.runExclusive('reconciliation.reconcilePastDue', 1800, () => this.reconcilePastDue());
    }

    async reconcilePastDue(): Promise<{ scanned: number; repaired: number; errors: number }> {
        const pastDue = await this.prisma.billingSubscription.findMany({
            where: { status: SubscriptionStatus.PAST_DUE },
            select: { id: true, tenantId: true, provider: true, providerSubscriptionId: true },
        });
        if (pastDue.length === 0) return { scanned: 0, repaired: 0, errors: 0 };
        this.logger.log(`[Reconcile] past_due sweep: ${pastDue.length} subscription(s)`);

        let repaired = 0;
        let errors = 0;
        for (const sub of pastDue) {
            if (!sub.providerSubscriptionId) continue;
            try {
                const adapter = this.providerFactory.getByName(sub.provider as PaymentProviderName);
                const remote = await adapter.getSubscription(sub.providerSubscriptionId);

                if (remote.status !== SubscriptionStatus.PAST_DUE) {
                    await this.dispatchSyntheticEvent(
                        sub.provider as PaymentProviderName,
                        sub.providerSubscriptionId,
                        remote.status,
                        'reconcile_past_due',
                    );
                    repaired++;
                    this.logger.log(`[Reconcile] sub=${sub.id} past_due → ${remote.status}`);
                }
            } catch (err: any) {
                errors++;
                this.logger.warn(`[Reconcile] sub=${sub.id} provider poll failed: ${err?.message}`);
            }
        }
        return { scanned: pastDue.length, repaired, errors };
    }

    /**
     * Every 20 minutes: close charges the provider accepted but never resolved.
     *
     * The subscription-level reconciliation below cannot see these at all — it
     * asks the provider about a subscription object, and providers billed by our
     * own engine have none. Their unit of truth is the charge attempt, so
     * without this sweep a payment that really happened could stay `pending`
     * forever: the customer is charged and the subscription still expires.
     */
    @Cron('*/20 * * * *')
    async reconcileEngineChargesCron() {
        await this.cronLock.runExclusive('reconciliation.engineCharges', 600, async () => {
            await this.reconcileEngineCharges();
            const refunds = await this.billingService.reconcilePendingRefunds();
            if (refunds.finalized || refunds.errors) {
                this.logger.log(
                    `[Reconcile][Refund] scanned=${refunds.scanned} finalized=${refunds.finalized} errors=${refunds.errors}`,
                );
            }
        });
    }

    async reconcileEngineCharges(): Promise<{ scanned: number; resolved: number; errors: number }> {
        const pending = await this.engine.findUnresolvedAttempts(15, 200);
        let resolved = 0;
        let errors = 0;

        for (const attempt of pending) {
            try {
                const charging = this.providerFactory.getCharging(attempt.provider as PaymentProviderName);

                // No transaction id means the request timed out before we learned
                // it. The reference is the only handle left — and looking it up
                // is the difference between recovering the charge and either
                // losing the money or charging the customer twice.
                const charge = attempt.providerTxnId
                    ? await charging.getCharge(attempt.providerTxnId)
                    : await charging.getChargeByReference(attempt.reference);

                if (!charge) {
                    const executionStage = attempt.metadata && typeof attempt.metadata === 'object'
                        ? (attempt.metadata as any).executionStage
                        : undefined;
                    if (executionStage === 'reserved') {
                        // The durable pre-POST marker proves the worker died
                        // before it was authorised to call the provider. Reuse
                        // the same attempt; the orphan sweep republishes it.
                        const rescheduled = await this.engine.markAttempt(attempt.id, 'scheduled', {
                            scheduledAt: new Date(),
                            sentAt: null,
                            settledAt: null,
                            failureCode: 'worker_crash_before_provider_post',
                            failureClass: null,
                        });
                        if (!rescheduled) continue;
                        this.logger.warn(
                            `[Reconcile][Engine] Attempt ${attempt.id} crashed before provider POST — safely rescheduled`,
                        );
                        resolved++;
                    // Once provider_post_started is durable, only the canonical
                    // reference lookup above can prove no charge exists.
                    } else if (attempt.failureClass === 'indeterminate') {
                        await this.engine.settleFailed(
                            attempt.id,
                            { status: 'error', statusMessage: 'never reached the provider' },
                            'soft',
                        );
                        this.logger.warn(
                            `[Reconcile][Engine] Attempt ${attempt.id} never reached the provider — released for retry`,
                        );
                        resolved++;
                    }
                    continue;
                }

                if (charge.status === 'approved') {
                    await this.engine.settleApproved(attempt.id, charge);
                    this.logger.warn(
                        `[Reconcile][Engine] Attempt ${attempt.id} was APPROVED and had not been recorded — settled`,
                    );
                    resolved++;
                } else if (charge.status === 'declined' || charge.status === 'error' || charge.status === 'voided') {
                    await this.engine.settleFailed(attempt.id, charge, this.engine.classifyFailure(charge));
                    resolved++;
                }
                // Still pending at the provider: leave it for the next sweep.
            } catch (err: any) {
                errors++;
                this.logger.error(`[Reconcile][Engine] Could not resolve attempt ${attempt.id}: ${err?.message}`);
            }
        }

        if (resolved || errors) {
            this.logger.log(`[Reconcile][Engine] scanned=${pending.length} resolved=${resolved} errors=${errors}`);
        }
        return { scanned: pending.length, resolved, errors };
    }

    /**
     * Daily at 03:00 local server time.
     * Full sweep — detect drift between DB state and provider state for every
     * non-terminal subscription.
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 3 * * *')
    async fullReconciliationCron() {
        await this.cronLock.runExclusive('reconciliation.fullReconciliation', 3600, () => this.fullReconciliation());
    }

    async fullReconciliation(): Promise<{ scanned: number; drift: number; repaired: number; errors: number }> {
        const active = await this.prisma.billingSubscription.findMany({
            where: {
                status: {
                    in: [
                        SubscriptionStatus.TRIALING,
                        SubscriptionStatus.ACTIVE,
                        SubscriptionStatus.PAST_DUE,
                        SubscriptionStatus.PENDING_AUTH,
                    ],
                },
            },
            select: { id: true, tenantId: true, status: true, provider: true, providerSubscriptionId: true },
        });
        if (active.length === 0) return { scanned: 0, drift: 0, repaired: 0, errors: 0 };
        this.logger.log(`[Reconcile] daily sweep: ${active.length} active subscription(s)`);

        let drift = 0;
        let repaired = 0;
        let errors = 0;
        for (const sub of active) {
            if (!sub.providerSubscriptionId) continue;
            try {
                const adapter = this.providerFactory.getByName(sub.provider as PaymentProviderName);
                const remote = await adapter.getSubscription(sub.providerSubscriptionId);

                // Treat trialing vs active drift as non-actionable — the
                // transition happens naturally at the next payment webhook.
                // Everything else is real drift.
                const driftDetected = remote.status !== sub.status
                    && !(sub.status === SubscriptionStatus.TRIALING && remote.status === SubscriptionStatus.ACTIVE);

                if (driftDetected) {
                    drift++;
                    this.logger.warn(`[Reconcile] DRIFT sub=${sub.id} db=${sub.status} remote=${remote.status}`);
                    await this.dispatchSyntheticEvent(
                        sub.provider as PaymentProviderName,
                        sub.providerSubscriptionId,
                        remote.status,
                        'full_reconciliation',
                    );
                    repaired++;
                }
            } catch (err: any) {
                errors++;
                this.logger.warn(`[Reconcile] sub=${sub.id} provider poll failed: ${err?.message}`);
            }
        }

        if (drift > 0) {
            this.logger.warn(`[Reconcile] DAILY: ${drift} subscription(s) out of sync — corrected`);
        }
        return { scanned: active.length, drift, repaired, errors };
    }

    /**
     * Build a synthetic NormalizedBillingEvent and feed it to BillingService
     * so the same state-transition logic webhook handlers use also runs here.
     * Keeps the state machine in exactly one place (BillingService).
     */
    private async dispatchSyntheticEvent(
        provider: PaymentProviderName,
        providerSubscriptionId: string,
        remoteStatus: SubscriptionStatus,
        reason: string,
    ) {
        const type = this.statusToEventType(remoteStatus);
        if (!type) return; // no transition needed

        // Synthetic event id namespaced so it never collides with real webhook
        // ids — prefixed with `recon_` and timestamped for idempotency per run.
        const providerEventId = `recon_${provider}_${providerSubscriptionId}_${Date.now()}`;
        await this.billingService.handleBillingEvent({
            type,
            provider,
            providerEventId,
            occurredAt: new Date(),
            providerSubscriptionId,
            rawPayload: { source: 'reconciliation', reason, remoteStatus },
        });
    }

    private statusToEventType(status: SubscriptionStatus): BillingEventType | null {
        switch (status) {
            case SubscriptionStatus.ACTIVE:
                return BillingEventType.SUBSCRIPTION_ACTIVATED;
            case SubscriptionStatus.PAST_DUE:
                return BillingEventType.SUBSCRIPTION_PAST_DUE;
            case SubscriptionStatus.CANCELLED:
                return BillingEventType.SUBSCRIPTION_CANCELLED;
            case SubscriptionStatus.EXPIRED:
                return BillingEventType.SUBSCRIPTION_EXPIRED;
            default:
                return null;
        }
    }

    /**
     * Every 10 minutes — apply scheduled plan downgrades whose effective
     * date has passed. Tenants who downgrade keep their higher tier
     * features until period end, then this cron flips planId.
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('*/10 * * * *')
    async applyPendingDowngradesCron() {
        await this.cronLock.runExclusive('reconciliation.applyPendingDowngrades', 300, () => this.applyPendingDowngrades());
    }

    async applyPendingDowngrades() {
        try {
            const result = await this.billingService.applyPendingPlanChanges();
            if (result.applied > 0) {
                this.logger.log(`[Reconcile] Applied ${result.applied} pending plan changes`);
            }
        } catch (err: any) {
            this.logger.error(`[Reconcile] applyPendingDowngrades failed: ${err.message}`);
        }
    }

    /**
     * Daily at 09:00 — fire billing.trial.ending_soon for every tenant whose
     * trial ends in 72–96 hours. That 24-hour window (instead of an exact
     * "3 days before") absorbs clock skew and makes missed runs self-healing
     * within 24h.
     *
     * Deduplicated via billing_events: we write a synthetic event with a
     * deterministic providerEventId per subscription, and the UNIQUE constraint
     * (provider, providerEventId) makes the second insert a no-op. So if the
     * cron fires twice (two pods, a replay, whatever) the email still sends
     * only once.
     */
    @Cron('0 9 * * *')
    async emitTrialEndingSoon() {
        const now = Date.now();
        const from = new Date(now + 72 * 3600_000); // 3 days from now
        const to = new Date(now + 96 * 3600_000);   // 4 days from now

        const trialing = await this.prisma.billingSubscription.findMany({
            where: {
                status: SubscriptionStatus.TRIALING,
                trialEndsAt: { gte: from, lte: to },
            },
            select: { id: true, tenantId: true, trialEndsAt: true },
        });
        if (trialing.length === 0) return;
        this.logger.log(`[Reconcile] trial.ending_soon: ${trialing.length} subscription(s) in window`);

        for (const sub of trialing) {
            const providerEventId = `synthetic_trial_ending_soon_${sub.id}`;
            try {
                await this.prisma.billingEvent.create({
                    data: {
                        tenantId: sub.tenantId,
                        subscriptionId: sub.id,
                        provider: 'system',
                        providerEventId,
                        eventType: BillingEventType.TRIAL_ENDING_SOON,
                        payload: { trialEndsAt: sub.trialEndsAt, source: 'cron' } as any,
                    },
                });
            } catch {
                // UNIQUE violation → already fired. Skip the emit so the email
                // doesn't duplicate on subsequent cron runs.
                continue;
            }

            this.eventEmitter.emit(BillingEventType.TRIAL_ENDING_SOON, {
                tenantId: sub.tenantId,
                subscriptionId: sub.id,
                trialEndsAt: sub.trialEndsAt,
            });
        }
    }
}
