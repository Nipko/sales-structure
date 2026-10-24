import { ConversationsService } from './conversations.service';
import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 after #198 and #201 (production 24-oct, image 7f375dd8, Telegram, one conversation reused across cases): a short
 * message plainly NOT in the previous case's language was answered in that language:
 *  - dental, after French: «precio de la consulta especializada?» → «Le prix de la consulta especializada n'est pas confirmé…»
 *  - restaurant, after English: «qual o prato mais barato?» → English
 *  - salon, after Spanish: «horário de sábado?» → Spanish
 *  - hotel, after English: «hora de entrada?» → English
 *  - travel, after English: «quando sai o Spark QA Tour?» → English
 *  - restaurant, after Spanish: «quantos pedidos eu já fiz aí?» → Spanish
 * Each is built of words two languages share («de», «la», «mais», «hora», «entrada») or that no list knew («quando», «sai»,
 * «fiz», «horário», «já», «aí»), so no rule found ONE language and the stored one stayed — although none of them is a
 * message the stored language could be written in.
 */
const detector = new LanguageDetectorService();
const RECENT: Record<string, string[]> = {
    es: ['hola, quiero información', '¿cuánto cuesta el envío?', 'gracias'],
    en: ['hello, I would like some information', 'what are your opening hours?', 'thank you'],
    pt: ['olá, quero informações', 'quanto custa o frete?', 'obrigado'],
    fr: ['bonjour, je voudrais des informations', 'quels sont vos horaires ?', 'merci beaucoup'],
};
const NAMES = ['Spark QA Tour', 'Consulta especializada', 'Spark QA Plato'];

const CASES: Array<[string, string, string]> = [
    ['precio de la consulta especializada?', 'fr', 'es'],
    ['qual o prato mais barato?', 'en', 'pt'],
    ['horário de sábado?', 'es', 'pt'],
    ['hora de entrada?', 'en', 'es'],
    ['quando sai o Spark QA Tour?', 'en', 'pt'],
    ['quantos pedidos eu já fiz aí?', 'es', 'pt'],
];

describe('F4300-16: the current message decides the turn language over the previous case', () => {
    it.each(CASES)('«%s» after a %s case is %s, and the switch is persisted', (text, previous, expected) => {
        for (const context of [
            undefined,
            { recentCustomerMessages: RECENT[previous] },
            { recentCustomerMessages: RECENT[previous], names: NAMES },
            { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' },
        ]) {
            expect(detector.detectDetailed(text, previous, previous, context)).toEqual({ language: expected, persist: true });
        }
    });

    it('a message two languages may be in, neither of them the stored one, follows the tenant language', () => {
        expect(detector.detect('hora de entrada?', 'en', 'en', { preferred: 'pt-BR' })).toBe('pt');
        expect(detector.detect('hora de entrada?', 'en', 'en', { preferred: 'es-CO' })).toBe('es');
        expect(detector.detect('hora de entrada?', 'fr', 'fr', { preferred: 'en' })).toBe('es');
    });

    it.each([
        // The stored language may be written this way: it stays.
        ['hora de entrada?', 'es'], ['hora de entrada?', 'pt'], ['consulta general', 'pt'], ['consulta general', 'es'],
        ['precio de la consulta especializada?', 'es'], ['qual o prato mais barato?', 'pt'],
        // Too short or neutral: «ok», «gracias», a lone word or two.
        ['ok', 'en'], ['gracias', 'pt'], ['gracias?', 'en'], ['muchas gracias', 'en'], ['uma consulta', 'es'], ['a consulta', 'pt'],
        ['precio?', 'en'], ['hora?', 'en'], ['de la', 'en'],
        // A message around a name, or mixing two languages.
        ['Hotel Aurora con las vistas al mar', 'en'], ['Plan Aurora el sabado por favor', 'en'], ['quiero ver el menu please', 'en'],
        ['delivery precio?', 'en'], ['tenho una duda', 'es'],
    ])('«%s» keeps the stored %s', (text, stored) => {
        expect(detector.detectDetailed(text, stored, stored)).toEqual({ language: stored, persist: true });
    });
});

describe('F4300-16: the reply guard catches a reply in the previous case\'s language', () => {
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

    const REPLIES: Record<string, [string, string]> = {
        'precio de la consulta especializada?': [
            "Le prix de la consulta especializada n'est pas confirmé pour le moment, je peux vérifier avec l'équipe.",
            'El precio de la consulta especializada no está confirmado por ahora, puedo verificarlo con el equipo.'],
        'qual o prato mais barato?': [
            'The cheapest dish on our menu is the Spark QA Plato, and it is available today.',
            'O prato mais barato do nosso cardápio é o Spark QA Plato, e está disponível hoje.'],
        'horário de sábado?': [
            'Los sábados atendemos de 9:00 a 14:00, ¿quieres que te agende una cita?',
            'Aos sábados atendemos das 9:00 às 14:00, quer que eu agende um horário?'],
        'hora de entrada?': [
            'Check-in time is from 15:00, and early check-in depends on availability.',
            'La hora de entrada es a partir de las 15:00, y la entrada anticipada depende de la disponibilidad.'],
        'quando sai o Spark QA Tour?': [
            'The Spark QA Tour departs every day at 08:00 from our main office.',
            'O Spark QA Tour sai todos os dias às 08:00 do nosso escritório principal.'],
        'quantos pedidos eu já fiz aí?': [
            'Según nuestro registro, tienes 3 pedidos con nosotros hasta ahora.',
            'Segundo o nosso registro, você tem 3 pedidos conosco até agora.'],
    };

    it.each(CASES)('«%s» after %s: the reply in the previous language is rewritten into %s', async (message, previous, expected) => {
        const lang = detector.detect(message, previous, previous, { recentCustomerMessages: RECENT[previous], names: NAMES, preferred: 'es-CO' });
        expect(lang).toBe(expected);
        const [reply, rewrite] = REPLIES[message];
        const { service, execute } = build(rewrite);
        expect(await run(service, reply, lang, message, { catalog: [{ title: 'Spark QA Plato' }, { title: 'Spark QA Tour' }] })).toBe(rewrite);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it.each(CASES)('«%s» (after %s): a reply already in %s is left alone', async (message, _previous, expected) => {
        const [, inLanguage] = REPLIES[message];
        const { service, execute } = build('should not be used');
        expect(await run(service, inLanguage, expected, message, { catalog: [{ title: 'Spark QA Plato' }, { title: 'Spark QA Tour' }] })).toBe(inLanguage);
        expect(execute).not.toHaveBeenCalled();
    });
});
