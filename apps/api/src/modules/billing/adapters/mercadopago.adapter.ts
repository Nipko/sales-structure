import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { IPaymentProvider } from './payment-provider.interface';
import { MercadoPagoConfigService } from './mercadopago-config.service';
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
 * MercadoPago IPaymentProvider adapter.
 *
 * Uses the Preapproval (Subscriptions) API with Plan + Subscription flow:
 * POST /preapproval_plan to register the 4 tier plans once per country,
 * POST /preapproval to bind individual tenants to a plan (with optional
 * free_trial on auto_recurring). The adapter owns the translation from MP's
 * authorized|paused|cancelled status vocabulary to our SubscriptionStatus enum.
 *
 * Known MP quirks the implementation will need to handle (Sprint 2):
 *  - Webhooks are unreliable in production for subscription_preapproval topic.
 *    Use a reconciliation cron hitting GET /preapproval/search to detect drift.
 *  - x-signature verification differs between sandbox and production — log raw
 *    headers on first prod deploy to debug.
 *  - Sandbox does not auto-deliver webhooks; use the in-dashboard simulator.
 *  - Plan change requires cancel + recreate (no native proration).
 *  - No native customer object — createCustomer returns a synthetic id.
 *
 * Scope of this file during Sprint 1.2: class skeleton only. Method bodies,
 * HTTP client wiring, and HMAC signature verification land in Sprint 2.
 */
@Injectable()
export class MercadoPagoAdapter implements IPaymentProvider {
    readonly name: PaymentProviderName = 'mercadopago';
    private readonly logger = new Logger(MercadoPagoAdapter.name);

    constructor(private readonly mpConfig: MercadoPagoConfigService) {}

    async createCustomer(_input: CreateCustomerInput): Promise<ProviderCustomer> {
        throw new NotImplementedException('MercadoPagoAdapter.createCustomer — Sprint 2');
    }

    async updatePaymentMethod(_providerCustomerId: string, _cardTokenId: string): Promise<void> {
        throw new NotImplementedException('MercadoPagoAdapter.updatePaymentMethod — Sprint 2');
    }

    async createPlan(_input: CreatePlanInput): Promise<ProviderPlan> {
        throw new NotImplementedException('MercadoPagoAdapter.createPlan — Sprint 2');
    }

    async createSubscription(_input: CreateSubscriptionInput): Promise<ProviderSubscription> {
        throw new NotImplementedException('MercadoPagoAdapter.createSubscription — Sprint 2');
    }

    async cancelSubscription(_providerSubscriptionId: string, _opts?: CancelSubscriptionOptions): Promise<void> {
        throw new NotImplementedException('MercadoPagoAdapter.cancelSubscription — Sprint 2');
    }

    async pauseSubscription(_providerSubscriptionId: string): Promise<void> {
        throw new NotImplementedException('MercadoPagoAdapter.pauseSubscription — Sprint 2');
    }

    async resumeSubscription(_providerSubscriptionId: string): Promise<void> {
        throw new NotImplementedException('MercadoPagoAdapter.resumeSubscription — Sprint 2');
    }

    async changeSubscriptionPlan(_providerSubscriptionId: string, _newProviderPlanId: string): Promise<ProviderSubscription> {
        throw new NotImplementedException('MercadoPagoAdapter.changeSubscriptionPlan — Sprint 2');
    }

    async getSubscription(_providerSubscriptionId: string): Promise<ProviderSubscription> {
        throw new NotImplementedException('MercadoPagoAdapter.getSubscription — Sprint 2');
    }

    async listCustomerSubscriptions(_providerCustomerId: string): Promise<ProviderSubscription[]> {
        throw new NotImplementedException('MercadoPagoAdapter.listCustomerSubscriptions — Sprint 2');
    }

    verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): boolean {
        throw new NotImplementedException('MercadoPagoAdapter.verifyWebhookSignature — Sprint 2');
    }

    parseWebhookEvent(_rawBody: string, _headers: Record<string, string>): NormalizedBillingEvent {
        throw new NotImplementedException('MercadoPagoAdapter.parseWebhookEvent — Sprint 2');
    }
}
