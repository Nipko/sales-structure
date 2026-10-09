import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { randomUUID } from 'crypto';
import { ConversationsService } from './conversations.service';

/**
 * Production 2026-10-08 (appointments tenant, Telegram), three defects that together broke a booking:
 *  1. «sí, confírmala» was not consent at the confirmation step, so the customer was shown the same summary again;
 *  2. in that re-ask turn the model had no tools and wrote «<create_appointment><service_id>…» (DeepSeek: a DSML
 *     block) as its reply, which went to the customer and into the history;
 *  3. the wait-promise guard did not see «Estoy gestionando la confirmación… Te avisaré» (it has digits).
 * Replayed through the whole turn: every markup shape never reaches the customer, the engine text wins, and only a
 * real consent books (exactly once).
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORTE = { id: '11111111-1111-4111-8111-111111111111', name: 'Corte y estilo', durationMinutes: 45, price: 40000, priceStatus: 'confirmed', currency: 'COP' };
const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
const ASK_AGAIN = '¿Confirmo la cita? Responda sí o no.';

const MARKUP_SHAPES: Array<[string, string]> = [
    ['plain tag', '<create_appointment><service_id>11111111-1111-4111-8111-111111111111</service_id><date>2027-01-05</date><time>16:00</time><customer_email>joaquin@example.com</customer_email></create_appointment>'],
    ['DeepSeek DSML', 'Estoy gestionando la confirmación de su cita…\n\n<｜｜DSML｜｜ invoke name="create_appointment">\n<｜｜DSML｜｜ parameter name="service_id" string="true">11111111-1111-4111-8111-111111111111</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>'],
    ['invoke / parameter', '<invoke name="create_appointment"><parameter name="service_id">11111111-1111-4111-8111-111111111111</parameter></invoke>'],
    ['function_calls', '<function_calls><invoke name="create_appointment"><parameter name="date">2027-01-05</parameter></invoke></function_calls>'],
    ['tool_call JSON', '<tool_call>{"name":"create_appointment","arguments":{"date":"2027-01-05"}}</tool_call>'],
    ['DeepSeek tool tokens', '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>create_appointment<｜tool▁sep｜>{"date":"2027-01-05"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>'],
];

function fixture() {
    const f = agentTurnFixture();
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'salon', tools: { appointments: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'salon', subType: 'belleza' });
    publishTools(f, ['list_services', 'check_availability', 'create_appointment', 'search_faqs']);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'list_services') return { services: [CORTE] };
        if (name === 'check_availability') return { available: true, slots: [{ time: '16:00', endTime: '16:45' }, { time: '17:00', endTime: '17:45' }] };
        if (name === 'create_appointment') return { success: true, appointment: { id: 'apt-1', status: 'confirmed' } };
        if (name === 'search_faqs') return { results: [] };
        throw new Error(`Unexpected tool: ${name}`);
    });
    let id: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, {
            evalMode: true, sandboxContactId: '00000000-0000-4000-8000-00000000eba1', sandboxConversationId: conversationId,
            sandboxNamespace: namespace, sandboxInboundMessageId: randomUUID(),
        });
        id = result.debug.runtimeSessionId;
        return result;
    };
    const session = (): AgentTurnSession => (f.service as any).sessions.sessions.get(id).session;
    const writes = () => f.toolExecutor.execute.mock.calls.filter((call: any[]) => call[3] === 'create_appointment');
    /** A real conversation up to the confirmation summary (the engine holds name, e-mail and the confirmation id). */
    const toConfirm = async () => {
        await turn('hola');
        await turn('Quiero agendar Corte y estilo');
        await turn('el 5 de enero a las 16:00');
        await turn('Joaquin Sosa');
        await turn('joaquin@example.com');
        expect(session().metadata.bookingState).toMatchObject({ step: 'confirm', serviceId: CORTE.id });
    };
    return { f, turn, session, writes, toConfirm };
}

const noMarkup = (text: string) => !/[<>]|DSML|create_appointment|service_id|invoke|parameter/.test(text);


// The scenarios below are dated against a calendar and the turn reads the real clock: pinned, so they do not turn red the day
// they were written for goes by (see __fixtures__/pinned-clock.ts). Only Date is faked.
pinClock();
describe('a tool call written as text never reaches the customer or the history', () => {
    it.each(MARKUP_SHAPES)('at the confirmation re-ask (%s): the engine text is the reply, nothing is booked', async (_label, markup) => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockResolvedValue(answer(markup));
        const result = await h.turn('sí, pero déjeme pensarlo');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe(ASK_AGAIN);
        expect(h.writes()).toHaveLength(0);
        expect(h.session().history.every(row => noMarkup(row.content))).toBe(true);
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'confirm' });
    });

    it.each(MARKUP_SHAPES)('in a plain turn with tools (%s): one retry with the tool interface, then the honest fixed text', async (label, markup) => {
        const h = fixture();
        await h.turn('hola');
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute.mockResolvedValue(answer(markup));
        const result = await h.turn('¿dónde están ubicados?');
        expect(noMarkup(result.reply)).toBe(true);
        expect(h.writes()).toHaveLength(0);
        // The first answer and the retry: never a third call for it.
        const modelCalls = h.f.llmRouter.execute.mock.calls.filter((call: any[]) => (call[0].messages || []).length > 0);
        expect(modelCalls.length).toBeLessThanOrEqual(3);
        // A plain question: no action was asked, so the text must not claim that an action failed.
        // (the DSML shape carries a sentence that still promises work: that one is the action-not-done text)
        if (label === 'DeepSeek DSML') expect(result.reply).toMatch(/no he podido completar esa acción/i);
        else {
            expect(result.reply).toMatch(/no pude responderle/i);
            expect(result.reply).not.toMatch(/acción/i);
        }
        expect(h.session().history.every(row => noMarkup(row.content))).toBe(true);
    });


    it('the retry gets a chance: a clean second answer is the reply', async () => {
        const h = fixture();
        await h.turn('hola');
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute
            .mockResolvedValueOnce(answer('<create_appointment><service_id>x</service_id></create_appointment>'))
            .mockResolvedValue(answer('Con gusto. Tenemos corte y estilo; ¿para qué día le gustaría agendar?'));
        const result = await h.turn('¿dónde están ubicados?');
        expect(result.reply).toContain('Tenemos corte y estilo');
        expect(h.writes()).toHaveLength(0);
    });
});

describe('only a real consent books, and exactly once', () => {
    it.each(['sí', 'sí, confírmala', 'si, agéndala', 'dale, agéndala', 'sí, agéndala', 'sí por favor'])(
        '"%s" books once', async text => {
            const h = fixture();
            await h.toConfirm();
            const result = await h.turn(text);
            expect(result.debug.runtimeError).toBeUndefined();
            expect(h.writes()).toHaveLength(1);
            expect(h.session().metadata.bookingState).toMatchObject({ step: 'booked' });
        });

    it.each(['sí, pero mañana', 'no, confírmala después', 'sí, si hay descuento', 'sí? cuánto cuesta'])(
        '"%s" books nothing', async text => {
            const h = fixture();
            await h.toConfirm();
            await h.turn(text);
            expect(h.writes()).toHaveLength(0);
            expect(h.session().metadata.bookingState.step).not.toBe('booked');
        });

    it('a re-ask at confirm tells the model it cannot book this turn, and a promise of work is replaced by the engine text', async () => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute.mockResolvedValue(answer('Estoy gestionando la confirmación de su cita del 5 de enero a las 16:00. Le avisaré en cuanto esté lista.'));
        const result = await h.turn('sí, pero déjeme pensarlo');
        expect(result.reply).toBe(ASK_AGAIN);
        const prompt = h.f.llmRouter.execute.mock.calls.map((call: any[]) => String(call[0].systemPrompt ?? '')).find((text: string) => text.includes('IMPORTANT')) ?? '';
        expect(prompt).toMatch(/nothing is booked in this turn and you cannot book in it/i);
        expect(prompt).toMatch(/explicit yes or no/i);
        expect(prompt).toMatch(/also asks something, answer it briefly/i);
    });

    it('«sí, si hay descuento» does not drop the question: the model answers it and the summary is asked again', async () => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute.mockResolvedValue(answer('No tengo información de descuentos para este servicio. Su cita de Corte y estilo es el 5 de enero a las 16:00. ¿La confirmo?'));
        const result = await h.turn('sí, si hay descuento');
        expect(result.reply).toContain('No tengo información de descuentos');
        expect(result.reply).not.toBe(ASK_AGAIN);
        expect(h.writes()).toHaveLength(0);
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'confirm' });
    });

    it.each(['sí, y el descuento', 'sí, con descuento', 'sí, pero el precio'])('"%s" is a yes carrying a question: the model answers it, nothing is booked', async text => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute.mockResolvedValue(answer('No tengo información de descuentos para este servicio. Su cita de Corte y estilo es el 5 de enero a las 16:00. ¿La confirmo?'));
        const result = await h.turn(text);
        expect(result.reply).toContain('No tengo información de descuentos');
        expect(result.reply).not.toBe(ASK_AGAIN);
        expect(h.writes()).toHaveLength(0);
    });

    it('ok/listo/dale/perfecto + a booking verb still book at the summary', async () => {
        for (const text of ['ok, agéndala', 'listo, márcala', 'dale, resérvala', 'perfecto, hazla', 'ok, márcalo', 'vale, confírmala']) {
            const h = fixture();
            await h.toConfirm();
            await h.turn(text);
            expect({ text, writes: h.writes().length }).toEqual({ text, writes: 1 });
        }
    });
});

describe('what is left of a reply once its tool call is removed', () => {
    const service: any = Object.create(ConversationsService.prototype);
    const clean = (text: string) => service.cleanToolMarkupReply(text, ['create_appointment'], 'es');
    const FIXED = /no he podido completar esa acción/i;

    it('a plain question that lost its answer is told so, without claiming an action failed', () => {
        const lost = service.cleanToolMarkupReply('<create_appointment><date>1</date></create_appointment>', ['create_appointment'], 'es', false);
        expect(lost).toMatch(/no pude responderle/i);
        expect(lost).not.toMatch(FIXED);
        // a leftover that claims an action is still the "action not done" text, whatever was asked
        expect(service.cleanToolMarkupReply('Estoy procesando su reserva. <create_appointment><date>1</date></create_appointment>', ['create_appointment'], 'es', false)).toMatch(FIXED);
    });

    it('keeps an honest sentence and drops the call', () => {
        expect(clean('Con gusto le ayudo con eso. <create_appointment><date>1</date></create_appointment>')).toBe('Con gusto le ayudo con eso.');
    });

    it.each([
        '<create_appointment><date>1</date></create_appointment>',
        'Estoy gestionando la confirmación de su cita. <create_appointment><date>1</date></create_appointment>',
        'Le avisaré en cuanto esté lista. <create_appointment><date>1</date></create_appointment>',
        '¡Listo, su cita quedó confirmada! <create_appointment><date>1</date></create_appointment>',
        'Un momento, déjeme verificar. <create_appointment><date>1</date></create_appointment>',
    ])('says nothing was done when what remains is empty or a promise or a claim: %s', text => {
        expect(clean(text)).toMatch(FIXED);
    });
});
