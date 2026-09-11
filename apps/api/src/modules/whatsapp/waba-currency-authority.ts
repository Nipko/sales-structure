import { hasRateCardsForCurrency } from '../billing/whatsapp-rates';

/**
 * ═══ THE CURRENCY META BILLS THIS ACCOUNT IN ═══
 *
 * Every rate card is published in a currency, and a price in the wrong one is
 * not a rounding error — it is a number three orders of magnitude out when the
 * account settles in pesos and the card was read in dollars.
 *
 * The engine had no writer for it at all. The admission read
 * `metadata.billingCurrency`, nothing ever set it, and the authority answered
 * `currency_unknown` on every send. Substituting a default and then pricing
 * normally is worse than the refusal it replaced: it produces `basis: 'priced'`
 * with an exact amount, in a currency nobody established.
 *
 * So a currency here always carries WHERE it came from and WHEN, and a value
 * with no provenance is not a currency — it is a guess somebody typed.
 *
 * ── WHY FRESHNESS ───────────────────────────────────────────────────────────
 *
 * Meta can change a WABA's billing currency, and the account's own rate card
 * changes with it. A value read at connection time and never re-read is right
 * until the day it is not, and nothing would say which day that was. Stale
 * evidence is still USED — a slightly old currency beats no currency — but it
 * is reported as stale so readiness can ask for a refresh, and so a
 * reconciliation that disagrees with Meta's invoice has somewhere to look.
 */

export type CurrencySource =
    /** Read from Meta's own WABA record. The only authoritative one. */
    | 'meta_waba'
    /** Set by a person because Meta's value was unavailable. */
    | 'operator'
    /** Carried from another number on the same WABA. */
    | 'same_waba';

export interface CurrencyEvidence {
    readonly currency: string;
    readonly source: CurrencySource;
    readonly observedAt: string;
    /** Which WABA the evidence belongs to, when known. */
    readonly wabaId?: string | null;
    /** Who confirmed it, for an operator value. Never an email or a token. */
    readonly by?: string | null;
}

/** After this, evidence is still used and reported as stale. */
export const CURRENCY_FRESH_FOR_MS = 30 * 24 * 60 * 60 * 1000;

export type CurrencyResolution =
    | {
        readonly kind: 'established';
        readonly currency: string;
        readonly evidence: CurrencyEvidence;
        readonly stale: boolean;
        readonly ageMs: number;
    }
    | {
        readonly kind: 'unknown';
        readonly reason: 'no_evidence' | 'malformed_evidence' | 'currency_not_priced';
        readonly detail: string;
    };

const CODE = /^[A-Z]{3}$/;

/**
 * Read the evidence off an account's metadata, refusing what cannot be trusted.
 *
 * A bare string with no provenance is refused rather than honoured. That is the
 * whole point: the failure this module exists to prevent is a confident price in
 * a currency nobody established, and a value somebody typed into a JSON blob is
 * exactly that.
 */
export function readCurrencyEvidence(metadata: unknown): CurrencyEvidence | null {
    const raw = (metadata as any)?.billingCurrencyEvidence;
    if (!raw || typeof raw !== 'object') return null;
    const currency = String(raw.currency ?? '').trim().toUpperCase();
    if (!CODE.test(currency)) return null;
    if (!['meta_waba', 'operator', 'same_waba'].includes(raw.source)) return null;
    if (typeof raw.observedAt !== 'string' || Number.isNaN(Date.parse(raw.observedAt))) return null;
    return Object.freeze({
        currency,
        source: raw.source as CurrencySource,
        observedAt: raw.observedAt,
        wabaId: raw.wabaId ?? null,
        ...(raw.by ? { by: String(raw.by).slice(0, 120) } : {}),
    });
}

/** What currency to price this account in, or why we cannot say. */
export function resolveCurrency(metadata: unknown, now: Date = new Date()): CurrencyResolution {
    const evidence = readCurrencyEvidence(metadata);
    if (!evidence) {
        // A legacy `billingCurrency` with no provenance is deliberately NOT
        // honoured. It is the shape this module replaces, and treating it as
        // established would carry the defect forward under a new name.
        const legacy = String((metadata as any)?.billingCurrency ?? '').trim();
        return Object.freeze({
            kind: 'unknown' as const,
            reason: legacy ? 'malformed_evidence' as const : 'no_evidence' as const,
            detail: legacy
                ? `"${legacy}" is stored with no source or date, so it cannot be used to price. `
                    + 'Reconnect the number so Meta reports the billing currency, or set it explicitly.'
                : 'Meta has not reported a billing currency for this WhatsApp Business Account yet. '
                    + 'Reconnect the number, or set the currency explicitly.',
        });
    }
    if (!hasRateCardsForCurrency(evidence.currency)) {
        // Established and unusable are different answers, and an operator needs
        // to tell them apart: one is "reconnect", the other is "we have no card".
        return Object.freeze({
            kind: 'unknown' as const, reason: 'currency_not_priced' as const,
            detail: `Meta bills this account in ${evidence.currency}, and no published rate card `
                + 'covers that currency yet.',
        });
    }
    const ageMs = Math.max(0, now.getTime() - Date.parse(evidence.observedAt));
    return Object.freeze({
        kind: 'established' as const,
        currency: evidence.currency,
        evidence,
        stale: ageMs > CURRENCY_FRESH_FOR_MS,
        ageMs,
    });
}

/** Build the evidence to persist, from what Meta actually returned. */
export function currencyFromMeta(currency: unknown, wabaId?: string | null,
    now: Date = new Date()): CurrencyEvidence | null {
    const code = String(currency ?? '').trim().toUpperCase();
    if (!CODE.test(code)) return null;
    return Object.freeze({
        currency: code, source: 'meta_waba' as const,
        observedAt: now.toISOString(), wabaId: wabaId ?? null,
    });
}

/** One line for a person, in their own terms. */
export function describeCurrency(resolution: CurrencyResolution): string {
    if (resolution.kind === 'unknown') return resolution.detail;
    const days = Math.floor(resolution.ageMs / (24 * 60 * 60 * 1000));
    const where = resolution.evidence.source === 'meta_waba'
        ? 'reported by Meta'
        : resolution.evidence.source === 'operator' ? 'set by your team'
            : 'taken from another number on the same WhatsApp Business Account';
    return `Charges are counted in ${resolution.currency}, ${where} ${days} day(s) ago.`
        + (resolution.stale ? ' Worth re-checking: Meta can change it.' : '');
}
