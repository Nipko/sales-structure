import { inLockOrder, scopeId, scopesFor, SPEND_LOCK_ORDER } from './spend-scopes';
import { describeBlock, spendBlock, SPEND_BLOCK_CODES } from './spend-diagnosis';

/**
 * ═══ WHICH CEILINGS, AND IN WHAT ORDER ═══
 *
 * The order is not cosmetic. Two producers reserving at the same time each lock
 * several counter rows; if one takes `account` then `contact` while the other
 * takes them the other way round, PostgreSQL resolves it by killing one of them
 * with a deadlock — under load, at the busiest moment. One total order removes
 * the possibility instead of retrying after the fact.
 */
describe('the ceilings one effect is measured against', () => {
    const subject = {
        channelAccountId: '15550001111',
        payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
        contactId: 'contact-1', taskId: 'campaign-1',
        allowanceMonth: '2026-10', spendPeriod: '2026-10',
    };

    it('measures a full effect against all five', () => {
        expect(scopesFor(subject).map(scope => scope.kind))
            .toEqual(['number_month', 'account', 'business', 'contact', 'task']);
    });

    it('puts the allowance first, because the money rows depend on the split', () => {
        // How many of the batch are free decides how many are priced. Sizing the
        // money reservation before that is known reserves for deliveries that
        // turned out to cost nothing.
        expect(SPEND_LOCK_ORDER[0]).toBe('number_month');
        expect(scopesFor(subject)[0].kind).toBe('number_month');
    });

    it('omits a scope whose identity is unknown rather than keying on empty', () => {
        // `scope_key = ''` would put every effect with no contact into ONE
        // shared counter, and the first such conversation would exhaust a
        // ceiling that belongs to nobody.
        const kinds = scopesFor({ ...subject, contactId: null, taskId: '  ' })
            .map(scope => scope.kind);
        expect(kinds).not.toContain('contact');
        expect(kinds).not.toContain('task');
    });

    it('falls back to the WABA when the business portfolio is unknown', () => {
        // Better a ceiling on the account that pays than no business ceiling at
        // all; the two are the same payer when Meta only told us one of them.
        const [business] = scopesFor({ ...subject, payerBusinessId: null })
            .filter(scope => scope.kind === 'business');
        expect(business.key).toBe('waba-1');
    });

    it('counts the allowance by calendar month even when money is capped elsewhere', () => {
        // One is Meta's rule and the other is ours. A quarterly spending period
        // must not turn the free thousand into a free three thousand.
        const scopes = scopesFor({ ...subject, spendPeriod: '2026-Q4' });
        expect(scopes.find(scope => scope.kind === 'number_month')!.period).toBe('2026-10');
        expect(scopes.find(scope => scope.kind === 'account')!.period).toBe('2026-Q4');
    });

    it('sorts a list assembled elsewhere into the canonical order', () => {
        const shuffled = [...scopesFor(subject)].reverse();
        expect(inLockOrder(shuffled).map(scope => scope.kind))
            .toEqual(['number_month', 'account', 'business', 'contact', 'task']);
    });

    it('is total, so two scopes of the same kind still order deterministically', () => {
        // Otherwise two producers each holding two contact rows can still
        // deadlock on each other.
        const left = { kind: 'contact' as const, key: 'a', period: '2026-10' };
        const right = { kind: 'contact' as const, key: 'b', period: '2026-10' };
        expect(inLockOrder([right, left]).map(scopeId))
            .toEqual(inLockOrder([left, right]).map(scopeId));
    });
});

describe('why an effect was not authorised', () => {
    it('gives every code a scope and a next action', () => {
        // A limit that cannot say what to do about it teaches people to raise
        // every limit to infinity.
        for (const code of SPEND_BLOCK_CODES) {
            const block = spendBlock(code, 'detail');
            expect(block.resolution.length).toBeGreaterThan(20);
            expect(['account', 'task', 'contact', 'tenant']).toContain(block.scope);
        }
    });

    it('stops the narrowest thing it can', () => {
        // A campaign that ran out of budget must not pause the number, and a
        // number without funding must not pause the tenant.
        expect(spendBlock('task_budget_exhausted', 'x').scope).toBe('task');
        expect(spendBlock('funding_not_ready', 'x').scope).toBe('account');
    });

    it('says what was blocked, what it would have cost, and how to fix it', () => {
        const line = describeBlock(spendBlock('cap_exhausted', 'account/15550001111/2026-10',
            { avoidedMinor: 1234, currency: 'USD' }));
        expect(line).toContain('cap_exhausted');
        expect(line).toContain('12.34 USD');
        expect(line).toContain('Raise the spending limit');
    });

    it('explains that Meta charges the business, not Parallly', () => {
        // The single most confusing thing about this whole feature, so the
        // funding message has to carry it.
        expect(spendBlock('funding_not_ready', 'x').resolution)
            .toContain('Parallly subscription is a separate payment');
    });
});
