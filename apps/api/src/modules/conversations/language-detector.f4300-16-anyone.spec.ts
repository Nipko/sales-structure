import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 (production QA 29-oct, image de3a45fb, RET qa03): «hola, sigue alguien ahí?» after a French case was answered «Bonjour !
 * Oui, je suis là…» — no word of it was a known Spanish verb.
 */
describe('F4300-16 · «¿sigue alguien ahí?» is Spanish', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['hola, sigue alguien ahí?', 'fr', 'es'],
        ['hola, sigue alguien ahí?', 'en', 'es'],
        ['¿no hay nadie?', 'pt', 'es'],
        ['olá, tem alguém aí?', 'fr', 'pt'],
        ['hello, is anyone there?', 'es', 'en'],
    ])('«%s» after %s → %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });

    it('a bare «ahí» keeps the stored language', () => {
        expect(detector.detect('ahí', 'fr', 'fr')).toBe('fr');
    });
});
