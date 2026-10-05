import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { randomUUID } from 'crypto';

/**
 * Service-level replay of the production sequence (tenant "citas", mission
 * 86e8ed88): with a booking mission open, informational questions were consumed
 * by the booking engine (no tool, no model tools) and the mission never ended.
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

describe('informational questions with a booking mission open reach the model with its tools', () => {
    it.each([
        ['hours', '¿A qué hora abren?'],
        ['price', '¿Cuánto cuesta el corte y estilo?'],
        ['services and hours', '¿Qué servicios tienen y hasta qué hora están atendiendo?'],
    ])('%s: the booking engine does not consume the turn and the mission survives', async (_name, question) => {
        const h = fixture();
        await h.turn('hola');
        h.openMission('show_slots', new Date().toISOString());
        const result = await h.turn(question);
        expect(result.debug.runtimeError).toBeUndefined();
        const request = lastModelCall(h.f);
        expect((request.tools || []).map((tool: any) => tool.name)).toEqual(expect.arrayContaining(['check_availability']));
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'show_slots', serviceId: SERVICES[0].id, date: '2099-01-05' });
        expect(h.f.toolExecutor.execute.mock.calls.some((call: any[]) => call[3] === 'create_appointment')).toBe(false);
    });
});

describe('a booking mission left untouched is offered back instead of continuing silently', () => {
    it('after the continuity window the next booking turn offers to resume; a question in between does not consume the offer', async () => {
        const h = fixture();
        await h.turn('hola');
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
        h.openMission('show_slots', threeDaysAgo);

        const question = await h.turn('¿Cuál es el horario de atención?');
        expect((lastModelCall(h.f).tools || []).length).toBeGreaterThan(0);
        expect(h.session().metadata.bookingState).toMatchObject({ resumeOffer: 'pending', serviceId: SERVICES[0].id });

        const back = await h.turn('sigo por aquí');
        expect(back.debug.turnContext.directive).toContain('sin terminar');
        expect(h.session().metadata.bookingState).toMatchObject({ resumeOffer: 'offered' });

        await h.turn('no, empecemos de nuevo');
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'idle' });
        expect(h.session().metadata.bookingState.serviceId).toBeUndefined();
    });
});
