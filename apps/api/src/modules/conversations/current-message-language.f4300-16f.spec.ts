import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 residual (production QA 25-oct, restaurant QA tenant, previous case in Portuguese): «any promotions today?» was
 * answered in Portuguese. The request imperatives of each language are known (F4300-16e), but this question has no verb at
 * all: «any» was a single English word, «today» was known to no language and «promotions» is English AND French, so
 * nothing told the message apart from the stored Portuguese, and the stored Portuguese stayed.
 *
 * A short question with no verb switches when its function words (time, quantity, «open») belong to one language only;
 * a message whose words two languages share («algo vegetariano?» is Spanish AND Portuguese) keeps the stored language
 * when it is one of them.
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
    // The production message.
    ['any promotions today?', 'en'],
    ['anything vegetarian?', 'en'],
    ['open tomorrow?', 'en'],
    ['parking available?', 'en'],
    ['something vegetarian tonight?', 'en'],
    ['¿alguna promoción hoy?', 'es'],
    ['alguna promocion hoy?', 'es'],
    ['¿algo vegetariano?', 'es'],
    ['¿abierto mañana?', 'es'],
    ['alguma promoção hoje?', 'pt'],
    ['aberto amanhã?', 'pt'],
    ['algum prato vegetariano?', 'pt'],
    ["des promotions aujourd'hui ?", 'fr'],
    ['quelque chose de végétarien ?', 'fr'],
    ['ouvert demain ?', 'fr'],
];

describe('F4300-16 residual: a short question with no verb decides the reply language by its function words', () => {
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

    describe('«algo vegetariano?» is Spanish or Portuguese', () => {
        it.each(['es', 'pt'])('after a %s case it keeps the stored language', stored => {
            for (const context of CONTEXTS(stored)) {
                expect(detector.detectDetailed('algo vegetariano?', stored, stored, context)).toEqual({ language: stored, persist: true });
            }
        });
        it.each(['en', 'fr'])('after a %s case the tenant language decides between the two', stored => {
            expect(detector.detect('algo vegetariano?', stored, stored, { preferred: 'es-CO' })).toBe('es');
            expect(detector.detect('algo vegetariano?', stored, stored, { preferred: 'pt-BR' })).toBe('pt');
        });
    });

    it.each([
        // A single word, an acknowledgement or a word two of the languages share keeps the stored language.
        ['promotions?', 'pt'], ['promotions?', 'es'], ['today?', 'es'], ['ok today', 'pt'], ['parking?', 'es'], ['vegetariano?', 'en'],
        ['gracias', 'en'], ['ok', 'fr'], ['menu?', 'pt'], ['Spark QA Plato', 'fr'],
    ])('«%s» keeps the stored %s', (message, stored) => {
        expect(detector.detectDetailed(message, stored, stored)).toEqual({ language: stored, persist: true });
        expect(detector.detectDetailed(message, stored, stored, { names: NAMES })).toEqual({ language: stored, persist: true });
    });
});
