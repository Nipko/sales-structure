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

describe('Stripe refund boundaries', () => {
    const operationId = 'a1111111-1111-4111-8111-111111111111';
    const context = { operationId, idempotencyKey: `parallly:refund:${operationId}` };
    const refund = (patch: Record<string, unknown> = {}) => ({
        id: 're_1', object: 'refund', payment_intent: 'pi_1', amount: 1200, currency: 'usd',
        status: 'pending', livemode: false, metadata: { paralllyRefundOperationId: operationId }, ...patch,
    });

    function fixture(event?: any) {
        const client = {
            webhooks: { constructEvent: jest.fn(() => event) },
            invoices: { retrieve: jest.fn().mockResolvedValue({
                id: 'in_1', payment_intent: 'pi_1', parent: { subscription_details: { subscription: 'sub_1' } },
            }) },
            invoicePayments: { list: jest.fn().mockResolvedValue({ data: [{ invoice: 'in_1' }], has_more: false }) },
            paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_1', amount_received: 6900, currency: 'usd', livemode: false }) },
            refunds: { create: jest.fn().mockResolvedValue(refund()), list: jest.fn() },
        };
        const adapter = new StripeAdapter({ webhookSecret: 'whsec_test', client } as any);
        return { adapter, client };
    }

    it.each([
        ['refund.created', 'pending'],
        ['refund.updated', 'succeeded'],
        ['refund.failed', 'failed'],
    ])('routes %s to canonical invoice reconciliation without discarding the original state', async (type, status) => {
        const raw = { id: `evt_${status}`, type, created: 1800000000, data: { object: refund({ status }) } };
        const { adapter, client } = fixture(raw);
        const normalized = await adapter.parseWebhookEvent('{}', { 'stripe-signature': 'test' });
        expect(client.invoicePayments.list).toHaveBeenCalledWith({
            payment: { type: 'payment_intent', payment_intent: 'pi_1' }, limit: 1,
        });
        expect(normalized).toMatchObject({
            provider: 'stripe', providerEventId: raw.id, type: BillingEventType.PAYMENT_REFUNDED,
            providerPaymentId: 'in_1', providerSubscriptionId: 'sub_1', rawPayload: raw,
        });
        expect(client.refunds.create).not.toHaveBeenCalled();
    });

    it('resolves an expanded PaymentIntent on a refund event to its invoice', async () => {
        const { adapter, client } = fixture({ id: 'evt_expanded', type: 'refund.updated', created: 1800000000,
            data: { object: refund({ payment_intent: { id: 'pi_1', object: 'payment_intent' } }) } });
        const normalized = await adapter.parseWebhookEvent('{}', { 'stripe-signature': 'test' });
        expect(client.invoicePayments.list).toHaveBeenCalledWith({
            payment: { type: 'payment_intent', payment_intent: 'pi_1' }, limit: 1,
        });
        expect(normalized.providerPaymentId).toBe('in_1');
    });

    it.each(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])('returns the provider %s status without declaring it successful', async status => {
        const { adapter, client } = fixture();
        client.refunds.create.mockResolvedValue(refund({ status }));
        await expect(adapter.refundPayment('in_1', 1200, context)).resolves.toMatchObject({
            id: 're_1', status, paymentIntentId: 'pi_1', amountCents: 1200, currency: 'USD',
            livemode: false, operationId,
        });
    });

    it('replays the exact explicit amount and durable idempotency key after a lost response', async () => {
        const { adapter, client } = fixture();
        client.refunds.create.mockRejectedValueOnce(Object.assign(new Error('connection lost'), { type: 'StripeConnectionError' }))
            .mockResolvedValueOnce(refund());
        await expect(adapter.refundPayment('in_1', 1200, context)).rejects.toThrow('connection lost');
        // Another adapter instance models a later HTTP request or process restart.
        const recovered = new StripeAdapter({ webhookSecret: 'whsec_test', client } as any);
        await recovered.refundPayment('in_1', 1200, context);
        const expected = [{ payment_intent: 'pi_1', amount: 1200,
            metadata: { paralllyRefundOperationId: operationId } }, { idempotencyKey: context.idempotencyKey, maxNetworkRetries: 0 }];
        expect(client.refunds.create.mock.calls).toEqual([expected, expected]);
    });

    it.each([
        [undefined, undefined],
        [1200, undefined],
        [1200, { operationId, idempotencyKey: '' }],
        [undefined, context],
    ])('refuses a refund without its durable context and explicit amount', async (amount, requestContext) => {
        const { adapter, client } = fixture();
        await expect(adapter.refundPayment('pi_1', amount, requestContext)).rejects.toMatchObject({
            response: { error: 'stripe_refund_operation_required' },
        });
        expect(client.refunds.create).not.toHaveBeenCalled();
    });

    it('loads all refund pages and counts only succeeded refunds in the canonical total', async () => {
        const { adapter, client } = fixture();
        client.refunds.list.mockResolvedValueOnce({ data: [refund({ id: 're_pending' }), refund({ id: 're_failed', status: 'failed' })], has_more: true })
            .mockResolvedValueOnce({ data: [refund({ id: 're_succeeded', status: 'succeeded', amount: 700 })], has_more: false });
        const snapshot = await adapter.getRefundSnapshot('in_1');
        expect(client.refunds.list).toHaveBeenNthCalledWith(2, { payment_intent: 'pi_1', limit: 100, starting_after: 're_failed' });
        expect(snapshot).toMatchObject({ paymentIntentId: 'pi_1', amountPaidCents: 6900, succeededAmountCents: 700 });
        expect(snapshot.refunds).toHaveLength(3);
    });

    it('never treats an incomplete refund list as evidence that an operation does not exist', async () => {
        const { adapter, client } = fixture();
        client.refunds.list.mockResolvedValue({ data: [], has_more: true });
        await expect(adapter.getRefundSnapshot('in_1')).rejects.toThrow('stripe_refund_lookup_incomplete');
    });

    it('rejects a canonical refund from another PaymentIntent', async () => {
        const { adapter, client } = fixture();
        client.refunds.list.mockResolvedValue({ data: [refund({ payment_intent: 'pi_other', status: 'succeeded' })], has_more: false });
        await expect(adapter.getRefundSnapshot('in_1')).rejects.toThrow('stripe_refund_identity_mismatch');
    });
});
