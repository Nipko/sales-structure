import {
    deliveryReadiness, formatMinor, fundingIsActionable, hasUnresolvedExposure,
    latestMonthPerNumber, pausesWorthShowing, undatedConsumption,
    FUNDING_READINESS_STATES,
    type SpendExposureRow, type WhatsappConsumption, type WhatsappMonthRow,
    type WhatsappNumberPause,
} from './whatsapp-spend';

const row = (over: Partial<SpendExposureRow> = {}): SpendExposureRow => ({
    currency: 'USD', reservedMinor: 0, acceptedMinor: 0, estimatedMinor: 0, uncertainMinor: 0,
    settledMinor: 0, retainedMinor: 0, releasedMinor: 0,
    freeDeliveries: 0, chargedDeliveries: 0, ...over,
});

const month = (over: Partial<WhatsappMonthRow> = {}): WhatsappMonthRow => ({
    month: '2026-10', channelAccountId: '15550001111',
    freeDeliveries: 0, chargedDeliveries: 0, money: [], byMarketCategory: [], ...over,
});

const consumption = (rows: WhatsappMonthRow[], allowance = 1000): WhatsappConsumption => ({
    months: 3, freeServiceDeliveriesPerNumberMonth: allowance, consumption: rows,
});

const pause = (over: Partial<WhatsappNumberPause> = {}): WhatsappNumberPause => ({
    channelAccountId: '15550001111', displayName: null, paused: false, stateUnknown: false,
    explanation: null, since: null, observations: 0, clearedAt: null, ...over,
});

describe('showing money somebody else is charging', () => {
    it('formats minor units in the reader\'s own locale', () => {
        // Server-side formatting is formatting in the wrong locale for
        // somebody. The API sends minor units and a currency code; the decision
        // about commas and dots belongs here.
        expect(formatMinor(1234, 'USD', 'en-US')).toBe('$12.34');
        expect(formatMinor(1234, 'USD', 'es-CO')).toContain('12,34');
    });

    it('asks the currency how many decimals it has, instead of assuming two', () => {
        // Minor units are not always hundredths, and the yen is the case that
        // proves the mechanism: 1,500 minor units are 1,500 yen, not 15.
        // Assuming hundredths would have shown a hundredth of the bill.
        expect(formatMinor(1500, 'JPY', 'en-US')).toBe('¥1,500');
        // The peso keeps two digits, because that is what the platform's own
        // currency data says for formatting. Asserting an intuition about cash
        // instead would be asserting against the thing doing the work.
        expect(formatMinor(1500, 'COP', 'es-CO')).toContain('15');
    });

    it('still shows the number when the currency code is unknown', () => {
        // A blank panel during a billing question is worse than an unfamiliar
        // symbol: the number is the information and the code beside it is true.
        expect(formatMinor(1234, 'XYZ123', 'en-US')).toBe('12.34 XYZ123');
    });
});

describe('the free allowance, which belongs to a number and to a month', () => {
    it('gives each number its own allowance instead of adding them together', () => {
        // ── THE DEFECT THIS REPLACES ────────────────────────────────────────
        // The old helper summed `freeDeliveries` across every row of the
        // rolling summary. Two numbers that had each used six hundred came back
        // as "1,000 of 1,000" — allowance exhausted — while each of them still
        // had four hundred free deliveries left. A tenant reading that would
        // stand down campaigns they could have run for nothing.
        const numbers = latestMonthPerNumber(consumption([
            month({ channelAccountId: '15550001111', freeDeliveries: 600 }),
            month({ channelAccountId: '15550002222', freeDeliveries: 600 }),
        ]));
        expect(numbers.map(number => ({
            id: number.channelAccountId, used: number.freeDeliveries, of: number.allowance,
        }))).toEqual([
            { id: '15550001111', used: 600, of: 1000 },
            { id: '15550002222', used: 600, of: 1000 },
        ]);
    });

    it('takes the allowance from the server rather than a constant of its own', () => {
        // Meta sets this number. A dashboard carrying its own copy is a
        // dashboard that will be wrong the month Meta changes it and right
        // nowhere, so the payload decides — including when it says something
        // this build has never seen.
        const [only] = latestMonthPerNumber(consumption([month({ freeDeliveries: 40 })], 250));
        expect(only.allowance).toBe(250);
    });

    it('reports the account\'s own latest month, not whatever month it is here', () => {
        // `YYYY-MM` arrives already dated in the WhatsApp account's time zone.
        // Re-deriving it from a browser clock would put a message sent at 8pm
        // in Bogotá on the 31st into the following month — the exact boundary
        // the server-side dating exists to get right.
        const [only] = latestMonthPerNumber(consumption([
            month({ month: '2026-09', freeDeliveries: 900 }),
            month({ month: '2026-10', freeDeliveries: 120 }),
        ]));
        expect({ month: only.month, used: only.freeDeliveries }).toEqual({ month: '2026-10', used: 120 });
    });

    it('keeps rows nobody could date out of every month', () => {
        // An undated row is one nobody could price. Folding it into the current
        // month would attribute spend to a period it may not belong to, and a
        // reconciliation that looks complete is worse than one that says what
        // it is missing.
        const payload = consumption([
            month({ month: '2026-10', freeDeliveries: 10 }),
            month({ month: null, chargedDeliveries: 7 }),
        ]);
        expect(latestMonthPerNumber(payload)).toHaveLength(1);
        expect(undatedConsumption(payload).map(undated => undated.chargedDeliveries)).toEqual([7]);
    });

    it('has nothing to say when the read did not come back', () => {
        expect(latestMonthPerNumber(null)).toEqual([]);
        expect(undatedConsumption(undefined)).toEqual([]);
    });
});

describe('two currencies are two totals', () => {
    it('carries every currency separately and produces no combined figure', () => {
        // Adding pesos to dollars requires an exchange rate nobody agreed to.
        // The result keeps one entry per currency and deliberately exposes no
        // field a caller could mistake for a total of both.
        const [only] = latestMonthPerNumber(consumption([month({
            money: [
                { currency: 'USD', settledMinor: 1240, retainedMinor: 0 },
                { currency: 'COP', settledMinor: 5100000, retainedMinor: 200 },
            ],
        })]));
        expect(only.money).toEqual([
            { currency: 'USD', settledMinor: 1240, retainedMinor: 0 },
            { currency: 'COP', settledMinor: 5100000, retainedMinor: 200 },
        ]);
        // Named explicitly: a future field called `total`, `settledMinor` or
        // anything else summing the two would pass every assertion above.
        expect(Object.keys(only)).toEqual(
            ['channelAccountId', 'month', 'freeDeliveries', 'allowance', 'chargedDeliveries', 'money']);
    });
});

describe('a number that stopped, and a number we could not ask about', () => {
    it('shows both, and shows a healthy number neither way', () => {
        expect(pausesWorthShowing([
            pause({ channelAccountId: 'fine' }),
            pause({ channelAccountId: 'stopped', paused: true }),
            pause({ channelAccountId: 'unreadable', stateUnknown: true }),
        ]).map(row => row.channelAccountId)).toEqual(['stopped', 'unreadable']);
    });

    it('never treats an unreadable state as a running one', () => {
        // The API is explicit that `stateUnknown` is not `paused: false`. A
        // panel that rendered it as healthy would let an operator conclude
        // nothing is wrong while nothing is going out.
        const [unreadable] = pausesWorthShowing([pause({ stateUnknown: true })]);
        expect({ paused: unreadable.paused, unknown: unreadable.stateUnknown })
            .toEqual({ paused: false, unknown: true });
    });
});

describe('whether a number can keep delivering', () => {
    it('answers three ways, because two would have to lie once', () => {
        expect(FUNDING_READINESS_STATES.map(deliveryReadiness)).toEqual([
            'unestablished', // not_checked — nobody asked yet
            'ready',         // attached
            'not_ready',     // absent
            'not_ready',     // restricted
            'unestablished', // unknown — we could not find out
        ]);
    });

    it('asks nobody to act on a state nobody established', () => {
        // The thing to do about `unknown` is ask again, which is the system's
        // job. Putting it in front of a person is how a warning becomes noise
        // and the real one gets ignored.
        expect(FUNDING_READINESS_STATES.filter(fundingIsActionable)).toEqual(['absent', 'restricted']);
    });

    it('does not turn an attached card into a promise that it will work', () => {
        // `attached` says only that the missing thing is not the card. A card
        // can be attached and declined, expired or over its limit, and Meta
        // will still report it attached — so nothing downstream may read
        // `ready` as solvency, and it is not `actionable` either way.
        expect(deliveryReadiness('attached')).toBe('ready');
        expect(fundingIsActionable('attached')).toBe(false);
    });
});

describe('money that is neither spent nor safe', () => {
    it('is noticed', () => {
        // `retained` is the uncomfortable number: an effect whose outcome never
        // came back. Not a cost yet, not nothing — the amount somebody has to
        // reconcile.
        expect(hasUnresolvedExposure([row({ retainedMinor: 40 })])).toBe(true);
    });

    it('is not confused with money that was given back', () => {
        expect(hasUnresolvedExposure([row({ releasedMinor: 40, settledMinor: 10 })])).toBe(false);
    });
});
