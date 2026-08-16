import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CronLockService } from '../../redis/cron-lock.service';
import { SubscriptionEngineService } from './subscription-engine.service';
import { PaymentProviderName } from '../types/provider-types';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { jitterMinutes, timezoneOffsetMinutes } from './period.util';

export const RENEWAL_QUEUE = 'billing-renewals';
export const CHARGE_POLL_QUEUE = 'billing-charge-poll';

/** How far ahead of its due time an attempt is claimed and queued. */
const LOOKAHEAD_MS = 15 * 60_000;

/**
 * Daily ceiling the merchant may charge, in COP cents. Wompi caps this per
 * merchant, and blowing through it means every remaining renewal of the day is
 * refused — so the scheduler stops short and defers instead.
 */
const DAILY_CAP_WARN_RATIO = 0.8;

export const COP_CENTS_PER_COP = 100;

/** Wompi's ceiling belongs to the platform merchant, not each tenant timezone. */
export function wompiMerchantTimezone(): string {
    const configured = String(process.env.WOMPI_MERCHANT_TIMEZONE || 'America/Bogota').trim();
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());
        return configured;
    } catch {
        return 'America/Bogota';
    }
}

/** Calendar key in the merchant operating timezone (never UTC by accident). */
export function billingLocalDayKey(at: Date, timezone: string): string {
    const shifted = new Date(at.getTime() + timezoneOffsetMinutes(at, timezone) * 60_000);
    return [
        shifted.getUTCFullYear(),
        String(shifted.getUTCMonth() + 1).padStart(2, '0'),
        String(shifted.getUTCDate()).padStart(2, '0'),
    ].join('-');
}

/** Tomorrow at a local wall-clock hour, converted back to an instant. */
export function nextBillingLocalDay(at: Date, timezone: string, hourLocal = 9): Date {
    const currentOffset = timezoneOffsetMinutes(at, timezone);
    const local = new Date(at.getTime() + currentOffset * 60_000);
    const wallClock = Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() + 1,
        hourLocal,
    );
    // Re-evaluate the offset at the target for timezones with DST.
    let target = new Date(wallClock - currentOffset * 60_000);
    target = new Date(wallClock - timezoneOffsetMinutes(target, timezone) * 60_000);
    return target;
}

/** Parse a money limit expressed in the same minor unit as BillingPayment. */
export function parsePositiveCentLimit(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function wompiTransactionLimitViolation(amountCents: number, currency: string):
    | { error: 'wompi_transaction_limit_not_configured' | 'wompi_transaction_limit_exceeded'; limitCents: number | null }
    | null {
    if (currency.toUpperCase() !== 'COP') return null;
    const limit = parsePositiveCentLimit(process.env.WOMPI_MAX_TRANSACTION_COP_CENTS);
    if (!limit) return { error: 'wompi_transaction_limit_not_configured', limitCents: null };
    if (amountCents > limit) return { error: 'wompi_transaction_limit_exceeded', limitCents: limit };
    return null;
}

/**
 * Decides WHEN to charge. It never charges.
 *
 * Splitting the decision from the execution is what makes the engine safe to run
 * twice: the scheduler's only side effect is claiming an attempt row, and that
 * claim is protected by a unique index. Two schedulers racing produce one row,
 * one job and one charge.
 */
@Injectable()
export class RenewalSchedulerService {
    private readonly logger = new Logger(RenewalSchedulerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly cronLock: CronLockService,
        private readonly engine: SubscriptionEngineService,
        @InjectQueue(RENEWAL_QUEUE) private readonly renewalQueue: Queue,
    ) {}

    /**
     * TTL is half the interval so a stuck run cannot hold the lock past the next
     * tick. The lock is a courtesy anyway — it fails open, and the real
     * protection against double charging is the unique index on the attempt.
     */
    @Cron('*/10 * * * *')
    async scheduleRenewalsCron(): Promise<void> {
        await this.cronLock.runExclusive('billing.renewalScheduler', 300, () => this.scheduleRenewals());
    }

    async scheduleRenewals(): Promise<{ scanned: number; scheduled: number; deferred: number }> {
        const now = new Date();
        const lookahead = new Date(now.getTime() + LOOKAHEAD_MS);
        const due = await this.prisma.billingSubscription.findMany({
            where: {
                engine: 'internal',
                status: {
                    in: [
                        SubscriptionStatus.ACTIVE,
                        SubscriptionStatus.TRIALING,
                        SubscriptionStatus.PAST_DUE,
                        SubscriptionStatus.PENDING_AUTH,
                    ],
                },
                nextChargeAt: { lte: lookahead },
                cancelAtPeriodEnd: false,
                // A plan-change transaction owns the next money movement.
                // Filtering here avoids new snapshots; revalidation below the
                // worker is the second line of defence for a snapshot read just
                // before the pending intent committed.
                pendingUpgradePlanId: null,
                // A downgrade that is effective at/before this charge must be
                // applied first. Otherwise a twin cron can freeze the old amount
                // in an attempt and race the plan-change cron. Null needs an
                // explicit OR in Prisma; `gt` alone excludes it.
                OR: [
                    { pendingPlanId: null },
                    { pendingPlanChangeAt: null },
                    { pendingPlanChangeAt: { gt: lookahead } },
                ],
            },
            take: 500,
            orderBy: { nextChargeAt: 'asc' },
        });

        let scheduled = 0;
        let deferred = 0;

        for (const sub of due) {
            try {
                // PENDING_AUTH zero-day subscriptions charge the period already
                // opened at acquisition. ACTIVE/TRIALING renewals start a new
                // period at currentPeriodEnd. Mixing those semantics creates a
                // second initial charge one month ahead.
                const cycle = sub.status === SubscriptionStatus.PENDING_AUTH
                    && sub.currentPeriodStart
                    && sub.currentPeriodEnd
                    ? {
                        periodStart: sub.currentPeriodStart,
                        periodEnd: sub.currentPeriodEnd,
                        // The query requires nextChargeAt <= lookahead, but the
                        // generated Prisma type remains nullable. Preserve a
                        // safe fallback for hand-repaired legacy rows.
                        scheduledAt: sub.nextChargeAt ?? new Date(),
                        anchorDay: sub.billingAnchorDay,
                        timezone: sub.billingTimezone || 'America/Bogota',
                    }
                    : this.engine.computeNextCycle(sub as any);
                const amount = sub.chargeAmountCents;
                const currency = sub.chargeCurrency;

                if (!amount || !currency) {
                    this.logger.warn(
                        `[Scheduler] Subscription ${sub.id} has no frozen amount/currency — skipping. `
                        + 'The engine must never invent a price at charge time.',
                    );
                    continue;
                }

                if (sub.provider === 'wompi') {
                    const violation = wompiTransactionLimitViolation(amount, currency);
                    if (violation) {
                        await this.prisma.billingSubscription.update({
                            where: { id: sub.id },
                            data: { dunningState: 'indeterminate' },
                        });
                        this.logger.error(
                            `[Scheduler] Subscription ${sub.id} cannot be charged: ${violation.error} `
                            + `(amount=${amount} cents, limit=${violation.limitCents ?? 'missing'}).`,
                        );
                        continue;
                    }
                }

                const latestForCycle = await this.prisma.billingChargeAttempt.findFirst({
                    where: {
                        subscriptionId: sub.id,
                        purpose: sub.status === SubscriptionStatus.TRIALING
                            || sub.status === SubscriptionStatus.PENDING_AUTH
                            ? 'initial'
                            : 'renewal',
                        periodStart: cycle.periodStart,
                    },
                    orderBy: { attemptNumber: 'desc' },
                });
                const recoverableTerminal = latestForCycle
                    && ['abandoned', 'superseded', 'stale'].includes(latestForCycle.status);
                if (latestForCycle && !recoverableTerminal) continue;

                const claim = await this.engine.claimAttempt({
                    subscriptionId: sub.id,
                    tenantId: sub.tenantId,
                    provider: sub.provider as PaymentProviderName,
                    purpose: sub.status === SubscriptionStatus.TRIALING
                        || sub.status === SubscriptionStatus.PENDING_AUTH
                        ? 'initial'
                        : 'renewal',
                    periodStart: cycle.periodStart,
                    periodEnd: cycle.periodEnd,
                    amountCents: amount,
                    currency,
                    scheduledAt: cycle.scheduledAt,
                    paymentSourceId: sub.defaultPaymentSourceId,
                    attemptNumber: recoverableTerminal ? latestForCycle.attemptNumber + 1 : 1,
                });

                // Already claimed by the twin run — the expected quiet outcome.
                if (!claim) continue;

                await this.enqueueCharge(claim.id, sub.id, cycle.scheduledAt);
                scheduled++;
            } catch (err: any) {
                this.logger.error(`[Scheduler] Failed to schedule subscription ${sub.id}: ${err?.message}`);
            }
        }

        if (scheduled || deferred) {
            this.logger.log(`[Scheduler] scanned=${due.length} scheduled=${scheduled} deferred=${deferred}`);
        }
        return { scanned: due.length, scheduled, deferred };
    }

    /**
     * Queue the charge.
     *
     * `attempts: 1` is deliberate and load-bearing: the charge POST is not
     * idempotent, so letting BullMQ retry it would be a second charge. Retries
     * are a billing decision made by the dunning policy, which creates a NEW
     * attempt row with its own reference — never a transport-level replay.
     *
     * The jitter spreads renewals through a window so they do not all hit the
     * provider in the same second.
     */
    private async enqueueCharge(attemptId: string, subscriptionId: string, scheduledAt = new Date()): Promise<void> {
        const dueDelay = Math.max(0, scheduledAt.getTime() - Date.now());
        await this.renewalQueue.add(
            'charge',
            { attemptId },
            {
                // The attempt id doubles as the job id: a uuid, and crucially
                // free of ':' — BullMQ rejects that character in job ids, which
                // already cost this project an outbound-delivery incident.
                jobId: attemptId,
                attempts: 1,
                removeOnComplete: { age: 604_800 },
                removeOnFail: false,
                delay: dueDelay + jitterMinutes(subscriptionId) * 60_000,
            },
        );
    }

    /**
     * Re-queue attempts whose job vanished (Redis flush, queue drain).
     *
     * The queue is not the source of truth — the ledger is. Without this sweep a
     * lost job would silently mean an unbilled month.
     */
    @Cron('*/30 * * * *')
    async rescueOrphanAttemptsCron(): Promise<void> {
        await this.cronLock.runExclusive('billing.rescueOrphanAttempts', 900, () => this.rescueOrphanAttempts());
    }

    async rescueOrphanAttempts(): Promise<{ requeued: number }> {
        const stuck = await this.prisma.billingChargeAttempt.findMany({
            where: {
                status: 'scheduled',
                scheduledAt: { lt: new Date(Date.now() - 30 * 60_000) },
            },
            take: 200,
        });

        let requeued = 0;
        for (const attempt of stuck) {
            const existing = await this.renewalQueue.getJob(attempt.id).catch(() => null);
            if (existing) continue;
            await this.enqueueCharge(attempt.id, attempt.subscriptionId, attempt.scheduledAt);
            requeued++;
        }
        if (requeued) this.logger.warn(`[Scheduler] Re-queued ${requeued} orphaned charge attempt(s)`);
        return { requeued };
    }

    // -------------------------------------------------------------------------
    // Daily cap
    // -------------------------------------------------------------------------

    /**
     * Reserve room against the merchant's daily ceiling.
     *
     * Counted as it is scheduled rather than after the fact: once the provider
     * starts refusing for exceeding the cap, every remaining renewal of the day
     * fails, and the customers who happen to be later in the queue are the ones
     * who get hurt.
     */
    async reserveDailyCapacity(
        amountCents: number,
        currency: string,
        provider: string,
        attemptId: string,
        timezone = wompiMerchantTimezone(),
    ): Promise<boolean> {
        if (provider !== 'wompi' || currency !== 'COP') return true;
        const dailyCapCopCents = parsePositiveCentLimit(process.env.WOMPI_DAILY_CAP_COP_CENTS);
        if (!dailyCapCopCents) {
            this.logger.error(
                '[Scheduler] WOMPI_DAILY_CAP_COP_CENTS is missing/invalid — deferring COP charges instead of assuming a merchant limit.',
            );
            return false;
        }
        const now = new Date();
        const key = `billing:renewal:cop:${billingLocalDayKey(now, timezone)}`;
        const marker = `${key}:attempt:${attemptId}`;
        const expiresInSeconds = Math.max(
            3_600,
            Math.ceil((nextBillingLocalDay(now, timezone, 0).getTime() - now.getTime()) / 1_000) + 86_400,
        );
        try {
            const total = Number(await this.redis.getClient().eval(
                `if redis.call('exists', KEYS[2]) == 1 then
                    return tonumber(redis.call('get', KEYS[1]) or '0')
                 end
                 local current = tonumber(redis.call('get', KEYS[1]) or '0')
                 local amount = tonumber(ARGV[1])
                 local cap = tonumber(ARGV[2])
                 if current + amount > cap then return -1 end
                 local next = redis.call('incrby', KEYS[1], amount)
                 redis.call('expire', KEYS[1], ARGV[3])
                 redis.call('set', KEYS[2], '1', 'EX', ARGV[3])
                 return next`,
                2,
                key,
                marker,
                String(amountCents),
                String(dailyCapCopCents),
                String(expiresInSeconds),
            ));

            if (total < 0) {
                this.logger.error(
                    `[Scheduler] Daily charge cap reached (${dailyCapCopCents} COP cents) — deferring renewals to tomorrow`,
                );
                return false;
            }
            if (total > dailyCapCopCents * DAILY_CAP_WARN_RATIO) {
                this.logger.warn(
                    `[Scheduler] At ${Math.round((total / dailyCapCopCents) * 100)}% of the daily charge cap`,
                );
            }
            return true;
        } catch (err: any) {
            // We cannot prove room under the merchant's contractual ceiling.
            // Fail closed and leave the durable attempt schedulable for the
            // next merchant day; a blind POST could reject the remaining cohort
            // or exceed a negotiated operating limit.
            this.logger.error(`[Scheduler] Could not track the daily cap (${err?.message}) — deferring`);
            return false;
        }
    }

    private async deferAttemptToNextDay(attemptId: string, subscriptionId: string, timezone: string): Promise<Date> {
        const tomorrow = nextBillingLocalDay(new Date(), timezone);
        await this.prisma.$transaction([
            this.prisma.billingChargeAttempt.update({
                where: { id: attemptId },
                data: {
                    status: 'superseded',
                    failureCode: 'daily_capacity_deferred',
                    settledAt: new Date(),
                },
            }),
            this.prisma.billingSubscription.update({
                where: { id: subscriptionId },
                data: { nextChargeAt: tomorrow },
            }),
        ]);
        // Do not enqueue this attempt directly. Tomorrow's scheduler will claim
        // attempt N+1 and reserve against tomorrow's local-day bucket before it
        // can reach the processor. Reusing the already-reserved attempt would
        // bypass the new day's cap entirely.
        this.logger.warn(`[Scheduler] Subscription ${subscriptionId} deferred to ${tomorrow.toISOString()} (daily cap)`);
        return tomorrow;
    }
}
