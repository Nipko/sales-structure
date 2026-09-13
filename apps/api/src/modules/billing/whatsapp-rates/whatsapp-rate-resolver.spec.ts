import { mayProceed } from '@parallext/shared';

import { priceDeliveries, unitCeiling, microsPerMinorUnit } from './whatsapp-rate-money';
import {
    rateCardInForce,
    resolveWhatsAppRate,
    wabaCalendarMonth,
    wabaLocalDate,
    type WhatsAppRateQuery,
    type WhatsAppRateResolution,
} from './whatsapp-rate-resolver';
import { WHATSAPP_MESSAGE_CATEGORIES, WHATSAPP_RATE_CARDS } from './whatsapp-rate-table.generated';

const october = new Date('2026-10-15T12:00:00Z');

const query = (over: Partial<WhatsAppRateQuery> = {}): WhatsAppRateQuery => ({
    category: 'service',
    recipient: { kind: 'iso_alpha2', value: 'CO' },
    currency: 'USD',
    at: october,
    wabaTimeZone: 'America/Bogota',
    ...over,
});

const priced = (resolution: WhatsAppRateResolution) => {
    if (resolution.basis !== 'priced') {
        throw new Error(`expected a priced rate, got ${resolution.basis}: ${JSON.stringify(resolution)}`);
    }
    return resolution;
};

// ─────────────────────────────────────────────────────────────────────────────

describe('a market with no rate card', () => {
    /**
     * The single most important behaviour in this module. Everything else is
     * arithmetic; this is the difference between a budget and a decoration.
     */
    it('resolves to unknown, not to zero', () => {
        const resolution = resolveWhatsAppRate(query({ recipient: { kind: 'iso_alpha2', value: 'JP' } }));
        expect(resolution.basis).toBe('unknown');
        expect(resolution).not.toHaveProperty('rate');
        // No path through the object arrives at a number that could be spent.
        expect(JSON.stringify(resolution)).not.toMatch(/"microsPerMessage"/);
        if (resolution.basis === 'unknown') {
            expect(resolution.reason).toBe('market_not_in_rate_card');
            expect(resolution.detail).toContain('JP');
        }
    });

    it('does not quietly fall back to a cheaper regional bucket', () => {
        // "Rest of Asia Pacific" service is 0.0113 and "Other" is 0.0077. Both
        // exist in the table and both would have looked like a plausible answer
        // for Japan. Neither is reachable without naming it.
        const guessed = resolveWhatsAppRate(query({ recipient: { kind: 'iso_alpha2', value: 'JP' } }));
        expect(guessed.basis).toBe('unknown');

        const named = priced(resolveWhatsAppRate(
            query({ recipient: { kind: 'market_name', value: 'Rest of Asia Pacific' } }),
        ));
        expect(named.rate.microsPerMessage).toBe(11_300);
    });

    it('treats an unrecognised market name the same way', () => {
        const resolution = resolveWhatsAppRate(query({ recipient: { kind: 'market_name', value: 'Atlantis' } }));
        expect(resolution.basis).toBe('unknown');
        expect(resolution.basis === 'unknown' && resolution.reason).toBe('market_not_in_rate_card');
    });

    it('does not let an ISO code be read as a market name', () => {
        // "CO" resolves; the string "CO" as a market name must not.
        expect(resolveWhatsAppRate(query({ recipient: { kind: 'iso_alpha2', value: 'CO' } })).basis).toBe('priced');
        expect(resolveWhatsAppRate(query({ recipient: { kind: 'market_name', value: 'CO' } })).basis).toBe('unknown');
    });

    it('reports unknown, and never zero, for every category of an unlisted market', () => {
        for (const category of WHATSAPP_MESSAGE_CATEGORIES) {
            const resolution = resolveWhatsAppRate(
                query({ category, recipient: { kind: 'iso_alpha2', value: 'JP' } }),
            );
            expect(resolution.basis).toBe('unknown');
        }
    });
});

describe('effective dating', () => {
    it('turns at midnight in the WABA time zone, not at midnight UTC', () => {
        // Bogotá is UTC−5 all year. One second either side of its local
        // midnight, with the same recipient, the same currency, the same
        // category — and a different card answers.
        const before = resolveWhatsAppRate(query({ at: new Date('2026-10-01T04:59:59Z') }));
        const after = resolveWhatsAppRate(query({ at: new Date('2026-10-01T05:00:00Z') }));

        expect(before.basis).toBe('unknown');
        expect(before.appliedOnLocalDate).toBe('2026-09-30');
        expect(before.rateVersion).toBe('meta-ratecards-2026/USD/2026-07-01');

        expect(after.basis).toBe('priced');
        expect(after.appliedOnLocalDate).toBe('2026-10-01');
        expect(after.rateVersion).toBe('meta-ratecards-2026/USD/2026-10-01');
        expect(priced(after).effectiveFrom).toBe('2026-10-01');
    });

    it('is inclusive of the boundary: 00:00:00 belongs to the new card', () => {
        const atMidnight = resolveWhatsAppRate(query({ at: new Date('2026-10-01T00:00:00Z'), wabaTimeZone: 'UTC' }));
        expect(priced(atMidnight).effectiveFrom).toBe('2026-10-01');
        expect(atMidnight.appliedOnLocalDate).toBe('2026-10-01');

        const aMillisecondEarlier = resolveWhatsAppRate(
            query({ at: new Date('2026-09-30T23:59:59.999Z'), wabaTimeZone: 'UTC' }),
        );
        expect(aMillisecondEarlier.basis).toBe('unknown');
        expect(aMillisecondEarlier.appliedOnLocalDate).toBe('2026-09-30');
    });

    it('gives two accounts different answers for the same instant', () => {
        // Kiritimati is UTC+14 and Bogotá UTC−5: nineteen hours apart, so for
        // most of 30 September one account is already in October. A resolver
        // that defaulted the zone would be wrong for one of them in silence.
        const instant = new Date('2026-09-30T10:00:00Z');
        const kiritimati = resolveWhatsAppRate(query({ at: instant, wabaTimeZone: 'Pacific/Kiritimati' }));
        const bogota = resolveWhatsAppRate(query({ at: instant, wabaTimeZone: 'America/Bogota' }));

        expect(kiritimati.appliedOnLocalDate).toBe('2026-10-01');
        expect(kiritimati.basis).toBe('priced');
        expect(bogota.appliedOnLocalDate).toBe('2026-09-30');
        expect(bogota.basis).toBe('unknown');
    });

    it('says which version answered, on both outcomes', () => {
        const answered = priced(resolveWhatsAppRate(query()));
        expect(answered.rateVersion).toBe('meta-ratecards-2026/USD/2026-10-01');
        expect(answered.tableVersion).toMatch(/^meta-ratecards-2026@[0-9a-f]{16}$/);
        expect(answered.source.file).toBe('meta-usd-rates-2026-10-01.xlsx');
        expect(answered.source.locator).toBe('row 9');
        expect(answered.source.sha256).toHaveLength(64);

        const refused = resolveWhatsAppRate(query({ at: new Date('2026-09-15T12:00:00Z') }));
        expect(refused.basis).toBe('unknown');
        expect(refused.rateVersion).toBe('meta-ratecards-2026/USD/2026-07-01');
    });

    it('refuses a date before any published card rather than reaching forward', () => {
        const resolution = resolveWhatsAppRate(query({ at: new Date('2026-01-15T12:00:00Z') }));
        expect(resolution.basis).toBe('unknown');
        expect(resolution.basis === 'unknown' && resolution.reason).toBe('no_rate_card_effective_yet');
        expect(rateCardInForce('USD', '2026-01-15')).toBeNull();
    });

    it('refuses an unusable time zone instead of falling back to UTC', () => {
        // UTC would have priced this one; the refusal is the point.
        const resolution = resolveWhatsAppRate(query({ wabaTimeZone: 'Definitely/Not_A_Zone' }));
        expect(resolution.basis).toBe('unknown');
        expect(resolution.basis === 'unknown' && resolution.reason).toBe('unsupported_time_zone');
        expect(wabaLocalDate(october, 'Definitely/Not_A_Zone')).toBeNull();
    });

    it('refuses an invalid instant', () => {
        const resolution = resolveWhatsAppRate(query({ at: new Date('not a date') }));
        expect(resolution.basis).toBe('unknown');
        expect(resolution.basis === 'unknown' && resolution.reason).toBe('invalid_instant');
    });
});

describe('currency', () => {
    it('is part of the rate, never a bare number', () => {
        const usd = priced(resolveWhatsAppRate(query({ currency: 'USD' })));
        const cop = priced(resolveWhatsAppRate(query({ currency: 'COP' })));

        expect(usd.rate).toEqual({ currency: 'USD', microsPerMessage: 800 });
        expect(cop.rate).toEqual({ currency: 'COP', microsPerMessage: 2_945_500 });
        // Same market, same category, same instant; two numbers three orders of
        // magnitude apart. A rate without its currency is meaningless.
        expect(cop.rate.microsPerMessage / usd.rate.microsPerMessage).toBeGreaterThan(3_000);
    });

    it('refuses a currency no card is published in', () => {
        const resolution = resolveWhatsAppRate(query({ currency: 'EUR' }));
        expect(resolution.basis).toBe('unknown');
        expect(resolution.basis === 'unknown' && resolution.reason).toBe('no_rate_card_for_currency');
        expect(microsPerMinorUnit('EUR')).toBeNull();
    });

    it('prices in whatever currency the ACCOUNT is billed in, not the market', () => {
        // A Colombian account answering a German customer pays the German rate
        // in Colombian pesos: the market is the recipient's, the currency the
        // account's, and the two are independent axes.
        const german = priced(resolveWhatsAppRate(
            query({ currency: 'COP', recipient: { kind: 'iso_alpha2', value: 'DE' } }),
        ));
        expect(german.market).toBe('Germany');
        expect(german.rate.currency).toBe('COP');
        expect(german.rate.microsPerMessage).toBe(202_499_700);
    });
});

describe('sub-cent precision', () => {
    it('carries a rate that would round to zero cents', () => {
        const colombia = priced(resolveWhatsAppRate(query()));
        expect(colombia.rate.microsPerMessage).toBe(800); // US$0.0008
        // In cents this is 0.08. Rounded down it is zero, and every Colombian
        // service message becomes free forever.
        expect(Math.round(800 / 10_000)).toBe(0);
        expect(colombia.rate.microsPerMessage).toBeGreaterThan(0);
    });

    it('rounds up, once per batch, so a batch is not inflated per message', () => {
        const rate = priced(resolveWhatsAppRate(query())).rate;

        const one = priceDeliveries(rate, 1);
        expect(one).toMatchObject({ kind: 'priced', exactMicros: 800, roundingSurplusMicros: 9_200 });
        expect(one.kind === 'priced' && one.money).toEqual({ currency: 'USD', minor: 1 });

        // The thousand that matters: exactly 80 cents, no rounding at all.
        // Ceiling per message would have reserved 1,000 cents for the same work.
        const thousand = priceDeliveries(rate, 1_000);
        expect(thousand).toMatchObject({ kind: 'priced', exactMicros: 800_000, roundingSurplusMicros: 0 });
        expect(thousand.kind === 'priced' && thousand.money).toEqual({ currency: 'USD', minor: 80 });
    });

    it('never reserves less than the true cost', () => {
        const divisor = microsPerMinorUnit('USD')!;
        for (const card of WHATSAPP_RATE_CARDS) {
            const perMinor = microsPerMinorUnit(card.currency)!;
            for (const entry of card.entries) {
                for (const category of WHATSAPP_MESSAGE_CATEGORIES) {
                    const micros = entry.micros[category];
                    if (micros === 'unavailable') continue;
                    const rate = { currency: card.currency, microsPerMessage: micros };
                    const batch = priceDeliveries(rate, 7);
                    expect(batch.kind).toBe('priced');
                    if (batch.kind !== 'priced') continue;
                    expect(batch.money.minor * perMinor).toBeGreaterThanOrEqual(batch.exactMicros);
                    // And never zero: a reservation of zero is a free message.
                    expect(batch.money.minor).toBeGreaterThan(0);
                    expect(unitCeiling(rate)!.minor).toBeGreaterThan(0);
                }
            }
        }
        expect(divisor).toBe(10_000);
    });

    it('refuses to price in a currency it has no minor unit for', () => {
        const refusal = priceDeliveries({ currency: 'JPY', microsPerMessage: 1_000 }, 5);
        expect(refusal).toEqual({ kind: 'uncountable', reason: 'unsupported_currency', detail: 'JPY' });
    });

    it('refuses a nonsensical delivery count instead of pricing it as nothing', () => {
        const rate = priced(resolveWhatsAppRate(query())).rate;
        expect(priceDeliveries(rate, -1).kind).toBe('uncountable');
        expect(priceDeliveries(rate, 1.5).kind).toBe('uncountable');
        expect(priceDeliveries(rate, Number.NaN).kind).toBe('uncountable');
        // Zero is a legitimate count and prices at nothing, which is not the
        // same as a rate of nothing.
        expect(priceDeliveries(rate, 0)).toMatchObject({ kind: 'priced', exactMicros: 0 });
    });
});

describe('the same twenty replies in three markets', () => {
    /** The directive's own acceptance case: Colombia, Peru, Germany. */
    it('reserves by the recipient market, in the account currency', () => {
        const twenty = (iso: string) => {
            const rate = priced(resolveWhatsAppRate(query({ recipient: { kind: 'iso_alpha2', value: iso } }))).rate;
            const batch = priceDeliveries(rate, 20);
            if (batch.kind !== 'priced') throw new Error('expected a price');
            return batch;
        };

        expect(twenty('CO').money).toEqual({ currency: 'USD', minor: 2 });      // 0.016 → 2c
        expect(twenty('PE').money).toEqual({ currency: 'USD', minor: 60 });     // 0.60
        expect(twenty('DE').money).toEqual({ currency: 'USD', minor: 110 });    // 1.10

        // Same twenty replies, fifty-five times the money. This is the number
        // the guardrail exists for.
        expect(twenty('DE').exactMicros / twenty('CO').exactMicros).toBe(68.75);
    });
});

describe('the shared spend contract', () => {
    it('does not let an unknown cost proceed by default', () => {
        const resolution = resolveWhatsAppRate(query({ recipient: { kind: 'iso_alpha2', value: 'JP' } }));
        expect(resolution.basis).toBe('unknown');
        expect(mayProceed({ decision: 'unknown' }, { allowUnknownCost: false })).toBe(false);
        expect(mayProceed({ decision: 'unknown' }, { allowUnknownCost: true })).toBe(true);
    });
});

describe('calendar helpers', () => {
    it('report the month the allowance resets with, in the WABA zone', () => {
        expect(wabaCalendarMonth(new Date('2026-11-01T04:59:59Z'), 'America/Bogota')).toBe('2026-10');
        expect(wabaCalendarMonth(new Date('2026-11-01T05:00:00Z'), 'America/Bogota')).toBe('2026-11');
        expect(wabaCalendarMonth(new Date('2026-11-01T04:59:59Z'), 'UTC')).toBe('2026-11');
        expect(wabaCalendarMonth(october, 'Definitely/Not_A_Zone')).toBeNull();
    });
});
