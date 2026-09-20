import { StripeAdapter } from './stripe.adapter';
import { BillingEventType } from '../types/billing-event.enum';

describe('Stripe webhook normalization', () => {
    function fixture(event: any) {
        const config: any = { webhookSecret: 'whsec_test', client: { webhooks: { constructEvent: jest.fn(() => event) } } };
        return new StripeAdapter(config);
    }
    it('reads Basil/Clover invoice subscription metadata and preserves zero paid amounts', async () => {
        const adapter = fixture({ id: 'evt_1', type: 'invoice.paid', created: 1800000000, data: { object: {
            id: 'in_1', customer: 'cus_1', amount_paid: 0, amount_due: 4900, currency: 'usd',
            parent: { subscription_details: { subscription: 'sub_1', metadata: { tenantId: 'tenant-1' } } },
        } } });
        const event = await adapter.parseWebhookEvent('{}', { 'stripe-signature': 'test' });
        expect(event).toMatchObject({ type: BillingEventType.PAYMENT_SUCCEEDED, providerSubscriptionId: 'sub_1', providerPaymentId: 'in_1', tenantId: 'tenant-1', payment: { amountCents: 0 } });
    });
    it('maps unknown and paused native statuses without granting active entitlement', () => {
        const adapter = fixture({});
        expect(adapter.mapSubscription({ id: 'sub_1', status: 'unknown' }).status).toBe('pending_auth');
        expect(adapter.mapSubscription({ id: 'sub_1', status: 'paused' }).status).toBe('past_due');
    });
    it('rejects one-time invoices so tenant customer payments cannot enter platform subscriptions', async () => {
        const adapter = fixture({ id: 'evt_1', type: 'invoice.paid', created: 1800000000, data: { object: { id: 'in_1', amount_paid: 4900 } } });
        await expect(adapter.parseWebhookEvent('{}', { 'stripe-signature': 'test' })).rejects.toMatchObject({ response: { error: 'stripe_invoice_not_subscription' } });
    });
});
