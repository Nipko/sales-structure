import { ConversationsService } from './conversations.service';
import { LanguageDetectorService } from './language-detector.service';
import { languageMismatch, replyLanguageOf, wholeReplyMismatch } from './reply-language';

/**
 * F4300-16 residual after #210 (production 24-oct, image b168adb0, one test conversation reused across cases, the previous
 * case in English): the hotel customer wrote «a qué hora es el check-in?»; the agent read the property (15:00 / 11:00) and
 * answered «Check-in is at 3:00 p.m. and check-out is at 11:00 a.m.» — in English.
 *
 * The detector split «check-in» into «check» and «in», and «in» is an English function word: English then had evidence
 * in the message, so neither the clear-language rule (a rival with evidence), nor the current-message rule (a sign of the
 * stored language), nor the exclusion rule («in» ruled out every language but English, «el» and «qué» then ruled out
 * English) could decide, and the stored English stayed. The prompt asked for English, the model answered in English and
 * the guard, told the turn was English, had nothing to correct.
 *
 * Loanwords of hospitality and commerce (check-in, check-out, tour, delivery, online, email, wifi, spa, ok) are now
 * neutral in the detector and in the reply guard: they are no evidence of any language.
 */
const detector = new LanguageDetectorService();
const RECENT: Record<string, string[]> = {
    es: ['hola, quiero información', '¿cuánto cuesta el envío?', 'gracias'],
    en: ['hello, I would like some information', 'what are your opening hours?', 'thank you'],
    pt: ['olá, quero informações', 'quanto custa o frete?', 'obrigado'],
    fr: ['bonjour, je voudrais des informations', 'quels sont vos horaires ?', 'merci beaucoup'],
};
const NAMES = ['Hotel Aurora', 'Spark QA Hotel', 'Tour QA Aurora'];
const CONTEXTS = (previous: string) => [
    undefined,
    { recentCustomerMessages: RECENT[previous] },
    { recentCustomerMessages: RECENT[previous], names: NAMES },
    { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' },
];

describe('F4300-16 residual: a loanword is no evidence of the stored language', () => {
    it.each([
        // The production message, and the same question in the other languages.
        ['a qué hora es el check-in?', 'en', 'es'],
        ['a qué hora es el check-in?', 'pt', 'es'],
        ['a qué hora es el check-in?', 'fr', 'es'],
        ['que horas é o check-out?', 'en', 'pt'],
        ['que horas é o check-out?', 'es', 'pt'],
        ['à quelle heure est le check-in ?', 'en', 'fr'],
        ['à quelle heure est le check-in ?', 'es', 'fr'],
        ['what time is check-in?', 'es', 'en'],
        ['what time is check-in?', 'pt', 'en'],
        // Other spellings and other loanwords of a hotel or a shop.
        ['a que hora es el checkin?', 'en', 'es'],
        ['¿a qué hora es el check out?', 'en', 'es'],
        ['el wifi es gratis?', 'en', 'es'],
        ['hasta qué hora abre el spa?', 'en', 'es'],
        ['puedo pagar online con mi tarjeta?', 'en', 'es'],
        ['me mandas el email de confirmación?', 'en', 'es'],
        ['tienen delivery a mi casa?', 'en', 'es'],
        ['qué incluye el tour?', 'en', 'es'],
        ['o wifi é grátis?', 'en', 'pt'],
        ['le spa est ouvert le dimanche ?', 'en', 'fr'],
        ['is the wifi free?', 'es', 'en'],
    ])('«%s» after a %s case is %s, and the switch is persisted', (text, previous, expected) => {
        for (const context of CONTEXTS(previous)) {
            expect(detector.detectDetailed(text, previous, previous, context)).toEqual({ language: expected, persist: true });
        }
    });

    it.each([
        // A loanword alone, or with a courtesy word, keeps the stored language.
        ['check-in?', 'en'], ['check-in?', 'es'], ['el check-in', 'en'], ['check-out ok', 'pt'], ['wifi?', 'fr'], ['ok', 'es'],
        ['spa online', 'pt'], ['tour ok?', 'en'], ['email please', 'es'], ['delivery precio?', 'en'], ['ok gracias', 'en'],
        // The question in the stored language stays there.
        ['a qué hora es el check-in?', 'es'], ['what time is check-in?', 'en'], ['que horas é o check-out?', 'pt'],
        ['à quelle heure est le check-in ?', 'fr'],
        // A name around a loanword, with no verb: the stored language stays (#210).
        ['Hotel Aurora check-in', 'es'], ['Hotel Aurora con las vistas al mar', 'en'],
    ])('«%s» keeps the stored %s', (text, stored) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: stored, persist: true });
        expect(detector.detectDetailed(text, stored, stored, { names: NAMES })).toEqual({ language: stored, persist: true });
    });
});

describe('F4300-16 residual: the reply guard treats loanwords as neutral', () => {
    it('a reply wholly in another language is a mismatch even when it is full of loanwords', () => {
        const english = 'Check-in is at 3:00 p.m. and check-out is at 11:00 a.m.';
        expect(languageMismatch(english, 'es')).toBe('en');
        expect(wholeReplyMismatch('Check-in is at 3 p.m.', 'es')).toBe('en');
        expect(wholeReplyMismatch('The wifi is free, the spa is open.', 'pt')).toBe('en');
    });

    it('a reply in the turn language that carries English loanwords is left alone', () => {
        expect(languageMismatch('El check-in es a las 15:00 y el check-out a las 11:00.', 'es')).toBeNull();
        expect(wholeReplyMismatch('El check-in es a las 15:00.', 'es')).toBeNull();
        expect(wholeReplyMismatch('O check-in é às 15h, o check-out às 11h.', 'pt')).toBeNull();
        expect(wholeReplyMismatch("Le check-in est à 15h et le check-out à 11h.", 'fr')).toBeNull();
        expect(wholeReplyMismatch('Sí, el wifi es gratis y el spa abre hasta las 20:00.', 'es')).toBeNull();
        expect(languageMismatch('Claro, puedes pagar online o con delivery, te mando el email con el tour.', 'es')).toBeNull();
        // Loanwords alone are no language at all.
        expect(replyLanguageOf('Check-in / check-out online, wifi, spa, tour, delivery, email: ok')).toBeNull();
    });
});

describe('F4300-16 residual: the production turn is answered in the customer\'s language', () => {
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
            { catalog: [{ title: 'Hotel Aurora' }] });

    const TURNS: Array<[string, string, string, string]> = [
        // The production turn: stored English, the reply in English.
        ['a qué hora es el check-in?', 'en',
            'Check-in is at 3:00 p.m. and check-out is at 11:00 a.m.',
            'El check-in es a las 3:00 p.m. y el check-out a las 11:00 a.m.'],
        ['que horas é o check-out?', 'en',
            'Check-out is at 11:00 a.m. and check-in is at 3:00 p.m.',
            'O check-out é às 11:00 a.m. e o check-in às 3:00 p.m.'],
        ['à quelle heure est le check-in ?', 'en',
            'Check-in is at 3:00 p.m. and check-out is at 11:00 a.m.',
            "Le check-in est à 3:00 p.m. et le check-out à 11:00 a.m."],
        ['what time is check-in?', 'es',
            'El check-in es a las 3:00 p.m. y el check-out a las 11:00 a.m.',
            'Check-in is at 3:00 p.m. and check-out is at 11:00 a.m.'],
        // A short reply, judged as a whole.
        ['a qué hora es el check-in?', 'en', 'Check-in is at 3:00 p.m.', 'El check-in es a las 3:00 p.m.'],
    ];

    it.each(TURNS)('«%s» after %s: decided in the customer\'s language and the reply rewritten', async (message, previous, reply, rewrite) => {
        for (const context of CONTEXTS(previous)) expect(detector.detect(message, previous, previous, context)).not.toBe(previous);
        const lang = detector.detect(message, previous, previous, { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' });
        const { service, execute } = build(rewrite);
        expect(await run(service, reply, lang, message)).toBe(rewrite);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it.each(TURNS)('«%s» (after %s): a reply already in the customer\'s language is left alone', async (message, previous, _reply, inLanguage) => {
        const lang = detector.detect(message, previous, previous, { names: NAMES });
        const { service, execute } = build('should not be used');
        expect(await run(service, inLanguage, lang, message)).toBe(inLanguage);
        expect(execute).not.toHaveBeenCalled();
    });

    it('a reply saying the agent does not speak the customer\'s language is answered, never sent', async () => {
        const message = 'a qué hora es el check-in?';
        const lang = detector.detect(message, 'en', 'en', { names: NAMES });
        expect(lang).toBe('es');
        const answer = 'El check-in es a las 3:00 p.m. y el check-out a las 11:00 a.m.';
        const { service, execute } = build(answer);
        const out = await run(service, "Sorry, I don't speak Spanish. Check-in is at 3:00 p.m.", lang, message);
        expect(out).toBe(answer);
        expect(out).not.toMatch(/speak|no hablo/i);
        expect(execute).toHaveBeenCalled();
    });
});
