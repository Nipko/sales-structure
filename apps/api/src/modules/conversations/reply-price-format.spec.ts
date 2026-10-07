import { localeForReply, normalizeReplyAmounts, readAmount } from './reply-price-format';
import { ResponseValidatorService } from './response-validator.service';

/**
 * Production 2026-10-07: a product price reached the customer as «119,900 COP» where the store used to show
 * «119.900». The model receives the bare number and writes the grouping itself, so it drifted with the turn
 * language and with its mood. Amounts that carry a currency are put in the grouping of the reply's language,
 * in ONE pass: the figure must never change (a two-pass version turned «$80.000 COP» into «$80 0 COP» in fr-FR).
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
        ['Ça coûte 119.900 €', 'fr', 'Ça coûte 119 900 €'],
        ['Cuesta 1.500 €', 'es', 'Cuesta 1.500 €'],
    ])('%s (%s)', (input, lang, expected) => {
        expect(normalizeReplyAmounts(input, localeForReply(lang))).toBe(expected);
    });

    it('never touches numbers that are not amounts', () => {
        for (const text of [
            'Abrimos a las 16:00 el 2026-10-10, son 3 sucursales y 1,000 unidades.',
            'Su pedido 12345678 llega en 3,5 días.', 'Llame al 300 123 4567 (cita 1,200).', 'Hay 119,900 personas',
        ]) expect(normalizeReplyAmounts(text, 'es-CO')).toBe(text);
    });

    it('does not regroup quantities with a magnitude word, or a year next to a currency code', () => {
        for (const text of [
            'Cuesta COP 1,5 millones.', 'Son 2,5 millones de pesos', 'Vale 50k COP', 'Vale COP 50k', 'Cuesta COP 2 mil', 'It is USD 1.5 million',
            'Desde el año 2026 COP cambió de tarifa.', 'En 2026 COP subió',
        ]) expect(normalizeReplyAmounts(text, 'es-CO')).toBe(text);
        // ...but a year-like figure WITH a currency symbol is a price.
        expect(normalizeReplyAmounts('Cuesta $2026', 'es-CO')).toBe('Cuesta $2.026');
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

describe('a locale whose digits do not read back as the same number leaves the amount as written', () => {
    it('ar-EG (Arabic-Indic digits)', () => {
        expect(normalizeReplyAmounts('Cuesta 119900 COP', 'ar-EG')).toBe('Cuesta 119900 COP');
    });
});

describe('space-grouping locales: a price with a symbol AND a code is regrouped once', () => {
    const LOCALES = ['fr-FR', 'fr-CA', 'pt-PT', 'es-CO', 'es-MX', 'en-US', 'pt-BR'];

    it.each(LOCALES)('%s: «$80.000 COP» and a range keep both figures', locale => {
        const single = normalizeReplyAmounts('Cuesta $80.000 COP.', locale);
        expect(readAmounts(single)).toEqual([80000]);
        expect(single).not.toMatch(/\b80\s0\b/);
        const range = normalizeReplyAmounts('Entre $50.000 y $80.000 COP.', locale);
        expect(readAmounts(range)).toEqual([50000, 80000]);
        expect(range).not.toMatch(/\b0\s0\b/);
    });
});

/** Every amount (a number with a currency marker) read back from a text, whatever separators it uses. */
function readAmounts(text: string): number[] {
    const out: number[] = [];
    // \s already covers the no-break (U+00A0) and narrow no-break (U+202F) spaces that fr / pt-PT group with.
    const re = /(?:(?:R\$|S\/|\$|€|£|COP|USD|EUR)\s?)?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+)(?=(?:\s?(?:COP|USD|EUR|pesos|€))?(?![\d]))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) if (m[1]) out.push(readAmount(m[1]));
    return out;
}

describe('property: regrouping never changes the figure', () => {
    const CORPUS = [
        'Cuesta $80.000 COP.', 'Entre $50.000 y $80.000 COP.', 'Son 1,234.50 USD y 99,90 EUR en total.', 'Desde COP 1.200.000 hasta COP 1.500.000.',
        'El plan cuesta 49.900 pesos al mes y 499.000 pesos al año.', 'Precio: 119900 COP (antes 129900 COP).', 'Total: $1,250,000 COP más $15.000 de envío.',
        'Vale € 1.299,99 en tienda.', 'Cost: USD 12,500.75 or COP 52.000.000.', 'De $5.000 a $9.999 COP según talla.', 'Tarifa 7.500 COP por hora.',
        'Custa R$ 1.299,00 ou 3x de R$ 433,00.', 'Hasta 1.000.000 COP en cobertura.', 'Abono $200.000 COP y saldo $1.800.000 COP.',
        'Pague 25.000 pesos hoy, 75.000 pesos mañana.', 'Cuesta COP 15000, COP 150000 o COP 1500000.', 'Offre: 2.499 € au lieu de 2.999 €.',
        'Entre $50.000 y $80.000 COP, o $100.000 COP en la versión grande.', 'Cuesta 80.000 COP ($80.000 COP).',
    ];
    it.each(['fr-FR', 'fr-CA', 'pt-PT', 'es-CO', 'es-MX', 'en-US', 'pt-BR', 'de-DE'])('%s', locale => {
        for (const text of CORPUS) {
            const out = normalizeReplyAmounts(text, locale);
            expect([text, readAmounts(out)]).toEqual([text, readAmounts(text)]);
            // Idempotent: regrouping the regrouped text changes nothing.
            expect(normalizeReplyAmounts(out, locale)).toBe(out);
        }
    });
});
