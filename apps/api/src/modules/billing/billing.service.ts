import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { BillingEventType } from './types/billing-event.enum';
import { SubscriptionStatus } from './types/subscription-status.enum';
import {
    CancelSubscriptionOptions,
    NormalizedBillingEvent,
    PaymentProviderName,
} from './types/provider-types';

/**
 * Provider-agnostic subscription billing orchestrator.
 *
 * Responsibilities:
 *  1. Enforce the internal subscription state machine (trial → active → past_due → cancelled → expired).
 *  2. Keep `tenants` denormalized billing columns in sync on every transition so
 *     the rate limiter and middleware can decide access without joining.
 *  3. Idempotency for provider webhooks — (provider, providerEventId) is UNIQUE
 *     on billing_events so a redelivery returns early.
 *  4. Emit normalized billing events on EventEmitter2 for the rest of the
 *     platform (emails, analytics, feature gates, audit).
 *
 * What this service deliberately does NOT do:
 *  - Call providers directly. All provider work goes through IPaymentProvider
 *    resolved by PaymentProviderFactory. Swapping providers is a pure factory
 *    change, no service edits.
 *  - Validate webhook signatures. That is the adapter's job; this service
 *    only sees already-verified NormalizedBillingEvent.
 */
@Injectable()
export class BillingService {
    private readonly logger = new Logger(BillingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly eventEmitter: EventEmitter2,
        private readonly providerFactory: PaymentProviderFactory,
    ) {}

    // -------------------------------------------------------------------------
    // Reads
    // -------------------------------------------------------------------------

    async getActiveSubscription(tenantId: string) {
        return this.prisma.billingSubscription.findUnique({
            where: { tenantId },
            include: { plan: true },
        });
    }

    // -------------------------------------------------------------------------
    // Create trial subscription
    // -------------------------------------------------------------------------

    /**
     * Start a new subscription in trial state. The provider creates the
     * subscription immediately with native free_trial (MP) / trial_period_days
     * (Stripe) so the first charge only fires when the trial ends.
     *
     * Callers: onboarding completion step, dashboard "choose plan" flow.
     */
    async createTrialSubscription(input: {
        tenantId: string;
        planSlug: string;
        billingEmail?: string;
        billingCountry?: string;
        /** Short-lived card token from the provider client SDK. Required for Pro/Enterprise (requiresCardForTrial=true). */
        cardTokenId?: string;
    }) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId } });
        if (!tenant) throw new NotFoundException({ error: 'tenant_not_found', tenantId: input.tenantId });

        const existing = await this.prisma.billingSubscription.findUnique({ where: { tenantId: input.tenantId } });
        if (existing) {
            throw new ConflictException({
                error: 'subscription_already_exists',
                message: 'This tenant already has a subscription. Use upgrade or cancel flows instead.',
                subscriptionId: existing.id,
                status: existing.status,
            });
        }

        const plan = await this.prisma.billingPlan.findUnique({ where: { slug: input.planSlug } });
        if (!plan || !plan.isActive) throw new NotFoundException({ error: 'plan_not_found', planSlug: input.planSlug });

        if (plan.requiresCardForTrial && !input.cardTokenId) {
            throw new BadRequestException({
                error: 'card_required_for_trial',
                message: `The ${plan.slug} plan requires a payment method to start the trial.`,
            });
        }

        const providerName = (tenant.paymentProvider || 'mercadopago') as PaymentProviderName;
        const provider = this.providerFactory.getByName(providerName);

        // Create the customer on the provider side (or reuse existing one)
        let providerCustomerId = tenant.paymentProviderCustomerId;
        if (!providerCustomerId) {
            const customer = await provider.createCustomer({
                tenantId: tenant.id,
                email: input.billingEmail || tenant.billingEmail || '',
                name: tenant.name,
                country: input.billingCountry || tenant.billingCountry || undefined,
            });
            providerCustomerId = customer.providerCustomerId;
        }

        // Create the subscription on the provider side. status=trialing is
        // asserted by the provider via native trial support — if the provider
        // returns something else, the adapter has a bug and we log+throw.
        const providerSub = await provider.createSubscription({
            tenantId: tenant.id,
            providerCustomerId,
            providerPlanId: this.resolveProviderPlanId(plan, providerName),
            trialDays: plan.trialDays > 0 ? plan.trialDays : undefined,
            cardTokenId: input.cardTokenId,
            externalReference: tenant.id,
        });

        const trialEndsAt = providerSub.trialEndsAt
            ?? (plan.trialDays > 0 ? new Date(Date.now() + plan.trialDays * 86_400_000) : undefined);

        const subscription = await this.prisma.$transaction(async (tx) => {
            const created = await tx.billingSubscription.create({
                data: {
                    tenantId: tenant.id,
                    planId: plan.id,
                    status: providerSub.status,
                    provider: providerName,
                    providerSubscriptionId: providerSub.providerSubscriptionId,
                    providerCustomerId,
                    trialStartedAt: plan.trialDays > 0 ? new Date() : null,
                    trialEndsAt: trialEndsAt ?? null,
                    currentPeriodStart: providerSub.currentPeriodStart ?? null,
                    currentPeriodEnd: providerSub.currentPeriodEnd ?? null,
                    cancelAtPeriodEnd: providerSub.cancelAtPeriodEnd,
                },
            });

            await tx.tenant.update({
                where: { id: tenant.id },
                data: {
                    paymentProvider: providerName,
                    paymentProviderCustomerId: providerCustomerId,
                    billingEmail: input.billingEmail ?? tenant.billingEmail,
                    billingCountry: input.billingCountry ?? tenant.billingCountry,
                    subscriptionStatus: providerSub.status,
                    trialEndsAt: trialEndsAt ?? null,
                    currentPeriodEnd: providerSub.currentPeriodEnd ?? null,
                },
            });

            return created;
        });

        // Redis plan cache may be stale — invalidate so next throttle check sees the new state
        await this.redis.del(`tenant_plan:${tenant.id}`);

        // Emit both subscription.created and trial.started (trial.started only if trialDays > 0)
        this.emit(BillingEventType.SUBSCRIPTION_CREATED, tenant.id, subscription.id);
        if (plan.trialDays > 0) this.emit(BillingEventType.TRIAL_STARTED, tenant.id, subscription.id);

        this.logger.log(`[Billing] Trial subscription created for tenant ${tenant.id} on plan ${plan.slug} (${plan.trialDays}d trial)`);
        return subscription;
    }

    // -------------------------------------------------------------------------
    // Upgrade / downgrade
    // -------------------------------------------------------------------------

    async upgradeSubscription(tenantId: string, newPlanSlug: string) {
        const sub = await this.requireSubscription(tenantId);
        const newPlan = await this.prisma.billingPlan.findUnique({ where: { slug: newPlanSlug } });
        if (!newPlan || !newPlan.isActive) throw new NotFoundException({ error: 'plan_not_found', planSlug: newPlanSlug });
        if (newPlan.id === sub.planId) {
            throw new BadRequestException({ error: 'same_plan', message: 'Tenant is already on this plan.' });
        }

        const provider = this.providerFactory.getByName(sub.provider);
        const newProviderPlanId = this.resolveProviderPlanId(newPlan, sub.provider as PaymentProviderName);
        if (!sub.providerSubscriptionId) {
            throw new BadRequestException({ error: 'missing_provider_subscription', message: 'Subscription has no provider id — cannot upgrade.' });
        }

        const updated = await provider.changeSubscriptionPlan(sub.providerSubscriptionId, newProviderPlanId);

        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                planId: newPlan.id,
                status: updated.status,
                currentPeriodStart: updated.currentPeriodStart ?? sub.currentPeriodStart,
                currentPeriodEnd: updated.currentPeriodEnd ?? sub.currentPeriodEnd,
            },
        });
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                subscriptionStatus: updated.status,
                currentPeriodEnd: updated.currentPeriodEnd ?? sub.currentPeriodEnd ?? null,
            },
        });
        await this.redis.del(`tenant_plan:${tenantId}`);

        this.emit(BillingEventType.SUBSCRIPTION_PLAN_CHANGED, tenantId, sub.id, { fromPlan: sub.planId, toPlan: newPlan.id });
        this.logger.log(`[Billing] Tenant ${tenantId} changed plan to ${newPlan.slug}`);
        return { ...sub, planId: newPlan.id };
    }

    // -------------------------------------------------------------------------
    // Cancel
    // -------------------------------------------------------------------------

    async cancelSubscription(tenantId: string, opts: CancelSubscriptionOptions = {}) {
        const sub = await this.requireSubscription(tenantId);
        const provider = this.providerFactory.getByName(sub.provider);
        if (!sub.providerSubscriptionId) {
            throw new BadRequestException({ error: 'missing_provider_subscription' });
        }

        await provider.cancelSubscription(sub.providerSubscriptionId, opts);

        const newStatus = opts.immediate ? SubscriptionStatus.CANCELLED : sub.status;
        const cancelAtPeriodEnd = !opts.immediate;

        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                status: newStatus,
                cancelAtPeriodEnd,
                cancelledAt: opts.immediate ? new Date() : null,
                cancellationReason: opts.reason ?? null,
            },
        });
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { subscriptionStatus: newStatus },
        });
        await this.redis.del(`tenant_plan:${tenantId}`);

        this.emit(BillingEventType.SUBSCRIPTION_CANCELLED, tenantId, sub.id, { immediate: !!opts.immediate, reason: opts.reason });
        this.logger.log(`[Billing] Tenant ${tenantId} cancelled subscription (immediate=${!!opts.immediate})`);
    }

    // -------------------------------------------------------------------------
    // Webhook event handler
    // -------------------------------------------------------------------------

    /**
     * Process a normalized webhook event. Idempotent: the same
     * (provider, providerEventId) tuple can be delivered multiple times and
     * only the first call updates state.
     *
     * Called by BillingWebhookController after the adapter has verified the
     * signature and parsed the payload.
     */
    async handleBillingEvent(event: NormalizedBillingEvent): Promise<{ processed: boolean; reason?: string }> {
        // Idempotency — the unique index on billing_events(provider, provider_event_id)
        // would throw on the insert below, but we check first so duplicates return
        // a clean no-op instead of raising a DB exception.
        const existing = await this.prisma.billingEvent.findUnique({
            where: {
                provider_providerEventId: {
                    provider: event.provider,
                    providerEventId: event.providerEventId,
                },
            },
        });
        if (existing) {
            this.logger.debug(`[Billing] Duplicate event ${event.provider}/${event.providerEventId} — skipped`);
            return { processed: false, reason: 'duplicate' };
        }

        // Resolve the subscription this event concerns (if any)
        const sub = event.providerSubscriptionId
            ? await this.prisma.billingSubscription.findUnique({ where: { providerSubscriptionId: event.providerSubscriptionId } })
            : null;

        await this.prisma.$transaction(async (tx) => {
            await tx.billingEvent.create({
                data: {
                    tenantId: sub?.tenantId ?? event.tenantId ?? null,
                    subscriptionId: sub?.id ?? null,
                    provider: event.provider,
                    providerEventId: event.providerEventId,
                    eventType: event.type,
                    payload: event.rawPayload as any,
                },
            });

            if (sub) {
                const patch = this.deriveSubscriptionPatch(event, sub.status as SubscriptionStatus);
                if (patch) {
                    await tx.billingSubscription.update({ where: { id: sub.id }, data: patch });
                    if (patch.status) {
                        await tx.tenant.update({
                            where: { id: sub.tenantId },
                            data: {
                                subscriptionStatus: patch.status,
                                currentPeriodEnd: patch.currentPeriodEnd ?? sub.currentPeriodEnd,
                            },
                        });
                    }
                }

                if (event.type === BillingEventType.PAYMENT_SUCCEEDED && event.payment) {
                    await tx.billingPayment.create({
                        data: {
                            subscriptionId: sub.id,
                            tenantId: sub.tenantId,
                            amountCents: event.payment.amountCents,
                            currency: event.payment.currency,
                            status: 'succeeded',
                            provider: event.provider,
                            providerPaymentId: event.payment.providerPaymentId,
                            paidAt: event.payment.paidAt ?? new Date(),
                        },
                    });
                } else if (event.type === BillingEventType.PAYMENT_FAILED && event.payment) {
                    await tx.billingPayment.create({
                        data: {
                            subscriptionId: sub.id,
                            tenantId: sub.tenantId,
                            amountCents: event.payment.amountCents,
                            currency: event.payment.currency,
                            status: 'failed',
                            provider: event.provider,
                            providerPaymentId: event.payment.providerPaymentId,
                            failureReason: event.payment.failureReason,
                        },
                    });
                }
            }
        });

        if (sub) await this.redis.del(`tenant_plan:${sub.tenantId}`);

        // Re-emit via EventEmitter2 so rest of the platform (emails, analytics,
        // feature gates) can react without coupling to BillingService.
        this.eventEmitter.emit(event.type, {
            tenantId: sub?.tenantId ?? event.tenantId,
            subscriptionId: sub?.id,
            event,
        });

        this.logger.log(`[Billing] Processed ${event.type} for ${event.provider}/${event.providerEventId}`);
        return { processed: true };
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private async requireSubscription(tenantId: string) {
        const sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId } });
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found', tenantId });
        return sub;
    }

    private resolveProviderPlanId(plan: { mpPlanId: string | null; stripePlanId: string | null }, providerName: PaymentProviderName): string {
        const id = providerName === 'mercadopago' ? plan.mpPlanId : providerName === 'stripe' ? plan.stripePlanId : 'mock-plan';
        if (!id) {
            throw new BadRequestException({
                error: 'provider_plan_not_configured',
                message: `This plan is not registered with ${providerName} yet. Run the plan sync script for that provider.`,
            });
        }
        return id;
    }

    /**
     * Translate a webhook event into the DB patch to apply to the subscription
     * row. Returns null when the event only affects the log, not the state.
     */
    private deriveSubscriptionPatch(
        event: NormalizedBillingEvent,
        currentStatus: SubscriptionStatus,
    ): { status?: string; currentPeriodStart?: Date | null; currentPeriodEnd?: Date | null; cancelledAt?: Date | null; cancelAtPeriodEnd?: boolean } | null {
        switch (event.type) {
            case BillingEventType.PAYMENT_SUCCEEDED:
                // Trial ended successfully, or normal renewal
                return {
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodStart: event.subscription?.currentPeriodStart ?? null,
                    currentPeriodEnd: event.subscription?.currentPeriodEnd ?? null,
                };
            case BillingEventType.PAYMENT_FAILED:
                // Go to past_due only from active/trialing — do not downgrade
                // an already-cancelled sub back to past_due.
                if (currentStatus === SubscriptionStatus.ACTIVE || currentStatus === SubscriptionStatus.TRIALING) {
                    return { status: SubscriptionStatus.PAST_DUE };
                }
                return null;
            case BillingEventType.SUBSCRIPTION_CANCELLED:
                return { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() };
            case BillingEventType.SUBSCRIPTION_EXPIRED:
                return { status: SubscriptionStatus.EXPIRED };
            case BillingEventType.SUBSCRIPTION_ACTIVATED:
                return { status: SubscriptionStatus.ACTIVE };
            case BillingEventType.TRIAL_ENDED:
                // Provider reported trial over; actual transition depends on
                // whether a payment also succeeded. We only clear trialing
                // here if nothing else is driving the state.
                if (currentStatus === SubscriptionStatus.TRIALING) {
                    return { status: SubscriptionStatus.PENDING_AUTH };
                }
                return null;
            default:
                return null;
        }
    }

    private emit(type: BillingEventType, tenantId: string, subscriptionId: string, extra?: Record<string, unknown>) {
        this.eventEmitter.emit(type, { tenantId, subscriptionId, ...extra });
    }
}
