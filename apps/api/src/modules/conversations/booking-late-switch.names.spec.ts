import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * At the late steps the customer types a NAME or an E-MAIL, and either can contain the name of another service
 * ("Carlos Barba", "carlos.barba@gmail.com"). A service word inside such an answer is not an order to switch:
 * the draft keeps its service, its day and its hour, and the name or the e-mail is captured as usual.
 * Only a directive, a day/hour, or the bare service name as the WHOLE message (when the interpreter read no
 * name or e-mail in it) switches.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const price = { price: 10000, currency: 'COP', priceStatus: 'confirmed' as const };
const CORTE = { id: 'b-corte', name: 'Corte', durationMinutes: 30, ...price };
const BARBA = { id: 'b-barba', name: 'Barba', durationMinutes: 30, ...price };
const FACIAL = { id: 'b-facial', name: 'Facial', durationMinutes: 45, ...price };
const BARBER = [CORTE, BARBA, FACIAL];
const SALON = [
    { id: 's-corte', name: 'Corte y estilo', durationMinutes: 45, ...price },
    { id: 's-color', name: 'Color y tratamiento', durationMinutes: 120, ...price },
];
const today = '2026-10-05';
const SATURDAY = '2026-10-10';
const upcoming = [{ date: SATURDAY, weekday: 'sabado' }];

function harness(catalog: Array<typeof CORTE>) {
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'list_services') return { services: catalog };
        if (name === 'check_availability') return { available: true, slots: [{ time: '16:00', endTime: '17:00' }, { time: '17:00', endTime: '18:00' }] };
        return { success: true };
    });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify(catalog), set: async () => {}, del: async () => {} } as any,
        { execute } as any,
    );
    const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
    return async (text: string, state: BookingState) => {
        const intent = await interpreter.interpret(text, state.step, catalog.map(s => s.name), today, upcoming);
        return engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, 'es', { authority, conversationId: 'conversation' });
    };
}

const draft = (catalog: Array<typeof CORTE>, step: BookingState['step'], extra: Partial<BookingState> = {}): BookingState => ({
    missionId: 'm', step, serviceId: catalog[0].id, serviceName: catalog[0].name, date: SATURDAY, time: '16:00',
    slots: [{ time: '16:00', endTime: '17:00' }], services: catalog, ...extra,
});

describe('a name that contains a service word is still a name', () => {
    it.each([
        ['Carlos Barba', 'Carlos Barba'],
        ['Barba', 'Barba'],
        ['barba', 'Barba'],
        ['Ana Facial', 'Ana Facial'],
    ])('at ask_name "%s" is captured as the name and the draft is untouched', async (text, name) => {
        const turn = harness(BARBER);
        const { handled, state, text: reply } = await turn(text, draft(BARBER, 'ask_name'));
        expect(handled).toBe(true);
        expect(reply ?? '').not.toMatch(/Entendido|cambiamos|Cambiamos|Mudamos/);
        expect(state).toMatchObject({ serviceId: CORTE.id, serviceName: CORTE.name, date: SATURDAY, time: '16:00', customerName: name, step: 'ask_email' });
    });

    it('a name with the hour that was already agreed ("Me llamo Carlos Barba, a las 16:00") is not an order either', async () => {
        const turn = harness(BARBER);
        const { state } = await turn('Me llamo Carlos Barba, a las 16:00', draft(BARBER, 'ask_name'));
        expect(state).toMatchObject({ serviceId: CORTE.id, date: SATURDAY, time: '16:00' });
    });

    it.each(['Me llamo Carlos Barba', 'soy Ana Facial', 'Soy Carlos Barba'])('at ask_name "%s" does not switch the service', async text => {
        const turn = harness(BARBER);
        const { state, text: reply } = await turn(text, draft(BARBER, 'ask_name'));
        expect(reply ?? '').not.toMatch(/Entendido|cambiamos|Cambiamos|Mudamos/);
        // ("Me llamo X" is not read as a name by the interpreter, "soy X" is: either way the draft stays.)
        expect(state).toMatchObject({ serviceId: CORTE.id, serviceName: CORTE.name, date: SATURDAY, time: '16:00' });
        expect(['ask_name', 'ask_email']).toContain(state.step);
    });
});

describe('an e-mail that contains a service word is still an e-mail', () => {
    it.each([
        'carlos.barba@gmail.com', 'barba@gmail.com', 'mi correo es carlos.barba@gmail.com', 'facial-ana@x.co',
        'prefiero barba, mi correo es carlos@gmail.com',
    ])('at ask_email "%s" is captured and the draft is untouched', async text => {
        const turn = harness(BARBER);
        const { state } = await turn(text, draft(BARBER, 'ask_email', { customerName: 'Carlos Perez' }));
        expect(state).toMatchObject({ serviceId: CORTE.id, date: SATURDAY, time: '16:00', customerName: 'Carlos Perez', step: 'confirm' });
        expect(state.customerEmail).toMatch(/@/);
    });

    it('in the salon catalog too ("color.y.tratamiento@gmail.com")', async () => {
        const turn = harness(SALON);
        const { state } = await turn('color.y.tratamiento@gmail.com', draft(SALON, 'ask_email', { customerName: 'Ana Gil' }));
        expect(state).toMatchObject({ serviceId: SALON[0].id, customerEmail: 'color.y.tratamiento@gmail.com', step: 'confirm' });
    });

    it('at confirm an e-mail correction mentioning a service word does not switch', async () => {
        const turn = harness(BARBER);
        const { state } = await turn('carlos.barba@gmail.com', draft(BARBER, 'confirm', { customerName: 'Carlos', customerEmail: 'c@x.co' }));
        expect(state.serviceId).toBe(CORTE.id);
    });
});

describe('what still switches at the late steps', () => {
    it.each([
        ['ask_email', 'Barba'], ['ask_email', 'Barba por favor'], ['ask_email', 'la barba'], ['confirm', 'Facial'],
        ['ask_email', 'prefiero barba'], ['ask_name', 'prefiero barba'], ['ask_name', 'mejor cámbiala a facial'],
        ['ask_email', 'barba el sábado a las 16:00'], ['ask_name', 'barba el sábado a las 16:00'],
    ])('at %s "%s"', async (step, text) => {
        const turn = harness(BARBER);
        const open = draft(BARBER, step as BookingState['step'], step === 'ask_name' ? { customerName: undefined } : { customerName: 'Carlos Perez' });
        const { state } = await turn(text, open);
        expect(state.serviceId).not.toBe(CORTE.id);
        expect([BARBA.id, FACIAL.id]).toContain(state.serviceId);
    });

    it('a surname that is only PART of a service name never does', async () => {
        const turn = harness(SALON);
        const { state } = await turn('Ana Color', draft(SALON, 'ask_name', { customerName: undefined }));
        expect(state).toMatchObject({ serviceId: SALON[0].id, customerName: 'Ana Color' });
    });
});
