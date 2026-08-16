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
            const environment = this.wompiConfig.environment();
            if (environment === 'production' || environment === 'sandbox') return environment;
            return 'unknown';
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
        /** Stable identity for non-periodic operations such as an upgrade. */
        operationKey?: string;
        /** Immutable context needed to settle this exact charge (for example a
         * pending upgrade's target price/cycle and credit consumption). */
        metadata?: Record<string, unknown>;
    }, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<{ id: string; reference: string; cycleKey: string } | null> {
        const attemptNumber = input.attemptNumber ?? 1;
        const cycleKey = buildCycleKey(
            input.subscriptionId,
            input.periodStart,
            input.purpose,
            input.operationKey,
        );
        const reference = buildChargeReference(
            input.subscriptionId,
            input.periodStart,
            input.purpose,
            attemptNumber,
            input.operationKey,
        );

        try {
            const created = await db.billingChargeAttempt.create({
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
                    metadata: (input.metadata ?? {}) as any,
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
               SET status = 'in_flight',
                   sent_at = NOW(),
                   metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('executionStage', 'reserved', 'reservedAt', NOW()),
                   updated_at = NOW()
             WHERE id = ${attemptId}::uuid
               AND status = 'scheduled'
            RETURNING *
        `;
        return rows?.[0] ?? null;
    }

    /**
     * Durable boundary immediately before the provider POST. A worker that dies
     * while the attempt is only `reserved` provably moved no money and can be
     * retried. Once this marker commits, the outcome is indeterminate until a
     * canonical lookup by reference proves otherwise.
     */
    async markProviderPostStarted(attemptId: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<any[]>`
            UPDATE billing_charge_attempts
               SET failure_class = 'indeterminate',
                   metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('executionStage', 'provider_post_started', 'providerPostStartedAt', NOW()),
                   updated_at = NOW()
             WHERE id = ${attemptId}::uuid
               AND status = 'in_flight'
            RETURNING id
        `;
        return !!rows?.length;
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
        const subscriptionId = attempt.subscription_id ?? attempt.subscriptionId;
        const sub = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Mutations that disable billing (cancel/pause/comp/internal) take a
            // FOR UPDATE lock on this same row. KEY SHARE orders revalidation
            // against them: either we see the committed stop, or the mutator
            // sees this already-in-flight attempt and refuses to change state.
            await tx.$queryRaw<any[]>`
                SELECT id FROM billing_subscriptions
                 WHERE id = ${subscriptionId}::uuid
                 FOR KEY SHARE
            `;
            return tx.billingSubscription.findUnique({ where: { id: subscriptionId } });
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

        const attemptPeriodStart = new Date(attempt.period_start ?? attempt.periodStart);
        if (attempt.purpose === 'renewal'
            && sub.pendingPlanId
            && sub.pendingPlanChangeAt
            && sub.pendingPlanChangeAt.getTime() <= attemptPeriodStart.getTime()) {
            return { ok: false, reason: 'pending_plan_change_due' };
        }

        const amount = attempt.amount_cents ?? attempt.amountCents;
        const purpose = attempt.purpose;
        if (purpose === 'initial'
            && ![SubscriptionStatus.PENDING_AUTH, SubscriptionStatus.TRIALING].includes(sub.status as SubscriptionStatus)) {
            return { ok: false, reason: `initial_status_${sub.status}` };
        }
        if (purpose === 'renewal'
            && ![SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].includes(sub.status as SubscriptionStatus)) {
            return { ok: false, reason: `renewal_status_${sub.status}` };
        }
        if ((purpose === 'initial' || purpose === 'renewal') && sub.pendingUpgradePlanId) {
            return { ok: false, reason: 'pending_upgrade_charge' };
        }
        const cycleKey = attempt.cycle_key ?? attempt.cycleKey;
        if (cycleKey) {
            const alreadyPaid = await this.prisma.billingChargeAttempt.findFirst({
                where: {
                    cycleKey,
                    status: 'succeeded',
                    id: { not: attempt.id },
                },
                select: { id: true },
            });
            if (alreadyPaid) return { ok: false, reason: 'cycle_already_paid' };
        }
        const attemptMetadata = attempt.metadata && typeof attempt.metadata === 'object'
            ? attempt.metadata
            : {};
        if (purpose === 'upgrade_proration') {
            const targetPlanId = attemptMetadata.targetPlanId;
            if (!targetPlanId || sub.pendingUpgradePlanId !== targetPlanId) {
                return { ok: false, reason: 'upgrade_no_longer_pending' };
            }
        } else if (sub.chargeAmountCents != null && sub.chargeAmountCents !== amount) {
            return { ok: false, reason: 'amount_changed' };
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: sub.tenantId },
            select: { isActive: true, isInternal: true },
        });
        if (!tenant?.isActive) return { ok: false, reason: 'tenant_inactive' };
        if (tenant.isInternal) return { ok: false, reason: 'tenant_internal' };

        return { ok: true };
    }

    /** True when the attempt is so overdue that charging it would surprise the customer. */
    isTooLate(attempt: any, now = new Date()): boolean {
        const scheduled = new Date(attempt.scheduled_at ?? attempt.scheduledAt);
        return now.getTime() - scheduled.getTime() > MAX_LATENESS_MS;
    }

    async markAttempt(
        attemptId: string,
        status: 'scheduled' | 'abandoned' | 'stale' | 'superseded' | 'failed' | 'pending_provider',
        patch: Record<string, unknown> = {},
    ): Promise<boolean> {
        const result = await this.prisma.billingChargeAttempt.updateMany({
            where: {
                id: attemptId,
                // A webhook can settle while the worker is returning from the
                // provider POST. Its stale PENDING/reschedule write must never
                // downgrade a terminal canonical result.
                status: { notIn: ['succeeded', 'failed', 'abandoned', 'stale', 'superseded'] },
            },
            data: { status, ...(patch as any) },
        });
        return result.count === 1;
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
        if (!this.chargeIdentityMatches(attempt, charge, false)) {
            await this.markIndeterminate(attempt.id, 'provider_charge_identity_mismatch');
            throw new Error(`Provider charge identity mismatch for attempt ${attempt.id}`);
        }

        const subSnapshot = attempt.subscription;
        const settlementMeta = attempt.metadata && typeof attempt.metadata === 'object'
            ? attempt.metadata as Record<string, any>
            : {};
        const isUpgrade = attempt.purpose === 'upgrade_proration';
        const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const lockedAttempts = await tx.$queryRaw<any[]>`
                SELECT id, status FROM billing_charge_attempts
                 WHERE id = ${attempt.id}::uuid
                 FOR UPDATE
            `;
            // Webhook and poll can both observe the pre-settlement snapshot.
            // The row lock makes the loser re-read the winner's status and exit
            // before inserting a duplicate BillingPayment or emitting DIAN work.
            if (!lockedAttempts?.length || lockedAttempts[0].status === 'succeeded') {
                return { alreadySettled: true as const };
            }
            await tx.$queryRaw<any[]>`
                SELECT id FROM billing_subscriptions
                 WHERE id = ${attempt.subscriptionId}::uuid
                 FOR UPDATE
            `;
            const sub = await tx.billingSubscription.findUnique({ where: { id: attempt.subscriptionId } })
                ?? subSnapshot;
            const targetPlanId = isUpgrade
                ? String(settlementMeta.targetPlanId || sub.pendingUpgradePlanId || '')
                : '';
            const tenantAtSettlement = await tx.tenant.findUnique({
                where: { id: attempt.tenantId },
                select: { isInternal: true },
            });
            const tenantIsInternal = tenantAtSettlement?.isInternal === true;
            const entitlementBlockReason = tenantIsInternal
                ? 'tenant_internal'
                : [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED].includes(sub.status as SubscriptionStatus)
                    ? `status_${sub.status}`
                    : sub.cancelAtPeriodEnd
                        ? 'cancel_at_period_end'
                        : sub.cancellationReason === 'paused' || sub.cancellationReason?.startsWith('paused:')
                            ? 'paused'
                            : sub.cancellationReason?.startsWith('comp:')
                                ? 'comp_plan'
                                : null;
            const entitlementBlocked = !!entitlementBlockReason;
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
                    metadata: {
                        railEnvironment: this.railEnvironment(attempt.provider),
                        tenantInternalAtPayment: tenantAtSettlement?.isInternal === true,
                    } as any,
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

            // A late approval wins over dunning retries already claimed for the
            // same cycle. Supersede them before restoring ACTIVE so none can
            // charge a cycle whose money already arrived.
            await tx.billingChargeAttempt.updateMany({
                where: {
                    cycleKey: attempt.cycleKey,
                    id: { not: attempt.id },
                    status: 'scheduled',
                },
                data: {
                    status: 'superseded',
                    failureCode: 'cycle_settled_by_sibling_attempt',
                    settledAt: charge.settledAt ?? new Date(),
                },
            });

            const effectiveMetadata = isUpgrade && settlementMeta.targetBillingCycle
                ? { ...(sub.metadata as any ?? {}), billingCycle: settlementMeta.targetBillingCycle }
                : sub.metadata;
            const effectiveChargeAmount = isUpgrade && Number.isSafeInteger(settlementMeta.targetAmountCents)
                ? Number(settlementMeta.targetAmountCents)
                : sub.chargeAmountCents;
            const effectiveChargeCurrency = isUpgrade && settlementMeta.targetCurrency
                ? String(settlementMeta.targetCurrency)
                : sub.chargeCurrency;

            const nextCycle = this.computeNextCycle({
                id: sub.id,
                currentPeriodEnd: attempt.periodEnd,
                billingAnchorDay: sub.billingAnchorDay,
                billingTimezone: sub.billingTimezone,
                chargeAmountCents: effectiveChargeAmount,
                chargeCurrency: effectiveChargeCurrency,
                metadata: effectiveMetadata,
            });

            let creditBalanceCents = sub.creditBalanceCents;
            const creditAppliedCents = isUpgrade
                ? Math.max(0, Number(settlementMeta.creditAppliedCents ?? 0))
                : 0;
            if (creditAppliedCents > 0 && !entitlementBlocked) {
                await tx.billingCreditLedger.create({
                    data: {
                        tenantId: attempt.tenantId,
                        subscriptionId: sub.id,
                        deltaCents: -creditAppliedCents,
                        currency: attempt.currency,
                        reason: 'upgrade_credit_applied',
                        refAttemptId: attempt.id,
                        notes: `Credit consumed by settled upgrade ${attempt.id}`,
                    },
                });
                const aggregate = await tx.billingCreditLedger.aggregate({
                    where: { tenantId: attempt.tenantId },
                    _sum: { deltaCents: true },
                });
                creditBalanceCents = aggregate._sum.deltaCents ?? 0;
            }

            await tx.billingSubscription.update({
                where: { id: sub.id },
                data: entitlementBlocked ? {
                    // Money landed after the tenant was converted to internal
                    // use. Keep the charge for reconciliation/refund, but never
                    // grant or restart the paid entitlement automatically.
                    engine: 'disabled',
                    nextChargeAt: null,
                    dunningState: 'indeterminate',
                } : {
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodStart: attempt.periodStart,
                    currentPeriodEnd: attempt.periodEnd,
                    nextChargeAt: nextCycle.scheduledAt,
                    // A successful charge ends any dunning in progress.
                    dunningState: 'none',
                    dunningStartedAt: null,
                    dunningAttempts: 0,
                    cancelAtPeriodEnd: false,
                    cancelledAt: null,
                    cancellationReason: null,
                    // The plan charged as an upgrade only becomes real once paid.
                    ...(isUpgrade && targetPlanId
                        ? {
                            planId: targetPlanId,
                            pendingUpgradePlanId: null,
                            chargeAmountCents: effectiveChargeAmount,
                            chargeCurrency: effectiveChargeCurrency,
                            metadata: effectiveMetadata as any,
                            creditBalanceCents,
                        }
                        : {}),
                },
            });

            // `tenants.plan` es el campo desnormalizado del que salen los
            // LÍMITES (rate limiter y features leen de ahí, no de la
            // suscripción). Sin espejarlo, el cliente pagaba la mejora y seguía
            // capado en el plan viejo, y las dos pantallas se contradecían para
            // siempre. El slug se resuelve dentro de la misma transacción.
            const entitlementPlanId = isUpgrade && targetPlanId
                ? targetPlanId
                : attempt.purpose === 'initial'
                    ? sub.planId
                    : null;
            const upgradedPlan = entitlementPlanId
                ? await tx.billingPlan.findUnique({
                    where: { id: entitlementPlanId },
                    select: { slug: true },
                })
                : null;

            if (!entitlementBlocked) await tx.tenant.update({
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

            return { paymentId: payment.id, tenantIsInternal, entitlementBlocked, entitlementBlockReason };
        });

        if ('alreadySettled' in result) {
            this.logger.debug(`[Engine] Attempt ${attemptId} was settled by a concurrent resolver`);
            return;
        }

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

        if (result.entitlementBlocked) {
            this.eventEmitter.emit('billing.charge_requires_refund_review', {
                tenantId: attempt.tenantId,
                subscriptionId: attempt.subscriptionId,
                paymentId: result.paymentId,
                attemptId: attempt.id,
                providerPaymentId: charge.providerChargeId,
                reason: result.entitlementBlockReason,
                requiresManualRefundReview: true,
            });
            this.logger.error(
                `[Engine][ESCALATE] Tenant ${attempt.tenantId} received late approval ${charge.providerChargeId} `
                + `while entitlement was blocked (${result.entitlementBlockReason}); `
                + 'paid entitlements were not granted and the charge requires refund review.',
            );
        }

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
        const outcome = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw<any[]>`
                SELECT id FROM billing_charge_attempts
                 WHERE id = ${attemptId}::uuid
                 FOR UPDATE
            `;
            const attempt = await tx.billingChargeAttempt.findUnique({ where: { id: attemptId } });
            // Canonical terminal outcomes are idempotent. A webhook + poll
            // duplicate DECLINED must emit PAYMENT_FAILED once, otherwise
            // Dunning could claim two retries for one bank response.
            if (!attempt || ['succeeded', 'failed', 'abandoned', 'stale', 'superseded'].includes(attempt.status)) {
                return { kind: 'noop' as const };
            }
            if (!this.chargeIdentityMatches(attempt, charge, false)) {
                const reason = 'provider_failure_identity_mismatch';
                await tx.billingChargeAttempt.update({
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
                return { kind: 'mismatch' as const, attempt, reason };
            }

            await tx.billingChargeAttempt.update({
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
            return { kind: 'failed' as const, attempt };
        });

        if (outcome.kind === 'noop') return;
        if (outcome.kind === 'mismatch') {
            this.logger.error(
                `[Engine] INDETERMINATE charge ${attemptId} (${outcome.reason}) — reference ${outcome.attempt.reference}`,
            );
            this.eventEmitter.emit('billing.charge.indeterminate', {
                tenantId: outcome.attempt.tenantId,
                subscriptionId: outcome.attempt.subscriptionId,
                attemptId: outcome.attempt.id,
                reference: outcome.attempt.reference,
                reason: outcome.reason,
            });
            return;
        }
        const attempt = outcome.attempt;

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
     * Reverse a charge that had already settled.
     *
     * A refund/chargeback is not a failed attempt: the attempt DID move money
     * and may already have produced a DIAN invoice. Persist the reversal
     * idempotently, revoke paid standing on a full reversal, and emit the
     * normalized refund so FiscalInvoiceService creates the credit note.
     */
    async settleRefunded(
        attemptId: string,
        charge: Partial<ProviderCharge> & { amountCents?: number },
    ): Promise<void> {
        const attempt = await this.prisma.billingChargeAttempt.findUnique({
            where: { id: attemptId },
            include: { subscription: true },
        });

        if (!attempt?.paymentId || attempt.status !== 'succeeded') return;
        if (!this.chargeIdentityMatches(attempt, charge, true)) {
            this.logger.error(`[Engine] Refusing refund identity mismatch for attempt ${attempt.id}`);
            return;
        }

        const now = new Date();
        const settled = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Serialize webhook/poll/replay on the payment row. Computing the
            // JSON refund total outside this lock allowed two concurrent events
            // to emit the same delta (and therefore two fiscal credit notes).
            await tx.$queryRaw<any[]>`
                SELECT id FROM billing_payments
                 WHERE id = ${attempt.paymentId}::uuid
                 FOR UPDATE
            `;
            const payment = await tx.billingPayment.findUnique({ where: { id: attempt.paymentId! } });
            if (!payment || !['succeeded', 'refunded'].includes(payment.status)) return null;

            const alreadyRefunded = Math.max(0, Number((payment.metadata as any)?.refundedAmountCents ?? 0));
            const requestedTotal = Math.min(
                payment.amountCents,
                Math.max(alreadyRefunded, Number(charge.amountCents ?? payment.amountCents)),
            );
            const delta = requestedTotal - alreadyRefunded;
            if (delta <= 0) return null;
            const fullyRefunded = requestedTotal >= payment.amountCents;
            const cleanPaymentMetadata = { ...(payment.metadata as any ?? {}) };
            delete cleanPaymentMetadata.refundPendingAmountCents;
            delete cleanPaymentMetadata.refundPendingTotalCents;
            delete cleanPaymentMetadata.refundPendingCheckCount;
            delete cleanPaymentMetadata.refundPendingNextCheckAt;
            await tx.billingPayment.update({
                where: { id: payment.id },
                data: {
                    status: fullyRefunded ? 'refunded' : 'succeeded',
                    metadata: {
                        ...cleanPaymentMetadata,
                        refundedAmountCents: requestedTotal,
                        lastRefundedAt: now.toISOString(),
                    } as any,
                },
            });
            await tx.billingChargeAttempt.update({
                where: { id: attempt.id },
                data: {
                    providerStatus: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
                    metadata: {
                        ...(attempt.metadata as any ?? {}),
                        refundedAmountCents: requestedTotal,
                    } as any,
                },
            });

            // Subscription state is a second settlement surface. Lock it before
            // deciding whether this reversal removes the tenant's CURRENT paid
            // standing; cancel/renew/upgrade may be committing at the same time.
            await tx.$queryRaw<any[]>`
                SELECT id FROM billing_subscriptions
                 WHERE id = ${attempt.subscriptionId}::uuid
                 FOR UPDATE
            `;
            const [liveSub, liveTenant] = await Promise.all([
                tx.billingSubscription.findUnique({ where: { id: attempt.subscriptionId } }),
                tx.tenant.findUnique({ where: { id: attempt.tenantId }, select: { isInternal: true } }),
            ]);

            // A historical refund still needs its local payment status, audit
            // event and DIAN credit note, but it must not revoke a later paid
            // period. Period advancement catches the normal renewal case;
            // settledAt also catches a later successful upgrade in the same
            // period. This query runs under the subscription lock, so a renewal
            // cannot slip between this decision and the state transition.
            const laterSuccessfulAttempt = await tx.billingChargeAttempt.findFirst({
                where: {
                    subscriptionId: attempt.subscriptionId,
                    id: { not: attempt.id },
                    status: 'succeeded',
                    // A proration only paid the delta for a plan change; it does
                    // not replace the base cycle charge being refunded.
                    purpose: { in: ['initial', 'renewal'] },
                    OR: [
                        { periodEnd: { gt: attempt.periodEnd } },
                        ...(attempt.settledAt ? [{ settledAt: { gt: attempt.settledAt } }] : []),
                    ],
                },
                select: { id: true },
            });
            const currentPeriodAdvanced = !!liveSub?.currentPeriodEnd
                && liveSub.currentPeriodEnd.getTime() > attempt.periodEnd.getTime();
            const historicalRefund = currentPeriodAdvanced || !!laterSuccessfulAttempt;
            const terminalOrExempt = !!liveTenant?.isInternal
                || !liveSub
                || [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED].includes(liveSub.status as SubscriptionStatus)
                || liveSub.cancellationReason?.startsWith('comp:')
                || liveSub.cancellationReason === 'paused'
                || liveSub.cancellationReason?.startsWith('paused:');
            if (fullyRefunded && !terminalOrExempt && !historicalRefund) {
                await tx.billingSubscription.update({
                    where: { id: attempt.subscriptionId },
                    data: {
                        status: SubscriptionStatus.PAST_DUE,
                        nextChargeAt: null,
                        dunningState: 'grace',
                        dunningStartedAt: now,
                    },
                });
                await tx.tenant.update({
                    where: { id: attempt.tenantId },
                    data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
                });
            }
            return {
                paymentId: payment.id,
                providerPaymentId: payment.providerPaymentId,
                currency: payment.currency,
                delta,
            };
        });
        if (!settled) return;

        await Promise.allSettled([
            this.redis.del(`tenant_plan:${attempt.tenantId}`),
            this.redis.del(`sub_status:${attempt.tenantId}`),
            this.redis.del(`plan_features:${attempt.tenantId}`),
        ]);
        this.eventEmitter.emit(BillingEventType.PAYMENT_REFUNDED, {
            tenantId: attempt.tenantId,
            subscriptionId: attempt.subscriptionId,
            paymentId: settled.paymentId,
            providerPaymentId: settled.providerPaymentId ?? charge.providerChargeId,
            amountCents: settled.delta,
            currency: settled.currency,
            event: {
                provider: attempt.provider,
                payment: {
                    providerPaymentId: settled.providerPaymentId ?? charge.providerChargeId,
                    amountCents: settled.delta,
                    currency: settled.currency,
                    status: 'refunded',
                },
            },
        });
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
        const attempt = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw<any[]>`
                SELECT id FROM billing_charge_attempts
                 WHERE id = ${attemptId}::uuid
                 FOR UPDATE
            `;
            const locked = await tx.billingChargeAttempt.findUnique({ where: { id: attemptId } });
            if (!locked || ['succeeded', 'failed', 'abandoned', 'stale', 'superseded'].includes(locked.status)) {
                return null;
            }
            const updated = await tx.billingChargeAttempt.updateMany({
                where: {
                    id: attemptId,
                    status: { notIn: ['succeeded', 'failed', 'abandoned', 'stale', 'superseded'] },
                },
                data: {
                    status: 'in_flight',
                    failureClass: 'indeterminate',
                    failureCode: reason,
                    metadata: {
                        ...(locked.metadata as any ?? {}),
                        indeterminateAt: new Date().toISOString(),
                        indeterminateReason: reason,
                    },
                },
            });
            return updated.count === 1 ? locked : null;
        });
        if (!attempt) return;

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

    /** Canonical provider response must describe this exact money movement. */
    private chargeIdentityMatches(
        attempt: { reference: string; amountCents: number; currency: string },
        charge: Partial<ProviderCharge> & { amountCents?: number },
        refund: boolean,
    ): boolean {
        if (charge.reference && charge.reference !== attempt.reference) return false;
        if (charge.currency && charge.currency.toUpperCase() !== attempt.currency.toUpperCase()) return false;
        if (charge.amountCents != null) {
            if (!Number.isSafeInteger(charge.amountCents)) return false;
            if (refund) return charge.amountCents > 0 && charge.amountCents <= attempt.amountCents;
            return charge.amountCents === attempt.amountCents;
        }
        return refund ? false : true;
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
