import { StripeBillingService } from './stripe-billing.service';
import { StripeAdapter } from './adapters/stripe.adapter';
import { BillingEventType } from './types/billing-event.enum';

describe('Stripe hosted subscription boundary', () => {
    const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const subId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    function fixture() {
        const plan = { id: 'plan-1', slug: 'starter', name: 'Starter', priceUsdCents: 4900, trialDays: 7, isActive: true, priceLocalOverrides: {}, features: {} };
        const tenant = { id: tenantId, name: 'Example', billingEmail: 'owner@example.com', billingCountry: 'MX' };
        let sub: any = { id: subId, tenantId, planId: plan.id, provider: 'stripe', engine: 'provider', status: 'trialing',
            providerCustomerId: 'cus_1', providerSubscriptionId: null, metadata: { billingCountry: 'MX', billingCycle: 'monthly' },
            trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 7 * 86400000), tenant, plan };
        const paymentRows: any[] = [];
        const eventRows: any[] = [];
        const prisma: any = {
            billingSubscription: {
                findUnique: jest.fn(async () => sub),
                update: jest.fn(async ({ data }: any) => (sub = { ...sub, ...data })),
            },
            tenant: { update: jest.fn(), findUnique: jest.fn(async () => tenant) },
            billingPlan: { findUnique: jest.fn(async () => plan) },
            billingEvent: {
                findUnique: jest.fn(async ({ where }: any) => eventRows.find(e => e.providerEventId === where.provider_providerEventId.providerEventId)),
                create: jest.fn(async ({ data }: any) => { eventRows.push(data); return data; }),
                upsert: jest.fn(async ({ create }: any) => { eventRows.push(create); return create; }),
            },
            billingPayment: {
                findFirst: jest.fn(async ({ where }: any) => paymentRows.find(p => p.providerPaymentId === where.providerPaymentId)),
                create: jest.fn(async ({ data }: any) => { const row = { id: 'payment-1', ...data }; paymentRows.push(row); return row; }),
                update: jest.fn(async ({ where, data }: any) => Object.assign(paymentRows.find(p => p.id === where.id), data)),
            },
            $queryRawUnsafe: jest.fn(async () => []),
            $transaction: jest.fn(async (fn: any) => fn(prisma)),
        };
        const redis: any = { acquireLockToken: jest.fn(async () => 'token'), releaseLockToken: jest.fn(async () => undefined), del: jest.fn(async () => undefined) };
        const remote: any = {
            id: 'sub_remote', customer: 'cus_1', status: 'trialing', livemode: false,
            trial_end: Math.floor(sub.trialEndsAt.getTime() / 1000),
            metadata: { tenantId, localSubscriptionId: subId, checkoutAttemptId: 'attempt-1' },
            items: { data: [{ id: 'si_1', quantity: 1, current_period_start: 1800000000, current_period_end: 1802592000,
                price: { id: 'price_1', currency: 'usd', unit_amount: 4900, recurring: { interval: 'month', interval_count: 1 } } }] },
        };
        const stripe: any = {
            customers: { create: jest.fn(async () => ({ id: 'cus_1' })) },
            checkout: { sessions: {
                create: jest.fn(async () => ({ id: 'cs_1', status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_1' })),
                retrieve: jest.fn(async () => ({ id: 'cs_1', status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_1' })),
                expire: jest.fn(async () => ({ id: 'cs_1', status: 'expired' })),
            } },
            subscriptions: { retrieve: jest.fn(async () => remote), update: jest.fn(), cancel: jest.fn() },
            prices: { create: jest.fn(async () => ({ id: 'price_target' })) },
            subscriptionSchedules: { create: jest.fn(async () => ({ id: 'schedule_1' })), update: jest.fn(), release: jest.fn() },
        };
        const config: any = { isConfigured: true, client: stripe, dashboardUrl: 'https://admin.example.com/admin/settings/billing' };
        const adapter = new StripeAdapter(config);
        const events: any = { emit: jest.fn() };
        const routing: any = { assertUsableForNewSubscription: jest.fn(async () => undefined) };
        const service = new StripeBillingService(prisma, redis, config, adapter, events, routing);
        const bind = () => {
            sub.metadata.stripeCheckout = { id: 'attempt-1', planId: plan.id, cycle: 'monthly', country: 'MX', amountCents: 4900, currency: 'USD' };
        };
        const event = (overrides: any = {}) => ({ provider: 'stripe' as const, providerEventId: 'evt_1', providerSubscriptionId: 'sub_remote',
            occurredAt: new Date(), type: BillingEventType.SUBSCRIPTION_CREATED, rawPayload: { livemode: false }, ...overrides });
        return { service, prisma, stripe, config, events, routing, remote, tenant, plan, bind, event, payments: paymentRows, get sub() { return sub; } };
    }

    it('freezes USD catalog price and trial, never sends card data or arms the internal engine', async () => {
        const f = fixture();
        const result = await f.service.createCheckout(tenantId);
        expect(result.url).toContain('https://checkout.stripe.com/');
        const [params, options] = f.stripe.checkout.sessions.create.mock.calls[0];
        expect(params.line_items[0].price_data).toEqual(expect.objectContaining({ unit_amount: 4900, currency: 'usd', recurring: { interval: 'month' } }));
        expect(params.subscription_data.trial_end).toBe(Math.floor(f.sub.trialEndsAt.getTime() / 1000));
        expect(params.subscription_data.metadata.localSubscriptionId).toBe(subId);
        expect(params.success_url).toBe('https://admin.example.com/admin/settings/billing?stripe=success');
        expect(f.sub.metadata.stripeCheckout.id).toBe(options.idempotencyKey);
        expect(f.sub.engine).toBe('provider');
        expect(f.routing.assertUsableForNewSubscription).toHaveBeenCalledWith('stripe', 'MX');
    });

    it('reuses an open session on repeated clicks and never creates a second subscription', async () => {
        const f = fixture();
        await f.service.createCheckout(tenantId);
        await f.service.createCheckout(tenantId);
        expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it('recovers an ambiguous POST using the durable original idempotency key', async () => {
        const f = fixture();
        f.stripe.checkout.sessions.create.mockRejectedValueOnce(new Error('connection reset'));
        await expect(f.service.createCheckout(tenantId)).rejects.toThrow('connection reset');
        const attempt = f.sub.metadata.stripeCheckout;
        await f.service.createCheckout(tenantId);
        expect(f.stripe.checkout.sessions.create).toHaveBeenLastCalledWith(attempt.params, { idempotencyKey: attempt.id });
    });

    it('does not invent an annual price or shorten a nearly-ended trial', async () => {
        const f = fixture();
        await expect(f.service.createCheckout(tenantId, { billingCycle: 'annual' })).rejects.toMatchObject({ response: { error: 'stripe_price_not_configured' } });
        f.sub.trialEndsAt = new Date(Date.now() + 3600000);
        await expect(f.service.createCheckout(tenantId)).rejects.toMatchObject({ response: { error: 'stripe_trial_ending_soon' } });
        expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('requires the correct provider and rejects a second live subscription', async () => {
        const f = fixture();
        f.sub.provider = 'wompi';
        await expect(f.service.createCheckout(tenantId)).rejects.toMatchObject({ response: { error: 'stripe_subscription_required' } });
        f.sub.provider = 'stripe';
        f.sub.providerSubscriptionId = 'sub_remote';
        await expect(f.service.createCheckout(tenantId)).rejects.toMatchObject({ response: { error: 'stripe_subscription_already_exists' } });
    });

    it('binds a paid native subscription only to the stored authorized checkout and saves immutable fiscal snapshots', async () => {
        const f = fixture();
        f.bind();
        f.remote.status = 'active';
        const event = f.event({ type: BillingEventType.PAYMENT_SUCCEEDED, providerPaymentId: 'in_1', payment: {
            providerPaymentId: 'in_1', amountCents: 4900, currency: 'USD', status: 'succeeded',
        } });
        expect(await f.service.handleEvent(event)).toEqual({ processed: true });
        expect(f.sub.providerSubscriptionId).toBe('sub_remote');
        expect(f.sub.currentPeriodEnd).toEqual(new Date(1802592000000));
        expect(f.sub.engine).toBe('provider');
        expect(f.sub.nextChargeAt).toBeNull();
        expect(f.payments[0].metadata).toEqual({ railEnvironment: 'sandbox', billingCountryAtPayment: 'MX', tenantInternalAtPayment: false });
        expect(await f.service.handleEvent(event)).toEqual({ processed: false, reason: 'duplicate' });
        expect(f.payments).toHaveLength(1);
    });

    it.each(['customer', 'attempt', 'price', 'provider'])('ignores a %s mismatch without granting entitlement or emitting a payment', async (kind) => {
        const f = fixture();
        f.bind();
        if (kind === 'customer') f.remote.customer = 'cus_someone_else';
        if (kind === 'attempt') f.remote.metadata.checkoutAttemptId = 'unknown';
        if (kind === 'price') f.remote.items.data[0].price.unit_amount = 1;
        if (kind === 'provider') f.sub.provider = 'wompi';
        const result = await f.service.handleEvent(f.event());
        expect(result.processed).toBe(false);
        expect(f.prisma.tenant.update).not.toHaveBeenCalled();
        expect(f.events.emit).not.toHaveBeenCalled();
    });

    it('uses canonical subscription state so reordered payment failures cannot revive cancelled access or downgrade a successful payment', async () => {
        const f = fixture();
        f.bind();
        f.remote.status = 'active';
        await f.service.handleEvent(f.event({ type: BillingEventType.PAYMENT_SUCCEEDED, providerPaymentId: 'in_1', payment: { providerPaymentId: 'in_1', amountCents: 4900, currency: 'USD', status: 'succeeded' } }));
        f.remote.status = 'canceled';
        await f.service.handleEvent(f.event({ providerEventId: 'evt_old_failure', type: BillingEventType.PAYMENT_FAILED, providerPaymentId: 'in_1', payment: { providerPaymentId: 'in_1', amountCents: 4900, currency: 'USD', status: 'failed' } }));
        expect(f.sub.status).toBe('cancelled');
        expect(f.payments[0].status).toBe('succeeded');
    });

    it('expires pending hosted Checkout before cancellation so an old link cannot charge later', async () => {
        const f = fixture();
        await f.service.createCheckout(tenantId);
        await f.service.cancel(tenantId, { immediate: true });
        expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_1');
        expect(f.sub.metadata.stripeCheckout).toBeUndefined();
        expect(f.sub.status).toBe('cancelled');
    });

    it('does not grant a more expensive plan when the immediate upgrade payment fails', async () => {
        const f = fixture();
        f.sub.providerSubscriptionId = 'sub_remote';
        const upgrade = { ...f.plan, id: 'plan-pro', slug: 'pro', priceUsdCents: 9900 };
        f.prisma.billingPlan.findUnique.mockResolvedValue(upgrade);
        f.stripe.subscriptions.update.mockRejectedValue(new Error('authentication required'));
        await expect(f.service.changePlan(tenantId, 'pro')).rejects.toThrow('authentication required');
        expect(f.stripe.subscriptions.update).toHaveBeenCalledWith('sub_remote', expect.objectContaining({
            payment_behavior: 'error_if_incomplete', proration_behavior: 'always_invoice',
        }));
        expect(f.sub.planId).toBe('plan-1');
        expect(f.prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('can repeat immediate cancellation of an already-cancelled native subscription', async () => {
        const f = fixture();
        f.bind();
        await f.service.handleEvent(f.event());
        f.remote.status = 'canceled';
        f.sub.status = 'cancelled';
        await f.service.cancel(tenantId, { immediate: true });
        await f.service.cancel(tenantId, { immediate: true });
        expect(f.stripe.subscriptions.cancel).not.toHaveBeenCalled();
        expect(f.sub.status).toBe('cancelled');
    });

    it('can cancel an expired checkout attempt only after a definitive non-creation response', async () => {
        const f = fixture();
        f.sub.metadata.stripeCheckout = { id: 'attempt-expired', params: { expires_at: Math.floor(Date.now() / 1000) - 60 } };
        f.stripe.checkout.sessions.create.mockRejectedValueOnce({ type: 'StripeInvalidRequestError', param: 'expires_at' });
        await f.service.cancel(tenantId, { immediate: true });
        expect(f.sub.status).toBe('cancelled');
        expect(f.sub.metadata.stripeCheckout).toBeUndefined();
        expect(f.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    });

    it('keeps cancellation retryable if recovering a checkout still has an unknown network outcome', async () => {
        const f = fixture();
        const pending = { id: 'attempt-unknown', params: { expires_at: Math.floor(Date.now() / 1000) - 60 } };
        f.sub.metadata.stripeCheckout = pending;
        f.stripe.checkout.sessions.create.mockRejectedValueOnce(new Error('network timeout'));
        await expect(f.service.cancel(tenantId, { immediate: true })).rejects.toThrow('network timeout');
        expect(f.sub.status).toBe('trialing');
        expect(f.sub.metadata.stripeCheckout).toEqual(pending);
    });

    it('schedules downgrades at the native period boundary while preserving an ongoing trial', async () => {
        const f = fixture();
        f.sub.providerSubscriptionId = 'sub_remote';
        f.prisma.billingPlan.findUnique.mockResolvedValue({ ...f.plan, id: 'plan-low', slug: 'emprendedor', priceUsdCents: 1900 });
        const result = await f.service.changePlan(tenantId, 'emprendedor');
        expect(result).toMatchObject({ scheduled: true, effectiveAt: new Date(1802592000000).toISOString() });
        expect(f.stripe.subscriptionSchedules.update.mock.calls[0][1].phases[0]).toMatchObject({ trial: true, end_date: 1802592000 });
        expect(f.sub.planId).toBe('plan-1');
        expect(f.sub.pendingPlanId).toBe('plan-low');
        expect(f.sub.engine).toBe('provider');
        expect(f.prisma.tenant.update).not.toHaveBeenCalled();
    });
});
