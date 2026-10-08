import { LanguageDetectorService } from './language-detector.service';

/**
 * Production 2026-10-08: after «What are your opening hours?» the chat stayed English for «quiero agendar corte y
 * estilo» and the booking engine answered «Corte y estilo selected. What date works for you?». A single marker never
 * switched a STORED language (so «me mandas el link please» stays Spanish); a request in another language, with no
 * sign of the stored one, now does. Courtesy words never switch by themselves.
 */
describe('a strong marker switches the stored language when nothing of the stored one is present', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['quiero agendar corte y estilo', 'en', 'es'],
        ['necesito una cita para mañana', 'en', 'es'],
        ['¿tienen disponibilidad?', 'en', 'es'],
        ['busco un apartamento en arriendo', 'pt', 'es'],
        ['quero agendar um corte', 'es', 'pt'],
        ['I want to book a haircut', 'es', 'en'],
        ['je veux réserver une coupe', 'es', 'fr'],
    ])('"%s" (stored %s) is %s and the switch is persisted', (text, stored, expected) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: expected, persist: true });
    });

    it.each([
        ['What are your opening hours?', 'en'],
        ['me mandas el link please', 'es'],
        ['gracias', 'en'],
        ['thanks', 'es'],
        ['hola', 'en'],
        ['merci', 'es'],
        ['please send it', 'es'],
        ['quiero ver el menu please', 'en'],
        ['ok', 'es'],
        // ONE strong word is a borrowed word, a brand or a typo, never a new language
        ['what?', 'es'],
        ['how?', 'es'],
        ['When?', 'es'],
        ['need', 'es'],
        ['ok what', 'es'],
        ['el Want Pack', 'es'],
        ['cual', 'en'],
        ['donde', 'en'],
        ['tengo', 'en'],
    ])('"%s" keeps the stored language %s', (text, stored) => {
        expect(detector.detect(text, stored, stored)).toBe(stored);
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: stored, persist: true });
    });

    it('keeps the weak Portuguese rules of the first message', () => {
        expect(detector.detect('onde queda el local?', 'es', 'es')).toBe('es');
        expect(detector.detect('tenho una duda', 'es', 'es')).toBe('es');
        expect(detector.detect('posso pagar con tarjeta?', 'es')).toBe('es');
    });

    it('a stored language with no history behaves as before', () => {
        expect(detector.detect('quiero agendar corte y estilo', 'en')).toBe('es');
    });
});
