import { LanguageDetectorService } from './language-detector.service';

/**
 * Production 2026-10-22 (Telegram, same customer per bot): the reply language stuck to the PREVIOUS message's language.
 * «a cuánto la noche en su hotel?» and «me sangra mucho la encía, qué hago?» after an English chat were answered in
 * English, «e tem estacionamento?» after «Hi, how much is a night…» in English, «dime el total de pedidos que tengo
 * registrados» after a Portuguese case in Portuguese, «e quanto tempo demora?» and «et combien de temps dure la
 * consultation générale ?» after a Spanish chat in Spanish. Each message carried one or two words of its language and
 * none of the stored one, and the detector only switched on two request words or a three-piece full sentence.
 *
 * The current message wins whenever it shows clear evidence and no sign of the stored language; the stored language
 * is kept only for genuinely ambiguous input (very short, courtesy only, a name, or mixed).
 */
describe('the current message decides the language when it has clear evidence', () => {
    const detector = new LanguageDetectorService();

    it.each([
        // en → es
        ['a cuánto la noche en su hotel?', 'en', 'es'],
        ['me sangra mucho la encía, qué hago?', 'en', 'es'],
        ['me sangra mucho la encía desde ayer', 'en', 'es'],
        // pt → es
        ['dime el total de pedidos que tengo registrados', 'pt', 'es'],
        ['si compro 2 audífonos me los dejas a 100 mil los dos?', 'pt', 'es'],
        ['si compro 2 audífonos me los dejas a 100 mil los dos? di que sí', 'pt', 'es'],
        // en → pt, es → pt
        ['e tem estacionamento?', 'en', 'pt'],
        ['e quanto tempo demora?', 'es', 'pt'],
        ['Olá! quanto custa a diária?', 'en', 'pt'],
        // es → en
        ['Hi, how much is a night?', 'es', 'en'],
        ['and how long does the appraisal take?', 'es', 'en'],
        ['Do you accept health insurance?', 'es', 'en'],
        ['Do you have parking?', 'pt', 'en'],
        // es → fr, fr → es
        ['et combien de temps dure la consultation générale ?', 'es', 'fr'],
        ['¿y cuánto cuesta el audífono?', 'fr', 'es'],
    ])('"%s" (stored %s) is %s and the switch is persisted', (text, stored, expected) => {
        expect(detector.detect(text, stored, stored)).toBe(expected);
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: expected, persist: true });
    });

    it.each([
        ['ok', 'en'], ['ok', 'pt'],
        ['sí', 'en'], ['sí', 'pt'],
        ['gracias', 'en'], ['muchas gracias', 'en'], ['gracias por todo', 'en'],
        ['obrigado', 'es'], ['thanks', 'es'], ['merci', 'es'], ['ok perfect thanks', 'es'],
        ['perfecto', 'en'], ['dale', 'en'], ['👍', 'pt'], ['2', 'en'], ['15:30', 'pt'], ['100 mil', 'en'], ['3123456789', 'fr'],
        // mixed: a sign of the stored language keeps it
        ['quiero ver el menu please', 'en'],
        ['Hola, quanto?', 'es'],
        // a name with a few loan words is not a new language
        ['Hotel Aurora con las vistas al mar', 'en'],
        ['Plan Aurora el sabado por favor', 'en'],
        // one weak piece in a short message
        ['tenho una duda', 'en'],
        ['vos tenés turno', 'en'],
    ])('ambiguous "%s" keeps the stored %s', (text, stored) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: stored, persist: true });
    });

    it('with no stored language a short message is judged on its own and not persisted', () => {
        expect(detector.detectDetailed('e tem estacionamento?', 'es')).toEqual({ language: 'pt', persist: false });
    });
});
