import {
    allowanceRemaining, FREE_ALLOWANCE_PER_MONTH, formatMinor, hasUnresolvedExposure,
    type SpendExposureRow,
} from './whatsapp-spend';

const row = (over: Partial<SpendExposureRow> = {}): SpendExposureRow => ({
    currency: 'USD', reservedMinor: 0, settledMinor: 0, retainedMinor: 0, releasedMinor: 0,
    freeDeliveries: 0, chargedDeliveries: 0, ...over,
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

describe('the free thousand', () => {
    it('counts messages across currencies, because a message is a message', () => {
        // The one thing that CAN be summed across currencies. The allowance is
        // counted in delivered messages, and what a message would have cost has
        // nothing to do with whether it was free.
        expect(allowanceRemaining([
            row({ currency: 'USD', freeDeliveries: 600 }),
            row({ currency: 'COP', freeDeliveries: 300 }),
        ])).toEqual({ used: 900, total: FREE_ALLOWANCE_PER_MONTH });
    });

    it('does not report more than the allowance itself', () => {
        // A number with several months in the window would otherwise show
        // "1,400 of 1,000 used", which reads as a bug rather than as a period
        // boundary.
        expect(allowanceRemaining([row({ freeDeliveries: 1400 })]).used)
            .toBe(FREE_ALLOWANCE_PER_MONTH);
    });

    it('is zero when nothing has been sent', () => {
        expect(allowanceRemaining([])).toEqual({ used: 0, total: FREE_ALLOWANCE_PER_MONTH });
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
