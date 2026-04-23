import { Injectable, NotImplementedException } from '@nestjs/common';
import { IPaymentProvider } from './payment-provider.interface';
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
 * Deterministic in-memory payment provider used for unit tests and local dev
 * when no real provider credentials are available. BillingService consumes it
 * through the IPaymentProvider interface, so every code path BillingService
 * exercises is covered without touching MercadoPago's API.
 *
 * Scope of this file during Sprint 1.2: class skeleton only. The methods return
 * NotImplementedException so any caller breaks loudly. Sprint 1.5 fills in
 * deterministic happy-path and failure-simulation behavior plus a
 * simulateWebhookEvent() helper for end-to-end tests.
 */
@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
    readonly name: PaymentProviderName = 'mock';

    async createCustomer(_input: CreateCustomerInput): Promise<ProviderCustomer> {
        throw new NotImplementedException('MockPaymentProvider.createCustomer — Sprint 1.5');
    }

    async updatePaymentMethod(_providerCustomerId: string, _cardTokenId: string): Promise<void> {
        throw new NotImplementedException('MockPaymentProvider.updatePaymentMethod — Sprint 1.5');
    }

    async createPlan(_input: CreatePlanInput): Promise<ProviderPlan> {
        throw new NotImplementedException('MockPaymentProvider.createPlan — Sprint 1.5');
    }

    async createSubscription(_input: CreateSubscriptionInput): Promise<ProviderSubscription> {
        throw new NotImplementedException('MockPaymentProvider.createSubscription — Sprint 1.5');
    }

    async cancelSubscription(_providerSubscriptionId: string, _opts?: CancelSubscriptionOptions): Promise<void> {
        throw new NotImplementedException('MockPaymentProvider.cancelSubscription — Sprint 1.5');
    }

    async pauseSubscription(_providerSubscriptionId: string): Promise<void> {
        throw new NotImplementedException('MockPaymentProvider.pauseSubscription — Sprint 1.5');
    }

    async resumeSubscription(_providerSubscriptionId: string): Promise<void> {
        throw new NotImplementedException('MockPaymentProvider.resumeSubscription — Sprint 1.5');
    }

    async changeSubscriptionPlan(_providerSubscriptionId: string, _newProviderPlanId: string): Promise<ProviderSubscription> {
        throw new NotImplementedException('MockPaymentProvider.changeSubscriptionPlan — Sprint 1.5');
    }

    async getSubscription(_providerSubscriptionId: string): Promise<ProviderSubscription> {
        throw new NotImplementedException('MockPaymentProvider.getSubscription — Sprint 1.5');
    }

    async listCustomerSubscriptions(_providerCustomerId: string): Promise<ProviderSubscription[]> {
        throw new NotImplementedException('MockPaymentProvider.listCustomerSubscriptions — Sprint 1.5');
    }

    verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): boolean {
        return true; // Mock always trusts — safe only in tests and dev.
    }

    parseWebhookEvent(_rawBody: string, _headers: Record<string, string>): NormalizedBillingEvent {
        throw new NotImplementedException('MockPaymentProvider.parseWebhookEvent — Sprint 1.5');
    }
}
