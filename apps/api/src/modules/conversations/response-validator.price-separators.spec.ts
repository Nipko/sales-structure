import { correctivePriceInstruction, ResponseValidatorService } from './response-validator.service';

/**
 * Regression 2026-10-05: the money extractor read "119 900 COP" as 900 because a
 * space / NBSP / NNBSP thousands separator was not part of the amount, so a price
 * the tool had returned (119900) was blocked as invented.
 */
describe('thousands separators in stated amounts', () => {
    const service = new ResponseValidatorService();
    const corpus = JSON.stringify({ facts: [{ amount: 119900, currency: 'COP' }], sources: [] });

    it.each([
        'Cuesta 119 900 COP.',
        'Cuesta 119 900 COP.',
        'Cuesta 119 900 COP.',
        'Cuesta $119 900.',
        'Cuesta $119 900 pesos.',
        'Cuesta 119.900 COP.',
        'Cuesta 119,900 COP.',
        'Cuesta COP 119 900,00.',
        'Cuesta 119900 COP.',
    ])('accepts the verified amount: %s', text => {
        expect(service.validatePrices(text, corpus)).toEqual({ ok: true, hallucinatedPrices: [] });
    });

    it('reads the whole group, not its tail', () => {
        const result = service.validatePrices('Cuesta 119 900 COP.', JSON.stringify({ facts: [{ amount: 900, currency: 'COP' }], sources: [] }));
        expect(result.ok).toBe(false);
        expect(result.hallucinatedPrices).toEqual([119900]);
    });

    it.each([
        ['Cuesta 129 900 COP.', 129900],
        ['Cuesta 1 119 900 COP.', 1119900],
    ])('still blocks another amount: %s', (text, amount) => {
        expect(service.validatePrices(text, corpus)).toEqual({ ok: false, hallucinatedPrices: [amount] });
    });

    it('keeps decimals and does not glue a following quantity to the price', () => {
        const decimals = JSON.stringify({ facts: [{ amount: 1200, currency: 'COP' }, { amount: 49900, currency: 'COP' }], sources: [] });
        expect(service.validatePrices('Son 1.200,00 COP', decimals).ok).toBe(true);
        expect(service.validatePrices('Son 1 200,00 COP', decimals).ok).toBe(true);
        expect(service.validatePrices('Son $49.900 por 450 unidades', decimals).ok).toBe(true);
        expect(service.validatePrices('Son $49.900 450 unidades', decimals).ok).toBe(true);
    });

    it('does not read a plain quantity before a currency word as part of a longer number', () => {
        const small = JSON.stringify({ facts: [{ amount: 50, currency: 'USD' }], sources: [] });
        expect(service.validatePrices('Son 2 personas, 50 USD cada una', small).ok).toBe(true);
    });
});

describe('the corrective price retry speaks the turn language', () => {
    it.each([
        ['es', /Reescr/],
        ['en', /Rewrite/],
        ['pt', /Reescreva/],
        ['fr', /Réécris|Reecris|Réécrivez|Reecrivez/],
    ])('%s', (lang, expected) => {
        expect(correctivePriceInstruction(lang)).toMatch(expected);
    });

    it('accepts regional codes and falls back to Spanish for unknown ones', () => {
        expect(correctivePriceInstruction('pt-BR')).toMatch(/Reescreva/);
        expect(correctivePriceInstruction('en_US')).toMatch(/Rewrite/);
        expect(correctivePriceInstruction('de')).toMatch(/Reescr/);
        expect(correctivePriceInstruction(undefined)).toMatch(/Reescr/);
    });
});
