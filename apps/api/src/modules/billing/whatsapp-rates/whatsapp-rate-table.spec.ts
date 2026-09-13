import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    CURRENCY_MINOR_EXPONENT,
    MICROS_PER_UNIT,
    WHATSAPP_FREE_SERVICE_ALLOWANCE,
    WHATSAPP_MARKET_BY_ISO_ALPHA2,
    WHATSAPP_MESSAGE_CATEGORIES,
    WHATSAPP_RATE_CARDS,
    WHATSAPP_RATE_TABLE_VERSION,
} from './whatsapp-rate-table.generated';

/**
 * The derived table, checked against the sources it claims to come from.
 *
 * These tests deliberately do NOT reuse the generator's parsing. A test that
 * computes both sides of a comparison with the same function approves whatever
 * that function does, including being wrong: this suite re-reads the preserved
 * JSON, converts with plain decimal arithmetic instead of the generator's BigInt
 * digit-shifting, and compares the two independent answers.
 */
const root = path.resolve(__dirname, '../../../../../..');
const researchDir = path.join(root, 'docs/research/2026-09-10');

type SourceRate = Record<string, string> & { market: string; currency: string };
interface SourceCard {
    kind: string;
    currency: string;
    effective_from: string;
    source_file: string;
    sha256: string;
    rates: SourceRate[] | null;
    rows: { row: number; cells: Record<string, string> }[];
}

const manifest: { note: string; cards: SourceCard[] } = JSON.parse(
    fs.readFileSync(path.join(researchDir, 'meta-ratecards-2026.json'), 'utf8'),
);
const sourceRateCards = manifest.cards.filter(card => card.kind === 'rates');

describe('the preserved sources', () => {
    it('the manifest states in as many words that n/a is not zero', () => {
        // The single most consequential sentence in the whole package: it is why
        // an unavailable rate is `'unavailable'` and not `0`.
        expect(manifest.note).toContain('n/a is unavailable, not zero');
    });

    it.each(sourceRateCards.map(card => [card.source_file, card.sha256] as const))(
        '%s still hashes to the SHA-256 the manifest recorded',
        (file, sha256) => {
            const bytes = fs.readFileSync(path.join(researchDir, file));
            expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
        },
    );
});

describe('the derived rate table', () => {
    it('carries one card per preserved rate card, and no others', () => {
        expect(WHATSAPP_RATE_CARDS).toHaveLength(sourceRateCards.length);
        expect(WHATSAPP_RATE_CARDS.map(c => `${c.currency}/${c.effectiveFrom}`).sort()).toEqual(
            sourceRateCards.map(c => `${c.currency}/${c.effective_from}`).sort(),
        );
        expect(WHATSAPP_RATE_TABLE_VERSION).toMatch(/^meta-ratecards-2026@[0-9a-f]{16}$/);
    });

    it('is currencies and effective dates the sources actually publish', () => {
        expect([...new Set(WHATSAPP_RATE_CARDS.map(c => c.currency))].sort()).toEqual(['COP', 'USD']);
        expect([...new Set(WHATSAPP_RATE_CARDS.map(c => c.effectiveFrom))].sort())
            .toEqual(['2026-07-01', '2026-10-01']);
    });

    it('reproduces every published price, converted independently of the generator', () => {
        let compared = 0;
        for (const source of sourceRateCards) {
            const derived = WHATSAPP_RATE_CARDS.find(
                c => c.currency === source.currency && c.effectiveFrom === source.effective_from,
            );
            expect(derived).toBeDefined();
            expect(derived!.entries).toHaveLength(source.rates!.length);

            for (const rate of source.rates!) {
                const entry = derived!.entries.find(e => e.market === rate.market);
                expect(entry).toBeDefined();
                for (const category of WHATSAPP_MESSAGE_CATEGORIES) {
                    const printed = rate[category];
                    const held = entry!.micros[category];
                    if (printed === 'n/a') {
                        expect(held).toBe('unavailable');
                        continue;
                    }
                    // Independent conversion: read the decimal as a number and
                    // scale it, rather than re-running the generator's exact
                    // integer path. Two roads to the same figure.
                    const expected = Math.round(Number(printed) * MICROS_PER_UNIT);
                    expect(held).toBe(expected);
                    compared += 1;
                }
            }
        }
        expect(compared).toBe(658); // 850 published cells minus 192 printed as n/a
    });

    it('never holds a rate of zero, because a zero rate is a message that spends invisibly', () => {
        for (const card of WHATSAPP_RATE_CARDS) {
            for (const entry of card.entries) {
                for (const category of WHATSAPP_MESSAGE_CATEGORIES) {
                    const value = entry.micros[category];
                    if (value === 'unavailable') continue;
                    expect(value).toBeGreaterThan(0);
                }
            }
        }
    });

    it('records n/a as a string that cannot be coerced to a number by accident', () => {
        const unavailable = WHATSAPP_RATE_CARDS.flatMap(card =>
            card.entries.flatMap(entry =>
                WHATSAPP_MESSAGE_CATEGORIES.filter(c => entry.micros[c] === 'unavailable'),
            ),
        );
        expect(unavailable).toHaveLength(192);
        // `?? 0` and `|| 0` are the two habits that would turn an unavailable
        // rate into a free message. Neither produces a number here.
        const sample = WHATSAPP_RATE_CARDS[0].entries[0].micros.service;
        expect(sample).toBe('unavailable');
        expect(sample ?? 0).toBe('unavailable');
        expect(Number(sample)).toBeNaN();
    });

    it('points every price at the file, and the line or row, it was read from', () => {
        for (const card of WHATSAPP_RATE_CARDS) {
            expect(fs.existsSync(path.join(researchDir, card.sourceFile))).toBe(true);
            expect(card.headerLocator).toMatch(/^(line|row) \d+$/);
            for (const entry of card.entries) {
                expect(entry.locator).toMatch(/^(line|row) \d+$/);
            }
        }
    });

    it('locates Colombia where the October card really prints it', () => {
        // Spot-check with the figure spelled out by hand, from the source:
        // meta-usd-rates-2026-10-01.xlsx row 9, column G, reads "8.0E-4".
        const october = WHATSAPP_RATE_CARDS.find(c => c.currency === 'USD' && c.effectiveFrom === '2026-10-01')!;
        const colombia = october.entries.find(e => e.market === 'Colombia')!;
        expect(colombia.locator).toBe('row 9');
        expect(colombia.micros.service).toBe(800);
        expect(800 / MICROS_PER_UNIT).toBeCloseTo(0.0008, 10);

        const sourceCard = sourceRateCards.find(
            c => c.currency === 'USD' && c.effective_from === '2026-10-01',
        )!;
        const row = sourceCard.rows.find(r => r.row === 9)!;
        expect(row.cells.A).toBe('Colombia');
        expect(row.cells.G).toBe('8.0E-4');
    });

    it('says the July cards published no service rate at all', () => {
        // The reason a September service message resolves to unknown rather
        // than to free: the card prints nothing, and nothing is not zero.
        for (const card of WHATSAPP_RATE_CARDS.filter(c => c.effectiveFrom === '2026-07-01')) {
            for (const entry of card.entries) {
                expect(entry.micros.service).toBe('unavailable');
            }
        }
    });

    it('gained nine markets in October and lost none', () => {
        const july = WHATSAPP_RATE_CARDS.find(c => c.currency === 'USD' && c.effectiveFrom === '2026-07-01')!;
        const october = WHATSAPP_RATE_CARDS.find(c => c.currency === 'USD' && c.effectiveFrom === '2026-10-01')!;
        const julyMarkets = new Set(july.entries.map(e => e.market));
        const octoberMarkets = new Set(october.entries.map(e => e.market));
        expect(july.entries).toHaveLength(38);
        expect(october.entries).toHaveLength(47);
        expect([...julyMarkets].filter(m => !octoberMarkets.has(m))).toEqual([]);
        expect([...octoberMarkets].filter(m => !julyMarkets.has(m)).sort()).toEqual([
            'Bangladesh', 'Iraq', 'Kazakhstan', 'Kuwait', 'Morocco',
            'Nepal', 'Oman', 'Sri Lanka', 'Ukraine',
        ]);
    });
});

describe('the ISO aliases', () => {
    it('name only markets a preserved card actually contains', () => {
        const known = new Set(WHATSAPP_RATE_CARDS.flatMap(c => c.entries.map(e => e.market)));
        for (const [iso, market] of Object.entries(WHATSAPP_MARKET_BY_ISO_ALPHA2)) {
            expect(iso).toMatch(/^[A-Z]{2}$/);
            expect(known.has(market)).toBe(true);
        }
    });

    it('never route a country into a regional bucket', () => {
        // Meta assigns unlisted countries to "Rest of …" and "Other" by calling
        // code, on a page these sources link to but do not contain. An alias
        // into a bucket would be a guess towards a cheaper price.
        const aliased = Object.values(WHATSAPP_MARKET_BY_ISO_ALPHA2);
        expect(aliased.filter(m => /^Rest of |^Other$|^North America$/.test(m))).toEqual([]);
    });

    it('leave the buckets present in the table but unreachable by country code', () => {
        const october = WHATSAPP_RATE_CARDS.find(c => c.currency === 'USD' && c.effectiveFrom === '2026-10-01')!;
        const buckets = october.entries.map(e => e.market).filter(m => /^Rest of |^Other$|^North America$/.test(m));
        expect(buckets).toHaveLength(8);
        expect(Object.keys(WHATSAPP_MARKET_BY_ISO_ALPHA2)).toHaveLength(39);
        expect(buckets.length + Object.keys(WHATSAPP_MARKET_BY_ISO_ALPHA2).length).toBe(october.entries.length);
    });
});

describe('the currency minor-unit table', () => {
    it('covers every currency a card is published in, and nothing it is not', () => {
        const published = new Set(WHATSAPP_RATE_CARDS.map(c => c.currency));
        for (const currency of published) expect(CURRENCY_MINOR_EXPONENT[currency]).toBeDefined();
        expect(Object.keys(CURRENCY_MINOR_EXPONENT).sort()).toEqual([...published].sort());
        // Absent is absent. Nobody gets a default of two decimal places.
        expect(CURRENCY_MINOR_EXPONENT.EUR).toBeUndefined();
        expect(CURRENCY_MINOR_EXPONENT.JPY).toBeUndefined();
    });
});

describe('the free service allowance', () => {
    it('is a thousand deliveries per number per calendar month, without rollover', () => {
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.deliveries).toBe(1000);
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.scope).toBe('per_phone_number_per_calendar_month');
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.rollsOver).toBe(false);
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.category).toBe('service');
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.effectiveFrom).toBe('2026-10-01');
    });

    it('cites lines of the evidence that really say so', () => {
        const lines = fs
            .readFileSync(path.join(researchDir, WHATSAPP_FREE_SERVICE_ALLOWANCE.sourceFile), 'utf8')
            .split(/\r?\n/);
        const quoted = WHATSAPP_FREE_SERVICE_ALLOWANCE.sourceLocators.map(locator => {
            const number = Number.parseInt(locator.replace('line ', ''), 10);
            return lines[number - 1];
        });
        expect(quoted).toHaveLength(2);
        expect(quoted[0]).toContain('1.000 entregas gratuitas por número y mes');
        expect(quoted[1]).toContain('entregasServicioMes - 1000');

        const rollover = Number.parseInt(WHATSAPP_FREE_SERVICE_ALLOWANCE.rollsOverLocator.replace('line ', ''), 10);
        expect(lines[rollover - 1]).toContain('sin acumulación');
    });
});

describe('the generator', () => {
    it('agrees that the checked-in table still matches the sources', () => {
        // The guard the whole arrangement rests on: a rate nobody can trace to
        // a source is not a rate, and a table that has drifted from its sources
        // is exactly that. Run for real, not simulated.
        const script = path.join(root, 'apps/api/scripts/generate-whatsapp-rates.cjs');
        const output = execFileSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' });
        expect(output).toContain('matches the sources');
    }, 30_000);
});
