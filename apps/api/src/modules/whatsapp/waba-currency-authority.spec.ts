import {
    CURRENCY_FRESH_FOR_MS, currencyFromMeta, describeCurrency, readCurrencyEvidence, resolveCurrency,
} from './waba-currency-authority';

/**
 * ═══ A PRICE IN A CURRENCY NOBODY ESTABLISHED ═══
 *
 * The failure this module prevents is not a missing number. It is a CONFIDENT
 * one: substituting a default currency and then pricing normally produces
 * `basis: 'priced'` with an exact amount in money nobody ever confirmed, which
 * reads as authoritative and is three orders of magnitude out when the account
 * settles in pesos and the card was read in dollars.
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const stored = (over: Record<string, unknown> = {}) => ({
    billingCurrencyEvidence: {
        currency: 'USD', source: 'meta_waba', observedAt: ago(0), wabaId: 'waba-1', ...over,
    },
});

describe('what counts as evidence', () => {
    it('accepts a value that says where it came from and when', () => {
        const evidence = readCurrencyEvidence(stored())!;
        expect({ currency: evidence.currency, source: evidence.source })
            .toEqual({ currency: 'USD', source: 'meta_waba' });
    });

    it('refuses a bare currency with no provenance', () => {
        // The shape this module replaces. Honouring it would carry the defect
        // forward under a new name: a price in money somebody typed.
        expect(readCurrencyEvidence({ billingCurrency: 'USD' })).toBeNull();
        const resolution = resolveCurrency({ billingCurrency: 'COP' });
        expect(resolution.kind).toBe('unknown');
        expect(resolution.kind === 'unknown' && resolution.reason).toBe('malformed_evidence');
        expect(resolution.kind === 'unknown' && resolution.detail).toContain('no source or date');
    });

    it('refuses evidence that is malformed in any of the three ways', () => {
        expect(readCurrencyEvidence(stored({ currency: 'dollars' }))).toBeNull();
        expect(readCurrencyEvidence(stored({ source: 'guess' }))).toBeNull();
        expect(readCurrencyEvidence(stored({ observedAt: 'recently' }))).toBeNull();
        expect(readCurrencyEvidence(undefined)).toBeNull();
    });

    it('normalises casing without inventing anything', () => {
        expect(readCurrencyEvidence(stored({ currency: 'usd' }))?.currency).toBe('USD');
    });
});

describe('resolving a currency to price in', () => {
    it('establishes one when Meta reported it', () => {
        const resolution = resolveCurrency(stored(), NOW);
        expect(resolution.kind).toBe('established');
        expect(resolution.kind === 'established' && resolution.currency).toBe('USD');
    });

    it('says nothing is known when nothing was ever written', () => {
        const resolution = resolveCurrency({}, NOW);
        expect(resolution.kind === 'unknown' && resolution.reason).toBe('no_evidence');
        expect(resolution.kind === 'unknown' && resolution.detail).toContain('Reconnect the number');
    });

    it('separates "we have no card for it" from "we do not know it"', () => {
        // Two different human tasks. One is "reconnect"; the other is "we have
        // no published rate in your money yet", which reconnecting cannot fix.
        const resolution = resolveCurrency(stored({ currency: 'XOF' }), NOW);
        expect(resolution.kind === 'unknown' && resolution.reason).toBe('currency_not_priced');
        expect(resolution.kind === 'unknown' && resolution.detail).toContain('XOF');
    });

    it('uses stale evidence and says that it is stale', () => {
        // A slightly old currency beats no currency. What must not happen is
        // using it silently: Meta can change it, and nothing would say when.
        const old = resolveCurrency(stored({ observedAt: ago(CURRENCY_FRESH_FOR_MS + 86_400_000) }), NOW);
        expect(old.kind).toBe('established');
        expect(old.kind === 'established' && old.stale).toBe(true);
        expect(describeCurrency(old)).toContain('re-checking');
    });

    it('is not stale the moment it is written', () => {
        const fresh = resolveCurrency(stored(), NOW);
        expect(fresh.kind === 'established' && fresh.stale).toBe(false);
    });
});

describe('building evidence from what Meta returned', () => {
    it('records the source and the moment', () => {
        const evidence = currencyFromMeta('COP', 'waba-9', NOW)!;
        expect(evidence).toEqual({
            currency: 'COP', source: 'meta_waba', observedAt: NOW.toISOString(), wabaId: 'waba-9',
        });
    });

    it('returns nothing for anything that is not a currency code', () => {
        for (const value of ['', null, undefined, 'dollars', 'US', 'USDT', 123]) {
            expect({ value, evidence: currencyFromMeta(value, 'waba-1', NOW) })
                .toEqual({ value, evidence: null });
        }
    });
});

describe('what a person is told', () => {
    it('names where the currency came from', () => {
        expect(describeCurrency(resolveCurrency(stored(), NOW))).toContain('reported by Meta');
        expect(describeCurrency(resolveCurrency(stored({ source: 'operator' }), NOW)))
            .toContain('set by your team');
        expect(describeCurrency(resolveCurrency(stored({ source: 'same_waba' }), NOW)))
            .toContain('another number on the same');
    });
});
