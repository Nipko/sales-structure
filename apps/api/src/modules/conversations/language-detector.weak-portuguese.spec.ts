import { LanguageDetectorService } from './language-detector.service';

/**
 * "onde", "posso", "tenho" and "fica" are Portuguese but a single one inside an otherwise Spanish sentence
 * ("onde queda el local?", "tenho una duda") must not turn the first message of a conversation into Portuguese.
 */
describe('weak Portuguese markers', () => {
    const detector = new LanguageDetectorService();

    it.each(['onde queda el local?', 'posso pagar con tarjeta?', 'tenho una duda'])(
        'a single one in a first Spanish message stays Spanish: %s', text => {
            expect(detector.detect(text, 'es')).toBe('es');
            expect(detector.detect(text, 'es', null)).toBe('es');
        });

    it.each(['Onde fica o hotel?', 'Onde posso pagar?', 'Posso pagar com cartão? Onde fica?', 'Qual é o preço? Onde fica?'])(
        'two weak markers, or one with a real one, are Portuguese: %s', text => {
            expect(detector.detect(text, 'es')).toBe('pt');
        });

    it('a single weak marker never overrides an established language', () => {
        expect(detector.detect('onde queda el local?', 'es', 'es')).toBe('es');
        expect(detector.detect('tenho una duda', 'en', 'en')).toBe('en');
    });
});
