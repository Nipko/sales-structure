import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Owner decision: with booking authority DENIED and a draft open, the engine used to read ANY message as a
 * booking request and hand the customer to a person («Te paso con alguien del equipo…»), even for «gracias»,
 * a lone e-mail or «ok». It now escalates only when the customer is pushing to book or confirm (an explicit
 * request, a confirmation, a day/hour/slot choice); everything else goes to the model, which can answer and
 * may offer a person without transferring.
 */
const denied = authorityFor('list_services', 'check_availability'); // create_appointment is missing
const CORTE = { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'confirmed' as const };
const today = '2026-10-05';
const upcoming = [{ date: '2026-10-10', weekday: 'sabado' }, { date: '2026-10-11', weekday: 'domingo' }];

function harness() {
    const execute = jest.fn(async () => ({ error: 'tool_not_authorised' }));
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify([CORTE]), set: async () => {}, del: async () => {} } as any,
        { execute } as any,
    );
    const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
    return async (text: string, state: BookingState) => {
        const names = state.step === 'idle' ? [] : [CORTE.name];
        const intent = await interpreter.interpret(text, state.step, names, today, upcoming);
        return engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, 'es', { authority: denied, conversationId: 'c' });
    };
}

const draftAt = (step: BookingState['step'], extra: Partial<BookingState> = {}): BookingState => ({
    missionId: 'm', step, serviceId: CORTE.id, serviceName: CORTE.name, date: '2026-10-10', time: '16:00',
    slots: [{ time: '16:00', endTime: '16:45' }], customerName: 'Joaquin Sosa', services: [CORTE], ...extra,
});

describe('booking authority denied, draft open: the engine does not escalate on its own', () => {
    it.each([
        ['ask_email', 'gracias'], ['ask_email', 'ok'], ['ask_email', 'hola'], ['ask_email', 'chao'], ['confirm', 'perfecto, gracias'],
        ['ask_email', 'joaquin@example.com'], ['ask_email', 'mi correo es joaquin@example.com'],
        ['ask_name', 'Joaquin Sosa'], ['show_slots', 'ok'],
        ['ask_email', '¿cuánto dura el corte?'], ['ask_email', '¿atienden los domingos?'], ['ask_email', '¿trabajan el sábado?'], ['confirm', '¿cuánto cuesta?'],
    ])('at %s "%s" is left to the model (no handoff, draft untouched)', async (step, text) => {
        const open = draftAt(step as BookingState['step']);
        const result = await harness()(text, structuredClone(open));
        expect(result.handled).toBe(false);
        expect(result.handoff).toBeUndefined();
        expect(result.text).toBeUndefined();
        expect(result.state).toMatchObject({ step, serviceId: CORTE.id, date: '2026-10-10', time: '16:00' });
    });

    it.each([
        ['ask_email', 'quiero agendar el sábado a las 16:00'],
        ['ask_email', 'agéndame por favor'],
        ['confirm', 'sí, confírmala'],
        ['confirm', 'dale'],
        ['ask_email', 'a las 15:00'],
        ['ask_email', 'cambia la hora a las 15:00'],
        ['show_slots', 'el sábado'],
        ['ask_date', 'mañana a las 10'],
    ])('at %s "%s" is pushing to book or change the booking: it escalates', async (step, text) => {
        const result = await harness()(text, structuredClone(draftAt(step as BookingState['step'])));
        expect(result.handled).toBe(true);
        expect(result.handoff).toBe(true);
        expect(result.handoffReason).toMatch(/^booking_not_authorised/);
    });

    it('with no draft open nothing changed: a booking request escalates, a greeting does not', async () => {
        const turn = harness();
        const request = await turn('quiero agendar una cita', { step: 'idle' });
        expect(request.handoff).toBe(true);
        const greeting = await turn('hola', { step: 'idle' });
        expect(greeting.handled).toBe(false);
    });
});
