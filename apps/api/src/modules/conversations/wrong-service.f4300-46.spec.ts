import { wrongServiceCorrection } from './wrong-service';

/**
 * F4300-46 (production QA 27-oct, salon tenant): «qto custa a manicure e pedicure?» and «c'est combien la manucure pédicure ?» were
 * answered with Corte y estilo's price. The manicure's price is only an example: the reply says it is not confirmed.
 */
const SERVICES = [
    { name: 'Corte y estilo', price: 40000, priceStatus: 'confirmed', currency: 'COP' },
    { name: 'Color y tratamiento', price: 120000, priceStatus: 'confirmed', currency: 'COP' },
    { name: 'Manicure y pedicure', priceStatus: 'example', currency: 'COP' },
];
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-46 · the price of another service is never the answer', () => {
    it.each([
        ['pt', 'qto custa a manicure e pedicure?', 'El precio de Corte y estilo es 40.000 COP. ¿Quiere que alguien del equipo le confirme el precio?',
            'O preço de Manicure y pedicure ainda não foi confirmado'],
        ['fr', 'c’est combien la manucure pédicure ?', "Le prix de Corte y estilo est 40 000 COP. Voulez-vous que quelqu'un de l'équipe vous confirme le prix ?",
            "Le prix de Manicure y pedicure n'a pas encore été confirmé"],
        ['es', '¿cuánto cuesta la manicure y pedicure?', 'El precio de Corte y estilo es 40.000 COP.',
            'El precio de Manicure y pedicure todavía no está confirmado'],
        ['en', 'how much is the color and treatment?', 'The haircut and style costs 40,000 COP.', 'The price of Color y tratamiento is 120,000 COP.'],
        ['fr', 'combien coûte la coloration et soin ?', 'Le prix de Coupe et style est de 40 000 COP.', 'Le prix de Color y tratamiento est de 120 000 COP.'],
    ])('%s «%s»', (lang, customer, reply, expected) => {
        expect(spaced(wrongServiceCorrection(reply, customer, SERVICES, lang))).toContain(spaced(expected));
    });

    it.each([
        // The service asked for is the one priced, in another language.
        ['fr', 'combien coûte une coupe et coiffage ?', 'Le service Coupe et style coûte 40 000 COP par personne.'],
        ['es', '¿cuánto cuesta el corte y estilo?', 'El servicio Corte y estilo cuesta 40.000 COP.'],
        // Two services asked: the reply may price both.
        ['es', '¿cuánto cuestan el corte y estilo y la manicure y pedicure?', 'El Corte y estilo cuesta 40.000 COP; la Manicure y pedicure no tiene precio confirmado.'],
        // No service named: nothing to compare with.
        ['es', '¿cuánto cuesta?', 'El precio de Corte y estilo es 40.000 COP.'],
        // No amount said.
        ['pt', 'qto custa a manicure e pedicure?', 'Posso ajudar com o Corte y estilo?'],
    ])('kept: %s «%s»', (lang, customer, reply) => {
        expect(wrongServiceCorrection(reply, customer, SERVICES, lang)).toBeNull();
    });

    it('no services in the turn: nothing to say', () => {
        expect(wrongServiceCorrection('El precio de Corte y estilo es 40.000 COP.', 'qto custa a manicure?', undefined, 'pt')).toBeNull();
    });
});
