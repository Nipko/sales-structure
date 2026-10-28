import { spelledTotalCorrection } from './spelled-total';

/**
 * F4300-47 residue (production QA 28-oct, image 7417ba99): «si somos 4, ¿cuánto pagamos por el Spark QA Tour?» got «125 EUR por
 * persona» and no total, in es/en/fr — the people were named without the word «personas».
 */
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-47 · «si somos 4» is four people', () => {
    it.each([
        ['es', 'si somos 4, ¿cuánto pagamos por el Spark QA Tour?', 'Si son 4 personas para el Spark QA Tour, pagarían 125 EUR por persona, ya que no hay descuento para niños.', 'Para 4 personas: 500 EUR (4 × 125 EUR).'],
        ['en', 'if there are 4 of us, how much for the Spark QA Tour?', 'If 4 of you go on the Spark QA Tour, the price is 125 EUR per person, as there is no child discount.', 'For 4 people: 500 EUR (4 × 125 EUR).'],
        ['pt', 'se formos 4, quanto pagamos pelo Spark QA Tour?', 'O Spark QA Tour custa 125 EUR por pessoa.', 'Para 4 pessoas: 500 EUR (4 × 125 EUR).'],
        ['fr', 'si nous sommes 4, combien pour le Spark QA Tour ?', 'Si vous êtes 4 pour le Spark QA Tour, le prix est de 125 EUR par personne. Le tour dure 4 heures.', 'Pour 4 personnes : 500 EUR (4 × 125 EUR).'],
    ])('[%s] %s', (lang, ask, reply, expected) => {
        expect(spaced(spelledTotalCorrection(reply, ask, lang))).toContain(spaced(expected));
    });

    it.each([
        ['the total is said', 'si somos 4, ¿cuánto pagamos?', 'Son 125 EUR por persona, 500 EUR en total.'],
        ['no count named', '¿cuánto cuesta el tour por persona?', 'El tour cuesta 125 EUR por persona.'],
        ['«vamos a» is not a count', '¿vamos a necesitar algo más?', 'El tour cuesta 125 EUR por persona.'],
    ])('stays: %s', (_why, ask, reply) => {
        expect(spelledTotalCorrection(reply, ask, 'es')).toBeNull();
    });
});
