import { BillingEventType } from './billing-event.enum';
import { SubscriptionStatus } from './subscription-status.enum';

/**
 * Supported payment providers. New providers are added here and must implement
 * IPaymentProvider. The active provider per tenant is stored in
 * `Tenant.paymentProvider` and routed by PaymentProviderFactory.
 */
export type PaymentProviderName = 'mercadopago' | 'stripe' | 'mock';

/**
 * Billing cycle chosen for a subscription. Stored on billing_subscriptions
 * (metadata.billingCycle) and used to resolve which preapproval_plan to bind:
 * monthly → priceLocalOverrides[country].mpPlanId, annual →
 * priceLocalOverrides[country].annual.mpPlanId. Maps to the provider's
 * billingInterval ('monthly'→'month', 'annual'→'year').
 */
export type BillingCycle = 'monthly' | 'annual';

// -----------------------------------------------------------------------------
// Customer
// -----------------------------------------------------------------------------

/**
 * Normalized customer record returned by a provider.
 *
 * Note on MercadoPago: MP has no native "customer" concept for subscriptions —
 * the payer is implicit in the `preapproval` record. The MercadoPago adapter
 * generates a synthetic ID (typically the tenant UUID) and returns it here so
 * the rest of the system can treat providers uniformly.
 */
export interface ProviderCustomer {
    providerCustomerId: string;
    email: string;
    name?: string;
    country?: string;
    createdAt: Date;
}

export interface CreateCustomerInput {
    tenantId: string;
    email: string;
    name?: string;
    country?: string;
    /** Arbitrary metadata to attach to the provider customer for reconciliation. */
    metadata?: Record<string, string>;
}

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

export interface ProviderPlan {
    providerPlanId: string;
    slug: string;
    name: string;
    amountCents: number;
    currency: string;
    billingInterval: 'month' | 'year';
    trialDays?: number;
}

export interface CreatePlanInput {
    slug: string;
    name: string;
    amountCents: number;
    currency: string;
    billingInterval: 'month' | 'year';
    trialDays?: number;
    metadata?: Record<string, string>;
}

// -----------------------------------------------------------------------------
// Subscription
// -----------------------------------------------------------------------------

export interface ProviderSubscription {
    providerSubscriptionId: string;
    providerCustomerId: string;
    providerPlanId: string;
    status: SubscriptionStatus;
    trialEndsAt?: Date;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    /** True if the subscription is scheduled to stop at current_period_end and not renew. */
    cancelAtPeriodEnd: boolean;
    /** The provider's native raw status string, for debugging. Do not use for logic. */
    rawStatus?: string;
}

export interface CreateSubscriptionInput {
    tenantId: string;
    providerCustomerId: string;
    providerPlanId: string;
    /** If set, provider applies a free trial of this length before the first charge. */
    trialDays?: number;
    /** Short-lived card token from the provider's client-side SDK. Some flows (Starter, no-card trial) omit this. */
    cardTokenId?: string;
    /**
     * Billing interval this subscription runs on. Informational only — the real
     * cycle is frozen in the preapproval_plan that providerPlanId points to. Used
     * for logging/telemetry. Defaults to 'month'.
     */
    billingInterval?: 'month' | 'year';
    /** Arbitrary metadata passed through to the provider for later correlation. */
    metadata?: Record<string, string>;
    /**
     * External reference the provider stores alongside the subscription. Used
     * for reconciliation queries (`GET /preapproval/search?external_reference=...`).
     * Defaults to the tenantId if omitted.
     */
    externalReference?: string;
}

export interface CancelSubscriptionOptions {
    /**
     * true: cancel immediately, revoke access now.
     * false (default): mark cancel_at_period_end; access preserved until period end.
     */
    immediate?: boolean;
    reason?: string;
}

// -----------------------------------------------------------------------------
// Payment (for webhooks and history)
// -----------------------------------------------------------------------------

export interface ProviderPayment {
    providerPaymentId: string;
    providerSubscriptionId?: string;
    amountCents: number;
    currency: string;
    status: 'succeeded' | 'failed' | 'refunded' | 'pending';
    paidAt?: Date;
    failureReason?: string;
    rawStatus?: string;
}

// -----------------------------------------------------------------------------
// Webhook
// -----------------------------------------------------------------------------

/**
 * A webhook event after the adapter has parsed and normalized it. This is what
 * BillingService.handleBillingEvent() consumes — it should never see raw
 * provider payloads.
 */
export interface NormalizedBillingEvent {
    /** Our normalized event taxonomy. */
    type: BillingEventType;
    /** Provider that sourced this event. */
    provider: PaymentProviderName;
    /**
     * Provider's unique event id. Used with Redis `idem:billing:{provider}:{id}`
     * to deduplicate; MP can redeliver the same event for 4 days.
     */
    providerEventId: string;
    /** When the event happened at the provider. */
    occurredAt: Date;

    /** Resolved from the provider's external_reference / metadata. */
    tenantId?: string;
    providerSubscriptionId?: string;
    providerCustomerId?: string;
    providerPaymentId?: string;
    /** Payer email from the payment — used as last-resort tenant resolution when providerSubscriptionId and tenantId are missing. */
    payerEmail?: string;

    /** The subscription state the provider is reporting (post-event). Undefined for non-subscription events. */
    subscription?: ProviderSubscription;
    /** The payment record, if the event is payment-related. */
    payment?: ProviderPayment;

    /**
     * The raw provider payload, stored verbatim in billing_events.payload for
     * audit and debugging. Never used for business logic — only the normalized
     * fields above are.
     */
    rawPayload: unknown;
}
