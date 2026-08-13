import {
    addMonthsPreservingAnchor,
    anchorDayOf,
    buildChargeReference,
    buildCycleKey,
    calendarDaysBetween,
    chargeTimeFor,
    jitterMinutes,
    nextPeriodEnd,
    timezoneOffsetMinutes,
} from './period.util';

/**
 * Date arithmetic is where recurring billing quietly goes wrong: the bugs do not
 * throw, they just charge on the wrong day — or twice in one month — and only
 * surface as customer complaints weeks later.
 */
describe('period.util', () => {
    describe('addMonthsPreservingAnchor', () => {
        it('keeps the same day of month for ordinary months', () => {
            const result = addMonthsPreservingAnchor(new Date('2026-01-15T09:00:00Z'), 1, 15);
            expect(result.toISOString()).toBe('2026-02-15T09:00:00.000Z');
        });

        it('clamps the 31st to the end of a shorter month', () => {
            const result = addMonthsPreservingAnchor(new Date('2026-01-31T09:00:00Z'), 1, 31);
            expect(result.toISOString()).toBe('2026-02-28T09:00:00.000Z');
        });

        it('RETURNS to the anchor after a clamp instead of dragging it earlier', () => {
            // The bug this prevents: taking February's clamped 28th as the new
            // anchor makes every later month bill on the 28th, and the
            // anniversary walks earlier year after year.
            const january = new Date('2026-01-31T09:00:00Z');
            const anchor = anchorDayOf(january); // 31

            const february = addMonthsPreservingAnchor(january, 1, anchor);
            const march = addMonthsPreservingAnchor(february, 1, anchor);
            const april = addMonthsPreservingAnchor(march, 1, anchor);

            expect(february.getUTCDate()).toBe(28);
            expect(march.getUTCDate()).toBe(31); // ← back to the anchor
            expect(april.getUTCDate()).toBe(30); // April only has 30
        });

        it('handles a leap February', () => {
            const result = addMonthsPreservingAnchor(new Date('2028-01-31T09:00:00Z'), 1, 31);
            expect(result.toISOString()).toBe('2028-02-29T09:00:00.000Z');
        });

        it('crosses the year boundary', () => {
            const result = addMonthsPreservingAnchor(new Date('2026-12-15T09:00:00Z'), 1, 15);
            expect(result.toISOString()).toBe('2027-01-15T09:00:00.000Z');
        });

        it('never drifts across a full year of monthly renewals', () => {
            // Adding 30-day deltas instead would land in December, having billed
            // 13 times in 12 months.
            const anchor = 15;
            let cursor = new Date('2026-01-15T09:00:00Z');
            for (let i = 0; i < 12; i++) {
                cursor = addMonthsPreservingAnchor(cursor, 1, anchor);
            }
            expect(cursor.toISOString()).toBe('2027-01-15T09:00:00.000Z');
        });
    });

    describe('nextPeriodEnd', () => {
        it('adds one month for a monthly cycle', () => {
            expect(nextPeriodEnd(new Date('2026-03-10T00:00:00Z'), 'monthly', 10).toISOString())
                .toBe('2026-04-10T00:00:00.000Z');
        });

        it('adds twelve months for an annual cycle', () => {
            expect(nextPeriodEnd(new Date('2026-03-10T00:00:00Z'), 'annual', 10).toISOString())
                .toBe('2027-03-10T00:00:00.000Z');
        });

        it('clamps an annual cycle anchored on Feb 29', () => {
            expect(nextPeriodEnd(new Date('2028-02-29T00:00:00Z'), 'annual', 29).toISOString())
                .toBe('2029-02-28T00:00:00.000Z');
        });
    });

    describe('timezoneOffsetMinutes', () => {
        it('resolves Bogotá as UTC-5', () => {
            expect(timezoneOffsetMinutes(new Date('2026-06-15T12:00:00Z'), 'America/Bogota')).toBe(-300);
        });

        it('tracks DST where it exists', () => {
            const winter = timezoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York');
            const summer = timezoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York');
            expect(winter).toBe(-300);
            expect(summer).toBe(-240);
        });

        it('falls back to UTC on an unknown timezone instead of throwing inside a cron', () => {
            expect(timezoneOffsetMinutes(new Date('2026-06-15T12:00:00Z'), 'Mars/Olympus')).toBe(0);
        });
    });

    describe('chargeTimeFor', () => {
        it('fires at 09:00 local, not at midnight UTC', () => {
            // 09:00 in Bogotá (UTC-5) is 14:00 UTC.
            const result = chargeTimeFor(new Date('2026-04-10T00:00:00Z'), 'America/Bogota');
            expect(result.toISOString()).toBe('2026-04-10T14:00:00.000Z');
        });
    });

    describe('calendarDaysBetween', () => {
        it('counts whole days in the tenant timezone', () => {
            expect(calendarDaysBetween(
                new Date('2026-04-01T12:00:00Z'),
                new Date('2026-04-11T12:00:00Z'),
                'America/Bogota',
            )).toBe(10);
        });

        it('counts a crossed local midnight as a full day, in the customer favour', () => {
            // 20:00 UTC is 15:00 in Bogotá: these are the 1st and the 2nd
            // locally, so one calendar day of credit — even though barely 24h
            // separate them.
            expect(calendarDaysBetween(
                new Date('2026-04-01T20:00:00Z'),
                new Date('2026-04-02T20:00:00Z'),
                'America/Bogota',
            )).toBe(1);
        });

        it('counts hours inside the same local day as zero days', () => {
            // Both instants are the 1st in Bogotá (18:00 and 20:00 local), so
            // there is no whole day left to credit. Counting them as a day would
            // hand out credit for a period that already elapsed.
            expect(calendarDaysBetween(
                new Date('2026-04-01T23:00:00Z'),
                new Date('2026-04-02T01:00:00Z'),
                'America/Bogota',
            )).toBe(0);
        });

        it('uses the TENANT timezone, not UTC, to decide the day boundary', () => {
            // The same pair of instants spans two days in UTC but one in Bogotá.
            const from = new Date('2026-04-01T23:00:00Z');
            const to = new Date('2026-04-02T01:00:00Z');
            expect(calendarDaysBetween(from, to, 'UTC')).toBe(1);
            expect(calendarDaysBetween(from, to, 'America/Bogota')).toBe(0);
        });

        it('returns 0 when the end is not after the start', () => {
            const at = new Date('2026-04-10T12:00:00Z');
            expect(calendarDaysBetween(at, at, 'America/Bogota')).toBe(0);
            expect(calendarDaysBetween(at, new Date('2026-04-01T12:00:00Z'), 'America/Bogota')).toBe(0);
        });
    });

    describe('idempotency keys', () => {
        it('builds a stable cycle key with no colon', () => {
            const key = buildCycleKey('11111111-2222-3333-4444-555555555555', new Date('2026-04-10T00:00:00Z'), 'renewal');
            expect(key).toBe('11111111-2222-3333-4444-555555555555.20260410.renewal');
            // A ':' here would be rejected as a BullMQ job id — an incident we
            // already lived through with outbound delivery.
            expect(key).not.toContain(':');
        });

        it('gives different keys to different periods and purposes', () => {
            const id = 'sub-1';
            const april = new Date('2026-04-10T00:00:00Z');
            const may = new Date('2026-05-10T00:00:00Z');
            expect(buildCycleKey(id, april, 'renewal')).not.toBe(buildCycleKey(id, may, 'renewal'));
            expect(buildCycleKey(id, april, 'renewal')).not.toBe(buildCycleKey(id, april, 'upgrade_proration'));
        });

        it('builds a provider reference that carries the subscription and period', () => {
            const ref = buildChargeReference('11111111-2222-3333-4444-555555555555', new Date('2026-04-10T00:00:00Z'), 2);
            expect(ref).toBe('sub_11111111_20260410_2');
            expect(ref).not.toContain(':');
        });

        it('gives each retry its own reference', () => {
            const id = 'sub-1';
            const period = new Date('2026-04-10T00:00:00Z');
            expect(buildChargeReference(id, period, 1)).not.toBe(buildChargeReference(id, period, 2));
        });
    });

    describe('jitterMinutes', () => {
        it('is deterministic for a subscription', () => {
            expect(jitterMinutes('sub-1')).toBe(jitterMinutes('sub-1'));
        });

        it('spreads different subscriptions across the window', () => {
            const values = new Set(
                Array.from({ length: 50 }, (_, i) => jitterMinutes(`sub-${i}`)),
            );
            // Renewals landing on the same instant would hit the provider's daily
            // cap and look like a burst; several distinct slots is the point.
            expect(values.size).toBeGreaterThan(10);
        });

        it('stays inside the window', () => {
            for (let i = 0; i < 100; i++) {
                const value = jitterMinutes(`sub-${i}`, 45);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(45);
            }
        });
    });
});
