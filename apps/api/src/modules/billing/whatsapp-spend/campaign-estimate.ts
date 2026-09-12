import {
    resolveWhatsAppRate, recipientIso, recipientMarket, wabaCalendarMonth, priceDeliveries,
    formatMinorUnits,
    type WhatsAppRateResolution, type WhatsAppMessageCategory,
} from '../whatsapp-rates';

/**
 * ═══ WHAT A CAMPAIGN COSTS, BEFORE ANYBODY PRESSES SEND ═══
 *
 * From 1 October 2026 Meta charges the business's own WhatsApp account per
 * delivered message, at a rate that depends on the recipient's MARKET and on
 * the template's approved CATEGORY. A campaign to four thousand people is
 * therefore a purchase, and until now the operator made it blind: the product
 * asked them to confirm a send with no number attached to it, and the first
 * time anybody saw the figure was on Meta's invoice.
 *
 * This is that figure, computed from the same rate cards the admission uses, so
 * the estimate and the reservation cannot disagree about what a message costs.
 *
 * ── WHY IT IS AN ESTIMATE AND SAYS SO ───────────────────────────────────────
 *
 * Three things can still move between here and the invoice:
 *
 *   · a recipient can be unreachable, and an undelivered message is not
 *     charged — so this is an upper bound on deliveries, never a forecast;
 *   · Meta applies the rate in force at DELIVERY, and a campaign that spans
 *     midnight in the account's own time zone can cross a card boundary;
 *   · a number this cannot place in a market has no price here, and a market
 *     without a price is NOT free.
 *
 * The last one is the one that matters. A destination the rate card does not
 * know is the single easiest way to make an estimate look good: drop it from
 * the total and the campaign appears cheaper than it is. So unpriced recipients
 * are counted, listed by why, and reported beside the total rather than inside
 * it — a campaign whose estimate is "US$12,40 plus 340 recipients nobody could
 * price" is a campaign an operator can make a decision about.
 *
 * ── AND WHY NOTHING IS SUMMED ACROSS CURRENCIES ─────────────────────────────
 *
 * The rate card prices in the currency the WhatsApp account is billed in. Two
 * accounts in two currencies produce two totals, and adding them would require
 * an exchange rate nobody agreed to. Money comes back in minor units with its
 * currency beside it.
 */

/** A recipient this estimate could price. */
export interface EstimatedRecipient {
    readonly recipientRef: string;
    readonly market: string;
    readonly micros: number;
}

/** A recipient it could not, and precisely why. */
export interface UnpricedRecipient {
    readonly recipientRef: string;
    readonly reason: string;
    readonly detail: string;
}

export interface CampaignEstimate {
    /** The category every message in this campaign is priced at. */
    readonly category: WhatsAppMessageCategory | null;
    readonly categoryDetail: string;
    /** The account that will be billed, and the currency it is billed in. */
    readonly channelAccountId: string;
    readonly currency: string;
    /** The WABA-local calendar month the estimate was taken in. */
    readonly calendarMonth: string | null;
    readonly recipients: number;
    readonly priced: number;
    /** Upper bound on what Meta charges if every priced message is delivered. */
    readonly totalMicros: number;
    /** `null` when the parts priced and the whole did not. Never a silent zero. */
    readonly totalMinorUnits: number | null;
    /** Per market, so an operator can see which destinations cost what. */
    readonly byMarket: ReadonlyArray<{
        readonly market: string;
        readonly recipients: number;
        readonly micros: number;
        readonly unitMicros: number;
    }>;
    /** Counted and named, never dropped. */
    readonly unpriced: readonly UnpricedRecipient[];
    readonly unpricedByReason: Readonly<Record<string, number>>;
    /**
     * The free service allowance is NOT applied here, and this says why.
     *
     * A campaign goes out as an approved template — marketing, utility or
     * authentication — and the thousand free deliveries per number per calendar
     * month are for SERVICE messages only. Subtracting them from a campaign
     * estimate would promise a discount Meta does not give, and would then
     * consume, on paper, an allowance the tenant still needs for the replies
     * the campaign provokes.
     */
    readonly freeAllowanceApplies: false;
    readonly freeAllowanceNote: string;
}

/** How the rate resolver's refusal reads in a sentence an operator can act on. */
const REASONS: Readonly<Record<string, string>> = Object.freeze({
    invalid_instant: 'la fecha de la estimación no es válida',
    unsupported_time_zone: 'la zona horaria de la cuenta de WhatsApp no se reconoce',
    no_rate_card_for_currency: 'no hay tarjeta de tarifas para la moneda de la cuenta',
    no_rate_card_effective_yet: 'ninguna tarjeta está vigente en esa fecha',
    market_not_in_rate_card: 'el país del destinatario no está en la tarjeta de tarifas',
    category_not_priced_in_rate_card: 'la tarjeta no cotiza esa categoría para ese país',
    no_destination: 'el destinatario no tiene un número al que enviar',
    category_unknown: 'la plantilla no tiene categoría aprobada sincronizada',
    market_ambiguous: 'el prefijo del número lo comparten varios países que Meta cobra distinto',
    market_unlisted: 'el prefijo del número no está en la tabla de mercados',
    total_not_representable: 'el total no se puede expresar en la moneda de la cuenta',
});

const describe = (reason: string, detail: string) =>
    `${REASONS[reason] ?? reason}${detail ? `: ${detail}` : ''}`;

/**
 * Price one campaign's pending recipients.
 *
 * Pure: it is handed the recipients and the template's category, and it reads
 * only the rate cards. Nothing here touches the database, so the same function
 * prices a campaign that exists and one an operator is still composing — which
 * is the point, because the figure has to be visible BEFORE the campaign is
 * saved.
 *
 * `category` is `null` when the template's approved category could not be
 * established. That is not a reason to guess: every recipient comes back
 * unpriced with that reason, and the operator is told to sync their templates
 * rather than shown a number computed from an assumption.
 */
export function estimateCampaign(input: {
    readonly recipients: ReadonlyArray<{ readonly recipientRef: string; readonly address: string | null }>;
    readonly category: WhatsAppMessageCategory | null;
    readonly categoryDetail?: string;
    readonly channelAccountId: string;
    readonly currency: string;
    readonly wabaTimeZone: string;
    readonly at: Date;
}): CampaignEstimate {
    const priced: EstimatedRecipient[] = [];
    const unpriced: UnpricedRecipient[] = [];

    for (const recipient of input.recipients) {
        const address = String(recipient.address ?? '').trim();
        if (!address) {
            unpriced.push({ recipientRef: recipient.recipientRef, reason: 'no_destination',
                detail: describe('no_destination', '') });
            continue;
        }
        if (!input.category) {
            unpriced.push({ recipientRef: recipient.recipientRef, reason: 'category_unknown',
                detail: describe('category_unknown', input.categoryDetail ?? '') });
            continue;
        }
        // The recipient's own market, from their number. Never the tenant's
        // country: a Colombian business messaging a German customer pays the
        // German rate, and using the business's country is how an estimate
        // comes back several times too low for exactly the traffic that is most
        // expensive.
        //
        // A prefix several countries share — +1 across the North American plan,
        // +7 across Russia and Kazakhstan, which Meta prices differently — is
        // AMBIGUOUS, not resolved to whichever is cheapest. It comes back
        // unpriced with that reason, because picking one would put a number on
        // screen that the invoice will contradict.
        const iso = recipientIso(address);
        if (!iso) {
            const market = recipientMarket(address);
            const reason = market.kind === 'ambiguous' ? 'market_ambiguous' : 'market_unlisted';
            unpriced.push({ recipientRef: recipient.recipientRef, reason,
                detail: describe(reason, market.callingCode ? `+${market.callingCode}` : '') });
            continue;
        }
        const rate: WhatsAppRateResolution = resolveWhatsAppRate({
            category: input.category,
            recipient: { kind: 'iso_alpha2', value: iso },
            currency: input.currency,
            at: input.at,
            wabaTimeZone: input.wabaTimeZone,
        });
        if (rate.basis !== 'priced') {
            unpriced.push({ recipientRef: recipient.recipientRef, reason: rate.reason,
                detail: describe(rate.reason, rate.detail) });
            continue;
        }
        priced.push({ recipientRef: recipient.recipientRef, market: rate.market,
            micros: rate.rate.microsPerMessage });
    }

    const byMarket = new Map<string, { recipients: number; micros: number; unitMicros: number }>();
    for (const entry of priced) {
        const bucket = byMarket.get(entry.market)
            ?? { recipients: 0, micros: 0, unitMicros: entry.micros };
        bucket.recipients += 1;
        bucket.micros += entry.micros;
        byMarket.set(entry.market, bucket);
    }
    const totalMicros = priced.reduce((sum, entry) => sum + entry.micros, 0);
    // Converted by the same function the reservation uses, so the estimate and
    // the reservation cannot round differently: integer arithmetic over BigInt,
    // rounded UP, and against the currency's own minor-unit exponent rather
    // than an assumed two decimals. An estimate that rounds down is one that is
    // always slightly too cheap, in the direction that makes somebody say yes.
    const total = priceDeliveries(
        { currency: input.currency, microsPerMessage: totalMicros }, 1);
    const unpricedByReason: Record<string, number> = {};
    for (const entry of unpriced) {
        unpricedByReason[entry.reason] = (unpricedByReason[entry.reason] ?? 0) + 1;
    }
    if (total.kind !== 'priced' && priced.length) {
        // The parts priced and the whole did not. Reported, never silently
        // shown as zero.
        unpricedByReason.total_not_representable = priced.length;
    }

    return Object.freeze({
        category: input.category,
        categoryDetail: input.categoryDetail ?? '',
        channelAccountId: input.channelAccountId,
        currency: String(input.currency).toUpperCase(),
        calendarMonth: wabaCalendarMonth(input.at, input.wabaTimeZone),
        recipients: input.recipients.length,
        priced: priced.length,
        totalMicros,
        totalMinorUnits: total.kind === 'priced' ? total.money.minor : null,
        byMarket: Object.freeze([...byMarket.entries()]
            .map(([market, bucket]) => Object.freeze({ market, ...bucket }))
            .sort((left, right) => right.micros - left.micros)),
        unpriced: Object.freeze(unpriced),
        unpricedByReason: Object.freeze(unpricedByReason),
        freeAllowanceApplies: false,
        freeAllowanceNote: 'Las 1.000 entregas gratuitas por número y mes calendario son para '
            + 'mensajes de SERVICIO. Una campaña sale como plantilla aprobada, así que no las '
            + 'consume ni se descuenta de este total.',
    });
}

/** A one-line summary for a log or an operator's confirmation dialogue. */
export function describeCampaignEstimate(estimate: CampaignEstimate): string {
    const money = estimate.totalMinorUnits === null
        ? `un total que no se puede expresar en ${estimate.currency}`
        // Never `/ 100`: the number of decimals is a fact about the currency,
        // and a currency we hold no card for is said in minor units rather than
        // divided by a guess.
        : `${formatMinorUnits(estimate.totalMinorUnits, estimate.currency)
            ?? `${estimate.totalMinorUnits} (unidades menores)`} ${estimate.currency}`;
    const head = `${estimate.priced} de ${estimate.recipients} destinatarios por hasta ${money}`;
    if (!estimate.unpriced.length) return head;
    return `${head}; ${estimate.unpriced.length} sin precio `
        + `(${Object.entries(estimate.unpricedByReason)
            .map(([reason, count]) => `${count} ${REASONS[reason] ?? reason}`).join(', ')})`;
}
