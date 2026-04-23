import {
    CancelSubscriptionOptions,
    CreateCustomerInput,
    CreatePlanInput,
    CreateSubscriptionInput,
    NormalizedBillingEvent,
    PaymentProviderName,
    ProviderCustomer,
    ProviderPlan,
    ProviderSubscription,
} from '../types/provider-types';

/**
 * Provider-agnostic contract for payment integrations.
 *
 * Every payment provider (MercadoPago, Stripe, …) implements this interface.
 * BillingService and the rest of the platform depend only on this contract —
 * swapping providers requires adding a new adapter, not touching business code.
 *
 * Design notes
 * ------------
 * - All methods are async and must throw on provider errors. BillingService
 *   is responsible for retries, logging, and user-visible error translation.
 * - Webhook parsing is split in two: verify signature first (security),
 *   parse only if verification passed. Do not merge them — callers need to
 *   log/audit signature failures separately from parse failures.
 * - MercadoPago has no native customer object. The MP adapter returns a
 *   synthetic ProviderCustomer (see ProviderCustomer docs).
 * - Plan changes in MP require cancel + recreate; in Stripe they support
 *   proration. Both adapters expose changeSubscriptionPlan; the adapter
 *   hides the difference. Callers must not assume atomicity.
 */
export interface IPaymentProvider {
    /** Which provider this adapter serves. Used by PaymentProviderFactory for routing. */
    readonly name: PaymentProviderName;

    // --- Customer ---

    /**
     * Register/create a customer on the provider side.
     * For MercadoPago this is a local no-op returning a synthetic id.
     */
    createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer>;

    /**
     * Attach or replace the payment method on an existing customer.
     * `cardTokenId` is the short-lived token produced by the provider's
     * client-side SDK (never a raw PAN — we're not in PCI scope).
     */
    updatePaymentMethod(providerCustomerId: string, cardTokenId: string): Promise<void>;

    // --- Plan catalog ---

    /**
     * Register a plan with the provider. Usually called once per plan × country
     * by an admin script; billing_plans stores the returned providerPlanId.
     */
    createPlan(input: CreatePlanInput): Promise<ProviderPlan>;

    // --- Subscription lifecycle ---

    createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription>;

    /**
     * Cancel a subscription. Default is soft cancel (cancel_at_period_end).
     * Pass `{ immediate: true }` to revoke access now.
     */
    cancelSubscription(providerSubscriptionId: string, opts?: CancelSubscriptionOptions): Promise<void>;

    /**
     * Pause billing without cancelling. Not all providers support this —
     * adapters for providers that don't must throw NotImplementedException.
     */
    pauseSubscription(providerSubscriptionId: string): Promise<void>;

    resumeSubscription(providerSubscriptionId: string): Promise<void>;

    /**
     * Change the plan associated with a subscription. Providers differ on
     * proration behaviour; BillingService must inform the caller of the
     * returned subscription's new currentPeriodEnd and issue the right email.
     */
    changeSubscriptionPlan(
        providerSubscriptionId: string,
        newProviderPlanId: string,
    ): Promise<ProviderSubscription>;

    // --- Reconciliation ---

    getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription>;

    /**
     * List all subscriptions for a customer. Used by the reconciliation cron
     * to detect drift between provider state and our DB.
     */
    listCustomerSubscriptions(providerCustomerId: string): Promise<ProviderSubscription[]>;

    // --- Webhooks ---

    /**
     * Verify the webhook signature using the provider's scheme (HMAC-SHA256 for MP,
     * Stripe-Signature for Stripe). MUST be called before parseWebhookEvent.
     * Return false on mismatch; do not throw — callers log and return 401.
     */
    verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean;

    /**
     * Parse a provider webhook into a NormalizedBillingEvent. Only call after
     * verifyWebhookSignature returned true.
     *
     * Async because providers like MercadoPago send a notification shim (just
     * the resource type + id) instead of the full state. The adapter is
     * responsible for fetching the current resource from the provider API
     * before returning the normalized event.
     *
     * Implementations must:
     *  - extract providerEventId from the webhook (for idempotency)
     *  - extract tenantId from external_reference / metadata
     *  - map the provider's status strings to our SubscriptionStatus enum
     *  - store the raw payload (plus any fetched resource state) on NormalizedBillingEvent.rawPayload
     */
    parseWebhookEvent(rawBody: string, headers: Record<string, string>): Promise<NormalizedBillingEvent>;
}
