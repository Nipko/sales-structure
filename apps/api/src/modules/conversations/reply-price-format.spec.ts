import { localeForReply, normalizeReplyAmounts } from './reply-price-format';
import { ResponseValidatorService } from './response-validator.service';

/**
 * Production 2026-10-07: a product price reached the customer as «119,900 COP» where the store used to show
 * «119.900». The model receives the bare number and writes the grouping itself, so it drifted with the turn
 * language and with its mood. Amounts that carry a currency are put in the grouping of the reply's language.
 */
describe('normalizeReplyAmounts', () => {
    it.each([
        ['El audífono cuesta 119,900 COP.', 'es', 'El audífono cuesta 119.900 COP.'],
        ['Cuesta $119,900 y hay stock.', 'es', 'Cuesta $119.900 y hay stock.'],
        ['Cuesta 119900 COP', 'es', 'Cuesta 119.900 COP'],
        ['Cuesta 119.900 COP', 'es', 'Cuesta 119.900 COP'],
        ['Son 1,234.50 USD en total', 'es', 'Son 1.234,50 USD en total'],
        ['Custa 119,900 COP', 'pt', 'Custa 119.900 COP'],
        ['It costs 119.900 COP', 'en', 'It costs 119,900 COP'],
        ['It costs COP 119.900', 'en', 'It costs COP 119,900'],
        ['Ça coûte 119.900 COP', 'fr', 'Ça coûte 119 900 COP'],
    ])('%s (%s)', (input, lang, expected) => {
        expect(normalizeReplyAmounts(input, localeForReply(lang))).toBe(expected);
    });

    it('never touches numbers that are not amounts', () => {
        for (const text of [
            'Abrimos a las 16:00 el 2026-10-10, son 3 sucursales y 1,000 unidades.',
            'Su pedido 12345678 llega en 3,5 días.', 'Llame al 300 123 4567 (cita 1,200).', 'Hay 119,900 personas',
        ]) expect(normalizeReplyAmounts(text, 'es-CO')).toBe(text);
    });

    it('keeps the amount the price guardrail authorised (same figure, other grouping)', () => {
        const validator = new ResponseValidatorService();
        const reply = normalizeReplyAmounts('Cuesta 119,900 COP', 'es-CO');
        expect(validator.validatePrices(reply, '<product price="119900" currency="COP">Aurora</product>').ok).toBe(true);
    });

    it('uses the business locale when it speaks the reply language, a sensible default otherwise', () => {
        expect(localeForReply('es', 'es-MX')).toBe('es-MX');
        expect(localeForReply('es', 'pt-BR')).toBe('es-CO');
        expect(localeForReply('pt')).toBe('pt-BR');
        expect(localeForReply('en')).toBe('en-US');
        expect(localeForReply('fr')).toBe('fr-FR');
        expect(localeForReply(undefined)).toBe('es-CO');
    });
});
