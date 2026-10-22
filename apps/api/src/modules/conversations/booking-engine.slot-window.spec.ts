import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { SALON_SERVICE_ID, SALON_TENANT_ID, salonExecutor } from './__fixtures__/slot-window.harness';

/**
 * PR8 — "QA5": part-of-day availability window, end to end through the real
 * interpreter, the booking engine and the real check_availability handler.
 *
 * Production (salon 09:00-19:00, nothing booked tomorrow):
 *   «¿tienen disponibilidad mañana en la tarde para un corte?» → six MORNING slots;
 *   «después de las 13:00» → only 13:00;
 *   «¿tienen algo mañana por la tarde para manicure?» → morning, then "no afternoon availability" (false);
 *   «el sábado después de las 3 pm» → 15:00, 15:30, 16:00 (worked).
 * With `agentRuntime.slotWindow` on the afternoon is offered (or honestly reported full with the nearest
 * slots); with it off nothing changes.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const MANICURE_ID = '55555555-5555-4555-8555-555555555555';
const SERVICES = [
    { id: SALON_SERVICE_ID, name: 'Corte', durationMinutes: 30, price: 30000, currency: 'COP' },
    { id: MANICURE_ID, name: 'Manicure', durationMinutes: 30, price: 25000, currency: 'COP' },
];
const today = '2026-10-22'; // Thursday
const tomorrow = '2026-10-23';
const saturday = '2026-10-24';
const upcoming = [
    { date: '2026-10-22', weekday: 'jueves', label: 'hoy' }, { date: tomorrow, weekday: 'viernes', label: 'mañana' },
    { date: saturday, weekday: 'sabado' }, { date: '2026-10-25', weekday: 'domingo' },
];
const salonHours = () => ({ openMin: 9 * 60, closeMin: 19 * 60 });

function salon(flag: boolean, booked: Array<{ start: string; end: string }> = []) {
    const { executor } = salonExecutor({ flag, booked });
    const execute = jest.fn((...args: any[]) => (executor.execute as any)(...args));
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify(SERVICES), set: async () => {}, del: async () => {} } as any,
        { execute } as any,
    );
    const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
    const turn = async (text: string, state: BookingState = { step: 'idle' }, lang = 'es') => {
        const intent = await interpreter.interpret(
            text, state.step, SERVICES.map(s => s.name), today, upcoming, SALON_TENANT_ID, null, [], salonHours,
            ...(flag ? [{ slotWindow: true }] as const : [] as const),
        );
        return engine.process('tenant_salon', SALON_TENANT_ID, 'contact', intent, text, state, {}, today, lang,
            { authority, conversationId: 'conv', ...(flag ? { slotWindow: true } : {}) });
    };
    const availabilityCalls = () => execute.mock.calls.filter(call => call[3] === 'check_availability').map(call => call[4]);
    return { turn, availabilityCalls };
}
const offered = (state: BookingState) => (state.slots ?? []).map(slot => slot.time);

describe('flag on: «mañana en la tarde» offers the afternoon', () => {
    it('«¿tienen disponibilidad mañana en la tarde para un corte?» → only afternoon slots, spread to closing', async () => {
        const { turn, availabilityCalls } = salon(true);
        const { state, text } = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        expect(state.date).toBe(tomorrow);
        expect(state.timeWindow).toEqual({ partOfDay: 'afternoon' });
        expect(availabilityCalls()[0]).toMatchObject({ date: tomorrow, window: { partOfDay: 'afternoon' } });
        expect(availabilityCalls()[0]).not.toHaveProperty('time');
        expect(offered(state).length).toBeGreaterThan(1);
        expect(offered(state).every(time => time >= '12:00')).toBe(true);
        expect(offered(state)[0]).toBe('12:00');
        expect(offered(state)).toContain('18:30');
        expect(text).toContain('en la tarde');
        expect(text).not.toMatch(/09:00|10:00|11:00/);
    });

    it('«después de las 13:00» next turn replaces the window and never collapses to the single 13:00', async () => {
        const { turn } = salon(true);
        const first = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        const { state, text } = await turn('después de las 13:00', first.state);
        expect(state.timeWindow).toEqual({ from: '13:00' });
        expect(state.step).toBe('show_slots');
        expect(state.time).toBeUndefined();
        expect(offered(state).length).toBeGreaterThan(1);
        expect(offered(state)[0]).toBe('13:00');
        expect(offered(state).every(time => time >= '13:00')).toBe(true);
        expect(text).toContain('después de las 13:00');
    });

    it('a later correction («mejor en la mañana») replaces the kept window', async () => {
        const { turn } = salon(true);
        const first = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        const { state } = await turn('mejor en la mañana', first.state);
        expect(state.timeWindow).toEqual({ partOfDay: 'morning' });
        expect(offered(state).every(time => time < '12:00')).toBe(true);
    });

    it('the window persists across turns: another day keeps the afternoon', async () => {
        const { turn } = salon(true);
        const first = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        const { state } = await turn('mejor el sábado', first.state);
        expect(state.date).toBe(saturday);
        expect(state.timeWindow).toEqual({ partOfDay: 'afternoon' });
        expect(offered(state).every(time => time >= '12:00')).toBe(true);
    });

    it('picking an offered slot continues the booking normally', async () => {
        const { turn } = salon(true);
        const first = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        const { state } = await turn('a las 15:00', first.state);
        expect(state.time).toBe('15:00');
        expect(state.step).toBe('ask_name');
    });

    it('a new window at the name step is not a name: the picked slot is dropped and the new window offered', async () => {
        const { turn } = salon(true);
        const first = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        const picked = await turn('a las 15:00', first.state);
        const { state } = await turn('mejor en la mañana', picked.state);
        expect(state.customerName).toBeUndefined();
        expect(state.time).toBeUndefined();
        expect(state.step).toBe('show_slots');
        expect(state.timeWindow).toEqual({ partOfDay: 'morning' });
        expect(offered(state).every(time => time < '12:00')).toBe(true);
    });

    it('«a cualquier hora» lifts the kept window', async () => {
        const { turn } = salon(true);
        const first = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        const { state } = await turn('a cualquier hora', first.state);
        expect(state).not.toHaveProperty('timeWindow');
        expect(offered(state)[0]).toBe('09:00');
    });
});

describe('flag on: an empty afternoon is reported honestly with the nearest slots', () => {
    it('«¿tienen algo mañana por la tarde para manicure?» with the afternoon full → "no hay en la tarde; lo más cercano es …"', async () => {
        const { turn } = salon(true, [{ start: '12:00', end: '19:00' }]);
        const { state, text } = await turn('¿tienen algo mañana por la tarde para manicure?');
        expect(state.serviceName).toBe('Manicure');
        expect(state.step).toBe('show_slots');
        expect(offered(state)).toEqual(['10:30', '11:00', '11:30']);
        expect(text).toContain('no hay horarios en la tarde');
        expect(text).toContain('Lo más cercano');
        expect(text).toContain('11:30');
        expect(text).not.toMatch(/No hay disponibilidad/i);
        // The date is kept: the day HAS availability.
        expect(state.date).toBe(tomorrow);
    });
});

describe('flag on: the explicit-hour case', () => {
    it('«el sábado después de las 3 pm» offers 15:00 onwards (15:00, 15:30 … as before), never earlier', async () => {
        const { turn } = salon(true);
        const { state } = await turn('¿tienen cupo el sábado después de las 3 pm para un corte?');
        expect(state.date).toBe(saturday);
        expect(state.timeWindow).toEqual({ from: '15:00' });
        expect(offered(state).slice(0, 2)).toEqual(['15:00', '15:30']);
        expect(offered(state).every(time => time >= '15:00')).toBe(true);
        expect(state.time).toBeUndefined();
    });

    it('an exact hour («el sábado a las 3 pm») behaves exactly as with the flag off', async () => {
        // `missionId` and `progressedAt` (the draft's continuity stamp) are per-run: equal by construction, not by value.
        const on = await salon(true).turn('quiero un corte el sábado a las 3 pm');
        const off = await salon(false).turn('quiero un corte el sábado a las 3 pm');
        expect({ ...on.state, missionId: 'x', progressedAt: 'x' }).toEqual({ ...off.state, missionId: 'x', progressedAt: 'x' });
        expect(on.text).toBe(off.text);
        expect(on.state.time).toBe('15:00');
    });
});

describe.each([
    ['pt', 'Tem horário amanhã à tarde para corte?', 'à tarde', 'Corte'],
    ['en', 'Do you have anything tomorrow afternoon for a manicure?', 'in the afternoon', 'Manicure'],
    ['fr', 'Vous avez quelque chose demain après-midi pour une manicure ?', "l'après-midi", 'Manicure'],
])('flag on, %s', (lang, text, label, service) => {
    it('offers only the afternoon', async () => {
        const { turn } = salon(true);
        const result = await turn(text, { step: 'idle' }, lang);
        expect(result.state.serviceName).toBe(service);
        expect(result.state.date).toBe(tomorrow);
        expect(result.state.timeWindow).toEqual({ partOfDay: 'afternoon' });
        expect(offered(result.state).every(time => time >= '12:00')).toBe(true);
        expect(result.text).toContain(label);
    });

    it('reports a full afternoon with the nearest slots', async () => {
        const { turn } = salon(true, [{ start: '12:00', end: '19:00' }]);
        const result = await turn(text, { step: 'idle' }, lang);
        expect(offered(result.state)).toEqual(['10:30', '11:00', '11:30']);
        expect(result.text).toContain(label);
        expect(result.state.date).toBe(tomorrow);
    });
});

describe('flag off: byte-identical behaviour', () => {
    const phrasings = [
        '¿tienen disponibilidad mañana en la tarde para un corte?',
        '¿tienen algo mañana por la tarde para manicure?',
        '¿tienen cupo el sábado después de las 3 pm para un corte?',
        'Tem horário amanhã à tarde para corte?',
    ];

    it.each(phrasings)('the interpreter adds nothing: %s', async text => {
        const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
        const args = [text, 'idle', SERVICES.map(s => s.name), today, upcoming, SALON_TENANT_ID, null, [], salonHours] as const;
        const off = await interpreter.interpret(...args);
        const offExplicit = await interpreter.interpret(...args, { slotWindow: false });
        expect(off).not.toHaveProperty('timeWindow');
        expect(off).not.toHaveProperty('timeWindowCleared');
        expect(JSON.stringify(offExplicit)).toBe(JSON.stringify(off));
    });

    it('the legacy offer is kept as it was (first six slots of the day; the production bug stays behind the flag)', async () => {
        const { turn, availabilityCalls } = salon(false);
        const { state } = await turn('¿tienen disponibilidad mañana en la tarde para un corte?');
        expect(offered(state)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
        expect(availabilityCalls()[0]).toEqual({ date: tomorrow, serviceId: SALON_SERVICE_ID });
        expect(state).not.toHaveProperty('timeWindow');
    });

    it('the engine ignores a window in the intent and drops one kept in state', async () => {
        const { turn } = salon(false);
        const kept: BookingState = { step: 'ask_date', services: SERVICES, serviceId: SALON_SERVICE_ID, serviceName: 'Corte', timeWindow: { partOfDay: 'afternoon' } };
        const { state } = await turn('mañana', kept);
        expect(state).not.toHaveProperty('timeWindow');
        expect(offered(state)[0]).toBe('09:00');
    });

    it.each(phrasings)('same text and state as a run that never heard of windows: %s', async text => {
        // The flag-off engine and interpreter are fed the same inputs twice: once as production calls them
        // today (no options at all) and once with every PR8 input explicitly off.
        const plain = await salon(false).turn(text);
        const { executor } = salonExecutor({ flag: false });
        const engine = new BookingEngineService(
            { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
            { get: async () => JSON.stringify(SERVICES), set: async () => {}, del: async () => {} } as any,
            { execute: (...args: any[]) => (executor.execute as any)(...args) } as any,
        );
        const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
        const intent = await interpreter.interpret(text, 'idle', SERVICES.map(s => s.name), today, upcoming, SALON_TENANT_ID, null, [], salonHours, { slotWindow: false });
        const explicitOff = await engine.process('tenant_salon', SALON_TENANT_ID, 'contact', intent, text, { step: 'idle' }, {}, today, 'es',
            { authority, conversationId: 'conv', slotWindow: false });
        // `missionId` and `progressedAt` (the draft's continuity stamp) are per-run values, not behaviour.
        expect(explicitOff.text).toBe(plain.text);
        expect(JSON.stringify({ ...explicitOff.state, missionId: 'x', progressedAt: 'x' })).toBe(JSON.stringify({ ...plain.state, missionId: 'x', progressedAt: 'x' }));
    });
});
