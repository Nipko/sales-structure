import { WHATSAPP_MARKET_BY_ISO_ALPHA2 } from './whatsapp-rate-table.generated';

/**
 * ═══ WHICH COUNTRY IS BEING MESSAGED ═══
 *
 * Meta prices a delivered WhatsApp message by the RECIPIENT'S country, not by
 * the sender's. A business in Bogotá messaging a customer in Mexico pays the
 * Mexican rate.
 *
 * The engine was reading a `billingMarket` off the sending number's metadata —
 * one fixed country per number — which is wrong for every tenant with a single
 * customer abroad, and silently so: the message is priced, the number looks
 * plausible, and the invoice disagrees.
 *
 * So the market is derived HERE, from the destination address, before that
 * address is hashed into a `recipientRef`. Only the ISO alpha-2 reaches the
 * ledger; the phone number does not.
 *
 * ── WHY A SHARED CALLING CODE IS A REFUSAL, NOT A GUESS ─────────────────────
 *
 * `+1` is the United States, Canada, the Dominican Republic, Puerto Rico and a
 * dozen more. `+7` is Russia AND Kazakhstan — two DIFFERENT markets in Meta's
 * own table, at different prices. A prefix match cannot tell them apart, and
 * `phone.util.ts` already says so in as many words about the NANP.
 *
 * A guess there is not a rounding error. It prices a Kazakh message at the
 * Russian rate and reports a number nobody can reconcile against Meta's
 * invoice. So an ambiguous prefix resolves to NOTHING, and the rate resolver
 * then falls into the unnamed bucket — which is Meta's own answer for a country
 * it does not price individually, and the honest one for a country we cannot
 * name.
 *
 * ── WHAT "VERSIONED" MEANS HERE ─────────────────────────────────────────────
 *
 * `RECIPIENT_MARKET_VERSION` travels with every resolution and is stored beside
 * the rate version on the reservation. When this table changes, a reservation
 * priced under the old one can still be explained — which is the whole reason
 * the rate cards are versioned too.
 */

export const RECIPIENT_MARKET_VERSION = 'recipient-market-2026-10';

/**
 * E.164 calling code → the single ISO alpha-2 it identifies.
 *
 * Deliberately restricted to the countries Meta names as markets. A code that
 * reaches more than one of those countries is NOT here — see `AMBIGUOUS_CODES`
 * — and a country Meta does not price individually does not need to be here at
 * all, because the answer for it is the same either way: the unnamed bucket.
 */
const CODE_TO_ISO: Readonly<Record<string, string>> = Object.freeze({
    '20': 'EG',   // Egypt
    '27': 'ZA',   // South Africa
    '31': 'NL',   // Netherlands
    '33': 'FR',   // France
    '34': 'ES',   // Spain
    '36': 'HU',   // Hungary
    '39': 'IT',   // Italy
    '40': 'RO',   // Romania
    '44': 'GB',   // United Kingdom
    '48': 'PL',   // Poland
    '49': 'DE',   // Germany
    '51': 'PE',   // Peru
    '52': 'MX',   // Mexico
    '54': 'AR',   // Argentina
    '55': 'BR',   // Brazil
    '56': 'CL',   // Chile
    '57': 'CO',   // Colombia
    '60': 'MY',   // Malaysia
    '62': 'ID',   // Indonesia
    '65': 'SG',   // Singapore
    '90': 'TR',   // Turkey
    '91': 'IN',   // India
    '92': 'PK',   // Pakistan
    '94': 'LK',   // Sri Lanka
    '212': 'MA',  // Morocco
    '234': 'NG',  // Nigeria
    '380': 'UA',  // Ukraine
    '852': 'HK',  // Hong Kong
    '880': 'BD',  // Bangladesh
    '964': 'IQ',  // Iraq
    '965': 'KW',  // Kuwait
    '966': 'SA',  // Saudi Arabia
    '968': 'OM',  // Oman
    '971': 'AE',  // United Arab Emirates
    '972': 'IL',  // Israel
    '974': 'QA',  // Qatar
    '977': 'NP',  // Nepal
});

/**
 * Calling codes that reach more than one country Meta prices separately.
 *
 * Listed rather than merely omitted, so the refusal has a reason a reader can
 * check instead of looking like a gap in the table.
 */
const AMBIGUOUS_CODES: Readonly<Record<string, string>> = Object.freeze({
    '1': 'the North American Numbering Plan — the United States, Canada and '
        + 'more than twenty other territories share it',
    '7': 'Russia and Kazakhstan, which Meta prices as two different markets',
});

export type RecipientMarket =
    | {
        readonly kind: 'resolved';
        readonly iso: string;
        readonly market: string;
        readonly callingCode: string;
        readonly version: string;
    }
    | {
        readonly kind: 'ambiguous';
        readonly callingCode: string;
        readonly reason: string;
        readonly version: string;
    }
    | {
        readonly kind: 'unlisted';
        readonly callingCode: string | null;
        readonly version: string;
    };

/** The longest code in the table, so the scan knows when to stop. */
const MAX_CODE_LENGTH = Math.max(
    ...Object.keys(CODE_TO_ISO).map(code => code.length),
    ...Object.keys(AMBIGUOUS_CODES).map(code => code.length));

/**
 * Read the market out of a destination address.
 *
 * Accepts anything a channel actually hands over — `+52 55 1234 5678`,
 * `5215512345678`, `whatsapp:+5215512345678` — because the sinks each carry the
 * recipient in their own shape and normalising at one of them would leave the
 * other two guessing.
 *
 * Longest prefix wins: `+1` and `+52` are both prefixes of nothing else here,
 * but `+9` is a prefix of `+92`, `+94` and six more, so a shortest-first scan
 * would resolve every Middle Eastern number to the wrong country.
 */
export function recipientMarket(address: unknown): RecipientMarket {
    const digits = String(address ?? '').replace(/[^0-9]/g, '');
    if (!digits) return Object.freeze({ kind: 'unlisted', callingCode: null, version: RECIPIENT_MARKET_VERSION });

    for (let length = Math.min(MAX_CODE_LENGTH, digits.length); length >= 1; length--) {
        const code = digits.slice(0, length);
        const ambiguous = AMBIGUOUS_CODES[code];
        if (ambiguous) {
            return Object.freeze({
                kind: 'ambiguous' as const, callingCode: code, reason: ambiguous,
                version: RECIPIENT_MARKET_VERSION,
            });
        }
        const iso = CODE_TO_ISO[code];
        if (!iso) continue;
        const market = WHATSAPP_MARKET_BY_ISO_ALPHA2[iso];
        // A code whose ISO has no market in the current card is not resolved
        // either: naming a country the price list does not know is a detail
        // that looks like an answer.
        if (!market) break;
        return Object.freeze({
            kind: 'resolved' as const, iso, market, callingCode: code,
            version: RECIPIENT_MARKET_VERSION,
        });
    }
    return Object.freeze({
        kind: 'unlisted' as const,
        callingCode: digits.slice(0, Math.min(3, digits.length)),
        version: RECIPIENT_MARKET_VERSION,
    });
}

/** The ISO to store on a reservation, or nothing. Never a guess. */
export function recipientIso(address: unknown): string | null {
    const resolved = recipientMarket(address);
    return resolved.kind === 'resolved' ? resolved.iso : null;
}

/** One line for a diagnosis, when the market could not be named. */
export function describeRecipientMarket(result: RecipientMarket): string {
    switch (result.kind) {
        case 'resolved':
            return `${result.iso} (${result.market}), from +${result.callingCode}`;
        case 'ambiguous':
            return `+${result.callingCode} does not identify one country: ${result.reason}. `
                + `Priced at the unnamed rate rather than guessed.`;
        case 'unlisted':
        default:
            return result.callingCode
                ? `+${result.callingCode} is not a country the current rate card prices individually.`
                : `no destination address to read a country from.`;
    }
}
