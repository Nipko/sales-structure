import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { randomUUID } from 'crypto';

/**
 * Service-level: a question about a service opens only a tentative mission. The model keeps its
 * read tools but loses the booking-write tool and is told the customer only showed interest; an
 * explicit request still goes through the engine, the single booking path.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICES = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Corte y estilo', durationMinutes: 45, price: 40000, priceStatus: 'example', currency: 'COP' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Manicure y pedicure', durationMinutes: 60, price: 50000, priceStatus: 'example', currency: 'COP' },
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
        if (name === 'list_services') return { services: SERVICES };
        if (name === 'check_availability') return { available: true, slots: [{ time: '09:00', endTime: '09:45' }] };
        if (name === 'search_faqs') return { results: [] };
        throw new Error(`Unexpected business write: ${name}`);
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
    const openMission = (step: string, savedAt: string) => {
        session().metadata.bookingState = { missionId: '86e8ed88-0000-4000-8000-000000000000', step, services: SERVICES,
            serviceId: SERVICES[0].id, serviceName: SERVICES[0].name, date: '2099-01-05' };
        session().metadata.bookingStateUpdatedAt = savedAt;
        session().metadata.bookingStateManaged = true;
    };
    return { f, turn, session, openMission };
}

const lastModelCall = (f: ReturnType<typeof fixture>['f']) => {
    const calls = f.llmRouter.execute.mock.calls.map((call: any[]) => call[0]);
    return calls[calls.length - 1];
};

describe('a mission opened by a question (tentative)', () => {
    it('reaches the model without create_appointment and with the interest hint, never as a pending booking', async () => {
        const h = fixture();
        await h.turn('hola');
        const listing = await h.turn('¿Qué servicios tienen?');
        expect(listing.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ origin: 'question', step: 'show_services' });
        const result = await h.turn('gracias');
        expect(result.debug.runtimeError).toBeUndefined();
        const names = (lastModelCall(h.f).tools || []).map((tool: any) => tool.name);
        expect(names).toEqual(expect.arrayContaining(['check_availability']));
        expect(names).not.toContain('create_appointment');
        expect(h.session().metadata.bookingState).toMatchObject({ origin: 'question' });
        const prompt: string = h.session().trace.systemPrompt;
        expect(prompt).toContain('<booking_interest>');
        expect(prompt).not.toContain('<booking_state>');
        expect(result.debug.turnContext.directive).toBeUndefined();
    });
});

describe('an explicit booking request (real mission)', () => {
    it('is answered by the engine, which asks for the date, and drops the tentative mark', async () => {
        const h = fixture();
        await h.turn('hola');
        await h.turn('¿Qué servicios tienen?');
        const result = await h.turn('Quiero agendar Corte y estilo');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.debug.turnContext.directive).toBeTruthy();
        expect(h.session().metadata.bookingState.origin).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: SERVICES[0].id, step: 'ask_date' });
        expect(h.session().trace.systemPrompt).not.toContain('<booking_interest>');
    });
});
