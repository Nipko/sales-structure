import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 (production QA 29-oct, image 835636c8): with the kids-discount FAQ found, «do kids pay less?» after a French case was
 * answered in French and «crianças pagam menos?» after an English one in English.
 */
describe('F4300-16 · «do kids pay less?» tells its language', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['do kids pay less?', 'fr', 'en'],
        ['crianças pagam menos?', 'en', 'pt'],
        ['les enfants paient-ils moins cher ?', 'es', 'fr'],
        ['¿los niños pagan menos?', 'en', 'es'],
        ['do you deliver to my neighborhood?', 'es', 'en'],
    ])('«%s» after %s → %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });

    it.each([['ok', 'fr', 'fr'], ['menos', 'en', 'en']])('stays: «%s» after %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });
});
