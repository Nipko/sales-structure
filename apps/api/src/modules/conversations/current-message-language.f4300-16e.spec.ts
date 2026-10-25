import { ConversationsService } from './conversations.service';
import { LanguageDetectorService } from './language-detector.service';
import { rewriteRejection, verbatimTermsOf } from './reply-language';

/**
 * F4300-16 residual (production QA 25-oct, image 0330ef7a, Telegram QA tenants, previous case in Spanish):
 *  - restaurant: «qu'est-ce qu'il y a au menu ?» was answered in Spanish, with the sentence «Las cifras 13 y 500 son parte
 *    de este precio.» in it;
 *  - real estate: «me fala mais sobre o Spark QA Inmueble» was answered in Spanish.
 *
 * The catalogue names were not the cause (a capitalised name is already taken out before scoring); the words AROUND them
 * were: the «y» of the French «il y a» counted as the Spanish «y» (and), and «fala», «conta», «sobre», «parlez», «moi»
 * were known to no language while «mais» counted as French. Nothing told the message apart from the stored Spanish, so
 * the stored Spanish stayed. Now «il y a» is French, the request verbs of each language are known, a word the shared
 * table gives to two languages is evidence for neither, and the lowercase joiner of a name («Color y tratamiento») and
 * the name after an elided article («de l'Audífono QA Aurora») are part of the name.
 */
const detector = new LanguageDetectorService();
const RECENT: Record<string, string[]> = {
    es: ['hola, quiero información', '¿cuánto cuesta el envío?', 'gracias'],
    en: ['hello, I would like some information', 'what are your opening hours?', 'thank you'],
    pt: ['olá, quero informações', 'quanto custa o frete?', 'obrigado'],
    fr: ['bonjour, je voudrais des informations', 'quels sont vos horaires ?', 'merci beaucoup'],
};
const NAMES = ['Spark QA Plato', 'Spark QA Inmueble', 'Spark QA Habitacion', 'Audífono QA Aurora', 'Color y tratamiento', 'Consulta general'];
const CONTEXTS = (previous: string) => [
    undefined,
    { recentCustomerMessages: RECENT[previous] },
    { names: NAMES },
    { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' },
];

const MESSAGES: Array<[string, string]> = [
    // The two production messages.
    ["qu'est-ce qu'il y a au menu ?", 'fr'],
    ['me fala mais sobre o Spark QA Inmueble', 'pt'],
    // The same questions, and others around a catalogue name with Spanish words in it.
    ['vous avez quoi à manger ?', 'fr'],
    ['o que tem no cardápio hoje?', 'pt'],
    ['tell me about the Spark QA Plato', 'en'],
    ['parlez-moi du Spark QA Inmueble', 'fr'],
    ['me conta sobre a Spark QA Habitacion', 'pt'],
    ["parlez-moi de l'Audífono QA Aurora", 'fr'],
    ['how much is the Color y tratamiento?', 'en'],
    ['combien coûte la Consulta general ?', 'fr'],
    // Production QA 25-oct (image fab82f84): «háblame del Audífono QA Aurora» after a Portuguese case was answered in Portuguese.
    ['háblame del Audífono QA Aurora', 'es'],
    ['cuéntame sobre la Spark QA Habitacion', 'es'],
    ['dime el precio del Spark QA Plato', 'es'],
    ['muéstrame el Spark QA Inmueble', 'es'],
    ['explícame la Consulta general', 'es'],
];

describe('F4300-16 residual: the words around a catalogue name decide the reply language', () => {
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
        // A name alone, or with an article, says nothing: the stored language stays.
        ['Spark QA Plato', 'fr'], ['el Spark QA Inmueble', 'pt'], ['Color y tratamiento', 'en'], ['la Consulta general', 'fr'],
        ["l'Audífono QA Aurora", 'pt'], ['Spark QA Habitacion?', 'en'],
    ])('«%s» keeps the stored %s', (message, stored) => {
        expect(detector.detectDetailed(message, stored, stored)).toEqual({ language: stored, persist: true });
        expect(detector.detectDetailed(message, stored, stored, { names: NAMES })).toEqual({ language: stored, persist: true });
    });

    it('a name keeps its own joiner and the name after an elided article; the customer\'s words stay', () => {
        expect(detector.nameFreeText('how much is the Color y tratamiento?')).toBe('how much is the tratamiento?');
        expect(detector.nameFreeText("parlez-moi de l'Audífono QA Aurora")).toBe("parlez-moi de l'");
        expect(detector.nameFreeText('quiero el Plan Aurora y nada más')).toBe('quiero el nada más');
        // A joiner between the customer's own words is theirs.
        expect(detector.nameFreeText('quiero pan y queso')).toBe('quiero pan y queso');
    });

    it('the «y» of «il y a» is French, the Spanish «y» is still Spanish', () => {
        expect(detector.detect('il y a des places samedi ?', 'es', 'es')).toBe('fr');
        expect(detector.detect("il n'y a pas de dessert ?", 'en', 'en')).toBe('fr');
        expect(detector.detect('y a-t-il un parking ?', 'es', 'es')).toBe('fr');
        expect(detector.detect('quiero pan y queso', 'fr', 'fr')).toBe('es');
    });
});

describe('F4300-16 residual: «Las cifras 13 y 500 son parte de este precio.»', () => {
    it('a space-grouped figure is ONE figure: «13 500» rewritten «13.500» is no lost figure', () => {
        expect(verbatimTermsOf('Le Spark QA Plato coûte 13 500 COP.').figures).toEqual(['13 500']);
        expect(verbatimTermsOf('Le Spark QA Plato coûte 13 500 COP.').figures).toEqual(['13 500']);
        expect(rewriteRejection('Le Spark QA Plato coûte 13 500 COP.', 'El Spark QA Plato cuesta 13.500 COP.')).toBeNull();
        expect(rewriteRejection('Le Spark QA Plato coûte 13 500 COP.', 'El Spark QA Plato cuesta 13500 COP.')).toBeNull();
        expect(rewriteRejection('Le Spark QA Plato coûte 13 500 COP.', 'El Spark QA Plato cuesta 13 500 COP.')).toBeNull();
        // A changed figure is still caught, and reported as the original wrote it.
        expect(rewriteRejection('Le Spark QA Plato coûte 13 500 COP.', 'El Spark QA Plato cuesta 15.500 COP.'))
            .toEqual({ reason: 'lost_figure', missing: ['13 500'] });
        // Two figures next to each other that read as one are still accepted when each one survives.
        expect(rewriteRejection('Pour 2 300 grammes.', 'Para 2 personas, 300 gramos.')).toBeNull();
    });

    const build = (...rewrites: string[]) => {
        const service: any = Object.create(ConversationsService.prototype);
        const execute = jest.fn();
        for (const content of rewrites) execute.mockResolvedValueOnce({ content });
        Object.assign(service, {
            logger: { warn: jest.fn() }, eventEmitter: { emit: jest.fn() }, languageDetector: detector,
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(), llmRouter: { execute },
        });
        return { service, execute };
    };
    const run = (service: any, reply: string, lang: string, message: string) =>
        service.applyOutputGuardrails(reply, 'sys', [{ role: 'user', content: message }], [], 'tenant', 'conv', [], lang, [],
            { catalog: [{ title: 'Spark QA Plato' }] });

    it('the production turn: decided French, a French reply with «13 500» is sent as written', async () => {
        const message = "qu'est-ce qu'il y a au menu ?";
        const lang = detector.detect(message, 'es', 'es', { recentCustomerMessages: RECENT.es, preferred: 'es-CO' });
        expect(lang).toBe('fr');
        const french = 'Au menu, nous avons le Spark QA Plato à 13 500 COP. Souhaitez-vous le commander ?';
        const { service, execute } = build('should not be used');
        expect(await run(service, french, lang, message)).toBe(french);
        expect(execute).not.toHaveBeenCalled();
    });

    it('a Spanish draft (the data language) in a French turn is rewritten once, keeping «13 500» whole', async () => {
        const message = "qu'est-ce qu'il y a au menu ?";
        const spanish = 'En el menú tenemos el Spark QA Plato por 13 500 COP. ¿Te gustaría pedirlo?';
        const french = 'Au menu, nous avons le Spark QA Plato à 13.500 COP. Souhaitez-vous le commander ?';
        const { service, execute } = build(french);
        expect(await run(service, spanish, 'fr', message)).toBe(french);
        expect(execute).toHaveBeenCalledTimes(1);
        const request = String((execute.mock.calls[0] as any[])[0].messages.slice(-1)[0].content);
        expect(request).toContain('\n- 13 500');
        expect(request).not.toMatch(/\n- 13\n|\n- 500(?:\n|$)/);
    });
});
