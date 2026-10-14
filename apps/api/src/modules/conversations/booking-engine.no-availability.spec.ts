import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const service = { id: 'svc', name: 'Consulta', durationMinutes: 30, price: 1000, currency: 'COP', priceStatus: 'confirmed' as const };

describe('empty availability does not prove appointments filled the day', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
        ['es', 0], ['es', 0.3], ['es', 0.6], ['es', 0.9],
        ['en', 0], ['pt', 0], ['fr', 0],
    ])('keeps %s variant %s factual, read-only, and asks for another date', async (language, random) => {
        jest.spyOn(Math, 'random').mockReturnValue(Number(random));
        const execute = jest.fn(async () => ({ available: false, slots: [] }));
        const engine = new BookingEngineService(
            { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
            { get: async () => JSON.stringify([service]), set: async () => {} } as any,
            { execute } as any,
        );
        const state: BookingState = { step: 'ask_date', serviceId: service.id, serviceName: service.name, services: [service] };
        const result = await engine.process('schema', 'tenant', 'contact',
            { intent: 'ask_availability', dateMentioned: '2026-10-18' } as any,
            'consulta para el domingo', state, {}, '2026-10-14', String(language), { authority, conversationId: 'c' });

        expect(result.handled).toBe(true);
        expect(result.text).toContain('2026-10-18');
        expect(result.text).not.toMatch(/completamente lleno|fully booked|completo|complet|sold out/i);
        expect(result.state.step).toBe('ask_date');
        expect(result.state.date).toBeUndefined();
        expect(result.state.time).toBeUndefined();
        expect(result.handoff).not.toBe(true);
        expect(execute.mock.calls.map(call => (call as any[])[3])).toEqual(['check_availability']);
    });
});
