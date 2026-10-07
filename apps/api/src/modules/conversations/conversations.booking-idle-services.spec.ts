import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { randomUUID } from 'crypto';

/**
 * Service-level: at a fresh (idle) conversation the interpreter knew no service name. Restoring a mission
 * at idle returns `{ step: 'idle' }` without the catalog, so «quiero agendar color y tratamiento» showed the
 * whole list instead of selecting the service, and everything that depends on the service named in the
 * message (real vs tentative mission) never ran as designed. The tenant's bookable services now reach the
 * interpreter at idle, from the same cache and tool the booking engine uses.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORTE = { id: '11111111-1111-4111-8111-111111111111', name: 'Corte y estilo', durationMinutes: 45, price: 40000, priceStatus: 'example', currency: 'COP' };
const COLOR = { id: '22222222-2222-4222-8222-222222222222', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, priceStatus: 'example', currency: 'COP' };
const MANI = { id: '33333333-3333-4333-8333-333333333333', name: 'Manicure y pedicure', durationMinutes: 60, price: 50000, priceStatus: 'example', currency: 'COP' };
const SERVICES = [CORTE, COLOR, MANI];

function fixture(opts: { industry?: string; subType?: string; tools?: Record<string, any>; published?: string[]; services?: any[] } = {}) {
    const f = agentTurnFixture();
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    const industry = opts.industry ?? 'salon';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry, tools: opts.tools ?? { appointments: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry, subType: opts.subType ?? 'belleza' });
    publishTools(f, opts.published ?? ['list_services', 'check_availability', 'create_appointment', 'search_faqs']);
    const catalog = opts.services ?? SERVICES;
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'list_services') return { services: catalog };
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
    const calls = (name: string) => f.toolExecutor.execute.mock.calls.filter((call: any[]) => call[3] === name);
    return { f, turn, session, calls };
}

const lastModelCall = (f: ReturnType<typeof fixture>['f']) => {
    const all = f.llmRouter.execute.mock.calls.map((call: any[]) => call[0]);
    return all[all.length - 1];
};

describe('a fresh conversation: the interpreter knows the tenant\'s services', () => {
    it('«quiero agendar color y tratamiento» selects the service (real mission, asks the date) instead of listing everything', async () => {
        const h = fixture();
        const result = await h.turn('quiero agendar color y tratamiento');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: COLOR.id, serviceName: COLOR.name, step: 'ask_date' });
        expect(h.session().metadata.bookingState.origin).toBeUndefined();
        expect(result.debug.turnContext.directive).toBeTruthy();
        expect(result.debug.turnContext.directive).not.toContain(CORTE.name);
    });

    it('«¿Cuánto dura color y tratamiento?» opens a tentative mission: the engine is silent and the model answers without a booking tool', async () => {
        const h = fixture();
        const result = await h.turn('¿Cuánto dura color y tratamiento?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ origin: 'question', serviceId: COLOR.id });
        expect(result.debug.turnContext.directive).toBeUndefined();
        const names = (lastModelCall(h.f).tools || []).map((tool: any) => tool.name);
        expect(names).not.toContain('create_appointment');
        expect(h.session().trace.systemPrompt).toContain('<booking_interest>');
        expect(h.session().trace.systemPrompt).not.toContain('<booking_state');
    });

    it('«hola» opens nothing', async () => {
        const h = fixture();
        const result = await h.turn('hola');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'idle' });
        expect(h.session().metadata.bookingState.serviceId).toBeUndefined();
        expect(h.session().metadata.bookingState.origin).toBeUndefined();
        expect(result.debug.turnContext.directive).toBeUndefined();
    });

    it('a booking request that names no service still shows the list', async () => {
        const h = fixture();
        await h.turn('quiero agendar una cita');
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'show_services' });
        expect(h.session().metadata.bookingState.serviceId).toBeUndefined();
    });

    it('reads the catalog once per tenant window: later idle turns hit the cache, not the tool', async () => {
        const h = fixture();
        await h.turn('quiero agendar color y tratamiento');
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: COLOR.id });
        // Back to a fresh conversation state (what a finished or expired mission restores to).
        h.session().metadata.bookingState = { step: 'idle' };
        await h.turn('quiero agendar manicure y pedicure');
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: MANI.id });
        expect(h.calls('list_services')).toHaveLength(1);
    });
});

describe('verticals whose bookings are not a service from the catalog', () => {
    it('real estate: «agendar una visita al apartamento» still goes to the vertical tools, and the catalog does not turn it into a service booking', async () => {
        const h = fixture({
            industry: 'inmobiliaria', subType: 'residencial',
            tools: { appointments: { enabled: true }, realEstate: { enabled: true } },
            services: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Asesoría hipotecaria', durationMinutes: 30, price: 0, priceStatus: 'confirmed', currency: 'COP' }],
        });
        const result = await h.turn('quiero agendar una visita al apartamento de Chapinero');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'idle' });
        expect(h.session().metadata.bookingState.serviceId).toBeUndefined();
        expect(result.debug.turnContext.directive).toBeUndefined();
    });

    it('a tenant without appointments (restaurant, tours) never loads a service list for the interpreter', async () => {
        const h = fixture({
            industry: 'restaurante', subType: 'casual', tools: { restaurants: { enabled: true } },
            published: ['search_faqs'],
        });
        const result = await h.turn('quiero reservar una mesa para cuatro');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.calls('list_services')).toHaveLength(0);
        expect(h.session().metadata.bookingState?.serviceId).toBeUndefined();
    });

    it('appointments on but booking not authorised for the turn (write tool not published): the catalog is not read for the interpreter', async () => {
        const h = fixture({ published: ['list_services', 'check_availability'] });
        const result = await h.turn('quiero agendar color y tratamiento');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.calls('list_services')).toHaveLength(0);
        expect(h.session().metadata.bookingState?.serviceId).toBeUndefined();
    });

    it('a tenant with no services is remembered briefly: later idle turns do not query the catalog again', async () => {
        const h = fixture({ services: [] });
        await h.turn('¿Cuánto dura color y tratamiento?');
        await h.turn('¿Cuánto dura corte y estilo?');
        await h.turn('quiero agendar manicure');
        expect(h.calls('list_services')).toHaveLength(1);
        expect(await h.session().state.get('booking:services:tenant')).toBe('[]');
    });

    it('a tenant with no services behaves as before (nothing to match, the engine lists nothing)', async () => {
        const h = fixture({ services: [] });
        const result = await h.turn('¿Cuánto dura color y tratamiento?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState.serviceId).toBeUndefined();
        expect(h.session().metadata.bookingState.origin).toBeUndefined();
    });
});
