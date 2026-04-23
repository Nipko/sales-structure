/**
 * Internal, provider-agnostic subscription state.
 *
 * Every payment provider has its own status vocabulary (MercadoPago uses
 * authorized/paused/cancelled, Stripe uses trialing/active/past_due/canceled…).
 * Each adapter translates to/from this enum so the rest of the platform
 * reasons about subscriptions in one vocabulary.
 *
 * State transitions (enforced by BillingService):
 *
 *   pending_auth ──► trialing ──► active ──► past_due ──► cancelled ──► expired
 *                                    ▲          │             │
 *                                    └──────────┘             ▼
 *                                 (retry OK)              (no recovery)
 */
export enum SubscriptionStatus {
    /** Subscription exists but has no valid payment method yet. Bot is blocked. */
    PENDING_AUTH = 'pending_auth',

    /** Trial window active. User has full access. No charges happening. */
    TRIALING = 'trialing',

    /** Paid and healthy. Regular billing cycle. */
    ACTIVE = 'active',

    /** Last charge failed. Retrying per provider policy. Access preserved during retry window. */
    PAST_DUE = 'past_due',

    /** User (or we) cancelled. Access preserved until current_period_end, then expired. */
    CANCELLED = 'cancelled',

    /** Past grace window. Tenant becomes read-only, then archived per retention policy. */
    EXPIRED = 'expired',
}
