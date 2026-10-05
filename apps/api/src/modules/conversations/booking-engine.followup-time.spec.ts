import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * La hora pedida en un mensaje POSTERIOR al de la fecha, las recomendaciones
 * pendientes y el texto de la recomendación.
 *
 * El mock de la herramienta imita a la real: como mucho 6 huecos, los más
 * cercanos a `args.time` (los 6 primeros si no hay hora), en orden cronológico.
 * Un mock que devuelve el día entero oculta justo estos fallos.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const idA = '44444444-4444-4444-8444-444444444444';
const idB = '55555555-5555-4555-8555-555555555555';
const date = '2026-08-15';
const services = [
    { id: idA, name: 'Consulta', durationMinutes: 30, price: 2500, currency: 'USD' },
    { id: idB, name: 'Masaje', durationMinutes: 30, price: 3500, currency: 'USD' },
];
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const make = (t: string, staffId?: string, staffName?: string) => ({ time: t, endTime: hhmm(mins(t) + 30), staffId, staffName });
const dayFrom = (skip: string[] = [], staff?: [string, string]) =>
    Array.from({ length: 20 }, (_, i) => hhmm(8 * 60 + i * 30)).filter(t => !skip.includes(t)).map(t => make(t, staff?.[0], staff?.[1]));

/** Igual que la herramienta: a lo sumo 6 huecos, centrados en `time`. */
function realisticTool(all: Array<ReturnType<typeof make>>) {
    return jest.fn(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        if (name !== 'check_availability') return { success: true };
        const target = args?.time ? mins(args.time) : null;
        const pick = target === null
            ? all.slice(0, 6)
            : all.map((s, i) => ({ s, i, d: Math.abs(mins(s.time) - target) }))
                .sort((a, b) => a.d - b.d || a.i - b.i).slice(0, 6).sort((a, b) => a.i - b.i).map(e => e.s);
        return { available: pick.length > 0, date, slots: pick };
    });
}

function harness(all = dayFrom(), lang = 'es', catalog = services) {
    const execute = realisticTool(all);
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: jest.fn().mockResolvedValue(JSON.stringify(catalog)), set: jest.fn() } as any,
        { execute } as any,
    );
    const turn = (state: BookingState, intent: Record<string, unknown>, rawText = 'x', flowData?: Record<string, unknown>) =>
        engine.process('tenant_followup', tenantId, contactId, intent as any, rawText, state, {}, '2026-08-08', lang,
            { authority, conversationId, ...(flowData ? { flowData, flowResponseToken: 'tok' } : {}) } as any);
    const start = (): BookingState => ({ step: 'ask_date', services, serviceId: idA, serviceName: 'Consulta' });
    return { execute, turn, start };
}
const times = (s?: Array<{ time: string }>) => (s ?? []).map(x => x.time);

describe('requested time in a later message than the date', () => {
    it('takes 16:00 when it is free, even though the first list stopped at 10:30', async () => {
        const h = harness();
        const first = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date }, 'el sábado');
        expect(times(first.state.slots)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']);
        const second = await h.turn(first.state, { intent: 'select_slot', timeMentioned: '16:00' }, 'a las 16:00');

        expect(second.state.time).toBe('16:00');
        expect(second.state.step).toBe('ask_name');
        expect(second.text).not.toMatch(/no est[aá] disponible/i);
    });

    it('does not recommend 10:30 when 11:00 is free', async () => {
        const h = harness();
        const first = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date }, 'el sábado');
        const second = await h.turn(first.state, { intent: 'select_slot', timeMentioned: '11:00' }, 'a las 11:00');

        expect(second.state.time).toBe('11:00');
        expect(second.state.suggestedSlots).toBeUndefined();
    });
});

describe('pending recommendations', () => {
    const afternoonGap = () => dayFrom(['15:30', '16:00']); // 16:00 pedido -> solo 16:30 a +-30

    it('picks "la primera" among the recommended slots, not among the earlier list', async () => {
        const h = harness();
        const first = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:10' }, 'sábado 16:10');
        expect(times(first.state.suggestedSlots)).toEqual(['16:00', '16:30']);
        const second = await h.turn(first.state, { intent: 'select_slot' }, 'la primera');

        expect(second.state.time).toBe('16:00');
    });

    it('accepts a single recommendation with an explicit yes', async () => {
        const h = harness(afternoonGap());
        const first = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:00' }, 'sábado 16:00');
        expect(times(first.state.suggestedSlots)).toEqual(['16:30']);
        const second = await h.turn(first.state, { intent: 'confirm', isConfirmation: true }, 'sí');

        expect(second.state.time).toBe('16:30');
    });

    it.each([
        ['switching service', { intent: 'select_service', serviceMentioned: 'Masaje' }, 'mejor el masaje'],
        ['cancelling', { intent: 'cancel' }, 'cancelar'],
    ])('a later yes does not accept a recommendation left over after %s', async (_label, intent, text) => {
        const h = harness(afternoonGap());
        const first = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:00' }, 'sábado 16:00');
        const middle = await h.turn(first.state, intent, text);
        expect(middle.state.suggestedSlots).toBeUndefined();
        const last = await h.turn(middle.state, { intent: 'confirm', isConfirmation: true }, 'sí');

        expect(last.state.time).toBeUndefined();
    });

    it('clears recommendations on confirm_no, a slot_ button and a human handoff', async () => {
        const base = (): BookingState => ({
            step: 'show_slots', services, serviceId: idA, serviceName: 'Consulta', date,
            slots: [make('15:00'), make('16:30')], suggestedSlots: [make('16:30')], confirmationId: 'c1',
        });
        const h = harness();
        const no = await h.turn({ ...base(), step: 'confirm' }, { intent: 'unknown' }, 'confirm_no:c1');
        expect(no.state.suggestedSlots).toBeUndefined();
        const button = await h.turn(base(), { intent: 'unknown' }, 'slot_15:00');
        expect(button.state.time).toBe('15:00');
        expect(button.state.suggestedSlots).toBeUndefined();
        h.execute.mockResolvedValueOnce({ available: false, error: 'appointments_not_configured', slots: [] } as any);
        const handoff = await h.turn({ ...base(), slots: undefined, suggestedSlots: [make('16:30')] }, { intent: 'ask_availability', dateMentioned: date }, 'x');
        expect(handoff.handoff).toBe(true);
        expect(handoff.state.suggestedSlots).toBeUndefined();
    });

    it('does not accept a recommendation outside show_slots or one no longer in the offered list', async () => {
        const h = harness();
        const outside: BookingState = {
            step: 'ask_date', services, serviceId: idA, serviceName: 'Consulta', date,
            slots: [make('16:30')], suggestedSlots: [make('16:30')],
        };
        expect((await h.turn(outside, { intent: 'confirm', isConfirmation: true }, 'sí')).state.time).toBeUndefined();
        const gone: BookingState = {
            step: 'show_slots', services, serviceId: idA, serviceName: 'Consulta', date,
            slots: [make('09:00')], suggestedSlots: [make('16:30')],
        };
        expect((await h.turn(gone, { intent: 'confirm', isConfirmation: true }, 'sí')).state.time).toBeUndefined();
    });
});

describe('date and time together on the first turn', () => {
    it('takes a free requested time with its professional and moves on', async () => {
        const h = harness(dayFrom([], ['staff-1', 'Dra. Ruiz']));
        const result = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:00' }, 'sábado 16:00');

        expect(result.state.time).toBe('16:00');
        expect(result.state.staffId).toBe('staff-1');
        expect(result.state.step).toBe('ask_name');
    });

    it('says the time is not available when nothing is within 30 minutes, and lists what is', async () => {
        const h = harness(dayFrom().filter(s => mins(s.time) < 11 * 60));
        const result = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:00' }, 'sábado 16:00');

        expect(result.state.time).toBeUndefined();
        expect(result.state.step).toBe('show_slots');
        expect(result.text).toMatch(/no est[aá] disponible/i);
        expect(result.text).toContain('10:30');
    });

    it('Flow: a picked time that is not free is not kept in state', async () => {
        const h = harness(dayFrom().filter(s => mins(s.time) < 11 * 60));
        const state: BookingState = { step: 'waiting_flow', flowToken: 'tok', flowStartedAt: new Date().toISOString(), services };
        const result = await h.turn(state, { intent: 'unknown' }, '__flow_response__',
            { service_id: idA, date, time: '16:00', customer_name: 'Ana Perez', customer_email: 'ana@example.test' });

        expect(result.state.time).toBeUndefined();
        expect(result.text).toMatch(/no est[aá] disponible/i);
        expect(h.execute.mock.calls.some(c => c[3] === 'create_appointment')).toBe(false);
    });
});

describe('text of the recommendation', () => {
    const gap = () => dayFrom(['16:00']);
    const ask = async (lang: string, all = gap()) => {
        const h = harness(all, lang);
        return h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:00' }, 'x');
    };

    it.each([
        ['es', /recomiendo las 15:30 o las 16:30/, /¿Cuál te sirve\?/],
        ['en', /recommend 15:30 or 16:30/, /Which one works/],
        ['pt', /Recomendo as 15:30 ou as 16:30/, /Qual serve/],
        ['fr', /recommande 15:30 ou 16:30/, /Lequel vous convient/],
    ])('%s: only start times, no ranges, asks which one', async (lang, offer, ask2) => {
        const { text } = await ask(lang);
        expect(text).toMatch(offer);
        expect(text).toMatch(ask2);
        expect(text).not.toMatch(/\d\d:\d\d\s*[-–]\s*\d\d:\d\d/);
    });

    it('uses the agreeing form in es, pt and fr, like the plain unavailable message', async () => {
        expect((await ask('es')).text).toContain('El horario de las 16:00 no está disponible');
        expect((await ask('pt')).text).toContain('O horário das 16:00 não está disponível');
        expect((await ask('fr')).text).toContain("n'est pas disponible");
    });

    it('offers each hour once when several professionals are free at the same time', async () => {
        const two = dayFrom(['16:00']).flatMap(s => [{ ...s, staffId: 's1', staffName: 'Ana' }, { ...s, staffId: 's2', staffName: 'Luis' }]);
        const { text, state } = await ask('es', two);

        expect(times(state.suggestedSlots)).toEqual(['15:30', '16:30']);
        expect(text!.match(/15:30/g)).toHaveLength(1);
    });
});

describe('slot order', () => {
    it('shows the day in chronological order even when the agenda rows arrive shuffled', async () => {
        const shuffled = [...dayFrom()].reverse();
        const h = harness(shuffled);
        h.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
            name === 'check_availability' ? { available: true, date, slots: shuffled } : { success: true });
        const result = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date }, 'x');

        expect(times(result.state.slots)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']);
    });
});

describe('changing the time after the slot was already chosen', () => {
    const window = (from: string, to: string) => dayFrom().filter(s => mins(s.time) >= mins(from) && mins(s.time) <= mins(to));
    const late = (step: BookingState['step']): BookingState => ({
        step, services, serviceId: idA, serviceName: 'Consulta', date, time: '16:00',
        slots: window('14:30', '17:00'), customerName: 'Ana Perez', customerEmail: step === 'ask_email' ? undefined : 'ana@example.test',
        ...(step === 'confirm' ? { confirmationId: 'old', confirmationHash: 'old-hash', confirmationIssuedAt: new Date().toISOString() } : {}),
    });
    const created = (h: ReturnType<typeof harness>) => h.execute.mock.calls.filter(c => c[3] === 'create_appointment');

    it('confirm + "mejor a las 17:30" (free): new summary with 17:30, and a yes books 17:30', async () => {
        const h = harness();
        const changed = await h.turn(late('confirm'), { intent: 'select_slot', timeMentioned: '17:30' }, 'mejor a las 17:30');
        expect(changed.state.time).toBe('17:30');
        expect(changed.state.confirmationId).not.toBe('old');
        expect(changed.text).toContain('17:30');
        expect(changed.text).not.toContain('16:00');
        await h.turn(changed.state, { intent: 'confirm', isConfirmation: true }, 'sí');
        for (const call of created(h)) expect((call[4] as any).time).toBe('17:30');
    });

    it('confirm + a time that is not free: drops the old time and proposal and never books the old one', async () => {
        const h = harness(dayFrom().filter(s => mins(s.time) < 11 * 60 || s.time === '16:00'));
        const changed = await h.turn(late('confirm'), { intent: 'select_slot', timeMentioned: '17:30' }, 'mejor a las 17:30');
        expect(changed.state.time).toBeUndefined();
        expect(changed.state.staffId).toBeUndefined();
        expect(changed.state.confirmationId).toBeUndefined();
        expect(changed.state.step).toBe('show_slots');
        expect(changed.text).toMatch(/no est[aá] disponible/i);
        await h.turn(changed.state, { intent: 'confirm', isConfirmation: true }, 'sí');
        expect(created(h)).toHaveLength(0);
    });

    it('ask_email + another free time replaces the time', async () => {
        const h = harness();
        const changed = await h.turn(late('ask_email'), { intent: 'select_slot', timeMentioned: '17:30' }, 'mejor a las 17:30');
        expect(changed.state.time).toBe('17:30');
        expect(changed.state.step).toBe('ask_email');
    });

    it('ask_email + a busy time recommends a neighbour instead of keeping the old time', async () => {
        const h = harness(dayFrom(['17:30']));
        const changed = await h.turn(late('ask_email'), { intent: 'select_slot', timeMentioned: '17:30' }, 'mejor a las 17:30');
        expect(changed.state.time).toBeUndefined();
        expect(changed.state.step).toBe('show_slots');
        expect(times(changed.state.suggestedSlots)).toEqual(['17:00']);
        expect(changed.text).toMatch(/recomiendo/i);
    });

    it('repeating the time already chosen keeps the booking as it is', async () => {
        const h = harness();
        const same = await h.turn(late('confirm'), { intent: 'select_slot', timeMentioned: '16:00' }, 'a las 16:00');
        expect(same.state.time).toBe('16:00');
        expect(same.state.step).toBe('confirm');
    });
});

describe('time asked together with a service change', () => {
    it('queries the NEW service, not the old one that has no slots', async () => {
        const h = harness();
        (h.execute as jest.Mock).mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) => {
            if (name !== 'check_availability') return { success: true };
            if (args.serviceId === idA) return { available: false, slots: [], message: 'Not available' };
            const target = mins(args.time);
            const pick = dayFrom().map((s, i) => ({ s, i, d: Math.abs(mins(s.time) - target) }))
                .sort((a, b) => a.d - b.d || a.i - b.i).slice(0, 6).sort((a, b) => a.i - b.i).map(e => e.s);
            return { available: true, date, slots: pick };
        });
        const state: BookingState = { step: 'show_slots', services, serviceId: idA, serviceName: 'Consulta', date, slots: dayFrom().slice(0, 3) };
        const result = await h.turn(state, { intent: 'select_service', serviceMentioned: 'Masaje', timeMentioned: '17:30' }, 'mejor masaje a las 17:30');

        expect(result.state.serviceId).toBe(idB);
        expect(result.state.time).toBe('17:30');
        expect(result.text).not.toMatch(/completamente lleno|no encontr|no tenemos horarios/i);
    });
});

describe('a yes while two recommendations are pending', () => {
    it('repeats only the recommended times, so "la primera" means what the customer just read', async () => {
        const h = harness();
        const first = await h.turn(h.start(), { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:10' }, 'x');
        expect(times(first.state.suggestedSlots)).toEqual(['16:00', '16:30']);
        const yes = await h.turn(first.state, { intent: 'confirm', isConfirmation: true }, 'sí');

        expect(yes.text).toContain('16:00');
        expect(yes.text).toContain('16:30');
        expect(yes.text).not.toContain('15:00');
        expect(yes.text).not.toContain('17:30');
    });
});

describe('remaining first-turn and stale-state cases', () => {
    it('single service with date and time in the first message takes a free time', async () => {
        const h = harness(dayFrom(), 'es', [services[0]]);
        const state: BookingState = { step: 'idle', services: [services[0]] };
        const result = await h.turn(state, { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:00' }, 'sábado 16:00');

        expect(result.state.serviceId).toBe(idA);
        expect(result.state.time).toBe('16:00');
        expect(result.state.step).toBe('ask_name');
    });

    it('a past date drops pending recommendations', async () => {
        const h = harness();
        const state: BookingState = {
            step: 'show_slots', services, serviceId: idA, serviceName: 'Consulta', date,
            slots: [make('15:00'), make('16:30')], suggestedSlots: [make('16:30')],
        };
        const result = await h.turn(state, { intent: 'ask_availability', dateMentioned: '2026-08-01' }, 'x');

        expect(result.state.suggestedSlots).toBeUndefined();
        expect(result.state.date).toBeUndefined();
    });
});

describe('a service mention that is not another service', () => {
    const shown = (): BookingState => ({
        step: 'show_slots', services, serviceId: idA, serviceName: 'Consulta', date, slots: dayFrom().slice(0, 6),
    });

    it.each([
        ['the same service with an article', 'la consulta'],
        ['a service that does not exist', 'depilación'],
    ])('%s does not block the re-query: a free 16:00 is taken', async (_label, mention) => {
        const h = harness();
        const result = await h.turn(shown(), { intent: 'select_slot', serviceMentioned: mention, timeMentioned: '16:00' }, `${mention} a las 16:00`);

        expect(result.state.serviceId).toBe(idA);
        expect(result.state.time).toBe('16:00');
        expect(result.text).not.toMatch(/no est[aá] disponible/i);
    });
});
