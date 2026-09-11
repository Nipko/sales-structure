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

export interface SpendExposureRow {
    currency: string;
    reservedMinor: number;
    settledMinor: number;
    retainedMinor: number;
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
 * What a number still has of its free monthly allowance.
 *
 * Meta gives one thousand delivered service messages per NUMBER per calendar
 * month, dated in that account's own time zone. Returned as a pair rather than
 * a percentage because "you have used 964 of 1,000" is actionable and "96%" is
 * a feeling.
 */
export const FREE_ALLOWANCE_PER_MONTH = 1000;

export function allowanceRemaining(rows: readonly SpendExposureRow[]): {
    used: number; total: number;
} {
    // Summed across currencies on purpose, and it is the one thing that can be:
    // the allowance is counted in MESSAGES, and a message is a message whatever
    // it would have cost.
    const used = rows.reduce((total, row) => total + row.freeDeliveries, 0);
    return { used: Math.min(used, FREE_ALLOWANCE_PER_MONTH), total: FREE_ALLOWANCE_PER_MONTH };
}

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
