import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingCycle } from '../types/provider-types';
import { calendarDaysBetween, nextPeriodEnd } from './period.util';

/**
 * Below this, charging costs more than it collects.
 *
 * The provider takes a fixed fee per transaction on top of the percentage, so a
 * tiny proration is a transaction we lose money on — and one more line on the
 * customer's statement for no reason. It goes to credit instead.
 */
const MIN_CHARGE_CENTS = 200_000; // COP 2.000

export interface ProrationResult {
    /** What to charge now. Zero means the difference was absorbed as credit. */
    chargeCents: number;
    /** Value of the unused part of the current period. */
    unusedCents: number;
    /** Credit applied from the tenant's balance. */
    creditAppliedCents: number;
    /** Credit generated (a downgrade, or a charge below the minimum). */
    creditGeneratedCents: number;
    periodStart: Date;
    periodEnd: Date;
    reason: string;
}

/**
 * Works out what a plan change is actually worth in money.
 *
 * Providers with native subscriptions do this for us; ours does not, so the
 * arithmetic lives here — deliberately apart from the code that charges, so it
 * can be reasoned about and tested without a provider in the loop.
 *
 * Everything is computed in the CHARGE currency (COP cents). Converting through
 * USD would introduce rounding the customer can see on their statement.
 */
@Injectable()
export class ProrationService {
    private readonly logger = new Logger(ProrationService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Upgrade, or a switch to a longer cycle: starts a NEW period now and
     * credits whatever the customer already paid for the days they will not use.
     */
    computeUpgrade(input: {
        now: Date;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
        /** What was ACTUALLY paid for the current period — not the list price, so
         *  coupons and country overrides are respected. */
        paidCents: number;
        newAmountCents: number;
        targetCycle: BillingCycle;
        anchorDay: number;
        timezone: string;
        creditBalanceCents?: number;
    }): ProrationResult {
        const totalDays = calendarDaysBetween(input.currentPeriodStart, input.currentPeriodEnd, input.timezone);
        const remainingDays = calendarDaysBetween(input.now, input.currentPeriodEnd, input.timezone);

        const unusedCents = totalDays > 0
            ? Math.round((input.paidCents * remainingDays) / totalDays)
            : 0;

        const creditBalance = input.creditBalanceCents ?? 0;
        const gross = input.newAmountCents - unusedCents;
        const creditApplied = Math.max(0, Math.min(creditBalance, gross));
        const net = gross - creditApplied;

        const periodStart = input.now;
        const periodEnd = nextPeriodEnd(periodStart, input.targetCycle, input.anchorDay);

        // The customer had more value left than the new plan costs (a mid-cycle
        // move to a cheaper-but-longer plan, say). Bank it rather than charging
        // a negative amount.
        if (net <= 0) {
            return {
                chargeCents: 0,
                unusedCents,
                creditAppliedCents: creditApplied,
                creditGeneratedCents: Math.abs(net),
                periodStart,
                periodEnd,
                reason: 'covered_by_unused_time',
            };
        }

        if (net < MIN_CHARGE_CENTS) {
            return {
                chargeCents: 0,
                unusedCents,
                creditAppliedCents: creditApplied,
                creditGeneratedCents: 0,
                periodStart,
                periodEnd,
                reason: 'below_minimum_charge',
            };
        }

        return {
            chargeCents: net,
            unusedCents,
            creditAppliedCents: creditApplied,
            creditGeneratedCents: 0,
            periodStart,
            periodEnd,
            reason: 'upgrade',
        };
    }

    /**
     * Downgrade. **No money is ever returned**: the provider has no refund API,
     * so promising a refund here would be a promise we cannot keep. The unused
     * value becomes credit against future charges instead, and the change takes
     * effect at the end of the paid period — the customer keeps what they paid for.
     */
    computeDowngrade(input: {
        now: Date;
        currentPeriodEnd: Date;
        immediate: boolean;
        currentPeriodStart?: Date;
        paidCents?: number;
        timezone?: string;
    }): { effectiveAt: Date; creditGeneratedCents: number; reason: string } {
        if (!input.immediate) {
            return {
                effectiveAt: input.currentPeriodEnd,
                creditGeneratedCents: 0,
                reason: 'scheduled_at_period_end',
            };
        }

        const timezone = input.timezone || 'America/Bogota';
        const totalDays = input.currentPeriodStart
            ? calendarDaysBetween(input.currentPeriodStart, input.currentPeriodEnd, timezone)
            : 0;
        const remainingDays = calendarDaysBetween(input.now, input.currentPeriodEnd, timezone);
        const unused = totalDays > 0 && input.paidCents
            ? Math.round((input.paidCents * remainingDays) / totalDays)
            : 0;

        return {
            effectiveAt: input.now,
            creditGeneratedCents: unused,
            reason: 'immediate_with_credit',
        };
    }

    // -------------------------------------------------------------------------
    // Credit ledger
    // -------------------------------------------------------------------------

    /**
     * Append a movement to the credit ledger and refresh the cached balance.
     *
     * The ledger is append-only and authoritative; the column on the
     * subscription is a cache. Storing only a balance would leave no way to
     * explain to a customer where their credit came from.
     */
    async recordCredit(input: {
        tenantId: string;
        subscriptionId?: string;
        deltaCents: number;
        currency: string;
        reason: string;
        refAttemptId?: string;
        refPaymentId?: string;
        createdBy?: string;
        notes?: string;
    }): Promise<{ balanceCents: number }> {
        await this.prisma.billingCreditLedger.create({
            data: {
                tenantId: input.tenantId,
                subscriptionId: input.subscriptionId ?? null,
                deltaCents: input.deltaCents,
                currency: input.currency,
                reason: input.reason,
                refAttemptId: input.refAttemptId ?? null,
                refPaymentId: input.refPaymentId ?? null,
                createdBy: input.createdBy ?? null,
                notes: input.notes ?? null,
            },
        });

        const balance = await this.recalculateBalance(input.tenantId, input.subscriptionId, input.currency);
        this.logger.log(
            `[Proration] Tenant ${input.tenantId} credit ${input.deltaCents >= 0 ? '+' : ''}${input.deltaCents} (${input.reason}) → balance ${balance}`,
        );
        return { balanceCents: balance };
    }

    /** Recompute the balance from the ledger — the ledger always wins. */
    async recalculateBalance(tenantId: string, subscriptionId?: string, currency?: string): Promise<number> {
        const aggregate = await this.prisma.billingCreditLedger.aggregate({
            where: { tenantId, ...(currency ? { currency } : {}) },
            _sum: { deltaCents: true },
        });
        const balance = aggregate._sum.deltaCents ?? 0;

        if (subscriptionId) {
            await this.prisma.billingSubscription.update({
                where: { id: subscriptionId },
                data: { creditBalanceCents: balance },
            }).catch(() => undefined);
        } else {
            await this.prisma.billingSubscription.updateMany({
                where: { tenantId },
                data: { creditBalanceCents: balance },
            }).catch(() => undefined);
        }
        return balance;
    }

    async getBalance(tenantId: string, currency?: string): Promise<number> {
        const aggregate = await this.prisma.billingCreditLedger.aggregate({
            where: { tenantId, ...(currency ? { currency } : {}) },
            _sum: { deltaCents: true },
        });
        return aggregate._sum.deltaCents ?? 0;
    }
}
