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
import { jitterMinutes } from './period.util';

export const RENEWAL_QUEUE = 'billing-renewals';
export const CHARGE_POLL_QUEUE = 'billing-charge-poll';

/** How far ahead of its due time an attempt is claimed and queued. */
const LOOKAHEAD_MS = 15 * 60_000;

/**
 * Daily ceiling the merchant may charge, in COP cents. Wompi caps this per
 * merchant, and blowing through it means every remaining renewal of the day is
 * refused — so the scheduler stops short and defers instead.
 */
const DAILY_CAP_COP_CENTS = Number(process.env.WOMPI_DAILY_CAP_COP_CENTS || 8_000_000_00);
const DAILY_CAP_WARN_RATIO = 0.8;

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
        const due = await this.prisma.billingSubscription.findMany({
            where: {
                engine: 'internal',
                status: {
                    in: [
                        SubscriptionStatus.ACTIVE,
                        SubscriptionStatus.TRIALING,
                        SubscriptionStatus.PAST_DUE,
                    ],
                },
                nextChargeAt: { lte: new Date(Date.now() + LOOKAHEAD_MS) },
                cancelAtPeriodEnd: false,
            },
            take: 500,
            orderBy: { nextChargeAt: 'asc' },
        });

        let scheduled = 0;
        let deferred = 0;

        for (const sub of due) {
            try {
                const cycle = this.engine.computeNextCycle(sub as any);
                const amount = sub.chargeAmountCents;
                const currency = sub.chargeCurrency;

                if (!amount || !currency) {
                    this.logger.warn(
                        `[Scheduler] Subscription ${sub.id} has no frozen amount/currency — skipping. `
                        + 'The engine must never invent a price at charge time.',
                    );
                    continue;
                }

                // Stop before the provider starts refusing everything.
                if (!(await this.reserveDailyCapacity(amount, currency))) {
                    await this.deferToNextDay(sub.id, cycle.timezone);
                    deferred++;
                    continue;
                }

                const claim = await this.engine.claimAttempt({
                    subscriptionId: sub.id,
                    tenantId: sub.tenantId,
                    provider: sub.provider as PaymentProviderName,
                    purpose: sub.status === SubscriptionStatus.TRIALING ? 'initial' : 'renewal',
                    periodStart: cycle.periodStart,
                    periodEnd: cycle.periodEnd,
                    amountCents: amount,
                    currency,
                    scheduledAt: cycle.scheduledAt,
                    paymentSourceId: sub.defaultPaymentSourceId,
                });

                // Already claimed by the twin run — the expected quiet outcome.
                if (!claim) continue;

                await this.enqueueCharge(claim.id, sub.id);
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
    private async enqueueCharge(attemptId: string, subscriptionId: string): Promise<void> {
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
                delay: jitterMinutes(subscriptionId) * 60_000,
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
            await this.enqueueCharge(attempt.id, attempt.subscriptionId);
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
    private async reserveDailyCapacity(amountCents: number, currency: string): Promise<boolean> {
        if (currency !== 'COP') return true; // The cap is provider- and currency-specific.
        const key = `billing:renewal:cop:${new Date().toISOString().slice(0, 10)}`;
        try {
            const total = await this.redis.incrBy(key, amountCents);
            await this.redis.expire(key, 172_800);

            if (total > DAILY_CAP_COP_CENTS) {
                await this.redis.incrBy(key, -amountCents); // give the room back
                this.logger.error(
                    `[Scheduler] Daily charge cap reached (${DAILY_CAP_COP_CENTS} COP cents) — deferring renewals to tomorrow`,
                );
                return false;
            }
            if (total > DAILY_CAP_COP_CENTS * DAILY_CAP_WARN_RATIO) {
                this.logger.warn(
                    `[Scheduler] At ${Math.round((total / DAILY_CAP_COP_CENTS) * 100)}% of the daily charge cap`,
                );
            }
            return true;
        } catch (err: any) {
            // Redis down: charging is more important than the cap, and the
            // provider enforces its own limit anyway.
            this.logger.warn(`[Scheduler] Could not track the daily cap (${err?.message}) — proceeding`);
            return true;
        }
    }

    private async deferToNextDay(subscriptionId: string, timezone: string): Promise<void> {
        const tomorrow = new Date(Date.now() + 24 * 3_600_000);
        await this.prisma.billingSubscription.update({
            where: { id: subscriptionId },
            data: { nextChargeAt: tomorrow },
        });
        this.logger.warn(`[Scheduler] Subscription ${subscriptionId} deferred to ${tomorrow.toISOString()} (daily cap)`);
    }
}
