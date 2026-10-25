import { ConversationsService } from './conversations.service';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import {
    emergencyFallbackText, findUnfilledPlaceholders, guardUnfilledPlaceholders, hasUnfilledPlaceholder, placeholderFallbackText,
} from './unfilled-placeholder';

/**
 * F4300-34 (high, safety; dental tenant, 2026-10-24). Customer: «I broke a tooth and it hurts a lot, what should I do?». The
 * agent's second message, sent: «For dental emergencies outside of our regular hours, please call the emergency guard at this
 * number: [emergency contact number]. If you need anything else, I am here to help.» The tenant has no emergency phone; its FAQ
 * says «acude al servicio de urgencias más cercano o llama a la línea de emergencias de tu ciudad». An unfilled slot never
 * leaves: its sentence goes, or the reply is the fixed text; for an emergency, the nearest emergency service / the local
 * emergency number, never a number of our own.
 */
const CUSTOMER_EN = 'I broke a tooth and it hurts a lot, what should I do?';
const PRODUCTION_EN = 'For dental emergencies outside of our regular hours, please call the emergency guard at this number: [emergency contact number]. If you need anything else, I am here to help.';

const VARIANTS: Array<[string, string, string]> = [
    ['en', CUSTOMER_EN, PRODUCTION_EN],
    ['es', 'Se me rompió un diente y me duele mucho, ¿qué hago?',
        'Para emergencias dentales fuera de nuestro horario, por favor llame a la guardia de emergencias a este número: [número de teléfono de emergencia]. Si necesita algo más, estoy aquí para ayudarle.'],
    ['pt', 'Quebrei um dente e está doendo muito, o que eu faço?',
        'Para emergências odontológicas fora do nosso horário, ligue para o plantão de emergência neste número: [número de contato de emergência]. Se precisar de mais alguma coisa, estou aqui para ajudar.'],
    ['fr', "Je me suis cassé une dent et j'ai très mal, que dois-je faire ?",
        "Pour les urgences dentaires en dehors de nos horaires, veuillez appeler la garde d'urgence à ce numéro : [numéro de contact d'urgence]. Si vous avez besoin d'autre chose, je suis là pour vous aider."],
];

/** The fixed emergency text: local emergency services, no number, no slot. */
const EMERGENCY_WORDS: Record<string, RegExp> = {
    en: /nearest emergency service or call your local emergency number/,
    es: /servicio de urgencias más cercano o llame a la línea de emergencias de su localidad/,
    pt: /serviço de emergência mais próximo ou ligue para o número de emergência da sua localidade/,
    fr: /service d'urgences le plus proche ou appelez le numéro d'urgence local/,
};
const expectSafeEmergency = (text: string, lang: string) => {
    expect(text).toMatch(EMERGENCY_WORDS[lang]);
    expect(text).not.toMatch(/[[\]{}<>]/);
    expect(text).not.toMatch(/\d/);
    expect(hasUnfilledPlaceholder(text)).toBe(false);
};

describe('F4300-34 detection: what is an unfilled placeholder', () => {
    it.each([
        '[emergency contact number]', '[número de teléfono]', '[nombre]', '[address]', '[Nombre del cliente]', '[su correo electrónico]',
        '[insert phone]', '[NOMBRE]', '[link]', '[endereço]', '[adresse]', '[numéro de téléphone]',
        '{{phone}}', '{{ customer.name }}', '{phone}', '{nombre_cliente}',
        '<insert address>', '<inserte el teléfono>', '<su correo>', '<numéro de téléphone>',
        'XXX-XXXX', '(XXX) XXX-XXXX', '+57 XXX XXX XXXX', '###-####', 'xxxxxxx',
    ])('«Puede escribirnos: %s» is a placeholder', slot => {
        const hits = findUnfilledPlaceholders(`Puede escribirnos: ${slot}`);
        expect(hits.map(hit => hit.text.trim())).toEqual([slot.trim()]);
    });

    it.each([
        'Su pedido Ref. [5603A623] fue confirmado.',
        'Según nuestras políticas [1], el reembolso tarda 5 días [2].',
        'Puede ver el menú aquí: [Ver menú](https://example.com/menu).',
        'Consulte [la política][1] antes de pagar.',
        'Escribió «muy buen servicio [sic]».',
        'El texto dice «[…] y más».',
        'Tenemos tallas XS, S, M, L, XL y XXL.',
        'La talla XXL cuesta $45.000.',
        'Su cita es el martes a las 10:00 (Ref. AE3D0C86).',
        'Use **negrita** y <b>etiquetas</b> si quiere.',
        'Código de reserva: [AB12CD].',
        'Combo [2 personas] por $30.000.',
        'Llámenos al +57 300 123 4567.',
        '[ ]',
        'Menú completo abajo.\n[menu]: https://example.com/menu',
    ])('«%s» has none', text => expect(findUnfilledPlaceholders(text)).toEqual([]));

    it('a bracketed name the business data writes bracketed is data; a slot word is a slot wherever it is', () => {
        const catalog = [{ items: [{ name: 'Pizza [Vegana]', price: 30000 }] }];
        expect(findUnfilledPlaceholders('La Pizza [Vegana] cuesta $30.000.', catalog)).toEqual([]);
        expect(findUnfilledPlaceholders('La Pizza [Vegana] cuesta $30.000.', [])).toHaveLength(1);
        // a template the tenant left in its own FAQ is still a slot
        expect(findUnfilledPlaceholders('Llame al [número de teléfono].', ['FAQ: llame al [número de teléfono]'])).toHaveLength(1);
    });
});

describe('F4300-34 guard: the production reply and its es / pt / fr variants', () => {
    it.each(VARIANTS)('[%s] the emergency sentence with the slot is replaced by the local-emergency text', (lang, customer, reply) => {
        const out = guardUnfilledPlaceholders({ reply, customerText: customer, lang, canOfferPerson: true });
        expect(out.changed).toBe(true);
        expect(out.action).toBe('emergency_fallback');
        expect(out.placeholders).toHaveLength(1);
        expect(out.text).toBe(emergencyFallbackText(lang));
        expectSafeEmergency(out.text, lang);
    });

    it('the rest of the reply stands on its own: only the sentence with the slot goes', () => {
        const out = guardUnfilledPlaceholders({
            reply: 'Nuestro horario es de lunes a viernes de 8:00 a 18:00. Para más información escríbanos a [correo electrónico]. ¿Desea agendar una cita?',
            customerText: '¿cuál es el horario?', lang: 'es',
        });
        expect(out.action).toBe('removed');
        expect(out.text).toBe('Nuestro horario es de lunes a viernes de 8:00 a 18:00. ¿Desea agendar una cita?');
    });

    it('an emergency sentence removed while the rest stands is replaced in place by the safe emergency sentence', () => {
        const out = guardUnfilledPlaceholders({
            reply: 'Lamento mucho lo de su diente. Si el dolor es intenso, llame a nuestra línea de urgencias: [teléfono de urgencias]. Mañana tenemos citas desde las 8:00.',
            customerText: 'me duele una muela', lang: 'es',
        });
        expect(out.action).toBe('emergency_fallback');
        expect(out.text).toBe(`Lamento mucho lo de su diente. ${emergencyFallbackText('es')} Mañana tenemos citas desde las 8:00.`);
    });

    it('a line that only introduced the slot goes with it', () => {
        const out = guardUnfilledPlaceholders({
            reply: 'Abrimos de 9:00 a 17:00 de lunes a sábado.\nPuede contactarnos aquí:\n[número de WhatsApp]',
            customerText: 'horario?', lang: 'es',
        });
        expect(out.text).toBe('Abrimos de 9:00 a 17:00 de lunes a sábado.');
    });

    it('only courtesy left and no emergency: the fixed «not confirmed» text, with a person only when one can be reached', () => {
        const reply = 'Puede escribirnos a [correo electrónico]. Si necesita algo más, estoy aquí para ayudarle.';
        expect(guardUnfilledPlaceholders({ reply, customerText: '¿cuál es su correo?', lang: 'es', canOfferPerson: true }).text).toBe(placeholderFallbackText('es', true));
        expect(guardUnfilledPlaceholders({ reply, customerText: '¿cuál es su correo?', lang: 'es', canOfferPerson: false }).text).toBe(placeholderFallbackText('es', false));
        expect(guardUnfilledPlaceholders({ reply: 'Our address is <insert address>.', customerText: 'where are you?', lang: 'en' }).action).toBe('fallback');
    });

    it('a name slot in a greeting is taken out of its sentence, the sentence stays', () => {
        expect(guardUnfilledPlaceholders({ reply: 'Hola [nombre], su cita es el martes a las 10:00.', lang: 'es' }).text).toBe('Hola, su cita es el martes a las 10:00.');
        expect(guardUnfilledPlaceholders({ reply: 'Olá {{nome}}! Sua consulta é amanhã às 9:00.', lang: 'pt' }).text).toBe('Olá! Sua consulta é amanhã às 9:00.');
    });

    it('a dummy number takes its sentence with it', () => {
        const out = guardUnfilledPlaceholders({ reply: 'Tenemos disponibilidad el lunes a las 10:00. Llámenos al (XXX) XXX-XXXX para confirmar.', lang: 'es' });
        expect(out.text).toBe('Tenemos disponibilidad el lunes a las 10:00.');
    });

    it('a reply with no slot is returned untouched, whatever brackets it legitimately uses', () => {
        const reply = 'Su pedido Ref. [5603A623] está en camino [1]. Vea el menú: [Ver menú](https://example.com/menu).';
        expect(guardUnfilledPlaceholders({ reply, lang: 'es' })).toEqual({ changed: false, text: reply, action: 'none', placeholders: [] });
    });
});

describe('F4300-34 through applyOutputGuardrails', () => {
    function service() {
        const s: any = Object.create(ConversationsService.prototype);
        s.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
        s.eventEmitter = { emit: jest.fn() };
        s.recordAgentSignal = jest.fn();
        s.alignReplyLanguage = jest.fn(async (reply: string) => reply);
        s.responseValidator = { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) };
        s.llmRouter = { execute: jest.fn(async () => { throw new Error('no model call expected'); }) };
        return s;
    }
    const FAQ_SYSTEM = '<faq>¿Qué hago en una urgencia fuera de horario? Acude al servicio de urgencias más cercano o llama a la línea de emergencias de tu ciudad.</faq>';
    const guard = (s: any, reply: string, customer: string, lang: string, context: any = {}) =>
        s.applyOutputGuardrails(reply, FAQ_SYSTEM, [{ role: 'user', content: customer }], [], 'synthetic-tenant', 'synthetic-conversation', [], lang, [], context);

    it.each(VARIANTS)('[%s] the production reply never reaches the customer with its slot; the signal is recorded', async (lang, customer, reply) => {
        const s = service();
        const context: any = {};
        const out = await guard(s, reply, customer, lang, context);
        expect(out).toBe(emergencyFallbackText(lang));
        expectSafeEmergency(out, lang);
        expect(s.recordAgentSignal).toHaveBeenCalledWith('synthetic-tenant', 'unfilled_placeholder', undefined,
            expect.objectContaining({ action: 'emergency_fallback', placeholders: [expect.stringMatching(/^\[.+\]$/)] }));
    });

    it.each([
        'Su pedido Ref. [5603A623] fue confirmado y llega hoy.',
        'Según la política [1], el reembolso tarda 5 días hábiles.',
        'Puede ver el menú aquí: [Ver menú](https://example.com/menu).',
    ])('«%s» is sent as written, no signal', async reply => {
        const s = service();
        expect(await guard(s, reply, 'hola', 'es')).toBe(reply);
        expect(s.recordAgentSignal).not.toHaveBeenCalledWith('synthetic-tenant', 'unfilled_placeholder', undefined, expect.anything());
    });
});

describe('F4300-34 through a ConversationsService Agent Test turn (dental, no emergency phone on file)', () => {
    function dental(language: 'es' | 'en' | 'pt' | 'fr', reply: string) {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 3, config_json: { language, industry: 'salud', rag: { enabled: false }, llm: {} } });
        f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'salud', subType: 'dental' });
        f.llmRouter.execute.mockImplementation(async (request: any) => ({
            content: ['conversation', 'tool_calling'].includes(request.task) ? reply : '{}',
            model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0,
        }));
        const signal = jest.spyOn(f.runtime as any, 'recordAgentSignal');
        return { f, signal, turn: (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined }) };
    }

    it.each(VARIANTS)('[%s] the customer gets the local-emergency text, the turn trace carries unfilled_placeholder', async (lang, customer, reply) => {
        const { signal, turn } = dental(lang as any, reply);
        const r = await turn(customer);
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).not.toContain('[');
        expect(r.reply).toContain(emergencyFallbackText(lang));
        expectSafeEmergency(r.reply, lang);
        expect(signal).toHaveBeenCalledWith('tenant', 'unfilled_placeholder', expect.anything(), expect.objectContaining({ action: 'emergency_fallback' }));
    });

    it('the prompt tells the model never to promise a contact detail that is not on file nor to write a slot', async () => {
        const { f, turn } = dental('en', 'Please go to the nearest emergency service.');
        const r = await turn(CUSTOMER_EN);
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).toBe('Please go to the nearest emergency service.');
        const prompt = String(r.debug.systemPrompt || f.llmRouter.execute.mock.calls.map(([request]: any[]) => JSON.stringify(request.messages)).join('\n'));
        expect(prompt).toContain('CONTACT AND EMERGENCY DETAILS');
        expect(prompt).toContain('never write a slot to be filled in later');
    });
});
