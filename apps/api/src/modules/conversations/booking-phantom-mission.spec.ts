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
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const services = [
    { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'example' as const },
    { id: 'svc-color', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, currency: 'COP', priceStatus: 'example' as const },
];
const today = '2026-10-05';
const upcoming = [{ date: '2026-10-10', weekday: 'sabado' }];

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

describe('an informational question about a service never opens a booking mission', () => {
    it.each([
        '¿Cuánto dura color y tratamiento?',
        'Cuánto demora el corte y estilo',
        'How long does color y tratamiento take?',
    ])('"%s" is an informational question', text => {
        expect(isInformationalDetour(text)).toBe(true);
    });

    it('does not select the service nor leave idle when the customer only asks how long it lasts', async () => {
        const { turn } = harness();
        const { result } = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        expect(result.handled).toBe(false);
        expect(result.state.step).toBe('idle');
        expect(result.state.serviceId).toBeUndefined();
        expect(result.state.serviceName).toBeUndefined();
    });

    it('does not replace a mission of another service when asked how long a service lasts', async () => {
        const { turn } = harness();
        const open: BookingState = { missionId: 'm1', step: 'ask_date', serviceId: 'svc-corte', serviceName: 'Corte y estilo', services };
        const { result } = await turn('¿Cuánto dura color y tratamiento?', open);
        expect(result.handled).toBe(false);
        expect(result.state).toMatchObject({ step: 'ask_date', serviceId: 'svc-corte' });
    });

    it('still starts the flow when the customer asks to book the service', async () => {
        const { turn } = harness();
        const { result } = await turn('Quiero agendar color y tratamiento', { step: 'idle' });
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ step: 'ask_date', serviceId: 'svc-color' });
    });
});

describe('a booking request that also asks for the duration keeps the flow (idle)', () => {
    it.each([
        '¿Puedo pedir una cita para color y tratamiento? ¿cuánto dura?',
        '¿Me dan turno para color y tratamiento? ¿cuánto demora?',
        'Hola, para color y tratamiento cuánto tiempo necesito?',
        '¿tienen cupo a las 16:00 para color y tratamiento? ¿cuánto dura?',
        'Quiero reservar color y tratamiento, ¿cuánto dura?',
    ])('"%s" starts the flow', async text => {
        const { turn } = harness();
        const { result } = await turn(text, { step: 'idle' });
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: 'svc-color' });
        expect(result.state.step).not.toBe('idle');
    });

    it('keeps a time next to a duration question with the engine', () => {
        expect(isInformationalDetour('¿cuánto dura color y tratamiento a las 16:00?', { timeMentioned: '16:00' })).toBe(false);
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

    it('projects nothing at idle', () => {
        expect(projectBookingStateForPrompt({ step: 'idle' })).toBeUndefined();
    });
});
