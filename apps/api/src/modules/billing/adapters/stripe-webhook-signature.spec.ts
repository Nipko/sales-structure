import { StripeAdapter } from './stripe.adapter';
import { StripeConfigService } from './stripe-config.service';

describe('Stripe credentials and real SDK signature boundary', () => {
    const secret = 'whsec_local_signature_fixture';
    const payload = JSON.stringify({ id: 'evt_fixture', type: 'customer.subscription.updated', created: 1800000000, data: { object: { id: 'sub_fixture' } } });
    const config = (values: Record<string, string> = {}) => {
        const settings = { NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_local_fixture', STRIPE_WEBHOOK_SECRET: secret, ...values };
        return new StripeConfigService({ get: (key: keyof typeof settings, fallback?: string) => settings[key] ?? fallback } as any);
    };

    it('accepts a Stripe-signed raw body and rejects tampering, absent signatures and expired signatures', () => {
        const configuration = config();
        const adapter = new StripeAdapter(configuration);
        const signature = configuration.client.webhooks.generateTestHeaderString({ payload, secret });
        expect(adapter.verifyWebhookSignature(payload, { 'stripe-signature': signature })).toBe(true);
        expect(adapter.verifyWebhookSignature(`${payload} `, { 'stripe-signature': signature })).toBe(false);
        expect(adapter.verifyWebhookSignature(payload, {})).toBe(false);
        const expired = configuration.client.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 600 });
        expect(adapter.verifyWebhookSignature(payload, { 'stripe-signature': expired })).toBe(false);
    });

    it.each([
        [{ STRIPE_SECRET_KEY: '' }, false],
        [{ STRIPE_WEBHOOK_SECRET: '' }, false],
        [{ NODE_ENV: 'production' }, false],
        [{ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_fixture' }, true],
        [{}, true],
    ])('requires matching deployment readiness %j', (values, configured) => {
        expect(config(values as Record<string, string>).isConfigured).toBe(configured);
    });

    it('constructs server-owned return URLs and rejects insecure remote origins', () => {
        expect(config({ DASHBOARD_URL: 'https://admin.example.test/arbitrary?redirect=evil' }).dashboardUrl)
            .toBe('https://admin.example.test/admin/settings/billing');
        expect(() => config({ DASHBOARD_URL: 'http://admin.example.test' }).dashboardUrl).toThrow('Invalid DASHBOARD_URL');
    });
});
