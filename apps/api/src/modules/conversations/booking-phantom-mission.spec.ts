import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { hasExplicitBookingRequest, isInformationalDetour } from './informational-detour';
import { projectBookingStateForPrompt, restoreBookingMission, TENTATIVE_BOOKING_BLOCKED_TOOLS } from './booking-state-continuity';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production evidence (tenant "Salon QA Citas", Telegram): the customer asked
 * "cuanto dura color y tratamiento?" and never asked to book. The engine read the
 * service name as a service selection, opened a mission, and a later turn made the
 * model say "tengo una reserva pendiente para corte y estilo".
 *
 * A message that names a service still opens the flow (no booking is lost). When it carries no
 * booking act (explicit request, date/time) the mission is TENTATIVE: the engine stays silent,
 * the model never sees a pending booking, and it expires unless the customer takes a booking act.
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

describe('an explicit booking request is a real mission and the engine speaks, even phrased as a question', () => {
    it.each([
        '¿Me agendas color y tratamiento?',
        '¿Puedo pedir una cita para color y tratamiento? ¿cuánto dura?',
        'Agendar color y tratamiento, ¿cuánto dura?',
        "I'd like to book color y tratamiento, how long does it take?",
        'agendame porfa color y tratamiento, cuánto dura?',
        'Quisiera color y tratamiento, ¿cuánto cuesta?',
        'Quero fazer color y tratamiento, quanto custa?',
        'Je voudrais color y tratamiento, combien ça coûte ?',
        'Can I get color y tratamiento? how much is it?',
        '¿Tienen cupo para color y tratamiento? ¿cuánto dura?',
        '¿Me dan turno para color y tratamiento? ¿cuánto demora?',
        'me regala una cita para color y tratamiento? cuánto cuesta?',
        'me anotas para color y tratamiento? cuánto dura?',
        '¿Me pueden hacer color y tratamiento? ¿cuánto cuesta?',
        'can you fit me in for color y tratamiento? how long does it take?',
        'dá pra marcar color y tratamiento? quanto custa?',
        'Quiero reservar color y tratamiento, ¿cuánto dura?',
        'Quiero agendar color y tratamiento',
        'Necesito agendar color y tratamiento',
        '¿tienen cupo a las 16:00 para color y tratamiento? ¿cuánto dura?',
        'Hola, quiero reservar un color y tratamiento mañana. ¿Cuánto cuesta?',
    ])('"%s"', async text => {
        const { turn } = harness();
        const { result } = await turn(text, { step: 'idle' });
        expect(result.handled).toBe(true);
        expect(result.text).toBeTruthy();
        expect(result.state).toMatchObject({ serviceId: 'svc-color' });
        expect(result.state.step).not.toBe('idle');
        expect(result.state.origin).toBeUndefined();
    });

    it('also hands the voice the duration the customer asked for', async () => {
        const { turn } = harness();
        const { result } = await turn('Quiero reservar color y tratamiento, ¿cuánto dura?', { step: 'idle' });
        expect(result.text).toContain('120 minutes');
    });

    it('is not fooled by questions ABOUT booking', () => {
        for (const text of [
            '¿Necesito cita previa para color y tratamiento?', '¿Cuánto cuesta sacar una cita para color y tratamiento?',
            '¿Hay que reservar para color y tratamiento o puedo llegar?', "What's your schedule for color y tratamiento?",
            '¿Cuánto tiempo necesito para color y tratamiento?', 'Necesito saber cuánto dura color y tratamiento',
            'Quisiera info sobre color y tratamiento',
        ]) expect([text, hasExplicitBookingRequest(text)]).toEqual([text, false]);
    });
});

describe('a mission opened without a booking act is tentative and silent', () => {
    const tentativeOpenings = [
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
        'info de color y tratamiento',
        'precio color y tratamiento',
        'color y tratamiento precio',
        'quisiera info sobre color y tratamiento',
        'me interesa color y tratamiento',
        'Color y tratamiento',
    ];

    it.each(tentativeOpenings)('"%s" opens nothing the engine speaks for and nothing pending', async text => {
        const { turn } = harness();
        const { result } = await turn(text, { step: 'idle' });
        expect(result.handled).toBe(false);
        expect(result.text).toBeUndefined();
        if (result.state.step !== 'idle') expect(result.state.origin).toBe('question');
        expect(projectBookingStateForPrompt(restoredAfter(result.state, 5))).toBeUndefined();
        expect(restoredAfter(result.state, 31)).toEqual({ step: 'idle' });
    });

    it.each(['gracias', 'muchas gracias', 'chao', 'hola', 'ok gracias', 'perfecto, gracias', 'ok', 'thanks'])(
        'question, then "%s": still tentative and silent, and 31 minutes later nothing is offered back', async reply => {
            const { turn } = harness();
            const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
            const second = await turn(reply, first.result.state);
            expect(second.result.handled).toBe(false);
            expect(second.result.text).toBeUndefined();
            expect(second.result.state.origin).toBe('question');
            const later = restoredAfter(second.result.state, 31);
            expect(later).toEqual({ step: 'idle' });
            const third = await turn('hola', later);
            expect(third.result.text ?? '').not.toMatch(/sin terminar|reserva/i);
        });

    it('"¿qué servicios tienen?" then "gracias" does not leave a mission behind', async () => {
        const { turn } = harness();
        const list = await turn('¿Qué servicios tienen?', { step: 'idle' });
        expect(list.result.handled).toBe(true);
        expect(list.result.state.origin).toBe('question');
        const thanks = await turn('gracias', list.result.state);
        expect(thanks.result.handled).toBe(false);
        expect(restoredAfter(thanks.result.state, 31)).toEqual({ step: 'idle' });
    });

    it.each(['no gracias', 'no', 'ahora no', 'no thanks'])('question, then "%s": the interest is dropped', async reply => {
        const { turn } = harness();
        const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const second = await turn(reply, first.result.state);
        expect(second.result.handled).toBe(false);
        expect(second.result.state).toEqual({ step: 'idle' });
    });

    it.each(['sí', 'dale', 'yes please', 'sim', 'oui', 'sí, el sábado', 'sí gracias', 'claro'])(
        'question, then "%s": the booking act makes it real and the engine asks for the rest', async reply => {
            const { turn } = harness();
            const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
            const second = await turn(reply, first.result.state);
            expect(second.result.handled).toBe(true);
            expect(second.result.text).toBeTruthy();
            expect(second.result.state).toMatchObject({ serviceId: 'svc-color' });
            expect(second.result.state.origin).toBeUndefined();
        });

    it('a service picked from the list is a booking act', async () => {
        const { turn } = harness();
        const list = await turn('¿Qué servicios tienen?', { step: 'idle' });
        const pick = await turn('Color y tratamiento', list.result.state);
        expect(pick.result.handled).toBe(true);
        expect(pick.result.state).toMatchObject({ serviceId: 'svc-color', step: 'ask_date' });
        expect(pick.result.state.origin).toBeUndefined();
    });

    it('a date makes it real and then it has the normal dormant treatment', async () => {
        const { turn } = harness();
        const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const second = await turn('el sábado', first.result.state);
        expect(second.result.handled).toBe(true);
        expect(second.result.state.origin).toBeUndefined();
        const dormant = restoredAfter(second.result.state, 31);
        expect(dormant).toMatchObject({ serviceId: 'svc-color', resumeOffer: 'pending' });
        expect(projectBookingStateForPrompt(dormant)).toBeUndefined();
        const offer = await turn('ok', dormant);
        expect(offer.result.handled).toBe(true);
        expect(offer.result.text).toMatch(/sin terminar/i);
    });

    it('C14 then C25: a later question about another service never mentions a pending booking', async () => {
        const { turn } = harness();
        const c14 = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const restored = restoredAfter(c14.result.state, 31);
        expect(projectBookingStateForPrompt(restored)).toBeUndefined();
        const c25 = await turn('¿Cuánto dura corte y estilo y tienen cupo el sábado a las 16:00?', restored);
        expect(c25.result.text ?? '').not.toMatch(/reserva|sin terminar|pendiente/i);
    });

    it('the model cannot write bookings while the mission is only an interest', () => {
        expect(TENTATIVE_BOOKING_BLOCKED_TOOLS.has('create_appointment')).toBe(true);
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
