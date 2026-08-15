import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PaymentProviderFactory } from '../payment-provider.factory';
import { WompiConfigService } from '../adapters/wompi-config.service';
import { BillingEventType } from '../types/billing-event.enum';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { BillingCycle, PaymentProviderName } from '../types/provider-types';
import { ChargeStatus, ProviderCharge } from '../adapters/charging-provider.interface';
import {
    anchorDayOf,
    buildChargeReference,
    buildCycleKey,
    chargeTimeFor,
    nextPeriodEnd,
} from './period.util';

/** How a charge attempt failed, which decides whether it may be retried at all. */
export type FailureClass = 'soft' | 'hard' | 'indeterminate';

export type ChargePurpose = 'initial' | 'renewal' | 'upgrade_proration' | 'manual_link';

const DEFAULT_TIMEZONE = 'America/Bogota';

/**
 * How late a scheduled attempt may run before it is abandoned instead of charged.
 *
 * Without it, a worker that comes back after a long outage would fire every
 * missed renewal at once — an avalanche of charges the customer never expected,
 * on a day that has nothing to do with their billing date.
 */
const MAX_LATENESS_MS = 36 * 3_600_000;

/**
 * The internal recurring billing engine.
 *
 * Providers without native subscriptions can only execute one charge at a time;
 * everything else — when to charge, how much, what to do when it fails — lives
 * here.
 *
 * The whole design rests on one invariant: **a charge attempt row is claimed
 * before any money can move**. `UNIQUE(cycle_key, attempt_number)` makes a
 * second claim for the same cycle impossible, so a duplicated cron (this app
 * runs every @Cron twice, in the API and in the worker), a re-queued job or two
 * racing workers all collide on the insert instead of charging the customer
 * twice. Neither the queue nor the cron lock is the guarantee — both fail open.
 */
@Injectable()
export class SubscriptionEngineService {
    private readonly logger = new Logger(SubscriptionEngineService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly eventEmitter: EventEmitter2,
        private readonly providerFactory: PaymentProviderFactory,
        private readonly wompiConfig: WompiConfigService,
    ) {}

    /** Igual que `BillingService.railEnvironment`, para el cobro desatendido. */
    private railEnvironment(provider: string): 'sandbox' | 'production' | 'unknown' {
        if (provider !== 'wompi') return 'unknown';
        try {
            return this.wompiConfig.environment() === 'production' ? 'production' : 'sandbox';
        } catch {
            return 'unknown';
        }
    }

    // -------------------------------------------------------------------------
    // Scheduling
    // -------------------------------------------------------------------------

    /**
     * Claim the attempt row for a billing cycle.
     *
     * Returns null when the cycle is already claimed — that is the normal,
     * expected outcome of a duplicated scheduler run, not an error.
     */
    async claimAttempt(input: {
        subscriptionId: string;
        tenantId: string;
        provider: PaymentProviderName;
        purpose: ChargePurpose;
        periodStart: Date;
        periodEnd: Date;
        amountCents: number;
        currency: string;
        scheduledAt: Date;
        paymentSourceId?: string | null;
        attemptNumber?: number;
    }): Promise<{ id: string; reference: string; cycleKey: string } | null> {
        const attemptNumber = input.attemptNumber ?? 1;
        const cycleKey = buildCycleKey(input.subscriptionId, input.periodStart, input.purpose);
        const reference = buildChargeReference(input.subscriptionId, input.periodStart, attemptNumber);

        try {
            const created = await this.prisma.billingChargeAttempt.create({
                data: {
                    subscriptionId: input.subscriptionId,
                    tenantId: input.tenantId,
                    purpose: input.purpose,
                    cycleKey,
                    attemptNumber,
                    status: 'scheduled',
                    provider: input.provider,
                    paymentSourceId: input.paymentSourceId ?? null,
                    amountCents: input.amountCents,
                    currency: input.currency,
                    reference,
                    periodStart: input.periodStart,
                    periodEnd: input.periodEnd,
                    scheduledAt: input.scheduledAt,
                },
                select: { id: true, reference: true, cycleKey: true },
            });
            return created;
        } catch (err: any) {
            // P2002 = unique violation. Someone already claimed this cycle.
            if (err?.code === 'P2002') {
                this.logger.debug(`[Engine] Cycle ${cycleKey}#${attemptNumber} already claimed — skipping`);
                return null;
            }
            throw err;
        }
    }

    /** Period boundaries and amount for the NEXT cycle of a subscription. */
    computeNextCycle(sub: {
        id: string;
        currentPeriodEnd: Date | null;
        billingAnchorDay: number | null;
        billingTimezone: string | null;
        chargeAmountCents: number | null;
        chargeCurrency: string | null;
        metadata: any;
    }): { periodStart: Date; periodEnd: Date; scheduledAt: Date; anchorDay: number; timezone: string } {
        const periodStart = sub.currentPeriodEnd ?? new Date();
        const anchorDay = sub.billingAnchorDay ?? anchorDayOf(periodStart);
        const timezone = sub.billingTimezone || DEFAULT_TIMEZONE;
        const cycle: BillingCycle = sub.metadata?.billingCycle === 'annual' ? 'annual' : 'monthly';
        const periodEnd = nextPeriodEnd(periodStart, cycle, anchorDay);
        return {
            periodStart,
            periodEnd,
            scheduledAt: chargeTimeFor(periodStart, timezone),
            anchorDay,
            timezone,
        };
    }

    // -------------------------------------------------------------------------
    // Execution guards
    // -------------------------------------------------------------------------

    /**
     * Take exclusive ownership of an attempt before charging.
     *
     * The guarded UPDATE is what makes concurrent execution safe: only the
     * worker whose write matches `status = 'scheduled'` gets a row back, so a
     * job delivered twice cannot produce two charges.
     */
    async reserveForExecution(attemptId: string): Promise<any | null> {
        const rows = await this.prisma.$queryRaw<any[]>`
            UPDATE billing_charge_attempts
               SET status = 'in_flight', sent_at = NOW(), updated_at = NOW()
             WHERE id = ${attemptId}::uuid
               AND status = 'scheduled'
            RETURNING *
        `;
        return rows?.[0] ?? null;
    }

    /**
     * Decide whether an attempt reserved a moment ago should still be charged.
     *
     * Validation happens HERE, at charge time, not when the attempt was
     * scheduled: a row queued days ago carries no authority to move money today.
     * Between then and now the tenant may have cancelled, changed plan, been
     * given a comp plan, or the amount may have changed.
     */
    async revalidate(attempt: any): Promise<{ ok: true } | { ok: false; reason: string }> {
        const sub = await this.prisma.billingSubscription.findUnique({
            where: { id: attempt.subscription_id ?? attempt.subscriptionId },
        });
        if (!sub) return { ok: false, reason: 'subscription_gone' };

        if (sub.engine !== 'internal') return { ok: false, reason: 'engine_disabled' };

        const chargeableStates: string[] = [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.PENDING_AUTH,
        ];
        if (!chargeableStates.includes(sub.status)) {
            return { ok: false, reason: `status_${sub.status}` };
        }

        if (sub.cancelAtPeriodEnd) return { ok: false, reason: 'cancel_at_period_end' };

        // A comp plan must never be charged.
        if ((sub.cancellationReason ?? '').startsWith('comp:')) return { ok: false, reason: 'comp_plan' };

        const amount = attempt.amount_cents ?? attempt.amountCents;
        if (sub.chargeAmountCents != null && sub.chargeAmountCents !== amount) {
            return { ok: false, reason: 'amount_changed' };
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: sub.tenantId },
            select: { isActive: true },
        });
        if (!tenant?.isActive) return { ok: false, reason: 'tenant_inactive' };

        return { ok: true };
    }

    /** True when the attempt is so overdue that charging it would surprise the customer. */
    isTooLate(attempt: any, now = new Date()): boolean {
        const scheduled = new Date(attempt.scheduled_at ?? attempt.scheduledAt);
        return now.getTime() - scheduled.getTime() > MAX_LATENESS_MS;
    }

    async markAttempt(
        attemptId: string,
        status: 'abandoned' | 'stale' | 'superseded' | 'failed' | 'pending_provider',
        patch: Record<string, unknown> = {},
    ): Promise<void> {
        await this.prisma.billingChargeAttempt.update({
            where: { id: attemptId },
            data: { status, ...(patch as any) },
        });
    }

    // -------------------------------------------------------------------------
    // Settlement
    // -------------------------------------------------------------------------

    /**
     * Record an approved charge: money moved, so the subscription advances.
     *
     * Everything that must agree lands in one transaction — the payment row, the
     * attempt, the subscription and the denormalized tenant columns. The
     * normalized PAYMENT_SUCCEEDED event is emitted AFTER it commits, because
     * that event triggers the DIAN invoice: emitting it for a transaction that
     * later rolls back would issue a legal invoice for a payment that does not
     * exist.
     */
    async settleApproved(attemptId: string, charge: ProviderCharge): Promise<void> {
        const attempt = await this.prisma.billingChargeAttempt.findUnique({
            where: { id: attemptId },
            include: { subscription: true },
        });
        if (!attempt) {
            this.logger.error(`[Engine] settleApproved: attempt ${attemptId} not found`);
            return;
        }
        if (attempt.status === 'succeeded') {
            // Webhook and polling both resolve here; whoever arrives second is a no-op.
            this.logger.debug(`[Engine] Attempt ${attemptId} already settled`);
            return;
        }

        const sub = attempt.subscription;
        const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const payment = await tx.billingPayment.create({
                data: {
                    tenantId: attempt.tenantId,
                    subscriptionId: attempt.subscriptionId,
                    amountCents: attempt.amountCents,
                    currency: attempt.currency,
                    status: 'succeeded',
                    provider: attempt.provider,
                    providerPaymentId: charge.providerChargeId,
                    paidAt: charge.settledAt ?? new Date(),
                    // Ver `BillingService.railEnvironment`: un cobro de sandbox
                    // queda marcado como tal para siempre, así no termina
                    // gastando un consecutivo DIAN real.
                    metadata: { railEnvironment: this.railEnvironment(attempt.provider) } as any,
                },
            });

            // UNIQUE(payment_id) — one fiscal invoice per attempt, never two.
            await tx.billingChargeAttempt.update({
                where: { id: attempt.id },
                data: {
                    status: 'succeeded',
                    providerTxnId: charge.providerChargeId,
                    providerStatus: charge.rawStatus ?? 'APPROVED',
                    settledAt: charge.settledAt ?? new Date(),
                    paymentId: payment.id,
                    failureCode: null,
                    failureClass: null,
                },
            });

            const nextCycle = this.computeNextCycle({
                id: sub.id,
                currentPeriodEnd: attempt.periodEnd,
                billingAnchorDay: sub.billingAnchorDay,
                billingTimezone: sub.billingTimezone,
                chargeAmountCents: sub.chargeAmountCents,
                chargeCurrency: sub.chargeCurrency,
                metadata: sub.metadata,
            });

            await tx.billingSubscription.update({
                where: { id: sub.id },
                data: {
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodStart: attempt.periodStart,
                    currentPeriodEnd: attempt.periodEnd,
                    nextChargeAt: nextCycle.scheduledAt,
                    // A successful charge ends any dunning in progress.
                    dunningState: 'none',
                    dunningStartedAt: null,
                    dunningAttempts: 0,
                    // The plan charged as an upgrade only becomes real once paid.
                    ...(sub.pendingUpgradePlanId
                        ? { planId: sub.pendingUpgradePlanId, pendingUpgradePlanId: null }
                        : {}),
                },
            });

            // `tenants.plan` es el campo desnormalizado del que salen los
            // LÍMITES (rate limiter y features leen de ahí, no de la
            // suscripción). Sin espejarlo, el cliente pagaba la mejora y seguía
            // capado en el plan viejo, y las dos pantallas se contradecían para
            // siempre. El slug se resuelve dentro de la misma transacción.
            const upgradedPlan = sub.pendingUpgradePlanId
                ? await tx.billingPlan.findUnique({
                    where: { id: sub.pendingUpgradePlanId },
                    select: { slug: true },
                })
                : null;

            await tx.tenant.update({
                where: { id: attempt.tenantId },
                data: {
                    subscriptionStatus: SubscriptionStatus.ACTIVE,
                    currentPeriodEnd: attempt.periodEnd,
                    ...(upgradedPlan ? { plan: upgradedPlan.slug } : {}),
                },
            });

            // Mirrors the provider-webhook path so a redelivery is deduplicated
            // by the same UNIQUE(provider, providerEventId) index.
            await tx.billingEvent.create({
                data: {
                    tenantId: attempt.tenantId,
                    subscriptionId: attempt.subscriptionId,
                    provider: attempt.provider,
                    providerEventId: `engine_settle_${attempt.id}`,
                    eventType: BillingEventType.PAYMENT_SUCCEEDED,
                    payload: { charge, attemptId: attempt.id } as any,
                },
            }).catch(() => undefined);

            return { paymentId: payment.id };
        });

        await Promise.allSettled([
            this.redis.del(`tenant_plan:${attempt.tenantId}`),
            this.redis.del(`sub_status:${attempt.tenantId}`),
            this.redis.del(`plan_features:${attempt.tenantId}`),
        ]);

        // Fiscal invoicing (Factus/DIAN) listens for exactly this shape.
        this.eventEmitter.emit(BillingEventType.PAYMENT_SUCCEEDED, {
            tenantId: attempt.tenantId,
            subscriptionId: attempt.subscriptionId,
            paymentId: result.paymentId,
            providerPaymentId: charge.providerChargeId,
            amountCents: attempt.amountCents,
            currency: attempt.currency,
        });

        this.logger.log(
            `[Engine] Charged ${attempt.amountCents} ${attempt.currency} for tenant ${attempt.tenantId} (attempt ${attempt.id})`,
        );
    }

    /**
     * Record a charge the provider refused. Classification decides what the
     * dunning policy may do next, so it is stored on the attempt rather than
     * recomputed later from a message string.
     */
    async settleFailed(
        attemptId: string,
        charge: Partial<ProviderCharge> & { status: ChargeStatus },
        failureClass: FailureClass,
    ): Promise<void> {
        const attempt = await this.prisma.billingChargeAttempt.findUnique({ where: { id: attemptId } });
        if (!attempt || attempt.status === 'succeeded') return;

        await this.prisma.billingChargeAttempt.update({
            where: { id: attemptId },
            data: {
                status: 'failed',
                providerTxnId: charge.providerChargeId ?? attempt.providerTxnId,
                providerStatus: charge.rawStatus ?? charge.status.toUpperCase(),
                failureCode: charge.statusMessage ?? null,
                failureClass,
                settledAt: new Date(),
            },
        });

        this.eventEmitter.emit(BillingEventType.PAYMENT_FAILED, {
            tenantId: attempt.tenantId,
            subscriptionId: attempt.subscriptionId,
            attemptId: attempt.id,
            failureClass,
            reason: charge.statusMessage ?? charge.status,
        });

        this.logger.warn(
            `[Engine] Charge ${attemptId} failed (${failureClass}): ${charge.statusMessage ?? charge.status}`,
        );
    }

    /**
     * A charge whose outcome we could not learn — typically a network timeout
     * before the provider id came back.
     *
     * This is the most dangerous state in the whole engine. Wompi has no
     * idempotency key, so a blind retry can charge the customer a second time
     * for the same period. The rule is absolute: an indeterminate attempt NEVER
     * spawns another attempt for its cycle. It is frozen, an incident is raised,
     * and a human (or the rescue-by-reference sweep) resolves it.
     */
    async markIndeterminate(attemptId: string, reason: string): Promise<void> {
        const attempt = await this.prisma.billingChargeAttempt.findUnique({ where: { id: attemptId } });
        if (!attempt) return;

        await this.prisma.billingChargeAttempt.update({
            where: { id: attemptId },
            data: {
                status: 'in_flight',
                failureClass: 'indeterminate',
                failureCode: reason,
                metadata: {
                    ...(attempt.metadata as any ?? {}),
                    indeterminateAt: new Date().toISOString(),
                    indeterminateReason: reason,
                },
            },
        });

        this.logger.error(
            `[Engine] INDETERMINATE charge ${attemptId} (${reason}) — reference ${attempt.reference}. `
            + 'Not retrying: the money may already have moved. Resolve by reference before any further attempt.',
        );

        this.eventEmitter.emit('billing.charge.indeterminate', {
            tenantId: attempt.tenantId,
            subscriptionId: attempt.subscriptionId,
            attemptId: attempt.id,
            reference: attempt.reference,
            reason,
        });
    }

    /**
     * Classify a provider failure.
     *
     * soft  → the money could arrive on a later try (funds, issuer hiccup)
     * hard  → this instrument will never work (expired, revoked, stolen)
     * The distinction matters because retrying a hard failure just burns
     * attempts and annoys the customer; what they need is a new payment method.
     */
    classifyFailure(charge: Partial<ProviderCharge>): FailureClass {
        const message = `${charge.statusMessage ?? ''} ${charge.rawStatus ?? ''}`.toUpperCase();
        const hardMarkers = [
            'TARJETA VENCIDA', 'EXPIRED', 'INVALID CARD', 'TARJETA INVALIDA',
            'ROBADA', 'STOLEN', 'LOST', 'RESTRICTED', 'RESTRINGIDA',
            'DO NOT HONOR PERMANENT', 'CUENTA CERRADA', 'CLOSED ACCOUNT',
        ];
        if (hardMarkers.some((m) => message.includes(m))) return 'hard';
        return 'soft';
    }

    /** Attempts stuck at the provider, for the reconciliation sweep. */
    async findUnresolvedAttempts(olderThanMinutes = 15, limit = 200) {
        const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
        return this.prisma.billingChargeAttempt.findMany({
            where: {
                status: { in: ['pending_provider', 'in_flight'] },
                sentAt: { lt: cutoff },
            },
            orderBy: { sentAt: 'asc' },
            take: limit,
        });
    }
}
