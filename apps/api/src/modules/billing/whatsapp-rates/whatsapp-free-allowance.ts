import type { PricingBasis } from '@parallext/shared';
import { wabaCalendarMonth } from './whatsapp-rate-resolver';
import type { WhatsAppRateResolution } from './whatsapp-rate-resolver';
import {
    WHATSAPP_FREE_SERVICE_ALLOWANCE,
    type WhatsAppMessageCategory,
} from './whatsapp-rate-table.generated';

/**
 * Whether we actually know how much of the allowance has been used.
 *
 * `unknown` is not a rounding error to be smoothed over. The preserved evidence
 * is explicit that the exact webhook signal for consuming the new free thousand
 * is not documented — "no se debe inventar" — so a reading we could not take is
 * a reading we do not have, and the honest response is to treat the delivery as
 * chargeable and reconcile afterwards, never to hope it was free.
 */
export type AllowanceUsageCertainty = 'counted' | 'unknown';

export type FreeAllowanceReason =
    /** Every delivery in this batch falls inside the remaining allowance. */
    | 'covered_by_allowance'
    /** Some do, some do not. The rest are priced. */
    | 'allowance_partially_covers'
    /** The number has already used its thousand this month. */
    | 'allowance_exhausted'
    /** Marketing, utility and authentication are never covered. */
    | 'category_not_eligible'
    /** Before the October regime there is no allowance to apply. */
    | 'allowance_not_yet_in_effect'
    /** We could not read the month's usage, so nothing is claimed as free. */
    | 'usage_unknown'
    /** Without a WABA zone there is no calendar month to count against. */
    | 'unsupported_time_zone';

export interface FreeAllowanceQuery {
    readonly category: WhatsAppMessageCategory;
    /**
     * The BUSINESS phone number the deliveries leave from.
     *
     * The allowance belongs to this and to nothing else. Not the tenant, not the
     * WABA, not the recipient's country — a number answering customers in nine
     * markets has one thousand free service deliveries in total, not nine
     * thousand, and that is why no market appears anywhere in this input.
     */
    readonly businessPhoneNumberId: string;
    /**
     * Service deliveries already made from this number in this calendar month,
     * or `null` when we could not establish it. `null` never means zero.
     */
    readonly deliveriesAlreadyUsedThisMonth: number | null;
    readonly deliveries: number;
    readonly at: Date;
    readonly wabaTimeZone: string;
}

export interface FreeAllowanceSplit {
    readonly free: number;
    readonly chargeable: number;
    readonly certainty: AllowanceUsageCertainty;
    readonly reason: FreeAllowanceReason;
    /** `YYYY-MM` in the WABA zone: the month the allowance resets with. */
    readonly allowanceMonth: string | null;
    /**
     * The counter these deliveries must be charged against.
     *
     * Number and month, and nothing else. The absence of a market in this key is
     * the model of "per number per calendar month, not per country", expressed
     * where it cannot be forgotten rather than in a comment.
     */
    readonly allowanceKey: string | null;
    /** Free deliveries left afterwards, or `null` when the usage is unknown. */
    readonly remainingAfter: number | null;
}

const isCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const nothingFree = (
    deliveries: number,
    reason: FreeAllowanceReason,
    certainty: AllowanceUsageCertainty,
    allowanceMonth: string | null,
    allowanceKey: string | null,
): FreeAllowanceSplit => ({
    free: 0,
    chargeable: deliveries,
    certainty,
    reason,
    allowanceMonth,
    allowanceKey,
    remainingAfter: null,
});

/**
 * The counter key an allowance is held against: number and calendar month.
 *
 * Exported so a ledger cannot invent its own shape and end up with a per-market
 * or per-conversation counter that multiplies the free thousand.
 */
export function freeAllowanceKey(businessPhoneNumberId: string, allowanceMonth: string): string {
    return `wa:free_service:${businessPhoneNumberId}:${allowanceMonth}`;
}

/**
 * How many of these deliveries the free allowance covers.
 *
 * One thousand service deliveries per number per calendar month, no rollover,
 * from 1 October 2026 — every one of those clauses read out of the evidence by
 * the generator rather than remembered here.
 *
 * The three cases the directive asks for, stated as ordinals: with 998 already
 * used, the next delivery is the 999th and is free; with 999 used, the 1,000th
 * is free; with 1,000 used, the 1,001st is charged.
 */
export function applyFreeServiceAllowance(query: FreeAllowanceQuery): FreeAllowanceSplit {
    const deliveries = isCount(query.deliveries) ? query.deliveries : 0;
    const month = wabaCalendarMonth(query.at, query.wabaTimeZone);
    if (month === null) {
        return nothingFree(deliveries, 'unsupported_time_zone', 'unknown', null, null);
    }

    const key = freeAllowanceKey(String(query.businessPhoneNumberId), month);

    if (query.category !== WHATSAPP_FREE_SERVICE_ALLOWANCE.category) {
        return nothingFree(deliveries, 'category_not_eligible', 'counted', month, key);
    }

    // The allowance is a feature of the October regime. Before it there is no
    // thousand to spend, and this function does not get to decide what the
    // absence of a charge means — the rate resolver answers that, and answers
    // `unknown`.
    if (month < WHATSAPP_FREE_SERVICE_ALLOWANCE.effectiveFrom.slice(0, 7)) {
        return nothingFree(deliveries, 'allowance_not_yet_in_effect', 'counted', month, key);
    }

    if (!isCount(query.deliveriesAlreadyUsedThisMonth)) {
        return nothingFree(deliveries, 'usage_unknown', 'unknown', month, key);
    }

    const remainingBefore = Math.max(
        0,
        WHATSAPP_FREE_SERVICE_ALLOWANCE.deliveries - query.deliveriesAlreadyUsedThisMonth,
    );
    const free = Math.min(remainingBefore, deliveries);
    const chargeable = deliveries - free;

    let reason: FreeAllowanceReason;
    if (deliveries > 0 && free === deliveries) reason = 'covered_by_allowance';
    else if (free > 0) reason = 'allowance_partially_covers';
    else reason = 'allowance_exhausted';

    return {
        free,
        chargeable,
        certainty: 'counted',
        reason,
        allowanceMonth: month,
        allowanceKey: key,
        remainingAfter: remainingBefore - free,
    };
}

/**
 * The `PricingBasis` for a batch, given what it costs and what is free.
 *
 * Order of precedence, and why:
 *
 *   1. Nothing chargeable and the usage was actually counted → `free_allowance`.
 *      True even in a market with no rate card: the allowance covers deliveries
 *      regardless of destination, so a covered delivery costs nothing whether or
 *      not we could have priced it. This is the one place an unpriced market is
 *      allowed a non-`unknown` answer, and it is safe because it claims no
 *      spend rather than under-claiming one.
 *   2. Anything chargeable, and no rate → `unknown`. Exposure is retained.
 *   3. Otherwise → `priced`.
 *
 * `free_entry_point` is never returned here. It depends on how the conversation
 * was opened, which is not something a rate card knows.
 */
export function pricingBasisFor(rate: WhatsAppRateResolution, split: FreeAllowanceSplit): PricingBasis {
    if (split.chargeable === 0 && split.free > 0 && split.certainty === 'counted') return 'free_allowance';
    if (rate.basis === 'unknown') return 'unknown';
    return 'priced';
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission is not price. They are different questions with different answers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether we are ALLOWED to send: 24-hour window, opt-out, consent, template
 * approval. Decided elsewhere entirely; this module never computes it.
 */
export type DeliveryPermission = 'permitted' | 'not_permitted' | 'unknown';

export type ReplyCostClassification =
    | 'not_permitted'
    | 'permission_unknown'
    | 'permitted_and_free'
    | 'permitted_and_chargeable'
    | 'permitted_cost_unknown';

/** Whether a basis means the delivery costs nothing. Not whether it may be sent. */
export function isFreeToSend(basis: PricingBasis): boolean {
    return basis === 'free_allowance' || basis === 'free_entry_point';
}

/**
 * Combine the two questions without letting either answer the other.
 *
 * Permission is read first and dominates: a reply we are not allowed to send is
 * never reported as free, however much allowance is left, because "free" would
 * invite somebody to send it. And a reply we ARE allowed to send is not thereby
 * free — that conflation is a named failure mode, and it is the one that turns
 * an open 24-hour window into a bill. Every one of the five results names both
 * halves so neither can be read off the other.
 */
export function classifyReply(permission: DeliveryPermission, basis: PricingBasis): ReplyCostClassification {
    if (permission === 'not_permitted') return 'not_permitted';
    if (permission !== 'permitted') return 'permission_unknown';
    if (isFreeToSend(basis)) return 'permitted_and_free';
    if (basis === 'unknown') return 'permitted_cost_unknown';
    return 'permitted_and_chargeable';
}
