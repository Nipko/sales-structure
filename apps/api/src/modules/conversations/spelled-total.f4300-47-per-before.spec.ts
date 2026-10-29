import { spelledTotalCorrection } from './spelled-total';

/**
 * F4300-47 residue (production QA 28-oct, image 2d2f73f2): «se formos 4, quanto pagamos pelo Spark QA Tour?» got «o preço por pessoa é
 * de 125 EUR» — the unit said before the amount — and no total.
 */
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-47 · the per-person unit before the amount', () => {
    it.each([
        ['pt', 'se formos 4, quanto pagamos pelo Spark QA Tour?', 'Se vocês forem 4 pessoas para o Spark QA Tour, o preço por pessoa é de 125 EUR. O pacote tem duração de 4 horas.', 'Para 4 pessoas: 500 EUR (4 × 125 EUR).'],
        ['en', 'if there are 4 of us, how much?', 'The price per person is 125 EUR. The tour lasts 4 hours.', 'For 4 people: 500 EUR (4 × 125 EUR).'],
        ['es', 'si somos 3, ¿cuánto cuesta la noche?', 'El precio por noche es de 150.000 COP.', null],
    ])('[%s] %s', (lang, ask, reply, expected) => {
        const out = spelledTotalCorrection(reply, ask, lang);
        if (expected === null) expect(out).toBeNull();
        else expect(spaced(out)).toContain(spaced(expected));
    });
});
