import { spelledTotalCorrection } from './spelled-total';

/**
 * F4300-47 residue (production QA 28-oct, rendered facts on, image ae71309a): the total came out as the unit price — the model cites
 * the price by its token and has no token for the total.
 */
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-47 · the total is not the unit price said again', () => {
    it.each([
        ['es', '¿y si pido 3 platos Spark, cuánto es?', 'Si pide 3 platos Spark, el total sería 3 veces 13.500 COP, es decir, 13.500 COP por cada plato. ¿Quiere que le ayude?',
            'el total sería 40.500 COP (3 × 13.500 COP), es decir, 13.500 COP por cada plato.'],
        ['es', 'si compro los 2 audífonos que quedan, ¿cuánto pago?', 'Si compra los 2 audífonos QA Aurora que quedan, pagará 119.900 COP cada uno, lo que suma un total de 119.900 COP por los dos.',
            'lo que suma un total de 239.800 COP (2 × 119.900 COP) por los dos.'],
        ['fr', 'si je reste 6 nuits, combien je paie au total ?', 'Si vous restez 6 nuits, le prix total serait 150 000 COP par nuit multiplié par 6 nuits, soit 150 000 COP par nuit.',
            'le prix total serait 900 000 COP (6 × 150 000 COP par nuit), soit 150 000 COP par nuit.'],
        ['fr', 'et si je prends 3 plats Spark, ça fait combien ?', 'Si vous prenez 3 plats Spark, cela fera 13 500 COP par plat, donc un total de 13 500 COP.',
            'donc un total de 40 500 COP (3 × 13 500 COP).'],
    ])('[%s] «%s»', (lang, ask, reply, expected) => {
        expect(spaced(spelledTotalCorrection(reply, ask, lang))).toContain(spaced(expected));
    });

    it.each([
        ['the total is said already', 'si pido 3 platos, ¿cuánto es?', 'Tres platos cuestan 40.500 COP en total; cada uno 13.500 COP.'],
        ['no quantity asked', '¿cuánto cuesta el plato?', 'El plato cuesta 13.500 COP, es decir, 13.500 COP por plato.'],
        ['the second amount is per unit', 'si pido 3 platos, ¿cuánto es?', 'Cada plato cuesta 13.500 COP, es decir, 13.500 COP por cada plato.'],
    ])('stays: %s', (_why, ask, reply) => {
        expect(spelledTotalCorrection(reply, ask, 'es')).toBeNull();
    });
});
