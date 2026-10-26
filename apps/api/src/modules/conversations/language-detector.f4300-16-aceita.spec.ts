import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 residual (production QA 26-oct, image 6f1d3bf6): «o Tour QA Aurora aceita um grupo de 10?» right after an English
 * case was answered in English, word for word the previous answer.
 */
describe('F4300-16 · a Portuguese yes/no question after an English case', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['o Tour QA Aurora aceita um grupo de 10?', ['Tour QA Aurora']],
    ])('«%s» is Portuguese', (text, names) => {
        expect(detector.detectDetailed(text, 'es', 'en', { names }).language).toBe('pt');
    });
});
