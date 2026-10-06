import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { restoreBookingMission, BOOKING_MISSION_RETENTION_MS } from './booking-state-continuity';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production evidence (tenant "citas", conversation with mission 86e8ed88 open
 * since 2026-10-02): informational questions asked while a booking mission was
 * open were consumed by the booking engine (handled=true, no tool called) and
 * the customer received a waiting phrase. These specs replay that sequence.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const services = [
    { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'example' as const },
    { id: 'svc-color', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, currency: 'COP', priceStatus: 'example' as const },
    { id: 'svc-mani', name: 'Manicure y pedicure', durationMinutes: 60, price: 50000, currency: 'COP', priceStatus: 'example' as const },
];
const today = '2026-10-05';
const upcoming = [{ date: '2026-10-06', weekday: 'martes' }];

function harness(llmIntent: Record<string, unknown> = { intent: 'ask_availability' }) {
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'check_availability') return { available: true, slots: [{ time: '09:00', endTime: '09:45' }] };
        if (name === 'list_services') return { services };
        return { success: true };
    });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify(services), set: async () => {} } as any,
        { execute } as any,
    );
    const llmExecute = jest.fn(async () => ({ content: JSON.stringify({
        serviceMentioned: null, dateMentioned: null, timeMentioned: null, isConfirmation: false, isNegation: false,
        nameProvided: null, emailProvided: null, questionTopic: null, language: 'es', ...llmIntent,
    }) }));
    const interpreter = new IntentInterpreterService({ execute: llmExecute } as any);
    const mission = (step: BookingState['step'] = 'show_slots', extra: Partial<BookingState> = {}): BookingState => ({
        missionId: '86e8ed88', step, serviceId: 'svc-corte', serviceName: 'Corte y estilo', date: '2026-10-06',
        slots: [{ time: '09:00', endTime: '09:45' }], services, ...extra,
    });
    const turn = async (text: string, state: BookingState) => {
        const intent = await interpreter.interpret(text, state.step, services.map(s => s.name), today, upcoming);
        const result = await engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, 'es',
            { authority, conversationId: 'conversation' });
        return { intent, result };
    };
    return { turn, mission, execute };
}

describe('informational questions during an open booking mission (production sequence)', () => {
    it.each([
        ['C03 hours', 'Me puede decir el horario del salón, a qué hora empiezan y a qué hora terminan.', 'show_slots', { intent: 'ask_availability' }, 'general_question'],
        ['C02 hours', '¿Cuál es el horario de atención?', 'show_slots', { intent: 'ask_availability' }, 'general_question'],
        ['C07 hours fr', "Quels sont vos horaires d'ouverture ?", 'show_slots', { intent: 'ask_availability' }, 'general_question'],
        ['C15 price', '¿Cuánto cuesta el corte y estilo?', 'ask_date', { intent: 'select_service' }, 'general_question'],
        ['C26 services and hours', '¿Qué servicios tienen y hasta qué hora están atendiendo?', 'show_slots', { intent: 'ask_services' }, 'ask_services'],
        ['hours at ask_date', 'a qué hora abren los sábados', 'ask_date', { intent: 'ask_availability' }, 'general_question'],
        ['location', '¿Dónde están ubicados?', 'show_slots', { intent: 'ask_availability' }, 'general_question'],
        ['policy', '¿Cuál es la política de cancelación?', 'ask_date', { intent: 'ask_availability' }, 'general_question'],
    ])('%s is not consumed by the engine and keeps the mission', async (_name, text, step, llm, expected) => {
        const h = harness(llm);
        const before = h.mission(step as BookingState['step']);
        const { intent, result } = await h.turn(text, before);
        expect(intent.intent).toBe(expected);
        expect(result.handled).toBe(false);
        expect(result.text).toBeUndefined();
        expect(result.state).toMatchObject({ missionId: '86e8ed88', step, serviceId: 'svc-corte', date: '2026-10-06' });
        expect(h.execute.mock.calls.filter(c => c[3] === 'create_appointment')).toHaveLength(0);
    });

    it('still lets the engine handle a real slot pick with a time word', async () => {
        const h = harness({ intent: 'select_time', timeMentioned: '09:00' });
        const { result } = await h.turn('el horario de las 09:00', h.mission('show_slots'));
        expect(result.handled).toBe(true);
    });

    it('still lets the engine start from a booking request that also asks the price', async () => {
        const h = harness({ intent: 'ask_availability' });
        const { result } = await h.turn('Hola, quiero reservar un corte mañana. ¿Cuánto cuesta?', { step: 'idle' });
        expect(result.handled).toBe(true);
    });
});

describe('a booking mission cannot stay open indefinitely', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    const base: BookingState = { missionId: '86e8ed88', step: 'show_slots', serviceId: 'svc-corte', serviceName: 'Corte y estilo', date: '2026-10-06' };

    it('marks a mission untouched for more than the continuity window as awaiting a resume decision', () => {
        const restored = restoreBookingMission(base, '2026-10-05T11:00:00Z', now);
        expect(restored.state.resumeOffer).toBe('pending');
        expect(restored.state.dormantSince).toBe('2026-10-05T11:00:00.000Z');
    });

    it('does not revive a dormant mission because later turns refreshed savedAt', () => {
        const dormant: BookingState = { ...base, resumeOffer: 'offered', dormantSince: '2026-09-25T12:00:00.000Z' };
        const fresh = new Date(now - 60_000).toISOString();
        expect(Date.parse(fresh) > now - BOOKING_MISSION_RETENTION_MS).toBe(true);
        expect(restoreBookingMission(dormant, fresh, now).state).toEqual({ step: 'idle' });
    });

    it('offers to resume instead of silently continuing, and the answer decides', async () => {
        const h = harness({ intent: 'unknown' });
        const dormant: BookingState = { ...base, step: 'ask_date', resumeOffer: 'pending', dormantSince: '2026-10-02T21:00:00.000Z' };
        const offered = await h.turn('hola, sigo por aquí', dormant);
        expect(offered.result.handled).toBe(true);
        expect(offered.result.text).toMatch(/Corte y estilo/);
        expect(offered.result.state.resumeOffer).toBe('offered');

        const resumed = await h.turn('sí, retomemos', offered.result.state);
        expect(resumed.result.handled).toBe(true);
        expect(resumed.result.state.resumeOffer).toBeUndefined();
        expect(resumed.result.state).toMatchObject({ step: 'ask_date', serviceId: 'svc-corte' });

        const discarded = await h.turn('no, mejor empezar de nuevo', offered.result.state);
        expect(discarded.result.state.step).toBe('idle');
        expect(discarded.result.state.serviceId).toBeUndefined();
    });

    it('answers an informational question first and keeps the offer pending', async () => {
        const h = harness({ intent: 'ask_availability' });
        const dormant: BookingState = { ...base, step: 'ask_date', resumeOffer: 'pending', dormantSince: '2026-10-02T21:00:00.000Z' };
        const { result } = await h.turn('¿Cuál es el horario de atención?', dormant);
        expect(result.handled).toBe(false);
        expect(result.state.resumeOffer).toBe('pending');
        expect(result.state.dormantSince).toBe('2026-10-02T21:00:00.000Z');
    });

    it('an offer the customer ignored lapses: a later yes or no does not resume or discard the old mission', async () => {
        const h = harness({ intent: 'unknown' });
        const offered: BookingState = { ...base, step: 'ask_date', resumeOffer: 'offered', dormantSince: '2026-10-02T21:00:00.000Z' };
        const ignored = await h.turn('gracias, ya estoy bien', offered);
        expect(ignored.result.handled).toBe(false);
        expect(ignored.result.state.resumeOffer).toBe('lapsed');
        const later = await h.turn('sí', ignored.result.state);
        expect(later.result.handled).toBe(false);
        expect(later.result.state.resumeOffer).toBe('lapsed');
        expect(later.result.state.serviceId).toBe('svc-corte');
    });

    it('a question answered by the model also lapses an open offer', async () => {
        const h = harness({ intent: 'ask_availability' });
        const offered: BookingState = { ...base, step: 'ask_date', resumeOffer: 'offered', dormantSince: '2026-10-02T21:00:00.000Z' };
        const { result } = await h.turn('¿Cuál es el horario de atención?', offered);
        expect(result.handled).toBe(false);
        expect(result.state.resumeOffer).toBe('pending');
    });

    it('after one unanswered offer it is not repeated by thanks, laughter or goodbyes', async () => {
        const h = harness({ intent: 'unknown' });
        let state: BookingState = { ...base, step: 'ask_date', resumeOffer: 'offered', dormantSince: '2026-10-02T21:00:00.000Z' };
        for (const text of ['gracias', 'jaja', 'chao', 'ok', 'gracias de nuevo']) {
            const { result } = await h.turn(text, state);
            expect(result.handled).toBe(false);
            expect(result.text).toBeUndefined();
            expect(result.state.resumeOffer).toBe('lapsed');
            state = result.state;
        }
        const fresh = await h.turn('quiero el corte para mañana', state);
        expect(fresh.result.state.resumeOffer).toBeUndefined();
        expect(fresh.result.handled).toBe(true);
    });

    it('a farewell with an open mission is not answered with the next booking step', async () => {
        const h = harness({ intent: 'farewell' });
        const { result } = await h.turn('chao', h.mission('ask_date'));
        expect(result.handled).toBe(false);
    });
});
