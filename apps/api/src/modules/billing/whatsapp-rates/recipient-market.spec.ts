import {
    describeRecipientMarket, recipientIso, recipientMarket, RECIPIENT_MARKET_VERSION,
} from './recipient-market';
import { WHATSAPP_MARKET_BY_ISO_ALPHA2 } from './whatsapp-rate-table.generated';
import { resolveWhatsAppRate } from './whatsapp-rate-resolver';

/**
 * ═══ THE PRICE FOLLOWS THE RECIPIENT ═══
 *
 * Meta charges by the country being messaged, not by the number sending. The
 * engine was reading one fixed `billingMarket` off the sender's metadata, which
 * is wrong for every tenant with a single customer abroad — and silently so.
 *
 * The tests that matter most here are the refusals. A shared calling code that
 * gets guessed does not produce a rounding error; it prices a Kazakh message at
 * the Russian rate and reports a number nobody can reconcile.
 */

describe('reading a country off a destination', () => {
    it('resolves the markets the rate card actually prices', () => {
        for (const [address, iso] of [
            ['+573001234567', 'CO'],
            ['+5215512345678', 'MX'],
            ['+5491112345678', 'AR'],
            ['+5511998887766', 'BR'],
            ['+34600123456', 'ES'],
            ['+919876543210', 'IN'],
            ['+971501234567', 'AE'],
            ['+8613800138000', undefined],
        ] as [string, string | undefined][]) {
            expect({ address, iso: recipientIso(address) ?? undefined }).toEqual({ address, iso });
        }
    });

    it('takes the LONGEST matching code, not the first', () => {
        // `+9` prefixes eight codes in this table. A shortest-first scan would
        // resolve every Middle Eastern and South Asian number to one country.
        expect(recipientIso('+966501234567')).toBe('SA');
        expect(recipientIso('+972541234567')).toBe('IL');
        expect(recipientIso('+9613123456')).toBeNull();     // Lebanon: not a named market
        expect(recipientIso('+8801712345678')).toBe('BD');
        expect(recipientIso('+85298765432')).toBe('HK');
    });

    it('reads the address in whatever shape a channel hands it over', () => {
        // Each sink carries the recipient differently; normalising at one of
        // them would leave the other two guessing.
        for (const address of [
            '+52 55 1234 5678', '5215512345678', 'whatsapp:+5215512345678', '+52-55-1234-5678',
        ]) {
            expect({ address, iso: recipientIso(address) }).toEqual({ address, iso: 'MX' });
        }
    });
});

describe('the refusals, which are the point', () => {
    it('refuses to name a country behind +1', () => {
        // The United States, Canada, the Dominican Republic and twenty more.
        const result = recipientMarket('+13055551234');
        expect(result.kind).toBe('ambiguous');
        expect(recipientIso('+13055551234')).toBeNull();
        expect(describeRecipientMarket(result)).toContain('North American Numbering Plan');
    });

    it('refuses to name a country behind +7', () => {
        // Russia and Kazakhstan. Meta prices them as two different markets, at
        // different prices, so a guess here is a wrong invoice line.
        const result = recipientMarket('+77011234567');
        expect(result.kind).toBe('ambiguous');
        expect(describeRecipientMarket(result)).toContain('Kazakhstan');
        // And the one it would have been guessed as is a real market, which is
        // exactly why guessing is tempting and wrong.
        expect(WHATSAPP_MARKET_BY_ISO_ALPHA2.RU).toBeDefined();
        expect(WHATSAPP_MARKET_BY_ISO_ALPHA2.KZ).toBeDefined();
    });

    it('returns nothing for an empty or unreadable address', () => {
        for (const address of ['', null, undefined, 'not a phone', '+']) {
            expect(recipientIso(address)).toBeNull();
        }
        expect(recipientMarket(null).kind).toBe('unlisted');
    });

    it('does not name a country the current card does not price', () => {
        // Naming a country the price list does not know is a detail that looks
        // like an answer and changes no number.
        expect(recipientIso('+50688881234')).toBeNull();  // Costa Rica
        expect(recipientIso('+59899123456')).toBeNull();  // Uruguay
    });
});

describe('what the resolution carries', () => {
    it('names its own version, so an old price can still be explained', () => {
        const result = recipientMarket('+573001234567');
        expect(result.version).toBe(RECIPIENT_MARKET_VERSION);
        expect(RECIPIENT_MARKET_VERSION).toMatch(/^recipient-market-\d{4}-\d{2}$/);
    });

    it('only ever names a market the rate card knows', () => {
        // The invariant that keeps this table and the generated one from
        // drifting apart: every ISO it can return must be priceable.
        for (const address of [
            '+573001234567', '+5215512345678', '+919876543210', '+971501234567',
            '+441234567890', '+380501234567', '+27821234567',
        ]) {
            const result = recipientMarket(address);
            expect(result.kind).toBe('resolved');
            if (result.kind !== 'resolved') continue;
            expect(WHATSAPP_MARKET_BY_ISO_ALPHA2[result.iso]).toBe(result.market);
        }
    });
});

describe('the price that actually comes out', () => {
    const at = new Date('2026-10-05T12:00:00.000Z');

    it('prices a Mexican recipient as Mexico, from a Colombian sender', () => {
        // The whole reason this module exists. Both calls are the same sending
        // account; only the destination differs.
        const mexican = resolveWhatsAppRate({
            category: 'marketing',
            recipient: { kind: 'iso_alpha2', value: recipientIso('+5215512345678')! },
            currency: 'USD', at, wabaTimeZone: 'America/Bogota',
        });
        const colombian = resolveWhatsAppRate({
            category: 'marketing',
            recipient: { kind: 'iso_alpha2', value: recipientIso('+573001234567')! },
            currency: 'USD', at, wabaTimeZone: 'America/Bogota',
        });
        expect(mexican.basis).toBe('priced');
        expect(colombian.basis).toBe('priced');
        if (mexican.basis !== 'priced' || colombian.basis !== 'priced') return;
        // Two markets, two prices. A fixed `billingMarket` on the sender would
        // have reported the same number for both.
        expect(mexican.market).not.toBe(colombian.market);
    });
});
