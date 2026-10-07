import { LanguageDetectorService } from './language-detector.service';

/**
 * Telegram campaign 2026-10-07: «Qual é a política de reembolso?» (store tenant) was answered in Spanish while
 * other Portuguese messages were answered in Portuguese. The sentence has ONE marker word ("qual"), and a single
 * marker never overrides an established Spanish conversation. The standalone "é" (is) is Portuguese only and
 * is the second piece of evidence the sentence always carried.
 */
describe('a standalone "é" is Portuguese evidence', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['Qual é a política de reembolso?', 'es'],
        ['Qual é a política de devolução?', 'es'],
        ['Qual é a política de reembolso?', 'en'],
    ])('"%s" is Portuguese even when the conversation was Spanish (previous = %s)', (text, previous) => {
        expect(detector.detect(text, 'es', previous)).toBe('pt');
        expect(detector.detectDetailed(text, 'es', previous).persist).toBe(true);
    });

    it('without a previous language it is Portuguese too', () => {
        expect(detector.detect('Qual é a política de reembolso?', 'es')).toBe('pt');
    });

    it.each([
        '¿Cuál es la política de reembolso?',
        'Quiero saber la política de reembolso',
        '¿Cuánto cuesta el café?',
        'Quel est le délai de remboursement ?',
    ])('does not turn other languages into Portuguese: %s', text => {
        expect(detector.detect(text, 'es', 'es')).not.toBe('pt');
    });

    it('a single weak Portuguese marker still does not override an established Spanish conversation', () => {
        expect(detector.detect('Hola, quanto?', 'es', 'es')).toBe('es');
    });
});
