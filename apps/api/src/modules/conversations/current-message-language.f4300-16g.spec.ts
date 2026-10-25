import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 residual (production QA Telegram 25-oct, image c9db6219 and earlier the same day). One test customer ran cases
 * in several languages in one conversation, and each of these was answered in the PREVIOUS case's language:
 *  - «ponen implantes dentales?» after an English case (twice): no word of it was known — «ponen» was no Spanish verb here;
 *  - «quanto fica dois pratos Spark?» after an English case: «dois» counted as French («je dois») next to «quanto fica», so
 *    the message had a rival language and decided nothing;
 *  - «j'ai réservé un tour ?» after an English case: «ai» is Portuguese «aí» too, «tour» is a loanword, and the elided «j'»
 *    was no sign of French;
 *  - «cuántos Audífono QA Aurora les quedan?» after a French case: «les» counted as French only, but it is the Spanish dative
 *    pronoun too («les quedan»).
 *
 * A word two languages share («dois», «les», «le») is evidence for neither; the Spanish verbs a service question carries
 * («ponen», «hacemos», «quedaba») and the French «j'» before a verb are evidence of their language.
 */
const detector = new LanguageDetectorService();
const RECENT: Record<string, string[]> = {
    es: ['hola, quiero información', '¿cuánto cuesta el envío?', 'gracias'],
    en: ['hello, I would like some information', 'what are your opening hours?', 'thank you'],
    pt: ['olá, quero informações', 'quanto custa o frete?', 'obrigado'],
    fr: ['bonjour, je voudrais des informations', 'quels sont vos horaires ?', 'merci beaucoup'],
};
const NAMES = ['Spark QA Plato', 'Spark QA Inmueble', 'Audífono QA Aurora', 'Consulta general'];
const CONTEXTS = (previous: string) => [
    undefined,
    { recentCustomerMessages: RECENT[previous] },
    { names: NAMES },
    { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' },
];

const MESSAGES: Array<[string, string]> = [
    // The production messages.
    ['ponen implantes dentales?', 'es'],
    ['quanto fica dois pratos Spark?', 'pt'],
    ["j'ai réservé un tour ?", 'fr'],
    ['cuántos Audífono QA Aurora les quedan?', 'es'],
    // Variants.
    ['hacen limpiezas dentales?', 'es'],
    ['ponen brackets?', 'es'],
    ['ponemos la cita mañana?', 'es'],
    ['cuántos les quedan?', 'es'],
    ['les quedan audífonos?', 'es'],
    ['cuantos quedaban ayer?', 'es'],
    ['quanto ficam três pratos?', 'pt'],
    ['quanto fica duas pizzas?', 'pt'],
    ["j'ai une réservation ?", 'fr'],
    ["j'ai commandé quoi ?", 'fr'],
    ["j'aimerais réserver", 'fr'],
];

describe('F4300-16 residual: Spanish service verbs, the Spanish «les», the Portuguese «dois» and the French «j\'» decide the reply language', () => {
    for (const [message, expected] of MESSAGES) {
        for (const previous of ['es', 'en', 'pt', 'fr'].filter(lang => lang !== expected)) {
            it(`«${message}» after a ${previous} case is ${expected}, and the switch is persisted`, () => {
                for (const context of CONTEXTS(previous)) {
                    expect(detector.detectDetailed(message, previous, previous, context)).toEqual({ language: expected, persist: true });
                }
            });
        }
        it(`«${message}» is ${expected} with no stored language and a Spanish tenant`, () => {
            expect(detector.detect(message, 'es-CO', null)).toBe(expected);
            expect(detector.detect(message, 'es-CO', null, { names: NAMES, preferred: 'es-CO' })).toBe(expected);
        });
        it(`«${message}» in a ${expected} conversation stays ${expected}`, () => {
            expect(detector.detectDetailed(message, expected, expected, { names: NAMES })).toEqual({ language: expected, persist: true });
        });
    }

    it.each([
        // French with «les», «le» and «dois» keeps being French.
        ['les plats sont végétariens ?', 'fr'], ['que dois-je apporter ?', 'fr'], ['le plat contient-il du soja ?', 'fr'],
        ['je dois annuler ma réservation', 'fr'],
    ])('«%s» is still %s after a Spanish case', (message, expected) => {
        expect(detector.detect(message, 'es', 'es')).toBe(expected);
        expect(detector.detect(message, 'es', 'es', { names: NAMES })).toBe(expected);
    });

    it.each([
        // A word two of the languages share, alone, keeps the stored language.
        ['les?', 'fr'], ['les?', 'es'], ['dois', 'pt'], ['dois', 'fr'], ['le', 'es'], ['ok', 'en'], ['Spark QA Plato', 'fr'],
    ])('«%s» keeps the stored %s', (message, stored) => {
        expect(detector.detectDetailed(message, stored, stored)).toEqual({ language: stored, persist: true });
        expect(detector.detectDetailed(message, stored, stored, { names: NAMES })).toEqual({ language: stored, persist: true });
    });
});
