import { ConversationsService } from './conversations.service';
import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 residual after #203 (production 24-oct, image b168adb0, one test conversation reused across cases, the stored
 * language left by the previous case): a message around a product name was answered in the previous case's language:
 *  - stored fr: «qual o valor do Spark QA Inmueble?» → reply in French
 *  - stored es: «is the Spark QA Inmueble for rent?» → reply in Spanish
 * #203 let the current message decide when its known words rule out the stored language, but set aside any message with a
 * capitalised name in it — and listing and product names are in most sales questions. The name is taken out and the words
 * around it decide when they are enough («qual o valor do», «is the … for rent») and carry a verb or a question word; a
 * message that is only a name, too short, or a noun phrase around a name («Hotel Aurora con las vistas al mar») keeps the
 * stored language.
 */
const detector = new LanguageDetectorService();
const RECENT: Record<string, string[]> = {
    es: ['hola, quiero información', '¿cuánto cuesta el envío?', 'gracias'],
    en: ['hello, I would like some information', 'what are your opening hours?', 'thank you'],
    pt: ['olá, quero informações', 'quanto custa o frete?', 'obrigado'],
    fr: ['bonjour, je voudrais des informations', 'quels sont vos horaires ?', 'merci beaucoup'],
};
const NAMES = ['Spark QA Inmueble', 'Hotel Aurora', 'Tour QA Aurora'];

const CASES: Array<[string, string[], string]> = [
    // The two production messages, after every other language.
    ['qual o valor do Spark QA Inmueble?', ['fr', 'es', 'en'], 'pt'],
    ['is the Spark QA Inmueble for rent?', ['es', 'pt', 'fr'], 'en'],
    // The same questions in the other languages, around a capitalised name.
    ['qual o valor do Hotel Aurora?', ['es', 'fr', 'en'], 'pt'],
    ['qual o preço do Tour QA Aurora?', ['es', 'fr', 'en'], 'pt'],
    ['is the Hotel Aurora for rent?', ['es', 'pt', 'fr'], 'en'],
    ['what is the price of the Tour QA Aurora?', ['es', 'pt', 'fr'], 'en'],
    ['cual es el valor del Spark QA Inmueble?', ['pt', 'fr', 'en'], 'es'],
    ['el Hotel Aurora es para arriendo?', ['pt', 'fr', 'en'], 'es'],
    ['quel est le prix du Spark QA Inmueble ?', ['es', 'pt', 'en'], 'fr'],
    ['combien pour le Hotel Aurora ?', ['es', 'pt', 'en'], 'fr'],
];

const ROWS = CASES.flatMap(([text, stored, expected]) => stored.map(previous => [text, previous, expected] as [string, string, string]));

describe('F4300-16 residual: a question around a product name decides the turn language over the previous case', () => {
    it.each(ROWS)('«%s» after a %s case is %s, and the switch is persisted', (text, previous, expected) => {
        for (const context of [
            undefined,
            { recentCustomerMessages: RECENT[previous] },
            { recentCustomerMessages: RECENT[previous], names: NAMES },
            { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' },
        ]) {
            expect(detector.detectDetailed(text, previous, previous, context)).toEqual({ language: expected, persist: true });
        }
    });

    it.each([
        // Only a name, or a name and one or two words: the stored language stays.
        ['Spark QA Inmueble', 'fr'], ['Spark QA Inmueble?', 'es'], ['el Spark QA Inmueble', 'en'], ['valor do Spark QA Inmueble?', 'fr'],
        ['Hotel Aurora price?', 'es'], ['ok Spark QA Inmueble', 'pt'],
        // A noun phrase around a name carries no verb or question word: it stays.
        ['Hotel Aurora con las vistas al mar', 'en'], ['Hotel Aurora con las vistas al mar', 'pt'], ['Plan Aurora el sabado por favor', 'en'],
        // The stored language may be written this way.
        ['qual o valor do Spark QA Inmueble?', 'pt'], ['is the Spark QA Inmueble for rent?', 'en'], ['Hotel Aurora con las vistas al mar', 'es'],
        // Mixed languages.
        ['quiero ver el menu please', 'en'],
    ])('«%s» keeps the stored %s', (text, stored) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: stored, persist: true });
        expect(detector.detectDetailed(text, stored, stored, { names: NAMES })).toEqual({ language: stored, persist: true });
    });
});

describe('F4300-16 residual: the reply guard follows the same decision', () => {
    const build = (rewrite: string) => {
        const service: any = Object.create(ConversationsService.prototype);
        const execute = jest.fn(async () => ({ content: rewrite }));
        Object.assign(service, {
            logger: { warn: jest.fn() }, eventEmitter: { emit: jest.fn() }, languageDetector: detector,
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(), llmRouter: { execute },
        });
        return { service, execute };
    };
    const run = (service: any, reply: string, lang: string, message: string) =>
        service.applyOutputGuardrails(reply, 'sys', [{ role: 'user', content: message }], [], 'tenant', 'conv', [], lang, [],
            { catalog: [{ title: 'Spark QA Inmueble' }] });

    const PRODUCTION: Array<[string, string, string, string]> = [
        ['qual o valor do Spark QA Inmueble?', 'fr',
            "Le prix du Spark QA Inmueble n'est pas confirmé pour le moment, je peux vérifier avec l'équipe.",
            'O valor do Spark QA Inmueble não está confirmado no momento, posso verificar com a equipe.'],
        ['is the Spark QA Inmueble for rent?', 'es',
            'Sí, el Spark QA Inmueble está disponible para arriendo, ¿quieres agendar una visita?',
            'Yes, the Spark QA Inmueble is available for rent, would you like to schedule a visit?'],
        // Short replies, judged as a whole.
        ['is the Spark QA Inmueble for rent?', 'es',
            'Sí, el Spark QA Inmueble está en arriendo.',
            'Yes, the Spark QA Inmueble is for rent.'],
        ['qual o valor do Spark QA Inmueble?', 'fr',
            "Le prix du Spark QA Inmueble n'est pas confirmé.",
            'O valor do Spark QA Inmueble não está confirmado.'],
    ];

    it.each(PRODUCTION)('«%s» after %s: the reply in the previous language is rewritten', async (message, previous, reply, rewrite) => {
        const lang = detector.detect(message, previous, previous, { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' });
        expect(lang).not.toBe(previous);
        const { service, execute } = build(rewrite);
        expect(await run(service, reply, lang, message)).toBe(rewrite);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it.each(PRODUCTION)('«%s» (after %s): a reply already in the customer\'s language is left alone', async (message, previous, _reply, inLanguage) => {
        const lang = detector.detect(message, previous, previous, { names: NAMES });
        const { service, execute } = build('should not be used');
        expect(await run(service, inLanguage, lang, message)).toBe(inLanguage);
        expect(execute).not.toHaveBeenCalled();
    });

    it('a reply that says the agent does not speak the customer\'s language is answered, not sent', async () => {
        const message = 'qual o valor do Spark QA Inmueble?';
        const lang = detector.detect(message, 'fr', 'fr', { names: NAMES });
        expect(lang).toBe('pt');
        const answer = 'O valor do Spark QA Inmueble não está confirmado no momento, posso verificar com a equipe.';
        const { service, execute } = build(answer);
        expect(await run(service, 'Lo siento, pero no hablo portugués.', lang, message)).toBe(answer);
        expect(execute).toHaveBeenCalledTimes(1);
    });
});
