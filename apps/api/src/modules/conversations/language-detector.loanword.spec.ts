import { LanguageDetectorService } from './language-detector.service';

/**
 * Production 2026-10-22, travel agency: after an English conversation the customer wrote «qué debo llevar al tour?»;
 * the turn was detected as English and answered in English. The message is plainly Spanish (qué, debo, llevar, al) but
 * none of those words was known to the detector, and «tour» belongs to every language, so the stored one won.
 * A short message with clear words of ONE language decides the turn even when it carries a loanword.
 */
describe('a short question with a loanword is in the language of its own words', () => {
    const detector = new LanguageDetectorService();
    const QUESTIONS: Record<string, string> = {
        es: 'qué debo llevar al tour?',
        pt: 'o que devo levar ao tour?',
        fr: 'que dois-je apporter pour le tour ?',
        en: 'what should I bring to the tour?',
    };
    const cases = Object.entries(QUESTIONS).flatMap(([lang, text]) =>
        Object.keys(QUESTIONS).filter(previous => previous !== lang).map(previous => [text, previous, lang] as const));

    it.each(cases)('«%s» after a %s conversation is %s', (text, previous, expected) => {
        expect(detector.detectDetailed(text, previous, previous)).toEqual({ language: expected, persist: true });
    });

    it.each(Object.entries(QUESTIONS))('%s: the same question in the stored language stays there', (lang, text) => {
        expect(detector.detectDetailed(text, lang, lang).language).toBe(lang);
    });

    it.each([
        ['que debo llevar al tour?', 'en', 'es'],
        ['Qué debo llevar al hotel?', 'en', 'es'],
        ['o que devo levar ao check-in?', 'es', 'pt'],
    ])('without accents or with another loanword: «%s» after %s is %s', (text, previous, expected) => {
        expect(detector.detectDetailed(text, previous, previous).language).toBe(expected);
    });

    it.each([
        ['tour ok?', 'en'],
        ['the tour?', 'es'],
        ['wifi please', 'pt'],
        ['ok gracias', 'en'],
    ])('a loanword or courtesy alone keeps the stored language: «%s» after %s', (text, previous) => {
        expect(detector.detectDetailed(text, previous, previous).language).toBe(previous);
    });
});
