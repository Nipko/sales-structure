import type { Money } from '@parallext/shared';
import { CURRENCY_MINOR_EXPONENT, MICROS_PER_UNIT } from './whatsapp-rate-table.generated';
import { WHATSAPP_RATE_CARDS } from './whatsapp-rate-table.generated';

/**
 * A published Meta rate, in MICRO-UNITS per delivered message.
 *
 * The unit is in the field name on purpose. A bare `number` called `rate` is how
 * a price in cents gets multiplied by a price in units and nobody finds out
 * until the month closes.
 */
export interface RatePerMessageMicros {
    readonly currency: string;
    /** Millionths of one whole currency unit. 1 USD = 1_000_000. */
    readonly microsPerMessage: number;
}

/**
 * WHY MICRO-UNITS, AND WHERE THE ROUNDING HAPPENS
 *
 * Colombia's service rate is US$0.0008 per delivered message. In cents — the
 * unit `Money` from the outbound contract is written in — that is 0.08, and
 * there are only two ways to make it an integer:
 *
 *   round down → 0 cents. Every Colombian service message becomes free, the
 *     budget never moves, and the platform spends invisibly until an invoice
 *     arrives. This is the failure the whole exercise exists to prevent.
 *   round up → 1 cent. Twelve and a half times the real price. At any volume
 *     that refuses sends the tenant can comfortably afford, which is a different
 *     way of being wrong about the same number.
 *
 * So a per-message rate is never held in cents. It is held in micro-units,
 * millionths of a currency unit, where every rate Meta publishes — at most four
 * decimal places across all 850 prices in the four preserved cards — is an exact
 * integer with two orders of magnitude to spare. Nothing is lost and nothing is
 * invented.
 *
 * Rounding happens exactly once, as late as possible: when a batch of deliveries
 * is converted into the `Money` a reservation is taken in, and it rounds UP.
 * Up, because the direction of an error must be over-reserving rather than
 * over-spending. Once, per batch rather than per message, because that is what
 * keeps the ceiling honest at scale: 1,000 Colombian service messages are
 * 800,000 micros, which is exactly 80 cents with no rounding at all, where
 * ceiling-per-message would have reserved 1,000.
 *
 * The exact micro figure travels alongside the rounded `Money`, so a settlement
 * reconciles against the true amount and releases the surplus instead of
 * quietly keeping it.
 */
export type DeliveryPriceKind = 'priced' | 'uncountable';

export type UncountableReason =
    /** No ISO 4217 minor-unit exponent for this currency. We do not guess two. */
    | 'unsupported_currency'
    /** Minor units are coarser than micro-units cannot express. Not possible today. */
    | 'not_representable'
    /** A delivery count that is not a non-negative safe integer. */
    | 'invalid_delivery_count'
    /** A rate that is not a non-negative safe integer number of micros. */
    | 'invalid_rate';

export interface PricedDeliveries {
    readonly kind: 'priced';
    readonly deliveries: number;
    /** The true cost, exact. What a settlement reconciles against. */
    readonly exactMicros: number;
    /** The reservable amount: `exactMicros` rounded UP to whole minor units. */
    readonly money: Money;
    /** How much of `money` is rounding rather than price. Zero when exact. */
    readonly roundingSurplusMicros: number;
}

export interface UncountableDeliveries {
    readonly kind: 'uncountable';
    readonly reason: UncountableReason;
    readonly detail: string;
}

export type DeliveryPrice = PricedDeliveries | UncountableDeliveries;

const isCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Whole minor units per micro-unit for a currency, or `null` if we cannot say.
 *
 * `null` is the answer for a currency nobody published a card in. Assuming two
 * decimal places is how JPY (zero) and KWD (three) come out wrong by a factor of
 * a hundred, and a plausible wrong number is worse than a refusal.
 */
export function microsPerMinorUnit(currency: string): number | null {
    const exponent = CURRENCY_MINOR_EXPONENT[String(currency).toUpperCase()];
    if (exponent === undefined) return null;
    const divisor = MICROS_PER_UNIT / 10 ** exponent;
    return Number.isSafeInteger(divisor) && divisor >= 1 ? divisor : null;
}

/**
 * What a batch of deliveries at a given rate may be reserved for.
 *
 * Integer arithmetic throughout, over BigInt for the division, because
 * `Math.floor(a / b)` on a quotient that lands a hair under an integer is off by
 * one — and off by one in the direction of under-reserving.
 */
export function priceDeliveries(rate: RatePerMessageMicros, deliveries: number): DeliveryPrice {
    if (!isCount(deliveries)) {
        return { kind: 'uncountable', reason: 'invalid_delivery_count', detail: `deliveries=${String(deliveries)}` };
    }
    if (!isCount(rate?.microsPerMessage)) {
        return { kind: 'uncountable', reason: 'invalid_rate', detail: `microsPerMessage=${String(rate?.microsPerMessage)}` };
    }

    const currency = String(rate.currency).toUpperCase();
    const divisor = microsPerMinorUnit(currency);
    if (divisor === null) {
        return { kind: 'uncountable', reason: 'unsupported_currency', detail: currency };
    }

    const exactMicrosBig = BigInt(rate.microsPerMessage) * BigInt(deliveries);
    const exactMicros = Number(exactMicrosBig);
    if (!Number.isSafeInteger(exactMicros)) {
        return { kind: 'uncountable', reason: 'not_representable', detail: `${exactMicrosBig.toString()} micros exceeds a safe integer` };
    }

    const d = BigInt(divisor);
    const quotient = exactMicrosBig / d;
    const remainder = exactMicrosBig % d;
    const minorBig = remainder === 0n ? quotient : quotient + 1n;
    const minor = Number(minorBig);
    if (!Number.isSafeInteger(minor)) {
        return { kind: 'uncountable', reason: 'not_representable', detail: `${minorBig.toString()} minor units exceeds a safe integer` };
    }

    return {
        kind: 'priced',
        deliveries,
        exactMicros,
        money: { currency, minor },
        roundingSurplusMicros: Number(minorBig * d - exactMicrosBig),
    };
}

/**
 * The ceiling for ONE delivery — the `unitCeiling` a spend authorisation needs.
 *
 * Separate from `priceDeliveries` because it answers a different question. This
 * is the most a single message may cost before the send is refused outright,
 * which is a per-message ceiling and therefore rounds up per message; the batch
 * price is what gets reserved. Reserving at this figure × count would over-hold
 * budget by an order of magnitude on the cheapest markets.
 */
export function unitCeiling(rate: RatePerMessageMicros): Money | null {
    const priced = priceDeliveries(rate, 1);
    return priced.kind === 'priced' ? priced.money : null;
}

/**
 * ═══ WHAT A MESSAGE CANNOT COST MORE THAN ═══
 *
 * For an effect whose price cannot be computed — the account's billing currency
 * was never established, the recipient's country cannot be named, the template's
 * category never synced — there is still a question worth answering:
 *
 *     how much might this be?
 *
 * Reserving nothing answers it with "nothing", which is the one answer that is
 * certainly wrong: the message will be billed. It also makes the exposure report
 * show an empty month for an account that is spending.
 *
 * So an unpriceable effect reserves the HIGHEST price the current card prints
 * for that currency. That is a derived upper bound, not an invented estimate:
 * the card itself says nothing in it costs more. The reservation carries
 * `basis: 'unknown'` so nothing reads it as a price, and reconciliation settles
 * it against what Meta actually billed.
 *
 * It is deliberately pessimistic. Under a ceiling, a pessimistic bound stops
 * sending sooner than necessary, which is recoverable by raising the ceiling; an
 * optimistic one overspends, which is not.
 */
export function highestRatePerMessage(currency: string): Money | null {
    const wanted = String(currency).toUpperCase();
    let worst = 0;
    let found = false;
    for (const card of WHATSAPP_RATE_CARDS) {
        if (card.currency.toUpperCase() !== wanted) continue;
        for (const entry of card.entries) {
            for (const micros of Object.values(entry.micros)) {
                if (typeof micros !== 'number') continue;
                found = true;
                if (micros > worst) worst = micros;
            }
        }
    }
    if (!found) return null;
    // Through the same rounding the real price uses, so the bound and the price
    // it bounds are computed by one function rather than two that will
    // eventually disagree about a half minor unit.
    const priced = priceDeliveries({ microsPerMessage: worst, currency: wanted }, 1);
    return priced.kind === 'priced' ? priced.money : null;
}
