import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 (production QA 29-oct, image 3bffe17d): telegraphic questions — «general consultation price?» after a Spanish case answered
 * in Spanish, «tem promoção?» after an English one in English. A question of two or three words with one clear word of another language
 * and none of the stored one is that language.
 */
describe('F4300-16 · a telegraphic question tells its language', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['general consultation price?', 'es', 'en'],
        ['tem promoção?', 'en', 'pt'],
    ])('«%s» after %s → %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });

    it.each([
        ['ok?', 'fr', 'fr'],
        ['Aurora?', 'en', 'en'],
        ['gracias', 'en', 'en'],
    ])('stays: «%s» after %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous)).toBe(expected);
    });
});
