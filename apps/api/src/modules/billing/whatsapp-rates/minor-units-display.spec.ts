import { formatMinorUnits } from './whatsapp-rate-money';
import { CURRENCY_MINOR_EXPONENT } from './whatsapp-rate-table.generated';

/**
 * ═══ HOW MANY DECIMALS A CURRENCY HAS IS A FACT, NOT A DEFAULT ═══
 *
 * Two operator-facing sentences — the campaign estimate's total and the spend
 * diagnosis's "avoided" figure — formatted money as `(minor / 100).toFixed(2)`,
 * directly beneath a docblock in this very module explaining that assuming two
 * decimals is how JPY (zero) and KWD (three) come out wrong by a factor of a
 * hundred.
 *
 * It happened to be right, because the shipped rate table holds USD and COP and
 * both have two. That is the whole problem: it was one published card away from
 * telling an operator they had avoided a hundred times what they had, and
 * nothing would have failed.
 */
describe('money as a person reads it', () => {
    it('uses the currency’s own number of decimals', () => {
        expect(formatMinorUnits(12_345, 'USD')).toBe('123.45');
        expect(formatMinorUnits(12_345, 'COP')).toBe('123.45');
    });

    it('refuses a currency nobody published a card for, rather than guessing', () => {
        // `null` is what makes the caller say the amount in minor units and
        // name the currency — ugly and true, instead of pretty and off by a
        // hundred. The day a JPY or KWD card ships, this is the line that has
        // to keep holding.
        for (const currency of ['JPY', 'KWD', 'XYZ', '']) {
            if (CURRENCY_MINOR_EXPONENT[currency] !== undefined) continue;
            expect(formatMinorUnits(1_000, currency)).toBeNull();
        }
    });

    it('formats a zero-decimal currency without inventing cents, when one ships', () => {
        // Guarded on the table rather than hard-coded, so this case activates
        // by itself the day the card exists instead of being remembered.
        const exponent = CURRENCY_MINOR_EXPONENT.JPY;
        if (exponent === undefined) {
            expect(formatMinorUnits(1_000, 'JPY')).toBeNull();
            return;
        }
        expect(formatMinorUnits(1_000, 'JPY')).toBe('1000');
    });

    it('answers null for anything that is not a finite amount', () => {
        for (const value of [NaN, Infinity, -Infinity]) {
            expect(formatMinorUnits(value, 'USD')).toBeNull();
        }
    });

    it('is case-insensitive about the currency code', () => {
        expect(formatMinorUnits(100, 'usd')).toBe('1.00');
    });
});
