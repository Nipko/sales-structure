/**
 * ═══ READING THE WHATSAPP BILL, WITHOUT PRETENDING IT IS OURS ═══
 *
 * From 1 October 2026 Meta charges the tenant's own WhatsApp Business Account
 * for every delivered service message. Parallly neither pays it nor receives
 * it — which is exactly why it has to be legible inside Parallly. From the
 * outside the agent replying and the bill arriving look like one product, and a
 * business owner who cannot see the second inside the first concludes we are
 * charging them twice.
 *
 * Everything here is presentation of numbers the API already computed. No
 * arithmetic on money happens in the browser beyond turning minor units into a
 * locale string, and in particular NOTHING here adds two currencies: a single
 * total across pesos and dollars is wrong in the way nobody notices until they
 * act on it.
 */

/**
 * Six numbers, because they mean six different things.
 *
 * A single "spend" figure is a lie in both directions: it either hides money
 * that may still be charged, or presents a bound as a bill. `retainedMinor` is
 * the sum of the four unresolved ones and is kept because "how much of my
 * ceiling is committed" is a real question with one answer — but it is a
 * derived total, never a substitute for the parts, so the parts are carried
 * here rather than dropped on the way to the browser.
 */
export interface SpendExposureRow {
    currency: string;
    /** Committed, the POST unresolved. */
    reservedMinor: number;
    /** Meta took it; whether it arrived is unknown. */
    acceptedMinor: number;
    /** It arrived, the price is unknown, the bound is kept. */
    estimatedMinor: number;
    /** We cannot say whether it arrived at all. */
    uncertainMinor: number;
    /** An authority stated the amount. */
    settledMinor: number;
    /** The four unresolved ones together. */
    retainedMinor: number;
    /** Provably not charged. */
    releasedMinor: number;
    freeDeliveries: number;
    chargedDeliveries: number;
}

export interface CostlyRecipientRow {
    recipientRef: string;
    currency: string;
    proactive: number;
    reactive: number;
    settledMinor: number;
    uncertainMinor: number;
}

export interface CategorySpendRow {
    category: string;
    market: string | null;
    currency: string;
    deliveries: number;
    settledMinor: number;
    proactive: number;
}

export interface WhatsappSpendSummary {
    windowDays: number;
    since: string;
    channelAccountId: string | null;
    exposure: SpendExposureRow[];
    signals: {
        costliestRecipients: CostlyRecipientRow[];
        byCategory: CategorySpendRow[];
    };
    refusalCodes: string[];
}

/**
 * One number's pause state, exactly as `GET /whatsapp/spend/pauses` reports it.
 *
 * Three states, not two. `paused` is Meta refusing to bill this business;
 * `stateUnknown` is us being unable to find out — and while we cannot find out,
 * nothing is sent. Folding the second into "running" is how an operator
 * concludes nothing is wrong while nothing is going out, so the two travel
 * separately all the way to the screen.
 */
export interface WhatsappNumberPause {
    channelAccountId: string;
    displayName: string | null;
    paused: boolean;
    /** True when we could not find out. Never the same as `paused: false`. */
    stateUnknown: boolean;
    /** The operator's sentence, built by the API where the rule lives. */
    explanation: string | null;
    since: string | null;
    observations: number;
    clearedAt: string | null;
}

/**
 * The numbers a person has to be told about.
 *
 * A number that is sending normally is not news. A number that stopped, and a
 * number whose state we could not read, both are — and the second is not a
 * lesser version of the first: one is fixed with a card in Meta, the other is
 * ours to fix.
 */
export function pausesWorthShowing(
    rows: readonly WhatsappNumberPause[] | null | undefined,
): readonly WhatsappNumberPause[] {
    return (rows ?? []).filter(row => row.paused || row.stateUnknown);
}

/**
 * ═══ WHAT EACH NUMBER CONSUMED, BY THE CALENDAR THE INVOICE USES ═══
 *
 * `summary` answers about a rolling window, which is the right shape for "what
 * is happening right now" and the wrong one for the two questions somebody has
 * before an invoice arrives. The free service deliveries reset at midnight on
 * the first IN THE WHATSAPP ACCOUNT'S OWN TIME ZONE, and Meta invoices by
 * calendar month; a rolling thirty days straddles that boundary by
 * construction.
 *
 * So these rows come pre-dated by the server, in the account's own zone, and
 * nothing here re-derives a month from a timestamp: the browser's clock has no
 * business deciding which month a charge in Bogotá belongs to.
 */
export interface WhatsappMonthMoney {
    currency: string;
    settledMinor: number;
    retainedMinor: number;
}

export interface WhatsappMonthRow {
    /** `YYYY-MM` in the WhatsApp account's own zone, or `null` for undated. */
    month: string | null;
    channelAccountId: string;
    freeDeliveries: number;
    chargedDeliveries: number;
    /** Per currency, never summed across them. */
    money: WhatsappMonthMoney[];
    byMarketCategory: Array<{
        market: string | null;
        category: string;
        deliveries: number;
        currency: string;
        settledMinor: number;
        retainedMinor: number;
    }>;
}

export interface WhatsappConsumption {
    months: number;
    /**
     * The allowance Meta gives, sent by the server alongside the rows.
     *
     * Read from the payload and never from a constant in this file. A figure
     * hardcoded in a dashboard is a figure that will be wrong the month Meta
     * changes it and right nowhere — and the panel used to carry its own copy.
     */
    freeServiceDeliveriesPerNumberMonth: number;
    consumption: WhatsappMonthRow[];
}

/** One number's position in one calendar month, ready to render. */
export interface WhatsappNumberMonth {
    channelAccountId: string;
    month: string;
    freeDeliveries: number;
    /** This number's own allowance for this month, from the server. */
    allowance: number;
    chargedDeliveries: number;
    /** One entry per currency. There is deliberately no combined total. */
    money: WhatsappMonthMoney[];
}

/**
 * The most recent dated month each number has.
 *
 * Per NUMBER, because the allowance is per number: two numbers that have each
 * used six hundred have four hundred left each, and the panel used to add them
 * and report the allowance exhausted. And per the SERVER'S month string, so a
 * business in Bogotá is not told about a charge in whatever month the browser
 * thinks it is.
 *
 * Rows the server could not date are excluded here and reported by
 * `undatedConsumption`: attributing unpriced spend to a month it may not belong
 * to is how a reconciliation that looks complete hides the rows needing
 * attention.
 */
export function latestMonthPerNumber(
    payload: WhatsappConsumption | null | undefined,
): readonly WhatsappNumberMonth[] {
    if (!payload) return [];
    const allowance = payload.freeServiceDeliveriesPerNumberMonth;
    const latest = new Map<string, WhatsappMonthRow>();
    for (const row of payload.consumption ?? []) {
        if (!row.month) continue;
        const held = latest.get(row.channelAccountId);
        // String comparison is the right one: `YYYY-MM` sorts chronologically,
        // and parsing it into a Date would reintroduce the time zone this
        // whole path exists to keep out of the browser.
        if (!held || row.month > (held.month ?? '')) latest.set(row.channelAccountId, row);
    }
    return [...latest.values()]
        .map(row => ({
            channelAccountId: row.channelAccountId,
            month: row.month as string,
            freeDeliveries: row.freeDeliveries,
            allowance,
            chargedDeliveries: row.chargedDeliveries,
            money: [...(row.money ?? [])],
        }))
        .sort((left, right) => left.channelAccountId.localeCompare(right.channelAccountId));
}

/**
 * Rows nobody could date, which is to say rows nobody could price.
 *
 * Kept apart from every month rather than folded into the current one. They are
 * not zero and they are not this month's: they are the ones that need somebody.
 */
export function undatedConsumption(
    payload: WhatsappConsumption | null | undefined,
): readonly WhatsappMonthRow[] {
    return (payload?.consumption ?? []).filter(row => row.month === null);
}

/**
 * ═══ IS THIS NUMBER READY TO KEEP DELIVERING? ═══
 *
 * The same five states the engine classifies, mirrored here so the screen
 * cannot invent a sixth or collapse two into one. In particular:
 *
 *   · `attached` is NOT solvency. A card can be attached and declined, expired
 *     or over its limit, and Meta will still say it is attached. Nothing built
 *     on this may render a green tick that implies "this will work";
 *   · `not_checked` is the honest starting state and is not a synonym for
 *     `absent`. Telling a tenant who connected five minutes ago that their
 *     funding is missing is a guess dressed as a finding.
 */
export const FUNDING_READINESS_STATES = [
    'not_checked', 'attached', 'absent', 'restricted', 'unknown',
] as const;
export type FundingReadinessState = (typeof FUNDING_READINESS_STATES)[number];

/**
 * Three answers, not two.
 *
 * `unknown` is not `ready`, because saying yes on no evidence is the failure
 * this exists to prevent; and it is not `not_ready` either, because sending
 * somebody to fix a problem nobody established is how they learn to ignore the
 * warning that matters.
 */
export function deliveryReadiness(
    state: FundingReadinessState,
): 'ready' | 'not_ready' | 'unestablished' {
    if (state === 'attached') return 'ready';
    if (state === 'absent' || state === 'restricted') return 'not_ready';
    return 'unestablished';
}

/**
 * Is this a state a person has to do something about?
 *
 * `unestablished` is deliberately NOT actionable: the thing to do about it is
 * ask again, which is the system's job, not theirs. Putting it in front of
 * somebody is how a warning becomes noise and the real one gets ignored.
 */
export function fundingIsActionable(state: FundingReadinessState): boolean {
    return deliveryReadiness(state) === 'not_ready';
}

/**
 * Minor units to something a person reads, in THEIR locale.
 *
 * `Intl` is given the currency rather than a hard-coded divisor because minor
 * units are not always hundredths — and a WhatsApp rate in a currency with no
 * decimal places, divided by a hundred, would be displayed as one per cent of
 * itself.
 */
export function formatMinor(minor: number, currency: string, locale: string): string {
    try {
        const digits = new Intl.NumberFormat(locale, { style: 'currency', currency })
            .resolvedOptions().maximumFractionDigits ?? 2;
        return new Intl.NumberFormat(locale, { style: 'currency', currency })
            .format(minor / 10 ** digits);
    } catch {
        // An unknown currency code must not blank the panel: the number is the
        // information, and the code beside it is still true.
        return `${(minor / 100).toFixed(2)} ${currency}`;
    }
}

/**
 * ── WHY THERE IS NO `allowanceRemaining(exposure)` HERE ─────────────────────
 *
 * There was one. It added `freeDeliveries` across every row of the rolling
 * thirty-day summary, compared the total to a `1000` written in this file, and
 * clamped the result so it never exceeded it. Three separate untruths in eight
 * lines:
 *
 *   · the allowance is per NUMBER. Two numbers that had each used six hundred
 *     were reported as "1,000 of 1,000" — allowance exhausted — when each of
 *     them had four hundred left;
 *   · the allowance is per CALENDAR MONTH in the WhatsApp account's own zone,
 *     and a rolling thirty days straddles that boundary by construction;
 *   · the clamp turned the resulting overflow from a visible wrong number into
 *     an invisible one, which is why nothing ever looked broken.
 *
 * The replacement is `latestMonthPerNumber`, which reads rows the server dated
 * and an allowance the server sent.
 */

/**
 * Is any of this month's money still unaccounted for?
 *
 * `retained` is the honest and uncomfortable number: an effect whose outcome
 * never came back. It is not a cost yet and it is not nothing — it is the
 * amount somebody has to reconcile — so it gets its own line rather than being
 * folded into either neighbour.
 */
export function hasUnresolvedExposure(rows: readonly SpendExposureRow[]): boolean {
    return rows.some(row => row.retainedMinor > 0);
}
