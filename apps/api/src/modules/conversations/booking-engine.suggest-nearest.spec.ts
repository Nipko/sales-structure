import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Una hora distinta de la pedida nunca se toma sin que el cliente la confirme.
 *
 * Si la hora pedida no está libre y hay un hueco a ±30 min, el motor la
 * cambiaba en silencio ("16:00" -> 16:30) y pasaba a pedir el nombre. Ahora lo
 * dice y recomienda el más cercano; solo un "sí" explícito (o elegir una hora)
 * lo fija.
 */
const BOOKING_AUTHORITY = authorityFor('list_services', 'check_availability', 'create_appointment');
const schemaName = 'tenant_suggest_nearest';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const serviceId = '44444444-4444-4444-8444-444444444444';
const date = '2026-08-15';
const services = [{ id: serviceId, name: 'Consulta', durationMinutes: 30, price: 2500, currency: 'USD' }];
const slot = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    const end = h * 60 + m + 30;
    return { time, endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` };
};

function harness(lang = 'es') {
    const toolExecutor = { execute: jest.fn().mockResolvedValue({ success: true }) };
    const redis = { get: jest.fn().mockResolvedValue(JSON.stringify(services)), set: jest.fn() };
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    const engine = new BookingEngineService(prisma as any, redis as any, toolExecutor as any);
    const turn = (state: BookingState, intent: Record<string, unknown>, rawText: string) =>
        engine.process(schemaName, tenantId, contactId, intent as any, rawText, state, {}, '2026-08-08', lang,
            { authority: BOOKING_AUTHORITY, conversationId });
    return { toolExecutor, turn };
}

const showSlots = (times: string[]): BookingState => ({
    step: 'show_slots', services, serviceId, serviceName: 'Consulta', date, slots: times.map(slot),
});

describe('BookingEngine never swaps the requested time silently', () => {
    it('recommends the nearest slot instead of taking it', async () => {
        const { turn, toolExecutor } = harness();
        const result = await turn(showSlots(['15:00', '16:30', '17:00']), { intent: 'select_slot', timeMentioned: '16:00' }, 'a las 16:00');

        expect(result.state.time).toBeUndefined();
        expect(result.state.step).toBe('show_slots');
        expect(result.text).toContain('16:00');
        expect(result.text).toContain('16:30');
        expect(result.text).toMatch(/recomiendo/i);
        expect(toolExecutor.execute).not.toHaveBeenCalledWith(
            expect.anything(), expect.anything(), expect.anything(), 'create_appointment', expect.anything(), expect.anything(), expect.anything());
    });

    it('recommends the two nearest when both sides are within 30 minutes', async () => {
        const { turn } = harness();
        const result = await turn(showSlots(['15:30', '16:30', '17:00']), { intent: 'select_slot', timeMentioned: '16:00' }, 'a las 16:00');

        expect(result.state.time).toBeUndefined();
        expect(result.text).toContain('15:30');
        expect(result.text).toContain('16:30');
    });

    it('books the recommended slot only after an explicit yes', async () => {
        const { turn } = harness();
        const first = await turn(showSlots(['15:00', '16:30', '17:00']), { intent: 'select_slot', timeMentioned: '16:00' }, 'a las 16:00');
        const second = await turn(first.state, { intent: 'confirm', isConfirmation: true }, 'sí');

        expect(second.state.time).toBe('16:30');
        expect(second.state.step).toBe('ask_name');
    });

    it('also recommends (not swaps) on the first turn, when date and time arrive together', async () => {
        const { turn, toolExecutor } = harness();
        toolExecutor.execute.mockResolvedValue({ available: true, date, slots: ['15:30', '16:30', '17:00'].map(slot) });
        const state: BookingState = { step: 'ask_date', services, serviceId, serviceName: 'Consulta' };
        const result = await turn(state, { intent: 'ask_availability', dateMentioned: date, timeMentioned: '16:00' }, 'sábado 16:00');

        expect(result.state.time).toBeUndefined();
        expect(result.text).toMatch(/recomiendo/i);
        expect(result.text).toContain('16:30');
    });

    it('speaks the recommendation in the conversation language', async () => {
        const { turn } = harness('en');
        const result = await turn(showSlots(['15:00', '16:30']), { intent: 'select_slot', timeMentioned: '16:00' }, 'at 16:00');

        expect(result.text).toMatch(/recommend/i);
        expect(result.text).toContain('16:30');
    });

    it('still takes an exact match directly', async () => {
        const { turn } = harness();
        const result = await turn(showSlots(['15:00', '16:00', '16:30']), { intent: 'select_slot', timeMentioned: '16:00' }, 'a las 16:00');

        expect(result.state.time).toBe('16:00');
        expect(result.state.step).toBe('ask_name');
    });

    it('keeps the plain unavailable list when nothing is within 30 minutes', async () => {
        const { turn } = harness();
        const result = await turn(showSlots(['09:00', '10:00']), { intent: 'select_slot', timeMentioned: '16:00' }, 'a las 16:00');

        expect(result.state.time).toBeUndefined();
        expect(result.text).not.toMatch(/recomiendo/i);
        expect(result.text).toContain('09:00');
    });
});
