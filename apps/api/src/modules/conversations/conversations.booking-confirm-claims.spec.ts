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

/** A model that says the booking is done while nothing was created. */
const CLAIMS: Array<[string, string]> = [
    ['es confirmada', '¡Cita confirmada! Su cita de Corte y estilo es el 5 de enero a las 16:00.'],
    ['es quedó agendada', 'Perfecto, su cita quedó agendada para el 5 de enero a las 16:00. ¡Lo esperamos!'],
    ['es reservé', 'Listo, reservé su cita de Corte y estilo para el 5 de enero a las 16:00.'],
    ['es su cita está lista', 'Su cita está lista, Joaquin. Le llegará un correo de confirmación.'],
    ['en booked', 'Great, your appointment is booked for January 5 at 4:00 PM.'],
    ['en confirmed', 'Your appointment has been confirmed. See you then!'],
    ['pt agendado', 'Pronto, o seu agendamento foi confirmado para 5 de janeiro às 16:00.'],
    ['fr réservé', "C'est fait, j'ai réservé votre rendez-vous pour le 5 janvier à 16 h."],
];
const CLAIM_WORDS = /confirmad|agendad|reserv|lista|booked|confirmed|agendamento|réserv|r.serv/i;

describe('a reply that claims a booking outcome when nothing was booked never reaches the customer', () => {
    it.each(CLAIMS)('at the confirmation re-ask (%s): the engine text, verbatim, and 0 writes', async (_label, claim) => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockResolvedValue(answer(claim));
        const result = await h.turn('sí, pero déjeme pensarlo');
        expect(result.reply).toBe(ASK_AGAIN);
        expect(h.writes()).toHaveLength(0);
        expect(h.session().history.filter(row => row.role === 'assistant').every(row => !row.content.includes(claim))).toBe(true);
    });

    it.each(CLAIMS)('in a plain turn (%s): the honest fixed text, and 0 writes', async (_label, claim) => {
        const h = fixture();
        await h.turn('hola');
        h.f.llmRouter.execute.mockResolvedValue(answer(claim));
        const result = await h.turn('¿dónde están ubicados?');
        expect(result.reply).not.toBe(claim);
        expect(result.reply).toMatch(/no puedo darle esa acción por confirmada|no he podido completar/i);
        expect(h.writes()).toHaveLength(0);
    });

    it('positive control: when the booking really happened, the claim stays', async () => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockResolvedValue(answer('¡Cita confirmada! Su cita de Corte y estilo es el 5 de enero a las 16:00.'));
        const result = await h.turn('sí');
        expect(h.writes()).toHaveLength(1);
        expect(result.reply).toMatch(CLAIM_WORDS);
        expect(result.reply).not.toMatch(/no puedo darle|no he podido/i);
    });
});

describe('a status question at the confirmation step keeps the pending confirmation', () => {
    it.each(['¿En qué quedó mi cita?', '¿ya está?', '¿quedó?', 'y mi cita? ya quedó?'])('"%s" then "sí" books exactly once', async question => {
        const h = fixture();
        await h.toConfirm();
        const before = h.session().metadata.bookingState;
        const id = before.confirmationId;
        expect(id).toBeTruthy();
        h.f.llmRouter.execute.mockResolvedValue(answer('Su cita sigue pendiente de su confirmación.'));
        const status = await h.turn(question);
        expect(h.writes()).toHaveLength(0);
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'confirm', confirmationId: id });
        expect(status.reply).not.toMatch(/confirmada|agendada|reservé/i);
        await h.turn('sí');
        expect(h.writes()).toHaveLength(1);
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'booked' });
    });

    it('«sí, confírmala» after the status question books once too', async () => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockResolvedValue(answer('Su cita sigue pendiente de su confirmación.'));
        await h.turn('¿En qué quedó mi cita?');
        await h.turn('sí, confírmala');
        expect(h.writes()).toHaveLength(1);
    });

    it('the status reply names the unconfirmed booking when the model produced a hollow promise', async () => {
        const h = fixture();
        await h.toConfirm();
        h.f.llmRouter.execute.mockResolvedValue(answer('Estoy gestionando la confirmación de su cita. Le avisaré en cuanto esté lista.'));
        const status = await h.turn('¿En qué quedó mi cita?');
        expect(status.reply).not.toMatch(/no he podido completar/i);
        expect(status.reply).toMatch(/Corte y estilo/);
        expect(status.reply).toMatch(/sin confirmar|pendiente|falta su|responda sí/i);
        expect(h.writes()).toHaveLength(0);
    });
});

/**
 * The server-side «sí» path (a pending operation executed by the server) fills the turn directive with an INSTRUCTION to
 * the model. A guard must never send that to the customer: only the booking engine's own text may be a reply.
 */
describe('the executed-operation directive is never sent to the customer', () => {
    const INTERNAL = /NO se pudo completar|Motivo interno|Explícaselo|Confírmasela|Confirmala|usando estos datos|IMPORTANT/i;

    /** A pending operation the customer just confirmed, executed by the SERVER; the model only voices the outcome. */
    async function pendingOperation(tool: string, result: any, modelReply: string) {
        const h = fixture();
        await h.turn('hola');
        const base = h.f.toolExecutor.execute.getMockImplementation();
        h.f.toolExecutor.execute.mockImplementation(async (...args: any[]) => (args[3] === tool ? result : base!(...args)));
        h.f.toolExecutionControl.findPendingConfirmation.mockResolvedValueOnce({ toolName: tool, ledgerId: 'ledger-1', args: { items: [{ sku: 'a', qty: 1 }] } });
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute.mockResolvedValue(answer(modelReply));
        const reply = (await h.turn('sí')).reply;
        const prompts = h.f.llmRouter.execute.mock.calls.map((call: any[]) => String(call[0].systemPrompt ?? ''));
        return { reply, prompts };
    }

    it.each([
        '¡Listo, su pedido está confirmado!',
        'Estoy procesando su pedido. Le avisaré en cuanto esté lista.',
    ])('a failed operation and a model that claims or promises it: no internal text reaches the customer (%s)', async modelReply => {
        // create_order is not a published tool of this tenant: the server-side execution comes back denied, and the model
        // is still told (in its instructions) that the operation could NOT be completed
        const { reply, prompts } = await pendingOperation('create_order', { error: 'out_of_stock', message: 'Sin stock del artículo a' }, modelReply);
        expect(prompts.some((prompt: string) => /NO se pudo completar/.test(prompt))).toBe(true);
        expect(reply).not.toMatch(INTERNAL);
        expect(reply).not.toBe(modelReply);
    });

    it('a done operation: the model voices it, and no instruction text is sent', async () => {
        const { reply, prompts } = await pendingOperation('create_appointment', { success: true, appointment: { id: 'apt-77', status: 'confirmed' } }, '¡Listo, su cita quedó confirmada!');
        expect(prompts.some((prompt: string) => prompt.includes('apt-77'))).toBe(true);
        expect(reply).not.toMatch(INTERNAL);
        expect(reply).toContain('quedó confirmada');
    });
});
