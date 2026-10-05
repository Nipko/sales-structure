import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * La hora pedida no puede perderse detrás de los seis primeros huecos.
 *
 * El motor hacía `result.slots.slice(0, 6)` y luego buscaba la hora del cliente
 * solo dentro de esos seis. Con huecos cada 30 min desde las 08:00 solo se
 * veían 08:00–10:30: "el sábado a las 16:00" se descartaba sin aviso y las
 * tardes eran inalcanzables por chat. Además la hora dicha junto a la fecha no
 * llegaba a `check_availability`.
 */
const BOOKING_AUTHORITY = authorityFor(
    'list_services', 'check_availability', 'create_appointment',
);

const schemaName = 'tenant_requested_time';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const serviceId = '44444444-4444-4444-8444-444444444444';
const date = '2026-08-15';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// 20 huecos de 30 min: 08:00 → 17:30 (el último termina a las 18:00).
const fullDay = Array.from({ length: 20 }, (_, i) => ({
    time: hhmm(8 * 60 + i * 30),
    endTime: hhmm(8 * 60 + (i + 1) * 30),
}));

async function run(intentOverrides: Record<string, unknown>) {
    const bookingState: BookingState = {
        step: 'ask_date',
        services: [{ id: serviceId, name: 'Consulta', durationMinutes: 30, price: 2500, currency: 'USD' }],
        serviceId,
        serviceName: 'Consulta',
    };
    const redis = { get: jest.fn().mockResolvedValue(JSON.stringify(bookingState.services)), set: jest.fn() };
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    const toolExecutor = {
        // El mock ignora los argumentos y devuelve el día completo.
        execute: jest.fn().mockResolvedValue({ available: true, date, slots: fullDay }),
    };
    const engine = new BookingEngineService(prisma as any, redis as any, toolExecutor as any);
    const result = await engine.process(
        schemaName, tenantId, contactId,
        { intent: 'ask_availability', dateMentioned: date, ...intentOverrides } as any,
        'quiero una cita el sábado',
        bookingState, {}, '2026-08-08', 'es',
        { authority: BOOKING_AUTHORITY, conversationId },
    );
    return { result, toolExecutor };
}

describe('BookingEngine requested time beyond the first six slots', () => {
    it('offers the requested afternoon time even though it is beyond the first six slots', async () => {
        const { result } = await run({ timeMentioned: '16:00' });

        expect(result.state.step).toBe('show_slots');
        expect(result.state.slots).toEqual(expect.arrayContaining([expect.objectContaining({ time: '16:00' })]));
        expect(result.text).toContain('16:00');
    });

    it('passes the requested time to check_availability', async () => {
        const { toolExecutor } = await run({ timeMentioned: '16:00' });

        expect(toolExecutor.execute).toHaveBeenCalledWith(
            schemaName, tenantId, contactId, 'check_availability',
            expect.objectContaining({ date, serviceId, time: '16:00' }),
            conversationId, expect.anything(),
        );
    });

    it('keeps the offered list short', async () => {
        const { result } = await run({ timeMentioned: '16:00' });

        expect(result.state.slots!.length).toBeLessThanOrEqual(6);
    });

    it('offers the nearest slots when the requested time falls between two', async () => {
        const { result } = await run({ timeMentioned: '16:10' });

        const offered = result.state.slots!.map(s => s.time);
        expect(offered).toEqual(expect.arrayContaining(['16:00', '16:30']));
    });

    it('with no requested time keeps the first six slots and does not send a time', async () => {
        const { result, toolExecutor } = await run({});

        expect(result.state.slots!.map(s => s.time)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']);
        const args = toolExecutor.execute.mock.calls.find(c => c[3] === 'check_availability')![4];
        expect(args).not.toHaveProperty('time');
    });
});
