import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { randomUUID } from 'crypto';

/**
 * Clean-chat regression 2026-10-08: at confirm / ask_email «mejor cámbiala a color y tratamiento» was answered as if
 * the draft switched («mantengo el sábado a las 16:00… necesito su correo para aplicar el cambio») but the draft
 * saved was still «Corte y estilo». Replayed through the whole turn (persistBookingState), not only the engine.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORTE = { id: '11111111-1111-4111-8111-111111111111', name: 'Corte y estilo', durationMinutes: 45, price: 40000, priceStatus: 'confirmed', currency: 'COP' };
const COLOR = { id: '22222222-2222-4222-8222-222222222222', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, priceStatus: 'confirmed', currency: 'COP' };
const SERVICES = [CORTE, COLOR];
const DATE = '2099-01-05';

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
        if (name === 'check_availability') return { available: true, slots: [{ time: '16:00', endTime: '16:45' }, { time: '17:00', endTime: '17:45' }] };
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
    const openDraft = (step: string, extra: Record<string, unknown> = {}) => {
        session().metadata.bookingState = {
            missionId: '86e8ed88-0000-4000-8000-000000000000', step, services: SERVICES, serviceId: CORTE.id, serviceName: CORTE.name,
            date: DATE, time: '16:00', slots: [{ time: '16:00', endTime: '16:45' }], customerName: 'Joaquin Sosa', ...extra,
        };
        session().metadata.bookingStateUpdatedAt = new Date().toISOString();
        session().metadata.bookingStateManaged = true;
    };
    return { f, turn, session, openDraft };
}

describe.each([
    ['ask_email', {}],
    ['confirm', { customerEmail: 'joaquin@example.com' }],
])('a draft at %s asked to switch service through the whole turn', (step, extra) => {
    it('«mejor cámbiala a color y tratamiento» changes the SAVED draft right away and the reply says what happens next', async () => {
        const h = fixture();
        await h.turn('hola');
        h.openDraft(step, extra);
        const result = await h.turn('mejor cámbiala a color y tratamiento');
        expect(result.debug.runtimeError).toBeUndefined();
        const saved = h.session().metadata.bookingState;
        expect(saved).toMatchObject({ serviceId: COLOR.id, serviceName: COLOR.name });
        expect(saved.origin).toBeUndefined();
        // The reply is the engine's, never the model's "to apply the change I need your e-mail".
        expect(result.debug.turnContext.directive).toBeTruthy();
        expect(result.reply).not.toMatch(/para aplicar el cambio|to apply the change/i);
    });

    it('with a day and an hour in the same message the slot is re-checked for the new service and kept', async () => {
        const h = fixture();
        await h.turn('hola');
        h.openDraft(step, extra);
        await h.turn('mejor cámbiala a color y tratamiento el 5 de enero a las 16:00');
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: COLOR.id, time: '16:00' });
        const checks = h.f.toolExecutor.execute.mock.calls.filter((call: any[]) => call[3] === 'check_availability');
        expect(checks.some((call: any[]) => call[4]?.serviceId === COLOR.id)).toBe(true);
    });
});


// The scenarios below are dated against a calendar and the turn reads the real clock: pinned, so they do not turn red the day
// they were written for goes by (see __fixtures__/pinned-clock.ts). Only Date is faked.
pinClock();
describe('the same switch after a real conversation (the mission focus saw every step)', () => {
    it('Corte y estilo -> día -> hora -> nombre, then «mejor cámbiala a color y tratamiento»', async () => {
        const h = fixture();
        await h.turn('hola');
        await h.turn('Quiero agendar Corte y estilo');
        await h.turn('el 5 de enero a las 16:00');
        await h.turn('Joaquin Sosa');
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: CORTE.id, step: 'ask_email' });
        const result = await h.turn('mejor cámbiala a color y tratamiento');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: COLOR.id, serviceName: COLOR.name, time: '16:00' });
        expect(result.debug.turnContext.directive).toBeTruthy();
        expect(result.reply).not.toMatch(/para aplicar el cambio|to apply the change/i);
    });
});
