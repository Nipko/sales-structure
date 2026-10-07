import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { restoreBookingMission } from './booking-state-continuity';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Follow-ups of the "offer, don't apply" change (PR #55):
 *  - an ORDER to switch service has to work at the late steps too (ask_name / ask_email / confirm), where
 *    the interpreter deliberately does not read service names, and must not be taken for a slot correction;
 *  - a dormant draft that is resumed by a question about another service gets the offer, not a silent switch;
 *  - a question about another DAY or hour of the draft's own service answers and offers; it does not rewrite
 *    the draft (it used to overwrite the date, clear the time and hand the turn to the model).
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const CORTE = { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'confirmed' as const };
const COLOR = { id: 'svc-color', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, currency: 'COP', priceStatus: 'confirmed' as const };
const MANI = { id: 'svc-mani', name: 'Manicure y pedicure', durationMinutes: 60, price: 50000, currency: 'COP', priceStatus: 'confirmed' as const };
const services = [CORTE, COLOR, MANI];
const today = '2026-10-05';
const FRIDAY = '2026-10-09';
const SATURDAY = '2026-10-10';
const SUNDAY = '2026-10-11';
const upcoming = [
    { date: FRIDAY, weekday: 'viernes' }, { date: SATURDAY, weekday: 'sabado' }, { date: SUNDAY, weekday: 'domingo' },
];
const COMPOUND = '¿Cuánto dura color y tratamiento y tienen cupo el sábado a las 16:00?';
const T0 = Date.parse('2026-10-05T12:00:00Z');

type Slots = Array<{ time: string; endTime: string }>;
const slot = (time: string, endTime = '23:59') => ({ time, endTime });

function harness(opts: { corte?: Record<string, Slots>; color?: Record<string, Slots>; corteFails?: boolean } = {}) {
    const corte = opts.corte ?? { [SATURDAY]: [slot('16:00'), slot('17:00')], [SUNDAY]: [slot('10:00'), slot('11:00')], [FRIDAY]: [slot('15:00')] };
    const color = opts.color ?? { [SATURDAY]: [slot('15:00'), slot('16:00')], [SUNDAY]: [slot('09:00'), slot('10:00')] };
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        if (name === 'list_services') return { services };
        if (name === 'check_availability') {
            if (opts.corteFails && args.serviceId === CORTE.id) return { available: false, error: 'tool_failed', slots: [] };
            const table = args.serviceId === COLOR.id ? color : corte;
            const slots = table[args.date] ?? [];
            return slots.length ? { available: true, slots } : { available: false, slots: [] };
        }
        return { success: true, appointment: { id: 'apt-1', status: 'confirmed' } };
    });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify(services), set: async () => {}, del: async () => {} } as any,
        { execute } as any,
    );
    const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
    const turn = async (text: string, state: BookingState) => {
        const names = state.step === 'idle' ? [] : services.map(s => s.name);
        const intent = await interpreter.interpret(text, state.step, names, today, upcoming);
        const result = await engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, 'es',
            { authority, conversationId: 'conversation' });
        return { intent, result };
    };
    const writes = () => execute.mock.calls.filter(call => call[3] === 'create_appointment');
    const availabilityCalls = () => execute.mock.calls.filter(call => call[3] === 'check_availability').map(call => call[4]);
    return { turn, writes, availabilityCalls };
}

const draftAt = (step: BookingState['step'], extra: Partial<BookingState> = {}): BookingState => ({
    missionId: 'm-draft', step, serviceId: CORTE.id, serviceName: CORTE.name, date: SATURDAY, time: '16:00',
    slots: [slot('16:00', '16:45'), slot('17:00', '17:45')], customerName: 'Joaquin Sosa', services, ...extra,
});
const LATE: Array<[string, BookingState]> = [
    ['ask_name', draftAt('ask_name', { customerName: undefined })],
    ['ask_email', draftAt('ask_email')],
    ['confirm', draftAt('confirm', { customerEmail: 'joaquin@example.com' })],
];
const draftCore = (state: BookingState) => ({
    serviceId: state.serviceId, date: state.date, time: state.time, step: state.step,
    customerName: state.customerName, customerEmail: state.customerEmail,
});

describe('an order to switch service works at the late steps', () => {
    describe.each(LATE)('at %s', (_step, open) => {
        it.each([
            'quiero color y tratamiento el sábado a las 16:00',
            'color y tratamiento el sábado a las 16:00',
            'mejor cámbiala a color y tratamiento el sábado a las 16:00',
            'cambia mi cita a color y tratamiento el sábado a las 16:00',
            'En vez de corte, color y tratamiento el sábado a las 16:00',
            'prefiero color y tratamiento el sábado a las 16:00',
        ])('"%s" moves the draft to the other service and checks its slot', async text => {
            const { turn, writes } = harness();
            const { result } = await turn(text, structuredClone(open));
            expect(result.handled).toBe(true);
            expect(result.text ?? '').not.toMatch(/identificar|corregir/i);
            expect(result.state).toMatchObject({ serviceId: COLOR.id, serviceName: COLOR.name, date: SATURDAY, time: '16:00' });
            expect(result.state.customerName).toBe(open.customerName);
            expect(result.state.customerEmail).toBe(open.customerEmail);
            expect(result.state.pendingSwitch).toBeUndefined();
            expect(writes()).toHaveLength(0);
        });

        it.each([
            'mejor cámbiala a color y tratamiento', 'prefiero color y tratamiento', 'En vez de corte, color y tratamiento',
            'cambia mi cita a color y tratamiento',
        ])('"%s" (no day) moves the draft and asks for the day, without taking the order for a name or an e-mail', async text => {
            const { turn } = harness();
            const { result } = await turn(text, structuredClone(open));
            expect(result.handled).toBe(true);
            expect(result.text ?? '').not.toMatch(/identificar|corregir|correo/i);
            expect(result.state).toMatchObject({ serviceId: COLOR.id, step: 'ask_date' });
            expect(result.state.customerName).toBe(open.customerName);
        });

        it('"¿puedo cambiar a color y tratamiento el sábado?" is a question: answered and offered, draft untouched', async () => {
            const { turn } = harness();
            const { result } = await turn('¿puedo cambiar a color y tratamiento el sábado?', structuredClone(open));
            expect(result.handled).toBe(true);
            expect(result.text ?? '').not.toMatch(/identificar|corregir/i);
            expect(draftCore(result.state)).toEqual(draftCore(open));
            expect(result.state.pendingSwitch).toMatchObject({ serviceId: COLOR.id });
            expect(result.text).toContain('¿Desea cambiar su cita de Corte y estilo por Color y tratamiento');
        });
    });

    it('a name or an e-mail that only resembles a service word is still a name or an e-mail', async () => {
        const { turn } = harness();
        const name = await turn('Cortés Martínez', draftAt('ask_name', { customerName: undefined }));
        expect(name.result.state).toMatchObject({ serviceId: CORTE.id, customerName: 'Cortés Martínez' });
        const color = await turn('Rosa Color', draftAt('ask_name', { customerName: undefined }));
        expect(color.result.state).toMatchObject({ serviceId: CORTE.id, customerName: 'Rosa Color' });
        const mail = await turn('mi correo es corte.estilo@example.com', draftAt('ask_email'));
        expect(mail.result.state).toMatchObject({ serviceId: CORTE.id, customerEmail: 'corte.estilo@example.com' });
    });

    it('naming the draft\'s own service is not a switch', async () => {
        const { turn } = harness();
        const { result } = await turn('sí, para corte y estilo', draftAt('ask_email'));
        expect(result.state.serviceId).toBe(CORTE.id);
    });

    it('a directed correction of the e-mail is still a correction', async () => {
        const { turn } = harness();
        const { result } = await turn('el correo es nuevo@example.com', draftAt('ask_email'));
        expect(result.state).toMatchObject({ serviceId: CORTE.id, customerEmail: 'nuevo@example.com' });
    });
});

describe('a dormant draft resumed by a question about another service gets the offer', () => {
    const dormant = (draft: BookingState): BookingState => {
        const savedAt = new Date(T0).toISOString();
        return restoreBookingMission({ ...draft, savedAt }, savedAt, T0 + 31 * 60_000).state;
    };

    it('answers the question and offers; the dormant draft is not moved silently', async () => {
        const { turn, writes } = harness();
        const asleep = dormant(draftAt('ask_email'));
        expect(asleep.resumeOffer).toBe('pending');
        const { result } = await turn(COMPOUND, asleep);
        expect(result.handled).toBe(true);
        expect(result.state.serviceId).toBe(CORTE.id);
        expect(result.text).toMatch(/120 minutos/);
        expect(result.text).toMatch(/hay cupo/i);
        expect(result.text).toContain('¿Desea cambiar su cita de Corte y estilo por Color y tratamiento');
        expect(result.text).not.toMatch(/correo/i);
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: COLOR.id, date: SATURDAY, time: '16:00' });
        expect(writes()).toHaveLength(0);
    });

    it('a yes then moves it, with the slot checked again', async () => {
        const { turn } = harness();
        const first = await turn(COMPOUND, dormant(draftAt('ask_email')));
        const second = await turn('sí', first.result.state);
        expect(second.result.state).toMatchObject({ serviceId: COLOR.id, date: SATURDAY, time: '16:00' });
        expect(second.result.state.pendingSwitch).toBeUndefined();
    });
});

describe('a question about another day or hour of the SAME service does not rewrite the draft', () => {
    it.each([
        ['ask_name', draftAt('ask_name', { customerName: undefined })],
        ['ask_email', draftAt('ask_email')],
        ['confirm', draftAt('confirm', { customerEmail: 'joaquin@example.com' })],
    ] as Array<[string, BookingState]>)('at %s: "¿Tienen cupo el domingo a las 10 para corte y estilo?" answers and offers', async (_step, open) => {
        const { turn, availabilityCalls, writes } = harness();
        const { result } = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', structuredClone(open));
        expect(result.handled).toBe(true);
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.state.slots).toEqual(open.slots);
        expect(result.text).toMatch(/hay cupo/i);
        expect(result.text).toMatch(/¿Desea cambiar su cita de Corte y estilo al domingo/);
        expect(result.text).toMatch(/10:00/);
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: CORTE.id, date: SUNDAY, time: '10:00' });
        expect(availabilityCalls()).toContainEqual({ date: SUNDAY, serviceId: CORTE.id, time: '10:00' });
        expect(writes()).toHaveLength(0);
    });

    it('"¿y el viernes a las 15:00?" at ask_email', async () => {
        const { turn } = harness();
        const open = draftAt('ask_email');
        const { result } = await turn('¿y el viernes a las 15:00?', structuredClone(open));
        expect(result.handled).toBe(true);
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: CORTE.id, date: FRIDAY, time: '15:00' });
    });

    it('says the hour is taken and keeps the draft when the day has other hours', async () => {
        const { turn } = harness({ corte: { [SUNDAY]: [slot('11:00'), slot('12:00')] } });
        const open = draftAt('ask_email');
        const { result } = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', structuredClone(open));
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.text).toMatch(/no hay cupo/i);
        expect(result.text).toMatch(/11:00/);
        expect(result.state.pendingSwitch).toMatchObject({ date: SUNDAY });
        expect(result.state.pendingSwitch?.time).toBeUndefined();
    });

    it('says the day is full and just keeps the draft', async () => {
        const { turn } = harness({ corte: {} });
        const open = draftAt('ask_email');
        const { result } = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', structuredClone(open));
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.text).toMatch(/no hay disponibilidad/i);
        expect(result.text).toMatch(/sigue como estaba/i);
        expect(result.state.pendingSwitch).toBeUndefined();
    });

    it('leaves the model to answer, draft untouched, when availability cannot be checked', async () => {
        const { turn } = harness({ corteFails: true });
        const open = draftAt('ask_email');
        const { result } = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', structuredClone(open));
        expect(result.handled).toBe(false);
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.state.slots).toEqual(open.slots);
    });

    it('a yes moves the draft to that day and hour, re-checked', async () => {
        const { turn } = harness();
        const first = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', draftAt('ask_email'));
        const second = await turn('sí', first.result.state);
        expect(second.result.state).toMatchObject({ serviceId: CORTE.id, date: SUNDAY, time: '10:00' });
        expect(second.result.state.step).toBe('ask_email');
    });

    it('a no keeps the draft and does not cancel it', async () => {
        const { turn } = harness();
        const open = draftAt('ask_email');
        const first = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', structuredClone(open));
        const second = await turn('no', first.result.state);
        expect(draftCore(second.result.state)).toEqual(draftCore(open));
        expect(second.result.state.pendingSwitch).toBeUndefined();
        expect(second.result.state.pausedAt).toBeUndefined();
    });

    it('an ORDER ("mejor el domingo a las 10") still changes the draft directly', async () => {
        const { turn } = harness();
        const { result } = await turn('mejor el domingo a las 10', draftAt('ask_email'));
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: CORTE.id, date: SUNDAY, time: '10:00' });
        expect(result.state.pendingSwitch).toBeUndefined();
    });

    it('a question that repeats the draft\'s own day and hour changes nothing and offers nothing', async () => {
        const { turn } = harness();
        const open = draftAt('ask_email');
        const { result } = await turn('¿Mi cita es el sábado a las 16:00?', structuredClone(open));
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(draftCore(result.state)).toEqual(draftCore(open));
    });

    it('while the customer is still choosing the slot, an hour question is the answer to the step (unchanged)', async () => {
        const { turn } = harness();
        const open = draftAt('show_slots', { time: undefined, slots: [slot('16:00'), slot('17:00')] });
        const { result } = await turn('¿tienen a las 17:00?', structuredClone(open));
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(result.state.time).toBe('17:00');
    });
});

describe('"sí, pero el domingo" does not carry the offered hour over to another day', () => {
    it('drops the offered 16:00 and shows the new day\'s slots (16:00 is free that day too: it is still not assumed)', async () => {
        const { turn } = harness({ color: { [SATURDAY]: [slot('15:00'), slot('16:00')], [SUNDAY]: [slot('09:00'), slot('10:00'), slot('16:00')] } });
        const first = await turn(COMPOUND, draftAt('show_slots', { time: undefined }));
        expect(first.result.state.pendingSwitch).toMatchObject({ date: SATURDAY, time: '16:00' });
        const second = await turn('sí, pero el domingo', first.result.state);
        expect(second.result.state).toMatchObject({ serviceId: COLOR.id, date: SUNDAY, step: 'show_slots' });
        expect(second.result.state.time).toBeUndefined();
    });

    it('keeps the offered hour when the yes names the same day, or brings an hour of its own', async () => {
        const { turn } = harness();
        const first = await turn(COMPOUND, draftAt('show_slots', { time: undefined }));
        const same = await turn('sí, el sábado', first.result.state);
        expect(same.result.state).toMatchObject({ serviceId: COLOR.id, date: SATURDAY, time: '16:00' });
        const own = await turn('sí, el domingo a las 10', first.result.state);
        expect(own.result.state).toMatchObject({ serviceId: COLOR.id, date: SUNDAY, time: '10:00' });
    });
});
