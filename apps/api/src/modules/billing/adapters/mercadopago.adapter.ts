import { BadRequestException, Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { IPaymentProvider } from './payment-provider.interface';
import { MercadoPagoConfigService } from './mercadopago-config.service';
import { SubscriptionStatus } from '../types/subscription-status.enum';
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
 * Known MP quirks the implementation handles:
 *  - No native customer object → createCustomer returns a synthetic id; the
 *    payer is identified later on the preapproval via payer_email.
 *  - Plan change requires cancel + recreate (no native proration).
 *  - Webhooks are unreliable in production for subscription_preapproval topic;
 *    reconciliation cron (Sprint 2.9) hits GET /preapproval/search to detect drift.
 *  - Sandbox does not auto-deliver webhooks; use the in-dashboard simulator.
 */
@Injectable()
export class MercadoPagoAdapter implements IPaymentProvider {
    readonly name: PaymentProviderName = 'mercadopago';
    private readonly logger = new Logger(MercadoPagoAdapter.name);

    constructor(private readonly mpConfig: MercadoPagoConfigService) {}

    // -------------------------------------------------------------------------
    // Customer — synthetic, MP has no customer object for subscriptions
    // -------------------------------------------------------------------------

    async createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer> {
        // MP identifies the payer by payer_email on each preapproval record —
        // there is no "customer" resource to create. Returning a synthetic ID
        // (the tenant's UUID prefixed) so the rest of the platform can treat
        // providers uniformly.
        return {
            providerCustomerId: `mp_${input.tenantId}`,
            email: input.email,
            name: input.name,
            country: input.country,
            createdAt: new Date(),
        };
    }

    async updatePaymentMethod(_providerCustomerId: string, _cardTokenId: string): Promise<void> {
        // Tokens are attached per preapproval (createSubscription), not per customer.
        // To actually rotate a payment method we update the preapproval via
        // changeSubscriptionPlan-style PUT with a new card_token_id.
        // Deferred to Sprint 3 when the dashboard "update card" flow lands.
        throw new NotImplementedException('updatePaymentMethod — implemented in Sprint 3 together with the dashboard update-card form');
    }

    // -------------------------------------------------------------------------
    // Plan catalog
    // -------------------------------------------------------------------------

    async createPlan(input: CreatePlanInput): Promise<ProviderPlan> {
        const frequencyType = input.billingInterval === 'year' ? 'months' : 'months';
        const frequency = input.billingInterval === 'year' ? 12 : 1;

        const body = {
            reason: input.name,
            auto_recurring: {
                frequency,
                frequency_type: frequencyType,
                // MP wants a decimal value, not cents
                transaction_amount: input.amountCents / 100,
                currency_id: input.currency,
                ...(input.trialDays && input.trialDays > 0
                    ? { free_trial: { frequency: input.trialDays, frequency_type: 'days' } }
                    : {}),
            },
            // Hardcoded to cards + account money — the two payment types MP
            // supports for subscriptions. Customising this is rarely useful.
            payment_methods_allowed: {
                payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }],
            },
            back_url: process.env.DASHBOARD_URL
                ? `${process.env.DASHBOARD_URL}/admin/settings/billing?status=return`
                : 'https://admin.parallly-chat.cloud/admin/settings/billing?status=return',
        };

        const res = await this.mpConfig.preApprovalPlan.create({ body });
        if (!res.id) {
            throw new BadRequestException({
                error: 'mp_plan_create_failed',
                message: 'MercadoPago returned no plan id',
                response: res,
            });
        }

        this.logger.log(`Created MP plan ${res.id} for slug=${input.slug} (${input.currency} ${input.amountCents / 100})`);
        return {
            providerPlanId: res.id,
            slug: input.slug,
            name: input.name,
            amountCents: input.amountCents,
            currency: input.currency,
            billingInterval: input.billingInterval,
            trialDays: input.trialDays,
        };
    }

    // -------------------------------------------------------------------------
    // Subscription lifecycle (Sprint 2.4)
    // -------------------------------------------------------------------------

    async createSubscription(_input: CreateSubscriptionInput): Promise<ProviderSubscription> {
        throw new NotImplementedException('MercadoPagoAdapter.createSubscription — Sprint 2.4');
    }

    async cancelSubscription(_providerSubscriptionId: string, _opts?: CancelSubscriptionOptions): Promise<void> {
        throw new NotImplementedException('MercadoPagoAdapter.cancelSubscription — Sprint 2.4');
    }

    async pauseSubscription(_providerSubscriptionId: string): Promise<void> {
        throw new NotImplementedException('MercadoPagoAdapter.pauseSubscription — Sprint 2.4');
    }

    async resumeSubscription(_providerSubscriptionId: string): Promise<void> {
        throw new NotImplementedException('MercadoPagoAdapter.resumeSubscription — Sprint 2.4');
    }

    async changeSubscriptionPlan(_providerSubscriptionId: string, _newProviderPlanId: string): Promise<ProviderSubscription> {
        throw new NotImplementedException('MercadoPagoAdapter.changeSubscriptionPlan — Sprint 2.4');
    }

    async getSubscription(_providerSubscriptionId: string): Promise<ProviderSubscription> {
        throw new NotImplementedException('MercadoPagoAdapter.getSubscription — Sprint 2.4');
    }

    async listCustomerSubscriptions(_providerCustomerId: string): Promise<ProviderSubscription[]> {
        throw new NotImplementedException('MercadoPagoAdapter.listCustomerSubscriptions — Sprint 2.4');
    }

    // -------------------------------------------------------------------------
    // Webhooks (Sprint 2.5 / 2.6)
    // -------------------------------------------------------------------------

    verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): boolean {
        throw new NotImplementedException('MercadoPagoAdapter.verifyWebhookSignature — Sprint 2.5');
    }

    parseWebhookEvent(_rawBody: string, _headers: Record<string, string>): NormalizedBillingEvent {
        throw new NotImplementedException('MercadoPagoAdapter.parseWebhookEvent — Sprint 2.6');
    }

    // -------------------------------------------------------------------------
    // Internals — status translation table (used by 2.4 + 2.6)
    // -------------------------------------------------------------------------

    /**
     * Translate MP's preapproval status string to our internal enum.
     *
     * MP values (from API docs + community threads):
     *  - `pending` → customer has not yet confirmed the subscription in the MP checkout. We treat as PENDING_AUTH.
     *  - `authorized` → active and authorised. Maps to ACTIVE (or TRIALING if still in free_trial window — caller decides using trial_ends_at).
     *  - `paused` → MP paused the subscription (e.g., payment failed with retry). Maps to PAST_DUE.
     *  - `cancelled` → terminal. Maps to CANCELLED.
     *  - `finished` → the repetitions count was reached. Maps to EXPIRED.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected translateStatus(mpStatus: string | undefined, hasActiveTrial: boolean = false): SubscriptionStatus {
        switch (mpStatus) {
            case 'pending':
                return SubscriptionStatus.PENDING_AUTH;
            case 'authorized':
                return hasActiveTrial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;
            case 'paused':
                return SubscriptionStatus.PAST_DUE;
            case 'cancelled':
                return SubscriptionStatus.CANCELLED;
            case 'finished':
                return SubscriptionStatus.EXPIRED;
            default:
                this.logger.warn(`Unknown MP status "${mpStatus}" — defaulting to PENDING_AUTH`);
                return SubscriptionStatus.PENDING_AUTH;
        }
    }
}
