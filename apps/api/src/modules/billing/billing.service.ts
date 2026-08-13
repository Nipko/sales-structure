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
import { SmsCreditsService } from '../sms-credits/sms-credits.service';
import {
    MERCADOPAGO_CURRENCY_BY_COUNTRY,
    hasBillingCurrency,
    normalizeBillingCountry,
} from './billing-country-config';
import { MercadoPagoConfigService } from './adapters/mercadopago-config.service';
import { INTERNAL_RECURRING_ENGINE_AVAILABLE, PaymentRoutingService } from './payment-routing.service';
import { ProviderCapabilities } from './adapters/provider-capabilities';
import { WompiConfigService } from './adapters/wompi-config.service';

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
        private readonly smsCredits: SmsCreditsService,
        private readonly mpConfig: MercadoPagoConfigService,
        private readonly routing: PaymentRoutingService,
        private readonly wompiConfig: WompiConfigService,
    ) {}

    /** Capabilities of the provider a subscription is bound to. Business logic branches on these, never on the name. */
    private capabilitiesFor(providerName: PaymentProviderName | string): ProviderCapabilities {
        return this.providerFactory.capabilitiesOf(providerName);
    }

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
        const normalizedInputCountry = normalizeBillingCountry(input.billingCountry);
        if (normalizedInputCountry && !hasBillingCurrency(normalizedInputCountry)) {
            throw new BadRequestException({
                error: 'invalid_billing_country',
                message: `Billing country ${normalizedInputCountry} has no charging currency configured.`,
            });
        }
        const storedCountry = normalizeBillingCountry(tenant.billingCountry);
        // 'CO' here is a LAST-RESORT FALLBACK, not a fact about the tenant. It is
        // reached when the stored country is missing (the column was added nullable
        // without backfill) or is recognized but has no charging currency. It gets
        // written back to `tenants.billing_country` below, which also decides which
        // fiscal document is issued — so a wrong fallback is not cosmetic. Logged
        // loudly instead of silently swallowed; behaviour is unchanged.
        const storedCountryUsable = !!storedCountry && hasBillingCurrency(storedCountry);
        if (!normalizedInputCountry && !storedCountryUsable) {
            this.logger.warn(
                `[Billing] Tenant ${tenant.id} has no usable billing country `
                + `(stored=${storedCountry ?? 'null'}) — falling back to 'CO' for charging and fiscal routing.`,
            );
        }
        const effectiveBillingCountry = normalizedInputCountry
            || (storedCountryUsable ? storedCountry! : 'CO');

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

        if (plan.slug === 'custom' || (plan.features as any)?.salesLed === true) {
            throw new BadRequestException({
                error: 'sales_led_plan_not_self_serve',
                message: 'This plan is managed by sales and cannot be started through self-service billing.',
            });
        }

        if (plan.requiresCardForTrial && plan.trialDays > 0) {
            throw new BadRequestException({
                error: 'card_trial_not_supported',
                message: 'Card-backed trials are not available until the provider-backed trial lifecycle can retain the payment method.',
            });
        }

        const requiresPaymentMethodAtSignup = plan.trialDays === 0 || plan.requiresCardForTrial;
        if (requiresPaymentMethodAtSignup && !input.cardTokenId) {
            throw new BadRequestException({
                error: 'card_required_for_trial',
                message: `The ${plan.slug} plan requires a payment method to start the trial.`,
            });
        }

        // Which provider bills this tenant is a runtime decision (kill switch →
        // country default → tenant override), not a hardcoded default. Changing
        // the operator for a country is a settings edit, not a deploy.
        const resolution = await this.routing.resolveForNewSubscription({
            tenantId: tenant.id,
            tenantProvider: tenant.paymentProvider,
            billingCountry: effectiveBillingCountry,
        });
        const providerName = resolution.provider;
        if (resolution.substituted) {
            this.logger.warn(
                `[Billing] Tenant ${tenant.id} (${effectiveBillingCountry}) routed to ${providerName} via ${resolution.level} — ${resolution.reason}`,
            );
        }
        this.assertProviderConfigured(providerName);
        const provider = this.providerFactory.getByName(providerName);

        // A local no-card trial may start before monthly provider synchronization,
        // but an annual selection promises a specific yearly amount/cadence and
        // must already have a verified provider cycle even while trialing.
        // Only meaningful for providers with a remote plan catalog: one billed by
        // our own engine has no id to verify — its frozen local amount IS the
        // contract, and demanding an id here would reject every annual signup.
        if (billingCycle === 'annual' && this.capabilitiesFor(providerName).planCatalog) {
            this.resolveProviderPlanId(
                plan,
                providerName,
                effectiveBillingCountry,
                billingCycle,
            );
        }

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
            await this.assertFiscalDataReady(tenant, effectiveBillingCountry);
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
                country: effectiveBillingCountry,
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
                  providerPlanId: this.resolveProviderPlanId(plan, providerName, effectiveBillingCountry, billingCycle),
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
                    billingCountry: effectiveBillingCountry,
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
        if (newPlan.slug === 'custom' || (newPlan.features as any)?.salesLed === true) {
            throw new BadRequestException({
                error: 'sales_led_plan_not_self_serve',
                message: 'This plan is managed by sales and cannot be selected through self-service billing.',
            });
        }

        const currentCycle = this.subscriptionCycle(sub);
        const targetCycle: BillingCycle = billingCycle ?? currentCycle;
        const sameTier = newPlan.id === sub.planId;
        const cycleChanged = targetCycle !== currentCycle;

        /**
         * Trial conversion: the tenant is on a local trial (or already fell to
         * past_due because it lapsed) with no provider subscription behind it,
         * and is now handing us a payment method. Same tier is the NORMAL case
         * here — "keep the plan I already have, start charging me".
         *
         * Without this, a tenant on a trial had no way to start paying: the same
         * plan was rejected as `same_plan`, and a different one was rejected as
         * `local_trial_plan_change_not_supported`. It simply lapsed.
         */
        const isTrialConversion = Boolean(
            cardTokenId
            && !sub.providerSubscriptionId
            && (sub.status === SubscriptionStatus.TRIALING || sub.status === SubscriptionStatus.PAST_DUE),
        );

        if (sameTier && !cycleChanged && !isTrialConversion) {
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
            return this.scheduleDowngrade(tenantId, sub.id, newPlan, currentCycle);
        }

        // Upgrade DURANTE un mes regalado por cupón. El tenant tiene un trial futuro
        // y todavía SIN preapproval (por eso el cupón se pudo canjear). Si creáramos
        // ahora la suscripción del proveedor, cobraría en el acto y se comería el
        // regalo. En su lugar acreditamos el tiempo: desbloqueamos las features del
        // plan nuevo YA, sin tocar al proveedor. El regalo sigue corriendo y el cobro
        // recién arranca cuando el trial vence — el mismo camino que cualquier trial,
        // así que es correcto sea cual sea la pasarela (no depende de un free_trial
        // nativo de MercadoPago). El tenant gana las features superiores durante lo
        // que le quedaba de regalo.
        const nowTs = new Date();
        if (!isTrialConversion && sub.trialEndsAt && sub.trialEndsAt > nowTs && !sub.providerSubscriptionId) {
            if (cardTokenId || newPlan.requiresCardForTrial || newPlan.trialDays === 0 || targetCycle === 'annual') {
                throw new BadRequestException({
                    error: 'local_trial_plan_change_not_supported',
                    message: 'A local trial cannot accept or retain a payment token during a plan/cycle change. Activate billing from the supported provider flow first.',
                });
            }
            await this.prisma.billingSubscription.update({
                where: { id: sub.id },
                data: {
                    planId: newPlan.id,
                    metadata: {
                        ...(sub.metadata && typeof sub.metadata === 'object' ? (sub.metadata as any) : {}),
                        billingCycle: targetCycle,
                    } as any,
                },
            });
            await this.prisma.tenant.update({
                where: { id: tenantId },
                data: { plan: newPlan.slug },
            });
            await this.redis.del(`tenant_plan:${tenantId}`);
            await this.redis.del(`sub_status:${tenantId}`);
            await this.redis.del(`plan_features:${tenantId}`);
            this.emit(BillingEventType.SUBSCRIPTION_PLAN_CHANGED, tenantId, sub.id, { fromPlan: sub.planId, toPlan: newPlan.id });
            this.logger.log(
                `[Billing] Tenant ${tenantId} upgraded to ${newPlan.slug} DURING a gifted trial — features unlocked now, billing deferred to trial end (${sub.trialEndsAt.toISOString()})`,
            );
            return { ...sub, planId: newPlan.id };
        }

        const providerName = this.routing.resolveForSubscription(sub.provider);
        const provider = this.providerFactory.getByName(providerName);
        const caps = this.capabilitiesFor(providerName);
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

        if (!caps.nativeSubscriptions) {
            // Providers without a subscription object (Wompi) are driven by our
            // own recurring engine: a plan change is a local recalculation plus a
            // prorated charge, never a remote subscription edit. The engine lands
            // in phase F2 — until then this path must refuse loudly rather than
            // pretend the change was applied.
            throw new BadRequestException({
                error: 'engine_plan_change_unavailable',
                message: 'Plan changes for this payment provider are handled by the internal billing engine, which is not enabled yet.',
                providerName,
            });
        }

        if (caps.changePlanInPlace) {
            // Stripe: swap the price on the live subscription, provider prorates.
            if (!sub.providerSubscriptionId) {
                throw new BadRequestException({ error: 'missing_provider_subscription', message: 'Subscription has no provider id — cannot upgrade via this provider.' });
            }
            const updated = await provider.changeSubscriptionPlan(sub.providerSubscriptionId, newProviderPlanId);
            updatedStatus = updated.status;
            currentPeriodStart = updated.currentPeriodStart || null;
            currentPeriodEnd = updated.currentPeriodEnd || null;
        } else {
            // MercadoPago: no in-place plan change — create the new subscription,
            // then cancel the old one.
            if (!cardTokenId) {
                throw new BadRequestException({ error: 'card_token_required_for_upgrade', message: 'A new payment method is required to change plans with this provider.' });
            }

            const payerEmail = tenant?.billingEmail;
            if (!payerEmail) {
                throw new BadRequestException({ error: 'payer_email_required', message: 'Tenant billingEmail is required to bill this subscription. Set it in tenant settings.' });
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

            // Cancel the old subscription. If this fails we must NOT keep the new
            // one: two live mandates would both charge the tenant every period and
            // our DB can only point at one of them. Compensate by cancelling the
            // subscription we just created and leave the tenant exactly as before.
            if (sub.providerSubscriptionId) {
                try {
                    await provider.cancelSubscription(sub.providerSubscriptionId, { immediate: true });
                } catch (cancelErr: any) {
                    this.logger.error(
                        `[Billing] Tenant ${tenantId}: failed to cancel previous subscription ${sub.providerSubscriptionId} after creating ${newProviderSub.providerSubscriptionId} — compensating`,
                    );
                    let compensated = false;
                    try {
                        await provider.cancelSubscription(newProviderSub.providerSubscriptionId, { immediate: true });
                        compensated = true;
                    } catch (compErr: any) {
                        this.logger.error(
                            `[Billing] Tenant ${tenantId}: COMPENSATION FAILED — subscriptions ${sub.providerSubscriptionId} and ${newProviderSub.providerSubscriptionId} may both be active at ${providerName}. Manual intervention required.`,
                        );
                    }
                    // Cancelling the new subscription stops FUTURE renewals; it
                    // does not reverse money already captured. Providers that
                    // charge on creation (MercadoPago authorizes and bills the
                    // first period immediately) leave a real charge behind, and
                    // its payment id only arrives later by webhook — so the
                    // refund cannot be issued here. Flag it for Billing Ops
                    // instead of telling the tenant there were no charges.
                    const chargeMayNeedRefund = !caps.changePlanInPlace;
                    await this.prisma.auditLog.create({
                        data: {
                            tenantId,
                            action: 'subscription_upgrade_rollback',
                            resource: `billing_subscriptions/${sub.id}`,
                            details: {
                                providerName,
                                oldProviderSubscriptionId: sub.providerSubscriptionId,
                                newProviderSubscriptionId: newProviderSub.providerSubscriptionId,
                                cancelError: String(cancelErr?.message ?? cancelErr),
                                compensated,
                                chargeMayNeedRefund,
                                actionRequired: chargeMayNeedRefund
                                    ? 'The new subscription may have captured its first charge. Reconcile it and refund from Billing Ops if a payment landed.'
                                    : undefined,
                            },
                        },
                    }).catch((auditErr: any) => {
                        this.logger.error(`[Billing] Failed to audit upgrade rollback for ${sub.id}: ${auditErr?.message}`);
                    });
                    throw new BadRequestException({
                        error: 'upgrade_rollback',
                        message: compensated
                            ? 'No pudimos completar el cambio de plan, así que lo revertimos: seguís en tu plan actual. Si llegó a generarse un cobro del plan nuevo, lo detectamos y te lo devolvemos. Podés intentar de nuevo en unos minutos.'
                            : 'No pudimos completar el cambio de plan y quedó una inconsistencia con la pasarela. Ya avisamos al equipo — no reintentes hasta que te confirmemos.',
                        compensated,
                    });
                }
            }

            updatedStatus = newProviderSub.status;
            currentPeriodStart = newProviderSub.currentPeriodStart || null;
            currentPeriodEnd = newProviderSub.currentPeriodEnd || null;
            newProviderSubscriptionId = newProviderSub.providerSubscriptionId;
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
     * Schedule a downgrade for the next billing cycle. Provider-backed
     * subscriptions must already have a synchronized target cycle; otherwise
     * accepting the pending change would guarantee a later billing/entitlement
     * mismatch. Local subscriptions can schedule without provider metadata.
     */
    private async scheduleDowngrade(
        tenantId: string,
        subscriptionId: string,
        targetPlan: {
            id: string;
            mpPlanId: string | null;
            stripePlanId: string | null;
            priceLocalOverrides: any;
        },
        cycle: BillingCycle = 'monthly',
    ) {
        const sub = await this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId } });
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found' });

        if (sub.providerSubscriptionId) {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { billingCountry: true },
            });
            if (!tenant) throw new NotFoundException({ error: 'tenant_not_found', tenantId });
            this.resolveProviderPlanId(
                targetPlan,
                sub.provider as PaymentProviderName,
                tenant.billingCountry,
                cycle,
            );
        }

        // Effective date: end of current period if present, otherwise fall back to
        // one cycle out (+365d for annual, +30d for monthly).
        const fallbackDays = cycle === 'annual' ? 365 : 30;
        const effectiveAt = sub.currentPeriodEnd
            ?? new Date(Date.now() + fallbackDays * 86_400_000);

        const updated = await this.prisma.billingSubscription.update({
            where: { id: subscriptionId },
            data: {
                pendingPlanId: targetPlan.id,
                pendingPlanChangeAt: effectiveAt,
            },
        });

        this.logger.log(`[Billing] Tenant ${tenantId} scheduled downgrade to plan ${targetPlan.id} effective ${effectiveAt.toISOString()}`);
        await this.prisma.auditLog.create({
            data: {
                tenantId,
                action: 'subscription_downgrade_scheduled',
                resource: `billing_subscriptions/${sub.id}`,
                details: {
                    fromPlanId: sub.planId,
                    toPlanId: targetPlan.id,
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
     * Cron-callable: apply all pending plan changes whose effective date has
     * passed. Provider-backed subscriptions are changed at the provider first;
     * local entitlements move only after provider confirmation. A failure leaves
     * the pending change intact for a safe retry.
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
            let phase: 'load' | 'provider' | 'local' = 'load';
            try {
                const newPlan = await this.prisma.billingPlan.findUnique({
                    where: { id: sub.pendingPlanId! },
                    select: { slug: true, mpPlanId: true, stripePlanId: true, priceLocalOverrides: true },
                });
                if (!newPlan) {
                    throw new NotFoundException({
                        error: 'pending_plan_not_found',
                        planId: sub.pendingPlanId,
                    });
                }

                const tenant = await this.prisma.tenant.findUnique({
                    where: { id: sub.tenantId },
                    select: { billingCountry: true },
                });
                if (!tenant) {
                    throw new NotFoundException({ error: 'tenant_not_found', tenantId: sub.tenantId });
                }

                // Providers driven by our own engine have nothing to push: the
                // scheduled plan simply becomes the amount the next charge uses.
                if (sub.providerSubscriptionId && this.capabilitiesFor(sub.provider).nativeSubscriptions) {
                    phase = 'provider';
                    await this.syncDowngradeToProvider(
                        sub,
                        newPlan,
                        tenant.billingCountry,
                        this.subscriptionCycle(sub),
                    );
                }

                phase = 'local';
                await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                    await tx.billingSubscription.update({
                        where: { id: sub.id },
                        data: {
                            planId: sub.pendingPlanId!,
                            pendingPlanId: null,
                            pendingPlanChangeAt: null,
                        },
                    });
                    await tx.tenant.update({
                        where: { id: sub.tenantId },
                        data: { plan: newPlan.slug },
                    });
                    await tx.auditLog.create({
                        data: {
                            tenantId: sub.tenantId,
                            action: 'subscription_downgrade_applied',
                            resource: `billing_subscriptions/${sub.id}`,
                            details: { fromPlanId: sub.planId, toPlanId: sub.pendingPlanId },
                        },
                    });
                });

                applied++;
                await Promise.allSettled([
                    this.redis.del(`tenant_plan:${sub.tenantId}`),
                    this.redis.del(`sub_status:${sub.tenantId}`),
                    this.redis.del(`plan_features:${sub.tenantId}`),
                ]);
                this.emit(BillingEventType.SUBSCRIPTION_PLAN_CHANGED, sub.tenantId, sub.id, {
                    fromPlan: sub.planId, toPlan: sub.pendingPlanId, scheduled: true,
                });
            } catch (e: any) {
                const errorMessage = e?.message || 'unknown error';
                this.logger.error(
                    `[Billing] Failed to apply pending change for ${sub.id} during ${phase}; pending change retained: ${errorMessage}`,
                );
                try {
                    await this.prisma.auditLog.create({
                        data: {
                            tenantId: sub.tenantId,
                            action: phase === 'provider'
                                ? 'subscription_downgrade_provider_sync_failed'
                                : 'subscription_downgrade_apply_failed',
                            resource: `billing_subscriptions/${sub.id}`,
                            details: {
                                fromPlanId: sub.planId,
                                toPlanId: sub.pendingPlanId,
                                provider: sub.provider,
                                cycle: this.subscriptionCycle(sub),
                                error: errorMessage,
                            },
                        },
                    });
                } catch (auditError: any) {
                    this.logger.error(
                        `[Billing] Failed to audit pending change failure for ${sub.id}: ${auditError?.message || 'unknown error'}`,
                    );
                }
            }
        }
        if (applied > 0) this.logger.log(`[Billing] Applied ${applied} pending plan changes`);
        return { applied };
    }

    /**
     * Resolve the same verified plan contract used by acquisition and push it to
     * the provider. Errors intentionally propagate so the caller can retain the
     * pending change and avoid lowering entitlements while the old price remains.
     */
    private async syncDowngradeToProvider(
        sub: { id: string; tenantId: string; provider: string; providerSubscriptionId: string | null },
        newPlan: { mpPlanId: string | null; stripePlanId: string | null; priceLocalOverrides: any },
        billingCountry: string | null,
        cycle: BillingCycle = 'monthly',
    ): Promise<void> {
        const providerName = sub.provider as PaymentProviderName;
        const providerPlanId = this.resolveProviderPlanId(
            newPlan,
            providerName,
            billingCountry,
            cycle,
        );
        const provider = this.providerFactory.getByName(providerName);
        await provider.changeSubscriptionPlan(sub.providerSubscriptionId!, providerPlanId);
        this.logger.log(`[Billing] Downgrade sub=${sub.id} confirmed by ${providerName} on plan ${providerPlanId}`);
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
    //
    // `applyFreeMonthsExtension` vivía acá y tenía tres defectos: pisaba el estado
    // a TRIALING sin mirar si el tenant ya pagaba (el cron de trial vencido lo
    // tiraba a past_due un mes después), contaba el mes como 30 días fijos, y no
    // avisaba al proveedor — con preapproval vivo en MercadoPago le seguían
    // cobrando durante el "regalo". Se movió a CouponsService.redeemForTenant(),
    // que aplica el efecto en la misma transacción que el canje y rechaza el
    // cupón si la suscripción tiene providerSubscriptionId.

    // -------------------------------------------------------------------------
    // Refund (super_admin only)
    // -------------------------------------------------------------------------

    /**
     * Devuelve un pago ya cobrado. El controller exige super_admin.
     *
     * ANTES esto no marcaba nada localmente: el docstring decía que el estado
     * 'refunded' "llega por el webhook del proveedor", y esa rama no existe —
     * `handleBillingEvent` sólo contempla PAYMENT_SUCCEEDED y PAYMENT_FAILED, y
     * en todo el API no hay un solo `billingPayment.update`. O sea que la guarda
     * de "ya reembolsado" era inalcanzable, el panel seguía mostrando el pago
     * como 'succeeded' con el botón activo, y cada clic volvía a llamar a
     * MercadoPago y a sacar plata de verdad hasta agotar el monto.
     *
     * Ahora se RESERVA antes de llamar al proveedor y se libera si el proveedor
     * falla. El orden importa: marcar después dejaría plata devuelta sin
     * registrar si el proceso muere en el medio, y marcar sin reservar no frena
     * el doble clic. PgBouncer está en modo transaction, así que no hay
     * transacción que abarque "llamar al proveedor + escribir": la atomicidad
     * que se puede tener es un UPDATE guardado cuyo conteo de filas se
     * inspecciona.
     *
     * El acumulado vive en `metadata.refundedAmountCents` para que los
     * reembolsos PARCIALES sigan siendo posibles (se puede devolver 30 y
     * después 20 de un pago de 50) pero nunca sumen más que el pago.
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

        const alreadyRefunded = Number((payment.metadata as any)?.refundedAmountCents ?? 0) || 0;
        const remaining = payment.amountCents - alreadyRefunded;
        if (remaining <= 0) {
            throw new BadRequestException({ error: 'already_refunded' });
        }
        const requested = input.amountCents ?? remaining;
        if (requested > remaining) {
            throw new BadRequestException({
                error: 'refund_exceeds_payment',
                paymentAmountCents: payment.amountCents,
                alreadyRefundedCents: alreadyRefunded,
                remainingCents: remaining,
                requestedAmountCents: requested,
            });
        }

        // Reserva optimista: sólo avanza si el acumulado sigue siendo el que
        // leímos. Dos clics simultáneos: uno actualiza 1 fila, el otro 0.
        const newTotal = alreadyRefunded + requested;
        const reserved: number = await this.prisma.$executeRawUnsafe(
            `UPDATE billing_payments
                SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{refundedAmountCents}', to_jsonb($2::int)),
                    status   = CASE WHEN $2::int >= amount_cents THEN 'refunded' ELSE status END
              WHERE id = $1
                AND status = 'succeeded'
                AND COALESCE((metadata->>'refundedAmountCents')::int, 0) = $3::int`,
            input.paymentId, newTotal, alreadyRefunded,
        );
        if (reserved !== 1) {
            // Otro reembolso entró primero. Mejor negarse que cobrarle de nuevo
            // al proveedor sobre una lectura vieja.
            throw new BadRequestException({ error: 'refund_conflict', message: 'El pago cambió mientras se procesaba el reembolso. Volvé a intentarlo.' });
        }

        const provider = this.providerFactory.getByName(payment.provider);
        try {
            await provider.refundPayment(payment.providerPaymentId, input.amountCents);
        } catch (e) {
            // El proveedor no devolvió la plata: liberar la reserva o el pago
            // quedaría bloqueado para siempre sin haberse reembolsado nunca.
            await this.prisma.$executeRawUnsafe(
                `UPDATE billing_payments
                    SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{refundedAmountCents}', to_jsonb($2::int)),
                        status   = 'succeeded'
                  WHERE id = $1`,
                input.paymentId, alreadyRefunded,
            ).catch(() => { /* si esto falla queda bloqueado, pero no se cobró de más */ });
            throw e;
        }

        await this.prisma.auditLog.create({
            data: {
                tenantId: payment.tenantId,
                action: 'payment_refunded',
                resource: `billing_payments/${payment.id}`,
                userId: input.actorUserId,
                details: {
                    providerPaymentId: payment.providerPaymentId,
                    fullAmountCents: payment.amountCents,
                    refundedAmountCents: requested,
                    // El acumulado, no sólo lo de esta vez: sin esto la auditoría
                    // de tres parciales no dice cuánto se devolvió en total.
                    totalRefundedAmountCents: newTotal,
                    isPartial: newTotal < payment.amountCents,
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
        if (!plan || !plan.isActive) throw new NotFoundException({ error: 'plan_not_found', planSlug: input.planSlug });

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
            // A comp subscription never reaches a provider (providerSubscriptionId
            // stays null), but the row still has to name one. Use whichever
            // operator currently serves the tenant's country so the record stays
            // consistent if the tenant later converts to a paid plan.
            // If no provider can serve this country the comp still has to be
            // granted (it never charges), but the row must not silently claim a
            // provider that cannot bill there — that would freeze the wrong
            // provider for a later conversion to paid. Record it and log.
            const compProvider = await this.routing
                .resolveForNewSubscription({
                    tenantId: input.tenantId,
                    tenantProvider: tenant.paymentProvider,
                    billingCountry: tenant.billingCountry,
                })
                .then((r) => r.provider)
                .catch((err: any) => {
                    this.logger.warn(
                        `[Billing] Comp plan for tenant ${input.tenantId} (${tenant.billingCountry ?? 'unknown country'}): no routable provider (${err?.response?.error ?? err?.message}). Recording 'mercadopago'; converting this tenant to paid will need an explicit provider.`,
                    );
                    return 'mercadopago' as PaymentProviderName;
                });
            await this.prisma.billingSubscription.create({
                data: {
                    tenantId: input.tenantId,
                    planId: plan.id,
                    status: SubscriptionStatus.ACTIVE,
                    provider: compProvider,
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
        await this.redis.del(`plan_features:${input.tenantId}`);

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

        // SMS credit package — a ONE-TIME payment whose external_reference is an
        // SmsPackageOrder id (a distinct UUID space from tenant ids). Intercept
        // before the subscription cascade: credit on success, claw back on refund.
        if (
            (event.type === BillingEventType.PAYMENT_SUCCEEDED || event.type === BillingEventType.PAYMENT_REFUNDED) &&
            event.tenantId && /^[0-9a-f-]{36}$/i.test(event.tenantId)
        ) {
            const order = await this.prisma.smsPackageOrder.findUnique({ where: { id: event.tenantId } });
            if (order) {
                return event.type === BillingEventType.PAYMENT_SUCCEEDED
                    ? this.creditSmsPackageOrder(order, event)
                    : this.reverseSmsPackageOrder(order, event);
            }
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

    /**
     * Credit a tenant's SMS balance from a paid one-time package order. Records
     * the billing event (idempotency), grants credits (idempotent by order id),
     * and marks the order paid. Safe against webhook redelivery.
     */
    private async creditSmsPackageOrder(
        order: {
            id: string; tenantId: string; credits: number; priceCents: number;
            currency: string; packageId: string; status: string; providerRef: string | null;
        },
        event: NormalizedBillingEvent,
    ): Promise<{ processed: boolean; reason?: string }> {
        // Record the event so any redelivery short-circuits at the duplicate check.
        await this.prisma.billingEvent
            .create({
                data: {
                    tenantId: order.tenantId,
                    provider: event.provider,
                    providerEventId: event.providerEventId,
                    eventType: event.type,
                    payload: event.rawPayload as any,
                },
            })
            .catch((e: any) => this.logger.warn(`[Billing][SMS] billing_event insert failed order=${order.id}: ${e.message}`));

        if (order.status === 'paid') {
            return { processed: false, reason: 'order_already_paid' };
        }

        // addCredits is idempotent by (reason='purchase', ref=order.id) → no double-credit.
        const balance = await this.smsCredits.addCredits(order.tenantId, order.credits, 'purchase', order.id, {
            packageId: order.packageId,
            paymentId: event.payment?.providerPaymentId,
            amountCents: order.priceCents,
            currency: order.currency,
        });

        await this.prisma.smsPackageOrder.update({
            where: { id: order.id },
            data: {
                status: 'paid',
                paidAt: event.payment?.paidAt ?? new Date(),
                providerRef: event.payment?.providerPaymentId ?? order.providerRef,
            },
        });

        this.eventEmitter.emit('sms.package.purchased', { tenantId: order.tenantId, credits: order.credits, orderId: order.id, balance });
        this.logger.log(`[Billing][SMS] Credited ${order.credits} SMS to tenant=${order.tenantId} (order=${order.id}, balance=${balance})`);
        return { processed: true };
    }

    /**
     * Reverse credits when a paid SMS package order is refunded/charged back.
     * Debits the granted credits, clamped to the tenant's remaining balance (can't
     * go negative if they already spent them). Idempotent via the order status.
     */
    private async reverseSmsPackageOrder(
        order: { id: string; tenantId: string; credits: number; status: string },
        event: NormalizedBillingEvent,
    ): Promise<{ processed: boolean; reason?: string }> {
        await this.prisma.billingEvent
            .create({
                data: {
                    tenantId: order.tenantId,
                    provider: event.provider,
                    providerEventId: event.providerEventId,
                    eventType: event.type,
                    payload: event.rawPayload as any,
                },
            })
            .catch((e: any) => this.logger.warn(`[Billing][SMS] refund billing_event insert failed order=${order.id}: ${e.message}`));

        if (order.status !== 'paid') {
            return { processed: false, reason: `order_not_reversible_${order.status}` };
        }

        const balance = await this.smsCredits.adjust(order.tenantId, -order.credits, `sms_refund:order:${order.id}`);
        await this.prisma.smsPackageOrder.update({ where: { id: order.id }, data: { status: 'refunded' } });

        this.logger.log(`[Billing][SMS] Reversed up to ${order.credits} SMS for refunded order=${order.id} tenant=${order.tenantId} (balance=${balance})`);
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
     * Mercado Pago ids are usable only with a matching server-owned
     * amount/currency fingerprint. Historical ids and the legacy top-level CO
     * column are not sufficient proof that the frozen provider amount matches
     * the live catalog.
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
            this.assertProviderConfigured(providerName);
            const overrides = (plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object') ? plan.priceLocalOverrides : {};
            const country = normalizeBillingCountry(billingCountry) || 'CO';
            const countryEntry = Object.entries(overrides).find(([key]) =>
                normalizeBillingCountry(key) === country)?.[1] as any;
            const cycleEntry = cycle === 'annual' ? countryEntry?.annual : countryEntry;
            const expectedCurrency = MERCADOPAGO_CURRENCY_BY_COUNTRY[
                country as keyof typeof MERCADOPAGO_CURRENCY_BY_COUNTRY
            ];
            const configuredCurrency = typeof cycleEntry?.currency === 'string'
                ? cycleEntry.currency.trim().toUpperCase()
                : '';
            const fingerprintCurrency = typeof cycleEntry?.syncedCurrency === 'string'
                ? cycleEntry.syncedCurrency.trim().toUpperCase()
                : '';
            const fingerprintMatches = expectedCurrency
                && configuredCurrency === expectedCurrency
                && Number.isSafeInteger(cycleEntry?.amountCents)
                && cycleEntry.amountCents > 0
                && cycleEntry.syncedAmountCents === cycleEntry.amountCents
                && fingerprintCurrency === configuredCurrency;

            if (fingerprintMatches && typeof cycleEntry?.mpPlanId === 'string' && cycleEntry.mpPlanId.trim()) {
                id = cycleEntry.mpPlanId.trim();
            } else {
                throw new BadRequestException({
                    error: 'provider_plan_not_synchronized',
                    message: `This plan is not synchronized with ${providerName} for country ${country} (${cycle}) at the configured amount and currency.`,
                    providerName,
                    billingCountry: country,
                    cycle,
                });
            }
        } else if (providerName === 'stripe') {
            id = plan.stripePlanId;
        } else if (providerName === 'mock') {
            id = 'mock-plan';
        } else {
            // No silent fallback. A provider without a remote plan catalog (Wompi)
            // has no id to bind — its price is frozen locally and the recurring
            // engine charges that amount. Returning a placeholder here would
            // create subscriptions pointing at a plan that does not exist.
            const caps = this.capabilitiesFor(providerName);
            throw new BadRequestException({
                error: caps.planCatalog ? 'provider_plan_not_configured' : 'provider_has_no_plan_catalog',
                message: caps.planCatalog
                    ? `This plan is not registered with ${providerName} yet.`
                    : `${providerName} has no remote plan catalog — resolve the frozen local price instead of a provider plan id.`,
                providerName,
                billingCountry,
                cycle,
            });
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

    /**
     * Keep the executable billing contract aligned with the catalog. A stored
     * provider id/fingerprint is not actionable when the application has no
     * initialized provider client, including local no-card trial acquisition.
     */
    private assertProviderConfigured(providerName: PaymentProviderName): void {
        // 'mock' bypasses signature verification entirely — routing to it in
        // production would hand out paid plans for free.
        if (providerName === 'mock' && process.env.NODE_ENV === 'production') {
            throw new BadRequestException({
                error: 'provider_not_configured',
                message: 'The mock payment provider cannot be used in production.',
                providerName,
            });
        }
        if (providerName === 'mercadopago' && !this.mpConfig.isConfigured()) {
            throw new BadRequestException({
                error: 'provider_not_configured',
                message: 'Mercado Pago is not configured for self-service acquisition.',
                providerName,
            });
        }
        if (providerName === 'wompi' && !this.wompiConfig.isConfigured()) {
            throw new BadRequestException({
                error: 'provider_not_configured',
                message: 'Wompi is not configured for self-service acquisition.',
                providerName,
            });
        }
        // A provider that can only bill through the internal recurring engine
        // must not take acquisitions before that engine exists: the trial would
        // start and then no path to pay would work.
        if (!this.capabilitiesFor(providerName).nativeSubscriptions && !INTERNAL_RECURRING_ENGINE_AVAILABLE) {
            throw new BadRequestException({
                error: 'recurring_engine_unavailable',
                message: `${providerName} can only bill through the internal recurring engine, which is not available yet.`,
                providerName,
            });
        }
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
