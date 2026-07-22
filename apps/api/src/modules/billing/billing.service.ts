import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { BillingEventType } from './types/billing-event.enum';
import { SubscriptionStatus } from './types/subscription-status.enum';
import {
    BillingCycle,
    CancelSubscriptionOptions,
    NormalizedBillingEvent,
    PaymentProviderName,
} from './types/provider-types';
import { FiscalConfigService } from '../fiscal/fiscal-config.service';
import { billingCountryRequiresFiscalData, isFiscalDataComplete } from '../fiscal/fiscal-data.util';

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
        private readonly fiscalConfig: FiscalConfigService,
    ) {}

    /**
     * Fiscal gate (top global pattern: collect tax identity before charging).
     * When enabled by the super admin, a tenant in a DIAN country (Colombia) must
     * have a complete + valid fiscal profile before any charge-bearing flow
     * (trial start, upgrade). Dormant by default (fiscal.gate_enabled=false) so
     * deploying it changes nothing until fiscal go-live + tenant backfill.
     */
    private async assertFiscalDataReady(
        tenant: { billingCountry?: string | null; settings?: unknown } | null,
        effectiveCountry?: string | null,
    ): Promise<void> {
        const cfg = await this.fiscalConfig.getConfig();
        if (!cfg.fiscalGateEnabled) return;
        const country = effectiveCountry ?? tenant?.billingCountry;
        if (!billingCountryRequiresFiscalData(country)) return;
        if (isFiscalDataComplete(tenant?.settings)) return;
        throw new BadRequestException({
            error: 'fiscal_data_required',
            message:
                'Completa tus datos fiscales (NIT/cédula) antes de iniciar o cambiar tu plan. Es requerido para emitir tu factura electrónica (DIAN).',
        });
    }

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
        /** Billing cycle chosen at signup. Persisted so trial→paid conversion binds the right (monthly/annual) plan. Defaults to monthly. */
        billingCycle?: BillingCycle;
    }) {
        const billingCycle: BillingCycle = input.billingCycle === 'annual' ? 'annual' : 'monthly';
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

        // Trial periods are managed entirely by Parallly (not the provider).
        // MP plans are created without free_trial so upgrades don't get a
        // second trial. During the trial we keep the subscription local in
        // 'trialing' state; when the trial ends the reconciliation cron or
        // the upgrade flow creates the provider subscription and charges.
        const skipProviderCreate = plan.trialDays > 0;

        // Fiscal gate: only block CHARGE-bearing flows (paid plan, or a card-backed
        // trial that auto-converts). A free trial with no card has no charge yet, so
        // we don't block free signups/onboarding — the gate fires later on upgrade.
        if (plan.requiresCardForTrial || plan.trialDays === 0) {
            await this.assertFiscalDataReady(tenant, input.billingCountry);
        }

        // Create the customer on the provider side (or reuse existing one).
        // We still create the customer up front when possible so subsequent
        // payment-method additions don't need to re-do this step.
        let providerCustomerId = tenant.paymentProviderCustomerId;
        if (!providerCustomerId && !skipProviderCreate) {
            const customer = await provider.createCustomer({
                tenantId: tenant.id,
                email: input.billingEmail || tenant.billingEmail || '',
                name: tenant.name,
                country: input.billingCountry || tenant.billingCountry || undefined,
            });
            providerCustomerId = customer.providerCustomerId;
        }

        const providerSub = skipProviderCreate
            ? {
                  providerSubscriptionId: null as string | null,
                  status: SubscriptionStatus.TRIALING,
                  trialEndsAt: new Date(Date.now() + plan.trialDays * 86_400_000),
                  currentPeriodStart: new Date(),
                  currentPeriodEnd: new Date(Date.now() + plan.trialDays * 86_400_000),
                  cancelAtPeriodEnd: false,
              }
            : await provider.createSubscription({
                  tenantId: tenant.id,
                  providerCustomerId: providerCustomerId!,
                  providerPlanId: this.resolveProviderPlanId(plan, providerName, input.billingCountry ?? tenant.billingCountry, billingCycle),
                  trialDays: plan.trialDays > 0 ? plan.trialDays : undefined,
                  cardTokenId: input.cardTokenId,
                  billingInterval: billingCycle === 'annual' ? 'year' : 'month',
                  externalReference: tenant.id,
                  metadata: {
                      email: input.billingEmail || tenant.billingEmail || '',
                      billingEmail: input.billingEmail || tenant.billingEmail || '',
                  },
              });

        const trialEndsAt = providerSub.trialEndsAt
            ?? (plan.trialDays > 0 ? new Date(Date.now() + plan.trialDays * 86_400_000) : undefined);

        const subscription = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
                    metadata: { billingCycle } as any,
                },
            });

            await tx.tenant.update({
                where: { id: tenant.id },
                data: {
                    plan: plan.slug,
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
        await this.redis.del(`sub_status:${tenant.id}`);
        await this.redis.del(`plan_features:${tenant.id}`);

        // Emit both subscription.created and trial.started (trial.started only if trialDays > 0)
        this.emit(BillingEventType.SUBSCRIPTION_CREATED, tenant.id, subscription.id);
        if (plan.trialDays > 0) this.emit(BillingEventType.TRIAL_STARTED, tenant.id, subscription.id);

        this.logger.log(`[Billing] Trial subscription created for tenant ${tenant.id} on plan ${plan.slug} (${plan.trialDays}d trial)`);
        return subscription;
    }

    // -------------------------------------------------------------------------
    // Upgrade / downgrade
    // -------------------------------------------------------------------------

    async upgradeSubscription(tenantId: string, newPlanSlug: string, cardTokenId?: string, billingCycle?: BillingCycle) {
        const sub = await this.requireSubscription(tenantId);
        const newPlan = await this.prisma.billingPlan.findUnique({ where: { slug: newPlanSlug } });
        if (!newPlan || !newPlan.isActive) throw new NotFoundException({ error: 'plan_not_found', planSlug: newPlanSlug });

        const currentCycle = this.subscriptionCycle(sub);
        const targetCycle: BillingCycle = billingCycle ?? currentCycle;
        const sameTier = newPlan.id === sub.planId;
        const cycleChanged = targetCycle !== currentCycle;
        if (sameTier && !cycleChanged) {
            throw new BadRequestException({ error: 'same_plan', message: 'Tenant is already on this plan and billing cycle.' });
        }

        // Detect upgrade vs downgrade by comparing prices in USD cents.
        // A pure downgrade (lower tier, SAME cycle) is scheduled for period end so
        // the user isn't re-charged; the user keeps the higher-tier features until
        // then. A cycle change (monthly↔annual) always needs a NEW preapproval_plan
        // in MP (different frequency), so it goes through the immediate
        // cancel+recreate path regardless of tier direction.
        const currentPlan = await this.prisma.billingPlan.findUnique({ where: { id: sub.planId } });
        const isDowngrade = (currentPlan?.priceUsdCents ?? 0) > newPlan.priceUsdCents;
        if (isDowngrade && !cycleChanged) {
            return this.scheduleDowngrade(tenantId, sub.id, newPlan.id, currentCycle);
        }

        const providerName = sub.provider as PaymentProviderName;
        const provider = this.providerFactory.getByName(providerName);
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true, billingCountry: true, billingEmail: true, paymentProviderCustomerId: true, settings: true },
        });
        // Fiscal gate: require DIAN tax identity before charging an upgrade.
        await this.assertFiscalDataReady(tenant);
        const newProviderPlanId = this.resolveProviderPlanId(newPlan, providerName, tenant?.billingCountry, targetCycle);

        let updatedStatus = sub.status;
        let currentPeriodStart = sub.currentPeriodStart;
        let currentPeriodEnd = sub.currentPeriodEnd;
        let newProviderSubscriptionId = sub.providerSubscriptionId;

        if (sub.provider === 'mercadopago') {
            if (!cardTokenId) {
                throw new BadRequestException({ error: 'card_token_required_for_upgrade', message: 'A new card token is required to upgrade a Mercado Pago subscription.' });
            }

            const payerEmail = tenant?.billingEmail;
            if (!payerEmail) {
                throw new BadRequestException({ error: 'mp_payer_email_required', message: 'Tenant billingEmail is required for MercadoPago. Set it in tenant settings.' });
            }

            // Ensure we have a provider customer ID (starter trials skip customer creation)
            let custId = sub.providerCustomerId || tenant?.paymentProviderCustomerId;
            if (!custId) {
                const customer = await provider.createCustomer({
                    tenantId,
                    email: payerEmail,
                    name: tenant?.name || '',
                    country: tenant?.billingCountry || undefined,
                });
                custId = customer.providerCustomerId;
                await this.prisma.tenant.update({ where: { id: tenantId }, data: { paymentProviderCustomerId: custId } });
            }

            // Create the new subscription
            const newProviderSub = await provider.createSubscription({
                tenantId,
                providerCustomerId: custId,
                providerPlanId: newProviderPlanId,
                cardTokenId,
                billingInterval: targetCycle === 'annual' ? 'year' : 'month',
                metadata: { email: payerEmail, billingEmail: payerEmail },
            });

            // Cancel the old MP subscription if one existed
            if (sub.providerSubscriptionId) {
                await provider.cancelSubscription(sub.providerSubscriptionId, { immediate: true });
            }

            updatedStatus = newProviderSub.status;
            currentPeriodStart = newProviderSub.currentPeriodStart || null;
            currentPeriodEnd = newProviderSub.currentPeriodEnd || null;
            newProviderSubscriptionId = newProviderSub.providerSubscriptionId;
        } else {
            // Stripe or Mock — requires an existing provider subscription
            if (!sub.providerSubscriptionId) {
                throw new BadRequestException({ error: 'missing_provider_subscription', message: 'Subscription has no provider id — cannot upgrade via this provider.' });
            }
            const updated = await provider.changeSubscriptionPlan(sub.providerSubscriptionId, newProviderPlanId);
            updatedStatus = updated.status;
            currentPeriodStart = updated.currentPeriodStart || null;
            currentPeriodEnd = updated.currentPeriodEnd || null;
        }

        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                planId: newPlan.id,
                status: updatedStatus,
                currentPeriodStart: currentPeriodStart ?? sub.currentPeriodStart,
                currentPeriodEnd: currentPeriodEnd ?? sub.currentPeriodEnd,
                providerSubscriptionId: newProviderSubscriptionId,
                metadata: {
                    ...(sub.metadata && typeof sub.metadata === 'object' ? (sub.metadata as any) : {}),
                    billingCycle: targetCycle,
                } as any,
            },
        });
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                plan: newPlan.slug,
                subscriptionStatus: updatedStatus,
                currentPeriodEnd: currentPeriodEnd ?? sub.currentPeriodEnd ?? null,
            },
        });
        await this.redis.del(`tenant_plan:${tenantId}`);
        await this.redis.del(`sub_status:${tenantId}`);
        await this.redis.del(`plan_features:${tenantId}`);

        this.emit(BillingEventType.SUBSCRIPTION_PLAN_CHANGED, tenantId, sub.id, { fromPlan: sub.planId, toPlan: newPlan.id });
        this.logger.log(`[Billing] Tenant ${tenantId} changed plan to ${newPlan.slug}`);
        return { ...sub, planId: newPlan.id };
    }

    /**
     * Schedule a downgrade for the next billing cycle. Doesn't touch the
     * provider — the user keeps their higher tier features until period end,
     * then the daily cron (applyPendingPlanChanges) flips planId.
     */
    private async scheduleDowngrade(tenantId: string, subscriptionId: string, targetPlanId: string, cycle: BillingCycle = 'monthly') {
        const sub = await this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId } });
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found' });

        // Effective date: end of current period if present, otherwise fall back to
        // one cycle out (+365d for annual, +30d for monthly).
        const fallbackDays = cycle === 'annual' ? 365 : 30;
        const effectiveAt = sub.currentPeriodEnd
            ?? new Date(Date.now() + fallbackDays * 86_400_000);

        const updated = await this.prisma.billingSubscription.update({
            where: { id: subscriptionId },
            data: {
                pendingPlanId: targetPlanId,
                pendingPlanChangeAt: effectiveAt,
            },
        });

        this.logger.log(`[Billing] Tenant ${tenantId} scheduled downgrade to plan ${targetPlanId} effective ${effectiveAt.toISOString()}`);
        await this.prisma.auditLog.create({
            data: {
                tenantId,
                action: 'subscription_downgrade_scheduled',
                resource: `billing_subscriptions/${sub.id}`,
                details: {
                    fromPlanId: sub.planId,
                    toPlanId: targetPlanId,
                    effectiveAt: effectiveAt.toISOString(),
                },
            },
        });

        return {
            ...updated,
            scheduled: true,
            effectiveAt: effectiveAt.toISOString(),
        };
    }

    /**
     * Cancel a pending downgrade (user changed their mind before period end).
     */
    async cancelPendingDowngrade(tenantId: string): Promise<void> {
        const sub = await this.requireSubscription(tenantId);
        if (!sub.pendingPlanId) {
            throw new BadRequestException({ error: 'no_pending_change' });
        }
        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: { pendingPlanId: null, pendingPlanChangeAt: null },
        });
        await this.prisma.auditLog.create({
            data: {
                tenantId,
                action: 'subscription_downgrade_cancelled',
                resource: `billing_subscriptions/${sub.id}`,
                details: {},
            },
        });
        this.logger.log(`[Billing] Tenant ${tenantId} cancelled pending downgrade`);
    }

    /**
     * Cron-callable: apply all pending plan changes whose effective date
     * has passed. For MercadoPago, this currently only flips the local
     * planId — the next charge cycle will pick up the new plan via the
     * provider's normal recurring schedule. If we ever need same-cycle
     * provider sync, this is the place to add it.
     */
    async applyPendingPlanChanges(): Promise<{ applied: number }> {
        const now = new Date();
        const due = await this.prisma.billingSubscription.findMany({
            where: {
                pendingPlanChangeAt: { lte: now },
                pendingPlanId: { not: null },
            },
            take: 500,
        });

        let applied = 0;
        for (const sub of due) {
            try {
                const newPlan = await this.prisma.billingPlan.findUnique({
                    where: { id: sub.pendingPlanId! },
                    select: { slug: true, mpPlanId: true, stripePlanId: true, priceLocalOverrides: true },
                });
                await this.prisma.billingSubscription.update({
                    where: { id: sub.id },
                    data: {
                        planId: sub.pendingPlanId!,
                        pendingPlanId: null,
                        pendingPlanChangeAt: null,
                    },
                });
                let billingCountry: string | null = null;
                if (newPlan) {
                    const tenant = await this.prisma.tenant.update({
                        where: { id: sub.tenantId },
                        data: { plan: newPlan.slug },
                        select: { billingCountry: true },
                    });
                    billingCountry = tenant.billingCountry;
                }
                await this.redis.del(`tenant_plan:${sub.tenantId}`);
                await this.redis.del(`sub_status:${sub.tenantId}`);
                await this.redis.del(`plan_features:${sub.tenantId}`);
                this.emit(BillingEventType.SUBSCRIPTION_PLAN_CHANGED, sub.tenantId, sub.id, {
                    fromPlan: sub.planId, toPlan: sub.pendingPlanId, scheduled: true,
                });
                await this.prisma.auditLog.create({
                    data: {
                        tenantId: sub.tenantId,
                        action: 'subscription_downgrade_applied',
                        resource: `billing_subscriptions/${sub.id}`,
                        details: { fromPlanId: sub.planId, toPlanId: sub.pendingPlanId },
                    },
                });
                applied++;

                // Best-effort: move the subscription to the new plan at the
                // provider so the NEXT charge reflects the lower price. The local
                // entitlement flip above already succeeded — a provider failure
                // must never undo it, so this runs in its own try/catch and is
                // recorded for manual follow-up instead of throwing.
                if (sub.provider === 'mercadopago' && sub.providerSubscriptionId && newPlan) {
                    await this.syncDowngradeToProvider(sub, newPlan, billingCountry, this.subscriptionCycle(sub));
                }
            } catch (e: any) {
                this.logger.error(`[Billing] Failed to apply pending change for ${sub.id}: ${e.message}`);
            }
        }
        if (applied > 0) this.logger.log(`[Billing] Applied ${applied} pending plan changes`);
        return { applied };
    }

    /**
     * Best-effort push of a scheduled downgrade to MercadoPago so the next charge
     * uses the new plan's amount. NEVER throws — the local entitlement flip has
     * already been applied by the caller. MercadoPago has no native proration and
     * changing a live preapproval's plan "works on some accounts" (see
     * mercadopago.adapter changeSubscriptionPlan); when it can't, we log an audit
     * entry (subscription_downgrade_provider_sync_failed) so a super admin can
     * follow up, since MP may require the customer to re-authorize their card.
     */
    private async syncDowngradeToProvider(
        sub: { id: string; tenantId: string; provider: string; providerSubscriptionId: string | null },
        newPlan: { mpPlanId: string | null; priceLocalOverrides: any },
        billingCountry: string | null,
        cycle: BillingCycle = 'monthly',
    ): Promise<void> {
        try {
            const overrides = (newPlan.priceLocalOverrides && typeof newPlan.priceLocalOverrides === 'object')
                ? (newPlan.priceLocalOverrides as Record<string, any>)
                : {};
            const country = billingCountry?.toUpperCase();
            // Annual fails closed: never fall back to the monthly id (would charge
            // the wrong amount on the next cycle).
            const providerPlanId = cycle === 'annual'
                ? (country ? overrides[country]?.annual?.mpPlanId : undefined)
                : ((country && overrides[country]?.mpPlanId) ? overrides[country].mpPlanId : newPlan.mpPlanId);

            if (!providerPlanId) {
                throw new Error(`no MercadoPago ${cycle} plan id for country ${country ?? '(default)'}`);
            }

            const provider = this.providerFactory.getByName('mercadopago');
            await provider.changeSubscriptionPlan(sub.providerSubscriptionId!, providerPlanId);
            this.logger.log(`[Billing] Downgrade sub=${sub.id} synced to MP plan ${providerPlanId}`);
        } catch (e: any) {
            this.logger.error(`[Billing] Downgrade sub=${sub.id} MP sync failed (local entitlement already applied): ${e?.message}`);
            await this.prisma.auditLog.create({
                data: {
                    tenantId: sub.tenantId,
                    action: 'subscription_downgrade_provider_sync_failed',
                    resource: `billing_subscriptions/${sub.id}`,
                    details: { providerSubscriptionId: sub.providerSubscriptionId, error: e?.message },
                },
            });
        }
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
        await this.redis.del(`sub_status:${tenantId}`);

        this.emit(BillingEventType.SUBSCRIPTION_CANCELLED, tenantId, sub.id, { immediate: !!opts.immediate, reason: opts.reason });
        this.logger.log(`[Billing] Tenant ${tenantId} cancelled subscription (immediate=${!!opts.immediate})`);
    }

    // -------------------------------------------------------------------------
    // Pause / Resume — short-term hold without cancelling
    // -------------------------------------------------------------------------

    /**
     * Pause an active subscription. The provider stops charging but the
     * subscription record stays so the tenant can resume later without a
     * new card token. We map this to PAST_DUE internally so plan limits
     * still kick in and the dashboard shows a "paused" banner.
     */
    async pauseSubscription(tenantId: string, opts: { reason?: string } = {}): Promise<void> {
        const sub = await this.requireSubscription(tenantId);
        if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.TRIALING) {
            throw new BadRequestException({
                error: 'cannot_pause',
                message: 'Solo se pueden pausar suscripciones activas o en trial.',
                currentStatus: sub.status,
            });
        }
        if (!sub.providerSubscriptionId) {
            throw new BadRequestException({ error: 'missing_provider_subscription' });
        }

        const provider = this.providerFactory.getByName(sub.provider);
        if (typeof (provider as any).pauseSubscription !== 'function') {
            throw new BadRequestException({ error: 'pause_unsupported', message: `${sub.provider} does not support pause.` });
        }
        await (provider as any).pauseSubscription(sub.providerSubscriptionId);

        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                status: SubscriptionStatus.PAST_DUE,
                cancellationReason: opts.reason ? `paused: ${opts.reason}` : 'paused',
            },
        });
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
        });
        await this.redis.del(`tenant_plan:${tenantId}`);
        await this.redis.del(`sub_status:${tenantId}`);

        await this.prisma.auditLog.create({
            data: {
                tenantId,
                action: 'subscription_paused',
                resource: `billing_subscriptions/${sub.id}`,
                details: { reason: opts.reason ?? null, plan: (sub as any).plan?.slug ?? null },
            },
        });
        this.logger.log(`[Billing] Tenant ${tenantId} paused subscription`);
    }

    /**
     * Resume a paused subscription. The provider resumes the next billing
     * cycle. We restore status to ACTIVE if there's a current period, or
     * back to TRIALING if the trial hadn't expired yet.
     */
    async resumeSubscription(tenantId: string): Promise<void> {
        const sub = await this.requireSubscription(tenantId);
        if (sub.cancellationReason !== 'paused' && !sub.cancellationReason?.startsWith('paused:')) {
            throw new BadRequestException({
                error: 'not_paused',
                message: 'La suscripción no está pausada.',
            });
        }
        if (!sub.providerSubscriptionId) {
            throw new BadRequestException({ error: 'missing_provider_subscription' });
        }

        const provider = this.providerFactory.getByName(sub.provider);
        if (typeof (provider as any).resumeSubscription !== 'function') {
            throw new BadRequestException({ error: 'resume_unsupported' });
        }
        await (provider as any).resumeSubscription(sub.providerSubscriptionId);

        // Restore to TRIALING if trial hasn't expired, otherwise ACTIVE
        const now = new Date();
        const stillTrialing = sub.trialEndsAt && sub.trialEndsAt > now;
        const restoredStatus = stillTrialing ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;

        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: { status: restoredStatus, cancellationReason: null },
        });
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { subscriptionStatus: restoredStatus },
        });
        await this.redis.del(`tenant_plan:${tenantId}`);
        await this.redis.del(`sub_status:${tenantId}`);

        await this.prisma.auditLog.create({
            data: {
                tenantId,
                action: 'subscription_resumed',
                resource: `billing_subscriptions/${sub.id}`,
                details: { restoredStatus },
            },
        });
        this.logger.log(`[Billing] Tenant ${tenantId} resumed subscription`);
    }

    // -------------------------------------------------------------------------
    // Retry payment now (past_due recovery without waiting for cron)
    // -------------------------------------------------------------------------

    /**
     * Force an immediate sync against the provider for this tenant's
     * subscription. Used by the dashboard "retry now" button when a tenant
     * is past_due. Does NOT issue a new charge — it pulls the latest state
     * from the provider; if MP retried in background and succeeded, this
     * picks it up immediately instead of waiting for the hourly cron.
     */
    async syncFromProvider(tenantId: string): Promise<{ status: string; updated: boolean }> {
        const sub = await this.requireSubscription(tenantId);
        if (!sub.providerSubscriptionId) {
            throw new BadRequestException({ error: 'missing_provider_subscription' });
        }

        const provider = this.providerFactory.getByName(sub.provider);
        const remote = await provider.getSubscription(sub.providerSubscriptionId);
        const remoteStatus = remote.status as SubscriptionStatus;
        const updated = remoteStatus !== sub.status;

        if (updated) {
            await this.prisma.billingSubscription.update({
                where: { id: sub.id },
                data: {
                    status: remoteStatus,
                    currentPeriodStart: remote.currentPeriodStart || sub.currentPeriodStart,
                    currentPeriodEnd: remote.currentPeriodEnd || sub.currentPeriodEnd,
                },
            });
            await this.prisma.tenant.update({
                where: { id: tenantId },
                data: { subscriptionStatus: remoteStatus },
            });
            await this.redis.del(`tenant_plan:${tenantId}`);
        await this.redis.del(`sub_status:${tenantId}`);

            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'subscription_synced',
                    resource: `billing_subscriptions/${sub.id}`,
                    details: { from: sub.status, to: remoteStatus },
                },
            });
        }
        return { status: remoteStatus, updated };
    }

    // -------------------------------------------------------------------------
    // Coupon application
    // -------------------------------------------------------------------------

    /**
     * Apply free_months by extending the local trial end. The provider
     * subscription continues on its own schedule; we just delay our
     * "expected next charge" notion. percent_off / amount_off coupons
     * are tracked as redemption rows but do NOT mutate the subscription
     * here — see the runbook for how the actual credit is reconciled.
     */
    async applyFreeMonthsExtension(tenantId: string, months: number): Promise<void> {
        const sub = await this.requireSubscription(tenantId);
        const ms = months * 30 * 86_400_000;
        const newTrialEnd = sub.trialEndsAt
            ? new Date(sub.trialEndsAt.getTime() + ms)
            : new Date(Date.now() + ms);
        const newPeriodEnd = sub.currentPeriodEnd
            ? new Date(sub.currentPeriodEnd.getTime() + ms)
            : newTrialEnd;

        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                trialEndsAt: newTrialEnd,
                currentPeriodEnd: newPeriodEnd,
                status: SubscriptionStatus.TRIALING,
            },
        });
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                trialEndsAt: newTrialEnd,
                currentPeriodEnd: newPeriodEnd,
                subscriptionStatus: SubscriptionStatus.TRIALING,
            },
        });
        await this.redis.del(`tenant_plan:${tenantId}`);
        await this.redis.del(`sub_status:${tenantId}`);
        this.logger.log(`[Billing] Extended trial for tenant ${tenantId} by ${months} months`);
    }

    // -------------------------------------------------------------------------
    // Refund (super_admin only)
    // -------------------------------------------------------------------------

    /**
     * Issue a refund for a previously succeeded payment. Caller must be
     * super_admin (enforced at controller level). The actual status update
     * on BillingPayment.status='refunded' arrives via the provider webhook;
     * this just kicks off the refund and writes an audit row immediately.
     */
    async refundPayment(input: {
        paymentId: string;
        amountCents?: number;
        reason?: string;
        actorUserId?: string;
    }): Promise<{ providerPaymentId: string; partialAmountCents: number | null }> {
        const payment = await this.prisma.billingPayment.findUnique({
            where: { id: input.paymentId },
        });
        if (!payment) throw new NotFoundException({ error: 'payment_not_found' });
        if (payment.status === 'refunded') {
            throw new BadRequestException({ error: 'already_refunded' });
        }
        if (payment.status !== 'succeeded') {
            throw new BadRequestException({
                error: 'cannot_refund',
                message: `Cannot refund a payment with status='${payment.status}'.`,
            });
        }
        if (!payment.providerPaymentId) {
            throw new BadRequestException({ error: 'missing_provider_payment_id' });
        }
        if (input.amountCents != null && input.amountCents > payment.amountCents) {
            throw new BadRequestException({
                error: 'refund_exceeds_payment',
                paymentAmountCents: payment.amountCents,
                requestedAmountCents: input.amountCents,
            });
        }

        const provider = this.providerFactory.getByName(payment.provider);
        await provider.refundPayment(payment.providerPaymentId, input.amountCents);

        await this.prisma.auditLog.create({
            data: {
                tenantId: payment.tenantId,
                action: 'payment_refunded',
                resource: `billing_payments/${payment.id}`,
                userId: input.actorUserId,
                details: {
                    providerPaymentId: payment.providerPaymentId,
                    fullAmountCents: payment.amountCents,
                    refundedAmountCents: input.amountCents ?? payment.amountCents,
                    isPartial: input.amountCents != null && input.amountCents < payment.amountCents,
                    reason: input.reason ?? null,
                },
            },
        });
        this.logger.log(`[Billing] Refunded payment ${payment.id} (${input.amountCents ?? 'full'} cents)`);

        return {
            providerPaymentId: payment.providerPaymentId,
            partialAmountCents: input.amountCents ?? null,
        };
    }

    // -------------------------------------------------------------------------
    // Plan override (super_admin — comp / gift)
    // -------------------------------------------------------------------------

    /**
     * Super-admin tool to grant a tenant a plan without charging. Useful for
     * comp accounts (employees, design partners, churned tenants we want
     * back). Updates the local subscription + tenant.plan but does NOT
     * touch the provider — the existing provider subscription (if any) keeps
     * running on its own schedule. We mark the subscription as 'comp' via
     * cancellationReason='comp:<reason>' for audit visibility.
     */
    async grantCompPlan(input: {
        tenantId: string;
        planSlug: string;
        durationDays: number;
        reason: string;
        actorUserId?: string;
    }): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId } });
        if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });
        const plan = await this.prisma.billingPlan.findUnique({ where: { slug: input.planSlug } });
        if (!plan) throw new NotFoundException({ error: 'plan_not_found', planSlug: input.planSlug });

        const now = new Date();
        const periodEnd = new Date(now.getTime() + input.durationDays * 86_400_000);

        const existing = await this.prisma.billingSubscription.findUnique({ where: { tenantId: input.tenantId } });
        if (existing) {
            await this.prisma.billingSubscription.update({
                where: { id: existing.id },
                data: {
                    planId: plan.id,
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: false,
                    cancelledAt: null,
                    cancellationReason: `comp: ${input.reason}`,
                },
            });
        } else {
            await this.prisma.billingSubscription.create({
                data: {
                    tenantId: input.tenantId,
                    planId: plan.id,
                    status: SubscriptionStatus.ACTIVE,
                    provider: 'mercadopago',
                    providerCustomerId: `comp_${input.tenantId}`,
                    providerSubscriptionId: null,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                    cancellationReason: `comp: ${input.reason}`,
                },
            });
        }

        await this.prisma.tenant.update({
            where: { id: input.tenantId },
            data: {
                plan: input.planSlug,
                subscriptionStatus: SubscriptionStatus.ACTIVE,
                currentPeriodEnd: periodEnd,
            },
        });
        await this.redis.del(`tenant_plan:${input.tenantId}`);
        await this.redis.del(`sub_status:${input.tenantId}`);

        await this.prisma.auditLog.create({
            data: {
                tenantId: input.tenantId,
                action: 'plan_comp_granted',
                resource: `tenants/${input.tenantId}`,
                userId: input.actorUserId,
                details: {
                    planSlug: input.planSlug,
                    durationDays: input.durationDays,
                    periodEnd: periodEnd.toISOString(),
                    reason: input.reason,
                },
            },
        });
        this.logger.log(`[Billing] Granted comp plan ${input.planSlug} to tenant ${input.tenantId} for ${input.durationDays}d`);
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
        let sub = event.providerSubscriptionId
            ? await this.prisma.billingSubscription.findUnique({ where: { providerSubscriptionId: event.providerSubscriptionId } })
            : null;
        const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
        if (!sub && event.tenantId && isUuid(event.tenantId)) {
            sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId: event.tenantId } });
        }
        if (!sub && event.payerEmail) {
            const tenant = await this.prisma.tenant.findFirst({ where: { billingEmail: event.payerEmail }, select: { id: true } });
            if (tenant) {
                sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId: tenant.id } });
            }
        }

        await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.billingEvent.create({
                data: {
                    tenantId: sub?.tenantId ?? (event.tenantId && isUuid(event.tenantId) ? event.tenantId : null),
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

        if (sub) {
            await this.redis.del(`tenant_plan:${sub.tenantId}`);
            await this.redis.del(`sub_status:${sub.tenantId}`);
        }

        // Re-emit via EventEmitter2 so rest of the platform (emails, analytics,
        // feature gates) can react without coupling to BillingService.
        this.eventEmitter.emit(event.type, {
            tenantId: sub?.tenantId ?? (event.tenantId && isUuid(event.tenantId) ? event.tenantId : undefined),
            subscriptionId: sub?.id,
            event,
        });

        this.logger.log(`[Billing] Processed ${event.type} for ${event.provider}/${event.providerEventId}`);
        return { processed: true };
    }

    // -------------------------------------------------------------------------
    // Grace period helpers
    // -------------------------------------------------------------------------

    async getRestrictionStatus(tenantId: string): Promise<{
        level: 'none' | 'warning' | 'soft_lock' | 'hard_lock';
        daysElapsed: number;
        daysRemaining: number;
        status: string;
    }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { subscriptionStatus: true },
        });
        const status = tenant?.subscriptionStatus ?? 'active';

        if (status === 'expired') {
            return { level: 'hard_lock', daysElapsed: 7, daysRemaining: 0, status };
        }
        if (status !== 'past_due') {
            return { level: 'none', daysElapsed: 0, daysRemaining: 7, status };
        }

        const pastDueSince = await this.redis.get(`offboard:past_due:${tenantId}`);
        if (!pastDueSince) {
            return { level: 'warning', daysElapsed: 0, daysRemaining: 7, status };
        }

        const daysElapsed = Math.floor((Date.now() - new Date(pastDueSince).getTime()) / 86_400_000);
        const daysRemaining = Math.max(0, 7 - daysElapsed);

        if (daysElapsed >= 7) {
            return { level: 'hard_lock', daysElapsed, daysRemaining: 0, status };
        }
        if (daysElapsed >= 3) {
            return { level: 'soft_lock', daysElapsed, daysRemaining, status };
        }
        return { level: 'warning', daysElapsed, daysRemaining, status };
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private async requireSubscription(tenantId: string) {
        const sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId } });
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found', tenantId });
        return sub;
    }

    /**
     * Resolve the provider-specific plan id to use for a given tenant.
     *
     * Lookup order (most specific first):
     *  1. `billing_plans.priceLocalOverrides[billingCountry].mpPlanId` — per-country
     *     id populated by scripts/sync-mp-plans.js. Essential when Parallly
     *     operates in multiple countries (AR/MX/BR/CL/PE/UY on top of CO).
     *  2. `billing_plans.mpPlanId` — legacy single-country fallback. Today
     *     this holds the Colombia id as a convenience.
     *
     * Stripe lookup stays simple because our Stripe rollout (Phase 4) will
     * use one plan per tier globally with Stripe-side currency handling.
     */
    private resolveProviderPlanId(
        plan: { mpPlanId: string | null; stripePlanId: string | null; priceLocalOverrides: any },
        providerName: PaymentProviderName,
        billingCountry?: string | null,
        cycle: BillingCycle = 'monthly',
    ): string {
        let id: string | null | undefined;
        if (providerName === 'mercadopago') {
            const overrides = (plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object') ? plan.priceLocalOverrides : {};
            const country = billingCountry?.toUpperCase();
            const countryOverride = country ? overrides[country] : undefined;
            if (cycle === 'annual') {
                // Fail closed: the annual preapproval_plan must exist explicitly.
                // Never fall back to the monthly id (plan.mpPlanId / overrides.mpPlanId)
                // for an annual subscription — that would silently charge the
                // MONTHLY amount on a yearly cadence.
                id = countryOverride?.annual?.mpPlanId;
            } else if (countryOverride?.mpPlanId) {
                id = countryOverride.mpPlanId;
            } else {
                id = plan.mpPlanId;
            }
        } else if (providerName === 'stripe') {
            id = plan.stripePlanId;
        } else {
            id = 'mock-plan';
        }

        if (!id) {
            throw new BadRequestException({
                error: 'provider_plan_not_configured',
                message: `This plan is not registered with ${providerName} for country ${billingCountry ?? '(default)'} (${cycle}) yet. Run the plan sync for that provider/country/cycle.`,
                providerName,
                billingCountry,
                cycle,
            });
        }
        return id;
    }

    /** Read the billing cycle a subscription runs on (persisted in metadata). Defaults to monthly. */
    private subscriptionCycle(sub: { metadata?: any } | null | undefined): BillingCycle {
        const raw = sub?.metadata && typeof sub.metadata === 'object' ? (sub.metadata as any).billingCycle : undefined;
        return raw === 'annual' ? 'annual' : 'monthly';
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
                if (currentStatus === SubscriptionStatus.TRIALING) {
                    return { status: SubscriptionStatus.PAST_DUE };
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
