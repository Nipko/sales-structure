/**
 * Normalized billing event taxonomy.
 *
 * Every webhook from every provider maps to one of these events. The rest of
 * the platform (emails, analytics, feature gates, audit logs) listens to these
 * — never to provider-specific webhook names.
 *
 * Events are emitted via EventEmitter2 using the string literal as event name,
 * so handlers subscribe with `@OnEvent('billing.subscription.activated')`.
 */
export enum BillingEventType {
    // --- Subscription lifecycle ---
    SUBSCRIPTION_CREATED = 'billing.subscription.created',
    /** Trial ended and first paid charge succeeded (or subscription started without trial and first charge succeeded). */
    SUBSCRIPTION_ACTIVATED = 'billing.subscription.activated',
    /** Last renewal attempt failed; provider is retrying. */
    SUBSCRIPTION_PAST_DUE = 'billing.subscription.past_due',
    SUBSCRIPTION_CANCELLED = 'billing.subscription.cancelled',
    /** Grace window ended with no recovery. Tenant should be archived per retention policy. */
    SUBSCRIPTION_EXPIRED = 'billing.subscription.expired',
    SUBSCRIPTION_PLAN_CHANGED = 'billing.subscription.plan_changed',

    // --- Individual payment events ---
    PAYMENT_SUCCEEDED = 'billing.payment.succeeded',
    PAYMENT_FAILED = 'billing.payment.failed',
    PAYMENT_REFUNDED = 'billing.payment.refunded',

    // --- Trial events ---
    TRIAL_STARTED = 'billing.trial.started',
    /** Synthetic event emitted by a cron 3 days before trial end — not from a provider webhook. */
    TRIAL_ENDING_SOON = 'billing.trial.ending_soon',
    TRIAL_ENDED = 'billing.trial.ended',
}
