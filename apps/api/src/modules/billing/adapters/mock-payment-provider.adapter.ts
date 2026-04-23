import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IPaymentProvider } from './payment-provider.interface';
import { BillingEventType } from '../types/billing-event.enum';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import {
    CancelSubscriptionOptions,
    CreateCustomerInput,
    CreatePlanInput,
    CreateSubscriptionInput,
    NormalizedBillingEvent,
    PaymentProviderName,
    ProviderCustomer,
    ProviderPayment,
    ProviderPlan,
    ProviderSubscription,
} from '../types/provider-types';

/**
 * Deterministic in-memory payment provider for unit tests and local dev.
 *
 * Every mutable method updates an internal Map so BillingService exercises the
 * same code paths it would with a real provider, minus the network. Tests can
 * also call simulateWebhookEvent() to produce a NormalizedBillingEvent with
 * any type + any subscription reference, which is what BillingWebhookController
 * would receive in production after the adapter parsed a real webhook.
 *
 * Not for production use — verifyWebhookSignature always returns true.
 */
@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
    readonly name: PaymentProviderName = 'mock';
    private readonly logger = new Logger(MockPaymentProvider.name);

    private readonly customers = new Map<string, ProviderCustomer>();
    private readonly subscriptions = new Map<string, ProviderSubscription>();
    private readonly plans = new Map<string, ProviderPlan>();

    // -------------------------------------------------------------------------
    // Customer
    // -------------------------------------------------------------------------

    async createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer> {
        const customer: ProviderCustomer = {
            providerCustomerId: `mock_cust_${randomUUID()}`,
            email: input.email,
            name: input.name,
            country: input.country,
            createdAt: new Date(),
        };
        this.customers.set(customer.providerCustomerId, customer);
        return customer;
    }

    async updatePaymentMethod(providerCustomerId: string, _cardTokenId: string): Promise<void> {
        if (!this.customers.has(providerCustomerId)) {
            throw new NotFoundException({ error: 'customer_not_found', providerCustomerId });
        }
        // Mock has no card vault — just record the call via logger for test assertions.
        this.logger.debug(`[Mock] updatePaymentMethod called for ${providerCustomerId}`);
    }

    // -------------------------------------------------------------------------
    // Plan
    // -------------------------------------------------------------------------

    async createPlan(input: CreatePlanInput): Promise<ProviderPlan> {
        const plan: ProviderPlan = {
            providerPlanId: `mock_plan_${input.slug}`,
            slug: input.slug,
            name: input.name,
            amountCents: input.amountCents,
            currency: input.currency,
            billingInterval: input.billingInterval,
            trialDays: input.trialDays,
        };
        this.plans.set(plan.providerPlanId, plan);
        return plan;
    }

    // -------------------------------------------------------------------------
    // Subscription
    // -------------------------------------------------------------------------

    async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
        if (!this.customers.has(input.providerCustomerId)) {
            throw new NotFoundException({ error: 'customer_not_found', providerCustomerId: input.providerCustomerId });
        }

        const now = new Date();
        const hasTrial = (input.trialDays ?? 0) > 0;
        const trialEndsAt = hasTrial ? new Date(now.getTime() + (input.trialDays! * 86_400_000)) : undefined;
        // When a trial is active, the "current period" is the trial window;
        // after the trial, the provider fires payment events that we process
        // via handleBillingEvent and transition to active.
        const currentPeriodStart = hasTrial ? undefined : now;
        const currentPeriodEnd = hasTrial ? trialEndsAt : new Date(now.getTime() + 30 * 86_400_000);

        const subscription: ProviderSubscription = {
            providerSubscriptionId: `mock_sub_${randomUUID()}`,
            providerCustomerId: input.providerCustomerId,
            providerPlanId: input.providerPlanId,
            status: hasTrial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
            trialEndsAt,
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
            rawStatus: hasTrial ? 'mock_trialing' : 'mock_active',
        };
        this.subscriptions.set(subscription.providerSubscriptionId, subscription);
        return subscription;
    }

    async cancelSubscription(providerSubscriptionId: string, opts?: CancelSubscriptionOptions): Promise<void> {
        const sub = this.requireSubscription(providerSubscriptionId);
        if (opts?.immediate) {
            this.subscriptions.set(providerSubscriptionId, {
                ...sub,
                status: SubscriptionStatus.CANCELLED,
                cancelAtPeriodEnd: false,
            });
        } else {
            this.subscriptions.set(providerSubscriptionId, { ...sub, cancelAtPeriodEnd: true });
        }
    }

    async pauseSubscription(providerSubscriptionId: string): Promise<void> {
        const sub = this.requireSubscription(providerSubscriptionId);
        // Mock represents paused as TRIALING-without-trial for simplicity; the
        // interface says pause is optional and can throw, but we support it so
        // the test surface is complete.
        this.subscriptions.set(providerSubscriptionId, { ...sub, rawStatus: 'mock_paused' });
    }

    async resumeSubscription(providerSubscriptionId: string): Promise<void> {
        const sub = this.requireSubscription(providerSubscriptionId);
        this.subscriptions.set(providerSubscriptionId, { ...sub, rawStatus: 'mock_active', status: SubscriptionStatus.ACTIVE });
    }

    async changeSubscriptionPlan(providerSubscriptionId: string, newProviderPlanId: string): Promise<ProviderSubscription> {
        const sub = this.requireSubscription(providerSubscriptionId);
        const updated: ProviderSubscription = { ...sub, providerPlanId: newProviderPlanId };
        this.subscriptions.set(providerSubscriptionId, updated);
        return updated;
    }

    async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
        return this.requireSubscription(providerSubscriptionId);
    }

    async listCustomerSubscriptions(providerCustomerId: string): Promise<ProviderSubscription[]> {
        return [...this.subscriptions.values()].filter(s => s.providerCustomerId === providerCustomerId);
    }

    // -------------------------------------------------------------------------
    // Webhooks
    // -------------------------------------------------------------------------

    verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): boolean {
        return true; // Always trust — safe only in tests.
    }

    async parseWebhookEvent(rawBody: string, _headers: Record<string, string>): Promise<NormalizedBillingEvent> {
        // Mock webhook bodies are JSON with the NormalizedBillingEvent shape
        // already, plus providerEventId. Tests typically call
        // simulateWebhookEvent() instead, which bypasses parsing.
        const body = JSON.parse(rawBody);
        return {
            type: body.type,
            provider: 'mock',
            providerEventId: body.providerEventId ?? randomUUID(),
            occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
            tenantId: body.tenantId,
            providerSubscriptionId: body.providerSubscriptionId,
            providerCustomerId: body.providerCustomerId,
            providerPaymentId: body.providerPaymentId,
            subscription: body.subscription,
            payment: body.payment,
            rawPayload: body,
        };
    }

    // -------------------------------------------------------------------------
    // Test helpers — NOT part of IPaymentProvider, only used by tests
    // -------------------------------------------------------------------------

    /**
     * Produce a NormalizedBillingEvent as if the mock provider had emitted it.
     * Use from tests: `billingService.handleBillingEvent(mock.simulateWebhookEvent(...))`.
     */
    simulateWebhookEvent(type: BillingEventType, overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent {
        return {
            type,
            provider: 'mock',
            providerEventId: overrides.providerEventId ?? `mock_evt_${randomUUID()}`,
            occurredAt: overrides.occurredAt ?? new Date(),
            tenantId: overrides.tenantId,
            providerSubscriptionId: overrides.providerSubscriptionId,
            providerCustomerId: overrides.providerCustomerId,
            providerPaymentId: overrides.providerPaymentId,
            subscription: overrides.subscription,
            payment: overrides.payment,
            rawPayload: overrides.rawPayload ?? { simulated: true, type },
        };
    }

    /**
     * Build a ProviderPayment suitable for attaching to PAYMENT_SUCCEEDED or
     * PAYMENT_FAILED simulated events, with sensible defaults.
     */
    buildPayment(overrides: Partial<ProviderPayment> = {}): ProviderPayment {
        return {
            providerPaymentId: overrides.providerPaymentId ?? `mock_pay_${randomUUID()}`,
            providerSubscriptionId: overrides.providerSubscriptionId,
            amountCents: overrides.amountCents ?? 4900,
            currency: overrides.currency ?? 'USD',
            status: overrides.status ?? 'succeeded',
            paidAt: overrides.paidAt ?? new Date(),
            failureReason: overrides.failureReason,
        };
    }

    /** Clear all internal state — use in test beforeEach. */
    reset(): void {
        this.customers.clear();
        this.subscriptions.clear();
        this.plans.clear();
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private requireSubscription(id: string): ProviderSubscription {
        const sub = this.subscriptions.get(id);
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found', providerSubscriptionId: id });
        return sub;
    }
}
