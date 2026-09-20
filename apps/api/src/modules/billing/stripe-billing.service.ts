import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StripeConfigService } from './adapters/stripe-config.service';
import { StripeAdapter } from './adapters/stripe.adapter';
import { resolveStripePlanPrice } from './stripe-plan-price.util';
import { BillingCycle, CancelSubscriptionOptions, NormalizedBillingEvent } from './types/provider-types';
import { BillingEventType } from './types/billing-event.enum';
import { PaymentRoutingService } from './payment-routing.service';

/** Stripe owns its calendar and payment methods. None of these operations arm the Wompi engine. */
@Injectable()
export class StripeBillingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly config: StripeConfigService,
        private readonly adapter: StripeAdapter,
        private readonly events: EventEmitter2,
        private readonly routing: PaymentRoutingService,
    ) {}

    private get stripe(): any { return this.config.client; }

    private assertConfigured(): void {
        if (!this.config.isConfigured) throw new ServiceUnavailableException({ error: 'provider_not_configured', providerName: 'stripe' });
    }

    private async subscription(tenantId: string) {
        const sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId }, include: { tenant: true, plan: true } });
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found' });
        if (sub.provider !== 'stripe' || sub.engine === 'internal') {
            throw new BadRequestException({ error: 'stripe_subscription_required' });
        }
        return sub;
    }

    private async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const key = `lock:billing:stripe:${id}`;
        const token = await this.redis.acquireLockToken(key, 120);
        if (!token) throw new ConflictException({ error: 'billing_operation_in_progress' });
        try { return await fn(); }
        finally { await this.redis.releaseLockToken(key, token).catch(() => undefined); }
    }

    async createCheckout(tenantId: string, input: { planSlug?: string; billingCycle?: BillingCycle } = {}) {
        this.assertConfigured();
        const initial = await this.subscription(tenantId);
        return this.locked(initial.id, async () => {
            const sub = await this.subscription(tenantId);
            if (sub.providerSubscriptionId) throw new ConflictException({ error: 'stripe_subscription_already_exists' });
            if (sub.status === 'cancelled' || sub.cancelAtPeriodEnd || sub.cancellationReason?.startsWith('comp:')) {
                throw new BadRequestException({ error: 'subscription_terminal' });
            }
            const metadata: any = sub.metadata ?? {};
            const country = metadata.billingCountry ?? sub.tenant.billingCountry;
            await this.routing.assertUsableForNewSubscription('stripe', country);
            const cycle = input.billingCycle ?? (metadata.billingCycle === 'annual' ? 'annual' : 'monthly');
            const plan = input.planSlug
                ? await this.prisma.billingPlan.findUnique({ where: { slug: input.planSlug } })
                : sub.plan;
            if (!plan || !plan.isActive || plan.slug === 'custom' || (plan.features as any)?.salesLed) {
                throw new BadRequestException({ error: 'plan_not_available' });
            }
            const price = resolveStripePlanPrice(plan, country, cycle);
            if (!price) throw new BadRequestException({ error: 'stripe_price_not_configured' });
            // A durable attempt is saved BEFORE the remote POST. Retries recover
            // the same session with exactly the same idempotency key and inputs.
            let checkout = metadata.stripeCheckout;
            if (checkout) {
                let session: any;
                try {
                    session = checkout.sessionId
                        ? await this.stripe.checkout.sessions.retrieve(checkout.sessionId)
                        : await this.stripe.checkout.sessions.create(checkout.params, { idempotencyKey: checkout.id });
                } catch (error: any) {
                    // Only a definitive validation refusal of the ORIGINAL
                    // expires_at allows replacing an attempt without a session
                    // id. Network errors remain indeterminate and retryable.
                    if (!checkout.sessionId && checkout.params?.expires_at < Date.now() / 1000
                        && error.type === 'StripeInvalidRequestError' && error.param === 'expires_at') session = { status: 'expired' };
                    else throw error;
                }
                if (session.status === 'complete') throw new ConflictException({ error: 'stripe_checkout_processing' });
                const same = checkout.planId === plan.id && checkout.cycle === cycle
                    && checkout.amountCents === price.amountCents && checkout.country === country;
                if (session.status === 'open' && same && session.url) return { url: session.url };
                if (session.status === 'open') await this.stripe.checkout.sessions.expire(session.id);
            }
            let customerId = sub.providerCustomerId;
            if (!customerId) {
                const customer = await this.stripe.customers.create({
                    email: sub.tenant.billingEmail || undefined,
                    name: sub.tenant.name,
                    address: { country },
                    metadata: { tenantId, localSubscriptionId: sub.id },
                }, { idempotencyKey: `parallly:customer:${sub.id}` });
                customerId = customer.id;
                await this.prisma.billingSubscription.update({ where: { id: sub.id }, data: { providerCustomerId: customerId } });
                await this.prisma.tenant.update({ where: { id: tenantId }, data: { paymentProviderCustomerId: customerId } });
            }
            const attemptId = randomUUID();
            const binding = { tenantId, localSubscriptionId: sub.id, checkoutAttemptId: attemptId, planId: plan.id, billingCycle: cycle, billingCountry: country };
            const now = Math.floor(Date.now() / 1000);
            const trialEnd = sub.trialEndsAt ? Math.floor(sub.trialEndsAt.getTime() / 1000) : 0;
            // Checkout requires trial_end at least 48 hours ahead. Keep the
            // existing promise by refusing early conversion in the final 48h;
            // the customer can complete Checkout when the local trial expires.
            if (trialEnd > now && trialEnd < now + 172_860) {
                throw new BadRequestException({ error: 'stripe_trial_ending_soon', trialEndsAt: sub.trialEndsAt });
            }
            const pendingTrialDays = !sub.trialStartedAt && sub.status === 'pending_auth'
                ? Math.min(Number(metadata.trialDaysPending ?? 0), plan.trialDays)
                : 0;
            if (pendingTrialDays > 0 && pendingTrialDays < 2) throw new BadRequestException({ error: 'stripe_trial_duration_unsupported' });
            const subscriptionData = {
                metadata: binding,
                ...(trialEnd > now ? { trial_end: trialEnd } : pendingTrialDays >= 2 ? { trial_period_days: pendingTrialDays } : {}),
                trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            };
            const params = {
                mode: 'subscription',
                customer: customerId,
                client_reference_id: sub.id,
                payment_method_types: ['card'],
                payment_method_collection: 'always',
                billing_address_collection: 'required',
                customer_update: { address: 'auto', name: 'auto' },
                adaptive_pricing: { enabled: false },
                line_items: [{ quantity: 1, price_data: {
                    currency: 'usd', unit_amount: price.amountCents,
                    recurring: { interval: cycle === 'annual' ? 'year' : 'month' },
                    product_data: { name: plan.name, metadata: { planId: plan.id } },
                } }],
                metadata: binding,
                subscription_data: subscriptionData,
                success_url: `${this.config.dashboardUrl}?stripe=success`,
                cancel_url: `${this.config.dashboardUrl}?stripe=cancel`,
                expires_at: now + 1800,
            };
            checkout = { id: attemptId, planId: plan.id, cycle, country, amountCents: price.amountCents, currency: 'USD', params };
            await this.prisma.billingSubscription.update({ where: { id: sub.id }, data: { metadata: { ...metadata, billingCountry: country, stripeCheckout: checkout } } });
            const session = await this.stripe.checkout.sessions.create(params, { idempotencyKey: attemptId });
            await this.prisma.billingSubscription.update({ where: { id: sub.id }, data: { metadata: { ...metadata, billingCountry: country, stripeCheckout: { ...checkout, sessionId: session.id } } } });
            if (!session.url) throw new ServiceUnavailableException({ error: 'stripe_checkout_unavailable' });
            return { url: session.url };
        });
    }

    async createPortal(tenantId: string) {
        this.assertConfigured();
        const sub = await this.subscription(tenantId);
        if (!sub.providerSubscriptionId || !sub.providerCustomerId) throw new BadRequestException({ error: 'missing_provider_subscription' });
        // An account's default portal may expose arbitrary products. Use our
        // restricted configuration so catalog changes stay tenant-authorized.
        const configuration = await this.stripe.billingPortal.configurations.create({
            business_profile: { headline: 'Parallly' },
            features: {
                payment_method_update: { enabled: true },
                invoice_history: { enabled: true },
                subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
                subscription_update: { enabled: false },
                customer_update: { enabled: false },
            },
        }, { idempotencyKey: 'parallly:portal:payment-cancel:v1' });
        const session = await this.stripe.billingPortal.sessions.create({
            customer: sub.providerCustomerId, configuration: configuration.id, return_url: this.config.dashboardUrl,
        });
        return { url: session.url };
    }

    private async priceFor(plan: any, country: string, cycle: BillingCycle) {
        const price = resolveStripePlanPrice(plan, country, cycle);
        if (!price) throw new BadRequestException({ error: 'stripe_price_not_configured' });
        const fingerprint = createHash('sha256').update(JSON.stringify([plan.id, plan.name, price.amountCents, cycle])).digest('hex');
        const remote = await this.stripe.prices.create({
            currency: 'usd', unit_amount: price.amountCents,
            recurring: { interval: cycle === 'annual' ? 'year' : 'month' },
            product_data: { name: plan.name, metadata: { planId: plan.id } },
            metadata: { planId: plan.id, billingCycle: cycle },
        }, { idempotencyKey: `parallly:price:${fingerprint}` });
        return { priceId: remote.id, planId: plan.id, cycle, country, ...price };
    }

    async changePlan(tenantId: string, planSlug: string, cycle?: BillingCycle) {
        this.assertConfigured();
        const initial = await this.subscription(tenantId);
        return this.locked(initial.id, async () => {
            const sub = await this.subscription(tenantId);
            if (!sub.providerSubscriptionId) throw new BadRequestException({ error: 'stripe_checkout_required' });
            if (['cancelled', 'expired', 'pending_auth'].includes(sub.status) || sub.cancelAtPeriodEnd) throw new BadRequestException({ error: 'subscription_terminal' });
            if (sub.pendingPlanId) throw new ConflictException({ error: 'plan_change_in_progress' });
            const plan = await this.prisma.billingPlan.findUnique({ where: { slug: planSlug } });
            if (!plan || !plan.isActive || plan.slug === 'custom' || (plan.features as any)?.salesLed) throw new BadRequestException({ error: 'plan_not_available' });
            const metadata: any = sub.metadata ?? {};
            const currentCycle = metadata.billingCycle === 'annual' ? 'annual' : 'monthly';
            const targetCycle = cycle ?? currentCycle;
            if (sub.planId === plan.id && currentCycle === targetCycle) throw new BadRequestException({ error: 'same_plan' });
            const contract = await this.priceFor(plan, metadata.billingCountry ?? sub.tenant.billingCountry, targetCycle);
            const remote = await this.stripe.subscriptions.retrieve(sub.providerSubscriptionId);
            const item = remote.items?.data?.[0];
            if (!item || remote.items.data.length !== 1) throw new BadRequestException({ error: 'stripe_subscription_items_invalid' });
            if (remote.schedule) {
                const scheduleId = typeof remote.schedule === 'string' ? remote.schedule : remote.schedule.id;
                if (scheduleId !== metadata.stripeScheduleId) throw new ConflictException({ error: 'stripe_schedule_unmanaged' });
                await this.stripe.subscriptionSchedules.release(scheduleId);
                delete metadata.stripeScheduleId;
            }
            // Persist the exact authorized new price before the provider can
            // emit an event for it; arbitrary dashboard/account prices cannot
            // grant another plan through a metadata-only webhook.
            await this.prisma.billingSubscription.update({ where: { id: sub.id }, data: { metadata: { ...metadata, stripePendingPlan: contract } } });
            const downgrade = plan.priceUsdCents < sub.plan.priceUsdCents && currentCycle === targetCycle;
            if (downgrade) {
                const schedule = await this.stripe.subscriptionSchedules.create({ from_subscription: remote.id }, { idempotencyKey: `parallly:schedule:${sub.id}:${contract.priceId}:${item.current_period_end ?? remote.current_period_end}` });
                await this.stripe.subscriptionSchedules.update(schedule.id, {
                    end_behavior: 'release', proration_behavior: 'none',
                    phases: [
                        { start_date: item.current_period_start ?? remote.current_period_start, end_date: item.current_period_end ?? remote.current_period_end, items: [{ price: item.price.id, quantity: 1 }], proration_behavior: 'none', ...(remote.status === 'trialing' ? { trial: true } : {}) },
                        { items: [{ price: contract.priceId, quantity: 1 }], duration: { interval: targetCycle === 'annual' ? 'year' : 'month', interval_count: 1 }, proration_behavior: 'none' },
                    ],
                });
                const effectiveAt = new Date((item.current_period_end ?? remote.current_period_end) * 1000);
                await this.prisma.billingSubscription.update({ where: { id: sub.id }, data: {
                    pendingPlanId: plan.id, pendingPlanChangeAt: effectiveAt,
                    metadata: { ...metadata, stripePendingPlan: contract, stripeScheduleId: schedule.id },
                } });
                return { ...sub, scheduled: true, effectiveAt: effectiveAt.toISOString() };
            }
            const changed = await this.adapter.changeSubscriptionPlan(remote.id, contract.priceId);
            // Canonical webhook/sync owns entitlements; the successful provider
            // response alone cannot bypass the same binding validation.
            return { ...sub, status: changed.status, stripeSyncRequired: true };
        }).then(async result => {
            if ((result as any).stripeSyncRequired) await this.sync(tenantId);
            return result;
        });
    }

    async cancelPendingDowngrade(tenantId: string): Promise<void> {
        const initial = await this.subscription(tenantId);
        await this.locked(initial.id, async () => {
            const sub = await this.subscription(tenantId);
            const metadata: any = sub.metadata ?? {};
            if (!sub.pendingPlanId || !metadata.stripeScheduleId) throw new BadRequestException({ error: 'no_pending_change' });
            await this.stripe.subscriptionSchedules.release(metadata.stripeScheduleId);
            delete metadata.stripeScheduleId;
            delete metadata.stripePendingPlan;
            await this.prisma.billingSubscription.update({ where: { id: sub.id }, data: { pendingPlanId: null, pendingPlanChangeAt: null, metadata } });
        });
    }

    async cancel(tenantId: string, opts: CancelSubscriptionOptions = {}) {
        const initial = await this.subscription(tenantId);
        let native = false;
        await this.locked(initial.id, async () => {
            const sub = await this.subscription(tenantId);
            const metadata: any = { ...(sub.metadata as any) };
            const checkout = metadata.stripeCheckout;
            if (checkout && !sub.providerSubscriptionId) {
                let session: any;
                try {
                    session = checkout.sessionId
                        ? await this.stripe.checkout.sessions.retrieve(checkout.sessionId)
                        : await this.stripe.checkout.sessions.create(checkout.params, { idempotencyKey: checkout.id });
                } catch (error: any) {
                    if (!checkout.sessionId && checkout.params?.expires_at < Date.now() / 1000
                        && error.type === 'StripeInvalidRequestError' && error.param === 'expires_at') session = { status: 'expired' };
                    else throw error;
                }
                if (session.status === 'complete') throw new ConflictException({ error: 'stripe_checkout_processing' });
                if (session.status === 'open') await this.stripe.checkout.sessions.expire(session.id);
                delete metadata.stripeCheckout;
            }
            if (sub.providerSubscriptionId) {
                native = true;
                const remote = await this.stripe.subscriptions.retrieve(sub.providerSubscriptionId);
                if (remote.status !== 'canceled') {
                    if (remote.schedule && metadata.stripeScheduleId) {
                        await this.stripe.subscriptionSchedules.release(metadata.stripeScheduleId);
                    }
                    await this.adapter.cancelSubscription(sub.providerSubscriptionId, opts);
                }
                if (metadata.stripeScheduleId) {
                    delete metadata.stripeScheduleId;
                }
            }
            delete metadata.stripePendingPlan;
            await this.prisma.billingSubscription.update({ where: { id: sub.id }, data: {
                ...(opts.immediate ? { status: 'cancelled', cancelledAt: new Date() } : {}),
                cancelAtPeriodEnd: !opts.immediate, cancellationReason: opts.reason ?? null,
                pendingPlanId: null, pendingPlanChangeAt: null, metadata,
            } });
            if (opts.immediate) await this.prisma.tenant.update({ where: { id: tenantId }, data: { subscriptionStatus: 'cancelled' } });
            await Promise.all(['tenant_plan', 'sub_status', 'plan_features'].map(prefix => this.redis.del(`${prefix}:${tenantId}`)));
        });
        if (native) await this.sync(tenantId);
        this.events.emit(BillingEventType.SUBSCRIPTION_CANCELLED, { tenantId, subscriptionId: initial.id });
        return { strandedMandate: null };
    }

    async sync(tenantId: string) {
        const sub = await this.subscription(tenantId);
        if (!sub.providerSubscriptionId) throw new BadRequestException({ error: 'missing_provider_subscription' });
        const result = await this.handleEvent({
            provider: 'stripe', providerEventId: `recon_stripe_${randomUUID()}`,
            providerSubscriptionId: sub.providerSubscriptionId, type: BillingEventType.SUBSCRIPTION_PLAN_CHANGED,
            occurredAt: new Date(), rawPayload: { source: 'reconciliation' },
        });
        const updated = await this.subscription(tenantId);
        return { status: updated.status, updated: result.processed };
    }

    async handleEvent(event: NormalizedBillingEvent): Promise<{ processed: boolean; reason?: string }> {
        const duplicate = await this.prisma.billingEvent.findUnique({ where: { provider_providerEventId: { provider: 'stripe', providerEventId: event.providerEventId } } });
        if (duplicate) return { processed: false, reason: 'duplicate' };
        let sub = event.providerSubscriptionId
            ? await this.prisma.billingSubscription.findUnique({ where: { providerSubscriptionId: event.providerSubscriptionId } })
            : null;
        if (!sub && event.type === BillingEventType.PAYMENT_REFUNDED && event.providerPaymentId) {
            const payment = await this.prisma.billingPayment.findFirst({ where: { provider: 'stripe', providerPaymentId: event.providerPaymentId } });
            if (payment) sub = await this.prisma.billingSubscription.findUnique({ where: { id: payment.subscriptionId } });
        }
        // First events may precede checkout.session.completed. The canonical
        // subscription metadata binds to a durable, authorized local attempt.
        let candidate: any;
        if (!sub && event.providerSubscriptionId) {
            candidate = await this.stripe.subscriptions.retrieve(event.providerSubscriptionId);
            const localId = candidate.metadata?.localSubscriptionId;
            if (/^[0-9a-f-]{36}$/i.test(localId ?? '')) sub = await this.prisma.billingSubscription.findUnique({ where: { id: localId } });
        }
        if (!sub || sub.provider !== 'stripe' || sub.engine === 'internal') return this.ignore(event, 'unmatched_stripe_subscription');
        const subId = sub.id;
        return this.locked(subId, async () => {
            const current = await this.prisma.billingSubscription.findUnique({ where: { id: subId } });
            if (!current || current.provider !== 'stripe' || current.engine === 'internal' || current.cancellationReason?.startsWith('comp:')) return this.ignore(event, 'unmatched_stripe_subscription');
            const remoteId = event.providerSubscriptionId ?? current.providerSubscriptionId;
            if (!remoteId || (current.providerSubscriptionId && current.providerSubscriptionId !== remoteId)) return this.ignore(event, 'stripe_subscription_mismatch');
            // Fetch after taking the per-subscription lock. Old, reordered
            // webhook snapshots cannot roll back a renewed/cancelled subscription.
            const remote = await this.stripe.subscriptions.retrieve(remoteId);
            const customerId = typeof remote.customer === 'string' ? remote.customer : remote.customer?.id;
            const metadata: any = current.metadata ?? {};
            if (customerId !== current.providerCustomerId || (remote.metadata?.tenantId && remote.metadata.tenantId !== current.tenantId)) return this.ignore(event, 'stripe_customer_mismatch');
            const firstBind = !current.providerSubscriptionId;
            const checkout = metadata.stripeCheckout;
            if (firstBind && (current.status === 'cancelled' || current.cancelAtPeriodEnd || !checkout || remote.metadata?.checkoutAttemptId !== checkout.id || remote.metadata?.localSubscriptionId !== current.id)) return this.ignore(event, 'stripe_checkout_mismatch');
            const item = remote.items?.data?.[0];
            if (!item || remote.items.data.length !== 1 || item.quantity !== 1) return this.ignore(event, 'stripe_subscription_items_invalid');
            const matches = (c: any) => c && (!c.priceId || c.priceId === item.price.id)
                && item.price.currency?.toUpperCase() === c.currency
                && item.price.unit_amount === c.amountCents
                && item.price.recurring?.interval === (c.cycle === 'annual' ? 'year' : 'month')
                && (item.price.recurring?.interval_count ?? 1) === 1;
            const contract = [metadata.stripePendingPlan, metadata.stripeContract, firstBind ? checkout : null].find(matches);
            if (!contract) return this.ignore(event, 'stripe_price_mismatch');
            const plan = await this.prisma.billingPlan.findUnique({ where: { id: contract.planId } });
            if (!plan) return this.ignore(event, 'stripe_plan_missing');
            const mapped = this.adapter.mapSubscription(remote);
            const nextMetadata = { ...metadata, billingCycle: contract.cycle, billingCountry: contract.country, stripeContract: {
                planId: plan.id, priceId: item.price.id, cycle: contract.cycle, country: contract.country,
                amountCents: contract.amountCents, currency: contract.currency,
            } };
            const pendingApplied = metadata.stripePendingPlan?.priceId === item.price.id;
            if (pendingApplied) delete nextMetadata.stripePendingPlan;
            delete nextMetadata.stripeCheckout;
            delete nextMetadata.trialDaysPending;
            const payment = event.payment;
            let paymentChanged = false;
            const tenant = await this.prisma.tenant.findUnique({ where: { id: current.tenantId }, select: { isInternal: true } });
            const result = await this.prisma.$transaction(async tx => {
                await tx.$queryRawUnsafe('SELECT id FROM billing_subscriptions WHERE id = $1::uuid FOR UPDATE', current.id);
                const locked = await tx.billingSubscription.findUnique({ where: { id: current.id } });
                if (!locked || locked.provider !== current.provider || locked.providerSubscriptionId !== current.providerSubscriptionId
                    || locked.providerCustomerId !== current.providerCustomerId || locked.cancellationReason !== current.cancellationReason
                    || locked.engine !== current.engine || locked.status !== current.status || locked.cancelAtPeriodEnd !== current.cancelAtPeriodEnd
                    || JSON.stringify(locked.metadata) !== JSON.stringify(current.metadata)) {
                    throw new ConflictException({ error: 'stripe_subscription_changed_retry' });
                }
                const already = await tx.billingEvent.findUnique({ where: { provider_providerEventId: { provider: 'stripe', providerEventId: event.providerEventId } } });
                if (already) return { processed: false, reason: 'duplicate' };
                const prior = payment && event.providerPaymentId
                    ? await tx.billingPayment.findFirst({ where: { provider: 'stripe', providerPaymentId: event.providerPaymentId } })
                    : null;
                if (event.type === BillingEventType.PAYMENT_REFUNDED && !prior) {
                    throw new ServiceUnavailableException({ error: 'stripe_refund_payment_pending' });
                }
                const redundantPayment = payment && prior && event.type !== BillingEventType.PAYMENT_REFUNDED
                    && !(prior.status === 'failed' && payment.status === 'succeeded');
                await tx.billingEvent.create({ data: { tenantId: current.tenantId, subscriptionId: current.id, provider: 'stripe', providerEventId: event.providerEventId,
                    eventType: redundantPayment ? `${event.type}.ignored` : event.type, payload: event.rawPayload as any } });
                await tx.billingSubscription.update({ where: { id: current.id }, data: {
                    providerSubscriptionId: remote.id, status: mapped.status, engine: 'provider', nextChargeAt: null,
                    chargeAmountCents: contract.amountCents, chargeCurrency: contract.currency,
                    planId: plan.id, currentPeriodStart: mapped.currentPeriodStart, currentPeriodEnd: mapped.currentPeriodEnd,
                    cancelAtPeriodEnd: mapped.cancelAtPeriodEnd, cancelledAt: mapped.status === 'cancelled' ? new Date() : null,
                    ...(['active', 'trialing'].includes(mapped.status) ? { dunningState: 'none', dunningStartedAt: null, dunningAttempts: 0 }
                        : mapped.status === 'past_due' ? { dunningState: 'retrying', dunningStartedAt: current.dunningStartedAt ?? new Date() } : {}),
                    trialStartedAt: current.trialStartedAt ?? (mapped.status === 'trialing' ? new Date() : null),
                    trialEndsAt: mapped.trialEndsAt ?? current.trialEndsAt,
                    ...(pendingApplied ? { pendingPlanId: null, pendingPlanChangeAt: null } : {}), metadata: nextMetadata,
                } });
                await tx.tenant.update({ where: { id: current.tenantId }, data: {
                    subscriptionStatus: mapped.status, currentPeriodEnd: mapped.currentPeriodEnd,
                    trialEndsAt: mapped.trialEndsAt ?? current.trialEndsAt,
                    ...(['active', 'trialing'].includes(mapped.status) ? { plan: plan.slug } : {}),
                } });
                if (payment && event.providerPaymentId) {
                    const env = (event.rawPayload as any)?.livemode ?? remote.livemode;
                    const invoice = (event.rawPayload as any)?.data?.object;
                    const recurringLine = invoice?.object === 'invoice' ? invoice.lines?.data?.find((line: any) => {
                        const details = line.parent?.subscription_item_details;
                        const lineSub = details?.subscription ?? line.subscription;
                        return !details?.proration && !line.proration
                            && (!lineSub || (typeof lineSub === 'string' ? lineSub : lineSub.id) === remote.id)
                            && (line.type === 'subscription' || details);
                    }) : undefined;
                    const stamp = { railEnvironment: env === true ? 'production' : env === false ? 'sandbox' : 'unknown', billingCountryAtPayment: contract.country,
                        tenantInternalAtPayment: tenant?.isInternal === true,
                        ...(recurringLine?.period?.start && recurringLine?.period?.end ? {
                            invoiceBillingReason: invoice.billing_reason,
                            invoiceSubscriptionId: remote.id,
                            invoicePeriodStart: new Date(recurringLine.period.start * 1000).toISOString(),
                            invoicePeriodEnd: new Date(recurringLine.period.end * 1000).toISOString(),
                        } : {}),
                    };
                    if (event.type === BillingEventType.PAYMENT_REFUNDED && prior) {
                        // Partial refunds do not change the original paid amount.
                        const previousRefund = Number((prior.metadata as any)?.refundedAmountCents ?? 0);
                        const refunded = Math.min(prior.amountCents, Math.max(previousRefund, payment.amountCents));
                        if (refunded > previousRefund) {
                            const full = refunded >= prior.amountCents;
                            await tx.billingPayment.update({ where: { id: prior.id }, data: {
                                ...(full ? { status: 'refunded' } : {}),
                                metadata: { ...(prior.metadata as any), refundedAmountCents: refunded },
                            } });
                            paymentChanged = true;
                        }
                    } else if (['succeeded', 'failed'].includes(payment.status) && (!prior || (prior.status === 'failed' && payment.status === 'succeeded'))) {
                        const data = { amountCents: payment.amountCents, currency: payment.currency, status: payment.status,
                            paidAt: payment.status === 'succeeded' ? payment.paidAt ?? new Date() : null,
                            failureReason: payment.status === 'failed' ? payment.failureReason : null, metadata: stamp };
                        if (prior) await tx.billingPayment.update({ where: { id: prior.id }, data });
                        else await tx.billingPayment.create({ data: { ...data, tenantId: current.tenantId, subscriptionId: current.id, provider: 'stripe', providerPaymentId: event.providerPaymentId } });
                        paymentChanged = true;
                    }
                }
                return { processed: true };
            });
            if (result.processed) {
                await Promise.allSettled(['tenant_plan', 'sub_status', 'plan_features'].map(prefix => this.redis.del(`${prefix}:${current.tenantId}`)));
                const payload = { tenantId: current.tenantId, subscriptionId: current.id, event };
                if (!payment || paymentChanged) this.events.emit(event.type, payload);
                if (current.status !== mapped.status) {
                    const type = mapped.status === 'active' ? BillingEventType.SUBSCRIPTION_ACTIVATED
                        : mapped.status === 'trialing' ? BillingEventType.TRIAL_STARTED
                        : mapped.status === 'past_due' ? BillingEventType.SUBSCRIPTION_PAST_DUE
                        : mapped.status === 'cancelled' ? BillingEventType.SUBSCRIPTION_CANCELLED
                        : mapped.status === 'expired' ? BillingEventType.SUBSCRIPTION_EXPIRED : null;
                    if (type && type !== event.type) this.events.emit(type, payload);
                }
            }
            return result;
        });
    }

    private async ignore(event: NormalizedBillingEvent, reason: string) {
        await this.prisma.billingEvent.upsert({
            where: { provider_providerEventId: { provider: 'stripe', providerEventId: event.providerEventId } },
            create: { provider: 'stripe', providerEventId: event.providerEventId, eventType: event.type, payload: { ignored: reason, event: event.rawPayload } as any },
            update: {},
        });
        return { processed: false, reason };
    }
}
