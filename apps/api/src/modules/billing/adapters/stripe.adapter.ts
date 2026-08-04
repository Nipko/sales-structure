import { Injectable, Logger } from '@nestjs/common';
import { IPaymentProvider, WebhookSignatureContext } from './payment-provider.interface';
import { StripeConfigService } from './stripe-config.service';
import {
    PaymentProviderName,
    ProviderCustomer,
    CreateCustomerInput,
    ProviderPlan,
    CreatePlanInput,
    ProviderSubscription,
    CreateSubscriptionInput,
    CancelSubscriptionOptions,
    NormalizedBillingEvent,
    ProviderPayment,
} from '../types/provider-types';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { BillingEventType } from '../types/billing-event.enum';

@Injectable()
export class StripeAdapter implements IPaymentProvider {
    readonly name: PaymentProviderName = 'stripe';
    private readonly logger = new Logger(StripeAdapter.name);

    constructor(private readonly stripeConfig: StripeConfigService) {}

    private get stripe(): any {
        return this.stripeConfig.client;
    }

    async createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer> {
        const customer = await this.stripe.customers.create({
            email: input.email,
            name: input.name,
            metadata: { tenantId: input.tenantId, ...(input.metadata || {}) },
        });

        return {
            providerCustomerId: customer.id,
            email: customer.email || input.email,
            name: customer.name || input.name,
            createdAt: new Date(customer.created * 1000),
        };
    }

    async updatePaymentMethod(providerCustomerId: string, paymentMethodId: string): Promise<void> {
        await this.stripe.paymentMethods.attach(paymentMethodId, { customer: providerCustomerId });
        await this.stripe.customers.update(providerCustomerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
        });
    }

    async createPlan(input: CreatePlanInput): Promise<ProviderPlan> {
        const product = await this.stripe.products.create({
            name: input.name,
            metadata: { slug: input.slug, ...(input.metadata || {}) },
        });

        const price = await this.stripe.prices.create({
            product: product.id,
            unit_amount: input.amountCents,
            currency: input.currency.toLowerCase(),
            recurring: { interval: input.billingInterval },
            metadata: { slug: input.slug },
        });

        return {
            providerPlanId: price.id,
            slug: input.slug,
            name: input.name,
            amountCents: input.amountCents,
            currency: input.currency,
            billingInterval: input.billingInterval,
            trialDays: input.trialDays,
        };
    }

    async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
        const params: Record<string, any> = {
            customer: input.providerCustomerId,
            items: [{ price: input.providerPlanId }],
            metadata: { tenantId: input.tenantId, ...(input.metadata || {}) },
        };

        if (input.trialDays) {
            params.trial_period_days = input.trialDays;
            params.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } };
        }

        if (input.cardTokenId) {
            params.default_payment_method = input.cardTokenId;
        }

        const sub = await this.stripe.subscriptions.create(params);
        return this.mapSubscription(sub);
    }

    async cancelSubscription(providerSubscriptionId: string, opts?: CancelSubscriptionOptions): Promise<void> {
        if (opts?.immediate) {
            await this.stripe.subscriptions.cancel(providerSubscriptionId, {
                cancellation_details: { comment: opts.reason },
            });
        } else {
            await this.stripe.subscriptions.update(providerSubscriptionId, {
                cancel_at_period_end: true,
                metadata: { cancelReason: opts?.reason || '' },
            });
        }
    }

    async pauseSubscription(providerSubscriptionId: string): Promise<void> {
        await this.stripe.subscriptions.update(providerSubscriptionId, {
            pause_collection: { behavior: 'void' },
        });
    }

    async resumeSubscription(providerSubscriptionId: string): Promise<void> {
        await this.stripe.subscriptions.update(providerSubscriptionId, {
            pause_collection: '',
        });
    }

    async changeSubscriptionPlan(providerSubscriptionId: string, newPriceId: string): Promise<ProviderSubscription> {
        const sub = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
        const itemId = sub.items?.data?.[0]?.id;
        if (!itemId) throw new Error('Subscription has no items');

        const updated = await this.stripe.subscriptions.update(providerSubscriptionId, {
            items: [{ id: itemId, price: newPriceId }],
            proration_behavior: 'create_prorations',
        });

        return this.mapSubscription(updated);
    }

    async refundPayment(providerPaymentId: string, amountCents?: number): Promise<void> {
        const params: Record<string, any> = { payment_intent: providerPaymentId };
        if (amountCents) params.amount = amountCents;
        await this.stripe.refunds.create(params);
    }

    async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
        const sub = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
        return this.mapSubscription(sub);
    }

    async listCustomerSubscriptions(providerCustomerId: string): Promise<ProviderSubscription[]> {
        const list = await this.stripe.subscriptions.list({
            customer: providerCustomerId,
            limit: 100,
        });
        return (list.data || []).map((s: any) => this.mapSubscription(s));
    }

    verifyWebhookSignature(
        rawBody: string,
        headers: Record<string, string>,
        _context?: WebhookSignatureContext,
    ): boolean {
        const sig = headers['stripe-signature'];
        if (!sig || !this.stripeConfig.webhookSecret) return false;

        try {
            this.stripe.webhooks.constructEvent(rawBody, sig, this.stripeConfig.webhookSecret);
            return true;
        } catch (err: any) {
            this.logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
            return false;
        }
    }

    async parseWebhookEvent(rawBody: string, headers: Record<string, string>): Promise<NormalizedBillingEvent> {
        const sig = headers['stripe-signature'];
        const event = this.stripe.webhooks.constructEvent(rawBody, sig, this.stripeConfig.webhookSecret);

        const base: Partial<NormalizedBillingEvent> = {
            provider: 'stripe',
            providerEventId: event.id,
            occurredAt: new Date(event.created * 1000),
            rawPayload: event,
        };

        switch (event.type) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                const mapped = this.mapSubscription(sub);
                const tenantId = sub.metadata?.tenantId;

                return {
                    ...base,
                    type: this.mapSubEventType(event.type, sub),
                    tenantId,
                    providerSubscriptionId: sub.id,
                    providerCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
                    subscription: mapped,
                } as NormalizedBillingEvent;
            }

            case 'invoice.payment_succeeded':
            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
                const custId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

                const payment: ProviderPayment = {
                    providerPaymentId: (invoice.payment_intent as string) || invoice.id,
                    providerSubscriptionId: subId,
                    amountCents: invoice.amount_paid || invoice.amount_due,
                    currency: (invoice.currency || 'usd').toUpperCase(),
                    status: event.type === 'invoice.payment_succeeded' ? 'succeeded' : 'failed',
                    paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : undefined,
                    failureReason: event.type === 'invoice.payment_failed' ? 'Payment method declined' : undefined,
                };

                return {
                    ...base,
                    type: event.type === 'invoice.payment_succeeded'
                        ? BillingEventType.PAYMENT_SUCCEEDED
                        : BillingEventType.PAYMENT_FAILED,
                    tenantId: invoice.subscription_details?.metadata?.tenantId || undefined,
                    providerSubscriptionId: subId,
                    providerCustomerId: custId,
                    providerPaymentId: payment.providerPaymentId,
                    payment,
                } as NormalizedBillingEvent;
            }

            case 'charge.refunded': {
                const charge = event.data.object;
                const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.id;
                return {
                    ...base,
                    type: BillingEventType.PAYMENT_REFUNDED,
                    providerPaymentId: piId,
                    payment: {
                        providerPaymentId: piId,
                        amountCents: charge.amount_refunded,
                        currency: (charge.currency || 'usd').toUpperCase(),
                        status: 'refunded',
                    },
                } as NormalizedBillingEvent;
            }

            default:
                this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
                return {
                    ...base,
                    type: BillingEventType.SUBSCRIPTION_CREATED,
                } as NormalizedBillingEvent;
        }
    }

    private mapSubscription(sub: any): ProviderSubscription {
        return {
            providerSubscriptionId: sub.id,
            providerCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || '',
            providerPlanId: sub.items?.data?.[0]?.price?.id || '',
            status: this.mapStatus(sub.status),
            trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : undefined,
            currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : undefined,
            currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
            cancelAtPeriodEnd: sub.cancel_at_period_end || false,
            rawStatus: sub.status,
        };
    }

    private mapStatus(status: string): SubscriptionStatus {
        switch (status) {
            case 'trialing': return SubscriptionStatus.TRIALING;
            case 'active': return SubscriptionStatus.ACTIVE;
            case 'past_due': return SubscriptionStatus.PAST_DUE;
            case 'canceled': return SubscriptionStatus.CANCELLED;
            case 'unpaid': return SubscriptionStatus.PAST_DUE;
            case 'incomplete': return SubscriptionStatus.PENDING_AUTH;
            case 'incomplete_expired': return SubscriptionStatus.EXPIRED;
            case 'paused': return SubscriptionStatus.ACTIVE;
            default: return SubscriptionStatus.ACTIVE;
        }
    }

    private mapSubEventType(eventType: string, sub: any): BillingEventType {
        if (eventType === 'customer.subscription.created') {
            return sub.status === 'trialing'
                ? BillingEventType.TRIAL_STARTED
                : BillingEventType.SUBSCRIPTION_CREATED;
        }
        if (eventType === 'customer.subscription.deleted') {
            return BillingEventType.SUBSCRIPTION_CANCELLED;
        }
        switch (sub.status) {
            case 'active': return BillingEventType.SUBSCRIPTION_ACTIVATED;
            case 'past_due': return BillingEventType.SUBSCRIPTION_PAST_DUE;
            case 'canceled': return BillingEventType.SUBSCRIPTION_CANCELLED;
            default: return BillingEventType.SUBSCRIPTION_PLAN_CHANGED;
        }
    }
}
