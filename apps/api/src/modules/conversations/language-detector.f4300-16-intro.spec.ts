import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 (production QA 28-oct, image 4714868a): «hola, soy vegetariana» after a French case was answered in French and «hi, I am
 * vegetarian» after a Spanish one in Spanish — a self-introduction carried no verb the detector knew.
 */
describe('F4300-16 · a self-introduction tells the language', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['hola, soy vegetariana', 'fr', 'es'],
        ['hola, soy vegetariana', 'pt', 'es'],
        ['hi, I am vegetarian', 'es', 'en'],
        ['oi, sou vegetariana', 'en', 'pt'],
        ['bonjour, je suis végétarienne', 'es', 'fr'],
    ])('«%s» after %s → %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });

    it.each([
        ['ok', 'fr', 'fr'],
        ['soy', 'en', 'en'],
    ])('stays: «%s» after %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });
});
