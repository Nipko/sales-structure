import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 (production QA 29-oct, POST289 on image a466d9d2): the FIRST message of a conversation, with no stored language and the
 * tenant in «es-CO», was answered in Spanish — «como funciona a garantia do fone?» (Portuguese) and «que faire en cas d'urgence
 * dentaire ?» (French). The FAQ was found both times; only the language was wrong.
 */
describe('F4300-16 · the first message of a conversation tells its language', () => {
    const detector = new LanguageDetectorService();
    const context = { preferred: 'es-CO', recentCustomerMessages: [] as string[] };

    it.each([
        ['como funciona a garantia do fone?', 'pt'],
        ['que faire en cas d’urgence dentaire ?', 'fr'],
        ['que faire en cas d\'urgence dentaire ?', 'fr'],
        ['what is the average price per person?', 'en'],
        ['¿cómo funciona la garantía del audífono?', 'es'],
        ['¿qué hago en una urgencia dental?', 'es'],
        ['hola', 'es'],
        ['ok', 'es'],
    ])('«%s» → %s', (text, expected) => {
        expect(detector.detect(text, 'es-CO', undefined, context)).toBe(expected);
    });

    it('a running conversation still decides as before', () => {
        expect(detector.detect('que faire en cas d’urgence dentaire ?', 'es', 'es')).toBe('fr');
        expect(detector.detect('como funciona a garantia do fone?', 'es', 'es')).toBe('pt');
        expect(detector.detect('gracias', 'en', 'en')).toBe('en');
    });
});
