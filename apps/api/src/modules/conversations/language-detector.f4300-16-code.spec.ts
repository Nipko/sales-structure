import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 (production QA 28-oct, image 21a03e37): «was my order 5603A623 delivery or pickup?» after a Spanish case was answered in
 * Spanish (the order code read as a name), and «se formos 4, quanto pagamos pelo Spark QA Tour?» / «meu pedido 5603A623 era entrega
 * ou retirada?» after an English case were answered in English.
 */
describe('F4300-16 · an order code is not a name; «se formos» is Portuguese', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['was my order 5603A623 delivery or pickup?', 'es', 'en'],
        ['se formos 4, quanto pagamos pelo Spark QA Tour?', 'en', 'pt'],
        ['meu pedido 5603A623 era entrega ou retirada?', 'en', 'pt'],
        ['se formos 4, quanto pagamos pelo Spark QA Tour?', 'es', 'pt'],
    ])('«%s» after %s → %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });

    it.each([
        ['el pedido 5603A623 ya llegó?', 'es', 'es'],
        ['me mandas el link please', 'es', 'es'],
        ['ok', 'pt', 'pt'],
    ])('stays: «%s» after %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });
});
