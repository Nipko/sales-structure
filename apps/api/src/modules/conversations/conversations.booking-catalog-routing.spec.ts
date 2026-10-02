import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { randomUUID } from 'crypto';

const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICE = { id: '11111111-1111-4111-8111-111111111111', name: 'Visita virtual de prueba Faro Azul',
    durationMinutes: 20, price: 0, priceStatus: 'confirmed', currency: 'COP', locationType: 'online', paymentPolicy: 'none' };
const STAFF = '22222222-2222-4222-8222-222222222222';
const REQUEST = `Quiero agendar ${SERVICE.name} mañana a las 9:00 en Bogotá. Mi correo es contacto@example.test.`;

function fixture() {
    const f = agentTurnFixture();
    // Preview intentionally cannot read calendar availability. Exercise the
    // existing isolated-sandbox route with fake I/O ports; no provider or DB
    // writer is present in this harness.
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'inmobiliaria', tools: { appointments: { enabled: true }, realEstate: { enabled: true } },
        rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'inmobiliaria', subType: 'residencial' });
    publishTools(f, ['list_services', 'check_availability', 'create_appointment']);
    let services: any[] = [SERVICE];
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'list_services') return { services };
        if (name === 'check_availability') return { available: true, slots: [{ time: '09:00', endTime: '09:20', staffId: STAFF, staffName: 'Prueba Onboarding' }] };
        throw new Error(`Unexpected business write before confirmation: ${name}`);
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
    return { f, turn, session, services: (next: any[]) => { services = next; } };
}

describe('booking routing uses the current service catalog before yielding to vertical tools', () => {
    it.each(['empty', 'stale'])('keeps a named real-estate service with the booking owner when conversation services are %s', async state => {
        const h = fixture();
        if (state === 'stale') {
            const previous = { ...SERVICE, id: 'old', name: 'Avalúo comercial' };
            h.services([previous]);
            await h.turn('hola');
            h.services([SERVICE]);
            // A recent completed booking retains its service snapshot when
            // restored; saving another service invalidates the tenant cache.
            h.session().metadata.bookingState = { step: 'booked', services: [previous] };
            h.session().metadata.bookingStateUpdatedAt = new Date().toISOString();
            await h.session().state.del('booking:services:tenant');
        }
        const first = await h.turn(REQUEST);
        expect(first.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'show_slots', serviceId: SERVICE.id, serviceName: SERVICE.name });
        expect(first.debug.turnContext.directive).toContain('09:00');
        expect(first.debug.toolCalls.some((call: any) => call.result?.error === 'mission_selection_required')).toBe(false);
        expect(h.session().metadata.missionFocus.selected).toMatchObject({ kind: 'booking', domain: 'appointment' });

        const second = await h.turn('9:00');
        expect(second.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ time: '09:00', staffId: STAFF, staffName: 'Prueba Onboarding' });
        expect(h.f.toolExecutor.execute.mock.calls.some((call: any[]) => call[3] === 'create_appointment')).toBe(false);
        expect(h.session().metadata.missionFocus.expectedReply).not.toBeNull();
    });

    it('does not refresh services through a denied booking capability', async () => {
        const h = fixture();
        publishTools(h.f, ['list_services']);
        const result = await h.turn(REQUEST);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();
        expect(h.session().metadata.bookingState.serviceId).toBeUndefined();
    });

    it('propagates a revoked evaluation source instead of choosing a route from stale services', async () => {
        const h = fixture();
        h.f.toolExecutor.execute.mockRejectedValue(new LLMSourceAuthorityUnavailable());
        await expect(h.turn(REQUEST)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(h.f.llmRouter.execute).not.toHaveBeenCalled();
    });

    it('preserves the catalog cache and creates no booking when the routing read returns an error', async () => {
        const h = fixture();
        const previous = { ...SERVICE, id: 'old', name: 'Avalúo comercial' };
        h.services([previous]);
        await h.turn('hola');
        h.f.toolExecutor.execute.mockResolvedValue({ error: 'catalog_temporarily_unavailable' });
        h.f.toolExecutor.execute.mockClear();
        await h.turn(REQUEST);
        // Restoring an idle mission deliberately clears its service snapshot;
        // a failed read must not replace the separate tenant cache with [].
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'idle' });
        expect(h.session().metadata.bookingState.serviceId).toBeUndefined();
        expect(JSON.parse((await h.session().state.get('booking:services:tenant'))!)).toEqual([previous]);
        expect(h.f.toolExecutor.execute.mock.calls.map((call: any[]) => call[3])).toEqual(['list_services']);
    });
});
