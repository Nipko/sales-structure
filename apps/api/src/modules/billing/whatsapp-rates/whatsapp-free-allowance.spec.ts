import type { PricingBasis } from '@parallext/shared';

import {
    applyFreeServiceAllowance,
    classifyReply,
    freeAllowanceKey,
    isFreeToSend,
    pricingBasisFor,
    type DeliveryPermission,
    type FreeAllowanceQuery,
} from './whatsapp-free-allowance';
import { resolveWhatsAppRate, type WhatsAppRateResolution } from './whatsapp-rate-resolver';

const october = new Date('2026-10-15T12:00:00Z');
const NUMBER = '15550001111';

const ask = (over: Partial<FreeAllowanceQuery> = {}): FreeAllowanceQuery => ({
    category: 'service',
    businessPhoneNumberId: NUMBER,
    deliveriesAlreadyUsedThisMonth: 0,
    deliveries: 1,
    at: october,
    wabaTimeZone: 'America/Bogota',
    ...over,
});

/** "Send the Nth service message of the month" — the ordinal, spelled out. */
const nth = (ordinal: number, over: Partial<FreeAllowanceQuery> = {}) =>
    applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: ordinal - 1, deliveries: 1, ...over }));

const rateFor = (iso: string, at: Date = october): WhatsAppRateResolution =>
    resolveWhatsAppRate({
        category: 'service',
        recipient: { kind: 'iso_alpha2', value: iso },
        currency: 'USD',
        at,
        wabaTimeZone: 'America/Bogota',
    });

// ─────────────────────────────────────────────────────────────────────────────

describe('the 999th, 1000th and 1001st service message of the month', () => {
    it('the 999th is free', () => {
        const split = nth(999);
        expect(split).toMatchObject({ free: 1, chargeable: 0, certainty: 'counted', reason: 'covered_by_allowance' });
        expect(split.remainingAfter).toBe(1);
    });

    it('the 1000th is free, and it is the last one', () => {
        const split = nth(1_000);
        expect(split).toMatchObject({ free: 1, chargeable: 0, certainty: 'counted', reason: 'covered_by_allowance' });
        expect(split.remainingAfter).toBe(0);
    });

    it('the 1001st is charged', () => {
        const split = nth(1_001);
        expect(split).toMatchObject({ free: 0, chargeable: 1, certainty: 'counted', reason: 'allowance_exhausted' });
        expect(split.remainingAfter).toBe(0);
    });

    it('a batch that straddles the boundary is split, not rounded either way', () => {
        // Two deliveries with 999 already used: one free, one charged. Neither
        // "all free" (which would spend a message nobody paid for) nor "all
        // charged" (which would refuse a send that was actually free).
        const split = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: 999, deliveries: 2 }));
        expect(split).toMatchObject({ free: 1, chargeable: 1, reason: 'allowance_partially_covers' });
        expect(split.remainingAfter).toBe(0);
    });

    it('an over-consumed counter does not produce a negative allowance', () => {
        const split = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: 1_400, deliveries: 3 }));
        expect(split).toMatchObject({ free: 0, chargeable: 3, remainingAfter: 0 });
    });
});

describe('the allowance belongs to the number, not to the country', () => {
    it('has no market anywhere in its key', () => {
        const key = freeAllowanceKey(NUMBER, '2026-10');
        expect(key).toContain(NUMBER);
        expect(key).toContain('2026-10');
        for (const market of ['CO', 'Colombia', 'DE', 'Germany', 'Peru']) {
            expect(key).not.toContain(market);
        }
    });

    it('does not hand a second thousand to a second market', () => {
        // The failure this prevents: a number answering nine markets ending up
        // with nine thousand free deliveries because the counter was keyed by
        // country. Same number, same month, two very different recipients —
        // one counter, and after 999 there is exactly one free delivery left in
        // total, not one per market.
        const colombian = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: 999 }));
        const german = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: 999 }));
        expect(colombian.allowanceKey).toBe(german.allowanceKey);
        expect(colombian.remainingAfter).toBe(0);

        // The recipient market is not even an input, so it cannot be forgotten.
        expect(Object.keys(ask())).not.toContain('recipient');
        expect(Object.keys(ask())).not.toContain('market');
    });

    it('gives a second number its own thousand', () => {
        const first = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: 1_000 }));
        const second = applyFreeServiceAllowance(ask({
            businessPhoneNumberId: '15550002222', deliveriesAlreadyUsedThisMonth: 0,
        }));
        expect(first.allowanceKey).not.toBe(second.allowanceKey);
        expect(first.chargeable).toBe(1);
        expect(second.free).toBe(1);
    });
});

describe('the calendar month it resets with', () => {
    it('is the WABA-local month, so the reset does not happen at UTC midnight', () => {
        const lastMoment = applyFreeServiceAllowance(ask({ at: new Date('2026-11-01T04:59:59Z') }));
        const firstMoment = applyFreeServiceAllowance(ask({ at: new Date('2026-11-01T05:00:00Z') }));
        expect(lastMoment.allowanceMonth).toBe('2026-10');
        expect(firstMoment.allowanceMonth).toBe('2026-11');
        expect(lastMoment.allowanceKey).not.toBe(firstMoment.allowanceKey);
    });

    it('does not carry unused deliveries forward, because the key changes', () => {
        // No rollover is not a rule that has to be enforced: a new month is a
        // new counter, and last month's unspent allowance has nowhere to go.
        const octoberSplit = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: 10 }));
        const novemberSplit = applyFreeServiceAllowance(ask({
            at: new Date('2026-11-15T12:00:00Z'), deliveriesAlreadyUsedThisMonth: 10,
        }));
        expect(octoberSplit.remainingAfter).toBe(989);
        expect(novemberSplit.remainingAfter).toBe(989);
        expect(octoberSplit.allowanceKey).not.toBe(novemberSplit.allowanceKey);
    });

    it('refuses to count against a month it cannot determine', () => {
        const split = applyFreeServiceAllowance(ask({ wabaTimeZone: 'Definitely/Not_A_Zone' }));
        expect(split).toMatchObject({ free: 0, chargeable: 1, certainty: 'unknown', reason: 'unsupported_time_zone' });
        expect(split.allowanceKey).toBeNull();
    });
});

describe('what the allowance does not cover', () => {
    it('claims nothing free when the month usage could not be read', () => {
        // The evidence says the exact webhook signal for consuming the free
        // thousand is not documented and must not be invented. A reading we do
        // not have is not a reading of zero.
        const split = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: null }));
        expect(split).toMatchObject({ free: 0, chargeable: 1, certainty: 'unknown', reason: 'usage_unknown' });
        expect(split.remainingAfter).toBeNull();
    });

    it('covers only service — not marketing, utility or authentication', () => {
        for (const category of ['marketing', 'utility', 'authentication', 'authentication_international'] as const) {
            const split = applyFreeServiceAllowance(ask({ category }));
            expect(split).toMatchObject({ free: 0, chargeable: 1, reason: 'category_not_eligible' });
        }
    });

    it('does not exist before the October regime', () => {
        const split = applyFreeServiceAllowance(ask({ at: new Date('2026-09-15T12:00:00Z') }));
        expect(split).toMatchObject({ free: 0, chargeable: 1, reason: 'allowance_not_yet_in_effect' });
        // And the September rate is unknown, so the combined answer is a
        // refusal rather than a silent free message.
        expect(pricingBasisFor(rateFor('CO', new Date('2026-09-15T12:00:00Z')), split)).toBe('unknown');
    });
});

describe('the pricing basis for a batch', () => {
    it('is free_allowance only when nothing is chargeable and the count was real', () => {
        expect(pricingBasisFor(rateFor('CO'), nth(1_000))).toBe('free_allowance');
        expect(pricingBasisFor(rateFor('CO'), nth(1_001))).toBe('priced');
    });

    it('prices a delivery whose free status is unknown, rather than hoping', () => {
        // Usage we could not read, in a market we CAN price: the honest answer
        // is to reserve the full rate and reconcile afterwards. Money held that
        // turns out not to be owed is released; money spent that nobody held is
        // not recoverable.
        const unread = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: null }));
        expect(unread.certainty).toBe('unknown');
        expect(pricingBasisFor(rateFor('CO'), unread)).toBe('priced');
    });

    it('stays unknown when anything chargeable has no rate', () => {
        expect(pricingBasisFor(rateFor('JP'), nth(1_001))).toBe('unknown');
        // Partially covered still owes money for the remainder, so it is priced
        // by whatever answers for that remainder — here, nothing does.
        const straddling = applyFreeServiceAllowance(ask({ deliveriesAlreadyUsedThisMonth: 999, deliveries: 2 }));
        expect(pricingBasisFor(rateFor('JP'), straddling)).toBe('unknown');
    });

    it('is free_allowance even in a market with no rate card, when nothing is owed', () => {
        // Safe in the one direction that matters: it claims no spend rather
        // than under-claiming one. The allowance covers the delivery whether or
        // not we could have priced it.
        expect(pricingBasisFor(rateFor('JP'), nth(1_000))).toBe('free_allowance');
    });
});

describe('being allowed to reply is not the same as replying for free', () => {
    /**
     * The stated failure mode. Permission comes from the 24-hour window, opt-out
     * and consent; price comes from a rate card and an allowance. Neither
     * answers the other, and every result below names both halves so that
     * reading one off the other is impossible.
     */
    const cases: [DeliveryPermission, PricingBasis, string][] = [
        ['permitted', 'priced', 'permitted_and_chargeable'],
        ['permitted', 'free_allowance', 'permitted_and_free'],
        ['permitted', 'free_entry_point', 'permitted_and_free'],
        ['permitted', 'unknown', 'permitted_cost_unknown'],
        ['not_permitted', 'priced', 'not_permitted'],
        ['not_permitted', 'free_allowance', 'not_permitted'],
        ['unknown', 'free_allowance', 'permission_unknown'],
        ['unknown', 'priced', 'permission_unknown'],
    ];

    it.each(cases)('%s + %s → %s', (permission, basis, expected) => {
        expect(classifyReply(permission, basis)).toBe(expected);
    });

    it('never reports a reply we may not send as free', () => {
        // Even with 999 of a thousand still unused: an open allowance is not
        // permission, and "free" would invite somebody to send it anyway.
        const covered = nth(1);
        expect(pricingBasisFor(rateFor('CO'), covered)).toBe('free_allowance');
        expect(classifyReply('not_permitted', 'free_allowance')).toBe('not_permitted');
    });

    it('never reports a reply we may send as free just because we may send it', () => {
        // The expensive direction: an open 24-hour window and a German
        // recipient. Permitted, and 5.5 US cents a message.
        const german = rateFor('DE');
        const basis = pricingBasisFor(german, nth(1_001));
        expect(basis).toBe('priced');
        expect(isFreeToSend(basis)).toBe(false);
        expect(classifyReply('permitted', basis)).toBe('permitted_and_chargeable');
    });

    it('reads permission first, so an unknown price cannot unblock a refusal', () => {
        expect(classifyReply('not_permitted', 'unknown')).toBe('not_permitted');
        expect(isFreeToSend('unknown')).toBe(false);
        expect(isFreeToSend('priced')).toBe(false);
    });
});
