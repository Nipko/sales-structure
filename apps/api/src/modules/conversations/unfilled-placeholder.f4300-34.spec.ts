import { ConversationsService } from './conversations.service';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import {
    emergencyFallbackText, findUnbackedContacts, findUnfilledPlaceholders, guardUnfilledPlaceholders, hasUnfilledPlaceholder, placeholderFallbackText,
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
        expect(guardUnfilledPlaceholders({ reply, lang: 'es', sources: ['<menu_url>https://example.com/menu</menu_url>'] })).toEqual({ changed: false, text: reply, action: 'none', placeholders: [], contacts: [] });
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
    const FAQ_SYSTEM = '<faq>¿Qué hago en una urgencia fuera de horario? Acude al servicio de urgencias más cercano o llama a la línea de emergencias de tu ciudad.</faq><menu_url>https://example.com/menu</menu_url>';
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

/**
 * F4300-34 residual (production 25-oct, the same dental tenant, no emergency phone configured):
 *  - PT «quebrei um dente e dói muito, o que faço?» → «…por favor ligue para o número de plantão: 123-456-7890.» (an INVENTED phone);
 *  - ES «se me partió una muela…» → «¿Quiere que le proporcione el número de guardia para emergencias…?» (an OFFER of a number
 *    that does not exist).
 * A contact detail (phone, national emergency number, e-mail, link, handle) or an offer of a phone the business data does not
 * hold goes like a placeholder; for an emergency, the local-emergency text, never a number.
 */
const DENTAL_FAQ = '<business><name>Clínica Dental QA</name><city>Bogotá</city></business><faq>¿Qué hago en una urgencia fuera de horario? Acude al servicio de urgencias más cercano o llama a la línea de emergencias de tu ciudad.</faq>';
const INVENTED_PHONE: Array<[string, string, string]> = [
    ['pt', 'quebrei um dente e dói muito, o que faço?',
        'Para emergências odontológicas fora do nosso horário de atendimento, por favor ligue para o número de plantão: 123-456-7890.'],
    ['es', 'se me partió una muela y me duele mucho, ¿qué hago?',
        'Para emergencias odontológicas fuera de nuestro horario de atención, por favor llame al número de guardia: 123-456-7890.'],
    ['en', 'I broke a tooth and it hurts a lot, what should I do?',
        'For dental emergencies outside of our office hours, please call our on-call number: (123) 456-7890.'],
    ['fr', "je me suis cassé une dent et j'ai très mal, que faire ?",
        'Pour les urgences dentaires en dehors de nos horaires, veuillez appeler le numéro de garde : 01 23 45 67 89.'],
];
const NUMBER_OFFER: Array<[string, string, string, string]> = [
    ['es', 'se me partió una muela y me duele mucho, ¿qué hago?',
        'Lamento mucho lo que le pasó. ¿Quiere que le proporcione el número de guardia para emergencias odontológicas?', 'Lamento mucho lo que le pasó.'],
    ['pt', 'quebrei um dente e dói muito, o que faço?',
        'Sinto muito pelo que aconteceu. Quer que eu passe o número de plantão para emergências odontológicas?', 'Sinto muito pelo que aconteceu.'],
    ['en', 'I broke a tooth and it hurts a lot, what should I do?',
        'I am very sorry that happened to you. Would you like me to give you the emergency number for after-hours dental care?', 'I am very sorry that happened to you.'],
    ['fr', "je me suis cassé une dent et j'ai très mal, que faire ?",
        'Je suis vraiment désolé pour ce qui vous arrive. Voulez-vous que je vous donne le numéro de garde pour les urgences dentaires ?', 'Je suis vraiment désolé pour ce qui vous arrive.'],
];

describe('F4300-34 contacts: what is a contact detail the business data does not hold', () => {
    it.each([
        ['Llámenos al 123-456-7890.', '123-456-7890'],
        ['Call (123) 456-7890 now.', '(123) 456-7890'],
        ['Ligue para +55 11 98765-4321.', '+55 11 98765-4321'],
        ['Appelez le 01 23 45 67 89.', '01 23 45 67 89'],
        ['Escríbanos al 3001234567.', '3001234567'],
        ['Si es una emergencia, llame al 123.', '123'],
        ['In an emergency, call 911.', '911'],
        ['Em caso de emergência, ligue 192.', '192'],
        ['Escríbanos a urgencias@clinicadental.com.', 'urgencias@clinicadental.com'],
        ['Más información en https://clinicadental.example/urgencias.', 'https://clinicadental.example/urgencias'],
        ['Escríbanos por WhatsApp: https://wa.me/573001234567.', 'https://wa.me/573001234567'],
        ['Síganos en @clinicadentalqa.', '@clinicadentalqa'],
    ])('«%s» → %s', (text, contact) => {
        expect(findUnbackedContacts(text, [DENTAL_FAQ]).map(hit => hit.text)).toContain(contact);
    });

    it.each([
        'Su pedido 12345678 está en camino.',
        'Su pedido Ref. 5603A623 fue confirmado.',
        'Código de reserva: 98765432.',
        'El total es $1.250.000.',
        'El total es 1.250.000 COP.',
        'O valor é R$ 1.234.567,00.',
        'Son 13.500 pesos por persona.',
        'Su cita es el 24/10/2026 a las 10:00.',
        'Su cita es el 2026-10-24 a las 10:00.',
        'Atendemos de 08:00 a 18:00, de lunes a sábado.',
        'Precios vigentes 2024-2025.',
        'El 15% de descuento aplica hasta el 30.',
        'Llame entre las 15 y las 18 horas.',
        'Tenemos 120 opciones de menú.',
    ])('«%s» has none', text => expect(findUnbackedContacts(text, [DENTAL_FAQ])).toEqual([]));

    it('a phone, e-mail, link, handle or emergency number the business data holds passes, however it is written', () => {
        const business = '<business><phone>+57 300 123 4567</phone><email>citas@clinicadental.com</email><website>https://clinicadental.example</website><instagram>@clinicadentalqa</instagram></business><faq>En una urgencia llame al 123.</faq>';
        expect(findUnbackedContacts('Puede llamarnos al 300 123 4567 o al +573001234567.', [business])).toEqual([]);
        expect(findUnbackedContacts('Escríbanos a citas@clinicadental.com o visite https://clinicadental.example/.', [business])).toEqual([]);
        expect(findUnbackedContacts('Síganos en @clinicadentalqa. Si es una emergencia, llame al 123.', [business])).toEqual([]);
        // the phone of a tool result (a listing, a branch) is data too
        expect(findUnbackedContacts('La sede norte atiende al 601 555 0199.', [{ branches: [{ name: 'Norte', phone: '6015550199' }] }])).toEqual([]);
        // with a phone on file, offering it is fine; without one, the offer is the defect
        expect(findUnbackedContacts('¿Quiere que le proporcione el número de teléfono de la clínica?', [business])).toEqual([]);
        expect(findUnbackedContacts('¿Quiere que le proporcione el número de guardia para emergencias?', [DENTAL_FAQ]).map(hit => hit.kind)).toEqual(['contact_offer']);
    });
});

describe('F4300-34 contacts: the two production replies, es / pt / en / fr, through the guard', () => {
    it.each(INVENTED_PHONE)('[%s] an invented on-call phone → the local-emergency text, no number', (lang, customer, reply) => {
        const out = guardUnfilledPlaceholders({ reply, customerText: customer, lang, sources: [DENTAL_FAQ] });
        expect(out.action).toBe('emergency_fallback');
        expect(out.contacts).toHaveLength(1);
        expect(out.text).toBe(emergencyFallbackText(lang));
        expect(out.text).not.toMatch(/\d/);
    });

    it.each(NUMBER_OFFER)('[%s] an offer of an emergency number not on file → removed, the local-emergency text in its place', (lang, customer, reply, kept) => {
        const out = guardUnfilledPlaceholders({ reply, customerText: customer, lang, sources: [DENTAL_FAQ] });
        expect(out.action).toBe('emergency_fallback');
        expect(out.text).toBe(`${kept} ${emergencyFallbackText(lang)}`);
    });

    it('the same replies with the phone on file are sent as written', () => {
        const business = `${DENTAL_FAQ}<business><phone>123-456-7890</phone></business>`;
        expect(guardUnfilledPlaceholders({ reply: INVENTED_PHONE[0][2], customerText: INVENTED_PHONE[0][1], lang: 'pt', sources: [business] }).changed).toBe(false);
        expect(guardUnfilledPlaceholders({ reply: NUMBER_OFFER[0][2], customerText: NUMBER_OFFER[0][1], lang: 'es', sources: [business] }).changed).toBe(false);
    });

    it('an invented phone outside an emergency: the sentence goes, the rest stands', () => {
        const out = guardUnfilledPlaceholders({ reply: 'Abrimos de lunes a viernes de 8:00 a 18:00. Para agendar llame al 601 555 0199.', customerText: '¿horario?', lang: 'es', sources: [DENTAL_FAQ] });
        expect(out.action).toBe('removed');
        expect(out.text).toBe('Abrimos de lunes a viernes de 8:00 a 18:00.');
    });
});

describe('F4300-34 contacts through applyOutputGuardrails and an Agent Test turn', () => {
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
    const guard = (s: any, system: string, reply: string, customer: string, lang: string) =>
        s.applyOutputGuardrails(reply, system, [{ role: 'user', content: customer }], [], 'synthetic-tenant', 'synthetic-conversation', [], lang, [], {});

    it.each(INVENTED_PHONE)('[%s] the invented phone never reaches the customer; unbacked_contact is recorded', async (lang, customer, reply) => {
        const s = service();
        expect(await guard(s, DENTAL_FAQ, reply, customer, lang)).toBe(emergencyFallbackText(lang));
        expect(s.recordAgentSignal).toHaveBeenCalledWith('synthetic-tenant', 'unbacked_contact', undefined, expect.objectContaining({ action: 'emergency_fallback' }));
    });

    it.each(NUMBER_OFFER)('[%s] the offer of a number not on file never reaches the customer', async (lang, customer, reply, kept) => {
        const s = service();
        expect(await guard(s, DENTAL_FAQ, reply, customer, lang)).toBe(`${kept} ${emergencyFallbackText(lang)}`);
    });

    it.each([
        'Puede llamarnos al 300 123 4567, de lunes a viernes.',
        'Su pedido 12345678 por $1.250.000 llega el 24/10/2026 a las 10:00.',
    ])('«%s» with the phone in the business info passes untouched', async reply => {
        const s = service();
        expect(await guard(s, `${DENTAL_FAQ}<business><phone>+57 300 123 4567</phone></business>`, reply, 'hola', 'es')).toBe(reply);
        expect(s.recordAgentSignal).not.toHaveBeenCalledWith('synthetic-tenant', 'unbacked_contact', undefined, expect.anything());
    });

    function dental(language: string, reply: string) {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 3, config_json: { language, industry: 'salud', rag: { enabled: false }, llm: {} } });
        f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'salud', subType: 'dental' });
        f.llmRouter.execute.mockImplementation(async (request: any) => ({
            content: ['conversation', 'tool_calling'].includes(request.task) ? reply : '{}',
            model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0,
        }));
        const signal = jest.spyOn(f.runtime as any, 'recordAgentSignal');
        return { signal, turn: (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined }) };
    }

    it.each(INVENTED_PHONE)('[%s] Agent Test turn: the invented phone is replaced by the local-emergency text', async (lang, customer, reply) => {
        const { signal, turn } = dental(lang, reply);
        const r = await turn(customer);
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).not.toMatch(/456|45 67/);
        expect(r.reply).toContain(emergencyFallbackText(lang));
        expect(signal).toHaveBeenCalledWith('tenant', 'unbacked_contact', expect.anything(), expect.objectContaining({ action: 'emergency_fallback' }));
    });

    it.each(NUMBER_OFFER)('[%s] Agent Test turn: the offer of a number that does not exist is replaced', async (lang, customer, reply) => {
        const { turn } = dental(lang, reply);
        const r = await turn(customer);
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).not.toContain(reply.split('. ')[1]);
        expect(r.reply).toContain(emergencyFallbackText(lang));
    });

    it('the prompt forbids offering a number that is not on file', async () => {
        const { turn } = dental('es', 'Acuda al servicio de urgencias más cercano.');
        const r = await turn('se me partió una muela');
        expect(r.debug.systemPrompt).toContain('Never promise, give or OFFER one that is not there');
        expect(r.debug.systemPrompt).toContain('¿quiere que le proporcione el número de guardia?');
    });
});
