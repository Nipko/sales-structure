import { Injectable, Logger } from '@nestjs/common';

/**
 * Billing reconciliation processor.
 *
 * Two crons (wired in Sprint 2 with @Cron decorators from @nestjs/schedule):
 *  - Hourly: sweep subscriptions in status=past_due, poll provider for updated
 *    state, transition to active or expired as appropriate.
 *  - Daily at 03:00: full sweep of all active subscriptions, query
 *    GET /preapproval/search?external_reference=... to reconcile drift. MP
 *    webhooks are documented to occasionally not fire — this cron is the
 *    source of truth recovery path.
 *
 * Also handles synthetic events:
 *  - trial.ending_soon — fired 3 days before trialEndsAt
 *  - subscription.expired — fired when grace window (currentPeriodEnd + 7 days
 *    read-only + 15 days retention per billing-plan.md Section 3.5) ends
 *
 * Scope of this file during Sprint 1.2: class skeleton only.
 */
@Injectable()
export class BillingReconciliationProcessor {
    private readonly logger = new Logger(BillingReconciliationProcessor.name);

    // TODO (Sprint 2): @Cron('0 * * * *') reconcilePastDue()
    // TODO (Sprint 2): @Cron('0 3 * * *') fullReconciliation()
    // TODO (Sprint 3): @Cron('0 9 * * *') emitTrialEndingSoon()
}
