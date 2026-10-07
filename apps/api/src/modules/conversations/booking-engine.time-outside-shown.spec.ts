import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production 2026-10-07: the engine accepted «a las 16:00» although the list shown ended at 11:30. By design, an
 * hour outside the shown list is NOT taken from the list: it is looked up with check_availability for that hour
 * (the list is only the first six slots) and accepted only if the tool returns it. This pins both directions.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const shown = Array.from({ length: 6 }, (_, i) => ({ time: hhmm(9 * 60 + i * 30), endTime: hhmm(9 * 60 + (i + 1) * 30) })); // 09:00-11:30
const SERVICE = { id: 'svc', name: 'Consulta', durationMinutes: 30, price: 1000, currency: 'COP', priceStatus: 'confirmed' as const };

async function pick(toolSlots: Array<{ time: string; endTime: string }>) {
    const state: BookingState = { missionId: 'm', step: 'show_slots', serviceId: SERVICE.id, serviceName: SERVICE.name, date: '2026-10-10', slots: shown, services: [SERVICE] };
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string) =>
        name === 'check_availability' ? { available: toolSlots.length > 0, slots: toolSlots } : { services: [SERVICE] });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify([SERVICE]), set: async () => {} } as any,
        { execute } as any,
    );
    const result = await engine.process('schema', 'tenant', 'contact',
        { intent: 'select_time', timeMentioned: '16:00' } as any, 'a las 16:00', state, {}, '2026-10-05', 'es', { authority, conversationId: 'c' });
    return { result, calls: (execute.mock.calls as any[][]).filter(c => c[3] === 'check_availability').map(c => c[4] as any) };
}

describe('an hour that is not in the shown list', () => {
    it('is looked up with check_availability for THAT hour and accepted when the tool has it', async () => {
        const { result, calls } = await pick([{ time: '15:30', endTime: '16:00' }, { time: '16:00', endTime: '16:30' }]);
        expect(calls).toContainEqual(expect.objectContaining({ date: '2026-10-10', serviceId: SERVICE.id, time: '16:00' }));
        expect(result.state.time).toBe('16:00');
    });

    it('is NOT accepted when the tool does not have it: the nearest free hours are offered instead', async () => {
        const { result, calls } = await pick([{ time: '15:30', endTime: '16:00' }, { time: '16:30', endTime: '17:00' }]);
        expect(calls.length).toBeGreaterThan(0);
        expect(result.state.time).toBeUndefined();
        expect(result.state.suggestedSlots?.map(s => s.time)).toEqual(['15:30', '16:30']);
        expect(result.text).toMatch(/16:00/);
    });

    it('is NOT accepted when the day has nothing at all', async () => {
        const { result } = await pick([]);
        expect(result.state.time).toBeUndefined();
    });
});
