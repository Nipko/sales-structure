import { BadRequestException, Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
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
    // Subscription lifecycle
    // -------------------------------------------------------------------------

    async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
        // MP needs a card_token_id to create an `authorized` subscription that
        // auto-charges. Callers (BillingService) enforce this via the plan's
        // requiresCardForTrial flag. Starter trials without a card are handled
        // upstream by NOT calling createSubscription until the user adds a
        // card (Sprint 3 flow).
        if (!input.cardTokenId) {
            throw new BadRequestException({
                error: 'mp_card_token_required',
                message: 'MercadoPago requires a card_token_id to create an authorised subscription. Collect the token via the frontend SDK before calling createSubscription.',
            });
        }

        // payer_email is required by MP. Fall back to the tenant's billing
        // email stored against the synthetic customer (metadata passed by
        // BillingService); if nothing is available, MP will reject the call
        // with a 400.
        const payerEmail = (input.metadata?.email as string) || input.metadata?.billingEmail;
        if (!payerEmail) {
            throw new BadRequestException({
                error: 'mp_payer_email_required',
                message: 'MercadoPago requires payer_email. Pass it via CreateSubscriptionInput.metadata.email.',
            });
        }

        const body = {
            preapproval_plan_id: input.providerPlanId,
            card_token_id: input.cardTokenId,
            payer_email: payerEmail,
            external_reference: input.externalReference ?? input.tenantId,
            status: 'authorized',
        };

        const res = await this.mpConfig.preApproval.create({ body });
        if (!res.id) {
            throw new BadRequestException({ error: 'mp_subscription_create_failed', response: res });
        }

        this.logger.log(`Created MP subscription ${res.id} for tenant=${input.tenantId} (plan=${input.providerPlanId})`);
        return this.toProviderSubscription(res, input.providerCustomerId, input.providerPlanId);
    }

    async cancelSubscription(providerSubscriptionId: string, _opts?: CancelSubscriptionOptions): Promise<void> {
        // MP only has a hard cancel — there is no cancel_at_period_end flag.
        // BillingService still honours the soft-cancel intent by setting its
        // own cancelAtPeriodEnd=true and delaying the provider call until the
        // period ends (implemented in Sprint 3). If we're called here we send
        // the hard cancel regardless of opts.
        await this.mpConfig.preApproval.update({
            id: providerSubscriptionId,
            body: { status: 'cancelled' },
        });
        this.logger.log(`Cancelled MP subscription ${providerSubscriptionId}`);
    }

    async pauseSubscription(providerSubscriptionId: string): Promise<void> {
        await this.mpConfig.preApproval.update({
            id: providerSubscriptionId,
            body: { status: 'paused' },
        });
    }

    async resumeSubscription(providerSubscriptionId: string): Promise<void> {
        await this.mpConfig.preApproval.update({
            id: providerSubscriptionId,
            body: { status: 'authorized' },
        });
    }

    async changeSubscriptionPlan(providerSubscriptionId: string, newProviderPlanId: string): Promise<ProviderSubscription> {
        // MP has no native plan change with proration. Try the simple PUT
        // updating `preapproval_plan_id` — works on some accounts. If MP
        // rejects it, the caller (BillingService) falls back to cancel+recreate.
        const res = await this.mpConfig.preApproval.update({
            id: providerSubscriptionId,
            body: { preapproval_plan_id: newProviderPlanId } as any,
        });
        if (!res.id) {
            throw new BadRequestException({ error: 'mp_plan_change_failed', response: res });
        }
        return this.toProviderSubscription(res, undefined, newProviderPlanId);
    }

    async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
        const res = await this.mpConfig.preApproval.get({ id: providerSubscriptionId });
        return this.toProviderSubscription(res);
    }

    async listCustomerSubscriptions(providerCustomerId: string): Promise<ProviderSubscription[]> {
        // Our synthetic id is `mp_<tenantId>` — strip the prefix to get the
        // tenant UUID we stored as external_reference on each preapproval.
        const externalReference = providerCustomerId.startsWith('mp_')
            ? providerCustomerId.slice(3)
            : providerCustomerId;

        const res = await this.mpConfig.preApproval.search({
            options: { external_reference: externalReference },
        });
        const items = (res as any)?.results ?? [];
        return items.map((r: any) => this.toProviderSubscription(r));
    }

    // -------------------------------------------------------------------------
    // Webhooks (Sprint 2.5 / 2.6)
    // -------------------------------------------------------------------------

    /**
     * Verify the HMAC-SHA256 signature MP attaches to webhook deliveries.
     *
     * MP sends two headers:
     *   x-signature: "ts=1704382800,v1=abcdef..."
     *   x-request-id: the unique request id to reconstruct the signed string
     *
     * The signed message is:
     *   id:<notification.data.id>;request-id:<x-request-id>;ts:<ts>;
     *
     * Compared against HMAC-SHA256(MP_WEBHOOK_SECRET, message).
     * Returns false on any parsing or mismatch so the controller can 401.
     * Never throws — lets the caller decide how to react.
     *
     * Reference: developer portal webhook notifications simulator (Jan 2024)
     */
    verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
        const secret = this.mpConfig.webhookSecret;
        if (!secret) {
            this.logger.warn('verifyWebhookSignature called with MP_WEBHOOK_SECRET unset — failing closed');
            return false;
        }

        // Headers arrive lowercased from Express but accept both just in case
        const sigHeader = headers['x-signature'] ?? headers['X-Signature'] ?? headers['X-SIGNATURE'];
        const requestId = headers['x-request-id'] ?? headers['X-Request-Id'];
        if (!sigHeader || !requestId) {
            this.logger.warn('verifyWebhookSignature missing x-signature or x-request-id header');
            return false;
        }

        // Parse "ts=...,v1=..." — order is not guaranteed
        const parts: Record<string, string> = {};
        for (const chunk of sigHeader.split(',')) {
            const [k, v] = chunk.trim().split('=');
            if (k && v) parts[k] = v;
        }
        const ts = parts.ts;
        const v1 = parts.v1;
        if (!ts || !v1) {
            this.logger.warn('verifyWebhookSignature x-signature missing ts or v1');
            return false;
        }

        // Extract notification.data.id from the JSON body
        let dataId: string | undefined;
        try {
            const body = JSON.parse(rawBody);
            dataId = body?.data?.id ?? body?.id;
        } catch {
            this.logger.warn('verifyWebhookSignature could not parse raw body as JSON');
            return false;
        }
        if (!dataId) {
            this.logger.warn('verifyWebhookSignature webhook body has no data.id');
            return false;
        }

        const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
        const expected = createHmac('sha256', secret).update(message).digest('hex');

        // Constant-time comparison to avoid timing attacks
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(v1, 'hex');
        if (a.length !== b.length) return false;
        try {
            return timingSafeEqual(a, b);
        } catch {
            return false;
        }
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

    /**
     * Translate an MP PreApprovalResponse to our normalized ProviderSubscription.
     * MP's free_trial on the response is a string ("started" / "finished") — we
     * derive trialEndsAt from date_created + the free_trial config on the plan
     * when a richer timeline is needed; for now we parse next_payment_date.
     */
    protected toProviderSubscription(res: any, providerCustomerId?: string, providerPlanId?: string): ProviderSubscription {
        const hasActiveTrial = res.auto_recurring?.free_trial === 'started' || res.auto_recurring?.free_trial?.frequency > 0;
        const nextPayment = res.next_payment_date ? new Date(res.next_payment_date) : undefined;
        return {
            providerSubscriptionId: res.id,
            providerCustomerId: providerCustomerId ?? `mp_${res.external_reference ?? res.payer_id ?? 'unknown'}`,
            providerPlanId: providerPlanId ?? res.preapproval_plan_id ?? '',
            status: this.translateStatus(res.status, hasActiveTrial),
            trialEndsAt: hasActiveTrial ? nextPayment : undefined,
            currentPeriodStart: res.date_created ? new Date(res.date_created) : undefined,
            currentPeriodEnd: nextPayment,
            cancelAtPeriodEnd: false, // MP has no such concept; BillingService owns this flag
            rawStatus: res.status,
        };
    }
}
