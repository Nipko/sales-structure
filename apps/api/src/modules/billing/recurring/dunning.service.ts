import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingEventType } from '../types/billing-event.enum';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { PaymentProviderName } from '../types/provider-types';
import { FailureClass, SubscriptionEngineService } from './subscription-engine.service';
import { RENEWAL_QUEUE } from './renewal-scheduler.service';

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
const LADDER: Array<{ day: number; action: 'retry' | 'soft_lock' | 'expire' }> = [
    { day: 1, action: 'retry' },
    { day: 3, action: 'soft_lock' },
    { day: 7, action: 'retry' },
    { day: 10, action: 'expire' },
];

const MAX_ATTEMPTS = 4;

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

        // An unknown outcome freezes the ladder. Advancing it could cut service
        // for a charge that actually succeeded, and could authorise another
        // charge for a period that may already be paid.
        if (failureClass === 'indeterminate') {
            await this.prisma.billingSubscription.update({
                where: { id: sub.id },
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
            await this.markSourceUnusable(attempt.paymentSourceId);
            await this.prisma.billingSubscription.update({
                where: { id: sub.id },
                data: {
                    dunningState: 'grace',
                    dunningStartedAt: startedAt,
                    dunningAttempts: attemptsSoFar,
                },
            });
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

        const step = LADDER.find((s) => s.day > dayInCycle) ?? LADDER[LADDER.length - 1];

        if (attemptsSoFar >= MAX_ATTEMPTS || step.action === 'expire') {
            await this.expire(sub);
            return;
        }

        if (step.action === 'soft_lock') {
            await this.softLock(sub, startedAt, attemptsSoFar);
        } else {
            await this.prisma.billingSubscription.update({
                where: { id: sub.id },
                data: {
                    dunningState: 'retrying',
                    dunningStartedAt: startedAt,
                    dunningAttempts: attemptsSoFar,
                },
            });
        }

        await this.scheduleRetry(sub, attempt, attemptsSoFar + 1, step.day - dayInCycle);
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

    private async softLock(sub: any, startedAt: Date, attempts: number): Promise<void> {
        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                status: SubscriptionStatus.PAST_DUE,
                dunningState: 'soft_lock',
                dunningStartedAt: startedAt,
                dunningAttempts: attempts,
            },
        });
        await this.prisma.tenant.update({
            where: { id: sub.tenantId },
            data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
        }).catch(() => undefined);

        this.eventEmitter.emit('billing.subscription.soft_locked', {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            daysRemaining: 10 - Math.floor((Date.now() - startedAt.getTime()) / 86_400_000),
        });
        this.logger.warn(`[Dunning] Subscription ${sub.id} soft-locked after repeated failures`);
    }

    private async expire(sub: any): Promise<void> {
        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                status: SubscriptionStatus.EXPIRED,
                dunningState: 'suspended',
            },
        });
        await this.prisma.tenant.update({
            where: { id: sub.tenantId },
            data: { subscriptionStatus: SubscriptionStatus.EXPIRED },
        }).catch(() => undefined);

        this.eventEmitter.emit(BillingEventType.SUBSCRIPTION_EXPIRED, {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
        });
        this.logger.warn(`[Dunning] Subscription ${sub.id} expired — recovery window exhausted`);
    }

    private async markSourceUnusable(paymentSourceId: string | null): Promise<void> {
        if (!paymentSourceId) return;
        await this.prisma.billingPaymentSource.update({
            where: { id: paymentSourceId },
            data: { status: 'failed', lastFailureAt: new Date() },
        }).catch(() => undefined);
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
