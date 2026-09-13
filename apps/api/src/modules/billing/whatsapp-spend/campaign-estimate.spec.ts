import { estimateCampaign, describeCampaignEstimate } from './campaign-estimate';
import { WHATSAPP_RATE_CARDS } from '../whatsapp-rates/whatsapp-rate-table.generated';

/**
 * ═══ WHAT A CAMPAIGN COSTS, BEFORE ANYBODY PRESSES SEND ═══
 *
 * From 1 October 2026 a campaign to four thousand people is a purchase, and the
 * product asked an operator to confirm it with no figure attached. The first
 * time anybody saw the number was on Meta's invoice.
 *
 * The dangerous failure here is not an estimate that is wrong. It is an
 * estimate that is wrong in the FLATTERING direction — a destination the rate
 * card cannot place quietly dropped from the total, so the campaign looks
 * cheaper than it is and somebody says yes. Most of this suite is about that.
 *
 * ── THE ORACLE ──────────────────────────────────────────────────────────────
 *
 * The expected amounts are read straight out of the published rate card by
 * name, in the test, and multiplied by hand. They are NOT computed by calling
 * the same resolver the estimator calls: a test that computes both sides with
 * one function approves whatever that function does, which is how a wrong
 * recipe passes nineteen assertions.
 */

/**
 * The USD card in force on the date these cases price against, picked the way a
 * reader would: the latest one whose `effectiveFrom` has arrived. Cards are
 * open-ended — a later one supersedes an earlier one — so there is no end date
 * to check.
 */
const usdCard = WHATSAPP_RATE_CARDS
    .filter(card => card.currency === 'USD' && card.effectiveFrom <= '2026-10-15')
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
    .at(-1)!;

const microsFor = (market: string, category: string): number => {
    const entry = usdCard.entries.find(row => row.market === market);
    if (!entry) throw new Error(`the USD card has no market ${market}`);
    const micros = (entry.micros as Record<string, number | null>)[category];
    if (micros === null || micros === undefined) {
        throw new Error(`the USD card does not price ${category} for ${market}`);
    }
    return micros;
};

const OCTOBER = new Date('2026-10-15T12:00:00.000Z');
const base = {
    channelAccountId: '15550001111',
    currency: 'USD',
    wabaTimeZone: 'America/Bogota',
    at: OCTOBER,
};

const people = (...addresses: (string | null)[]) =>
    addresses.map((address, index) => ({ recipientRef: `r${index}`, address }));

describe('what a campaign costs before anybody presses send', () => {
    describe('the amount', () => {
        it('prices every recipient at their OWN market rate', () => {
            // Never the tenant's country. A Colombian business messaging a
            // German customer pays the German rate, and using the business's
            // country is how an estimate comes back several times too low for
            // exactly the traffic that is most expensive.
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: people('+573001112233', '+4915112345678'),
            });
            const expected = microsFor('Colombia', 'marketing') + microsFor('Germany', 'marketing');
            expect(estimate.priced).toBe(2);
            expect(estimate.totalMicros).toBe(expected);
            expect(estimate.byMarket.map(row => row.market).sort())
                .toEqual(['Colombia', 'Germany']);
        });

        it('adds up a hundred recipients in one market without drifting', () => {
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: people(...Array.from({ length: 100 }, () => '+573001112233')),
            });
            expect(estimate.totalMicros).toBe(microsFor('Colombia', 'marketing') * 100);
            expect(estimate.byMarket).toEqual([
                { market: 'Colombia', recipients: 100,
                    micros: microsFor('Colombia', 'marketing') * 100,
                    unitMicros: microsFor('Colombia', 'marketing') },
            ]);
        });

        it('prices the same recipients differently by category, as Meta does', () => {
            const of = (category: any) => estimateCampaign({
                ...base, category, recipients: people('+573001112233'),
            }).totalMicros;
            expect(of('marketing')).toBe(microsFor('Colombia', 'marketing'));
            expect(of('utility')).toBe(microsFor('Colombia', 'utility'));
            // And they are genuinely different numbers, or this test proves
            // nothing about the category being read at all.
            expect(of('marketing')).not.toBe(of('utility'));
        });

        it('rounds the total UP to the currency’s own minor unit', () => {
            // An estimate that rounds down is always slightly too cheap, in the
            // direction that makes somebody say yes.
            const estimate = estimateCampaign({
                ...base, category: 'marketing', recipients: people('+573001112233'),
            });
            const micros = microsFor('Colombia', 'marketing');
            expect(estimate.totalMinorUnits).toBe(Math.ceil(micros / 10_000));
            expect(estimate.totalMinorUnits! * 10_000).toBeGreaterThanOrEqual(estimate.totalMicros);
        });
    });

    describe('what it refuses to price, and does not hide', () => {
        it('counts a market the card does not know instead of dropping it', () => {
            // THE FAILURE THIS SUITE EXISTS FOR. Dropping an unpriceable
            // recipient makes the campaign look cheaper than it is.
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: people('+573001112233', '+6721234567'),
            });
            expect(estimate.recipients).toBe(2);
            expect(estimate.priced).toBe(1);
            expect(estimate.unpriced).toHaveLength(1);
            expect(estimate.totalMicros).toBe(microsFor('Colombia', 'marketing'));
        });

        it('refuses a prefix several countries share rather than picking one', () => {
            // `+1` is the North American plan and `+7` is Russia and
            // Kazakhstan, which Meta prices as different markets. Resolving to
            // whichever is cheapest would put a number on screen the invoice
            // contradicts.
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: people('+14155550123', '+77011234567'),
            });
            expect(estimate.priced).toBe(0);
            expect(estimate.unpricedByReason.market_ambiguous).toBe(2);
            expect(estimate.unpriced[0].detail).toContain('varios países');
        });

        it('says a recipient with no number has no price, not a price of zero', () => {
            const estimate = estimateCampaign({
                ...base, category: 'marketing', recipients: people(null, '   '),
            });
            expect(estimate.totalMicros).toBe(0);
            expect(estimate.unpricedByReason.no_destination).toBe(2);
        });

        it('prices nothing at all when the template has no approved category', () => {
            // Guessing a category here would show a number computed from an
            // assumption. The operator is told to sync their templates.
            const estimate = estimateCampaign({
                ...base, category: null, categoryDetail: 'promo_octubre',
                recipients: people('+573001112233', '+4915112345678'),
            });
            expect(estimate.priced).toBe(0);
            expect(estimate.totalMicros).toBe(0);
            expect(estimate.unpricedByReason.category_unknown).toBe(2);
            expect(estimate.unpriced[0].detail).toContain('promo_octubre');
        });

        it('refuses to price in a currency no card covers', () => {
            const estimate = estimateCampaign({
                ...base, currency: 'XYZ', category: 'marketing',
                recipients: people('+573001112233'),
            });
            expect(estimate.priced).toBe(0);
            expect(estimate.unpricedByReason.no_rate_card_for_currency).toBe(1);
        });

        it('refuses to price against a time zone the runtime does not know', () => {
            // The rate turns over at midnight in the ACCOUNT's zone, so a
            // typo'd zone must refuse rather than price against a wrong
            // midnight.
            const estimate = estimateCampaign({
                ...base, wabaTimeZone: 'Mars/Olympus', category: 'marketing',
                recipients: people('+573001112233'),
            });
            expect(estimate.priced).toBe(0);
            expect(estimate.unpricedByReason.unsupported_time_zone).toBe(1);
        });

        it('names every unpriced recipient, so a list can be shown', () => {
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: [
                    { recipientRef: 'ana', address: '+573001112233' },
                    { recipientRef: 'beto', address: null },
                    { recipientRef: 'caro', address: '+14155550123' },
                ],
            });
            expect(estimate.unpriced.map(row => row.recipientRef).sort())
                .toEqual(['beto', 'caro']);
        });
    });

    describe('the free allowance, which a campaign does not get', () => {
        it('never subtracts it, and says why', () => {
            // The thousand free deliveries per number per calendar month are
            // for SERVICE messages. Subtracting them from a campaign would
            // promise a discount Meta does not give, and would consume on paper
            // an allowance the tenant still needs for the replies the campaign
            // provokes.
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: people(...Array.from({ length: 50 }, () => '+573001112233')),
            });
            expect(estimate.freeAllowanceApplies).toBe(false);
            expect(estimate.totalMicros).toBe(microsFor('Colombia', 'marketing') * 50);
            expect(estimate.freeAllowanceNote).toContain('SERVICIO');
        });
    });

    describe('what it reports alongside the number', () => {
        it('names the account, the currency and the calendar month it priced in', () => {
            const estimate = estimateCampaign({
                ...base, category: 'marketing', recipients: people('+573001112233'),
            });
            expect(estimate.channelAccountId).toBe('15550001111');
            expect(estimate.currency).toBe('USD');
            // The WABA's own month, not UTC's: midday UTC on the 15th is still
            // the 15th in Bogotá, but the month boundary is what the allowance
            // and the card turn over on.
            expect(estimate.calendarMonth).toBe('2026-10');
        });

        it('orders markets by what they cost, not alphabetically', () => {
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: people('+573001112233', '+4915112345678', '+4915112345679'),
            });
            const amounts = estimate.byMarket.map(row => row.micros);
            expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
        });

        it('summarises itself in a sentence an operator can act on', () => {
            const estimate = estimateCampaign({
                ...base, category: 'marketing',
                recipients: people('+573001112233', null),
            });
            const line = describeCampaignEstimate(estimate);
            expect(line).toContain('1 de 2 destinatarios');
            expect(line).toContain('USD');
            expect(line).toContain('1 el destinatario no tiene un número');
        });

        it('says plainly when nothing could be priced', () => {
            const estimate = estimateCampaign({
                ...base, category: null, recipients: people('+573001112233'),
            });
            expect(describeCampaignEstimate(estimate)).toContain('0 de 1 destinatarios');
        });
    });

    it('prices an empty campaign as nothing, with nothing unexplained', () => {
        const estimate = estimateCampaign({ ...base, category: 'marketing', recipients: [] });
        expect(estimate).toMatchObject({
            recipients: 0, priced: 0, totalMicros: 0, totalMinorUnits: 0,
            byMarket: [], unpriced: [],
        });
    });
});
