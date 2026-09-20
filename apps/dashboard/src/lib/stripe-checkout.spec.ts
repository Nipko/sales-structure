import { isStripeBillingUrl, stripeBillingAction } from './stripe-checkout';

describe('Stripe hosted billing', () => {
    it('uses the portal only when a Stripe subscription already exists remotely', () => {
        expect(stripeBillingAction(null)).toBe('checkout');
        expect(stripeBillingAction({ provider: 'stripe', providerBacked: false })).toBe('checkout');
        expect(stripeBillingAction({ provider: 'stripe', providerBacked: true })).toBe('portal');
        expect(stripeBillingAction({ provider: 'wompi', providerBacked: true })).toBe('checkout');
    });
    it.each(['https://checkout.stripe.com/c/pay/test', 'https://billing.stripe.com/p/session/test'])('accepts hosted Stripe session %s', (url) => {
        expect(isStripeBillingUrl(url)).toBe(true);
    });
    it.each(['http://checkout.stripe.com/test', 'https://checkout.stripe.com.evil.example/', 'https://evil.example/', 'javascript:alert(1)', 'https://user@checkout.stripe.com/test', 'https://billing.stripe.com:8443/test'])('rejects unsafe redirect %s', (url) => {
        expect(isStripeBillingUrl(url)).toBe(false);
    });
});
