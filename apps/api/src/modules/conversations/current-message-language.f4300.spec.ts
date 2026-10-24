import { ConversationsService } from './conversations.service';
import { LanguageDetectorService } from './language-detector.service';
import { languageDenialOf, wholeReplyMismatch } from './reply-language';

/**
 * F4300-16, production QA 23/24-oct: one synthetic customer runs many cases in one conversation, so the stored language
 * and the customer's recent messages are those of the PREVIOUS case. A new message plainly in its own language was
 * answered in the previous one, intermittently:
 *  - «o que está incluído no Spark QA Tour?» (pt) → «Le forfait Spark QA Tour dure 4 heures…»
 *  - «de qué color es el audífono Aurora?» (es) → «The Audífono QA Aurora is available in blue color…»
 *  - «el audífono Aurora trae estuche?» (es) → «Não tenho informação confirmada…»
 *  - «le plat Spark contient-il du soja ?» (fr) → «Lo siento, pero no hablo francés…»
 *  - «me mandas dos del plato Spark?» (es) → «I can help you order two units…»
 * Once the name is taken out, each of them is built of words two languages share («o», «que», «está», «no», «me», «dos»)
 * or that no list knew («trae», «es», «contient»), so the detector kept the previous language. «quais produtos vocês
 * vendem?», «how much is the Tour QA Aurora?» and «combien de temps…» were detected right; their wrong-language replies
 * («¡Hola! Soy Sofía…», «No tengo el precio confirmado…», «no hablo francés») are the reply guard's to align.
 */
const detector = new LanguageDetectorService();
const RECENT: Record<string, string[]> = {
    es: ['hola, quiero información', '¿cuánto cuesta el envío?', 'gracias'],
    en: ['hello, I would like some information', 'what are your opening hours?', 'thank you'],
    pt: ['olá, quero informações', 'quanto custa o frete?', 'obrigado'],
    fr: ['bonjour, je voudrais des informations', 'quels sont vos horaires ?', 'merci beaucoup'],
};
const NAMES = ['Spark QA Tour', 'Tour QA Aurora', 'Audífono QA Aurora', 'Spark QA Plato'];

describe('the current message decides the turn language over the previous case', () => {
    it.each([
        ['o que está incluído no Spark QA Tour?', 'fr', 'pt'],
        ['quais produtos vocês vendem?', 'es', 'pt'],
        ['de qué color es el audífono Aurora?', 'en', 'es'],
        ['how much is the Tour QA Aurora?', 'es', 'en'],
        ['el audífono Aurora trae estuche?', 'pt', 'es'],
        ['combien de temps dure le Spark QA Tour ?', 'es', 'fr'],
        ['le plat Spark contient-il du soja ?', 'es', 'fr'],
        ['me mandas dos del plato Spark?', 'en', 'es'],
    ])('«%s» after a %s case is %s, and the switch is persisted', (text, previous, expected) => {
        for (const context of [undefined, { recentCustomerMessages: RECENT[previous] }, { recentCustomerMessages: RECENT[previous], names: NAMES }]) {
            expect(detector.detectDetailed(text, previous, previous, context)).toEqual({ language: expected, persist: true });
        }
    });

    it.each([
        ['ok', 'fr'], ['ok', 'pt'], ['gracias', 'pt'], ['Aurora?', 'en'], ['Aurora?', 'fr'], ['Spark QA Tour', 'es'],
        ['el Aurora', 'pt'], ['15', 'fr'], ['dos', 'en'], ['o Aurora', 'fr'],
    ])('a short or language-neutral «%s» keeps the previous %s', (text, previous) => {
        expect(detector.detect(text, previous, previous, { recentCustomerMessages: RECENT[previous] })).toBe(previous);
    });

    it.each([
        ['quanto custa o Audífono QA Aurora?', 'es', 'pt'],
        ['o Spark QA Plato contém soja?', 'fr', 'pt'],
        ['does the Spark QA Plato contain nuts?', 'es', 'en'],
        ['¿el Spark QA Tour incluye almuerzo?', 'pt', 'es'],
        ['le Tour QA Aurora comprend-il le transport ?', 'en', 'fr'],
        ['avez-vous le Audífono QA Aurora en bleu ?', 'es', 'fr'],
    ])('a message around a product name keeps its own language: «%s» after %s is %s', (text, previous, expected) => {
        expect(detector.detect(text, previous, previous, { recentCustomerMessages: RECENT[previous], names: NAMES })).toBe(expected);
    });

    it('the constructions do not fire on the other languages', () => {
        // Spanish «lo que», Portuguese «me manda» (você), an English list after «me».
        expect(detector.detect('dime lo que incluye el tour', 'pt', 'pt')).toBe('es');
        expect(detector.detect('você me manda o link do Spark QA Tour?', 'es', 'es')).toBe('pt');
        expect(detector.detect('please send me prices for the Spark QA Tour', 'es', 'es')).toBe('en');
    });
});

describe('the reply is aligned to the current message language', () => {
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
        service.applyOutputGuardrails(reply, 'sys', [{ role: 'user', content: message }], [], 'tenant', 'conv', [], lang, [], {});
    const lastInstruction = (execute: jest.Mock): string => {
        const request = (execute.mock.calls[0] as any[])[0];
        return String(request.messages[request.messages.length - 1].content);
    };

    it.each([
        ['o que está incluído no Spark QA Tour?', 'pt', 'Le forfait Spark QA Tour dure 4 heures et comprend la visite guidée.', 'O Spark QA Tour dura 4 horas e inclui a visita guiada.'],
        ['quais produtos vocês vendem?', 'pt', '¡Hola! Soy Sofía. ¿Qué tipo de productos te interesan?', 'Olá! Sou a Sofía. Que tipo de produtos você procura?'],
        ['de qué color es el audífono Aurora?', 'es', 'The Audífono QA Aurora is available in blue color.', 'El Audífono QA Aurora está disponible en color azul.'],
        ['how much is the Tour QA Aurora?', 'en', 'No tengo el precio confirmado del Tour QA Aurora.', 'I do not have a confirmed price for the Tour QA Aurora.'],
        ['el audífono Aurora trae estuche?', 'es', 'Não tenho informação confirmada sobre o estojo.', 'No tengo información confirmada sobre el estuche.'],
        ['me mandas dos del plato Spark?', 'es', 'I can help you order two units of the Spark QA Plato.', 'Te ayudo a pedir dos unidades del Spark QA Plato.'],
    ])('«%s» (%s): «%s» is rewritten', async (message, lang, reply, rewrite) => {
        const { service, execute } = build(rewrite);
        expect(await run(service, reply, lang, message)).toBe(rewrite);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('a reply saying it does not speak French is answered in French, not translated', async () => {
        const answer = 'Le plat Spark contient du soja selon notre carte.';
        const { service, execute } = build(answer);
        expect(await run(service, 'Lo siento, pero no hablo francés.', 'fr', 'le plat Spark contient-il du soja ?')).toBe(answer);
        expect(lastInstruction(execute)).toMatch(/ne parlez pas la langue du client/);
        // Even in three words.
        const short = build(answer);
        expect(await run(short.service, 'No hablo francés.', 'fr', 'le plat Spark contient-il du soja ?')).toBe(answer);
    });

    it('a rewrite that still says it does not speak the language is not sent', async () => {
        const { service } = build('Désolé, je ne parle pas français.');
        expect(await run(service, 'Lo siento, pero no hablo francés.', 'fr', 'combien de temps dure le Spark QA Tour ?')).toBe('Lo siento, pero no hablo francés.');
    });

    it.each([
        ['Le forfait dure quatre heures.', 'fr'],
        ['Claro, te lo envío hoy mismo.', 'es'],
        ['Sim, temos em azul e preto.', 'pt'],
        ['Yes, it comes in blue.', 'en'],
        ['Hola, no hablo de precios aquí.', 'es'],
    ])('a short reply in the turn language is left alone: «%s» (%s)', async (reply, lang) => {
        const { service, execute } = build('should not be used');
        expect(await run(service, reply, lang, 'x')).toBe(reply);
        expect(execute).not.toHaveBeenCalled();
    });

    it('recognises a language denial in the four languages, and nothing else', () => {
        expect(languageDenialOf('Lo siento, pero no hablo francés.')).toBe('es');
        expect(languageDenialOf("Sorry, I don't speak Portuguese.")).toBe('en');
        expect(languageDenialOf('Desculpe, não falo espanhol.')).toBe('pt');
        expect(languageDenialOf('Désolé, je ne parle pas anglais.')).toBe('fr');
        expect(languageDenialOf('Le plat contient du soja.')).toBeNull();
        expect(languageDenialOf('I can help you with that.')).toBeNull();
    });

    it('a short reply is judged as a whole, never on a single word of another language', () => {
        expect(wholeReplyMismatch('Não tenho informação confirmada sobre o estojo.', 'es')).toBe('pt');
        expect(wholeReplyMismatch('The Aurora cuesta 129.900 COP today.', 'en')).toBeNull();
    });
});


/**
 * F4300-16 after #198, production QA 24-oct (same shared customer): «qué consulta me recomiendan para una revisión general?»
 * after a Portuguese case was answered «Para uma revisão geral, recomendo agendar uma "Consulta general"…» (2/2, also «qué
 * consulta es mejor…?»), and «tell me about the Aurora tour» after a Spanish case «El Tour QA Aurora es una experiencia
 * ficticia…». Before the fix the detector kept the previous language for all three: «consulta» counted as a sign of
 * Portuguese (Spanish spells it the same), and once the name was out, «tell me about the tour» had evidence («about»,
 * «the») but no verb. Spanish-only shapes («qué», «me recomiendan», «una», «-ión», «mejor») and English request frames
 * («tell me», «what is», «how much») now decide the turn.
 */
describe('words shared by Spanish and Portuguese, and English request frames, do not keep the previous case language', () => {
    const SHARED_NAMES = ['Consulta general', 'Tour QA Aurora'];
    it.each([
        ['qué consulta me recomiendan para una revisión general?', 'pt', 'es'],
        ['qué consulta es mejor para una revisión general?', 'pt', 'es'],
        ['que consulta me recomiendan para una revision general?', 'pt', 'es'],
        ['tell me about the Aurora tour', 'es', 'en'],
        ['tell me about the Tour QA Aurora', 'pt', 'en'],
        ['what is the Aurora tour?', 'es', 'en'],
        ['how much is a Consulta general?', 'pt', 'en'],
        ['quais produtos vocês vendem?', 'es', 'pt'],
        ['Tem outros produtos?', 'es', 'pt'],
        ['qual consulta vocês recomendam para uma revisão geral?', 'es', 'pt'],
    ])('«%s» after a %s case is %s', (text, previous, expected) => {
        for (const context of [undefined, { recentCustomerMessages: RECENT[previous] }, { recentCustomerMessages: RECENT[previous], names: SHARED_NAMES }]) {
            expect(detector.detectDetailed(text, previous, previous, context)).toEqual({ language: expected, persist: true });
        }
    });

    it.each([
        ['consulta general', 'pt'], ['consulta general', 'es'], ['a consulta', 'pt'], ['el show', 'en'], ['Aurora tour', 'es'],
    ])('a shared or product-only «%s» keeps the previous %s', (text, previous) => {
        expect(detector.detect(text, previous, previous, { recentCustomerMessages: RECENT[previous] })).toBe(previous);
    });

    it('a Spanish question about a show or a Portuguese «me recomendam» is not read as English or Spanish', () => {
        expect(detector.detect('a qué hora es el show?', 'en', 'en')).toBe('es');
        expect(detector.detect('vocês me recomendam qual consulta?', 'es', 'es')).toBe('pt');
    });
});

describe('the reply guard follows the confident current-message language even around a catalogue name of another language', () => {
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
    const run = (service: any, reply: string, lang: string, message: string, context: any = {}) =>
        service.applyOutputGuardrails(reply, 'sys', [{ role: 'user', content: message }], [], 'tenant', 'conv', [], lang, [], context);
    const SERVICES = { availableServices: [{ name: 'Consulta general' }], catalog: [{ title: 'Tour QA Aurora' }] };

    it.each([
        ['qué consulta me recomiendan para una revisión general?', 'pt',
            'Para uma revisão geral, recomendo agendar uma "Consulta general", que inclui avaliação completa com o nosso clínico.',
            'Para una revisión general, le recomiendo agendar una "Consulta general", que incluye una evaluación completa con nuestro clínico.'],
        ['qué consulta es mejor para una revisión general?', 'pt',
            'Para uma revisão geral, recomendo a Consulta general.',
            'Para una revisión general, le recomiendo la Consulta general.'],
        ['tell me about the Aurora tour', 'es',
            'El Tour QA Aurora es una experiencia ficticia de prueba que incluye un recorrido guiado.',
            'The Tour QA Aurora is a fictional test experience that includes a guided walk.'],
        ['Tem outros produtos?', 'es',
            'Sí, también tenemos el Tour QA Aurora y la Consulta general.',
            'Sim, também temos o Tour QA Aurora e a Consulta general.'],
    ])('«%s» (stored %s): the reply in the previous language is rewritten', async (message, previous, reply, rewrite) => {
        const lang = detector.detect(message, previous, previous, { recentCustomerMessages: RECENT[previous], names: ['Consulta general', 'Tour QA Aurora'] });
        expect(lang).not.toBe(previous);
        for (const context of [{}, SERVICES]) {
            const { service, execute } = build(rewrite);
            expect(await run(service, reply, lang, message, context)).toBe(rewrite);
            expect(execute).toHaveBeenCalledTimes(1);
        }
    });

    it('a reply in the turn language that quotes a catalogue name of another language is left alone', async () => {
        for (const [reply, lang] of [
            ['Para uma revisão geral, recomendo agendar uma "Consulta general" com o nosso clínico.', 'pt'],
            ['For a general check-up I recommend booking a Consulta general with our clinician.', 'en'],
            ['The Tour QA Aurora is a fictional test experience with a guided walk.', 'en'],
        ]) {
            for (const context of [{}, SERVICES]) {
                const { service, execute } = build('should not be used');
                expect(await run(service, reply, lang, 'x', context)).toBe(reply);
                expect(execute).not.toHaveBeenCalled();
            }
        }
    });
});
