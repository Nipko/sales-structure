import { LanguageDetectorService } from './language-detector.service';
import { ConversationsService } from './conversations.service';

/**
 * Production QA 2026-10-22 (Telegram, one test customer per tenant whose history spans cases): the agent answered in
 * the language of an EARLIER case instead of the customer's current message.
 *  - Store, after a French case: «el Aurora tiene garantía?» and then «Sí, por favor consúltalo.» were answered in French.
 *  - Travel, after a Portuguese case: «hay cupo en el Tour QA Aurora el 15 de noviembre para 2?» was answered in Portuguese.
 *  - «cuánto dura el Spark QA Tour?» after the same Portuguese history was answered in Spanish (correct).
 * The detector gave up on any message holding a capitalised name, and «tiene», «hay», «el», «noviembre» were not
 * evidence of anything, so the stored language won. Names are now taken out and the words around them decide.
 */
describe('the current message language wins over the stored conversation language', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['el Aurora tiene garantía?', 'fr', 'es'],
        ['Sí, por favor consúltalo.', 'fr', 'es'],
        ['hay cupo en el Tour QA Aurora el 15 de noviembre para 2?', 'pt', 'es'],
        ['cuánto dura el Spark QA Tour?', 'pt', 'es'],
        ['el Tour QA Aurora tiene cupo para 2 personas?', 'en', 'es'],
        // Portuguese
        ['o Aurora tem garantia?', 'es', 'pt'],
        ['há vaga no Tour QA Aurora dia 15 de novembro?', 'es', 'pt'],
        ['você tem o Aurora em preto?', 'fr', 'pt'],
        // French
        ['le casque Aurora coûte combien ?', 'es', 'fr'],
        ['je veux le Aurora', 'pt', 'fr'],
        ['il reste de la place pour le Tour QA Aurora ?', 'es', 'fr'],
        // English
        ['does the Aurora have a warranty?', 'es', 'en'],
        ['is there space on the Tour QA Aurora for 2?', 'pt', 'en'],
    ])('«%s» after a %s conversation is %s, and the switch is persisted', (text, stored, expected) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: expected, persist: true });
    });

    it.each([
        ['Aurora', 'fr'], ['Aurora', 'pt'], ['ok', 'fr'], ['ok', 'pt'], ['15', 'fr'], ['👍', 'pt'],
        ['Tour QA Aurora', 'pt'], ['Spark QA Tour', 'fr'], ['Aurora 2', 'en'], ['ok Aurora', 'es'],
    ])('a language-neutral «%s» keeps the stored %s', (text, stored) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: stored, persist: true });
    });

    it('«Sí, por favor» after a French case follows the Spanish of the customer\'s recent messages', () => {
        const recentCustomerMessages = ['le casque Aurora coûte combien ?', 'el Aurora tiene garantía?'];
        expect(detector.detectDetailed('Sí, por favor', 'fr', 'fr', { recentCustomerMessages }).language).toBe('es');
        expect(detector.detect('ok', 'fr', 'fr', { recentCustomerMessages })).toBe('es');
        // Without that context «Sí, por favor» says nothing new: the stored language stays.
        expect(detector.detectDetailed('Sí, por favor', 'fr', 'fr').language).toBe('fr');
    });

    it('a recent message that is itself neutral does not move the stored language', () => {
        expect(detector.detect('ok', 'fr', 'fr', { recentCustomerMessages: ['Aurora', '👍'] })).toBe('fr');
    });

    it('catalogue names passed by the turn are not the customer\'s language', () => {
        // «Bom Dia Pack» would otherwise read as Portuguese words.
        expect(detector.detect('el bom dia pack tiene envío?', 'pt', 'pt', { names: ['Bom Dia Pack'] })).toBe('es');
    });

    it('borrowed words keep the language of their own sentence', () => {
        expect(detector.detect('cuánto cuesta el tour?', 'pt', 'pt')).toBe('es');
        expect(detector.detect('qué debo llevar al tour?', 'fr', 'fr')).toBe('es');
        expect(detector.detect('tour ok?', 'fr', 'fr')).toBe('fr');
    });
});

/**
 * Production QA (store, Telegram, gpt-4.1-mini): with «es» stored, «le Aurora est disponible ?» was answered in Spanish.
 * With the name taken out the words are «le», «est», «disponible»: «disponible» is Spanish AND French, so it counted as
 * Spanish evidence and the French message was undecided. A word two languages share is now evidence for neither.
 */
describe('a word two languages share is evidence for neither', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['le Aurora est disponible ?', 'es', 'fr'],
        ['le Aurora est disponible ?', 'pt', 'fr'],
        ['le Aurora est disponible ?', 'en', 'fr'],
        ['les casques Aurora sont disponibles ?', 'es', 'fr'],
        ['vous avez le Aurora ?', 'es', 'fr'],
        ['est disponible ?', 'es', 'fr'],
        ['el Aurora está disponible?', 'fr', 'es'],
        ['el Aurora está disponible?', 'pt', 'es'],
        ['el Aurora está disponible?', 'en', 'es'],
        ['o Aurora está disponível?', 'es', 'pt'],
        ['o Aurora está disponível?', 'fr', 'pt'],
        ['is the Aurora available?', 'es', 'en'],
        ['is the Aurora available?', 'fr', 'en'],
    ])('«%s» after a %s conversation is %s', (text, stored, expected) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: expected, persist: true });
    });

    it.each([
        ['Aurora', 'es'], ['ok', 'es'], ['disponible?', 'es'], ['disponible?', 'fr'], ['Aurora disponible', 'es'],
        ['Aurora disponible', 'fr'], ['ok Aurora', 'fr'], ['15', 'es'],
    ])('a message with no word of its own («%s») keeps the stored %s', (text, stored) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: stored, persist: true });
    });

    it('a Spanish message with the shared word stays Spanish after a French conversation', () => {
        expect(detector.detect('¿el Aurora está disponible en negro?', 'fr', 'fr')).toBe('es');
        expect(detector.detect('tienen el Aurora disponible?', 'fr', 'fr')).toBe('es');
    });
});

describe('the output guard checks the reply against the current message language', () => {
    const build = (rewrite: string) => {
        const service: any = Object.create(ConversationsService.prototype);
        const execute = jest.fn(async () => ({ content: rewrite }));
        Object.assign(service, {
            logger: { warn: jest.fn() }, eventEmitter: { emit: jest.fn() },
            languageDetector: new LanguageDetectorService(),
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(), llmRouter: { execute },
        });
        return { service, execute };
    };
    const run = (service: any, reply: string, lang: string, customer: string) =>
        service.applyOutputGuardrails(reply, 'sys', [{ role: 'user', content: customer }], [], 'tenant', 'conv', [], lang, [], {});

    it('rewrites a French reply to the Spanish warranty question', async () => {
        const spanish = 'No tengo información específica sobre la garantía del Aurora. ¿Quiere que alguien del equipo lo confirme?';
        const { service, execute } = build(spanish);
        const reply = await run(service, 'Je n\'ai pas d\'information spécifique sur la garantie du Aurora. Voulez-vous que quelqu\'un de l\'équipe vous le confirme ?', 'es', 'el Aurora tiene garantía?');
        expect(reply).toBe(spanish);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('rewrites a Portuguese reply to the Spanish availability question', async () => {
        const spanish = 'Sí, hay cupo disponible en el Tour QA Aurora el 15 de noviembre para 2 personas.';
        const { service } = build(spanish);
        expect(await run(service, 'Sim, há vaga disponível no Tour QA Aurora em 15 de novembro para 2 pessoas, você quer reservar?', 'es',
            'hay cupo en el Tour QA Aurora el 15 de noviembre para 2?')).toBe(spanish);
    });

    it('a short reply clearly in another language is rewritten too', async () => {
        const { service, execute } = build('Lo consulto con el equipo.');
        expect(await run(service, 'Je vérifie la garantie pour vous.', 'es', 'Sí, por favor consúltalo.')).toBe('Lo consulto con el equipo.');
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('a short reply already in the turn language, or without clear evidence, is left alone', async () => {
        const { service, execute } = build('x');
        expect(await run(service, 'Claro, lo consulto ahora.', 'es', 'Sí, por favor consúltalo.')).toBe('Claro, lo consulto ahora.');
        expect(await run(service, 'Con gusto, ¿algo más?', 'pt', 'ok')).toBe('Con gusto, ¿algo más?');
        expect(execute).not.toHaveBeenCalled();
    });
});
