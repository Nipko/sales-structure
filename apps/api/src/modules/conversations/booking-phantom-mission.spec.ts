import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { isInformationalDetour } from './informational-detour';
import { projectBookingStateForPrompt, restoreBookingMission } from './booking-state-continuity';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production evidence (tenant "Salon QA Citas", Telegram): the customer asked
 * "cuanto dura color y tratamiento?" and never asked to book. The engine read the
 * service name as a service selection, opened a mission, and a later turn made the
 * model say "tengo una reserva pendiente para corte y estilo".
 *
 * A message that names a service still opens the flow (no booking is lost), but when that
 * message is a question the mission is TENTATIVE: the engine does not assert a booking, the
 * model never sees it as pending, and it expires unless the customer gives a booking datum.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const services = [
    { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'example' as const },
    { id: 'svc-color', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, currency: 'COP', priceStatus: 'example' as const },
];
const today = '2026-10-05';
const upcoming = [{ date: '2026-10-10', weekday: 'sabado' }];
const T0 = Date.parse('2026-10-05T12:00:00Z');
const MIN = 60_000;

function harness(llmIntent: Record<string, unknown> = {}) {
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'check_availability') return { available: true, slots: [{ time: '16:00', endTime: '18:00' }] };
        if (name === 'list_services') return { services };
        return { success: true };
    });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify(services), set: async () => {} } as any,
        { execute } as any,
    );
    const llm = jest.fn(async () => ({ content: JSON.stringify({
        intent: 'unknown', serviceMentioned: null, dateMentioned: null, timeMentioned: null, isConfirmation: false,
        isNegation: false, nameProvided: null, emailProvided: null, questionTopic: null, language: 'es', ...llmIntent,
    }) }));
    const interpreter = new IntentInterpreterService({ execute: llm } as any);
    const turn = async (text: string, state: BookingState) => {
        const intent = await interpreter.interpret(text, state.step, services.map(s => s.name), today, upcoming);
        const result = await engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, 'es',
            { authority, conversationId: 'conversation' });
        return { intent, result };
    };
    return { turn };
}

/** What the next turn loads: the state saved at T0, restored `minutes` later. */
const restoredAfter = (state: BookingState, minutes: number): BookingState => {
    const savedAt = new Date(T0).toISOString();
    return restoreBookingMission({ ...state, savedAt }, savedAt, T0 + minutes * MIN).state;
};

describe('a message that names a service never loses the booking (idle)', () => {
    it.each([
        '¿Puedo pedir una cita para color y tratamiento? ¿cuánto dura?',
        '¿Me dan turno para color y tratamiento? ¿cuánto demora?',
        'Quiero reservar color y tratamiento, ¿cuánto dura?',
        'me regala una cita para color y tratamiento? cuánto cuesta?',
        'me anotas para color y tratamiento? cuánto dura?',
        'quería saber si me pueden atender para color y tratamiento, cuánto cuesta?',
        'Quisiera color y tratamiento, ¿cuánto cuesta?',
        '¿Se puede hacer color y tratamiento? ¿cuánto demora?',
        '¿Me pueden hacer color y tratamiento? ¿cuánto cuesta?',
        'can you fit me in for color y tratamiento? how long does it take?',
        'Can I get color y tratamiento? how much is it?',
        'dá pra marcar color y tratamiento? quanto custa?',
        'Quero fazer color y tratamiento, quanto custa?',
        'Je voudrais color y tratamiento, combien ça coûte ?',
        'Me interesa color y tratamiento, ¿cuánto cuesta?',
    ])('"%s" keeps the service and the next datum continues the flow', async text => {
        const { turn } = harness();
        const first = await turn(text, { step: 'idle' });
        expect(first.result.state).toMatchObject({ serviceId: 'svc-color', step: 'ask_date' });
        const second = await turn('el sábado', first.result.state);
        expect(second.result.handled).toBe(true);
        expect(second.result.state.origin).toBeUndefined();
    });

    it.each([
        'Quiero agendar color y tratamiento',
        'Necesito agendar color y tratamiento',
        '¿tienen cupo a las 16:00 para color y tratamiento? ¿cuánto dura?',
        'Hola, quiero reservar un color y tratamiento mañana. ¿Cuánto cuesta?',
    ])('"%s" is a real request: the engine answers and the mission is not tentative', async text => {
        const { turn } = harness();
        const { result } = await turn(text, { step: 'idle' });
        expect(result.handled).toBe(true);
        expect(result.state.step).not.toBe('idle');
        expect(result.state.origin).toBeUndefined();
    });
});

describe('a question that opens a mission opens only a tentative one', () => {
    const questions = [
        '¿Cuánto dura color y tratamiento?',
        '¿Cuánto cuesta color y tratamiento?',
        '¿Cuánto tiempo necesito para color y tratamiento?',
        'Necesito saber cuánto dura color y tratamiento',
        '¿Cuánto dura la cita de color y tratamiento?',
        '¿Cuánto dura el turno de color y tratamiento?',
        '¿Cuánto cuesta la cita de color y tratamiento?',
        '¿Hay que reservar para color y tratamiento o puedo llegar?',
        '¿Está disponible color y tratamiento los domingos?',
        '¿Necesito cita previa para color y tratamiento?',
        '¿Cuánto cuesta sacar una cita para color y tratamiento?',
        '¿Qué incluye color y tratamiento?',
        '¿Color y tratamiento sirve para cabello teñido?',
        '¿Puedo pagar color y tratamiento con tarjeta?',
        "What's your schedule for color y tratamiento?",
        'Hola, para color y tratamiento cuánto tiempo necesito?',
    ];

    it.each(questions)('"%s" says nothing for the engine and is never a pending booking', async text => {
        const { turn } = harness();
        const { result } = await turn(text, { step: 'idle' });
        expect(result.handled).toBe(false);
        expect(result.text).toBeUndefined();
        if (result.state.step !== 'idle') expect(result.state.origin).toBe('question');
        // Never shown to the model as pending, live or after the continuity window.
        expect(projectBookingStateForPrompt(restoredAfter(result.state, 5))).toBeUndefined();
        // Past the window it expires: no dormant mission, so no "reserva sin terminar" offer.
        expect(restoredAfter(result.state, 31)).toEqual({ step: 'idle' });
    });

    it('does not turn a bare question that names the service into a booking text', async () => {
        const { turn } = harness();
        const { result } = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        expect(result.state).toMatchObject({ serviceId: 'svc-color', origin: 'question' });
        expect(result.text).toBeUndefined();
    });

    it('C14 then C25: a later question about another service never mentions a pending booking', async () => {
        const { turn } = harness();
        const c14 = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const restored = restoredAfter(c14.result.state, 31);
        expect(projectBookingStateForPrompt(restored)).toBeUndefined();
        const c25 = await turn('¿Cuánto dura corte y estilo y tienen cupo el sábado a las 16:00?', restored);
        expect(c25.result.text ?? '').not.toMatch(/reserva|sin terminar|pendiente/i);
        expect(projectBookingStateForPrompt(c25.result.state)).not.toMatchObject({ service: { name: 'Color y tratamiento' } });
    });

    it('stays tentative while the customer keeps asking, and a statement makes it real', async () => {
        const { turn } = harness();
        const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const again = await turn('¿Y cuánto cuesta color y tratamiento?', first.result.state);
        expect(again.result.state.origin).toBe('question');
        const real = await turn('Sí, quiero agendar', again.result.state);
        expect(real.result.state.origin).toBeUndefined();
    });
});

describe('a tentative mission that receives a booking datum becomes a real mission', () => {
    it('keeps the normal dormant treatment afterwards', async () => {
        const { turn } = harness();
        const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        expect(first.result.state.origin).toBe('question');
        const second = await turn('el sábado', first.result.state);
        expect(second.result.handled).toBe(true);
        expect(second.result.state).toMatchObject({ serviceId: 'svc-color' });
        expect(second.result.state.origin).toBeUndefined();
        const dormant = restoredAfter(second.result.state, 31);
        expect(dormant).toMatchObject({ serviceId: 'svc-color', resumeOffer: 'pending' });
        expect(projectBookingStateForPrompt(dormant)).toBeUndefined();
        const offer = await turn('ok', dormant);
        expect(offer.result.handled).toBe(true);
        expect(offer.result.text).toMatch(/sin terminar/i);
    });
});

describe('a duration question riding with the answer to the current step', () => {
    it('at show_services the named service is still selected', async () => {
        const { turn } = harness();
        const { intent, result } = await turn('Color y tratamiento, ¿cuánto dura?', { step: 'show_services', missionId: 'm1', services });
        expect(intent.intent).toBe('select_service');
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: 'svc-color', step: 'ask_date' });
    });

    it('at show_services "¿Está disponible X?" still selects the service', async () => {
        const { turn } = harness();
        const { result } = await turn('¿Está disponible color y tratamiento?', { step: 'show_services', missionId: 'm1', services });
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: 'svc-color' });
    });

    it('at show_slots the named time is still selected', async () => {
        const { turn } = harness({ intent: 'select_time', timeMentioned: '16:00' });
        const open: BookingState = {
            missionId: 'm1', step: 'show_slots', serviceId: 'svc-color', serviceName: 'Color y tratamiento', date: '2026-10-10',
            slots: [{ time: '15:00', endTime: '17:00' }, { time: '16:00', endTime: '18:00' }], services,
        };
        const { result } = await turn('a las 16:00, ¿cuánto dura?', open);
        expect(result.handled).toBe(true);
        expect(result.state.time).toBe('16:00');
    });

    it('a pure duration question mid-mission at another step still goes to the model', () => {
        expect(isInformationalDetour('¿Cuánto dura color y tratamiento?', { serviceMentioned: 'Color y tratamiento' }, 'ask_date')).toBe(true);
    });

    it('keeps a time next to a duration question with the engine', () => {
        expect(isInformationalDetour('¿cuánto dura color y tratamiento a las 16:00?', { timeMentioned: '16:00' })).toBe(false);
    });
});

describe('a dormant mission is not shown to the model as a pending reservation', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    const saved: BookingState = { missionId: 'm1', step: 'show_slots', serviceId: 'svc-corte', serviceName: 'Corte y estilo', date: '2026-10-10', services };

    it('omits a dormant mission (awaiting a resume decision) from the turn context', () => {
        const restored = restoreBookingMission(saved, '2026-10-05T10:00:00Z', now).state;
        expect(restored.resumeOffer).toBe('pending');
        expect(projectBookingStateForPrompt(restored)).toBeUndefined();
    });

    it('keeps projecting a mission the customer is actively working on', () => {
        const live = restoreBookingMission(saved, '2026-10-05T11:50:00Z', now).state;
        expect(projectBookingStateForPrompt(live)).toMatchObject({
            step: 'show_slots', service: { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45 }, date: '2026-10-10',
        });
    });

    it('never projects a tentative mission, even while live', () => {
        const live = restoreBookingMission({ ...saved, origin: 'question' }, '2026-10-05T11:50:00Z', now).state;
        expect(projectBookingStateForPrompt(live)).toBeUndefined();
    });

    it('projects nothing at idle', () => {
        expect(projectBookingStateForPrompt({ step: 'idle' })).toBeUndefined();
    });
});
