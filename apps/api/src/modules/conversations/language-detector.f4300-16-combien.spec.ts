import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 residual (production QA 26-oct, image b87a817f): «combien d’Audífono QA Aurora en stock ?» right after an English
 * case was answered in English («There are 2 units of Audífono QA Aurora in stock»).
 */
const NAMES = ['Audífono QA Aurora'];

describe('F4300-16 · a French stock question after an English case', () => {
    const detector = new LanguageDetectorService();

    it.each([
        'combien d’Audífono QA Aurora en stock ?',
        "combien d'Audífono QA Aurora en stock ?",
    ])('«%s» is French', text => {
        expect(detector.detectDetailed(text, 'es', 'en', { names: NAMES }).language).toBe('fr');
    });

    it('an apostrophe in an English message is not French («how many D’Angelo pizzas are left?»)', () => {
        expect(detector.detectDetailed("how many D'Angelo pizzas are left?", 'es', 'en', { names: ["D'Angelo"] }).language).toBe('en');
    });
});
