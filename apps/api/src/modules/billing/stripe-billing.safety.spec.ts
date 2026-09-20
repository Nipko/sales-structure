import { StripeBillingService } from './stripe-billing.service';
import { StripeAdapter } from './adapters/stripe.adapter';
import { BillingEventType } from './types/billing-event.enum';

/** Independent regression cases at the signed event / entitlement boundary. */
describe('Stripe subscription safety regressions', () => {
    const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const subscriptionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const webhookSecret = 'whsec_local_safety_fixture';

    function fixture() {
        // Same CommonJS SDK entry as StripeConfigService; no remote calls.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Stripe = require('stripe');
        const sdk = new Stripe('sk_test_local_fixture_only');
        const plan = { id: 'plan-starter', slug: 'starter', name: 'Starter', isActive: true, priceUsdCents: 6900 };
        const tenant = { id: tenantId, billingCountry: 'CO', isInternal: true, settings: {} };
        let sub: any = {
            id: subscriptionId, tenantId, provider: 'stripe', engine: 'provider', status: 'active',
            providerSubscriptionId: 'sub_bound', providerCustomerId: 'cus_bound', planId: plan.id,
            trialStartedAt: new Date('2026-01-01'), trialEndsAt: new Date('2026-01-08'),
            metadata: { billingCountry: 'MX', billingCycle: 'monthly', stripeContract: {
                planId: plan.id, priceId: 'price_bound', cycle: 'monthly', country: 'MX', amountCents: 6900, currency: 'USD',
            } }, tenant, plan,
        };
        const remote: any = {
            id: 'sub_bound', customer: 'cus_bound', status: 'active', livemode: true,
            metadata: { tenantId, localSubscriptionId: subscriptionId },
            items: { data: [{ id: 'si_bound', quantity: 1, current_period_start: 1800000000, current_period_end: 1802592000,
                price: { id: 'price_bound', currency: 'usd', unit_amount: 6900, recurring: { interval: 'month', interval_count: 1 } },
            }] },
        };
        const payments: any[] = [];
        const ledger: any[] = [];
        let onTransaction: (() => void) | undefined;
        const prisma: any = {
            billingSubscription: {
                findUnique: jest.fn(async () => sub),
                update: jest.fn(async ({ data }) => (sub = { ...sub, ...data })),
            },
            tenant: { findUnique: jest.fn(async () => tenant), update: jest.fn() },
            billingPlan: { findUnique: jest.fn(async () => plan) },
            billingEvent: {
                findUnique: jest.fn(async ({ where }) => ledger.find(row => row.providerEventId === where.provider_providerEventId.providerEventId)),
                create: jest.fn(async ({ data }) => { ledger.push(data); return data; }),
                upsert: jest.fn(async ({ create }) => { ledger.push(create); return create; }),
            },
            billingPayment: {
                findFirst: jest.fn(async ({ where }) => payments.find(row => row.providerPaymentId === where.providerPaymentId)),
                create: jest.fn(async ({ data }) => { const row = { id: `payment-${payments.length}`, ...data }; payments.push(row); return row; }),
                update: jest.fn(async ({ where, data }) => Object.assign(payments.find(row => row.id === where.id), data)),
            },
            $queryRawUnsafe: jest.fn(async () => [{ id: subscriptionId, purge_started_at: null }]),
            $transaction: jest.fn(async (fn) => { onTransaction?.(); return fn(prisma); }),
        };
        const stripe: any = { webhooks: sdk.webhooks, subscriptions: { retrieve: jest.fn(async () => remote) } };
        const config: any = { client: stripe, webhookSecret, isConfigured: true };
        const adapter = new StripeAdapter(config);
        const events: any = { emit: jest.fn() };
        const redis: any = { acquireLockToken: jest.fn(async () => 'lease'), releaseLockToken: jest.fn(async () => undefined), del: jest.fn(async () => undefined), get: jest.fn(async () => null) };
        const service = new StripeBillingService(prisma, redis, config, adapter, events, {} as any);
        const event = (id: string, overrides: any = {}) => ({
            provider: 'stripe' as const, providerEventId: id, providerSubscriptionId: 'sub_bound',
            type: BillingEventType.SUBSCRIPTION_PLAN_CHANGED, occurredAt: new Date(), rawPayload: { livemode: true }, ...overrides,
        });
        return { service, adapter, sdk, remote, prisma, events, payments, ledger, event,
            get sub() { return sub; },
            replaceDuringTransaction() {
                onTransaction = () => { sub = { ...sub, provider: 'wompi', engine: 'internal', status: 'active', cancellationReason: 'comp:operator' }; };
            },
        };
    }

    it('authenticates the raw invoice payload with the real Stripe SDK before recording payment', async () => {
        const f = fixture();
        const raw = JSON.stringify({ id: 'evt_signed', type: 'invoice.paid', created: Math.floor(Date.now() / 1000), livemode: false,
            data: { object: { object: 'invoice', id: 'in_signed', customer: 'cus_bound', amount_paid: 6900, currency: 'usd', billing_reason: 'subscription_cycle',
                parent: { subscription_details: { subscription: 'sub_bound', metadata: { tenantId } } },
                lines: { data: [
                    { parent: { subscription_item_details: { subscription: 'sub_bound', proration: true } }, period: { start: 1790000000, end: 1792592000 } },
                    { parent: { subscription_item_details: { subscription: 'sub_bound', proration: false } }, period: { start: 1800000000, end: 1802592000 } },
                ] },
            } },
        });
        const signature = f.sdk.webhooks.generateTestHeaderString({ payload: raw, secret: webhookSecret });
        const headers = { 'stripe-signature': signature };
        expect(f.adapter.verifyWebhookSignature(raw, headers)).toBe(true);
        await f.service.handleEvent(await f.adapter.parseWebhookEvent(raw, headers));
        expect(f.payments).toHaveLength(1);
        expect(f.payments[0]).toMatchObject({ amountCents: 6900, metadata: {
            railEnvironment: 'sandbox', billingCountryAtPayment: 'MX', tenantInternalAtPayment: true,
            invoiceSubscriptionId: 'sub_bound', invoiceBillingReason: 'subscription_cycle',
            invoicePeriodStart: new Date(1800000000000).toISOString(),
            invoicePeriodEnd: new Date(1802592000000).toISOString(),
        } });
        expect(f.sub).toMatchObject({ chargeAmountCents: 6900, chargeCurrency: 'USD', engine: 'provider', nextChargeAt: null });

        const altered = raw.replace('6900', '1');
        expect(f.adapter.verifyWebhookSignature(altered, headers)).toBe(false);
        await expect(f.adapter.parseWebhookEvent(altered, headers)).rejects.toThrow();
        expect(f.payments).toHaveLength(1);
    });

    it('cannot restore paid entitlement while collection is paused at Stripe', async () => {
        const f = fixture();
        f.remote.pause_collection = { behavior: 'void' };
        await f.service.handleEvent(f.event('evt_pause'));
        expect(f.sub.status).not.toBe('active');
        expect(f.prisma.tenant.update).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ subscriptionStatus: 'active' }),
        }));
    });

    it('rechecks the subscription after the database lock before overwriting a concurrent replacement', async () => {
        const f = fixture();
        f.replaceDuringTransaction();
        await f.service.handleEvent(f.event('evt_race')).catch(() => undefined);
        expect(f.sub).toMatchObject({ provider: 'wompi', engine: 'internal', cancellationReason: 'comp:operator' });
        expect(f.prisma.billingSubscription.update).not.toHaveBeenCalled();
        expect(f.prisma.tenant.update).not.toHaveBeenCalled();
        expect(f.events.emit).not.toHaveBeenCalled();
    });

    it('keeps cumulative refunds monotonic when signed events arrive out of order', async () => {
        const f = fixture();
        f.payments.push({ id: 'paid-1', provider: 'stripe', providerPaymentId: 'in_paid', subscriptionId, tenantId,
            amountCents: 6900, currency: 'USD', status: 'succeeded', metadata: { refundedAmountCents: 2000 },
        });
        await f.service.handleEvent(f.event('evt_old_partial_refund', {
            type: BillingEventType.PAYMENT_REFUNDED, providerPaymentId: 'in_paid',
            payment: { providerPaymentId: 'in_paid', amountCents: 1000, currency: 'USD', status: 'refunded' },
        }));
        expect(f.payments[0].metadata.refundedAmountCents).toBe(2000);
        expect(f.payments[0].amountCents).toBe(6900);
        expect(f.payments[0].status).toBe('succeeded');
    });

    it('leaves a refund retryable when its original invoice payment has not arrived', async () => {
        const f = fixture();
        const pending = f.event('evt_early_refund', {
            type: BillingEventType.PAYMENT_REFUNDED, providerPaymentId: 'in_pending',
            payment: { providerPaymentId: 'in_pending', amountCents: 6900, currency: 'USD', status: 'refunded' },
        });
        await expect(f.service.handleEvent(pending)).rejects.toThrow();
        expect(f.ledger).toHaveLength(0);
        expect(f.payments).toHaveLength(0);
        expect(f.events.emit).not.toHaveBeenCalled();
    });
});
