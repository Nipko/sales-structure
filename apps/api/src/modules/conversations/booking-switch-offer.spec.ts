import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production evidence (tenant "Salon QA Citas", Telegram): with a live draft for «Corte y estilo» the
 * customer asked «¿Cuánto dura color y tratamiento y tienen cupo el sábado a las 16:00?». The engine read
 * the service name as a change of mind, moved the draft to Color y tratamiento at 16:00 and asked for the
 * e-mail ("¡Gracias Joaquin Sosa! Necesito tu correo"): the booking was changed silently and the slot
 * was never confirmed with the customer.
 *
 * A QUESTION about another service (with a date or time riding along) is answered, and the change is
 * OFFERED. Only a statement ("mejor cámbiala a color y tratamiento…") switches directly, and a yes to the
 * offer is the customer's agreement to switch.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const CORTE = { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'confirmed' as const };
const COLOR = { id: 'svc-color', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, currency: 'COP', priceStatus: 'confirmed' as const };
const MANI = { id: 'svc-mani', name: 'Manicure y pedicure', durationMinutes: 60, price: 50000, currency: 'COP', priceStatus: 'confirmed' as const };
const services = [CORTE, COLOR, MANI];
const today = '2026-10-05';
const SATURDAY = '2026-10-10';
const upcoming = [{ date: SATURDAY, weekday: 'sabado' }, { date: '2026-10-11', weekday: 'domingo' }];
const COMPOUND = '¿Cuánto dura color y tratamiento y tienen cupo el sábado a las 16:00?';

type Slots = Array<{ time: string; endTime: string }>;

function harness(opts: { colorSlots?: Slots; colorFails?: boolean } = {}) {
    const colorSlots = opts.colorSlots ?? [{ time: '15:00', endTime: '17:00' }, { time: '16:00', endTime: '18:00' }];
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        if (name === 'list_services') return { services };
        if (name === 'check_availability') {
            if (args.serviceId === COLOR.id) {
                if (opts.colorFails) return { available: false, error: 'tool_failed', slots: [] };
                return colorSlots.length ? { available: true, slots: colorSlots } : { available: false, slots: [] };
            }
            return { available: true, slots: [{ time: '16:00', endTime: '16:45' }, { time: '17:00', endTime: '17:45' }] };
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
        // In production the interpreter knows the catalog mid-mission (names come from the persisted state).
        const names = state.step === 'idle' ? [] : services.map(s => s.name);
        const intent = await interpreter.interpret(text, state.step, names, today, upcoming);
        const result = await engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, 'es',
            { authority, conversationId: 'conversation' });
        return { intent, result };
    };
    const writes = () => execute.mock.calls.filter(call => call[3] === 'create_appointment');
    const availabilityCalls = () => execute.mock.calls.filter(call => call[3] === 'check_availability').map(call => call[4]);
    return { turn, writes, availabilityCalls, execute };
}

const draftAt = (step: BookingState['step'], extra: Partial<BookingState> = {}): BookingState => ({
    missionId: 'm-draft', step, serviceId: CORTE.id, serviceName: CORTE.name, date: SATURDAY, time: '16:00',
    slots: [{ time: '16:00', endTime: '16:45' }, { time: '17:00', endTime: '17:45' }],
    customerName: 'Joaquin Sosa', services, ...extra,
});

const STEPS: Array<[string, BookingState]> = [
    ['ask_date', { missionId: 'm-draft', step: 'ask_date', serviceId: CORTE.id, serviceName: CORTE.name, services }],
    ['show_slots', draftAt('show_slots', { time: undefined })],
    ['ask_name', draftAt('ask_name', { customerName: undefined })],
    ['ask_email', draftAt('ask_email')],
    ['confirm', draftAt('confirm', { customerEmail: 'joaquin@example.com' })],
];

/** The slice of the draft the customer built: none of it may move when they only ASK about another service. */
const draftCore = (state: BookingState) => ({
    serviceId: state.serviceId, serviceName: state.serviceName, date: state.date, time: state.time, step: state.step,
    customerName: state.customerName, customerEmail: state.customerEmail,
});

describe('a question about ANOTHER service with a live draft is answered and the change is offered', () => {
    it.each(STEPS)('at %s: the draft is not changed, the question is answered, the switch is offered', async (_step, open) => {
        const { turn, writes } = harness();
        const before = draftCore(open);
        const { result } = await turn(COMPOUND, structuredClone(open));
        expect(result.handled).toBe(true);
        expect(draftCore(result.state)).toEqual(before);
        // The duration of the service asked about, and whether that slot is really free for it.
        expect(result.text).toMatch(/120 minutos/);
        expect(result.text).toMatch(/16:00/);
        expect(result.text).toMatch(/hay cupo/i);
        expect(result.text).toContain('¿Desea cambiar su cita de Corte y estilo por Color y tratamiento');
        expect(result.text).not.toMatch(/correo|Gracias Joaquin/i);
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: COLOR.id, date: SATURDAY, time: '16:00' });
        expect(writes()).toHaveLength(0);
    });

    it('checks the OTHER service for that day and time without touching the draft slots', async () => {
        const { turn, availabilityCalls } = harness();
        const open = draftAt('ask_email');
        const { result } = await turn(COMPOUND, structuredClone(open));
        expect(availabilityCalls()).toContainEqual({ date: SATURDAY, serviceId: COLOR.id, time: '16:00' });
        expect(result.state.slots).toEqual(open.slots);
    });

    it('says so when that time is taken and offers what is free, still without switching', async () => {
        const { turn } = harness({ colorSlots: [{ time: '15:00', endTime: '17:00' }, { time: '17:00', endTime: '19:00' }] });
        const open = draftAt('ask_email');
        const { result } = await turn(COMPOUND, structuredClone(open));
        expect(result.handled).toBe(true);
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.text).toMatch(/16:00/);
        expect(result.text).toMatch(/no hay cupo/i);
        expect(result.text).toMatch(/15:00/);
        expect(result.text).toContain('¿Desea cambiar su cita de Corte y estilo por Color y tratamiento');
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: COLOR.id, date: SATURDAY });
        expect(result.state.pendingSwitch?.time).toBeUndefined();
    });

    it('says so when the day is full', async () => {
        const { turn } = harness({ colorSlots: [] });
        const { result } = await turn(COMPOUND, draftAt('ask_email'));
        expect(result.handled).toBe(true);
        expect(result.text).toMatch(/no hay disponibilidad/i);
        expect(result.state.serviceId).toBe(CORTE.id);
    });

    it('leaves the answer to the model, draft untouched, when availability cannot be checked', async () => {
        const { turn } = harness({ colorFails: true });
        const open = draftAt('ask_email');
        const { result } = await turn(COMPOUND, structuredClone(open));
        expect(result.handled).toBe(false);
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.state.pendingSwitch).toBeUndefined();
    });

    it.each([
        '¿Tienen cupo el sábado a las 16:00 para color y tratamiento?',
        '¿Cuánto cuesta color y tratamiento y hay espacio el sábado a las 16:00?',
    ])('"%s"', async text => {
        const { turn } = harness();
        const open = draftAt('show_slots', { time: undefined });
        const { result } = await turn(text, structuredClone(open));
        expect(result.handled).toBe(true);
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.text).toContain('¿Desea cambiar su cita de Corte y estilo por Color y tratamiento');
    });

    it('a question about the SAME service is not an offer to switch', async () => {
        const { turn } = harness();
        const { result } = await turn('¿Tienen cupo el sábado a las 17:00 para corte y estilo?', draftAt('show_slots', { time: undefined }));
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(result.state.serviceId).toBe(CORTE.id);
    });
});

describe('a plain explicit switch still switches directly', () => {
    it.each([
        'mejor cámbiala a color y tratamiento el sábado a las 16:00',
        'Quiero color y tratamiento el sábado a las 16:00',
        'prefiero color y tratamiento el sábado a las 16:00',
        'Quiero color y tratamiento el sábado a las 16:00, ¿cuánto dura?',
    ])('"%s"', async text => {
        const { turn } = harness();
        const { result } = await turn(text, draftAt('show_slots', { time: undefined }));
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: COLOR.id, date: SATURDAY, time: '16:00' });
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(result.text).not.toMatch(/Desea cambiar/);
    });
});

describe('the offer and the customer\'s answer (sequence)', () => {
    const offer = async (step: BookingState['step'] = 'show_slots', slots?: Slots) => {
        const h = harness(slots ? { colorSlots: slots } : {});
        const start = STEPS.find(([name]) => name === step)![1];
        const first = await h.turn(COMPOUND, structuredClone(start));
        expect(first.result.state.pendingSwitch).toBeTruthy();
        return { ...h, start, state: first.result.state };
    };

    it.each(['sí', 'sí, por favor', 'dale', 'claro', 'ok', 'de acuerdo'])('"%s" accepts: the draft moves to the other service, the slot is re-checked', async answer => {
        const h = await offer('ask_email');
        const { result } = await h.turn(answer, h.state);
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: COLOR.id, serviceName: COLOR.name, date: SATURDAY, time: '16:00', customerName: 'Joaquin Sosa' });
        expect(result.state.pendingSwitch).toBeUndefined();
        // Name known, e-mail missing: the engine goes on from there, with the customer's agreement.
        expect(result.state.step).toBe('ask_email');
        expect(h.writes()).toHaveLength(0);
        expect(h.availabilityCalls().filter(args => args.serviceId === COLOR.id).length).toBeGreaterThanOrEqual(2);
    });

    it.each(['no', 'no gracias', 'mejor no', 'no, gracias'])('"%s" declines: the draft stays exactly as it was and is NOT cancelled', async answer => {
        const h = await offer('ask_email');
        const { result } = await h.turn(answer, h.state);
        expect(result.handled).toBe(true);
        expect(draftCore(result.state)).toEqual(draftCore(h.start));
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(result.state.pausedAt).toBeUndefined();
        expect(result.text).toMatch(/Corte y estilo/);
        expect(result.text).toMatch(/correo/i);
    });

    it('declining at confirm brings the confirmation summary back', async () => {
        const h = await offer('confirm');
        const { result } = await h.turn('no', h.state);
        expect(result.state.step).toBe('confirm');
        expect(result.state.serviceId).toBe(CORTE.id);
        expect(result.buttonMessage?.buttons).toHaveLength(2);
    });

    it('anything else (the e-mail) drops the offer and goes on with the ORIGINAL draft', async () => {
        const h = await offer('ask_email');
        const { result } = await h.turn('mi correo es joaquin@example.com', h.state);
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(result.state).toMatchObject({ serviceId: CORTE.id, customerEmail: 'joaquin@example.com' });
        expect(result.state.step).toBe('confirm');
    });

    it('a yes after the offer went stale is not read as agreement', async () => {
        const h = await offer('ask_email');
        const stale = { ...h.state, pendingSwitch: { ...h.state.pendingSwitch!, offeredAt: new Date(Date.now() - 20 * 60_000).toISOString() } };
        const { result } = await h.turn('sí', stale);
        expect(result.state.serviceId).toBe(CORTE.id);
        expect(result.state.pendingSwitch).toBeUndefined();
    });

    it('when the slot was taken, a yes with a new time switches to that time', async () => {
        const h = await offer('ask_email', [{ time: '15:00', endTime: '17:00' }, { time: '17:00', endTime: '19:00' }]);
        const { result } = await h.turn('sí, a las 17:00', h.state);
        expect(result.state).toMatchObject({ serviceId: COLOR.id, date: SATURDAY, time: '17:00' });
    });

    it('a second question about the other service re-offers instead of stacking offers', async () => {
        const h = await offer('ask_email');
        const again = await h.turn(COMPOUND, h.state);
        expect(again.result.state.serviceId).toBe(CORTE.id);
        expect(again.result.state.pendingSwitch).toMatchObject({ serviceId: COLOR.id });
    });
});

describe('what the offer must not disturb', () => {
    it('"solo consulto" is left to the model and the draft is untouched', async () => {
        const { turn } = harness();
        const open = draftAt('ask_email');
        const { result } = await turn(`${COMPOUND} Solo consulto`, structuredClone(open));
        expect(result.handled).toBe(false);
        expect(draftCore(result.state)).toEqual(draftCore(open));
    });

    it('a duration question alone (no date, no time) is still the model\'s', async () => {
        const { turn } = harness();
        const open = draftAt('ask_email');
        const { result } = await turn('¿Cuánto dura color y tratamiento?', structuredClone(open));
        expect(result.handled).toBe(false);
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(result.state.pendingSwitch).toBeUndefined();
    });

    it('a tentative mission (only an interest) keeps moving to the service the customer asks about', async () => {
        const { turn } = harness();
        const tentative: BookingState = { missionId: 'm-t', step: 'ask_date', serviceId: CORTE.id, serviceName: CORTE.name, origin: 'question', services };
        const { result } = await turn(COMPOUND, tentative);
        expect(result.state.serviceId).toBe(COLOR.id);
        expect(result.state.pendingSwitch).toBeUndefined();
    });
});
