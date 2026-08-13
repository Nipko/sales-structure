import { BillingCycle } from '../types/provider-types';

/**
 * Billing period arithmetic for the internal recurring engine.
 *
 * Two rules drive everything here, and both exist because the naive version
 * silently overcharges or undercharges real customers:
 *
 * 1. **Never add milliseconds.** `new Date(start + 30 * 86400000)` drifts: it
 *    ignores month lengths and DST, so a monthly subscription slides backwards
 *    through the calendar and eventually bills twice in one month.
 *
 * 2. **Clamp without carry.** A subscription anchored on the 31st bills the 28th
 *    in February — and must return to the 31st in March. If February's clamped
 *    date becomes the new anchor, the anniversary walks earlier every year. The
 *    original day of month is therefore stored separately and re-applied each
 *    period, never overwritten.
 */

/** Days in the given month, 1-indexed month (1 = January). */
function daysInMonth(year: number, month: number): number {
    // Day 0 of the next month is the last day of this one.
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Advance a date by whole months, preserving the ORIGINAL anchor day.
 *
 * `anchorDay` is the day the subscription was created on, kept independently of
 * whatever the previous period happened to land on after a clamp.
 */
export function addMonthsPreservingAnchor(from: Date, months: number, anchorDay: number): Date {
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth(); // 0-indexed
    const target = new Date(Date.UTC(year, month + months, 1));
    const targetYear = target.getUTCFullYear();
    const targetMonth = target.getUTCMonth() + 1; // 1-indexed for daysInMonth

    const clampedDay = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));

    return new Date(Date.UTC(
        targetYear,
        targetMonth - 1,
        clampedDay,
        from.getUTCHours(),
        from.getUTCMinutes(),
        from.getUTCSeconds(),
        from.getUTCMilliseconds(),
    ));
}

/** The anchor day to persist when a subscription starts. */
export function anchorDayOf(start: Date): number {
    return start.getUTCDate();
}

/**
 * End of the period that starts at `periodStart`.
 * Monthly adds one month, annual adds twelve — both anchored, both clamped.
 */
export function nextPeriodEnd(periodStart: Date, cycle: BillingCycle, anchorDay: number): Date {
    return addMonthsPreservingAnchor(periodStart, cycle === 'annual' ? 12 : 1, anchorDay);
}

/**
 * When to fire the charge for a period that ends at `periodEnd`.
 *
 * Deliberately 09:00 in the tenant's timezone rather than midnight: a decline at
 * 9am can be noticed and fixed the same business day, while one at midnight sits
 * untouched until someone wakes up — and every extra hour of `past_due` is
 * churn risk on a subscription that would have recovered.
 */
export function chargeTimeFor(periodEnd: Date, timezone: string, hourLocal = 9): Date {
    const offsetMinutes = timezoneOffsetMinutes(periodEnd, timezone);
    // Local 09:00 expressed in UTC.
    const utcMidnight = Date.UTC(
        periodEnd.getUTCFullYear(),
        periodEnd.getUTCMonth(),
        periodEnd.getUTCDate(),
    );
    return new Date(utcMidnight + hourLocal * 3_600_000 - offsetMinutes * 60_000);
}

/**
 * Offset of `timezone` from UTC, in minutes, at the given instant.
 * Positive east of Greenwich (Bogotá returns -300).
 */
export function timezoneOffsetMinutes(at: Date, timezone: string): number {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const parts = formatter.formatToParts(at);
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
        // Interpreting the local wall clock AS IF it were UTC, the difference
        // from the real instant is the offset.
        const asUtc = Date.UTC(
            get('year'),
            get('month') - 1,
            get('day'),
            get('hour') === 24 ? 0 : get('hour'),
            get('minute'),
            get('second'),
        );
        return Math.round((asUtc - at.getTime()) / 60_000);
    } catch {
        // Unknown timezone: fall back to UTC rather than throwing inside a cron.
        return 0;
    }
}

/**
 * Calendar days between two instants in the tenant's timezone, rounded UP.
 *
 * Rounding up is a deliberate tilt in the customer's favour: it is used to value
 * the unused part of a period during a proration, so a partial day counts as a
 * whole day of credit.
 */
export function calendarDaysBetween(from: Date, to: Date, timezone: string): number {
    const fromLocal = localDateOnly(from, timezone);
    const toLocal = localDateOnly(to, timezone);
    const diff = toLocal - fromLocal;
    if (diff <= 0) return 0;
    return Math.ceil(diff / 86_400_000);
}

function localDateOnly(at: Date, timezone: string): number {
    const offset = timezoneOffsetMinutes(at, timezone);
    const shifted = new Date(at.getTime() + offset * 60_000);
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * Idempotency key for one billing cycle.
 *
 * Dots, never colons: BullMQ rejects ':' inside a job id, and this string is
 * reused as one. That exact mistake once silently blocked outbound delivery.
 */
export function buildCycleKey(subscriptionId: string, periodStart: Date, purpose: string): string {
    const stamp = [
        periodStart.getUTCFullYear(),
        String(periodStart.getUTCMonth() + 1).padStart(2, '0'),
        String(periodStart.getUTCDate()).padStart(2, '0'),
    ].join('');
    return `${subscriptionId}.${stamp}.${purpose}`;
}

/**
 * Provider-facing reference for one charge attempt. Must be unique per merchant
 * and parseable back to the subscription: it is the only handle available to
 * recover a charge whose response never arrived.
 */
export function buildChargeReference(
    subscriptionId: string,
    periodStart: Date,
    attemptNumber: number,
): string {
    const short = subscriptionId.replace(/-/g, '').slice(0, 8);
    const stamp = [
        periodStart.getUTCFullYear(),
        String(periodStart.getUTCMonth() + 1).padStart(2, '0'),
        String(periodStart.getUTCDate()).padStart(2, '0'),
    ].join('');
    return `sub_${short}_${stamp}_${attemptNumber}`;
}

/**
 * Deterministic per-subscription delay, in minutes, inside a window.
 *
 * Renewals must NOT all fire at the same instant: the provider caps how much a
 * merchant can charge per day, and a synchronized burst also looks like an
 * attack. Deterministic (not random) so a re-run of the same scheduler produces
 * the same slot instead of scattering retries.
 */
export function jitterMinutes(subscriptionId: string, windowMinutes = 45): number {
    let hash = 0;
    for (let i = 0; i < subscriptionId.length; i++) {
        hash = (hash * 31 + subscriptionId.charCodeAt(i)) >>> 0;
    }
    return hash % Math.max(1, windowMinutes);
}
