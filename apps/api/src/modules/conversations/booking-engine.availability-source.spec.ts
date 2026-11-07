import { BookingEngineService, type BookingState } from './booking-engine.service';
import type { BusinessReadinessPort } from './business-readiness.port';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * E2v C15 (dental, citas): «¿Tienen disponibilidad de Consulta general para el sábado?» con
 * `OBJ.APPOINTMENT.AVAILABILITY_SOURCE` ausente. El motor contestaba «No hay horarios disponibles el 2026-11-07»
 * leyendo la agenda sembrada: negaba disponibilidad sin fuente confirmada. Sin fuente no se afirma ni se niega.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const service = { id: 'svc', name: 'Consulta general', durationMinutes: 30, price: 1000, currency: 'COP', priceStatus: 'confirmed' as const };

const readiness = (unknownIds: string[] | Error | null): BusinessReadinessPort => ({
    getCurrent: jest.fn() as any,
    turnContract: jest.fn(async () => {
        if (unknownIds instanceof Error) throw unknownIds;
        return unknownIds ? { offers: { pendingQuestion: false }, unknown: unknownIds.map(id => ({ id })) } : null;
    }),
});

function engineWith(port: BusinessReadinessPort | undefined, execute: jest.Mock = jest.fn(async (): Promise<unknown> => ({ available: false, slots: [] }))) {
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify([service]), set: async () => {} } as any,
        { execute } as any,
        port,
    );
    return { engine, execute };
}

const ask = (engine: BookingEngineService, language = 'es') => {
    const state: BookingState = { step: 'idle', services: [service] };
    return engine.process('schema', 'tenant', 'contact',
        { intent: 'ask_availability', serviceMentioned: service.name, dateMentioned: '2026-11-07' } as any,
        '¿Tienen disponibilidad de Consulta general para el sábado?', state, {}, '2026-11-05', language,
        { authority, conversationId: 'c' });
};

describe('availability without a confirmed source (E2v C15)', () => {
    it('does not read the seeded agenda: says it has no confirmed availability and hands over to a person', async () => {
        const { engine, execute } = engineWith(readiness(['OBJ.APPOINTMENT.AVAILABILITY_SOURCE']));
        const result = await ask(engine);

        expect(result.handled).toBe(true);
        expect(result.handoff).toBe(true);
        expect(result.handoffReason).toBe('availability_source_unconfirmed');
        expect(result.text).toMatch(/no tengo la disponibilidad de la agenda confirmada en línea/i);
        expect(result.text).toMatch(/alguien del equipo/);
        expect(result.text).not.toMatch(/no hay (horarios|disponibilidad)/i);
        expect(result.text).not.toContain('2026-11-07');
        expect(execute.mock.calls.map(call => (call as any[])[3])).not.toContain('check_availability');
        expect(result.state.step).toBe('idle');
        expect(result.state.date).toBeUndefined();
    });

    it.each(['en', 'pt', 'fr'])('speaks %s', async (language) => {
        const { engine } = engineWith(readiness(['OBJ.APPOINTMENT.AVAILABILITY_SOURCE']));
        const result = await ask(engine, language);
        expect(result.handoff).toBe(true);
        expect(result.text).not.toMatch(/disponibilidad de la agenda/);
        expect(result.text).toMatch(/confirm/i);
    });

    it('with the source confirmed, the agenda answers as before', async () => {
        const { engine, execute } = engineWith(readiness(['CORE.HOURS.HOLIDAYS']));
        const result = await ask(engine);
        expect(execute.mock.calls.map(call => (call as any[])[3])).toContain('check_availability');
        expect(result.handoff).not.toBe(true);
        expect(result.text).toContain('2026-11-07');
    });

    it.each([
        ['without a turn contract', readiness(null)],
        ['when the contract cannot be read', readiness(new Error('redis down'))],
        ['without the readiness port', undefined],
    ])('%s, the agenda answers as before', async (_label, port) => {
        const { engine, execute } = engineWith(port);
        const result = await ask(engine);
        expect(execute.mock.calls.map(call => (call as any[])[3])).toContain('check_availability');
        expect(result.handoff).not.toBe(true);
    });

    it('a slot that is free is not offered either while the source is unconfirmed', async () => {
        const execute = jest.fn(async () => ({ available: true, slots: [{ time: '10:00', endTime: '10:30' }] }));
        const { engine } = engineWith(readiness(['OBJ.APPOINTMENT.AVAILABILITY_SOURCE']), execute);
        const result = await ask(engine);
        expect(result.handoff).toBe(true);
        expect(result.text).not.toContain('10:00');
        expect(execute.mock.calls.map(call => (call as any[])[3])).not.toContain('check_availability');
    });

    it('forExecution keeps the readiness port', async () => {
        const { engine } = engineWith(readiness(['OBJ.APPOINTMENT.AVAILABILITY_SOURCE']));
        const execute = jest.fn(async () => ({ available: false, slots: [] }));
        const scoped = engine.forExecution({ redis: { get: async () => JSON.stringify([service]), set: async () => {} } as any, toolExecutor: { execute } as any });
        const result = await ask(scoped);
        expect(result.handoff).toBe(true);
        expect(execute.mock.calls.map(call => (call as any[])[3])).not.toContain('check_availability');
    });
});
