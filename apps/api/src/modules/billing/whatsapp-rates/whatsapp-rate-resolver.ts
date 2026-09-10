import type { PricingBasis } from '@parallext/shared';
import type { RatePerMessageMicros } from './whatsapp-rate-money';
import {
    WHATSAPP_MARKET_BY_ISO_ALPHA2,
    WHATSAPP_RATE_CARDS,
    WHATSAPP_RATE_TABLE_VERSION,
    type WhatsAppMessageCategory,
    type WhatsAppRateCard,
} from './whatsapp-rate-table.generated';

/**
 * Which market a message is priced against.
 *
 * Discriminated rather than a bare string because "CO" and "Colombia" are both
 * plausible values and silently treating one as the other is how a lookup misses
 * and falls through to something cheap. The caller says which it has.
 *
 * The market is the RECIPIENT's. Not the tenant's country, not the conversation
 * language, not the business's billing address — a Colombian company answering a
 * German customer pays the German rate, which is roughly seventy times more.
 */
export type MarketSelector =
    | { readonly kind: 'market_name'; readonly value: string }
    | { readonly kind: 'iso_alpha2'; readonly value: string };

export interface WhatsAppRateQuery {
    readonly category: WhatsAppMessageCategory;
    readonly recipient: MarketSelector;
    /** The currency the WhatsApp account is billed in, not the tenant's. */
    readonly currency: string;
    /** The instant of delivery. */
    readonly at: Date;
    /**
     * IANA time zone of the WhatsApp Business Account.
     *
     * Required, and deliberately not defaulted. The preserved evidence says the
     * effective date turns "a medianoche en la zona horaria WABA", so the same
     * instant is priced by the September card for one account and the October
     * card for another. A default would pick a wrong answer silently for
     * everybody east or west of whatever it defaulted to.
     */
    readonly wabaTimeZone: string;
}

export type WhatsAppRateUnknownReason =
    | 'invalid_instant'
    | 'unsupported_time_zone'
    | 'no_rate_card_for_currency'
    | 'no_rate_card_effective_yet'
    | 'market_not_in_rate_card'
    | 'category_not_priced_in_rate_card';

export interface PricedWhatsAppRate {
    readonly basis: 'priced';
    readonly rate: RatePerMessageMicros;
    readonly market: string;
    readonly category: WhatsAppMessageCategory;
    /** Which card answered. A price without this cannot be argued with later. */
    readonly rateVersion: string;
    readonly tableVersion: string;
    readonly effectiveFrom: string;
    /** The WABA-local calendar date the effective-date comparison actually used. */
    readonly appliedOnLocalDate: string;
    readonly source: {
        readonly file: string;
        readonly locator: string;
        readonly sha256: string;
        readonly url: string;
    };
}

export interface UnknownWhatsAppRate {
    readonly basis: 'unknown';
    readonly reason: WhatsAppRateUnknownReason;
    readonly detail: string;
    /** The card consulted, when one was reached before the answer ran out. */
    readonly rateVersion: string | null;
    readonly tableVersion: string;
    readonly appliedOnLocalDate: string | null;
}

export type WhatsAppRateResolution = PricedWhatsAppRate | UnknownWhatsAppRate;

/**
 * Both outcomes are members of the shared `PricingBasis`, checked at compile
 * time so this module cannot drift away from the contract the rest of the
 * outbound path answers to.
 */
type AssertBasisIsContractual = WhatsAppRateResolution['basis'] extends PricingBasis ? true : never;
const basisIsContractual: AssertBasisIsContractual = true;
void basisIsContractual;

/**
 * The calendar date at an instant, in a given IANA zone, as `YYYY-MM-DD`.
 *
 * Returns `null` for a zone the runtime does not know. Not a throw and not a
 * fallback to UTC: a typo'd zone must produce a refusal to price, not a price
 * computed against the wrong midnight.
 */
export function wabaLocalDate(at: Date, timeZone: string): string | null {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(at);
        const pick = (type: string) => parts.find(p => p.type === type)?.value;
        const year = pick('year');
        const month = pick('month');
        const day = pick('day');
        if (!year || !month || !day) return null;
        return `${year.padStart(4, '0')}-${month}-${day}`;
    } catch {
        return null;
    }
}

/** The calendar month at an instant in a zone, as `YYYY-MM`. */
export function wabaCalendarMonth(at: Date, timeZone: string): string | null {
    const date = wabaLocalDate(at, timeZone);
    return date ? date.slice(0, 7) : null;
}

/**
 * The card in force on a WABA-local date, for a currency.
 *
 * A card applies from midnight of its `effectiveFrom` in that zone, inclusive.
 * Inclusive is the whole boundary question: a message delivered at 00:00:00 on
 * 1 October, WABA time, is priced by the October card, and one delivered a
 * second earlier is not. ISO dates compare lexicographically, so the comparison
 * is the same as the chronological one with no parsing in between.
 */
export function rateCardInForce(currency: string, localDate: string): WhatsAppRateCard | null {
    const wanted = String(currency).toUpperCase();
    let chosen: WhatsAppRateCard | null = null;
    for (const card of WHATSAPP_RATE_CARDS) {
        if (card.currency.toUpperCase() !== wanted) continue;
        if (card.effectiveFrom > localDate) continue;
        if (!chosen || card.effectiveFrom > chosen.effectiveFrom) chosen = card;
    }
    return chosen;
}

/** Whether any card at all is published in a currency. */
export function hasRateCardsForCurrency(currency: string): boolean {
    const wanted = String(currency).toUpperCase();
    return WHATSAPP_RATE_CARDS.some(card => card.currency.toUpperCase() === wanted);
}

function marketNameFor(selector: MarketSelector): string | null {
    if (!selector) return null;
    if (selector.kind === 'market_name') {
        const value = String(selector.value ?? '').trim();
        return value || null;
    }
    const iso = String(selector.value ?? '').trim().toUpperCase();
    return WHATSAPP_MARKET_BY_ISO_ALPHA2[iso] ?? null;
}

const unknown = (
    reason: WhatsAppRateUnknownReason,
    detail: string,
    rateVersion: string | null,
    appliedOnLocalDate: string | null,
): UnknownWhatsAppRate => ({
    basis: 'unknown',
    reason,
    detail,
    rateVersion,
    tableVersion: WHATSAPP_RATE_TABLE_VERSION,
    appliedOnLocalDate,
});

/**
 * What Meta charges for one delivered message — or that we cannot say.
 *
 * Pure: same inputs, same answer, no clock, no I/O, no configuration. Every
 * price comes from a preserved rate card and carries the file and row it came
 * from.
 *
 * THE ONE RULE THIS FUNCTION EXISTS TO HOLD: a market with no rate card returns
 * `unknown`. Never zero, never the cheapest bucket, never "Other". Meta assigns
 * unlisted countries to regional buckets by calling code, on a page these
 * sources link to but do not contain, so routing an unlisted country into one
 * would be a guess in the direction of a lower price — the exact shape of error
 * that only shows up as an invoice.
 *
 * A CAVEAT WORTH READING. A `service` message dated before 1 October 2026
 * resolves to `unknown`, not to free. The prose evidence does say service was
 * free from November 2024, but the rate cards print `n/a`, and the manifest is
 * explicit that "n/a is unavailable, not zero". Asserting a price the source
 * does not state — even a price of zero — is the thing this module refuses to
 * do. The honest reading is that this table prices the October regime, and a
 * caller wanting to treat pre-October service as free must say so itself, in
 * the open, where somebody can disagree with it.
 */
export function resolveWhatsAppRate(query: WhatsAppRateQuery): WhatsAppRateResolution {
    const localDate = wabaLocalDate(query.at, query.wabaTimeZone);
    if (localDate === null) {
        const reason: WhatsAppRateUnknownReason =
            !(query.at instanceof Date) || Number.isNaN(query.at?.getTime?.())
                ? 'invalid_instant'
                : 'unsupported_time_zone';
        return unknown(reason, String(query.wabaTimeZone), null, null);
    }

    if (!hasRateCardsForCurrency(query.currency)) {
        return unknown('no_rate_card_for_currency', String(query.currency).toUpperCase(), null, localDate);
    }

    const card = rateCardInForce(query.currency, localDate);
    if (!card) {
        return unknown(
            'no_rate_card_effective_yet',
            `no ${String(query.currency).toUpperCase()} card is in force on ${localDate}`,
            null,
            localDate,
        );
    }

    const market = marketNameFor(query.recipient);
    if (market === null) {
        return unknown(
            'market_not_in_rate_card',
            `${query.recipient?.kind ?? 'market'} ${String(query.recipient?.value)} has no market in ${card.rateVersion}`,
            card.rateVersion,
            localDate,
        );
    }

    const entry = card.entries.find(candidate => candidate.market === market);
    if (!entry) {
        return unknown('market_not_in_rate_card', `${market} is not in ${card.rateVersion}`, card.rateVersion, localDate);
    }

    const micros = entry.micros[query.category];
    if (micros === undefined || micros === 'unavailable') {
        return unknown(
            'category_not_priced_in_rate_card',
            `${card.rateVersion} prints no ${query.category} rate for ${market} (${card.sourceFile} ${entry.locator})`,
            card.rateVersion,
            localDate,
        );
    }

    return {
        basis: 'priced',
        rate: { currency: card.currency, microsPerMessage: micros },
        market,
        category: query.category,
        rateVersion: card.rateVersion,
        tableVersion: WHATSAPP_RATE_TABLE_VERSION,
        effectiveFrom: card.effectiveFrom,
        appliedOnLocalDate: localDate,
        source: {
            file: card.sourceFile,
            locator: entry.locator,
            sha256: card.sourceSha256,
            url: card.sourceUrl,
        },
    };
}
