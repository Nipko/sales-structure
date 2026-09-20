/** Existing Stripe subscriptions are managed in the portal to avoid creating a duplicate subscription. */
export function stripeBillingAction(subscription: { provider: string; providerBacked: boolean } | null): 'checkout' | 'portal' {
    return subscription?.provider === 'stripe' && subscription.providerBacked ? 'portal' : 'checkout';
}

/** Restrict hosted billing redirects to the exact Stripe hosts used by our server. */
export function isStripeBillingUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && !url.username && !url.password && !url.port
            && (url.hostname === 'checkout.stripe.com' || url.hostname === 'billing.stripe.com');
    } catch {
        return false;
    }
}
