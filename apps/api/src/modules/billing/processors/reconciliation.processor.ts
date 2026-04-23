import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing.service';
import { PaymentProviderFactory } from '../payment-provider.factory';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { BillingEventType } from '../types/billing-event.enum';
import { PaymentProviderName } from '../types/provider-types';

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
    ) {}

    /**
     * Every hour at minute 0.
     * Repair subscriptions stuck in past_due by asking the provider directly.
     */
    @Cron(CronExpression.EVERY_HOUR)
    async reconcilePastDue() {
        const pastDue = await this.prisma.billingSubscription.findMany({
            where: { status: SubscriptionStatus.PAST_DUE },
            select: { id: true, tenantId: true, provider: true, providerSubscriptionId: true },
        });
        if (pastDue.length === 0) return;
        this.logger.log(`[Reconcile] past_due sweep: ${pastDue.length} subscription(s)`);

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
                    this.logger.log(`[Reconcile] sub=${sub.id} past_due → ${remote.status}`);
                }
            } catch (err: any) {
                this.logger.warn(`[Reconcile] sub=${sub.id} provider poll failed: ${err?.message}`);
            }
        }
    }

    /**
     * Daily at 03:00 local server time.
     * Full sweep — detect drift between DB state and provider state for every
     * non-terminal subscription.
     */
    @Cron('0 3 * * *')
    async fullReconciliation() {
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
        if (active.length === 0) return;
        this.logger.log(`[Reconcile] daily sweep: ${active.length} active subscription(s)`);

        let drift = 0;
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
                }
            } catch (err: any) {
                this.logger.warn(`[Reconcile] sub=${sub.id} provider poll failed: ${err?.message}`);
            }
        }

        if (drift > 0) {
            this.logger.warn(`[Reconcile] DAILY: ${drift} subscription(s) out of sync — corrected`);
        }
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
}
