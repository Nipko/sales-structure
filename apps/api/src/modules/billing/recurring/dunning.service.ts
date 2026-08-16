import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingEventType } from '../types/billing-event.enum';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { PaymentProviderName } from '../types/provider-types';
import { FailureClass, SubscriptionEngineService } from './subscription-engine.service';
import { RENEWAL_QUEUE } from './renewal-scheduler.service';
import { CronLockService } from '../../redis/cron-lock.service';
import { RedisService } from '../../redis/redis.service';

/**
 * The recovery ladder, in days after the first failed charge.
 *
 * Two deliberate choices:
 *
 * 1. **The first decline does NOT suspend anything.** A bank rejecting a card at
 *    2pm is routine — insufficient funds for a few hours, an issuer hiccup, a
 *    fraud filter. Cutting a customer's service over it is self-inflicted churn,
 *    and they usually pay on the second try.
 *
 * 2. **The clock starts at OUR first failure**, not at a `past_due` the provider
 *    declared, so the grace window is longer than the previous 7 days: the first
 *    three days are pure retries with the service untouched.
 */
export const DUNNING_SOFT_LOCK_DAY = 3;
export const DUNNING_EXPIRY_DAY = 10;

const LADDER: Array<{ day: number; action: 'retry' | 'soft_lock' | 'expire' }> = [
    { day: 1, action: 'retry' },
    { day: DUNNING_SOFT_LOCK_DAY, action: 'soft_lock' },
    { day: 7, action: 'retry' },
    { day: DUNNING_EXPIRY_DAY, action: 'expire' },
];

const LAST_RETRY_ATTEMPT = 4;

/**
 * Decides what happens after a charge fails.
 *
 * Distinct from the engine on purpose: the engine knows how to move money, this
 * knows how patient to be. Retry policy is a business decision that changes with
 * the market, and it must never be entangled with the code that executes charges.
 */
@Injectable()
export class DunningService {
    private readonly logger = new Logger(DunningService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2,
        private readonly engine: SubscriptionEngineService,
        @InjectQueue(RENEWAL_QUEUE) private readonly renewalQueue: Queue,
        private readonly cronLock: CronLockService,
        private readonly redis: RedisService,
    ) {}

    /**
     * A charge failed. Decide whether to try again, and when.
     *
     * Only reacts to failures produced by our own engine: provider-native
     * subscriptions (MercadoPago) run their own retry schedule and this would
     * duplicate it.
     */
    @OnEvent(BillingEventType.PAYMENT_FAILED)
    async onPaymentFailed(payload: {
        tenantId: string;
        subscriptionId?: string;
        attemptId?: string;
        failureClass?: FailureClass;
    }): Promise<void> {
        if (!payload?.attemptId || !payload.subscriptionId) return; // not ours

        try {
            await this.advance(payload.subscriptionId, payload.attemptId, payload.failureClass ?? 'soft');
        } catch (err: any) {
            this.logger.error(`[Dunning] Could not advance subscription ${payload.subscriptionId}: ${err?.message}`);
        }
    }

    async advance(subscriptionId: string, attemptId: string, failureClass: FailureClass): Promise<void> {
        const [sub, attempt] = await Promise.all([
            this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId } }),
            this.prisma.billingChargeAttempt.findUnique({ where: { id: attemptId } }),
        ]);
        if (!sub || !attempt || sub.engine !== 'internal') return;
        if (failureClass !== 'indeterminate' && attempt.status !== 'failed') return;

        // An unknown outcome freezes the ladder. Advancing it could cut service
        // for a charge that actually succeeded, and could authorise another
        // charge for a period that may already be paid.
        if (failureClass === 'indeterminate') {
            await this.prisma.billingSubscription.updateMany({
                where: {
                    id: sub.id,
                    status: sub.status,
                    currentPeriodEnd: sub.currentPeriodEnd ?? null,
                    dunningState: sub.dunningState,
                    dunningStartedAt: sub.dunningStartedAt,
                },
                data: { dunningState: 'indeterminate' },
            });
            this.logger.error(
                `[Dunning] Subscription ${sub.id} frozen: the outcome of attempt ${attemptId} is unknown. `
                + 'No retry and no suspension until it is resolved by reference.',
            );
            return;
        }

        const startedAt = sub.dunningStartedAt ?? new Date();
        const dayInCycle = Math.floor((Date.now() - startedAt.getTime()) / 86_400_000);
        const attemptsSoFar = (sub.dunningAttempts ?? 0) + 1;

        // A hard failure means this instrument will never work. Retrying it just
        // burns the ladder while the customer waits for an email nobody sent;
        // what unblocks them is a new payment method.
        if (failureClass === 'hard') {
            const changed = await this.prisma.$transaction(async (tx: any) => {
                // Approval and dunning use the same attempt -> subscription lock
                // order. If a late APPROVED webhook won, its succeeded status is
                // visible here and we must not poison an otherwise valid source.
                await tx.$queryRaw`
                    SELECT id FROM billing_charge_attempts
                     WHERE id = ${attempt.id}::uuid
                     FOR UPDATE
                `;
                const lockedAttempt = await tx.billingChargeAttempt.findUnique({ where: { id: attempt.id } });
                if (lockedAttempt?.status !== 'failed') return false;

                await tx.$queryRaw`
                    SELECT id FROM billing_subscriptions
                     WHERE id = ${sub.id}::uuid
                     FOR UPDATE
                `;
                const lockedSub = await tx.billingSubscription.findUnique({ where: { id: sub.id } });
                if (!lockedSub
                    || lockedSub.status !== sub.status
                    || lockedSub.currentPeriodEnd?.getTime() !== sub.currentPeriodEnd?.getTime()
                    || lockedSub.dunningState !== sub.dunningState
                    || lockedSub.dunningStartedAt?.getTime() !== sub.dunningStartedAt?.getTime()) {
                    return false;
                }
                const transitioned = await tx.billingSubscription.updateMany({
                    where: {
                        id: sub.id,
                        status: sub.status,
                        currentPeriodEnd: sub.currentPeriodEnd ?? null,
                        dunningState: sub.dunningState,
                        dunningStartedAt: sub.dunningStartedAt,
                    },
                    data: {
                        dunningState: 'grace',
                        dunningStartedAt: startedAt,
                        dunningAttempts: attemptsSoFar,
                    },
                });
                if (transitioned.count !== 1) return false;
                if (lockedAttempt.paymentSourceId) {
                    await tx.billingPaymentSource.update({
                        where: { id: lockedAttempt.paymentSourceId },
                        data: { status: 'failed', lastFailureAt: new Date() },
                    });
                }
                return true;
            });
            if (!changed) return;
            await this.invalidateEntitlementCaches(sub.tenantId);
            this.eventEmitter.emit(BillingEventType.PAYMENT_FAILED, {
                tenantId: sub.tenantId,
                subscriptionId: sub.id,
                requiresNewPaymentMethod: true,
            });
            this.logger.warn(
                `[Dunning] Subscription ${sub.id}: payment method rejected permanently — waiting for a new one`,
            );
            return;
        }

        if (dayInCycle >= DUNNING_EXPIRY_DAY) {
            await this.expire(sub);
            return;
        }

        if (dayInCycle >= DUNNING_SOFT_LOCK_DAY) {
            if (!(await this.softLock(sub, startedAt, attemptsSoFar))) return;
        } else {
            const changed = await this.prisma.billingSubscription.updateMany({
                where: {
                    id: sub.id,
                    status: sub.status,
                    currentPeriodEnd: sub.currentPeriodEnd ?? null,
                    dunningState: sub.dunningState,
                    dunningStartedAt: sub.dunningStartedAt,
                },
                data: {
                    dunningState: 'retrying',
                    dunningStartedAt: startedAt,
                    dunningAttempts: attemptsSoFar,
                },
            });
            if (changed.count !== 1) return;
        }

        // Attempts happen at day 0, 1, 3 and 7. Reaching attempt four does NOT
        // expire on day 7; the account remains soft-locked until the day-10
        // clock transition below. This keeps the documented recovery window.
        const nextStep = LADDER.find((s) => s.day > dayInCycle);
        if (nextStep && nextStep.action !== 'expire' && attemptsSoFar < LAST_RETRY_ATTEMPT) {
            await this.scheduleRetry(sub, attempt, attemptsSoFar + 1, nextStep.day - dayInCycle);
        } else {
            const dunningState = dayInCycle >= DUNNING_SOFT_LOCK_DAY ? 'soft_lock' : 'grace';
            await this.prisma.billingSubscription.updateMany({
                where: {
                    id: sub.id,
                    currentPeriodEnd: sub.currentPeriodEnd ?? null,
                    status: dayInCycle >= DUNNING_SOFT_LOCK_DAY
                        ? SubscriptionStatus.PAST_DUE
                        : sub.status,
                    dunningState,
                },
                data: {
                    dunningState,
                    dunningStartedAt: startedAt,
                    dunningAttempts: attemptsSoFar,
                },
            });
            if (dunningState === 'grace') {
                await this.invalidateEntitlementCaches(sub.tenantId);
            }
        }
    }

    /**
     * Time-only rungs must not depend on another bank decline arriving. This is
     * especially important for hard failures: no retry is scheduled, so without
     * this sweep `grace` would last forever.
     */
    @Cron('*/30 * * * *')
    async advanceWaitingStatesCron(): Promise<void> {
        await this.cronLock.runExclusive('billing.dunning.timeTransitions', 900, () => this.advanceWaitingStates());
    }

    async advanceWaitingStates(now = new Date()): Promise<{ softLocked: number; expired: number }> {
        const rows = await this.prisma.billingSubscription.findMany({
            where: {
                engine: 'internal',
                dunningState: { in: ['retrying', 'grace', 'soft_lock'] },
                dunningStartedAt: { not: null },
                status: { notIn: [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED] },
            },
            take: 500,
        });
        let softLocked = 0;
        let expired = 0;
        for (const sub of rows) {
            const elapsedDays = Math.floor(
                (now.getTime() - sub.dunningStartedAt!.getTime()) / 86_400_000,
            );
            if (elapsedDays >= DUNNING_EXPIRY_DAY) {
                if (await this.hasLiveAttempt(sub.id)) continue;
                if (await this.expire(sub)) expired++;
            } else if (elapsedDays >= DUNNING_SOFT_LOCK_DAY && sub.dunningState !== 'soft_lock') {
                if (await this.softLock(sub, sub.dunningStartedAt!, sub.dunningAttempts)) softLocked++;
            }
        }
        return { softLocked, expired };
    }

    /**
     * Queue the next attempt for the SAME cycle.
     *
     * A new row with `attempt_number + 1` and its own reference, never a replay
     * of the previous request: the provider has no idempotency key, so reusing a
     * reference risks a charge landing twice for one period.
     */
    private async scheduleRetry(
        sub: any,
        previous: any,
        attemptNumber: number,
        daysAhead: number,
    ): Promise<void> {
        // `daysAhead === 0` means "charge now" — the customer just added a new
        // payment method. Clamping it to a day would leave them locked out for
        // 24h after doing exactly what we asked. Negative values (a ladder that
        // fell behind) also mean now.
        const delayMs = Math.max(0, daysAhead) * 86_400_000;
        const scheduledAt = new Date(Date.now() + delayMs);
        const previousMetadata = previous.metadata && typeof previous.metadata === 'object'
            ? previous.metadata as Record<string, unknown>
            : {};

        const claim = await this.engine.claimAttempt({
            subscriptionId: sub.id,
            tenantId: sub.tenantId,
            provider: sub.provider as PaymentProviderName,
            purpose: previous.purpose,
            periodStart: previous.periodStart,
            periodEnd: previous.periodEnd,
            amountCents: previous.amountCents,
            currency: previous.currency,
            scheduledAt,
            paymentSourceId: sub.defaultPaymentSourceId,
            attemptNumber,
            // Initial/upgrade operations use a stable identity independent of
            // UTC date. Every dunning attempt must remain in that same cycle,
            // and upgrade retries must retain the target-price settlement data.
            operationKey: typeof previousMetadata.operationKey === 'string'
                ? previousMetadata.operationKey
                : undefined,
            metadata: previousMetadata,
        });
        if (!claim) {
            this.logger.debug(`[Dunning] Retry ${attemptNumber} for ${sub.id} was already claimed`);
            return;
        }

        await this.renewalQueue.add(
            'charge',
            { attemptId: claim.id },
            { jobId: claim.id, attempts: 1, delay: delayMs, removeOnComplete: { age: 604_800 } },
        );
        this.logger.log(
            `[Dunning] Subscription ${sub.id}: retry ${attemptNumber} scheduled for ${scheduledAt.toISOString()}`,
        );
    }

    private async softLock(sub: any, startedAt: Date, attempts: number): Promise<boolean> {
        const transitioned = await this.prisma.$transaction(async (tx: any) => {
            const updated = await tx.billingSubscription.updateMany({
                where: {
                    id: sub.id,
                    dunningStartedAt: startedAt,
                    dunningState: sub.dunningState,
                    status: sub.status,
                    currentPeriodEnd: sub.currentPeriodEnd ?? null,
                },
                data: {
                    status: SubscriptionStatus.PAST_DUE,
                    dunningState: 'soft_lock',
                    dunningStartedAt: startedAt,
                    dunningAttempts: attempts,
                },
            });
            if (updated.count !== 1) return false;
            await tx.tenant.update({
                where: { id: sub.tenantId },
                data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
            });
            return true;
        });
        if (!transitioned) return false;
        await this.invalidateEntitlementCaches(sub.tenantId);

        this.eventEmitter.emit('billing.subscription.soft_locked', {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            daysRemaining: DUNNING_EXPIRY_DAY
                - Math.floor((Date.now() - startedAt.getTime()) / 86_400_000),
        });
        this.logger.warn(`[Dunning] Subscription ${sub.id} soft-locked after repeated failures`);
        return true;
    }

    private async expire(sub: any): Promise<boolean> {
        const transitioned = await this.prisma.$transaction(async (tx: any) => {
            const updated = await tx.billingSubscription.updateMany({
                where: {
                    id: sub.id,
                    dunningStartedAt: sub.dunningStartedAt,
                    dunningState: sub.dunningState,
                    status: sub.status,
                    currentPeriodEnd: sub.currentPeriodEnd ?? null,
                },
                data: {
                    status: SubscriptionStatus.EXPIRED,
                    dunningState: 'suspended',
                },
            });
            if (updated.count !== 1) return false;
            await tx.tenant.update({
                where: { id: sub.tenantId },
                data: { subscriptionStatus: SubscriptionStatus.EXPIRED },
            });
            return true;
        });
        if (!transitioned) return false;
        await this.invalidateEntitlementCaches(sub.tenantId);

        this.eventEmitter.emit(BillingEventType.SUBSCRIPTION_EXPIRED, {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
        });
        this.logger.warn(`[Dunning] Subscription ${sub.id} expired — recovery window exhausted`);
        return true;
    }

    /**
     * Entitlement readers cache the plan and subscription status independently.
     * A stale value after a dunning transition can keep paid features enabled,
     * so all three views must be evicted together. Redis is an optimisation,
     * however: a cache outage must never roll back the durable billing state.
     */
    private async invalidateEntitlementCaches(tenantId: string): Promise<void> {
        const keys = [
            `sub_status:${tenantId}`,
            `tenant_plan:${tenantId}`,
            `plan_features:${tenantId}`,
        ];
        await Promise.all(keys.map(async (key) => {
            try {
                await this.redis.del(key);
            } catch (err: any) {
                this.logger.warn(`[Dunning] Could not invalidate ${key}: ${err?.message ?? String(err)}`);
            }
        }));
    }

    /**
     * A new payment method arrived — charge immediately instead of waiting for
     * the next rung of the ladder.
     *
     * The customer just did the one thing that unblocks them; making them wait
     * days for a scheduled retry (while the service stays locked) would be the
     * exact opposite of what they expect.
     */
    @OnEvent('billing.payment_source.added')
    async onPaymentSourceAdded(payload: { tenantId: string; subscriptionId?: string }): Promise<void> {
        if (!payload?.subscriptionId) return;
        try {
            const sub = await this.prisma.billingSubscription.findUnique({
                where: { id: payload.subscriptionId },
            });
            if (!sub || sub.engine !== 'internal') return;
            if (!['retrying', 'grace', 'soft_lock'].includes(sub.dunningState)) return;

            const lastAttempt = await this.prisma.billingChargeAttempt.findFirst({
                where: { subscriptionId: sub.id, status: { in: ['failed', 'abandoned'] } },
                orderBy: { createdAt: 'desc' },
            });
            if (!lastAttempt) return;

            await this.scheduleRetry(sub, lastAttempt, (lastAttempt.attemptNumber ?? 1) + 1, 0);
            this.logger.log(`[Dunning] Subscription ${sub.id}: retrying now with the new payment method`);
        } catch (err: any) {
            this.logger.error(`[Dunning] Could not retry after a new payment method: ${err?.message}`);
        }
    }

    /**
     * True when a subscription has a charge still in play.
     *
     * The offboarding cron asks this before cutting service: suspending a tenant
     * whose payment is mid-flight — or whose outcome is unknown — would revoke
     * access to someone who may have already paid.
     */
    async hasLiveAttempt(subscriptionId: string): Promise<boolean> {
        const live = await this.prisma.billingChargeAttempt.count({
            where: {
                subscriptionId,
                status: { in: ['scheduled', 'in_flight', 'pending_provider'] },
            },
        });
        return live > 0;
    }
}
