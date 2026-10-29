import { stockShortfallNote } from './stock-shortfall';

/**
 * F4300-37 (production QA 27-oct, store tenant): «¿cuánto costarían tres Audífono QA Aurora?» with 2 left was answered with the total
 * for three, in es/pt/en/fr, and never said that only 2 are left.
 */
const CATALOG = [
    { title: 'Audífono QA Aurora', price: 119900, currency: 'COP', stock: 2 },
    { title: 'Cable QA Spark', price: 15000, currency: 'COP', stock: 40 },
];
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-37 · more units asked than the stock: the stock is said', () => {
    it.each([
        ['es', '¿cuánto costarían tres Audífono QA Aurora?',
            'Para tres unidades, el costo total sería 359.700 COP (3 × 119.900 COP). ¿Quiere que le prepare un pedido?',
            'Tenga en cuenta que solo quedan 2 unidades de Audífono QA Aurora (pidió 3).'],
        ['pt', 'quanto custariam três Audífono QA Aurora?', 'Para três unidades, o custo total seria 359.700 COP (3 × 119.900 COP).',
            'Observe que só restam 2 unidades de Audífono QA Aurora (você pediu 3).'],
        ['en', 'how much would three Audífono QA Aurora cost?', 'For three units, the total cost would be 359,700 COP (3 × 119,900 COP).',
            'Please note that only 2 units of Audífono QA Aurora are left (you asked for 3).'],
        ['fr', 'combien coûteraient trois Audífono QA Aurora ?', 'Pour trois unités, le coût total serait de 359 700 COP (3 × 119 900 COP).',
            'Veuillez noter qu’il ne reste que 2 unités de Audífono QA Aurora (vous en avez demandé 3).'],
        ['es', 'quiero 5 audífonos aurora, ¿cuánto sale?', 'Cinco Audífono QA Aurora salen 599.500 COP.', 'solo quedan 2 unidades'],
    ])('[%s] «%s»', (lang, ask, reply, expected) => {
        const out = stockShortfallNote(reply, ask, CATALOG, lang);
        expect(spaced(out)).toContain(spaced(reply.replace(/\s*¿[^?]*\?$/u, '')));
        expect(spaced(out)).toContain(spaced(expected));
    });

    it('the note goes before the closing question, which stays last', () => {
        const out = stockShortfallNote('Tres Audífono QA Aurora costarían 359.700 COP en total (3 × 119.900 COP). ¿Quiere que le ayude a hacer el pedido?',
            '¿cuánto costarían tres Audífono QA Aurora?', CATALOG, 'es');
        expect(spaced(out)).toBe(spaced('Tres Audífono QA Aurora costarían 359.700 COP en total (3 × 119.900 COP). Tenga en cuenta que solo quedan 2 unidades de Audífono QA Aurora (pidió 3). ¿Quiere que le ayude a hacer el pedido?'));
    });

    it.each([
        ['within the stock', '¿cuánto cuestan dos Audífono QA Aurora?', 'Dos Audífono QA Aurora cuestan 239.800 COP.'],
        ['the stock is said already', '¿quedan más de cinco Audífono QA Aurora?', 'No, solo quedan 2 unidades del Audífono QA Aurora.'],
        ['the stock is said already (en)', 'can I get three Audífono QA Aurora?', 'We only have two units of the Audífono QA Aurora left in stock.'],
        ['no product named', '¿cuánto costarían tres?', 'Tres unidades costarían 359.700 COP.'],
        ['no quantity asked', '¿cuánto cuesta el Audífono QA Aurora?', 'El Audífono QA Aurora cuesta 119.900 COP.'],
        ['a product with stock enough', '¿cuánto cuestan tres Cable QA Spark?', 'Tres Cable QA Spark cuestan 45.000 COP.'],
    ])('stays: %s', (_why, ask, reply) => {
        expect(stockShortfallNote(reply, ask, CATALOG, 'es')).toBeNull();
    });

    it('a product with no stock figure: nothing to say', () => {
        expect(stockShortfallNote('Tres cuestan 359.700 COP.', '¿cuánto costarían tres Audífono QA Aurora?', [{ title: 'Audífono QA Aurora' }], 'es')).toBeNull();
    });
});
